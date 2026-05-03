/**
 * PerformancePage.jsx — Hub Performance 140 Grammi
 * Filtri condivisi (sede + mese/anno) + overview cards + 4 tab:
 *   Venduto | Obiettivi | Team | Tavoli
 *
 * Dati: v_operatore_mese, v_be_mensile, kpi_targets_team,
 *       kpi_targets_individuale (+employees), statistiche_tavoli,
 *       v_bonus_operatore, v_bonus_team, venduto_camerieri
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  TrendingUp, Target, Users, BarChart3, Table2,
  ChevronDown, ChevronUp, ArrowRight, RefreshCw,
  Award, Zap, Euro, Utensils, Clock, CheckCircle, XCircle
} from 'lucide-react'
import { operatoreMeseApi, beMensileApi, kpiTargetsApi, bonusApi } from '../api/client'
import supabase from '../supabase'

// ── Constants ──────────────────────────────────────────────────────────────
const MESI = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const PSEUDO_OPS = ['pienissimo','sistema','admin','test']
const COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ec4899','#8b5cf6','#ef4444','#14b8a6']
const TABS = [
  { id: 'venduto',   label: 'Venduto',    icon: TrendingUp },
  { id: 'obiettivi', label: 'Obiettivi',  icon: Target },
  { id: 'team',      label: 'Team',       icon: Users },
  { id: 'tavoli',    label: 'Tavoli',     icon: Table2 },
]

// ── Utils ──────────────────────────────────────────────────────────────────
const fmt    = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtEur = n => n == null || isNaN(n) ? '—' : `€ ${fmt(n, 2)}`
const fmtPct = n => n == null || isNaN(n) ? '—' : `${fmt(n, 1)}%`
const clamp  = (v, min, max) => Math.min(Math.max(v, min), max)

function firstWord(name = '') { return name.trim().split(/\s+/)[0].toUpperCase() }

// ── Shared UI ──────────────────────────────────────────────────────────────
function Spinner({ small } = {}) {
  return <div className={`text-center text-gray-400 ${small ? 'py-4 text-xs' : 'py-12'}`}>Caricamento…</div>
}

function OverviewCard({ icon: Icon, label, value, sub, color = 'indigo', trend }) {
  const bg  = { indigo:'bg-indigo-50 text-indigo-600', emerald:'bg-emerald-50 text-emerald-600', amber:'bg-amber-50 text-amber-600', violet:'bg-violet-50 text-violet-600', sky:'bg-sky-50 text-sky-600' }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest truncate">{label}</span>
        <div className={`p-1.5 rounded-lg flex-shrink-0 ${bg[color]}`}><Icon size={14} /></div>
      </div>
      <div className="text-xl font-bold text-gray-900 truncate">{value}</div>
      {sub  && <div className="text-xs text-gray-500 truncate">{sub}</div>}
      {trend != null && (
        <div className={`text-xs font-medium ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}% vs target
        </div>
      )}
    </div>
  )
}

function TabBar({ active, onChange }) {
  return (
    <div className="flex gap-1 border-b border-gray-200 mb-6">
      {TABS.map(t => {
        const Icon = t.icon
        const isActive = active === t.id
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              isActive
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
            }`}
          >
            <Icon size={14} />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

function ProgressBar({ value, max, color = 'indigo' }) {
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0
  const cls = { indigo:'bg-indigo-500', emerald:'bg-emerald-500', amber:'bg-amber-400', red:'bg-red-500', violet:'bg-violet-500' }
  const bg  = { indigo:'bg-indigo-100', emerald:'bg-emerald-100', amber:'bg-amber-100', red:'bg-red-100', violet:'bg-violet-100' }
  return (
    <div className={`h-1.5 rounded-full ${bg[color]} overflow-hidden`}>
      <div className={`h-full rounded-full transition-all ${cls[color]}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ── TAB 1: Venduto ─────────────────────────────────────────────────────────
function TabVenduto({ sede, anno, mese }) {
  const [ops,    setOps]    = useState([])
  const [loading, setLoading] = useState(true)
  const [sortBy,  setSortBy]  = useState('fatturato')
  const [expanded, setExpanded] = useState(null)
  const [prodotti, setProdotti] = useState({})

  useEffect(() => {
    setLoading(true)
    operatoreMeseApi.list({ sede, anno, mese })
      .then(data => {
        const filtered = (data || []).filter(op =>
          !PSEUDO_OPS.includes(op.operatore?.toLowerCase())
        )
        setOps(filtered)
      })
      .finally(() => setLoading(false))
  }, [sede, anno, mese])

  const sorted = useMemo(() => {
    const arr = [...ops]
    if (sortBy === 'fatturato') arr.sort((a, b) => (b.fatturato_stimato_operatore||0) - (a.fatturato_stimato_operatore||0))
    else if (sortBy === 'pezzi') arr.sort((a, b) => (b.tot_pezzi||0) - (a.tot_pezzi||0))
    else if (sortBy === 'aggiunte') arr.sort((a, b) => (b.tot_importo_aggiunte||0) - (a.tot_importo_aggiunte||0))
    return arr
  }, [ops, sortBy])

  const totFat  = useMemo(() => ops.reduce((s, o) => s + (parseFloat(o.fatturato_stimato_operatore)||0), 0), [ops])
  const totPezzi = useMemo(() => ops.reduce((s, o) => s + (parseInt(o.tot_pezzi)||0), 0), [ops])
  const totAgg  = useMemo(() => ops.reduce((s, o) => s + (parseFloat(o.tot_importo_aggiunte)||0), 0), [ops])

  async function toggleExpand(op) {
    const key = op.operatore
    if (expanded === key) { setExpanded(null); return }
    setExpanded(key)
    if (prodotti[key]) return
    const ini  = `${anno}-${String(mese).padStart(2,'0')}-01`
    const fine = new Date(anno, mese, 0).toISOString().slice(0,10)
    const { data } = await supabase
      .from('venduto_camerieri')
      .select('categoria, prodotto, quantita, totale')
      .eq('sede', sede).eq('operatore', op.operatore)
      .gte('data_inizio', ini).lte('data_fine', fine)
      .not('prodotto', 'ilike', '%coperto%')
    // Aggrega per categoria
    const byCat = {}
    for (const r of data || []) {
      const cat = r.categoria || 'Altro'
      if (!byCat[cat]) byCat[cat] = { cat, pezzi: 0, totale: 0 }
      byCat[cat].pezzi  += parseFloat(r.quantita) || 0
      byCat[cat].totale += parseFloat(r.totale)   || 0
    }
    const sorted = Object.values(byCat).sort((a, b) => b.totale - a.totale).slice(0, 10)
    setProdotti(p => ({ ...p, [key]: sorted }))
  }

  function SortBtn({ id, label }) {
    return (
      <button
        onClick={() => setSortBy(id)}
        className={`text-right text-xs font-semibold uppercase tracking-wider cursor-pointer select-none px-3 py-2 ${sortBy === id ? 'text-indigo-700' : 'text-gray-500 hover:text-gray-800'}`}
      >{label} {sortBy === id ? '↓' : ''}</button>
    )
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-gray-500">{ops.length} operatori attivi — clicca riga per dettaglio categorie</p>
        <Link to="/venduto" className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
          BI completa <ArrowRight size={12} />
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">#</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Operatore</th>
              <SortBtn id="fatturato" label="Fatturato" />
              <SortBtn id="pezzi"     label="Pezzi" />
              <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">% Team</th>
              <SortBtn id="aggiunte"  label="Aggiunte €" />
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((op, i) => {
              const pctTeam = totFat > 0 ? (parseFloat(op.fatturato_stimato_operatore)||0) / totFat * 100 : 0
              const isExp   = expanded === op.operatore
              return (
                <React.Fragment key={op.operatore}>
                  <tr
                    className={`border-b cursor-pointer transition-colors ${isExp ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                    onClick={() => toggleExpand(op)}
                  >
                    <td className="px-3 py-2.5 text-gray-400 font-mono text-xs w-8">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-gray-900">{op.operatore}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-indigo-700 font-semibold">
                      {fmtEur(op.fatturato_stimato_operatore)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">{fmt(op.tot_pezzi)}</td>
                    <td className="px-3 py-2.5 w-32">
                      <div className="flex items-center gap-2">
                        <ProgressBar value={pctTeam} max={100} color="indigo" />
                        <span className="text-xs text-gray-500 w-10 text-right">{pctTeam.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-emerald-700 font-mono">
                      {fmtEur(op.tot_importo_aggiunte)}
                      <span className="text-gray-400 text-xs ml-1">({fmt(op.tot_aggiunte)} pz)</span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-400">{isExp ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</td>
                  </tr>
                  {isExp && (
                    <tr className="bg-indigo-50/50 border-b">
                      <td colSpan={7} className="px-6 py-3">
                        {!prodotti[op.operatore]
                          ? <span className="text-xs text-gray-400">Caricamento…</span>
                          : prodotti[op.operatore].length === 0
                            ? <span className="text-xs text-gray-400">Nessun prodotto nel periodo</span>
                            : (
                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                                {prodotti[op.operatore].map(c => (
                                  <div key={c.cat} className="bg-white rounded-lg border border-indigo-100 p-2.5">
                                    <div className="text-[10px] text-gray-400 font-medium uppercase truncate">{c.cat}</div>
                                    <div className="text-sm font-bold text-indigo-700">{fmtEur(c.totale)}</div>
                                    <div className="text-xs text-gray-500">{fmt(c.pezzi)} pz</div>
                                  </div>
                                ))}
                              </div>
                            )
                        }
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 border-t-2 border-gray-300 font-semibold">
            <tr>
              <td colSpan={2} className="px-3 py-2.5 text-xs text-gray-600 uppercase">Totale</td>
              <td className="px-3 py-2.5 text-right font-mono text-indigo-700">{fmtEur(totFat)}</td>
              <td className="px-3 py-2.5 text-right font-mono">{fmt(totPezzi)}</td>
              <td />
              <td className="px-3 py-2.5 text-right text-emerald-700 font-mono">{fmtEur(totAgg)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ── TAB 2: Obiettivi ───────────────────────────────────────────────────────
function TabObiettivi({ sede, anno, mese }) {
  const [data, setData]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      operatoreMeseApi.list({ sede, anno, mese }),
      kpiTargetsApi.listIndividuale({ sede, anno, mese }),
    ]).then(([ops, targets]) => {
      const filtered = (ops || []).filter(op =>
        !PSEUDO_OPS.includes(op.operatore?.toLowerCase())
      )
      // Build target map: firstWord(employee.name) → target row
      const tMap = {}
      for (const t of targets || []) {
        const name = t.employees?.nome || ''
        tMap[firstWord(name)] = t
      }
      const merged = filtered.map(op => ({
        ...op,
        target: tMap[firstWord(op.operatore)] || null,
      })).sort((a, b) => (b.tot_pezzi||0) - (a.tot_pezzi||0))
      setData(merged)
    }).finally(() => setLoading(false))
  }, [sede, anno, mese])

  if (loading) return <Spinner />

  const conTarget = data.filter(d => d.target)
  const senzaTarget = data.filter(d => !d.target)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-gray-500">
          {conTarget.length} operatori con target, {senzaTarget.length} senza
        </p>
        <Link to="/kpi-config" className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
          Configura target <ArrowRight size={12} />
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Operatore</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Pezzi attuali</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Target</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Progresso</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Manca</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Bonus max</th>
            </tr>
          </thead>
          <tbody>
            {data.map(op => {
              const t       = op.target
              const target  = parseFloat(t?.target) || 0
              const quantum = parseFloat(t?.quantum) || 0
              const attuali = parseInt(op.tot_pezzi) || 0
              const manca   = Math.max(0, target - attuali)
              const pct     = target > 0 ? clamp((attuali / target) * 100, 0, 100) : 0
              const color   = pct >= 100 ? 'emerald' : pct >= 70 ? 'indigo' : pct >= 40 ? 'amber' : 'red'

              return (
                <tr key={op.operatore} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-3 font-semibold text-gray-900">{op.operatore}</td>
                  <td className="px-3 py-3 text-right font-mono font-semibold text-indigo-700">{fmt(attuali)}</td>
                  <td className="px-3 py-3 text-right font-mono text-gray-600">
                    {target > 0 ? fmt(target) : <span className="text-gray-300 italic text-xs">—</span>}
                    {quantum > 0 && <div className="text-[10px] text-gray-400">base {fmt(quantum)}</div>}
                  </td>
                  <td className="px-3 py-3 w-48">
                    {target > 0 ? (
                      <div className="space-y-1">
                        <ProgressBar value={attuali} max={target} color={color} />
                        <div className="flex justify-between text-[10px] text-gray-400">
                          <span>0</span>
                          <span className={`font-semibold ${
                            color === 'emerald' ? 'text-emerald-600' :
                            color === 'amber'   ? 'text-amber-600' :
                            color === 'red'     ? 'text-red-500' : 'text-indigo-600'
                          }`}>{pct.toFixed(1)}%</span>
                          <span>{fmt(target)}</span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300 italic">Nessun target</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-sm">
                    {target > 0 ? (
                      manca > 0
                        ? <span className="text-amber-600 font-semibold">{fmt(manca)} pz</span>
                        : <span className="text-emerald-600 font-bold">✓ Raggiunto</span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-violet-700">
                    {t?.premio_max_euro ? fmtEur(t.premio_max_euro) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {senzaTarget.length > 0 && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠️ {senzaTarget.map(o => o.operatore).join(', ')} — nessun target configurato.{' '}
          <Link to="/kpi-config" className="underline">Configura in KPI Config → Target Individuali</Link>
        </p>
      )}
    </div>
  )
}

// ── TAB 3: Team ────────────────────────────────────────────────────────────
function TabTeam({ sede, anno, mese }) {
  const [state, setState] = useState({ be: null, tt: null, bonusTeam: [], loading: true })

  useEffect(() => {
    setState(s => ({ ...s, loading: true }))
    Promise.all([
      beMensileApi.mese({ sede, anno, mese }),
      kpiTargetsApi.getTeam({ sede, anno, mese }),
      bonusApi.team({ sede, anno, mese }),
    ]).then(([be, tt, bt]) => setState({ be, tt, bonusTeam: bt || [], loading: false }))
  }, [sede, anno, mese])

  if (state.loading) return <Spinner />

  const be  = state.be  || {}
  const tt  = state.tt  || {}
  const fat = parseFloat(be.fatturato) || 0
  const tgt = parseFloat(tt.target_fatturato) || 0
  const beT = parseFloat(tt.be_totale || be.costi_totali) || 0
  const pctFat  = tgt > 0 ? (fat / tgt) * 100 : 0
  const margine = parseFloat(be.margine) || 0
  const pctMarg = fat > 0 ? (margine / fat) * 100 : 0
  const pctBE   = fat > 0 ? (beT / fat) * 100 : 0

  const colorFat = pctFat >= 100 ? 'emerald' : pctFat >= 80 ? 'indigo' : pctFat >= 60 ? 'amber' : 'red'

  const obiettivi = (state.bonusTeam || []).filter(b => b.obiettivo_prodotto || b.prodotto)

  return (
    <div className="space-y-5">
      {/* Fatturato vs Target */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">Fatturato Mese vs Obiettivo</h3>
          <Link to="/kpi-team" className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
            Dettaglio <ArrowRight size={12}/>
          </Link>
        </div>
        <div className="flex items-end gap-4 mb-3">
          <div>
            <div className="text-3xl font-bold text-gray-900">{fmtEur(fat)}</div>
            <div className="text-xs text-gray-400">fatturato mese</div>
          </div>
          {tgt > 0 && (
            <div className="text-gray-400 text-sm pb-1">
              su <span className="font-semibold text-gray-700">{fmtEur(tgt)}</span> target
            </div>
          )}
        </div>
        {tgt > 0 && (
          <>
            <div className={`h-3 rounded-full overflow-hidden ${
              colorFat === 'emerald' ? 'bg-emerald-100' :
              colorFat === 'amber'   ? 'bg-amber-100' :
              colorFat === 'red'     ? 'bg-red-100' : 'bg-indigo-100'
            }`}>
              <div
                className={`h-full rounded-full transition-all ${
                  colorFat === 'emerald' ? 'bg-emerald-500' :
                  colorFat === 'amber'   ? 'bg-amber-400' :
                  colorFat === 'red'     ? 'bg-red-500' : 'bg-indigo-500'
                }`}
                style={{ width: `${clamp(pctFat, 0, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>0</span>
              <span className={`font-bold text-sm ${
                colorFat === 'emerald' ? 'text-emerald-600' :
                colorFat === 'amber'   ? 'text-amber-600' :
                colorFat === 'red'     ? 'text-red-600' : 'text-indigo-600'
              }`}>{pctFat.toFixed(1)}%</span>
              <span>{fmtEur(tgt)}</span>
            </div>
            {fat < tgt && (
              <p className="text-xs text-amber-600 mt-2">
                Mancano <strong>{fmtEur(tgt - fat)}</strong> al target
              </p>
            )}
          </>
        )}
        {!tgt && (
          <p className="text-xs text-gray-400 italic">
            Target non configurato —{' '}
            <Link to="/kpi-config" className="text-indigo-600 underline">Configura in KPI Config → BE & Target Team</Link>
          </p>
        )}
      </div>

      {/* BE & Margine */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Break-Even</div>
          <div className="text-xl font-bold text-gray-900">{fmtEur(beT)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{pctBE.toFixed(1)}% del fat.</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Margine</div>
          <div className={`text-xl font-bold ${margine >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtEur(margine)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{pctMarg.toFixed(1)}% del fat.</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">% Personale</div>
          <div className={`text-xl font-bold ${(parseFloat(be.pct_personale)||0) > 35 ? 'text-amber-600' : 'text-gray-900'}`}>
            {fmtPct(be.pct_personale)}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">standard &lt; 35%</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Coperti</div>
          <div className="text-xl font-bold text-gray-900">{fmt(be.coperti)}</div>
          <div className="text-xs text-gray-400 mt-0.5">
            {be.coperti > 0 && fat > 0 ? `€ ${(fat / be.coperti).toFixed(2)} /coperto` : '—'}
          </div>
        </div>
      </div>

      {/* Premio team */}
      {tt.premio_team_euro > 0 && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
          <div className="flex items-center gap-2">
            <Award size={18} className="text-violet-600" />
            <span className="font-semibold text-violet-800">Premio Team</span>
          </div>
          <div className="text-2xl font-bold text-violet-700 mt-1">{fmtEur(tt.premio_team_euro)}</div>
          <p className="text-xs text-violet-600 mt-1">
            Raggiunto al {pctFat.toFixed(1)}% del target fatturato
          </p>
        </div>
      )}

      {/* Obiettivi prodotto */}
      {obiettivi.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Zap size={16} className="text-amber-500" /> Obiettivi Prodotto
          </h3>
          <div className="space-y-2">
            {obiettivi.map((ob, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-100 last:border-0">
                <span className="text-gray-700">{ob.obiettivo_prodotto || ob.prodotto}</span>
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 text-xs">{fmtEur(ob.target_vendite_euro || ob.target)}</span>
                  {(ob.raggiunto || ob.completato)
                    ? <CheckCircle size={16} className="text-emerald-500" />
                    : <XCircle   size={16} className="text-gray-300" />
                  }
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── TAB 4: Tavoli ──────────────────────────────────────────────────────────
function TabTavoli({ sede, anno, mese }) {
  const [tavoli,  setTavoli]  = useState([])
  const [loading, setLoading] = useState(true)
  const [sortBy,  setSortBy]  = useState('incasso')

  useEffect(() => {
    setLoading(true)
    const ini  = `${anno}-${String(mese).padStart(2,'0')}-01`
    const fine = new Date(anno, mese, 0).toISOString().slice(0,10)
    supabase.from('statistiche_tavoli')
      .select('tavolo, n_coperti, n_ordini, incasso, scontrino_medio, durata_media_min')
      .eq('sede', sede)
      .gte('data_inizio', ini).lte('data_fine', fine)
      .then(({ data }) => {
        // Aggrega per tavolo (possono esserci più range)
        const byT = {}
        for (const r of data || []) {
          if (!byT[r.tavolo]) byT[r.tavolo] = {
            tavolo: r.tavolo, n_coperti: 0, n_ordini: 0,
            incasso: 0, scontrino_sum: 0, durata_sum: 0, n_rows: 0
          }
          const t = byT[r.tavolo]
          t.n_coperti    += parseInt(r.n_coperti) || 0
          t.n_ordini     += parseInt(r.n_ordini)  || 0
          t.incasso      += parseFloat(r.incasso) || 0
          t.scontrino_sum+= parseFloat(r.scontrino_medio) || 0
          t.durata_sum   += parseInt(r.durata_media_min) || 0
          t.n_rows++
        }
        const arr = Object.values(byT).map(t => ({
          ...t,
          scontrino_medio: t.n_rows > 0 ? t.scontrino_sum / t.n_rows : 0,
          durata_media_min: t.n_rows > 0 ? Math.round(t.durata_sum / t.n_rows) : 0,
        }))
        setTavoli(arr)
      })
      .finally(() => setLoading(false))
  }, [sede, anno, mese])

  const sorted = useMemo(() => {
    const arr = [...tavoli]
    if (sortBy === 'incasso')   arr.sort((a, b) => b.incasso - a.incasso)
    if (sortBy === 'scontrino') arr.sort((a, b) => b.scontrino_medio - a.scontrino_medio)
    if (sortBy === 'coperti')   arr.sort((a, b) => b.n_coperti - a.n_coperti)
    if (sortBy === 'durata')    arr.sort((a, b) => b.durata_media_min - a.durata_media_min)
    return arr
  }, [tavoli, sortBy])

  const totIncasso  = useMemo(() => tavoli.reduce((s, t) => s + t.incasso, 0), [tavoli])
  const totCoperti  = useMemo(() => tavoli.reduce((s, t) => s + t.n_coperti, 0), [tavoli])
  const avgScontr   = useMemo(() => tavoli.length ? tavoli.reduce((s,t) => s + t.scontrino_medio,0)/tavoli.length : 0, [tavoli])

  function SortBtn({ id, label }) {
    return (
      <button onClick={() => setSortBy(id)}
        className={`text-right text-xs font-semibold uppercase tracking-wider cursor-pointer select-none px-3 py-2 ${sortBy === id ? 'text-indigo-700' : 'text-gray-500 hover:text-gray-800'}`}>
        {label} {sortBy === id ? '↓' : ''}
      </button>
    )
  }

  if (loading) return <Spinner />
  if (tavoli.length === 0) return (
    <div className="text-center py-10 text-gray-400 text-sm">
      Nessun dato tavoli per {MESI[mese-1]} {anno} — {sede}.<br/>
      <Link to="/statistiche" className="text-indigo-600 hover:underline mt-1 inline-block">Vai a Statistiche Sala</Link>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <div className="text-xs text-gray-500 uppercase mb-0.5">Incasso Totale</div>
          <div className="text-lg font-bold text-indigo-700">{fmtEur(totIncasso)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <div className="text-xs text-gray-500 uppercase mb-0.5">Coperti Totali</div>
          <div className="text-lg font-bold text-gray-900">{fmt(totCoperti)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <div className="text-xs text-gray-500 uppercase mb-0.5">Scontrino Medio</div>
          <div className="text-lg font-bold text-emerald-600">{fmtEur(avgScontr)}</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Tavolo</th>
              <SortBtn id="incasso"   label="Incasso" />
              <SortBtn id="scontrino" label="Scontrino Medio" />
              <SortBtn id="coperti"   label="Coperti" />
              <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Ordini</th>
              <SortBtn id="durata"    label="Durata (min)" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(t => {
              const sm = t.scontrino_medio
              const smColor = sm >= 100 ? 'text-emerald-600' : sm >= 60 ? 'text-amber-600' : 'text-gray-500'
              return (
                <tr key={t.tavolo} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2.5 font-semibold text-gray-900">{t.tavolo}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-indigo-700 font-semibold">{fmtEur(t.incasso)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono font-semibold ${smColor}`}>{fmtEur(sm)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmt(t.n_coperti)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-gray-600">{t.n_ordini}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-gray-500">
                    <span className="flex items-center justify-end gap-1">
                      <Clock size={11} className="text-gray-400" />
                      {t.durata_media_min}′
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 border-t-2 border-gray-300 font-semibold">
            <tr>
              <td className="px-3 py-2.5 text-xs text-gray-600 uppercase">Totale</td>
              <td className="px-3 py-2.5 text-right font-mono text-indigo-700">{fmtEur(totIncasso)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-emerald-600">{fmtEur(avgScontr)} avg</td>
              <td className="px-3 py-2.5 text-right font-mono">{fmt(totCoperti)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Dati periodo: {String(mese).padStart(2,'0')}/{anno} — {tavoli.length} tavoli attivi.{' '}
        <Link to="/statistiche" className="text-indigo-500 hover:underline">Vista completa sala →</Link>
      </p>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function PerformancePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const now     = new Date()
  const [sede,  setSede]  = useState('MA')
  const [anno,  setAnno]  = useState(now.getFullYear())
  const [mese,  setMese]  = useState(now.getMonth() + 1)
  const [tab,   setTab]   = useState(searchParams.get('tab') || 'venduto')
  const [overview, setOverview] = useState(null)
  const [loading,  setLoading]  = useState(true)

  // Sync tab to URL
  const handleTabChange = useCallback(t => {
    setTab(t)
    setSearchParams({ tab: t }, { replace: true })
  }, [setSearchParams])

  // Load overview data
  useEffect(() => {
    setLoading(true)
    Promise.all([
      beMensileApi.mese({ sede, anno, mese }),
      kpiTargetsApi.getTeam({ sede, anno, mese }),
      operatoreMeseApi.list({ sede, anno, mese }),
    ]).then(([be, tt, ops]) => {
      const fat    = parseFloat(be?.fatturato) || 0
      const tgt    = parseFloat(tt?.target_fatturato) || 0
      const cop    = parseInt(be?.coperti) || 0
      const marg   = parseFloat(be?.margine) || 0
      const filtOps = (ops||[]).filter(o => !PSEUDO_OPS.includes(o.operatore?.toLowerCase()))
      const quantum = cop > 0 && fat > 0 ? fat / cop : 0
      setOverview({ fat, tgt, cop, marg, quantum, n_ops: filtOps.length })
    }).finally(() => setLoading(false))
  }, [sede, anno, mese])

  const anni = useMemo(() => {
    const a = []; for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) a.push(y); return a
  }, [])

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">

      {/* ─── Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 size={24} className="text-indigo-600" />
            Performance
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Venduto · Obiettivi · Team · Tavoli — tutto in un posto
          </p>
        </div>

        {/* Filtri */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Sede */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium">
            {['MA','PN'].map(s => (
              <button
                key={s}
                onClick={() => setSede(s)}
                className={`px-4 py-1.5 transition-colors ${sede === s ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {s === 'MA' ? 'Mameli' : 'Predda Niedda'}
              </button>
            ))}
          </div>

          {/* Mese */}
          <select
            value={mese}
            onChange={e => setMese(parseInt(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {MESI.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>

          {/* Anno */}
          <select
            value={anno}
            onChange={e => setAnno(parseInt(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {anni.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {/* ─── Overview cards ───────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-gray-100 rounded-xl h-20 animate-pulse" />
          ))}
        </div>
      ) : overview && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <OverviewCard icon={Euro}       label="Fatturato Mese"  value={fmtEur(overview.fat)}       color="indigo"
            sub={overview.tgt > 0 ? `su ${fmtEur(overview.tgt)} target` : 'Nessun target'}
            trend={overview.tgt > 0 ? ((overview.fat - overview.tgt) / overview.tgt * 100) : null}
          />
          <OverviewCard icon={Target}     label="% vs Target"
            value={overview.tgt > 0 ? `${((overview.fat/overview.tgt)*100).toFixed(1)}%` : '—'}
            color={overview.fat >= overview.tgt ? 'emerald' : 'amber'}
            sub={overview.tgt > 0 && overview.fat < overview.tgt ? `Mancano ${fmtEur(overview.tgt - overview.fat)}` : overview.tgt > 0 ? 'Obiettivo raggiunto ✓' : 'Configura in KPI Config'}
          />
          <OverviewCard icon={TrendingUp} label="Margine"
            value={fmtEur(overview.marg)}
            color={overview.marg >= 0 ? 'emerald' : 'amber'}
            sub={overview.fat > 0 ? `${((overview.marg/overview.fat)*100).toFixed(1)}% del fatturato` : ''}
          />
          <OverviewCard icon={Utensils}   label="Quantum €/coperto" value={overview.quantum > 0 ? `€ ${overview.quantum.toFixed(2)}` : '—'}
            color="sky"
            sub={`${fmt(overview.cop)} coperti`}
          />
          <OverviewCard icon={Users}      label="Operatori Attivi" value={overview.n_ops}
            color="violet"
            sub={`${MESI[mese-1]} ${anno} · ${sede}`}
          />
        </div>
      )}

      {/* ─── Tab bar + content ────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <TabBar active={tab} onChange={handleTabChange} />
        {tab === 'venduto'   && <TabVenduto   sede={sede} anno={anno} mese={mese} />}
        {tab === 'obiettivi' && <TabObiettivi sede={sede} anno={anno} mese={mese} />}
        {tab === 'team'      && <TabTeam      sede={sede} anno={anno} mese={mese} />}
        {tab === 'tavoli'    && <TabTavoli    sede={sede} anno={anno} mese={mese} />}
      </div>

      {/* ─── Quick links ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 text-xs text-gray-400">
        <Link to="/venduto"     className="hover:text-indigo-600 transition-colors">→ BI Venduto Completa</Link>
        <span>·</span>
        <Link to="/kpi-team"    className="hover:text-indigo-600 transition-colors">→ KPI Team Dettagliato</Link>
        <span>·</span>
        <Link to="/kpi-config"  className="hover:text-indigo-600 transition-colors">→ Configura Obiettivi</Link>
        <span>·</span>
        <Link to="/statistiche" className="hover:text-indigo-600 transition-colors">→ Statistiche Sala</Link>
      </div>
    </div>
  )
}
