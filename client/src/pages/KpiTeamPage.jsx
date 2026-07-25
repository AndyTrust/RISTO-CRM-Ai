import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Target, TrendingUp, Calculator, Award, ChefHat, UtensilsCrossed,
  Plus, Trash2, Edit3, Save, X, RefreshCw, ArrowUpRight, Info,
  Users, Euro, Percent, BarChart3, CheckCircle2, AlertCircle,
  Sparkles, Lightbulb, TrendingDown
} from 'lucide-react'
import {
  beMensileApi, operatoreMeseApi, obiettiviProdottoApi, bonusApi,
  kpiTargetsApi, sediApi,
} from '../api/client'
import PageStatsWidget from '../components/PageStatsWidget'

// ── Utils ──────────────────────────────────────────────────────────────
const fmt = (n, d = 2) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtEur = (n) => n == null ? '—' : `€ ${fmt(n, 2)}`
const fmtPct = (n) => n == null ? '—' : `${fmt(n, 1)}%`
const MESI = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']

// ── Toast ──────────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState(null)
  const show = useCallback((type, text) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 3500)
  }, [])
  const node = toast ? (
    <div className={`fixed bottom-4 right-4 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium z-50 ${
      toast.type === 'ok' ? 'bg-emerald-600 text-white' : toast.type === 'warn' ? 'bg-amber-500 text-white' : 'bg-red-600 text-white'
    }`}>{toast.text}</div>
  ) : null
  return { show, node }
}

