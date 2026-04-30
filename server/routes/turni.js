/**
 * routes/turni.js — TOOL: Turni
 *
 * Gestisce pianificazione turni per entrambe le sedi.
 * Legge da file XLSX nella cartella TURNI/MAMELI e TURNI/PREDDA_NIEDDA.
 *
 * SINAPSI (connessioni con altri tool):
 *   → employees: verifica che tutti i dipendenti attivi abbiano turni
 *   → buste_paga: confronto ore lavorate vs ore pagate
 *   → statistiche: ottimizza turni in base a fasce orarie di picco
 *   → chiusure: correla copertura turni con revenue giornaliero
 */

const express = require('express')
const router = express.Router()
const db = require('../database')
const fs = require('fs')
const path = require('path')

const CRM_DATA = process.env.CRM_DATA_PATH || path.join(__dirname, '..', '..', '..')
const TURNI_DIR = path.join(CRM_DATA, 'TURNI')

// ── GET /  Lista turni con filtri ───────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const { location, from, to, employee, settimana } = req.query
    let sql = `SELECT t.*, e.role, e.active as emp_active
               FROM turni t
               LEFT JOIN employees e ON t.employee_id = e.id
               WHERE 1=1`
    const params = []
    if (location) { sql += ` AND t.location = ?`; params.push(location) }
    if (from)     { sql += ` AND t.data >= ?`; params.push(from) }
    if (to)       { sql += ` AND t.data <= ?`; params.push(to) }
    if (employee) { sql += ` AND t.employee_name LIKE ?`; params.push(`%${employee}%`) }
    sql += ` ORDER BY t.data ASC, t.employee_name ASC`
    res.json(db.prepare(sql).all(params))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /settimana  Vista settimanale per sede ──────────────────────────────
