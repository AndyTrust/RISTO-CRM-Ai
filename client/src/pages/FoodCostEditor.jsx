/**
 * FoodCostEditor.jsx — Modifica del food cost (costo_acquisto €) per ogni prodotto.
 * Carica i prodotti venduti con il loro food cost attuale (da v_menu_engineering),
 * permette di modificare il costo unitario e salva in listino_prodotti.
 * Il food cost % si aggiorna in tempo reale (costo / prezzo medio).
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { Coins, Search, Save, Loader, CheckCircle2, AlertTriangle, RefreshCw, Receipt, X, Wand2, ChefHat } from 'lucide-react'
import { listinoApi, ricetteApi } from '../api/client'
import RecipeCard from './RecipeCard'

// Categorie "rivendita" (prodotto acquistato e rivenduto, senza ricetta)
const RESELL = new Set(['BIBITE', 'BIRRE', 'VINI', 'VINI BICCHIERE', 'AMARI'])
// Frazionamento al bicchiere/calice (cl di prodotto per porzione)
const PORZIONE_CL = { 'VINI BICCHIERE': 12.5, 'AMARI': 4 }
const BOTTIGLIA_CL_DEFAULT = { 'VINI BICCHIERE': 75, 'AMARI': 70, 'VINI': 75 }
const STOPWORDS = new Set(['CALICE', 'BICCHIERE', 'BOTTIGLIA', 'BOTT', 'GLASS', 'DELLA', 'DELLO', 'DEL', 'CL', 'LT', 'ML', 'IL', 'LA', 'DI', 'DA'])

// Estrae pezzi per confezione e volume (cl) dalla descrizione fattura
function parsePack(desc) {
  const d = String(desc || '').toUpperCase()
  let pieces = 1
  const mX = d.match(/X\s?(\d{1,3})\b/)
  if (mX) pieces = parseInt(mX[1]) || 1
  let cl = null
  const mLt = d.match(/(\d+[.,]?\d*)\s?LT\b/) || d.match(/\bLT\s?(\d+[.,]?\d*)/)
  const mCl = d.match(/(\d+[.,]?\d*)\s?CL\b/) || d.match(/\bCL\s?(\d+[.,]?\d*)/)
  if (mLt) cl = parseFloat(mLt[1].replace(',', '.')) * 100
  else if (mCl) cl = parseFloat(mCl[1].replace(',', '.'))
  return { pieces: pieces > 0 ? pieces : 1, cl }
}

// Token principale del nome prodotto per cercare il match in fattura (rimuove parole generiche)
function tokenRicerca(nome) {
  const toks = String(nome || '').toUpperCase().split(/[^A-Z0-9]+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t))
  if (!toks.length) return ''
  return toks.sort((a, b) => b.length - a.length)[0]
}

const SEDI = [
  { value: 'ALL', label: 'Tutte le sedi' },
  { value: 'MA', label: 'Mameli (MA)' },
  { value: 'PN', label: 'Predda Niedda (PN)' },
]

const eur = (n) => (n == null ? '—' : `€${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

// Colore food cost %: verde ≤30, arancio ≤40, rosso oltre
const fcColor = (fc) => fc == null ? 'text-gray-400' : fc <= 30 ? 'text-green-600' : fc <= 40 ? 'text-orange-500' : 'text-red-600'

export default function FoodCostEditor() {
  const [sede, setSede] = useState('ALL')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [soloMancanti, setSoloMancanti] = useState(false)
  const [edits, setEdits] = useState({})        // { PRODOTTO_KEY: "valore €" }
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(null)
  // Suggerimenti da fatture
  const [openKey, setOpenKey] = useState(null)
  const [suggQuery, setSuggQuery] = useState('')
  const [sugg, setSugg] = useState([])
  const [suggLoading, setSuggLoading] = useState(false)
  const [autoBusy, setAutoBusy] = useState(false)
  const [ricMap, setRicMap] = useState({})       // prodotto_key → { n_ingredienti, costo_food }
  const [recipeProduct, setRecipeProduct] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null); setSavedMsg(null)
    try {
      const [data, ric] = await Promise.all([
        listinoApi.prodottiConFoodCost({ sede }),
        ricetteApi.sommario().catch(() => ({})),
      ])
      setRows(data)
      setRicMap(ric || {})
      setEdits({})
    } catch (e) {
      setError(e?.message || 'Errore di caricamento')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [sede])

  useEffect(() => { load() }, [load])

  const keyOf = (r) => r.prodotto.toUpperCase()

  const filtered = useMemo(() => rows.filter(r => {
    const matchSearch = !search || r.prodotto.toLowerCase().includes(search.toLowerCase())
    const matchMancanti = !soloMancanti || r.costo_acquisto == null
    return matchSearch && matchMancanti
  }), [rows, search, soloMancanti])

  // Ricetta del prodotto (se presente → food cost DEFINITO)
  const ricetta = (r) => ricMap[keyOf(r)] || null
  const haRicetta = (r) => { const x = ricetta(r); return !!(x && x.n_ingredienti > 0) }

  // Costo effettivo: ricetta (definito) → altrimenti valore in editing/indicativo
  const costoEffettivo = (r) => {
    const x = ricetta(r)
    if (x && x.n_ingredienti > 0) return x.costo_food
    const k = keyOf(r)
    const raw = edits[k] !== undefined ? edits[k] : (r.costo_acquisto ?? '')
    const c = parseFloat(String(raw).replace(',', '.'))
    return isFinite(c) ? c : null
  }

  // food cost % live (definito da ricetta o indicativo)
  const liveFc = (r) => {
    const costo = costoEffettivo(r)
    if (costo == null || costo <= 0 || !(r.prezzo_medio > 0)) return null
    return +(100 * costo / r.prezzo_medio).toFixed(1)
  }

  const changedKeys = useMemo(() => Object.keys(edits).filter(k => {
    const r = rows.find(x => keyOf(x) === k)
    if (!r) return false
    const orig = r.costo_acquisto == null ? '' : String(r.costo_acquisto)
    return String(edits[k]).trim() !== orig.trim() && String(edits[k]).trim() !== ''
  }), [edits, rows])

  const setEdit = (k, v) => setEdits(prev => ({ ...prev, [k]: v }))

  // ── Suggerimenti prezzo da fatture ────────────────────────────────────────
  const caricaSugg = useCallback(async (q) => {
    setSuggLoading(true)
    try { setSugg(await listinoApi.suggerimentiCosto({ query: q })) }
    catch { setSugg([]) }
    finally { setSuggLoading(false) }
  }, [])

  const apriSugg = (r) => {
    const k = keyOf(r)
    if (openKey === k) { setOpenKey(null); return }
    setOpenKey(k)
    setSuggQuery(r.prodotto)
    caricaSugg(r.prodotto)
  }

  const applicaSugg = (k, prezzo) => {
    setEdit(k, String(prezzo))
    setOpenKey(null)
  }

  // ── Auto-compila rivendita (bibite/birre/vini/amari) dai prezzi fattura ────
  const autoCompila = useCallback(async () => {
    setAutoBusy(true); setSavedMsg(null); setError(null)
    try {
      const purchases = await listinoApi.prezziAcquistoTutti()
      const acquisti = (purchases || []).map(p => ({ ...p, _d: String(p.descrizione || '').toUpperCase() }))
      const nuovi = {}
      let filled = 0
      for (const r of rows) {
        const cat = (r.categoria || '').toUpperCase()
        if (!RESELL.has(cat)) continue
        if (r.costo_acquisto != null) continue // non sovrascrivere i costi esistenti
        const token = tokenRicerca(r.prodotto)
        if (!token) continue
        const matches = acquisti.filter(p => p._d.includes(token))
        if (!matches.length) continue
        const best = matches[0] // già ordinati per fatture_count desc
        const prezzo = Number(best.prezzo_medio) || 0
        if (prezzo <= 0) continue
        const { pieces, cl } = parsePack(best.descrizione)
        const perPezzo = prezzo / (pieces || 1)
        let costo = perPezzo
        if (PORZIONE_CL[cat]) {
          const bottiglia = cl || BOTTIGLIA_CL_DEFAULT[cat] || 75
          costo = perPezzo * (PORZIONE_CL[cat] / bottiglia)
        }
        if (!(costo > 0)) continue
        nuovi[keyOf(r)] = costo.toFixed(costo < 1 ? 3 : 2)
        filled++
      }
      setEdits(prev => ({ ...prev, ...nuovi }))
      setSavedMsg(filled
        ? `Auto-compilati ${filled} prodotti rivendita — controlla i valori e premi "Salva modifiche"`
        : 'Nessun prodotto rivendita da auto-compilare (già valorizzati o senza match in fattura)')
    } catch (e) {
      setError(e?.message || 'Errore auto-compilazione')
    } finally {
      setAutoBusy(false)
    }
  }, [rows])

  const salvaTutto = async () => {
    if (!changedKeys.length) return
    setSaving(true); setError(null); setSavedMsg(null)
    let ok = 0, fail = 0
    for (const k of changedKeys) {
      const r = rows.find(x => keyOf(x) === k)
      const costo = parseFloat(String(edits[k]).replace(',', '.'))
      try {
        await listinoApi.salvaCosto({
          nome_prodotto: r.prodotto, categoria: r.categoria,
          costo_acquisto: costo, prezzo_vendita: r.prezzo_medio || null,
        })
        ok++
      } catch (e) { fail++; }
    }
    setSaving(false)
    setSavedMsg(`Salvati ${ok} prodotti${fail ? ` · ${fail} errori` : ''}`)
    await load()
  }

  const nMancanti = rows.filter(r => r.costo_acquisto == null).length

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Coins className="text-amber-600" size={22} />
          <div>
            <h2 className="text-lg font-bold text-gray-900 leading-tight">Food Cost per prodotto</h2>
            <p className="text-sm text-gray-500">Modifica il costo unitario (€) di ogni prodotto — il food cost % si aggiorna in tempo reale</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={sede} onChange={e => setSede(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
            {SEDI.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-gray-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Ricarica
          </button>
          <button onClick={salvaTutto} disabled={saving || !changedKeys.length}
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg px-3 py-2 text-sm font-semibold">
            {saving ? <Loader size={15} className="animate-spin" /> : <Save size={15} />}
            Salva modifiche{changedKeys.length ? ` (${changedKeys.length})` : ''}
          </button>
        </div>
      </div>

      {/* Barra strumenti */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca prodotto…"
            className="border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm w-64" />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={soloMancanti} onChange={e => setSoloMancanti(e.target.checked)} />
          Solo senza food cost ({nMancanti})
        </label>
        <button onClick={autoCompila} disabled={autoBusy || loading}
          title="Auto-compila bibite, birre, vini e amari dal prezzo medio delle fatture (÷ pezzi confezione; vini/amari al calice)"
          className="flex items-center gap-2 border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50 rounded-lg px-3 py-2 text-sm font-medium">
          {autoBusy ? <Loader size={15} className="animate-spin" /> : <Wand2 size={15} />}
          Auto-compila rivendita
        </button>
        {savedMsg && <span className="text-sm text-green-700 flex items-center gap-1"><CheckCircle2 size={14} /> {savedMsg}</span>}
        {error && <span className="text-sm text-red-700 flex items-center gap-1"><AlertTriangle size={14} /> {error}</span>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400"><Loader size={20} className="animate-spin mr-2" /> Caricamento…</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-left text-gray-500">
                  <th className="py-2 px-4 font-medium">Prodotto</th>
                  <th className="py-2 px-4 font-medium">Categoria</th>
                  <th className="py-2 px-4 font-medium text-right">Pezzi</th>
                  <th className="py-2 px-4 font-medium text-right">Prezzo medio</th>
                  <th className="py-2 px-4 font-medium text-right">Costo € (food cost)</th>
                  <th className="py-2 px-4 font-medium text-right">Food cost %</th>
                  <th className="py-2 px-4 font-medium text-center">Fatture</th>
                  <th className="py-2 px-4 font-medium text-center">Ricetta</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const k = keyOf(r)
                  const val = edits[k] !== undefined ? edits[k] : (r.costo_acquisto ?? '')
                  const fc = liveFc(r)
                  const isChanged = changedKeys.includes(k)
                  return (
                    <React.Fragment key={k}>
                    <tr className={`border-b border-gray-50 ${r.costo_acquisto == null ? 'bg-amber-50/40' : ''} ${isChanged ? 'bg-violet-50/50' : ''}`}>
                      <td className="py-1.5 px-4 font-medium text-gray-800">{r.prodotto}</td>
                      <td className="py-1.5 px-4 text-gray-500">{r.categoria || '—'}</td>
                      <td className="py-1.5 px-4 text-right text-gray-600">{r.quantita}</td>
                      <td className="py-1.5 px-4 text-right text-gray-700">{eur(r.prezzo_medio)}</td>
                      <td className="py-1.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <span className="text-gray-400">€</span>
                          <input
                            type="number" step="0.01" min="0" inputMode="decimal"
                            value={val}
                            onChange={e => setEdit(k, e.target.value)}
                            placeholder={r.costo_acquisto == null ? '—' : ''}
                            className={`w-24 text-right border rounded-lg px-2 py-1 text-sm ${isChanged ? 'border-violet-400 bg-white' : 'border-gray-200'}`}
                          />
                        </div>
                      </td>
                      <td className={`py-1.5 px-4 text-right font-semibold ${fcColor(fc)}`}>
                        {fc == null ? '—' : `${fc}%`}
                        {haRicetta(r) && <span className="ml-1 text-[10px] align-middle px-1 py-0.5 rounded bg-violet-100 text-violet-700 font-bold">def</span>}
                      </td>
                      <td className="py-1.5 px-4 text-center">
                        <button onClick={() => apriSugg(r)} title="Trova il costo dalle fatture fornitori"
                          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs border ${openKey === k ? 'bg-amber-600 text-white border-amber-600' : 'border-gray-200 text-gray-600 hover:bg-amber-50'}`}>
                          <Receipt size={13} /> da fatture
                        </button>
                      </td>
                      <td className="py-1.5 px-4 text-center">
                        <button onClick={() => setRecipeProduct({ nome: r.prodotto, prezzo: r.prezzo_medio })} title="Apri la scheda ricetta (food cost definito dagli ingredienti)"
                          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs border ${haRicetta(r) ? 'bg-violet-600 text-white border-violet-600' : 'border-gray-200 text-gray-600 hover:bg-violet-50'}`}>
                          <ChefHat size={13} /> {haRicetta(r) ? `${eur(ricetta(r).costo_food)} (${ricetta(r).n_ingredienti})` : 'ricetta'}
                        </button>
                      </td>
                    </tr>
                    {openKey === k && (
                      <tr className="bg-amber-50/60">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Receipt size={14} className="text-amber-600" />
                            <span className="text-sm font-semibold text-gray-700">Prezzi d'acquisto dalle fatture</span>
                            <div className="relative ml-2">
                              <Search size={13} className="absolute left-2 top-2 text-gray-400" />
                              <input value={suggQuery} onChange={e => setSuggQuery(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') caricaSugg(suggQuery) }}
                                className="border border-gray-200 rounded-lg pl-7 pr-2 py-1 text-sm w-56" />
                            </div>
                            <button onClick={() => caricaSugg(suggQuery)} className="text-xs border border-gray-200 rounded-lg px-2 py-1 hover:bg-white">Cerca</button>
                            <button onClick={() => setOpenKey(null)} className="ml-auto text-gray-400 hover:text-gray-600"><X size={16} /></button>
                          </div>
                          {suggLoading ? (
                            <div className="text-sm text-gray-400 flex items-center gap-2 py-2"><Loader size={14} className="animate-spin" /> Ricerca…</div>
                          ) : sugg.length === 0 ? (
                            <div className="text-sm text-gray-400 py-2">Nessuna riga fattura trovata. Affina la ricerca qui sopra.</div>
                          ) : (
                            <div className="space-y-1">
                              {sugg.map((s, i) => (
                                <div key={i} className="flex items-center gap-3 text-sm bg-white border border-gray-100 rounded-lg px-3 py-1.5">
                                  <span className="flex-1 text-gray-700">{s.descrizione}</span>
                                  <span className="text-gray-500 text-xs">{s.unita_misura || ''} · {s.fatture_count || 0} fatt. · {s.ultima_fattura || '—'}</span>
                                  <span className="text-gray-700 font-medium whitespace-nowrap">{eur(s.prezzo_medio)}<span className="text-gray-400 text-xs"> (min {eur(s.prezzo_min)})</span></span>
                                  <button onClick={() => applicaSugg(k, s.prezzo_medio)}
                                    className="bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-2 py-1 text-xs font-semibold whitespace-nowrap">Usa €{Number(s.prezzo_medio || 0).toFixed(2)}</button>
                                </div>
                              ))}
                              <p className="text-xs text-gray-400 pt-1">Suggerimento: se il prezzo è per confezione/cassa, dividi per i pezzi (es. ÷24) prima di salvare.</p>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="py-10 text-center text-gray-400">Nessun prodotto</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-xs text-gray-400 mt-3">
        Il costo viene salvato in <span className="font-mono">listino_prodotti</span> e usato per food cost %, margini e menu engineering. Le righe evidenziate in giallo non hanno ancora un food cost. La colonna <span className="font-medium">Ricetta</span> definisce il food cost dagli ingredienti (<span className="px-1 rounded bg-violet-100 text-violet-700 font-bold">def</span>); senza ricetta vale il costo indicativo.
      </p>

      {recipeProduct && (
        <RecipeCard
          prodotto={recipeProduct.nome}
          prezzoVendita={recipeProduct.prezzo}
          onClose={() => setRecipeProduct(null)}
          onSaved={async () => { try { setRicMap(await ricetteApi.sommario()) } catch { /* noop */ } }}
        />
      )}
    </div>
  )
}
