/**
 * KPIConfig.jsx — Configurazione KPI, BE, Target team/individuali/prodotti, Performance
 * 5 tab: Costi Fissi · BE & Target Team · Target Individuali · Target Prodotti · Performance
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  fattureCategorieApi, costiFissiApi, standardNazionaliApi,
  kpiTargetsApi, kpiPerformanceApi,
  calcBonusTeam, calcBonusIndividuale,
  employees as employeesApi,
  sediApi,
} from '../api/supabase-client'
import useClaudeAI from '../hooks/useClaudeAI'

// Periodo di calcolo del quantum (base) per i target individuali
const PERIOD_OPTS = [
  { value: 'media',      label: 'Media ultimi N mesi' },
  { value: 'anno',       label: 'Media anno in corso' },
  { value: 'stagionale', label: 'Stagionale (stesso mese anno prec.)' },
  { value: 'max',        label: 'MAX(media, stagionale)' },
]
const METRICA_BASE_OPTS = [
  { value: 'FATTURATO_VENDUTO', label: 'Fatturato €' },
  { value: 'PEZZI_TOTALI',      label: 'Pezzi' },
]

const TABS = [
  { id: 'costi',        label: 'Costi Fissi',       icon: '🏠' },
  { id: 'team',         label: 'BE & Target Team',  icon: '🎯' },
  { id: 'individuali',  label: 'Target Individuali',icon: '👤' },
  { id: 'prodotti',     label: 'Target Prodotti',   icon: '🍝' },
  { id: 'performance',  label: 'Performance Live',  icon: '📊' },
  { id: 'standard',     label: 'Standard Naz.',     icon: '📐' },
]

const SEDI_UI = [
  { code: 'MA', label: 'Sede MA' },
  { code: 'PN', label: 'Sede PN' },
]

function euro(n) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n) || 0)
}
function pct(n, den) {
  if (!den) return '—'
  return `${((Number(n) || 0) / den * 100).toFixed(1)}%`
}

const NMESI_OPTS = [
  { value: 1, label: '1 mese' },
  { value: 2, label: 'Media 2 mesi' },
  { value: 3, label: 'Media 3 mesi' },
  { value: 6, label: 'Media 6 mesi' },
]

export default function KPIConfig() {
  const [tab, setTab]       = useState('costi')
  const today               = new Date()
  const [sede, setSede]     = useState('MA')
  const [anno, setAnno]     = useState(today.getFullYear())
  const [mese, setMese]     = useState(today.getMonth() + 1)
  const [nMesi, setNMesi]   = useState(3)
  const [refresh, setRefresh] = useState(0)

  // Reactivity: ricarica se altre pagine cambiano dati KPI
  useEffect(() => {
    const onStorage = (e) => { if (e.key === 'crm_kpi_updated') setRefresh(r => r + 1) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">KPI Config</h1>
        <p className="text-gray-500 text-sm">Break-even, target di vendita, bonus team e individuali — dati in tempo reale</p>
      </header>

      {/* Controlli globali: sede + periodo */}
      <div className="flex flex-wrap items-end gap-3 mb-4 p-4 bg-gray-50 rounded-lg border">
        <Field label="Sede">
          <select className="input" value={sede} onChange={e => setSede(e.target.value)}>
            {SEDI_UI.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Anno">
          <input type="number" className="input w-24" value={anno} onChange={e => setAnno(parseInt(e.target.value) || today.getFullYear())} />
        </Field>
        <Field label="Mese">
          <select className="input w-28" value={mese} onChange={e => setMese(parseInt(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m =>
              <option key={m} value={m}>{new Date(2000, m - 1).toLocaleString('it', { month: 'long' })}</option>
            )}
          </select>
        </Field>
        <Field label="Analisi vs">
          <select className="input w-36" value={nMesi} onChange={e => setNMesi(parseInt(e.target.value))}>
            {NMESI_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <div className="ml-auto flex gap-2">
          <button className="btn btn-ghost text-sm" onClick={() => setRefresh(r => r + 1)}>🔄 Aggiorna</button>
        </div>
      </div>

      {/* Tab bar */}
      <nav className="flex gap-1 border-b mb-4 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 ${tab === t.id ? 'border-indigo-600 text-indigo-700 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      {tab === 'costi'       && <TabCostiFissi sede={sede} anno={anno} mese={mese} refresh={refresh} />}
      {tab === 'team'        && <TabTeamTarget sede={sede} anno={anno} mese={mese} nMesi={nMesi} refresh={refresh} />}
      {tab === 'individuali' && <TabIndividuali sede={sede} anno={anno} mese={mese} nMesi={nMesi} refresh={refresh} />}
      {tab === 'prodotti'    && <TabProdotti sede={sede} anno={anno} mese={mese} refresh={refresh} />}
      {tab === 'performance' && <TabPerformance sede={sede} anno={anno} mese={mese} refresh={refresh} />}
      {tab === 'standard'    && <TabStandardNazionali refresh={refresh} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1 — Costi Fissi (affitti, consulenze, oneri non fatturati)
// ═══════════════════════════════════════════════════════════════════════════
function TabCostiFissi({ sede, anno, mese, refresh }) {
  const [costi, setCosti]             = useState([])
  const [categorie, setCategorie]     = useState([])
  const [loading, setLoading]         = useState(true)
  const [showAdd, setShowAdd]         = useState(false)
  const [msg, setMsg]                 = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const [c, cat] = await Promise.all([
        costiFissiApi.list({ sede, anno, mese }),
        fattureCategorieApi.list(),
      ])
      setCosti(c); setCategorie(cat)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [sede, anno, mese, refresh])

  const totale = costi.reduce((s, c) => s + (parseFloat(c.importo) || 0), 0)

  const duplicaDaPrecedente = async () => {
    if (!confirm('Duplicare i costi ricorrenti del mese precedente in questo mese?')) return
    const { duplicati } = await costiFissiApi.duplicaDaMesePrecedente({ sede, anno, mese })
    setMsg(duplicati > 0 ? `✓ Duplicati ${duplicati} costi dal mese precedente` : 'Nessun costo ricorrente nel mese precedente')
    load()
  }

  const remove = async (id) => {
    if (!confirm('Eliminare questo costo?')) return
    await costiFissiApi.delete(id)
    load()
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Costi Fissi — {sede} {String(mese).padStart(2, '0')}/{anno}</h2>
          <p className="text-sm text-gray-500">Affitto, consulenze, oneri manuali. Utenze e food cost arrivano dalle fatture categorizzate.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary text-sm" onClick={duplicaDaPrecedente}>📋 Da mese precedente</button>
          <button className="btn btn-primary text-sm" onClick={() => setShowAdd(true)}>+ Nuovo Costo</button>
        </div>
      </div>

      {msg && <div className="p-3 bg-blue-50 text-blue-800 rounded text-sm">{msg}</div>}

      {loading ? <Spinner /> : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left p-2">Descrizione</th>
                  <th className="text-left p-2">Categoria</th>
                  <th className="text-right p-2">Importo</th>
                  <th className="text-center p-2">Ricorrente</th>
                  <th className="text-left p-2">Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {costi.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">Nessun costo fisso per questo mese</td></tr>}
                {costi.map(c => (
                  <tr key={c.id} className="border-b hover:bg-gray-50">
                    <td className="p-2 font-medium">{c.descrizione}</td>
                    <td className="p-2 text-gray-600">{c.fattura_categorie?.nome || '—'}</td>
                    <td className="p-2 text-right font-mono">{euro(c.importo)}</td>
                    <td className="p-2 text-center">{c.ricorrente ? '🔁' : '—'}</td>
                    <td className="p-2 text-gray-500 text-xs">{c.note || ''}</td>
                    <td className="p-2 text-right">
                      <button className="text-red-600 text-xs hover:underline" onClick={() => remove(c.id)}>Elimina</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className="p-2" colSpan={2}>Totale costi fissi</td>
                  <td className="p-2 text-right font-mono">{euro(totale)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {showAdd && (
        <CostoFissoForm
          sede={sede} anno={anno} mese={mese}
          categorie={categorie}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load() }}
        />
      )}
    </section>
  )
}

function CostoFissoForm({ sede, anno, mese, categorie, onClose, onSaved }) {
  const [form, setForm] = useState({
    descrizione: '', importo: '', categoria_id: '',
    ricorrente: true, note: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const save = async () => {
    if (!form.descrizione || !form.importo) { setErr('Descrizione e importo obbligatori'); return }
    setSaving(true); setErr(null)
    try {
      await costiFissiApi.create({ sede, anno, mese, ...form })
      onSaved()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <Modal onClose={onClose} title="Nuovo Costo Fisso">
      {err && <div className="p-2 bg-red-50 text-red-700 rounded text-sm mb-3">{err}</div>}
      <div className="space-y-3">
        <Field label="Descrizione *">
          <input className="input w-full" value={form.descrizione} onChange={e => setForm(f => ({ ...f, descrizione: e.target.value }))} placeholder="es. Affitto Maggio" />
        </Field>
        <Field label="Categoria">
          <select className="input w-full" value={form.categoria_id} onChange={e => setForm(f => ({ ...f, categoria_id: e.target.value }))}>
            <option value="">— seleziona —</option>
            {categorie.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Field>
        <Field label="Importo € *">
          <input type="number" step="0.01" className="input w-full" value={form.importo} onChange={e => setForm(f => ({ ...f, importo: e.target.value }))} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.ricorrente} onChange={e => setForm(f => ({ ...f, ricorrente: e.target.checked }))} />
          Ricorrente (duplicabile in mesi successivi)
        </label>
        <Field label="Note">
          <textarea className="input w-full" rows={2} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn btn-ghost" onClick={onClose}>Annulla</button>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvo...' : 'Salva'}</button>
      </div>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 2 — BE & Target Team
// ═══════════════════════════════════════════════════════════════════════════
function TabTeamTarget({ sede, anno, mese, nMesi = 3, refresh }) {
  const [costi, setCosti]           = useState(null)
  const [target, setTarget]         = useState(null)
  const [quorum, setQuorum]         = useState(0)
  const [annoPrec, setAnnoPrec]     = useState(0)
  const [copertoMedio, setCopertoMedio] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const [c, t, q, ap, cm] = await Promise.all([
        kpiPerformanceApi.getCosti({ sede, anno, mese }),
        kpiTargetsApi.getTeam({ sede, anno, mese }),
        kpiPerformanceApi.getQuorum({ sede, anno, mese, mesiLookback: nMesi }),
        kpiPerformanceApi.getStessoMeseAnnoPrec({ sede, anno, mese }),
        kpiPerformanceApi.getCopertoMedio({ sede, anno, mese }),
      ])
      setCosti(c); setQuorum(q); setAnnoPrec(ap); setCopertoMedio(cm)
      const beCalc = Number(c.be_totale) || 0
      // Usa il quorum appena caricato (q), non lo stato 'quorum' che è ancora stale in questo render
      const targetSuggerito = Math.max(beCalc * 1.10, Math.max(ap || 0, q || 0))
      // Il BE è SEMPRE quello live da v_costi_mensili (personale+fatture+fissi):
      // anche con un target salvato, sovrascrivo be_totale col valore aggiornato,
      // così non resta congelato a una vecchia istantanea (es. fatture non ancora importate).
      setTarget(t
        ? { ...t, be_totale: beCalc }
        : {
            be_totale: beCalc,
            target_fatturato: Math.round(targetSuggerito),
            premio_team_euro: 0,
            pct_cucina: 50, pct_sala: 50,
            coeff_stagionale: 1.0,
            note: '',
          })
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [sede, anno, mese, nMesi, refresh])

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      await kpiTargetsApi.upsertTeam({ sede, anno, mese, ...target })
      load()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  if (loading || !target || !costi) return <Spinner />

  const beCalc = Number(costi.be_totale) || 0
  const quorumLabel = nMesi === 1 ? 'Mese prec.' : `Media ${nMesi}m`
  const targetDisplay = Number(target.target_fatturato) || 0
  const premio = Number(target.premio_team_euro) || 0
  const mesiLabel = new Date(2000, mese - 1).toLocaleString('it', { month: 'long' })

  // Volume BE: quanti coperti minimi servono
  // Usa il coperto medio reale da chiusure_giornaliere (weighted avg venduto/coperti)
  const copertoRef = copertoMedio || 50 // fallback €50 se nessun dato chiusure
  const copertoStima = !copertoMedio   // true = stiamo usando il fallback
  const giorniMese = new Date(anno, mese, 0).getDate() // giorni reali del mese
  const copertiMinBE = beCalc > 0 ? Math.ceil(beCalc / copertoRef) : 0
  const copertiMinTarget = beCalc > 0 ? Math.ceil(beCalc * 1.10 / copertoRef) : 0

  return (
    <section className="space-y-6">
      {/* Warning se buste paga mancanti */}
      {Number(costi.costo_personale) === 0 && (
        <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex gap-2 text-sm">
          <span>⚠️</span>
          <div>
            <b>Buste paga non importate per {mesiLabel} {anno}</b> — il costo personale risulta €0.
            Importa i cedolini nella sezione <em>Buste Paga</em> per avere il BE corretto.
            Stima approssimativa basata su gen 2026: <b>~€53K MA / ~€40K PN</b>.
          </div>
        </div>
      )}

      {/* Riepilogo costi mensili con note fonte */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Costo Personale"
          value={euro(costi.costo_personale)}
          hint={`${pct(costi.costo_personale, beCalc)} del BE`}
          note="Fonte: buste_paga.costo_azienda (se null → netto × 1.9653 CCNL)"
        />
        <KpiCard
          label="Fatture Acquisto"
          value={euro(costi.costo_fatture)}
          hint={`${pct(costi.costo_fatture, beCalc)} del BE`}
          note="Fonte: fatture_importate × allocazione % (sede_ma_pct / sede_pn_pct)"
        />
        <KpiCard
          label="Costi Fissi"
          value={euro(costi.costo_fissi)}
          hint={`${pct(costi.costo_fissi, beCalc)} del BE`}
          note="Fonte: tabella costi_fissi (affitto, consulenze, manuali)"
        />
        <KpiCard label="BE Totale" value={euro(beCalc)} color="border-red-500" highlight
          note="BE = Personale + Fatture + Fissi. Fonte: vista v_costi_mensili"
        />
      </div>

      {/* Volume BE */}
      {beCalc > 0 && (
        <div className="p-4 bg-gray-50 border rounded-lg">
          <div className="text-sm font-semibold text-gray-700 mb-2">📐 Volume minimo per raggiungere il BE</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="bg-white border rounded p-3 text-center">
              <div className="text-xs text-gray-500">Coperti minimi/mese</div>
              <div className="text-2xl font-bold text-red-600">{copertiMinBE.toLocaleString('it')}</div>
              <div className="text-xs text-gray-400">
                @ {euro(copertoRef)}/cop.{copertoStima ? ' (stima)' : ' reale'}
              </div>
              <div className="text-xs text-gray-400">≈ {Math.ceil(copertiMinBE / giorniMese)}/giorno</div>
            </div>
            <div className="bg-white border rounded p-3 text-center">
              <div className="text-xs text-gray-500">Fatturato/giorno ({giorniMese}gg)</div>
              <div className="text-2xl font-bold text-orange-600">{euro(beCalc / giorniMese)}</div>
              <div className="text-xs text-gray-400">per coprire BE mensile</div>
            </div>
            <div className="bg-white border rounded p-3 text-center">
              <div className="text-xs text-gray-500">Con target +10% ({copertiMinTarget.toLocaleString('it')} cop.)</div>
              <div className="text-2xl font-bold text-indigo-600">{euro(beCalc * 1.10)}</div>
              <div className="text-xs text-gray-400">≈ {Math.ceil(copertiMinTarget / giorniMese)}/giorno</div>
            </div>
            <div className="bg-white border rounded p-3 text-center">
              <div className="text-xs text-gray-500">Quorum ({quorumLabel})</div>
              <div className={`text-2xl font-bold ${quorum >= beCalc ? 'text-green-600' : 'text-red-600'}`}>{euro(quorum)}</div>
              <div className="text-xs text-gray-400">{quorum >= beCalc ? '✅ sopra BE' : '⚠️ sotto BE'}</div>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            💡 <b>Come si legge:</b> con {euro(beCalc / giorniMese)}/giorno copri solo i costi — ogni euro in più è utile.
            Coperto medio {copertoStima ? '(stima fallback)' : 'reale da chiusure'}: <b>{euro(copertoRef)}</b>.
            Lo stesso mese {anno-1}: <b>{euro(annoPrec)}</b> {annoPrec >= beCalc ? '✅ sopra BE' : '⚠️ sotto BE'}.
          </p>
        </div>
      )}

      {/* Suggerimenti */}
      <div className="p-4 bg-indigo-50 border-l-4 border-indigo-400 rounded">
        <div className="text-sm font-semibold text-indigo-900">📊 Suggerimenti automatici — {mesiLabel} {anno}</div>
        <div className="text-sm text-indigo-800 mt-1 space-y-1">
          <div>Quorum ({quorumLabel} da chiusure): <b>{euro(quorum)}</b></div>
          <div>Stesso mese anno scorso ({mesiLabel} {anno-1}): <b>{euro(annoPrec)}</b></div>
          <div>Target minimo consigliato <b>(BE × 1.10)</b>: <b>{euro(beCalc * 1.10)}</b></div>
          <div className="text-xs text-indigo-600 pt-1">
            ℹ️ Il target non dovrebbe mai scendere sotto il BE × 1.10 per garantire un margine di sicurezza.
            Usa il massimo tra Quorum e Anno precedente come riferimento storico.
          </div>
        </div>
      </div>

      {/* Form target */}
      <div className="p-5 bg-white border rounded-lg">
        <h3 className="font-semibold mb-4">Target Mensile Team</h3>
        {err && <div className="p-2 bg-red-50 text-red-700 rounded text-sm mb-3">{err}</div>}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="BE Totale (auto)">
            <input type="number" className="input w-full bg-gray-100" value={target.be_totale} readOnly />
          </Field>
          <Field label="Target Fatturato €">
            <input type="number" className="input w-full" value={target.target_fatturato} onChange={e => setTarget(t => ({ ...t, target_fatturato: parseFloat(e.target.value) || 0 }))} />
          </Field>
          <Field label="Premio Team €">
            <input type="number" className="input w-full" value={target.premio_team_euro} onChange={e => setTarget(t => ({ ...t, premio_team_euro: parseFloat(e.target.value) || 0 }))} />
          </Field>
          <Field label="% Cucina">
            <input type="number" step="0.5" className="input w-full" value={target.pct_cucina} onChange={e => setTarget(t => ({ ...t, pct_cucina: parseFloat(e.target.value) || 0, pct_sala: 100 - (parseFloat(e.target.value) || 0) }))} />
          </Field>
          <Field label="% Sala">
            <input type="number" step="0.5" className="input w-full" value={target.pct_sala} onChange={e => setTarget(t => ({ ...t, pct_sala: parseFloat(e.target.value) || 0, pct_cucina: 100 - (parseFloat(e.target.value) || 0) }))} />
          </Field>
          <Field label="Coeff. Stagionale">
            <input type="number" step="0.05" className="input w-full" value={target.coeff_stagionale} onChange={e => setTarget(t => ({ ...t, coeff_stagionale: parseFloat(e.target.value) || 1 }))} />
          </Field>
          <Field label="Note" wide>
            <textarea className="input w-full" rows={2} value={target.note || ''} onChange={e => setTarget(t => ({ ...t, note: e.target.value }))} />
          </Field>
        </div>
        <div className="flex justify-end mt-4">
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvo...' : '💾 Salva target'}</button>
        </div>
      </div>

      {/* Simulatore bonus */}
      <BonusSimulator be={beCalc} target={targetDisplay} premio={premio} />
    </section>
  )
}

function BonusSimulator({ be, target, premio }) {
  const [fatturato, setFatturato] = useState(be)
  useEffect(() => { setFatturato(be) }, [be])
  const bonus = calcBonusTeam(fatturato, be, target, premio)
  const pctRaggiunto = target > 0 ? Math.min(fatturato / target, 1.5) * 100 : 0

  return (
    <div className="p-5 bg-white border rounded-lg">
      <h3 className="font-semibold mb-2">Simulatore Bonus Team</h3>
      <p className="text-xs text-gray-500 mb-3">Bonus progressivo: 50% del premio a BE raggiunto · 100% a target · 150% oltre</p>
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <input type="range" className="w-full"
            min={0} max={target * 1.5} step={100}
            value={fatturato} onChange={e => setFatturato(parseFloat(e.target.value))} />
          <div className="text-sm text-gray-600 mt-1">Fatturato simulato: <b>{euro(fatturato)}</b> ({pctRaggiunto.toFixed(1)}% del target)</div>
        </div>
        <div className="text-right min-w-[140px]">
          <div className="text-xs text-gray-500">Bonus distribuibile</div>
          <div className="text-2xl font-bold text-green-600">{euro(bonus)}</div>
        </div>
      </div>
      <div className="mt-3 h-3 bg-gray-100 rounded overflow-hidden">
        <div className="h-full bg-gradient-to-r from-red-400 via-yellow-400 to-green-500 transition-all" style={{ width: `${Math.min(pctRaggiunto, 150)}%`, maxWidth: '100%' }}></div>
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-1">
        <span>0</span>
        <span>BE ({euro(be)})</span>
        <span>Target ({euro(target)})</span>
        <span>+50%</span>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 3 — Target Individuali
// ═══════════════════════════════════════════════════════════════════════════
function TabIndividuali({ sede, anno, mese, nMesi = 3, refresh }) {
  const [emps, setEmps]           = useState([])
  const [targets, setTargets]     = useState({})
  const [perf, setPerf]           = useState({})
  const [storicoMap, setStoricoMap] = useState({})
  const [loading, setLoading]     = useState(true)
  const [generando, setGenerando] = useState(false)
  const [err, setErr]             = useState(null)
  const [msg, setMsg]             = useState(null)
  const [expandedEmp, setExpandedEmp] = useState(null)
  const [mappedIds, setMappedIds] = useState(new Set())
  const [soloSala, setSoloSala]   = useState(true)
  const [prevPerf, setPrevPerf]   = useState({})
  const [periodMode, setPeriodMode] = useState('media')
  const [baseMetrica, setBaseMetrica] = useState('FATTURATO_VENDUTO')
  const [fatAttuale, setFatAttuale] = useState({})
  const [claudeOut, setClaudeOut]   = useState(null)
  const [claudeLoading, setClaudeLoading] = useState(false)
  const { callClaude } = useClaudeAI()

  const load = async () => {
    setLoading(true)
    try {
      const prevMese = mese === 1 ? 12 : mese - 1
      const prevAnno = mese === 1 ? anno - 1 : anno
      const [e, t, p, mapping, pp, fa] = await Promise.all([
        employeesApi.getAll({ location: sede === 'MA' ? 'MAMELI' : 'PREDDA_NIEDDA', active: 'true' }),
        kpiTargetsApi.listIndividuale({ sede, anno, mese }),
        kpiPerformanceApi.getIndividuale({ sede, anno, mese }),
        kpiPerformanceApi.getMappingBySede({ sede }),
        kpiPerformanceApi.getIndividuale({ sede, anno: prevAnno, mese: prevMese }),
        kpiPerformanceApi.getFatturatoMensile({ sede, anno, mese }),
      ])
      setEmps(e)
      const tMap = {}; for (const x of t) tMap[x.employee_id] = x
      setTargets(tMap)
      const pMap = {}; for (const x of p) if (x.employee_id) pMap[x.employee_id] = x
      setPerf(pMap)
      setMappedIds(new Set((mapping || []).map(m => m.employee_id)))
      const ppMap = {}; for (const x of pp) if (x.employee_id) ppMap[x.employee_id] = x
      setPrevPerf(ppMap)
      setFatAttuale(fa || {})
    } catch (er) { setErr(er.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [sede, anno, mese, nMesi, refresh])

  // Valore "attuale" reale in base alla metrica del target
  const attualeOf = (empId, metrica) => {
    if (metrica === 'FATTURATO_VENDUTO') return fatAttuale[empId]?.fatturato ?? null
    const p = perf[empId] || {}
    return metrica === 'VALORE_VARIANTI' ? p.valore_varianti_netto : p.pezzi_totali
  }

  const updateField = (empId, field, value) => {
    setTargets(prev => {
      const curr = prev[empId] || { employee_id: empId, sede, anno, mese, metrica: 'PEZZI_TOTALI', quantum: 0, target: 0, premio_max_euro: 0 }
      const updated = { ...curr, [field]: value }
      if (field === 'quantum' && !updated._target_manual) updated.target = Math.round((parseFloat(value) || 0) * 1.10)
      return { ...prev, [empId]: updated }
    })
  }

  const saveRow = async (empId) => {
    const t = targets[empId]
    if (!t) return
    try {
      await kpiTargetsApi.upsertIndividuale({ ...t, employee_id: empId, sede, anno, mese })
      setMsg(`✓ Target salvato`)
      setTimeout(() => setMsg(null), 2000)
      load()
    } catch (e) { alert(e.message) }
  }

  const salvaTutti = async () => {
    const empIds = Object.keys(targets).filter(id => (targets[id].quantum > 0 || targets[id].target > 0))
    if (!empIds.length) { alert('Genera prima i target con il pulsante Auto-genera'); return }
    setGenerando(true)
    try {
      await Promise.all(empIds.map(id =>
        kpiTargetsApi.upsertIndividuale({ ...targets[id], employee_id: id, sede, anno, mese })
      ))
      setMsg(`✓ Salvati ${empIds.length} target`)
      setTimeout(() => setMsg(null), 3000)
      load()
    } catch (e) { setErr(e.message) } finally { setGenerando(false) }
  }

  // ─── AUTO-GENERA tutti i target dalla formula storica ─────────────────────
  // Formula: Quantum = MAX(media ultimi 3m, stesso mese anno prec)
  //          Target  = Quantum × 1.10
  // Fonte dati: v_fatturato_operatore_mensile via employee_operator_mapping
  const autoGeneraTutti = async () => {
    setGenerando(true); setMsg(null); setErr(null)
    try {
      const results = await kpiPerformanceApi.autoTargetAllOperatori({ sede, anno, mese, mesiLookback: nMesi, periodMode })
      const isFat = baseMetrica === 'FATTURATO_VENDUTO'
      const newStorico = {}
      const newTargets = { ...targets }
      let count = 0
      for (const r of results) {
        newStorico[r.employee_id] = r
        const q = isFat ? r.quantum_fat : r.quantum_pezzi
        const tg = isFat ? r.target_fat : r.target_pezzi
        if (q > 0) {
          const curr = newTargets[r.employee_id] || {
            employee_id: r.employee_id, sede, anno, mese, premio_max_euro: 0
          }
          newTargets[r.employee_id] = {
            ...curr,
            metrica: baseMetrica,
            quantum: q,
            target:  tg,
            mese_precedente_valore: parseFloat(r.storico[0]?.[isFat ? 'fatturato_totale' : 'pezzi_totali'] || 0),
          }
          count++
        }
      }
      setStoricoMap(newStorico)
      setTargets(newTargets)
      const fonte = results.find(r => r.baseFonte)?.baseFonte || periodMode
      const metricaLabel = isFat ? 'Fatturato €' : 'Pezzi'
      setMsg(`✓ Generati ${count} target (${metricaLabel}) — base: ${fonte} × 1.10. Verifica e salva.`)
    } catch (e) { setErr(e.message) } finally { setGenerando(false) }
  }

  // ─── Analisi strategica Claude su target + performance reale ──────────────
  const analizzaConClaude = async () => {
    setClaudeLoading(true); setClaudeOut(null); setErr(null)
    try {
      const lista = soloSala ? emps.filter(e => mappedIds.has(e.id)) : emps
      const righe = lista.map(emp => {
        const t = targets[emp.id] || {}
        const metrica = t.metrica || baseMetrica
        const att = attualeOf(emp.id, metrica)
        const q = parseFloat(t.quantum) || 0
        const tg = parseFloat(t.target) || 0
        const pct = q > 0 && att != null ? Math.round((att / q) * 100) : null
        return {
          nome: emp.name, metrica,
          quantum: q, target: tg,
          attuale: att != null ? Math.round(att) : null,
          pct_su_quantum: pct,
          mese_prec: t.mese_precedente_valore != null ? Math.round(t.mese_precedente_valore) : null,
          premio_max: parseFloat(t.premio_max_euro) || 0,
        }
      })
      const mesiLabel = new Date(2000, mese - 1).toLocaleString('it', { month: 'long' })
      const system = `Sei l'assistente strategico di 140 Grammi, ristorazione (sedi MA=Mameli Cagliari, PN=Predda Niedda Sassari). Analizzi target KPI individuali calcolati su dati reali Supabase. Rispondi in italiano, conciso e azionabile: 1) chi è sotto/sopra il quantum e di quanto, 2) se i target sono realistici vs stagionalità del mese, 3) suggerimenti su premi e priorità. Niente preamboli, vai dritto ai punti. Usa importi in €.`
      const user = `Sede ${sede} — ${mesiLabel} ${anno}. Metrica: ${baseMetrica === 'FATTURATO_VENDUTO' ? 'Fatturato €' : 'Pezzi'}. Periodo base quantum: ${PERIOD_OPTS.find(o => o.value === periodMode)?.label}.\nQuantum = soglia minima bonus, Target = obiettivo (+10%).\nDati operatori (JSON):\n${JSON.stringify(righe, null, 1)}\n\nFornisci: (a) sintesi 2 righe, (b) 3-5 azioni concrete per ${mesiLabel}, (c) eventuali target da rivedere.`
      const out = await callClaude([{ role: 'user', content: user }], system, { max_tokens: 1500 })
      setClaudeOut(out || 'Nessuna risposta.')
    } catch (e) { setErr('Claude: ' + e.message) } finally { setClaudeLoading(false) }
  }

  if (loading) return <Spinner />
  if (err) return <div className="p-3 bg-red-50 text-red-700 rounded">{err}</div>

  const mesiLabel = new Date(2000, mese - 1).toLocaleString('it', { month: 'long' })
  const empsFiltered = soloSala ? emps.filter(e => mappedIds.has(e.id)) : emps
  const hiddenCount  = emps.length - empsFiltered.length

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">Target Individuali — {sede} {String(mese).padStart(2,'0')}/{anno}</h2>
          <p className="text-sm text-gray-500 mt-1">
            Quantum = minimo per accedere al bonus · Target = obiettivo (+10%) · Bonus scala linearmente Quantum→Target.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <label className="text-xs text-gray-500 flex flex-col">
            Periodo base
            <select className="input input-xs text-xs" value={periodMode} onChange={e => setPeriodMode(e.target.value)} title="Su quale storico calcolare il quantum">
              {PERIOD_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500 flex flex-col">
            Metrica
            <select className="input input-xs text-xs" value={baseMetrica} onChange={e => setBaseMetrica(e.target.value)} title="Metrica su cui impostare i target">
              {METRICA_BASE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <button
            className={`btn text-sm ${soloSala ? 'btn-secondary' : 'btn-outline'}`}
            onClick={() => setSoloSala(v => !v)}
            title={soloSala ? `Mostra tutti i ${emps.length} dipendenti (inclusi cucina/admin)` : 'Mostra solo staff sala con mapping operatore iPratico'}
          >
            {soloSala ? `🍽️ Solo sala (${empsFiltered.length})` : `👥 Tutti (${emps.length})`}
          </button>
          <button
            className="btn btn-secondary text-sm"
            onClick={autoGeneraTutti}
            disabled={generando}
            title="Calcola automaticamente Quantum e Target da storico reale Supabase"
          >
            {generando ? '⏳ Calcolo...' : '🤖 Auto-genera da storico'}
          </button>
          <button
            className="btn btn-primary text-sm"
            onClick={salvaTutti}
            disabled={generando}
          >
            💾 Salva tutti
          </button>
          <button
            className="btn btn-outline text-sm"
            onClick={analizzaConClaude}
            disabled={claudeLoading || generando}
            title="Analisi strategica dei target con Claude AI su dati reali"
          >
            {claudeLoading ? '⏳ Analizzo...' : '🧠 Analisi Claude'}
          </button>
        </div>
      </div>
      {soloSala && hiddenCount > 0 && (
        <div className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded px-3 py-2">
          ℹ️ {hiddenCount} dipendenti nascosti (cucina/admin senza mapping operatore iPratico) · Clicca <b>👥 Tutti</b> per vederli.
        </div>
      )}

      {/* Nota formula */}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
        <b>ℹ️ Formula Auto-genera:</b> per ogni operatore legge <code>v_fatturato_operatore_mensile</code>
        → calcola <b>{nMesi === 1 ? 'mese precedente' : `media ultimi ${nMesi} mesi`}</b> e <b>stesso mese {anno-1}</b>
        → usa il <b>MAX dei due</b> come Quantum → Target = Quantum × 1.10.<br/>
        Cambia la finestra da <b>Analisi vs</b> nei filtri in alto per usare 1/2/3/6 mesi.
        Link operatore→dipendente tramite tabella <code>employee_operator_mapping</code>.
        Premi ▼ su una riga per vedere il dettaglio storico.
      </div>

      {msg && <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">{msg}</div>}

      {(claudeLoading || claudeOut) && (
        <div className="p-4 bg-violet-50 border border-violet-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-violet-800">🧠 Analisi strategica Claude</h3>
            {claudeOut && <button className="text-xs text-violet-500 hover:text-violet-800" onClick={() => setClaudeOut(null)}>✕ chiudi</button>}
          </div>
          {claudeLoading
            ? <p className="text-sm text-violet-600 animate-pulse">Analisi dei target su dati reali in corso…</p>
            : <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{claudeOut}</div>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left p-2 w-6"></th>
              <th className="text-left p-2">Dipendente</th>
              <th className="text-left p-2">Metrica</th>
              <th className="text-right p-2">{nMesi === 1 ? 'Mese prec.' : `Media ${nMesi}m`}</th>
              <th className="text-right p-2 text-indigo-700">Quantum</th>
              <th className="text-right p-2 text-indigo-700">Target×1.10</th>
              <th className="text-right p-2">Premio Max €</th>
              <th className="text-right p-2">Attuale</th>
              <th className="text-right p-2">Bonus Stimato</th>
              <th className="text-center p-2">Fonte</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {empsFiltered.length === 0 && (
              <tr><td colSpan={11} className="p-6 text-center text-gray-400">Nessun dipendente {soloSala ? 'sala' : 'attivo'} in {sede}</td></tr>
            )}
            {empsFiltered.map(emp => {
              const t = targets[emp.id] || { quantum: 0, target: 0, premio_max_euro: 0, metrica: 'PEZZI_TOTALI' }
              const s = storicoMap[emp.id]
              const isFatRow = t.metrica === 'FATTURATO_VENDUTO'
              const attuale = attualeOf(emp.id, t.metrica)
              const fmtVal = (v) => v == null ? '—' : (isFatRow ? euro(v) : Math.round(v).toLocaleString('it'))
              const bonus = calcBonusIndividuale(
                parseFloat(attuale) || 0,
                parseFloat(t.quantum) || 0,
                parseFloat(t.target) || 0,
                parseFloat(t.premio_max_euro) || 0
              )
              const isExpanded = expandedEmp === emp.id
              return (
                <React.Fragment key={emp.id}>
                  <tr className={`border-b hover:bg-gray-50 ${isExpanded ? 'bg-indigo-50' : ''}`}>
                    <td className="p-2">
                      <button
                        className="text-gray-400 hover:text-indigo-600 text-xs"
                        onClick={() => setExpandedEmp(isExpanded ? null : emp.id)}
                        title="Mostra storico"
                      >
                        {isExpanded ? '▲' : '▼'}
                      </button>
                    </td>
                    <td className="p-2 font-medium">{emp.name}</td>
                    <td className="p-2">
                      <select className="input input-xs text-xs" value={t.metrica} onChange={e => updateField(emp.id, 'metrica', e.target.value)}>
                        <option value="FATTURATO_VENDUTO">Fatturato €</option>
                        <option value="PEZZI_TOTALI">Pezzi</option>
                        <option value="VALORE_VARIANTI">Varianti €</option>
                      </select>
                    </td>
                    <td className="p-2 text-right text-gray-500 font-mono text-xs" title={s ? `Fonte: storico Auto-genera (${s.storico[0]?.label || 'mese prec.'})` : 'Fonte: v_kpi_performance_individuale mese precedente'}>
                      {s
                        ? fmtVal(isFatRow ? s.storico[0]?.fatturato_totale : s.storico[0]?.pezzi_totali)
                        : (prevPerf[emp.id]?.pezzi_totali != null && !isFatRow ? Math.round(prevPerf[emp.id].pezzi_totali).toLocaleString('it') : '—')
                      }
                    </td>
                    <td className="p-2">
                      <input type="number" className="input input-xs w-24 text-right" value={t.quantum || ''} onChange={e => updateField(emp.id, 'quantum', parseFloat(e.target.value) || 0)} />
                    </td>
                    <td className="p-2">
                      <input type="number" className="input input-xs w-24 text-right font-semibold" value={t.target || ''} onChange={e => { updateField(emp.id, '_target_manual', true); updateField(emp.id, 'target', parseFloat(e.target.value) || 0) }} />
                    </td>
                    <td className="p-2">
                      <input type="number" step="10" className="input input-xs w-24 text-right" value={t.premio_max_euro || ''} onChange={e => updateField(emp.id, 'premio_max_euro', parseFloat(e.target.value) || 0)} />
                    </td>
                    <td className="p-2 text-right font-mono">{fmtVal(attuale)}</td>
                    <td className="p-2 text-right font-mono text-green-600">{euro(bonus)}</td>
                    <td className="p-2 text-center text-xs text-gray-400">
                      {s ? <span className="text-indigo-600 font-medium" title={`Base: ${s.baseFonte}`}>📊 {s.baseFonte}</span> : '—'}
                    </td>
                    <td className="p-2">
                      <button className="btn btn-xs btn-primary text-xs" onClick={() => saveRow(emp.id)}>Salva</button>
                    </td>
                  </tr>

                  {/* Riga espansa: storico 3 mesi + anno precedente */}
                  {isExpanded && (
                    <tr className="bg-indigo-50 border-b">
                      <td colSpan={11} className="px-4 py-3">
                        {!s ? (
                          <p className="text-xs text-gray-500">Clicca su 🤖 Auto-genera per caricare lo storico di questo operatore.</p>
                        ) : (
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-indigo-700">
                              Storico {s.operatore || emp.name} — Fonte: v_fatturato_operatore_mensile
                            </div>
                            <div className="flex gap-3 flex-wrap text-xs">
                              {s.storico.map((m, i) => (
                                <div key={i} className={`bg-white border rounded px-3 py-2 min-w-[90px] text-center ${!m.haDati ? 'opacity-50' : ''}`}>
                                  <div className="text-gray-500">{m.label}</div>
                                  <div className="font-bold text-gray-800">{m.haDati ? Math.round(parseFloat(m.pezzi_totali)).toLocaleString('it') : '—'} pz</div>
                                  {m.haDati && <div className="text-green-700">{euro(m.fatturato_totale)}</div>}
                                </div>
                              ))}
                              {s.datiAnnoPrec && (
                                <div className="bg-yellow-50 border border-yellow-300 rounded px-3 py-2 min-w-[90px] text-center">
                                  <div className="text-gray-500">{String(mese).padStart(2,'0')}/{anno-1} <span className="text-yellow-600">↩</span></div>
                                  <div className="font-bold">{Math.round(parseFloat(s.datiAnnoPrec.pezzi_totali)).toLocaleString('it')} pz</div>
                                  <div className="text-green-700">{euro(s.datiAnnoPrec.fatturato_totale)}</div>
                                </div>
                              )}
                            </div>
                            <div className="text-xs text-indigo-700 bg-white border border-indigo-200 rounded px-3 py-2 inline-block">
                              <b>Formula applicata:</b> {nMesi === 1 ? 'mese prec.' : `media ${nMesi}m`} = <b>{s.media3m_pezzi.toLocaleString('it')} pz</b>
                              {' | '} anno prec {String(mese).padStart(2,'0')}/{anno-1} = <b>{s.prevYearPezzi.toLocaleString('it')} pz</b>
                              {' | '} <b>Base = MAX = {s.quantum_pezzi.toLocaleString('it')}</b>
                              {' → '} <b className="text-green-700">Target = {s.target_pezzi.toLocaleString('it')} pz</b>
                              {' · '} Usata: <b>{s.baseFonte}</b>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 4 — Target Prodotti
// ═══════════════════════════════════════════════════════════════════════════
function TabProdotti({ sede, anno, mese, refresh }) {
  const [targets, setTargets]   = useState([])
  const [perf, setPerf]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [showAdd, setShowAdd]   = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [t, p] = await Promise.all([
        kpiTargetsApi.listProdotti({ sede, anno, mese }),
        kpiPerformanceApi.getProdotti({ sede, anno, mese, limit: 500 }),
      ])
      setTargets(t); setPerf(p)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [sede, anno, mese, refresh])

  const perfByProd = useMemo(() => {
    const m = {}; for (const p of perf) m[p.prodotto?.toUpperCase()] = p
    return m
  }, [perf])

  const remove = async (id) => {
    if (!confirm('Eliminare questo target prodotto?')) return
    await kpiTargetsApi.deleteProdotto(id)
    load()
  }

  if (loading) return <Spinner />

  return (
    <section className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold">Target Prodotti — {sede} {String(mese).padStart(2, '0')}/{anno}</h2>
          <p className="text-sm text-gray-500">Es. Carbonare 400 → 450. Usato per monitorare prodotti strategici.</p>
        </div>
        <button className="btn btn-primary text-sm" onClick={() => setShowAdd(true)}>+ Nuovo Target Prodotto</button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left p-2">Prodotto</th>
              <th className="text-left p-2">Reparto</th>
              <th className="text-left p-2">Categoria</th>
              <th className="text-right p-2">Mese Prec.</th>
              <th className="text-right p-2">Target</th>
              <th className="text-right p-2">Attuale</th>
              <th className="text-right p-2">Progresso</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {targets.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-gray-400">Nessun target prodotto per questo mese</td></tr>}
            {targets.map(t => {
              const p = perfByProd[t.prodotto_nome?.toUpperCase()] || {}
              const attuale = parseInt(p.pezzi_venduti) || 0
              const progress = t.pezzi_target > 0 ? (attuale / t.pezzi_target * 100) : 0
              return (
                <tr key={t.id} className="border-b hover:bg-gray-50">
                  <td className="p-2 font-medium">{t.prodotto_nome}</td>
                  <td className="p-2">{t.reparto}</td>
                  <td className="p-2">{t.categoria}</td>
                  <td className="p-2 text-right">{t.pezzi_precedente}</td>
                  <td className="p-2 text-right font-semibold">{t.pezzi_target}</td>
                  <td className="p-2 text-right font-mono">{attuale}</td>
                  <td className="p-2">
                    <div className="h-2 bg-gray-100 rounded overflow-hidden w-32">
                      <div className={`h-full ${progress >= 100 ? 'bg-green-500' : progress >= 70 ? 'bg-yellow-500' : 'bg-red-400'}`} style={{ width: `${Math.min(progress, 100)}%` }}></div>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{progress.toFixed(0)}%</div>
                  </td>
                  <td className="p-2 text-right">
                    <button className="text-red-600 text-xs hover:underline" onClick={() => remove(t.id)}>Elimina</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <ProdottoForm
          sede={sede} anno={anno} mese={mese}
          prodottiPerf={perf}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load() }}
        />
      )}
    </section>
  )
}

function ProdottoForm({ sede, anno, mese, prodottiPerf, onClose, onSaved }) {
  const [form, setForm] = useState({
    prodotto_nome: '', reparto: 'CUCINA', categoria: 'PIATTO',
    pezzi_precedente: 0, pezzi_target: 0, valore_unitario: 0, note: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  // Auto-fill pezzi_precedente quando selezioni un prodotto esistente
  const selectProd = (nome) => {
    setForm(f => ({ ...f, prodotto_nome: nome }))
    const p = prodottiPerf.find(x => x.prodotto?.toUpperCase() === nome?.toUpperCase())
    if (p) setForm(f => ({ ...f, prodotto_nome: nome, pezzi_precedente: p.pezzi_venduti, pezzi_target: Math.round((p.pezzi_venduti || 0) * 1.15), categoria: p.categoria === 'Costo servizio' ? 'ALTRO' : 'PIATTO' }))
  }

  const save = async () => {
    if (!form.prodotto_nome) { setErr('Nome prodotto obbligatorio'); return }
    setSaving(true); setErr(null)
    try {
      await kpiTargetsApi.upsertProdotto({ sede, anno, mese, ...form })
      onSaved()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <Modal onClose={onClose} title="Nuovo Target Prodotto">
      {err && <div className="p-2 bg-red-50 text-red-700 rounded text-sm mb-3">{err}</div>}
      <div className="space-y-3">
        <Field label="Prodotto *">
          <input className="input w-full" list="prodotti-list" value={form.prodotto_nome} onChange={e => selectProd(e.target.value)} placeholder="es. CARBONARA" />
          <datalist id="prodotti-list">
            {prodottiPerf.slice(0, 200).map(p => <option key={p.prodotto} value={p.prodotto}>{p.prodotto} ({p.pezzi_venduti}pz)</option>)}
          </datalist>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reparto">
            <select className="input w-full" value={form.reparto} onChange={e => setForm(f => ({ ...f, reparto: e.target.value }))}>
              <option>CUCINA</option><option>SALA</option><option>BAR</option><option>ENTRAMBI</option>
            </select>
          </Field>
          <Field label="Categoria">
            <select className="input w-full" value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}>
              <option>PIATTO</option><option>VARIANTE</option><option>BEVANDA</option><option>DESSERT</option><option>ALTRO</option>
            </select>
          </Field>
          <Field label="Pezzi mese precedente">
            <input type="number" className="input w-full" value={form.pezzi_precedente} onChange={e => setForm(f => ({ ...f, pezzi_precedente: parseInt(e.target.value) || 0 }))} />
          </Field>
          <Field label="Pezzi target">
            <input type="number" className="input w-full" value={form.pezzi_target} onChange={e => setForm(f => ({ ...f, pezzi_target: parseInt(e.target.value) || 0 }))} />
          </Field>
          <Field label="Valore unitario €">
            <input type="number" step="0.01" className="input w-full" value={form.valore_unitario} onChange={e => setForm(f => ({ ...f, valore_unitario: parseFloat(e.target.value) || 0 }))} />
          </Field>
        </div>
        <Field label="Note">
          <textarea className="input w-full" rows={2} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn btn-ghost" onClick={onClose}>Annulla</button>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvo...' : 'Salva'}</button>
      </div>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 5 — Performance Live
// ═══════════════════════════════════════════════════════════════════════════
function TabPerformance({ sede, anno, mese, refresh }) {
  const [perf, setPerf]       = useState([])
  const [loading, setLoading] = useState(true)

  const KPI_PSEUDO_OPS = ['pienissimo', 'extra', 'tecnico', 'antonio']
  const load = async () => {
    setLoading(true)
    try {
      const p = await kpiPerformanceApi.getIndividuale({ sede, anno, mese })
      // Mostra solo operatori con mapping per questa sede (employee_id != null)
      // ed escludi pseudo-operatori di sistema — evita cross-sede contamination
      const filtered = p.filter(x =>
        x.employee_id &&
        !KPI_PSEUDO_OPS.includes(x.operatore?.toLowerCase())
      )
      setPerf(filtered.sort((a, b) => (b.pezzi_totali || 0) - (a.pezzi_totali || 0)))
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [sede, anno, mese, refresh])

  if (loading) return <Spinner />

  const totPezzi = perf.reduce((s, p) => s + (parseInt(p.pezzi_totali) || 0), 0)
  const totVar   = perf.reduce((s, p) => s + (parseFloat(p.valore_varianti_netto) || 0), 0)

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Performance Live — {sede} {String(mese).padStart(2, '0')}/{anno}</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Operatori attivi" value={perf.length} />
        <KpiCard label="Pezzi totali venduti" value={totPezzi.toLocaleString('it-IT')} />
        <KpiCard label="Valore varianti netto" value={euro(totVar)} />
        <KpiCard label="Media pezzi/operatore" value={perf.length ? Math.round(totPezzi / perf.length) : 0} />
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left p-2">#</th>
              <th className="text-left p-2">Operatore</th>
              <th className="text-right p-2">Pezzi</th>
              <th className="text-right p-2">Prodotti distinti</th>
              <th className="text-right p-2">Varianti Agg.</th>
              <th className="text-right p-2">Varianti Rim.</th>
              <th className="text-right p-2">Valore Varianti Netto</th>
              <th className="text-right p-2">% su team</th>
            </tr>
          </thead>
          <tbody>
            {perf.map((p, i) => {
              const pctTeam = totPezzi > 0 ? (p.pezzi_totali / totPezzi * 100) : 0
              return (
                <tr key={p.operatore + i} className="border-b hover:bg-gray-50">
                  <td className="p-2 text-gray-400">{i + 1}</td>
                  <td className="p-2 font-medium">{p.operatore}</td>
                  <td className="p-2 text-right font-mono">{p.pezzi_totali}</td>
                  <td className="p-2 text-right">{p.prodotti_distinti}</td>
                  <td className="p-2 text-right">{p.qty_aggiunte}</td>
                  <td className="p-2 text-right text-red-600">{p.qty_rimozioni}</td>
                  <td className="p-2 text-right font-mono">{euro(p.valore_varianti_netto)}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="h-2 w-20 bg-gray-100 rounded overflow-hidden">
                        <div className="h-full bg-indigo-500" style={{ width: `${pctTeam}%` }}></div>
                      </div>
                      <span className="text-xs text-gray-600 w-12 text-right">{pctTeam.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 6 — Standard Nazionali
// ═══════════════════════════════════════════════════════════════════════════
function TabStandardNazionali({ refresh }) {
  const [std, setStd] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try { setStd(await standardNazionaliApi.list()) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [refresh])

  const saveRow = async (row, patch) => {
    await standardNazionaliApi.update(row.id, patch)
    load()
  }

  if (loading) return <Spinner />

  return (
    <section>
      <h2 className="text-xl font-semibold mb-2">Standard Nazionali Ristorazione</h2>
      <p className="text-sm text-gray-500 mb-4">Percentuali di riferimento per categoria di costo sul fatturato. Modificali se la tua realtà si discosta.</p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left p-2">Categoria</th>
              <th className="text-right p-2">% Min</th>
              <th className="text-right p-2">% Ideale</th>
              <th className="text-right p-2">% Max</th>
              <th className="text-left p-2">Fonte</th>
            </tr>
          </thead>
          <tbody>
            {std.map(s => (
              <tr key={s.id} className="border-b">
                <td className="p-2 font-medium">{s.categoria}</td>
                <td className="p-2 text-right">
                  <input type="number" step="0.5" className="input input-xs w-20 text-right" defaultValue={s.pct_min} onBlur={e => saveRow(s, { pct_min: parseFloat(e.target.value) })} />
                </td>
                <td className="p-2 text-right">
                  <input type="number" step="0.5" className="input input-xs w-20 text-right bg-yellow-50" defaultValue={s.pct_ideale} onBlur={e => saveRow(s, { pct_ideale: parseFloat(e.target.value) })} />
                </td>
                <td className="p-2 text-right">
                  <input type="number" step="0.5" className="input input-xs w-20 text-right" defaultValue={s.pct_max} onBlur={e => saveRow(s, { pct_max: parseFloat(e.target.value) })} />
                </td>
                <td className="p-2 text-gray-500 text-xs">{s.fonte}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Componenti di utility
// ═══════════════════════════════════════════════════════════════════════════
function Field({ label, children, wide = false }) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${wide ? 'col-span-2 md:col-span-3' : ''}`}>
      <span className="text-gray-600 text-xs">{label}</span>
      {children}
    </label>
  )
}

function KpiCard({ label, value, hint, note, color = 'border-gray-200', highlight = false }) {
  const [showNote, setShowNote] = React.useState(false)
  return (
    <div className={`p-4 bg-white rounded-lg border ${color} ${highlight ? 'bg-red-50' : ''} relative`}>
      <div className="flex items-center gap-1">
        <div className="text-xs text-gray-500 uppercase tracking-wider flex-1">{label}</div>
        {note && (
          <button onClick={() => setShowNote(s => !s)} className="text-gray-400 hover:text-indigo-500 text-xs" title="Fonte dato">ℹ️</button>
        )}
      </div>
      <div className={`text-2xl font-bold mt-1 ${highlight ? 'text-red-700' : ''}`}>{value}</div>
      {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
      {showNote && note && (
        <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">{note}</div>
      )}
    </div>
  )
}

function Spinner() {
  return <div className="p-8 text-center text-gray-400">Caricamento...</div>
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg max-w-2xl w-full p-5 max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button className="text-gray-400 hover:text-gray-900" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
