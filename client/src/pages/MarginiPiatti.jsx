/**
 * MarginiPiatti — margine e food cost per piatto dalla vista BI
 * `v_margine_piatti` (per sede/piatto: quantita, ricavo, prezzo_medio,
 * costo_unitario, costo_noto, margine, food_cost_pct, dal/al).
 *
 * Regola della pagina: i piatti SENZA costo a listino non si nascondono mai.
 * Si mostrano con "—" e un contatore che invita a completare il listino
 * (tab Food Cost): nasconderli farebbe sembrare il margine complessivo
 * migliore di quanto sia misurabile.
 *
 * NOTA periodo: la vista aggrega TUTTO il venduto disponibile (colonne dal/al
 * per riga); non segue il filtro periodo delle altre pagine e lo dichiara.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'
import { AlertTriangle, Coins, PieChart, Search, UtensilsCrossed, ListX } from 'lucide-react'
import { Link } from 'react-router-dom'
import supabase from '../supabase'
import { fetchPaged } from '../api/paged'
import { fmtNum, fmtEur, fmtPct, useOrdinamento, IconaOrdine, BottoneCsv, NotaCopertura } from '../lib/tabella'

const SEDE_LABEL = { MA: 'Mameli (MA)', PN: 'Predda Niedda (PN)' }
const fmtData = s => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—')
// Sopra questa soglia il food cost di un piatto è considerato critico
const SOGLIA_FC = 35
const MIN_PEZZI_GRAFICI = 20

export default function MarginiPiatti() {
  const [sede, setSede] = useState('')
  const [categoria, setCategoria] = useState('')
  const [cerca, setCerca] = useState('')
  const [soloSenzaCosto, setSoloSenzaCosto] = useState(false)
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let annullato = false
    setLoading(true); setError(null)
    // ~1.000 righe: si scarica tutto e si filtra in memoria.
    // La vista non ha colonna univoca: la coppia (sede, prodotto) sì.
    fetchPaged(() => supabase.from('v_margine_piatti')
      .select('sede, prodotto, categoria, quantita, ricavo, prezzo_medio, costo_unitario, costo_noto, costo_totale, margine, food_cost_pct, dal, al'),
      ['sede', 'prodotto'])
      .then(r => { if (!annullato) setRows(r) })
      .catch(e => { if (!annullato) { setError(e.message || String(e)); setRows([]) } })
      .finally(() => { if (!annullato) setLoading(false) })
    return () => { annullato = true }
  }, [])

  const categorie = useMemo(() => {
    if (!rows) return []
    return [...new Set(rows.map(r => r.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'))
  }, [rows])

  const periodo = useMemo(() => {
    if (!rows?.length) return null
    let dal = null, al = null
    for (const r of rows) {
      if (r.dal && (!dal || r.dal < dal)) dal = r.dal
      if (r.al && (!al || r.al > al)) al = r.al
    }
    return { dal, al }
  }, [rows])

  const filtrate = useMemo(() => {
    if (!rows) return []
    const q = cerca.trim().toLowerCase()
    return rows.filter(r =>
      (!sede || r.sede === sede) &&
      (!categoria || r.categoria === categoria) &&
      (!soloSenzaCosto || !r.costo_noto) &&
      (!q || String(r.prodotto).toLowerCase().includes(q))
    ).map(r => ({
      ...r,
      quantita: Number(r.quantita) || 0,
      ricavo: Number(r.ricavo) || 0,
      // I numeri dei piatti senza costo restano null: mai finti zeri.
      costo_unitario: r.costo_noto ? Number(r.costo_unitario) : null,
      margine: r.costo_noto ? Number(r.margine) : null,
      food_cost_pct: r.costo_noto ? Number(r.food_cost_pct) : null,
      prezzo_medio: r.prezzo_medio != null ? Number(r.prezzo_medio) : null,
      key: `${r.sede}|${r.prodotto}`,
    }))
  }, [rows, sede, categoria, cerca, soloSenzaCosto])

  const kpi = useMemo(() => {
    if (!filtrate.length) return null
    const conCosto = filtrate.filter(r => r.costo_noto)
    const senzaCosto = filtrate.length - conCosto.length
    const ricavoTot = filtrate.reduce((s, r) => s + r.ricavo, 0)
    const ricavoConCosto = conCosto.reduce((s, r) => s + r.ricavo, 0)
    const margineTot = conCosto.reduce((s, r) => s + (r.margine || 0), 0)
    const costoTot = conCosto.reduce((s, r) => s + (Number(r.costo_totale) || 0), 0)
    return {
      n: filtrate.length, conCosto: conCosto.length, senzaCosto,
      ricavoTot, ricavoConCosto, margineTot,
      fcMedio: ricavoConCosto > 0 ? costoTot / ricavoConCosto * 100 : null,
      coperturaRicavo: ricavoTot > 0 ? ricavoConCosto / ricavoTot * 100 : null,
      critici: conCosto.filter(r => r.food_cost_pct >= SOGLIA_FC && r.quantita >= MIN_PEZZI_GRAFICI).length,
    }
  }, [filtrate])

  const topMargine = useMemo(() =>
    filtrate.filter(r => r.costo_noto && r.margine != null)
      .sort((a, b) => b.margine - a.margine).slice(0, 15)
  , [filtrate])

  const peggioriFc = useMemo(() =>
    filtrate.filter(r => r.costo_noto && r.food_cost_pct != null && r.quantita >= MIN_PEZZI_GRAFICI)
      .sort((a, b) => b.food_cost_pct - a.food_cost_pct).slice(0, 15)
  , [filtrate])

  const ord = useOrdinamento(filtrate, 'ricavo', 'desc')
  const COLONNE = [
    { chiave: 'prodotto', etichetta: 'Piatto' },
    { chiave: 'sede', etichetta: 'Sede' },
    { chiave: 'categoria', etichetta: 'Categoria' },
    { chiave: 'quantita', etichetta: 'Pezzi' },
    { chiave: 'prezzo_medio', etichetta: 'Prezzo medio', valore: r => r.prezzo_medio != null ? Math.round(r.prezzo_medio * 100) / 100 : '' },
    { chiave: 'costo_unitario', etichetta: 'Costo unitario', valore: r => r.costo_unitario != null ? Math.round(r.costo_unitario * 100) / 100 : '' },
    { chiave: 'ricavo', etichetta: 'Ricavo', valore: r => Math.round(r.ricavo * 100) / 100 },
    { chiave: 'margine', etichetta: 'Margine', valore: r => r.margine != null ? Math.round(r.margine * 100) / 100 : '' },
    { chiave: 'food_cost_pct', etichetta: 'Food cost %', valore: r => r.food_cost_pct != null ? Math.round(r.food_cost_pct * 10) / 10 : '' },
    { chiave: 'costo_noto', etichetta: 'Costo a listino', valore: r => r.costo_noto ? 'sì' : 'NO' },
  ]

  if (error) return (
    <div className="p-6">
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm flex items-start gap-2">
        <AlertTriangle size={18} className="flex-shrink-0 mt-0.5"/><span>Errore nel caricamento di v_margine_piatti: <strong>{error}</strong></span>
      </div>
    </div>
  )

  return (
    <div className="p-6 space-y-5">
      {periodo && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700">
          Analisi margini sull'<strong>intero venduto disponibile</strong>: {fmtData(periodo.dal)} → {fmtData(periodo.al)} (vista <code>v_margine_piatti</code>).
          Questa scheda <strong>non segue il filtro periodo</strong> delle altre pagine: il costo a listino è unico, non storicizzato per mese.
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Sede</label>
          <select value={sede} onChange={e => setSede(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-300 outline-none">
            <option value="">Tutte le sedi</option>
            <option value="MA">Mameli (MA)</option>
            <option value="PN">Predda Niedda (PN)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Categoria</label>
          <select value={categoria} onChange={e => setCategoria(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-300 outline-none">
            <option value="">Tutte</option>
            {categorie.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Cerca piatto</label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input value={cerca} onChange={e => setCerca(e.target.value)} placeholder="es. carbonara"
              className="border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300 outline-none"/>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 mb-2 cursor-pointer">
          <input type="checkbox" checked={soloSenzaCosto} onChange={e => setSoloSenzaCosto(e.target.checked)}
            className="rounded accent-amber-500"/>
          Solo piatti <strong>senza costo</strong>
        </label>
      </div>

      {loading ? (
        <p className="text-center text-gray-400 py-10 text-sm animate-pulse">Caricamento margini piatti...</p>
      ) : !kpi ? (
        <div className="card"><div className="card-body text-center py-8"><p className="text-gray-500">Nessun piatto corrisponde ai filtri.</p></div></div>
      ) : (<>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="kpi-card">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><Coins size={18}/></div>
            <p className="text-2xl font-bold mt-2 text-emerald-600">{fmtEur(kpi.margineTot)}</p>
            <p className="text-xs text-gray-500">Margine lordo misurabile</p>
            <p className="text-[11px] text-gray-400">su {fmtEur(kpi.ricavoConCosto)} di ricavo con costo noto</p>
          </div>
          <div className="kpi-card">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center"><PieChart size={18}/></div>
            <p className="text-2xl font-bold mt-2">{fmtPct(kpi.fcMedio)}</p>
            <p className="text-xs text-gray-500">Food cost medio ponderato</p>
            <p className="text-[11px] text-gray-400">costo ÷ ricavo dei piatti con costo noto</p>
          </div>
          <div className="kpi-card">
            <div className="w-9 h-9 rounded-lg bg-red-50 text-red-500 flex items-center justify-center"><UtensilsCrossed size={18}/></div>
            <p className="text-2xl font-bold mt-2 text-red-500">{fmtNum(kpi.critici)}</p>
            <p className="text-xs text-gray-500">Piatti con food cost ≥ {SOGLIA_FC}%</p>
            <p className="text-[11px] text-gray-400">tra quelli con ≥{MIN_PEZZI_GRAFICI} pezzi venduti</p>
          </div>
          <div className="kpi-card border-amber-200 bg-amber-50/40">
            <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center"><ListX size={18}/></div>
            <p className="text-2xl font-bold mt-2 text-amber-600">{fmtNum(kpi.senzaCosto)}</p>
            <p className="text-xs text-gray-600 font-medium">piatti senza costo a listino</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              il {fmtPct(kpi.coperturaRicavo != null ? 100 - kpi.coperturaRicavo : null, { decimali: 0 })} del ricavo non è misurabile —{' '}
              <Link to="/prodotti?tab=foodcost" className="text-amber-700 underline font-semibold">completa il listino →</Link>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <div className="card-header"><h2 className="font-semibold text-sm">🏆 Top 15 — margine lordo generato</h2>
              <p className="text-[11px] text-gray-400">margine = ricavo − (costo unitario × pezzi), solo costi noti</p></div>
            <div className="card-body">
              {topMargine.length === 0 ? <p className="text-sm text-gray-400 py-3 text-center">Nessun piatto con costo noto nei filtri.</p> : (
                <ResponsiveContainer width="100%" height={Math.max(220, topMargine.length * 26)}>
                  <BarChart data={topMargine} layout="vertical" margin={{ top: 5, right: 40, left: 140, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={v => `€${(v / 1000).toFixed(1)}k`} />
                    <YAxis dataKey="prodotto" type="category" width={135} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v, n) => n === 'Margine' ? [fmtEur(v), n] : [v, n]}
                      labelFormatter={(l, p) => `${l}${p?.[0]?.payload && !sede ? ' · ' + p[0].payload.sede : ''}`} />
                    <Bar dataKey="margine" name="Margine" fill="#10b981" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h2 className="font-semibold text-sm">🚨 Food cost più alto (≥{MIN_PEZZI_GRAFICI} pezzi)</h2>
              <p className="text-[11px] text-gray-400">linea rossa = soglia {SOGLIA_FC}% — sopra, il piatto erode il margine</p></div>
            <div className="card-body">
              {peggioriFc.length === 0 ? <p className="text-sm text-gray-400 py-3 text-center">Nessun piatto con costo noto e volumi sufficienti.</p> : (
                <ResponsiveContainer width="100%" height={Math.max(220, peggioriFc.length * 26)}>
                  <BarChart data={peggioriFc} layout="vertical" margin={{ top: 5, right: 40, left: 140, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 'auto']} tickFormatter={v => `${v}%`} />
                    <YAxis dataKey="prodotto" type="category" width={135} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v, n) => n === 'Food cost' ? [fmtPct(v), n] : [v, n]}
                      labelFormatter={(l, p) => `${l}${p?.[0]?.payload && !sede ? ' · ' + p[0].payload.sede : ''}`} />
                    <ReferenceLine x={SOGLIA_FC} stroke="#ef4444" strokeDasharray="4 4" />
                    <Bar dataKey="food_cost_pct" name="Food cost" radius={[0, 4, 4, 0]}>
                      {peggioriFc.map(r => <Cell key={r.key} fill={r.food_cost_pct >= SOGLIA_FC ? '#ef4444' : '#f59e0b'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold text-sm">Tutti i piatti — margine e food cost</h2>
              <NotaCopertura righe={filtrate.length} da={fmtData(periodo?.dal)} a={fmtData(periodo?.al)} fonte="v_margine_piatti"
                extra={`${kpi.conCosto} con costo noto · ${kpi.senzaCosto} senza (mostrati comunque)`} />
            </div>
            <BottoneCsv righe={ord.righeOrdinate} colonne={COLONNE} nomeFile={`margini_piatti_${sede || 'tutte'}`} />
          </div>
          <div className="card-body overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-gray-200 text-gray-500"><tr>
                {[['prodotto', 'Piatto', 'left'], ...(!sede ? [['sede', 'Sede', 'left']] : []), ['categoria', 'Categoria', 'left'],
                  ['quantita', 'Pezzi', 'right'], ['prezzo_medio', 'Prezzo', 'right'], ['costo_unitario', 'Costo', 'right'],
                  ['ricavo', 'Ricavo', 'right'], ['margine', 'Margine', 'right'], ['food_cost_pct', 'FC %', 'right']].map(([col, lbl, al]) => (
                  <th key={col} {...ord.propsTh(col)} className={`text-${al} py-2 px-2 font-semibold cursor-pointer select-none hover:text-indigo-600 whitespace-nowrap`}>
                    {lbl}<IconaOrdine colonna={col} colonnaAttiva={ord.colonna} direzione={ord.direzione}/>
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {ord.righeOrdinate.map(r => (
                  <tr key={r.key} className={`border-b border-gray-100 hover:bg-gray-50 ${!r.costo_noto ? 'bg-amber-50/40' : ''}`}>
                    <td className="py-1.5 px-2 font-medium">
                      {r.prodotto}
                      {!r.costo_noto && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold align-middle">SENZA COSTO</span>}
                    </td>
                    {!sede && <td className="py-1.5 px-2 text-gray-400">{r.sede}</td>}
                    <td className="py-1.5 px-2 text-gray-400">{r.categoria || '—'}</td>
                    <td className="text-right py-1.5 px-2">{fmtNum(r.quantita)}</td>
                    <td className="text-right py-1.5 px-2">{fmtEur(r.prezzo_medio, { decimali: 2 })}</td>
                    <td className="text-right py-1.5 px-2">{fmtEur(r.costo_unitario, { decimali: 2 })}</td>
                    <td className="text-right py-1.5 px-2 font-semibold">{fmtEur(r.ricavo)}</td>
                    <td className={`text-right py-1.5 px-2 font-semibold ${r.margine == null ? '' : r.margine >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmtEur(r.margine)}</td>
                    <td className={`text-right py-1.5 px-2 ${r.food_cost_pct != null && r.food_cost_pct >= SOGLIA_FC ? 'text-red-500 font-semibold' : ''}`}>{fmtPct(r.food_cost_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>)}
    </div>
  )
}
