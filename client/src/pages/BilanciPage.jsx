/**
 * BilanciPage.jsx — Bilanci civilistici depositati.
 *
 * Ogni sottosezione ha un URL proprio (sotto-route, non query param):
 *   /bilanci                        → Panoramica
 *   /bilanci/conto-economico        → CE riclassificato + confronto anno su anno
 *   /bilanci/stato-patrimoniale     → SP sintetico (attivo / passivo)
 *   /bilanci/riconciliazione        → scostamento civilistico ↔ gestionale CRM
 *   /bilanci/indici                 → food cost, labour cost, prime cost, EBITDA
 *
 * Fonti (tutte lette tramite bilanciApi, mai query sparse nella UI):
 *   bilanci                  testata per esercizio
 *   bilancio_voci            dettaglio gerarchico (livello, ordine, is_totale)
 *   v_bilancio_kpi           indici già calcolati lato DB
 *   v_bilancio_vs_gestionale riconciliazione per voce
 */
import { useState, useEffect, useMemo } from 'react'
import { useParams, NavLink } from 'react-router-dom'
import {
  BookOpen, Scale, Landmark, GitCompareArrows, Percent,
  TrendingUp, TrendingDown, AlertTriangle, Info, Database, CheckCircle, MinusCircle,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, ReferenceLine,
} from 'recharts'
import { bilanciApi } from '../api/client'
import PageAssistant from '../components/PageAssistant'

// ── Sezioni ────────────────────────────────────────────────────────────────
const SEZIONI = [
  { id: 'panoramica',         path: '/bilanci',                    label: 'Panoramica',         icon: BookOpen },
  { id: 'conto-economico',    path: '/bilanci/conto-economico',    label: 'Conto Economico',    icon: Scale },
  { id: 'stato-patrimoniale', path: '/bilanci/stato-patrimoniale', label: 'Stato Patrimoniale', icon: Landmark },
  { id: 'riconciliazione',    path: '/bilanci/riconciliazione',    label: 'Bilancio vs CRM',    icon: GitCompareArrows },
  { id: 'indici',             path: '/bilanci/indici',             label: 'Indici',             icon: Percent },
]

// ── Formattazione ──────────────────────────────────────────────────────────
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : null }
const eur = v => n(v) == null ? '—'
  : n(v).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const eur2 = v => n(v) == null ? '—'
  : n(v).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (v, d = 1) => n(v) == null ? '—' : `${n(v).toFixed(d)}%`

/** Etichetta leggibile di un esercizio: "2025 (provvisorio)". */
const labelEsercizio = b => b ? `${b.anno}${b.tipo && b.tipo !== 'definitivo' ? ` (${b.tipo})` : ''}` : '—'

// ── Componenti condivisi ───────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = 'indigo' }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    green:  'bg-green-50 text-green-600 border-green-100',
    red:    'bg-red-50 text-red-600 border-red-100',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-100',
    gray:   'bg-gray-50 text-gray-600 border-gray-200',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color] || colors.indigo}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={18}/>
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs mt-1 opacity-70">{sub}</div>}
    </div>
  )
}

function Card({ title, icon: Icon, children, right }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
          {Icon && <Icon size={16} className="text-indigo-500"/>} {title}
        </h2>
        {right}
      </div>
      {children}
    </div>
  )
}

function Vuoto({ messaggio }) {
  return (
    <div className="flex flex-col items-center justify-center h-40 text-gray-400">
      <Database size={32} className="mb-2 opacity-40"/>
      <p className="text-sm text-center max-w-md">{messaggio}</p>
    </div>
  )
}

