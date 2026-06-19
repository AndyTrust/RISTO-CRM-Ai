/**
 * AnalisiReparti.jsx — Marginalità per Reparto
 * Aggrega i costi del personale (da v_costo_personale_per_reparto, basata
 * su employees.reparto_split + sede_split_ma) con la quota imputabile dei
 * costi fissi e li confronta con il venduto della sede.
 *
 * Tutto modificabile direttamente: rotelle %, costi fissi inline.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import supabase from '../supabase'
import { repartiApi, costiFissiApi, chiusure as chiusureApi } from '../api/client'
import PageStatsWidget from '../components/PageStatsWidget'
import {
  Users, Building2, TrendingUp, AlertCircle, RefreshCw,
  ChevronRight, Calendar, MapPin, Coins, Activity,
  PieChart as PieIcon, ArrowUpRight, ArrowDownRight, Edit3, Save, X,
} from 'lucide-react'
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

const EUR = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const EUR2 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const PCT = (n) => `${(n * 100).toFixed(1)}%`
const fmtE  = (v) => Number.isFinite(+v) ? EUR.format(+v) : '—'
const fmtE2 = (v) => Number.isFinite(+v) ? EUR2.format(+v) : '—'

const MESI = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const COLORS = { Sala: '#3b82f6', Cucina: '#ef4444', Amministrazione: '#a855f7', Marketing: '#10b981', '_default': '#9ca3af' }

export default function AnalisiReparti() {
  const today = new Date()
  const [anno, setAnno] = useState(today.getFullYear())
  const [mese, setMese] = useState(today.getMonth() + 1)
  const [sede, setSede] = useState('Tutte')
  const [reparti, setReparti] = useState([])
  const [costiAlloc, setCostiAlloc] = useState([])
  const [costiFissi, setCostiFissi] = useState([])
  const [chiusureMese, setChiusureMese] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  // ── Quote ripartizione costi fissi per reparto (modificabili in UI) ──
  // Default ragionevoli: la maggior parte dei costi fissi va su Sala+Cucina
  const [quoteFissi, setQuoteFissi] = useState(() => {
    try {
      const saved = localStorage.getItem('analisi_reparti_quote_fissi_v1')
      if (saved) return JSON.parse(saved)
    } catch {}
    return { Sala: 45, Cucina: 40, Amministrazione: 10, Marketing: 5 }
  })

  useEffect(() => {
    try { localStorage.setItem('analisi_reparti_quote_fissi_v1', JSON.stringify(quoteFissi)) } catch {}
  }, [quoteFissi])

  const loadData = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const [rep, alloc, fissi] = await Promise.all([
        repartiApi.getAll(),
        supabase.from('v_costo_personale_per_reparto')
          .select('*')
          .eq('anno', anno).eq('mese', mese)
          .then(({ data, error }) => { if (error) throw error; return data || [] }),
        costiFissiApi.getMese?.({ anno, mese }) ??
          supabase.from('v_costi_fissi_mensile')
            .select('*')
            .eq('anno', anno).eq('mese', mese)
            .then(({ data, error }) => { if (error) throw error; return data || [] }),
      ])
      const from = `${anno}-${String(mese).padStart(2,'0')}-01`
      const last = new Date(anno, mese, 0).getDate()
      const to   = `${anno}-${String(mese).padStart(2,'0')}-${String(last).padStart(2,'0')}`
      const chius = await chiusureApi.getAll({ from, to, limit: 200 }).catch(() => [])

      setReparti(rep || [])
      setCostiAlloc(alloc || [])
      setCostiFissi(Array.isArray(fissi) ? fissi : [])
      setChiusureMese(chius || [])
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [anno, mese])

  useEffect(() => { loadData() }, [loadData])

  // ── Aggregati ──────────────────────────────────────────────────────────
  const allocFilt = useMemo(() => sede === 'Tutte' ? costiAlloc : costiAlloc.filter(r => r.sede === sede), [costiAlloc, sede])

  const costoFissoSede = useMemo(() => {
    const totBySede = { MA: 0, PN: 0 }
    for (const r of costiFissi) {
      const importo = parseFloat(r.importo) || 0
      if (totBySede[r.sede] != null) totBySede[r.sede] += importo
    }
    return totBySede
  }, [costiFissi])

  const venduto = useMemo(() => {
    const totBySede = { MA: 0, PN: 0 }
    let totCoperti = { MA: 0, PN: 0 }
    for (const r of chiusureMese) {
      const importo = parseFloat(r.totale_venduto_ipratico ?? r.totale ?? 0) || 0
      const cop = parseInt(r.coperti) || 0
      if (totBySede[r.sede] != null) {
        totBySede[r.sede] += importo
        totCoperti[r.sede] += cop
      }
    }
    return { totBySede, totCoperti }
  }, [chiusureMese])

  // ── Tabella per reparto: somma personale + quota costi fissi ───────────
  const perReparto = useMemo(() => {
    const byRep = {}
    for (const r of allocFilt) {
      const k = r.reparto_id || 'unassigned'
      if (!byRep[k]) byRep[k] = {
        reparto_id: r.reparto_id, nome: r.reparto_nome || 'Non assegnato',
        icona: r.reparto_icona || '❓',
        n_dipendenti: 0, costo_personale: 0,
      }
      byRep[k].costo_personale += parseFloat(r.costo_totale) || 0
      byRep[k].n_dipendenti += parseInt(r.n_dipendenti) || 0
    }
    // Aggiungi reparti senza personale per mostrare la quota fissi
    for (const r of reparti) {
      if (!byRep[r.id]) byRep[r.id] = {
        reparto_id: r.id, nome: r.nome, icona: r.icona || '',
        n_dipendenti: 0, costo_personale: 0,
      }
    }
    // Aggiungi quota costi fissi per reparto
    const totFissi = (sede === 'Tutte')
      ? (costoFissoSede.MA + costoFissoSede.PN)
      : (costoFissoSede[sede] || 0)
    return Object.values(byRep).map(row => {
      const quotaPct = (quoteFissi[row.nome] ?? 0) / 100
      const costoFissoQuota = totFissi * quotaPct
      const costoTotale = row.costo_personale + costoFissoQuota
      return { ...row, costo_fissi: costoFissoQuota, costo_totale: costoTotale, quota_pct: quoteFissi[row.nome] ?? 0 }
    }).sort((a, b) => b.costo_totale - a.costo_totale)
  }, [allocFilt, reparti, quoteFissi, costoFissoSede, sede])

  const totVenduto = sede === 'Tutte'
    ? (venduto.totBySede.MA + venduto.totBySede.PN)
    : (venduto.totBySede[sede] || 0)
  const totCosti = perReparto.reduce((s, r) => s + r.costo_totale, 0)
  const margine = totVenduto - totCosti
  const marginePct = totVenduto > 0 ? margine / totVenduto : 0

  const quoteSum = Object.values(quoteFissi).reduce((s, v) => s + (+v || 0), 0)

  return (
    <>
      <PageStatsWidget />
      <div className="min-h-screen bg-gray-50 p-4 md:p-6">
        <div className="max-w-7xl mx-auto">

          {/* Header */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Building2 className="text-violet-600" size={26} />
            <h1 className="text-2xl font-bold text-gray-900">Analisi Costi per Reparto</h1>
            <span className="text-xs text-gray-500">Personale + costi fissi + margine, con drill-down</span>
            <div className="flex-1" />
            <Link to="/buste-paga?tab=dipendenti" className="text-xs text-violet-700 hover:text-violet-900 flex items-center gap-1">
              Modifica split dipendenti <ChevronRight size={12} />
            </Link>
            <Link to="/costi-fissi" className="text-xs text-violet-700 hover:text-violet-900 flex items-center gap-1">
              Modifica costi fissi <ChevronRight size={12} />
            </Link>
            <button onClick={loadData} disabled={loading}
              className="ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-sm hover:bg-gray-50">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Ricarica
            </button>
          </div>

          {/* Filtri */}
          <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-[11px] text-gray-500 block mb-0.5">Anno</label>
              <select value={anno} onChange={e => setAnno(parseInt(e.target.value))}
                className="px-2 py-1 border border-gray-200 rounded text-sm">
                {Array.from({length: 5}, (_, i) => today.getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-0.5">Mese</label>
              <select value={mese} onChange={e => setMese(parseInt(e.target.value))}
                className="px-2 py-1 border border-gray-200 rounded text-sm">
                {MESI.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-0.5">Sede</label>
              <select value={sede} onChange={e => setSede(e.target.value)}
                className="px-2 py-1 border border-gray-200 rounded text-sm">
                <option value="Tutte">Tutte</option>
                <option value="MA">Mameli</option>
                <option value="PN">Predda Niedda</option>
              </select>
            </div>
          </div>

          {err && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-700 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5" /> {err}
            </div>
          )}

          {/* KPI top row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <KPI label="Venduto sede" value={fmtE(totVenduto)} icon={TrendingUp} color="emerald" />
            <KPI label="Costo Personale" value={fmtE(perReparto.reduce((s,r) => s + r.costo_personale, 0))} icon={Users} color="blue" />
            <KPI label="Costi Fissi" value={fmtE((sede === 'Tutte' ? costoFissoSede.MA + costoFissoSede.PN : costoFissoSede[sede] || 0))} icon={Coins} color="amber" />
            <KPI label="Margine" value={fmtE(margine)} sub={`${PCT(marginePct)} su venduto`}
              icon={margine >= 0 ? ArrowUpRight : ArrowDownRight}
              color={margine >= 0 ? 'green' : 'red'} />
          </div>

          {/* Quote di ripartizione (interattive) */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <PieIcon size={16} className="text-violet-600" />
                <h3 className="font-semibold text-sm text-gray-800">Ripartizione Costi Fissi tra Reparti</h3>
              </div>
              <div className={`text-xs font-bold ${quoteSum === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
                Totale: {quoteSum}% {quoteSum !== 100 && '⚠️'}
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Modifica le % per spalmare i costi fissi (affitti, consulenze) sui reparti. Salvataggio automatico in locale.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {['Sala','Cucina','Amministrazione','Marketing'].map(r => (
                <div key={r} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 border border-gray-200">
                  <span className="text-base">{r === 'Sala' ? '🍽️' : r === 'Cucina' ? '👨‍🍳' : r === 'Amministrazione' ? '⭐' : '🎯'}</span>
                  <span className="text-xs font-medium flex-1">{r}</span>
                  <input type="number" min="0" max="100" step="5"
                    className="w-14 text-center text-sm font-bold border border-gray-300 rounded px-1 py-0.5"
                    value={quoteFissi[r] ?? 0}
                    onChange={e => setQuoteFissi(q => ({ ...q, [r]: parseInt(e.target.value) || 0 }))} />
                  <span className="text-xs text-gray-400">%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tabella per reparto + grafici */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="font-semibold text-sm text-gray-800 mb-3 flex items-center gap-2">
                <Activity size={15} className="text-violet-600" /> Costi per Reparto
              </h3>
              {loading ? (
                <div className="h-32 flex items-center justify-center text-gray-400">Caricamento...</div>
              ) : perReparto.length === 0 ? (
                <div className="h-32 flex items-center justify-center text-gray-400 text-sm">
                  Nessun dato per {MESI[mese-1]} {anno}.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500 uppercase border-b border-gray-200">
                      <tr>
                        <th className="text-left py-2 px-2">Reparto</th>
                        <th className="text-right py-2 px-2">Dip.</th>
                        <th className="text-right py-2 px-2">Personale</th>
                        <th className="text-right py-2 px-2">Quota Fissi</th>
                        <th className="text-right py-2 px-2">Totale</th>
                        <th className="text-right py-2 px-2">% venduto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perReparto.map(r => (
                        <tr key={r.reparto_id || r.nome} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-2">
                            <span className="font-medium text-gray-800">{r.icona} {r.nome}</span>
                          </td>
                          <td className="py-2 px-2 text-right text-gray-600">{r.n_dipendenti}</td>
                          <td className="py-2 px-2 text-right text-blue-600 font-medium">{fmtE(r.costo_personale)}</td>
                          <td className="py-2 px-2 text-right text-amber-600">{fmtE(r.costo_fissi)}</td>
                          <td className="py-2 px-2 text-right text-violet-700 font-bold">{fmtE(r.costo_totale)}</td>
                          <td className="py-2 px-2 text-right text-gray-500">
                            {totVenduto > 0 ? PCT(r.costo_totale / totVenduto) : '—'}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-violet-50 font-bold">
                        <td className="py-2 px-2 text-violet-900">TOTALE</td>
                        <td className="py-2 px-2 text-right text-violet-900">
                          {perReparto.reduce((s, r) => s + r.n_dipendenti, 0)}
                        </td>
                        <td className="py-2 px-2 text-right text-violet-900">
                          {fmtE(perReparto.reduce((s, r) => s + r.costo_personale, 0))}
                        </td>
                        <td className="py-2 px-2 text-right text-violet-900">
                          {fmtE(perReparto.reduce((s, r) => s + r.costo_fissi, 0))}
                        </td>
                        <td className="py-2 px-2 text-right text-violet-900">{fmtE(totCosti)}</td>
                        <td className="py-2 px-2 text-right text-violet-900">
                          {totVenduto > 0 ? PCT(totCosti / totVenduto) : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="font-semibold text-sm text-gray-800 mb-3 flex items-center gap-2">
                <PieIcon size={15} className="text-violet-600" /> Distribuzione
              </h3>
              {perReparto.length > 0 && (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={perReparto} dataKey="costo_totale" nameKey="nome" outerRadius={80} label={(e) => `${e.nome.substring(0,4)}`}>
                      {perReparto.map((e, i) => (
                        <Cell key={i} fill={COLORS[e.nome] || COLORS._default} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => fmtE(v)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Barre per sede */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="font-semibold text-sm text-gray-800 mb-3 flex items-center gap-2">
              <MapPin size={15} className="text-violet-600" /> Confronto Sedi
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={[
                { sede: 'Mameli', venduto: venduto.totBySede.MA, costoPersonale: costiAlloc.filter(r => r.sede === 'MA').reduce((s, r) => s + (+r.costo_totale || 0), 0), costoFissi: costoFissoSede.MA },
                { sede: 'Predda Niedda', venduto: venduto.totBySede.PN, costoPersonale: costiAlloc.filter(r => r.sede === 'PN').reduce((s, r) => s + (+r.costo_totale || 0), 0), costoFissi: costoFissoSede.PN },
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="sede" />
                <YAxis tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => fmtE(v)} />
                <Legend />
                <Bar dataKey="venduto" fill="#10b981" name="Venduto" />
                <Bar dataKey="costoPersonale" fill="#3b82f6" name="Costo Personale" />
                <Bar dataKey="costoFissi" fill="#f59e0b" name="Costi Fissi" />
              </BarChart>
            </ResponsiveContainer>
          </div>

        </div>
      </div>
    </>
  )
}

function KPI({ label, value, sub, icon: Icon, color = 'blue' }) {
  const g = {
    blue: 'from-blue-500 to-blue-600',
    emerald: 'from-emerald-500 to-emerald-600',
    green: 'from-emerald-500 to-emerald-600',
    amber: 'from-amber-500 to-amber-600',
    red: 'from-red-500 to-red-600',
    purple: 'from-violet-500 to-violet-600',
  }
  return (
    <div className={`bg-gradient-to-br ${g[color] || g.blue} text-white rounded-xl p-4 shadow`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs opacity-80 font-medium">{label}</p>
          <p className="text-xl font-bold mt-1">{value}</p>
          {sub && <p className="text-xs opacity-70 mt-1">{sub}</p>}
        </div>
        {Icon && <Icon size={20} className="opacity-60" />}
      </div>
    </div>
  )
}
