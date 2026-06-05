import { useState, useEffect, useMemo } from 'react'
import supabase from '../supabase'
import PageAssistant from '../components/PageAssistant'
import {
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
  ResponsiveContainer, LabelList
} from 'recharts'
import { Users, DollarSign, Clock, Star, Filter, Table, TrendingUp, ChevronUp, ChevronDown } from 'lucide-react'

const SEDE_OPTIONS = [
  { value: 'MA', label: 'Mameli (CA)' },
  { value: 'PN', label: 'Predda Niedda (SS)' },
  { value: 'ALL', label: 'Entrambe' },
]

const GIORNI = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato']
const GIORNI_SHORT = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab']

function KpiCard({ icon: Icon, label, value, sub, color = 'indigo' }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    green: 'bg-green-50 text-green-600 border-green-100',
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
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
    </div>
  )
}

const ScatterTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <div className="font-semibold text-gray-800 mb-1">Tavolo: {d.tavolo}</div>
      <div className="text-gray-600">Durata media: <span className="font-medium">{d.durata_media_min} min</span></div>
      <div className="text-gray-600">Incasso: <span className="font-medium">{(d.incasso||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}</span></div>
      <div className="text-gray-600">Coperti: <span className="font-medium">{d.n_coperti}</span></div>
      <div className="text-gray-600">Scontrino medio: <span className="font-medium">{(d.scontrino_medio||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}</span></div>
    </div>
  )
}

const LineTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <div className="font-semibold text-gray-800 mb-1">{label}</div>
      {payload.map((p,i)=>(
        <div key={i} className="text-gray-600">
          {p.name}: <span className="font-medium" style={{color:p.color}}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function CopertiBi() {
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]
  const todayStr = today.toISOString().split('T')[0]

  const [sede, setSede] = useState('MA')
  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo] = useState(todayStr)
  const [chiusureData, setChiusureData] = useState([])
  const [tavoliData, setTavoliData] = useState([])
  const [turniData, setTurniData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [sortCol, setSortCol] = useState('incasso')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => { fetchData() }, [sede, dateFrom, dateTo])

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      // chiusure giornaliere
      let qc = supabase.from('chiusure_giornaliere').select('*')
        .gte('data', dateFrom).lte('data', dateTo)
      if (sede !== 'ALL') qc = qc.eq('sede', sede)
      const { data: cRows, error: ce } = await qc.order('data')
      if (ce) throw ce
      setChiusureData(cRows || [])

      // statistiche tavoli
      let qt = supabase.from('statistiche_tavoli').select('*')
        .gte('data_inizio', dateFrom).lte('data_fine', dateTo)
      if (sede !== 'ALL') qt = qt.eq('sede', sede)
      const { data: tRows } = await qt
      setTavoliData(tRows || [])

      // chiusure turni per distribuzione giorno
      let qtu = supabase.from('chiusure_turni').select('*')
        .gte('data', dateFrom).lte('data', dateTo)
      if (sede !== 'ALL') qtu = qtu.eq('sede', sede)
      const { data: tuRows } = await qtu
      setTurniData(tuRows || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const kpis = useMemo(() => {
    if (!chiusureData.length) return {}
    const totalCoperti = chiusureData.reduce((s,d)=>s+(d.coperti||0),0)
    const giorni = chiusureData.length || 1
    const mediaCopertiGiorno = totalCoperti / giorni
    const avgScontrino = chiusureData.reduce((s,d)=>s+(d.scontrino_medio||0),0)/giorni
    // tavolo più redditizio
    const tavoliGrouped = {}
    tavoliData.forEach(d => {
      if (!tavoliGrouped[d.tavolo]) tavoliGrouped[d.tavolo] = 0
      tavoliGrouped[d.tavolo] += (d.incasso || 0)
    })
    const topTavolo = Object.entries(tavoliGrouped).sort((a,b)=>b[1]-a[1])[0]
    return { totalCoperti, mediaCopertiGiorno, avgScontrino, topTavolo }
  }, [chiusureData, tavoliData])

  // Dati linea coperti MA vs PN
  const lineData = useMemo(() => {
    const grouped = {}
    chiusureData.forEach(d => {
      const k = d.data
      if (!grouped[k]) grouped[k] = { data: k }
      grouped[k][d.sede] = (grouped[k][d.sede]||0) + (d.coperti||0)
    })
    return Object.values(grouped).sort((a,b)=>a.data.localeCompare(b.data))
  }, [chiusureData])

  // Top 10 tavoli per incasso aggregati
  const topTavoli = useMemo(() => {
    const agg = {}
    tavoliData.forEach(d => {
      if (!agg[d.tavolo]) agg[d.tavolo] = { tavolo:d.tavolo, incasso:0, n_coperti:0, n_ordini:0, durata_media_min:0, scontrino_medio:0, count:0 }
      agg[d.tavolo].incasso += (d.incasso||0)
      agg[d.tavolo].n_coperti += (d.n_coperti||0)
      agg[d.tavolo].n_ordini += (d.n_ordini||0)
      agg[d.tavolo].durata_media_min += (d.durata_media_min||0)
      agg[d.tavolo].scontrino_medio += (d.scontrino_medio||0)
      agg[d.tavolo].count++
    })
    return Object.values(agg)
      .map(t=>({...t, durata_media_min:t.count>0?t.durata_media_min/t.count:0, scontrino_medio:t.count>0?t.scontrino_medio/t.count:0}))
      .sort((a,b)=>b.incasso-a.incasso)
      .slice(0,10)
  }, [tavoliData])

  // Scatter tavoli durata vs incasso
  const scatterTavoli = useMemo(() => {
    const agg = {}
    tavoliData.forEach(d => {
      if (!agg[d.tavolo]) agg[d.tavolo] = { tavolo:d.tavolo, incasso:0, n_coperti:0, durata_media_min:0, scontrino_medio:0, count:0 }
      agg[d.tavolo].incasso += (d.incasso||0)
      agg[d.tavolo].n_coperti += (d.n_coperti||0)
      agg[d.tavolo].durata_media_min += (d.durata_media_min||0)
      agg[d.tavolo].scontrino_medio += (d.scontrino_medio||0)
      agg[d.tavolo].count++
    })
    return Object.values(agg).map(t=>({
      ...t,
      durata_media_min: t.count>0 ? t.durata_media_min/t.count : 0,
      scontrino_medio: t.count>0 ? t.scontrino_medio/t.count : 0,
      z: Math.max(5, Math.min(30, t.n_coperti / 3))
    })).filter(t=>t.durata_media_min>0)
  }, [tavoliData])

  // Distribuzione coperti per giorno settimana
  const giorniDistrib = useMemo(() => {
    const agg = Array(7).fill(null).map((_,i)=>({ giorno:GIORNI_SHORT[i], coperti:0, count:0, incasso:0 }))
    const source = turniData.length ? turniData : chiusureData
    source.forEach(d => {
      const dateStr = d.data || d.data_inizio?.slice(0,10)
      if (!dateStr) return
      const dow = new Date(dateStr).getDay()
      agg[dow].coperti += (d.coperti||0)
      agg[dow].incasso += (d.incasso||d.totale_venduto_ipratico||0)
      agg[dow].count++
    })
    return agg.map(g=>({ ...g, mediaCoperti: g.count>0?Math.round(g.coperti/g.count):0 }))
  }, [turniData, chiusureData])

  const sortedTavoli = useMemo(() => {
    const agg = {}
    tavoliData.forEach(d => {
      if (!agg[d.tavolo]) agg[d.tavolo] = { tavolo:d.tavolo, incasso:0, n_coperti:0, n_ordini:0, durata:0, scontrino:0, count:0 }
      agg[d.tavolo].incasso += (d.incasso||0)
      agg[d.tavolo].n_coperti += (d.n_coperti||0)
      agg[d.tavolo].n_ordini += (d.n_ordini||0)
      agg[d.tavolo].durata += (d.durata_media_min||0)
      agg[d.tavolo].scontrino += (d.scontrino_medio||0)
      agg[d.tavolo].count++
    })
    const list = Object.values(agg).map(t=>({
      ...t, durata_media_min: t.count>0?t.durata/t.count:0, scontrino_medio: t.count>0?t.scontrino/t.count:0
    }))
    return list.sort((a,b)=>{
      const av = a[sortCol]??0; const bv = b[sortCol]??0
      return sortDir==='asc'?av-bv:bv-av
    })
  }, [tavoliData, sortCol, sortDir])

  function handleSort(col) {
    if (sortCol===col) setSortDir(d=>d==='asc'?'desc':'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const systemContext = useMemo(() => ({
    sede, dateFrom, dateTo,
    totalCoperti: kpis.totalCoperti,
    mediaCopertiGiorno: kpis.mediaCopertiGiorno,
    avgScontrino: kpis.avgScontrino,
    topTavolo: kpis.topTavolo?.[0],
    topTavoloIncasso: kpis.topTavolo?.[1],
    numTavoli: sortedTavoli.length,
  }), [sede, dateFrom, dateTo, kpis, sortedTavoli])

  const TABLE_COLS = [
    {key:'tavolo',label:'Tavolo'},{key:'n_coperti',label:'Coperti tot.'},
    {key:'n_ordini',label:'Ordini'},{key:'durata_media_min',label:'Durata Media'},
    {key:'incasso',label:'Incasso Totale'},{key:'scontrino_medio',label:'Scontrino Medio'},
  ]

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users className="text-blue-600" size={26}/>
          Coperti, Tavoli &amp; Sala
        </h1>
        <p className="text-gray-500 text-sm mt-1">Andamento coperti, performance tavoli, distribuzione settimanale</p>
      </div>

      {/* FILTRI */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Sede</label>
          <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={sede} onChange={e=>setSede(e.target.value)}>
            {SEDE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Dal</label>
          <input type="date" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Al</label>
          <input type="date" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={dateTo} onChange={e=>setDateTo(e.target.value)}/>
        </div>
        <button onClick={fetchData} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-1">
          <Filter size={14}/> Aggiorna
        </button>
      </div>

      {/* KPI CARDS */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_,i)=><div key={i} className="bg-white rounded-xl border p-4 h-24 animate-pulse"/>)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard icon={Users} label="Coperti totali periodo" color="blue"
            value={(kpis.totalCoperti||0).toLocaleString('it-IT')} sub={`${chiusureData.length} giorni`}/>
          <KpiCard icon={TrendingUp} label="Media coperti/giorno" color="indigo"
            value={Math.round(kpis.mediaCopertiGiorno||0)} sub="media giornaliera"/>
          <KpiCard icon={DollarSign} label="Scontrino medio" color="green"
            value={(kpis.avgScontrino||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})} sub="€ per coperto"/>
          <KpiCard icon={Star} label="Tavolo top" color="yellow"
            value={kpis.topTavolo?.[0]||'—'}
            sub={kpis.topTavolo?`${(kpis.topTavolo[1]||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})} incasso totale`:''}/>
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">Errore: {error}</div>}

      {/* LINE CHART COPERTI */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Users size={16} className="text-blue-500"/> Coperti Giornalieri nel Periodo
        </h2>
        {lineData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Users size={36} className="mb-2 opacity-40"/><p className="text-sm">Nessun dato chiusure disponibile</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={lineData} margin={{top:10,right:30,left:0,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="data" fontSize={10}
                tickFormatter={v=>new Date(v).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'})}/>
              <YAxis fontSize={11}/>
              <Tooltip content={<LineTooltip/>}/>
              <Legend/>
              <Line type="monotone" dataKey="MA" name="Mameli" stroke="#6366f1" strokeWidth={2} dot={false} activeDot={{r:4}}/>
              <Line type="monotone" dataKey="PN" name="Predda Niedda" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{r:4}}/>
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* TOP 10 TAVOLI PER INCASSO */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Star size={16} className="text-blue-500"/> Top 10 Tavoli per Incasso
          </h2>
          {topTavoli.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400">
              <Table size={36} className="mb-2 opacity-40"/><p className="text-sm">Nessun dato tavoli disponibile</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topTavoli} layout="vertical" margin={{top:0,right:50,left:60,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0"/>
                <XAxis type="number" fontSize={11} tickFormatter={v=>`€${(v/1000).toFixed(1)}k`}/>
                <YAxis dataKey="tavolo" type="category" width={55} fontSize={11}/>
                <Tooltip formatter={v=>v.toLocaleString('it-IT',{style:'currency',currency:'EUR'})}/>
                <Bar dataKey="incasso" name="Incasso" radius={[0,4,4,0]} fill="#3b82f6">
                  <LabelList dataKey="incasso" position="right" fontSize={10}
                    formatter={v=>`€${(v/1000).toFixed(1)}k`}/>
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* DISTRIBUZIONE SETTIMANALE */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-blue-500"/> Media Coperti per Giorno Settimana
          </h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={giorniDistrib} margin={{top:0,right:20,left:0,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="giorno" fontSize={11}/>
              <YAxis fontSize={11}/>
              <Tooltip formatter={(v,name)=>name==='mediaCoperti'?`${v} coperti`:v}/>
              <Bar dataKey="mediaCoperti" name="Media Coperti" fill="#3b82f6" radius={[4,4,0,0]} opacity={0.85}>
                {giorniDistrib.map((_,i)=>(
                  <Cell key={i} fill={i===5||i===0?'#6366f1':'#3b82f6'}/>
                ))}
                <LabelList dataKey="mediaCoperti" position="top" fontSize={10}/>
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* SCATTER DURATA VS INCASSO */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <Clock size={16} className="text-blue-500"/> Durata vs Incasso per Tavolo
        </h2>
        <p className="text-xs text-gray-500 mb-4">Dimensione bolla = numero coperti. Tavoli in alto a sinistra = veloci e redditizi</p>
        {scatterTavoli.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Clock size={36} className="mb-2 opacity-40"/><p className="text-sm">Nessun dato statistiche tavoli</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{top:20,right:30,bottom:30,left:20}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="durata_media_min" name="Durata media (min)" type="number" fontSize={11}
                label={{value:'Durata media (min)',position:'insideBottom',offset:-15,fontSize:12}}/>
              <YAxis dataKey="incasso" name="Incasso totale" type="number" fontSize={11}
                label={{value:'Incasso €',angle:-90,position:'insideLeft',fontSize:12}}
                tickFormatter={v=>`€${(v/1000).toFixed(0)}k`}/>
              <Tooltip content={<ScatterTooltip/>}/>
              <Scatter data={scatterTavoli} shape={(props) => {
                const { cx, cy, payload } = props
                const r = payload.z || 8
                return (
                  <g>
                    <circle cx={cx} cy={cy} r={r} fill="#3b82f6" fillOpacity={0.6} stroke="#3b82f6" strokeWidth={1.5}/>
                    <text x={cx} y={cy-r-3} textAnchor="middle" fontSize={9} fill="#374151" fontWeight="600">
                      {payload.tavolo}
                    </text>
                  </g>
                )
              }}/>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* TABELLA TAVOLI */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Table size={16} className="text-blue-500"/> Dettaglio Tavoli ({sortedTavoli.length})
        </h2>
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
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 pr-4 font-semibold text-gray-800">{row.tavolo}</td>
                  <td className="py-2 pr-4 text-gray-700">{row.n_coperti}</td>
                  <td className="py-2 pr-4 text-gray-700">{row.n_ordini}</td>
                  <td className="py-2 pr-4 text-gray-700">
                    {row.durata_media_min>0?(
                      <span className={`font-medium ${row.durata_media_min>90?'text-red-500':row.durata_media_min>60?'text-orange-500':'text-green-600'}`}>
                        {Math.round(row.durata_media_min)} min
                      </span>
                    ):'—'}
                  </td>
                  <td className="py-2 pr-4 font-semibold text-gray-800">
                    {row.incasso.toLocaleString('it-IT',{style:'currency',currency:'EUR'})}
                  </td>
                  <td className="py-2 pr-4 text-gray-700">
                    {row.scontrino_medio>0?row.scontrino_medio.toLocaleString('it-IT',{style:'currency',currency:'EUR'}):'—'}
                  </td>
                </tr>
              ))}
              {sortedTavoli.length===0&&(
                <tr><td colSpan={6} className="py-12 text-center text-gray-400">
                  <Table size={32} className="mx-auto mb-2 opacity-40"/>Nessun dato tavoli disponibile
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
