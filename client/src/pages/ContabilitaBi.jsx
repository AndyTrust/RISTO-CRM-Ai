import { useState, useEffect, useMemo, useRef } from 'react'
import supabase from '../supabase'
import { fetchPaged } from '../api/paged'
import { fmtEur, fmtPct, useOrdinamento, IconaOrdine, BottoneCsv, NotaCopertura } from '../lib/tabella'
import { useAnniDisponibili } from '../hooks/useAnniDisponibili'
import PageAssistant from '../components/PageAssistant'
import PeriodFilter from '../components/PeriodFilter'
import {
  ComposedChart, Bar, Line, BarChart, Area, AreaChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
  ResponsiveContainer, ReferenceLine
} from 'recharts'
import {
  DollarSign, TrendingDown, TrendingUp, AlertTriangle,
  CheckCircle, XCircle, BarChart2
} from 'lucide-react'

const SEDE_OPTIONS = [
  { value: 'MA', label: 'Mameli (CA)' },
  { value: 'PN', label: 'Predda Niedda (SS)' },
  { value: 'ALL', label: 'Entrambe' },
]

const MESI_LABEL = ['','Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const pad2 = n => String(n).padStart(2, '0')
// Chiave confrontabile "AAAA-MM": è l'unico modo di filtrare un intervallo che
// attraversa il capodanno. Confrontando solo il mese (com'era prima) un range
// dic 2025 → feb 2026 diventava `mese >= 12 && mese <= 2`, cioè zero righe.
const chiaveMese = (anno, mese) => `${anno}-${pad2(mese)}`
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null }
const somma = (righe, campo) => righe.reduce((s, r) => s + (num(r[campo]) ?? 0), 0)

function KpiCard({ icon: Icon, label, value, sub, color = 'indigo', trend }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    green: 'bg-green-50 text-green-600 border-green-100',
    red: 'bg-red-50 text-red-600 border-red-100',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-100',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={18}/>
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs mt-1 opacity-70">{sub}</div>}
      {trend != null && (
        <div className={`text-xs mt-1 font-medium flex items-center gap-0.5 ${trend>=0?'text-green-600':'text-red-500'}`}>
          {trend>=0?<TrendingUp size={12}/>:<TrendingDown size={12}/>} {trend>=0?'+':''}{trend.toFixed(1)}% vs mese prec.
        </div>
      )}
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm max-w-xs">
      <div className="font-semibold text-gray-800 mb-2">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey ?? p.name} className="flex items-center gap-1 text-gray-600 mb-0.5">
          <div className="w-2 h-2 rounded-full" style={{background:p.color}}/>
          {p.name}: <span className="font-medium ml-1" style={{color:p.color}}>
            {p.name?.includes('%') ? fmtPct(p.value) : fmtEur(p.value, { decimali: 0 })}
          </span>
        </div>
      ))}
    </div>
  )
}

function AlertCard({ type, message }) {
  const cfg = {
    danger: { bg: 'bg-red-50 border-red-200', icon: XCircle, iconColor: 'text-red-500', textColor: 'text-red-700' },
    warning: { bg: 'bg-yellow-50 border-yellow-200', icon: AlertTriangle, iconColor: 'text-yellow-500', textColor: 'text-yellow-700' },
    success: { bg: 'bg-green-50 border-green-200', icon: CheckCircle, iconColor: 'text-green-500', textColor: 'text-green-700' },
  }
  const c = cfg[type] || cfg.warning
  const Icon = c.icon
  return (
    <div className={`flex items-start gap-2 p-3 rounded-lg border ${c.bg}`}>
      <Icon size={16} className={`mt-0.5 flex-shrink-0 ${c.iconColor}`}/>
      <span className={`text-sm ${c.textColor}`}>{message}</span>
    </div>
  )
}

