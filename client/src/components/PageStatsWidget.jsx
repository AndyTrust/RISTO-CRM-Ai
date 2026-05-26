/**
 * PageStatsWidget.jsx
 * Barra compatta con KPI in tempo reale: venduto mese, stagionalità, previsione.
 * Da includere in cima a ogni pagina del CRM.
 */
import React, { useEffect, useState, useRef } from 'react'
import { TrendingUp, TrendingDown, Minus, Calendar, Zap, BarChart2 } from 'lucide-react'
import supabase from '../supabase'

// ── Costanti ────────────────────────────────────────────────────────────────
const MESI_IT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const SEDE_MAP = { MAMELI: 'MA', PREDDA_NIEDDA: 'PN' }

// Cache globale in-memory per evitare refetch ad ogni navigazione
let _cache = null
let _cacheTs = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minuti

const eur = (n) => n == null ? '—' : `€ ${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0 })}`

function DeltaBadge({ pct }) {
  if (pct == null || isNaN(pct)) return null
  const abs = Math.abs(pct)
  if (pct > 2)  return <span className="flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600"><TrendingUp size={10}/>{abs.toFixed(0)}%</span>
  if (pct < -2) return <span className="flex items-center gap-0.5 text-[10px] font-semibold text-red-500"><TrendingDown size={10}/>{abs.toFixed(0)}%</span>
  return <span className="flex items-center gap-0.5 text-[10px] font-semibold text-gray-400"><Minus size={10}/>{abs.toFixed(0)}%</span>
}

