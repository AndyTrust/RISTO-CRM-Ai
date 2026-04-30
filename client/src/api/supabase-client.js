/**
 * supabase-client.js
 * Stessa interfaccia di client.js ma legge/scrive direttamente su Supabase.
 * Usato in produzione (Vercel) dove non c'è Express.
 */
import supabase from '../supabase'

// ─── Helpers ──────────────────────────────────────────────────────────────

function locationToSede(location) {
  if (!location || location === 'all') return null
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
  { id: 'ricette',      name: 'Ricette & Food Cost', description: 'Gestione ricette con food cost e AI', icon: '👨‍🍳', enabled: true },
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
  getAll: async (p = {}) => {
    let q = supabase.from('v_chiusure').select('*').order('data', { ascending: false }).limit(parseInt(p.limit) || 90)
    const sede = locationToSede(p.location)
    if (sede) q = q.eq('sede', sede)
    q = applyDateRange(q, p.from, p.to)
    return sbFetch(q)
  },

  mensile: async (p = {}) => {
    let q = supabase.from('v_chiusure_mensile').select('*').order('mese', { ascending: true })
    const sede = locationToSede(p.location)
    if (sede) q = q.eq('sede', sede)
    if (p.year) q = q.like('mese', `${p.year}-%`)
    if (p.from) q = q.gte('mese', p.from.substring(0, 7))
    if (p.to)   q = q.lte('mese', p.to.substring(0, 7))
    return sbFetch(q)
  },

  recenti: async (p = {}) => {
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const defaultFrom = thirtyDaysAgo.toISOString().split('T')[0]
    let q = supabase.from('v_chiusure').select('*').order('data', { ascending: true })
    const sede = locationToSede(p.location)
    if (sede) q = q.eq('sede', sede)
    q = applyDateRange(q, p.from || defaultFrom, p.to)
    return sbFetch(q)
  },

  stats: async (p = {}) => {
    // Aggregazione diretta da chiusure_giornaliere con supporto filtri data
    let q = supabase
      .from('chiusure_giornaliere')
      .select('sede, totale_venduto_ipratico, coperti, coperto_medio, scontrino_medio, data')
    const sede = locationToSede(p.location)
    if (sede) q = q.eq('sede', sede)
    q = applyDateRange(q, p.from, p.to)
    const rows = await sbFetch(q)

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
      avg_coperto_medio:  agg._count > 0 ? Math.round(agg._cm_sum / agg._count * 100) / 100 : 0,
      avg_scontrino_medio: agg._count > 0 ? Math.round(agg._sm_sum / agg._count * 100) / 100 : 0,
      n_giorni:           agg._count,
      prima_data:         agg.prima_data,
      ultima_data:        agg.ultima_data,
    }))
  },

  confrontoAnnuale: async (p = {}) => {
    let q = supabase.from('v_chiusure_confronto_annuale').select('*').order('anno').order('mese')
    const sede = locationToSede(p.location)
    if (sede) q = q.eq('sede', sede)
    return sbFetch(q)
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
    let q = supabase.from('kpi_revenues').select('*').ilike('op', `%${name}%`)
    if (sede) q = q.eq('sede', sede)
    q = applyPeriodFilter(q, p)
    return sbFetch(q)
  },

  // Quantum per operatore: usa v_fatturato_operatore_mensile (valorizzato da listino)
  quantum: async (p = {}) => {
    const sede = locationToSede(p.location)

    // Usa v_fatturato_operatore_mensile come fonte primaria (valorizzata da listino_prodotti)
    let qView = supabase.from('v_fatturato_operatore_mensile').select('*')
    if (sede) qView = qView.eq('sede', sede)
    // Filtro periodo: p.period / p.month = 'YYYY-MM', p.from/to, oppure ultimi 3 mesi di default
    const periodStr = p.period || p.month
    if (periodStr) {
      const [y, m] = periodStr.split('-')
      if (y && m) { qView = qView.eq('anno', parseInt(y)).eq('mese', parseInt(m)) }
    } else if (p.from || p.to) {
      const now2 = new Date()
      const fromD = p.from ? new Date(p.from) : new Date(now2.getFullYear(), now2.getMonth() - 2, 1)
      const toD   = p.to   ? new Date(p.to)   : now2
      qView = qView
        .gte('anno', fromD.getFullYear())
        .lte('anno', toD.getFullYear())
    }
    const viewRows = await sbFetch(qView)

    // ── Whitelist: solo dipendenti attivi con ruolo sala ─────────────────────
    // Esclude cucina, lavapiatti, amministrazione, ecc. da iPratico
    const SALA_ROLES = ['Cameriere', 'Commis', 'Responsabile']
    const { data: empRows } = await supabase
      .from('employees')
      .select('name, sede, role')
      .eq('active', true)
    const salaNameSet = new Set(
      (empRows || [])
        .filter(e => SALA_ROLES.includes(e.role))
        .map(e => (e.name || '').toLowerCase().trim())
    )

    // Aggrega per sede+operatore (somma su più mesi se nessun filtro periodo)
    const KPI_PSEUDO_OPS = ['pienissimo', 'extra', 'tecnico', 'antonio']
    const byOp = {}
    for (const r of viewRows) {
      if (!r.operator || KPI_PSEUDO_OPS.includes(r.operator.toLowerCase())) continue
      // Escludi operatori non registrati come sala dipendenti
      if (salaNameSet.size > 0 && !salaNameSet.has(r.operator.toLowerCase().trim())) continue
      const key = `${r.sede}|${r.operator}`
      if (!byOp[key]) byOp[key] = {
        operatore:   r.operator,
        op_code:     r.operator,
        sede:        r.sede,
        location:    r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA',
        tot_importo: 0,
        coperti:     0,
        fatturato_totale: 0,
        costo_totale: 0,
        margine_totale: 0,
        n_mesi: 0,
      }
      byOp[key].tot_importo     += parseFloat(r.fatturato_totale) || 0
      byOp[key].fatturato_totale+= parseFloat(r.fatturato_totale) || 0
      byOp[key].costo_totale    += parseFloat(r.costo_materia_totale) || 0
      byOp[key].margine_totale  += parseFloat(r.margine_totale) || 0
      byOp[key].coperti         += parseInt(r.pezzi_totali) || 0
      byOp[key].n_mesi++
    }

    // Carica target salvati
    let qTargets = supabase.from('kpi_targets').select('operator_code,sede,quantum_target,quorum,period')
    if (sede) qTargets = qTargets.eq('sede', sede)
    const periodForTargets = p.period || p.month
    if (periodForTargets) qTargets = qTargets.eq('period', periodForTargets)
    const targetsRows = await sbFetch(qTargets)
    const targetMap = {}
    for (const t of targetsRows) targetMap[`${t.sede}|${t.operator_code}`] = t

    return Object.values(byOp).map(op => {
      // Quantum = fatturato per pezzo venduto (proxy coperto medio)
      const quantum = op.coperti > 0
        ? Math.round(op.tot_importo / op.coperti * 100) / 100
        : 0
      const margine_pct = op.tot_importo > 0
        ? Math.round(op.margine_totale / op.tot_importo * 1000) / 10
        : 0
      const tgt = targetMap[`${op.sede}|${op.op_code}`] || null
      return {
        ...op,
        quantum,
        margine_pct,
        quantum_target: tgt?.quantum_target ?? null,
        quorum:         tgt?.quorum ?? null,
        coperti_gestiti: op.coperti,
      }
    }).sort((a, b) => b.tot_importo - a.tot_importo)
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
    const { data, error } = await supabase.from('fornitori_fatture').insert({
      p_iva:      (d.p_iva || d.partita_iva || '').replace(/^IT/, ''),
      nome:       d.nome || d.name || '',
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
    }).select().single()
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
    let q = supabase.from('fatture_righe').select(
      'codice_articolo, tipo_codice, descrizione, nome_normalizzato, quantita, unita_misura, prezzo_unitario, importo_riga, aliquota_iva, data_fattura, numero_fattura, sede, categoria, fornitore'
    )
    if (p.p_iva) q = q.eq('p_iva', p.p_iva.replace(/^IT/, ''))
    if (p.from)   q = q.gte('data_fattura', p.from)
    if (p.to)     q = q.lte('data_fattura', p.to)
    if (p.search) q = q.ilike('descrizione', `%${p.search}%`)
    q = q.order('data_fattura', { ascending: false }).limit(parseInt(p.limit) || 2000)
    const rows = await sbFetch(q)
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
      let qFat = supabase.from('fatture_importate')
        .select('data_fattura, totale, p_iva, fornitore, sede')
        .order('data_fattura').limit(10000)
      if (p.from) qFat = qFat.gte('data_fattura', p.from)
      if (p.to)   qFat = qFat.lte('data_fattura', p.to)
      if (p.sede) qFat = qFat.eq('sede', p.sede)
      const fattureRows = await sbFetch(qFat)

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
        const tot  = parseFloat(f.totale) || 0
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
    if (p.solo_pagate === true)  q = q.eq('stato_pagamento', 'pagata')
    if (p.solo_pagate === false) q = q.neq('stato_pagamento', 'pagata')
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
    let q = supabase.from('prodotti_catalogo').select('*').eq('attivo', true).order('nome')
    if (p.search) q = q.ilike('nome', `%${p.search}%`)
    if (p.categoria) q = q.eq('categoria', p.categoria)
    return sbFetch(q)
  },

  // Prodotti di un fornitore (via prodotti_fornitori_mapping)
  getByFornitore: async (p_iva) => {
    const piva = (p_iva || '').replace(/^IT/, '')
    return sbFetch(
      supabase.from('prodotti_fornitori_mapping')
        .select('*, prodotti_catalogo(*)')
        .eq('p_iva', piva)
        .order('ultimo_prezzo', { ascending: false })
    )
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

export const analytics = {
  // Ritorna { yoy: [...], kpiBox: { MAMELI: {...}, PREDDA_NIEDDA: {...} } }
  overview: async (p = {}) => {
    try {
      const { data: rows } = await supabase.from('chiusure_giornaliere')
        .select('sede, data, totale_venduto_ipratico, coperti, coperto_medio')
        .order('data')

      const allRows = rows ?? []

      // YoY: aggrega per anno+mese_num (tutte le sedi sommate)
      const byAnnoMese = {}
      for (const r of allRows) {
        if (!r.data) continue
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
        if (d.anno === 2025) { byMeseNum[mn].venduto_2025 = Math.round(d.venduto); byMeseNum[mn].coperti_2025 = d.coperti }
        else if (d.anno === 2026) { byMeseNum[mn].venduto_2026 = Math.round(d.venduto); byMeseNum[mn].coperti_2026 = d.coperti }
      }

      const yoy = Object.values(byMeseNum).sort((a,b) => a.mese_num - b.mese_num).map(m => ({
        ...m,
        delta_venduto_pct: m.venduto_2025 > 0 ? Math.round(((m.venduto_2026||0) - m.venduto_2025) / m.venduto_2025 * 1000) / 10 : null,
        delta_coperti_pct: m.coperti_2025 > 0 ? Math.round(((m.coperti_2026||0) - m.coperti_2025) / m.coperti_2025 * 1000) / 10 : null,
      }))

      // kpiBox: mesi completati dell'anno corrente vs stesso periodo anno precedente (dinamico)
      const nowD = new Date()
      const annoCorrente = nowD.getFullYear()
      const annoPrec = annoCorrente - 1
      // Mesi completati = da gennaio al mese scorso (mese corrente non ancora finito)
      const meseCorrente = nowD.getMonth() + 1 // 1-12
      const mesiCompletati = meseCorrente > 1 ? meseCorrente - 1 : 12
      const kpiBox = {}
      for (const r of allRows) {
        if (!r.data) continue
        const anno = parseInt(r.data.substring(0, 4))
        const mese_num = parseInt(r.data.substring(5, 7))
        if (mese_num > mesiCompletati) continue
        const loc = r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA'
        if (!kpiBox[loc]) kpiBox[loc] = { venduto_ytd: 0, venduto_ytd_prec: 0, cm_sum: 0, cm_sum_prec: 0, n: 0, n_prec: 0 }
        const v = parseFloat(r.totale_venduto_ipratico) || 0
        const cm = parseFloat(r.coperto_medio) || 0
        if (anno === annoCorrente) { kpiBox[loc].venduto_ytd += v; kpiBox[loc].cm_sum += cm; kpiBox[loc].n++ }
        else if (anno === annoPrec) { kpiBox[loc].venduto_ytd_prec += v; kpiBox[loc].cm_sum_prec += cm; kpiBox[loc].n_prec++ }
      }
      for (const [loc, d] of Object.entries(kpiBox)) {
        kpiBox[loc] = {
          venduto_ytd: Math.round(d.venduto_ytd),
          venduto_ytd_prec: Math.round(d.venduto_ytd_prec),
          cm_avg: d.n > 0 ? Math.round(d.cm_sum / d.n * 100) / 100 : 0,
          cm_avg_prec: d.n_prec > 0 ? Math.round(d.cm_sum_prec / d.n_prec * 100) / 100 : 0,
          // compat alias per vecchio codice
          venduto_2m_2026: Math.round(d.venduto_ytd),
          venduto_2m_2025: Math.round(d.venduto_ytd_prec),
          cm_avg_2026: d.n > 0 ? Math.round(d.cm_sum / d.n * 100) / 100 : 0,
          cm_avg_2025: d.n_prec > 0 ? Math.round(d.cm_sum_prec / d.n_prec * 100) / 100 : 0,
          periodo_label: mesiCompletati === 1 ? MESI_IT_SHORT[0] : `${MESI_IT_SHORT[0]}–${MESI_IT_SHORT[mesiCompletati-1]}`,
          anno_corrente: annoCorrente,
          anno_prec: annoPrec,
        }
      }

      return { yoy, kpiBox }
    } catch (e) {
      console.error('analytics.overview error:', e)
      return { yoy: [], kpiBox: {} }
    }
  },

  mensile: async (p = {}) => {
    try {
      let q = supabase.from('v_chiusure_mensile').select('*').order('mese', { ascending: true })
      const sede = locationToSede(p.location)
      if (sede) q = q.eq('sede', sede)
      if (p.year) q = q.like('mese', `${p.year}-%`)
      return sbFetch(q)
    } catch { return [] }
  },

  kpiSummary: async (p = {}) => {
    try {
      const sede = locationToSede(p.location)
      let q = supabase.from('kpi_revenues').select('sede,period,op,totale,coperti,coperto_medio')
        .order('period', { ascending: false }).limit(200)
      if (sede) q = q.eq('sede', sede)
      return sbFetch(q)
    } catch { return [] }
  },

  // Stagionalità: indici mensili 2025 + coperto medio per sede
  seasonality: async (p = {}) => {
    try {
      const { data: rows } = await supabase.from('chiusure_giornaliere')
        .select('sede, data, totale_venduto_ipratico, coperti, coperto_medio')
        .order('data')

      // Solo anno 2025 per indici stagionali
      const rows2025 = (rows ?? []).filter(r => r.data?.startsWith('2025'))

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

      const combined = []
      for (let mn = 1; mn <= 12; mn++) {
        const d = byMn[mn]
        combined.push({ mese_num: mn, indice_combined: d && avgMonthly > 0 ? Math.round(d.venduto / avgMonthly * 100) / 100 : null })
      }

      // byLocation: coperto medio per mese e sede
      const byLoc = {}
      for (const r of rows2025) {
        const loc = r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA'
        const mn = parseInt(r.data.substring(5, 7))
        if (!byLoc[loc]) byLoc[loc] = {}
        if (!byLoc[loc][mn]) byLoc[loc][mn] = { mese_num: mn, cm_sum: 0, coperti: 0, n: 0 }
        byLoc[loc][mn].cm_sum += parseFloat(r.coperto_medio)||0
        byLoc[loc][mn].coperti += parseInt(r.coperti)||0; byLoc[loc][mn].n++
      }
      const byLocation = {}
      for (const [loc, byMnL] of Object.entries(byLoc)) {
        byLocation[loc] = Object.values(byMnL).sort((a,b)=>a.mese_num-b.mese_num).map(d => ({
          mese_num: d.mese_num, avg_cm: d.n > 0 ? Math.round(d.cm_sum/d.n*100)/100 : 0, tot_coperti: d.coperti,
        }))
      }

      return { combined, byLocation }
    } catch { return null }
  },

  // Previsioni prossimi 3 mesi via regressione lineare
  forecast: async () => {
    try {
      const { data: rows } = await supabase.from('chiusure_giornaliere')
        .select('sede, data, totale_venduto_ipratico, coperti').order('data')

      const byLocMese = {}
      for (const r of rows ?? []) {
        const loc = r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA'
        const mese = r.data?.substring(0, 7); if (!mese) continue
        const k = `${loc}-${mese}`
        if (!byLocMese[k]) byLocMese[k] = { loc, mese, venduto: 0, coperti: 0 }
        byLocMese[k].venduto += parseFloat(r.totale_venduto_ipratico)||0
        byLocMese[k].coperti += parseInt(r.coperti)||0
      }

      const result = {}
      for (const loc of ['MAMELI','PREDDA_NIEDDA']) {
        const locRows = Object.values(byLocMese).filter(r=>r.loc===loc).sort((a,b)=>a.mese.localeCompare(b.mese))
        if (locRows.length < 3) { result[loc]={storico:[],forecasts:[],regressione:{r2:0}}; continue }

        const storico = locRows.map((r,i) => ({
          mese: r.mese, x: i,
          mese_label: MESI_IT_SHORT[parseInt(r.mese.substring(5,7))-1]+' '+r.mese.substring(2,4),
          tot_venduto: Math.round(r.venduto), tot_coperti: r.coperti,
        }))

        const n = storico.length
        const meanX = (n-1)/2, meanY = storico.reduce((s,d)=>s+d.tot_venduto,0)/n
        const meanC = storico.reduce((s,d)=>s+d.tot_coperti,0)/n
        let ssxy=0, ssxx=0, ssyy=0, ssxyC=0
        for (const d of storico) {
          ssxy += (d.x-meanX)*(d.tot_venduto-meanY); ssxx += (d.x-meanX)**2
          ssyy += (d.tot_venduto-meanY)**2; ssxyC += (d.x-meanX)*(d.tot_coperti-meanC)
        }
        const bV = ssxx>0?ssxy/ssxx:0, aV = meanY-bV*meanX
        const bC = ssxx>0?ssxyC/ssxx:0, aC = meanC-bC*meanX
        const r2 = ssxx>0&&ssyy>0 ? Math.round(ssxy**2/(ssxx*ssyy)*100)/100 : 0

        const lastMese = storico[storico.length-1].mese
        const forecasts = []
        for (let i=1;i<=3;i++) {
          const d = new Date(lastMese+'-15'); d.setMonth(d.getMonth()+i)
          const mese = d.toISOString().substring(0,7), mn = parseInt(mese.substring(5,7))
          const xF = n+i-1
          const fv = Math.round(Math.max(0,aV+bV*xF))
          const fc = Math.round(Math.max(0,aC+bC*xF))
          forecasts.push({ mese, mese_label: MESI_IT_SHORT[mn-1]+' '+mese.substring(2,4),
            forecast_venduto: fv, forecast_min: Math.round(fv*0.9), forecast_max: Math.round(fv*1.1),
            forecast_coperti: fc, tendenza: bV>0?'crescita':'calo', coeff_stagionale: '1.00' })
        }
        result[loc] = { storico, forecasts, regressione: { r2 } }
      }
      return result
    } catch { return null }
  },

  operatorTargets: async () => {
    try {
      // Calcola periodo: ultimi 3 mesi completi (per avere storico) + mese target (prossimo)
      const now = new Date()
      const targetMese = new Date(now.getFullYear(), now.getMonth() + 1, 1) // prossimo mese
      const targetAnno = targetMese.getFullYear()
      const targetMeseNum = targetMese.getMonth() + 1 // 1-12

      // Ultimi 3 mesi da oggi
      const mesiStorico = []
      for (let i = 3; i >= 1; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        mesiStorico.push({ anno: d.getFullYear(), mese: d.getMonth() + 1 })
      }

      // Query venduto_camerieri ultimi 3 mesi
      const earliest = `${mesiStorico[0].anno}-${String(mesiStorico[0].mese).padStart(2,'0')}-01`
      const latestM = new Date(now.getFullYear(), now.getMonth(), 1)
      const latestEnd = `${latestM.getFullYear()}-${String(latestM.getMonth() + 1).padStart(2,'0')}-01`

      const { data: vcRows } = await supabase.from('venduto_camerieri')
        .select('sede, operatore, data_inizio, data_fine, quantita')
        .gte('data_inizio', earliest)
        .lt('data_inizio', latestEnd)

      if (!vcRows?.length) return []

      // Aggregazione per sede + operatore + mese (usando data_inizio)
      const bySedeOpMese = {}
      for (const r of vcRows) {
        const mKey = r.data_inizio?.substring(0, 7); if (!mKey) continue
        const loc = r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA'
        const key = `${loc}|${r.operatore}`
        if (!bySedeOpMese[key]) bySedeOpMese[key] = { loc, operatore: r.operatore, mesi: {}, totale: 0, n: 0 }
        if (!bySedeOpMese[key].mesi[mKey]) bySedeOpMese[key].mesi[mKey] = { qty: 0 }
        bySedeOpMese[key].mesi[mKey].qty += parseFloat(r.quantita) || 0
        bySedeOpMese[key].totale += parseFloat(r.quantita) || 0
        bySedeOpMese[key].n++
      }

      // Totale per sede per calcolare quota di mercato
      const totPerSede = { MAMELI: 0, PREDDA_NIEDDA: 0 }
      for (const op of Object.values(bySedeOpMese)) {
        totPerSede[op.loc] = (totPerSede[op.loc] || 0) + op.totale
      }

      // Coperto medio sede da chiusure_giornaliere (mese corrente)
      const cmMeseKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}`
      const cmMeseNext = now.getMonth() === 11
        ? `${now.getFullYear() + 1}-01`
        : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2,'0')}`
      const { data: chiusureRows } = await supabase.from('chiusure_giornaliere')
        .select('sede, totale_venduto_ipratico, coperti')
        .gte('data', `${cmMeseKey}-01`)
        .lt('data', `${cmMeseNext}-01`)
        .eq('chiusura_anticipata', false)

      const cmPerSede = { MAMELI: 0, PREDDA_NIEDDA: 0 }
      const copertiPerSede = { MAMELI: 0, PREDDA_NIEDDA: 0 }
      for (const r of chiusureRows ?? []) {
        const loc = r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA'
        cmPerSede[loc] += parseFloat(r.totale_venduto_ipratico) || 0
        copertiPerSede[loc] += parseInt(r.coperti) || 0
      }
      for (const loc of ['MAMELI','PREDDA_NIEDDA']) {
        cmPerSede[loc] = copertiPerSede[loc] > 0
          ? Math.round(cmPerSede[loc] / copertiPerSede[loc] * 100) / 100
          : 22
      }

      // Coefficiente stagionale: confronto mese target 2025 vs media storica
      const targPrevAnno = targetAnno - 1
      const targPrevM = String(targetMeseNum).padStart(2,'0')
      const targPrevNext = targetMeseNum === 12
        ? `${targPrevAnno + 1}-01`
        : `${targPrevAnno}-${String(targetMeseNum + 1).padStart(2,'0')}`

      const { data: prevYearRows } = await supabase.from('chiusure_giornaliere')
        .select('sede, totale_venduto_ipratico')
        .gte('data', `${targPrevAnno}-${targPrevM}-01`)
        .lt('data', `${targPrevNext}-01`)
        .eq('chiusura_anticipata', false)

      const targMonthPrev = { MAMELI: 0, PREDDA_NIEDDA: 0 }
      for (const r of prevYearRows ?? []) {
        const loc = r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA'
        targMonthPrev[loc] += parseFloat(r.totale_venduto_ipratico) || 0
      }

      // Media mensile anno precedente per sede
      const { data: annoPrecRows } = await supabase.from('chiusure_giornaliere')
        .select('sede, data, totale_venduto_ipratico')
        .gte('data', `${targPrevAnno}-01-01`)
        .lte('data', `${targPrevAnno}-12-31`)
        .eq('chiusura_anticipata', false)

      const annoPrecMesi = { MAMELI: {}, PREDDA_NIEDDA: {} }
      for (const r of annoPrecRows ?? []) {
        const loc = r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA'
        const m = r.data?.substring(0, 7); if (!m) continue
        if (!annoPrecMesi[loc][m]) annoPrecMesi[loc][m] = 0
        annoPrecMesi[loc][m] += parseFloat(r.totale_venduto_ipratico) || 0
      }
      const coeffStagionale = { MAMELI: 1.0, PREDDA_NIEDDA: 1.0 }
      for (const loc of ['MAMELI','PREDDA_NIEDDA']) {
        const mensili = Object.values(annoPrecMesi[loc])
        const media = mensili.length > 0 ? mensili.reduce((a,b) => a+b, 0) / mensili.length : 0
        if (media > 0 && targMonthPrev[loc] > 0) {
          coeffStagionale[loc] = Math.round(targMonthPrev[loc] / media * 100) / 100
        }
      }

      const MESI_IT_LONG = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                            'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
      const FATTORE_TARGET = 1.10

      // Costruisci array risultati per operatore
      const results = []
      for (const [key, op] of Object.entries(bySedeOpMese)) {
        // Media ultimi 2 mesi (più recenti nello storico)
        const mesiKeys = Object.keys(op.mesi).sort()
        const last2 = mesiKeys.slice(-2)
        const media2m = last2.length > 0
          ? Math.round(last2.reduce((s, m) => s + (op.mesi[m]?.qty || 0), 0) / last2.length)
          : 0

        // Trend: confronto ultimo mese vs penultimo
        const trend = mesiKeys.length >= 2
          ? (op.mesi[mesiKeys[mesiKeys.length-1]]?.qty > op.mesi[mesiKeys[mesiKeys.length-2]]?.qty ? 'up' : 'down')
          : 'neutral'

        // Coperto medio proxy: usa CM sede
        const cm = cmPerSede[op.loc]

        // Target con coefficiente stagionale
        const coeff = coeffStagionale[op.loc]
        const copertiTarget = Math.round(media2m * coeff * FATTORE_TARGET)
        const vendutoTarget = Math.round(copertiTarget * cm)

        // Score 0-100: normalizzato su quota mercato + trend
        const quotaPct = totPerSede[op.loc] > 0
          ? Math.round(op.totale / totPerSede[op.loc] * 100)
          : 0
        const score = Math.min(100, Math.round(quotaPct * 3 + (trend === 'up' ? 10 : trend === 'down' ? -5 : 0)))

        // Upsell rate proxy: CM sede / CM medio sede (1.0 se uguali)
        const upsellRate = 1.0

        // Mesi per mini trend chart
        const mesiObj = {}
        for (const [m, d] of Object.entries(op.mesi)) {
          mesiObj[m] = { coperti: Math.round(d.qty) }
        }

        results.push({
          operatore: op.operatore,
          location: op.loc,
          storico: {
            media2m_coperti: media2m,
            media2m_cm: cm,
          },
          target: {
            coperti_target: copertiTarget,
            venduto_target: vendutoTarget,
            target_fattore_pct: Math.round((FATTORE_TARGET - 1) * 100),
            periodo: `${MESI_IT_LONG[targetMeseNum - 1]} ${targetAnno}`,
            coeff_stagionale: String(coeff),
          },
          performance: {
            score: Math.max(0, score),
            quota_mercato_pct: quotaPct,
            trend,
            upsell_rate: upsellRate,
          },
          mesi: mesiObj,
        })
      }

      return results
    } catch (e) {
      console.error('operatorTargets error:', e)
      return []
    }
  },

  // Heatmap per giorno della settimana + top 5 giorni storici
  heatmap: async () => {
    try {
      const { data: rows } = await supabase.from('chiusure_giornaliere')
        .select('sede, data, totale_venduto_ipratico, coperti, coperto_medio')

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
    } catch { return null }
  },
}

