/**
 * supabase-client.js
 * Stessa interfaccia di client.js ma legge/scrive direttamente su Supabase.
 * Usato in produzione (Vercel) dove non c'è Express.
 */
import supabase from '../supabase'
import { fetchPaged, fetchPagedInfo } from './paged'

// ─── Helpers ──────────────────────────────────────────────────────────────

function locationToSede(location) {
  // 'Tutte' è il valore usato dai filtri sede della UI (Buste Paga, Fornitori):
  // senza questo caso si generava .eq('sede','Tutte') → zero righe
  if (!location || location === 'all' || location === 'ALL' || location === 'Tutte') return null
  if (location === 'MAMELI')        return 'MA'
  if (location === 'PREDDA_NIEDDA') return 'PN'
  return location // già MA/PN
}

function applyDateRange(query, from, to) {
  if (from) query = query.gte('data', from)
  if (to)   query = query.lte('data', to)
  return query
}

function applyDateRangeFatture(query, from, to) {
  if (from) query = query.gte('data_fattura', from)
  if (to)   query = query.lte('data_fattura', to)
  return query
}

async function sbFetch(queryBuilder) {
  const { data, error } = await queryBuilder
  if (error) throw error
  return data ?? []
}

/**
 * Scarica TUTTE le righe di una tabella superando il cap PostgREST (1000 righe).
 * Itera con .range() finché il batch è pieno. Propaga gli errori: mai `?? []`,
 * altrimenti un guasto RLS/rete diventa indistinguibile da "tabella vuota".
 * @param {string} table  nome tabella
 * @param {string} select colonne (default '*')
 * @param {number} page   dimensione batch
 */
async function sbFetchAll(table, select = '*') {
  // .order('id') è obbligatorio: senza ordinamento stabile Postgres non
  // garantisce la stessa sequenza tra una pagina e l'altra, e il backup
  // potrebbe contenere righe duplicate o perderne alcune.
  try {
    return await fetchPaged(() => supabase.from(table).select(select), 'id')
  } catch (e) {
    throw new Error(`${table}: ${e.message}`)
  }
}

/**
 * Come sbFetchAll, ma su una query GIÀ filtrata invece che su una tabella nuda.
 *
 * Serve ogni volta che il risultato viene AGGREGATO lato client (somme, medie,
 * raggruppamenti per articolo): `.limit(2000)` non alza il cap PostgREST, che
 * resta 1000 righe, quindi la query riesce, non segnala nulla e il totale esce
 * semplicemente sbagliato per difetto. Solo `.range()` pagina davvero.
 *
 * @param {() => any} build  funzione che costruisce la query da zero a ogni giro
 *                           (un query builder Supabase non è riusabile dopo await)
 * @param {string} orderCol  colonna di ordinamento stabile: senza, Postgres non
 *                           garantisce la stessa sequenza tra pagine successive
 * @param {number} max       tetto di sicurezza sulle righe totali
 */
async function sbFetchPaged(build, orderCol, { max = 200000 } = {}) {
  return fetchPaged(build, orderCol, { max })
}

/**
 * ⚠️ IL "BYPASS" `.range(0, 4999)` NON ESISTE.
 *
 * In tutto questo file (e nelle pagine) c'erano chiamate con il commento
 * "bypass limite default 1000 righe". Misurato sul progetto il 2026-07-25:
 * `limit=5000`, `limit=10000` e `Range: 0-19999` restituiscono comunque
 * 1000 righe. `db-max-rows` è un tetto lato server e nessun parametro del
 * client lo alza. Le conseguenze reali, con `.order('data')` crescente:
 *
 *   chiusure_turni     → dati fermi al 2025-06-22 (13 mesi invisibili)
 *   venduto_camerieri  → dati fermi al 2026-01-01
 *   statistiche_tavoli → dati fermi al 2026-04-19
 *   chiusure_giornaliere → dati fermi al 2026-05-20
 *
 * Ogni lettura che poi AGGREGA lato client deve passare da sbFetchPaged().
 */

/** Escape dei metacaratteri LIKE (% e _) per evitare match involontari in ilike(). */
function escapeLike(s) {
  return String(s ?? '').replace(/[\\%_]/g, m => `\\${m}`)
}

/**
 * Registro degli errori "inghiottiti" dalle API che ritornano [] o null.
 *
 * Quelle API non possono propagare l'eccezione senza rompere le pagine che le
 * consumano, ma restituire un array vuoto rende un guasto (rete, RLS, colonna
 * rinominata) indistinguibile da "nessun dato": è lo scenario in cui BE e KPI
 * sembrano sbagliati senza causa visibile. Qui l'errore viene comunque loggato
 * e conservato, così la UI (Admin → Stato dati) può mostrarlo.
 */
/**
 * Avvisa le altre schede che un dato che entra nel BE o nei KPI è cambiato.
 * PageStatsWidget e le pagine in ascolto ricaricano; senza questo restano su
 * numeri vecchi finché non si aggiorna la pagina a mano.
 */
function notificaKpiAggiornati() {
  try {
    localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() }))
    window.dispatchEvent(new Event('crm-kpi-updated'))
  } catch (_) { /* storage non disponibile: l'invalidazione è un di più, non un requisito */ }
}

const _apiErrors = []
export function getApiErrors() { return [..._apiErrors] }
export function clearApiErrors() { _apiErrors.length = 0 }

function swallow(scope, e, fallback) {
  const entry = { scope, message: e?.message || String(e), at: new Date().toISOString() }
  _apiErrors.push(entry)
  if (_apiErrors.length > 50) _apiErrors.shift()
  console.error(`[api:${scope}] ${entry.message}`)
  return fallback
}

/**
 * Scrive turni in modo IDEMPOTENTE sulla chiave logica
 * (employee_id, date, turno_tipo, sede): rimuove gli eventuali turni già
 * presenti sulle stesse chiavi e reinserisce le righe nuove.
 *
 * Prima si usava `.insert()`, quindi ogni rigenerazione del piano settimanale
 * duplicava i turni gonfiando ore e costi nei riepiloghi.
 *
 * Prova prima l'upsert atomico lato DB; se l'indice unico non esiste ancora
 * (vedi supabase/20260725_dedup_shifts_unique_index.sql) ricade su un percorso
 * insert+delete equivalente. Funziona in entrambi gli scenari.
 */
async function replaceShifts(rows) {
  if (!rows?.length) return []

  const keyOf = r => `${r.sede}|${r.date}|${r.turno_tipo}|${r.employee_id ?? `n:${r.employee_name}`}`

  // 1. Dedup dell'input: il planner AI può produrre due righe sulla stessa
  //    chiave; senza questo passaggio si reinserirebbero duplicati (e, una
  //    volta creato l'indice unico, l'intero batch fallirebbe con 23505).
  const uniche = new Map()
  for (const r of rows) uniche.set(keyOf(r), r)     // vince l'ultima occorrenza
  const payload = [...uniche.values()]

  // 2. Percorso preferito: UPSERT atomico lato DB. Funziona solo se esiste
  //    l'indice uq_shifts_dipendente_data_turno (vedi
  //    supabase/20260725_dedup_shifts_unique_index.sql).
  const up = await supabase.from('shifts')
    .upsert(payload, { onConflict: 'employee_id,date,turno_tipo,sede' })
    .select()
  if (!up.error) return up.data ?? []

  // 42P10 = "no unique or exclusion constraint matching the ON CONFLICT
  // specification": l'indice non è ancora stato creato. Qualunque altro errore
  // è reale e va propagato.
  if (up.error.code !== '42P10') throw up.error

  // 3. Fallback senza indice: individua per CHIAVE ESATTA le righe da
  //    sostituire. Filtrare separatamente per elenco di turni ed elenco di
  //    dipendenti colpirebbe il prodotto cartesiano, cancellando turni che non
  //    stavamo rimpiazzando.
  const daEliminare = []
  const perGiorno = new Map()
  for (const r of payload) {
    const k = `${r.sede}|${r.date}`
    if (!perGiorno.has(k)) perGiorno.set(k, { sede: r.sede, date: r.date, righe: [] })
    perGiorno.get(k).righe.push(r)
  }

  for (const { sede, date, righe } of perGiorno.values()) {
    const { data: esistenti, error } = await supabase.from('shifts')
      .select('id, employee_id, employee_name, turno_tipo, sede, date')
      .eq('sede', sede).eq('date', date)
    if (error) throw error
    const chiaviNuove = new Set(righe.map(keyOf))
    for (const e of esistenti ?? []) {
      if (chiaviNuove.has(keyOf(e))) daEliminare.push(e.id)
    }
  }

  // INSERT prima, DELETE dopo: se l'insert fallisce i turni preesistenti
  // restano intatti. L'ordine inverso, in caso di errore, lascerebbe la
  // griglia vuota senza possibilità di rollback.
  const { data, error } = await supabase.from('shifts').insert(payload).select()
  if (error) throw error

  if (daEliminare.length) {
    const { error: delErr } = await supabase.from('shifts').delete().in('id', daEliminare)
    // Un fallimento qui lascia duplicati (recuperabili), non una perdita di dati
    if (delErr) console.error('[turni] insert riuscito ma pulizia dei turni sostituiti fallita:', delErr.message)
  }

  return data ?? []
}

// ─── MODULES — persistenti su Supabase ────────────────────────────────────
const MODULE_DEFAULTS = [
  { id: 'dashboard',    name: 'Dashboard',         description: 'Panoramica generale KPI e chiusure',   icon: '📊', enabled: true },
  { id: 'chiusure',     name: 'Chiusure Cassa',    description: 'Chiusure giornaliere per sede',         icon: '💰', enabled: true },
  { id: 'venduto',      name: 'Venduto + KPI',     description: 'Dettaglio venduto e KPI camerieri',     icon: '📈', enabled: true },
  { id: 'kpi_camerieri',name: 'KPI Camerieri',     description: 'Analisi performance camerieri',         icon: '🎯', enabled: true },
  { id: 'dipendenti',   name: 'Dipendenti',        description: 'Gestione anagrafica dipendenti',        icon: '👥', enabled: true },
  { id: 'turni',        name: 'Turni',             description: 'Pianificazione turni settimanali',      icon: '📅', enabled: true },
  { id: 'buste_paga',   name: 'Buste Paga',        description: 'Cedolini e costi del personale',        icon: '💼', enabled: true },
  { id: 'statistiche',  name: 'Statistiche Sala',  description: 'Fasce orarie, tavoli e operatori',      icon: '📉', enabled: true },
  { id: 'fornitori',    name: 'Fornitori & Costi', description: 'Gestione fornitori e fatture acquisto', icon: '🏭', enabled: true },

  { id: 'analytics_bi', name: 'Analytics & BI',   description: 'Business intelligence e previsioni',    icon: '🧠', enabled: true },
  { id: 'chat_claude',  name: 'Chat AI',           description: 'Assistente Claude AI integrato',        icon: '🤖', enabled: true },
  { id: 'impostazioni', name: 'Impostazioni',      description: 'Configurazione CRM',                    icon: '⚙️', enabled: true },
]