export default function PageStatsWidget() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const now = Date.now()

    // Usa cache se valida
    if (_cache && (now - _cacheTs) < CACHE_TTL) {
      setStats(_cache)
      setLoading(false)
      return
    }

    const loadStats = async () => {
      try {
        const today = new Date()
        const anno = today.getFullYear()
        const mese = today.getMonth() + 1
        const mesePad = String(mese).padStart(2, '0')
        const prevMese = mese === 12 ? 1 : mese + 1
        const prevAnno = mese === 12 ? anno + 1 : anno

        // ── 1. Venduto mese corrente (MA + PN, da chiusure_giornaliere) ──
        const { data: chiusure } = await supabase
          .from('chiusure_giornaliere')
          .select('sede, totale_venduto_ipratico, coperti, data')
          .gte('data', `${anno}-${mesePad}-01`)
          .lte('data', `${anno}-${mesePad}-31`)
          .not('totale_venduto_ipratico', 'is', null)

        let vendutoMA = 0, vendutoPN = 0, copertiMA = 0, copertiPN = 0
        for (const r of chiusure || []) {
          const v = parseFloat(r.totale_venduto_ipratico || 0)
          const c = parseInt(r.coperti || 0)
          if (r.sede === 'MA' || r.sede === 'MAMELI') { vendutoMA += v; copertiMA += c }
          else { vendutoPN += v; copertiPN += c }
        }
        const vendutoTot = vendutoMA + vendutoPN
        const copertiTot = copertiMA + copertiPN

        // ── 2. Stagionalità mese corrente (da storico 2025) ──
        const { data: stagRows } = await supabase
          .from('chiusure_giornaliere')
          .select('sede, data, totale_venduto_ipratico, coperti')
          .gte('data', '2025-01-01')
          .lte('data', '2025-12-31')
          .not('totale_venduto_ipratico', 'is', null)

        let stagionale = null
        if (stagRows?.length) {
          // Media mensile 2025
          const byMese = {}
          for (const r of stagRows) {
            const m = parseInt(r.data.substring(5, 7))
            if (!byMese[m]) byMese[m] = 0
            byMese[m] += parseFloat(r.totale_venduto_ipratico || 0)
          }
          const mesi2025 = Object.values(byMese)
          const media2025 = mesi2025.reduce((s, v) => s + v, 0) / mesi2025.length
          if (media2025 > 0 && byMese[mese]) {
            stagionale = Math.round((byMese[mese] / media2025) * 100) / 100
          }
        }

        // ── 3. Previsione prossimo mese ──
        // Prendi ultimi 6 mesi, regressione lineare
        const { data: ultimi6 } = await supabase
          .from('chiusure_giornaliere')
          .select('sede, data, totale_venduto_ipratico')
          .gte('data', new Date(anno, mese - 7, 1).toISOString().split('T')[0])
          .lte('data', `${anno}-${mesePad}-31`)
          .not('totale_venduto_ipratico', 'is', null)

        let forecastProssimo = null
        if (ultimi6?.length) {
          const byM = {}
          for (const r of ultimi6) {
            const mk = r.data.substring(0, 7)
            if (!byM[mk]) byM[mk] = 0
            byM[mk] += parseFloat(r.totale_venduto_ipratico || 0)
          }
          const sortedKeys = Object.keys(byM).sort()
          if (sortedKeys.length >= 3) {
            const ys = sortedKeys.map(k => byM[k])
            const n = ys.length
            const xs = ys.map((_, i) => i)
            const mx = xs.reduce((s, x) => s + x, 0) / n
            const my = ys.reduce((s, y) => s + y, 0) / n
            const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
            const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0)
            const slope = den ? num / den : 0
            let rawForecast = Math.max(0, my + slope * (n - mx))
            // Correggi con stagionalità del prossimo mese
            if (stagRows?.length) {
              const byMese2025 = {}
              for (const r of stagRows) {
                const m2 = parseInt(r.data.substring(5, 7))
                if (!byMese2025[m2]) byMese2025[m2] = 0
                byMese2025[m2] += parseFloat(r.totale_venduto_ipratico || 0)
              }
              const mesi2025 = Object.values(byMese2025)
              const media2025 = mesi2025.reduce((s, v) => s + v, 0) / mesi2025.length
              const idxCurr = byMese2025[mese] ? byMese2025[mese] / media2025 : 1
              const idxNext = byMese2025[prevMese] ? byMese2025[prevMese] / media2025 : 1
              if (idxCurr > 0) rawForecast = rawForecast * (idxNext / idxCurr)
            }
            forecastProssimo = Math.round(rawForecast)
          }
        }

        // ── 4. Delta YoY mese corrente ──
        const { data: anno2025rows } = await supabase
          .from('chiusure_giornaliere')
          .select('totale_venduto_ipratico')
          .gte('data', `${anno - 1}-${mesePad}-01`)
          .lte('data', `${anno - 1}-${mesePad}-31`)
          .not('totale_venduto_ipratico', 'is', null)

        let deltaYoY = null
        const venduto2025mese = (anno2025rows || []).reduce((s, r) => s + parseFloat(r.totale_venduto_ipratico || 0), 0)
        if (venduto2025mese > 0 && vendutoTot > 0) {
          deltaYoY = Math.round(((vendutoTot - venduto2025mese) / venduto2025mese) * 1000) / 10
        }

        const result = {
          mese, anno, meseLbl: MESI_IT[mese - 1],
          vendutoTot, vendutoMA, vendutoPN,
          copertiTot, copertiMA, copertiPN,
          stagionale,
          forecastProssimo, forecastMeseLbl: MESI_IT[prevMese - 1],
          deltaYoY,
          lastUpdate: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
        }
        _cache = result
        _cacheTs = Date.now()
        if (mounted.current) { setStats(result); setLoading(false) }
      } catch (e) {
        console.warn('PageStatsWidget error:', e)
        if (mounted.current) setLoading(false)
      }
    }

    loadStats()
    return () => { mounted.current = false }
  }, [])

  if (loading) {
    return (
      <div className="w-full bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-indigo-100 px-5 py-2 flex items-center gap-3 animate-pulse">
        <div className="h-3 w-24 bg-indigo-200 rounded" />
        <div className="h-3 w-32 bg-indigo-100 rounded" />
        <div className="h-3 w-28 bg-indigo-100 rounded" />
      </div>
    )
  }

  if (!stats || stats.vendutoTot === 0) return null

  const stagColor = stats.stagionale
    ? stats.stagionale >= 1.2 ? 'text-emerald-700' : stats.stagionale >= 1.0 ? 'text-blue-600' : stats.stagionale >= 0.8 ? 'text-amber-600' : 'text-red-600'
    : 'text-gray-500'

  return (
    <div className="w-full bg-gradient-to-r from-slate-50 to-indigo-50/50 border-b border-slate-200 px-4 py-1.5 flex items-center gap-0 overflow-x-auto text-xs shrink-0">

      {/* Mese corrente */}
      <div className="flex items-center gap-1.5 pr-3 border-r border-slate-200 whitespace-nowrap">
        <Calendar size={12} className="text-indigo-400 flex-shrink-0"/>
        <span className="font-semibold text-slate-600">{stats.meseLbl} {stats.anno}</span>
      </div>

      {/* Venduto totale */}
      <div className="flex items-center gap-1.5 px-3 border-r border-slate-200 whitespace-nowrap">
        <BarChart2 size={12} className="text-indigo-500 flex-shrink-0"/>
        <span className="text-slate-500">Venduto:</span>
        <span className="font-bold text-slate-800">{eur(stats.vendutoTot)}</span>
        <DeltaBadge pct={stats.deltaYoY}/>
      </div>

      {/* Split MA / PN */}
      <div className="flex items-center gap-1.5 px-3 border-r border-slate-200 whitespace-nowrap hidden sm:flex">
        <span className="text-indigo-500 font-medium">MA</span>
        <span className="text-slate-700">{eur(stats.vendutoMA)}</span>
        <span className="text-slate-300">·</span>
        <span className="text-emerald-600 font-medium">PN</span>
        <span className="text-slate-700">{eur(stats.vendutoPN)}</span>
      </div>

      {/* Coperti */}
      {stats.copertiTot > 0 && (
        <div className="flex items-center gap-1 px-3 border-r border-slate-200 whitespace-nowrap hidden md:flex">
          <span className="text-slate-500">Coperti:</span>
          <span className="font-semibold text-slate-700">{stats.copertiTot.toLocaleString('it-IT')}</span>
        </div>
      )}

      {/* Indice stagionale */}
      {stats.stagionale && (
        <div className="flex items-center gap-1.5 px-3 border-r border-slate-200 whitespace-nowrap hidden md:flex">
          <Zap size={12} className={`flex-shrink-0 ${stagColor}`}/>
          <span className="text-slate-500">Stagionalità:</span>
          <span className={`font-bold ${stagColor}`}>×{stats.stagionale.toFixed(2)}</span>
        </div>
      )}

      {/* Previsione prossimo mese */}
      {stats.forecastProssimo && (
        <div className="flex items-center gap-1.5 px-3 whitespace-nowrap hidden lg:flex">
          <TrendingUp size={12} className="text-violet-500 flex-shrink-0"/>
          <span className="text-slate-500">Prev. {stats.forecastMeseLbl}:</span>
          <span className="font-bold text-violet-700">{eur(stats.forecastProssimo)}</span>
        </div>
      )}

      {/* Spacer + update time */}
      <div className="ml-auto pl-3 text-[10px] text-slate-400 whitespace-nowrap hidden xl:block">
        agg. {stats.lastUpdate}
      </div>
    </div>
  )
}
