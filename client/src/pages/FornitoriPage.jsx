import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import { fornitori as fornitoriApi, pagamentiFatture as pagApi, prodottiCatalogo as catApi, fattureBi, fattureCategorieApi } from '../api/client'
import supabase from '../supabase'
import { fetchPagedInfo } from '../api/paged'
import { BottoneCsv, NotaCopertura } from '../lib/tabella'
import {
  Building2, Search, X, ChevronRight, ChevronDown, FileText, TrendingDown, TrendingUp,
  Plus, Check, Pencil, Trash2, Euro, Clock, AlertCircle, CheckCircle2,
  Package, BarChart2, RefreshCw, Filter, CreditCard, Receipt, Calendar,
  ChevronLeft, Info, Tag, Hash, Layers
} from 'lucide-react'
import PageAssistant from '../components/PageAssistant'
import PageStatsWidget from '../components/PageStatsWidget'
import PeriodFilter from '../components/PeriodFilter'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const eur = n => n != null
  ? `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : '—'
const pct = (a, b) => b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '—'
const fmt_mese = s => { if (!s) return ''; const [y, m] = s.split('-'); return `${['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'][parseInt(m)-1]} ${y}` }

const CATEGORIE = ['TUTTI','FOOD','BEVERAGE','UTILITIES','TELEFONIA','SERVIZI','TECH_IT','PULIZIE','NOLEGGIO','PACKAGING','TICKET_BUONI','CARBURANTE','ALTRO']
const CAT_COLOR = {
  FOOD:'bg-emerald-100 text-emerald-700 border-emerald-200', BEVERAGE:'bg-blue-100 text-blue-700 border-blue-200',
  UTILITIES:'bg-yellow-100 text-yellow-700 border-yellow-200', TELEFONIA:'bg-violet-100 text-violet-700 border-violet-200',
  SERVIZI:'bg-sky-100 text-sky-700 border-sky-200', TECH_IT:'bg-indigo-100 text-indigo-700 border-indigo-200',
  PULIZIE:'bg-teal-100 text-teal-700 border-teal-200', NOLEGGIO:'bg-orange-100 text-orange-700 border-orange-200',
  PACKAGING:'bg-lime-100 text-lime-700 border-lime-200', TICKET_BUONI:'bg-pink-100 text-pink-700 border-pink-200',
  CARBURANTE:'bg-red-100 text-red-700 border-red-200', ALTRO:'bg-gray-100 text-gray-600 border-gray-200',
}
const CAT_CHART_COLOR = {
  FOOD:'#10b981', BEVERAGE:'#3b82f6', UTILITIES:'#f59e0b', TELEFONIA:'#7c3aed',
  SERVIZI:'#0ea5e9', TECH_IT:'#4f46e5', PULIZIE:'#14b8a6', NOLEGGIO:'#f97316',
  PACKAGING:'#84cc16', TICKET_BUONI:'#ec4899', CARBURANTE:'#ef4444', ALTRO:'#6b7280',
}
const STATO_COLOR = {
  APERTA:'bg-red-100 text-red-700 border-red-200',
  PARZIALE:'bg-amber-100 text-amber-700 border-amber-200',
  SALDATA:'bg-emerald-100 text-emerald-700 border-emerald-200',
  ANNULLATA:'bg-gray-100 text-gray-500 border-gray-200',
}
const TIPI_PAG = ['PAGAMENTO','ACCONTO','SALDO','STORNO']
const METODI_PAG = ['BONIFICO','RIBA','RID','CONTANTI','CARTA','ALTRO']

// Preset periodi
const now = new Date()
// Formatter LOCALE (toISOString usa UTC → può sfasare di un giorno nel fuso italiano)
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const PERIODI = [
  { label: 'Questo mese', from: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`, to: iso(now) },
  { label: '3 mesi', from: iso(new Date(now.getFullYear(), now.getMonth()-2, 1)), to: iso(now) },
  { label: '6 mesi', from: iso(new Date(now.getFullYear(), now.getMonth()-5, 1)), to: iso(now) },
  { label: 'Anno', from: `${now.getFullYear()}-01-01`, to: iso(now) },
  { label: 'Anno prec.', from: `${now.getFullYear()-1}-01-01`, to: `${now.getFullYear()-1}-12-31` },
  { label: 'Tutto', from: '', to: '' },
]

