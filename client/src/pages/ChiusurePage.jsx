import React, { useEffect, useState, useMemo } from 'react'
import { chiusure as chiusureApi } from '../api/client'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, LineChart, Line, ComposedChart
} from 'recharts'
import { periodToDates } from '../components/DateRangePicker'
import PeriodFilter from '../components/PeriodFilter'
import { Printer, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import PageAssistant from '../components/PageAssistant'
import PageStatsWidget from '../components/PageStatsWidget'
import { useTabParam } from '../hooks/useTabParam'
import { useAnniDisponibili } from '../hooks/useAnniDisponibili'
import { useOrdinamento, IconaOrdine, BottoneCsv, NotaCopertura } from '../lib/tabella'

function eur(n) { return n != null ? `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—' }
function fmt(n) { return n != null ? Number(n).toLocaleString('it-IT') : '—' }
function pctDelta(a, b) { if (!b || !a) return null; return Math.round((a - b) / b * 100) }

function DeltaBadge({ value }) {
  if (value == null) return null
  const positive = value > 0
  const zero = value === 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full ml-1 ${
      zero ? 'text-gray-500 bg-gray-100' :
      positive ? 'text-green-700 bg-green-100' : 'text-red-700 bg-red-100'
    }`}>
      {zero ? <Minus size={10}/> : positive ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}
      {zero ? '0%' : `${positive ? '+' : ''}${value}%`}
    </span>
  )
}

// Tonalità per anno nel confronto: l'ultimo anno è il più saturo.
// Non c'è più un numero fisso di anni, quindi nemmeno un numero fisso di colori:
// le tonalità si assegnano per posizione, dalla più chiara alla più scura.
const TONI_MA = ['#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb']
const TONI_PN = ['#f0fdf4', '#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a']
const tono = (toni, i, n) => toni[Math.max(0, toni.length - n + i)] ?? toni[toni.length - 1]

// Deep link: /chiusure?tab=andamento|confronto|mensile|tabella
const TAB_IDS = ['andamento', 'confronto', 'mensile', 'tabella']

