import React, { useState, useEffect, useCallback } from 'react'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell, ComposedChart
} from 'recharts'
import {
  TrendingUp, TrendingDown, Minus, Target, Users, BarChart2,
  Calendar, Zap, AlertTriangle, CheckCircle, ChevronRight,
  RefreshCw, ArrowUpRight, ArrowDownRight, Star, Award
} from 'lucide-react'
import { analytics as analyticsApi, data as dataApi } from '../api/client'
import PageAssistant from '../components/PageAssistant'

// ── Colori ──────────────────────────────────────────────────────────────────
const C = {
  MA:      '#6366f1',
  PN:      '#10b981',
  warn:    '#f59e0b',
  danger:  '#ef4444',
  up:      '#22c55e',
  down:    '#ef4444',
  neutral: '#94a3b8',
  forecast:'#a78bfa',
}

const LOC_LABEL = { MAMELI: 'Sede MA (MA)', PREDDA_NIEDDA: 'Sede PN (PN)' }
const MESI_IT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']

// ── Componenti UI ────────────────────────────────────────────────────────────
function KPICard({ title, value, sub, delta, icon: Icon, color = '#6366f1', size = 'md' }) {
  const positive = delta > 0
  const DeltaIcon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{title}</span>
        {Icon && <div className="p-1.5 rounded-lg" style={{ backgroundColor: color + '20' }}>
          <Icon size={14} style={{ color }} />
        </div>}
      </div>
      <div className={`font-bold text-gray-900 ${size === 'lg' ? 'text-3xl' : 'text-2xl'}`}>{value}</div>
      <div className="flex items-center gap-2">
        {delta !== undefined && delta !== null && (
          <span className={`flex items-center gap-0.5 text-xs font-semibold ${positive ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400'}`}>
            <DeltaIcon size={12} />
            {Math.abs(delta)}%
          </span>
        )}
        {sub && <span className="text-xs text-gray-400">{sub}</span>}
      </div>
    </div>
  )
}

function SectionTitle({ icon: Icon, label, color = '#6366f1' }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-1 h-6 rounded-full" style={{ backgroundColor: color }} />
      <Icon size={18} style={{ color }} />
      <h2 className="font-bold text-gray-800 text-base">{label}</h2>
    </div>
  )
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-4">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
            active === t.id ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// Tooltip customizzato
function CustomTooltip({ active, payload, label, prefix = '€', suffix = '' }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-gray-600">{p.name}:</span>
          <span className="font-medium">{prefix}{typeof p.value === 'number' ? p.value.toLocaleString('it-IT') : p.value}{suffix}</span>
        </div>
      ))}
    </div>
  )
}

