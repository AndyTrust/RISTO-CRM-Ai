/**
 * Scadenzario — tutto quello che resta da pagare, in un posto solo.
 *
 * UN AVVERTIMENTO CHE VA LETTO PRIMA DEI NUMERI.
 * I termini di pagamento delle fatture NON sono a sistema. Non stanno nei fogli
 * dell'amministrazione, e il campo `scadenza_pagamento` di fatture_importate e'
 * valorizzato solo sulle fatture gia' saldate, dove contiene la data in cui si
 * e' pagato — non la data entro cui si doveva pagare. Quindi per le fatture
 * aperte questa pagina ragiona per ANZIANITA' dalla data della fattura, non per
 * scadenza vera, e lo dichiara ovunque. Il giorno in cui si estrarra'
 * DataScadenzaPagamento dagli XML FatturaPA archiviati in FATTURE/, la vista
 * v_scadenzario diventera' esatta senza toccare questa pagina.
 *
 * I costi fissi invece sono pianificati fino a dicembre: quelli sono previsioni
 * vere, con la data quando c'e' e fine mese quando manca.
 *
 * I RATEI arrivano dalla scheda RATEALI dei due fogli e sono l'unica parte di
 * questa pagina con scadenze certe: la rata ha la sua data scritta sopra. Il
 * foglio pero' non ha una colonna PAGATO, quindi una rata con scadenza passata
 * si considera versata — assunzione che regge, perche' la somma delle rate
 * scadute nel mese coincide al centesimo con la riga RATEI pagata nella scheda
 * FORNITORI. Le rate elencate senza data sono impegni futuri che
 * l'amministrazione non ha ancora compilato: esistono, ma non sanno quando.
 * Per non contare due volte lo stesso denaro, le voci "Ratei cartelle e
 * finanziamenti" di costi_fissi — che erano la stima mensile di questi stessi
 * piani — sono escluse dallo scadenzario.
 *
 * Il dettaglio rata per rata sta in Costi & Margini → Rate & Piani: qui resta
 * solo il totale, perche' in mezzo alle fatture una rata si perde.
 *
 * MODIFICHE. Da qui si puo' segnare una fattura pagata. La RPC aggiorna la
 * fattura, la riga corrispondente del registro del foglio, e accoda la cella
 * PAGATO da riscrivere nel workbook: a scrivere il file ci pensa
 * APPLICA_AL_FOGLIO.bat sul PC. Finche' la coda non e' vuota, su quelle celle
 * il foglio dice ancora la cosa vecchia — ed e' scritto in cima alla pagina.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  CalendarClock, AlertTriangle, Building2, Wallet, RefreshCw, Info,
  ChevronDown, ChevronRight, Clock, TrendingUp, Landmark, GitCompareArrows,
  Pencil, Save, X, FileSpreadsheet, ArrowRight,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { scadenzarioApi } from '../api/supabase-client'
import PageAssistant from '../components/PageAssistant'

const eur = (v, dec = 2) => {
  const n = v === null || v === undefined || v === '' ? null : parseFloat(v)
  if (n === null || Number.isNaN(n)) return '—'
  return n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' €'
}
const eur0 = v => eur(v, 0)
const MESI = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic']
const meseLabel = iso => {
  if (!iso) return '—'
  const [a, m] = String(iso).slice(0, 7).split('-')
  return `${MESI[parseInt(m, 10) - 1]} ${a}`
}
const dataIt = d => d ? new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

// Fasce di anzianita': sono quelle che si usano per decidere chi pagare prima.
const FASCE = [
  { id: '0-30',   label: 'Entro 30 giorni',  min: -99999, max: 30,     col: '#34d399' },
  { id: '31-60',  label: '31–60 giorni',     min: 31,     max: 60,     col: '#fbbf24' },
  { id: '61-90',  label: '61–90 giorni',     min: 61,     max: 90,     col: '#fb923c' },
  { id: '90+',    label: 'Oltre 90 giorni',  min: 91,     max: 99999,  col: '#f87171' },
]
const fasciaDi = g => FASCE.find(f => g >= f.min && g <= f.max) || FASCE[0]

function Kpi({ label, value, sub, tone = 'slate', icon: Icon }) {
  const t = {
    slate:  'from-slate-600 to-slate-700',
    blue:   'from-blue-500 to-blue-600',
    amber:  'from-amber-500 to-amber-600',
    rose:   'from-rose-500 to-rose-600',
    purple: 'from-purple-500 to-purple-600',
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
      <button onClick={() => setAperto(a => !a)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-800/70 transition">
        {aperto ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        {Icona && <Icona size={16} className="text-gray-300" />}
        <span className="font-semibold text-white">{titolo}</span>
        {sottotitolo && <span className="text-xs text-gray-400 ml-2">{sottotitolo}</span>}
      </button>
      {aperto && <div className="px-5 pb-5">{children}</div>}
    </div>
  )
}

/** Il pannellino per segnare pagata una fattura, dentro l'elenco. */
function ModificaSaldo({ riga, onChiudi, onSalvato }) {
  const totale = Math.abs(parseFloat(riga.importo) || 0)
  const [pagato, setPagato] = useState(totale.toFixed(2))
  const [data, setData]     = useState(new Date().toISOString().slice(0, 10))
  const [metodo, setMetodo] = useState('Unicredit')
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState(null)

  const salva = async () => {
    setBusy(true); setErr(null)
    try {
      const out = await scadenzarioApi.segnaFatturaPagata({
        fatturaId: riga.chiave,
        pagato: parseFloat(String(pagato).replace(',', '.')),
        data, metodo, autore: 'CRM',
      })
      onSalvato(out)
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  return (
    // data-modifica-in-corso: finche' questa riga e' aperta l'aggiornamento
    // automatico non rimonta la pagina, altrimenti quanto digitato sparirebbe.
    <tr className="bg-gray-900/80" data-modifica-in-corso="">
      <td colSpan={8} className="px-4 py-4">
        <p className="text-sm text-white mb-3">
          {riga.descrizione} · {riga.riferimento || 'senza numero'} · da pagare {eur(riga.importo)}
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">Importo pagato</label>
            <input type="text" inputMode="decimal" value={pagato} onChange={e => setPagato(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-white w-32 tabular-nums" />
          </div>
          <div className="flex gap-1 pb-0.5">
            <button onClick={() => setPagato(totale.toFixed(2))}
              className="px-3 py-1.5 rounded text-xs bg-gray-800 text-gray-300 hover:bg-gray-700">tutto</button>
            <button onClick={() => setPagato('0.00')}
              className="px-3 py-1.5 rounded text-xs bg-gray-800 text-gray-300 hover:bg-gray-700">niente</button>
          </div>
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">Pagata il</label>
            <input type="date" value={data} onChange={e => setData(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-white" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">Con</label>
            <select value={metodo} onChange={e => setMetodo(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-white">
              {['Unicredit','Carta','Contanti','Addebito conto','SumUp','PayPal','Sardex','Worldline','Premio'].map(m =>
                <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex gap-2 ml-auto">
            <button onClick={salva} disabled={busy}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded">
              <Save size={14} /> {busy ? 'Salvo…' : 'Salva'}
            </button>
            <button onClick={onChiudi}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-1.5 rounded">
              <X size={14} /> Annulla
            </button>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mt-3">
          Salvando si aggiorna la fattura nel CRM e si mette in coda la cella PAGATO da riscrivere nel foglio
          dell'amministrazione. Il foglio cambia davvero solo quando qualcuno lancia APPLICA_AL_FOGLIO.bat sul PC.
        </p>
        {err && <p className="text-xs text-rose-300 mt-2">{err}</p>}
      </td>
    </tr>
  )
}

export default function Scadenzario() {
  const [righe, setRighe] = useState([])
  const [piani, setPiani] = useState([])
  const [rate, setRate]   = useState([])
  const [ricon, setRicon] = useState([])
  const [riconTot, setRiconTot] = useState([])
  const [coda, setCoda]   = useState([])
  const [inModifica, setInModifica] = useState(null)
  const [busy, setBusy]   = useState(true)
  const [err, setErr]     = useState(null)
  const [sede, setSede]   = useState('Tutte')
  const [vista, setVista] = useState('tutto')   // tutto | fatture | costi
  const [fascia, setFascia] = useState(null)
  const [ordina, setOrdina] = useState('importo')

  const carica = React.useCallback(() => {
    setBusy(true); setErr(null)
    Promise.all([
      scadenzarioApi.elenco(),
      scadenzarioApi.piani(),
      scadenzarioApi.rate(),
      scadenzarioApi.riconciliazione(),
      scadenzarioApi.riconciliazioneTotali(),
      scadenzarioApi.codaFoglio(),
    ])
      .then(([e, p, r, rc, rt, cd]) => { setRighe(e); setPiani(p); setRate(r); setRicon(rc); setRiconTot(rt); setCoda(cd) })
      .catch(e => setErr(e.message || String(e)))
      .finally(() => setBusy(false))
  }, [])
  useEffect(carica, [carica])

  const filtrate = useMemo(() => {
    let r = righe
    if (sede !== 'Tutte') r = r.filter(x => (x.sede || 'Da assegnare') === sede)
    if (vista === 'fatture') r = r.filter(x => x.origine === 'fattura')
    if (vista === 'costi')   r = r.filter(x => x.origine === 'costo_fisso')
    if (vista === 'ratei')   r = r.filter(x => x.origine === 'rateale')
    if (fascia) r = r.filter(x => x.origine === 'fattura' && fasciaDi(x.giorni_anzianita).id === fascia)
    return r
  }, [righe, sede, vista, fascia])

  const kpi = useMemo(() => {
    const f  = filtrate.filter(x => x.origine === 'fattura')
    const cf = filtrate.filter(x => x.origine === 'costo_fisso')
    const rt = filtrate.filter(x => x.origine === 'rateale')
    const somma = a => a.reduce((s, x) => s + (parseFloat(x.importo) || 0), 0)
    const vecchie = f.filter(x => x.giorni_anzianita > 60)
    return {
      totale: somma(filtrate), fatture: somma(f), costi: somma(cf), ratei: somma(rt),
      vecchie: somma(vecchie), nVecchie: vecchie.length,
      nFatture: f.length, nCosti: cf.length, nRatei: rt.length,
    }
  }, [filtrate])

  // Anzianità delle sole fatture: è la parte su cui si decide chi pagare prima
  const perFascia = useMemo(() => {
    const f = righe.filter(x => x.origine === 'fattura'
      && (sede === 'Tutte' || (x.sede || 'Da assegnare') === sede))
    return FASCE.map(fa => {
      const dentro = f.filter(x => fasciaDi(x.giorni_anzianita).id === fa.id)
      return { ...fa, n: dentro.length, importo: dentro.reduce((s, x) => s + (parseFloat(x.importo) || 0), 0) }
    })
  }, [righe, sede])

  // Costi fissi già pianificati, mese per mese
  const perMese = useMemo(() => {
    const m = {}
    for (const x of righe) {
      if (x.origine !== 'costo_fisso') continue
      if (sede !== 'Tutte' && (x.sede || 'Da assegnare') !== sede) continue
      const k = String(x.scadenza).slice(0, 7)
      m[k] = (m[k] || 0) + (parseFloat(x.importo) || 0)
    }
    return Object.entries(m).sort().map(([k, v]) => ({ mese: k, label: meseLabel(k), importo: v }))
  }, [righe, sede])

  // Chi aspetta di più: fornitori ordinati per esposizione
  const perFornitore = useMemo(() => {
    const m = {}
    for (const x of filtrate) {
      if (x.origine !== 'fattura') continue
      const k = x.descrizione
      const a = m[k] ||= { nome: k, importo: 0, n: 0, piuVecchia: 0 }
      a.importo += parseFloat(x.importo) || 0
      a.n += 1
      a.piuVecchia = Math.max(a.piuVecchia, x.giorni_anzianita || 0)
    }
    return Object.values(m).sort((a, b) => b.importo - a.importo)
  }, [filtrate])

  // Piani di rateizzazione, filtrati per sede come tutto il resto
  const pianiVisti = useMemo(
    () => piani.filter(p => sede === 'Tutte' || p.sede === sede),
    [piani, sede])

  const pianiAttivi = useMemo(() => pianiVisti.filter(p => !p.chiuso), [pianiVisti])
  const inCoda = useMemo(() => coda.filter(c => c.stato === 'DA_APPLICARE'), [coda])

  const rateiTot = useMemo(() => {
    const n = a => a.reduce((s, x) => s + (parseFloat(x) || 0), 0)
    const attivi = pianiVisti.filter(p => !p.chiuso)
    return {
      residuoDatato:  n(attivi.map(p => p.residuo_datato)),
      residuoStimato: n(attivi.map(p => p.residuo_stimato_non_datato)),
      giaVersato:     n(pianiVisti.map(p => p.gia_versato)),
      rateSenzaData:  attivi.reduce((s, p) => s + (p.rate_senza_data || 0), 0),
    }
  }, [pianiVisti])

  // Le prossime rate con data certa, in ordine di scadenza
  const prossimeRate = useMemo(
    () => righe.filter(x => x.origine === 'rateale'
        && (sede === 'Tutte' || x.sede === sede))
      .sort((a, b) => String(a.scadenza).localeCompare(String(b.scadenza))),
    [righe, sede])

  const ESITI = {
    pagata_solo_su_excel: { label: 'Pagata sul foglio, aperta nel CRM', col: '#fbbf24' },
    saldata_solo_su_crm:  { label: 'Saldata nel CRM, vuota sul foglio', col: '#60a5fa' },
    importo_difforme:     { label: 'Importo pagato diverso dal dovuto', col: '#f87171' },
    non_agganciata:       { label: 'Riga di foglio senza fattura elettronica', col: '#a78bfa' },
    fuori_sdi:            { label: 'Fuori dal ciclo SdI (affitti, ratei, banca, estero)', col: '#94a3b8' },
    allineata:            { label: 'Allineata', col: '#34d399' },
  }
  const riconVisti = useMemo(
    () => ricon.filter(r => (sede === 'Tutte' || r.sede === sede)
      && r.esito !== 'fuori_sdi' && r.esito !== 'non_agganciata'),
    [ricon, sede])

  const elenco = useMemo(() => {
    const r = [...filtrate]
    if (ordina === 'importo')   r.sort((a, b) => Math.abs(b.importo) - Math.abs(a.importo))
    if (ordina === 'anzianita') r.sort((a, b) => b.giorni_anzianita - a.giorni_anzianita)
    if (ordina === 'scadenza')  r.sort((a, b) => String(a.scadenza).localeCompare(String(b.scadenza)))
    return r
  }, [filtrate, ordina])

  if (busy && !righe.length) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-gray-400 flex items-center gap-3"><RefreshCw size={18} className="animate-spin" /> Carico lo scadenzario…</div>
      </div>
    )
  }

  const Bottone = ({ attivo, onClick, children }) => (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
        attivo ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
      {children}
    </button>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="p-6 space-y-6 max-w-[1400px] mx-auto">

        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <CalendarClock size={24} className="text-blue-400" /> Scadenzario
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Fatture fornitore ancora aperte e costi fissi gia' pianificati
            </p>
          </div>
          <button onClick={carica}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Ricarica
          </button>
        </div>

        {err && (
          <div className="bg-rose-900/20 border border-rose-700/50 rounded-lg px-4 py-3 text-sm text-rose-200">{err}</div>
        )}

        {inCoda.length > 0 && (
          <div className="bg-blue-900/20 border border-blue-700/50 rounded-xl px-5 py-4">
            <p className="text-sm font-semibold text-blue-200 flex items-center gap-2 mb-1">
              <FileSpreadsheet size={15} /> {inCoda.length} {inCoda.length === 1 ? 'cella aspetta' : 'celle aspettano'} di essere scritte nei file Excel
            </p>
            <p className="text-[13px] text-blue-100/80 leading-relaxed">
              Le modifiche fatte qui valgono gia' sul CRM. Per portarle anche dentro Mameli26.xlsx e
              Predda_Niedda26.xlsx serve un doppio clic su <span className="font-mono">APPLICA_AL_FOGLIO.bat</span>,
              nella cartella CRM-App sul PC dell'amministrazione. Finche' non lo si lancia, su quelle celle il
              foglio dice ancora la cosa vecchia.
            </p>
          </div>
        )}

        {/* L'avvertimento sui termini di pagamento */}
        <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl px-5 py-4">
          <p className="text-sm font-semibold text-amber-200 flex items-center gap-2 mb-2">
            <Info size={15} /> Come leggere le date
          </p>
          <p className="text-[13px] text-amber-100/90 leading-relaxed">
            <strong>I termini di pagamento delle fatture non sono a sistema.</strong> Non stanno nei fogli
            dell'amministrazione, e il campo scadenza delle fatture e' compilato solo su quelle gia' saldate,
            dove per di piu' contiene la data in cui si e' pagato, non quella entro cui si doveva pagare.
            Percio' per le fatture aperte qui si ragiona per <strong>anzianita' dalla data della fattura</strong>:
            una fattura di 75 giorni e' vecchia di 75 giorni, non necessariamente scaduta da 45.
            I <strong>costi fissi</strong> invece sono pianificati fino a dicembre e quelle sono previsioni vere.
            Le vere scadenze si possono recuperare: stanno dentro gli XML delle fatture archiviate in FATTURE/,
            nel campo DataScadenzaPagamento. Quando le estraiamo, questa pagina diventa esatta da sola.
          </p>
        </div>

        {/* Filtri */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 mr-1">Sede</span>
          {['Tutte', 'MA', 'PN', 'Da assegnare'].map(s => (
            <Bottone key={s} attivo={sede === s} onClick={() => setSede(s)}>
              {s === 'MA' ? 'Mameli' : s === 'PN' ? 'Predda Niedda' : s}
            </Bottone>
          ))}
          <span className="text-xs text-gray-500 mx-1 ml-4">Mostra</span>
          <Bottone attivo={vista === 'tutto'}   onClick={() => { setVista('tutto'); setFascia(null) }}>Tutto</Bottone>
          <Bottone attivo={vista === 'fatture'} onClick={() => setVista('fatture')}>Solo fatture</Bottone>
          <Bottone attivo={vista === 'costi'}   onClick={() => { setVista('costi'); setFascia(null) }}>Solo costi fissi</Bottone>
          <Bottone attivo={vista === 'ratei'}   onClick={() => { setVista('ratei'); setFascia(null) }}>Solo rate</Bottone>
          {fascia && (
            <button onClick={() => setFascia(null)}
              className="ml-2 text-xs px-2 py-1 rounded bg-blue-900/40 text-blue-300 border border-blue-700">
              fascia {FASCE.find(f => f.id === fascia)?.label} · togli filtro ✕
            </button>
          )}
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <Kpi label="Totale da pagare" value={eur0(kpi.totale)} tone="blue" icon={Wallet}
               sub={`${filtrate.length} voci`} />
          <Kpi label="Fatture fornitore" value={eur0(kpi.fatture)} tone="purple" icon={Building2}
               sub={`${kpi.nFatture} documenti ancora aperti`} />
          <Kpi label="Costi fissi previsti" value={eur0(kpi.costi)} tone="slate" icon={CalendarClock}
               sub={`${kpi.nCosti} voci pianificate`} />
          <Kpi label="Rate con data certa" value={eur0(kpi.ratei)} tone="amber" icon={Landmark}
               sub={`${kpi.nRatei} rate gia' calendarizzate`} />
          <Kpi label="Fatture oltre 60 giorni" value={eur0(kpi.vecchie)}
               tone={kpi.vecchie > 0 ? 'rose' : 'slate'} icon={AlertTriangle}
               sub={`${kpi.nVecchie} documenti`} />
        </div>

        {/* Anzianità */}
        <Sezione titolo="Anzianita' delle fatture aperte" icona={Clock}
                 sottotitolo="clicca una fascia per filtrare l'elenco in fondo">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {perFascia.map(f => (
              <button key={f.id} onClick={() => { setVista('fatture'); setFascia(fascia === f.id ? null : f.id) }}
                className={`text-left bg-gray-900/50 rounded-lg p-4 border transition hover:bg-gray-900/80 ${
                  fascia === f.id ? 'border-blue-500' : 'border-gray-700'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: f.col }} />
                  <p className="text-sm font-semibold text-white">{f.label}</p>
                </div>
                <p className="text-2xl font-bold text-white tabular-nums">{eur0(f.importo)}</p>
                <p className="text-xs text-gray-400 mt-1">{f.n} fatture</p>
              </button>
            ))}
          </div>
        </Sezione>

        {/* Costi fissi per mese */}
        {perMese.length > 0 && (
          <Sezione titolo="Costi fissi gia' pianificati" icona={TrendingUp}
                   sottotitolo={`da ${meseLabel(perMese[0].mese)} a ${meseLabel(perMese[perMese.length-1].mese)}`}>
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={perMese} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="label" stroke="#9ca3af" fontSize={12} />
                  <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={v => `${Math.round(v/1000)}k`} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                           formatter={v => [eur(v), 'Costi fissi']} />
                  <Bar dataKey="importo" radius={[4,4,0,0]}>
                    {perMese.map((m, i) => (
                      <Cell key={i} fill={m.mese === String(new Date().toISOString()).slice(0,7) ? '#3b82f6' : '#64748b'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Sezione>
        )}

        {/* RATEI — sintesi; il dettaglio sta nella pagina dedicata */}
        {pianiVisti.length > 0 && (
          <Sezione titolo="Ratei e piani di rateizzazione" icona={Landmark}
                   sottotitolo={`${pianiAttivi.length} piani attivi · ${eur0(rateiTot.residuoDatato)} a calendario`}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
                <p className="text-xs text-gray-400">Rate future con data certa</p>
                <p className="text-2xl font-bold text-white tabular-nums mt-1">{eur(rateiTot.residuoDatato)}</p>
                <p className="text-[11px] text-gray-500 mt-1">{prossimeRate.length} rate scritte a calendario sul foglio</p>
              </div>
              <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
                <p className="text-xs text-gray-400">Rate previste ma senza data</p>
                <p className="text-2xl font-bold text-amber-300 tabular-nums mt-1">
                  {rateiTot.residuoStimato ? '≈ ' + eur(rateiTot.residuoStimato) : '—'}
                </p>
                <p className="text-[11px] text-gray-500 mt-1">
                  {rateiTot.rateSenzaData} rate elencate sul piano ma non ancora compilate
                </p>
              </div>
              <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
                <p className="text-xs text-gray-400">Gia' versato sui piani</p>
                <p className="text-2xl font-bold text-emerald-300 tabular-nums mt-1">{eur(rateiTot.giaVersato)}</p>
                <p className="text-[11px] text-gray-500 mt-1">somma delle rate risultate pagate</p>
              </div>
            </div>

            {prossimeRate.length > 0 && (
              <>
                <p className="text-xs font-semibold text-gray-300 mt-5 mb-2">Le prossime rate</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {prossimeRate.slice(0, 6).map(r => (
                    <div key={r.chiave} className="bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-2 flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-xs text-white truncate">{r.descrizione}</p>
                        <p className="text-[11px] text-gray-500">
                          {r.sede === 'MA' ? 'Mameli' : 'Predda Niedda'} · {dataIt(r.scadenza)}
                        </p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-white ml-3 whitespace-nowrap">{eur(r.importo)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <Link to="/rate-piani"
              className="mt-4 inline-flex items-center gap-2 text-sm text-blue-300 hover:text-blue-200">
              Apri Rate &amp; Piani — calendario, avanzamento di ogni piano, rate da datare
              <ArrowRight size={14} />
            </Link>
          </Sezione>
        )}

        {/* RICONCILIAZIONE — foglio dell'amministrazione contro fatture elettroniche */}
        <Sezione titolo="Riconciliazione col foglio dell'amministrazione" icona={GitCompareArrows}
                 sottotitolo={`${riconVisti.length} righe da guardare`}
                 apertoDefault={riconVisti.length > 0}>
          <p className="text-[13px] text-gray-400 leading-relaxed mb-4">
            Le 1.801 righe della scheda FORNITORI dei due fogli sono state agganciate una per una alle fatture
            elettroniche ricevute, confrontando numero documento, importo e data. La colonna PAGATO del foglio e'
            l'unico posto dove i pagamenti vengono registrati: quando dice pagato e il CRM dice aperta, ha ragione
            il foglio e la fattura viene chiusa. La data del pagamento non ha una colonna sua — sta dentro la nota
            accanto al mezzo, tipo <span className="font-mono text-gray-300">Unicredit 23/02/2026</span> — ed e'
            da li' che viene letta.
          </p>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mb-4">
            {riconTot.map(t => (
              <div key={t.esito} className="bg-gray-900/50 border border-gray-700 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ESITI[t.esito]?.col || '#64748b' }} />
                  <p className="text-[11px] text-gray-400 leading-tight">{ESITI[t.esito]?.label || t.esito}</p>
                </div>
                <p className="text-lg font-bold text-white tabular-nums">{t.n}</p>
                <p className="text-[11px] text-gray-500">{eur0(t.importo)}</p>
              </div>
            ))}
          </div>

          {riconVisti.length === 0 ? (
            <p className="text-sm text-emerald-300">
              Nessuno scarto: su tutte le fatture agganciate il foglio e il CRM dicono la stessa cosa.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-700">
                    <th className="py-2 pr-3">Cosa non torna</th>
                    <th className="py-2 px-3">Fornitore</th>
                    <th className="py-2 px-3">Doc.</th>
                    <th className="py-2 px-3">Data</th>
                    <th className="py-2 px-3 text-right">Foglio: dovuto</th>
                    <th className="py-2 px-3 text-right">Foglio: pagato</th>
                    <th className="py-2 pl-3">Stato CRM</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {riconVisti.map(r => (
                    <tr key={r.id} className="border-b border-gray-800/60">
                      <td className="py-2 pr-3">
                        <span className="text-[11px] px-2 py-0.5 rounded whitespace-nowrap"
                              style={{ background: (ESITI[r.esito]?.col || '#64748b') + '22',
                                       color: ESITI[r.esito]?.col || '#94a3b8' }}>
                          {ESITI[r.esito]?.label || r.esito}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-white">{r.fornitore}</td>
                      <td className="py-2 px-3 text-[11px] font-mono text-gray-500">{r.documento}</td>
                      <td className="py-2 px-3 text-xs text-gray-400 whitespace-nowrap">{dataIt(r.data_documento)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{eur(r.importo)}</td>
                      <td className="py-2 px-3 text-right tabular-nums font-semibold text-white">{eur(r.pagato)}</td>
                      <td className="py-2 pl-3 text-xs text-gray-400">{r.crm_stato || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Sezione>

        {/* Fornitori */}
        {perFornitore.length > 0 && (
          <Sezione titolo="A chi si deve di piu'" icona={Building2}
                   sottotitolo={`${perFornitore.length} fornitori con almeno una fattura aperta`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-700">
                    <th className="py-2 pr-3">Fornitore</th>
                    <th className="py-2 px-3 text-right">Documenti</th>
                    <th className="py-2 px-3 text-right">Piu' vecchia</th>
                    <th className="py-2 pl-3 text-right">Da pagare</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {perFornitore.slice(0, 20).map(f => {
                    const fa = fasciaDi(f.piuVecchia)
                    return (
                      <tr key={f.nome} className="border-b border-gray-800">
                        <td className="py-2 pr-3 text-white">{f.nome}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-gray-400">{f.n}</td>
                        <td className="py-2 px-3 text-right tabular-nums" style={{ color: fa.col }}>
                          {f.piuVecchia} gg
                        </td>
                        <td className="py-2 pl-3 text-right tabular-nums font-semibold text-white">{eur(f.importo)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {perFornitore.length > 20 && (
                <p className="text-[11px] text-gray-600 mt-2">
                  Mostrati i primi 20 su {perFornitore.length}. L'elenco completo e' qui sotto.
                </p>
              )}
            </div>
          </Sezione>
        )}

        {/* Elenco completo */}
        <Sezione titolo="Elenco completo" icona={CalendarClock}
                 sottotitolo={`${elenco.length} voci · ${eur(elenco.reduce((s,x)=>s+(parseFloat(x.importo)||0),0))}`}>
          <div className="flex gap-2 mb-3">
            <span className="text-xs text-gray-500 self-center mr-1">Ordina per</span>
            <Bottone attivo={ordina === 'importo'}   onClick={() => setOrdina('importo')}>Importo</Bottone>
            <Bottone attivo={ordina === 'anzianita'} onClick={() => setOrdina('anzianita')}>Anzianita'</Bottone>
            <Bottone attivo={ordina === 'scadenza'}  onClick={() => setOrdina('scadenza')}>Data</Bottone>
          </div>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-800">
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-700">
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 px-3">Descrizione</th>
                  <th className="py-2 px-3">Riferimento</th>
                  <th className="py-2 px-3">Sede</th>
                  <th className="py-2 px-3">Data</th>
                  <th className="py-2 px-3 text-right">Anzianita'</th>
                  <th className="py-2 px-3 text-right">Importo</th>
                  <th className="py-2 pl-3 text-right w-24"></th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {elenco.map(r => {
                  const fatt = r.origine === 'fattura'
                  const fa = fasciaDi(r.giorni_anzianita)
                  if (inModifica === r.chiave) {
                    return <ModificaSaldo key={r.chiave} riga={r}
                             onChiudi={() => setInModifica(null)}
                             onSalvato={() => { setInModifica(null); carica() }} />
                  }
                  return (
                    <tr key={r.chiave} className="border-b border-gray-800/60 group">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span className={`text-[11px] px-2 py-0.5 rounded ${
                          fatt ? 'bg-purple-900/40 text-purple-300' : 'bg-slate-700/50 text-slate-300'}`}>
                          {r.tipo}
                        </span>
                      </td>
                      <td className="py-2 px-3 max-w-sm truncate text-white" title={r.descrizione}>{r.descrizione}</td>
                      <td className="py-2 px-3 text-[11px] font-mono text-gray-500 max-w-[180px] truncate"
                          title={r.riferimento || ''}>{r.riferimento || '—'}</td>
                      <td className="py-2 px-3 text-xs text-gray-400">
                        {r.sede === 'MA' ? 'Mameli' : r.sede === 'PN' ? 'Predda Niedda' : '—'}
                      </td>
                      <td className="py-2 px-3 text-xs text-gray-400 whitespace-nowrap">
                        {dataIt(r.scadenza)}
                        {!r.scadenza_certa && <span className="text-gray-600 ml-1" title="data della fattura, non la scadenza">*</span>}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-xs whitespace-nowrap"
                          style={{ color: fatt ? fa.col : '#6b7280' }}>
                        {fatt ? `${r.giorni_anzianita} gg` : (r.stato === 'PREVISTO' ? 'previsto' : '—')}
                      </td>
                      <td className={`py-2 px-3 text-right tabular-nums font-semibold whitespace-nowrap ${
                        parseFloat(r.importo) < 0 ? 'text-cyan-300' : 'text-white'}`}>
                        {eur(r.importo)}
                      </td>
                      <td className="py-2 pl-3 text-right">
                        {fatt && (
                          <button onClick={() => setInModifica(r.chiave)}
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 whitespace-nowrap">
                            <Pencil size={11} /> saldo
                          </button>
                        )}
                        {r.origine === 'rateale' && (
                          <Link to="/rate-piani"
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 whitespace-nowrap">
                            <Pencil size={11} /> rata
                          </Link>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-600 mt-3">
            * la data e' quella della fattura, non la scadenza: i termini di pagamento non sono a sistema.
            Passando col mouse su una riga compare il pulsante per segnare il saldo: aggiorna il CRM e mette in
            coda la cella PAGATO da riscrivere nel foglio.
          </p>
        </Sezione>

        <p className="text-[11px] text-gray-600 pb-6">
          Fonti: fatture con stato APERTA o PARZIALE in fatture_importate (i doppioni sono esclusi, le note di
          credito compaiono in negativo perche' riducono l'esposizione); costi fissi pianificati dal mese corrente
          in avanti; rate dei piani di rateizzazione dalla scheda RATEALI dei fogli Mameli26.xlsx e
          Predda_Niedda26.xlsx. Le voci "Ratei cartelle e finanziamenti" dei costi fissi sono escluse apposta:
          erano la stima mensile degli stessi piani e sommarle conterebbe lo stesso denaro due volte.
          Gli F24 non sono qui: le deleghe future arrivano dallo studio e non sono ancora note — quelle gia'
          pagate stanno in Costi &amp; Margini → F24.
        </p>
      </div>
      <PageAssistant
        pagina="Scadenzario"
        suggerimenti={[
          "Quanto devo ai fornitori in tutto?",
          "Quali fatture sono ferme da piu' di 90 giorni?",
          "Quanto pesano i costi fissi dei prossimi tre mesi?",
          "A quale fornitore devo di piu'?",
          "Quali rate scadono nei prossimi due mesi?",
          "Ci sono fatture che il foglio da' pagate ma il CRM no?",
        ]}
      />
    </div>
  )
}
