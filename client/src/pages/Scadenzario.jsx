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
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  CalendarClock, AlertTriangle, Building2, Wallet, RefreshCw, Info,
  ChevronDown, ChevronRight, Clock, TrendingUp,
} from 'lucide-react'
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

export default function Scadenzario() {
  const [righe, setRighe] = useState([])
  const [busy, setBusy]   = useState(true)
  const [err, setErr]     = useState(null)
  const [sede, setSede]   = useState('Tutte')
  const [vista, setVista] = useState('tutto')   // tutto | fatture | costi
  const [fascia, setFascia] = useState(null)
  const [ordina, setOrdina] = useState('importo')

  const carica = React.useCallback(() => {
    setBusy(true); setErr(null)
    scadenzarioApi.elenco().then(setRighe).catch(e => setErr(e.message || String(e))).finally(() => setBusy(false))
  }, [])
  useEffect(carica, [carica])

  const filtrate = useMemo(() => {
    let r = righe
    if (sede !== 'Tutte') r = r.filter(x => (x.sede || 'Da assegnare') === sede)
    if (vista === 'fatture') r = r.filter(x => x.origine === 'fattura')
    if (vista === 'costi')   r = r.filter(x => x.origine === 'costo_fisso')
    if (fascia) r = r.filter(x => x.origine === 'fattura' && fasciaDi(x.giorni_anzianita).id === fascia)
    return r
  }, [righe, sede, vista, fascia])

  const kpi = useMemo(() => {
    const f  = filtrate.filter(x => x.origine === 'fattura')
    const cf = filtrate.filter(x => x.origine === 'costo_fisso')
    const somma = a => a.reduce((s, x) => s + (parseFloat(x.importo) || 0), 0)
    const vecchie = f.filter(x => x.giorni_anzianita > 60)
    return {
      totale: somma(filtrate), fatture: somma(f), costi: somma(cf),
      vecchie: somma(vecchie), nVecchie: vecchie.length, nFatture: f.length, nCosti: cf.length,
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
          {fascia && (
            <button onClick={() => setFascia(null)}
              className="ml-2 text-xs px-2 py-1 rounded bg-blue-900/40 text-blue-300 border border-blue-700">
              fascia {FASCE.find(f => f.id === fascia)?.label} · togli filtro ✕
            </button>
          )}
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi label="Totale da pagare" value={eur0(kpi.totale)} tone="blue" icon={Wallet}
               sub={`${filtrate.length} voci`} />
          <Kpi label="Fatture fornitore" value={eur0(kpi.fatture)} tone="purple" icon={Building2}
               sub={`${kpi.nFatture} documenti ancora aperti`} />
          <Kpi label="Costi fissi previsti" value={eur0(kpi.costi)} tone="slate" icon={CalendarClock}
               sub={`${kpi.nCosti} voci pianificate`} />
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
                  <th className="py-2 pl-3 text-right">Importo</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {elenco.map(r => {
                  const fatt = r.origine === 'fattura'
                  const fa = fasciaDi(r.giorni_anzianita)
                  return (
                    <tr key={r.chiave} className="border-b border-gray-800/60">
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
                      <td className={`py-2 pl-3 text-right tabular-nums font-semibold whitespace-nowrap ${
                        parseFloat(r.importo) < 0 ? 'text-cyan-300' : 'text-white'}`}>
                        {eur(r.importo)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-600 mt-3">
            * la data e' quella della fattura, non la scadenza: i termini di pagamento non sono a sistema.
          </p>
        </Sezione>

        <p className="text-[11px] text-gray-600 pb-6">
          Fonti: fatture con stato APERTA o PARZIALE in fatture_importate (i doppioni sono esclusi, le note di
          credito compaiono in negativo perche' riducono l'esposizione) e costi fissi pianificati dal mese
          corrente in avanti. Gli F24 non sono qui: le deleghe future arrivano dallo studio e non sono ancora
          note — quelle gia' pagate stanno in Costi &amp; Margini → F24.
        </p>
      </div>
      <PageAssistant
        pagina="Scadenzario"
        suggerimenti={[
          "Quanto devo ai fornitori in tutto?",
          "Quali fatture sono ferme da piu' di 90 giorni?",
          "Quanto pesano i costi fissi dei prossimi tre mesi?",
          "A quale fornitore devo di piu'?",
        ]}
      />
    </div>
  )
}
