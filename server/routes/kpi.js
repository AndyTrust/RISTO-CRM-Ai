const express = require('express');
const router = express.Router();
const db = require('../database');

// GET KPI team overview (tutti i locali o filtrato)
router.get('/team', (req, res) => {
  const { location, month, from, to } = req.query;

  let chiusureWhere = '1=1';
  const chiusureParams = [];
  if (location) { chiusureWhere += ' AND location = ?'; chiusureParams.push(location); }
  if (month) { chiusureWhere += ` AND strftime('%Y-%m', data) = ?`; chiusureParams.push(month); }
  if (from)  { chiusureWhere += ' AND data >= ?'; chiusureParams.push(from); }
  if (to)    { chiusureWhere += ' AND data <= ?'; chiusureParams.push(to); }

  const chiusure = db.prepare(`
    SELECT location,
      SUM(coperti) as tot_coperti,
      AVG(coperto_medio) as avg_coperto_medio,
      AVG(scontrino_medio) as avg_scontrino_medio,
      SUM(totale_venduto_ipratico) as tot_venduto,
      COUNT(*) as giorni
    FROM chiusure_data
    WHERE ${chiusureWhere}
    GROUP BY location
  `).all(...chiusureParams);

  // Quantum per operatore (venduto / coperti stimati)
  let vendutoWhere = '1=1';
  const vendutoParams = [];
  if (location) { vendutoWhere += ' AND location = ?'; vendutoParams.push(location); }

  const operatori = db.prepare(`
    SELECT operatore, location,
      SUM(quantita) as tot_quantita,
      SUM(importo) as tot_importo,
      COUNT(DISTINCT data_inizio) as periodi
    FROM venduto_data
    WHERE ${vendutoWhere}
    GROUP BY operatore, location
    ORDER BY tot_importo DESC
  `).all(...vendutoParams);

  res.json({ chiusure, operatori });
});

// GET KPI per singolo operatore
router.get('/operator/:name', (req, res) => {
  const { name } = req.params;
  const { location, month } = req.query;

  const empName = name.toUpperCase();

  // Dati venduto
  let where = 'operatore = ?';
  const params = [empName];
  if (location) { where += ' AND location = ?'; params.push(location); }

  const venduto = db.prepare(`
    SELECT categoria,
      SUM(quantita) as tot_quantita,
      SUM(importo) as tot_importo
    FROM venduto_data
    WHERE ${where}
    GROUP BY categoria
    ORDER BY tot_importo DESC
  `).all(...params);

  const topProdotti = db.prepare(`
    SELECT prodotto, categoria,
      SUM(quantita) as tot_quantita,
      SUM(importo) as tot_importo
    FROM venduto_data
    WHERE ${where}
    GROUP BY prodotto
    ORDER BY tot_importo DESC
    LIMIT 10
  `).all(...params);

  // Varianti (up-sell)
  const varianti = db.prepare(`
    SELECT variante,
      SUM(aggiunta_qty) as tot_aggiunte,
      SUM(aggiunta_importo) as tot_importo_aggiunta
    FROM varianti_data
    WHERE operatore = ? ${location ? 'AND location = ?' : ''}
    GROUP BY variante
    ORDER BY tot_aggiunte DESC
    LIMIT 10
  `).all(location ? [empName, location] : [empName]);

  // Target e piano dal DB
  const emp = db.prepare('SELECT id FROM employees WHERE name = ?').get(empName);
  const targets = emp ? db.prepare('SELECT * FROM kpi_targets WHERE employee_id = ?').all(emp.id) : [];
  const latestPlan = emp
    ? db.prepare('SELECT * FROM employee_plans WHERE employee_id = ? ORDER BY period_start DESC LIMIT 1').get(emp.id)
    : null;

  res.json({ operatore: empName, venduto, topProdotti, varianti, targets, latestPlan });
});

