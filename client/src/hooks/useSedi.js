/**
 * useSedi.js
 * Hook per caricare le sedi dal database Supabase.
 * Sostituisce gli array statici hardcoded in ogni pagina.
 */
import { useState, useEffect } from 'react'
import supabase from '../supabase'

let _cache = null
let _fetching = false
const _listeners = []

/**
 * Carica le sedi una volta sola e le condivide tra tutti i componenti.
 */
function fetchSedi() {
  if (_cache) return Promise.resolve(_cache)
  if (_fetching) return new Promise(res => _listeners.push(res))
  _fetching = true
  return supabase
    .from('sedi')
    .select('codice, nome, colore, attiva')
    .eq('attiva', true)
    .order('nome')
    .then(({ data, error }) => {
      _fetching = false
      // Il client Supabase NON rigetta la promise su errore: risolve con
      // { data: null, error }. Senza leggere `error` la cache verrebbe fissata
      // a [] in modo permanente (la guardia `if (_cache)` impedisce ogni retry)
      // e tutti i selettori sede resterebbero vuoti per l'intera sessione.
      if (error) {
        _listeners.forEach(fn => fn([]))   // sblocca gli attesi
        _listeners.length = 0
        throw error                        // NON popolare _cache: il prossimo tentativo riprova
      }
      _cache = data ?? []
      _listeners.forEach(fn => fn(_cache))
      _listeners.length = 0
      return _cache
    })
    .catch(err => {
      // Errore di rete/parse: sblocca i listener e consenti un nuovo tentativo
      _fetching = false
      _listeners.forEach(fn => fn([]))
      _listeners.length = 0
      console.error('[useSedi] caricamento sedi fallito:', err?.message || err)
      return []
    })
}

/**
 * Invalida la cache (chiama dopo aver aggiunto/rimosso sedi).
 */
export function invalidateSediCache() {
  _cache = null
  _fetching = false
}

/**
 * Hook principale.
 * @returns {{ sedi: Array, loading: boolean, getSedeName: Function }}
 *
 * Ogni elemento sedi: { codice: 'MA', nome: 'Mameli', colore: '#ef4444', attiva: true }
 *
 * Esempio uso:
 *   const { sedi, loading, getSedeName } = useSedi()
 *   sedi.map(s => <option value={s.codice}>{s.nome}</option>)
 *   getSedeName('MA') // → 'Mameli'
 */
export default function useSedi() {
  const [sedi, setSedi] = useState(_cache ?? [])
  const [loading, setLoading] = useState(!_cache)

  useEffect(() => {
    let cancelled = false
    if (_cache) { setSedi(_cache); setLoading(false); return }
    fetchSedi().then(data => {
      if (cancelled) return              // niente setState su componente smontato
      setSedi(data); setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const getSedeName = (codice) => {
    if (!codice) return '—'
    const found = sedi.find(s => s.codice === codice)
    return found ? found.nome : codice
  }

  const getSediOptions = (includeAll = false) => {
    const opts = sedi.map(s => ({ value: s.codice, label: s.nome, color: s.colore }))
    if (includeAll) opts.unshift({ value: 'ALL', label: 'Tutte le sedi', color: '#6b7280' })
    return opts
  }

  return { sedi, loading, getSedeName, getSediOptions }
}
