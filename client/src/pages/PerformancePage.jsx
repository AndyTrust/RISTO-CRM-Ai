/**
 * PerformancePage.jsx — Hub Performance — KPI Camerieri e Sedi
 * Filtri condivisi (sede + mese/anno) + overview cards + 4 tab:
 *   Venduto | Obiettivi | Team | Tavoli
 *
 * Dati: v_operatore_mese, v_be_mensile, kpi_targets_team,
 *       kpi_targets_individuale (+employees), statistiche_tavoli,
 *       v_bonus_operatore, v_bonus_team, venduto_camerieri
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTabParam } from '../hooks/useTabParam'
import {
  TrendingUp, Target, Users, BarChart3, Table2,
  ChevronDown, ChevronUp, ArrowRight, RefreshCw,
  Award, Zap, Euro, Utensils, Clock, CheckCircle, XCircle,
  Gift, Sliders, Trophy, AlertCircle
} from 'lucide-react'
import { operatoreMeseApi, beMensileApi, kpiTargetsApi, bonusApi } from '../api/client'
import supabase from '../supabase'
import { fetchPaged, fetchPagedInfo } from '../api/paged'
import { useOrdinamento, IconaOrdine, BottoneCsv, NotaCopertura } from '../lib/tabella'
import useAnniDisponibili from '../hooks/useAnniDisponibili'
import PageStatsWidget from '../components/PageStatsWidget'

// ── Constants ──────────────────────────────────────────────────────────────
const MESI = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const PSEUDO_OPS = ['pienissimo','sistema','admin','test']
const COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ec4899','#8b5cf6','#ef4444','#14b8a6']
const TABS = [
  { id: 'venduto',   label: 'Venduto',    icon: TrendingUp },
  { id: 'obiettivi', label: 'Obiettivi',  icon: Target },
  { id: 'team',      label: 'Team',       icon: Users },
  { id: 'tavoli',    label: 'Tavoli',     icon: Table2 },
  { id: 'incentivi', label: 'Incentivi',  icon: Gift },
]
const TAB_IDS = TABS.map(t => t.id)

// ── Utils ──────────────────────────────────────────────────────────────────
const fmt    = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtEur = n => n == null || isNaN(n) ? '—' : `€ ${fmt(n, 2)}`
const fmtPct = n => n == null || isNaN(n) ? '—' : `${fmt(n, 1)}%`
const clamp  = (v, min, max) => Math.min(Math.max(v, min), max)

function firstWord(name = '') { return name.trim().split(/\s+/)[0].toUpperCase() }

/**
 * Date del mese in ISO, calcolate SEMPRE in fuso locale.
 *
 * `new Date(anno, mese, 0).toISOString().slice(0,10)` — il pattern che era
 * ripetuto in cinque punti di questo file — costruisce la mezzanotte LOCALE
 * dell'ultimo giorno del mese e la converte in UTC: in Italia (UTC+1/+2)
 * diventa il giorno PRECEDENTE, quindi `.lte('data_fine', …)` tagliava via
 * l'ultimo giorno di ogni mese senza segnalare nulla.
 */
const ymd        = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const inizioMese = (anno, mese) => `${anno}-${String(mese).padStart(2, '0')}-01`
const fineMese   = (anno, mese) => ymd(new Date(anno, mese, 0))   // giorno 0 = ultimo del mese precedente

// ── Shared UI ──────────────────────────────────────────────────────────────
function Spinner({ small } = {}) {
  return <div className={`text-center text-gray-400 ${small ? 'py-4 text-xs' : 'py-12'}`}>Caricamento…</div>
}

/**
 * Errore visibile in pagina.
 * Il client Supabase non rigetta mai: senza mostrare l'errore, un blocco RLS o
 * una rete caduta diventano indistinguibili da "nessun dato nel periodo".
 */
function Errore({ messaggio, contesto }) {
  if (!messaggio) return null
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3 my-2">
      <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-red-800">
          {contesto ? `Errore nel caricamento — ${contesto}` : 'Errore nel caricamento dei dati'}
        </p>
        <p className="text-xs text-red-700 mt-0.5 break-words">{messaggio}</p>
        <p className="text-[11px] text-red-500 mt-1">I numeri mostrati sono incompleti o assenti: non usarli per decidere.</p>
      </div>
    </div>
  )
}

