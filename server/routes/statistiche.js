/**
 * routes/statistiche.js — TOOL: Statistiche Sala
 *
 * Gestisce dati permanenza ai tavoli, analisi fasce orarie,
 * performance sala per operatore.
 *
 * SINAPSI (connessioni con altri tool):
 *   → employees/kpi: correla permanenza con performance operatore
 *   → chiusure: confronta coperti permanenza vs coperti chiusure
 *   → turni: ottimizza scaglioni turni in base a fasce orarie picco
 *   → analytics: alimenta modelli predittivi su occupazione tavoli
 */

const express = require('express')
const router = express.Router()
const db = require('../database')
const fs = require('fs')
const path = require('path')

const CRM_DATA = process.env.CRM_DATA_PATH || path.join(__dirname, '..', '..', '..')
const STATS_DIR = path.join(CRM_DATA, 'STATISTICHE')

// ── GET /  Lista permanenze con filtri ──────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const { location, from, to, operatore, fascia, limit } = req.query
    let sql = `SELECT * FROM permanenza_tavoli WHERE 1=1`
    const params = []
    if (location)  { sql += ` AND location = ?`; params.push(location) }
    if (from)      { sql += ` AND data >= ?`; params.push(from) }
    if (to)        { sql += ` AND data <= ?`; params.push(to) }
    if (operatore) { sql += ` AND operatore LIKE ?`; params.push(`%${operatore}%`) }
    if (fascia)    { sql += ` AND fascia_oraria = ?`; params.push(fascia) }
    sql += ` ORDER BY data DESC, ora_chiusura DESC`
    if (limit) sql += ` LIMIT ${parseInt(limit)}`
    res.json(db.prepare(sql).all(params))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /fasce-orarie  Analisi per fascia oraria ────────────────────────────
