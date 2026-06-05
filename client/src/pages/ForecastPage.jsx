/**
 * ForecastPage.jsx — Revenue Forecast & Confronto Reale
 * Previsioni incasso per MA e PN, confronto con chiusure giornaliere reali.
 */
import React, { useEffect, useState, useMemo } from 'react'
import supabase from '../supabase'
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer
} from 'recharts'
import {
  TrendingUp, CalendarDays, Euro, Loader,
  AlertCircle, CloudSun, Sun, Cloud, CloudRain
} from 'lucide-react'
import PageAssistant from '../components/PageAssistant'

// ── Helpers ─────────────────────────────────────────────────────────────────
const SEDE_OPTS = [
  { value: 'all', label: 'Entrambe' },
  { value: 'MA',  label: 'Mameli (MA)' },
  { value: 'PN',  label: 'Predda Niedda (PN)' },
]

function eur(n) {
  return n != null
    ? `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : '—'
}
function datIt(s) {
  if (!s) return '—'
  return new Date(s + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
}
function datShort(s) {
  if (!s) return ''
  const d = new Date(s + 'T00:00:00')
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Prossimi N giorni a partire da oggi
function nextNDays(n) {
  const pad = x => String(x).padStart(2, '0')
  const days = []
  for (let i = 0; i < n; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    days.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
  }
  return days
}

// Ultimi N giorni (incluso oggi)
function lastNDays(n) {
  const pad = x => String(x).padStart(2, '0')
  const days = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
  }
  return days
}

// Icona meteo in base al testo della nota
function MeteoIcon({ nota }) {
  if (!nota) return null
  const n = nota.toLowerCase()
  if (n.includes('pioggia') || n.includes('piov') || n.includes('maltempo'))
    return <CloudRain size={14} className="text-blue-500 inline ml-1" />
  if (n.includes('nuvoloso') || n.includes('coperto'))
    return <Cloud size={14} className="text-gray-400 inline ml-1" />
  if (n.includes('sereno') || n.includes('soleggiato') || n.includes('bello'))
    return <Sun size={14} className="text-amber-500 inline ml-1" />
  return <CloudSun size={14} className="text-sky-400 inline ml-1" />
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KPICard({ icon: Icon, label, value, sub, color = '#6366f1' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
        <div className="p-1.5 rounded-lg" style={{ backgroundColor: color + '20' }}>
          <Icon size={14} style={{ color }} />
        </div>
      </div>
      <div className="font-bold text-gray-900 text-2xl">{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  )
}

// ── Tooltip AreaChart forecast ────────────────────────────────────────────────
function ForecastTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-semibold text-gray-800 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-gray-600">{p.name}: <b>{eur(p.value)}</b></span>
        </div>
      ))}
    </div>
  )
}

// ── Tooltip LineChart reale vs forecast ──────────────────────────────────────
function RealeForecastTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-semibold text-gray-800 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-gray-600">{p.name}: <b>{eur(p.value)}</b></span>
        </div>
      ))}
    </div>
  )
}

// ── Componente principale ─────────────────────────────────────────────────────
export default function ForecastPage() {
  const [sede, setSede]           = useState('all')
  const [forecast, setForecast]   = useState([])
  const [chiusure, setChiusure]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)

  // Date di riferimento
  const nextDays = useMemo(() => nextNDays(7), [])

  // Periodo storico personalizzabile (default: ultimi 7 giorni incluso oggi)
  const defaultLast = useMemo(() => lastNDays(7), [])
  const [histFrom, setHistFrom] = useState(defaultLast[0])
  const [histTo, setHistTo]     = useState(defaultLast[defaultLast.length - 1])
  const lastDays = useMemo(() => {
    if (!histFrom || !histTo || histFrom > histTo) return defaultLast
    const pad = x => String(x).padStart(2, '0')
    const days = []
    const d = new Date(histFrom + 'T00:00:00')
    const end = new Date(histTo + 'T00:00:00')
    let guard = 0
    while (d <= end && guard < 366) {
      days.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
      d.setDate(d.getDate() + 1)
      guard++
    }
    return days
  }, [histFrom, histTo, defaultLast])

  // Carica dati
  useEffect(() => {
    setLoading(true)
    setError(null)

    const fromF  = nextDays[0]
    const toF    = nextDays[nextDays.length - 1]
    const fromC  = lastDays[0]
    const toC    = lastDays[lastDays.length - 1]

    // Query forecast prossimi 7 giorni
    let qF = supabase.from('revenue_forecast')
      .select('sede, data_competenza, previsione_incasso, valutazione, note_meteo, aggiornato_il')
      .gte('data_competenza', fromF)
      .lte('data_competenza', toF)
      .order('data_competenza', { ascending: true })
    if (sede !== 'all') qF = qF.eq('sede', sede)

    // Query chiusure reali ultimi 7 giorni
    let qC = supabase.from('chiusure_giornaliere')
      .select('sede, data, totale_venduto_ipratico, coperti, scontrino_medio')
      .gte('data', fromC)
      .lte('data', toC)
      .order('data', { ascending: true })
    if (sede !== 'all') qC = qC.eq('sede', sede)

    Promise.all([qF, qC])
      .then(([{ data: fData, error: fErr }, { data: cData, error: cErr }]) => {
        if (fErr) throw fErr
        if (cErr) throw cErr
        setForecast(fData ?? [])
        setChiusure(cData ?? [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [sede, nextDays, lastDays])

  // ── KPI ──────────────────────────────────────────────────────────────────
  const oggi    = nextDays[0]
  const domani  = nextDays[1]

  const kpi = useMemo(() => {
    const prevOggi   = forecast.filter(r => r.data_competenza === oggi)
    const prevDomani = forecast.filter(r => r.data_competenza === domani)
    const totSettimana = forecast.reduce((s, r) => s + (Number(r.previsione_incasso) || 0), 0)
    const sommaOggi   = prevOggi.reduce((s, r) => s + (Number(r.previsione_incasso) || 0), 0)
    const sommaDomani = prevDomani.reduce((s, r) => s + (Number(r.previsione_incasso) || 0), 0)
    return {
      oggi:      prevOggi.length > 0   ? sommaOggi   : null,
      domani:    prevDomani.length > 0  ? sommaDomani : null,
      settimana: forecast.length > 0   ? totSettimana : null,
    }
  }, [forecast, oggi, domani])

  // ── Dati AreaChart forecast MA vs PN ────────────────────────────────────
  const areaData = useMemo(() => {
    return nextDays.map(data => {
      const righe = forecast.filter(r => r.data_competenza === data)
      const ma = righe.find(r => r.sede === 'MA')
      const pn = righe.find(r => r.sede === 'PN')
      return {
        data: datShort(data),
        MA:   ma ? Number(ma.previsione_incasso) || 0 : undefined,
        PN:   pn ? Number(pn.previsione_incasso) || 0 : undefined,
        // Se sede è unica, mostra il totale
        totale: righe.reduce((s, r) => s + (Number(r.previsione_incasso) || 0), 0) || undefined,
      }
    })
  }, [forecast, nextDays])

  // ── Dati LineChart reale vs forecast (ultimi 7 gg) ───────────────────────
  const lineData = useMemo(() => {
    return lastDays.map(data => {
      const cRighe = chiusure.filter(r => r.data === data)
      const fRighe = forecast.filter(r => r.data_competenza === data)
      const reale   = cRighe.reduce((s, r) => s + (Number(r.totale_venduto_ipratico) || 0), 0)
      const previsto = fRighe.reduce((s, r) => s + (Number(r.previsione_incasso) || 0), 0)
      return {
        data:   datShort(data),
        reale:  reale   || undefined,
        forecast: previsto || undefined,
      }
    })
  }, [chiusure, forecast, lastDays])

  // ── Tabella forecast ────────────────────────────────────────────────────
  const tabellaForecast = useMemo(() => {
    return [...forecast].sort((a, b) => {
      if (a.data_competenza < b.data_competenza) return -1
      if (a.data_competenza > b.data_competenza) return  1
      return (a.sede || '').localeCompare(b.sede || '')
    })
  }, [forecast])

  // ── systemContext per PageAssistant ──────────────────────────────────────
  const systemContext = useMemo(() => {
    return `Pagina: Revenue Forecast
Sede: ${sede === 'all' ? 'Entrambe (MA + PN)' : sede}
KPI previsioni:
- Oggi (${datIt(oggi)}): ${eur(kpi.oggi)}
- Domani (${datIt(domani)}): ${eur(kpi.domani)}
- Totale settimana (7 giorni): ${eur(kpi.settimana)}
Righe forecast: ${forecast.length}
Chiusure reali ultimi 7 giorni: ${chiusure.length}
Giornate con nota meteo: ${forecast.filter(r => r.note_meteo).length}
Valutazioni disponibili: ${[...new Set(forecast.filter(r => r.valutazione).map(r => r.valutazione))].join(', ') || 'nessuna'}`
  }, [kpi, sede, oggi, domani, forecast, chiusure])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <TrendingUp size={22} className="text-violet-600" />
            Revenue Forecast
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Previsioni incasso prossimi 7 giorni e confronto con i dati reali
          </p>
        </div>

        {/* Selettore sede */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {SEDE_OPTS.map(o => (
            <button key={o.value} onClick={() => setSede(o.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                sede === o.value ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filtro periodo storico */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Storico dal</label>
          <input type="date" value={histFrom} onChange={e => setHistFrom(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Al</label>
          <input type="date" value={histTo} onChange={e => setHistTo(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none" />
        </div>
        <span className="text-xs text-gray-400 pb-2.5">
          Confronto previsioni vs reale sul periodo selezionato · le previsioni future restano sui prossimi 7 giorni
        </span>
      </div>

      {/* Errore */}
      {error && (
        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm">
          <AlertCircle size={16} /> <span>{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 gap-3">
          <Loader size={20} className="animate-spin" />
          <span className="text-sm">Caricamento previsioni...</span>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KPICard
              icon={CalendarDays}
              label="Previsione Oggi"
              value={kpi.oggi != null ? eur(kpi.oggi) : 'N/D'}
              sub={datIt(oggi)}
              color="#7c3aed"
            />
            <KPICard
              icon={Euro}
              label="Previsione Domani"
              value={kpi.domani != null ? eur(kpi.domani) : 'N/D'}
              sub={datIt(domani)}
              color="#10b981"
            />
            <KPICard
              icon={TrendingUp}
              label="Totale Settimana"
              value={kpi.settimana != null ? eur(kpi.settimana) : 'N/D'}
              sub="somma previsioni 7 giorni"
              color="#f59e0b"
            />
          </div>

          {/* AreaChart forecast 7 giorni */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-1">Forecast Prossimi 7 Giorni</h2>
            <p className="text-xs text-gray-400 mb-4">
              Previsione incasso per sede — confronto MA vs PN
            </p>
            {areaData.every(d => d.MA == null && d.PN == null && d.totale == null) ? (
              <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
                Nessuna previsione disponibile per i prossimi 7 giorni.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={areaData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradMA" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="gradPN" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="gradTot" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#7c3aed" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#7c3aed" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="data" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `€${(v / 1000).toFixed(1)}k`} />
                  <Tooltip content={<ForecastTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {sede === 'all' ? (
                    <>
                      <Area type="monotone" dataKey="MA" name="MA – Mameli"
                        stroke="#6366f1" fill="url(#gradMA)" strokeWidth={2} dot={{ r: 4 }} connectNulls />
                      <Area type="monotone" dataKey="PN" name="PN – Predda Niedda"
                        stroke="#10b981" fill="url(#gradPN)" strokeWidth={2} dot={{ r: 4 }} connectNulls />
                    </>
                  ) : (
                    <Area type="monotone" dataKey="totale" name={`Previsione ${sede}`}
                      stroke="#7c3aed" fill="url(#gradTot)" strokeWidth={2} dot={{ r: 4 }} connectNulls />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* LineChart reale vs forecast (ultimi 7 giorni) */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-1">Incasso Reale vs Forecast — Ultimi 7 Giorni</h2>
            <p className="text-xs text-gray-400 mb-4">
              Confronto tra chiusure reali (iPratico) e previsioni
            </p>
            {lineData.every(d => d.reale == null && d.forecast == null) ? (
              <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
                Nessun dato disponibile per il confronto.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={lineData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="data" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `€${(v / 1000).toFixed(1)}k`} />
                  <Tooltip content={<RealeForecastTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="reale"
                    name="Incasso Reale"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#10b981' }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="forecast"
                    name="Previsione"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={{ r: 3, fill: '#a78bfa' }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Tabella forecast */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-4">
              Dettaglio Previsioni
              <span className="ml-2 text-xs font-normal text-gray-400">({tabellaForecast.length} righe)</span>
            </h2>
            {tabellaForecast.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                Nessuna previsione disponibile per i prossimi 7 giorni.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Data</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Sede</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Previsione</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Valutazione</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Meteo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {tabellaForecast.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                          {datIt(r.data_competenza)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            r.sede === 'MA' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'
                          }`}>{r.sede}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-gray-900">
                          {eur(r.previsione_incasso)}
                        </td>
                        <td className="px-3 py-2">
                          {r.valutazione ? (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              r.valutazione.toLowerCase().includes('ottim')  ? 'bg-emerald-100 text-emerald-700' :
                              r.valutazione.toLowerCase().includes('buon')   ? 'bg-sky-100 text-sky-700' :
                              r.valutazione.toLowerCase().includes('scarso') ? 'bg-rose-100 text-rose-600' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {r.valutazione}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 text-gray-600 text-xs">
                          {r.note_meteo ? (
                            <span className="flex items-center gap-1">
                              {r.note_meteo}
                              <MeteoIcon nota={r.note_meteo} />
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Chiusure reali recenti (ultimi 7 gg) */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-4">
              Chiusure Reali Recenti
              <span className="ml-2 text-xs font-normal text-gray-400">ultimi 7 giorni da iPratico</span>
            </h2>
            {chiusure.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                Nessuna chiusura registrata negli ultimi 7 giorni.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Data</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Sede</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Incasso</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Coperti</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Scontrino Medio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {chiusure.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{datIt(r.data)}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            r.sede === 'MA' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'
                          }`}>{r.sede}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-gray-900">
                          {eur(r.totale_venduto_ipratico)}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {r.coperti != null ? Number(r.coperti).toLocaleString('it-IT') : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {eur(r.scontrino_medio)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* PageAssistant */}
      <PageAssistant
        pagina="forecast"
        systemContext={systemContext}
        suggerimenti={[
          'Come sarà il weekend prossimo?',
          'Il sabato è la giornata migliore?',
          'Confronta previsione vs reale',
        ]}
      />
    </div>
  )
}
