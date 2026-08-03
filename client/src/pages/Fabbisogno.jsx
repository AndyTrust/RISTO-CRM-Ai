/**
 * Fabbisogno.jsx — Fabbisogno per turno e tendenza coperti/scontrino.
 *
 * Risponde a due domande che nessun'altra pagina mette una accanto all'altra:
 *
 *   1. "Questo turno, in media, copre la sua quota di break-even?"
 *      → v_fabbisogno_turno: sede × giorno della settimana × turno, medie delle
 *        ultime 12 settimane. La quota di pareggio di ogni turno è distribuita
 *        in proporzione al peso storico del turno sulla settimana
 *        (`pct_settimana`), quindi il turno di domenica a pranzo "deve" più del
 *        lunedì sera: confrontare i due incassi in valore assoluto non avrebbe
 *        senso.
 *
 *   2. "Il calo del fatturato viene dai coperti o dallo scontrino?"
 *      → v_tendenza_periodo: la variazione anno su anno è già scomposta in
 *        `effetto_coperti_pct` ed `effetto_scontrino_pct`. È la distinzione che
 *        cambia la leva su cui agire: meno clienti si combatte con marketing e
 *        orari, meno spesa media con menu e vendita suggerita.
 *
 * SULLE DUE LEVE (coperti / scontrino): sono ALTERNATIVE, non additive. Il
 * database calcola "quanti coperti in più servono TENENDO FERMO lo scontrino"
 * e "quanto scontrino in più serve TENENDO FERMI i coperti". Sommarle porta a
 * un obiettivo doppio del necessario, ed è l'errore che questa pagina deve
 * rendere impossibile: per questo le due cifre sono sempre separate da "oppure".
 *
 * Cap PostgREST: ogni vista si legge SEMPRE filtrata per sede lato server (e
 * per mese dove ha senso), mai per intero.
 *
 * Sola lettura: qui non si scrive nulla.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Gauge, TrendingDown, Users, Receipt, Info, AlertTriangle, Loader2,
  CalendarDays, CheckCircle2, Target,
} from 'lucide-react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import supabase from '../supabase'
import { fmtEur, fmtNum, fmtPct, NotaCopertura } from '../lib/tabella'

// ── Costanti condivise ─────────────────────────────────────────────────────
// Niente "Entrambe": la griglia del fabbisogno è per sede, e sommare due sedi
// con break-even diversi darebbe un fabbisogno che non appartiene a nessuna
// delle due.
const SEDE_OPTIONS = [
  { value: 'MA', label: 'Mameli (MA)' },
  { value: 'PN', label: 'Predda Niedda (PN)' },
]
const NOME_SEDE = { MA: 'Mameli', PN: 'Predda Niedda' }
const MESI_IT = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
const MESI_BREVI = ['', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu',
  'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

const GIORNI = [
  { iso: 1, label: 'Lunedì' },
  { iso: 2, label: 'Martedì' },
  { iso: 3, label: 'Mercoledì' },
  { iso: 4, label: 'Giovedì' },
  { iso: 5, label: 'Venerdì' },
  { iso: 6, label: 'Sabato' },
  { iso: 7, label: 'Domenica' },
]
const TURNI = [
  { id: 'pranzo', label: 'Pranzo' },
  { id: 'cena',   label: 'Cena' },
]

const MESI_TENDENZA = 18   // quanti mesi si leggono per il grafico e la tabella

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null }
const pad2 = n => String(n).padStart(2, '0')

/** "2026-08" → "Agosto 2026". */
const etichettaMese = ms => {
  if (!ms) return '—'
  const [a, m] = String(ms).split('-')
  return `${MESI_IT[Number(m)] || m} ${a}`
}
/** "2026-08" → "Ago 26", per l'asse X del grafico. */
const etichettaMeseBreve = ms => {
  if (!ms) return ''
  const [a, m] = String(ms).split('-')
  return `${MESI_BREVI[Number(m)] || m} ${String(a).slice(2)}`
}

/** Il mese di calendario in corso: le sue righe sono parziali per definizione. */
function meseCorrente() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

/** "AAAA-MM" di N mesi fa, per il filtro lato server sulla tendenza. */
function meseIndietro(n) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

// ── Componenti di base (stessa grammatica di Obiettivi & Premi) ─────────────
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