function Delta({ corrente, precedente }) {
  const c = n(corrente), p = n(precedente)
  if (c == null || p == null) return <span className="text-gray-300">—</span>
  const d = c - p
  const dp = p !== 0 ? (d / Math.abs(p)) * 100 : null
  const su = d >= 0
  return (
    <span className={`inline-flex items-center gap-1 font-medium whitespace-nowrap ${su ? 'text-green-600' : 'text-red-600'}`}>
      {su ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
      {su ? '+' : ''}{eur(d)}
      {dp != null && <span className="opacity-70">({dp >= 0 ? '+' : ''}{dp.toFixed(1)}%)</span>}
    </span>
  )
}

/** Banner sullo stato dello schema: distingue "tabella assente" da "zero righe". */
function StatoSchema({ stato, nVoci }) {
  if (!stato) return null
  const mancanti = []
  if (!stato.testate) mancanti.push('bilanci')
  if (!stato.voci) mancanti.push('bilancio_voci')

  if (mancanti.length) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-500 mt-0.5 flex-shrink-0"/>
        <div className="text-sm text-amber-800">
          <p className="font-semibold mb-1">Tabelle dei bilanci non ancora disponibili</p>
          <p className="opacity-90">
            Mancano: {mancanti.map(x => <code key={x} className="font-mono mr-1">{x}</code>)}.
            La sezione si popolerà da sola appena i bilanci saranno importati a database.
          </p>
        </div>
      </div>
    )
  }
  if (!nVoci) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-500 mt-0.5 flex-shrink-0"/>
        <div className="text-sm text-amber-800">
          <p className="font-semibold mb-1">Tabelle presenti ma nessuna riga leggibile</p>
          <p className="opacity-90">
            Se l'import è già avvenuto, verifica che le policy RLS di
            <code className="font-mono mx-1">bilancio_voci</code>
            includano il ruolo <code className="font-mono">authenticated</code>: l'app non usa
            <code className="font-mono ml-1">anon</code>, e una policy solo per <code className="font-mono">anon</code>
            restituisce zero righe senza alcun errore.
          </p>
        </div>
      </div>
    )
  }
  return null
}

/** Selettore dell'esercizio da visualizzare. */
function SelettoreEsercizio({ testate, selezionato, onChange }) {
  if (testate.length <= 1) {
    return <span className="text-xs text-gray-400">{labelEsercizio(testate[0])}</span>
  }
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium text-gray-600">Esercizio</label>
      <select
        className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
        value={selezionato ?? ''}
        onChange={e => onChange(Number(e.target.value))}>
        {testate.map(b => (
          <option key={b.id} value={b.id}>{labelEsercizio(b)}</option>
        ))}
      </select>
    </div>
  )
}

/**
 * Tabella gerarchica di voci di bilancio.
 * Rispetta `livello` (indentazione), `is_totale` (riga di totale) e `ordine`.
 */
