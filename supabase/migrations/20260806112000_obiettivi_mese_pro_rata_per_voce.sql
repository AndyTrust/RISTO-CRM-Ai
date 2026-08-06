-- 20260806112000 — v_obiettivi_mese: pro-rata per voce e su giorni di calendario
--
-- 1) QUOTA su giorni di CALENDARIO coperti, non su giorni aperti.
--    Prima: quota = gg_aperti / gg_mese. Affitto e stipendi maturano anche nei
--    giorni di chiusura, quindi saltarli sottostimava il break-even pro-rata e
--    faceva sembrare la sede piu' in salute di quanto fosse (a luglio MA aveva
--    2 giornate di chiusura: ~6% di break-even in meno).
--    Ora: quota = ultimo giorno del mese con una chiusura registrata / gg_mese.
--
-- 2) VOCI DI COSTO pro-ratate anche loro.
--    Prima la scheda mostrava break-even 10.921 (media 3 mesi x quota) e sotto
--    una tabella con personale 0 (le buste paga del mese in corso non esistono
--    ancora), fatture solo quelle gia' arrivate e costi fissi del MESE INTERO:
--    due basi diverse nella stessa scheda, e un secondo "break-even rilevato"
--    da 6.442 che non voleva dire niente.
--    Ora ogni voce ha la sua media dei 3 mesi chiusi x quota. Le tre voci
--    sommano ESATTAMENTE a break_even_pro_rata, perche'
--    avg(personale)+avg(fatture)+avg(fissi) = avg(costi_totali) = be_medio_3m.
--
-- 3) esito_provvisorio: sotto il 40% del mese "Quantum raggiunto" e' un giudizio
--    su troppo pochi giorni (4 su 31, per giunta in alta stagione).
CREATE OR REPLACE VIEW v_obiettivi_mese AS
WITH be AS (
  SELECT sede, anno, mese, mese_str, fatturato, coperti,
         costo_personale, tot_fatture_acquisto, costi_fissi,
         costi_totali AS be_totale,
         make_date(anno, mese, 1) AS primo_giorno
  FROM v_be_mensile
),
be_medio AS (
  SELECT b.sede, b.primo_giorno,
         avg(p.be_totale)             AS be_medio_3m,
         avg(p.costo_personale)       AS personale_medio_3m,
         avg(p.tot_fatture_acquisto)  AS fatture_medio_3m,
         avg(p.costi_fissi)           AS fissi_medio_3m
  FROM be b
  JOIN be p ON p.sede = b.sede
           AND p.primo_giorno < b.primo_giorno
           AND p.primo_giorno >= (b.primo_giorno - '3 mons'::interval)
           AND p.fatturato > 0
  GROUP BY b.sede, b.primo_giorno
),
prec AS (
  SELECT sede, anno + 1 AS anno_succ, mese, fatturato AS fatturato_anno_prec FROM be
),
giorni AS (
  SELECT sede,
         date_trunc('month', data)::date AS m,
         count(*) FILTER (WHERE totale_venduto_ipratico > 0) AS gg_aperti,
         -- giorni di calendario coperti dai dati: dal 1 all'ultimo giorno con chiusura
         max(extract(day FROM data))::int AS gg_coperti
  FROM chiusure_giornaliere
  GROUP BY sede, date_trunc('month', data)::date
),
calc AS (
  SELECT b.sede, b.anno, b.mese, b.mese_str, b.fatturato, b.coperti,
         b.costo_personale, b.tot_fatture_acquisto, b.costi_fissi,
         b.be_totale AS be_rilevato,
         p.fatturato_anno_prec,
         c.pct_obiettivo, c.monte_premi_euro, c.n_premiati,
         c.quota_quorum_pct, c.criterio, c.usa_anno_prec,
         (b.anno = extract(year FROM current_date)::int
          AND b.mese = extract(month FROM current_date)::int) AS mese_in_corso,
         COALESCE(g.gg_aperti, 0)::bigint AS gg_aperti,
         COALESCE(g.gg_coperti, 0)        AS gg_coperti,
         extract(day FROM b.primo_giorno + '1 mon -1 days'::interval)::int AS gg_mese,
         bm.be_medio_3m, bm.personale_medio_3m, bm.fatture_medio_3m, bm.fissi_medio_3m
  FROM be b
  JOIN obiettivi_config c ON c.sede = b.sede AND c.attivo
  LEFT JOIN prec p     ON p.sede = b.sede AND p.anno_succ = b.anno AND p.mese = b.mese
  LEFT JOIN giorni g   ON g.sede = b.sede AND g.m = b.primo_giorno
  LEFT JOIN be_medio bm ON bm.sede = b.sede AND bm.primo_giorno = b.primo_giorno
  WHERE b.fatturato > 0
),
q AS (
  SELECT calc.*,
         CASE WHEN mese_in_corso AND be_medio_3m IS NOT NULL THEN be_medio_3m
              ELSE be_rilevato END AS be_mese,
         CASE WHEN mese_in_corso AND gg_mese > 0
              THEN least(1.0, gg_coperti::numeric / gg_mese::numeric)
              ELSE 1::numeric END AS quota,
         -- voce per voce: nel mese in corso la media dei 3 mesi chiusi,
         -- altrimenti il consuntivo vero
         CASE WHEN mese_in_corso AND personale_medio_3m IS NOT NULL
              THEN personale_medio_3m ELSE costo_personale END AS personale_mese,
         CASE WHEN mese_in_corso AND fatture_medio_3m IS NOT NULL
              THEN fatture_medio_3m ELSE tot_fatture_acquisto END AS fatture_mese,
         CASE WHEN mese_in_corso AND fissi_medio_3m IS NOT NULL
              THEN fissi_medio_3m ELSE costi_fissi END AS fissi_mese
  FROM calc
),
o AS (
  SELECT q.*,
         greatest(q.be_mese * (1 + q.pct_obiettivo / 100.0),
                  CASE WHEN q.usa_anno_prec THEN COALESCE(q.fatturato_anno_prec, 0) ELSE 0 END) AS obiettivo
  FROM q
)
SELECT
  sede, anno, mese, mese_str,
  round(fatturato, 2) AS fatturato,
  coperti,
  round(costo_personale, 2)      AS costo_personale,
  round(tot_fatture_acquisto, 2) AS costo_fatture,
  round(costi_fissi, 2)          AS costi_fissi,
  round(be_rilevato, 2)          AS break_even_rilevato,
  round(be_mese, 2)              AS break_even,
  (mese_in_corso AND be_medio_3m IS NOT NULL) AS be_stimato,
  round(fatturato_anno_prec, 2)  AS fatturato_anno_prec,
  round(obiettivo, 2)            AS obiettivo,
  gg_aperti, gg_mese,
  round(quota, 4)                AS quota_mese,
  round(be_mese * quota, 2)      AS break_even_pro_rata,
  round(obiettivo * quota, 2)    AS obiettivo_pro_rata,
  CASE WHEN (be_mese * quota) > 0 THEN round(100.0 * fatturato / (be_mese * quota), 1) END AS pct_su_break_even,
  CASE WHEN (obiettivo * quota) > 0 THEN round(100.0 * fatturato / (obiettivo * quota), 1) END AS pct_su_obiettivo,
  fatturato >= (be_mese * quota)   AS quorum_raggiunto,
  fatturato >= (obiettivo * quota) AS quantum_raggiunto,
  CASE WHEN fatturato < (be_mese * quota)   THEN 'sotto_break_even'
       WHEN fatturato < (obiettivo * quota) THEN 'quorum'
       ELSE 'quantum' END AS stato,
  round(fatturato - be_mese * quota, 2) AS margine,
  round(obiettivo * quota - fatturato, 2) AS gap_a_obiettivo,
  pct_obiettivo, monte_premi_euro, n_premiati, quota_quorum_pct, criterio,
  -- ── colonne nuove ────────────────────────────────────────────────────────
  gg_coperti,
  round(personale_mese, 2) AS costo_personale_atteso,
  round(fatture_mese, 2)   AS costo_fatture_atteso,
  round(fissi_mese, 2)     AS costi_fissi_atteso,
  round(personale_mese * quota, 2) AS costo_personale_pro_rata,
  round(fatture_mese   * quota, 2) AS costo_fatture_pro_rata,
  round(fissi_mese     * quota, 2) AS costi_fissi_pro_rata,
  (mese_in_corso AND quota < 0.40) AS esito_provvisorio
FROM o;

GRANT SELECT ON v_obiettivi_mese TO anon, authenticated, service_role;
