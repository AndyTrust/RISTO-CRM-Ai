/**
 * KPIWaiters.jsx — Performance Camerieri
 * Dati reali da: v_operatore_mese, v_be_mensile, kpi_targets_team,
 *               kpi_targets_individuale, v_kpi_quantum_mensile,
 *               v_bonus_team, v_bonus_operatore, venduto_camerieri
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Target, TrendingUp, Users, Euro, BarChart3,
  RefreshCw, ChevronDown, ChevronUp, Award,
  Sparkles, Package
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Line, ReferenceLine, LabelList
} from 'recharts'
import {
  operatoreMeseApi, beMensileApi, kpiTargetsApi, bonusApi
} from '../api/client'
import supabase from '../supabase'
import { fetchPaged, fetchPagedInfo } from '../api/paged'
import { useOrdinamento, IconaOrdine, BottoneCsv, NotaCopertura } from '../lib/tabella'
import useAnniDisponibili from '../hooks/useAnniDisponibili'
import PageStatsWidget from '../components/PageStatsWidget'

// ── Utils ──────────────────────────────────────────────────────────────
const MESI = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ec4899','#8b5cf6','#ef4444','#14b8a6','#f97316','#06b6d4']
const fmt    = (n, d = 2) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtEur = n => n == null ? '—' : `€ ${fmt(n)}`
const fmtPct = n => n == null ? '—' : `${fmt(n, 1)}%`

/**
 * Date del mese in formato ISO, calcolate SEMPRE in fuso locale.
 *
 * `new Date(anno, mese, 0).toISOString()` — il pattern che era sparso in questo
 * file — costruisce la mezzanotte LOCALE dell'ultimo giorno del mese e poi la
 * converte in UTC: in Italia (UTC+1/+2) diventa le 22:00/23:00 del giorno prima,
 * quindi il filtro `.lte(data_fine, ...)` perdeva silenziosamente l'ultimo
 * giorno di ogni mese. Anche `-31` fisso è escluso: in febbraio, aprile, giugno,
 * settembre e novembre genera una data inesistente (errore Postgres 22008).
 */
const ymd        = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const inizioMese = (anno, mese) => `${anno}-${String(mese).padStart(2, '0')}-01`
const fineMese   = (anno, mese) => ymd(new Date(anno, mese, 0))

/** Messaggio d'errore visibile: un guasto non deve travestirsi da "nessun dato". */
function BannerErrore({ messaggio, onChiudi }) {
  if (!messaggio) return null
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
      <span className="text-red-500 text-lg flex-shrink-0 mt-0.5">⚠️</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-red-800">Errore nel caricamento dei dati</p>
        <p className="text-xs text-red-700 mt-0.5 break-words">{messaggio}</p>
        <p className="text-[11px] text-red-500 mt-1">I numeri mostrati potrebbero essere incompleti.</p>
      </div>
      {onChiudi && (
        <button onClick={onChiudi} className="text-red-400 hover:text-red-700 text-sm flex-shrink-0">✕</button>
      )}
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, sub, color = 'indigo', badge, onClick }) {
  return (
    <div
      className={`bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col gap-1 transition-all duration-150 ${onClick ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : ''}`}
      onClick={onClick}
    >
      <PageStatsWidget />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</span>
        <div className="flex items-center gap-1.5">
          {onClick && <span className="text-[9px] text-gray-300 font-medium">clicca ↗</span>}
          <div className={`p-1.5 rounded-lg bg-${color}-50 text-${color}-600`}><Icon size={16} /></div>
        </div>
      </div>
      <div className="text-xl font-bold text-gray-900 leading-tight">{value}</div>
      {sub  && <div className="text-[11px] text-gray-400">{sub}</div>}
      {badge && <div className={`text-[10px] font-semibold mt-0.5 ${badge.color}`}>{badge.text}</div>}
    </div>
  )
}

