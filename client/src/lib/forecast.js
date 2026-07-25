/**
 * forecast.js — Motore previsioni 140 Grammi (puro JS, niente React/Supabase).
 *
 * Stessa logica usata sia dalla UI (ricalcolo live a ogni apertura pagina) sia
 * dal job notturno (scrittura su forecast_giornaliero). Riceve in input gli
 * storici già caricati e restituisce le previsioni: NON fa fetch né tocca il DOM.
 *
 * Idea chiave ("migliora ogni giorno"): per ogni giorno futuro la previsione è
 * una MEDIA MOBILE PESATA dello stesso giorno della settimana, con più peso alle
 * settimane recenti, corretta da un fattore di trend (crescita/calo) calcolato sui
 * dati più recenti. Man mano che lo storico cresce, le medie diventano più stabili
 * e l'accuratezza misurata sale.
 */

// ───────────────────────── Helpers data ─────────────────────────
export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function parseISO(s) { return new Date(s + 'T00:00:00') }
/** Lun=0 … Dom=6 */
export function dow(s) { return (parseISO(s).getDay() + 6) % 7 }
export function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return isoDate(d) }
export function weeksBetween(a, b) {
  // FIX: floor (= settimane COMPLETE trascorse) e non round, altrimenti i bucket
  // 0-4 / 4-8 settimane risultano asimmetrici e il decay pesa in modo diverso
  // giorni appartenenti alla stessa settimana.
  return Math.floor((parseISO(b) - parseISO(a)) / (7 * 86400000))
}
export const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
export function isWeekend(s) { const d = dow(s); return d >= 5 }

// ───────────────────────── Statistica base ─────────────────────────
function weightedMean(pairs) {
  // pairs: [{ v, w }]
  let sw = 0, swv = 0
  for (const { v, w } of pairs) { sw += w; swv += w * v }
  return sw > 0 ? swv / sw : 0
}
function cv(values) {
  if (values.length < 2) return 0.4
  const m = values.reduce((a, b) => a + b, 0) / values.length
  if (m === 0) return 0.4
  const va = values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length
  return Math.sqrt(va) / m
}

/**
 * Fattore di trend globale: confronta la media giornaliera delle ultime 4 settimane
 * con quella delle 4 precedenti. Ammorbidito con sqrt e limitato a ±15%.
 */
export function trendFactor(history, asOf, valueKey = 'venduto') {
  const recent = [], prev = []
  for (const r of history) {
    const v = Number(r[valueKey]) || 0
    if (v <= 0) continue
    const w = weeksBetween(r.data, asOf)
    if (w >= 0 && w < 4) recent.push(v)
    else if (w >= 4 && w < 8) prev.push(v)
  }
  if (recent.length < 4 || prev.length < 4) return 1
  const mr = recent.reduce((a, b) => a + b, 0) / recent.length
  const mp = prev.reduce((a, b) => a + b, 0) / prev.length
  if (mp <= 0) return 1
  const raw = mr / mp
  const soft = Math.sqrt(raw) // smorza variazioni estreme
  return Math.max(0.85, Math.min(1.15, soft))
}

/**
 * Previsione per un singolo giorno-della-settimana da un set di storici.
 * @returns { venduto, coperti, confidence, nCampioni }
 */
function forecastForDow(samples, asOf, tf, opts) {
  const { lookbackWeeks = 16, decay = 0.9 } = opts
  const pick = samples
    .filter(r => {
      const w = weeksBetween(r.data, asOf)
      return w >= 0 && w <= lookbackWeeks
    })
  if (pick.length === 0) return null

  const vPairs = [], cPairs = [], vVals = []
  for (const r of pick) {
    const w = weeksBetween(r.data, asOf)
    const wt = Math.pow(decay, w)
    const v = Number(r.venduto) || 0
    const c = Number(r.coperti) || 0
    if (v > 0) { vPairs.push({ v, w: wt }); vVals.push(v) }
    if (c > 0) cPairs.push({ v: c, w: wt })
  }
  if (vPairs.length === 0) return null

  const venduto = weightedMean(vPairs) * tf
  const coperti = Math.round(weightedMean(cPairs) * tf)

  // Confidence: bassa variabilità + molti campioni = alta fiducia
  const variability = cv(vVals)
  const sampleBoost = Math.min(1, vVals.length / 6)
  const confidence = Math.round(Math.max(20, Math.min(95, (1 - variability) * 100 * sampleBoost)))

  return { venduto: Math.round(venduto), coperti, confidence, nCampioni: vVals.length }
}

/**
 * Previsioni giornaliere per un orizzonte futuro.
 * @param history [{ data, sede, venduto, coperti }] storico reale (chiusure_giornaliere)
 * @param opts { sede, asOf, horizonDays, lookbackWeeks, decay }
 * @returns { 'YYYY-MM-DD': { data, dow, venduto, coperti, confidence, nCampioni, metodo } }
 */
