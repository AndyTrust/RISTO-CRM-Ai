const express = require('express');
const router = express.Router();
const db = require('../database');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const DATA_PATH = process.env.CRM_DATA_PATH ||
  path.join(require('os').homedir(), 'Library/CloudStorage/OneDrive-Personale/CRM 140Grammi');

function resolvePath(...parts) {
  return path.join(DATA_PATH, ...parts);
}

function syncChiusure(location, filename) {
  const filePath = resolvePath('CHIUSURE_CASSA', location, filename);
  if (!fs.existsSync(filePath)) return { skipped: true, reason: `File non trovato: ${filePath}` };

  const content = fs.readFileSync(filePath, 'utf-8');
  const records = parse(content, { delimiter: ';', columns: true, skip_empty_lines: true });

  const upsert = db.prepare(`
    INSERT INTO chiusure_data (location, data, totale_venduto_dgfe, totale_venduto_ipratico,
      totale_fiscalizzato_fatture, n_doc_fiscali, coperti, coperto_medio, scontrino_medio)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(location, data) DO UPDATE SET
      totale_venduto_dgfe = excluded.totale_venduto_dgfe,
      totale_venduto_ipratico = excluded.totale_venduto_ipratico,
      totale_fiscalizzato_fatture = excluded.totale_fiscalizzato_fatture,
      n_doc_fiscali = excluded.n_doc_fiscali,
      coperti = excluded.coperti,
      coperto_medio = excluded.coperto_medio,
      scontrino_medio = excluded.scontrino_medio,
      synced_at = datetime('now')
  `);

  const tx = db.transaction(() => {
    let count = 0;
    records.forEach(r => {
      const data = r['Data'] || r['data'];
      if (!data || data === 'Data') return;
      upsert.run(
        location, data,
        parseFloat(r['Totale_venduto_DGFE'] || 0),
        parseFloat(r['Totale_venduto_iPratico'] || 0),
        parseFloat(r['Totale_fiscalizzato_fatture'] || 0),
        parseInt(r['N_doc_fiscali_emessi'] || 0),
        parseInt(r['Coperti'] || 0),
        parseFloat(r['Coperto_Medio'] || 0),
        parseFloat(r['Scontrino_medio'] || 0)
      );
      count++;
    });
    return count;
  });

  const count = tx();
  return { synced: count, location };
}

function syncVenduto(location, subfolder) {
  const vendutoPath = resolvePath('VENDUTO_CAMERIERI', subfolder, 'dettaglio_operatori_venduto.csv');
  const variantiPath = resolvePath('VENDUTO_CAMERIERI', subfolder, 'employee_variations_sold.csv');

  let vendutoCount = 0, variantiCount = 0;

  if (fs.existsSync(vendutoPath)) {
    const content = fs.readFileSync(vendutoPath, 'utf-8').replace(/^\uFEFF/, '');
    const records = parse(content, { columns: true, skip_empty_lines: true });

    db.prepare('DELETE FROM venduto_data WHERE location = ?').run(location);
    const insert = db.prepare(`
      INSERT INTO venduto_data (location, data_inizio, data_fine, operatore, categoria, prodotto, tags, quantita, importo)
      VALUES (?,?,?,?,?,?,?,?,?)
    `);
    const tx = db.transaction(() => {
      records.forEach(r => {
        insert.run(
          location,
          r['Data_Inizio'] || r['Data_Inizio_ISO'],
          r['Data_Fine'] || r['Data_Fine_ISO'],
          (r['Operatore'] || '').toUpperCase(),
          r['Categoria'] || '',
          r['Prodotto'] || '',
          r['Tags'] || '',
          parseFloat(r['Quantita'] || 0),
          parseFloat(r['Importo'] || 0)
        );
        vendutoCount++;
      });
    });
    tx();
  }

  if (fs.existsSync(variantiPath)) {
    const content = fs.readFileSync(variantiPath, 'utf-8').replace(/^\uFEFF/, '');
    const records = parse(content, { columns: true, skip_empty_lines: true });

    db.prepare('DELETE FROM varianti_data WHERE location = ?').run(location);
    const insert = db.prepare(`
      INSERT INTO varianti_data (location, data_inizio, data_fine, operatore, variante, aggiunta_qty, aggiunta_importo, rimozione_qty, rimozione_importo)
      VALUES (?,?,?,?,?,?,?,?,?)
    `);
    const tx = db.transaction(() => {
      records.forEach(r => {
        insert.run(
          location,
          r['Data_Inizio'] || r['Data_Inizio_ISO'],
          r['Data_Fine'] || r['Data_Fine_ISO'],
          (r['Operatore'] || '').toUpperCase(),
          r['Variante'] || '',
          parseFloat(r['Aggiunta_Qty'] || 0),
          parseFloat(r['Aggiunta_Importo'] || 0),
          parseFloat(r['Rimozione_Qty'] || 0),
          parseFloat(r['Rimozione_Importo'] || 0)
        );
        variantiCount++;
      });
    });
    tx();
  }

  return { vendutoCount, variantiCount, location };
}

// POST sincronizza tutti i dati CSV
router.post('/sync', (req, res) => {
  const results = [];
  try {
    results.push(syncChiusure('MAMELI', 'chiusure_giornaliere_MAMELI.csv'));
    results.push(syncChiusure('PREDDA_NIEDDA', 'chiusure_giornaliere_PREDDA_NIEDDA.csv'));
    results.push(syncVenduto('MAMELI', 'MAMELI'));
    results.push(syncVenduto('PREDDA_NIEDDA', 'PREDDA_NIEDDA'));

    // Auto-crea dipendenti dal venduto se non esistono
    const operatori = db.prepare('SELECT DISTINCT operatore, location FROM venduto_data').all();
    const insertEmp = db.prepare(`
      INSERT OR IGNORE INTO employees (name, role, location, active, avatar_color)
      SELECT ?, 'Cameriere', ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM employees WHERE name = ?)
    `);
    const colors = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#14b8a6'];
    let newEmps = 0;
    operatori.forEach((op, i) => {
      const r = insertEmp.run(op.operatore, op.location, colors[i % colors.length], op.operatore);
      if (r.changes) newEmps++;
    });

    res.json({ success: true, results, newEmployees: newEmps, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message, results });
  }
});

// GET stato sincronizzazione
router.get('/status', (req, res) => {
  const venduto = db.prepare('SELECT location, COUNT(*) as righe, MAX(synced_at) as ultimo FROM venduto_data GROUP BY location').all();
  const chiusure = db.prepare('SELECT location, COUNT(*) as giorni, MAX(data) as ultima_data, MAX(synced_at) as synced FROM chiusure_data GROUP BY location').all();
  const varianti = db.prepare('SELECT location, COUNT(*) as righe, MAX(synced_at) as ultimo FROM varianti_data GROUP BY location').all();
  const dataPathExists = fs.existsSync(DATA_PATH);
  res.json({ dataPath: DATA_PATH, dataPathExists, venduto, chiusure, varianti });
});

// GET percorsi configurati
router.get('/paths', (req, res) => {
  res.json({ dataPath: DATA_PATH, exists: fs.existsSync(DATA_PATH) });
});

module.exports = router;
