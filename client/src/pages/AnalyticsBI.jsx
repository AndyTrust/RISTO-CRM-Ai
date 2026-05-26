import React, { useState, useEffect, useCallback } from 'react'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ComposedChart
} from 'recharts'
import {
  TrendingUp, TrendingDown, Minus, Target, Users, BarChart2,
  Calendar, Zap, AlertTriangle, CheckCircle, ChevronRight,
  RefreshCw, ArrowUpRight, ArrowDownRight, Star, Award,
  DollarSign, TrendingDown as CostIcon, Info
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
  profit:  '#22c55e',
  loss:    '#ef4444',
}

const LOC_LABEL = { MAMELI: 'Sede MA', PREDDA_NIEDDA: 'Sede PN' }
const MESI_IT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']

// ── Componenti UI ────────────────────────────────────────────────────────────
function KPICard({ title, value, sub, delta, icon: Icon, color = '#6366f1' }) {
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
      <div className="font-bold text-gray-900 text-2xl">{value}</div>
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
    <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-4 flex-wrap">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
            active === t.id ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
          }`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

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

// ── Sezione: Costi & BE Mensile ──────────────────────────────────────────────
function BESection({ beMensile, loading }) {
  const [sede, setSede] = useState('MA')
  if (loading) return <div className="animate-pulse bg-gray-100 rounded-xl h-64" />
  if (!beMensile?.length) return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
      <AlertTriangle size={28} className="text-amber-400 mx-auto mb-3" />
      <p className="font-semibold text-amber-800 mb-1">Nessun dato BE disponibile</p>
      <p className="text-sm text-amber-600">Importa buste paga e fatture per visualizzare il break-even.</p>
    </div>
  )

  // Mesi con almeno 25 giorni = mese completo (esclude mese corrente parziale)
  const filtered = beMensile.filter(r => r.sede === sede && r.incasso > 0 && r.giorni >= 25)

  // Dati per il grafico stacked bar: costi vs incasso
  const chartData = filtered.map(r => ({
    mese: r.mese_label,
    personale: Math.round(r.costo_personale),
    fatture: Math.round(r.costo_fatture),
    fissi: Math.round(r.costo_fissi),
    incasso: Math.round(r.incasso),
    be_totale: Math.round(r.be_totale),
    unreliable: r.fatture_unreliable,
  }))

  // Summary dell'ultimo mese completo con dati affidabili (escludo mesi ⚠ se possibile)
  const lastFull = [...filtered].reverse().find(r => !r.fatture_unreliable && r.costo_personale > 0 && r.costo_fatture > 0)
    || [...filtered].reverse().find(r => r.costo_personale > 0 && r.costo_fatture > 0)

  return (
    <div>
      <SectionTitle icon={DollarSign} label="Costi & Break-Even Mensile 2026" color={C.MA} />

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 flex items-start gap-2">
        <Info size={14} className="text-blue-600 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-blue-700">
          <strong>Metodo di calcolo:</strong> Buste paga e fatture acquisto sono costi condivisi tra i due locali
          → ogni sede mostra il <strong>50% del totale mensile</strong> (media equa). I costi fissi (affitto, indennizzi)
          rimangono specifici per sede. Gen–Feb 2026 segnalati con ⚠ per attribuzione fatture non affidabile.
          I costi fissi registrati sono parziali — mancano utenze, commercialista, assicurazioni.
        </p>
      </div>

      <TabBar
        tabs={[{ id: 'MA', label: '🔵 Sede MA' }, { id: 'PN', label: '🟢 Sede PN' }]}
        active={sede} onChange={setSede}
      />

      {/* KPI summary ultimo mese completo */}
      {lastFull && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="text-xs text-gray-500 mb-1">Incasso ({lastFull.mese_label})</div>
            <div className="text-2xl font-bold text-gray-900">€{lastFull.incasso.toLocaleString('it-IT')}</div>
            <div className="text-xs text-gray-400">{lastFull.giorni} giorni · {lastFull.coperti.toLocaleString()} coperti</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="text-xs text-gray-500 mb-1">Costo Personale</div>
            <div className="text-2xl font-bold text-indigo-600">€{lastFull.costo_personale.toLocaleString('it-IT')}</div>
            <div className="text-xs text-gray-400">{lastFull.incasso > 0 ? Math.round(lastFull.costo_personale / lastFull.incasso * 100) : '–'}% del fatturato</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="text-xs text-gray-500 mb-1">Costo Fatture Acquisto</div>
            <div className="text-2xl font-bold text-violet-600">€{lastFull.costo_fatture.toLocaleString('it-IT')}</div>
            <div className="text-xs text-gray-400">{lastFull.incasso > 0 ? Math.round(lastFull.costo_fatture / lastFull.incasso * 100) : '–'}% del fatturato</div>
          </div>
          <div className={`rounded-xl border shadow-sm p-4 ${lastFull.margine >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <div className="text-xs text-gray-500 mb-1">Margine ({lastFull.mese_label})</div>
            <div className={`text-2xl font-bold ${lastFull.margine >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {lastFull.margine >= 0 ? '+' : ''}€{lastFull.margine?.toLocaleString('it-IT')}
            </div>
            <div className={`text-xs font-medium ${lastFull.margine >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {lastFull.margine_pct !== null ? `${lastFull.margine_pct > 0 ? '+' : ''}${lastFull.margine_pct}% su fatturato` : '—'}
            </div>
          </div>
        </div>
      )}

      {/* Grafico stacked */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4">
        <p className="text-xs font-semibold text-gray-600 mb-3">Struttura Costi vs Incasso</p>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => `€${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="personale" name="Personale" stackId="costi" fill={C.MA} radius={[0,0,0,0]} />
            <Bar dataKey="fatture" name="Fatture acq." stackId="costi" fill="#8b5cf6" radius={[0,0,0,0]} />
            <Bar dataKey="fissi" name="Costi fissi" stackId="costi" fill={C.warn} radius={[3,3,0,0]} />
            <Line type="monotone" dataKey="incasso" name="Incasso" stroke={C.PN} strokeWidth={2.5} dot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Tabella dettaglio mesi */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              {['Mese','Incasso','Personale','Fatture','Fissi','Totale Costi','Margine'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={`${r.sede}-${r.mese}`} className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-3 py-2 font-medium">
                  {r.mese_label}
                  {r.fatture_unreliable && <span className="ml-1 text-amber-500" title="Attribuzione fatture per sede non affidabile">⚠</span>}
                </td>
                <td className="px-3 py-2 text-green-700 font-medium">€{r.incasso.toLocaleString('it-IT')}</td>
                <td className="px-3 py-2 text-indigo-600">€{r.costo_personale.toLocaleString('it-IT')}</td>
                <td className="px-3 py-2 text-violet-600">
                  €{r.costo_fatture.toLocaleString('it-IT')}
                  {r.fatture_unreliable && <span className="ml-1 text-amber-400">⚠</span>}
                </td>
                <td className="px-3 py-2 text-amber-600">€{r.costo_fissi.toLocaleString('it-IT')}</td>
                <td className="px-3 py-2 font-semibold text-gray-800">€{r.be_totale.toLocaleString('it-IT')}</td>
                <td className={`px-3 py-2 font-bold ${r.margine >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {r.margine !== null ? `${r.margine >= 0 ? '+' : ''}€${r.margine.toLocaleString('it-IT')}` : '—'}
                  {r.margine_pct !== null && (
                    <span className="ml-1 text-xs font-normal">({r.margine_pct}%)</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Box riepilogo 50/50 — mese più recente con dati completi */}
      <div className="mt-4 bg-gray-50 border border-gray-200 rounded-xl p-4">
        {(() => {
          // Prendi il mese più recente con dati affidabili (entrambe le sedi, no unreliable)
          const completeMeses = beMensile.filter(r => !r.fatture_unreliable && r.costo_personale > 0 && r.costo_fatture > 0)
          const lastMese = completeMeses.reduce((max, r) => r.mese > max ? r.mese : max, 0)
          const rowMA = beMensile.find(r => r.sede === 'MA' && r.mese === lastMese)
          const rowPN = beMensile.find(r => r.sede === 'PN' && r.mese === lastMese)
          if (!rowMA || !rowPN || lastMese === 0) return (
            <p className="text-xs text-gray-400">Dati non ancora disponibili per il riepilogo.</p>
          )
          // I totali pre-split sono nei metadati _tot_*
          const totPersonale = rowMA._tot_personale ?? (rowMA.costo_personale * 2)
          const totFatture   = rowMA._tot_fatture   ?? (rowMA.costo_fatture   * 2)
          const totFissiMA   = rowMA.costo_fissi
          const totFissiPN   = rowPN.costo_fissi
          const meseLabel    = MESI_IT[lastMese - 1]
          return (
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-3">
                📐 Riepilogo costi condivisi — {meseLabel} {new Date().getFullYear()}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-2">
                <div>
                  <span className="text-gray-500">Buste paga totali:</span><br />
                  <strong>€{totPersonale.toLocaleString('it-IT')}</strong>
                  <div className="text-indigo-600 mt-0.5">→ €{rowMA.costo_personale.toLocaleString('it-IT')} per sede</div>
                </div>
                <div>
                  <span className="text-gray-500">Fatture acquisto totali:</span><br />
                  <strong>€{totFatture.toLocaleString('it-IT')}</strong>
                  <div className="text-violet-600 mt-0.5">→ €{rowMA.costo_fatture.toLocaleString('it-IT')} per sede</div>
                </div>
                <div>
                  <span className="text-gray-500">Costi fissi (per sede):</span><br />
                  <div>MA: <strong>€{totFissiMA.toLocaleString('it-IT')}</strong></div>
                  <div>PN: <strong>€{totFissiPN.toLocaleString('it-IT')}</strong></div>
                </div>
                <div className="bg-indigo-50 rounded p-2">
                  <div className="text-indigo-600 font-semibold mb-1">Totale BE per sede</div>
                  <div>MA: <strong className="text-indigo-700">€{rowMA.be_totale.toLocaleString('it-IT')}</strong></div>
                  <div>PN: <strong className="text-green-700">€{rowPN.be_totale.toLocaleString('it-IT')}</strong></div>
                </div>
              </div>
              <p className="text-xs text-gray-500">Costi fissi registrati parziali — mancano utenze, commercialista, assicurazioni.</p>
            </div>
          )
        })()}
      </div>
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
  const annoC = ma.anno_corrente || new Date().getFullYear()
  const annoP = ma.anno_prec || annoC - 1

  const deltaMA_v = ma.venduto_ytd_prec > 0 ? Math.round(((ma.venduto_ytd - ma.venduto_ytd_prec) / ma.venduto_ytd_prec) * 1000) / 10 : null
  const deltaPN_v = pn.venduto_ytd_prec > 0 ? Math.round(((pn.venduto_ytd - pn.venduto_ytd_prec) / pn.venduto_ytd_prec) * 1000) / 10 : null

  return (
    <div>
      <SectionTitle icon={TrendingUp} label={`Anno su Anno — ${periodoLabel} ${annoC} vs ${annoP}`} color={C.MA} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KPICard title={`Venduto MA ${periodoLabel}`} value={`€${((ma.venduto_ytd||0)/1000).toFixed(0)}k`}
          sub={`vs €${((ma.venduto_ytd_prec||0)/1000).toFixed(0)}k anno fa`} delta={deltaMA_v} icon={TrendingUp} color={C.MA} />
        <KPICard title={`Venduto PN ${periodoLabel}`} value={`€${((pn.venduto_ytd||0)/1000).toFixed(0)}k`}
          sub={`vs €${((pn.venduto_ytd_prec||0)/1000).toFixed(0)}k anno fa`} delta={deltaPN_v} icon={TrendingUp} color={C.PN} />
        <KPICard title="Cop. Medio MA" value={`€${(ma.cm_avg||0).toFixed(2)}`}
          sub={`vs €${(ma.cm_avg_prec||0).toFixed(2)} anno fa`}
          delta={ma.cm_avg_prec > 0 ? Math.round(((ma.cm_avg - ma.cm_avg_prec) / ma.cm_avg_prec) * 1000) / 10 : null}
          icon={Target} color={C.MA} />
        <KPICard title="Cop. Medio PN" value={`€${(pn.cm_avg||0).toFixed(2)}`}
          sub={`vs €${(pn.cm_avg_prec||0).toFixed(2)} anno fa`}
          delta={pn.cm_avg_prec > 0 ? Math.round(((pn.cm_avg - pn.cm_avg_prec) / pn.cm_avg_prec) * 1000) / 10 : null}
          icon={Target} color={C.PN} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <TabBar tabs={[{ id: 'venduto', label: 'Venduto' }, { id: 'coperti', label: 'Coperti' }]} active={tab} onChange={setTab} />
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
        <div className="flex flex-wrap gap-2 mt-3">
          {yoy.map(m => {
            const delta = tab === 'venduto' ? m.delta_venduto_pct : m.delta_coperti_pct
            if (delta === null) return null
            const pos = delta >= 0
            return (
              <span key={m.mese_label} className={`text-xs px-2 py-0.5 rounded-full font-medium ${pos ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
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
  const getColor = (v) => {
    if (v === null) return '#f3f4f6'
    if (v >= 1.3) return '#166534'; if (v >= 1.1) return '#16a34a'
    if (v >= 1.0) return '#4ade80'; if (v >= 0.9) return '#fbbf24'
    if (v >= 0.7) return '#f97316'; return '#dc2626'
  }
  const getTextColor = (v) => {
    if (v === null) return '#9ca3af'
    if (v >= 1.1) return '#fff'; if (v >= 0.9) return '#1f2937'; return '#fff'
  }

  return (
    <div>
      <SectionTitle icon={Calendar} label="Stagionalità — Indici Mensili 2025" color={C.warn} />
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4">
        <p className="text-xs text-gray-500 mb-3">Indice &gt;1 = mese sopra la media annuale · &lt;1 = sotto media (usato per correggere le previsioni)</p>
        <div className="grid grid-cols-6 md:grid-cols-12 gap-2">
          {data.map(m => (
            <div key={m.mese_num} className="text-center rounded-lg p-2" style={{ backgroundColor: getColor(m.indice_combined) }}>
              <div className="text-xs font-bold" style={{ color: getTextColor(m.indice_combined) }}>{MESI_IT[(m.mese_num - 1)]}</div>
              <div className="text-xs font-semibold mt-0.5" style={{ color: getTextColor(m.indice_combined) }}>
                {m.indice_combined !== null ? `×${m.indice_combined.toFixed(2)}` : '—'}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          {[['#dc2626','Molto basso'],['#f97316','Basso'],['#fbbf24','Sotto media'],
            ['#4ade80','Nella media'],['#16a34a','Alto'],['#166534','Molto alto']].map(([c, l]) => (
            <div key={c} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: c }} />
              <span className="text-xs text-gray-500">{l}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <p className="text-xs font-semibold text-gray-600 mb-3">Coperto Medio per Mese — 2025</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {['MAMELI','PREDDA_NIEDDA'].map(loc => {
            const rows = (seasonality.byLocation?.[loc] || []).map(r => ({
              month: MESI_IT[r.mese_num - 1], cm: r.avg_cm, coperti: r.tot_coperti,
            }))
            if (!rows.length) return null
            return (
              <div key={loc}>
                <p className="text-xs text-center font-medium mb-2" style={{ color: loc === 'MAMELI' ? C.MA : C.PN }}>{LOC_LABEL[loc]}</p>
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

  const combined = [
    ...(data.storico || []).map(r => ({ mese: r.mese_label, venduto: r.tot_venduto, coperti: r.tot_coperti })),
    ...(data.forecasts || []).map(r => ({ mese: r.mese_label + ' ✦', forecast: r.forecast_venduto,
      forecast_min: r.forecast_min, forecast_max: r.forecast_max })),
  ]

  const reg = data.regressione || {}
  return (
    <div>
      <SectionTitle icon={Zap} label="Previsioni — Prossimi 3 Mesi (con stagionalità 2025)" color={C.forecast} />
      <TabBar
        tabs={[{ id: 'MAMELI', label: 'Sede MA' }, { id: 'PREDDA_NIEDDA', label: '🟢 Sede PN' }]}
        active={loc} onChange={setLoc}
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {(data.forecasts || []).map(f => (
          <div key={f.mese} className="bg-white rounded-xl border border-purple-100 shadow-sm p-4">
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-semibold text-purple-600 uppercase">{f.mese_label}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${f.tendenza === 'crescita' ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'}`}>
                {f.tendenza === 'crescita' ? '↗ Crescita' : '↘ Calo'}
              </span>
            </div>
            <div className="text-2xl font-bold text-gray-900 mb-1">€{f.forecast_venduto.toLocaleString('it-IT')}</div>
            <div className="text-xs text-gray-500 mb-2">Range: €{f.forecast_min.toLocaleString('it-IT')} – €{f.forecast_max.toLocaleString('it-IT')}</div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>👥 ~{f.forecast_coperti.toLocaleString('it-IT')} coperti</span>
              <span>🌊 ×{f.coeff_stagionale} stagionale</span>
            </div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-3 mb-3">
          <p className="text-xs font-semibold text-gray-600">Andamento + Previsione Venduto</p>
          <span className="text-xs text-gray-400">R² regressione: {reg.r2} · ✦ = previsione corretta per stagionalità</span>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={combined}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="mese" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={v => `€${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="venduto" name="Storico" fill={loc === 'MAMELI' ? C.MA : C.PN} radius={[3,3,0,0]} opacity={0.85} />
            <Bar dataKey="forecast" name="Previsione" fill={C.forecast} radius={[3,3,0,0]} opacity={0.9} />
          </ComposedChart>
        </ResponsiveContainer>
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
      <p className="text-sm text-amber-600">Importa i dati venduto camerieri da iPratico.</p>
    </div>
  )

  const filtered = targets.filter(t => t.location === loc)
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'coperti') return b.storico.media2m_coperti - a.storico.media2m_coperti
    if (sortBy === 'target') return b.target.coperti_target - a.target.coperti_target
    if (sortBy === 'score') return b.performance.score - a.performance.score
    if (sortBy === 'cm') return (b.performance.upsell_rate || 0) - (a.performance.upsell_rate || 0)
    return 0
  })

  const chartData = sorted.map(t => ({
    name: t.operatore.length > 10 ? t.operatore.slice(0, 9) + '.' : t.operatore,
    media_2m: t.storico.media2m_coperti,
    target: t.target.coperti_target,
    quota: t.performance.quota_mercato_pct,
  }))

  return (
    <div>
      <SectionTitle icon={Target} label={`Target Smart per Operatore — ${targets[0]?.target?.periodo || 'Prossimo Mese'}`} color={C.MA} />
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
        <p className="text-xs text-blue-700">
          <strong>Fonte:</strong> kpi_revenues (coperti reali da iPratico) ·
          <strong> Base:</strong> media coperti ultimi 2 mesi ·
          <strong> Formula:</strong> media × coeff. stagionale × +10% ·
          <strong> CM:</strong> coperto medio reale da aprile 2026 ·
          Nomi operatori normalizzati per match storico gen–apr
        </p>
      </div>

      <TabBar
        tabs={[{ id: 'MAMELI', label: 'Sede MA' }, { id: 'PREDDA_NIEDDA', label: '🟢 Sede PN' }]}
        active={loc} onChange={setLoc}
      />

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-600">Coperti: Media 2m vs Target</p>
          <div className="flex gap-1">
            {[['coperti','Coperti'],['cm','€/cop'],['score','Score']].map(([id, l]) => (
              <button key={id} onClick={() => setSortBy(id)}
                className={`text-xs px-2 py-1 rounded ${sortBy === id ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-400 hover:text-gray-600'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={Math.max(160, sorted.length * 34)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={72} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="media_2m" name="Media 2m coperti" fill={loc === 'MAMELI' ? C.MA + '80' : C.PN + '80'} radius={[0,3,3,0]} />
            <Bar dataKey="target" name="Target +10%" fill={loc === 'MAMELI' ? C.MA : C.PN} radius={[0,3,3,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sorted.map(op => {
          const trend = op.performance.trend
          const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
          const trendColor = trend === 'up' ? C.up : trend === 'down' ? C.down : C.neutral
          const progresso = op.storico.media2m_coperti > 0
            ? Math.min(100, Math.round(op.storico.media2m_coperti / op.target.coperti_target * 100))
            : 0
          const mesiList = Object.entries(op.mesi).sort(([a], [b]) => a.localeCompare(b))
          const hasCM = op.performance.upsell_rate && op.performance.upsell_rate > 0

          return (
            <div key={op.operatore} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                    style={{ backgroundColor: loc === 'MAMELI' ? C.MA : C.PN }}>
                    {op.operatore[0]}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-gray-900">{op.operatore}</p>
                    <p className="text-xs text-gray-400">{op.performance.quota_mercato_pct}% quota · {op.storico.mesi_dispo} mesi dati</p>
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

              {/* Progress bar coperti media vs target */}
              <div className="mb-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Media attuale: {op.storico.media2m_coperti} cop.</span>
                  <span>Target: {op.target.coperti_target} cop.</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${progresso}%`, backgroundColor: progresso >= 100 ? C.up : progresso >= 80 ? C.warn : C.down }} />
                </div>
                <div className="text-right text-xs text-gray-400 mt-0.5">{progresso}% del target</div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center mb-3">
                <div className="bg-gray-50 rounded-lg p-2">
                  <div className="text-xs text-gray-500">Cop./mese</div>
                  <div className="font-bold text-sm">{op.storico.media2m_coperti}</div>
                </div>
                <div className="bg-indigo-50 rounded-lg p-2">
                  <div className="text-xs text-indigo-600">€/cop. (apr)</div>
                  <div className="font-bold text-sm text-indigo-700">
                    {hasCM ? `€${op.performance.upsell_rate}` : <span className="text-gray-400 text-xs">N/D</span>}
                  </div>
                </div>
                <div className="bg-purple-50 rounded-lg p-2">
                  <div className="text-xs text-purple-600">Target €</div>
                  <div className="font-bold text-sm text-purple-700">
                    {hasCM ? `€${op.target.venduto_target.toLocaleString('it-IT')}` : <span className="text-gray-400 text-xs">—</span>}
                  </div>
                </div>
              </div>

              {/* Mini sparkline coperti per mese */}
              <div className="flex gap-1 items-end h-8 mb-1">
                {mesiList.map(([m, d]) => {
                  const maxCop = Math.max(...mesiList.map(([, dd]) => dd.coperti), 1)
                  const h = Math.round((d.coperti / maxCop) * 100)
                  return (
                    <div key={m} className="flex-1 flex flex-col items-center gap-0.5">
                      <div className="w-full rounded-t-sm" title={`${m}: ${d.coperti} cop.`}
                        style={{ height: `${h}%`, backgroundColor: loc === 'MAMELI' ? C.MA + '90' : C.PN + '90', minHeight: 2 }} />
                      <span className="text-[9px] text-gray-400">{m.slice(5)}</span>
                    </div>
                  )
                })}
              </div>

              <div className="pt-2 border-t border-gray-50 text-xs text-gray-400 flex justify-between">
                <span>Stagionalità: ×{op.target.coeff_stagionale}</span>
                <span>{op.target.periodo}</span>
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
  if (loading) return <div className="animate-pulse bg-gray-100 rounded-xl h-48" />
  if (!heatmap) return null

  const { byDow, top5 } = heatmap
  const dowBiz = [1,2,3,4,5,6,0].map(i => byDow[i]).filter(Boolean)
  const maxVenduto = Math.max(...dowBiz.map(d => d.avg_venduto || 0))

  return (
    <div>
      <SectionTitle icon={BarChart2} label="Pattern Settimanale — Performance per Giorno" color={C.PN} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-600 mb-3">Venduto Medio per Giorno della Settimana (MA+PN)</p>
          <div className="space-y-2">
            {dowBiz.map(d => {
              const pct = maxVenduto > 0 ? d.avg_venduto / maxVenduto : 0
              return (
                <div key={d.dow} className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-500 w-7">{d.label}</span>
                  <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
                    <div className="h-full rounded flex items-center px-2 transition-all"
                      style={{ width: `${pct * 100}%`, backgroundColor: `hsl(${220 + pct * 60}, 70%, ${60 - pct * 20}%)` }} />
                  </div>
                  <span className="text-xs font-medium w-16 text-right">€{d.avg_venduto?.toLocaleString('it-IT')}</span>
                  <span className="text-xs text-gray-400 w-14">~{d.avg_coperti} cop.</span>
                </div>
              )
            })}
          </div>
        </div>
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
  const [activeSection, setActiveSection] = useState('be')
  const [loading, setLoading] = useState({ overview: true, seasonality: true, forecast: true, targets: true, heatmap: true, be: true })
  const [data, setData] = useState({ overview: null, seasonality: null, forecast: null, targets: null, heatmap: null, be: null })
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [error, setError] = useState(null)

  const loadAll = useCallback(async () => {
    setError(null)
    try {
      const [overview, seasonality, forecast, targets, heatmap, be] = await Promise.all([
        analyticsApi.overview().catch(() => null),
        analyticsApi.seasonality().catch(() => null),
        analyticsApi.forecast().catch(() => null),
        analyticsApi.operatorTargets().catch(() => null),
        analyticsApi.heatmap().catch(() => null),
        analyticsApi.beMensile().catch(() => null),
      ])
      setData({ overview, seasonality, forecast, targets, heatmap, be })
    } catch (e) {
      setError('Errore nel caricamento dati analytics.')
    } finally {
      setLoading({ overview: false, seasonality: false, forecast: false, targets: false, heatmap: false, be: false })
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await dataApi.sync()
      setLastSync(new Date().toLocaleTimeString('it-IT'))
      setLoading({ overview: true, seasonality: true, forecast: true, targets: true, heatmap: true, be: true })
      await loadAll()
    } finally { setSyncing(false) }
  }

  const sections = [
    { id: 'be',         label: 'Costi & BE',    icon: DollarSign  },
    { id: 'overview',   label: 'Anno su Anno',   icon: TrendingUp  },
    { id: 'targets',    label: 'Target Smart',   icon: Target      },
    { id: 'forecast',   label: 'Previsioni',     icon: Zap         },
    { id: 'seasonality',label: 'Stagionalità',   icon: Calendar    },
    { id: 'heatmap',    label: 'Pattern',        icon: BarChart2   },
  ]

  const kpi = data.overview?.kpiBox
  const totalVendutoYTD = kpi ? Math.round((kpi.MAMELI?.venduto_ytd || 0) + (kpi.PREDDA_NIEDDA?.venduto_ytd || 0)) : null

  return (
    <>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span className="text-2xl">📊</span> Analytics & Business Intelligence
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Costi reali · Stagionalità · Target smart per operatore{lastSync && ` · Aggiornato: ${lastSync}`}
          </p>
        </div>
        <button onClick={handleSync} disabled={syncing}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            syncing ? 'bg-gray-100 text-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}>
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Sincronizzando...' : 'Aggiorna'}
        </button>
      </div>

      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title="Venduto totale YTD" value={`€${((totalVendutoYTD||0)/1000).toFixed(0)}k`}
            sub="entrambi i locali" icon={TrendingUp} color="#6366f1" />
          <KPICard title="Cop. Medio MA (YTD)" value={`€${(kpi.MAMELI?.cm_avg||0).toFixed(2)}`}
            sub={`vs €${(kpi.MAMELI?.cm_avg_prec||0).toFixed(2)} anno fa`}
            delta={kpi.MAMELI?.cm_avg_prec > 0 ? Math.round(((kpi.MAMELI.cm_avg - kpi.MAMELI.cm_avg_prec) / kpi.MAMELI.cm_avg_prec) * 1000) / 10 : null}
            icon={Target} color={C.MA} />
          <KPICard title="Cop. Medio PN (YTD)" value={`€${(kpi.PREDDA_NIEDDA?.cm_avg||0).toFixed(2)}`}
            sub={`vs €${(kpi.PREDDA_NIEDDA?.cm_avg_prec||0).toFixed(2)} anno fa`}
            delta={kpi.PREDDA_NIEDDA?.cm_avg_prec > 0 ? Math.round(((kpi.PREDDA_NIEDDA.cm_avg - kpi.PREDDA_NIEDDA.cm_avg_prec) / kpi.PREDDA_NIEDDA.cm_avg_prec) * 1000) / 10 : null}
            icon={Target} color={C.PN} />
          <KPICard title="Operatori monitorati" value={data.targets?.length || '—'}
            sub="con target automatici" icon={Users} color={C.warn} />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <AlertTriangle size={16} />{error}
        </div>
      )}

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
              <Icon size={14} />{s.label}
            </button>
          )
        })}
      </div>

      <div className="min-h-64">
        {activeSection === 'be'         && <BESection beMensile={data.be} loading={loading.be} />}
        {activeSection === 'overview'   && <OverviewSection overview={data.overview} loading={loading.overview} />}
        {activeSection === 'seasonality'&& <SeasonalitySection seasonality={data.seasonality} loading={loading.seasonality} />}
        {activeSection === 'forecast'   && <ForecastSection forecast={data.forecast} loading={loading.forecast} />}
        {activeSection === 'targets'    && <OperatorTargetsSection targets={data.targets} loading={loading.targets} />}
        {activeSection === 'heatmap'    && <HeatmapSection heatmap={data.heatmap} loading={loading.heatmap} />}
      </div>
    </div>
    <PageAssistant
      pagina="Analytics & BI"
      suggerimenti={[
        "Quali sono i costi mensili a locale?",
        "Target operatori per giugno 2026",
        "Confronto vendite anno su anno",
      ]}
    />
    </>
  )
}
