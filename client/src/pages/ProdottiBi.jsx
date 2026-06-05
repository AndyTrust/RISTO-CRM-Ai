import { useState, useEffect, useMemo } from 'react'
import supabase from '../supabase'
import PageAssistant from '../components/PageAssistant'
import {
  ScatterChart, Scatter, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, Cell, ResponsiveContainer, LabelList
} from 'recharts'
import {
  Package, TrendingUp, AlertTriangle, Star, Filter,
  ArrowUpDown, ChevronUp, ChevronDown, Search
} from 'lucide-react'

const SEDE_OPTIONS = [
  { value: 'MA', label: 'Mameli (CA)' },
  { value: 'PN', label: 'Predda Niedda (SS)' },
  { value: 'ALL', label: 'Entrambe' },
]

const TIPO_OPTIONS = [
  { value: 'ALL', label: 'Tutti' },
  { value: 'piatto', label: 'Piatti' },
  { value: 'drink', label: 'Drink' },
]

const getClassColor = (fc) => {
  if (fc <= 25) return '#22c55e'
  if (fc <= 35) return '#f97316'
  return '#ef4444'
}

const getClassLabel = (fc) => {
  if (fc <= 25) return 'star'
  if (fc <= 35) return 'plowho'
  return 'dog'
}

const CATEGORY_COLORS = [
  '#6366f1','#f59e0b','#10b981','#3b82f6','#ec4899',
  '#8b5cf6','#14b8a6','#f97316','#ef4444','#84cc16'
]

function KpiCard({ icon: Icon, label, value, sub, color = 'indigo' }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    green: 'bg-green-50 text-green-600 border-green-100',
    orange: 'bg-orange-50 text-orange-600 border-orange-100',
    red: 'bg-red-50 text-red-600 border-red-100',
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

const CustomScatterTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <div className="font-semibold text-gray-800 mb-1">{d.prodotto}</div>
      <div className="text-gray-600">Categoria: <span className="font-medium">{d.categoria}</span></div>
      <div className="text-gray-600">Quantità: <span className="font-medium">{d.quantita}</span></div>
      <div className="text-gray-600">Food Cost: <span className="font-medium">{(d.food_cost_pct||0).toFixed(1)}%</span></div>
      <div className="text-gray-600">Fatturato: <span className="font-medium">{(d.importo_venduto||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}</span></div>
      <div className={`mt-1 font-bold ${(d.food_cost_pct||0)<=25?'text-green-600':(d.food_cost_pct||0)<=35?'text-orange-500':'text-red-600'}`}>
        {getClassLabel(d.food_cost_pct || 0).toUpperCase()}
      </div>
    </div>
  )
}

