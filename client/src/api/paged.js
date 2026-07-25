/**
 * paged.js — lettura COMPLETA di una query Supabase oltre il cap PostgREST.
 *
 * ─── PERCHÉ ESISTE ────────────────────────────────────────────────────────
 * Questo progetto è pieno di chiamate del tipo `.range(0, 4999)` accompagnate
 * dal commento "bypass limite default 1000 righe". Non è vero: `db-max-rows`
 * è un tetto SERVER, e PostgREST lo applica comunque. Verificato sul progetto
 * xnnvmoqibkubzlrsrife il 2026-07-25:
 *
 *   offset=0&limit=1000   → 1000 righe
 *   offset=0&limit=5000   → 1000 righe   ← il "bypass" non bypassa nulla
 *   offset=0&limit=10000  → 1000 righe
 *   Range: 0-19999        → 1000 righe
 *
 * La query non fallisce e non segnala nulla: restituisce le PRIME 1000 righe
 * nell'ordine richiesto e il resto sparisce. Con `.order('data')` questo
 * significa perdere i dati PIÙ RECENTI, cioè quelli che interessano:
 *
 *   chiusure_turni      → si fermava al 2025-06-22 (13 mesi persi)
 *   venduto_camerieri   → si fermava al 2026-01-01 (quasi tutto perso)
 *   statistiche_tavoli  → si fermava al 2026-04-19
 *   chiusure_giornaliere→ si fermava al 2026-05-20
 *
 * L'unico modo di leggere tutto è iterare con `.range()` a pagine da 1000.
 *
 * ─── COME SI USA ──────────────────────────────────────────────────────────
 * Un query builder Supabase NON è riutilizzabile dopo un `await`, quindi si
 * passa una FUNZIONE che ricostruisce la query a ogni pagina:
 *
 *   const righe = await fetchPaged(
 *     () => supabase.from('chiusure_giornaliere').select('*').gte('data', from),
 *     'data'
 *   )
 *
 * `orderCol` è obbligatoria in pratica e deve essere UNIVOCA (tipicamente `id`):
 * con una colonna che ha duplicati — `data`, `sede`, `mese` — Postgres non
 * garantisce come rompe i pareggi fra una pagina e l'altra, quindi al confine
 * fra due pagine si possono ottenere righe ripetute e altre mai lette. Se il
 * chiamante ha bisogno dell'ordine cronologico, lo applica DOPO in memoria.
 */

const PAGINA = 1000

async function leggiPagina(build, orderCol, orderAsc, from) {
  let q = build()
  // Le VISTE spesso non hanno una colonna univoca: si accetta anche un array
  // di colonne la cui COMBINAZIONE è univoca (es. ['data','sede','ora']),
  // così l'ordinamento totale resta deterministico fra una pagina e l'altra.
  const cols = Array.isArray(orderCol) ? orderCol : (orderCol ? [orderCol] : [])
  for (const c of cols) q = q.order(c, { ascending: orderAsc })
  const { data, error } = await q.range(from, from + PAGINA - 1)
  // Mai `?? []` senza guardare `error`: un guasto RLS o di rete diventerebbe
  // indistinguibile da "nessun dato", ed è così che un errore si traveste da
  // zero in tutta la pagina.
  if (error) throw error
  return data ?? []
}

/**
 * Scarica tutte le righe di una query, a pagine da 1000, in parallelo.
 *
 * @param {() => object} build      ricostruisce la query da zero a ogni pagina
 * @param {string|string[]} orderCol colonna (o combinazione di colonne) di ordinamento stabile
 * @param {object}       [opts]
 * @param {boolean}      [opts.ascending=true]
 * @param {number}       [opts.max=200000]      tetto di sicurezza sulle righe
 * @param {number}       [opts.concorrenza=6]   pagine richieste in parallelo
 * @returns {Promise<object[]>}
 */
export async function fetchPaged(build, orderCol, opts = {}) {
  return (await fetchPagedInfo(build, orderCol, opts)).righe
}

/**
 * Come fetchPaged, ma dice anche se il tetto `max` è stato raggiunto.
 * Serve alle pagine che devono distinguere "questo è il totale" da "questo è
 * quanto sono riuscito a leggere": mostrare una somma troncata senza dirlo è
 * lo stesso difetto che questo modulo esiste per eliminare.
 *
 * @returns {Promise<{ righe: object[], troncato: boolean }>}
 */
export async function fetchPagedInfo(build, orderCol, opts = {}) {
  const { ascending = true, max = 200000, concorrenza = 6 } = opts

  const prima = await leggiPagina(build, orderCol, ascending, 0)
  if (prima.length < PAGINA) return { righe: prima, troncato: false }

  const out = [...prima]
  let offset = PAGINA
  let finito = false
  while (offset < max && !finito) {
    const lavori = []
    for (let i = 0; i < concorrenza; i++) {
      const from = offset + i * PAGINA
      if (from >= max) break
      lavori.push(leggiPagina(build, orderCol, ascending, from))
    }
    if (!lavori.length) break
    // Promise.all preserva l'ordine dei risultati: le pagine restano in
    // sequenza anche se le risposte arrivano fuori ordine.
    const blocchi = await Promise.all(lavori)
    for (const b of blocchi) {
      out.push(...b)
      if (b.length < PAGINA) finito = true
    }
    offset += lavori.length * PAGINA
  }
  return { righe: out, troncato: !finito }
}

export default fetchPaged
