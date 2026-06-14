/**
 * PrenotazioniBI.jsx — Prenotazioni & Clienti BI
 *
 * Analisi prenotazioni (prenotazioni_summary), canali di provenienza (clienti_stats)
 * e impatto € dei no-show (coperto medio reale da chiusure_giornaliere).
 *
 * TUTTE le card/grafici/tabelle si ricalcolano su periodo (from/to) e sede (MA/PN/ALL).
 * Nessun dato inventato: quando mancano dati nel periodo viene dichiarato esplicitamente.
 *
 * NOTE COPERTURA: prenotazioni_summary e clienti_stats sono ancora sparse (i connettori
 * prenotazioni sono in rollout); la copertura effettiva è dichiarata in pagina.
 */
import React, { useEffect, useState, useMemo } from 'react'
import supabase from '../supabase'
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import {
  CalendarDays, Users, XCircle, UtensilsCrossed,
  Loader, AlertCircle, ChevronDown, ChevronUp, Info
} from 'lucide-react'
import PageAssistant from '../components/PageAssistant'
import PeriodFilter from '../components/PeriodFilter'

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6']
const SEDE_OPTS = [
  { value: 'all', label: 'Entrambe' },
  { value: 'MA', label: 'Mameli (MA)' },
  { value: 'PN', label: 'Predda Niedda (PN)' },
]
const SEDE_LABEL = { MA: 'Mameli', PN: 'Predda Niedda' }
const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

