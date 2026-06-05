import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { chiusure as chiusureApi, kpi as kpiApi, analytics as analyticsApi } from '../api/client'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart
} from 'recharts'
import {
  TrendingUp, TrendingDown, Users, Euro, Target, BarChart2,
  ArrowRight, RefreshCw, Minus, Info
} from 'lucide-react'
import { periodToDates } from '../components/DateRangePicker'
import PeriodFilter from '../components/PeriodFilter'
import PageAssistant from '../components/PageAssistant'
import PageStatsWidget from '../components/PageStatsWidget'

// ── Helpers ────────────────────────────────────────────────────────────────
const eur = n => (typeof n === 'number' && !isNaN(n))
  ? `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
const num = n => (typeof n === 'number' && !isNaN(n)) ? n.toLocaleString('it-IT') : '—'

function getDelta(curr, prev) {
  if (!prev || prev === 0) return null
  return Math.round(((curr - prev) / prev) * 1000) / 10
}

// ── Tooltip informativo ────────────────────────────────────────────────────
function InfoTooltip({ text }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative inline-block ml-1.5">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(s => !s)}
        className="w-5 h-5 rounded-full bg-white/25 text-white text-[10px] flex items-center justify-center hover:bg-white/40 transition-colors font-bold leading-none flex-shrink-0"
        style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }}
      >i</button>
      {show && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-gray-900 text-white text-xs rounded-xl p-3 shadow-2xl pointer-events-none" style={{ lineHeight: '1.5' }}>
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  )
}

// ── KPI Card stile iPratico ────────────────────────────────────────────────
function StatCard({ label, value, sub, delta, bg, icon: Icon, tooltip }) {
  const pos = delta > 0
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus
  return (
    <div className="rounded-xl p-5 text-white relative overflow-hidden flex flex-col justify-between min-h-[110px]"
      style={{ background: bg }}>
      {/* Icon */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-0">
            <p className="text-xs font-medium uppercase tracking-wider opacity-80 mb-1">{label}</p>
            {tooltip && <InfoTooltip text={tooltip} />}
          </div>
          <p className="text-3xl font-bold leading-tight">{value}</p>
        </div>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center opacity-30 flex-shrink-0"
          style={{ backgroundColor: 'rgba(255,255,255,0.3)' }}>
          <Icon size={20} className="text-white" />
        </div>
      </div>
      {/* Delta */}
      {delta !== null && delta !== undefined && (
        <div className="flex items-center gap-1.5 mt-2">
          <DeltaIcon size={12} className="opacity-90" />
          <span className="text-xs font-semibold opacity-90">
            {pos ? '+' : ''}{delta}% {sub}
          </span>
        </div>
      )}
      {delta === null && sub && (
        <p className="text-xs opacity-70 mt-2">{sub}</p>
      )}
    </div>
  )
}

// ── Componenti DateRangePicker, MiniCalendar, periodToDates, PERIODS
// sono ora in src/components/DateRangePicker.jsx (condivisi con tutte le pagine)

// Calcola periodo precedente (stessa durata)
function prevPeriod(from, to) {
  const f = new Date(from), t = new Date(to)
  const days = Math.round((t - f) / (1000*60*60*24)) + 1
  const pf = new Date(f); pf.setDate(pf.getDate() - days)
  const pt = new Date(f); pt.setDate(pt.getDate() - 1)
  const fmt = d => d.toISOString().slice(0, 10)
  return { from: fmt(pf), to: fmt(pt) }
}

// ── Custom Tooltip ─────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 mb-0.5">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-gray-500">{p.name}:</span>
          <span className="font-medium">{p.dataKey?.includes('coperti') ? num(p.value) : eur(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [period, setPeriod] = useState('month')
  const [dates, setDates] = useState(periodToDates('month'))
  const [locFilter, setLocFilter] = useState('ALL') // ALL | MAMELI | PREDDA_NIEDDA
  const [loading, setLoading] = useState(true)

  // Dati
  const [currStats, setCurrStats] = useState([])
  const [prevStats, setPrevStats] = useState([])
  const [daily, setDaily] = useState([])
  const [monthly, setMonthly] = useState([])
  const [yoy, setYoy] = useState([])
  const [topCoperti, setTopCoperti] = useState([])

  const load = useCallback(async (d) => {
    setLoading(true)
    try {
      const prev = prevPeriod(d.from, d.to)

      // Determina se mostrare il mensile per anno intero o per il range selezionato
      const fromYear = new Date(d.from).getFullYear()
      const toYear   = new Date(d.to).getFullYear()
      const sameYear = fromYear === toYear
      // Mensile: anno intero se il range è < 1 mese o > 1 anno, altrimenti usa il range
      const dayRange = Math.round((new Date(d.to) - new Date(d.from)) / (1000*60*60*24))
      const mensileParams = dayRange > 31 && sameYear
        ? { from: d.from, to: d.to }
        : { year: fromYear }

      const [curr, p, dailyData, mensileData, yoyData, kpiTeam] = await Promise.all([
        chiusureApi.stats({ from: d.from, to: d.to }).catch(() => []),
        chiusureApi.stats({ from: prev.from, to: prev.to }).catch(() => []),
        chiusureApi.getAll({ from: d.from, to: d.to, limit: 90 }).catch(() => []),
        chiusureApi.mensile(mensileParams).catch(() => []),
        analyticsApi.overview({ from: d.from, to: d.to }).catch(() => null),
        kpiApi.quantum({ from: d.from, to: d.to }).catch(() => []),
      ])

      setCurrStats(Array.isArray(curr) ? curr : [])
      setPrevStats(Array.isArray(p) ? p : [])

      // Merge daily per grafico
      const dailyByDate = {}
      const dl = Array.isArray(dailyData) ? dailyData : (dailyData?.chiusure || [])
      dl.forEach(r => {
        const key = r.data
        if (!dailyByDate[key]) dailyByDate[key] = {
          data: key,
          label: new Date(key).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }),
        }
        if (r.location === 'MAMELI') {
          dailyByDate[key].MAMELI = r.totale_venduto_ipratico
          dailyByDate[key].MAMELI_coperti = r.coperti
        } else {
          dailyByDate[key].PREDDA_NIEDDA = r.totale_venduto_ipratico
          dailyByDate[key].PREDDA_NIEDDA_coperti = r.coperti
        }
      })
      setDaily(Object.values(dailyByDate).sort((a,b) => a.data.localeCompare(b.data)))

      // Mensile — mappa sede (MA/PN) → location (MAMELI/PREDDA_NIEDDA)
      const byMese = {}
      const ml = Array.isArray(mensileData) ? mensileData : []
      ml.forEach(r => {
        if (!byMese[r.mese]) byMese[r.mese] = {
          mese: r.mese,
          label: new Date(r.mese+'-15').toLocaleDateString('it-IT',{month:'short',year:'2-digit'})
        }
        const loc = r.sede === 'MA' ? 'MAMELI' : r.sede === 'PN' ? 'PREDDA_NIEDDA' : (r.location || r.sede)
        byMese[r.mese][loc] = Math.round(r.tot_venduto)
        byMese[r.mese][loc+'_cop'] = r.tot_coperti
      })
      setMonthly(Object.values(byMese).slice(-8))

      // YoY — analytics.overview() ritorna { yoy, kpiBox }
      if (yoyData?.yoy) setYoy(yoyData.yoy)

      // Top per coperti
      const kqList = Array.isArray(kpiTeam) ? kpiTeam : []
      setTopCoperti(kqList.filter(k => k.coperti_gestiti > 0).slice(0, 8))

    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(dates) }, [dates])

  const handleApply = (pid, d) => {
    setPeriod(pid)
    if (d) setDates(d)
  }

  // Aggrega stats per locali selezionati
  const aggr = (list) => {
    const filtered = locFilter === 'ALL' ? list : list.filter(x => x.location === locFilter)
    const raw = filtered.reduce((acc, s) => ({
      tot_venduto: (acc.tot_venduto || 0) + (s.tot_venduto || 0),
      tot_coperti: (acc.tot_coperti || 0) + (s.tot_coperti || 0),
      avg_scontrino_medio: (acc._smCount || 0) === 0
        ? s.avg_scontrino_medio
        : ((acc.avg_scontrino_medio * (acc._smCount||0)) + s.avg_scontrino_medio) / ((acc._smCount||0)+1),
      n_giorni: (acc.n_giorni || 0) + (s.n_giorni || 0),
      _smCount: (acc._smCount||0)+1,
    }), {})
    // coperto medio pesato: venduto totale / coperti totali (evita media semplice di sedi)
    raw.avg_coperto_medio = raw.tot_coperti > 0 ? +(raw.tot_venduto / raw.tot_coperti).toFixed(2) : 0
    return raw
  }

  const curr = aggr(currStats)
  const prev = aggr(prevStats)

  const deltaVenduto    = getDelta(curr.tot_venduto, prev.tot_venduto)
  const deltaCoperti    = getDelta(curr.tot_coperti, prev.tot_coperti)
  const deltaCM         = getDelta(curr.avg_coperto_medio, prev.avg_coperto_medio)
  const deltaScontrino  = getDelta(curr.avg_scontrino_medio, prev.avg_scontrino_medio)

  const showNoData = !loading && !curr.tot_venduto && !curr.tot_coperti

  // Filtra dati grafico per location
  const dailyFiltered = daily.map(d => {
    if (locFilter === 'MAMELI') return { ...d, PREDDA_NIEDDA: undefined, PREDDA_NIEDDA_coperti: undefined }
    if (locFilter === 'PREDDA_NIEDDA') return { ...d, MAMELI: undefined, MAMELI_coperti: undefined }
    return d
  })

  return (
    <>
    <PageStatsWidget />
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {dates.from} → {dates.to}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Localizzazione filter */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {[['ALL','Entrambi'],['MAMELI','Sede MA'],['PREDDA_NIEDDA','Sede PN']].map(([id,l]) => (
              <button key={id} onClick={() => setLocFilter(id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  locFilter === id ? 'bg-white shadow text-gray-900' : 'text-gray-500'
                }`}>{l}</button>
            ))}
          </div>

          {loading && <RefreshCw size={16} className="animate-spin text-gray-400" />}
        </div>
      </div>

      {/* ── Filtro periodo condiviso ── */}
      <PeriodFilter period={period} dates={dates} onChange={handleApply} />

      {/* ── Avviso nessun dato nel periodo ── */}
      {showNoData && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm">
          <span className="text-amber-600 font-medium">⚠️ Nessun dato disponibile per il periodo selezionato.</span>
          <span className="text-amber-500">
            {period === 'week' && 'La settimana corrente inizia oggi — prova "Sett. prec." o "Ultimi 7 gg".'}
            {period === 'today' && 'I dati di oggi non sono ancora stati sincronizzati.'}
            {(period !== 'week' && period !== 'today') && 'Prova un altro periodo o verifica la sincronizzazione.'}
          </span>
        </div>
      )}

      {/* ── KPI Cards stile iPratico ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Totale Incassato"
          value={eur(curr.tot_venduto)}
          delta={deltaVenduto}
          sub="vs periodo prec."
          bg="linear-gradient(135deg,#6366f1,#4f46e5)"
          icon={Euro}
          tooltip={`Totale venduto nel periodo selezionato. La variazione % confronta lo stesso numero di giorni nel periodo immediatamente precedente.`}
        />
        <StatCard
          label="Numero Ospiti"
          value={num(curr.tot_coperti)}
          delta={deltaCoperti}
          sub="vs periodo prec."
          bg="linear-gradient(135deg,#0ea5e9,#0284c7)"
          icon={Users}
          tooltip={`Coperti totali (ospiti serviti) nel periodo. La variazione % è calcolata sullo stesso numero di giorni precedenti.`}
        />
        <StatCard
          label="Venduto per Coperto"
          value={curr.avg_coperto_medio ? `€ ${(+curr.avg_coperto_medio).toFixed(2)}` : '—'}
          delta={deltaCM}
          sub="vs periodo prec."
          bg="linear-gradient(135deg,#f59e0b,#d97706)"
          icon={Target}
          tooltip={`Media giornaliera del coperto medio (venduto ÷ coperti). Indica quanto spende in media ogni ospite. Confronto vs periodo precedente.`}
        />
        <StatCard
          label="Scontrino Medio"
          value={curr.avg_scontrino_medio ? `€ ${(+curr.avg_scontrino_medio).toFixed(2)}` : '—'}
          delta={deltaScontrino}
          sub="vs periodo prec."
          bg="linear-gradient(135deg,#10b981,#059669)"
          icon={BarChart2}
          tooltip={`Media giornaliera dello scontrino medio (venduto ÷ numero tavoli/conti chiusi). Confronto vs periodo precedente.`}
        />
      </div>

      {/* ── Locali a confronto ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {[
          { key: 'MAMELI',       label: 'Sede MA (MA)',         color: '#6366f1', border: '#6366f120' },
          { key: 'PREDDA_NIEDDA',label: 'Sede PN (PN)', color: '#10b981', border: '#10b98120' },
        ].map(loc => {
          const cs = currStats.find(x => x.location === loc.key) || {}
          const ps = prevStats.find(x => x.location === loc.key) || {}
          const dv = getDelta(cs.tot_venduto, ps.tot_venduto)
          const dc = getDelta(cs.tot_coperti, ps.tot_coperti)
          return (
            <div key={loc.key} className="bg-white rounded-xl border shadow-sm overflow-hidden"
              style={{ borderColor: loc.border }}>
              <div className="flex items-center justify-between px-4 py-3 border-b"
                style={{ borderColor: loc.border, backgroundColor: loc.color + '08' }}>
                <h3 className="font-bold text-gray-800">{loc.label}</h3>
                <div className="flex items-center gap-2">
                  {dv !== null && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${dv >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}
                      title={`Variazione venduto vs periodo precedente (${dc !== null ? `coperti: ${dc >= 0 ? '+' : ''}${dc}%` : ''})`}>
                      {dv >= 0 ? '+' : ''}{dv}% venduto
                    </span>
                  )}
                  <span className="text-xs text-gray-400">{dates.from} → {dates.to}</span>
                </div>
              </div>
              <div className="grid grid-cols-4 divide-x divide-gray-50 px-0">
                {[
                  ['Venduto', eur(cs.tot_venduto)],
                  ['Coperti', num(cs.tot_coperti)],
                  ['Cop. Medio', cs.avg_coperto_medio ? `€${(+cs.avg_coperto_medio).toFixed(2)}` : '—'],
                  ['Scontrino', cs.avg_scontrino_medio ? `€${(+cs.avg_scontrino_medio).toFixed(2)}` : '—'],
                ].map(([l, v]) => (
                  <div key={l} className="text-center py-3 px-2">
                    <p className="text-xs text-gray-400 mb-0.5">{l}</p>
                    <p className="font-bold text-sm text-gray-900">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Grafico andamento vendite ── */}
      {daily.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold text-gray-800">Andamento delle Vendite</h2>
              <p className="text-xs text-gray-400">Venduto giornaliero per locale</p>
            </div>
            <Link to="/chiusure" className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
              Dettaglio <ArrowRight size={12} />
            </Link>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={dailyFiltered} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradMA" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="gradPN" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tickFormatter={v => `€${(v/1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {locFilter !== 'PREDDA_NIEDDA' && (
                <Area type="monotone" dataKey="MAMELI" name="Sede MA"
                  stroke="#6366f1" fill="url(#gradMA)" strokeWidth={2} dot={false} />
              )}
              {locFilter !== 'MAMELI' && (
                <Area type="monotone" dataKey="PREDDA_NIEDDA" name="Sede PN"
                  stroke="#10b981" fill="url(#gradPN)" strokeWidth={2} dot={false} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Mensile + YoY ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Venduto mensile */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800 text-sm">
              Venduto Mensile {dates ? `${dates.from?.slice(0,7)} → ${dates.to?.slice(0,7)}` : new Date().getFullYear()}
            </h2>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthly} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => `€${(v/1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {locFilter !== 'PREDDA_NIEDDA' && <Bar dataKey="MAMELI" name="Sede MA" fill="#6366f1" radius={[3,3,0,0]} />}
              {locFilter !== 'MAMELI' && <Bar dataKey="PREDDA_NIEDDA" name="Sede PN" fill="#10b981" radius={[3,3,0,0]} />}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* YoY confronto */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800 text-sm">Confronto Anno su Anno ({new Date().getFullYear() - 1} vs {new Date().getFullYear()})</h2>
            <Link to="/analytics" className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
              BI <ArrowRight size={12} />
            </Link>
          </div>
          {yoy.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={yoy} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="mese_label" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={v => `€${(v/1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey={`venduto_${new Date().getFullYear() - 1}`} name={String(new Date().getFullYear() - 1)} fill="#cbd5e1" radius={[3,3,0,0]} />
                <Bar dataKey={`venduto_${new Date().getFullYear()}`} name={String(new Date().getFullYear())} fill="#6366f1" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
              Sincronizza i dati per vedere il confronto
            </div>
          )}
        </div>
      </div>

      {/* ── Top operatori per coperti ── */}
      {topCoperti.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800 text-sm">Ranking Operatori — Coperti Gestiti</h2>
            <Link to="/kpi" className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
              KPI <ArrowRight size={12} />
            </Link>
          </div>
          <div className="space-y-2">
            {topCoperti
              .filter(op => locFilter === 'ALL' || op.location === locFilter)
              .slice(0, 6)
              .map((op, i) => {
                const max = topCoperti[0]?.coperti_gestiti || 1
                const pct = Math.round((op.coperti_gestiti / max) * 100)
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-300 w-5 text-right">#{i+1}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${op.location === 'MAMELI' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {op.location === 'MAMELI' ? 'MA' : 'PN'}
                    </span>
                    <span className="text-sm font-medium text-gray-700 w-24 truncate">{op.operatore}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: op.location === 'MAMELI' ? '#6366f1' : '#10b981' }} />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 w-20 text-right">
                      {num(op.coperti_gestiti)} cop.
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* ── Quick links ai moduli ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { to: '/kpi',        label: 'KPI Camerieri',  icon: '🎯', color: '#6366f1', sub: 'Quantum & target' },
          { to: '/chiusure',   label: 'Chiusure',       icon: '💰', color: '#0ea5e9', sub: 'Report giornalieri' },
          { to: '/analytics',  label: 'Analytics & BI', icon: '📡', color: '#8b5cf6', sub: 'Previsioni & trend' },
          { to: '/fornitori',  label: 'Fornitori',      icon: '🏭', color: '#10b981', sub: 'Costi & fatture' },
        ].map(item => (
          <Link key={item.to} to={item.to}
            className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3 hover:border-indigo-200 hover:shadow-md transition-all group">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
              style={{ backgroundColor: item.color + '15' }}>
              {item.icon}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm text-gray-800 group-hover:text-indigo-600">{item.label}</p>
              <p className="text-xs text-gray-400">{item.sub}</p>
            </div>
            <ArrowRight size={14} className="text-gray-300 group-hover:text-indigo-400 ml-auto flex-shrink-0" />
          </Link>
        ))}
      </div>

    </div>
      <PageAssistant
        pagina="Dashboard"
        suggerimenti={[
          "Qual è l'andamento delle vendite questo mese?",
          "Confronta le due sedi MA e PN",
          "Mostrami i KPI principali del ristorante",
        ]}
      />
    </>
  )
}