export function computeDailyForecast(history, opts = {}) {
  const {
    sede = null,
    asOf = isoDate(new Date()),
    horizonDays = 14,
  } = opts
  const hist = (sede ? history.filter(r => r.sede === sede) : history)
    .map(r => ({ data: r.data, venduto: Number(r.totale_venduto_ipratico ?? r.venduto) || 0, coperti: Number(r.coperti) || 0 }))
    .filter(r => r.data <= asOf)

  const tf = trendFactor(hist, asOf, 'venduto')

  // Raggruppa storico per dow
  const byDow = {}
  for (const r of hist) {
    const d = dow(r.data)
    if (!byDow[d]) byDow[d] = []
    byDow[d].push(r)
  }

  const out = {}
  for (let i = 0; i < horizonDays; i++) {
    const date = addDays(asOf, i)
    const d = dow(date)
    const fc = forecastForDow(byDow[d] || [], asOf, tf, opts)
    out[date] = fc
      ? { data: date, dow: d, ...fc, trend: tf, metodo: `media pesata ${GIORNI[d]} · trend ${(tf * 100 - 100).toFixed(0)}%` }
      : { data: date, dow: d, venduto: null, coperti: null, confidence: 0, nCampioni: 0, metodo: 'dati insufficienti' }
  }
  return out
}

/**
 * Previsioni per turno (pranzo/cena) sull'orizzonte futuro.
 * @param historyTurni [{ data, sede, turno, incasso, quantita }] (chiusure_turni)
 * @returns { 'YYYY-MM-DD': { pranzo: {...}, cena: {...} } }
 */
export function computeShiftForecast(historyTurni, opts = {}) {
  const {
    sede = null,
    asOf = isoDate(new Date()),
    horizonDays = 14,
  } = opts
  const turni = ['pranzo', 'cena']
  const hist = (sede ? historyTurni.filter(r => r.sede === sede) : historyTurni)
    .map(r => ({ data: r.data, turno: (r.turno || '').toLowerCase(), venduto: Number(r.incasso) || 0, coperti: Number(r.quantita) || 0 }))
    .filter(r => r.data <= asOf && turni.includes(r.turno))

  const result = {}
  for (const turno of turni) {
    const ht = hist.filter(r => r.turno === turno)
    const tf = trendFactor(ht, asOf, 'venduto')
    const byDow = {}
    for (const r of ht) {
      const d = dow(r.data)
      if (!byDow[d]) byDow[d] = []
      byDow[d].push(r)
    }
    for (let i = 0; i < horizonDays; i++) {
      const date = addDays(asOf, i)
      const d = dow(date)
      const fc = forecastForDow(byDow[d] || [], asOf, tf, opts)
      if (!result[date]) result[date] = {}
      result[date][turno] = fc
        ? { ...fc, trend: tf }
        : { venduto: null, coperti: null, confidence: 0, nCampioni: 0 }
    }
  }
  return result
}

/**
 * Backtest: per ogni giorno reale recente ricalcola la previsione usando SOLO i
 * dati precedenti e confronta col reale. Misura quanto è affidabile il motore,
 * complessivamente e per giorno della settimana (MAPE = errore % medio assoluto).
 */
export function backtestAccuracy(history, opts = {}) {
  const { sede = null, testWeeks = 8, lookbackWeeks = 16, decay = 0.9 } = opts
  const hist = (sede ? history.filter(r => r.sede === sede) : history)
    .map(r => ({ data: r.data, venduto: Number(r.totale_venduto_ipratico ?? r.venduto) || 0, coperti: Number(r.coperti) || 0 }))
    .filter(r => r.venduto > 0)
    .sort((a, b) => a.data.localeCompare(b.data))

  if (hist.length === 0) return { overall: null, byDow: {}, n: 0 }
  const lastDate = hist[hist.length - 1].data
  const cutoff = addDays(lastDate, -testWeeks * 7)

  const errsByDow = {}
  const allErrs = []
  for (const r of hist) {
    if (r.data < cutoff) continue
    const before = hist.filter(h => h.data < r.data)
    if (before.length < 4) continue
    const d = dow(r.data)
    const byDow = before.filter(h => dow(h.data) === d)
    const tf = trendFactor(before, r.data, 'venduto')
    const fc = forecastForDow(byDow, r.data, tf, { lookbackWeeks, decay })
    if (!fc || !fc.venduto) continue
    const err = Math.abs(r.venduto - fc.venduto) / r.venduto * 100
    allErrs.push(err)
    if (!errsByDow[d]) errsByDow[d] = []
    errsByDow[d].push(err)
  }

  const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
  const byDow = {}
  for (const [d, arr] of Object.entries(errsByDow)) byDow[d] = { mape: mean(arr), n: arr.length }
  return { overall: mean(allErrs), byDow, n: allErrs.length }
}
