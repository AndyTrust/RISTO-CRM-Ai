/**
 * SondaggiPage.jsx — Analisi sondaggi clienti (Pienissimo Pro)
 * Tabella sorgente: sondaggi_strutturati (popolata dalla skill sondaggi-estrazione)
 *
 * Mostra: NPS medio, score 5 dimensioni, trend mensile, canali, % tornerà,
 * feedback negativi recenti, filtri sede + periodo.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import supabase from '../supabase'
import PageStatsWidget from '../components/PageStatsWidget'
import {
  Star, MessageSquare, TrendingUp, Users, Calendar, MapPin,
  RefreshCw, AlertCircle, ThumbsUp, ThumbsDown, Repeat, Mail, Activity,
} from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts'

const MESI_SHORT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

const fmtN = (v, d=1) => (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(d)
const fmtPct = (v, d=0) => (v == null || !isFinite(v)) ? '—' : `${(Number(v) * 100).toFixed(d)}%`

// NPS classification helpers (per dimensione 0-10)
function classifyNps(score) {
  if (score == null) return null
  if (score >= 9) return 'promoter'
  if (score >= 7) return 'passive'
  return 'detractor'
}

function calcNpsScore(arr) {
  const valid = arr.filter(x => x != null && isFinite(x))
  if (valid.length === 0) return null
  const promoters  = valid.filter(x => x >= 9).length
  const detractors = valid.filter(x => x <= 6).length
  return ((promoters - detractors) / valid.length) * 100
}

export default function SondaggiPage() {
  const today = new Date()
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10)
  })
  const [to, setTo]     = useState(today.toISOString().slice(0, 10))
  const [sede, setSede] = useState('Tutte')
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      // Le righe alimentano NPS e medie: un troncamento le falsa. `.limit(5000)`
      // NON alza il cap PostgREST di 1000 righe (la tabella ne ha già ~1.200),
      // quindi su periodi lunghi l'NPS era calcolato su un sottoinsieme.
      // Solo `.range()` pagina davvero.
      const PAGINA = 1000
      const rows = []
      for (let i = 0; i < 20000; i += PAGINA) {
        let q = supabase.from('sondaggi_strutturati')
          .select('*')
          .gte('data_prenotazione', from)
          .lte('data_prenotazione', to)
          .order('data_prenotazione', { ascending: false })
          .range(i, i + PAGINA - 1)
        if (sede !== 'Tutte') q = q.eq('sede', sede)
        const { data: batch, error } = await q
        if (error) throw error
        rows.push(...(batch || []))
        if ((batch || []).length < PAGINA) break
      }
      setData(rows)
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [from, to, sede])

  useEffect(() => { loadData() }, [loadData])

  // ── KPI principali ────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    if (data.length === 0) return null
    const npsArr = data.map(d => d.nps).filter(v => v != null)
    const nps = calcNpsScore(npsArr)
    const avg = (key) => {
      const vals = data.map(d => d[key]).filter(v => v != null && isFinite(v))
      return vals.length === 0 ? null : vals.reduce((s, v) => s + (+v), 0) / vals.length
    }
    const torneranno = data.filter(d => d.tornera === true).length
    const promo = data.filter(d => d.vuole_promo === true).length
    const conFeedback = data.filter(d => d.feedback_negativo && d.feedback_negativo.trim()).length
    return {
      n: data.length,
      nps,
      avgNps:        avg('nps'),
      avgSala:       avg('sala'),
      avgPulizia:    avg('pulizia'),
      avgQualita:    avg('qualita_piatti'),
      avgPrezzo:     avg('qualita_prezzo'),
      avgAtmosfera:  avg('atmosfera'),
      pctTorneranno: data.length > 0 ? torneranno / data.length : 0,
      pctPromo:      data.length > 0 ? promo / data.length : 0,
      nFeedback:     conFeedback,
    }
  }, [data])

  // ── Trend mensile NPS + media ─────────────────────────────────────────
  const trendMese = useMemo(() => {
    const byMese = {}
    for (const r of data) {
      if (!r.data_prenotazione) continue
      const key = r.data_prenotazione.slice(0, 7)  // YYYY-MM
      if (!byMese[key]) byMese[key] = { mese: key, nps: [], sala: [], qualita: [], n: 0 }
      byMese[key].n++
      if (r.nps != null)            byMese[key].nps.push(r.nps)
      if (r.sala != null)           byMese[key].sala.push(r.sala)
      if (r.qualita_piatti != null) byMese[key].qualita.push(r.qualita_piatti)
    }
    return Object.values(byMese)
      .sort((a, b) => a.mese.localeCompare(b.mese))
      .map(m => ({
        label: `${MESI_SHORT[parseInt(m.mese.slice(5, 7)) - 1]} '${m.mese.slice(2, 4)}`,
        nps_score: calcNpsScore(m.nps),
        avg_nps:   m.nps.length > 0 ? m.nps.reduce((s, v) => s + v, 0) / m.nps.length : null,
        avg_sala:  m.sala.length > 0 ? m.sala.reduce((s, v) => s + v, 0) / m.sala.length : null,
        avg_qualita: m.qualita.length > 0 ? m.qualita.reduce((s, v) => s + v, 0) / m.qualita.length : null,
        n: m.n,
      }))
  }, [data])

  // ── Distribuzione canali di conoscenza ────────────────────────────────
  const canali = useMemo(() => {
    const byCanale = {}
    for (const r of data) {
      const c = (r.canale_conoscenza || 'Non specificato').trim()
      byCanale[c] = (byCanale[c] || 0) + 1
    }
    return Object.entries(byCanale)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  }, [data])

  // ── Radar score 5 dimensioni ──────────────────────────────────────────
  const radarData = useMemo(() => {
    if (!kpi) return []
    return [
      { dim: 'Sala',       value: kpi.avgSala || 0 },
      { dim: 'Pulizia',    value: kpi.avgPulizia || 0 },
      { dim: 'Qualità ★',  value: kpi.avgQualita || 0 },
      { dim: 'Prezzo',     value: kpi.avgPrezzo || 0 },
      { dim: 'Atmosfera',  value: kpi.avgAtmosfera || 0 },
    ]
  }, [kpi])

  // ── Distribuzione NPS (promoter/passive/detractor) ────────────────────
  const npsDist = useMemo(() => {
    const c = { promoter: 0, passive: 0, detractor: 0 }
    for (const r of data) {
      const cl = classifyNps(r.nps)
      if (cl) c[cl]++
    }
    return c
  }, [data])

  // ── Feedback negativi recenti ─────────────────────────────────────────
  const feedbackNeg = useMemo(() => {
    return data
      .filter(r => r.feedback_negativo && r.feedback_negativo.trim().length > 5)
      .slice(0, 30)
      .map(r => ({
        id: r.id, sede: r.sede,
        data: r.data_prenotazione,
        nps: r.nps,
        text: r.feedback_negativo.trim(),
        tornera: r.tornera,
      }))
  }, [data])

  return (
    <>
      <PageStatsWidget />
      <div className="min-h-screen bg-gray-50 p-4 md:p-6">
        <div className="max-w-7xl mx-auto">

          {/* Header */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Star className="text-amber-500" size={26} />
            <h1 className="text-2xl font-bold text-gray-900">Sondaggi Clienti</h1>
            <span className="text-xs text-gray-500">NPS, score dimensioni, trend, canali, feedback</span>
            <div className="flex-1" />
            <button onClick={loadData} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-sm hover:bg-gray-50">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Ricarica
            </button>
          </div>

          {/* Filtri */}
          <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-[11px] text-gray-500 block mb-0.5">Dal</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="px-2 py-1 border border-gray-200 rounded text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-0.5">Al</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="px-2 py-1 border border-gray-200 rounded text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-0.5">Sede</label>
              <select value={sede} onChange={e => setSede(e.target.value)}
                className="px-2 py-1 border border-gray-200 rounded text-sm">
                <option value="Tutte">Tutte</option>
                <option value="MA">Mameli</option>
                <option value="PN">Predda Niedda</option>
              </select>
            </div>
            <div className="flex gap-1">
              {[
                { label: '30g', d: 30 },
                { label: '90g', d: 90 },
                { label: '1y', d: 365 },
              ].map(p => (
                <button key={p.label} onClick={() => {
                  const t = new Date(); const f = new Date(); f.setDate(f.getDate() - p.d)
                  setTo(t.toISOString().slice(0,10)); setFrom(f.toISOString().slice(0,10))
                }} className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">{p.label}</button>
              ))}
            </div>
            {kpi && (
              <div className="ml-auto text-xs text-gray-500">
                <strong className="text-gray-800">{kpi.n}</strong> sondaggi nel periodo
              </div>
            )}
          </div>

          {err && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-700 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5" /> {err}
            </div>
          )}

          {/* KPI row */}
          {kpi ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <KPI label="NPS Score" value={fmtN(kpi.nps, 1)} sub={`media: ${fmtN(kpi.avgNps, 1)}/10`}
                icon={Star} color={kpi.nps >= 50 ? 'green' : kpi.nps >= 0 ? 'amber' : 'red'} />
              <KPI label="Qualità piatti" value={`${fmtN(kpi.avgQualita)}/10`} icon={Star} color="blue" />
              <KPI label="Tornerà" value={fmtPct(kpi.pctTorneranno, 0)} sub="% clienti soddisfatti"
                icon={Repeat} color="emerald" />
              <KPI label="Vuole promo" value={fmtPct(kpi.pctPromo, 0)} sub={`${kpi.nFeedback} feedback scritti`}
                icon={Mail} color="purple" />
            </div>
          ) : !loading && data.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
              Nessun sondaggio nel periodo selezionato.
            </div>
          )}

          {/* Riga 1: radar dimensioni + distribuzione NPS */}
          {kpi && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="font-semibold text-sm text-gray-800 mb-2 flex items-center gap-2">
                  <Activity size={15} className="text-violet-600" /> Score per Dimensione (media 0-10)
                </h3>
                <ResponsiveContainer width="100%" height={260}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#e5e7eb" />
                    <PolarAngleAxis dataKey="dim" tick={{ fontSize: 12 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 10]} tick={{ fontSize: 10 }} />
                    <Radar name="Score" dataKey="value" stroke="#8b5cf6" fill="#a78bfa" fillOpacity={0.5} />
                    <Tooltip formatter={(v) => `${(+v).toFixed(2)}/10`} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="font-semibold text-sm text-gray-800 mb-2 flex items-center gap-2">
                  <ThumbsUp size={15} className="text-emerald-600" /> Distribuzione NPS
                </h3>
                <div className="space-y-2 mt-4">
                  <NpsBar label="Promoter (9-10)" count={npsDist.promoter} total={kpi.n} color="emerald" />
                  <NpsBar label="Passive (7-8)"   count={npsDist.passive}   total={kpi.n} color="amber" />
                  <NpsBar label="Detractor (0-6)" count={npsDist.detractor} total={kpi.n} color="red" />
                </div>
                <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500">
                  NPS = % Promoter − % Detractor.
                  Soglie: <span className="text-emerald-600 font-medium">&gt;50 eccellente</span> ·
                  <span className="text-amber-600 font-medium"> 0-50 buono</span> ·
                  <span className="text-red-600 font-medium"> &lt;0 critico</span>
                </div>
              </div>
            </div>
          )}

          {/* Trend mensile */}
          {trendMese.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
              <h3 className="font-semibold text-sm text-gray-800 mb-2 flex items-center gap-2">
                <TrendingUp size={15} className="text-blue-600" /> Trend Mensile
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={trendMese}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} label={{ value: 'NPS Score', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={[0, 10]} label={{ value: 'Media voti', angle: 90, position: 'insideRight', style: { fontSize: 10 } }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="left" type="monotone" dataKey="nps_score" stroke="#10b981" strokeWidth={2} name="NPS Score" dot={{ r: 4 }} />
                  <Line yAxisId="right" type="monotone" dataKey="avg_qualita" stroke="#3b82f6" strokeWidth={2} name="Qualità piatti" strokeDasharray="4 2" dot={{ r: 3 }} />
                  <Line yAxisId="right" type="monotone" dataKey="avg_sala" stroke="#8b5cf6" strokeWidth={2} name="Sala" strokeDasharray="4 2" dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Canali di conoscenza + Feedback negativi */}
          {kpi && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="font-semibold text-sm text-gray-800 mb-2 flex items-center gap-2">
                  <Users size={15} className="text-blue-600" /> Come ci hanno conosciuto
                </h3>
                {canali.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={canali} dataKey="value" nameKey="name" outerRadius={90} label={(e) => `${e.name.substring(0, 12)} (${e.value})`}>
                        {canali.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-gray-400 text-sm italic">Nessun dato canale.</p>
                )}
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="font-semibold text-sm text-gray-800 mb-2 flex items-center gap-2">
                  <ThumbsDown size={15} className="text-red-600" /> Feedback Negativi Recenti
                  <span className="text-xs text-gray-400 ml-1">({feedbackNeg.length})</span>
                </h3>
                <div className="max-h-[280px] overflow-y-auto space-y-2">
                  {feedbackNeg.length === 0 ? (
                    <p className="text-emerald-600 text-sm italic">✓ Nessun feedback negativo nel periodo!</p>
                  ) : feedbackNeg.map(f => (
                    <div key={f.id} className="p-2 rounded-lg bg-red-50 border border-red-100">
                      <div className="flex items-center gap-2 mb-1 text-xs">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${f.sede === 'MA' ? 'bg-red-200 text-red-800' : 'bg-blue-200 text-blue-800'}`}>{f.sede}</span>
                        <span className="text-gray-500">{f.data}</span>
                        {f.nps != null && <span className={`px-1.5 py-0.5 rounded ${f.nps <= 6 ? 'bg-red-200 text-red-700' : 'bg-amber-200 text-amber-700'}`}>NPS {f.nps}</span>}
                        {f.tornera === false && <span className="text-red-600 text-[10px]">❌ non torna</span>}
                        {f.tornera === true && <span className="text-emerald-600 text-[10px]">↻ torna</span>}
                      </div>
                      <p className="text-xs text-gray-700 leading-snug">{f.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Confronto sedi (se filtro = Tutte) */}
          {sede === 'Tutte' && data.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="font-semibold text-sm text-gray-800 mb-2 flex items-center gap-2">
                <MapPin size={15} className="text-violet-600" /> Confronto Mameli vs Predda Niedda
              </h3>
              <ConfrontoSedi data={data} />
            </div>
          )}

        </div>
      </div>
    </>
  )
}

// ── Componenti helper ────────────────────────────────────────────────────
function KPI({ label, value, sub, icon: Icon, color = 'blue' }) {
  const g = {
    blue:    'from-blue-500 to-blue-600',
    emerald: 'from-emerald-500 to-emerald-600',
    green:   'from-emerald-500 to-emerald-600',
    amber:   'from-amber-500 to-amber-600',
    red:     'from-red-500 to-red-600',
    purple:  'from-violet-500 to-violet-600',
  }
  return (
    <div className={`bg-gradient-to-br ${g[color] || g.blue} text-white rounded-xl p-4 shadow`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs opacity-80 font-medium">{label}</p>
          <p className="text-xl font-bold mt-1">{value}</p>
          {sub && <p className="text-xs opacity-70 mt-1">{sub}</p>}
        </div>
        {Icon && <Icon size={20} className="opacity-60" />}
      </div>
    </div>
  )
}

function NpsBar({ label, count, total, color }) {
  const pct = total > 0 ? (count / total) * 100 : 0
  const bg = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500' }
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="text-gray-500">{count} <span className="text-gray-400">({pct.toFixed(0)}%)</span></span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${bg[color]} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function ConfrontoSedi({ data }) {
  const stats = useMemo(() => {
    const rows = []
    for (const s of ['MA', 'PN']) {
      const sub = data.filter(r => r.sede === s)
      if (sub.length === 0) continue
      const avg = (k) => {
        const v = sub.map(r => r[k]).filter(x => x != null && isFinite(x))
        return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length
      }
      rows.push({
        sede:    s === 'MA' ? 'Mameli' : 'Predda Niedda',
        n:       sub.length,
        nps:     calcNpsScore(sub.map(r => r.nps).filter(v => v != null)),
        sala:    avg('sala'),
        qualita: avg('qualita_piatti'),
        prezzo:  avg('qualita_prezzo'),
        atmosfera: avg('atmosfera'),
      })
    }
    return rows
  }, [data])

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={stats}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="sede" />
        <YAxis />
        <Tooltip formatter={(v) => (v == null ? '—' : Number(v).toFixed(2))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="nps" fill="#10b981" name="NPS Score" />
        <Bar dataKey="qualita" fill="#3b82f6" name="Qualità piatti" />
        <Bar dataKey="sala" fill="#8b5cf6" name="Sala" />
        <Bar dataKey="atmosfera" fill="#f59e0b" name="Atmosfera" />
      </BarChart>
    </ResponsiveContainer>
  )
}