function Badge({ label, className = '' }) {
  return <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${className}`}>{label}</span>
}

// Dropdown inline per cambiare categoria fornitore (usato dentro button row)
function CategoriaSelect({ fornitore, onChange }) {
  const [saving, setSaving] = useState(false)
  const cur = fornitore.categoria || 'ALTRO'
  const cats = CATEGORIE.filter(c => c !== 'TUTTI')
  return (
    <select
      value={cur}
      disabled={saving}
      onClick={e => e.stopPropagation()}
      onChange={async e => {
        e.stopPropagation()
        const nuova = e.target.value
        if (nuova === cur) return
        setSaving(true)
        try {
          await fornitoriApi.update(fornitore.id, { categoria: nuova })
          onChange?.(fornitore.id, nuova)
        } finally { setSaving(false) }
      }}
      className={`px-1.5 py-0.5 rounded text-[11px] font-medium border cursor-pointer outline-none focus:ring-2 focus:ring-violet-300 ${CAT_COLOR[cur] || CAT_COLOR.ALTRO} ${saving ? 'opacity-60' : ''}`}
      title="Cambia categoria (ricategorizza tutte le fatture del fornitore)"
    >
      {cats.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
  )
}

// ─── DateRangeBar ─────────────────────────────────────────────────────────────
function DateRangeBar({ from, to, onChange }) {
  const [period, setPeriod] = useState('custom')
  // I preset «Anno prec.» e «Tutto» esistevano in PERIODI ma erano dead code:
  // la barra usa PeriodFilter, che non li prevede. Con 7 anni di fatture a DB
  // (dal giugno 2019) servono davvero, quindi vengono resi raggiungibili qui.
  const PRESET_EXTRA = PERIODI.filter(p => p.label === 'Anno prec.' || p.label === 'Tutto')
  return (
    <div className="space-y-2">
      <PageStatsWidget />
      <PeriodFilter
        period={period}
        dates={{ from, to }}
        onChange={(pid, d) => { setPeriod(pid); onChange(d?.from || '', d?.to || '') }}
        extra={
          <>
            {PRESET_EXTRA.map(p => (
              <button key={p.label} onClick={() => { setPeriod('custom'); onChange(p.from, p.to) }}
                title={p.from ? `${p.from} → ${p.to}` : 'Nessun filtro di data: tutto lo storico (dal 2019)'}
                className={`text-xs px-3 py-2 rounded-xl border transition-all mb-1 ${
                  from === p.from && to === p.to
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-400 hover:text-indigo-600'
                }`}>
                {p.label}
              </button>
            ))}
            {(from || to) && (
              <button onClick={() => onChange('','')}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 pb-2">
                <X size={11}/> Reset
              </button>
            )}
          </>
        } />
    </div>
  )
}

// ─── Modal: Aggiungi/Modifica pagamento ───────────────────────────────────────
function PagamentoModal({ fattura, pagamento, onClose, onSaved }) {
  const [form, setForm] = useState({
    data_pagamento: pagamento?.data_pagamento || iso(new Date()),
    importo: pagamento?.importo || (fattura ? String(+(fattura.totale - (fattura.totale_pagato||0)).toFixed(2)) : ''),
    tipo:    pagamento?.tipo   || 'PAGAMENTO',
    metodo:  pagamento?.metodo || 'BONIFICO',
    note:    pagamento?.note   || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const residuo = fattura ? +(fattura.totale - (fattura.totale_pagato||0)).toFixed(2) : 0

  const handleSave = async () => {
    if (!form.importo || isNaN(parseFloat(form.importo))) return
    setSaving(true)
    try {
      pagamento?.id ? await pagApi.update(pagamento.id, form) : await pagApi.add({ ...form, fattura_id: fattura.id })
      onSaved(); onClose()
    } catch (e) { alert('Errore: ' + e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">{pagamento ? 'Modifica pagamento' : 'Registra pagamento'}</h3>
            {fattura && <p className="text-xs text-gray-400 mt-0.5">{fattura.fornitore} · {eur(fattura.totale)}{residuo > 0 && <span className="text-amber-500"> · residuo {eur(residuo)}</span>}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={18}/></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Data</label>
              <input type="date" className="input text-sm" value={form.data_pagamento} onChange={e => set('data_pagamento', e.target.value)}/>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Importo €</label>
              <input type="number" step="0.01" className="input text-sm font-semibold" value={form.importo} onChange={e => set('importo', e.target.value)}/>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Tipo</label>
              <select className="input text-sm" value={form.tipo} onChange={e => set('tipo', e.target.value)}>
                {TIPI_PAG.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Metodo</label>
              <select className="input text-sm" value={form.metodo} onChange={e => set('metodo', e.target.value)}>
                {METODI_PAG.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Note</label>
            <input className="input text-sm" placeholder="Opzionale" value={form.note} onChange={e => set('note', e.target.value)}/>
          </div>
          {residuo > 0 && (
            <button onClick={() => set('importo', String(residuo))} className="w-full text-xs text-violet-600 hover:text-violet-800 py-1">
              ← Inserisci residuo {eur(residuo)}
            </button>
          )}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn-ghost flex-1 text-sm py-2">Annulla</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 text-sm py-2">
            {saving ? 'Salvo...' : (pagamento ? 'Salva' : 'Registra')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── RigheFattura (prodotti di una singola fattura) ────────────────────────────
function RigheFattura({ fatturaId }) {
  const [righe, setRighe] = useState(null)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    if (!fatturaId) return
    let annullato = false
    fornitoriApi.getRigheFattura(fatturaId)
      .then(r => { if (!annullato) setRighe(r) })
      // `.catch(() => setRighe([]))` faceva passare un guasto per "nessuna riga
      // estratta", che qui è un messaggio operativo diverso (manca l'estrazione).
      .catch(e => { if (!annullato) { setErrore(e?.message || String(e)); setRighe([]) } })
    return () => { annullato = true }
  }, [fatturaId])

  if (righe === null) return <p className="text-xs text-gray-400 py-3 text-center">Caricamento righe...</p>
  if (errore) return <p className="text-xs text-red-600 py-3 text-center">Righe non caricate: {errore}</p>
  if (!righe.length) return <p className="text-xs text-gray-400 py-3 text-center italic">Nessuna riga prodotto estratta per questa fattura</p>

  return (
    <div className="mt-2">
      <div className="text-xs font-medium text-gray-500 mb-2">
        {righe.length} righe prodotto · importi <strong>netto IVA</strong> (fatture_righe.importo_riga)
      </div>
      <div className="space-y-1.5">
        {righe.map((r, i) => (
          <div key={r.id ?? `${r.riga_numero ?? i}-${r.descrizione}`} className="flex items-start justify-between gap-2 py-1.5 border-b border-gray-50 last:border-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                {r.codice_articolo && (
                  <span className="text-xs font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded border border-gray-200">{r.codice_articolo}</span>
                )}
                <span className="text-xs font-medium text-gray-700 truncate">{r.descrizione}</span>
              </div>
              {r.quantita && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {r.quantita} {r.unita_misura || ''} × {eur(r.prezzo_unitario)}
                  {r.aliquota_iva ? ` (IVA ${r.aliquota_iva}%)` : ''}
                </p>
              )}
            </div>
            <span className="text-xs font-semibold text-gray-800 whitespace-nowrap">{eur(r.importo_riga)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── BulkPagamentoModal ────────────────────────────────────────────────────────
function BulkPagamentoModal({ fatture, onClose, onDone }) {
  const [form, setForm] = useState({
    data_pagamento: iso(new Date()),
    tipo: 'SALDO',
    metodo: 'BONIFICO',
    note: '',
  })
  const [saving, setSaving] = useState(false)
  const totResiduo = fatture.reduce((s, f) => s + Math.max(0, parseFloat(f.totale||0) - parseFloat(f.totale_pagato||0)), 0)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await Promise.all(fatture.map(async fat => {
        const residuo = +(parseFloat(fat.totale||0) - parseFloat(fat.totale_pagato||0)).toFixed(2)
        if (residuo > 0.01) {
          await pagApi.add({ ...form, importo: residuo, fattura_id: fat.id })
        }
      }))
      onDone()
      onClose()
    } catch (e) { alert('Errore: ' + e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">Segna come pagate</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {fatture.length} fatture · totale residuo {eur(totResiduo)}
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={18}/></button>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
          <p className="text-xs text-amber-700">Per ogni fattura selezionata verrà registrato un pagamento pari al residuo.</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Data pagamento</label>
            <input type="date" className="input text-sm" value={form.data_pagamento} onChange={e => set('data_pagamento', e.target.value)}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Tipo</label>
              <select className="input text-sm" value={form.tipo} onChange={e => set('tipo', e.target.value)}>
                {TIPI_PAG.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Metodo</label>
              <select className="input text-sm" value={form.metodo} onChange={e => set('metodo', e.target.value)}>
                {METODI_PAG.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Note</label>
            <input className="input text-sm" placeholder="Opzionale" value={form.note} onChange={e => set('note', e.target.value)}/>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn-ghost flex-1 text-sm py-2">Annulla</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 text-sm py-2">
            {saving ? 'Salvo...' : `Segna ${fatture.length} fatture`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── FatturaDetail (riga fattura espandibile) ──────────────────────────────────
function FatturaRow({ f, onAddPag, onEditPag, onDeletePag, checked, onToggle }) {
  const [expanded, setExpanded] = useState(false)
  const [pagamenti, setPagamenti] = useState(null)
  const [showRighe, setShowRighe] = useState(false)
  const residuo = +(parseFloat(f.totale||0) - parseFloat(f.totale_pagato||0)).toFixed(2)

  const [pagErr, setPagErr] = useState(null)

  useEffect(() => {
    if (!expanded) return
    let annullato = false
    pagApi.getByFattura(f.id)
      .then(p => { if (!annullato) { setPagamenti(p); setPagErr(null) } })
      // Senza distinguere l'errore, "Nessun pagamento" poteva essere un guasto:
      // e su una fattura già saldata è un'informazione che porta a pagare due volte.
      .catch(e => { if (!annullato) { setPagamenti([]); setPagErr(e?.message || String(e)) } })
    return () => { annullato = true }
  }, [expanded, f.id])

  const handleDelete = async (pid) => {
    if (!confirm('Eliminare questo pagamento?')) return
    await pagApi.delete(pid)
    const updated = await pagApi.getByFattura(f.id)
    setPagamenti(updated)
    onDeletePag?.()
  }

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${checked ? 'border-violet-300 bg-violet-50/30' : 'border-gray-100'}`}>
      <div className="flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors">
        {/* Checkbox selezione */}
        <input
          type="checkbox"
          checked={checked}
          onChange={e => { e.stopPropagation(); onToggle(f.id) }}
          onClick={e => e.stopPropagation()}
          className="w-4 h-4 rounded accent-violet-600 flex-shrink-0 cursor-pointer"
        />
        <div
          className="flex-1 flex items-center gap-3 cursor-pointer"
          onClick={() => setExpanded(e => !e)}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-gray-500">{f.numero_fattura}</span>
              <Badge label={f.stato_pagamento || 'APERTA'} className={STATO_COLOR[f.stato_pagamento] || STATO_COLOR.APERTA}/>
              {f.sede && <span className="text-xs text-gray-400">{f.sede}</span>}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{f.data_fattura}{f.scadenza_pagamento ? ` · scade ${f.scadenza_pagamento}` : ''}</p>
          </div>
          <div className="text-right flex-shrink-0">
            {/* v_fatture_con_stato.totale è il totale documento, IVA INCLUSA */}
            <p className="text-sm font-semibold text-gray-800" title="Totale fattura, lordo IVA">{eur(f.totale)}</p>
            <p className="text-[10px] text-gray-400 leading-none">lordo IVA</p>
            {residuo > 0.01 && <p className="text-xs text-amber-600">res. {eur(residuo)}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={e => { e.stopPropagation(); onAddPag(f) }}
            className="btn-ghost p-1 text-violet-500 hover:text-violet-700" title="Aggiungi pagamento">
            <Plus size={14}/>
          </button>
          {expanded ? <ChevronDown size={14} className="text-gray-300"/> : <ChevronRight size={14} className="text-gray-300"/>}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-50">
          {/* Toggle righe prodotto */}
          <button
            onClick={() => setShowRighe(s => !s)}
            className="text-xs text-violet-500 hover:text-violet-700 flex items-center gap-1 mt-2 mb-1">
            <Package size={11}/> {showRighe ? 'Nascondi prodotti' : 'Mostra prodotti'} ↓
          </button>
          {showRighe && <RigheFattura fatturaId={f.id}/>}

          {/* Pagamenti */}
          <div className="mt-3">
            <p className="text-xs font-medium text-gray-500 mb-2">Pagamenti registrati</p>
            {pagErr
              ? <p className="text-xs text-red-600">Pagamenti non caricati: {pagErr} — non è detto che non ce ne siano.</p>
              : pagamenti === null
              ? <p className="text-xs text-gray-400">Caricamento...</p>
              : pagamenti.length === 0
                ? <p className="text-xs text-gray-400 italic">Nessun pagamento</p>
                : pagamenti.map(pg => (
                    <div key={pg.id} className="flex items-center gap-2 py-1 text-xs border-b border-gray-50 last:border-0">
                      <span className="text-gray-400">{pg.data_pagamento}</span>
                      <Badge label={pg.tipo} className="bg-gray-50 text-gray-500 border-gray-200"/>
                      <span className="text-gray-500">{pg.metodo}</span>
                      <span className="font-semibold text-gray-800 ml-auto">{eur(pg.importo)}</span>
                      <button onClick={() => onEditPag(pg, f)} className="btn-ghost p-0.5 text-gray-300 hover:text-violet-500"><Pencil size={11}/></button>
                      <button onClick={() => handleDelete(pg.id)} className="btn-ghost p-0.5 text-gray-300 hover:text-red-500"><Trash2 size={11}/></button>
                    </div>
                  ))
            }
          </div>
        </div>
      )}
    </div>
  )
}