export const modules = {
  getAll: async () => {
    try {
      const { data: rows, error } = await supabase.from('modules').select('*').order('id')
      if (error || !rows || rows.length === 0) return MODULE_DEFAULTS
      // Mergia defaults con valori salvati
      return MODULE_DEFAULTS.map(def => {
        const saved = rows.find(r => r.id === def.id)
        return saved ? { ...def, enabled: saved.enabled } : def
      })
    } catch {
      return MODULE_DEFAULTS
    }
  },

  toggle: async (id) => {
    const { data: current } = await supabase.from('modules').select('enabled').eq('id', id).single()
    const newEnabled = current ? !current.enabled : false
    const { error } = await supabase.from('modules').upsert(
      { id, enabled: newEnabled, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    )
    if (error) throw error
    return { success: true, enabled: newEnabled }
  },

  saveAll: async (modulesList) => {
    const rows = modulesList.map(m => ({
      id:          m.id,
      name:        m.name,
      description: m.description || '',
      icon:        m.icon || '📦',
      enabled:     m.enabled,
      updated_at:  new Date().toISOString(),
    }))
    const { error } = await supabase.from('modules').upsert(rows, { onConflict: 'id' })
    if (error) throw error
    return { success: true }
  },

  updateConfig: async () => ({ success: true }),
}

// ─── EMPLOYEES ────────────────────────────────────────────────────────────
export const employees = {
  getAll: async (p = {}) => {
    let q = supabase.from('employees').select('*').order('name', { ascending: true })
    const sede = locationToSede(p.location)
    if (sede) q = q.eq('sede', sede)
    if (p.active !== undefined) q = q.eq('active', p.active === 'true' || p.active === true)
    if (p.role) q = q.eq('role', p.role)
    const rows = await sbFetch(q)
    // Normalizza sede → location per compatibilità UI
    return rows.map(e => ({
      ...e,
      location: e.sede === 'MA' ? 'MAMELI' : e.sede === 'PN' ? 'PREDDA_NIEDDA' : e.sede,
      avatar_color: e.avatar_color || '#6366f1',
    }))
  },

  get: async (id) => {
    const { data: emp, error } = await supabase.from('employees').select('*').eq('id', id).single()
    if (error) throw error
    return {
      ...emp,
      location: emp.sede === 'MA' ? 'MAMELI' : emp.sede === 'PN' ? 'PREDDA_NIEDDA' : emp.sede,
      avatar_color: emp.avatar_color || '#6366f1',
      targets: [],
      plans: [],
    }
  },

  create: async (d) => {
    const sede = locationToSede(d.location) || d.location
    const { data, error } = await supabase.from('employees').insert({
      name:      (d.name || '').toUpperCase(),
      role:      d.role,
      sede,
      code:      d.code || d.name?.substring(0, 4).toUpperCase() || 'XXXX',
      active:    true,
    }).select().single()
    if (error) throw error
    return { id: data.id, message: 'Dipendente creato' }
  },

  update: async (id, d) => {
    const payload = {}
    if (d.name !== undefined && d.name !== '')  payload.name   = d.name
    if (d.role !== undefined && d.role !== '')  payload.role   = d.role
    if (d.code !== undefined && d.code !== '')  payload.code   = d.code
    // Accetta sia location (MAMELI/PREDDA_NIEDDA) che sede (MA/PN) direttamente
    if (d.location)                             payload.sede   = locationToSede(d.location)
    else if (d.sede)                            payload.sede   = d.sede
    if (d.active !== undefined)                 payload.active = d.active
    if (d.buste_paga_name !== undefined)        payload.buste_paga_name = d.buste_paga_name || null
    if (d.hire_date !== undefined)              payload.hire_date = d.hire_date || null
    // NB: la colonna nel DB è 'note' (singolare), non 'notes'
    if (d.notes !== undefined)                  payload.note   = d.notes || null
    else if (d.note !== undefined)              payload.note   = d.note  || null
    // Persisti anche le ore direttamente su employees (oltre che in employee_regole)
    if (d.ore_contratto_mensili !== undefined && d.ore_contratto_mensili !== '')
      payload.ore_contratto  = parseInt(d.ore_contratto_mensili)
    if (d.ore_settimanali !== undefined && d.ore_settimanali !== '')
      payload.ore_settimanali = parseInt(d.ore_settimanali)
    if (d.reparto_id !== undefined)             payload.reparto_id = d.reparto_id || null
    if (d.sede_split_ma !== undefined)          payload.sede_split_ma = d.sede_split_ma
    if (d.reparto_split !== undefined)          payload.reparto_split = d.reparto_split || {}
    if (d.ral !== undefined && d.ral !== '')    payload.ral = parseFloat(d.ral)
    if (d.ruolo_servizio !== undefined)         payload.ruolo_servizio = d.ruolo_servizio || null
    if (d.partecipa_kpi_target !== undefined)   payload.partecipa_kpi_target = !!d.partecipa_kpi_target

    if (Object.keys(payload).length > 0) {
      const { error } = await supabase.from('employees').update(payload).eq('id', id)
      if (error) throw error
    }

    // ── CASCADE: propaga nome/sede a tutte le tabelle collegate ──────────
    const cascadeOps = []
    if (payload.name) {
      const upperName = payload.name.toUpperCase()
      cascadeOps.push(
        supabase.from('shifts').update({ employee_name: upperName }).eq('employee_id', id),
        supabase.from('buste_paga').update({ employee_name: upperName }).eq('employee_id', id),
      )
    }
    if (payload.sede) {
      cascadeOps.push(
        supabase.from('shifts').update({ sede: payload.sede }).eq('employee_id', id),
        supabase.from('buste_paga').update({ sede: payload.sede }).eq('employee_id', id),
      )
    }
    if (cascadeOps.length > 0) await Promise.allSettled(cascadeOps)

    // ── CASCADE: upsert employee_regole se passate ore ───────────────────
    const oreM = d.ore_contratto_mensili !== undefined ? d.ore_contratto_mensili : null
    const oreS = d.ore_settimanali       !== undefined ? d.ore_settimanali       : null
    if (oreM || oreS) {
      const regolePayload = { employee_id: id, updated_at: new Date().toISOString() }
      if (oreM) regolePayload.ore_contratto_mensili = parseInt(oreM)
      if (oreS) regolePayload.ore_settimanali       = parseInt(oreS)
      if (d.turni_min_settimana) regolePayload.turni_min_settimana = parseInt(d.turni_min_settimana)
      if (d.turni_max_settimana) regolePayload.turni_max_settimana = parseInt(d.turni_max_settimana)
      if (d.giorni_riposo_min)   regolePayload.giorni_riposo_min   = parseInt(d.giorni_riposo_min)
      if (d.note_regole !== undefined) regolePayload.note           = d.note_regole
      const { error: regErr } = await supabase.from('employee_regole')
        .upsert(regolePayload, { onConflict: 'employee_id' })
      if (regErr) console.warn('[employees.update] regole upsert error:', regErr.message)
    }

    // ── Notifica le altre pagine aperte tramite localStorage ─────────────
    try {
      localStorage.setItem('crm_employee_updated', JSON.stringify({ id, ts: Date.now() }))
    } catch (_) {}

    return { success: true }
  },

  toggle: async (id) => {
    const { data: emp, error: e1 } = await supabase.from('employees').select('active').eq('id', id).single()
    if (e1) throw e1
    const { error: e2 } = await supabase.from('employees').update({ active: !emp.active }).eq('id', id)
    if (e2) throw e2
    return { id, active: !emp.active }
  },

  delete: async (id) => {
    const { error } = await supabase.from('employees').delete().eq('id', id)
    if (error) throw error
    return { success: true }
  },

  getTargets: async () => [],
  setTarget:  async () => ({ success: true }),
  getPlans:   async () => [],
  addPlan:    async () => ({ success: true }),
}

// ─── CHIUSURE ─────────────────────────────────────────────────────────────
export const chiusure = {
  /**
   * @param {number} [p.limit] numero massimo di GIORNI (non di righe).
   *   Il vecchio `.limit(90)` contava le righe: con due sedi aperte "90" erano
   *   45 giorni, e il grafico Andamento Vendite della Dashboard mostrava metà
   *   del periodo richiesto senza dirlo. Se c'è un intervallo esplicito
   *   (from/to) il tetto non si applica: si legge tutto, paginando.
   */
  getAll: async (p = {}) => {
    const sede = locationToSede(p.location)
    const build = () => {
      let q = supabase.from('v_chiusure').select('*')
      if (sede) q = q.eq('sede', sede)
      return applyDateRange(q, p.from, p.to)
    }
    if (p.from || p.to) {
      // Ordinare per `id` costava 8,4 s e faceva scattare lo statement_timeout di
    // 8 s: con LIMIT 1000 il planner sceglieva la chiave primaria e scartava a
    // una a una decine di migliaia di righe (METRO: 25.737 "Rows Removed by
    // Filter"). Ordinando prima per `data_fattura` si usa ux_fatture_righe_naturale
    // (p_iva, data_fattura, …), che il filtro `p_iva` rende selettivo: ~300 ms
    // anche a offset profondo. `id` resta in coda perche' la paginazione a
    // .range() richiede un ordinamento TOTALE, e `data_fattura` da sola ha
    // duplicati (vedi il commento in testa a paged.js).
    const rows = await sbFetchPaged(build, ['data_fattura', 'id'])
      return rows.sort((a, b) => String(b.data).localeCompare(String(a.data)))
    }
    const giorni = parseInt(p.limit) || 90
    const nSedi = sede ? 1 : 2
    return sbFetch(build().order('data', { ascending: false }).limit(giorni * nSedi))
  },

  mensile: async (p = {}) => {
    let q = supabase.from('v_chiusure_mensile').select('*').order('mese', { ascending: true })
    const sede = locationToSede(p.location)
    if (sede) q = q.eq('sede', sede)
    if (p.year) q = q.like('mese', `${p.year}-%`)
    if (p.from) q = q.gte('mese', p.from.substring(0, 7))
    if (p.to)   q = q.lte('mese', p.to.substring(0, 7))
    const rows = await sbFetch(q)
    // La view usa "sede" (MA/PN) e "n_giorni" — mappiamo per compatibilità col componente
    return rows.map(r => ({
      ...r,
      location: r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA',
      giorni_apertura: r.n_giorni,
    }))
  },

  recenti: async (p = {}) => {
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const defaultFrom = thirtyDaysAgo.toISOString().split('T')[0]
    // v_chiusure ha già >1000 righe e PostgREST tronca in silenzio in ordine
    // data crescente, facendo sparire i giorni PIÙ RECENTI. `.range(0, 19999)`
    // non risolveva nulla (il cap è lato server): serve la paginazione vera.
    const build = () => {
      let q = supabase.from('v_chiusure').select('*')
      const sede = locationToSede(p.location)
      if (sede) q = q.eq('sede', sede)
      return applyDateRange(q, p.from || defaultFrom, p.to)
    }
    // Paginazione per `id` (univoco) e riordino cronologico in memoria: `data`
    // si ripete su due sedi, quindi non è una chiave di paginazione stabile.
    const rows = await sbFetchPaged(build, 'id')
    return rows.sort((a, b) => String(a.data).localeCompare(String(b.data)))
  },

  stats: async (p = {}) => {
    // Aggregazione diretta da chiusure_giornaliere con supporto filtri data
    const build = () => {
      let q = supabase
        .from('chiusure_giornaliere')
        .select('id, sede, totale_venduto_ipratico, coperti, coperto_medio, scontrino_medio, data')
      const sede = locationToSede(p.location)
      if (sede) q = q.eq('sede', sede)
      return applyDateRange(q, p.from, p.to)
    }
    const rows = await sbFetchPaged(build, 'id')

    // Aggrega per sede in JavaScript
    const bySede = {}
    rows.forEach(r => {
      const s = r.sede
      if (!bySede[s]) bySede[s] = {
        sede: s,
        location: s === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA',
        tot_venduto: 0, tot_coperti: 0,
        _cm_sum: 0, _sm_sum: 0, _count: 0,
        prima_data: r.data, ultima_data: r.data,
      }
      const agg = bySede[s]
      agg.tot_venduto  += parseFloat(r.totale_venduto_ipratico) || 0
      agg.tot_coperti  += parseInt(r.coperti) || 0
      agg._cm_sum      += parseFloat(r.coperto_medio) || 0
      agg._sm_sum      += parseFloat(r.scontrino_medio) || 0
      agg._count++
      if (r.data < agg.prima_data) agg.prima_data = r.data
      if (r.data > agg.ultima_data) agg.ultima_data = r.data
    })

    return Object.values(bySede).map(agg => ({
      sede:               agg.sede,
      location:           agg.location,
      tot_venduto:        Math.round(agg.tot_venduto * 100) / 100,
      tot_coperti:        agg.tot_coperti,
      avg_coperto_medio:  agg.tot_coperti > 0 ? Math.round(agg.tot_venduto / agg.tot_coperti * 100) / 100 : 0,
      avg_scontrino_medio: agg._count > 0 ? Math.round(agg._sm_sum / agg._count * 100) / 100 : 0,
      n_giorni:           agg._count,
      prima_data:         agg.prima_data,
      ultima_data:        agg.ultima_data,
    }))
  },

  /**
   * Confronto anno su anno. Prima il filtro periodo era ignorato del tutto
   * (si leggeva sempre TUTTA la view), quindi il tab "Anno su Anno" non
   * rispondeva al selettore di periodo. Ora `p.anni` restringe agli anni
   * richiesti; senza parametri restituisce l'intera serie storica.
   */
  confrontoAnnuale: async (p = {}) => {
    const sede = locationToSede(p.location)
    const build = () => {
      let q = supabase.from('v_chiusure_confronto_annuale').select('*')
      if (sede) q = q.eq('sede', sede)
      if (Array.isArray(p.anni) && p.anni.length) q = q.in('anno', p.anni.map(Number))
      else {
        if (p.from) q = q.gte('anno', parseInt(p.from.substring(0, 4)))
        if (p.to)   q = q.lte('anno', parseInt(p.to.substring(0, 4)))
      }
      return q
    }
    const rows = await sbFetchPaged(build, 'anno')
    return rows.sort((a, b) => (a.anno - b.anno) || (a.mese - b.mese))
  },
}

// ─── KPI ──────────────────────────────────────────────────────────────────

// Helper: applica filtro periodo (accetta period, month, from, to)
function applyPeriodFilter(q, p) {
  const period = p.period || p.month
  if (period) return q.eq('period', period)
  if (p.from) q = q.gte('period', p.from.substring(0, 7))
  if (p.to)   q = q.lte('period', p.to.substring(0, 7))
  return q
}

export const kpi = {
  // Restituisce { chiusure: [...stats per sede], operatori: [...dati kpi_revenues] }
  team: async (p = {}) => {
    const sede = locationToSede(p.location)

    // Stats chiusure per sede (coperto medio, scontrino medio)
    let qStats = supabase.from('v_chiusure_stats').select('*')
    if (sede) qStats = qStats.eq('sede', sede)
    const statsRows = await sbFetch(qStats)
    const chiusure = statsRows.map(r => ({
      location:           r.location || (r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA'),
      avg_coperto_medio:  r.avg_coperto_medio,
      avg_scontrino_medio: r.avg_scontrino_medio,
      tot_venduto:        r.tot_venduto,
      tot_coperti:        r.tot_coperti,
    }))

    // Dati operatori da v_fatturato_operatore_mensile (valorizzato da listino)
    let qRev = supabase.from('v_fatturato_operatore_mensile').select('*')
    if (sede) qRev = qRev.eq('sede', sede)
    const teamPeriod = p.period || p.month
    if (teamPeriod) {
      const [y, m] = teamPeriod.split('-')
      if (y && m) { qRev = qRev.eq('anno', parseInt(y)).eq('mese', parseInt(m)) }
    }
    const operatori = await sbFetch(qRev)

    return { chiusure, operatori }
  },

  operator: async (name, p = {}) => {
    const sede = locationToSede(p.location)
    let q = supabase.from('kpi_revenues').select('*').ilike('op', `%${escapeLike(name)}%`)
    if (sede) q = q.eq('sede', sede)
    q = applyPeriodFilter(q, p)
    return sbFetch(q)
  },

  // Quantum per operatore: usa v_kpi_quantum_mensile
  // quantum = fatturato_no_coperto / coperti_gestiti (qty prodotto COPERTO per operatore)
  // Solo operatori con mapping in employee_operator_mapping per la loro sede (fix cross-sede)
  quantum: async (p = {}) => {
    const sede = locationToSede(p.location)

    // 1. Carica mapping operatori per sede (per filtrare cross-sede contamination)
    let qMap = supabase.from('employee_operator_mapping').select('sede, op_name_ipratico')
    if (sede) qMap = qMap.eq('sede', sede)
    const mappings = await sbFetch(qMap)
    // Set di chiavi valide: "SEDE|OP_NAME_UPPERCASE"
    const mappingSet = new Set((mappings || []).map(m => `${m.sede}|${m.op_name_ipratico.toUpperCase()}`))

    // 2. Carica quantum pre-calcolati da v_kpi_quantum_mensile
    // quantum = fatturato_no_coperto / coperti_gestiti (qty del prodotto COPERTO)
    let qView = supabase.from('v_kpi_quantum_mensile').select('*')
    if (sede) qView = qView.eq('sede', sede)
    const periodStr = p.period || p.month
    if (periodStr) {
      const [y, m] = periodStr.split('-')
      if (y && m) { qView = qView.eq('anno', parseInt(y)).eq('mese', parseInt(m)) }
    } else if (p.from || p.to) {
      const now2 = new Date()
      const fromD = p.from ? new Date(p.from) : new Date(now2.getFullYear(), now2.getMonth() - 2, 1)
      const toD   = p.to   ? new Date(p.to)   : now2
      qView = qView.gte('anno', fromD.getFullYear()).lte('anno', toD.getFullYear())
    }
    const viewRows = await sbFetch(qView)

    // 3. Aggrega per sede+operatore filtrando:
    //    a) pseudo-operatori di sistema
    //    b) operatori senza mapping per quella sede (cross-sede contamination)
    const KPI_PSEUDO_OPS = ['pienissimo', 'extra', 'tecnico', 'antonio']
    const byOp = {}
    for (const r of viewRows) {
      if (!r.operator || KPI_PSEUDO_OPS.includes(r.operator.toLowerCase())) continue
      // Escludi operatori non mappati per questa sede (es. CAMILLA-MA che appare in dati PN)
      const mapKey = `${r.sede}|${r.operator.toUpperCase()}`
      if (!mappingSet.has(mapKey)) continue
      const key = `${r.sede}|${r.operator}`
      if (!byOp[key]) byOp[key] = {
        operatore:        r.operator,
        op_code:          r.operator,
        sede:             r.sede,
        location:         r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA',
        fatturato_totale: 0,
        coperti_gestiti:  0,
        costo_totale:     0,
        margine_totale:   0,
        n_mesi:           0,
      }
      byOp[key].fatturato_totale += parseFloat(r.fatturato_no_coperto) || 0
      byOp[key].coperti_gestiti  += parseFloat(r.coperti_gestiti) || 0
      byOp[key].costo_totale     += parseFloat(r.costo_materia_totale) || 0
      byOp[key].margine_totale   += parseFloat(r.margine_totale) || 0
      byOp[key].n_mesi++
    }

    // 4. Carica target salvati da kpi_targets
    let qTargets = supabase.from('kpi_targets').select('operator_code,sede,quantum_target,quorum,period')
    if (sede) qTargets = qTargets.eq('sede', sede)
    const periodForTargets = p.period || p.month
    if (periodForTargets) qTargets = qTargets.eq('period', periodForTargets)
    const targetsRows = await sbFetch(qTargets)
    const targetMap = {}
    for (const t of targetsRows) targetMap[`${t.sede}|${t.operator_code}`] = t

    return Object.values(byOp).map(op => {
      // quantum = fatturato_no_coperto / coperti_gestiti (€ per coperto reale servito)
      const quantum = op.coperti_gestiti > 0
        ? Math.round(op.fatturato_totale / op.coperti_gestiti * 100) / 100
        : 0
      const margine_pct = op.fatturato_totale > 0
        ? Math.round(op.margine_totale / op.fatturato_totale * 1000) / 10
        : 0
      const tgt = targetMap[`${op.sede}|${op.op_code}`] || null
      return {
        ...op,
        tot_importo:     op.fatturato_totale,
        quantum,
        margine_pct,
        quantum_target:  tgt?.quantum_target ?? null,
        quorum:          tgt?.quorum ?? null,
      }
    }).sort((a, b) => b.quantum - a.quantum)
  },

  stats: async (p = {}) => {
    const sede = locationToSede(p.location)
    let q = supabase.from('kpi_revenues').select('sede,period,op,totale,coperti,coperto_medio')
    if (sede) q = q.eq('sede', sede)
    q = applyPeriodFilter(q, p)
    return sbFetch(q)
  },

  // Target per operatore
  getTargets: async (p = {}) => {
    let q = supabase.from('kpi_targets').select('*').order('period', { ascending: false })
    const sede = locationToSede(p.location)
    if (sede) q = q.eq('sede', sede)
    if (p.period) q = q.eq('period', p.period)
    return sbFetch(q)
  },

  // Salva target (upsert su operator_code+sede+period)
  setTarget: async (d) => {
    const { data, error } = await supabase.from('kpi_targets').upsert({
      operator_code:        d.operator_code,
      operator_name:        d.operator_name || null,
      sede:                 d.sede,
      period:               d.period,
      quantum_target:       d.quantum_target ? parseFloat(d.quantum_target) : null,
      quorum:               d.quorum         ? parseFloat(d.quorum)         : null,
      coperto_medio_target: d.coperto_medio_target ? parseFloat(d.coperto_medio_target) : null,
      coperti_target:       d.coperti_target ? parseInt(d.coperti_target)   : null,
      notes:                d.notes || null,
    }, { onConflict: 'operator_code,sede,period' }).select().single()
    if (error) throw error
    return { id: data.id }
  },

  // Salva target in bulk (array di operatori, stesso target)
  setBulkTargets: async (operators, target) => {
    const rows = operators.map(op => ({
      operator_code:        op.code || op.op,
      operator_name:        op.name || op.operatore || null,
      sede:                 op.sede,
      period:               target.period,
      quantum_target:       target.quantum_target ? parseFloat(target.quantum_target) : null,
      quorum:               target.quorum         ? parseFloat(target.quorum)         : null,
      coperto_medio_target: target.coperto_medio_target ? parseFloat(target.coperto_medio_target) : null,
      notes:                target.notes || null,
    }))
    const { error } = await supabase.from('kpi_targets').upsert(rows, { onConflict: 'operator_code,sede,period' })
    if (error) throw error
    return { success: true, count: rows.length }
  },

  deleteTarget: async (id) => {
    const { error } = await supabase.from('kpi_targets').delete().eq('id', id)
    if (error) throw error
    return { success: true }
  },
}

// ─── helper: espande kpi_venduto_totale.data in righe per query ──────────
async function getVendutoRows(p = {}) {
  const sede = locationToSede(p.location)
  let q = supabase.from('kpi_venduto_totale').select('sede,period,data')
  if (sede) q = q.eq('sede', sede)
  const period = p.period || p.month
  if (period) q = q.eq('period', period)
  else {
    if (p.from) q = q.gte('period', p.from.substring(0, 7))
    if (p.to)   q = q.lte('period', p.to.substring(0, 7))
  }
  const rows = await sbFetch(q)
  // Espandi JSON blob in righe flat
  const flat = []
  for (const r of rows) {
    for (const item of (r.data || [])) {
      flat.push({ sede: r.sede, period: r.period, ...item })
    }
  }
  return flat
}

// ─── VENDUTO ──────────────────────────────────────────────────────────────
export const venduto = {
  // Restituisce operatori con coperti e totale (€).
  // NOTA: kpi_revenues.totale = 0 perché iPratico Pienissimo non esporta
  //       il fatturato per operatore — solo i coperti sono affidabili.
  // Arricchisce ogni riga con employee_id/nome completo da employee_operator_mapping.
  operatori: async (p = {}) => {
    const sede = locationToSede(p.location)
    let q = supabase.from('kpi_revenues').select('*').order('period', { ascending: false })
    if (sede) q = q.eq('sede', sede)
    const period = p.period || p.month
    if (period) {
      q = q.eq('period', period)
    } else {
      if (p.from) q = q.gte('period', p.from.substring(0, 7))
      if (p.to)   q = q.lte('period', p.to.substring(0, 7))
    }
    const rows = await sbFetch(q)

    // Carica mapping operatori → dipendenti per arricchire i risultati
    let qMap = supabase
      .from('employee_operator_mapping')
      .select('op_name_ipratico, sede, employee_id, verified, employees(id, name, code, active)')
    if (sede) qMap = qMap.eq('sede', sede)
    const mappings = await sbFetch(qMap)
    const mappingIdx = {}
    for (const m of mappings) {
      mappingIdx[`${m.sede}|${m.op_name_ipratico}`] = m
    }

    // Aggrega su più periodi se necessario, normalizza nomi campi per la UI
    const byOp = {}
    for (const r of rows) {
      const key = `${r.sede}|${r.op}`
      if (!byOp[key]) byOp[key] = {
        operatore:    r.op,
        location:     r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA',
        sede:         r.sede,
        tot_importo:  0,
        tot_quantita: 0,
        n_prodotti:   null,
        coperti:      0,
        coperto_medio: 0,
      }
      byOp[key].tot_importo  += parseFloat(r.totale)  || 0
      byOp[key].coperti      += parseInt(r.coperti)   || 0
    }

    return Object.values(byOp)
      .map(op => {
        const m = mappingIdx[`${op.sede}|${op.operatore}`]
        return {
          ...op,
          coperto_medio: op.coperti > 0 && op.tot_importo > 0
            ? +(op.tot_importo / op.coperti).toFixed(2)
            : 0,
          // Arricchimento da employee_operator_mapping
          employee_id:        m?.employee_id        || null,
          employee_name_full: m?.employees?.name    || null,
          employee_code:      m?.employees?.code    || null,
          employee_active:    m?.employees?.active  ?? null,
          mapping_verified:   m?.verified           ?? null,
        }
      })
      .sort((a, b) => b.coperti - a.coperti)
  },

  categorie: async (p = {}) => {
    const flat = await getVendutoRows(p)
    const byCat = {}
    for (const r of flat) {
      const k = r.cat || 'Altro'
      if (!byCat[k]) byCat[k] = {
        categoria:    k,
        tot_importo:  null,   // non disponibile da Pienissimo
        tot_quantita: 0,
        totale_pezzi: 0,
      }
      byCat[k].tot_quantita += r.qty || 0
      byCat[k].totale_pezzi += r.qty || 0
    }
    return Object.values(byCat).sort((a, b) => b.tot_quantita - a.tot_quantita)
  },

  prodotti: async (p = {}) => {
    const flat = await getVendutoRows(p)
    const byProd = {}
    for (const r of flat) {
      const k = `${r.cat}|${r.prod}`
      if (!byProd[k]) byProd[k] = {
        prodotto:     r.prod,
        categoria:    r.cat,
        tot_importo:  null,   // non disponibile da Pienissimo
        tot_quantita: 0,
        totale_pezzi: 0,
        operatori:    new Set(),
        n_operatori:  0,
      }
      byProd[k].tot_quantita += r.qty || 0
      byProd[k].totale_pezzi += r.qty || 0
      if (r.op) byProd[k].operatori.add(r.op)
    }
    return Object.values(byProd)
      .map(p => ({ ...p, n_operatori: p.operatori.size, operatori: undefined }))
      .sort((a, b) => b.tot_quantita - a.tot_quantita)
      .slice(0, p.limit || 50)
  },

  varianti: async (p = {}) => {
    // Non ancora importato da iPratico — ritorna vuoto
    return []
  },

  confronto: async () => [],
}

// ─── FORNITORI ────────────────────────────────────────────────────────────
export const fornitori = {
  // Lista completa con aggregati (usa view v_fornitori_completi)
  getAll: async (p = {}) => {
    let q = supabase.from('v_fornitori_completi').select('*').order('tot_spesa', { ascending: false })
    if (p.categoria && p.categoria !== 'TUTTI') q = q.eq('categoria', p.categoria)
    if (p.search) q = q.ilike('nome', `%${p.search}%`)
    if (p.active !== undefined) q = q.eq('active', p.active)
    const rows = await sbFetch(q)
    return rows.map(r => ({ ...r, partita_iva: r.p_iva, attivo: r.active ?? true }))
  },

  // Fornitore singolo con dettaglio completo
  getOne: async (id) => {
    const { data, error } = await supabase.from('v_fornitori_completi').select('*').eq('id', id).single()
    if (error) throw error
    return { ...data, partita_iva: data.p_iva }
  },

  create: async (d) => {
    // Il consolidamento fornitori è ESCLUSIVAMENTE per P.IVA (mai per nome):
    // senza P.IVA la riga sarebbe inaggregabile e romperebbe v_fornitori_completi
    const pIva = (d.p_iva || d.partita_iva || '').replace(/^IT/i, '').trim()
    if (!pIva) throw new Error('P.IVA obbligatoria: i fornitori sono consolidati per partita IVA')
    // Essendo un upsert su p_iva, un nome vuoto sovrascriverebbe con '' il nome
    // di un fornitore già consolidato
    const nomeFornitore = (d.nome || d.name || '').trim()
    if (!nomeFornitore) throw new Error('Nome fornitore obbligatorio')

    // UPSERT su p_iva (vincolo fornitori_fatture_p_iva_key): prima un insert
    // puro poteva creare N volte lo stesso fornitore
    const { data, error } = await supabase.from('fornitori_fatture').upsert({
      p_iva:      pIva,
      nome:       nomeFornitore,
      categoria:  d.categoria || 'ALTRO',
      indirizzo:  d.indirizzo || null,
      cap:        d.cap || null,
      comune:     d.comune || null,
      provincia:  d.provincia || null,
      email:      d.email || null,
      telefono:   d.telefono || null,
      iban:       d.iban || null,
      note:       d.note || null,
      active:     true,
    }, { onConflict: 'p_iva' }).select().single()
    if (error) throw error
    return { id: data.id }
  },

  update: async (id, d) => {
    const payload = {}
    if (d.nome      !== undefined) payload.nome      = d.nome
    if (d.categoria !== undefined) payload.categoria = d.categoria
    if (d.indirizzo !== undefined) payload.indirizzo = d.indirizzo
    if (d.cap       !== undefined) payload.cap       = d.cap
    if (d.comune    !== undefined) payload.comune    = d.comune
    if (d.provincia !== undefined) payload.provincia = d.provincia
    if (d.email     !== undefined) payload.email     = d.email
    if (d.telefono  !== undefined) payload.telefono  = d.telefono
    if (d.iban      !== undefined) payload.iban      = d.iban
    if (d.note      !== undefined) payload.note      = d.note
    if (d.active    !== undefined) payload.active    = d.active
    if (d.p_iva     !== undefined) payload.p_iva     = (d.p_iva || '').replace(/^IT/, '')
    payload.updated_at = new Date().toISOString()
    const { error } = await supabase.from('fornitori_fatture').update(payload).eq('id', id)
    if (error) throw error
    return { success: true }
  },

  // Fatture di un fornitore (per P.IVA), con stato pagamento
  getFatture: async (p = {}) => {
    let q = supabase.from('v_fatture_con_stato').select('*').order('data_fattura', { ascending: false })
    if (p.p_iva) q = q.eq('p_iva', p.p_iva.replace(/^IT/, ''))
    else if (p.fornitore) q = q.ilike('fornitore', `%${p.fornitore}%`)
    const sede = locationToSede(p.location)
    if (sede) q = q.eq('sede', sede)
    if (p.stato) q = q.eq('stato_pagamento', p.stato)
    q = applyDateRangeFatture(q, p.from, p.to)
    q = q.limit(parseInt(p.limit) || 200)
    return sbFetch(q)
  },

  // Righe prodotti/servizi di un fornitore (aggregati per codice_articolo+descrizione)
  getRighe: async (p = {}) => {
    // I totali per articolo (tot_qty, tot_importo, n_occorrenze) sono somme su
    // TUTTE le righe del periodo: qui prima si usava .limit(2000), che non alza
    // il cap PostgREST di 1000 e quindi troncava in silenzio l'aggregazione.
    // fatture_righe ha oltre 114.000 righe: serve la paginazione con .range().
    const build = () => {
      let q = supabase.from('fatture_righe').select(
        'id, codice_articolo, tipo_codice, descrizione, nome_normalizzato, quantita, unita_misura, prezzo_unitario, importo_riga, aliquota_iva, data_fattura, numero_fattura, sede, categoria, fornitore'
      )
      if (p.p_iva) q = q.eq('p_iva', p.p_iva.replace(/^IT/, ''))
      if (p.from)   q = q.gte('data_fattura', p.from)
      if (p.to)     q = q.lte('data_fattura', p.to)
      if (p.search) q = q.ilike('descrizione', `%${escapeLike(p.search)}%`)
      return q
    }
    const rows = await sbFetchPaged(build, 'id')
    // Aggrega per codice_articolo (se presente) o descrizione normalizzata
    const byKey = {}
    for (const r of rows) {
      const k = r.codice_articolo ? `${r.codice_articolo}` : (r.nome_normalizzato || r.descrizione || '—')
      if (!byKey[k]) byKey[k] = {
        codice_articolo: r.codice_articolo, tipo_codice: r.tipo_codice,
        descrizione: r.descrizione, nome_normalizzato: r.nome_normalizzato,
        categoria: r.categoria, um: r.unita_misura,
        aliquota_iva: r.aliquota_iva,
        tot_qty: 0, tot_importo: 0, n_occorrenze: 0,
        ultimo_prezzo: r.prezzo_unitario, _ultima_data: ''
      }
      byKey[k].tot_qty     += parseFloat(r.quantita) || 0
      byKey[k].tot_importo += parseFloat(r.importo_riga) || 0
      byKey[k].n_occorrenze++
      if ((r.data_fattura || '') > byKey[k]._ultima_data) {
        byKey[k]._ultima_data   = r.data_fattura
        byKey[k].ultimo_prezzo  = r.prezzo_unitario
        byKey[k].ultima_data    = r.data_fattura
      }
    }
    return Object.values(byKey).sort((a, b) => b.tot_importo - a.tot_importo)
  },

  // Righe grezze (non aggregate) di una singola fattura
  // Prima cerca per file_pdf (via JOIN su fatture_importate), poi fallback su fattura_id
  getRigheFattura: async (fattura_id) => {
    // Recupera file_pdf dalla fattura
    const { data: fat } = await supabase
      .from('fatture_importate').select('file_pdf').eq('id', fattura_id).single()
    if (fat?.file_pdf) {
      const rows = await sbFetch(
        supabase.from('fatture_righe')
          .select('*').eq('file_pdf', fat.file_pdf).order('riga_numero')
      )
      if (rows.length > 0) return rows
    }
    // Fallback: query diretta per fattura_id (righe precedenti)
    return sbFetch(
      supabase.from('fatture_righe')
        .select('*').eq('fattura_id', fattura_id).order('riga_numero')
    )
  },

  // Analisi spesa per periodo con filtri avanzati
  analisi: async (p = {}) => {
    try {
      // Fatture nel periodo → base per tutto
      // Né `.limit()` né `.range(0, 49999)` aggirano il cap PostgREST di 1000
      // righe (è un tetto lato server): con 17.262 fatture a DB si leggevano
      // solo le 1000 più vecchie del periodo. Serve la paginazione vera.
      const buildFat = () => {
        let q = supabase.from('fatture_importate')
          .select('id, data_fattura, totale, p_iva, fornitore, sede, tipo_documento')
          // Le fatture marcate duplicate vanno escluse, altrimenti la spesa è
          // gonfiata: sul 2025 i duplicati valgono ~768k su 2.045k lordi.
          // `.not(...,'is',true)` copre anche is_duplicato NULL, che è il caso
          // della maggior parte dello storico.
          .not('is_duplicato', 'is', true)
        if (p.from) q = q.gte('data_fattura', p.from)
        if (p.to)   q = q.lte('data_fattura', p.to)
        if (p.sede) q = q.eq('sede', p.sede)
        return q
      }
      const fattureRows = await sbFetchPaged(buildFat, 'id')

      // Mappa p_iva → categoria da fornitori_fatture
      const fornitoriRows = await sbFetch(
        supabase.from('fornitori_fatture').select('p_iva, nome, categoria')
      )
      const fornitoriMap  = {}
      const fornitoriNomi = {}
      for (const r of fornitoriRows) {
        fornitoriMap[r.p_iva]  = r.categoria || 'ALTRO'
        fornitoriNomi[r.p_iva] = r.nome
      }

      // Trend mensile e per sede
      const byMese = {}
      const byCat  = {}
      const byForn = {}
      const bySede = { MA: 0, PN: 0, altro: 0 }

      for (const f of fattureRows) {
        if (!f.data_fattura) continue
        const mese = f.data_fattura.substring(0, 7)
        // TD04 = nota di credito: il totale è memorizzato POSITIVO ma va
        // sottratto dalla spesa. Sommandolo si sovrastimava il costo fornitori
        // (103 note di credito, ~17.500 € contati al contrario).
        // Stessa convenzione già usata dalla vista v_costi_mensili.
        const segno = f.tipo_documento === 'TD04' ? -1 : 1
        const tot  = (parseFloat(f.totale) || 0) * segno
        const cat  = fornitoriMap[f.p_iva] || 'ALTRO'

        // Mensile
        if (!byMese[mese]) byMese[mese] = { mese, tot_spesa: 0, n_fatture: 0, MA: 0, PN: 0 }
        byMese[mese].tot_spesa += tot
        byMese[mese].n_fatture++
        if (f.sede === 'MA') byMese[mese].MA += tot
        else if (f.sede === 'PN') byMese[mese].PN += tot

        // Per categoria
        if (!byCat[cat]) byCat[cat] = { categoria: cat, tot_spesa: 0, n_fatture: 0 }
        byCat[cat].tot_spesa += tot
        byCat[cat].n_fatture++

        // Per fornitore (con periodo filtrato)
        const piva = f.p_iva || '—'
        if (!byForn[piva]) byForn[piva] = {
          p_iva: piva, nome: fornitoriNomi[piva] || f.fornitore || piva,
          categoria: cat, tot_spesa: 0, n_fatture: 0
        }
        byForn[piva].tot_spesa += tot
        byForn[piva].n_fatture++

        // Per sede
        if (f.sede === 'MA') bySede.MA += tot
        else if (f.sede === 'PN') bySede.PN += tot
        else bySede.altro += tot
      }

      const mensile     = Object.values(byMese).sort((a, b) => a.mese.localeCompare(b.mese))
      const perCategoria= Object.values(byCat).sort((a, b) => b.tot_spesa - a.tot_spesa)
      const perGruppo   = Object.values(byForn)
        .filter(r => r.tot_spesa > 0)
        .sort((a, b) => b.tot_spesa - a.tot_spesa)
        .slice(0, 15)

      // Previsione mese successivo (regressione lineare sui last 6 mesi)
      const last6 = mensile.slice(-6)
      let forecast = null
      if (last6.length >= 3) {
        const n = last6.length
        const xs = last6.map((_, i) => i)
        const ys = last6.map(m => m.tot_spesa)
        const mx = xs.reduce((s, x) => s + x, 0) / n
        const my = ys.reduce((s, y) => s + y, 0) / n
        const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
        const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0)
        const slope = den ? num / den : 0
        forecast = Math.max(0, my + slope * (n - mx))
      }

      return { perGruppo, mensile, perCategoria, bySede, forecast }
    } catch (e) { return { perGruppo: [], mensile: [], perCategoria: [], bySede: {MA:0,PN:0}, forecast: null } }
  },

  getGruppi: async () => sbFetch(supabase.from('gruppi_fornitori').select('*').order('nome')),
  addGruppo: async (d) => {
    const { data, error } = await supabase.from('gruppi_fornitori').insert({ nome: d.nome, categoria: d.categoria || null, note: d.note || null }).select().single()
    if (error) throw error
    return { id: data.id }
  },

  // ─── FATTURE ARRICCHITE (view v_fatture_arricchite) ────────────────────
  // Include split sede (importo_ma/importo_pn), categoria_tipo/nome, flag is_food_cost/...
  // Esclude automaticamente i duplicati soft-deleted (is_duplicato=true).
  listaArricchite: async (p = {}) => {
    let q = supabase.from('v_fatture_arricchite').select('*').order('data_fattura', { ascending: false })
    if (p.from)          q = q.gte('data_fattura', p.from)
    if (p.to)            q = q.lte('data_fattura', p.to)
    if (p.p_iva)         q = q.eq('p_iva', (p.p_iva || '').replace(/^IT/, ''))
    if (p.fornitore)     q = q.ilike('fornitore_nome', `%${p.fornitore}%`)
    if (p.categoria_tipo && p.categoria_tipo !== 'TUTTI') q = q.eq('categoria_tipo', p.categoria_tipo)
    if (p.sede === 'MA') q = q.gt('importo_ma', 0)
    if (p.sede === 'PN') q = q.gt('importo_pn', 0)
    // A DB lo stato è maiuscolo ('SALDATA', 'APERTA', 'ANNULLATA', 'STORNATA'),
    // come già assume la vista v_fatture_con_stato. Il filtro cercava 'pagata'
    // minuscolo, quindi "solo pagate" non restituiva mai nulla e "non pagate"
    // restituiva tutto.
    if (p.solo_pagate === true)  q = q.eq('stato_pagamento', 'SALDATA')
    if (p.solo_pagate === false) q = q.neq('stato_pagamento', 'SALDATA')
    if (p.solo_manuali)  q = q.eq('allocazione_manuale', true)
    q = q.limit(parseInt(p.limit) || 500)
    return sbFetch(q)
  },

  // ─── BULK ALLOC — per lista di UUID selezionati da UI ────────────────
  // sposta_a ∈ {'MA','PN','SPLIT50'} oppure ma_pct/pn_pct espliciti (somma=100).
  allocaBulk: async (ids, opts = {}) => {
    if (!Array.isArray(ids) || ids.length === 0) throw new Error('Nessuna fattura selezionata')
    const { data, error } = await supabase.rpc('fattura_alloca_bulk', {
      p_fattura_ids: ids,
      p_ma_pct:  opts.ma_pct ?? null,
      p_pn_pct:  opts.pn_pct ?? null,
      p_sposta_a: opts.sposta_a ?? null,
      p_note:    opts.note ?? null,
    })
    if (error) throw error
    return { aggiornate: data ?? ids.length }
  },

  // ─── BULK ALLOC PER FILTRO — match e sposta in blocco ───────────────
  allocaFiltro: async (opts = {}) => {
    const { data, error } = await supabase.rpc('fattura_alloca_filtro', {
      p_data_da:        opts.from ?? opts.data_da ?? null,
      p_data_a:         opts.to   ?? opts.data_a  ?? null,
      p_p_iva:          opts.p_iva ? (opts.p_iva || '').replace(/^IT/, '') : null,
      p_categoria_tipo: opts.categoria_tipo ?? null,
      p_solo_pagate:    opts.solo_pagate ?? null,
      p_ma_pct:         opts.ma_pct ?? null,
      p_pn_pct:         opts.pn_pct ?? null,
      p_sposta_a:       opts.sposta_a ?? null,
      p_note:           opts.note ?? null,
    })
    if (error) throw error
    return { aggiornate: data ?? 0 }
  },

  // ─── CATEGORIE FATTURE (lookup) ─────────────────────────────────────
  getCategorie: async () => sbFetch(
    supabase.from('fattura_categorie').select('id, tipo, nome, descrizione').order('tipo')
  ),

  // ─── ALIAS P.IVA — fornitori consolidati ─────────────────────────────
  getAlias: async () => sbFetch(
    supabase.from('fornitori_alias').select('*').order('p_iva_primario')
  ),
}

// ─── BI AGGREGATI (viste consolidate) ────────────────────────────────────
export const fattureBi = {
  /** Carica dettagli fatture per array di UUID — usato da segna_fatture_saldate_bulk */
  getByIds: async (ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return []
    return sbFetch(
      supabase.from('fatture_importate')
        .select('id, totale, totale_pagato')
        .in('id', ids)
    )
  },
  macroMensile: async ({ anno, sede } = {}) => {
    let q = supabase.from('v_macro_spesa_mensile').select('*').order('mese')
    if (anno) q = q.gte('mese', `${anno}-01`).lte('mese', `${anno}-12`)
    if (sede) q = q.eq('sede', sede)
    return sbFetch(q)
  },
  spesaCategoriaSedeMese: async ({ from, to, sede, categoria_tipo } = {}) => {
    let q = supabase.from('v_spesa_categoria_sede_mese').select('*').order('mese')
    if (from) q = q.gte('mese', from.substring(0, 7))
    if (to)   q = q.lte('mese', to.substring(0, 7))
    if (sede) q = q.eq('sede', sede)
    if (categoria_tipo) q = q.eq('categoria_tipo', categoria_tipo)
    return sbFetch(q)
  },
  topFornitoriCategoria: async ({ categoria_tipo, limit = 20 } = {}) => {
    let q = supabase.from('v_top_fornitori_categoria').select('*').order('tot_spesa', { ascending: false })
    if (categoria_tipo) q = q.eq('categoria_tipo', categoria_tipo)
    return sbFetch(q.limit(limit))
  },
}

// ─── PRODOTTI CATALOGO ────────────────────────────────────────────────────
export const prodottiCatalogo = {
  // Lista catalogo con aggregati venduto
  getAll: async (p = {}) => {
    // prodotti_catalogo ha >4500 righe: il vecchio `.range(0, 4999)` ne leggeva
    // comunque 1000 (cap server) e il catalogo risultava amputato.
    const build = () => {
      let q = supabase.from('prodotti_catalogo').select('*').eq('attivo', true)
      if (p.search) q = q.ilike('nome', `%${escapeLike(p.search)}%`)
      if (p.categoria) q = q.eq('categoria', p.categoria)
      return q
    }
    const rows = await sbFetchPaged(build, 'id')
    return rows.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')))
  },

  // Prodotti di un fornitore (via prodotti_fornitori_mapping)
  getByFornitore: async (p_iva) => {
    const piva = (p_iva || '').replace(/^IT/, '')
    const rows = await sbFetchPaged(
      () => supabase.from('prodotti_fornitori_mapping')
        .select('*, prodotti_catalogo(*)')
        .eq('p_iva', piva),
      'id'
    )
    return rows.sort((a, b) => (Number(b.ultimo_prezzo) || 0) - (Number(a.ultimo_prezzo) || 0))
  },

  // Aggiorna nome normalizzato (merge prodotti duplicati)
  update: async (id, d) => {
    const { error } = await supabase.from('prodotti_catalogo').update({
      nome: d.nome, nome_normalizzato: d.nome_normalizzato,
      categoria: d.categoria, unita_misura: d.unita_misura, note: d.note,
      updated_at: new Date().toISOString()
    }).eq('id', id)
    if (error) throw error
    return { success: true }
  },

  // Merge: sposta tutti i mapping da product_id_da verso product_id_a
  merge: async (id_da, id_a) => {
    const { error } = await supabase.from('prodotti_fornitori_mapping')
      .update({ prodotto_id: id_a }).eq('prodotto_id', id_da)
    if (error) throw error
    const { error: e2 } = await supabase.from('prodotti_catalogo')
      .update({ attivo: false }).eq('id', id_da)
    if (e2) throw e2
    return { success: true }
  },
}

// ─── LISTINO / FOOD COST PRODOTTI ─────────────────────────────────────────
// Il food cost (costo_acquisto €) vive in listino_prodotti, agganciato al
// venduto per nome prodotto (vedi v_menu_engineering). Questa API permette di
// leggere i prodotti venduti con il loro food cost attuale e di modificarlo.
export const listinoApi = {
  // Prodotti venduti (aggregati) uniti al listino, con food cost e prezzo correnti.
  // Senza date → tutto lo storico. Il prezzo usa la media venduta se disponibile,
  // altrimenti il prezzo di listino (l'importo venduto nella view è spesso NULL).
  prodottiConFoodCost: async ({ sede, dateFrom, dateTo } = {}) => {
    // v_menu_engineering non ha una PK: si pagina sulla coppia che la rende
    // univoca di fatto (prodotto), accettando che l'ordine non sia perfetto —
    // il risultato viene comunque riaggregato subito dopo.
    const buildMe = () => {
      let q = supabase.from('v_menu_engineering')
        .select('sede,prodotto,categoria,tipologia,quantita,importo_venduto,food_cost_medio')
      if (dateFrom) q = q.gte('data_fine', dateFrom)
      if (dateTo)   q = q.lte('data_inizio', dateTo)
      if (sede && sede !== 'ALL') q = q.eq('sede', sede)
      return q
    }
    const [rows, listino] = await Promise.all([
      sbFetchPaged(buildMe, 'prodotto'),
      sbFetchPaged(() => supabase.from('listino_prodotti')
        .select('nome_prodotto,categoria,costo_acquisto,prezzo_vendita,attivo'), 'id'),
    ])
    // Listino indicizzato per nome normalizzato
    const listMap = {}
    for (const l of (listino || [])) {
      if (l.attivo === false) continue
      const k = String(l.nome_prodotto || '').trim().toUpperCase()
      if (k && !listMap[k]) listMap[k] = {
        costo: l.costo_acquisto != null ? Number(l.costo_acquisto) : null,
        prezzo: l.prezzo_vendita != null ? Number(l.prezzo_vendita) : null,
        categoria: l.categoria,
      }
    }
    // Prodotti venduti aggregati
    const map = {}
    for (const r of rows) {
      const nome = String(r.prodotto || '').trim()
      const key = nome.toUpperCase()
      if (!key) continue
      if (!map[key]) map[key] = {
        prodotto: nome, categoria: r.categoria, tipologia: r.tipologia,
        quantita: 0, importo_venduto: 0,
        costo_acquisto: r.food_cost_medio != null ? Number(r.food_cost_medio) : null,
      }
      map[key].quantita += Number(r.quantita) || 0
      map[key].importo_venduto += Number(r.importo_venduto) || 0
      if (map[key].costo_acquisto == null && r.food_cost_medio != null) map[key].costo_acquisto = Number(r.food_cost_medio)
    }
    // Aggiungi prodotti presenti solo a listino (non venduti nel periodo)
    for (const [k, l] of Object.entries(listMap)) {
      if (!map[k]) map[k] = {
        prodotto: k.charAt(0) + k.slice(1).toLowerCase(), categoria: l.categoria, tipologia: null,
        quantita: 0, importo_venduto: 0, costo_acquisto: l.costo,
      }
    }
    return Object.values(map).map(m => {
      const k = m.prodotto.toUpperCase()
      const list = listMap[k] || {}
      // costo: venduto → listino
      const costo_acquisto = m.costo_acquisto != null ? m.costo_acquisto : (list.costo ?? null)
      // prezzo: media venduta valorizzata → prezzo di listino
      const prezzoVenduto = m.quantita > 0 && m.importo_venduto > 0 ? m.importo_venduto / m.quantita : 0
      const prezzo_medio = prezzoVenduto > 0 ? +prezzoVenduto.toFixed(2) : (list.prezzo ?? 0)
      const food_cost_pct = (costo_acquisto != null && prezzo_medio > 0)
        ? +(100 * costo_acquisto / prezzo_medio).toFixed(1) : null
      return { ...m, costo_acquisto, prezzo_medio, food_cost_pct }
    }).sort((a, b) => (b.importo_venduto - a.importo_venduto) || (b.quantita - a.quantita))
  },

  // Tutti i prezzi d'acquisto aggregati (per auto-compilazione rivendita in-memory).
  prezziAcquistoTutti: async () => {
    const rows = await sbFetchPaged(
      () => supabase.from('v_prodotti_fornitori')
        .select('descrizione,prezzo_medio,prezzo_min,unita_misura,fatture_count'),
      'descrizione'
    )
    return rows.sort((a, b) => (Number(b.fatture_count) || 0) - (Number(a.fatture_count) || 0))
  },

  // Cerca prezzi d'acquisto reali dalle fatture (v_prodotti_fornitori) per suggerire
  // il food cost. Usa il token più lungo del nome per il match, oppure una query libera.
  suggerimentiCosto: async ({ query, limit = 10 } = {}) => {
    const raw = String(query || '').trim()
    if (raw.length < 2) return []
    const tokens = raw.toUpperCase().split(/[^A-Z0-9]+/).filter(t => t.length >= 3)
    const term = tokens.length ? tokens.sort((a, b) => b.length - a.length)[0] : raw
    const rows = await sbFetch(
      supabase.from('v_prodotti_fornitori')
        .select('descrizione,prezzo_medio,prezzo_min,prezzo_max,unita_misura,fatture_count,qta_totale,ultima_fattura,fornitore')
        .ilike('descrizione', `%${term}%`)
        .order('fatture_count', { ascending: false })
        .limit(limit)
    )
    return (rows || []).map(r => ({
      descrizione: r.descrizione,
      prezzo_medio: r.prezzo_medio != null ? Number(r.prezzo_medio) : null,
      prezzo_min: r.prezzo_min != null ? Number(r.prezzo_min) : null,
      prezzo_max: r.prezzo_max != null ? Number(r.prezzo_max) : null,
      unita_misura: r.unita_misura,
      fatture_count: r.fatture_count,
      ultima_fattura: r.ultima_fattura,
      fornitore: r.fornitore,
    }))
  },

  // Salva/aggiorna il food cost (costo_acquisto €) di un prodotto in listino_prodotti.
  salvaCosto: async ({ nome_prodotto, categoria, costo_acquisto, prezzo_vendita }) => {
    const nome = String(nome_prodotto || '').trim()
    if (!nome) throw new Error('Nome prodotto mancante')
    const costo = Number(costo_acquisto)
    if (!isFinite(costo) || costo < 0) throw new Error('Costo non valido')
    const base = { costo_acquisto: costo, updated_at: new Date().toISOString() }
    // Aggiorna TUTTE le righe con quel nome (il listino può avere duplicati;
    // la view ne legge una qualsiasi, quindi vanno allineate tutte).
    // escapeLike: un nome contenente % o _ (wildcard LIKE) aggiornerebbe
    // il costo di prodotti diversi
    const { data: updated, error: eUpd } = await supabase
      .from('listino_prodotti').update(base).ilike('nome_prodotto', escapeLike(nome)).select('id')
    if (eUpd) throw eUpd
    if (updated && updated.length) return { updated: updated.length }
    // Nessuna riga esistente → insert
    const { error } = await supabase.from('listino_prodotti').insert({
      nome_prodotto: nome,
      nome_normalizzato: nome.toUpperCase(),
      categoria: categoria || null,
      prezzo_vendita: (prezzo_vendita != null && isFinite(Number(prezzo_vendita))) ? Number(prezzo_vendita) : null,
      attivo: true,
      ...base,
    })
    if (error) throw error
    return { inserted: true }
  },
}

// ─── RICETTE / DISTINTA BASE ──────────────────────────────────────────────
// Food cost "definito" dei piatti composti: somma(quantità × costo_unitario)
// degli ingredienti. Se un prodotto non ha ricetta, vale il food cost
// "indicativo" da listino_prodotti. Chiave di collegamento: nome normalizzato.
const ricettaKey = (nome) => String(nome || '').trim().toUpperCase()

export const ricetteApi = {
  // Riepilogo costo definito per tutti i prodotti con ricetta
  sommario: async () => {
    const rows = await sbFetch(supabase.from('v_ricette_costo').select('*'))
    const map = {}
    for (const r of (rows || [])) {
      map[r.prodotto_key] = {
        n_ingredienti: Number(r.n_ingredienti) || 0,
        costo_food: r.costo_food != null ? Number(r.costo_food) : 0,
      }
    }
    return map
  },
  // Righe ricetta di un prodotto
  list: async (nome) => sbFetch(
    supabase.from('ricette').select('*').eq('prodotto_key', ricettaKey(nome)).order('created_at')
  ),
  // Inserisce/aggiorna una riga ingrediente
  salvaRiga: async (r) => {
    const payload = {
      prodotto_key: ricettaKey(r.nome_prodotto),
      nome_prodotto: String(r.nome_prodotto || '').trim(),
      ingrediente: String(r.ingrediente || '').trim(),
      quantita: Number(r.quantita) || 0,
      unita: r.unita || 'g',
      costo_unitario: Number(r.costo_unitario) || 0,
      note: r.note || null,
      updated_at: new Date().toISOString(),
    }
    if (!payload.ingrediente) throw new Error('Ingrediente mancante')
    if (r.id) {
      const { data, error } = await supabase.from('ricette').update(payload).eq('id', r.id).select().single()
      if (error) throw error; return data
    }
    const { data, error } = await supabase.from('ricette').insert(payload).select().single()
    if (error) throw error; return data
  },
  eliminaRiga: async (id) => {
    const { error } = await supabase.from('ricette').delete().eq('id', id)
    if (error) throw error; return { success: true }
  },
}

// ─── PAGAMENTI FATTURE ────────────────────────────────────────────────────
export const pagamentiFatture = {
  // Lista pagamenti di una fattura
  getByFattura: async (fattura_id) => {
    return sbFetch(supabase.from('fatture_pagamenti').select('*').eq('fattura_id', fattura_id).order('data_pagamento', { ascending: false }))
  },

  // Ultimi pagamenti (dashboard)
  recenti: async (limit = 50) => {
    const { data, error } = await supabase
      .from('fatture_pagamenti')
      .select('*, fatture_importate(fornitore, numero_fattura, totale, p_iva)')
      .order('data_pagamento', { ascending: false })
      .limit(limit)
    if (error) throw error
    return data ?? []
  },

  // Aggiungi pagamento (trigger aggiorna automaticamente stato_pagamento)
  add: async (d) => {
    const { data, error } = await supabase.from('fatture_pagamenti').insert({
      fattura_id:     d.fattura_id,
      data_pagamento: d.data_pagamento || new Date().toISOString().split('T')[0],
      importo:        parseFloat(d.importo),
      tipo:           d.tipo || 'PAGAMENTO',
      metodo:         d.metodo || 'BONIFICO',
      note:           d.note || null,
    }).select().single()
    if (error) throw error
    return { id: data.id }
  },

  // Aggiorna pagamento
  update: async (id, d) => {
    const payload = {}
    if (d.data_pagamento !== undefined) payload.data_pagamento = d.data_pagamento
    if (d.importo        !== undefined) payload.importo        = parseFloat(d.importo)
    if (d.tipo           !== undefined) payload.tipo           = d.tipo
    if (d.metodo         !== undefined) payload.metodo         = d.metodo
    if (d.note           !== undefined) payload.note           = d.note
    const { error } = await supabase.from('fatture_pagamenti').update(payload).eq('id', id)
    if (error) throw error
    return { success: true }
  },

  // Elimina pagamento (trigger aggiorna stato automaticamente)
  delete: async (id) => {
    const { error } = await supabase.from('fatture_pagamenti').delete().eq('id', id)
    if (error) throw error
    return { success: true }
  },

  // Segna fattura come saldata in un colpo solo
  saldaFattura: async (fattura_id) => {
    const { data: fattura, error: fe } = await supabase
      .from('fatture_importate').select('totale, totale_pagato').eq('id', fattura_id).single()
    if (fe) throw fe
    const residuo = parseFloat(fattura.totale || 0) - parseFloat(fattura.totale_pagato || 0)
    if (residuo <= 0) return { success: true, message: 'Già saldata' }
    return pagamentiFatture.add({ fattura_id, importo: residuo, tipo: 'SALDO' })
  },
}

// ─── CHAT (stub) ──────────────────────────────────────────────────────────
export const chat = {
  models:        async () => [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' }],
  sessions:      async () => [],
  newSession:    async () => ({ id: crypto.randomUUID(), title: 'Nuova chat' }),
  renameSession: async () => ({ success: true }),
  deleteSession: async () => ({ success: true }),
  messages:      async () => [],
}

// ─── DATA — triangolazione status Supabase ────────────────────────────────
export const data = {
  sync: async () => {
    // In modalità Supabase non c'è sync da OneDrive (i dati vengono caricati
    // tramite le skill chiusure-giornaliere + scarica-fatture).
    // Ritorna status reale delle tabelle principali.
    try {
      const [
        { count: nChiusure },
        { count: nFornitori },
        { count: nFatture },
        { count: nDipendenti },
        { count: nBuste },
      ] = await Promise.all([
        supabase.from('chiusure_giornaliere').select('*', { count: 'exact', head: true }),
        supabase.from('fornitori_fatture').select('*', { count: 'exact', head: true }),
        supabase.from('fatture_importate').select('*', { count: 'exact', head: true }),
        supabase.from('employees').select('*', { count: 'exact', head: true }),
        supabase.from('buste_paga').select('*', { count: 'exact', head: true }),
      ])
      return {
        success:      true,
        source:       'supabase',
        project:      'xnnvmoqibkubzlrsrife',
        timestamp:    new Date().toISOString(),
        tables: {
          chiusure_giornaliere: nChiusure  || 0,
          fornitori_fatture:    nFornitori || 0,
          fatture_importate:    nFatture   || 0,
          employees:            nDipendenti|| 0,
          buste_paga:           nBuste     || 0,
        },
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  status: async () => {
    try {
      const { count: n } = await supabase.from('chiusure_giornaliere').select('*', { count: 'exact', head: true })
      const { data: last } = await supabase.from('chiusure_giornaliere').select('data').order('data', { ascending: false }).limit(1)
      const ultimaChiusura = last?.[0]?.data || null
      return {
        status:         'ok',
        source:         'supabase',
        project:        'xnnvmoqibkubzlrsrife',
        n_chiusure:     n || 0,
        ultima_chiusura: ultimaChiusura,
        dataPathExists: true,
        dataPath:       'Supabase → xnnvmoqibkubzlrsrife.supabase.co',
      }
    } catch {
      return { status: 'error', source: 'supabase', dataPathExists: false }
    }
  },

  paths: async () => ({ source: 'supabase', project: 'xnnvmoqibkubzlrsrife' }),
}

// ─── ANALYTICS ────────────────────────────────────────────────────────────
const MESI_IT_SHORT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']

// Helper: sposta una data YYYY-MM-DD di n anni
function shiftYears(dateStr, n) {
  if (!dateStr) return dateStr
  const y = parseInt(dateStr.substring(0, 4)) + n
  return `${y}${dateStr.substring(4)}`
}

// Helper: label leggibile per un range (es. "01/03 – 05/06")
function rangeLabel(from, to) {
  const f = s => `${s.substring(8, 10)}/${s.substring(5, 7)}`
  if (!from || !to) return 'YTD'
  return `${f(from)}–${f(to)}`
}

export const analytics = {
  // Ritorna { yoy: [...], kpiBox: { MAMELI: {...}, PREDDA_NIEDDA: {...} } }
  // p.from / p.to (YYYY-MM-DD): periodo selezionato. YoY e kpiBox confrontano
  // il periodo selezionato con lo STESSO intervallo dell'anno precedente.
  overview: async (p = {}) => {
    try {
      const now = new Date()
      const pad = n => String(n).padStart(2, '0')
      const defFrom = `${now.getFullYear()}-01-01`
      const defTo   = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
      const from = p.from || defFrom
      const to   = p.to   || defTo
      const fromPrev = shiftYears(from, -1)
      const toPrev   = shiftYears(to, -1)

      // Carica periodo corrente + stesso periodo anno precedente.
      // FIX: il filtro sede era ignorato — il grafico YoY della Dashboard
      // sommava sempre MA+PN qualunque sede fosse selezionata.
      const sedeOverview = locationToSede(p.location)
      const rows = await sbFetchPaged(
        () => {
          let q = supabase.from('chiusure_giornaliere')
            .select('id, sede, data, totale_venduto_ipratico, coperti, coperto_medio')
            .gte('data', fromPrev).lte('data', to)
          if (sedeOverview) q = q.eq('sede', sedeOverview)
          return q
        },
        'id'
      )

      const annoCorrente = parseInt(to.substring(0, 4))
      const annoPrec = annoCorrente - 1
      const inCurr = d => d >= from && d <= to
      const inPrev = d => d >= fromPrev && d <= toPrev
      const allRows = (rows ?? []).filter(r => r.data && (inCurr(r.data) || inPrev(r.data)))

      // YoY: aggrega per anno+mese_num (tutte le sedi sommate), solo mesi del periodo
      const byAnnoMese = {}
      for (const r of allRows) {
        const anno = parseInt(r.data.substring(0, 4))
        const mese_num = parseInt(r.data.substring(5, 7))
        const k = `${anno}-${mese_num}`
        if (!byAnnoMese[k]) byAnnoMese[k] = { anno, mese_num, venduto: 0, coperti: 0 }
        byAnnoMese[k].venduto += parseFloat(r.totale_venduto_ipratico) || 0
        byAnnoMese[k].coperti += parseInt(r.coperti) || 0
      }

      const byMeseNum = {}
      for (const d of Object.values(byAnnoMese)) {
        const mn = d.mese_num
        if (!byMeseNum[mn]) byMeseNum[mn] = { mese_num: mn, mese_label: MESI_IT_SHORT[mn-1] }
        // FIX anni cablati: le chiavi erano LETTERALI `venduto_2025/2026`.
        // Selezionando un periodo 2024 i dati finivano comunque sotto quelle
        // chiavi e la Dashboard etichettava le barre con l'anno sbagliato.
        // Ora le chiavi sono neutre (prec/corr); i vecchi alias restano per
        // compatibilità ma valgono per l'anno del PERIODO, non dell'orologio.
        if (d.anno === annoPrec) { byMeseNum[mn].venduto_prec = Math.round(d.venduto); byMeseNum[mn].coperti_prec = d.coperti }
        else if (d.anno === annoCorrente) { byMeseNum[mn].venduto_corr = Math.round(d.venduto); byMeseNum[mn].coperti_corr = d.coperti }
      }

      const yoy = Object.values(byMeseNum).sort((a,b) => a.mese_num - b.mese_num).map(m => ({
        ...m,
        // alias legacy (deprecati): tolti quando nessuna pagina li legge più
        venduto_2025: m.venduto_prec, venduto_2026: m.venduto_corr,
        coperti_2025: m.coperti_prec, coperti_2026: m.coperti_corr,
        delta_venduto_pct: m.venduto_prec > 0 ? Math.round(((m.venduto_corr||0) - m.venduto_prec) / m.venduto_prec * 1000) / 10 : null,
        delta_coperti_pct: m.coperti_prec > 0 ? Math.round(((m.coperti_corr||0) - m.coperti_prec) / m.coperti_prec * 1000) / 10 : null,
      }))

      // kpiBox: periodo selezionato vs stesso periodo anno precedente
      const kpiBox = {}
      for (const r of allRows) {
        const loc = r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA'
        if (!kpiBox[loc]) kpiBox[loc] = { venduto_ytd: 0, venduto_ytd_prec: 0, coperti: 0, coperti_prec: 0, n: 0, n_prec: 0 }
        const v = parseFloat(r.totale_venduto_ipratico) || 0
        const c = parseInt(r.coperti) || 0
        if (inCurr(r.data)) { kpiBox[loc].venduto_ytd += v; kpiBox[loc].coperti += c; kpiBox[loc].n++ }
        else if (inPrev(r.data)) { kpiBox[loc].venduto_ytd_prec += v; kpiBox[loc].coperti_prec += c; kpiBox[loc].n_prec++ }
      }
      for (const [loc, d] of Object.entries(kpiBox)) {
        kpiBox[loc] = {
          venduto_ytd: Math.round(d.venduto_ytd),
          venduto_ytd_prec: Math.round(d.venduto_ytd_prec),
          cm_avg: d.coperti > 0 ? Math.round(d.venduto_ytd / d.coperti * 100) / 100 : 0,
          cm_avg_prec: d.coperti_prec > 0 ? Math.round(d.venduto_ytd_prec / d.coperti_prec * 100) / 100 : 0,
          // compat alias per vecchio codice
          venduto_2m_2026: Math.round(d.venduto_ytd),
          venduto_2m_2025: Math.round(d.venduto_ytd_prec),
          cm_avg_2026: d.coperti > 0 ? Math.round(d.venduto_ytd / d.coperti * 100) / 100 : 0,
          cm_avg_2025: d.coperti_prec > 0 ? Math.round(d.venduto_ytd_prec / d.coperti_prec * 100) / 100 : 0,
          periodo_label: rangeLabel(from, to),
          anno_corrente: annoCorrente,
          anno_prec: annoPrec,
        }
      }

      return { yoy, kpiBox, anno_corrente: annoCorrente, anno_prec: annoPrec }
    } catch (e) {
      console.error('analytics.overview error:', e)
      return { yoy: [], kpiBox: {}, errore: e?.message || String(e) }
    }
  },

  mensile: async (p = {}) => {
    try {
      let q = supabase.from('v_chiusure_mensile').select('*').order('mese', { ascending: true })
      const sede = locationToSede(p.location)
      if (sede) q = q.eq('sede', sede)
      if (p.year) q = q.like('mese', `${p.year}-%`)
      if (p.from) q = q.gte('mese', p.from.substring(0, 7))
      if (p.to)   q = q.lte('mese', p.to.substring(0, 7))
      return sbFetch(q)
    } catch (e) { return swallow('analytics.mensile', e, []) }
  },

  kpiSummary: async (p = {}) => {
    try {
      const sede = locationToSede(p.location)
      let q = supabase.from('kpi_revenues').select('sede,period,op,totale,coperti,coperto_medio')
        .order('period', { ascending: false }).limit(200)
      if (sede) q = q.eq('sede', sede)
      if (p.from) q = q.gte('period', p.from.substring(0, 7))
      if (p.to)   q = q.lte('period', p.to.substring(0, 7))
      return sbFetch(q)
    } catch (e) { return swallow('analytics.kpiSummary', e, []) }
  },

  // Stagionalità: indici mensili dell'ultimo anno completo + coperto medio per sede
  seasonality: async (p = {}) => {
    try {
      const rows = await sbFetchPaged(
        () => supabase.from('chiusure_giornaliere')
          .select('id, sede, data, totale_venduto_ipratico, coperti, coperto_medio'),
        'id'
      )

      // Anno base = ultimo anno completo (dinamico, non hardcoded)
      const baseYear = String(new Date().getFullYear() - 1)
      const rows2025 = (rows ?? []).filter(r => r.data?.startsWith(baseYear))

      // Aggrega per mese_num
      const byMn = {}
      let totalVenduto = 0
      for (const r of rows2025) {
        const mn = parseInt(r.data.substring(5, 7))
        if (!byMn[mn]) byMn[mn] = { mese_num: mn, venduto: 0, coperti: 0, cm_sum: 0, n: 0 }
        const v = parseFloat(r.totale_venduto_ipratico) || 0
        byMn[mn].venduto += v; byMn[mn].coperti += parseInt(r.coperti)||0
        byMn[mn].cm_sum += parseFloat(r.coperto_medio)||0; byMn[mn].n++
        totalVenduto += v
      }

      const avgMonthly = Object.keys(byMn).length > 0 ? totalVenduto / Object.keys(byMn).length : 1

      // Mesi che intersecano il range selezionato (se passato)
      const mnFrom = p.from ? parseInt(p.from.substring(5, 7)) : 1
      const mnTo   = p.to   ? parseInt(p.to.substring(5, 7))   : 12
      const sameYear = !p.from || !p.to || p.from.substring(0, 4) === p.to.substring(0, 4)
      const inRangeMn = mn => !sameYear || (mn >= mnFrom && mn <= mnTo)

      const combined = []
      for (let mn = 1; mn <= 12; mn++) {
        const d = byMn[mn]
        combined.push({
          mese_num: mn,
          indice_combined: d && avgMonthly > 0 && inRangeMn(mn) ? Math.round(d.venduto / avgMonthly * 100) / 100 : null,
        })
      }

      // byLocation: coperto medio per mese e sede
      const byLoc = {}
      for (const r of rows2025) {
        const loc = r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA'
        const mn = parseInt(r.data.substring(5, 7))
        if (!byLoc[loc]) byLoc[loc] = {}
        if (!byLoc[loc][mn]) byLoc[loc][mn] = { mese_num: mn, cm_sum: 0, coperti: 0, n: 0 }
        byLoc[loc][mn].venduto_sum = (byLoc[loc][mn].venduto_sum||0) + (parseFloat(r.totale_venduto_ipratico)||0)
        byLoc[loc][mn].coperti += parseInt(r.coperti)||0; byLoc[loc][mn].n++
      }
      const byLocation = {}
      for (const [loc, byMnL] of Object.entries(byLoc)) {
        byLocation[loc] = Object.values(byMnL)
          .filter(d => inRangeMn(d.mese_num))
          .sort((a,b)=>a.mese_num-b.mese_num).map(d => ({
          mese_num: d.mese_num, avg_cm: d.coperti > 0 ? Math.round((d.venduto_sum||0)/d.coperti*100)/100 : 0, tot_coperti: d.coperti,
        }))
      }

      return { combined, byLocation }
    } catch (e) { return swallow('analytics.seasonality', e, null) }
  },

  // Previsioni prossimi 3 mesi via regressione lineare + stagionalità anno prec.
  // p.from/p.to: lo storico mostrato è filtrato sul periodo; la regressione usa tutta la serie.
  forecast: async (p = {}) => {
    try {
      const rows = await sbFetchPaged(
        () => supabase.from('chiusure_giornaliere')
          .select('id, sede, data, totale_venduto_ipratico, coperti'),
        'id'
      )

      // Indici stagionali dall'ultimo anno COMPLETO disponibile (combinati MA+PN).
      // Era hardcoded a '2025': dal 2027 la stagionalità sarebbe rimasta ferma
      // su un anno sempre più vecchio. Ora scorre indietro fino a trovare un
      // anno con dati (l'anno in corso è escluso perché incompleto).
      const annoRif = (() => {
        const anni = new Set((rows ?? []).map(r => r.data?.substring(0, 4)).filter(Boolean))
        const corrente = new Date().getFullYear()
        for (let y = corrente - 1; y >= corrente - 5; y--) if (anni.has(String(y))) return String(y)
        return String(corrente)   // fallback: solo l'anno in corso ha dati
      })()

      const byMnRif = {}
      let totRif = 0
      for (const r of rows ?? []) {
        if (!r.data?.startsWith(annoRif)) continue
        const mn = parseInt(r.data.substring(5, 7))
        if (!byMnRif[mn]) byMnRif[mn] = 0
        byMnRif[mn] += parseFloat(r.totale_venduto_ipratico) || 0
        totRif += parseFloat(r.totale_venduto_ipratico) || 0
      }
      const avgRif = Object.keys(byMnRif).length > 0 ? totRif / Object.keys(byMnRif).length : 0
      const seasonIdx = {}
      for (const [mn, v] of Object.entries(byMnRif)) {
        seasonIdx[parseInt(mn)] = avgRif > 0 ? Math.round(v / avgRif * 100) / 100 : 1.0
      }

      const byLocMese = {}
      for (const r of rows ?? []) {
        const loc = r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA'
        const mese = r.data?.substring(0, 7); if (!mese) continue
        const k = `${loc}-${mese}`
        if (!byLocMese[k]) byLocMese[k] = { loc, mese, venduto: 0, coperti: 0 }
        byLocMese[k].venduto += parseFloat(r.totale_venduto_ipratico) || 0
        byLocMese[k].coperti += parseInt(r.coperti) || 0
      }

      const result = {}
      for (const loc of ['MAMELI', 'PREDDA_NIEDDA']) {
        const locRows = Object.values(byLocMese).filter(r => r.loc === loc).sort((a, b) => a.mese.localeCompare(b.mese))
        if (locRows.length < 3) { result[loc] = { storico: [], forecasts: [], regressione: { r2: 0 } }; continue }

        const storico = locRows.map((r, i) => ({
          mese: r.mese, x: i,
          mese_label: MESI_IT_SHORT[parseInt(r.mese.substring(5, 7)) - 1] + ' ' + r.mese.substring(2, 4),
          tot_venduto: Math.round(r.venduto), tot_coperti: r.coperti,
        }))

        const n = storico.length
        const meanX = (n - 1) / 2
        const meanY = storico.reduce((s, d) => s + d.tot_venduto, 0) / n
        const meanC = storico.reduce((s, d) => s + d.tot_coperti, 0) / n
        let ssxy = 0, ssxx = 0, ssyy = 0, ssxyC = 0
        for (const d of storico) {
          ssxy += (d.x - meanX) * (d.tot_venduto - meanY); ssxx += (d.x - meanX) ** 2
          ssyy += (d.tot_venduto - meanY) ** 2; ssxyC += (d.x - meanX) * (d.tot_coperti - meanC)
        }
        const bV = ssxx > 0 ? ssxy / ssxx : 0, aV = meanY - bV * meanX
        const bC = ssxx > 0 ? ssxyC / ssxx : 0, aC = meanC - bC * meanX
        const r2 = ssxx > 0 && ssyy > 0 ? Math.round(ssxy ** 2 / (ssxx * ssyy) * 100) / 100 : 0

        const lastMese = storico[storico.length - 1].mese
        const forecasts = []
        for (let i = 1; i <= 3; i++) {
          const d = new Date(lastMese + '-15'); d.setMonth(d.getMonth() + i)
          const mese = d.toISOString().substring(0, 7), mn = parseInt(mese.substring(5, 7))
          const xF = n + i - 1
          const fvBase = Math.max(0, aV + bV * xF)
          const fcBase = Math.max(0, aC + bC * xF)
          // Applica indice stagionale 2025
          const coeff = seasonIdx[mn] || 1.0
          const fv = Math.round(fvBase * coeff)
          const fc = Math.round(fcBase * coeff)
          forecasts.push({
            mese,
            mese_label: MESI_IT_SHORT[mn - 1] + ' ' + mese.substring(2, 4),
            forecast_venduto: fv,
            forecast_min: Math.round(fv * 0.88),
            forecast_max: Math.round(fv * 1.12),
            forecast_coperti: fc,
            tendenza: (bV * coeff) > 0 ? 'crescita' : 'calo',
            coeff_stagionale: String(coeff),
          })
        }
        // Filtra lo storico mostrato sul periodo selezionato (mesi che intersecano il range)
        const meseFrom = p.from ? p.from.substring(0, 7) : null
        const meseTo   = p.to   ? p.to.substring(0, 7)   : null
        const storicoFiltrato = storico.filter(s =>
          (!meseFrom || s.mese >= meseFrom) && (!meseTo || s.mese <= meseTo)
        )

        result[loc] = { storico: storicoFiltrato.length ? storicoFiltrato : storico, forecasts, regressione: { r2 } }
      }
      return result
    } catch (e) { return swallow('analytics.forecast', e, null) }
  },

  // Target operatori — fonte: kpi_revenues (coperti e fatturato reali per operatore)
  // p.from/p.to: limita i mesi kpi_revenues considerati al periodo selezionato
  operatorTargets: async (p = {}) => {
    try {
      const now = new Date()
      // Mese target = prossimo mese
      const targetD = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      const targetAnno = targetD.getFullYear()
      const targetMeseNum = targetD.getMonth() + 1 // 1-12

      // Dati kpi_revenues nel periodo selezionato (default: anno corrente)
      const periodFrom = p.from ? p.from.substring(0, 7) : `${now.getFullYear()}-01`
      const periodTo   = p.to   ? p.to.substring(0, 7)   : null
      let qKpi = supabase
        .from('kpi_revenues')
        .select('sede, period, op, totale, coperti, coperto_medio')
        .gte('period', periodFrom)
        .order('period')
      if (periodTo) qKpi = qKpi.lte('period', periodTo)
      const { data: kpiRows } = await qKpi

      if (!kpiRows?.length) return []

      // Normalizza nomi operatori (uppercase, trim) per cross-period matching
      const normalize = n => (n || '').trim().toUpperCase()
      const SKIP_OPS = new Set(['PIENISSIMO', 'TECNICO', 'EXTRA', '', 'LAURA']) // LAURA PN ha 3 coperti anomali

      const byOp = {}
      for (const r of kpiRows) {
        const normOp = normalize(r.op)
        // Salta operatori di sistema e anomalie
        if (SKIP_OPS.has(normOp) && r.sede === 'PN') continue
        if (['PIENISSIMO', 'TECNICO', 'EXTRA', ''].includes(normOp)) continue

        const key = `${r.sede}|${normOp}`
        if (!byOp[key]) byOp[key] = {
          sede: r.sede, normOp,
          displayOp: r.op,
          mesi: {},
          lastCM: 0, lastTotale: 0, lastPeriod: '',
        }
        byOp[key].mesi[r.period] = {
          coperti: parseInt(r.coperti) || 0,
          totale: parseFloat(r.totale) || 0,
          cm: parseFloat(r.coperto_medio) || 0,
        }
        // Teniamo il CM dell'ultimo mese con fatturato reale
        if ((parseFloat(r.totale) || 0) > 0 && r.period >= byOp[key].lastPeriod) {
          byOp[key].lastCM = parseFloat(r.coperto_medio) || 0
          byOp[key].lastTotale = parseFloat(r.totale) || 0
          byOp[key].lastPeriod = r.period
          byOp[key].displayOp = r.op // nome più recente (già corretto)
        }
      }

      // Indici stagionali dall'ultimo anno completo (dinamico, per sede)
      const baseYear = new Date().getFullYear() - 1
      const rows2025 = await sbFetchPaged(
        () => supabase.from('chiusure_giornaliere')
          .select('id, sede, data, totale_venduto_ipratico')
          .gte('data', `${baseYear}-01-01`).lte('data', `${baseYear}-12-31`),
        'id'
      )

      const bySedeM = { MA: {}, PN: {} }
      for (const r of rows2025 ?? []) {
        const mn = parseInt(r.data?.substring(5, 7))
        const sede = r.sede
        if (!bySedeM[sede]?.[mn]) { if (!bySedeM[sede]) bySedeM[sede] = {}; bySedeM[sede][mn] = 0 }
        bySedeM[sede][mn] += parseFloat(r.totale_venduto_ipratico) || 0
      }
      const coeffStagionale = { MA: 1.0, PN: 1.0 }
      for (const sede of ['MA', 'PN']) {
        const mensili = Object.values(bySedeM[sede] || {})
        const media = mensili.length > 0 ? mensili.reduce((a, b) => a + b, 0) / mensili.length : 0
        const meseV = bySedeM[sede]?.[targetMeseNum] || 0
        if (media > 0 && meseV > 0) coeffStagionale[sede] = Math.round(meseV / media * 100) / 100
      }

      // Totale coperti nell'ultimo mese disponibile per quota di mercato
      const lastAvailPeriod = Object.values(byOp)
        .flatMap(o => Object.keys(o.mesi)).sort().at(-1) || ''
      const totCopertiSede = { MA: 0, PN: 0 }
      for (const op of Object.values(byOp)) {
        totCopertiSede[op.sede] = (totCopertiSede[op.sede] || 0) + (op.mesi[lastAvailPeriod]?.coperti || 0)
      }

      const MESI_IT_LONG = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                            'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
      const FATTORE_TARGET = 1.10

      const results = []
      for (const op of Object.values(byOp)) {
        const sortedP = Object.keys(op.mesi).sort()
        if (sortedP.length === 0) continue

        // Media ultimi 2 mesi di coperti
        const last2 = sortedP.slice(-2)
        const media2m_coperti = last2.length > 0
          ? Math.round(last2.reduce((s, m) => s + (op.mesi[m]?.coperti || 0), 0) / last2.length)
          : 0

        // Trend coperti
        const trend = sortedP.length >= 2
          ? ((op.mesi[sortedP.at(-1)]?.coperti || 0) >= (op.mesi[sortedP.at(-2)]?.coperti || 0) ? 'up' : 'down')
          : 'neutral'

        const coeff = coeffStagionale[op.sede] || 1.0
        const copertiTarget = Math.round(media2m_coperti * coeff * FATTORE_TARGET)
        const cmUse = op.lastCM > 0 ? op.lastCM : 15
        const vendutoTarget = Math.round(copertiTarget * cmUse)

        // Quota di mercato su coperti ultimo mese
        const totSede = totCopertiSede[op.sede] || 1
        const lastCop = op.mesi[lastAvailPeriod]?.coperti || 0
        const quotaPct = Math.round(lastCop / totSede * 100)

        // Score composito: quota × 2 + trend + bonus CM reale
        const score = Math.min(100, Math.max(0, Math.round(
          quotaPct * 2 + (trend === 'up' ? 15 : -5) + (op.lastCM > 0 ? 15 : 0)
        )))

        const mesiObj = {}
        for (const [m, d] of Object.entries(op.mesi)) {
          mesiObj[m] = { coperti: d.coperti, totale: Math.round(d.totale), cm: d.cm }
        }

        results.push({
          operatore: op.displayOp,
          location: op.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA',
          sede: op.sede,
          storico: { media2m_coperti, media2m_cm: op.lastCM, mesi_dispo: sortedP.length },
          target: {
            coperti_target: copertiTarget,
            venduto_target: vendutoTarget,
            target_fattore_pct: 10,
            periodo: `${MESI_IT_LONG[targetMeseNum - 1]} ${targetAnno}`,
            coeff_stagionale: String(coeff),
          },
          performance: {
            score,
            quota_mercato_pct: quotaPct,
            trend,
            upsell_rate: op.lastCM > 0 ? Math.round(op.lastCM * 10) / 10 : null,
          },
          mesi: mesiObj,
        })
      }

      return results.sort((a, b) => {
        if (a.sede !== b.sede) return a.sede.localeCompare(b.sede)
        return b.storico.media2m_coperti - a.storico.media2m_coperti
      })
    } catch (e) {
      console.error('operatorTargets error:', e)
      return []
    }
  },

  // Heatmap per giorno della settimana + top 5 giorni storici
  heatmap: async (p = {}) => {
    try {
      const rows = await sbFetchPaged(
        () => applyDateRange(
          supabase.from('chiusure_giornaliere')
            .select('id, sede, data, totale_venduto_ipratico, coperti, coperto_medio'),
          p.from, p.to
        ),
        'id'
      )

      const DOW = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab']
      const byDow = {}
      for (let i=0;i<7;i++) byDow[i]={dow:i,label:DOW[i],venduto_sum:0,coperti_sum:0,n:0}

      const allDays = []
      for (const r of rows ?? []) {
        const d = new Date(r.data+'T12:00:00'), dow = d.getDay()
        const v = parseFloat(r.totale_venduto_ipratico)||0
        byDow[dow].venduto_sum+=v; byDow[dow].coperti_sum+=parseInt(r.coperti)||0; byDow[dow].n++
        allDays.push({ data:r.data, location:r.sede==='MA'?'MAMELI':'PREDDA_NIEDDA',
          venduto:Math.round(v), coperti:parseInt(r.coperti)||0, cm:Math.round((parseFloat(r.coperto_medio)||0)*100)/100 })
      }

      const byDowFinal = {}
      for (const [i,d] of Object.entries(byDow)) {
        byDowFinal[i]={dow:parseInt(i),label:d.label,
          avg_venduto:d.n>0?Math.round(d.venduto_sum/d.n):0,
          avg_coperti:d.n>0?Math.round(d.coperti_sum/d.n):0}
      }

      allDays.sort((a,b)=>b.venduto-a.venduto)
      return { byDow: byDowFinal, top5: allDays.slice(0,5) }
    } catch (e) { return swallow('analytics.heatmap', e, null) }
  },

  // BE mensile: costi (personale + fatture + fissi) vs incasso per sede
  // Regola: costo_personale resta CONDIVISO tra i 2 locali (50% ciascuno).
  // costo_fatture NO: dal 05/08/2026 arriva già attribuito per sede da
  // v_costi_mensili, che applica in quest'ordine
  //   1. sede certa  → 100% a quella sede (destinazione letta dall'XML SdI)
  //   2. sede NULL   → sede_ma_pct / sede_pn_pct (riparto sul mix verificato)
  // Il vecchio 50/50 forzato buttava via quell'attribuzione ed è stato rimosso.
  // I costi_fissi rimangono per-sede (affitti, indennizzi specifici)
  beMensile: async (p = {}) => {
    try {
      const now = new Date()
      // Anno e mesi derivati dal periodo selezionato (default: anno corrente fino a oggi)
      const annoCorrente = p.to ? parseInt(p.to.substring(0, 4)) : now.getFullYear()
      const meseCorrente = p.to ? parseInt(p.to.substring(5, 7)) : now.getMonth() + 1  // 1-12
      const meseFromNum  = p.from && p.from.substring(0, 4) === String(annoCorrente)
        ? parseInt(p.from.substring(5, 7)) : 1
      const meseFromPad = String(meseFromNum).padStart(2, '0')
      const mesePad = String(meseCorrente).padStart(2, '0')

      const [{ data: costiRows }, { data: chiusureRows }, { data: spesaRows }] = await Promise.all([
        supabase.from('v_costi_mensili').select('*').eq('anno', annoCorrente).order('mese'),
        supabase.from('v_chiusure_mensile').select('sede, mese, tot_venduto, tot_coperti, n_giorni')
          .gte('mese', `${annoCorrente}-${meseFromPad}`).lte('mese', `${annoCorrente}-${mesePad}`),
        // quanta parte della spesa del mese poggia su una destinazione certa
        supabase.from('v_spesa_sede_mese').select('mese, sede, pct_certa')
          .gte('mese', `${annoCorrente}-01-01`).lte('mese', `${annoCorrente}-12-31`),
      ])

      // Lookup affidabilità attribuzione fatture per sede-mese
      const certMap = {}
      for (const r of spesaRows ?? []) {
        const mn = parseInt(String(r.mese).split('-')[1])
        certMap[`${r.sede}-${mn}`] = parseFloat(r.pct_certa) || 0
      }

      // Lookup incasso per sede-mese
      const revMap = {}
      for (const r of chiusureRows ?? []) {
        const mn = parseInt(r.mese.split('-')[1])
        revMap[`${r.sede}-${mn}`] = {
          incasso: parseFloat(r.tot_venduto) || 0,
          coperti: parseInt(r.tot_coperti) || 0,
          giorni: parseInt(r.n_giorni) || 0,
        }
      }

      // Attribuzione fatture "non affidabile" = meno del 40% della spesa del mese
      // ha una destinazione certa nell'XML. Prima era una lista fissa di mesi.
      const SOGLIA_CERTEZZA = 40
      const isUnreliable = (key) => (certMap[key] ?? 0) < SOGLIA_CERTEZZA

      // --- Step 1: costruisci righe grezze per sede ---
      const rawBySede = {}   // { mese: { MA: {...}, PN: {...} } }
      for (const r of costiRows ?? []) {
        if (r.mese > meseCorrente || r.mese < meseFromNum) continue
        const mn = r.mese
        if (!rawBySede[mn]) rawBySede[mn] = {}
        rawBySede[mn][r.sede] = {
          costo_personale: parseFloat(r.costo_personale) || 0,
          costo_fatture:   parseFloat(r.costo_fatture)   || 0,
          costo_fissi:     parseFloat(r.costo_fissi)     || 0,
        }
      }

      // --- Step 2: personale 50/50; fatture già attribuite per sede ---
      // I costi_fissi restano per-sede (affitti, indennizzi specifici di ogni locale)
      const result = []
      for (const [mese, bySede] of Object.entries(rawBySede)) {
        const mn = parseInt(mese)
        const maRaw = bySede['MA'] || { costo_personale: 0, costo_fatture: 0, costo_fissi: 0 }
        const pnRaw = bySede['PN'] || { costo_personale: 0, costo_fatture: 0, costo_fissi: 0 }

        // Personale: resta condiviso al 50%
        const totPersonale = maRaw.costo_personale + pnRaw.costo_personale
        const personalePerSede = Math.round(totPersonale / 2)
        // Fatture: NON si dividono. v_costi_mensili le ha già ripartite per sede
        // (100% dove la destinazione è certa, percentuali dove è stimata).
        const totFatture = maRaw.costo_fatture + pnRaw.costo_fatture

        for (const sede of ['MA', 'PN']) {
          const raw = bySede[sede]
          if (!raw) continue  // nessun dato per questa sede in questo mese

          const revKey = `${sede}-${mn}`
          const rev = revMap[revKey] || { incasso: 0, coperti: 0, giorni: 0 }

          const costo_personale = personalePerSede
          const costo_fatture   = Math.round(raw.costo_fatture)
          const costo_fissi     = raw.costo_fissi
          const be_totale       = costo_personale + costo_fatture + costo_fissi
          const incasso         = rev.incasso
          const margine         = incasso > 0 ? incasso - be_totale : null
          const margine_pct     = incasso > 0 ? Math.round(margine / incasso * 100) : null

          result.push({
            sede,
            anno: annoCorrente,
            mese: mn,
            mese_label: MESI_IT_SHORT[mn - 1],
            incasso,
            coperti: rev.coperti,
            giorni: rev.giorni,
            costo_personale,
            costo_fatture,
            costo_fissi,
            be_totale,
            margine,
            margine_pct,
            fatture_unreliable: isUnreliable(revKey),
            fatture_pct_certa:  certMap[revKey] ?? null,
            has_real_data: incasso > 0 && be_totale > 0,
            // metadati per il box "calcolo semplice" (totali originali)
            _tot_personale: totPersonale,
            _tot_fatture:   totFatture,
          })
        }
      }

      return result.sort((a, b) => a.mese - b.mese || a.sede.localeCompare(b.sede))
    } catch (e) {
      console.error('beMensile error:', e)
      return []
    }
  },
}

// ─── BUSTE PAGA ───────────────────────────────────────────────────────────
// Coefficienti costo-azienda derivati dall'ANALISI DI 769 BUSTE PAGA REALI (2026):
//   costo_azienda ≈ lordo (totale_competenze) × 1.44   ← carico datoriale (INPS c/ditta + TFR + INAIL)
//   costo_azienda ≈ paga_base × 1.47
//   costo_azienda ≈ netto × 1.79
// (il vecchio 1.9653 applicato a paga_base/netto SOVRASTIMAVA il costo del personale del ~10-35%)
// Usati SOLO come fallback quando costo_azienda non è salvato nel DB.
const COSTO_AZ_DA_LORDO    = 1.44
const COSTO_AZ_DA_PAGABASE = 1.47
const COSTO_AZ_DA_NETTO    = 1.79
const IVA_FORFAIT_PCT      = 0.10  // forfait IVA 10% sul venduto (regime 140 Grammi)

// Stima il costo azienda con cascata: costo reale → lordo → paga_base → netto.
// Distingue esplicitamente LORDO (totale_competenze) da NETTO per non confonderli.
function stimaCostoAzienda(r) {
  const reale = parseFloat(r?.costo_azienda)
  if (reale > 0) return reale
  const lordo = parseFloat(r?.totale_competenze) || 0
  if (lordo > 0) return +(lordo * COSTO_AZ_DA_LORDO).toFixed(2)
  const pagaBase = parseFloat(r?.paga_base) || 0
  if (pagaBase > 0) return +(pagaBase * COSTO_AZ_DA_PAGABASE).toFixed(2)
  const netto = parseFloat(r?.netto) || 0
  if (netto > 0) return +(netto * COSTO_AZ_DA_NETTO).toFixed(2)
  return 0
}

const MESI_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                 'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']

export const bustePaga = {
  // Lista cedolini (filtro anno, mese, sede)
  // Regola PT: full time = 160h/mese 40h/sett | PT 62.5% = 100h/mese 25h/sett | PT 75% = 120h/mese 30h/sett | PT 50% = 80h/mese 20h/sett
  getAll: async (p = {}) => {
    const build = () => {
      let q = supabase.from('buste_paga').select('*')
      if (p.anno)  q = q.eq('anno', parseInt(p.anno))
      if (p.mese)  q = q.eq('mese', parseInt(p.mese))
      if (p.sede && p.sede !== 'Tutte') q = q.eq('sede', p.sede)
      return q
    }
    // Paginazione reale su `id`; l'ordinamento di presentazione (anno/mese desc,
    // nome asc) si applica dopo, perché su colonne non univoche la paginazione
    // lato server non è stabile.
    const rows = (await sbFetchPaged(build, 'id')).sort((a, b) =>
      (b.anno - a.anno) || (b.mese - a.mese) ||
      String(a.employee_name || '').localeCompare(String(b.employee_name || ''))
    )
    return rows.map(r => {
      // Usa costo_azienda salvato dal LUL PDF.
      // Fallback CCNL: paga_base × 1.9653, poi netto × 1.9653
      // Cascata costo azienda: reale → lordo×1.44 → paga_base×1.47 → netto×1.79
      const costoAz = stimaCostoAzienda(r)
      // Calcola ore da percentuale_pt se presente, altrimenti stima da netto
      const pct    = r.percentuale_pt ? parseFloat(r.percentuale_pt) : (
        parseFloat(r.netto) >= 1400 ? 100 :
        parseFloat(r.netto) >= 1100 ? 75  :
        parseFloat(r.netto) >= 800  ? 62.5 : 50
      )
      const oreMensili    = r.ore_mensili     ?? Math.round(160 * pct / 100)
      const oreSettimanali = r.ore_settimanali ?? Math.round(40  * pct / 100)
      return {
        ...r,
        location:       r.sede === 'MA' ? 'MA' : r.sede === 'PN' ? 'PN' : r.sede,
        costo_azienda:  costoAz,
        mese_label:     MESI_IT[(r.mese || 1) - 1],
        percentuale_pt: pct,
        ore_mensili:    oreMensili,
        ore_settimanali: oreSettimanali,
      }
    })
  },

  // Riepilogo aggregato per sede/mese
  riepilogo: async (p = {}) => {
    // I filtri sede/mese erano ignorati: si scaricava l'intera tabella e, oltre
    // le 1000 righe, PostgREST troncava in silenzio → costo personale sottostimato
    const build = () => {
      let q = supabase.from('buste_paga')
        .select('id,sede,anno,mese,netto,costo_azienda,paga_base,totale_competenze,employee_code,employee_name')
      if (p.anno) q = q.eq('anno', parseInt(p.anno))
      const sedeFiltro = locationToSede(p.sede || p.location)
      if (sedeFiltro) q = q.eq('sede', sedeFiltro)
      if (p.mese)    q = q.eq('mese', parseInt(p.mese))
      return q
    }
    const rows = await sbFetchPaged(build, 'id')
    // Aggrega per sede+anno+mese
    const map = {}
    for (const r of rows) {
      const key = `${r.sede}-${r.anno}-${r.mese}`
      if (!map[key]) map[key] = { sede: r.sede, location: r.sede === 'MA' ? 'MA' : 'PN', anno: r.anno, mese: r.mese, totale_netto: 0, totale_costo: 0, n_dipendenti: 0, emps: new Set() }
      map[key].totale_netto += parseFloat(r.netto) || 0
      // Cascata costo azienda: reale → lordo×1.44 → paga_base×1.47 → netto×1.79
      const costoAz = stimaCostoAzienda(r)
      map[key].totale_costo += costoAz
      // Conta la persona anche quando employee_code manca: l'identita' di
      // ripiego e' il nome del cedolino, altrimenti il mese sparisce dal conteggio.
      const chiaveDip = r.employee_code || r.employee_name
      if (chiaveDip) map[key].emps.add(chiaveDip)
    }
    return Object.values(map).map(r => ({
      sede: r.sede, location: r.location, anno: r.anno, mese: r.mese,
      totale_netto: +r.totale_netto.toFixed(2),
      totale_costo: +r.totale_costo.toFixed(2),
      n_dipendenti: r.emps.size,
    }))
  },

  // Stato dipendenti (active/inactive, ultimo mese cedolino)
  // Usa employee_id FK (ora popolato al 100%) con fallback su employee_code
  statoDipendenti: async () => {
    // Fonte UNICA: tabella buste_paga.
    // Attivo = presente nell'ultimo mese caricato (MAX anno+mese nel DB).
    const busteRows = await sbFetchPaged(
      () => supabase.from('buste_paga')
        .select('id,employee_id,employee_code,employee_name,sede,anno,mese,netto'),
      'id'
    )
    // 1. Trova il periodo globale massimo (ultima busta paga caricata)
    let maxPeriod = 0
    for (const b of busteRows) {
      const p = (b.anno || 0) * 100 + (b.mese || 0)
      if (p > maxPeriod) maxPeriod = p
    }
    // 2. Aggrega per nome dipendente (chiave = nome + sede)
    const byKey = {}
    for (const b of busteRows) {
      const nome = (b.employee_name || b.employee_code || '—').trim().toUpperCase()
      const key  = `${nome}|${b.sede || ''}`
      if (!byKey[key]) byKey[key] = {
        employee_name: nome,
        employee_code: b.employee_code || null,
        employee_id:   b.employee_id   || null,
        location:      b.sede          || null,
        totale_buste:  0,
        totale_netto:  0,
        ultimo_anno:   0,
        ultimo_mese:   0,
        in_ultimo_mese: false,
      }
      byKey[key].totale_buste++
      byKey[key].totale_netto += parseFloat(b.netto) || 0
      const period = (b.anno || 0) * 100 + (b.mese || 0)
      if (period > byKey[key].ultimo_anno * 100 + byKey[key].ultimo_mese) {
        byKey[key].ultimo_anno  = b.anno
        byKey[key].ultimo_mese  = b.mese
      }
      if (period === maxPeriod) byKey[key].in_ultimo_mese = true
    }
    return Object.values(byKey)
      .sort((a, b) => (a.employee_name || '').localeCompare(b.employee_name || ''))
      .map(e => ({
        employee_name:     e.employee_name,
        employee_code:     e.employee_code,
        employee_id:       e.employee_id,
        location:          e.location,
        attivo:            e.in_ultimo_mese ? 1 : 0,
        totale_buste:      e.totale_buste,
        totale_netto:      +e.totale_netto.toFixed(2),
        ultimo_anno:       e.ultimo_anno  || null,
        ultimo_mese:       e.ultimo_mese  || null,
        ultimo_mese_label: e.ultimo_mese ? MESI_IT[e.ultimo_mese - 1] : null,
      }))
  },

  // Costo mensile aggregato
  costoMensile: async (p = {}) => {
    // Paginazione reale: senza, PostgREST tronca a 1000 righe senza segnalarlo
    const build = () => {
      let q = supabase.from('buste_paga')
        .select('id,sede,anno,mese,netto,costo_azienda,paga_base,totale_competenze')
      if (p.anno) q = q.eq('anno', parseInt(p.anno))
      const sedeFiltro = locationToSede(p.sede || p.location)
      if (sedeFiltro) q = q.eq('sede', sedeFiltro)
      if (p.mese)    q = q.eq('mese', parseInt(p.mese))
      return q
    }
    const rows = await sbFetchPaged(build, 'id')
    const map = {}
    for (const r of rows) {
      const key = `${r.sede}-${r.anno}-${r.mese}`
      if (!map[key]) map[key] = { sede: r.sede, location: r.sede, anno: r.anno, mese: r.mese, netto_totale: 0, costo_totale: 0 }
      map[key].netto_totale += parseFloat(r.netto) || 0
      // Cascata costo azienda: reale → lordo×1.44 → paga_base×1.47 → netto×1.79
      const costoAz = stimaCostoAzienda(r)
      map[key].costo_totale += costoAz
    }
    return Object.values(map).map(r => ({
      ...r,
      netto_totale: +r.netto_totale.toFixed(2),
      costo_totale: +r.costo_totale.toFixed(2),
    }))
  },

  // Inserisci nuovo cedolino
  insert: async (d) => {
    // Risolvi employee_id se non passato (cerca per code o nome)
    let employeeId = d.employee_id || null
    if (!employeeId && (d.employee_code || d.employee_name)) {
      let q = supabase.from('employees').select('id')
      if (d.employee_code) q = q.eq('code', d.employee_code)
      else                  q = q.ilike('name', escapeLike(d.employee_name))
      const { data: found } = await q.limit(1).single()
      if (found) employeeId = found.id
    }

    const row = {
      employee_code: d.employee_code || null,
      employee_name: d.employee_name,
      sede:          d.sede,
      anno:          parseInt(d.anno),
      mese:          parseInt(d.mese),
      netto:         parseFloat(d.netto) || 0,
      file_name:     d.file_name || null,
      note:          d.note || null,
    }
    if (employeeId)        row.employee_id       = employeeId
    if (d.ore_mensili)     row.ore_mensili        = parseInt(d.ore_mensili)
    if (d.ore_settimanali) row.ore_settimanali    = parseInt(d.ore_settimanali)
    if (d.percentuale_pt)  row.percentuale_pt     = parseFloat(d.percentuale_pt)

    // UPSERT, non insert: reimportare lo stesso LUL raddoppiava i netti dello
    // stesso dipendente/mese, gonfiando costo del personale, BE e target KPI.
    // Vincolo esistente su Supabase: uq_buste_paga_dipendente_periodo.
    const { data, error } = await supabase
      .from('buste_paga')
      .upsert(row, { onConflict: 'employee_name,anno,mese' })
      .select().single()
    if (error) throw error

    // ── CASCADE: upsert employee_regole con ore della busta paga ─────────
    if (employeeId && (d.ore_mensili || d.ore_settimanali)) {
      const regole = {
        employee_id:          employeeId,
        updated_at:           new Date().toISOString(),
      }
      if (d.ore_mensili)     regole.ore_contratto_mensili = parseInt(d.ore_mensili)
      if (d.ore_settimanali) regole.ore_settimanali       = parseInt(d.ore_settimanali)
      // Calcola turni_min/max da ore mensili se non presenti
      const ore = parseInt(d.ore_mensili) || 0
      if (ore >= 160) { regole.turni_min_settimana = 4; regole.turni_max_settimana = 5 }
      else if (ore >= 100) { regole.turni_min_settimana = 3; regole.turni_max_settimana = 4 }
      else if (ore > 0)    { regole.turni_min_settimana = 2; regole.turni_max_settimana = 3 }
      await supabase.from('employee_regole')
        .upsert(regole, { onConflict: 'employee_id' })
    }

    try { localStorage.setItem('crm_employee_updated', JSON.stringify({ id: employeeId, ts: Date.now() })) } catch (_) {}

    return { id: data.id }
  },

  // Aggiorna netto / ore / note
  update: async (id, d) => {
    const payload = {}
    if (d.netto !== undefined)         payload.netto          = parseFloat(d.netto)
    if (d.note !== undefined)          payload.note           = d.note
    if (d.ore_mensili !== undefined)   payload.ore_mensili    = parseInt(d.ore_mensili)
    if (d.ore_settimanali !== undefined) payload.ore_settimanali = parseInt(d.ore_settimanali)
    if (d.percentuale_pt !== undefined)  payload.percentuale_pt  = parseFloat(d.percentuale_pt)
    const { error } = await supabase.from('buste_paga').update(payload).eq('id', id)
    if (error) throw error

    // ── CASCADE: se cambiano ore → aggiorna employee_regole ──────────────
    if ((d.ore_mensili !== undefined || d.ore_settimanali !== undefined) && d.employee_id) {
      const regole = { employee_id: d.employee_id, updated_at: new Date().toISOString() }
      if (d.ore_mensili !== undefined)   regole.ore_contratto_mensili = parseInt(d.ore_mensili)
      if (d.ore_settimanali !== undefined) regole.ore_settimanali     = parseInt(d.ore_settimanali)
      await supabase.from('employee_regole')
        .upsert(regole, { onConflict: 'employee_id' })
    }

    return { success: true }
  },

  // Elimina cedolino
  delete: async (id) => {
    const { error } = await supabase.from('buste_paga').delete().eq('id', id)
    if (error) throw error
    return { success: true }
  },

  sync: async () => ({ success: true, message: 'Usa "Aggiungi" per inserire cedolini manualmente' }),
}

// ─── STATISTICHE — da chiusure_giornaliere e kpi_revenues ────────────────
export const statistiche = {
  // KPI riepilogo per sede
  getAll: async (p = {}) => {
    try {
      const sede = locationToSede(p.location)
      const build = () => {
        let q = supabase.from('chiusure_giornaliere')
          .select('id,sede,data,totale_venduto_ipratico,coperti,coperto_medio,scontrino_medio')
        if (sede) q = q.eq('sede', sede)
        if (p.from) q = q.gte('data', p.from)
        if (p.to)   q = q.lte('data', p.to)
        return q
      }
      const rows = await sbFetchPaged(build, 'id')
      const bySede = {}
      for (const r of rows) {
        const s = r.sede
        if (!bySede[s]) bySede[s] = { sede: s, tot_venduto: 0, tot_coperti: 0, n_giorni: 0, _cm: 0, _sm: 0 }
        bySede[s].tot_venduto  += parseFloat(r.totale_venduto_ipratico) || 0
        bySede[s].tot_coperti  += parseInt(r.coperti) || 0
        bySede[s]._cm          += parseFloat(r.coperto_medio) || 0
        bySede[s]._sm          += parseFloat(r.scontrino_medio) || 0
        bySede[s].n_giorni++
      }
      return Object.values(bySede).map(s => ({
        ...s,
        avg_coperto_medio:   s.tot_coperti > 0 ? +(s.tot_venduto / s.tot_coperti).toFixed(2) : 0,
        avg_scontrino_medio: s.n_giorni > 0 ? +(s._sm / s.n_giorni).toFixed(2) : 0,
      }))
    } catch (e) { return swallow('statistiche.getAll', e, []) }
  },

  // Fasce orarie simulate da giornaliero (iPratico non esporta ore)
  fasceOrarie: async (p = {}) => {
    try {
      const sede = locationToSede(p.location)
      let q = supabase.from('chiusure_giornaliere')
        .select('sede,data,totale_venduto_ipratico,coperti')
        .order('data', { ascending: false }).limit(60)
      if (sede) q = q.eq('sede', sede)
      if (p.from) q = q.gte('data', p.from)
      if (p.to)   q = q.lte('data', p.to)
      const rows = await sbFetch(q)
      // Distribuzione simulata su fasce tipiche ristorante
      const FASCE = [
        { fascia: '12:00-13:00', pct: 0.18 },
        { fascia: '13:00-14:00', pct: 0.32 },
        { fascia: '14:00-15:00', pct: 0.14 },
        { fascia: '15:00-16:00', pct: 0.04 },
        { fascia: '19:30-20:30', pct: 0.12 },
        { fascia: '20:30-21:30', pct: 0.28 },
        { fascia: '21:30-22:30', pct: 0.20 },
        { fascia: '22:30-23:30', pct: 0.08 },
      ]
      const totVenduto = rows.reduce((s, r) => s + (parseFloat(r.totale_venduto_ipratico) || 0), 0)
      const totCoperti = rows.reduce((s, r) => s + (parseInt(r.coperti) || 0), 0)
      const nGiorni    = Math.max(rows.length, 1)
      // Stima tavoli: coperto medio iPratico ~2.5 persone/tavolo
      const PERSONE_PER_TAVOLO = 2.5
      return FASCE.map(f => {
        const venduto_fascia  = +(totVenduto * f.pct).toFixed(2)
        const coperti_fascia  = Math.round(totCoperti * f.pct)
        const tavoli_fascia   = Math.round(coperti_fascia / nGiorni / PERSONE_PER_TAVOLO)
        const avg_incasso     = coperti_fascia > 0 ? +(venduto_fascia / coperti_fascia).toFixed(2) : 0
        return {
          fascia:       f.fascia,
          venduto:      venduto_fascia,
          coperti:      coperti_fascia,
          n_tavoli:     Math.max(tavoli_fascia, 0),
          avg_incasso,          // € medio per coperto in quella fascia
          incasso_totale: venduto_fascia,
          n_coperti:    coperti_fascia,
        }
      })
    } catch (e) { return swallow('statistiche.fasceOrarie', e, []) }
  },

  // Operatori da v_fatturato_operatore_mensile (solo veri camerieri da venduto_camerieri)
  operatori: async (p = {}) => {
    try {
      const sede = locationToSede(p.location)
      // Usa v_fatturato_operatore_mensile — esclude personale non-sala (cucina, tecnico, ecc.)
      let q = supabase.from('v_fatturato_operatore_mensile').select('operator,sede,anno,mese,fatturato_totale,pezzi_totali')
      if (sede) q = q.eq('sede', sede)
      if (p.from) {
        const [y, m] = p.from.substring(0, 7).split('-')
        if (y && m) q = q.gte('anno', parseInt(y))
      }
      if (p.to) {
        const [y, m] = p.to.substring(0, 7).split('-')
        if (y && m) q = q.lte('anno', parseInt(y))
      }
      const rows = await sbFetch(q)
      const PSEUDO_OPS = ['pienissimo', 'extra', 'tecnico']
      const byOp = {}
      for (const r of rows) {
        if (!r.operator || PSEUDO_OPS.includes(r.operator.toLowerCase())) continue
        const k = `${r.sede}|${r.operator}`
        if (!byOp[k]) byOp[k] = { operatore: r.operator, sede: r.sede, location: r.sede, tot_coperti: 0, tot_importo: 0, n_periodi: 0 }
        byOp[k].tot_coperti += parseInt(r.pezzi_totali) || 0
        byOp[k].tot_importo += parseFloat(r.fatturato_totale) || 0
        byOp[k].n_periodi++
      }
      return Object.values(byOp)
        .map(o => ({
          ...o,
          totale_incasso: +o.tot_importo.toFixed(2),
          n_tavoli:       Math.round(o.tot_coperti),   // pezzi venduti come proxy coperti
          media_permanenza: null,                        // non disponibile da v_fatturato_operatore_mensile
          coperto_medio: o.tot_coperti > 0 && o.tot_importo > 0 ? +(o.tot_importo / o.tot_coperti).toFixed(2) : 0,
        }))
        .sort((a, b) => b.totale_incasso - a.totale_incasso)
    } catch (e) { return swallow('statistiche.operatori', e, []) }
  },

  // Tavoli da statistiche_tavoli
  tavoli: async (p = {}) => {
    try {
      const sede = locationToSede(p.location)
      const build = () => {
        let q = supabase.from('statistiche_tavoli')
          .select('id,sede,tavolo,n_coperti,n_ordini,incasso,durata_media_min,scontrino_medio')
        if (sede) q = q.eq('sede', sede)
        // Overlap interval filter
        if (p.to)   q = q.lte('data_inizio', p.to)
        if (p.from) q = q.gte('data_fine', p.from)
        return q
      }
      const rows = await sbFetchPaged(build, 'id')
      // Aggrega per tavolo (ci possono essere più periodi)
      const byTavolo = {}
      for (const r of rows) {
        const k = `${r.sede}|${r.tavolo}`
        if (!byTavolo[k]) byTavolo[k] = { tavolo: r.tavolo, sede: r.sede, tot_coperti: 0, tot_ordini: 0, tot_incasso: 0, durata_sum: 0, durata_n: 0 }
        byTavolo[k].tot_coperti  += parseInt(r.n_coperti) || 0
        byTavolo[k].tot_ordini   += parseInt(r.n_ordini)  || 0
        byTavolo[k].tot_incasso  += parseFloat(r.incasso) || 0
        if (r.durata_media_min) { byTavolo[k].durata_sum += parseFloat(r.durata_media_min); byTavolo[k].durata_n++ }
      }
      const tavoli = Object.values(byTavolo)
      const maxOrdini = Math.max(...tavoli.map(t => t.tot_ordini), 1)
      return tavoli
        .map(t => ({
          tavolo:            t.tavolo,
          sede:              t.sede,
          stanza:            null,
          posti:             null,
          utilizzo_percent:  maxOrdini > 0 ? Math.round((t.tot_ordini / maxOrdini) * 100) : 0,
          media_coperti:     t.tot_ordini > 0 ? +(t.tot_coperti / t.tot_ordini).toFixed(1) : 0,
          media_permanenza:  t.durata_n > 0 ? Math.round(t.durata_sum / t.durata_n) : null,
          coperto_medio:     t.tot_coperti > 0 ? +(t.tot_incasso / t.tot_coperti).toFixed(2) : 0,
          incasso_totale:    +t.tot_incasso.toFixed(2),
        }))
        .sort((a, b) => b.incasso_totale - a.incasso_totale)
    } catch (e) { return swallow('statistiche.tavoli', e, []) }
  },

  // Trend giornaliero
  giornaliero: async (p = {}) => {
    try {
      const sede = locationToSede(p.location)
      const build = () => {
        let q = supabase.from('chiusure_giornaliere')
          .select('id,sede,data,totale_venduto_ipratico,coperti,coperto_medio,scontrino_medio')
        if (sede) q = q.eq('sede', sede)
        if (p.from) q = q.gte('data', p.from)
        if (p.to)   q = q.lte('data', p.to)
        return q
      }
      let rows
      if (!p.from && !p.to) {
        // Senza periodo: ultimi 60 giorni di calendario, non "ultime 60 righe"
        // (con due sedi 60 righe sono 30 giorni). Ordine DESC + reverse.
        rows = await sbFetch(
          build().order('data', { ascending: false }).limit(120)
        )
        rows = rows.reverse()
      } else {
        rows = (await sbFetchPaged(build, 'id'))
          .sort((a, b) => String(a.data).localeCompare(String(b.data)))
      }
      // Normalizza nomi campo per compatibilità frontend
      return rows.map(r => ({
        ...r,
        n_coperti:     parseInt(r.coperti) || 0,
        incasso_totale: parseFloat(r.totale_venduto_ipratico) || 0,
        n_tavoli:      null,
        media_permanenza: null,
      }))
    } catch (e) { return swallow('statistiche.giornaliero', e, []) }
  },

  sync: async () => ({ success: true, message: 'Statistiche calcolate da Supabase in tempo reale' }),
}

// ─── TURNI (API completa v2) ───────────────────────────────────────────────
export const turni = {
  // Lettura generica con filtri
  getAll: async (p = {}) => {
    let q = supabase.from('shifts').select('*, employees(id,name,role,reparto_id,buste_paga_name,sede_split_ma)').order('date', { ascending: true })
    const sede = locationToSede(p.location)
    if (sede)   q = q.eq('sede', sede)
    if (p.from) q = q.gte('date', p.from)
    if (p.to)   q = q.lte('date', p.to)
    if (p.employee_id) q = q.eq('employee_id', p.employee_id)
    const rows = await sbFetch(q)
    return rows.map(r => ({ ...r, ore_lavorate: r.hours, turno: r.turno_tipo }))
  },

  // Turni per periodo (settimana/mese) con join employees
  getByPeriod: async (from, to, sede = null) => {
    let q = supabase.from('shifts')
      .select('*')
      .gte('date', from).lte('date', to)
      .order('date').order('employee_name')
    if (sede) q = q.eq('sede', sede)
    return sbFetch(q)
  },

  // Vista settimanale legacy
  settimana: async (p = {}) => {
    const lunedi = p.data_inizio || p.from
    if (!lunedi) return { dipendenti: [] }
    const d = new Date(lunedi)
    const domenica = new Date(d); domenica.setDate(d.getDate() + 6)
    const toYMD = dt => dt.toISOString().split('T')[0]
    let q = supabase.from('shifts').select('*').gte('date', toYMD(d)).lte('date', toYMD(domenica)).order('date')
    const sede = locationToSede(p.location)
    if (sede) q = q.eq('sede', sede)
    const rows = await sbFetch(q)
    const byEmp = {}
    for (const r of rows) {
      const key = `${r.sede}|${r.employee_name || r.employee_code}`
      if (!byEmp[key]) byEmp[key] = { employee_name: r.employee_name || r.employee_code || '—', role: r.ruolo || '', location: r.sede, ore_totali: 0, giorni: {} }
      byEmp[key].ore_totali += parseFloat(r.hours) || 0
      byEmp[key].giorni[r.date] = { turno: r.turno_tipo, ore: parseFloat(r.hours) || 0, id: r.id }
    }
    return { dipendenti: Object.values(byEmp).sort((a, b) => a.employee_name.localeCompare(b.employee_name)) }
  },

  // Riepilogo mensile
  riepilogo: async (p = {}) => {
    const mese = p.mese
    let q = supabase.from('shifts').select('*').order('date')
    const sede = locationToSede(p.location)
    if (sede) q = q.eq('sede', sede)
    if (mese) {
      // `${mese}-31` genera date inesistenti (es. 2026-02-31) → errore Postgres 22008
      const [aa, mm] = mese.split('-').map(Number)
      const ultimo = new Date(aa, mm, 0).getDate()
      q = q.gte('date', `${mese}-01`).lte('date', `${mese}-${ultimo}`)
    }
    const rows = await sbFetch(q)
    const byEmp = {}
    for (const r of rows) {
      const key = `${r.employee_id || r.employee_name}|${r.sede}`
      if (!byEmp[key]) byEmp[key] = { employee_id: r.employee_id, employee_name: r.employee_name || r.employee_code || '—', role: r.ruolo || '', location: r.sede, ore_totali: 0, giorni_lavorati: 0 }
      byEmp[key].ore_totali += parseFloat(r.hours) || 0
      if (!['Riposo','Ferie','Malattia'].includes(r.turno_tipo)) byEmp[key].giorni_lavorati++
    }
    return Object.values(byEmp).sort((a, b) => b.ore_totali - a.ore_totali)
  },

  // Ore mensili per dipendente (Map<employee_id, {ore_pianificate, n_turni}>)
  getMonthlyHours: async (anno, mese, sede = null) => {
    const from = `${anno}-${String(mese).padStart(2,'0')}-01`
    const lastDay = new Date(anno, mese, 0).getDate()
    const to = `${anno}-${String(mese).padStart(2,'0')}-${lastDay}`
    let q = supabase.from('shifts').select('employee_id,employee_name,sede,hours,turno_tipo')
      .gte('date', from).lte('date', to)
    if (sede) q = q.eq('sede', sede)
    const rows = await sbFetch(q)
    const map = {}
    for (const r of rows) {
      const key = r.employee_id || r.employee_name
      if (!map[key]) map[key] = { employee_id: r.employee_id, employee_name: r.employee_name, ore: 0, turni: 0, assenze: 0 }
      if (['Ferie','Malattia','Riposo'].includes(r.turno_tipo)) map[key].assenze++
      else { map[key].ore += parseFloat(r.hours) || 0; map[key].turni++ }
    }
    return map
  },

  // Crea turno
  create: async (d) => {
    const sede = locationToSede(d.location) || d.sede || 'MA'
    const payload = {
      employee_id:   d.employee_id || null,
      employee_code: d.employee_code || null,
      employee_name: d.employee_name || null,
      sede,
      date:          d.date || d.data,
      turno_tipo:    d.turno_tipo || d.turno || 'Pranzo',
      ora_inizio:    d.ora_inizio || null,
      ora_fine:      d.ora_fine || null,
      hours:         parseFloat(d.hours || d.ore_lavorate) || 0,
      ruolo:         d.ruolo || null,
      notes:         d.notes || d.note || null,
      scaglione:     d.scaglione || null,
      stato:         d.stato || 'pianificato',
      reparto_id:    d.reparto_id || null,
      updated_at:    new Date().toISOString(),
    }
    // Idempotente come upsert/bulkUpsert: creare due volte lo stesso turno
    // non deve generare doppioni
    const [row] = await replaceShifts([payload])
    return row
  },

  // Upsert turno (by employee_id + date + turno_tipo) — usato da settimana grid
  upsert: async (d) => {
    const sede = d.sede || 'MA'
    const payload = {
      employee_id:   d.employee_id || null,
      employee_code: d.employee_code || null,
      employee_name: d.employee_name || null,
      sede,
      date:          d.date,
      turno_tipo:    d.turno_tipo || 'Pranzo',
      ora_inizio:    d.ora_inizio || null,
      ora_fine:      d.ora_fine || null,
      hours:         parseFloat(d.hours) || 0,
      ruolo:         d.ruolo || null,
      notes:         d.notes || null,
      scaglione:     d.scaglione || null,
      stato:         d.stato || 'pianificato',
      reparto_id:    d.reparto_id || null,
      updated_at:    new Date().toISOString(),
    }
    if (d.id) {
      const { data, error } = await supabase.from('shifts').update(payload).eq('id', d.id).select().single()
      if (error) throw error
      return data
    }
    // Senza id: era un insert puro, quindi due salvataggi della stessa cella
    // della griglia creavano due turni identici. Ora rimpiazza l'eventuale
    // turno già presente sulla stessa chiave logica.
    const [saved] = await replaceShifts([payload])
    return saved
  },

  // Aggiorna turno esistente
  update: async (id, d) => {
    const { error } = await supabase.from('shifts').update({ ...d, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    return { success: true }
  },

  // Elimina turno
  remove: async (id) => {
    const { error } = await supabase.from('shifts').delete().eq('id', id)
    if (error) throw error
    return { success: true }
  },

  // Bulk insert turni (AI planner)
  bulkUpsert: async (shifts) => {
    if (!shifts?.length) return []
    const rows = shifts.map(d => ({
      employee_id:   d.employee_id || null,
      employee_name: d.employee_name || null,
      employee_code: d.employee_code || null,
      sede:          d.sede || 'MA',
      date:          d.date,
      turno_tipo:    d.turno_tipo || 'Pranzo',
      ora_inizio:    d.ora_inizio || null,
      ora_fine:      d.ora_fine || null,
      hours:         parseFloat(d.hours) || 0,
      ruolo:         d.ruolo || null,
      notes:         d.notes || null,
      scaglione:     d.scaglione || null,
      stato:         d.stato || 'pianificato',
      reparto_id:    d.reparto_id || null,
      updated_at:    new Date().toISOString(),
    }))
    // Era .insert(): ogni rigenerazione del piano settimanale duplicava i turni,
    // raddoppiando ore e costi nei riepiloghi. Ora è idempotente sulla chiave
    // (employee_id, date, turno_tipo, sede).
    return replaceShifts(rows)
  },

  // Bulk elimina turni per settimana/sede
  bulkDelete: async (ids) => {
    if (!ids?.length) return { success: true }
    const { error } = await supabase.from('shifts').delete().in('id', ids)
    if (error) throw error
    return { success: true }
  },

  // Regole dipendenti — select semplice senza join (i dati employee arrivano da enrichedEmps)
  getRegole: async (_sede = null) => {
    return sbFetch(supabase.from('employee_regole').select('*'))
  },

  upsertRegola: async (d) => {
    const { data, error } = await supabase.from('employee_regole')
      .upsert({ ...d, updated_at: new Date().toISOString() }, { onConflict: 'employee_id' })
      .select().single()
    if (error) throw error
    return data
  },

  sync: async () => ({ success: true, message: 'Turni sincronizzati da Supabase' }),
}

// ─── ROLES ────────────────────────────────────────────────────────────────
export const roles = {
  getAll: async () => sbFetch(supabase.from('roles').select('*').order('name')),
  create: async (d) => {
    const { data, error } = await supabase.from('roles').insert({ name: d.name, description: d.description || null, color: d.color || '#6366f1' }).select().single()
    if (error) throw error
    return { id: data.id }
  },
  update: async (id, d) => {
    const { error } = await supabase.from('roles').update({ name: d.name, description: d.description, color: d.color, active: d.active }).eq('id', id)
    if (error) throw error
    return { success: true }
  },
  delete: async (id) => {
    const { error } = await supabase.from('roles').delete().eq('id', id)
    if (error) throw error
    return { success: true }
  },
}

// ─── ADMIN ────────────────────────────────────────────────────────────────
export const admin = {
  // Trasferisci dipendente da sede A a sede B
  transferEmployee: async (id, nuovaSede, options = {}) => {
    const { data: emp, error: e1 } = await supabase.from('employees').select('sede').eq('id', id).single()
    if (e1) throw e1
    const updatePayload = {
      sede: nuovaSede,
      sede_precedente: emp.sede,
      cost_split: null, // reset split al trasferimento
    }
    if (options.note) updatePayload.note = options.note
    const { error: e2 } = await supabase.from('employees').update(updatePayload).eq('id', id)
    if (e2) throw e2
    return { success: true, da: emp.sede, a: nuovaSede }
  },

  // Imposta split costo (es. {MA: 0.5, PN: 0.5})
  setCostSplit: async (id, split) => {
    // Validazione: somma deve essere 1
    const total = Object.values(split).reduce((a, b) => a + parseFloat(b), 0)
    if (Math.abs(total - 1) > 0.01) throw new Error('La somma delle % deve essere 100')
    const { error } = await supabase.from('employees').update({ cost_split: split }).eq('id', id)
    if (error) throw error
    return { success: true }
  },

  removeCostSplit: async (id) => {
    const { error } = await supabase.from('employees').update({ cost_split: null }).eq('id', id)
    if (error) throw error
    return { success: true }
  },

  // Aggiorna dipendente con cascade completo (stesso di employees.update)
  updateEmployee: async (id, d) => {
    // Riusa employees.update che ha già il cascade completo
    return employees.update(id, d)
  },

  // Lettura tabella generica (per debug/admin)
  queryTable: async (table, limit = 50) => {
    const { data, error } = await supabase.from(table).select('*').limit(limit)
    if (error) throw error
    return data ?? []
  },

  // ── BACKUP ────────────────────────────────────────────────────────────────

  // Crea snapshot completo di tutte le tabelle su crm_backups
  createBackup: async (label = '', description = '') => {
    const ts = new Date().toISOString()
    const lbl = label || `Backup ${ts.substring(0, 16).replace('T', ' ')}`

    // Scarica tutte le tabelle in parallelo, PAGINATE (il cap PostgREST è 1000
    // righe: senza .range() il backup risulterebbe silenziosamente troncato).
    // sbFetchAll propaga gli errori: meglio nessun backup che un backup finto.
    const [employees, chiusure, fornitori, fatture, buste, shifts, modules, kpiRev, settings] = await Promise.all([
      sbFetchAll('employees'),
      sbFetchAll('chiusure_giornaliere'),
      sbFetchAll('fornitori_fatture'),
      sbFetchAll('fatture_importate'),
      sbFetchAll('buste_paga'),
      sbFetchAll('shifts'),
      sbFetchAll('modules'),
      sbFetchAll('kpi_revenues'),
      sbFetchAll('app_settings'),
    ])

    const tables = { employees, chiusure_giornaliere: chiusure, fornitori_fatture: fornitori,
                     fatture_importate: fatture, buste_paga: buste, shifts, modules,
                     kpi_revenues: kpiRev, app_settings: settings }

    // Conteggi salvati nello snapshot: restoreBackup li confronta prima di scrivere.
    const rowCounts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]))

    const backupData = { created_at: ts, version: '1.1', row_counts: rowCounts, tables }

    const jsonStr   = JSON.stringify(backupData)
    const sizeKb    = Math.round(jsonStr.length / 1024)

    const { data: row, error } = await supabase.from('crm_backups').insert({
      label,  description: description || '',
      data:   backupData,
      size_kb: sizeKb,
    }).select().single()
    if (error) throw error
    return { id: row.id, label: lbl, size_kb: sizeKb, created_at: ts, row_counts: rowCounts }
  },

  // Lista backup salvati
  listBackups: async () => {
    const { data, error } = await supabase.from('crm_backups')
      .select('id,label,description,size_kb,created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) throw error
    return data ?? []
  },

  // Elimina backup
  deleteBackup: async (id) => {
    const { error } = await supabase.from('crm_backups').delete().eq('id', id)
    if (error) throw error
    return { success: true }
  },

  // Statistiche database
  dbStats: async () => {
    const tables = ['employees','chiusure_giornaliere','fornitori_fatture','fatture_importate','buste_paga','shifts','kpi_revenues','kpi_operators','roles']
    const results = await Promise.all(tables.map(t =>
      supabase.from(t).select('*', { count: 'exact', head: true }).then(r => ({ table: t, count: r.count || 0 }))
    ))
    return results
  },

  // Salva/leggi app_settings
  getSetting: async (key) => {
    const { data } = await supabase.from('app_settings').select('value').eq('key', key).single()
    return data?.value ?? null
  },

  setSetting: async (key, value) => {
    const { error } = await supabase.from('app_settings').upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )
    if (error) throw error
    return { success: true }
  },

  // ── RESTORE 1-CLICK ──────────────────────────────────────────────────────
  // Ripristina tutti i dati da un backup salvato su Supabase
  // Ritorna { results: {tableName: {restored, errors}}, total_restored }
  restoreBackup: async (backupId, onProgress) => {
    // 1. Leggi il backup
    const { data: row, error: readErr } = await supabase
      .from('crm_backups').select('data,label,created_at').eq('id', backupId).single()
    if (readErr) throw new Error('Backup non trovato: ' + readErr.message)

    const tables = row.data?.tables || {}

    // 1-bis. Validazione integrità: i backup creati prima della v1.1 sono stati
    // scritti senza paginazione, quindi ogni tabella oltre le 1000 righe è
    // TRONCATA. Ripristinarli significa reintrodurre dati parziali.
    const counts = row.data?.row_counts
    const warnings = []
    if (!counts) {
      const sospette = Object.entries(tables).filter(([, v]) => Array.isArray(v) && v.length === 1000).map(([k]) => k)
      warnings.push(
        `Backup in formato ${row.data?.version || 'legacy'} senza row_counts: creato prima del fix di paginazione.` +
        (sospette.length ? ` Tabelle troncate a 1000 righe (quasi certamente incomplete): ${sospette.join(', ')}.` : '')
      )
    } else {
      for (const [t, n] of Object.entries(counts)) {
        const actual = Array.isArray(tables[t]) ? tables[t].length : 0
        if (actual !== n) warnings.push(`${t}: attese ${n} righe nello snapshot, trovate ${actual}`)
      }
    }

    // Ordine di ripristino rispetta i FK (parents prima di children)
    const RESTORE_ORDER = [
      'roles', 'employees', 'modules', 'app_settings',
      'chiusure_giornaliere', 'fornitori_fatture', 'fatture_importate',
      'buste_paga', 'shifts', 'kpi_revenues',
    ]

    const results = {}
    let total_restored = 0

    for (const tableName of RESTORE_ORDER) {
      const rows = tables[tableName]
      if (!rows || rows.length === 0) {
        results[tableName] = { restored: 0, errors: 0, skipped: true }
        continue
      }

      onProgress?.(`Ripristino ${tableName} (${rows.length} righe)...`)

      try {
        // Upsert in batch da 100 righe
        let restored = 0, errors = 0
        for (let i = 0; i < rows.length; i += 100) {
          const batch = rows.slice(i, i + 100)
          const { error: upsertErr } = await supabase
            .from(tableName)
            .upsert(batch, { onConflict: 'id', ignoreDuplicates: false })
          if (upsertErr) {
            errors += batch.length
          } else {
            restored += batch.length
          }
        }
        results[tableName] = { restored, errors }
        total_restored += restored
      } catch (e) {
        results[tableName] = { restored: 0, errors: rows.length, message: e.message }
      }
    }

    return {
      backup_label:    row.label,
      backup_date:     row.created_at,
      results,
      total_restored,
      warnings,
    }
  },

  // Anteprima cosa conterrà un restore (senza eseguirlo)
  previewRestore: async (backupId) => {
    const { data: row, error } = await supabase
      .from('crm_backups').select('data,label,created_at,size_kb').eq('id', backupId).single()
    if (error) throw error
    const tables = row.data?.tables || {}
    const preview = Object.entries(tables).map(([table, rows]) => ({
      table, rows: Array.isArray(rows) ? rows.length : 0
    })).filter(t => t.rows > 0)
    return { label: row.label, created_at: row.created_at, size_kb: row.size_kb, tables: preview }
  },
}

// ─── OPERATOR MAPPING — collega iPratico op-names ↔ employees ─────────────
export const operatorMapping = {
  // Tutti i mapping con dati dipendente annessi
  getAll: async () => {
    const { data, error } = await supabase
      .from('employee_operator_mapping')
      .select('*, employees(id, name, code, sede, active)')
      .order('sede')
      .order('op_name_ipratico')
    if (error) throw error
    return data ?? []
  },

  // Solo quelli da verificare (verified=false)
  getUnverified: async () => {
    const { data, error } = await supabase
      .from('employee_operator_mapping')
      .select('*, employees(id, name, code, sede, active)')
      .eq('verified', false)
      .order('sede')
      .order('op_name_ipratico')
    if (error) throw error
    return data ?? []
  },

  // Conferma mapping (verified=true)
  confirm: async (id) => {
    const { error } = await supabase
      .from('employee_operator_mapping')
      .update({ verified: true })
      .eq('id', id)
    if (error) throw error
    return { success: true }
  },

  // Aggiorna dipendente assegnato (per correggere abbinamenti sbagliati)
  update: async (id, d) => {
    const payload = {}
    if (d.employee_id  !== undefined) payload.employee_id  = d.employee_id
    if (d.verified     !== undefined) payload.verified     = d.verified
    if (d.buste_paga_name !== undefined) payload.buste_paga_name = d.buste_paga_name
    const { error } = await supabase
      .from('employee_operator_mapping')
      .update(payload)
      .eq('id', id)
    if (error) throw error
    return { success: true }
  },

  // Crea nuovo mapping
  create: async (d) => {
    const { data, error } = await supabase
      .from('employee_operator_mapping')
      .insert({
        employee_id:      d.employee_id,
        op_name_ipratico: d.op_name_ipratico,
        sede:             d.sede,
        buste_paga_name:  d.buste_paga_name || null,
        verified:         d.verified ?? false,
      })
      .select()
      .single()
    if (error) throw error
    return { id: data.id }
  },

  // Elimina mapping
  delete: async (id) => {
    const { error } = await supabase
      .from('employee_operator_mapping')
      .delete()
      .eq('id', id)
    if (error) throw error
    return { success: true }
  },

  // Statistiche: totali mapping per stato
  stats: async () => {
    const { data, error } = await supabase
      .from('employee_operator_mapping')
      .select('verified')
    if (error) throw error
    const all = data ?? []
    return {
      totale:        all.length,
      verificati:    all.filter(m => m.verified).length,
      da_verificare: all.filter(m => !m.verified).length,
    }
  },
}

// ─── CRM CONFIG ────────────────────────────────────────────────────────────
export const crmConfig = {
  getAll: async () => {
    const { data, error } = await supabase.from('crm_config').select('*')
    if (error) throw error
    const map = {}
    for (const r of (data || [])) map[r.key] = r.value
    return map
  },
  get: async (key) => {
    const { data } = await supabase.from('crm_config').select('value').eq('key', key).single()
    return data?.value ?? null
  },
  set: async (key, value) => {
    const { error } = await supabase.from('crm_config').upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )
    if (error) throw error
    return { success: true }
  },
  setMany: async (obj) => {
    const rows = Object.entries(obj).map(([key, value]) => ({
      key, value, updated_at: new Date().toISOString()
    }))
    const { error } = await supabase.from('crm_config').upsert(rows, { onConflict: 'key' })
    if (error) throw error
    return { success: true }
  },
}

// ─── SEDI ──────────────────────────────────────────────────────────────────
export const sediApi = {
  getAll: async () => {
    const { data, error } = await supabase.from('sedi').select('*').order('code')
    if (error) throw error
    return data ?? []
  },
  create: async (d) => {
    const { data, error } = await supabase.from('sedi').insert({
      code:   d.code.toUpperCase(),
      name:   d.name,
      city:   d.city || '',
      color:  d.color || '#6366f1',
      active: true,
      config: d.config || {},
    }).select().single()
    if (error) throw error
    return data
  },
  update: async (id, d) => {
    const { error } = await supabase.from('sedi').update(d).eq('id', id)
    if (error) throw error
    return { success: true }
  },
  delete: async (id) => {
    const { error } = await supabase.from('sedi').delete().eq('id', id)
    if (error) throw error
    return { success: true }
  },
}

// ─── REPARTI API ──────────────────────────────────────────────────────────────
export const repartiApi = {
  getAll: async () => {
    const { data, error } = await supabase
      .from('reparti')
      .select('*')
      .order('ordine', { ascending: true })
    if (error) throw error
    return data || []
  },

  create: async (d) => {
    const { data, error } = await supabase
      .from('reparti')
      .insert({ ...d, updated_at: new Date().toISOString() })
      .select()
      .single()
    if (error) throw error
    return data
  },

  update: async (id, d) => {
    const { error } = await supabase
      .from('reparti')
      .update({ ...d, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    return { success: true }
  },

  remove: async (id) => {
    const { error } = await supabase.from('reparti').delete().eq('id', id)
    if (error) throw error
    return { success: true }
  },

  // Carica fabbisogno per un reparto (o tutti)
  getFabbisogno: async (repartoId = null) => {
    let q = supabase.from('turni_fabbisogno').select('*')
    if (repartoId) q = q.eq('reparto_id', repartoId)
    const { data, error } = await q
    if (error) throw error
    return data || []
  },

  // Upsert fabbisogno (insert o update basato su reparto_id+sede+turno_tipo+giorno_tipo)
  upsertFabbisogno: async (d) => {
    const { data, error } = await supabase
      .from('turni_fabbisogno')
      .upsert({ ...d, updated_at: new Date().toISOString() }, { onConflict: 'reparto_id,sede,turno_tipo,giorno_tipo' })
      .select()
      .single()
    if (error) throw error
    return data
  },

  deleteFabbisogno: async (id) => {
    const { error } = await supabase.from('turni_fabbisogno').delete().eq('id', id)
    if (error) throw error
    return { success: true }
  },

  // Employees assegnati a un reparto
  getEmployeesByReparto: async (repartoId, sede = null) => {
    let q = supabase.from('employees').select('id,name,role,sede,active').eq('reparto_id', repartoId).eq('active', true)
    if (sede) q = q.eq('sede', sede)
    const { data, error } = await q.order('name')
    if (error) throw error
    return data || []
  },

  // Assegna reparto a un dipendente
  assignEmployee: async (employeeId, repartoId) => {
    const { error } = await supabase
      .from('employees')
      .update({ reparto_id: repartoId })
      .eq('id', employeeId)
    if (error) throw error
    return { success: true }
  },

  // Bulk assign reparto
  bulkAssign: async (employeeIds, repartoId) => {
    const { error } = await supabase
      .from('employees')
      .update({ reparto_id: repartoId })
      .in('id', employeeIds)
    if (error) throw error
    return { success: true }
  },
}

// ═══════════════════════════════════════════════════════════════════════════
//  KPI CONFIG — Costi, Target, Performance, Standard Nazionali
// ═══════════════════════════════════════════════════════════════════════════

export const fattureCategorieApi = {
  list: async () => sbFetch(supabase.from('fattura_categorie').select('*').eq('attivo', true).order('tipo').order('nome')),
  create: async (d) => {
    const { data, error } = await supabase.from('fattura_categorie').insert(d).select().single()
    if (error) throw error; return data
  },
  update: async (id, d) => {
    const { error } = await supabase.from('fattura_categorie').update(d).eq('id', id)
    if (error) throw error; return { success: true }
  },
  delete: async (id) => {
    const { error } = await supabase.from('fattura_categorie').update({ attivo: false }).eq('id', id)
    if (error) throw error; return { success: true }
  },
  // Aggiorna categoria su un fornitore — cascade su tutte le sue fatture
  setCategoriaFornitore: async (fornitoreId, categoriaId) => {
    const { error } = await supabase.from('fornitori_fatture').update({ categoria_id: categoriaId }).eq('id', fornitoreId)
    if (error) throw error
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })); window.dispatchEvent(new Event('crm-kpi-updated')) } catch (_) {}
    return { success: true }
  },
}