function DetailDrawer({ tipo, data, loading, errore, onClose, be, targetFatt, fatturatoTeam, quantumMedio, margine, anno, mese, fmtEur }) {
  if (!tipo) return null

  const chiusure = data.chiusure || []
  const fattPerGiorno = chiusure.map(c => ({
    giorno: c.data?.slice(8,10),
    fatturato: Number(c.totale_venduto_ipratico) || 0,
    coperti: Number(c.coperti) || 0,
    foodCost: Number(c.food_cost_giornaliero) || 0,
  }))

  const fatture = data.fatture || []
  const bustePaga = data.bustePaga || []
  const quantumOp = data.quantumOp || []

  const fornitori = {}
  fatture.forEach(f => {
    // Fix: colonne reali di fatture_importate sono fornitore / p_iva / totale
    const key = f.fornitore || f.p_iva || 'Altro'
    if (!fornitori[key]) fornitori[key] = 0
    fornitori[key] += Number(f.totale) || 0
  })
  const fornitoriList = Object.entries(fornitori)
    .sort((a,b) => b[1]-a[1])
    .slice(0,15)
    .map(([nome, tot]) => ({ nome, tot }))
  const totFatture = fornitoriList.reduce((s,f) => s+f.tot, 0)

  const costoPersonale = bustePaga.reduce((s,b) => s + (Number(b.costo_azienda) || 0), 0)
  const costoPersonaleFallback = Number(be?.costo_personale_totale) || 0
  const costoPersonaleEffettivo = costoPersonale > 0 ? costoPersonale : costoPersonaleFallback
  const foodCostTotale = Number(be?.food_cost_totale) || chiusure.reduce((s,c) => s + (Number(c.food_cost_giornaliero)||0), 0)

  const titles = {
    fatturato: 'Fatturato Mese — Dettaglio',
    target: 'Target Fatturato — Analisi',
    quantum: 'Quantum Medio — per Operatore',
    margine: 'Margine — Analisi Costi Completa',
  }

  const today = new Date()
  const lastDayOfMonth = new Date(anno, mese, 0).getDate()
  const currentDay = anno === today.getFullYear() && mese === today.getMonth()+1 ? today.getDate() : lastDayOfMonth
  const remainingDays = Math.max(0, lastDayOfMonth - currentDay)
  const dailyNeeded = remainingDays > 0 ? Math.max(0, targetFatt - fatturatoTeam) / remainingDays : 0

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white z-50 shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{titles[tipo]}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'][mese-1]} {anno}
              {be?.sede && be.sede !== 'ALL' ? ` · Sede ${be.sede}` : ' · Tutte le sedi'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-lg text-gray-500 hover:text-gray-800 transition-colors">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Caricamento dati...</div>
          ) : errore ? (
            <BannerErrore messaggio={errore} />
          ) : (
            <>
              {tipo === 'fatturato' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-indigo-50 rounded-xl p-4 text-center">
                      <div className="text-2xl font-bold text-indigo-700">{fmtEur(fatturatoTeam)}</div>
                      <div className="text-xs text-indigo-500 mt-1">Fatturato totale</div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 text-center">
                      <div className="text-2xl font-bold text-gray-700">{Number(be?.coperti||0).toLocaleString('it-IT')}</div>
                      <div className="text-xs text-gray-500 mt-1">Coperti totali</div>
                    </div>
                    <div className="bg-blue-50 rounded-xl p-4 text-center">
                      <div className="text-2xl font-bold text-blue-700">{fattPerGiorno.length}</div>
                      <div className="text-xs text-blue-500 mt-1">Giorni di apertura</div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Andamento giornaliero</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={fattPerGiorno} margin={{top:5,right:5,left:0,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                        <XAxis dataKey="giorno" fontSize={10}/>
                        <YAxis fontSize={10} tickFormatter={v => `€${(v/1000).toFixed(0)}k`}/>
                        <Tooltip formatter={v => [`€${Number(v).toLocaleString('it-IT',{minimumFractionDigits:2})}`, 'Fatturato']}/>
                        <Area type="monotone" dataKey="fatturato" stroke="#6366f1" fill="#e0e7ff" strokeWidth={2}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                    <div className="text-xs font-semibold text-indigo-700 mb-2">Da dove arriva questo dato</div>
                    <p className="text-xs text-indigo-600 leading-relaxed">
                      Il fatturato mensile viene estratto dalla tabella <code className="bg-indigo-100 px-1 rounded">chiusure_giornaliere</code> (vista <code className="bg-indigo-100 px-1 rounded">v_be_mensile</code>),
                      alimentata ogni giorno dal sistema cassa iPratico. Rappresenta l'incassato totale (pranzo + cena) per tutti i giorni del mese,
                      sommato per sede selezionata.
                    </p>
                  </div>
                </div>
              )}

              {tipo === 'target' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-violet-50 rounded-xl p-4">
                      <div className="text-xs text-violet-500 mb-1">Fatturato attuale</div>
                      <div className="text-xl font-bold text-violet-700">{fmtEur(fatturatoTeam)}</div>
                    </div>
                    <div className="bg-violet-50 rounded-xl p-4">
                      <div className="text-xs text-violet-500 mb-1">Target mese</div>
                      <div className="text-xl font-bold text-violet-700">{fmtEur(targetFatt)}</div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Avanzamento vs target</span>
                      <span className="font-semibold">{targetFatt > 0 ? ((fatturatoTeam/targetFatt)*100).toFixed(1) : 0}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-3">
                      <div
                        className={`h-3 rounded-full transition-all ${fatturatoTeam >= targetFatt ? 'bg-green-500' : 'bg-violet-500'}`}
                        style={{width: `${Math.min(100, targetFatt > 0 ? (fatturatoTeam/targetFatt)*100 : 0)}%`}}
                      />
                    </div>
                  </div>

                  {remainingDays > 0 && dailyNeeded > 0 && (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                      <div className="text-sm font-semibold text-amber-800">
                        Mancano ancora {remainingDays} giorni — serve {fmtEur(dailyNeeded)}/giorno
                      </div>
                      <div className="text-xs text-amber-600 mt-1">
                        Da recuperare: {fmtEur(Math.max(0, targetFatt - fatturatoTeam))} in {remainingDays} giorni
                      </div>
                    </div>
                  )}

                  {fattPerGiorno.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">Fatturato cumulato vs target</h3>
                      <ResponsiveContainer width="100%" height={180}>
                        <AreaChart
                          data={fattPerGiorno.map((d, i) => ({
                            ...d,
                            cumulato: fattPerGiorno.slice(0,i+1).reduce((s,x) => s+x.fatturato, 0),
                            targetLine: targetFatt,
                          }))}
                          margin={{top:5,right:5,left:0,bottom:0}}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                          <XAxis dataKey="giorno" fontSize={10}/>
                          <YAxis fontSize={10} tickFormatter={v => `€${(v/1000).toFixed(0)}k`}/>
                          <Tooltip formatter={v => [`€${Number(v).toLocaleString('it-IT',{minimumFractionDigits:2})}`, '']}/>
                          <Area type="monotone" dataKey="cumulato" name="Cumulato" stroke="#7c3aed" fill="#ede9fe" strokeWidth={2}/>
                          <Line type="monotone" dataKey="targetLine" name="Target" stroke="#f59e0b" strokeDasharray="5 5" dot={false} strokeWidth={1.5}/>
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  <div className="bg-violet-50 border border-violet-100 rounded-xl p-4">
                    <div className="text-xs font-semibold text-violet-700 mb-2">Da dove arriva questo dato</div>
                    <p className="text-xs text-violet-600 leading-relaxed">
                      Il target mensile è impostato manualmente nella tabella <code className="bg-violet-100 px-1 rounded">kpi_targets_team</code>.
                      Viene usato come riferimento per calcolare l'avanzamento del team e il KPI % vs target di ogni cameriere.
                      Si imposta nella pagina Target del CRM.
                    </p>
                  </div>
                </div>
              )}

              {tipo === 'quantum' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-50 rounded-xl p-4 text-center">
                      <div className="text-2xl font-bold text-blue-700">{fmtEur(quantumMedio)}</div>
                      <div className="text-xs text-blue-500 mt-1">Quantum medio team</div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 text-center">
                      <div className="text-2xl font-bold text-gray-700">{quantumOp.length}</div>
                      <div className="text-xs text-gray-500 mt-1">Operatori attivi</div>
                    </div>
                  </div>

                  {quantumOp.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-3">Quantum per operatore (€/coperto)</h3>
                      <ResponsiveContainer width="100%" height={Math.min(quantumOp.length * 32 + 20, 280)}>
                        <BarChart data={quantumOp} layout="vertical" margin={{top:0,right:60,left:100,bottom:0}}>
                          <XAxis type="number" fontSize={10} tickFormatter={v => `€${Number(v ?? 0).toFixed(0)}`}/>
                          <YAxis dataKey="operatore" type="category" width={95} fontSize={10}/>
                          <Tooltip formatter={v => [`€${Number(v).toFixed(2)}`, 'Quantum']}/>
                          <ReferenceLine x={quantumMedio} stroke="#94a3b8" strokeDasharray="4 4" label={{value:'media', fontSize:9, fill:'#94a3b8'}}/>
                          <Bar dataKey="quantum" name="Quantum €/cop" radius={[0,3,3,0]} fill="#3b82f6">
                            <LabelList dataKey="quantum" position="right" fontSize={10} formatter={v => `€${Number(v).toFixed(2)}`}/>
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                    <div className="text-xs font-semibold text-blue-700 mb-2">Come si calcola il Quantum</div>
                    <p className="text-xs text-blue-600 leading-relaxed">
                      Il Quantum = fatturato totale ÷ coperti reali serviti. Misura quanto vale mediamente ogni cliente servito.
                      A livello operatore viene calcolato dalla vista <code className="bg-blue-100 px-1 rounded">v_kpi_quantum_mensile</code>,
                      che incrocia le chiusure cassa (coperti) con il venduto per cameriere. È l'indicatore principale di efficacia di upselling.
                    </p>
                  </div>
                </div>
              )}

              {tipo === 'margine' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className={`rounded-xl p-4 ${margine >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                      <div className="text-xs text-gray-500 mb-1">Margine netto</div>
                      <div className={`text-xl font-bold ${margine >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmtEur(margine)}</div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4">
                      <div className="text-xs text-gray-500 mb-1">Fatturato base</div>
                      <div className="text-xl font-bold text-gray-700">{fmtEur(fatturatoTeam)}</div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Struttura dei costi</h3>
                    <div className="space-y-2">
                      {[
                        { label: 'Fatturato lordo', val: fatturatoTeam, pct: 100, color: 'bg-indigo-500', positive: true },
                        { label: `Costo personale (${Number(be?.pct_personale||0).toFixed(1)}%)`, val: costoPersonaleEffettivo, pct: Number(be?.pct_personale||0), color: 'bg-orange-400', positive: false },
                        { label: `Food & Beverage cost (${Number(be?.pct_food||0).toFixed(1)}%)`, val: foodCostTotale, pct: Number(be?.pct_food||0), color: 'bg-yellow-400', positive: false },
                        { label: 'Costi fissi (affitti, utenze...)', val: Math.max(0, fatturatoTeam - costoPersonaleEffettivo - foodCostTotale - margine), pct: Math.max(0, 100 - Number(be?.pct_personale||0) - Number(be?.pct_food||0) - (fatturatoTeam > 0 ? (margine/fatturatoTeam)*100 : 0)), color: 'bg-gray-400', positive: false },
                        { label: 'Margine', val: margine, pct: fatturatoTeam > 0 ? (margine/fatturatoTeam)*100 : 0, color: margine >= 0 ? 'bg-green-500' : 'bg-red-500', positive: margine >= 0 },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center gap-3">
                          <div className="w-40 text-xs text-gray-600 text-right flex-shrink-0">{item.label}</div>
                          <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
                            <div
                              className={`h-5 ${item.color} rounded-full`}
                              style={{width: `${Math.min(100, Math.abs(item.pct))}%`}}
                            />
                          </div>
                          <div className="w-28 text-xs font-semibold text-right flex-shrink-0">
                            {item.positive ? '' : '-'}{fmtEur(Math.abs(item.val))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {fornitoriList.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-1">Fatture fornitori del mese</h3>
                      <p className="text-xs text-gray-400 mb-3">Totale: {fmtEur(totFatture)} · {fatture.length} fatture · {fornitoriList.length} fornitori</p>
                      <div className="space-y-1.5 max-h-72 overflow-y-auto">
                        {fornitoriList.map((f) => (
                          <div key={f.nome} className="flex items-center gap-2 text-xs">
                            <div className="flex-1 text-gray-700 truncate">{f.nome}</div>
                            <div className="w-24 text-right font-semibold text-gray-800">{fmtEur(f.tot)}</div>
                            <div className="w-10 text-right text-gray-400">{totFatture > 0 ? ((f.tot/totFatture)*100).toFixed(1) : 0}%</div>
                          </div>
                        ))}
                      </div>
                      {fornitoriList.length > 0 && (
                        <div className="mt-3">
                          <ResponsiveContainer width="100%" height={Math.min(fornitoriList.length * 24 + 20, 200)}>
                            <BarChart data={fornitoriList.slice(0,10)} layout="vertical" margin={{top:0,right:60,left:10,bottom:0}}>
                              <XAxis type="number" fontSize={9} tickFormatter={v => `€${(v/1000).toFixed(0)}k`}/>
                              <YAxis dataKey="nome" type="category" width={130} fontSize={9}/>
                              <Tooltip formatter={v => [`€${Number(v).toLocaleString('it-IT',{minimumFractionDigits:2})}`, 'Importo']}/>
                              <Bar dataKey="tot" fill="#f97316" radius={[0,3,3,0]}>
                                <LabelList dataKey="tot" position="right" fontSize={9} formatter={v => `€${(v/1000).toFixed(1)}k`}/>
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  )}

                  {fornitoriList.length === 0 && (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-xs text-amber-700">
                      Nessuna fattura trovata per questo mese. Le fatture vengono scaricate automaticamente da sportello.cloud ogni giorno alle 09:33.
                      Se mancano, usa la skill "Scarica fatture" per aggiornare.
                    </div>
                  )}

                  {bustePaga.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">Buste paga del mese</h3>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400 border-b border-gray-100">
                            <th className="text-left py-1.5">Dipendente</th>
                            <th className="text-right py-1.5">Netto</th>
                            <th className="text-right py-1.5">Costo az.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bustePaga.map((b) => (
                            /* Fix: in buste_paga il nome sta in employee_name (non "operatore").
                               La chiave è `id`: due cedolini possono avere lo stesso nome
                               (omonimi, o stessa persona su sedi diverse) e con il nome come
                               chiave React ne collassava uno. */
                            <tr key={b.id ?? b.employee_name} className="border-b border-gray-50">
                              <td className="py-1 text-gray-700">{b.employee_name}</td>
                              <td className="py-1 text-right text-gray-600">{fmtEur(Number(b.netto||0))}</td>
                              <td className="py-1 text-right font-medium text-orange-600">{fmtEur(Number(b.costo_azienda||0))}</td>
                            </tr>
                          ))}
                          <tr className="font-semibold">
                            <td className="py-1.5 text-gray-800">Totale</td>
                            <td className="py-1.5 text-right text-gray-700">{fmtEur(bustePaga.reduce((s,b)=>s+Number(b.netto||0),0))}</td>
                            <td className="py-1.5 text-right text-orange-700">{fmtEur(costoPersonale)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                    <div className="text-xs font-semibold text-red-700 mb-2">Come si calcola il Margine</div>
                    <p className="text-xs text-red-600 leading-relaxed">
                      Margine = Fatturato − Costo Personale − Food Cost − Costi Fissi.
                      Viene calcolato nella vista <code className="bg-red-100 px-1 rounded">v_be_mensile</code> che aggrega chiusure cassa + buste paga + Break-Even mensile (costi fissi impostati nel CRM).
                      Il costo personale usa i LUL (<code className="bg-red-100 px-1 rounded">buste_paga</code>) se disponibili, altrimenti la stima CCNL (netto × 1.9653).
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ── Coaching panel: opportunità di crescita ────────────────────────────
function CoachingPanel({ pezzi, q, copertiGestiti, qAffidabile, quantumMedioTeam,
                         teamCatData, opCatMap, totPezziCat, teamAggRate, aggiunte }) {

  const aggiunteRate = pezzi > 0 ? (Number(aggiunte) / pezzi * 100) : 0
  const aggiunteGap  = aggiunteRate - teamAggRate

  // Revenue potenziale se raggiunge quantum medio team
  const qGap       = (q != null && qAffidabile && quantumMedioTeam > 0) ? (quantumMedioTeam - q) : null
  const potenziale  = (qGap != null && qGap > 0 && copertiGestiti != null) ? Math.round(qGap * copertiGestiti) : null

  // Top 6 categorie del team per volume (per il comparison chart)
  const topCats = Object.entries(teamCatData)
    .sort(([, a], [, b]) => b.totale - a.totale)
    .slice(0, 7)
    .map(([cat, t]) => {
      const teamShare = totPezziCat > 0 ? t.pezzi / totPezziCat * 100 : 0
      const myShare   = pezzi > 0 ? ((opCatMap[cat]?.pezzi || 0) / pezzi * 100) : 0
      return { cat, teamShare, myShare, gap: myShare - teamShare }
    })

  // Categorie carenti: sotto la media team di > 3pp
  const carenti = topCats.filter(c => c.gap < -3 && c.teamShare > 5)
    .sort((a, b) => a.gap - b.gap).slice(0, 3)

  return (
    <div className="mt-3 pt-3 border-t border-indigo-100">
      <div className="text-[11px] font-bold text-indigo-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
        🎯 Opportunità di crescita
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">

        {/* Quantum vs team */}
        <div className="bg-white rounded-lg border border-gray-100 p-3">
          <div className="text-[10px] text-gray-500 font-semibold uppercase mb-2">Quantum €/cop.</div>
          <div className="flex items-end gap-3 mb-2">
            <div>
              <div className="text-[9px] text-gray-400 mb-0.5">Tuo</div>
              <div className={`text-lg font-bold leading-none ${
                q == null ? 'text-gray-300'
                : !qAffidabile ? 'text-amber-500'
                : q >= quantumMedioTeam ? 'text-emerald-600' : 'text-red-500'
              }`}>
                {q != null ? `€ ${Number(q).toFixed(0)}` : '—'}
                {q != null && !qAffidabile && <span className="text-xs ml-0.5">⚠</span>}
              </div>
            </div>
            <div className="text-gray-300 text-lg pb-0.5">→</div>
            <div>
              <div className="text-[9px] text-gray-400 mb-0.5">Media team</div>
              <div className="text-lg font-bold text-indigo-600 leading-none">€ {quantumMedioTeam.toFixed(0)}</div>
            </div>
          </div>
          {potenziale != null && potenziale > 0 && (
            <div className="text-[10px] bg-amber-50 border border-amber-200 text-amber-700 rounded px-2 py-1.5 leading-snug">
              <strong>+€ {potenziale.toLocaleString('it-IT')}/mese potenziale</strong>
              <div className="text-gray-500 mt-0.5">Se raggiungessi €{quantumMedioTeam.toFixed(0)}/cop.</div>
            </div>
          )}
          {q != null && qAffidabile && q >= quantumMedioTeam && (
            <div className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 rounded px-2 py-1.5">
              ✓ Sopra la media del team!
            </div>
          )}
          {!qAffidabile && copertiGestiti != null && (
            <div className="text-[10px] text-amber-600 mt-1">
              Solo {copertiGestiti} coperti registrati — accumula più dati
            </div>
          )}
        </div>

        {/* Aggiunte / upselling */}
        <div className="bg-white rounded-lg border border-gray-100 p-3">
          <div className="text-[10px] text-gray-500 font-semibold uppercase mb-2">Upselling (Aggiunte %)</div>
          <div className="flex items-end gap-3 mb-2">
            <div>
              <div className="text-[9px] text-gray-400 mb-0.5">Tuo</div>
              <div className={`text-lg font-bold leading-none ${aggiunteGap >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {aggiunteRate.toFixed(1)}%
              </div>
            </div>
            <div className="text-gray-300 text-lg pb-0.5">→</div>
            <div>
              <div className="text-[9px] text-gray-400 mb-0.5">Media team</div>
              <div className="text-lg font-bold text-indigo-600 leading-none">{teamAggRate.toFixed(1)}%</div>
            </div>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1.5">
            <div
              className={`h-full rounded-full transition-all ${aggiunteGap >= 0 ? 'bg-emerald-500' : 'bg-amber-400'}`}
              style={{ width: `${Math.min(100, teamAggRate > 0 ? aggiunteRate / teamAggRate * 100 : 0)}%` }}
            />
          </div>
          <div className={`text-[10px] ${aggiunteGap >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
            {aggiunteGap >= 0
              ? `✓ +${aggiunteGap.toFixed(1)}pp sopra la media — ottimo!`
              : `${Math.abs(aggiunteGap).toFixed(1)}pp sotto la media — proponi varianti premium`}
          </div>
        </div>

        {/* Categorie carenti */}
        <div className="bg-white rounded-lg border border-gray-100 p-3">
          <div className="text-[10px] text-gray-500 font-semibold uppercase mb-2">Categorie da sviluppare</div>
          {carenti.length === 0 ? (
            <div className="text-[10px] text-emerald-600 bg-emerald-50 rounded px-2 py-1.5 border border-emerald-100">
              ✓ Mix categorie equilibrato rispetto al team
            </div>
          ) : (
            <div className="space-y-2">
              {carenti.map(c => (
                <div key={c.cat}>
                  <div className="flex justify-between text-[10px] mb-0.5">
                    <span className="text-gray-700 font-medium truncate">{c.cat}</span>
                    <span className="text-amber-600 font-bold ml-2 flex-shrink-0">
                      {c.myShare.toFixed(0)}% vs {c.teamShare.toFixed(0)}% team
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min(100, c.myShare)}%` }} />
                    <div className="h-full bg-indigo-200 rounded-full -mt-1.5" style={{ width: `${Math.min(100, c.teamShare)}%`, opacity: 0.5 }} />
                  </div>
                </div>
              ))}
              <div className="text-[9px] text-gray-400 mt-1">Proponi di più questi piatti ai tavoli</div>
            </div>
          )}
        </div>
      </div>

      {/* Mix categorie — grafico comparativo */}
      {topCats.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-100 p-3">
          <div className="text-[10px] text-gray-500 font-semibold uppercase mb-3">
            Mix categorie — tu (■) vs team (░) per % pezzi venduti
          </div>
          <div className="space-y-2">
            {topCats.map(({ cat, teamShare, myShare, gap }) => {
              const maxShare = Math.max(...topCats.map(c => Math.max(c.teamShare, c.myShare)), 1)
              return (
                <div key={cat} className="flex items-center gap-2">
                  <div className="text-[10px] text-gray-600 w-32 flex-shrink-0 truncate">{cat}</div>
                  <div className="flex-1 flex flex-col gap-0.5">
                    {/* Mia barra */}
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${gap >= 0 ? 'bg-indigo-500' : 'bg-amber-400'}`}
                        style={{ width: `${(myShare / maxShare) * 100}%` }}
                      />
                    </div>
                    {/* Barra team */}
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-200 rounded-full" style={{ width: `${(teamShare / maxShare) * 100}%` }} />
                    </div>
                  </div>
                  <div className={`text-[10px] w-20 text-right font-semibold flex-shrink-0 ${gap >= 0 ? 'text-indigo-600' : 'text-amber-500'}`}>
                    {myShare.toFixed(0)}% {gap > 0 ? `▲` : gap < -2 ? '▼' : ''}
                    <div className="text-gray-400 font-normal">{teamShare.toFixed(0)}% team</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Riga operatore espandibile ─────────────────────────────────────────
function OperatoreRow({ op, rank, target, quantum, payout, expanded, onToggle,
                        teamCatData, opCatMap, totPezziCat, teamAggRate, quantumMedioTeam }) {
  const [prodotti, setProdotti]       = useState([])
  const [loadingProd, setLoadingProd] = useState(false)
  const [errProd, setErrProd]         = useState(null)
  const [righeLette, setRigheLette]   = useState(null)

  useEffect(() => {
    if (!expanded || prodotti.length > 0) return
    let annullato = false
    setLoadingProd(true)
    setErrProd(null)
    const ini  = inizioMese(op.anno, op.mese)
    const fine = fineMese(op.anno, op.mese)

    ;(async () => {
      try {
        // Lettura PAGINATA: senza questo il drill-down si fermava alle prime
        // 1000 righe di venduto_camerieri e il totale per categoria mostrato
        // qui era una frazione del venduto reale dell'operatore, senza che
        // nulla in UI lo segnalasse.
        const { righe, troncato } = await fetchPagedInfo(
          () => supabase
            .from('venduto_camerieri')
            .select('id,categoria,prodotto,quantita,totale')
            .eq('sede', op.sede)
            .eq('operatore', op.operatore)
            .gte('data_inizio', ini)
            .lte('data_fine', fine)
            .not('prodotto', 'ilike', '%coperto%'),
          'id'
        )
        if (annullato) return
        const byCat = {}
        righe.forEach(r => {
          const cat = r.categoria || 'Altro'
          if (!byCat[cat]) byCat[cat] = { pezzi: 0, fatturato: 0 }
          byCat[cat].pezzi    += Number(r.quantita) || 0
          byCat[cat].fatturato += Number(r.totale)  || 0
        })
        setProdotti(
          Object.entries(byCat)
            .map(([cat, v]) => ({ cat, ...v }))
            .sort((a, b) => b.fatturato - a.fatturato)
            .slice(0, 8)
        )
        setRigheLette({ righe: righe.length, troncato })
      } catch (e) {
        if (!annullato) setErrProd(e?.message || String(e))
      } finally {
        if (!annullato) setLoadingProd(false)
      }
    })()

    return () => { annullato = true }
  }, [expanded, op, prodotti.length])

  const pezzi     = Number(op.tot_pezzi) || 0
  const fatturato = Number(op.fatturato_stimato_operatore) || 0
  const aggiunte  = Number(op.tot_importo_aggiunte) || 0
  const pctTeam   = Number(op.pct_pezzi_team) || 0
  const q         = quantum?.quantum != null ? Number(quantum.quantum) : null
  const copertiGestiti = quantum?.coperti_gestiti != null ? Number(quantum.coperti_gestiti) : null
  // Quantum affidabile solo con ≥ 10 coperti
  const qAffidabile = copertiGestiti != null && copertiGestiti >= 10

  const targetPezzi = target?.target  ? Number(target.target) : null
  const targetPct   = targetPezzi     ? Math.min(150, (pezzi / targetPezzi) * 100) : null
  const targetColor = targetPct == null ? ''
    : targetPct >= 100 ? 'text-emerald-600'
    : targetPct >= 75  ? 'text-amber-600'
    : 'text-red-500'
  const mancano = targetPezzi ? Math.max(0, targetPezzi - pezzi) : null

  return (
    <>
      <tr
        className={`border-t border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${expanded ? 'bg-indigo-50/40' : ''}`}
        onClick={onToggle}
      >
        <td className="px-3 py-2.5 w-8 text-center text-base">
          {rank < 3 ? ['🥇','🥈','🥉'][rank] : <span className="text-xs font-bold text-gray-400">{rank + 1}</span>}
        </td>

        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
              style={{ backgroundColor: COLORS[rank % COLORS.length] }}>
              {op.operatore?.charAt(0)?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm text-gray-900 truncate">{op.operatore}</div>
              {target?.employees?.role && (
                <div className="text-[10px] text-gray-400 capitalize">{(target.employees.role || '').toLowerCase()}</div>
              )}
            </div>
          </div>
        </td>

        {/* Pezzi + progress target */}
        <td className="px-3 py-2.5 text-right">
          <div className="text-sm font-semibold text-gray-900">{fmt(pezzi, 0)}</div>
          {targetPezzi && (
            <div className={`text-[10px] font-medium ${targetColor}`}>
              {targetPct >= 100 ? `✓ +${fmt(pezzi - targetPezzi, 0)}` : `–${fmt(mancano, 0)} al target`}
            </div>
          )}
          {targetPezzi && (
            <div className="mt-0.5 w-full h-1 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (pezzi / targetPezzi) * 100)}%`,
                  backgroundColor: targetPct >= 100 ? '#10b981' : targetPct >= 75 ? '#f59e0b' : '#ef4444',
                }} />
            </div>
          )}
        </td>

        <td className="px-3 py-2.5 text-right font-semibold text-sm text-gray-900">{fmtEur(fatturato)}</td>

        <td className="px-3 py-2.5 w-28">
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, pctTeam)}%`, backgroundColor: COLORS[rank % COLORS.length] }} />
            </div>
            <span className="text-xs font-semibold text-gray-700 w-10 text-right">{fmtPct(pctTeam)}</span>
          </div>
        </td>

        <td className="px-3 py-2.5 text-right text-sm">
          <span className="text-emerald-700 font-medium">{fmtEur(aggiunte)}</span>
          <div className="text-[10px] text-gray-400">{fmt(op.tot_aggiunte, 0)} vol.</div>
        </td>

        <td className="px-3 py-2.5 text-right">
          {q != null && qAffidabile
            ? <span className={`text-sm font-bold ${q >= 30 ? 'text-emerald-600' : q >= 15 ? 'text-amber-600' : 'text-gray-500'}`}>{fmtEur(q)}</span>
            : q != null && !qAffidabile
            ? (
              <span className="text-[10px] text-amber-500 font-medium" title={`Quantum non affidabile: solo ${copertiGestiti} coperti registrati (min. 10 richiesti)`}>
                ≈{fmtEur(q)} ⚠
              </span>
            )
            : <span className="text-[10px] text-gray-300">n/d</span>}
        </td>

        <td className="px-3 py-2.5 text-right">
          {payout > 0
            ? <span className="text-sm font-bold text-violet-700">{fmtEur(payout)}</span>
            : <span className="text-[10px] text-gray-300">—</span>}
        </td>

        <td className="px-3 py-2.5 text-center">
          {expanded ? <ChevronUp size={14} className="text-gray-400 inline" /> : <ChevronDown size={14} className="text-gray-400 inline" />}
        </td>
      </tr>

      {expanded && (
        <tr className="bg-indigo-50/30">
          <td colSpan={9} className="px-6 py-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">

              {/* Scheda individuale */}
              <div className="bg-white rounded-lg border border-indigo-100 p-3 text-xs space-y-1.5">
                <div className="font-bold text-gray-800 flex items-center gap-1.5 mb-2">
                  <Award size={13} className="text-violet-500" /> Riepilogo individuale
                </div>
                {[
                  ['Prodotti distinti', op.n_prodotti_distinti || 0],
                  ['Tot. pezzi venduti', fmt(pezzi, 0)],
                  ['Fatturato stimato', fmtEur(fatturato)],
                  ['Aggiunte (€)', fmtEur(aggiunte)],
                  ...(q != null ? [['Quantum €/coperto', qAffidabile ? fmtEur(q) : `≈${fmtEur(q)} (solo ${copertiGestiti} cop.)`]] : []),
                ].map(([l, v]) => (
                  <div key={l} className="flex justify-between">
                    <span className="text-gray-500">{l}</span>
                    <span className="font-semibold">{v}</span>
                  </div>
                ))}
                {targetPezzi && (
                  <>
                    <div className="border-t border-gray-100 pt-1.5 flex justify-between">
                      <span className="text-gray-500">Target pezzi mese</span>
                      <span className="font-semibold">{fmt(targetPezzi, 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">% completamento</span>
                      <span className={`font-bold ${targetColor}`}>{fmtPct(targetPct)}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
                      <div className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, (pezzi / targetPezzi) * 100)}%`,
                          backgroundColor: targetPct >= 100 ? '#10b981' : targetPct >= 75 ? '#f59e0b' : '#ef4444',
                        }} />
                    </div>
                  </>
                )}
              </div>

              {/* Top categorie */}
              <div className="col-span-3">
                <div className="font-bold text-[11px] text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Package size={12} className="text-indigo-500" /> Venduto per categoria (mese)
                </div>
                {loadingProd ? (
                  <p className="text-xs text-gray-400 italic">Caricamento...</p>
                ) : errProd ? (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">
                    ⚠️ Impossibile leggere il venduto dell'operatore: {errProd}
                  </p>
                ) : prodotti.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Nessun dato prodotti disponibile</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {prodotti.map((p, i) => {
                        const pctFat = (p.fatturato / (prodotti[0]?.fatturato || 1)) * 100
                        return (
                          <div key={p.cat} className="bg-white rounded-lg border border-gray-100 p-2.5">
                            <div className="text-[10px] font-semibold text-gray-500 truncate uppercase tracking-wide">{p.cat}</div>
                            <div className="text-sm font-bold text-gray-900 mt-0.5">{fmtEur(p.fatturato)}</div>
                            <div className="text-[10px] text-gray-400">{fmt(p.pezzi, 0)} pz.</div>
                            <div className="mt-1.5 h-1 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${pctFat}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      {righeLette && (
                        <NotaCopertura
                          righe={righeLette.righe}
                          troncato={righeLette.troncato}
                          da={inizioMese(op.anno, op.mese)}
                          a={fineMese(op.anno, op.mese)}
                          fonte="venduto_camerieri"
                        />
                      )}
                      <BottoneCsv
                        righe={prodotti}
                        colonne={[
                          { chiave: 'cat',       etichetta: 'Categoria' },
                          { chiave: 'pezzi',     etichetta: 'Pezzi' },
                          { chiave: 'fatturato', etichetta: 'Fatturato' },
                        ]}
                        nomeFile={`venduto_${op.operatore}_${op.anno}_${String(op.mese).padStart(2,'0')}`}
                      />
                    </div>
                  </>
                )}
              </div>

            </div>

            {/* ── Coaching panel ── */}
            <CoachingPanel
              pezzi={pezzi}
              aggiunte={op.tot_aggiunte}
              q={q}
              copertiGestiti={copertiGestiti}
              qAffidabile={qAffidabile}
              quantumMedioTeam={quantumMedioTeam}
              teamCatData={teamCatData}
              opCatMap={opCatMap}
              totPezziCat={totPezziCat}
              teamAggRate={teamAggRate}
            />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Pannello obiettivi prodotto (se esistono) ─────────────────────────
function ObiettiviPanel({ bonusTeam, bonusOp }) {
  if (!bonusTeam || bonusTeam.length === 0) return null
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="p-3 border-b border-gray-100 flex items-center gap-2">
        <Target size={15} className="text-violet-600" />
        <h2 className="text-sm font-bold text-gray-900">Obiettivi Prodotto · {bonusTeam.length} attivi</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Prodotto</th>
              <th className="text-left px-3 py-2 font-semibold">Reparto</th>
              <th className="text-right px-3 py-2 font-semibold">Target</th>
              <th className="text-right px-3 py-2 font-semibold">Venduti</th>
              <th className="text-right px-3 py-2 font-semibold">Mancano</th>
              <th className="px-3 py-2 font-semibold w-36">Completamento</th>
              <th className="text-right px-3 py-2 font-semibold">Premio</th>
              <th className="text-right px-3 py-2 font-semibold">Maturato</th>
            </tr>
          </thead>
          <tbody>
            {bonusTeam.map(b => {
              const pct = Number(b.pct_completamento) || 0
              const bgBar = pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-400'
              return (
                <tr key={`${b.prodotto}-${b.reparto}`} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">{b.prodotto}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      b.reparto === 'CUCINA' ? 'bg-orange-100 text-orange-700'
                      : b.reparto === 'SALA' ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-gray-100 text-gray-600'
                    }`}>{b.reparto}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{b.pezzi_target || 0}</td>
                  <td className="px-3 py-2 text-right">{b.pezzi_venduti || 0}</td>
                  <td className="px-3 py-2 text-right">
                    {b.raggiunto ? <span className="text-emerald-600 font-bold">✓</span> : (b.pezzi_mancanti || 0)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${bgBar}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <span className="w-10 text-right font-semibold">{fmtPct(pct)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{fmtEur(b.premio_euro)}</td>
                  <td className="px-3 py-2 text-right font-bold text-emerald-700">{fmtEur(b.premio_maturato)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────
export default function KPIWaiters() {
  const now = new Date()
  const [sede,    setSede]    = useState('MA')
  const [anno,    setAnno]    = useState(now.getFullYear())
  const [mese,    setMese]    = useState(now.getMonth() + 1)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(null)

  const [operatori,   setOperatori]   = useState([])
  const [be,          setBe]          = useState(null)
  const [targetTeam,  setTargetTeam]  = useState(null)
  const [targetsInd,  setTargetsInd]  = useState([])
  const [quantumData, setQuantumData] = useState([])
  const [bonusTeam,   setBonusTeam]   = useState([])
  const [bonusOp,     setBonusOp]     = useState([])
  const [isStima,     setIsStima]     = useState(false)
  const [vendutoTeam, setVendutoTeam] = useState([])
  const [errore,      setErrore]      = useState(null)
  const [coperturaVenduto, setCoperturaVenduto] = useState(null)

  const [activeModal,   setActiveModal]   = useState(null)
  const [modalData,     setModalData]     = useState({})
  const [modalLoading,  setModalLoading]  = useState(false)
  const [modalError,    setModalError]    = useState(null)

  // Anni realmente presenti a DB: la vecchia lista partiva dal 2024 cablato a
  // mano e nascondeva lo storico precedente.
  const { anni: anniDb } = useAnniDisponibili('venduto_camerieri', 'data_inizio')
  // L'anno selezionato resta sempre in lista: a gennaio, prima del primo
  // import, l'anno corrente non è ancora a DB e il select apparirebbe vuoto.
  const anniDisponibili = useMemo(
    () => (anniDb.includes(anno) ? anniDb : [...anniDb, anno].sort((a, b) => b - a)),
    [anniDb, anno]
  )

  const load = useCallback(async (segnale) => {
    setLoading(true)
    setExpanded(null)
    setErrore(null)
    try {
      const iniStr  = inizioMese(anno, mese)
      const fineStr = fineMese(anno, mese)

      const [ops, beData, tt, ti, qtRes, bt, bo, bpCheck, vtInfo] = await Promise.all([
        operatoreMeseApi.list({ sede, anno, mese }),
        beMensileApi.mese({ sede, anno, mese }),
        kpiTargetsApi.getTeam({ sede, anno, mese }),
        kpiTargetsApi.listIndividuale({ sede, anno, mese }),
        supabase.from('v_kpi_quantum_mensile')
          .select('operator, coperti_gestiti, quantum, fatturato_totale')
          .eq('sede', sede).eq('anno', anno).eq('mese', mese),
        bonusApi.team({ sede, anno, mese }),
        bonusApi.operatori({ sede, anno, mese }),
        supabase.from('buste_paga')
          .select('employee_code, note')
          .eq('sede', sede).eq('anno', anno).eq('mese', mese),
        // Paginato: il vecchio `.range(0, 4999)` non alzava il tetto server di
        // 1000 righe, quindi il mix categorie del coaching panel poggiava su
        // una porzione arbitraria del venduto del mese.
        fetchPagedInfo(
          () => supabase.from('venduto_camerieri')
            .select('id,operatore,categoria,quantita,totale')
            .eq('sede', sede)
            .gte('data_inizio', iniStr)
            .lte('data_fine', fineStr)
            .not('prodotto', 'ilike', '%coperto%'),
          'id'
        ),
      ])
      if (segnale?.annullato) return

      // Il client Supabase non rigetta mai: senza leggere `error` un blocco RLS
      // sulle viste diventerebbe "nessun operatore" e la pagina mostrerebbe zeri
      // credibili al posto di un guasto.
      if (qtRes?.error)   throw qtRes.error
      if (bpCheck?.error) throw bpCheck.error

      setOperatori(ops  || [])
      setBe(beData)
      setTargetTeam(tt)
      setTargetsInd(ti  || [])
      setQuantumData(qtRes?.data || [])
      setBonusTeam(bt   || [])
      setBonusOp(bo     || [])
      setVendutoTeam(vtInfo.righe)
      setCoperturaVenduto({ righe: vtInfo.righe.length, troncato: vtInfo.troncato })
      // Rileva se buste_paga del mese sono solo stime provvisorie
      const bpRows = bpCheck?.data || []
      const stimaDetected = bpRows.length > 0 && bpRows.every(r =>
        (r.employee_code || '').toUpperCase().includes('STIMA') ||
        (r.note || '').toUpperCase().includes('STIMA_PROVVISORIA')
      )
      setIsStima(stimaDetected)
    } catch (e) {
      console.error('[KPIWaiters] load error', e)
      if (!segnale?.annullato) setErrore(e?.message || String(e))
    } finally {
      if (!segnale?.annullato) setLoading(false)
    }
  }, [sede, anno, mese])

  useEffect(() => {
    const segnale = { annullato: false }
    load(segnale)
    // Guardia di unmount: cambiando sede/mese rapidamente la risposta lenta di
    // una richiesta precedente non deve più sovrascrivere lo stato corrente.
    return () => { segnale.annullato = true }
  }, [load])

  async function openModal(tipo) {
    setActiveModal(tipo)
    setModalLoading(true)
    setModalError(null)
    setModalData({})
    // Ultimo giorno reale del mese: il "-31" fisso generava date invalide in
    // feb/apr/giu/set/nov (errore Postgres 22008).
    const dateFrom = inizioMese(anno, mese)
    const dateTo   = fineMese(anno, mese)
    const sedeFilter = sede !== 'ALL' ? sede : null
    const result = {}

    // Ordina in memoria per data: `fetchPaged` deve impaginare su `id`, che è
    // l'unica colonna univoca — con `data` (duplicata per sede) le pagine si
    // sovrappongono e alcune righe non vengono mai lette.
    const perData = righe => [...righe].sort((a, b) => String(a.data).localeCompare(String(b.data)))

    try {
      if (tipo === 'fatturato' || tipo === 'margine') {
        const chiusure = await fetchPaged(
          () => {
            let q = supabase.from('chiusure_giornaliere')
              .select('id,data,totale_venduto_ipratico,coperti,food_cost_giornaliero,sede')
              .gte('data', dateFrom).lte('data', dateTo)
            if (sedeFilter) q = q.eq('sede', sedeFilter)
            return q
          },
          'id'
        )
        result.chiusure = perData(chiusure)
      }

      if (tipo === 'margine') {
        // Fix: nomi colonna reali su fatture_importate (fornitore / totale / p_iva)
        // Le fatture duplicate vanno escluse: qui alimentano il calcolo del margine,
        // e contarle due volte gonfia i costi e schiaccia il margine.
        // `.not(...,'is',true)` copre anche is_duplicato NULL (storico).
        result.fatture = await fetchPaged(
          () => supabase.from('fatture_importate')
            .select('id,fornitore,totale,data_fattura,p_iva')
            .gte('data_fattura', dateFrom).lte('data_fattura', dateTo)
            .not('is_duplicato', 'is', true),
          'id'
        )

        // Fix: su buste_paga le colonne reali sono employee_name e totale_competenze (non operatore/lorda)
        result.bustePaga = await fetchPaged(
          () => {
            let qb = supabase.from('buste_paga')
              .select('id,employee_name,netto,totale_competenze,costo_azienda,mese,anno,sede')
              .eq('anno', anno).eq('mese', mese)
            if (sedeFilter) qb = qb.eq('sede', sedeFilter)
            return qb
          },
          'id'
        )
      }

      if (tipo === 'quantum') {
        // Vista aggregata: una riga per operatore, nessuna paginazione necessaria.
        // L'errore però va letto, altrimenti un blocco RLS diventa "0 operatori".
        let qq = supabase.from('v_kpi_quantum_mensile')
          .select('*').eq('anno', anno).eq('mese', mese)
        if (sedeFilter) qq = qq.eq('sede', sedeFilter)
        const { data: quantumOp, error: errQuantum } = await qq
        if (errQuantum) throw errQuantum
        result.quantumOp = (quantumOp || []).sort((a,b) => Number(b.quantum||0) - Number(a.quantum||0))
      }

      if (tipo === 'target') {
        const chiusure = await fetchPaged(
          () => {
            let q = supabase.from('chiusure_giornaliere')
              .select('id,data,totale_venduto_ipratico,coperti,sede')
              .gte('data', dateFrom).lte('data', dateTo)
            if (sedeFilter) q = q.eq('sede', sedeFilter)
            return q
          },
          'id'
        )
        result.chiusure = perData(chiusure)
      }

      setModalData(result)
    } catch (e) {
      console.error('[KPIWaiters] openModal error', e)
      setModalError(e?.message || String(e))
    } finally {
      setModalLoading(false)
    }
  }

  // Lookup: nome operatore → target individuale (fuzzy match per prima parola)
  const targetMap = useMemo(() => {
    const map = {}
    ;(targetsInd || []).forEach(t => {
      const empName = (t.employees?.name || t.operatore || '').split(' ')[0].toUpperCase()
      if (empName) map[empName] = t
    })
    return map
  }, [targetsInd])

  // Lookup: operator name → quantum view
  const quantumMap = useMemo(() => {
    const map = {}
    ;(quantumData || []).forEach(q => { map[(q.operator || '').toUpperCase()] = q })
    return map
  }, [quantumData])

  // Lookup: operatore → payout bonus totale
  const bonusOpMap = useMemo(() => {
    const map = {}
    ;(bonusOp || []).forEach(b => {
      const k = (b.operatore || '').toUpperCase()
      map[k] = (map[k] || 0) + (Number(b.payout_operatore) || 0)
    })
    return map
  }, [bonusOp])

  // Operatori filtrati (escludi "pienissimo"). I totali di piede tabella si
  // calcolano su questa base: non devono cambiare al variare dell'ordinamento.
  const operatoriFiltrati = useMemo(() =>
    (operatori || []).filter(op => op.operatore && op.operatore.toLowerCase() !== 'pienissimo'),
  [operatori])

  // KPI team
  const fatturatoTeam = Number(be?.fatturato) || 0
  const copertiTeam   = Number(be?.coperti)   || 0
  const targetFatt    = Number(targetTeam?.target_fatturato) || 0
  const margine       = Number(be?.margine)    || 0
  const quantumMedio  = copertiTeam > 0 ? fatturatoTeam / copertiTeam : 0
  const pctVsTarget   = targetFatt > 0 ? (fatturatoTeam / targetFatt) * 100 : 0
  const gapTarget     = targetFatt > 0 ? targetFatt - fatturatoTeam : 0

  const totPezzi    = operatoriFiltrati.reduce((s, o) => s + (Number(o.tot_pezzi) || 0), 0)
  const totAggiunte = operatoriFiltrati.reduce((s, o) => s + (Number(o.tot_importo_aggiunte) || 0), 0)
  const totBonusOp  = (bonusOp || []).reduce((s, b) => s + (Number(b.payout_operatore) || 0), 0)

  // Righe piatte per l'ordinamento: il quantum vive in una vista separata, va
  // materializzato sulla riga perché useOrdinamento ordina per chiave.
  const righeOperatori = useMemo(() => operatoriFiltrati.map(op => {
    const chiave = (op.operatore || '').toUpperCase()
    const qData  = quantumMap[chiave] || null
    return {
      op,
      chiave,
      operatore: op.operatore,
      target:    targetMap[chiave]   || null,
      quantumRow: qData,
      payout:    bonusOpMap[chiave]  || 0,
      pezzi:     Number(op.tot_pezzi) || 0,
      fatturato: Number(op.fatturato_stimato_operatore) || 0,
      pctTeam:   Number(op.pct_pezzi_team) || 0,
      aggiunte:  Number(op.tot_importo_aggiunte) || 0,
      // null, non 0: "quantum non calcolabile" e "quantum pari a zero" sono
      // affermazioni diverse, e useOrdinamento mette i null sempre in coda.
      quantum:   qData?.quantum != null ? Number(qData.quantum) : null,
    }
  }), [operatoriFiltrati, quantumMap, targetMap, bonusOpMap])

  const { righeOrdinate, colonna, direzione, propsTh } = useOrdinamento(righeOperatori, 'fatturato', 'desc')

  // ── Mappe categoria per coaching panel ───────────────────────────────
  const { teamCatData, opCatData, totPezziCat, teamAggRate } = useMemo(() => {
    const teamCat = {}
    const opCat   = {}
    let totPz = 0
    for (const r of vendutoTeam) {
      const cat   = r.categoria || 'Altro'
      const opKey = (r.operatore || '').toUpperCase()
      const qty   = Number(r.quantita) || 0
      const tot   = Number(r.totale)   || 0
      if (!teamCat[cat]) teamCat[cat] = { pezzi: 0, totale: 0 }
      teamCat[cat].pezzi  += qty
      teamCat[cat].totale += tot
      totPz += qty
      if (!opCat[opKey]) opCat[opKey] = {}
      if (!opCat[opKey][cat]) opCat[opKey][cat] = { pezzi: 0, totale: 0 }
      opCat[opKey][cat].pezzi  += qty
      opCat[opKey][cat].totale += tot
    }
    const teamAgg = operatoriFiltrati.reduce((s, o) => s + (Number(o.tot_aggiunte)          || 0), 0)
    const teamPz  = operatoriFiltrati.reduce((s, o) => s + (Number(o.tot_pezzi)             || 0), 0)
    return { teamCatData: teamCat, opCatData: opCat, totPezziCat: totPz, teamAggRate: teamPz > 0 ? teamAgg / teamPz * 100 : 0 }
  }, [vendutoTeam, operatoriFiltrati])

  // Colonne dell'export: stessi numeri della tabella, senza ricopiarli a mano.
  const colonneCsv = [
    { chiave: 'operatore', etichetta: 'Operatore' },
    { chiave: 'pezzi',     etichetta: 'Pezzi' },
    { chiave: 'fatturato', etichetta: 'Fatturato stimato' },
    { chiave: 'pctTeam',   etichetta: '% Team' },
    { chiave: 'aggiunte',  etichetta: 'Aggiunte EUR' },
    { chiave: 'quantum',   etichetta: 'Quantum EUR/coperto' },
    { chiave: 'payout',    etichetta: 'Bonus maturato' },
    { chiave: 'target',    etichetta: 'Target pezzi', valore: r => r.target?.target ?? null },
  ]

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="text-violet-600" size={24} />
            Performance Camerieri
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Venduto reale · quota team · progress target · bonus</p>
        </div>
        <button onClick={() => load()} disabled={loading} className="btn-secondary text-sm flex items-center gap-1.5">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Caricamento...' : 'Ricarica'}
        </button>
      </div>

      <BannerErrore messaggio={errore} onChiudi={() => setErrore(null)} />

      {/* Filtri */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap gap-3 items-center shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-600">Sede:</span>
          {['MA', 'PN'].map(s => (
            <button key={s} onClick={() => setSede(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${sede === s ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {s === 'MA' ? 'Sede MA' : 'Sede PN'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-600">Anno:</span>
          {/* Anni letti da venduto_camerieri: la vecchia lista partiva dal 2024
              cablato a mano e nascondeva lo storico più vecchio a DB. */}
          <select className="input text-xs py-1" value={anno} onChange={e => setAnno(parseInt(e.target.value))}>
            {anniDisponibili.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-600">Mese:</span>
          <select className="input text-xs py-1" value={mese} onChange={e => setMese(parseInt(e.target.value))}>
            {MESI.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        {loading && <span className="text-xs text-gray-400 italic flex items-center gap-1"><RefreshCw size={11} className="animate-spin" /> caricamento...</span>}
      </div>

      {/* KPI Cards team */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={Euro}
          label="Fatturato Mese"
          value={fmtEur(fatturatoTeam)}
          sub={`${MESI[mese - 1]} ${anno} · ${copertiTeam} coperti`}
          color="indigo"
          badge={targetFatt > 0 ? {
            text: pctVsTarget >= 100
              ? `✓ Sopra target (+${fmt(fatturatoTeam - targetFatt, 0)}€)`
              : `${fmt(pctVsTarget, 1)}% del target`,
            color: pctVsTarget >= 100 ? 'text-emerald-600' : pctVsTarget >= 80 ? 'text-amber-600' : 'text-red-500',
          } : null}
          onClick={() => openModal('fatturato')}
        />
        <KpiCard
          icon={Target}
          label="Target Fatturato"
          value={targetFatt > 0 ? fmtEur(targetFatt) : 'Non impostato'}
          sub={targetFatt > 0
            ? (gapTarget > 0 ? `Mancano ${fmtEur(gapTarget)}` : `Superato di ${fmtEur(-gapTarget)}`)
            : 'Impostalo in KPI Team → Config'}
          color="violet"
          onClick={() => openModal('target')}
        />
        <KpiCard
          icon={BarChart3}
          label="Quantum Medio"
          value={quantumMedio > 0 ? fmtEur(quantumMedio) : '—'}
          sub="€ per coperto (team)"
          color="blue"
          onClick={() => openModal('quantum')}
        />
        <KpiCard
          icon={TrendingUp}
          label="Margine"
          value={fmtEur(margine)}
          sub={be ? `personale ${fmtPct(be.pct_personale)} · food ${fmtPct(be.pct_food)}` : ''}
          color={margine >= 0 ? 'emerald' : 'red'}
          onClick={() => openModal('margine')}
        />
      </div>

      {/* Banner STIMA buste paga */}
      {isStima && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-amber-500 text-lg flex-shrink-0 mt-0.5">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">Costi personale basati su stima provvisoria</p>
            <p className="text-xs text-amber-700 mt-0.5">
              I cedolini di {MESI[mese - 1]} {anno} non sono ancora stati caricati.
              Il costo personale, il Margine e la % Personale mostrati sono calcolati su una <strong>stima media</strong> dei mesi precedenti.
              I dati saranno precisi quando caricherai le buste paga reali.
            </p>
          </div>
        </div>
      )}

      {/* Barra progresso team verso target */}
      {targetFatt > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-semibold text-gray-800">
              Avanzamento team verso target · {MESI[mese - 1]} {anno}
            </span>
            <span className={`text-sm font-bold ${pctVsTarget >= 100 ? 'text-emerald-600' : pctVsTarget >= 80 ? 'text-amber-600' : 'text-red-500'}`}>
              {fmt(pctVsTarget, 1)}%
            </span>
          </div>
          <div className="h-5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 flex items-center justify-end pr-2 text-[11px] text-white font-bold"
              style={{
                width: `${Math.min(100, pctVsTarget)}%`,
                backgroundColor: pctVsTarget >= 100 ? '#10b981' : pctVsTarget >= 80 ? '#f59e0b' : '#6366f1',
                minWidth: fatturatoTeam > 0 ? '3%' : '0',
              }}>
              {pctVsTarget > 20 && fmtEur(fatturatoTeam)}
            </div>
          </div>
          <div className="flex justify-between text-[10px] text-gray-400 mt-1">
            <span>€ 0</span>
            <span>Target: {fmtEur(targetFatt)}</span>
          </div>
        </div>
      )}

      {/* Tabella Operatori */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Users size={15} className="text-indigo-600" />
            <h2 className="text-sm font-bold text-gray-900">
              Operatori · {operatoriFiltrati.length} attivi · {MESI[mese - 1]} {anno} · {sede}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400">Clicca le intestazioni per ordinare</span>
            <BottoneCsv
              righe={righeOrdinate}
              colonne={colonneCsv}
              nomeFile={`operatori_${sede}_${anno}_${String(mese).padStart(2,'0')}`}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 text-[11px]">
              <tr>
                <th className="px-3 py-2 w-8 text-center">#</th>
                <th {...propsTh('operatore')} className="text-left px-3 py-2 font-semibold cursor-pointer select-none hover:text-indigo-600">
                  Operatore<IconaOrdine colonna="operatore" colonnaAttiva={colonna} direzione={direzione} />
                </th>
                <th {...propsTh('pezzi')} className={`text-right px-3 py-2 font-semibold cursor-pointer select-none hover:text-indigo-600 ${colonna === 'pezzi' ? 'text-indigo-600' : ''}`}>
                  Pezzi<IconaOrdine colonna="pezzi" colonnaAttiva={colonna} direzione={direzione} />
                </th>
                <th {...propsTh('fatturato')} className={`text-right px-3 py-2 font-semibold cursor-pointer select-none hover:text-indigo-600 ${colonna === 'fatturato' ? 'text-indigo-600' : ''}`}>
                  Fatturato<IconaOrdine colonna="fatturato" colonnaAttiva={colonna} direzione={direzione} />
                </th>
                <th {...propsTh('pctTeam')} className={`text-right px-3 py-2 font-semibold w-28 cursor-pointer select-none hover:text-indigo-600 ${colonna === 'pctTeam' ? 'text-indigo-600' : ''}`}>
                  % Team<IconaOrdine colonna="pctTeam" colonnaAttiva={colonna} direzione={direzione} />
                </th>
                <th {...propsTh('aggiunte')} className={`text-right px-3 py-2 font-semibold cursor-pointer select-none hover:text-indigo-600 ${colonna === 'aggiunte' ? 'text-indigo-600' : ''}`}>
                  Aggiunte €<IconaOrdine colonna="aggiunte" colonnaAttiva={colonna} direzione={direzione} />
                </th>
                <th {...propsTh('quantum')} className={`text-right px-3 py-2 font-semibold cursor-pointer select-none hover:text-indigo-600 ${colonna === 'quantum' ? 'text-indigo-600' : ''}`}>
                  Quantum<IconaOrdine colonna="quantum" colonnaAttiva={colonna} direzione={direzione} />
                </th>
                <th {...propsTh('payout')} className={`text-right px-3 py-2 font-semibold cursor-pointer select-none hover:text-indigo-600 ${colonna === 'payout' ? 'text-indigo-600' : ''}`}>
                  Bonus<IconaOrdine colonna="payout" colonnaAttiva={colonna} direzione={direzione} />
                </th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {!loading && righeOrdinate.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-gray-400 text-sm">
                    Nessun dato operatori per {sede} · {MESI[mese - 1]} {anno}
                  </td>
                </tr>
              )}
              {righeOrdinate.map((r, i) => (
                <OperatoreRow
                  key={r.operatore}
                  op={r.op}
                  rank={i}
                  target={r.target}
                  quantum={r.quantumRow}
                  payout={r.payout}
                  expanded={expanded === r.operatore}
                  onToggle={() => setExpanded(expanded === r.operatore ? null : r.operatore)}
                  teamCatData={teamCatData}
                  opCatMap={opCatData[r.chiave] || {}}
                  totPezziCat={totPezziCat}
                  teamAggRate={teamAggRate}
                  quantumMedioTeam={quantumMedio}
                />
              ))}
            </tbody>

            {righeOrdinate.length > 0 && (
              <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-bold text-gray-800 text-xs">
                <tr>
                  <td colSpan={2} className="px-3 py-2 text-gray-700">TOTALE {sede}</td>
                  <td className="px-3 py-2 text-right">{fmt(totPezzi, 0)}</td>
                  <td className="px-3 py-2 text-right">{fmtEur(fatturatoTeam)}</td>
                  <td className="px-3 py-2 text-right pr-5">100%</td>
                  <td className="px-3 py-2 text-right text-emerald-700">{fmtEur(totAggiunte)}</td>
                  <td className="px-3 py-2 text-right">{quantumMedio > 0 ? fmtEur(quantumMedio) : '—'}</td>
                  <td className="px-3 py-2 text-right text-violet-700">{totBonusOp > 0 ? fmtEur(totBonusOp) : '—'}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {coperturaVenduto && (
          <div className="px-3 pb-3">
            <NotaCopertura
              righe={coperturaVenduto.righe}
              troncato={coperturaVenduto.troncato}
              da={inizioMese(anno, mese)}
              a={fineMese(anno, mese)}
              fonte="venduto_camerieri"
              extra="base del mix categorie nei pannelli espansi"
            />
          </div>
        )}
      </div>

      {/* Obiettivi Prodotto (se esistono per il mese) */}
      <ObiettiviPanel bonusTeam={bonusTeam} bonusOp={bonusOp} />

      {/* Glossario */}
      <div className="bg-indigo-50 rounded-xl border border-indigo-100 p-4">
        <h3 className="text-xs font-bold text-indigo-800 uppercase tracking-wide mb-2">📖 Glossario KPI</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-indigo-700">
          <div><strong>Fatturato stimato</strong> — totale venduto dall'operatore nel mese (proporzionale ai pezzi × prezzo medio dal venduto iPratico)</div>
          <div><strong>% Team</strong> — quota pezzi dell'operatore sul totale pezzi del locale nel mese</div>
          <div><strong>Aggiunte €</strong> — valore varianti premium vendute (es. frutti di bosco, caramello salato)</div>
          <div><strong>Quantum €/cop.</strong> — fatturato operatore ÷ coperti gestiti. Più alto = più valore per cliente servito. Visualizzato con ⚠ se coperti &lt; 10 (dato inaffidabile)</div>
          <div><strong>Target Pezzi</strong> — obiettivo mensile individuale. Impostalo in KPI Config → Target Individuali</div>
          <div><strong>Bonus</strong> — payout maturato su obiettivi prodotto. Si calcola in KPI Team → Calcola Obiettivi Mese</div>
          <div><strong>🎯 Opportunità di crescita</strong> — espandi ogni operatore per vedere: potenziale ricavo se raggiunge il quantum medio team, tasso upselling (aggiunte %) vs media, e categorie dove vende meno del team (da spingere)</div>
        </div>
      </div>

      <DetailDrawer
        tipo={activeModal}
        data={modalData}
        loading={modalLoading}
        errore={modalError}
        onClose={() => setActiveModal(null)}
        be={be}
        targetFatt={targetFatt}
        fatturatoTeam={fatturatoTeam}
        quantumMedio={quantumMedio}
        margine={margine}
        anno={anno}
        mese={mese}
        fmtEur={fmtEur}
      />

    </div>
  )
}
