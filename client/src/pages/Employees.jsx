import React, { useEffect, useState, useMemo } from 'react'
import {
  employees as empApi, venduto as vendutoApi, turni as turniApi,
  admin as adminApi, operatorMapping as mappingApi, repartiApi,
} from '../api/client'
import supabase from '../supabase'
import {
  UserPlus, Power, Pencil, X, Check, Users, Search,
  ArrowLeftRight, Calendar, MapPin, TrendingUp, ChevronRight,
  Link2, AlertCircle, CheckCircle2, RefreshCw, Trash2,
  CheckSquare, Square, GitMerge, Tag, Filter, ChevronDown,
} from 'lucide-react'
import PageAssistant from '../components/PageAssistant'

// ─── Costanti ──────────────────────────────────────────────────────────────
const SEDE_LABEL  = { MA: 'Sede MA', PN: 'Sede PN' }
const SEDE_COLOR  = { MA: 'bg-blue-100 text-blue-700', PN: 'bg-emerald-100 text-emerald-700' }
const SEDE_BORDER = { MA: 'border-blue-200', PN: 'border-emerald-200' }
const CCNL_MULT   = 1.9653   // netto → costo azienda

const RUOLI_DEFAULT = [
  'Responsabile','Cameriere','Commis','Cuoco','Aiuto Cuoco','Chef',
  'Lavapiatti','Barista','Cassiere','Manager','Amministrazione','Altro',
]

function Avatar({ name, color }) {
  return (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
      style={{ backgroundColor: color || '#6366f1' }}
    >
      {name?.charAt(0) || '?'}
    </div>
  )
}

// Helper conversione ore ↔ % per il form
const ORE_MENSILI_REF = 160   // FT = 160h/mese, 40h/sett
const ORE_SETT_REF   = 40
function oreToPercent(ore) {
  if (!ore) return ''
  return parseFloat((ore / ORE_MENSILI_REF * 100).toFixed(4))
}
function percentToOre(pct) {
  if (!pct) return ''
  return Math.round(pct / 100 * ORE_MENSILI_REF)
}
function percentToSett(pct) {
  if (!pct) return ''
  return Math.round(pct / 100 * ORE_SETT_REF)
}
function oreToSett(ore) {
  if (!ore) return ''
  return Math.round(ore / ORE_MENSILI_REF * ORE_SETT_REF)
}

