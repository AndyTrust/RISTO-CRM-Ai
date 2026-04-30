import React, { useEffect, useState } from 'react'
import { statistiche as statisticheApi } from '../api/client'
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, ScatterChart, Scatter
} from 'recharts'
import { MapPin, RefreshCw, TrendingUp, Users, Clock, ReceiptText } from 'lucide-react'
import DateRangePicker, { periodToDates } from '../components/DateRangePicker'
import PageAssistant from '../components/PageAssistant'

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
    { id: 'operatori', label: 'Operatori Sala' },
    { id: 'tavoli', label: 'Tavoli & Stanze' },
    { id: 'giornaliero', label: 'Trend Giornaliero' }
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
        const totMinuti = fascheRes.reduce((sum, f) => sum + ((f.media_permanenza || 0) * (f.n_tavoli || 0)), 0)
        const totIncasso = fascheRes.reduce((sum, f) => sum + (f.incasso_totale || 0), 0)

        const mediaPermanenza = totTavoli > 0 ? Math.round(totMinuti / totTavoli) : 0
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
      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker period={period} dates={dates} onChange={handleDateChange} />
        <select
          value={location}
          onChange={e => setLocation(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white shadow-sm focus:ring-2 focus:ring-indigo-300 outline-none"
        >
          <option value="">Tutte le sedi</option>
          <option value="MA">Sede MA</option>
          <option value="PN">Sede PN</option>
        </select>
        {fromDate && toDate && (
          <span className="text-xs text-gray-400">{fromDate} → {toDate}</span>
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
                          if (name === 'n_tavoli' || name === 'n_coperti') return value
                          return eur(value)
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
                          <span className="text-gray-500">Tavoli serviti</span>
                          <span className="font-semibold">{op.n_tavoli || '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Media permanenza</span>
                          <span className="font-semibold">{op.media_permanenza ? `${Math.round(op.media_permanenza)} min` : '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Coperto medio</span>
                          <span className="font-semibold">{op.coperto_medio ? eur(op.coperto_medio) : '—'}</span>
                        </div>
                        <div className="pt-2 border-t border-gray-200 mt-2 flex justify-between">
                          <span className="text-gray-500">Incasso totale</span>
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