export const costiFissiApi = {
  list: async ({ sede, anno, mese } = {}) => {
    let q = supabase.from('costi_fissi').select('*, fattura_categorie(nome,tipo)').order('created_at', { ascending: false })
    if (sede) q = q.eq('sede', locationToSede(sede) || sede)
    if (anno) q = q.eq('anno', parseInt(anno))
    if (mese) q = q.eq('mese', parseInt(mese))
    return sbFetch(q)
  },
  create: async (d) => {
    const payload = {
      sede: locationToSede(d.sede) || d.sede,
      anno: parseInt(d.anno),
      mese: parseInt(d.mese),
      categoria_id: d.categoria_id || null,
      descrizione: d.descrizione,
      importo: parseFloat(d.importo) || 0,
      ricorrente: d.ricorrente ?? true,
      data_pagamento: d.data_pagamento || null,
      note: d.note || null,
    }
    const { data, error } = await supabase.from('costi_fissi').insert(payload).select().single()
    if (error) throw error
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })); window.dispatchEvent(new Event('crm-kpi-updated')) } catch (_) {}
    return data
  },
  update: async (id, d) => {
    const payload = { ...d, updated_at: new Date().toISOString() }
    if (d.importo !== undefined) payload.importo = parseFloat(d.importo)
    const { error } = await supabase.from('costi_fissi').update(payload).eq('id', id)
    if (error) throw error
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })); window.dispatchEvent(new Event('crm-kpi-updated')) } catch (_) {}
    return { success: true }
  },
  delete: async (id) => {
    const { error } = await supabase.from('costi_fissi').delete().eq('id', id)
    if (error) throw error
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })); window.dispatchEvent(new Event('crm-kpi-updated')) } catch (_) {}
    return { success: true }
  },
  // Lista arricchita con categoria e mese_str (da v_costi_fissi_arricchiti)
  listArricchita: async ({ sede, anno, mese, categoria_tipo, ricorrente } = {}) => {
    // CostiFissiPage costruisce da qui il pivot annuale (somme per descrizione
    // e per mese): `.limit(2000)` non alza il cap PostgREST di 1000 righe, e a
    // quel punto il totale costi fissi uscirebbe sottostimato senza errori.
    // Oggi la vista ha ~156 righe, ma cresce di ~12 righe per costo ricorrente
    // per anno: la paginazione evita che il limite venga superato in silenzio.
    const build = () => {
      let q = supabase.from('v_costi_fissi_arricchiti').select('*')
      if (sede) q = q.eq('sede', locationToSede(sede) || sede)
      if (anno) q = q.eq('anno', parseInt(anno))
      if (mese) q = q.eq('mese', parseInt(mese))
      if (categoria_tipo) q = q.eq('categoria_tipo', categoria_tipo)
      if (ricorrente !== undefined) q = q.eq('ricorrente', ricorrente)
      return q
    }
    return sbFetchPaged(build, 'id')
  },

  // Riepilogo per sede × mese (da v_costi_fissi_mensile)
  mensile: async ({ sede, anno } = {}) => {
    let q = supabase.from('v_costi_fissi_mensile').select('*').order('anno').order('mese')
    if (sede) q = q.eq('sede', locationToSede(sede) || sede)
    if (anno) q = q.eq('anno', parseInt(anno))
    return sbFetch(q.limit(500))
  },

  // RPC: espande/upsert un costo ricorrente su un range anno-mese
  ricorrenteBulk: async ({ sede, categoria_id, descrizione, importo, anno_da, mese_da, anno_a, mese_a, ricorrente = true, note }) => {
    const { data, error } = await supabase.rpc('costi_fissi_ricorrente_upsert', {
      p_sede: locationToSede(sede) || sede,
      p_categoria_id: categoria_id,
      p_descrizione: descrizione,
      p_importo: parseFloat(importo) || 0,
      p_anno_da: parseInt(anno_da), p_mese_da: parseInt(mese_da),
      p_anno_a:  parseInt(anno_a),  p_mese_a:  parseInt(mese_a),
      p_ricorrente: !!ricorrente, p_note: note || null,
    })
    if (error) throw error
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })); window.dispatchEvent(new Event('crm-kpi-updated')) } catch (_) {}
    return { creati: data }
  },

  // RPC: adeguamento ISTAT annuale (% aumento su anno target)
  adeguamentoIstat: async ({ sede, categoria_id, anno, pct_aumento }) => {
    const { data, error } = await supabase.rpc('costi_fissi_adeguamento_istat', {
      p_sede: sede ? (locationToSede(sede) || sede) : null,
      p_categoria_id: categoria_id || null,
      p_anno: parseInt(anno),
      p_pct_aumento: parseFloat(pct_aumento) || 0,
    })
    if (error) throw error
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })); window.dispatchEvent(new Event('crm-kpi-updated')) } catch (_) {}
    return { aggiornate: data }
  },

  // Duplica i costi ricorrenti del mese precedente sul nuovo mese
  duplicaDaMesePrecedente: async ({ sede, anno, mese }) => {
    const s = locationToSede(sede) || sede
    const mesePrev = mese === 1 ? 12 : mese - 1
    const annoPrev = mese === 1 ? anno - 1 : anno
    const { data: prev, error } = await supabase.from('costi_fissi').select('*')
      .eq('sede', s).eq('anno', annoPrev).eq('mese', mesePrev).eq('ricorrente', true)
    if (error) throw error
    if (!prev?.length) return { duplicati: 0 }
    const rows = prev.map(r => ({
      sede: s, anno, mese,
      categoria_id: r.categoria_id, descrizione: r.descrizione, importo: r.importo,
      ricorrente: true, note: r.note,
    }))
    const { error: e2 } = await supabase.from('costi_fissi').insert(rows)
    if (e2) throw e2
    return { duplicati: rows.length }
  },
}

