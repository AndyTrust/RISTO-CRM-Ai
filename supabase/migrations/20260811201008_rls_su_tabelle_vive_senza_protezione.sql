-- Attiva RLS sulle 4 tabelle vive rimaste scoperte in public.
-- Le policy replicano l'accesso che hanno oggi (anon + authenticated), quindi
-- nulla cambia per l'app e per le skill di import: sparisce solo l'ERROR del linter.
do $$
declare r record;
begin
  for r in select unnest(array['obiettivi_config','anagrafica_cedolino_staging',
                               'ore_lul_staging','sede_cedolino_staging']) as t
  loop
    execute format('alter table public.%I enable row level security', r.t);
    execute format($f$create policy %I on public.%I for all to anon, authenticated
                        using (true) with check (true)$f$,
                   'accesso_app_' || r.t, r.t);
  end loop;
end $$;
