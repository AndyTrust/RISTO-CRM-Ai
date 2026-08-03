/**
 * CatalogoArticoli.jsx — Catalogo Articoli (food cost lato acquisti)
 *
 * Legge sei VISTE già costruite a monte sulle righe fattura. Sono di sola
 * lettura: qui non si calcola nulla che il database non abbia già deciso, così
 * la pagina e le query SQL raccontano per forza la stessa cosa.
 *
 *   v_catalogo_fornitore_articolo  (3.204)  catalogo fornitore × articolo
 *   v_articolo_alert_prezzo          (288)  rincari e cali, con impatto in €/anno
 *   v_articolo_pareto              (2.836)  concentrazione della spesa
 *   v_articolo_confronto_fornitori    (51)  stesso articolo, fornitori diversi
 *   v_articolo_prezzo_mensile     (40.917)  serie mensile del prezzo (WAC)
 *   v_qualita_righe_food             (140)  quanto è affidabile il dato di partenza
 *
 * Quattro sezioni, ognuna con un URL proprio (sotto-route come /costi-prezzi e
 * /bilanci): un'analisi che non si può linkare non si può nemmeno discutere.
 *
 *   /catalogo-articoli                       → Catalogo (+ dettaglio prezzo nel tempo)
 *   /catalogo-articoli/alert-prezzi          → Alert prezzi
 *   /catalogo-articoli/pareto                → Pareto
 *   /catalogo-articoli/confronto-fornitori   → Confronto fornitori
 *
 * Convenzioni rispettate:
 *  • Importi NETTI IVA: vengono da fatture_righe, come in Costi & Prezzi BI.
 *  • Il cap PostgREST è 1000 righe SERVER-side: ogni vista si legge con
 *    fetchPagedInfo, e v_articolo_prezzo_mensile si filtra sempre a monte
 *    (p_iva + nome_normalizzato), mai caricata intera.
 *  • "Zero" e "non disponibile" non si assomigliano: i mancanti sono '—'.
 */
