/**
 * ForecastPage.jsx — Revenue Forecast & Confronto Reale
 * Previsioni incasso per MA e PN, confronto con chiusure giornaliere reali.
 */
import React, { useEffect, useState, useMemo, useRef } from 'react'
import supabase from '../supabase'
import { fetchPaged } from '../api/paged'
import { useOrdinamento, IconaOrdine, BottoneCsv, NotaCopertura } from '../lib/tabella'
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
import PeriodFilter from '../components/PeriodFilter'
import AiAdvisor from '../components/AiAdvisor'

// ── Helpers ─────────────────────────────────────────────────────────────────
const SEDE_OPTS = [
  { value: 'all', label: 'Entrambe' },
  { value: 'MA',  label: 'Mameli (MA)' },
  { value: 'PN',  label: 'Predda Niedda (PN)' },
]

// Il grafico reale-vs-forecast non può disegnare anni di punti giornalieri.
// Il limite ESISTE, quindi va dichiarato: quando il periodo è più lungo il
// grafico mostra gli ULTIMI giorni e la pagina lo scrive. Prima il troncamento
// era muto (`guard < 366`) mentre la query leggeva tutto: grafico e tabella
// raccontavano due periodi diversi senza dirlo.
const MAX_GIORNI_GRAFICO = 400

const pad = x => String(x).padStart(2, '0')
// Mai `toISOString()`: converte in UTC e di sera, in fuso italiano, "oggi"
// diventa ieri. Formattazione locale con pad manuale.
const isoLocale = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

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
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}

// Prossimi N giorni a partire da `da`
function nextNDays(n, da) {
  const days = []
  for (let i = 0; i < n; i++) {
    const d = new Date(da + 'T12:00:00')
    d.setDate(d.getDate() + i)
    days.push(isoLocale(d))
  }
  return days
}

// Ultimi N giorni (incluso `a`)
function lastNDays(n, a) {
  const days = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(a + 'T12:00:00')
    d.setDate(d.getDate() - i)
    days.push(isoLocale(d))
  }
  return days
}

/** "Oggi" che si aggiorna davvero: ricalcolato al focus della finestra e ogni minuto. */
function useOggi() {
  const [oggi, setOggi] = useState(() => isoLocale(new Date()))
  useEffect(() => {
    const aggiorna = () => setOggi(prec => {
      const ora = isoLocale(new Date())
      return ora === prec ? prec : ora   // stessa stringa = nessun re-render
    })
    const t = setInterval(aggiorna, 60_000)
    window.addEventListener('focus', aggiorna)
    document.addEventListener('visibilitychange', aggiorna)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', aggiorna)
      document.removeEventListener('visibilitychange', aggiorna)
    }
  }, [])
  return oggi
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

