import useSedi from '../hooks/useSedi'
import { useTabParam } from '../hooks/useTabParam'
import React, { useState, useCallback, useEffect, useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  RefreshCw, Users, TrendingUp, DollarSign, Activity, User2,
  Calendar, MapPin, AlertCircle, PlusCircle, Trash2, CheckCircle, X,
  FileText, ShieldCheck, BarChart2, Info,
} from 'lucide-react'
import { bustePaga as bp, employees as empApi, repartiApi, roles as rolesApi } from '../api/client'
import PageAssistant from '../components/PageAssistant'
import PageStatsWidget from '../components/PageStatsWidget'
import { EmployeeForm } from './Employees'
import { Settings as SettingsIcon } from 'lucide-react'
import supabase from '../supabase'
import { fetchPaged } from '../api/paged'
import useAnniDisponibili from '../hooks/useAnniDisponibili'
import { useOrdinamento, IconaOrdine, BottoneCsv } from '../lib/tabella'

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS & UTILS
// ═══════════════════════════════════════════════════════════════════════════
const COSTO_AZ_FALLBACK = 1.79  // netto → costo azienda, usato solo se costo_azienda mancante (vecchio 1.9653 sovrastimava 10-35%)

// Moltiplicatore lorda → costo azienda.
//
// FONTE: bilancio provvisorio 2025 (SVILUPPO RISTORAZIONE ITALIA S RL), voce di
// conto economico 67.01 "Costi personale dipendente":
//   retribuzioni lorde (67.01.01)  737.300,62
//   + INPS 174.493,38 + TFR 52.313,64 + altri enti 5.267,85 + INAIL 7.137,19
//   = totale 67.01                 976.512,68
//   976.512,68 / 737.300,62 = 1,32444 → 1,3244  (32,44% di oneri c/azienda)
//
// È il carico contributivo REALE (esoneri tipo Decontribuzione Sud già dentro),
// non la somma delle aliquote nominali CCNL Turismo (38,57% → 1,3857) usata
// prima: quella sovrastimava il costo del personale 2025 di ~44.000 €.
// Lo stesso valore è in BUSTE_PAGA/aggiorna_buste_paga.py (CCNL_MOLTIPLICATORE_AZ):
// se cambia qui deve cambiare anche lì, altrimenti il ricalcolo diverge dal DB.
const CCNL_MOLT_LORDA = 1.3244
const EUR  = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const EUR0 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const NUM  = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 })

const fmtEur  = v => typeof v === 'number' && isFinite(v) ? EUR.format(v)  : '—'
const fmtEur0 = v => typeof v === 'number' && isFinite(v) ? EUR0.format(v) : '—'
const fmtNum  = v => typeof v === 'number' && isFinite(v) ? NUM.format(v)  : '—'
const fmtPctIt = (v, d = 2) => typeof v === 'number' && isFinite(v)
  ? `${v.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })}%`
  : '—'

const MESI_SHORT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const MESI_FULL  = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                    'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']

// ═══════════════════════════════════════════════════════════════════════════
// TARATURA COSTO PERSONALE — letta dal bilancio, non scritta a mano
// ═══════════════════════════════════════════════════════════════════════════
//
// I riquadri esplicativi di questa pagina riportavano anno e importi cablati
// ("bilancio 2025: 976.512,68 / 737.300,62"). Un numero cablato dentro un testo
// esplicativo invecchia in silenzio: quando arriva il bilancio successivo la
// pagina continua a citare l'esercizio vecchio e nessuno se ne accorge.
//
// A DB convivono due schemi di bilancio con codici diversi per la stessa
// informazione: il provvisorio contabile usa 67.01 (totale) e 67.01.01
// (retribuzioni lorde), i depositati in formato CEE usano B9 e B9a. Si prova
// l'uno e poi l'altro, così vale sempre l'esercizio più recente disponibile,
// qualunque sia lo schema con cui è stato caricato.
const SCHEMI_PERSONALE = [
  { totale: '67.01', lorda: '67.01.01', componenti: ['67.01.01', '67.01.03', '67.01.07', '67.01.09', '67.01.11'] },
  // B9cde raggruppa TFR + quiescenza + altri costi: elencare anche B9c/B9d/B9e
  // conterebbe due volte le stesse quote.
  { totale: 'B9',    lorda: 'B9a',      componenti: ['B9a', 'B9b', 'B9cde'] },
]
const CODICI_PERSONALE = [...new Set(SCHEMI_PERSONALE.flatMap(s => [s.totale, ...s.componenti]))]

// Promise condivisa: il dato serve a tre riquadri diversi della stessa pagina e
// non cambia durante la sessione, quindi si legge una volta sola.
let _promessaBilancioPersonale = null

async function caricaCostoPersonaleBilancio() {
  if (_promessaBilancioPersonale) return _promessaBilancioPersonale

  _promessaBilancioPersonale = (async () => {
    const { data: testate, error } = await supabase
      .from('bilanci').select('id,anno,tipo,societa').order('anno', { ascending: false })
    // Il client Supabase non rigetta mai: senza leggere `error` un blocco RLS
    // diventerebbe "nessun bilancio a DB", cioè un riquadro muto invece di un
    // problema segnalato.
    if (error) throw error
    if (!testate?.length) return null

    // Poche righe per bilancio (filtro sui codici), ma la lettura passa
    // comunque da fetchPaged: il cap PostgREST di 1000 righe è lato server e
    // nessun parametro del client lo alza.
    const voci = await fetchPaged(
      () => supabase.from('bilancio_voci')
        .select('id,bilancio_id,codice_voce,descrizione,importo')
        .in('codice_voce', CODICI_PERSONALE),
      'id'
    )

    const perBilancio = new Map()
    for (const v of voci) {
      if (!perBilancio.has(v.bilancio_id)) perBilancio.set(v.bilancio_id, new Map())
      perBilancio.get(v.bilancio_id).set(v.codice_voce, v)
    }

    // `testate` è già ordinata per anno decrescente: vince il primo esercizio
    // che espone davvero sia il totale sia le retribuzioni lorde.
    for (const b of testate) {
      const vociBilancio = perBilancio.get(b.id)
      if (!vociBilancio) continue
      for (const schema of SCHEMI_PERSONALE) {
        const totale = Number(vociBilancio.get(schema.totale)?.importo)
        const lorda  = Number(vociBilancio.get(schema.lorda)?.importo)
        if (!Number.isFinite(totale) || !Number.isFinite(lorda) || lorda <= 0) continue
        return {
          anno: b.anno, tipo: b.tipo, societa: b.societa,
          totale, lorda,
          moltiplicatore: totale / lorda,
          componenti: schema.componenti
            .map(c => vociBilancio.get(c))
            .filter(Boolean)
            .map(v => ({ codice: v.codice_voce, descrizione: v.descrizione, importo: Number(v.importo) })),
        }
      }
    }
    return null
  })()

  // Un errore non deve restare in cache: altrimenti un singolo blip di rete
  // spegnerebbe i riquadri per tutta la sessione, senza possibilità di riprovare.
  _promessaBilancioPersonale.catch(() => { _promessaBilancioPersonale = null })
  return _promessaBilancioPersonale
}

/**
 * Taratura del costo aziendale letta dal bilancio più recente a DB.
 * @returns {{ dato: object|null, caricamento: boolean, errore: string|null }}
 */
function useCostoPersonaleBilancio() {
  const [stato, setStato] = useState({ dato: null, caricamento: true, errore: null })
  useEffect(() => {
    let annullato = false
    caricaCostoPersonaleBilancio()
      .then(d => { if (!annullato) setStato({ dato: d, caricamento: false, errore: null }) })
      .catch(e => { if (!annullato) setStato({ dato: null, caricamento: false, errore: e?.message || String(e) }) })
    return () => { annullato = true }
  }, [])
  return stato
}

/** Testo unico per "come si calcola il costo aziendale", senza anni cablati. */
function notaTaraturaCosto(bilancio) {
  if (!bilancio) return `lorda × ${CCNL_MOLT_LORDA} (oneri c/azienda)`
  return `lorda × ${CCNL_MOLT_LORDA} (tarato su bilancio ${bilancio.anno}${bilancio.tipo ? ` ${bilancio.tipo}` : ''})`
}

// ── Qualità dato ────────────────────────────────────────────────────────────
function qualitaDato(c) {
  if (!c) return 'stima'
  if (c.note && c.note.startsWith('Stima ')) return 'previsione'
  if (c.note === 'stima_da_gennaio_2026') return 'stima'
  if (c.file_name && c.totale_competenze) return 'certo'
  if (c.totale_competenze) return 'parziale'
  return 'stima'
}