import { useState, useEffect, useMemo } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import {
  Package, AlertTriangle, BarChart3, GitCompareArrows, Info, Search,
  Loader2, X, TrendingUp, TrendingDown, Ruler,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import supabase from '../supabase'
import { fetchPagedInfo } from '../api/paged'
import {
  fmtEur, fmtNum, fmtPct, useOrdinamento, IconaOrdine, BottoneCsv, NotaCopertura,
} from '../lib/tabella'

// ── Sezioni ────────────────────────────────────────────────────────────────
const SEZIONI = [
  { id: 'catalogo',  slug: null,                    path: '/catalogo-articoli',                     label: 'Catalogo',            icon: Package,          exact: true },
  { id: 'alert',     slug: 'alert-prezzi',          path: '/catalogo-articoli/alert-prezzi',        label: 'Alert prezzi',        icon: AlertTriangle },
  { id: 'pareto',    slug: 'pareto',                path: '/catalogo-articoli/pareto',              label: 'Pareto',              icon: BarChart3 },
  { id: 'confronto', slug: 'confronto-fornitori',   path: '/catalogo-articoli/confronto-fornitori', label: 'Confronto fornitori', icon: GitCompareArrows },
]

const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#ec4899']

/** Data ISO → DD/MM/YYYY, come nelle altre pagine. */
const dataIt = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—')
/** Primo giorno del mese (date di v_articolo_prezzo_mensile) → "ago 26". */
const meseIt = m => {
  if (!m) return '—'
  const [a, ms] = String(m).slice(0, 7).split('-')
  return `${['', 'gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'][Number(ms)] || ms} ${String(a).slice(2)}`
}
const senzaUm = u => !u || String(u).trim() === ''
const etichettaUm = u => (senzaUm(u) ? 'senza UM' : String(u))

// ── Componenti condivisi (stessi di Costi & Prezzi BI) ─────────────────────
function Kpi({ label, value, sub, tono = 'neutro', grande = false }) {
  const toni = {
    neutro:     'bg-white border-gray-200 text-gray-900',
    positivo:   'bg-emerald-50 border-emerald-200 text-emerald-800',
    negativo:   'bg-red-50 border-red-200 text-red-800',
    attenzione: 'bg-amber-50 border-amber-200 text-amber-800',
    assente:    'bg-gray-50 border-dashed border-gray-300 text-gray-400',
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

/**
 * Lettura completa di una vista, a pagine da 1000.
 *
 * `orderCol` deve essere una combinazione UNIVOCA di colonne: le viste non
 * hanno una chiave primaria e con dei pareggi Postgres non garantisce come li
 * rompe fra una pagina e l'altra — si otterrebbero righe ripetute e altre mai
 * lette, senza alcun errore visibile.
 */
function useVista(tabella, orderCol, filtri = null) {
  const chiaveFiltri = JSON.stringify(filtri)
  const chiaveOrdine = JSON.stringify(orderCol)
  const [stato, setStato] = useState({ righe: null, troncato: false, caricamento: true, errore: null })

  useEffect(() => {
    let annullato = false
    const f = JSON.parse(chiaveFiltri) || {}
    const ordine = JSON.parse(chiaveOrdine)
    setStato(s => ({ ...s, caricamento: true, errore: null }))
    fetchPagedInfo(() => {
      let q = supabase.from(tabella).select('*')
      for (const [col, val] of Object.entries(f)) q = q.eq(col, val)
      return q
    }, ordine)
      .then(r => { if (!annullato) setStato({ righe: r.righe, troncato: r.troncato, caricamento: false, errore: null }) })
      // Mai ricadere su [] in caso di errore: una vista che non si carica non è
      // una vista vuota, e "nessun articolo" sarebbe un dato falso.
      .catch(e => { if (!annullato) setStato({ righe: null, troncato: false, caricamento: false, errore: e?.message || String(e) }) })
    return () => { annullato = true }
  }, [tabella, chiaveOrdine, chiaveFiltri])

  return stato
}

// ════════════════════════════════════════════════════════════════════════════
// Dettaglio: il prezzo di un articolo nel tempo
// ════════════════════════════════════════════════════════════════════════════
function DettaglioPrezzo({ articolo, onChiudi }) {
  // Filtro SEMPRE lato server: v_articolo_prezzo_mensile ha 40.917 righe e
  // caricarla intera significherebbe fermarsi alle prime 1000 senza accorgersene.
  const { righe, caricamento, errore } = useVista(
    'v_articolo_prezzo_mensile',
    ['mese', 'p_iva', 'um', 'fornitore'],
    { p_iva: articolo.p_iva, nome_normalizzato: articolo.nome_normalizzato },
  )

  // Una serie per unità di misura: prezzi con UM diverse non sono confrontabili,
  // sommarli in un'unica linea significherebbe disegnare un prezzo che non esiste.
  const serie = useMemo(() => {
    if (!righe) return { punti: [], chiavi: [] }
    const chiavi = [...new Set(righe.map(r => etichettaUm(r.um)))]
    const perMese = new Map()
    for (const r of righe) {
      const m = String(r.mese).slice(0, 7)
      if (!perMese.has(m)) perMese.set(m, { mese: m, label: meseIt(r.mese) })
      perMese.get(m)[etichettaUm(r.um)] = r.prezzo_wac == null ? null : Number(r.prezzo_wac)
    }
    return { punti: [...perMese.values()].sort((a, b) => a.mese.localeCompare(b.mese)), chiavi }
  }, [righe])

  const sintesi = useMemo(() => {
    if (!righe?.length) return null
    const conPrezzo = righe.filter(r => r.prezzo_wac != null)
    if (!conPrezzo.length) return null
    const ordinate = [...conPrezzo].sort((a, b) => String(a.mese).localeCompare(String(b.mese)))
    const primo = ordinate[0], ultimo = ordinate[ordinate.length - 1]
    const p = Number(primo.prezzo_wac), u = Number(ultimo.prezzo_wac)
    return {
      primo: p, primoMese: primo.mese,
      ultimo: u, ultimoMese: ultimo.mese,
      // null e non 0: senza base di confronto "invariato" sarebbe un'affermazione
      variazione: p ? ((u - p) / Math.abs(p)) * 100 : null,
      min: Math.min(...conPrezzo.map(r => Number(r.prezzo_min ?? r.prezzo_wac))),
      max: Math.max(...conPrezzo.map(r => Number(r.prezzo_max ?? r.prezzo_wac))),
      mesi: new Set(righe.map(r => String(r.mese).slice(0, 7))).size,
    }
  }, [righe])

  const ultimiMesi = useMemo(
    () => (righe ? [...righe].sort((a, b) => String(b.mese).localeCompare(String(a.mese))).slice(0, 18) : []),
    [righe])

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onChiudi}>
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[88vh] overflow-y-auto p-5"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900">{articolo.descrizione || articolo.nome_normalizzato}</h3>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{articolo.nome_normalizzato}</p>
            <p className="text-xs text-gray-500 mt-1">
              {articolo.fornitore || 'fornitore ignoto'} · P.IVA {articolo.p_iva || '—'}
              {articolo.um ? ` · UM ${articolo.um}` : ''}
              {sintesi ? ` · ${fmtNum(sintesi.mesi)} mesi con acquisti` : ''}
            </p>
          </div>
          <button onClick={onChiudi} className="text-gray-400 hover:text-gray-700 flex-shrink-0"><X size={18} /></button>
        </div>

        {sintesi && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <Kpi label="Primo prezzo" value={fmtEur(sintesi.primo, { decimali: 3 })} sub={meseIt(sintesi.primoMese)} />
            <Kpi label="Ultimo prezzo" value={fmtEur(sintesi.ultimo, { decimali: 3 })} sub={meseIt(sintesi.ultimoMese)} />
            <Kpi label="Variazione" value={fmtPct(sintesi.variazione, { segno: true })}
              tono={sintesi.variazione == null ? 'assente'
                : sintesi.variazione > 5 ? 'negativo'
                : sintesi.variazione < -5 ? 'positivo' : 'neutro'} />
            <Kpi label="Min → Max pagato"
              value={`${fmtEur(sintesi.min, { decimali: 3 })} → ${fmtEur(sintesi.max, { decimali: 3 })}`} />
          </div>
        )}

        {senzaUm(articolo.um) && (
          <div className="mb-3">
            <Avviso tipo="warn">
              Questo articolo <strong>non ha unità di misura</strong> sulle righe fattura: il prezzo
              qui sotto è spesa ÷ quantità dichiarata, quindi va letto come indicativo e non come
              prezzo al kg o al litro.
            </Avviso>
          </div>
        )}

        {caricamento && <Caricamento testo="Carico la serie mensile dei prezzi…" />}
        {errore && <Avviso tipo="error">Serie prezzi non disponibile: {errore}</Avviso>}
        {!caricamento && !errore && serie.punti.length === 0 && (
          <Avviso tipo="warn">Nessun mese con prezzo per questo articolo presso questo fornitore.</Avviso>
        )}

        {serie.punti.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-bold text-gray-700 mb-2">
              Prezzo medio ponderato (WAC) mese per mese
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={serie.punti}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={24} />
                <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']}
                  tickFormatter={v => fmtEur(v, { decimali: 2 })} width={70} />
                <Tooltip formatter={(v, n) => [fmtEur(v, { decimali: 3 }), n]} />
                {serie.chiavi.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                {serie.chiavi.map((k, i) => (
                  <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]}
                    strokeWidth={2} dot={{ r: 2 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {ultimiMesi.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h4 className="text-xs font-bold text-gray-700">Ultimi mesi</h4>
              <BottoneCsv righe={righe} nomeFile={`prezzo_mensile_${articolo.nome_normalizzato}`}
                colonne={[
                  { chiave: 'mese', etichetta: 'Mese' },
                  { chiave: 'fornitore', etichetta: 'Fornitore' },
                  { chiave: 'um', etichetta: 'UM' },
                  { chiave: 'qta', etichetta: 'Quantità' },
                  { chiave: 'spesa', etichetta: 'Spesa € (netto IVA)' },
                  { chiave: 'prezzo_wac', etichetta: 'Prezzo WAC €' },
                  { chiave: 'prezzo_min', etichetta: 'Prezzo min €' },
                  { chiave: 'prezzo_max', etichetta: 'Prezzo max €' },
                  { chiave: 'n_fatture', etichetta: 'N. fatture' },
                  { chiave: 'n_righe', etichetta: 'N. righe' },
                ]} />
            </div>
            <div className="overflow-x-auto max-h-[280px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b-2 border-gray-200 text-left text-xs text-gray-500">
                    <th className="py-1.5 font-semibold">Mese</th>
                    <th className="py-1.5 font-semibold">UM</th>
                    <th className="py-1.5 text-right font-semibold">Qtà</th>
                    <th className="py-1.5 text-right font-semibold">Spesa</th>
                    <th className="py-1.5 text-right font-semibold">WAC</th>
                    <th className="py-1.5 text-right font-semibold">Min</th>
                    <th className="py-1.5 text-right font-semibold">Max</th>
                    <th className="py-1.5 text-right font-semibold">Fatt.</th>
                  </tr>
                </thead>
                <tbody>
                  {ultimiMesi.map(r => (
                    <tr key={`${r.mese}-${r.um ?? ''}-${r.fornitore ?? ''}`} className="border-b border-gray-50">
                      <td className="py-1.5">{meseIt(r.mese)}</td>
                      <td className="py-1.5 text-[11px] text-gray-500">{etichettaUm(r.um)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtNum(r.qta, { decimali: 2 })}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtEur(r.spesa)}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">{fmtEur(r.prezzo_wac, { decimali: 3 })}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-500">{fmtEur(r.prezzo_min, { decimali: 3 })}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-500">{fmtEur(r.prezzo_max, { decimali: 3 })}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-500">{fmtNum(r.n_fatture)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <NotaCopertura righe={righe.length} fonte="v_articolo_prezzo_mensile (netto IVA)"
              extra="filtrata lato server per P.IVA + articolo" />
          </>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 1. CATALOGO
// ════════════════════════════════════════════════════════════════════════════
function SezioneCatalogo() {
  // Combinazione univoca verificata sulla vista: senza di questa la paginazione
  // a blocchi da 1000 salterebbe righe al confine fra una pagina e l'altra.
  const { righe, troncato, caricamento, errore } = useVista(
    'v_catalogo_fornitore_articolo',
    ['p_iva', 'nome_normalizzato', 'um', 'codice_articolo', 'descrizione', 'spesa_12m', 'ultimo_acquisto'],
  )
  const [ricerca, setRicerca] = useState('')
  const [fornitore, setFornitore] = useState('TUTTI')
  const [soloAttivi, setSoloAttivi] = useState(false)
  const [aperto, setAperto] = useState(null)

  const fornitori = useMemo(
    () => [...new Set((righe ?? []).map(r => r.fornitore).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it')),
    [righe])

  const filtrati = useMemo(() => {
    const q = ricerca.trim().toUpperCase()
    return (righe ?? []).filter(r => {
      if (fornitore !== 'TUTTI' && r.fornitore !== fornitore) return false
      // "Attivo" = comprato negli ultimi 12 mesi, cioè con spesa a 12 mesi.
      if (soloAttivi && !(Number(r.spesa_12m) > 0)) return false
      if (!q) return true
      return String(r.descrizione || '').toUpperCase().includes(q)
        || String(r.nome_normalizzato || '').toUpperCase().includes(q)
        || String(r.codice_articolo || '').toUpperCase().includes(q)
    })
  }, [righe, ricerca, fornitore, soloAttivi])

  const { righeOrdinate, colonna, direzione, propsTh } = useOrdinamento(filtrati, 'spesa_12m', 'desc')

  const totali = useMemo(() => {
    const base = filtrati
    return {
      articoli: new Set(base.map(r => r.nome_normalizzato)).size,
      fornitori: new Set(base.map(r => r.fornitore)).size,
      spesa12m: base.reduce((s, r) => s + (Number(r.spesa_12m) || 0), 0),
      senzaUm: base.filter(r => senzaUm(r.um)).length,
    }
  }, [filtrati])

  const Th = ({ col, children, className = '' }) => (
    <th {...propsTh(col)} className={`py-2 font-semibold ${className} cursor-pointer select-none hover:text-gray-900`}>
      {children}<IconaOrdine colonna={col} colonnaAttiva={colonna} direzione={direzione} />
    </th>
  )

  const colonneCsv = [
    { chiave: 'fornitore', etichetta: 'Fornitore' },
    { chiave: 'p_iva', etichetta: 'P.IVA' },
    { chiave: 'descrizione', etichetta: 'Descrizione' },
    { chiave: 'nome_normalizzato', etichetta: 'Nome normalizzato' },
    { chiave: 'codice_articolo', etichetta: 'Codice articolo' },
    { chiave: 'um', etichetta: 'UM' },
    { chiave: 'n_fatture', etichetta: 'N. fatture' },
    { chiave: 'primo_acquisto', etichetta: 'Primo acquisto' },
    { chiave: 'ultimo_acquisto', etichetta: 'Ultimo acquisto' },
    { chiave: 'qta_12m', etichetta: 'Quantità 12 mesi' },
    { chiave: 'spesa_12m', etichetta: 'Spesa 12 mesi € (netto IVA)' },
    { chiave: 'prezzo_wac_12m', etichetta: 'Prezzo WAC 12 mesi €' },
    { chiave: 'n_sedi', etichetta: 'N. sedi' },
  ]

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Cerca articolo</label>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={ricerca} onChange={e => setRicerca(e.target.value)}
                placeholder="descrizione, nome normalizzato o codice…"
                className="w-full border border-gray-200 rounded-lg pl-8 pr-2.5 py-1.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Fornitore</label>
            <select value={fornitore} onChange={e => setFornitore(e.target.value)}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm max-w-[280px]">
              <option value="TUTTI">Tutti ({fornitori.length})</option>
              {fornitori.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 pb-1.5 cursor-pointer">
            <input type="checkbox" checked={soloAttivi} onChange={e => setSoloAttivi(e.target.checked)}
              className="w-4 h-4 rounded accent-indigo-600" />
            Solo acquistati negli ultimi 12 mesi
          </label>
        </div>
      </div>

      <Avviso tipo="info">
        Ogni riga è una coppia <strong>fornitore × articolo</strong>: lo stesso prodotto comprato da
        due fornitori compare due volte, ed è proprio ciò che rende confrontabili i prezzi.
        Il <strong>prezzo WAC</strong> è la media ponderata degli ultimi 12 mesi (spesa ÷ quantità),
        non l'ultimo prezzo pagato. Importi <strong>netti IVA</strong>.
        Clicca una riga per vedere come si è mosso il prezzo mese per mese.
      </Avviso>

      {caricamento && <Caricamento testo="Carico il catalogo articoli…" />}
      {errore && <Avviso tipo="error">Catalogo non disponibile: {errore}</Avviso>}

      {!caricamento && righe && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Righe catalogo" value={fmtNum(filtrati.length)}
              sub={filtrati.length !== righe.length ? `su ${fmtNum(righe.length)} totali` : 'nessun filtro attivo'} />
            <Kpi label="Articoli distinti" value={fmtNum(totali.articoli)} sub="per nome normalizzato" />
            <Kpi label="Spesa ultimi 12 mesi" value={fmtEur(totali.spesa12m)} sub="netto IVA" />
            <Kpi label="Righe senza UM" value={fmtNum(totali.senzaUm)}
              sub={filtrati.length ? `${fmtPct((totali.senzaUm / filtrati.length) * 100)} del selezionato` : null}
              tono={totali.senzaUm > 0 ? 'attenzione' : 'neutro'} />
          </div>

          <Sezione
            titolo={`Catalogo fornitore × articolo (${fmtNum(righeOrdinate.length)})`}
            sottotitolo="ordinato per spesa degli ultimi 12 mesi; clicca una riga per il dettaglio prezzo nel tempo"
            azioni={<BottoneCsv righe={righeOrdinate} colonne={colonneCsv} nomeFile="catalogo_articoli" />}>
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b-2 border-gray-200 text-left text-xs text-gray-500">
                    <Th col="descrizione">Articolo</Th>
                    <Th col="fornitore">Fornitore</Th>
                    <Th col="um">UM</Th>
                    <Th col="n_fatture" className="text-right">Fatt.</Th>
                    <Th col="ultimo_acquisto" className="text-right">Ultimo acq.</Th>
                    <Th col="qta_12m" className="text-right">Qtà 12m</Th>
                    <Th col="prezzo_wac_12m" className="text-right">Prezzo WAC</Th>
                    <Th col="spesa_12m" className="text-right">Spesa 12m</Th>
                    <Th col="n_sedi" className="text-right">Sedi</Th>
                  </tr>
                </thead>
                <tbody>
                  {righeOrdinate.slice(0, 300).map(r => (
                    <tr
                      key={`${r.p_iva}|${r.nome_normalizzato}|${r.um ?? ''}|${r.codice_articolo ?? ''}|${r.descrizione ?? ''}`}
                      onClick={() => setAperto(r)}
                      className="border-b border-gray-50 hover:bg-indigo-50/50 cursor-pointer">
                      <td className="py-1.5 pr-2 max-w-[280px]">
                        <span className="block truncate" title={r.descrizione || r.nome_normalizzato}>
                          {r.descrizione || r.nome_normalizzato}
                        </span>
                        <span className="block text-[10px] text-gray-400 font-mono truncate">
                          {r.nome_normalizzato}{r.codice_articolo ? ` · cod. ${r.codice_articolo}` : ''}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 max-w-[180px]">
                        <span className="block truncate text-[12px] text-gray-600" title={r.fornitore}>{r.fornitore}</span>
                      </td>
                      <td className="py-1.5">
                        {senzaUm(r.um)
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">senza UM</span>
                          : <span className="text-[11px] text-gray-500">{r.um}</span>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-gray-500">{fmtNum(r.n_fatture)}</td>
                      <td className="py-1.5 text-right tabular-nums text-[11px] text-gray-500">{dataIt(r.ultimo_acquisto)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtNum(r.qta_12m, { decimali: 2 })}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtEur(r.prezzo_wac_12m, { decimali: 3 })}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">{fmtEur(r.spesa_12m)}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-400">{fmtNum(r.n_sedi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {righeOrdinate.length > 300 && (
              <p className="text-[11px] text-amber-600 mt-2">
                Mostrate le prime 300 righe di {fmtNum(righeOrdinate.length)}: usa la ricerca o il
                filtro fornitore per restringere. L'export CSV contiene tutte le righe.
              </p>
            )}
            {righeOrdinate.length === 0 && (
              <p className="text-sm text-gray-400 py-8 text-center">Nessun articolo con questi filtri.</p>
            )}
            <NotaCopertura righe={righe.length} fonte="v_catalogo_fornitore_articolo (netto IVA)"
              extra="lettura a blocchi da 1000 righe" troncato={troncato} />
          </Sezione>
        </>
      )}

      {aperto && <DettaglioPrezzo articolo={aperto} onChiudi={() => setAperto(null)} />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 2. ALERT PREZZI
// ════════════════════════════════════════════════════════════════════════════
function SezioneAlert() {
  const { righe, troncato, caricamento, errore } = useVista(
    'v_articolo_alert_prezzo',
    ['p_iva', 'nome_normalizzato', 'um'],
  )
  const [tipo, setTipo] = useState('TUTTI') // TUTTI | RINCARI | CALI
  const [ricerca, setRicerca] = useState('')
  const [aperto, setAperto] = useState(null)

  const filtrati = useMemo(() => {
    const q = ricerca.trim().toUpperCase()
    return (righe ?? []).filter(r => {
      const d = Number(r.delta_pct)
      if (tipo === 'RINCARI' && !(d > 0)) return false
      if (tipo === 'CALI' && !(d < 0)) return false
      if (!q) return true
      return String(r.nome_normalizzato || '').toUpperCase().includes(q)
        || String(r.fornitore || '').toUpperCase().includes(q)
    })
  }, [righe, tipo, ricerca])

  const { righeOrdinate, colonna, direzione, propsTh } = useOrdinamento(filtrati, 'impatto_eur_anno', 'desc')

  const sintesi = useMemo(() => {
    const tutte = righe ?? []
    const rincari = tutte.filter(r => Number(r.delta_pct) > 0)
    const cali = tutte.filter(r => Number(r.delta_pct) < 0)
    return {
      nRincari: rincari.length,
      nCali: cali.length,
      impattoRincari: rincari.reduce((s, r) => s + (Number(r.impatto_eur_anno) || 0), 0),
      impattoCali: cali.reduce((s, r) => s + (Number(r.impatto_eur_anno) || 0), 0),
      peggiore: rincari.length
        ? [...rincari].sort((a, b) => Number(b.impatto_eur_anno) - Number(a.impatto_eur_anno))[0]
        : null,
    }
  }, [righe])

  const Th = ({ col, children, className = '' }) => (
    <th {...propsTh(col)} className={`py-2 font-semibold ${className} cursor-pointer select-none hover:text-gray-900`}>
      {children}<IconaOrdine colonna={col} colonnaAttiva={colonna} direzione={direzione} />
    </th>
  )

  return (
    <div className="space-y-4">
      <Avviso tipo="info">
        La tabella è ordinata per <strong>impatto in euro all'anno</strong>, non per percentuale:
        un +40% su un articolo da 80 € l'anno conta molto meno di un +6% sulla farina, e ordinare
        per delta % metterebbe in cima proprio le cose che non spostano il conto.
      </Avviso>

      {caricamento && <Caricamento testo="Carico gli alert prezzo…" />}
      {errore && <Avviso tipo="error">Alert non disponibili: {errore}</Avviso>}

      {!caricamento && righe && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi grande label="Impatto annuo dei rincari" value={fmtEur(sintesi.impattoRincari)}
              sub={`${fmtNum(sintesi.nRincari)} articoli rincarati · quantità degli ultimi 12 mesi ai prezzi nuovi`}
              tono="negativo" />
            <Kpi label="Effetto dei cali" value={fmtEur(sintesi.impattoCali)}
              sub={`${fmtNum(sintesi.nCali)} articoli in calo`}
              tono={sintesi.nCali ? 'positivo' : 'assente'} />
            <Kpi label="Saldo netto" value={fmtEur(sintesi.impattoRincari + sintesi.impattoCali)}
              sub="rincari + cali, sulle stesse quantità"
              tono={sintesi.impattoRincari + sintesi.impattoCali > 0 ? 'attenzione' : 'positivo'} />
            <Kpi label="Rincaro più costoso"
              value={sintesi.peggiore ? fmtEur(sintesi.peggiore.impatto_eur_anno) : '—'}
              sub={sintesi.peggiore
                ? `${sintesi.peggiore.nome_normalizzato} · ${fmtPct(sintesi.peggiore.delta_pct, { segno: true })}`
                : null}
              tono={sintesi.peggiore ? 'attenzione' : 'assente'} />
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Mostra</label>
                <div className="flex rounded-lg overflow-hidden border border-gray-200 text-xs font-medium">
                  {[['TUTTI', `Tutti (${righe.length})`], ['RINCARI', `Rincari (${sintesi.nRincari})`], ['CALI', `Cali (${sintesi.nCali})`]].map(([k, lbl]) => (
                    <button key={k} type="button" onClick={() => setTipo(k)}
                      className={`px-3 py-1.5 transition-colors ${tipo === k ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Cerca</label>
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={ricerca} onChange={e => setRicerca(e.target.value)}
                    placeholder="articolo o fornitore…"
                    className="w-full border border-gray-200 rounded-lg pl-8 pr-2.5 py-1.5 text-sm" />
                </div>
              </div>
            </div>
          </div>

          <Sezione
            titolo={`Articoli con il prezzo cambiato (${fmtNum(righeOrdinate.length)})`}
            sottotitolo="prezzo del periodo storico contro prezzo recente; clicca una riga per la serie mensile"
            azioni={<BottoneCsv righe={righeOrdinate} nomeFile="alert_prezzi"
              colonne={[
                { chiave: 'fornitore', etichetta: 'Fornitore' },
                { chiave: 'p_iva', etichetta: 'P.IVA' },
                { chiave: 'nome_normalizzato', etichetta: 'Articolo' },
                { chiave: 'um', etichetta: 'UM' },
                { chiave: 'prezzo_prima', etichetta: 'Prezzo prima €' },
                { chiave: 'prezzo_adesso', etichetta: 'Prezzo adesso €' },
                { chiave: 'delta_pct', etichetta: 'Delta %' },
                { chiave: 'impatto_eur_anno', etichetta: 'Impatto €/anno' },
                { chiave: 'qta_12m', etichetta: 'Quantità 12 mesi' },
                { chiave: 'qta_storica', etichetta: 'Quantità storica' },
                { chiave: 'qta_recente', etichetta: 'Quantità recente' },
              ]} />}>
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b-2 border-gray-200 text-left text-xs text-gray-500">
                    <Th col="nome_normalizzato">Articolo</Th>
                    <Th col="fornitore">Fornitore</Th>
                    <Th col="um">UM</Th>
                    <Th col="prezzo_prima" className="text-right">Prima</Th>
                    <Th col="prezzo_adesso" className="text-right">Adesso</Th>
                    <Th col="delta_pct" className="text-right">Delta %</Th>
                    <Th col="impatto_eur_anno" className="text-right">Impatto €/anno</Th>
                    <Th col="qta_12m" className="text-right">Qtà 12m</Th>
                  </tr>
                </thead>
                <tbody>
                  {righeOrdinate.map(r => {
                    const d = r.delta_pct == null ? null : Number(r.delta_pct)
                    const rincaro = d != null && d > 0
                    const calo = d != null && d < 0
                    return (
                      <tr key={`${r.p_iva}|${r.nome_normalizzato}|${r.um ?? ''}`}
                        onClick={() => setAperto(r)}
                        className={`border-b border-gray-50 cursor-pointer ${
                          rincaro ? 'bg-red-50/50 hover:bg-red-50' : calo ? 'bg-emerald-50/50 hover:bg-emerald-50' : 'hover:bg-gray-50'
                        }`}>
                        <td className="py-1.5 pr-2 max-w-[240px]">
                          <span className="block truncate font-medium text-gray-800" title={r.nome_normalizzato}>
                            {r.nome_normalizzato}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 max-w-[180px]">
                          <span className="block truncate text-[12px] text-gray-600" title={r.fornitore}>{r.fornitore}</span>
                        </td>
                        <td className="py-1.5">
                          {senzaUm(r.um)
                            ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">senza UM</span>
                            : <span className="text-[11px] text-gray-500">{r.um}</span>}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-gray-500">{fmtEur(r.prezzo_prima, { decimali: 3 })}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtEur(r.prezzo_adesso, { decimali: 3 })}</td>
                        <td className={`py-1.5 text-right tabular-nums font-semibold ${
                          rincaro ? 'text-red-600' : calo ? 'text-emerald-600' : 'text-gray-400'
                        }`}>
                          {rincaro ? <TrendingUp size={11} className="inline mr-1" /> : calo ? <TrendingDown size={11} className="inline mr-1" /> : null}
                          {fmtPct(d, { segno: true })}
                        </td>
                        <td className={`py-1.5 text-right tabular-nums font-bold ${
                          rincaro ? 'text-red-700' : calo ? 'text-emerald-700' : 'text-gray-400'
                        }`}>{fmtEur(r.impatto_eur_anno)}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-500">{fmtNum(r.qta_12m, { decimali: 2 })}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {righeOrdinate.length === 0 && (
              <p className="text-sm text-gray-400 py-8 text-center">Nessun alert con questi filtri.</p>
            )}
            <NotaCopertura righe={righe.length} fonte="v_articolo_alert_prezzo (netto IVA)"
              extra="impatto = (prezzo adesso − prezzo prima) × quantità 12 mesi" troncato={troncato} />
          </Sezione>
        </>
      )}

      {aperto && <DettaglioPrezzo articolo={aperto} onChiudi={() => setAperto(null)} />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 3. PARETO
// ════════════════════════════════════════════════════════════════════════════
function SezionePareto() {
  // `rank` è univoco sulla vista: è la colonna di ordinamento stabile.
  const { righe, troncato, caricamento, errore } = useVista('v_articolo_pareto', ['rank'])
  const [ricerca, setRicerca] = useState('')

  const sintesi = useMemo(() => {
    if (!righe?.length) return null
    const ordinate = [...righe].sort((a, b) => Number(a.rank) - Number(b.rank))
    // L'articolo che TAGLIA l'80% va incluso: fermarsi a pct_cumulata ≤ 80
    // significherebbe dire che quegli articoli fanno l'80% quando ne fanno meno.
    let n80 = ordinate.findIndex(r => Number(r.pct_cumulata) >= 80) + 1
    if (n80 === 0) n80 = ordinate.length
    const spesaTot = ordinate.reduce((s, r) => s + (Number(r.spesa) || 0), 0)
    return {
      n80,
      totale: ordinate.length,
      pctArticoli: ordinate.length ? (n80 / ordinate.length) * 100 : null,
      spesaTot,
      spesa80: ordinate.slice(0, n80).reduce((s, r) => s + (Number(r.spesa) || 0), 0),
      soglia80: ordinate[n80 - 1],
    }
  }, [righe])

  const filtrati = useMemo(() => {
    const q = ricerca.trim().toUpperCase()
    const base = [...(righe ?? [])].sort((a, b) => Number(a.rank) - Number(b.rank))
    if (!q) return base
    return base.filter(r =>
      String(r.nome_normalizzato || '').toUpperCase().includes(q)
      || String(r.descrizione || '').toUpperCase().includes(q))
  }, [righe, ricerca])

  return (
    <div className="space-y-4">
      <Avviso tipo="info">
        Pareto sugli acquisti: gli articoli sono ordinati per spesa decrescente e la colonna{' '}
        <strong>% cumulata</strong> dice quanto della spesa totale è già stato coperto arrivando a
        quella riga. Serve a decidere su cosa vale la pena trattare: sotto la soglia dell'80% ci
        sono centinaia di articoli che, tutti insieme, contano meno dei primi.
      </Avviso>

      {caricamento && <Caricamento testo="Calcolo la concentrazione della spesa…" />}
      {errore && <Avviso tipo="error">Pareto non disponibile: {errore}</Avviso>}

      {!caricamento && righe && sintesi && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi grande label="Articoli che fanno l'80%" value={fmtNum(sintesi.n80)}
              sub={`su ${fmtNum(sintesi.totale)} articoli · ${fmtPct(sintesi.pctArticoli)} del catalogo`}
              tono="attenzione" />
            <Kpi label="Spesa di quei pochi" value={fmtEur(sintesi.spesa80)}
              sub={`su ${fmtEur(sintesi.spesaTot)} totali`} />
            <Kpi label="Coda lunga" value={fmtNum(sintesi.totale - sintesi.n80)}
              sub={`articoli per il restante ${fmtEur(sintesi.spesaTot - sintesi.spesa80)}`} />
            <Kpi label="Ultimo articolo dentro l'80%"
              value={sintesi.soglia80 ? fmtEur(sintesi.soglia80.spesa) : '—'}
              sub={sintesi.soglia80 ? sintesi.soglia80.nome_normalizzato : null} />
          </div>

          <Sezione
            titolo={`Spesa per articolo (${fmtNum(filtrati.length)})`}
            sottotitolo="le righe evidenziate sono quelle che compongono l'80% della spesa"
            azioni={
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={ricerca} onChange={e => setRicerca(e.target.value)}
                    placeholder="cerca articolo…"
                    className="border border-gray-200 rounded-lg pl-8 pr-2.5 py-1.5 text-sm w-[200px]" />
                </div>
                <BottoneCsv righe={filtrati} nomeFile="pareto_articoli"
                  colonne={[
                    { chiave: 'rank', etichetta: 'Rank' },
                    { chiave: 'nome_normalizzato', etichetta: 'Articolo' },
                    { chiave: 'descrizione', etichetta: 'Descrizione' },
                    { chiave: 'spesa', etichetta: 'Spesa € (netto IVA)' },
                    { chiave: 'pct', etichetta: '% sul totale' },
                    { chiave: 'pct_cumulata', etichetta: '% cumulata' },
                  ]} />
              </div>
            }>
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b-2 border-gray-200 text-left text-xs text-gray-500">
                    <th className="py-2 font-semibold w-12 text-right">#</th>
                    <th className="py-2 font-semibold">Articolo</th>
                    <th className="py-2 text-right font-semibold">Spesa</th>
                    <th className="py-2 text-right font-semibold">% tot.</th>
                    <th className="py-2 text-right font-semibold">% cumulata</th>
                    <th className="py-2 font-semibold w-[180px]">Cumulata</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrati.slice(0, 400).map(r => {
                    const cum = Number(r.pct_cumulata)
                    const dentro80 = Number.isFinite(cum) && Number(r.rank) <= sintesi.n80
                    return (
                      <tr key={r.rank} className={`border-b border-gray-50 ${dentro80 ? 'bg-indigo-50/40' : ''}`}>
                        <td className="py-1.5 text-right tabular-nums text-gray-400">{fmtNum(r.rank)}</td>
                        <td className="py-1.5 pr-2 max-w-[320px]">
                          <span className="block truncate font-medium text-gray-800"
                            title={r.descrizione || r.nome_normalizzato}>
                            {r.descrizione || r.nome_normalizzato}
                          </span>
                          <span className="block text-[10px] text-gray-400 font-mono truncate">{r.nome_normalizzato}</span>
                        </td>
                        <td className="py-1.5 text-right tabular-nums font-medium">{fmtEur(r.spesa)}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-500">{fmtPct(r.pct, { decimali: 2 })}</td>
                        <td className="py-1.5 text-right tabular-nums font-medium">{fmtPct(cum)}</td>
                        <td className="py-1.5 pl-2">
                          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${dentro80 ? 'bg-indigo-500' : 'bg-gray-300'}`}
                              style={{ width: `${Math.max(0, Math.min(100, Number.isFinite(cum) ? cum : 0))}%` }} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {filtrati.length > 400 && (
              <p className="text-[11px] text-amber-600 mt-2">
                Mostrate le prime 400 righe di {fmtNum(filtrati.length)}: oltre questa soglia la
                coda lunga pesa pochi euro a riga. L'export CSV contiene tutto.
              </p>
            )}
            <NotaCopertura righe={righe.length} fonte="v_articolo_pareto (netto IVA)" troncato={troncato} />
          </Sezione>
        </>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 4. CONFRONTO FORNITORI
// ════════════════════════════════════════════════════════════════════════════
function SezioneConfronto() {
  const { righe, troncato, caricamento, errore } = useVista(
    'v_articolo_confronto_fornitori',
    ['nome_normalizzato', 'um', 'p_iva', 'descrizione', 'prezzo_wac'],
  )
  const [aperto, setAperto] = useState(null)

  const sintesi = useMemo(() => {
    const tutte = righe ?? []
    return {
      risparmio: tutte.reduce((s, r) => s + (Number(r.risparmio_potenziale_eur) || 0), 0),
      articoli: new Set(tutte.map(r => r.nome_normalizzato)).size,
      fornitori: new Set(tutte.map(r => r.fornitore)).size,
      spesa: tutte.reduce((s, r) => s + (Number(r.spesa) || 0), 0),
    }
  }, [righe])

  // Raggruppato per articolo: il confronto ha senso solo affiancando i fornitori
  // dello stesso prodotto, non incolonnando 51 righe scollegate.
  const gruppi = useMemo(() => {
    const per = new Map()
    for (const r of righe ?? []) {
      const k = `${r.nome_normalizzato}|${r.um ?? ''}`
      if (!per.has(k)) per.set(k, { chiave: k, nome: r.nome_normalizzato, um: r.um, righe: [] })
      per.get(k).righe.push(r)
    }
    return [...per.values()]
      .map(g => ({
        ...g,
        righe: [...g.righe].sort((a, b) => Number(a.prezzo_wac) - Number(b.prezzo_wac)),
        risparmio: g.righe.reduce((s, r) => s + (Number(r.risparmio_potenziale_eur) || 0), 0),
        spesa: g.righe.reduce((s, r) => s + (Number(r.spesa) || 0), 0),
      }))
      .sort((a, b) => b.risparmio - a.risparmio)
  }, [righe])

  return (
    <div className="space-y-4">
      <Avviso tipo="info">
        Solo gli articoli comprati da <strong>più di un fornitore</strong> con la stessa unità di
        misura: sono gli unici casi in cui i prezzi sono davvero confrontabili. Il{' '}
        <strong>risparmio potenziale</strong> è la differenza fra quanto è stato speso e quanto si
        sarebbe speso comprando tutto dal fornitore più conveniente — è un ordine di grandezza per
        decidere dove trattare, non una previsione: il fornitore migliore può non avere la stessa
        disponibilità né le stesse condizioni di consegna.
      </Avviso>

      {caricamento && <Caricamento testo="Confronto i fornitori…" />}
      {errore && <Avviso tipo="error">Confronto non disponibile: {errore}</Avviso>}

      {!caricamento && righe && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi grande label="Risparmio potenziale totale" value={fmtEur(sintesi.risparmio)}
              sub="comprando tutto dal fornitore più conveniente"
              tono={sintesi.risparmio > 0 ? 'attenzione' : 'assente'} />
            <Kpi label="Articoli confrontabili" value={fmtNum(sintesi.articoli)}
              sub={`${fmtNum(righe.length)} combinazioni articolo × fornitore`} />
            <Kpi label="Fornitori coinvolti" value={fmtNum(sintesi.fornitori)} />
            <Kpi label="Spesa sotto confronto" value={fmtEur(sintesi.spesa)} sub="netto IVA" />
          </div>

          <Sezione
            titolo={`Stesso articolo, fornitori diversi (${fmtNum(gruppi.length)})`}
            sottotitolo="in verde il prezzo migliore; clicca una riga per la serie mensile di quel fornitore"
            azioni={<BottoneCsv righe={righe} nomeFile="confronto_fornitori"
              colonne={[
                { chiave: 'nome_normalizzato', etichetta: 'Articolo' },
                { chiave: 'descrizione', etichetta: 'Descrizione' },
                { chiave: 'um', etichetta: 'UM' },
                { chiave: 'fornitore', etichetta: 'Fornitore' },
                { chiave: 'p_iva', etichetta: 'P.IVA' },
                { chiave: 'prezzo_wac', etichetta: 'Prezzo WAC €' },
                { chiave: 'prezzo_migliore', etichetta: 'Prezzo migliore €' },
                { chiave: 'sovrapprezzo_pct', etichetta: 'Sovrapprezzo %' },
                { chiave: 'risparmio_potenziale_eur', etichetta: 'Risparmio potenziale €' },
                { chiave: 'spesa', etichetta: 'Spesa € (netto IVA)' },
                { chiave: 'n_forn', etichetta: 'N. fornitori' },
              ]} />}>
            {gruppi.length === 0
              ? <p className="text-sm text-gray-400 py-8 text-center">Nessun articolo comprato da più fornitori.</p>
              : (
                <div className="space-y-4">
                  {gruppi.map(g => (
                    <div key={g.chiave} className="rounded-lg border border-gray-100 overflow-hidden">
                      <div className="flex items-center justify-between gap-3 bg-gray-50 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{g.nome}</p>
                          <p className="text-[11px] text-gray-500">
                            {etichettaUm(g.um)} · {g.righe.length} fornitori · spesa {fmtEur(g.spesa)}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Risparmio pot.</p>
                          <p className={`text-sm font-bold ${g.risparmio > 0 ? 'text-amber-700' : 'text-gray-400'}`}>
                            {fmtEur(g.risparmio, { decimali: 2 })}
                          </p>
                        </div>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                            <th className="py-1.5 pl-3 font-semibold">Fornitore</th>
                            <th className="py-1.5 text-right font-semibold">Prezzo WAC</th>
                            <th className="py-1.5 text-right font-semibold">Migliore</th>
                            <th className="py-1.5 text-right font-semibold">Sovrapprezzo</th>
                            <th className="py-1.5 text-right font-semibold">Spesa</th>
                            <th className="py-1.5 pr-3 text-right font-semibold">Risparmio pot.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.righe.map(r => {
                            const migliore = Number(r.sovrapprezzo_pct) === 0
                            return (
                              <tr key={`${r.p_iva}|${r.descrizione ?? ''}|${r.prezzo_wac}`}
                                onClick={() => setAperto(r)}
                                className={`border-b border-gray-50 last:border-0 cursor-pointer ${
                                  migliore ? 'bg-emerald-50/60 hover:bg-emerald-50' : 'hover:bg-gray-50'
                                }`}>
                                <td className="py-1.5 pl-3 max-w-[260px]">
                                  <span className="block truncate" title={r.fornitore}>{r.fornitore}</span>
                                  {migliore && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">
                                      più conveniente
                                    </span>
                                  )}
                                  {r.descrizione && (
                                    <span className="block text-[10px] text-gray-400 truncate">{r.descrizione}</span>
                                  )}
                                </td>
                                <td className="py-1.5 text-right tabular-nums font-medium">{fmtEur(r.prezzo_wac, { decimali: 3 })}</td>
                                <td className="py-1.5 text-right tabular-nums text-gray-500">{fmtEur(r.prezzo_migliore, { decimali: 3 })}</td>
                                <td className={`py-1.5 text-right tabular-nums font-medium ${
                                  Number(r.sovrapprezzo_pct) > 0 ? 'text-red-600' : 'text-emerald-600'
                                }`}>{fmtPct(r.sovrapprezzo_pct, { segno: true })}</td>
                                <td className="py-1.5 text-right tabular-nums">{fmtEur(r.spesa)}</td>
                                <td className="py-1.5 pr-3 text-right tabular-nums font-semibold text-amber-700">
                                  {Number(r.risparmio_potenziale_eur) > 0 ? fmtEur(r.risparmio_potenziale_eur, { decimali: 2 }) : '—'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            <NotaCopertura righe={righe.length} fonte="v_articolo_confronto_fornitori (netto IVA)" troncato={troncato} />
          </Sezione>
        </>
      )}

      {aperto && <DettaglioPrezzo articolo={aperto} onChiudi={() => setAperto(null)} />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Box qualità del dato — vale per tutte le sezioni
// ════════════════════════════════════════════════════════════════════════════
function BoxQualitaDato() {
  const { righe, caricamento, errore } = useVista('v_qualita_righe_food', ['p_iva', 'fornitore'])

  const q = useMemo(() => {
    if (!righe?.length) return null
    const totRighe = righe.reduce((s, r) => s + (Number(r.righe) || 0), 0)
    const totSenzaUm = righe.reduce((s, r) => s + (Number(r.senza_um) || 0), 0)
    const totSenzaQta = righe.reduce((s, r) => s + (Number(r.senza_qta) || 0), 0)
    // "Peggiori" pesati sulla spesa: un fornitore al 100% senza UM ma da 200 €
    // l'anno non è il problema; conta quanta spesa resta senza prezzo leggibile.
    const peggiori = [...righe]
      .map(r => ({ ...r, spesaEsposta: (Number(r.spesa) || 0) * ((Number(r.pct_senza_um) || 0) / 100) }))
      .filter(r => r.spesaEsposta > 0)
      .sort((a, b) => b.spesaEsposta - a.spesaEsposta)
      .slice(0, 5)
    return {
      totRighe, totSenzaUm, totSenzaQta,
      pctSenzaUm: totRighe ? (totSenzaUm / totRighe) * 100 : null,
      pctSenzaQta: totRighe ? (totSenzaQta / totRighe) * 100 : null,
      peggiori,
      fornitori: righe.length,
    }
  }, [righe])

  if (caricamento) {
    return <p className="text-[11px] text-gray-400">Controllo la qualità delle righe fattura…</p>
  }
  if (errore) {
    return (
      <p className="text-[11px] text-gray-500">
        Qualità del dato non verificabile ({errore}): i prezzi unitari qui sopra vanno presi con
        cautela finché il controllo non torna disponibile.
      </p>
    )
  }
  if (!q) return null

  return (
    <details className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
      <summary className="cursor-pointer text-xs text-gray-600 flex items-center gap-2 select-none">
        <Ruler size={13} className="text-gray-400 flex-shrink-0" />
        <span>
          <strong>Il {fmtPct(q.pctSenzaUm)} delle righe fattura food non ha unità di misura</strong>
          {' '}— i prezzi unitari degli articoli senza UM sono indicativi. Apri per i dettagli.
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-[11px] text-gray-600 leading-relaxed">
          Su {fmtNum(q.totRighe)} righe di fattura food, {fmtNum(q.totSenzaUm)} non riportano
          l'unità di misura e {fmtNum(q.totSenzaQta)} ({fmtPct(q.pctSenzaQta)}) non riportano
          nemmeno la quantità. Dove manca l'UM, «prezzo unitario» significa spesa ÷ quantità
          dichiarata dal fornitore: un confronto fra due fornitori che usano collo e chilo
          <strong> non è un confronto</strong>. Le variazioni percentuali dello stesso articolo
          presso lo stesso fornitore restano invece leggibili.
        </p>
        <div>
          <p className="text-[11px] font-semibold text-gray-600 mb-1">
            I 5 fornitori con più spesa esposta (quota senza UM × spesa)
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-gray-400 border-b border-gray-200">
                <th className="py-1 font-semibold">Fornitore</th>
                <th className="py-1 text-right font-semibold">Righe</th>
                <th className="py-1 text-right font-semibold">Senza UM</th>
                <th className="py-1 text-right font-semibold">Spesa</th>
                <th className="py-1 text-right font-semibold">Spesa esposta</th>
                <th className="py-1 text-right font-semibold">Ultima fattura</th>
              </tr>
            </thead>
            <tbody>
              {q.peggiori.map(r => (
                <tr key={`${r.p_iva}|${r.fornitore ?? ''}`} className="border-b border-gray-100 last:border-0">
                  <td className="py-1 pr-2 max-w-[220px]">
                    <span className="block truncate text-gray-700" title={r.fornitore}>{r.fornitore}</span>
                  </td>
                  <td className="py-1 text-right tabular-nums text-gray-500">{fmtNum(r.righe)}</td>
                  <td className="py-1 text-right tabular-nums font-medium text-amber-700">{fmtPct(r.pct_senza_um)}</td>
                  <td className="py-1 text-right tabular-nums text-gray-600">{fmtEur(r.spesa)}</td>
                  <td className="py-1 text-right tabular-nums font-semibold text-gray-800">{fmtEur(r.spesaEsposta)}</td>
                  <td className="py-1 text-right tabular-nums text-gray-400">{dataIt(r.ultima_fattura)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <NotaCopertura righe={q.fornitori} fonte="v_qualita_righe_food"
          extra="un record per fornitore food" />
      </div>
    </details>
  )
}

// ════════════════════════════════════════════════════════════════════════════
export default function CatalogoArticoli() {
  const { sezione } = useParams()
  // Una sezione inesistente ricade sulla prima, invece di lasciare l'area
  // contenuti vuota senza alcun errore visibile.
  const attiva = SEZIONI.find(s => s.slug === (sezione ?? null)) ?? SEZIONI[0]

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-gray-900">Catalogo Articoli</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Cosa si compra, da chi, a che prezzo e come quel prezzo si muove: catalogo fornitore ×
          articolo, rincari con impatto in euro, concentrazione della spesa e confronto fra
          fornitori sullo stesso prodotto.
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

      {attiva.id === 'catalogo'  && <SezioneCatalogo />}
      {attiva.id === 'alert'     && <SezioneAlert />}
      {attiva.id === 'pareto'    && <SezionePareto />}
      {attiva.id === 'confronto' && <SezioneConfronto />}

      <BoxQualitaDato />
    </div>
  )
}