export const standardNazionaliApi = {
  list: async () => sbFetch(supabase.from('standard_nazionali').select('*').order('categoria')),
  update: async (id, d) => {
    const { error } = await supabase.from('standard_nazionali')
      .update({ ...d, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error; return { success: true }
  },
}

export const kpiTargetsApi = {
  // ── TEAM ────────────────────────────────────────────────────────────────
  getTeam: async ({ sede, anno, mese }) => {
    const s = locationToSede(sede) || sede
    const { data } = await supabase.from('kpi_targets_team').select('*')
      .eq('sede', s).eq('anno', parseInt(anno)).eq('mese', parseInt(mese)).maybeSingle()
    return data
  },
  upsertTeam: async (d) => {
    const payload = {
      sede: locationToSede(d.sede) || d.sede,
      anno: parseInt(d.anno),
      mese: parseInt(d.mese),
      be_totale: parseFloat(d.be_totale) || 0,
      target_fatturato: parseFloat(d.target_fatturato) || 0,
      premio_team_euro: parseFloat(d.premio_team_euro) || 0,
      pct_cucina: parseFloat(d.pct_cucina) || 50,
      pct_sala: parseFloat(d.pct_sala) || 50,
      coeff_stagionale: parseFloat(d.coeff_stagionale) || 1.0,
      stato: d.stato || 'ATTIVO',
      note: d.note || null,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabase.from('kpi_targets_team')
      .upsert(payload, { onConflict: 'sede,anno,mese' }).select().single()
    if (error) throw error
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })); window.dispatchEvent(new Event('crm-kpi-updated')) } catch (_) {}
    return data
  },

  // ── INDIVIDUALE ─────────────────────────────────────────────────────────
  listIndividuale: async ({ sede, anno, mese }) => {
    const s = locationToSede(sede) || sede
    let q = supabase.from('kpi_targets_individuale')
      .select('*, employees(name,role,sede,active)')
      .eq('sede', s).eq('anno', parseInt(anno)).eq('mese', parseInt(mese))
    return sbFetch(q)
  },
  upsertIndividuale: async (d) => {
    const payload = {
      employee_id: d.employee_id,
      sede: locationToSede(d.sede) || d.sede,
      anno: parseInt(d.anno),
      mese: parseInt(d.mese),
      metrica: d.metrica || 'PEZZI_TOTALI',
      quantum: parseFloat(d.quantum) || 0,
      target: parseFloat(d.target) || (parseFloat(d.quantum) * 1.10) || 0,
      premio_max_euro: parseFloat(d.premio_max_euro) || 0,
      mese_precedente_valore: d.mese_precedente_valore != null ? parseFloat(d.mese_precedente_valore) : null,
      note: d.note || null,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabase.from('kpi_targets_individuale')
      .upsert(payload, { onConflict: 'employee_id,sede,anno,mese' }).select().single()
    if (error) throw error
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })); window.dispatchEvent(new Event('crm-kpi-updated')) } catch (_) {}
    return data
  },

  // ── PRODOTTI ────────────────────────────────────────────────────────────
  listProdotti: async ({ sede, anno, mese }) => {
    const s = locationToSede(sede) || sede
    return sbFetch(supabase.from('kpi_targets_prodotti').select('*')
      .eq('sede', s).eq('anno', parseInt(anno)).eq('mese', parseInt(mese)).order('reparto').order('prodotto_nome'))
  },
  upsertProdotto: async (d) => {
    const payload = {
      sede: locationToSede(d.sede) || d.sede,
      anno: parseInt(d.anno), mese: parseInt(d.mese),
      prodotto_nome: d.prodotto_nome,
      reparto: d.reparto || 'ENTRAMBI',
      categoria: d.categoria || 'PIATTO',
      pezzi_precedente: parseInt(d.pezzi_precedente) || 0,
      pezzi_target: parseInt(d.pezzi_target) || 0,
      valore_unitario: parseFloat(d.valore_unitario) || 0,
      note: d.note || null,
      updated_at: new Date().toISOString(),
    }
    if (d.id) {
      const { error } = await supabase.from('kpi_targets_prodotti').update(payload).eq('id', d.id)
      if (error) throw error; return { id: d.id }
    }
    const { data, error } = await supabase.from('kpi_targets_prodotti').insert(payload).select().single()
    if (error) throw error; return data
  },
  deleteProdotto: async (id) => {
    const { error } = await supabase.from('kpi_targets_prodotti').delete().eq('id', id)
    if (error) throw error; return { success: true }
  },
}

