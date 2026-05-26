-- ═══════════════════════════════════════════════════════════════════════════
-- RISTO CRM — Database Schema
-- Version: 2.0
-- Compatible with: Supabase (PostgreSQL 15+)
--
-- INSTRUCTIONS:
--   1. Create a free project at https://supabase.com
--   2. Go to SQL Editor → New query → paste this file → Run
--   3. Then run supabase/seed.sql for default categories and data
--   4. Copy .env.example → .env.local and fill in your Supabase URL + anon key
--
-- MULTI-SEDE:
--   Replace 'S1', 'S2' etc with your own sede codes (e.g. 'MI', 'RM', 'NA').
--   Sede codes are free text — no hardcoded constraint. Set them in SetupWizard.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── SEDI (Locations) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sedi (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  city        text,
  color       text DEFAULT '#6366f1',
  active      boolean DEFAULT true,
  config      jsonb DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);

-- ─── MODULES ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modules (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text DEFAULT '',
  enabled     boolean DEFAULT true,
  icon        text DEFAULT '📦',
  updated_at  timestamptz DEFAULT now()
);

-- ─── CRM CONFIG (key-value store) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_config (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz DEFAULT now()
);

-- ─── CRM MEMORY (Claude AI context) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_memory (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sezione     text NOT NULL,
  chiave      text NOT NULL,
  valore      text,
  valore_json jsonb,
  fonte       text DEFAULT 'chat',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (sezione, chiave)
);

-- ─── ROLES ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text NOT NULL,
  description text,
  color       text DEFAULT '#6366f1',
  active      boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- ─── REPARTI (Departments) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reparti (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome        text NOT NULL,
  colore      text DEFAULT '#6366f1',
  sede        text,
  attivo      boolean DEFAULT true,
  ordine      integer DEFAULT 0,
  ruoli       text[] DEFAULT '{}',
  icona       text DEFAULT '👥',
  note        text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ─── EMPLOYEES ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code                  text NOT NULL,
  sede                  text NOT NULL,
  name                  text NOT NULL,
  role                  text,
  active                boolean DEFAULT true,
  created_at            timestamptz DEFAULT now(),
  cost_split            jsonb,
  sede_precedente       text,
  note                  text,
  reparto_id            uuid REFERENCES reparti(id),
  sede_split_ma         integer DEFAULT 100,
  buste_paga_name       text,
  ore_contratto         integer DEFAULT 0,
  ore_settimanali       integer DEFAULT 0,
  hire_date             date,
  partecipa_kpi_target  boolean DEFAULT false,
  ruolo_servizio        text,
  ral                   numeric
);

-- ─── EMPLOYEE → OPERATOR MAPPING ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_operator_mapping (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id     uuid REFERENCES employees(id),
  op_name_ipratico text NOT NULL,
  sede            text NOT NULL,
  buste_paga_name text,
  note            text,
  verified        boolean DEFAULT false,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (op_name_ipratico, sede)
);

-- ─── EMPLOYEE REGOLE ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_regole (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id           uuid REFERENCES employees(id),
  ore_contratto_mensili integer DEFAULT 0,
  ore_settimanali       integer DEFAULT 0,
  turni_min_settimana   integer DEFAULT 0,
  turni_max_settimana   integer DEFAULT 7,
  giorni_riposo_min     integer DEFAULT 1,
  turni_preferiti       text[] DEFAULT '{}',
  note                  text,
  updated_at            timestamptz DEFAULT now()
);

-- ─── CHIUSURE CASSA (Daily Closings) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chiusure_giornaliere (
  id                            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sede                          text NOT NULL,
  data                          date NOT NULL,
  totale_venduto_dgfe           numeric,
  totale_venduto_ipratico       numeric,
  totale_fiscalizzato_fatture   numeric,
  n_doc_fiscali_emessi          integer,
  coperti                       integer,
  coperto_medio                 numeric,
  scontrino_medio               numeric,
  created_at                    timestamptz DEFAULT now(),
  updated_at                    timestamptz DEFAULT now(),
  chiusura_anticipata           boolean DEFAULT false,
  note                          text,
  UNIQUE (sede, data)
);

-- ─── VENDUTO CAMERIERI (Waiter Sales) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS venduto_camerieri (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sede            text NOT NULL,
  data_inizio     date NOT NULL,
  data_fine       date NOT NULL,
  operatore       text NOT NULL,
  categoria       text,
  prodotto        text NOT NULL,
  tags            text,
  quantita        numeric,
  created_at      timestamptz DEFAULT now(),
  totale          numeric,
  prezzo_unitario numeric
);

-- ─── VARIANTI CAMERIERI ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS varianti_camerieri (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sede              text NOT NULL,
  data_inizio       date NOT NULL,
  data_fine         date NOT NULL,
  operatore         text NOT NULL,
  variante          text NOT NULL,
  aggiunta_qty      numeric,
  aggiunta_importo  numeric,
  rimozione_qty     numeric,
  rimozione_importo numeric,
  created_at        timestamptz DEFAULT now()
);

