import { useEffect, useState } from 'react'
import supabase from '../supabase'

/**
 * useAnniDisponibili — elenco degli anni REALMENTE presenti in una tabella.
 *
 * Perché esiste: in almeno sei pagine il selettore anno era scritto così
 *
 *   Array.from({ length: new Date().getFullYear() - 2023 }, (_, i) => 2024 + i)
 *
 * cioè "dal 2024 a oggi", con il 2024 cablato a mano. Ora che a DB ci sono
 * fatture dal 2019 e bilanci dal 2020, quel selettore nasconde metà dello
 * storico e non c'è modo, dalla UI, di accorgersene: semplicemente gli anni
 * vecchi non compaiono nella tendina.
 *
 * Qui gli anni si chiedono ai dati. Due letture da una riga ciascuna
 * (min e max), quindi il costo è trascurabile, e il risultato è in cache di
 * modulo perché non cambia durante la sessione.
 *
 * @param {string} tabella   es. 'fatture_importate'
 * @param {string} colonna   colonna data (es. 'data_fattura') o intera (es. 'anno')
 * @param {object} [opts]
 * @param {'data'|'anno'} [opts.tipo='data']
 * @param {number[]} [opts.fallback] usato solo se la lettura fallisce
 * @returns {{ anni: number[], caricamento: boolean, errore: string|null }}
 */
const cache = new Map()

export function useAnniDisponibili(tabella, colonna, opts = {}) {
  const { tipo = 'data', fallback = null } = opts
  const chiave = `${tabella}.${colonna}.${tipo}`

  const [stato, setStato] = useState(() =>
    cache.has(chiave)
      ? { anni: cache.get(chiave), caricamento: false, errore: null }
      : { anni: fallback ?? [], caricamento: true, errore: null }
  )

  useEffect(() => {
    if (cache.has(chiave)) return
    let annullato = false

    const estraiAnno = (v) => {
      if (v == null) return null
      if (tipo === 'anno') return parseInt(v, 10)
      const y = parseInt(String(v).substring(0, 4), 10)
      return Number.isFinite(y) ? y : null
    }

    ;(async () => {
      try {
        const [minRes, maxRes] = await Promise.all([
          supabase.from(tabella).select(colonna).not(colonna, 'is', null)
            .order(colonna, { ascending: true }).limit(1),
          supabase.from(tabella).select(colonna).not(colonna, 'is', null)
            .order(colonna, { ascending: false }).limit(1),
        ])
        // Il client Supabase non rigetta mai: senza leggere `error` un blocco
        // RLS diventerebbe "nessun anno disponibile", cioè una tendina vuota.
        if (minRes.error) throw minRes.error
        if (maxRes.error) throw maxRes.error

        const da = estraiAnno(minRes.data?.[0]?.[colonna])
        const a  = estraiAnno(maxRes.data?.[0]?.[colonna])
        if (da == null || a == null) throw new Error('nessun dato datato')

        const anni = []
        for (let y = a; y >= da; y--) anni.push(y)
        cache.set(chiave, anni)
        if (!annullato) setStato({ anni, caricamento: false, errore: null })
      } catch (e) {
        if (!annullato) {
          const annoCorrente = new Date().getFullYear()
          setStato({
            // Fallback esplicito e dichiarato: mai una tendina vuota, ma
            // l'errore resta leggibile dal chiamante.
            anni: fallback ?? [annoCorrente, annoCorrente - 1],
            caricamento: false,
            errore: e?.message || String(e),
          })
        }
      }
    })()

    return () => { annullato = true }
  }, [chiave, tabella, colonna, tipo])   // fallback escluso di proposito: è un literal

  return stato
}

export default useAnniDisponibili