const QUALITY = {
  certo:      { label: 'Da PDF',     sym: '✓', cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700', dot: 'bg-emerald-400' },
  parziale:   { label: 'Da LUL',    sym: '≈', cls: 'bg-yellow-900/40 text-yellow-300 border-yellow-700',   dot: 'bg-yellow-400' },
  previsione: { label: 'Previsione', sym: '⚡', cls: 'bg-amber-900/40 text-amber-300 border-amber-700',     dot: 'bg-amber-400' },
  stima:      { label: 'Stima',      sym: '~', cls: 'bg-red-900/40 text-red-300 border-red-700',            dot: 'bg-red-400' },
}

/** Chiave stabile di un cedolino: `id` a DB, altrimenti dipendente+periodo. */
const chiaveCedolino = c => c?.id ?? `${c?.employee_name || ''}-${c?.anno}-${c?.mese}`

// Colonne CSV condivise fra scheda dipendente e tab Cedolini: l'export deve
// contenere i valori calcolati mostrati a schermo, non solo le colonne grezze.
const COLONNE_CSV_CEDOLINI = [
  { chiave: 'employee_name', etichetta: 'Dipendente' },
  { chiave: 'sede',          etichetta: 'Sede' },
  { chiave: 'anno',          etichetta: 'Anno' },
  { chiave: 'mese',          etichetta: 'Mese', valore: c => MESI_FULL[(c.mese || 1) - 1] },
  { chiave: 'netto',         etichetta: 'Netto', valore: c => parseFloat(c.netto) || null },
  { chiave: 'totale_competenze', etichetta: 'Lorda', valore: c => parseFloat(c.totale_competenze) || null },
  { chiave: 'costo_azienda', etichetta: 'Costo azienda',
    valore: c => parseFloat(c.costo_azienda) || (parseFloat(c.netto) || 0) * COSTO_AZ_FALLBACK },
  { chiave: 'fonte',         etichetta: 'Fonte', valore: c => QUALITY[qualitaDato(c)].label },
  { chiave: 'file_name',     etichetta: 'File PDF' },
]

const COLONNE_CSV_DIPENDENTI = [
  { chiave: 'employee_name',  etichetta: 'Dipendente' },
  { chiave: 'sede',           etichetta: 'Sede' },
  { chiave: 'stato',          etichetta: 'Stato' },
  { chiave: 'qualifica',      etichetta: 'Qualifica' },
  { chiave: 'percentuale_pt', etichetta: '% Part time' },
  { chiave: 'ore_mensili',    etichetta: 'Ore/mese' },
  { chiave: 'mesi',           etichetta: 'Mesi con cedolino' },
  { chiave: 'totale_netto',   etichetta: 'Totale netto' },
  { chiave: 'totale_lorda',   etichetta: 'Totale lorda' },
  { chiave: 'totale_costo',   etichetta: 'Totale costo azienda' },
]

const COLONNE_CSV_TREND = [
  { chiave: 'label',   etichetta: 'Mese' },
  { chiave: 'nettoMA', etichetta: 'Netto MA' },
  { chiave: 'nettoPN', etichetta: 'Netto PN' },
  { chiave: 'costoMA', etichetta: 'Costo azienda MA' },
  { chiave: 'costoPN', etichetta: 'Costo azienda PN' },
  { chiave: 'dipMA',   etichetta: 'Dipendenti MA' },
  { chiave: 'dipPN',   etichetta: 'Dipendenti PN' },
]

const COLONNE_CSV_COSTO = [
  { chiave: 'label',   etichetta: 'Mese' },
  { chiave: 'netto',   etichetta: 'Netto' },
  { chiave: 'costoAz', etichetta: 'Costo azienda' },
]

function QualityBadge({ c, small = false }) {
  const q = qualitaDato(c)
  const { label, sym, cls } = QUALITY[q]
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium border ${cls} ${small ? 'text-[10px]' : ''}`}>
      {sym} {label}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// KPI CARD
// ═══════════════════════════════════════════════════════════════════════════
function KpiCard({ label, value, sub, icon: Icon, color = 'blue' }) {
  const g = { blue: 'from-blue-500 to-blue-600', green: 'from-emerald-500 to-emerald-600',
              purple: 'from-purple-500 to-purple-600', amber: 'from-amber-500 to-amber-600' }
  return (
    <div className={`bg-gradient-to-br ${g[color]} rounded-lg p-5 text-white shadow-lg`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <p className="text-sm opacity-80 font-medium">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        {Icon && <Icon size={24} className="opacity-60" />}
      </div>
      {sub && <p className="text-xs opacity-70">{sub}</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDA DIPENDENTE — modal con tutti i dettagli
// ═══════════════════════════════════════════════════════════════════════════
function SchedaDipendente({ emp, onClose, employeeRecord, reparti }) {
  const cedolini = emp.cedolini
  const sorted = useMemo(() => [...cedolini].sort((a, b) => a.anno * 100 + a.mese - (b.anno * 100 + b.mese)), [cedolini])
  const { dato: bilancio } = useCostoPersonaleBilancio()

  const stats = useMemo(() => {
    const certi    = cedolini.filter(c => qualitaDato(c) === 'certo').length
    const parziali = cedolini.filter(c => qualitaDato(c) === 'parziale').length
    const stime    = cedolini.filter(c => qualitaDato(c) === 'stima').length
    const totNetto = cedolini.reduce((s, c) => s + (parseFloat(c.netto) || 0), 0)
    const totCosto = cedolini.reduce((s, c) => s + (parseFloat(c.costo_azienda) || (parseFloat(c.netto) || 0) * COSTO_AZ_FALLBACK), 0)
    const totLorda = cedolini.reduce((s, c) => s + (parseFloat(c.totale_competenze) || 0), 0)
    const avgNetto = cedolini.length > 0 ? totNetto / cedolini.length : 0
    return { certi, parziali, stime, totNetto, totCosto, totLorda, avgNetto }
  }, [cedolini])

  const chartData = sorted.map(c => ({
    label: `${MESI_SHORT[(c.mese || 1) - 1]}`,
    netto: parseFloat(c.netto) || 0,
    lorda: parseFloat(c.totale_competenze) || 0,
    costo: parseFloat(c.costo_azienda) || (parseFloat(c.netto) || 0) * COSTO_AZ_FALLBACK,
  }))

  // Calcolo costo CCNL corretto (da lorda)
  const costoCalcolato = stats.totLorda > 0
    ? stats.totLorda * CCNL_MOLT_LORDA
    : stats.totNetto * COSTO_AZ_FALLBACK
  const deltaCosto = stats.totCosto - costoCalcolato

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl my-6 shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-700">
          <div>
            <h2 className="text-xl font-bold text-white">{emp.employee_name}</h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${emp.sede === 'MA' ? 'bg-red-900/40 text-red-300' : 'bg-blue-900/40 text-blue-300'}`}>
                {emp.sede === 'MA' ? 'Mameli — Cagliari' : 'Predda Niedda — Sassari'}
              </span>
              {emp.qualifica && <span className="text-xs text-gray-300 bg-gray-800 px-2 py-0.5 rounded">{emp.qualifica}</span>}
              {emp.percentuale_pt && <span className="text-xs text-gray-400">PT {parseFloat(emp.percentuale_pt)}%</span>}
              {emp.ore_mensili && <span className="text-xs text-gray-400">{emp.ore_mensili}h/mese</span>}
              {emp.paga_base && <span className="text-xs text-gray-400">Paga base: {fmtEur(parseFloat(emp.paga_base))}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white ml-4"><X size={20} /></button>
        </div>

        {/* KPI row */}
        <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-gray-700">
          <div className="bg-gray-800 rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-emerald-400">{fmtEur0(stats.totNetto)}</p>
            <p className="text-xs text-gray-400 mt-1">Totale netto</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-blue-400">{fmtEur0(stats.totLorda)}</p>
            <p className="text-xs text-gray-400 mt-1">Totale lorda</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-purple-400">{fmtEur0(stats.totCosto)}</p>
            <p className="text-xs text-gray-400 mt-1">Costo aziendale</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-amber-400">{fmtEur0(stats.avgNetto)}</p>
            <p className="text-xs text-gray-400 mt-1">Media mensile netto</p>
          </div>
        </div>

        {/* Qualità dati */}
        <div className="px-6 pt-5 pb-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Qualità dati</h3>
          <div className="flex gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span className="text-xs text-emerald-300 font-medium">{stats.certi} certi</span>
              <span className="text-xs text-gray-500">Da PDF individuale</span>
            </div>
            {stats.parziali > 0 && (
              <div className="flex items-center gap-2 bg-yellow-900/20 border border-yellow-800/40 rounded-lg px-3 py-2">
                <span className="w-2 h-2 rounded-full bg-yellow-400"></span>
                <span className="text-xs text-yellow-300 font-medium">{stats.parziali} parziali</span>
                <span className="text-xs text-gray-500">Da LUL (lorda nota)</span>
              </div>
            )}
            {stats.stime > 0 && (
              <div className="flex items-center gap-2 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
                <span className="w-2 h-2 rounded-full bg-red-400"></span>
                <span className="text-xs text-red-300 font-medium">{stats.stime} stime</span>
                <span className="text-xs text-gray-500">In attesa cedolino PDF</span>
              </div>
            )}
          </div>
        </div>

        {/* Trend chart */}
        {chartData.length > 1 && (
          <div className="px-6 pt-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Andamento mensile</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="label" stroke="#6b7280" tick={{ fontSize: 11 }} />
                <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(1)}k`} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
                  labelStyle={{ color: '#fff' }} formatter={v => fmtEur(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="netto" stroke="#10b981" name="Netto" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="lorda" stroke="#60a5fa" name="Lorda" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="costo" stroke="#a78bfa" name="Costo Az." strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Tabella cedolini dettaglio */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex items-center justify-between mb-3 gap-3">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Cedolini dettaglio</h3>
            <BottoneCsv
              righe={sorted}
              colonne={COLONNE_CSV_CEDOLINI}
              nomeFile={`cedolini_${(emp.employee_name || 'dipendente').replace(/\s+/g, '_').toLowerCase()}`}
            />
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-700">
            <table className="w-full text-xs">
              <thead className="bg-gray-800">
                <tr className="border-b border-gray-700">
                  <th className="px-3 py-2 text-left text-gray-400 font-medium">Periodo</th>
                  <th className="px-3 py-2 text-right text-gray-400 font-medium">Netto</th>
                  <th className="px-3 py-2 text-right text-gray-400 font-medium">Lorda</th>
                  <th className="px-3 py-2 text-right text-gray-400 font-medium">Costo Az.</th>
                  <th className="px-3 py-2 text-center text-gray-400 font-medium">Fonte</th>
                  <th className="px-3 py-2 text-left text-gray-400 font-medium hidden sm:table-cell">File PDF</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => {
                  const netto = parseFloat(c.netto) || 0
                  const lorda = parseFloat(c.totale_competenze) || 0
                  const costo = parseFloat(c.costo_azienda) || (netto * COSTO_AZ_FALLBACK)
                  // Evidenzia se costo non è CCNL-corretto
                  const costoAtteso = lorda > 0 ? lorda * CCNL_MOLT_LORDA : 0
                  const costoDeltaAlert = costoAtteso > 0 && Math.abs(costo - costoAtteso) > 50
                  return (
                    // Chiave di dominio: la lista è riordinata a ogni render, con
                    // l'indice React riuserebbe la riga sbagliata.
                    <tr key={chiaveCedolino(c)} className="border-b border-gray-800 hover:bg-gray-800/30">
                      <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{MESI_FULL[(c.mese || 1) - 1]} {c.anno}</td>
                      <td className="px-3 py-2 text-right text-emerald-400 font-semibold">{fmtEur(netto)}</td>
                      <td className="px-3 py-2 text-right text-blue-400">{lorda > 0 ? fmtEur(lorda) : <span className="text-gray-600">—</span>}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={costoDeltaAlert ? 'text-amber-400' : 'text-purple-400'}>{fmtEur(costo)}</span>
                        {costoDeltaAlert && <span className="ml-1 text-amber-500" title={`Atteso CCNL: ${fmtEur(costoAtteso)}`}>⚠</span>}
                      </td>
                      <td className="px-3 py-2 text-center"><QualityBadge c={c} small /></td>
                      <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate hidden sm:table-cell" title={c.file_name || ''}>
                        {c.file_name ? '📄 ' + c.file_name.split('/').pop() : <span className="text-gray-700">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-800/50">
                  <td className="px-3 py-2 text-gray-300 font-semibold">Totale</td>
                  <td className="px-3 py-2 text-right text-emerald-400 font-bold">{fmtEur(stats.totNetto)}</td>
                  <td className="px-3 py-2 text-right text-blue-400 font-bold">{stats.totLorda > 0 ? fmtEur(stats.totLorda) : '—'}</td>
                  <td className="px-3 py-2 text-right text-purple-400 font-bold">{fmtEur(stats.totCosto)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Dettaglio fiscale ultimo cedolino */}
        {sorted.length > 0 && (() => {
          const last = sorted[sorted.length - 1]
          const hasDetail = last.irpef_lorda || last.tfr_mese || last.ore_lavorate || last.inps_dipendente
          if (!hasDetail) return null
          return (
            <div className="px-6 pb-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Dettaglio fiscale — {MESI_FULL[(last.mese || 1) - 1]} {last.anno}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                {last.ore_lavorate != null && (
                  <div className="bg-gray-800/60 rounded-lg p-3 text-center border border-gray-700">
                    <p className="text-xl font-bold text-sky-400">{fmtNum(last.ore_lavorate)}</p>
                    <p className="text-xs text-gray-400 mt-1">Ore lavorate</p>
                  </div>
                )}
                {last.inps_dipendente != null && (
                  <div className="bg-gray-800/60 rounded-lg p-3 text-center border border-gray-700">
                    <p className="text-xl font-bold text-indigo-400">{fmtEur(parseFloat(last.inps_dipendente))}</p>
                    <p className="text-xs text-gray-400 mt-1">INPS c/dip</p>
                  </div>
                )}
                {last.irpef_lorda != null && (
                  <div className="bg-gray-800/60 rounded-lg p-3 text-center border border-gray-700">
                    <p className="text-xl font-bold text-rose-400">{fmtEur(parseFloat(last.irpef_lorda))}</p>
                    <p className="text-xs text-gray-400 mt-1">IRPEF lorda</p>
                    {last.irpef_netta != null && <p className="text-xs text-gray-500">Netta: {fmtEur(parseFloat(last.irpef_netta))}</p>}
                  </div>
                )}
                {last.tfr_mese != null && (
                  <div className="bg-gray-800/60 rounded-lg p-3 text-center border border-gray-700">
                    <p className="text-xl font-bold text-amber-400">{fmtEur(parseFloat(last.tfr_mese))}</p>
                    <p className="text-xs text-gray-400 mt-1">TFR maturato</p>
                    {last.tfr_annuo_progressivo != null && <p className="text-xs text-gray-500">Annuo prog.: {fmtEur(parseFloat(last.tfr_annuo_progressivo))}</p>}
                  </div>
                )}
              </div>
              {(last.imponibile_fiscale || last.imponibile_inps) && (
                <div className="bg-gray-900/50 rounded-lg p-3 text-xs text-gray-400 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {last.imponibile_inps    != null && <span>Imponibile INPS: <span className="text-white font-medium">{fmtEur(parseFloat(last.imponibile_inps))}</span></span>}
                  {last.imponibile_fiscale != null && <span>Imponibile IRPEF: <span className="text-white font-medium">{fmtEur(parseFloat(last.imponibile_fiscale))}</span></span>}
                  {last.totale_trattenute != null && <span>Totale trattenute: <span className="text-white font-medium">{fmtEur(parseFloat(last.totale_trattenute))}</span></span>}
                  {last.totale_contributi_mese != null && <span>Contributi mese: <span className="text-white font-medium">{fmtEur(parseFloat(last.totale_contributi_mese))}</span></span>}
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Allocazione costo per sede + reparto ── */}
        {employeeRecord && stats.totCosto > 0 && (() => {
          const pctMA = employeeRecord.sede_split_ma ?? (employeeRecord.sede === 'MA' ? 100 : 0)
          const pctPN = 100 - pctMA
          const costoMA = stats.totCosto * (pctMA / 100)
          const costoPN = stats.totCosto * (pctPN / 100)
          const repartoSplit = employeeRecord.reparto_split || {}
          const totalePctReparti = Object.values(repartoSplit).reduce((s, v) => s + (parseFloat(v) || 0), 0)
          const rows = totalePctReparti > 0
            ? Object.entries(repartoSplit).map(([rid, pct]) => {
                const r = (reparti || []).find(x => x.id === rid)
                return { id: rid, nome: r?.nome || 'Non assegnato', icona: r?.icona || '❓', pct: parseFloat(pct) || 0,
                  costo: stats.totCosto * (parseFloat(pct) / 100) }
              }).filter(x => x.pct > 0).sort((a,b) => b.costo - a.costo)
            : []
          return (
            <div className="px-6 pb-2">
              <h3 className="text-xs font-semibold text-violet-300 uppercase tracking-wider mb-3">
                Ripartizione costo aziendale
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {/* Per sede */}
                <div className="bg-violet-900/20 border border-violet-700/40 rounded-lg p-3">
                  <p className="text-xs font-semibold text-violet-300 mb-2">Per Sede</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-300">🍝 Mameli ({pctMA}%)</span>
                      <span className="font-bold text-red-300">{fmtEur0(costoMA)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-300">🏭 Predda Niedda ({pctPN}%)</span>
                      <span className="font-bold text-blue-300">{fmtEur0(costoPN)}</span>
                    </div>
                  </div>
                </div>
                {/* Per reparto */}
                <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-lg p-3">
                  <p className="text-xs font-semibold text-emerald-300 mb-2">Per Reparto</p>
                  {rows.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">Nessuna ripartizione reparto — clicca ⚙ per impostare</p>
                  ) : (
                    <div className="space-y-1.5">
                      {rows.map(r => (
                        <div key={r.id} className="flex items-center justify-between text-xs">
                          <span className="text-gray-300">{r.icona} {r.nome} ({r.pct}%)</span>
                          <span className="font-bold text-emerald-300">{fmtEur0(r.costo)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })()}

        {/* CCNL breakdown — voci e moltiplicatore letti dal bilancio a DB */}
        <div className="px-6 py-4">
          <div className="bg-gray-800/50 rounded-lg p-4">
            <h4 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
              <Info size={12}/> Calcolo costo aziendale
              {bilancio && <span className="text-gray-500 font-normal">— tarato sul bilancio {bilancio.anno} ({bilancio.tipo})</span>}
            </h4>
            {bilancio ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 text-xs text-gray-400">
                  {bilancio.componenti.map(v => (
                    <span key={v.codice} title={`${v.codice} — ${v.descrizione}`}>
                      {v.descrizione}: {fmtEur(v.importo)}
                    </span>
                  ))}
                  <span className="text-gray-300">Totale: {fmtEur(bilancio.totale)}</span>
                </div>
                <p className="mt-1.5 text-[11px] text-gray-500">
                  Fonte: conto economico del bilancio {bilancio.tipo} {bilancio.anno}
                  {bilancio.societa ? ` — ${bilancio.societa}` : ''}. Il rapporto
                  {' '}{fmtEur(bilancio.totale)} / {fmtEur(bilancio.lorda)} dà il moltiplicatore reale
                  ({bilancio.moltiplicatore.toFixed(4)}), che incorpora gli esoneri contributivi
                  effettivamente applicati (es. Decontribuzione Sud). Le aliquote nominali
                  CCNL Turismo (38,57%) sovrastimano il costo.
                </p>
              </>
            ) : (
              <p className="text-[11px] text-gray-500">
                Moltiplicatore tarato sul rapporto fra costo totale del personale e retribuzioni
                lorde dell'ultimo bilancio disponibile: incorpora gli esoneri contributivi
                realmente applicati, che le aliquote nominali CCNL non considerano.
                <span className="text-gray-600"> (voci di bilancio non leggibili in questo momento)</span>
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-4 text-xs">
              <span className="text-gray-300">Oneri c/azienda: <span className="text-white font-semibold">{fmtPctIt((CCNL_MOLT_LORDA - 1) * 100)} su lorda</span></span>
              <span className="text-gray-300">Formula: <span className="text-white font-semibold">costo = lorda × {CCNL_MOLT_LORDA}</span></span>
              {stats.totLorda > 0 && (
                <span className="text-gray-300">Costo CCNL atteso: <span className="text-emerald-400 font-semibold">{fmtEur(costoCalcolato)}</span>
                  {Math.abs(deltaCosto) > 50 && <span className="text-amber-400 ml-1">(Δ {fmtEur(deltaCosto)} vs DB)</span>}
                </span>
              )}
            </div>
            {/* Il moltiplicatore in uso è replicato in BUSTE_PAGA/aggiorna_buste_paga.py:
                se il bilancio si aggiorna e nessuno allinea la costante, il costo mostrato
                smette di corrispondere al bilancio senza che nulla lo segnali. */}
            {bilancio && Math.abs(bilancio.moltiplicatore - CCNL_MOLT_LORDA) > 0.005 && (
              <p className="mt-2 text-[11px] text-amber-400">
                ⚠ Il moltiplicatore in uso ({CCNL_MOLT_LORDA}) non coincide con quello del bilancio
                {' '}{bilancio.anno} ({bilancio.moltiplicatore.toFixed(4)}): va riallineato qui e in
                {' '}aggiorna_buste_paga.py.
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MODALE AGGIUNGI CEDOLINO
// ═══════════════════════════════════════════════════════════════════════════
const PT_ORE_OPTS = [
  { label: '— Non specificato —', ore: '', sett: '' },
  { label: '160h/mese · FT 100%', ore: 160, sett: 40 },
  { label: '120h/mese · PT 75%',  ore: 120, sett: 30 },
  { label: '100h/mese · PT 62.5%',ore: 100, sett: 25 },
  { label: '80h/mese · PT 50%',   ore: 80,  sett: 20 },
]

function AddModal({ employees, onSave, onClose }) {
  const now = new Date()
  // Stessa fonte del selettore anno della pagina: due tendine con intervalli
  // diversi nella stessa schermata (2024→oggi qui, 2023→oggi nei filtri)
  // facevano sembrare mancanti anni che a DB c'erano, e viceversa.
  const { anni: anniDb } = useAnniDisponibili('buste_paga', 'anno', { tipo: 'anno' })
  const [form, setForm] = useState({
    employee_id: '', employee_code: '', employee_name: '', sede: 'MA',
    anno: now.getFullYear(), mese: now.getMonth() + 1, netto: '',
    ore_mensili: '', ore_settimanali: '', percentuale_pt: '',
    file_name: '', note: ''
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const pickEmployee = (code) => {
    const e = employees.find(x => x.code === code)
    if (!e) { setForm(f => ({ ...f, employee_code: '', employee_name: '', sede: 'MA', employee_id: '' })); return }
    setForm(f => ({
      ...f,
      employee_id:    e.id      || '',
      employee_code:  e.code    || '',
      employee_name:  e.name    || '',
      sede:           e.sede    || 'MA',
      ore_mensili:    e.regole?.ore_contratto_mensili || e.ore_contratto_mensili || f.ore_mensili,
      ore_settimanali: e.regole?.ore_settimanali || e.ore_settimanali || f.ore_settimanali,
    }))
  }

  const pickOre = (ore) => {
    const opt = PT_ORE_OPTS.find(o => String(o.ore) === String(ore))
    if (!opt) return
    const PT_MAP = { 160: 100, 120: 75, 100: 62.5, 80: 50 }
    setForm(f => ({
      ...f,
      ore_mensili:    opt.ore,
      ore_settimanali: opt.sett,
      percentuale_pt:  PT_MAP[opt.ore] || '',
    }))
  }

  const handleSave = async () => {
    if (!form.employee_name) return setErr('Inserisci nome dipendente')
    if (!form.netto || parseFloat(form.netto) <= 0) return setErr('Inserisci netto > 0')
    setSaving(true); setErr(null)
    try { await onSave(form); onClose() }
    catch(e) { setErr(e.message || 'Errore salvataggio') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <h3 className="font-semibold text-white text-lg">Aggiungi Cedolino</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18}/></button>
        </div>
        <div className="p-5 space-y-3">
          {err && <div className="bg-red-900/30 border border-red-700 rounded p-2 text-red-300 text-sm">{err}</div>}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Dipendente (scegli dalla lista)</label>
            <select className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
              value={form.employee_code} onChange={e => pickEmployee(e.target.value)}>
              <option value="">— oppure inserisci manualmente —</option>
              {employees.map(e => <option key={e.id} value={e.code}>{e.name} ({e.sede})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Nome dipendente *</label>
              <input className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.employee_name} onChange={e => set('employee_name', e.target.value)} placeholder="NOME COGNOME"/>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Sede</label>
              <select className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.sede} onChange={e => set('sede', e.target.value)}>
                <option value="MA">MA — Mameli</option>
                <option value="PN">PN — Predda Niedda</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Anno</label>
              <select className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.anno} onChange={e => set('anno', parseInt(e.target.value))}>
                {/* L'anno selezionato entra sempre nell'elenco: si può inserire il
                    primo cedolino di un anno che a DB ancora non esiste. */}
                {[...new Set([form.anno, ...anniDb])].sort((a, b) => b - a)
                  .map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Mese</label>
              <select className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.mese} onChange={e => set('mese', parseInt(e.target.value))}>
                {MESI_FULL.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Netto (€) *</label>
              <input type="number" step="0.01" min="0"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.netto} onChange={e => set('netto', e.target.value)} placeholder="es. 1250.00"/>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">File PDF (nome)</label>
              <input className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.file_name} onChange={e => set('file_name', e.target.value)} placeholder="cedolino_gen.pdf"/>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Ore contratto</label>
            <select className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
              value={form.ore_mensili || ''} onChange={e => pickOre(e.target.value)}>
              {PT_ORE_OPTS.map(o => <option key={o.ore} value={o.ore}>{o.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Ore mensili</label>
              <input type="number" min="0" max="200"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.ore_mensili || ''} onChange={e => set('ore_mensili', e.target.value)} placeholder="160"/>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Ore settimanali</label>
              <input type="number" min="0" max="40"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                value={form.ore_settimanali || ''} onChange={e => set('ore_settimanali', e.target.value)} placeholder="40"/>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Note</label>
            <textarea className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm resize-none" rows={2}
              value={form.note} onChange={e => set('note', e.target.value)}/>
          </div>
        </div>
        <div className="flex gap-3 p-5 pt-0">
          <button onClick={onClose} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm font-medium">Annulla</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
            {saving ? <RefreshCw size={14} className="animate-spin"/> : <CheckCircle size={14}/>}
            {saving ? 'Salvataggio...' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — RIEPILOGO
// ═══════════════════════════════════════════════════════════════════════════
function RiepilogoTab({ anno, mese, sedeFilter, riepilogo }) {
  const { dato: bilancio } = useCostoPersonaleBilancio()
  const filtered = useMemo(() => {
    if (!riepilogo) return []
    let data = sedeFilter === 'Tutte' ? riepilogo : riepilogo.filter(r => r.sede === sedeFilter)
    if (mese > 0) data = data.filter(r => r.mese === mese)
    return data
  }, [riepilogo, sedeFilter, mese])

  const periodoLabel = mese > 0 ? `${MESI_FULL[mese - 1]} ${anno}` : `Anno ${anno}`

  const kpis = useMemo(() => {
    const totNetto = filtered.reduce((s, r) => s + (r.totale_netto || 0), 0)
    const totCosto = filtered.reduce((s, r) => s + (r.totale_costo || 0), 0)
    const nDip = Math.max(...filtered.map(r => r.n_dipendenti || 0), 0)
    return { totNetto, totCosto, nDip, media: nDip > 0 ? totNetto / nDip : 0 }
  }, [filtered])

  const chartData = useMemo(() => {
    const byMese = {}
    for (const r of filtered) {
      const k = `${r.anno}-${String(r.mese).padStart(2,'0')}`
      if (!byMese[k]) byMese[k] = { label: `${MESI_SHORT[r.mese-1]} ${r.anno}`, netto: 0, costoAz: 0 }
      byMese[k].netto   += r.totale_netto || 0
      byMese[k].costoAz += r.totale_costo || 0
    }
    return Object.entries(byMese).sort().map(([,v]) => v)
  }, [filtered])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Totale Netto" value={fmtEur0(kpis.totNetto)} sub={periodoLabel} icon={DollarSign} color="green"/>
        <KpiCard label="Costo Aziendale" value={fmtEur0(kpis.totCosto)} sub={notaTaraturaCosto(bilancio)} icon={TrendingUp} color="purple"/>
        <KpiCard label="N. Dipendenti" value={fmtNum(kpis.nDip)} sub={periodoLabel} icon={Users} color="blue"/>
        <KpiCard label="Media Dipendente" value={fmtEur0(kpis.media)} sub="Netto medio mensile" icon={User2} color="amber"/>
      </div>
      {chartData.length > 0 && (
        <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
          <h3 className="text-lg font-semibold mb-4 text-white">Costi Mensili</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151"/>
              <XAxis dataKey="label" stroke="#9ca3af" tick={{ fontSize: 12 }}/>
              <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }}/>
              <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
                labelStyle={{ color: '#fff' }} formatter={v => fmtEur0(v)}/>
              <Legend/>
              <Bar dataKey="netto"   fill="#10b981" name="Netto"/>
              <Bar dataKey="costoAz" fill="#8b5cf6" name="Costo Aziendale"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {filtered.length === 0 && <p className="text-gray-400 text-center py-12">Nessun dato. Aggiungi i cedolini dalla tab "Cedolini".</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — DIPENDENTI (con schede personali cliccabili)
// ═══════════════════════════════════════════════════════════════════════════
function DipendentiTab({ cedolini, sedeFilter, anno, employees: employeesData = [], onRefresh }) {
  const [selected, setSelected] = useState(null)
  const [search, setSearch]     = useState('')
  const [editing, setEditing]   = useState(null)
  const [reparti, setReparti]   = useState([])
  const [ruoliDB, setRuoliDB]   = useState([])
  const [showEx, setShowEx]     = useState(false)  // mostra ex-dipendenti?
  const [allEmployees, setAllEmployees] = useState([])  // include anche inattivi
  const [erroreAnagrafica, setErroreAnagrafica] = useState(null)

  useEffect(() => {
    // Guardia di unmount: chiudendo la tab durante il fetch, senza questa,
    // le risposte arriverebbero su un componente già smontato.
    let annullato = false
    setErroreAnagrafica(null)
    ;(async () => {
      try {
        const [rep, ruoli, emps] = await Promise.all([
          repartiApi.getAll(),
          rolesApi?.getAll ? rolesApi.getAll() : Promise.resolve([]),
          // TUTTI gli employees (anche inattivi): serve per il badge ex-dipendente
          empApi.getAll({}),
        ])
        if (annullato) return
        setReparti(rep || [])
        setRuoliDB(ruoli || [])
        setAllEmployees(emps || [])
      } catch (e) {
        if (annullato) return
        // Prima ogni catch faceva setState([]): un blocco RLS o una rete caduta
        // diventavano "nessun reparto, nessun ex-dipendente", indistinguibili
        // dal caso in cui davvero non c'è nulla.
        setReparti([]); setRuoliDB([]); setAllEmployees([])
        setErroreAnagrafica(e?.message || String(e))
      }
    })()
    return () => { annullato = true }
  }, [])

  // Mappa nome cedolino → employee record (per matching anche con buste_paga_name)
  // Usa allEmployees (include ex) per distinguere attivi da ex
  const empByName = useMemo(() => {
    const m = {}
    const source = allEmployees.length > 0 ? allEmployees : employeesData
    for (const e of source) {
      m[(e.name || '').toUpperCase()] = e
      if (e.buste_paga_name) m[e.buste_paga_name.toUpperCase()] = e
    }
    return m
  }, [allEmployees, employeesData])

  const handleSaveEmployee = async (form) => {
    const payload = {
      ...form,
      location: form.sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA',
    }
    if (editing?.id) {
      await empApi.update(editing.id, payload)
    } else {
      await empApi.create(payload)
    }
    setEditing(null)
    if (onRefresh) onRefresh()
  }

  const byEmployee = useMemo(() => {
    const map = {}
    for (const c of cedolini) {
      const key = c.employee_name
      if (!map[key]) map[key] = {
        employee_name: key,
        sede:          c.sede,
        qualifica:     c.qualifica,
        percentuale_pt: c.percentuale_pt,
        ore_mensili:   c.ore_mensili,
        paga_base:     c.paga_base,
        cedolini:      [],
      }
      // Aggiorna con dati più recenti (some cols vary per month)
      if (c.qualifica)     map[key].qualifica     = c.qualifica
      if (c.percentuale_pt) map[key].percentuale_pt = c.percentuale_pt
      if (c.ore_mensili)   map[key].ore_mensili   = c.ore_mensili
      if (c.paga_base)     map[key].paga_base     = c.paga_base
      map[key].cedolini.push(c)
    }
    return Object.values(map)
      .filter(e => {
        if (sedeFilter !== 'Tutte' && e.sede !== sedeFilter) return false
        if (search && !e.employee_name.toLowerCase().includes(search.toLowerCase())) return false
        // Filtro ex-dipendenti: default OFF (mostra solo attivi)
        const rec = empByName[(e.employee_name || '').toUpperCase()]
        const isEx = rec && rec.active === false
        if (!showEx && isEx) return false
        return true
      })
      .sort((a, b) => a.employee_name.localeCompare(b.employee_name))
  }, [cedolini, sedeFilter, search, showEx, empByName])

  const globalStats = useMemo(() => {
    const ft  = byEmployee.filter(e => parseFloat(e.percentuale_pt) >= 100).length
    const pt  = byEmployee.filter(e => { const p = parseFloat(e.percentuale_pt); return p > 0 && p < 100 }).length
    const certiTot = cedolini.filter(c => {
      if (sedeFilter !== 'Tutte' && c.sede !== sedeFilter) return false
      return qualitaDato(c) === 'certo'
    }).length
    const totCed = sedeFilter === 'Tutte' ? cedolini.length : cedolini.filter(c => c.sede === sedeFilter).length
    return { ft, pt, certiTot, totCed }
  }, [byEmployee, cedolini, sedeFilter])

  const selectedEmp = useMemo(() => selected ? byEmployee.find(e => e.employee_name === selected) : null, [selected, byEmployee])

  // CSV: esporta esattamente ciò che è a schermo (stessi filtri sede/ricerca/ex)
  const righeCsvDipendenti = useMemo(() => byEmployee.map(e => {
    const totNetto = e.cedolini.reduce((s, c) => s + (parseFloat(c.netto) || 0), 0)
    const totLorda = e.cedolini.reduce((s, c) => s + (parseFloat(c.totale_competenze) || 0), 0)
    const totCosto = e.cedolini.reduce((s, c) => s + (parseFloat(c.costo_azienda) || (parseFloat(c.netto) || 0) * COSTO_AZ_FALLBACK), 0)
    const rec = empByName[(e.employee_name || '').toUpperCase()]
    return {
      employee_name: e.employee_name,
      sede: e.sede,
      qualifica: e.qualifica || null,
      percentuale_pt: e.percentuale_pt ?? null,
      ore_mensili: e.ore_mensili ?? null,
      mesi: e.cedolini.length,
      totale_netto: +totNetto.toFixed(2),
      // "0" e "non disponibile" non sono la stessa cosa: senza lorda si esporta vuoto
      totale_lorda: totLorda > 0 ? +totLorda.toFixed(2) : null,
      totale_costo: +totCosto.toFixed(2),
      stato: rec && rec.active === false ? 'ex' : 'attivo',
    }
  }), [byEmployee, empByName])

  return (
    <div className="space-y-4">
      {selectedEmp && (
        <SchedaDipendente
          emp={selectedEmp}
          onClose={() => setSelected(null)}
          employeeRecord={empByName[(selectedEmp.employee_name || '').toUpperCase()]}
          reparti={reparti}
        />
      )}
      {editing && (
        <EmployeeForm
          initial={editing}
          reparti={reparti}
          ruoliDB={ruoliDB}
          onSave={handleSaveEmployee}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Stats globali */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="Dipendenti" value={byEmployee.length} color="blue" icon={Users} sub={`anno ${anno}`}/>
        <KpiCard label="Full Time" value={globalStats.ft} color="green" icon={User2} sub="100% ore"/>
        <KpiCard label="Part Time" value={globalStats.pt} color="amber" icon={User2} sub="< 100% ore"/>
        <KpiCard label="Cedolini Da PDF" value={`${globalStats.certiTot}/${globalStats.totCed}`} color="purple" icon={FileText} sub="fonte certa"/>
      </div>

      {/* Legenda qualità */}
      <div className="bg-gray-800/40 border border-gray-700 rounded-lg px-4 py-3 flex flex-wrap gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400"></span><strong className="text-emerald-300">Da PDF</strong> — netto e lorda estratti dal cedolino PDF individuale</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400"></span><strong className="text-yellow-300">Da LUL</strong> — lorda nota dal LUL mensile, ma senza file individuale tracciato</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400"></span><strong className="text-amber-300">Previsione</strong> — media dei mesi precedenti dello stesso anno, in attesa del cedolino</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400"></span><strong className="text-red-300">Stima</strong> — valore stimato (es. proiezione da gennaio), in attesa del PDF</span>
      </div>

      {/* Anagrafica non leggibile: va detto, altrimenti gli ex-dipendenti e i
          reparti risultano semplicemente "assenti" */}
      {erroreAnagrafica && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 flex gap-2 text-sm text-red-300">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5"/>
          <div>
            Anagrafica dipendenti/reparti non caricata: {erroreAnagrafica}.
            I badge ex-dipendente e la ripartizione per reparto restano vuoti finché non si risolve.
          </div>
        </div>
      )}

      {/* Search + toggle ex-dipendenti */}
      <div className="flex flex-wrap gap-3 items-center">
        <input type="text" placeholder="Cerca dipendente..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
          <input type="checkbox" checked={showEx} onChange={e => setShowEx(e.target.checked)}
            className="accent-amber-500"/>
          <span>Mostra ex-dipendenti (TFR/ferie residue)</span>
        </label>
        <BottoneCsv righe={righeCsvDipendenti} colonne={COLONNE_CSV_DIPENDENTI} nomeFile={`dipendenti_${anno}`} />
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {byEmployee.map((emp) => {
          const totNetto = emp.cedolini.reduce((s, c) => s + (parseFloat(c.netto) || 0), 0)
          const totCosto = emp.cedolini.reduce((s, c) => s + (parseFloat(c.costo_azienda) || (parseFloat(c.netto) || 0) * COSTO_AZ_FALLBACK), 0)
          const certi    = emp.cedolini.filter(c => qualitaDato(c) === 'certo').length
          const parziali = emp.cedolini.filter(c => qualitaDato(c) === 'parziale').length
          const stime    = emp.cedolini.filter(c => qualitaDato(c) === 'stima').length
          const pt       = parseFloat(emp.percentuale_pt)
          const ultCed   = [...emp.cedolini].sort((a, b) => b.anno * 100 + b.mese - (a.anno * 100 + a.mese))[0]

          // Match employee record (per edit) tramite name o buste_paga_name
          const empRecord = empByName[(emp.employee_name || '').toUpperCase()]
          const isEx = empRecord && empRecord.active === false

          return (
            <div key={emp.employee_name} className="relative bg-gray-800 border border-gray-700 rounded-xl p-4 hover:border-blue-500/60 hover:bg-gray-800/80 transition-all group">
              {/* Pulsante Modifica scheda dipendente */}
              {empRecord && (
                <button
                  onClick={(e) => { e.stopPropagation(); setEditing(empRecord) }}
                  title="Modifica scheda dipendente (sede, reparto, ore, split costi)"
                  className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-gray-900/80 text-violet-300 hover:bg-violet-700 hover:text-white border border-gray-700 hover:border-violet-500 opacity-0 group-hover:opacity-100 transition-all">
                  <SettingsIcon size={13} />
                </button>
              )}
              <button onClick={() => setSelected(emp.employee_name)}
                className="block w-full text-left cursor-pointer">

              {/* Row 1: nome + netto/costo */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0 pr-7">
                  <h4 className="font-semibold text-white truncate group-hover:text-blue-300 transition-colors text-sm">{emp.employee_name}</h4>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${emp.sede === 'MA' ? 'bg-red-900/30 text-red-300' : 'bg-blue-900/30 text-blue-300'}`}>{emp.sede}</span>
                    {isEx && (
                      <span className="text-[10px] bg-amber-900/40 text-amber-300 border border-amber-700/40 px-1.5 py-0.5 rounded font-bold uppercase">EX · TFR</span>
                    )}
                    {empRecord?.sede_split_ma != null && empRecord.sede_split_ma !== 100 && empRecord.sede_split_ma !== 0 && (
                      <span className="text-[10px] bg-violet-900/40 text-violet-300 border border-violet-700/40 px-1 py-0.5 rounded">
                        {empRecord.sede_split_ma}%MA·{100 - empRecord.sede_split_ma}%PN
                      </span>
                    )}
                    {empRecord?.reparto_split && Object.keys(empRecord.reparto_split).length > 0 && (() => {
                      const rs = empRecord.reparto_split
                      const top = Object.entries(rs).sort(([,a],[,b]) => b - a)
                      const r0 = reparti.find(r => r.id === top[0]?.[0])
                      if (!r0) return null
                      const multi = top.length > 1 ? ` +${top.length - 1}` : ''
                      return <span className="text-[10px] bg-emerald-900/30 text-emerald-300 border border-emerald-700/40 px-1 py-0.5 rounded">{r0.icona}{r0.nome.substring(0, 4)}{multi}</span>
                    })()}
                    {emp.qualifica && <span className="text-xs text-gray-500">{emp.qualifica.replace('PART TIME ', 'PT ')}</span>}
                  </div>
                </div>
                <div className="text-right ml-2 flex-shrink-0">
                  <p className="text-sm font-bold text-emerald-400">{fmtEur0(totNetto)}</p>
                  <p className="text-xs text-purple-400">{fmtEur0(totCosto)}</p>
                </div>
              </div>

              {/* Row 2: mini stats */}
              <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                <div className="bg-gray-900/50 rounded p-1.5 text-center">
                  <p className="font-semibold text-white">{emp.cedolini.length}</p>
                  <p className="text-gray-500">mesi</p>
                </div>
                <div className="bg-gray-900/50 rounded p-1.5 text-center">
                  <p className="font-semibold text-white">{pt > 0 ? `${pt}%` : '—'}</p>
                  <p className="text-gray-500">PT</p>
                </div>
                <div className="bg-gray-900/50 rounded p-1.5 text-center">
                  <p className="font-semibold text-white">{emp.ore_mensili ? `${emp.ore_mensili}h` : '—'}</p>
                  <p className="text-gray-500">/mese</p>
                </div>
              </div>

              {/* Row 3: quality badges */}
              <div className="flex items-center gap-1.5 flex-wrap text-xs">
                {certi    > 0 && <span className="bg-emerald-900/30 text-emerald-400 border border-emerald-800/50 px-1.5 py-0.5 rounded">✓ {certi} PDF</span>}
                {parziali > 0 && <span className="bg-yellow-900/30 text-yellow-400 border border-yellow-800/50 px-1.5 py-0.5 rounded">≈ {parziali} LUL</span>}
                {stime    > 0 && <span className="bg-red-900/30 text-red-400 border border-red-800/50 px-1.5 py-0.5 rounded">~ {stime} stima</span>}
              </div>

              {ultCed && <p className="text-xs text-gray-600 mt-2">Ultimo: {MESI_FULL[(ultCed.mese || 1) - 1]} {ultCed.anno}</p>}
              <p className="text-xs text-blue-500/50 group-hover:text-blue-400/70 mt-1 transition-colors">Clicca per la scheda completa →</p>
              </button>
            </div>
          )
        })}
      </div>
      {byEmployee.length === 0 && <p className="text-gray-400 text-center py-12">Nessun dipendente trovato.</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — BI ANALISI DETTAGLIATA
// ═══════════════════════════════════════════════════════════════════════════
function AnalisiTab({ cedolini, sedeFilter, anno }) {
  const filtered = useMemo(() => {
    if (!cedolini) return []
    return sedeFilter === 'Tutte' ? cedolini : cedolini.filter(c => c.sede === sedeFilter)
  }, [cedolini, sedeFilter])

  // Trend mensile per sede
  const trendData = useMemo(() => {
    const byMese = {}
    for (const c of filtered) {
      const k = String(c.mese).padStart(2, '0')
      if (!byMese[k]) byMese[k] = { chiave: k, mese: c.mese, label: MESI_SHORT[c.mese - 1], nettoMA: 0, nettoPN: 0, costoMA: 0, costoPN: 0, dipMA: new Set(), dipPN: new Set() }
      const netto = parseFloat(c.netto) || 0
      const costo = parseFloat(c.costo_azienda) || (netto * COSTO_AZ_FALLBACK)
      if (c.sede === 'MA') { byMese[k].nettoMA += netto; byMese[k].costoMA += costo; byMese[k].dipMA.add(c.employee_name) }
      else                 { byMese[k].nettoPN += netto; byMese[k].costoPN += costo; byMese[k].dipPN.add(c.employee_name) }
    }
    return Object.entries(byMese).sort().map(([, v]) => ({
      ...v, dipMA: v.dipMA.size, dipPN: v.dipPN.size,
    }))
  }, [filtered])

  // Top 10 per costo az
  const topCosto = useMemo(() => {
    const byEmp = {}
    for (const c of filtered) {
      if (!byEmp[c.employee_name]) byEmp[c.employee_name] = { netto: 0, costo: 0, mesi: 0, sede: c.sede }
      byEmp[c.employee_name].netto += parseFloat(c.netto) || 0
      byEmp[c.employee_name].costo += parseFloat(c.costo_azienda) || 0
      byEmp[c.employee_name].mesi++
    }
    return Object.entries(byEmp)
      .map(([name, v]) => ({ name: name.split(' ').slice(0, 2).join(' '), ...v }))
      .sort((a, b) => b.costo - a.costo)
      .slice(0, 12)
  }, [filtered])

  // Distribuzione FT vs PT
  const ftPtData = useMemo(() => {
    const cats = {}
    const empSeen = {}
    for (const c of filtered) {
      if (empSeen[c.employee_name]) continue
      empSeen[c.employee_name] = true
      const pt = parseFloat(c.percentuale_pt)
      const cat = !c.percentuale_pt ? 'N/D' : pt >= 100 ? 'Full Time 100%' : pt >= 75 ? 'Part Time 75%' : pt >= 62 ? 'Part Time 62.5%' : pt >= 50 ? 'Part Time 50%' : 'Altro'
      if (!cats[cat]) cats[cat] = 0
      cats[cat]++
    }
    return Object.entries(cats).map(([name, n]) => ({ name, dipendenti: n }))
  }, [filtered])

  // Qualità dati
  const qualStats = useMemo(() => {
    const certi    = filtered.filter(c => qualitaDato(c) === 'certo')
    const parziali = filtered.filter(c => qualitaDato(c) === 'parziale')
    const stime    = filtered.filter(c => qualitaDato(c) === 'stima')
    const sumNetto = arr => arr.reduce((s, c) => s + (parseFloat(c.netto) || 0), 0)
    return [
      { label: 'Da PDF', n: certi.length,    netto: sumNetto(certi),    color: '#10b981' },
      { label: 'Da LUL', n: parziali.length, netto: sumNetto(parziali), color: '#f59e0b' },
      { label: 'Stima',  n: stime.length,    netto: sumNetto(stime),    color: '#ef4444' },
    ]
  }, [filtered])

  // Confronto sedi
  const sedeStats = useMemo(() => {
    const s = { MA: { netto: 0, costo: 0, lorda: 0, dip: new Set() }, PN: { netto: 0, costo: 0, lorda: 0, dip: new Set() } }
    for (const c of filtered) {
      const k = c.sede
      if (!s[k]) continue
      const netto = parseFloat(c.netto) || 0
      const costo = parseFloat(c.costo_azienda) || (netto * COSTO_AZ_FALLBACK)
      const lorda = parseFloat(c.totale_competenze) || 0
      s[k].netto += netto; s[k].costo += costo; s[k].lorda += lorda; s[k].dip.add(c.employee_name)
    }
    return [
      { sede: 'Mameli (MA)', ...s.MA, dip: s.MA.dip.size },
      { sede: 'Predda Niedda (PN)', ...s.PN, dip: s.PN.dip.size },
    ]
  }, [filtered])

  return (
    <div className="space-y-6">

      {/* Qualità dati */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
        <h3 className="font-semibold text-white mb-4 flex items-center gap-2"><ShieldCheck size={16}/> Qualità dati {anno}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          {qualStats.map(q => (
            <div key={q.label} className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: q.color }}></span>
                <p className="text-sm font-semibold text-white">{q.label}</p>
              </div>
              <p className="text-3xl font-bold text-white">{q.n}</p>
              <p className="text-xs text-gray-400 mt-1">cedolini</p>
              <p className="text-sm font-medium mt-2" style={{ color: q.color }}>{fmtEur0(q.netto)}</p>
              <p className="text-xs text-gray-500">netto totale</p>
            </div>
          ))}
        </div>
        <div className="bg-gray-900/30 rounded-lg px-4 py-2 text-xs text-gray-400">
          <strong className="text-gray-300">Come leggere:</strong>{' '}
          <span className="text-emerald-300">Da PDF</span> = cedolino individuale estratto (fonte certa) ·{' '}
          <span className="text-yellow-300">Da LUL</span> = netto/lorda dal Libro Unico Lavoro ·{' '}
          <span className="text-amber-300">Previsione</span> = media mesi precedenti, in attesa del cedolino ·{' '}
          <span className="text-red-300">Stima</span> = proiezione da inizio anno
        </div>
      </div>

      {/* Confronto sedi */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
        <h3 className="font-semibold text-white mb-4 flex items-center gap-2"><MapPin size={16}/> Confronto sedi</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {sedeStats.map(s => (
            <div key={s.sede} className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
              <p className="font-semibold text-white mb-3">{s.sede}</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center"><span className="text-gray-400">Dipendenti</span><span className="text-white font-bold text-lg">{s.dip}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Totale netto</span><span className="text-emerald-400 font-semibold">{fmtEur0(s.netto)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Totale lorda</span><span className="text-blue-400">{s.lorda > 0 ? fmtEur0(s.lorda) : '—'}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Costo aziendale</span><span className="text-purple-400 font-semibold">{fmtEur0(s.costo)}</span></div>
                <div className="flex justify-between border-t border-gray-700 pt-2"><span className="text-gray-400">Netto medio/dip</span><span className="text-white">{fmtEur0(s.dip > 0 ? s.netto / s.dip : 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Costo medio/dip</span><span className="text-white">{fmtEur0(s.dip > 0 ? s.costo / s.dip : 0)}</span></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Distribuzione contratti */}
      {ftPtData.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2"><Users size={16}/> Distribuzione contratti</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {ftPtData.map((row) => (
              <div key={row.name} className="bg-gray-900/50 rounded-lg p-3 text-center border border-gray-700">
                <p className="text-3xl font-bold text-white">{row.dipendenti}</p>
                <p className="text-xs text-gray-400 mt-1">{row.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top 12 costo */}
      {topCosto.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2"><TrendingUp size={16}/> Top dipendenti per costo aziendale {anno}</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={topCosto} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false}/>
              <XAxis type="number" stroke="#6b7280" tick={{ fontSize: 11 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`}/>
              <YAxis type="category" dataKey="name" width={130} stroke="#6b7280" tick={{ fontSize: 10 }}/>
              <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
                labelStyle={{ color: '#fff' }} formatter={v => fmtEur0(v)}/>
              <Legend wrapperStyle={{ fontSize: 11 }}/>
              <Bar dataKey="netto" fill="#10b981" name="Netto"/>
              <Bar dataKey="costo" fill="#8b5cf6" name="Costo Az."/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Trend mensile per sede */}
      {trendData.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2"><BarChart2 size={16}/> Trend mensile netto per sede — {anno}</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151"/>
              <XAxis dataKey="label" stroke="#6b7280" tick={{ fontSize: 12 }}/>
              <YAxis stroke="#6b7280" tick={{ fontSize: 12 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`}/>
              <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
                labelStyle={{ color: '#fff' }} formatter={v => fmtEur0(v)}/>
              <Legend wrapperStyle={{ fontSize: 11 }}/>
              <Bar dataKey="nettoMA" fill="#ef4444" name="Netto Mameli (MA)" stackId="netto"/>
              <Bar dataKey="nettoPN" fill="#f97316" name="Netto Predda N. (PN)" stackId="netto"/>
            </BarChart>
          </ResponsiveContainer>

          <div className="mt-4 flex justify-end">
            <BottoneCsv righe={trendData} colonne={COLONNE_CSV_TREND} nomeFile={`trend_personale_${anno}`} />
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="py-2 text-left text-gray-400">Mese</th>
                  <th className="py-2 text-right text-gray-400">Netto MA</th>
                  <th className="py-2 text-right text-gray-400">Netto PN</th>
                  <th className="py-2 text-right text-gray-400">Costo MA</th>
                  <th className="py-2 text-right text-gray-400">Costo PN</th>
                  <th className="py-2 text-right text-gray-400">Dip. MA</th>
                  <th className="py-2 text-right text-gray-400">Dip. PN</th>
                </tr>
              </thead>
              <tbody>
                {trendData.map((r) => (
                  // Chiave = mese: l'indice cambia appena un mese resta senza cedolini
                  <tr key={r.chiave} className="border-b border-gray-800 hover:bg-gray-800/30">
                    <td className="py-1.5 text-gray-300 font-medium">{r.label}</td>
                    <td className="py-1.5 text-right text-emerald-400">{fmtEur0(r.nettoMA)}</td>
                    <td className="py-1.5 text-right text-orange-400">{fmtEur0(r.nettoPN)}</td>
                    <td className="py-1.5 text-right text-purple-400">{fmtEur0(r.costoMA)}</td>
                    <td className="py-1.5 text-right text-indigo-400">{fmtEur0(r.costoPN)}</td>
                    <td className="py-1.5 text-right text-gray-300">{r.dipMA}</td>
                    <td className="py-1.5 text-right text-gray-300">{r.dipPN}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TFR Accumulato */}
      {(() => {
        const tfrByEmp = {}
        for (const c of filtered) {
          if (!c.tfr_mese) continue
          if (!tfrByEmp[c.employee_name]) tfrByEmp[c.employee_name] = { sede: c.sede, tfr: 0, mesi: 0 }
          tfrByEmp[c.employee_name].tfr  += parseFloat(c.tfr_mese) || 0
          tfrByEmp[c.employee_name].mesi++
        }
        const rows = Object.entries(tfrByEmp).sort((a, b) => b[1].tfr - a[1].tfr)
        if (rows.length === 0) return null
        const totMA = rows.filter(([,v]) => v.sede === 'MA').reduce((s,[,v]) => s + v.tfr, 0)
        const totPN = rows.filter(([,v]) => v.sede === 'PN').reduce((s,[,v]) => s + v.tfr, 0)
        return (
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
            <h3 className="font-semibold text-white mb-1 flex items-center gap-2">
              <DollarSign size={16} className="text-amber-400"/> TFR Accumulato {anno}
            </h3>
            <p className="text-xs text-gray-400 mb-4">Fondo TFR maturato nell'anno (accantonato per legge = 1/13.5 della retribuzione utile mensile)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
              <div className="bg-amber-900/20 border border-amber-800/40 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-amber-400">{fmtEur0(totMA + totPN)}</p>
                <p className="text-xs text-gray-400 mt-1">Totale TFR accantonato</p>
              </div>
              <div className="bg-red-900/20 border border-red-800/40 rounded-lg p-4 text-center">
                <p className="text-xl font-bold text-red-400">{fmtEur0(totMA)}</p>
                <p className="text-xs text-gray-400 mt-1">Mameli (MA)</p>
              </div>
              <div className="bg-blue-900/20 border border-blue-800/40 rounded-lg p-4 text-center">
                <p className="text-xl font-bold text-blue-400">{fmtEur0(totPN)}</p>
                <p className="text-xs text-gray-400 mt-1">Predda Niedda (PN)</p>
              </div>
            </div>
            <div className="bg-amber-900/10 rounded-lg px-4 py-2 text-xs text-amber-200/60">
              Il TFR è una passività aziendale — viene pagato al dipendente alla cessazione del rapporto di lavoro.
              Totale dipendenti con TFR estratto: <strong className="text-amber-300">{rows.length}</strong>
            </div>
          </div>
        )
      })()}

      {/* Analisi IRPEF */}
      {(() => {
        let irpefLordaTot = 0, irpefNettaTot = 0, imponibileTot = 0, contiIrpef = 0
        for (const c of filtered) {
          if (c.irpef_lorda) { irpefLordaTot += parseFloat(c.irpef_lorda); contiIrpef++ }
          if (c.irpef_netta)   irpefNettaTot  += parseFloat(c.irpef_netta)
          if (c.imponibile_fiscale) imponibileTot += parseFloat(c.imponibile_fiscale)
        }
        if (contiIrpef === 0) return null
        const aliquotaMedia = imponibileTot > 0 ? (irpefLordaTot / imponibileTot) * 100 : 0
        const detrazioniTot = irpefLordaTot - irpefNettaTot
        return (
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
            <h3 className="font-semibold text-white mb-1 flex items-center gap-2">
              <Activity size={16} className="text-rose-400"/> Analisi IRPEF {anno}
            </h3>
            <p className="text-xs text-gray-400 mb-4">Ritenute fiscali aggregate dai cedolini con dati estratti da PDF</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700 text-center">
                <p className="text-2xl font-bold text-rose-400">{fmtEur0(irpefLordaTot)}</p>
                <p className="text-xs text-gray-400 mt-1">IRPEF lorda totale</p>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700 text-center">
                <p className="text-2xl font-bold text-pink-400">{fmtEur0(irpefNettaTot)}</p>
                <p className="text-xs text-gray-400 mt-1">IRPEF netta totale</p>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700 text-center">
                <p className="text-2xl font-bold text-violet-400">{fmtEur0(detrazioniTot)}</p>
                <p className="text-xs text-gray-400 mt-1">Detrazioni totali</p>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700 text-center">
                <p className="text-2xl font-bold text-indigo-400">{aliquotaMedia.toFixed(1)}%</p>
                <p className="text-xs text-gray-400 mt-1">Aliquota media effettiva</p>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-3">Basato su {contiIrpef} cedolini con IRPEF estratta da PDF · Imponibile totale: {fmtEur0(imponibileTot)}</p>
          </div>
        )
      })()}

      {/* Ore lavorate per sede */}
      {(() => {
        const oreMA = filtered.filter(c => c.sede === 'MA' && c.ore_lavorate).reduce((s, c) => s + (parseInt(c.ore_lavorate) || 0), 0)
        const orePN = filtered.filter(c => c.sede === 'PN' && c.ore_lavorate).reduce((s, c) => s + (parseInt(c.ore_lavorate) || 0), 0)
        const contiOre = filtered.filter(c => c.ore_lavorate).length
        if (contiOre === 0) return null
        const costoOraMaArr = filtered.filter(c => c.sede === 'MA' && c.ore_lavorate && c.costo_azienda)
        const costoOreMA = costoOraMaArr.length > 0
          ? costoOraMaArr.reduce((s, c) => s + (parseFloat(c.costo_azienda) || 0), 0) / oreMA
          : 0
        const costoPNArr = filtered.filter(c => c.sede === 'PN' && c.ore_lavorate && c.costo_azienda)
        const costoOrePN = costoPNArr.length > 0
          ? costoPNArr.reduce((s, c) => s + (parseFloat(c.costo_azienda) || 0), 0) / orePN
          : 0
        return (
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
            <h3 className="font-semibold text-white mb-1 flex items-center gap-2">
              <Calendar size={16} className="text-sky-400"/> Ore Lavorate {anno}
            </h3>
            <p className="text-xs text-gray-400 mb-4">Ore effettive lavorate aggregate (da cedolini con estrazione PDF)</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700 text-center">
                <p className="text-2xl font-bold text-sky-400">{fmtNum(oreMA + orePN)}</p>
                <p className="text-xs text-gray-400 mt-1">Ore totali</p>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700 text-center">
                <p className="text-2xl font-bold text-red-400">{fmtNum(oreMA)}</p>
                <p className="text-xs text-gray-400 mt-1">Ore Mameli (MA)</p>
                {costoOreMA > 0 && <p className="text-xs text-gray-500 mt-1">{fmtEur(costoOreMA)}/ora</p>}
              </div>
              <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700 text-center">
                <p className="text-2xl font-bold text-blue-400">{fmtNum(orePN)}</p>
                <p className="text-xs text-gray-400 mt-1">Ore Predda N. (PN)</p>
                {costoOrePN > 0 && <p className="text-xs text-gray-500 mt-1">{fmtEur(costoOrePN)}/ora</p>}
              </div>
              <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700 text-center">
                <p className="text-2xl font-bold text-emerald-400">
                  {costoOreMA > 0 || costoOrePN > 0 ? fmtEur((costoOreMA + costoOrePN) / (costoOreMA && costoOrePN ? 2 : 1)) : '—'}
                </p>
                <p className="text-xs text-gray-400 mt-1">Costo medio/ora</p>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-3">{contiOre} cedolini con ore estratte da PDF</p>
          </div>
        )
      })()}

      {filtered.length === 0 && <p className="text-gray-400 text-center py-12">Nessun dato disponibile.</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — COSTO PERSONALE
// ═══════════════════════════════════════════════════════════════════════════
function CostoPersonaleTab({ costoMensile, sedeFilter }) {
  const { dato: bilancio } = useCostoPersonaleBilancio()
  const chartData = useMemo(() => {
    if (!costoMensile) return []
    return (sedeFilter === 'Tutte' ? costoMensile : costoMensile.filter(c => c.sede === sedeFilter))
      .sort((a, b) => `${a.anno}${String(a.mese).padStart(2,'0')}`.localeCompare(`${b.anno}${String(b.mese).padStart(2,'0')}`))
      .map(c => ({ label: `${MESI_SHORT[c.mese-1]} ${c.anno}`, netto: c.netto_totale || 0, costoAz: c.costo_totale || 0 }))
  }, [costoMensile, sedeFilter])

  const stats = useMemo(() => {
    if (!chartData.length) return { avg: 0, max: 0, min: 0 }
    const netti = chartData.map(c => c.netto)
    return { avg: netti.reduce((a,b) => a+b, 0)/netti.length, max: Math.max(...netti), min: Math.min(...netti) }
  }, [chartData])

  return (
    <div className="space-y-6">
      <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4 flex gap-2">
        <AlertCircle size={18} className="text-blue-400 flex-shrink-0 mt-0.5"/>
        <div className="text-sm text-blue-300">
          <p className="font-medium">Costo Aziendale — CCNL Turismo Pubblici Esercizi</p>
          {/* Anno e importi arrivano dal bilancio a DB: cablati nel testo,
              restavano fermi al 2025 anche dopo il deposito del bilancio nuovo. */}
          <p className="text-xs mt-0.5 opacity-80">
            Formula: costo = lorda × {CCNL_MOLT_LORDA} ({fmtPctIt((CCNL_MOLT_LORDA - 1) * 100)} di oneri c/azienda
            {bilancio
              ? `, ricavato dal costo del personale del bilancio ${bilancio.tipo} ${bilancio.anno}: ${fmtEur(bilancio.totale)} / ${fmtEur(bilancio.lorda)} = ${bilancio.moltiplicatore.toFixed(4)}`
              : ', ricavato dal rapporto costo totale personale / retribuzioni lorde dell\'ultimo bilancio'}
            ). Fallback: netto × {COSTO_AZ_FALLBACK} quando la lorda non è disponibile.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Media Mensile" value={fmtEur0(stats.avg)} color="green"/>
        <KpiCard label="Massimo Mensile" value={fmtEur0(stats.max)} color="purple"/>
        <KpiCard label="Minimo Mensile" value={fmtEur0(stats.min)} color="amber"/>
      </div>
      {chartData.length > 0 && (
        <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h3 className="text-lg font-semibold text-white">Trend Costi</h3>
            <BottoneCsv righe={chartData} colonne={COLONNE_CSV_COSTO} nomeFile={`costo_personale_${sedeFilter}`} />
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151"/>
              <XAxis dataKey="label" stroke="#9ca3af" tick={{ fontSize: 12 }}/>
              <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }}/>
              <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
                labelStyle={{ color: '#fff' }} formatter={v => fmtEur0(v)}/>
              <Legend/>
              <Line type="monotone" dataKey="netto"   stroke="#10b981" name="Netto"           strokeWidth={2} dot={{ r: 4 }}/>
              <Line type="monotone" dataKey="costoAz" stroke="#8b5cf6" name="Costo Aziendale" strokeWidth={2} dot={{ r: 4 }}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {chartData.length === 0 && <p className="text-gray-400 text-center py-12">Nessun dato disponibile.</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB — DETTAGLIO CEDOLINI
// ═══════════════════════════════════════════════════════════════════════════
function DettaglioCedoliniTab({ cedolini, sedeFilter, meseFilter, onRefresh, employees }) {
  const [search, setSearch]       = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editNetto, setEditNetto] = useState('')
  const [saving, setSaving]       = useState(null)
  const [showAdd, setShowAdd]     = useState(false)
  const [deleting, setDeleting]   = useState(null)
  const [erroreAzione, setErroreAzione] = useState(null)

  // Le colonne calcolate (netto/lorda/costo/fonte) diventano campi veri: solo
  // così l'ordinamento lavora sui numeri mostrati e non sulle stringhe grezze.
  const righe = useMemo(() => {
    if (!cedolini) return []
    return cedolini.filter(c => {
      if (sedeFilter !== 'Tutte' && c.sede !== sedeFilter) return false
      if (meseFilter > 0 && c.mese !== meseFilter) return false
      if (search && !(c.employee_name || '').toLowerCase().includes(search.toLowerCase())) return false
      return true
    }).map(c => {
      const netto = parseFloat(c.netto) || 0
      const lorda = parseFloat(c.totale_competenze) || 0
      return {
        ...c,
        periodo:   c.anno * 100 + c.mese,
        netto_num: netto,
        // null, non 0: un cedolino senza lorda non è un cedolino con lorda zero,
        // e useOrdinamento tiene i mancanti in coda in entrambe le direzioni.
        lorda_num: lorda > 0 ? lorda : null,
        costo_num: parseFloat(c.costo_azienda) || (netto * COSTO_AZ_FALLBACK),
        fonte:     QUALITY[qualitaDato(c)].label,
      }
    })
  }, [cedolini, sedeFilter, meseFilter, search])

  const { righeOrdinate: filtered, colonna, direzione, propsTh } = useOrdinamento(righe, 'periodo', 'desc')

  const TH = ({ col, children, align = 'left' }) => (
    <th {...propsTh(col)} className={`px-3 py-3 text-${align} font-semibold text-gray-300 cursor-pointer select-none hover:text-white`}>
      {children}<IconaOrdine colonna={col} colonnaAttiva={colonna} direzione={direzione} />
    </th>
  )

  // Prima salvataggio ed eliminazione finivano in console.error: l'utente vedeva
  // solo il valore tornare com'era, senza sapere che la scrittura era fallita.
  const saveNetto = async (id) => {
    setSaving(id); setErroreAzione(null)
    try {
      await bp.update(id, { netto: parseFloat(editNetto) })
      setEditingId(null); setEditNetto('')
      onRefresh()
    } catch(e) { setErroreAzione(`Salvataggio netto non riuscito: ${e?.message || e}`) }
    finally { setSaving(null) }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Eliminare questo cedolino?')) return
    setDeleting(id); setErroreAzione(null)
    try { await bp.delete(id); onRefresh() }
    catch(e) { setErroreAzione(`Eliminazione non riuscita: ${e?.message || e}`) }
    finally { setDeleting(null) }
  }

  return (
    <div className="space-y-4">
      {/* Nessun .catch qui: AddModal fa `await onSave(...)` dentro un try/catch e
          mostra l'errore inline tenendo la modale aperta. Intercettando l'errore
          a questo livello la promise tornerebbe risolta e onClose() scatterebbe
          comunque, facendo perdere all'utente i dati inseriti. */}
      {showAdd && <AddModal employees={employees} onSave={d => bp.insert(d).then(() => onRefresh())} onClose={() => setShowAdd(false)}/>}
      {erroreAzione && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 flex gap-2 text-sm text-red-300">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5"/>
          <div className="flex-1">{erroreAzione}</div>
          <button onClick={() => setErroreAzione(null)} className="opacity-60 hover:opacity-100"><X size={14}/></button>
        </div>
      )}
      <div className="flex gap-3 items-center">
        <input type="text" placeholder="Cerca dipendente..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <PlusCircle size={16}/> Aggiungi
        </button>
        <BottoneCsv righe={filtered} colonne={COLONNE_CSV_CEDOLINI} nomeFile="cedolini" />
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-800">
            <tr className="border-b border-gray-700">
              <TH col="employee_name">Dipendente</TH>
              <TH col="sede">Sede</TH>
              <TH col="periodo">Mese</TH>
              <TH col="netto_num" align="right">Netto</TH>
              <th {...propsTh('lorda_num')} className="px-3 py-3 text-right font-semibold text-gray-300 cursor-pointer select-none hover:text-white hidden md:table-cell">
                Lorda<IconaOrdine colonna="lorda_num" colonnaAttiva={colonna} direzione={direzione} />
              </th>
              <TH col="costo_num" align="right">Costo Az.</TH>
              <TH col="fonte" align="center">Fonte</TH>
              <th className="px-3 py-3 text-center font-semibold text-gray-300">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const netto   = c.netto_num
              const lorda   = c.lorda_num ?? 0
              const costoAz = c.costo_num
              return (
                // Chiave di dominio: la tabella è ordinabile e filtrabile, con
                // l'indice React riassocerebbe le righe sbagliate dopo un sort.
                <tr key={chiaveCedolino(c)} className="border-b border-gray-700 hover:bg-gray-800/50 transition">
                  <td className="px-3 py-3 text-white font-medium">{c.employee_name}</td>
                  <td className="px-3 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${c.sede === 'MA' ? 'bg-red-900/30 text-red-300' : 'bg-blue-900/30 text-blue-300'}`}>{c.sede}</span>
                  </td>
                  <td className="px-3 py-3 text-gray-300 whitespace-nowrap">{MESI_FULL[(c.mese||1)-1]} {c.anno}</td>
                  <td className="px-3 py-3 text-right">
                    {editingId === c.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <input type="number" step="0.01" min="0" autoFocus
                          value={editNetto} onChange={e => setEditNetto(e.target.value)}
                          onKeyDown={e => { if(e.key==='Enter') saveNetto(c.id); if(e.key==='Escape') setEditingId(null) }}
                          className="w-24 bg-gray-700 border border-blue-500 rounded px-2 py-0.5 text-white text-xs"/>
                        <button onClick={() => saveNetto(c.id)} disabled={saving===c.id} className="text-emerald-400 hover:text-emerald-300 text-xs font-bold px-1">✓</button>
                        <button onClick={() => setEditingId(null)} className="text-gray-500 hover:text-gray-300 text-xs px-1">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingId(c.id); setEditNetto(netto || '') }}
                        className={`font-medium ${netto > 0 ? 'text-emerald-400 hover:text-emerald-300' : 'text-gray-500 italic hover:text-blue-400'} transition-colors`}
                        title="Clicca per modificare">
                        {netto > 0 ? fmtEur(netto) : '+ inserisci'}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-blue-400 hidden md:table-cell">{lorda > 0 ? fmtEur(lorda) : <span className="text-gray-600">—</span>}</td>
                  <td className="px-3 py-3 text-right text-purple-400">{costoAz > 0 ? fmtEur(costoAz) : '—'}</td>
                  <td className="px-3 py-3 text-center"><QualityBadge c={c} small /></td>
                  <td className="px-3 py-3 text-center">
                    <button onClick={() => handleDelete(c.id)} disabled={deleting === c.id}
                      className="text-gray-600 hover:text-red-400 transition-colors" title="Elimina">
                      {deleting === c.id ? <RefreshCw size={14} className="animate-spin"/> : <Trash2 size={14}/>}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && <p className="text-gray-400 text-center py-12">Nessun cedolino. Usa "Aggiungi" per inserirne uno.</p>}
      {filtered.length > 0 && <p className="text-xs text-gray-500 text-center">Totale: {filtered.length} cedolini</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════
// Id delle tab (devono restare allineati alla costante TABS dentro il componente)
const TAB_IDS = ['riepilogo', 'dipendenti', 'analisi', 'costo', 'dettaglio']
// Alias per i link storici. `stato` era la vecchia rotta /dipendenti: puntava a
// una tab che in questa pagina non è MAI esistita, quindi /dipendenti apriva
// Buste Paga con l'area contenuti completamente vuota.
const TAB_ALIASES = { stato: 'dipendenti', anagrafica: 'dipendenti', cedolini: 'dettaglio', costi: 'costo' }

export default function BustePaga({ startTab = 'riepilogo' }) {
  const { sedi }                      = useSedi()
  const [anno,        setAnno]        = useState(new Date().getFullYear())
  const [meseFilter,  setMeseFilter]  = useState(0)
  const [sedeFilter,  setSedeFilter]  = useState('Tutte')
  const [activeTab,   setActiveTab]   = useTabParam(TAB_IDS, startTab, 'tab', TAB_ALIASES)

  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
    return () => clearTimeout(t)
  }, [activeTab])

  const [riepilogo,    setRiepilogo]    = useState([])
  const [costoMensile, setCostoMensile] = useState([])
  const [cedolini,     setCedolini]     = useState([])
  const [employees,    setEmployees]    = useState([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [syncing,      setSyncing]      = useState(false)
  const [syncResult,   setSyncResult]   = useState(null)

  // `attivo()` è la guardia di unmount/cambio-anno: le risposte che tornano
  // dopo che il componente è stato smontato (o dopo che l'utente ha già
  // cambiato anno) non devono più scrivere sullo stato.
  const loadData = useCallback(async (attivo = () => true) => {
    setLoading(true); setError(null)
    try {
      const [ried, costo, ced, emps] = await Promise.all([
        bp.riepilogo({ anno }),
        bp.costoMensile({ anno }),
        bp.getAll({ anno }),
        empApi.getAll({ active: 'true' }),
      ])
      if (!attivo()) return
      setRiepilogo(ried)
      setCostoMensile(costo)
      setCedolini(ced)
      setEmployees(emps.map(e => ({ ...e, sede: e.sede || (e.location === 'MAMELI' ? 'MA' : 'PN') })))
    } catch(e) {
      if (attivo()) setError(e.message || 'Errore caricamento dati')
    } finally { if (attivo()) setLoading(false) }
  }, [anno])

  useEffect(() => {
    let annullato = false
    loadData(() => !annullato)
    return () => { annullato = true }
  }, [loadData])

  // Il sync PDF passa dal server Express LOCALE (serve il filesystem del Mac):
  // in produzione su Vercel non è raggiungibile, quindi il pulsante è disabilitato.
  const isLocalHost = typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
  const LOCAL_API_URL = import.meta.env.VITE_LOCAL_API_URL || 'http://localhost:3001'
  const MSG_NO_LOCAL_SERVER = 'La sincronizzazione PDF richiede il server locale attivo sul Mac (Mac_Avvio.command). Non è disponibile dalla versione web.'

  const sincronizzaPDF = useCallback(async () => {
    if (!isLocalHost) { setSyncResult({ type: 'offline', msg: MSG_NO_LOCAL_SERVER }); return }
    setSyncing(true); setSyncResult(null)
    try {
      const res = await fetch(`${LOCAL_API_URL}/api/buste-paga/sincronizza-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anno }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Errore server (${res.status})`)
      }
      const data = await res.json()
      setSyncResult({ type: 'success', ...data })
      await loadData()
    } catch (e) {
      const msg = e?.message || ''
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('fetch') || msg.includes('Load failed')) {
        setSyncResult({ type: 'offline', msg: MSG_NO_LOCAL_SERVER })
      } else {
        setSyncResult({ type: 'error', msg })
      }
    } finally { setSyncing(false) }
  }, [anno, loadData, isLocalHost, LOCAL_API_URL])

  useEffect(() => {
    const onStorage = (e) => { if (e.key === 'crm_employee_updated') loadData() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [loadData])

  // Anni realmente presenti in buste_paga. L'anno selezionato resta comunque in
  // elenco: altrimenti, appena si apre un anno ancora senza cedolini, la tendina
  // mostrerebbe un valore che non è fra le opzioni.
  const { anni: anniDb, errore: erroreAnni } = useAnniDisponibili('buste_paga', 'anno', { tipo: 'anno' })
  const anniSelezionabili = useMemo(
    () => [...new Set([anno, ...anniDb])].sort((a, b) => b - a),
    [anno, anniDb]
  )

  // useSedi può tornare vuoto (tabella `sedi` non leggibile): in quel caso le
  // sedi si ricavano dai cedolini già caricati, così il filtro non resta muto.
  const sediOpzioni = useMemo(() => {
    const daHook = (sedi || [])
      .map(s => ({ codice: s.codice ?? s.code, nome: s.nome ?? s.name ?? s.codice ?? s.code }))
      .filter(s => s.codice)
    if (daHook.length) return daHook
    return [...new Set(cedolini.map(c => c.sede).filter(Boolean))]
      .sort()
      .map(codice => ({ codice, nome: codice }))
  }, [sedi, cedolini])

  const previsioneInfo = useMemo(() => {
    const relevant = cedolini.filter(c => {
      if (sedeFilter !== 'Tutte' && c.sede !== sedeFilter) return false
      if (meseFilter > 0 && c.mese !== meseFilter) return false
      return c.anno === anno && c.note && c.note.startsWith('Stima ')
    })
    if (relevant.length === 0) return null
    const months = [...new Set(relevant.map(c => c.mese))].sort((a,b) => a-b)
    const noteExample = relevant[0]?.note || ''
    // Estrae il metodo dal testo: "Stima maggio 2026 = media mesi 1-4 2026 (4 mesi)..."
    const metodo = noteExample.includes('=') ? noteExample.split('=')[1].split('.')[0].trim() : noteExample
    return { months, metodo, count: relevant.length }
  }, [cedolini, anno, meseFilter, sedeFilter])

  const TABS = [
    { id: 'riepilogo',  label: 'Riepilogo' },
    { id: 'dipendenti', label: 'Dipendenti' },
    { id: 'analisi',    label: 'BI Analisi' },
    { id: 'costo',      label: 'Trend Costi' },
    { id: 'dettaglio',  label: 'Cedolini' },
  ]

  return (
    <>
    <PageStatsWidget />
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3"><Activity size={28}/> Buste Paga</h1>
            <p className="text-gray-400 mt-1">Gestione cedolini · Schede dipendenti · BI analisi costi</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Arrow function obbligatoria: passando `loadData` diretto,
                l'evento click finirebbe nel parametro `attivo`. */}
            <button onClick={() => loadData()} disabled={loading || syncing}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-gray-200 px-3 py-2 rounded-lg text-sm font-medium transition-colors">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>
              {loading ? 'Carico...' : 'Ricarica'}
            </button>
            {/* Disabilitato fuori da localhost: richiede il server Express sul Mac */}
            <button onClick={sincronizzaPDF} disabled={loading || syncing || !isLocalHost}
              title={isLocalHost ? 'Sincronizza i PDF delle buste paga dal Mac' : MSG_NO_LOCAL_SERVER}
              className="flex items-center gap-2 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium transition-colors">
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''}/>
              {syncing ? 'Sincronizzazione...' : 'Sincronizza PDF'}
            </button>
          </div>
        </div>

        {/* Sync result */}
        {syncResult && (
          <div className={`mb-4 rounded-lg p-3 text-sm flex items-start gap-3 ${
            syncResult.type === 'success' ? 'bg-green-900/30 border border-green-700 text-green-300' :
            syncResult.type === 'offline' ? 'bg-yellow-900/30 border border-yellow-700 text-yellow-300' :
            'bg-red-900/30 border border-red-700 text-red-300'
          }`}>
            <div className="flex-1">
              {syncResult.type === 'success'
                ? `✅ Sync completato — ${syncResult.aggiornati} aggiornati, ${syncResult.saltati} saltati, ${syncResult.errori} errori`
                : syncResult.type === 'offline'
                ? `⚠️ ${syncResult.msg}`
                : `❌ ${syncResult.msg}`}
            </div>
            <button onClick={() => setSyncResult(null)} className="opacity-60 hover:opacity-100"><X size={14}/></button>
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-900/20 border border-red-800 rounded-lg p-4 flex gap-3">
            <AlertCircle size={20} className="text-red-400 flex-shrink-0"/>
            <div className="text-red-300 text-sm">{error}</div>
          </div>
        )}

        {/* Filtri */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2"><Calendar size={14}/> Anno</label>
            {/* Anni reali a DB, non un intervallo cablato: qui c'era 2023→oggi
                mentre la modale "Aggiungi cedolino" partiva dal 2024. */}
            <select value={anno} onChange={e => setAnno(Number(e.target.value))}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {anniSelezionabili.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            {erroreAnni && <p className="text-[11px] text-amber-400 mt-1">Anni da DB non leggibili ({erroreAnni}): elenco di ripiego.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2"><Calendar size={14}/> Mese</label>
            <select value={meseFilter} onChange={e => setMeseFilter(Number(e.target.value))}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value={0}>Tutti i mesi</option>
              {MESI_FULL.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2"><MapPin size={14}/> Sede</label>
            <select value={sedeFilter} onChange={e => setSedeFilter(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="Tutte">Tutte le sedi</option>
              {sediOpzioni.map(s => <option key={s.codice} value={s.codice}>{s.nome}</option>)}
            </select>
          </div>
        </div>

        {/* Banner dati previsionali */}
        {previsioneInfo && (
          <div className="mb-6 bg-amber-900/20 border border-amber-600/40 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle size={20} className="text-amber-400 flex-shrink-0 mt-0.5"/>
            <div className="flex-1 min-w-0">
              <p className="text-amber-300 font-semibold text-sm">
                ⚡ Dati previsionali —{' '}
                {previsioneInfo.months.map(m => MESI_FULL[m-1]).join(', ')} {anno}
              </p>
              <p className="text-amber-200/80 text-xs mt-1">
                <span className="font-medium">Metodo di calcolo:</span> {previsioneInfo.metodo}
              </p>
              <p className="text-amber-200/50 text-xs mt-0.5">
                I valori saranno sostituiti automaticamente con i dati reali quando il cedolino PDF sarà disponibile. Clicca "Sincronizza PDF" dopo aver caricato il LUL.
              </p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap gap-2">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${activeTab === t.id ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex flex-col gap-4 mt-4">
            {[1,2,3].map(i => <div key={i} className="h-24 rounded-xl bg-gray-700/50 animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="mt-4 p-4 rounded-xl bg-red-900/30 text-red-400 text-sm">{error}</div>
        ) : (
          <>
            {activeTab === 'riepilogo'  && <RiepilogoTab anno={anno} mese={meseFilter} sedeFilter={sedeFilter} riepilogo={riepilogo}/>}
            {activeTab === 'dipendenti' && <DipendentiTab cedolini={cedolini} sedeFilter={sedeFilter} anno={anno} employees={employees} onRefresh={loadData}/>}
            {activeTab === 'analisi'    && <AnalisiTab cedolini={cedolini} sedeFilter={sedeFilter} anno={anno}/>}
            {activeTab === 'costo'      && <CostoPersonaleTab costoMensile={costoMensile} sedeFilter={sedeFilter}/>}
            {activeTab === 'dettaglio'  && <DettaglioCedoliniTab cedolini={cedolini} sedeFilter={sedeFilter} meseFilter={meseFilter} onRefresh={loadData} employees={employees}/>}
          </>
        )}
      </div>
    </div>
    <PageAssistant
      pagina="Buste Paga"
      suggerimenti={[
        "Qual è il costo totale del personale questo mese?",
        "Mostrami la scheda di un dipendente specifico",
        "Quanti cedolini sono certi vs stima?",
        "Confronto costi Mameli vs Predda Niedda",
      ]}
    />
    </>
  )
}
