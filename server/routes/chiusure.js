const express = require('express');
const router = express.Router();
const db = require('../database');

// GET chiusure con filtri
router.get('/', (req, res) => {
  const { location, from, to, limit = 90 } = req.query;
  let where = '1=1';
  const params = [];
  if (location) { where += ' AND location = ?'; params.push(location); }
  if (from) { where += ' AND data >= ?'; params.push(from); }
  if (to) { where += ' AND data <= ?'; params.push(to); }
  params.push(parseInt(limit));
  const data = db.prepare(`
    SELECT * FROM chiusure_data
    WHERE ${where}
    ORDER BY data DESC, location ASC
    LIMIT ?
  `).all(...params);
  res.json(data);
});

// GET sommario mensile
router.get('/mensile', (req, res) => {
  const { location, year, from, to } = req.query;
  let where = '1=1';
  const params = [];
  if (location) { where += ' AND location = ?'; params.push(location); }
  if (year) { where += ` AND strftime('%Y', data) = ?`; params.push(year); }
  if (from) { where += ' AND data >= ?'; params.push(from); }
  if (to) { where += ' AND data <= ?'; params.push(to); }
  const data = db.prepare(`
    SELECT strftime('%Y-%m', data) as mese, location,
      SUM(coperti) as tot_coperti,
      ROUND(AVG(coperto_medio),2) as avg_coperto_medio,
      ROUND(AVG(scontrino_medio),2) as avg_scontrino_medio,
      ROUND(SUM(totale_venduto_ipratico),2) as tot_venduto,
      ROUND(SUM(totale_fiscalizzato_fatture),2) as tot_fatture,
      SUM(n_doc_fiscali) as tot_scontrini,
      COUNT(*) as giorni_apertura
    FROM chiusure_data
    WHERE ${where}
    GROUP BY mese, location
    ORDER BY mese ASC
  `).all(...params);
  res.json(data);
});

// GET confronto anno corrente vs precedente
router.get('/confronto-annuale', (req, res) => {
  const { location, from, to } = req.query;
  let where = '1=1';
  const params = [];
  if (location) { where += ' AND location = ?'; params.push(location); }
  if (from) { where += ' AND data >= ?'; params.push(from); }
  if (to) { where += ' AND data <= ?'; params.push(to); }
  const data = db.prepare(`
    SELECT strftime('%m', data) as mese,
      strftime('%Y', data) as anno,
      location,
      SUM(coperti) as tot_coperti,
      ROUND(SUM(totale_venduto_ipratico),2) as tot_venduto
    FROM chiusure_data
    WHERE ${where}
    GROUP BY mese, anno, location
    ORDER BY anno, mese
  `).all(...params);
  res.json(data);
});

// GET ultimi 30 giorni
router.get('/recenti', (req, res) => {
  const { location, from, to } = req.query;
  let where = from ? '1=1' : "data >= date('now','-30 days')";
  const params = [];
  if (location) { where += ' AND location = ?'; params.push(location); }
  if (from) { where += ' AND data >= ?'; params.push(from); }
  if (to) { where += ' AND data <= ?'; params.push(to); }
  const data = db.prepare(`
    SELECT * FROM chiusure_data
    WHERE ${where}
    ORDER BY data ASC, location ASC
  `).all(...params);
  res.json(data);
});

// GET stats generali
router.get('/stats', (req, res) => {
  const { location, from, to } = req.query;
  let where = '1=1';
  const params = [];
  if (location) { where += ' AND location = ?'; params.push(location); }
  if (from)     { where += ' AND data >= ?';    params.push(from); }
  if (to)       { where += ' AND data <= ?';    params.push(to); }
  const stats = db.prepare(`
    SELECT location,
      COUNT(*) as n_giorni,
      ROUND(SUM(totale_venduto_ipratico),2) as tot_venduto,
      SUM(coperti) as tot_coperti,
      ROUND(AVG(coperto_medio),2) as avg_coperto_medio,
      ROUND(AVG(scontrino_medio),2) as avg_scontrino_medio,
      MIN(data) as prima_data,
      MAX(data) as ultima_data
    FROM chiusure_data
    WHERE ${where}
    GROUP BY location
  `).all(...params);
  res.json(stats);
});

module.exports = router;