// ── Card KPI ───────────────────────────────────────────────────────────
function Kpi({ icon: Icon, label, value, sub, color = 'indigo', size = 'md' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">{label}</div>
          <div className={`mt-1 font-bold text-gray-900 ${size === 'lg' ? 'text-2xl' : 'text-xl'}`}>{value}</div>
          {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
        </div>
        <div className={`p-2 rounded-lg bg-${color}-50 text-${color}-600`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  )
}

// ── Modal Obiettivo Prodotto ───────────────────────────────────────────
function ObiettivoModal({ open, onClose, onSave, initial, sede, anno, mese }) {
  const [form, setForm] = useState(initial || {
    sede, anno, mese,
    prodotto: '', categoria: '', reparto: 'ENTRAMBI',
    pezzi_base: 0, pezzi_target: 0, premio_euro: 0, note: '',
  })
  useEffect(() => { if (open) setForm(initial || { sede, anno, mese, prodotto: '', categoria: '', reparto: 'ENTRAMBI', pezzi_base: 0, pezzi_target: 0, premio_euro: 0, note: '' }) }, [open, initial, sede, anno, mese])

  if (!open) return null
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Target size={18} className="text-indigo-600" />
            {form.id ? 'Modifica Obiettivo' : 'Nuovo Obiettivo Prodotto'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600">Prodotto</label>
            <input className="input w-full text-sm mt-1" placeholder="es. Carbonara"
              value={form.prodotto} onChange={e => setForm({ ...form, prodotto: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Categoria</label>
              <input className="input w-full text-sm mt-1" placeholder="es. Primi"
                value={form.categoria || ''} onChange={e => setForm({ ...form, categoria: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Reparto</label>
              <select className="input w-full text-sm mt-1" value={form.reparto} onChange={e => setForm({ ...form, reparto: e.target.value })}>
                <option value="CUCINA">🍳 Cucina</option>
                <option value="SALA">🍽️ Sala</option>
                <option value="ENTRAMBI">🤝 Entrambi</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Pezzi Base (mese prec.)</label>
              <input type="number" className="input w-full text-sm mt-1"
                value={form.pezzi_base} onChange={e => setForm({ ...form, pezzi_base: parseInt(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Pezzi Target</label>
              <input type="number" className="input w-full text-sm mt-1"
                value={form.pezzi_target} onChange={e => setForm({ ...form, pezzi_target: parseInt(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Premio €</label>
              <input type="number" step="0.01" className="input w-full text-sm mt-1"
                value={form.premio_euro} onChange={e => setForm({ ...form, premio_euro: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Note</label>
            <textarea className="input w-full text-sm mt-1" rows={2}
              value={form.note || ''} onChange={e => setForm({ ...form, note: e.target.value })} />
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-5">
          <button onClick={onClose} className="btn-secondary">Annulla</button>
          <button onClick={() => onSave(form)} className="btn-primary flex items-center gap-1.5">
            <Save size={14} /> Salva
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────
export default function KpiTeamPage() {
  const { show, node: toastNode } = useToast()
  const now = new Date()

  const [sedi, setSedi] = useState([])
  const [sede, setSede] = useState('MA')
  const [anno, setAnno] = useState(now.getFullYear())
  const [mese, setMese] = useState(now.getMonth() + 1)

  const [be, setBe] = useState(null)
  const [operatori, setOperatori] = useState([])
  const [obiettivi, setObiettivi] = useState([])
  const [bonusTeam, setBonusTeam] = useState([])
  const [bonusOp, setBonusOp] = useState([])
  const [kpiTeam, setKpiTeam] = useState(null)
  const [loading, setLoading] = useState(false)
  const [calcOpen, setCalcOpen] = useState(false)
  const [modalOb, setModalOb] = useState({ open: false, initial: null })
  const [showGuida, setShowGuida] = useState(false)

  // Param calcolo
  const [premioTeam, setPremioTeam] = useState(500)
  const [pctCucina, setPctCucina] = useState(40)
  const [pctSala, setPctSala] = useState(60)

  // Load sedi
  useEffect(() => {
    sediApi.getAll().then(r => setSedi(r.filter(s => s.active !== false))).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [b, op, ob, bt, bo, kt] = await Promise.all([
        beMensileApi.mese({ sede, anno, mese }),
        operatoreMeseApi.list({ sede, anno, mese }),
        obiettiviProdottoApi.list({ sede, anno, mese }),
        bonusApi.team({ sede, anno, mese }),
        bonusApi.operatori({ sede, anno, mese }),
        kpiTargetsApi.getTeam({ sede, anno, mese }),
      ])
      setBe(b); setOperatori(op || []); setObiettivi(ob || [])
      setBonusTeam(bt || []); setBonusOp(bo || []); setKpiTeam(kt)
    } catch (e) { show('err', `Errore: ${e.message}`) }
    finally { setLoading(false) }
  }, [sede, anno, mese, show])

  useEffect(() => { load() }, [load])

  const handleCalcola = async () => {
    setLoading(true)
    try {
      const res = await bonusApi.calcola({ sede, anno, mese, premio_team_euro: premioTeam, pct_cucina: pctCucina, pct_sala: pctSala })
      show('ok', `Quantum team: € ${fmt(res?.quantum_team, 0)} distribuito su ${res?.operatori_count || 0} operatori`)
      setCalcOpen(false)
      await load()
    } catch (e) { show('err', `Errore: ${e.message}`) }
    finally { setLoading(false) }
  }

  const handleSaveObiettivo = async (form) => {
    try {
      await obiettiviProdottoApi.upsert(form)
      show('ok', form.id ? 'Obiettivo aggiornato' : 'Obiettivo creato')
      setModalOb({ open: false, initial: null })
      await load()
    } catch (e) { show('err', `Errore: ${e.message}`) }
  }

  const handleDeleteObiettivo = async (id) => {
    if (!window.confirm('Eliminare questo obiettivo?')) return
    try { await obiettiviProdottoApi.remove(id); show('ok', 'Eliminato'); await load() }
    catch (e) { show('err', `Errore: ${e.message}`) }
  }

  // KPI derivati
  const beTotale = be?.costi_totali || 0
  const fatturato = be?.fatturato || 0
  const margine = be?.margine || 0
  const quantumTeam = kpiTeam?.target_fatturato || 0
  const pctSuBE = beTotale > 0 ? (fatturato / beTotale) * 100 : 0
  const pctSuQuantum = quantumTeam > 0 ? (fatturato / quantumTeam) * 100 : 0

  // ── Consulente KPI: analisi rule-based con previsioni ─────────────
  const insights = useMemo(() => {
    if (!be) return []
    const out = []
    const oggi = new Date()
    const meseSelezionato = new Date(anno, mese - 1, 1)
    const fineMese = new Date(anno, mese, 0)
    const isCurMonth = oggi.getFullYear() === anno && (oggi.getMonth() + 1) === mese
    const giorniTotali = fineMese.getDate()
    const giorniPassati = isCurMonth ? oggi.getDate() : giorniTotali
    const pctTempo = (giorniPassati / giorniTotali) * 100

    // 1) Proiezione fatturato fine mese (pro-rata)
    if (isCurMonth && fatturato > 0 && giorniPassati > 0) {
      const proiezione = (fatturato / giorniPassati) * giorniTotali
      const ritmoPG = fatturato / giorniPassati
      if (quantumTeam > 0) {
        const gap = quantumTeam - proiezione
        if (gap > 0) {
          out.push({
            type: 'warn',
            icon: TrendingDown,
            title: `Proiezione fine mese: ${fmtEur(proiezione)}`,
            text: `A questo ritmo chiudi sotto Quantum di ${fmtEur(gap)}. Servono ${fmtEur((quantumTeam - fatturato) / Math.max(giorniTotali - giorniPassati, 1))}/giorno nei prossimi ${giorniTotali - giorniPassati} giorni per centrare il target.`,
          })
        } else {
          out.push({
            type: 'ok',
            icon: TrendingUp,
            title: `Proiezione fine mese: ${fmtEur(proiezione)}`,
            text: `Superi Quantum di ${fmtEur(-gap)}. Tieni il ritmo attuale di ${fmtEur(ritmoPG)}/giorno.`,
          })
        }
      } else {
        // Quantum non ancora calcolato — mostra proiezione neutra
        out.push({
          type: 'ok',
          icon: TrendingUp,
          title: `Proiezione fine mese: ${fmtEur(proiezione)}`,
          text: `Ritmo attuale: ${fmtEur(ritmoPG)}/giorno (${giorniPassati} giorni su ${giorniTotali}). Clicca "Calcola Obiettivi Mese" per confrontare con il Quantum.`,
        })
      }
    }

    // 2) BE raggiunto o meno
    if (fatturato < beTotale) {
      const gap = beTotale - fatturato
      out.push({
        type: 'err',
        icon: AlertCircle,
        title: `BE non ancora coperto`,
        text: `Mancano ${fmtEur(gap)} (${fmtPct((gap / beTotale) * 100)}) per non andare in perdita. Prioritario: spingere vendite ad alto margine e frenare costi variabili.`,
      })
    } else {
      out.push({
        type: 'ok',
        icon: CheckCircle2,
        title: `BE coperto — margine ${fmtEur(margine)}`,
        text: `Ogni euro oltre qui è utile puro. % personale ${fmtPct(be.pct_personale)}, % food ${fmtPct(be.pct_food)}.`,
      })
    }

    // 3) Costi fuori range benchmark
    if (be.pct_personale > 35) out.push({
      type: 'warn', icon: AlertCircle, title: 'Personale sopra soglia',
      text: `% personale ${fmtPct(be.pct_personale)} (benchmark 28–33%).${
        isCurMonth ? ' ⚠️ Dato su buste paga stimate mese intero vs fatturato parziale — si normalizzerà a fine mese.' :
        ' Valuta riduzione ore in giorni bassi o riallocazione turni.'
      }`,
    })
    // 4) Obiettivi a rischio
    if (bonusTeam.length > 0 && isCurMonth && pctTempo > 0) {
      const aRischio = bonusTeam.filter(b => {
        const p = b.pct_completamento || 0
        return !b.raggiunto && p < pctTempo - 5
      }).slice(0, 3)
      if (aRischio.length > 0) {
        out.push({
          type: 'warn',
          icon: TrendingDown,
          title: `${aRischio.length} obiettivi in ritardo vs tempo trascorso (${fmtPct(pctTempo)})`,
          text: aRischio.map(b => `${b.prodotto} ${b.pezzi_venduti}/${b.pezzi_target} (${fmtPct(b.pct_completamento)})`).join(' · '),
        })
      }
      const superati = bonusTeam.filter(b => b.raggiunto).length
      if (superati > 0) {
        out.push({
          type: 'ok',
          icon: CheckCircle2,
          title: `${superati} obiettivi già raggiunti`,
          text: `Premio maturato totale: ${fmtEur(bonusTeam.reduce((a, b) => a + (b.premio_maturato || 0), 0))}. Puoi alzare i target per i mesi successivi.`,
        })
      }
    }

    // 5) Top operatore — suggerimento
    if (operatori.length >= 2) {
      // Non assumere che operatori[0] sia il migliore: ordina per pezzi
      const top = [...operatori].sort((a, b) => (b.tot_pezzi || 0) - (a.tot_pezzi || 0))[0]
      const media = operatori.reduce((a, b) => a + (b.tot_pezzi || 0), 0) / operatori.length
      if (top && (top.tot_pezzi || 0) > media * 1.5) {
        out.push({
          type: 'info',
          icon: Sparkles,
          title: `${top.operatore} traina il team`,
          text: `${top.tot_pezzi} pezzi (${fmtPct(top.pct_pezzi_team)} del totale). Considera premio extra o mentor role per alzare la media.`,
        })
      }
    }

    // 6) Indicazione strategica stagione
    if (!isCurMonth && fatturato > 0 && quantumTeam > 0) {
      const varPct = ((fatturato - quantumTeam) / quantumTeam) * 100
      out.push({
        type: varPct >= 0 ? 'ok' : 'warn',
        icon: varPct >= 0 ? TrendingUp : TrendingDown,
        title: `Consuntivo ${MESI[mese - 1]}: ${varPct >= 0 ? '+' : ''}${fmtPct(varPct)} vs Quantum`,
        text: varPct >= 0
          ? `Usa questo mese come baseline per alzare target l'anno prossimo.`
          : `Analizza cause: calo scontrinaggio? Prezzo medio basso? Giorni di chiusura?`,
      })
    }

    return out
  }, [be, fatturato, beTotale, margine, quantumTeam, bonusTeam, operatori, anno, mese])

  // Aggregazione obiettivi per reparto
  const reparti = useMemo(() => {
    const acc = { SALA: { target: 0, venduti: 0, premio: 0, n: 0 }, CUCINA: { target: 0, venduti: 0, premio: 0, n: 0 } }
    bonusTeam.forEach(b => {
      const r = b.reparto === 'CUCINA' ? 'CUCINA' : b.reparto === 'SALA' ? 'SALA' : null
      if (!r) return
      acc[r].target += b.pezzi_target || 0
      acc[r].venduti += b.pezzi_venduti || 0
      acc[r].premio += b.premio_maturato || 0
      acc[r].n += 1
    })
    return acc
  }, [bonusTeam])

  return (
    <div className="space-y-5">
      <PageStatsWidget />
      {toastNode}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Award className="text-indigo-600" size={26} />
            KPI Team & Quantum
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Break-even, obiettivi prodotto, bonus team e distribuzione payout</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowGuida(v => !v)} className="btn-secondary text-sm flex items-center gap-1.5">
            <Info size={14} /> Guida
          </button>
          <button onClick={load} disabled={loading} className="btn-secondary text-sm flex items-center gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Ricarica
          </button>
          <button onClick={() => setCalcOpen(true)} className="btn-primary text-sm flex items-center gap-1.5">
            <Calculator size={14} /> Calcola Obiettivi Mese
          </button>
        </div>
      </div>

      {/* Guida */}
      {showGuida && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-sm text-gray-700 space-y-2">
          <div className="font-bold text-indigo-900 flex items-center gap-2"><Info size={16} /> Come funziona questa pagina</div>
          <div className="grid md:grid-cols-2 gap-3 mt-2">
            <div>
              <div className="font-semibold text-gray-800">1. Break-Even (BE)</div>
              <p className="text-xs">Somma costi personale + food + utenze + commissioni + servizi + costi fissi (affitti, consulenze). È il fatturato minimo per non perdere.</p>
            </div>
            <div>
              <div className="font-semibold text-gray-800">2. Quantum Team</div>
              <p className="text-xs">Target fatturato mese = MAX(media storica × 1.10, BE × 1.10, fatt. mese precedente × 1.05). Garantisce almeno +10% sul BE.</p>
            </div>
            <div>
              <div className="font-semibold text-gray-800">3. Obiettivi Prodotto</div>
              <p className="text-xs">Target pezzi per singolo prodotto (es. Carbonara 400→450). Ogni obiettivo assegnato a Sala, Cucina o Entrambi con un premio €.</p>
            </div>
            <div>
              <div className="font-semibold text-gray-800">4. Distribuzione Payout</div>
              <p className="text-xs">Se l'obiettivo è raggiunto, il premio si distribuisce proporzionalmente sui pezzi venduti da ciascun operatore.</p>
            </div>
          </div>
        </div>
      )}

      {/* Filtri sede/anno/mese */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap gap-3 items-center shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-600">Sede:</span>
          <div className="flex gap-1">
            {['MA', 'PN'].map(s => (
              <button key={s} onClick={() => setSede(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  sede === s ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {s === 'MA' ? 'Sede MA' : 'Sede PN'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-600">Anno:</span>
          <select className="input text-xs py-1" value={anno} onChange={e => setAnno(parseInt(e.target.value))}>
            {/* Da 2024 all'anno corrente incluso: `anno-2022` includeva anche
                l'anno successivo, che non ha ancora dati. */}
            {Array.from({length:new Date().getFullYear()-2023},(_,i)=>2024+i).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-600">Mese:</span>
          <select className="input text-xs py-1" value={mese} onChange={e => setMese(parseInt(e.target.value))}>
            {MESI.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        {loading && <span className="text-xs text-gray-400 flex items-center gap-1"><RefreshCw size={12} className="animate-spin" /> caricamento...</span>}
      </div>

      {/* KPI Cards principali */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Target} label="BE Totale" value={fmtEur(beTotale)} sub="Break-even mese" color="red" size="lg" />
        <Kpi icon={TrendingUp} label="Quantum Team" value={fmtEur(quantumTeam)} sub={kpiTeam ? `coeff ${kpiTeam.coeff_stagionale || 1}` : 'non ancora calcolato'} color="indigo" size="lg" />
        <Kpi icon={Euro} label="Fatturato" value={fmtEur(fatturato)} sub={`${fmtPct(pctSuQuantum)} vs Quantum`} color={fatturato >= quantumTeam ? 'emerald' : fatturato >= beTotale ? 'amber' : 'red'} size="lg" />
        <Kpi icon={Percent} label="Margine" value={fmtEur(margine)} sub={margine >= 0 ? 'in utile' : 'in perdita'} color={margine >= 0 ? 'emerald' : 'red'} size="lg" />
      </div>

      {/* Consulente KPI — insights e previsioni */}
      {insights.length > 0 && (
        <div className="bg-gradient-to-br from-violet-50 via-white to-indigo-50 rounded-xl border border-violet-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Sparkles className="text-violet-600" size={16} />
              Consulente KPI · {insights.length} insight
            </h2>
            <span className="text-[10px] text-gray-400">analisi automatica basata su BE, Quantum, obiettivi e trend</span>
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            {insights.map((ins, i) => {
              const Icon = ins.icon || Lightbulb
              const pal = ins.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : ins.type === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800'
                : ins.type === 'err' ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-indigo-50 border-indigo-200 text-indigo-800'
              return (
                <div key={i} className={`rounded-lg border p-3 ${pal}`}>
                  <div className="flex items-start gap-2">
                    <Icon size={16} className="flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-bold text-sm">{ins.title}</div>
                      <div className="text-xs mt-0.5 opacity-90">{ins.text}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Breakdown BE */}
      {be && (() => {
        // Calcola quota fatture non categorizzate (fornitori senza P.IVA o senza categoria)
        const categorizzate = (be.costo_food||0) + (be.costo_utenze||0) + (be.costo_commissioni||0) + (be.costo_servizi||0)
        const nonCat = Math.max(0, +(parseFloat(be.tot_fatture_acquisto||0) - categorizzate).toFixed(2))
        const hasDuplicazioneAlert = nonCat > 50 // mostra warning se >€50 non categorizzati
        return (
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <BarChart3 size={16} className="text-indigo-600" />
                Break-Even Breakdown · {sede} · {MESI[mese - 1]} {anno}
              </h2>
              <div className="text-xs text-gray-500">{fatturato >= beTotale ? <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 size={14} /> BE raggiunto ({fmtPct(pctSuBE)})</span> : <span className="text-red-600 flex items-center gap-1"><AlertCircle size={14} /> BE non raggiunto ({fmtPct(pctSuBE)})</span>}</div>
            </div>

            {/* ⚠ Warning fatture non categorizzate */}
            {hasDuplicazioneAlert && (
              <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2 text-xs">
                <AlertCircle size={13} className="text-amber-500 mt-0.5 flex-shrink-0"/>
                <div className="text-amber-800">
                  <strong>{fmtEur(nonCat)} di fatture acquisto non categorizzate</strong> — fornitori senza P.IVA mappata (METRO, MARR, Deliveroo, ecc.) non sono attribuiti alle voci food/utenze/commissioni.
                  {' '}<a href="/fornitori" className="underline font-semibold">Categorizza in Fornitori →</a>
                </div>
              </div>
            )}

            {/* ⚠ Warning duplicazione costi fissi */}
            <div className="mb-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-start gap-2 text-xs">
              <AlertCircle size={13} className="text-blue-500 mt-0.5 flex-shrink-0"/>
              <div className="text-blue-800">
                <strong>Controlla duplicazioni:</strong> se utenze (elettricità, telefonia) compaiono sia in Costi Fissi sia nelle fatture acquisto SdI, vengono conteggiate due volte.
                Verifica in <a href="/fornitori" className="underline font-semibold">Fornitori</a> che i fornitori utenze non abbiano fatture SdI importate.
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-xs">
              {[
                { k: 'costo_personale', l: 'Personale', c: 'violet' },
                { k: 'costo_food', l: 'Food', c: 'emerald' },
                { k: 'costo_utenze', l: 'Utenze', c: 'yellow' },
                { k: 'costo_commissioni', l: 'Commissioni', c: 'orange' },
                { k: 'costo_servizi', l: 'Servizi', c: 'cyan' },
                { k: 'costi_fissi', l: 'Costi fissi', c: 'pink' },
              ].map(({ k, l, c }) => (
                <div key={k} className={`rounded-lg bg-${c}-50 border border-${c}-200 p-2`}>
                  <div className="text-[10px] font-medium text-gray-600 uppercase">{l}</div>
                  <div className="font-bold text-gray-900 mt-0.5">{fmtEur(be[k])}</div>
                  {be.fatturato > 0 && <div className="text-[9px] text-gray-500">{fmtPct((be[k] / be.fatturato) * 100)}</div>}
                </div>
              ))}
              {/* Colonna fatture non categorizzate */}
              {nonCat > 0.01 && (
                <div className="rounded-lg bg-gray-100 border border-gray-300 border-dashed p-2">
                  <div className="text-[10px] font-medium text-gray-500 uppercase">Altro ⚠</div>
                  <div className="font-bold text-gray-700 mt-0.5">{fmtEur(nonCat)}</div>
                  {be.fatturato > 0 && <div className="text-[9px] text-gray-400">{fmtPct((nonCat / be.fatturato) * 100)}</div>}
                </div>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 text-[11px] text-gray-500 flex gap-4 flex-wrap">
              <span>Coperti: <b>{be.coperti || 0}</b></span>
              <span>Totale fatture acquisto: <b>{fmtEur(be.tot_fatture_acquisto)}</b></span>
              <span>% personale: <b>{fmtPct(be.pct_personale)}</b></span>
              <span>% food: <b>{fmtPct(be.pct_food)}</b></span>
              {nonCat > 0.01 && <span className="text-amber-600">% altro (non cat.): <b>{fmtPct((nonCat / (be.fatturato||1)) * 100)}</b></span>}
            </div>
          </div>
        )
      })()}

      {/* Reparti dashboard */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-orange-50 to-white rounded-xl border border-orange-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ChefHat className="text-orange-600" size={18} />
              <div className="font-bold text-gray-900">Cucina</div>
            </div>
            <div className="text-xs text-orange-700 font-semibold">{pctCucina}% del monte bonus</div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div><div className="text-gray-500">Obiettivi</div><div className="text-lg font-bold">{reparti.CUCINA.n}</div></div>
            <div><div className="text-gray-500">Pezzi</div><div className="text-lg font-bold">{reparti.CUCINA.venduti}/{reparti.CUCINA.target}</div></div>
            <div><div className="text-gray-500">Premio</div><div className="text-lg font-bold text-emerald-700">{fmtEur(reparti.CUCINA.premio)}</div></div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-indigo-50 to-white rounded-xl border border-indigo-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="text-indigo-600" size={18} />
              <div className="font-bold text-gray-900">Sala</div>
            </div>
            <div className="text-xs text-indigo-700 font-semibold">{pctSala}% del monte bonus</div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div><div className="text-gray-500">Obiettivi</div><div className="text-lg font-bold">{reparti.SALA.n}</div></div>
            <div><div className="text-gray-500">Pezzi</div><div className="text-lg font-bold">{reparti.SALA.venduti}/{reparti.SALA.target}</div></div>
            <div><div className="text-gray-500">Premio</div><div className="text-lg font-bold text-emerald-700">{fmtEur(reparti.SALA.premio)}</div></div>
          </div>
        </div>
      </div>

      {/* Tabella Obiettivi Prodotto */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Target size={16} className="text-indigo-600" />
            Obiettivi Prodotto · {bonusTeam.length} attivi
          </h2>
          <button onClick={() => setModalOb({ open: true, initial: null })} className="btn-primary text-xs flex items-center gap-1.5">
            <Plus size={13} /> Nuovo Obiettivo
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Prodotto</th>
                <th className="text-left px-3 py-2 font-semibold">Reparto</th>
                <th className="text-right px-3 py-2 font-semibold">Base</th>
                <th className="text-right px-3 py-2 font-semibold">Target</th>
                <th className="text-right px-3 py-2 font-semibold">Venduti</th>
                <th className="text-right px-3 py-2 font-semibold">Mancano</th>
                <th className="text-center px-3 py-2 font-semibold">% Compl.</th>
                <th className="text-right px-3 py-2 font-semibold">Premio</th>
                <th className="text-right px-3 py-2 font-semibold">Maturato</th>
                <th className="text-center px-3 py-2 font-semibold">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {bonusTeam.length === 0 && (
                <tr><td colSpan={10} className="text-center py-8 text-gray-400">
                  Nessun obiettivo per questo mese. Clicca <b>Nuovo Obiettivo</b> o <b>Calcola Obiettivi Mese</b>.
                </td></tr>
              )}
              {bonusTeam.map(b => {
                const obj = obiettivi.find(o => o.prodotto === b.prodotto && o.reparto === b.reparto)
                const pct = b.pct_completamento || 0
                return (
                  <tr key={`${b.prodotto}-${b.reparto}`} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{b.prodotto}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        b.reparto === 'CUCINA' ? 'bg-orange-100 text-orange-700' :
                        b.reparto === 'SALA' ? 'bg-indigo-100 text-indigo-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>{b.reparto}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500">{b.pezzi_base || 0}</td>
                    <td className="px-3 py-2 text-right font-semibold">{b.pezzi_target || 0}</td>
                    <td className="px-3 py-2 text-right">{b.pezzi_venduti || 0}</td>
                    <td className="px-3 py-2 text-right">{b.raggiunto ? <span className="text-emerald-600">✓</span> : (b.pezzi_mancanti || 0)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full ${pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-400'}`}
                            style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <span className="text-[10px] font-bold w-10 text-right">{fmtPct(pct)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">{fmtEur(b.premio_euro)}</td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-700">{fmtEur(b.premio_maturato)}</td>
                    <td className="px-3 py-2 text-center">
                      {obj && (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => setModalOb({ open: true, initial: obj })} className="p-1 text-gray-500 hover:text-indigo-600"><Edit3 size={12} /></button>
                          <button onClick={() => handleDeleteObiettivo(obj.id)} className="p-1 text-gray-500 hover:text-red-600"><Trash2 size={12} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tabella Operatori */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-3 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Users size={16} className="text-indigo-600" />
            Operatori · pezzi venduti + quota team + payout bonus
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Operatore</th>
                <th className="text-right px-3 py-2 font-semibold">Pezzi</th>
                <th className="text-right px-3 py-2 font-semibold">Prodotti</th>
                <th className="text-right px-3 py-2 font-semibold">% Team</th>
                <th className="text-right px-3 py-2 font-semibold">Aggiunte</th>
                <th className="text-right px-3 py-2 font-semibold">€ Aggiunte</th>
                <th className="text-right px-3 py-2 font-semibold">Fatt. Stimato</th>
                <th className="text-right px-3 py-2 font-semibold">Payout Bonus</th>
              </tr>
            </thead>
            <tbody>
              {operatori.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-gray-400">Nessun dato operatori per questo mese.</td></tr>}
              {operatori.map(op => {
                const payout = bonusOp.filter(b => (b.operatore || '').toLowerCase().trim() === (op.operatore || '').toLowerCase().trim())
                  .reduce((a, b) => a + (b.payout_operatore || 0), 0)
                return (
                  <tr key={op.operatore} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{op.operatore}</td>
                    <td className="px-3 py-2 text-right">{op.tot_pezzi || 0}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{op.n_prodotti_distinti || 0}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500" style={{ width: `${Math.min(op.pct_pezzi_team || 0, 100)}%` }} />
                        </div>
                        <span className="font-semibold w-10 text-right">{fmtPct(op.pct_pezzi_team)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500">{op.tot_aggiunte || 0}</td>
                    <td className="px-3 py-2 text-right">{fmtEur(op.tot_importo_aggiunte)}</td>
                    <td className="px-3 py-2 text-right">{fmtEur(op.fatturato_stimato_operatore)}</td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-700">{fmtEur(payout)}</td>
                  </tr>
                )
              })}
            </tbody>
            {operatori.length > 0 && (
              <tfoot className="bg-gray-50 font-bold text-gray-800">
                <tr className="border-t-2 border-gray-200">
                  <td className="px-3 py-2">TOTALE</td>
                  <td className="px-3 py-2 text-right">{operatori.reduce((a, b) => a + (b.tot_pezzi || 0), 0)}</td>
                  <td></td>
                  <td className="px-3 py-2 text-right">100%</td>
                  <td className="px-3 py-2 text-right">{operatori.reduce((a, b) => a + (b.tot_aggiunte || 0), 0)}</td>
                  <td className="px-3 py-2 text-right">{fmtEur(operatori.reduce((a, b) => a + (b.tot_importo_aggiunte || 0), 0))}</td>
                  <td className="px-3 py-2 text-right">{fmtEur(operatori.reduce((a, b) => a + (b.fatturato_stimato_operatore || 0), 0))}</td>
                  <td className="px-3 py-2 text-right text-emerald-700">{fmtEur(bonusOp.reduce((a, b) => a + (b.payout_operatore || 0), 0))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Modal calcolo */}
      {calcOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setCalcOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Calculator size={18} className="text-indigo-600" /> Calcola Obiettivi Mese
              </h3>
              <button onClick={() => setCalcOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-xs text-gray-700">
                <div className="flex items-center gap-1.5 font-bold text-indigo-900 mb-1"><ArrowUpRight size={13} /> Formula Quantum</div>
                <code className="block bg-white rounded px-2 py-1 text-[11px] text-gray-800">
                  Quantum = MAX(storica × 1.10, BE × 1.10, prec × 1.05)
                </code>
                <p className="mt-1.5">Assicura sempre almeno +10% sul BE. Distribuisce il target sugli operatori in base ai pezzi venduti nel mese precedente.</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Monte Premio Team €</label>
                <input type="number" step="10" className="input w-full text-sm mt-1"
                  value={premioTeam} onChange={e => setPremioTeam(parseFloat(e.target.value) || 0)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">% Cucina</label>
                  <input type="number" className="input w-full text-sm mt-1"
                    value={pctCucina} onChange={e => { const v = parseFloat(e.target.value) || 0; setPctCucina(v); setPctSala(100 - v) }} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">% Sala</label>
                  <input type="number" className="input w-full text-sm mt-1"
                    value={pctSala} onChange={e => { const v = parseFloat(e.target.value) || 0; setPctSala(v); setPctCucina(100 - v) }} />
                </div>
              </div>
              <p className="text-[11px] text-gray-500">
                Esecuzione su <b>{sede} · {MESI[mese - 1]} {anno}</b>. Questa azione sovrascrive i target operatori esistenti per il mese.
              </p>
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setCalcOpen(false)} className="btn-secondary">Annulla</button>
              <button onClick={handleCalcola} disabled={loading} className="btn-primary flex items-center gap-1.5">
                {loading ? <RefreshCw size={14} className="animate-spin" /> : <Calculator size={14} />} Calcola
              </button>
            </div>
          </div>
        </div>
      )}

      <ObiettivoModal
        open={modalOb.open}
        onClose={() => setModalOb({ open: false, initial: null })}
        onSave={handleSaveObiettivo}
        initial={modalOb.initial}
        sede={sede} anno={anno} mese={mese}
      />
    </div>
  )
}