export const kpiPerformanceApi = {
  // Costi mensili aggregati (personale + fatture + fissi)
  // FONTE UNICA: v_be_mensile (la stessa usata da Performance/KpiTeam/KPIWaiters),
  // così il BE è identico su tutte le pagine. Mappa i campi della view sul formato
  // storico { costo_personale, costo_fatture, costo_fissi, be_totale }.
  getCosti: async ({ sede, anno, mese }) => {
    const s = locationToSede(sede) || sede
    const { data } = await supabase.from('v_be_mensile').select('*')
      .eq('sede', s).eq('anno', parseInt(anno)).eq('mese', parseInt(mese)).maybeSingle()
    if (!data) return { sede: s, anno, mese, costo_personale: 0, costo_fatture: 0, costo_fissi: 0, be_totale: 0 }
    return {
      sede: s, anno, mese,
      costo_personale: Number(data.costo_personale) || 0,
      costo_fatture:   Number(data.tot_fatture_acquisto) || 0,
      costo_fissi:     Number(data.costi_fissi) || 0,
      be_totale:       Number(data.costi_totali) || 0,
    }
  },

  // Performance per operatore/dipendente in tempo reale
  getIndividuale: async ({ sede, anno, mese }) => {
    const s = locationToSede(sede) || sede
    return sbFetch(supabase.from('v_kpi_performance_individuale').select('*')
      .eq('sede', s).eq('anno', parseInt(anno)).eq('mese', parseInt(mese)))
  },

  // Performance per prodotto
  getProdotti: async ({ sede, anno, mese, limit = 100 }) => {
    const s = locationToSede(sede) || sede
    return sbFetch(supabase.from('v_kpi_performance_prodotti').select('*')
      .eq('sede', s).eq('anno', parseInt(anno)).eq('mese', parseInt(mese))
      .order('pezzi_venduti', { ascending: false }).limit(limit))
  },

  // Quorum = media fatturato ultimi N mesi (da chiusure)
  getQuorum: async ({ sede, anno, mese, mesiLookback = 2 }) => {
    const s = locationToSede(sede) || sede
    const mesi = []
    for (let i = 1; i <= mesiLookback; i++) {
      let m = mese - i, a = anno
      while (m < 1) { m += 12; a -= 1 }
      mesi.push({ anno: a, mese: m })
    }
    const results = await Promise.all(mesi.map(({ anno, mese }) => {
      const nextM = mese === 12 ? 1 : mese + 1
      const nextA = mese === 12 ? anno + 1 : anno
      return supabase.from('chiusure_giornaliere')
        .select('totale_venduto_ipratico')
        .eq('sede', s)
        .eq('chiusura_anticipata', false)
        .gte('data', `${anno}-${String(mese).padStart(2,'0')}-01`)
        .lt('data',  `${nextA}-${String(nextM).padStart(2,'0')}-01`)
        .then(r => (r.data || []).reduce((sum, x) => sum + (parseFloat(x.totale_venduto_ipratico) || 0), 0))
    }))
    const somma = results.reduce((a, b) => a + b, 0)
    return +(somma / mesiLookback).toFixed(2)
  },

  // Stesso mese anno precedente (per coefficiente stagionale)
  getStessoMeseAnnoPrec: async ({ sede, anno, mese }) => {
    const s = locationToSede(sede) || sede
    const nextM = mese === 12 ? 1 : mese + 1
    const nextA = mese === 12 ? anno : anno - 1
    const { data } = await supabase.from('chiusure_giornaliere')
      .select('totale_venduto_ipratico')
      .eq('sede', s)
      .eq('chiusura_anticipata', false)
      .gte('data', `${anno-1}-${String(mese).padStart(2,'0')}-01`)
      .lt('data',  `${nextA}-${String(nextM).padStart(2,'0')}-01`)
    return +(data || []).reduce((a, r) => a + (parseFloat(r.totale_venduto_ipratico) || 0), 0).toFixed(2)
  },

  // ─── Storico operatore (per target individuali) ───────────────────────────
  // Fonte: v_fatturato_operatore_mensile (pezzi + €)
  // Calcola: media ultimi 3m, stesso mese anno prec, quantum = MAX dei due
  // Usato da TabIndividuali per auto-suggerire quantum/target
  getOperatoreStorico: async ({ sede, operatoreName, anno, mese, mesiLookback = 3 }) => {
    const s = locationToSede(sede) || sede
    if (!operatoreName) return null
    const mesiQuery = []
    for (let i = 1; i <= mesiLookback; i++) {
      let m = mese - i, a = anno
      while (m < 1) { m += 12; a-- }
      mesiQuery.push({ anno: a, mese: m })
    }
    const minAnno = Math.min(anno - 1, ...mesiQuery.map(x => x.anno))
    const { data: rows } = await supabase.from('v_fatturato_operatore_mensile')
      .select('anno, mese, operator, pezzi_totali, fatturato_totale, costo_materia_totale, margine_pct')
      .eq('sede', s).ilike('operator', escapeLike(operatoreName)).gte('anno', minAnno)
    const rowMap = {}
    for (const r of rows || []) rowMap[`${r.anno}-${r.mese}`] = r
    const storico = mesiQuery.map(({ anno, mese }) => ({
      anno, mese, label: `${String(mese).padStart(2,'0')}/${anno}`,
      ...rowMap[`${anno}-${mese}`] || {},
      haDati: !!rowMap[`${anno}-${mese}`],
    }))
    const datiAnnoPrec = rowMap[`${anno - 1}-${mese}`] || null
    const mesiConDati  = storico.filter(m => m.haDati)
    const media3m_pezzi = mesiConDati.length > 0
      ? mesiConDati.reduce((s, m) => s + parseFloat(m.pezzi_totali || 0), 0) / mesiConDati.length : 0
    const media3m_fat = mesiConDati.length > 0
      ? mesiConDati.reduce((s, m) => s + parseFloat(m.fatturato_totale || 0), 0) / mesiConDati.length : 0
    const prevYearPezzi = parseFloat(datiAnnoPrec?.pezzi_totali || 0)
    const prevYearFat   = parseFloat(datiAnnoPrec?.fatturato_totale || 0)
    const basePezzi = Math.max(media3m_pezzi, prevYearPezzi)
    const baseFat   = Math.max(media3m_fat, prevYearFat)
    return {
      storico, datiAnnoPrec,
      media3m_pezzi: Math.round(media3m_pezzi),
      media3m_fat:   Math.round(media3m_fat),
      prevYearPezzi: Math.round(prevYearPezzi),
      prevYearFat:   Math.round(prevYearFat),
      quantum_pezzi: Math.round(basePezzi),
      target_pezzi:  Math.round(basePezzi * 1.10),
      quantum_fat:   Math.round(baseFat),
      target_fat:    Math.round(baseFat * 1.10),
      baseFonte: media3m_pezzi >= prevYearPezzi
        ? `media ${mesiConDati.length}m` : `${anno - 1}/${String(mese).padStart(2, '0')}`,
      nMesiConDati: mesiConDati.length,
    }
  },

  // ─── Coperto medio reale da chiusure_giornaliere ──────────────────────────
  // Usa weighted average (tot_venduto/tot_coperti) del mese corrente +
  // se dati insufficienti (<5gg) integra con i 2 mesi precedenti
  getCopertoMedio: async ({ sede, anno, mese }) => {
    const s = locationToSede(sede) || sede
    // Calcola range degli ultimi 3 mesi incluso il corrente
    const ranges = []
    for (let i = 0; i <= 2; i++) {
      let m = mese - i, a = anno
      if (m < 1) { m += 12; a -= 1 }
      const nextM = m === 12 ? 1 : m + 1
      const nextA = m === 12 ? a + 1 : a
      ranges.push({
        from: `${a}-${String(m).padStart(2,'0')}-01`,
        to:   `${nextA}-${String(nextM).padStart(2,'0')}-01`,
      })
    }
    // Fetch tutti i giorni in una sola query
    const from3m = ranges[ranges.length - 1].from
    const to1m   = ranges[0].to
    const { data } = await supabase.from('chiusure_giornaliere')
      .select('data, coperti, totale_venduto_ipratico, coperto_medio')
      .eq('sede', s).eq('chiusura_anticipata', false)
      .gte('data', from3m).lt('data', to1m)
    const rows = data || []
    if (rows.length === 0) return null
    // Dati solo del mese corrente
    const meseCorrRows = rows.filter(r => r.data >= ranges[0].from && r.data < ranges[0].to)
    const computeWeighted = (arr) => {
      const tv = arr.reduce((s, r) => s + (parseFloat(r.totale_venduto_ipratico) || 0), 0)
      const tc = arr.reduce((s, r) => s + (parseInt(r.coperti) || 0), 0)
      if (tc > 0) return Math.round(tv / tc * 100) / 100
      const valid = arr.filter(r => parseFloat(r.coperto_medio) > 0)
      if (valid.length > 0) return Math.round(valid.reduce((s, r) => s + parseFloat(r.coperto_medio), 0) / valid.length * 100) / 100
      return null
    }
    // Se il mese corrente ha ≥5 giorni di dati usa solo quello, altrimenti usa 3 mesi
    const src = meseCorrRows.length >= 5 ? meseCorrRows : rows
    return computeWeighted(src)
  },

  // ─── Mapping operatore→dipendente per sede (usato per filtro sala) ──────────
  getMappingBySede: async ({ sede }) => {
    const s = locationToSede(sede) || sede
    const { data } = await supabase.from('employee_operator_mapping')
      .select('employee_id, op_name_ipratico').eq('sede', s)
    return data || []
  },

  // ─── Auto-genera targets per tutti gli operatori della sede ───────────────
  // Fonte: employee_operator_mapping (link emp→op) + v_fatturato_operatore_mensile
  // periodMode (base di calcolo del quantum):
  //   'media'      → media ultimi N mesi (mesiLookback)
  //   'anno'       → media di tutti i mesi dell'anno in corso (esclude il mese target)
  //   'stagionale' → stesso mese dell'anno precedente (utile per stagionalità)
  //   'max'        → MAX(media N mesi, stesso mese anno prec)  [default storico]
  // target = quantum × 1.10. Una sola chiamata Supabase per tutta la sede.
  autoTargetAllOperatori: async ({ sede, anno, mese, mesiLookback = 3, periodMode = 'max' }) => {
    const s = locationToSede(sede) || sede
    const { data: mappings } = await supabase.from('employee_operator_mapping')
      .select('employee_id, op_name_ipratico').eq('sede', s)
    if (!mappings?.length) return []
    const mesiQuery = []
    for (let i = 1; i <= mesiLookback; i++) {
      let m = mese - i, a = anno
      while (m < 1) { m += 12; a-- }
      mesiQuery.push({ anno: a, mese: m })
    }
    const minAnno = Math.min(anno - 1, ...mesiQuery.map(x => x.anno))
    const { data: fatRows } = await supabase.from('v_fatturato_operatore_mensile')
      .select('anno, mese, operator, pezzi_totali, fatturato_totale, margine_pct')
      .eq('sede', s).gte('anno', minAnno)
    // Lookup: UPPER(operator) → { 'ANNO-MESE': row }  +  lista completa righe per operatore
    const fatLookup = {}, allByOp = {}
    for (const r of fatRows || []) {
      const k = r.operator?.toUpperCase()
      if (!fatLookup[k]) { fatLookup[k] = {}; allByOp[k] = [] }
      fatLookup[k][`${r.anno}-${r.mese}`] = r
      allByOp[k].push(r)
    }
    const avg = (arr, key) => arr.length
      ? arr.reduce((s, r) => s + parseFloat(r[key] || 0), 0) / arr.length : 0
    return mappings.map(m => {
      const opKey   = m.op_name_ipratico?.toUpperCase()
      const opData  = fatLookup[opKey] || {}
      const opAll   = allByOp[opKey] || []
      const storicoMesi = mesiQuery.map(({ anno, mese }) => ({
        anno, mese, label: `${String(mese).padStart(2,'0')}/${anno}`,
        ...opData[`${anno}-${mese}`] || {},
        haDati: !!opData[`${anno}-${mese}`],
      }))
      const prevYearRow   = opData[`${anno - 1}-${mese}`] || null
      const mesiConDati   = storicoMesi.filter(x => x.haDati)
      const annoRows      = opAll.filter(r => r.anno === anno && r.mese !== mese)
      const media_pezzi   = avg(mesiConDati, 'pezzi_totali')
      const media_fat     = avg(mesiConDati, 'fatturato_totale')
      const anno_pezzi    = avg(annoRows, 'pezzi_totali')
      const anno_fat      = avg(annoRows, 'fatturato_totale')
      const prevYearPezzi = parseFloat(prevYearRow?.pezzi_totali || 0)
      const prevYearFat   = parseFloat(prevYearRow?.fatturato_totale || 0)
      const mm = `${anno - 1}/${String(mese).padStart(2,'0')}`
      let basePezzi, baseFat, baseFonte
      switch (periodMode) {
        case 'media':
          basePezzi = media_pezzi; baseFat = media_fat
          baseFonte = mesiLookback === 1 ? 'mese prec.' : `media ${mesiConDati.length || mesiLookback}m`
          break
        case 'anno':
          basePezzi = anno_pezzi; baseFat = anno_fat
          baseFonte = `media ${anno} (${annoRows.length}m)`
          break
        case 'stagionale':
          basePezzi = prevYearPezzi; baseFat = prevYearFat
          baseFonte = `stagionale ${mm}`
          break
        case 'max':
        default:
          basePezzi = Math.max(media_pezzi, prevYearPezzi)
          baseFat   = Math.max(media_fat, prevYearFat)
          baseFonte = media_pezzi >= prevYearPezzi ? `media ${mesiConDati.length || mesiLookback}m` : mm
          break
      }
      return {
        employee_id:   m.employee_id,
        operatore:     m.op_name_ipratico,
        storico:       storicoMesi,
        datiAnnoPrec:  prevYearRow,
        media3m_pezzi: Math.round(media_pezzi),
        media3m_fat:   Math.round(media_fat),
        anno_pezzi:    Math.round(anno_pezzi),
        anno_fat:      Math.round(anno_fat),
        prevYearPezzi: Math.round(prevYearPezzi),
        prevYearFat:   Math.round(prevYearFat),
        quantum_pezzi: Math.round(basePezzi),
        target_pezzi:  Math.round(basePezzi * 1.10),
        quantum_fat:   Math.round(baseFat),
        target_fat:    Math.round(baseFat * 1.10),
        baseFonte, periodMode,
        nMesiConDati:  mesiConDati.length,
      }
    })
  },

  // ─── Fatturato/pezzi reali per operatore (per metrica FATTURATO_VENDUTO) ────
  // Ritorna mappa employee_id → { fatturato, pezzi } del mese richiesto.
  getFatturatoMensile: async ({ sede, anno, mese }) => {
    const s = locationToSede(sede) || sede
    const [{ data: fat }, { data: map }] = await Promise.all([
      supabase.from('v_fatturato_operatore_mensile')
        .select('operator, pezzi_totali, fatturato_totale')
        .eq('sede', s).eq('anno', parseInt(anno)).eq('mese', parseInt(mese)),
      supabase.from('employee_operator_mapping')
        .select('employee_id, op_name_ipratico').eq('sede', s),
    ])
    const fatByOp = {}
    for (const r of fat || []) fatByOp[r.operator?.toUpperCase()] = r
    const out = {}
    for (const m of map || []) {
      const r = fatByOp[m.op_name_ipratico?.toUpperCase()]
      if (r) out[m.employee_id] = {
        fatturato: parseFloat(r.fatturato_totale || 0),
        pezzi:     parseFloat(r.pezzi_totali || 0),
      }
    }
    return out
  },
}

