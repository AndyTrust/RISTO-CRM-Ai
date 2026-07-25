/**
 * StatoDati.jsx — Pannello "Stato Dati" (Fase 2)
 * Mostra a colpo d'occhio i semafori 🟢🟡🔴 per le 6 aree dati del CRM,
 * chiamando l'Edge Function deterministica `verifica-dati` via verificaApi.run().
 * Selettore mese/anno, riepilogo, e per ogni area: dettagli, problemi e azioni.
 */
import React, { useEffect, useState, useCallback } from 'react'
import {
  Activity, RefreshCw, AlertTriangle, CheckCircle2, XCircle,
  ChevronRight, Loader, Clock, Sparkles, Scissors, TrendingUp,
} from 'lucide-react'
import { verificaApi } from '../api/client'
import useClaudeAI from '../hooks/useClaudeAI'

const MESI_IT = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

// status → stile (semaforo)
const STATUS = {
  ok:    { dot: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', text: '#166534', label: 'OK',       Icon: CheckCircle2 },
  warn:  { dot: '#d97706', bg: '#fffbeb', border: '#fde68a', text: '#92400e', label: 'Attenzione', Icon: AlertTriangle },
  error: { dot: '#dc2626', bg: '#fef2f2', border: '#fecaca', text: '#991b1b', label: 'Critico',   Icon: XCircle },
}
const st = (s) => STATUS[s] || STATUS.ok

const eur = (v) => `€${Math.round(Number(v) || 0).toLocaleString('it-IT')}`

function fmtVal(k, v) {
  if (v == null) return '—'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  if (typeof v === 'object') {
    return Object.entries(v)
      .map(([sk, sv]) => `${sk}: ${typeof sv === 'object' ? JSON.stringify(sv) : sv}`)
      .join(' · ')
  }
  if (/costo|totale|stimato|be|personale|fatture/i.test(k) && typeof v === 'number') return eur(v)
  return String(v)
}

const LABELS = {
  n_totale: 'Record totali', n_reali: 'Reali', n_stime: 'Stime', costo_stimato: 'Costo stimato',
  n_fatture: 'N° fatture', totale: 'Totale', giorni_trovati: 'Giorni trovati', giorni_attesi: 'Giorni attesi',
  sedi: 'Sedi', n_operatori: 'Operatori', pezzi_totali: 'Pezzi venduti', senza_mapping: 'Senza mapping',
  team: 'Target team', individuali: 'Target individuali', n_dipendenti_mappati: 'Dipendenti mappati',
}

export default function StatoDati() {
  const now = new Date()
  const [anno, setAnno] = useState(now.getFullYear())
  const [mese, setMese] = useState(now.getMonth() + 1)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // ── Interpretazione AI (Fase 3) ───────────────────────────────────────────
  const { callClaude, buildCrmContext } = useClaudeAI()
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState(null)

  const load = useCallback(async (a, m) => {
    setLoading(true); setError(null)
    try {
      const data = await verificaApi.run({ anno: a, mese: m })
      setReport(data)
    } catch (e) {
      setError(e?.message || 'Errore durante la verifica')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(anno, mese) }, [anno, mese, load])

  // Reset interpretazione quando cambia il mese/report
  useEffect(() => { setAiText(''); setAiError(null) }, [anno, mese])

  const interpreta = useCallback(async () => {
    if (!report) return
    setAiLoading(true); setAiError(null); setAiText('')
    try {
      let contesto = ''
      try { contesto = await buildCrmContext({ includeBuste: true }) } catch { /* contesto opzionale */ }

      const system = [
        'Sei il controller finanziario di "140 Grammi", due ristoranti in Sardegna: Mameli (MA, Cagliari) e Predda Niedda (PN, Sassari).',
        'Ricevi (1) un report a semaforo sulla SALUTE DEI DATI del CRM e (2) il contesto operativo reale (chiusure, coperti, venduto, fatture, break-even, costo personale).',
        '',
        '⚠️ REGOLA FONDAMENTALE — RAPPORTO COSTO/FATTURATO COERENTE:',
        'Per QUALSIASI rapporto costo personale vs fatturato, usa ESCLUSIVAMENTE i valori della sezione "ANALISI COERENTE costo personale vs fatturato (stesso periodo)" o "Mese in corso — costo personale PRO-RATA reale".',
        'NON CONFRONTARE MAI il costo personale mensile pieno (es. €40.997 di maggio) con il fatturato degli ultimi 30 giorni mobili (€23.797): sono periodi diversi e produrrebbero un ratio falso e allarmante.',
        'Per il MESE IN CORSO usa SOLO il valore "costo personale pro-rata stimato" già calcolato (è proporzionale ai giorni effettivi con fatturato del mese in corso).',
        '',
        'Compito: tradurre gli avvisi in azioni concrete e dare indicazioni economiche pratiche. Rispondi SEMPRE in italiano, conciso e operativo, senza preamboli.',
        'Struttura la risposta ESATTAMENTE con queste tre sezioni in markdown:',
        '## 🔴 Priorità — cosa fare subito',
        'Elenco puntato ordinato per urgenza: per ogni avviso critico/giallo di\' il problema in una riga e l\'azione precisa (quale skill/comando o operazione nel CRM).',
        '## ✂️ Dove tagliare',
        'Dove i costi (personale, fornitori, BE) sono alti o anomali rispetto ai ricavi: indica leve concrete. Usa SOLO i ratio % della sezione "ANALISI COERENTE". Se i dati costi mancano, dillo e spiega quale dato serve.',
        '## 🚀 Dove spingere',
        'Dove i ricavi rendono di più (sedi/turni/giorni con margine): suggerisci dove concentrare spinta commerciale, sempre basandoti sui numeri forniti.',
        '',
        'Non inventare numeri: usa solo quelli nei dati. Se un dato manca, segnalalo come lacuna invece di stimarlo.',
      ].join('\n')

      const userMsg =
        `### Report semafori salute dati (${report.mese_label} ${report.anno})\n` +
        '```json\n' + JSON.stringify(report, null, 1) + '\n```\n\n' +
        '### Contesto operativo reale\n' +
        (contesto || '(contesto operativo non disponibile)')

      await callClaude(
        [{ role: 'user', content: userMsg }],
        system,
        { model: 'claude-sonnet-4-6', max_tokens: 1600, stream: true, onChunk: setAiText },
      )
    } catch (e) {
      setAiError(e?.message || 'Errore durante l’interpretazione AI')
    } finally {
      setAiLoading(false)
    }
  }, [report, callClaude, buildCrmContext])

  const overall = report?.overall
  const ov = st(overall)
  const summary = report?.summary || { ok: 0, warn: 0, error: 0 }

  // Auto-richiama AI quando il report è caricato e ci sono criticità
  useEffect(() => {
    if (report && !aiText && !aiLoading && (summary.error > 0 || summary.warn > 0)) {
      const t = setTimeout(() => interpreta(), 300)
      return () => clearTimeout(t)
    }
  }, [report])  // eslint-disable-line react-hooks/exhaustive-deps

  const anni = []
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) anni.push(y)

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
            <Activity size={20} className="text-violet-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">Stato Dati</h1>
            <p className="text-sm text-gray-500">Salute del CRM a colpo d'occhio — semafori per area</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={mese} onChange={(e) => setMese(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
            {MESI_IT.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select value={anno} onChange={(e) => setAnno(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
            {anni.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => load(anno, mese)} disabled={loading}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg px-3 py-2 text-sm font-semibold">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Aggiorna
          </button>
        </div>
      </div>

      {/* Stato di caricamento / errore */}
      {loading && !report && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader size={20} className="animate-spin mr-2" /> Verifica in corso…
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {report && (
        <>
          {/* Banner riepilogo */}
          <div className="rounded-2xl border p-4 mb-5 flex flex-wrap items-center justify-between gap-3"
            style={{ background: ov.bg, borderColor: ov.border }}>
            <div className="flex items-center gap-3">
              <ov.Icon size={24} style={{ color: ov.dot }} />
              <div>
                <div className="font-bold" style={{ color: ov.text }}>
                  {overall === 'ok' ? 'Tutto a posto' : overall === 'warn' ? 'Ci sono avvisi da gestire' : 'Dati critici mancanti'}
                </div>
                <div className="text-xs text-gray-500">
                  {MESI_IT[report.mese]} {report.anno} · aggiornato {new Date(report.generated_at).toLocaleString('it-IT')}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="px-2.5 py-1 rounded-full bg-green-100 text-green-700">🟢 {summary.ok}</span>
              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">🟡 {summary.warn}</span>
              <span className="px-2.5 py-1 rounded-full bg-red-100 text-red-700">🔴 {summary.error}</span>
            </div>
          </div>

          {/* Griglia aree */}
          <div className="grid gap-3 sm:grid-cols-2">
            {(report.checks || []).map((c) => {
              const s = st(c.status)
              return (
                <div key={c.area} className="rounded-2xl border bg-white p-4"
                  style={{ borderColor: s.border }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: s.dot }} />
                      <span className="font-semibold text-gray-900">{c.area}</span>
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: s.bg, color: s.text }}>{s.label}</span>
                  </div>

                  {/* Dettagli */}
                  {c.details && Object.keys(c.details).length > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 mb-2">
                      {Object.entries(c.details).map(([k, v]) => (
                        <span key={k}>
                          <span className="text-gray-400">{LABELS[k] || k}:</span> <span className="font-medium text-gray-700">{fmtVal(k, v)}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Problemi */}
                  {c.issues?.length > 0 && (
                    <ul className="space-y-1 mb-2">
                      {c.issues.map((iss, i) => (
                        <li key={i} className="text-sm flex gap-1.5" style={{ color: s.text }}>
                          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> <span>{iss}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Azioni suggerite */}
                  {c.actions?.length > 0 && (
                    <div className="border-t border-gray-100 pt-2 mt-2 space-y-1">
                      {c.actions.map((a, i) => (
                        <div key={i} className="text-xs text-gray-500 flex gap-1.5">
                          <ChevronRight size={13} className="flex-shrink-0 mt-0.5 text-violet-500" /> <span>{a}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {c.status === 'ok' && !(c.issues?.length) && (
                    <div className="text-sm text-green-700 flex items-center gap-1.5">
                      <CheckCircle2 size={14} /> Nessun problema rilevato
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Interpretazione AI (Fase 3) ─────────────────────────────────── */}
          <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4 mt-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-violet-600" />
                <span className="font-semibold text-gray-900">Lettura AI degli avvisi</span>
              </div>
              <button onClick={interpreta} disabled={aiLoading}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg px-3 py-2 text-sm font-semibold">
                {aiLoading ? <Loader size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {aiText ? 'Rigenera' : 'Interpreta con AI'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3 flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1"><Scissors size={12} /> dove tagliare</span>
              <span className="flex items-center gap-1"><TrendingUp size={12} /> dove spingere</span>
              <span>· basato sui semafori e sui dati operativi reali</span>
            </p>

            {aiError && (
              <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-sm mb-2">{aiError}</div>
            )}

            {!aiText && !aiLoading && !aiError && (
              <p className="text-sm text-gray-400">Premi “Interpreta con AI” per ottenere un piano d'azione prioritizzato e indicazioni su costi e ricavi.</p>
            )}
            {aiLoading && !aiText && (
              <p className="text-sm text-gray-400 flex items-center gap-2"><Loader size={14} className="animate-spin" /> L'AI sta analizzando i dati…</p>
            )}
            {aiText && <Markdownish text={aiText} />}
          </div>

          <p className="text-xs text-gray-400 mt-4 flex items-center gap-1.5">
            <Clock size={12} /> Verifica deterministica (Fase 2) · 6 aree controllate · Lettura AI (Fase 3) basata su dati reali.
          </p>
        </>
      )}
    </div>
  )
}

// Render minimale del markdown prodotto dall'AI: ## titoli, - elenchi, **grassetto**.
function Markdownish({ text }) {
  const lines = String(text).split('\n')
  const out = []
  let list = []
  const flush = () => {
    if (list.length) {
      out.push(<ul key={`ul-${out.length}`} className="list-disc pl-5 space-y-1 mb-2">{list}</ul>)
      list = []
    }
  }
  const inline = (s) => {
    const parts = String(s).split(/(\*\*[^*]+\*\*)/g)
    return parts.map((p, i) => p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="font-semibold text-gray-900">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>)
  }
  lines.forEach((raw, idx) => {
    const l = raw.trimEnd()
    if (/^##\s+/.test(l)) {
      flush()
      out.push(<h3 key={`h-${idx}`} className="text-sm font-bold text-gray-900 mt-3 mb-1">{inline(l.replace(/^##\s+/, ''))}</h3>)
    } else if (/^[-*]\s+/.test(l)) {
      list.push(<li key={`li-${idx}`} className="text-sm text-gray-700">{inline(l.replace(/^[-*]\s+/, ''))}</li>)
    } else if (l.trim() === '') {
      flush()
    } else {
      flush()
      out.push(<p key={`p-${idx}`} className="text-sm text-gray-700 mb-1">{inline(l)}</p>)
    }
  })
  flush()
  return <div>{out}</div>
}
