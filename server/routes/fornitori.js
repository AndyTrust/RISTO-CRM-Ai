const express = require('express');
const router = express.Router();
const db = require('../database');

// Tabelle e seed già gestiti in database.js

// === GRUPPI ===
router.get('/gruppi', (req, res) => {
  const gruppi = db.prepare(`
    SELECT g.*, COUNT(f.id) as n_fornitori,
      ROUND(SUM(fc.totale),2) as tot_spesa
    FROM fornitori_gruppi g
    LEFT JOIN fornitori f ON f.gruppo_id = g.id
    LEFT JOIN fatture_costi fc ON fc.gruppo_id = g.id
    GROUP BY g.id
    ORDER BY g.nome
  `).all();
  res.json(gruppi);
});

router.post('/gruppi', (req, res) => {
  const { nome, colore, descrizione } = req.body;
  const r = db.prepare('INSERT INTO fornitori_gruppi (nome, colore, descrizione) VALUES (?,?,?)').run(nome, colore || '#6366f1', descrizione || null);
  res.json({ id: r.lastInsertRowid });
});

router.patch('/gruppi/:id', (req, res) => {
  const { nome, colore, descrizione } = req.body;
  db.prepare('UPDATE fornitori_gruppi SET nome=?, colore=?, descrizione=? WHERE id=?').run(nome, colore, descrizione, req.params.id);
  res.json({ success: true });
});

// === FORNITORI ===
router.get('/', (req, res) => {
  const { gruppo_id, attivo } = req.query;
  let where = '1=1';
  const params = [];
  if (gruppo_id) { where += ' AND f.gruppo_id = ?'; params.push(gruppo_id); }
  if (attivo !== undefined) { where += ' AND f.attivo = ?'; params.push(attivo === 'true' ? 1 : 0); }
  const fornitori = db.prepare(`
    SELECT f.*, g.nome as gruppo_nome, g.colore as gruppo_colore,
      ROUND(SUM(fc.totale),2) as tot_spesa,
      COUNT(fc.id) as n_fatture,
      MAX(fc.data_fattura) as ultima_fattura
    FROM fornitori f
    LEFT JOIN fornitori_gruppi g ON g.id = f.gruppo_id
    LEFT JOIN fatture_costi fc ON fc.fornitore_id = f.id
    WHERE ${where}
    GROUP BY f.id
    ORDER BY f.nome
  `).all(...params);
  res.json(fornitori.map(f => ({ ...f, attivo: !!f.attivo })));
});

router.post('/', (req, res) => {
  const { nome, partita_iva, gruppo_id, email, telefono, note } = req.body;
  const r = db.prepare('INSERT INTO fornitori (nome, partita_iva, gruppo_id, email, telefono, note) VALUES (?,?,?,?,?,?)')
    .run(nome, partita_iva || null, gruppo_id || null, email || null, telefono || null, note || null);
  res.json({ id: r.lastInsertRowid });
});

router.patch('/:id', (req, res) => {
  const fields = ['nome','partita_iva','gruppo_id','attivo','email','telefono','note'];
  const updates = []; const params = [];
  fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f}=?`); params.push(req.body[f]); } });
  updates.push(`updated_at=datetime('now')`); params.push(req.params.id);
  db.prepare(`UPDATE fornitori SET ${updates.join(',')} WHERE id=?`).run(...params);
  res.json({ success: true });
});

// === FATTURE COSTI ===
router.get('/fatture', (req, res) => {
  const { gruppo_id, fornitore_id, location, from, to, limit = 100 } = req.query;
  let where = '1=1'; const params = [];
  if (gruppo_id) { where += ' AND fc.gruppo_id=?'; params.push(gruppo_id); }
  if (fornitore_id) { where += ' AND fc.fornitore_id=?'; params.push(fornitore_id); }
  if (location) { where += ' AND fc.location=?'; params.push(location); }
  if (from) { where += ' AND fc.data_fattura>=?'; params.push(from); }
  if (to) { where += ' AND fc.data_fattura<=?'; params.push(to); }
  params.push(parseInt(limit));
  const fatture = db.prepare(`
    SELECT fc.*, g.nome as gruppo_nome, g.colore as gruppo_colore
    FROM fatture_costi fc
    LEFT JOIN fornitori_gruppi g ON g.id = fc.gruppo_id
    WHERE ${where}
    ORDER BY fc.data_fattura DESC
    LIMIT ?
  `).all(...params);
  res.json(fatture);
});

// GET analisi spese per gruppo e periodo
router.get('/analisi', (req, res) => {
  const { from, to, location } = req.query;
  let where = '1=1'; const params = [];
  if (from) { where += ' AND data_fattura>=?'; params.push(from); }
  if (to) { where += ' AND data_fattura<=?'; params.push(to); }
  if (location) { where += ' AND location=?'; params.push(location); }

  const perGruppo = db.prepare(`
    SELECT g.nome, g.colore,
      ROUND(SUM(fc.totale),2) as tot_spesa,
      ROUND(SUM(fc.imponibile),2) as tot_imponibile,
      COUNT(fc.id) as n_fatture
    FROM fatture_costi fc
    LEFT JOIN fornitori_gruppi g ON g.id = fc.gruppo_id
    WHERE ${where}
    GROUP BY g.id
    ORDER BY tot_spesa DESC
  `).all(...params);

  const mensile = db.prepare(`
    SELECT strftime('%Y-%m', data_fattura) as mese,
      ROUND(SUM(totale),2) as tot_spesa,
      COUNT(*) as n_fatture
    FROM fatture_costi
    WHERE ${where}
    GROUP BY mese
    ORDER BY mese ASC
  `).all(...params);

  res.json({ perGruppo, mensile });
});

module.exports = router;
