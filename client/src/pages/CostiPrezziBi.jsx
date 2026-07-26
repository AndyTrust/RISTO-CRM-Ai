/**
 * CostiPrezziBi.jsx — Costi & Prezzi BI
 *
 * Nasce dai dati arrivati con lo storico esteso: 14.750 fatture dal giugno 2019
 * e soprattutto 114.650 RIGHE di dettaglio (articolo, quantità, unità di misura,
 * prezzo unitario, categoria merceologica). Prima le fatture erano leggibili
 * solo per testata, quindi le domande più utili — "quanto è aumentato quel
 * prodotto", "chi me lo vende meglio", "quanto pesa ogni categoria su ogni
 * sede" — non erano nemmeno formulabili.
 *
 * Quattro sezioni, ognuna con un URL proprio (sotto-route, non query param,
 * come già fatto per /bilanci):
 *
 *   /costi-prezzi                → Marginalità per sede: diretti vs struttura
 *   /costi-prezzi/prezzi         → Prezzi per articolo e confronto fornitori
 *   /costi-prezzi/merceologico   → Spesa per categoria merceologica
 *   /costi-prezzi/storico        → Sette anni: trend e stagionalità
 *
 * Convenzioni rispettate ovunque:
 *  • Gli importi da `fatture_righe` sono NETTI IVA; i corrispettivi sono lordi
 *    e vengono scorporati al 10% prima di qualunque confronto.
 *  • "Zero" e "non disponibile" non si assomigliano: i valori mancanti sono
 *    '—', mai 0, e le percentuali non calcolabili sono null.
 *  • Le fatture 2019-2024 non hanno sede: ogni sezione che divide per sede lo
 *    dichiara invece di far sparire i dati.
 */
import { useState, useEffect, useMemo } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import {
  Scale, Tags, TrendingUp, History, AlertTriangle, Info, Search,
  ArrowRight, Loader2, X,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, ReferenceLine, ComposedChart, Area,
} from 'recharts'
import { analisiCostiApi } from '../api/client'
import {
  fmtEur, fmtNum, fmtPct, useOrdinamento, IconaOrdine, BottoneCsv, NotaCopertura,
} from '../lib/tabella'

// ── Sezioni ────────────────────────────────────────────────────────────────
const SEZIONI = [
  { id: 'marginalita',  path: '/costi-prezzi',              label: 'Marginalità sedi',  icon: Scale,      exact: true },
  { id: 'prezzi',       path: '/costi-prezzi/prezzi',       label: 'Prezzi articoli',   icon: TrendingUp },
  { id: 'merceologico', path: '/costi-prezzi/merceologico', label: 'Merceologico',      icon: Tags },
  { id: 'storico',      path: '/costi-prezzi/storico',      label: '7 anni',            icon: History },
]

const COLORI_MACRO = {
  FOOD: '#ef4444', BEVERAGE: '#8b5cf6', CONSUMO: '#f59e0b',
  STRUTTURA: '#0ea5e9', COMMISSIONI: '#ec4899', ALTRO: '#94a3b8', IGNOTO: '#64748b',
}
const COLORE_SEDE = { MA: '#6366f1', PN: '#10b981' }

const pad = n => String(n).padStart(2, '0')
/** Data locale in ISO, senza passare da toISOString() che converte in UTC. */
const isoLocale = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** Ultimo giorno del mese, calcolato — mai `-31`, che su feb/apr/giu/set/nov è una data inesistente. */
const fineMese = (anno, mese) => `${anno}-${pad(mese)}-${pad(new Date(anno, mese, 0).getDate())}`
const meseIt = m => {
  if (!m) return '—'
  const [a, ms] = String(m).split('-')
  return `${['', 'gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'][Number(ms)] || ms} ${String(a).slice(2)}`
}
const dataIt = d => (d || '').slice(0, 10).split('-').reverse().join('/')

// ── Componenti condivisi ───────────────────────────────────────────────────
function Kpi({ label, value, sub, tono = 'neutro', grande = false }) {
  const toni = {
    neutro:   'bg-white border-gray-200 text-gray-900',
    positivo: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    negativo: 'bg-red-50 border-red-200 text-red-800',
    attenzione: 'bg-amber-50 border-amber-200 text-amber-800',
    assente:  'bg-gray-50 border-dashed border-gray-300 text-gray-400',
  }
  return (
    <div className={`rounded-xl border p-4 ${toni[tono]}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-60 font-semibold">{label}</p>
      <p className={`font-bold mt-1 ${grande ? 'text-2xl' : 'text-xl'}`}>{value}</p>
      {sub && <p className="text-[11px] opacity-70 mt-0.5">{sub}</p>}
    </div>
  )
}

function Avviso({ tipo = 'info', children }) {
  const stili = {
    info:  'bg-blue-50 border-blue-200 text-blue-800',
    warn:  'bg-amber-50 border-amber-200 text-amber-900',
    error: 'bg-red-50 border-red-200 text-red-800',
  }
  const Icona = tipo === 'info' ? Info : AlertTriangle
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${stili[tipo]}`}>
      <Icona size={14} className="flex-shrink-0 mt-0.5" />
      <div className="leading-relaxed">{children}</div>
    </div>
  )
}

function Caricamento({ testo = 'Carico i dati…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-gray-400 text-sm">
      <Loader2 size={16} className="animate-spin" /> {testo}
    </div>
  )
}

function Sezione({ titolo, sottotitolo, azioni, children }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4">
      <header className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-bold text-gray-800">{titolo}</h3>
          {sottotitolo && <p className="text-xs text-gray-500 mt-0.5">{sottotitolo}</p>}
        </div>
        {azioni && <div className="flex items-center gap-2 flex-shrink-0">{azioni}</div>}
      </header>
      {children}
    </section>
  )
}

