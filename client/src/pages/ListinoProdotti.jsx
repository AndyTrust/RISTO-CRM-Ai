import React, { useEffect, useMemo, useState } from 'react'
import { listinoApi, fornitori as fornitoriApi } from '../api/supabase-client'
import { Search, Plus, Save, Trash2, X, TrendingUp, TrendingDown, Package, Link2, AlertTriangle } from 'lucide-react'

// ─── Pagina Listino Prodotti ────────────────────────────────────────────────
// Gestisce i 151+ prodotti importati da iPratico con prezzi vendita, costo
// materia prima, margine lordo e collegamento al fornitore.
// Integra anche i "prodotti orfani" del venduto_camerieri che non trovano match.
export default function ListinoProdotti() {
  const [rows, setRows] = useState([])
  const [fornitori, setFornitori] = useState([])
  const [orphans, setOrphans] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState({ categoria: '', listino: '', search: '' })
  const [editRow, setEditRow] = useState(null)
  const [showOrphans, setShowOrphans] = useState(false)
  const [sedeOrphan, setSedeOrphan] = useState('MA')

  const reload = async () => {
    setLoading(true)
    try {
      const [r, f, o] = await Promise.all([
        listinoApi.getAll(filter),
        fornitoriApi.getAll().catch(() => []),
        listinoApi.prodottiSenzaMatch(sedeOrphan).catch(() => []),
      ])
      setRows(r); setFornitori(f); setOrphans(o)
    } catch (e) { console.error(e); alert('Errore caricamento: ' + e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { reload() }, [filter.categoria, filter.listino, filter.search, sedeOrphan])

  const categorie = useMemo(() => [...new Set(rows.map(r => r.categoria))].sort(), [rows])

  const stats = useMemo(() => {
    if (!rows.length) return null
    const prezzi = rows.filter(r => r.prezzo_vendita != null).map(r => +r.prezzo_vendita)
    const margini = rows.filter(r => r.margine_lordo_pct != null).map(r => +r.margine_lordo_pct)
    return {
      totale: rows.length,
      collegati: rows.filter(r => r.fornitore_id).length,
      prezzo_medio: prezzi.length ? (prezzi.reduce((a,b)=>a+b,0) / prezzi.length).toFixed(2) : '—',
      margine_medio: margini.length ? (margini.reduce((a,b)=>a+b,0) / margini.length).toFixed(1) : '—',
      piu_alto: [...rows].sort((a,b) => (b.margine_lordo_pct||0) - (a.margine_lordo_pct||0))[0],
      piu_basso: [...rows].filter(r => r.margine_lordo_pct != null).sort((a,b) => (a.margine_lordo_pct||0) - (b.margine_lordo_pct||0))[0],
    }
  }, [rows])

  const save = async (row) => {
    setSaving(true)
    try {
      if (row.id) await listinoApi.update(row.id, row)
      else await listinoApi.create(row)
      setEditRow(null)
      await reload()
    } catch (e) { alert('Errore salvataggio: ' + e.message) }
    finally { setSaving(false) }
  }

  const del = async (id) => {
    if (!confirm('Eliminare questo prodotto dal listino?')) return
    try { await listinoApi.remove(id); await reload() }
    catch (e) { alert('Errore: ' + e.message) }
  }

  const mapOrphanToProduct = (orphan) => {
    setEditRow({
      categoria: 'ALTRO',
      listino: 'LISTINO',
      nome_prodotto: orphan.prodotto,
      prezzo_vendita: null,
      costo_acquisto: null,
      margine_lordo_pct: null,
      note: `Auto-aggiunto da venduto (${orphan.quantita} pezzi)`,
      attivo: true,
    })
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package size={24} /> Listino Prodotti
          </h1>
          <p className="text-sm text-gray-500">Prezzi vendita, costo materia, margini e collegamento fornitori</p>
        </div>
        <button
          onClick={() => setEditRow({ categoria: '', listino: 'LISTINO', nome_prodotto: '', attivo: true })}
          className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
        >
          <Plus size={16} /> Nuovo prodotto
        </button>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label="Prodotti" value={stats.totale} color="indigo" />
          <KpiCard label="Con fornitore" value={`${stats.collegati}/${stats.totale}`} color={stats.collegati === stats.totale ? 'green' : 'amber'} />
          <KpiCard label="Prezzo medio" value={`€ ${stats.prezzo_medio}`} color="gray" />
          <KpiCard label="Margine medio" value={`${stats.margine_medio}%`} color="green" />
          <KpiCard label="Senza match venduto" value={orphans.length} color={orphans.length ? 'red' : 'green'}
            onClick={() => setShowOrphans(true)} clickable />
        </div>
      )}

      {/* Filtri */}
      <div className="bg-white rounded-xl shadow-sm border p-3 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={filter.search}
            onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
            placeholder="Cerca prodotto..."
            className="pl-8 pr-3 py-2 text-sm border rounded-lg w-64"
          />
        </div>
        <select value={filter.categoria} onChange={e => setFilter(f => ({ ...f, categoria: e.target.value }))} className="text-sm border rounded-lg px-2 py-2">
          <option value="">Tutte le categorie</option>
          {categorie.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filter.listino} onChange={e => setFilter(f => ({ ...f, listino: e.target.value }))} className="text-sm border rounded-lg px-2 py-2">
          <option value="">Tutti i listini</option>
          <option value="LISTINO">LISTINO</option>
          <option value="DELIVEROO">DELIVEROO</option>
        </select>
        <span className="text-xs text-gray-500 ml-auto">{rows.length} prodotti</span>
      </div>

      {/* Tabella */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b text-[11px] uppercase tracking-wide text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left">Categoria</th>
                <th className="px-3 py-2 text-left">Listino</th>
                <th className="px-3 py-2 text-left">Nome prodotto</th>
                <th className="px-3 py-2 text-right">Vendita</th>
                <th className="px-3 py-2 text-right">Costo</th>
                <th className="px-3 py-2 text-right">Margine</th>
                <th className="px-3 py-2 text-left">Fornitore</th>
                <th className="px-3 py-2 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">Caricamento...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">Nessun prodotto trovato</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{r.categoria}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">{r.listino}</td>
                  <td className="px-3 py-2 font-medium">{r.nome_prodotto}</td>
                  <td className="px-3 py-2 text-right tabular-nums">€ {r.prezzo_vendita ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-700">€ {r.costo_acquisto ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <MargineBadge pct={r.margine_lordo_pct} />
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.fornitori_fatture ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <Link2 size={11} /> {r.fornitori_fatture.nome}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditRow(r)} className="text-indigo-600 hover:underline text-xs mr-2">Modifica</button>
                    <button onClick={() => del(r.id)} className="text-red-600 hover:underline text-xs">
                      <Trash2 size={12} className="inline" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal modifica/creazione */}
      {editRow && (
        <EditModal
          row={editRow}
          fornitori={fornitori}
          categorie={categorie}
          saving={saving}
          onSave={save}
          onCancel={() => setEditRow(null)}
        />
      )}

      {/* Modal orfani */}
      {showOrphans && (
        <OrphansModal
          orphans={orphans}
          sede={sedeOrphan}
          setSede={setSedeOrphan}
          onMap={mapOrphanToProduct}
          onClose={() => setShowOrphans(false)}
        />
      )}
    </div>
  )
}

