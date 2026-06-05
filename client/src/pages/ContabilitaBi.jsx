import { useState, useEffect, useMemo } from 'react'
import supabase from '../supabase'
import PageAssistant from '../components/PageAssistant'
import PeriodFilter from '../components/PeriodFilter'
import {
  ComposedChart, Bar, Line, BarChart, LineChart, Area, AreaChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
  ResponsiveContainer, ReferenceLine
} from 'recharts'
import {
  DollarSign, TrendingDown, TrendingUp, AlertTriangle,
  CheckCircle, XCircle, Filter, BarChart2
} from 'lucide-react'

const SEDE_OPTIONS = [
  { value: 'MA', label: 'Mameli (CA)' },
  { value: 'PN', label: 'Predda Niedda (SS)' },
  { value: 'ALL', label: 'Entrambe' },
]

const MESI_LABEL = ['','Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']

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
      {payload.map((p,i)=>(
        <div key={i} className="flex items-center gap-1 text-gray-600 mb-0.5">
          <div className="w-2 h-2 rounded-full" style={{background:p.color}}/>
          {p.name}: <span className="font-medium ml-1" style={{color:p.color}}>
            {typeof p.value === 'number' && p.name?.includes('%')
              ? `${p.value.toFixed(1)}%`
              : typeof p.value === 'number'
                ? p.value.toLocaleString('it-IT',{style:'currency',currency:'EUR'})
                : p.value}
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
  const now = new Date()
  const [sede, setSede] = useState('MA')
  const [anno, setAnno] = useState(now.getFullYear())
  // Filtro periodo Dal/Al (default: anno intero) — filtra i mesi client-side
  const pad2 = n => String(n).padStart(2,'0')
  const [period, setPeriod] = useState('ytd')
  const [dateFrom, setDateFrom] = useState(`${now.getFullYear()}-01-01`)
  const [dateTo, setDateTo]     = useState(`${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`)
  const handlePeriodChange = (pid, d) => {
    setPeriod(pid)
    if (d?.from) { setDateFrom(d.from); const y = Number(d.from.split('-')[0]); if (y) setAnno(y) }
    if (d?.to) setDateTo(d.to)
  }
  const meseFrom = Number((dateFrom||'').split('-')[1]) || 1
  const meseTo   = Number((dateTo||'').split('-')[1]) || 12
  const [trendData, setTrendData] = useState([])
  const [beData, setBeData] = useState([])
  const [forecastData, setForecastData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { fetchData() }, [sede, anno, dateFrom, dateTo])

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      let q = supabase.from('v_trend_mensile').select('*').eq('anno', anno)
      if (sede !== 'ALL') q = q.eq('sede', sede)
      const { data: rows, error: err } = await q.order('mese')
      if (err) throw err
      setTrendData((rows || []).filter(r => r.mese >= meseFrom && r.mese <= meseTo))

      let qb = supabase.from('v_be_mensile').select('*').eq('anno', anno)
      if (sede !== 'ALL') qb = qb.eq('sede', sede)
      const { data: beRows } = await qb.order('mese')
      setBeData((beRows || []).filter(r => r.mese >= meseFrom && r.mese <= meseTo))

      let qf = supabase.from('revenue_forecast').select('*')
        .gte('data_competenza', dateFrom || `${anno}-01-01`)
        .lte('data_competenza', dateTo || `${anno}-12-31`)
      if (sede !== 'ALL') qf = qf.eq('sede', sede)
      const { data: fRows } = await qf.order('data_competenza')
      setForecastData(fRows || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const kpis = useMemo(() => {
    if (!trendData.length) return {}
    const fatturato = trendData.reduce((s,d)=>s+(d.fatturato||0),0)
    const costi = trendData.reduce((s,d)=>s+(d.costi_totali||0),0)
    const margine = trendData.reduce((s,d)=>s+(d.margine||0),0)
    const mesiUtile = trendData.filter(d=>(d.margine||0)>0).length
    const mesiPerdita = trendData.filter(d=>(d.margine||0)<0).length
    return { fatturato, costi, margine, mesiUtile, mesiPerdita, totMesi: trendData.length }
  }, [trendData])

  const chartData = useMemo(() => {
    // merge trend + be per mese
    const map = {}
    trendData.forEach(d => {
      const k = d.mese
      map[k] = { ...d, label: MESI_LABEL[d.mese]||`M${d.mese}` }
    })
    beData.forEach(d => {
      if (!map[d.mese]) map[d.mese] = { mese: d.mese, label: MESI_LABEL[d.mese]||`M${d.mese}` }
      map[d.mese] = { ...map[d.mese], ...d }
    })
    return Object.values(map).sort((a,b)=>a.mese-b.mese)
  }, [trendData, beData])

  const alerts = useMemo(() => {
    const list = []
    trendData.forEach(d => {
      if ((d.margine||0) < -10000)
        list.push({ type:'danger', message:`${MESI_LABEL[d.mese]}: perdita di ${d.margine.toLocaleString('it-IT',{style:'currency',currency:'EUR'})}` })
      if ((d.pct_personale_su_fatt||0) > 60)
        list.push({ type:'warning', message:`${MESI_LABEL[d.mese]}: costo personale elevato al ${(d.pct_personale_su_fatt||0).toFixed(1)}% del fatturato` })
    })
    if (trendData.length) {
      const best = [...trendData].sort((a,b)=>(b.margine||0)-(a.margine||0))[0]
      const worst = [...trendData].sort((a,b)=>(a.margine||0)-(b.margine||0))[0]
      if (best?.mese) list.push({ type:'success', message:`Mese migliore: ${MESI_LABEL[best.mese]} (${(best.margine||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})})` })
      if (worst?.margine < 0) list.push({ type:'danger', message:`Mese peggiore: ${MESI_LABEL[worst.mese]} (${(worst.margine||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})})` })
    }
    return list
  }, [trendData])

  // Proiezione giugno
  const projectionData = useMemo(() => {
    const mese6 = trendData.find(d=>d.mese===6)
    const giornoOggi = now.getDate()
    const giorniMese = 30
    const actuale = mese6?.fatturato || 0
    const proiezione = giornoOggi > 0 ? actuale / giornoOggi * giorniMese : 0
    const be = mese6?.costi_totali || (beData.find(d=>d.mese===6)?.costi_totali || 0)
    const target = proiezione * 1.1
    return [
      { name: 'Actual (partial)', value: actuale, fill: '#6366f1' },
      { name: 'Proiezione mese', value: proiezione, fill: '#10b981' },
      { name: 'Break-Even', value: be, fill: '#f59e0b' },
      { name: 'Target +10%', value: target, fill: '#8b5cf6' },
    ]
  }, [trendData, beData])

  const systemContext = useMemo(() => ({
    sede, anno,
    fatturatoYTD: kpis.fatturato,
    costiYTD: kpis.costi,
    margineYTD: kpis.margine,
    mesiUtile: kpis.mesiUtile,
    mesiPerdita: kpis.mesiPerdita,
    totMesi: kpis.totMesi,
    alerts: alerts.length,
  }), [sede, anno, kpis, alerts])

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart2 className="text-green-600" size={26}/>
          Contabilità &amp; Analisi Finanziaria
        </h1>
        <p className="text-gray-500 text-sm mt-1">Fatturato, costi, margine, break-even — andamento mensile</p>
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Anno</label>
                <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={anno} onChange={e=>setAnno(Number(e.target.value))}>
                  {[2024,2025,2026].map(y=><option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </>
          } />
      </div>

      {/* KPI CARDS */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_,i)=><div key={i} className="bg-white rounded-xl border p-4 h-24 animate-pulse"/>)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard icon={TrendingUp} label="Fatturato YTD" color="indigo"
            value={(kpis.fatturato||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}
            sub={`${kpis.totMesi||0} mesi`}/>
          <KpiCard icon={DollarSign} label="Costi YTD" color="yellow"
            value={(kpis.costi||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}
            sub="totale costi"/>
          <KpiCard icon={(kpis.margine||0)>=0?TrendingUp:TrendingDown} label="Margine YTD"
            color={(kpis.margine||0)>=0?'green':'red'}
            value={(kpis.margine||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}
            sub={`${((kpis.margine||0)/(kpis.fatturato||1)*100).toFixed(1)}% del fatturato`}/>
          <KpiCard icon={CheckCircle} label="Mesi in utile/perdita"
            color={(kpis.mesiPerdita||0)>0?'red':'green'}
            value={`${kpis.mesiUtile||0} / ${kpis.mesiPerdita||0}`}
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
              <Bar yAxisId="left" dataKey="altri_costi" name="Altri Costi" stackId="costi" fill="#ef4444" opacity={0.7}
                data={chartData.map(d=>({...d, altri_costi:(d.costi_totali||0)-(d.costo_personale||0)}))}/>
              <Line yAxisId="right" type="monotone" dataKey="fatturato" name="Fatturato" stroke="#6366f1" strokeWidth={2.5} dot={{r:4}}/>
              <Line yAxisId="right" type="monotone" dataKey="margine" name="Margine"
                stroke="#10b981" strokeWidth={2} dot={{r:3}} strokeDasharray="6 3"/>
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* % COSTO PERSONALE */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-green-500"/> % Costo Personale su Fatturato
        </h2>
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
              <YAxis fontSize={11} tickFormatter={v=>`${v}%`} domain={[0,80]}/>
              <Tooltip formatter={v=>`${Number(v).toFixed(1)}%`}/>
              <ReferenceLine y={55} stroke="#ef4444" strokeDasharray="4 3" label={{value:'55% soglia',fontSize:10,fill:'#ef4444',position:'insideTopRight'}}/>
              <ReferenceLine y={45} stroke="#22c55e" strokeDasharray="4 3" label={{value:'45% target',fontSize:10,fill:'#22c55e',position:'insideTopRight'}}/>
              <Area type="monotone" dataKey="pct_personale_su_fatt" name="% Personale" stroke="#f59e0b"
                fill="url(#gradPersonale)" strokeWidth={2} dot={{r:4,fill:'#f59e0b'}}/>
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* PROIEZIONE GIUGNO */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-green-500"/> Proiezione Giugno {anno}
        </h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={projectionData} margin={{top:10,right:30,left:10,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false}/>
            <XAxis dataKey="name" fontSize={11}/>
            <YAxis fontSize={11} tickFormatter={v=>`€${(v/1000).toFixed(0)}k`}/>
            <Tooltip formatter={v=>v.toLocaleString('it-IT',{style:'currency',currency:'EUR'})}/>
            <Bar dataKey="value" name="Valore" radius={[4,4,0,0]}>
              {projectionData.map((entry,i)=><Cell key={i} fill={entry.fill}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ALERT FINANZIARI */}
      {alerts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <AlertTriangle size={16} className="text-orange-500"/> Alert Finanziari
          </h2>
          <div className="space-y-2">
            {alerts.map((a,i)=><AlertCard key={i} type={a.type} message={a.message}/>)}
          </div>
        </div>
      )}

      {/* TABELLA MESI */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <BarChart2 size={16} className="text-green-500"/> Riepilogo Mensile {anno}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="pb-2 pr-4 font-semibold text-gray-600">Mese</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Fatturato</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Costi Totali</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Margine</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Costo Pers.</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">% Personale</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Stato</th>
              </tr>
            </thead>
            <tbody>
              {chartData.map((row,i)=>(
                <tr key={i} className={`border-b border-gray-50 hover:bg-gray-50 ${(row.margine||0)<0?'bg-red-50/30':''}`}>
                  <td className="py-2 pr-4 font-medium text-gray-800">{row.label}</td>
                  <td className="py-2 pr-4">{(row.fatturato||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}</td>
                  <td className="py-2 pr-4 text-gray-600">{(row.costi_totali||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}</td>
                  <td className="py-2 pr-4">
                    <span className={`font-semibold ${(row.margine||0)>=0?'text-green-600':'text-red-600'}`}>
                      {(row.margine||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-600">{(row.costo_personale||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}</td>
                  <td className="py-2 pr-4">
                    <span className={`font-semibold ${(row.pct_personale_su_fatt||0)>55?'text-red-600':(row.pct_personale_su_fatt||0)>45?'text-orange-500':'text-green-600'}`}>
                      {(row.pct_personale_su_fatt||0).toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${(row.margine||0)>=0?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>
                      {(row.margine||0)>=0?'Utile':'Perdita'}
                    </span>
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
          "Analizza le perdite di gennaio-aprile 2026",
          "Qual è il break-even mensile di Mameli?",
          "Come stanno andando i costi del personale?",
          "Proiezione fine anno a questo ritmo?",
        ]}/>
    </div>
  )
}
