-- Sposta le tabelle di backup/snapshot fuori dallo schema public.
-- I dati restano intatti ma non sono piu' esposti dalla API PostgREST (che serve solo public).
create schema if not exists _archivio;
revoke all on schema _archivio from anon, authenticated;

do $$
declare r record; n int := 0;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'r'
      and (
        c.relname like '\_backup\_%' or
        c.relname like '\_bk\_%' or
        c.relname like '\_prove%' or
        c.relname in ('_audit_dedup_20260726','_cartelle_fornitori_20260808',
                      '_gas_dest_20260805','_metro_store_20260805',
                      '_mix_verificato_20260805','_xml_tutti_20260805',
                      'buste_paga_pre_ccnl_20260725','buste_paga_pre_lul_20260725',
                      'costi_fissi_pre_canoni_20260725',
                      'fatture_importate_backup_20260713',
                      'fatture_importate_pre_fix_20260725',
                      'fatture_importate_pre_imponibili_20260725',
                      'fatture_importate_pre_totali_20260725',
                      'fatture_importate_prima_ripristino_20260725')
      )
  loop
    execute format('alter table public.%I set schema _archivio', r.relname);
    n := n + 1;
  end loop;
  raise notice 'tabelle archiviate: %', n;
end $$;