router.get('/settimana', (req, res) => {
  try {
    const { location, data_inizio } = req.query
    if (!data_inizio) return res.status(400).json({ error: 'data_inizio richiesta (YYYY-MM-DD)' })

    // Calcola lunedì-domenica della settimana
    const start = new Date(data_inizio)
    const dayOfWeek = start.getDay()
    const monday = new Date(start)
    monday.setDate(start.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)

    const from = monday.toISOString().split('T')[0]
    const to = sunday.toISOString().split('T')[0]

    let sql = `SELECT t.*, e.role, e.avatar_color
               FROM turni t
               LEFT JOIN employees e ON t.employee_id = e.id
               WHERE t.data >= ? AND t.data <= ?`
    const params = [from, to]
    if (location) { sql += ` AND t.location = ?`; params.push(location) }
    sql += ` ORDER BY t.data ASC, t.ora_inizio ASC`

    const turni = db.prepare(sql).all(params)

    // Raggruppa per dipendente
    const byEmployee = {}
    for (const t of turni) {
      if (!byEmployee[t.employee_name]) {
        byEmployee[t.employee_name] = {
          employee_name: t.employee_name,
          role: t.role,
          avatar_color: t.avatar_color,
          location: t.location,
          giorni: {},
          ore_totali: 0
        }
      }
      byEmployee[t.employee_name].giorni[t.data] = {
        turno: t.turno,
        ora_inizio: t.ora_inizio,
        ora_fine: t.ora_fine,
        ore: t.ore_lavorate,
        note: t.note
      }
      byEmployee[t.employee_name].ore_totali += (t.ore_lavorate || 0)
    }

    res.json({
      settimana: { from, to },
      dipendenti: Object.values(byEmployee)
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /riepilogo  Ore totali per dipendente/mese ──────────────────────────
router.get('/riepilogo', (req, res) => {
  try {
    const { location, mese } = req.query
    let where = '1=1'
    const params = []
    if (location) { where += ` AND location = ?`; params.push(location) }
    if (mese) { where += ` AND substr(data, 1, 7) = ?`; params.push(mese) }

    const rows = db.prepare(`
      SELECT employee_name, location,
             COUNT(DISTINCT data) as giorni_lavorati,
             SUM(ore_lavorate) as ore_totali,
             AVG(ore_lavorate) as media_ore_giorno,
             MIN(data) as prima_data,
             MAX(data) as ultima_data
      FROM turni
      WHERE ${where}
      GROUP BY employee_name, location
      ORDER BY ore_totali DESC
    `).all(params)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /  Crea/aggiorna turno singolo ─────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { employee_name, location, data, turno, ora_inizio, ora_fine, ore_lavorate, ruolo, note } = req.body
    if (!employee_name || !location || !data) {
      return res.status(400).json({ error: 'employee_name, location, data sono richiesti' })
    }

    db.prepare(`
      INSERT INTO turni (employee_name, location, data, turno, ora_inizio, ora_fine, ore_lavorate, ruolo, note, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(employee_name, location, data) DO UPDATE SET
        turno = excluded.turno,
        ora_inizio = excluded.ora_inizio,
        ora_fine = excluded.ora_fine,
        ore_lavorate = excluded.ore_lavorate,
        ruolo = excluded.ruolo,
        note = excluded.note,
        synced_at = datetime('now')
    `).run(employee_name, location, data, turno || null, ora_inizio || null, ora_fine || null,
           ore_lavorate || 0, ruolo || null, note || null)

    // Match employee_id
    db.exec(`
      UPDATE turni SET employee_id = (
        SELECT e.id FROM employees e
        WHERE LOWER(REPLACE(e.name, ' ', '')) = LOWER(REPLACE(turni.employee_name, ' ', ''))
        LIMIT 1
      ) WHERE employee_id IS NULL
    `)

    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── DELETE /:id  Elimina turno ──────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM turni WHERE id = ?').run(req.params.id)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /sync  Importa turni da XLSX ───────────────────────────────────────
router.post('/sync', (req, res) => {
  try {
    if (!fs.existsSync(TURNI_DIR)) {
      return res.status(404).json({ error: 'Cartella TURNI non trovata', path: TURNI_DIR })
    }

    let XLSX
    try { XLSX = require('xlsx') } catch (_) {
      return res.status(500).json({ error: 'Pacchetto xlsx non installato. Esegui: cd server && npm install xlsx' })
    }

    let imported = 0
    const locations = { 'MAMELI': 'MA', 'PREDDA_NIEDDA': 'PN' }

    const upsert = db.prepare(`
      INSERT INTO turni (employee_name, location, data, turno, ora_inizio, ora_fine, ore_lavorate, ruolo, note, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(employee_name, location, data) DO UPDATE SET
        turno = excluded.turno, ora_inizio = excluded.ora_inizio, ora_fine = excluded.ora_fine,
        ore_lavorate = excluded.ore_lavorate, ruolo = excluded.ruolo, note = excluded.note,
        synced_at = datetime('now')
    `)

    for (const [folder, locCode] of Object.entries(locations)) {
      const locDir = path.join(TURNI_DIR, folder)
      if (!fs.existsSync(locDir)) continue

      const xlsFiles = fs.readdirSync(locDir).filter(f =>
        (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.startsWith('~') && !f.startsWith('.')
      )

      for (const file of xlsFiles) {
        const wb = XLSX.readFile(path.join(locDir, file))

        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName]
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

          for (const row of rows) {
            // Cerca colonne dipendente e data
            const empName = row['Dipendente'] || row['Nome'] || row['dipendente'] || row['nome'] || ''
            const dataRaw = row['Data'] || row['data'] || row['Giorno'] || ''

            if (!empName || !dataRaw) continue

            let data = ''
            if (typeof dataRaw === 'number') {
              const d = XLSX.SSF.parse_date_code(dataRaw)
              data = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
            } else {
              const parts = String(dataRaw).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
              if (parts) data = `${parts[3]}-${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}`
              else data = String(dataRaw)
            }
            if (!data) continue

            const turno = row['Turno'] || row['turno'] || ''
            const oraInizio = row['Ora Inizio'] || row['ora_inizio'] || row['Inizio'] || ''
            const oraFine = row['Ora Fine'] || row['ora_fine'] || row['Fine'] || ''
            const ore = parseFloat(row['Ore'] || row['ore'] || row['Ore Lavorate'] || 0)
            const ruolo = row['Ruolo'] || row['ruolo'] || ''
            const note = row['Note'] || row['note'] || ''

            upsert.run(empName, locCode, data, turno || null,
                       String(oraInizio) || null, String(oraFine) || null,
                       ore || 0, ruolo || null, note || null)
            imported++
          }
        }
      }
    }

    // Match employee_id
    db.exec(`
      UPDATE turni SET employee_id = (
        SELECT e.id FROM employees e
        WHERE LOWER(REPLACE(e.name, ' ', '')) = LOWER(REPLACE(turni.employee_name, ' ', ''))
        LIMIT 1
      ) WHERE employee_id IS NULL
    `)

    res.json({
      success: true,
      imported,
      totale: db.prepare('SELECT COUNT(*) as c FROM turni').get().c
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
