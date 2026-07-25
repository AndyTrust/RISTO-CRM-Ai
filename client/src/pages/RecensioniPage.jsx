/**
 * RecensioniPage.jsx — Recensioni Google + Tripadvisor + sondaggi feedback
 * Sorgente: recensioni_pienissimo (popolata da aggiorna_tutto_pienissimo.py)
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import supabase from '../supabase'
import PageStatsWidget from '../components/PageStatsWidget'
import {
  Star, MessageSquare, TrendingUp, MapPin, RefreshCw, AlertCircle,
  ThumbsUp, ThumbsDown, ExternalLink,
} from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

const MESI_SHORT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const PORTAL_COLORS = { google: '#4285f4', tripadvisor: '#00af87', pienissimo: '#8b5cf6' }

const fmtN = (v, d=2) => v == null ? '—' : Number(v).toFixed(d)

export default function RecensioniPage() {
  const today = new Date()
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10)
  })
  const [to, setTo]         = useState(today.toISOString().slice(0, 10))
  const [sede, setSede]     = useState('Tutte')
  const [portale, setPortale] = useState('Tutti')
  const [data, setData]     = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr]       = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      let q = supabase.from('recensioni_pienissimo')
        .select('*')
        .gte('data_recensione', from)
        .lte('data_recensione', to)
        .order('data_recensione', { ascending: false })
        .limit(2000)
      if (sede !== 'Tutte') q = q.eq('sede', sede)
      if (portale !== 'Tutti') q = q.eq('portale', portale)
      const { data: rows, error } = await q
      if (error) throw error
      setData(rows || [])
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [from, to, sede, portale])

  useEffect(() => { loadData() }, [loadData])

  const stats = useMemo(() => {
    if (data.length === 0) return null
    const byPortale = {}
    const byMese = {}
    let totVoto = 0
    let nVoti = 0
    let nNeg = 0
    let nConTesto = 0
    for (const r of data) {
      const v = Number(r.voto)
      if (Number.isFinite(v)) { totVoto += v; nVoti++ }
      if (v <= 3) nNeg++
      if (r.testo && r.testo.trim().length > 5) nConTesto++

      const p = r.portale || 'altro'
      if (!byPortale[p]) byPortale[p] = { n: 0, voto: 0, ridotto: 0 }
      byPortale[p].n++
      if (Number.isFinite(v)) byPortale[p].voto += v
      if (v <= 3) byPortale[p].ridotto++

      const m = (r.data_recensione || '').slice(0, 7)
      if (m) {
        if (!byMese[m]) byMese[m] = { mese: m, voti: [], n: 0 }
        byMese[m].n++
        if (Number.isFinite(v)) byMese[m].voti.push(v)
      }
    }
    return {
      n: data.length,
      voto_medio: nVoti > 0 ? totVoto / nVoti : null,
      n_negative: nNeg,
      n_con_testo: nConTesto,
      portali: Object.entries(byPortale).map(([k, v]) => ({
        nome: k, n: v.n, voto_medio: v.n > 0 ? v.voto / v.n : null, ridotto: v.ridotto,
      })),
      trend: Object.values(byMese).sort((a, b) => a.mese.localeCompare(b.mese)).map(m => ({
        label: `${MESI_SHORT[parseInt(m.mese.slice(5,7))-1]} '${m.mese.slice(2,4)}`,
        n: m.n,
        voto_medio: m.voti.length > 0 ? m.voti.reduce((s,v) => s+v, 0) / m.voti.length : null,
      })),
    }
  }, [data])

  return (
    <>
      <PageStatsWidget />
      <div className="min-h-screen bg-gray-50 p-4 md:p-6">
        <div className="max-w-7xl mx-auto">

          {/* Header */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Star className="text-amber-500" size={26} />
            <h1 className="text-2xl font-bold text-gray-900">Recensioni Google + Tripadvisor</h1>
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
              <select value={sede} onChange={e => setSede(e.target.value)} className="px-2 py-1 border border-gray-200 rounded text-sm">
                <option value="Tutte">Tutte</option>
                <option value="MA">Mameli</option>
                <option value="PN">Predda Niedda</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-0.5">Portale</label>
              <select value={portale} onChange={e => setPortale(e.target.value)} className="px-2 py-1 border border-gray-200 rounded text-sm">
                <option value="Tutti">Tutti</option>
                <option value="google">Google</option>
                <option value="tripadvisor">Tripadvisor</option>
              </select>
            </div>
            {stats && <div className="ml-auto text-xs text-gray-500"><strong className="text-gray-800">{stats.n}</strong> recensioni</div>}
          </div>

          {err && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-700 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5" /> {err}
            </div>
          )}

          {/* KPI */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <KPI label="Voto medio" value={`${fmtN(stats.voto_medio, 2)}/5`} icon={Star}
                color={stats.voto_medio >= 4.5 ? 'green' : stats.voto_medio >= 3.5 ? 'amber' : 'red'} />
              <KPI label="Totale recensioni" value={stats.n} icon={MessageSquare} color="blue" />
              <KPI label="Recensioni critiche (≤3)" value={stats.n_negative} icon={ThumbsDown}
                color={stats.n_negative === 0 ? 'green' : stats.n_negative < 5 ? 'amber' : 'red'} />
              <KPI label="Con commento scritto" value={stats.n_con_testo} icon={MessageSquare} color="purple" />
            </div>
          )}

          {/* Trend + Pie portale */}
          {stats && stats.trend.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="font-semibold text-sm text-gray-800 mb-2 flex items-center gap-2">
                  <TrendingUp size={15} className="text-blue-600" /> Trend Voto Medio Mensile
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={stats.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 5]} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="voto_medio" stroke="#10b981" strokeWidth={2} name="Voto medio" dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="font-semibold text-sm text-gray-800 mb-2 flex items-center gap-2">
                  <Star size={15} className="text-amber-500" /> Per Portale
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stats.portali}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="nome" />
                    <YAxis />
                    <Tooltip formatter={(v, name) => name === 'voto_medio' ? fmtN(v, 2) : v} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="n" fill="#3b82f6" name="N°" />
                    <Bar dataKey="voto_medio" fill="#f59e0b" name="Voto medio" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Lista recensioni */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="font-semibold text-sm text-gray-800 mb-3 flex items-center gap-2">
              <MessageSquare size={15} className="text-violet-600" /> Recensioni recenti
            </h3>
            {loading ? (
              <div className="text-center text-gray-400 py-12">Caricamento...</div>
            ) : data.length === 0 ? (
              <div className="text-center text-gray-400 py-12 text-sm">Nessuna recensione nel periodo.</div>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {data.slice(0, 100).map(r => (
                  <div key={`${r.sede}-${r.id_recensione}`} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50">
                    <div className="flex items-center gap-2 mb-1 text-xs flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded font-bold ${r.sede === 'MA' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{r.sede}</span>
                      <span className="px-1.5 py-0.5 rounded text-white text-[10px] font-medium uppercase"
                        style={{ backgroundColor: PORTAL_COLORS[r.portale] || '#6b7280' }}>
                        {r.portale}
                      </span>
                      <span className="text-gray-500">{r.data_recensione}</span>
                      <span className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }, (_, i) => (
                          <Star key={i} size={12} className={i < (r.voto || 0) ? 'text-amber-500 fill-amber-500' : 'text-gray-300'} />
                        ))}
                        <span className="ml-1 text-gray-500 font-medium">{r.voto}/5</span>
                      </span>
                      {r.autore && <span className="text-gray-500">· {r.autore}</span>}
                    </div>
                    {r.testo && <p className="text-sm text-gray-700 leading-snug whitespace-pre-wrap">{r.testo.length > 400 ? r.testo.substring(0, 400) + '…' : r.testo}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function KPI({ label, value, sub, icon: Icon, color = 'blue' }) {
  const g = {
    blue: 'from-blue-500 to-blue-600',
    emerald: 'from-emerald-500 to-emerald-600',
    green: 'from-emerald-500 to-emerald-600',
    amber: 'from-amber-500 to-amber-600',
    red: 'from-red-500 to-red-600',
    purple: 'from-violet-500 to-violet-600',
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