// ─── BUSTE PAGA ───────────────────────────────────────────────────────────
// Moltiplicatore RAL-based: paga_base × 1.33 (contributi INPS ~33% a carico azienda)
// Usato SOLO come fallback quando costo_azienda non è salvato nel DB
const COSTO_AZ_MULTIPLIER_FALLBACK = 1.33
const MESI_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                 'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']

export const bustePaga = {
  // Lista cedolini (filtro anno, mese, sede)
  // Regola PT: full time = 160h/mese 40h/sett | PT 62.5% = 100h/mese 25h/sett | PT 75% = 120h/mese 30h/sett | PT 50% = 80h/mese 20h/sett
  getAll: async (p = {}) => {
    let q = supabase.from('buste_paga').select('*').order('anno', { ascending: false }).order('mese', { ascending: false }).order('employee_name', { ascending: true })
    if (p.anno)  q = q.eq('anno', parseInt(p.anno))
    if (p.mese)  q = q.eq('mese', parseInt(p.mese))
    if (p.sede && p.sede !== 'Tutte') q = q.eq('sede', p.sede)
    const rows = await sbFetch(q)
    return rows.map(r => {
      // Usa costo_azienda salvato (= paga_base × 1.33 dal LUL PDF).
      // Fallback: paga_base × 1.33, poi netto × 1.33 (mai più × 1.9653)
      const pagoBase = r.paga_base ? parseFloat(r.paga_base) : 0
      const costoAz = r.costo_azienda
        ? parseFloat(r.costo_azienda)
        : pagoBase > 0
          ? +(pagoBase * COSTO_AZ_MULTIPLIER_FALLBACK).toFixed(2)
          : (r.netto ? +(parseFloat(r.netto) * COSTO_AZ_MULTIPLIER_FALLBACK).toFixed(2) : 0)
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
    let q = supabase.from('buste_paga').select('sede,anno,mese,netto,costo_azienda,paga_base,employee_code').order('anno').order('mese')
    if (p.anno) q = q.eq('anno', parseInt(p.anno))
    const rows = await sbFetch(q)
    // Aggrega per sede+anno+mese
    const map = {}
    for (const r of rows) {
      const key = `${r.sede}-${r.anno}-${r.mese}`
      if (!map[key]) map[key] = { sede: r.sede, location: r.sede === 'MA' ? 'MA' : 'PN', anno: r.anno, mese: r.mese, totale_netto: 0, totale_costo: 0, n_dipendenti: 0, emps: new Set() }
      map[key].totale_netto += parseFloat(r.netto) || 0
      // Usa costo_azienda salvato (RAL-based), fallback paga_base×1.33, mai netto×1.9653
      const pagoBase = r.paga_base ? parseFloat(r.paga_base) : 0
      const costoAz = r.costo_azienda
        ? parseFloat(r.costo_azienda)
        : pagoBase > 0
          ? +(pagoBase * COSTO_AZ_MULTIPLIER_FALLBACK).toFixed(2)
          : +(parseFloat(r.netto || 0) * COSTO_AZ_MULTIPLIER_FALLBACK).toFixed(2)
      map[key].totale_costo += costoAz
      if (r.employee_code) map[key].emps.add(r.employee_code)
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
    const busteRows = await sbFetch(
      supabase.from('buste_paga')
        .select('employee_id,employee_code,employee_name,sede,anno,mese,netto')
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
    let q = supabase.from('buste_paga').select('sede,anno,mese,netto,costo_azienda,paga_base').order('anno').order('mese')
    if (p.anno) q = q.eq('anno', parseInt(p.anno))
    const rows = await sbFetch(q)
    const map = {}
    for (const r of rows) {
      const key = `${r.sede}-${r.anno}-${r.mese}`
      if (!map[key]) map[key] = { sede: r.sede, location: r.sede, anno: r.anno, mese: r.mese, netto_totale: 0, costo_totale: 0 }
      map[key].netto_totale += parseFloat(r.netto) || 0
      // Usa costo_azienda dal DB se disponibile, altrimenti paga_base×1.33, altrimenti netto×1.33
      const pagoBase = parseFloat(r.paga_base) || 0
      const costoAz = parseFloat(r.costo_azienda) > 0
        ? parseFloat(r.costo_azienda)
        : pagoBase > 0
          ? +(pagoBase * COSTO_AZ_MULTIPLIER_FALLBACK)
          : +((parseFloat(r.netto) || 0) * COSTO_AZ_MULTIPLIER_FALLBACK)
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
      else                  q = q.ilike('name', d.employee_name)
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

    const { data, error } = await supabase.from('buste_paga').insert(row).select().single()
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
      let q = supabase.from('chiusure_giornaliere')
        .select('sede,data,totale_venduto_ipratico,coperti,coperto_medio,scontrino_medio')
      if (sede) q = q.eq('sede', sede)
      if (p.from) q = q.gte('data', p.from)
      if (p.to)   q = q.lte('data', p.to)
      const rows = await sbFetch(q)
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
        avg_coperto_medio:   s.n_giorni > 0 ? +(s._cm / s.n_giorni).toFixed(2) : 0,
        avg_scontrino_medio: s.n_giorni > 0 ? +(s._sm / s.n_giorni).toFixed(2) : 0,
      }))
    } catch { return [] }
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
    } catch { return [] }
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
          coperto_medio: o.tot_coperti > 0 && o.tot_importo > 0 ? +(o.tot_importo / o.tot_coperti).toFixed(2) : 0,
        }))
        .sort((a, b) => b.totale_incasso - a.totale_incasso)
    } catch { return [] }
  },

  // Tavoli da statistiche_tavoli
  tavoli: async (p = {}) => {
    try {
      const sede = locationToSede(p.location)
      let q = supabase.from('statistiche_tavoli')
        .select('sede,tavolo,n_coperti,n_ordini,incasso,durata_media_min,scontrino_medio')
      if (sede) q = q.eq('sede', sede)
      // Overlap interval filter
      if (p.to)   q = q.lte('data_inizio', p.to)
      if (p.from) q = q.gte('data_fine', p.from)
      const rows = await sbFetch(q)
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
    } catch { return [] }
  },

  // Trend giornaliero
  giornaliero: async (p = {}) => {
    try {
      const sede = locationToSede(p.location)
      let q = supabase.from('chiusure_giornaliere')
        .select('sede,data,totale_venduto_ipratico,coperti,coperto_medio,scontrino_medio')
        .order('data', { ascending: true })
      if (sede) q = q.eq('sede', sede)
      if (p.from) q = q.gte('data', p.from)
      if (p.to)   q = q.lte('data', p.to)
      if (!p.from && !p.to) q = q.limit(60)
      return sbFetch(q)
    } catch { return [] }
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
    if (mese) q = q.gte('date', `${mese}-01`).lte('date', `${mese}-31`)
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
    const { data: row, error } = await supabase.from('shifts').insert(payload).select().single()
    if (error) throw error
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
    const { data, error } = await supabase.from('shifts').insert(payload).select().single()
    if (error) throw error
    return data
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
    const { data, error } = await supabase.from('shifts').insert(rows).select()
    if (error) throw error
    return data
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

    // Scarica tutte le tabelle in parallelo
    const [employees, chiusure, fornitori, fatture, buste, shifts, modules, kpiRev, settings] = await Promise.all([
      supabase.from('employees').select('*').then(r => r.data ?? []),
      supabase.from('chiusure_giornaliere').select('*').then(r => r.data ?? []),
      supabase.from('fornitori_fatture').select('*').then(r => r.data ?? []),
      supabase.from('fatture_importate').select('*').then(r => r.data ?? []),
      supabase.from('buste_paga').select('*').then(r => r.data ?? []),
      supabase.from('shifts').select('*').then(r => r.data ?? []),
      supabase.from('modules').select('*').then(r => r.data ?? []),
      supabase.from('kpi_revenues').select('*').then(r => r.data ?? []),
      supabase.from('app_settings').select('*').then(r => r.data ?? []),
    ])

    const backupData = {
      created_at: ts,
      version:    '1.0',
      tables: { employees, chiusure_giornaliere: chiusure, fornitori_fatture: fornitori,
                fatture_importate: fatture, buste_paga: buste, shifts, modules, kpi_revenues: kpiRev, app_settings: settings },
    }

    const jsonStr   = JSON.stringify(backupData)
    const sizeKb    = Math.round(jsonStr.length / 1024)

    const { data: row, error } = await supabase.from('crm_backups').insert({
      label,  description: description || '',
      data:   backupData,
      size_kb: sizeKb,
    }).select().single()
    if (error) throw error
    return { id: row.id, label: lbl, size_kb: sizeKb, created_at: ts }
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
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })) } catch (_) {}
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
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })) } catch (_) {}
    return data
  },
  update: async (id, d) => {
    const payload = { ...d, updated_at: new Date().toISOString() }
    if (d.importo !== undefined) payload.importo = parseFloat(d.importo)
    const { error } = await supabase.from('costi_fissi').update(payload).eq('id', id)
    if (error) throw error
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })) } catch (_) {}
    return { success: true }
  },
  delete: async (id) => {
    const { error } = await supabase.from('costi_fissi').delete().eq('id', id)
    if (error) throw error
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })) } catch (_) {}
    return { success: true }
  },
  // Lista arricchita con categoria e mese_str (da v_costi_fissi_arricchiti)
  listArricchita: async ({ sede, anno, mese, categoria_tipo, ricorrente } = {}) => {
    let q = supabase.from('v_costi_fissi_arricchiti').select('*')
    if (sede) q = q.eq('sede', locationToSede(sede) || sede)
    if (anno) q = q.eq('anno', parseInt(anno))
    if (mese) q = q.eq('mese', parseInt(mese))
    if (categoria_tipo) q = q.eq('categoria_tipo', categoria_tipo)
    if (ricorrente !== undefined) q = q.eq('ricorrente', ricorrente)
    return sbFetch(q.limit(2000))
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
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })) } catch (_) {}
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
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })) } catch (_) {}
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
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })) } catch (_) {}
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
      .upsert(payload, { onConflict: 'employee_id,anno,mese' }).select().single()
    if (error) throw error
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })) } catch (_) {}
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
  getCosti: async ({ sede, anno, mese }) => {
    const s = locationToSede(sede) || sede
    const { data } = await supabase.from('v_costi_mensili').select('*')
      .eq('sede', s).eq('anno', parseInt(anno)).eq('mese', parseInt(mese)).maybeSingle()
    return data || { sede: s, anno, mese, costo_personale: 0, costo_fatture: 0, costo_fissi: 0, be_totale: 0 }
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
      .eq('sede', s).ilike('operator', operatoreName).gte('anno', minAnno)
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
  // Regola: quantum = MAX(media3m, stesso_mese_anno_prec); target = quantum × 1.10
  // Una sola chiamata Supabase per tutta la sede (batch efficiente)
  autoTargetAllOperatori: async ({ sede, anno, mese, mesiLookback = 3 }) => {
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
    // Lookup: UPPER(operator) → { 'ANNO-MESE': row }
    const fatLookup = {}
    for (const r of fatRows || []) {
      const k = r.operator?.toUpperCase()
      if (!fatLookup[k]) fatLookup[k] = {}
      fatLookup[k][`${r.anno}-${r.mese}`] = r
    }
    return mappings.map(m => {
      const opKey   = m.op_name_ipratico?.toUpperCase()
      const opData  = fatLookup[opKey] || {}
      const storicoMesi = mesiQuery.map(({ anno, mese }) => ({
        anno, mese, label: `${String(mese).padStart(2,'0')}/${anno}`,
        ...opData[`${anno}-${mese}`] || {},
        haDati: !!opData[`${anno}-${mese}`],
      }))
      const prevYearRow   = opData[`${anno - 1}-${mese}`] || null
      const mesiConDati   = storicoMesi.filter(x => x.haDati)
      const media3m_pezzi = mesiConDati.length > 0
        ? mesiConDati.reduce((s, r) => s + parseFloat(r.pezzi_totali || 0), 0) / mesiConDati.length : 0
      const media3m_fat   = mesiConDati.length > 0
        ? mesiConDati.reduce((s, r) => s + parseFloat(r.fatturato_totale || 0), 0) / mesiConDati.length : 0
      const prevYearPezzi = parseFloat(prevYearRow?.pezzi_totali || 0)
      const prevYearFat   = parseFloat(prevYearRow?.fatturato_totale || 0)
      const basePezzi = Math.max(media3m_pezzi, prevYearPezzi)
      const baseFat   = Math.max(media3m_fat, prevYearFat)
      return {
        employee_id:   m.employee_id,
        operatore:     m.op_name_ipratico,
        storico:       storicoMesi,
        datiAnnoPrec:  prevYearRow,
        media3m_pezzi: Math.round(media3m_pezzi),
        media3m_fat:   Math.round(media3m_fat),
        prevYearPezzi: Math.round(prevYearPezzi),
        prevYearFat:   Math.round(prevYearFat),
        quantum_pezzi: Math.round(basePezzi),
        target_pezzi:  Math.round(basePezzi * 1.10),
        quantum_fat:   Math.round(baseFat),
        target_fat:    Math.round(baseFat * 1.10),
        baseFonte: media3m_pezzi >= prevYearPezzi
          ? `media ${mesiConDati.length}m` : `${anno - 1}/${String(mese).padStart(2,'0')}`,
        nMesiConDati: mesiConDati.length,
      }
    })
  },
}