const fmt = n => (n != null ? Number(n).toLocaleString('it-IT') : '—')
const eur = n => (Number(n) || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const eur2 = n => (Number(n) || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pctStr = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '—')
const datIt = s => (s ? new Date(s + 'T00:00:00').toLocaleDateString('it-IT') : '—')

function meseCorrente() {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const y = now.getFullYear(), m = now.getMonth() + 1
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(now.getDate())}` }
}

// Mesi YYYY-MM toccati dall'intervallo (clienti_stats è indicizzato per periodo='YYYY-MM')
function periodiInRange(from, to) {
  const res = []
  if (!from || !to) return res
  let d = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  while (d <= end) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!res.includes(k)) res.push(k)
    d.setDate(d.getDate() + 1)
  }
  return res
}

function InfoTip({ text }) {
  return (
    <span className="group relative inline-flex items-center align-middle ml-1">
      <Info size={13} className="text-gray-400 cursor-help" />
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1 w-64 bg-gray-900 text-white text-[11px] leading-snug rounded-lg p-2 opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-lg">
        {text}
      </span>
    </span>
  )
}

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

function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-semibold text-gray-800">{d.name}</div>
      <div className="text-gray-600">{fmt(d.value)} clienti</div>
      <div className="text-gray-400">{d.payload?.pct}</div>
    </div>
  )
}

function BarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-semibold text-gray-800 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color }} />
          <span className="text-gray-600">{p.name}: <b>{fmt(p.value)}</b></span>
        </div>
      ))}
    </div>
  )
}

function Tabella({ rows }) {
  const [sortKey, setSortKey] = useState('n_prenotazioni')
  const [sortDir, setSortDir] = useState('desc')
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const av = a[sortKey] ?? '', bv = b[sortKey] ?? ''
    if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
  }), [rows, sortKey, sortDir])
  const toggleSort = k => { if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(k); setSortDir('desc') } }
  const Th = ({ k, label }) => (
    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-800" onClick={() => toggleSort(k)}>
      <span className="flex items-center gap-1">{label}{sortKey === k ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronDown size={12} className="text-gray-300" />}</span>
    </th>
  )
  if (!sorted.length) return <div className="text-center py-12 text-gray-400 text-sm">Nessun dato disponibile per il periodo selezionato.</div>
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <Th k="periodo" label="Periodo" />
            <Th k="sede" label="Sede" />
            <Th k="turno" label="Turno" />
            <Th k="stato" label="Stato" />
            <Th k="n_prenotazioni" label="Prenotazioni" />
            <Th k="n_persone" label="Persone" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {sorted.map((r, i) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.periodo || datIt(r.data_inizio)}</td>
              <td className="px-3 py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.sede === 'MA' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'}`}>{r.sede}</span>
              </td>
              <td className="px-3 py-2 text-gray-600 capitalize">{r.turno || '—'}</td>
              <td className="px-3 py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.stato === 'chiusa' ? 'bg-emerald-100 text-emerald-700' : r.stato === 'no_show' ? 'bg-rose-100 text-rose-600' : 'bg-gray-100 text-gray-500'}`}>{r.stato || '—'}</span>
              </td>
              <td className="px-3 py-2 text-right font-semibold text-gray-800">{fmt(r.n_prenotazioni)}</td>
              <td className="px-3 py-2 text-right text-gray-600">{fmt(r.n_persone)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function PrenotazioniBI() {
  const [sede, setSede] = useState('all')
  const [period, setPeriod] = useState('month')
  const [dates, setDates] = useState(meseCorrente())
  const handlePeriodChange = (pid, d) => { setPeriod(pid); if (d?.from && d?.to) setDates(d) }

  const [prenotazioni, setPrenotazioni] = useState([])
  const [clientiStats, setClientiStats] = useState([])
  const [chiusure, setChiusure] = useState([]) // chiusure_giornaliere per coperto medio reale
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        // prenotazioni_summary — overlap filter robusto: il record [data_inizio,data_fine]
        // si sovrappone con il periodo [from,to] se data_inizio<=to AND data_fine>=from.
        let qP = supabase.from('prenotazioni_summary').select('*')
        if (sede !== 'all') qP = qP.eq('sede', sede)
        if (dates.to) qP = qP.lte('data_inizio', dates.to)
        if (dates.from) qP = qP.gte('data_fine', dates.from)
        qP = qP.range(0, 4999)

        // clienti_stats — filtrato per i periodi (YYYY-MM) toccati dal range + sede
        const periodi = periodiInRange(dates.from, dates.to)
        let qC = supabase.from('clienti_stats').select('*').eq('grouping_tipo', 'provenienza')
        if (sede !== 'all') qC = qC.eq('sede', sede)
        if (periodi.length) qC = qC.in('periodo', periodi)
        qC = qC.range(0, 4999)

        // chiusure_giornaliere — coperto medio reale del periodo per stima € no-show
        let qG = supabase.from('chiusure_giornaliere').select('sede, data, coperti, coperto_medio, totale_venduto_ipratico')
        if (sede !== 'all') qG = qG.eq('sede', sede)
        if (dates.from) qG = qG.gte('data', dates.from)
        if (dates.to) qG = qG.lte('data', dates.to)
        qG = qG.range(0, 4999)

        const [rP, rC, rG] = await Promise.all([qP, qC, qG])
        if (rP.error) throw rP.error
        if (rC.error) throw rC.error
        if (rG.error) throw rG.error
        if (!cancelled) {
          setPrenotazioni(rP.data ?? [])
          setClientiStats(rC.data ?? [])
          setChiusure(rG.data ?? [])
        }
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [sede, dates])

  // Coperto medio reale del periodo (da chiusure_giornaliere): Σ venduto / Σ coperti
  const copertoMedioReale = useMemo(() => {
    let venduto = 0, coperti = 0
    for (const r of chiusure) {
      venduto += Number(r.totale_venduto_ipratico) || 0
      coperti += Number(r.coperti) || 0
    }
    return coperti > 0 ? venduto / coperti : null
  }, [chiusure])

  // KPI aggregati
  const kpi = useMemo(() => {
    const totPren = prenotazioni.reduce((s, r) => s + (r.n_prenotazioni || 0), 0)
    const totPers = prenotazioni.reduce((s, r) => s + (r.n_persone || 0), 0)
    const noShow = prenotazioni.filter(r => r.stato === 'no_show')
    const chiuse = prenotazioni.filter(r => r.stato === 'chiusa')
    const totNS = noShow.reduce((s, r) => s + (r.n_prenotazioni || 0), 0)
    const persNS = noShow.reduce((s, r) => s + (r.n_persone || 0), 0)
    const totChiuse = chiuse.reduce((s, r) => s + (r.n_prenotazioni || 0), 0)
    const persChiuse = chiuse.reduce((s, r) => s + (r.n_persone || 0), 0)
    const persPren = totChiuse > 0 ? (persChiuse / totChiuse).toFixed(1) : '—'
    // Impatto € no-show = persone no-show × coperto medio reale (solo se calcolabile)
    const impattoNS = copertoMedioReale != null ? persNS * copertoMedioReale : null
    return {
      totPren, totPers,
      noShowPct: totPren > 0 ? ((totNS / totPren) * 100).toFixed(1) : '0.0',
      totNS, persNS, persPren, impattoNS,
    }
  }, [prenotazioni, copertoMedioReale])

  // BarChart per turno (chiuse vs no_show)
  const barTurno = useMemo(() => {
    const map = {}
    prenotazioni.forEach(r => {
      const turno = r.turno || 'altro'
      if (!map[turno]) map[turno] = { turno, chiuse: 0, no_show: 0 }
      if (r.stato === 'chiusa') map[turno].chiuse += r.n_prenotazioni || 0
      if (r.stato === 'no_show') map[turno].no_show += r.n_prenotazioni || 0
    })
    return Object.values(map).sort((a, b) => a.turno.localeCompare(b.turno))
  }, [prenotazioni])

  // PieChart canali (da clienti_stats, già filtrato per periodo+sede)
  const pieCanali = useMemo(() => {
    const map = {}
    clientiStats.forEach(r => { const k = r.valore || 'Sconosciuto'; map[k] = (map[k] || 0) + (r.n_clienti || 0) })
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1])
    const totale = sorted.reduce((s, [, v]) => s + v, 0)
    const top = sorted.slice(0, 5)
    const altroTot = sorted.slice(5).reduce((s, [, v]) => s + v, 0)
    const result = top.map(([name, value]) => ({ name, value, pct: pctStr(value, totale) }))
    if (altroTot > 0) result.push({ name: 'Altro', value: altroTot, pct: pctStr(altroTot, totale) })
    return result
  }, [clientiStats])

  // Confronto per sede (vista globale)
  const perSede = useMemo(() => {
    if (sede !== 'all') return []
    const m = { MA: { pren: 0, pers: 0, ns: 0 }, PN: { pren: 0, pers: 0, ns: 0 } }
    prenotazioni.forEach(r => {
      const s = r.sede === 'PN' ? 'PN' : 'MA'
      m[s].pren += r.n_prenotazioni || 0
      m[s].pers += r.n_persone || 0
      if (r.stato === 'no_show') m[s].ns += r.n_prenotazioni || 0
    })
    return ['MA', 'PN'].map(s => ({ sede: s, nome: SEDE_LABEL[s], ...m[s] }))
  }, [prenotazioni, sede])

  // Trend per giorno settimana — solo se i record sono giornalieri (data_inizio==data_fine)
  const giorniData = useMemo(() => {
    const daily = prenotazioni.filter(r => r.data_inizio && r.data_inizio === r.data_fine)
    if (!daily.length) return null // dati aggregati per mese → trend giornaliero non calcolabile
    const g = GIORNI.map(giorno => ({ giorno, prenotazioni: 0, persone: 0 }))
    daily.forEach(r => {
      const dow = new Date(r.data_inizio + 'T00:00:00').getDay()
      const idx = dow === 0 ? 6 : dow - 1
      g[idx].prenotazioni += r.n_prenotazioni || 0
      g[idx].persone += r.n_persone || 0
    })
    return g
  }, [prenotazioni])

  const periodiLabel = periodiInRange(dates.from, dates.to).join(', ')

  const systemContext = useMemo(() => `Pagina: Prenotazioni & Clienti BI
Sede: ${sede === 'all' ? 'Entrambe (MA + PN)' : SEDE_LABEL[sede]}
Periodo: ${dates.from} → ${dates.to}
KPI:
- Tot. Prenotazioni: ${fmt(kpi.totPren)}
- Tot. Persone: ${fmt(kpi.totPers)}
- Tasso No-Show: ${kpi.noShowPct}% (${fmt(kpi.totNS)} prenotazioni, ${fmt(kpi.persNS)} persone)
- Impatto € no-show: ${kpi.impattoNS != null ? eur(kpi.impattoNS) : 'non calcolabile (manca coperto medio reale)'}
- Coperto medio reale periodo: ${copertoMedioReale != null ? eur2(copertoMedioReale) : 'n/d'}
- Persone medie/prenotazione: ${kpi.persPren}
Canali (clienti_stats, periodi ${periodiLabel}): ${pieCanali.slice(0, 3).map(c => `${c.name} (${c.pct})`).join(', ') || 'nessuno'}
Righe prenotazioni: ${prenotazioni.length}`, [kpi, sede, dates, pieCanali, prenotazioni.length, copertoMedioReale, periodiLabel])

  const noPren = !loading && prenotazioni.length === 0

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarDays size={22} className="text-violet-600" />
            Prenotazioni &amp; Clienti BI
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Prenotazioni, tasso e impatto € dei no-show, canali di provenienza.{' '}
            <span className="text-gray-400">Fonti: prenotazioni_summary, clienti_stats, chiusure_giornaliere.</span>
          </p>
        </div>
      </div>

      <PeriodFilter period={period} dates={dates} onChange={handlePeriodChange}
        extra={
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {SEDE_OPTS.map(o => (
              <button key={o.value} onClick={() => setSede(o.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${sede === o.value ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                {o.label}
              </button>
            ))}
          </div>
        } />

      {error && (
        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm">
          <AlertCircle size={16} /> <span>Errore nel caricamento dati: {error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 gap-3">
          <Loader size={20} className="animate-spin" /><span className="text-sm">Caricamento dati...</span>
        </div>
      ) : (
        <>
          {noPren && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm">
              <AlertCircle size={16} />
              <span>Nessuna prenotazione disponibile per il periodo/sede selezionati. I dati prenotazioni sono ancora in fase di raccolta (connettori in rollout).</span>
            </div>
          )}

          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard icon={CalendarDays} label="Tot. Prenotazioni" value={fmt(kpi.totPren)} sub="nel periodo" color="#7c3aed" />
            <KPICard icon={Users} label="Tot. Persone" value={fmt(kpi.totPers)} sub="coperti prenotati" color="#10b981" />
            <KPICard icon={XCircle} label="Tasso No-Show" value={`${kpi.noShowPct}%`}
              sub={`${fmt(kpi.totNS)} prenot. / ${fmt(kpi.persNS)} persone`} color="#ef4444" />
            <KPICard icon={UtensilsCrossed} label="Impatto € No-Show"
              value={kpi.impattoNS != null ? eur(kpi.impattoNS) : 'n/d'}
              sub={copertoMedioReale != null ? `${fmt(kpi.persNS)} pers. × ${eur2(copertoMedioReale)}` : 'coperto medio non disponibile'}
              color="#f59e0b" />
          </div>

          {/* Spiegazione impatto no-show */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 text-xs text-gray-500 flex items-start gap-2">
            <Info size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
            <span>
              <b>Impatto € no-show</b> = persone no-show ({fmt(kpi.persNS)}) × coperto medio reale del periodo
              {copertoMedioReale != null ? <> ({eur2(copertoMedioReale)}, calcolato da chiusure_giornaliere: Σ venduto ÷ Σ coperti)</> : ' (non disponibile per questo periodo)'}.
              È una stima del mancato incasso, non un dato fiscalizzato.
            </span>
          </div>

          {/* Confronto sedi (solo vista globale) */}
          {sede === 'all' && perSede.some(s => s.pren > 0) && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-1 flex items-center">
                Confronto sedi — Mameli vs Predda Niedda
                <InfoTip text="Prenotazioni, persone e no-show per sede nel periodo. Fonte: prenotazioni_summary." />
              </h2>
              <div className="grid grid-cols-2 gap-4 mt-3">
                {perSede.map(s => (
                  <div key={s.sede} className="rounded-xl border border-gray-100 p-4 bg-gray-50">
                    <div className="font-semibold text-gray-700 text-sm">{s.nome}</div>
                    <div className="text-xs text-gray-500 mt-1">Prenotazioni: <b className="text-gray-800">{fmt(s.pren)}</b> · Persone: <b className="text-gray-800">{fmt(s.pers)}</b></div>
                    <div className="text-xs text-gray-500">No-show: <b className="text-rose-600">{fmt(s.ns)}</b> ({pctStr(s.ns, s.pren)})</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Grafici */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-1 flex items-center">
                Prenotazioni per Turno
                <InfoTip text="Prenotazioni chiuse vs no-show per turno nel periodo. Fonte: prenotazioni_summary." />
              </h2>
              <p className="text-xs text-gray-400 mb-3">Periodo {dates.from} → {dates.to}</p>
              {barTurno.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Dati non disponibili per il periodo</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={barTurno} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="turno" tick={{ fontSize: 11 }} tickFormatter={t => t.charAt(0).toUpperCase() + t.slice(1)} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<BarTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="chiuse" name="Chiuse" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="no_show" name="No Show" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-1 flex items-center">
                Clienti per Canale di Provenienza
                <InfoTip text="Numero clienti per canale di prenotazione. Fonte: clienti_stats (grouping 'provenienza'), filtrata per i mesi del periodo e per sede." />
              </h2>
              <p className="text-xs text-gray-400 mb-3">Periodi: {periodiLabel || '—'}</p>
              {pieCanali.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Dati canali non disponibili per il periodo</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={pieCanali} cx="50%" cy="50%" innerRadius={55} outerRadius={90} dataKey="value" nameKey="name" paddingAngle={3}>
                      {pieCanali.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }}
                      formatter={(value, entry) => `${value} (${entry.payload?.pct})`} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Trend per giorno settimana (solo se dati giornalieri) */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-1 flex items-center">
              Prenotazioni per Giorno della Settimana
              <InfoTip text="Disponibile solo quando i dati sono giornalieri (data_inizio = data_fine). Con record aggregati per mese il trend per giorno non è calcolabile. Fonte: prenotazioni_summary." />
            </h2>
            {giorniData == null ? (
              <p className="text-xs text-gray-400 py-6 text-center">
                Trend per giorno non disponibile: nel periodo le prenotazioni sono aggregate per mese, non per singolo giorno.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={giorniData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="giorno" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<BarTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="prenotazioni" name="Prenotazioni" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="persone" name="Persone" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Tabella riepilogo */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-4">
              Riepilogo Prenotazioni
              <span className="ml-2 text-xs font-normal text-gray-400">({prenotazioni.length} righe — periodo {dates.from} → {dates.to})</span>
            </h2>
            <Tabella rows={prenotazioni} />
          </div>
        </>
      )}

      <PageAssistant pagina="prenotazioni-bi" systemContext={systemContext}
        suggerimenti={[
          'Quante prenotazioni no-show abbiamo avuto nel periodo?',
          "Qual è l'impatto economico dei no-show?",
          'Qual è il canale di prenotazione più usato?',
          'Confronta Mameli e Predda Niedda per no-show',
        ]} />
    </div>
  )
}