-- ─── KPI ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_revenues (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sede          text NOT NULL,
  period        text NOT NULL,
  op            text NOT NULL,
  totale        numeric,
  coperti       integer,
  coperto_medio numeric,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (sede, period, op)
);

CREATE TABLE IF NOT EXISTS kpi_operators (
  id     uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code   text NOT NULL,
  sede   text NOT NULL,
  name   text,
  active boolean DEFAULT true,
  UNIQUE (code, sede)
);

CREATE TABLE IF NOT EXISTS kpi_targets (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  operator_code         text NOT NULL,
  operator_name         text,
  sede                  text NOT NULL,
  period                text NOT NULL,
  quantum_target        numeric,
  quorum                numeric,
  coperto_medio_target  numeric,
  coperti_target        integer,
  notes                 text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  aggiunta_quorum       numeric,
  aggiunta_quantum      numeric,
  scontrino_medio_min   numeric,
  scontrino_medio_max   numeric,
  piatti_min            numeric,
  piatti_max            numeric,
  bibite_min            numeric,
  bibite_max            numeric,
  UNIQUE (operator_code, sede, period)
);

CREATE TABLE IF NOT EXISTS kpi_venduto_totale (
  id     uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sede   text NOT NULL,
  period text NOT NULL,
  data   jsonb,
  UNIQUE (sede, period)
);

-- ─── KPI TARGETS (Team, Individual, Products) ────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_targets_team (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sede              text NOT NULL,
  anno              integer NOT NULL,
  mese              integer NOT NULL,
  be_totale         numeric DEFAULT 0,
  target_fatturato  numeric DEFAULT 0,
  premio_team_euro  numeric DEFAULT 0,
  pct_cucina        numeric DEFAULT 50,
  pct_sala          numeric DEFAULT 50,
  coeff_stagionale  numeric DEFAULT 1.000,
  stato             text DEFAULT 'ATTIVO',
  note              text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (sede, anno, mese)
);

CREATE TABLE IF NOT EXISTS kpi_targets_individuale (
  id                      uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id             uuid REFERENCES employees(id),
  sede                    text NOT NULL,
  anno                    integer NOT NULL,
  mese                    integer NOT NULL,
  metrica                 text DEFAULT 'VENDUTO_TURNO',
  quantum                 numeric DEFAULT 0,
  target                  numeric DEFAULT 0,
  premio_max_euro         numeric DEFAULT 0,
  mese_precedente_valore  numeric,
  note                    text,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now(),
  quorum                  numeric
);

