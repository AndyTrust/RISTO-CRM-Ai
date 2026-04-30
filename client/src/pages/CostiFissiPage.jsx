/**
 * CostiFissiPage.jsx — Gestione costi fissi (affitti, consulenze, assicurazioni)
 * Features:
 *  - Filtri sede + anno
 *  - Tabella editabile per mese × voce con salvataggio inline
 *  - Aggiungi voce ricorrente su range (RPC costi_fissi_ricorrente_upsert)
 *  - Adeguamento ISTAT annuale % (RPC costi_fissi_adeguamento_istat)
 *  - Riepilogo totali per sede
 *  - Duplica da mese precedente
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { costiFissiApi, fattureCategorieApi } from '../api/client'
import {
  Home, Plus, Edit3, Save, X, Trash2, TrendingUp, Copy,
  RefreshCw, ChevronRight, AlertCircle, Calendar, Euro
} from 'lucide-react'

const MESI = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const SEDI = [
  { code: 'MA', label: 'Mameli' },
  { code: 'PN', label: 'Predda Niedda' },
]

const eur = n => n != null
  ? `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
  : '—'

// ─── Modal: aggiungi / modifica voce ricorrente ─────────────────────────
function VoceRicorrenteModal({ open, onClose, onSaved, categorie, defaultSede, defaultAnno }) {
  const [form, setForm] = useState({
    sede: defaultSede || 'MA',
    categoria_id: '',
    descrizione: '',
    importo: '',
    anno_da: defaultAnno || new Date().getFullYear(),
    mese_da: 1,
    anno_a: defaultAnno || new Date().getFullYear(),
    mese_a: 12,
    ricorrente: true,
    note: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setForm(f => ({ ...f, sede: defaultSede || f.sede, anno_da: defaultAnno || f.anno_da, anno_a: defaultAnno || f.anno_a }))
  }, [open, defaultSede, defaultAnno])

  if (!open) return null

  const handleSave = async () => {
    if (!form.descrizione.trim() || !form.importo) { alert('Descrizione e importo obbligatori'); return }
    setSaving(true)
    try {
      const res = await costiFissiApi.ricorrenteBulk(form)
      alert(`✓ ${res.creati} mesi aggiornati`)
      onSaved()
      onClose()
    } catch (e) { alert('Errore: ' + e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-2xl p-5 max-w-lg w-full space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold flex items-center gap-2"><Plus size={18}/> Nuova voce costo fisso</h3>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500">Sede</label>
            <select className="input py-1.5 text-sm w-full" value={form.sede} onChange={e => setForm({...form, sede: e.target.value})}>
              {SEDI.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">Categoria</label>
            <select className="input py-1.5 text-sm w-full" value={form.categoria_id} onChange={e => setForm({...form, categoria_id: e.target.value})}>
              <option value="">— Scegli categoria —</option>
              {categorie.map(c => <option key={c.id} value={c.id}>{c.tipo} · {c.nome}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500">Descrizione</label>
          <input className="input py-1.5 text-sm w-full" value={form.descrizione}
            onChange={e => setForm({...form, descrizione: e.target.value})}
            placeholder="es. Locazione Mameli, Consulenza Fiscale..."/>
        </div>

        <div>
          <label className="text-xs text-gray-500">Importo mensile €</label>
          <input type="number" step="0.01" className="input py-1.5 text-sm w-full" value={form.importo}
            onChange={e => setForm({...form, importo: e.target.value})}/>
        </div>

        <div className="bg-gray-50 rounded-xl p-3 space-y-2">
          <label className="text-xs font-semibold text-gray-600">Periodo di ricorrenza</label>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className="text-[10px] text-gray-500">Da mese</label>
              <select className="input py-1 text-xs w-full" value={form.mese_da} onChange={e => setForm({...form, mese_da: parseInt(e.target.value)})}>
                {MESI.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-500">Anno</label>
              <input type="number" className="input py-1 text-xs w-full" value={form.anno_da}
                onChange={e => setForm({...form, anno_da: parseInt(e.target.value)})}/>
            </div>
            <div>
              <label className="text-[10px] text-gray-500">A mese</label>
              <select className="input py-1 text-xs w-full" value={form.mese_a} onChange={e => setForm({...form, mese_a: parseInt(e.target.value)})}>
                {MESI.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-500">Anno</label>
              <input type="number" className="input py-1 text-xs w-full" value={form.anno_a}
                onChange={e => setForm({...form, anno_a: parseInt(e.target.value)})}/>
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500">Note (opzionale)</label>
          <input className="input py-1.5 text-sm w-full" value={form.note}
            onChange={e => setForm({...form, note: e.target.value})}/>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-ghost px-4 py-2 text-sm" disabled={saving} onClick={onClose}>Annulla</button>
          <button className="bg-violet-600 text-white px-4 py-2 rounded-xl text-sm font-medium" disabled={saving} onClick={handleSave}>
            {saving ? 'Salvo...' : 'Crea/Aggiorna'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: adeguamento ISTAT ─────────────────────────────────────────────
function IstatModal({ open, onClose, onSaved, defaultAnno }) {
  const [form, setForm] = useState({ sede: '', anno: defaultAnno || new Date().getFullYear(), pct_aumento: 3.0 })
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (open) setForm({ sede: '', anno: defaultAnno || new Date().getFullYear(), pct_aumento: 3.0 }) }, [open, defaultAnno])

  if (!open) return null

  const handleSave = async () => {
    if (!window.confirm(`Applicare +${form.pct_aumento}% ISTAT a tutte le voci dell'anno ${form.anno}${form.sede ? ' sede '+form.sede : ''}?`)) return
    setSaving(true)
    try {
      const res = await costiFissiApi.adeguamentoIstat({
        sede: form.sede || null,
        anno: form.anno,
        pct_aumento: form.pct_aumento,
      })
      alert(`✓ ${res.aggiornate} voci adeguate`)
      onSaved()
      onClose()
    } catch (e) { alert('Errore: ' + e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-2xl p-5 max-w-md w-full space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold flex items-center gap-2"><TrendingUp size={18}/> Adeguamento ISTAT</h3>
        <p className="text-sm text-gray-500">
          Applica una variazione % a tutte le voci dei costi fissi di un anno, per adeguamento indici ISTAT.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-500">Sede</label>
            <select className="input py-1.5 text-sm w-full" value={form.sede} onChange={e => setForm({...form, sede: e.target.value})}>
              <option value="">Entrambe</option>
              <option value="MA">Mameli</option>
              <option value="PN">Predda Niedda</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">Anno</label>
            <input type="number" className="input py-1.5 text-sm w-full" value={form.anno}
              onChange={e => setForm({...form, anno: parseInt(e.target.value)})}/>
          </div>
          <div>
            <label className="text-xs text-gray-500">% ISTAT</label>
            <input type="number" step="0.1" className="input py-1.5 text-sm w-full" value={form.pct_aumento}
              onChange={e => setForm({...form, pct_aumento: parseFloat(e.target.value)})}/>
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 flex gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>
          <span>L'operazione è irreversibile ma tracciata in <code>note</code>. Indici ISTAT tipici: 2023 +8.1%, 2024 +5.4%, 2025 +1.0%.</span>
        </div>
        <div className="flex gap-2 justify-end">
          <button className="btn-ghost px-4 py-2 text-sm" disabled={saving} onClick={onClose}>Annulla</button>
          <button className="bg-amber-600 text-white px-4 py-2 rounded-xl text-sm font-medium" disabled={saving} onClick={handleSave}>
            {saving ? 'Applico...' : 'Applica adeguamento'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Cella editabile inline ─────────────────────────────────────────────
function CellaImporto({ value, id, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  useEffect(() => { setVal(value) }, [value])

  const save = async () => {
    if (parseFloat(val) === parseFloat(value)) { setEditing(false); return }
    try {
      await costiFissiApi.update(id, { importo: parseFloat(val) })
      setEditing(false)
      onSaved()
    } catch (e) { alert('Errore: '+e.message); setVal(value); setEditing(false) }
  }

  if (editing) return (
    <input autoFocus type="number" step="0.01" className="w-full text-right text-xs py-1 px-1.5 border border-violet-400 rounded"
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setVal(value); setEditing(false) } }}/>
  )
  return (
    <button className="w-full text-right text-xs px-1.5 py-1 hover:bg-violet-50 rounded" onClick={() => setEditing(true)}>
      {eur(value)}
    </button>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────
export default function CostiFissiPage() {
  const [sedeF, setSedeF] = useState('ALL')
  const [annoF, setAnnoF] = useState(new Date().getFullYear())
  const [rows, setRows] = useState([])
  const [categorie, setCategorie] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [istatOpen, setIstatOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, cat] = await Promise.all([
        costiFissiApi.listArricchita({ sede: sedeF === 'ALL' ? null : sedeF, anno: annoF }),
        fattureCategorieApi.list(),
      ])
      setRows(list)
      setCategorie(cat)
    } finally { setLoading(false) }
  }, [sedeF, annoF])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id, desc) => {
    if (!window.confirm(`Eliminare la voce "${desc}"?`)) return
    try { await costiFissiApi.delete(id); load() } catch (e) { alert('Errore: '+e.message) }
  }

  // Raggruppa per descrizione univoca, poi mostra colonne per mese
  const pivot = useMemo(() => {
    const byKey = {}
    for (const r of rows) {
      const k = `${r.sede}|${r.descrizione}|${r.categoria_tipo||'ALTRO'}`
      if (!byKey[k]) byKey[k] = {
        key: k, sede: r.sede, descrizione: r.descrizione,
        categoria_tipo: r.categoria_tipo, categoria_nome: r.categoria_nome,
        ricorrente: r.ricorrente, mesi: {}
      }
      byKey[k].mesi[r.mese] = { id: r.id, importo: parseFloat(r.importo)||0 }
    }
    return Object.values(byKey).sort((a,b) => a.sede.localeCompare(b.sede) || a.descrizione.localeCompare(b.descrizione))
  }, [rows])

  const totaliMese = useMemo(() => {
    const tot = Array(12).fill(0)
    const totSede = { MA: Array(12).fill(0), PN: Array(12).fill(0) }
    for (const r of rows) {
      const i = r.mese - 1
      tot[i] += parseFloat(r.importo)||0
      if (totSede[r.sede]) totSede[r.sede][i] += parseFloat(r.importo)||0
    }
    return { tot, totSede }
  }, [rows])

  const totAnno = totaliMese.tot.reduce((s,v) => s+v, 0)

  const annoOpzioni = []
  for (let y = new Date().getFullYear()+1; y >= 2023; y--) annoOpzioni.push(y)

  return (
    <div className="p-5 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Home size={20}/> Costi Fissi</h1>
          <p className="text-sm text-gray-400 mt-0.5">Affitti · Consulenze · Assicurazioni · Oneri ricorrenti</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input py-1.5 text-sm" value={sedeF} onChange={e => setSedeF(e.target.value)}>
            <option value="ALL">Tutte le sedi</option>
            <option value="MA">Mameli</option>
            <option value="PN">Predda Niedda</option>
          </select>
          <select className="input py-1.5 text-sm" value={annoF} onChange={e => setAnnoF(parseInt(e.target.value))}>
            {annoOpzioni.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={load} className="btn-ghost p-2 text-gray-500 rounded-xl border border-gray-200">
            <RefreshCw size={14}/>
          </button>
          <button onClick={() => setIstatOpen(true)} className="px-3 py-1.5 border border-amber-300 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-50 flex items-center gap-1.5">
            <TrendingUp size={14}/> ISTAT
          </button>
          <button onClick={() => setModalOpen(true)} className="px-3 py-1.5 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700 flex items-center gap-1.5">
            <Plus size={14}/> Nuova voce
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Totale anno {annoF}</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{eur(totAnno)}</p>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
          <p className="text-xs text-red-500 uppercase tracking-wide">Mameli (MA)</p>
          <p className="text-2xl font-bold text-red-700 mt-1">{eur(totaliMese.totSede.MA.reduce((s,v)=>s+v,0))}</p>
          <p className="text-xs text-red-500 mt-0.5">media mese {eur(totaliMese.totSede.MA.reduce((s,v)=>s+v,0)/12)}</p>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
          <p className="text-xs text-blue-500 uppercase tracking-wide">Predda Niedda (PN)</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">{eur(totaliMese.totSede.PN.reduce((s,v)=>s+v,0))}</p>
          <p className="text-xs text-blue-500 mt-0.5">media mese {eur(totaliMese.totSede.PN.reduce((s,v)=>s+v,0)/12)}</p>
        </div>
      </div>

      {/* Tabella pivot */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-gray-600 uppercase text-[10px] sticky left-0 bg-gray-50 z-10 min-w-[220px]">Voce</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600 uppercase text-[10px] min-w-[60px]">Sede</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600 uppercase text-[10px] min-w-[100px]">Categoria</th>
                {MESI.map(m => <th key={m} className="text-right px-1.5 py-2 font-semibold text-gray-500 uppercase text-[10px] min-w-[75px]">{m}</th>)}
                <th className="text-right px-2 py-2 font-semibold text-gray-800 uppercase text-[10px] bg-gray-100">Tot</th>
                <th className="px-2 py-2 text-[10px]"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={16} className="text-center py-8 text-gray-400">Caricamento...</td></tr>
              ) : pivot.length === 0 ? (
                <tr><td colSpan={16} className="text-center py-8 text-gray-400">Nessuna voce per il periodo. Clic su "Nuova voce" per inserirne una.</td></tr>
              ) : pivot.map(p => {
                const rowTot = Object.values(p.mesi).reduce((s,c) => s + c.importo, 0)
                return (
                  <tr key={p.key} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-3 py-2 font-medium text-gray-800 sticky left-0 bg-white z-10 group-hover:bg-gray-50/50">
                      {p.descrizione}
                      {p.ricorrente && <span className="ml-2 text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">ricorrente</span>}
                    </td>
                    <td className="px-2 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${p.sede==='MA' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>{p.sede}</span>
                    </td>
                    <td className="px-2 py-2 text-gray-500 text-[11px]">{p.categoria_nome || '—'}</td>
                    {MESI.map((_,i) => {
                      const c = p.mesi[i+1]
                      return (
                        <td key={i} className="px-1 py-1 text-right border-l border-gray-50">
                          {c ? <CellaImporto value={c.importo} id={c.id} onSaved={load}/> : <span className="text-gray-300 text-[10px]">—</span>}
                        </td>
                      )
                    })}
                    <td className="px-2 py-2 text-right font-bold text-gray-800 bg-gray-50">{eur(rowTot)}</td>
                    <td className="px-2 py-2 text-right">
                      <button
                        onClick={() => {
                          const firstId = Object.values(p.mesi)[0]?.id
                          if (firstId && window.confirm(`Eliminare SOLO questa riga di ${annoF}? (le voci degli altri anni restano)`)) {
                            // Elimina tutte le voci di quell'anno con stessa desc+sede
                            Promise.all(Object.values(p.mesi).map(c => costiFissiApi.delete(c.id))).then(load)
                          }
                        }}
                        className="text-gray-300 hover:text-red-500 p-1"><Trash2 size={12}/></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {/* Totali per mese */}
            {pivot.length > 0 && (
              <tfoot>
                <tr className="bg-violet-50 border-t-2 border-violet-200 font-bold">
                  <td className="px-3 py-2 sticky left-0 bg-violet-50 z-10 text-violet-700" colSpan={3}>TOTALE MESE</td>
                  {totaliMese.tot.map((v,i) => (
                    <td key={i} className="px-1.5 py-2 text-right text-violet-700 text-[11px]">{v > 0 ? eur(v) : '—'}</td>
                  ))}
                  <td className="px-2 py-2 text-right text-violet-800 bg-violet-100">{eur(totAnno)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Guida inline */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 text-sm text-indigo-800">
        <p className="font-semibold mb-2 flex items-center gap-1.5"><AlertCircle size={14}/> Come funziona</p>
        <ul className="space-y-1 text-xs text-indigo-700">
          <li>• <strong>Clicca un importo</strong> per modificarlo inline (Invio per salvare, Esc per annullare)</li>
          <li>• <strong>Nuova voce</strong>: crea/aggiorna una ricorrenza su un range di mesi e anni (es. da gen 2025 a dic 2026)</li>
          <li>• <strong>Adeguamento ISTAT</strong>: applica un aumento % a tutte le voci di un anno (es. +3% dal 2026)</li>
          <li>• Le voci sono sincronizzate con il BE mensile, la vista macro-costi e il calcolo obiettivi team</li>
        </ul>
      </div>

      {/* Modals */}
      <VoceRicorrenteModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={load}
        categorie={categorie}
        defaultSede={sedeF !== 'ALL' ? sedeF : 'MA'}
        defaultAnno={annoF}
      />
      <IstatModal
        open={istatOpen}
        onClose={() => setIstatOpen(false)}
        onSaved={load}
        defaultAnno={annoF}
      />
    </div>
  )
}
