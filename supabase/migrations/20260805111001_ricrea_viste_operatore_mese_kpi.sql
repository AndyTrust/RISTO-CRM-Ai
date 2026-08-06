-- 20260805111001 — ricrea_viste_operatore_mese_kpi
-- Le due viste erano in schema.sql ma NON esistevano a database: /kpi falliva su
-- tutti i tab con "Could not find the table 'public.v_operatore_mese' in the schema cache".

CREATE OR REPLACE VIEW v_operatore_mese AS
WITH venduto_agg AS (
  SELECT sede, operatore,
    extract(year FROM data_inizio)::integer AS anno,
    extract(month FROM data_inizio)::integer AS mese,
    sum(quantita) AS tot_pezzi,
    count(DISTINCT prodotto) AS n_prodotti_distinti
  FROM venduto_camerieri
  WHERE operatore IS NOT NULL AND operatore <> 'nan'
  GROUP BY sede, operatore, extract(year FROM data_inizio), extract(month FROM data_inizio)
),
varianti_agg AS (
  SELECT sede, operatore,
    extract(year FROM data_inizio)::integer AS anno,
    extract(month FROM data_inizio)::integer AS mese,
    sum(aggiunta_qty) AS tot_aggiunte,
    sum(aggiunta_importo) AS tot_importo_aggiunte
  FROM varianti_camerieri
  WHERE operatore IS NOT NULL AND operatore <> 'nan'
  GROUP BY sede, operatore, extract(year FROM data_inizio), extract(month FROM data_inizio)
),
fatt AS (
  SELECT sede, anno, mese, fatturato FROM v_be_mensile
)
SELECT
  v.sede, v.operatore, v.anno, v.mese,
  to_char(make_date(v.anno, v.mese, 1), 'YYYY-MM') AS mese_str,
  v.tot_pezzi, v.n_prodotti_distinti,
  COALESCE(va.tot_aggiunte, 0) AS tot_aggiunte,
  COALESCE(va.tot_importo_aggiunte, 0) AS tot_importo_aggiunte,
  round((100.0 * v.tot_pezzi) / NULLIF(sum(v.tot_pezzi) OVER (PARTITION BY v.sede, v.anno, v.mese), 0), 2) AS pct_pezzi_team,
  round(v.tot_pezzi * (COALESCE(f.fatturato, 0) / NULLIF(sum(v.tot_pezzi) OVER (PARTITION BY v.sede, v.anno, v.mese), 0)), 2) AS fatturato_stimato_operatore,
  COALESCE(f.fatturato, 0) AS fatturato_team_mese
FROM venduto_agg v
LEFT JOIN varianti_agg va USING (sede, operatore, anno, mese)
LEFT JOIN fatt f USING (sede, anno, mese);

GRANT SELECT ON v_operatore_mese TO anon, authenticated, service_role;

-- v_kpi_operatori_mese: v_operatore_mese + target individuali e quantum reale.
-- Usata da CamerieriBi (colonne quantum_target, pct_target, stato_kpi).
CREATE OR REPLACE VIEW v_kpi_operatori_mese AS
WITH mappa AS (
  SELECT upper(btrim(m.op_name_ipratico)) AS op_key, m.sede, m.employee_id
  FROM employee_operator_mapping m
  WHERE m.op_name_ipratico IS NOT NULL
),
target AS (
  -- I target in euro usano la metrica FATTURATO_VENDUTO (vedi CHECK su metrica)
  SELECT t.employee_id, t.sede, t.anno, t.mese,
         t.quantum, t.target, t.quorum, t.premio_max_euro
  FROM kpi_targets_individuale t
  WHERE t.metrica = 'FATTURATO_VENDUTO'
),
quantum AS (
  SELECT q.sede, upper(btrim(q.operator)) AS op_key, q.anno, q.mese,
         q.quantum AS quantum_reale, q.coperti_gestiti, q.fatturato_totale
  FROM v_kpi_quantum_mensile q
  WHERE q.operator IS NOT NULL
)
SELECT
  b.*,
  t.quantum        AS quantum_target,
  t.target         AS target_fatturato,
  t.quorum         AS quorum_target,
  t.premio_max_euro,
  q.quantum_reale,
  q.coperti_gestiti,
  q.fatturato_totale AS fatturato_reale_operatore,
  CASE WHEN t.target > 0
       THEN round(100.0 * COALESCE(q.fatturato_totale, b.fatturato_stimato_operatore) / t.target, 2)
  END AS pct_target,
  CASE
    WHEN t.target IS NULL THEN NULL
    WHEN COALESCE(q.fatturato_totale, b.fatturato_stimato_operatore) >= t.target   THEN 'Sopra target'
    WHEN COALESCE(q.fatturato_totale, b.fatturato_stimato_operatore) >= COALESCE(t.quantum, t.target) THEN 'In quorum'
    ELSE 'Sotto quorum'
  END AS stato_kpi
FROM v_operatore_mese b
LEFT JOIN mappa  m ON m.op_key = upper(btrim(b.operatore)) AND m.sede = b.sede
LEFT JOIN target t ON t.employee_id = m.employee_id AND t.sede = b.sede AND t.anno = b.anno AND t.mese = b.mese
LEFT JOIN quantum q ON q.op_key = upper(btrim(b.operatore)) AND q.sede = b.sede AND q.anno = b.anno AND q.mese = b.mese;

GRANT SELECT ON v_kpi_operatori_mese TO anon, authenticated, service_role;
