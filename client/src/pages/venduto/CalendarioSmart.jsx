/**
 * CalendarioSmart.jsx — Calendario & pianificazione personale automatica.
 *
 * Tutto automatico e self-improving: a ogni apertura ricalcola dal vivo le
 * previsioni di venduto/coperti (giornaliere e per turno) dallo storico che
 * cresce, suggerisce la squadra per turno con orari di ingresso/uscita e ne
 * stima il costo del lavoro (€ e % sull'incasso) usando i costi reali delle
 * buste paga. Misura da sola la propria accuratezza (backtest).
 *
 * Le stesse funzioni del motore (lib/forecast.js, lib/staffing.js) sono usate
 * dal job notturno che salva i forecast su forecast_giornaliero.
 */
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import supabase from '../../supabase'
import { fetchPaged } from '../../api/paged'
import { Users, Clock, TrendingUp, Target, RefreshCw, Settings2, Sparkles } from 'lucide-react'
import {
  computeDailyForecast, computeShiftForecast, backtestAccuracy,
  isoDate, addDays, dow, parseISO, GIORNI,
} from '../../lib/forecast'
import {
  computeHourlyCost, resolveConfig, suggestStaffing, DEFAULT_CONFIG,
} from '../../lib/staffing'

const MESI_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
const eur = n => n != null ? `€ ${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0 })}` : '—'
const eur2 = n => n != null ? `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
const fmt = n => n != null ? Number(n).toLocaleString('it-IT') : '—'
const LS_KEY = 'calendarioSmart.override.'

function confColor(c) {
  if (c >= 70) return 'bg-green-100 text-green-700'
  if (c >= 45) return 'bg-amber-100 text-amber-700'
  return 'bg-gray-100 text-gray-500'
}
function pctColor(p, target) {
  if (p == null) return 'text-gray-400'
  if (p > target + 6) return 'text-red-600'
  if (p > target) return 'text-amber-600'
  return 'text-green-600'
}
function statoBadge(stato) {
  const map = {
    ottimo: ['✅', 'Ottimale', 'text-green-600'],
    ok: ['🟢', 'Nella norma', 'text-gray-500'],
    alto: ['⚠️', 'Costo alto', 'text-red-600'],
    sottodimensionato: ['🔴', 'Sotto organico', 'text-red-600'],
    // costi orari non disponibili: nessuna valutazione possibile
    dati_mancanti: ['❔', 'Dati costo mancanti', 'text-amber-600'],
    // costo calcolato sui valori di default, non su buste paga reali
    stimato: ['≈', 'Costo stimato', 'text-amber-600'],
  }
  return map[stato] || map.ok
}

export default function CalendarioSmart({ sede: sedeProp }) {
  const [sede, setSede] = useState(sedeProp === 'PN' ? 'PN' : 'MA')
  const [loading, setLoading] = useState(true)
  const [daily, setDaily] = useState([])        // chiusure_giornaliere (storico)
  const [turni, setTurni] = useState([])        // chiusure_turni (storico)
  const [bustePaga, setBustePaga] = useState([])
  const [employees, setEmployees] = useState([])
  const [reparti, setReparti] = useState([])
  const [durataSede, setDurataSede] = useState({})  // { MA: minuti, PN: minuti }
  const [previsioni, setPrevisioni] = useState({})  // note manuali per data
  const [override, setOverride] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY + (sedeProp || 'MA')) || '{}') } catch { return {} }
  })
  const [showSettings, setShowSettings] = useState(false)
  const [savingDb, setSavingDb] = useState(false)
  const [msg, setMsg] = useState(null)
  const [expanded, setExpanded] = useState(null)

  const oggi = isoDate(new Date())
  const horizon = 14

  // Numero di caricamento: una `load()` vecchia non deve sovrascrivere la nuova
  // (il pulsante "Ricalcola" e il cambio sede possono sovrapporsi).
  const caricamentoRef = useRef(0)

  // ── Caricamento storico (12 mesi) indipendente dal filtro periodo pagina ──
  const load = useCallback(async (segnalaAnnullato) => {
    const mio = ++caricamentoRef.current
    const vivo = () => mio === caricamentoRef.current && !segnalaAnnullato?.()

    setLoading(true)
    const from12m = addDays(oggi, -380)
    try {
      // Paginazione VERA su tutto. Il `.range(0, 4999)` non alzava nulla (il
      // server tronca a 1000) e `buste_paga`, `employees`, `reparti`,
      // `staffing_config` e `previsioni_giornaliere` non avevano nemmeno
      // quello. È da buste_paga + employees che esce `computeHourlyCost`,
      // cioè il costo orario su cui poggia OGNI costo del lavoro mostrato in
      // pagina: leggerne un pezzo significa sbagliare tutti gli euro.
      const [d, t, bp, emp, rep, st, prev, cfgRow] = await Promise.all([
        fetchPaged(() => supabase.from('chiusure_giornaliere')
          .select('id, data, sede, totale_venduto_ipratico, coperti')
          .eq('sede', sede).gte('data', from12m), 'id'),
        fetchPaged(() => supabase.from('chiusure_turni')
          .select('id, data, sede, turno, incasso, quantita')
          .eq('sede', sede).gte('data', from12m), 'id'),
        fetchPaged(() => supabase.from('buste_paga')
          .select('id, employee_id, sede, anno, mese, costo_azienda, ore_settimanali')
          .gte('anno', new Date().getFullYear() - 1), 'id'),
        fetchPaged(() => supabase.from('employees').select('id, sede, ore_settimanali, reparto_id, active'), 'id'),
        fetchPaged(() => supabase.from('reparti').select('id, nome'), 'id'),
        fetchPaged(() => supabase.from('statistiche_tavoli')
          .select('id, sede, durata_media_min, data_inizio')
          .eq('sede', sede).gte('data_inizio', addDays(oggi, -120)), 'id'),
        fetchPaged(() => supabase.from('previsioni_giornaliere').select('*')
          .eq('sede', sede).gte('data', addDays(oggi, -30)).lte('data', addDays(oggi, horizon)), 'id'),
        // staffing_config ha `sede` come chiave: una riga per sede, nessun id.
        fetchPaged(() => supabase.from('staffing_config').select('*').eq('sede', sede), 'sede'),
      ])
      if (!vivo()) return
      // L'ordine cronologico si applica qui: `id` serve solo a paginare.
      d.sort((a, b) => a.data.localeCompare(b.data))
      setDaily(d); setTurni(t); setBustePaga(bp); setReparti(rep)
      // arricchisci employees col nome reparto
      const repById = Object.fromEntries(rep.map(r => [r.id, r.nome]))
      setEmployees(emp.map(e => ({ ...e, reparto_nome: repById[e.reparto_id] || null })))
      // durata media per sede
      const durVals = st.map(r => Number(r.durata_media_min)).filter(v => v > 0)
      setDurataSede(prev => ({ ...prev, [sede]: durVals.length ? Math.round(durVals.reduce((a, b) => a + b, 0) / durVals.length) : null }))
      const pm = {}
      for (const p of prev) pm[p.data] = p
      setPrevisioni(pm)
      // se esiste config su DB e non c'è override locale, usala come base
      if (cfgRow[0]) {
        setOverride(o => {
          const merged = { ...o }
          for (const k of ['target_cop_sala', 'target_cop_cucina', 'costo_orario_sala', 'costo_orario_cucina', 'target_costo_pct']) {
            if (o[k] == null && cfgRow[0][k] != null) merged[k] = Number(cfgRow[0][k])
          }
          return merged
        })
      }
    } catch (e) {
      if (vivo()) setMsg({ type: 'err', text: 'Errore caricamento: ' + e.message })
    } finally {
      if (vivo()) setLoading(false)
    }
  }, [sede, oggi])

  useEffect(() => {
    // Guardia di unmount: senza, cambiare tab durante il caricamento fa
    // setState su un componente già smontato.
    let annullato = false
    load(() => annullato)
    return () => { annullato = true }
  }, [load])
  // reset override quando cambia sede
  useEffect(() => {
    try { setOverride(JSON.parse(localStorage.getItem(LS_KEY + sede) || '{}')) } catch { setOverride({}) }
  }, [sede])

  // ── Calcoli (motore) ──
  const dailyFc = useMemo(() => computeDailyForecast(daily, { sede, asOf: oggi, horizonDays: horizon }), [daily, sede, oggi])
  const shiftFc = useMemo(() => computeShiftForecast(turni, { sede, asOf: oggi, horizonDays: horizon }), [turni, sede, oggi])
  const accuracy = useMemo(() => backtestAccuracy(daily, { sede }), [daily, sede])
  const costiReali = useMemo(() => computeHourlyCost(bustePaga, employees), [bustePaga, employees])
  const cfg = useMemo(() => resolveConfig(sede, costiReali, override), [sede, costiReali, override])
  const durata = durataSede[sede] || null

  // Media reale per dow/turno (ultime 8 settimane) → pannello orari + tipico
  const typicalByDow = useMemo(() => {
    const cutoff = addDays(oggi, -56)
    const acc = {}
    for (const r of turni) {
      if (r.data < cutoff || r.data > oggi) continue
      const tn = (r.turno || '').toLowerCase()
      if (tn !== 'pranzo' && tn !== 'cena') continue
      const d = dow(r.data)
      const k = `${d}|${tn}`
      if (!acc[k]) acc[k] = { cop: 0, inc: 0, n: 0 }
      acc[k].cop += Number(r.quantita) || 0
      acc[k].inc += Number(r.incasso) || 0
      acc[k].n += 1
    }
    const out = {}
    for (const [k, v] of Object.entries(acc)) {
      if (v.n === 0) continue
      out[k] = { cop: Math.round(v.cop / v.n), inc: Math.round(v.inc / v.n) }
    }
    return out
  }, [turni, oggi])

  // Righe pianificazione prossimi giorni
  const planRows = useMemo(() => {
    const rows = []
    for (let i = 0; i < horizon; i++) {
      const date = addDays(oggi, i)
      const d = dow(date)
      const isWk = d >= 5
      const fd = dailyFc[date]
      const sf = shiftFc[date] || {}
      const turniRow = ['pranzo', 'cena'].map(tn => {
        const f = sf[tn] || {}
        const st = suggestStaffing(f.coperti, f.venduto, tn, isWk ? 'weekend' : 'feriale', cfg, durata)
        return { turno: tn, fc: f, st }
      })
      rows.push({ date, d, isWk, fd, turni: turniRow })
    }
    return rows
  }, [dailyFc, shiftFc, cfg, durata, oggi])

  // ── Heatmap: reale (passato) + previsto (futuro) ──
  const heat = useMemo(() => {
    const m = {}
    for (const r of daily) {
      m[r.data] = { reale: Number(r.totale_venduto_ipratico) || 0, coperti: Number(r.coperti) || 0, tipo: 'reale' }
    }
    for (let i = 0; i < horizon; i++) {
      const date = addDays(oggi, i)
      if (!m[date] && dailyFc[date]?.venduto != null) {
        m[date] = { reale: null, prev: dailyFc[date].venduto, coperti: dailyFc[date].coperti, conf: dailyFc[date].confidence, tipo: 'previsto' }
      }
    }
    return m
  }, [daily, dailyFc, oggi])

  const maxV = useMemo(() => {
    const vals = Object.values(heat).map(x => x.reale ?? x.prev ?? 0).filter(v => v > 0)
    return Math.max(1, ...vals)
  }, [heat])

  function heatColor(v) {
    if (!v) return '#f3f4f6'
    const r = v / maxV
    if (r > 0.70) return '#ef4444'
    if (r > 0.40) return '#f97316'
    if (r > 0.15) return '#22c55e'
    return '#93c5fd'
  }

  const mesiDaMostrare = useMemo(() => {
    const now = parseISO(oggi)
    const list = []
    for (let off = 0; off <= 1; off++) {
      const dd = new Date(now.getFullYear(), now.getMonth() + off, 1)
      list.push({ year: dd.getFullYear(), month: dd.getMonth() + 1 })
    }
    return list
  }, [oggi])

  // ── Azioni ──
  function saveOverride(next) {
    setOverride(next)
    try { localStorage.setItem(LS_KEY + sede, JSON.stringify(next)) } catch { /* noop */ }
  }
  async function persistConfig() {
    setSavingDb(true); setMsg(null)
    try {
      // Il client Supabase NON rigetta: senza leggere `error` un upsert
      // bloccato da RLS finiva qui sotto con il messaggio "Config salvata su
      // DB." — un salvataggio fallito dichiarato riuscito.
      const { error } = await supabase.from('staffing_config').upsert({
        sede,
        target_cop_sala: cfg.target_cop_sala,
        target_cop_cucina: cfg.target_cop_cucina,
        costo_orario_sala: cfg.costo_orario_sala,
        costo_orario_cucina: cfg.costo_orario_cucina,
        target_costo_pct: cfg.target_costo_pct,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'sede' })
      if (error) throw error
      setMsg({ type: 'ok', text: 'Config salvata su DB.' })
    } catch (e) {
      setMsg({ type: 'err', text: 'Config NON salvata: ' + (e?.message || String(e)) })
    } finally { setSavingDb(false) }
  }

  // Salva i forecast calcolati su forecast_giornaliero (stessa logica del job notturno)
  async function salvaForecastDb() {
    setSavingDb(true); setMsg(null)
    try {
      const payload = []
      for (const row of planRows) {
        if (row.fd?.venduto != null) {
          payload.push({
            data: row.date, sede, turno: 'giorno',
            prev_venduto: row.fd.venduto, prev_coperti: row.fd.coperti,
            confidence: row.fd.confidence, metodo: row.fd.metodo,
            generato_il: new Date().toISOString(),
          })
        }
        for (const t of row.turni) {
          if (t.fc?.venduto == null) continue
          payload.push({
            data: row.date, sede, turno: t.turno,
            prev_venduto: t.fc.venduto, prev_coperti: t.fc.coperti,
            staff_sala: t.st.salaFissi + t.st.salaVar,
            staff_cucina: t.st.cuochi + t.st.lavapiatti,
            staff_tot: t.st.totStaff,
            costo_lavoro: t.st.costoLavoro, costo_lavoro_pct: t.st.costoPct,
            entrata_sala: t.st.entrata, uscita_sala: t.st.uscita,
            confidence: t.fc.confidence, metodo: 'live',
            generato_il: new Date().toISOString(),
          })
        }
      }
      if (payload.length === 0) { setMsg({ type: 'err', text: 'Niente da salvare.' }); return }
      const { error } = await supabase.from('forecast_giornaliero').upsert(payload, { onConflict: 'data,sede,turno' })
      if (error) throw error
      setMsg({ type: 'ok', text: `Salvati ${payload.length} forecast su DB.` })
    } catch (e) { setMsg({ type: 'err', text: e.message }) } finally { setSavingDb(false) }
  }

  async function salvaNota(date, nota) {
    try {
      // Stesso motivo di persistConfig: senza `error` la nota compariva
      // salvata nello stato locale anche quando il DB l'aveva rifiutata, e
      // spariva al primo ricaricamento senza spiegazioni.
      const { error } = await supabase.from('previsioni_giornaliere').upsert({
        data: date, sede, nota_consuntivo: nota || null, updated_at: new Date().toISOString(),
      }, { onConflict: 'data,sede' })
      if (error) throw error
      setPrevisioni(p => ({ ...p, [date]: { ...(p[date] || {}), nota_consuntivo: nota } }))
      setMsg({ type: 'ok', text: `Nota del ${date} salvata.` })
    } catch (e) {
      setMsg({ type: 'err', text: `Nota del ${date} NON salvata: ${e?.message || String(e)}` })
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="card p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-violet-500" />
          <div>
            <h2 className="font-semibold leading-tight">Calendario & Personale — automatico</h2>
            <p className="text-xs text-gray-400">Previsioni e staffing ricalcolati dal vivo dallo storico · migliorano ogni giorno</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {['MA', 'PN'].map(s => (
            <button key={s} onClick={() => setSede(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${sede === s ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-200'}`}>
              Sede {s}
            </button>
          ))}
          <button onClick={() => setShowSettings(v => !v)} title="Impostazioni costo/staffing"
            className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600"><Settings2 size={14} /></button>
          <button onClick={() => load()} title="Ricalcola ora" disabled={loading}
            className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<Users size={15} />} label="Costo orario Sala" value={eur2(cfg.costo_orario_sala) + '/h'}
          sub={costiReali[sede]?.sala ? 'da buste paga' : 'stima default'} color="blue" />
        <KpiCard icon={<Users size={15} />} label="Costo orario Cucina" value={eur2(cfg.costo_orario_cucina) + '/h'}
          sub={costiReali[sede]?.cucina ? 'da buste paga' : 'stima default'} color="orange" />
        <KpiCard icon={<Target size={15} />} label="Accuratezza motore"
          value={accuracy.overall != null ? `±${accuracy.overall.toFixed(0)}%` : '—'}
          sub={accuracy.n ? `backtest su ${accuracy.n} giorni` : 'dati insufficienti'} color="green" />
        <KpiCard icon={<TrendingUp size={15} />} label="Trend venduto"
          value={dailyFc[oggi]?.trend ? `${(dailyFc[oggi].trend * 100 - 100).toFixed(0)}%` : '—'}
          sub="ultime 4 vs 4 settimane" color="violet" />
      </div>

      {/* ── Pannello impostazioni ── */}
      {showSettings && (
        <div className="card p-4 bg-gray-50 border-gray-200">
          <p className="text-sm font-semibold mb-3">Impostazioni costo & staffing — Sede {sede}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <NumField label="Coperti max / cameriere" val={cfg.target_cop_sala} onChange={v => saveOverride({ ...override, target_cop_sala: v })} />
            <NumField label="Coperti max / cuoco" val={cfg.target_cop_cucina} onChange={v => saveOverride({ ...override, target_cop_cucina: v })} />
            <NumField label="% costo lavoro obiettivo" val={cfg.target_costo_pct} onChange={v => saveOverride({ ...override, target_costo_pct: v })} />
            <NumField label="Costo orario Sala €" step="0.5" val={cfg.costo_orario_sala} onChange={v => saveOverride({ ...override, costo_orario_sala: v })} />
            <NumField label="Costo orario Cucina €" step="0.5" val={cfg.costo_orario_cucina} onChange={v => saveOverride({ ...override, costo_orario_cucina: v })} />
            <div className="flex items-end">
              <button onClick={persistConfig} disabled={savingDb}
                className="px-3 py-2 bg-violet-600 text-white rounded-lg text-xs font-medium disabled:opacity-50">Salva su DB</button>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            I costi orari predefiniti sono ricavati dalle buste paga reali (costo azienda ÷ ore di contratto). Sovrascrivili qui se vuoi forzare un valore.
            Durata media tavolo: {durata ? `${durata} min` : 'n/d'} (affina l'orario di uscita a cena).
          </p>
        </div>
      )}

      {msg && <p className={`text-xs ${msg.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</p>}

      {/* ── Pianificazione prossimi 14 giorni ── */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <div>
            <h2 className="font-semibold flex items-center gap-2"><Clock size={16} className="text-violet-500" /> Pianificazione prossimi 14 giorni</h2>
            <p className="text-xs text-gray-400 mt-0.5">Per ogni giorno: previsione, squadra suggerita per turno, orari ingresso/uscita e costo del lavoro</p>
          </div>
          <button onClick={salvaForecastDb} disabled={savingDb || loading}
            className="px-3 py-1.5 bg-violet-50 text-violet-700 border border-violet-200 rounded-lg text-xs font-medium disabled:opacity-50">
            💾 Salva forecast su DB
          </button>
        </div>
        <div className="p-3 overflow-x-auto">
          {loading ? <p className="text-center text-gray-400 py-10 text-sm animate-pulse">Calcolo previsioni…</p> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-2 py-2 text-left">Giorno</th>
                  <th className="px-2 py-2 text-right">Prev. venduto</th>
                  <th className="px-2 py-2 text-center">Conf.</th>
                  <th className="px-2 py-2 text-left">🍝 Pranzo</th>
                  <th className="px-2 py-2 text-left">🌙 Cena</th>
                  <th className="px-2 py-2 text-right">Costo lavoro</th>
                  <th className="px-2 py-2 text-center"></th>
                </tr>
              </thead>
              <tbody>
                {planRows.map(row => {
                  const dd = parseISO(row.date)
                  const isToday = row.date === oggi
                  const costoTot = row.turni.reduce((s, t) => s + (t.st.costoLavoro || 0), 0)
                  const incTot = row.turni.reduce((s, t) => s + (t.st.incasso || 0), 0)
                  const pctTot = incTot > 0 ? Math.round(costoTot / incTot * 1000) / 10 : null
                  const isOpen = expanded === row.date
                  return (
                    <React.Fragment key={row.date}>
                      <tr className={`border-t border-gray-50 ${isToday ? 'bg-violet-50/50' : ''} ${row.isWk ? 'font-medium' : ''}`}>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <span className={row.isWk ? 'text-violet-700' : ''}>{GIORNI[row.d]} {dd.getDate()}/{dd.getMonth() + 1}</span>
                          {isToday && <span className="ml-1 text-[10px] text-violet-600 font-semibold">OGGI</span>}
                        </td>
                        <td className="px-2 py-2 text-right font-semibold">{row.fd?.venduto != null ? eur(row.fd.venduto) : '—'}
                          <span className="block text-[10px] text-gray-400 font-normal">{row.fd?.coperti != null ? `${row.fd.coperti} cop` : ''}</span>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${confColor(row.fd?.confidence || 0)}`}>{row.fd?.confidence || 0}%</span>
                        </td>
                        {row.turni.map(t => (
                          <td key={t.turno} className="px-2 py-2 text-xs">
                            {t.fc?.coperti != null ? (
                              <div>
                                <span className="font-medium">{t.fc.coperti} cop · {eur(t.fc.venduto)}</span>
                                <span className="block text-[11px] text-gray-500">
                                  👤 {t.st.salaFissi}{t.st.salaVar ? `+${t.st.salaVar}` : ''} sala · 👨‍🍳 {t.st.cuochi}{t.st.lavapiatti ? '+1 lav' : ''}
                                </span>
                                <span className="block text-[10px] text-gray-400">{t.st.entrata}–{t.st.uscita}</span>
                              </div>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                        ))}
                        <td className="px-2 py-2 text-right">
                          <span className="font-semibold">{eur(costoTot)}</span>
                          <span className={`block text-[10px] font-medium ${pctColor(pctTot, cfg.target_costo_pct)}`}>{pctTot != null ? `${pctTot}%` : ''}</span>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button onClick={() => setExpanded(isOpen ? null : row.date)} className="text-violet-500 text-xs">{isOpen ? '▲' : '▼'}</button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-gray-50/60">
                          <td colSpan={7} className="px-3 py-3">
                            <div className="grid md:grid-cols-2 gap-3">
                              {row.turni.map(t => <ShiftDetail key={t.turno} turno={t.turno} st={t.st} fc={t.fc} cfg={cfg} />)}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Orari migliori ingresso/uscita per giorno settimana ── */}
      <div className="card p-4">
        <h2 className="font-semibold flex items-center gap-2 mb-1"><Clock size={16} className="text-violet-500" /> Orari migliori ingresso / uscita</h2>
        <p className="text-xs text-gray-400 mb-3">Su base storica ultime 8 settimane ({sede}) · il cameriere variabile entra/esce solo quando l'affluenza lo richiede</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase">
              <tr>
                <th className="px-2 py-2 text-left">Giorno</th>
                <th className="px-2 py-2 text-left">🍝 Pranzo — coperti tipici / squadra / orario</th>
                <th className="px-2 py-2 text-left">🌙 Cena — coperti tipici / squadra / orario</th>
              </tr>
            </thead>
            <tbody>
              {GIORNI.map((g, d) => (
                <tr key={g} className="border-t border-gray-50">
                  <td className={`px-2 py-2 font-medium ${d >= 5 ? 'text-violet-700' : ''}`}>{g}</td>
                  {['pranzo', 'cena'].map(tn => {
                    const tp = typicalByDow[`${d}|${tn}`]
                    if (!tp) return <td key={tn} className="px-2 py-2 text-gray-300">chiuso / n/d</td>
                    const st = suggestStaffing(tp.cop, tp.inc, tn, d >= 5 ? 'weekend' : 'feriale', cfg, durata)
                    return (
                      <td key={tn} className="px-2 py-2">
                        <span className="font-medium">{tp.cop} cop</span> · {st.salaFissi}{st.salaVar ? `+${st.salaVar}` : ''} sala / {st.cuochi}{st.lavapiatti ? '+1' : ''} cuc
                        <span className="block text-[11px] text-gray-500">⏰ fissi {st.entrata}–{st.uscita}{st.salaVar ? ` · variabile ${st.entrataVar}–${st.uscitaVar}` : ''}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Heatmap reale + previsto ── */}
      <div className="card p-4">
        <h2 className="font-semibold mb-1">Calendario venduto — reale & previsto</h2>
        <p className="text-xs text-gray-400 mb-3">Giorni passati = reale (chiusure) · giorni futuri (bordo tratteggiato) = previsto dal motore</p>
        <div className="flex items-center gap-3 flex-wrap mb-3">
          {[['Chiuso', 0], ['Basso', 0.1], ['Medio', 0.3], ['Alto', 0.55], ['Top', 0.85]].map(([lbl, r]) => (
            <div key={lbl} className="flex items-center gap-1">
              <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: heatColor(r === 0 ? 0 : maxV * r) }} />
              <span className="text-xs text-gray-400">{lbl}</span>
            </div>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          {mesiDaMostrare.map(({ year, month }) => {
            const daysInMonth = new Date(year, month, 0).getDate()
            const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7
            const cells = Array.from({ length: firstDow }, () => null)
              .concat(Array.from({ length: daysInMonth }, (_, i) => i + 1))
            while (cells.length % 7 !== 0) cells.push(null)
            return (
              <div key={`${year}-${month}`}>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">{MESI_IT[month - 1]} {year}</h3>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {GIORNI.map(g => <div key={g} className="text-[10px] text-gray-400 pb-1">{g}</div>)}
                  {cells.map((dnum, idx) => {
                    // Chiave dai dati, non dall'indice: le celle vuote di
                    // riempimento hanno una chiave propria e le celle giorno
                    // sono identificate dalla data.
                    if (!dnum) return <div key={`vuota-${year}-${month}-${idx}`} />
                    const k = `${year}-${String(month).padStart(2, '0')}-${String(dnum).padStart(2, '0')}`
                    const info = heat[k]
                    const v = info ? (info.reale ?? info.prev) : null
                    const isFuture = info?.tipo === 'previsto'
                    return (
                      <div key={k}
                        className={`relative rounded-md aspect-square flex flex-col items-center justify-center border ${isFuture ? 'border-dashed border-violet-400' : 'border-transparent'}`}
                        style={{ backgroundColor: info ? heatColor(v) : '#f9fafb' }}
                        title={info
                          ? `${k}\n${isFuture ? 'PREVISTO' : 'Reale'}: ${eur(v)}\nCoperti: ${fmt(info.coperti)}${isFuture ? `\nConfidenza: ${info.conf}%` : ''}`
                          : `${k} — nessun dato`}>
                        <span className={`text-[11px] font-medium ${v > maxV * 0.4 ? 'text-white' : 'text-gray-700'}`}>{dnum}</span>
                        {isFuture && <span className="text-[8px] leading-none text-violet-700">prev</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Accuratezza per giorno (impara nel tempo) ── */}
      <div className="card p-4">
        <h2 className="font-semibold flex items-center gap-2 mb-1"><Target size={16} className="text-violet-500" /> Accuratezza del motore per giorno</h2>
        <p className="text-xs text-gray-400 mb-3">Errore medio assoluto (MAPE) misurato in backtest — più basso = previsioni più affidabili. Migliora man mano che lo storico cresce.</p>
        <div className="flex gap-2 flex-wrap">
          {GIORNI.map((g, d) => {
            const a = accuracy.byDow[d]
            const mape = a?.mape
            const col = mape == null ? 'text-gray-300' : mape <= 12 ? 'text-green-600' : mape <= 22 ? 'text-amber-600' : 'text-red-500'
            return (
              <div key={g} className="text-center px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 min-w-[56px]">
                <p className="text-[10px] text-gray-400">{g}</p>
                <p className={`text-sm font-semibold ${col}`}>{mape != null ? `±${mape.toFixed(0)}%` : '—'}</p>
                <p className="text-[9px] text-gray-300">{a?.n || 0} test</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Note consuntivo (apprendimento) ── */}
      <NotePanel oggi={oggi} sede={sede} previsioni={previsioni} onSave={salvaNota} />
    </div>
  )
}

// ── Sotto-componenti ──
function KpiCard({ icon, label, value, sub, color }) {
  const c = { blue: 'text-blue-600', orange: 'text-orange-600', green: 'text-green-600', violet: 'text-violet-600' }[color] || 'text-gray-600'
  return (
    <div className="card p-3">
      <div className={`flex items-center gap-1.5 text-xs ${c}`}>{icon}<span className="text-gray-500">{label}</span></div>
      <p className="text-lg font-bold mt-1">{value}</p>
      <p className="text-[10px] text-gray-400">{sub}</p>
    </div>
  )
}

function NumField({ label, val, onChange, step = '1' }) {
  return (
    <label className="block">
      <span className="block text-gray-500 mb-1">{label}</span>
      <input type="number" step={step} value={val ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
    </label>
  )
}

function ShiftDetail({ turno, st, fc, cfg }) {
  const [emoji, lbl, col] = statoBadge(st.stato)
  return (
    <div className="bg-white rounded-lg border border-gray-100 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold">{turno === 'pranzo' ? '🍝 Pranzo' : '🌙 Cena'}</p>
        <span className={`text-xs font-medium ${col}`}>{emoji} {lbl}</span>
      </div>
      {fc?.coperti == null ? <p className="text-xs text-gray-400">Dati insufficienti</p> : (
        <div className="space-y-1 text-xs text-gray-600">
          <div className="flex justify-between"><span>Previsione</span><span className="font-medium">{eur(fc.venduto)} · {fc.coperti} cop</span></div>
          <div className="flex justify-between"><span>Sala</span><span className="font-medium">{st.salaFissi} fissi{st.salaVar ? ` + ${st.salaVar} variabile` : ''}</span></div>
          <div className="flex justify-between"><span>Cucina</span><span className="font-medium">{st.cuochi} cuochi{st.lavapiatti ? ' + 1 lavapiatti' : ''}</span></div>
          <div className="flex justify-between"><span>Orario fissi</span><span className="font-medium">{st.entrata} – {st.uscita}</span></div>
          {st.salaVar > 0 && <div className="flex justify-between"><span>Orario variabile</span><span className="font-medium">{st.entrataVar} – {st.uscitaVar}</span></div>}
          <div className="flex justify-between"><span>Coperti / operatore</span><span className="font-medium">{st.copPerOp ?? '—'}</span></div>
          <div className="flex justify-between border-t border-gray-100 pt-1 mt-1">
            <span>Costo lavoro</span>
            <span className="font-semibold">{eur(st.costoLavoro)} <span className={pctColor(st.costoPct, cfg.target_costo_pct)}>({st.costoPct != null ? st.costoPct + '%' : '—'})</span></span>
          </div>
        </div>
      )}
    </div>
  )
}

function NotePanel({ oggi, sede, previsioni, onSave }) {
  // ultimi 7 giorni passati per registrare cosa è successo (meteo/eventi) → apprendimento
  const giorni = Array.from({ length: 7 }, (_, i) => addDays(oggi, -(i + 1)))
  return (
    <div className="card p-4">
      <h2 className="font-semibold mb-1">📒 Note consuntivo — cosa è successo</h2>
      <p className="text-xs text-gray-400 mb-3">Annota meteo, eventi, no-show degli ultimi giorni: aiutano a interpretare gli scostamenti (le previsioni restano automatiche)</p>
      <div className="space-y-2">
        {giorni.map(d => {
          const dd = parseISO(d)
          const p = previsioni[d] || {}
          return (
            <div key={d} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 shrink-0">{GIORNI[dow(d)]} {dd.getDate()}/{dd.getMonth() + 1}</span>
              <input type="text" defaultValue={p.nota_consuntivo || ''}
                onBlur={e => { if (e.target.value !== (p.nota_consuntivo || '')) onSave(d, e.target.value) }}
                placeholder="es. pioggia, evento in piazza, 2 no-show…"
                className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs" />
            </div>
          )
        })}
      </div>
    </div>
  )
}