function TabellaVoci({ voci, annoCorrente, annoPrecedente }) {
  const righe = useMemo(
    () => [...voci].sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)),
    [voci],
  )
  // Non tutti i bilanci riportano la colonna comparativa: il provvisorio 2025,
  // per esempio, non ne ha nessuna. Mostrare due colonne interamente vuote
  // farebbe sembrare un dato mancante ciò che semplicemente non esiste.
  const haPrecedente = useMemo(
    () => righe.some(v => n(v.importo_anno_precedente) != null),
    [righe],
  )

  if (!righe.length) return <Vuoto messaggio="Nessuna voce per questo prospetto."/>

  return (
    <div className="overflow-x-auto">
      {!haPrecedente && (
        <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mb-3">
          Questo bilancio non riporta la colonna comparativa dell'esercizio precedente.
          Per il confronto anno su anno usa il grafico in cima alla sezione, che mette a
          confronto gli esercizi fra loro.
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left">
            <th className="pb-2 pr-4 font-semibold text-gray-600">Voce</th>
            <th className="pb-2 pr-4 font-semibold text-gray-600 text-right whitespace-nowrap">{annoCorrente ?? 'Esercizio'}</th>
            {haPrecedente && <>
              <th className="pb-2 pr-4 font-semibold text-gray-600 text-right whitespace-nowrap">{annoPrecedente ?? 'Precedente'}</th>
              <th className="pb-2 pr-4 font-semibold text-gray-600 text-right whitespace-nowrap">Δ</th>
            </>}
          </tr>
        </thead>
        <tbody>
          {righe.map(v => {
            const totale = v.is_totale === true
            const liv = Math.max(0, Math.min(4, Number(v.livello) || 0))
            return (
              // Chiave stabile: id di riga del DB, indipendente dall'ordinamento.
              <tr key={v.id}
                className={`border-b border-gray-50 hover:bg-gray-50 ${totale ? 'bg-gray-50/70' : ''}`}>
                <td className={`py-2 pr-4 ${totale ? 'font-semibold text-gray-900' : 'text-gray-700'}`}
                  style={{ paddingLeft: `${liv * 18}px` }}>
                  {v.codice_voce && (
                    <span className="text-gray-300 mr-2 font-mono text-xs">{v.codice_voce}</span>
                  )}
                  {v.descrizione}
                </td>
                <td className={`py-2 pr-4 text-right whitespace-nowrap ${totale ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  {eur(v.importo)}
                </td>
                {haPrecedente && <>
                  <td className="py-2 pr-4 text-right text-gray-500 whitespace-nowrap">
                    {eur(v.importo_anno_precedente)}
                  </td>
                  <td className="py-2 pr-4 text-right text-xs">
                    <Delta corrente={v.importo} precedente={v.importo_anno_precedente}/>
                  </td>
                </>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Pagina ─────────────────────────────────────────────────────────────────
export default function BilanciPage() {
  const { sezione } = useParams()
  const attiva = SEZIONI.some(s => s.id === sezione) ? sezione : 'panoramica'

  const [dati, setDati] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState(null)
  const [bilancioId, setBilancioId] = useState(null)

  useEffect(() => {
    // Guardia di unmount: senza, un cambio di rotta durante il fetch produce
    // setState su un componente già smontato.
    let annullato = false
    setLoading(true)
    setErrore(null)

    bilanciApi.caricaTutto()
      .then(res => {
        if (annullato) return
        setDati(res)
        // Default: l'esercizio più recente. Nessun anno cablato.
        const ultimo = [...res.testate].sort((a, b) => (a.anno ?? 0) - (b.anno ?? 0)).pop()
        setBilancioId(ultimo?.id ?? null)
      })
      .catch(e => { if (!annullato) setErrore(e?.message || String(e)) })
      .finally(() => { if (!annullato) setLoading(false) })

    return () => { annullato = true }
  }, [])

  const testate = useMemo(
    () => [...(dati?.testate || [])].sort((a, b) => (b.anno ?? 0) - (a.anno ?? 0)),
    [dati],
  )
  const bilancio = useMemo(
    () => testate.find(b => b.id === bilancioId) || testate[0] || null,
    [testate, bilancioId],
  )
  const vociBilancio = useMemo(
    () => (dati?.voci || []).filter(v => v.bilancio_id === bilancio?.id),
    [dati, bilancio],
  )

  const Icona = SEZIONI.find(s => s.id === attiva)?.icon || BookOpen

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Icona className="text-indigo-600" size={26}/>
          Bilanci
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {dati?.testate?.[0]?.societa || 'Bilanci civilistici depositati'} — confronto con il gestionale
        </p>
      </div>

      {/* Navigazione sottosezioni: link veri, ognuno con URL proprio */}
      <div className="flex gap-1 overflow-x-auto mb-6 border-b border-gray-200">
        {SEZIONI.map(s => (
          <NavLink
            key={s.id}
            to={s.path}
            end={s.id === 'panoramica'}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 whitespace-nowrap transition-colors ${
                isActive
                  ? 'border-indigo-600 text-indigo-700 bg-indigo-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`
            }>
            <s.icon size={15}/>{s.label}
          </NavLink>
        ))}
      </div>

      {errore && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">
          Errore nel caricamento dei bilanci: {errore}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={`skel-${i}`} className="bg-white rounded-xl border p-4 h-24 animate-pulse"/>
          ))}
        </div>
      ) : (
        <>
          <StatoSchema stato={dati?.stato} nVoci={dati?.voci?.length || 0}/>

          {attiva === 'panoramica' && (
            <Panoramica testate={testate} kpi={dati?.kpi || []}/>
          )}
          {attiva === 'conto-economico' && (
            <ContoEconomico
              voci={vociBilancio} bilancio={bilancio} testate={testate}
              kpi={dati?.kpi || []} onCambiaEsercizio={setBilancioId}/>
          )}
          {attiva === 'stato-patrimoniale' && (
            <StatoPatrimoniale
              voci={vociBilancio} bilancio={bilancio} testate={testate}
              onCambiaEsercizio={setBilancioId}/>
          )}
          {attiva === 'riconciliazione' && (
            <Riconciliazione righe={dati?.riconciliazione || []}/>
          )}
          {attiva === 'indici' && (
            <Indici kpi={dati?.kpi || []}/>
          )}
        </>
      )}

      <PageAssistant
        pageId={`bilanci-${attiva}`}
        systemContext={{ sezione: attiva, esercizio: bilancio?.anno, kpi: dati?.kpi }}
        suggestions={[
          'Perché il costo del personale a bilancio è più basso del gestionale?',
          'Come è cambiato il food cost rispetto all\'anno scorso?',
          'L\'EBITDA ricorrente è sostenibile?',
          'Quali scostamenti bilancio/CRM devo verificare?',
        ]}/>
    </div>
  )
}

