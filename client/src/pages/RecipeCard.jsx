/**
 * RecipeCard.jsx — Scheda ricetta / distinta base di un prodotto (Fase ricette v1).
 * Apri un prodotto → aggiungi/modifica ingredienti (quantità, unità, costo €/unità).
 * Il food cost "definito" = somma(quantità × costo unitario), calcolato in tempo reale.
 * Suggerimento prezzo ingrediente dalle fatture fornitori.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { X, Plus, Trash2, Loader, Receipt, Search, Save } from 'lucide-react'
import { ricetteApi, listinoApi } from '../api/client'

const UNITA = ['g', 'kg', 'ml', 'cl', 'L', 'pz']
const eur = (n) => `€${(Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function RecipeCard({ prodotto, prezzoVendita, onClose, onSaved }) {
  const [righe, setRighe] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [nuovo, setNuovo] = useState({ ingrediente: '', quantita: '', unita: 'g', costo_unitario: '' })
  // suggerimenti prezzo ingrediente
  const [suggOpen, setSuggOpen] = useState(false)
  const [sugg, setSugg] = useState([])
  const [suggLoading, setSuggLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setRighe(await ricetteApi.list(prodotto)) }
    catch { setRighe([]) }
    finally { setLoading(false) }
  }, [prodotto])

  useEffect(() => { load() }, [load])

  const totale = righe.reduce((s, r) => s + (Number(r.quantita) || 0) * (Number(r.costo_unitario) || 0), 0)
  const fcPct = prezzoVendita > 0 ? +(100 * totale / prezzoVendita).toFixed(1) : null

  const aggiungi = async () => {
    if (!nuovo.ingrediente.trim()) return
    setSaving(true)
    try {
      await ricetteApi.salvaRiga({ ...nuovo, nome_prodotto: prodotto })
      setNuovo({ ingrediente: '', quantita: '', unita: nuovo.unita, costo_unitario: '' })
      setSuggOpen(false); setSugg([])
      await load()
    } finally { setSaving(false) }
  }

  const elimina = async (id) => {
    setSaving(true)
    try { await ricetteApi.eliminaRiga(id); await load() }
    finally { setSaving(false) }
  }

  const cercaPrezzo = async () => {
    const q = nuovo.ingrediente.trim()
    if (q.length < 2) return
    setSuggOpen(true); setSuggLoading(true)
    try { setSugg(await listinoApi.suggerimentiCosto({ query: q })) }
    catch { setSugg([]) }
    finally { setSuggLoading(false) }
  }

  const chiudi = () => { onSaved && onSaved(); onClose() }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={chiudi}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Ricetta — {prodotto}</h3>
            <p className="text-xs text-gray-500">Food cost definito dagli ingredienti · prezzo di vendita {prezzoVendita > 0 ? eur(prezzoVendita) : 'n/d'}</p>
          </div>
          <button onClick={chiudi} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        {/* Totale */}
        <div className="px-5 py-3 bg-violet-50 border-b border-violet-100 flex flex-wrap items-center gap-4">
          <div><span className="text-xs text-gray-500">Food cost ricetta</span><div className="text-xl font-bold text-violet-700">{eur(totale)}</div></div>
          <div><span className="text-xs text-gray-500">Food cost %</span><div className={`text-xl font-bold ${fcPct == null ? 'text-gray-400' : fcPct <= 30 ? 'text-green-600' : fcPct <= 40 ? 'text-orange-500' : 'text-red-600'}`}>{fcPct == null ? '—' : `${fcPct}%`}</div></div>
          <div className="text-xs text-gray-500 ml-auto">{righe.length} ingredienti · {righe.length ? 'costo DEFINITO' : 'nessuna ricetta (resta indicativo)'}</div>
        </div>

        {/* Righe */}
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-400"><Loader size={18} className="animate-spin mr-2" /> Caricamento…</div>
          ) : (
            <table className="w-full text-sm mb-3">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="py-1.5 pr-2 font-medium">Ingrediente</th>
                  <th className="py-1.5 px-2 font-medium text-right">Q.tà</th>
                  <th className="py-1.5 px-2 font-medium">Unità</th>
                  <th className="py-1.5 px-2 font-medium text-right">Costo €/unità</th>
                  <th className="py-1.5 px-2 font-medium text-right">Costo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {righe.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50">
                    <td className="py-1.5 pr-2 text-gray-800">{r.ingrediente}</td>
                    <td className="py-1.5 px-2 text-right text-gray-600">{r.quantita}</td>
                    <td className="py-1.5 px-2 text-gray-500">{r.unita}</td>
                    <td className="py-1.5 px-2 text-right text-gray-600">{eur(r.costo_unitario)}</td>
                    <td className="py-1.5 px-2 text-right font-medium text-gray-800">{eur((Number(r.quantita) || 0) * (Number(r.costo_unitario) || 0))}</td>
                    <td className="py-1.5 pl-2 text-right">
                      <button onClick={() => elimina(r.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
                {righe.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-center text-gray-400 text-sm">Nessun ingrediente. Aggiungi la prima riga qui sotto.</td></tr>
                )}
              </tbody>
            </table>
          )}

          {/* Nuova riga */}
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs text-gray-500 mb-1">Ingrediente</label>
                <input value={nuovo.ingrediente} onChange={e => setNuovo({ ...nuovo, ingrediente: e.target.value })}
                  placeholder="es. Guanciale" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div className="w-20">
                <label className="block text-xs text-gray-500 mb-1">Q.tà</label>
                <input type="number" step="0.001" min="0" value={nuovo.quantita} onChange={e => setNuovo({ ...nuovo, quantita: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right" />
              </div>
              <div className="w-20">
                <label className="block text-xs text-gray-500 mb-1">Unità</label>
                <select value={nuovo.unita} onChange={e => setNuovo({ ...nuovo, unita: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
                  {UNITA.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="w-28">
                <label className="block text-xs text-gray-500 mb-1">Costo €/unità</label>
                <input type="number" step="0.0001" min="0" value={nuovo.costo_unitario} onChange={e => setNuovo({ ...nuovo, costo_unitario: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right" />
              </div>
              <button onClick={cercaPrezzo} title="Cerca prezzo dalle fatture" className="flex items-center gap-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs hover:bg-white">
                <Receipt size={13} /> prezzo
              </button>
              <button onClick={aggiungi} disabled={saving || !nuovo.ingrediente.trim()}
                className="flex items-center gap-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 text-sm font-semibold">
                {saving ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />} Aggiungi
              </button>
            </div>

            {/* Suggerimenti prezzo */}
            {suggOpen && (
              <div className="mt-2 border-t border-gray-200 pt-2">
                {suggLoading ? (
                  <div className="text-xs text-gray-400 flex items-center gap-2"><Loader size={12} className="animate-spin" /> Ricerca prezzi…</div>
                ) : sugg.length === 0 ? (
                  <div className="text-xs text-gray-400">Nessun prezzo trovato in fattura per “{nuovo.ingrediente}”.</div>
                ) : (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {sugg.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs bg-white border border-gray-100 rounded-lg px-2 py-1">
                        <span className="flex-1 text-gray-600">{s.descrizione}</span>
                        <span className="text-gray-400">{s.unita_misura || ''}</span>
                        <span className="font-medium text-gray-700">{eur(s.prezzo_medio)}</span>
                        <button onClick={() => { setNuovo({ ...nuovo, costo_unitario: String(s.prezzo_medio ?? '') }); setSuggOpen(false) }}
                          className="bg-violet-600 hover:bg-violet-700 text-white rounded px-2 py-0.5 font-semibold">Usa</button>
                      </div>
                    ))}
                    <p className="text-[11px] text-gray-400">Il prezzo è spesso per confezione/kg: imposta Q.tà e Unità coerenti (es. 0,04 kg di guanciale a €/kg).</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={chiudi} className="flex items-center gap-2 bg-gray-900 hover:bg-black text-white rounded-lg px-4 py-2 text-sm font-semibold">
            <Save size={15} /> Fatto
          </button>
        </div>
      </div>
    </div>
  )
}