function OverviewCard({ icon: Icon, label, value, sub, color = 'indigo', trend }) {
  const bg  = { indigo:'bg-indigo-50 text-indigo-600', emerald:'bg-emerald-50 text-emerald-600', amber:'bg-amber-50 text-amber-600', violet:'bg-violet-50 text-violet-600', sky:'bg-sky-50 text-sky-600' }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col gap-1 min-w-0">
      <PageStatsWidget />
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
  const [errore,  setErrore]  = useState(null)
  const [expanded,    setExpanded]    = useState(null)      // operatore espanso
  const [expandedCat, setExpandedCat] = useState({})        // { op: catName | null }
  const [prodotti,    setProdotti]    = useState({})        // { op: [{cat,pezzi,totale}] }
  const [prodByCat,   setProdByCat]   = useState({})        // { "op|cat": [{prod,pezzi,totale}] }
  const [errDrill,    setErrDrill]    = useState(null)
  const [copertura,   setCopertura]   = useState({})        // { op: {righe, troncato} }

  useEffect(() => {
    let annullato = false
    setLoading(true)
    setErrore(null)
    // Cambiando periodo/sede i drill-down già aperti non valgono più: tenerli
    // in cache mostrerebbe i prodotti del mese precedente sotto l'intestazione
    // del mese nuovo.
    setProdotti({})
    setProdByCat({})
    setCopertura({})
    setExpanded(null)
    operatoreMeseApi.list({ sede, anno, mese })
      .then(data => {
        if (annullato) return
        setOps((data || []).filter(op => !PSEUDO_OPS.includes(op.operatore?.toLowerCase())))
      })
      .catch(e => { if (!annullato) setErrore(e?.message || String(e)) })
      .finally(() => { if (!annullato) setLoading(false) })
    return () => { annullato = true }
  }, [sede, anno, mese])

  // Righe piatte e numeriche: le colonne della tabella devono essere le stesse
  // chiavi su cui si ordina, altrimenti l'ordinamento e ciò che si legge
  // divergono.
  const righe = useMemo(() => ops.map(o => ({
    operatore: o.operatore,
    op:        o,
    fatturato: parseFloat(o.fatturato_stimato_operatore) || 0,
    pezzi:     parseInt(o.tot_pezzi) || 0,
    aggiunte:  parseFloat(o.tot_importo_aggiunte) || 0,
    aggiuntePz: parseInt(o.tot_aggiunte) || 0,
  })), [ops])

  const totFat   = useMemo(() => righe.reduce((s, o) => s + o.fatturato, 0), [righe])
  const totPezzi = useMemo(() => righe.reduce((s, o) => s + o.pezzi, 0), [righe])
  const totAgg   = useMemo(() => righe.reduce((s, o) => s + o.aggiunte, 0), [righe])

  const righeConQuota = useMemo(() => righe.map(r => ({
    ...r,
    pctTeam: totFat > 0 ? (r.fatturato / totFat) * 100 : 0,
  })), [righe, totFat])

  const { righeOrdinate, colonna, direzione, propsTh } = useOrdinamento(righeConQuota, 'fatturato', 'desc')

  async function toggleExpand(op) {
    const key = op.operatore
    if (expanded === key) { setExpanded(null); return }
    setExpanded(key)
    if (prodotti[key]) return
    setErrDrill(null)
    try {
      // Paginato: senza questo il drill-down leggeva al massimo 1000 righe di
      // venduto_camerieri e i totali per categoria erano sottostimati in
      // silenzio — nessun errore, solo numeri più bassi del vero.
      const { righe: dati, troncato } = await fetchPagedInfo(
        () => supabase
          .from('venduto_camerieri')
          .select('id,categoria,prodotto,quantita,totale')
          .eq('sede', sede).eq('operatore', op.operatore)
          .gte('data_inizio', inizioMese(anno, mese)).lte('data_fine', fineMese(anno, mese))
          .not('prodotto', 'ilike', '%coperto%'),
        'id'
      )
      // Aggrega per categoria, filtra solo items con valore economico > €0.01
      const byCat = {}
      for (const r of dati) {
        const tot = parseFloat(r.totale) || 0
        if (tot <= 0.01) continue   // escludi items senza valore economico
        const cat = r.categoria || 'Altro'
        if (!byCat[cat]) byCat[cat] = { cat, pezzi: 0, totale: 0 }
        byCat[cat].pezzi  += parseFloat(r.quantita) || 0
        byCat[cat].totale += tot
      }
      const sortedCats = Object.values(byCat).sort((a, b) => b.totale - a.totale)
      setProdotti(p => ({ ...p, [key]: sortedCats }))
      setCopertura(c => ({ ...c, [key]: { righe: dati.length, troncato } }))
    } catch (e) {
      setErrDrill(e?.message || String(e))
      setProdotti(p => ({ ...p, [key]: [] }))
    }
  }

  async function toggleExpandCat(op, cat) {
    const opKey  = op.operatore || op
    const cKey   = `${opKey}|${cat}`
    setExpandedCat(prev => ({
      ...prev,
      [opKey]: prev[opKey] === cat ? null : cat,
    }))
    if (prodByCat[cKey]) return
    setErrDrill(null)
    try {
      const dati = await fetchPaged(
        () => supabase
          .from('venduto_camerieri')
          .select('id,prodotto,quantita,totale')
          .eq('sede', sede).eq('operatore', opKey)
          .eq('categoria', cat)
          .gte('data_inizio', inizioMese(anno, mese)).lte('data_fine', fineMese(anno, mese))
          .not('prodotto', 'ilike', '%coperto%'),
        'id'
      )
      // Aggrega per prodotto
      const byProd = {}
      for (const r of dati) {
        const tot = parseFloat(r.totale) || 0
        if (tot <= 0.01) continue
        const prod = r.prodotto || '—'
        if (!byProd[prod]) byProd[prod] = { prod, pezzi: 0, totale: 0 }
        byProd[prod].pezzi  += parseFloat(r.quantita) || 0
        byProd[prod].totale += tot
      }
      const prodArr = Object.values(byProd).sort((a, b) => b.totale - a.totale)
      setProdByCat(p => ({ ...p, [cKey]: prodArr }))
    } catch (e) {
      setErrDrill(e?.message || String(e))
      setProdByCat(p => ({ ...p, [cKey]: [] }))
    }
  }

  // Intestazione ordinabile: bidirezionale, mancanti in coda (useOrdinamento).
  function ThOrd({ col, label }) {
    return (
      <th
        {...propsTh(col)}
        className={`text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none ${colonna === col ? 'text-indigo-700' : 'text-gray-500 hover:text-gray-800'}`}
      >
        {label}<IconaOrdine colonna={col} colonnaAttiva={colonna} direzione={direzione} />
      </th>
    )
  }

  if (loading) return <Spinner />
  if (errore)  return <Errore messaggio={errore} contesto="operatori del mese" />

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
              {/* BUG storico: qui c'erano <SortBtn> e `sorted`, dichiarati DENTRO
                  TabTavoli e quindi fuori scope → ReferenceError, tab bianco.
                  Ora si usano ThOrd/righeOrdinate di QUESTO componente. */}
              <ThOrd col="fatturato" label="Fatturato" />
              <ThOrd col="pezzi"     label="Pezzi" />
              <ThOrd col="pctTeam"   label="% Team" />
              <ThOrd col="aggiunte"  label="Aggiunte €" />
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {righeOrdinate.map((r, i) => {
              const op = r.op
              const isExp = expanded === op.operatore
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
                      {fmtEur(r.fatturato)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">{fmt(r.pezzi)}</td>
                    <td className="px-3 py-2.5 w-32">
                      <div className="flex items-center gap-2">
                        <ProgressBar value={r.pctTeam} max={100} color="indigo" />
                        <span className="text-xs text-gray-500 w-10 text-right">{r.pctTeam.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-emerald-700 font-mono">
                      {fmtEur(r.aggiunte)}
                      <span className="text-gray-400 text-xs ml-1">({fmt(r.aggiuntePz)} pz)</span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-400">{isExp ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</td>
                  </tr>
                  {isExp && (
                    <tr className="bg-indigo-50/50 border-b">
                      <td colSpan={7} className="px-6 py-3">
                        {!prodotti[op.operatore]
                          ? <span className="text-xs text-gray-400">Caricamento…</span>
                          : prodotti[op.operatore].length === 0
                            ? <span className="text-xs text-gray-400">Nessun prodotto con valore &gt; €0.01 nel periodo</span>
                            : (
                              <div className="space-y-2">
                                <p className="text-[10px] text-indigo-400 uppercase font-semibold tracking-wider mb-1">
                                  Categorie — clicca per vedere i prodotti
                                </p>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                                  {prodotti[op.operatore].map(c => {
                                    const isCatExp = expandedCat[op.operatore] === c.cat
                                    const cKey = `${op.operatore}|${c.cat}`
                                    return (
                                      <div key={c.cat} className="space-y-1">
                                        <div
                                          className={`rounded-lg border p-2.5 cursor-pointer transition-all ${isCatExp ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-indigo-100 hover:border-indigo-300'}`}
                                          onClick={() => toggleExpandCat(op, c.cat)}
                                        >
                                          <div className={`text-[10px] font-medium uppercase truncate ${isCatExp ? 'text-indigo-100' : 'text-gray-400'}`}>{c.cat}</div>
                                          <div className={`text-sm font-bold ${isCatExp ? 'text-white' : 'text-indigo-700'}`}>{fmtEur(c.totale)}</div>
                                          <div className={`text-xs ${isCatExp ? 'text-indigo-200' : 'text-gray-500'}`}>{fmt(c.pezzi)} pz {isCatExp ? '▲' : '▼'}</div>
                                        </div>
                                        {isCatExp && (
                                          <div className="bg-white rounded-lg border border-indigo-100 overflow-hidden">
                                            {!prodByCat[cKey]
                                              ? <div className="text-xs text-gray-400 px-2 py-1.5">Caricamento…</div>
                                              : prodByCat[cKey].length === 0
                                                ? <div className="text-xs text-gray-400 px-2 py-1.5">Nessun prodotto</div>
                                                : prodByCat[cKey].map((p, pi) => (
                                                    <div key={pi} className="flex items-center justify-between px-2 py-1 border-b border-gray-50 last:border-0 hover:bg-indigo-50/50">
                                                      <span className="text-[10px] text-gray-700 flex-1 truncate pr-1" title={p.prod}>{p.prod}</span>
                                                      <div className="text-right flex-shrink-0">
                                                        <div className="text-[10px] font-mono font-bold text-indigo-700">{fmtEur(p.totale)}</div>
                                                        <div className="text-[9px] text-gray-400">{fmt(p.pezzi)} pz</div>
                                                      </div>
                                                    </div>
                                                  ))
                                            }
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
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
        // Fix: la colonna employees si chiama "name" (la select è già employees(name,...))
        const name = t.employees?.name || ''
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
  // BE live (v_be_mensile) prioritario sul valore salvato, che può essere obsoleto
  const beT = parseFloat(be.costi_totali ?? tt.be_totale) || 0
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
          <div className="text-xs text-gray-400 mt-0.5">
            {new Date().getFullYear() === anno && (new Date().getMonth() + 1) === mese
              ? 'stima mensile / ricavo parziale'
              : 'standard < 35%'}
          </div>
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
  const [errore,  setErrore]  = useState(null)

  useEffect(() => {
    let annullato = false
    setLoading(true)
    setErrore(null)

    const ini  = inizioMese(anno, mese)
    const fine = fineMese(anno, mese)

    ;(async () => {
      try {
        // Paginazione VERA: il `.range(0, 4999)` non alzava il tetto server di
        // 1000 righe, quindi su un mese pieno l'aggregazione per tavolo
        // sommava solo una parte degli scontrini e li presentava come totale.
        const righe = await fetchPaged(
          () => supabase.from('statistiche_tavoli')
            .select('id, tavolo, n_coperti, n_ordini, incasso, scontrino_medio, durata_media_min')
            .eq('sede', sede)
            .gte('data_inizio', ini).lte('data_fine', fine),
          'id'
        )
        if (annullato) return

        // Aggrega per tavolo (possono esserci più righe per tavolo nel periodo)
        const byT = {}
        for (const r of righe) {
          if (!byT[r.tavolo]) byT[r.tavolo] = {
            tavolo: r.tavolo, n_coperti: 0, n_ordini: 0,
            incasso: 0, durata_sum: 0, n_rows: 0
          }
          const t = byT[r.tavolo]
          t.n_coperti  += parseInt(r.n_coperti) || 0
          t.n_ordini   += parseInt(r.n_ordini)  || 0
          t.incasso    += parseFloat(r.incasso) || 0
          t.durata_sum += parseInt(r.durata_media_min) || 0
          t.n_rows++
        }
        const arr = Object.values(byT).map(t => ({
          ...t,
          // scontrino medio = incasso totale / numero ordini totali (NON media di medie)
          scontrino_medio: t.n_ordini > 0 ? t.incasso / t.n_ordini : 0,
          durata_media_min: t.n_rows > 0 ? Math.round(t.durata_sum / t.n_rows) : 0,
        }))
        setTavoli(arr)
      } catch (e) {
        // Il `.then(({ data }) => …)` senza `error` faceva sembrare un blocco
        // RLS una sala senza incassi.
        if (!annullato) { setErrore(e.message || String(e)); setTavoli([]) }
      } finally {
        if (!annullato) setLoading(false)
      }
    })()

    return () => { annullato = true }
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
  const totOrdini   = useMemo(() => tavoli.reduce((s, t) => s + t.n_ordini, 0), [tavoli])
  // avgScontr = incasso totale / ordini totali (NON media di medie)
  const avgScontr   = useMemo(() => totOrdini > 0 ? totIncasso / totOrdini : 0, [totIncasso, totOrdini])

  function SortBtn({ id, label }) {
    return (
      <th className="text-right p-0">
        <button onClick={() => setSortBy(id)}
          className={`w-full text-right text-xs font-semibold uppercase tracking-wider cursor-pointer select-none px-3 py-2 ${sortBy === id ? 'text-indigo-700' : 'text-gray-500 hover:text-gray-800'}`}>
          {label} {sortBy === id ? '↓' : ''}
        </button>
      </th>
    )
  }

  if (loading) return <Spinner />
  if (errore) return <Errore messaggio={errore} contesto="statistiche_tavoli" />
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

// ── TAB 5: Incentivi ──────────────────────────────────────────────────────
function TabIncentivi({ sede, anno, mese }) {
  const [nMesi, setNMesi] = useState(3)
  const [percIncremento, setPercIncremento] = useState(10)
  const [viewMode, setViewMode] = useState('cards')   // 'cards' | 'matrix'
  const [loading, setLoading] = useState(true)
  const [quorumMap, setQuorumMap] = useState({})      // { op: { cat: { quorum, target, months } } }
  const [currentMap, setCurrentMap] = useState({})    // { op: { cat: qty } }
  const [operatori, setOperatori] = useState([])
  const [categorie, setCategorie] = useState([])
  const [variantiMap, setVariantiMap] = useState({})  // { op: tot_aggiunte }
  const [errore, setErrore] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setErrore(null)
    try {
      // Quorum: N mesi PRIMA del mese corrente.
      // Le date passano da ymd() e non da toISOString(): quest'ultima converte
      // in UTC e in fuso italiano faceva slittare ogni estremo al giorno prima.
      const quorumEnd   = new Date(anno, mese - 1, 0)         // ultimo giorno mese precedente
      const quorumStart = new Date(anno, mese - 1 - nMesi, 1) // N mesi fa
      const qFrom = ymd(quorumStart)
      const qTo   = ymd(quorumEnd)

      // Mese corrente
      const curFrom = inizioMese(anno, mese)
      const curTo   = fineMese(anno, mese)

      // Il quorum è una MEDIA MENSILE su N mesi di venduto_camerieri (19.400
      // righe): con `.range(0, 9999)` il server ne restituiva 1000 e la media
      // veniva calcolata su una frazione arbitraria del periodo — cioè il
      // target incentivi di ogni operatore era sbagliato senza alcun segnale.
      const [hist, curr, varCurr] = await Promise.all([
        fetchPaged(() => supabase.from('venduto_camerieri')
          .select('id, operatore, categoria, quantita, data_inizio')
          .eq('sede', sede)
          .not('operatore', 'ilike', '%pienissimo%')
          .lte('data_inizio', qTo)
          .gte('data_fine', qFrom), 'id'),
        fetchPaged(() => supabase.from('venduto_camerieri')
          .select('id, operatore, categoria, quantita')
          .eq('sede', sede)
          .not('operatore', 'ilike', '%pienissimo%')
          .lte('data_inizio', curTo)
          .gte('data_fine', curFrom), 'id'),
        fetchPaged(() => supabase.from('varianti_camerieri')
          .select('id, operatore, aggiunta_qty')
          .eq('sede', sede)
          .not('operatore', 'ilike', '%pienissimo%')
          .lte('data_inizio', curTo)
          .gte('data_fine', curFrom), 'id'),
      ])

      // ── Storico: raggruppa per op + cat + mese ──────────────────────────
      const monthlyByKey = {}
      for (const r of hist || []) {
        if (PSEUDO_OPS.includes(r.operatore?.toLowerCase())) continue
        const cat   = (!r.categoria || r.categoria === 'nan') ? 'Altro' : r.categoria
        const month = r.data_inizio?.slice(0, 7)
        const key   = `${r.operatore}|${cat}|${month}`
        if (!monthlyByKey[key]) monthlyByKey[key] = { op: r.operatore, cat, month, qty: 0 }
        monthlyByKey[key].qty += parseFloat(r.quantita) || 0
      }

      // ── Calcola quorum: media mensile per op + cat ───────────────────────
      const sumByOpCat = {}
      for (const r of Object.values(monthlyByKey)) {
        const key = `${r.op}|${r.cat}`
        if (!sumByOpCat[key]) sumByOpCat[key] = { op: r.op, cat: r.cat, total: 0, monthSet: new Set() }
        sumByOpCat[key].total += r.qty
        sumByOpCat[key].monthSet.add(r.month)
      }

      const newQuorumMap = {}
      const opsSet = new Set()
      const catsCount = {}   // { cat: sum quorum } per ordinare categorie

      for (const r of Object.values(sumByOpCat)) {
        const months  = r.monthSet.size
        const quorum  = months > 0 ? Math.round(r.total / months) : 0
        const target  = Math.round(quorum * (1 + percIncremento / 100))
        if (!newQuorumMap[r.op]) newQuorumMap[r.op] = {}
        newQuorumMap[r.op][r.cat] = { quorum, target, months }
        opsSet.add(r.op)
        catsCount[r.cat] = (catsCount[r.cat] || 0) + quorum
      }

      // ── Mese corrente: aggrega per op + cat ─────────────────────────────
      const newCurrentMap = {}
      for (const r of curr || []) {
        if (PSEUDO_OPS.includes(r.operatore?.toLowerCase())) continue
        const cat = (!r.categoria || r.categoria === 'nan') ? 'Altro' : r.categoria
        if (!newCurrentMap[r.operatore]) newCurrentMap[r.operatore] = {}
        newCurrentMap[r.operatore][cat] = (newCurrentMap[r.operatore][cat] || 0) + (parseFloat(r.quantita) || 0)
        opsSet.add(r.operatore)
      }

      // ── Varianti mese corrente ───────────────────────────────────────────
      const newVariantiMap = {}
      for (const r of varCurr || []) {
        if (PSEUDO_OPS.includes(r.operatore?.toLowerCase())) continue
        newVariantiMap[r.operatore] = (newVariantiMap[r.operatore] || 0) + (parseFloat(r.aggiunta_qty) || 0)
      }

      // ── Top categorie per matrice (max 8) ───────────────────────────────
      const topCats = Object.entries(catsCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([cat]) => cat)

      const opsArr = [...opsSet]
        .filter(op => !PSEUDO_OPS.includes(op.toLowerCase()))
        .sort()

      setQuorumMap(newQuorumMap)
      setCurrentMap(newCurrentMap)
      setVariantiMap(newVariantiMap)
      setOperatori(opsArr)
      setCategorie(topCats)
    } catch (e) {
      // Un errore solo in console lascia a schermo una matrice incentivi
      // apparentemente valida ma vuota o vecchia: qui deve vederlo l'utente.
      console.error('Errore caricamento incentivi:', e)
      setErrore(e.message || String(e))
      setQuorumMap({}); setCurrentMap({}); setVariantiMap({})
      setOperatori([]); setCategorie([])
    } finally {
      setLoading(false)
    }
  }, [sede, anno, mese, nMesi, percIncremento])

  useEffect(() => { loadData() }, [loadData])

  // ── Helpers ──────────────────────────────────────────────────────────────
  const getColor = pct => pct >= 100 ? 'emerald' : pct >= 75 ? 'indigo' : pct >= 45 ? 'amber' : 'red'
  const getClsText = color =>
    color === 'emerald' ? 'text-emerald-600' :
    color === 'indigo'  ? 'text-indigo-600'  :
    color === 'amber'   ? 'text-amber-600'   : 'text-red-500'
  const getClsBg = color =>
    color === 'emerald' ? 'bg-emerald-50'    :
    color === 'indigo'  ? 'bg-indigo-50'     :
    color === 'amber'   ? 'bg-amber-50'      : 'bg-red-50'
  const getClsBar = color =>
    color === 'emerald' ? 'bg-emerald-400'   :
    color === 'indigo'  ? 'bg-indigo-400'    :
    color === 'amber'   ? 'bg-amber-400'     : 'bg-red-400'

  // Stats generali
  const opsOnTrack = operatori.filter(op => {
    const q = quorumMap[op] || {}
    const c = currentMap[op] || {}
    const totalTarget = Object.values(q).reduce((s, v) => s + v.target, 0)
    const totalCurr   = Object.values(c).reduce((s, v) => s + v, 0)
    return totalTarget > 0 && totalCurr >= totalTarget
  }).length

  if (loading) return <Spinner />

  if (operatori.length === 0) return (
    <div className="text-center py-12 text-gray-400">
      <AlertCircle size={32} className="mx-auto mb-3 opacity-30" />
      <p className="text-sm">Nessun dato venduto nei {nMesi} mesi precedenti per {sede} — {MESI[mese-1]} {anno}</p>
      <p className="text-xs mt-1">Verifica che i dati siano stati importati nel CRM</p>
    </div>
  )

  return (
    <div className="space-y-5">

      {/* ── Configurazione ───────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-indigo-50 to-violet-50 rounded-xl border border-indigo-100 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <h3 className="font-semibold text-indigo-900 flex items-center gap-2 text-sm">
              <Sliders size={15} className="text-indigo-600" /> Configurazione Obiettivi
            </h3>
            <p className="text-xs text-indigo-600 mt-0.5">
              Target = media pezzi/mese degli ultimi <strong>{nMesi}</strong> {nMesi === 1 ? 'mese' : 'mesi'}
              {' '}× <strong>{(100 + percIncremento).toFixed(0)}%</strong>
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {/* N mesi */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-indigo-700 whitespace-nowrap">Media su</span>
              <div className="flex rounded-lg border border-indigo-200 overflow-hidden text-sm">
                {[1, 2, 3].map(n => (
                  <button key={n} onClick={() => setNMesi(n)}
                    className={`px-3 py-1 font-medium transition-colors ${nMesi === n ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-700 hover:bg-indigo-50'}`}>
                    {n}m
                  </button>
                ))}
              </div>
            </div>
            {/* % incremento */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-indigo-700 whitespace-nowrap">Incremento</span>
              <div className="flex rounded-lg border border-indigo-200 overflow-hidden text-sm">
                {[5, 10, 15, 20].map(p => (
                  <button key={p} onClick={() => setPercIncremento(p)}
                    className={`px-3 py-1 font-medium transition-colors ${percIncremento === p ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-700 hover:bg-indigo-50'}`}>
                    +{p}%
                  </button>
                ))}
              </div>
            </div>
            {/* Vista */}
            <div className="flex rounded-lg border border-indigo-200 overflow-hidden text-sm">
              {[{ id: 'cards', label: '☰ Carte' }, { id: 'matrix', label: '⊞ Matrice' }].map(v => (
                <button key={v.id} onClick={() => setViewMode(v.id)}
                  className={`px-3 py-1 font-medium transition-colors ${viewMode === v.id ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-700 hover:bg-indigo-50'}`}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Overview ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-indigo-600">{operatori.length}</div>
          <div className="text-xs text-gray-500 mt-0.5">Operatori tracciati</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600">{opsOnTrack}</div>
          <div className="text-xs text-gray-500 mt-0.5">Obiettivo raggiunto ✓</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{nMesi}m · +{percIncremento}%</div>
          <div className="text-xs text-gray-500 mt-0.5">Quorum · Incremento target</div>
        </div>
      </div>

      {/* ── VISTA CARTE ───────────────────────────────────────────── */}
      {viewMode === 'cards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {operatori.map(op => {
            const q = quorumMap[op] || {}
            const c = currentMap[op] || {}
            const totalQuorum = Object.values(q).reduce((s, v) => s + v.quorum, 0)
            const totalTarget = Object.values(q).reduce((s, v) => s + v.target, 0)
            const totalCurr   = Object.values(c).reduce((s, v) => s + v, 0)
            const pctTotal    = totalTarget > 0 ? Math.min(200, Math.round(totalCurr / totalTarget * 100)) : 0
            const colorTotal  = getColor(pctTotal)
            const varTot      = Math.round(variantiMap[op] || 0)

            return (
              <div key={op} className={`bg-white rounded-xl border p-4 space-y-3 ${pctTotal >= 100 ? 'border-emerald-200' : 'border-gray-200'}`}>
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                      COLORS[operatori.indexOf(op) % COLORS.length] ? '' : 'bg-indigo-600'
                    }`} style={{ backgroundColor: COLORS[operatori.indexOf(op) % COLORS.length] }}>
                      {op.charAt(0)}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 text-sm">{op}</div>
                      <div className="text-xs text-gray-400">{fmt(totalCurr)} / {fmt(totalTarget)} pz</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${getClsText(colorTotal)}`}>{pctTotal}%</div>
                    {pctTotal >= 100 && <Trophy size={12} className="text-emerald-500 mx-auto" />}
                  </div>
                </div>

                <ProgressBar value={totalCurr} max={Math.max(totalTarget, 1)} color={colorTotal} />

                {/* Categorie */}
                <div className="space-y-1.5">
                  {categorie.filter(cat => (q[cat]?.target || 0) > 0 || (c[cat] || 0) > 0).slice(0, 6).map(cat => {
                    const qData = q[cat] || { quorum: 0, target: 0 }
                    const curr  = Math.round(c[cat] || 0)
                    const pct   = qData.target > 0 ? Math.min(200, Math.round(curr / qData.target * 100)) : (curr > 0 ? 100 : 0)
                    const col   = getColor(pct)
                    return (
                      <div key={cat} className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 w-24 truncate" title={cat}>{cat}</span>
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${getClsBar(col)}`} style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                        <span className="text-[10px] font-mono text-gray-600 w-12 text-right">{curr}/{fmt(qData.target)}</span>
                        <span className={`text-[10px] font-bold w-8 text-right ${getClsText(col)}`}>{pct}%</span>
                      </div>
                    )
                  })}
                </div>

                {/* Footer */}
                <div className="pt-2 border-t border-gray-100 flex justify-between text-[10px] text-gray-400">
                  <span>Quorum {nMesi}m: ~{fmt(totalQuorum)} pz/m</span>
                  {varTot > 0 && <span className="text-emerald-600 font-medium">+{fmt(varTot)} aggiunte ↑</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── VISTA MATRICE ─────────────────────────────────────────── */}
      {viewMode === 'matrix' && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2.5 text-left font-semibold text-gray-700 min-w-[130px]">Operatore</th>
                <th className="px-3 py-2.5 text-center font-semibold text-indigo-700 min-w-[90px]">Totale</th>
                {categorie.map(cat => (
                  <th key={cat} className="px-3 py-2.5 text-center font-semibold text-gray-600 min-w-[100px] max-w-[130px]">
                    <div className="truncate" title={cat}>{cat}</div>
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center font-semibold text-emerald-700 min-w-[80px]">Aggiunte</th>
              </tr>
              {/* Riga Quorum */}
              <tr className="bg-indigo-50/60 border-b border-indigo-100">
                <td className="px-3 py-1.5 text-indigo-700 font-medium italic text-[11px]">⌀ Media team ({nMesi}m)</td>
                <td className="px-3 py-1.5 text-center text-indigo-500 font-mono">—</td>
                {categorie.map(cat => {
                  const avgQ = operatori.length > 0
                    ? Math.round(operatori.reduce((s, op) => s + (quorumMap[op]?.[cat]?.quorum || 0), 0) / operatori.length)
                    : 0
                  return (
                    <td key={cat} className="px-3 py-1.5 text-center font-mono text-indigo-700 font-semibold">
                      {avgQ > 0 ? fmt(avgQ) : '—'}
                    </td>
                  )
                })}
                <td className="px-3 py-1.5 text-center text-indigo-400 font-mono">—</td>
              </tr>
              {/* Riga Target */}
              <tr className="bg-violet-50/60 border-b border-violet-100">
                <td className="px-3 py-1.5 text-violet-700 font-medium italic text-[11px]">⌀ Target medio (+{percIncremento}%)</td>
                <td className="px-3 py-1.5 text-center text-violet-500 font-mono">—</td>
                {categorie.map(cat => {
                  const avgT = operatori.length > 0
                    ? Math.round(operatori.reduce((s, op) => s + (quorumMap[op]?.[cat]?.target || 0), 0) / operatori.length)
                    : 0
                  return (
                    <td key={cat} className="px-3 py-1.5 text-center font-mono text-violet-700 font-bold">
                      {avgT > 0 ? fmt(avgT) : '—'}
                    </td>
                  )
                })}
                <td className="px-3 py-1.5 text-center text-violet-400 font-mono">—</td>
              </tr>
            </thead>
            <tbody>
              {operatori.map(op => {
                const q = quorumMap[op] || {}
                const c = currentMap[op] || {}
                // Totale: somma solo le categorie VISIBILI (top-8) per coerenza con le colonne
                const totalTarget = categorie.reduce((s, cat) => s + (q[cat]?.target || 0), 0)
                const totalCurr   = categorie.reduce((s, cat) => s + Math.round(c[cat] || 0), 0)
                const pctTotal    = totalTarget > 0 ? Math.min(200, Math.round(totalCurr / totalTarget * 100)) : 0
                const colTotal    = getColor(pctTotal)
                const varTot      = Math.round(variantiMap[op] || 0)

                return (
                  <tr key={op} className="border-b hover:bg-gray-50/50">
                    <td className="px-3 py-2.5 font-semibold text-gray-900">{op}</td>
                    <td className={`px-3 py-2.5 text-center ${getClsBg(colTotal)}`}>
                      <div className={`font-bold ${getClsText(colTotal)}`}>{pctTotal}%</div>
                      <div className="text-gray-400 text-[10px]">{fmt(totalCurr)}/{fmt(totalTarget)}</div>
                    </td>
                    {categorie.map(cat => {
                      const qData = q[cat] || { quorum: 0, target: 0 }
                      const curr  = Math.round(c[cat] || 0)
                      const pct   = qData.target > 0
                        ? Math.min(200, Math.round(curr / qData.target * 100))
                        : (curr > 0 ? 100 : -1)
                      if (pct === -1) return <td key={cat} className="px-3 py-2.5 text-center text-gray-200">—</td>
                      const col = getColor(pct)
                      return (
                        <td key={cat} className={`px-3 py-2.5 text-center ${getClsBg(col)}`}>
                          <div className={`font-bold ${getClsText(col)}`}>{Math.min(pct, 999)}%</div>
                          <div className="text-gray-400 text-[10px]">{curr}/{fmt(Math.round(qData.target))}</div>
                        </td>
                      )
                    })}
                    <td className="px-3 py-2.5 text-center text-emerald-600 font-semibold">
                      {varTot > 0 ? `+${fmt(varTot)}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Legenda ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <span className="font-medium">Legenda:</span>
        {[
          { label: '≥100% raggiunto', cls: 'bg-emerald-400' },
          { label: '75-99%',          cls: 'bg-indigo-400' },
          { label: '45-74%',          cls: 'bg-amber-400' },
          { label: '<45%',            cls: 'bg-red-400' },
        ].map(l => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded inline-block ${l.cls}`} /> {l.label}
          </span>
        ))}
      </div>

      <p className="text-xs text-gray-400 italic">
        Quorum individuale = media pezzi/mese dell'operatore nei {nMesi} {nMesi === 1 ? 'mese' : 'mesi'} precedenti {MESI[mese-1]} {anno}.
        Target individuale = Quorum × {(100 + percIncremento)}% (mostrato come denominatore in ogni cella).
        Riga «⌀ Media team» = media dei quorum individuali per categoria (solo riferimento).
        Totale = somma delle {categorie.length} categorie principali visibili.
      </p>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function PerformancePage() {
  const now     = new Date()
  const [sede,  setSede]  = useState('MA')
  const [anno,  setAnno]  = useState(now.getFullYear())
  const [mese,  setMese]  = useState(now.getMonth() + 1)
  // La tab vive nell'URL sotto il parametro `sub`, NON `tab`.
  //
  // PerformancePage è renderizzata dentro KpiHub (/kpi?tab=performance) e il
  // genitore possiede già `tab`. Scrivendo qui `?tab=obiettivi` si sovrascriveva
  // il parametro dell'hub: KpiHub non trovava più una tab valida e l'intera
  // pagina restava bianca al primo click su una tab interna.
  const [tab, handleTabChange] = useTabParam(TAB_IDS, 'venduto', 'sub')
  const [overview, setOverview] = useState(null)
  const [loading,  setLoading]  = useState(true)

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
    }).catch(() => {
      // Senza questo catch la rejection restava non gestita e l'overview
      // precedente rimaneva a schermo come se fosse del nuovo mese.
      setOverview(null)
    }).finally(() => setLoading(false))
  }, [sede, anno, mese])

  // Anni chiesti ai dati (prima: finestra cablata di 3 anni dall'orologio)
  const { anni } = useAnniDisponibili('venduto_camerieri', 'data_inizio')

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
                {s === 'MA' ? 'Sede MA' : 'Sede PN'}
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
        {tab === 'incentivi' && <TabIncentivi sede={sede} anno={anno} mese={mese} />}
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
