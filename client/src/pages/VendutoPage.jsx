/**
 * VendutoPage.jsx — Analisi venduto con calendario heatmap + BI avanzata
 */
import React, { useEffect, useState, useMemo } from 'react'
import supabase from '../supabase'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ComposedChart, Line
} from 'recharts'
import { periodToDates } from '../components/DateRangePicker'
import PeriodFilter from '../components/PeriodFilter'
import PageAssistant from '../components/PageAssistant'
import { useTabParam } from '../hooks/useTabParam'
import { TrendingUp, Users, ShoppingBag, BarChart2, Calendar, ArrowUpRight } from 'lucide-react'
import PageStatsWidget from '../components/PageStatsWidget'
import CalendarioSmart from './venduto/CalendarioSmart'

const COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ec4899','#8b5cf6','#ef4444','#14b8a6','#f97316','#06b6d4']
const MESI_IT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const GIORNI_IT = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom']

async function sbq(q) {
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

// Fix: venduto_camerieri supera le 19k righe — i vecchi .range(0,4999) troncavano i dati
// con sede "Tutti" + periodo "Anno". Qui si pagina a blocchi finché il server restituisce
// meno righe della pagina richiesta (nessun limite hardcoded).
async function sbqAll(buildQuery, pageSize = 1000) {
  const out = []
  for (let start = 0; start < 500000; start += pageSize) {
    const rows = await sbq(buildQuery().range(start, start + pageSize - 1))
    out.push(...rows)
    if (rows.length < pageSize) break
  }
  return out
}

function locationToSede(location) {
  if (!location || location === 'all') return null
  if (location === 'MAMELI')        return 'MA'
  if (location === 'PREDDA_NIEDDA') return 'PN'
  return location
}

async function loadOperatori(sede, from, to) {
  const rows = await sbqAll(() => {
    let q = supabase.from('venduto_camerieri').select('sede, operatore, quantita')
    if (sede) q = q.eq('sede', sede)
    // Overlap interval filter: il record [data_inizio, data_fine] si sovrappone con [from, to]
    if (to)   q = q.lte('data_inizio', to)
    if (from) q = q.gte('data_fine', from)
    return q.not('operatore', 'ilike', 'pienissimo')  // escludi operatore di sistema
  })
  const byOp = {}
  for (const r of rows) {
    const key = `${r.sede}|${r.operatore}`
    if (!byOp[key]) byOp[key] = { operatore: r.operatore, sede: r.sede, coperti: 0 }
    byOp[key].coperti += parseFloat(r.quantita) || 0
  }
  return Object.values(byOp)
    .map(op => ({ ...op, coperti: Math.round(op.coperti), location: op.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA' }))
    .sort((a, b) => b.coperti - a.coperti)
}

async function loadCategorie(sede, from, to) {
  const rows = await sbqAll(() => {
    let q = supabase.from('venduto_camerieri').select('categoria, quantita')
    if (sede) q = q.eq('sede', sede)
    if (to)   q = q.lte('data_inizio', to)
    if (from) q = q.gte('data_fine', from)
    q = q.not('operatore', 'ilike', 'pienissimo')
    return q.not('prodotto', 'ilike', '[STIMA]%')  // escludi stime proporzionali
  })
  const byCat = {}
  for (const r of rows) {
    const cat = r.categoria && r.categoria !== 'nan' ? r.categoria : '(senza categoria)'
    if (!byCat[cat]) byCat[cat] = { categoria: cat, tot_quantita: 0 }
    byCat[cat].tot_quantita += parseFloat(r.quantita) || 0
  }
  return Object.values(byCat).sort((a, b) => b.tot_quantita - a.tot_quantita)
    .map(c => ({ ...c, tot_quantita: Math.round(c.tot_quantita) }))
}

async function loadProdotti(sede, from, to, limit = 20) {
  const rows = await sbqAll(() => {
    let q = supabase.from('venduto_camerieri').select('prodotto, categoria, quantita, operatore')
    if (sede) q = q.eq('sede', sede)
    if (to)   q = q.lte('data_inizio', to)
    if (from) q = q.gte('data_fine', from)
    q = q.not('operatore', 'ilike', 'pienissimo')
    q = q.not('prodotto', 'ilike', '[STIMA]%')  // escludi stime
    q = q.not('prodotto', 'eq', 'TOTALE PERIODO')
    return q.not('prodotto', 'eq', 'COPERTO')
  })
  const byP = {}
  for (const r of rows) {
    if (!r.prodotto || r.prodotto === 'nan') continue
    if (!byP[r.prodotto]) byP[r.prodotto] = { prodotto: r.prodotto, categoria: r.categoria, tot_quantita: 0, operatori: new Set() }
    byP[r.prodotto].tot_quantita += parseFloat(r.quantita) || 0
    byP[r.prodotto].operatori.add(r.operatore)
  }
  return Object.values(byP).sort((a, b) => b.tot_quantita - a.tot_quantita)
    .slice(0, limit)
    .map(p => ({ ...p, tot_quantita: Math.round(p.tot_quantita), n_operatori: p.operatori.size }))
}

async function loadVarianti(sede, from, to) {
  const rows = await sbqAll(() => {
    let q = supabase.from('varianti_camerieri').select('variante, operatore, aggiunta_qty, aggiunta_importo, rimozione_qty')
    if (sede) q = q.eq('sede', sede)
    // Overlap interval filter: il record [data_inizio, data_fine] si sovrappone con [from, to]
    if (to)   q = q.lte('data_inizio', to)
    if (from) q = q.gte('data_fine', from)
    return q.not('operatore', 'ilike', 'pienissimo')  // escludi operatore di sistema
  })
  const byVar = {}
  for (const r of rows) {
    const key = `${r.variante}|${r.operatore}`
    if (!byVar[key]) byVar[key] = { variante: r.variante, operatore: r.operatore, tot_aggiunte: 0, tot_rimozioni: 0, tot_importo_aggiunta: 0 }
    byVar[key].tot_aggiunte += parseFloat(r.aggiunta_qty) || 0
    byVar[key].tot_rimozioni += parseFloat(r.rimozione_qty) || 0
    byVar[key].tot_importo_aggiunta += parseFloat(r.aggiunta_importo) || 0
  }
  return Object.values(byVar).sort((a, b) => b.tot_aggiunte - a.tot_aggiunte).slice(0, 50)
}

// ── Carica aggregati mensili per operatore (tutti i mesi, per tab Obiettivi) ─
async function loadMensileOperatori(sede) {
  const rows = await sbqAll(() => {
    let q = supabase.from('venduto_camerieri')
      .select('sede, operatore, data_inizio, quantita, totale')
      .not('operatore', 'ilike', '%pienissimo%')
    if (sede) q = q.eq('sede', sede)
    return q
  })
  const byMese = {}
  for (const r of rows) {
    if (!r.data_inizio) continue
    const [y, m] = r.data_inizio.split('-')
    const key = `${r.sede}||${r.operatore}||${y}-${m}`
    if (!byMese[key]) byMese[key] = {
      sede: r.sede, operatore: r.operatore,
      anno: parseInt(y), mese: parseInt(m),
      pezzi: 0, pezzi_valorizzati: 0
    }
    const qty = parseFloat(r.quantita) || 0
    const tot = parseFloat(r.totale) || 0
    byMese[key].pezzi += qty
    // Solo prodotti con prezzo medio > €0.01 per pezzo
    if (qty > 0 && (tot / qty) > 0.01) byMese[key].pezzi_valorizzati += qty
  }
  return Object.values(byMese)
}

// ── Carica target salvati ────────────────────────────────────────────────────
async function loadTargetSalvati(sede) {
  let q = supabase.from('target_venduto_operatori').select('*')
  if (sede) q = q.eq('sede', sede)
  const rows = await sbq(q)
  const map = {}
  for (const r of rows) {
    map[`${r.sede}||${r.operatore}||${r.anno}-${String(r.mese).padStart(2,'0')}`] = r
  }
  return map
}

// ── Salva/aggiorna target ─────────────────────────────────────────────────────
async function saveTarget(sede, operatore, anno, mese, field, value) {
  const existing = { sede, operatore, anno, mese, updated_at: new Date().toISOString() }
  existing[field] = parseFloat(value) || null
  const { error } = await supabase.from('target_venduto_operatori')
    .upsert(existing, { onConflict: 'sede,operatore,anno,mese' })
  if (error) throw error
}

// Carica fatturato valorizzato per operatore (da listino_prodotti × venduto_camerieri)
async function loadFatturatoOperatori(sede, from, to) {
  try {
    // Estrai mesi dall'intervallo per filtrare la vista per anno+mese
    let q = supabase.from('v_fatturato_operatore_mensile')
      .select('sede, anno, mese, operator, pezzi_totali, fatturato_totale, costo_materia_totale, margine_totale, margine_pct')
    if (sede) q = q.eq('sede', sede)
    if (from) {
      const [y, m] = from.split('-')
      if (y && m) q = q.or(`anno.gt.${y},and(anno.eq.${y},mese.gte.${parseInt(m)})`)
    }
    if (to) {
      const [y, m] = to.split('-')
      if (y && m) q = q.or(`anno.lt.${y},and(anno.eq.${y},mese.lte.${parseInt(m)})`)
    }
    const rows = await sbq(q)
    // Aggrega per sede + operatore
    const byOp = {}
    for (const r of rows) {
      const key = `${r.sede}|${r.operator}`
      if (!byOp[key]) byOp[key] = {
        operatore: r.operator, sede: r.sede,
        location: r.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA',
        pezzi: 0, fatturato: 0, costo: 0, margine: 0, n_mesi: 0
      }
      byOp[key].pezzi    += parseFloat(r.pezzi_totali) || 0
      byOp[key].fatturato+= parseFloat(r.fatturato_totale) || 0
      byOp[key].costo    += parseFloat(r.costo_materia_totale) || 0
      byOp[key].margine  += parseFloat(r.margine_totale) || 0
      byOp[key].n_mesi++
    }
    return Object.values(byOp).map(op => ({
      ...op,
      pezzi: Math.round(op.pezzi),
      fatturato: Math.round(op.fatturato * 100) / 100,
      costo: Math.round(op.costo * 100) / 100,
      margine: Math.round(op.margine * 100) / 100,
      margine_pct: op.fatturato > 0 ? Math.round(op.margine / op.fatturato * 1000) / 10 : 0,
      valore_medio: op.pezzi > 0 ? Math.round(op.fatturato / op.pezzi * 100) / 100 : 0,
    })).sort((a, b) => b.fatturato - a.fatturato)
  } catch { return [] }
}

async function loadDailyChiusure(sede, from, to) {
  let q = supabase.from('chiusure_giornaliere')
    .select('data, sede, totale_venduto_ipratico, coperti, coperto_medio')
  if (sede) q = q.eq('sede', sede)
  if (from) q = q.gte('data', from)
  if (to)   q = q.lte('data', to)
  q = q.order('data', { ascending: true })
  return sbq(q)
}

function eur(n) { return n != null ? `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—' }
function fmt(n) { return n != null ? Number(n).toLocaleString('it-IT') : '—' }

// ─── Previsioni giornaliere (tabella previsioni_giornaliere) ────────────────
async function loadPrevisioni(from, to) {
  let q = supabase.from('previsioni_giornaliere').select('*')
  if (from) q = q.gte('data', from)
  if (to)   q = q.lte('data', to)
  return sbq(q)
}

// ── Tab Obiettivi Team ────────────────────────────────────────────────────
function TabTarget({ sede, from, to }) {
  // Deriva il mese di riferimento dal date picker (usa `to`, fallback a oggi)
  const { refAnno, refMese } = React.useMemo(() => {
    const d = to ? new Date(to + 'T00:00:00') : new Date()
    return { refAnno: d.getFullYear(), refMese: d.getMonth() + 1 }
  }, [to])

  const [mensile, setMensile] = React.useState([])
  const [targets, setTargets] = React.useState({})
  const [loading, setLoading] = React.useState(true)
  const [viewMode, setViewMode] = React.useState('pezzi') // 'pezzi' | 'valorizzati'
  const [editKey, setEditKey] = React.useState(null) // `${sede}||${op}` being edited
  const [editVal, setEditVal] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    setLoading(true)
    Promise.all([loadMensileOperatori(sede), loadTargetSalvati(sede)])
      .then(([rows, tgt]) => { setMensile(rows); setTargets(tgt) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [sede])

  // Tutti i mesi disponibili ordinati
  const tuttiMesi = React.useMemo(() => {
    const set = new Set(mensile.map(r => `${r.anno}-${String(r.mese).padStart(2,'0')}`))
    return [...set].sort()
  }, [mensile])

  // Mesi completi (escluso mese corrente in corso)
  const mesiCompleti = React.useMemo(() =>
    tuttiMesi.filter(m => {
      const [y, mo] = m.split('-').map(Number)
      return y < refAnno || (y === refAnno && mo < refMese)
    }), [tuttiMesi, refAnno, refMese])

  const mesiMostrati = mesiCompleti.slice(-4) // ultimi 4 completi in tabella
  const mesiPerMedia = mesiCompleti.slice(-3) // ultimi 3 per calcolo media
  const meseCorrenteKey = `${refAnno}-${String(refMese).padStart(2,'0')}`

  // Matrice: { 'sede||op||anno-mese' → val }
  const matrix = React.useMemo(() => {
    const m = {}
    for (const r of mensile) {
      const k = `${r.sede}||${r.operatore}||${r.anno}-${String(r.mese).padStart(2,'0')}`
      m[k] = viewMode === 'pezzi' ? r.pezzi : r.pezzi_valorizzati
    }
    return m
  }, [mensile, viewMode])

  function getVal(s, op, meseKey) {
    return Math.round(matrix[`${s}||${op}||${meseKey}`] || 0)
  }
  function getMedia(s, op) {
    const vals = mesiPerMedia.map(m => getVal(s, op, m)).filter(v => v > 0)
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0
  }
  function getTargetKey(s, op) {
    return `${s}||${op}||${refAnno}-${String(refMese).padStart(2,'0')}`
  }
  function getTargetSaved(s, op) {
    const t = targets[getTargetKey(s, op)]
    if (!t) return null
    return viewMode === 'pezzi' ? t.target_pezzi : t.target_pezzi_valorizzati
  }
  function getTarget(s, op) {
    const saved = getTargetSaved(s, op)
    if (saved != null && parseFloat(saved) > 0) return Math.round(parseFloat(saved))
    return Math.round(getMedia(s, op) * 1.10)
  }

  async function handleSave(s, op) {
    setSaving(true)
    const field = viewMode === 'pezzi' ? 'target_pezzi' : 'target_pezzi_valorizzati'
    try {
      await saveTarget(s, op, refAnno, refMese, field, editVal)
      const newT = await loadTargetSalvati(sede)
      setTargets(newT)
    } catch(e) { console.error(e) }
    setSaving(false)
    setEditKey(null)
  }

  if (loading) return <p className="text-center text-gray-400 py-10 text-sm animate-pulse">Caricamento dati storici...</p>

  const sedi = sede ? [sede] : ['MA', 'PN']
  const mesiLabel = mesiPerMedia.map(m => { const [,mo] = m.split('-'); return MESI_IT[parseInt(mo)-1] })

  return (
    <div className="space-y-5">
      {/* Toggle pezzi / valorizzati */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2">
          <button onClick={() => setViewMode('pezzi')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'pezzi' ? 'bg-violet-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            📦 Tutti i pezzi
          </button>
          <button onClick={() => setViewMode('valorizzati')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'valorizzati' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            💰 Solo valorizzati (&gt;€0.01)
          </button>
        </div>
        <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-100">
          🎯 Target = media {mesiLabel.join('+')} × 1.10 — click ✏️ per modificare
        </div>
      </div>

      {viewMode === 'valorizzati' && (
        <MatriceCategorieMedia sede={sede} from={from} to={to} />
      )}

      {viewMode === 'pezzi' && sedi.map(s => {
        // Operatori per questa sede, ordinati per media decrescente
        const opsRaw = [...new Set(mensile.filter(r => r.sede === s).map(r => r.operatore))]
        const ops = opsRaw.sort((a, b) => getMedia(s, b) - getMedia(s, a))
        if (!ops.length) return null

        // Totali team
        const teamPerMese = mesiMostrati.map(m => ({ mese: m, val: ops.reduce((sum, op) => sum + getVal(s, op, m), 0) }))
        const teamMedia   = mesiPerMedia.length ? Math.round(ops.reduce((sum, op) => sum + getMedia(s, op), 0)) : 0
        const teamTarget  = ops.reduce((sum, op) => sum + getTarget(s, op), 0)
        const teamCorrenti= ops.reduce((sum, op) => sum + getVal(s, op, meseCorrenteKey), 0)
        const teamPct     = teamTarget > 0 ? Math.round(teamCorrenti / teamTarget * 100) : 0

        return (
          <div key={s} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            {/* Header sede */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <div className={`w-2 h-5 rounded-full ${s === 'MA' ? 'bg-indigo-500' : 'bg-green-500'}`} />
              <span className="font-semibold text-sm text-gray-800">
                {s === 'MA' ? '📍 Sede MA' : '📍 Sede PN'}
              </span>
              <span className="ml-auto text-xs text-gray-400">{ops.length} operatori</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2.5 text-left sticky left-0 bg-gray-50 min-w-[130px]">Operatore</th>
                    {mesiMostrati.map(m => {
                      const [y, mo] = m.split('-')
                      return <th key={m} className="px-3 py-2.5 text-right min-w-[72px] text-gray-400 font-normal">
                        {MESI_IT[parseInt(mo)-1]} '{y.slice(2)}
                      </th>
                    })}
                    <th className="px-3 py-2.5 text-right min-w-[80px] bg-blue-50/80 text-blue-600">Media</th>
                    <th className="px-3 py-2.5 text-right min-w-[100px] bg-violet-50/80 text-violet-700">
                      🎯 Target {MESI_IT[refMese-1]}
                    </th>
                    <th className="px-3 py-2.5 text-right min-w-[85px] bg-green-50/80 text-green-700">
                      ▶ {MESI_IT[refMese-1]} '{String(refAnno).slice(2)}
                    </th>
                    <th className="px-3 py-2.5 text-center min-w-[90px]">Progresso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {ops.map((op, idx) => {
                    const media    = getMedia(s, op)
                    const target   = getTarget(s, op)
                    const corrente = getVal(s, op, meseCorrenteKey)
                    const pct      = target > 0 ? Math.round(corrente / target * 100) : 0
                    const isEditing= editKey === `${s}||${op}`
                    const hasSaved = getTargetSaved(s, op) != null

                    return (
                      <tr key={op} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-3 py-2.5 sticky left-0 bg-white">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                              style={{ backgroundColor: COLORS[idx % COLORS.length] }}>
                              {op?.charAt(0)}
                            </div>
                            <span className="font-medium text-gray-800 text-xs">{op}</span>
                          </div>
                        </td>
                        {mesiMostrati.map(m => (
                          <td key={m} className="px-3 py-2.5 text-right text-xs text-gray-500 font-mono">
                            {getVal(s, op, m) > 0 ? getVal(s, op, m).toLocaleString('it-IT') : '—'}
                          </td>
                        ))}
                        {/* Media */}
                        <td className="px-3 py-2.5 text-right text-xs font-semibold text-blue-700 bg-blue-50/40 font-mono">
                          {media > 0 ? media.toLocaleString('it-IT') : '—'}
                        </td>
                        {/* Target editabile */}
                        <td className="px-3 py-2.5 bg-violet-50/40">
                          {isEditing ? (
                            <div className="flex items-center gap-1 justify-end">
                              <input type="number" value={editVal}
                                onChange={e => setEditVal(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSave(s, op); if (e.key === 'Escape') setEditKey(null) }}
                                className="w-20 text-right text-xs border border-violet-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
                                autoFocus />
                              <button onClick={() => handleSave(s, op)} disabled={saving}
                                className="text-violet-600 hover:text-violet-800 text-sm font-bold">✓</button>
                              <button onClick={() => setEditKey(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 justify-end group">
                              <span className={`font-mono text-xs font-semibold ${hasSaved ? 'text-violet-800' : 'text-violet-500'}`}>
                                {target > 0 ? target.toLocaleString('it-IT') : '—'}
                                {hasSaved && <span className="ml-0.5 text-[9px] text-violet-400">✓</span>}
                              </span>
                              <button
                                onClick={() => { setEditKey(`${s}||${op}`); setEditVal(target > 0 ? String(target) : '') }}
                                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-violet-500 transition-opacity ml-1 text-xs">
                                ✏️
                              </button>
                            </div>
                          )}
                        </td>
                        {/* Corrente */}
                        <td className="px-3 py-2.5 text-right text-xs font-mono font-semibold text-green-700 bg-green-50/40">
                          {corrente > 0 ? corrente.toLocaleString('it-IT') : '—'}
                        </td>
                        {/* Progresso */}
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5 justify-center">
                            <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-amber-400' : 'bg-red-400'}`}
                                style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                            <span className={`text-xs font-semibold w-8 text-right ${pct >= 100 ? 'text-green-600' : pct >= 70 ? 'text-amber-600' : 'text-red-500'}`}>
                              {corrente > 0 || target > 0 ? `${pct}%` : '—'}
                            </span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {/* Footer team */}
                <tfoot className="border-t-2 border-gray-200 bg-gray-50/80 font-semibold">
                  <tr>
                    <td className="px-3 py-2.5 text-xs text-gray-600 uppercase tracking-wide sticky left-0 bg-gray-50">🏆 Team</td>
                    {teamPerMese.map(({ mese: m, val }) => (
                      <td key={m} className="px-3 py-2.5 text-right text-xs text-gray-700 font-mono">
                        {val > 0 ? val.toLocaleString('it-IT') : '—'}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right text-xs font-bold text-blue-700 bg-blue-50/60 font-mono">
                      {teamMedia > 0 ? teamMedia.toLocaleString('it-IT') : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs font-bold text-violet-700 bg-violet-50/60 font-mono">
                      {teamTarget > 0 ? teamTarget.toLocaleString('it-IT') : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs font-bold text-green-700 bg-green-50/60 font-mono">
                      {teamCorrenti > 0 ? teamCorrenti.toLocaleString('it-IT') : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 justify-center">
                        <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${teamPct >= 100 ? 'bg-green-500' : teamPct >= 70 ? 'bg-amber-400' : 'bg-red-400'}`}
                            style={{ width: `${Math.min(teamPct, 100)}%` }} />
                        </div>
                        <span className={`text-xs font-bold w-8 text-right ${teamPct >= 100 ? 'text-green-600' : teamPct >= 70 ? 'text-amber-600' : 'text-red-500'}`}>
                          {teamCorrenti > 0 || teamTarget > 0 ? `${teamPct}%` : '—'}
                        </span>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-gray-400 px-4 py-2 border-t border-gray-50">
              Media su {mesiPerMedia.length} mesi{mesiLabel.length > 0 ? ` (${mesiLabel.join(', ')})` : ''}.
              Target suggerito = media × 1.10. I valori con ✓ sono stati personalizzati.
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ── Matrice Categorie Media (storico ultimi 3 mesi, solo valorizzati) ───────
async function loadMatriceCategorieMedia(sede, refAnno, refMese) {
  let q = supabase.from('venduto_camerieri')
    .select('sede, operatore, data_inizio, categoria, quantita, totale')
    .not('operatore', 'ilike', '%pienissimo%')
    .range(0, 19999)
  if (sede) q = q.eq('sede', sede)
  const rows = await sbq(q)

  const meseCorrenteKey = `${refAnno}-${String(refMese).padStart(2,'0')}`

  // Tutti i mesi completi disponibili
  const allMesi = new Set()
  const mesiCorrenteRows = []
  for (const r of rows) {
    if (!r.data_inizio) continue
    const [y, m] = r.data_inizio.split('-')
    const meseKey = `${y}-${m}`
    const anno = parseInt(y), mese = parseInt(m)
    if (anno < refAnno || (anno === refAnno && mese < refMese)) allMesi.add(meseKey)
    if (meseKey === meseCorrenteKey) mesiCorrenteRows.push(r)
  }
  const mesiCompleti = [...allMesi].sort().slice(-3) // ultimi 3 mesi completi
  const nMesi = mesiCompleti.length || 1

  // Aggrega pezzi E valore € per (sede, operatore, categoria) — solo prodotti valorizzati
  function buildMatrix(sourceRows, filterMesi) {
    const m    = {}   // { 'sede||op' → { cat → pezzi, _sede, _op } }
    const mVal = {}   // { 'sede||op' → { cat → valore€, _sede, _op } }
    const catTot    = {}   // { cat → pezzi }
    const catTotVal = {}   // { cat → valore€ }
    const opTot     = {}   // { 'sede||op' → pezzi }
    const opTotVal  = {}   // { 'sede||op' → valore€ }
    for (const r of sourceRows) {
      if (!r.data_inizio) continue
      const [y, mo] = r.data_inizio.split('-')
      if (filterMesi && !filterMesi.includes(`${y}-${mo}`)) continue
      const qty = parseFloat(r.quantita) || 0
      const tot = parseFloat(r.totale) || 0
      if (qty <= 0 || (tot / qty) <= 0.01) continue // solo valorizzati
      const cat = (r.categoria && r.categoria !== 'nan') ? r.categoria : 'Altro'
      const opKey = `${r.sede}||${r.operatore}`
      if (!m[opKey])    m[opKey]    = { _sede: r.sede, _op: r.operatore }
      if (!mVal[opKey]) mVal[opKey] = { _sede: r.sede, _op: r.operatore }
      m[opKey][cat]    = (m[opKey][cat]    || 0) + qty
      mVal[opKey][cat] = (mVal[opKey][cat] || 0) + tot
      catTot[cat]      = (catTot[cat]      || 0) + qty
      catTotVal[cat]   = (catTotVal[cat]   || 0) + tot
      opTot[opKey]     = (opTot[opKey]     || 0) + qty
      opTotVal[opKey]  = (opTotVal[opKey]  || 0) + tot
    }
    return { m, mVal, catTot, catTotVal, opTot, opTotVal }
  }

  const { m: mxStoR, mVal: mxStoRVal, catTot: catTotSto, catTotVal: catTotStoVal, opTot: opTotSto, opTotVal: opTotStoVal } = buildMatrix(rows, mesiCompleti)
  const { m: mxCorr, mVal: mxCorrVal, opTot: opTotCorr, opTotVal: opTotCorrVal } = buildMatrix(mesiCorrenteRows, null)

  // Dividi per nMesi → medie mensili (pezzi)
  const matrix = {}
  for (const [k, v] of Object.entries(mxStoR)) {
    matrix[k] = { _sede: v._sede, _op: v._op }
    for (const [cat, pezzi] of Object.entries(v)) {
      if (cat.startsWith('_')) { matrix[k][cat] = v[cat]; continue }
      matrix[k][cat] = Math.round(pezzi / nMesi)
    }
  }
  // Medie mensili (valore €)
  const matrixVal = {}
  for (const [k, v] of Object.entries(mxStoRVal)) {
    matrixVal[k] = { _sede: v._sede, _op: v._op }
    for (const [cat, val] of Object.entries(v)) {
      if (cat.startsWith('_')) { matrixVal[k][cat] = v[cat]; continue }
      matrixVal[k][cat] = Math.round(val / nMesi * 100) / 100
    }
  }
  const catMedia = {}
  for (const [cat, tot] of Object.entries(catTotSto)) catMedia[cat] = Math.round(tot / nMesi)
  const catMediaVal = {}
  for (const [cat, tot] of Object.entries(catTotStoVal)) catMediaVal[cat] = Math.round(tot / nMesi * 100) / 100
  const opMedia  = {}
  for (const [k, tot] of Object.entries(opTotSto)) opMedia[k] = Math.round(tot / nMesi)
  const opMediaVal = {}
  for (const [k, tot] of Object.entries(opTotStoVal)) opMediaVal[k] = Math.round(tot / nMesi * 100) / 100
  const opCorr   = {}
  for (const [k, tot] of Object.entries(opTotCorr)) opCorr[k] = Math.round(tot)
  const opCorrVal = {}
  for (const [k, tot] of Object.entries(opTotCorrVal)) opCorrVal[k] = Math.round(tot * 100) / 100

  // Top 10 categorie per media valore € (ordinate per fatturato)
  const topCats = Object.entries(catMediaVal).sort((a,b) => b[1]-a[1]).slice(0,10).map(([c])=>c)
  const ops = Object.keys(opMedia).sort((a,b) => (opMediaVal[b]||0)-(opMediaVal[a]||0))

  return { matrix, matrixVal, topCats, ops, catMedia, catMediaVal, opMedia, opMediaVal, opCorr, opCorrVal, mesiCompleti, nMesi }
}

function MatriceCategorieMedia({ sede, from, to }) {
  const { refAnno, refMese } = React.useMemo(() => {
    const d = to ? new Date(to + 'T00:00:00') : new Date()
    return { refAnno: d.getFullYear(), refMese: d.getMonth() + 1 }
  }, [to])

  const [data, setData] = React.useState(null)
  const [targets, setTargets] = React.useState({})
  const [loading, setLoading] = React.useState(true)
  const [editKey, setEditKey] = React.useState(null)
  const [editVal, setEditVal] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [viewMode, setViewMode] = React.useState('pezzi') // 'pezzi' | 'euro'

  React.useEffect(() => {
    setLoading(true)
    Promise.all([loadMatriceCategorieMedia(sede, refAnno, refMese), loadTargetSalvati(sede)])
      .then(([d, t]) => { setData(d); setTargets(t) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [sede, refAnno, refMese])

  if (loading) return <p className="text-center text-gray-400 py-10 text-sm animate-pulse">Calcolo medie storiche...</p>
  if (!data || !data.ops.length) return <p className="text-center text-gray-400 py-10 text-sm">Nessun dato disponibile</p>

  const { matrix, matrixVal, topCats, ops, catMedia, catMediaVal, opMedia, opMediaVal, opCorr, opCorrVal, mesiCompleti, nMesi } = data
  const isEuro = viewMode === 'euro'
  const activeMatrix   = isEuro ? matrixVal  : matrix
  const activeOpMedia  = isEuro ? opMediaVal : opMedia
  const activeCatMedia = isEuro ? catMediaVal: catMedia
  const activeOpCorr   = isEuro ? opCorrVal  : opCorr
  const grandMediaTeam = Object.values(activeOpMedia).reduce((s,v)=>s+v,0)
  const grandCorr      = Object.values(activeOpCorr).reduce((s,v)=>s+v,0)
  function fmtVal(v) { return isEuro ? (v > 0 ? `€${v.toLocaleString('it-IT',{maximumFractionDigits:0})}` : '—') : (v > 0 ? v.toLocaleString('it-IT') : '—') }

  const mesiLabel = mesiCompleti.map(m => { const [,mo] = m.split('-'); return MESI_IT[parseInt(mo)-1] })

  // Colori heatmap (basato sul max per categoria del modo attivo)
  const catMax = {}
  for (const cat of topCats) {
    catMax[cat] = Math.max(...ops.map(k => activeMatrix[k]?.[cat] || 0), 1)
  }
  function getCellBg(val, cat) {
    if (!val) return 'bg-gray-50 text-gray-300'
    const ratio = val / (catMax[cat] || 1)
    if (ratio > 0.75) return 'bg-indigo-600 text-white'
    if (ratio > 0.5)  return 'bg-indigo-400 text-white'
    if (ratio > 0.25) return 'bg-indigo-200 text-indigo-800'
    return 'bg-indigo-50 text-indigo-600'
  }

  function getTargetKey(opKey) {
    const { _sede: s, _op: op } = matrix[opKey] || {}
    return `${s}||${op}||${refAnno}-${String(refMese).padStart(2,'0')}`
  }
  function getTargetSaved(opKey) {
    const t = targets[getTargetKey(opKey)]
    return t?.target_pezzi_valorizzati ? Math.round(parseFloat(t.target_pezzi_valorizzati)) : null
  }
  function getTarget(opKey) {
    const saved = getTargetSaved(opKey)
    if (saved) return isEuro ? Math.round(saved * (opMediaVal[opKey] || 0) / Math.max(opMedia[opKey] || 1, 1)) : saved
    const base = isEuro ? (opMediaVal[opKey] || 0) : (opMedia[opKey] || 0)
    return isEuro ? Math.round(base * 1.10 * 100) / 100 : Math.round(base * 1.10)
  }
  async function handleSave(opKey) {
    setSaving(true)
    const { _sede: s, _op: op } = matrix[opKey] || {}
    try {
      await saveTarget(s, op, refAnno, refMese, 'target_pezzi_valorizzati', editVal)
      const t = await loadTargetSalvati(sede)
      setTargets(t)
    } catch(e) { console.error(e) }
    setSaving(false); setEditKey(null)
  }

  return (
    <div className="space-y-4">
      {/* Header con toggle pezzi/€ */}
      <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
        <span className="font-medium">
          Media mensile per operatore × categoria — ultimi {nMesi} mesi ({mesiLabel.join(', ')})
        </span>
        {/* Toggle Pezzi / Valore € */}
        <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
          <button
            onClick={() => setViewMode('pezzi')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode==='pezzi' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >📦 Pezzi</button>
          <button
            onClick={() => setViewMode('euro')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode==='euro' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >💶 Valore €</button>
        </div>
        <span className="flex items-center gap-1">
          {['bg-indigo-50','bg-indigo-200','bg-indigo-400','bg-indigo-600'].map((cls,i) => (
            <span key={i} className={`w-4 h-4 rounded inline-block ${cls}`}/>
          ))}
          <span>basso → alto</span>
        </span>
        <span className="text-gray-400 ml-2">Target = media × 1.10 (✏️ modificabile)</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-2.5 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 z-10 min-w-[130px]">Operatore</th>
              <th className="px-3 py-2.5 text-right font-semibold text-blue-600 bg-blue-50/60 min-w-[72px]">Media/mese</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-400 min-w-[55px]">% Team</th>
              {topCats.map(cat => (
                <th key={cat} className="px-2 py-2.5 text-center font-semibold text-gray-600 min-w-[90px] max-w-[120px]">
                  <div className="truncate" title={cat}>{cat}</div>
                </th>
              ))}
              <th className="px-3 py-2.5 text-right font-semibold text-violet-700 bg-violet-50/60 min-w-[100px]">
                🎯 Target {MESI_IT[refMese-1]}
              </th>
              <th className="px-3 py-2.5 text-right font-semibold text-green-700 bg-green-50/60 min-w-[80px]">
                ▶ {MESI_IT[refMese-1]}
              </th>
              <th className="px-3 py-2.5 text-center font-semibold text-gray-500 min-w-[80px]">%</th>
            </tr>
          </thead>
          <tbody>
            {ops.map(opKey => {
              const media   = activeOpMedia[opKey] || 0
              const target  = getTarget(opKey)
              const corrente= activeOpCorr[opKey] || 0
              const pct     = target > 0 ? Math.round(corrente/target*100) : 0
              const pctTeam = grandMediaTeam > 0 ? (media/grandMediaTeam*100).toFixed(1) : '0'
              const hasSaved= getTargetSaved(opKey) != null
              const isEdit  = editKey === opKey
              const { _op: opName } = matrix[opKey] || {}
              const opIdx = ops.indexOf(opKey)

              return (
                <tr key={opKey} className="border-b hover:bg-gray-50/50 transition-colors">
                  <td className="px-3 py-2.5 font-semibold text-gray-900 sticky left-0 bg-white">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                        style={{ backgroundColor: COLORS[opIdx % COLORS.length] }}>
                        {opName?.charAt(0)}
                      </div>
                      {opName}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold text-blue-700 bg-blue-50/40">
                    {fmtVal(media)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-400">{pctTeam}%</td>
                  {topCats.map(cat => {
                    const val = activeMatrix[opKey]?.[cat] || 0
                    const catPct = media > 0 && val > 0 ? Math.round(val/media*100) : 0
                    return (
                      <td key={cat} className={`px-2 py-2.5 text-center ${getCellBg(val, cat)}`}>
                        {val > 0 ? (
                          <div>
                            <div className="font-bold">{fmtVal(val)}</div>
                            <div className="text-[10px] opacity-75">{catPct}%</div>
                          </div>
                        ) : '—'}
                      </td>
                    )
                  })}
                  {/* Target editabile */}
                  <td className="px-3 py-2.5 bg-violet-50/40">
                    {isEdit ? (
                      <div className="flex items-center gap-1 justify-end">
                        <input type="number" value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          onKeyDown={e => { if (e.key==='Enter') handleSave(opKey); if (e.key==='Escape') setEditKey(null) }}
                          className="w-20 text-right text-xs border border-violet-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
                          autoFocus />
                        <button onClick={() => handleSave(opKey)} disabled={saving}
                          className="text-violet-600 hover:text-violet-800 font-bold">✓</button>
                        <button onClick={() => setEditKey(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 justify-end group">
                        <span className={`font-mono font-semibold ${hasSaved ? 'text-violet-800' : 'text-violet-500'}`}>
                          {target > 0 ? target.toLocaleString('it-IT') : '—'}
                          {hasSaved && <span className="ml-0.5 text-[9px] text-violet-400">✓</span>}
                        </span>
                        <button
                          onClick={() => { setEditKey(opKey); setEditVal(target > 0 ? String(target) : '') }}
                          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-violet-500 transition-opacity ml-1">
                          ✏️
                        </button>
                      </div>
                    )}
                  </td>
                  {/* Corrente */}
                  <td className="px-3 py-2.5 text-right font-mono font-semibold text-green-700 bg-green-50/40">
                    {corrente > 0 ? corrente.toLocaleString('it-IT') : '—'}
                  </td>
                  {/* % progresso */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1 justify-center">
                      <div className="w-10 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct>=100?'bg-green-500':pct>=70?'bg-amber-400':'bg-red-400'}`}
                          style={{ width: `${Math.min(pct,100)}%` }}/>
                      </div>
                      <span className={`text-xs font-semibold w-8 text-right ${pct>=100?'text-green-600':pct>=70?'text-amber-600':'text-red-500'}`}>
                        {(corrente > 0 || target > 0) ? `${pct}%` : '—'}
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
            <tr>
              <td className="px-3 py-2.5 text-gray-700 uppercase text-[11px] sticky left-0 bg-gray-50">Totale Team</td>
              <td className="px-3 py-2.5 text-right font-mono text-blue-700 bg-blue-50/40">
                {fmtVal(grandMediaTeam)}
              </td>
              <td className="px-3 py-2.5 text-right text-gray-500">100%</td>
              {topCats.map(cat => {
                const catAvg = activeCatMedia[cat] || 0
                const catPct = grandMediaTeam > 0 ? (catAvg/grandMediaTeam*100).toFixed(1) : '0'
                return (
                  <td key={cat} className="px-2 py-2.5 text-center text-indigo-700">
                    <div className="font-bold">{fmtVal(catAvg)}</div>
                    <div className="text-[10px] text-gray-500">{catPct}%</div>
                  </td>
                )
              })}
              <td className="px-3 py-2.5 text-right font-mono text-violet-700 bg-violet-50/40">
                {fmtVal(ops.reduce((s,k) => s+getTarget(k), 0))}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-green-700 bg-green-50/40">
                {fmtVal(grandCorr)}
              </td>
              <td className="px-3 py-2.5">
                {(() => {
                  const teamTarget = ops.reduce((s,k) => s+getTarget(k), 0)
                  const pct = teamTarget > 0 ? Math.round(grandCorr/teamTarget*100) : 0
                  return (
                    <div className="flex items-center gap-1 justify-center">
                      <div className="w-10 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct>=100?'bg-green-500':pct>=70?'bg-amber-400':'bg-red-400'}`}
                          style={{ width: `${Math.min(pct,100)}%` }}/>
                      </div>
                      <span className={`text-xs font-bold w-8 text-right ${pct>=100?'text-green-600':pct>=70?'text-amber-600':'text-red-500'}`}>
                        {pct}%
                      </span>
                    </div>
                  )
                })()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-gray-400">
        Solo prodotti con valore &gt;€0.01/pezzo (esclude omaggi). Fonte: Pienissimo iPratico. Media su {nMesi} mes{nMesi === 1 ? 'e' : 'i'}{mesiLabel.length ? ` (${mesiLabel.join(', ')})` : ''}.
      </p>
    </div>
  )
}

// ── Matrice Operatori × Categorie ─────────────────────────────────────────
async function loadMatriceCategorie(sede, from, to) {
  const rows = await sbqAll(() => {
    let q = supabase.from('venduto_camerieri')
      .select('operatore, categoria, quantita')
    if (sede) q = q.eq('sede', sede)
    if (to)   q = q.lte('data_inizio', to)
    if (from) q = q.gte('data_fine', from)
    return q.not('operatore', 'ilike', '%pienissimo%')
  })

  // Aggrega per operatore + categoria
  const matrix = {}   // { op: { cat: qty } }
  const catTotals = {} // { cat: qty }
  const opTotals  = {} // { op: qty }

  for (const r of rows) {
    if (!r.operatore || r.operatore.toLowerCase() === 'pienissimo') continue
    const cat = (!r.categoria || r.categoria === 'nan') ? 'Altro' : r.categoria
    const qty = parseFloat(r.quantita) || 0
    if (!matrix[r.operatore])  matrix[r.operatore] = {}
    matrix[r.operatore][cat] = (matrix[r.operatore][cat] || 0) + qty
    catTotals[cat] = (catTotals[cat] || 0) + qty
    opTotals[r.operatore] = (opTotals[r.operatore] || 0) + qty
  }

  // Top 10 categorie per totale
  const topCats = Object.entries(catTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([cat]) => cat)

  // Operatori ordinati per totale
  const ops = Object.entries(opTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([op]) => op)

  return { matrix, topCats, ops, catTotals, opTotals }
}

function MatriceCategorie({ sede, from, to }) {
  const [data, setData] = React.useState(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    setLoading(true)
    loadMatriceCategorie(sede, from, to)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [sede, from, to])

  if (loading) return <p className="text-center text-gray-400 py-10 text-sm animate-pulse">Caricamento matrice...</p>
  if (!data || data.ops.length === 0) return <p className="text-center text-gray-400 py-10 text-sm">Nessun dato nel periodo</p>

  const { matrix, topCats, ops, catTotals, opTotals } = data
  const grandTotal = Object.values(opTotals).reduce((s, v) => s + v, 0)

  // Valore massimo per heatmap
  const allVals = ops.flatMap(op => topCats.map(cat => matrix[op]?.[cat] || 0))
  const maxVal  = Math.max(...allVals, 1)

  function getCellBg(qty) {
    if (!qty) return 'bg-gray-50 text-gray-300'
    const ratio = qty / maxVal
    if (ratio > 0.75) return 'bg-indigo-600 text-white'
    if (ratio > 0.5)  return 'bg-indigo-400 text-white'
    if (ratio > 0.25) return 'bg-indigo-200 text-indigo-800'
    return 'bg-indigo-50 text-indigo-600'
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
        <span className="font-medium">Heatmap intensità pezzi venduti per operatore × categoria</span>
        <span className="flex items-center gap-1">
          {['bg-indigo-50','bg-indigo-200','bg-indigo-400','bg-indigo-600'].map((cls, i) => (
            <span key={i} className={`w-4 h-4 rounded inline-block ${cls}`} />
          ))}
          <span>basso → alto</span>
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-2.5 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 z-10 min-w-[130px]">Operatore</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-700 min-w-[70px]">Totale</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500 min-w-[60px]">% Team</th>
              {topCats.map(cat => (
                <th key={cat} className="px-3 py-2.5 text-center font-semibold text-gray-600 min-w-[90px] max-w-[120px]">
                  <div className="truncate" title={cat}>{cat}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ops.map(op => {
              const opTotal = Math.round(opTotals[op] || 0)
              const opPct   = grandTotal > 0 ? (opTotal / grandTotal * 100).toFixed(1) : '0'
              return (
                <tr key={op} className="border-b hover:bg-gray-50/50">
                  <td className="px-3 py-2.5 font-semibold text-gray-900 sticky left-0 bg-white">{op}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold text-gray-800">{fmt(opTotal)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-gray-500">{opPct}%</td>
                  {topCats.map(cat => {
                    const qty = Math.round(matrix[op]?.[cat] || 0)
                    const catPct = opTotal > 0 && qty > 0 ? Math.round(qty / opTotal * 100) : 0
                    return (
                      <td key={cat} className={`px-2 py-2.5 text-center ${getCellBg(qty)}`}>
                        {qty > 0 ? (
                          <div>
                            <div className="font-bold">{fmt(qty)}</div>
                            <div className="text-[10px] opacity-75">{catPct}%</div>
                          </div>
                        ) : '—'}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
            <tr>
              <td className="px-3 py-2.5 text-gray-700 uppercase text-[11px]">Totale Team</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-900">{fmt(Math.round(grandTotal))}</td>
              <td className="px-3 py-2.5 text-right text-gray-500">100%</td>
              {topCats.map(cat => {
                const catTotal = Math.round(catTotals[cat] || 0)
                const catPct   = grandTotal > 0 ? (catTotal / grandTotal * 100).toFixed(1) : '0'
                return (
                  <td key={cat} className="px-2 py-2.5 text-center text-indigo-700">
                    <div className="font-bold">{fmt(catTotal)}</div>
                    <div className="text-[10px] text-gray-500">{catPct}%</div>
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-gray-400">
        Visualizzate le top {topCats.length} categorie per volume. Fonte: Pienissimo iPratico.
      </p>
    </div>
  )
}

// Fix: rimossi i componenti morti PrevisioneSettimana e CalendarioHeatmap
// (mai renderizzati, sostituiti da CalendarioSmart).

// Id delle tab, allineati all'array `tabs` costruito dentro il componente.
// Vivono qui fuori perché servono all'hook di deep link prima del render.
const VENDUTO_TAB_IDS = ['obiettivi', 'operatori', 'matrice', 'categorie', 'prodotti', 'upsell', 'calendario']

export default function VendutoPage() {
  const [location, setLocation] = useState('all')
  const [operatori, setOperatori] = useState([])
  const [fatturatoOp, setFatturatoOp] = useState([])
  const [categorie, setCategorie] = useState([])
  const [prodotti, setProdotti] = useState([])
  const [varianti, setVarianti] = useState([])
  const [dailyData, setDailyData] = useState([])
  const [previsioni, setPrevisioni] = useState([])
  const [prevReload, setPrevReload] = useState(0)
  const [selOp, setSelOp] = useState(null)
  // Deep link: /venduto?tab=obiettivi|operatori|matrice|categorie|prodotti|upsell|calendario
  const [tab, setTab] = useTabParam(VENDUTO_TAB_IDS, 'obiettivi')
  const [period, setPeriod] = useState('month')
  const [dates, setDates] = useState(periodToDates('month'))
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
    return () => clearTimeout(t)
  }, [tab])

  const sede = locationToSede(location)
  const from = dates?.from
  const to   = dates?.to

  const handleDateChange = (pid, d) => {
    setPeriod(pid)
    if (d) setDates(d)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      loadOperatori(sede, from, to),
      loadFatturatoOperatori(sede, from, to),
      loadCategorie(sede, from, to),
      loadProdotti(sede, from, to, 20),
      loadVarianti(sede, from, to),
      loadDailyChiusure(sede, from, to),
      loadPrevisioni(from, to).catch(() => []),
    ]).then(([op, fatOp, cat, prod, var_, daily, prev]) => {
      if (cancelled) return
      setOperatori(op)
      setFatturatoOp(fatOp)
      setCategorie(cat); setProdotti(prod); setVarianti(var_)
      setDailyData(daily)
      setPrevisioni(sede ? prev.filter(p => p.sede === sede) : prev)
      setSelOp(null)
    }).catch(e => { if (!cancelled) console.error(e) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [location, from, to, prevReload])

  // Merge pezzi (venduto_camerieri) con fatturato (v_fatturato_operatore_mensile)
  const operatoriEnhanced = useMemo(() => {
    const fatMap = {}
    for (const f of fatturatoOp) fatMap[`${f.sede}|${f.operatore}`] = f
    return operatori.map(op => {
      const fat = fatMap[`${op.sede}|${op.operatore}`] || {}
      return { ...op, fatturato: fat.fatturato || 0, margine_pct: fat.margine_pct || 0, valore_medio: fat.valore_medio || 0 }
    }).sort((a, b) => (b.fatturato || b.coperti) - (a.fatturato || a.coperti))
  }, [operatori, fatturatoOp])

  const filteredVarianti = selOp ? varianti.filter(v => v.operatore === selOp) : varianti
  const totQtaCategorie = categorie.reduce((s, c) => s + (c.tot_quantita || 0), 0)
  const totPezzi = operatori.reduce((s, op) => s + (op.coperti || 0), 0)
  const totFatturato = fatturatoOp.reduce((s, op) => s + (op.fatturato || 0), 0)

  // Dati separati per sede per la vista "all"
  const opMA = operatoriEnhanced.filter(op => op.sede === 'MA')
  const opPN = operatoriEnhanced.filter(op => op.sede === 'PN')
  const fatMA = fatturatoOp.filter(op => op.sede === 'MA').reduce((s, op) => s + op.fatturato, 0)
  const fatPN = fatturatoOp.filter(op => op.sede === 'PN').reduce((s, op) => s + op.fatturato, 0)

  const tabs = [
    { id: 'obiettivi', label: '🎯 Obiettivi Team' },
    { id: 'operatori', label: '👤 Operatori' },
    { id: 'matrice',   label: '📊 Matrice Categorie' },
    { id: 'categorie', label: '🏷️ Categorie' },
    { id: 'prodotti',  label: '🍽️ Top Prodotti' },
    { id: 'upsell',    label: '⬆️ Up-sell & Varianti' },
    { id: 'calendario',label: '📅 Calendario' },
  ]

  // Componente tabella operatori riusabile
  function OperatoriTable({ ops, totale, color = '#6366f1', title }) {
    const totPezziLoc = ops.reduce((s, op) => s + (op.coperti || 0), 0)
    const totFatLoc = ops.reduce((s, op) => s + (op.fatturato || 0), 0)
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {title && (
          <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
            <div className="w-2 h-5 rounded-full" style={{ backgroundColor: color }} />
            <span className="font-semibold text-sm text-gray-800">{title}</span>
            <span className="ml-auto text-xs text-gray-400">{ops.length} operatori · {totPezziLoc.toLocaleString('it-IT')} pezzi
              {totFatLoc > 0 ? ` · €${(totFatLoc/1000).toFixed(1)}k fatturato` : ''}
            </span>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left w-6">#</th>
                <th className="px-3 py-2 text-left">Operatore</th>
                <th className="px-3 py-2 text-right">Pezzi</th>
                {totFatLoc > 0 && <th className="px-3 py-2 text-right">Fatturato€</th>}
                {totFatLoc > 0 && <th className="px-3 py-2 text-right">Margine%</th>}
                <th className="px-3 py-2 text-right">Quota</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ops.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400 text-xs">Nessun dato nel periodo</td></tr>
              )}
              {ops.map((op, i) => {
                const quotaPct = totPezziLoc > 0 ? (op.coperti / totPezziLoc * 100) : 0
                const fatQuota = totFatLoc > 0 ? (op.fatturato / totFatLoc * 100) : 0
                const isTop = i === 0
                return (
                  <tr key={i}
                    className={`hover:bg-gray-50 cursor-pointer transition-colors ${op.operatore === selOp ? 'bg-violet-50' : ''} ${isTop ? 'font-medium' : ''}`}
                    onClick={() => { setSelOp(op.operatore === selOp ? null : op.operatore); setTab('upsell') }}>
                    <td className="px-3 py-2.5 text-gray-400 text-xs">{i < 3 ? ['🥇','🥈','🥉'][i] : i + 1}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: COLORS[i % COLORS.length] }}>
                          {op.operatore?.charAt(0)}
                        </div>
                        <span className="font-medium text-gray-800 text-xs">{op.operatore}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs">{(op.coperti || 0).toLocaleString('it-IT')}</td>
                    {totFatLoc > 0 && (
                      <td className="px-3 py-2.5 text-right text-xs font-semibold" style={{ color }}>
                        €{(op.fatturato || 0).toLocaleString('it-IT', { maximumFractionDigits: 0 })}
                      </td>
                    )}
                    {totFatLoc > 0 && (
                      <td className="px-3 py-2.5 text-right text-xs text-green-600">{op.margine_pct || '—'}%</td>
                    )}
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center gap-1.5 justify-end">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${totFatLoc > 0 ? fatQuota : quotaPct}%`, backgroundColor: color }} />
                        </div>
                        <span className="text-xs text-gray-400">{(totFatLoc > 0 ? fatQuota : quotaPct).toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <>
    <PageStatsWidget />
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Analisi Venduto</h1>
          <p className="text-sm text-gray-500 mt-0.5">Dettaglio per operatore, categoria e prodotto — fonte Pienissimo</p>
        </div>
        <div className="flex gap-2">
          {['all','MAMELI','PREDDA_NIEDDA'].map(l => (
            <button key={l} onClick={() => setLocation(l)}
              className={`btn text-xs ${location === l ? 'btn-primary' : 'btn-secondary'}`}>
              {l === 'all' ? 'Tutti' : l === 'MAMELI' ? 'Sede MA' : 'Sede PN'}
            </button>
          ))}
        </div>
      </div>

      {/* Filtro periodo condiviso */}
      <PeriodFilter period={period} dates={dates} onChange={handleDateChange}
        extra={loading ? <span className="text-xs text-gray-400 animate-pulse pb-2">Caricamento...</span> : null} />

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Pezzi totali</p>
            <ShoppingBag size={14} className="text-violet-400" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{fmt(totPezzi)}</p>
          <p className="text-xs text-gray-400 mt-1">{operatori.length} operatori attivi</p>
        </div>
        {totFatturato > 0 ? (
          <div className="bg-white rounded-xl border border-indigo-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Fatturato stimato</p>
              <TrendingUp size={14} className="text-indigo-400" />
            </div>
            <p className="text-2xl font-bold text-indigo-700">€{(totFatturato/1000).toFixed(1)}k</p>
            <p className="text-xs text-gray-400 mt-1">valorizzato da listino prezzi</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">MA vs PN</p>
              <BarChart2 size={14} className="text-blue-400" />
            </div>
            <p className="text-sm font-bold text-blue-600">MA: {opMA.length} op</p>
            <p className="text-sm font-bold text-green-600">PN: {opPN.length} op</p>
          </div>
        )}
        {totFatturato > 0 && location === 'all' && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Sede MA</p>
              <span className="w-2 h-2 rounded-full bg-indigo-500" />
            </div>
            <p className="text-xl font-bold text-indigo-700">€{(fatMA/1000).toFixed(1)}k</p>
            <p className="text-xs text-gray-400">{opMA.length} operatori · {opMA.reduce((s,o) => s+o.coperti, 0).toLocaleString('it-IT')} pezzi</p>
          </div>
        )}
        {totFatturato > 0 && location === 'all' && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Sede PN</p>
              <span className="w-2 h-2 rounded-full bg-green-500" />
            </div>
            <p className="text-xl font-bold text-green-700">€{(fatPN/1000).toFixed(1)}k</p>
            <p className="text-xs text-gray-400">{opPN.length} operatori · {opPN.reduce((s,o) => s+o.coperti, 0).toLocaleString('it-IT')} pezzi</p>
          </div>
        )}
        {(totFatturato === 0 || location !== 'all') && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Categorie</p>
              <span className="text-gray-400 text-xs">{categorie.length}</span>
            </div>
            <p className="text-xl font-bold text-gray-900">{categorie[0]?.categoria || '—'}</p>
            <p className="text-xs text-gray-400">top categoria per pezzi</p>
          </div>
        )}
        {(totFatturato === 0 || location !== 'all') && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Top Prodotto</p>
              <span className="text-gray-400 text-xs">{prodotti.length} dist.</span>
            </div>
            <p className="text-sm font-bold text-gray-900 truncate">{prodotti[0]?.prodotto || '—'}</p>
            <p className="text-xs text-gray-400">{prodotti[0] ? fmt(prodotti[0].tot_quantita) + ' pezzi' : ''}</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id ? 'border-violet-500 text-violet-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── OBIETTIVI TEAM ───────────────────────────────────── */}
      {tab === 'obiettivi' && (
        <div className="space-y-4">
          <div className="bg-violet-50 border border-violet-100 rounded-lg px-4 py-2.5 text-xs text-violet-700">
            🎯 <strong>Obiettivi Team</strong> — media pezzi venduti negli ultimi 3 mesi per ogni operatore, con target +10%.
            Il target è modificabile direttamente: passa con il mouse sopra un valore e clicca ✏️.
          </div>
          <TabTarget sede={sede} from={from} to={to} />
        </div>
      )}

      {/* ─── OPERATORI ─────────────────────────────────────────── */}
      {tab === 'operatori' && (
        <div className="space-y-4">
          {loading && <p className="text-xs text-gray-400 text-center py-4 animate-pulse">Caricamento operatori...</p>}
          {!loading && operatoriEnhanced.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Users size={32} className="mx-auto mb-2 opacity-30" />
              <p>Nessun dato per il periodo selezionato</p>
            </div>
          )}
          {/* Quando "all": due colonne MA | PN separate */}
          {!loading && operatoriEnhanced.length > 0 && location === 'all' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <OperatoriTable ops={opMA} title="Sede MA" color="#6366f1" />
              <OperatoriTable ops={opPN} title="Sede PN" color="#10b981" />
            </div>
          )}
          {/* Quando sede specifica: lista singola con chart */}
          {!loading && operatoriEnhanced.length > 0 && location !== 'all' && (
            <div className="space-y-4">
              {/* Chart fatturato o pezzi */}
              {operatoriEnhanced.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <p className="text-xs font-semibold text-gray-600 mb-3">
                    {fatturatoOp.length > 0 ? 'Fatturato per operatore' : 'Pezzi venduti per operatore'}
                    <span className="text-gray-400 font-normal ml-2">(clicca per filtrare up-sell)</span>
                  </p>
                  <ResponsiveContainer width="100%" height={Math.max(200, operatoriEnhanced.length * 36)}>
                    <BarChart data={operatoriEnhanced} layout="vertical" margin={{ left: 4, right: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                      <XAxis type="number" tick={{ fontSize: 10 }}
                        tickFormatter={v => fatturatoOp.length > 0 ? `€${(Number(v ?? 0)/1000).toFixed(0)}k` : Number(v ?? 0).toLocaleString()} />
                      <YAxis type="category" dataKey="operatore" tick={{ fontSize: 11 }} width={100} />
                      <Tooltip formatter={(v) => fatturatoOp.length > 0 ? [`€${v.toLocaleString('it-IT')}`, 'Fatturato'] : [v.toLocaleString('it-IT'), 'Pezzi']} />
                      <Bar dataKey={fatturatoOp.length > 0 ? 'fatturato' : 'coperti'} radius={[0,3,3,0]}
                        onClick={d => { setSelOp(d.operatore === selOp ? null : d.operatore); setTab('upsell') }}>
                        {operatoriEnhanced.map((op, i) => (
                          <Cell key={i}
                            fill={op.operatore === selOp ? '#7c3aed' : COLORS[i % COLORS.length]}
                            opacity={selOp && op.operatore !== selOp ? 0.4 : 1} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <OperatoriTable ops={operatoriEnhanced} color={location === 'MAMELI' ? '#6366f1' : '#10b981'} /></div>
          )}
          {/* Nota valorizzazione */}
          {fatturatoOp.length > 0 && (
            <p className="text-xs text-gray-400 text-center">
              💡 Il fatturato è valorizzato dai prezzi di vendita in Listino Prodotti
            </p>
          )}
          {fatturatoOp.length === 0 && !loading && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-700">
              Il fatturato per operatore non è disponibile perché mancano i prezzi in Listino Prodotti.
              Importa il listino per vedere i valori monetari.
            </div>
          )}

        </div>
      )}

      {/* ─── MATRICE CATEGORIE ────────────────────────────────── */}
      {tab === 'matrice' && (
        <div className="space-y-4">
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-xs text-indigo-700">
            📊 <strong>Matrice Categorie</strong> — pezzi venduti per ogni cameriere divisi per categoria.
            Le celle sono colorate in base all'intensità: più scuro = più pezzi venduti.
          </div>
          <MatriceCategorie sede={sede} from={from} to={to} />
        </div>
      )}

      {/* ─── CATEGORIE ─────────────────────────────────────────── */}
      {tab === 'categorie' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="font-semibold">Categorie — Distribuzione pezzi</h2>
            </div>
            <div className="card-body">
              {categorie.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Nessun dato</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={categorie.filter(c => c.categoria && c.categoria !== '(senza categoria)').slice(0,12)}
                    layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => Number(v ?? 0).toLocaleString('it-IT')} />
                    <YAxis type="category" dataKey="categoria" width={110} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={v => [`${Number(v ?? 0).toLocaleString('it-IT')} pz`, 'Pezzi']} />
                    <Bar dataKey="tot_quantita" radius={[0, 4, 4, 0]}>
                      {categorie.slice(0,12).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h2 className="font-semibold">Categorie — Dettaglio pezzi</h2></div>
            <div className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2">Categoria</th>
                    <th className="text-right px-4 py-2">Pezzi</th>
                    <th className="text-right px-4 py-2">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {categorie.length === 0 && (
                    <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">Nessun dato</td></tr>
                  )}
                  {categorie.map((c, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        {c.categoria || '(nessuna)'}
                      </td>
                      <td className="px-4 py-2 text-right font-medium">{(c.tot_quantita || 0).toLocaleString('it-IT')}</td>
                      <td className="px-4 py-2 text-right text-gray-500">
                        {totQtaCategorie > 0 ? ((c.tot_quantita / totQtaCategorie) * 100).toFixed(1) + '%' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── TOP PRODOTTI ──────────────────────────────────────── */}
      {tab === 'prodotti' && (
        <div className="space-y-4">
          {/* Grafico orizzontale Top 15 */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Top 15 Prodotti per pezzi venduti</h2>
                <p className="text-xs text-gray-400 mt-0.5">Esclusi prodotti di sistema e stime</p>
              </div>
            </div>
            <div className="card-body">
              {prodotti.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Nessun dato per il periodo selezionato</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(300, prodotti.slice(0,15).length * 28 + 60)}>
                  <BarChart data={prodotti.slice(0,15)} layout="vertical"
                    margin={{ left: 8, right: 60, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => Number(v ?? 0).toLocaleString('it-IT')} />
                    <YAxis type="category" dataKey="prodotto" width={180} tick={{ fontSize: 10 }}
                      tickFormatter={v => v.length > 22 ? v.slice(0,22) + '…' : v} />
                    <Tooltip formatter={(v, n) => [v.toLocaleString('it-IT') + ' pz', 'Pezzi']}
                      labelFormatter={l => l} />
                    <Bar dataKey="tot_quantita" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 10, formatter: v => v > 0 ? v : '' }}>
                      {prodotti.slice(0,15).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          {/* Tabella completa */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold">Elenco completo prodotti</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-3 w-8">#</th>
                    <th className="text-left px-4 py-3">Prodotto</th>
                    <th className="text-left px-4 py-3">Categoria</th>
                    <th className="text-right px-4 py-3">Pezzi</th>
                    <th className="text-right px-4 py-3">Quota %</th>
                    <th className="text-right px-4 py-3">Operatori</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {prodotti.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      {loading ? 'Caricamento...' : 'Nessun dato'}
                    </td></tr>
                  )}
                  {prodotti.map((p, i) => {
                    const totale = prodotti.reduce((s, x) => s + (x.tot_quantita || 0), 0)
                    const pct = totale > 0 ? ((p.tot_quantita / totale) * 100).toFixed(1) : '—'
                    const maxQ = prodotti[0]?.tot_quantita || 1
                    const barPct = (p.tot_quantita / maxQ * 100).toFixed(1)
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-400 text-xs">{i+1}</td>
                        <td className="px-4 py-2.5 font-medium">{p.prodotto}</td>
                        <td className="px-4 py-2.5">
                          {p.categoria && p.categoria !== 'nan' && !p.categoria.includes('STIMA')
                            ? <span className="badge badge-gray text-xs">{p.categoria}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold">{(p.tot_quantita || 0).toLocaleString('it-IT')}</td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-violet-400" style={{ width: `${barPct}%` }} />
                            </div>
                            <span className="text-gray-400 text-xs w-10 text-right">{pct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-400">{p.n_operatori}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── UP-SELL ──────────────────────────────────────────── */}
      {tab === 'upsell' && (
        <div className="space-y-4">
          {selOp && (
            <div className="flex items-center gap-2 p-3 bg-violet-50 rounded-lg text-sm text-violet-700">
              Filtro attivo: <strong>{selOp}</strong>
              <button onClick={() => setSelOp(null)} className="ml-auto text-violet-500 hover:text-violet-700">✕</button>
            </div>
          )}

          {/* KPI Up-sell */}
          <div className="grid grid-cols-3 gap-4">
            <div className="kpi-card border-l-4 border-green-500">
              <p className="text-xs text-gray-400 mb-1">Tot. aggiunte</p>
              <p className="text-xl font-bold text-green-600">
                +{fmt(varianti.reduce((s, v) => s + (v.tot_aggiunte || 0), 0))}
              </p>
            </div>
            <div className="kpi-card border-l-4 border-red-400">
              <p className="text-xs text-gray-400 mb-1">Tot. rimozioni</p>
              <p className="text-xl font-bold text-red-500">
                -{fmt(varianti.reduce((s, v) => s + (v.tot_rimozioni || 0), 0))}
              </p>
            </div>
            <div className="kpi-card border-l-4 border-amber-500">
              <p className="text-xs text-gray-400 mb-1">Importo aggiunte</p>
              <p className="text-xl font-bold">
                {eur(varianti.reduce((s, v) => s + (v.tot_importo_aggiunta || 0), 0))}
              </p>
            </div>
          </div>

          <p className="text-sm text-gray-500">
            Le varianti aggiunte rappresentano up-sell e personalizzazioni. Più aggiunte = maggiore engagement con il cliente.
          </p>
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold">Top Varianti {selOp ? `— ${selOp}` : '(tutti gli operatori)'}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-3">Variante</th>
                    <th className="text-left px-4 py-3">Operatore</th>
                    <th className="text-right px-4 py-3">Aggiunte</th>
                    <th className="text-right px-4 py-3">Rimozioni</th>
                    <th className="text-right px-4 py-3">Importo aggiunte</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredVarianti.map((v, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium">{v.variante}</td>
                      <td className="px-4 py-2.5 text-gray-600">{v.operatore}</td>
                      <td className="px-4 py-2.5 text-right text-green-600 font-medium">+{v.tot_aggiunte?.toFixed(0)}</td>
                      <td className="px-4 py-2.5 text-right text-red-500">{v.tot_rimozioni?.toFixed(0)}</td>
                      <td className="px-4 py-2.5 text-right">{eur(v.tot_importo_aggiunta)}</td>
                    </tr>
                  ))}
                  {filteredVarianti.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Nessuna variante trovata</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── CALENDARIO + PERSONALE (automatico) ─────────────────── */}
      {tab === 'calendario' && (
        <CalendarioSmart sede={sede} />
      )}
    </div>
      <PageAssistant
        pagina="Venduto & Prodotti"
        suggerimenti={[
          "Quali sono i 10 prodotti più venduti?",
          "Venduto per categoria questo mese",
          "Quale operatore ha venduto di più?",
        ]}
      />
    </>
  )
}