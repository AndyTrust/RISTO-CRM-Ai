/**
 * MenuEngineering.jsx — Menu Engineering & Analisi Venduto per Categoria
 * Mostra top categorie per fatturato, food cost%, prezzo medio da venduto_categorie.
 */
import React, { useEffect, useState, useMemo } from 'react'
import supabase from '../supabase'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, Cell
} from 'recharts'
import {
  ChefHat, ShoppingBag, TrendingDown, Euro, Loader,
  AlertCircle, ChevronDown, ChevronUp, Tag
} from 'lucide-react'
import PageAssistant from '../components/PageAssistant'

// ── Helpers ─────────────────────────────────────────────────────────────────
const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#3b82f6', '#06b6d4']
const SEDE_OPTS = [
  { value: 'all', label: 'Entrambe' },
  { value: 'MA',  label: 'Mameli (MA)' },
  { value: 'PN',  label: 'Predda Niedda (PN)' },
]
const TIPO_OPTS = [
  { value: 'all',   label: 'Tutti' },
  { value: 'piatto', label: 'Piatto' },
  { value: 'drink',  label: 'Drink' },
]

function eur(n) {
  return n != null
    ? `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—'
}
function fmt(n) { return n != null ? Number(n).toLocaleString('it-IT') : '—' }
function pctFmt(n) { return n != null ? `${Number(n).toFixed(1)}%` : '—' }

// Mese corrente
function meseCorrente() {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const y = now.getFullYear(); const m = now.getMonth() + 1
  return {
    from: `${y}-${pad(m)}-01`,
    to:   `${y}-${pad(m)}-${pad(now.getDate())}`,
  }
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

// ── Tooltip fatturato ─────────────────────────────────────────────────────────
function FattTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-semibold text-gray-800 mb-1">{label || '—'}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-gray-600">{p.name}: <b>{eur(p.value)}</b></span>
        </div>
      ))}
    </div>
  )
}

// ── Tooltip food cost ─────────────────────────────────────────────────────────
function FCTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-semibold text-gray-800 mb-1">{label || '—'}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-gray-600">Food Cost: <b>{pctFmt(p.value)}</b></span>
        </div>
      ))}
      <div className="text-gray-400 mt-1">Benchmark: 28%</div>
    </div>
  )
}

// ── Tabella ordinabile ────────────────────────────────────────────────────────
function Tabella({ rows }) {
  const [sortKey, setSortKey] = useState('totale')
  const [sortDir, setSortDir] = useState('desc')

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? 0
      const bv = b[sortKey] ?? 0
      if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
  }, [rows, sortKey, sortDir])

  const toggle = (k) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('desc') }
  }

  const Th = ({ k, label, right }) => (
    <th
      onClick={() => toggle(k)}
      className={`px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-800 transition-colors ${right ? 'text-right' : 'text-left'}`}
    >
      <span className={`flex items-center gap-1 ${right ? 'justify-end' : ''}`}>
        {label}
        {sortKey === k
          ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
          : <ChevronDown size={12} className="text-gray-300" />}
      </span>
    </th>
  )

  if (!sorted.length) return (
    <div className="text-center py-12 text-gray-400 text-sm">Nessun dato disponibile per il periodo selezionato.</div>
  )

  // Valore max food_cost per colorare la barra
  const maxFC = Math.max(...sorted.map(r => r.food_cost_pct || 0), 1)

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <Th k="categoria"    label="Categoria" />
            <Th k="tipologia"    label="Tipo" />
            <Th k="quantita"     label="Pezzi" right />
            <Th k="totale"       label="Fatturato" right />
            <Th k="food_cost_pct" label="Food Cost%" right />
            <Th k="prezzo_medio" label="Prezzo Medio" right />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {sorted.map((r, i) => {
            const fc = r.food_cost_pct
            const fcColor = fc > 35 ? 'text-rose-600' : fc > 28 ? 'text-amber-600' : 'text-emerald-600'
            return (
              <tr key={i} className="hover:bg-gray-50 transition-colors">
                <td className="px-3 py-2 font-medium text-gray-800">
                  <span className="flex items-center gap-1.5">
                    <Tag size={12} className="text-gray-400" />
                    {r.categoria || 'Totale'}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {r.tipologia && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      {r.tipologia}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-gray-700">{fmt(r.quantita)}</td>
                <td className="px-3 py-2 text-right font-semibold text-gray-900">{eur(r.totale)}</td>
                <td className="px-3 py-2 text-right">
                  {fc != null ? (
                    <span className={`font-semibold ${fcColor}`}>{pctFmt(fc)}</span>
                  ) : '—'}
                </td>
                <td className="px-3 py-2 text-right text-gray-600">{eur(r.prezzo_medio)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Componente principale ─────────────────────────────────────────────────────
export default function MenuEngineering() {
  const [sede, setSede]   = useState('all')
  const [tipo, setTipo]   = useState('all')
  const [dates, setDates] = useState(meseCorrente())
  const [rows, setRows]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  // Carica dati da Supabase
  useEffect(() => {
    setLoading(true)
    setError(null)

    let q = supabase.from('venduto_categorie').select('*')
    if (sede !== 'all') q = q.eq('sede', sede)
    if (tipo !== 'all') q = q.eq('tipologia', tipo)
    if (dates.from) q = q.gte('data_inizio', dates.from)
    if (dates.to)   q = q.lte('data_fine',   dates.to)
    q = q.range(0, 4999)

    q.then(({ data, error: e }) => {
      if (e) throw e
      setRows(data ?? [])
    }).catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [sede, tipo, dates])

  // ── Aggregazione per categoria ───────────────────────────────────────────
  const byCategoria = useMemo(() => {
    const map = {}
    rows.forEach(r => {
      const k = r.categoria || 'Totale'
      if (!map[k]) map[k] = {
        categoria: k,
        tipologia: r.tipologia,
        quantita: 0,
        totale: 0,
        n_doc: 0,
        fc_sum: 0,
        fc_count: 0,
        pm_sum: 0,
        pm_count: 0,
      }
      map[k].quantita  += Number(r.quantita)  || 0
      map[k].totale    += Number(r.totale)     || 0
      map[k].n_doc     += Number(r.n_documenti) || 0
      if (r.food_cost_pct != null) { map[k].fc_sum += Number(r.food_cost_pct); map[k].fc_count++ }
      if (r.prezzo_medio  != null) { map[k].pm_sum += Number(r.prezzo_medio);  map[k].pm_count++ }
    })
    return Object.values(map).map(c => ({
      ...c,
      food_cost_pct: c.fc_count > 0 ? c.fc_sum / c.fc_count : null,
      prezzo_medio:  c.pm_count > 0 ? c.pm_sum / c.pm_count : null,
    })).sort((a, b) => b.totale - a.totale)
  }, [rows])

  // ── KPI aggregati ────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const totPezzi   = byCategoria.reduce((s, r) => s + r.quantita, 0)
    const totFattura = byCategoria.reduce((s, r) => s + r.totale,   0)
    const fcRows     = byCategoria.filter(r => r.food_cost_pct != null)
    const fcMedio    = fcRows.length > 0
      ? fcRows.reduce((s, r) => s + r.food_cost_pct, 0) / fcRows.length
      : null
    const pmRows = byCategoria.filter(r => r.prezzo_medio != null)
    const pmMedio = pmRows.length > 0
      ? pmRows.reduce((s, r) => s + r.prezzo_medio, 0) / pmRows.length
      : null
    return { totPezzi, totFattura, fcMedio, pmMedio }
  }, [byCategoria])

  // ── Dati grafici (top 10 per fatturato) ──────────────────────────────────
  const topCat    = byCategoria.slice(0, 10)
  const chartFatt = topCat.map((r, i) => ({ name: r.categoria, fatturato: r.totale, fill: COLORS[i % COLORS.length] }))
  const chartFC   = topCat
    .filter(r => r.food_cost_pct != null)
    .map((r, i) => ({ name: r.categoria, food_cost_pct: r.food_cost_pct, fill: COLORS[i % COLORS.length] }))
    .sort((a, b) => b.food_cost_pct - a.food_cost_pct)

  // ── systemContext per PageAssistant ──────────────────────────────────────
  const systemContext = useMemo(() => {
    return `Pagina: Menu Engineering
Sede: ${sede === 'all' ? 'Entrambe (MA + PN)' : sede}
Tipologia: ${tipo === 'all' ? 'Tutti' : tipo}
Periodo: ${dates.from} → ${dates.to}
KPI:
- Tot. Pezzi Venduti: ${fmt(kpi.totPezzi)}
- Fatturato Totale: ${eur(kpi.totFattura)}
- Food Cost% Medio: ${pctFmt(kpi.fcMedio)}
- Prezzo Medio: ${eur(kpi.pmMedio)}
Categorie (top 5): ${byCategoria.slice(0, 5).map(c => `${c.categoria} (${eur(c.totale)}, FC ${pctFmt(c.food_cost_pct)})`).join(' | ')}
Categorie con food cost > 28%: ${byCategoria.filter(c => c.food_cost_pct > 28).map(c => c.categoria).join(', ') || 'nessuna'}
Righe totali: ${rows.length}`
  }, [kpi, sede, tipo, dates, byCategoria, rows.length])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ChefHat size={22} className="text-emerald-500" />
            Menu Engineering
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Analisi fatturato, food cost e pezzi venduti per categoria
          </p>
        </div>

        {/* Controlli */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Sede */}
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
          {/* Tipo */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {TIPO_OPTS.map(o => (
              <button key={o.value} onClick={() => setTipo(o.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  tipo === o.value ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {o.label}
              </button>
            ))}
          </div>
          {/* Date */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600">
            <input type="date" value={dates.from}
              onChange={e => setDates(d => ({ ...d, from: e.target.value }))}
              className="outline-none bg-transparent" />
            <span className="text-gray-400">→</span>
            <input type="date" value={dates.to}
              onChange={e => setDates(d => ({ ...d, to: e.target.value }))}
              className="outline-none bg-transparent" />
          </div>
        </div>
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
          <span className="text-sm">Caricamento dati...</span>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard
              icon={ShoppingBag}
              label="Tot. Pezzi Venduti"
              value={fmt(kpi.totPezzi)}
              sub="quantità totale venduta"
              color="#7c3aed"
            />
            <KPICard
              icon={Euro}
              label="Fatturato Categorie"
              value={eur(kpi.totFattura)}
              sub="periodo selezionato"
              color="#10b981"
            />
            <KPICard
              icon={TrendingDown}
              label="Food Cost% Medio"
              value={pctFmt(kpi.fcMedio)}
              sub={kpi.fcMedio != null && kpi.fcMedio > 28 ? '⚠ sopra benchmark 28%' : 'benchmark: 28%'}
              color={kpi.fcMedio != null && kpi.fcMedio > 28 ? '#ef4444' : '#f59e0b'}
            />
            <KPICard
              icon={Tag}
              label="Prezzo Medio"
              value={eur(kpi.pmMedio)}
              sub="media tra categorie"
              color="#6366f1"
            />
          </div>

          {/* Grafici */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* BarChart top categorie per fatturato */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-1">Top Categorie per Fatturato</h2>
              <p className="text-xs text-gray-400 mb-4">Prime 10 categorie ordinate per fatturato</p>
              {chartFatt.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Nessun dato</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartFatt} layout="vertical" margin={{ top: 0, right: 20, left: 60, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10 }}
                      tickFormatter={v => `€${(v / 1000).toFixed(1)}k`}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      width={55}
                    />
                    <Tooltip content={<FattTooltip />} />
                    <Bar dataKey="fatturato" name="Fatturato" radius={[0, 4, 4, 0]}>
                      {chartFatt.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* BarChart food cost% con linea benchmark */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-1">Food Cost% per Categoria</h2>
              <p className="text-xs text-gray-400 mb-4">
                Linea rossa = benchmark 28% — sopra: attenzione
              </p>
              {chartFC.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Dati food cost non disponibili</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartFC} layout="vertical" margin={{ top: 0, right: 40, left: 60, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10 }}
                      tickFormatter={v => `${v.toFixed(0)}%`}
                      domain={[0, 'dataMax + 5']}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      width={55}
                    />
                    <Tooltip content={<FCTooltip />} />
                    <ReferenceLine x={28} stroke="#ef4444" strokeDasharray="4 3" strokeWidth={2}
                      label={{ value: '28%', position: 'insideTopRight', fontSize: 10, fill: '#ef4444' }} />
                    <Bar dataKey="food_cost_pct" name="Food Cost%" radius={[0, 4, 4, 0]}>
                      {chartFC.map((entry, i) => (
                        <Cell key={i} fill={entry.food_cost_pct > 28 ? '#ef4444' : '#10b981'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Tabella Menu Engineering */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-1">Dettaglio per Categoria</h2>
            <p className="text-xs text-gray-400 mb-4">
              Clicca sulle intestazioni per ordinare — food cost
              <span className="text-emerald-600 font-medium"> verde ≤ 28%</span>,
              <span className="text-amber-600 font-medium"> giallo 28–35%</span>,
              <span className="text-rose-600 font-medium"> rosso &gt; 35%</span>
            </p>
            <Tabella rows={byCategoria} />
          </div>
        </>
      )}

      {/* PageAssistant */}
      <PageAssistant
        pagina="menu-engineering"
        systemContext={systemContext}
        suggerimenti={[
          'Quale categoria ha il food cost più alto?',
          'Quali sono i piatti più venduti?',
          'Confronta food cost MA vs PN',
        ]}
      />
    </div>
  )
}