// Calcolo bonus progressivo lato client
// ── Team: 50% del monte bonus a BE raggiunto, 100% a target, 150% oltre ─
export function calcBonusTeam(fatturatoAttuale, beTotale, targetFatturato, premioTeamEuro) {
  if (!premioTeamEuro || !beTotale) return 0
  if (fatturatoAttuale < beTotale) return 0
  if (fatturatoAttuale >= beTotale && fatturatoAttuale < targetFatturato) {
    const ratio = (fatturatoAttuale - beTotale) / (targetFatturato - beTotale)
    return +(premioTeamEuro * (0.5 + 0.5 * ratio)).toFixed(2) // 50% → 100%
  }
  // fatturato >= target
  const over = Math.min((fatturatoAttuale - targetFatturato) / targetFatturato, 0.5) // cap 50% oltre
  return +(premioTeamEuro * (1 + over)).toFixed(2) // 100% → 150%
}

// ── Individuale: 0 sotto quantum, lineare quantum→target (0%→100% del premio_max) ─
export function calcBonusIndividuale(valoreAttuale, quantum, target, premioMax) {
  if (!premioMax || !quantum) return 0
  if (valoreAttuale < quantum) return 0
  if (valoreAttuale >= target) return +premioMax.toFixed?.(2) || premioMax
  const ratio = (valoreAttuale - quantum) / (target - quantum)
  return +(premioMax * ratio).toFixed(2)
}

