const express = require('express');
const router = express.Router();
const db = require('../database');

const AVATAR_COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#14b8a6'];

// GET lista dipendenti
router.get('/', (req, res) => {
  const { location, active, role } = req.query;
  let sql = 'SELECT * FROM employees WHERE 1=1';
  const params = [];
  if (location) { sql += ` AND (location = ? OR location = 'ENTRAMBI')`; params.push(location); }
  if (active !== undefined) { sql += ' AND active = ?'; params.push(active === 'true' ? 1 : 0); }
  if (role) { sql += ' AND role = ?'; params.push(role); }
  sql += ' ORDER BY active DESC, name ASC';
  const employees = db.prepare(sql).all(...params);
  res.json(employees.map(e => ({ ...e, active: !!e.active })));
});

// GET singolo dipendente con KPI
router.get('/:id', (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Dipendente non trovato' });
  const targets = db.prepare('SELECT * FROM kpi_targets WHERE employee_id = ?').all(emp.id);
  const plans = db.prepare('SELECT * FROM employee_plans WHERE employee_id = ? ORDER BY period_start DESC LIMIT 6').all(emp.id);
  res.json({ ...emp, active: !!emp.active, targets, plans });
});

// POST crea dipendente
router.post('/', (req, res) => {
  const { name, role, location, hire_date, phone, email, notes } = req.body;
  if (!name || !role || !location) return res.status(400).json({ error: 'name, role, location obbligatori' });
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const result = db.prepare(`
    INSERT INTO employees (name, role, location, hire_date, phone, email, notes, avatar_color, active)
    VALUES (?,?,?,?,?,?,?,?,1)
  `).run(name.toUpperCase(), role, location, hire_date || null, phone || null, email || null, notes || null, color);
  res.json({ id: result.lastInsertRowid, message: 'Dipendente creato' });
});

// PATCH aggiorna dipendente
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const fields = ['name','role','location','hire_date','fire_date','phone','email','notes'];
  const updates = [];
  const params = [];
  fields.forEach(f => {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  });
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare' });
  updates.push(`updated_at = datetime('now')`);
  params.push(id);
  db.prepare(`UPDATE employees SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

// PATCH toggle attivo/inattivo
router.patch('/:id/toggle', (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Non trovato' });
  const newActive = emp.active ? 0 : 1;
  const fireDate = newActive === 0 ? new Date().toISOString().split('T')[0] : null;
  db.prepare(`UPDATE employees SET active = ?, fire_date = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(newActive, fireDate, emp.id);
  res.json({ id: emp.id, active: !!newActive, fire_date: fireDate });
});

// DELETE dipendente
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET/POST target KPI per dipendente
router.get('/:id/targets', (req, res) => {
  res.json(db.prepare('SELECT * FROM kpi_targets WHERE employee_id = ?').all(req.params.id));
});

router.post('/:id/targets', (req, res) => {
  const { metric, target_value, period, notes } = req.body;
  // Verify employee exists
  const emp = db.prepare('SELECT id FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Dipendente non trovato' });
  try {
    const existing = db.prepare(`SELECT id FROM kpi_targets WHERE employee_id = ? AND metric = ? AND period = ?`)
      .get(req.params.id, metric, period || 'monthly');
    if (existing) {
      db.prepare(`UPDATE kpi_targets SET target_value = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(target_value, notes || null, existing.id);
      return res.json({ id: existing.id, updated: true });
    }
    const result = db.prepare('INSERT INTO kpi_targets (employee_id, metric, target_value, period, notes) VALUES (?,?,?,?,?)')
      .run(req.params.id, metric, target_value, period || 'monthly', notes || null);
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET/POST piani individuali
router.get('/:id/plans', (req, res) => {
  res.json(db.prepare('SELECT * FROM employee_plans WHERE employee_id = ? ORDER BY period_start DESC').all(req.params.id));
});

router.post('/:id/plans', (req, res) => {
  const b = req.body;
  const n = v => v !== undefined ? v : null;
  const result = db.prepare(`
    INSERT INTO employee_plans (employee_id, period_start, period_end, quantum_target, quantum_quorum, coperto_medio_target, coperti_target, upsell_target, notes)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(req.params.id, n(b.period_start), n(b.period_end), n(b.quantum_target), n(b.quantum_quorum), n(b.coperto_medio_target), n(b.coperti_target), n(b.upsell_target), n(b.notes));
  res.json({ id: result.lastInsertRowid });
});

module.exports = router;
