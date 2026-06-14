import { useState, useEffect, useMemo } from 'react'
import supabase from '../supabase'
import PageAssistant from '../components/PageAssistant'
import PeriodFilter, { periodFilterToDates } from '../components/PeriodFilter'
import { periodToDates } from '../components/DateRangePicker'
import {
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
  ResponsiveContainer, LabelList
} from 'recharts'
import { Users, DollarSign, Clock, Star, Table, TrendingUp, ChevronUp, ChevronDown, Info, AlertTriangle, RotateCw, Building2 } from 'lucide-react'

// statistiche_tavoli copre SOLO da questa data in poi (verificato su Supabase).
const TAVOLI_COVERAGE_START = '2026-03-01'

const SEDE_OPTIONS = [
  { value: 'ALL', label: 'Tutte le sedi' },
  { value: 'MA', label: 'Mameli (CA)' },
  { value: 'PN', label: 'Predda Niedda (SS)' },
]
const SEDE_LABEL = { MA: 'Mameli (MA)', PN: 'Predda Niedda (PN)' }
const SEDE_COLOR = { MA: '#6366f1', PN: '#10b981' }

const GIORNI_SHORT = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab']

// ── Helpers ────────────────────────────────────────────────────────────────
async function sbq(q) {
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}
const eur = n => (n == null || isNaN(n)) ? '—'
  : Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const num = n => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('it-IT')
const pct = (a, b) => (!b ? 0 : (a / b) * 100)

function Info_({ text }) {
  return (
    <span className="group relative inline-flex items-center align-middle ml-1">
      <Info size={13} className="text-gray-400 cursor-help" />
      <span className="invisible group-hover:visible absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-20 w-64 bg-gray-900 text-white text-[11px] leading-snug rounded-lg px-3 py-2 shadow-xl">
        {text}
      </span>
    </span>
  )
}

function KpiCard({ icon: Icon, label, value, sub, color = 'indigo', info }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    green: 'bg-green-50 text-green-600 border-green-100',
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={18}/>
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        {info && <Info_ text={info} />}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs mt-1 opacity-70">{sub}</div>}
    </div>
  )
}

const ScatterTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <div className="font-semibold text-gray-800 mb-1">Tavolo: {d.tavolo} <span className="text-xs text-gray-400">({SEDE_LABEL[d.sede] || d.sede})</span></div>
      <div className="text-gray-600">Durata media: <span className="font-medium">{Math.round(d.durata_media_min)} min</span></div>
      <div className="text-gray-600">Incasso: <span className="font-medium">{eur(d.incasso)}</span></div>
      <div className="text-gray-600">Coperti tot.: <span className="font-medium">{d.n_coperti}</span></div>
      <div className="text-gray-600">€/min occupazione: <span className="font-medium">{eur(d.incasso_per_min)}</span></div>
    </div>
  )
}

const LineTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <div className="font-semibold text-gray-800 mb-1">{label?.slice(0,10).split('-').reverse().join('/')}</div>
      {payload.map((p,i)=>(
        <div key={i} className="text-gray-600">
          {p.name}: <span className="font-medium" style={{color:p.color}}>{num(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function CopertiBi() {
  const [sede, setSede] = useState('ALL')
  const [period, setPeriod] = useState('month')
  const [dates, setDates] = useState(periodToDates('month'))
  const dateFrom = dates?.from || ''
  const dateTo   = dates?.to   || ''
  const handlePeriodChange = (pid, d) => { setPeriod(pid); if (d) setDates(d) }

  const [chiusureData, setChiusureData] = useState([])
  const [tavoliData, setTavoliData] = useState([])
  const [turniData, setTurniData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [sortCol, setSortCol] = useState('incasso')
  const [sortDir, setSortDir] = useState('desc')

  // statistiche_tavoli copre il periodo selezionato?
  const tavoliCoverageWarning = dateFrom && dateFrom < TAVOLI_COVERAGE_START

  useEffect(() => { fetchData() }, [sede, dateFrom, dateTo])

  async function fetchData() {
    if (!dateFrom || !dateTo) return
    setLoading(true)
    setError(null)
    try {
      // 1) chiusure_giornaliere (fonte di verità coperti/venduto) — filtro data + sede
      let qc = supabase.from('chiusure_giornaliere')
        .select('sede, data, totale_venduto_ipratico, coperti, coperto_medio, scontrino_medio')
        .gte('data', dateFrom).lte('data', dateTo)
      if (sede !== 'ALL') qc = qc.eq('sede', sede)

      // 2) statistiche_tavoli (un record = un tavolo aperto/chiuso) — filtro su data_inizio + sede
      let qt = supabase.from('statistiche_tavoli')
        .select('sede, data_inizio, tavolo, nome_stanza, operatore, n_coperti, n_ordini, n_coperture, durata_media_min, incasso, scontrino_medio, fatturato_tavolo')
        .gte('data_inizio', dateFrom).lte('data_inizio', dateTo + 'T23:59:59')
      if (sede !== 'ALL') qt = qt.eq('sede', sede)

      // 3) chiusure_turni (split pranzo/cena reale) — filtro data + sede
      let qtu = supabase.from('chiusure_turni')
        .select('sede, data, turno, incasso, quantita')
        .gte('data', dateFrom).lte('data', dateTo)
        .in('turno', ['pranzo', 'cena'])
      if (sede !== 'ALL') qtu = qtu.eq('sede', sede)

      const [cRows, tRows, tuRows] = await Promise.all([
        sbq(qc.order('data').range(0, 9999)),
        sbq(qt.range(0, 9999)),
        sbq(qtu.range(0, 9999)),
      ])
      setChiusureData(cRows)
      setTavoliData(tRows)
      setTurniData(tuRows)
    } catch (e) {
      setError(e.message || String(e))
      setChiusureData([]); setTavoliData([]); setTurniData([])
    } finally {
      setLoading(false)
    }
  }

  // ── KPI globali (da chiusure_giornaliere + statistiche_tavoli) ─────────────
  const kpis = useMemo(() => {
    const totalCoperti = chiusureData.reduce((s,d)=>s+(d.coperti||0),0)
    const totalVenduto = chiusureData.reduce((s,d)=>s+(d.totale_venduto_ipratico||0),0)
    const giorni = chiusureData.length || 0
    // scontrino reale = venduto / coperti del periodo (no media di medie)
    const avgScontrino = totalCoperti > 0 ? totalVenduto / totalCoperti : 0
    const mediaCopertiGiorno = giorni > 0 ? totalCoperti / giorni : 0

    // tavolo top per incasso — chiave sede+tavolo (i numeri tavolo si ripetono tra sedi)
    const grp = {}
    tavoliData.forEach(d => {
      const k = `${d.sede}·${d.tavolo}`
      grp[k] = (grp[k] || 0) + (d.incasso || 0)
    })
    const topTavolo = Object.entries(grp).sort((a,b)=>b[1]-a[1])[0]

    // coerenza incrociata: somma incassi tavoli vs venduto chiusure
    const incassoTavoli = tavoliData.reduce((s,d)=>s+(d.incasso||0),0)
    return { totalCoperti, totalVenduto, giorni, avgScontrino, mediaCopertiGiorno, topTavolo, incassoTavoli }
  }, [chiusureData, tavoliData])

  // ── Confronto MA vs PN (solo quando sede = ALL) ────────────────────────────
  const perSede = useMemo(() => {
    if (sede !== 'ALL') return null
    const out = {}
    for (const code of ['MA','PN']) {
      const cr = chiusureData.filter(d => d.sede === code)
      const coperti = cr.reduce((s,d)=>s+(d.coperti||0),0)
      const venduto = cr.reduce((s,d)=>s+(d.totale_venduto_ipratico||0),0)
      out[code] = {
        coperti, venduto,
        giorni: cr.length,
        scontrino: coperti > 0 ? venduto / coperti : 0,
        copertiGiorno: cr.length > 0 ? coperti / cr.length : 0,
      }
    }
    return out
  }, [chiusureData, sede])

  // ── Linea coperti giornalieri MA vs PN ─────────────────────────────────────
  const lineData = useMemo(() => {
    const grouped = {}
    chiusureData.forEach(d => {
      const k = d.data
      if (!grouped[k]) grouped[k] = { data: k }
      grouped[k][d.sede] = (grouped[k][d.sede]||0) + (d.coperti||0)
    })
    return Object.values(grouped).sort((a,b)=>a.data.localeCompare(b.data))
  }, [chiusureData])

  // ── Aggregazione tavoli (chiave sede+tavolo) ──────────────────────────────
  const tavoliAgg = useMemo(() => {
    const agg = {}
    tavoliData.forEach(d => {
      const k = `${d.sede}·${d.tavolo}`
      if (!agg[k]) agg[k] = {
        key: k, sede: d.sede, tavolo: d.tavolo,
        nome_stanza: d.nome_stanza || null,
        incasso: 0, n_coperti: 0, n_ordini: 0, n_coperture: 0,
        durataSum: 0, scontrinoSum: 0, count: 0,
      }
      const a = agg[k]
      a.incasso += (d.incasso||0)
      a.n_coperti += (d.n_coperti||0)
      a.n_ordini += (d.n_ordini||0)
      a.n_coperture += (d.n_coperture||0)
      a.durataSum += (d.durata_media_min||0)
      a.scontrinoSum += (d.scontrino_medio||0)
      a.count++
    })
    return Object.values(agg).map(a => {
      const durata_media_min = a.count > 0 ? a.durataSum / a.count : 0
      const occupazioneMin = a.durataSum // somma minuti occupazione su tutte le aperture
      return {
        ...a,
        durata_media_min,
        scontrino_medio: a.count > 0 ? a.scontrinoSum / a.count : 0,
        coperti_medi: a.count > 0 ? a.n_coperti / a.count : 0,
        incasso_per_min: occupazioneMin > 0 ? a.incasso / occupazioneMin : 0,
        z: Math.max(5, Math.min(30, (a.n_coperti / Math.max(a.count,1)) * 2)),
      }
    })
  }, [tavoliData])

  const topTavoli = useMemo(
    () => [...tavoliAgg].sort((a,b)=>b.incasso-a.incasso).slice(0,10)
      .map(t => ({ ...t, etich: `${t.tavolo}${sede==='ALL' ? ' ('+t.sede+')' : ''}` })),
    [tavoliAgg, sede]
  )

  const scatterByCode = useMemo(() => {
    const out = {}
    for (const code of ['MA','PN']) out[code] = tavoliAgg.filter(t => t.sede===code && t.durata_media_min>0)
    return out
  }, [tavoliAgg])

  // ── Distribuzione coperti per giorno settimana (da chiusure_giornaliere) ───
  const giorniDistrib = useMemo(() => {
    const agg = Array(7).fill(null).map((_,i)=>({ giorno:GIORNI_SHORT[i], coperti:0, venduto:0, count:0 }))
    chiusureData.forEach(d => {
      if (!d.data) return
      const dow = new Date(d.data+'T00:00:00').getDay()
      agg[dow].coperti += (d.coperti||0)
      agg[dow].venduto += (d.totale_venduto_ipratico||0)
      agg[dow].count++
    })
    return agg.map(g=>({
      ...g,
      mediaCoperti: g.count>0?Math.round(g.coperti/g.count):0,
      mediaVenduto: g.count>0?Math.round(g.venduto/g.count):0,
    }))
  }, [chiusureData])

  // ── Split pranzo/cena reale (da chiusure_turni) ────────────────────────────
  const splitTurni = useMemo(() => {
    if (!turniData.length) return null
    const acc = { pranzo: { inc:0, q:0, n:0 }, cena: { inc:0, q:0, n:0 } }
    turniData.forEach(r => {
      const t = r.turno === 'pranzo' ? 'pranzo' : r.turno === 'cena' ? 'cena' : null
      if (!t) return
      acc[t].inc += (r.incasso||0)
      acc[t].q   += (r.quantita||0)
      acc[t].n   += 1
    })
    const totInc = acc.pranzo.inc + acc.cena.inc
    return {
      pranzo: { ...acc.pranzo, incMedio: acc.pranzo.n>0?acc.pranzo.inc/acc.pranzo.n:0, share: pct(acc.pranzo.inc, totInc) },
      cena:   { ...acc.cena,   incMedio: acc.cena.n>0?acc.cena.inc/acc.cena.n:0,       share: pct(acc.cena.inc, totInc) },
      totInc,
    }
  }, [turniData])

  // ── Tabella tavoli ordinabile ──────────────────────────────────────────────
  const sortedTavoli = useMemo(() => {
    return [...tavoliAgg].sort((a,b)=>{
      const av = a[sortCol]??0, bv = b[sortCol]??0
      if (typeof av === 'string') return sortDir==='asc'?av.localeCompare(bv):bv.localeCompare(av)
      return sortDir==='asc'?av-bv:bv-av
    })
  }, [tavoliAgg, sortCol, sortDir])

  function handleSort(col) {
    if (sortCol===col) setSortDir(d=>d==='asc'?'desc':'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  // scostamento coerenza incrociata (solo se i tavoli coprono il periodo)
  const scostamento = useMemo(() => {
    if (tavoliCoverageWarning || !kpis.totalVenduto || !kpis.incassoTavoli) return null
    return ((kpis.incassoTavoli - kpis.totalVenduto) / kpis.totalVenduto) * 100
  }, [kpis, tavoliCoverageWarning])

  const systemContext = useMemo(() => ({
    sede, dateFrom, dateTo,
    totalCoperti: kpis.totalCoperti,
    mediaCopertiGiorno: kpis.mediaCopertiGiorno,
    avgScontrino: kpis.avgScontrino,
    topTavolo: kpis.topTavolo?.[0],
    topTavoloIncasso: kpis.topTavolo?.[1],
    numTavoli: tavoliAgg.length,
  }), [sede, dateFrom, dateTo, kpis, tavoliAgg])

  const TABLE_COLS = [
    {key:'tavolo',label:'Tavolo'},
    ...(sede==='ALL'?[{key:'sede',label:'Sede'}]:[]),
    {key:'count',label:'Aperture'},
    {key:'coperti_medi',label:'Coperti medi'},
    {key:'n_ordini',label:'Ordini'},
    {key:'durata_media_min',label:'Durata media'},
    {key:'incasso_per_min',label:'€/min'},
    {key:'incasso',label:'Incasso tot.'},
    {key:'scontrino_medio',label:'Scontrino medio'},
  ]

  const periodoLabel = `${dateFrom?.split('-').reverse().join('/')} → ${dateTo?.split('-').reverse().join('/')}`

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users className="text-blue-600" size={26}/>
          Coperti, Tavoli &amp; Sala
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Andamento coperti, performance tavoli e distribuzione settimanale — tutti i dati in tempo reale da Supabase, filtrati per periodo e sede.
        </p>
      </div>

      {/* FILTRI */}
      <div className="mb-6">
        <PeriodFilter period={period} dates={dates} onChange={handlePeriodChange}
          extra={
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Sede</label>
              <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={sede} onChange={e=>setSede(e.target.value)}>
                {SEDE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          } />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm flex items-start gap-2">
          <AlertTriangle size={18} className="flex-shrink-0 mt-0.5"/>
          <span>Errore nel caricamento dati da Supabase: <strong>{error}</strong></span>
        </div>
      )}

      {/* AVVISO COPERTURA TAVOLI */}
      {tavoliCoverageWarning && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 mb-6 text-xs flex items-start gap-2">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-amber-500"/>
          <span>
            Le statistiche per tavolo (durata, €/min, scatter, tabella) esistono <strong>solo dal {TAVOLI_COVERAGE_START.split('-').reverse().join('/')}</strong>.
            Il periodo selezionato parte prima: i blocchi basati su <code>statistiche_tavoli</code> mostrano solo la parte di periodo coperta.
            I coperti e il venduto (da <code>chiusure_giornaliere</code>) sono invece completi.
          </span>
        </div>
      )}

      {/* KPI CARDS — globale periodo/sede */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_,i)=><div key={i} className="bg-white rounded-xl border p-4 h-24 animate-pulse"/>)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard icon={Users} label="Coperti totali" color="blue"
            value={num(kpis.totalCoperti)} sub={`${kpis.giorni} giorni · ${periodoLabel}`}
            info="Somma coperti dalla tabella chiusure_giornaliere nel periodo e sede selezionati. Fonte di verità coperti."/>
          <KpiCard icon={TrendingUp} label="Media coperti/giorno" color="indigo"
            value={num(Math.round(kpis.mediaCopertiGiorno))} sub="coperti ÷ giorni con servizio"
            info="Coperti totali ÷ numero di giorni presenti in chiusure_giornaliere nel periodo/sede."/>
          <KpiCard icon={DollarSign} label="Scontrino medio" color="green"
            value={eur(kpis.avgScontrino)} sub="venduto ÷ coperti"
            info="Totale venduto iPratico ÷ coperti totali (chiusure_giornaliere). NON media delle medie giornaliere."/>
          <KpiCard icon={Star} label="Tavolo top" color="yellow"
            value={kpis.topTavolo ? kpis.topTavolo[0].split('·')[1] : '—'}
            sub={kpis.topTavolo ? `${eur(kpis.topTavolo[1])} · ${kpis.topTavolo[0].split('·')[0]}` : (tavoliCoverageWarning?'no dati tavoli nel periodo':'—')}
            info="Tavolo con incasso cumulato più alto (statistiche_tavoli, somma incasso per sede+tavolo)."/>
        </div>
      )}

      {/* COERENZA INCROCIATA */}
      {!loading && !tavoliCoverageWarning && kpis.incassoTavoli > 0 && (
        <div className={`rounded-lg p-3 mb-6 text-xs flex items-center gap-2 border ${
          scostamento != null && Math.abs(scostamento) <= 5
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          <RotateCw size={15} className="flex-shrink-0"/>
          <span>
            <strong>Check coerenza fonti:</strong> incasso sommato dai tavoli (statistiche_tavoli) = {eur(kpis.incassoTavoli)} ·
            venduto da chiusure_giornaliere = {eur(kpis.totalVenduto)} ·
            scostamento <strong>{scostamento != null ? `${scostamento>0?'+':''}${scostamento.toFixed(1)}%` : '—'}</strong>
            {scostamento != null && Math.abs(scostamento) <= 5
              ? ' — dati coerenti.'
              : ' — scostamento elevato: i tavoli potrebbero non coprire tutti i giorni del periodo.'}
          </span>
        </div>
      )}

      {/* CONFRONTO MA vs PN (solo sede = ALL) */}
      {!loading && sede === 'ALL' && perSede && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {['MA','PN'].map(code => {
            const s = perSede[code]
            return (
              <div key={code} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-3 h-3 rounded-full" style={{background:SEDE_COLOR[code]}}/>
                  <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-1">
                    <Building2 size={15} className="text-gray-400"/> {SEDE_LABEL[code]}
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><div className="text-gray-400 text-xs">Coperti</div><div className="font-bold text-gray-800">{num(s.coperti)}</div></div>
                  <div><div className="text-gray-400 text-xs">Venduto</div><div className="font-bold text-gray-800">{eur(s.venduto)}</div></div>
                  <div><div className="text-gray-400 text-xs">Coperti/giorno</div><div className="font-bold text-gray-800">{num(Math.round(s.copertiGiorno))}</div></div>
                  <div><div className="text-gray-400 text-xs">Scontrino medio</div><div className="font-bold text-gray-800">{eur(s.scontrino)}</div></div>
                </div>
                <div className="text-[11px] text-gray-400 mt-2">{s.giorni} giorni · fonte chiusure_giornaliere</div>
              </div>
            )
          })}
        </div>
      )}

      {/* LINE CHART COPERTI */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <Users size={16} className="text-blue-500"/> Coperti Giornalieri nel Periodo
          <Info_ text="Coperti per giorno da chiusure_giornaliere. Due serie MA e PN quando 'Tutte le sedi'; quando filtri una sede vedi solo quella."/>
        </h2>
        <p className="text-xs text-gray-500 mb-4">Fonte: chiusure_giornaliere · {periodoLabel}</p>
        {lineData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Users size={36} className="mb-2 opacity-40"/><p className="text-sm">Dati non disponibili per il periodo</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={lineData} margin={{top:10,right:30,left:0,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="data" fontSize={10}
                tickFormatter={v=>new Date(v+'T00:00:00').toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'})}/>
              <YAxis fontSize={11}/>
              <Tooltip content={<LineTooltip/>}/>
              <Legend/>
              {(sede==='ALL'||sede==='MA') && <Line type="monotone" dataKey="MA" name="Mameli" stroke={SEDE_COLOR.MA} strokeWidth={2} dot={false} activeDot={{r:4}}/>}
              {(sede==='ALL'||sede==='PN') && <Line type="monotone" dataKey="PN" name="Predda Niedda" stroke={SEDE_COLOR.PN} strokeWidth={2} dot={false} activeDot={{r:4}}/>}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* SPLIT PRANZO / CENA reale */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <Clock size={16} className="text-blue-500"/> Split Pranzo / Cena (reale)
          <Info_ text="Incasso e quantità per turno dalla tabella chiusure_turni (dati iPratico). Nessuna stima: split reale del periodo/sede."/>
        </h2>
        <p className="text-xs text-gray-500 mb-4">Fonte: chiusure_turni · {periodoLabel}</p>
        {!splitTurni ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400">
            <Clock size={32} className="mb-2 opacity-40"/><p className="text-sm">Dati non disponibili per il periodo</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[['pranzo','🌞 Pranzo','bg-blue-50 border-blue-100 text-blue-700'],
              ['cena','🌙 Cena','bg-indigo-50 border-indigo-100 text-indigo-700']].map(([k,lbl,cls])=>{
              const t = splitTurni[k]
              return (
                <div key={k} className={`rounded-xl border p-4 ${cls}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">{lbl}</span>
                    <span className="text-2xl font-bold">{t.share.toFixed(0)}%</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><div className="opacity-60">Incasso tot.</div><div className="font-bold">{eur(t.inc)}</div></div>
                    <div><div className="opacity-60">Incasso medio/turno</div><div className="font-bold">{eur(t.incMedio)}</div></div>
                    <div><div className="opacity-60">Pz venduti</div><div className="font-bold">{num(t.q)}</div></div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* TOP 10 TAVOLI PER INCASSO */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
            <Star size={16} className="text-blue-500"/> Top 10 Tavoli per Incasso
            <Info_ text="Incasso cumulato per tavolo (statistiche_tavoli, aggregato per sede+tavolo) nel periodo/sede."/>
          </h2>
          <p className="text-xs text-gray-500 mb-4">Fonte: statistiche_tavoli</p>
          {topTavoli.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400">
              <Table size={36} className="mb-2 opacity-40"/><p className="text-sm">Dati non disponibili per il periodo</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topTavoli} layout="vertical" margin={{top:0,right:55,left:60,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0"/>
                <XAxis type="number" fontSize={11} tickFormatter={v=>`€${(v/1000).toFixed(1)}k`}/>
                <YAxis dataKey="etich" type="category" width={70} fontSize={11}/>
                <Tooltip formatter={v=>eur(v)}/>
                <Bar dataKey="incasso" name="Incasso" radius={[0,4,4,0]}>
                  {topTavoli.map((t,i)=><Cell key={i} fill={SEDE_COLOR[t.sede]||'#3b82f6'}/>)}
                  <LabelList dataKey="incasso" position="right" fontSize={10}
                    formatter={v=>`€${(v/1000).toFixed(1)}k`}/>
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* DISTRIBUZIONE SETTIMANALE */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
            <TrendingUp size={16} className="text-blue-500"/> Media Coperti per Giorno Settimana
            <Info_ text="Media dei coperti per giorno della settimana = somma coperti del giorno ÷ numero di quei giorni nel periodo. Fonte chiusure_giornaliere."/>
          </h2>
          <p className="text-xs text-gray-500 mb-4">Fonte: chiusure_giornaliere · {periodoLabel}</p>
          {giorniDistrib.every(g=>g.count===0) ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400">
              <TrendingUp size={36} className="mb-2 opacity-40"/><p className="text-sm">Dati non disponibili per il periodo</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={giorniDistrib} margin={{top:0,right:20,left:0,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="giorno" fontSize={11}/>
                <YAxis fontSize={11}/>
                <Tooltip formatter={(v,name)=>name==='Media Coperti'?[`${v} coperti`,name]:[v,name]}/>
                <Bar dataKey="mediaCoperti" name="Media Coperti" radius={[4,4,0,0]} opacity={0.9}>
                  {giorniDistrib.map((_,i)=>(<Cell key={i} fill={i===5||i===6||i===0?'#6366f1':'#3b82f6'}/>))}
                  <LabelList dataKey="mediaCoperti" position="top" fontSize={10}/>
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* SCATTER DURATA VS INCASSO — separato per sede quando ALL */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <Clock size={16} className="text-blue-500"/> Durata vs Incasso per Tavolo
          <Info_ text="Ogni bolla è un tavolo: X = durata media occupazione (min), Y = incasso cumulato, dimensione = coperti medi. Fonte statistiche_tavoli."/>
        </h2>
        <p className="text-xs text-gray-500 mb-4">Tavoli in alto a sinistra = veloci e redditizi · Fonte: statistiche_tavoli</p>
        {(scatterByCode.MA.length + scatterByCode.PN.length) === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Clock size={36} className="mb-2 opacity-40"/><p className="text-sm">Dati non disponibili per il periodo</p>
          </div>
        ) : (
          <div className={`grid gap-4 ${sede==='ALL' ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
            {(sede==='ALL'?['MA','PN']:[sede]).map(code => (
              <div key={code}>
                {sede==='ALL' && <div className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{background:SEDE_COLOR[code]}}/> {SEDE_LABEL[code]}</div>}
                {scatterByCode[code].length === 0 ? (
                  <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Dati non disponibili</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <ScatterChart margin={{top:20,right:20,bottom:30,left:20}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                      <XAxis dataKey="durata_media_min" name="Durata media (min)" type="number" fontSize={11}
                        label={{value:'Durata media (min)',position:'insideBottom',offset:-15,fontSize:11}}/>
                      <YAxis dataKey="incasso" name="Incasso totale" type="number" fontSize={11}
                        label={{value:'Incasso €',angle:-90,position:'insideLeft',fontSize:11}}
                        tickFormatter={v=>`€${(v/1000).toFixed(0)}k`}/>
                      <Tooltip content={<ScatterTooltip/>}/>
                      <Scatter data={scatterByCode[code]} shape={(props) => {
                        const { cx, cy, payload } = props
                        const r = payload.z || 8
                        const fill = SEDE_COLOR[payload.sede] || '#3b82f6'
                        return (
                          <g>
                            <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.55} stroke={fill} strokeWidth={1.5}/>
                            <text x={cx} y={cy-r-3} textAnchor="middle" fontSize={9} fill="#374151" fontWeight="600">{payload.tavolo}</text>
                          </g>
                        )
                      }}/>
                    </ScatterChart>
                  </ResponsiveContainer>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* TABELLA TAVOLI */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <Table size={16} className="text-blue-500"/> Dettaglio Tavoli ({sortedTavoli.length})
          <Info_ text="Una riga per tavolo (sede+tavolo). Aperture = numero record statistiche_tavoli; €/min = incasso ÷ somma minuti occupazione; coperti medi = coperti ÷ aperture."/>
        </h2>
        <p className="text-xs text-gray-500 mb-4">Fonte: statistiche_tavoli · {periodoLabel}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                {TABLE_COLS.map(col=>(
                  <th key={col.key} onClick={()=>handleSort(col.key)}
                    className="pb-2 pr-4 font-semibold text-gray-600 cursor-pointer hover:text-blue-600 select-none whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      {col.label}
                      {sortCol===col.key&&(sortDir==='asc'?<ChevronUp size={12}/>:<ChevronDown size={12}/>)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedTavoli.map((row,i)=>(
                <tr key={row.key} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 pr-4 font-semibold text-gray-800">{row.tavolo}</td>
                  {sede==='ALL' && <td className="py-2 pr-4 text-gray-500">{row.sede}</td>}
                  <td className="py-2 pr-4 text-gray-700">{row.count}</td>
                  <td className="py-2 pr-4 text-gray-700">{row.coperti_medi.toFixed(1)}</td>
                  <td className="py-2 pr-4 text-gray-700">{row.n_ordini}</td>
                  <td className="py-2 pr-4 text-gray-700">
                    {row.durata_media_min>0?(
                      <span className={`font-medium ${row.durata_media_min>90?'text-red-500':row.durata_media_min>60?'text-orange-500':'text-green-600'}`}>
                        {Math.round(row.durata_media_min)} min
                      </span>
                    ):'—'}
                  </td>
                  <td className="py-2 pr-4 text-gray-700">{row.incasso_per_min>0?eur(row.incasso_per_min):'—'}</td>
                  <td className="py-2 pr-4 font-semibold text-gray-800">{eur(row.incasso)}</td>
                  <td className="py-2 pr-4 text-gray-700">{row.scontrino_medio>0?eur(row.scontrino_medio):'—'}</td>
                </tr>
              ))}
              {sortedTavoli.length===0&&(
                <tr><td colSpan={TABLE_COLS.length} className="py-12 text-center text-gray-400">
                  <Table size={32} className="mx-auto mb-2 opacity-40"/>Dati non disponibili per il periodo
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PageAssistant pageId="coperti-bi" systemContext={systemContext}
        suggestions={[
          "Quale tavolo genera più fatturato?",
          "Qual è la durata media per tavolo?",
          "Come sono distribuiti i coperti nella settimana?",
          "Confronta coperti MA vs PN",
        ]}/>
    </div>
  )
}
