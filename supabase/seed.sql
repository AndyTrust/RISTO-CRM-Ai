-- ═══════════════════════════════════════════════════════════════════════════
-- RISTO CRM — Default Seed Data
-- Run AFTER schema.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Invoice Categories (Italian restaurant standard) ─────────────────────
INSERT INTO fattura_categorie (tipo, nome, descrizione) VALUES
  ('FOOD',          'Cibo & Materie Prime',  'Fornitori alimentari, materie prime'),
  ('BEVERAGE',      'Bevande',               'Vini, birre, acque, bevande'),
  ('UTILITIES',     'Utenze',                'Luce, gas, acqua'),
  ('TELEFONIA',     'Telefonia',             'Telefono, internet, connettività'),
  ('CARBURANTE',    'Carburante',            'Gasolio, benzina, GPL'),
  ('NOLEGGIO',      'Noleggio',              'Noleggio attrezzature, veicoli'),
  ('AFFITTO',       'Affitto',               'Canoni di locazione'),
  ('ASSICURAZIONE', 'Assicurazioni',         'Polizze assicurative'),
  ('LEASING',       'Leasing',               'Canoni leasing'),
  ('DELIVERY',      'Delivery',              'Commissioni piattaforme delivery'),
  ('TICKET_BUONI',  'Ticket & Buoni',        'Ticket restaurant, buoni pasto'),
  ('PAGAMENTI',     'Pagamenti Digitali',    'POS, commissioni carte'),
  ('MANUTENZIONE',  'Manutenzione',          'Riparazioni, manutenzioni'),
  ('PULIZIE',       'Pulizie',               'Servizi pulizia, derattizzazione'),
  ('SERVIZI',       'Servizi',               'Servizi generali esternalizzati'),
  ('CONSULENZA',    'Consulenze',            'Commercialista, consulenti'),
  ('MARKETING',     'Marketing',             'Pubblicità, social, grafica'),
  ('TECH_IT',       'Tech & IT',             'Hardware, IT, software'),
  ('SOFTWARE',      'Software',              'Licenze software, SaaS'),
  ('ATTREZZATURE',  'Attrezzature',          'Acquisto attrezzature'),
  ('PACKAGING',     'Packaging',             'Imballaggi, buste, contenitori'),
  ('TRASPORTI',     'Trasporti',             'Spedizioni, corrieri'),
  ('TASSE',         'Tasse & Imposte',       'IMU, TARI, imposte varie'),
  ('ALTRO',         'Altro',                 'Spese non categorizzate')
ON CONFLICT (tipo) DO NOTHING;

-- ─── National Standards (Italian restaurant benchmarks) ──────────────────
INSERT INTO standard_nazionali (categoria, pct_min, pct_max, pct_ideale, fonte) VALUES
  ('FOOD_COST',     25, 32, 28, 'FIPE / NRA benchmark'),
  ('BEVERAGE_COST', 18, 28, 22, 'FIPE / NRA benchmark'),
  ('PERSONALE',     28, 38, 32, 'FIPE / Confindustria benchmark'),
  ('AFFITTO',        5, 12,  8, 'FIPE benchmark'),
  ('UTILITIES',      3,  6,  4, 'FIPE benchmark'),
  ('MARKETING',      2,  5,  3, 'Industry benchmark'),
  ('MANUTENZIONE',   1,  3,  2, 'Industry benchmark')
ON CONFLICT (categoria) DO NOTHING;

-- ─── Default Modules ─────────────────────────────────────────────────────
INSERT INTO modules (id, name, description, icon, enabled) VALUES
  ('dashboard',     'Dashboard',         'Panoramica generale KPI e chiusure',    '📊', true),
  ('chiusure',      'Chiusure Cassa',    'Chiusure giornaliere per sede',          '💰', true),
  ('venduto',       'Venduto + KPI',     'Dettaglio venduto e KPI camerieri',      '📈', true),
  ('kpi_camerieri', 'KPI Camerieri',     'Analisi performance camerieri',          '🎯', true),
  ('dipendenti',    'Dipendenti',        'Gestione anagrafica dipendenti',         '👥', true),
  ('turni',         'Turni',             'Pianificazione turni settimanali',       '📅', true),
  ('buste_paga',    'Buste Paga',        'Cedolini e costi del personale',         '💼', true),
  ('statistiche',   'Statistiche Sala',  'Fasce orarie, tavoli e operatori',       '📉', true),
  ('fornitori',     'Fornitori & Costi', 'Gestione fornitori e fatture acquisto',  '🏭', true),
  ('analytics_bi',  'Analytics & BI',   'Business intelligence e previsioni',     '🧠', true),
  ('chat_claude',   'Chat AI',           'Assistente Claude AI integrato',         '🤖', true),
  ('impostazioni',  'Impostazioni',      'Configurazione CRM',                     '⚙️', true)
ON CONFLICT (id) DO NOTHING;

-- ─── CRM Config: mark setup as NOT completed (wizard will run) ───────────
INSERT INTO crm_config (key, value) VALUES
  ('setup_completed', 'false'::jsonb),
  ('version', '"2.0"'::jsonb)
ON CONFLICT (key) DO NOTHING;