// ── Sezione: Overview YoY ────────────────────────────────────────────────────
function OverviewSection({ overview, loading }) {
  const [tab, setTab] = useState('venduto')

  if (loading) return <div className="animate-pulse bg-gray-100 rounded-xl h-48" />
  if (!overview) return null

  const { yoy, kpiBox } = overview

  const ma = kpiBox?.MAMELI || {}
  const pn = kpiBox?.PREDDA_NIEDDA || {}
  const periodoLabel = ma.periodo_label || pn.periodo_label || 'YTD'
  const annoC = ma.anno_corrente || pn.anno_corrente || new Date().getFullYear()
  const annoP = ma.anno_prec || pn.anno_prec || annoC - 1

  const deltaMA_v = ma.venduto_ytd_prec > 0
    ? Math.round(((ma.venduto_ytd - ma.venduto_ytd_prec) / ma.venduto_ytd_prec) * 1000) / 10 : null
  const deltaPN_v = pn.venduto_ytd_prec > 0
    ? Math.round(((pn.venduto_ytd - pn.venduto_ytd_prec) / pn.venduto_ytd_prec) * 1000) / 10 : null
  const deltaMA_cm = ma.cm_avg_prec > 0
    ? Math.round(((ma.cm_avg - ma.cm_avg_prec) / ma.cm_avg_prec) * 1000) / 10 : null
  const deltaPN_cm = pn.cm_avg_prec > 0
    ? Math.round(((pn.cm_avg - pn.cm_avg_prec) / pn.cm_avg_prec) * 1000) / 10 : null

  const tabs = [
    { id: 'venduto', label: 'Venduto' },
    { id: 'coperti', label: 'Coperti' },
  ]

  return (
    <div>
      <SectionTitle icon={TrendingUp} label={`Confronto Anno su Anno — ${periodoLabel} ${annoC} vs ${annoP}`} color={C.MA} />

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KPICard title={`Venduto MA ${periodoLabel} ${annoC}`} value={`€${((ma.venduto_ytd||0)/1000).toFixed(0)}k`}
          sub={`vs €${((ma.venduto_ytd_prec||0)/1000).toFixed(0)}k anno fa`} delta={deltaMA_v} icon={TrendingUp} color={C.MA} />
        <KPICard title={`Venduto PN ${periodoLabel} ${annoC}`} value={`€${((pn.venduto_ytd||0)/1000).toFixed(0)}k`}
          sub={`vs €${((pn.venduto_ytd_prec||0)/1000).toFixed(0)}k anno fa`} delta={deltaPN_v} icon={TrendingUp} color={C.PN} />
        <KPICard title="Cop. Medio MA" value={`€${(ma.cm_avg||0).toFixed(2)}`}
          sub={`vs €${(ma.cm_avg_prec||0).toFixed(2)} anno fa`} delta={deltaMA_cm} icon={Target} color={C.MA} />
        <KPICard title="Cop. Medio PN" value={`€${(pn.cm_avg||0).toFixed(2)}`}
          sub={`vs €${(pn.cm_avg_prec||0).toFixed(2)} anno fa`} delta={deltaPN_cm} icon={Target} color={C.PN} />
      </div>

      {/* Chart YoY */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={yoy} barGap={2} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="mese_label" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => tab === 'venduto' ? `€${(v/1000).toFixed(0)}k` : v.toLocaleString()} tick={{ fontSize: 11 }} />
            <Tooltip content={<CustomTooltip prefix={tab === 'venduto' ? '€' : ''} />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {tab === 'venduto' ? <>
              <Bar dataKey="venduto_2025" name="2025" fill="#cbd5e1" radius={[3,3,0,0]} />
              <Bar dataKey="venduto_2026" name="2026" fill={C.MA} radius={[3,3,0,0]} />
            </> : <>
              <Bar dataKey="coperti_2025" name="Coperti 2025" fill="#cbd5e1" radius={[3,3,0,0]} />
              <Bar dataKey="coperti_2026" name="Coperti 2026" fill={C.PN} radius={[3,3,0,0]} />
            </>}
          </BarChart>
        </ResponsiveContainer>

        {/* Delta pills */}
        <div className="flex flex-wrap gap-2 mt-3">
          {yoy.map(m => {
            const delta = tab === 'venduto' ? m.delta_venduto_pct : m.delta_coperti_pct
            if (delta === null) return null
            const pos = delta >= 0
            return (
              <span key={m.mese} className={`text-xs px-2 py-0.5 rounded-full font-medium ${pos ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                {m.mese_label}: {pos ? '+' : ''}{delta}%
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Sezione: Stagionalità ────────────────────────────────────────────────────
function SeasonalitySection({ seasonality, loading }) {
  if (loading) return <div className="animate-pulse bg-gray-100 rounded-xl h-48" />
  if (!seasonality) return null

  const data = seasonality.combined || []
  const filled = data.filter(d => d.indice_combined !== null)

  // Colore cella heatmap
  const getColor = (v) => {
    if (v === null) return '#f3f4f6'
    if (v >= 1.3) return '#166534'
    if (v >= 1.1) return '#16a34a'
    if (v >= 1.0) return '#4ade80'
    if (v >= 0.9) return '#fbbf24'
    if (v >= 0.7) return '#f97316'
    return '#dc2626'
  }
  const getTextColor = (v) => {
    if (v === null) return '#9ca3af'
    if (v >= 1.1) return '#fff'
    if (v >= 0.9) return '#1f2937'
    return '#fff'
  }

  return (
    <div>
      <SectionTitle icon={Calendar} label="Stagionalità — Indici Mensili 2025" color={C.warn} />

      {/* Heatmap mesi */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4">
        <p className="text-xs text-gray-500 mb-3">Indice &gt;1 = mese sopra la media annuale · &lt;1 = sotto media</p>
        <div className="grid grid-cols-6 md:grid-cols-12 gap-2">
          {data.map(m => (
            <div key={m.mese_num} className="text-center rounded-lg p-2"
              style={{ backgroundColor: getColor(m.indice_combined) }}>
              <div className="text-xs font-bold" style={{ color: getTextColor(m.indice_combined) }}>
                {MESI_IT[(m.mese_num - 1)]}
              </div>
              <div className="text-xs font-semibold mt-0.5" style={{ color: getTextColor(m.indice_combined) }}>
                {m.indice_combined !== null ? `×${m.indice_combined.toFixed(2)}` : '—'}
              </div>
            </div>
          ))}
        </div>

        {/* Legenda */}
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          {[['#dc2626','Molto basso (<0.7)'],['#f97316','Basso'],['#fbbf24','Sotto media'],
            ['#4ade80','Nella media'],['#16a34a','Alto (>1.1)'],['#166534','Molto alto (>1.3)']].map(([c, l]) => (
            <div key={c} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: c }} />
              <span className="text-xs text-gray-500">{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Chart radar stagionalità */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <p className="text-xs font-semibold text-gray-600 mb-3">Andamento Coperto Medio per Mese (2025)</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {['MAMELI','PREDDA_NIEDDA'].map(loc => {
            const rows = (seasonality.byLocation?.[loc] || []).map(r => ({
              month: MESI_IT[r.mese_num - 1],
              cm: r.avg_cm,
              coperti: r.tot_coperti,
            }))
            if (!rows.length) return null
            return (
              <div key={loc}>
                <p className="text-xs text-center font-medium mb-2" style={{ color: loc === 'MAMELI' ? C.MA : C.PN }}>
                  {LOC_LABEL[loc]}
                </p>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={['auto','auto']} />
                    <Tooltip formatter={(v) => [`€${v.toFixed(2)}`, 'Cop. Medio']} />
                    <Area type="monotone" dataKey="cm" name="Coperto Medio"
                      stroke={loc === 'MAMELI' ? C.MA : C.PN}
                      fill={loc === 'MAMELI' ? C.MA + '30' : C.PN + '30'}
                      strokeWidth={2} dot={{ r: 3 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Sezione: Forecast ────────────────────────────────────────────────────────
function ForecastSection({ forecast, loading }) {
  const [loc, setLoc] = useState('MAMELI')
  if (loading) return <div className="animate-pulse bg-gray-100 rounded-xl h-48" />
  if (!forecast) return null

  const data = forecast[loc]
  if (!data) return null

  // Combina storico + forecast in un unico dataset
  const combined = [
    ...(data.storico || []).map(r => ({
      mese: r.mese_label, venduto: r.tot_venduto, coperti: r.tot_coperti, tipo: 'storico',
    })),
    ...(data.forecasts || []).map(r => ({
      mese: r.mese_label + '✦', forecast: r.forecast_venduto,
      forecast_min: r.forecast_min, forecast_max: r.forecast_max, tipo: 'forecast',
    })),
  ]

  const reg = data.regressione || {}

  return (
    <div>
      <SectionTitle icon={Zap} label="Previsioni — Prossimi 3 Mesi" color={C.forecast} />

      <TabBar
        tabs={[{ id: 'MAMELI', label: '🔵 Mameli' },{ id: 'PREDDA_NIEDDA', label: '🟢 Predda Niedda' }]}
        active={loc} onChange={setLoc}
      />

      {/* Forecast cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {(data.forecasts || []).map(f => (
          <div key={f.mese} className="bg-white rounded-xl border border-purple-100 shadow-sm p-4">
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-semibold text-purple-600 uppercase">{f.mese_label}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${f.tendenza === 'crescita' ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'}`}>
                {f.tendenza === 'crescita' ? '↗ Crescita' : '↘ Calo'}
              </span>
            </div>
            <div className="text-2xl font-bold text-gray-900 mb-1">
              €{f.forecast_venduto.toLocaleString('it-IT')}
            </div>
            <div className="text-xs text-gray-500 mb-2">
              Range: €{f.forecast_min.toLocaleString('it-IT')} – €{f.forecast_max.toLocaleString('it-IT')}
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>👥 ~{f.forecast_coperti.toLocaleString('it-IT')} coperti</span>
              <span>🌊 ×{f.coeff_stagionale} stagionale</span>
            </div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-3 mb-3">
          <p className="text-xs font-semibold text-gray-600">Andamento + Previsione Venduto</p>
          <span className="text-xs text-gray-400">R² regressione: {reg.r2}</span>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={combined}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => `€${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="venduto" name="Storico" fill={loc === 'MAMELI' ? C.MA : C.PN} radius={[3,3,0,0]} opacity={0.85} />
            <Bar dataKey="forecast" name="Previsione" fill={C.forecast} radius={[3,3,0,0]} opacity={0.9} />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-xs text-gray-400 mt-2 text-center">
          ✦ Mesi con previsione · Range ±10% confidence interval
        </p>
      </div>
    </div>
  )
}

// ── Sezione: Target Operatori ────────────────────────────────────────────────
function OperatorTargetsSection({ targets, loading }) {
  const [loc, setLoc] = useState('MAMELI')
  const [sortBy, setSortBy] = useState('coperti')
  if (loading) return <div className="animate-pulse bg-gray-100 rounded-xl h-64" />
  if (!targets?.length) return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
      <Target size={28} className="text-amber-400 mx-auto mb-3" />
      <p className="font-semibold text-amber-800 mb-1">Nessun dato operatori disponibile</p>
      <p className="text-sm text-amber-600">Importa i dati venduto camerieri da iPratico per vedere i target smart.</p>
    </div>
  )

  const filtered = targets.filter(t => t.location === loc)
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'coperti') return b.storico.media2m_coperti - a.storico.media2m_coperti
    if (sortBy === 'target') return b.target.coperti_target - a.target.coperti_target
    if (sortBy === 'score') return b.performance.score - a.performance.score
    return 0
  })

  // Chart ranking
  const chartData = sorted.map(t => ({
    name: t.operatore.length > 10 ? t.operatore.slice(0, 9) + '.' : t.operatore,
    media_2m: t.storico.media2m_coperti,
    target: t.target.coperti_target,
    quota: t.performance.quota_mercato_pct,
  }))

  return (
    <div>
      <SectionTitle icon={Target} label="Target Smart per Operatore — Prossimo Mese" color={C.MA} />
      <p className="text-xs text-gray-500 mb-4">
        Base: media coperti gen–feb 2026 · Crescita +10% · Corretto per stagionalità (indice 2025)
      </p>

      <TabBar
        tabs={[{ id: 'MAMELI', label: '🔵 Mameli' },{ id: 'PREDDA_NIEDDA', label: '🟢 Predda Niedda' }]}
        active={loc} onChange={setLoc}
      />

      {/* Ranking chart */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-600">Coperti: Base vs Target</p>
          <div className="flex gap-1">
            {[['coperti','Coperti'],['score','Score'],['quota','Quota%']].map(([id,l]) => (
              <button key={id} onClick={() => setSortBy(id)}
                className={`text-xs px-2 py-1 rounded ${sortBy===id ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-400 hover:text-gray-600'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 36)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={72} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="media_2m" name="Media 2m" fill={loc === 'MAMELI' ? C.MA + '80' : C.PN + '80'} radius={[0,3,3,0]} />
            <Bar dataKey="target" name="Target +10%" fill={loc === 'MAMELI' ? C.MA : C.PN} radius={[0,3,3,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Schede operatori */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sorted.map(op => {
          const trend = op.performance.trend
          const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
          const trendColor = trend === 'up' ? C.up : trend === 'down' ? C.down : C.neutral
          const progresso = op.storico.media2m_coperti > 0
            ? Math.min(100, Math.round((op.storico.media2m_coperti / op.target.coperti_target) * 100))
            : 0

          // Mese per mese
          const mesiList = Object.entries(op.mesi).sort(([a],[b]) => a.localeCompare(b))

          return (
            <div key={op.operatore} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                    style={{ backgroundColor: loc === 'MAMELI' ? C.MA : C.PN }}>
                    {op.operatore[0]}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-gray-900">{op.operatore}</p>
                    <p className="text-xs text-gray-400">{op.performance.quota_mercato_pct}% quota mkt</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <TrendIcon size={14} style={{ color: trendColor }} />
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: trendColor + '20', color: trendColor }}>
                    {op.performance.score}/100
                  </span>
                </div>
              </div>

              {/* Progress bar: media2m vs target */}
              <div className="mb-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Media attuale: {op.storico.media2m_coperti} cop.</span>
                  <span>Target: {op.target.coperti_target} cop.</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{
                      width: `${progresso}%`,
                      backgroundColor: progresso >= 100 ? C.up : progresso >= 80 ? C.warn : C.down
                    }} />
                </div>
                <div className="text-right text-xs text-gray-400 mt-0.5">{progresso}% del target</div>
              </div>

              {/* KPI row */}
              <div className="grid grid-cols-3 gap-2 text-center mb-3">
                <div className="bg-gray-50 rounded-lg p-2">
                  <div className="text-xs text-gray-500">Cop. Medio</div>
                  <div className="font-bold text-sm">€{op.storico.media2m_cm}</div>
                </div>
                <div className="bg-indigo-50 rounded-lg p-2">
                  <div className="text-xs text-indigo-600">Target +{op.target.target_fattore_pct}%</div>
                  <div className="font-bold text-sm text-indigo-700">€{op.target.venduto_target.toLocaleString('it-IT')}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-2">
                  <div className="text-xs text-gray-500">Up-sell rate</div>
                  <div className="font-bold text-sm">{op.performance.upsell_rate}x</div>
                </div>
              </div>

              {/* Mini trend mesi */}
              <div className="flex gap-1.5 items-end h-8">
                {mesiList.map(([m, d]) => {
                  const maxCop = Math.max(...mesiList.map(([,dd]) => dd.coperti))
                  const h = maxCop > 0 ? Math.round((d.coperti / maxCop) * 100) : 0
                  return (
                    <div key={m} className="flex-1 flex flex-col items-center gap-0.5">
                      <div className="w-full rounded-t-sm" title={`${m}: ${d.coperti} cop.`}
                        style={{ height: `${h}%`, backgroundColor: loc === 'MAMELI' ? C.MA + '80' : C.PN + '80', minHeight: 2 }} />
                      <span className="text-[9px] text-gray-400">{m.slice(5)}</span>
                    </div>
                  )
                })}
                {/* Barra target */}
                <div className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-t-sm border-t-2 border-dashed"
                    style={{ height: '100%', borderColor: loc === 'MAMELI' ? C.MA : C.PN, backgroundColor: 'transparent' }}
                    title={`Target: ${op.target.coperti_target}`} />
                  <span className="text-[9px] text-gray-400">🎯</span>
                </div>
              </div>

              {/* Stagionalità info */}
              <div className="mt-2 pt-2 border-t border-gray-50 text-xs text-gray-400 flex justify-between">
                <span>Stagionalità: ×{op.target.coeff_stagionale}</span>
                <span>Target mese: {op.target.periodo}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Sezione: Heatmap Settimanale ─────────────────────────────────────────────
function HeatmapSection({ heatmap, loading }) {
  const [loc, setLoc] = useState(null) // null = entrambi
  if (loading) return <div className="animate-pulse bg-gray-100 rounded-xl h-48" />
  if (!heatmap) return null

  const { byDow, top5 } = heatmap
  const dowBiz = [1,2,3,4,5,6,0].map(i => byDow[i]).filter(Boolean) // Lun-Dom

  const maxVenduto = Math.max(...dowBiz.map(d => d.avg_venduto || 0))

  return (
    <div>
      <SectionTitle icon={BarChart2} label="Pattern Settimanale — Performance per Giorno" color={C.PN} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Heatmap giorni */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-600 mb-3">Venduto Medio per Giorno della Settimana</p>
          <div className="space-y-2">
            {dowBiz.map(d => {
              const pct = maxVenduto > 0 ? (d.avg_venduto / maxVenduto) : 0
              return (
                <div key={d.dow} className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-500 w-7">{d.label}</span>
                  <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
                    <div className="h-full rounded flex items-center px-2 transition-all"
                      style={{ width: `${pct * 100}%`, backgroundColor: `hsl(${220 + pct * 60}, 70%, ${60 - pct * 20}%)` }}>
                    </div>
                  </div>
                  <span className="text-xs font-medium w-16 text-right">€{d.avg_venduto?.toLocaleString('it-IT')}</span>
                  <span className="text-xs text-gray-400 w-16">~{d.avg_coperti} cop.</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Top 5 giorni */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-600 mb-3">🏆 Top 5 Giorni — Record Assoluti</p>
          <div className="space-y-2">
            {(top5 || []).map((d, i) => (
              <div key={d.data} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
                <span className="text-lg font-bold text-gray-400">#{i + 1}</span>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-gray-800">
                    {new Date(d.data).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' })}
                    {' '}— {d.location === 'MAMELI' ? 'MA' : 'PN'}
                  </p>
                  <p className="text-xs text-gray-500">{d.coperti} coperti · CM €{d.cm}</p>
                </div>
                <span className="font-bold text-sm" style={{ color: d.location === 'MAMELI' ? C.MA : C.PN }}>
                  €{d.venduto.toLocaleString('it-IT')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function AnalyticsBI() {
  const [activeSection, setActiveSection] = useState('overview')
  const [loading, setLoading] = useState({ overview: true, seasonality: true, forecast: true, targets: true, heatmap: true })
  const [data, setData] = useState({ overview: null, seasonality: null, forecast: null, targets: null, heatmap: null })
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [error, setError] = useState(null)

  const loadAll = useCallback(async () => {
    setError(null)
    try {
      const [overview, seasonality, forecast, targets, heatmap] = await Promise.all([
        analyticsApi.overview().catch(() => null),
        analyticsApi.seasonality().catch(() => null),
        analyticsApi.forecast().catch(() => null),
        analyticsApi.operatorTargets().catch(() => null),
        analyticsApi.heatmap().catch(() => null),
      ])
      setData({ overview, seasonality, forecast, targets, heatmap })
    } catch (e) {
      setError('Errore nel caricamento dati analytics. Premi Sincronizza per importare i dati.')
    } finally {
      setLoading({ overview: false, seasonality: false, forecast: false, targets: false, heatmap: false })
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await dataApi.sync()
      setLastSync(new Date().toLocaleTimeString('it-IT'))
      setLoading({ overview: true, seasonality: true, forecast: true, targets: true, heatmap: true })
      await loadAll()
    } finally {
      setSyncing(false)
    }
  }

  const sections = [
    { id: 'overview',   label: 'Anno su Anno',  icon: TrendingUp  },
    { id: 'seasonality',label: 'Stagionalità',  icon: Calendar    },
    { id: 'forecast',   label: 'Previsioni',    icon: Zap         },
    { id: 'targets',    label: 'Target Smart',  icon: Target      },
    { id: 'heatmap',    label: 'Pattern',       icon: BarChart2   },
  ]

  // Calcola sommario veloce
  const kpi = data.overview?.kpiBox
  const totalVendutoYTD = kpi
    ? Math.round((kpi.MAMELI?.venduto_ytd || 0) + (kpi.PREDDA_NIEDDA?.venduto_ytd || 0))
    : null
  const periodoLabelGlobal = kpi?.MAMELI?.periodo_label || kpi?.PREDDA_NIEDDA?.periodo_label || 'YTD'
  const annoCGlobal = kpi?.MAMELI?.anno_corrente || new Date().getFullYear()

  return (
    <>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span className="text-2xl">📡</span> Analytics & Business Intelligence
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Analisi predittiva · Stagionalità · Target smart per operatore · {lastSync && `Ultimo aggiornamento: ${lastSync}`}
          </p>
        </div>
        <button onClick={handleSync} disabled={syncing}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            syncing ? 'bg-gray-100 text-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}>
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Sincronizzando...' : 'Sincronizza & Aggiorna'}
        </button>
      </div>

      {/* KPI veloci top */}
      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title={`Venduto totale ${periodoLabelGlobal} ${annoCGlobal}`}
            value={`€${((totalVendutoYTD||0)/1000).toFixed(0)}k`}
            sub="entrambi i locali" icon={TrendingUp} color="#6366f1" />
          <KPICard title="Cop. Medio MA"
            value={`€${(kpi.MAMELI?.cm_avg||0).toFixed(2)}`}
            sub={`vs €${(kpi.MAMELI?.cm_avg_prec||0).toFixed(2)} anno fa`} icon={Target} color={C.MA} />
          <KPICard title="Cop. Medio PN"
            value={`€${(kpi.PREDDA_NIEDDA?.cm_avg||0).toFixed(2)}`}
            sub={`vs €${(kpi.PREDDA_NIEDDA?.cm_avg_prec||0).toFixed(2)} anno fa`} icon={Target} color={C.PN} />
          <KPICard title="Operatori monitorati"
            value={data.targets?.length || '—'}
            sub="con target automatici" icon={Users} color={C.warn} />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {sections.map(s => {
          const Icon = s.icon
          return (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                activeSection === s.id
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'
              }`}>
              <Icon size={14} />
              {s.label}
            </button>
          )
        })}
      </div>

      {/* Sezioni */}
      <div className="min-h-64">
        {activeSection === 'overview' && (
          <OverviewSection overview={data.overview} loading={loading.overview} />
        )}
        {activeSection === 'seasonality' && (
          <SeasonalitySection seasonality={data.seasonality} loading={loading.seasonality} />
        )}
        {activeSection === 'forecast' && (
          <ForecastSection forecast={data.forecast} loading={loading.forecast} />
        )}
        {activeSection === 'targets' && (
          <OperatorTargetsSection targets={data.targets} loading={loading.targets} />
        )}
        {activeSection === 'heatmap' && (
          <HeatmapSection heatmap={data.heatmap} loading={loading.heatmap} />
        )}
      </div>

      {/* Footer info Academy */}
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100">
        <div className="flex items-start gap-3">
          <Award size={18} className="text-indigo-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-gray-600 space-y-1">
            <p className="font-semibold text-indigo-700">Framework Academy — Logica KPI Applicata</p>
            <p><strong>Quantum</strong> = soglia minima contribuzione individuale (livello di contribuzione) · <strong>Target</strong> = obiettivo con extra risultato</p>
            <p><strong>Target smart</strong> = media 2 mesi recenti × +10% × coefficiente stagionale (basato su 2025) · Aggiornato mensilmente</p>
            <p>Un quantum non raggiunto crea <em>extra sforzo</em> per il team · Un target raggiunto crea <em>extra risultato</em> collettivo</p>
          </div>
        </div>
      </div>
    </div>
      <PageAssistant
        pagina="Analytics & BI"
        suggerimenti={[
          "Tendenza vendite nei prossimi 3 mesi",
          "Confronto anno su anno per sede MA",
          "Quale mese ha avuto la crescita maggiore?",
        ]}
      />
    </>
  )
}