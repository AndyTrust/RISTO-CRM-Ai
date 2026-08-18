-- security_invoker=true: la vista viene valutata con i permessi e l'RLS di chi la chiama,
-- non del proprietario. Verificato prima che ogni tabella base sia accessibile ad anon,
-- quindi l'accesso attuale non cambia; cambia il fatto che da adesso le viste
-- RISPETTANO l'RLS delle tabelle sottostanti invece di scavalcarlo.
do $$
declare r record; n int := 0;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('alter view public.%I set (security_invoker = true)', r.relname);
    n := n + 1;
  end loop;
  raise notice 'viste convertite: %', n;
end $$;
