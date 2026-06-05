import { useState, useEffect, useMemo } from 'react'
import supabase from '../supabase'
import PageAssistant from '../components/PageAssistant'
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, Cell, ResponsiveContainer, ReferenceLine, LabelList
} from 'recharts'
import { Users, TrendingUp, Target, Award, ChevronUp, ChevronDown, Filter } from 'lucide-react'

const SEDE_OPTIONS = [
  { value: 'MA', label: 'Mameli (CA)' },
  { value: 'PN', label: 'Predda Niedda (SS)' },
  { value: 'ALL', label: 'Entrambe' },
]

const MONTHS = [
  { value: 1, label: 'Gennaio' }, { value: 2, label: 'Febbraio' },
  { value: 3, label: 'Marzo' }, { value: 4, label: 'Aprile' },
  { value: 5, label: 'Maggio' }, { value: 6, label: 'Giugno' },
  { value: 7, label: 'Luglio' }, { value: 8, label: 'Agosto' },
  { value: 9, label: 'Settembre' }, { value: 10, label: 'Ottobre' },
  { value: 11, label: 'Novembre' }, { value: 12, label: 'Dicembre' },
]

function KpiCard({ icon: Icon, label, value, sub, color = 'indigo' }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    green: 'bg-green-50 text-green-600 border-green-100',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={18} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs mt-1 opacity-70">{sub}</div>}
    </div>
  )
}

const statusColor = (stato) => {
  if (!stato) return '#6b7280'
  const s = stato.toLowerCase()
  if (s.includes('target') || s.includes('raggiunto') || s === 'ok') return '#22c55e'
  if (s.includes('quorum') || s.includes('vicino')) return '#f59e0b'
  return '#ef4444'
}

const statusBadge = (stato) => {
  if (!stato) return 'bg-gray-100 text-gray-600'
  const s = stato.toLowerCase()
  if (s.includes('target') || s.includes('raggiunto') || s === 'ok') return 'bg-green-100 text-green-700'
  if (s.includes('quorum') || s.includes('vicino')) return 'bg-yellow-100 text-yellow-700'
  return 'bg-red-100 text-red-700'
}

const CustomBarTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <div className="font-semibold text-gray-800 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="text-gray-600">
          {p.name}: <span className="font-medium" style={{ color: p.color }}>{typeof p.value === 'number' ? p.value.toLocaleString('it-IT') : p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function CamerieriBi() {
  const now = new Date()
  const [sede, setSede] = useState('MA')
  const [anno, setAnno] = useState(now.getFullYear())
  const [mese, setMese] = useState(now.getMonth() + 1)
  const [data, setData] = useState([])
  const [trendData, setTrendData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [sortCol, setSortCol] = useState('tot_pezzi')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => { fetchData() }, [sede, anno, mese])

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      let q = supabase.from('v_kpi_operatori_mese').select('*').eq('anno', anno).eq('mese', mese)
      if (sede !== 'ALL') q = q.eq('sede', sede)
      const { data: rows, error: err } = await q.order('tot_pezzi', { ascending: false })
      if (err) throw err
      setData(rows || [])

      // trend ultimi 6 mesi
      const meseStart = mese - 5
      const annoStart = meseStart <= 0 ? anno - 1 : anno
      const meseStartAdj = meseStart <= 0 ? meseStart + 12 : meseStart
      let qt = supabase.from('v_kpi_operatori_mese').select('sede,anno,mese,tot_pezzi,fatturato_stimato_operatore,operatore')
      if (sede !== 'ALL') qt = qt.eq('sede', sede)
      const { data: trendRows } = await qt
        .or(`and(anno.eq.${anno},mese.gte.${meseStartAdj}),and(anno.eq.${annoStart},mese.gte.${meseStartAdj})`)
        .order('anno').order('mese')
      if (trendRows) {
        const grouped = {}
        trendRows.forEach(r => {
          const k = `${r.anno}-${String(r.mese).padStart(2,'0')}`
          if (!grouped[k]) grouped[k] = { mese: k, MA: 0, PN: 0 }
          grouped[k][r.sede] = (grouped[k][r.sede] || 0) + (r.tot_pezzi || 0)
        })
        setTrendData(Object.values(grouped).slice(-6))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const kpis = useMemo(() => {
    if (!data.length) return {}
    const operatoriAttivi = data.length
    const mediaPezzi = Math.round(data.reduce((s,d)=>s+(d.tot_pezzi||0),0)/data.length)
    const totFatturato = data.reduce((s,d)=>s+(d.fatturato_stimato_operatore||0),0)
    const mediaPctTarget = data.reduce((s,d)=>s+(d.pct_target||0),0)/data.length
    return { operatoriAttivi, mediaPezzi, totFatturato, mediaPctTarget }
  }, [data])

  const sortedData = useMemo(() => [...data].sort((a,b) => {
    const av = a[sortCol]??0; const bv = b[sortCol]??0
    return sortDir === 'asc' ? av-bv : bv-av
  }), [data, sortCol, sortDir])

  function handleSort(col) {
    if (sortCol===col) setSortDir(d=>d==='asc'?'desc':'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const systemContext = useMemo(() => ({
    sede, anno, mese,
    operatoriAttivi: kpis.operatoriAttivi,
    mediaPezzi: kpis.mediaPezzi,
    totFatturato: kpis.totFatturato,
    mediaPctTarget: kpis.mediaPctTarget,
    topCameriere: data[0]?.operatore,
    sottoQuorum: data.filter(d=>d.stato_kpi?.toLowerCase().includes('sotto')).length,
  }), [data, sede, anno, mese, kpis])

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users className="text-purple-600" size={26} />
          Performance Camerieri &amp; Operatori
        </h1>
        <p className="text-gray-500 text-sm mt-1">KPI mensili, pezzi venduti, % target e trend team</p>
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
          <label className="block text-xs font-medium text-gray-600 mb-1">Anno</label>
          <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={anno} onChange={e=>setAnno(Number(e.target.value))}>
            {[2024,2025,2026].map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Mese</label>
          <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={mese} onChange={e=>setMese(Number(e.target.value))}>
            {MONTHS.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <button onClick={fetchData} className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 flex items-center gap-1">
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
          <KpiCard icon={Users} label="Operatori attivi" color="indigo"
            value={kpis.operatoriAttivi||0} sub={`${MONTHS.find(m=>m.value===mese)?.label} ${anno}`} />
          <KpiCard icon={TrendingUp} label="Media pezzi/operatore" color="green"
            value={kpis.mediaPezzi||0} sub="pezzi venduti" />
          <KpiCard icon={Award} label="Fatturato stimato team" color="purple"
            value={(kpis.totFatturato||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})} sub="fatturato stimato" />
          <KpiCard icon={Target} label="% Target medio team" color="yellow"
            value={`${(kpis.mediaPctTarget||0).toFixed(0)}%`} sub="raggiungimento quantum" />
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">Errore: {error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* PEZZI PER OPERATORE */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-purple-500"/> Pezzi per Operatore
          </h2>
          {data.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400">
              <Users size={36} className="mb-2 opacity-40"/><p className="text-sm">Nessun dato disponibile</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={sortedData} layout="vertical" margin={{top:0,right:50,left:80,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0"/>
                <XAxis type="number" fontSize={11}/>
                <YAxis dataKey="operatore" type="category" width={75} fontSize={11}
                  tickFormatter={v=>v?.length>10?v.slice(0,9)+'…':v}/>
                <Tooltip content={<CustomBarTooltip/>}/>
                <Bar dataKey="tot_pezzi" name="Pezzi" radius={[0,4,4,0]}>
                  {sortedData.map((entry,i)=>(
                    <Cell key={i} fill={statusColor(entry.stato_kpi)}/>
                  ))}
                  <LabelList dataKey="tot_pezzi" position="right" fontSize={11}/>
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* % TARGET */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Target size={16} className="text-purple-500"/> % Raggiungimento Target
          </h2>
          {data.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400">
              <Target size={36} className="mb-2 opacity-40"/><p className="text-sm">Nessun dato disponibile</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={sortedData} layout="vertical" margin={{top:0,right:60,left:80,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0"/>
                <XAxis type="number" domain={[0,150]} tickFormatter={v=>`${v}%`} fontSize={11}/>
                <YAxis dataKey="operatore" type="category" width={75} fontSize={11}
                  tickFormatter={v=>v?.length>10?v.slice(0,9)+'…':v}/>
                <Tooltip formatter={v=>`${v?.toFixed(1)}%`} content={<CustomBarTooltip/>}/>
                <ReferenceLine x={100} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={2}
                  label={{value:'Quantum 100%',position:'top',fontSize:10,fill:'#ef4444'}}/>
                <ReferenceLine x={90} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1.5}
                  label={{value:'Quorum 90%',position:'insideTopRight',fontSize:10,fill:'#f59e0b'}}/>
                <Bar dataKey="pct_target" name="% Target" radius={[0,4,4,0]}>
                  {sortedData.map((entry,i)=>(
                    <Cell key={i} fill={statusColor(entry.stato_kpi)}/>
                  ))}
                  <LabelList dataKey="pct_target" position="right" fontSize={11} formatter={v=>`${v?.toFixed(0)}%`}/>
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* TREND MENSILE */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-purple-500"/> Trend Mensile Pezzi Team (ultimi 6 mesi)
        </h2>
        {trendData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <TrendingUp size={36} className="mb-2 opacity-40"/><p className="text-sm">Nessun dato trend disponibile</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={trendData} margin={{top:10,right:30,left:10,bottom:0}}>
              <defs>
                <linearGradient id="colorMA" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05}/>
                </linearGradient>
                <linearGradient id="colorPN" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.05}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="mese" fontSize={11}/>
              <YAxis fontSize={11}/>
              <Tooltip/>
              <Legend/>
              <Area type="monotone" dataKey="MA" name="Mameli" stroke="#6366f1" fill="url(#colorMA)" strokeWidth={2}/>
              <Area type="monotone" dataKey="PN" name="Predda Niedda" stroke="#10b981" fill="url(#colorPN)" strokeWidth={2}/>
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* TABELLA DETTAGLIO */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Users size={16} className="text-purple-500"/> Dettaglio Operatori
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                {[
                  {key:'operatore',label:'Operatore'},{key:'tot_pezzi',label:'Pezzi'},
                  {key:'pct_pezzi_team',label:'% Team'},{key:'fatturato_stimato_operatore',label:'Fatturato Stimato'},
                  {key:'quantum_target',label:'Quantum'},{key:'pct_target',label:'% Target'},
                  {key:'stato_kpi',label:'Stato'},{key:'tot_importo_aggiunte',label:'Aggiunte €'},
                ].map(col=>(
                  <th key={col.key} onClick={()=>handleSort(col.key)}
                    className="pb-2 pr-4 font-semibold text-gray-600 cursor-pointer hover:text-purple-600 select-none whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      {col.label}
                      {sortCol===col.key&&(sortDir==='asc'?<ChevronUp size={12}/>:<ChevronDown size={12}/>)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedData.map((row,i)=>(
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 pr-4 font-semibold text-gray-800">{row.operatore}</td>
                  <td className="py-2 pr-4">{row.tot_pezzi}</td>
                  <td className="py-2 pr-4">{(row.pct_pezzi_team||0).toFixed(1)}%</td>
                  <td className="py-2 pr-4">{(row.fatturato_stimato_operatore||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}</td>
                  <td className="py-2 pr-4">{row.quantum_target}</td>
                  <td className="py-2 pr-4">
                    <span className={`font-semibold ${(row.pct_target||0)>=100?'text-green-600':(row.pct_target||0)>=90?'text-yellow-600':'text-red-600'}`}>
                      {(row.pct_target||0).toFixed(0)}%
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusBadge(row.stato_kpi)}`}>
                      {row.stato_kpi||'—'}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{(row.tot_importo_aggiunte||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}</td>
                </tr>
              ))}
              {sortedData.length===0&&(
                <tr><td colSpan={8} className="py-12 text-center text-gray-400">
                  <Users size={32} className="mx-auto mb-2 opacity-40"/>Nessun operatore trovato
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PageAssistant pageId="camerieri-bi" systemContext={systemContext}
        suggestions={[
          "Chi è il cameriere più performante questo mese?",
          "Chi è sotto il quorum questo mese?",
          "Analizza il trend di CAMILLA negli ultimi 6 mesi",
          "Qual è la proiezione fine mese per ogni cameriere?",
        ]}/>
    </div>
  )
}
