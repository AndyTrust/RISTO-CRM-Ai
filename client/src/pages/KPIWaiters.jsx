import React, { useEffect, useState } from 'react'
import { kpi as kpiApi, employees as empApi } from '../api/client'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer,
  ReferenceLine
} from 'recharts'
import { Target, TrendingUp, Users, Award, ChevronDown, ChevronUp, CheckSquare, Square, Save, Trophy, Medal } from 'lucide-react'
import PageAssistant from '../components/PageAssistant'

const COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ec4899','#8b5cf6','#ef4444','#14b8a6']

function eur(n) { return n != null ? `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—' }
function pct(actual, target) { if (!target || !actual) return 0; return Math.min(150, Math.round(actual / target * 100)) }

function ProgressBar({ value, target, color = '#6366f1', showLabel = true }) {
  const p = pct(value, target)
  const isOk   = p >= 100
  const isWarn = p >= 80 && p < 100
  const isLow  = p < 80
  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500">{value != null ? eur(value) : '—'}</span>
          <span className={isOk ? 'text-green-600 font-semibold' : isWarn ? 'text-amber-600' : 'text-red-500'}>
            {target ? `${p}% di ${eur(target)}` : 'No target'}
          </span>
        </div>
      )}
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(p, 100)}%`, backgroundColor: isOk ? '#10b981' : isWarn ? '#f59e0b' : color }} />
      </div>
    </div>
  )
}