// ═══════════════════════════════════════════════════════════════════
// LISTINO PRODOTTI — prezzi, costi, margini (importato da xlsx iPratico)
// ═══════════════════════════════════════════════════════════════════
export const listinoApi = {
  async getAll(filters = {}) {
    let q = supabase.from('listino_prodotti').select('*, fornitori_fatture(id, nome, p_iva)').order('categoria').order('nome_prodotto')
    if (filters.categoria) q = q.eq('categoria', filters.categoria)
    if (filters.listino)   q = q.eq('listino', filters.listino)
    if (filters.search)    q = q.ilike('nome_prodotto', `%${filters.search}%`)
    if (filters.attivo !== undefined) q = q.eq('attivo', filters.attivo)
    const { data, error } = await q
    if (error) throw error
    return data || []
  },
  async getCategorie() {
    const { data, error } = await supabase.from('listino_prodotti').select('categoria').order('categoria')
    if (error) throw error
    return [...new Set((data || []).map(r => r.categoria))].sort()
  },
  async create(p) {
    const { data, error } = await supabase.from('listino_prodotti').insert({
      categoria: p.categoria,
      listino: p.listino || 'LISTINO',
      nome_prodotto: p.nome_prodotto,
      prezzo_vendita: p.prezzo_vendita ?? null,
      costo_acquisto: p.costo_acquisto ?? null,
      margine_lordo_pct: p.margine_lordo_pct ?? null,
      fornitore_id: p.fornitore_id ?? null,
      note: p.note ?? null,
      attivo: p.attivo ?? true,
    }).select().single()
    if (error) throw error
    try { localStorage.setItem('crm_listino_updated', String(Date.now())) } catch {}
    return data
  },
  async update(id, p) {
    const payload = {}
    ;['categoria','listino','nome_prodotto','prezzo_vendita','costo_acquisto','margine_lordo_pct','fornitore_id','note','attivo'].forEach(k => {
      if (p[k] !== undefined) payload[k] = p[k]
    })
    payload.updated_at = new Date().toISOString()
    // Ricalcola margine se prezzi cambiati
    if (payload.prezzo_vendita != null && payload.costo_acquisto != null && payload.prezzo_vendita > 0) {
      payload.margine_lordo_pct = +((payload.prezzo_vendita - payload.costo_acquisto) / payload.prezzo_vendita * 100).toFixed(2)
    }
    const { data, error } = await supabase.from('listino_prodotti').update(payload).eq('id', id).select().single()
    if (error) throw error
    try { localStorage.setItem('crm_listino_updated', String(Date.now())) } catch {}
    return data
  },
  async remove(id) {
    const { error } = await supabase.from('listino_prodotti').delete().eq('id', id)
    if (error) throw error
    try { localStorage.setItem('crm_listino_updated', String(Date.now())) } catch {}
  },
  // Fatturato per cameriere (mensile, dai dati venduto valorizzati col listino)
  async fatturatoOperatore(sede, anno, mese) {
    let q = supabase.from('v_fatturato_operatore_mensile').select('*').order('fatturato_totale', { ascending: false })
    if (sede) q = q.eq('sede', sede)
    if (anno) q = q.eq('anno', anno)
    if (mese) q = q.eq('mese', mese)
    const { data, error } = await q
    if (error) throw error
    return data || []
  },
  // Prodotti del venduto che NON matchano col listino (da mappare manualmente)
  async prodottiSenzaMatch(sede, anno, mese) {
    const { data, error } = await supabase
      .from('v_venduto_valorizzato')
      .select('prodotto, sede, anno, mese, quantita')
      .is('prezzo_vendita', null)
      .eq('sede', sede || 'MA')
    if (error) throw error
    const map = new Map()
    for (const r of (data || [])) {
      if (anno && r.anno !== anno) continue
      if (mese && r.mese !== mese) continue
      const k = r.prodotto
      map.set(k, (map.get(k) || 0) + Number(r.quantita || 0))
    }
    return [...map.entries()].map(([prodotto, quantita]) => ({ prodotto, quantita })).sort((a,b) => b.quantita - a.quantita)
  },
}