router.get('/fasce-orarie', (req, res) => {
  try {
    const { location, from, to } = req.query
    let where = '1=1'
    const params = []
    if (location) { where += ` AND location = ?`; params.push(location) }
    if (from)     { where += ` AND data >= ?`; params.push(from) }
    if (to)       { where += ` AND data <= ?`; params.push(to) }

    const rows = db.prepare(`
      SELECT fascia_oraria,
             COUNT(*) as n_tavoli,
             SUM(coperti) as totale_coperti,
             AVG(coperti) as media_coperti,
             AVG(totale) as media_spesa,
             AVG(permanenza_minuti) as media_permanenza,
             SUM(totale) as totale_incasso,
             AVG(totale / NULLIF(coperti, 0)) as coperto_medio
      FROM permanenza_tavoli
      WHERE ${where} AND fascia_oraria IS NOT NULL
      GROUP BY fascia_oraria
      ORDER BY fascia_oraria
    `).all(params)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /operatori  Performance operatore in sala ───────────────────────────
router.get('/operatori', (req, res) => {
  try {
    const { location, from, to } = req.query
    let where = '1=1'
    const params = []
    if (location) { where += ` AND location = ?`; params.push(location) }
    if (from)     { where += ` AND data >= ?`; params.push(from) }
    if (to)       { where += ` AND data <= ?`; params.push(to) }

    const rows = db.prepare(`
      SELECT operatore,
             COUNT(*) as n_tavoli,
             SUM(coperti) as totale_coperti,
             AVG(coperti) as media_coperti_tavolo,
             SUM(totale) as totale_incasso,
             AVG(totale) as media_incasso_tavolo,
             AVG(permanenza_minuti) as media_permanenza,
             AVG(totale / NULLIF(coperti, 0)) as coperto_medio,
             MIN(data) as prima_data,
             MAX(data) as ultima_data
      FROM permanenza_tavoli
      WHERE ${where}
      GROUP BY operatore
      ORDER BY totale_incasso DESC
    `).all(params)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /tavoli  Analisi per tavolo/stanza ──────────────────────────────────
router.get('/tavoli', (req, res) => {
  try {
    const { location, from, to } = req.query
    let where = '1=1'
    const params = []
    if (location) { where += ` AND location = ?`; params.push(location) }
    if (from)     { where += ` AND data >= ?`; params.push(from) }
    if (to)       { where += ` AND data <= ?`; params.push(to) }

    const rows = db.prepare(`
      SELECT nome_stanza, tavolo,
             COUNT(*) as n_servizi,
             AVG(coperti) as media_coperti,
             AVG(totale) as media_spesa,
             AVG(permanenza_minuti) as media_permanenza,
             SUM(totale) as totale_incasso
      FROM permanenza_tavoli
      WHERE ${where}
      GROUP BY nome_stanza, tavolo
      ORDER BY totale_incasso DESC
    `).all(params)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /giornaliero  Trend giornaliero ─────────────────────────────────────
router.get('/giornaliero', (req, res) => {
  try {
    const { location, from, to } = req.query
    let where = '1=1'
    const params = []
    if (location) { where += ` AND location = ?`; params.push(location) }
    if (from)     { where += ` AND data >= ?`; params.push(from) }
    if (to)       { where += ` AND data <= ?`; params.push(to) }

    const rows = db.prepare(`
      SELECT data,
             COUNT(*) as n_tavoli,
             SUM(coperti) as totale_coperti,
             SUM(totale) as totale_incasso,
             AVG(permanenza_minuti) as media_permanenza,
             AVG(totale / NULLIF(coperti, 0)) as coperto_medio
      FROM permanenza_tavoli
      WHERE ${where}
      GROUP BY data
      ORDER BY data DESC
    `).all(params)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /sync  Importa dati da XLS permanenza ─────────────────────────────
router.post('/sync', (req, res) => {
  try {
    const xlsFile = path.join(STATS_DIR, 'permanenza_ai_tavoli.xls')
    if (!fs.existsSync(xlsFile)) {
      return res.status(404).json({ error: 'File permanenza_ai_tavoli.xls non trovato', path: xlsFile })
    }

    // Usa xlsx per leggere il file
    let XLSX
    try { XLSX = require('xlsx') } catch (_) {
      return res.status(500).json({ error: 'Pacchetto xlsx non installato. Esegui: cd server && npm install xlsx' })
    }

    const wb = XLSX.readFile(xlsFile)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

    let imported = 0
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO permanenza_tavoli
      (data, location, nome_stanza, tavolo, operatore, coperti, totale,
       permanenza_minuti, permanenza_label, cliente, fascia_oraria, ora_chiusura, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `)

    for (const row of rows) {
      // Mappa colonne (dal file XLS analizzato)
      const dataRaw = row['Data'] || row['data'] || ''
      const stanza = row['Nome stanza'] || row['nome_stanza'] || ''
      const tavolo = row['Tavolo'] || row['tavolo'] || ''
      const operatore = row['Operatore'] || row['operatore'] || ''
      const coperti = parseInt(row['Coperti'] || row['coperti'] || 0)
      const totale = parseFloat(String(row['Totale €'] || row['Totale'] || row['totale'] || 0).replace(',', '.'))
      const permLabel = row['Permanenza al tavolo'] || row['permanenza'] || ''
      const cliente = row['Cliente'] || row['cliente'] || ''

      // Converti data
      let data = ''
      if (typeof dataRaw === 'number') {
        // Excel serial date
        const d = XLSX.SSF.parse_date_code(dataRaw)
        data = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
      } else if (dataRaw) {
        // Try parsing DD/MM/YYYY
        const parts = String(dataRaw).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
        if (parts) data = `${parts[3]}-${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}`
        else data = String(dataRaw)
      }
      if (!data) continue

      // Calcola permanenza in minuti
      let permMinuti = 0
      const permMatch = String(permLabel).match(/(\d+)\s*[hH:]\s*(\d+)/)
      if (permMatch) {
        permMinuti = parseInt(permMatch[1]) * 60 + parseInt(permMatch[2])
      } else {
        const minMatch = String(permLabel).match(/(\d+)/)
        if (minMatch) permMinuti = parseInt(minMatch[1])
      }

      // Determina fascia oraria dalla permanenza o dall'ora se disponibile
      let fascia = 'altro'
      // Se abbiamo ora chiusura, usiamo quella per la fascia
      // Altrimenti facciamo un default
      let oraChiusura = ''

      // Heuristic: se la data ha anche un orario
      const timeMatch = String(dataRaw).match(/(\d{1,2}):(\d{2})/)
      if (timeMatch) {
        const h = parseInt(timeMatch[1])
        oraChiusura = `${String(h).padStart(2,'0')}:${timeMatch[2]}`
        if (h >= 12 && h < 15) fascia = 'pranzo'
        else if (h >= 15 && h < 19) fascia = 'pomeriggio'
        else if (h >= 19 && h <= 23) fascia = 'cena'
        else if (h >= 0 && h < 4) fascia = 'cena-tarda'
        else fascia = 'altro'
      }

      // Location: per ora default, potrebbe essere determinata dalla stanza
      const location = 'MA' // TODO: determinare da config

      upsert.run(data, location, stanza, tavolo, operatore, coperti, totale,
                 permMinuti, permLabel, cliente, fascia, oraChiusura)
      imported++
    }

    res.json({
      success: true,
      imported,
      totale: db.prepare('SELECT COUNT(*) as c FROM permanenza_tavoli').get().c
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
