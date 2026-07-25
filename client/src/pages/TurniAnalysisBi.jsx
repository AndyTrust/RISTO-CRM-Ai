/**
 * TurniAnalysisBi.jsx — Analisi Turni Pranzo/Cena BI
 *
 * Fonte di verità: chiusure_turni (sede, data, turno='pranzo'|'cena', incasso, quantita).
 * Copertura dati: NON è una costante — viene letta a runtime (min/max di `data`),
 * perché una data cablata nel codice smette di essere vera al primo import nuovo
 * e continua a dichiarare in UI una copertura che non esiste più.
 * Quota costi: v_be_mensile.costi_totali (somma costi del mese) ripartita pro-rata.
 *
 * TUTTE le card/tabelle/grafici si ricalcolano su periodo (from/to) e sede (MA/PN/ALL).
 * Nessun dato simulato: se mancano dati nel periodo viene mostrato un avviso.
 */
import { useState, useEffect, useMemo } from 'react'
import supabase from '../supabase'
import { fetchPagedInfo } from '../api/paged'
import { useOrdinamento, IconaOrdine, BottoneCsv, NotaCopertura } from '../lib/tabella'
import PageAssistant from '../components/PageAssistant'
import PeriodFilter from '../components/PeriodFilter'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import {
  Clock, TrendingUp, Users, DollarSign, CheckCircle,
  AlertCircle, Info, ArrowDownRight
} from 'lucide-react'

const SEDE_OPTIONS = [
  { value: 'MA',  label: 'Mameli (CA)' },
  { value: 'PN',  label: 'Predda Niedda (SS)' },
  { value: 'ALL', label: 'Entrambe' },
]
const SEDE_LABEL = { MA: 'Mameli', PN: 'Predda Niedda' }
const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

const eur = n => (Number(n) || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const eur2 = n => (Number(n) || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = n => (Number(n) || 0).toLocaleString('it-IT')

/**
 * Data locale in formato YYYY-MM-DD.
 * `toISOString()` converte in UTC: in Italia (UTC+1/+2) la mezzanotte locale
 * diventa le 22:00/23:00 del giorno PRECEDENTE, quindi "oggi" e "primo del mese"
 * scivolavano indietro di un giorno e il periodo di default era sbagliato.
 */
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** YYYY-MM-DD → GG/MM/AAAA, con segnaposto esplicito quando la data non c'è. */
const itDate = s => (s ? s.split('-').reverse().join('/') : '—')

// Giorni effettivi nell'intervallo [from, to] inclusi
function daysInRange(from, to) {
  if (!from || !to) return 0
  const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00')
  return Math.max(0, Math.round((b - a) / 86400000) + 1)
}

// Elenco YYYY-MM toccati dall'intervallo + giorni del periodo che cadono in ciascun mese
function monthsInRange(from, to) {
  const res = {}
  if (!from || !to) return res
  let d = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  while (d <= end) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    res[key] = (res[key] || 0) + 1
    d.setDate(d.getDate() + 1)
  }
  return res // { '2026-06': 4, ... } = giorni del PERIODO in quel mese
}
// Giorni totali del mese di calendario (per il pro-rata dei costi mensili)
function giorniDelMese(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = 'orange' }) {
  const colors = {
    orange: 'bg-orange-50 text-orange-600 border-orange-100',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={18} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs mt-1 opacity-70">{sub}</div>}
    </div>
  )
}

// Tooltip con spiegazione formula/fonte
function InfoTip({ text }) {
  return (
    <span className="group relative inline-flex items-center align-middle ml-1">
      <Info size={13} className="text-gray-400 cursor-help" />
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1 w-64 bg-gray-900 text-white text-[11px] leading-snug rounded-lg p-2 opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-lg">
        {text}
      </span>
    </span>
  )
}

function Empty({ msg }) {
  return (
    <div className="flex flex-col items-center justify-center h-40 text-gray-400">
      <Clock size={32} className="mb-2 opacity-40" />
      <p className="text-sm text-center">{msg}</p>
    </div>
  )
}

