/**
 * routes/buste-paga.js — TOOL: Buste Paga
 *
 * Gestisce cedolini, determina stato attivo/dimesso dipendenti,
 * calcola costo azienda (netto × 1.9653).
 *
 * SINAPSI (connessioni con altri tool):
 *   → employees: aggiorna stato attivo in base all'ultima busta paga
 *   → analytics: alimenta costi del personale per BI
 *   → turni: verifica coerenza ore lavorate vs ore pagate
 */

const express = require('express')
const router = express.Router()
const db = require('../database')
const fs = require('fs')
const path = require('path')

const CRM_DATA = process.env.CRM_DATA_PATH || path.join(__dirname, '..', '..', '..')
const BUSTE_DIR = path.join(CRM_DATA, 'BUSTE_PAGA')
const CCNL_MULTIPLIER = 1.9653

// ── GET /  Lista buste paga con filtri ──────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const { employee, anno, mese, location } = req.query
    let sql = `SELECT bp.*, e.role, e.active as emp_active, e.location as emp_location
               FROM buste_paga bp
               LEFT JOIN employees e ON bp.employee_id = e.id
               WHERE 1=1`
    const params = []
    if (employee) { sql += ` AND bp.employee_name LIKE ?`; params.push(`%${employee}%`) }
    if (anno)     { sql += ` AND bp.anno = ?`; params.push(anno) }
    if (mese)     { sql += ` AND bp.mese = ?`; params.push(mese) }
    if (location) { sql += ` AND bp.location = ?`; params.push(location) }
    sql += ` ORDER BY bp.anno DESC, bp.mese DESC, bp.employee_name ASC`
    res.json(db.prepare(sql).all(params))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /riepilogo  Riepilogo per periodo ───────────────────────────────────
