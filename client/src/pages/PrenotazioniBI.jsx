/**
 * PrenotazioniBI.jsx — Prenotazioni & Clienti BI
 * Analisi prenotazioni per turno/stato, canali di provenienza clienti, KPI no-show.
 */
import React, { useEffect, useState, useMemo } from 'react'
import supabase from '../supabase'
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import {
  CalendarDays, Users, XCircle, UtensilsCrossed,
  Loader, AlertCircle, ChevronDown, ChevronUp, MapPin
} from 'lucide-react'
import PageAssistant from '../components/PageAssistant'

// ── Helpers ─────────────────────────────────────────────────────────────────
const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6']
const SEDE_OPTS = [
  { value: 'all', label: 'Entrambe' },
  { value: 'MA',  label: 'Mameli (MA)' },
  { value: 'PN',  label: 'Predda Niedda (PN)' },
]

function fmt(n) { return n != null ? Number(n).toLocaleString('it-IT') : '—' }
function pct(a, b) { return b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '—' }
function datIt(s) { return s ? new Date(s + 'T00:00:00').toLocaleDateString('it-IT') : '—' }

// Mese corrente: primo giorno → oggi
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

// ── Tooltip customizzato per PieChart ─────────────────────────────────────────
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

// ── Tooltip BarChart ─────────────────────────────────────────────────────────
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