// ─── FornitoreDetail (modal fornitore) ────────────────────────────────────────
function FornitoreDetail({ fornitore, onClose, onUpdated, dateFrom, dateTo }) {
  const [tab, setTab] = useState('fatture')
  const [fatture, setFatture] = useState([])
  const [prodotti, setProdotti] = useState([])
  const [loadingFat, setLoadingFat] = useState(true)
  const [filterStato, setFilterStato] = useState('TUTTI')
  const [searchFat, setSearchFat] = useState('')
  const [searchProd, setSearchProd] = useState('')
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ ...fornitore })
  const [savingEdit, setSavingEdit] = useState(false)
  const [pagModal, setPagModal] = useState(null) // { fattura, pagamento? }
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkModal, setBulkModal] = useState(false)

  const [loadError, setLoadError] = useState(null)

  const [troncato, setTroncato] = useState(false)
  const richiestaRef = useRef(0)

  const loadData = useCallback(async () => {
    const mia = ++richiestaRef.current
    setLoadingFat(true)
    setLoadError(null)
    try {
      // `getFatture({ limit: 500 })` non pagina: su un fornitore con più fatture
      // nel periodo il residuo totale e i conteggi per stato uscivano parziali.
      // Qui si legge v_fatture_con_stato a pagine (ha `id`, ordinamento stabile).
      const buildFat = () => {
        let q = supabase.from('v_fatture_con_stato').select('*')
          .eq('p_iva', (fornitore.p_iva || '').replace(/^IT/, ''))
        if (dateFrom) q = q.gte('data_fattura', dateFrom)
        if (dateTo)   q = q.lte('data_fattura', dateTo)
        return q
      }
      // allSettled, non all: le due letture sono indipendenti e con `all` un
      // solo guasto su fatture_righe azzerava anche fatture e trend (il trend è
      // derivato dalle fatture), lasciando la scheda vuota per intero.
      const [esitoFat, esitoProd] = await Promise.allSettled([
        fetchPagedInfo(buildFat, 'id'),
        // getRighe è già paginata lato API (aggrega su fatture_righe).
        fornitoriApi.getRighe({ p_iva: fornitore.p_iva, from: dateFrom, to: dateTo }),
      ])
      if (mia !== richiestaRef.current) return

      if (esitoFat.status === 'fulfilled') {
        const resFat = esitoFat.value
        setFatture(resFat.righe.sort((a, b) => String(b.data_fattura || '').localeCompare(String(a.data_fattura || ''))))
        setTroncato(resFat.troncato)
      } else {
        console.error('FornitoreDetail fatture:', esitoFat.reason)
        setFatture([])
        setTroncato(false)
      }

      if (esitoProd.status === 'fulfilled') {
        setProdotti(Array.isArray(esitoProd.value) ? esitoProd.value : [])
      } else {
        console.error('FornitoreDetail prodotti:', esitoProd.reason)
        setProdotti([])
      }

      const guasti = []
      if (esitoFat.status === 'rejected')  guasti.push('le fatture')
      if (esitoProd.status === 'rejected') guasti.push('i prodotti')
      setLoadError(guasti.length ? `Non è stato possibile caricare ${guasti.join(' e ')}.` : null)
    } catch (e) {
      if (mia !== richiestaRef.current) return
      console.error('FornitoreDetail loadData error:', e)
      setLoadError(e.message || 'Errore nel caricamento dati')
      setFatture([])
      setProdotti([])
    } finally { if (mia === richiestaRef.current) setLoadingFat(false) }
  }, [fornitore.p_iva, dateFrom, dateTo])

  useEffect(() => {
    loadData()
    // Invalida la richiesta in volo: la modale può essere chiusa prima.
    return () => { richiestaRef.current++ }
  }, [loadData])

  const fattureFiltrate = useMemo(() => fatture.filter(f => {
    if (filterStato !== 'TUTTI' && f.stato_pagamento !== filterStato) return false
    if (searchFat && !f.numero_fattura?.toLowerCase().includes(searchFat.toLowerCase()) && !f.data_fattura?.includes(searchFat)) return false
    return true
  }), [fatture, filterStato, searchFat])

  const prodottiFiltrati = useMemo(() => prodotti.filter(p =>
    !searchProd || p.descrizione?.toLowerCase().includes(searchProd.toLowerCase()) ||
    p.codice_articolo?.toLowerCase().includes(searchProd.toLowerCase())
  ), [prodotti, searchProd])

  const handleSaveEdit = async () => {
    setSavingEdit(true)
    try {
      await fornitoriApi.update(fornitore.id, editForm)
      setEditing(false)
      onUpdated()
    } catch (e) { alert(e.message) }
    finally { setSavingEdit(false) }
  }

  const residuoTot  = fatture.reduce((s, f) => s + Math.max(0, parseFloat(f.totale||0) - parseFloat(f.totale_pagato||0)), 0)
  const totAperte   = fatture.filter(f => f.stato_pagamento === 'APERTA').length
  const totParziali = fatture.filter(f => f.stato_pagamento === 'PARZIALE').length

  // Trend mensile del fornitore
  const trendForn = useMemo(() => {
    const byM = {}
    for (const f of fatture) {
      if (!f.data_fattura) continue
      const m = f.data_fattura.substring(0, 7)
      if (!byM[m]) byM[m] = { mese: m, label: fmt_mese(m), spesa: 0, n: 0 }
      byM[m].spesa += parseFloat(f.totale || 0)
      byM[m].n++
    }
    return Object.values(byM).sort((a, b) => a.mese.localeCompare(b.mese))
  }, [fatture])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-30">
      <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
              <Building2 size={20} className="text-violet-600"/>
            </div>
            <div className="flex-1 min-w-0">
              {editing ? (
                <input className="input text-base font-semibold mb-1" value={editForm.nome || ''} onChange={e => setEditForm(f => ({...f, nome: e.target.value}))}/>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-semibold text-lg text-gray-900">{fornitore.nome}</h2>
                  <Badge label={fornitore.categoria || 'ALTRO'} className={CAT_COLOR[fornitore.categoria] || CAT_COLOR.ALTRO}/>
                </div>
              )}
              <p className="text-sm text-gray-400">P.IVA {fornitore.p_iva}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setEditing(!editing)} className={`btn-ghost p-1.5 rounded-lg ${editing ? 'text-violet-600 bg-violet-50' : 'text-gray-400'}`}><Pencil size={15}/></button>
              {editing && <button onClick={handleSaveEdit} disabled={savingEdit} className="btn-primary px-3 py-1.5 text-xs">{savingEdit ? '...' : 'Salva'}</button>}
              <button onClick={onClose} className="btn-ghost p-1.5 text-gray-400"><X size={18}/></button>
            </div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-4 gap-2 mt-4">
            {[
              // tot_spesa/tot_pagato vengono da v_fornitori_completi e sono
              // totali documento: LORDI IVA. Vanno etichettati, altrimenti nella
              // stessa modale convivono con gli importi NETTI del tab Prodotti.
              { label: 'Spesa (lordo IVA)', val: eur(fornitore.tot_spesa), sub: `${fatture.length} fatt. · tutto lo storico` },
              { label: 'Pagato (lordo IVA)', val: eur(fornitore.tot_pagato), sub: `${fatture.filter(f=>f.stato_pagamento==='SALDATA').length} saldate`, col: 'text-emerald-700' },
              { label: 'Residuo (lordo IVA)', val: eur(residuoTot), sub: `${totAperte} aperte · solo periodo`, col: residuoTot > 0 ? 'text-amber-600' : '' },
              { label: 'Prodotti', val: prodotti.length, sub: 'articoli unici' },
            ].map((k) => (
              <div key={k.label} className="bg-gray-50 rounded-xl p-2.5 text-center">
                <p className="text-xs text-gray-400">{k.label}</p>
                <p className={`font-semibold text-sm ${k.col || 'text-gray-800'}`}>{k.val}</p>
                <p className="text-xs text-gray-400">{k.sub}</p>
              </div>
            ))}
          </div>

          {dateFrom && <p className="text-xs text-violet-500 mt-2">📅 Periodo filtrato: {dateFrom} → {dateTo || 'oggi'}</p>}
          <NotaCopertura righe={fatture.length} da={dateFrom || '—'} a={dateTo || 'oggi'}
            fonte="v_fatture_con_stato (lordo IVA)" troncato={troncato} />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-5 flex-shrink-0 gap-1 overflow-x-auto">
          {[['fatture','🧾 Fatture'],['prodotti','📦 Prodotti'],['trend','📈 Trend'],['anagrafica','📋 Anagrafica']].map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors -mb-px ${tab===k ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {lbl}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* Errore caricamento */}
          {loadError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2 mb-4">
              <AlertCircle size={15} className="text-red-500 flex-shrink-0"/>
              <p className="text-sm text-red-700"><strong>Errore:</strong> {loadError}</p>
              <button onClick={loadData} className="ml-auto text-xs text-red-600 hover:underline">Riprova</button>
            </div>
          )}

          {/* ── TAB FATTURE ── */}
          {tab === 'fatture' && (
            <div className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                {/* Il conteggio accanto a ogni stato evita il filtro "fantasma":
                    PARZIALE è previsto dallo schema ma oggi nessuna fattura lo usa
                    (a DB esistono solo SALDATA e APERTA), e senza il numero il
                    risultato vuoto sembra un guasto invece che uno stato inutilizzato. */}
                <div className="flex rounded-xl overflow-hidden border border-gray-200 text-xs font-medium">
                  {['TUTTI','APERTA','PARZIALE','SALDATA'].map(s => {
                    const n = s === 'TUTTI' ? fatture.length : fatture.filter(f => f.stato_pagamento === s).length
                    return (
                      <button key={s} onClick={() => setFilterStato(s)} disabled={n === 0 && s !== 'TUTTI'}
                        title={n === 0 && s !== 'TUTTI' ? `Nessuna fattura in stato ${s}` : undefined}
                        className={`px-3 py-1.5 ${
                          filterStato === s ? 'bg-violet-600 text-white'
                          : n === 0 && s !== 'TUTTI' ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
                          : 'bg-white text-gray-600 hover:bg-gray-50'
                        }`}>
                        {s} <span className="opacity-60">{n}</span>
                      </button>
                    )
                  })}
                </div>
                <div className="relative flex-1 min-w-[140px]">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                  <input className="input pl-8 py-1.5 text-xs" placeholder="Cerca n. fattura..." value={searchFat} onChange={e => setSearchFat(e.target.value)}/>
                </div>
                <BottoneCsv righe={fattureFiltrate} nomeFile={`fatture_${fornitore.p_iva}`} colonne={[
                  { chiave: 'numero_fattura', etichetta: 'N. fattura' },
                  { chiave: 'data_fattura', etichetta: 'Data' },
                  { chiave: 'sede', etichetta: 'Sede' },
                  { chiave: 'tipo_documento', etichetta: 'Tipo doc.' },
                  { chiave: 'imponibile', etichetta: 'Imponibile € (netto IVA)' },
                  { chiave: 'iva', etichetta: 'IVA €' },
                  { chiave: 'totale', etichetta: 'Totale € (lordo IVA)' },
                  { chiave: 'totale_pagato', etichetta: 'Pagato € (lordo IVA)' },
                  { chiave: 'stato_pagamento', etichetta: 'Stato' },
                  { chiave: 'scadenza_pagamento', etichetta: 'Scadenza' },
                ]} />
              </div>

              {/* Toolbar selezione multipla */}
              {!loadingFat && fattureFiltrate.length > 0 && (
                <div className="flex items-center gap-3 py-2 px-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-500">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded accent-violet-600"
                      checked={fattureFiltrate.length > 0 && fattureFiltrate.every(f => selectedIds.has(f.id))}
                      onChange={e => {
                        if (e.target.checked) setSelectedIds(new Set(fattureFiltrate.map(f => f.id)))
                        else setSelectedIds(new Set())
                      }}
                    />
                    {selectedIds.size > 0 ? `${selectedIds.size} selezionate` : 'Seleziona tutto'}
                  </label>
                  {selectedIds.size > 0 && (
                    <>
                      <span className="text-gray-200">|</span>
                      <button
                        onClick={() => setBulkModal(true)}
                        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                        <CheckCircle2 size={12}/>
                        Segna {selectedIds.size} come pagate
                      </button>
                      <button
                        onClick={() => setSelectedIds(new Set())}
                        className="text-xs text-gray-400 hover:text-gray-600">
                        <X size={12}/>
                      </button>
                    </>
                  )}
                </div>
              )}

              {loadingFat
                ? <p className="text-sm text-gray-400 text-center py-8">Caricamento...</p>
                : fattureFiltrate.length === 0
                  ? <p className="text-sm text-gray-400 text-center py-8">Nessuna fattura</p>
                  : <div className="space-y-2">
                      {fattureFiltrate.map(f => (
                        <FatturaRow key={f.id} f={f}
                          checked={selectedIds.has(f.id)}
                          onToggle={id => setSelectedIds(prev => {
                            const next = new Set(prev)
                            next.has(id) ? next.delete(id) : next.add(id)
                            return next
                          })}
                          onAddPag={(fat) => setPagModal({ fattura: fat })}
                          onEditPag={(pg, fat) => setPagModal({ fattura: fat, pagamento: pg })}
                          onDeletePag={loadData}/>
                      ))}
                    </div>
              }
            </div>
          )}

          {/* ── TAB PRODOTTI ── */}
          {tab === 'prodotti' && (
            <div className="space-y-3">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input className="input pl-8 py-1.5 text-xs w-full" placeholder="Cerca prodotto o codice..." value={searchProd} onChange={e => setSearchProd(e.target.value)}/>
              </div>
              {prodottiFiltrati.length === 0
                ? <div className="text-center py-10 text-gray-400">
                    <Package size={28} className="mx-auto mb-2 opacity-40"/>
                    <p className="text-sm">Nessun prodotto estratto per questo fornitore</p>
                    <p className="text-xs mt-1">Esegui <code className="bg-gray-100 px-1 rounded">estrai_righe_fatture.py</code> dalla cartella FATTURE/</p>
                  </div>
                : (
                  <div className="space-y-1.5">
                    {/* fatture_righe.importo_riga è NETTO IVA: la colonna "Spesa tot."
                        non è confrontabile con il KPI "Spesa" della testata (lordo). */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        Importi di questo tab: <strong>netto IVA</strong> (righe fattura). I KPI in testata sono lordo IVA:
                        i due totali non torneranno mai identici.
                      </p>
                      <BottoneCsv righe={prodottiFiltrati} nomeFile={`prodotti_${fornitore.p_iva}`} colonne={[
                        { chiave: 'codice_articolo', etichetta: 'Codice' },
                        { chiave: 'descrizione', etichetta: 'Descrizione' },
                        { chiave: 'nome_normalizzato', etichetta: 'Nome normalizzato' },
                        { chiave: 'um', etichetta: 'UM' },
                        { chiave: 'tot_qty', etichetta: 'Qtà totale' },
                        { chiave: 'ultimo_prezzo', etichetta: 'Ultimo prezzo € (netto IVA)' },
                        { chiave: 'tot_importo', etichetta: 'Spesa totale € (netto IVA)' },
                        { chiave: 'n_occorrenze', etichetta: 'N. occorrenze' },
                      ]} />
                    </div>
                    <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-3 px-2 py-1 text-xs font-medium text-gray-400 border-b border-gray-100">
                      <span>Codice</span><span>Prodotto</span><span>Qty tot.</span><span>Ult. prezzo</span><span>Spesa tot. (netto IVA)</span>
                    </div>
                    {prodottiFiltrati.map((p) => (
                      <div key={p.codice_articolo || p.nome_normalizzato || p.descrizione} className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-3 px-2 py-2 text-xs border-b border-gray-50 hover:bg-gray-50 rounded-lg items-center">
                        <span className="font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded border text-[10px] whitespace-nowrap">{p.codice_articolo || '—'}</span>
                        <div className="min-w-0">
                          <p className="font-medium text-gray-700 truncate">{p.descrizione}</p>
                          {p.nome_normalizzato && p.nome_normalizzato !== p.descrizione.toUpperCase() && (
                            <p className="text-gray-400 text-[10px] truncate">{p.nome_normalizzato}</p>
                          )}
                          <div className="flex items-center gap-1 mt-0.5">
                            {p.aliquota_iva && <span className="text-gray-300">IVA {p.aliquota_iva}%</span>}
                            {p.um && <span className="text-gray-300">· {p.um}</span>}
                            <span className="text-gray-300">· {p.n_occorrenze}×</span>
                          </div>
                        </div>
                        <span className="text-gray-600 whitespace-nowrap">{p.tot_qty?.toFixed(2)} {p.um || ''}</span>
                        <span className="text-gray-600 whitespace-nowrap">{eur(p.ultimo_prezzo)}</span>
                        <span className="font-semibold text-gray-800 whitespace-nowrap">{eur(p.tot_importo)}</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          )}

          {/* ── TAB TREND ── */}
          {tab === 'trend' && (
            <div className="space-y-5">
              {trendForn.length < 2
                ? <p className="text-gray-400 text-sm text-center py-8">Insufficienti dati per il grafico</p>
                : <>
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-3">Spesa mensile</p>
                    <ResponsiveContainer width="100%" height={180}>
                      <AreaChart data={trendForn} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gradForn" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.15}/>
                            <stop offset="95%" stopColor="#7c3aed" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd"/>
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `€${(v/1000).toFixed(0)}k`}/>
                        <Tooltip formatter={v => eur(v)} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11 }}/>
                        <Area type="monotone" dataKey="spesa" stroke="#7c3aed" fill="url(#gradForn)" strokeWidth={2} name="Spesa"/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-gray-50 rounded-xl p-3 text-center">
                      <p className="text-xs text-gray-400">Media mensile</p>
                      <p className="font-semibold text-gray-800 text-sm">{eur(trendForn.reduce((s,m) => s+m.spesa,0) / trendForn.length)}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 text-center">
                      <p className="text-xs text-gray-400">Mese più alto</p>
                      <p className="font-semibold text-gray-800 text-sm">{eur(Math.max(...trendForn.map(m=>m.spesa)))}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 text-center">
                      <p className="text-xs text-gray-400">N. mesi</p>
                      <p className="font-semibold text-gray-800 text-sm">{trendForn.length}</p>
                    </div>
                  </div>
                </>}
            </div>
          )}

          {/* ── TAB ANAGRAFICA ── */}
          {tab === 'anagrafica' && (
            <div className="space-y-3">
              {[
                { k: 'nome', label: 'Ragione sociale' },
                { k: 'p_iva', label: 'P.IVA' },
                { k: 'email', label: 'Email', type: 'email' },
                { k: 'telefono', label: 'Telefono', type: 'tel' },
                { k: 'indirizzo', label: 'Indirizzo' },
                { k: 'cap', label: 'CAP', half: true },
                { k: 'comune', label: 'Comune', half: true },
                { k: 'provincia', label: 'Provincia', half: true },
                { k: 'iban', label: 'IBAN' },
              ].reduce((rows, field, i, arr) => {
                if (field.half && arr[i-1]?.half) {
                  rows[rows.length - 1].push(field)
                } else {
                  rows.push([field])
                }
                return rows
              }, []).map((group, gi) => (
                <div key={gi} className={`grid gap-3 ${group.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {group.map(field => (
                    <div key={field.k}>
                      <label className="text-xs text-gray-500 mb-1 block">{field.label}</label>
                      {editing
                        ? <input type={field.type || 'text'} className="input text-sm"
                            value={editForm[field.k] || ''}
                            onChange={e => setEditForm(f => ({...f, [field.k]: e.target.value}))}/>
                        : <p className="text-sm text-gray-700 py-1 px-2 bg-gray-50 rounded-lg min-h-[32px]">{fornitore[field.k] || <span className="text-gray-300 italic">—</span>}</p>
                      }
                    </div>
                  ))}
                </div>
              ))}

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Categoria</label>
                {editing
                  ? <select className="input text-sm" value={editForm.categoria || 'ALTRO'} onChange={e => setEditForm(f => ({...f, categoria: e.target.value}))}>
                      {CATEGORIE.filter(c => c !== 'TUTTI').map(c => <option key={c}>{c}</option>)}
                    </select>
                  : <Badge label={fornitore.categoria || 'ALTRO'} className={CAT_COLOR[fornitore.categoria] || CAT_COLOR.ALTRO}/>
                }
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Note</label>
                {editing
                  ? <textarea className="input text-sm h-20 resize-none" value={editForm.note || ''} onChange={e => setEditForm(f => ({...f, note: e.target.value}))}/>
                  : <p className="text-sm text-gray-700 py-1 px-2 bg-gray-50 rounded-lg min-h-[48px] whitespace-pre-wrap">{fornitore.note || <span className="text-gray-300 italic">—</span>}</p>
                }
              </div>

              {editing && (
                <div className="flex gap-2 pt-2">
                  <button onClick={() => { setEditing(false); setEditForm({...fornitore}) }} className="btn-ghost flex-1 text-sm py-2">Annulla</button>
                  <button onClick={handleSaveEdit} disabled={savingEdit} className="btn-primary flex-1 text-sm py-2">{savingEdit ? '...' : 'Salva modifiche'}</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {pagModal && (
        <PagamentoModal
          fattura={pagModal.fattura}
          pagamento={pagModal.pagamento}
          onClose={() => setPagModal(null)}
          onSaved={loadData}/>
      )}

      {bulkModal && (
        <BulkPagamentoModal
          fatture={fatture.filter(f => selectedIds.has(f.id))}
          onClose={() => setBulkModal(false)}
          onDone={() => { setSelectedIds(new Set()); loadData() }}/>
      )}
    </div>
  )
}

// ─── BiSection (BI Analytics) ─────────────────────────────────────────────────
function BiSection({ dateFrom, dateTo }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState(null)
  const [sedeFilter, setSedeFilter] = useState('TUTTI')

  useEffect(() => {
    let annullato = false
    setLoading(true); setErrore(null)
    const sede = sedeFilter !== 'TUTTI' ? sedeFilter : undefined
    fornitoriApi.analisi({ from: dateFrom, to: dateTo, sede })
      .then(d => { if (!annullato) setData(d) })
      // Il catch riempiva la pagina di zeri: un guasto diventava "spesa €0",
      // cioè un dato falso invece di un errore.
      .catch(e => { if (!annullato) { setErrore(e?.message || String(e)); setData(null) } })
      .finally(() => { if (!annullato) setLoading(false) })
    return () => { annullato = true }
  }, [dateFrom, dateTo, sedeFilter])

  if (loading) return <p className="text-sm text-gray-400 text-center py-8">Caricamento BI...</p>
  if (errore) return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
      <AlertCircle size={15} className="text-red-500 flex-shrink-0"/>
      <p className="text-sm text-red-700"><strong>Analisi non disponibile:</strong> {errore}</p>
    </div>
  )
  if (!data) return null

  const mensileLabeled = data.mensile.map(m => ({ ...m, label: fmt_mese(m.mese) }))
  const totSpesa = data.mensile.reduce((s, m) => s + m.tot_spesa, 0)
  const mediaM   = data.mensile.length > 0 ? totSpesa / data.mensile.length : 0
  const meseMax  = data.mensile.length > 0 ? [...data.mensile].sort((a,b) => b.tot_spesa - a.tot_spesa)[0] : null

  return (
    <div className="space-y-5">
      {/* Filtro sede */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Sede:</span>
        <div className="flex rounded-xl overflow-hidden border border-gray-200 text-xs font-medium">
          {['TUTTI','MA','PN'].map(s => (
            <button key={s} onClick={() => setSedeFilter(s)}
              className={`px-4 py-1.5 transition-colors ${sedeFilter===s ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {s === 'TUTTI' ? 'Entrambe' : s === 'MA' ? 'Sede MA' : 'Sede PN'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          // fatture_importate.totale = totale documento: tutti questi importi
          // sono LORDI IVA (note di credito TD04 già sottratte lato API).
          { label: 'Spesa totale (lordo IVA)', val: eur(totSpesa), icon: '💰', col: 'text-gray-800' },
          { label: 'Media mensile (lordo IVA)', val: eur(mediaM), icon: '📅', col: 'text-violet-700' },
          { label: 'Prev. mese succ. (lordo IVA)', val: data.forecast ? eur(data.forecast) : '—', icon: '🔮', col: 'text-blue-700' },
          { label: 'Fornitori attivi', val: data.perGruppo.filter(f=>f.tot_spesa>0).length, icon: '🏭', col: 'text-gray-800' },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">{k.icon}</span>
              <p className="text-xs text-gray-400">{k.label}</p>
            </div>
            <p className={`font-bold text-lg ${k.col}`}>{k.val}</p>
          </div>
        ))}
      </div>

      {/* Trend spesa mensile — con split MA/PN se TUTTI */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-gray-700">📈 Trend spesa mensile</p>
          {meseMax && <p className="text-xs text-gray-400">Picco: <span className="font-medium text-gray-600">{fmt_mese(meseMax.mese)}</span> — {eur(meseMax.tot_spesa)}</p>}
        </div>
        {mensileLabeled.length < 2
          ? <p className="text-sm text-gray-400 text-center py-6">Insufficienti dati nel periodo selezionato</p>
          : <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={mensileLabeled} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradBI" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#7c3aed" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gradMA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gradPN" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd"/>
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} width={52}/>
                <Tooltip formatter={v => eur(v)} contentStyle={{ fontSize: 11 }} itemStyle={{ fontSize: 11 }}/>
                {sedeFilter === 'TUTTI' ? <>
                  <Area type="monotone" dataKey="MA" stroke="#3b82f6" fill="url(#gradMA)" strokeWidth={2} name="Sede MA"/>
                  <Area type="monotone" dataKey="PN" stroke="#8b5cf6" fill="url(#gradPN)" strokeWidth={2} name="Sede PN"/>
                </> :
                  <Area type="monotone" dataKey="tot_spesa" stroke="#7c3aed" fill="url(#gradBI)" strokeWidth={2.5} name="Spesa"/>
                }
                {sedeFilter === 'TUTTI' && <Legend wrapperStyle={{ fontSize: 10 }}/>}
              </AreaChart>
            </ResponsiveContainer>
        }
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Spesa per categoria (Pie) */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-sm font-semibold text-gray-700 mb-4">🍕 Spesa per categoria</p>
          {data.perCategoria.length === 0
            ? <p className="text-sm text-gray-400 text-center py-6">Nessun dato</p>
            : (
              <div className="flex items-center gap-4">
                <PieChart width={130} height={130}>
                  <Pie data={data.perCategoria} dataKey="tot_spesa" cx={60} cy={60} outerRadius={55} innerRadius={30}>
                    {data.perCategoria.map((e) => (
                      <Cell key={e.categoria} fill={CAT_CHART_COLOR[e.categoria] || '#6b7280'}/>
                    ))}
                  </Pie>
                  <Tooltip formatter={v => eur(v)} contentStyle={{ fontSize: 10 }}/>
                </PieChart>
                <div className="flex-1 space-y-1.5 min-w-0">
                  {data.perCategoria.slice(0, 7).map((c) => {
                    const tot = data.perCategoria.reduce((s, x) => s + x.tot_spesa, 0)
                    return (
                      <div key={c.categoria} className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CAT_CHART_COLOR[c.categoria] || '#6b7280' }}/>
                        <span className="text-xs text-gray-600 truncate flex-1">{c.categoria}</span>
                        <span className="text-xs font-medium text-gray-700 whitespace-nowrap">{eur(c.tot_spesa)}</span>
                        <span className="text-xs text-gray-400">{pct(c.tot_spesa, tot)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
        </div>

        {/* Top fornitori */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-sm font-semibold text-gray-700 mb-4">🏆 Top fornitori per spesa</p>
          {data.perGruppo.length === 0
            ? <p className="text-sm text-gray-400 text-center py-6">Nessun dato nel periodo</p>
            : <div className="space-y-2">
                {data.perGruppo.slice(0, 8).map((f, i) => {
                  const max = data.perGruppo[0].tot_spesa
                  return (
                    <div key={f.p_iva || f.nome} className="space-y-0.5">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs text-gray-400 w-4 flex-shrink-0">{i+1}.</span>
                          <span className="text-xs font-medium text-gray-700 truncate">{f.nome}</span>
                          <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${CAT_COLOR[f.categoria] || CAT_COLOR.ALTRO} flex-shrink-0`}>{f.categoria}</span>
                        </div>
                        <span className="text-xs font-semibold text-gray-700 ml-2">{eur(f.tot_spesa)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(f.tot_spesa/max)*100}%`, background: CAT_CHART_COLOR[f.categoria] || '#6b7280' }}/>
                      </div>
                    </div>
                  )
                })}
              </div>
          }
        </div>
      </div>

      {/* Split MA vs PN — solo se TUTTI */}
      {sedeFilter === 'TUTTI' && data.bySede && (data.bySede.MA > 0 || data.bySede.PN > 0) && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-sm font-semibold text-gray-700 mb-4">🏪 Split costi per sede</p>
          <div className="grid grid-cols-2 gap-4">
            {[
              { sede: 'MA', label: 'Sede MA (CA)', val: data.bySede.MA, color: '#3b82f6' },
              { sede: 'PN', label: 'Sede PN (SS)', val: data.bySede.PN, color: '#8b5cf6' },
            ].map(s => {
              const tot = (data.bySede.MA || 0) + (data.bySede.PN || 0)
              const pcVal = tot > 0 ? ((s.val / tot) * 100).toFixed(1) : 0
              return (
                <div key={s.sede} className="rounded-xl p-4 border" style={{ borderColor: s.color + '40', background: s.color + '08' }}>
                  <p className="text-xs font-medium mb-1" style={{ color: s.color }}>{s.label}</p>
                  <p className="text-xl font-bold text-gray-800">{eur(s.val)}</p>
                  <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pcVal}%`, background: s.color }}/>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{pcVal}% del totale</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── AllocaSediSection ─────────────────────────────────────────────────────
// Filtra fatture + multi-select + azioni bulk sede (MA/PN/split/custom)
function AllocaSediSection({ dateFrom, dateTo }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [filtri, setFiltri]   = useState({ categoria_tipo: 'TUTTI', sede: 'TUTTE', solo_manuali: false, p_iva: '', search: '' })
  const [categorie, setCategorie] = useState([])
  const [selected, setSelected]   = useState(new Set())
  const [bulkOpen, setBulkOpen]   = useState(false)
  const [bulkAction, setBulkAction] = useState({ sposta_a: 'SPLIT50', ma_pct: 50, pn_pct: 50, note: '', applyToAll: false })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let annullato = false
    fattureCategorieApi?.getAll?.()
      .then(c => { if (!annullato) setCategorie(c) })
      .catch(() => fornitoriApi.getCategorie?.().then(c => { if (!annullato) setCategorie(c) }).catch(()=>{}))
    return () => { annullato = true }
  }, [])

  const [loadAllocaError, setLoadAllocaError] = useState(null)
  const [troncato, setTroncato] = useState(false)
  const richiestaRef = useRef(0)

  const load = useCallback(async () => {
    const mia = ++richiestaRef.current
    setLoading(true); setSelected(new Set()); setLoadAllocaError(null)
    try {
      // `listaArricchite({ limit: 1000 })` chiedeva ESATTAMENTE il cap PostgREST:
      // con più fatture nel filtro il set era troncato senza alcun segnale, e
      // l'azione bulk "su tutte quelle del filtro" (che agisce lato DB) lavorava
      // su un insieme più grande di quello mostrato. Qui si pagina davvero:
      // v_fatture_arricchite ha `fattura_id`, univoco e stabile.
      const build = () => {
        let q = supabase.from('v_fatture_arricchite').select('*')
        if (dateFrom) q = q.gte('data_fattura', dateFrom)
        if (dateTo)   q = q.lte('data_fattura', dateTo)
        if (filtri.p_iva) q = q.eq('p_iva', filtri.p_iva.replace(/^IT/, ''))
        if (filtri.categoria_tipo !== 'TUTTI') q = q.eq('categoria_tipo', filtri.categoria_tipo)
        if (filtri.sede === 'MA') q = q.gt('importo_ma', 0)
        if (filtri.sede === 'PN') q = q.gt('importo_pn', 0)
        if (filtri.solo_manuali)  q = q.eq('allocazione_manuale', true)
        return q
      }
      const { righe, troncato: tr } = await fetchPagedInfo(build, 'fattura_id')
      if (mia !== richiestaRef.current) return
      righe.sort((a, b) => String(b.data_fattura || '').localeCompare(String(a.data_fattura || '')))
      // La vista espone `fattura_id`: la UI (checkbox, bulk) lavora su `id`.
      setRows(righe.map(r => ({ ...r, id: r.fattura_id })))
      setTroncato(tr)
    } catch (e) {
      if (mia !== richiestaRef.current) return
      console.error('AllocaSedi load error:', e)
      setLoadAllocaError(e.message || 'Errore caricamento fatture')
      setRows([])
    } finally { if (mia === richiestaRef.current) setLoading(false) }
  }, [dateFrom, dateTo, filtri])

  useEffect(() => {
    load()
    return () => { richiestaRef.current++ }
  }, [load])

  const filtered = useMemo(() => {
    if (!filtri.search) return rows
    const q = filtri.search.toLowerCase()
    return rows.filter(r =>
      (r.fornitore_nome||'').toLowerCase().includes(q) ||
      (r.numero_fattura||'').toLowerCase().includes(q) ||
      (r.p_iva||'').includes(q)
    )
  }, [rows, filtri.search])

  const totSel = useMemo(() => {
    let tot = 0, ma = 0, pn = 0
    for (const r of filtered) if (selected.has(r.id)) {
      tot += parseFloat(r.totale||0); ma += parseFloat(r.importo_ma||0); pn += parseFloat(r.importo_pn||0)
    }
    return { tot, ma, pn, n: selected.size }
  }, [filtered, selected])

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(r => r.id)))
  }

  const applyBulk = async () => {
    setSaving(true)
    try {
      const opts = {
        sposta_a: bulkAction.sposta_a,
        ma_pct: bulkAction.sposta_a === 'CUSTOM' ? Number(bulkAction.ma_pct) : null,
        pn_pct: bulkAction.sposta_a === 'CUSTOM' ? Number(bulkAction.pn_pct) : null,
        note:   bulkAction.note || null,
      }
      if (bulkAction.sposta_a === 'CUSTOM') opts.sposta_a = null
      let res
      if (bulkAction.applyToAll) {
        res = await fornitoriApi.allocaFiltro({
          from: dateFrom, to: dateTo,
          p_iva: filtri.p_iva || null,
          categoria_tipo: filtri.categoria_tipo !== 'TUTTI' ? filtri.categoria_tipo : null,
          ...opts,
        })
      } else {
        res = await fornitoriApi.allocaBulk(Array.from(selected), opts)
      }
      alert(`✓ ${res.aggiornate} fatture aggiornate`)
      setBulkOpen(false); setSelected(new Set())
      await load()
    } catch (e) { alert('Errore: ' + e.message) }
    finally { setSaving(false) }
  }

  const catList = useMemo(() => ['TUTTI', ...Array.from(new Set(categorie.map(c => c.tipo)))], [categorie])

  return (
    <div className="space-y-4">
      {loadAllocaError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertCircle size={15} className="text-red-500 flex-shrink-0"/>
          <p className="text-sm text-red-700"><strong>Errore caricamento:</strong> {loadAllocaError}</p>
          <button onClick={load} className="ml-auto text-xs text-red-600 hover:underline">Riprova</button>
        </div>
      )}
      {/* Filtri */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <input className="input py-1.5 text-sm flex-1 min-w-[200px]"
            placeholder="Cerca fornitore, numero fattura, P.IVA..."
            value={filtri.search} onChange={e => setFiltri({...filtri, search: e.target.value})}/>
          <select className="input py-1.5 text-sm" value={filtri.categoria_tipo}
            onChange={e => setFiltri({...filtri, categoria_tipo: e.target.value})}>
            {catList.map(c => <option key={c} value={c}>{c === 'TUTTI' ? 'Tutte le categorie' : c}</option>)}
          </select>
          <select className="input py-1.5 text-sm" value={filtri.sede}
            onChange={e => setFiltri({...filtri, sede: e.target.value})}>
            <option value="TUTTE">Tutte le sedi</option>
            <option value="MA">Solo MA</option>
            <option value="PN">Solo PN</option>
          </select>
          <label className="text-xs flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-xl cursor-pointer">
            <input type="checkbox" checked={filtri.solo_manuali}
              onChange={e => setFiltri({...filtri, solo_manuali: e.target.checked})}/>
            Solo allocazioni manuali
          </label>
          <button onClick={load} className="btn-ghost p-2 text-gray-500 rounded-xl border border-gray-200">
            <RefreshCw size={14}/>
          </button>
        </div>
      </div>

      {/* Azione bulk */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-10 bg-violet-600 text-white rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-lg">
          <div className="text-sm font-medium">
            {totSel.n} selezionate · {eur(totSel.tot)} · MA {eur(totSel.ma)} / PN {eur(totSel.pn)}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setBulkAction({...bulkAction, sposta_a:'MA', applyToAll:false}); setBulkOpen(true) }}
              className="px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-xs font-medium">→ MA 100%</button>
            <button onClick={() => { setBulkAction({...bulkAction, sposta_a:'PN', applyToAll:false}); setBulkOpen(true) }}
              className="px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-xs font-medium">→ PN 100%</button>
            <button onClick={() => { setBulkAction({...bulkAction, sposta_a:'SPLIT50', applyToAll:false}); setBulkOpen(true) }}
              className="px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-xs font-medium">Split 50/50</button>
            <button onClick={() => { setBulkAction({...bulkAction, sposta_a:'CUSTOM', ma_pct:70, pn_pct:30, applyToAll:false}); setBulkOpen(true) }}
              className="px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-xs font-medium">Custom %</button>
            <button onClick={() => setSelected(new Set())}
              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs">Annulla</button>
          </div>
        </div>
      )}

      {/* Tabella */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-3 text-xs text-gray-500">
          <input type="checkbox" className="cursor-pointer"
            checked={filtered.length > 0 && selected.size === filtered.length}
            onChange={toggleAll}/>
          <span className="flex-1">{loading ? 'Caricamento...' : `${filtered.length} fatture`}</span>
          <BottoneCsv righe={filtered} nomeFile="fatture_allocazione_sedi" colonne={[
            { chiave: 'fornitore_nome', etichetta: 'Fornitore' },
            { chiave: 'p_iva', etichetta: 'P.IVA' },
            { chiave: 'numero_fattura', etichetta: 'N. fattura' },
            { chiave: 'data_fattura', etichetta: 'Data' },
            { chiave: 'categoria_tipo', etichetta: 'Categoria' },
            { chiave: 'totale', etichetta: 'Totale € (lordo IVA)' },
            { chiave: 'importo_ma', etichetta: 'Quota MA € (lordo IVA)' },
            { chiave: 'importo_pn', etichetta: 'Quota PN € (lordo IVA)' },
            { chiave: 'sede_presunta', etichetta: 'Sede presunta 50/50', valore: r => (r.sede_presunta ? 'sì' : 'no') },
            { chiave: 'allocazione_manuale', etichetta: 'Allocazione manuale', valore: r => (r.allocazione_manuale ? 'sì' : 'no') },
            { chiave: 'is_nota_credito', etichetta: 'Nota di credito', valore: r => (r.is_nota_credito ? 'sì' : 'no') },
          ]} />
          <button
            onClick={() => { setBulkAction({...bulkAction, applyToAll: true, sposta_a:'SPLIT50'}); setBulkOpen(true) }}
            title="L'azione viene eseguita a DB su tutte le fatture che rispettano periodo, P.IVA e categoria — la ricerca testuale digitata qui NON viene applicata."
            className="text-xs text-violet-600 hover:underline">
            Azione bulk lato DB su tutto il filtro (periodo + P.IVA + categoria) →
          </button>
        </div>
        <div className="px-4 pb-2">
          <NotaCopertura righe={rows.length} da={dateFrom || '—'} a={dateTo || 'oggi'}
            fonte="v_fatture_arricchite (lordo IVA)" troncato={troncato}
            extra={filtri.search ? `${filtered.length} dopo la ricerca testuale (lato client)` : undefined} />
        </div>
        <div className="max-h-[60vh] overflow-auto">
          {filtered.slice(0, 500).map(r => (
            <div key={r.id} className={`px-4 py-2 border-b border-gray-50 flex items-center gap-3 text-sm hover:bg-gray-50 ${selected.has(r.id) ? 'bg-violet-50' : ''}`}>
              <input type="checkbox" className="cursor-pointer"
                checked={selected.has(r.id)}
                onChange={() => {
                  const s = new Set(selected)
                  if (s.has(r.id)) s.delete(r.id); else s.add(r.id)
                  setSelected(s)
                }}/>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 truncate flex items-center gap-1.5">
                  {r.fornitore_nome}
                  {/* Nota di credito: in v_fatture_arricchite il totale è già NEGATIVO.
                      Senza etichetta un importo con il meno sembra un errore di import. */}
                  {r.is_nota_credito && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 border border-orange-200 flex-shrink-0">
                      NC
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-400">{r.numero_fattura} · {r.data_fattura} · {r.categoria_tipo || '—'}</p>
              </div>
              <div className="text-right text-xs text-gray-500 flex-shrink-0 w-48">
                <div>MA {eur(r.importo_ma)} · PN {eur(r.importo_pn)}</div>
                {/* sede_presunta = la fattura NON ha una ripartizione salvata e la
                    vista la spalma 50/50 per convenzione (9.960 fatture storiche
                    2019-2024). Va detto: prima si leggeva "% / % · auto", che
                    faceva passare una convenzione per un dato reale. */}
                {r.sede_presunta ? (
                  <div className="text-[10px] text-amber-600" title="Nessuna ripartizione salvata: la vista assegna 50/50 per convenzione. Non è un dato rilevato.">
                    50% / 50% · presunta
                  </div>
                ) : (
                  <div className="text-[10px]">
                    {r.sede_ma_pct}% / {r.sede_pn_pct}% {r.allocazione_manuale ? '· manuale' : '· auto'}
                  </div>
                )}
              </div>
              <div className={`text-right font-semibold w-24 flex-shrink-0 ${r.is_nota_credito ? 'text-orange-600' : 'text-gray-800'}`}>
                {eur(r.totale)}
              </div>
            </div>
          ))}
          {filtered.length > 500 && (
            <div className="px-4 py-2 text-xs text-gray-400 text-center">
              Mostro prime 500 di {filtered.length}. Usa filtri o "Azione bulk su tutte".
            </div>
          )}
        </div>
      </div>

      {/* Modal conferma bulk */}
      {bulkOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !saving && setBulkOpen(false)}>
          <div className="bg-white rounded-2xl p-5 max-w-md w-full space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg">Conferma allocazione sede</h3>
            <div className="text-sm text-gray-600">
              Target: <strong>{bulkAction.applyToAll
                ? 'TUTTE le fatture che a DB rispettano il filtro'
                : `${selected.size} fatture selezionate`}</strong>
            </div>
            {bulkAction.applyToAll && (
              // Il numero mostrato in lista non è il target: allocaFiltro lavora
              // lato DB su periodo + P.IVA + categoria, senza la ricerca testuale.
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                L'operazione viene eseguita dal database su <strong>periodo {dateFrom || 'tutto'} → {dateTo || 'oggi'}</strong>
                {filtri.p_iva && <>, P.IVA <strong>{filtri.p_iva}</strong></>}
                {filtri.categoria_tipo !== 'TUTTI' && <>, categoria <strong>{filtri.categoria_tipo}</strong></>}.
                Le {filtered.length} righe elencate sono solo quelle caricate a schermo
                {filtri.search && <> e filtrate per il testo "{filtri.search}", che <strong>non</strong> viene applicato</>}:
                il numero di fatture aggiornate può essere maggiore.
              </div>
            )}
            <div className="space-y-2">
              <label className="text-xs text-gray-500">Azione</label>
              <select className="input py-1.5 text-sm w-full" value={bulkAction.sposta_a}
                onChange={e => setBulkAction({...bulkAction, sposta_a: e.target.value})}>
                <option value="MA">100% Sede MA</option>
                <option value="PN">100% Sede PN</option>
                <option value="SPLIT50">Split 50/50 MA-PN</option>
                <option value="CUSTOM">Custom %</option>
              </select>
              {bulkAction.sposta_a === 'CUSTOM' && (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500">MA %</label>
                    <input type="number" min="0" max="100" className="input py-1.5 text-sm w-full" value={bulkAction.ma_pct}
                      onChange={e => { const ma = Math.max(0, Math.min(100, Number(e.target.value)||0)); setBulkAction({...bulkAction, ma_pct: ma, pn_pct: 100-ma}) }}/>
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500">PN %</label>
                    <input type="number" min="0" max="100" className="input py-1.5 text-sm w-full" value={bulkAction.pn_pct}
                      onChange={e => { const pn = Math.max(0, Math.min(100, Number(e.target.value)||0)); setBulkAction({...bulkAction, pn_pct: pn, ma_pct: 100-pn}) }}/>
                  </div>
                </div>
              )}
              <label className="text-xs text-gray-500">Note (opzionale)</label>
              <input className="input py-1.5 text-sm w-full" placeholder="es: riallocato dopo verifica"
                value={bulkAction.note} onChange={e => setBulkAction({...bulkAction, note: e.target.value})}/>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-ghost px-4 py-2 text-sm" disabled={saving} onClick={() => setBulkOpen(false)}>Annulla</button>
              <button className="bg-violet-600 text-white px-4 py-2 rounded-xl text-sm font-medium" disabled={saving} onClick={applyBulk}>
                {saving ? 'Applico...' : 'Conferma'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── FornitoriPage (main) ─────────────────────────────────────────────────────
export default function FornitoriPage() {
  const [view, setView]           = useState('list') // 'list' | 'bi' | 'alloca'
  const [fornitori, setFornitori] = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [catFilter, setCatFilter] = useState('TUTTI')
  const [selectedF, setSelectedF] = useState(null)

  // Filtro periodo
  const [dateFrom, setDateFrom] = useState(PERIODI[3].from) // Anno corrente di default
  const [dateTo,   setDateTo]   = useState(PERIODI[3].to)
  const changePeriod = (f, t) => { setDateFrom(f); setDateTo(t) }

  const [errore, setErrore] = useState(null)
  const richiestaRef = useRef(0)

  const load = useCallback(async () => {
    const mia = ++richiestaRef.current
    setLoading(true); setErrore(null)
    try {
      // `getAll` legge v_fornitori_completi senza `.range()`: oltre 1000
      // fornitori (oggi 428) la lista si troncherebbe in silenzio, e i KPI di
      // testata — che sommano queste righe — con lei.
      const build = () => {
        let q = supabase.from('v_fornitori_completi').select('*')
        if (catFilter !== 'TUTTI') q = q.eq('categoria', catFilter)
        return q
      }
      const righe = await fetchPagedInfo(build, 'id')
      if (mia !== richiestaRef.current) return
      const rows = righe.righe
        .map(r => ({ ...r, partita_iva: r.p_iva, attivo: r.active ?? true }))
        .sort((a, b) => (parseFloat(b.tot_spesa || 0) - parseFloat(a.tot_spesa || 0)))
      setFornitori(rows)
    } catch (e) {
      if (mia !== richiestaRef.current) return
      // try/finally senza catch: un guasto lasciava la lista vuota, identica a
      // "nessun fornitore trovato".
      setErrore(e?.message || String(e))
      setFornitori([])
    } finally { if (mia === richiestaRef.current) setLoading(false) }
  }, [catFilter])

  useEffect(() => {
    load()
    return () => { richiestaRef.current++ }
  }, [load])

  const filtered = useMemo(() => {
    let rows = fornitori.filter(f => f.active !== false)
    if (search) rows = rows.filter(f =>
      f.nome?.toLowerCase().includes(search.toLowerCase()) ||
      f.p_iva?.includes(search)
    )
    return rows
  }, [fornitori, search])

  // KPI
  const totSpesa  = useMemo(() => filtered.reduce((s, f) => s + parseFloat(f.tot_spesa || 0), 0), [filtered])
  const totAperte = useMemo(() => filtered.reduce((s, f) => s + parseInt(f.fatture_aperte || 0), 0), [filtered])
  const totFatture= useMemo(() => filtered.reduce((s, f) => s + parseInt(f.n_fatture || 0), 0), [filtered])

  // Categorie presenti
  const categorieCounts = useMemo(() => {
    const cnt = {}
    for (const f of fornitori) cnt[f.categoria || 'ALTRO'] = (cnt[f.categoria || 'ALTRO'] || 0) + 1
    return cnt
  }, [fornitori])

  return (
    <div className="p-5 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Fornitori & Costi</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {filtered.length} fornitori · {eur(totSpesa)} totale (lordo IVA, tutto lo storico) · {totFatture} fatture
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl overflow-hidden border border-gray-200 text-xs font-medium">
            <button onClick={() => setView('list')} className={`px-4 py-2 ${view==='list' ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              📋 Fornitori
            </button>
            <button onClick={() => setView('bi')} className={`px-4 py-2 ${view==='bi' ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              📊 BI Analisi
            </button>
            <button onClick={() => setView('alloca')} className={`px-4 py-2 ${view==='alloca' ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              🏠 Alloca Sedi
            </button>
          </div>
          <BottoneCsv righe={filtered} nomeFile="fornitori" colonne={[
            { chiave: 'nome', etichetta: 'Fornitore' },
            { chiave: 'p_iva', etichetta: 'P.IVA' },
            { chiave: 'categoria', etichetta: 'Categoria' },
            { chiave: 'n_fatture', etichetta: 'N. fatture' },
            { chiave: 'tot_spesa', etichetta: 'Spesa totale € (lordo IVA)' },
            { chiave: 'tot_pagato', etichetta: 'Pagato € (lordo IVA)' },
            { chiave: 'tot_residuo', etichetta: 'Residuo € (lordo IVA)' },
            { chiave: 'fatture_aperte', etichetta: 'Fatture aperte' },
            { chiave: 'prima_fattura', etichetta: 'Prima fattura' },
            { chiave: 'ultima_fattura', etichetta: 'Ultima fattura' },
          ]} />
          <button onClick={load} className="btn-ghost p-2 text-gray-400 rounded-xl border border-gray-200">
            <RefreshCw size={15}/>
          </button>
        </div>
      </div>

      {/* DateRangeBar */}
      <DateRangeBar from={dateFrom} to={dateTo} onChange={changePeriod}/>

      {/* ── VIEW BI ── */}
      {view === 'bi' && <BiSection dateFrom={dateFrom} dateTo={dateTo}/>}

      {/* ── VIEW ALLOCA SEDI ── */}
      {view === 'alloca' && <AllocaSediSection dateFrom={dateFrom} dateTo={dateTo}/>}

      {/* ── VIEW LIST ── */}
      {view === 'list' && (
        <>
          {/* Filtri — search + sede */}
          <div className="flex gap-2 flex-wrap items-center">
            <Search size={14} className="text-gray-400 flex-shrink-0"/>
            <input className="input py-1.5 text-sm flex-1 min-w-[180px] max-w-xs"
              placeholder="Cerca fornitore o P.IVA..."
              value={search} onChange={e => setSearch(e.target.value)}/>
            {/* Il filtro sede è stato rimosso da qui: v_fornitori_completi aggrega
                TUTTE le sedi e il parametro `sede` non veniva applicato — i tre
                bottoni mostravano sempre lo stesso identico elenco. La ripartizione
                per sede vive nel tab "Alloca Sedi". */}
            <span className="text-xs text-gray-400">
              Totali su entrambe le sedi (lordo IVA) — per la ripartizione MA/PN usa il tab <strong>Alloca Sedi</strong>
            </span>
          </div>

          {errore && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
              <AlertCircle size={15} className="text-red-500 flex-shrink-0"/>
              <p className="text-sm text-red-700"><strong>Fornitori non caricati:</strong> {errore}</p>
              <button onClick={load} className="ml-auto text-xs text-red-600 hover:underline">Riprova</button>
            </div>
          )}

          <div className="flex gap-1.5 flex-wrap">
            {CATEGORIE.map(c => {
              const cnt = c === 'TUTTI' ? fornitori.filter(f => f.active !== false).length : (categorieCounts[c] || 0)
              if (c !== 'TUTTI' && cnt === 0) return null
              return (
                <button key={c} onClick={() => setCatFilter(c)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${catFilter === c ? (c === 'TUTTI' ? 'bg-violet-600 text-white border-violet-600' : CAT_COLOR[c] + ' border-current') : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}>
                  {c} {cnt > 0 && <span className="ml-1 opacity-60">{cnt}</span>}
                </button>
              )
            })}
          </div>

          {/* KPI strip */}
          {totAperte > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <AlertCircle size={16} className="text-amber-500 flex-shrink-0"/>
              <p className="text-sm text-amber-700">
                <strong>{totAperte}</strong> fatture aperte/parziali tra i fornitori visualizzati
              </p>
            </div>
          )}

          {/* Lista fornitori */}
          {loading
            ? <p className="text-sm text-gray-400 text-center py-12">Caricamento fornitori...</p>
            : filtered.length === 0
              ? <p className="text-sm text-gray-400 text-center py-12">Nessun fornitore trovato</p>
              : (
                <div className="grid gap-2">
                  {filtered.map(f => {
                    const hasOpen = parseInt(f.fatture_aperte || 0) > 0
                    return (
                      <div key={f.id}
                        className="flex items-center gap-3 p-4 bg-white border border-gray-100 rounded-2xl hover:border-violet-200 hover:shadow-sm transition-all w-full group cursor-pointer">
                        {/* Avatar — click apre dettaglio */}
                        <div
                          onClick={() => setSelectedF(f)}
                          className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 text-sm font-bold text-gray-400 group-hover:bg-violet-50 group-hover:text-violet-600 transition-colors">
                          {(f.nome || 'F')[0].toUpperCase()}
                        </div>
                        {/* Info — click apre dettaglio */}
                        <div className="flex-1 min-w-0" onClick={() => setSelectedF(f)}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-gray-800 text-sm truncate">{f.nome}</p>
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5 truncate">
                            P.IVA {f.p_iva}
                            {f.n_fatture > 0 && ` · ${f.n_fatture} fatture`}
                            {f.fatture_saldate > 0 && ` · ${f.fatture_saldate} saldate`}
                          </p>
                        </div>
                        {/* CategoriaSelect — fuori dall'area click, NON apre il modale */}
                        <div onClick={e => e.stopPropagation()}>
                          <CategoriaSelect
                            fornitore={f}
                            onChange={(id, nuova) => setFornitori(prev => prev.map(x => x.id === id ? { ...x, categoria: nuova } : x))}
                          />
                        </div>
                        {/* Dati finanziari */}
                        <div className="text-right flex-shrink-0 hidden sm:block" onClick={() => setSelectedF(f)}>
                          <p className="text-sm font-semibold text-gray-800">{eur(f.tot_spesa)}</p>
                          {parseFloat(f.tot_residuo||0) > 0.01
                            ? <p className="text-xs text-amber-600">res. {eur(f.tot_residuo)}</p>
                            : f.n_fatture > 0 ? <p className="text-xs text-emerald-500">✓ tutto saldato</p> : null
                          }
                        </div>
                        {/* Badge residuo mobile */}
                        <div className="text-right sm:hidden" onClick={() => setSelectedF(f)}>
                          <p className="text-xs font-semibold text-gray-700">{eur(f.tot_spesa)}</p>
                        </div>
                        {/* Badge fatture aperte */}
                        {hasOpen && (
                          <div className="bg-red-100 text-red-600 text-xs font-bold px-2 py-1 rounded-lg flex-shrink-0" onClick={() => setSelectedF(f)}>
                            {f.fatture_aperte} AP
                          </div>
                        )}
                        <ChevronRight size={15} className="text-gray-200 flex-shrink-0 group-hover:text-violet-300" onClick={() => setSelectedF(f)}/>
                      </div>
                    )
                  })}
                </div>
              )
          }
        </>
      )}

      {/* Modal fornitore */}
      {selectedF && (
        <FornitoreDetail
          fornitore={selectedF}
          onClose={() => setSelectedF(null)}
          onUpdated={load}
          dateFrom={dateFrom}
          dateTo={dateTo}/>
      )}

      {/* PageAssistant AI */}
      <PageAssistant
        pagina="Fornitori & Costi"
        systemContext={`Fornitori attivi: ${filtered.length}. Periodo analisi: ${dateFrom || 'tutto'} → ${dateTo || 'oggi'}. Spesa totale: ${eur(totSpesa)}. Fatture aperte: ${totAperte}.`}
        suggerimenti={[
          "Segna come pagate tutte le fatture aperte di MARR fino a marzo 2025",
          "Registra un acconto di €500 sulla fattura più recente di LA MOLISANA",
          "Qual è il fornitore con più fatture aperte?",
          "Mostrami le fatture non pagate di questo mese",
        ]}
        tools={[
          {
            name: 'cerca_fatture',
            description: 'Cerca fatture per fornitore (nome o P.IVA), stato (APERTA/PARZIALE/SALDATA) e/o periodo. Ritorna lista fatture con importi e stato.',
            input_schema: {
              type: 'object',
              properties: {
                fornitore_nome: { type: 'string', description: 'Nome parziale del fornitore (case insensitive)' },
                p_iva: { type: 'string', description: 'P.IVA esatta del fornitore' },
                stato: { type: 'string', enum: ['APERTA','PARZIALE','SALDATA','TUTTI'], description: 'Stato pagamento fattura' },
                data_da: { type: 'string', description: 'Data inizio YYYY-MM-DD' },
                data_a: { type: 'string', description: 'Data fine YYYY-MM-DD' },
                limit: { type: 'number', description: 'Max risultati (default 50)' },
              },
            },
          },
          {
            name: 'registra_pagamento',
            description: 'Registra un pagamento (totale, acconto o saldo) su una singola fattura identificata dal suo ID.',
            input_schema: {
              type: 'object',
              required: ['fattura_id', 'importo', 'data_pagamento'],
              properties: {
                fattura_id: { type: 'string', description: 'ID della fattura (UUID)' },
                importo: { type: 'number', description: 'Importo in euro' },
                data_pagamento: { type: 'string', description: 'Data pagamento YYYY-MM-DD' },
                tipo: { type: 'string', enum: ['PAGAMENTO','ACCONTO','SALDO','STORNO'], description: 'Tipo operazione (default PAGAMENTO)' },
                metodo: { type: 'string', enum: ['BONIFICO','RIBA','RID','CONTANTI','CARTA','ALTRO'], description: 'Metodo pagamento (default BONIFICO)' },
                note: { type: 'string' },
              },
            },
          },
          {
            name: 'segna_fatture_saldate_bulk',
            description: 'Segna più fatture come saldate in una volta sola. Per ogni fattura registra un pagamento pari al residuo.',
            input_schema: {
              type: 'object',
              required: ['fattura_ids', 'data_pagamento'],
              properties: {
                fattura_ids: { type: 'array', items: { type: 'string' }, description: 'Array di UUID fatture' },
                data_pagamento: { type: 'string', description: 'Data pagamento YYYY-MM-DD' },
                metodo: { type: 'string', enum: ['BONIFICO','RIBA','RID','CONTANTI','CARTA','ALTRO'], description: 'Metodo pagamento' },
                note: { type: 'string' },
              },
            },
          },
          {
            name: 'get_fornitori_lista',
            description: 'Ritorna la lista dei fornitori con nome, P.IVA, spesa totale, residuo e numero fatture aperte.',
            input_schema: {
              type: 'object',
              properties: {
                categoria: { type: 'string', description: 'Filtra per categoria (FOOD, BEVERAGE, ecc.)' },
                solo_con_aperte: { type: 'boolean', description: 'Mostra solo fornitori con fatture aperte' },
              },
            },
          },
        ]}
        onToolCall={async (toolName, toolInput) => {
          try {
            if (toolName === 'get_fornitori_lista') {
              const rows = await fornitoriApi.getAll({ categoria: toolInput.categoria })
              const list = rows.filter(f => !toolInput.solo_con_aperte || parseInt(f.fatture_aperte || 0) > 0)
              return list.map(f => `${f.nome} (P.IVA ${f.p_iva}) — spesa ${eur(f.tot_spesa)}, residuo ${eur(f.tot_residuo)}, ${f.fatture_aperte || 0} aperte`).join('\n') || 'Nessun fornitore'
            }

            if (toolName === 'cerca_fatture') {
              const params = { limit: toolInput.limit || 50 }
              if (toolInput.p_iva) params.p_iva = toolInput.p_iva
              if (toolInput.data_da) params.from = toolInput.data_da
              if (toolInput.data_a) params.to = toolInput.data_a
              if (toolInput.stato && toolInput.stato !== 'TUTTI') params.stato = toolInput.stato
              const fats = await fornitoriApi.getFatture(params)
              const filtered = toolInput.fornitore_nome
                ? fats.filter(f => f.fornitore?.toLowerCase().includes(toolInput.fornitore_nome.toLowerCase()))
                : fats
              if (!filtered.length) return 'Nessuna fattura trovata con i criteri specificati'
              return `Trovate ${filtered.length} fatture:\n` +
                filtered.slice(0, 30).map(f =>
                  `• [${f.id}] ${f.fornitore} · n.${f.numero_fattura} · ${f.data_fattura} · ${eur(f.totale)} · ${f.stato_pagamento || 'APERTA'}${parseFloat(f.totale_pagato||0) > 0 ? ` (pagato: ${eur(f.totale_pagato)})` : ''}`
                ).join('\n')
            }

            if (toolName === 'registra_pagamento') {
              const { fattura_id, importo, data_pagamento, tipo = 'PAGAMENTO', metodo = 'BONIFICO', note = '' } = toolInput
              await pagApi.add({ fattura_id, importo, data_pagamento, tipo, metodo, note })
              load()
              return `✓ Pagamento di ${eur(importo)} registrato sulla fattura ${fattura_id} (${tipo} · ${metodo})`
            }

            if (toolName === 'segna_fatture_saldate_bulk') {
              const { fattura_ids, data_pagamento, metodo = 'BONIFICO', note = '' } = toolInput

              // ── Validazione input ──────────────────────────────────────────
              if (!Array.isArray(fattura_ids) || fattura_ids.length === 0)
                return 'Errore: fattura_ids deve essere un array non vuoto'

              const isoDateRe = /^\d{4}-\d{2}-\d{2}$/
              if (!isoDateRe.test(data_pagamento)) {
                const d = new Date(data_pagamento)
                if (isNaN(d.getTime()))
                  return `Errore: data_pagamento non valida ("${data_pagamento}"). Formato richiesto: YYYY-MM-DD`
              }

              if (!METODI_PAG.includes(metodo))
                return `Errore: metodo non valido ("${metodo}"). Usa: ${METODI_PAG.join(', ')}`
              // ─────────────────────────────────────────────────────────────

              // Carica dettagli fatture tramite fattureBi (supabase client — no chiavi hardcoded)
              const fats = await fattureBi.getByIds(fattura_ids)
              if (!Array.isArray(fats)) return 'Errore nel recupero delle fatture'

              let count = 0
              for (const fat of fats) {
                const totale     = parseFloat(fat.totale) || 0
                const pagato     = parseFloat(fat.totale_pagato) || 0
                const residuo    = Math.max(0, +(totale - pagato).toFixed(2))
                if (residuo > 0.01) {
                  await pagApi.add({ fattura_id: fat.id, importo: residuo, data_pagamento, tipo: 'SALDO', metodo, note })
                  count++
                }
              }
              load()
              return `✓ ${count} fatture saldate (residuo registrato per ciascuna, data: ${data_pagamento})`
            }

            return `Tool "${toolName}" non riconosciuto`
          } catch (e) {
            return `Errore nell'esecuzione: ${e.message}`
          }
        }}
      />
    </div>
  )
}