// ═══════════════════════════════════════════════════════════════════
// BE MENSILE — break-even per sede × mese (personale + fatture + fissi)
// ═══════════════════════════════════════════════════════════════════
export const beMensileApi = {
  list: async ({ sede, anno } = {}) => {
    let q = supabase.from('v_be_mensile').select('*').order('anno').order('mese')
    if (sede) q = q.eq('sede', locationToSede(sede) || sede)
    if (anno) q = q.eq('anno', parseInt(anno))
    return sbFetch(q)
  },
  mese: async ({ sede, anno, mese }) => {
    const s = locationToSede(sede) || sede
    const { data } = await supabase.from('v_be_mensile').select('*')
      .eq('sede', s).eq('anno', parseInt(anno)).eq('mese', parseInt(mese)).maybeSingle()
    return data
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
    let q = supabase.from('v_bonus_operatore').select('*').order('payout_euro', { ascending: false })
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
    try { localStorage.setItem('crm_kpi_updated', JSON.stringify({ ts: Date.now() })) } catch (_) {}
    return data
  },
}

export default {
  modules, employees, chiusure, kpi, venduto,
  fornitori, pagamentiFatture, prodottiCatalogo, chat, data, analytics, bustePaga, statistiche, turni,
  roles, admin, crmConfig, sediApi, operatorMapping, repartiApi,
  fattureCategorieApi, costiFissiApi, standardNazionaliApi, kpiTargetsApi, kpiPerformanceApi,
  beMensileApi, operatoreMeseApi, obiettiviProdottoApi, bonusApi,
  listinoApi, fattureBi,
  calcBonusTeam, calcBonusIndividuale,
}
