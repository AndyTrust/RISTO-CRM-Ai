/**
 * VendutoPage.jsx — Analisi venduto con calendario heatmap + BI avanzata
 */
import React, { useEffect, useState, useMemo } from 'react'
import supabase from '../supabase'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ComposedChart, Line
} from 'recharts'
import DateRangePicker, { periodToDates } from '../components/DateRangePicker'
import PageAssistant from '../components/PageAssistant'
import { TrendingUp, Users, ShoppingBag, BarChart2, Calendar, ArrowUpRight } from 'lucide-react'

const COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ec4899','#8b5cf6','#ef4444','#14b8a6','#f97316','#06b6d4']
const MESI_IT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const GIORNI_IT = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab']

async function sbq(q) {
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

function locationToSede(location) {
  if (!location || location === 'all') return null
  if (location === 'MAMELI')        return 'MA'
  if (location === 'PREDDA_NIEDDA') return 'PN'
  return location
}

async function loadOperatori(sede, from, to) {
  let q = supabase.from('venduto_camerieri').select('sede, operatore, quantita')
  if (sede) q = q.eq('sede', sede)
  // Overlap interval filter: il record [data_inizio, data_fine] si sovrappone con [from, to]
  if (to)   q = q.lte('data_inizio', to)
  if (from) q = q.gte('data_fine', from)
  q = q.not('operatore', 'ilike', 'pienissimo')  // escludi operatore di sistema
  q = q.range(0, 4999)                            // bypass limite default 1000 righe
  const rows = await sbq(q)
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
  let q = supabase.from('venduto_camerieri').select('categoria, quantita')
  if (sede) q = q.eq('sede', sede)
  // Overlap interval filter: il record [data_inizio, data_fine] si sovrappone con [from, to]
  if (to)   q = q.lte('data_inizio', to)
  if (from) q = q.gte('data_fine', from)
  q = q.not('operatore', 'ilike', 'pienissimo')  // escludi operatore di sistema
  q = q.range(0, 4999)                            // bypass limite default 1000 righe
  const rows = await sbq(q)
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
  let q = supabase.from('venduto_camerieri').select('prodotto, categoria, quantita, operatore')
  if (sede) q = q.eq('sede', sede)
  // Overlap interval filter: il record [data_inizio, data_fine] si sovrappone con [from, to]
  if (to)   q = q.lte('data_inizio', to)
  if (from) q = q.gte('data_fine', from)
  q = q.not('operatore', 'ilike', 'pienissimo')  // escludi operatore di sistema
  q = q.range(0, 4999)                            // bypass limite default 1000 righe
  const rows = await sbq(q)
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
  let q = supabase.from('varianti_camerieri').select('variante, operatore, aggiunta_qty, aggiunta_importo, rimozione_qty')
  if (sede) q = q.eq('sede', sede)
  // Overlap interval filter: il record [data_inizio, data_fine] si sovrappone con [from, to]
  if (to)   q = q.lte('data_inizio', to)
  if (from) q = q.gte('data_fine', from)
  q = q.not('operatore', 'ilike', 'pienissimo')  // escludi operatore di sistema
  q = q.range(0, 4999)                            // bypass limite default 1000 righe
  const rows = await sbq(q)
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

// ── Matrice Operatori × Categorie ─────────────────────────────────────────
async function loadMatriceCategorie(sede, from, to) {
  let q = supabase.from('venduto_camerieri')
    .select('operatore, categoria, quantita')
  if (sede) q = q.eq('sede', sede)
  if (to)   q = q.lte('data_inizio', to)
  if (from) q = q.gte('data_fine', from)
  q = q.not('operatore', 'ilike', '%pienissimo%')
  q = q.range(0, 9999)
  const rows = await sbq(q)

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

// ─── Calendario Heatmap ──────────────────────────────────────────────────────
function CalendarioHeatmap({ dailyData }) {
  const [hoverDay, setHoverDay] = useState(null)

  const grouped = useMemo(() => {
    const byMonth = {}
    for (const r of dailyData) {
      const [y, m] = r.data.split('-')
      const key = `${y}-${m}`
      if (!byMonth[key]) byMonth[key] = { year: parseInt(y), month: parseInt(m), days: {} }
      const d = parseInt(r.data.split('-')[2])
      if (!byMonth[key].days[d]) byMonth[key].days[d] = { venduto: 0, coperti: 0, coperto_medio: 0, sedi: [] }
      byMonth[key].days[d].venduto += parseFloat(r.totale_venduto_ipratico) || 0
      byMonth[key].days[d].coperti += parseInt(r.coperti) || 0
      byMonth[key].days[d].sedi.push(r.sede)
      // coperto medio pesato: venduto / coperti (non media semplice tra sedi)
      byMonth[key].days[d].coperto_medio = byMonth[key].days[d].coperti > 0
        ? +(byMonth[key].days[d].venduto / byMonth[key].days[d].coperti).toFixed(2) : 0
    }
    return Object.values(byMonth).sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
  }, [dailyData])

  const allVenduto = useMemo(() => dailyData.map(r => parseFloat(r.totale_venduto_ipratico) || 0).filter(v => v > 0), [dailyData])
  const maxV = Math.max(...allVenduto, 1)
  const avgV = allVenduto.length ? allVenduto.reduce((s, v) => s + v, 0) / allVenduto.length : 0

  function getColor(venduto) {
    if (!venduto) return '#f9fafb'
    const ratio = venduto / maxV
    if (ratio > 0.8) return '#1d4ed8'
    if (ratio > 0.6) return '#3b82f6'
    if (ratio > 0.4) return '#93c5fd'
    if (ratio > 0.2) return '#bfdbfe'
    return '#dbeafe'
  }

  if (grouped.length === 0) {
    return <p className="text-center text-gray-400 py-10 text-sm">Nessun dato disponibile nel periodo selezionato</p>
  }

  return (
    <div className="space-y-6">
      {/* Legenda */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-500">Intensità venduto:</span>
        {['Basso','','Medio','','Alto'].map((lbl, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: getColor(maxV * (i * 0.25)) }} />
            {lbl && <span className="text-xs text-gray-400">{lbl}</span>}
          </div>
        ))}
        <span className="ml-4 text-xs text-gray-400">Media giornaliera: <strong>{eur(avgV)}</strong></span>
        <span className="text-xs text-gray-400">Max: <strong>{eur(maxV)}</strong></span>
      </div>

      {grouped.map(({ year, month, days }) => {
        const daysInMonth = new Date(year, month, 0).getDate()
        const firstDow = new Date(year, month - 1, 1).getDay() // 0=Dom
        const cells = Array.from({ length: firstDow }, () => null).concat(
          Array.from({ length: daysInMonth }, (_, i) => i + 1)
        )
        // Pad to 6 rows
        while (cells.length % 7 !== 0) cells.push(null)

        return (
          <div key={`${year}-${month}`}>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              {MESI_IT[month - 1]} {year}
              <span className="ml-3 text-xs font-normal text-gray-400">
                {fmt(Object.values(days).reduce((s, d) => s + d.coperti, 0))} coperti ·{' '}
                {eur(Object.values(days).reduce((s, d) => s + d.venduto, 0))}
              </span>
            </h3>
            <div className="grid grid-cols-7 gap-1 text-center">
              {GIORNI_IT.map(g => (
                <div key={g} className="text-xs text-gray-400 pb-1">{g}</div>
              ))}
              {cells.map((d, idx) => {
                if (!d) return <div key={idx} />
                const info = days[d]
                const hKey = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
                const isHover = hoverDay === hKey
                const isAboveAvg = info?.venduto > avgV * 1.1
                return (
                  <div
                    key={idx}
                    className={`rounded-md aspect-square flex flex-col items-center justify-center cursor-pointer transition-all border ${
                      isHover ? 'border-violet-400 scale-105 z-10 relative shadow-md' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: info ? getColor(info.venduto) : '#f9fafb' }}
                    onMouseEnter={() => setHoverDay(hKey)}
                    onMouseLeave={() => setHoverDay(null)}
                    title={info
                      ? `${d}/${month}/${year}\nVenduto: ${eur(info.venduto)}\nCoperti: ${fmt(info.coperti)}\nCop. medio: ${eur(info.coperto_medio)}`
                      : `${d}/${month}/${year} — Chiuso`}
                  >
                    <span className={`text-xs font-medium ${info?.venduto > maxV * 0.5 ? 'text-white' : 'text-gray-600'}`}>
                      {d}
                    </span>
                    {info && (
                      <span className={`text-xs ${info.venduto > maxV * 0.5 ? 'text-blue-100' : 'text-blue-400'} leading-none`}>
                        {isAboveAvg ? '★' : ''}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Tooltip hover info */}
            {hoverDay && hoverDay.startsWith(`${year}-${String(month).padStart(2,'0')}`) && (() => {
              const d = parseInt(hoverDay.split('-')[2])
              const info = days[d]
              if (!info) return null
              return (
                <div className="mt-2 p-3 bg-white border border-gray-200 rounded-lg shadow text-xs flex gap-4 flex-wrap">
                  <span><strong>{hoverDay}</strong></span>
                  <span>💰 <strong>{eur(info.venduto)}</strong></span>
                  <span>👥 <strong>{fmt(info.coperti)}</strong> coperti</span>
                  <span>📊 Cop. medio: <strong>{eur(info.coperto_medio)}</strong></span>
                  <span>📍 Sedi: <strong>{info.sedi.join(', ')}</strong></span>
                </div>
              )
            })()}
          </div>
        )
      })}
    </div>
  )
}

export default function VendutoPage() {
  const [location, setLocation] = useState('all')
  const [operatori, setOperatori] = useState([])
  const [fatturatoOp, setFatturatoOp] = useState([])
  const [categorie, setCategorie] = useState([])
  const [prodotti, setProdotti] = useState([])
  const [varianti, setVarianti] = useState([])
  const [dailyData, setDailyData] = useState([])
  const [selOp, setSelOp] = useState(null)
  const [tab, setTab] = useState('operatori')
  const [period, setPeriod] = useState('month')
  const [dates, setDates] = useState(periodToDates('month'))
  const [loading, setLoading] = useState(true)

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
    ]).then(([op, fatOp, cat, prod, var_, daily]) => {
      if (cancelled) return
      setOperatori(op)
      setFatturatoOp(fatOp)
      setCategorie(cat); setProdotti(prod); setVarianti(var_)
      setDailyData(daily)
      setSelOp(null)
    }).catch(e => { if (!cancelled) console.error(e) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [location, from, to])

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

      {/* Date range picker */}
      <div className="flex items-center gap-3 flex-wrap">
        <DateRangePicker period={period} dates={dates} onChange={handleDateChange} />
        {dates?.from && dates?.to && (
          <span className="text-xs text-gray-400">{dates.from} → {dates.to}</span>
        )}
        {loading && <span className="text-xs text-gray-400 animate-pulse">Caricamento...</span>}
      </div>

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
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Mameli</p>
              <span className="w-2 h-2 rounded-full bg-indigo-500" />
            </div>
            <p className="text-xl font-bold text-indigo-700">€{(fatMA/1000).toFixed(1)}k</p>
            <p className="text-xs text-gray-400">{opMA.length} operatori · {opMA.reduce((s,o) => s+o.coperti, 0).toLocaleString('it-IT')} pezzi</p>
          </div>
        )}
        {totFatturato > 0 && location === 'all' && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Predda Niedda</p>
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
              <OperatoriTable ops={opMA} title="Mameli (MA)" color="#6366f1" />
              <OperatoriTable ops={opPN} title="Predda Niedda (PN)" color="#10b981" />
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
                        tickFormatter={v => fatturatoOp.length > 0 ? `€${(v/1000).toFixed(0)}k` : v.toLocaleString()} />
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
            <div className="card-header"><h2 className="font-semibold">Categorie — Distribuzione pezzi</h2></div>
            <div className="card-body">
              {categorie.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Nessun dato</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={categorie} dataKey="tot_quantita" nameKey="categoria" cx="50%" cy="50%" outerRadius={100}
                      label={({ percent }) => `${(percent*100).toFixed(0)}%`}>
                      {categorie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={v => v.toLocaleString('it-IT')} />
                    <Legend />
                  </PieChart>
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
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold">Top 20 Prodotti per quantità</h2>
            <p className="text-xs text-gray-400 mt-0.5">Pezzi venduti per prodotto nel periodo</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3 w-8">#</th>
                  <th className="text-left px-4 py-3">Prodotto</th>
                  <th className="text-left px-4 py-3">Categoria</th>
                  <th className="text-right px-4 py-3">Pezzi</th>
                  <th className="text-right px-4 py-3">Quota</th>
                  <th className="text-right px-4 py-3">Operatori</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {prodotti.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    {loading ? 'Caricamento...' : 'Nessun dato per il periodo selezionato'}
                  </td></tr>
                )}
                {prodotti.map((p, i) => {
                  const maxQ = prodotti[0]?.tot_quantita || 1
                  const barPct = (p.tot_quantita / maxQ * 100).toFixed(1)
                  return (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-400">{i+1}</td>
                      <td className="px-4 py-2.5 font-medium">{p.prodotto}</td>
                      <td className="px-4 py-2.5">
                        {p.categoria && p.categoria !== 'nan'
                          ? <span className="badge badge-gray">{p.categoria}</span>
                          : <span className="text-gray-300">—</span>
                        }
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">{(p.tot_quantita || 0).toLocaleString('it-IT')}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden ml-auto">
                          <div className="h-full rounded-full bg-blue-400" style={{ width: `${barPct}%` }} />
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

      {/* ─── CALENDARIO HEATMAP ───────────────────────────────── */}
      {tab === 'calendario' && (
        <div className="card p-6">
          <div className="mb-4">
            <h2 className="font-semibold">Calendario venduto giornaliero</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Ogni giorno colorato in base all'intensità del venduto — dati da chiusure cassa
            </p>
          </div>
          {loading ? (
            <p className="text-center text-gray-400 py-10 text-sm animate-pulse">Caricamento...</p>
          ) : (
            <CalendarioHeatmap dailyData={dailyData} />
          )}
        </div>
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