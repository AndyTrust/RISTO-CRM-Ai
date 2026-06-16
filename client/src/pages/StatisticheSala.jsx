import React, { useEffect, useState, useMemo } from 'react'
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts'
import { RefreshCw, TrendingUp, Users, Clock, ReceiptText, CalendarDays, ChefHat, Sliders, Info, AlertTriangle, Building2 } from 'lucide-react'
import { periodToDates } from '../components/DateRangePicker'
import PeriodFilter from '../components/PeriodFilter'
import PageAssistant from '../components/PageAssistant'
import supabase from '../supabase'
import PageStatsWidget from '../components/PageStatsWidget'

// statistiche_tavoli copre SOLO da questa data (verificato su Supabase).
const TAVOLI_COVERAGE_START = '2026-03-01'

const COLORS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6']
const SEDE_LABEL = { MA: 'Mameli (MA)', PN: 'Predda Niedda (PN)' }
const SEDE_COLOR = { MA: '#6366f1', PN: '#10b981' }

async function sbq(q) {
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

function eur(n) {
  return (n != null && !isNaN(n)) ? `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
}
const num = n => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('it-IT')

function Info_({ text }) {
  return (
    <span className="group relative inline-flex items-center align-middle ml-1">
      <Info size={13} className="text-gray-400 cursor-help" />
      <span className="invisible group-hover:visible absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-30 w-64 bg-gray-900 text-white text-[11px] leading-snug rounded-lg px-3 py-2 shadow-xl">
        {text}
      </span>
    </span>
  )
}

function KPICard({ icon: Icon, label, value, subtitle, info, color = 'bg-indigo-50 text-indigo-600' }) {
  return (
    <div className="kpi-card">
      <div className="flex items-center gap-1">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={18} />
        </div>
        {info && <Info_ text={info} />}
      </div>
      <p className="text-2xl font-bold mt-2">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  )
}

const timeVal = (v) => String(v || '').replace('.', ':')
const GIORNI = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato']
const GIORNI_SHORT = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab']

// ── Tab Turni Consigliati ─────────────────────────────────────────────────
function TabTurni({ location, fromDate, toDate }) {
  const [paxPerCameriere, setPaxPerCameriere] = useState(30)
  const [minSala, setMinSala]   = useState(2)
  const [maxSala, setMaxSala]   = useState(5)
  // Split pranzo% per DOW — calcolato dai dati reali chiusure_turni. Fallback iniziale.
  const [splitByDow, setSplitByDow] = useState([80, 30, 35, 35, 40, 45, 65])
  const [splitIsReal, setSplitIsReal] = useState(false)
  // Cucina: brigata base 1 primi + 1 secondi + 1 plonge fino a capCucinaBase coperti,
  // poi +1 operatore di supporto ogni paxSupporto coperti (esce a fine picco).
  const [capCucinaBase, setCapCucinaBase] = useState(60)
  const [paxSupporto,   setPaxSupporto]   = useState(30)
  const [maxSupporto,   setMaxSupporto]   = useState(3)

  // Orari standard dei turni (modificabili). Base = tutto il servizio; Supporto = solo il picco.
  const [orari, setOrari] = useState({
    cucinaPranzo: '10:30', salaPranzoArrivo: '11:00', servPranzo: '12:00', finePranzo: '15:30',
    piccoPranzoStart: '12:30', piccoPranzoEnd: '14:30',
    cucinaCena: '18:00', salaCenaArrivo: '18:00', servCena: '19:00', fineCena: '23:30',
    piccoCenaStart: '20:00', piccoCenaEnd: '22:00',
  })
  const setOra = (k, v) => setOrari(o => ({ ...o, [k]: v }))

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [byDow, setByDow] = useState([])
  const [showConfig, setShowConfig] = useState(false)
  const [curva, setCurva] = useState([])          // arrivi reali ricostruiti per fascia 30'
  const [piccoAuto, setPiccoAuto] = useState(null) // { pranzo:{start,end}, cena:{start,end} }
  const [nGiorniCurva, setNGiorniCurva] = useState(0)

  useEffect(() => {
    if (!fromDate || !toDate) return
    setLoading(true); setError(null)
    const sede = location === 'MA' ? 'MA' : location === 'PN' ? 'PN' : null

    let qCiusure = supabase.from('chiusure_giornaliere')
      .select('data, coperti').gte('data', fromDate).lte('data', toDate)
    if (sede) qCiusure = qCiusure.eq('sede', sede)

    let qTurni = supabase.from('chiusure_turni')
      .select('data, turno, quantita').gte('data', fromDate).lte('data', toDate)
      .in('turno', ['pranzo', 'cena'])
    if (sede) qTurni = qTurni.eq('sede', sede)

    let qTavoli = supabase.from('statistiche_tavoli')
      .select('data_inizio, data_chiusura, durata_media_min, n_coperti')
      .gte('data_inizio', fromDate).lte('data_inizio', toDate)
      .not('data_chiusura', 'is', null)
    if (sede) qTavoli = qTavoli.eq('sede', sede)

    Promise.all([sbq(qCiusure.range(0, 9999)), sbq(qTurni.range(0, 9999)), sbq(qTavoli.range(0, 99999))])
      .then(([chiusureData, turniData, tavoliData]) => {
        // ── byDow: media coperti per giorno ──
        const dowSum = Array(7).fill(0), dowCount = Array(7).fill(0)
        for (const r of chiusureData) {
          const dow = new Date(r.data + 'T00:00:00').getDay()
          const coperti = parseInt(r.coperti) || 0
          if (coperti > 0) { dowSum[dow] += coperti; dowCount[dow] += 1 }
        }
        setByDow(GIORNI.map((g, i) => ({
          giorno: g, giornoShort: GIORNI_SHORT[i], dow: i,
          avg_coperti: dowCount[i] > 0 ? Math.round(dowSum[i] / dowCount[i]) : 0,
          n_giorni: dowCount[i],
        })))

        // ── split pranzo/cena reale ──
        if (turniData && turniData.length > 0) {
          const dowPranzo = Array(7).fill(0), dowCena = Array(7).fill(0)
          for (const r of turniData) {
            const dow = new Date(r.data + 'T00:00:00').getDay()
            const qty = parseInt(r.quantita) || 0
            if (r.turno === 'pranzo') dowPranzo[dow] += qty
            else if (r.turno === 'cena') dowCena[dow] += qty
          }
          setSplitByDow(prev => prev.map((fallback, dow) => {
            const tot = dowPranzo[dow] + dowCena[dow]
            return tot > 0 ? Math.round(dowPranzo[dow] / tot * 100) : fallback
          }))
          setSplitIsReal(true)
        } else {
          setSplitIsReal(false)
        }

        // ── Curva oraria reale: arrivo = chiusura − durata, bucket 30' ──
        const buckets = {} // minuti → { coperti, tavoli }
        const giorniSet = new Set()
        for (const r of (tavoliData || [])) {
          const m = String(r.data_chiusura || '').match(/T(\d{2}):(\d{2})/)
          if (!m) continue
          const closeMin = (+m[1]) * 60 + (+m[2])
          const arrMin = closeMin - (parseInt(r.durata_media_min) || 0)
          if (arrMin < 0 || arrMin > 24 * 60) continue
          const b = Math.floor(arrMin / 30) * 30
          if (!buckets[b]) buckets[b] = { coperti: 0, tavoli: 0 }
          buckets[b].coperti += parseInt(r.n_coperti) || 0
          buckets[b].tavoli += 1
          if (r.data_inizio) giorniSet.add(r.data_inizio)
        }
        const nG = giorniSet.size || 1
        const fmtMin = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`
        const curvaArr = Object.keys(buckets).map(Number).sort((a, b) => a - b).map(min => ({
          min, label: fmtMin(min),
          coperti: buckets[min].coperti, tavoli: buckets[min].tavoli,
          copertiMedi: Math.round(buckets[min].coperti / nG),
          servizio: min < 16 * 60 + 30 ? 'pranzo' : 'cena',
        }))
        setCurva(curvaArr); setNGiorniCurva(nG)

        // Picco = finestra contigua con coperti ≥ 50% del max del servizio
        const piccoServizio = (serv) => {
          const bs = curvaArr.filter(b => b.servizio === serv)
          if (!bs.length) return null
          const maxC = Math.max(...bs.map(b => b.coperti))
          const above = bs.filter(b => b.coperti >= maxC * 0.5)
          if (!above.length) return null
          return { start: fmtMin(Math.min(...above.map(b => b.min))), end: fmtMin(Math.max(...above.map(b => b.min)) + 30) }
        }
        const pranzo = piccoServizio('pranzo'), cena = piccoServizio('cena')
        if (pranzo || cena) {
          setPiccoAuto({ pranzo, cena })
          setOrari(o => ({
            ...o,
            ...(pranzo ? { piccoPranzoStart: pranzo.start, piccoPranzoEnd: pranzo.end } : {}),
            ...(cena ? { piccoCenaStart: cena.start, piccoCenaEnd: cena.end } : {}),
          }))
        } else {
          setPiccoAuto(null)
        }
      })
      .catch(e => setError(e.message || String(e)))
      .finally(() => setLoading(false))
  }, [location, fromDate, toDate])

  // Sala: 1 cameriere ogni paxPerCameriere coperti, tra min e max
  const calcSala = (cop) => cop <= 0 ? 0 : Math.min(maxSala, Math.max(minSala, Math.ceil(cop / paxPerCameriere)))
  // Cucina: brigata base (1+1+1) fino a capCucinaBase coperti, poi +1 supporto ogni paxSupporto
  const calcCucina = (cop) => {
    if (cop <= 0) return { primi: 0, secondi: 0, plonge: 0, supporto: 0, tot: 0 }
    const supporto = Math.min(maxSupporto, Math.max(0, Math.ceil((cop - capCucinaBase) / paxSupporto)))
    return { primi: 1, secondi: 1, plonge: 1, supporto, tot: 3 + supporto }
  }

  const turni = useMemo(() => {
    return byDow.map(d => {
      const totCop    = d.avg_coperti
      const pctPranzo = splitByDow[d.dow] ?? 40
      const copPranzo = Math.round(totCop * pctPranzo / 100)
      const copCena   = totCop - copPranzo
      const camerierePranzo = calcSala(copPranzo)
      const cameriereCena   = calcSala(copCena)
      const cuP = calcCucina(copPranzo)
      const cuC = calcCucina(copCena)
      return {
        ...d, copPranzo, copCena, camerierePranzo, cameriereCena, cuP, cuC,
        totPersonalePranzo: camerierePranzo + cuP.tot,
        totPersonaleCena:   cameriereCena   + cuC.tot,
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDow, paxPerCameriere, minSala, maxSala, splitByDow, capCucinaBase, paxSupporto, maxSupporto])

  function StaffBadge({ n, color = 'indigo', label }) {
    if (n === 0) return <span className="text-gray-300 text-xs">—</span>
    const cls = {
      indigo:  'bg-indigo-100 text-indigo-700', emerald: 'bg-emerald-100 text-emerald-700',
      amber:   'bg-amber-100 text-amber-700', violet:  'bg-violet-100 text-violet-700',
    }
    return <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold ${cls[color]}`} title={label}>{n}</span>
  }

  if (error) return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm flex items-start gap-2">
      <AlertTriangle size={18} className="flex-shrink-0 mt-0.5"/><span>Errore nel calcolo turni: <strong>{error}</strong></span>
    </div>
  )
  if (loading) return <p className="text-center text-gray-400 py-10 text-sm animate-pulse">Calcolo turni consigliati...</p>

  const maxCop = Math.max(...turni.map(t => t.avg_coperti), 1)

  return (
    <div className="space-y-5">
      <div className="bg-gradient-to-r from-violet-50 to-indigo-50 rounded-xl border border-violet-100 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-violet-900 flex items-center gap-2 text-sm">
            <Sliders size={15} className="text-violet-600" /> Parametri organico
          </h3>
          <button onClick={() => setShowConfig(c => !c)} className="text-xs text-violet-600 hover:text-violet-800 underline">
            {showConfig ? 'Nascondi' : 'Modifica parametri'}
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="bg-white rounded-lg p-2.5 border border-violet-100">
            <div className="text-gray-500 mb-1">Pax/cameriere sala</div>
            <div className="font-bold text-violet-700 text-base">{paxPerCameriere}</div>
          </div>
          <div className="bg-white rounded-lg p-2.5 border border-violet-100">
            <div className="text-gray-500 mb-1">Sala min / max</div>
            <div className="font-bold text-violet-700 text-base">{minSala} – {maxSala}</div>
          </div>
          <div className="bg-white rounded-lg p-2.5 border border-violet-100">
            <div className="text-gray-500 mb-1">Split pranzo {splitIsReal
              ? <span className="text-emerald-600 font-medium">(reale chiusure_turni)</span>
              : <span className="text-amber-600 font-medium">(stima — no dati turni)</span>}</div>
            <div className="font-bold text-violet-700 text-base">Dom {splitByDow[0]}% · Sab {splitByDow[6]}%</div>
          </div>
          <div className="bg-white rounded-lg p-2.5 border border-violet-100">
            <div className="text-gray-500 mb-1">Cucina: base / supporto</div>
            <div className="font-bold text-violet-700 text-base">≤{capCucinaBase} cop = 3 · +1/{paxSupporto}</div>
          </div>
        </div>
        {showConfig && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg p-3 border border-violet-100 space-y-2">
              <div className="text-xs font-semibold text-violet-700 flex items-center gap-1.5"><Users size={12} /> Sala</div>
              {[
                { label: 'Pax per cameriere', val: paxPerCameriere, set: setPaxPerCameriere, min: 10, max: 60, step: 5 },
                { label: 'Camerieri minimi',  val: minSala,          set: setMinSala,          min: 1,  max: 5,  step: 1 },
                { label: 'Camerieri massimi', val: maxSala,          set: setMaxSala,          min: 2,  max: 8,  step: 1 },
              ].map(({ label, val, set, min, max, step }) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-600">{label}</span>
                  <input type="number" value={val} min={min} max={max} step={step}
                    onChange={e => set(parseInt(e.target.value))}
                    className="w-16 text-xs text-right border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400" />
                </div>
              ))}
            </div>
            <div className="bg-white rounded-lg p-3 border border-violet-100 space-y-2">
              <div className="text-xs font-semibold text-violet-700 flex items-center gap-1.5"><CalendarDays size={12} /> % Pranzo per giorno (cena = resto)</div>
              {GIORNI.map((g, i) => (
                <div key={g} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-600 w-20">{g}</span>
                  <div className="flex items-center gap-1.5">
                    <input type="range" min={10} max={80} step={5} value={splitByDow[i]}
                      onChange={e => setSplitByDow(prev => { const n=[...prev]; n[i]=parseInt(e.target.value); return n })}
                      className="w-20 accent-violet-600" />
                    <span className="text-xs font-semibold text-violet-700 w-12">{splitByDow[i]}% / {100 - splitByDow[i]}%</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-lg p-3 border border-violet-100 space-y-2">
              <div className="text-xs font-semibold text-violet-700 flex items-center gap-1.5"><ChefHat size={12} /> Cucina (brigata base + supporto)</div>
              {[
                { label: 'Coperti gestiti dalla base (1+1+1)', val: capCucinaBase, set: setCapCucinaBase, min: 30, max: 120 },
                { label: 'Coperti per operatore supporto',     val: paxSupporto,   set: setPaxSupporto,   min: 10, max: 60  },
                { label: 'Max operatori supporto',             val: maxSupporto,   set: setMaxSupporto,   min: 0,  max: 5   },
              ].map(({ label, val, set, min, max }) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-600">{label}</span>
                  <input type="number" value={val} min={min} max={max}
                    onChange={e => set(parseInt(e.target.value))}
                    className="w-16 text-xs text-right border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400" />
                </div>
              ))}
            </div>
            <div className="bg-white rounded-lg p-3 border border-violet-100 space-y-2 lg:col-span-3">
              <div className="text-xs font-semibold text-violet-700 flex items-center gap-1.5"><Clock size={12} /> Orari turni (base = tutto il servizio · supporto = solo picco)</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
                {[
                  { label: 'Cucina pranzo dalle', k: 'cucinaPranzo' },
                  { label: 'Sala pranzo arrivo', k: 'salaPranzoArrivo' },
                  { label: 'Servizio pranzo', k: 'servPranzo' },
                  { label: 'Fine pranzo', k: 'finePranzo' },
                  { label: 'Picco pranzo da', k: 'piccoPranzoStart' },
                  { label: 'Picco pranzo a', k: 'piccoPranzoEnd' },
                  { label: 'Cucina cena dalle', k: 'cucinaCena' },
                  { label: 'Sala cena prep', k: 'salaCenaArrivo' },
                  { label: 'Servizio cena', k: 'servCena' },
                  { label: 'Fine cena', k: 'fineCena' },
                  { label: 'Picco cena da', k: 'piccoCenaStart' },
                  { label: 'Picco cena a', k: 'piccoCenaEnd' },
                ].map(({ label, k }) => (
                  <div key={k} className="flex items-center justify-between gap-1">
                    <span className="text-[11px] text-gray-600">{label}</span>
                    <input type="time" value={timeVal(orari[k])} onChange={e => setOra(k, e.target.value)}
                      className="text-[11px] border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-400" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {curva.length > 0 && (() => {
        const maxC = Math.max(...curva.map(b => b.copertiMedi), 1)
        const inPicco = (b) => {
          const p = b.servizio === 'pranzo' ? piccoAuto?.pranzo : piccoAuto?.cena
          return p && b.label >= p.start && b.label < p.end
        }
        return (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-sm">
                <Clock size={15} className="text-violet-600" /> Affluenza per fascia oraria — arrivi reali ricostruiti
              </h3>
              <span className="text-[11px] text-gray-400">arrivo = chiusura tavolo − durata · {nGiorniCurva} giorni · media coperti/fascia</span>
            </div>
            {piccoAuto && (
              <p className="text-xs text-violet-700 mb-3">
                Picco rilevato dai dati: 🌞 pranzo <strong>{piccoAuto.pranzo ? `${piccoAuto.pranzo.start}–${piccoAuto.pranzo.end}` : '—'}</strong> · 🌙 cena <strong>{piccoAuto.cena ? `${piccoAuto.cena.start}–${piccoAuto.cena.end}` : '—'}</strong> — applicato automaticamente ai turni di supporto.
              </p>
            )}
            <div className="flex items-end gap-1 h-40 overflow-x-auto pb-1">
              {curva.map(b => (
                <div key={b.min} className="flex flex-col items-center justify-end flex-shrink-0" style={{ width: 30 }} title={`${b.label} · ${b.copertiMedi} coperti medi · ${b.tavoli} tavoli tot`}>
                  <div className="text-[8px] text-gray-500 mb-0.5">{b.copertiMedi}</div>
                  <div className={`w-4 rounded-t ${inPicco(b) ? (b.servizio === 'pranzo' ? 'bg-blue-600' : 'bg-indigo-600') : (b.servizio === 'pranzo' ? 'bg-blue-300' : 'bg-indigo-300')}`}
                    style={{ height: `${Math.max(4, b.copertiMedi / maxC * 120)}px` }} />
                  <div className="text-[8px] text-gray-400 mt-0.5 -rotate-45 origin-center w-6 text-center">{b.label}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-blue-300 inline-block" /> Pranzo</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-indigo-300 inline-block" /> Cena</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-violet-600 inline-block" /> Fascia di picco</span>
            </div>
          </div>
        )
      })()}

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-3 text-left font-semibold text-gray-700">Giorno</th>
              <th className="px-3 py-3 text-center font-semibold text-gray-600">Media Coperti</th>
              <th className="px-3 py-3 text-center font-semibold text-blue-700 bg-blue-50/50" colSpan={2}>🌞 PRANZO · servizio {orari.servPranzo}–{orari.finePranzo}</th>
              <th className="px-3 py-3 text-center font-semibold text-indigo-700 bg-indigo-50/50" colSpan={2}>🌙 CENA · servizio {orari.servCena}–{orari.fineCena}</th>
              <th className="px-3 py-3 text-center font-semibold text-gray-500">Tot. Giornata</th>
            </tr>
            <tr className="bg-gray-50/60 border-b border-gray-100 text-[10px] text-gray-500">
              <th className="px-3 py-1" /><th className="px-3 py-1 text-center">giornalieri</th>
              <th className="px-3 py-1 text-center bg-blue-50/30">Sala 👥 <span className="text-gray-400">(arrivo {orari.salaPranzoArrivo})</span></th><th className="px-3 py-1 text-center bg-blue-50/30">Cucina 👨‍🍳 <span className="text-gray-400">(dalle {orari.cucinaPranzo})</span></th>
              <th className="px-3 py-1 text-center bg-indigo-50/30">Sala 👥 <span className="text-gray-400">(prep {orari.salaCenaArrivo})</span></th><th className="px-3 py-1 text-center bg-indigo-50/30">Cucina 👨‍🍳 <span className="text-gray-400">(dalle {orari.cucinaCena})</span></th>
              <th className="px-3 py-1 text-center">Persone</th>
            </tr>
          </thead>
          <tbody>
            {turni.map(t => {
              const isWeekend = t.dow === 0 || t.dow === 5 || t.dow === 6
              const isEmpty   = t.avg_coperti === 0
              const barPct    = Math.round(t.avg_coperti / maxCop * 100)
              return (
                <tr key={t.dow} className={`border-b ${isWeekend ? 'bg-amber-50/30' : 'hover:bg-gray-50/40'} ${isEmpty ? 'opacity-40' : ''}`}>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-gray-900">{t.giorno}</div>
                    {t.n_giorni > 0 && <div className="text-[10px] text-gray-400">{t.n_giorni} giorni analizzati</div>}
                    {isEmpty && <div className="text-[10px] text-gray-400 italic">Chiuso / nessun dato</div>}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <div className="font-bold text-gray-900 text-sm">{t.avg_coperti || '—'}</div>
                    {t.avg_coperti > 0 && (<>
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full mx-auto mt-1 overflow-hidden">
                        <div className="h-full bg-violet-400 rounded-full" style={{ width: `${barPct}%` }} />
                      </div>
                      <div className="text-[9px] text-gray-400 mt-0.5">{splitByDow[t.dow]}%P / {100-splitByDow[t.dow]}%C</div>
                    </>)}
                  </td>
                  <td className="px-3 py-3 text-center bg-blue-50/20">
                    {!isEmpty ? (<div className="space-y-1">
                      <div><StaffBadge n={t.camerierePranzo} color="indigo" label="Camerieri sala pranzo" /><div className="text-[10px] text-gray-400 mt-0.5">camerieri</div></div>
                      {t.camerierePranzo > minSala && <div className="text-[9px] text-gray-400">−{t.camerierePranzo - minSala} escono ~{orari.piccoPranzoEnd}</div>}
                      <div className="text-[10px] text-blue-500">{t.copPranzo} cop.</div>
                    </div>) : '—'}
                  </td>
                  <td className="px-3 py-3 text-center bg-blue-50/20">
                    {!isEmpty ? (<div className="space-y-0.5 text-[10px]">
                      <div className="flex items-center justify-center gap-1"><StaffBadge n={t.cuP.primi} color="emerald" label="Primi" /><span className="text-gray-400">Primi</span></div>
                      <div className="flex items-center justify-center gap-1"><StaffBadge n={t.cuP.secondi} color="amber" label="Secondi" /><span className="text-gray-400">Secondi</span></div>
                      <div className="flex items-center justify-center gap-1"><StaffBadge n={t.cuP.plonge} color="violet" label="Plonge" /><span className="text-gray-400">Plonge</span></div>
                      {t.cuP.supporto > 0 && <div className="flex flex-col items-center"><div className="flex items-center justify-center gap-1"><StaffBadge n={t.cuP.supporto} color="indigo" label="Supporto (solo sul picco)" /><span className="text-gray-400">Supporto</span></div><span className="text-[9px] text-gray-400">{orari.piccoPranzoStart}–{orari.piccoPranzoEnd}</span></div>}
                    </div>) : '—'}
                  </td>
                  <td className="px-3 py-3 text-center bg-indigo-50/20">
                    {!isEmpty ? (<div className="space-y-1">
                      <div><StaffBadge n={t.cameriereCena} color="indigo" label="Camerieri sala cena" /><div className="text-[10px] text-gray-400 mt-0.5">camerieri</div></div>
                      {t.cameriereCena > minSala && <div className="text-[9px] text-gray-400">−{t.cameriereCena - minSala} escono ~{orari.piccoCenaEnd}</div>}
                      <div className="text-[10px] text-indigo-500">{t.copCena} cop.</div>
                    </div>) : '—'}
                  </td>
                  <td className="px-3 py-3 text-center bg-indigo-50/20">
                    {!isEmpty ? (<div className="space-y-0.5 text-[10px]">
                      <div className="flex items-center justify-center gap-1"><StaffBadge n={t.cuC.primi} color="emerald" label="Primi" /><span className="text-gray-400">Primi</span></div>
                      <div className="flex items-center justify-center gap-1"><StaffBadge n={t.cuC.secondi} color="amber" label="Secondi" /><span className="text-gray-400">Secondi</span></div>
                      <div className="flex items-center justify-center gap-1"><StaffBadge n={t.cuC.plonge} color="violet" label="Plonge" /><span className="text-gray-400">Plonge</span></div>
                      {t.cuC.supporto > 0 && <div className="flex flex-col items-center"><div className="flex items-center justify-center gap-1"><StaffBadge n={t.cuC.supporto} color="indigo" label="Supporto (solo sul picco)" /><span className="text-gray-400">Supporto</span></div><span className="text-[9px] text-gray-400">{orari.piccoCenaStart}–{orari.piccoCenaEnd}</span></div>}
                    </div>) : '—'}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {!isEmpty ? (<div>
                      <div className="font-bold text-gray-900">{t.totPersonalePranzo + t.totPersonaleCena}</div>
                      <div className="text-[10px] text-gray-400">{t.totPersonalePranzo} pran. + {t.totPersonaleCena} cena</div>
                    </div>) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-400 italic space-y-1">
        <p>
          Media coperti per giorno da <strong>chiusure_giornaliere</strong>; split pranzo/cena {splitIsReal ? 'reale da chiusure_turni' : 'stimato (dati turni assenti)'}.
          Cambia periodo/sede per analizzare stagioni diverse.
        </p>
        <p>
          <strong>Cucina</strong>: brigata base 1 Primi + 1 Secondi + 1 Plonge fino a {capCucinaBase} coperti, poi +1 di <strong>Supporto</strong> ogni {paxSupporto} coperti.
          <strong> Migliori turni</strong>: la base copre tutto il servizio, il Supporto entra solo nella <em>fascia di picco</em> ed esce prima quando l'affluenza cala (in sala i camerieri oltre il minimo {minSala} smontano a fine picco).
        </p>
        <p>
          {curva.length > 0
            ? <>Le <strong>fasce di picco</strong> sono ora <strong>ricostruite dai dati reali</strong> (orario d'arrivo = chiusura tavolo − durata, da <strong>statistiche_tavoli</strong>), non più stimate. Modificabili comunque in Orari turni.</>
            : <>Nessun dato tavoli con orario nel periodo: le fasce di picco restano quelle impostate in Orari turni. Scarica le statistiche tavoli per ottenere i picchi reali.</>}
        </p>
      </div>
    </div>
  )
}

export default function StatisticheSala() {
  const [tab, setTab] = useState('split-turni')
  const [location, setLocation] = useState('')   // '' = tutte, 'MA', 'PN'
  const [period, setPeriod] = useState('month')
  const [dates, setDates] = useState(periodToDates('month'))

  const fromDate = dates?.from || ''
  const toDate   = dates?.to   || ''
  const handleDateChange = (pid, d) => { setPeriod(pid); if (d) setDates(d) }
  const sedeFilter = location === 'MA' || location === 'PN' ? location : null
  const tavoliCoverageWarning = fromDate && fromDate < TAVOLI_COVERAGE_START

  // Raw data
  const [chiusure, setChiusure] = useState([])   // chiusure_giornaliere
  const [tavoli, setTavoli]     = useState([])   // statistiche_tavoli
  const [turni, setTurni]       = useState([])   // chiusure_turni
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const tabs = [
    { id: 'split-turni',  label: 'Pranzo / Cena' },
    { id: 'operatori',    label: 'Operatori Sala' },
    { id: 'tavoli',       label: 'Tavoli & Stanze' },
    { id: 'giornaliero',  label: 'Trend Giornaliero' },
    { id: 'turni',        label: '👥 Turni Consigliati' },
  ]

  async function fetchData() {
    if (!fromDate || !toDate) return
    setLoading(true); setError(null)
    try {
      let qc = supabase.from('chiusure_giornaliere')
        .select('sede, data, totale_venduto_ipratico, coperti, coperto_medio, scontrino_medio')
        .gte('data', fromDate).lte('data', toDate)
      if (sedeFilter) qc = qc.eq('sede', sedeFilter)

      let qt = supabase.from('statistiche_tavoli')
        .select('sede, data_inizio, tavolo, nome_stanza, operatore, n_coperti, n_ordini, n_coperture, durata_media_min, incasso, scontrino_medio')
        .gte('data_inizio', fromDate).lte('data_inizio', toDate + 'T23:59:59')
      if (sedeFilter) qt = qt.eq('sede', sedeFilter)

      let qtu = supabase.from('chiusure_turni')
        .select('sede, data, turno, incasso, quantita')
        .gte('data', fromDate).lte('data', toDate)
        .in('turno', ['pranzo', 'cena'])
      if (sedeFilter) qtu = qtu.eq('sede', sedeFilter)

      const [cRows, tRows, tuRows] = await Promise.all([
        sbq(qc.order('data').range(0, 9999)),
        sbq(qt.range(0, 9999)),
        sbq(qtu.range(0, 9999)),
      ])
      setChiusure(cRows); setTavoli(tRows); setTurni(tuRows)
    } catch (err) {
      setError(err.message || String(err))
      setChiusure([]); setTavoli([]); setTurni([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [location, fromDate, toDate])

  // ── KPI (corretti) ─────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const totCoperti = chiusure.reduce((s,d)=>s+(d.coperti||0),0)
    const totVenduto = chiusure.reduce((s,d)=>s+(d.totale_venduto_ipratico||0),0)
    const copertMedio = totCoperti > 0 ? totVenduto / totCoperti : 0
    // FIX bug: media coperti/tavolo = media n_coperti da statistiche_tavoli (NON coperti/tavoli da fonti diverse)
    const tavoliConCop = tavoli.filter(t => t.n_coperti != null)
    const mediaCopertiTavolo = tavoliConCop.length > 0
      ? tavoliConCop.reduce((s,t)=>s+(t.n_coperti||0),0) / tavoliConCop.length : 0
    const tavoliServiti = tavoli.length  // una riga = un tavolo aperto/chiuso
    const durate = tavoli.filter(t => t.durata_media_min > 0)
    const mediaPermanenza = durate.length > 0
      ? Math.round(durate.reduce((s,t)=>s+t.durata_media_min,0) / durate.length) : 0
    return { totCoperti, totVenduto, copertMedio, mediaCopertiTavolo, tavoliServiti, mediaPermanenza }
  }, [chiusure, tavoli])

  // ── Confronto MA vs PN (sede = tutte) ──────────────────────────────────────
  const perSede = useMemo(() => {
    if (sedeFilter) return null
    const out = {}
    for (const code of ['MA','PN']) {
      const cr = chiusure.filter(d=>d.sede===code)
      const tr = tavoli.filter(d=>d.sede===code)
      const cop = cr.reduce((s,d)=>s+(d.coperti||0),0)
      const ven = cr.reduce((s,d)=>s+(d.totale_venduto_ipratico||0),0)
      const dur = tr.filter(t=>t.durata_media_min>0)
      out[code] = {
        coperti: cop, venduto: ven, giorni: cr.length,
        copertMedio: cop>0?ven/cop:0,
        tavoliServiti: tr.length,
        mediaCopTavolo: tr.length>0?tr.reduce((s,t)=>s+(t.n_coperti||0),0)/tr.length:0,
        mediaPermanenza: dur.length>0?Math.round(dur.reduce((s,t)=>s+t.durata_media_min,0)/dur.length):0,
      }
    }
    return out
  }, [chiusure, tavoli, sedeFilter])

  // ── Split pranzo/cena reale (chiusure_turni) ───────────────────────────────
  const split = useMemo(() => {
    if (!turni.length) return null
    const acc = { pranzo:{inc:0,q:0,n:0}, cena:{inc:0,q:0,n:0} }
    turni.forEach(r => {
      const t = r.turno === 'pranzo' ? 'pranzo' : r.turno === 'cena' ? 'cena' : null
      if (!t) return
      acc[t].inc += (r.incasso||0); acc[t].q += (r.quantita||0); acc[t].n += 1
    })
    const totInc = acc.pranzo.inc + acc.cena.inc
    const totQ = acc.pranzo.q + acc.cena.q
    return {
      totInc, totQ,
      pranzo: { ...acc.pranzo, incMedio: acc.pranzo.n>0?acc.pranzo.inc/acc.pranzo.n:0, shareInc: totInc>0?acc.pranzo.inc/totInc*100:0, shareQ: totQ>0?acc.pranzo.q/totQ*100:0 },
      cena:   { ...acc.cena,   incMedio: acc.cena.n>0?acc.cena.inc/acc.cena.n:0,       shareInc: totInc>0?acc.cena.inc/totInc*100:0,   shareQ: totQ>0?acc.cena.q/totQ*100:0 },
    }
  }, [turni])

  // Split per DOW (grafico)
  const splitByDow = useMemo(() => {
    const acc = Array(7).fill(null).map((_,i)=>({ giorno: GIORNI_SHORT[i], pranzo:0, cena:0 }))
    turni.forEach(r => {
      const dow = new Date(r.data+'T00:00:00').getDay()
      if (r.turno==='pranzo') acc[dow].pranzo += (r.incasso||0)
      else if (r.turno==='cena') acc[dow].cena += (r.incasso||0)
    })
    return acc
  }, [turni])

  // ── Operatori sala (statistiche_tavoli) ────────────────────────────────────
  const operatori = useMemo(() => {
    const agg = {}
    tavoli.forEach(t => {
      const op = t.operatore || 'Non assegnato'
      const k = `${t.sede}·${op}`
      if (!agg[k]) agg[k] = { key:k, operatore:op, sede:t.sede, incasso:0, n_coperti:0, n_tavoli:0, durataSum:0, durataN:0 }
      agg[k].incasso += (t.incasso||0)
      agg[k].n_coperti += (t.n_coperti||0)
      agg[k].n_tavoli += 1
      if (t.durata_media_min>0) { agg[k].durataSum += t.durata_media_min; agg[k].durataN += 1 }
    })
    return Object.values(agg).map(a=>({
      ...a,
      coperto_medio: a.n_coperti>0?a.incasso/a.n_coperti:0,
      incasso_per_tavolo: a.n_tavoli>0?a.incasso/a.n_tavoli:0,
      durata_media: a.durataN>0?Math.round(a.durataSum/a.durataN):0,
    })).sort((a,b)=>b.incasso-a.incasso)
  }, [tavoli])

  // ── Tavoli & Stanze (statistiche_tavoli) ───────────────────────────────────
  const tavoliAgg = useMemo(() => {
    const agg = {}
    tavoli.forEach(t => {
      const k = `${t.sede}·${t.tavolo}`
      if (!agg[k]) agg[k] = { key:k, sede:t.sede, tavolo:t.tavolo, stanza:t.nome_stanza||'Sala / non assegnata', incasso:0, n_coperti:0, n_ordini:0, durataSum:0, scontrinoSum:0, count:0 }
      const a=agg[k]
      a.incasso += (t.incasso||0); a.n_coperti += (t.n_coperti||0); a.n_ordini += (t.n_ordini||0)
      a.durataSum += (t.durata_media_min||0); a.scontrinoSum += (t.scontrino_medio||0); a.count++
    })
    return Object.values(agg).map(a=>({
      ...a,
      coperti_medi: a.count>0?a.n_coperti/a.count:0,
      durata_media: a.count>0?a.durataSum/a.count:0,
      scontrino_medio: a.count>0?a.scontrinoSum/a.count:0,
      incasso_per_min: a.durataSum>0?a.incasso/a.durataSum:0,
    })).sort((a,b)=>b.incasso-a.incasso)
  }, [tavoli])

  // ── Trend giornaliero (chiusure_giornaliere) ───────────────────────────────
  const giornaliero = useMemo(() => {
    if (sedeFilter) {
      return [...chiusure].sort((a,b)=>a.data.localeCompare(b.data)).map(d=>({
        data: d.data, n_coperti: d.coperti||0,
        incasso_totale: d.totale_venduto_ipratico||0, coperto_medio: d.coperto_medio||0,
      }))
    }
    // sede = tutte: somma per data
    const grp = {}
    chiusure.forEach(d=>{
      if (!grp[d.data]) grp[d.data] = { data:d.data, n_coperti:0, incasso_totale:0 }
      grp[d.data].n_coperti += (d.coperti||0)
      grp[d.data].incasso_totale += (d.totale_venduto_ipratico||0)
    })
    return Object.values(grp).sort((a,b)=>a.data.localeCompare(b.data)).map(d=>({
      ...d, coperto_medio: d.n_coperti>0?d.incasso_totale/d.n_coperti:0,
    }))
  }, [chiusure, sedeFilter])

  // coerenza incrociata
  const scostamento = useMemo(() => {
    if (tavoliCoverageWarning) return null
    const incTavoli = tavoli.reduce((s,t)=>s+(t.incasso||0),0)
    if (!kpi.totVenduto || !incTavoli) return null
    return { incTavoli, pct: ((incTavoli - kpi.totVenduto)/kpi.totVenduto)*100 }
  }, [tavoli, kpi, tavoliCoverageWarning])

  const periodoLabel = `${fromDate?.split('-').reverse().join('/')} → ${toDate?.split('-').reverse().join('/')}`
  const sedeLabel = sedeFilter ? SEDE_LABEL[sedeFilter] : 'Tutte le sedi (globale)'

  return (
    <>
    <PageStatsWidget />
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Statistiche Sala</h1>
          <p className="text-sm text-gray-500 mt-0.5">Permanenza, operatori, tavoli e split pranzo/cena — dati in tempo reale da Supabase, sempre filtrati per periodo e sede.</p>
        </div>
        <button onClick={fetchData} disabled={loading} className="btn-primary">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> {loading ? 'Aggiornamento...' : 'Ricarica dati'}
        </button>
      </div>

      <PeriodFilter period={period} dates={dates} onChange={handleDateChange}
        extra={
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Sede</label>
            <select value={location} onChange={e => setLocation(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:ring-2 focus:ring-blue-300 outline-none">
              <option value="">Tutte le sedi</option>
              <option value="MA">Mameli (MA)</option>
              <option value="PN">Predda Niedda (PN)</option>
            </select>
          </div>
        } />

      <div className="text-xs text-gray-500 flex items-center gap-1.5">
        <Building2 size={13}/> Vista: <strong>{sedeLabel}</strong> · Periodo: <strong>{periodoLabel}</strong>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm flex items-start gap-2">
          <AlertTriangle size={18} className="flex-shrink-0 mt-0.5"/><span>Errore nel caricamento da Supabase: <strong>{error}</strong></span>
        </div>
      )}

      {tavoliCoverageWarning && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs flex items-start gap-2">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-amber-500"/>
          <span>Le statistiche per tavolo (permanenza, operatori, tavoli&stanze) esistono solo dal <strong>{TAVOLI_COVERAGE_START.split('-').reverse().join('/')}</strong>. Il periodo inizia prima: quei blocchi mostrano solo la parte coperta. Coperti, venduto e split turni sono completi.</span>
        </div>
      )}

      {/* KPI Cards — corretti */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard icon={ReceiptText} label="Tavoli serviti" value={loading?'…':num(kpi.tavoliServiti)}
          subtitle="record statistiche_tavoli" color="bg-violet-50 text-violet-600"
          info="Numero di tavoli aperti/chiusi nel periodo/sede (count righe statistiche_tavoli). Un record = un tavolo servito."/>
        <KPICard icon={Users} label="Media coperti/tavolo" value={loading?'…':(kpi.tavoliServiti>0?kpi.mediaCopertiTavolo.toFixed(1):'—')}
          subtitle="avg(n_coperti) per tavolo" color="bg-blue-50 text-blue-600"
          info="FIX: media di n_coperti dalla tabella statistiche_tavoli. Prima divideva i coperti totali (chiusure) per i tavoli (statistiche): valore gonfiato e privo di senso."/>
        <KPICard icon={Clock} label="Media permanenza" value={loading?'…':(kpi.mediaPermanenza>0?`${kpi.mediaPermanenza} min`:'—')}
          subtitle="durata_media_min" color="bg-amber-50 text-amber-600"
          info="Media di durata_media_min sui tavoli con durata > 0 (statistiche_tavoli) nel periodo/sede."/>
        <KPICard icon={TrendingUp} label="Coperto medio" value={loading?'…':eur(kpi.copertMedio)}
          subtitle="venduto ÷ coperti" color="bg-green-50 text-green-600"
          info="Totale venduto iPratico ÷ coperti totali (chiusure_giornaliere)."/>
      </div>

      {/* Coerenza incrociata */}
      {!loading && scostamento && (
        <div className={`rounded-lg p-3 text-xs flex items-center gap-2 border ${
          Math.abs(scostamento.pct) <= 5 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          <RefreshCw size={14} className="flex-shrink-0"/>
          <span><strong>Check fonti:</strong> incasso tavoli {eur(scostamento.incTavoli)} vs venduto chiusure {eur(kpi.totVenduto)} · scostamento <strong>{scostamento.pct>0?'+':''}{scostamento.pct.toFixed(1)}%</strong>{Math.abs(scostamento.pct)<=5?' — coerente.':' — scostamento elevato (copertura tavoli parziale).'}</span>
        </div>
      )}

      {/* Confronto MA vs PN */}
      {!loading && !sedeFilter && perSede && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {['MA','PN'].map(code=>{
            const s = perSede[code]
            return (
              <div key={code} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-3 h-3 rounded-full" style={{background:SEDE_COLOR[code]}}/>
                  <h3 className="font-semibold text-gray-800 text-sm">{SEDE_LABEL[code]}</h3>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div><div className="text-gray-400 text-xs">Coperti</div><div className="font-bold text-gray-800">{num(s.coperti)}</div></div>
                  <div><div className="text-gray-400 text-xs">Venduto</div><div className="font-bold text-gray-800">{eur(s.venduto)}</div></div>
                  <div><div className="text-gray-400 text-xs">Coperto medio</div><div className="font-bold text-gray-800">{eur(s.copertMedio)}</div></div>
                  <div><div className="text-gray-400 text-xs">Tavoli serviti</div><div className="font-bold text-gray-800">{num(s.tavoliServiti)}</div></div>
                  <div><div className="text-gray-400 text-xs">Cop./tavolo</div><div className="font-bold text-gray-800">{s.tavoliServiti>0?s.mediaCopTavolo.toFixed(1):'—'}</div></div>
                  <div><div className="text-gray-400 text-xs">Permanenza</div><div className="font-bold text-gray-800">{s.mediaPermanenza>0?`${s.mediaPermanenza}′`:'—'}</div></div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-violet-500 text-violet-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>{t.label}</button>
        ))}
      </div>

      {/* ── Split Pranzo / Cena (reale) ───────────────────────────────────── */}
      {tab === 'split-turni' && (
        <div className="space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800 flex items-start gap-2">
            <span className="mt-0.5">✅</span>
            <span><strong>Dati reali</strong> — incasso e quantità per turno dalla tabella <code>chiusure_turni</code> (iPratico). Nessuna distribuzione simulata.</span>
          </div>
          {!split ? (
            <div className="card"><div className="card-body text-center py-8"><p className="text-gray-500">Dati non disponibili per il periodo</p></div></div>
          ) : (<>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[['pranzo','🌞 Pranzo','bg-blue-50 border-blue-100 text-blue-700'],
                ['cena','🌙 Cena','bg-indigo-50 border-indigo-100 text-indigo-700']].map(([k,lbl,cls])=>{
                const t = split[k]
                return (
                  <div key={k} className={`rounded-xl border p-4 ${cls}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-sm">{lbl}</span>
                      <span className="text-2xl font-bold">{t.shareInc.toFixed(0)}%</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div><div className="opacity-60">Incasso tot.</div><div className="font-bold">{eur(t.inc)}</div></div>
                      <div><div className="opacity-60">Incasso medio/giorno</div><div className="font-bold">{eur(t.incMedio)}</div></div>
                      <div><div className="opacity-60">Pz venduti</div><div className="font-bold">{num(t.q)}</div></div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="card">
              <div className="card-header"><h2 className="font-semibold flex items-center gap-1">Incasso per turno e giorno settimana <Info_ text="Incasso pranzo vs cena aggregato per giorno della settimana. Fonte chiusure_turni."/></h2></div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={splitByDow} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="giorno" /><YAxis tickFormatter={v=>`€${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v,n)=>[eur(v),n==='pranzo'?'Pranzo':'Cena']} />
                    <Legend formatter={v=>v==='pranzo'?'Pranzo':'Cena'} />
                    <Bar dataKey="pranzo" stackId="a" fill="#3b82f6" name="pranzo" />
                    <Bar dataKey="cena" stackId="a" fill="#6366f1" name="cena" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>)}
        </div>
      )}

      {/* ── Operatori Sala ────────────────────────────────────────────────── */}
      {tab === 'operatori' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700 flex items-start gap-2">
            <Info size={14} className="mt-0.5 flex-shrink-0"/>
            <span>Performance operatore di sala da <code>statistiche_tavoli.operatore</code> (chi ha aperto/chiuso il tavolo). Periodo {periodoLabel}.</span>
          </div>
          {tavoliCoverageWarning && <div className="text-xs text-amber-600">Copertura tavoli parziale per il periodo selezionato.</div>}
          {operatori.length === 0 ? (
            <div className="card"><div className="card-body text-center py-8"><p className="text-gray-500">Dati non disponibili per il periodo</p></div></div>
          ) : (<>
            <div className="card">
              <div className="card-header"><h2 className="font-semibold">Ranking operatori per incasso tavoli</h2></div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={Math.max(200, operatori.length*46)}>
                  <BarChart data={operatori} layout="vertical" margin={{ top: 5, right: 60, left: 150, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={v=>`€${(v/1000).toFixed(0)}k`} />
                    <YAxis dataKey="operatore" type="category" width={140} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={v => eur(v)} />
                    <Bar dataKey="incasso" fill="#6366f1">
                      {operatori.map((op, idx) => (<Cell key={idx} fill={SEDE_COLOR[op.sede] || COLORS[idx % COLORS.length]} />))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="space-y-3">
              <h3 className="font-semibold">Dettagli operatori</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {operatori.map((op, idx) => (
                  <div key={op.key} className="card p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: SEDE_COLOR[op.sede] || COLORS[idx % COLORS.length] }}>
                        {op.operatore?.charAt(0) || '?'}
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm">{op.operatore}</h4>
                        <p className="text-xs text-gray-400">{SEDE_LABEL[op.sede] || op.sede}</p>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-gray-500">Tavoli serviti</span><span className="font-semibold">{num(op.n_tavoli)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Coperti totali</span><span className="font-semibold">{num(op.n_coperti)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Coperto medio</span><span className="font-semibold">{eur(op.coperto_medio)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Incasso/tavolo</span><span className="font-semibold">{eur(op.incasso_per_tavolo)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Permanenza media</span><span className="font-semibold">{op.durata_media>0?`${op.durata_media} min`:'—'}</span></div>
                      <div className="pt-2 border-t border-gray-200 mt-2 flex justify-between"><span className="text-gray-500">Incasso totale</span><span className="font-bold text-violet-600">{eur(op.incasso)}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>)}
        </div>
      )}

      {/* ── Tavoli & Stanze ───────────────────────────────────────────────── */}
      {tab === 'tavoli' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700 flex items-start gap-2">
            <Info size={14} className="mt-0.5 flex-shrink-0"/>
            <span>Performance per tavolo da <code>statistiche_tavoli</code>, raggruppata per stanza (<code>nome_stanza</code>). €/min = incasso ÷ minuti totali di occupazione. Periodo {periodoLabel}.</span>
          </div>
          {tavoliAgg.length === 0 ? (
            <div className="card"><div className="card-body text-center py-8"><p className="text-gray-500">Dati non disponibili per il periodo</p></div></div>
          ) : (<>
            <div className="card">
              <div className="card-header"><h2 className="font-semibold">Performance tavoli (top per incasso)</h2></div>
              <div className="card-body overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-200"><tr>
                    <th className="text-left py-2 px-3 font-semibold">Stanza</th>
                    {!sedeFilter && <th className="text-left py-2 px-3 font-semibold">Sede</th>}
                    <th className="text-right py-2 px-3 font-semibold">Tavolo</th>
                    <th className="text-right py-2 px-3 font-semibold">Aperture</th>
                    <th className="text-right py-2 px-3 font-semibold">Coperti medi</th>
                    <th className="text-right py-2 px-3 font-semibold">Permanenza media</th>
                    <th className="text-right py-2 px-3 font-semibold">€/min</th>
                    <th className="text-right py-2 px-3 font-semibold">Scontrino medio</th>
                    <th className="text-right py-2 px-3 font-semibold">Incasso</th>
                  </tr></thead>
                  <tbody>
                    {tavoliAgg.map(t => (
                      <tr key={t.key} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-3 font-medium">{t.stanza}</td>
                        {!sedeFilter && <td className="py-2 px-3 text-gray-500">{t.sede}</td>}
                        <td className="text-right py-2 px-3">{t.tavolo}</td>
                        <td className="text-right py-2 px-3">{t.count}</td>
                        <td className="text-right py-2 px-3">{t.coperti_medi.toFixed(1)}</td>
                        <td className="text-right py-2 px-3">{t.durata_media>0?`${Math.round(t.durata_media)} min`:'—'}</td>
                        <td className="text-right py-2 px-3">{t.incasso_per_min>0?eur(t.incasso_per_min):'—'}</td>
                        <td className="text-right py-2 px-3">{t.scontrino_medio>0?eur(t.scontrino_medio):'—'}</td>
                        <td className="text-right py-2 px-3 font-semibold">{eur(t.incasso)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h2 className="font-semibold">Incasso per stanza</h2></div>
              <div className="card-body">
                {Array.from(new Set(tavoliAgg.map(t=>t.stanza))).map(stanza=>{
                  const stTav = tavoliAgg.filter(t=>t.stanza===stanza)
                  const incStanza = stTav.reduce((s,t)=>s+t.incasso,0)
                  const maxInc = Math.max(...stTav.map(t=>t.incasso),1)
                  return (
                    <div key={stanza} className="mb-6">
                      <h3 className="font-semibold text-sm mb-3 flex items-center justify-between">
                        <span>{stanza}</span><span className="text-xs text-gray-500 font-normal">{eur(incStanza)} · {stTav.length} tavoli</span>
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                        {stTav.map(t=>{
                          const intensita = t.incasso/maxInc
                          let bg='#6366f1'
                          if (intensita>=0.8) bg='#10b981'; else if (intensita>=0.5) bg='#3b82f6'; else if (intensita>=0.25) bg='#6366f1'; else bg='#a5b4fc'
                          return (
                            <div key={t.key} className="p-3 rounded-lg text-center text-white text-xs font-semibold" style={{backgroundColor:bg}}
                              title={`Tavolo ${t.tavolo}${!sedeFilter?' ('+t.sede+')':''}: ${eur(t.incasso)} · ${t.coperti_medi.toFixed(1)} cop. medi · ${Math.round(t.durata_media)}′`}>
                              <div>{t.tavolo}{!sedeFilter && <span className="opacity-70 text-[10px]"> {t.sede}</span>}</div>
                              <div className="text-[10px] opacity-80">€{(t.incasso/1000).toFixed(1)}k</div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>)}
        </div>
      )}

      {/* ── Trend Giornaliero ─────────────────────────────────────────────── */}
      {tab === 'giornaliero' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700 flex items-start gap-2">
            <Info size={14} className="mt-0.5 flex-shrink-0"/>
            <span>Coperti e venduto per giorno da <code>chiusure_giornaliere</code> ({sedeFilter?SEDE_LABEL[sedeFilter]:'somma MA+PN'}). Coperto medio = venduto ÷ coperti.</span>
          </div>
          {giornaliero.length === 0 ? (
            <div className="card"><div className="card-body text-center py-8"><p className="text-gray-500">Dati non disponibili per il periodo</p></div></div>
          ) : (<>
            <div className="card">
              <div className="card-header"><h2 className="font-semibold">Trend coperti e venduto giornaliero</h2></div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={350}>
                  <AreaChart data={giornaliero} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="colorCoperti" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient>
                      <linearGradient id="colorIncasso" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="data" tickFormatter={v=>v?.slice(5)} />
                    <YAxis yAxisId="left" /><YAxis yAxisId="right" orientation="right" tickFormatter={v=>`€${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={(value, name) => {
                      if (name === 'Coperti') return [value, 'Coperti']
                      if (name === 'Venduto') return [eur(value), 'Venduto']
                      if (name === 'Coperto medio') return [eur(value), 'Coperto medio']
                      return value
                    }} labelFormatter={l=>`Data: ${l}`} />
                    <Legend />
                    <Area yAxisId="left" type="monotone" dataKey="n_coperti" stroke="#3b82f6" fillOpacity={1} fill="url(#colorCoperti)" name="Coperti" />
                    <Area yAxisId="right" type="monotone" dataKey="incasso_totale" stroke="#10b981" fillOpacity={1} fill="url(#colorIncasso)" name="Venduto" />
                    <Line yAxisId="right" type="monotone" dataKey="coperto_medio" stroke="#f59e0b" strokeWidth={2} dot={false} name="Coperto medio" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h2 className="font-semibold">Dettagli giornalieri</h2></div>
              <div className="card-body overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-200"><tr>
                    <th className="text-left py-2 px-3 font-semibold">Data</th>
                    <th className="text-right py-2 px-3 font-semibold">Coperti</th>
                    <th className="text-right py-2 px-3 font-semibold">Coperto medio</th>
                    <th className="text-right py-2 px-3 font-semibold">Venduto totale</th>
                  </tr></thead>
                  <tbody>
                    {giornaliero.map((g, idx) => (
                      <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-3 font-medium">{g.data}</td>
                        <td className="text-right py-2 px-3">{g.n_coperti || '—'}</td>
                        <td className="text-right py-2 px-3">{g.coperto_medio ? eur(g.coperto_medio) : '—'}</td>
                        <td className="text-right py-2 px-3 font-semibold">{eur(g.incasso_totale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>)}
        </div>
      )}

      {/* ── Turni Consigliati ─────────────────────────────────────────────── */}
      {tab === 'turni' && (
        <div className="space-y-4">
          <div className="bg-violet-50 border border-violet-100 rounded-lg p-3 text-xs text-violet-700">
            👥 <strong>Turni Consigliati</strong> — organico suggerito per fascia oraria sulla media storica dei coperti per giorno (chiusure_giornaliere) e lo split pranzo/cena reale (chiusure_turni). Parametri modificabili in tempo reale.
          </div>
          <TabTurni location={location} fromDate={fromDate} toDate={toDate} />
        </div>
      )}
    </div>
      <PageAssistant
        pagina="Statistiche Sala"
        suggerimenti={[
          "Quale tavolo genera più incasso?",
          "Media permanenza dei clienti",
          "Split pranzo vs cena per sede",
        ]}
      />
    </>
  )
}