CREATE TABLE IF NOT EXISTS kpi_targets_prodotti (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sede                text NOT NULL,
  anno                integer NOT NULL,
  mese                integer NOT NULL,
  prodotto_nome       text NOT NULL,
  reparto             text,
  categoria           text,
  pezzi_precedente    integer DEFAULT 0,
  pezzi_target        integer DEFAULT 0,
  valore_unitario     numeric DEFAULT 0,
  note                text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS obiettivi_prodotto (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sede          text NOT NULL,
  anno          integer NOT NULL,
  mese          integer NOT NULL,
  prodotto      text NOT NULL,
  categoria     text,
  pezzi_base    numeric,
  pezzi_target  numeric NOT NULL,
  premio_euro   numeric DEFAULT 0,
  reparto       text,
  note          text,
  active        boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (sede, anno, mese, prodotto)
);

CREATE TABLE IF NOT EXISTS target_venduto_operatori (
  id                      uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sede                    text NOT NULL,
  operatore               text NOT NULL,
  anno                    integer NOT NULL,
  mese                    integer NOT NULL,
  target_pezzi            numeric,
  target_pezzi_valorizzati numeric,
  note                    text,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

-- ─── BUSTE PAGA (Payslips) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buste_paga (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_code       text,
  employee_name       text NOT NULL,
  sede                text,
  anno                integer NOT NULL,
  mese                integer NOT NULL,
  netto               numeric DEFAULT 0,
  file_name           text,
  note                text,
  created_at          timestamptz DEFAULT now(),
  employee_id         uuid REFERENCES employees(id),
  percentuale_pt      numeric,
  ore_mensili         integer,
  ore_settimanali     integer,
  livello             text,
  qualifica           text,
  paga_base           numeric,
  costo_azienda       numeric,
  raw_data            text,
  totale_competenze   numeric,
  UNIQUE (employee_name, sede, anno, mese)
);

-- ─── SHIFTS (Turni) ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shifts (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_code         text,
  employee_name         text,
  sede                  text NOT NULL,
  date                  date NOT NULL,
  turno_tipo            text DEFAULT 'Pranzo',
  ora_inizio            text,
  ora_fine              text,
  hours                 numeric DEFAULT 0,
  ruolo                 text,
  notes                 text,
  created_at            timestamptz DEFAULT now(),
  employee_id           uuid REFERENCES employees(id),
  scaglione             text,
  stato                 text DEFAULT 'bozza',
  updated_at            timestamptz DEFAULT now(),
  reparto_id            uuid REFERENCES reparti(id),
  settimana_label       text,
  pubblicato_at         timestamptz,
  bozza_generata_at     timestamptz
);

CREATE TABLE IF NOT EXISTS turni_budget (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sede              text NOT NULL,
  mese              text NOT NULL,
  budget_personale  numeric,
  target_pct        numeric DEFAULT 28.0,
  fatturato_atteso  numeric,
  note              text,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (sede, mese)
);

CREATE TABLE IF NOT EXISTS turni_fabbisogno (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reparto_id      uuid REFERENCES reparti(id),
  sede            text NOT NULL,
  turno_tipo      text NOT NULL,
  giorno_tipo     text DEFAULT 'feriale',
  min_persone     integer DEFAULT 1,
  max_persone     integer DEFAULT 2,
  ora_inizio      text,
  ora_fine        text,
  note            text,
  updated_at      timestamptz DEFAULT now(),
  ora_inizio_min  text,
  ora_inizio_max  text
);

CREATE TABLE IF NOT EXISTS turni_regole (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id       uuid REFERENCES employees(id),
  giorni_lavoro     text[] DEFAULT ARRAY['Lun','Mar','Mer','Gio','Ven'],
  ore_contratto     numeric DEFAULT 40,
  slot_preferiti    text[] DEFAULT ARRAY[]::text[],
  sede              text DEFAULT 'S1',
  note_contratto    text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- ─── FORNITORI (Suppliers) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fattura_categorie (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome        text NOT NULL,
  tipo        text NOT NULL UNIQUE,
  descrizione text,
  attivo      boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fornitori_fatture (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  p_iva       text UNIQUE,
  nome        text NOT NULL,
  data        jsonb,
  categoria   text DEFAULT 'ALTRO',
  indirizzo   text,
  cap         text,
  comune      text,
  provincia   text,
  email       text,
  telefono    text,
  iban        text,
  note        text,
  folder_path text,
  active      boolean DEFAULT true,
  updated_at  timestamptz DEFAULT now(),
  gruppo_id   uuid,
  categoria_id uuid REFERENCES fattura_categorie(id)
);

CREATE TABLE IF NOT EXISTS gruppi_fornitori (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome        text NOT NULL,
  note        text,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fatture_importate (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sede                text,
  fornitore           text,
  numero_fattura      text,
  data_fattura        date,
  imponibile          numeric,
  iva                 numeric,
  totale              numeric,
  xml_raw             text,
  data                jsonb,
  created_at          timestamptz DEFAULT now(),
  file_pdf            text UNIQUE,
  p_iva               text,
  scadenza_pagamento  date,
  stato_pagamento     text DEFAULT 'APERTA',
  note_pagamento      text,
  totale_pagato       numeric DEFAULT 0,
  modalita_pagamento  text,
  tipo_documento      text,
  sede_ma_pct         numeric,
  sede_pn_pct         numeric,
  allocazione_manuale boolean DEFAULT false,
  note_allocazione    text,
  is_duplicato        boolean DEFAULT false,
  duplicato_di        uuid REFERENCES fatture_importate(id)
);

CREATE TABLE IF NOT EXISTS fatture_pagamenti (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  fattura_id      uuid REFERENCES fatture_importate(id),
  data_pagamento  date DEFAULT CURRENT_DATE,
  importo         numeric NOT NULL,
  tipo            text DEFAULT 'PAGAMENTO',
  metodo          text DEFAULT 'BONIFICO',
  note            text,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fatture_righe (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  fattura_id      uuid REFERENCES fatture_importate(id),
  p_iva           text,
  fornitore       text NOT NULL,
  data_fattura    date,
  numero_fattura  text,
  sede            text,
  riga_numero     integer,
  descrizione     text NOT NULL,
  quantita        numeric,
  unita_misura    text,
  prezzo_unitario numeric,
  aliquota_iva    numeric,
  importo_riga    numeric,
  sconto_pct      numeric,
  categoria       text,
  file_pdf        text,
  created_at      timestamptz DEFAULT now(),
  codice_articolo text,
  tipo_codice     text,
  nome_normalizzato text
);

CREATE TABLE IF NOT EXISTS fornitori_alias (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  fornitore_id uuid REFERENCES fornitori_fatture(id),
  alias       text NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ordini_fornitore (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  fornitore_id uuid REFERENCES fornitori_fatture(id),
  sede        text,
  data        date DEFAULT CURRENT_DATE,
  stato       text DEFAULT 'BOZZA',
  note        text,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ordini_righe (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ordine_id       uuid REFERENCES ordini_fornitore(id),
  prodotto_id     uuid,
  descrizione     text NOT NULL,
  quantita        numeric DEFAULT 1,
  unita_misura    text,
  prezzo_unitario numeric,
  created_at      timestamptz DEFAULT now()
);

-- ─── PRODOTTI CATALOGO ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prodotti_catalogo (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome              text NOT NULL,
  nome_normalizzato text NOT NULL UNIQUE,
  categoria         text DEFAULT 'ALTRO',
  unita_misura      text,
  note              text,
  attivo            boolean DEFAULT true,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prodotti_fornitori_mapping (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  prodotto_id     uuid REFERENCES prodotti_catalogo(id),
  fornitore_id    uuid REFERENCES fornitori_fatture(id),
  codice_fornitore text,
  nome_fornitore  text,
  prezzo_medio    numeric,
  ultima_fattura  date,
  created_at      timestamptz DEFAULT now()
);

-- ─── LISTINO PRODOTTI (Price List — needed by v_venduto_valorizzato) ─────────
CREATE SEQUENCE IF NOT EXISTS listino_prodotti_id_seq;
CREATE TABLE IF NOT EXISTS listino_prodotti (
  id                          bigint DEFAULT nextval('listino_prodotti_id_seq') PRIMARY KEY,
  categoria                   text NOT NULL,
  listino                     text DEFAULT 'LISTINO',
  nome_prodotto               text NOT NULL,
  nome_normalizzato           text,
  prezzo_vendita              numeric,
  costo_acquisto              numeric,
  margine_lordo_pct           numeric,
  quantita_venduta_riferimento numeric,
  fornitore_id                uuid REFERENCES fornitori_fatture(id),
  note                        text,
  attivo                      boolean DEFAULT true,
  updated_at                  timestamptz DEFAULT now(),
  created_at                  timestamptz DEFAULT now()
);

-- ─── COSTI FISSI (Fixed Costs) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS costi_fissi (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sede            text NOT NULL,
  anno            integer NOT NULL,
  mese            integer NOT NULL,
  categoria_id    uuid REFERENCES fattura_categorie(id),
  descrizione     text NOT NULL,
  importo         numeric DEFAULT 0,
  ricorrente      boolean DEFAULT true,
  data_pagamento  date,
  note            text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- ─── STATISTICHE TAVOLI ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS statistiche_tavoli (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sede            text NOT NULL,
  data_inizio     date NOT NULL,
  data_fine       date NOT NULL,
  tavolo          text NOT NULL,
  n_coperti       integer,
  n_ordini        integer,
  durata_media_min integer,
  incasso         numeric,
  scontrino_medio numeric,
  created_at      timestamptz DEFAULT now(),
  n_coperture     integer,
  fatturato_tavolo numeric
);

-- ─── CLIENTI NPS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clienti_nps (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sede          text,
  data_visita   date,
  nome_cliente  text,
  email         text,
  telefono      text,
  nps_score     integer,
  commento      text,
  categoria_nps text,
  n_visite      integer DEFAULT 1,
  ultima_visita date,
  fonte         text DEFAULT 'manuale',
  created_at    timestamptz DEFAULT now()
);

-- ─── SOCIAL TRENDS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_trends (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  data_raccolta       date DEFAULT CURRENT_DATE,
  platform            text NOT NULL,
  categoria           text NOT NULL,
  valore              text NOT NULL,
  score               numeric,
  variazione          numeric,
  peak_score          numeric,
  categoria_dettaglio text,
  nota                text,
  metadata            jsonb DEFAULT '{}',
  created_at          timestamptz DEFAULT now()
);

-- ─── STANDARD NAZIONALI ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS standard_nazionali (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  categoria   text NOT NULL UNIQUE,
  pct_min     numeric NOT NULL,
  pct_max     numeric NOT NULL,
  pct_ideale  numeric NOT NULL,
  fonte       text,
  updated_at  timestamptz DEFAULT now()
);

-- ─── APP SETTINGS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY,
  value       jsonb,
  updated_at  timestamptz DEFAULT now()
);

-- ─── CRM BACKUPS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_backups (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo        text,
  data        jsonb,
  created_at  timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- VIEWS
-- ═══════════════════════════════════════════════════════════════════════════

-- Daily closings enriched
CREATE OR REPLACE VIEW v_chiusure AS
SELECT
  id, sede, data,
  totale_venduto_dgfe, totale_venduto_ipratico,
  totale_fiscalizzato_fatture, n_doc_fiscali_emessi,
  coperti, coperto_medio, scontrino_medio,
  chiusura_anticipata, note, created_at, updated_at,
  sede AS location
FROM chiusure_giornaliere;

-- Monthly closing summary
CREATE OR REPLACE VIEW v_chiusure_mensile AS
SELECT
  sede,
  to_char(data::timestamptz, 'YYYY-MM') AS mese,
  count(*) AS n_giorni,
  round(sum(totale_venduto_ipratico), 2) AS tot_venduto,
  sum(coperti) AS tot_coperti,
  round(avg(coperto_medio), 2) AS avg_coperto_medio,
  round(avg(scontrino_medio), 2) AS avg_scontrino_medio
FROM chiusure_giornaliere
GROUP BY sede, to_char(data::timestamptz, 'YYYY-MM')
ORDER BY to_char(data::timestamptz, 'YYYY-MM'), sede;

-- Annual comparison
CREATE OR REPLACE VIEW v_chiusure_confronto_annuale AS
SELECT
  to_char(data::timestamptz, 'MM') AS mese,
  to_char(data::timestamptz, 'YYYY') AS anno,
  sede,
  sum(coperti) AS tot_coperti,
  round(sum(totale_venduto_ipratico), 2) AS tot_venduto
FROM chiusure_giornaliere
GROUP BY to_char(data::timestamptz, 'MM'), to_char(data::timestamptz, 'YYYY'), sede
ORDER BY to_char(data::timestamptz, 'YYYY'), to_char(data::timestamptz, 'MM');

-- Closing stats
CREATE OR REPLACE VIEW v_chiusure_stats AS
SELECT
  sede,
  count(*) AS n_giorni,
  round(sum(totale_venduto_ipratico), 2) AS tot_venduto,
  sum(coperti) AS tot_coperti,
  round((sum(totale_venduto_ipratico) / NULLIF(sum(coperti), 0)::numeric), 2) AS avg_coperto_medio,
  round(avg(scontrino_medio), 2) AS avg_scontrino_medio,
  min(data) AS data_min,
  max(data) AS data_max
FROM chiusure_giornaliere
GROUP BY sede;

-- Suppliers enriched
CREATE OR REPLACE VIEW v_fatture_arricchite AS
SELECT
  fi.id AS fattura_id,
  fi.sede, fi.fornitore, fi.p_iva,
  fi.numero_fattura, fi.data_fattura,
  fi.imponibile, fi.iva, fi.totale,
  fi.stato_pagamento, fi.scadenza_pagamento,
  fi.sede_ma_pct, fi.sede_pn_pct,
  fi.allocazione_manuale, fi.note_allocazione, fi.file_pdf,
  round((fi.totale * COALESCE(fi.sede_ma_pct, 50)) / 100.0, 2) AS importo_ma,
  round((fi.totale * COALESCE(fi.sede_pn_pct, 50)) / 100.0, 2) AS importo_pn,
  ff.id AS fornitore_id,
  ff.categoria_id,
  ff.nome AS fornitore_nome,
  fc.tipo AS categoria_tipo,
  fc.nome AS categoria_nome,
  (fc.tipo = ANY(ARRAY['FOOD','BEVERAGE'])) AS is_food_cost,
  (fc.tipo = ANY(ARRAY['UTILITIES','TELEFONIA','CARBURANTE','UTENZA'])) AS is_utenza,
  (fc.tipo = ANY(ARRAY['NOLEGGIO','AFFITTO','ASSICURAZIONE','LEASING'])) AS is_fisso,
  (fc.tipo = ANY(ARRAY['DELIVERY','TICKET_BUONI','PAGAMENTI'])) AS is_commissione,
  (fc.tipo = ANY(ARRAY['MANUTENZIONE','PULIZIE','SERVIZI','CONSULENZA','MARKETING','TECH_IT','SOFTWARE','ATTREZZATURE','PACKAGING','TRASPORTI','TASSE','ALTRO'])) AS is_servizio_altro,
  extract(year FROM fi.data_fattura)::integer AS anno,
  extract(month FROM fi.data_fattura)::integer AS mese,
  to_char(fi.data_fattura::timestamptz, 'YYYY-MM') AS anno_mese
FROM fatture_importate fi
LEFT JOIN fornitori_fatture ff ON ff.p_iva = fi.p_iva AND ff.active = true
LEFT JOIN fattura_categorie fc ON fc.id = ff.categoria_id
WHERE fi.is_duplicato IS NOT TRUE;

-- Invoice with payment status
CREATE OR REPLACE VIEW v_fatture_con_stato AS
SELECT
  fi.id, fi.sede, fi.fornitore, fi.numero_fattura, fi.data_fattura,
  fi.imponibile, fi.iva, fi.totale, fi.xml_raw, fi.data, fi.created_at,
  fi.file_pdf, fi.p_iva, fi.scadenza_pagamento, fi.stato_pagamento,
  fi.note_pagamento, fi.totale_pagato, fi.modalita_pagamento, fi.tipo_documento,
  ff.nome AS fornitore_nome,
  COALESCE(ff.categoria, 'ALTRO') AS fornitore_categoria,
  round((fi.totale - COALESCE(fi.totale_pagato, 0)), 2) AS residuo,
  CASE WHEN fi.scadenza_pagamento IS NOT NULL
            AND fi.scadenza_pagamento < CURRENT_DATE
            AND fi.stato_pagamento != ALL(ARRAY['SALDATA','ANNULLATA','STORNATA'])
       THEN true ELSE false END AS scaduta
FROM fatture_importate fi
LEFT JOIN fornitori_fatture ff ON ff.p_iva = fi.p_iva;

-- Suppliers with totals
CREATE OR REPLACE VIEW v_fornitori_completi AS
SELECT
  ff.id, ff.p_iva, ff.nome,
  COALESCE(ff.categoria, 'ALTRO') AS categoria,
  ff.indirizzo, ff.cap, ff.comune, ff.provincia,
  ff.email, ff.telefono, ff.iban, ff.note, ff.folder_path,
  COALESCE(ff.active, true) AS active,
  ff.gruppo_id, gf.nome AS gruppo_nome,
  count(fi.id) AS n_fatture,
  COALESCE(round(sum(fi.totale), 2), 0) AS tot_spesa,
  COALESCE(round(sum(fi.totale_pagato), 2), 0) AS tot_pagato,
  COALESCE(round(sum(fi.totale - COALESCE(fi.totale_pagato, 0)), 2), 0) AS tot_residuo,
  count(CASE WHEN fi.stato_pagamento = 'APERTA' THEN 1 END) AS fatture_aperte,
  count(CASE WHEN fi.stato_pagamento = 'PARZIALE' THEN 1 END) AS fatture_parziali,
  count(CASE WHEN fi.stato_pagamento = 'SALDATA' THEN 1 END) AS fatture_saldate,
  max(fi.data_fattura) AS ultima_fattura,
  min(fi.data_fattura) AS prima_fattura
FROM fornitori_fatture ff
LEFT JOIN fatture_importate fi ON fi.p_iva = ff.p_iva
LEFT JOIN gruppi_fornitori gf ON gf.id = ff.gruppo_id
GROUP BY ff.id, ff.p_iva, ff.nome, ff.categoria, ff.indirizzo, ff.cap, ff.comune,
         ff.provincia, ff.email, ff.telefono, ff.iban, ff.note, ff.folder_path,
         ff.active, ff.gruppo_id, gf.nome;

-- Monthly cost by category
CREATE OR REPLACE VIEW v_macro_spesa_mensile AS
SELECT
  anno_mese, anno, mese,
  round(sum(totale) FILTER (WHERE is_food_cost), 2) AS food_cost,
  round(sum(totale) FILTER (WHERE is_utenza), 2) AS utenze,
  round(sum(totale) FILTER (WHERE is_fisso), 2) AS costi_fissi,
  round(sum(totale) FILTER (WHERE is_commissione), 2) AS commissioni,
  round(sum(totale) FILTER (WHERE is_servizio_altro), 2) AS servizi_altro,
  round(sum(totale), 2) AS totale,
  count(DISTINCT fattura_id) AS n_fatture
FROM v_fatture_arricchite
GROUP BY anno_mese, anno, mese;

-- Valorized sales (requires listino_prodotti)
CREATE OR REPLACE VIEW v_venduto_valorizzato AS
SELECT
  vc.id, vc.sede,
  extract(year FROM vc.data_inizio)::integer AS anno,
  extract(month FROM vc.data_inizio)::integer AS mese,
  vc.operatore AS operator,
  vc.prodotto, vc.quantita,
  lp.prezzo_vendita, lp.costo_acquisto, lp.categoria,
  lp.id AS listino_id,
  (vc.quantita * COALESCE(lp.prezzo_vendita, 0))::numeric(12,2) AS fatturato,
  (vc.quantita * COALESCE(lp.costo_acquisto, 0))::numeric(12,2) AS costo_materia,
  (vc.quantita * (COALESCE(lp.prezzo_vendita, 0) - COALESCE(lp.costo_acquisto, 0)))::numeric(12,2) AS margine
FROM venduto_camerieri vc
LEFT JOIN listino_prodotti lp ON
  lp.nome_normalizzato = upper(regexp_replace(trim(vc.prodotto), '[^a-zA-Z0-9]+', '_', 'g'))
  AND lp.listino = 'LISTINO';

-- Revenue per operator per month
CREATE OR REPLACE VIEW v_fatturato_operatore_mensile AS
SELECT
  sede, anno, mese, operator,
  sum(quantita) AS pezzi_totali,
  round(sum(fatturato), 2) AS fatturato_totale,
  round(sum(costo_materia), 2) AS costo_materia_totale,
  round(sum(margine), 2) AS margine_totale,
  CASE WHEN sum(fatturato) > 0
       THEN round((sum(margine) / sum(fatturato)) * 100, 2)
       ELSE 0 END AS margine_pct,
  round(sum(CASE WHEN upper(prodotto) NOT LIKE '%COPERTO%' THEN fatturato ELSE 0 END), 2) AS fatturato_no_coperto
FROM v_venduto_valorizzato
GROUP BY sede, anno, mese, operator;

-- Quantum per operator (revenue / covers)
CREATE OR REPLACE VIEW v_kpi_quantum_operatore AS
SELECT
  f.sede, f.anno, f.mese,
  f.operator AS operatore,
  f.fatturato_totale, f.fatturato_no_coperto,
  f.costo_materia_totale, f.margine_totale, f.margine_pct,
  f.pezzi_totali AS pezzi_menu,
  COALESCE(c.coperti_mese, 0) AS coperti_reali,
  CASE WHEN COALESCE(c.coperti_mese, 0) > 0
       THEN round(f.fatturato_totale / c.coperti_mese, 2) ELSE 0 END AS quantum,
  CASE WHEN COALESCE(c.coperti_mese, 0) > 0
       THEN round(f.fatturato_no_coperto / c.coperti_mese, 2) ELSE 0 END AS quantum_no_coperto
FROM v_fatturato_operatore_mensile f
LEFT JOIN (
  SELECT sede, operatore, extract(year FROM data_inizio)::integer AS anno,
         extract(month FROM data_inizio)::integer AS mese,
         sum(CASE WHEN upper(prodotto) LIKE '%COPERTO%' THEN quantita ELSE 0 END) AS coperti_mese
  FROM venduto_camerieri
  GROUP BY sede, operatore, extract(year FROM data_inizio), extract(month FROM data_inizio)
) c ON f.sede = c.sede AND f.anno = c.anno AND f.mese = c.mese AND f.operator = c.operatore;

-- Fixed costs enriched
CREATE OR REPLACE VIEW v_costi_fissi_arricchiti AS
SELECT
  cf.id, cf.sede, cf.anno, cf.mese,
  to_char(make_date(cf.anno, cf.mese, 1)::timestamptz, 'YYYY-MM') AS mese_str,
  cf.descrizione, cf.importo, cf.ricorrente, cf.data_pagamento,
  cf.note, cf.categoria_id,
  fc.tipo AS categoria_tipo,
  fc.nome AS categoria_nome,
  cf.created_at, cf.updated_at
FROM costi_fissi cf
LEFT JOIN fattura_categorie fc ON fc.id = cf.categoria_id
ORDER BY cf.anno DESC, cf.mese DESC, cf.sede, cf.descrizione;

-- Break-even monthly
CREATE OR REPLACE VIEW v_be_mensile AS
WITH personale AS (
  SELECT sede, anno, mese, COALESCE(sum(costo_azienda), 0) AS tot_personale
  FROM buste_paga WHERE costo_azienda IS NOT NULL
  GROUP BY sede, anno, mese
),
fatture_spesa AS (
  SELECT
    extract(year FROM data_fattura)::integer AS anno,
    extract(month FROM data_fattura)::integer AS mese,
    sede,
    sum(totale) FILTER (WHERE is_food_cost) AS tot_food,
    sum(totale) FILTER (WHERE is_utenza) AS tot_utenze,
    sum(totale) FILTER (WHERE is_commissione) AS tot_commissioni,
    sum(totale) FILTER (WHERE is_servizio_altro) AS tot_servizi,
    sum(totale) AS tot_fatture
  FROM v_fatture_arricchite
  WHERE sede IS NOT NULL
  GROUP BY extract(year FROM data_fattura), extract(month FROM data_fattura), sede
),
cfissi AS (
  SELECT sede, anno, mese, sum(importo) AS tot_costi_fissi
  FROM costi_fissi GROUP BY sede, anno, mese
),
fatturato AS (
  SELECT sede,
    extract(year FROM data)::integer AS anno,
    extract(month FROM data)::integer AS mese,
    sum(totale_venduto_ipratico) AS tot_fatturato,
    sum(coperti) AS tot_coperti
  FROM chiusure_giornaliere
  WHERE totale_venduto_ipratico IS NOT NULL
  GROUP BY sede, extract(year FROM data), extract(month FROM data)
),
base AS (
  SELECT sede, anno, mese FROM personale
  UNION SELECT sede, anno, mese FROM fatture_spesa
  UNION SELECT sede, anno, mese FROM cfissi
  UNION SELECT sede, anno, mese FROM fatturato
)
SELECT
  b.sede, b.anno, b.mese,
  to_char(make_date(b.anno, b.mese, 1)::timestamptz, 'YYYY-MM') AS mese_str,
  COALESCE(p.tot_personale, 0) AS costo_personale,
  COALESCE(f.tot_food, 0) AS costo_food,
  COALESCE(f.tot_utenze, 0) AS costo_utenze,
  COALESCE(f.tot_commissioni, 0) AS costo_commissioni,
  COALESCE(f.tot_servizi, 0) AS costo_servizi,
  COALESCE(f.tot_fatture, 0) AS tot_fatture_acquisto,
  COALESCE(cf.tot_costi_fissi, 0) AS costi_fissi,
  (COALESCE(p.tot_personale,0) + COALESCE(f.tot_fatture,0) + COALESCE(cf.tot_costi_fissi,0)) AS costi_totali,
  COALESCE(fa.tot_fatturato, 0) AS fatturato,
  COALESCE(fa.tot_coperti, 0) AS coperti,
  (COALESCE(fa.tot_fatturato,0) - (COALESCE(p.tot_personale,0) + COALESCE(f.tot_fatture,0) + COALESCE(cf.tot_costi_fissi,0))) AS margine,
  CASE WHEN COALESCE(fa.tot_fatturato, 0) > 0
       THEN round((100.0 * COALESCE(p.tot_personale,0)) / fa.tot_fatturato, 2) END AS pct_personale,
  CASE WHEN COALESCE(fa.tot_fatturato, 0) > 0
       THEN round((100.0 * COALESCE(f.tot_food,0)) / fa.tot_fatturato, 2) END AS pct_food,
  CASE WHEN COALESCE(fa.tot_fatturato, 0) > 0
       THEN round((100.0 * COALESCE(cf.tot_costi_fissi,0)) / fa.tot_fatturato, 2) END AS pct_fissi,
  CASE WHEN COALESCE(fa.tot_fatturato, 0) > 0
       THEN round((100.0 * COALESCE(f.tot_utenze,0)) / fa.tot_fatturato, 2) END AS pct_utenze
FROM base b
LEFT JOIN personale p USING (sede, anno, mese)
LEFT JOIN fatture_spesa f USING (sede, anno, mese)
LEFT JOIN cfissi cf USING (sede, anno, mese)
LEFT JOIN fatturato fa USING (sede, anno, mese);

-- Operator monthly aggregated
CREATE OR REPLACE VIEW v_operatore_mese AS
WITH venduto_agg AS (
  SELECT sede, operatore,
    extract(year FROM data_inizio)::integer AS anno,
    extract(month FROM data_inizio)::integer AS mese,
    sum(quantita) AS tot_pezzi,
    count(DISTINCT prodotto) AS n_prodotti_distinti
  FROM venduto_camerieri
  WHERE operatore IS NOT NULL AND operatore != 'nan'
  GROUP BY sede, operatore, extract(year FROM data_inizio), extract(month FROM data_inizio)
),
varianti_agg AS (
  SELECT sede, operatore,
    extract(year FROM data_inizio)::integer AS anno,
    extract(month FROM data_inizio)::integer AS mese,
    sum(aggiunta_qty) AS tot_aggiunte,
    sum(aggiunta_importo) AS tot_importo_aggiunte
  FROM varianti_camerieri
  WHERE operatore IS NOT NULL AND operatore != 'nan'
  GROUP BY sede, operatore, extract(year FROM data_inizio), extract(month FROM data_inizio)
),
fatt AS (
  SELECT sede, anno, mese, fatturato FROM v_be_mensile
)
SELECT
  v.sede, v.operatore, v.anno, v.mese,
  to_char(make_date(v.anno, v.mese, 1)::timestamptz, 'YYYY-MM') AS mese_str,
  v.tot_pezzi, v.n_prodotti_distinti,
  COALESCE(va.tot_aggiunte, 0) AS tot_aggiunte,
  COALESCE(va.tot_importo_aggiunte, 0) AS tot_importo_aggiunte,
  round((100.0 * v.tot_pezzi) / NULLIF(sum(v.tot_pezzi) OVER (PARTITION BY v.sede, v.anno, v.mese), 0), 2) AS pct_pezzi_team,
  round(v.tot_pezzi * (COALESCE(f.fatturato, 0) / NULLIF(sum(v.tot_pezzi) OVER (PARTITION BY v.sede, v.anno, v.mese), 0)), 2) AS fatturato_stimato_operatore,
  COALESCE(f.fatturato, 0) AS fatturato_team_mese
FROM venduto_agg v
LEFT JOIN varianti_agg va USING (sede, operatore, anno, mese)
LEFT JOIN fatt f USING (sede, anno, mese);

-- Bonus team and operator views
CREATE OR REPLACE VIEW v_bonus_team AS
WITH venduti_mese AS (
  SELECT sede, operatore, prodotto,
    extract(year FROM data_inizio)::integer AS anno,
    extract(month FROM data_inizio)::integer AS mese,
    sum(quantita) AS pezzi
  FROM venduto_camerieri
  WHERE operatore IS NOT NULL AND operatore != 'nan' AND prodotto IS NOT NULL
  GROUP BY sede, operatore, prodotto, extract(year FROM data_inizio), extract(month FROM data_inizio)
),
per_obiettivo AS (
  SELECT o.id, o.sede, o.anno, o.mese, o.prodotto, o.reparto, o.categoria,
    o.pezzi_base, o.pezzi_target, o.premio_euro,
    COALESCE(sum(v.pezzi), 0) AS pezzi_venduti,
    round((100.0 * COALESCE(sum(v.pezzi), 0)) / NULLIF(o.pezzi_target, 0), 2) AS pct_completamento
  FROM obiettivi_prodotto o
  LEFT JOIN venduti_mese v USING (sede, anno, mese, prodotto)
  WHERE o.active
  GROUP BY o.id, o.sede, o.anno, o.mese, o.prodotto, o.reparto, o.categoria, o.pezzi_base, o.pezzi_target, o.premio_euro
)
SELECT *, to_char(make_date(anno, mese, 1)::timestamptz, 'YYYY-MM') AS mese_str,
  (pezzi_venduti >= pezzi_target) AS raggiunto,
  GREATEST(0, pezzi_target - pezzi_venduti) AS pezzi_mancanti,
  CASE WHEN pezzi_venduti >= pezzi_target THEN premio_euro ELSE 0 END AS premio_maturato
FROM per_obiettivo;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════
-- Enable RLS on all tables (authenticated users can read/write)
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- Allow all for authenticated users (customize per your auth setup)
    EXECUTE format('CREATE POLICY IF NOT EXISTS "%s_auth_all" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
    -- Allow anon read for modules and crm_config (needed before login)
    IF t IN ('modules', 'crm_config', 'sedi') THEN
      EXECUTE format('CREATE POLICY IF NOT EXISTS "%s_anon_read" ON %I FOR SELECT TO anon USING (true)', t, t);
    END IF;
  END LOOP;
END $$;