// ─── Badge margine con colore ─────────────────────────────────────────────
function MargineBadge({ pct }) {
  if (pct == null) return <span className="text-gray-400">—</span>
  const p = +pct
  const color = p >= 75 ? 'green' : p >= 60 ? 'emerald' : p >= 45 ? 'amber' : p >= 25 ? 'orange' : 'red'
  const Icon = p >= 60 ? TrendingUp : p < 40 ? AlertTriangle : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-${color}-50 text-${color}-700`}>
      <Icon size={11} /> {p.toFixed(1)}%
    </span>
  )
}

function KpiCard({ label, value, color = 'gray', onClick, clickable }) {
  const colors = {
    indigo: 'border-indigo-200 bg-indigo-50',
    green:  'border-emerald-200 bg-emerald-50',
    amber:  'border-amber-200 bg-amber-50',
    red:    'border-red-200 bg-red-50',
    gray:   'border-gray-200 bg-white',
  }
  return (
    <div
      onClick={clickable ? onClick : undefined}
      className={`rounded-xl border shadow-sm p-3 ${colors[color]} ${clickable ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
    >
      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  )
}

// ─── Modal edit ──────────────────────────────────────────────────────────
function EditModal({ row, fornitori, categorie, saving, onSave, onCancel }) {
  const [form, setForm] = useState(row)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Auto-calcola margine
  useEffect(() => {
    if (form.prezzo_vendita > 0 && form.costo_acquisto != null) {
      const m = ((form.prezzo_vendita - form.costo_acquisto) / form.prezzo_vendita * 100).toFixed(2)
      set('margine_lordo_pct', +m)
    }
  }, [form.prezzo_vendita, form.costo_acquisto])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-bold">{row.id ? 'Modifica prodotto' : 'Nuovo prodotto'}</h3>
          <button onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoria">
              <input list="cat-list" value={form.categoria || ''} onChange={e => set('categoria', e.target.value)} className="w-full text-sm border rounded px-2 py-1.5" />
              <datalist id="cat-list">{categorie.map(c => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Listino">
              <select value={form.listino || 'LISTINO'} onChange={e => set('listino', e.target.value)} className="w-full text-sm border rounded px-2 py-1.5">
                <option value="LISTINO">LISTINO</option>
                <option value="DELIVEROO">DELIVEROO</option>
              </select>
            </Field>
          </div>
          <Field label="Nome prodotto">
            <input value={form.nome_prodotto || ''} onChange={e => set('nome_prodotto', e.target.value)} className="w-full text-sm border rounded px-2 py-1.5" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Prezzo vendita (€)">
              <input type="number" step="0.01" value={form.prezzo_vendita ?? ''} onChange={e => set('prezzo_vendita', e.target.value === '' ? null : +e.target.value)} className="w-full text-sm border rounded px-2 py-1.5" />
            </Field>
            <Field label="Costo materia (€)">
              <input type="number" step="0.0001" value={form.costo_acquisto ?? ''} onChange={e => set('costo_acquisto', e.target.value === '' ? null : +e.target.value)} className="w-full text-sm border rounded px-2 py-1.5" />
            </Field>
            <Field label="Margine %">
              <input type="number" step="0.01" value={form.margine_lordo_pct ?? ''} readOnly className="w-full text-sm border rounded px-2 py-1.5 bg-gray-50" />
            </Field>
          </div>
          <Field label="Fornitore principale">
            <select value={form.fornitore_id || ''} onChange={e => set('fornitore_id', e.target.value || null)} className="w-full text-sm border rounded px-2 py-1.5">
              <option value="">— nessuno —</option>
              {fornitori.map(f => <option key={f.id} value={f.id}>{f.nome} {f.p_iva ? `(${f.p_iva})` : ''}</option>)}
            </select>
          </Field>
          <Field label="Note">
            <textarea value={form.note || ''} onChange={e => set('note', e.target.value)} rows={2} className="w-full text-sm border rounded px-2 py-1.5" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.attivo !== false} onChange={e => set('attivo', e.target.checked)} />
            Prodotto attivo
          </label>
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm border rounded-lg">Annulla</button>
          <button onClick={() => onSave(form)} disabled={saving || !form.nome_prodotto || !form.categoria} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1">
            <Save size={14} /> {saving ? 'Salvataggio...' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal orfani (prodotti venduti senza match in listino) ──────────────
function OrphansModal({ orphans, sede, setSede, onMap, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <h3 className="font-bold">Prodotti venduti senza match in listino</h3>
            <p className="text-xs text-gray-500">Questi prodotti appaiono nel venduto_camerieri ma non hanno prezzo nel listino</p>
          </div>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="px-5 py-2 border-b flex items-center gap-3 text-sm">
          <span>Sede:</span>
          {['MA','PN'].map(s => (
            <button key={s} onClick={() => setSede(s)} className={`px-3 py-1 rounded-full text-xs ${sede === s ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>{s}</button>
          ))}
        </div>
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-[11px] uppercase tracking-wide text-gray-600">
                <th className="px-3 py-2 text-left">Prodotto</th>
                <th className="px-3 py-2 text-right">Pezzi venduti</th>
                <th className="px-3 py-2 text-right">Azione</th>
              </tr>
            </thead>
            <tbody>
              {orphans.map((o, i) => (
                <tr key={i} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2">{o.prodotto}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{o.quantita}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => onMap(o)} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700">
                      + Aggiungi a listino
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-600 mb-1 block">{label}</span>
      {children}
    </label>
  )
}
