import useSedi from '../hooks/useSedi'
import React, { useState, useCallback, useEffect, useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  RefreshCw, Users, TrendingUp, DollarSign, Activity, User2,
  Calendar, MapPin, AlertCircle, PlusCircle, Trash2, Edit3, CheckCircle, X
} from 'lucide-react'
import { bustePaga as bp, employees as empApi } from '../api/client'
import PageAssistant from '../components/PageAssistant'

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS & UTILS
// ═══════════════════════════════════════════════════════════════════════════
// costo_azienda = paga_base (retr. mensile LUL) × 1.33 — salvato in Supabase dal LUL
// Fallback locale solo se il DB non ha ancora il valore
const COSTO_AZ_FALLBACK = 1.33
const EUR  = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const EUR0 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const NUM  = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 })

const fmtEur  = v => typeof v === 'number' && isFinite(v) ? EUR.format(v)  : '—'
const fmtEur0 = v => typeof v === 'number' && isFinite(v) ? EUR0.format(v) : '—'
const fmtNum  = v => typeof v === 'number' && isFinite(v) ? NUM.format(v)  : '—'

const MESI_SHORT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const MESI_FULL  = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                    'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']

// Sedi caricate dinamicamente da useSedi hook

function KpiCard({ label, value, sub, icon: Icon, color = 'blue' }) {
  const g = { blue: 'from-blue-500 to-blue-600', green: 'from-emerald-500 to-emerald-600',
              purple: 'from-purple-500 to-purple-600', amber: 'from-amber-500 to-amber-600' }
  return (
    <div className={`bg-gradient-to-br ${g[color]} rounded-lg p-5 text-white shadow-lg`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <p className="text-sm opacity-80 font-medium">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        {Icon && <Icon size={24} className="opacity-60" />}
      </div>
      {sub && <p className="text-xs opacity-70">{sub}</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MODALE AGGIUNGI CEDOLINO
// ═══════════════════════════════════════════════════════════════════════════
const PT_ORE_OPTS = [
  { label: '— Non specificato —', ore: '', sett: '' },
  { label: '160h/mese · FT 100%', ore: 160, sett: 40 },
  { label: '120h/mese · PT 75%',  ore: 120, sett: 30 },
  { label: '100h/mese · PT 62.5%',ore: 100, sett: 25 },
  { label: '80h/mese · PT 50%',   ore: 80,  sett: 20 },
]

function AddModal({ employees, onSave, onClose }) {
  const now = new Date()
  const [form, setForm] = useState({
    employee_id: '', employee_code: '', employee_name: '', sede: 'MA',
    anno: now.getFullYear(), mese: now.getMonth() + 1, netto: '',
    ore_mensili: '', ore_settimanali: '', percentuale_pt: '',
    file_name: '', note: ''
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const pickEmployee = (code) => {
    const e = employees.find(x => x.code === code)
    if (!e) { setForm(f => ({ ...f, employee_code: '', employee_name: '', sede: 'MA', employee_id: '' })); return }
    // Pre-popola anche ore dalle regole del dipendente se disponibili
    setForm(f => ({
      ...f,
      employee_id:    e.id      || '',
      employee_code:  e.code    || '',
      employee_name:  e.name    || '',
      sede:           e.sede    || 'MA',
      ore_mensili:    e.regole?.ore_contratto_mensili || e.ore_contratto_mensili || f.ore_mensili,
      ore_settimanali: e.regole?.ore_settimanali || e.ore_settimanali || f.ore_settimanali,
    }))
  }

  const pickOre = (ore) => {
    const opt = PT_ORE_OPTS.find(o => String(o.ore) === String(ore))
    if (!opt) return
    const PT_MAP = { 160: 100, 120: 75, 100: 62.5, 80: 50 }
    setForm(f => ({
      ...f,
      ore_mensili:    opt.ore,
      ore_settimanali: opt.sett,
      percentuale_pt:  PT_MAP[opt.ore] || '',
    }))
  }

  const handleSave = async () => {
    if (!form.employee_name) return setErr('Inserisci nome dipendente')
    if (!form.netto || parseFloat(form.netto) <= 0) return setErr('Inserisci netto > 0')
    setSaving(true); setErr(null)
    try {
      await onSave(form)
      onClose()
    } catch(e) { setErr(e.message || 'Errore salvataggio') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <h3 className="font-semibold text-white text-lg">Aggiungi Cedolino</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18}/></button>
        </div>
        <div className="p-5 space-y-3">
          {err && <div className="bg-red-900/30 border border-red-700 rounded p-2 text-red-300 text-sm">{err}</div>}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Dipendente (scegli dalla lista)</label>
            <select className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
              value={form.employee_code} onChange={e => pickEmployee(e.target.value)}>
              <option value="">— oppure inserisci manualmente —</option>
              {employees.map(e => <option key={e.id} value={e.code}>{e.name} ({e.sede})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Nome dipendente *</label>
              <input className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.employee_name} onChange={e => set('employee_name', e.target.value)} placeholder="NOME COGNOME"/>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Sede</label>
              <select className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.sede} onChange={e => set('sede', e.target.value)}>
                <option value="MA">MA — Sede MA</option>
                <option value="PN">PN — Sede PN</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Anno</label>
              <select className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.anno} onChange={e => set('anno', parseInt(e.target.value))}>
                {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Mese</label>
              <select className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.mese} onChange={e => set('mese', parseInt(e.target.value))}>
                {MESI_FULL.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Netto (€) *</label>
              <input type="number" step="0.01" min="0"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.netto} onChange={e => set('netto', e.target.value)} placeholder="es. 1250.00"/>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">File PDF (nome)</label>
              <input className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.file_name} onChange={e => set('file_name', e.target.value)} placeholder="cedolino_gen.pdf"/>
            </div>
          </div>
          {/* Ore contratto */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Ore contratto</label>
            <select className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
              value={form.ore_mensili || ''} onChange={e => pickOre(e.target.value)}>
              {PT_ORE_OPTS.map(o => <option key={o.ore} value={o.ore}>{o.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Ore mensili</label>
              <input type="number" min="0" max="200"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.ore_mensili || ''} onChange={e => set('ore_mensili', e.target.value)} placeholder="160"/>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Ore settimanali</label>
              <input type="number" min="0" max="40"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.ore_settimanali || ''} onChange={e => set('ore_settimanali', e.target.value)} placeholder="40"/>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Note</label>
            <textarea className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm resize-none" rows={2}
              value={form.note} onChange={e => set('note', e.target.value)}/>
          </div>
        </div>
        <div className="flex gap-3 p-5 pt-0">
          <button onClick={onClose} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm font-medium">Annulla</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
            {saving ? <RefreshCw size={14} className="animate-spin"/> : <CheckCircle size={14}/>}
            {saving ? 'Salvataggio...' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — RIEPILOGO
// ═══════════════════════════════════════════════════════════════════════════
function RiepilogoTab({ anno, mese, sedeFilter, riepilogo }) {
  const filtered = useMemo(() => {
    if (!riepilogo) return []
    let data = sedeFilter === 'Tutte' ? riepilogo : riepilogo.filter(r => r.sede === sedeFilter)
    if (mese > 0) data = data.filter(r => r.mese === mese)
    return data
  }, [riepilogo, sedeFilter, mese])

  const periodoLabel = mese > 0 ? `${MESI_FULL[mese - 1]} ${anno}` : `Anno ${anno}`

  const kpis = useMemo(() => {
    const totNetto = filtered.reduce((s, r) => s + (r.totale_netto || 0), 0)
    const totCosto = filtered.reduce((s, r) => s + (r.totale_costo || 0), 0)
    const nDip = Math.max(...filtered.map(r => r.n_dipendenti || 0), 0)
    return { totNetto, totCosto, nDip, media: nDip > 0 ? totNetto / nDip : 0 }
  }, [filtered])

  const chartData = useMemo(() => {
    const byMese = {}
    for (const r of filtered) {
      const k = `${r.anno}-${String(r.mese).padStart(2,'0')}`
      if (!byMese[k]) byMese[k] = { label: `${MESI_SHORT[r.mese-1]} ${r.anno}`, netto: 0, costoAz: 0 }
      byMese[k].netto  += r.totale_netto || 0
      byMese[k].costoAz += r.totale_costo || 0
    }
    return Object.entries(byMese).sort().map(([,v]) => v)
  }, [filtered])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Totale Netto" value={fmtEur0(kpis.totNetto)} sub={periodoLabel} icon={DollarSign} color="green"/>
        <KpiCard label="Costo Aziendale" value={fmtEur0(kpis.totCosto)} sub="paga_base × 1.33 (RAL-based)" icon={TrendingUp} color="purple"/>
        <KpiCard label="N. Dipendenti" value={fmtNum(kpis.nDip)} sub={periodoLabel} icon={Users} color="blue"/>
        <KpiCard label="Media Dipendente" value={fmtEur0(kpis.media)} sub="Netto medio" icon={User2} color="amber"/>
      </div>
      {chartData.length > 0 && (
        <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
          <h3 className="text-lg font-semibold mb-4 text-white">Costi Mensili</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151"/>
              <XAxis dataKey="label" stroke="#9ca3af" tick={{ fontSize: 12 }}/>
              <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }}/>
              <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
                labelStyle={{ color: '#fff' }} formatter={v => fmtEur0(v)}/>
              <Legend/>
              <Bar dataKey="netto"  fill="#10b981" name="Netto"/>
              <Bar dataKey="costoAz" fill="#8b5cf6" name="Costo Aziendale"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {filtered.length === 0 && <p className="text-gray-400 text-center py-12">Nessun dato. Aggiungi i cedolini dalla tab "Dettaglio".</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — STATO DIPENDENTI
// ═══════════════════════════════════════════════════════════════════════════
function StatoDipendentiTab({ statoDipendenti, sedeFilter }) {
  const filtered = useMemo(() => {
    if (!statoDipendenti) return []
    return (sedeFilter === 'Tutte' ? statoDipendenti : statoDipendenti.filter(e => e.location === sedeFilter))
      .sort((a, b) => {
        if (a.attivo !== b.attivo) return b.attivo - a.attivo
        return (a.employee_name || '').localeCompare(b.employee_name || '')
      })
  }, [statoDipendenti, sedeFilter])

  return (
    <div className="space-y-4">
      {/* Nota logica attivo */}
      <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg px-4 py-2.5 text-xs text-blue-300 flex items-center gap-2">
        <Users size={13} className="flex-shrink-0"/>
        Dipendenti dalla tabella buste paga — <strong className="text-white">Attivi</strong> = presenti nell'ultimo mese di cedolino caricato
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Attivi" value={fmtNum(filtered.filter(e => e.attivo).length)} color="green"/>
        <KpiCard label="Non più in organico" value={fmtNum(filtered.filter(e => !e.attivo).length)} color="amber"/>
        <KpiCard label="Totale storico" value={fmtNum(filtered.length)} color="blue"/>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((emp, i) => (
          <div key={i} className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h4 className="font-semibold text-white">{emp.employee_name}</h4>
                <p className="text-xs text-gray-400">{emp.location || '—'}</p>
              </div>
              <span className={`px-2 py-1 rounded text-xs font-semibold ${emp.attivo ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700' : 'bg-gray-700/60 text-gray-400 border border-gray-600'}`}>
                {emp.attivo ? 'Attivo' : 'Ex dipendente'}
              </span>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-gray-400">Ultimo cedolino:</span><span className="text-white">{emp.ultimo_mese_label ? `${emp.ultimo_mese_label} ${emp.ultimo_anno}` : '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">N. cedolini:</span><span className="text-white">{emp.totale_buste || 0}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Totale netto:</span><span className="text-emerald-400 font-medium">{fmtEur(emp.totale_netto)}</span></div>
            </div>
          </div>
        ))}
      </div>
      {filtered.length === 0 && <p className="text-gray-400 text-center py-12">Nessun dipendente trovato.</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — COSTO PERSONALE
// ═══════════════════════════════════════════════════════════════════════════
function CostoPersonaleTab({ costoMensile, sedeFilter }) {
  const chartData = useMemo(() => {
    if (!costoMensile) return []
    return (sedeFilter === 'Tutte' ? costoMensile : costoMensile.filter(c => c.sede === sedeFilter))
      .sort((a, b) => `${a.anno}${String(a.mese).padStart(2,'0')}`.localeCompare(`${b.anno}${String(b.mese).padStart(2,'0')}`))
      .map(c => ({ label: `${MESI_SHORT[c.mese-1]} ${c.anno}`, netto: c.netto_totale || 0, costoAz: c.costo_totale || 0 }))
  }, [costoMensile, sedeFilter])

  const stats = useMemo(() => {
    if (!chartData.length) return { avg: 0, max: 0, min: 0 }
    const netti = chartData.map(c => c.netto)
    return { avg: netti.reduce((a,b) => a+b, 0)/netti.length, max: Math.max(...netti), min: Math.min(...netti) }
  }, [chartData])

  return (
    <div className="space-y-6">
      <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4 flex gap-2">
        <AlertCircle size={18} className="text-blue-400 flex-shrink-0 mt-0.5"/>
        <div className="text-sm text-blue-300"><p className="font-medium">Costo Aziendale: paga base (LUL) × 1.33</p><p className="text-xs mt-0.5 opacity-80">Contributi INPS c/ditta ~33% — estratto dal LUL PDF</p></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Media Mensile" value={fmtEur0(stats.avg)} color="green"/>
        <KpiCard label="Massimo Mensile" value={fmtEur0(stats.max)} color="purple"/>
        <KpiCard label="Minimo Mensile" value={fmtEur0(stats.min)} color="amber"/>
      </div>
      {chartData.length > 0 && (
        <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
          <h3 className="text-lg font-semibold mb-4 text-white">Trend Costi</h3>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151"/>
              <XAxis dataKey="label" stroke="#9ca3af" tick={{ fontSize: 12 }}/>
              <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }}/>
              <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
                labelStyle={{ color: '#fff' }} formatter={v => fmtEur0(v)}/>
              <Legend/>
              <Line type="monotone" dataKey="netto"  stroke="#10b981" name="Netto" strokeWidth={2} dot={{ r: 4 }}/>
              <Line type="monotone" dataKey="costoAz" stroke="#8b5cf6" name="Costo Aziendale" strokeWidth={2} dot={{ r: 4 }}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {chartData.length === 0 && <p className="text-gray-400 text-center py-12">Nessun dato disponibile.</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — DETTAGLIO CEDOLINI
// ═══════════════════════════════════════════════════════════════════════════
function DettaglioCedoliniTab({ cedolini, sedeFilter, meseFilter, onRefresh, employees }) {
  const [search, setSearch]     = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editNetto, setEditNetto] = useState('')
  const [saving, setSaving]     = useState(null)
  const [showAdd, setShowAdd]   = useState(false)
  const [deleting, setDeleting] = useState(null)

  const filtered = useMemo(() => {
    if (!cedolini) return []
    return cedolini.filter(c => {
      if (sedeFilter !== 'Tutte' && c.sede !== sedeFilter) return false
      if (meseFilter > 0 && c.mese !== meseFilter) return false
      if (search && !(c.employee_name || '').toLowerCase().includes(search.toLowerCase())) return false
      return true
    }).sort((a, b) => {
      const pA = a.anno*100 + a.mese, pB = b.anno*100 + b.mese
      return pB - pA || (a.employee_name || '').localeCompare(b.employee_name || '')
    })
  }, [cedolini, sedeFilter, meseFilter, search])

  const saveNetto = async (id) => {
    setSaving(id)
    try {
      await bp.update(id, { netto: parseFloat(editNetto) })
      setEditingId(null); setEditNetto('')
      onRefresh()
    } catch(e) { console.error(e) }
    finally { setSaving(null) }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Eliminare questo cedolino?')) return
    setDeleting(id)
    try { await bp.delete(id); onRefresh() }
    catch(e) { console.error(e) }
    finally { setDeleting(null) }
  }

  return (
    <div className="space-y-4">
      {showAdd && <AddModal employees={employees} onSave={d => bp.insert(d).then(() => onRefresh())} onClose={() => setShowAdd(false)}/>}
      <div className="flex gap-3 items-center">
        <input type="text" placeholder="Cerca dipendente..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <PlusCircle size={16}/> Aggiungi
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-800">
            <tr className="border-b border-gray-700">
              <th className="px-4 py-3 text-left font-semibold text-gray-300">Dipendente</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-300">Sede</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-300">Mese</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-300">Netto</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-300">Costo Az.</th>
              <th className="px-4 py-3 text-center font-semibold text-gray-300">File</th>
              <th className="px-4 py-3 text-center font-semibold text-gray-300">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => {
              const netto   = c.netto || 0
              const costoAz = c.costo_azienda || +(netto * COSTO_AZ_FALLBACK).toFixed(2)
              return (
                <tr key={c.id || i} className="border-b border-gray-700 hover:bg-gray-800/50 transition">
                  <td className="px-4 py-3 text-white font-medium">{c.employee_name}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-semibold ${c.sede === 'MA' ? 'bg-red-900/30 text-red-300' : 'bg-blue-900/30 text-blue-300'}`}>{c.sede}</span></td>
                  <td className="px-4 py-3 text-gray-300">{MESI_FULL[(c.mese||1)-1]} {c.anno}</td>
                  <td className="px-4 py-3 text-right">
                    {editingId === c.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <input type="number" step="0.01" min="0" autoFocus
                          value={editNetto} onChange={e => setEditNetto(e.target.value)}
                          onKeyDown={e => { if(e.key==='Enter') saveNetto(c.id); if(e.key==='Escape') setEditingId(null) }}
                          className="w-24 bg-gray-700 border border-blue-500 rounded px-2 py-0.5 text-white text-xs"/>
                        <button onClick={() => saveNetto(c.id)} disabled={saving===c.id} className="text-emerald-400 hover:text-emerald-300 text-xs font-bold px-1">✓</button>
                        <button onClick={() => setEditingId(null)} className="text-gray-500 hover:text-gray-300 text-xs px-1">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingId(c.id); setEditNetto(netto || '') }}
                        className={`font-medium ${netto > 0 ? 'text-emerald-400 hover:text-emerald-300' : 'text-gray-500 italic hover:text-blue-400'} transition-colors`}
                        title="Clicca per modificare">
                        {netto > 0 ? fmtEur(netto) : '+ inserisci netto'}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-purple-400">{costoAz > 0 ? fmtEur(costoAz) : '—'}</td>
                  <td className="px-4 py-3 text-center text-xs text-gray-500">{c.file_name || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => handleDelete(c.id)} disabled={deleting === c.id}
                      className="text-gray-600 hover:text-red-400 transition-colors" title="Elimina">
                      {deleting === c.id ? <RefreshCw size={14} className="animate-spin"/> : <Trash2 size={14}/>}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && <p className="text-gray-400 text-center py-12">Nessun cedolino. Usa "Aggiungi" per inserirne uno.</p>}
      {filtered.length > 0 && <p className="text-xs text-gray-500 text-center">Totale: {filtered.length} cedolini</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════
export default function BustePaga({ startTab = 'riepilogo' }) {
  const { sedi }                      = useSedi()
  const [anno,        setAnno]        = useState(new Date().getFullYear())
  const [meseFilter,  setMeseFilter]  = useState(0) // 0 = tutti i mesi
  const [sedeFilter,  setSedeFilter]  = useState('Tutte')
  const [activeTab,   setActiveTab]   = useState(startTab)
  const [riepilogo,   setRiepilogo]   = useState([])
  const [statoDip,    setStatoDip]    = useState([])
  const [costoMensile,setCostoMensile] = useState([])
  const [cedolini,    setCedolini]    = useState([])
  const [employees,   setEmployees]   = useState([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [ried, stato, costo, ced, emps] = await Promise.all([
        bp.riepilogo({ anno }),
        bp.statoDipendenti(),
        bp.costoMensile({ anno }),
        bp.getAll({ anno }),
        empApi.getAll({ active: 'true' }),
      ])
      setRiepilogo(ried)
      setStatoDip(stato)
      setCostoMensile(costo)
      setCedolini(ced)
      setEmployees(emps.map(e => ({ ...e, sede: e.sede || (e.location === 'MAMELI' ? 'MA' : 'PN') })))
    } catch(e) {
      setError(e.message || 'Errore caricamento dati')
    } finally { setLoading(false) }
  }, [anno])

  useEffect(() => { loadData() }, [loadData])

  // ── Cross-page reactivity: ricarica se un'altra tab modifica un dipendente ─
  useEffect(() => {
    const onStorage = (e) => { if (e.key === 'crm_employee_updated') loadData() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [loadData])

  const TABS = [
    { id: 'riepilogo', label: 'Riepilogo' },
    { id: 'stato',     label: 'Dipendenti' },
    { id: 'costo',     label: 'Costo Personale' },
    { id: 'dettaglio', label: 'Dettaglio Cedolini' },
  ]

  return (
    <>
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3"><Activity size={28}/> Buste Paga</h1>
            <p className="text-gray-400 mt-1">Gestione cedolini e costi personale</p>
          </div>
          <button onClick={loadData} disabled={loading}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white px-4 py-2 rounded-lg font-medium transition-colors">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>
            {loading ? 'Caricamento...' : 'Aggiorna'}
          </button>
        </div>

        {error && (
          <div className="mb-6 bg-red-900/20 border border-red-800 rounded-lg p-4 flex gap-3">
            <AlertCircle size={20} className="text-red-400 flex-shrink-0"/>
            <div className="text-red-300 text-sm">{error}</div>
          </div>
        )}

        {/* Filtri */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2"><Calendar size={14}/> Anno</label>
            <select value={anno} onChange={e => setAnno(Number(e.target.value))}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {[2023,2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2"><Calendar size={14}/> Mese</label>
            <select value={meseFilter} onChange={e => setMeseFilter(Number(e.target.value))}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value={0}>Tutti i mesi</option>
              {['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'].map((m,i) =>
                <option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2"><MapPin size={14}/> Sede</label>
            <select value={sedeFilter} onChange={e => setSedeFilter(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="Tutte">Tutte le sedi</option>
              {sedi.map(s => <option key={s.codice} value={s.codice}>{s.nome}</option>)}
            </select>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap gap-2">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${activeTab === t.id ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === 'riepilogo'  && <RiepilogoTab anno={anno} mese={meseFilter} sedeFilter={sedeFilter} riepilogo={riepilogo}/>}
        {activeTab === 'stato'      && <StatoDipendentiTab statoDipendenti={statoDip} sedeFilter={sedeFilter}/>}
        {activeTab === 'costo'      && <CostoPersonaleTab costoMensile={costoMensile} sedeFilter={sedeFilter}/>}
        {activeTab === 'dettaglio'  && <DettaglioCedoliniTab cedolini={cedolini} sedeFilter={sedeFilter} meseFilter={meseFilter} onRefresh={loadData} employees={employees}/>}
      </div>
    </div>
      <PageAssistant
        pagina="Buste Paga"
        suggerimenti={[
          "Qual è il costo totale del personale questo mese?",
          "Mostrami i cedolini di marzo 2026",
          "Differenza costo azienda vs netto dipendenti",
        ]}
      />
    </>
  )
}