function Sezione({ titolo, sottotitolo, icona: Icona, azioni, children }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4">
      <header className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-2">
          {Icona && <Icona size={16} className="text-gray-400 mt-0.5 flex-shrink-0" />}
          <div>
            <h3 className="text-sm font-bold text-gray-800">{titolo}</h3>
            {sottotitolo && <p className="text-xs text-gray-500 mt-0.5">{sottotitolo}</p>}
          </div>
        </div>
        {azioni && <div className="flex items-center gap-2 flex-shrink-0">{azioni}</div>}
      </header>
      {children}
    </section>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// BLOCCO 1 — Griglia settimanale del fabbisogno
// ════════════════════════════════════════════════════════════════════════════
/**
 * Semaforo della cella: lo scostamento si misura in PERCENTUALE sull'incasso
 * necessario, non in euro. In euro il sabato sera sembrerebbe sempre il turno
 * messo peggio solo perché è quello che deve fatturare di più.
 */
const SOGLIA_AMBRA = 20   // punti percentuali di scostamento

function semaforoCella(riga) {
  const gap = num(riga?.gap_pareggio)
  const necessario = num(riga?.incasso_necessario_pareggio)
  if (gap == null) {
    return { chiave: 'muto', pct: null, box: 'bg-gray-50 border-gray-200', testo: 'text-gray-400' }
  }
  if (gap <= 0) {
    return {
      chiave: 'verde', pct: necessario ? (gap / necessario) * 100 : null,
      box: 'bg-emerald-50 border-emerald-200', testo: 'text-emerald-700',
    }
  }
  const pct = necessario ? (gap / necessario) * 100 : null
  if (pct != null && pct <= SOGLIA_AMBRA) {
    return { chiave: 'ambra', pct, box: 'bg-amber-50 border-amber-200', testo: 'text-amber-800' }
  }
  return { chiave: 'rosso', pct, box: 'bg-red-50 border-red-200', testo: 'text-red-700' }
}

function CellaTurno({ riga }) {
  if (!riga) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 p-3 text-xs text-gray-300 flex items-center justify-center min-h-[132px]">
        Nessun servizio nelle ultime 12 settimane
      </div>
    )
  }
  const s = semaforoCella(riga)
  const gap = num(riga.gap_pareggio)
  const sopra = gap != null && gap <= 0
  const copertiGap = num(riga.coperti_in_piu_per_pareggio)
  const scontrinoGap = num(riga.scontrino_in_piu_per_pareggio)

  return (
    <div className={`rounded-lg border p-3 ${s.box}`}>
      {/* Riga 1: le medie del turno */}
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-sm font-bold text-gray-900 tabular-nums">
          {fmtEur(riga.incasso_medio)}
        </span>
        <span className="text-[11px] text-gray-500 tabular-nums">
          {fmtNum(riga.coperti_medi)} cop · {fmtEur(riga.scontrino_medio, { decimali: 2 })}/cop
        </span>
      </div>

      {/* Riga 2: la soglia da coprire */}
      <p className="text-[11px] text-gray-500 mt-1 tabular-nums">
        pareggio a {fmtEur(riga.incasso_necessario_pareggio)}
        {num(riga.pct_settimana) != null && (
          <span className="text-gray-400"> · {fmtPct(riga.pct_settimana)} della settimana</span>
        )}
      </p>

      {/* Riga 3: quanto manca, nei DUE modi alternativi */}
      <div className={`mt-2 pt-2 border-t border-black/5 ${s.testo}`}>
        {sopra ? (
          <>
            <p className="text-sm font-bold">
              Pareggio coperto <span className="tabular-nums">(+{fmtEur(Math.abs(gap))})</span>
            </p>
            <p className="text-[11px] mt-0.5 opacity-90 tabular-nums">
              margine pari a {fmtNum(Math.abs(copertiGap ?? 0))} coperti oppure{' '}
              {fmtEur(Math.abs(scontrinoGap ?? 0), { decimali: 2 })} di scontrino
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-bold tabular-nums">
              +{fmtNum(copertiGap)} coperti
              <span className="font-normal text-gray-500 mx-1.5">oppure</span>
              +{fmtEur(scontrinoGap, { decimali: 2 })} scontrino
            </p>
            <p className="text-[11px] mt-0.5 opacity-90 tabular-nums">
              mancano {fmtEur(gap)}
              {s.pct != null && ` (${fmtPct(s.pct)} dell'incasso richiesto)`}
            </p>
          </>
        )}
      </div>

      {/* Riga 4: segno discreto — questo turno il pareggio l'ha già fatto */}
      <div className="flex items-center justify-between gap-2 mt-1.5">
        {riga.pareggio_gia_raggiunto_almeno_una_volta ? (
          <span
            title="In almeno uno degli ultimi servizi questo turno ha coperto la sua quota di pareggio: è un obiettivo già dimostrato possibile, non una previsione."
            className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700">
            <CheckCircle2 size={10} /> già riuscito
          </span>
        ) : <span />}
        <span className="text-[10px] text-gray-400 tabular-nums">
          {fmtNum(riga.n_servizi)} servizi · migliore {fmtEur(riga.incasso_migliore)}
        </span>
      </div>
    </div>
  )
}