// ── Tooltip condiviso (forecast e reale-vs-forecast) ─────────────────────────
function SerieTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-semibold text-gray-800 mb-1">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey ?? p.name} className="flex items-center gap-2">
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
  const richiestaRef = useRef(0)

  // "Oggi" vivo: con `useMemo(..., [])` la pagina restava ferma al giorno in
  // cui era stata aperta (in una dashboard lasciata aperta la notte, "oggi"
  // continuava a indicare ieri).
  const oggiIso = useOggi()
  const nextDays = useMemo(() => nextNDays(7, oggiIso), [oggiIso])

  // Periodo storico personalizzabile (default: ultimi 7 giorni incluso oggi)
  const defaultLast = useMemo(() => lastNDays(7, oggiIso), [oggiIso])
  const [histPeriod, setHistPeriod] = useState('last7')
  const [histFrom, setHistFrom] = useState(defaultLast[0])
  const [histTo, setHistTo]     = useState(defaultLast[defaultLast.length - 1])
  const handleHistChange = (pid, d) => { setHistPeriod(pid); if (d?.from) setHistFrom(d.from); if (d?.to) setHistTo(d.to) }

  const periodoValido = histFrom && histTo && histFrom <= histTo
  const daStorico = periodoValido ? histFrom : defaultLast[0]
  const aStorico  = periodoValido ? histTo   : defaultLast[defaultLast.length - 1]

  // Giorni del grafico: gli ULTIMI MAX_GIORNI_GRAFICO del periodo richiesto.
  const { giorniGrafico, troncato } = useMemo(() => {
    const giorni = []
    const d = new Date(daStorico + 'T12:00:00')
    const end = new Date(aStorico + 'T12:00:00')
    while (d <= end) { giorni.push(isoLocale(d)); d.setDate(d.getDate() + 1) }
    if (giorni.length <= MAX_GIORNI_GRAFICO) return { giorniGrafico: giorni, troncato: false }
    return { giorniGrafico: giorni.slice(-MAX_GIORNI_GRAFICO), troncato: true }
  }, [daStorico, aStorico])

  // Carica dati
  useEffect(() => {
    // Guardia di unmount + numero di richiesta: senza, la risposta di una
    // richiesta vecchia può sovrascrivere quella nuova.
    let annullato = false
    const mia = ++richiestaRef.current

    setLoading(true)
    setError(null)

    const fromF = nextDays[0]
    const toF   = nextDays[nextDays.length - 1]

    ;(async () => {
      try {
        // `.range()`/`.limit()` non bypassano il cap di 1000 righe del server:
        // con un periodo storico ampio (selezionabile dall'utente) le chiusure
        // si fermavano in silenzio alle prime 1000 righe in ordine di data,
        // cioè perdendo proprio i giorni più recenti.
        const [fData, cData] = await Promise.all([
          fetchPaged(() => {
            // `revenue_forecast` è abbandonata: 20 righe ferme al 24/06/2026,
            // per questo la pagina risultava vuota. Il job notturno
            // `genera-forecast-personale` scrive su `forecast_giornaliero`, che
            // arriva a due settimane avanti; v_forecast_giornaliero ne aggrega
            // i turni sulla giornata mantenendo gli stessi nomi di colonna.
            let q = supabase.from('v_forecast_giornaliero')
              .select('id, sede, data_competenza, previsione_incasso, previsione_coperti, staff_previsto, costo_lavoro, costo_lavoro_pct, confidence, valutazione, note_meteo, aggiornato_il')
              .gte('data_competenza', fromF).lte('data_competenza', toF)
            if (sede !== 'all') q = q.eq('sede', sede)
            return q
          }, 'id'),
          fetchPaged(() => {
            let q = supabase.from('chiusure_giornaliere')
              .select('id, sede, data, totale_venduto_ipratico, coperti, scontrino_medio')
              .gte('data', daStorico).lte('data', aStorico)
            if (sede !== 'all') q = q.eq('sede', sede)
            return q
          }, 'id'),
        ])

        if (annullato || mia !== richiestaRef.current) return
        setForecast(fData)
        setChiusure(cData)
      } catch (e) {
        if (!annullato && mia === richiestaRef.current) {
          setError(e?.message || String(e))
          setForecast([]); setChiusure([])
        }
      } finally {
        if (!annullato && mia === richiestaRef.current) setLoading(false)
      }
    })()

    return () => { annullato = true }
  }, [sede, nextDays, daStorico, aStorico])

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
        MA:   ma ? Number(ma.previsione_incasso) || 0 : null,
        PN:   pn ? Number(pn.previsione_incasso) || 0 : null,
        totale: righe.length
          ? righe.reduce((s, r) => s + (Number(r.previsione_incasso) || 0), 0)
          : null,
      }
    })
  }, [forecast, nextDays])

  // ── Dati LineChart reale vs forecast ─────────────────────────────────────
  const lineData = useMemo(() => {
    return giorniGrafico.map(data => {
      const cRighe = chiusure.filter(r => r.data === data)
      const fRighe = forecast.filter(r => r.data_competenza === data)
      return {
        data:   datShort(data),
        // Un giorno di chiusura REALE a €0 è un dato, non un buco: con
        // `reale || undefined` veniva disegnato come mancante e la linea ci
        // passava sopra interpolando, nascondendo la giornata a zero.
        reale:    cRighe.length ? cRighe.reduce((s, r) => s + (Number(r.totale_venduto_ipratico) || 0), 0) : null,
        forecast: fRighe.length ? fRighe.reduce((s, r) => s + (Number(r.previsione_incasso) || 0), 0) : null,
      }
    })
  }, [chiusure, forecast, giorniGrafico])

  // ── Tabella forecast ────────────────────────────────────────────────────
  const tabellaForecast = useMemo(() => {
    return [...forecast].sort((a, b) => {
      if (a.data_competenza < b.data_competenza) return -1
      if (a.data_competenza > b.data_competenza) return  1
      return (a.sede || '').localeCompare(b.sede || '')
    })
  }, [forecast])

  const ordForecast = useOrdinamento(tabellaForecast, 'data_competenza', 'asc')
  const chiusureOrdinabili = useMemo(
    () => [...chiusure].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : (a.sede || '').localeCompare(b.sede || ''))),
    [chiusure]
  )
  const ordChiusure = useOrdinamento(chiusureOrdinabili, 'data', 'desc')

  const COLONNE_FORECAST = [
    { chiave: 'data_competenza', etichetta: 'Data' },
    { chiave: 'sede', etichetta: 'Sede' },
    { chiave: 'previsione_incasso', etichetta: 'Previsione' },
    { chiave: 'valutazione', etichetta: 'Valutazione' },
    { chiave: 'note_meteo', etichetta: 'Meteo' },
  ]
  const COLONNE_CHIUSURE = [
    { chiave: 'data', etichetta: 'Data' },
    { chiave: 'sede', etichetta: 'Sede' },
    { chiave: 'totale_venduto_ipratico', etichetta: 'Incasso' },
    { chiave: 'coperti', etichetta: 'Coperti' },
    { chiave: 'scontrino_medio', etichetta: 'Scontrino medio' },
  ]

  const Th = ({ ord, col, children, align = 'left' }) => (
    <th {...ord.propsTh(col)}
      className={`px-3 py-2 text-${align} text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-800`}>
      {children}<IconaOrdine colonna={col} colonnaAttiva={ord.colonna} direzione={ord.direzione} />
    </th>
  )

  // ── systemContext per PageAssistant ──────────────────────────────────────
  const systemContext = useMemo(() => {
    return `Pagina: Revenue Forecast
Sede: ${sede === 'all' ? 'Entrambe (MA + PN)' : sede}
KPI previsioni:
- Oggi (${datIt(oggi)}): ${eur(kpi.oggi)}
- Domani (${datIt(domani)}): ${eur(kpi.domani)}
- Totale settimana (7 giorni): ${eur(kpi.settimana)}
Righe forecast: ${forecast.length}
Periodo storico confrontato: ${daStorico} → ${aStorico}
Chiusure reali nel periodo: ${chiusure.length}
Giornate con nota meteo: ${forecast.filter(r => r.note_meteo).length}
Valutazioni disponibili: ${[...new Set(forecast.filter(r => r.valutazione).map(r => r.valutazione))].join(', ') || 'nessuna'}`
  }, [kpi, sede, oggi, domani, forecast, chiusure, daStorico, aStorico])

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

      {/* Filtro periodo storico — componente condiviso */}
      <PeriodFilter period={histPeriod} dates={{ from: histFrom, to: histTo }} onChange={handleHistChange}
        extra={<span className="text-xs text-gray-400 pb-2.5">Confronto previsioni vs reale sul periodo · previsioni future: prossimi 7 giorni</span>} />

      {!periodoValido && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-2 text-xs">
          <AlertCircle size={14} /> Intervallo non valido (Dal &gt; Al): mostro gli ultimi 7 giorni.
        </div>
      )}

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
                  <Tooltip content={<SerieTooltip />} />
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

          {/* LineChart reale vs forecast */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-1">
              Incasso Reale vs Forecast — {giorniGrafico[0]} → {giorniGrafico[giorniGrafico.length - 1]}
            </h2>
            <p className="text-xs text-gray-400 mb-1">
              Confronto tra chiusure reali (iPratico) e previsioni · le giornate senza chiusura restano interrotte, quelle chiuse a €0 sono disegnate a zero
            </p>
            {troncato && (
              <p className="text-[11px] text-amber-600 font-medium mb-3">
                ⚠ Periodo più lungo di {MAX_GIORNI_GRAFICO} giorni: il grafico mostra solo gli ultimi {MAX_GIORNI_GRAFICO}. La tabella qui sotto contiene invece tutto il periodo ({chiusure.length} righe).
              </p>
            )}
            {lineData.every(d => d.reale == null && d.forecast == null) ? (
              <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
                Nessun dato disponibile per il confronto.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={lineData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="data" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `€${(v / 1000).toFixed(1)}k`} />
                  <Tooltip content={<SerieTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="reale"
                    name="Incasso Reale"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: '#10b981' }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="forecast"
                    name="Previsione"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={{ r: 2, fill: '#a78bfa' }}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Tabella forecast */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
              <div>
                <h2 className="text-sm font-bold text-gray-800">Dettaglio Previsioni</h2>
                <NotaCopertura righe={tabellaForecast.length} da={nextDays[0]} a={nextDays[nextDays.length - 1]} fonte="revenue_forecast" />
              </div>
              <BottoneCsv righe={ordForecast.righeOrdinate} colonne={COLONNE_FORECAST} nomeFile={`forecast_${sede}`} />
            </div>
            {tabellaForecast.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                Nessuna previsione disponibile per i prossimi 7 giorni.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <Th ord={ordForecast} col="data_competenza">Data</Th>
                      <Th ord={ordForecast} col="sede">Sede</Th>
                      <Th ord={ordForecast} col="previsione_incasso" align="right">Previsione</Th>
                      <Th ord={ordForecast} col="valutazione">Valutazione</Th>
                      <Th ord={ordForecast} col="note_meteo">Meteo</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {ordForecast.righeOrdinate.map(r => (
                      <tr key={`${r.data_competenza}-${r.sede}`} className="hover:bg-gray-50 transition-colors">
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

          {/* Chiusure reali del periodo */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
              <div>
                <h2 className="text-sm font-bold text-gray-800">Chiusure Reali</h2>
                <NotaCopertura righe={chiusure.length} da={daStorico} a={aStorico} fonte="chiusure_giornaliere (iPratico)" />
              </div>
              <BottoneCsv righe={ordChiusure.righeOrdinate} colonne={COLONNE_CHIUSURE} nomeFile={`chiusure_${sede}`} />
            </div>
            {chiusure.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                Nessuna chiusura registrata nel periodo selezionato.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <Th ord={ordChiusure} col="data">Data</Th>
                      <Th ord={ordChiusure} col="sede">Sede</Th>
                      <Th ord={ordChiusure} col="totale_venduto_ipratico" align="right">Incasso</Th>
                      <Th ord={ordChiusure} col="coperti" align="right">Coperti</Th>
                      <Th ord={ordChiusure} col="scontrino_medio" align="right">Scontrino Medio</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {ordChiusure.righeOrdinate.map(r => (
                      <tr key={`${r.data}-${r.sede}`} className="hover:bg-gray-50 transition-colors">
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

      {/* Consiglio AI taglia/spingi sul forecast */}
      <div className="mt-5">
        <AiAdvisor
          title="Consiglio AI sul forecast"
          hint="previsioni incassi prossimi 7 giorni + dati operativi"
          ctaIdle="Dove tagliare e dove spingere"
          system={[
            'Sei il controller finanziario di "140 Grammi" (ristoranti Mameli=MA e Predda Niedda=PN, Sassari).',
            'Ricevi (1) il contesto operativo reale e (2) le previsioni di incasso dei prossimi giorni per sede.',
            'Compito: dato il forecast, indicare azioni concrete sui prossimi giorni. Rispondi in italiano, conciso, senza preamboli, in markdown con queste sezioni:',
            '## ✂️ Dove tagliare',
            'Giorni/turni/sedi con incasso previsto basso rispetto ai costi: dove ridurre personale/acquisti, sempre citando i numeri forniti.',
            '## 🚀 Dove spingere',
            'Giorni/sedi con previsione alta o margine migliore: dove concentrare promozioni, prenotazioni, staff. Cita i numeri.',
            '## ⚠️ Rischi',
            'Anomalie o dati mancanti nel forecast. Non inventare numeri: usa solo quelli forniti; se un dato manca, segnalalo.',
          ].join('\n')}
          buildUserMessage={async () => {
            const righe = (forecast || []).map(r =>
              `${r.data_competenza} ${r.sede}: €${Math.round(Number(r.previsione_incasso) || 0)}${r.valutazione ? ` (${r.valutazione})` : ''}${r.note_meteo ? ` [${r.note_meteo}]` : ''}`
            ).join('\n')
            return `### Previsioni incasso prossimi giorni (per sede)\n${righe || '(nessuna previsione disponibile)'}\n\n` +
              `### Sintesi\nOggi: ${kpi?.oggi ?? '—'} · Domani: ${kpi?.domani ?? '—'} · Settimana: ${kpi?.settimana ?? '—'}`
          }}
        />
      </div>

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
