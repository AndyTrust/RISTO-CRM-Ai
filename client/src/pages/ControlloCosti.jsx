import React, { useEffect, useMemo, useState } from 'react'
import { NavLink, useParams, Link } from 'react-router-dom'
import {
  Gauge, Building2, SlidersHorizontal, RefreshCw, AlertTriangle, Info,
  ArrowRight, Search, Check,
} from 'lucide-react'
import { controlloCosti } from '../api/client'
import {
  fmtEur, fmtPct, useOrdinamento, IconaOrdine, BottoneCsv,
} from '../lib/tabella'
import { Semaforo, PillolaEsito, CellaSemaforo, LegendaSemaforo, stileEsito } from '../components/Semaforo'
import PageStatsWidget from '../components/PageStatsWidget'
import PageAssistant from '../components/PageAssistant'

/**
 * ControlloCosti.jsx — la sezione che tiene insieme personale, food, fissi e
 * break-even sotto un'unica lettura.
 *
 * REGOLA DI QUESTA PAGINA: non calcola niente.
 * Percentuali, soglie ed esito del semaforo arrivano già decisi da
 * v_controllo_costi_mensile e v_controllo_costi_voci. Il break-even nel progetto
 * era già calcolato in sei modi diversi che non coincidevano fra loro: aggiungere
 * qui un settimo calcolo avrebbe peggiorato esattamente il problema che questa
 * sezione esiste per risolvere.
 *
 * TRE LIVELLI, non due sedi:
 *   MA / PN  costo del locale, con una prova (XML, DDT, cedolino, contratto)
 *   GR       costo dell'azienda che non appartiene a un locale
 *   TOT      l'azienda intera
 *
 * DUE MODI DI LETTURA:
 *   DIRETTO  ogni livello mostra solo ciò che gli appartiene. È il numero
 *            difendibile, ed è quello su cui si misurano gli obiettivi.
 *   PIENO    i costi di gruppo ribaltati su MA e PN pro-fatturato. Risponde a
 *            "quanto rende davvero Mameli, tutto compreso".
 */

const SEZIONI = [
  { id: 'cruscotto',  path: '/controllo-costi',            icon: Gauge,            label: 'Cruscotto',  desc: 'Semaforo mensile per livello e voce di costo' },
  { id: 'fornitori',  path: '/controllo-costi/fornitori',  icon: Building2,        label: 'Fornitori',  desc: 'Chi è food e chi è servizi: cosa manca e quanto vale' },
  { id: 'parametri',  path: '/controllo-costi/parametri',  icon: SlidersHorizontal, label: 'Parametri', desc: 'Soglie del semaforo e obiettivi, per sede e per voce' },
]

const LIVELLI = [
  { id: 'MA',  label: 'Mameli' },
  { id: 'PN',  label: 'Predda Niedda' },
  { id: 'GR',  label: 'Gruppo' },
  { id: 'TOT', label: 'Totale azienda' },
]

const VOCI = [
  { id: 'PERSONALE',             label: 'Personale',   corto: 'Personale' },
  { id: 'FOOD',                  label: 'Food e beverage', corto: 'Food' },
  { id: 'FISSI_STRUTTURA',       label: 'Fissi di struttura', corto: 'Fissi' },
  { id: 'SERVIZI_RICORRENTI',    label: 'Servizi ricorrenti', corto: 'Servizi' },
  { id: 'COMMISSIONI_VARIABILI', label: 'Commissioni e variabili', corto: 'Commissioni' },
  { id: 'COSTI_TOTALI',          label: 'Costi totali', corto: 'Totale' },
]

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']

const num = (v) => (v == null || v === '' ? null : Number(v))