export default function ChiusurePage() {
  const [tab, setTab] = useTabParam(TAB_IDS, 'andamento')
  const [location, setLocation] = useState('all')
  const [mensile, setMensile] = useState([])
  const [recenti, setRecenti] = useState([])
  const [stats, setStats] = useState([])
  const [confronto, setConfrontoAnnuale] = useState([])
  const [period, setPeriod] = useState('ytd')
  const [dates, setDates] = useState(periodToDates('ytd'))

  // Anni REALI a DB: il confronto era strutturalmente fisso a tre anni
  // (corrente, -1, -2). Con sette anni di storico significava che quattro anni
  // non erano raggiungibili da nessuna parte della pagina.
  const { anni: anniDisponibili } = useAnniDisponibili('chiusure_giornaliere', 'data')
  const [anniSel, setAnniSel] = useState([])   // vuoto = ultimi 3 disponibili
  const anniConfronto = useMemo(() => {
    const scelti = anniSel.length ? anniSel : anniDisponibili.slice(0, 3)
    return [...scelti].sort((a, b) => a - b)
  }, [anniSel, anniDisponibili])
  const annoRecente = anniConfronto[anniConfronto.length - 1]
  const annoPrec    = anniConfronto[anniConfronto.length - 2]

  const toggleAnno = (y) => setAnniSel(prec => {
    const base = prec.length ? prec : anniDisponibili.slice(0, 3)
    const next = base.includes(y) ? base.filter(x => x !== y) : [...base, y]
    return next.length ? next : base   // almeno un anno selezionato
  })

  // Fix: Recharts ResponsiveContainer ha width=0 quando il tab non è quello iniziale
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
    return () => clearTimeout(t)
  }, [tab])

  const loc = location === 'all' ? undefined : location

  const handleDateChange = (pid, d) => {
    setPeriod(pid)
    if (d) setDates(d)
  }

  useEffect(() => {
    // Guardia di unmount: senza, cambiare rotta durante il fetch produce
    // setState su un componente già smontato.
    let annullato = false
    const p = { location: loc, from: dates?.from, to: dates?.to }
    Promise.all([
      chiusureApi.mensile(p),
      chiusureApi.recenti(p),
      chiusureApi.stats(p),
    ]).then(([m, r, s]) => {
      if (annullato) return
      setMensile(m); setRecenti(r); setStats(s)
    }).catch(e => { if (!annullato) console.error(e) })
    return () => { annullato = true }
  }, [location, dates, loc])

  // Il confronto anno su anno dipende dagli ANNI scelti, non dal periodo:
  // tenerlo nello stesso effetto lo faceva ricaricare a ogni cambio di date
  // e lo legava a un intervallo che non usa.
  useEffect(() => {
    if (!anniConfronto.length) return
    let annullato = false
    chiusureApi.confrontoAnnuale({ location: loc, anni: anniConfronto })
      .then(c => {
        if (annullato) return
        const byMese = {}
        c.forEach(row => {
          if (!byMese[row.mese]) byMese[row.mese] = { mese: row.mese }
          byMese[row.mese][`${row.anno}_${row.location}`] = row.tot_venduto
          byMese[row.mese][`${row.anno}_coperti_${row.location}`] = row.tot_coperti
        })
        setConfrontoAnnuale(Object.values(byMese).sort((a, b) => a.mese > b.mese ? 1 : -1))
      })
      .catch(e => { if (!annullato) console.error(e) })
    return () => { annullato = true }
  }, [loc, anniConfronto])

  // Merge mensile per grafici
  const mensileChart = mensile.reduce((acc, r) => {
    const key = r.mese
    if (!acc[key]) acc[key] = { mese: key }
    acc[key][r.location] = r.tot_venduto
    acc[key][r.location + '_coperti'] = r.tot_coperti
    acc[key][r.location + '_coperto_medio'] = r.avg_coperto_medio
    acc[key][r.location + '_scontrino_medio'] = r.avg_scontrino_medio
    return acc
  }, {})
  const mensileArr = Object.values(mensileChart).sort((a, b) => a.mese > b.mese ? 1 : -1)
  const mensileCombinatoArr = mensileArr.map(m => ({
    mese: m.mese,
    totale: (m.MAMELI || 0) + (m.PREDDA_NIEDDA || 0),
    MAMELI: m.MAMELI || 0,
    PREDDA_NIEDDA: m.PREDDA_NIEDDA || 0,
  }))

  const totaleVenduto = stats.reduce((s, x) => s + (parseFloat(x.tot_venduto) || 0), 0)
  const totaleCoperti = stats.reduce((s, x) => s + (parseInt(x.tot_coperti) || 0), 0)

  // ── Tabella mensile: ordinabile ed esportabile ─────────────────────────────
  const mensileRighe = useMemo(() => mensile.map(m => ({
    ...m,
    tot_venduto: parseFloat(m.tot_venduto) || 0,
    tot_coperti: parseInt(m.tot_coperti) || 0,
    sede: m.location === 'MAMELI' ? 'MA' : 'PN',
  })), [mensile])
  const ordMensile = useOrdinamento(mensileRighe, 'mese', 'desc')
  // Estratto dal .map: ricalcolare il massimo dentro il ciclo rendeva il
  // rendering O(n²) su una tabella che con 7 anni di storico ha 168 righe.
  const maxVendutoMensile = useMemo(
    () => mensileRighe.reduce((m, x) => Math.max(m, x.tot_venduto), 0),
    [mensileRighe]
  )

  const COLONNE_CSV_MENSILE = [
    { chiave: 'mese', etichetta: 'Mese' },
    { chiave: 'sede', etichetta: 'Sede' },
    { chiave: 'tot_venduto', etichetta: 'Venduto' },
    { chiave: 'tot_coperti', etichetta: 'Coperti' },
    { chiave: 'avg_coperto_medio', etichetta: 'Coperto medio' },
    { chiave: 'avg_scontrino_medio', etichetta: 'Scontrino medio' },
    { chiave: 'giorni_apertura', etichetta: 'Giorni apertura' },
  ]

  const COLONNE_CSV_CONFRONTO = useMemo(() => [
    { chiave: 'mese', etichetta: 'Mese' },
    ...anniConfronto.flatMap(y => [
      { chiave: `${y}_MAMELI`, etichetta: `MA ${y} venduto` },
      { chiave: `${y}_PREDDA_NIEDDA`, etichetta: `PN ${y} venduto` },
    ]),
  ], [anniConfronto])

  // `cls` replica le classi responsive delle celle: senza, l'intestazione
  // resterebbe visibile mentre la colonna sparisce, disallineando la tabella.
  const ThM = ({ col, children, align = 'right', cls = '' }) => (
    <th {...ordMensile.propsTh(col)}
      className={`text-${align} px-4 py-3 cursor-pointer select-none hover:text-violet-600 whitespace-nowrap ${cls}`}>
      {children}<IconaOrdine colonna={col} colonnaAttiva={ordMensile.colonna} direzione={ordMensile.direzione} />
    </th>
  )

  const tabs = [
    { id: 'andamento',  label: '📈 Andamento' },
    { id: 'confronto',  label: '📊 Anno su Anno' },
    { id: 'mensile',    label: '📋 Riepilogo Mensile' },
    { id: 'tabella',    label: '🗓️ Dettaglio Giornaliero' },
  ]

  return (
    <>
    <PageStatsWidget />
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Chiusure Cassa</h1>
          <p className="text-sm text-gray-500 mt-0.5">Report giornalieri Sede MA e Sede PN</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {['all','MAMELI','PREDDA_NIEDDA'].map(l => (
            <button key={l} onClick={() => setLocation(l)}
              className={`btn text-xs ${location === l ? 'btn-primary' : 'btn-secondary'}`}>
              {l === 'all' ? 'Tutti' : l === 'MAMELI' ? 'Sede MA' : 'Sede PN'}
            </button>
          ))}
        </div>
      </div>

      {/* Filtro periodo condiviso */}
      <PeriodFilter period={period} dates={dates} onChange={handleDateChange} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {stats.map((s) => (
          <div key={s.location} className={`kpi-card border-l-4 ${s.location === 'MAMELI' ? 'border-blue-500' : 'border-green-500'}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`badge ${s.location === 'MAMELI' ? 'badge-blue' : 'badge-green'}`}>
                {s.location === 'MAMELI' ? 'MA' : 'PN'}
              </span>
              <span className="text-xs text-gray-400">{s.n_giorni} gg</span>
            </div>
            <p className="text-xl font-bold">{eur(s.tot_venduto)}</p>
            <p className="text-xs text-gray-400">Venduto totale</p>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div><span className="text-gray-400">Cop. medio</span><br/><strong>{eur(s.avg_coperto_medio)}</strong></div>
              <div><span className="text-gray-400">Scont. medio</span><br/><strong>{eur(s.avg_scontrino_medio)}</strong></div>
            </div>
          </div>
        ))}
        {stats.length >= 2 && (
          <div className="kpi-card border-l-4 border-violet-500">
            <div className="flex items-center gap-2 mb-1">
              <span className="badge badge-violet">TOTALE</span>
            </div>
            <p className="text-xl font-bold">{eur(totaleVenduto)}</p>
            <p className="text-xs text-gray-400">Venduto combinato</p>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div><span className="text-gray-400">Coperti tot.</span><br/><strong>{fmt(totaleCoperti)}</strong></div>
              <div><span className="text-gray-400">Cop. medio tot.</span><br/><strong>{totaleCoperti > 0 ? eur(totaleVenduto / totaleCoperti) : '—'}</strong></div>
            </div>
          </div>
        )}
        {stats.length === 1 && (
          <div className="kpi-card border-l-4 border-amber-400">
            <p className="text-xs text-gray-400 mb-1">Coperti totali</p>
            <p className="text-xl font-bold">{fmt(stats[0]?.tot_coperti)}</p>
            <p className="text-xs text-gray-400 mt-1">nel periodo</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id ? 'border-violet-500 text-violet-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── ANDAMENTO ─────────────────────────────────────────────── */}
      {tab === 'andamento' && (
        <div className="space-y-4">
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold">Venduto mensile — MA vs PN + Totale</h2>
            </div>
            <div className="card-body">
              <ResponsiveContainer width="100%" height={270}>
                <ComposedChart data={mensileCombinatoArr} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `€${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={v => eur(v)} />
                  <Legend />
                  <Bar dataKey="MAMELI" name="Sede MA" fill="#3b82f6" radius={[3,3,0,0]} />
                  <Bar dataKey="PREDDA_NIEDDA" name="Sede PN" fill="#22c55e" radius={[3,3,0,0]} />
                  <Line type="monotone" dataKey="totale" name="Totale" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 3, fill: '#7c3aed' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <div className="card-header"><h2 className="font-semibold">Coperto medio mensile</h2></div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={mensileArr}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="mese" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={v => `€${v}`} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={v => eur(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="MAMELI_coperto_medio" name="MA — cop. medio" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="PREDDA_NIEDDA_coperto_medio" name="PN — cop. medio" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h2 className="font-semibold">Scontrino medio mensile</h2></div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={mensileArr}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="mese" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={v => `€${v}`} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={v => eur(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="MAMELI_scontrino_medio" name="MA — scont." stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} strokeDasharray="5 2" />
                    <Line type="monotone" dataKey="PREDDA_NIEDDA_scontrino_medio" name="PN — scont." stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} strokeDasharray="5 2" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2 className="font-semibold">Coperti mensili</h2></div>
            <div className="card-body">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={mensileArr}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={v => fmt(v)} />
                  <Legend />
                  <Bar dataKey="MAMELI_coperti" name="MA — coperti" fill="#93c5fd" radius={[3,3,0,0]} />
                  <Bar dataKey="PREDDA_NIEDDA_coperti" name="PN — coperti" fill="#86efac" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ─── CONFRONTO ANNO SU ANNO ──────────────────────────────────── */}
      {tab === 'confronto' && (
        <div className="space-y-4">
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold">Confronto Anno su Anno — Venduto mensile</h2>
              <p className="text-xs text-gray-400 mt-0.5 mb-2">
                Anni presi dai dati: seleziona quali confrontare (il periodo Dal/Al non si applica a questo tab)
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {anniDisponibili.map(y => (
                  <button key={y} onClick={() => toggleAnno(y)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      anniConfronto.includes(y)
                        ? 'bg-violet-600 border-violet-600 text-white'
                        : 'bg-white border-gray-200 text-gray-500 hover:border-violet-300'
                    }`}>{y}</button>
                ))}
              </div>
            </div>
            <div className="card-body">
              {confronto.length === 0 ? (
                <p className="text-center text-gray-400 py-10 text-sm">Nessun dato disponibile per gli anni selezionati</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={confronto} margin={{ top: 4, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={v => `€${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={v => eur(v)} />
                    <Legend />
                    {anniConfronto.flatMap((anno, i) => {
                      const keyMA = `${anno}_MAMELI`, keyPN = `${anno}_PREDDA_NIEDDA`
                      const hasMA = confronto.some(c => c[keyMA] != null)
                      const hasPN = confronto.some(c => c[keyPN] != null)
                      return [
                        hasMA && <Bar key={keyMA} dataKey={keyMA} name={`MA ${anno}`} fill={tono(TONI_MA, i, anniConfronto.length)} radius={[2,2,0,0]} />,
                        hasPN && <Bar key={keyPN} dataKey={keyPN} name={`PN ${anno}`} fill={tono(TONI_PN, i, anniConfronto.length)} radius={[2,2,0,0]} />,
                      ].filter(Boolean)
                    })}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Tabella confronto con delta % */}
          {confronto.length > 0 && (
            <div className="card overflow-hidden">
              <div className="card-header flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="font-semibold">
                    Tabella confronto{annoPrec ? ` — delta ${annoRecente} vs ${annoPrec}` : ` — ${annoRecente}`}
                  </h2>
                  <NotaCopertura righe={confronto.length} fonte="v_chiusure_confronto_annuale"
                    extra={`anni: ${anniConfronto.join(', ')}`} />
                </div>
                <BottoneCsv righe={confronto} colonne={COLONNE_CSV_CONFRONTO} nomeFile={`confronto_${anniConfronto.join('-')}`} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left px-4 py-3">Mese</th>
                      {anniConfronto.map(y => (
                        <th key={`h-MA-${y}`} className="text-right px-4 py-3">MA {y}{y === annoRecente && annoPrec ? ' △' : ''}</th>
                      ))}
                      {anniConfronto.map(y => (
                        <th key={`h-PN-${y}`} className="text-right px-4 py-3">PN {y}{y === annoRecente && annoPrec ? ' △' : ''}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {confronto.map((c) => (
                      <tr key={c.mese} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium">{c.mese}</td>
                        {anniConfronto.map(y => (
                          <td key={`MA-${y}`} className={`px-4 py-2.5 text-right ${y === annoRecente ? 'font-semibold' : y === annoPrec ? '' : 'text-gray-400'}`}>
                            {eur(c[`${y}_MAMELI`])}
                            {y === annoRecente && annoPrec &&
                              <DeltaBadge value={pctDelta(c[`${annoRecente}_MAMELI`], c[`${annoPrec}_MAMELI`])}/>}
                          </td>
                        ))}
                        {anniConfronto.map(y => (
                          <td key={`PN-${y}`} className={`px-4 py-2.5 text-right ${y === annoRecente ? 'font-semibold' : y === annoPrec ? '' : 'text-gray-400'}`}>
                            {eur(c[`${y}_PREDDA_NIEDDA`])}
                            {y === annoRecente && annoPrec &&
                              <DeltaBadge value={pctDelta(c[`${annoRecente}_PREDDA_NIEDDA`], c[`${annoPrec}_PREDDA_NIEDDA`])}/>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── MENSILE ──────────────────────────────────────────────────── */}
      {tab === 'mensile' && (
        <div className="card overflow-hidden">
          <div className="card-header flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold">Riepilogo mensile per sede</h2>
              <NotaCopertura righe={mensile.length} da={dates?.from} a={dates?.to} fonte="chiusure_giornaliere" />
            </div>
            <BottoneCsv righe={ordMensile.righeOrdinate} colonne={COLONNE_CSV_MENSILE} nomeFile={`mensile_${location}`} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <ThM col="mese" align="left">Mese</ThM>
                  <ThM col="sede" align="left">Sede</ThM>
                  <ThM col="tot_venduto">Venduto</ThM>
                  <ThM col="tot_coperti" cls="hidden sm:table-cell">Coperti</ThM>
                  <ThM col="avg_coperto_medio" cls="hidden sm:table-cell">Cop. medio</ThM>
                  <ThM col="avg_scontrino_medio" cls="hidden md:table-cell">Scont. medio</ThM>
                  <ThM col="giorni_apertura" cls="hidden md:table-cell">Giorni</ThM>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ordMensile.righeOrdinate.map((m) => {
                  const barPct = maxVendutoMensile > 0 ? (m.tot_venduto / maxVendutoMensile * 100).toFixed(1) : 0
                  return (
                    <tr key={`${m.mese}-${m.location}`} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium">{m.mese}</td>
                      <td className="px-4 py-2.5">
                        <span className={`badge ${m.location === 'MAMELI' ? 'badge-blue' : 'badge-green'}`}>
                          {m.location === 'MAMELI' ? 'MA' : 'PN'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-semibold">{eur(m.tot_venduto)}</span>
                          <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${m.location === 'MAMELI' ? 'bg-blue-400' : 'bg-green-400'}`}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right hidden sm:table-cell">{fmt(m.tot_coperti)}</td>
                      <td className="px-4 py-2.5 text-right hidden sm:table-cell">{eur(m.avg_coperto_medio)}</td>
                      <td className="px-4 py-2.5 text-right hidden md:table-cell">{eur(m.avg_scontrino_medio)}</td>
                      <td className="px-4 py-2.5 text-right hidden md:table-cell text-gray-500">{m.giorni_apertura}</td>
                    </tr>
                  )
                })}
              </tbody>
              {mensile.length > 0 && (
                <tfoot className="bg-gray-50 font-semibold text-xs text-gray-700">
                  <tr>
                    <td className="px-4 py-2.5" colSpan={2}>TOTALE PERIODO</td>
                    <td className="px-4 py-2.5 text-right">{eur(mensile.reduce((s, m) => s + (parseFloat(m.tot_venduto) || 0), 0))}</td>
                    <td className="px-4 py-2.5 text-right hidden sm:table-cell">{fmt(mensile.reduce((s, m) => s + (parseInt(m.tot_coperti) || 0), 0))}</td>
                    <td className="px-4 py-2.5 text-right hidden sm:table-cell">—</td>
                    <td className="px-4 py-2.5 text-right hidden md:table-cell">—</td>
                    <td className="px-4 py-2.5 text-right hidden md:table-cell">—</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ─── DETTAGLIO GIORNALIERO ──────────────────────────────────── */}
      {tab === 'tabella' && (
        <div className="card overflow-hidden">
          <div className="card-header flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Dettaglio giornaliero</h2>
              <p className="text-xs text-gray-400">{recenti.length} record nel periodo — ↑↓ coperto vs media</p>
            </div>
            <button onClick={() => window.print()} className="btn btn-secondary text-xs flex items-center gap-1">
              <Printer size={13}/> Stampa
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3">Data</th>
                  <th className="text-left px-4 py-3">Sede</th>
                  <th className="text-right px-4 py-3">Venduto</th>
                  <th className="text-right px-4 py-3 hidden sm:table-cell">Coperti</th>
                  <th className="text-right px-4 py-3 hidden sm:table-cell">Cop. medio</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">Scont. medio</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">Scontrini</th>
                  <th className="text-right px-4 py-3 hidden lg:table-cell">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recenti.map((r) => {
                  const avgStat = stats.find(s => s.location === r.location)
                  const avg = avgStat?.avg_coperto_medio
                  const isAbove = avg && r.coperto_medio > avg * 1.05
                  const isBelow = avg && r.coperto_medio < avg * 0.95
                  return (
                    <tr key={`${r.data}-${r.location}`} className={`hover:bg-gray-50 ${r.chiusura_anticipata ? 'bg-amber-50' : ''}`}>
                      <td className="px-4 py-2 font-medium">
                        {r.data}
                        {r.chiusura_anticipata && (
                          <span title={r.note || 'Chiusura fiscale giorno successivo'}
                            className="ml-1.5 text-amber-500 text-xs">⚠</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`badge ${r.location === 'MAMELI' ? 'badge-blue' : 'badge-green'}`}>
                          {r.location === 'MAMELI' ? 'MA' : 'PN'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-semibold">{eur(r.totale_venduto_ipratico)}</td>
                      <td className="px-4 py-2 text-right hidden sm:table-cell">{r.coperti}</td>
                      <td className={`px-4 py-2 text-right hidden sm:table-cell font-medium ${
                        isAbove ? 'text-green-600' : isBelow ? 'text-red-500' : ''
                      }`}>
                        {eur(r.coperto_medio)}
                        {isAbove && <span className="ml-0.5 text-xs">↑</span>}
                        {isBelow && <span className="ml-0.5 text-xs">↓</span>}
                      </td>
                      <td className="px-4 py-2 text-right hidden md:table-cell">{eur(r.scontrino_medio)}</td>
                      <td className="px-4 py-2 text-right hidden md:table-cell text-gray-500">{r.n_doc_fiscali_emessi ?? r.n_doc_fiscali}</td>
                      <td className="px-4 py-2 text-right hidden lg:table-cell text-xs text-gray-400">{r.note || ''}</td>
                    </tr>
                  )
                })}
                {recenti.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Nessun dato per il periodo selezionato</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
      <PageAssistant
        pagina="Chiusure Cassa"
        suggerimenti={[
          "Qual è la chiusura più alta di questo mese?",
          "Media coperti per giorno nella settimana corrente",
          // Anni presi dalla selezione reale: la stringa era cablata a
          // "marzo 2025 vs 2026" e sarebbe invecchiata in silenzio.
          annoPrec
            ? `Confronta le chiusure ${annoPrec} vs ${annoRecente}`
            : `Analizza le chiusure ${annoRecente}`,
        ]}
      />
    </>
  )
}