// Calcolo bonus progressivo lato client
// ── Team: 50% del monte bonus a BE raggiunto, 100% a target, 150% oltre ─
export function calcBonusTeam(fatturatoAttuale, beTotale, targetFatturato, premioTeamEuro) {
  if (!premioTeamEuro || !beTotale) return 0
  if (fatturatoAttuale < beTotale) return 0
  // Fascia 50%→100%: valida solo se il target è oltre il BE (evita divisione per zero/negativa)
  if (targetFatturato > beTotale && fatturatoAttuale < targetFatturato) {
    const ratio = (fatturatoAttuale - beTotale) / (targetFatturato - beTotale)
    return +(premioTeamEuro * (0.5 + 0.5 * ratio)).toFixed(2) // 50% → 100%
  }
  // fatturato >= target (o target non oltre il BE): fascia 100%→150%
  const over = targetFatturato > 0
    ? Math.max(0, Math.min((fatturatoAttuale - targetFatturato) / targetFatturato, 0.5)) // cap 50% oltre
    : 0
  return +(premioTeamEuro * (1 + over)).toFixed(2) // 100% → 150%
}

// ── Individuale: 0 sotto quantum, lineare quantum→target (0%→100% del premio_max) ─
export function calcBonusIndividuale(valoreAttuale, quantum, target, premioMax) {
  if (!premioMax || !quantum) return 0
  if (valoreAttuale < quantum) return 0
  if (valoreAttuale >= target) return +Number(premioMax).toFixed(2)
  if (target <= quantum) return 0 // evita divisione per zero/negativa
  const ratio = (valoreAttuale - quantum) / (target - quantum)
  return +(premioMax * ratio).toFixed(2)
}

