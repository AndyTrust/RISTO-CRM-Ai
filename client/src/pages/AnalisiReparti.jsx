/**
 * AnalisiReparti.jsx — Marginalità per Reparto
 * Aggrega i costi del personale (da v_costo_personale_per_reparto, basata
 * su employees.reparto_split + sede_split_ma) con la quota imputabile dei
 * costi fissi e li confronta con il venduto della sede.
 *
 * Tutto modificabile direttamente: rotelle %, costi fissi inline.
 */
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import supabase from '../supabase'
import { repartiApi, costiFissiApi, chiusure as chiusureApi } from '../api/client'
import { fetchPaged } from '../api/paged'
import { BottoneCsv, NotaCopertura } from '../lib/tabella'
import useAnniDisponibili from '../hooks/useAnniDisponibili'
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

  // Fix: v_costo_personale_per_reparto arriva con ~2 mesi di ritardo, quindi il default
  // sul mese corrente apriva sempre la pagina vuota. All'avvio si legge l'ultimo periodo
  // realmente disponibile e si usa quello (fallback: mese corrente).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('v_costo_personale_per_reparto')
        .select('anno, mese')
        .order('anno', { ascending: false })
        .order('mese', { ascending: false })
        .limit(1)
      if (cancelled || error || !data?.[0]) return
      setAnno(data[0].anno)
      setMese(data[0].mese)
    })()
    return () => { cancelled = true }
  }, [])

  // ── Quote ripartizione costi fissi per reparto (persistite su Supabase) ──
  const QUOTE_DEFAULT = { Sala: 45, Cucina: 40, Amministrazione: 10, Marketing: 5 }
  const [quoteFissi, setQuoteFissi] = useState(QUOTE_DEFAULT)
  const [quoteCaricate, setQuoteCaricate] = useState(false)   // false ⇒ a schermo ci sono i default
  const [savingQuote, setSavingQuote] = useState(false)
  const [quoteErr, setQuoteErr] = useState(null)

  // Carica quote da Supabase all'avvio
  useEffect(() => {
    let annullato = false
    ;(async () => {
      // `.then(({ data }) => ...)` senza `error`: con RLS che blocca la tabella
      // restavano i default 45/40/10/5 e la pagina li mostrava come se fossero
      // le quote salvate. Ora l'errore viene dichiarato in pagina.
      const { data, error } = await supabase.from('costi_fissi_quote_reparto')
        .select('reparto_nome, quota_pct')
        .eq('sede', 'ALL')
      if (annullato) return
      if (error) { setQuoteErr(`Quote non caricate: ${error.message} — a schermo ci sono i valori di default`); return }
      if (data && data.length > 0) {
        const next = {}
        for (const r of data) next[r.reparto_nome] = Number(r.quota_pct)
        setQuoteFissi(q => ({ ...q, ...next }))
      }
      setQuoteCaricate(true)
    })()
    return () => { annullato = true }
  }, [])

  // Salva quote su Supabase quando cambiano (debounced 800ms)
  useEffect(() => {
    // Finché la lettura iniziale non è andata a buon fine, i valori a schermo
    // sono i default: salvarli sovrascriverebbe le quote vere a DB.
    if (!quoteCaricate) return
    let annullato = false
    const t = setTimeout(async () => {
      setSavingQuote(true)
      const rows = Object.entries(quoteFissi).map(([nome, pct]) => ({
        sede: 'ALL', reparto_nome: nome, quota_pct: Number(pct) || 0,
        updated_at: new Date().toISOString(),
      }))
      // supabase-js NON rigetta mai: senza leggere `error` il catch non scatta
      // e un salvataggio fallito veniva mostrato come riuscito.
      const { error } = await supabase.from('costi_fissi_quote_reparto')
        .upsert(rows, { onConflict: 'sede,reparto_nome' })
      if (annullato) return
      setSavingQuote(false)
      setQuoteErr(error ? `Quote NON salvate: ${error.message}` : null)
    }, 800)
    return () => { annullato = true; clearTimeout(t) }
  }, [quoteFissi, quoteCaricate])

  const richiestaRef = useRef(0)

  const loadData = useCallback(async () => {
    const mia = ++richiestaRef.current
    setLoading(true); setErr(null)
    try {
      // Entrambe le viste venivano lette senza `.range()`: il cap PostgREST di
      // 1000 righe le avrebbe troncate in silenzio. Il filtro anno+mese le tiene
      // piccole, ma la paginazione toglie il limite implicito. Nessuna delle due
      // ha una PK: con anno e mese fissati la chiave residua è (sede, reparto)
      // per la prima e (sede) per la seconda, quindi si ordina su quelle.
      const [rep, alloc, fissi] = await Promise.all([
        repartiApi.getAll(),
        fetchPaged(() => supabase.from('v_costo_personale_per_reparto')
          .select('anno, mese, sede, reparto_id, reparto_nome, reparto_icona, n_attivi, n_ex, n_dipendenti, costo_attivi, costo_ex, costo_totale')
          .eq('anno', anno).eq('mese', mese)
          .order('sede'), 'reparto_nome'),
        costiFissiApi.getMese?.({ anno, mese }) ??
          fetchPaged(() => supabase.from('v_costi_fissi_mensile')
            .select('*')
            .eq('anno', anno).eq('mese', mese), 'sede'),
      ])
      const from = `${anno}-${String(mese).padStart(2,'0')}-01`
      // Mai `-31` cablato: in feb/apr/giu/set/nov Postgres restituisce 22008.
      const last = new Date(anno, mese, 0).getDate()
      const to   = `${anno}-${String(mese).padStart(2,'0')}-${String(last).padStart(2,'0')}`
      // limit 200 è sufficiente: al massimo 31 giorni × 2 sedi.
      const chius = await chiusureApi.getAll({ from, to, limit: 200 })

      if (mia !== richiestaRef.current) return
      setReparti(rep || [])
      setCostiAlloc(alloc || [])
      setCostiFissi(Array.isArray(fissi) ? fissi : [])
      setChiusureMese(chius || [])
    } catch (e) {
      if (mia === richiestaRef.current) setErr(e.message || String(e))
    } finally {
      if (mia === richiestaRef.current) setLoading(false)
    }
  }, [anno, mese])

  useEffect(() => {
    loadData()
    // Invalida la richiesta in volo: nessun setState dopo lo smontaggio.
    return () => { richiestaRef.current++ }
  }, [loadData])

  // ── Aggregati ──────────────────────────────────────────────────────────
  const allocFilt = useMemo(() => sede === 'Tutte' ? costiAlloc : costiAlloc.filter(r => r.sede === sede), [costiAlloc, sede])

  const costoFissoSede = useMemo(() => {
    const totBySede = { MA: 0, PN: 0 }
    // Le righe con sede diversa da MA/PN venivano scartate in silenzio: qui
    // vengono contate a parte e dichiarate sotto i KPI.
    let scartati = 0, scartatoImporto = 0
    for (const r of costiFissi) {
      // v_costi_fissi_mensile espone `tot_costi_fissi`; `importo` resta per il
      // caso in cui l'API costiFissiApi.getMese restituisca le righe grezze.
      const importo = parseFloat(r.importo ?? r.tot_costi_fissi ?? 0) || 0
      if (totBySede[r.sede] != null) totBySede[r.sede] += importo
      else { scartati++; scartatoImporto += importo }
    }
    return { ...totBySede, _scartati: scartati, _scartatoImporto: scartatoImporto }
  }, [costiFissi])

  const venduto = useMemo(() => {
    const totBySede = { MA: 0, PN: 0 }
    let totCoperti = { MA: 0, PN: 0 }
    let scartati = 0, scartatoImporto = 0
    for (const r of chiusureMese) {
      const importo = parseFloat(r.totale_venduto_ipratico ?? r.totale ?? 0) || 0
      const cop = parseInt(r.coperti) || 0
      if (totBySede[r.sede] != null) {
        totBySede[r.sede] += importo
        totCoperti[r.sede] += cop
      } else { scartati++; scartatoImporto += importo }
    }
    return { totBySede, totCoperti, scartati, scartatoImporto }
  }, [chiusureMese])

  // ── Tabella per reparto: somma personale + quota costi fissi ───────────
  const perReparto = useMemo(() => {
    const byRep = {}
    for (const r of allocFilt) {
      const k = r.reparto_id || 'unassigned'
      if (!byRep[k]) byRep[k] = {
        reparto_id: r.reparto_id, nome: r.reparto_nome || 'Non assegnato',
        icona: r.reparto_icona || '❓',
        n_dipendenti: 0, n_ex: 0, costo_personale: 0, costo_ex: 0,
      }
      // USA SOLO costo_attivi nelle analisi (esclude TFR/ferie residue ex)
      byRep[k].costo_personale += parseFloat(r.costo_attivi) || 0
      byRep[k].costo_ex += parseFloat(r.costo_ex) || 0
      byRep[k].n_dipendenti += parseInt(r.n_attivi) || 0
      byRep[k].n_ex += parseInt(r.n_ex) || 0
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
      // Un reparto senza quota configurata riceveva 0% di costi fissi senza che
      // nulla lo dicesse: il flag `quota_mancante` lo rende visibile in tabella.
      const quotaConfigurata = quoteFissi[row.nome]
      const quotaPct = (quotaConfigurata ?? 0) / 100
      const costoFissoQuota = totFissi * quotaPct
      const costoTotale = row.costo_personale + costoFissoQuota
      return {
        ...row,
        costo_fissi: costoFissoQuota,
        costo_totale: costoTotale,
        quota_pct: quotaConfigurata ?? 0,
        quota_mancante: quotaConfigurata == null,
      }
    }).sort((a, b) => b.costo_totale - a.costo_totale)
  }, [allocFilt, reparti, quoteFissi, costoFissoSede, sede])

  const totVenduto = sede === 'Tutte'
    ? (venduto.totBySede.MA + venduto.totBySede.PN)
    : (venduto.totBySede[sede] || 0)
  const totCosti = perReparto.reduce((s, r) => s + r.costo_totale, 0)
  const margine = totVenduto - totCosti
  const marginePct = totVenduto > 0 ? margine / totVenduto : 0

  const quoteSum = Object.values(quoteFissi).reduce((s, v) => s + (+v || 0), 0)

  // Anni realmente presenti nella vista costi personale (niente lista cablata).
  const { anni: anniDisponibili } = useAnniDisponibili('v_costo_personale_per_reparto', 'anno', { tipo: 'anno' })

  const colonneCsv = [
    { chiave: 'nome', etichetta: 'Reparto' },
    { chiave: 'n_dipendenti', etichetta: 'Dipendenti' },
    { chiave: 'costo_personale', etichetta: 'Costo personale €', valore: r => +Number(r.costo_personale || 0).toFixed(2) },
    { chiave: 'quota_pct', etichetta: 'Quota costi fissi %' },
    { chiave: 'costo_fissi', etichetta: 'Quota costi fissi €', valore: r => +Number(r.costo_fissi || 0).toFixed(2) },
    { chiave: 'costo_totale', etichetta: 'Costo totale €', valore: r => +Number(r.costo_totale || 0).toFixed(2) },
    { chiave: 'pct_venduto', etichetta: '% su venduto', valore: r => (totVenduto > 0 ? +((r.costo_totale / totVenduto) * 100).toFixed(2) : null) },
  ]

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
              {/* Gli anni si chiedono ai dati: la lista fissa di 5 anni nascondeva
                  lo storico più vecchio senza che dalla UI si potesse capirlo. */}
              <select value={anno} onChange={e => setAnno(parseInt(e.target.value))}
                className="px-2 py-1 border border-gray-200 rounded text-sm">
                {(anniDisponibili.length ? anniDisponibili : [anno]).map(y => <option key={y} value={y}>{y}</option>)}
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

          {quoteErr && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-amber-800 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5" /> {quoteErr}
            </div>
          )}

          {(venduto.scartati > 0 || costoFissoSede._scartati > 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-amber-800 text-xs flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5" />
              <span>
                Righe con sede diversa da MA/PN escluse dai totali:
                {venduto.scartati > 0 && <> {venduto.scartati} chiusure ({fmtE(venduto.scartatoImporto)} di venduto)</>}
                {venduto.scartati > 0 && costoFissoSede._scartati > 0 && ' ·'}
                {costoFissoSede._scartati > 0 && <> {costoFissoSede._scartati} voci di costo fisso ({fmtE(costoFissoSede._scartatoImporto)})</>}.
              </span>
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
              <div className={`text-xs font-bold flex items-center gap-2 ${quoteSum === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
                Totale: {quoteSum}% {quoteSum !== 100 && '⚠️'}
                {savingQuote && <span className="text-violet-600 text-[10px]">salvo...</span>}
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Modifica le % per spalmare i costi fissi sui reparti. <strong>Salvato su Supabase</strong> — sincronizzato tra dispositivi.
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
              <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                <h3 className="font-semibold text-sm text-gray-800 flex items-center gap-2">
                  <Activity size={15} className="text-violet-600" /> Costi per Reparto
                </h3>
                <BottoneCsv righe={perReparto} colonne={colonneCsv} nomeFile={`costi_reparto_${anno}_${String(mese).padStart(2,'0')}`} />
              </div>
              <NotaCopertura righe={costiAlloc.length} fonte="v_costo_personale_per_reparto + v_costi_fissi_mensile"
                extra={`${MESI[mese-1]} ${anno} · sede ${sede}`} />
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
                          <td className="py-2 px-2 text-right text-amber-600">
                            {fmtE(r.costo_fissi)}
                            {r.quota_mancante && (
                              <span className="ml-1 text-[10px] text-amber-700 bg-amber-100 px-1 rounded"
                                title="Nessuna quota configurata per questo reparto: riceve 0% dei costi fissi">
                                0% non configurato
                              </span>
                            )}
                          </td>
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
                      {perReparto.map((e) => (
                        <Cell key={e.reparto_id || e.nome} fill={COLORS[e.nome] || COLORS._default} />
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
