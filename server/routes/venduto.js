const express = require('express');
const router = express.Router();
const db = require('../database');

// GET venduto per operatore
// Usa COPERTI come metrica principale (importo=0 nel CSV sorgente)
// Venduto stimato = coperti × coperto_medio_locale
router.get('/operatori', (req, res) => {
  const { location, from, to } = req.query;
  let where = "categoria = 'Costo servizio'";
  const params = [];
  if (location) { where += ' AND v.location = ?'; params.push(location); }
  if (from) { where += ' AND v.data_inizio >= ?'; params.push(from); }
  if (to) { where += ' AND v.data_inizio <= ?'; params.push(to); }

  // Ottieni coperto medio per locale e mese dalle chiusure
  const cmQuery = db.prepare(`
    SELECT location,
           strftime('%Y-%m', data) as mese,
           ROUND(AVG(coperto_medio),2) as avg_cm
    FROM chiusure_data
    GROUP BY location, mese
  `).all();

  const cmMap = {};
  cmQuery.forEach(r => { cmMap[r.location + '|' + r.mese] = r.avg_cm; });

  // Coperti per operatore per mese
  const rawOps = db.prepare(`
    SELECT v.operatore, v.location,
      CASE
        WHEN v.data_inizio LIKE '____-__-__' THEN substr(v.data_inizio, 1, 7)
        WHEN v.data_inizio LIKE '__/__/____' THEN substr(v.data_inizio, 7, 4) || '-' || substr(v.data_inizio, 4, 2)
        ELSE substr(v.data_inizio, 1, 7)
      END as mese,
      SUM(v.quantita) as coperti
    FROM venduto_data v
    WHERE ${where}
    GROUP BY v.operatore, v.location, mese
    ORDER BY v.operatore, mese
  `).all(...params);

  // Aggrega per operatore + stima venduto
  const byOp = {};
  const skip = new Set(['PIENISSIMO','TECNICO','EXTRA','ANDREA SALA']);
  rawOps.forEach(r => {
    if (skip.has(r.operatore.toUpperCase())) return;
    const key = r.operatore + '|' + r.location;
    if (!byOp[key]) byOp[key] = {
      operatore: r.operatore, location: r.location,
      tot_coperti: 0, venduto_stimato: 0, mesi: [], n_mesi: 0
    };
    const cm = cmMap[r.location + '|' + r.mese] || 0;
    byOp[key].tot_coperti += r.coperti;
    byOp[key].venduto_stimato += Math.round(r.coperti * cm);
    byOp[key].mesi.push(r.mese);
    byOp[key].n_mesi++;
  });

  const result = Object.values(byOp).map(op => ({
    ...op,
    mesi: undefined,
    media_coperti_mese: op.n_mesi > 0 ? Math.round(op.tot_coperti / op.n_mesi) : 0,
    // tot_importo per compatibilità con frontend
    tot_importo: op.venduto_stimato,
    tot_quantita: op.tot_coperti,
  })).sort((a, b) => b.tot_coperti - a.tot_coperti);

  res.json(result);
});

// GET venduto per categoria (quantità prodotti per categoria)
router.get('/categorie', (req, res) => {
  const { location, operatore, from, to } = req.query;
  let where = '1=1';
  const params = [];
  if (location)  { where += ' AND location = ?';  params.push(location); }
  if (operatore) { where += ' AND operatore = ?';  params.push(operatore.toUpperCase()); }
  if (from) { where += ' AND data_inizio >= ?'; params.push(from); }
  if (to) { where += ' AND data_inizio <= ?'; params.push(to); }
  const data = db.prepare(`
    SELECT categoria,
      SUM(quantita) as tot_quantita,
      COUNT(DISTINCT prodotto) as n_prodotti,
      COUNT(DISTINCT operatore) as n_operatori
    FROM venduto_data
    WHERE ${where}
    GROUP BY categoria
    ORDER BY tot_quantita DESC
  `).all(...params);

  // Aggiungi tot_importo=tot_quantita per compatibilità grafici (pie chart)
  res.json(data.map(r => ({ ...r, tot_importo: r.tot_quantita })));
});

// GET top prodotti (per quantità venduta)
router.get('/prodotti', (req, res) => {
  const { location, operatore, from, to, limit = 20 } = req.query;
  let where = "categoria NOT IN ('Costo servizio')"; // escludi coperti
  const params = [];
  if (location)  { where += ' AND location = ?';  params.push(location); }
  if (operatore) { where += ' AND operatore = ?'; params.push(operatore.toUpperCase()); }
  if (from) { where += ' AND data_inizio >= ?'; params.push(from); }
  if (to) { where += ' AND data_inizio <= ?'; params.push(to); }
  params.push(parseInt(limit));
  const data = db.prepare(`
    SELECT prodotto, categoria,
      SUM(quantita) as tot_quantita,
      COUNT(DISTINCT operatore) as n_operatori,
      COUNT(DISTINCT location) as n_locali
    FROM venduto_data
    WHERE ${where}
    GROUP BY prodotto
    ORDER BY tot_quantita DESC
    LIMIT ?
  `).all(...params);
  res.json(data.map(r => ({ ...r, tot_importo: r.tot_quantita })));
});

// GET varianti (up-sell)
router.get('/varianti', (req, res) => {
  const { location, operatore, from, to } = req.query;
  let where = '1=1';
  const params = [];
  if (location)  { where += ' AND location = ?';  params.push(location); }
  if (operatore) { where += ' AND operatore = ?'; params.push(operatore.toUpperCase()); }
  if (from) { where += ' AND data_inizio >= ?'; params.push(from); }
  if (to) { where += ' AND data_inizio <= ?'; params.push(to); }
  const data = db.prepare(`
    SELECT variante, operatore,
      SUM(aggiunta_qty) as tot_aggiunte,
      ROUND(SUM(aggiunta_importo),2) as tot_importo_aggiunta,
      SUM(rimozione_qty) as tot_rimozioni
    FROM varianti_data
    WHERE ${where}
    GROUP BY variante, operatore
    ORDER BY tot_aggiunte DESC
    LIMIT 50
  `).all(...params);
  res.json(data);
});

// GET confronto MA vs PN
router.get('/confronto', (req, res) => {
  // Usa coperti come metrica principale
  const coperti = db.prepare(`
    SELECT location,
      SUM(quantita) as tot_coperti,
      COUNT(DISTINCT operatore) as n_operatori,
      COUNT(DISTINCT prodotto) as n_prodotti
    FROM venduto_data
    WHERE categoria = 'Costo servizio'
    GROUP BY location
  `).all();
  res.json(coperti.map(r => ({ ...r, tot_importo: r.tot_coperti })));
});

module.exports = router;
