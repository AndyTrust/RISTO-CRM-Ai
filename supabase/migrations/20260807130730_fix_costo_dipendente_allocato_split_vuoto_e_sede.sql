-- v_costo_dipendente_allocato — due correzioni (2026-08-07)
--
-- 1) reparto_split = '{}'::jsonb NON e' NULL, quindi il vecchio COALESCE non
--    scattava mai e jsonb_each_text('{}') non produce righe: il costo di quei
--    dipendenti spariva del tutto dall'allocazione (gennaio 2026: 21.703 su
--    87.611, il 25%). Ora il fallback scatta anche sull'oggetto vuoto.
-- 2) La ripartizione per sede usava e.sede_split_ma, che vale 100 per tutti:
--    risultato, il 100% del costo finiva su MA e Predda Niedda risultava a
--    zero. Ora usa employees.cost_split con fallback sulla sede del cedolino,
--    la stessa regola di v_costo_personale_per_sede.
-- 3) Chi non ha reparto_id non viene piu' scartato: finisce in una riga
--    reparto_id NULL / "Non assegnato", cosi' il costo resta visibile.
CREATE OR REPLACE VIEW public.v_costo_dipendente_allocato AS
WITH bp AS (
  SELECT b.employee_id,
         b.anno,
         b.mese,
         COALESCE(b.costo_azienda,
                  COALESCE(b.totale_competenze, 0::numeric) * 1.3857,
                  COALESCE(b.netto, 0::numeric) * 1.79) AS costo_az,
         e.name,
         e.active AS dipendente_attivo,
         COALESCE(b.sede, e.sede) AS sede_cedolino,
         e.cost_split,
         CASE
           WHEN e.reparto_split IS NULL OR e.reparto_split = '{}'::jsonb
             THEN jsonb_build_object(COALESCE(e.reparto_id::text, ''::text), 100)
           ELSE e.reparto_split
         END AS rep_split,
         e.reparto_id AS reparto_principale
  FROM buste_paga b
  JOIN employees e ON e.id = b.employee_id
  WHERE b.employee_id IS NOT NULL
), sede_rows AS (
  SELECT bp.employee_id, bp.anno, bp.mese, bp.name, bp.dipendente_attivo,
         bp.reparto_principale, bp.rep_split,
         'MA'::text AS sede,
         bp.costo_az * COALESCE((bp.cost_split ->> 'MA'::text)::numeric,
                                CASE WHEN bp.sede_cedolino = 'MA'::text THEN 1 ELSE 0 END::numeric) AS costo_az_sede
  FROM bp
  UNION ALL
  SELECT bp.employee_id, bp.anno, bp.mese, bp.name, bp.dipendente_attivo,
         bp.reparto_principale, bp.rep_split,
         'PN'::text AS sede,
         bp.costo_az * COALESCE((bp.cost_split ->> 'PN'::text)::numeric,
                                CASE WHEN bp.sede_cedolino = 'PN'::text THEN 1 ELSE 0 END::numeric) AS costo_az_sede
  FROM bp
)
SELECT sr.employee_id,
       sr.anno,
       sr.mese,
       sr.name,
       sr.dipendente_attivo,
       sr.sede,
       NULLIF(kv.key, ''::text)::uuid AS reparto_id,
       COALESCE(r.nome, 'Non assegnato'::text) AS reparto_nome,
       COALESCE(r.icona, '?'::text) AS reparto_icona,
       kv.value::numeric AS pct_reparto,
       sr.costo_az_sede * (kv.value::numeric / 100.0) AS costo_allocato
FROM sede_rows sr
CROSS JOIN LATERAL jsonb_each_text(sr.rep_split) kv(key, value)
LEFT JOIN reparti r ON r.id = NULLIF(kv.key, ''::text)::uuid
WHERE sr.costo_az_sede <> 0::numeric
  AND kv.value::numeric > 0::numeric;

GRANT SELECT ON public.v_costo_dipendente_allocato TO anon, authenticated, service_role;