export default function TurniAnalysisBi() {
  const today = new Date()
  const firstOfMonth = ymd(new Date(today.getFullYear(), today.getMonth(), 1))
  const todayStr = ymd(today)

  const [sede, setSede] = useState('MA')
  const [period, setPeriod] = useState('month')
  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo] = useState(todayStr)
  const handlePeriodChange = (pid, d) => { setPeriod(pid); if (d?.from) setDateFrom(d.from); if (d?.to) setDateTo(d.to) }

  const [turni, setTurni] = useState([])      // chiusure_turni (sorgente di verità)
  const [beRows, setBeRows] = useState([])     // v_be_mensile (costi mensili)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [troncato, setTroncato] = useState(false)
  const [limiteRighe, setLimiteRighe] = useState(200)
  // Copertura REALE di chiusure_turni (min/max di `data`), letta a runtime.
  const [copertura, setCopertura] = useState({ da: null, a: null })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Due letture da 1 riga: è l'equivalente di min()/max() senza RPC dedicata.
      const [minRes, maxRes] = await Promise.all([
        supabase.from('chiusure_turni').select('data').order('data', { ascending: true }).limit(1),
        supabase.from('chiusure_turni').select('data').order('data', { ascending: false }).limit(1),
      ])
      if (cancelled) return
      // Senza leggere `error` un blocco RLS sarebbe indistinguibile da "tabella
      // vuota" e la pagina dichiarerebbe una copertura inesistente.
      const err = minRes.error || maxRes.error
      if (err) { setError(prev => prev || `copertura chiusure_turni: ${err.message}`); return }
      setCopertura({ da: minRes.data?.[0]?.data ?? null, a: maxRes.data?.[0]?.data ?? null })
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        // chiusure_turni filtrate per periodo + sede.
        // Lettura PAGINATA: `.range(0, 9999)` non alzava nulla (db-max-rows=1000
        // è un tetto server) e su 3.123 righe la pagina mostrava solo le prime
        // 1000 — cioè i mesi più vecchi — senza segnalarlo.
        const { righe, troncato: tr } = await fetchPagedInfo(
          () => {
            let q = supabase.from('chiusure_turni')
              .select('id, sede, data, turno, incasso, quantita')
              .gte('data', dateFrom).lte('data', dateTo)
              // Solo pranzo/cena: senza questo filtro qualsiasi altro turno
              // (null, aperitivo, ...) veniva conteggiato come "pranzo".
              .in('turno', ['pranzo', 'cena'])
            if (sede !== 'ALL') q = q.eq('sede', sede)
            return q
          },
          'id' // colonna univoca: con `data` (duplicata) le pagine si sovrappongono
        )

        // v_be_mensile per i mesi toccati dal periodo (per quota costi).
        // Volume trascurabile (2 sedi × 12 mesi per anno): resta non paginata,
        // ma l'errore va comunque letto.
        const monthsKeys = Object.keys(monthsInRange(dateFrom, dateTo))
        const annoMin = monthsKeys.length ? Number(monthsKeys[0].slice(0, 4)) : today.getFullYear()
        const annoMax = monthsKeys.length ? Number(monthsKeys[monthsKeys.length - 1].slice(0, 4)) : today.getFullYear()
        let qb = supabase.from('v_be_mensile')
          .select('sede, anno, mese, costi_totali')
          .gte('anno', annoMin).lte('anno', annoMax)
        if (sede !== 'ALL') qb = qb.eq('sede', sede)
        const { data: bRows, error: bErr } = await qb
        if (bErr) throw bErr

        if (!cancelled) {
          // Ordine cronologico applicato in memoria: la paginazione ordina per id.
          setTurni([...righe].sort((a, b) => String(a.data).localeCompare(String(b.data))))
          setTroncato(tr)
          setBeRows(bRows || [])
          setLimiteRighe(200)
        }
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [sede, dateFrom, dateTo])

  // Avviso copertura: il periodo richiesto eccede la copertura reale di chiusure_turni
  const copAvviso = copertura.a && dateTo > copertura.a
    ? `I dati turni coprono fino al ${itDate(copertura.a)}. I giorni successivi non sono ancora disponibili.`
    : null

  // ── Aggregati per turno (sul periodo+sede selezionati) ──────────────────────
  const agg = useMemo(() => {
    const base = { incasso: 0, coperti: 0, nTurni: 0 }
    const out = { pranzo: { ...base }, cena: { ...base } }
    for (const r of turni) {
      const t = r.turno === 'cena' ? 'cena' : r.turno === 'pranzo' ? 'pranzo' : null
      if (!t) continue // difesa in profondità: mai contare turni ignoti come pranzo
      out[t].incasso += Number(r.incasso) || 0
      out[t].coperti += Number(r.quantita) || 0
      out[t].nTurni += 1
    }
    for (const t of ['pranzo', 'cena']) {
      const o = out[t]
      o.incassoMedio = o.nTurni > 0 ? o.incasso / o.nTurni : 0
      o.copertiMedi = o.nTurni > 0 ? o.coperti / o.nTurni : 0
      o.scontrinoMedio = o.coperti > 0 ? o.incasso / o.coperti : 0 // = coperto medio €
    }
    const totIncasso = out.pranzo.incasso + out.cena.incasso
    out.pctPranzo = totIncasso > 0 ? (out.pranzo.incasso / totIncasso) * 100 : 0
    out.pctCena = totIncasso > 0 ? (out.cena.incasso / totIncasso) * 100 : 0
    out.totIncasso = totIncasso
    out.totCoperti = out.pranzo.coperti + out.cena.coperti
    return out
  }, [turni])

  // ── Quota costi mensili coperta da ciascun turno (pro-rata) ─────────────────
  // Formula: costi_periodo = Σ_mesi ( costi_totali_mese × giorni_periodo_nel_mese / giorni_calendario_mese ).
  // Quota turno = incasso_turno / costi_periodo × 100. Per sede=ALL si sommano MA+PN.
  const costiPeriodo = useMemo(() => {
    const mesi = monthsInRange(dateFrom, dateTo) // { 'YYYY-MM': giorni_periodo }
    let tot = 0
    let mancanti = false
    for (const [mk, giorniPeriodo] of Object.entries(mesi)) {
      const [y, m] = mk.split('-').map(Number)
      const sedi = sede === 'ALL' ? ['MA', 'PN'] : [sede]
      for (const s of sedi) {
        const row = beRows.find(b => b.sede === s && b.anno === y && b.mese === m)
        if (!row) { mancanti = true; continue }
        const costiMese = Number(row.costi_totali) || 0
        tot += costiMese * (giorniPeriodo / giorniDelMese(mk))
      }
    }
    return { tot, mancanti }
  }, [beRows, dateFrom, dateTo, sede])

  const quotaPranzo = costiPeriodo.tot > 0 ? (agg.pranzo.incasso / costiPeriodo.tot) * 100 : null
  const quotaCena = costiPeriodo.tot > 0 ? (agg.cena.incasso / costiPeriodo.tot) * 100 : null

  // ── Trend per giorno della settimana × turno ────────────────────────────────
  const giorniData = useMemo(() => {
    const g = GIORNI.map(giorno => ({ giorno, pranzo: 0, cena: 0, nP: 0, nC: 0 }))
    for (const r of turni) {
      const dow = new Date(r.data + 'T00:00:00').getDay()
      const idx = dow === 0 ? 6 : dow - 1
      if (r.turno === 'cena') { g[idx].cena += Number(r.incasso) || 0; g[idx].nC++ }
      else { g[idx].pranzo += Number(r.incasso) || 0; g[idx].nP++ }
    }
    // media incasso per occorrenza (così il confronto non dipende dal n. di settimane)
    return g.map(x => ({
      ...x,
      pranzoMedio: x.nP > 0 ? x.pranzo / x.nP : 0,
      cenaMedio: x.nC > 0 ? x.cena / x.nC : 0,
    }))
  }, [turni])

  // ── Giorni in cui pranzo/cena sotto-performa vs la propria media ────────────
  // Lista operativa: per ogni giornata, incasso turno vs incasso medio di quel turno nel periodo.
  const sottoPerf = useMemo(() => {
    const out = []
    const mediaPranzo = agg.pranzo.incassoMedio
    const mediaCena = agg.cena.incassoMedio
    for (const r of turni) {
      const isCena = r.turno === 'cena'
      const media = isCena ? mediaCena : mediaPranzo
      const inc = Number(r.incasso) || 0
      if (media <= 0) continue
      const deltaPct = ((inc - media) / media) * 100
      if (deltaPct < -20) { // sotto-performance > 20% rispetto alla media del turno
        out.push({
          id: r.id, data: r.data, sede: r.sede, turno: r.turno,
          incasso: inc, media, deltaPct,
        })
      }
    }
    return out.sort((a, b) => a.deltaPct - b.deltaPct).slice(0, 20)
  }, [turni, agg])

  // ── Tabella dettaglio ───────────────────────────────────────────────────────
  // Il coperto medio è precalcolato per riga: così è ordinabile e finisce nel CSV
  // con lo stesso valore che si legge a schermo.
  const righeDettaglio = useMemo(() => turni.map(r => {
    const cop = Number(r.quantita) || 0
    const inc = Number(r.incasso) || 0
    return {
      ...r,
      incasso: inc,
      coperti: cop || null,
      copertoMedio: cop > 0 ? inc / cop : null,
    }
  }), [turni])

  const { righeOrdinate, colonna, direzione, propsTh } = useOrdinamento(righeDettaglio, 'data', 'desc')
  const righeVisibili = righeOrdinate.slice(0, limiteRighe)

  const COLONNE_CSV_DETTAGLIO = [
    { chiave: 'data', etichetta: 'Data' },
    { chiave: 'sede', etichetta: 'Sede' },
    { chiave: 'turno', etichetta: 'Turno' },
    { chiave: 'incasso', etichetta: 'Incasso' },
    { chiave: 'coperti', etichetta: 'Coperti' },
    { chiave: 'copertoMedio', etichetta: 'Coperto medio', valore: r => (r.copertoMedio != null ? Math.round(r.copertoMedio * 100) / 100 : null) },
  ]

  const COLONNE_CSV_SOTTOPERF = [
    { chiave: 'data', etichetta: 'Data' },
    { chiave: 'sede', etichetta: 'Sede' },
    { chiave: 'turno', etichetta: 'Turno' },
    { chiave: 'incasso', etichetta: 'Incasso' },
    { chiave: 'media', etichetta: 'Media turno', valore: r => Math.round(r.media * 100) / 100 },
    { chiave: 'deltaPct', etichetta: 'Scostamento %', valore: r => Math.round(r.deltaPct * 10) / 10 },
  ]

  const giorniPeriodo = daysInRange(dateFrom, dateTo)

  const systemContext = useMemo(() => `Pagina: Turni Pranzo/Cena BI
Sede: ${sede === 'ALL' ? 'Entrambe (MA+PN)' : SEDE_LABEL[sede]}
Periodo: ${dateFrom} → ${dateTo}
Copertura dati: chiusure_turni da ${copertura.da || 'n/d'} a ${copertura.a || 'n/d'}
Righe lette nel periodo: ${turni.length}${troncato ? ' (TRONCATE: i numeri qui sotto sono parziali)' : ''}
KPI:
- Incasso pranzo: ${eur(agg.pranzo.incasso)} (${agg.pctPranzo.toFixed(1)}% del totale, ${agg.pranzo.nTurni} turni)
- Incasso cena: ${eur(agg.cena.incasso)} (${agg.pctCena.toFixed(1)}% del totale, ${agg.cena.nTurni} turni)
- Coperto medio pranzo: ${eur2(agg.pranzo.scontrinoMedio)} · cena: ${eur2(agg.cena.scontrinoMedio)}
- Costi del periodo (pro-rata v_be_mensile): ${costiPeriodo.tot > 0 ? eur(costiPeriodo.tot) : 'n/d'}
- Quota costi coperta: pranzo ${quotaPranzo != null ? quotaPranzo.toFixed(1) + '%' : 'n/d'} · cena ${quotaCena != null ? quotaCena.toFixed(1) + '%' : 'n/d'}`,
    [sede, dateFrom, dateTo, agg, quotaPranzo, quotaCena, costiPeriodo, copertura, turni.length, troncato])

  const noData = !loading && turni.length === 0

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Clock className="text-blue-600" size={26} />
          Turni Pranzo/Cena BI
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Incasso, coperti, coperto medio e quota costi per turno.{' '}
          <span className="text-gray-400">
            Fonte: <b>chiusure_turni</b> (split reale pranzo/cena dalle chiusure iPratico).{' '}
            {copertura.da || copertura.a
              ? <>Copertura dati: {itDate(copertura.da)} → {itDate(copertura.a)}.</>
              : <>Copertura dati in lettura…</>}
          </span>
        </p>
      </div>

      {/* FILTRI */}
      <div className="mb-6">
        <PeriodFilter period={period} dates={{ from: dateFrom, to: dateTo }} onChange={handlePeriodChange}
          extra={
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Sede</label>
              <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={sede} onChange={e => setSede(e.target.value)}>
                {SEDE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          } />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> Errore nel caricamento dati: {error}
        </div>
      )}
      {copAvviso && !error && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 mb-6 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {copAvviso}
        </div>
      )}

      {/* INSIGHT */}
      {!loading && !noData && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 text-sm text-blue-900 space-y-1">
          <div className="font-semibold flex items-center gap-1"><TrendingUp size={14} /> Analisi del periodo — {sede === 'ALL' ? 'MA + PN' : SEDE_LABEL[sede]}</div>
          <p>
            Il <b>{agg.pranzo.incasso >= agg.cena.incasso ? 'pranzo' : 'cena'}</b> genera la quota maggiore di incasso
            {' '}({eur(Math.max(agg.pranzo.incasso, agg.cena.incasso))} su {eur(agg.totIncasso)} totali).
            {' '}Split: pranzo {agg.pctPranzo.toFixed(1)}% · cena {agg.pctCena.toFixed(1)}%.
          </p>
          <p>
            Coperto medio: pranzo {eur2(agg.pranzo.scontrinoMedio)} · cena {eur2(agg.cena.scontrinoMedio)}.
            {' '}Più alto a <b>{agg.cena.scontrinoMedio >= agg.pranzo.scontrinoMedio ? 'cena' : 'pranzo'}</b>.
          </p>
        </div>
      )}

      {/* KPI per turno (pranzo vs cena affiancati) */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-xl border p-4 h-24 animate-pulse" />)}
        </div>
      ) : noData ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <Empty msg={`Dati non disponibili per il periodo selezionato.${
            copertura.da || copertura.a ? ` chiusure_turni copre ${itDate(copertura.da)} → ${itDate(copertura.a)}.` : ''
          }`} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="space-y-3">
            <div className="text-sm font-semibold text-orange-600 flex items-center gap-1 px-1">
              <Clock size={14} /> PRANZO
              <span className="text-xs font-normal text-gray-400">({agg.pranzo.nTurni} turni)</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <KpiCard icon={DollarSign} label="Incasso totale" color="orange" value={eur(agg.pranzo.incasso)}
                sub={`${agg.pctPranzo.toFixed(1)}% del totale`} />
              <KpiCard icon={Users} label="Coperti" color="orange" value={num(agg.pranzo.coperti)}
                sub={`${Math.round(agg.pranzo.copertiMedi)} medi/turno`} />
              <KpiCard icon={TrendingUp} label="Coperto medio" color="orange" value={eur2(agg.pranzo.scontrinoMedio)}
                sub="incasso / coperti" />
              <KpiCard icon={DollarSign} label="Incasso medio" color="orange" value={eur(agg.pranzo.incassoMedio)}
                sub="per turno" />
            </div>
          </div>
          <div className="space-y-3">
            <div className="text-sm font-semibold text-indigo-600 flex items-center gap-1 px-1">
              <Clock size={14} /> CENA
              <span className="text-xs font-normal text-gray-400">({agg.cena.nTurni} turni)</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <KpiCard icon={DollarSign} label="Incasso totale" color="indigo" value={eur(agg.cena.incasso)}
                sub={`${agg.pctCena.toFixed(1)}% del totale`} />
              <KpiCard icon={Users} label="Coperti" color="indigo" value={num(agg.cena.coperti)}
                sub={`${Math.round(agg.cena.copertiMedi)} medi/turno`} />
              <KpiCard icon={TrendingUp} label="Coperto medio" color="indigo" value={eur2(agg.cena.scontrinoMedio)}
                sub="incasso / coperti" />
              <KpiCard icon={DollarSign} label="Incasso medio" color="indigo" value={eur(agg.cena.incassoMedio)}
                sub="per turno" />
            </div>
          </div>
        </div>
      )}

      {/* QUOTA COSTI MENSILI PER TURNO */}
      {!loading && !noData && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
            <DollarSign size={16} className="text-blue-500" /> Quota costi mensili coperta da ciascun turno
            <InfoTip text="Costi totali del periodo = somma, per ogni mese toccato, di costi_totali (v_be_mensile) × giorni del periodo in quel mese / giorni di calendario del mese. Quota turno = incasso turno / costi del periodo. Attenzione: è la copertura dei COSTI totali del mese, non un break-even per coperto." />
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            Fonte costi: v_be_mensile (somma costi mensili — personale + fatture + costi fissi). Periodo: {dateFrom} → {dateTo} ({giorniPeriodo} giorni).
          </p>
          {costiPeriodo.tot <= 0 ? (
            <Empty msg="Dati costi non disponibili in v_be_mensile per il periodo/sede selezionati." />
          ) : (
            <>
              {costiPeriodo.mancanti && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded p-2 mb-3">
                  Alcuni mesi del periodo non hanno costi in v_be_mensile: la quota può essere sovrastimata.
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-gray-100 p-4 bg-gray-50">
                  <div className="text-xs text-gray-500 uppercase">Costi del periodo (pro-rata)</div>
                  <div className="text-2xl font-bold text-gray-800 mt-1">{eur(costiPeriodo.tot)}</div>
                </div>
                <div className="rounded-xl border border-orange-100 p-4 bg-orange-50">
                  <div className="text-xs text-orange-600 uppercase">Pranzo copre</div>
                  <div className="text-2xl font-bold text-orange-700 mt-1">{quotaPranzo != null ? `${quotaPranzo.toFixed(1)}%` : '—'}</div>
                  <div className="text-xs text-orange-500 mt-1">{eur(agg.pranzo.incasso)} di incasso</div>
                </div>
                <div className="rounded-xl border border-indigo-100 p-4 bg-indigo-50">
                  <div className="text-xs text-indigo-600 uppercase">Cena copre</div>
                  <div className="text-2xl font-bold text-indigo-700 mt-1">{quotaCena != null ? `${quotaCena.toFixed(1)}%` : '—'}</div>
                  <div className="text-xs text-indigo-500 mt-1">{eur(agg.cena.incasso)} di incasso</div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TREND PER GIORNO SETTIMANA */}
      {!loading && !noData && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
            <Users size={16} className="text-blue-500" /> Incasso medio per giorno della settimana × turno
            <InfoTip text="Per ogni giorno della settimana: incasso medio del turno = somma incassi del turno in quel giorno / numero di occorrenze nel periodo. Fonte: chiusure_turni." />
          </h2>
          <p className="text-xs text-gray-400 mb-4">Media per occorrenza (indipendente dal numero di settimane nel periodo).</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={giorniData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="giorno" fontSize={11} />
              <YAxis fontSize={11} tickFormatter={v => `€${(v / 1000).toFixed(1)}k`} />
              <Tooltip formatter={v => eur(v)} />
              <Legend />
              <Bar dataKey="pranzoMedio" name="Pranzo (medio)" fill="#f97316" radius={[2, 2, 0, 0]} opacity={0.85} />
              <Bar dataKey="cenaMedio" name="Cena (medio)" fill="#6366f1" radius={[2, 2, 0, 0]} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* GIORNI SOTTO-PERFORMANTI */}
      {!loading && !noData && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
            <ArrowDownRight size={16} className="text-red-500" /> Giornate sotto-performanti per turno
            <InfoTip text="Giornate in cui l'incasso del turno è inferiore di oltre il 20% rispetto all'incasso medio dello stesso turno nel periodo. Utile per rivedere la turnazione. Fonte: chiusure_turni." />
          </h2>
          <div className="flex items-start justify-between gap-3 mb-4">
            <p className="text-xs text-gray-400">
              Scostamento &gt; -20% vs media del turno (pranzo {eur(agg.pranzo.incassoMedio)} · cena {eur(agg.cena.incassoMedio)}).
              {' '}Mostrate le {sottoPerf.length} giornate peggiori.
            </p>
            <BottoneCsv righe={sottoPerf} colonne={COLONNE_CSV_SOTTOPERF} nomeFile={`turni_sottoperformanti_${sede}`} />
          </div>
          {sottoPerf.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Nessuna giornata sotto-performante oltre la soglia nel periodo.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                    <th className="pb-2 pr-4">Data</th>
                    {sede === 'ALL' && <th className="pb-2 pr-4">Sede</th>}
                    <th className="pb-2 pr-4">Turno</th>
                    <th className="pb-2 pr-4 text-right">Incasso</th>
                    <th className="pb-2 pr-4 text-right">Media turno</th>
                    <th className="pb-2 pr-4 text-right">Scostamento</th>
                  </tr>
                </thead>
                <tbody>
                  {/* key = id della chiusura: la lista è riordinata per scostamento,
                      con l'indice React riciclerebbe la riga sbagliata */}
                  {sottoPerf.map(r => (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 pr-4 text-gray-700 text-xs whitespace-nowrap">{new Date(r.data + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' })}</td>
                      {sede === 'ALL' && <td className="py-2 pr-4 text-xs">{r.sede}</td>}
                      <td className="py-2 pr-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${r.turno === 'pranzo' ? 'bg-orange-100 text-orange-700' : 'bg-indigo-100 text-indigo-700'}`}>{r.turno}</span>
                      </td>
                      <td className="py-2 pr-4 text-right font-semibold text-gray-800">{eur(r.incasso)}</td>
                      <td className="py-2 pr-4 text-right text-gray-500">{eur(r.media)}</td>
                      <td className="py-2 pr-4 text-right font-semibold text-red-600">{r.deltaPct.toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CONFRONTO PER SEDE (solo ALL) */}
      {!loading && !noData && sede === 'ALL' && (
        <ConfrontoSedi turni={turni} />
      )}

      {/* TABELLA DETTAGLIO */}
      {!loading && !noData && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <Clock size={16} className="text-blue-500" /> Dettaglio turni ({num(turni.length)})
            </h2>
            <BottoneCsv righe={righeOrdinate} colonne={COLONNE_CSV_DETTAGLIO}
              nomeFile={`turni_dettaglio_${sede}_${dateFrom}_${dateTo}`}
              etichetta={`CSV (${num(righeOrdinate.length)} righe)`} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                {/* Ogni colonna è ordinabile in entrambe le direzioni: i null
                    restano in coda (vedi useOrdinamento), non valgono 0 */}
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                  <th className="pb-2 pr-4" {...propsTh('data')}>Data<IconaOrdine colonna="data" colonnaAttiva={colonna} direzione={direzione} /></th>
                  <th className="pb-2 pr-4" {...propsTh('sede')}>Sede<IconaOrdine colonna="sede" colonnaAttiva={colonna} direzione={direzione} /></th>
                  <th className="pb-2 pr-4" {...propsTh('turno')}>Turno<IconaOrdine colonna="turno" colonnaAttiva={colonna} direzione={direzione} /></th>
                  <th className="pb-2 pr-4 text-right" {...propsTh('incasso')}>Incasso<IconaOrdine colonna="incasso" colonnaAttiva={colonna} direzione={direzione} /></th>
                  <th className="pb-2 pr-4 text-right" {...propsTh('coperti')}>Coperti<IconaOrdine colonna="coperti" colonnaAttiva={colonna} direzione={direzione} /></th>
                  <th className="pb-2 pr-4 text-right" {...propsTh('copertoMedio')}>Coperto medio<IconaOrdine colonna="copertoMedio" colonnaAttiva={colonna} direzione={direzione} /></th>
                </tr>
              </thead>
              <tbody>
                {/* key = id: la tabella è ordinabile, l'indice cambierebbe significato a ogni sort */}
                {righeVisibili.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-700 text-xs whitespace-nowrap">{new Date(r.data + 'T00:00:00').toLocaleDateString('it-IT')}</td>
                    <td className="py-2 pr-4 text-xs">{r.sede}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${r.turno === 'pranzo' ? 'bg-orange-100 text-orange-700' : 'bg-indigo-100 text-indigo-700'}`}>{r.turno}</span>
                    </td>
                    <td className="py-2 pr-4 text-right font-semibold text-gray-800">{eur2(r.incasso)}</td>
                    <td className="py-2 pr-4 text-right text-gray-700">{r.coperti ?? '—'}</td>
                    <td className="py-2 pr-4 text-right text-gray-600">{r.copertoMedio != null ? eur2(r.copertoMedio) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Il troncamento non è più silenzioso: si dichiara quante righe si vedono
              su quante ce ne sono, e il limite è superabile */}
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <p className="text-xs text-gray-400">
              Mostrate {num(righeVisibili.length)} righe su {num(righeOrdinate.length)}.
            </p>
            {righeVisibili.length < righeOrdinate.length && (
              <>
                <button onClick={() => setLimiteRighe(n => n + 200)}
                  className="text-xs border border-gray-300 rounded px-2 py-1 text-gray-600 hover:bg-gray-50">
                  Mostra altre 200
                </button>
                <button onClick={() => setLimiteRighe(righeOrdinate.length)}
                  className="text-xs border border-gray-300 rounded px-2 py-1 text-gray-600 hover:bg-gray-50">
                  Mostra tutte ({num(righeOrdinate.length)})
                </button>
              </>
            )}
          </div>
          <NotaCopertura righe={turni.length} da={dateFrom} a={dateTo}
            fonte="chiusure_turni" troncato={troncato} />
        </div>
      )}

      <PageAssistant pagina="turni-analysis-bi" systemContext={systemContext}
        suggerimenti={[
          'Quale turno è più profittevole nel periodo?',
          'Qual è lo split pranzo vs cena?',
          'Quale giorno della settimana rende di più a cena?',
          'In quali giornate il pranzo sotto-performa?',
        ]} />
    </div>
  )
}

// ── Confronto MA vs PN (vista globale) ───────────────────────────────────────
function ConfrontoSedi({ turni }) {
  const perSede = useMemo(() => {
    const m = { MA: { pranzo: 0, cena: 0, copP: 0, copC: 0 }, PN: { pranzo: 0, cena: 0, copP: 0, copC: 0 } }
    for (const r of turni) {
      const s = r.sede === 'PN' ? 'PN' : 'MA'
      if (r.turno === 'cena') { m[s].cena += Number(r.incasso) || 0; m[s].copC += Number(r.quantita) || 0 }
      else { m[s].pranzo += Number(r.incasso) || 0; m[s].copP += Number(r.quantita) || 0 }
    }
    return ['MA', 'PN'].map(s => ({
      sede: s, nome: SEDE_LABEL[s],
      pranzo: m[s].pranzo, cena: m[s].cena,
      tot: m[s].pranzo + m[s].cena,
      coperti: m[s].copP + m[s].copC,
    }))
  }, [turni])

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h2 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
        <CheckCircle size={16} className="text-blue-500" /> Confronto sedi — Mameli vs Predda Niedda
        <InfoTip text="Incasso pranzo e cena per sede nel periodo. Fonte: chiusure_turni." />
      </h2>
      <p className="text-xs text-gray-400 mb-4">Incasso per turno e sede nel periodo selezionato.</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={perSede}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="nome" fontSize={11} />
          <YAxis fontSize={11} tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} />
          <Tooltip formatter={v => eur(v)} />
          <Legend />
          <Bar dataKey="pranzo" name="Pranzo" fill="#f97316" radius={[2, 2, 0, 0]} opacity={0.85} />
          <Bar dataKey="cena" name="Cena" fill="#6366f1" radius={[2, 2, 0, 0]} opacity={0.85} />
        </BarChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-2 gap-4 mt-4">
        {perSede.map(s => (
          <div key={s.sede} className="rounded-xl border border-gray-100 p-4 bg-gray-50">
            <div className="font-semibold text-gray-700 text-sm">{s.nome}</div>
            <div className="text-xs text-gray-500 mt-1">Incasso totale: <b className="text-gray-800">{eur(s.tot)}</b> · Coperti: <b className="text-gray-800">{num(s.coperti)}</b></div>
            <div className="text-xs text-gray-500">Pranzo {eur(s.pranzo)} · Cena {eur(s.cena)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
