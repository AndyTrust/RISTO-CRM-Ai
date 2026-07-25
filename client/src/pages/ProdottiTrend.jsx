/**
 * ProdottiTrend — top/flop movers e variazioni prezzo dalla vista BI
 * `v_prodotti_trend_mensile` (per sede/mese/prodotto: quantita, ricavo,
 * prezzo_medio, quota_pct, var_pct vs mese precedente, prezzo_mese_prec).
 *
 * Con sede = "Tutte" le righe MA+PN vengono sommate per prodotto e le
 * variazioni RICALCOLATE sulle somme: le var_pct della vista sono per sede e
 * non si possono sommare.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { TrendingUp, TrendingDown, Tag, AlertTriangle, Euro, Info } from 'lucide-react'
import supabase from '../supabase'
import { fetchPaged } from '../api/paged'
import { fmtNum, fmtEur, fmtPct, useOrdinamento, IconaOrdine, BottoneCsv, NotaCopertura } from '../lib/tabella'

const SEDE_LABEL = { MA: 'Mameli (MA)', PN: 'Predda Niedda (PN)' }
const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6']
const MESI_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
const fmtMese = (m) => {
  const [y, mm] = String(m).slice(0, 7).split('-')
  return `${MESI_IT[Number(mm) - 1]} ${y}`
}
// Soglia anti-rumore: sotto questi pezzi/mese una variazione % non dice nulla.
const MIN_PEZZI = 10

function VarBadge({ v }) {
  if (v === null || v === undefined) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-semibold">NUOVO</span>
  const up = v > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}{fmtPct(v, { segno: true, decimali: 0 })}
    </span>
  )
}

export default function ProdottiTrend() {
  const [sede, setSede] = useState('')
  const [mese, setMese] = useState('')       // 'YYYY-MM-01'; '' = ultimo disponibile
  const [rows, setRows] = useState(null)      // null = non ancora caricato (≠ [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let annullato = false
    setLoading(true); setError(null)
    // Si scarica tutta la vista una volta (qualche migliaio di righe) e si
    // filtra in memoria: cambiare sede/mese è istantaneo.
    fetchPaged(() => supabase.from('v_prodotti_trend_mensile')
      .select('sede, mese, categoria, prodotto, quantita, ricavo, prezzo_medio, quota_pct, quantita_mese_prec, var_pct, prezzo_mese_prec'),
      ['mese', 'sede', 'prodotto'])
      .then(r => { if (!annullato) setRows(r) })
      .catch(e => { if (!annullato) { setError(e.message || String(e)); setRows([]) } })
      .finally(() => { if (!annullato) setLoading(false) })
    return () => { annullato = true }
  }, [])

  const mesi = useMemo(() => {
    if (!rows) return []
    return [...new Set(rows.map(r => String(r.mese).slice(0, 10)))].sort()
  }, [rows])
  const meseAttivo = mese || (mesi.length ? mesi[mesi.length - 1] : '')
  const idxMese = mesi.indexOf(meseAttivo)
  const mesePrec = idxMese > 0 ? mesi[idxMese - 1] : null

  // Aggregato per (mese, prodotto) sulla sede selezionata (o somma MA+PN)
  const perMeseProdotto = useMemo(() => {
    if (!rows) return {}
    const out = {}
    for (const r of rows) {
      if (sede && r.sede !== sede) continue
      const m = String(r.mese).slice(0, 10)
      const k = `${m}|${r.prodotto}`
      if (!out[k]) out[k] = { mese: m, prodotto: r.prodotto, categoria: r.categoria, quantita: 0, ricavo: 0 }
      out[k].quantita += Number(r.quantita) || 0
      out[k].ricavo += Number(r.ricavo) || 0
    }
    return out
  }, [rows, sede])

  const analisi = useMemo(() => {
    if (!meseAttivo) return null
    const cur = Object.values(perMeseProdotto).filter(p => p.mese === meseAttivo)
    if (!cur.length) return null
    const prevMap = {}
    if (mesePrec) {
      for (const p of Object.values(perMeseProdotto)) {
        if (p.mese === mesePrec) prevMap[p.prodotto] = p
      }
    }
    const totRicavo = cur.reduce((s, p) => s + p.ricavo, 0)
    const arr = cur.map(p => {
      const prev = prevMap[p.prodotto] || null
      const varQ = prev && prev.quantita > 0 ? (p.quantita - prev.quantita) / prev.quantita * 100 : null
      const prezzo = p.quantita > 0 ? p.ricavo / p.quantita : null
      const prezzoPrec = prev && prev.quantita > 0 ? prev.ricavo / prev.quantita : null
      const varPrezzo = prezzo != null && prezzoPrec != null && prezzoPrec > 0 ? (prezzo - prezzoPrec) / prezzoPrec * 100 : null
      return {
        ...p, prezzo, quota: totRicavo > 0 ? p.ricavo / totRicavo * 100 : null,
        qPrec: prev ? prev.quantita : null, varQ,
        deltaRicavo: prev ? p.ricavo - prev.ricavo : null,
        prezzoPrec, varPrezzo,
        rilevante: p.quantita >= MIN_PEZZI || (prev?.quantita ?? 0) >= MIN_PEZZI,
      }
    })
    // Cessati: venduti il mese scorso (≥ soglia), spariti questo mese
    const curSet = new Set(cur.map(p => p.prodotto))
    const cessati = Object.values(prevMap)
      .filter(p => !curSet.has(p.prodotto) && p.quantita >= MIN_PEZZI)
      .sort((a, b) => b.ricavo - a.ricavo)

    const conVar = arr.filter(p => p.varQ != null && p.rilevante)
    const top = [...conVar].sort((a, b) => b.varQ - a.varQ).slice(0, 10)
    const flop = [...conVar].sort((a, b) => a.varQ - b.varQ).slice(0, 10)
    const prezziCambiati = arr
      .filter(p => p.varPrezzo != null && Math.abs(p.varPrezzo) >= 3 && p.rilevante)
      .sort((a, b) => Math.abs(b.varPrezzo) - Math.abs(a.varPrezzo))
    const inCrescita = conVar.filter(p => p.varQ > 0).length
    const inCalo = conVar.filter(p => p.varQ < 0).length
    return { arr, top, flop, cessati, prezziCambiati, totRicavo, inCrescita, inCalo, nConfrontabili: conVar.length }
  }, [perMeseProdotto, meseAttivo, mesePrec])

  // Trend multi-mese dei top 5 prodotti per ricavo complessivo
  const trendTop5 = useMemo(() => {
    const tot = {}
    for (const p of Object.values(perMeseProdotto)) tot[p.prodotto] = (tot[p.prodotto] || 0) + p.ricavo
    const top5 = Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n)
    const data = mesi.map(m => {
      const row = { mese: fmtMese(m) }
      for (const n of top5) {
        const p = perMeseProdotto[`${m}|${n}`]
        row[n] = p ? Math.round(p.ricavo) : null   // null = non venduto, non 0
      }
      return row
    })
    return { top5, data }
  }, [perMeseProdotto, mesi])

  const ordTutti = useOrdinamento(analisi?.arr ?? [], 'ricavo', 'desc')
  const COLONNE = [
    { chiave: 'prodotto', etichetta: 'Prodotto' },
    { chiave: 'categoria', etichetta: 'Categoria' },
    { chiave: 'quantita', etichetta: 'Pezzi' },
    { chiave: 'qPrec', etichetta: 'Pezzi mese prec.' },
    { chiave: 'varQ', etichetta: 'Var. %', valore: r => r.varQ != null ? Math.round(r.varQ * 10) / 10 : '' },
    { chiave: 'ricavo', etichetta: 'Ricavo', valore: r => Math.round(r.ricavo * 100) / 100 },
    { chiave: 'quota', etichetta: 'Quota %', valore: r => r.quota != null ? Math.round(r.quota * 10) / 10 : '' },
    { chiave: 'prezzo', etichetta: 'Prezzo medio', valore: r => r.prezzo != null ? Math.round(r.prezzo * 100) / 100 : '' },
    { chiave: 'varPrezzo', etichetta: 'Var. prezzo %', valore: r => r.varPrezzo != null ? Math.round(r.varPrezzo * 10) / 10 : '' },
  ]

  if (error) return (
    <div className="p-6">
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm flex items-start gap-2">
        <AlertTriangle size={18} className="flex-shrink-0 mt-0.5"/><span>Errore nel caricamento di v_prodotti_trend_mensile: <strong>{error}</strong></span>
      </div>
    </div>
  )

  return (
    <div className="p-6 space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Mese analizzato</label>
          <select value={meseAttivo} onChange={e => setMese(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-300 outline-none">
            {mesi.map(m => <option key={m} value={m}>{fmtMese(m)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Sede</label>
          <select value={sede} onChange={e => setSede(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-300 outline-none">
            <option value="">Tutte le sedi</option>
            <option value="MA">Mameli (MA)</option>
            <option value="PN">Predda Niedda (PN)</option>
          </select>
        </div>
        {mesi.length > 0 && (
          <span className="text-xs text-gray-400 mb-2">
            Vista <code>v_prodotti_trend_mensile</code> · copertura {fmtMese(mesi[0])} → {fmtMese(mesi[mesi.length - 1])}
            {mesePrec ? <> · confronto vs <strong>{fmtMese(mesePrec)}</strong></> : ' · nessun mese precedente: variazioni non calcolabili'}
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-center text-gray-400 py-10 text-sm animate-pulse">Caricamento trend prodotti...</p>
      ) : !analisi ? (
        <div className="card"><div className="card-body text-center py-8"><p className="text-gray-500">Nessun dato prodotti per {meseAttivo ? fmtMese(meseAttivo) : 'il mese selezionato'}{sede ? ` · ${SEDE_LABEL[sede]}` : ''}.</p></div></div>
      ) : (<>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="kpi-card">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center"><Euro size={18}/></div>
            <p className="text-2xl font-bold mt-2">{fmtEur(analisi.totRicavo)}</p>
            <p className="text-xs text-gray-500">Ricavo prodotti · {fmtMese(meseAttivo)}</p>
          </div>
          <div className="kpi-card">
            <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center"><Tag size={18}/></div>
            <p className="text-2xl font-bold mt-2">{fmtNum(analisi.arr.length)}</p>
            <p className="text-xs text-gray-500">Prodotti venduti nel mese</p>
          </div>
          <div className="kpi-card">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><TrendingUp size={18}/></div>
            <p className="text-2xl font-bold mt-2 text-emerald-600">{mesePrec ? fmtNum(analisi.inCrescita) : '—'}</p>
            <p className="text-xs text-gray-500">In crescita vs mese prec. <span className="text-gray-400">(≥{MIN_PEZZI} pz)</span></p>
          </div>
          <div className="kpi-card">
            <div className="w-9 h-9 rounded-lg bg-red-50 text-red-500 flex items-center justify-center"><TrendingDown size={18}/></div>
            <p className="text-2xl font-bold mt-2 text-red-500">{mesePrec ? fmtNum(analisi.inCalo) : '—'}</p>
            <p className="text-xs text-gray-500">In calo vs mese prec. <span className="text-gray-400">(≥{MIN_PEZZI} pz)</span></p>
          </div>
        </div>

        {mesePrec && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[['top', '📈 Top movers — crescita quantità', analisi.top, 'emerald'],
              ['flop', '📉 Flop movers — calo quantità', analisi.flop, 'red']].map(([id, titolo, lista]) => (
              <div key={id} className="card">
                <div className="card-header"><h2 className="font-semibold text-sm">{titolo}</h2>
                  <p className="text-[11px] text-gray-400">vs {fmtMese(mesePrec)} · solo prodotti con ≥{MIN_PEZZI} pezzi (anti-rumore)</p></div>
                <div className="card-body overflow-x-auto">
                  {lista.length === 0 ? <p className="text-sm text-gray-400 py-3 text-center">Nessun prodotto confrontabile.</p> : (
                    <table className="w-full text-xs">
                      <thead className="border-b border-gray-200 text-gray-500"><tr>
                        <th className="text-left py-1.5 px-2">Prodotto</th>
                        <th className="text-right py-1.5 px-2">Pezzi</th>
                        <th className="text-right py-1.5 px-2">Prec.</th>
                        <th className="text-right py-1.5 px-2">Var.</th>
                        <th className="text-right py-1.5 px-2">Δ Ricavo</th>
                      </tr></thead>
                      <tbody>
                        {lista.map(p => (
                          <tr key={p.prodotto} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="py-1.5 px-2 font-medium">{p.prodotto}<span className="text-gray-400 ml-1">{p.categoria}</span></td>
                            <td className="text-right py-1.5 px-2">{fmtNum(p.quantita)}</td>
                            <td className="text-right py-1.5 px-2 text-gray-400">{fmtNum(p.qPrec)}</td>
                            <td className="text-right py-1.5 px-2"><VarBadge v={p.varQ}/></td>
                            <td className={`text-right py-1.5 px-2 font-semibold ${p.deltaRicavo > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmtEur(p.deltaRicavo, { decimali: 0 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {mesePrec && analisi.cessati.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
            <strong>Spariti dal venduto</strong> ({fmtMese(mesePrec)} ≥{MIN_PEZZI} pz, zero questo mese):{' '}
            {analisi.cessati.slice(0, 8).map(p => `${p.prodotto} (${fmtNum(p.quantita)} pz)`).join(' · ')}
            {analisi.cessati.length > 8 && ` · +${analisi.cessati.length - 8} altri`}
          </div>
        )}

        {mesePrec && (
          <div className="card">
            <div className="card-header"><h2 className="font-semibold text-sm">💶 Variazioni di prezzo rilevate (≥3%)</h2>
              <p className="text-[11px] text-gray-400">prezzo medio effettivo (ricavo ÷ pezzi) vs {fmtMese(mesePrec)} — include sconti e listino</p></div>
            <div className="card-body overflow-x-auto">
              {analisi.prezziCambiati.length === 0 ? <p className="text-sm text-gray-400 py-3 text-center">Nessuna variazione di prezzo rilevante nel mese.</p> : (
                <table className="w-full text-xs">
                  <thead className="border-b border-gray-200 text-gray-500"><tr>
                    <th className="text-left py-1.5 px-2">Prodotto</th>
                    <th className="text-right py-1.5 px-2">Prezzo prec.</th>
                    <th className="text-right py-1.5 px-2">Prezzo attuale</th>
                    <th className="text-right py-1.5 px-2">Var. prezzo</th>
                    <th className="text-right py-1.5 px-2">Var. quantità</th>
                  </tr></thead>
                  <tbody>
                    {analisi.prezziCambiati.slice(0, 20).map(p => (
                      <tr key={p.prodotto} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-1.5 px-2 font-medium">{p.prodotto}</td>
                        <td className="text-right py-1.5 px-2 text-gray-400">{fmtEur(p.prezzoPrec, { decimali: 2 })}</td>
                        <td className="text-right py-1.5 px-2 font-semibold">{fmtEur(p.prezzo, { decimali: 2 })}</td>
                        <td className="text-right py-1.5 px-2"><VarBadge v={p.varPrezzo}/></td>
                        <td className="text-right py-1.5 px-2"><VarBadge v={p.varQ}/></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {trendTop5.top5.length > 0 && (
          <div className="card">
            <div className="card-header"><h2 className="font-semibold text-sm">Trend mensile — top 5 prodotti per ricavo{sede ? ` (${SEDE_LABEL[sede]})` : ' (MA+PN)'}</h2>
              <p className="text-[11px] text-gray-400">buchi nella linea = mese senza vendite di quel prodotto (dato assente, non zero)</p></div>
            <div className="card-body">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trendTop5.data} margin={{ top: 15, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `€${(v / 1000).toFixed(1)}k`} />
                  <Tooltip formatter={v => fmtEur(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {trendTop5.top5.map((n, i) => (
                    <Line key={n} type="monotone" dataKey={n} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-header flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold text-sm">Tutti i prodotti — {fmtMese(meseAttivo)}{sede ? ` · ${SEDE_LABEL[sede]}` : ' · MA+PN'}</h2>
              <NotaCopertura righe={analisi.arr.length} fonte="v_prodotti_trend_mensile"
                extra={mesePrec ? `${analisi.nConfrontabili} confrontabili col mese precedente` : 'variazioni non disponibili (primo mese)'} />
            </div>
            <BottoneCsv righe={ordTutti.righeOrdinate} colonne={COLONNE} nomeFile={`prodotti_trend_${meseAttivo}_${sede || 'tutte'}`} />
          </div>
          <div className="card-body overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-gray-200 text-gray-500"><tr>
                {[['prodotto', 'Prodotto', 'left'], ['categoria', 'Categoria', 'left'], ['quantita', 'Pezzi', 'right'],
                  ['varQ', 'Var. pezzi', 'right'], ['ricavo', 'Ricavo', 'right'], ['quota', 'Quota', 'right'],
                  ['prezzo', 'Prezzo medio', 'right'], ['varPrezzo', 'Var. prezzo', 'right']].map(([col, lbl, al]) => (
                  <th key={col} {...ordTutti.propsTh(col)} className={`text-${al} py-2 px-2 font-semibold cursor-pointer select-none hover:text-indigo-600 whitespace-nowrap`}>
                    {lbl}<IconaOrdine colonna={col} colonnaAttiva={ordTutti.colonna} direzione={ordTutti.direzione}/>
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {ordTutti.righeOrdinate.map(p => (
                  <tr key={p.prodotto} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-1.5 px-2 font-medium">{p.prodotto}</td>
                    <td className="py-1.5 px-2 text-gray-400">{p.categoria || '—'}</td>
                    <td className="text-right py-1.5 px-2">{fmtNum(p.quantita)}</td>
                    <td className="text-right py-1.5 px-2">{mesePrec ? <VarBadge v={p.varQ}/> : '—'}</td>
                    <td className="text-right py-1.5 px-2 font-semibold">{fmtEur(p.ricavo)}</td>
                    <td className="text-right py-1.5 px-2">{fmtPct(p.quota)}</td>
                    <td className="text-right py-1.5 px-2">{fmtEur(p.prezzo, { decimali: 2 })}</td>
                    <td className="text-right py-1.5 px-2">{mesePrec && p.varPrezzo != null ? <VarBadge v={p.varPrezzo}/> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-[11px] text-gray-400 flex items-start gap-1.5">
          <Info size={13} className="mt-0.5 flex-shrink-0"/>
          <span>Le variazioni % sono calcolate sui pezzi venduti vs mese precedente; con sede "Tutte" vengono ricalcolate sulle somme MA+PN (le var_pct della vista sono per singola sede). Soglia anti-rumore: {MIN_PEZZI} pezzi.</span>
        </p>
      </>)}
    </div>
  )
}
