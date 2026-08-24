/**
 * Rate & Piani — le uniche scadenze certe che abbiamo.
 *
 * PERCHE' UNA PAGINA A PARTE.
 * Nello scadenzario le rate sono una riga fra le altre, e non e' giusto: le
 * fatture aperte hanno una data che e' solo la data del documento, i costi
 * fissi sono previsioni, mentre una rata ha la sua scadenza scritta sopra e
 * quel giorno bisogna pagarla. Qui stanno da sole, col calendario davanti.
 *
 * COME SI LEGGE UNA RATA.
 * Il foglio RATEALI non ha una colonna PAGATO. Finche' nessuno la tocca dal
 * CRM, una rata con scadenza passata si considera versata — assunzione che
 * regge, perche' la somma delle rate scadute nel mese coincide al centesimo
 * con la riga RATEI pagata nella scheda FORNITORI. Dal momento in cui qualcuno
 * la segna a mano, vale quello che ha detto la persona.
 *
 * LE RATE SENZA DATA sono numerate sul piano ma con scadenza e importo vuoti:
 * sono impegni veri di cui il foglio non sa ancora il quando. Si vedono a
 * parte, valorizzate alla rata di regime, e non entrano mai nei totali certi.
 *
 * MODIFICHE. Cambiare una rata qui aggiorna il CRM e mette in coda la cella da
 * riscrivere nel workbook; a scrivere il file ci pensa APPLICA_AL_FOGLIO.bat
 * sul PC dell'amministrazione. Il banner in cima dice quante celle aspettano.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  Landmark, RefreshCw, Info, ChevronDown, ChevronRight, CalendarClock,
  CheckCircle2, CircleDashed, AlertTriangle, Archive, Pencil, X, Save, FileSpreadsheet,
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
  return `${MESI[parseInt(m, 10) - 1]} ${a.slice(2)}`
}
const dataIt = d => d ? new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const oggiIso = () => new Date().toISOString().slice(0, 10)
const sedeLabel = s => s === 'MA' ? 'Mameli' : s === 'PN' ? 'Predda Niedda' : (s || '—')

const STATI = {
  'PAGATA':      { col: '#34d399', icona: CheckCircle2, label: 'Versata' },
  'DA PAGARE':   { col: '#fbbf24', icona: CalendarClock, label: 'Da pagare' },
  'DA DEFINIRE': { col: '#a78bfa', icona: CircleDashed, label: 'Senza data' },
  'CHIUSA':      { col: '#64748b', icona: Archive,      label: 'Piano chiuso' },
}

function Kpi({ label, value, sub, tone = 'slate', icon: Icon }) {
  const t = {
    slate:   'from-slate-600 to-slate-700',
    blue:    'from-blue-500 to-blue-600',
    amber:   'from-amber-500 to-amber-600',
    emerald: 'from-emerald-500 to-emerald-600',
    purple:  'from-purple-500 to-purple-600',
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

/** Il pannellino che si apre sopra una rata per modificarla. */
function ModificaRata({ rata, onChiudi, onSalvato }) {
  const [scadenza, setScadenza] = useState(rata.scadenza || '')
  const [importo, setImporto]   = useState(rata.importo != null ? String(rata.importo) : '')
  const [pagata, setPagata]     = useState(rata.versata)
  const [dataPag, setDataPag]   = useState(rata.data_pagamento || '')
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState(null)

  const salva = async () => {
    setBusy(true); setErr(null)
    try {
      await scadenzarioApi.segnaRata({
        rataId: rata.id,
        pagata,
        scadenza: scadenza || null,
        importo: importo === '' ? null : parseFloat(String(importo).replace(',', '.')),
        dataPagamento: pagata ? (dataPag || oggiIso()) : null,
        autore: 'CRM',
      })
      onSalvato()
    } catch (e) {
      setErr(e.message || String(e))
    } finally { setBusy(false) }
  }

  return (
    // data-modifica-in-corso: vedi lib/aggiornamento.jsx — blocca il rimontaggio
    // automatico mentre l'editor della rata e' aperto.
    <tr className="bg-gray-900/80" data-modifica-in-corso="">
      <td colSpan={7} className="px-4 py-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">Scadenza</label>
            <input type="date" value={scadenza} onChange={e => setScadenza(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-white" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">Importo</label>
            <input type="text" inputMode="decimal" value={importo} onChange={e => setImporto(e.target.value)}
              placeholder="0,00"
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-white w-32 tabular-nums" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">Stato</label>
            <div className="flex gap-1">
              <button onClick={() => setPagata(true)}
                className={`px-3 py-1.5 rounded text-sm ${pagata ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-300'}`}>
                Versata
              </button>
              <button onClick={() => setPagata(false)}
                className={`px-3 py-1.5 rounded text-sm ${!pagata ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-300'}`}>
                Da pagare
              </button>
            </div>
          </div>
          {pagata && (
            <div>
              <label className="block text-[11px] text-gray-400 mb-1">Pagata il</label>
              <input type="date" value={dataPag} onChange={e => setDataPag(e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-white" />
            </div>
          )}
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
          Scadenza e importo finiscono anche nel foglio RATEALI, alla prossima esecuzione di
          APPLICA_AL_FOGLIO. Lo stato «versata» invece resta solo sul CRM: sul foglio una colonna
          per il pagato delle rate non esiste.
        </p>
        {err && <p className="text-xs text-rose-300 mt-2">{err}</p>}
      </td>
    </tr>
  )
}

function Piano({ piano, rate, onRicarica }) {
  const [aperto, setAperto] = useState(!piano.chiuso && piano.rate_da_pagare > 0)
  const [inModifica, setInModifica] = useState(null)
  const mie = rate.filter(r => r.piano_key === piano.piano_key)
  const pagate = piano.rate_scadute || 0
  const avanzamento = piano.rate_totali ? Math.round(100 * pagate / piano.rate_totali) : 0

  return (
    <div className={`border rounded-xl overflow-hidden ${piano.chiuso ? 'border-gray-800 bg-gray-900/30' : 'border-gray-700 bg-gray-800/50'}`}>
      <button onClick={() => setAperto(a => !a)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-800/70 transition">
        {aperto ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-semibold ${piano.chiuso ? 'text-gray-400' : 'text-white'}`}>
              {piano.etichetta || piano.piano}
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded bg-gray-700/60 text-gray-300">{sedeLabel(piano.sede)}</span>
            {piano.chiuso && (
              <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-300">saldato</span>
            )}
            {!piano.chiuso && piano.rate_senza_data > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded bg-amber-900/40 text-amber-300">
                {piano.rate_senza_data} rate da datare
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {pagate} rate su {piano.rate_totali} versate
            {piano.prossima_scadenza && <> · prossima il <span className="text-gray-300">{dataIt(piano.prossima_scadenza)}</span></>}
            {piano.rata_tipo && <> · rata di regime {eur(piano.rata_tipo)}</>}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-lg font-bold tabular-nums ${piano.chiuso ? 'text-gray-500' : 'text-white'}`}>
            {piano.chiuso ? '—' : (piano.residuo_datato ? eur(piano.residuo_datato) : '—')}
          </p>
          <p className="text-[11px] text-gray-500">residuo a calendario</p>
        </div>
      </button>

      <div className="px-5 pb-2">
        <div className="h-1.5 bg-gray-900 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all"
               style={{ width: `${avanzamento}%`, background: piano.chiuso ? '#34d399' : '#3b82f6' }} />
        </div>
      </div>

      {piano.piano_nota && (
        <p className="px-5 pb-3 text-[12px] text-gray-400">{piano.piano_nota}</p>
      )}

      {aperto && (
        <div className="px-5 pb-5 pt-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-700">
                  <th className="py-2 pr-3 w-16">Rata</th>
                  <th className="py-2 px-3">Scadenza</th>
                  <th className="py-2 px-3 text-right">Importo</th>
                  <th className="py-2 px-3">Stato</th>
                  <th className="py-2 px-3">Pagata il</th>
                  <th className="py-2 px-3 text-right">Fra</th>
                  <th className="py-2 pl-3 text-right w-24"></th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {mie.map(r => {
                  const st = STATI[r.stato] || STATI['DA PAGARE']
                  const Ico = st.icona
                  if (inModifica === r.id) {
                    return <ModificaRata key={r.id} rata={r}
                      onChiudi={() => setInModifica(null)}
                      onSalvato={() => { setInModifica(null); onRicarica() }} />
                  }
                  return (
                    <tr key={r.id} className="border-b border-gray-800/60 group">
                      <td className="py-2 pr-3 tabular-nums text-gray-400">{r.n_rata}</td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {r.scadenza
                          ? <span className={r.stato === 'DA PAGARE' ? 'text-white font-medium' : 'text-gray-400'}>{dataIt(r.scadenza)}</span>
                          : <span className="text-purple-300 italic">non ancora fissata</span>}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {r.importo != null ? eur(r.importo) : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="py-2 px-3">
                        <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded"
                              style={{ background: st.col + '22', color: st.col }}>
                          <Ico size={11} /> {st.label}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs text-gray-500 whitespace-nowrap">
                        {r.data_pagamento ? dataIt(r.data_pagamento) : (r.pagata === null ? '' : '—')}
                      </td>
                      <td className="py-2 px-3 text-right text-xs tabular-nums whitespace-nowrap"
                          style={{ color: r.stato === 'DA PAGARE' && r.giorni_a_scadenza <= 15 ? '#fbbf24' : '#6b7280' }}>
                        {r.stato === 'DA PAGARE' && r.giorni_a_scadenza != null
                          ? (r.giorni_a_scadenza === 0 ? 'oggi' : `${r.giorni_a_scadenza} gg`)
                          : ''}
                      </td>
                      <td className="py-2 pl-3 text-right">
                        <button onClick={() => setInModifica(r.id)}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200">
                          <Pencil size={11} /> modifica
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default function RatePiani() {
  const [piani, setPiani] = useState([])
  const [rate, setRate]   = useState([])
  const [coda, setCoda]   = useState([])
  const [busy, setBusy]   = useState(true)
  const [err, setErr]     = useState(null)
  const [sede, setSede]   = useState('Tutte')
  const [mostraChiusi, setMostraChiusi] = useState(false)

  const carica = React.useCallback(() => {
    setBusy(true); setErr(null)
    Promise.all([scadenzarioApi.piani(), scadenzarioApi.rate(), scadenzarioApi.codaFoglio()])
      .then(([p, r, c]) => { setPiani(p); setRate(r); setCoda(c) })
      .catch(e => setErr(e.message || String(e)))
      .finally(() => setBusy(false))
  }, [])
  useEffect(carica, [carica])

  const pianiVisti = useMemo(() => piani
    .filter(p => sede === 'Tutte' || p.sede === sede)
    .filter(p => mostraChiusi || !p.chiuso), [piani, sede, mostraChiusi])

  const attivi = useMemo(() => piani.filter(p => !p.chiuso && (sede === 'Tutte' || p.sede === sede)), [piani, sede])

  const tot = useMemo(() => {
    const n = a => a.reduce((s, x) => s + (parseFloat(x) || 0), 0)
    return {
      residuo:  n(attivi.map(p => p.residuo_datato)),
      stimato:  n(attivi.map(p => p.residuo_stimato_non_datato)),
      versato:  n(piani.filter(p => sede === 'Tutte' || p.sede === sede).map(p => p.gia_versato)),
      daDatare: attivi.reduce((s, p) => s + (p.rate_senza_data || 0), 0),
      daPagare: attivi.reduce((s, p) => s + (p.rate_da_pagare || 0), 0),
    }
  }, [attivi, piani, sede])

  // Il calendario: quanto cade ogni mese, solo rate con data e non ancora versate
  const perMese = useMemo(() => {
    const m = {}
    for (const r of rate) {
      if (r.stato !== 'DA PAGARE') continue
      if (sede !== 'Tutte' && r.sede !== sede) continue
      const k = String(r.scadenza).slice(0, 7)
      const a = m[k] ||= { mese: k, label: meseLabel(k), importo: 0, n: 0, piani: new Set() }
      a.importo += parseFloat(r.importo) || 0
      a.n += 1
      a.piani.add(r.piano)
    }
    return Object.values(m).sort((a, b) => a.mese.localeCompare(b.mese))
      .map(x => ({ ...x, piani: [...x.piani].join(', ') }))
  }, [rate, sede])

  const prossime = useMemo(() => rate
    .filter(r => r.stato === 'DA PAGARE' && (sede === 'Tutte' || r.sede === sede))
    .sort((a, b) => String(a.scadenza).localeCompare(String(b.scadenza))), [rate, sede])

  const inCoda = coda.filter(c => c.stato === 'DA_APPLICARE')

  if (busy && !piani.length) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-gray-400 flex items-center gap-3"><RefreshCw size={18} className="animate-spin" /> Carico i piani…</div>
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
              <Landmark size={24} className="text-amber-400" /> Rate &amp; Piani
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Rottamazione, Equitalia, IRES e i piani rateali: quando cade ogni rata e quanto resta
            </p>
          </div>
          <button onClick={carica}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Ricarica
          </button>
        </div>

        {err && <div className="bg-rose-900/20 border border-rose-700/50 rounded-lg px-4 py-3 text-sm text-rose-200">{err}</div>}

        {inCoda.length > 0 && (
          <div className="bg-blue-900/20 border border-blue-700/50 rounded-xl px-5 py-4">
            <p className="text-sm font-semibold text-blue-200 flex items-center gap-2 mb-1">
              <FileSpreadsheet size={15} /> {inCoda.length} {inCoda.length === 1 ? 'cella aspetta' : 'celle aspettano'} di essere scritte nei file Excel
            </p>
            <p className="text-[13px] text-blue-100/80 leading-relaxed">
              Le modifiche fatte qui sono gia' valide sul CRM. Per portarle anche dentro Mameli26.xlsx e
              Predda_Niedda26.xlsx serve un doppio clic su <span className="font-mono">APPLICA_AL_FOGLIO.bat</span>,
              nella cartella CRM-App sul PC dell'amministrazione. Finche' non lo si lancia, su quelle celle il
              foglio dice ancora la cosa vecchia.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 mr-1">Sede</span>
          {['Tutte', 'MA', 'PN'].map(s => (
            <Bottone key={s} attivo={sede === s} onClick={() => setSede(s)}>{sedeLabel(s) === s ? s : sedeLabel(s)}</Bottone>
          ))}
          <button onClick={() => setMostraChiusi(m => !m)}
            className={`ml-4 px-3 py-1.5 rounded-lg text-sm transition ${
              mostraChiusi ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
            {mostraChiusi ? 'Nascondi i piani saldati' : 'Mostra anche i piani saldati'}
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi label="Residuo a calendario" value={eur0(tot.residuo)} tone="blue" icon={CalendarClock}
               sub={`${tot.daPagare} rate con data certa`} />
          <Kpi label="Previsto senza data" value={tot.stimato ? '≈ ' + eur0(tot.stimato) : '—'} tone="purple" icon={CircleDashed}
               sub={`${tot.daDatare} rate da compilare sul foglio`} />
          <Kpi label="Gia' versato" value={eur0(tot.versato)} tone="emerald" icon={CheckCircle2}
               sub="somma delle rate risultate pagate" />
          <Kpi label="Piani attivi" value={String(attivi.length)} tone="amber" icon={Landmark}
               sub={`${piani.filter(p => p.chiuso).length} saldati`} />
        </div>

        {/* Il calendario delle rate */}
        {perMese.length > 0 && (
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
            <p className="font-semibold text-white mb-1 flex items-center gap-2">
              <CalendarClock size={16} className="text-gray-300" /> Quando cadono le rate
            </p>
            <p className="text-xs text-gray-500 mb-4">
              Solo rate con scadenza scritta sul foglio e non ancora versate — {perMese.reduce((s,x)=>s+x.n,0)} rate,
              {' '}{eur(perMese.reduce((s,x)=>s+x.importo,0))} in tutto
            </p>
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={perMese} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="label" stroke="#9ca3af" fontSize={12} />
                  <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={v => v >= 1000 ? `${Math.round(v/1000)}k` : v} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                           formatter={(v, _n, p) => [`${eur(v)} · ${p.payload.n} rate`, p.payload.piani]} />
                  <Bar dataKey="importo" radius={[4,4,0,0]}>
                    {perMese.map((m, i) => (
                      <Cell key={i} fill={i === 0 ? '#f59e0b' : '#64748b'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Le prossime cinque, in evidenza */}
        {prossime.length > 0 && (
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
            <p className="font-semibold text-white mb-3">Le prossime in scadenza</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {prossime.slice(0, 6).map(r => {
                const urgente = r.giorni_a_scadenza != null && r.giorni_a_scadenza <= 15
                return (
                  <div key={r.id}
                       className={`rounded-lg px-4 py-3 border ${urgente ? 'bg-amber-900/20 border-amber-700/50' : 'bg-gray-900/50 border-gray-700'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-white truncate">{r.piano} · rata {r.n_rata}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {sedeLabel(r.sede)} · {dataIt(r.scadenza)}
                          {r.giorni_a_scadenza != null && (
                            <span className={urgente ? 'text-amber-300 ml-1' : 'ml-1'}>
                              ({r.giorni_a_scadenza === 0 ? 'oggi' : `fra ${r.giorni_a_scadenza} gg`})
                            </span>
                          )}
                        </p>
                      </div>
                      <span className="text-sm font-bold tabular-nums text-white whitespace-nowrap">{eur(r.importo)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* I piani, uno per uno */}
        <div className="space-y-3">
          {pianiVisti.map(p => (
            <Piano key={p.piano_key} piano={p} rate={rate} onRicarica={carica} />
          ))}
          {pianiVisti.length === 0 && (
            <p className="text-sm text-gray-500">Nessun piano da mostrare con questi filtri.</p>
          )}
        </div>

        {/* Le rate senza data */}
        {tot.daDatare > 0 && (
          <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl px-5 py-4">
            <p className="text-sm font-semibold text-amber-200 flex items-center gap-2 mb-2">
              <AlertTriangle size={15} /> {tot.daDatare} rate esistono ma non sanno quando
            </p>
            <p className="text-[13px] text-amber-100/90 leading-relaxed">
              Sul foglio RATEALI questi piani hanno le rate numerate fino in fondo, ma le colonne Scadenza e
              Importo compilate solo per le prime. Sono impegni veri — circa <strong>{eur(tot.stimato)}</strong> se
              si valorizzano alla rata di regime del piano — di cui pero' non si conosce la data. Non entrano in
              nessun totale certo, ne' qui ne' nello Scadenzario. Si sistemano in due modi: compilando il foglio,
              oppure aprendo il piano qui sopra e mettendo scadenza e importo rata per rata, che scrive anche sul
              foglio.
            </p>
          </div>
        )}

        {/* Storico della coda */}
        {coda.length > 0 && (
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
            <p className="font-semibold text-white mb-1 flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-gray-300" /> Modifiche verso i file Excel
            </p>
            <p className="text-xs text-gray-500 mb-4">
              Ultime {coda.length} · {inCoda.length} ancora da applicare
            </p>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-800">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-700">
                    <th className="py-2 pr-3">Quando</th>
                    <th className="py-2 px-3">Riga</th>
                    <th className="py-2 px-3">Foglio</th>
                    <th className="py-2 px-3">Campo</th>
                    <th className="py-2 px-3">Da</th>
                    <th className="py-2 px-3">A</th>
                    <th className="py-2 pl-3">Stato</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {coda.map(c => (
                    <tr key={c.id} className="border-b border-gray-800/60">
                      <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(c.creato_il).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-2 px-3 text-white max-w-xs truncate" title={c.descrizione}>{c.descrizione}</td>
                      <td className="py-2 px-3 text-xs text-gray-400">{sedeLabel(c.sede)} · {c.foglio}</td>
                      <td className="py-2 px-3 text-xs font-mono text-gray-400">{c.campo}</td>
                      <td className="py-2 px-3 text-xs tabular-nums text-gray-500">{c.valore_vecchio || '—'}</td>
                      <td className="py-2 px-3 text-xs tabular-nums text-white">{c.valore_nuovo || '—'}</td>
                      <td className="py-2 pl-3">
                        <span className={`text-[11px] px-2 py-0.5 rounded ${
                          c.stato === 'APPLICATA' ? 'bg-emerald-900/40 text-emerald-300'
                          : c.stato === 'ERRORE'  ? 'bg-rose-900/40 text-rose-300'
                          : 'bg-blue-900/40 text-blue-300'}`}>
                          {c.stato === 'DA_APPLICARE' ? 'in coda' : c.stato.toLowerCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl px-5 py-4">
          <p className="text-sm font-semibold text-gray-300 flex items-center gap-2 mb-2">
            <Info size={15} /> Come si leggono queste rate
          </p>
          <p className="text-[13px] text-gray-400 leading-relaxed">
            Il foglio RATEALI <strong>non ha una colonna per il pagato</strong>. Finche' nessuno interviene, una
            rata con scadenza passata si considera versata: e' l'unica lettura possibile, e regge, perche' la
            somma delle rate scadute nel mese coincide al centesimo con la riga RATEI pagata nella scheda
            FORNITORI — 1.440,29 € al mese su Mameli e 431,59 su Predda Niedda. Dal momento in cui si segna una
            rata a mano da questa pagina, vale quello che si e' scritto qui.
          </p>
        </div>

        <p className="text-[11px] text-gray-600 pb-6">
          Fonte: scheda RATEALI di Mameli26.xlsx e Predda_Niedda26.xlsx, letta per blocchi di colonne.
          I piani saldati restano a database come storico e non pesano su nessun totale.
          Le stesse rate compaiono anche in Costi &amp; Margini → Scadenzario, insieme a fatture e costi fissi.
        </p>
      </div>
      <PageAssistant
        pagina="Rate e Piani"
        suggerimenti={[
          "Quanto pago di rate nei prossimi tre mesi?",
          "Qual e' la prossima rata in scadenza?",
          "Quanto ho gia' versato sulla rottamazione?",
          "Quali rate non hanno ancora una data?",
        ]}
      />
    </div>
  )
}