function GrigliaFabbisogno({ righe, sede }) {
  // Indice giorno_iso|turno → riga: la vista può non avere tutte e 14 le celle
  // (un turno mai aperto semplicemente non c'è) e una cella mancante non è una
  // cella a zero.
  const indice = useMemo(() => {
    const m = new Map()
    for (const r of righe ?? []) m.set(`${r.giorno_iso}|${r.turno}`, r)
    return m
  }, [righe])

  const conteggi = useMemo(() => {
    const c = { verde: 0, ambra: 0, rosso: 0, muto: 0 }
    for (const r of righe ?? []) c[semaforoCella(r).chiave] += 1
    return c
  }, [righe])

  const totali = useMemo(() => {
    const rr = righe ?? []
    return {
      incasso: rr.reduce((s, r) => s + (num(r.incasso_medio) ?? 0), 0),
      necessario: rr.reduce((s, r) => s + (num(r.incasso_necessario_pareggio) ?? 0), 0),
      coperti: rr.reduce((s, r) => s + (num(r.coperti_medi) ?? 0), 0),
    }
  }, [righe])
  const gapSettimana = totali.necessario - totali.incasso

  return (
    <Sezione
      icona={Gauge}
      titolo={`Fabbisogno per turno — ${NOME_SEDE[sede] || sede}`}
      sottotitolo="media delle ultime 12 settimane, giorno della settimana × turno: quanto incassa e quanto dovrebbe incassare per coprire la sua quota di pareggio"
      azioni={
        <div className="flex items-center gap-2 text-[10px]">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-200 text-emerald-700">
            sopra il pareggio {conteggi.verde}
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-amber-50 border-amber-200 text-amber-800">
            sotto di poco {conteggi.ambra}
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-red-50 border-red-200 text-red-700">
            sotto di molto {conteggi.rosso}
          </span>
        </div>
      }>

      <div className="mb-3">
        <Avviso tipo="info">
          Sono <strong>medie delle ultime 12 settimane</strong>, non previsioni. Le due cifre in
          grassetto sono <strong>alternative, non da sommare</strong>: "+N coperti" vale a scontrino
          fermo, "+X,XX € di scontrino" vale a coperti fermi. Ne basta una delle due.
          La quota di pareggio di ogni turno è distribuita in proporzione al peso storico del turno
          sulla settimana, perciò lo scostamento in percentuale si somiglia fra le celle: quello che
          cambia davvero è <strong>quanti coperti</strong> servono in ciascuna.
        </Avviso>
      </div>

      {/* Griglia 7 giorni × 2 turni */}
      <div className="overflow-x-auto">
        <div className="min-w-[620px]">
          <div className="grid grid-cols-[90px_1fr_1fr] gap-2 mb-1.5">
            <div />
            {TURNI.map(t => (
              <div key={t.id} className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 px-1">
                {t.label}
              </div>
            ))}
          </div>
          {GIORNI.map(g => (
            <div key={g.iso} className="grid grid-cols-[90px_1fr_1fr] gap-2 mb-2 items-stretch">
              <div className="flex items-center">
                <span className="text-sm font-semibold text-gray-700">{g.label}</span>
              </div>
              {TURNI.map(t => (
                <CellaTurno key={t.id} riga={indice.get(`${g.iso}|${t.id}`)} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Totale settimana tipo */}
      <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
        <strong>Settimana tipo:</strong> {fmtEur(totali.incasso)} di incasso medio su{' '}
        {fmtNum(totali.coperti)} coperti, contro {fmtEur(totali.necessario)} necessari al pareggio.{' '}
        {gapSettimana > 0 ? (
          <>Mancano <strong className="text-red-600">{fmtEur(gapSettimana)}</strong> a settimana.</>
        ) : (
          <>Pareggio settimanale superato di{' '}
            <strong className="text-emerald-700">{fmtEur(Math.abs(gapSettimana))}</strong>.</>
        )}
      </div>

      <NotaCopertura righe={(righe ?? []).length} fonte="v_fabbisogno_turno"
        extra={`filtrata lato server per sede ${sede} · medie ultime 12 settimane`} />
    </Sezione>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// BLOCCO 2 — Tendenza e scomposizione coperti / scontrino
// ════════════════════════════════════════════════════════════════════════════
/**
 * Quale delle due leve spiega la variazione.
 * Il rapporto 2:1 non è un capriccio: sotto quella soglia le due componenti si
 * equivalgono e dire "è colpa dei coperti" sarebbe una forzatura.
 */
function levaDominante(effettoCoperti, effettoScontrino) {
  const ec = num(effettoCoperti), es = num(effettoScontrino)
  if (ec == null || es == null) return null
  const a = Math.abs(ec), b = Math.abs(es)
  if (a >= b * 2) return 'coperti'
  if (b >= a * 2) return 'scontrino'
  return 'misto'
}
const ETICHETTA_LEVA = {
  coperti:   { testo: 'affluenza',  classe: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  scontrino: { testo: 'spesa media', classe: 'bg-purple-100 text-purple-700 border-purple-200' },
  misto:     { testo: 'entrambe',   classe: 'bg-gray-100 text-gray-600 border-gray-200' },
}

function TooltipTendenza({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-800 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="tabular-nums" style={{ color: p.color }}>
          {p.name}: {fmtEur(p.value)}
        </p>
      ))}
    </div>
  )
}

/** La riga di testo che interpreta le due colonne: è il punto della pagina. */
function frasePeriodo(riga, sede) {
  if (!riga) return null
  const nome = NOME_SEDE[sede] || sede
  const ec = num(riga.effetto_coperti_pct)
  const es = num(riga.effetto_scontrino_pct)
  const varTot = num(riga.var_su_anno_prec_pct)
  const leva = levaDominante(ec, es)
  if (leva == null) {
    return `Per ${etichettaMese(riga.mese_str)} manca il confronto con l'anno precedente: la scomposizione fra coperti e scontrino non è calcolabile.`
  }
  const segnoTot = varTot != null && varTot < 0 ? 'in calo del' : 'in crescita del'
  const testa = `${nome}, ${etichettaMese(riga.mese_str)}: fatturato ${segnoTot} ${fmtPct(Math.abs(varTot ?? 0))} sull'anno precedente — effetto coperti ${fmtPct(ec, { segno: true })}, effetto scontrino ${fmtPct(es, { segno: true })}.`

  if (leva === 'coperti') {
    const dir = ec < 0 ? 'calo' : 'crescita'
    return `${testa} Il ${dir} dipende dall'affluenza, non dalla spesa media: lo scontrino medio tiene a ${fmtEur(riga.coperto_medio, { decimali: 2 })}, ${ec < 0 ? 'sono i clienti a mancare' : 'sono i clienti ad aumentare'}. La leva su cui agire è portare gente, non alzare i prezzi.`
  }
  if (leva === 'scontrino') {
    const dir = es < 0 ? 'calo' : 'crescita'
    return `${testa} Il ${dir} dipende dalla spesa media, non dall'affluenza: i coperti reggono e a muoversi è lo scontrino (${fmtEur(riga.coperto_medio, { decimali: 2 })}). La leva è il menu e la vendita suggerita, non il marketing.`
  }
  return `${testa} Le due componenti pesano in modo confrontabile: qui non c'è una sola leva, servono sia più coperti sia più scontrino.`
}

function TendenzaPeriodo({ righe, sede, meseInCorso }) {
  // Il mese di calendario in corso è parziale per costruzione: lasciarlo nel
  // grafico disegnerebbe un crollo verticale che non è successo. Resta nella
  // tabella, marcato.
  const perGrafico = useMemo(
    () => (righe ?? [])
      .filter(r => r.mese_str !== meseInCorso)
      .map(r => ({
        label: etichettaMeseBreve(r.mese_str),
        fatturato: num(r.fatturato),
        media_mobile_3m: num(r.media_mobile_3m),
        break_even: num(r.break_even),
      })),
    [righe, meseInCorso])

  // L'ultimo mese CHIUSO: è quello su cui ha senso leggere la scomposizione.
  const ultimoChiuso = useMemo(() => {
    const c = (righe ?? []).filter(r => r.mese_str !== meseInCorso &&
      num(r.effetto_coperti_pct) != null)
    return c.length ? c[c.length - 1] : null
  }, [righe, meseInCorso])

  const righeTabella = useMemo(() => [...(righe ?? [])].reverse(), [righe])
  const frase = frasePeriodo(ultimoChiuso, sede)

  return (
    <Sezione
      icona={TrendingDown}
      titolo={`Tendenza e scomposizione — ${NOME_SEDE[sede] || sede}`}
      sottotitolo={`ultimi ${MESI_TENDENZA} mesi: fatturato, media mobile a 3 mesi e break-even, poi la variazione anno su anno spaccata in affluenza e spesa media`}>

      {perGrafico.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center">
          Nessun mese chiuso disponibile per questa sede.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={perGrafico} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" fontSize={11} />
            <YAxis fontSize={11} tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} />
            <Tooltip content={<TooltipTendenza />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="fatturato" name="Fatturato"
              stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="media_mobile_3m" name="Media mobile 3 mesi"
              stroke="#10b981" strokeWidth={2} strokeDasharray="6 3" dot={false} />
            <Line type="monotone" dataKey="break_even" name="Break-even"
              stroke="#ef4444" strokeWidth={2} strokeDasharray="3 3" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {frase && (
        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm text-indigo-900 leading-relaxed">
          {frase}
        </div>
      )}

      {/* Tabella per mese: le due colonne dell'effetto sono affiancate apposta */}
      <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-200 text-left text-xs text-gray-500">
              <th className="py-2 font-semibold">Mese</th>
              <th className="py-2 text-right font-semibold">Fatturato</th>
              <th className="py-2 text-right font-semibold">Coperti</th>
              <th className="py-2 text-right font-semibold">Scontrino medio</th>
              <th className="py-2 text-right font-semibold">Var. su anno prec.</th>
              <th className="py-2 text-right font-semibold">Var. coperti</th>
              <th className="py-2 text-right font-semibold bg-indigo-50/70">Effetto coperti</th>
              <th className="py-2 text-right font-semibold bg-purple-50/70">Effetto scontrino</th>
              <th className="py-2 text-right font-semibold">Leva</th>
            </tr>
          </thead>
          <tbody>
            {righeTabella.map(r => {
              const parziale = r.mese_str === meseInCorso
              const leva = levaDominante(r.effetto_coperti_pct, r.effetto_scontrino_pct)
              const et = leva ? ETICHETTA_LEVA[leva] : null
              const varTot = num(r.var_su_anno_prec_pct)
              const ec = num(r.effetto_coperti_pct)
              const es = num(r.effetto_scontrino_pct)
              const colore = v => v == null ? 'text-gray-400' : v < 0 ? 'text-red-600' : 'text-emerald-700'
              return (
                <tr key={r.mese_str} className={`border-b border-gray-50 ${parziale ? 'text-gray-400 italic' : ''}`}>
                  <td className="py-2">
                    {etichettaMese(r.mese_str)}
                    {parziale && (
                      <span className="ml-1.5 text-[10px] not-italic font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">
                        in corso
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium">{fmtEur(r.fatturato)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtNum(r.coperti)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtEur(r.coperto_medio, { decimali: 2 })}</td>
                  <td className={`py-2 text-right tabular-nums font-semibold ${parziale ? '' : colore(varTot)}`}>
                    {fmtPct(varTot, { segno: true })}
                  </td>
                  <td className={`py-2 text-right tabular-nums ${parziale ? '' : colore(num(r.var_coperti_pct))}`}>
                    {fmtPct(r.var_coperti_pct, { segno: true })}
                  </td>
                  <td className={`py-2 text-right tabular-nums font-bold bg-indigo-50/40 ${parziale ? '' : colore(ec)}`}>
                    {fmtPct(ec, { segno: true })}
                  </td>
                  <td className={`py-2 text-right tabular-nums font-bold bg-purple-50/40 ${parziale ? '' : colore(es)}`}>
                    {fmtPct(es, { segno: true })}
                  </td>
                  <td className="py-2 text-right">
                    {et && !parziale ? (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${et.classe}`}>
                        {et.testo}
                      </span>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        <Avviso tipo="info">
          <strong>Effetto coperti</strong> ed <strong>effetto scontrino</strong> scompongono la
          stessa variazione: il primo è quanto sarebbe cambiato il fatturato se fosse cambiata solo
          l'affluenza, il secondo se fosse cambiata solo la spesa media. Non si sommano
          aritmeticamente alla variazione totale (c'è un termine incrociato), ma il loro confronto
          dice qual è la leva vera. Il mese di calendario in corso resta fuori dal grafico: essendo
          parziale disegnerebbe un crollo che non è avvenuto.
        </Avviso>
      </div>

      <NotaCopertura righe={(righe ?? []).length} fonte="v_tendenza_periodo"
        extra={`filtrata lato server per sede ${sede} · ultimi ${MESI_TENDENZA} mesi`} />
    </Sezione>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// BLOCCO 3 — Riepilogo operativo
// ════════════════════════════════════════════════════════════════════════════
/**
 * Le tre cifre grandi.
 *
 * `margine` in v_obiettivi_mese è fatturato − break_even_pro_rata: quando è
 * negativo, il suo valore assoluto È quanto manca al pareggio. Se il pareggio
 * è già coperto si passa a `gap_a_obiettivo`, che misura la stessa distanza ma
 * dall'obiettivo.
 *
 * La conversione in coperti e in scontrino usa i giorni di apertura già
 * conteggiati nel mese: "in ognuno dei giorni aperti sarebbero serviti N
 * coperti in più". Spalmare su un mese pieno un gap maturato in due giorni
 * darebbe un numero che non vuol dire niente.
 */
function calcolaRiepilogo(ob) {
  if (!ob) return null
  const fatturato = num(ob.fatturato) ?? 0
  const coperti = num(ob.coperti) ?? 0
  const gg = num(ob.gg_aperti) || 1
  const margine = num(ob.margine)
  const gapObiettivo = num(ob.gap_a_obiettivo)
  const scontrino = coperti > 0 ? fatturato / coperti : null

  let soglia, gap
  if (margine != null && margine < 0) { soglia = 'pareggio'; gap = -margine }
  else if (gapObiettivo != null && gapObiettivo > 0) { soglia = 'obiettivo'; gap = gapObiettivo }
  else { soglia = 'nessuna'; gap = 0 }

  return {
    soglia, gap, fatturato, coperti, gg, scontrino, margine,
    copertiGiorno: gap > 0 && scontrino ? gap / scontrino / gg : 0,
    scontrinoInPiu: gap > 0 && coperti > 0 ? gap / coperti : 0,
    proRata: (num(ob.quota_mese) ?? 1) < 1,
    beStimato: !!ob.be_stimato,
  }
}

function NumeroGrande({ icona: Icona, etichetta, valore, sotto, colore = 'gray' }) {
  const toni = {
    gray:  'text-gray-900',
    red:   'text-red-600',
    green: 'text-emerald-700',
  }
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold flex items-center gap-1.5">
        <Icona size={12} /> {etichetta}
      </p>
      <p className={`text-3xl font-bold tabular-nums mt-1 ${toni[colore]}`}>{valore}</p>
      {sotto && <p className="text-[11px] text-gray-500 mt-1 leading-snug">{sotto}</p>}
    </div>
  )
}

function RiepilogoOperativo({ ob, sede }) {
  const r = calcolaRiepilogo(ob)
  if (!r) {
    return (
      <Sezione icona={Target} titolo="Riepilogo operativo">
        <p className="text-sm text-gray-400 py-6 text-center">
          Nessuna riga in v_obiettivi_mese per questo mese e questa sede.
        </p>
      </Sezione>
    )
  }
  const nome = NOME_SEDE[sede] || sede
  const mese = etichettaMese(ob.mese_str)
  const sogliaTesto = r.soglia === 'pareggio' ? 'al pareggio' : 'all\'obiettivo'

  return (
    <Sezione
      icona={Target}
      titolo={`Riepilogo operativo — ${nome}, ${mese}`}
      sottotitolo="la stessa distanza detta in tre modi: in euro, in coperti al giorno, in scontrino medio">

      {r.soglia === 'nessuna' ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
          <strong>{nome}</strong> a {mese} ha già superato pareggio e obiettivo
          {r.margine != null && <> — margine sul break-even {fmtEur(r.margine)}</>}. Nessun gap da
          colmare{r.proRata ? ' sui giorni finora aperti' : ''}.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <NumeroGrande
              icona={Receipt}
              etichetta={`Mancano ${sogliaTesto}`}
              valore={fmtEur(r.gap)}
              colore="red"
              sotto={`su ${fmtNum(r.gg)} giorni di apertura${r.proRata ? ' finora conteggiati' : ''}`}
            />
            <NumeroGrande
              icona={Users}
              etichetta="Oppure: coperti in più al giorno"
              valore={`+${fmtNum(r.copertiGiorno)}`}
              sotto={`a scontrino fermo (${fmtEur(r.scontrino, { decimali: 2 })} per coperto)`}
            />
            <NumeroGrande
              icona={Receipt}
              etichetta="Oppure: scontrino medio in più"
              valore={`+${fmtEur(r.scontrinoInPiu, { decimali: 2 })}`}
              sotto={`a coperti fermi (${fmtNum(r.coperti)} coperti nel mese)`}
            />
          </div>

          <p className="text-sm text-gray-800 mt-3 leading-relaxed">
            A <strong>{nome}</strong> mancano <strong className="text-red-600">{fmtEur(r.gap)}</strong>{' '}
            {r.soglia === 'pareggio' ? 'per pareggiare' : 'per raggiungere l\'obiettivo di'} {mese}:
            sono <strong>{fmtNum(r.copertiGiorno)} coperti in più al giorno</strong> oppure{' '}
            <strong>+{fmtEur(r.scontrinoInPiu, { decimali: 2 })} di scontrino medio</strong>.
            Le due strade sono <em>alternative</em>: ne basta una.
          </p>
        </>
      )}

      {(r.proRata || r.beStimato) && (
        <div className="mt-3 space-y-1.5">
          {r.proRata && (
            <p className="text-[11px] text-gray-500">
              Mese ancora in corso: il confronto è <strong>pro-rata</strong> su{' '}
              {fmtNum(ob.gg_aperti)} giorni di apertura su {fmtNum(ob.gg_mese)} del mese. Fatturato
              e soglia sono entrambi parziali, quindi confrontabili fra loro.
            </p>
          )}
          {r.beStimato && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium bg-amber-50 border border-amber-200 text-amber-900 rounded-full px-2.5 py-1">
              <AlertTriangle size={11} />
              Break-even stimato sulla media dei 3 mesi chiusi
            </span>
          )}
        </div>
      )}

      <NotaCopertura righe={1} fonte="v_obiettivi_mese"
        extra={`filtrata lato server per sede ${sede} + ${mese}`} />
    </Sezione>
  )
}

// ════════════════════════════════════════════════════════════════════════════
export default function Fabbisogno() {
  const [sede, setSede] = useState('MA')
  const [mese, setMese] = useState(null)          // '2026-08', per il blocco 3
  const [fabbisogno, setFabbisogno] = useState(null)
  const [tendenza, setTendenza] = useState(null)
  const [obiettivo, setObiettivo] = useState(null)
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState(null)

  const inCorso = useMemo(() => meseCorrente(), [])
  const daMese = useMemo(() => meseIndietro(MESI_TENDENZA - 1), [])

  // 1) Griglia e tendenza: dipendono solo dalla sede. Cambiare il mese del
  //    riepilogo non deve rileggerle — la griglia è a 12 settimane mobili e la
  //    tendenza è già l'intera finestra.
  const carica = useCallback(async () => {
    setCaricamento(true)
    setErrore(null)
    try {
      // Ogni lettura è filtrata per sede lato server. Sulla tendenza c'è anche
      // il filtro sul mese: 7 anni di storico × 2 sedi supererebbero il cap
      // PostgREST senza dirlo.
      const [fb, td] = await Promise.all([
        supabase.from('v_fabbisogno_turno').select('*')
          .eq('sede', sede).order('giorno_iso').order('turno'),
        supabase.from('v_tendenza_periodo').select('*')
          .eq('sede', sede).gte('mese_str', daMese)
          .order('anno').order('mese'),
      ])
      if (fb.error) throw fb.error
      if (td.error) throw td.error

      const righeTendenza = td.data ?? []
      setFabbisogno(fb.data ?? [])
      setTendenza(righeTendenza)

      // Mese del riepilogo: si tiene quello scelto se esiste ancora per questa
      // sede, altrimenti l'ultimo disponibile.
      const disponibili = righeTendenza.map(r => r.mese_str)
      setMese(m => (m && disponibili.includes(m)) ? m : (disponibili[disponibili.length - 1] ?? null))
    } catch (e) {
      // Mai ricadere su []: una vista che non si carica non è una sede senza
      // dati, e "nessun gap" sarebbe un'informazione falsa.
      setFabbisogno(null); setTendenza(null)
      setErrore(e?.message || String(e))
    } finally {
      setCaricamento(false)
    }
  }, [sede, daMese])

  useEffect(() => { carica() }, [carica])

  // 2) Riepilogo del mese: lettura a sé, filtrata per sede + anno + mese.
  useEffect(() => {
    if (!mese) { setObiettivo(null); return }
    let annullato = false
    const [a, m] = mese.split('-').map(Number)
    supabase.from('v_obiettivi_mese').select('*')
      .eq('sede', sede).eq('anno', a).eq('mese', m).limit(1)
      .then(({ data, error }) => {
        if (annullato) return
        if (error) { setObiettivo(null); setErrore(error.message); return }
        setObiettivo((data ?? [])[0] ?? null)
      })
    return () => { annullato = true }
  }, [sede, mese])

  const mesiDisponibili = useMemo(
    () => [...(tendenza ?? [])].map(r => r.mese_str).reverse(), [tendenza])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Gauge size={20} className="text-indigo-600" /> Fabbisogno &amp; Tendenza
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Due domande, una pagina: <strong>quanto deve incassare ogni turno</strong> per coprire la
          sua quota di pareggio, e <strong>se il fatturato si muove per i coperti o per lo
          scontrino</strong>. Ogni scostamento è espresso in due modi alternativi — coperti in più
          <em> oppure</em> scontrino in più — perché sono due leve diverse e si sceglie l'una o
          l'altra, non tutte e due.
        </p>
      </header>

      {/* Filtri */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Sede</label>
            <select value={sede} onChange={e => setSede(e.target.value)}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm">
              {SEDE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">
              Mese del riepilogo
            </label>
            <select value={mese ?? ''} onChange={e => setMese(e.target.value)}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm">
              {mesiDisponibili.map(m => (
                <option key={m} value={m}>
                  {etichettaMese(m)}{m === inCorso ? ' (in corso)' : ''}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-gray-400 pb-2">
            La griglia del fabbisogno non segue il mese: è sempre la media delle ultime 12 settimane.
          </p>
        </div>
      </div>

      {caricamento && <Caricamento testo="Carico fabbisogno per turno e tendenza…" />}
      {errore && <Avviso tipo="error">Dati non disponibili: {errore}</Avviso>}

      {!caricamento && !errore && (
        <>
          {/* ── BLOCCO 1 ── */}
          {(fabbisogno ?? []).length === 0 ? (
            <Avviso tipo="warn">
              Nessuna riga in <strong>v_fabbisogno_turno</strong> per la sede{' '}
              {NOME_SEDE[sede] || sede}: servono chiusure di turno nelle ultime 12 settimane.
            </Avviso>
          ) : (
            <GrigliaFabbisogno righe={fabbisogno} sede={sede} />
          )}

          {/* ── BLOCCO 2 ── */}
          {(tendenza ?? []).length === 0 ? (
            <Avviso tipo="warn">
              Nessuna riga in <strong>v_tendenza_periodo</strong> per la sede{' '}
              {NOME_SEDE[sede] || sede} negli ultimi {MESI_TENDENZA} mesi.
            </Avviso>
          ) : (
            <TendenzaPeriodo righe={tendenza} sede={sede} meseInCorso={inCorso} />
          )}

          {/* ── BLOCCO 3 ── */}
          <RiepilogoOperativo ob={obiettivo} sede={sede} />

          <p className="text-[11px] text-gray-400">
            <CalendarDays size={11} className="inline mr-1" />
            Fonti (sola lettura, tutte filtrate lato server per sede): v_fabbisogno_turno,
            v_tendenza_periodo, v_obiettivi_mese. Le soglie di pareggio e obiettivo si impostano in{' '}
            <Link to="/obiettivi" className="text-indigo-600 hover:underline">Obiettivi &amp; Premi</Link>;
            il confronto fra i due turni in valore assoluto sta in{' '}
            <Link to="/turni-bi" className="text-indigo-600 hover:underline">Pranzo vs Cena</Link>.
          </p>
        </>
      )}
    </div>
  )
}