// GET quantum ranking (tutti gli operatori ordinati per quantum)
// Quantum = venduto_stimato / coperti = coperto_medio_locale (proxy)
// Venduto stimato per operatore = coperti_operatore × coperto_medio_locale_mese
router.get('/quantum', (req, res) => {
  const { location, from, to } = req.query;

  // Coperto medio per locale e mese dalle chiusure (filtrato per periodo se richiesto)
  let cmWhere = '1=1';
  const cmParams = [];
  if (from) { cmWhere += ' AND data >= ?'; cmParams.push(from); }
  if (to)   { cmWhere += ' AND data <= ?'; cmParams.push(to); }
  const cmQuery = db.prepare(`
    SELECT location,
           strftime('%Y-%m', data) as mese,
           ROUND(AVG(coperto_medio),2) as avg_cm
    FROM chiusure_data
    WHERE ${cmWhere}
    GROUP BY location, mese
  `).all(...cmParams);
  const cmMap = {};
  cmQuery.forEach(r => { cmMap[r.location + '|' + r.mese] = r.avg_cm; });

  // Coperti per operatore per mese (filtrato per periodo)
  let where = `categoria = 'Costo servizio'`;
  const params = [];
  if (location) { where += ' AND location = ?'; params.push(location); }
  if (from) { where += ' AND data_inizio >= ?'; params.push(from); }
  if (to)   { where += ' AND data_inizio <= ?'; params.push(to); }

  const rawOps = db.prepare(`
    SELECT operatore, location,
      CASE
        WHEN data_inizio LIKE '____-__-__' THEN substr(data_inizio, 1, 7)
        WHEN data_inizio LIKE '__/__/____' THEN substr(data_inizio, 7, 4) || '-' || substr(data_inizio, 4, 2)
        ELSE substr(data_inizio, 1, 7)
      END as mese,
      SUM(quantita) as coperti
    FROM venduto_data
    WHERE ${where}
    GROUP BY operatore, location, mese
    ORDER BY operatore, mese
  `).all(...params);

  // Aggrega per operatore: tot coperti e venduto stimato
  const byOp = {};
  const skipOps = new Set(['PIENISSIMO', 'TECNICO', 'EXTRA', 'ANDREA SALA']);
  rawOps.forEach(r => {
    if (skipOps.has(r.operatore.toUpperCase())) return;
    const key = r.operatore + '|' + r.location;
    if (!byOp[key]) byOp[key] = {
      operatore: r.operatore, location: r.location,
      coperti_gestiti: 0, venduto_stimato: 0, n_mesi: 0
    };
    const cm = cmMap[r.location + '|' + r.mese] || 0;
    byOp[key].coperti_gestiti += r.coperti;
    byOp[key].venduto_stimato += Math.round(r.coperti * cm);
    byOp[key].n_mesi++;
  });

  const merged = Object.values(byOp).map(op => {
    const quantum = op.coperti_gestiti > 0 ? op.venduto_stimato / op.coperti_gestiti : 0;

    // Cerca target dal DB
    const emp = db.prepare('SELECT id FROM employees WHERE name = ?').get(op.operatore);
    const target = emp
      ? db.prepare(`SELECT target_value FROM kpi_targets WHERE employee_id = ? AND metric = 'quantum'`).get(emp.id)
      : null;

    return {
      ...op,
      tot_importo: op.venduto_stimato,
      quantum: Math.round(quantum * 100) / 100,
      quantum_target: target ? target.target_value : null,
      media_coperti_mese: op.n_mesi > 0 ? Math.round(op.coperti_gestiti / op.n_mesi) : 0,
    };
  });

  res.json(merged.sort((a, b) => b.quantum - a.quantum));
});

// GET statistiche team per periodo
router.get('/stats', (req, res) => {
  const { location, from, to } = req.query;
  let where = '1=1';
  const params = [];
  if (location) { where += ' AND location = ?'; params.push(location); }
  if (from) { where += ' AND data >= ?'; params.push(from); }
  if (to) { where += ' AND data <= ?'; params.push(to); }

  const daily = db.prepare(`
    SELECT data, location,
      coperti, coperto_medio, scontrino_medio, totale_venduto_ipratico
    FROM chiusure_data
    WHERE ${where}
    ORDER BY data ASC
  `).all(...params);

  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', data) as mese, location,
      SUM(coperti) as tot_coperti,
      AVG(coperto_medio) as avg_coperto_medio,
      SUM(totale_venduto_ipratico) as tot_venduto,
      COUNT(*) as giorni_apertura
    FROM chiusure_data
    WHERE ${where}
    GROUP BY mese, location
    ORDER BY mese ASC
  `).all(...params);

  res.json({ daily, monthly });
});

module.exports = router;