// ── Sezione: Panoramica ────────────────────────────────────────────────────
function Panoramica({ testate, kpi }) {
  const kpiOrdinati = useMemo(() => [...kpi].sort((a, b) => (a.anno ?? 0) - (b.anno ?? 0)), [kpi])
  const ultimo = kpiOrdinati[kpiOrdinati.length - 1]
  const prec = kpiOrdinati[kpiOrdinati.length - 2]

  if (!testate.length) {
    return (
      <Card title="Bilanci depositati" icon={BookOpen}>
        <Vuoto messaggio="Nessun bilancio a database. I PDF in Bilanci/ verranno importati dal job dedicato."/>
      </Card>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard icon={BookOpen} label="Esercizi a bilancio" color="indigo"
          value={testate.length}
          sub={testate.length ? `${testate[testate.length - 1].anno} – ${testate[0].anno}` : ''}/>
        <KpiCard icon={TrendingUp} label={`Ricavi ${ultimo?.anno ?? ''}`} color="green"
          value={eur(ultimo?.ricavi_caratteristici)}
          sub={prec ? `${n(ultimo?.ricavi_caratteristici) - n(prec.ricavi_caratteristici) >= 0 ? '+' : ''}${eur(n(ultimo?.ricavi_caratteristici) - n(prec.ricavi_caratteristici))} vs ${prec.anno}` : ''}/>
        <KpiCard icon={Scale} label="Risultato d'esercizio"
          color={n(ultimo?.risultato) == null ? 'gray' : n(ultimo.risultato) >= 0 ? 'green' : 'red'}
          value={eur(ultimo?.risultato)}
          sub={ultimo ? `EBITDA ${eur(ultimo.ebitda)} · ${pct(ultimo.ebitda_pct)}` : ''}/>
        <KpiCard icon={Percent} label="Prime cost"
          color={n(ultimo?.prime_cost_pct) == null ? 'gray' : n(ultimo.prime_cost_pct) > 70 ? 'red' : 'green'}
          value={pct(ultimo?.prime_cost_pct)}
          sub="food + labour sul fatturato"/>
      </div>

      <Card title="Bilanci depositati" icon={BookOpen}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="pb-2 pr-4 font-semibold text-gray-600">Esercizio</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Tipo</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Schema</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600 text-right">Valore produzione</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600 text-right">Costi produzione</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600 text-right">Risultato</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600 text-right">Totale attivo</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Fonte</th>
              </tr>
            </thead>
            <tbody>
              {testate.map(b => (
                <tr key={b.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 pr-4 font-medium text-gray-800">{b.anno}</td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      b.tipo === 'definitivo' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>{b.tipo || '—'}</span>
                  </td>
                  <td className="py-2 pr-4 text-gray-500 text-xs">{b.schema_bilancio || '—'}</td>
                  <td className="py-2 pr-4 text-right text-gray-700">{eur(b.totale_valore_produzione)}</td>
                  <td className="py-2 pr-4 text-right text-gray-700">{eur(b.totale_costi_produzione)}</td>
                  <td className="py-2 pr-4 text-right">
                    <span className={`font-semibold ${n(b.risultato_esercizio) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {eur(b.risultato_esercizio)}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-700">{eur(b.totale_attivo)}</td>
                  <td className="py-2 pr-4 text-gray-400 text-xs truncate max-w-[180px]" title={b.fonte_file || ''}>
                    {b.fonte_file || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Un bilancio <strong>provvisorio</strong> non è ancora approvato e può cambiare: i confronti
          che lo includono vanno letti come indicativi.
        </p>
      </Card>
    </>
  )
}

// ── Sezione: Conto Economico ───────────────────────────────────────────────
function ContoEconomico({ voci, bilancio, testate, kpi, onCambiaEsercizio }) {
  const vociCE = useMemo(() => voci.filter(v => v.sezione === 'CE'), [voci])
  const kpiOrdinati = useMemo(() => [...kpi].sort((a, b) => (a.anno ?? 0) - (b.anno ?? 0)), [kpi])

  const chart = useMemo(() => kpiOrdinati.map(k => ({
    anno: String(k.anno),
    Ricavi: n(k.ricavi_caratteristici),
    'Costo del venduto': n(k.costo_del_venduto),
    Personale: n(k.personale),
    EBITDA: n(k.ebitda),
    Risultato: n(k.risultato),
  })), [kpiOrdinati])

  if (!bilancio) {
    return (
      <Card title="Conto economico riclassificato" icon={Scale}>
        <Vuoto messaggio="Nessun bilancio disponibile."/>
      </Card>
    )
  }

  return (
    <>
      {chart.length > 0 && (
        <Card title="Conto economico riclassificato — confronto fra esercizi" icon={TrendingUp}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chart} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="anno" fontSize={11}/>
              <YAxis fontSize={11} tickFormatter={v => `€${(v / 1000).toFixed(0)}k`}/>
              <Tooltip formatter={v => eur2(v)}/>
              <Legend/>
              <ReferenceLine y={0} stroke="#9ca3af"/>
              <Bar dataKey="Ricavi" fill="#6366f1" radius={[4, 4, 0, 0]}/>
              <Bar dataKey="Costo del venduto" fill="#ef4444" radius={[4, 4, 0, 0]}/>
              <Bar dataKey="Personale" fill="#f59e0b" radius={[4, 4, 0, 0]}/>
              <Bar dataKey="EBITDA" fill="#10b981" radius={[4, 4, 0, 0]}/>
              <Bar dataKey="Risultato" fill="#8b5cf6" radius={[4, 4, 0, 0]}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card title={`Dettaglio conto economico ${labelEsercizio(bilancio)}`} icon={Scale}
        right={<SelettoreEsercizio testate={testate} selezionato={bilancio.id} onChange={onCambiaEsercizio}/>}>
        <TabellaVoci voci={vociCE} annoCorrente={bilancio.anno} annoPrecedente={bilancio.anno - 1}/>
        {vociCE.some(v => n(v.importo_anno_precedente) != null) && (
          <p className="text-xs text-gray-400 mt-3">
            La colonna {bilancio.anno - 1} è quella comparativa riportata nel bilancio {bilancio.anno},
            non il bilancio {bilancio.anno - 1} depositato: i due possono differire per riclassifiche.
          </p>
        )}
      </Card>
    </>
  )
}

// ── Sezione: Stato Patrimoniale ────────────────────────────────────────────
function StatoPatrimoniale({ voci, bilancio, testate, onCambiaEsercizio }) {
  const attivo  = useMemo(() => voci.filter(v => v.sezione === 'SP_ATTIVO'), [voci])
  const passivo = useMemo(() => voci.filter(v => v.sezione === 'SP_PASSIVO'), [voci])

  if (!bilancio) {
    return (
      <Card title="Stato patrimoniale" icon={Landmark}>
        <Vuoto messaggio="Nessun bilancio disponibile."/>
      </Card>
    )
  }

  const sbilancio = n(bilancio.totale_attivo) != null && n(bilancio.totale_passivo) != null
    ? n(bilancio.totale_attivo) - n(bilancio.totale_passivo)
    : null

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <KpiCard icon={Landmark} label="Totale attivo" color="indigo" value={eur(bilancio.totale_attivo)}
          sub={`esercizio ${labelEsercizio(bilancio)}`}/>
        <KpiCard icon={Landmark} label="Totale passivo" color="indigo" value={eur(bilancio.totale_passivo)}
          sub="passivo e patrimonio netto"/>
        <KpiCard icon={sbilancio === 0 ? CheckCircle : AlertTriangle} label="Quadratura"
          color={sbilancio == null ? 'gray' : Math.abs(sbilancio) < 1 ? 'green' : 'red'}
          value={sbilancio == null ? '—' : Math.abs(sbilancio) < 1 ? 'OK' : eur(sbilancio)}
          sub="attivo − passivo"/>
      </div>

      <Card title={`Attivo ${labelEsercizio(bilancio)}`} icon={Landmark}
        right={<SelettoreEsercizio testate={testate} selezionato={bilancio.id} onChange={onCambiaEsercizio}/>}>
        <TabellaVoci voci={attivo} annoCorrente={bilancio.anno} annoPrecedente={bilancio.anno - 1}/>
      </Card>

      <Card title={`Passivo e patrimonio netto ${labelEsercizio(bilancio)}`} icon={Landmark}>
        <TabellaVoci voci={passivo} annoCorrente={bilancio.anno} annoPrecedente={bilancio.anno - 1}/>
      </Card>
    </>
  )
}

// ── Sezione: Riconciliazione bilancio ↔ gestionale ─────────────────────────
function Riconciliazione({ righe }) {
  const ordinate = useMemo(
    () => [...righe].sort((a, b) => (b.anno ?? 0) - (a.anno ?? 0) || (a.ordine ?? 0) - (b.ordine ?? 0)),
    [righe],
  )

  const confrontabili = useMemo(
    () => ordinate.filter(r => n(r.importo_bilancio) != null && n(r.importo_gestionale) != null),
    [ordinate],
  )

  const chart = useMemo(() => confrontabili.map(r => ({
    label: `${r.etichetta.length > 34 ? r.etichetta.slice(0, 32) + '…' : r.etichetta} · ${r.anno}`,
    Bilancio: n(r.importo_bilancio),
    Gestionale: n(r.importo_gestionale),
  })), [confrontabili])

  // Raggruppamento per anno, poi per blocco: rispecchia la lettura di un bilancio.
  // Sta PRIMA del return anticipato: un hook dopo un return condizionale viola
  // le regole degli hook e fa crashare il componente appena `righe` si popola.
  const perAnno = useMemo(() => {
    const g = new Map()
    for (const r of ordinate) {
      if (!g.has(r.anno)) g.set(r.anno, [])
      g.get(r.anno).push(r)
    }
    return [...g.entries()]
  }, [ordinate])

  if (!ordinate.length) {
    return (
      <Card title="Bilancio vs gestionale" icon={GitCompareArrows}>
        <Vuoto messaggio="La vista di riconciliazione non contiene righe."/>
      </Card>
    )
  }

  return (
    <>
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex items-start gap-3">
        <Info size={18} className="text-blue-500 mt-0.5 flex-shrink-0"/>
        <div className="text-sm text-blue-800">
          <p className="font-semibold mb-1">Come leggere gli scostamenti</p>
          <p className="opacity-90">
            Il bilancio segue la <strong>competenza economica</strong>, il CRM la <strong>cassa</strong>:
            uno scarto è fisiologico. Contano gli scostamenti ampi e le voci dove il gestionale
            supera il civilistico. Ogni riga indica la fonte esatta usata lato CRM; dove il dato
            non è ricostruibile la cella resta vuota anziché mostrare uno zero fuorviante.
          </p>
        </div>
      </div>

      {chart.length > 0 && (
        <Card title="Civilistico vs gestionale — voci confrontabili" icon={GitCompareArrows}>
          <ResponsiveContainer width="100%" height={Math.max(240, chart.length * 46)}>
            <BarChart data={chart} layout="vertical" margin={{ top: 10, right: 40, left: 200, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis type="number" fontSize={11} tickFormatter={v => `€${(v / 1000).toFixed(0)}k`}/>
              <YAxis type="category" dataKey="label" fontSize={10} width={195}/>
              <Tooltip formatter={v => eur2(v)}/>
              <Legend/>
              <Bar dataKey="Bilancio" fill="#6366f1" radius={[0, 4, 4, 0]}/>
              <Bar dataKey="Gestionale" fill="#10b981" radius={[0, 4, 4, 0]}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {perAnno.map(([anno, rows]) => (
        <Card key={anno} title={`Riconciliazione ${anno}`} icon={GitCompareArrows}
          right={<span className="text-xs text-gray-400">
            {rows.filter(r => n(r.importo_gestionale) != null).length} di {rows.length} voci confrontabili
          </span>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="pb-2 pr-4 font-semibold text-gray-600">Blocco</th>
                  <th className="pb-2 pr-4 font-semibold text-gray-600">Voce</th>
                  <th className="pb-2 pr-4 font-semibold text-gray-600 text-right">Bilancio</th>
                  <th className="pb-2 pr-4 font-semibold text-gray-600 text-right">Gestionale CRM</th>
                  <th className="pb-2 pr-4 font-semibold text-gray-600 text-right">Scostamento</th>
                  <th className="pb-2 pr-4 font-semibold text-gray-600 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const p = n(r.scostamento_pct)
                  const assente = n(r.importo_gestionale) == null
                  return (
                    // Chiave stabile: anno + voce_key identificano univocamente la riga.
                    <tr key={`${r.anno}|${r.voce_key}`}
                      className={`border-b border-gray-50 hover:bg-gray-50 ${p != null && Math.abs(p) > 15 ? 'bg-red-50/40' : ''}`}>
                      <td className="py-2 pr-4">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium whitespace-nowrap">
                          {r.blocco}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-gray-700">
                        {r.etichetta}
                        <span className="block text-xs text-gray-400 mt-0.5">
                          {assente ? <span className="inline-flex items-center gap-1"><MinusCircle size={11}/>{r.fonte_gestionale}</span> : r.fonte_gestionale}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right text-gray-700 whitespace-nowrap">{eur(r.importo_bilancio)}</td>
                      <td className="py-2 pr-4 text-right text-gray-700 whitespace-nowrap">
                        {assente ? <span className="text-gray-300">n.d.</span> : eur(r.importo_gestionale)}
                      </td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">
                        {n(r.scostamento) == null ? <span className="text-gray-300">—</span> : (
                          <span className={`font-semibold ${p != null && Math.abs(p) > 15 ? 'text-red-600' : 'text-gray-700'}`}>
                            {n(r.scostamento) >= 0 ? '+' : ''}{eur(r.scostamento)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {p == null ? <span className="text-gray-300">—</span> : (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                            Math.abs(p) > 15 ? 'bg-red-100 text-red-700'
                              : Math.abs(p) > 5 ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-green-100 text-green-700'
                          }`}>
                            {p >= 0 ? '+' : ''}{p.toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <p className="text-xs text-gray-400 -mt-2 mb-6">
        Soglie: verde entro ±5%, giallo entro ±15%, rosso oltre. Segno positivo = il gestionale
        registra più del bilancio.
      </p>
    </>
  )
}

// ── Sezione: Indici ────────────────────────────────────────────────────────
function Indici({ kpi }) {
  const righe = useMemo(() => [...kpi].sort((a, b) => (a.anno ?? 0) - (b.anno ?? 0)), [kpi])
  const ultimo = righe[righe.length - 1]

  const chart = useMemo(() => righe.map(k => ({
    anno: String(k.anno),
    'Food cost %': n(k.food_cost_pct),
    'Labour cost %': n(k.labour_cost_pct),
    'Prime cost %': n(k.prime_cost_pct),
    'EBITDA %': n(k.ebitda_pct),
  })), [righe])

  if (!righe.length) {
    return (
      <Card title="Indici essenziali" icon={Percent}>
        <Vuoto messaggio="La vista degli indici non contiene righe."/>
      </Card>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard icon={Percent} label="Margine operativo (EBITDA)"
          color={n(ultimo?.ebitda_pct) == null ? 'gray' : n(ultimo.ebitda_pct) >= 8 ? 'green' : n(ultimo.ebitda_pct) >= 4 ? 'yellow' : 'red'}
          value={pct(ultimo?.ebitda_pct)}
          sub={`${eur(ultimo?.ebitda)} · esercizio ${ultimo?.anno}`}/>
        <KpiCard icon={Percent} label="Incidenza personale"
          color={n(ultimo?.labour_cost_pct) == null ? 'gray' : n(ultimo.labour_cost_pct) > 45 ? 'red' : n(ultimo.labour_cost_pct) > 38 ? 'yellow' : 'green'}
          value={pct(ultimo?.labour_cost_pct)}
          sub={`${eur(ultimo?.personale)} · soglia 45%`}/>
        <KpiCard icon={Percent} label="Food cost"
          color={n(ultimo?.food_cost_pct) == null ? 'gray' : n(ultimo.food_cost_pct) > 35 ? 'red' : n(ultimo.food_cost_pct) > 30 ? 'yellow' : 'green'}
          value={pct(ultimo?.food_cost_pct)}
          sub={`${eur(ultimo?.costo_del_venduto)} · soglia 35%`}/>
        <KpiCard icon={Percent} label="Prime cost"
          color={n(ultimo?.prime_cost_pct) == null ? 'gray' : n(ultimo.prime_cost_pct) > 70 ? 'red' : 'green'}
          value={pct(ultimo?.prime_cost_pct)}
          sub="food + labour · soglia 70%"/>
      </div>

      {n(ultimo?.ebitda_pct) != null && n(ultimo?.ebitda_ricorrente_pct) != null
        && Math.abs(n(ultimo.ebitda_pct) - n(ultimo.ebitda_ricorrente_pct)) > 0.5 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-500 mt-0.5 flex-shrink-0"/>
          <div className="text-sm text-amber-800">
            <p className="font-semibold mb-1">L'EBITDA {ultimo.anno} è gonfiato da poste non ricorrenti</p>
            <p className="opacity-90">
              EBITDA contabile {pct(ultimo.ebitda_pct)} ({eur(ultimo.ebitda)}), ma al netto delle
              sopravvenienze attive ({eur(ultimo.sopravvenienze_attive)}) l'EBITDA
              <strong> ricorrente</strong> scende a {pct(ultimo.ebitda_ricorrente_pct)} ({eur(ultimo.ebitda_ricorrente)}).
              È quest'ultimo il dato da usare per valutare la gestione.
            </p>
          </div>
        </div>
      )}

      <Card title="Andamento degli indici" icon={TrendingUp}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chart} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
            <XAxis dataKey="anno" fontSize={11}/>
            <YAxis fontSize={11} tickFormatter={v => `${v}%`}/>
            <Tooltip formatter={v => (v == null ? '—' : `${Number(v).toFixed(1)}%`)}/>
            <Legend/>
            <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 3"
              label={{ value: '70% prime cost', fontSize: 10, fill: '#ef4444', position: 'insideTopRight' }}/>
            <ReferenceLine y={0} stroke="#9ca3af"/>
            <Line type="monotone" dataKey="Food cost %"   stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} connectNulls/>
            <Line type="monotone" dataKey="Labour cost %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} connectNulls/>
            <Line type="monotone" dataKey="Prime cost %"  stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} connectNulls/>
            <Line type="monotone" dataKey="EBITDA %"      stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} connectNulls/>
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Dettaglio per esercizio" icon={Percent}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="pb-2 pr-4 font-semibold text-gray-600">Anno</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600">Tipo</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600 text-right">Ricavi</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600 text-right">Food cost</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600 text-right">Labour cost</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600 text-right">Prime cost</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600 text-right">EBITDA</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600 text-right">EBITDA ric.</th>
                <th className="pb-2 pr-4 font-semibold text-gray-600 text-right">Risultato</th>
              </tr>
            </thead>
            <tbody>
              {righe.map(k => (
                <tr key={`${k.anno}-${k.tipo}`} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 pr-4 font-medium text-gray-800">{k.anno}</td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      k.tipo === 'definitivo' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>{k.tipo || '—'}</span>
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-700">{eur(k.ricavi_caratteristici)}</td>
                  <td className="py-2 pr-4 text-right">
                    <span className={`font-semibold ${n(k.food_cost_pct) > 35 ? 'text-red-600' : n(k.food_cost_pct) > 30 ? 'text-orange-500' : 'text-green-600'}`}>
                      {pct(k.food_cost_pct)}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <span className={`font-semibold ${n(k.labour_cost_pct) > 45 ? 'text-red-600' : n(k.labour_cost_pct) > 38 ? 'text-orange-500' : 'text-green-600'}`}>
                      {pct(k.labour_cost_pct)}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <span className={`font-semibold ${n(k.prime_cost_pct) > 70 ? 'text-red-600' : 'text-green-600'}`}>
                      {pct(k.prime_cost_pct)}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-700">{eur(k.ebitda)} <span className="text-xs text-gray-400">({pct(k.ebitda_pct)})</span></td>
                  <td className="py-2 pr-4 text-right text-gray-700">{eur(k.ebitda_ricorrente)} <span className="text-xs text-gray-400">({pct(k.ebitda_ricorrente_pct)})</span></td>
                  <td className="py-2 pr-4 text-right">
                    <span className={`font-semibold ${n(k.risultato) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {eur(k.risultato)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          <strong>Prime cost</strong> = food cost + labour cost: sotto il 70% dei ricavi è considerato
          sano nella ristorazione. <strong>EBITDA ricorrente</strong> esclude le poste straordinarie
          (sopravvenienze) e misura la redditività della sola gestione corrente.
        </p>
      </Card>
    </>
  )
}