/** Selettore di periodo su tutto lo storico: mese di inizio → mese di fine. */
function SelettorePeriodo({ da, a, onChange, minAnno = 2019 }) {
  const annoOggi = new Date().getFullYear()
  const anni = []
  for (let y = annoOggi; y >= minAnno; y--) anni.push(y)
  const set = (chiave) => (e) => onChange({ da, a, [chiave]: e.target.value })
  return (
    <div className="flex items-end gap-3 flex-wrap">
      <div>
        <label className="block text-[11px] font-medium text-gray-500 mb-1">Dal mese</label>
        <input type="month" value={da.slice(0, 7)} min={`${minAnno}-01`}
          onChange={e => onChange({ da: `${e.target.value}-01`, a })}
          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
      </div>
      <div>
        <label className="block text-[11px] font-medium text-gray-500 mb-1">Al mese</label>
        <input type="month" value={a.slice(0, 7)}
          onChange={e => {
            const [y, m] = e.target.value.split('-').map(Number)
            onChange({ da, a: fineMese(y, m) })
          }}
          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
      </div>
      <div className="flex gap-1.5">
        {[
          { l: '12 mesi', m: 12 }, { l: '24 mesi', m: 24 }, { l: '3 anni', m: 36 },
        ].map(p => (
          <button key={p.m} type="button"
            onClick={() => {
              const oggi = new Date()
              const inizio = new Date(oggi.getFullYear(), oggi.getMonth() - (p.m - 1), 1)
              onChange({ da: isoLocale(inizio), a: isoLocale(oggi) })
            }}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:border-indigo-400 hover:text-indigo-600">
            {p.l}
          </button>
        ))}
        <button type="button"
          onClick={() => onChange({ da: `${minAnno}-01-01`, a: isoLocale(new Date()) })}
          className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:border-indigo-400 hover:text-indigo-600">
          Tutto
        </button>
      </div>
      {/* Il carico non è indifferente: fatture_righe ha 114.650 righe e il cap
          PostgREST è 1000, quindi "Tutto" significa oltre cento richieste. */}
      <span className="text-[11px] text-gray-400 mb-1.5">periodi lunghi = caricamento più lento</span>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 1. MARGINALITÀ PER SEDE
// ════════════════════════════════════════════════════════════════════════════
function VoceCE({ etichetta, ma, pn, pctMa, pctPn, tipo = 'costo', nota }) {
  const stile = tipo === 'totale' ? 'font-bold border-t-2 border-gray-300'
    : tipo === 'ricavo' ? 'font-semibold'
    : ''
  const colora = (v) => {
    if (tipo !== 'totale' || v == null) return ''
    return v >= 0 ? 'text-emerald-700' : 'text-red-700'
  }
  return (
    <tr className={`border-b border-gray-100 ${stile}`}>
      <td className="py-2 pr-3">
        {etichetta}
        {nota && <span className="block text-[10px] font-normal text-gray-400 leading-tight">{nota}</span>}
      </td>
      <td className={`py-2 px-2 text-right tabular-nums ${colora(ma)}`}>{fmtEur(ma)}</td>
      <td className="py-2 pr-3 text-right text-[11px] text-gray-400 tabular-nums">{fmtPct(pctMa)}</td>
      <td className={`py-2 px-2 text-right tabular-nums ${colora(pn)}`}>{fmtEur(pn)}</td>
      <td className="py-2 text-right text-[11px] text-gray-400 tabular-nums">{fmtPct(pctPn)}</td>
    </tr>
  )
}

function SezioneMarginalita() {
  const oggi = new Date()
  const [periodo, setPeriodo] = useState(() => ({
    da: `${oggi.getFullYear()}-01-01`,
    a: isoLocale(oggi),
  }))
  const [dati, setDati] = useState(null)
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    let annullato = false
    setCaricamento(true); setErrore(null)
    analisiCostiApi.marginalitaSedi(periodo)
      .then(r => { if (!annullato) setDati(r) })
      .catch(e => { if (!annullato) { setErrore(e?.message || String(e)); setDati(null) } })
      .finally(() => { if (!annullato) setCaricamento(false) })
    return () => { annullato = true }
  }, [periodo])

  const MA = dati?.sedi?.MA, PN = dati?.sedi?.PN
  const graficoMensile = useMemo(() => (dati?.mensile ?? []).map(m => ({
    mese: meseIt(m.mese),
    'Margine MA': Math.round(m.MA.margineSede),
    'Margine PN': Math.round(m.PN.margineSede),
    'Struttura su MA': -Math.round(m.MA.persCentrale),
  })), [dati])

  const reparti = useMemo(() => {
    if (!MA || !PN) return []
    const nomi = new Set([...Object.keys(MA.dettaglioReparti), ...Object.keys(PN.dettaglioReparti)])
    return [...nomi]
      .map(nome => ({ nome, MA: MA.dettaglioReparti[nome] ?? null, PN: PN.dettaglioReparti[nome] ?? null }))
      .sort((a, b) => ((b.MA ?? 0) + (b.PN ?? 0)) - ((a.MA ?? 0) + (a.PN ?? 0)))
  }, [MA, PN])

  if (caricamento) return <Caricamento testo="Ricostruisco il conto economico per sede…" />
  if (errore) return <Avviso tipo="error">Impossibile calcolare la marginalità: {errore}</Avviso>
  if (!MA || !PN) return <Avviso tipo="warn">Nessun dato per il periodo selezionato.</Avviso>

  const divarioStruttura = MA.persCentrale - PN.persCentrale

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <SelettorePeriodo da={periodo.da} a={periodo.a} onChange={setPeriodo} />
      </div>

      <Avviso tipo="info">
        <strong>Come è costruito.</strong> Tutto al <strong>netto IVA</strong>: i corrispettivi
        sono scorporati al 10%, i costi fornitori sono la somma di <code>fatture_righe.importo_riga</code>,
        che è già netta. Il personale è il costo azienda dei cedolini, diviso per reparto.
        Il <em>margine di sede</em> si ferma ai costi che il locale genera davvero; il{' '}
        <em>risultato</em> aggiunge Amministrazione e Marketing, cioè la struttura che serve
        entrambi i locali ma è contabilizzata su una sola sede.
        {dati.righeFattSenzaSede > 0 && (
          <> Nel periodo <strong>{fmtNum(dati.righeFattSenzaSede)} righe fattura non hanno sede</strong>{' '}
          e quindi non sono attribuite a nessuno dei due locali (riguarda le fatture ante 2025).</>
        )}
      </Avviso>

      {/* Il fatto economico, detto una volta sola e in chiaro */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi grande label="Risultato Mameli" value={fmtEur(MA.risultato)}
          sub={`${fmtPct(MA.risultatoPct)} dei ricavi netti`}
          tono={MA.risultato >= 0 ? 'positivo' : 'negativo'} />
        <Kpi grande label="Risultato Predda Niedda" value={fmtEur(PN.risultato)}
          sub={`${fmtPct(PN.risultatoPct)} dei ricavi netti`}
          tono={PN.risultato >= 0 ? 'positivo' : 'negativo'} />
        <Kpi label="Margine di sede Mameli" value={fmtEur(MA.margineSede)}
          sub="prima della struttura centrale"
          tono={MA.margineSede >= 0 ? 'positivo' : 'attenzione'} />
        <Kpi label="Struttura centrale su Mameli" value={fmtEur(MA.persCentrale)}
          sub={divarioStruttura !== 0 ? `su Predda Niedda: ${fmtEur(PN.persCentrale)}` : null}
          tono="attenzione" />
      </div>

      <Sezione
        titolo="Conto economico gestionale per sede"
        sottotitolo={`${dataIt(periodo.da)} → ${dataIt(periodo.a)} · valori netti IVA`}
        azioni={
          <BottoneCsv
            nomeFile="marginalita_sedi"
            righe={[
              { voce: 'Ricavi netti', ma: MA.ricaviNetti, pn: PN.ricaviNetti },
              { voce: 'Acquisti da fornitori', ma: -MA.fornitori, pn: -PN.fornitori },
              { voce: 'Personale di sede', ma: -MA.personaleSede, pn: -PN.personaleSede },
              { voce: 'Costi fissi', ma: -MA.fissi, pn: -PN.fissi },
              { voce: 'Margine di sede', ma: MA.margineSede, pn: PN.margineSede },
              { voce: 'Struttura centrale', ma: -MA.persCentrale, pn: -PN.persCentrale },
              { voce: 'Risultato', ma: MA.risultato, pn: PN.risultato },
            ]}
            colonne={[
              { chiave: 'voce', etichetta: 'Voce' },
              { chiave: 'ma', etichetta: 'Mameli' },
              { chiave: 'pn', etichetta: 'Predda Niedda' },
            ]} />
        }>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200 text-left text-xs text-gray-500">
                <th className="py-2 pr-3 font-semibold">Voce</th>
                <th className="py-2 px-2 text-right font-semibold" style={{ color: COLORE_SEDE.MA }}>Mameli</th>
                <th className="py-2 pr-3 text-right font-normal">%</th>
                <th className="py-2 px-2 text-right font-semibold" style={{ color: COLORE_SEDE.PN }}>Predda Niedda</th>
                <th className="py-2 text-right font-normal">%</th>
              </tr>
            </thead>
            <tbody>
              <VoceCE etichetta="Ricavi netti" tipo="ricavo"
                ma={MA.ricaviNetti} pn={PN.ricaviNetti} pctMa={100} pctPn={100}
                nota={`${fmtNum(MA.giorni)} / ${fmtNum(PN.giorni)} giornate di chiusura cassa`} />
              <VoceCE etichetta="Acquisti da fornitori" nota="somma delle righe fattura, netto IVA"
                ma={-MA.fornitori} pn={-PN.fornitori} pctMa={-MA.fornitoriPct} pctPn={-PN.fornitoriPct} />
              <VoceCE etichetta="Personale di sala e cucina"
                ma={-MA.persDiretto} pn={-PN.persDiretto}
                pctMa={MA.ricaviNetti ? -(MA.persDiretto / MA.ricaviNetti) * 100 : null}
                pctPn={PN.ricaviNetti ? -(PN.persDiretto / PN.ricaviNetti) * 100 : null} />
              <VoceCE etichetta="Personale senza reparto assegnato"
                nota="non attribuito d'ufficio al diretto: è un dato da completare, non un costo di sala"
                ma={-MA.persNonAssegnato} pn={-PN.persNonAssegnato}
                pctMa={MA.ricaviNetti ? -(MA.persNonAssegnato / MA.ricaviNetti) * 100 : null}
                pctPn={PN.ricaviNetti ? -(PN.persNonAssegnato / PN.ricaviNetti) * 100 : null} />
              {(MA.persStima > 0 || PN.persStima > 0) && (
                <VoceCE etichetta="Personale del mese in corso (stima)"
                  nota="cedolini non ancora emessi: stima sulla media dei mesi chiusi, sostituita quando arriva il LUL"
                  ma={-MA.persStima} pn={-PN.persStima}
                  pctMa={-MA.persStimaPct} pctPn={-PN.persStimaPct} />
              )}
              <VoceCE etichetta="Costi fissi" nota="affitti, utenze e oneri censiti in Costi Fissi"
                ma={-MA.fissi} pn={-PN.fissi} pctMa={-MA.fissiPct} pctPn={-PN.fissiPct} />
              <VoceCE etichetta="MARGINE DI SEDE" tipo="totale"
                ma={MA.margineSede} pn={PN.margineSede}
                pctMa={MA.margineSedePct} pctPn={PN.margineSedePct} />
              <VoceCE etichetta="Struttura centrale (Amministrazione + Marketing)"
                nota="personale che serve entrambi i locali"
                ma={-MA.persCentrale} pn={-PN.persCentrale}
                pctMa={-MA.personaleCentralePct} pctPn={-PN.personaleCentralePct} />
              <VoceCE etichetta="RISULTATO" tipo="totale"
                ma={MA.risultato} pn={PN.risultato}
                pctMa={MA.risultatoPct} pctPn={PN.risultatoPct} />
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid md:grid-cols-3 gap-3 text-xs">
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <p className="font-semibold text-gray-700 mb-1">Costo del personale</p>
            <p className="text-gray-600 leading-relaxed">
              Mameli <strong>{fmtPct(MA.ricaviNetti ? (MA.personaleTotale / MA.ricaviNetti) * 100 : null)}</strong> dei
              ricavi netti, Predda Niedda <strong>{fmtPct(PN.ricaviNetti ? (PN.personaleTotale / PN.ricaviNetti) * 100 : null)}</strong>.
              È qui la differenza fra le due sedi, non nel food cost.
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <p className="font-semibold text-gray-700 mb-1">Acquisti fornitori</p>
            <p className="text-gray-600 leading-relaxed">
              Mameli <strong>{fmtPct(MA.fornitoriPct)}</strong>, Predda Niedda{' '}
              <strong>{fmtPct(PN.fornitoriPct)}</strong> dei ricavi netti. Include tutte le
              categorie, non solo il food: per il solo food usa la sezione Merceologico.
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <p className="font-semibold text-gray-700 mb-1">Prime cost</p>
            <p className="text-gray-600 leading-relaxed">
              Mameli <strong>{fmtPct(MA.primeCostPct)}</strong>, Predda Niedda{' '}
              <strong>{fmtPct(PN.primeCostPct)}</strong> (acquisti + personale di sede,
              esclusa la struttura centrale).
            </p>
          </div>
        </div>
      </Sezione>

      <Sezione titolo="Margine di sede mese per mese"
        sottotitolo="le barre sono il margine prima della struttura; la linea è quanto la struttura centrale sottrae a Mameli">
        {graficoMensile.length === 0
          ? <p className="text-sm text-gray-400 py-8 text-center">Nessun mese nel periodo.</p>
          : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={graficoMensile}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v, n) => [fmtEur(v), n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#94a3b8" />
                <Bar dataKey="Margine MA" fill={COLORE_SEDE.MA} radius={[3, 3, 0, 0]} />
                <Bar dataKey="Margine PN" fill={COLORE_SEDE.PN} radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="Struttura su MA" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
      </Sezione>

      <Sezione titolo="Costo del personale per reparto"
        sottotitolo="da buste_paga × reparto del dipendente; il costo azienda è quello dei cedolini"
        azioni={<BottoneCsv righe={reparti} nomeFile="personale_per_reparto"
          colonne={[
            { chiave: 'nome', etichetta: 'Reparto' },
            { chiave: 'MA', etichetta: 'Mameli' },
            { chiave: 'PN', etichetta: 'Predda Niedda' },
          ]} />}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
              <th className="py-2 font-semibold">Reparto</th>
              <th className="py-2 text-right font-semibold">Mameli</th>
              <th className="py-2 text-right font-semibold">Predda Niedda</th>
              <th className="py-2 text-right font-semibold">Totale</th>
            </tr>
          </thead>
          <tbody>
            {reparti.map(r => (
              <tr key={r.nome} className="border-b border-gray-50">
                <td className="py-1.5">
                  {r.nome}
                  {(r.nome === 'Amministrazione' || r.nome === 'Marketing') && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                      struttura centrale
                    </span>
                  )}
                  {r.nome.includes('non assegnato') && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
                      da classificare
                    </span>
                  )}
                </td>
                {/* null → '—': un reparto assente da una sede non è un reparto che costa zero */}
                <td className="py-1.5 text-right tabular-nums">{fmtEur(r.MA)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmtEur(r.PN)}</td>
                <td className="py-1.5 text-right tabular-nums font-medium">{fmtEur((r.MA ?? 0) + (r.PN ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <NotaCopertura righe={dati.righeFattLette} da={dataIt(periodo.da)} a={dataIt(periodo.a)}
          fonte="chiusure_giornaliere · fatture_righe · buste_paga · costi_fissi"
          troncato={dati.troncato} />
      </Sezione>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 2. PREZZI PER ARTICOLO
// ════════════════════════════════════════════════════════════════════════════
function DettaglioArticolo({ articolo, periodo, onChiudi }) {
  const [storico, setStorico] = useState(null)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    let annullato = false
    setStorico(null); setErrore(null)
    analisiCostiApi.storicoArticolo({ nome: articolo.nome, from: periodo.da, to: periodo.a })
      .then(r => { if (!annullato) setStorico(r) })
      .catch(e => { if (!annullato) setErrore(e?.message || String(e)) })
    return () => { annullato = true }
  }, [articolo.nome, periodo.da, periodo.a])

  // Una serie per fornitore: è l'unico modo per vedere se un rincaro è di
  // mercato (salgono tutti) o di fornitore (sale uno solo).
  const serie = useMemo(() => {
    if (!storico) return { punti: [], fornitori: [] }
    const fornitori = [...new Set(storico.map(r => r.fornitore || '(ignoto)'))]
    const perData = new Map()
    for (const r of storico) {
      const d = r.data_fattura
      if (!perData.has(d)) perData.set(d, { data: d })
      perData.get(d)[r.fornitore || '(ignoto)'] = Number(r.prezzo_unitario)
    }
    return { punti: [...perData.values()].sort((a, b) => a.data.localeCompare(b.data)), fornitori }
  }, [storico])

  const palette = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9']

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onChiudi}>
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[88vh] overflow-y-auto p-5"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="font-bold text-gray-900">{articolo.descrizione || articolo.nome}</h3>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{articolo.nome}</p>
            <p className="text-xs text-gray-500 mt-1">
              {articolo.categoria} · {fmtNum(articolo.acquisti)} acquisti ·{' '}
              {articolo.nFornitori} fornitor{articolo.nFornitori === 1 ? 'e' : 'i'} ·
              spesa {fmtEur(articolo.spesa)} <span className="text-gray-400">netto IVA</span>
            </p>
          </div>
          <button onClick={onChiudi} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          <Kpi label="Primo prezzo" value={fmtEur(articolo.primoPrezzo, { decimali: 2 })} sub={dataIt(articolo.primaData)} />
          <Kpi label="Ultimo prezzo" value={fmtEur(articolo.ultimoPrezzo, { decimali: 2 })} sub={dataIt(articolo.ultimaData)} />
          <Kpi label="Variazione" value={fmtPct(articolo.variazionePct, { segno: true })}
            tono={articolo.variazionePct == null ? 'assente' : articolo.variazionePct > 5 ? 'negativo' : articolo.variazionePct < -5 ? 'positivo' : 'neutro'} />
          <Kpi label="Min → Max pagato"
            value={`${fmtEur(articolo.prezzoMin, { decimali: 2 })} → ${fmtEur(articolo.prezzoMax, { decimali: 2 })}`}
            sub={articolo.escursionePct != null ? `escursione ${fmtPct(articolo.escursionePct)}` : null} />
        </div>

        {errore && <Avviso tipo="error">Storico non disponibile: {errore}</Avviso>}
        {!storico && !errore && <Caricamento testo="Carico lo storico prezzi…" />}

        {storico && serie.punti.length > 0 && (
          <div className="mb-4">
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={serie.punti}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="data" tick={{ fontSize: 10 }} tickFormatter={dataIt} minTickGap={30} />
                <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                <Tooltip labelFormatter={dataIt} formatter={v => fmtEur(v, { decimali: 2 })} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {serie.fornitori.map((f, i) => (
                  <Line key={f} type="monotone" dataKey={f} stroke={palette[i % palette.length]}
                    strokeWidth={2} dot={{ r: 2 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <h4 className="text-xs font-bold text-gray-700 mb-2">Confronto fra fornitori</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
              <th className="py-1.5 font-semibold">Fornitore</th>
              <th className="py-1.5 text-right font-semibold">Acquisti</th>
              <th className="py-1.5 text-right font-semibold">Prezzo medio</th>
              <th className="py-1.5 text-right font-semibold">Miglior prezzo</th>
              <th className="py-1.5 text-right font-semibold">Ultimo</th>
              <th className="py-1.5 text-right font-semibold">Spesa</th>
            </tr>
          </thead>
          <tbody>
            {articolo.fornitori.map(f => {
              const migliore = f.fornitore === articolo.migliorFornitore && articolo.nFornitori > 1
              return (
                <tr key={f.fornitore} className={`border-b border-gray-50 ${migliore ? 'bg-emerald-50/60' : ''}`}>
                  <td className="py-1.5">
                    {f.fornitore}
                    {migliore && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">più conveniente</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{fmtNum(f.acquisti)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtEur(f.prezzoMedio, { decimali: 2 })}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-500">{fmtEur(f.prezzoMin, { decimali: 2 })}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {fmtEur(f.ultimoPrezzo, { decimali: 2 })}
                    <span className="block text-[10px] text-gray-400">{dataIt(f.ultimaData)}</span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{fmtEur(f.spesa)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {articolo.nFornitori === 1 && (
          <p className="text-[11px] text-gray-400 mt-2">
            Un solo fornitore nel periodo: non c'è nulla da confrontare, e un "risparmio
            potenziale" sarebbe un numero inventato.
          </p>
        )}
      </div>
    </div>
  )
}

function SezionePrezzi() {
  const oggi = new Date()
  const [periodo, setPeriodo] = useState(() => ({
    da: isoLocale(new Date(oggi.getFullYear() - 1, oggi.getMonth(), 1)),
    a: isoLocale(oggi),
  }))
  const [filtri, setFiltri] = useState({ categoria: 'ALL', search: '', minAcquisti: 3 })
  const [ricerca, setRicerca] = useState('')
  const [dati, setDati] = useState(null)
  const [categorie, setCategorie] = useState([])
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState(null)
  const [aperto, setAperto] = useState(null)

  useEffect(() => {
    let annullato = false
    analisiCostiApi.categorie()
      .then(c => { if (!annullato) setCategorie(c) })
      .catch(() => { /* la tendina resta su "tutte": non è un guasto bloccante */ })
    return () => { annullato = true }
  }, [])

  useEffect(() => {
    let annullato = false
    setCaricamento(true); setErrore(null)
    analisiCostiApi.prezziArticoli({
      from: periodo.da, to: periodo.a,
      categoria: filtri.categoria, minAcquisti: filtri.minAcquisti,
    })
      .then(r => { if (!annullato) setDati(r) })
      .catch(e => { if (!annullato) { setErrore(e?.message || String(e)); setDati(null) } })
      .finally(() => { if (!annullato) setCaricamento(false) })
    return () => { annullato = true }
  }, [periodo, filtri.categoria, filtri.minAcquisti])

  const filtrati = useMemo(() => {
    const q = ricerca.trim().toUpperCase()
    const base = dati?.articoli ?? []
    return q ? base.filter(a =>
      String(a.nome).toUpperCase().includes(q) ||
      String(a.descrizione || '').toUpperCase().includes(q)
    ) : base
  }, [dati, ricerca])

  const { righeOrdinate, colonna, direzione, propsTh } = useOrdinamento(filtrati, 'spesa', 'desc')

  const rincari = useMemo(() =>
    (dati?.articoli ?? [])
      .filter(a => a.variazionePct != null && a.variazionePct > 0 && a.spesa > 300)
      .sort((a, b) => b.variazionePct - a.variazionePct)
      .slice(0, 8), [dati])

  const colonneCsv = [
    { chiave: 'nome', etichetta: 'Articolo' },
    { chiave: 'descrizione', etichetta: 'Descrizione' },
    { chiave: 'categoria', etichetta: 'Categoria' },
    { chiave: 'um', etichetta: 'UM' },
    { chiave: 'acquisti', etichetta: 'N. acquisti' },
    { chiave: 'nFornitori', etichetta: 'N. fornitori' },
    { chiave: 'primoPrezzo', etichetta: 'Primo prezzo (netto)' },
    { chiave: 'ultimoPrezzo', etichetta: 'Ultimo prezzo (netto)' },
    { chiave: 'variazionePct', etichetta: 'Variazione %' },
    { chiave: 'prezzoMin', etichetta: 'Prezzo minimo' },
    { chiave: 'prezzoMax', etichetta: 'Prezzo massimo' },
    { chiave: 'escursionePct', etichetta: 'Escursione %' },
    { chiave: 'spesa', etichetta: 'Spesa totale (netto)' },
    { chiave: 'migliorFornitore', etichetta: 'Fornitore più conveniente' },
  ]

  const Th = ({ col, children, className = '' }) => (
    <th {...propsTh(col)} className={`py-2 font-semibold ${className} cursor-pointer select-none hover:text-gray-900`}>
      {children}<IconaOrdine colonna={col} colonnaAttiva={colonna} direzione={direzione} />
    </th>
  )

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <SelettorePeriodo da={periodo.da} a={periodo.a} onChange={setPeriodo} />
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Categoria merceologica</label>
            <select value={filtri.categoria} onChange={e => setFiltri(f => ({ ...f, categoria: e.target.value }))}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm">
              <option value="ALL">Tutte</option>
              {categorie.map(c => <option key={c.categoria} value={c.categoria}>{c.categoria}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Acquisti minimi</label>
            <select value={filtri.minAcquisti} onChange={e => setFiltri(f => ({ ...f, minAcquisti: Number(e.target.value) }))}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm">
              {[2, 3, 5, 10, 20].map(n => <option key={n} value={n}>≥ {n}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Cerca articolo</label>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={ricerca} onChange={e => setRicerca(e.target.value)}
                placeholder="es. GUANCIALE, BARILLA, GRANA…"
                className="w-full border border-gray-200 rounded-lg pl-8 pr-2.5 py-1.5 text-sm" />
            </div>
          </div>
        </div>
      </div>

      <Avviso tipo="info">
        I prezzi sono <strong>unitari e al netto IVA</strong>, presi da{' '}
        <code>fatture_righe.prezzo_unitario</code>. Gli articoli sono raggruppati per nome
        normalizzato, quindi lo stesso prodotto acquistato da fornitori diversi finisce sulla
        stessa riga: è proprio ciò che rende possibile il confronto. Le righe senza prezzo
        unitario sono escluse — contarle come zero farebbe risultare qualunque articolo in calo.
      </Avviso>

      {caricamento && <Caricamento testo="Analizzo le righe fattura…" />}
      {errore && <Avviso tipo="error">Analisi non riuscita: {errore}</Avviso>}

      {!caricamento && dati && (
        <>
          {rincari.length > 0 && (
            <Sezione titolo="Chi è rincarato di più"
              sottotitolo="articoli con almeno 300 € di spesa nel periodo, ordinati per variazione del prezzo unitario">
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {rincari.map(a => (
                  <button key={a.nome} onClick={() => setAperto(a)}
                    className="text-left rounded-lg border border-red-100 bg-red-50/60 p-2.5 hover:border-red-300 transition-colors">
                    <p className="text-[11px] font-semibold text-gray-800 truncate" title={a.descrizione || a.nome}>
                      {a.descrizione || a.nome}
                    </p>
                    <p className="text-lg font-bold text-red-700">{fmtPct(a.variazionePct, { segno: true })}</p>
                    <p className="text-[10px] text-gray-500">
                      {fmtEur(a.primoPrezzo, { decimali: 2 })} <ArrowRight size={9} className="inline" />{' '}
                      {fmtEur(a.ultimoPrezzo, { decimali: 2 })} · {a.nFornitori} fornitori
                    </p>
                  </button>
                ))}
              </div>
            </Sezione>
          )}

          <Sezione
            titolo={`Articoli acquistati (${fmtNum(righeOrdinate.length)})`}
            sottotitolo="clicca una riga per lo storico prezzi e il confronto fra fornitori"
            azioni={<BottoneCsv righe={righeOrdinate} colonne={colonneCsv} nomeFile="prezzi_articoli" />}>
            <div className="overflow-x-auto max-h-[560px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b-2 border-gray-200 text-left text-xs text-gray-500">
                    <Th col="descrizione">Articolo</Th>
                    <Th col="categoria">Categoria</Th>
                    <Th col="acquisti" className="text-right">Acq.</Th>
                    <Th col="nFornitori" className="text-right">Forn.</Th>
                    <Th col="primoPrezzo" className="text-right">Primo</Th>
                    <Th col="ultimoPrezzo" className="text-right">Ultimo</Th>
                    <Th col="variazionePct" className="text-right">Var.</Th>
                    <Th col="escursionePct" className="text-right">Escurs.</Th>
                    <Th col="spesa" className="text-right">Spesa netta</Th>
                  </tr>
                </thead>
                <tbody>
                  {righeOrdinate.slice(0, 300).map(a => (
                    // key sul nome normalizzato, che è la chiave logica della riga:
                    // con key={index} l'ordinamento rimescolerebbe le righe.
                    <tr key={a.nome} onClick={() => setAperto(a)}
                      className="border-b border-gray-50 hover:bg-indigo-50/50 cursor-pointer">
                      <td className="py-1.5 pr-2 max-w-[280px]">
                        <span className="block truncate" title={a.descrizione || a.nome}>{a.descrizione || a.nome}</span>
                        <span className="block text-[10px] text-gray-400 font-mono truncate">{a.nome}</span>
                      </td>
                      <td className="py-1.5 text-[11px] text-gray-500">{a.categoria}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtNum(a.acquisti)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {a.nFornitori > 1
                          ? <span className="text-indigo-600 font-medium">{a.nFornitori}</span>
                          : <span className="text-gray-400">1</span>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-gray-500">{fmtEur(a.primoPrezzo, { decimali: 2 })}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtEur(a.ultimoPrezzo, { decimali: 2 })}</td>
                      <td className={`py-1.5 text-right tabular-nums font-medium ${
                        a.variazionePct == null ? 'text-gray-300'
                          : a.variazionePct > 10 ? 'text-red-600'
                          : a.variazionePct < -10 ? 'text-emerald-600' : 'text-gray-600'
                      }`}>{fmtPct(a.variazionePct, { segno: true })}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-500">{fmtPct(a.escursionePct)}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">{fmtEur(a.spesa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {righeOrdinate.length > 300 && (
              <p className="text-[11px] text-amber-600 mt-2">
                Mostrate le prime 300 righe di {fmtNum(righeOrdinate.length)}: usa la ricerca o
                il filtro categoria per restringere. L'export CSV contiene tutte le righe.
              </p>
            )}
            <NotaCopertura righe={dati.righeLette} da={dataIt(periodo.da)} a={dataIt(periodo.a)}
              fonte="fatture_righe (netto IVA)"
              extra={dati.righeSenzaSede ? `${fmtNum(dati.righeSenzaSede)} righe senza sede` : null}
              troncato={dati.troncato} />
          </Sezione>
        </>
      )}

      {aperto && <DettaglioArticolo articolo={aperto} periodo={periodo} onChiudi={() => setAperto(null)} />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 3. MERCEOLOGICO
// ════════════════════════════════════════════════════════════════════════════
function SezioneMerceologico() {
  const oggi = new Date()
  const [periodo, setPeriodo] = useState(() => ({
    da: isoLocale(new Date(oggi.getFullYear() - 1, oggi.getMonth(), 1)),
    a: isoLocale(oggi),
  }))
  const [dati, setDati] = useState(null)
  const [foodCost, setFoodCost] = useState([])
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    let annullato = false
    setCaricamento(true); setErrore(null)
    Promise.all([
      analisiCostiApi.spesaMerceologica({ from: periodo.da, to: periodo.a }),
      analisiCostiApi.foodCostMensile(),
    ])
      .then(([m, fc]) => { if (!annullato) { setDati(m); setFoodCost(fc) } })
      .catch(e => { if (!annullato) { setErrore(e?.message || String(e)); setDati(null) } })
      .finally(() => { if (!annullato) setCaricamento(false) })
    return () => { annullato = true }
  }, [periodo])

  const { righeOrdinate, colonna, direzione, propsTh } = useOrdinamento(dati?.perCategoria ?? [], 'spesa', 'desc')
  const totale = useMemo(() => (dati?.perCategoria ?? []).reduce((s, c) => s + c.spesa, 0), [dati])

  // Trend per macro-categoria: le singole categorie sono 21, illeggibili in un
  // grafico; le macro sono 7 e raccontano lo stesso movimento.
  const trendMacro = useMemo(() => {
    const perMese = new Map()
    for (const r of dati?.perCategoriaMese ?? []) {
      if (!perMese.has(r.mese)) perMese.set(r.mese, { mese: r.mese, label: meseIt(r.mese) })
      const m = perMese.get(r.mese)
      m[r.macro] = (m[r.macro] || 0) + r.spesa
    }
    return [...perMese.values()].sort((a, b) => a.mese.localeCompare(b.mese))
  }, [dati])
  const macroPresenti = useMemo(
    () => [...new Set((dati?.perCategoriaMese ?? []).map(r => r.macro))],
    [dati])

  const fcFiltrato = useMemo(() => {
    const daM = periodo.da.slice(0, 7), aM = periodo.a.slice(0, 7)
    const perMese = new Map()
    for (const r of foodCost) {
      if (r.mese < daM || r.mese > aM) continue
      if (!perMese.has(r.mese)) perMese.set(r.mese, { mese: r.mese, label: meseIt(r.mese) })
      // null e non 0: un mese senza dato non è un mese a food cost zero
      perMese.get(r.mese)[r.sede] = r.food_cost_pct == null ? null : Number(r.food_cost_pct)
    }
    return [...perMese.values()].sort((a, b) => a.mese.localeCompare(b.mese))
  }, [foodCost, periodo])

  const nonClassificato = (dati?.perCategoria ?? []).find(c => c.categoria === 'NON_CLASSIFICATO')

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <SelettorePeriodo da={periodo.da} a={periodo.a} onChange={setPeriodo} />
      </div>

      <Avviso tipo="info">
        Le 21 categorie merceologiche derivano da 182 regole applicate alle righe fattura.
        Gli importi sono <strong>netti IVA</strong>. La riga <strong>NON_CLASSIFICATO</strong> non
        è "altro": è "nessuna regola ha riconosciuto la riga", quindi resta visibile — nasconderla
        farebbe sembrare la classificazione migliore di com'è.
        {dati?.righeSenzaSede > 0 && (
          <> Le colonne per sede coprono solo le fatture che ce l'hanno:{' '}
          <strong>{fmtNum(dati.righeSenzaSede)} righe del periodo sono senza sede</strong> e finiscono
          nella colonna dedicata.</>
        )}
      </Avviso>

      {caricamento && <Caricamento testo="Aggrego le righe per categoria…" />}
      {errore && <Avviso tipo="error">Analisi non riuscita: {errore}</Avviso>}

      {!caricamento && dati && (
        <>
          {nonClassificato && nonClassificato.spesa !== 0 && (
            <Avviso tipo="warn">
              <strong>{fmtEur(Math.abs(nonClassificato.spesa))}</strong> su{' '}
              {fmtNum(nonClassificato.righe)} righe non sono stati riconosciuti da nessuna regola
              ({fmtPct(totale ? (Math.abs(nonClassificato.spesa) / Math.abs(totale)) * 100 : null)} della
              spesa del periodo). Finché restano lì, ogni percentuale di food cost è per difetto.
            </Avviso>
          )}

          <Sezione titolo="Spesa per categoria merceologica"
            sottotitolo={`${dataIt(periodo.da)} → ${dataIt(periodo.a)} · netto IVA`}
            azioni={<BottoneCsv righe={righeOrdinate} nomeFile="spesa_merceologica"
              colonne={[
                { chiave: 'categoria', etichetta: 'Categoria' },
                { chiave: 'macro', etichetta: 'Macro' },
                { chiave: 'spesa', etichetta: 'Spesa netta' },
                { chiave: 'MA', etichetta: 'Mameli' },
                { chiave: 'PN', etichetta: 'Predda Niedda' },
                { chiave: 'senzaSede', etichetta: 'Senza sede' },
                { chiave: 'righe', etichetta: 'N. righe' },
                { chiave: 'nFornitori', etichetta: 'N. fornitori' },
              ]} />}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-200 text-left text-xs text-gray-500">
                    <th {...propsTh('categoria')} className="py-2 font-semibold cursor-pointer">
                      Categoria<IconaOrdine colonna="categoria" colonnaAttiva={colonna} direzione={direzione} />
                    </th>
                    <th {...propsTh('macro')} className="py-2 font-semibold cursor-pointer">
                      Macro<IconaOrdine colonna="macro" colonnaAttiva={colonna} direzione={direzione} />
                    </th>
                    <th {...propsTh('spesa')} className="py-2 text-right font-semibold cursor-pointer">
                      Spesa netta<IconaOrdine colonna="spesa" colonnaAttiva={colonna} direzione={direzione} />
                    </th>
                    <th className="py-2 text-right font-normal">% tot.</th>
                    <th {...propsTh('MA')} className="py-2 text-right font-semibold cursor-pointer" style={{ color: COLORE_SEDE.MA }}>
                      Mameli<IconaOrdine colonna="MA" colonnaAttiva={colonna} direzione={direzione} />
                    </th>
                    <th {...propsTh('PN')} className="py-2 text-right font-semibold cursor-pointer" style={{ color: COLORE_SEDE.PN }}>
                      Predda N.<IconaOrdine colonna="PN" colonnaAttiva={colonna} direzione={direzione} />
                    </th>
                    <th className="py-2 text-right font-normal">Senza sede</th>
                    <th {...propsTh('nFornitori')} className="py-2 text-right font-semibold cursor-pointer">
                      Forn.<IconaOrdine colonna="nFornitori" colonnaAttiva={colonna} direzione={direzione} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {righeOrdinate.map(c => (
                    <tr key={c.categoria} className={`border-b border-gray-50 ${c.daPresidiare ? 'bg-amber-50/50' : ''}`}>
                      <td className="py-1.5">
                        {c.categoria}
                        {c.isFoodCost && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600">food cost</span>}
                        {!c.isFoodCost && c.isMateriaPrima && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600">materia prima</span>}
                      </td>
                      <td className="py-1.5">
                        <span className="text-[11px] px-1.5 py-0.5 rounded font-medium"
                          style={{ background: (COLORI_MACRO[c.macro] || '#94a3b8') + '20', color: COLORI_MACRO[c.macro] || '#64748b' }}>
                          {c.macro}
                        </span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums font-medium">{fmtEur(c.spesa)}</td>
                      <td className="py-1.5 text-right tabular-nums text-[11px] text-gray-400">
                        {fmtPct(totale ? (c.spesa / totale) * 100 : null)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{c.MA ? fmtEur(c.MA) : <span className="text-gray-300">—</span>}</td>
                      <td className="py-1.5 text-right tabular-nums">{c.PN ? fmtEur(c.PN) : <span className="text-gray-300">—</span>}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-400">{c.senzaSede ? fmtEur(c.senzaSede) : '—'}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-500">{fmtNum(c.nFornitori)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <NotaCopertura righe={dati.righeLette} da={dataIt(periodo.da)} a={dataIt(periodo.a)}
              fonte="fatture_righe × categorie_merceologiche" troncato={dati.troncato} />
          </Sezione>

          <div className="grid lg:grid-cols-2 gap-4">
            <Sezione titolo="Come si muove la spesa, per macro-categoria">
              {trendMacro.length === 0
                ? <p className="text-sm text-gray-400 py-8 text-center">Nessun mese nel periodo.</p>
                : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={trendMacro}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${Math.round(v / 1000)}k`} />
                      <Tooltip formatter={v => fmtEur(v)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {macroPresenti.map(m => (
                        <Bar key={m} dataKey={m} stackId="a" fill={COLORI_MACRO[m] || '#94a3b8'} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
            </Sezione>

            <Sezione titolo="Food cost % per sede"
              sottotitolo="vista v_food_cost_mensile: food su ricavi netti. Disponibile dal 2025, quando le fatture hanno iniziato ad avere la sede">
              {fcFiltrato.length === 0
                ? <p className="text-sm text-gray-400 py-8 text-center">
                    Nessun mese con food cost per sede nel periodo selezionato.
                  </p>
                : (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={fcFiltrato}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} unit="%" domain={[0, 'auto']} />
                      <Tooltip formatter={v => fmtPct(v)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine y={30} stroke="#f59e0b" strokeDasharray="4 4"
                        label={{ value: 'soglia 30%', fontSize: 10, fill: '#f59e0b' }} />
                      {/* connectNulls disattivato: un mese senza dato deve
                          restare un buco, non una linea interpolata */}
                      <Line type="monotone" dataKey="MA" name="Mameli" stroke={COLORE_SEDE.MA} strokeWidth={2} connectNulls={false} />
                      <Line type="monotone" dataKey="PN" name="Predda Niedda" stroke={COLORE_SEDE.PN} strokeWidth={2} connectNulls={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
            </Sezione>
          </div>
        </>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 4. SETTE ANNI
// ════════════════════════════════════════════════════════════════════════════
function SezioneStorico() {
  const [dati, setDati] = useState(null)
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    let annullato = false
    analisiCostiApi.serieStorica()
      .then(r => { if (!annullato) setDati(r) })
      .catch(e => { if (!annullato) { setErrore(e?.message || String(e)); setDati(null) } })
      .finally(() => { if (!annullato) setCaricamento(false) })
    return () => { annullato = true }
  }, [])

  // Anni ricavati dai dati: nessun elenco cablato, così l'aggiunta del 2027
  // non richiede di toccare il codice.
  const perAnno = useMemo(() => {
    const m = new Map()
    for (const r of dati?.macro ?? []) {
      const a = Number(r.anno)
      if (!m.has(a)) m.set(a, { anno: a, totale: 0, food: 0, utenze: 0, fissi: 0, commissioni: 0, servizi: 0, fatture: 0, mesi: 0 })
      const x = m.get(a)
      x.totale += Number(r.totale) || 0
      x.food += Number(r.food_cost) || 0
      x.utenze += Number(r.utenze) || 0
      x.fissi += Number(r.costi_fissi) || 0
      x.commissioni += Number(r.commissioni) || 0
      x.servizi += Number(r.servizi_altro) || 0
      x.fatture += Number(r.n_fatture) || 0
      x.mesi++
    }
    const righe = [...m.values()].sort((a, b) => a.anno - b.anno)
    // Variazione anno su anno: null sul primo anno, perché non c'è un termine
    // di paragone — non 0, che vorrebbe dire "stabile".
    return righe.map((r, i) => ({
      ...r,
      variazionePct: i > 0 && righe[i - 1].totale ? ((r.totale - righe[i - 1].totale) / righe[i - 1].totale) * 100 : null,
      parziale: r.mesi < 12,
    }))
  }, [dati])

  // Stagionalità: stesso mese, anni diversi, uno accanto all'altro.
  const stagionalita = useMemo(() => {
    const anni = [...new Set((dati?.macro ?? []).map(r => Number(r.anno)))].sort()
    const perMese = Array.from({ length: 12 }, (_, i) => ({
      meseNum: i + 1,
      label: ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'][i],
    }))
    for (const r of dati?.macro ?? []) {
      const mn = Number(r.mese)
      if (!mn || mn < 1 || mn > 12) continue
      perMese[mn - 1][String(r.anno)] = Number(r.totale) || 0
    }
    return { righe: perMese, anni }
  }, [dati])

  const palette = ['#cbd5e1', '#a5b4fc', '#818cf8', '#6366f1', '#4f46e5', '#4338ca', '#3730a3', '#312e81']

  if (caricamento) return <Caricamento testo="Carico sette esercizi di spesa fornitori…" />
  if (errore) return <Avviso tipo="error">Serie storica non disponibile: {errore}</Avviso>

  return (
    <div className="space-y-4">
      <Avviso tipo="info">
        Serie completa dal <strong>giugno 2019</strong>. Gli importi sono <strong>lordi IVA</strong>,
        perché la vista <code>v_macro_spesa_mensile</code> aggrega le testate fattura: non vanno
        confrontati con i valori netti delle altre sezioni. Il 2019 è parziale (parte da giugno) e
        l'anno in corso lo è per definizione: le righe parziali sono marcate.
      </Avviso>

      <Sezione titolo="Spesa fornitori per esercizio"
        azioni={<BottoneCsv righe={perAnno} nomeFile="spesa_per_anno"
          colonne={[
            { chiave: 'anno', etichetta: 'Anno' },
            { chiave: 'mesi', etichetta: 'Mesi con dati' },
            { chiave: 'totale', etichetta: 'Totale lordo' },
            { chiave: 'food', etichetta: 'Food cost' },
            { chiave: 'utenze', etichetta: 'Utenze' },
            { chiave: 'commissioni', etichetta: 'Commissioni' },
            { chiave: 'servizi', etichetta: 'Servizi e altro' },
            { chiave: 'variazionePct', etichetta: 'Var. % su anno prec.' },
          ]} />}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200 text-left text-xs text-gray-500">
                <th className="py-2 font-semibold">Esercizio</th>
                <th className="py-2 text-right font-semibold">Totale (lordo)</th>
                <th className="py-2 text-right font-semibold">Var. YoY</th>
                <th className="py-2 text-right font-semibold">Food</th>
                <th className="py-2 text-right font-semibold">Utenze</th>
                <th className="py-2 text-right font-semibold">Commissioni</th>
                <th className="py-2 text-right font-semibold">Servizi/altro</th>
                <th className="py-2 text-right font-semibold">Fatture</th>
              </tr>
            </thead>
            <tbody>
              {perAnno.map(r => (
                <tr key={r.anno} className="border-b border-gray-50">
                  <td className="py-1.5 font-medium">
                    {r.anno}
                    {r.parziale && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                        {r.mesi} mesi
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right tabular-nums font-medium">{fmtEur(r.totale)}</td>
                  <td className={`py-1.5 text-right tabular-nums ${
                    r.variazionePct == null ? 'text-gray-300'
                      : r.variazionePct > 0 ? 'text-red-600' : 'text-emerald-600'
                  }`}>{fmtPct(r.variazionePct, { segno: true })}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtEur(r.food)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtEur(r.utenze)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtEur(r.commissioni)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtEur(r.servizi)}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-500">{fmtNum(r.fatture)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sezione>

      <Sezione titolo="Stagionalità: stesso mese, anni a confronto"
        sottotitolo="serve a capire se un mese è andato male davvero o se quel mese va sempre così">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={stagionalita.righe}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={v => fmtEur(v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {stagionalita.anni.map((a, i) => (
              <Bar key={a} dataKey={String(a)} name={String(a)} fill={palette[i % palette.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Sezione>

      <Sezione titolo="Andamento mensile continuo" sottotitolo="tutta la serie, senza tagli">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={(dati?.macro ?? []).map(r => ({
            mese: r.anno_mese,
            Totale: Number(r.totale) || 0,
            Food: Number(r.food_cost) || 0,
          }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="mese" tick={{ fontSize: 9 }} minTickGap={40} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={v => fmtEur(v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="Totale" fill="#e0e7ff" stroke="#6366f1" strokeWidth={1.5} />
            <Line type="monotone" dataKey="Food" stroke="#ef4444" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Sezione>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
export default function CostiPrezziBi() {
  const { sezione } = useParams()
  // Una sezione inesistente ricade sulla prima, invece di lasciare l'area
  // contenuti vuota senza alcun errore visibile.
  const attiva = SEZIONI.find(s => s.id === sezione) ?? SEZIONI[0]

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-gray-900">Costi & Prezzi BI</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Marginalità per sede, prezzi d'acquisto per articolo e spesa merceologica,
          ricostruiti dalle 114.650 righe di dettaglio fattura.
        </p>
      </header>

      <nav className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {SEZIONI.map(s => {
          const Icona = s.icon
          return (
            <NavLink key={s.id} to={s.path} end={s.exact}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  isActive
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}>
              <Icona size={14} />{s.label}
            </NavLink>
          )
        })}
      </nav>

      {attiva.id === 'marginalita'  && <SezioneMarginalita />}
      {attiva.id === 'prezzi'       && <SezionePrezzi />}
      {attiva.id === 'merceologico' && <SezioneMerceologico />}
      {attiva.id === 'storico'      && <SezioneStorico />}
    </div>
  )
}
