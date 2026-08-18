-- applica_categorie_righe() e' SECURITY DEFINER con statement_timeout 300s e riscrive
-- la colonna categoria di TUTTE le righe di fatture_righe (~115k). Era invocabile da
-- internet con la chiave pubblica: endpoint di manutenzione, non di app.
-- Da adesso solo service_role (usata dallo script classifica_righe_fattura.py).
revoke execute on function public.applica_categorie_righe() from anon, authenticated, public;
grant execute on function public.applica_categorie_righe() to service_role;