// ═══════════════════════════════════════════════════════════════════
// BE MENSILE — break-even per sede × mese (personale + fatture + fissi)
// ═══════════════════════════════════════════════════════════════════
// Arricchisce una riga BE con il forfait IVA 10% sul venduto e il margine netto.
// NB: 140 Grammi paga un forfait IVA del 10% sul venduto; i costi fattura restano a
// 'totale' (IVA inclusa, non recuperata). Il break-even (be/costi_totali) NON include
// l'IVA per non spostare le soglie bonus: l'IVA è esposta a parte e nel margine_netto.
function enrichBe(r) {
  if (!r) return r
  const fatt = Number(r.fatturato) || 0
  const costiTot = Number(r.costi_totali) || 0
  const iva_forfait = +(fatt * IVA_FORFAIT_PCT).toFixed(2)
  return {
    ...r,
    iva_forfait,
    fatturato_netto_iva: +(fatt - iva_forfait).toFixed(2),
    margine_netto: +(fatt - costiTot - iva_forfait).toFixed(2),
  }
}

export const beMensileApi = {
  list: async ({ sede, anno } = {}) => {
    let q = supabase.from('v_be_mensile').select('*').order('anno').order('mese')
    if (sede) q = q.eq('sede', locationToSede(sede) || sede)
    if (anno) q = q.eq('anno', parseInt(anno))
    const rows = await sbFetch(q)
    return rows.map(enrichBe)
  },
  mese: async ({ sede, anno, mese }) => {
    const s = locationToSede(sede) || sede
    const { data } = await supabase.from('v_be_mensile').select('*')
      .eq('sede', s).eq('anno', parseInt(anno)).eq('mese', parseInt(mese)).maybeSingle()
    return enrichBe(data)
  },
}

// ═══════════════════════════════════════════════════════════════════
// OPERATORE MESE — KPI per operatore × sede × mese
// ═══════════════════════════════════════════════════════════════════
export const operatoreMeseApi = {
  list: async ({ sede, anno, mese } = {}) => {
    let q = supabase.from('v_operatore_mese').select('*').order('tot_pezzi', { ascending: false })
    if (sede) q = q.eq('sede', locationToSede(sede) || sede)
    if (anno) q = q.eq('anno', parseInt(anno))
    if (mese) q = q.eq('mese', parseInt(mese))
    return sbFetch(q)
  },
}

// ═══════════════════════════════════════════════════════════════════
// OBIETTIVI PRODOTTO — target pezzi × prodotto × mese × reparto
// ═══════════════════════════════════════════════════════════════════
export const obiettiviProdottoApi = {
  list: async ({ sede, anno, mese, reparto, onlyActive = true } = {}) => {
    let q = supabase.from('obiettivi_prodotto').select('*')
      .order('reparto').order('prodotto')
    if (sede) q = q.eq('sede', locationToSede(sede) || sede)
    if (anno) q = q.eq('anno', parseInt(anno))
    if (mese) q = q.eq('mese', parseInt(mese))
    if (reparto) q = q.eq('reparto', reparto)
    if (onlyActive) q = q.eq('active', true)
    return sbFetch(q)
  },
  upsert: async (d) => {
    const payload = {
      sede: locationToSede(d.sede) || d.sede,
      anno: parseInt(d.anno), mese: parseInt(d.mese),
      prodotto: d.prodotto,
      categoria: d.categoria || null,
      reparto: d.reparto || 'ENTRAMBI',
      pezzi_base: parseInt(d.pezzi_base) || 0,
      pezzi_target: parseInt(d.pezzi_target) || 0,
      premio_euro: parseFloat(d.premio_euro) || 0,
      note: d.note || null,
      active: d.active !== false,
      updated_at: new Date().toISOString(),
    }
    if (d.id) {
      const { data, error } = await supabase.from('obiettivi_prodotto').update(payload).eq('id', d.id).select().single()
      if (error) throw error; return data
    }
    const { data, error } = await supabase.from('obiettivi_prodotto')
      .upsert(payload, { onConflict: 'sede,anno,mese,prodotto' }).select().single()
    if (error) throw error; return data
  },
  remove: async (id) => {
    const { error } = await supabase.from('obiettivi_prodotto').delete().eq('id', id)
    if (error) throw error; return { success: true }
  },
}

// ═══════════════════════════════════════════════════════════════════
// BONUS — stato obiettivi team + distribuzione payout per operatore
// ═══════════════════════════════════════════════════════════════════
export const bonusApi = {
  team: async ({ sede, anno, mese } = {}) => {
    let q = supabase.from('v_bonus_team').select('*').order('reparto').order('prodotto')
    if (sede) q = q.eq('sede', locationToSede(sede) || sede)
    if (anno) q = q.eq('anno', parseInt(anno))
    if (mese) q = q.eq('mese', parseInt(mese))
    return sbFetch(q)
  },
  operatori: async ({ sede, anno, mese } = {}) => {
    let q = supabase.from('v_bonus_operatore').select('*').order('payout_operatore', { ascending: false })
    if (sede) q = q.eq('sede', locationToSede(sede) || sede)
    if (anno) q = q.eq('anno', parseInt(anno))
    if (mese) q = q.eq('mese', parseInt(mese))
    return sbFetch(q)
  },
  calcola: async ({ sede, anno, mese, premio_team_euro = 500, pct_cucina = 40, pct_sala = 60 }) => {
    const s = locationToSede(sede) || sede
    const { data, error } = await supabase.rpc('calcola_obiettivi_mese', {
      p_sede: s,
      p_anno: parseInt(anno),
      p_mese: parseInt(mese),
      p_premio_team_euro: parseFloat(premio_team_euro),
      p_pct_cucina: parseFloat(pct_cucina),
      p_pct_sala: parseFloat(pct_sala),
    })
    if (error) throw error
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })); window.dispatchEvent(new Event('crm-kpi-updated')) } catch (_) {}
    return data
  },
}

// ─── VERIFICA DATI — Agente Verifica (Fase 2) ──────────────────────────────
// Chiama l'Edge Function deterministica 'verifica-dati' che restituisce il
// report a semaforo per le 6 aree dati di un dato mese.
export const verificaApi = {
  // run({ anno, mese }) → { anno, mese, overall, summary:{ok,warn,error}, checks:[...] }
  // Senza argomenti analizza il mese corrente.
  run: async ({ anno, mese } = {}) => {
    const body = {}
    if (anno) body.anno = parseInt(anno)
    if (mese) body.mese = parseInt(mese)
    const { data, error } = await supabase.functions.invoke('verifica-dati', { body })
    if (error) throw error
    return data
  },
}

// ─── BILANCI — bilanci civilistici depositati ─────────────────────────────
//
// Popolate da un job esterno che legge i PDF in Bilanci/. Schema reale:
//   bilanci                  testata per esercizio (anno, tipo, totali, risultato)
//   bilancio_voci            dettaglio gerarchico; NON ha `anno`, solo bilancio_id
//   v_bilancio_kpi           indici già calcolati (food/labour/prime cost, EBITDA)
//   v_bilancio_vs_gestionale riconciliazione civilistico ↔ CRM per voce
//
// Tutto l'accesso passa da qui: se un nome cambia si aggiorna solo questa mappa.
const BILANCI_TABELLE = {
  testate: 'bilanci',
  voci: 'bilancio_voci',
  kpi: 'v_bilancio_kpi',
  riconciliazione: 'v_bilancio_vs_gestionale',
  // Serie storica pluriennale e MULTI-SOCIETÀ: serve a leggere insieme
  // Sviluppo Ristorazione Italia e Good Food (che gestiva Mameli fino al
  // passaggio 2023/2024), quindi NON va filtrata per società come il resto.
  serieStorica: 'v_bilancio_serie_storica',
  // Controlli di quadratura del bilancio caricato (attivo=passivo, CE, ecc.):
  // dicono se i PDF sono stati letti correttamente.
  quadrature: 'v_bilancio_quadrature',
}

/** true se l'errore significa "questa tabella/vista non esiste (ancora)". */
function isRelazioneMancante(error) {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST106') return true
  return /does not exist|could not find the table|schema cache/i.test(error.message || '')
}

/** Scarica tutte le righe superando il cap PostgREST di 1000. */
async function fetchTutteLeRighe(build, orderCol, page = 1000) {
  const out = []
  for (let i = 0; ; i += page) {
    let q = build()
    if (orderCol) q = q.order(orderCol, { ascending: true })
    const { data, error } = await q.range(i, i + page - 1)
    if (error) throw error
    const batch = data ?? []
    out.push(...batch)
    if (batch.length < page) break
  }
  return out
}

/**
 * Legge una relazione dei bilanci distinguendo "non esiste ancora" da un
 * errore vero: la prima è uno stato legittimo (job non ancora eseguito), il
 * secondo va mostrato invece di essere confuso con "nessun dato".
 * @returns {Promise<{assente: boolean, rows: any[]}>}
 */
async function leggiRelazioneBilanci(table, orderCol) {
  try {
    const rows = await fetchTutteLeRighe(() => supabase.from(table).select('*'), orderCol)
    return { assente: false, rows }
  } catch (e) {
    if (isRelazioneMancante(e)) return { assente: true, rows: [] }
    throw new Error(`${table}: ${e.message || e}`)
  }
}

export const bilanciApi = {
  /**
   * Carica in un solo giro tutto ciò che serve alla sezione Bilanci.
   *
   * Le voci vengono arricchite con anno e tipo del bilancio di appartenenza:
   * `bilancio_voci` espone solo `bilancio_id`, quindi senza questa join lato
   * client ogni riga risulterebbe senza esercizio e le tabelle per anno
   * resterebbero vuote.
   */
  caricaTutto: async () => {
    const [testate, voci, kpi, riconciliazione, serieStorica, quadrature] = await Promise.all([
      leggiRelazioneBilanci(BILANCI_TABELLE.testate, 'anno'),
      leggiRelazioneBilanci(BILANCI_TABELLE.voci, 'id'),
      leggiRelazioneBilanci(BILANCI_TABELLE.kpi, 'anno'),
      leggiRelazioneBilanci(BILANCI_TABELLE.riconciliazione, 'anno'),
      leggiRelazioneBilanci(BILANCI_TABELLE.serieStorica, 'anno'),
      leggiRelazioneBilanci(BILANCI_TABELLE.quadrature, 'anno'),
    ])

    const perId = new Map(testate.rows.map(b => [b.id, b]))
    const vociArricchite = voci.rows.map(v => {
      const b = perId.get(v.bilancio_id)
      return { ...v, anno: b?.anno ?? null, tipo_bilancio: b?.tipo ?? null }
    })

    return {
      stato: {
        testate: testate.assente ? null : BILANCI_TABELLE.testate,
        voci: voci.assente ? null : BILANCI_TABELLE.voci,
        kpi: kpi.assente ? null : BILANCI_TABELLE.kpi,
        riconciliazione: riconciliazione.assente ? null : BILANCI_TABELLE.riconciliazione,
        serieStorica: serieStorica.assente ? null : BILANCI_TABELLE.serieStorica,
        quadrature: quadrature.assente ? null : BILANCI_TABELLE.quadrature,
      },
      testate: testate.rows,
      voci: vociArricchite,
      kpi: kpi.rows,
      riconciliazione: riconciliazione.rows,
      serieStorica: serieStorica.rows,
      quadrature: quadrature.rows,
    }
  },


}

// ════════════════════════════════════════════════════════════════════════════
// ANALISI COSTI & PREZZI — sfrutta i 114.650 righe di dettaglio fattura
// ════════════════════════════════════════════════════════════════════════════
//
// Fino a ieri le fatture erano leggibili solo per TESTATA (fornitore, totale).
// Con `fatture_righe` si può finalmente rispondere a domande che prima erano
// fuori portata: quanto è aumentato QUELL'articolo, chi me lo vende meglio,
// quanto pesa ogni categoria merceologica su ogni sede.
//
// Tre avvertenze che valgono per tutto il modulo e che la UI deve ripetere:
//
//  • `fatture_righe.importo_riga` e `prezzo_unitario` sono NETTI IVA, mentre
//    `fatture_importate.totale` è LORDO. Non vanno mai sommati insieme.
//  • Le note di credito (TD04) sono già NEGATIVE in `fatture_righe`, quindi si
//    sommano così come sono. In `fatture_importate` invece sono positive e
//    andrebbero sottratte: è la ragione per cui le due fonti non tornano se si
//    mescolano.
//  • Le 9.960 fatture dal 2019 al 2024 NON hanno sede. Ogni analisi per sede
//    su quel periodo è impossibile, non "vuota": il modulo lo dichiara con
//    `righe_senza_sede` invece di far sparire i dati o di inventare un 50/50.

const CATEGORIE_NON_MERCE = new Set(['ALTRO', 'NON_CLASSIFICATO'])

export const analisiCostiApi = {
  /** Categorie merceologiche con i flag is_food_cost / is_materia_prima. */
  categorie: async () => sbFetch(
    supabase.from('categorie_merceologiche').select('*').order('ordine')
  ),

  /**
   * Prezzi per articolo nel tempo, con confronto fra fornitori.
   *
   * L'aggregazione è lato client perché PostgREST ha le funzioni di aggregato
   * disabilitate su questo progetto (verificato: `select=...sum()` → PGRST123
   * "Use of aggregate functions is not allowed"). Quindi si scaricano le righe
   * del periodo con paginazione vera e si aggrega qui.
   *
   * Vengono ignorate le righe con `prezzo_unitario` nullo o ≤ 0: senza prezzo
   * unitario un confronto fra fornitori non ha significato, e includerle come
   * "0" farebbe risultare qualunque articolo in calo.
   *
   * @returns {{ articoli, righeLette, troncato, righeSenzaSede }}
   */
  prezziArticoli: async ({ from, to, sede, categoria, search, minAcquisti = 3 } = {}) => {
    const build = () => {
      let q = supabase.from('fatture_righe')
        .select('id, nome_normalizzato, descrizione, fornitore, p_iva, data_fattura, quantita, unita_misura, prezzo_unitario, importo_riga, categoria, sede')
        .not('nome_normalizzato', 'is', null)
        .gt('prezzo_unitario', 0)
      if (from) q = q.gte('data_fattura', from)
      if (to)   q = q.lte('data_fattura', to)
      if (sede && sede !== 'ALL') q = q.eq('sede', sede)
      if (categoria && categoria !== 'ALL') q = q.eq('categoria', categoria)
      if (search) q = q.ilike('nome_normalizzato', `%${escapeLike(search)}%`)
      return q
    }

    const { righe, troncato } = await fetchPagedInfo(build, 'id', { max: 150000 })

    const perArticolo = new Map()
    let righeSenzaSede = 0
    for (const r of righe) {
      if (!r.sede) righeSenzaSede++
      const k = r.nome_normalizzato
      if (!perArticolo.has(k)) perArticolo.set(k, {
        nome: k,
        descrizione: r.descrizione,
        categoria: r.categoria,
        um: r.unita_misura,
        fornitori: new Map(),
        acquisti: 0,
        spesa: 0,
        quantita: 0,
        primo: null, ultimo: null,
        prezzoMin: null, prezzoMax: null,
      })
      const a = perArticolo.get(k)
      const prezzo = Number(r.prezzo_unitario)
      const data = r.data_fattura || ''

      a.acquisti++
      a.spesa += Number(r.importo_riga) || 0
      a.quantita += Number(r.quantita) || 0
      if (r.unita_misura && !a.um) a.um = r.unita_misura

      if (a.prezzoMin === null || prezzo < a.prezzoMin) a.prezzoMin = prezzo
      if (a.prezzoMax === null || prezzo > a.prezzoMax) a.prezzoMax = prezzo
      if (!a.primo  || data < a.primo.data)  a.primo  = { data, prezzo, fornitore: r.fornitore }
      if (!a.ultimo || data > a.ultimo.data) a.ultimo = { data, prezzo, fornitore: r.fornitore }

      const f = r.fornitore || '(senza fornitore)'
      if (!a.fornitori.has(f)) a.fornitori.set(f, { fornitore: f, p_iva: r.p_iva, acquisti: 0, spesa: 0, sommaPrezzi: 0, ultimo: null, prezzoMin: prezzo })
      const fo = a.fornitori.get(f)
      fo.acquisti++
      fo.spesa += Number(r.importo_riga) || 0
      fo.sommaPrezzi += prezzo
      if (prezzo < fo.prezzoMin) fo.prezzoMin = prezzo
      if (!fo.ultimo || data > fo.ultimo.data) fo.ultimo = { data, prezzo }
    }

    const articoli = []
    for (const a of perArticolo.values()) {
      if (a.acquisti < minAcquisti) continue
      const fornitori = [...a.fornitori.values()]
        .map(f => ({ ...f, prezzoMedio: f.sommaPrezzi / f.acquisti, ultimoPrezzo: f.ultimo?.prezzo ?? null, ultimaData: f.ultimo?.data ?? null }))
        .sort((x, y) => y.spesa - x.spesa)

      // Confronto fra fornitori sullo STESSO articolo: ha senso solo con almeno
      // due fornitori. Con uno solo il "risparmio potenziale" sarebbe un numero
      // inventato, quindi resta null.
      const migliore = fornitori.length > 1
        ? fornitori.reduce((m, f) => (f.prezzoMedio < m.prezzoMedio ? f : m), fornitori[0])
        : null
      const peggiore = fornitori.length > 1
        ? fornitori.reduce((m, f) => (f.prezzoMedio > m.prezzoMedio ? f : m), fornitori[0])
        : null

      const p0 = a.primo?.prezzo ?? null
      const p1 = a.ultimo?.prezzo ?? null
      articoli.push({
        nome: a.nome,
        descrizione: a.descrizione,
        categoria: a.categoria,
        um: a.um || null,
        acquisti: a.acquisti,
        quantita: a.quantita,
        spesa: a.spesa,
        nFornitori: fornitori.length,
        primoPrezzo: p0, primaData: a.primo?.data ?? null,
        ultimoPrezzo: p1, ultimaData: a.ultimo?.data ?? null,
        prezzoMin: a.prezzoMin, prezzoMax: a.prezzoMax,
        // null (non 0) quando la variazione non è calcolabile: "0%" vorrebbe
        // dire "prezzo invariato", che è un'affermazione diversa da "non so".
        variazionePct: p0 && p1 ? ((p1 - p0) / p0) * 100 : null,
        // Escursione fra il minimo e il massimo pagato nel periodo: è
        // l'indicatore che fa emergere gli articoli comprati a prezzi ballerini
        // anche quando primo e ultimo prezzo coincidono.
        escursionePct: a.prezzoMin > 0 ? ((a.prezzoMax - a.prezzoMin) / a.prezzoMin) * 100 : null,
        fornitori,
        migliorFornitore: migliore ? migliore.fornitore : null,
        migliorPrezzo: migliore ? migliore.prezzoMedio : null,
        peggiorFornitore: peggiore ? peggiore.fornitore : null,
        peggiorPrezzo: peggiore ? peggiore.prezzoMedio : null,
        // Quanto si sarebbe speso in meno comprando sempre dal fornitore più
        // economico, a parità di quantità acquistate.
        risparmioPotenziale: migliore && peggiore && migliore !== peggiore
          ? fornitori.reduce((s, f) => s + Math.max(0, (f.prezzoMedio - migliore.prezzoMedio)) * (f.spesa / (f.prezzoMedio || 1)), 0)
          : null,
      })
    }

    articoli.sort((a, b) => b.spesa - a.spesa)
    return { articoli, righeLette: righe.length, troncato, righeSenzaSede }
  },

  /** Serie temporale dei prezzi di un singolo articolo, per fornitore. */
  storicoArticolo: async ({ nome, from, to } = {}) => {
    if (!nome) return []
    const build = () => {
      let q = supabase.from('fatture_righe')
        .select('id, data_fattura, fornitore, prezzo_unitario, quantita, importo_riga, unita_misura, numero_fattura, sede')
        .eq('nome_normalizzato', nome)
        .gt('prezzo_unitario', 0)
      if (from) q = q.gte('data_fattura', from)
      if (to)   q = q.lte('data_fattura', to)
      return q
    }
    const righe = await sbFetchPaged(build, 'id')
    return righe.sort((a, b) => String(a.data_fattura).localeCompare(String(b.data_fattura)))
  },

  /**
   * Spesa per categoria merceologica, per mese e per sede.
   *
   * Le categorie ALTRO e NON_CLASSIFICATO restano nel risultato ma marcate:
   * NON_CLASSIFICATO in particolare non è "zero" né "altro", è "nessuna delle
   * 182 regole ha riconosciuto la riga" — è un debito da presidiare, e
   * nasconderlo farebbe sembrare la classificazione migliore di com'è.
   */
  spesaMerceologica: async ({ from, to, sede } = {}) => {
    const [cats, res] = await Promise.all([
      analisiCostiApi.categorie(),
      fetchPagedInfo(() => {
        let q = supabase.from('fatture_righe')
          .select('id, data_fattura, categoria, importo_riga, sede, fornitore')
        if (from) q = q.gte('data_fattura', from)
        if (to)   q = q.lte('data_fattura', to)
        if (sede && sede !== 'ALL') q = q.eq('sede', sede)
        return q
      }, 'id', { max: 150000 }),
    ])

    const metaCat = new Map(cats.map(c => [c.categoria, c]))
    const perCatMese = new Map()
    const perCat = new Map()
    let righeSenzaSede = 0

    for (const r of res.righe) {
      if (!r.sede) righeSenzaSede++
      const cat = r.categoria || 'NON_CLASSIFICATO'
      const mese = (r.data_fattura || '').substring(0, 7)
      const imp = Number(r.importo_riga) || 0
      const m = metaCat.get(cat)

      const kc = cat
      if (!perCat.has(kc)) perCat.set(kc, {
        categoria: cat,
        macro: m?.macro ?? 'IGNOTO',
        isFoodCost: m?.is_food_cost ?? false,
        isMateriaPrima: m?.is_materia_prima ?? false,
        daPresidiare: CATEGORIE_NON_MERCE.has(cat),
        spesa: 0, righe: 0, MA: 0, PN: 0, senzaSede: 0,
        fornitori: new Set(),
      })
      const c = perCat.get(kc)
      c.spesa += imp; c.righe++
      if (r.fornitore) c.fornitori.add(r.fornitore)
      if (r.sede === 'MA') c.MA += imp
      else if (r.sede === 'PN') c.PN += imp
      else c.senzaSede += imp

      const km = `${mese}|${cat}`
      if (!perCatMese.has(km)) perCatMese.set(km, { mese, categoria: cat, macro: m?.macro ?? 'IGNOTO', spesa: 0, MA: 0, PN: 0 })
      const cm = perCatMese.get(km)
      cm.spesa += imp
      if (r.sede === 'MA') cm.MA += imp
      else if (r.sede === 'PN') cm.PN += imp
    }

    return {
      perCategoria: [...perCat.values()]
        .map(c => ({ ...c, nFornitori: c.fornitori.size, fornitori: undefined }))
        .sort((a, b) => b.spesa - a.spesa),
      perCategoriaMese: [...perCatMese.values()].sort((a, b) => a.mese.localeCompare(b.mese)),
      righeLette: res.righe.length,
      troncato: res.troncato,
      righeSenzaSede,
    }
  },

  /**
   * Conto economico gestionale per sede, con separazione fra costi DIRETTI di
   * locale e STRUTTURA CENTRALE.
   *
   * È la lettura che mancava. Sommando tutto insieme, Mameli risulta in perdita
   * e basta; separando le voci si vede che su Mameli gravano Amministrazione e
   * Marketing — cioè personale che serve entrambi i locali — mentre su Predda
   * Niedda non grava nulla di analogo. Senza questa distinzione le due sedi non
   * sono confrontabili.
   *
   * Tutto è calcolato AL NETTO IVA, perché i costi fornitori sono netti:
   *  • ricavi netti = corrispettivi / 1,10 (stessa convenzione di
   *    v_food_cost_mensile, aliquota ristorazione)
   *  • costi fornitori = somma di `fatture_righe.importo_riga` (già netta)
   * Confrontare corrispettivi lordi con costi netti gonfierebbe il margine.
   *
   * Il personale senza reparto assegnato NON viene silenziosamente attribuito
   * al diretto: resta in una voce propria, perché su Mameli 2026 vale 129.405 €,
   * un terzo del costo del personale, e spalmarlo cambierebbe la conclusione.
   *
   * @param {string} da  'YYYY-MM-DD'
   * @param {string} a   'YYYY-MM-DD'
   */
  marginalitaSedi: async ({ da, a } = {}) => {
    const annoDa = parseInt(String(da).substring(0, 4), 10)
    const annoA  = parseInt(String(a).substring(0, 4), 10)
    const meseDa = parseInt(String(da).substring(5, 7), 10)
    const meseA  = parseInt(String(a).substring(5, 7), 10)
    const dentroPeriodo = (anno, mese) => {
      const k = anno * 12 + mese
      return k >= annoDa * 12 + meseDa && k <= annoA * 12 + meseA
    }

    const [chiusure, righeFatt, buste, dipendenti, reparti, fissi] = await Promise.all([
      sbFetchPaged(() => supabase.from('chiusure_giornaliere')
        .select('id, sede, data, totale_venduto_ipratico, totale_venduto_dgfe, coperti')
        .gte('data', da).lte('data', a), 'id'),
      fetchPagedInfo(() => supabase.from('fatture_righe')
        .select('id, sede, data_fattura, importo_riga, categoria')
        .gte('data_fattura', da).lte('data_fattura', a), 'id', { max: 150000 }),
      sbFetchPaged(() => supabase.from('buste_paga')
        .select('id, sede, anno, mese, costo_azienda, netto, employee_id, is_stima')
        .gte('anno', annoDa).lte('anno', annoA), 'id'),
      sbFetchPaged(() => supabase.from('employees').select('id, reparto_id, cost_split'), 'id'),
      sbFetch(supabase.from('reparti').select('id, nome')),
      sbFetchPaged(() => supabase.from('costi_fissi')
        .select('id, sede, anno, mese, importo, escludi_da_be')
        .gte('anno', annoDa).lte('anno', annoA), 'id'),
    ])

    const repartoDi = new Map(reparti.map(r => [r.id, r.nome]))
    const repartoDip = new Map(dipendenti.map(e => [e.id, repartoDi.get(e.reparto_id) ?? null]))
    // Come si ripartisce il costo di chi serve entrambi i locali. Sta gia' su
    // employees.cost_split ({"MA":0.5,"PN":0.5}) ed e' la stessa regola che usa
    // v_costo_personale_per_sede: qui va solo applicata.
    const splitDip = new Map(dipendenti.map(e => [e.id, e.cost_split || null]))

    // I reparti che servono entrambi i locali. Ricavati dai nomi perché
    // `reparti` non ha (ancora) un flag "struttura centrale": se un domani lo
    // avrà, basterà leggerlo qui.
    const REPARTI_CENTRALI = new Set(['Amministrazione', 'Marketing'])

    const vuota = () => ({
      ricaviLordi: 0, ricaviNetti: 0, coperti: 0, giorni: 0,
      fornitori: 0, fornitoriFood: 0,
      persDiretto: 0, persCentrale: 0, persNonAssegnato: 0, persStima: 0,
      fissi: 0,
      dettaglioReparti: {},
    })
    const perSede = { MA: vuota(), PN: vuota() }
    const perMese = new Map()
    const mese = (s, m) => {
      if (!perMese.has(m)) perMese.set(m, { mese: m, MA: vuota(), PN: vuota() })
      return perMese.get(m)[s]
    }

    for (const c of chiusure) {
      const s = c.sede
      if (!perSede[s]) continue
      const lordo = Number(c.totale_venduto_ipratico ?? c.totale_venduto_dgfe) || 0
      const m = String(c.data).substring(0, 7)
      for (const t of [perSede[s], mese(s, m)]) {
        t.ricaviLordi += lordo
        t.ricaviNetti += lordo / 1.10
        t.coperti += Number(c.coperti) || 0
        t.giorni++
      }
    }

    let righeFattSenzaSede = 0
    for (const r of righeFatt.righe) {
      const s = r.sede
      const imp = Number(r.importo_riga) || 0
      if (!perSede[s]) { righeFattSenzaSede++; continue }
      const m = String(r.data_fattura).substring(0, 7)
      for (const t of [perSede[s], mese(s, m)]) {
        t.fornitori += imp
        if (!CATEGORIE_NON_MERCE.has(r.categoria)) t.fornitoriFood += imp
      }
    }

    for (const b of buste) {
      const s = b.sede
      if (!perSede[s] || !dentroPeriodo(b.anno, b.mese)) continue
      const costo = Number(b.costo_azienda) || (Number(b.netto) || 0) * 1.79
      const rep = b.employee_id ? repartoDip.get(b.employee_id) ?? null : null
      const m = `${b.anno}-${String(b.mese).padStart(2, '0')}`
      // Le righe `is_stima` non sono persone: sono la chiusura stimata del mese
      // in attesa del LUL. Mescolarle al "senza reparto" faceva sembrare non
      // classificato un quinto del costo di Mameli, quando era solo una stima.
      const voce = b.is_stima ? 'persStima'
        : rep === null ? 'persNonAssegnato'
        : REPARTI_CENTRALI.has(rep) ? 'persCentrale' : 'persDiretto'
      const nome = b.is_stima ? '(stima mese in corso)' : rep ?? '(reparto non assegnato)'

      // Amministrazione e marketting lavorano per tutti e due i locali: il costo
      // va diviso, non lasciato tutto sulla sede che compare in busta paga (che
      // per tutti e sei e' MA e falsava il confronto fra le sedi). La quota sta
      // in employees.cost_split; senza quella si divide a meta'.
      const quote = (voce === 'persCentrale')
        ? (splitDip.get(b.employee_id) || { MA: 0.5, PN: 0.5 })
        : { [s]: 1 }

      for (const [sedeQ, q] of Object.entries(quote)) {
        if (!perSede[sedeQ] || !q) continue
        const parte = costo * Number(q)
        for (const t of [perSede[sedeQ], mese(sedeQ, m)]) {
          t[voce] += parte
          t.dettaglioReparti[nome] = (t.dettaglioReparti[nome] || 0) + parte
        }
      }
    }

    for (const f of fissi) {
      const s = f.sede
      if (!perSede[s] || f.escludi_da_be === true || !dentroPeriodo(f.anno, f.mese)) continue
      const m = `${f.anno}-${String(f.mese).padStart(2, '0')}`
      const imp = Number(f.importo) || 0
      perSede[s].fissi += imp
      mese(s, m).fissi += imp
    }

    const chiudi = (t) => {
      // La stima entra nel costo di sede: è personale che c'è stato davvero,
      // solo il cedolino non è ancora arrivato. Resta però su una voce sua,
      // così si vede quanta parte del risultato non è ancora consuntivo.
      const personaleSede = t.persDiretto + t.persNonAssegnato + t.persStima
      const margineSede = t.ricaviNetti - t.fornitori - personaleSede - t.fissi
      const risultato = margineSede - t.persCentrale
      const pct = v => (t.ricaviNetti > 0 ? (v / t.ricaviNetti) * 100 : null)
      return {
        ...t,
        personaleSede,
        personaleTotale: personaleSede + t.persCentrale,
        margineSede,
        risultato,
        // Percentuali null (non 0) quando non c'è un fatturato su cui calcolarle
        fornitoriPct: pct(t.fornitori),
        personaleSedePct: pct(personaleSede),
        personaleCentralePct: pct(t.persCentrale),
        persStimaPct: pct(t.persStima),
        fissiPct: pct(t.fissi),
        margineSedePct: pct(margineSede),
        risultatoPct: pct(risultato),
        primeCostPct: pct(t.fornitori + personaleSede),
        copertoMedioNetto: t.coperti > 0 ? t.ricaviNetti / t.coperti : null,
      }
    }

    return {
      sedi: { MA: chiudi(perSede.MA), PN: chiudi(perSede.PN) },
      mensile: [...perMese.entries()]
        .sort((x, y) => x[0].localeCompare(y[0]))
        .map(([m, v]) => ({ mese: m, MA: chiudi(v.MA), PN: chiudi(v.PN) })),
      // Trasparenza sul dato: quante righe fattura del periodo non hanno sede
      // e quindi NON sono attribuite a nessuno dei due locali.
      righeFattSenzaSede,
      righeFattLette: righeFatt.righe.length,
      troncato: righeFatt.troncato,
    }
  },

  /**
   * Serie storica pluriennale della spesa fornitori (7 esercizi).
   * Legge le viste già aggregate a DB: 85 righe per il macro mensile e 1.689
   * per il dettaglio categoria/sede, quindi niente paginazione pesante.
   */
  serieStorica: async () => {
    const [macro, perCategoria] = await Promise.all([
      sbFetchPaged(() => supabase.from('v_macro_spesa_mensile').select('*'), 'anno_mese'),
      sbFetchPaged(() => supabase.from('v_spesa_categoria_sede_mese').select('*'), 'mese'),
    ])
    return { macro, perCategoria }
  },

  /** Food cost mensile per sede (vista già pronta, copre dal 2025). */
  foodCostMensile: async () => sbFetchPaged(
    () => supabase.from('v_food_cost_mensile').select('*'), 'mese'
  ),
}

