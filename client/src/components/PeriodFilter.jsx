/**
 * PeriodFilter — filtro periodo standard per TUTTE le pagine del CRM.
 * Wrappa DateRangePicker e aggiunge: preset rapidi (Mese corrente, Mese precedente,
 * Ultimi 30gg, Trimestre, Anno corrente, Personalizzato), input Dal/Al, badge
 * con il periodo attivo (es. "01/06/2026 → 05/06/2026").
 *
 * Props:
 *   period   {string}   — preset attivo ('month', 'last_month', 'last30', 'quarter', 'ytd', 'custom', ...)
 *   dates    {object}   — { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 *   onChange(period, dates) — chiamata a ogni modifica; dates è SEMPRE { from, to } valorizzato
 *   extra    {node}     — contenuto opzionale (es. selettore sede) renderizzato a destra
 */
import React from 'react'
import { Calendar } from 'lucide-react'
import DateRangePicker, { periodToDates } from './DateRangePicker'

// Preset rapidi mostrati come bottoni (oltre al dropdown completo)
const QUICK_PRESETS = [
  { id: 'month',      label: 'Mese corrente' },
  { id: 'last_month', label: 'Mese prec.' },
  { id: 'last30',     label: 'Ultimi 30gg' },
  { id: 'quarter',    label: 'Trimestre' },
  { id: 'ytd',        label: 'Anno corrente' },
]

// Estende periodToDates con i preset extra (last30, quarter)
export function periodFilterToDates(id) {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  if (id === 'last30') {
    const d = new Date(now); d.setDate(d.getDate() - 29)
    return { from: fmt(d), to: fmt(now) }
  }
  if (id === 'quarter') {
    const q = Math.floor(now.getMonth() / 3)
    return { from: `${now.getFullYear()}-${pad(q * 3 + 1)}-01`, to: fmt(now) }
  }
  return periodToDates(id)
}

const fmtIt = s => (s || '').slice(0, 10).split('-').reverse().join('/')

export default function PeriodFilter({ period, dates, onChange, extra = null }) {
  const handlePreset = (pid) => {
    const d = periodFilterToDates(pid)
    if (d) onChange(pid, d)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-4">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Periodo</label>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangePicker period={period} dates={dates} onChange={(pid, d) => onChange(pid, d)} />
          {QUICK_PRESETS.map(p => (
            <button key={p.id} onClick={() => handlePreset(p.id)}
              className={`px-3 py-2 text-sm font-medium rounded-xl border transition-all ${
                period === p.id
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-400 hover:text-indigo-600'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Dal</label>
        <input type="date" value={dates?.from || ''}
          onChange={e => onChange('custom', { from: e.target.value, to: dates?.to || e.target.value })}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Al</label>
        <input type="date" value={dates?.to || ''}
          onChange={e => onChange('custom', { from: dates?.from || e.target.value, to: e.target.value })}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none" />
      </div>
      {dates?.from && dates?.to && (
        <span className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full bg-indigo-50 text-indigo-600 font-medium mb-1.5">
          <Calendar size={12} />
          {fmtIt(dates.from)} → {fmtIt(dates.to)}
        </span>
      )}
      {extra && <div className="ml-auto flex items-end gap-2">{extra}</div>}
    </div>
  )
}