router.get('/riepilogo', (req, res) => {
  try {
    const { anno } = req.query
    let sql = `SELECT anno, mese, location,
                 COUNT(*) as n_dipendenti,
                 SUM(netto) as totale_netto,
                 SUM(costo_azienda) as totale_costo,
                 AVG(netto) as media_netto,
                 AVG(costo_azienda) as media_costo
               FROM buste_paga
               WHERE 1=1`
    const params = []
    if (anno) { sql += ` AND anno = ?`; params.push(anno) }
    sql += ` GROUP BY anno, mese, location ORDER BY anno DESC, mese DESC`
    res.json(db.prepare(sql).all(params))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /stato-dipendenti  Chi è attivo/dimesso basato su ultima busta ─────
router.get('/stato-dipendenti', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT employee_name,
             MAX(anno * 100 + mese) as ultimo_periodo,
             MAX(anno) as ultimo_anno,
             MAX(CASE WHEN anno = (SELECT MAX(anno) FROM buste_paga) THEN mese ELSE 0 END) as ultimo_mese,
             COUNT(*) as totale_buste,
             SUM(netto) as totale_netto,
             SUM(costo_azienda) as totale_costo,
             location
      FROM buste_paga
      GROUP BY employee_name
      ORDER BY ultimo_periodo DESC
    `).all()

    // Determina soglia: se non hanno busta negli ultimi 2 mesi → dimesso
    const now = new Date()
    const sogliaPeriodo = (now.getFullYear() * 100) + (now.getMonth()) // mese precedente

    const result = rows.map(r => ({
      ...r,
      attivo: r.ultimo_periodo >= sogliaPeriodo,
      ultimo_mese_label: `${String(r.ultimo_mese || Math.floor(r.ultimo_periodo % 100)).padStart(2, '0')}/${r.ultimo_anno}`
    }))

    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /costo-mensile  Andamento costo del personale ──────────────────────
router.get('/costo-mensile', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT anno, mese,
             SUM(costo_azienda) as costo_totale,
             SUM(netto) as netto_totale,
             COUNT(DISTINCT employee_name) as n_dipendenti
      FROM buste_paga
      GROUP BY anno, mese
      ORDER BY anno ASC, mese ASC
    `).all()
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /sync  Scansiona cartella BUSTE_PAGA e importa ────────────────────
router.post('/sync', (req, res) => {
  try {
    if (!fs.existsSync(BUSTE_DIR)) {
      return res.status(404).json({ error: 'Cartella BUSTE_PAGA non trovata', path: BUSTE_DIR })
    }

    let imported = 0
    let skipped = 0
    const mesiMap = {
      'gennaio': 1, 'febbraio': 2, 'marzo': 3, 'aprile': 4,
      'maggio': 5, 'giugno': 6, 'luglio': 7, 'agosto': 8,
      'settembre': 9, 'ottobre': 10, 'novembre': 11, 'dicembre': 12,
      'gen': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'mag': 5, 'giu': 6,
      'lug': 7, 'ago': 8, 'set': 9, 'ott': 10, 'nov': 11, 'dic': 12
    }

    // Scansiona anno per anno
    const annoDirs = fs.readdirSync(BUSTE_DIR).filter(d => {
      const full = path.join(BUSTE_DIR, d)
      return fs.statSync(full).isDirectory() && !d.startsWith('.')
    })

    const upsert = db.prepare(`
      INSERT INTO buste_paga (employee_name, anno, mese, mese_label, file_path, file_name, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(employee_name, anno, mese) DO UPDATE SET
        file_path = excluded.file_path,
        file_name = excluded.file_name,
        synced_at = datetime('now')
    `)

    for (const annoDir of annoDirs) {
      // Estrai anno dal nome cartella (es. "buste paga 2025" → 2025)
      const annoMatch = annoDir.match(/(\d{4})/)
      if (!annoMatch) continue
      const anno = parseInt(annoMatch[1])

      const annoPath = path.join(BUSTE_DIR, annoDir)
      const empDirs = fs.readdirSync(annoPath).filter(d => {
        const full = path.join(annoPath, d)
        return fs.statSync(full).isDirectory() && !d.startsWith('.')
      })

      for (const empDir of empDirs) {
        const empName = empDir.replace(/_/g, ' ')
        const empPath = path.join(annoPath, empDir)

        // Scansiona file PDF nella cartella del dipendente
        const files = fs.readdirSync(empPath).filter(f =>
          f.toLowerCase().endsWith('.pdf') && !f.startsWith('.')
        )

        for (const file of files) {
          // Cerca di estrarre il mese dal nome file
          const fileLower = file.toLowerCase()
          let mese = null
          let meseLabel = null

          // Pattern: "gennaio_2025.pdf", "01_2025.pdf", "2025_01.pdf", etc.
          for (const [nome, num] of Object.entries(mesiMap)) {
            if (fileLower.includes(nome)) {
              mese = num
              meseLabel = nome.charAt(0).toUpperCase() + nome.slice(1)
              break
            }
          }

          if (!mese) {
            // Prova pattern numerico: "01" "02" etc.
            const numMatch = fileLower.match(/(?:^|[_\-\s])(\d{1,2})(?:[_\-\s.]|$)/)
            if (numMatch) {
              const n = parseInt(numMatch[1])
              if (n >= 1 && n <= 12) {
                mese = n
                const mesiNomi = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                                  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
                meseLabel = mesiNomi[n - 1]
              }
            }
          }

          if (!mese) { skipped++; continue }

          const filePath = path.join(empPath, file)

          // Cerca match con dipendente in DB
          upsert.run(empName, anno, mese, meseLabel, filePath, file)
          imported++
        }
      }
    }

    // Aggiorna employee_id per le buste senza match
    db.exec(`
      UPDATE buste_paga SET employee_id = (
        SELECT e.id FROM employees e
        WHERE LOWER(REPLACE(e.name, ' ', '')) = LOWER(REPLACE(buste_paga.employee_name, ' ', ''))
        LIMIT 1
      ) WHERE employee_id IS NULL
    `)

    // SINAPSI → employees: aggiorna stato attivo
    _syncEmployeeStatus()

    res.json({
      success: true,
      imported,
      skipped,
      totale: db.prepare('SELECT COUNT(*) as c FROM buste_paga').get().c
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Sinapsi interna: aggiorna stato dipendenti ─────────────────────────────
function _syncEmployeeStatus() {
  const now = new Date()
  const soglia = (now.getFullYear() * 100) + (now.getMonth()) // mese precedente

  // Tutti i dipendenti con ultima busta paga
  const stati = db.prepare(`
    SELECT employee_name, MAX(anno * 100 + mese) as ultimo_periodo
    FROM buste_paga
    GROUP BY employee_name
  `).all()

  for (const s of stati) {
    const attivo = s.ultimo_periodo >= soglia ? 1 : 0
    db.prepare(`
      UPDATE employees SET active = ?, updated_at = datetime('now')
      WHERE LOWER(REPLACE(name, ' ', '')) = LOWER(REPLACE(?, ' ', ''))
    `).run(attivo, s.employee_name)
  }
}

// ── PATCH /:id  Aggiorna netto manualmente ─────────────────────────────────
router.patch('/:id', (req, res) => {
  try {
    const { netto, location } = req.body
    const id = parseInt(req.params.id)
    if (!id) return res.status(400).json({ error: 'ID mancante' })

    const updates = []
    const params = []

    if (netto !== undefined) {
      const nettoNum = parseFloat(netto)
      if (isNaN(nettoNum) || nettoNum < 0) return res.status(400).json({ error: 'Netto non valido' })
      updates.push('netto = ?')
      params.push(nettoNum)
      updates.push('costo_azienda = ?')
      params.push(Math.round(nettoNum * CCNL_MULTIPLIER * 100) / 100)
    }
    if (location !== undefined) {
      updates.push('location = ?')
      params.push(location)
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Nessun campo da aggiornare' })

    params.push(id)
    db.prepare(`UPDATE buste_paga SET ${updates.join(', ')} WHERE id = ?`).run(...params)

    const updated = db.prepare('SELECT * FROM buste_paga WHERE id = ?').get(id)
    res.json({ success: true, cedolino: updated })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /dipendente/:name  Dettaglio buste per dipendente ──────────────────
router.get('/dipendente/:name', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM buste_paga
      WHERE employee_name LIKE ?
      ORDER BY anno DESC, mese DESC
    `).all([`%${req.params.name}%`])
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
