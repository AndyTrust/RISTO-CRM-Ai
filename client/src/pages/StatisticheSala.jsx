import React, { useEffect, useState, useMemo } from 'react'
import { statistiche as statisticheApi } from '../api/client'
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts'
import { MapPin, RefreshCw, TrendingUp, Users, Clock, ReceiptText, CalendarDays, ChefHat, Sliders } from 'lucide-react'
import DateRangePicker, { periodToDates } from '../components/DateRangePicker'
import PageAssistant from '../components/PageAssistant'
import supabase from '../supabase'
import PageStatsWidget from '../components/PageStatsWidget'

const COLORS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6']

function eur(n) {
  return n != null ? `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
}

function formatDate(d) {
  if (!d) return ''
  if (typeof d === 'string') return d.substring(0, 10)
  return d.toISOString().substring(0, 10)
}

function KPICard({ icon: Icon, label, value, subtitle, color = 'bg-indigo-50 text-indigo-600' }) {
  return (
    <div className="kpi-card">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
        <Icon size={18} />
      </div>
      <p className="text-2xl font-bold mt-2">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  )
}

// ── Tab Turni Consigliati ─────────────────────────────────────────────────
const GIORNI = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato']
const GIORNI_SHORT = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab']

function TabTurni({ location, fromDate, toDate }) {
  // Config turni
  const [paxPerCameriere, setPaxPerCameriere] = useState(30)
  const [minSala, setMinSala]   = useState(2)
  const [maxSala, setMaxSala]   = useState(5)
  // Split pranzo per giorno — calcolato dai dati reali chiusure_turni (iPratico)
  // Valori iniziali come fallback se i dati non sono ancora disponibili
  const [splitByDow, setSplitByDow] = useState([80, 30, 35, 35, 40, 45, 65])
  // Config cucina
  const [paxPrimi,   setPaxPrimi]   = useState(30) // coperti per cuoco ai primi
  const [paxSecondi, setPaxSecondi] = useState(30) // coperti per cuoco ai secondi
  const [maxPrimi,   setMaxPrimi]   = useState(2)
  const [maxSecondi, setMaxSecondi] = useState(2)
  const [maxPlonge,  setMaxPlonge]  = useState(2)

  const [loading, setLoading] = useState(true)
  const [byDow, setByDow] = useState([])   // media coperti per day-of-week [0=dom .. 6=sab]
  const [showConfig, setShowConfig] = useState(false)

  useEffect(() => {
    if (!fromDate || !toDate) return
    setLoading(true)
    const sede = location === 'MA' ? 'MA' : location === 'PN' ? 'PN' : null

    // Query 1: coperti totali per DOW da chiusure_giornaliere
    let qCiusure = supabase.from('chiusure_giornaliere')
      .select('data, coperti')
      .gte('data', fromDate).lte('data', toDate)
    if (sede) qCiusure = qCiusure.eq('sede', sede)

    // Query 2: split pranzo/cena reale da chiusure_turni (dati iPratico)
    let qTurni = supabase.from('chiusure_turni')
      .select('data, turno, quantita')
      .gte('data', fromDate).lte('data', toDate)
      .in('turno', ['pranzo', 'cena'])
    if (sede) qTurni = qTurni.eq('sede', sede)

    Promise.all([
      qCiusure.range(0, 9999),
      qTurni.range(0, 9999),
    ]).then(([{ data: chiusureData }, { data: turniData }]) => {
      // Aggrega coperti per DOW
      const dowSum   = Array(7).fill(0)
      const dowCount = Array(7).fill(0)
      for (const r of chiusureData || []) {
        const dow     = new Date(r.data + 'T00:00:00').getDay()
        const coperti = parseInt(r.coperti) || 0
        if (coperti > 0) { dowSum[dow] += coperti; dowCount[dow] += 1 }
      }
      setByDow(GIORNI.map((g, i) => ({
        giorno: g, giornoShort: GIORNI_SHORT[i], dow: i,
        avg_coperti: dowCount[i] > 0 ? Math.round(dowSum[i] / dowCount[i]) : 0,
        n_giorni:    dowCount[i],
      })))

      // Calcola split pranzo % reale per DOW da chiusure_turni
      if (turniData && turniData.length > 0) {
        const dowPranzo = Array(7).fill(0)
        const dowCena   = Array(7).fill(0)
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
      }
    }).finally(() => setLoading(false))
  }, [location, fromDate, toDate])

  // Calcola organico consigliato per fascia e giorno
  const turni = useMemo(() => {
    return byDow.map(d => {
      const totCop    = d.avg_coperti
      const pctPranzo = splitByDow[d.dow] ?? 40
      const copPranzo = Math.round(totCop * pctPranzo / 100)
      const copCena   = totCop - copPranzo

      // Sala
      const camerierePranzo = totCop === 0 ? 0 : Math.min(maxSala, Math.max(minSala, Math.ceil(copPranzo / paxPerCameriere)))
      const cameriereCena   = totCop === 0 ? 0 : Math.min(maxSala, Math.max(minSala, Math.ceil(copCena   / paxPerCameriere)))

      // Cucina: rinforzo ogni paxPrimi coperti
      const cuochiPrimiP   = totCop === 0 ? 0 : Math.min(maxPrimi,   Math.max(1, Math.ceil(copPranzo / paxPrimi)))
      const cuochiSecondiP = totCop === 0 ? 0 : Math.min(maxSecondi, Math.max(1, Math.ceil(copPranzo / paxSecondi)))
      const cuochiPrimiC   = totCop === 0 ? 0 : Math.min(maxPrimi,   Math.max(1, Math.ceil(copCena   / paxPrimi)))
      const cuochiSecondiC = totCop === 0 ? 0 : Math.min(maxSecondi, Math.max(1, Math.ceil(copCena   / paxSecondi)))

      // Plonge: 1 se ci sono coperti, max 2
      const plongeP = totCop === 0 ? 0 : Math.min(maxPlonge, Math.ceil(copPranzo / (paxPrimi * 1.5)))
      const plongeC = totCop === 0 ? 0 : Math.min(maxPlonge, Math.ceil(copCena   / (paxPrimi * 1.5)))

      return {
        ...d,
        copPranzo, copCena,
        camerierePranzo, cameriereCena,
        cuochiPrimiP, cuochiSecondiP, plongeP,
        cuochiPrimiC, cuochiSecondiC, plongeC,
        totPersonalePranzo: camerierePranzo + cuochiPrimiP + cuochiSecondiP + Math.max(1, plongeP),
        totPersonaleCena:   cameriereCena   + cuochiPrimiC + cuochiSecondiC + Math.max(1, plongeC),
      }
    })
  }, [byDow, paxPerCameriere, minSala, maxSala, splitByDow, paxPrimi, paxSecondi, maxPrimi, maxSecondi, maxPlonge])

  function StaffBadge({ n, color = 'indigo', label }) {
    if (n === 0) return <span className="text-gray-300 text-xs">—</span>
    const cls = {
      indigo:  'bg-indigo-100 text-indigo-700',
      emerald: 'bg-emerald-100 text-emerald-700',
      amber:   'bg-amber-100 text-amber-700',
      violet:  'bg-violet-100 text-violet-700',
    }
    return (
      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold ${cls[color]}`} title={label}>
        {n}
      </span>
    )
  }

  if (loading) return <p className="text-center text-gray-400 py-10 text-sm animate-pulse">Calcolo turni consigliati...</p>

  const maxCop = Math.max(...turni.map(t => t.avg_coperti), 1)

  return (
    <div className="space-y-5">

      {/* ── Config Panel ────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-violet-50 to-indigo-50 rounded-xl border border-violet-100 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-violet-900 flex items-center gap-2 text-sm">
            <Sliders size={15} className="text-violet-600" /> Parametri organico
          </h3>
          <button onClick={() => setShowConfig(c => !c)}
            className="text-xs text-violet-600 hover:text-violet-800 underline">
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
            <div className="text-gray-500 mb-1">Split pranzo <span className="text-emerald-600 font-medium">(dati reali)</span></div>
            <div className="font-bold text-violet-700 text-base">Dom {splitByDow[0]}% · Sab {splitByDow[6]}%</div>
          </div>
          <div className="bg-white rounded-lg p-2.5 border border-violet-100">
            <div className="text-gray-500 mb-1">Pax/cuoco cucina</div>
            <div className="font-bold text-violet-700 text-base">{paxPrimi}</div>
          </div>
        </div>

        {showConfig && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Sala */}
            <div className="bg-white rounded-lg p-3 border border-violet-100 space-y-2">
              <div className="text-xs font-semibold text-violet-700 flex items-center gap-1.5">
                <Users size={12} /> Sala
              </div>
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

            {/* Split per giorno */}
            <div className="bg-white rounded-lg p-3 border border-violet-100 space-y-2">
              <div className="text-xs font-semibold text-violet-700 flex items-center gap-1.5">
                <CalendarDays size={12} /> % Pranzo per giorno (cena = resto)
              </div>
              {GIORNI.map((g, i) => (
                <div key={g} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-600 w-20">{g}</span>
                  <div className="flex items-center gap-1.5">
                    <input type="range" min={10} max={80} step={5} value={splitByDow[i]}
                      onChange={e => setSplitByDow(prev => { const n=[...prev]; n[i]=parseInt(e.target.value); return n })}
                      className="w-20 accent-violet-600" />
                    <span className="text-xs font-semibold text-violet-700 w-12">
                      {splitByDow[i]}% / {100 - splitByDow[i]}%
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Cucina */}
            <div className="bg-white rounded-lg p-3 border border-violet-100 space-y-2">
              <div className="text-xs font-semibold text-violet-700 flex items-center gap-1.5">
                <ChefHat size={12} /> Cucina
              </div>
              {[
                { label: 'Pax/cuoco Primi',    val: paxPrimi,   set: setPaxPrimi,   min: 10, max: 80 },
                { label: 'Pax/cuoco Secondi',  val: paxSecondi, set: setPaxSecondi, min: 10, max: 80 },
                { label: 'Max cuochi Primi',   val: maxPrimi,   set: setMaxPrimi,   min: 1,  max: 4  },
                { label: 'Max cuochi Secondi', val: maxSecondi, set: setMaxSecondi, min: 1,  max: 4  },
                { label: 'Max Plonge',         val: maxPlonge,  set: setMaxPlonge,  min: 1,  max: 3  },
              ].map(({ label, val, set, min, max }) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-600">{label}</span>
                  <input type="number" value={val} min={min} max={max}
                    onChange={e => set(parseInt(e.target.value))}
                    className="w-16 text-xs text-right border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Tabella settimanale ──────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-3 text-left font-semibold text-gray-700">Giorno</th>
              <th className="px-3 py-3 text-center font-semibold text-gray-600">Media Coperti</th>
              <th className="px-3 py-3 text-center font-semibold text-blue-700 bg-blue-50/50" colSpan={2}>
                🌞 PRANZO 12:00–15:00
              </th>
              <th className="px-3 py-3 text-center font-semibold text-indigo-700 bg-indigo-50/50" colSpan={2}>
                🌙 CENA 19:00–23:00
              </th>
              <th className="px-3 py-3 text-center font-semibold text-gray-500">Tot. Giornata</th>
            </tr>
            <tr className="bg-gray-50/60 border-b border-gray-100 text-[10px] text-gray-500">
              <th className="px-3 py-1" />
              <th className="px-3 py-1 text-center">giornalieri</th>
              <th className="px-3 py-1 text-center bg-blue-50/30">Sala 👥</th>
              <th className="px-3 py-1 text-center bg-blue-50/30">Cucina 👨‍🍳</th>
              <th className="px-3 py-1 text-center bg-indigo-50/30">Sala 👥</th>
              <th className="px-3 py-1 text-center bg-indigo-50/30">Cucina 👨‍🍳</th>
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
                    {t.avg_coperti > 0 && (
                      <>
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full mx-auto mt-1 overflow-hidden">
                          <div className="h-full bg-violet-400 rounded-full" style={{ width: `${barPct}%` }} />
                        </div>
                        <div className="text-[9px] text-gray-400 mt-0.5">{splitByDow[t.dow]}%P / {100-splitByDow[t.dow]}%C</div>
                      </>
                    )}
                  </td>

                  {/* PRANZO - Sala */}
                  <td className="px-3 py-3 text-center bg-blue-50/20">
                    {!isEmpty ? (
                      <div className="space-y-1">
                        <div>
                          <StaffBadge n={t.camerierePranzo} color="indigo" label="Camerieri sala pranzo" />
                          <div className="text-[10px] text-gray-400 mt-0.5">camerieri</div>
                        </div>
                        <div className="text-[10px] text-blue-500">{t.copPranzo} cop.</div>
                      </div>
                    ) : '—'}
                  </td>

                  {/* PRANZO - Cucina */}
                  <td className="px-3 py-3 text-center bg-blue-50/20">
                    {!isEmpty ? (
                      <div className="space-y-0.5 text-[10px]">
                        <div className="flex items-center justify-center gap-1">
                          <StaffBadge n={t.cuochiPrimiP}   color="emerald" label="Primi" />
                          <span className="text-gray-400">Primi</span>
                        </div>
                        <div className="flex items-center justify-center gap-1">
                          <StaffBadge n={t.cuochiSecondiP} color="amber"   label="Secondi" />
                          <span className="text-gray-400">Secondi</span>
                        </div>
                        <div className="flex items-center justify-center gap-1">
                          <StaffBadge n={Math.max(1, t.plongeP)} color="violet" label="Plonge" />
                          <span className="text-gray-400">Plonge</span>
                        </div>
                      </div>
                    ) : '—'}
                  </td>

                  {/* CENA - Sala */}
                  <td className="px-3 py-3 text-center bg-indigo-50/20">
                    {!isEmpty ? (
                      <div className="space-y-1">
                        <div>
                          <StaffBadge n={t.cameriereCena} color="indigo" label="Camerieri sala cena" />
                          <div className="text-[10px] text-gray-400 mt-0.5">camerieri</div>
                        </div>
                        <div className="text-[10px] text-indigo-500">{t.copCena} cop.</div>
                      </div>
                    ) : '—'}
                  </td>

                  {/* CENA - Cucina */}
                  <td className="px-3 py-3 text-center bg-indigo-50/20">
                    {!isEmpty ? (
                      <div className="space-y-0.5 text-[10px]">
                        <div className="flex items-center justify-center gap-1">
                          <StaffBadge n={t.cuochiPrimiC}   color="emerald" label="Primi" />
                          <span className="text-gray-400">Primi</span>
                        </div>
                        <div className="flex items-center justify-center gap-1">
                          <StaffBadge n={t.cuochiSecondiC} color="amber"   label="Secondi" />
                          <span className="text-gray-400">Secondi</span>
                        </div>
                        <div className="flex items-center justify-center gap-1">
                          <StaffBadge n={Math.max(1, t.plongeC)} color="violet" label="Plonge" />
                          <span className="text-gray-400">Plonge</span>
                        </div>
                      </div>
                    ) : '—'}
                  </td>

                  {/* Totale */}
                  <td className="px-3 py-3 text-center">
                    {!isEmpty ? (
                      <div>
                        <div className="font-bold text-gray-900">{t.totPersonalePranzo + t.totPersonaleCena}</div>
                        <div className="text-[10px] text-gray-400">
                          {t.totPersonalePranzo} pran. + {t.totPersonaleCena} cena
                        </div>
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Legenda ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h4 className="font-semibold text-sm text-gray-800 mb-3 flex items-center gap-2">
            <Users size={14} className="text-indigo-600" /> Sala
          </h4>
          <div className="space-y-1.5 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
              <strong>{minSala}–{maxSala} camerieri</strong> in sala contemporaneamente
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-300 inline-block" />
              +1 cameriere ogni <strong>{paxPerCameriere} coperti</strong>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-300 inline-block" />
              Pranzo: servizio 12:00–15:00 · pulizie entro 16:00
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-300 inline-block" />
              Cena: servizio 19:00–23:00 · pulizie entro 00:00
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h4 className="font-semibold text-sm text-gray-800 mb-3 flex items-center gap-2">
            <ChefHat size={14} className="text-emerald-600" /> Cucina
          </h4>
          <div className="space-y-1.5 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              <strong>Primi:</strong> 1–{maxPrimi} cuochi (1 ogni {paxPrimi} cop.)
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
              <strong>Secondi:</strong> 1–{maxSecondi} cuochi (1 ogni {paxSecondi} cop.)
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" />
              <strong>Plonge:</strong> 1–{maxPlonge} persone
            </div>
            <div className="text-[10px] text-gray-400 mt-1 italic">
              Antipasti → linea Primi · Secondi carne/pesce → linea Secondi
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400 italic">
        Calcolo basato sulla media storica dei coperti per giorno della settimana nel periodo selezionato.
        Dati da chiusure cassa. Aggiorna il periodo per analizzare diverse stagioni.
      </p>
    </div>
  )
}

export default function StatisticheSala() {
  const [tab, setTab] = useState('fasce-orarie')
  const [location, setLocation] = useState('')
  const [period, setPeriod] = useState('month')
  const [dates, setDates] = useState(periodToDates('month'))

  const fromDate = dates?.from || ''
  const toDate   = dates?.to   || ''

  const handleDateChange = (pid, d) => {
    setPeriod(pid)
    if (d) setDates(d)
  }

  // Data states
  const [kpiData, setKpiData] = useState(null)
  const [fasceBag, setFasceBag] = useState([])
  const [operatori, setOperatori] = useState([])
  const [tavoli, setTavoli] = useState([])
  const [giornaliero, setGiornaliero] = useState([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const tabs = [
    { id: 'fasce-orarie', label: 'Fasce Orarie' },
    { id: 'operatori',    label: 'Operatori Sala' },
    { id: 'tavoli',       label: 'Tavoli & Stanze' },
    { id: 'giornaliero',  label: 'Trend Giornaliero' },
    { id: 'turni',        label: '👥 Turni Consigliati' },
  ]

  // Fetch all data
  async function fetchData() {
    try {
      setLoading(true)
      const params = { from: fromDate, to: toDate, ...(location && { location }) }

      const [fascheRes, operatoriRes, tavoliRes, giornalieroRes] = await Promise.all([
        statisticheApi.fasceOrarie(params),
        statisticheApi.operatori(params),
        statisticheApi.tavoli(params),
        statisticheApi.giornaliero(params)
      ])

      // Compute KPI card data from fasce
      if (fascheRes && Array.isArray(fascheRes)) {
        const totTavoli = fascheRes.reduce((sum, f) => sum + (f.n_tavoli || 0), 0)
        const totCoperti = fascheRes.reduce((sum, f) => sum + (f.n_coperti || 0), 0)
        const totIncasso = fascheRes.reduce((sum, f) => sum + (f.incasso_totale || 0), 0)

        // fasceOrarie() non include media_permanenza (viene da chiusure_giornaliere).
        // Calcoliamo la media da tavoliRes che proviene da statistiche_tavoli.durata_media_min
        const mediaPermanenza = (() => {
          if (!tavoliRes || !Array.isArray(tavoliRes)) return 0
          const conDurata = tavoliRes.filter(t => t.media_permanenza != null && t.media_permanenza > 0)
          if (conDurata.length === 0) return 0
          return Math.round(conDurata.reduce((s, t) => s + t.media_permanenza, 0) / conDurata.length)
        })()

        const copertMedio = totCoperti > 0 ? totIncasso / totCoperti : 0

        setKpiData({
          totTavoli,
          mediaCoperti: totCoperti > 0 ? (totCoperti / totTavoli).toFixed(1) : 0,
          mediaPermanenza,
          copertMedio
        })
        setFasceBag(fascheRes)
      }

      if (operatoriRes && Array.isArray(operatoriRes)) {
        setOperatori(operatoriRes)
      }

      if (tavoliRes && Array.isArray(tavoliRes)) {
        setTavoli(tavoliRes)
      }

      if (giornalieroRes && Array.isArray(giornalieroRes)) {
        setGiornaliero(giornalieroRes)
      }
    } catch (err) {
      console.error('Errore caricamento statistiche:', err)
    } finally {
      setLoading(false)
    }
  }

  // Sync data
  async function handleSync() {
    try {
      setSyncing(true)
      await statisticheApi.sync()
      await fetchData()
    } catch (err) {
      console.error('Errore sincronizzazione:', err)
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [location, dates])

  return (
    <>
    <PageStatsWidget />
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Statistiche Sala</h1>
          <p className="text-sm text-gray-500 mt-0.5">Analisi permanenza clienti, operatori e performance tavoli</p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="btn-primary"
        >
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Sincronizzazione...' : 'Sincronizza dati'}
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Periodo</label>
          <DateRangePicker period={period} dates={dates} onChange={handleDateChange} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Dal</label>
          <input type="date" value={fromDate}
            onChange={e => { setPeriod('custom'); setDates(d => ({ ...d, from: e.target.value })) }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Al</label>
          <input type="date" value={toDate}
            onChange={e => { setPeriod('custom'); setDates(d => ({ ...d, to: e.target.value })) }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Sede</label>
          <select
            value={location}
            onChange={e => setLocation(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:ring-2 focus:ring-blue-300 outline-none"
          >
            <option value="">Tutte le sedi</option>
            <option value="MA">Sede MA</option>
            <option value="PN">Sede PN</option>
          </select>
        </div>
        {fromDate && toDate && (
          <span className="text-xs text-gray-400 pb-2.5">Periodo attivo: {fromDate} → {toDate}</span>
        )}
      </div>

      {/* KPI Cards */}
      {kpiData && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KPICard
            icon={ReceiptText}
            label="Tavoli serviti"
            value={kpiData.totTavoli}
            color="bg-violet-50 text-violet-600"
          />
          <KPICard
            icon={Users}
            label="Media coperti/tavolo"
            value={kpiData.mediaCoperti}
            color="bg-blue-50 text-blue-600"
          />
          <KPICard
            icon={Clock}
            label="Media permanenza"
            value={`${kpiData.mediaPermanenza} min`}
            color="bg-amber-50 text-amber-600"
          />
          <KPICard
            icon={TrendingUp}
            label="Coperto medio"
            value={eur(kpiData.copertMedio)}
            color="bg-green-50 text-green-600"
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-violet-500 text-violet-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Fasce Orarie Tab */}
      {tab === 'fasce-orarie' && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex items-start gap-2">
            <span className="text-amber-500 mt-0.5 flex-shrink-0">⚠️</span>
            <span>
              <strong>Dati stimati</strong> — iPratico non esporta le fasce orarie effettive.
              Questi valori sono <em>distribuzioni simulate</em> basate sui totali giornalieri (12:00–15:00 pranzo, 19:30–23:30 cena).
              Per dati reali per fascia oraria usa il report <strong>Statistiche Tavoli</strong> su iPratico.
            </span>
          </div>
          {fasceBag.length > 0 && (
            <>
              <div className="card">
                <div className="card-header">
                  <h2 className="font-semibold">Venduto per fascia oraria</h2>
                </div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={fasceBag} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="fascia" />
                      <YAxis yAxisId="left" />
                      <YAxis yAxisId="right" orientation="right" />
                      <Tooltip
                        formatter={(value, name) => {
                          if (name === 'Tavoli' || name === 'Coperti') return [Math.round(value), name]
                          return [eur(value), name]
                        }}
                        labelFormatter={label => `Fascia: ${label}`}
                      />
                      <Legend />
                      <Bar yAxisId="left" dataKey="n_tavoli" fill="#6366f1" name="Tavoli" />
                      <Bar yAxisId="left" dataKey="n_coperti" fill="#3b82f6" name="Coperti" />
                      <Bar yAxisId="right" dataKey="incasso_totale" fill="#10b981" name="Incasso" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <h2 className="font-semibold">Dettagli per fascia oraria</h2>
                </div>
                <div className="card-body overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-200">
                      <tr>
                        <th className="text-left py-2 px-3 font-semibold">Fascia</th>
                        <th className="text-right py-2 px-3 font-semibold">Tavoli</th>
                        <th className="text-right py-2 px-3 font-semibold">Coperti</th>
                        <th className="text-right py-2 px-3 font-semibold">Media permanenza</th>
                        <th className="text-right py-2 px-3 font-semibold">Coperto medio</th>
                        <th className="text-right py-2 px-3 font-semibold">Incasso totale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fasceBag.map((f, idx) => (
                        <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 font-medium">{f.fascia}</td>
                          <td className="text-right py-2 px-3">{f.n_tavoli}</td>
                          <td className="text-right py-2 px-3">{f.n_coperti}</td>
                          <td className="text-right py-2 px-3">{f.media_permanenza ? `${Math.round(f.media_permanenza)} min` : '—'}</td>
                          <td className="text-right py-2 px-3">{f.coperto_medio ? eur(f.coperto_medio) : '—'}</td>
                          <td className="text-right py-2 px-3 font-semibold">{eur(f.incasso_totale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          {fasceBag.length === 0 && (
            <div className="card">
              <div className="card-body text-center py-8">
                <p className="text-gray-500">Nessun dato disponibile per il periodo selezionato</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Operatori Sala Tab */}
      {tab === 'operatori' && (
        <div className="space-y-4">
          {operatori.length > 0 && (
            <>
              <div className="card">
                <div className="card-header">
                  <h2 className="font-semibold">Ranking operatori per incasso</h2>
                </div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={operatori.sort((a, b) => (b.totale_incasso || 0) - (a.totale_incasso || 0))}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 150, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="operatore" type="category" width={140} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={v => eur(v)} />
                      <Bar dataKey="totale_incasso" fill="#6366f1">
                        {operatori.map((op, idx) => (
                          <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold">Dettagli operatori</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {operatori.map((op, idx) => (
                    <div key={idx} className="card p-4">
                      <div className="flex items-start gap-3 mb-3">
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white"
                          style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                        >
                          {op.operatore?.charAt(0) || '?'}
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm">{op.operatore}</h4>
                          <p className="text-xs text-gray-400">{op.location === 'MA' ? 'Sede MA' : 'Sede PN'}</p>
                        </div>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Pezzi venduti</span>
                          <span className="font-semibold">{op.n_tavoli ? op.n_tavoli.toLocaleString('it-IT') : '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Valore medio/pz</span>
                          <span className="font-semibold">{op.coperto_medio ? eur(op.coperto_medio) : '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Periodi analizzati</span>
                          <span className="font-semibold">{op.n_periodi || '—'}</span>
                        </div>
                        <div className="pt-2 border-t border-gray-200 mt-2 flex justify-between">
                          <span className="text-gray-500">Fatturato totale</span>
                          <span className="font-bold text-violet-600">{eur(op.totale_incasso)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {operatori.length === 0 && (
            <div className="card">
              <div className="card-body text-center py-8">
                <p className="text-gray-500">Nessun dato operatori disponibile</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tavoli & Stanze Tab */}
      {tab === 'tavoli' && (
        <div className="space-y-4">
          {tavoli.length > 0 && (
            <>
              <div className="card">
                <div className="card-header">
                  <h2 className="font-semibold">Performance tavoli</h2>
                </div>
                <div className="card-body overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-200">
                      <tr>
                        <th className="text-left py-2 px-3 font-semibold">Stanza</th>
                        <th className="text-right py-2 px-3 font-semibold">Tavolo</th>
                        <th className="text-right py-2 px-3 font-semibold">Posti</th>
                        <th className="text-right py-2 px-3 font-semibold">Utilizzo</th>
                        <th className="text-right py-2 px-3 font-semibold">Coperti medi</th>
                        <th className="text-right py-2 px-3 font-semibold">Permanenza media</th>
                        <th className="text-right py-2 px-3 font-semibold">Coperto medio</th>
                        <th className="text-right py-2 px-3 font-semibold">Incasso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tavoli.map((t, idx) => (
                        <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 font-medium">{t.stanza || '—'}</td>
                          <td className="text-right py-2 px-3">{t.tavolo || '—'}</td>
                          <td className="text-right py-2 px-3">{t.posti || '—'}</td>
                          <td className="text-right py-2 px-3">
                            {t.utilizzo_percent ? `${Math.round(t.utilizzo_percent)}%` : '—'}
                          </td>
                          <td className="text-right py-2 px-3">{t.media_coperti ? t.media_coperti.toFixed(1) : '—'}</td>
                          <td className="text-right py-2 px-3">{t.media_permanenza ? `${Math.round(t.media_permanenza)} min` : '—'}</td>
                          <td className="text-right py-2 px-3">{t.coperto_medio ? eur(t.coperto_medio) : '—'}</td>
                          <td className="text-right py-2 px-3 font-semibold">{eur(t.incasso_totale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <h2 className="font-semibold">Heatmap utilizzo tavoli per stanza</h2>
                </div>
                <div className="card-body">
                  {/* Group by stanza */}
                  {Array.from(new Set(tavoli.map(t => t.stanza || 'Senza stanza'))).map(stanza => {
                    const stanzaTavoli = tavoli.filter(t => (t.stanza || 'Senza stanza') === stanza)
                    return (
                      <div key={stanza} className="mb-6">
                        <h3 className="font-semibold text-sm mb-3">{stanza}</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                          {stanzaTavoli.map((t, idx) => {
                            const util = t.utilizzo_percent || 0
                            let bgColor = '#f3f4f6' // gray-100
                            if (util >= 80) bgColor = '#10b981' // green-500
                            else if (util >= 60) bgColor = '#f59e0b' // amber-500
                            else if (util >= 40) bgColor = '#3b82f6' // blue-500
                            else if (util > 0) bgColor = '#6366f1' // indigo-500

                            return (
                              <div
                                key={idx}
                                className="p-3 rounded-lg text-center text-white text-xs font-semibold"
                                style={{ backgroundColor: bgColor }}
                                title={`${t.tavolo}: ${t.media_coperti?.toFixed(1) || 0} coperti medi, ${eur(t.incasso_totale || 0)} incasso`}
                              >
                                <div>{t.tavolo}</div>
                                <div className="text-xs opacity-80">{Math.round(util)}%</div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
          {tavoli.length === 0 && (
            <div className="card">
              <div className="card-body text-center py-8">
                <p className="text-gray-500">Nessun dato tavoli disponibile</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Trend Giornaliero Tab */}
      {tab === 'giornaliero' && (
        <div className="space-y-4">
          {giornaliero.length > 0 && (
            <>
              <div className="card">
                <div className="card-header">
                  <h2 className="font-semibold">Trend coperti e incasso giornaliero</h2>
                </div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={350}>
                    <AreaChart data={giornaliero} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                      <defs>
                        <linearGradient id="colorCoperti" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorIncasso" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="data" />
                      <YAxis yAxisId="left" />
                      <YAxis yAxisId="right" orientation="right" />
                      <Tooltip
                        formatter={(value, name) => {
                          if (name === 'n_coperti') return [value, 'Coperti']
                          if (name === 'incasso_totale') return [eur(value), 'Incasso']
                          if (name === 'coperto_medio') return [eur(value), 'Coperto medio']
                          return value
                        }}
                        labelFormatter={label => `Data: ${label}`}
                      />
                      <Legend />
                      <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="n_coperti"
                        stroke="#3b82f6"
                        fillOpacity={1}
                        fill="url(#colorCoperti)"
                        name="Coperti"
                      />
                      <Area
                        yAxisId="right"
                        type="monotone"
                        dataKey="incasso_totale"
                        stroke="#10b981"
                        fillOpacity={1}
                        fill="url(#colorIncasso)"
                        name="Incasso"
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="coperto_medio"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={false}
                        name="Coperto medio"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <h2 className="font-semibold">Dettagli giornalieri</h2>
                </div>
                <div className="card-body overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-200">
                      <tr>
                        <th className="text-left py-2 px-3 font-semibold">Data</th>
                        <th className="text-right py-2 px-3 font-semibold">Tavoli</th>
                        <th className="text-right py-2 px-3 font-semibold">Coperti</th>
                        <th className="text-right py-2 px-3 font-semibold">Media permanenza</th>
                        <th className="text-right py-2 px-3 font-semibold">Coperto medio</th>
                        <th className="text-right py-2 px-3 font-semibold">Incasso totale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {giornaliero.map((g, idx) => (
                        <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 font-medium">{g.data}</td>
                          <td className="text-right py-2 px-3">{g.n_tavoli || '—'}</td>
                          <td className="text-right py-2 px-3">{g.n_coperti || '—'}</td>
                          <td className="text-right py-2 px-3">{g.media_permanenza ? `${Math.round(g.media_permanenza)} min` : '—'}</td>
                          <td className="text-right py-2 px-3">{g.coperto_medio ? eur(g.coperto_medio) : '—'}</td>
                          <td className="text-right py-2 px-3 font-semibold">{eur(g.incasso_totale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          {giornaliero.length === 0 && (
            <div className="card">
              <div className="card-body text-center py-8">
                <p className="text-gray-500">Nessun dato giornaliero disponibile</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Turni Consigliati Tab */}
      {tab === 'turni' && (
        <div className="space-y-4">
          <div className="bg-violet-50 border border-violet-100 rounded-lg p-3 text-xs text-violet-700">
            👥 <strong>Turni Consigliati</strong> — organico suggerito per fascia oraria basato sulla media storica dei coperti per giorno della settimana.
            I parametri sono modificabili e si aggiornano in tempo reale.
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
          "Fascia oraria più redditizia della settimana",
        ]}
      />
    </>
  )
}