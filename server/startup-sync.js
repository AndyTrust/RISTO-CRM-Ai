/**
 * startup-sync.js — CRM 140 Grammi
 *
 * Legge i CSV dalle cartelle master OneDrive e li importa nel DB SQLite.
 * Chiamato automaticamente all'avvio del server.
 * Usa INSERT OR REPLACE per essere idempotente (sicuro da rieseguire).
 */

const fs   = require('fs');
const path = require('path');
const db   = require('./database');

const CRM_DATA = process.env.CRM_DATA_PATH
  || path.join(__dirname, '..', '..', '..');

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseCSV(filePath, delimiter = ',') {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''); // rimuove BOM
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;
  const headers = lines[0].split(delimiter).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(delimiter);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
    return obj;
  });
}

function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function int(v) { const n = parseInt(v);   return isNaN(n) ? 0 : n; }

// ── Sync CHIUSURE CASSA ──────────────────────────────────────────────────────

function syncChiusure() {
  const sedi = [
    { folder: 'MAMELI',        file: 'chiusure_giornaliere_MAMELI.csv',        location: 'MA' },
    { folder: 'PREDDA_NIEDDA', file: 'chiusure_giornaliere_PREDDA_NIEDDA.csv', location: 'PN' },
  ];

  let totale = 0;
  for (const { folder, file, location } of sedi) {
    const filePath = path.join(CRM_DATA, 'CHIUSURE_CASSA', folder, file);
    const rows = parseCSV(filePath, ';');
    if (!rows) { console.log(`  ⚠️  Chiusure ${location}: file non trovato → ${filePath}`); continue; }

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO chiusure_data
        (location, data, totale_venduto_dgfe, totale_venduto_ipratico,
         totale_fiscalizzato_fatture, n_doc_fiscali, coperti, coperto_medio, scontrino_medio)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let count = 0;
    for (const r of rows) {
      if (!r['Data'] || r['Data'] === 'Data') continue;
      stmt.run(
        location,
        r['Data'],
        num(r['Totale_venduto_DGFE']),
        num(r['Totale_venduto_iPratico']),
        num(r['Totale_fiscalizzato_fatture']),
        int(r['N_doc_fiscali_emessi']),
        int(r['Coperti']),
        num(r['Coperto_Medio']),
        num(r['Scontrino_medio'])
      );
      count++;
    }
    totale += count;
    console.log(`  ✅ Chiusure ${location}: ${count} righe importate`);
  }
  return totale;
}

// ── Sync VENDUTO CAMERIERI ───────────────────────────────────────────────────

function syncVenduto() {
  const sedi = [
    { folder: 'MAMELI',        location: 'MA' },
    { folder: 'PREDDA_NIEDDA', location: 'PN' },
  ];

  let totale = 0;
  for (const { folder, location } of sedi) {
    // dettaglio operatori venduto
    const fileVenduto = path.join(CRM_DATA, 'VENDUTO_CAMERIERI', folder, 'dettaglio_operatori_venduto.csv');
    const rowsV = parseCSV(fileVenduto, ',');
    if (rowsV) {
      // Svuota e reimporta (i dati hanno range date fissi per periodo)
      db.prepare(`DELETE FROM venduto_data WHERE location = ?`).run(location);
      const stmt = db.prepare(`
        INSERT INTO venduto_data
          (location, data_inizio, data_fine, operatore, categoria, prodotto, tags, quantita, importo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let count = 0;
      for (const r of rowsV) {
        if (!r['Operatore'] || r['Operatore'] === 'Operatore') continue;
        stmt.run(
          location,
          r['Data_Inizio_ISO'] || r['Data_Inizio'],
          r['Data_Fine_ISO']   || r['Data_Fine'],
          r['Operatore'],
          r['Categoria'] || '',
          r['Prodotto']  || '',
          r['Tags']      || '',
          num(r['Quantita']),
          num(r['Importo'] || r['Quantita']) // alcuni file hanno solo quantità
        );
        count++;
      }
      totale += count;
      console.log(`  ✅ Venduto ${location}: ${count} righe importate`);
    } else {
      console.log(`  ⚠️  Venduto ${location}: file non trovato`);
    }

    // varianti vendute
    const fileVar = path.join(CRM_DATA, 'VENDUTO_CAMERIERI', folder, 'employee_variations_sold.csv');
    const rowsVar = parseCSV(fileVar, ',');
    if (rowsVar) {
      db.prepare(`DELETE FROM varianti_data WHERE location = ?`).run(location);
      const stmtV = db.prepare(`
        INSERT INTO varianti_data
          (location, data_inizio, data_fine, operatore, variante,
           aggiunta_qty, aggiunta_importo, rimozione_qty, rimozione_importo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let count = 0;
      for (const r of rowsVar) {
        if (!r['Operatore'] || r['Operatore'] === 'Operatore') continue;
        stmtV.run(
          location,
          r['Data_Inizio_ISO'] || r['Data_Inizio'],
          r['Data_Fine_ISO']   || r['Data_Fine'],
          r['Operatore'],
          r['Variante'] || '',
          num(r['Aggiunta_Qty']),
          num(r['Aggiunta_Importo']),
          num(r['Rimozione_Qty']),
          num(r['Rimozione_Importo'])
        );
        count++;
      }
      totale += count;
      console.log(`  ✅ Varianti ${location}: ${count} righe importate`);
    }
  }
  return totale;
}

// ── Sync FATTURE (fornitori da cartelle) ─────────────────────────────────────

function syncFornitori() {
  const fattureDir = path.join(CRM_DATA, 'FATTURE');
  if (!fs.existsSync(fattureDir)) return 0;

  const cartelle = fs.readdirSync(fattureDir).filter(f => {
    return fs.statSync(path.join(fattureDir, f)).isDirectory();
  });

  let count = 0;
  for (const cartella of cartelle) {
    // formato: NOME_FORNITORE_IT12345678901
    const match = cartella.match(/^(.+)_(IT\d{11})$/);
    if (!match) continue;
    const nome = match[1].replace(/_/g, ' ');
    const piva = match[2];
    const nFile = fs.readdirSync(path.join(fattureDir, cartella)).filter(f =>
      f.toLowerCase().endsWith('.pdf') || f.toLowerCase().endsWith('.xml')
    ).length;

    db.prepare(`
      INSERT OR IGNORE INTO fornitori (nome, partita_iva, updated_at)
      VALUES (?, ?, datetime('now'))
    `).run(nome, piva);
    count++;
  }
  if (count > 0) console.log(`  ✅ Fornitori: ${count} aggiornati da FATTURE/`);
  return count;
}

// ── Entry point ──────────────────────────────────────────────────────────────

function runStartupSync() {
  console.log('\n📂 Sync dati da cartelle master OneDrive...');
  console.log(`   Fonte: ${CRM_DATA}\n`);

  try { syncChiusure(); }
  catch (e) { console.error('  ❌ Errore sync chiusure:', e.message); }

  try { syncVenduto(); }
  catch (e) { console.error('  ❌ Errore sync venduto:', e.message); }

  try { syncFornitori(); }
  catch (e) { /* fornitori tabella potrebbe non avere tutte le colonne — skip silenzioso */ }

  console.log('\n✅ Sync completato.\n');
}

module.exports = { runStartupSync, syncChiusure, syncVenduto };
