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
  operatoreMeseApi, beMensileApi, kpiTargetsApi, bonusApi
} from '../api/client'
import supabase from '../supabase'
import PageStatsWidget from '../components/PageStatsWidget'

// ── Utils ──────────────────────────────────────────────────────────────
const MESI = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ec4899','#8b5cf6','#ef4444','#14b8a6','#f97316','#06b6d4']
const fmt    = (n, d = 2) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtEur = n => n == null ? '—' : `€ ${fmt(n)}`
const fmtPct = n => n == null ? '—' : `${fmt(n, 1)}%`

function KpiCard({ icon: Icon, label, value, sub, color = 'indigo', badge }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col gap-1">
      <PageStatsWidget />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</span>
        <div className={`p-1.5 rounded-lg bg-${color}-50 text-${color}-600`}><Icon size={16} /></div>
      </div>
      <div className="text-xl font-bold text-gray-900 leading-tight">{value}</div>
      {sub  && <div className="text-[11px] text-gray-400">{sub}</div>}
      {badge && <div className={`text-[10px] font-semibold mt-0.5 ${badge.color}`}>{badge.text}</div>}
    </div>
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

  useEffect(() => {
    if (!expanded || prodotti.length > 0) return
    setLoadingProd(true)
    const meseStr = String(op.mese).padStart(2, '0')
    const ini  = `${op.anno}-${meseStr}-01`
    const fine = new Date(op.anno, op.mese, 0).toISOString().slice(0, 10)
    supabase
      .from('venduto_camerieri')
      .select('categoria, prodotto, quantita, totale')
      .eq('sede', op.sede)
      .eq('operatore', op.operatore)
      .gte('data_inizio', ini)
      .lte('data_fine', fine)
      .not('prodotto', 'ilike', '%coperto%')
      .then(({ data }) => {
        if (!data) { setLoadingProd(false); return }
        const byCat = {}
        data.forEach(r => {
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
        setLoadingProd(false)
      })
  }, [expanded, op])

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
                ) : prodotti.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Nessun dato prodotti disponibile</p>
                ) : (
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
  const [sortBy,  setSortBy]  = useState('fatturato')
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

  const load = useCallback(async () => {
    setLoading(true)
    setExpanded(null)
    try {
      const iniStr  = `${anno}-${String(mese).padStart(2,'0')}-01`
      const fineStr = new Date(anno, mese, 0).toISOString().slice(0, 10)

      const [ops, beData, tt, ti, qtRes, bt, bo, bpCheck, vtRes] = await Promise.all([
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
        supabase.from('venduto_camerieri')
          .select('operatore, categoria, quantita, totale')
          .eq('sede', sede)
          .gte('data_inizio', iniStr)
          .lte('data_fine', fineStr)
          .not('prodotto', 'ilike', '%coperto%')
          .range(0, 4999),
      ])
      setOperatori(ops  || [])
      setBe(beData)
      setTargetTeam(tt)
      setTargetsInd(ti  || [])
      setQuantumData(qtRes?.data || [])
      setBonusTeam(bt   || [])
      setBonusOp(bo     || [])
      setVendutoTeam(vtRes?.data || [])
      // Rileva se buste_paga del mese sono solo stime provvisorie
      const bpRows = bpCheck?.data || []
      const stimaDetected = bpRows.length > 0 && bpRows.every(r =>
        (r.employee_code || '').toUpperCase().includes('STIMA') ||
        (r.note || '').toUpperCase().includes('STIMA_PROVVISORIA')
      )
      setIsStima(stimaDetected)
    } catch (e) {
      console.error('[KPIWaiters] load error', e)
    } finally {
      setLoading(false)
    }
  }, [sede, anno, mese])

  useEffect(() => { load() }, [load])

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

  // Operatori filtrati (escludi "pienissimo") e ordinati
  const operatoriSorted = useMemo(() => {
    return [...(operatori || [])]
      .filter(op => op.operatore && op.operatore.toLowerCase() !== 'pienissimo')
      .sort((a, b) => {
        if (sortBy === 'pezzi')    return (Number(b.tot_pezzi) || 0) - (Number(a.tot_pezzi) || 0)
        if (sortBy === 'pctTeam')  return (Number(b.pct_pezzi_team) || 0) - (Number(a.pct_pezzi_team) || 0)
        if (sortBy === 'aggiunte') return (Number(b.tot_importo_aggiunte) || 0) - (Number(a.tot_importo_aggiunte) || 0)
        if (sortBy === 'quantum') {
          const qa = quantumMap[(a.operatore || '').toUpperCase()]?.quantum || 0
          const qb = quantumMap[(b.operatore || '').toUpperCase()]?.quantum || 0
          return qb - qa
        }
        return (Number(b.fatturato_stimato_operatore) || 0) - (Number(a.fatturato_stimato_operatore) || 0)
      })
  }, [operatori, sortBy, quantumMap])

  // KPI team
  const fatturatoTeam = Number(be?.fatturato) || 0
  const copertiTeam   = Number(be?.coperti)   || 0
  const targetFatt    = Number(targetTeam?.target_fatturato) || 0
  const margine       = Number(be?.margine)    || 0
  const quantumMedio  = copertiTeam > 0 ? fatturatoTeam / copertiTeam : 0
  const pctVsTarget   = targetFatt > 0 ? (fatturatoTeam / targetFatt) * 100 : 0
  const gapTarget     = targetFatt > 0 ? targetFatt - fatturatoTeam : 0

  const totPezzi    = operatoriSorted.reduce((s, o) => s + (Number(o.tot_pezzi) || 0), 0)
  const totAggiunte = operatoriSorted.reduce((s, o) => s + (Number(o.tot_importo_aggiunte) || 0), 0)
  const totBonusOp  = (bonusOp || []).reduce((s, b) => s + (Number(b.payout_operatore) || 0), 0)

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
    const teamAgg = operatoriSorted.reduce((s, o) => s + (Number(o.tot_aggiunte)          || 0), 0)
    const teamPz  = operatoriSorted.reduce((s, o) => s + (Number(o.tot_pezzi)             || 0), 0)
    return { teamCatData: teamCat, opCatData: opCat, totPezziCat: totPz, teamAggRate: teamPz > 0 ? teamAgg / teamPz * 100 : 0 }
  }, [vendutoTeam, operatoriSorted])

  const SortTh = ({ col, children }) => (
    <th className={`text-right px-3 py-2 font-semibold cursor-pointer select-none hover:text-indigo-600 transition-colors ${sortBy === col ? 'text-indigo-600' : ''}`}
      onClick={() => setSortBy(col)}>
      {children}{sortBy === col ? ' ↓' : ''}
    </th>
  )

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
        <button onClick={load} disabled={loading} className="btn-secondary text-sm flex items-center gap-1.5">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Caricamento...' : 'Ricarica'}
        </button>
      </div>

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
          <select className="input text-xs py-1" value={anno} onChange={e => setAnno(parseInt(e.target.value))}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-600">Mese:</span>
          <select className="input text-xs py-1" value={mese} onChange={e => setMese(parseInt(e.target.value))}>
            {MESI.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
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
        />
        <KpiCard
          icon={Target}
          label="Target Fatturato"
          value={targetFatt > 0 ? fmtEur(targetFatt) : 'Non impostato'}
          sub={targetFatt > 0
            ? (gapTarget > 0 ? `Mancano ${fmtEur(gapTarget)}` : `Superato di ${fmtEur(-gapTarget)}`)
            : 'Impostalo in KPI Team → Config'}
          color="violet"
        />
        <KpiCard
          icon={BarChart3}
          label="Quantum Medio"
          value={quantumMedio > 0 ? fmtEur(quantumMedio) : '—'}
          sub="€ per coperto (team)"
          color="blue"
        />
        <KpiCard
          icon={TrendingUp}
          label="Margine"
          value={fmtEur(margine)}
          sub={be ? `personale ${fmtPct(be.pct_personale)} · food ${fmtPct(be.pct_food)}` : ''}
          color={margine >= 0 ? 'emerald' : 'red'}
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
              Operatori · {operatoriSorted.length} attivi · {MESI[mese - 1]} {anno} · {sede}
            </h2>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-gray-400">
            <span className="mr-1 text-gray-500">Ordina:</span>
            {[
              { key: 'fatturato', label: '€ Fatt.' },
              { key: 'pezzi',    label: 'Pezzi'   },
              { key: 'pctTeam',  label: '% Team'  },
              { key: 'aggiunte', label: 'Aggiunte' },
              { key: 'quantum',  label: 'Quantum'  },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setSortBy(key)}
                className={`px-2 py-1 rounded-md transition-all font-medium ${sortBy === key ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-gray-100 text-gray-500'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 text-[11px]">
              <tr>
                <th className="px-3 py-2 w-8 text-center">#</th>
                <th className="text-left px-3 py-2 font-semibold">Operatore</th>
                <SortTh col="pezzi">Pezzi ↕</SortTh>
                <SortTh col="fatturato">Fatturato ↕</SortTh>
                <th className="text-right px-3 py-2 font-semibold w-28">% Team</th>
                <SortTh col="aggiunte">Aggiunte € ↕</SortTh>
                <SortTh col="quantum">Quantum ↕</SortTh>
                <th className="text-right px-3 py-2 font-semibold">Bonus</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {!loading && operatoriSorted.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-gray-400 text-sm">
                    Nessun dato operatori per {sede} · {MESI[mese - 1]} {anno}
                  </td>
                </tr>
              )}
              {operatoriSorted.map((op, i) => {
                const key    = (op.operatore || '').toUpperCase()
                const target = targetMap[key]  || null
                const qData  = quantumMap[key] || null
                const payout = bonusOpMap[key] || 0
                return (
                  <OperatoreRow
                    key={op.operatore}
                    op={op}
                    rank={i}
                    target={target}
                    quantum={qData}
                    payout={payout}
                    expanded={expanded === op.operatore}
                    onToggle={() => setExpanded(expanded === op.operatore ? null : op.operatore)}
                    teamCatData={teamCatData}
                    opCatMap={opCatData[key] || {}}
                    totPezziCat={totPezziCat}
                    teamAggRate={teamAggRate}
                    quantumMedioTeam={quantumMedio}
                  />
                )
              })}
            </tbody>

            {operatoriSorted.length > 0 && (
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

    </div>
  )
}