export default function ProdottiBi() {
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().split('T')[0]
  const todayStr = today.toISOString().split('T')[0]

  const [sede, setSede] = useState('MA')
  const [tipologia, setTipologia] = useState('ALL')
  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo] = useState(todayStr)
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [sortCol, setSortCol] = useState('importo_venduto')
  const [sortDir, setSortDir] = useState('desc')
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('ALL')

  useEffect(() => { fetchData() }, [sede, tipologia, dateFrom, dateTo])

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      // Filtro overlap: il blocco interseca il range selezionato
      let q = supabase
        .from('v_menu_engineering')
        .select('*')
        .gte('data_fine', dateFrom)
        .lte('data_inizio', dateTo)
        .range(0, 9999)
      if (sede !== 'ALL') q = q.eq('sede', sede)
      if (tipologia !== 'ALL') q = q.eq('tipologia', tipologia)
      const { data: rows, error: err } = await q
      if (err) throw err
      // Aggrega lato client per prodotto (il range può coprire più blocchi periodo)
      const map = {}
      ;(rows || []).forEach(r => {
        const key = `${r.prodotto}||${r.categoria}`
        if (!map[key]) {
          map[key] = {
            prodotto: r.prodotto, categoria: r.categoria, tipologia: r.tipologia,
            quantita: 0, importo_venduto: 0, fcWeight: 0, fcQty: 0,
          }
        }
        const m = map[key]
        const qta = Number(r.quantita) || 0
        m.quantita += qta
        m.importo_venduto += Number(r.importo_venduto) || 0
        if (r.food_cost_pct != null && qta > 0) {
          m.fcWeight += Number(r.food_cost_pct) * qta
          m.fcQty += qta
        }
      })
      const agg = Object.values(map).map(m => {
        const food_cost_pct = m.fcQty > 0 ? m.fcWeight / m.fcQty : null
        return {
          prodotto: m.prodotto, categoria: m.categoria, tipologia: m.tipologia,
          quantita: m.quantita,
          importo_venduto: m.importo_venduto,
          prezzo_medio: m.quantita > 0 ? m.importo_venduto / m.quantita : 0,
          food_cost_pct,
          menu_class: food_cost_pct == null ? 'n/a' : getClassLabel(food_cost_pct),
        }
      }).sort((a, b) => b.importo_venduto - a.importo_venduto)
      setData(agg)
    } catch (e) {
      setError(e.message)
      setData([])
    } finally {
      setLoading(false)
    }
  }

  const categories = useMemo(() => [...new Set(data.map(d => d.categoria).filter(Boolean))], [data])

  const filtered = useMemo(() => data.filter(d => {
    const matchSearch = !search || d.prodotto?.toLowerCase().includes(search.toLowerCase())
    const matchCat = catFilter === 'ALL' || d.categoria === catFilter
    return matchSearch && matchCat
  }), [data, search, catFilter])

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const av = a[sortCol] ?? 0; const bv = b[sortCol] ?? 0
    return sortDir === 'asc' ? (typeof av === 'string' ? av.localeCompare(bv) : av - bv)
      : (typeof bv === 'string' ? bv.localeCompare(av) : bv - av)
  }), [filtered, sortCol, sortDir])

  const scatterData = useMemo(() => data
    .filter(d => d.quantita > 0 && d.food_cost_pct != null)
    .map(d => ({ ...d, z: Math.max(6, Math.min(50, (d.importo_venduto || 0) / 50)) })), [data])

  const top15 = useMemo(() => [...data].sort((a,b)=>(b.importo_venduto||0)-(a.importo_venduto||0)).slice(0,15), [data])

  const kpis = useMemo(() => {
    if (!data.length) return {}
    const topPcs = [...data].sort((a,b)=>(b.quantita||0)-(a.quantita||0))[0]
    const totalRev = data.reduce((s,d)=>s+(d.importo_venduto||0),0)
    const fcRows = data.filter(d=>d.food_cost_pct!=null)
    const fcQty = fcRows.reduce((s,d)=>s+(d.quantita||0),0)
    const avgFc = fcQty>0 ? fcRows.reduce((s,d)=>s+d.food_cost_pct*(d.quantita||0),0)/fcQty : 0
    const highFc = data.filter(d=>(d.food_cost_pct??0)>30).length
    return { topPcs, totalRev, avgFc, highFc }
  }, [data])

  const insights = useMemo(() => {
    if (!data.length) return []
    const out = []
    const totalRev = data.reduce((s,d)=>s+(d.importo_venduto||0),0)
    const top = [...data].sort((a,b)=>(b.importo_venduto||0)-(a.importo_venduto||0)).slice(0,3)
    if (top.length && totalRev > 0) {
      const topPct = top.reduce((s,d)=>s+(d.importo_venduto||0),0)/totalRev*100
      out.push({
        tone: 'green',
        text: `I top 3 prodotti per fatturato (${top.map(t=>t.prodotto).join(', ')}) generano il ${topPct.toFixed(0)}% del revenue prodotti del periodo (${top.reduce((s,d)=>s+(d.importo_venduto||0),0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}).`,
      })
    }
    const dogs = data.filter(d=>d.menu_class==='dog').sort((a,b)=>(b.importo_venduto||0)-(a.importo_venduto||0))
    if (dogs.length) {
      out.push({
        tone: 'red',
        text: `${dogs.length} prodotti in classe DOG (food cost > 35%): da rivedere in priorità ${dogs.slice(0,3).map(d=>`${d.prodotto} (FC ${d.food_cost_pct?.toFixed(1)}%)`).join(', ')} — valuta ricalcolo porzioni, prezzo o rimozione dal menù.`,
      })
    }
    const noFc = data.filter(d=>d.food_cost_pct==null).length
    if (noFc > 0) {
      out.push({
        tone: 'orange',
        text: `Il ${(noFc/data.length*100).toFixed(0)}% dei prodotti (${noFc} su ${data.length}) non ha food cost censito: completa il listino food cost per un'analisi menu engineering affidabile.`,
      })
    }
    return out
  }, [data])

  const catColorMap = useMemo(() => {
    const m = {}
    categories.forEach((c,i) => { m[c] = CATEGORY_COLORS[i % CATEGORY_COLORS.length] })
    return m
  }, [categories])

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const systemContext = useMemo(() => ({
    sede, tipologia, dateFrom, dateTo,
    totalProdotti: data.length,
    totalRevenue: kpis.totalRev,
    avgFoodCost: kpis.avgFc,
    topProdotto: kpis.topPcs?.prodotto,
    prodottiAltoCosto: kpis.highFc,
    stars: data.filter(d=>d.menu_class==='star').length,
    plowhos: data.filter(d=>d.menu_class==='plowho').length,
    dogs: data.filter(d=>d.menu_class==='dog').length,
  }), [data, sede, tipologia, dateFrom, dateTo, kpis])

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Package className="text-indigo-600" size={26} />
          Menu Engineering &amp; Prodotti
        </h1>
        <p className="text-gray-500 text-sm mt-1">Analisi BCG, food cost e performance prodotti</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Sede</label>
          <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={sede} onChange={e=>setSede(e.target.value)}>
            {SEDE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Tipologia</label>
          <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={tipologia} onChange={e=>setTipologia(e.target.value)}>
            {TIPO_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Dal</label>
          <input type="date" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Al</label>
          <input type="date" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={dateTo} onChange={e=>setDateTo(e.target.value)} />
        </div>
        <button onClick={fetchData} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-1">
          <Filter size={14} /> Applica
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_,i)=><div key={i} className="bg-white rounded-xl border border-gray-200 p-4 h-24 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard icon={Star} label="Top prodotto (pezzi)" color="indigo"
            value={kpis.topPcs?.prodotto || '—'} sub={kpis.topPcs ? `${kpis.topPcs.quantita} pz venduti` : ''} />
          <KpiCard icon={TrendingUp} label="Revenue totale prodotti" color="green"
            value={(kpis.totalRev||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})} sub={`su ${data.length} prodotti`} />
          <KpiCard icon={Package} label="Food cost medio" color="orange"
            value={`${(kpis.avgFc||0).toFixed(1)}%`} sub="media ponderata" />
          <KpiCard icon={AlertTriangle} label="Prodotti FC > 30%" color="red"
            value={kpis.highFc || 0} sub="da ottimizzare" />
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">Errore: {error}</div>}

      {/* ANALISI / INSIGHT */}
      {!loading && insights.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <TrendingUp size={16} className="text-indigo-500" /> Analisi
          </h2>
          <ul className="space-y-2">
            {insights.map((ins, i) => (
              <li key={i} className={`flex items-start gap-2 text-sm rounded-lg p-3 border ${
                ins.tone==='green' ? 'bg-green-50 border-green-100 text-green-800'
                : ins.tone==='red' ? 'bg-red-50 border-red-100 text-red-800'
                : 'bg-orange-50 border-orange-100 text-orange-800'}`}>
                {ins.tone==='green' ? <Star size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
                <span>{ins.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* SCATTER BCG */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <Star size={16} className="text-indigo-500" /> Matrice BCG — Quantità vs Food Cost
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Dimensione bolla = fatturato ·
          <span className="text-green-600 font-medium"> Verde</span> = Star (FC≤25%) ·
          <span className="text-orange-500 font-medium"> Arancio</span> = Plow Horse (25-35%) ·
          <span className="text-red-500 font-medium"> Rosso</span> = Dog (&gt;35%)
        </p>
        {scatterData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Package size={40} className="mb-3 opacity-40" />
            <p>Nessun dato disponibile per il periodo selezionato</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={420}>
            <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="quantita" name="Quantità" type="number" fontSize={11}
                label={{ value: 'Pezzi venduti', position: 'insideBottom', offset: -15, fontSize: 12 }} />
              <YAxis dataKey="food_cost_pct" name="Food Cost %" type="number" fontSize={11}
                label={{ value: 'Food Cost %', angle: -90, position: 'insideLeft', fontSize: 12 }} domain={[0,'auto']} />
              <Tooltip content={<CustomScatterTooltip />} />
              <Scatter data={scatterData} shape={(props) => {
                const { cx, cy, payload } = props
                const r = payload.z || 10
                const color = getClassColor(payload.food_cost_pct || 0)
                return (
                  <g>
                    <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={0.65} stroke={color} strokeWidth={1.5} />
                    {r > 12 && (
                      <text x={cx} y={cy - r - 3} textAnchor="middle" fontSize={9} fill="#374151" fontWeight="600">
                        {(payload.prodotto || '').slice(0, 13)}
                      </text>
                    )}
                  </g>
                )
              }} />
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* TOP 15 BAR */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-indigo-500" /> Top 15 Prodotti per Fatturato
        </h2>
        {top15.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Package size={36} className="mb-2 opacity-40" /><p className="text-sm">Nessun dato disponibile</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={top15} layout="vertical" margin={{ top: 0, right: 50, left: 110, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" tickFormatter={v=>`€${(v/1000).toFixed(1)}k`} fontSize={11} />
              <YAxis dataKey="prodotto" type="category" width={105} fontSize={11}
                tickFormatter={v=>v?.length>15?v.slice(0,14)+'…':v} />
              <Tooltip formatter={v=>v.toLocaleString('it-IT',{style:'currency',currency:'EUR'})} />
              <Bar dataKey="importo_venduto" name="Fatturato" radius={[0,4,4,0]}>
                {top15.map((entry, i)=><Cell key={i} fill={catColorMap[entry.categoria]||'#6366f1'} />)}
                <LabelList dataKey="importo_venduto" position="right" fontSize={10}
                  formatter={v=>`€${(v/1000).toFixed(1)}k`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* TABELLA */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex flex-wrap gap-3 items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <ArrowUpDown size={16} className="text-indigo-500" /> Tutti i Prodotti ({filtered.length})
          </h2>
          <div className="flex gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input placeholder="Cerca prodotto…" value={search} onChange={e=>setSearch(e.target.value)}
                className="border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm w-44" />
            </div>
            <select value={catFilter} onChange={e=>setCatFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="ALL">Tutte le categorie</option>
              {categories.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                {[
                  {key:'prodotto',label:'Prodotto'},{key:'categoria',label:'Categoria'},
                  {key:'quantita',label:'Qta'},{key:'prezzo_medio',label:'Prezzo Medio'},
                  {key:'importo_venduto',label:'Fatturato'},{key:'food_cost_pct',label:'Food Cost %'},
                  {key:'menu_class',label:'Classe'},
                ].map(col=>(
                  <th key={col.key} onClick={()=>handleSort(col.key)}
                    className="pb-2 pr-4 font-semibold text-gray-600 cursor-pointer hover:text-indigo-600 select-none whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      {col.label}
                      {sortCol===col.key&&(sortDir==='asc'?<ChevronUp size={12}/>:<ChevronDown size={12}/>)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0,100).map((row,i)=>{
                const fc = row.food_cost_pct
                const cls = row.menu_class || (fc!=null ? getClassLabel(fc) : 'n/a')
                const badgeColor = cls==='star'?'bg-green-100 text-green-700':cls==='plowho'?'bg-orange-100 text-orange-700':cls==='dog'?'bg-red-100 text-red-700':'bg-gray-100 text-gray-500'
                return (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-2 pr-4 font-medium text-gray-800">{row.prodotto}</td>
                    <td className="py-2 pr-4">
                      <span className="text-xs px-2 py-0.5 rounded-full text-white"
                        style={{background:catColorMap[row.categoria]||'#6366f1'}}>{row.categoria}</span>
                    </td>
                    <td className="py-2 pr-4 text-gray-700">{row.quantita}</td>
                    <td className="py-2 pr-4 text-gray-700">{(row.prezzo_medio||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}</td>
                    <td className="py-2 pr-4 font-semibold text-gray-800">{(row.importo_venduto||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})}</td>
                    <td className="py-2 pr-4">
                      {fc!=null
                        ? <span className={`font-semibold ${fc>30?'text-red-600':fc>25?'text-orange-500':'text-green-600'}`}>{fc.toFixed(1)}%</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${badgeColor}`}>{cls?.toUpperCase()}</span>
                    </td>
                  </tr>
                )
              })}
              {sorted.length===0&&(
                <tr><td colSpan={7} className="py-12 text-center text-gray-400">
                  <Package size={32} className="mx-auto mb-2 opacity-40" />Nessun prodotto trovato
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PageAssistant pageId="prodotti-bi" systemContext={systemContext}
        suggestions={[
          "Quali sono i prodotti meno profittevoli da rimuovere?",
          "Quale categoria ha il food cost più alto?",
          "Confronta menu engineering MA vs PN",
          "Quali prodotti devo spingere di più?",
        ]} />
    </div>
  )
}
