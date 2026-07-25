/**
 * AdminPanel.jsx
 * Backoffice Risto CRM — gestione senza toccare il codice.
 * Sezioni: Dipendenti · Ruoli · KPI Target · Database
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Users, Tag, Target, Database, Plus, Edit3, Trash2, Save, X, RefreshCw,
  ArrowRight, Percent, CheckCircle, AlertCircle, ChevronDown, ChevronRight,
  Search, ToggleLeft, ToggleRight, Info, Archive, MapPin, Building2, Copy,
  Brain, Cloud, Zap, ExternalLink, Globe, Eye, EyeOff, Filter, RefreshCcw,
  GitMerge, Link2, ShieldCheck, Unlink, ArrowLeftRight, ChevronLeft,
} from 'lucide-react'
import { employees as empApi, roles as rolesApi, kpi as kpiApi, admin as adminApi, sediApi, turni as turniApi } from '../api/client'
import supabase from '../supabase'

// ─── Utils ───────────────────────────────────────────────────────────────────
const SEDI = ['MA', 'PN']
const SEDE_LABEL = { MA: 'Sede MA (CA)', PN: 'Sede PN (SS)' }

function Toast({ msg, onClose }) {
  if (!msg) return null
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl text-sm font-medium transition-all
      ${msg.type === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {msg.type === 'ok' ? <CheckCircle size={16}/> : <AlertCircle size={16}/>}
      {msg.text}
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100"><X size={14}/></button>
    </div>
  )
}

function SectionCard({ title, sub, icon: Icon, color = 'violet', children }) {
  const ring = { violet: 'ring-violet-200', blue: 'ring-blue-200', amber: 'ring-amber-200', gray: 'ring-gray-200' }
  return (
    <div className={`bg-white rounded-2xl shadow-sm ring-1 ${ring[color]} overflow-hidden`}>
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-${color}-100`}>
          <Icon size={16} className={`text-${color}-600`}/>
        </div>
        <div>
          <h2 className="font-semibold text-gray-800 text-sm">{title}</h2>
          {sub && <p className="text-xs text-gray-400">{sub}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — DIPENDENTI
// ═══════════════════════════════════════════════════════════════════════════
function DipendentiTab({ onToast }) {
  const [employees, setEmployees]   = useState([])
  const [roles,     setRoles]       = useState([])
  const [regoleMap, setRegoleMap]   = useState({})
  const [loading,   setLoading]     = useState(true)
  const [search,    setSearch]      = useState('')
  const [editId,    setEditId]      = useState(null)
  const [editForm,  setEditForm]    = useState({})
  const [transferId,setTransferId]  = useState(null)
  const [transferData, setTransferData] = useState({ nuovaSede: 'MA', note: '' })
  const [splitId,   setSplitId]     = useState(null)
  const [splitForm, setSplitForm]   = useState({ MA: '50', PN: '50' })
  const [saving,    setSaving]      = useState(false)
  const [addMode,   setAddMode]     = useState(false)
  const [addForm,   setAddForm]     = useState({ name: '', role: '', sede: 'MA', code: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [emps, rls, regoleRows] = await Promise.all([
        empApi.getAll(),
        rolesApi.getAll(),
        turniApi.getRegole().catch(() => []),
      ])
      setEmployees(emps)
      setRoles(rls)
      const rMap = {}
      for (const r of regoleRows) rMap[r.employee_id] = r
      setRegoleMap(rMap)
    } catch(e) { onToast({ type: 'err', text: e.message }) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Cross-page reactivity ──
  useEffect(() => {
    const onStorage = (e) => { if (e.key === 'crm_employee_updated') load() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [load])

  const filtered = useMemo(() => {
    return employees.filter(e =>
      !search || (e.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (e.role || '').toLowerCase().includes(search.toLowerCase())
    )
  }, [employees, search])

  // ── Edit inline ──
  const startEdit = (emp) => {
    setEditId(emp.id)
    const regole = regoleMap[emp.id] || {}
    setEditForm({
      name: emp.name,
      role: emp.role || '',
      sede: emp.sede || (emp.location === 'MAMELI' ? 'MA' : 'PN'),
      code: emp.code || '',
      ore_contratto_mensili: regole.ore_contratto_mensili || '',
      ore_settimanali:       regole.ore_settimanali       || '',
    })
  }
  const saveEdit = async () => {
    setSaving(true)
    try {
      await adminApi.updateEmployee(editId, editForm)
      onToast({ type: 'ok', text: 'Dipendente aggiornato' })
      setEditId(null); load()
    } catch(e) { onToast({ type: 'err', text: e.message }) }
    finally { setSaving(false) }
  }

  // ── Toggle active ──
  const toggleActive = async (emp) => {
    try {
      await empApi.toggle(emp.id)
      onToast({ type: 'ok', text: `${emp.name} ${emp.active ? 'disattivato' : 'attivato'}` })
      load()
    } catch(e) { onToast({ type: 'err', text: e.message }) }
  }

  // ── Transfer ──
  const doTransfer = async () => {
    if (!transferId) return
    setSaving(true)
    try {
      const r = await adminApi.transferEmployee(transferId, transferData.nuovaSede, { note: transferData.note })
      onToast({ type: 'ok', text: `Trasferito da ${r.da} a ${r.a}` })
      setTransferId(null); load()
    } catch(e) { onToast({ type: 'err', text: e.message }) }
    finally { setSaving(false) }
  }

  // ── Split costi ──
  const doSplit = async () => {
    if (!splitId) return
    const ma = parseFloat(splitForm.MA) / 100
    const pn = parseFloat(splitForm.PN) / 100
    if (Math.abs(ma + pn - 1) > 0.01) return onToast({ type: 'err', text: 'MA% + PN% deve fare 100%' })
    setSaving(true)
    try {
      await adminApi.setCostSplit(splitId, { MA: ma, PN: pn })
      onToast({ type: 'ok', text: 'Split costi impostato' })
      setSplitId(null); load()
    } catch(e) { onToast({ type: 'err', text: e.message }) }
    finally { setSaving(false) }
  }
  const removeSplit = async (id) => {
    try { await adminApi.removeCostSplit(id); onToast({ type: 'ok', text: 'Split rimosso' }); load() }
    catch(e) { onToast({ type: 'err', text: e.message }) }
  }

  // ── Aggiungi ──
  const doAdd = async () => {
    if (!addForm.name) return onToast({ type: 'err', text: 'Nome obbligatorio' })
    setSaving(true)
    try {
      await empApi.create({ ...addForm, location: addForm.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA' })
      onToast({ type: 'ok', text: 'Dipendente aggiunto' })
      setAddMode(false); setAddForm({ name: '', role: '', sede: 'MA', code: '' }); load()
    } catch(e) { onToast({ type: 'err', text: e.message }) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">Caricamento...</div>

  return (
    <div className="space-y-4">
      {/* Transfer modal */}
      {transferId && (() => {
        const emp = employees.find(e => e.id === transferId)
        const sedaCorrente = emp?.sede || (emp?.location === 'MAMELI' ? 'MA' : 'PN')
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
              <h3 className="font-semibold text-lg mb-1">Trasferisci Dipendente</h3>
              <p className="text-sm text-gray-500 mb-4">{emp?.name} — attualmente <strong>{sedaCorrente}</strong></p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Nuova sede</label>
                  <select className="input w-full" value={transferData.nuovaSede} onChange={e => setTransferData(d => ({ ...d, nuovaSede: e.target.value }))}>
                    {SEDI.filter(s => s !== sedaCorrente).map(s => <option key={s} value={s}>{s} — {SEDE_LABEL[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Note (motivo trasferimento)</label>
                  <input className="input w-full" placeholder="es. Apertura stagionale PN" value={transferData.note} onChange={e => setTransferData(d => ({ ...d, note: e.target.value }))}/>
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setTransferId(null)} className="flex-1 btn btn-secondary">Annulla</button>
                <button onClick={doTransfer} disabled={saving} className="flex-1 btn btn-primary flex items-center justify-center gap-2">
                  <ArrowRight size={14}/>{saving ? 'Salvando...' : 'Conferma trasferimento'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Split modal */}
      {splitId && (() => {
        const emp = employees.find(e => e.id === splitId)
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
              <h3 className="font-semibold text-lg mb-1">Dividi Costo tra Sedi</h3>
              <p className="text-sm text-gray-500 mb-4">{emp?.name} — Totale deve fare 100%</p>
              <div className="space-y-3">
                {SEDI.map(s => (
                  <div key={s} className="flex items-center gap-3">
                    <span className={`w-10 text-center text-xs font-bold px-2 py-1 rounded ${s === 'MA' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>{s}</span>
                    <input type="number" min="0" max="100" step="5" className="input flex-1"
                      value={splitForm[s]} onChange={e => {
                        const v = e.target.value
                        const other = SEDI.find(x => x !== s)
                        setSplitForm(f => ({ ...f, [s]: v, [other]: String(100 - parseFloat(v || 0)) }))
                      }}/>
                    <Percent size={14} className="text-gray-400"/>
                  </div>
                ))}
                <p className={`text-xs ${Math.abs(parseFloat(splitForm.MA||0) + parseFloat(splitForm.PN||0) - 100) < 0.01 ? 'text-green-600' : 'text-red-500'}`}>
                  Totale: {parseFloat(splitForm.MA||0) + parseFloat(splitForm.PN||0)}%
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                  <Info size={12} className="inline mr-1"/>Esempio marketing: 50% MA + 50% PN. Il costo sarà attribuito proporzionalmente nei report.
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setSplitId(null)} className="flex-1 btn btn-secondary">Annulla</button>
                <button onClick={doSplit} disabled={saving} className="flex-1 btn btn-primary flex items-center justify-center gap-2">
                  <Save size={14}/>{saving ? 'Salvando...' : 'Salva split'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Barra controlli */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-40">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input className="input pl-8 w-full text-sm" placeholder="Cerca per nome o ruolo..." value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        <button onClick={() => setAddMode(true)} className="btn btn-primary text-sm flex items-center gap-2">
          <Plus size={14}/> Aggiungi dipendente
        </button>
      </div>

      {/* Form aggiungi */}
      {addMode && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 space-y-3">
          <p className="font-medium text-violet-800 text-sm">Nuovo dipendente</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Nome Cognome *</label>
              <input className="input w-full text-sm" placeholder="MARIO ROSSI" value={addForm.name}
                onChange={e => setAddForm(f => ({ ...f, name: e.target.value.toUpperCase() }))}/>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Codice</label>
              <input className="input w-full text-sm" placeholder="MROS" value={addForm.code}
                onChange={e => setAddForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}/>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Ruolo</label>
              <select className="input w-full text-sm" value={addForm.role} onChange={e => setAddForm(f => ({ ...f, role: e.target.value }))}>
                <option value="">— seleziona —</option>
                {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Sede</label>
              <select className="input w-full text-sm" value={addForm.sede} onChange={e => setAddForm(f => ({ ...f, sede: e.target.value }))}>
                {SEDI.map(s => <option key={s} value={s}>{s} — {SEDE_LABEL[s]}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setAddMode(false)} className="btn btn-secondary text-sm">Annulla</button>
            <button onClick={doAdd} disabled={saving} className="btn btn-primary text-sm flex items-center gap-2">
              <CheckCircle size={13}/>{saving ? 'Salvando...' : 'Aggiungi'}
            </button>
          </div>
        </div>
      )}

      {/* Lista dipendenti */}
      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Dipendente</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ruolo</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Sede</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ore Contratto</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Split Costo</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Attivo</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Azioni</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(emp => {
              const sedaEmp = emp.sede || (emp.location === 'MAMELI' ? 'MA' : 'PN')
              const isEditing = editId === emp.id
              return (
                <tr key={emp.id} className={`hover:bg-gray-50/50 transition-colors ${!emp.active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <input className="input text-sm w-40" value={editForm.name}
                        onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}/>
                    ) : (
                      <div>
                        <p className="font-medium text-gray-800">{emp.name}</p>
                        <p className="text-xs text-gray-400">{emp.code}</p>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <select className="input text-sm" value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
                        <option value="">—</option>
                        {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                      </select>
                    ) : (
                      <span className="text-sm text-gray-600">{emp.role || '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <select className="input text-sm" value={editForm.sede} onChange={e => setEditForm(f => ({ ...f, sede: e.target.value }))}>
                        {SEDI.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${sedaEmp === 'MA' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>{sedaEmp}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <select className="input text-sm w-36"
                        value={editForm.ore_contratto_mensili || ''}
                        onChange={e => {
                          const ore = parseInt(e.target.value) || ''
                          const sett = ore === 160 ? 40 : ore === 120 ? 30 : ore === 100 ? 25 : ore === 80 ? 20 : ''
                          setEditForm(f => ({ ...f, ore_contratto_mensili: ore, ore_settimanali: sett }))
                        }}>
                        <option value="">— nd —</option>
                        <option value="160">160h · FT</option>
                        <option value="120">120h · PT75%</option>
                        <option value="100">100h · PT62.5%</option>
                        <option value="80">80h · PT50%</option>
                      </select>
                    ) : (
                      (() => {
                        const r = regoleMap[emp.id]
                        if (!r?.ore_contratto_mensili) return <span className="text-xs text-gray-400">—</span>
                        const PT_MAP = { 160: '100%', 120: '75%', 100: '62.5%', 80: '50%' }
                        return (
                          <div>
                            <span className="text-sm font-medium text-gray-700">{r.ore_contratto_mensili}h</span>
                            <span className="text-xs text-gray-400 ml-1">PT {PT_MAP[r.ore_contratto_mensili] || ''}</span>
                          </div>
                        )
                      })()
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {emp.cost_split ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">MA {Math.round((emp.cost_split.MA||0)*100)}%</span>
                        <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">PN {Math.round((emp.cost_split.PN||0)*100)}%</span>
                        <button onClick={() => removeSplit(emp.id)} className="text-gray-400 hover:text-red-400 ml-1" title="Rimuovi split"><X size={12}/></button>
                      </div>
                    ) : (
                      <button onClick={() => { setSplitId(emp.id); setSplitForm({ MA: '50', PN: '50' }) }}
                        className="text-xs text-gray-400 hover:text-violet-600 flex items-center gap-1 transition-colors">
                        <Percent size={11}/> Imposta split
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleActive(emp)} className="transition-colors">
                      {emp.active ? <ToggleRight size={20} className="text-emerald-500"/> : <ToggleLeft size={20} className="text-gray-300"/>}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {isEditing ? (
                        <>
                          <button onClick={saveEdit} disabled={saving} className="text-emerald-600 hover:text-emerald-700 p-1" title="Salva">
                            <Save size={15}/>
                          </button>
                          <button onClick={() => setEditId(null)} className="text-gray-400 hover:text-gray-600 p-1" title="Annulla">
                            <X size={15}/>
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(emp)} className="text-gray-400 hover:text-violet-600 p-1" title="Modifica">
                            <Edit3 size={14}/>
                          </button>
                          <button onClick={() => { setTransferId(emp.id); setTransferData({ nuovaSede: SEDI.find(s => s !== sedaEmp) || 'MA', note: '' }) }}
                            className="text-gray-400 hover:text-blue-600 p-1" title={`Trasferisci da ${sedaEmp}`}>
                            <ArrowRight size={14}/>
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && <p className="text-gray-400 text-sm text-center py-8">Nessun dipendente trovato.</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — RUOLI
// ═══════════════════════════════════════════════════════════════════════════
function RuoliTab({ onToast }) {
  const [roles,    setRoles]   = useState([])
  const [loading,  setLoading] = useState(true)
  const [addForm,  setAddForm] = useState({ name: '', description: '', color: '#6366f1' })
  const [editId,   setEditId]  = useState(null)
  const [editForm, setEditForm]= useState({})
  const [saving,   setSaving]  = useState(false)

  const PRESET_COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ec4899','#8b5cf6','#ef4444','#64748b','#f97316','#06b6d4']

  const load = useCallback(async () => {
    setLoading(true)
    try { setRoles(await rolesApi.getAll()) }
    catch(e) { onToast({ type: 'err', text: e.message }) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const doAdd = async () => {
    if (!addForm.name.trim()) return onToast({ type: 'err', text: 'Nome ruolo obbligatorio' })
    setSaving(true)
    try { await rolesApi.create(addForm); onToast({ type: 'ok', text: 'Ruolo aggiunto' }); setAddForm({ name: '', description: '', color: '#6366f1' }); load() }
    catch(e) { onToast({ type: 'err', text: e.message }) }
    finally { setSaving(false) }
  }

  const saveEdit = async () => {
    setSaving(true)
    try { await rolesApi.update(editId, editForm); onToast({ type: 'ok', text: 'Ruolo aggiornato' }); setEditId(null); load() }
    catch(e) { onToast({ type: 'err', text: e.message }) }
    finally { setSaving(false) }
  }

  const doDelete = async (id, name) => {
    if (!window.confirm(`Eliminare ruolo "${name}"?`)) return
    try { await rolesApi.delete(id); onToast({ type: 'ok', text: 'Ruolo eliminato' }); load() }
    catch(e) { onToast({ type: 'err', text: e.message }) }
  }

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">Caricamento...</div>

  return (
    <div className="space-y-6">
      {/* Lista ruoli */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {roles.map(r => (
          <div key={r.id} className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-sm transition-shadow">
            {editId === r.id ? (
              <div className="space-y-2">
                <input className="input w-full text-sm" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} placeholder="Nome ruolo"/>
                <input className="input w-full text-sm" value={editForm.description || ''} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} placeholder="Descrizione"/>
                <div className="flex gap-1 flex-wrap">
                  {PRESET_COLORS.map(c => (
                    <button key={c} onClick={() => setEditForm(f => ({ ...f, color: c }))}
                      className={`w-6 h-6 rounded-full border-2 ${editForm.color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}/>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={saveEdit} disabled={saving} className="btn btn-primary text-xs py-1 flex-1 flex items-center justify-center gap-1">
                    <Save size={12}/>{saving ? 'Salvando...' : 'Salva'}
                  </button>
                  <button onClick={() => setEditId(null)} className="btn btn-secondary text-xs py-1"><X size={12}/></button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex-shrink-0" style={{ backgroundColor: r.color + '25' }}>
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: r.color }}/>
                    </div>
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-gray-800">{r.name}</p>
                    {r.description && <p className="text-xs text-gray-400 mt-0.5">{r.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => { setEditId(r.id); setEditForm({ name: r.name, description: r.description || '', color: r.color || '#6366f1' }) }}
                    className="text-gray-400 hover:text-violet-600 p-1 transition-colors"><Edit3 size={13}/></button>
                  <button onClick={() => doDelete(r.id, r.name)}
                    className="text-gray-400 hover:text-red-500 p-1 transition-colors"><Trash2 size={13}/></button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Aggiungi ruolo */}
      <SectionCard title="Aggiungi nuovo ruolo" icon={Plus} color="violet">
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Nome ruolo *</label>
              <input className="input w-full text-sm" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} placeholder="es. Sommelier"/>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Descrizione</label>
              <input className="input w-full text-sm" value={addForm.description} onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))} placeholder="es. Gestione cantina e abbinamenti"/>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-2">Colore</label>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setAddForm(f => ({ ...f, color: c }))}
                  className={`w-7 h-7 rounded-full border-2 transition-transform ${addForm.color === c ? 'border-gray-800 scale-110' : 'border-transparent hover:scale-105'}`}
                  style={{ backgroundColor: c }}/>
              ))}
            </div>
          </div>
          <button onClick={doAdd} disabled={saving} className="btn btn-primary text-sm flex items-center gap-2">
            <Plus size={14}/>{saving ? 'Aggiungendo...' : 'Aggiungi ruolo'}
          </button>
        </div>
      </SectionCard>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — KPI TARGET CONFIG
// ═══════════════════════════════════════════════════════════════════════════
function KpiConfigTab({ onToast }) {
  const [targets, setTargets] = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [editId,  setEditId]  = useState(null)
  const [editForm,setEditForm]= useState({})
  const [saving,  setSaving]  = useState(false)

  const now = new Date()
  const mesiDisp = Array.from({ length: 18 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
  })
  const [periodoFilter, setPeriodoFilter] = useState(mesiDisp[0])

  const load = useCallback(async () => {
    setLoading(true)
    try { setTargets(await kpiApi.getTargets({ period: periodoFilter || undefined })) }
    catch(e) { onToast({ type: 'err', text: e.message }) }
    finally { setLoading(false) }
  }, [periodoFilter])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => targets.filter(t =>
    !search || (t.operator_name || t.operator_code || '').toLowerCase().includes(search.toLowerCase())
  ), [targets, search])

  const saveEdit = async () => {
    setSaving(true)
    try {
      await kpiApi.setTarget({ ...editForm, operator_code: editForm.operator_code, period: editForm.period })
      onToast({ type: 'ok', text: 'Target aggiornato' }); setEditId(null); load()
    } catch(e) { onToast({ type: 'err', text: e.message }) }
    finally { setSaving(false) }
  }

  const doDelete = async (id) => {
    if (!window.confirm('Eliminare questo target?')) return
    try { await kpiApi.deleteTarget(id); onToast({ type: 'ok', text: 'Target eliminato' }); load() }
    catch(e) { onToast({ type: 'err', text: e.message }) }
  }

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">Caricamento...</div>

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-40">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input className="input pl-8 w-full text-sm" placeholder="Cerca operatore..." value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        <select className="input text-sm" value={periodoFilter} onChange={e => setPeriodoFilter(e.target.value)}>
          <option value="">Tutti i periodi</option>
          {mesiDisp.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={load} className="btn btn-secondary text-sm flex items-center gap-1"><RefreshCw size={13}/> Aggiorna</button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          <Target size={32} className="mx-auto mb-2 opacity-30"/>
          <p>Nessun target trovato per questo periodo.</p>
          <p className="text-xs mt-1">Usare il pannello "Assegna Target" nella pagina KPI per impostare i target.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Operatore</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Sede</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Periodo</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Quantum Target</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Quorum</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(t => (
                <tr key={t.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {editId === t.id ? (
                      <input className="input text-sm w-32" value={editForm.operator_name||editForm.operator_code||''} readOnly/>
                    ) : (t.operator_name || t.operator_code)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${t.sede === 'MA' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>{t.sede}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{t.period}</td>
                  <td className="px-4 py-3 text-right">
                    {editId === t.id ? (
                      <input type="number" step="0.01" className="input text-sm w-24 text-right" value={editForm.quantum_target||''} onChange={e => setEditForm(f => ({ ...f, quantum_target: e.target.value }))}/>
                    ) : (
                      <span className="text-violet-600 font-medium">{t.quantum_target != null ? `€ ${t.quantum_target}` : '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editId === t.id ? (
                      <input type="number" step="0.01" className="input text-sm w-24 text-right" value={editForm.quorum||''} onChange={e => setEditForm(f => ({ ...f, quorum: e.target.value }))}/>
                    ) : (
                      <span className="text-amber-600">{t.quorum != null ? `€ ${t.quorum}` : '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {editId === t.id ? (
                        <>
                          <button onClick={saveEdit} disabled={saving} className="text-emerald-600 hover:text-emerald-700 p-1"><Save size={14}/></button>
                          <button onClick={() => setEditId(null)} className="text-gray-400 p-1"><X size={14}/></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => { setEditId(t.id); setEditForm({ ...t }) }} className="text-gray-400 hover:text-violet-600 p-1"><Edit3 size={13}/></button>
                          <button onClick={() => doDelete(t.id)} className="text-gray-400 hover:text-red-500 p-1"><Trash2 size={13}/></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — DATABASE VIEWER
// ═══════════════════════════════════════════════════════════════════════════
const VISIBLE_TABLES = [
  { key: 'employees',           label: 'Dipendenti',       color: 'violet' },
  { key: 'roles',               label: 'Ruoli',            color: 'amber' },
  { key: 'kpi_targets',         label: 'KPI Targets',      color: 'violet' },
  { key: 'buste_paga',          label: 'Buste Paga',       color: 'blue' },
  { key: 'kpi_revenues',        label: 'KPI Revenues',     color: 'blue' },
  { key: 'chiusure_giornaliere',label: 'Chiusure',         color: 'gray' },
  { key: 'fatture_importate',   label: 'Fatture',          color: 'gray' },
  { key: 'fornitori_fatture',   label: 'Fornitori',        color: 'gray' },
  { key: 'shifts',              label: 'Turni',            color: 'gray' },
]

function DatabaseTab({ onToast }) {
  const [selected, setSelected] = useState(null)
  const [rows,     setRows]     = useState([])
  const [loading,  setLoading]  = useState(false)
  const [cols,     setCols]     = useState([])

  const loadTable = async (key) => {
    setSelected(key); setLoading(true)
    try {
      const data = await adminApi.queryTable(key, 100)
      setRows(data)
      setCols(data.length > 0 ? Object.keys(data[0]).filter(k => k !== 'xml_raw') : [])
    } catch(e) { onToast({ type: 'err', text: e.message }) }
    finally { setLoading(false) }
  }

  const fmt = (v) => {
    if (v === null || v === undefined) return <span className="text-gray-300 text-xs">null</span>
    if (typeof v === 'boolean') return <span className={v ? 'text-emerald-600' : 'text-red-400'}>{String(v)}</span>
    if (typeof v === 'object') return <span className="text-xs text-gray-500">{JSON.stringify(v).slice(0,40)}…</span>
    const s = String(v)
    return s.length > 50 ? s.slice(0,50)+'…' : s
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Visualizza i dati grezzi delle tabelle Supabase (sola lettura, max 100 righe).</p>
      <div className="flex flex-wrap gap-2">
        {VISIBLE_TABLES.map(t => (
          <button key={t.key} onClick={() => loadTable(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${selected === t.key ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="text-gray-400 text-sm text-center py-8">Caricamento...</div>}

      {!loading && selected && rows.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-sm">Tabella vuota.</div>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                {cols.map(c => (
                  <th key={c} className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50/50">
                  {cols.map(c => (
                    <td key={c} className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmt(row[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-400 text-center py-2">{rows.length} righe (max 100)</p>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — BACKUP
// ═══════════════════════════════════════════════════════════════════════════
function BackupTab({ onToast }) {
  const [backups,    setBackups]    = useState([])
  const [loading,    setLoading]    = useState(false)
  const [creating,   setCreating]   = useState(false)
  const [restoring,  setRestoring]  = useState(null)   // id del backup in restore
  const [progress,   setProgress]   = useState('')
  const [preview,    setPreview]    = useState(null)   // dati anteprima per conferma
  const [label,      setLabel]      = useState('')
  const [desc,       setDesc]       = useState('')
  const [selected,   setSelected]   = useState([])     // per selezione multipla cancellazione

  const load = useCallback(async () => {
    setLoading(true)
    try { setBackups(await adminApi.listBackups()) }
    catch(e) { onToast({ type: 'err', text: e.message }) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const createBackup = async () => {
    setCreating(true)
    try {
      const result = await adminApi.createBackup(label || '', desc || '')
      onToast({ type: 'ok', text: `✅ Backup creato — ${result.size_kb} KB` })
      setLabel(''); setDesc('')
      await load()
    } catch(e) {
      onToast({ type: 'err', text: 'Errore backup: ' + e.message })
    } finally { setCreating(false) }
  }

  // Mostra anteprima prima di ripristinare
  const handlePreviewRestore = async (backup) => {
    try {
      const p = await adminApi.previewRestore(backup.id)
      setPreview({ ...p, id: backup.id })
    } catch(e) { onToast({ type: 'err', text: 'Anteprima fallita: ' + e.message }) }
  }

  // Esegue il restore 1-click
  const handleRestore = async () => {
    if (!preview) return
    setRestoring(preview.id)
    setProgress('Avvio ripristino...')
    try {
      const result = await adminApi.restoreBackup(preview.id, (msg) => setProgress(msg))
      const totalOk = result.total_restored
      const errors  = Object.values(result.results).reduce((s, r) => s + (r.errors || 0), 0)
      onToast({ type: errors > 0 ? 'err' : 'ok',
        text: `Ripristino completato: ${totalOk} righe ripristinate${errors > 0 ? `, ${errors} errori` : ''}` })
      setPreview(null)
    } catch(e) {
      onToast({ type: 'err', text: 'Ripristino fallito: ' + e.message })
    } finally {
      setRestoring(null)
      setProgress('')
    }
  }

  const deleteSelected = async () => {
    if (!selected.length) return
    if (!confirm(`Eliminare ${selected.length} backup selezionati?`)) return
    try {
      await Promise.all(selected.map(id => adminApi.deleteBackup(id)))
      onToast({ type: 'ok', text: `${selected.length} backup eliminati` })
      setSelected([])
      await load()
    } catch(e) { onToast({ type: 'err', text: e.message }) }
  }

  const toggleSelect = (id) => setSelected(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  )

  const selectAll  = () => setSelected(backups.map(b => b.id))
  const clearSelect = () => setSelected([])

  const fmtDate = (s) => s ? new Date(s).toLocaleString('it-IT', {
    day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
  }) : '—'

  return (
    <div className="space-y-5">

      {/* Crea backup */}
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-violet-800 flex items-center gap-2">
          <Archive size={15}/> Crea nuovo snapshot
        </h3>
        <div className="grid grid-cols-1 gap-2">
          <input className="input w-full text-sm" placeholder="Etichetta (es. Prima aggiornamento marzo)"
            value={label} onChange={e => setLabel(e.target.value)} />
          <input className="input w-full text-sm" placeholder="Descrizione opzionale"
            value={desc} onChange={e => setDesc(e.target.value)} />
        </div>
        <button onClick={createBackup} disabled={creating} className="btn btn-primary w-full text-sm">
          {creating ? <><RefreshCw size={14} className="animate-spin"/> Backup in corso...</>
                    : <><Archive size={14}/> Crea backup completo</>}
        </button>
        <p className="text-xs text-violet-600 leading-relaxed">
          Salva employees · chiusure · fornitori · fatture · buste paga · turni · KPI · moduli · impostazioni
        </p>
      </div>

      {/* Lista backup */}
      <div>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-gray-700">
            Backup salvati {backups.length > 0 && <span className="ml-1 text-xs text-gray-400">({backups.length})</span>}
          </h3>
          <div className="flex gap-2">
            {selected.length > 0 && (
              <button onClick={deleteSelected}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 font-medium">
                <Trash2 size={11}/> Elimina {selected.length} selezionati
              </button>
            )}
            {backups.length > 0 && (
              <button onClick={selected.length === backups.length ? clearSelect : selectAll}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200">
                {selected.length === backups.length ? 'Deseleziona' : 'Seleziona tutti'}
              </button>
            )}
            <button onClick={load} className="p-1.5 rounded-lg hover:bg-gray-100">
              <RefreshCw size={13} className={loading ? 'animate-spin text-gray-400' : 'text-gray-400'}/>
            </button>
          </div>
        </div>

        {loading && <div className="text-gray-400 text-sm text-center py-6">Caricamento...</div>}

        {!loading && backups.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm border-2 border-dashed rounded-xl">
            Nessun backup ancora. Crea il primo!
          </div>
        )}

        <div className="space-y-2">
          {backups.map(b => (
            <div key={b.id}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                selected.includes(b.id) ? 'bg-violet-50 border-violet-200' : 'bg-white border-gray-100 shadow-sm'
              }`}>
              <input type="checkbox" checked={selected.includes(b.id)} onChange={() => toggleSelect(b.id)}
                className="rounded accent-violet-500 flex-shrink-0"/>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{b.label}</p>
                {b.description && <p className="text-xs text-gray-400 truncate">{b.description}</p>}
                <p className="text-xs text-gray-400">{fmtDate(b.created_at)} · {b.size_kb || 0} KB</p>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                <button onClick={() => handlePreviewRestore(b)}
                  disabled={restoring === b.id}
                  className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all ${
                    restoring === b.id
                      ? 'bg-orange-100 text-orange-600 cursor-not-allowed'
                      : 'bg-green-50 text-green-700 hover:bg-green-100'
                  }`}>
                  {restoring === b.id ? <RefreshCw size={12} className="animate-spin"/> : '↩ Ripristina'}
                </button>
                <button onClick={() => { if(confirm(`Eliminare "${b.label}"?`)) adminApi.deleteBackup(b.id).then(load) }}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 font-medium">
                  <Trash2 size={12}/>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Progress restore */}
      {restoring && progress && (
        <div className="p-3 rounded-xl bg-orange-50 border border-orange-200 text-xs text-orange-700 flex items-center gap-2">
          <RefreshCw size={13} className="animate-spin flex-shrink-0"/>
          {progress}
        </div>
      )}

      {/* Modal anteprima restore */}
      {preview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-gray-900">Conferma Ripristino</h3>
                <p className="text-xs text-gray-500 mt-0.5">Backup: {preview.label}</p>
                <p className="text-xs text-gray-400">{fmtDate(preview.created_at)}</p>
              </div>
              <button onClick={() => setPreview(null)} className="p-1 rounded-lg hover:bg-gray-100">
                <X size={16}/>
              </button>
            </div>

            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-700">
              ⚠️ I dati attuali verranno <strong>sovrascritti</strong> dai dati del backup. L'operazione è irreversibile.
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-gray-600 mb-2">Tabelle che verranno ripristinate:</p>
              <div className="grid grid-cols-2 gap-1.5">
                {preview.tables.map(t => (
                  <div key={t.table} className="flex items-center justify-between bg-gray-50 rounded-lg px-2.5 py-1.5 text-xs">
                    <span className="font-mono text-gray-600 truncate">{t.table}</span>
                    <span className="font-bold text-gray-800 ml-2">{t.rows}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setPreview(null)}
                className="btn btn-secondary flex-1 text-sm">Annulla</button>
              <button onClick={handleRestore} disabled={!!restoring}
                className="btn btn-primary flex-1 text-sm bg-orange-500 hover:bg-orange-600">
                {restoring ? <RefreshCw size={14} className="animate-spin"/> : '↩ Ripristina ora'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-700 space-y-1">
        <p className="font-medium">Come funziona il ripristino:</p>
        <p>1. Clicca <strong>↩ Ripristina</strong> su un backup</p>
        <p>2. Controlla l'anteprima delle tabelle che verranno sovrascritte</p>
        <p>3. Clicca <strong>Ripristina ora</strong> — Claude esegue tutto automaticamente</p>
        <p>4. Tutti i dati tornano alla versione del backup selezionato</p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — SEDI (gestione sedi / location)
// ═══════════════════════════════════════════════════════════════════════════
const SEDE_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6','#f97316','#84cc16','#06b6d4']

function SediTab({ onToast }) {
  const [sedi,     setSedi]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [editId,   setEditId]   = useState(null)
  const [editForm, setEditForm] = useState({})
  const [addMode,  setAddMode]  = useState(false)
  const [addForm,  setAddForm]  = useState({ code: '', name: '', city: '', color: '#6366f1' })
  const [copying,  setCopying]  = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setSedi(await sediApi.getAll()) }
    catch(e) { onToast({ type: 'err', text: e.message }) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const startEdit = (s) => {
    setEditId(s.id)
    setEditForm({ code: s.code, name: s.name, city: s.city || '', color: s.color || '#6366f1' })
  }

  const saveEdit = async () => {
    setSaving(true)
    try {
      await sediApi.update(editId, editForm)
      onToast({ type: 'ok', text: 'Sede aggiornata' })
      setEditId(null); load()
    } catch(e) { onToast({ type: 'err', text: e.message }) }
    finally { setSaving(false) }
  }

  const doAdd = async () => {
    if (!addForm.code || !addForm.name) return onToast({ type: 'err', text: 'Codice e nome obbligatori' })
    if (addForm.code.length > 5) return onToast({ type: 'err', text: 'Codice max 5 caratteri' })
    setSaving(true)
    try {
      await sediApi.create(addForm)
      onToast({ type: 'ok', text: `Sede ${addForm.code.toUpperCase()} creata — struttura replicata` })
      setAddMode(false)
      setAddForm({ code: '', name: '', city: '', color: '#6366f1' })
      load()
    } catch(e) { onToast({ type: 'err', text: e.message }) }
    finally { setSaving(false) }
  }

  const doDelete = async (s) => {
    if (!window.confirm(`Eliminare la sede ${s.code} — ${s.name}?\nQuesta azione non elimina i dati storici.`)) return
    try {
      await sediApi.delete(s.id)
      onToast({ type: 'ok', text: `Sede ${s.code} rimossa` })
      load()
    } catch(e) { onToast({ type: 'err', text: e.message }) }
  }

  const doCopy = (s) => {
    setCopying(s.id === copying ? null : s.id)
    setAddForm({ code: '', name: s.name + ' (copia)', city: s.city || '', color: s.color || '#6366f1' })
    setAddMode(true)
  }

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">Caricamento sedi...</div>

  return (
    <div className="space-y-5">
      {/* Lista sedi esistenti */}
      <SectionCard title="Sedi attive" sub={`${sedi.length} location configurate`} icon={MapPin} color="violet">
        {sedi.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Nessuna sede configurata</p>
        ) : (
          <div className="space-y-2">
            {sedi.map(s => (
              <div key={s.id} className="rounded-xl border border-gray-100 overflow-hidden">
                {editId === s.id ? (
                  <div className="p-4 bg-gray-50 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Codice sede *</label>
                        <input className="input w-full text-sm uppercase"
                          value={editForm.code}
                          onChange={e => setEditForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                          maxLength={5} placeholder="es. MA"/>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Nome *</label>
                        <input className="input w-full text-sm"
                          value={editForm.name}
                          onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                          placeholder="es. Sede MA"/>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Città</label>
                      <input className="input w-full text-sm"
                        value={editForm.city}
                        onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))}
                        placeholder="es. Cagliari"/>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-2">Colore</label>
                      <div className="flex gap-2 flex-wrap">
                        {SEDE_COLORS.map(c => (
                          <button key={c} onClick={() => setEditForm(f => ({ ...f, color: c }))}
                            className={`w-7 h-7 rounded-full border-2 transition-transform ${editForm.color === c ? 'border-gray-800 scale-110' : 'border-transparent hover:scale-105'}`}
                            style={{ backgroundColor: c }}/>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditId(null)} className="btn btn-secondary text-sm flex-1">Annulla</button>
                      <button onClick={saveEdit} disabled={saving} className="btn btn-primary text-sm flex-1 flex items-center justify-center gap-2">
                        <Save size={13}/>{saving ? 'Salvando...' : 'Salva'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm text-white shadow-sm"
                        style={{ backgroundColor: s.color || '#6366f1' }}>
                        {s.code}
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-gray-800">{s.name}</p>
                        <p className="text-xs text-gray-400">{s.city || '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button title="Duplica struttura in nuova sede" onClick={() => doCopy(s)}
                        className="text-gray-400 hover:text-blue-500 p-1.5 rounded-lg hover:bg-blue-50 transition-colors">
                        <Copy size={13}/>
                      </button>
                      <button onClick={() => startEdit(s)}
                        className="text-gray-400 hover:text-violet-600 p-1.5 rounded-lg hover:bg-violet-50 transition-colors">
                        <Edit3 size={13}/>
                      </button>
                      <button onClick={() => doDelete(s)}
                        className="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                        <Trash2 size={13}/>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Aggiungi nuova sede */}
      <SectionCard title="Aggiungi nuova sede" sub="Crea una nuova location — eredita la struttura moduli" icon={Building2} color="blue">
        {!addMode ? (
          <button onClick={() => setAddMode(true)}
            className="btn btn-primary text-sm flex items-center gap-2 w-full justify-center">
            <Plus size={14}/> Nuova sede
          </button>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Codice sede * <span className="text-gray-400">(max 5 car.)</span></label>
                <input className="input w-full text-sm uppercase"
                  value={addForm.code}
                  onChange={e => setAddForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  maxLength={5} placeholder="es. FI"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Nome *</label>
                <input className="input w-full text-sm"
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="es. Firenze Centro"/>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Città</label>
              <input className="input w-full text-sm"
                value={addForm.city}
                onChange={e => setAddForm(f => ({ ...f, city: e.target.value }))}
                placeholder="es. Firenze"/>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-2">Colore badge</label>
              <div className="flex gap-2 flex-wrap">
                {SEDE_COLORS.map(c => (
                  <button key={c} onClick={() => setAddForm(f => ({ ...f, color: c }))}
                    className={`w-7 h-7 rounded-full border-2 transition-transform ${addForm.color === c ? 'border-gray-800 scale-110' : 'border-transparent hover:scale-105'}`}
                    style={{ backgroundColor: c }}/>
                ))}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-700">
              <p className="font-semibold mb-1">Cosa viene replicato automaticamente:</p>
              <p>• Struttura moduli (Dashboard, Chiusure, Venduto, KPI, Fornitori…)</p>
              <p>• Configurazione ruoli e KPI target</p>
              <p>• La sede sarà subito selezionabile nei filtri di tutti i moduli</p>
            </div>

            <div className="flex gap-2">
              <button onClick={() => { setAddMode(false); setCopying(null) }} className="btn btn-secondary text-sm flex-1">Annulla</button>
              <button onClick={doAdd} disabled={saving} className="btn btn-primary text-sm flex-1 flex items-center justify-center gap-2">
                <Building2 size={13}/>{saving ? 'Creando...' : `Crea sede ${addForm.code || '...'}`}
              </button>
            </div>
          </div>
        )}
      </SectionCard>

      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-700 space-y-1">
        <p className="font-semibold">Come funzionano le sedi:</p>
        <p>• Ogni sede ha un codice univoco (es. MA, PN, FI) usato come filtro in tutti i moduli</p>
        <p>• Eliminare una sede non cancella i dati storici — li nasconde solo dai filtri</p>
        <p>• Il codice sede non può essere cambiato dopo la creazione (usato come chiave FK)</p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — MEMORIA CRM
// ═══════════════════════════════════════════════════════════════════════════
function MemoriaTab({ onToast }) {
  const [rows,        setRows]        = useState([])
  const [loading,     setLoading]     = useState(true)
  const [filterSez,   setFilterSez]   = useState('')
  const [editId,      setEditId]      = useState(null)
  const [editForm,    setEditForm]    = useState({ sezione: '', chiave: '', valore: '', valore_json: '' })
  const [addMode,     setAddMode]     = useState(false)
  const [addForm,     setAddForm]     = useState({ sezione: 'generale', chiave: '', valore: '', fonte: 'admin' })
  const [saving,      setSaving]      = useState(false)
  const [expandJson,  setExpandJson]  = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('crm_memory')
        .select('*')
        .order('sezione')
        .order('chiave')
      if (error) throw error
      setRows(data || [])
    } catch (e) { onToast({ type: 'err', text: e.message }) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (!filterSez) return rows
    return rows.filter(r => r.sezione === filterSez)
  }, [rows, filterSez])

  const sezioni = useMemo(() => [...new Set(rows.map(r => r.sezione))].sort(), [rows])

  const startEdit = (r) => {
    setEditId(r.id)
    setEditForm({
      sezione: r.sezione,
      chiave: r.chiave,
      valore: r.valore || '',
      valore_json: r.valore_json ? JSON.stringify(r.valore_json, null, 2) : '',
    })
  }

  const saveEdit = async () => {
    setSaving(true)
    try {
      let vj = null
      if (editForm.valore_json.trim()) {
        try { vj = JSON.parse(editForm.valore_json) } catch { throw new Error('JSON non valido nel campo valore_json') }
      }
      const { error } = await supabase.from('crm_memory').update({
        sezione: editForm.sezione,
        chiave: editForm.chiave,
        valore: editForm.valore || null,
        valore_json: vj,
        fonte: 'admin',
        updated_at: new Date().toISOString(),
      }).eq('id', editId)
      if (error) throw error
      onToast({ type: 'ok', text: 'Memoria aggiornata' })
      setEditId(null); load()
    } catch (e) { onToast({ type: 'err', text: e.message }) }
    finally { setSaving(false) }
  }

  const deleteRow = async (id, chiave) => {
    if (!window.confirm(`Eliminare "${chiave}"?`)) return
    try {
      const { error } = await supabase.from('crm_memory').delete().eq('id', id)
      if (error) throw error
      onToast({ type: 'ok', text: 'Voce eliminata' }); load()
    } catch (e) { onToast({ type: 'err', text: e.message }) }
  }

  const doAdd = async () => {
    if (!addForm.chiave) return onToast({ type: 'err', text: 'Chiave obbligatoria' })
    setSaving(true)
    try {
      const { error } = await supabase.from('crm_memory').upsert({
        sezione: addForm.sezione,
        chiave: addForm.chiave.toLowerCase().replace(/\s+/g, '_'),
        valore: addForm.valore || null,
        fonte: 'admin',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'sezione,chiave' })
      if (error) throw error
      onToast({ type: 'ok', text: 'Memoria salvata' })
      setAddMode(false); setAddForm({ sezione: 'generale', chiave: '', valore: '', fonte: 'admin' }); load()
    } catch (e) { onToast({ type: 'err', text: e.message }) }
    finally { setSaving(false) }
  }

  const SEZIONE_COLORS = {
    turni: 'bg-blue-100 text-blue-700',
    kpi: 'bg-emerald-100 text-emerald-700',
    generale: 'bg-gray-100 text-gray-700',
    chat: 'bg-purple-100 text-purple-700',
    fornitori: 'bg-orange-100 text-orange-700',
  }
  const sezColor = (s) => SEZIONE_COLORS[s] || 'bg-violet-100 text-violet-700'

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">Caricamento memoria...</div>

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-gray-800">Memoria CRM</h3>
          <p className="text-xs text-gray-400 mt-0.5">{rows.length} voci salvate da Claude e dalla chat</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterSez}
            onChange={e => setFilterSez(e.target.value)}
            className="input text-sm py-1.5 px-2 pr-7"
          >
            <option value="">Tutte le sezioni</option>
            {sezioni.map(s => <option key={s} value={s}>{s} ({rows.filter(r => r.sezione === s).length})</option>)}
          </select>
          <button onClick={load} className="btn btn-secondary py-1.5 px-3 text-sm flex items-center gap-1.5">
            <RefreshCw size={13}/> Aggiorna
          </button>
          <button onClick={() => setAddMode(true)} className="btn btn-primary py-1.5 px-3 text-sm flex items-center gap-1.5">
            <Plus size={13}/> Nuova voce
          </button>
        </div>
      </div>

      {/* Add form */}
      {addMode && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-violet-800">Aggiungi voce di memoria</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Sezione</label>
              <input className="input w-full text-sm" placeholder="es. turni, kpi, generale" value={addForm.sezione} onChange={e => setAddForm(f => ({ ...f, sezione: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Chiave</label>
              <input className="input w-full text-sm" placeholder="es. obiettivo_costo_personale" value={addForm.chiave} onChange={e => setAddForm(f => ({ ...f, chiave: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Valore</label>
            <textarea className="input w-full text-sm h-20 resize-none" placeholder="Testo libero o nota per Claude..." value={addForm.valore} onChange={e => setAddForm(f => ({ ...f, valore: e.target.value }))} />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setAddMode(false)} className="btn btn-secondary text-sm py-1.5 px-3">Annulla</button>
            <button onClick={doAdd} disabled={saving} className="btn btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5">
              <Save size={13}/>{saving ? 'Salvando...' : 'Salva'}
            </button>
          </div>
        </div>
      )}

      {/* Rows */}
      <div className="space-y-2">
        {filtered.length === 0 && <p className="text-sm text-gray-400 text-center py-6">Nessuna voce trovata.</p>}
        {filtered.map(row => (
          <div key={row.id} className="border border-gray-100 rounded-xl overflow-hidden">
            {editId === row.id ? (
              <div className="bg-gray-50 p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Sezione</label>
                    <input className="input w-full text-sm" value={editForm.sezione} onChange={e => setEditForm(f => ({ ...f, sezione: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Chiave</label>
                    <input className="input w-full text-sm" value={editForm.chiave} onChange={e => setEditForm(f => ({ ...f, chiave: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Valore testo</label>
                  <textarea className="input w-full text-sm h-20 resize-none" value={editForm.valore} onChange={e => setEditForm(f => ({ ...f, valore: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Valore JSON (opzionale)</label>
                  <textarea className="input w-full text-sm h-20 resize-none font-mono" placeholder='{"key": "value"}' value={editForm.valore_json} onChange={e => setEditForm(f => ({ ...f, valore_json: e.target.value }))} />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditId(null)} className="btn btn-secondary text-sm py-1.5 px-3">Annulla</button>
                  <button onClick={saveEdit} disabled={saving} className="btn btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5">
                    <Save size={13}/>{saving ? 'Salvando...' : 'Salva'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sezColor(row.sezione)}`}>{row.sezione}</span>
                    <span className="font-mono text-sm font-semibold text-gray-800">{row.chiave}</span>
                    {row.fonte && <span className="text-xs text-gray-400">via {row.fonte}</span>}
                  </div>
                  {row.valore && <p className="text-sm text-gray-600 line-clamp-2">{row.valore}</p>}
                  {row.valore_json && (
                    <div>
                      <button
                        onClick={() => setExpandJson(prev => ({ ...prev, [row.id]: !prev[row.id] }))}
                        className="text-xs text-violet-600 flex items-center gap-1 mt-1"
                      >
                        {expandJson[row.id] ? <EyeOff size={11}/> : <Eye size={11}/>}
                        {expandJson[row.id] ? 'Nascondi JSON' : 'Mostra JSON'}
                      </button>
                      {expandJson[row.id] && (
                        <pre className="text-xs bg-gray-100 rounded p-2 mt-1 overflow-auto max-h-40">{JSON.stringify(row.valore_json, null, 2)}</pre>
                      )}
                    </div>
                  )}
                  {row.updated_at && <p className="text-xs text-gray-400 mt-1">{new Date(row.updated_at).toLocaleString('it-IT')}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => startEdit(row)} className="p-1.5 text-gray-400 hover:text-violet-600 rounded-lg hover:bg-violet-50 transition-colors">
                    <Edit3 size={14}/>
                  </button>
                  <button onClick={() => deleteRow(row.id, row.chiave)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                    <Trash2 size={14}/>
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-semibold mb-1 flex items-center gap-1.5"><Brain size={14}/> Come funziona la memoria Claude</p>
        <p className="text-xs text-blue-700">
          Claude salva automaticamente note importanti usando il comando <code className="bg-blue-100 px-1 rounded">SALVA_MEMORIA[sezione/chiave]=valore</code> nelle risposte.
          Puoi anche chiedere esplicitamente: <em>"ricorda che il target costo personale è 28%"</em> e Claude scriverà in memoria.
        </p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — SYNC (Vercel + Supabase)
// ═══════════════════════════════════════════════════════════════════════════
function SyncTab({ onToast }) {
  const [tableStats, setTableStats] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [modules,    setModules]    = useState([])
  const [deployInfo, setDeployInfo] = useState(null)
  const [deploying,  setDeploying]  = useState(false)

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
  const PROJECT_REF  = SUPABASE_URL.match(/https:\/\/([^.]+)\./)?.[1] || ''

  const TABLE_LIST = [
    'employees', 'chiusure_giornaliere', 'venduto_camerieri', 'varianti_camerieri',
    'fatture_importate', 'fornitori_fatture', 'fatture_righe', 'buste_paga',
    'turni', 'turni_regole', 'turni_budget', 'crm_memory',
    'statistiche_tavoli',
  ]

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Carica count di ogni tabella
      const results = await Promise.allSettled(
        TABLE_LIST.map(async (tbl) => {
          const { count, error } = await supabase
            .from(tbl)
            .select('*', { count: 'exact', head: true })
          return { table: tbl, count: error ? null : count, error: error?.message }
        })
      )
      setTableStats(results.map(r => r.value || { table: '?', count: null, error: 'unknown' }))

      // Fix: la tabella reale è "modules" (modules_config non esiste)
      const { data: mods, error: errMods } = await supabase
        .from('modules')
        .select('id, name, description, enabled')
        .order('name')
      if (errMods) throw errMods
      if (mods) setModules(mods)

    } catch (e) { onToast({ type: 'err', text: e.message }) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleModule = async (mod) => {
    try {
      // Fix: toggle sulla tabella reale "modules" (id è text, es. 'dashboard')
      const { error } = await supabase
        .from('modules')
        .update({ enabled: !mod.enabled })
        .eq('id', mod.id)
      if (error) throw error
      onToast({ type: 'ok', text: `Modulo ${mod.name} ${!mod.enabled ? 'abilitato' : 'disabilitato'}` })
      load()
    } catch (e) { onToast({ type: 'err', text: e.message }) }
  }

  const copyDeployCmd = () => {
    navigator.clipboard?.writeText(`open ~/Library/CloudStorage/OneDrive-Personale/"CRM 140Grammi"/CRM-App/Deploy_Vercel.command`)
    onToast({ type: 'ok', text: 'Comando copiato' })
  }

  return (
    <div className="space-y-6">
      {/* Vercel Deploy */}
      <div>
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><Cloud size={16} className="text-violet-500"/> Deploy Vercel</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-gray-700">App CRM in produzione</p>
            <a
              href="https://client-dun-three-44.vercel.app"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-sm text-violet-600 hover:underline"
            >
              <Globe size={14}/> client-dun-three-44.vercel.app <ExternalLink size={11}/>
            </a>
            <div className="flex gap-2">
              <a
                href="https://vercel.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
              >
                <ExternalLink size={11}/> Dashboard Vercel
              </a>
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium text-amber-800 flex items-center gap-1.5"><Zap size={14}/> Per deployare:</p>
            <ol className="text-xs text-amber-700 space-y-1 list-decimal list-inside">
              <li>Apri Finder → cartella CRM-App</li>
              <li>Doppio click su <strong>Deploy_Vercel.command</strong></li>
              <li>Attendi build + deploy automatico</li>
            </ol>
            <p className="text-xs text-amber-600 mt-2">Oppure da terminale:</p>
            <code className="text-xs bg-amber-100 text-amber-800 rounded px-2 py-1 block font-mono break-all">
              cd CRM-App/client && npx vercel deploy --prod --prebuilt
            </code>
          </div>
        </div>
      </div>

      {/* Supabase */}
      <div>
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <Database size={16} className="text-violet-500"/> Supabase — Tabelle
          <button onClick={load} className="ml-auto text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
            <RefreshCw size={11}/> Aggiorna
          </button>
        </h3>
        {loading ? (
          <div className="text-sm text-gray-400 py-4 text-center">Conteggio righe...</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {tableStats.map(({ table, count, error }) => (
              <div key={table} className={`rounded-lg border px-3 py-2.5 ${error ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
                <p className="font-mono text-xs font-semibold text-gray-700 truncate">{table}</p>
                {error
                  ? <p className="text-xs text-red-400 mt-0.5">non disponibile</p>
                  : <p className="text-sm font-bold text-violet-600 mt-0.5">{count?.toLocaleString('it-IT') ?? '—'} <span className="text-xs font-normal text-gray-400">righe</span></p>
                }
              </div>
            ))}
          </div>
        )}
        {PROJECT_REF && (
          <a
            href={`https://supabase.com/dashboard/project/${PROJECT_REF}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-violet-600 mt-3"
          >
            <ExternalLink size={11}/> Apri dashboard Supabase
          </a>
        )}
      </div>

      {/* Moduli abilitati */}
      {modules.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Zap size={16} className="text-violet-500"/> Moduli CRM abilitati
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {modules.map(mod => (
              <div key={mod.id} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2.5 bg-white">
                <span className="text-sm text-gray-700 font-medium truncate mr-2">{mod.name}</span>
                <button
                  onClick={() => toggleModule(mod)}
                  className={`shrink-0 transition-colors ${mod.enabled ? 'text-emerald-500 hover:text-red-400' : 'text-gray-300 hover:text-emerald-500'}`}
                >
                  {mod.enabled ? <ToggleRight size={22}/> : <ToggleLeft size={22}/>}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edge Functions */}
      <div>
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <Zap size={16} className="text-violet-500"/> Edge Functions Supabase
        </h3>
        <div className="space-y-2">
          {[
            { name: 'claude-proxy', desc: 'Proxy sicuro Claude AI — chiave API solo server', status: 'live', color: 'emerald' },
          ].map(fn => (
            <div key={fn.name} className={`flex items-center gap-3 border border-${fn.color}-200 bg-${fn.color}-50 rounded-lg px-4 py-3`}>
              <div className={`w-2 h-2 rounded-full bg-${fn.color}-500`}/>
              <div className="flex-1">
                <p className={`font-mono text-sm font-semibold text-${fn.color}-800`}>{fn.name}</p>
                <p className={`text-xs text-${fn.color}-600`}>{fn.desc}</p>
              </div>
              <span className={`text-xs font-medium text-${fn.color}-700 bg-${fn.color}-100 px-2 py-0.5 rounded-full`}>{fn.status}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Per impostare la chiave Anthropic: Supabase Dashboard → Edge Functions → claude-proxy → Secrets → aggiungi <code className="bg-gray-100 px-1 rounded">ANTHROPIC_API_KEY</code>
        </p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — UNIONE DOPPIONI
// ═══════════════════════════════════════════════════════════════════════════

// Calcola similarità tra 2 stringhe (0-100)
function nomeSimilarity(a, b) {
  const na = (a || '').toUpperCase().replace(/\s+/g, ' ').trim()
  const nb = (b || '').toUpperCase().replace(/\s+/g, ' ').trim()
  if (!na || !nb) return 0
  if (na === nb) return 100
  // Uno è prefisso dell'altro
  if (na.startsWith(nb) || nb.startsWith(na)) {
    const shorter = Math.min(na.length, nb.length)
    const longer  = Math.max(na.length, nb.length)
    return Math.round(85 * shorter / longer)
  }
  // Prefisso comune ≥ 4 caratteri
  let prefix = 0
  for (let i = 0; i < Math.min(na.length, nb.length); i++) {
    if (na[i] === nb[i]) prefix++; else break
  }
  if (prefix >= 4) return Math.round(55 * prefix / Math.max(na.length, nb.length) * 1.5)
  // Un nome contiene l'altro come sottostringa
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length)
    return Math.round(60 * shorter / Math.max(na.length, nb.length))
  }
  return 0
}

function ScoreBadge({ score }) {
  const cfg = score >= 80
    ? { bg: 'bg-orange-100 text-orange-700 border-orange-200', label: '🔴 Alta' }
    : score >= 55
    ? { bg: 'bg-amber-100 text-amber-700 border-amber-200', label: '🟡 Media' }
    : { bg: 'bg-gray-100 text-gray-500 border-gray-200', label: '⚪ Bassa' }
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.bg}`}>{cfg.label} {score}%</span>
  )
}

function MergePreviewModal({ pair, tipo, onConfirm, onClose, loading }) {
  // pair = { keep: emp, remove: emp|op }
  const { keep, remove } = pair
  const [keepId, setKeepId] = React.useState(keep.id)
  const finalKeep   = keepId === keep.id   ? keep   : remove
  const finalRemove = keepId === keep.id   ? remove : keep
  const isEmpEmp = tipo === 'emp-emp'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
            <GitMerge size={18} className="text-orange-600"/>
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Conferma Unione</h3>
            <p className="text-xs text-gray-400">Scegli il profilo principale da mantenere</p>
          </div>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600"><X size={18}/></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Selezione profilo da tenere (solo emp-emp) */}
          {isEmpEmp && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Quale profilo mantenere?</p>
              {[keep, remove].map(emp => (
                <label key={emp.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    keepId === emp.id ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                  <input type="radio" checked={keepId === emp.id} onChange={() => setKeepId(emp.id)} className="accent-emerald-600"/>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-800 text-sm">{emp.name}</p>
                    <p className="text-xs text-gray-400">{emp.role || '—'} · Sede {emp.sede || (emp.location === 'MAMELI' ? 'MA' : 'PN')}</p>
                  </div>
                  {keepId === emp.id && <span className="text-xs bg-emerald-600 text-white px-2 py-0.5 rounded-full font-semibold">✓ Tengo</span>}
                </label>
              ))}
            </div>
          )}

          {/* Riepilogo operazione */}
          <div className="bg-gray-50 rounded-xl p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Cosa succederà</p>
            <div className="flex items-center gap-3 text-sm">
              <div className="flex-1 bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-center">
                <p className="text-[10px] text-emerald-600 font-semibold mb-0.5">✓ PROFILO PRINCIPALE</p>
                <p className="font-bold text-gray-800 text-xs truncate">{isEmpEmp ? finalKeep.name : keep.name}</p>
              </div>
              <ArrowRight size={16} className="text-gray-400 flex-shrink-0"/>
              <div className="flex-1 bg-red-50 border border-red-200 rounded-lg p-2 text-center">
                <p className="text-[10px] text-red-500 font-semibold mb-0.5">✗ VERRÀ DISATTIVATO</p>
                <p className="font-bold text-gray-600 text-xs truncate line-through">{isEmpEmp ? finalRemove.name : remove.name || remove.operatore}</p>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 space-y-1">
            <p className="font-semibold">Cosa viene sincronizzato:</p>
            <p>• <strong>Mappature venduto</strong> (employee_operator_mapping) → collegate al profilo principale</p>
            <p>• <strong>Buste paga</strong> → trasferite al profilo principale</p>
            <p>• <strong>Turni</strong> (shifts) → aggiornati con il profilo principale</p>
            {isEmpEmp && <p>• <strong>Alias nome</strong> → il nome del profilo rimosso diventa alias per il match buste paga</p>}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
            ⚠️ L'operazione <strong>non elimina</strong> nessun dato storico. Il profilo secondario viene solo disattivato.
          </div>
        </div>

        <div className="p-5 pt-0 flex gap-3">
          <button onClick={onClose} className="flex-1 btn btn-secondary">Annulla</button>
          <button onClick={() => onConfirm(isEmpEmp ? finalKeep : keep, isEmpEmp ? finalRemove : remove)}
            disabled={loading}
            className="flex-1 btn btn-primary bg-orange-500 hover:bg-orange-600 border-orange-500 flex items-center justify-center gap-2">
            {loading ? <><RefreshCw size={14} className="animate-spin"/> Elaboro...</>
                     : <><GitMerge size={14}/> Unisci ora</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function UnioneDoppioniTab({ onToast }) {
  const [employees,   setEmployees]   = useState([])
  const [mappings,    setMappings]    = useState([])   // employee_operator_mapping
  const [operators,   setOperators]   = useState([])   // kpi_revenues operators (distinti)
  const [loading,     setLoading]     = useState(true)
  const [merging,     setMerging]     = useState(false)
  const [preview,     setPreview]     = useState(null)  // { keep, remove, tipo }
  const [mergedIds,   setMergedIds]   = useState(new Set())

  // Ricerca manuale
  const [searchA, setSearchA] = useState('')
  const [searchB, setSearchB] = useState('')
  const [selA,    setSelA]    = useState(null)
  const [selB,    setSelB]    = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Fix: la colonna "location" non esiste su employees (errore 42703 silenzioso → tab Unioni sempre vuota)
      const [{ data: emps, error: errEmps }, { data: maps, error: errMaps }] = await Promise.all([
        supabase.from('employees').select('id,name,role,sede,active,buste_paga_name,code').order('name'),
        supabase.from('employee_operator_mapping').select('id,op_name_ipratico,sede,employee_id,verified'),
      ])
      if (errEmps) throw errEmps
      if (errMaps) throw errMaps

      // Operatori distinti da kpi_revenues
      const { data: kvRows } = await supabase
        .from('kpi_revenues')
        .select('op,sede')
        .order('op')
      const opSet = {}
      for (const r of kvRows || []) {
        const k = `${r.sede}|${r.op}`
        if (!opSet[k]) opSet[k] = { operatore: r.op, sede: r.sede }
      }

      setEmployees(emps || [])
      setMappings(maps || [])
      setOperators(Object.values(opSet))
    } catch (e) { onToast({ type: 'err', text: e.message }) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Rileva coppie automaticamente ──────────────────────────────────────
  const autoPairs = useMemo(() => {
    const pairs = []
    const activeEmps = employees.filter(e => e.active)

    // 1. Employee ↔ Employee: stessa sede + nomi simili
    for (let i = 0; i < activeEmps.length; i++) {
      for (let j = i + 1; j < activeEmps.length; j++) {
        const a = activeEmps[i], b = activeEmps[j]
        const sedeA = a.sede || (a.location === 'MAMELI' ? 'MA' : 'PN')
        const sedeB = b.sede || (b.location === 'MAMELI' ? 'MA' : 'PN')
        if (sedeA !== sedeB) continue
        const score = nomeSimilarity(a.name, b.name)
        if (score >= 50) {
          pairs.push({ tipo: 'emp-emp', keep: a, remove: b, score, sede: sedeA })
        }
      }
    }

    // 2. Operator ↔ Employee: operatori kpi_revenues non collegati (o collegati a dipendente con nome diverso)
    const mappedOpKeys = new Set(mappings.filter(m => m.employee_id).map(m => `${m.sede}|${m.op_name_ipratico}`))
    const unmappedOps  = operators.filter(op => !mappedOpKeys.has(`${op.sede}|${op.operatore}`))

    for (const op of unmappedOps) {
      let best = null, bestScore = 0
      for (const emp of activeEmps) {
        const sedeEmp = emp.sede || (emp.location === 'MAMELI' ? 'MA' : 'PN')
        if (sedeEmp !== op.sede) continue
        // Controlla anche buste_paga_name come alias
        const names = [emp.name, emp.buste_paga_name].filter(Boolean)
        const score = Math.max(...names.map(n => nomeSimilarity(n, op.operatore)))
        if (score > bestScore && score >= 45) { bestScore = score; best = emp }
      }
      if (best) {
        pairs.push({ tipo: 'op-emp', keep: best, remove: op, score: bestScore, sede: op.sede })
      }
    }

    // Ordina per score decrescente
    return pairs.sort((a, b) => b.score - a.score)
  }, [employees, mappings, operators])

  // ── Esegui merge ───────────────────────────────────────────────────────
  const executeMerge = async (keep, remove) => {
    setMerging(true)
    const tipo = preview.tipo
    try {
      if (tipo === 'emp-emp') {
        // Trasferisci mappature operatore
        await supabase.from('employee_operator_mapping')
          .update({ employee_id: keep.id })
          .eq('employee_id', remove.id)
        // Trasferisci buste paga
        await supabase.from('buste_paga')
          .update({ employee_id: keep.id })
          .eq('employee_id', remove.id)
        // Trasferisci turni
        await supabase.from('shifts')
          .update({ employee_id: keep.id, employee_name: keep.name })
          .eq('employee_id', remove.id)
        // Imposta alias nome (buste_paga_name) se non già presente
        if (!keep.buste_paga_name && keep.name !== remove.name) {
          await supabase.from('employees')
            .update({ buste_paga_name: remove.name })
            .eq('id', keep.id)
        }
        // Disattiva il profilo secondario
        await supabase.from('employees')
          .update({ active: false })
          .eq('id', remove.id)

        setMergedIds(prev => new Set([...prev, remove.id]))
        onToast({ type: 'ok', text: `✅ Unione completata: ${keep.name} ← ${remove.name}` })

      } else if (tipo === 'op-emp') {
        // Collega operatore al dipendente tramite employee_operator_mapping
        const { data: existing } = await supabase
          .from('employee_operator_mapping')
          .select('id')
          .eq('op_name_ipratico', remove.operatore)
          .eq('sede', remove.sede)
          .maybeSingle()

        if (existing) {
          await supabase.from('employee_operator_mapping')
            .update({ employee_id: keep.id, verified: true })
            .eq('id', existing.id)
        } else {
          await supabase.from('employee_operator_mapping')
            .insert({ op_name_ipratico: remove.operatore, sede: remove.sede, employee_id: keep.id, verified: true })
        }
        // Imposta buste_paga_name = nome operatore se serve per match
        if (!keep.buste_paga_name && keep.name !== remove.operatore) {
          await supabase.from('employees')
            .update({ buste_paga_name: remove.operatore })
            .eq('id', keep.id)
        }

        const opKey = `${remove.sede}|${remove.operatore}`
        setMergedIds(prev => new Set([...prev, opKey]))
        onToast({ type: 'ok', text: `✅ ${remove.operatore} collegato a ${keep.name}` })
      }

      setPreview(null)
      load()
    } catch (e) {
      onToast({ type: 'err', text: 'Errore merge: ' + e.message })
    } finally {
      setMerging(false)
    }
  }

  // ── Filtro ricerca manuale ──────────────────────────────────────────────
  const filteredA = useMemo(() => {
    if (!searchA.trim()) return employees.filter(e => e.active).slice(0, 12)
    const s = searchA.toUpperCase()
    return employees.filter(e => e.active && (e.name || '').toUpperCase().includes(s))
  }, [employees, searchA])

  const filteredB = useMemo(() => {
    // Mostra sia dipendenti che operatori
    const s = searchB.toUpperCase()
    const emps = employees.filter(e => e.active && (!s || (e.name || '').toUpperCase().includes(s)))
    const ops  = operators.filter(op => (!s || (op.operatore || '').toUpperCase().includes(s)))
    if (!s) return [...emps.slice(0, 8), ...ops.slice(0, 6)]
    return [...emps.slice(0, 10), ...ops.slice(0, 8)]
  }, [employees, operators, searchB])

  // Determina paia già unite (da rimuovere dall'elenco)
  const visiblePairs = useMemo(() => autoPairs.filter(p => {
    if (p.tipo === 'emp-emp') return !mergedIds.has(p.remove.id)
    return !mergedIds.has(`${p.remove.sede}|${p.remove.operatore}`)
  }), [autoPairs, mergedIds])

  if (loading) return (
    <div className="text-gray-400 text-sm py-12 text-center flex flex-col items-center gap-3">
      <RefreshCw size={24} className="animate-spin opacity-40"/>
      <p>Analisi doppioni in corso...</p>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Preview modal */}
      {preview && (
        <MergePreviewModal
          pair={preview}
          tipo={preview.tipo}
          loading={merging}
          onConfirm={executeMerge}
          onClose={() => !merging && setPreview(null)}
        />
      )}

      {/* Banner riepilogo */}
      <div className={`rounded-2xl p-4 flex items-center gap-4 ${
        visiblePairs.length > 0
          ? 'bg-orange-50 border border-orange-200'
          : 'bg-emerald-50 border border-emerald-200'}`}>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
          visiblePairs.length > 0 ? 'bg-orange-100' : 'bg-emerald-100'}`}>
          {visiblePairs.length > 0
            ? <GitMerge size={22} className="text-orange-600"/>
            : <ShieldCheck size={22} className="text-emerald-600"/>}
        </div>
        <div className="flex-1">
          {visiblePairs.length > 0 ? (
            <>
              <p className="font-bold text-orange-800">{visiblePairs.length} possibili doppioni rilevati</p>
              <p className="text-xs text-orange-600 mt-0.5">
                Dipendenti o nomi operatori che sembrano essere la stessa persona. Uniscili per avere KPI, turni e costi in un unico profilo.
              </p>
            </>
          ) : (
            <>
              <p className="font-bold text-emerald-800">Nessun doppione rilevato</p>
              <p className="text-xs text-emerald-600 mt-0.5">Tutti gli operatori sono correttamente collegati ai dipendenti.</p>
            </>
          )}
        </div>
        <button onClick={load} className="btn btn-secondary text-xs flex items-center gap-1.5 flex-shrink-0">
          <RefreshCw size={12}/> Riscansiona
        </button>
      </div>

      {/* Lista doppioni auto-rilevati */}
      {visiblePairs.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-sm">
            <AlertCircle size={15} className="text-orange-500"/> Doppioni da verificare
          </h3>

          {visiblePairs.map((pair, i) => {
            const sedeColor = pair.sede === 'MA' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
            const isOpEmp   = pair.tipo === 'op-emp'
            const leftName  = pair.keep.name
            const rightName = isOpEmp ? pair.remove.operatore : pair.remove.name
            const leftSub   = `${pair.keep.role || '—'} · ${pair.keep.sede || (pair.keep.location === 'MAMELI' ? 'MA' : 'PN')}`
            const rightSub  = isOpEmp ? `Operatore iPratico · ${pair.remove.sede}` : `${pair.remove.role || '—'} · ${pair.remove.sede || (pair.remove.location === 'MAMELI' ? 'MA' : 'PN')}`

            return (
              <div key={i}
                className="bg-white rounded-2xl border border-orange-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                {/* Intestazione card */}
                <div className="flex items-center justify-between px-4 py-2 bg-orange-50 border-b border-orange-100">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sedeColor}`}>
                      Sede {pair.sede}
                    </span>
                    <span className="text-xs text-gray-400">
                      {isOpEmp ? '🎯 Operatore non collegato' : '👥 Dipendenti simili'}
                    </span>
                  </div>
                  <ScoreBadge score={pair.score}/>
                </div>

                {/* Corpo card */}
                <div className="p-4 grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
                  {/* Sinistra: profilo da tenere */}
                  <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200">
                    <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider mb-1">📋 Dipendente CRM</p>
                    <p className="font-bold text-gray-900 text-sm leading-tight">{leftName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{leftSub}</p>
                    {pair.keep.buste_paga_name && (
                      <p className="text-[10px] text-gray-400 mt-1">Alias: {pair.keep.buste_paga_name}</p>
                    )}
                  </div>

                  {/* Freccia centrale */}
                  <div className="flex flex-col items-center gap-1">
                    <ArrowLeftRight size={18} className="text-orange-400"/>
                    <span className="text-[10px] text-gray-400 text-center leading-tight">
                      {isOpEmp ? 'non\ncollegato' : 'stesso'}
                    </span>
                  </div>

                  {/* Destra: profilo/operatore da collegare */}
                  <div className={`${isOpEmp ? 'bg-purple-50 border-purple-200' : 'bg-red-50 border-red-200'} rounded-xl p-3 border`}>
                    <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${isOpEmp ? 'text-purple-600' : 'text-red-500'}`}>
                      {isOpEmp ? '📊 Operatore Venduto' : '👤 Profilo Duplicato'}
                    </p>
                    <p className="font-bold text-gray-900 text-sm leading-tight">{rightName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{rightSub}</p>
                  </div>
                </div>

                {/* Azioni */}
                <div className="px-4 pb-3 flex gap-2 justify-end">
                  <button
                    onClick={() => setPreview({ ...pair })}
                    className="btn btn-primary bg-orange-500 hover:bg-orange-600 border-orange-500 text-sm flex items-center gap-2">
                    <GitMerge size={14}/>
                    {isOpEmp ? 'Collega Operatore' : 'Unisci Profili'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Sezione unione manuale */}
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Link2 size={16} className="text-violet-500"/>
          <h3 className="font-semibold text-gray-800 text-sm">Unione manuale</h3>
          <span className="text-xs text-gray-400">— cerca e seleziona i 2 profili da unire</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Profilo A */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              📋 Profilo da Tenere (dipendente CRM)
            </label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input className="input pl-8 w-full text-sm" placeholder="Cerca dipendente..."
                value={searchA} onChange={e => { setSearchA(e.target.value); setSelA(null) }}/>
            </div>
            {selA ? (
              <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-800 text-sm">{selA.name}</p>
                  <p className="text-xs text-gray-500">{selA.role || '—'} · {selA.sede || (selA.location === 'MAMELI' ? 'MA' : 'PN')}</p>
                </div>
                <button onClick={() => setSelA(null)} className="text-gray-400 hover:text-red-400 p-1"><X size={14}/></button>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-xl overflow-hidden bg-white max-h-48 overflow-y-auto">
                {filteredA.length === 0 && <p className="text-gray-400 text-xs p-3 text-center">Nessun risultato</p>}
                {filteredA.map(emp => (
                  <button key={emp.id} onClick={() => { setSelA(emp); setSearchA(emp.name) }}
                    className="w-full text-left px-3 py-2 hover:bg-violet-50 text-sm border-b border-gray-50 last:border-b-0 transition-colors">
                    <p className="font-medium text-gray-800">{emp.name}</p>
                    <p className="text-xs text-gray-400">{emp.role || '—'} · {emp.sede || (emp.location === 'MAMELI' ? 'MA' : 'PN')}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Profilo B */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              🔗 Profilo/Operatore da Unire
            </label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input className="input pl-8 w-full text-sm" placeholder="Cerca dipendente o operatore venduto..."
                value={searchB} onChange={e => { setSearchB(e.target.value); setSelB(null) }}/>
            </div>
            {selB ? (
              <div className="bg-orange-50 border border-orange-300 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-800 text-sm">{selB.name || selB.operatore}</p>
                  <p className="text-xs text-gray-500">
                    {selB.type === 'operator'
                      ? `Operatore venduto · ${selB.sede}`
                      : `${selB.role || '—'} · ${selB.sede || (selB.location === 'MAMELI' ? 'MA' : 'PN')}`}
                  </p>
                </div>
                <button onClick={() => setSelB(null)} className="text-gray-400 hover:text-red-400 p-1"><X size={14}/></button>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-xl overflow-hidden bg-white max-h-48 overflow-y-auto">
                {filteredB.length === 0 && <p className="text-gray-400 text-xs p-3 text-center">Nessun risultato</p>}
                {filteredB.map((item, idx) => {
                  const isOp = !!item.operatore
                  return (
                    <button key={isOp ? `op-${idx}` : item.id}
                      onClick={() => { setSelB({ ...item, type: isOp ? 'operator' : 'employee' }); setSearchB(item.name || item.operatore) }}
                      className="w-full text-left px-3 py-2 hover:bg-orange-50 text-sm border-b border-gray-50 last:border-b-0 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${isOp ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                          {isOp ? 'OP' : 'EMP'}
                        </span>
                        <div>
                          <p className="font-medium text-gray-800">{item.name || item.operatore}</p>
                          <p className="text-xs text-gray-400">
                            {isOp ? `Operatore · ${item.sede}` : `${item.role || '—'} · ${item.sede || (item.location === 'MAMELI' ? 'MA' : 'PN')}`}
                          </p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Pulsante merge manuale */}
        {selA && selB && (
          <div className="flex items-center gap-3 bg-white border border-orange-200 rounded-xl p-3">
            <div className="flex-1 text-sm">
              <span className="font-semibold text-emerald-700">{selA.name}</span>
              <span className="text-gray-400 mx-2">←</span>
              <span className="font-semibold text-orange-700">{selB.name || selB.operatore}</span>
            </div>
            <button
              onClick={() => {
                const tipo = selB.type === 'operator' ? 'op-emp' : 'emp-emp'
                const removeObj = selB.type === 'operator'
                  ? { operatore: selB.operatore, sede: selB.sede }
                  : selB
                setPreview({ keep: selA, remove: removeObj, tipo, score: 0 })
              }}
              className="btn btn-primary bg-orange-500 hover:bg-orange-600 border-orange-500 flex items-center gap-2 text-sm flex-shrink-0">
              <GitMerge size={14}/> Unisci questi 2
            </button>
          </div>
        )}
      </div>

      {/* Legenda */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-500">
        <div className="flex items-start gap-2 bg-white rounded-xl border border-gray-100 p-3">
          <span className="text-lg">📋</span>
          <div><p className="font-semibold text-gray-700">Dipendente CRM</p><p>Profilo nell'anagrafica employees. Ha turni, buste paga, KPI collegati.</p></div>
        </div>
        <div className="flex items-start gap-2 bg-white rounded-xl border border-gray-100 p-3">
          <span className="text-lg">📊</span>
          <div><p className="font-semibold text-gray-700">Operatore Venduto</p><p>Nome usato in iPratico per il venduto. Può avere un nome breve tipo "FABRY".</p></div>
        </div>
        <div className="flex items-start gap-2 bg-white rounded-xl border border-gray-100 p-3">
          <span className="text-lg">🔗</span>
          <div><p className="font-semibold text-gray-700">Unione</p><p>Collega i 2 profili: tutti i dati vengono aggregati su un unico dipendente.</p></div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN — ADMIN PANEL
// ═══════════════════════════════════════════════════════════════════════════
const TABS = [
  { id: 'dipendenti', label: 'Dipendenti',    icon: Users,      sub: 'Modifica, trasferisci, split costi' },
  { id: 'unioni',     label: 'Unioni',        icon: GitMerge,   sub: 'Doppioni e link venduto↔dipendente', badge: true },
  { id: 'ruoli',      label: 'Ruoli',         icon: Tag,        sub: 'Aggiungi e gestisci ruoli' },
  { id: 'kpi',        label: 'KPI Config',    icon: Target,     sub: 'Target mensili per operatore' },
  { id: 'sedi',       label: 'Sedi',          icon: MapPin,     sub: 'Location e struttura multi-sede' },
  { id: 'database',   label: 'Database',      icon: Database,   sub: 'Vista dati grezzi Supabase' },
  { id: 'backup',     label: 'Backup',        icon: Archive,    sub: 'Snapshot & ripristino dati' },
  { id: 'memoria',    label: 'Memoria AI',    icon: Brain,      sub: 'Note e contesto salvati da Claude' },
  { id: 'sync',       label: 'Sync & Deploy', icon: Cloud,      sub: 'Vercel, Supabase, moduli CRM' },
]

export default function AdminPanel() {
  const { tab } = useParams()
  const navigate = useNavigate()
  const activeTab = tab || 'dipendenti'
  const [toast, setToast] = useState(null)

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  return (
    <div className="space-y-5">
      <Toast msg={toast} onClose={() => setToast(null)}/>

      <div className="page-header">
        <div>
          <h1 className="page-title">Backoffice Admin</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gestisci ogni aspetto del CRM senza toccare il codice</p>
        </div>
      </div>

      {/* Tab navigation — cliccando aggiorna URL */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-9 gap-3">
        {TABS.map(t => (
          <button key={t.id} onClick={() => navigate(`/admin/${t.id}`)}
            className={`rounded-xl p-3.5 text-left border transition-all relative ${
              activeTab === t.id
                ? t.id === 'unioni' ? 'bg-orange-500 text-white border-orange-500 shadow-md' : 'bg-violet-600 text-white border-violet-600 shadow-md'
                : t.id === 'unioni' ? 'bg-orange-50 border-orange-200 hover:border-orange-300 text-orange-700 shadow-sm'
                : 'bg-white border-gray-100 hover:border-violet-200 text-gray-700 shadow-sm'}`}>
            <t.icon size={16} className={`${activeTab === t.id ? 'text-white opacity-80' : t.id === 'unioni' ? 'text-orange-500' : 'text-violet-500'} mb-1.5`}/>
            <p className={`font-semibold text-sm ${activeTab === t.id ? 'text-white' : t.id === 'unioni' ? 'text-orange-700' : 'text-gray-800'}`}>{t.label}</p>
            <p className={`text-xs mt-0.5 leading-tight ${activeTab === t.id ? 'text-white opacity-70' : t.id === 'unioni' ? 'text-orange-500' : 'text-gray-400'}`}>{t.sub}</p>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5">
        {activeTab === 'dipendenti' && <DipendentiTab       onToast={showToast}/>}
        {activeTab === 'unioni'     && <UnioneDoppioniTab  onToast={showToast}/>}
        {activeTab === 'ruoli'      && <RuoliTab            onToast={showToast}/>}
        {activeTab === 'kpi'        && <KpiConfigTab  onToast={showToast}/>}
        {activeTab === 'sedi'       && <SediTab       onToast={showToast}/>}
        {activeTab === 'database'   && <DatabaseTab   onToast={showToast}/>}
        {activeTab === 'backup'     && <BackupTab     onToast={showToast}/>}
        {activeTab === 'memoria'    && <MemoriaTab    onToast={showToast}/>}
        {activeTab === 'sync'       && <SyncTab       onToast={showToast}/>}
      </div>
    </div>
  )
}
