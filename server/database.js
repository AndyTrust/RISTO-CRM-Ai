/**
 * database.js — CRM 140 Grammi
 *
 * Usa node-sqlite3-wasm (puro WebAssembly, zero dipendenze native).
 * Espone un'API compatibile con better-sqlite3 così tutti i route
 * file funzionano senza modifiche.
 */

const { Database: _SQLite } = require('node-sqlite3-wasm');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Il DB vive in ~/Library/Application Support/CRM140Grammi/  (Mac standard)
// o nella cartella data/ del progetto se definito da env.
const DB_DIR = process.env.CRM_DB_PATH
  ? path.dirname(process.env.CRM_DB_PATH)
  : os.platform() === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'CRM140Grammi')
    : path.join(os.homedir(), '.crm140grammi');

const DB_PATH = process.env.CRM_DB_PATH
  || path.join(DB_DIR, 'crm140.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const _db = new _SQLite(DB_PATH);

// ── Better-sqlite3 compatibility layer ─────────────────────────────────────
// Permette di usare: db.prepare(sql).all(...params)
//                    db.prepare(sql).get(...params)
//                    db.prepare(sql).run(...params)
//                    db.exec(sql)
//                    db.pragma(str)
//                    db.transaction(fn)  → restituisce funzione

const db = {
  prepare: (sql) => ({
    all: (...args) => {
      const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args
      return _db.all(sql, params)
    },
    get: (...args) => {
      const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args
      return _db.get(sql, params)
    },
    run: (...args) => {
      const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args
      return _db.run(sql, params)
    },
  }),
  exec: (sql) => _db.exec(sql),
  pragma: (str) => { try { _db.exec(`PRAGMA ${str}`) } catch(_) {} },
  transaction: (fn) => () => {
    _db.exec('BEGIN')
    try {
      const result = fn()
      _db.exec('COMMIT')
      return result
    } catch (e) {
      try { _db.exec('ROLLBACK') } catch (_) {}
      throw e
    }
  },
}

// ── Performance settings ────────────────────────────────────────────────────
// Nota: WAL è gestito internamente da node-sqlite3-wasm
db.pragma('foreign_keys = ON')

// ── Schema ──────────────────────────────────────────────────────────────────
function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      enabled INTEGER DEFAULT 1,
      config TEXT DEFAULT '{}',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      location TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      hire_date TEXT,
      fire_date TEXT,
      phone TEXT,
      email TEXT,
      notes TEXT,
      avatar_color TEXT DEFAULT '#6366f1',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kpi_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
      metric TEXT NOT NULL,
      target_value REAL NOT NULL,
      period TEXT DEFAULT 'monthly',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS employee_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      quantum_target REAL,
      quantum_quorum REAL,
      coperto_medio_target REAL,
      coperti_target INTEGER,
      upsell_target REAL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT DEFAULT 'Nuova conversazione',
      model TEXT DEFAULT 'claude-sonnet-4-6',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      artifact_type TEXT,
      artifact_content TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS venduto_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location TEXT NOT NULL,
      data_inizio TEXT,
      data_fine TEXT,
      operatore TEXT NOT NULL,
      categoria TEXT,
      prodotto TEXT,
      tags TEXT,
      quantita REAL DEFAULT 0,
      importo REAL DEFAULT 0,
      synced_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chiusure_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location TEXT NOT NULL,
      data TEXT NOT NULL,
      totale_venduto_dgfe REAL DEFAULT 0,
      totale_venduto_ipratico REAL DEFAULT 0,
      totale_fiscalizzato_fatture REAL DEFAULT 0,
      n_doc_fiscali INTEGER DEFAULT 0,
      coperti INTEGER DEFAULT 0,
      coperto_medio REAL DEFAULT 0,
      scontrino_medio REAL DEFAULT 0,
      synced_at TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_chiusure_loc_data ON chiusure_data(location, data);

    CREATE TABLE IF NOT EXISTS varianti_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location TEXT NOT NULL,
      data_inizio TEXT,
      data_fine TEXT,
      operatore TEXT NOT NULL,
      variante TEXT,
      aggiunta_qty REAL DEFAULT 0,
      aggiunta_importo REAL DEFAULT 0,
      rimozione_qty REAL DEFAULT 0,
      rimozione_importo REAL DEFAULT 0,
      synced_at TEXT DEFAULT (datetime('now'))
    );

    -- ═══ BUSTE PAGA ═══
    CREATE TABLE IF NOT EXISTS buste_paga (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_name TEXT NOT NULL,
      employee_id INTEGER REFERENCES employees(id),
      anno INTEGER NOT NULL,
      mese INTEGER NOT NULL,
      mese_label TEXT,
      netto REAL DEFAULT 0,
      costo_azienda REAL DEFAULT 0,
      file_path TEXT,
      file_name TEXT,
      location TEXT,
      synced_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_buste_emp_periodo ON buste_paga(employee_name, anno, mese);

    -- ═══ PERMANENZA TAVOLI (STATISTICHE) ═══
    CREATE TABLE IF NOT EXISTS permanenza_tavoli (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL,
      location TEXT NOT NULL,
      nome_stanza TEXT,
      tavolo TEXT,
      operatore TEXT,
      coperti INTEGER DEFAULT 0,
      totale REAL DEFAULT 0,
      permanenza_minuti INTEGER DEFAULT 0,
      permanenza_label TEXT,
      cliente TEXT,
      fascia_oraria TEXT,
      ora_chiusura TEXT,
      synced_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_perm_data_loc ON permanenza_tavoli(data, location);

    -- ═══ TURNI ═══
    CREATE TABLE IF NOT EXISTS turni (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_name TEXT NOT NULL,
      employee_id INTEGER REFERENCES employees(id),
      location TEXT NOT NULL,
      data TEXT NOT NULL,
      turno TEXT,
      ora_inizio TEXT,
      ora_fine TEXT,
      ore_lavorate REAL DEFAULT 0,
      ruolo TEXT,
      note TEXT,
      synced_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_turni_emp_data ON turni(employee_name, location, data);

    CREATE TABLE IF NOT EXISTS fornitori_gruppi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      colore TEXT DEFAULT '#6366f1',
      descrizione TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fornitori (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      partita_iva TEXT,
      gruppo_id INTEGER REFERENCES fornitori_gruppi(id),
      attivo INTEGER DEFAULT 1,
      email TEXT,
      telefono TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fatture_costi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fornitore_id INTEGER REFERENCES fornitori(id),
      fornitore_nome TEXT,
      partita_iva TEXT,
      data_fattura TEXT,
      numero_fattura TEXT,
      imponibile REAL DEFAULT 0,
      iva REAL DEFAULT 0,
      totale REAL DEFAULT 0,
      location TEXT DEFAULT 'GENERALE',
      gruppo_id INTEGER REFERENCES fornitori_gruppi(id),
      file_path TEXT,
      note TEXT,
      synced_at TEXT DEFAULT (datetime('now'))
    );
  `)

  // Seed moduli di default (solo se vuoto)
  const modulesExist = db.prepare('SELECT COUNT(*) as c FROM modules').get()
  if (modulesExist.c === 0) {
    const insertModule = db.prepare(
      `INSERT OR IGNORE INTO modules (id, name, description, icon, enabled, sort_order) VALUES (?,?,?,?,?,?)`
    )
    const defaultModules = [
      ['dashboard',     'Dashboard',        'Panoramica KPI e statistiche generali',         '📊', 1, 1],
      ['dipendenti',    'Dipendenti',        'Schede dipendenti, assunzioni, stato attivo',    '👥', 1, 2],
      ['kpi_camerieri', 'KPI Camerieri',     'Quantum, quorum, target individuali e team',     '🎯', 1, 3],
      ['venduto',       'Analisi Venduto',   'Dettaglio venduto per operatore e categoria',    '📈', 1, 4],
      ['chiusure',      'Chiusure Cassa',    'Report giornalieri Mameli e Predda Niedda',      '💰', 1, 5],
      ['fornitori',     'Fornitori & Costi', 'Spese generali, fatture fornitori, per gruppo',  '🏭', 1, 6],
      ['buste_paga',    'Buste Paga',        'Cedolini, costo aziendale, stato dipendenti',     '💼', 1, 7],
      ['statistiche',   'Statistiche Sala',  'Permanenza tavoli, fasce orarie, analisi sala',   '🍽️', 1, 8],
      ['turni',         'Turni',             'Pianificazione turni Mameli e Predda Niedda',     '📅', 1, 9],
      ['analytics_bi',  'Analytics & BI',    'Previsioni, stagionalità, target smart operatori','📡', 1, 10],
      ['chat_claude',   'Chat Claude AI',    'Assistente AI con accesso ai tuoi dati',         '🤖', 1, 11],
      ['impostazioni',  'Impostazioni',      'Configurazione moduli, API key, import dati',    '⚙️', 1, 12],
    ]
    defaultModules.forEach(m => insertModule.run(...m))
  }

  // Seed gruppi fornitori (solo se vuoti)
  const gruppiExist = db.prepare('SELECT COUNT(*) as c FROM fornitori_gruppi').get()
  if (gruppiExist.c === 0) {
    const ins = db.prepare('INSERT OR IGNORE INTO fornitori_gruppi (nome, colore, descrizione) VALUES (?,?,?)')
    ;[
      ['Bevande & Alcolici',     '#3b82f6', 'Birre, vini, spirits, bevande analcoliche'],
      ['Alimentari & Cucina',    '#10b981', 'Materie prime, carni, pesce, verdure, latticini'],
      ['Pulizia & Igiene',       '#f59e0b', 'Detergenti, materiali pulizia, DPI'],
      ['Utenze & Servizi',       '#6366f1', 'Energia, gas, acqua, internet, telefonia'],
      ['Attrezzature',           '#8b5cf6', 'Macchinari, utensili, arredi'],
      ['Packaging & Monouso',    '#ec4899', 'Contenitori, tovaglioli, posate monouso'],
      ['Manutenzione',           '#ef4444', 'Riparazioni, assistenza tecnica'],
      ['Personale & Consulenze', '#14b8a6', 'Agenzie, commercialista, consulenti'],
      ['Altro',                  '#94a3b8', 'Spese varie non classificate'],
    ].forEach(g => ins.run(...g))
  }

  console.log('✅ Database inizializzato:', DB_PATH)
}

initDB()

module.exports = db
