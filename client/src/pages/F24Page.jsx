/**
 * F24Page — le deleghe di versamento, lette dai PDF dello studio.
 *
 * LA COSA DA CAPIRE PRIMA DI GUARDARE QUALSIASI NUMERO.
 * I contributi che compaiono qui (DM10, EPAR, EST1, CXX) sono ESATTAMENTE gli
 * stessi soldi che stanno gia' nei cedolini. L'F24 e' il mezzo con cui si
 * versano, non un costo in piu'. Sommare F24 e costo del personale significa
 * contare due volte la stessa spesa. Per questo la pagina non somma mai nulla
 * al costo del personale: lo RICONCILIA, e basta.
 *
 * Stessa logica per l'IRPEF (1001), le addizionali (3802, 3847, 3848) e l'IVA:
 * sono somme trattenute a terzi e riversate, non costi di conto economico.
 * Le uniche voci che sono davvero un costo per l'azienda sono marcate con il
 * pallino viola: INAIL, Fondo EST, EPAR, bollo, tassa libri sociali, interessi
 * di rateazione.
 *
 * LA DATA. Il nome del file PDF porta la SCADENZA, non la competenza: l'F24
 * "in scadenza al 16/02/2026" versa il mese di GENNAIO 2026. Tutta la pagina
 * ragiona per mese di competenza.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  Receipt, AlertTriangle, CheckCircle2, RefreshCw, ChevronDown, ChevronRight,
  FileText, Landmark, Scale, Info, Users, Layers,
} from 'lucide-react'
import { f24Api } from '../api/supabase-client'
import PageAssistant from '../components/PageAssistant'

// ── formattazione ───────────────────────────────────────────────────────────
const eur = (v, dec = 2) => {
  const n = v === null || v === undefined || v === '' ? null : parseFloat(v)
  if (n === null || Number.isNaN(n)) return '—'
  return n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' €'
}
const eur0 = v => eur(v, 0)
const pct  = v => {
  const n = parseFloat(v)
  return Number.isNaN(n) ? '—' : n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
}
const MESI = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic']
const meseLabel = iso => {
  if (!iso) return '—'
  const [a, m] = String(iso).split('-')
  return `${MESI[parseInt(m, 10) - 1]} ${a}`
}
const dataIt = d => d ? new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

// Colori per natura del codice: dice a colpo d'occhio se e' un costo o un giro.
const NATURA = {
  costo_azienda:        { label: 'Costo azienda',        col: '#a78bfa', desc: 'Spesa vera, va a conto economico' },
  onere_finanziario:    { label: 'Onere finanziario',    col: '#f472b6', desc: 'Interessi: costo vero' },
  trattenuta_dipendente:{ label: 'Trattenuta dipendente',col: '#60a5fa', desc: 'Trattenuta in busta e riversata: giro, non costo' },
  giroconto:            { label: 'Giroconto',            col: '#38bdf8', desc: 'Somma di terzi che transita: non e’ costo' },
  imposta_neutra:       { label: 'IVA',                  col: '#34d399', desc: 'Imposta neutrale: non e’ costo' },
  anticipo_stato:       { label: 'Anticipo per lo Stato',col: '#fbbf24', desc: 'Erogato in busta e recuperato in compensazione' },
  credito_recupero:     { label: 'Credito recuperato',   col: '#22d3ee', desc: 'Versamenti in eccesso riutilizzati' },
  misto:                { label: 'Misto',                col: '#fb923c', desc: 'In parte azienda, in parte lavoratore' },
}

// ── mattoncini ──────────────────────────────────────────────────────────────
function Kpi({ label, value, sub, tone = 'slate', icon: Icon }) {
  const t = {
    slate:  'from-slate-600 to-slate-700',
    blue:   'from-blue-500 to-blue-600',
    purple: 'from-purple-500 to-purple-600',
    amber:  'from-amber-500 to-amber-600',
    green:  'from-emerald-500 to-emerald-600',
    rose:   'from-rose-500 to-rose-600',
  }[tone]
  return (
    <div className={`bg-gradient-to-br ${t} rounded-lg p-5 text-white shadow-lg`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <p className="text-sm opacity-80 font-medium">{label}</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
        </div>
        {Icon && <Icon size={22} className="opacity-60" />}
      </div>
      {sub && <p className="text-xs opacity-70">{sub}</p>}
    </div>
  )
}

function Sezione({ titolo, icona: Icona, sottotitolo, children, apertoDefault = true }) {
  const [aperto, setAperto] = useState(apertoDefault)
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setAperto(a => !a)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-800/70 transition"
      >
        {aperto ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        {Icona && <Icona size={16} className="text-gray-300" />}
        <span className="font-semibold text-white">{titolo}</span>
        {sottotitolo && <span className="text-xs text-gray-400 ml-2">{sottotitolo}</span>}
      </button>
      {aperto && <div className="px-5 pb-5">{children}</div>}
    </div>
  )
}

function Avviso({ tono = 'amber', titolo, children }) {
  const t = {
    amber: 'bg-amber-900/20 border-amber-700/50 text-amber-200',
    rose:  'bg-rose-900/20 border-rose-700/50 text-rose-200',
    blue:  'bg-blue-900/20 border-blue-700/50 text-blue-200',
  }[tono]
  return (
    <div className={`border rounded-lg px-4 py-3 text-sm ${t}`}>
      {titolo && <p className="font-semibold mb-1 flex items-center gap-2"><AlertTriangle size={14} /> {titolo}</p>}
      <div className="text-[13px] leading-relaxed opacity-90">{children}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
export default function F24Page() {
  const [dati, setDati]   = useState(null)
  const [err,  setErr]    = useState(null)
  const [busy, setBusy]   = useState(true)
  const [apertaId, setApertaId] = useState(null)
  const [catAperta, setCatAperta] = useState('Contributi INPS')

  const carica = React.useCallback(() => {
    setBusy(true); setErr(null)
    f24Api.quadro().then(setDati).catch(e => setErr(e.message || String(e))).finally(() => setBusy(false))
  }, [])
  useEffect(carica, [carica])

  const codiciMap = useMemo(() => {
    const m = {}
    for (const c of dati?.codici ?? []) m[c.codice] = c
    return m
  }, [dati])

  const righePerDelega = useMemo(() => {
    const m = {}
    for (const r of dati?.righe ?? []) (m[r.delega_id] ||= []).push(r)
    return m
  }, [dati])

  // Totali generali
  const tot = useMemo(() => {
    const d = dati?.deleghe ?? []
    const r = dati?.righe ?? []
    const versato = d.reduce((s, x) => s + (parseFloat(x.saldo) || 0), 0)
    const costoVero = r.reduce((s, x) => {
      const c = codiciMap[x.codice]
      return s + (c?.e_costo_azienda ? (parseFloat(x.importo) || 0) : 0)
    }, 0)
    const avvisi = r.reduce((s, x) => s + (['9001','9002'].includes(x.codice) ? (parseFloat(x.importo) || 0) : 0), 0)
    const mesi = new Set(d.map(x => x.mese_competenza)).size
    return { versato, costoVero, avvisi, mesi, deleghe: d.length }
  }, [dati, codiciMap])

  // Andamento mensile per categoria
  const perMese = useMemo(() => {
    const m = {}
    for (const r of dati?.mensile ?? []) {
      const k = r.mese
      m[k] ||= { mese: k, label: meseLabel(k), totale: 0 }
      m[k][r.categoria] = (m[k][r.categoria] || 0) + (parseFloat(r.importo) || 0)
      m[k].totale += parseFloat(r.importo) || 0
    }
    return Object.values(m).sort((a, b) => a.mese.localeCompare(b.mese))
  }, [dati])

  const categorie = useMemo(() => {
    const s = new Set((dati?.mensile ?? []).map(r => r.categoria))
    return [...s].sort()
  }, [dati])

  // ── Analisi per tributo ────────────────────────────────────────────────
  // Si parte dalle righe vere, non dalle viste, cosi' il totale di questa
  // sezione e' per costruzione lo stesso delle deleghe.
  const mesiElenco = useMemo(
    () => [...new Set((dati?.deleghe ?? []).map(d => String(d.mese_competenza).slice(0,7)))].sort(),
    [dati])

  const perCodice = useMemo(() => {
    const mesePerDelega = {}
    for (const d of dati?.deleghe ?? []) mesePerDelega[d.id] = String(d.mese_competenza).slice(0,7)
    const acc = {}
    for (const r of dati?.righe ?? []) {
      const k = r.codice
      if (!k) continue
      const a = acc[k] ||= { codice: k, importo: 0, righe: 0, perMese: {} }
      const v = parseFloat(r.importo) || 0
      a.importo += v; a.righe += 1
      const m = mesePerDelega[r.delega_id]
      if (m) a.perMese[m] = (a.perMese[m] || 0) + v
    }
    return acc
  }, [dati])

  const totaleAssoluto = useMemo(
    () => Object.values(perCodice).reduce((s, c) => s + Math.abs(c.importo), 0), [perCodice])

  const categorieAnalisi = useMemo(() => {
    const cats = {}
    for (const c of Object.values(perCodice)) {
      const an = codiciMap[c.codice] || {}
      const nat = NATURA[an.natura] || { label: an.natura || 'da classificare', col: '#9ca3af' }
      const nome = an.categoria || 'Da classificare'
      const cat = cats[nome] ||= { nome, importo: 0, costoVero: 0, codici: [] }
      cat.importo += c.importo
      if (an.e_costo_azienda) cat.costoVero += c.importo
      cat.codici.push({
        ...c,
        sezione: an.sezione || '—',
        descrizione: an.descrizione || 'Codice non ancora in anagrafica: da verificare con lo studio.',
        note: an.note, riferimento_normativo: an.riferimento_normativo,
        nat,
        quota: totaleAssoluto ? Math.abs(c.importo) / totaleAssoluto * 100 : 0,
        maxMese: Math.max(...Object.values(c.perMese).map(Math.abs), 0),
      })
    }
    return Object.values(cats)
      .map(c => ({ ...c,
        quota: totaleAssoluto ? Math.abs(c.importo) / totaleAssoluto * 100 : 0,
        codici: c.codici.sort((a,b) => Math.abs(b.importo) - Math.abs(a.importo)) }))
      .sort((a,b) => Math.abs(b.importo) - Math.abs(a.importo))
  }, [perCodice, codiciMap, totaleAssoluto])

  // Ripartizione per natura: la risposta a "di tutto questo, quanto e' spesa vera?"
  const ripartizione = useMemo(() => {
    const acc = {}
    for (const c of Object.values(perCodice)) {
      const an = codiciMap[c.codice] || {}
      const k = an.natura || 'sconosciuta'
      const a = acc[k] ||= { natura: k, importo: 0, n: 0 }
      a.importo += c.importo; a.n += 1
    }
    return Object.values(acc)
      .map(a => ({ ...a, ...(NATURA[a.natura] || { label: a.natura, col: '#9ca3af', desc: '' }),
                   quota: totaleAssoluto ? Math.abs(a.importo) / totaleAssoluto * 100 : 0 }))
      .sort((a,b) => Math.abs(b.importo) - Math.abs(a.importo))
  }, [perCodice, codiciMap, totaleAssoluto])

  // Mesi incompleti: la copertura dice quali pezzi mancano
  const incompleti = useMemo(() => (dati?.copertura ?? []).filter(r => !r.completo), [dati])

  // Deleghe raggruppate per mese di competenza
  const perMeseDeleghe = useMemo(() => {
    const m = {}
    for (const d of dati?.deleghe ?? []) (m[d.mese_competenza] ||= []).push(d)
    return Object.entries(m).sort(([a],[b]) => a.localeCompare(b))
  }, [dati])

  if (busy && !dati) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-gray-400 flex items-center gap-3"><RefreshCw size={18} className="animate-spin" /> Carico le deleghe F24…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="p-6 space-y-6 max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <Receipt size={24} className="text-blue-400" /> F24 — Imposte, tributi e contributi versati
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Imposte, IVA e contributi versati · competenza {perMeseDeleghe.length ? `${meseLabel(perMeseDeleghe[0][0])} → ${meseLabel(perMeseDeleghe[perMeseDeleghe.length-1][0])}` : '—'}
            </p>
          </div>
          <button
            onClick={carica}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Ricarica
          </button>
        </div>

        {err && <Avviso tono="rose" titolo="Errore di lettura">{err}</Avviso>}

        {/* IL PUNTO: non sommare F24 e costo del personale */}
        <div className="bg-blue-900/20 border border-blue-700/50 rounded-xl px-5 py-4">
          <p className="text-sm font-semibold text-blue-200 flex items-center gap-2 mb-2">
            <Info size={15} /> Come si legge questa pagina
          </p>
          <p className="text-[13px] text-blue-100/90 leading-relaxed">
            I contributi che vedi qui — DM10, EPAR, EST1, CXX — sono <strong>gli stessi soldi</strong> che stanno
            gia' nei cedolini della sezione Dipendenti &amp; Paga. L'F24 e' il mezzo con cui si versano,
            non una spesa in piu': <strong>non vanno mai sommati al costo del personale</strong>, si riconciliano
            e basta. Lo stesso vale per IRPEF, addizionali e IVA, che sono somme trattenute a terzi e riversate.
            Le uniche voci che sono davvero un costo dell'azienda sono quelle marcate <span className="text-purple-300 font-medium">Costo azienda</span>.
          </p>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi label="Totale versato" value={eur0(tot.versato)} tone="blue" icon={Landmark}
               sub={`${tot.deleghe} deleghe su ${tot.mesi} mesi`} />
          <Kpi label="Di cui costo vero" value={eur0(tot.costoVero)} tone="purple" icon={Scale}
               sub="INAIL, Fondo EST, EPAR, bolli, interessi" />
          <Kpi label="Avvisi bonari" value={eur0(tot.avvisi)} tone="amber" icon={AlertTriangle}
               sub={`${(dati?.avvisi ?? []).length} piani di rateazione in corso`} />
          <Kpi label="Mesi incompleti" value={incompleti.length} tone={incompleti.length ? 'rose' : 'green'}
               icon={incompleti.length ? AlertTriangle : CheckCircle2}
               sub={incompleti.length ? incompleti.map(r => meseLabel(r.mese)).join(', ') : 'tutti i mesi completi'} />
        </div>

        {/* Buchi di copertura */}
        {incompleti.length > 0 && (
          <Avviso tono="rose" titolo="Deleghe mancanti — da chiedere allo studio">
            <ul className="mt-2 space-y-1">
              {incompleti.map(r => {
                const manca = []
                if (!r.ha_dm10)  manca.push('contributi INPS (DM10)')
                if (!r.ha_irpef) manca.push('IRPEF dipendenti (1001)')
                if (!r.ha_iva)   manca.push('IVA mensile')
                if (!r.ha_enti)  manca.push('enti bilaterali (EPAR / EST1 / CXX)')
                return (
                  <li key={r.mese} className="flex flex-wrap gap-2 items-baseline">
                    <span className="font-semibold text-rose-100">{meseLabel(r.mese)}</span>
                    <span className="opacity-80">versati {eur(r.totale_versato)} su {r.deleghe} deleghe —</span>
                    <span className="opacity-90">manca: {manca.join(', ')}</span>
                  </li>
                )
              })}
            </ul>
            <p className="mt-2 opacity-80">
              Questi mesi sono caricati con i soli documenti realmente presenti nella cartella F24:
              nessun importo e' stato stimato o inventato.
            </p>
          </Avviso>
        )}

        {/* Andamento mensile */}
        <Sezione titolo="Andamento mensile per categoria" icona={Layers}
                 sottotitolo="mese di competenza, non di scadenza">
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={perMese} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="label" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={v => `${Math.round(v/1000)}k`} />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                  formatter={(v, n) => [eur(v), n]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {categorie.map((c, i) => (
                  <Bar key={c} dataKey={c} stackId="a" name={c}
                       fill={['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899','#84cc16'][i % 8]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Sezione>

        {/* Riconciliazione contributi */}
        <Sezione titolo="Riconciliazione contributi INPS ↔ cedolini" icona={Users}
                 sottotitolo="due termini di confronto affiancati, mai una somma">
          <p className="text-[13px] text-gray-400 mb-4 leading-relaxed">
            Il <strong className="text-gray-300">DM10</strong> e' quello che l'azienda versa davvero all'INPS ed e'
            gia' <em>al netto dei conguagli</em> (esoneri contributivi, ANF, malattia e maternita' anticipate).
            Per questo e' fisiologicamente piu' basso della ricostruzione teorica per aliquote (9,19% a carico
            dipendente + 30% a carico azienda = 39,19% dell'imponibile). Lo scarto negativo non e' un errore:
            e' quanto l'azienda ha recuperato in conguaglio. Quello che invece va guardato e' un mese
            che si stacca dagli altri.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-700">
                  <th className="py-2 pr-3">Mese</th>
                  <th className="py-2 px-3 text-right">DM10 versato</th>
                  <th className="py-2 px-3 text-right">Lorda cedolini</th>
                  <th className="py-2 px-3 text-right">Contributi da cedolini</th>
                  <th className="py-2 px-3 text-right">Ricostruiti 39,19%</th>
                  <th className="py-2 px-3 text-right">Scarto</th>
                  <th className="py-2 px-3 text-right">Aliquota reale</th>
                  <th className="py-2 pl-3 text-right">Cedolini</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {(dati?.riconc ?? []).map(r => {
                  const anomalo = r.aliquota_implicita_pct !== null && parseFloat(r.aliquota_implicita_pct) < 25
                  return (
                    <tr key={r.mese} className={`border-b border-gray-800 ${anomalo ? 'bg-rose-900/20' : ''}`}>
                      <td className="py-2 pr-3 font-medium text-white">{meseLabel(r.mese)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{eur(r.f24_dm10)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{eur(r.ced_lorda)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-gray-500">
                        {r.ced_contributi_letti === null ? 'non estratto' : eur(r.ced_contributi_letti)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{eur(r.ced_contributi_ricostruiti)}</td>
                      <td className={`py-2 px-3 text-right tabular-nums ${anomalo ? 'text-rose-300 font-semibold' : 'text-gray-400'}`}>
                        {eur(r.scarto_b)}
                      </td>
                      <td className={`py-2 px-3 text-right tabular-nums ${anomalo ? 'text-rose-300 font-semibold' : ''}`}>
                        {pct(r.aliquota_implicita_pct)}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums text-gray-400">{r.cedolini ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {(dati?.riconc ?? []).some(r => r.f24_dmra_pregressi) && (
            <p className="text-xs text-gray-500 mt-3">
              I versamenti con causale <strong>DMRA</strong> (rettifiche di periodi precedenti) sono tenuti fuori
              dalla colonna DM10: si riferiscono a mesi diversi da quello di competenza e falserebbero il confronto.
            </p>
          )}
        </Sezione>

        {/* Avvisi bonari */}
        <Sezione titolo="Avvisi bonari e rateazioni" icona={AlertTriangle}
                 sottotitolo="controllo automatizzato art. 36-bis · un piano per codice atto">
          <Avviso tono="amber" titolo="Da chiedere allo studio">
            Dagli F24 si vede quanto e' stato pagato, ma <strong>non quante rate mancano</strong> ne' quale imposta
            originaria ha generato ciascun avviso: la rata non e' numerata, la posizione e' identificata solo dal
            codice atto. Serve dallo studio l'elenco dei piani residui per ogni codice atto, con imposta di
            origine e numero di rate. Nota contabile: nel codice 9001 la quota sanzione e' <strong>indeducibile</strong>,
            mentre il 9002 (interessi di rateazione, 3,5% annuo) e' un onere finanziario deducibile.
          </Avviso>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-700">
                  <th className="py-2 pr-3">Codice atto</th>
                  <th className="py-2 px-3 text-right">Anno imposta</th>
                  <th className="py-2 px-3 text-right">Rate versate</th>
                  <th className="py-2 px-3">Periodo</th>
                  <th className="py-2 px-3 text-right">Rata capitale</th>
                  <th className="py-2 px-3 text-right">Capitale (9001)</th>
                  <th className="py-2 px-3 text-right">Interessi (9002)</th>
                  <th className="py-2 pl-3 text-right">Totale versato</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {(dati?.avvisi ?? []).map(a => (
                  <tr key={a.codice_atto} className="border-b border-gray-800">
                    <td className="py-2 pr-3 font-mono text-xs text-white">{a.codice_atto}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{a.anno_imposta}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{a.rate_versate}</td>
                    <td className="py-2 px-3 text-gray-400 text-xs">
                      {meseLabel(String(a.prima_rata).slice(0,7))} → {meseLabel(String(a.ultima_rata).slice(0,7))}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-400">{eur(a.rata_capitale)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{eur(a.capitale)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-pink-300">{eur(a.interessi)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums font-semibold text-white">{eur(a.totale_versato)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-white font-semibold">
                  <td className="py-2 pr-3" colSpan={5}>Totale</td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {eur((dati?.avvisi ?? []).reduce((s,a) => s + (parseFloat(a.capitale)||0), 0))}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-pink-300">
                    {eur((dati?.avvisi ?? []).reduce((s,a) => s + (parseFloat(a.interessi)||0), 0))}
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {eur((dati?.avvisi ?? []).reduce((s,a) => s + (parseFloat(a.totale_versato)||0), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Sezione>

        {/* ANALISI PER TRIBUTO — il cuore della pagina */}
        <Sezione titolo="Analisi per tributo" icona={FileText}
                 sottotitolo="che cos'e' ogni codice, quanto pesa, e se e' un costo o solo denaro che transita">
          <p className="text-[13px] text-gray-400 mb-5 leading-relaxed">
            Ogni riga qui sotto e' un codice tributo o una causale contributo realmente
            comparsa nelle deleghe. Per ciascuno: la descrizione ufficiale dell'Agenzia
            delle Entrate o dell'INPS, la norma che lo istituisce, quanto e' stato versato
            da gennaio a luglio, che percentuale pesa sul totale e come si distribuisce
            nei mesi. Il colore dice la cosa piu' importante: se quel denaro e'
            <span className="text-purple-300 font-medium"> una spesa dell'azienda</span> oppure
            se <span className="text-sky-300 font-medium">transita e basta</span>.
          </p>

          {/* Ripartizione per natura */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {ripartizione.map(r => (
              <div key={r.natura} className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: r.col }} />
                  <p className="text-xs font-semibold" style={{ color: r.col }}>{r.label}</p>
                </div>
                <p className="text-xl font-bold text-white tabular-nums">{eur0(r.importo)}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{r.quota.toFixed(1)}% del versato · {r.n} codici</p>
                <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">{r.desc}</p>
              </div>
            ))}
          </div>

          {/* Categorie, con i codici dentro */}
          <div className="space-y-3">
            {categorieAnalisi.map(cat => (
              <div key={cat.nome} className="bg-gray-900/40 border border-gray-800 rounded-lg overflow-hidden">
                <button
                  onClick={() => setCatAperta(catAperta === cat.nome ? null : cat.nome)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-800/50 transition"
                >
                  {catAperta === cat.nome
                    ? <ChevronDown size={14} className="text-gray-500" />
                    : <ChevronRight size={14} className="text-gray-500" />}
                  <span className="font-semibold text-white text-sm">{cat.nome}</span>
                  <span className="text-[11px] text-gray-500">{cat.codici.length} codici</span>
                  {cat.costoVero > 0 && (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-purple-900/40 text-purple-300 border border-purple-800/50">
                      di cui costo vero {eur0(cat.costoVero)}
                    </span>
                  )}
                  <span className="ml-auto text-right">
                    <span className="text-sm font-bold text-white tabular-nums">{eur(cat.importo)}</span>
                    <span className="block text-[11px] text-gray-500">{cat.quota.toFixed(1)}% del versato</span>
                  </span>
                </button>

                {catAperta === cat.nome && (
                  <div className="px-4 pb-4 space-y-3">
                    {cat.codici.map(c => (
                      <div key={c.codice} className="bg-gray-900/60 border border-gray-800 rounded-lg p-4">
                        <div className="flex items-start gap-3 flex-wrap">
                          <span className="font-mono text-sm font-bold text-white bg-gray-800 px-2 py-0.5 rounded">
                            {c.codice}
                          </span>
                          <span className="text-[11px] text-gray-500 pt-1">{c.sezione}</span>
                          <span className="inline-flex items-center gap-1.5 text-[11px] pt-1" style={{ color: c.nat.col }}>
                            <span className="w-2 h-2 rounded-full" style={{ background: c.nat.col }} />{c.nat.label}
                          </span>
                          <span className="ml-auto text-right">
                            <span className={`text-lg font-bold tabular-nums ${c.importo < 0 ? 'text-cyan-300' : 'text-white'}`}>
                              {eur(c.importo)}
                            </span>
                            <span className="block text-[11px] text-gray-500">
                              {c.quota >= 0.05 ? `${c.quota.toFixed(1)}% del versato · ` : ''}{c.righe} righe
                            </span>
                          </span>
                        </div>

                        <p className="text-[13px] text-gray-200 mt-2 leading-relaxed">{c.descrizione}</p>
                        {c.note && <p className="text-[12px] text-gray-400 mt-1.5 leading-relaxed">{c.note}</p>}

                        <div className="flex items-end gap-4 mt-3 flex-wrap">
                          {/* andamento mensile */}
                          <div className="flex items-end gap-1 h-10">
                            {mesiElenco.map(m => {
                              const v = c.perMese[m] || 0
                              const h = c.maxMese > 0 ? Math.max(2, Math.round(Math.abs(v) / c.maxMese * 38)) : 2
                              return (
                                <div key={m} className="flex flex-col items-center gap-1" title={`${meseLabel(m)}: ${eur(v)}`}>
                                  <div className="w-5 rounded-sm" style={{ height: h, background: v === 0 ? '#374151' : c.nat.col, opacity: v === 0 ? 0.4 : 0.85 }} />
                                </div>
                              )
                            })}
                          </div>
                          <div className="flex gap-1 text-[9px] text-gray-600">
                            {mesiElenco.map(m => <span key={m} className="w-5 text-center">{meseLabel(m).slice(0,3)}</span>)}
                          </div>
                          {c.riferimento_normativo && (
                            <span className="text-[11px] text-gray-500 ml-auto max-w-md text-right">{c.riferimento_normativo}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Sezione>

        {/* Deleghe una per una */}
        <Sezione titolo="Le deleghe, una per una" icona={Receipt}
                 sottotitolo={`${tot.deleghe} deleghe uniche · ogni riga quadra sui TOTALE stampati`}
                 apertoDefault={false}>
          <div className="space-y-4">
            {perMeseDeleghe.map(([mese, lista]) => (
              <div key={mese}>
                <div className="flex items-baseline gap-3 mb-2">
                  <h4 className="font-semibold text-white">{meseLabel(mese)}</h4>
                  <span className="text-xs text-gray-500">
                    scadenza {dataIt(lista[0]?.scadenza)} · {lista.length} deleghe ·{' '}
                    {eur(lista.reduce((s,d) => s + (parseFloat(d.saldo)||0), 0))}
                  </span>
                </div>
                <div className="space-y-1">
                  {lista.map(d => {
                    const aperta = apertaId === d.id
                    const righe = righePerDelega[d.id] ?? []
                    return (
                      <div key={d.id} className="bg-gray-900/40 border border-gray-800 rounded-lg">
                        <button
                          onClick={() => setApertaId(aperta ? null : d.id)}
                          className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-800/50 transition"
                        >
                          {aperta ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
                          <span className="text-xs text-gray-500 w-12">p. {d.pagina}</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">{d.tipo.replace(/_/g,' ')}</span>
                          {d.codice_atto && <span className="text-[11px] font-mono text-amber-300">atto {d.codice_atto}</span>}
                          {d.copie_stampate > 1 && (
                            <span className="text-[11px] text-gray-600">{d.copie_stampate} copie stampate</span>
                          )}
                          <span className="ml-auto text-sm font-semibold text-white tabular-nums">{eur(d.saldo)}</span>
                          {d.quadratura_ok
                            ? <CheckCircle2 size={14} className="text-emerald-500" />
                            : <AlertTriangle size={14} className="text-rose-400" />}
                        </button>
                        {aperta && (
                          <div className="px-3 pb-3">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                                  <th className="py-1.5 pr-2">Sezione</th>
                                  <th className="py-1.5 px-2">Codice</th>
                                  <th className="py-1.5 px-2">Descrizione</th>
                                  <th className="py-1.5 px-2">Periodo</th>
                                  <th className="py-1.5 px-2 text-right">Debito</th>
                                  <th className="py-1.5 pl-2 text-right">Credito</th>
                                </tr>
                              </thead>
                              <tbody className="text-gray-400">
                                {righe.map(r => (
                                  <tr key={r.id} className="border-b border-gray-800/60">
                                    <td className="py-1.5 pr-2 text-gray-600">{r.sezione}</td>
                                    <td className="py-1.5 px-2 font-mono text-gray-200">{r.codice}</td>
                                    <td className="py-1.5 px-2">{codiciMap[r.codice]?.descrizione ?? '—'}</td>
                                    <td className="py-1.5 px-2 text-gray-500">
                                      {r.periodo_da ? `${r.periodo_da}${r.periodo_a ? ` → ${r.periodo_a}` : ''}` : (r.anno ?? '')}
                                      {r.codice_comune && <span className="ml-1 text-gray-600">· {r.codice_comune}</span>}
                                    </td>
                                    <td className="py-1.5 px-2 text-right tabular-nums">{r.debito ? eur(r.debito) : ''}</td>
                                    <td className="py-1.5 pl-2 text-right tabular-nums text-cyan-400">{r.credito ? eur(r.credito) : ''}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </Sezione>

        <p className="text-[11px] text-gray-600 pb-6">
          Fonte: PDF «Modello F24 in scadenza al GGMMAAAA» della cartella F24. Ogni delega e' stata validata
          sui TOTALE A/B, C/D, E/F, G/H, I/L e sul SALDO FINALE stampati sul modello; le copie ripetute dello
          stesso modello sono state riconosciute e contate una volta sola.
        </p>
      </div>
      <PageAssistant
        pagina="F24"
        suggerimenti={[
          "Quanto abbiamo versato di contributi INPS quest'anno?",
          "Il DM10 torna con i contributi dei cedolini?",
          "Quanto pesano gli avvisi bonari ancora in rateazione?",
          "Quali di queste voci sono un costo vero per l'azienda?",
        ]}
      />
    </div>
  )
}
