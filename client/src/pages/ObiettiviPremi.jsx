/**
 * ObiettiviPremi.jsx — Obiettivi di sede e premi agli operatori.
 *
 * Il modello è UNO solo e vive nel database: qui non si ricalcola nulla, si
 * legge. Tre oggetti:
 *
 *   v_obiettivi_mese    una riga per sede × mese: fatturato, break-even,
 *                       obiettivo, stato (sotto_break_even | quorum | quantum)
 *   v_premi_operatore   una riga per sede × mese × operatore: punteggio del
 *                       criterio in uso, posizione e premio in euro
 *   obiettivi_config    una riga per sede: gli unici parametri modificabili
 *
 * Le regole, per esteso, perché a schermo devono essere leggibili anche da chi
 * non le ha scritte:
 *
 *   break-even = costo personale + fatture d'acquisto + costi fissi
 *   obiettivo  = break-even + pct_obiettivo%  (e, se usa_anno_prec è attivo, il
 *                maggiore fra questo e il fatturato dello stesso mese 2025)
 *   quorum     = break-even raggiunto  → si eroga quota_quorum_pct% del monte
 *   quantum    = obiettivo raggiunto   → monte premi pieno
 *   sotto il break-even                → nessun premio
 *
 * SUL MESE IN CORSO le soglie sono riproporzionate sui giorni di apertura
 * (break_even_pro_rata / obiettivo_pro_rata) e il break-even di mese pieno è
 * una STIMA sulla media dei 3 mesi chiusi (be_stimato). Va detto a schermo:
 * senza quella riga il confronto sembra sballato ed è invece l'unico onesto.
 *
 * Cap PostgREST: entrambe le viste si leggono SEMPRE filtrate per anno + mese
 * (e per sede quando la sede è selezionata), mai per intero.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Target, Trophy, SlidersHorizontal, Info, AlertTriangle, Loader2,
  Save, Medal, Calculator,
} from 'lucide-react'
import supabase from '../supabase'
import { fmtEur, fmtNum, fmtPct, NotaCopertura } from '../lib/tabella'

// ── Costanti condivise ─────────────────────────────────────────────────────
const SEDE_OPTIONS = [
  { value: 'MA',  label: 'Mameli (MA)' },
  { value: 'PN',  label: 'Predda Niedda (PN)' },
  { value: 'ALL', label: 'Entrambe' },
]
const NOME_SEDE = { MA: 'Mameli', PN: 'Predda Niedda' }
const MESI_IT = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

/** "2026-08" → "Agosto 2026". */
const etichettaMese = ms => {
  if (!ms) return '—'
  const [a, m] = String(ms).split('-')
  return `${MESI_IT[Number(m)] || m} ${a}`
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null }

/**
 * I cinque criteri ammessi da `obiettivi_config.criterio`, con l'etichetta
 * italiana, la spiegazione in una riga e il formato del punteggio: sono valori
 * diversi (percentuali e euro) e mostrarli tutti allo stesso modo mentirebbe.
 */
const CRITERI = {
  contributo_break_even: {
    label: 'Contributo al break-even',
    colonna: '% del break-even coperta',
    spiega: 'Quanta parte del break-even di sede è coperta dal fatturato dell\'operatore. Premia chi porta più euro dove servono, non chi ha più coperti.',
    fmt: v => fmtPct(v, { decimali: 1 }),
  },
  pct_obiettivo_individuale: {
    label: '% sull\'obiettivo individuale',
    colonna: '% sul proprio obiettivo',
    spiega: 'Quanto ha fatto rispetto al proprio target personale: mette sullo stesso piano chi lavora al pranzo e chi alla cena.',
    fmt: v => fmtPct(v, { decimali: 1 }),
  },
  fatturato_per_coperto: {
    label: 'Fatturato per coperto',
    colonna: 'Fatturato per coperto',
    spiega: 'Scontrino medio dell\'operatore. Premia chi vende meglio, non chi serve più tavoli.',
    fmt: v => fmtEur(v, { decimali: 2 }),
  },
  upsell_varianti: {
    label: 'Upsell da varianti',
    colonna: 'Upsell in €',
    spiega: 'Euro aggiunti con varianti e aggiunte. Premia solo la vendita suggerita, ignora il resto del conto.',
    fmt: v => fmtEur(v, { decimali: 2 }),
  },
  fatturato_assoluto: {
    label: 'Fatturato assoluto',
    colonna: 'Fatturato',
    spiega: 'Quanti euro ha battuto, senza correzioni. Il più semplice e il più sbilanciato verso chi fa più turni.',
    fmt: v => fmtEur(v),
  },
}
const criterioInfo = c => CRITERI[c] || {
  label: c || '—', colonna: 'Punteggio', spiega: 'Criterio non riconosciuto.', fmt: v => fmtNum(v, { decimali: 2 }),
}

