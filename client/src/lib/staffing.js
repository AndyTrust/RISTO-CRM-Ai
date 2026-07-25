/**
 * staffing.js — Costo personale e staffing suggerito (puro JS).
 *
 * 1) computeHourlyCost: ricava il costo orario AZIENDA medio per sede e reparto
 *    (Sala/Cucina) dalle buste paga reali (costo_azienda mensile) divise per le ore
 *    di contratto. Fallback su default configurabili dove mancano i dati.
 * 2) suggestStaffing: dato il numero di coperti e l'incasso previsti per un turno,
 *    propone la squadra (sala fissi/variabile, cucina, lavapiatti), gli orari di
 *    ingresso/uscita e il costo del lavoro in € e in % sull'incasso.
 */

// Default prudenti (usati se mancano buste paga / override)
export const DEFAULT_CONFIG = {
  target_cop_sala: 25,     // coperti max per cameriere
  target_cop_cucina: 30,   // coperti max per cuoco
  costo_orario_sala: 15.5, // €/h costo azienda
  costo_orario_cucina: 15, // €/h costo azienda
  ore_pranzo: 4.5,
  ore_cena: 5,
  ore_variabile: 2.5,      // ore del cameriere "variabile"
  target_costo_pct: 28,    // % incidenza lavoro/incasso obiettivo
}

const SETTIMANE_MESE = 4.33

/**
 * Costo orario reale per sede e reparto dalle buste paga.
 * @param bustePaga [{ employee_id, sede, anno, mese, costo_azienda, ore_settimanali }]
 * @param employees [{ id, sede, reparto_nome, ore_settimanali }]  (reparto_nome: 'Sala'|'Cucina'|...)
 * @param mesi numero di mesi recenti da considerare (default 3)
 * @returns { MA: { sala, cucina, generico }, PN: {...}, _meta }
 */
export function computeHourlyCost(bustePaga = [], employees = [], mesi = 3) {
  const empById = {}
  for (const e of employees) empById[e.id] = e

  // Tieni i mesi più recenti
  const periodi = [...new Set(bustePaga.map(b => `${b.anno}-${String(b.mese).padStart(2, '0')}`))]
    .sort().slice(-mesi)
  const recent = bustePaga.filter(b => periodi.includes(`${b.anno}-${String(b.mese).padStart(2, '0')}`))

  // accumula costo e ore per sede|reparto
  const acc = {}
  for (const b of recent) {
    const cost = Number(b.costo_azienda) || 0
    if (cost <= 0) continue
    const emp = empById[b.employee_id] || {}
    const sede = b.sede || emp.sede || '?'
    const reparto = normReparto(emp.reparto_nome)
    const oreSett = Number(emp.ore_settimanali) || Number(b.ore_settimanali) || 0
    const oreMese = oreSett * SETTIMANE_MESE
    if (oreMese <= 0) continue
    const key = `${sede}|${reparto}`
    if (!acc[key]) acc[key] = { cost: 0, ore: 0, n: 0 }
    acc[key].cost += cost
    acc[key].ore += oreMese
    acc[key].n += 1
  }

  const out = { _meta: { periodi, righe: recent.length } }
  for (const sede of ['MA', 'PN']) {
    const sala = acc[`${sede}|sala`]
    const cucina = acc[`${sede}|cucina`]
    const oper = ['sala', 'cucina', 'generico'].map(r => acc[`${sede}|${r}`]).filter(Boolean)
    const totCost = oper.reduce((s, a) => s + a.cost, 0)
    const totOre = oper.reduce((s, a) => s + a.ore, 0)
    out[sede] = {
      sala: sala && sala.ore > 0 ? round2(sala.cost / sala.ore) : null,
      cucina: cucina && cucina.ore > 0 ? round2(cucina.cost / cucina.ore) : null,
      generico: totOre > 0 ? round2(totCost / totOre) : null,
    }
  }
  return out
}

function normReparto(nome) {
  const n = (nome || '').toLowerCase()
  if (n.includes('sala')) return 'sala'
  if (n.includes('cucin')) return 'cucina'
  return 'generico'
}
function round2(n) { return Math.round(n * 100) / 100 }

/**
 * Unisce i costi orari reali con la config/override, garantendo sempre un valore.
 */
export function resolveConfig(sede, costiReali = {}, override = {}) {
  // FIX: le chiavi null/undefined dell'override non devono sovrascrivere i default
  // (altrimenti a valle costoSala/costoPct diventavano NaN silenziosamente)
  const ovr = {}
  for (const [k, v] of Object.entries(override || {})) if (v != null) ovr[k] = v
  const cfg = { ...DEFAULT_CONFIG, ...ovr }
  const reali = costiReali[sede] || {}
  if (ovr.costo_orario_sala == null && (reali.sala || reali.generico))
    cfg.costo_orario_sala = reali.sala || reali.generico
  if (ovr.costo_orario_cucina == null && (reali.cucina || reali.generico))
    cfg.costo_orario_cucina = reali.cucina || reali.generico
  // Fallback finale: garantisce sempre un numero valido sui costi orari
  // (meglio una stima che un NaN), ma segnala se il valore è un DEFAULT e non
  // un costo reale calcolato dalle buste paga: senza questo flag la UI
  // mostrerebbe un costo inventato etichettato come "ok".
  // Il flag va valutato PER REPARTO: se esiste il costo reale di sala ma non
  // quello di cucina, il secondo resta comunque una stima.
  cfg.costo_sala_stimato   = !Number.isFinite(Number(cfg.costo_orario_sala))
  cfg.costo_cucina_stimato = !Number.isFinite(Number(cfg.costo_orario_cucina))
  cfg.costo_orario_sala   = Number(cfg.costo_orario_sala)   || DEFAULT_CONFIG.costo_orario_sala
  cfg.costo_orario_cucina = Number(cfg.costo_orario_cucina) || DEFAULT_CONFIG.costo_orario_cucina
  cfg.costi_stimati = cfg.costo_sala_stimato || cfg.costo_cucina_stimato
  return cfg
}