// ── Tabella riepilogo ─────────────────────────────────────────────────────────
function Tabella({ rows }) {
  const [sortKey, setSortKey] = useState('n_prenotazioni')
  const [sortDir, setSortDir] = useState('desc')

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
  }, [rows, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const Th = ({ k, label }) => (
    <th
      className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-800 transition-colors"
      onClick={() => toggleSort(k)}
    >
      <span className="flex items-center gap-1">
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

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <Th k="periodo"         label="Periodo" />
            <Th k="sede"            label="Sede" />
            <Th k="turno"           label="Turno" />
            <Th k="stato"           label="Stato" />
            <Th k="n_prenotazioni"  label="Prenotazioni" />
            <Th k="n_persone"       label="Persone" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {sorted.map((r, i) => (
            <tr key={i} className="hover:bg-gray-50 transition-colors">
              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.periodo || datIt(r.data_inizio)}</td>
              <td className="px-3 py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                  r.sede === 'MA' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'
                }`}>{r.sede}</span>
              </td>
              <td className="px-3 py-2 text-gray-600 capitalize">{r.turno || '—'}</td>
              <td className="px-3 py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  r.stato === 'chiusa'   ? 'bg-emerald-100 text-emerald-700' :
                  r.stato === 'no_show' ? 'bg-rose-100 text-rose-600' :
                  'bg-gray-100 text-gray-500'
                }`}>{r.stato || '—'}</span>
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

// ── Componente principale ─────────────────────────────────────────────────────
export default function PrenotazioniBI() {
  const [sede, setSede]             = useState('all')
  const [dates, setDates]           = useState(meseCorrente())
  const [prenotazioni, setPrenotazioni] = useState([])
  const [clientiStats, setClientiStats] = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)

  // Carica dati da Supabase
  useEffect(() => {
    setLoading(true)
    setError(null)

    const periodoFiltro = dates.from.substring(0, 7) // 'YYYY-MM'

    // Query prenotazioni_summary
    let qP = supabase.from('prenotazioni_summary').select('*')
    if (sede !== 'all') qP = qP.eq('sede', sede)
    if (dates.from) qP = qP.gte('data_inizio', dates.from)
    if (dates.to)   qP = qP.lte('data_fine',   dates.to)
    qP = qP.range(0, 4999)

    // Query clienti_stats provenienza
    let qC = supabase.from('clienti_stats')
      .select('*')
      .eq('grouping_tipo', 'provenienza')
    if (sede !== 'all') qC = qC.eq('sede', sede)
    qC = qC.range(0, 999)

    Promise.all([qP, qC])
      .then(([{ data: pData, error: pErr }, { data: cData, error: cErr }]) => {
        if (pErr) throw pErr
        if (cErr) throw cErr
        setPrenotazioni(pData ?? [])
        setClientiStats(cData ?? [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [sede, dates])

  // ── KPI aggregati ──────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const chiuse  = prenotazioni.filter(r => r.stato === 'chiusa')
    const noShow  = prenotazioni.filter(r => r.stato === 'no_show')
    const totPren = prenotazioni.reduce((s, r) => s + (r.n_prenotazioni || 0), 0)
    const totPers = prenotazioni.reduce((s, r) => s + (r.n_persone || 0), 0)
    const totNS   = noShow.reduce((s, r) => s + (r.n_prenotazioni || 0), 0)
    const totChiuse = chiuse.reduce((s, r) => s + (r.n_prenotazioni || 0), 0)
    const persPren  = totChiuse > 0
      ? (chiuse.reduce((s, r) => s + (r.n_persone || 0), 0) / totChiuse).toFixed(1)
      : '—'
    return {
      totPren,
      totPers,
      noShowPct: totPren > 0 ? ((totNS / totPren) * 100).toFixed(1) : '0.0',
      persPren,
    }
  }, [prenotazioni])

  // ── Dati BarChart turno ────────────────────────────────────────────────────
  const barTurno = useMemo(() => {
    const map = {}
    prenotazioni.forEach(r => {
      const turno = r.turno || 'altro'
      if (!map[turno]) map[turno] = { turno, chiuse: 0, no_show: 0 }
      if (r.stato === 'chiusa')   map[turno].chiuse   += r.n_prenotazioni || 0
      if (r.stato === 'no_show')  map[turno].no_show  += r.n_prenotazioni || 0
    })
    return Object.values(map).sort((a, b) => a.turno.localeCompare(b.turno))
  }, [prenotazioni])

  // ── Dati PieChart canali ───────────────────────────────────────────────────
  const pieCanali = useMemo(() => {
    const map = {}
    clientiStats.forEach(r => {
      const k = r.valore || 'Sconosciuto'
      map[k] = (map[k] || 0) + (r.n_clienti || 0)
    })
    const sorted = Object.entries(map)
      .sort((a, b) => b[1] - a[1])
    const top5 = sorted.slice(0, 5)
    const altroTot = sorted.slice(5).reduce((s, [, v]) => s + v, 0)
    const totale = sorted.reduce((s, [, v]) => s + v, 0)
    const result = top5.map(([name, value]) => ({
      name, value, pct: pct(value, totale)
    }))
    if (altroTot > 0) result.push({ name: 'Altro', value: altroTot, pct: pct(altroTot, totale) })
    return result
  }, [clientiStats])

  // ── systemContext per PageAssistant ───────────────────────────────────────
  const systemContext = useMemo(() => {
    return `Pagina: Prenotazioni & Clienti BI
Sede: ${sede === 'all' ? 'Entrambe (MA + PN)' : sede}
Periodo: ${dates.from} → ${dates.to}
KPI:
- Tot. Prenotazioni: ${fmt(kpi.totPren)}
- Tot. Persone: ${fmt(kpi.totPers)}
- Tasso No-Show: ${kpi.noShowPct}%
- Persone medie/prenotazione: ${kpi.persPren}
Turni disponibili: ${barTurno.map(t => t.turno).join(', ') || 'nessuno'}
Canali principali: ${pieCanali.slice(0, 3).map(c => `${c.name} (${c.pct})`).join(', ') || 'nessuno'}
Righe tabella: ${prenotazioni.length}`
  }, [kpi, sede, dates, barTurno, pieCanali, prenotazioni.length])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarDays size={22} className="text-violet-600" />
            Prenotazioni &amp; Clienti BI
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Analisi prenotazioni, tasso no-show e canali di provenienza clienti
          </p>
        </div>

        {/* Controlli */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Selettore sede */}
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

          {/* DateRange semplice */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600">
            <input
              type="date"
              value={dates.from}
              onChange={e => setDates(d => ({ ...d, from: e.target.value }))}
              className="outline-none bg-transparent"
            />
            <span className="text-gray-400">→</span>
            <input
              type="date"
              value={dates.to}
              onChange={e => setDates(d => ({ ...d, to: e.target.value }))}
              className="outline-none bg-transparent"
            />
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
              icon={CalendarDays}
              label="Tot. Prenotazioni"
              value={fmt(kpi.totPren)}
              sub="periodo selezionato"
              color="#7c3aed"
            />
            <KPICard
              icon={Users}
              label="Tot. Persone"
              value={fmt(kpi.totPers)}
              sub="coperti prenotati"
              color="#10b981"
            />
            <KPICard
              icon={XCircle}
              label="Tasso No-Show"
              value={`${kpi.noShowPct}%`}
              sub="prenotazioni non presentate"
              color="#ef4444"
            />
            <KPICard
              icon={UtensilsCrossed}
              label="Coperti Medi/Prenot."
              value={kpi.persPren}
              sub="media persone per prenotazione"
              color="#f59e0b"
            />
          </div>

          {/* Grafici */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* BarChart turni */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-4">Prenotazioni per Turno</h2>
              {barTurno.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Nessun dato</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={barTurno} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="turno" tick={{ fontSize: 11 }} tickFormatter={t => t.charAt(0).toUpperCase() + t.slice(1)} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<BarTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="chiuse"  name="Chiuse"   fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="no_show" name="No Show"  fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* PieChart canali */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-4">Clienti per Canale di Provenienza</h2>
              {pieCanali.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Nessun dato</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={pieCanali}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      dataKey="value"
                      nameKey="name"
                      paddingAngle={3}
                    >
                      {pieCanali.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: 11 }}
                      formatter={(value, entry) => `${value} (${entry.payload?.pct})`}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Tabella riepilogo */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-4">
              Riepilogo Prenotazioni
              <span className="ml-2 text-xs font-normal text-gray-400">({prenotazioni.length} righe)</span>
            </h2>
            <Tabella rows={prenotazioni} />
          </div>
        </>
      )}

      {/* PageAssistant */}
      <PageAssistant
        pagina="prenotazioni-bi"
        systemContext={systemContext}
        suggerimenti={[
          'Quante prenotazioni no-show abbiamo avuto questo mese?',
          'Qual è il canale di prenotazione più usato?',
          'Confronta pranzo vs cena per coperti',
        ]}
      />
    </div>
  )
}