// ── Componenti di base (stessa grammatica di Catalogo Articoli) ─────────────
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

// ── Semaforo: un solo posto in cui si decide il colore dello stato ──────────
const TONI = {
  sotto_break_even: {
    testo: 'Sotto break-even', barra: 'bg-red-500',
    chip: 'bg-red-100 text-red-700 border-red-200', bordo: 'border-red-200',
    titolo: 'text-red-700',
  },
  quorum: {
    testo: 'Quorum raggiunto', barra: 'bg-amber-500',
    chip: 'bg-amber-100 text-amber-800 border-amber-200', bordo: 'border-amber-200',
    titolo: 'text-amber-700',
  },
  quantum: {
    testo: 'Quantum: obiettivo raggiunto', barra: 'bg-emerald-500',
    chip: 'bg-emerald-100 text-emerald-800 border-emerald-200', bordo: 'border-emerald-200',
    titolo: 'text-emerald-700',
  },
}
// Sotto il 40% del mese l'esito è un giudizio su troppi pochi giorni: con 4
// giornate su 31, per giunta di alta stagione, "Quantum: obiettivo raggiunto"
// si legge come un verdetto quando è solo l'andamento dei primi giorni.
const TONO_PROVVISORIO = {
  testo: 'Andamento provvisorio', barra: 'bg-slate-400',
  chip: 'bg-slate-100 text-slate-700 border-slate-200', bordo: 'border-slate-200',
  titolo: 'text-slate-600',
}
const tono = (s, provvisorio) =>
  provvisorio ? TONO_PROVVISORIO : (TONI[s] || TONI.sotto_break_even)

/**
 * Barra di avanzamento con DUE tacche: break-even e obiettivo.
 *
 * La scala non è "0 → obiettivo": se il fatturato supera l'obiettivo la barra
 * si fermerebbe al 100% e il superamento sparirebbe. Il fondo scala è il
 * massimo fra obiettivo e fatturato, con un margine, così entrambe le tacche
 * restano sempre visibili e leggibili.
 */
