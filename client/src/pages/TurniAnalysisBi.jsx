import { useState, useEffect, useMemo } from 'react'
import supabase from '../supabase'
import PageAssistant from '../components/PageAssistant'
import {
  ComposedChart, Bar, Line, BarChart, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, Cell, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { Clock, TrendingUp, Users, DollarSign, Filter, CheckCircle, XCircle, AlertCircle } from 'lucide-react'

const SEDE_OPTIONS = [
  { value: 'MA', label: 'Mameli (CA)' },
  { value: 'PN', label: 'Predda Niedda (SS)' },
  { value: 'ALL', label: 'Entrambe' },
]

const GIORNI = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom']

function KpiCard({ icon: Icon, label, value, sub, color = 'indigo' }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    green: 'bg-green-50 text-green-600 border-green-100',
    orange: 'bg-orange-50 text-orange-600 border-orange-100',
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    red: 'bg-red-50 text-red-600 border-red-100',
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

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm max-w-xs">
      <div className="font-semibold text-gray-800 mb-1">{label}</div>
      {payload.map((p,i)=>(
        <div key={i} className="text-gray-600">
          {p.name}: <span className="font-medium" style={{color:p.color}}>
            {p.name?.includes('food') || p.name?.includes('%') ? `${Number(p.value).toFixed(1)}%`
              : p.name?.includes('incasso') || p.name?.includes('€') ? Number(p.value).toLocaleString('it-IT',{style:'currency',currency:'EUR'})
              : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function BeMeter({ label, value, color }) {
  const pct = Math.min(100, Math.max(0, value))
  const stroke = pct >= 100 ? '#22c55e' : pct >= 80 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={100} height={60} viewBox="0 0 100 60">
        <path d="M10,55 A40,40 0 0,1 90,55" fill="none" stroke="#e5e7eb" strokeWidth={12} strokeLinecap="round"/>
        <path d="M10,55 A40,40 0 0,1 90,55" fill="none" stroke={stroke} strokeWidth={12} strokeLinecap="round"
          strokeDasharray={`${(pct/100)*125.66} 125.66`}/>
        <text x={50} y={52} textAnchor="middle" fontSize={15} fontWeight="bold" fill={stroke}>{pct.toFixed(0)}%</text>
      </svg>
      <span className="text-xs font-semibold text-gray-600">{label}</span>
    </div>
  )
}

export default function TurniAnalysisBi() {
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]
  const todayStr = today.toISOString().split('T')[0]

  const [sede, setSede] = useState('MA')
  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo] = useState(todayStr)
  const [viewMode, setViewMode] = useState('mensile')
  const [turniData, setTurniData] = useState([])
  const [chiusureData, setChiusureData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [sortAsc, setSortAsc] = useState(false)

  useEffect(() => { fetchData() }, [sede, dateFrom, dateTo])

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      let q = supabase.from('v_turni_analisi').select('*')
        .gte('data_inizio', dateFrom).lte('data_fine', dateTo)
      if (sede !== 'ALL') q = q.eq('sede', sede)
      const { data: rows, error: err } = await q.order('data_inizio', { ascending: false })
      if (err) throw err
      setTurniData(rows || [])

      let qc = supabase.from('chiusure_turni').select('*')
        .gte('data', dateFrom).lte('data', dateTo)
      if (sede !== 'ALL') qc = qc.eq('sede', sede)
      const { data: crows } = await qc.order('data')
      setChiusureData(crows || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const pranzoData = useMemo(() => turniData.filter(d=>d.turno?.toLowerCase().includes('pranzo')), [turniData])
  const cenaData = useMemo(() => turniData.filter(d=>d.turno?.toLowerCase().includes('cena')), [turniData])

  const avgPranzo = useMemo(() => {
    if (!pranzoData.length) return {}
    return {
      incasso: pranzoData.reduce((s,d)=>s+(d.incassato||0),0)/pranzoData.length,
      coperti: pranzoData.reduce((s,d)=>s+(d.coperti||0),0)/pranzoData.length,
      copMedio: pranzoData.reduce((s,d)=>s+(d.coperto_medio||0),0)/pranzoData.length,
      fc: pranzoData.reduce((s,d)=>s+(d.food_cost_pct||0),0)/pranzoData.length,
      be: pranzoData.filter(d=>d.be_raggiunto).length,
      tot: pranzoData.length,
      beAvg: pranzoData.reduce((s,d)=>{
        const pct = d.break_even>0?(d.incassato/d.break_even*100):0
        return s+pct
      },0)/pranzoData.length,
    }
  }, [pranzoData])

  const avgCena = useMemo(() => {
    if (!cenaData.length) return {}
    return {
      incasso: cenaData.reduce((s,d)=>s+(d.incassato||0),0)/cenaData.length,
      coperti: cenaData.reduce((s,d)=>s+(d.coperti||0),0)/cenaData.length,
      copMedio: cenaData.reduce((s,d)=>s+(d.coperto_medio||0),0)/cenaData.length,
      fc: cenaData.reduce((s,d)=>s+(d.food_cost_pct||0),0)/cenaData.length,
      be: cenaData.filter(d=>d.be_raggiunto).length,
      tot: cenaData.length,
      beAvg: cenaData.reduce((s,d)=>{
        const pct = d.break_even>0?(d.incassato/d.break_even*100):0
        return s+pct
      },0)/cenaData.length,
    }
  }, [cenaData])

  const timelineData = useMemo(() => {
    const grouped = {}
    turniData.forEach(d => {
      const k = d.data_inizio?.slice(0,10) || d.data_fine?.slice(0,10)
      if (!k) return
      if (!grouped[k]) grouped[k] = { data: k }
      if (d.turno?.toLowerCase().includes('pranzo')) {
        grouped[k].pranzo_incasso = (grouped[k].pranzo_incasso||0) + (d.incassato||0)
        grouped[k].pranzo_fc = d.food_cost_pct||0
      } else {
        grouped[k].cena_incasso = (grouped[k].cena_incasso||0) + (d.incassato||0)
        grouped[k].cena_fc = d.food_cost_pct||0
      }
    })
    return Object.values(grouped).sort((a,b)=>a.data.localeCompare(b.data))
  }, [turniData])

  const giorniData = useMemo(() => {
    const grouped = Array(7).fill(null).map((_,i)=>({
      giorno: GIORNI[i], pranzo:0, cena:0, count:0
    }))
    chiusureData.forEach(d => {
      const dow = new Date(d.data).getDay()
      const idx = dow === 0 ? 6 : dow - 1
      if (d.turno?.toLowerCase().includes('pranzo')) grouped[idx].pranzo += (d.incasso||0)
      else grouped[idx].cena += (d.incasso||0)
      grouped[idx].count++
    })
    // fallback: use turniData
    if (!chiusureData.length) {
      turniData.forEach(d => {
        const dateStr = d.data_inizio?.slice(0,10)
        if (!dateStr) return
        const dow = new Date(dateStr).getDay()
        const idx = dow === 0 ? 6 : dow - 1
        if (d.turno?.toLowerCase().includes('pranzo')) grouped[idx].pranzo += (d.incassato||0)
        else grouped[idx].cena += (d.incassato||0)
        grouped[idx].count++
      })
    }
    return grouped
  }, [chiusureData, turniData])

  const systemContext = useMemo(() => ({
    sede, dateFrom, dateTo,
    totalTurni: turniData.length, pranzoTurni: pranzoData.length, cenaTurni: cenaData.length,
    avgIncassoPranzo: avgPranzo.incasso, avgIncassoCena: avgCena.incasso,
    beRaggiuntoPranzo: `${avgPranzo.be}/${avgPranzo.tot}`,
    beRaggiuntoCena: `${avgCena.be}/${avgCena.tot}`,
    avgFcPranzo: avgPranzo.fc, avgFcCena: avgCena.fc,
  }), [turniData, sede, dateFrom, dateTo, avgPranzo, avgCena, pranzoData, cenaData])

  const sorted = useMemo(() => [...turniData].sort((a,b)=>{
    const da = a.data_inizio||''; const db = b.data_inizio||''
    return sortAsc ? da.localeCompare(db) : db.localeCompare(da)
  }), [turniData, sortAsc])

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Clock className="text-blue-600" size={26}/>
          Analisi Turni &amp; Fasce Orarie
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Pranzo vs Cena — incasso, coperti, food cost, break-even.{' '}
          <span className="text-gray-400">Turni: Pranzo 12:00–18:00 · Cena 19:00–11:59 del giorno dopo (gli scontrini dopo mezzanotte sono attribuiti alla cena del giorno precedente). Dati per giorno/turno dalle chiusure iPratico.</span>
        </p>
      </div>

      {/* INSIGHTS AUTOMATICI */}
      {!loading && turniData.length > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 text-sm text-blue-900 space-y-1">
          <div className="font-semibold flex items-center gap-1"><TrendingUp size={14}/> Analisi del periodo</div>
          <p>
            {(avgPranzo.incasso||0) >= (avgCena.incasso||0)
              ? <>Il <b>pranzo</b> rende in media di più ({(avgPranzo.incasso||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})} vs {(avgCena.incasso||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})} a turno)</>
              : <>La <b>cena</b> rende in media di più ({(avgCena.incasso||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})} vs {(avgPranzo.incasso||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})} a turno)</>},
            {' '}ma il coperto medio è più alto a {((avgCena.copMedio||0) >= (avgPranzo.copMedio||0)) ? 'cena' : 'pranzo'}
            {' '}({Math.max(avgCena.copMedio||0, avgPranzo.copMedio||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})} a persona).
          </p>
          <p>
            Break-even raggiunto in <b>{avgPranzo.be||0}/{avgPranzo.tot||0}</b> turni pranzo e <b>{avgCena.be||0}/{avgCena.tot||0}</b> turni cena.
            Il BE per turno è calcolato dividendo i costi totali del mese (personale + fatture + costi fissi) per il numero di turni del mese: se mancano fatture o buste paga del mese il BE risulterà sottostimato.
          </p>
        </div>
      )}

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
        <div className="flex border border-gray-300 rounded-lg overflow-hidden text-sm">
          {['settimanale','mensile'].map(v=>(
            <button key={v} onClick={()=>setViewMode(v)}
              className={`px-3 py-2 font-medium capitalize ${viewMode===v?'bg-blue-600 text-white':'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {v}
            </button>
          ))}
        </div>
        <button onClick={fetchData} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-1">
          <Filter size={14}/> Aggiorna
        </button>
      </div>

      {/* KPI COMPARATIVI */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_,i)=><div key={i} className="bg-white rounded-xl border p-4 h-24 animate-pulse"/>)}
        </div>
      ) : (
        <div className="mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="text-sm font-semibold text-orange-600 flex items-center gap-1 px-1">
                <Clock size={14}/> PRANZO
              </div>
              <div className="grid grid-cols-2 gap-3">
                <KpiCard icon={DollarSign} label="Incasso medio" color="orange"
                  value={(avgPranzo.incasso||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})} sub="per turno"/>
                <KpiCard icon={Users} label="Coperti medi" color="orange"
                  value={Math.round(avgPranzo.coperti||0)} sub="per turno"/>
                <KpiCard icon={TrendingUp} label="Coperto medio" color="orange"
                  value={(avgPranzo.copMedio||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})} sub="€ per coperto"/>
                <KpiCard icon={AlertCircle} label="Food Cost medio" color="orange"
                  value={`${(avgPranzo.fc||0).toFixed(1)}%`} sub={`BE: ${avgPranzo.be}/${avgPranzo.tot} turni`}/>
              </div>
            </div>
            <div className="space-y-3">
              <div className="text-sm font-semibold text-indigo-600 flex items-center gap-1 px-1">
                <Clock size={14}/> CENA
              </div>
              <div className="grid grid-cols-2 gap-3">
                <KpiCard icon={DollarSign} label="Incasso medio" color="indigo"
                  value={(avgCena.incasso||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})} sub="per turno"/>
                <KpiCard icon={Users} label="Coperti medi" color="indigo"
                  value={Math.round(avgCena.coperti||0)} sub="per turno"/>
                <KpiCard icon={TrendingUp} label="Coperto medio" color="indigo"
                  value={(avgCena.copMedio||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})} sub="€ per coperto"/>
                <KpiCard icon={AlertCircle} label="Food Cost medio" color="indigo"
                  value={`${(avgCena.fc||0).toFixed(1)}%`} sub={`BE: ${avgCena.be}/${avgCena.tot} turni`}/>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">Errore: {error}</div>}

      {/* COMPOSED CHART INCASSO */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-blue-500"/> Incasso Pranzo vs Cena nel Tempo
        </h2>
        {timelineData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Clock size={36} className="mb-2 opacity-40"/><p className="text-sm">Nessun dato disponibile</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={timelineData} margin={{top:10,right:40,left:10,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="data" fontSize={10} tickFormatter={v=>new Date(v).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'})}/>
              <YAxis yAxisId="left" fontSize={11} tickFormatter={v=>`€${(v/1000).toFixed(0)}k`}/>
              <YAxis yAxisId="right" orientation="right" fontSize={11} tickFormatter={v=>`${v}%`} domain={[0,50]}/>
              <Tooltip content={<CustomTooltip/>}/>
              <Legend/>
              <Bar yAxisId="left" dataKey="pranzo_incasso" name="Incasso Pranzo" fill="#f97316" opacity={0.85} radius={[2,2,0,0]}/>
              <Bar yAxisId="left" dataKey="cena_incasso" name="Incasso Cena" fill="#6366f1" opacity={0.85} radius={[2,2,0,0]}/>
              <Line yAxisId="right" type="monotone" dataKey="pranzo_fc" name="FC% Pranzo" stroke="#f59e0b" dot={false} strokeWidth={2}/>
              <Line yAxisId="right" type="monotone" dataKey="cena_fc" name="FC% Cena" stroke="#8b5cf6" dot={false} strokeWidth={2}/>
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* COPERTI PER GIORNO */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Users size={16} className="text-blue-500"/> Incasso per Giorno Settimana
          </h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={giorniData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="giorno" fontSize={11}/>
              <YAxis fontSize={11} tickFormatter={v=>`€${(v/1000).toFixed(0)}k`}/>
              <Tooltip formatter={v=>v.toLocaleString('it-IT',{style:'currency',currency:'EUR'})}/>
              <Legend/>
              <Bar dataKey="pranzo" name="Pranzo" fill="#f97316" radius={[2,2,0,0]} opacity={0.85}/>
              <Bar dataKey="cena" name="Cena" fill="#6366f1" radius={[2,2,0,0]} opacity={0.85}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* BE GAUGE */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <CheckCircle size={16} className="text-blue-500"/> Break-Even per Turno
          </h2>
          <div className="flex items-center justify-around h-40">
            <BeMeter label="Pranzo" value={avgPranzo.beAvg||0} color="#f97316"/>
            <div className="w-px h-24 bg-gray-200"/>
            <BeMeter label="Cena" value={avgCena.beAvg||0} color="#6366f1"/>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="text-center text-xs text-gray-600">
              <div className="font-semibold text-orange-600">{avgPranzo.be}/{avgPranzo.tot}</div>
              <div>turni pranzo sopra BE</div>
            </div>
            <div className="text-center text-xs text-gray-600">
              <div className="font-semibold text-indigo-600">{avgCena.be}/{avgCena.tot}</div>
              <div>turni cena sopra BE</div>
            </div>
          </div>
        </div>
      </div>

      {/* TABELLA */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Clock size={16} className="text-blue-500"/> Dettaglio Turni ({turniData.length})
          </h2>
          <button onClick={()=>setSortAsc(s=>!s)}
            className="text-xs text-gray-500 hover:text-blue-600 border border-gray-300 rounded px-2 py-1">
            Data {sortAsc?'↑':'↓'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="pb-2 pr-4 font-semibold text-gray-600 whitespace-nowrap">Periodo</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Turno</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Incasso</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Coperti</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Cop. Medio</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Food Cost%</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Break-Even</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Margine</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">BE</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0,80).map((row,i)=>(
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 pr-4 text-gray-700 whitespace-nowrap text-xs">
                    {new Date(row.data_inizio||row.data_fine).toLocaleDateString('it-IT')}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${row.turno?.toLowerCase().includes('pranzo')?'bg-orange-100 text-orange-700':'bg-indigo-100 text-indigo-700'}`}>
                      {row.turno}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-semibold text-gray-800">
                    {(row.incassato||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}
                  </td>
                  <td className="py-2 pr-4 text-gray-700">{row.coperti||'—'}</td>
                  <td className="py-2 pr-4 text-gray-700">
                    {row.coperto_medio?(row.coperto_medio.toLocaleString('it-IT',{style:'currency',currency:'EUR'})):'—'}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`font-semibold ${(row.food_cost_pct||0)>35?'text-red-600':(row.food_cost_pct||0)>28?'text-orange-500':'text-green-600'}`}>
                      {(row.food_cost_pct||0).toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-600">
                    {row.break_even?(row.break_even.toLocaleString('it-IT',{style:'currency',currency:'EUR'})):'—'}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`font-semibold ${(row.margine||0)>=0?'text-green-600':'text-red-600'}`}>
                      {(row.margine||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    {row.be_raggiunto!=null ? (
                      row.be_raggiunto
                        ? <CheckCircle size={16} className="text-green-500"/>
                        : <XCircle size={16} className="text-red-500"/>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {sorted.length===0&&(
                <tr><td colSpan={9} className="py-12 text-center text-gray-400">
                  <Clock size={32} className="mx-auto mb-2 opacity-40"/>Nessun turno trovato
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PageAssistant pageId="turni-analysis-bi" systemContext={systemContext}
        suggestions={[
          "Quale turno è più profittevole?",
          "Il pranzo raggiunge il break-even?",
          "Confronta pranzo vs cena di giugno",
          "Quale giorno della settimana è il migliore?",
        ]}/>
    </div>
  )
}
