const express = require('express');
const router = express.Router();
const db = require('../database');

// GET tutti i moduli
router.get('/', (req, res) => {
  const modules = db.prepare('SELECT * FROM modules ORDER BY sort_order').all();
  res.json(modules.map(m => ({ ...m, config: JSON.parse(m.config || '{}'), enabled: !!m.enabled })));
});

// PATCH toggle modulo on/off
router.patch('/:id/toggle', (req, res) => {
  const { id } = req.params;
  const mod = db.prepare('SELECT * FROM modules WHERE id = ?').get(id);
  if (!mod) return res.status(404).json({ error: 'Modulo non trovato' });
  db.prepare(`UPDATE modules SET enabled = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(mod.enabled ? 0 : 1, id);
  res.json({ id, enabled: !mod.enabled });
});

// PATCH aggiorna config modulo
router.patch('/:id/config', (req, res) => {
  const { id } = req.params;
  const { config } = req.body;
  db.prepare(`UPDATE modules SET config = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(config), id);
  res.json({ success: true });
});

// PATCH aggiorna sort order
router.patch('/reorder', (req, res) => {
  const { order } = req.body; // array of { id, sort_order }
  const update = db.prepare('UPDATE modules SET sort_order = ? WHERE id = ?');
  const tx = db.transaction(() => order.forEach(m => update.run(m.sort_order, m.id)));
  tx();
  res.json({ success: true });
});

module.exports = router;
