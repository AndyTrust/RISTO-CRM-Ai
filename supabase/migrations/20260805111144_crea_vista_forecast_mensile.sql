-- 20260805111144 — v_forecast_mensile (versione finale, senza doppio conteggio turni)
--
-- Valore MENSILE del forecast, per sede. Prima non esisteva da nessuna parte:
-- forecast_giornaliero arriva a ~2 settimane e revenue_forecast e' morta dal
-- 2026-06-24, quindi del mese in corso i grafici mostravano solo il progressivo.
--   * mesi chiusi   -> tipo 'consuntivo'  (solo reale)
--   * mese in corso -> tipo 'in_corso'    (reale MTD + forecast giornaliero
--                                          + stima per-giorno-settimana sulla coda)
--   * mesi futuri   -> tipo 'previsione'  (proiezione YoY da v_forecast_costi_perdite)
--
-- ATTENZIONE: forecast_giornaliero contiene sia la riga 'giorno' (totale giornata)
-- sia 'pranzo'/'cena'. Sommare tutti i turni raddoppia la previsione (agosto 2026 MA
-- usciva a 154k contro un luglio reale da 81k). Si legge v_forecast_giornaliero,
-- che gia' preferisce 'giorno' e usa pranzo+cena solo in fallback.

CREATE OR REPLACE VIEW v_forecast_mensile AS
WITH reale AS (
  SELECT sede, data,
         sum(totale_venduto_ipratico) AS venduto,
         sum(coperti)                 AS coperti
  FROM chiusure_giornaliere
  WHERE sede IS NOT NULL
  GROUP BY sede, data
),
fcast AS (
  SELECT sede, data_competenza AS data,
         previsione_incasso AS prev,
         previsione_coperti AS prev_coperti
  FROM v_forecast_giornaliero
  WHERE sede IS NOT NULL AND previsione_incasso IS NOT NULL
),
dow_fcast AS (
  SELECT sede, extract(isodow FROM data)::int AS dow, avg(prev) AS media
  FROM fcast GROUP BY sede, extract(isodow FROM data)
),
dow_reale AS (
  SELECT sede, extract(isodow FROM data)::int AS dow, avg(venduto) AS media
  FROM reale
  WHERE data >= current_date - 56 AND data < current_date
  GROUP BY sede, extract(isodow FROM data)
),
sedi_l AS (
  SELECT sede FROM reale UNION SELECT sede FROM fcast
),
limiti AS (
  SELECT least((SELECT min(data) FROM reale), (SELECT min(data) FROM fcast)) AS dmin,
         (date_trunc('month', current_date) + interval '1 month - 1 day')::date AS dmax
),
giorni AS (
  SELECT s.sede, g::date AS data
  FROM sedi_l s
  CROSS JOIN limiti l
  CROSS JOIN LATERAL generate_series(date_trunc('month', l.dmin)::date, l.dmax, interval '1 day') g
),
ultimo_reale AS (
  SELECT sede, max(data) AS ultima FROM reale GROUP BY sede
),
comp AS (
  SELECT g.sede, g.data,
         date_trunc('month', g.data)::date AS data_mese,
         CASE
           WHEN r.venduto IS NOT NULL                           THEN 'reale'
           WHEN g.data <= COALESCE(u.ultima, DATE '1900-01-01')  THEN 'chiuso'
           WHEN f.prev IS NOT NULL                              THEN 'forecast'
           ELSE 'stima'
         END AS origine,
         r.venduto, r.coperti, f.prev,
         COALESCE(df.media, dr.media) AS stima
  FROM giorni g
  LEFT JOIN reale        r  ON r.sede = g.sede AND r.data = g.data
  LEFT JOIN fcast        f  ON f.sede = g.sede AND f.data = g.data
  LEFT JOIN ultimo_reale u  ON u.sede = g.sede
  LEFT JOIN dow_fcast    df ON df.sede = g.sede AND df.dow = extract(isodow FROM g.data)::int
  LEFT JOIN dow_reale    dr ON dr.sede = g.sede AND dr.dow = extract(isodow FROM g.data)::int
),
mensile AS (
  SELECT
    sede,
    extract(year  FROM data_mese)::int AS anno,
    extract(month FROM data_mese)::int AS mese,
    data_mese,
    to_char(data_mese, 'YYYY-MM') AS mese_str,
    count(*)                                        AS giorni_mese,
    count(*) FILTER (WHERE origine = 'reale')       AS giorni_reali,
    count(*) FILTER (WHERE origine = 'forecast')    AS giorni_forecast,
    count(*) FILTER (WHERE origine = 'stima')       AS giorni_stimati,
    round(COALESCE(sum(venduto) FILTER (WHERE origine = 'reale'), 0), 2)    AS fatturato_reale,
    round(COALESCE(sum(prev)    FILTER (WHERE origine = 'forecast'), 0), 2) AS forecast_residuo,
    round(COALESCE(sum(stima)   FILTER (WHERE origine = 'stima'), 0), 2)    AS stima_coda,
    COALESCE(sum(coperti) FILTER (WHERE origine = 'reale'), 0)::bigint      AS coperti_reali
  FROM comp
  GROUP BY sede, data_mese
)
SELECT
  CASE
    WHEN giorni_forecast + giorni_stimati = 0 THEN 'consuntivo'
    WHEN giorni_reali = 0                     THEN 'previsione'
    ELSE 'in_corso'
  END AS tipo,
  sede, anno, mese, data_mese, mese_str,
  giorni_mese, giorni_reali, giorni_forecast, giorni_stimati,
  fatturato_reale, forecast_residuo, stima_coda,
  round(fatturato_reale + forecast_residuo + stima_coda, 2) AS proiezione_mese,
  coperti_reali,
  CASE
    WHEN giorni_forecast + giorni_stimati = 0 THEN 'consuntivo'
    WHEN giorni_stimati = 0                   THEN 'reale + forecast giornaliero'
    ELSE 'reale + forecast + media giorno-settimana'
  END AS metodo
FROM mensile
WHERE fatturato_reale > 0 OR forecast_residuo > 0 OR stima_coda > 0

UNION ALL

SELECT
  'previsione'::text AS tipo,
  p.sede, p.anno, p.mese, p.data_mese, p.mese_str,
  extract(day FROM (date_trunc('month', p.data_mese) + interval '1 month - 1 day'))::bigint AS giorni_mese,
  0::bigint AS giorni_reali, 0::bigint AS giorni_forecast,
  extract(day FROM (date_trunc('month', p.data_mese) + interval '1 month - 1 day'))::bigint AS giorni_stimati,
  0::numeric AS fatturato_reale,
  0::numeric AS forecast_residuo,
  round(p.fatturato_lordo, 2) AS stima_coda,
  round(p.fatturato_lordo, 2) AS proiezione_mese,
  0::bigint AS coperti_reali,
  'proiezione anno precedente x tendenza'::text AS metodo
FROM v_forecast_costi_perdite p
WHERE p.tipo = 'previsione'
  AND p.data_mese > (date_trunc('month', current_date))::date
  AND p.fatturato_lordo IS NOT NULL;

GRANT SELECT ON v_forecast_mensile TO anon, authenticated, service_role;
