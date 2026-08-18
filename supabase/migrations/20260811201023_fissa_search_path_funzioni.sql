-- Blocca il search_path delle funzioni: senza questo un attaccante puo' creare
-- un oggetto omonimo in uno schema che viene risolto prima di public.
do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c
        where c like 'search_path=%'
      )
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
    n := n + 1;
  end loop;
  raise notice 'funzioni sistemate: %', n;
end $$;