// ═══════════════════════════════════════════════════════════════════
// CONTROLLO COSTI
// Fonte unica della sezione: v_controllo_costi_mensile e v_controllo_costi_voci.
// Nessuna percentuale e nessuna soglia si calcola qui: il semaforo arriva già
// deciso dal database, altrimenti diventerebbe la settima implementazione del
// break-even (ne esistono già sei, che non coincidono fra loro).
// ═══════════════════════════════════════════════════════════════════
export const controlloCosti = {
  /**
   * Righe mensili del cruscotto.
   * @param livello  'MA' | 'PN' | 'GR' | 'TOT'  (omesso = tutti)
   * @param modalita 'DIRETTO' (default) | 'PIENO'
   * @param base     'NETTO' (default) | 'LORDO'
   * @param annoDa/annoA  intervallo di anni, estremi inclusi
   */
  mensile: async ({ livello, modalita = 'DIRETTO', base = 'NETTO', annoDa, annoA } = {}) => {
    const build = () => {
      let q = supabase.from('v_controllo_costi_mensile').select('*')
        .eq('modalita', modalita).eq('base', base)
      const l = locationToSede(livello) || livello
      if (l && l !== 'ALL') q = q.eq('livello', l)
      if (annoDa) q = q.gte('anno', parseInt(annoDa))
      if (annoA)  q = q.lte('anno', parseInt(annoA))
      return q
    }
    // La vista non ha PK: si pagina sulla combinazione che è univoca.
    const righe = await sbFetchPaged(build, ['anno', 'mese', 'livello'])
    return righe.sort((a, b) =>
      (a.anno - b.anno) || (a.mese - b.mese) || String(a.livello).localeCompare(String(b.livello)))
  },

  /** Righe voce per voce, con soglia in vigore ed esito semaforo già calcolati. */
  voci: async ({ livello, modalita = 'DIRETTO', base = 'NETTO', anno, mese, annoDa } = {}) => {
    const build = () => {
      let q = supabase.from('v_controllo_costi_voci').select('*')
        .eq('modalita', modalita).eq('base', base)
      const l = locationToSede(livello) || livello
      if (l && l !== 'ALL') q = q.eq('livello', l)
      if (anno)   q = q.eq('anno', parseInt(anno))
      if (mese)   q = q.eq('mese', parseInt(mese))
      if (annoDa) q = q.gte('anno', parseInt(annoDa))
      return q
    }
    const righe = await sbFetchPaged(build, ['anno', 'mese', 'livello', 'ordine'])
    return righe.sort((a, b) =>
      (a.anno - b.anno) || (a.mese - b.mese) ||
      String(a.livello).localeCompare(String(b.livello)) || (a.ordine - b.ordine))
  },

  /** Soglie del semaforo. */
  parametri: async () => {
    const { data, error } = await supabase.from('parametri_costi').select('*')
      .order('base').order('voce').order('livello')
    if (error) throw error
    return data ?? []
  },

  salvaParametro: async (d) => {
    // Whitelist esplicita: mai `...d` grezzo, altrimenti il client può scrivere
    // qualsiasi colonna, id e created_at incluse.
    const payload = {
      livello:        d.livello || 'ALL',
      voce:           d.voce,
      base:           d.base || 'NETTO',
      soglia_verde:   parseFloat(d.soglia_verde),
      soglia_gialla:  parseFloat(d.soglia_gialla),
      obiettivo:      d.obiettivo === '' || d.obiettivo == null ? null : parseFloat(d.obiettivo),
      driver_riparto: d.driver_riparto || 'FATTURATO',
      valido_da:      d.valido_da || '2019-01-01',
      valido_a:       d.valido_a || null,
      note:           d.note || null,
      updated_at:     new Date().toISOString(),
    }
    if (!(payload.soglia_verde <= payload.soglia_gialla)) {
      throw new Error('La soglia verde deve essere minore o uguale alla gialla')
    }
    const { data, error } = await supabase.from('parametri_costi')
      .upsert(payload, { onConflict: 'livello,voce,base,valido_da' }).select().single()
    if (error) throw error
    notificaKpiAggiornati()
    return data
  },

  eliminaParametro: async (id) => {
    const { error } = await supabase.from('parametri_costi').delete().eq('id', id)
    if (error) throw error
    notificaKpiAggiornati()
    return { success: true }
  },

  /** Chi è food e chi è servizi: stato della classificazione fornitori. */
  fornitoriClassificazione: async ({ stato, minSpesa12m } = {}) => {
    const build = () => {
      let q = supabase.from('v_fornitori_classificazione').select('*')
      if (stato) q = q.eq('stato', stato)
      if (minSpesa12m != null) q = q.gte('spesa_12m', parseFloat(minSpesa12m))
      return q
    }
    const righe = await sbFetchPaged(build, 'fornitore_id')
    return righe.sort((a, b) => (b.spesa_12m || 0) - (a.spesa_12m || 0))
  },

  /** Categorie disponibili per la riclassificazione. */
  categorie: async () => {
    const { data, error } = await supabase.from('fattura_categorie')
      .select('*').neq('attivo', false).order('nome')
    if (error) throw error
    return data ?? []
  },

  /** Collega un fornitore a una categoria (è la riparazione dei 180 "SOLO_TESTO"). */
  collegaCategoria: async (fornitoreId, categoriaId, categoriaTipo) => {
    const payload = { categoria_id: categoriaId, updated_at: new Date().toISOString() }
    // Allinea anche l'etichetta testuale: tenerle diverse è proprio il caso INCOERENTE.
    if (categoriaTipo) payload.categoria = categoriaTipo
    const { error } = await supabase.from('fornitori_fatture').update(payload).eq('id', fornitoreId)
    if (error) throw error
    notificaKpiAggiornati()
    return { success: true }
  },

  /** SEDE / GRUPPO / MISTO per un fornitore. */
  impostaAmbito: async (fornitoreId, ambito) => {
    if (!['SEDE', 'GRUPPO', 'MISTO'].includes(ambito)) throw new Error(`Ambito non valido: ${ambito}`)
    const { error } = await supabase.from('fornitori_fatture')
      .update({ ambito_default: ambito, updated_at: new Date().toISOString() }).eq('id', fornitoreId)
    if (error) throw error
    notificaKpiAggiornati()
    return { success: true }
  },

  /** Mappa categoria fornitore → voce di costo. */
  mappaVoci: async () => {
    const { data, error } = await supabase.from('mappa_voci_costo').select('*').order('voce').order('tipo')
    if (error) throw error
    return data ?? []
  },

  salvaMappaVoce: async (tipo, voce) => {
    const { error } = await supabase.from('mappa_voci_costo')
      .upsert({ tipo, voce, updated_at: new Date().toISOString() }, { onConflict: 'tipo' })
    if (error) throw error
    notificaKpiAggiornati()
    return { success: true }
  },
}


export default {
  modules, employees, chiusure, kpi, venduto,
  fornitori, pagamentiFatture, prodottiCatalogo, listinoApi, ricetteApi, chat, data, analytics, bustePaga, statistiche, turni,
  roles, admin, crmConfig, sediApi, operatorMapping, repartiApi,
  fattureCategorieApi, costiFissiApi, standardNazionaliApi, kpiTargetsApi, kpiPerformanceApi,
  beMensileApi, operatoreMeseApi, obiettiviProdottoApi, bonusApi,
  fattureBi, bilanciApi, analisiCostiApi, controlloCosti,
  calcBonusTeam, calcBonusIndividuale,
  verificaApi,
}

// ── Analisi precalcolate (crm_insight) ───────────────────────────────────────
// La pagina Analisi legge soltanto qui: le schede le scrive un agente che gira
// per conto suo con l'abbonamento Claude, non il browser. Nessuna chiave API
// nel client, nessuna chiamata esterna a ogni apertura della pagina.
export const insightApi = {
  // Solo l'ultima versione di ogni analisi (la vista fa il distinct on slug).
  correnti: async ({ categoria, sede, severita } = {}) => {
    let q = supabase.from('v_crm_insight_corrente').select('*')
    if (categoria) q = q.eq('categoria', categoria)
    if (sede === 'gruppo') q = q.is('sede', null)
    else if (sede)        q = q.eq('sede', sede)
    if (severita) q = q.eq('severita', severita)
    // Ordine di lettura: prima i critici, poi l'ordine deciso da chi le scrive.
    const { data, error } = await q
      .order('categoria', { ascending: true })
      .order('ordine', { ascending: true })
      .limit(500)
    if (error) throw error
    return data ?? []
  },

  // Lo storico di una singola analisi: serve a vedere come si e' mosso un numero.
  storico: async (slug, limite = 30) => {
    const { data, error } = await supabase
      .from('crm_insight').select('*')
      .eq('slug', slug)
      .order('generato_il', { ascending: false })
      .limit(limite)
    if (error) throw error
    return data ?? []
  },

  stato: async () => {
    const { data, error } = await supabase.from('v_crm_insight_stato').select('*')
    if (error) throw error
    return data ?? []
  },
}

// ── Commercialista: notule, acconti, saldo ───────────────────────────────────
// Le fatture ELSO REI sono acconti, non il costo: il costo sta nelle notule.
// Vale solo quella con is_corrente, e le viste la isolano gia'.
export const commercialistaApi = {
  quadro: async () => {
    const [saldo, notule, mensile, acconti, pratiche, voci, incidenza] = await Promise.all([
      supabase.from('v_notule_saldo').select('*'),
      supabase.from('v_notule_riepilogo').select('*').order('data_avviso', { ascending: false }),
      supabase.from('v_notule_costo_mensile').select('*'),
      supabase.from('v_notule_acconti').select('*').order('data_acconto', { ascending: true }),
      supabase.from('v_notule_pratiche_dipendente').select('*').order('costo_totale', { ascending: false }),
      // Le singole righe della notula corrente: servono a mostrare, sotto ogni
      // barra del grafico, le voci esatte che la compongono. Senza queste la
      // pagina puo' dire quanto, non perche'.
      supabase.from('v_notule_voci').select('*').order('riga_ordine', { ascending: true }),
      // Fatturato e costo del personale degli stessi mesi, per dire quanto
      // pesa lo studio invece di dire soltanto quanto costa.
      supabase.from('v_notule_incidenza').select('*'),
    ])
    // Una vista che fallisce non deve far sparire tutte le altre: la sezione
    // corrispondente resta vuota e il resto della pagina si vede lo stesso.
    for (const r of [saldo, notule, mensile, acconti, pratiche, voci, incidenza]) {
      if (r.error && r === saldo) throw r.error
      if (r.error) console.error('commercialistaApi:', r.error)
    }
    return {
      saldo:     saldo.data ?? [],
      notule:    notule.data ?? [],
      mensile:   mensile.data ?? [],
      acconti:   acconti.data ?? [],
      pratiche:  pratiche.data ?? [],
      voci:      voci.data ?? [],
      incidenza: incidenza.data ?? [],
    }
  },

  righeNotula: async (notula_id) => {
    const { data, error } = await supabase
      .from('notule_righe').select('*')
      .eq('notula_id', notula_id)
      .order('riga_ordine', { ascending: true })
    if (error) throw error
    return data ?? []
  },
}

// ── F24 — deleghe di versamento ──────────────────────────────────────────────
//
// REGOLA CONTABILE DA NON PERDERE MAI DI VISTA:
// gli importi F24 NON vanno sommati al costo del personale. I contributi del
// DM10 sono ESATTAMENTE gli stessi soldi che stanno gia' nei cedolini
// (buste_paga): l'F24 e' il mezzo con cui si versano, non un costo in piu'.
// Le due fonti si RICONCILIANO — v_f24_riconciliazione_contributi — e basta.
//
// Fonte: PDF "Modello F24 in scadenza al GGMMAAAA" prodotti dallo studio.
// La data nel nome del file e' la SCADENZA: la competenza e' il mese PRIMA
// (F24 del 16/02/2026 = gennaio 2026). Il campo mese_competenza gia' lo applica.
export const f24Api = {
  quadro: async () => {
    const [deleghe, righe, codici, mensile, perCodice, avvisi, riconc, copertura] = await Promise.all([
      supabase.from('f24_deleghe').select('*').order('scadenza', { ascending: true }).order('pagina', { ascending: true }),
      supabase.from('f24_righe').select('*'),
      supabase.from('f24_codici').select('*').order('sezione').order('codice'),
      supabase.from('v_f24_mensile').select('*').order('mese_competenza', { ascending: true }),
      supabase.from('v_f24_per_codice').select('*').order('mese_competenza', { ascending: true }),
      supabase.from('v_f24_avvisi_bonari').select('*').order('totale_versato', { ascending: false }),
      supabase.from('v_f24_riconciliazione_contributi').select('*').order('mese_competenza', { ascending: true }),
      supabase.from('v_f24_copertura').select('*').order('mese_competenza', { ascending: true }),
    ])
    // Una vista che fallisce non deve far sparire tutta la pagina: solo le
    // deleghe sono indispensabili, il resto degrada a sezione vuota.
    for (const r of [deleghe, righe, codici, mensile, perCodice, avvisi, riconc, copertura]) {
      if (r.error && r === deleghe) throw r.error
      if (r.error) console.error('f24Api:', r.error)
    }
    return {
      deleghe:    deleghe.data ?? [],
      righe:      righe.data ?? [],
      codici:     codici.data ?? [],
      mensile:    mensile.data ?? [],
      perCodice:  perCodice.data ?? [],
      avvisi:     avvisi.data ?? [],
      riconc:     riconc.data ?? [],
      copertura:  copertura.data ?? [],
    }
  },

  righeDelega: async (delega_id) => {
    const { data, error } = await supabase
      .from('f24_righe').select('*')
      .eq('delega_id', delega_id)
      .order('sezione', { ascending: true }).order('codice', { ascending: true })
    if (error) throw error
    return data ?? []
  },
}

// ── Scadenzario — tutto quello che resta da pagare ───────────────────────────
//
// Due sorgenti con affidabilita' diversa, e la pagina lo dice a chiare lettere:
// le fatture aperte NON hanno i termini di pagamento a sistema (ne' i fogli
// dell'amministrazione ne' il campo scadenza_pagamento, che sulle saldate
// contiene la data in cui si e' pagato), quindi l'anzianita' si conta dalla
// data fattura; i costi fissi hanno la data quando l'amministrazione l'ha
// messa, altrimenti si assume fine mese. Il flag scadenza_certa distingue.
export const scadenzarioApi = {
  elenco: async () => {
    const { data, error } = await supabase
      .from('v_scadenzario').select('*')
      .order('scadenza', { ascending: true })
    if (error) throw error
    return data ?? []
  },

  // Sintesi dei piani di rateizzazione della scheda RATEALI dei fogli.
  piani: async () => {
    const { data, error } = await supabase
      .from('v_rateali_piani').select('*')
      .order('chiuso', { ascending: true })
      .order('sede', { ascending: true }).order('piano_key', { ascending: true })
    if (error) throw error
    return data ?? []
  },

  // Tutte le rate, anche quelle senza data: servono per far vedere quanto manca ancora.
  rate: async () => {
    const { data, error } = await supabase
      .from('v_rateali_rate').select('*')
      .order('piano_key', { ascending: true }).order('n_rata', { ascending: true })
    if (error) throw error
    return data ?? []
  },

  // Esito del confronto riga-per-riga fra il foglio dell'amministrazione e le fatture elettroniche.
  riconciliazione: async () => {
    const { data, error } = await supabase
      .from('v_riconciliazione_excel')
      .select('id,sede,fornitore,documento,data_documento,importo,pagato,data_pagamento,metodo,categoria,crm_stato,crm_totale,crm_pagato,esito')
      .neq('esito', 'allineata')
      .order('importo', { ascending: false })
    if (error) throw error
    return data ?? []
  },

  // ---- Avvisi --------------------------------------------------------------
  // Le cose che meritano di essere dette prima che diventino un danno: una rata
  // saltata, una scadenza vicina, la rilettura dei fogli ferma. Il testo degli
  // avvisi lo scrive la vista v_avvisi, non il frontend: la stessa frase deve
  // arrivare identica alla fascia in cima alla pagina, al pallino nel menu e
  // alla notifica del mattino.
  // FIX 2026-09-01 (issue #192): la stessa vista veniva interrogata due volte a
  // ogni aggiornamento - una dal pallino nella barra laterale, una dalla fascia
  // in cima alla pagina - perche' i due componenti non si conoscono. Qui si
  // condivide la richiesta GIA' IN VOLO, non il risultato: due chiamate nello
  // stesso istante diventano una sola query, ma una chiamata successiva riparte
  // sempre da zero. Niente cache, quindi niente rischio di mostrare avvisi
  // vecchi dopo un "Aggiorna dati" - che su una rata non pagata sarebbe peggio
  // della query in piu'.
  _avvisiInVolo: null,
  avvisi: async () => {
    if (scadenzarioApi._avvisiInVolo) return scadenzarioApi._avvisiInVolo
    const p = (async () => {
      const { data, error } = await supabase
        .from('v_avvisi').select('*')
        .order('gravita', { ascending: true })
        .order('scadenza', { ascending: true, nullsFirst: true })
      if (error) throw error
      return data ?? []
    })()
    scadenzarioApi._avvisiInVolo = p
    try { return await p } finally { scadenzarioApi._avvisiInVolo = null }
  },

  // ---- Rilettura su richiesta ----------------------------------------------
  // Il browser non puo' aprire gli xlsx: stanno sul disco del PC. Quindi non
  // legge, CHIEDE. Lo script sul PC vede la richiesta al giro successivo (gira
  // ogni minuto), rilegge i fogli anche se non sono cambiati, e la chiude.
  chiediRilettura: async (autore = null) => {
    const { data, error } = await supabase.rpc('chiedi_rilettura', { p_autore: autore })
    if (error) throw error
    return data
  },

  // Com'e' messa la rilettura adesso: e' quello che si guarda mentre si aspetta.
  statoRilettura: async () => {
    const { data, error } = await supabase.from('v_stato_rilettura').select('*').single()
    if (error) throw error
    return data
  },

  // ---- Rilettura dei fogli ------------------------------------------------
  // Il registro dei pagamenti era stato caricato una volta sola, a mano: da li'
  // in poi l'amministrazione segnava un pagamento sull'xlsx e lo Scadenzario
  // continuava a mostrare quella fattura aperta. sincronizza_foglio rifa' lo
  // specchio del foglio, riabbina le righe alle fatture elettroniche e chiude
  // quelle che il foglio da' per pagate. La griglia si manda grezza: come si
  // legge lo decide Postgres, in un posto solo, condiviso con lo script del PC.
  sincronizzaFoglio: async ({ sede, fornitori = null, rateali = null,
                             giornaliera = null, origine = 'CRM' }) => {
    const { data, error } = await supabase.rpc('sincronizza_foglio', {
      p_sede: sede, p_fornitori: fornitori, p_rateali: rateali,
      p_giornaliera: giornaliera, p_origine: origine,
    })
    if (error) throw error
    return data
  },

  // Quando i fogli sono stati riletti l'ultima volta, per sede. Un dato che non
  // dichiara la propria eta' e' peggio di un dato assente.
  ultimeSincronie: async () => {
    const { data, error } = await supabase
      .from('sincronie_foglio')
      .select('id,quando,sede,origine,ok,esito,errore')
      .order('quando', { ascending: false })
      .limit(20)
    if (error) throw error
    return data ?? []
  },

  // ---- Modifiche ---------------------------------------------------------
  // Il sito non puo' scrivere sul disco di nessuno: la RPC aggiorna il CRM e
  // accoda la cella da riscrivere nel workbook. Poi APPLICA_AL_FOGLIO.bat sul
  // PC svuota la coda. Finche' la coda non e' vuota, foglio e CRM divergono.
  segnaFatturaPagata: async ({ fatturaId, pagato, data = null, metodo = null, autore = null }) => {
    const { data: out, error } = await supabase.rpc('segna_fattura_pagata', {
      p_fattura_id: fatturaId, p_pagato: pagato, p_data: data, p_metodo: metodo, p_autore: autore,
    })
    if (error) throw error
    return out
  },

  segnaRata: async ({ rataId, pagata = null, scadenza = null, importo = null, dataPagamento = null, autore = null }) => {
    const { data, error } = await supabase.rpc('segna_rata', {
      p_rata_id: rataId, p_pagata: pagata, p_scadenza: scadenza,
      p_importo: importo, p_data_pagamento: dataPagamento, p_autore: autore,
    })
    if (error) throw error
    return data
  },

  segnaPianoChiuso: async ({ pianoKey, chiuso, nota = null }) => {
    const { data, error } = await supabase.rpc('segna_piano_chiuso', {
      p_piano_key: pianoKey, p_chiuso: chiuso, p_nota: nota,
    })
    if (error) throw error
    return data
  },

  // Che cosa aspetta ancora di essere scritto nei file Excel.
  codaFoglio: async () => {
    const { data, error } = await supabase
      .from('modifiche_foglio')
      .select('id,creato_il,stato,tipo,sede,foglio,descrizione,campo,valore_vecchio,valore_nuovo,applicato_il,esito')
      .order('creato_il', { ascending: false })
      .limit(200)
    if (error) throw error
    return data ?? []
  },

  // Conteggi complessivi: li calcolo qui perche' la vista non ha una versione aggregata.
  riconciliazioneTotali: async () => {
    const { data, error } = await supabase
      .from('v_riconciliazione_excel').select('esito,importo')
    if (error) throw error
    const m = {}
    for (const r of data ?? []) {
      const a = (m[r.esito] ||= { esito: r.esito, n: 0, importo: 0 })
      a.n += 1
      a.importo += parseFloat(r.importo) || 0
    }
    return Object.values(m).sort((a, b) => b.n - a.n)
  },
}