function OperatorCard({ data, rank, onPlan }) {
  const isTop = rank === 0
  return (
    <div className={`card p-4 ${isTop ? 'ring-2 ring-violet-400' : ''}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
          style={{ backgroundColor: COLORS[rank % COLORS.length] }}>
          {data.operatore?.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm truncate">{data.operatore}</h3>
            {isTop && <span className="badge badge-violet">🏆 Top</span>}
            {rank === 1 && <span className="badge bg-gray-100 text-gray-600">🥈 2°</span>}
            {rank === 2 && <span className="badge bg-amber-100 text-amber-700">🥉 3°</span>}
          </div>
          <p className="text-xs text-gray-400">{data.location === 'MAMELI' ? 'Sede MA' : 'Sede PN'}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-lg font-bold text-violet-600">{eur(data.quantum)}</p>
          <p className="text-xs text-gray-400">quantum/cop.</p>
        </div>
      </div>
      <div className="space-y-2">
        <div>
          <p className="text-xs text-gray-500 mb-1">Quantum vs Target</p>
          <ProgressBar value={data.quantum} target={data.quantum_target} color={COLORS[rank % COLORS.length]} />
        </div>
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div>
            <p className="text-xs text-gray-400">Coperti gestiti</p>
            <p className="font-semibold text-sm">{data.coperti_gestiti || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Venduto totale</p>
            <p className="font-semibold text-sm">{eur(data.tot_importo)}</p>
          </div>
        </div>
      </div>
      {onPlan && (
        <button onClick={onPlan} className="mt-3 btn-secondary text-xs py-1 px-2 w-full">
          📋 Piano individuale
        </button>
      )}
    </div>
  )
}

function TeamStats({ chiusure }) {
  const ma = chiusure.find(x => x.location === 'MAMELI')
  const pn = chiusure.find(x => x.location === 'PREDDA_NIEDDA')
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {[
        { label: 'Coperto medio MA', value: ma ? eur(ma.avg_coperto_medio) : '—', icon: '📊', color: 'bg-blue-50 text-blue-600' },
        { label: 'Coperto medio PN', value: pn ? eur(pn.avg_coperto_medio) : '—', icon: '📊', color: 'bg-green-50 text-green-600' },
        { label: 'Scontrino medio MA', value: ma ? eur(ma.avg_scontrino_medio) : '—', icon: '🧾', color: 'bg-violet-50 text-violet-600' },
        { label: 'Scontrino medio PN', value: pn ? eur(pn.avg_scontrino_medio) : '—', icon: '🧾', color: 'bg-amber-50 text-amber-600' },
      ].map((s, i) => (
        <div key={i} className="kpi-card">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.color}`}>{s.icon}</div>
          <p className="text-xl font-bold mt-2">{s.value}</p>
          <p className="text-xs text-gray-500">{s.label}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Pannello Obiettivo Team ─────────────────────────────────────────────────
function TeamObjectivePanel({ quantum }) {
  const [teamTarget, setTeamTarget] = useState('')
  const [editing, setEditing] = useState(false)

  const opsWithQuantum = quantum.filter(op => op.quantum != null)
  if (opsWithQuantum.length === 0) return null

  const avgQuantum = opsWithQuantum.reduce((s, op) => s + (op.quantum || 0), 0) / opsWithQuantum.length
  const savedTarget = parseFloat(teamTarget) || quantum.find(op => op.quantum_target)?.quantum_target || null

  // Conteggio operatori sopra/sotto target
  const opsAbove = savedTarget ? opsWithQuantum.filter(op => op.quantum >= savedTarget).length : 0
  const opsBelow = savedTarget ? opsWithQuantum.filter(op => op.quantum < savedTarget).length : 0
  const teamPct  = savedTarget ? Math.round(avgQuantum / savedTarget * 100) : null

  return (
    <div className="card border-2 border-violet-200 bg-gradient-to-br from-violet-50 to-white">
      <div className="card-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy size={18} className="text-violet-600" />
          <h2 className="font-semibold text-violet-800">Obiettivo Team</h2>
        </div>
        <button onClick={() => setEditing(e => !e)} className="text-xs text-violet-600 hover:text-violet-800 font-medium">
          {editing ? 'Chiudi' : '✏️ Imposta obiettivo team'}
        </button>
      </div>
      <div className="card-body space-y-4">
        {editing && (
          <div className="flex items-center gap-3 bg-white border border-violet-200 rounded-xl p-3">
            <label className="text-sm text-gray-600">Quantum target team (€/piatto medio)</label>
            <input type="number" step="0.01" placeholder="es. 8.00"
              className="input w-32 text-sm" value={teamTarget}
              onChange={e => setTeamTarget(e.target.value)} />
            <button onClick={() => setEditing(false)} className="btn-primary text-xs">Applica</button>
          </div>
        )}

        {/* Stats team */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-4 border border-violet-100">
            <p className="text-xs text-gray-500">€/Piatto medio team</p>
            <p className="text-2xl font-bold text-violet-700">{eur(avgQuantum)}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-violet-100">
            <p className="text-xs text-gray-500">Operatori attivi</p>
            <p className="text-2xl font-bold">{opsWithQuantum.length}</p>
          </div>
          {savedTarget && (
            <>
              <div className={`rounded-xl p-4 border ${opsAbove > opsBelow ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                <p className="text-xs text-gray-500">Sopra obiettivo</p>
                <p className="text-2xl font-bold text-green-600">{opsAbove}/{opsWithQuantum.length}</p>
              </div>
              <div className="bg-white rounded-xl p-4 border border-violet-100">
                <p className="text-xs text-gray-500">Raggiungimento team</p>
                <p className={`text-2xl font-bold ${teamPct >= 100 ? 'text-green-600' : teamPct >= 80 ? 'text-amber-600' : 'text-red-500'}`}>
                  {teamPct}%
                </p>
              </div>
            </>
          )}
        </div>

        {/* Progress barra team */}
        {savedTarget && (
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-gray-700">Progresso team verso obiettivo {eur(savedTarget)}</span>
              <span className={`font-bold ${teamPct >= 100 ? 'text-green-600' : teamPct >= 80 ? 'text-amber-600' : 'text-red-500'}`}>
                {teamPct}%
              </span>
            </div>
            <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700 flex items-center justify-end pr-2"
                style={{
                  width: `${Math.min(teamPct, 100)}%`,
                  backgroundColor: teamPct >= 100 ? '#10b981' : teamPct >= 80 ? '#f59e0b' : '#6366f1'
                }}>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
function LeaderboardView({ quantum, teamTargetOverride }) {
  const opsWithQ = quantum.filter(op => op.quantum != null).sort((a, b) => (b.quantum || 0) - (a.quantum || 0))
  if (opsWithQ.length === 0) return <p className="text-gray-400 text-sm text-center py-8">Nessun dato operatori</p>

  const maxQ = opsWithQ[0]?.quantum || 1
  const medals = ['🏆', '🥈', '🥉']

  return (
    <div className="space-y-3">
      {opsWithQ.map((op, i) => {
        const barPct = (op.quantum / maxQ * 100).toFixed(1)
        const targetPct = op.quantum_target ? pct(op.quantum, op.quantum_target) : null
        const isAboveTarget = targetPct != null && targetPct >= 100
        const isBelowTarget = targetPct != null && targetPct < 80
        return (
          <div key={i} className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
            i === 0 ? 'bg-violet-50 border-violet-200' :
            i === 1 ? 'bg-blue-50 border-blue-100' :
            'bg-white border-gray-100'
          }`}>
            {/* Rank */}
            <div className="w-8 text-center flex-shrink-0">
              {i < 3 ? (
                <span className="text-xl">{medals[i]}</span>
              ) : (
                <span className="text-sm font-bold text-gray-400">{i + 1}</span>
              )}
            </div>

            {/* Avatar */}
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}>
              {op.operatore?.charAt(0)}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className="font-semibold text-sm truncate">{op.operatore}</span>
                <span className={`badge ${op.sede === 'MA' ? 'badge-blue' : 'badge-green'}`}>{op.sede}</span>
                {isAboveTarget && <span className="badge bg-green-100 text-green-700">✓ Target</span>}
                {isBelowTarget && <span className="badge bg-red-100 text-red-600">⚠ Sotto target</span>}
              </div>
              {/* Progress bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${barPct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                </div>
                {op.quantum_target && (
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden relative">
                    <div className={`h-full rounded-full transition-all ${
                      targetPct >= 100 ? 'bg-green-500' : targetPct >= 80 ? 'bg-amber-400' : 'bg-red-400'
                    }`} style={{ width: `${Math.min(targetPct, 100)}%` }} />
                  </div>
                )}
              </div>
            </div>

            {/* Quantum */}
            <div className="text-right flex-shrink-0 min-w-[100px]">
              <p className="font-bold text-violet-700">{eur(op.quantum)}</p>
              <p className="text-xs text-gray-400">/{op.coperti_gestiti || '—'} cop.</p>
              {op.quantum_target && (
                <p className="text-xs text-gray-400">target: {eur(op.quantum_target)}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Piano individuale modale
function PlanModal({ emp, onClose }) {
  const [plans, setPlans] = useState([])
  const [form, setForm] = useState({
    period_start: new Date().toISOString().slice(0, 7) + '-01',
    period_end: new Date().toISOString().slice(0, 7) + '-31',
    quantum_target: '', quantum_quorum: '', coperto_medio_target: '',
    coperti_target: '', upsell_target: '', notes: ''
  })

  useEffect(() => {
    empApi.getPlans(emp.id).then(setPlans).catch(console.error)
  }, [emp.id])

  const save = async () => {
    await empApi.addPlan(emp.id, form)
    const updated = await empApi.getPlans(emp.id)
    setPlans(updated)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 bg-white p-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-lg">Piano individuale — {emp.name}</h3>
            <button onClick={onClose} className="btn-ghost p-1 text-gray-400">✕</button>
          </div>
        </div>
        <div className="p-6 space-y-4">
          {plans.map(p => (
            <div key={p.id} className="bg-gray-50 rounded-xl p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-700">{p.period_start} → {p.period_end}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {p.quantum_target && <div><span className="text-gray-400">Quantum target</span><br/><strong>{eur(p.quantum_target)}</strong></div>}
                {p.quantum_quorum && <div><span className="text-gray-400">Quorum minimo</span><br/><strong>{eur(p.quantum_quorum)}</strong></div>}
                {p.coperto_medio_target && <div><span className="text-gray-400">Coperto medio</span><br/><strong>{eur(p.coperto_medio_target)}</strong></div>}
                {p.coperti_target && <div><span className="text-gray-400">Coperti/periodo</span><br/><strong>{p.coperti_target}</strong></div>}
                {p.upsell_target && <div><span className="text-gray-400">Up-sell target</span><br/><strong>{eur(p.upsell_target)}</strong></div>}
              </div>
              {p.notes && <p className="text-xs text-gray-400 mt-2 italic">{p.notes}</p>}
            </div>
          ))}
          <div className="border-t pt-4">
            <p className="text-sm font-medium text-gray-700 mb-3">Nuovo piano</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Da</label>
                <input type="date" className="input" value={form.period_start} onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">A</label>
                <input type="date" className="input" value={form.period_end} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Quantum target (€/cop.)</label>
                <input type="number" className="input" placeholder="es. 45.00" value={form.quantum_target} onChange={e => setForm(f => ({ ...f, quantum_target: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Quorum minimo (€/cop.)</label>
                <input type="number" className="input" placeholder="es. 35.00" value={form.quantum_quorum} onChange={e => setForm(f => ({ ...f, quantum_quorum: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Coperto medio target</label>
                <input type="number" className="input" placeholder="es. 50.00" value={form.coperto_medio_target} onChange={e => setForm(f => ({ ...f, coperto_medio_target: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Coperti target periodo</label>
                <input type="number" className="input" placeholder="es. 200" value={form.coperti_target} onChange={e => setForm(f => ({ ...f, coperti_target: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-400 mb-1 block">Note piano</label>
                <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <button onClick={save} className="btn-primary w-full mt-3">Salva piano</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Pannello assegnazione bulk target ──────────────────────────────────────
function BulkTargetPanel({ quantum, mesiDisp, meseCorrente, onSaved }) {
  const [open, setOpen]         = useState(false)
  const [period, setPeriod]     = useState(meseCorrente)
  const [selected, setSelected] = useState(new Set())
  const [form, setForm]         = useState({ quantum_target: '', quorum: '', coperto_medio_target: '', notes: '' })
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState(null)

  const allKeys = quantum.map(op => `${op.sede}|${op.operatore}`)
  const toggleAll = () => { if (selected.size === allKeys.length) setSelected(new Set()); else setSelected(new Set(allKeys)) }
  const toggle = (key) => setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (selected.size === 0) return setMsg({ type: 'error', text: 'Seleziona almeno un operatore' })
    if (!form.quantum_target && !form.quorum) return setMsg({ type: 'error', text: 'Inserisci almeno un valore target' })
    setSaving(true); setMsg(null)
    try {
      const ops = quantum.filter(op => selected.has(`${op.sede}|${op.operatore}`))
        .map(op => ({ code: op.operatore, name: op.operatore, sede: op.sede }))
      const result = await kpiApi.setBulkTargets(ops, { period, ...form })
      setMsg({ type: 'ok', text: `✓ Target salvati per ${result.count} operatori` })
      setSelected(new Set())
      if (onSaved) onSaved()
    } catch(e) {
      setMsg({ type: 'error', text: e.message || 'Errore salvataggio' })
    } finally { setSaving(false) }
  }

  return (
    <div className="card border-violet-200 bg-violet-50/50">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-violet-100/50 rounded-xl transition-colors">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-violet-600"/>
          <span className="font-semibold text-violet-800 text-sm">Assegna Target Mensile</span>
          <span className="text-xs text-violet-500">— imposta obiettivi a più operatori in un click</span>
        </div>
        {open ? <ChevronUp size={16} className="text-violet-400"/> : <ChevronDown size={16} className="text-violet-400"/>}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {msg && (
            <div className={`text-sm rounded-lg px-3 py-2 ${msg.type === 'ok' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'}`}>
              {msg.text}
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-700">Periodo:</span>
            <select value={period} onChange={e => setPeriod(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:ring-2 focus:ring-violet-300 outline-none bg-white">
              {mesiDisp.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Quantum Target (€/cop.)</label>
              <input type="number" step="0.01" placeholder="es. 45.00" className="input w-full text-sm" value={form.quantum_target} onChange={e => set('quantum_target', e.target.value)}/>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Quorum minimo (€/cop.)</label>
              <input type="number" step="0.01" placeholder="es. 35.00" className="input w-full text-sm" value={form.quorum} onChange={e => set('quorum', e.target.value)}/>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Coperto medio target</label>
              <input type="number" step="0.01" placeholder="es. 50.00" className="input w-full text-sm" value={form.coperto_medio_target} onChange={e => set('coperto_medio_target', e.target.value)}/>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Note (opzionale)</label>
            <input type="text" placeholder="es. Obiettivo Q2 2026" className="input w-full text-sm" value={form.notes} onChange={e => set('notes', e.target.value)}/>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Operatori ({selected.size}/{allKeys.length})</span>
              <button onClick={toggleAll} className="text-xs text-violet-600 hover:text-violet-800 font-medium">
                {selected.size === allKeys.length ? 'Deseleziona tutti' : 'Seleziona tutti'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-52 overflow-y-auto pr-1">
              {quantum.map(op => {
                const key = `${op.sede}|${op.operatore}`
                const checked = selected.has(key)
                return (
                  <button key={key} onClick={() => toggle(key)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-sm transition-all ${checked ? 'bg-violet-100 border-violet-400 text-violet-800' : 'bg-white border-gray-200 text-gray-600 hover:border-violet-200'}`}>
                    {checked ? <CheckSquare size={14} className="text-violet-600 flex-shrink-0"/> : <Square size={14} className="text-gray-300 flex-shrink-0"/>}
                    <span className="truncate">{op.operatore}</span>
                    <span className={`ml-auto text-xs font-semibold flex-shrink-0 ${op.sede === 'MA' ? 'text-red-500' : 'text-blue-500'}`}>{op.sede}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={handleSave} disabled={saving || selected.size === 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${saving || selected.size === 0 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-violet-600 hover:bg-violet-700 text-white'}`}>
              <Save size={14}/>{saving ? 'Salvataggio...' : `Salva target (${selected.size} op.)`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function getMesiDisponibili() {
  const now = new Date()
  const mesi = []
  for (let i = 0; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
    const lbl = d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
    mesi.push({ value: val, label: lbl.charAt(0).toUpperCase() + lbl.slice(1) })
  }
  return mesi
}

export default function KPIWaiters() {
  const [quantum, setQuantum] = useState([])
  const [teamData, setTeamData] = useState({ chiusure: [], operatori: [] })
  const [location, setLocation] = useState('all')
  const [planFor, setPlanFor] = useState(null)
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('cards') // 'cards' | 'leaderboard'

  const now = new Date()
  const meseCorrente = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
  const [selectedMese, setSelectedMese] = useState(meseCorrente)
  const [useTuttiMesi, setUseTuttiMesi] = useState(true)
  const mesiDisp = getMesiDisponibili()

  useEffect(() => {
    const loc = location === 'all' ? undefined : location
    // "Tutti i periodi" → nessun filtro mese; "Mese specifico" → usa selectedMese
    const month = !useTuttiMesi && selectedMese ? selectedMese : undefined
    const params = { location: loc, month }
    setLoading(true)
    Promise.all([
      kpiApi.quantum(params),
      kpiApi.team(params),
      empApi.getAll({ active: 'true' }),
    ]).then(([q, t, e]) => {
      setQuantum(Array.isArray(q) ? q : [])
      setTeamData(t && typeof t === 'object' ? t : { chiusure: [], operatori: [] })
      setEmployees(e)
    }).catch(console.error).finally(() => setLoading(false))
  }, [location, selectedMese, useTuttiMesi])

  const byLoc = location === 'all' ? quantum : quantum.filter(x => x.location === location)

  const refreshQuantum = () => {
    const loc = location === 'all' ? undefined : location
    const month = !useTuttiMesi && selectedMese ? selectedMese : undefined
    kpiApi.quantum({ location: loc, month }).then(q => setQuantum(Array.isArray(q) ? q : []))
  }

  return (
    <>
    <div className="space-y-5">
      {planFor && <PlanModal emp={planFor} onClose={() => setPlanFor(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title">KPI Camerieri</h1>
          <p className="text-sm text-gray-500 mt-0.5">Quantum · Quorum · Obiettivi team e individuali</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {['all','MAMELI','PREDDA_NIEDDA'].map(l => (
            <button key={l} onClick={() => setLocation(l)}
              className={`btn text-xs ${location === l ? 'btn-primary' : 'btn-secondary'}`}>
              {l === 'all' ? 'Tutti' : l === 'MAMELI' ? 'Sede MA' : 'Sede PN'}
            </button>
          ))}
        </div>
      </div>

      {/* Filtro periodo */}
      <div className="flex items-center gap-3 flex-wrap bg-white border border-gray-100 rounded-xl px-4 py-3 shadow-sm">
        <Target size={15} className="text-violet-500 flex-shrink-0" />
        <span className="text-sm font-medium text-gray-600">Periodo:</span>
        <button onClick={() => setUseTuttiMesi(true)}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${useTuttiMesi ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'}`}>
          Tutti i periodi
        </button>
        <button onClick={() => setUseTuttiMesi(false)}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${!useTuttiMesi ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'}`}>
          Mese specifico
        </button>
        {!useTuttiMesi && (
          <select value={selectedMese} onChange={e => setSelectedMese(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:ring-2 focus:ring-violet-300 outline-none">
            {mesiDisp.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        )}
        {loading && <span className="text-xs text-gray-400 italic">aggiornamento...</span>}
      </div>

      {/* Team Stats */}
      {teamData.chiusure?.length > 0 && <TeamStats chiusure={teamData.chiusure} />}

      {/* Pannello obiettivo team */}
      {byLoc.length > 0 && <TeamObjectivePanel quantum={byLoc} />}

      {/* Bulk target */}
      {quantum.length > 0 && (
        <BulkTargetPanel
          quantum={byLoc}
          mesiDisp={mesiDisp}
          meseCorrente={meseCorrente}
          onSaved={refreshQuantum}
        />
      )}

      {loading ? (
        <div className="text-gray-400 text-sm text-center py-12">Caricamento KPI...</div>
      ) : (
        <>
          {/* Quantum ranking chart */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Quantum Ranking — €/piatto medio</h2>
                <p className="text-xs text-gray-400 mt-0.5">Fatturato medio per articolo venduto da ogni operatore — linea viola = target individuale</p>
              </div>
            </div>
            <div className="card-body">
              {byLoc.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">Nessun dato operatori nel periodo</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(200, byLoc.length * 40)}>
                  <BarChart data={byLoc} layout="vertical" margin={{ left: 20, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={v => `€${v}`} tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="operatore" tick={{ fontSize: 12 }} width={90} />
                    <Tooltip formatter={(v) => [`€ ${v.toFixed(2)}`, 'Quantum']} />
                    <Bar dataKey="quantum" radius={[0,4,4,0]}>
                      {byLoc.map((op, i) => (
                        <Cell key={i} fill={
                          op.quantum_target
                            ? (op.quantum >= op.quantum_target ? '#10b981' : op.quantum >= op.quantum_target * 0.8 ? '#f59e0b' : '#ef4444')
                            : COLORS[i % COLORS.length]
                        } />
                      ))}
                    </Bar>
                    {byLoc.some(x => x.quantum_target) && (
                      <Bar dataKey="quantum_target" name="Target" fill="transparent"
                        stroke="#6366f1" strokeWidth={2} strokeDasharray="4 2" radius={[0,4,4,0]} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Vista toggle: Cards vs Leaderboard */}
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 text-sm">Confronto operatori</h2>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              <button onClick={() => setView('cards')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${view === 'cards' ? 'bg-white shadow text-violet-700' : 'text-gray-500'}`}>
                🃏 Schede
              </button>
              <button onClick={() => setView('leaderboard')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${view === 'leaderboard' ? 'bg-white shadow text-violet-700' : 'text-gray-500'}`}>
                🏆 Leaderboard
              </button>
            </div>
          </div>

          {view === 'leaderboard' && <LeaderboardView quantum={byLoc} />}

          {view === 'cards' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {byLoc.map((op, i) => (
                <OperatorCard
                  key={i}
                  data={op}
                  rank={i}
                  onPlan={employees.find(e => e.name === op.operatore)
                    ? () => setPlanFor(employees.find(e => e.name === op.operatore))
                    : null}
                />
              ))}
              {byLoc.length === 0 && (
                <div className="col-span-3 text-center text-gray-400 py-12">Nessun dato operatori nel periodo selezionato</div>
              )}
            </div>
          )}

          {/* Glossario */}
          <div className="card p-4 bg-violet-50 border-violet-200">
            <h3 className="font-semibold text-violet-800 mb-2">📖 Glossario KPI — Academy Risto CRM</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-violet-700">
              <div><strong>Quantum</strong> = venduto totale operatore ÷ coperti gestiti. Misura l'efficacia di vendita per coperto.</div>
              <div><strong>Quorum</strong> = soglia minima di quantum accettabile. Sotto il quorum = attivazione piano di miglioramento.</div>
              <div><strong>Target</strong> = obiettivo quantum da raggiungere nel periodo. Concordato in riunione 1:1.</div>
              <div><strong>Coperto medio</strong> = venduto locale ÷ coperti giornata. KPI del locale, non del singolo operatore.</div>
              <div><strong>Up-sell</strong> = aggiunta varianti premium (es. frutti di bosco, caramello salato). Tracciato come aggiunta_qty.</div>
              <div><strong>CNQ</strong> = Cosa Non va, Quantità. Reclami e note negative ricevute sull'operatore nel periodo.</div>
            </div>
          </div>
        </>
      )}
    </div>
      <PageAssistant
        pagina="KPI Camerieri"
        suggerimenti={[
          "Chi ha il coperto medio più alto?",
          "Mostrami il quantum dell'ultimo mese",
          "Confronta le performance tra camerieri",
        ]}
      />
    </>
  )
}