export default function ContabilitaBi() {
  const oggiDate = new Date()
  const annoCorrente = oggiDate.getFullYear()

  const [sede, setSede] = useState('MA')
  const [period, setPeriod] = useState('ytd')
  const [dateFrom, setDateFrom] = useState(`${annoCorrente}-01-01`)
  const [dateTo, setDateTo]     = useState(`${annoCorrente}-${pad2(oggiDate.getMonth()+1)}-${pad2(oggiDate.getDate())}`)

  // L'anno NON è più uno stato separato: era la seconda sorgente di verità che,
  // insieme a dateFrom/dateTo, faceva partire due fetch concorrenti a ogni
  // cambio di periodo. Ora la tendina Anno è una scorciatoia che imposta il
  // periodo, e l'anno visualizzato si deriva dalle date.
  const annoFrom = Number(dateFrom.slice(0, 4)) || annoCorrente
  const annoTo   = Number(dateTo.slice(0, 4))   || annoFrom
  const meseFrom = Number(dateFrom.slice(5, 7)) || 1
  const meseTo   = Number(dateTo.slice(5, 7))   || 12
  const chiaveDa = chiaveMese(annoFrom, meseFrom)
  const chiaveA  = chiaveMese(annoTo, meseTo)
  const etichettaAnno = annoFrom === annoTo ? String(annoFrom) : `${annoFrom}–${annoTo}`

  // Anni realmente presenti a DB: la tendina cablata `2024 + i` nascondeva i
  // dati 2019-2023, che a DB ci sono e non erano raggiungibili in alcun modo.
  const { anni: anniDisponibili } = useAnniDisponibili('v_be_mensile', 'anno', { tipo: 'anno' })

  const handlePeriodChange = (pid, d) => {
    setPeriod(pid)
    if (d?.from) setDateFrom(d.from)
    if (d?.to)   setDateTo(d.to)
  }
  const selezionaAnno = (y) => {
    setPeriod('custom')
    setDateFrom(`${y}-01-01`)
    setDateTo(`${y}-12-31`)
  }

  const [mensile, setMensile] = useState([])
  const [forecastData, setForecastData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const richiestaRef = useRef(0)

  useEffect(() => {
    // Guardia di unmount + numero di richiesta: senza, la risposta di una
    // richiesta vecchia può arrivare dopo quella nuova e sovrascriverla.
    let annullato = false
    const mia = ++richiestaRef.current

    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        // v_be_mensile è l'unica vista contabile che esiste davvero a DB.
        // Prima la pagina interrogava anche `v_trend_mensile`, che NON esiste
        // (verificato il 2026-07-25): la query falliva e il tab mostrava
        // "Errore" con tutti i numeri a zero.
        const righe = await fetchPaged(
          () => {
            let q = supabase.from('v_be_mensile').select('*')
              .gte('anno', annoFrom).lte('anno', annoTo)
            if (sede !== 'ALL') q = q.eq('sede', sede)
            return q
          },
          // Poche centinaia di righe (≤ 24 per anno per sede): una sola pagina,
          // quindi l'ordinamento non univoco non può spezzare la paginazione.
          'anno'
        )

        const forecast = await fetchPaged(
          () => {
            let q = supabase.from('revenue_forecast')
              .select('id, sede, data_competenza, previsione_incasso')
              .gte('data_competenza', dateFrom).lte('data_competenza', dateTo)
            if (sede !== 'ALL') q = q.eq('sede', sede)
            return q
          },
          'id'
        )

        if (annullato || mia !== richiestaRef.current) return
        setMensile(righe)
        setForecastData(forecast)
      } catch (e) {
        if (!annullato && mia === richiestaRef.current) {
          setError(e?.message || String(e))
          setMensile([]); setForecastData([])
        }
      } finally {
        if (!annullato && mia === richiestaRef.current) setLoading(false)
      }
    })()

    return () => { annullato = true }
  }, [sede, dateFrom, dateTo, annoFrom, annoTo])

  // Righe del periodo, sommate per mese quando la sede è "Entrambe".
  const chartData = useMemo(() => {
    const map = new Map()
    for (const r of mensile) {
      const k = chiaveMese(r.anno, r.mese)
      if (k < chiaveDa || k > chiaveA) continue
      const prec = map.get(k)
      const base = prec || {
        chiave: k, anno: r.anno, mese: r.mese,
        label: annoFrom === annoTo
          ? (MESI_LABEL[r.mese] || `M${r.mese}`)
          : `${MESI_LABEL[r.mese] || `M${r.mese}`} ${String(r.anno).slice(2)}`,
        fatturato: 0, costi_totali: 0, costo_personale: 0, margine: 0, coperti: 0,
      }
      base.fatturato      += num(r.fatturato) ?? 0
      base.costi_totali   += num(r.costi_totali) ?? 0
      base.costo_personale+= num(r.costo_personale) ?? 0
      base.margine        += num(r.margine) ?? 0
      base.coperti        += num(r.coperti) ?? 0
      map.set(k, base)
    }
    return [...map.values()]
      .sort((a, b) => a.chiave.localeCompare(b.chiave))
      .map(d => ({
        ...d,
        // altri_costi calcolato QUI: prima era passato come prop `data` a una
        // singola <Bar> dentro un ComposedChart che aveva già i suoi dati, e
        // Recharts la ignorava (barra sempre vuota).
        altri_costi: Math.max(0, d.costi_totali - d.costo_personale),
        // % personale su fatturato: null quando non c'è fatturato, così un mese
        // chiuso non finisce nel grafico come "0%".
        pct_personale: d.fatturato > 0 ? (d.costo_personale / d.fatturato) * 100 : null,
        // Un mese senza fatturato E senza costi non è "in pareggio": è vuoto.
        vuoto: d.fatturato === 0 && d.costi_totali === 0,
      }))
  }, [mensile, chiaveDa, chiaveA, annoFrom, annoTo])

  const righeConDati = useMemo(() => chartData.filter(d => !d.vuoto), [chartData])

  const kpis = useMemo(() => {
    if (!righeConDati.length) return {}
    return {
      fatturato: somma(righeConDati, 'fatturato'),
      costi: somma(righeConDati, 'costi_totali'),
      margine: somma(righeConDati, 'margine'),
      mesiUtile: righeConDati.filter(d => d.margine > 0).length,
      mesiPerdita: righeConDati.filter(d => d.margine < 0).length,
      totMesi: righeConDati.length,
    }
  }, [righeConDati])

  const alerts = useMemo(() => {
    const list = []
    righeConDati.forEach(d => {
      if (d.margine < -10000)
        list.push({ type:'danger', message:`${d.label}: perdita di ${fmtEur(d.margine)}` })
      if (d.pct_personale != null && d.pct_personale > 60)
        list.push({ type:'warning', message:`${d.label}: costo personale elevato al ${fmtPct(d.pct_personale)} del fatturato` })
    })
    if (righeConDati.length) {
      const ord = [...righeConDati].sort((a,b) => b.margine - a.margine)
      const best = ord[0], worst = ord[ord.length - 1]
      if (best) list.push({ type:'success', message:`Mese migliore: ${best.label} (${fmtEur(best.margine)})` })
      if (worst?.margine < 0) list.push({ type:'danger', message:`Mese peggiore: ${worst.label} (${fmtEur(worst.margine)})` })
    }
    return list
  }, [righeConDati])

  // ── Proiezione dell'ULTIMO mese con dati (non più giugno cablato) ──────────
  const projection = useMemo(() => {
    const ultimo = righeConDati[righeConDati.length - 1]
    if (!ultimo) return null

    // Giorni reali del mese: `30` fisso sbagliava di 1-2 giorni in 7 mesi su 12.
    const giorniMese = new Date(ultimo.anno, ultimo.mese, 0).getDate()
    const inCorso = ultimo.anno === annoCorrente && ultimo.mese === oggiDate.getMonth() + 1
    const giorniTrascorsi = inCorso ? oggiDate.getDate() : giorniMese

    // Se il mese è in corso, la parte mancante si stima con le previsioni
    // reali (revenue_forecast) quando ci sono, altrimenti in proporzione.
    const restanti = forecastData
      .filter(f => {
        const d = String(f.data_competenza || '')
        return d.slice(0, 7) === chiaveMese(ultimo.anno, ultimo.mese) && Number(d.slice(8, 10)) > giorniTrascorsi
      })
      .reduce((s, f) => s + (num(f.previsione_incasso) ?? 0), 0)

    const proiezione = !inCorso
      ? ultimo.fatturato
      : restanti > 0
        ? ultimo.fatturato + restanti
        : (giorniTrascorsi > 0 ? ultimo.fatturato / giorniTrascorsi * giorniMese : null)

    return {
      mese: ultimo.mese, anno: ultimo.anno, label: ultimo.label,
      inCorso, giorniMese, giorniTrascorsi,
      fonte: !inCorso ? 'mese completo' : restanti > 0 ? 'previsioni revenue_forecast' : 'proporzione sui giorni trascorsi',
      dati: [
        { name: inCorso ? `Actual (${giorniTrascorsi}/${giorniMese} gg)` : 'Actual (mese completo)', value: ultimo.fatturato, fill: '#6366f1' },
        { name: 'Proiezione mese', value: proiezione, fill: '#10b981' },
        { name: 'Break-Even', value: ultimo.costi_totali, fill: '#f59e0b' },
        { name: 'Target +10%', value: proiezione != null ? proiezione * 1.1 : null, fill: '#8b5cf6' },
      ],
    }
  }, [righeConDati, forecastData, annoCorrente, oggiDate])

  // ── Tabella mensile: ordinabile + esportabile ─────────────────────────────
  const { righeOrdinate, colonna, direzione, propsTh } = useOrdinamento(chartData, 'chiave', 'asc')

  const COLONNE_CSV = [
    { chiave: 'anno', etichetta: 'Anno' },
    { chiave: 'mese', etichetta: 'Mese' },
    { chiave: 'label', etichetta: 'Etichetta' },
    { chiave: 'fatturato', etichetta: 'Fatturato' },
    { chiave: 'costi_totali', etichetta: 'Costi totali' },
    { chiave: 'margine', etichetta: 'Margine' },
    { chiave: 'costo_personale', etichetta: 'Costo personale' },
    { chiave: 'pct_personale', etichetta: '% personale su fatturato' },
    { chiave: 'coperti', etichetta: 'Coperti' },
  ]

  const TH = ({ col, children, align = 'left' }) => (
    <th {...propsTh(col)} className={`pb-2 pr-4 font-semibold text-gray-600 cursor-pointer select-none hover:text-gray-900 text-${align}`}>
      {children}<IconaOrdine colonna={col} colonnaAttiva={colonna} direzione={direzione} />
    </th>
  )

  const systemContext = useMemo(() => ({
    sede, periodo: `${dateFrom} → ${dateTo}`,
    fatturatoPeriodo: kpis.fatturato,
    costiPeriodo: kpis.costi,
    marginePeriodo: kpis.margine,
    mesiUtile: kpis.mesiUtile,
    mesiPerdita: kpis.mesiPerdita,
    totMesi: kpis.totMesi,
    alerts: alerts.length,
  }), [sede, dateFrom, dateTo, kpis, alerts])

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart2 className="text-green-600" size={26}/>
          Contabilità &amp; Analisi Finanziaria
        </h1>
        <p className="text-gray-500 text-sm mt-1">Fatturato, costi, margine, break-even — andamento mensile · fonte <code>v_be_mensile</code></p>
      </div>

      {/* FILTRI — componente periodo condiviso */}
      <div className="mb-6">
        <PeriodFilter period={period} dates={{ from: dateFrom, to: dateTo }} onChange={handlePeriodChange}
          extra={
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Sede</label>
                <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={sede} onChange={e=>setSede(e.target.value)}>
                  {SEDE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Anno intero</label>
                <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={annoFrom === annoTo ? annoFrom : ''}
                  onChange={e => e.target.value && selezionaAnno(Number(e.target.value))}>
                  {annoFrom !== annoTo && <option value="">{etichettaAnno}</option>}
                  {anniDisponibili.map(y=><option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </>
          } />
      </div>

      {/* KPI CARDS */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_,i)=><div key={`skel-${i}`} className="bg-white rounded-xl border p-4 h-24 animate-pulse"/>)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard icon={TrendingUp} label={`Fatturato ${etichettaAnno}`} color="indigo"
            value={fmtEur(kpis.fatturato)}
            sub={`${kpis.totMesi||0} mesi con dati`}/>
          <KpiCard icon={DollarSign} label={`Costi ${etichettaAnno}`} color="yellow"
            value={fmtEur(kpis.costi)}
            sub="totale costi"/>
          <KpiCard icon={(kpis.margine||0)>=0?TrendingUp:TrendingDown} label={`Margine ${etichettaAnno}`}
            color={(kpis.margine||0)>=0?'green':'red'}
            value={fmtEur(kpis.margine)}
            sub={kpis.fatturato ? `${fmtPct(kpis.margine/kpis.fatturato*100)} del fatturato` : '— del fatturato'}/>
          <KpiCard icon={CheckCircle} label="Mesi in utile/perdita"
            color={(kpis.mesiPerdita||0)>0?'red':'green'}
            value={kpis.totMesi ? `${kpis.mesiUtile} / ${kpis.mesiPerdita}` : '—'}
            sub="utile / perdita"/>
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">Errore: {error}</div>}

      {/* COMPOSED CHART FATTURATO VS COSTI */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <BarChart2 size={16} className="text-green-500"/> Fatturato vs Costi vs Margine per Mese
        </h2>
        {chartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <BarChart2 size={36} className="mb-2 opacity-40"/><p className="text-sm">Nessun dato disponibile</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{top:10,right:40,left:10,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="label" fontSize={11}/>
              <YAxis yAxisId="left" fontSize={11} tickFormatter={v=>`€${(v/1000).toFixed(0)}k`}/>
              <YAxis yAxisId="right" orientation="right" fontSize={11} tickFormatter={v=>`€${(v/1000).toFixed(0)}k`}/>
              <Tooltip content={<CustomTooltip/>}/>
              <Legend/>
              <Bar yAxisId="left" dataKey="costo_personale" name="Costo Personale" stackId="costi" fill="#f59e0b" opacity={0.85}/>
              <Bar yAxisId="left" dataKey="altri_costi" name="Altri Costi" stackId="costi" fill="#ef4444" opacity={0.7}/>
              <Line yAxisId="right" type="monotone" dataKey="fatturato" name="Fatturato" stroke="#6366f1" strokeWidth={2.5} dot={{r:4}}/>
              <Line yAxisId="right" type="monotone" dataKey="margine" name="Margine"
                stroke="#10b981" strokeWidth={2} dot={{r:3}} strokeDasharray="6 3"/>
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* % COSTO PERSONALE */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <TrendingUp size={16} className="text-green-500"/> % Costo Personale su Fatturato
        </h2>
        <p className="text-xs text-gray-400 mb-4">I mesi senza fatturato non compaiono: una percentuale su base zero non è "0%", è indefinita.</p>
        {chartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400">
            <TrendingUp size={32} className="mb-2 opacity-40"/><p className="text-sm">Nessun dato</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{top:10,right:30,left:0,bottom:0}}>
              <defs>
                <linearGradient id="gradPersonale" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="label" fontSize={11}/>
              <YAxis fontSize={11} tickFormatter={v=>`${v}%`} domain={[0,'auto']}/>
              <Tooltip formatter={v=>fmtPct(v)}/>
              <ReferenceLine y={55} stroke="#ef4444" strokeDasharray="4 3" label={{value:'55% soglia',fontSize:10,fill:'#ef4444',position:'insideTopRight'}}/>
              <ReferenceLine y={45} stroke="#22c55e" strokeDasharray="4 3" label={{value:'45% target',fontSize:10,fill:'#22c55e',position:'insideTopRight'}}/>
              <Area type="monotone" dataKey="pct_personale" name="% Personale" stroke="#f59e0b" connectNulls={false}
                fill="url(#gradPersonale)" strokeWidth={2} dot={{r:4,fill:'#f59e0b'}}/>
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* PROIEZIONE — ultimo mese con dati, non più giugno cablato */}
      {projection && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
            <TrendingUp size={16} className="text-green-500"/> Proiezione {MESI_LABEL[projection.mese]} {projection.anno}
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            {projection.giorniTrascorsi}/{projection.giorniMese} giorni · base: {projection.fonte}
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={projection.dati} margin={{top:10,right:30,left:10,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false}/>
              <XAxis dataKey="name" fontSize={11}/>
              <YAxis fontSize={11} tickFormatter={v=>`€${(v/1000).toFixed(0)}k`}/>
              <Tooltip formatter={v=>fmtEur(v)}/>
              <Bar dataKey="value" name="Valore" radius={[4,4,0,0]}>
                {projection.dati.map(entry=><Cell key={entry.name} fill={entry.fill}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ALERT FINANZIARI */}
      {alerts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <AlertTriangle size={16} className="text-orange-500"/> Alert Finanziari
          </h2>
          <div className="space-y-2">
            {alerts.map(a=><AlertCard key={`${a.type}-${a.message}`} type={a.type} message={a.message}/>)}
          </div>
        </div>
      )}

      {/* TABELLA MESI */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <BarChart2 size={16} className="text-green-500"/> Riepilogo Mensile {etichettaAnno}
            </h2>
            <NotaCopertura righe={chartData.length} da={dateFrom} a={dateTo} fonte="v_be_mensile"
              extra={sede === 'ALL' ? 'MA + PN sommate' : `sede ${sede}`} />
          </div>
          <BottoneCsv righe={righeOrdinate} colonne={COLONNE_CSV} nomeFile={`contabilita_${sede}_${etichettaAnno}`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <TH col="chiave">Mese</TH>
                <TH col="fatturato">Fatturato</TH>
                <TH col="costi_totali">Costi Totali</TH>
                <TH col="margine">Margine</TH>
                <TH col="costo_personale">Costo Pers.</TH>
                <TH col="pct_personale">% Personale</TH>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Stato</th>
              </tr>
            </thead>
            <tbody>
              {righeOrdinate.map(row=>(
                <tr key={row.chiave} className={`border-b border-gray-50 hover:bg-gray-50 ${
                  row.vuoto ? 'text-gray-400' : row.margine < 0 ? 'bg-red-50/30' : ''}`}>
                  <td className="py-2 pr-4 font-medium text-gray-800">{row.label}</td>
                  <td className="py-2 pr-4">{row.vuoto ? '—' : fmtEur(row.fatturato)}</td>
                  <td className="py-2 pr-4 text-gray-600">{row.vuoto ? '—' : fmtEur(row.costi_totali)}</td>
                  <td className="py-2 pr-4">
                    {row.vuoto ? '—' : (
                      <span className={`font-semibold ${row.margine>=0?'text-green-600':'text-red-600'}`}>
                        {fmtEur(row.margine)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-gray-600">{row.vuoto ? '—' : fmtEur(row.costo_personale)}</td>
                  <td className="py-2 pr-4">
                    {row.pct_personale == null ? <span className="text-gray-400">—</span> : (
                      <span className={`font-semibold ${row.pct_personale>55?'text-red-600':row.pct_personale>45?'text-orange-500':'text-green-600'}`}>
                        {fmtPct(row.pct_personale)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {/* Un mese senza dati NON è "Utile": prima ogni cella usava
                        `|| 0` e `margine >= 0`, così un mese vuoto compariva in
                        verde con costi €0,00. */}
                    {row.vuoto ? (
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-gray-100 text-gray-500">Nessun dato</span>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${row.margine>=0?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>
                        {row.margine>=0?'Utile':'Perdita'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {chartData.length===0&&(
                <tr><td colSpan={7} className="py-12 text-center text-gray-400">
                  <BarChart2 size={32} className="mx-auto mb-2 opacity-40"/>Nessun dato disponibile
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PageAssistant pageId="contabilita-bi" systemContext={systemContext}
        suggestions={[
          "Analizza i mesi in perdita del periodo selezionato",
          "Qual è il break-even mensile di Mameli?",
          "Come stanno andando i costi del personale?",
          "Proiezione fine anno a questo ritmo?",
        ]}/>
    </div>
  )
}
