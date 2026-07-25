/**
 * RecensioniPage.jsx — Recensioni Google + Tripadvisor + sondaggi feedback
 * Sorgente: recensioni_pienissimo (popolata da aggiorna_tutto_pienissimo.py)
 */
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import supabase from '../supabase'
import { fetchPagedInfo } from '../api/paged'
import { fmtNum, BottoneCsv, NotaCopertura } from '../lib/tabella'
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

// toISOString() formatta in UTC: alle 23:00 in fuso italiano "oggi" diventerebbe
// ieri e il filtro perderebbe le recensioni della sera.
const isoLocale = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

// setMonth(getMonth()-N) va in overflow a fine mese: dal 31 agosto meno 6 mesi
// JS restituisce il 3 marzo (il 31 febbraio non esiste e slitta). Qui il giorno
// viene limitato all'ultimo giorno reale del mese di destinazione.
function meseMeno(data, n) {
  const giorno = data.getDate()
  const x = new Date(data.getFullYear(), data.getMonth() - n, 1)
  const ultimo = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()
  x.setDate(Math.min(giorno, ultimo))
  return x
}

export default function RecensioniPage() {
  const today = new Date()
  const [from, setFrom] = useState(() => isoLocale(meseMeno(new Date(), 6)))
  const [to, setTo]         = useState(() => isoLocale(new Date()))
  const [sede, setSede]     = useState('Tutte')
  const [portale, setPortale] = useState('Tutti')
  const [data, setData]     = useState([])
  const [troncato, setTroncato] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr]       = useState(null)

  // Contatore di richiesta: identifica l'ultima load partita. Serve sia contro le
  // risposte fuori ordine sia come guardia di unmount (il cleanup lo incrementa).
  const richiestaRef = useRef(0)

  const loadData = useCallback(async () => {
    const mia = ++richiestaRef.current
    setLoading(true); setErr(null)
    try {
      // `.limit(2000)` NON alzava il cap PostgREST di 1000 righe: voto medio,
      // n° critiche e trend venivano calcolati su un sottoinsieme silenzioso e
      // il contatore mostrava "1000 recensioni" come se fosse il totale.
      // recensioni_pienissimo non ha una PK surrogata: si ordina per
      // id_recensione, l'unica colonna quasi-univoca disponibile.
      const build = () => {
        let q = supabase.from('recensioni_pienissimo').select('*')
          .gte('data_recensione', from)
          .lte('data_recensione', to)
        if (sede !== 'Tutte') q = q.eq('sede', sede)
        if (portale !== 'Tutti') q = q.eq('portale', portale)
        return q
      }
      const { righe, troncato: tr } = await fetchPagedInfo(build, 'id_recensione')
      if (mia !== richiestaRef.current) return
      // L'ordine cronologico si applica in memoria: l'ordinamento della query
      // serve solo a rendere stabile la paginazione.
      righe.sort((a, b) => String(b.data_recensione || '').localeCompare(String(a.data_recensione || '')))
      setData(righe)
      setTroncato(tr)
    } catch (e) {
      if (mia === richiestaRef.current) setErr(e.message || String(e))
    } finally {
      if (mia === richiestaRef.current) setLoading(false)
    }
  }, [from, to, sede, portale])

  useEffect(() => {
    loadData()
    // Invalida la richiesta in volo: nessun setState dopo lo smontaggio.
    return () => { richiestaRef.current++ }
  }, [loadData])

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
      const votoValido = r.voto != null && Number.isFinite(v)
      if (votoValido) {
        totVoto += v; nVoti++
        // Il test stava FUORI da questo blocco: con voto null, Number(null) è 0
        // e `0 <= 3` è vero, quindi ogni recensione senza voto veniva contata
        // come "critica ≤3".
        if (v <= 3) nNeg++
      }
      if (r.testo && r.testo.trim().length > 5) nConTesto++

      const p = r.portale || 'altro'
      if (!byPortale[p]) byPortale[p] = { n: 0, voto: 0, nVoti: 0, ridotto: 0 }
      byPortale[p].n++
      if (votoValido) {
        byPortale[p].voto += v
        byPortale[p].nVoti++
        if (v <= 3) byPortale[p].ridotto++
      }

      const m = (r.data_recensione || '').slice(0, 7)
      if (m) {
        if (!byMese[m]) byMese[m] = { mese: m, voti: [], n: 0 }
        byMese[m].n++
        if (votoValido) byMese[m].voti.push(v)
      }
    }
    return {
      n: data.length,
      voto_medio: nVoti > 0 ? totVoto / nVoti : null,
      n_voti: nVoti,
      n_senza_voto: data.length - nVoti,
      n_negative: nNeg,
      n_con_testo: nConTesto,
      portali: Object.entries(byPortale).map(([k, v]) => ({
        nome: k, n: v.n, voto_medio: v.nVoti > 0 ? v.voto / v.nVoti : null, ridotto: v.ridotto,
      })),
      trend: Object.values(byMese).sort((a, b) => a.mese.localeCompare(b.mese)).map(m => ({
        label: `${MESI_SHORT[parseInt(m.mese.slice(5,7))-1]} '${m.mese.slice(2,4)}`,
        n: m.n,
        voto_medio: m.voti.length > 0 ? m.voti.reduce((s,v) => s+v, 0) / m.voti.length : null,
      })),
    }
  }, [data])

  const colonneCsv = useMemo(() => ([
    { chiave: 'sede', etichetta: 'Sede' },
    { chiave: 'portale', etichetta: 'Portale' },
    { chiave: 'data_recensione', etichetta: 'Data' },
    { chiave: 'autore', etichetta: 'Autore' },
    { chiave: 'voto', etichetta: 'Voto (1-5)', valore: r => (r.voto == null ? null : Number(r.voto)) },
    { chiave: 'testo', etichetta: 'Testo' },
    { chiave: 'risposta_struttura', etichetta: 'Risposta struttura' },
  ]), [])

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
            <BottoneCsv righe={data} colonne={colonneCsv} nomeFile="recensioni" />
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
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-1">
                <KPI label="Voto medio" value={stats.voto_medio == null ? '—' : `${fmtN(stats.voto_medio, 2)}/5`} icon={Star}
                  sub={`su ${stats.n_voti} recensioni con voto`}
                  color={stats.voto_medio >= 4.5 ? 'green' : stats.voto_medio >= 3.5 ? 'amber' : 'red'} />
                <KPI label="Totale recensioni" value={stats.n} icon={MessageSquare} color="blue"
                  sub={stats.n_senza_voto > 0 ? `${stats.n_senza_voto} senza voto` : undefined} />
                <KPI label="Recensioni critiche (≤3)" value={stats.n_negative} icon={ThumbsDown}
                  sub="solo recensioni con voto"
                  color={stats.n_negative === 0 ? 'green' : stats.n_negative < 5 ? 'amber' : 'red'} />
                <KPI label="Con commento scritto" value={stats.n_con_testo} icon={MessageSquare} color="purple" />
              </div>
              <NotaCopertura righe={stats.n} da={from} a={to} fonte="recensioni_pienissimo" troncato={troncato}
                extra={stats.n_senza_voto > 0 ? `${stats.n_senza_voto} recensioni senza voto escluse dalle medie` : undefined} />
            </>
          )}

          {/* Trend + Pie portale */}
          {stats && stats.trend.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 mt-4">
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
                    <Line type="monotone" dataKey="voto_medio" stroke="#10b981" strokeWidth={2} name="Voto medio" dot={{ r: 4 }} connectNulls={false} />
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
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <h3 className="font-semibold text-sm text-gray-800 flex items-center gap-2">
                <MessageSquare size={15} className="text-violet-600" /> Recensioni recenti
              </h3>
              {data.length > 100 && (
                // Il troncamento a 100 va dichiarato: prima la lista finiva e basta.
                <span className="text-[11px] text-gray-400">mostro le 100 più recenti di {data.length} — esporta in CSV per tutte</span>
              )}
              <div className="flex-1" />
              <BottoneCsv righe={data} colonne={colonneCsv} nomeFile="recensioni" />
            </div>
            {loading ? (
              <div className="text-center text-gray-400 py-12">Caricamento...</div>
            ) : data.length === 0 ? (
              <div className="text-center text-gray-400 py-12 text-sm">Nessuna recensione nel periodo.</div>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {data.slice(0, 100).map((r, i) => {
                  const voto = r.voto == null ? null : Number(r.voto)
                  const votoValido = voto != null && Number.isFinite(voto)
                  return (
                    <div key={`${r.sede}-${r.id_recensione}-${i}`} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50">
                      <div className="flex items-center gap-2 mb-1 text-xs flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded font-bold ${r.sede === 'MA' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{r.sede}</span>
                        <span className="px-1.5 py-0.5 rounded text-white text-[10px] font-medium uppercase"
                          style={{ backgroundColor: PORTAL_COLORS[r.portale] || '#6b7280' }}>
                          {r.portale}
                        </span>
                        <span className="text-gray-500">{r.data_recensione}</span>
                        {/* Senza voto NON si disegnano 0 stelle né "null/5": sarebbe
                            una valutazione pessima inventata. */}
                        {votoValido ? (
                          <span className="flex items-center gap-0.5">
                            {Array.from({ length: 5 }, (_, s) => (
                              <Star key={s} size={12} className={s < voto ? 'text-amber-500 fill-amber-500' : 'text-gray-300'} />
                            ))}
                            <span className="ml-1 text-gray-500 font-medium">{fmtNum(voto, { decimali: voto % 1 === 0 ? 0 : 1 })}/5</span>
                          </span>
                        ) : (
                          <span className="text-gray-400 italic">voto non rilevato</span>
                        )}
                        {r.autore && <span className="text-gray-500">· {r.autore}</span>}
                      </div>
                      {r.testo && <p className="text-sm text-gray-700 leading-snug whitespace-pre-wrap">{r.testo.length > 400 ? r.testo.substring(0, 400) + '…' : r.testo}</p>}
                    </div>
                  )
                })}
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
