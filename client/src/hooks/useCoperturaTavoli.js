import { useEffect, useState } from 'react'
import supabase from '../supabase'
import { svuotaAllAggiornamento } from '../lib/aggiornamento'

/**
 * useCoperturaTavoli — da quando esiste davvero `statistiche_tavoli`.
 *
 * Perché esiste: la data di inizio copertura era scritta a mano in DUE pagine
 * diverse (`StatisticheSala.jsx` e `CopertiBi.jsx`) come
 *
 *   const TAVOLI_COVERAGE_START = '2026-03-01'
 *
 * Una costante cablata e duplicata è una bugia a scadenza: appena si caricano
 * gli storici più vecchi (o si ricarica la tabella da zero) le due pagine
 * continuano ad avvisare "i dati esistono solo dal 01/03/2026" mentre il DB
 * dice altro, e nessuno se ne accorge perché il numero è plausibile.
 *
 * Qui la data si chiede ai dati: una sola riga letta (min data_inizio), in
 * cache di modulo perché non cambia durante la sessione.
 *
 * @returns {{ da: string|null, a: string|null, caricamento: boolean, errore: string|null }}
 */
let cache = null
// Il periodo coperto si allunga a ogni caricamento di statistiche_tavoli.
svuotaAllAggiornamento(() => { cache = null })

export function useCoperturaTavoli() {
  const [stato, setStato] = useState(() =>
    cache ? { ...cache, caricamento: false, errore: null }
          : { da: null, a: null, caricamento: true, errore: null }
  )

  useEffect(() => {
    if (cache) return
    let annullato = false

    ;(async () => {
      try {
        const [minRes, maxRes] = await Promise.all([
          supabase.from('statistiche_tavoli').select('data_inizio')
            .not('data_inizio', 'is', null).order('data_inizio', { ascending: true }).limit(1),
          supabase.from('statistiche_tavoli').select('data_inizio')
            .not('data_inizio', 'is', null).order('data_inizio', { ascending: false }).limit(1),
        ])
        // Il client Supabase non rigetta mai: senza leggere `error` un blocco
        // RLS diventerebbe "nessuna copertura", cioè nessun avviso mostrato.
        if (minRes.error) throw minRes.error
        if (maxRes.error) throw maxRes.error

        const da = minRes.data?.[0]?.data_inizio?.slice(0, 10) ?? null
        const a  = maxRes.data?.[0]?.data_inizio?.slice(0, 10) ?? null
        cache = { da, a }
        if (!annullato) setStato({ da, a, caricamento: false, errore: null })
      } catch (e) {
        // Nessun fallback cablato: senza la data reale la pagina non deve
        // affermare nulla sulla copertura (`da: null` = avviso non mostrato).
        if (!annullato) setStato({ da: null, a: null, caricamento: false, errore: e?.message || String(e) })
      }
    })()

    return () => { annullato = true }
  }, [])

  return stato
}

export default useCoperturaTavoli