// ─── Modal: Modifica / Nuovo dipendente ────────────────────────────────────
function EmployeeForm({ initial, reparti, ruoliDB, onSave, onClose }) {
  // Leggi i valori ore dalle regole in initial (non da initial direttamente, che è il record employees)
  const initOreMensili = initial?.regole?.ore_contratto_mensili ?? initial?.ore_contratto_mensili ?? ''
  const initOreSett    = initial?.regole?.ore_settimanali       ?? initial?.ore_settimanali       ?? ''
  const initPct        = initOreMensili ? oreToPercent(initOreMensili) : ''

  const [form, setForm] = useState({
    name: '', role: 'Cameriere', sede: 'MA',
    hire_date: '', notes: '', reparto_id: '', buste_paga_name: '',
    sede_split_ma: 100,
    ...initial,
    // Ore: sovrascriviamo DOPO ...initial per evitare undefined da employee row
    ore_contratto_mensili: initOreMensili,
    ore_settimanali:       initOreSett,
    percentuale_pt:        initPct,
  })
  const [saving, setSaving]   = useState(false)
  const [saveErr, setSaveErr] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Aggiorna tutti e tre i campi ore in sincronia
  const setOreFromMensili = (oreMens) => {
    const ore = parseInt(oreMens) || ''
    setForm(f => ({
      ...f,
      ore_contratto_mensili: ore,
      ore_settimanali:       ore ? oreToSett(ore) : '',
      percentuale_pt:        ore ? oreToPercent(ore) : '',
    }))
  }
  const setOreFromSett = (oreSett) => {
    const sett = parseInt(oreSett) || ''
    const ore  = sett ? Math.round(sett * ORE_MENSILI_REF / ORE_SETT_REF) : ''
    setForm(f => ({
      ...f,
      ore_settimanali:       sett,
      ore_contratto_mensili: ore,
      percentuale_pt:        ore ? oreToPercent(ore) : '',
    }))
  }
  const setOreFromPercent = (pctStr) => {
    // Permetti digitazione libera (es. "62.5") — aggiorna gli altri solo se è un numero valido
    const pct = parseFloat(pctStr)
    if (!isNaN(pct) && pct > 0) {
      setForm(f => ({
        ...f,
        percentuale_pt:        pctStr,
        ore_contratto_mensili: percentToOre(pct),
        ore_settimanali:       percentToSett(pct),
      }))
    } else {
      set('percentuale_pt', pctStr)
    }
  }

  // Ruoli: dal DB se disponibili, altrimenti default
  const allRoles = ruoliDB?.length > 0
    ? ruoliDB.map(r => r.name)
    : RUOLI_DEFAULT

  const ROLES_BY_REPARTO = form.reparto_id
    ? (reparti.find(r => r.id === form.reparto_id)?.ruoli?.length
        ? reparti.find(r => r.id === form.reparto_id).ruoli
        : allRoles)
    : allRoles

  const doSave = async () => {
    setSaving(true); setSaveErr(null)
    try {
      await onSave(form)
    } catch(err) {
      setSaveErr(err?.message || 'Errore durante il salvataggio')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-lg">{initial?.id ? 'Modifica dipendente' : 'Nuovo dipendente'}</h3>
          <button onClick={onClose} className="btn-ghost p-1"><X size={18} /></button>
        </div>

        {saveErr && (
          <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-2">
            <AlertCircle size={15} className="mt-0.5 shrink-0"/>
            <span>{saveErr}</span>
          </div>
        )}

        <div className="space-y-3">
          {/* Nome */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Nome *</label>
            <input className="input" value={form.name}
              onChange={e => set('name', e.target.value.toUpperCase())}
              placeholder="Es. MARIO ROSSI" />
          </div>
          {/* Nome buste paga */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">
              Nome buste paga <span className="text-gray-400">(se diverso dal nome principale)</span>
            </label>
            <input className="input" value={form.buste_paga_name || ''}
              onChange={e => set('buste_paga_name', e.target.value.toUpperCase())}
              placeholder="Es. MARIO (nome breve usato nei cedolini)" />
          </div>
          {/* Reparto + Sede */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Reparto</label>
              <select className="select" value={form.reparto_id || ''}
                onChange={e => set('reparto_id', e.target.value || null)}>
                <option value="">— Nessun reparto —</option>
                {reparti.map(r => <option key={r.id} value={r.id}>{r.icona} {r.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Locale *</label>
              <select className="select" value={form.sede} onChange={e => set('sede', e.target.value)}>
                <option value="MA">Sede MA (Mameli)</option>
                <option value="PN">Sede PN (Predda Niedda)</option>
              </select>
            </div>
          </div>
          {/* Ruolo */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Ruolo *</label>
            <select className="select" value={form.role} onChange={e => set('role', e.target.value)}>
              {ROLES_BY_REPARTO.map(r => <option key={r}>{r}</option>)}
              {!ROLES_BY_REPARTO.includes(form.role) && <option>{form.role}</option>}
            </select>
          </div>
          {/* Split sedi */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">
              Ripartizione costo sedi
              <span className="ml-1 text-gray-400">({form.sede_split_ma ?? 100}% MA · {100 - (form.sede_split_ma ?? 100)}% PN)</span>
            </label>
            <input type="range" min="0" max="100" step="10"
              className="w-full accent-violet-600"
              value={form.sede_split_ma ?? 100}
              onChange={e => set('sede_split_ma', parseInt(e.target.value))} />
            <div className="flex justify-between text-xs text-gray-400 mt-0.5">
              <span>100% PN</span><span>50/50</span><span>100% MA</span>
            </div>
          </div>

          {/* ── Ore contratto (bidirezionale ↔) ─────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">Ore contratto</label>
              <span className="text-xs text-gray-400 italic">modifica uno → gli altri si aggiornano</span>
            </div>
            {/* Preset rapidi */}
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {[
                { label: 'FT 100%', ore: 160, sett: 40, pct: 100 },
                { label: 'PT 75%',  ore: 120, sett: 30, pct: 75 },
                { label: 'PT 62.5%',ore: 100, sett: 25, pct: 62.5 },
                { label: 'PT 50%',  ore: 80,  sett: 20, pct: 50 },
              ].map(p => (
                <button key={p.label} type="button"
                  onClick={() => setForm(f => ({ ...f, ore_contratto_mensili: p.ore, ore_settimanali: p.sett, percentuale_pt: p.pct }))}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors font-medium
                    ${form.ore_contratto_mensili === p.ore
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-violet-400 hover:text-violet-600'}`}>
                  {p.label}
                </button>
              ))}
              <button type="button"
                onClick={() => setForm(f => ({ ...f, ore_contratto_mensili: '', ore_settimanali: '', percentuale_pt: '' }))}
                className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors">
                ✕ pulisci
              </button>
            </div>
            {/* Tre input sincroni */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] text-gray-400 mb-1 block text-center">% Part-time</label>
                <div className="relative">
                  <input type="number" step="0.1" min="0" max="100"
                    className="input text-center pr-5 text-sm font-medium"
                    value={form.percentuale_pt ?? ''}
                    onChange={e => setOreFromPercent(e.target.value)}
                    onBlur={e => {
                      const pct = parseFloat(e.target.value)
                      if (!isNaN(pct)) setOreFromPercent(String(pct))
                    }}
                    placeholder="62.5" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                </div>
              </div>
              <div>
                <label className="text-[11px] text-gray-400 mb-1 block text-center">Ore / mese</label>
                <div className="relative">
                  <input type="number" step="1" min="0" max="200"
                    className="input text-center pr-5 text-sm font-medium"
                    value={form.ore_contratto_mensili ?? ''}
                    onChange={e => setOreFromMensili(e.target.value)}
                    placeholder="100" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">h</span>
                </div>
              </div>
              <div>
                <label className="text-[11px] text-gray-400 mb-1 block text-center">Ore / sett</label>
                <div className="relative">
                  <input type="number" step="1" min="0" max="40"
                    className="input text-center pr-5 text-sm font-medium"
                    value={form.ore_settimanali ?? ''}
                    onChange={e => setOreFromSett(e.target.value)}
                    placeholder="25" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">h</span>
                </div>
              </div>
            </div>
          </div>

          {/* Data assunzione + Note */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Data assunzione</label>
              <input type="date" className="input" value={form.hire_date || ''}
                onChange={e => set('hire_date', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Note</label>
              <input className="input" value={form.notes || ''} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} disabled={saving} className="btn-secondary flex-1">Annulla</button>
          <button onClick={doSave} disabled={!form.name.trim() || saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
            {saving
              ? <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Salvataggio...</>
              : <><Check size={16} /> Salva</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Inserimento turno rapido ──────────────────────────────────────
function TurnoRapidoModal({ emp, onClose, onSaved }) {
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({ date: today, turno: 'Cena', ore: '8', note: '' })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await turniApi.create({
        employee_name: emp.name,
        employee_code: emp.code || null,
        sede: emp.sede,
        data: form.date,
        turno: form.turno,
        ore_lavorate: parseFloat(form.ore) || 0,
        notes: form.note,
        ruolo: emp.role,
      })
      setTimeout(() => { onSaved(); onClose() }, 400)
    } catch (err) {
      alert('Errore salvataggio: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const TURNO_TIPI = ['Pranzo','Cena','Intero','Split','Riposo','Ferie','Malattia']
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-base">Inserisci turno</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {emp.name} · <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${SEDE_COLOR[emp.sede]}`}>{SEDE_LABEL[emp.sede]}</span>
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Data</label>
            <input type="date" className="input" value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Tipo turno</label>
              <select className="select" value={form.turno} onChange={e => set('turno', e.target.value)}>
                {TURNO_TIPI.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Ore lavorate</label>
              <input type="number" min="0" max="16" step="0.5" className="input" value={form.ore}
                onChange={e => set('ore', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Note (opzionale)</label>
            <input className="input" value={form.note} onChange={e => set('note', e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary flex-1">Annulla</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
            {saving ? 'Salvo...' : <><Calendar size={15} /> Salva turno</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Assegna Reparto in bulk ──────────────────────────────────────
function BulkRepartoModal({ count, reparti, onAssign, onClose }) {
  const [repartoId, setRepartoId] = useState('')
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h3 className="font-semibold mb-1">Assegna reparto</h3>
        <p className="text-sm text-gray-500 mb-4">{count} dipendenti selezionati</p>
        <select className="select w-full" value={repartoId} onChange={e => setRepartoId(e.target.value)}>
          <option value="">— Rimuovi reparto —</option>
          {reparti.map(r => <option key={r.id} value={r.id}>{r.icona} {r.nome}</option>)}
        </select>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="btn-secondary flex-1">Annulla</button>
          <button onClick={() => onAssign(repartoId || null)} className="btn-primary flex-1">
            <Check size={15} /> Assegna
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Merge duplicati ───────────────────────────────────────────────
function MergeModal({ pair, onMerge, onClose }) {
  const [keepId, setKeepId] = useState(pair[0].id)
  const keep   = pair.find(e => e.id === keepId)
  const remove = pair.find(e => e.id !== keepId)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h3 className="font-semibold mb-1 flex items-center gap-2">
          <GitMerge size={16} className="text-violet-600"/> Unisci dipendenti duplicati
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          Scegli quale profilo tenere. L'altro verrà disattivato e i dati vengono collegati.
        </p>
        <div className="space-y-2 mb-4">
          {pair.map(emp => (
            <label key={emp.id}
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${
                keepId === emp.id ? 'border-violet-400 bg-violet-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <input type="radio" checked={keepId === emp.id} onChange={() => setKeepId(emp.id)} className="accent-violet-600"/>
              <div className="flex-1">
                <p className="font-semibold text-gray-800">{emp.name}</p>
                <p className="text-xs text-gray-500">{emp.role} · {SEDE_LABEL[emp.sede]} · assunto {emp.hire_date || '—'}</p>
                {emp.venduto && (
                  <p className="text-xs text-emerald-600 mt-0.5">
                    {emp.venduto.coperti} cop · CM €{emp.venduto.coperto_medio?.toFixed(2)}
                  </p>
                )}
              </div>
              {keepId === emp.id && <span className="text-xs bg-violet-600 text-white px-2 py-0.5 rounded-full">✓ Tengo</span>}
            </label>
          ))}
        </div>
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-4">
          ⚠️ <strong>{remove?.name}</strong> verrà disattivato. Il campo "Nome buste paga" di <strong>{keep?.name}</strong> verrà impostato su <strong>{remove?.name}</strong> per mantenere il collegamento ai cedolini.
        </p>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">Annulla</button>
          <button onClick={() => onMerge(keep, remove)} className="btn-primary flex-1 bg-violet-600">
            <GitMerge size={14}/> Unisci
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Bulk Actions Bar ─────────────────────────────────────────────────────
function BulkActionsBar({ count, onActivate, onDeactivate, onTransferMA, onTransferPN, onReparto, onMerge, onClear }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-gray-900 text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 flex-wrap animate-in">
      <span className="font-semibold text-sm text-violet-300">{count} selezionati</span>
      <div className="w-px h-5 bg-gray-700"/>
      {count === 2 && (
        <button onClick={onMerge} className="text-xs px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 transition flex items-center gap-1.5 font-semibold">
          <GitMerge size={13}/> Unisci i 2
        </button>
      )}
      <button onClick={onActivate} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 transition flex items-center gap-1.5">
        <Power size={13}/> Attiva
      </button>
      <button onClick={onDeactivate} className="text-xs px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 transition flex items-center gap-1.5">
        <Power size={13}/> Disattiva
      </button>
      <button onClick={onTransferMA} className="text-xs px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 transition flex items-center gap-1.5">
        <MapPin size={13}/> → MA
      </button>
      <button onClick={onTransferPN} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 transition flex items-center gap-1.5">
        <MapPin size={13}/> → PN
      </button>
      <button onClick={onReparto} className="text-xs px-3 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-600 transition flex items-center gap-1.5">
        <Tag size={13}/> Reparto
      </button>
      <button onClick={onClear} className="ml-2 p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 transition">
        <X size={14}/>
      </button>
    </div>
  )
}

// ─── Gestione Ruoli Modal ─────────────────────────────────────────────────
function RuoliModal({ ruoli, onClose, onRefresh }) {
  const [nuovoRuolo, setNuovoRuolo]   = useState('')
  const [nuovoColore, setNuovoColore] = useState('#6366f1')
  const [descrizione, setDescrizione] = useState('')
  const [saving, setSaving]           = useState(false)
  const [deleting, setDeleting]       = useState(null)

  const COLORI = ['#6366f1','#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#f97316','#06b6d4','#ec4899','#6b7280']

  const handleAdd = async () => {
    if (!nuovoRuolo.trim()) return
    setSaving(true)
    try {
      await supabase.from('roles').insert({ name: nuovoRuolo.trim(), color: nuovoColore, description: descrizione || null })
      setNuovoRuolo(''); setDescrizione('')
      onRefresh()
    } catch(e) { alert('Errore: '+e.message) }
    setSaving(false)
  }

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Eliminare il ruolo "${name}"? I dipendenti che lo usano non verranno modificati.`)) return
    setDeleting(id)
    try {
      await supabase.from('roles').delete().eq('id', id)
      onRefresh()
    } catch(e) { alert('Errore: '+e.message) }
    setDeleting(null)
  }

  const handleToggle = async (id, active) => {
    await supabase.from('roles').update({ active: !active }).eq('id', id)
    onRefresh()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="font-semibold text-lg flex items-center gap-2"><Tag size={18} className="text-violet-600"/> Gestione Ruoli</h3>
          <button onClick={onClose}><X size={18}/></button>
        </div>

        {/* Lista ruoli esistenti */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {ruoli.length === 0 && <p className="text-sm text-gray-400 text-center py-6">Nessun ruolo personalizzato. Aggiungine uno sotto.</p>}
          {ruoli.map(r => (
            <div key={r.id} className={`flex items-center gap-3 p-3 rounded-xl border ${r.active ? 'bg-white' : 'bg-gray-50 opacity-60'}`}>
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{backgroundColor: r.color || '#6366f1'}}/>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-gray-800">{r.name}</p>
                {r.description && <p className="text-xs text-gray-400 truncate">{r.description}</p>}
              </div>
              <button onClick={() => handleToggle(r.id, r.active)}
                className={`text-xs px-2 py-1 rounded-lg border ${r.active ? 'text-gray-500 border-gray-200 hover:bg-gray-50' : 'text-green-600 border-green-200 hover:bg-green-50'}`}>
                {r.active ? 'Disabilita' : 'Abilita'}
              </button>
              <button onClick={() => handleDelete(r.id, r.name)} disabled={deleting===r.id}
                className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 border border-transparent hover:border-red-100">
                <Trash2 size={14}/>
              </button>
            </div>
          ))}
        </div>

        {/* Aggiungi nuovo */}
        <div className="p-5 border-t bg-gray-50 rounded-b-2xl space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Aggiungi ruolo</p>
          <div className="flex gap-2">
            <input value={nuovoRuolo} onChange={e=>setNuovoRuolo(e.target.value)}
              placeholder="Es. Chef de Partie" onKeyDown={e=>e.key==='Enter'&&handleAdd()}
              className="input flex-1 text-sm"/>
            <input value={descrizione} onChange={e=>setDescrizione(e.target.value)}
              placeholder="Descrizione (opz.)" className="input flex-1 text-sm"/>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">Colore:</span>
            <div className="flex gap-1.5 flex-wrap">
              {COLORI.map(c => (
                <button key={c} onClick={()=>setNuovoColore(c)}
                  style={{backgroundColor:c}}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${nuovoColore===c?'border-gray-800 scale-110':'border-transparent'}`}/>
              ))}
            </div>
            <button onClick={handleAdd} disabled={saving||!nuovoRuolo.trim()}
              className="ml-auto btn-primary text-sm px-4 py-2 disabled:opacity-50">
              {saving ? '…' : '+ Aggiungi'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sezione Costi Dipendenti ─────────────────────────────────────────────
function CostiSection({ emps, onClose }) {
  const [filterSede, setFilterSede] = useState('ALL')
  const CCNL = CCNL_MULT

  const displayed = useMemo(() => {
    return emps
      .filter(e => e.active && (filterSede === 'ALL' || e.sede === filterSede))
      .filter(e => e.bustaPaga || e.ore_contratto > 0)
      .sort((a,b) => {
        const ca = a.bustaPaga?.costo_azienda || (a.bustaPaga?.netto||0)*CCNL
        const cb = b.bustaPaga?.costo_azienda || (b.bustaPaga?.netto||0)*CCNL
        return cb - ca
      })
  }, [emps, filterSede])

  const totale = useMemo(() => displayed.reduce((acc, e) => {
    const netto = parseFloat(e.bustaPaga?.netto||0)
    const costo = parseFloat(e.bustaPaga?.costo_azienda||0) || (netto*CCNL)
    const split = e.sede_split_ma??100
    return {
      netto: acc.netto + netto,
      costo: acc.costo + costo,
      ma: acc.ma + costo*(split/100),
      pn: acc.pn + costo*((100-split)/100),
    }
  }, {netto:0,costo:0,ma:0,pn:0}), [displayed])

  const fmt = n => `€${Math.round(n).toLocaleString('it-IT')}`

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-gray-800">💰 Costi Dipendenti — da Buste Paga</h3>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border text-xs font-medium">
            {[{v:'ALL',l:'Tutti'},{v:'MA',l:'MA'},{v:'PN',l:'PN'}].map(s=>(
              <button key={s.v} onClick={()=>setFilterSede(s.v)}
                className={`px-3 py-1.5 transition ${filterSede===s.v?'bg-violet-600 text-white':'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {s.l}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16}/></button>
        </div>
      </div>

      {/* Totali */}
      <div className="grid grid-cols-4 gap-0 border-b bg-gray-50">
        {[
          {label:'Totale netto/mese', val:fmt(totale.netto), color:'text-gray-800'},
          {label:'Totale costo az.', val:fmt(totale.costo), color:'text-red-600'},
          {label:'Quota MA', val:fmt(totale.ma), color:'text-blue-600'},
          {label:'Quota PN', val:fmt(totale.pn), color:'text-emerald-600'},
        ].map((t,i) => (
          <div key={i} className="p-4 text-center border-r last:border-r-0">
            <p className="text-xs text-gray-400">{t.label}</p>
            <p className={`text-lg font-bold ${t.color}`}>{t.val}</p>
          </div>
        ))}
      </div>

      {/* Tabella */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b text-xs text-gray-400 uppercase tracking-wider">
              <th className="text-left px-4 py-2">Dipendente</th>
              <th className="text-center px-3 py-2">Sede</th>
              <th className="text-center px-3 py-2">PT%</th>
              <th className="text-right px-3 py-2">Netto/mese</th>
              <th className="text-right px-3 py-2">Costo az.</th>
              <th className="text-right px-3 py-2">Quota MA</th>
              <th className="text-right px-3 py-2">Quota PN</th>
              <th className="text-center px-3 py-2">H/mese</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map(emp => {
              const bp    = emp.bustaPaga
              const netto = parseFloat(bp?.netto||0)
              const costo = parseFloat(bp?.costo_azienda||0) || (netto*CCNL)
              const split = emp.sede_split_ma??100
              const ma    = costo*(split/100)
              const pn    = costo*((100-split)/100)
              const pt    = bp?.percentuale_pt || (netto>=1400?100:netto>=1100?75:netto>=800?62.5:50)
              return (
                <tr key={emp.id} className="border-b hover:bg-gray-50/50 text-sm">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-gray-900">{emp.name}</p>
                    <p className="text-xs text-gray-400">{emp.role} · {emp.reparto?.nome||'N/A'}</p>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${SEDE_COLOR[emp.sede]||'bg-gray-100 text-gray-600'}`}>{emp.sede}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${pt>=100?'bg-blue-100 text-blue-700':pt>=75?'bg-purple-100 text-purple-700':'bg-amber-100 text-amber-700'}`}>
                      {pt}%
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium">{netto>0?fmt(netto):'—'}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-red-600">{costo>0?fmt(costo):'—'}</td>
                  <td className="px-3 py-2.5 text-right text-blue-600">{ma>0?fmt(ma):'—'}</td>
                  <td className="px-3 py-2.5 text-right text-emerald-600">{pn>0?fmt(pn):'—'}</td>
                  <td className="px-3 py-2.5 text-center text-gray-500">{bp?.ore_mensili||'—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-gray-400 p-3 text-right">Moltiplicatore CCNL: ×{CCNL} · Dati dall'ultima busta paga caricata</p>
    </div>
  )
}

// ─── Card dipendente ──────────────────────────────────────────────────────
function EmpCard({ emp, reparti, selected, onSelect, onEdit, onToggle, onTurno, onTransfer }) {
  const [transferring, setTransferring] = useState(false)
  const nuovaSede = emp.sede === 'MA' ? 'PN' : 'MA'
  const reparto = reparti.find(r => r.id === emp.reparto_id)

  const handleTransfer = async () => {
    if (!confirm(`Sposta ${emp.name} da ${SEDE_LABEL[emp.sede]} → ${SEDE_LABEL[nuovaSede]}?`)) return
    setTransferring(true)
    try { await onTransfer(emp) } finally { setTransferring(false) }
  }

  const cv    = emp.venduto
  const bp    = emp.bustaPaga       // dati busta paga più recente
  const netto = bp?.netto ? parseFloat(bp.netto) : 0
  const costoAz = bp?.costo_azienda ? parseFloat(bp.costo_azienda) : (netto ? +(netto * CCNL_MULT).toFixed(0) : 0)
  const splitMA = emp.sede_split_ma ?? 100
  const costoMA = costoAz * (splitMA / 100)
  const costoPN = costoAz * ((100 - splitMA) / 100)

  const sColor  = SEDE_COLOR[emp.sede]  || 'bg-gray-100 text-gray-600'
  const sBorder = SEDE_BORDER[emp.sede] || 'border-gray-200'

  return (
    <div
      className={`card p-4 border-l-4 ${sBorder} ${!emp.active ? 'opacity-55' : ''} ${selected ? 'ring-2 ring-violet-400 ring-offset-1' : ''} transition-all`}
      onClick={() => onSelect(emp.id)}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="relative cursor-pointer flex-shrink-0" onClick={e => { e.stopPropagation(); onSelect(emp.id) }}>
          {selected
            ? <div className="w-10 h-10 rounded-full bg-violet-600 flex items-center justify-center"><Check size={18} className="text-white"/></div>
            : <Avatar name={emp.name} color={emp.avatar_color} />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-gray-900 truncate">{emp.name}</h3>
            <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${sColor}`}>{SEDE_LABEL[emp.sede] || emp.sede}</span>
            {!emp.active && <span className="badge badge-gray text-xs">Inattivo</span>}
            {bp?.percentuale_pt && bp.percentuale_pt < 100 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">PT {parseFloat(bp.percentuale_pt)}%</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{emp.role}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {reparto && (
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: reparto.colore + '20', color: reparto.colore }}>
                {reparto.icona} {reparto.nome}
              </span>
            )}
            {emp.hire_date && <p className="text-xs text-gray-400">dal {emp.hire_date}</p>}
          </div>
        </div>
        {/* Transfer */}
        <button onClick={e => { e.stopPropagation(); handleTransfer() }} disabled={transferring}
          title={`Trasferisci a ${SEDE_LABEL[nuovaSede]}`}
          className="btn-ghost p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors flex-shrink-0">
          <ArrowLeftRight size={15} />
        </button>
      </div>

      {/* Costi da buste paga */}
      {costoAz > 0 && (
        <div className="mt-3 p-2.5 bg-gray-50 rounded-xl">
          <div className="grid grid-cols-3 gap-2 text-center mb-2">
            <div>
              <p className="text-[10px] text-gray-400">Netto/mese</p>
              <p className="text-sm font-semibold text-gray-700">€{netto.toLocaleString('it-IT')}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400">Costo az.</p>
              <p className="text-sm font-semibold text-red-600">€{costoAz.toLocaleString('it-IT')}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400">{bp?.ore_mensili ? `${bp.ore_mensili}h/mese` : 'Ore'}</p>
              <p className="text-sm font-semibold text-gray-600">{bp?.ore_mensili || '—'}</p>
            </div>
          </div>
          {/* Split sedi */}
          {(splitMA !== 100) && (
            <div className="flex items-center gap-1.5 text-[10px]">
              <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{width:`${splitMA}%`}}/>
              </div>
              <span className="text-blue-600 font-medium">MA €{Math.round(costoMA)}</span>
              <span className="text-gray-300">·</span>
              <span className="text-emerald-600 font-medium">PN €{Math.round(costoPN)}</span>
            </div>
          )}
        </div>
      )}

      {/* Dati venduto */}
      {cv && (
        <div className={`${costoAz > 0 ? 'mt-2' : 'mt-3'} p-2.5 bg-violet-50 rounded-xl grid grid-cols-3 gap-2 text-center`}>
          <div><p className="text-[10px] text-gray-400">Coperti</p><p className="text-sm font-semibold text-gray-700">{cv.coperti ?? '—'}</p></div>
          <div><p className="text-[10px] text-gray-400">CM €</p><p className="text-sm font-semibold text-gray-700">{cv.coperto_medio ? cv.coperto_medio.toFixed(2) : '—'}</p></div>
          <div><p className="text-[10px] text-gray-400">Venduto</p><p className="text-sm font-semibold text-violet-600">{cv.tot_importo ? `€${Math.round(cv.tot_importo)}` : '—'}</p></div>
        </div>
      )}

      {/* Azioni */}
      <div className="flex gap-2 mt-3 pt-2.5 border-t border-gray-100" onClick={e => e.stopPropagation()}>
        <button onClick={() => onTurno(emp)} className="btn-ghost text-xs flex-1 gap-1">
          <Calendar size={13} /> Turno
        </button>
        <button onClick={() => onEdit(emp)} className="btn-ghost text-xs px-3">
          <Pencil size={13} />
        </button>
        <button onClick={() => onToggle(emp.id)}
          className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${emp.active
            ? 'text-red-500 border-red-100 hover:bg-red-50'
            : 'text-green-600 border-green-100 hover:bg-green-50'}`}>
          <Power size={13} />
        </button>
      </div>
    </div>
  )
}

// ─── Mappa Operatori: mostra mapping iPratico ↔ dipendenti ───────────────
function MappaOperatoriSection({ mappings, emps, onRefresh }) {
  const [reassigning, setReassigning] = useState(null)
  const [newEmpId, setNewEmpId]       = useState('')
  const [saving, setSaving]           = useState(null)

  if (mappings.length === 0) {
    return (
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle2 size={16} className="text-emerald-500" />
          <h2 className="text-sm font-semibold text-gray-700">Mappa Operatori iPratico — tutto verificato ✓</h2>
        </div>
        <p className="text-xs text-gray-400">Tutti i nomi iPratico sono collegati correttamente.</p>
      </div>
    )
  }

  const handleConfirm = async (id) => {
    setSaving(id)
    try { await mappingApi.confirm(id); onRefresh() }
    catch (e) { alert('Errore: ' + e.message) }
    finally { setSaving(null) }
  }

  const handleReassign = async (id) => {
    if (!newEmpId) return
    setSaving(id)
    try {
      await mappingApi.update(id, { employee_id: newEmpId, verified: true })
      setReassigning(null); setNewEmpId('')
      onRefresh()
    } catch (e) { alert('Errore: ' + e.message) }
    finally { setSaving(null) }
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <AlertCircle size={16} className="text-amber-500" />
          <h2 className="text-sm font-semibold text-gray-700">Mappa Operatori da Verificare ({mappings.length})</h2>
        </div>
        <button onClick={onRefresh} className="btn-ghost text-xs gap-1 text-gray-500">
          <RefreshCw size={12}/> Aggiorna
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-3">
        iPratico usa nomi brevi (es. "CAMILLA"). Verifica o correggi il collegamento con il dipendente corretto.
        Usa il pulsante <strong>Correggi</strong> per associare manualmente.
      </p>
      <div className="space-y-2">
        {mappings.map(m => {
          const emp = m.employees
          const sColor = SEDE_COLOR[m.sede] || 'bg-gray-100 text-gray-600'
          const isReassigning = reassigning === m.id
          const isSaving = saving === m.id
          return (
            <div key={m.id} className="card p-3 border border-amber-100 bg-amber-50/40">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-shrink-0 min-w-[120px]">
                  <p className="text-xs text-gray-400 mb-0.5">Nome iPratico</p>
                  <div className="flex items-center gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${sColor}`}>{m.sede}</span>
                    <span className="font-mono font-semibold text-sm text-gray-800">{m.op_name_ipratico}</span>
                  </div>
                </div>
                <Link2 size={14} className="text-gray-300 flex-shrink-0" />
                <div className="flex-1 min-w-[160px]">
                  <p className="text-xs text-gray-400 mb-0.5">Dipendente collegato</p>
                  {isReassigning ? (
                    <select className="select text-sm py-1" value={newEmpId} onChange={e => setNewEmpId(e.target.value)} autoFocus>
                      <option value="">— Seleziona dipendente —</option>
                      {emps.filter(e => e.sede === m.sede && e.active).sort((a,b) => a.name.localeCompare(b.name)).map(e => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-sm font-medium text-gray-800">
                      {emp?.name || <span className="text-red-400 italic">Nessuno assegnato</span>}
                    </p>
                  )}
                  {m.buste_paga_name && !isReassigning && (
                    <p className="text-xs text-gray-400 mt-0.5">Busta paga: {m.buste_paga_name}</p>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {isReassigning ? (
                    <>
                      <button onClick={() => handleReassign(m.id)} disabled={!newEmpId || isSaving} className="btn-primary text-xs px-3 py-1.5">
                        {isSaving ? '...' : <><Check size={12}/> Salva</>}
                      </button>
                      <button onClick={() => { setReassigning(null); setNewEmpId('') }} className="btn-secondary text-xs px-2 py-1.5"><X size={12}/></button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => handleConfirm(m.id)} disabled={!emp || isSaving}
                        className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-xs font-medium transition-colors disabled:opacity-40">
                        {isSaving ? '...' : <><CheckCircle2 size={12}/> Conferma</>}
                      </button>
                      <button onClick={() => { setReassigning(m.id); setNewEmpId(emp?.id || '') }}
                        className="px-3 py-1.5 rounded-lg bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 text-xs font-medium transition-colors">
                        <Pencil size={12}/> Correggi
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Sezione Duplicati Rilevati ──────────────────────────────────────────
function DuplicatiSection({ emps, onMerge }) {
  // Rileva coppie di dipendenti con nomi molto simili (prefisso comune ≥ 5 chars o uno è prefisso dell'altro)
  const duplicates = useMemo(() => {
    const pairs = []
    const active = emps.filter(e => e.active)
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i]; const b = active[j]
        if (a.sede !== b.sede) continue
        const na = (a.name || '').toUpperCase().trim()
        const nb = (b.name || '').toUpperCase().trim()
        if (na === nb) continue // stesso nome esatto → già gestito
        const isPrefix = na.startsWith(nb) || nb.startsWith(na)
        if (isPrefix && Math.abs(na.length - nb.length) <= 20) {
          pairs.push([a, b])
        }
      }
    }
    return pairs
  }, [emps])

  const [mergeTarget, setMergeTarget] = useState(null)

  if (duplicates.length === 0) return null

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-2">
        <GitMerge size={16} className="text-orange-500" />
        <h2 className="text-sm font-semibold text-gray-700">Possibili duplicati rilevati ({duplicates.length})</h2>
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Dipendenti con nomi simili nella stessa sede — potrebbero essere la stessa persona.
        Usa "Unisci" per mantenere un solo profilo e collegare i dati automaticamente.
      </p>

      {mergeTarget && (
        <MergeModal
          pair={mergeTarget}
          onMerge={(keep, remove) => { setMergeTarget(null); onMerge(keep, remove) }}
          onClose={() => setMergeTarget(null)}
        />
      )}

      <div className="space-y-2">
        {duplicates.map(([a, b], i) => (
          <div key={i} className="card p-3 border border-orange-100 bg-orange-50/40">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 flex items-center gap-3">
                <div className="text-center">
                  <p className="font-mono font-semibold text-sm text-gray-800">{a.name}</p>
                  <p className="text-xs text-gray-500">{a.role} · {SEDE_LABEL[a.sede]}</p>
                </div>
                <span className="text-gray-400 text-xs">≈</span>
                <div className="text-center">
                  <p className="font-mono font-semibold text-sm text-gray-800">{b.name}</p>
                  <p className="text-xs text-gray-500">{b.role} · {SEDE_LABEL[b.sede]}</p>
                </div>
              </div>
              <button
                onClick={() => setMergeTarget([a, b])}
                className="px-3 py-1.5 rounded-lg bg-orange-100 text-orange-700 border border-orange-200 hover:bg-orange-200 text-xs font-medium transition-colors flex items-center gap-1.5">
                <GitMerge size={12}/> Unisci
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────
export default function Employees() {
  const [emps, setEmps]             = useState([])
  const [vendutoOps, setVendutoOps] = useState([])
  const [unverifiedMappings, setUnverifiedMappings] = useState([])
  const [reparti, setReparti]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [ruoliDB, setRuoliDB]       = useState([])
  const [bustePagaMap, setBustePagaMap] = useState({})
  const [regoleMap, setRegoleMap]   = useState({})
  const [showRuoli, setShowRuoli]   = useState(false)
  const [showCosti, setShowCosti]   = useState(false)
  const [mergeManual, setMergeManual] = useState(null)   // null | [emp, emp]

  const [localeTab, setLocaleTab]   = useState('all')
  const [search, setSearch]         = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [filterReparto, setFilterReparto] = useState('')

  const [showForm, setShowForm]     = useState(false)
  const [editing, setEditing]       = useState(null)
  const [turnoFor, setTurnoFor]     = useState(null)

  // Selezione multipla
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showBulkReparto, setShowBulkReparto] = useState(false)

  // ─── Load ───────────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true)
    try {
      const [empsData, vData, unverified, repartData] = await Promise.all([
        empApi.getAll(),
        vendutoApi.operatori({}).catch(() => []),
        mappingApi.getUnverified().catch(() => []),
        repartiApi.getAll().catch(() => []),
      ])
      setEmps(empsData)
      setVendutoOps(vData)
      setUnverifiedMappings(unverified)
      setReparti(repartData)

      // Carica buste paga (ultima per ogni dipendente)
      const { data: bpData } = await supabase
        .from('buste_paga')
        .select('*')
        .order('anno', { ascending: false })
        .order('mese', { ascending: false })
      const bpMap = {}
      for (const bp of bpData || []) {
        if (!bpMap[bp.employee_id]) bpMap[bp.employee_id] = bp
      }
      setBustePagaMap(bpMap)

      // Carica ruoli dal DB
      const { data: rolesData } = await supabase
        .from('roles')
        .select('*')
        .order('name')
      setRuoliDB(rolesData || [])

      // Carica regole dipendenti (ore contratto)
      const { data: regoleData } = await supabase
        .from('employee_regole')
        .select('*')
      const rMap = {}
      for (const r of regoleData || []) rMap[r.employee_id] = r
      setRegoleMap(rMap)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // ── Cross-page reactivity: ricarica se un'altra tab modifica un dipendente ─
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'crm_employee_updated') load()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // ─── Arricchisci dipendenti con dati venduto + buste paga + regole ──────
  const enriched = useMemo(() => {
    const byEmpId = {}
    for (const v of vendutoOps) {
      if (v.employee_id) byEmpId[v.employee_id] = v
    }
    return emps.map(emp => {
      const bustaPaga = bustePagaMap[emp.id] || null
      const regole    = regoleMap[emp.id] || null
      if (byEmpId[emp.id]) return { ...emp, venduto: byEmpId[emp.id], bustaPaga, regole }
      const empName = (emp.name || '').toUpperCase().trim()
      // Controlla anche buste_paga_name come alias
      const aliases = [empName, (emp.buste_paga_name || '').toUpperCase().trim()].filter(Boolean)
      const byName = vendutoOps.find(v => {
        if (v.sede !== emp.sede) return false
        const vName = (v.operatore || '').toUpperCase().trim()
        return aliases.some(alias =>
          vName === alias || alias.startsWith(vName) || vName.startsWith(alias)
        )
      })
      return { ...emp, venduto: byName || null, bustaPaga, regole }
    })
  }, [emps, vendutoOps, bustePagaMap, regoleMap])

  // Operatori venduto senza match
  const unmatchedOps = useMemo(() => {
    return vendutoOps.filter(v => {
      const vName = (v.operatore || '').toUpperCase().trim()
      return !enriched.some(emp => {
        if (emp.sede !== v.sede) return false
        const aliases = [(emp.name||'').toUpperCase().trim(), (emp.buste_paga_name||'').toUpperCase().trim()].filter(Boolean)
        return aliases.some(a => vName === a || a.startsWith(vName) || vName.startsWith(a))
      })
    })
  }, [enriched, vendutoOps])

  // ─── Filtri ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return enriched.filter(emp => {
      if (!showInactive && !emp.active) return false
      if (localeTab !== 'all' && emp.sede !== localeTab) return false
      if (filterReparto && emp.reparto_id !== filterReparto) return false
      if (search) {
        const s = search.toUpperCase()
        if (!(emp.name || '').toUpperCase().includes(s) && !(emp.role || '').toUpperCase().includes(s)) return false
      }
      return true
    })
  }, [enriched, localeTab, search, showInactive, filterReparto])

  const countMA  = useMemo(() => enriched.filter(e => e.sede === 'MA'  && (showInactive || e.active)).length, [enriched, showInactive])
  const countPN  = useMemo(() => enriched.filter(e => e.sede === 'PN'  && (showInactive || e.active)).length, [enriched, showInactive])
  const countAll = useMemo(() => enriched.filter(e => showInactive || e.active).length, [enriched, showInactive])

  // ─── Handlers ───────────────────────────────────────────────────────────
  const handleSave = async (form) => {
    // Può lanciare → gestito nel form con try/catch
    const payload = {
      ...form,
      location: form.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA',
    }
    if (editing?.id) {
      await empApi.update(editing.id, payload)
    } else {
      const res = await empApi.create(payload)
      const newId = res?.id
      // Se ore passate al create → upsert regole separatamente
      if (newId && (form.ore_contratto_mensili || form.ore_settimanali)) {
        await supabase.from('employee_regole').upsert({
          employee_id:           newId,
          ore_contratto_mensili: parseInt(form.ore_contratto_mensili) || null,
          ore_settimanali:       parseInt(form.ore_settimanali)       || null,
          updated_at:            new Date().toISOString(),
        }, { onConflict: 'employee_id' })
      }
    }
    setShowForm(false); setEditing(null); load()
  }

  const handleTransfer = async (emp) => {
    const newSede = emp.sede === 'MA' ? 'PN' : 'MA'
    await adminApi.transferEmployee(emp.id, newSede)
    load()
  }

  const handleToggle = async (id) => {
    await empApi.toggle(id); load()
  }

  const handleImportOp = async (op) => {
    if (!confirm(`Importa "${op.operatore}" (Sede ${op.sede}) come nuovo dipendente?`)) return
    await empApi.create({ name: op.operatore, role: 'Cameriere', location: op.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA' })
    load()
  }

  // ─── Selezione / Bulk ───────────────────────────────────────────────────
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const selectAll  = () => setSelectedIds(new Set(filtered.map(e => e.id)))
  const clearSelect = () => setSelectedIds(new Set())

  const bulkActivate   = async () => { for (const id of selectedIds) await empApi.update(id, { active: true }); clearSelect(); load() }
  const bulkDeactivate = async () => { for (const id of selectedIds) await empApi.update(id, { active: false }); clearSelect(); load() }
  const bulkTransfer   = async (sede) => {
    const location = sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA'
    for (const id of selectedIds) await empApi.update(id, { sede, location })
    clearSelect(); load()
  }
  const bulkAssignReparto = async (repartoId) => {
    for (const id of selectedIds) await empApi.update(id, { reparto_id: repartoId })
    setShowBulkReparto(false); clearSelect(); load()
  }

  // ─── Merge duplicati ────────────────────────────────────────────────────
  const handleMerge = async (keep, remove) => {
    try {
      // 1. Imposta buste_paga_name sul profilo da tenere (se diverso)
      if (keep.name !== remove.name) {
        const existingAlias = keep.buste_paga_name || ''
        const newAlias = existingAlias ? existingAlias : remove.name
        await empApi.update(keep.id, { buste_paga_name: newAlias })
      }
      // 2. Disattiva il duplicato
      await empApi.update(remove.id, { active: false })
      load()
    } catch (e) {
      alert('Errore durante il merge: ' + e.message)
    }
  }

  // ─── Merge manuale (da BulkActionsBar con 2 selezionati) ────────────────
  const handleMergeManual = () => {
    const ids = [...selectedIds]
    if (ids.length !== 2) return
    const pair = ids.map(id => enriched.find(e => e.id === id)).filter(Boolean)
    if (pair.length === 2) {
      setMergeManual(pair)
      clearSelect()
    }
  }

  const activeCount = emps.filter(e => e.active).length

  return (
    <>
    <div className="space-y-5">
      {/* Modali */}
      {(showForm || editing) && (
        <EmployeeForm
          initial={editing ? { ...editing } : undefined}
          reparti={reparti}
          ruoliDB={ruoliDB}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}
      {turnoFor && (
        <TurnoRapidoModal emp={turnoFor} onClose={() => setTurnoFor(null)} onSaved={() => {}} />
      )}
      {showBulkReparto && (
        <BulkRepartoModal
          count={selectedIds.size}
          reparti={reparti}
          onAssign={bulkAssignReparto}
          onClose={() => setShowBulkReparto(false)}
        />
      )}
      {showRuoli && (
        <RuoliModal
          ruoli={ruoliDB}
          onClose={() => setShowRuoli(false)}
          onRefresh={async () => {
            const { data } = await supabase.from('roles').select('*').order('name')
            setRuoliDB(data || [])
          }}
        />
      )}
      {mergeManual && (
        <MergeModal
          pair={mergeManual}
          onMerge={(keep, remove) => { setMergeManual(null); handleMerge(keep, remove) }}
          onClose={() => setMergeManual(null)}
        />
      )}

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dipendenti</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeCount} attivi · {emps.length - activeCount} inattivi
            <span className="mx-2 text-gray-300">|</span>
            <span className="text-gray-400 text-xs">Dati venduto da iPratico · Costi da buste paga</span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {filtered.length > 0 && (
            <button onClick={selectedIds.size === filtered.length ? clearSelect : selectAll}
              className="btn-secondary text-xs flex items-center gap-1.5">
              {selectedIds.size === filtered.length ? <CheckSquare size={13}/> : <Square size={13}/>}
              {selectedIds.size === filtered.length ? 'Deseleziona tutti' : 'Seleziona tutti'}
            </button>
          )}
          <button onClick={() => setShowRuoli(true)}
            className="btn-secondary text-xs flex items-center gap-1.5">
            <Tag size={13}/> Ruoli
          </button>
          <button onClick={() => setShowCosti(v => !v)}
            className={`btn-secondary text-xs flex items-center gap-1.5 ${showCosti ? 'bg-violet-50 border-violet-300 text-violet-700' : ''}`}>
            💰 Costi
          </button>
          <button onClick={() => setShowForm(true)} className="btn-primary">
            <UserPlus size={16} /> Nuovo
          </button>
        </div>
      </div>

      {/* Barra filtri */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Tab locale */}
        <div className="flex rounded-xl overflow-hidden border border-gray-200 text-sm font-medium">
          {[
            { key: 'all', label: `Tutti (${countAll})` },
            { key: 'MA',  label: `MA (${countMA})`,  color: 'text-blue-700' },
            { key: 'PN',  label: `PN (${countPN})`,  color: 'text-emerald-700' },
          ].map(t => (
            <button key={t.key} onClick={() => setLocaleTab(t.key)}
              className={`px-4 py-1.5 transition-colors ${
                localeTab === t.key ? 'bg-violet-600 text-white' : `bg-white hover:bg-gray-50 ${t.color || 'text-gray-600'}`}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Filtro reparto */}
        {reparti.length > 0 && (
          <select className="select text-sm py-1.5 max-w-[160px]" value={filterReparto}
            onChange={e => setFilterReparto(e.target.value)}>
            <option value="">Tutti i reparti</option>
            {reparti.map(r => <option key={r.id} value={r.id}>{r.icona} {r.nome}</option>)}
          </select>
        )}

        {/* Ricerca */}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8 py-1.5 text-sm" placeholder="Cerca per nome..."
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={13}/>
            </button>
          )}
        </div>

        {/* Toggle inattivi */}
        <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer select-none">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="w-4 h-4 accent-violet-600"/>
          Mostra inattivi
        </label>
      </div>

      {/* Sezione costi */}
      {showCosti && (
        <CostiSection emps={enriched} onClose={() => setShowCosti(false)} />
      )}

      {/* Griglia dipendenti */}
      {loading ? (
        <div className="text-gray-400 text-sm text-center py-16">Caricamento...</div>
      ) : (
        <>
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Users size={40} className="mx-auto mb-2 opacity-30" />
              <p>Nessun dipendente trovato.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map(emp => (
                <EmpCard key={emp.id} emp={emp} reparti={reparti}
                  selected={selectedIds.has(emp.id)}
                  onSelect={toggleSelect}
                  onEdit={e => { setEditing(e); setShowForm(true) }}
                  onToggle={handleToggle}
                  onTurno={setTurnoFor}
                  onTransfer={handleTransfer}
                />
              ))}
            </div>
          )}

          {/* Operatori venduto senza corrispondenza */}
          {unmatchedOps.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={16} className="text-amber-500"/>
                <h2 className="text-sm font-semibold text-gray-700">
                  Operatori rilevati nel venduto non ancora in anagrafica ({unmatchedOps.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {unmatchedOps.map((op, i) => (
                  <div key={i} className="card p-3 border border-dashed border-amber-200 bg-amber-50">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-amber-200 flex items-center justify-center text-amber-700 text-sm font-bold flex-shrink-0">
                        {op.operatore?.charAt(0) || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800 text-sm truncate">{op.operatore}</p>
                        <p className="text-xs text-gray-500">Sede {op.sede} · {op.coperti} cop.</p>
                      </div>
                      <button onClick={() => handleImportOp(op)}
                        className="btn-ghost text-xs text-amber-700 border border-amber-200 hover:bg-amber-100 px-2 py-1 rounded-lg flex-shrink-0">
                        + Importa
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Duplicati rilevati */}
          <DuplicatiSection emps={enriched} onMerge={handleMerge} />

          {/* Mappa Operatori */}
          <MappaOperatoriSection mappings={unverifiedMappings} emps={emps} onRefresh={load} />
        </>
      )}
    </div>

    {/* Bulk actions floating bar */}
    {selectedIds.size > 0 && (
      <BulkActionsBar
        count={selectedIds.size}
        onActivate={bulkActivate}
        onDeactivate={bulkDeactivate}
        onTransferMA={() => bulkTransfer('MA')}
        onTransferPN={() => bulkTransfer('PN')}
        onReparto={() => setShowBulkReparto(true)}
        onMerge={handleMergeManual}
        onClear={clearSelect}
      />
    )}

      <PageAssistant
        pagina="Dipendenti"
        suggerimenti={[
          "Quanti dipendenti attivi abbiamo per reparto?",
          "Mostrami i dipendenti di sala di MA",
          "Chi ha coperti medi più alti?",
        ]}
      />
    </>
  )
}