function BarraDueTacche({ fatturato, breakEven, obiettivo, stato, provvisorio }) {
  const f = num(fatturato) ?? 0
  const be = num(breakEven) ?? 0
  const ob = num(obiettivo) ?? 0
  const scala = Math.max(ob, be, f) * 1.08 || 1
  const pos = v => Math.max(0, Math.min(100, (v / scala) * 100))
  const t = tono(stato, provvisorio)

  return (
    <div className="mt-3">
      <div className="relative h-7 rounded-lg bg-gray-100 overflow-hidden">
        <div className={`h-full ${t.barra} transition-all`} style={{ width: `${pos(f)}%` }} />
        {/* Tacca break-even */}
        <div className="absolute top-0 h-full border-l-2 border-gray-700/70"
          style={{ left: `${pos(be)}%` }} title={`Break-even ${fmtEur(be)}`} />
        {/* Tacca obiettivo */}
        <div className="absolute top-0 h-full border-l-2 border-dashed border-indigo-700/80"
          style={{ left: `${pos(ob)}%` }} title={`Obiettivo ${fmtEur(ob)}`} />
      </div>
      <div className="flex items-center gap-4 mt-1.5 text-[11px] text-gray-500 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0 border-t-2 border-gray-700/70" /> break-even {fmtEur(be)}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0 border-t-2 border-dashed border-indigo-700/80" /> obiettivo {fmtEur(ob)}
        </span>
        <span className="flex items-center gap-1">
          <span className={`inline-block w-3 h-2 rounded-sm ${t.barra}`} /> fatturato {fmtEur(f)}
        </span>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// BLOCCO 1 — Stato del mese
// ════════════════════════════════════════════════════════════════════════════
function CardSede({ riga }) {
  const provvisorio = riga.esito_provvisorio === true
  const t = tono(riga.stato, provvisorio)
  const proRata = (num(riga.quota_mese) ?? 1) < 1
  const gap = num(riga.gap_a_obiettivo)
  // Le soglie da confrontare col fatturato sono quelle PRO-RATA: sul mese
  // chiuso coincidono con quelle piene, sul mese in corso sono le uniche
  // confrontabili con un fatturato ancora parziale.
  const beRif = num(riga.break_even_pro_rata) ?? num(riga.break_even)
  const obRif = num(riga.obiettivo_pro_rata) ?? num(riga.obiettivo)

  return (
    <div className={`bg-white rounded-xl border-2 ${t.bordo} p-4`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-bold text-gray-900">
            {NOME_SEDE[riga.sede] || riga.sede}
            <span className="text-xs font-normal text-gray-400 ml-2">{etichettaMese(riga.mese_str)}</span>
          </h3>
          <p className={`text-sm font-semibold mt-0.5 ${t.titolo}`}>
            {t.testo}
            {provvisorio && (
              <span className="font-normal text-gray-400"> — {fmtNum(riga.gg_coperti)} giorni su {fmtNum(riga.gg_mese)}, troppo pochi per un verdetto</span>
            )}
          </p>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${t.chip}`}>
          {fmtPct(riga.pct_su_obiettivo)} dell'obiettivo
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Fatturato</p>
          <p className="text-xl font-bold text-gray-900 tabular-nums">{fmtEur(riga.fatturato)}</p>
          <p className="text-[11px] text-gray-400">{fmtNum(riga.coperti)} coperti</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Break-even</p>
          <p className="text-xl font-bold text-gray-700 tabular-nums">{fmtEur(beRif)}</p>
          <p className="text-[11px] text-gray-400">
            {proRata ? `mese pieno ${fmtEur(riga.break_even)}` : `${fmtPct(riga.pct_su_break_even)} coperto`}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Obiettivo</p>
          <p className="text-xl font-bold text-indigo-700 tabular-nums">{fmtEur(obRif)}</p>
          <p className="text-[11px] text-gray-400">
            break-even +{fmtPct(riga.pct_obiettivo, { decimali: 1 })}
            {proRata ? ` · mese pieno ${fmtEur(riga.obiettivo)}` : ''}
          </p>
        </div>
      </div>

      <BarraDueTacche fatturato={riga.fatturato} breakEven={beRif} obiettivo={obRif}
        stato={riga.stato} provvisorio={provvisorio} />

      <p className="text-sm mt-3">
        {gap == null ? (
          <span className="text-gray-400">Scostamento dall'obiettivo non disponibile.</span>
        ) : gap > 0 ? (
          <span className="text-gray-700">
            Mancano <strong className="text-red-600">{fmtEur(gap)}</strong> all'obiettivo
            {proRata ? ' pro-rata' : ''}.
          </span>
        ) : (
          <span className="text-gray-700">
            Obiettivo{proRata ? ' pro-rata' : ''} superato di{' '}
            <strong className="text-emerald-700">{fmtEur(Math.abs(gap))}</strong>.
          </span>
        )}
        {' '}Margine sul break-even:{' '}
        <strong className={num(riga.margine) >= 0 ? 'text-emerald-700' : 'text-red-600'}>
          {fmtEur(riga.margine)}
        </strong>.
      </p>

      {(riga.be_stimato || proRata) && (
        <div className="mt-2.5 space-y-1.5">
          {riga.be_stimato && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium bg-amber-50 border border-amber-200 text-amber-900 rounded-full px-2.5 py-1">
              <AlertTriangle size={11} />
              Break-even stimato sulla media dei 3 mesi chiusi
            </span>
          )}
          {proRata && (
            <p className="text-[11px] text-gray-500">
              Confronto pro-rata su <strong>{fmtNum(riga.gg_coperti ?? riga.gg_aperti)} giorni su {fmtNum(riga.gg_mese)}</strong>{' '}
              ({fmtPct((num(riga.quota_mese) ?? 0) * 100)} del mese): il fatturato è parziale, quindi
              anche break-even e obiettivo sono riproporzionati.
              {num(riga.gg_coperti) > num(riga.gg_aperti) && (
                <> Sono giorni di <strong>calendario</strong>, non di apertura: le{' '}
                {fmtNum(num(riga.gg_coperti) - num(riga.gg_aperti))} giornate di chiusura contano
                comunque nei costi, perché affitto e stipendi maturano lo stesso.</>
              )}
            </p>
          )}
        </div>
      )}

      {num(riga.fatturato_anno_prec) > 0 && (
        <p className="text-[11px] text-gray-500 mt-1.5">
          Stesso mese dell'anno precedente: {fmtEur(riga.fatturato_anno_prec)} — entra
          nell'obiettivo solo se "tieni conto dell'anno precedente" è attivo nelle impostazioni.
        </p>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// BLOCCO 2 — Composizione del break-even
// ════════════════════════════════════════════════════════════════════════════
// Mese chiuso: le tre voci sono il consuntivo.
// Mese in corso: la colonna che conta è quella PRO-RATA (media dei 3 mesi chiusi
// riproporzionata sui giorni coperti), perché è l'unica confrontabile con un
// fatturato parziale. Prima la tabella mostrava solo il "già registrato" —
// personale a €0 (le buste paga arrivano il mese dopo), fatture solo quelle
// già protocollate e costi fissi del MESE INTERO — e il totale non aveva
// niente a che vedere col break-even usato per le soglie.
const VOCI_BE = [
  ['Costo del personale', 'costo_personale', 'costo_personale_pro_rata'],
  ['Fatture d\'acquisto',  'costo_fatture',   'costo_fatture_pro_rata'],
  ['Costi fissi',          'costi_fissi',     'costi_fissi_pro_rata'],
]

function TabellaBreakEven({ riga }) {
  const fatt = num(riga.fatturato)
  const inc = v => (fatt && v != null ? fmtPct((v / fatt) * 100) : '—')
  // Il pro-rata esiste solo sul mese in corso: sul mese chiuso quota = 1 e le
  // due colonne coinciderebbero, quindi se ne mostra una sola.
  const proRata = (num(riga.quota_mese) ?? 1) < 1
  const totale = proRata ? num(riga.break_even_pro_rata) : num(riga.break_even_rilevato)

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800">
        {NOME_SEDE[riga.sede] || riga.sede}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-[11px] text-gray-400">
            <th className="py-1.5 pl-3 font-normal">Voce</th>
            {proRata && <th className="py-1.5 text-right font-normal">Già registrato</th>}
            <th className="py-1.5 text-right font-normal">
              {proRata ? `Atteso su ${fmtNum(riga.gg_coperti)} gg` : 'Importo'}
            </th>
            <th className="py-1.5 pr-3 text-right font-normal">% sul fatturato</th>
          </tr>
        </thead>
        <tbody>
          {VOCI_BE.map(([label, campo, campoPro]) => {
            const valore = proRata ? num(riga[campoPro]) : num(riga[campo])
            return (
              <tr key={campo} className="border-b border-gray-50">
                <td className="py-2 pl-3 text-gray-700">{label}</td>
                {proRata && (
                  <td className="py-2 text-right tabular-nums text-gray-400">
                    {fmtEur(riga[campo], { decimali: 2 })}
                  </td>
                )}
                <td className="py-2 text-right tabular-nums font-medium text-gray-900">
                  {fmtEur(valore, { decimali: 2 })}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-gray-500">{inc(valore)}</td>
              </tr>
            )
          })}
          <tr className="border-t-2 border-gray-200 bg-gray-50/60">
            <td className="py-2 pl-3 font-bold text-gray-900">
              {proRata ? 'Break-even pro-rata' : 'Break-even rilevato'}
            </td>
            {proRata && (
              <td className="py-2 text-right tabular-nums text-gray-400">
                {fmtEur(riga.break_even_rilevato, { decimali: 2 })}
              </td>
            )}
            <td className="py-2 text-right tabular-nums font-bold text-gray-900">
              {fmtEur(totale, { decimali: 2 })}
            </td>
            <td className="py-2 pr-3 text-right tabular-nums font-semibold text-gray-600">
              {inc(totale)}
            </td>
          </tr>
          <tr>
            <td className="py-2 pl-3 text-xs text-gray-500">Fatturato del mese</td>
            {proRata && <td />}
            <td className="py-2 text-right tabular-nums text-gray-600">
              {fmtEur(riga.fatturato, { decimali: 2 })}
            </td>
            <td className="py-2 pr-3 text-right tabular-nums text-gray-400">100,0%</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function ComposizioneBreakEven({ righe }) {
  return (
    <Sezione
      icona={Calculator}
      titolo="Come è fatto il break-even"
      sottotitolo="costo personale + fatture d'acquisto + costi fissi: questi tre numeri, e nient'altro — sul mese in corso divisi per i giorni già coperti">
      <div className={`grid gap-3 ${righe.length > 1 ? 'lg:grid-cols-2' : ''}`}>
        {righe.map(r => <TabellaBreakEven key={r.sede} riga={r} />)}
      </div>

      {righe.some(r => (num(r.quota_mese) ?? 1) < 1) && (
        <div className="mt-3">
          <Avviso tipo="warn">
            Sul mese in corso la colonna <strong>Già registrato</strong> è incompleta per forza: le
            buste paga arrivano il mese dopo (personale a €0) e le fatture d'acquisto entrano con
            giorni di ritardo. La colonna <strong>Atteso</strong> prende invece la media di ciascuna
            voce sui 3 mesi chiusi e la divide per i giorni di calendario già coperti — quindi le tre
            voci sommano esattamente al break-even usato per le soglie qui sopra, e sono
            confrontabili col fatturato incassato finora.
          </Avviso>
        </div>
      )}
    </Sezione>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// BLOCCO 3 — Classifica e premi
// ════════════════════════════════════════════════════════════════════════════
/** La frase in testa alla classifica: a parole, quanto si eroga e perché. */
function frasePremi(ob, erogato) {
  const nome = NOME_SEDE[ob.sede] || ob.sede
  const monte = num(ob.monte_premi_euro) ?? 0
  const quota = num(ob.quota_quorum_pct) ?? 0
  // Con pochi giorni di mese il premio non è "maturato": è la proiezione di un
  // andamento. Dirlo, altrimenti la frase suona come una liquidazione decisa.
  const seProvvisorio = ob.esito_provvisorio
    ? ` Attenzione: siamo a ${fmtNum(ob.gg_coperti)} giorni su ${fmtNum(ob.gg_mese)}, il dato è ancora un andamento e non un premio maturato.`
    : ''
  if (ob.stato === 'quantum') {
    return `${nome} ha raggiunto l'obiettivo di ${fmtEur(ob.obiettivo_pro_rata ?? ob.obiettivo)}: erogato il monte pieno di ${fmtEur(monte)}, diviso fra i primi ${fmtNum(ob.n_premiati)}.${seProvvisorio}`
  }
  if (ob.stato === 'quorum') {
    return `${nome} ha superato il break-even ma non l'obiettivo: quorum raggiunto, si eroga il ${fmtPct(quota, { decimali: 0 })} del monte, cioè ${fmtEur(erogato ?? (monte * quota) / 100)}.${seProvvisorio}`
  }
  return `${nome} è sotto break-even: nessun premio questo mese. Il monte da ${fmtEur(monte)} si sblocca solo superando il break-even.`
}

function TabellaPremi({ ob, righe }) {
  const info = criterioInfo(ob?.criterio)
  const nPremiati = num(ob?.n_premiati) ?? 0
  const erogato = righe.reduce((s, r) => s + (num(r.premio_euro) ?? 0), 0)
  const t = tono(ob?.stato)
  const medaglia = ['🥇', '🥈', '🥉']

  return (
    <Sezione
      icona={Trophy}
      titolo={`Classifica e premi — ${NOME_SEDE[ob?.sede] || ob?.sede}`}
      sottotitolo={`criterio in uso: ${info.label} — ${info.spiega}`}>
      <div className={`rounded-lg border px-3 py-2 text-sm mb-3 ${t.chip}`}>
        {frasePremi(ob, erogato)}
        {erogato > 0 && (
          <span className="block text-xs mt-0.5 opacity-80">
            Somma dei premi effettivamente assegnati in classifica:{' '}
            <strong>{fmtEur(erogato, { decimali: 2 })}</strong>.
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-200 text-left text-xs text-gray-500">
              <th className="py-2 font-semibold w-10 text-right">#</th>
              <th className="py-2 font-semibold">Operatore</th>
              <th className="py-2 text-right font-semibold">{info.colonna}</th>
              <th className="py-2 text-right font-semibold">% BE per coperto</th>
              <th className="py-2 text-right font-semibold">Fatturato</th>
              <th className="py-2 text-right font-semibold">Coperti</th>
              <th className="py-2 text-right font-semibold">Upsell</th>
              <th className="py-2 text-right font-semibold">Premio</th>
            </tr>
          </thead>
          <tbody>
            {righe.map(r => {
              const pos = num(r.posizione)
              const premiato = pos != null && pos <= nPremiati
              const premio = num(r.premio_euro) ?? 0
              return (
                <tr key={r.operatore}
                  className={`border-b border-gray-50 ${premiato ? 'bg-amber-50/50' : 'text-gray-400'}`}>
                  <td className="py-2 text-right tabular-nums">
                    {premiato && medaglia[pos - 1] ? medaglia[pos - 1] : fmtNum(pos)}
                  </td>
                  <td className={`py-2 ${premiato ? 'font-semibold text-gray-900' : ''}`}>
                    {r.operatore}
                    {premiato && (
                      <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                        quota {fmtPct(r.quota_pct, { decimali: 0 })}
                      </span>
                    )}
                  </td>
                  <td className={`py-2 text-right tabular-nums font-semibold ${premiato ? 'text-gray-900' : ''}`}>
                    {info.fmt(r.punteggio)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{fmtPct(r.pct_break_even_coperto)}</td>
                  <td className={`py-2 text-right tabular-nums ${premiato ? 'text-gray-700' : ''}`}>
                    {fmtEur(r.fatturato)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{fmtNum(r.coperti)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtEur(r.upsell_euro, { decimali: 2 })}</td>
                  <td className={`py-2 text-right tabular-nums font-bold ${premio > 0 ? 'text-emerald-700' : 'text-gray-300'}`}>
                    {premio > 0 ? fmtEur(premio, { decimali: 2 }) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {righe.length === 0 && (
        <p className="text-sm text-gray-400 py-8 text-center">
          Nessun operatore con venduto in questo mese per questa sede.
        </p>
      )}
      <NotaCopertura righe={righe.length} fonte="v_premi_operatore"
        extra={`filtrata lato server per sede + ${etichettaMese(ob?.mese_str)}`} />
    </Sezione>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// BLOCCO 4 — Impostazioni per sede (unica parte scrivibile della pagina)
// ════════════════════════════════════════════════════════════════════════════
function FormConfig({ config, onSalvato }) {
  const [bozza, setBozza] = useState(() => ({
    pct_obiettivo: config.pct_obiettivo ?? 2,
    usa_anno_prec: !!config.usa_anno_prec,
    n_premiati: Number(config.n_premiati) || 3,
    monte_premi_euro: config.monte_premi_euro ?? 200,
    split: (config.split_pct || []).map(v => Number(v)),
    quota_quorum_pct: config.quota_quorum_pct ?? 40,
    criterio: config.criterio || 'contributo_break_even',
  }))
  const [salvataggio, setSalvataggio] = useState(false)
  const [esito, setEsito] = useState(null)

  // La lunghezza di split_pct deve seguire n_premiati: una quota in più (o in
  // meno) rispetto ai premiati è una configurazione che non vuol dire niente.
  const split = useMemo(() => {
    const s = [...bozza.split]
    while (s.length < bozza.n_premiati) s.push(0)
    return s.slice(0, bozza.n_premiati)
  }, [bozza.split, bozza.n_premiati])

  const sommaSplit = split.reduce((s, v) => s + (Number(v) || 0), 0)
  const splitOk = Math.abs(sommaSplit - 100) < 0.01

  const setCampo = (k, v) => { setBozza(b => ({ ...b, [k]: v })); setEsito(null) }
  const setQuota = (i, v) => {
    setBozza(b => {
      const s = [...b.split]
      while (s.length < b.n_premiati) s.push(0)
      s[i] = v === '' ? '' : Number(v)
      return { ...b, split: s }
    })
    setEsito(null)
  }

  async function salva() {
    if (!splitOk) {
      setEsito({ ok: false, msg: `Le quote sommano a ${fmtPct(sommaSplit)} invece che a 100%: correggile prima di salvare.` })
      return
    }
    setSalvataggio(true)
    setEsito(null)
    try {
      const { error } = await supabase.from('obiettivi_config').update({
        pct_obiettivo: Number(bozza.pct_obiettivo),
        usa_anno_prec: bozza.usa_anno_prec,
        n_premiati: Number(bozza.n_premiati),
        monte_premi_euro: Number(bozza.monte_premi_euro),
        split_pct: split.map(v => Number(v) || 0),
        quota_quorum_pct: Number(bozza.quota_quorum_pct),
        criterio: bozza.criterio,
      }).eq('sede', config.sede)
      if (error) throw error
      setEsito({ ok: true, msg: 'Impostazioni salvate: i numeri qui sopra sono già ricalcolati.' })
      // Ricarica TUTTO: obiettivo, classifica e premi dipendono da questi
      // parametri, e lasciarli fermi farebbe sembrare il salvataggio inefficace.
      await onSalvato()
    } catch (e) {
      setEsito({ ok: false, msg: `Salvataggio non riuscito: ${e?.message || String(e)}` })
    } finally {
      setSalvataggio(false)
    }
  }

  const campo = 'w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm'
  const etichetta = 'block text-[11px] font-medium text-gray-500 mb-1'

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <h4 className="text-sm font-bold text-gray-800 mb-3">
        {NOME_SEDE[config.sede] || config.sede}
        {config.attivo === false && (
          <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
            non attiva
          </span>
        )}
      </h4>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className={etichetta}>Obiettivo: break-even +%</label>
          <input type="number" step="0.1" value={bozza.pct_obiettivo}
            onChange={e => setCampo('pct_obiettivo', e.target.value)} className={campo} />
        </div>
        <div>
          <label className={etichetta}>Monte premi (€)</label>
          <input type="number" step="10" value={bozza.monte_premi_euro}
            onChange={e => setCampo('monte_premi_euro', e.target.value)} className={campo} />
        </div>
        <div>
          <label className={etichetta}>Quota erogata al quorum (%)</label>
          <input type="number" step="1" value={bozza.quota_quorum_pct}
            onChange={e => setCampo('quota_quorum_pct', e.target.value)} className={campo} />
        </div>
        <div>
          <label className={etichetta}>Numero di premiati</label>
          <select value={bozza.n_premiati}
            onChange={e => setCampo('n_premiati', Number(e.target.value))} className={campo}>
            <option value={2}>2 premiati</option>
            <option value={3}>3 premiati</option>
          </select>
        </div>
      </div>

      <div className="mt-3">
        <label className={etichetta}>
          Ripartizione del monte fra i premiati (la somma deve fare 100%)
        </label>
        <div className="flex items-end gap-2 flex-wrap">
          {split.map((v, i) => (
            <div key={i} className="w-24">
              <span className="block text-[10px] text-gray-400 mb-0.5">{i + 1}º posto</span>
              <div className="relative">
                <input type="number" step="1" value={v}
                  onChange={e => setQuota(i, e.target.value)}
                  className={`${campo} pr-6 ${splitOk ? '' : 'border-red-300 bg-red-50'}`} />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
              </div>
            </div>
          ))}
          <span className={`text-xs font-semibold pb-2 ${splitOk ? 'text-emerald-700' : 'text-red-600'}`}>
            somma {fmtPct(sommaSplit)}
            {!splitOk && ' — deve fare 100%'}
          </span>
        </div>
        {splitOk && Number(bozza.monte_premi_euro) > 0 && (
          <p className="text-[11px] text-gray-500 mt-1">
            Con quantum:{' '}
            {split.map((v, i) => `${i + 1}º ${fmtEur((Number(bozza.monte_premi_euro) * (Number(v) || 0)) / 100, { decimali: 2 })}`).join(' · ')}
            {' '}· con solo quorum:{' '}
            {split.map((v, i) => `${i + 1}º ${fmtEur((Number(bozza.monte_premi_euro) * (Number(bozza.quota_quorum_pct) || 0) / 100 * (Number(v) || 0)) / 100, { decimali: 2 })}`).join(' · ')}
          </p>
        )}
      </div>

      <div className="mt-3">
        <label className={etichetta}>Criterio della classifica</label>
        <select value={bozza.criterio} onChange={e => setCampo('criterio', e.target.value)}
          className={`${campo} max-w-md`}>
          {Object.entries(CRITERI).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <p className="text-[11px] text-gray-500 mt-1">{criterioInfo(bozza.criterio).spiega}</p>
      </div>

      <label className="flex items-start gap-2 mt-3 cursor-pointer">
        <input type="checkbox" checked={bozza.usa_anno_prec}
          onChange={e => setCampo('usa_anno_prec', e.target.checked)}
          className="w-4 h-4 rounded accent-indigo-600 mt-0.5" />
        <span className="text-sm text-gray-700">
          Tieni conto dell'anno precedente
          <span className="block text-[11px] text-gray-500">
            Con questo attivo l'obiettivo è il <strong>maggiore</strong> fra break-even +
            {fmtPct(bozza.pct_obiettivo, { decimali: 1 })} e il fatturato dello stesso mese dell'anno
            prima. Oggi è disattivato: l'obiettivo segue solo i costi.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3 mt-4">
        <button type="button" onClick={salva} disabled={salvataggio || !splitOk}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            splitOk && !salvataggio
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}>
          {salvataggio ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Salva impostazioni
        </button>
        {esito && (
          <span className={`text-xs ${esito.ok ? 'text-emerald-700' : 'text-red-600'}`}>{esito.msg}</span>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
export default function ObiettiviPremi() {
  const [sede, setSede] = useState('ALL')
  const [mesi, setMesi] = useState([])      // ['2026-08', '2026-07', …]
  const [mese, setMese] = useState(null)    // '2026-08'
  const [obiettivi, setObiettivi] = useState(null)
  const [premi, setPremi] = useState(null)
  const [config, setConfig] = useState(null)
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState(null)

  // 1) Elenco dei mesi disponibili: una sola lettura leggera (sede+anno+mese),
  //    così il selettore mostra solo mesi che esistono davvero a database.
  useEffect(() => {
    let annullato = false
    supabase.from('v_obiettivi_mese').select('mese_str')
      .order('mese_str', { ascending: false }).limit(400)
      .then(({ data, error }) => {
        if (annullato) return
        if (error) { setErrore(error.message); setCaricamento(false); return }
        const lista = [...new Set((data ?? []).map(r => r.mese_str))].sort().reverse()
        setMesi(lista)
        setMese(m => m ?? lista[0] ?? null)
        if (!lista.length) setCaricamento(false)
      })
    return () => { annullato = true }
  }, [])

  // 2) Dati del mese selezionato. SEMPRE filtrati lato server per anno + mese
  //    (e per sede quando ne è scelta una): il cap PostgREST è di 1000 righe e
  //    non segnala nulla quando taglia.
  const carica = useCallback(async () => {
    if (!mese) return
    const [a, m] = mese.split('-').map(Number)
    setCaricamento(true)
    setErrore(null)
    try {
      const filtro = q => {
        let x = q.eq('anno', a).eq('mese', m)
        if (sede !== 'ALL') x = x.eq('sede', sede)
        return x
      }
      const [ob, pr, cf] = await Promise.all([
        filtro(supabase.from('v_obiettivi_mese').select('*')).order('sede'),
        filtro(supabase.from('v_premi_operatore').select('*')).order('sede').order('posizione'),
        supabase.from('obiettivi_config').select('*').order('sede'),
      ])
      if (ob.error) throw ob.error
      if (pr.error) throw pr.error
      if (cf.error) throw cf.error
      setObiettivi(ob.data ?? [])
      setPremi(pr.data ?? [])
      setConfig(cf.data ?? [])
    } catch (e) {
      // Mai ricadere su []: una vista che non si carica non è un mese senza
      // dati, e "nessun premio" sarebbe un'informazione falsa.
      setObiettivi(null); setPremi(null); setConfig(null)
      setErrore(e?.message || String(e))
    } finally {
      setCaricamento(false)
    }
  }, [mese, sede])

  useEffect(() => { carica() }, [carica])

  const sediMostrate = useMemo(
    () => (obiettivi ?? []).slice().sort((x, y) => String(x.sede).localeCompare(String(y.sede))),
    [obiettivi])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Target size={20} className="text-indigo-600" /> Obiettivi &amp; Premi
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          L'obiettivo di sede è in euro e parte dai costi: <strong>break-even</strong> = personale +
          fatture + costi fissi, <strong>obiettivo</strong> = break-even + una percentuale.
          Superato il break-even scatta il <strong>quorum</strong> (una quota del monte premi),
          superato l'obiettivo il <strong>quantum</strong> (monte pieno). Sotto il break-even non si
          eroga nulla.
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
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Mese</label>
            <select value={mese ?? ''} onChange={e => setMese(e.target.value)}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm">
              {mesi.map(m => <option key={m} value={m}>{etichettaMese(m)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {caricamento && <Caricamento testo="Carico obiettivi, classifica e premi…" />}
      {errore && <Avviso tipo="error">Dati non disponibili: {errore}</Avviso>}

      {!caricamento && !errore && sediMostrate.length === 0 && (
        <Avviso tipo="warn">
          Nessuna riga in <strong>v_obiettivi_mese</strong> per {etichettaMese(mese)}
          {sede !== 'ALL' ? ` e sede ${NOME_SEDE[sede]}` : ''}.
        </Avviso>
      )}

      {!caricamento && !errore && sediMostrate.length > 0 && (
        <>
          {/* ── BLOCCO 1 ── */}
          <div className={`grid gap-3 ${sediMostrate.length > 1 ? 'lg:grid-cols-2' : ''}`}>
            {sediMostrate.map(r => <CardSede key={r.sede} riga={r} />)}
          </div>

          {/* ── BLOCCO 2 ── */}
          <ComposizioneBreakEven righe={sediMostrate} />

          {/* ── BLOCCO 3 ── */}
          {sediMostrate.map(ob => (
            <TabellaPremi key={ob.sede} ob={ob}
              righe={(premi ?? [])
                .filter(p => p.sede === ob.sede)
                .sort((a, b) => (num(a.posizione) ?? 999) - (num(b.posizione) ?? 999))} />
          ))}

          {/* ── BLOCCO 4 ── */}
          <Sezione
            icona={SlidersHorizontal}
            titolo="Impostazioni del modello"
            sottotitolo="l'unica parte scrivibile della pagina: cambia i parametri e i numeri qui sopra si aggiornano">
            <div className="space-y-3">
              {(config ?? [])
                .filter(c => sede === 'ALL' || c.sede === sede)
                .map(c => <FormConfig key={c.sede} config={c} onSalvato={carica} />)}
              {(config ?? []).length === 0 && (
                <p className="text-sm text-gray-400 py-6 text-center">
                  Nessuna configurazione in obiettivi_config.
                </p>
              )}
            </div>
            <div className="mt-3">
              <Avviso tipo="info">
                I premi si dividono fra i primi <strong>{fmtNum(sediMostrate[0]?.n_premiati)}</strong>{' '}
                della classifica secondo le quote impostate. Il monte è per sede e per mese:
                al <strong>quorum</strong> se ne eroga solo la quota indicata, al{' '}
                <strong>quantum</strong> tutto. La classifica e i premi che vedi sopra sono quelli
                calcolati dal database con questi stessi parametri — non un'anteprima.
              </Avviso>
            </div>
          </Sezione>

          <p className="text-[11px] text-gray-400">
            <Medal size={11} className="inline mr-1" />
            Fonti: v_obiettivi_mese e v_premi_operatore (sola lettura, filtrate lato server per
            sede e mese), obiettivi_config (scrivibile). La tab{' '}
            <Link to="/venduto?tab=obiettivi" className="text-indigo-600 hover:underline">
              Obiettivi Team del Venduto
            </Link>{' '}
            resta il dettaglio operativo in pezzi per singolo operatore.
          </p>
        </>
      )}
    </div>
  )
}
