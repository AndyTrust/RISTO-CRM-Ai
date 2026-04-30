/**
 * DateRangePicker — componente condiviso per il selettore periodo/date
 * Usato da Dashboard, Chiusure, Venduto, KPI, Statistiche, Analytics, Fornitori
 */
import React, { useState, useRef, useEffect } from 'react'
import { Calendar, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'

// ── Presets disponibili ───────────────────────────────────────────────────
export const PERIODS = [
  { id: 'today',      label: 'Oggi' },
  { id: 'yesterday',  label: 'Ieri' },
  { id: 'last7',      label: 'Ultimi 7 gg' },
  { id: 'week',       label: 'Sett. corrente' },
  { id: 'last_week',  label: 'Sett. prec.' },
  { id: 'month',      label: 'Mese corrente' },
  { id: 'last_month', label: 'Mese prec.' },
  { id: 'ytd',        label: 'Anno corrente' },
  { id: 'custom',     label: 'Personalizzato' },
]

// ── Calcola date di inizio/fine da un preset ──────────────────────────────
export function periodToDates(id) {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const ieri = new Date(now); ieri.setDate(ieri.getDate()-1)
  switch (id) {
    case 'today':      return { from: fmt(now), to: fmt(now) }
    case 'yesterday':  return { from: fmt(ieri), to: fmt(ieri) }
    case 'last7': {
      const d = new Date(now); d.setDate(d.getDate()-6)
      return { from: fmt(d), to: fmt(now) }
    }
    case 'week': {
      const d = new Date(now); const day = d.getDay(); const diff = day===0?-6:1-day
      d.setDate(d.getDate()+diff)
      const toDate = fmt(now); const fromDate = fmt(d)
      return fromDate <= toDate ? { from: fromDate, to: toDate } : { from: fmt(ieri), to: fmt(ieri) }
    }
    case 'last_week': {
      const d = new Date(now); const day = d.getDay(); const diff = day===0?-6:1-day
      const lunediQuesta = new Date(d); lunediQuesta.setDate(d.getDate()+diff)
      const lunediScorsa = new Date(lunediQuesta); lunediScorsa.setDate(lunediQuesta.getDate()-7)
      const domScorsa = new Date(lunediQuesta); domScorsa.setDate(lunediQuesta.getDate()-1)
      return { from: fmt(lunediScorsa), to: fmt(domScorsa) }
    }
    case 'month': {
      const d = new Date(now.getFullYear(), now.getMonth(), 1)
      return { from: fmt(d), to: fmt(now) }
    }
    case 'last_month': {
      const d = new Date(now.getFullYear(), now.getMonth()-1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: fmt(d), to: fmt(end) }
    }
    case 'ytd': {
      const d = new Date(now.getFullYear(), 0, 1)
      return { from: fmt(d), to: fmt(now) }
    }
    case 'custom': return null
    default: {
      const d = new Date(now.getFullYear(), now.getMonth(), 1)
      return { from: fmt(d), to: fmt(now) }
    }
  }
}

// ── Mini calendario interattivo ───────────────────────────────────────────
function MiniCalendar({ from, to, onSelect }) {
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [hovered, setHovered] = useState(null)

  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`

  const firstDay = new Date(viewYear, viewMonth, 1)
  const lastDay  = new Date(viewYear, viewMonth + 1, 0)
  const startOffset = (firstDay.getDay() + 6) % 7
  const days = []
  for (let i = 0; i < startOffset; i++) days.push(null)
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(viewYear, viewMonth, d))

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y-1) }
    else setViewMonth(m => m-1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y+1) }
    else setViewMonth(m => m+1)
  }

  const handleDay = (d) => {
    if (!d) return
    const ds = fmt(d)
    if (!from || (from && to)) {
      onSelect({ from: ds, to: null })
    } else {
      if (ds < from) onSelect({ from: ds, to: from })
      else onSelect({ from, to: ds })
    }
  }

  const isFrom  = d => d && fmt(d) === from
  const isTo    = d => d && fmt(d) === to
  const inRange = d => {
    if (!d) return false
    const ds = fmt(d)
    const end = to || hovered
    if (from && end) return ds > from && ds < (end < from ? from : end)
    return false
  }
  const isHovEnd = d => d && !to && hovered && fmt(d) === hovered

  const MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
  const GIORNI = ['Lu','Ma','Me','Gi','Ve','Sa','Do']

  return (
    <div className="p-3 select-none">
      <div className="flex items-center justify-between mb-2">
        <button onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded-md transition-colors">
          <ChevronLeft size={14} className="text-gray-500" />
        </button>
        <span className="text-xs font-semibold text-gray-700">{MESI[viewMonth]} {viewYear}</span>
        <button onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded-md transition-colors">
          <ChevronRight size={14} className="text-gray-500" />
        </button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {GIORNI.map(g => (
          <div key={g} className="text-center text-[10px] font-medium text-gray-400 py-0.5">{g}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((d, i) => {
          if (!d) return <div key={i} />
          const ds = fmt(d)
          const isTod = ds === fmt(today)
          const isF = isFrom(d)
          const isT = isTo(d) || isHovEnd(d)
          const inR = inRange(d)
          return (
            <button
              key={i}
              onClick={() => handleDay(d)}
              onMouseEnter={() => { if (from && !to) setHovered(ds) }}
              onMouseLeave={() => setHovered(null)}
              className={`
                relative text-[11px] h-7 w-full flex items-center justify-center transition-all
                ${isF || isT ? 'z-10' : ''}
                ${isF ? 'bg-indigo-600 text-white rounded-l-full font-bold' : ''}
                ${isT ? 'bg-indigo-600 text-white rounded-r-full font-bold' : ''}
                ${isF && !to && !hovered ? 'rounded-full' : ''}
                ${inR ? 'bg-indigo-100 text-indigo-800' : ''}
                ${!isF && !isT && !inR ? (isTod ? 'text-indigo-600 font-bold' : 'text-gray-700 hover:bg-gray-100 rounded-full') : ''}
              `}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Dropdown panel interno ────────────────────────────────────────────────
function DatePickerPanel({ period, dates, onApply, onClose }) {
  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const now = new Date()

  const [customFrom, setCustomFrom] = useState(dates?.from || fmt(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [customTo, setCustomTo]     = useState(dates?.to   || fmt(now))
  const [activePeriod, setActivePeriod] = useState(period)
  const [calSel, setCalSel]         = useState({ from: dates?.from || null, to: dates?.to || null })
  const [showCal, setShowCal]       = useState(period === 'custom')

  const handlePreset = (pid) => {
    setActivePeriod(pid)
    if (pid === 'custom') { setShowCal(true); return }
    setShowCal(false)
    const d = periodToDates(pid)
    if (d) { onApply(pid, d); onClose() }
  }

  const handleCalSelect = ({ from, to }) => {
    setCalSel({ from, to })
    if (from) setCustomFrom(from)
    if (to)   setCustomTo(to)
  }

  const handleApplyCustom = () => {
    if (customFrom && customTo && customFrom <= customTo) {
      onApply('custom', { from: customFrom, to: customTo })
      onClose()
    }
  }

  return (
    <div className="flex divide-x divide-gray-100">
      <div className="py-1 min-w-[160px]">
        {PERIODS.map(p => (
          <button key={p.id} onClick={() => handlePreset(p.id)}
            className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2
              ${activePeriod === p.id
                ? 'text-indigo-600 bg-indigo-50 font-semibold'
                : 'text-gray-700 hover:bg-gray-50'}`}>
            {p.id === 'custom' && <Calendar size={12} className="text-gray-400 flex-shrink-0" />}
            {p.label}
          </button>
        ))}
      </div>
      {showCal && (
        <div className="flex flex-col">
          <MiniCalendar from={calSel.from} to={calSel.to} onSelect={handleCalSelect} />
          <div className="border-t border-gray-100 px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide block mb-0.5">Da</label>
                <input type="date" value={customFrom}
                  onChange={e => { setCustomFrom(e.target.value); setCalSel(s => ({ ...s, from: e.target.value })) }}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none" />
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide block mb-0.5">A</label>
                <input type="date" value={customTo}
                  onChange={e => { setCustomTo(e.target.value); setCalSel(s => ({ ...s, to: e.target.value })) }}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none" />
              </div>
            </div>
            <button onClick={handleApplyCustom}
              disabled={!customFrom || !customTo || customFrom > customTo}
              className="w-full px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              Applica periodo
            </button>
            {customFrom && customTo && customFrom > customTo && (
              <p className="text-[10px] text-red-500 text-center">Data inizio deve essere ≤ fine</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Componente pubblico: bottone trigger + dropdown ───────────────────────
/**
 * Props:
 *   period  {string}  — id preset attivo ('month', 'custom', ...)
 *   dates   {object}  — { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 *   onChange(period, dates) — callback quando l'utente cambia il periodo
 */
export default function DateRangePicker({ period, dates, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Chiudi cliccando fuori
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Label del bottone
  const currLabel = (() => {
    if (period === 'custom' && dates?.from && dates?.to) {
      const fmtShort = s => s?.slice(0,10).split('-').reverse().join('/')
      return `${fmtShort(dates.from)} → ${fmtShort(dates.to)}`
    }
    return PERIODS.find(p => p.id === period)?.label || 'Periodo'
  })()

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-indigo-400 hover:text-indigo-600 shadow-sm transition-all"
      >
        <Calendar size={14} className="text-indigo-500 flex-shrink-0" />
        <span>{currLabel}</span>
        <ChevronDown size={13} className={`text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden">
          <DatePickerPanel
            period={period}
            dates={dates}
            onApply={(pid, d) => onChange(pid, d)}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