/**
 * Staffing suggerito per un turno.
 * @param coperti coperti previsti del turno
 * @param incasso incasso previsto del turno (per % costo)
 * @param turno 'pranzo' | 'cena'
 * @param dayType 'feriale' | 'weekend'
 * @param cfg config risolta (vedi resolveConfig)
 * @param durataMediaMin durata media tavolo (min) per affinare l'orario di uscita
 */
export function suggestStaffing(coperti, incasso, turno, dayType, cfg = DEFAULT_CONFIG, durataMediaMin = null) {
  const cop = Math.max(0, Math.round(coperti || 0))
  const tc = cfg.target_cop_sala || 25
  const tcc = cfg.target_cop_cucina || 30

  // SALA — minimo 1 sotto i 12 coperti, altrimenti 2 fissi + variabili sul carico
  let salaTot
  if (cop <= 0) salaTot = 0
  else if (cop <= 12) salaTot = 1
  else salaTot = Math.max(2, Math.ceil(cop / tc))
  const salaFissi = salaTot === 0 ? 0 : Math.min(2, salaTot)
  const salaVar = Math.max(0, salaTot - salaFissi)

  // CUCINA — 2 cuochi base, +1 oltre il doppio del target, +1 ancora ai grandi numeri
  let cuochi = cop === 0 ? 0 : 2
  if (cop > tcc * 2) cuochi += 1
  if (cop > tcc * 3.6) cuochi += 1
  const lavapiatti = cop > 25 ? 1 : 0
  const cucinaTot = cuochi + lavapiatti

  const totStaff = salaFissi + salaVar + cucinaTot

  // ORARI ingresso/uscita
  const orari = shiftHours(turno, durataMediaMin)

  // COSTO LAVORO del turno (€): fissi+cucina ore piene, variabile ore ridotte
  // FIX: numeri sempre finiti — un cfg incompleto non deve produrre NaN silenziosi
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
  const oreTurno = turno === 'pranzo'
    ? num(cfg.ore_pranzo, DEFAULT_CONFIG.ore_pranzo)
    : num(cfg.ore_cena, DEFAULT_CONFIG.ore_cena)
  const oreVar = num(cfg.ore_variabile, DEFAULT_CONFIG.ore_variabile)
  const hcSala = num(cfg.costo_orario_sala, NaN)
  const hcCucina = num(cfg.costo_orario_cucina, NaN)
  const costiOk = Number.isFinite(hcSala) && Number.isFinite(hcCucina)
  const costoSala = salaFissi * oreTurno * hcSala + salaVar * oreVar * hcSala
  const costoCucina = cucinaTot * oreTurno * hcCucina
  const costoTot = costoSala + costoCucina
  const costoLavoro = costiOk && Number.isFinite(costoTot) ? Math.round(costoTot) : null
  const costoPct = costoLavoro != null && incasso > 0 ? Math.round(costoLavoro / incasso * 1000) / 10 : null

  // Valutazione efficienza
  const copPerOp = totStaff > 0 ? Math.round((cop / totStaff) * 10) / 10 : null
  let stato = 'ok'
  // Costi orari non disponibili → lo segnaliamo invece di mostrare NaN come "ok".
  // Raggiungibile quando suggestStaffing riceve un cfg NON prodotto da
  // resolveConfig (che invece garantisce sempre un default finito).
  if (!costiOk) stato = 'dati_mancanti'
  // Costo calcolato ma sui valori di default: è una stima, non un dato reale
  else if (cfg.costi_stimati) stato = 'stimato'
  else if (costoPct != null && costoPct > (cfg.target_costo_pct || 28) + 6) stato = 'alto'
  else if (copPerOp != null && copPerOp > tc) stato = 'sottodimensionato'
  else if (costoPct != null && costoPct < (cfg.target_costo_pct || 28) - 10 && cop > 0) stato = 'ottimo'

  return {
    coperti: cop, incasso: Math.round(incasso || 0),
    salaFissi, salaVar, cuochi, lavapiatti, totStaff,
    copPerOp, costoLavoro, costoPct, stato,
    // `costi_stimati` viene da resolveConfig: il costo è calcolato ma sui valori
    // di default, non su buste paga reali. Il numero è mostrabile, ma va detto.
    costiStimati: !!cfg.costi_stimati,
    warning: !costiOk
      ? 'Costo orario non disponibile (buste paga/config mancanti)'
      : (cfg.costi_stimati ? 'Costo orario stimato: nessuna busta paga per questa sede' : null),
    entrata: orari.entrata, uscita: orari.uscita,
    entrataVar: orari.entrataVar, uscitaVar: orari.uscitaVar,
  }
}

/**
 * Finestre orarie consigliate per turno. La cena si allunga se i tavoli girano lenti.
 */
export function shiftHours(turno, durataMediaMin = null) {
  if (turno === 'pranzo') {
    return { entrata: '11:00', uscita: '15:30', entrataVar: '12:00', uscitaVar: '14:30' }
  }
  // cena
  let uscita = '23:30'
  if (durataMediaMin && durataMediaMin > 95) uscita = '00:00'
  else if (durataMediaMin && durataMediaMin < 70) uscita = '23:00'
  return { entrata: '18:30', uscita, entrataVar: '19:30', uscitaVar: '22:30' }
}