// ═══════════════════════════════════════════════════════════════════
// Pagina
// ═══════════════════════════════════════════════════════════════════
export default function ControlloCosti() {
  const { sezione } = useParams()
  const attiva = SEZIONI.find((s) => s.id === sezione) || SEZIONI[0]

  // Le due scelte valgono per tutta la sezione: si decidono una volta.
  const [base, setBase] = useState('NETTO')
  const [modalita, setModalita] = useState('DIRETTO')

  return (
    <>
      <PageStatsWidget />

      <div className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur border-b border-gray-200 -mx-6 px-6 pt-4 pb-3 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Controllo Costi</h1>
            <p className="text-sm text-gray-500 mt-0.5">{attiva.desc}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Interruttore
              etichetta="Base"
              valore={base}
              onChange={setBase}
              opzioni={[
                { id: 'NETTO', label: 'Netto IVA', titolo: 'Fatturato scorporato del 10% e imponibile delle fatture. È la base del conto economico.' },
                { id: 'LORDO', label: 'Lordo',     titolo: 'Corrispettivi e totali fattura come li vedi in cassa e in fattura.' },
              ]}
            />
            <Interruttore
              etichetta="Lettura"
              valore={modalita}
              onChange={setModalita}
              opzioni={[
                { id: 'DIRETTO', label: 'Diretta', titolo: 'Ogni livello mostra solo i costi che gli appartengono davvero. Nessuna ripartizione.' },
                { id: 'PIENO',   label: 'Piena',   titolo: 'I costi di gruppo ribaltati su Mameli e Predda Niedda in proporzione al fatturato.' },
              ]}
            />
          </div>
        </div>

        <nav className="flex gap-1 mt-3 overflow-x-auto">
          {SEZIONI.map((s) => {
            const Icona = s.icon
            return (
              <NavLink
                key={s.id}
                to={s.path}
                end={s.id === 'cruscotto'}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border whitespace-nowrap transition ${
                    isActive
                      ? 'border-blue-600 text-blue-700 bg-blue-50'
                      : 'border-transparent text-gray-600 hover:bg-gray-100'
                  }`
                }
              >
                <Icona size={15} />
                {s.label}
              </NavLink>
            )
          })}
        </nav>
      </div>

      {attiva.id === 'cruscotto' && <Cruscotto base={base} modalita={modalita} />}
      {attiva.id === 'fornitori' && <SezioneFornitori />}
      {attiva.id === 'parametri' && <SezioneParametri />}

      <PageAssistant
        pagina="Controllo Costi"
        suggerimenti={[
          'Il costo del personale è dentro i parametri questo mese?',
          'Quanto pesano i costi di gruppo su Mameli?',
          'Quali fornitori non sono ancora classificati?',
          'Confronta Mameli e Predda Niedda sulle voci di costo',
        ]}
      />
    </>
  )
}

// ── interruttore a due o più posizioni ────────────────────────────
function Interruttore({ etichetta, valore, onChange, opzioni }) {
  return (
    <div>
      <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">{etichetta}</label>
      <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white">
        {opzioni.map((o) => (
          <button
            key={o.id}
            title={o.titolo}
            onClick={() => onChange(o.id)}
            className={`px-3 py-1.5 text-sm font-medium transition ${
              valore === o.id ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 1. CRUSCOTTO
// ═══════════════════════════════════════════════════════════════════
function Cruscotto({ base, modalita }) {
  const [mensile, setMensile] = useState([])
  const [voci, setVoci] = useState([])
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState(null)
  const [livello, setLivello] = useState('MA')

  const annoDa = new Date().getFullYear() - 1

  useEffect(() => {
    let vivo = true
    setCaricamento(true)
    setErrore(null)
    Promise.all([
      controlloCosti.mensile({ base, modalita, annoDa }),
      controlloCosti.voci({ base, modalita, annoDa }),
    ])
      .then(([m, v]) => {
        if (!vivo) return
        setMensile(m)
        setVoci(v)
      })
      // Niente fallback a []: "nessun costo fuori parametro" quando la vista non
      // ha risposto sarebbe una rassicurazione falsa.
      .catch((e) => vivo && setErrore(e.message || String(e)))
      .finally(() => vivo && setCaricamento(false))
    return () => { vivo = false }
  }, [base, modalita, annoDa])

  // Ultimo mese con fatturato: il mese in corso è quasi sempre incompleto.
  const ultimoMese = useMemo(() => {
    const conDati = mensile.filter((r) => num(r.fatturato) > 0)
    if (!conDati.length) return null
    return conDati.reduce((max, r) => (r.anno * 12 + r.mese > max.anno * 12 + max.mese ? r : max), conDati[0])
  }, [mensile])

  // Solo fino all'ultimo mese con fatturato: la vista genera righe anche per i
  // mesi futuri gia' popolati in costi_fissi (l'affitto e' caricato fino a
  // dicembre), e una riga di semafori grigi per novembre non serve a nessuno.
  const mesiDisponibili = useMemo(() => {
    if (!ultimoMese) return []
    const limite = ultimoMese.anno * 12 + ultimoMese.mese
    const chiavi = new Set(
      mensile
        .filter((r) => r.anno * 12 + r.mese <= limite)
        .map((r) => `${r.anno}-${String(r.mese).padStart(2, '0')}`)
    )
    return [...chiavi].sort().reverse()
  }, [mensile, ultimoMese])

  const vociDelMese = (liv) =>
    ultimoMese
      ? voci.filter((v) => v.livello === liv && v.anno === ultimoMese.anno && v.mese === ultimoMese.mese)
      : []

  if (errore) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-start gap-2">
        <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold">Non sono riuscito a leggere i dati di controllo costi.</div>
          <div className="mt-1 font-mono text-xs">{errore}</div>
          <div className="mt-1 text-red-600">
            Nessun numero viene mostrato finché la lettura non riesce: un cruscotto vuoto colorato di verde
            sarebbe peggio di un errore.
          </div>
        </div>
      </div>
    )
  }

  if (caricamento) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm py-12 justify-center">
        <RefreshCw size={16} className="animate-spin" /> Carico i costi…
      </div>
    )
  }

  if (!ultimoMese) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">
        Nessun mese con fatturato negli ultimi due anni.
      </div>
    )
  }

  const etichettaMese = `${MESI[ultimoMese.mese - 1]} ${ultimoMese.anno}`

  return (
    <div className="space-y-6">
      <BannerAffidabilita righe={mensile.filter((r) => r.anno === ultimoMese.anno && r.mese === ultimoMese.mese)} mese={etichettaMese} />

      {/* ── schede per livello ─────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">
          {etichettaMese} · {modalita === 'PIENO' ? 'lettura piena' : 'lettura diretta'} · {base === 'NETTO' ? 'netto IVA' : 'lordo'}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {LIVELLI.map((l) => {
            const riga = mensile.find((r) => r.livello === l.id && r.anno === ultimoMese.anno && r.mese === ultimoMese.mese)
            if (!riga) return null
            if (modalita === 'PIENO' && l.id === 'GR') return null
            return (
              <SchedaLivello
                key={l.id}
                titolo={l.label}
                riga={riga}
                voci={vociDelMese(l.id)}
                attivo={livello === l.id}
                onClick={() => setLivello(l.id)}
              />
            )
          })}
        </div>
      </div>

      {/* ── matrice mesi × voci ────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-gray-900">Andamento mese per mese</h2>
            <p className="text-xs text-gray-500">Percentuale sul fatturato, colorata con la soglia in vigore quel mese.</p>
          </div>
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white">
            {LIVELLI.filter((l) => !(modalita === 'PIENO' && l.id === 'GR')).map((l) => (
              <button
                key={l.id}
                onClick={() => setLivello(l.id)}
                className={`px-3 py-1.5 text-xs font-medium transition ${
                  livello === l.id ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <MatriceMesi mesi={mesiDisponibili} voci={voci} livello={livello} mensile={mensile} />
        <div className="px-4 py-3 border-t border-gray-100">
          <LegendaSemaforo />
        </div>
      </div>

      <CollegamentiUtili />
    </div>
  )
}

function BannerAffidabilita({ righe, mese }) {
  const conFatturato = righe.filter((r) => num(r.fatturato) > 0)
  const certa = conFatturato.length
    ? conFatturato.reduce((s, r) => s + (num(r.pct_spesa_certa) ?? 0), 0) / conFatturato.length
    : null
  const nonClass = righe.filter((r) => r.livello !== 'TOT').reduce((s, r) => s + (num(r.non_classificato) || 0), 0)
  const stimato = righe.some((r) => r.personale_ha_stima)
  const gg = righe.find((r) => r.livello === 'MA')

  const avvisi = []
  if (certa != null && certa < 90) avvisi.push(`spesa attribuita con prova: ${fmtPct(certa)} — il resto è ripartito su base statistica`)
  if (nonClass > 0) avvisi.push(`${fmtEur(nonClass)} di spesa da fornitori non classificati`)
  if (stimato) avvisi.push('il costo del personale di questo mese contiene cedolini stimati')
  if (gg && num(gg.gg_con_dgfe) === 0) avvisi.push('nessun giorno con DGFE: il fatturato non è riscontrato col registratore telematico')

  if (!avvisi.length) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-sm text-emerald-800 flex items-center gap-2">
        <Check size={16} /> {mese}: tutti i dati sono attribuiti con prova e completi.
      </div>
    )
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-900">
      <div className="flex items-start gap-2">
        <Info size={16} className="flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Quanto ti puoi fidare di {mese}</span>
          <ul className="mt-1 space-y-0.5 list-disc list-inside text-amber-800">
            {avvisi.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      </div>
    </div>
  )
}

function SchedaLivello({ titolo, riga, voci, attivo, onClick }) {
  const totale = voci.find((v) => v.voce === 'COSTI_TOTALI')
  const s = stileEsito(totale?.esito)
  const margine = num(riga.margine)

  return (
    <div
      onClick={onClick}
      className={`bg-white border rounded-xl p-4 cursor-pointer transition ${
        attivo ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-900">{titolo}</h3>
        <Semaforo esito={totale?.esito} titolo={s.etichetta} />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm mb-3">
        <div className="text-gray-500">Fatturato</div>
        <div className="text-right font-medium text-gray-900">{fmtEur(riga.fatturato)}</div>
        <div className="text-gray-500">Costi</div>
        <div className="text-right font-medium text-gray-900">{fmtEur(riga.costi_totali)}</div>
        <div className="text-gray-500">Margine</div>
        <div className={`text-right font-bold ${margine == null ? 'text-gray-400' : margine >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
          {fmtEur(riga.margine)}
        </div>
      </div>

      <div className="space-y-1">
        {voci.filter((v) => v.voce !== 'COSTI_TOTALI').map((v) => {
          const conf = VOCI.find((x) => x.id === v.voce)
          return (
            <div key={v.voce} className="flex items-center justify-between text-xs">
              <span className="text-gray-600">{conf?.corto || v.voce}</span>
              <span className="flex items-center gap-2">
                {v.obiettivo != null && v.pct != null && (
                  <span className="text-[10px] text-gray-400">ob. {fmtPct(v.obiettivo, { decimali: 0 })}</span>
                )}
                <Semaforo esito={v.esito} testo={fmtPct(v.pct)} />
              </span>
            </div>
          )
        })}
      </div>

      {num(riga.quota_gruppo) > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
          <span className="text-gray-500">di cui quota gruppo</span>
          <span className="font-medium text-gray-700">{fmtEur(riga.quota_gruppo)}</span>
        </div>
      )}
    </div>
  )
}

function MatriceMesi({ mesi, voci, livello, mensile }) {
  const righeMese = mesi.slice(0, 18)

  if (!righeMese.length) {
    return <div className="p-6 text-sm text-gray-500">Nessun mese da mostrare.</div>
  }

  const colonneCsv = [
    { chiave: 'mese', etichetta: 'Mese' },
    { chiave: 'fatturato', etichetta: 'Fatturato €' },
    ...VOCI.map((v) => ({ chiave: `pct_${v.id}`, etichetta: `${v.label} %` })),
  ]
  const righeCsv = righeMese.map((chiave) => {
    const [a, m] = chiave.split('-').map(Number)
    const riga = mensile.find((r) => r.livello === livello && r.anno === a && r.mese === m)
    const out = { mese: chiave, fatturato: num(riga?.fatturato) }
    VOCI.forEach((v) => {
      const c = voci.find((x) => x.livello === livello && x.anno === a && x.mese === m && x.voce === v.id)
      out[`pct_${v.id}`] = num(c?.pct)
    })
    return out
  })

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left px-4 py-2 font-semibold text-gray-600">Mese</th>
            <th className="text-right px-3 py-2 font-semibold text-gray-600">Fatturato</th>
            {VOCI.map((v) => (
              <th key={v.id} className="px-2 py-2 font-semibold text-gray-600 text-center whitespace-nowrap">
                {v.corto}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {righeMese.map((chiave) => {
            const [a, m] = chiave.split('-').map(Number)
            const riga = mensile.find((r) => r.livello === livello && r.anno === a && r.mese === m)
            return (
              <tr key={chiave} className="border-b border-gray-50 hover:bg-gray-50/60">
                <td className="px-4 py-1.5 whitespace-nowrap text-gray-700">
                  {MESI[m - 1]} {a}
                  {riga?.personale_ha_stima && (
                    <span title="Contiene cedolini stimati" className="ml-1 text-amber-500">•</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right text-gray-600">{fmtEur(riga?.fatturato)}</td>
                {VOCI.map((v) => {
                  const c = voci.find((x) => x.livello === livello && x.anno === a && x.mese === m && x.voce === v.id)
                  return (
                    <td key={v.id} className="px-1 py-1">
                      <CellaSemaforo
                        esito={c?.esito}
                        valore={fmtPct(c?.pct)}
                        dettaglio={c?.importo != null ? fmtEur(c.importo) : null}
                        titolo={
                          c?.soglia_verde != null
                            ? `Verde fino a ${c.soglia_verde}%, ambra fino a ${c.soglia_gialla}%${
                                c.obiettivo != null ? `, obiettivo ${c.obiettivo}%` : ''
                              }`
                            : 'Nessuna soglia definita per questa voce'
                        }
                      />
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="px-4 py-2 flex justify-end">
        <BottoneCsv righe={righeCsv} colonne={colonneCsv} nomeFile={`controllo-costi-${livello}`} />
      </div>
    </div>
  )
}

function CollegamentiUtili() {
  const link = [
    { to: '/buste-paga?tab=riepilogo', label: 'Dipendenti & Paga', desc: 'da dove viene il costo del personale' },
    { to: '/fornitori',                label: 'Fornitori & Fatture', desc: 'le fatture dietro food, fissi e servizi' },
    { to: '/costi-fissi',              label: 'Costi Fissi',        desc: 'affitti e voci ricorrenti, editabili' },
    { to: '/analisi-reparti',          label: 'Analisi Reparti',    desc: 'lo stesso costo, spaccato per reparto' },
    { to: '/contabilita-bi',           label: 'Contabilità BI',     desc: 'serie storica e proiezioni' },
  ]
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <h2 className="font-semibold text-gray-900 mb-2">Da dove arrivano questi numeri</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {link.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition"
          >
            <span>
              <span className="block text-sm font-medium text-gray-800">{l.label}</span>
              <span className="block text-xs text-gray-500">{l.desc}</span>
            </span>
            <ArrowRight size={15} className="text-gray-400 flex-shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 2. FORNITORI — chi è food e chi è servizi
// ═══════════════════════════════════════════════════════════════════
const STATI_FORNITORE = {
  OK:         { label: 'Classificato',  esito: 'VERDE' },
  INCOERENTE: { label: 'Etichetta disallineata', esito: 'AMBRA' },
  SOLO_TESTO: { label: 'Non collegato', esito: 'ROSSO' },
  MANCANTE:   { label: 'Senza categoria', esito: 'ROSSO' },
}

function SezioneFornitori() {
  const [righe, setRighe] = useState([])
  const [categorie, setCategorie] = useState([])
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState(null)
  const [filtro, setFiltro] = useState('')
  const [soloDaSistemare, setSoloDaSistemare] = useState(true)
  const [salvataggio, setSalvataggio] = useState(null)

  const carica = () => {
    setCaricamento(true)
    setErrore(null)
    Promise.all([controlloCosti.fornitoriClassificazione(), controlloCosti.categorie()])
      .then(([f, c]) => { setRighe(f); setCategorie(c) })
      .catch((e) => setErrore(e.message || String(e)))
      .finally(() => setCaricamento(false))
  }
  useEffect(carica, [])

  const filtrate = useMemo(() => {
    const t = filtro.trim().toLowerCase()
    return righe.filter((r) => {
      if (soloDaSistemare && r.stato === 'OK') return false
      if (!t) return true
      return String(r.nome || '').toLowerCase().includes(t) || String(r.p_iva || '').includes(t)
    })
  }, [righe, filtro, soloDaSistemare])

  const { righeOrdinate, colonna, direzione, propsTh } = useOrdinamento(filtrate, 'spesa_12m', 'desc')

  const riepilogo = useMemo(() => {
    const per = {}
    righe.forEach((r) => {
      per[r.stato] = per[r.stato] || { n: 0, spesa12: 0, spesaTot: 0 }
      per[r.stato].n += 1
      per[r.stato].spesa12 += num(r.spesa_12m) || 0
      per[r.stato].spesaTot += num(r.spesa_totale) || 0
    })
    return per
  }, [righe])

  const cambiaCategoria = async (riga, categoriaId) => {
    if (!categoriaId) return
    const cat = categorie.find((c) => c.id === categoriaId)
    setSalvataggio(riga.fornitore_id)
    try {
      await controlloCosti.collegaCategoria(riga.fornitore_id, categoriaId, cat?.tipo)
      setRighe((prev) =>
        prev.map((r) =>
          r.fornitore_id === riga.fornitore_id
            ? { ...r, categoria_id: categoriaId, categoria_tipo: cat?.tipo, categoria_collegata: cat?.nome, categoria_testo: cat?.tipo, stato: 'OK' }
            : r
        )
      )
    } catch (e) {
      alert(`Non sono riuscito a salvare: ${e.message}`)
    } finally {
      setSalvataggio(null)
    }
  }

  const cambiaAmbito = async (riga, ambito) => {
    setSalvataggio(riga.fornitore_id)
    try {
      await controlloCosti.impostaAmbito(riga.fornitore_id, ambito)
      setRighe((prev) => prev.map((r) => (r.fornitore_id === riga.fornitore_id ? { ...r, ambito } : r)))
    } catch (e) {
      alert(`Non sono riuscito a salvare: ${e.message}`)
    } finally {
      setSalvataggio(null)
    }
  }

  const TH = ({ col, children, align = 'left' }) => (
    <th {...propsTh(col)} className={`px-3 py-2 font-semibold text-gray-600 cursor-pointer select-none hover:text-gray-900 text-${align}`}>
      {children}
      <IconaOrdine colonna={col} colonnaAttiva={colonna} direzione={direzione} />
    </th>
  )

  if (errore) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
        Non sono riuscito a leggere la classificazione fornitori: <span className="font-mono text-xs">{errore}</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="font-semibold text-gray-900">Perché questa pagina esiste</h2>
        <p className="text-sm text-gray-600 mt-1">
          L'anagrafica fornitori ha <strong>due</strong> campi di categoria: un testo libero e un collegamento
          alla tabella delle categorie. Le viste di costo leggono <strong>solo il collegamento</strong>. Un
          fornitore che ha il testo ma non il collegamento, per il sistema non è né food né servizi: la sua
          spesa entra nel totale e sparisce dalla scomposizione. È da qui che si chiude quel buco.
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          {Object.entries(STATI_FORNITORE).map(([k, v]) => {
            const r = riepilogo[k]
            if (!r) return null
            return (
              <PillolaEsito
                key={k}
                esito={v.esito}
                testo={`${v.label}: ${r.n} fornitori · ${fmtEur(r.spesa12)} negli ultimi 12 mesi`}
              />
            )
          })}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Cerca per nome o partita IVA…"
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 whitespace-nowrap">
            <input type="checkbox" checked={soloDaSistemare} onChange={(e) => setSoloDaSistemare(e.target.checked)} />
            Solo quelli da sistemare
          </label>
          <button onClick={carica} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            <RefreshCw size={14} className={caricamento ? 'animate-spin' : ''} /> Ricarica
          </button>
        </div>

        {caricamento ? (
          <div className="p-8 text-center text-sm text-gray-500">Carico i fornitori…</div>
        ) : !righeOrdinate.length ? (
          <div className="p-8 text-center text-sm text-gray-500">
            Nessun fornitore da sistemare. {soloDaSistemare && 'Togli il filtro per vedere tutti.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100">
                <tr>
                  <TH col="nome">Fornitore</TH>
                  <TH col="stato">Stato</TH>
                  <TH col="spesa_12m" align="right">Spesa 12 mesi</TH>
                  <TH col="spesa_totale" align="right">Spesa storica</TH>
                  <th className="px-3 py-2 font-semibold text-gray-600 text-left">Categoria</th>
                  <th className="px-3 py-2 font-semibold text-gray-600 text-left">Ambito</th>
                </tr>
              </thead>
              <tbody>
                {righeOrdinate.slice(0, 400).map((r) => {
                  const st = STATI_FORNITORE[r.stato] || STATI_FORNITORE.MANCANTE
                  const inSalvataggio = salvataggio === r.fornitore_id
                  return (
                    <tr key={r.fornitore_id} className={`border-b border-gray-50 ${inSalvataggio ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-800">{r.nome}</div>
                        <div className="text-xs text-gray-400">
                          {r.p_iva} · {r.n_fatture} fatture
                          {r.pct_fatture_sede_certa != null && ` · sede certa su ${fmtPct(r.pct_fatture_sede_certa, { decimali: 0 })}`}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Semaforo esito={st.esito} testo={st.label} />
                        {r.stato === 'INCOERENTE' && (
                          <div className="text-[10px] text-gray-400 mt-0.5">
                            testo «{r.categoria_testo}» ≠ collegata «{r.categoria_tipo}»
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">{fmtEur(r.spesa_12m)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{fmtEur(r.spesa_totale)}</td>
                      <td className="px-3 py-2">
                        <select
                          value={r.categoria_id || ''}
                          disabled={inSalvataggio}
                          onChange={(e) => cambiaCategoria(r, e.target.value)}
                          className="w-full min-w-[160px] px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white"
                        >
                          <option value="">— da assegnare —</option>
                          {categorie.map((c) => (
                            <option key={c.id} value={c.id}>{c.nome}</option>
                          ))}
                        </select>
                        {r.voce_costo && <div className="text-[10px] text-gray-400 mt-0.5">voce: {r.voce_costo}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={r.ambito || 'SEDE'}
                          disabled={inSalvataggio}
                          onChange={(e) => cambiaAmbito(r, e.target.value)}
                          className="px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white"
                        >
                          <option value="SEDE">Sede</option>
                          <option value="GRUPPO">Gruppo</option>
                          <option value="MISTO">Misto</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {righeOrdinate.length > 400 && (
              <div className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-t border-amber-100">
                Mostro i primi 400 di {righeOrdinate.length}: usa la ricerca per arrivare agli altri.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 3. PARAMETRI — le soglie
// ═══════════════════════════════════════════════════════════════════
function SezioneParametri() {
  const [righe, setRighe] = useState([])
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState(null)
  const [bozza, setBozza] = useState({})
  const [salvataggio, setSalvataggio] = useState(null)

  const carica = () => {
    setCaricamento(true)
    controlloCosti.parametri()
      .then(setRighe)
      .catch((e) => setErrore(e.message || String(e)))
      .finally(() => setCaricamento(false))
  }
  useEffect(carica, [])

  const modifica = (id, campo, valore) =>
    setBozza((b) => ({ ...b, [id]: { ...(b[id] || {}), [campo]: valore } }))

  const salva = async (r) => {
    const patch = bozza[r.id] || {}
    setSalvataggio(r.id)
    try {
      await controlloCosti.salvaParametro({ ...r, ...patch })
      setBozza((b) => { const n = { ...b }; delete n[r.id]; return n })
      carica()
    } catch (e) {
      alert(`Non sono riuscito a salvare: ${e.message}`)
    } finally {
      setSalvataggio(null)
    }
  }

  const valore = (r, campo) => (bozza[r.id]?.[campo] !== undefined ? bozza[r.id][campo] : r[campo] ?? '')

  if (errore) {
    return <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{errore}</div>
  }

  const perBase = ['NETTO', 'LORDO']

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
        <h2 className="font-semibold text-gray-900 mb-1">Come leggere queste soglie</h2>
        <p>
          <strong>Verde</strong> e <strong>gialla</strong> sono le soglie di lavoro: colorano il semaforo e sono
          tarate su dove sei davvero oggi. <strong>Obiettivo</strong> è il traguardo dichiarato — compare
          accanto al valore ma non colora niente, perché un semaforo sempre rosso lo si smette di guardare.
        </p>
        <p className="mt-2">
          Una soglia con livello <em>Mameli</em> o <em>Predda Niedda</em> batte quella generica. Cambiando
          <em> valido da</em> si lascia intatto il giudizio sui mesi già passati.
        </p>
      </div>

      {caricamento ? (
        <div className="p-8 text-center text-sm text-gray-500">Carico i parametri…</div>
      ) : (
        perBase.map((base) => (
          <div key={base} className="bg-white border border-gray-200 rounded-xl">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">
                Base {base === 'NETTO' ? 'netto IVA' : 'lordo'}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Voce</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Livello</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">Verde ≤</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">Gialla ≤</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">Obiettivo</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Valido da</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {righe.filter((r) => r.base === base).map((r) => {
                    const sporca = !!bozza[r.id]
                    const conf = VOCI.find((v) => v.id === r.voce)
                    return (
                      <tr key={r.id} className={`border-b border-gray-50 ${sporca ? 'bg-violet-50/50' : ''}`}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-800">{conf?.label || r.voce}</div>
                          {r.note && <div className="text-[11px] text-gray-400 max-w-md">{r.note}</div>}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {r.livello === 'ALL' ? 'Tutti' : LIVELLI.find((l) => l.id === r.livello)?.label || r.livello}
                        </td>
                        {['soglia_verde', 'soglia_gialla', 'obiettivo'].map((campo) => (
                          <td key={campo} className="px-3 py-2 text-right">
                            <input
                              type="number" step="0.5" min="0" max="200"
                              value={valore(r, campo)}
                              onChange={(e) => modifica(r.id, campo, e.target.value)}
                              className="w-20 text-right px-2 py-1 border border-gray-200 rounded-lg text-sm"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          <input
                            type="date"
                            value={String(valore(r, 'valido_da')).slice(0, 10)}
                            onChange={(e) => modifica(r.id, 'valido_da', e.target.value)}
                            className="px-2 py-1 border border-gray-200 rounded-lg text-sm"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          {sporca && (
                            <button
                              onClick={() => salva(r)}
                              disabled={salvataggio === r.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                            >
                              {salvataggio === r.id ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                              Salva
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
