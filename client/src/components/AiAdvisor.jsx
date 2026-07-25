/**
 * AiAdvisor.jsx — Pannello riutilizzabile "Lettura AI" (Fase 3)
 * Bottone che invia un contesto a claude-proxy e mostra in streaming
 * un piano d'azione con indicazioni "dove tagliare" e "dove spingere".
 *
 * Props:
 *  - title: titolo del pannello (default "Consiglio AI")
 *  - system: system prompt
 *  - buildUserMessage: async () => string  (costruisce il messaggio utente)
 *  - ctaIdle / ctaDone: testo bottone
 *  - autoContext: se true, antepone buildCrmContext() al messaggio utente
 */
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Sparkles, Loader, Scissors, TrendingUp } from 'lucide-react'
import useClaudeAI from '../hooks/useClaudeAI'

function Markdownish({ text }) {
  const lines = String(text).split('\n')
  const out = []
  let list = []
  const flush = () => {
    if (list.length) { out.push(<ul key={`ul-${out.length}`} className="list-disc pl-5 space-y-1 mb-2">{list}</ul>); list = [] }
  }
  const inline = (s) => String(s).split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="font-semibold text-gray-900">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>)
  lines.forEach((raw, idx) => {
    const l = raw.trimEnd()
    if (/^##\s+/.test(l)) { flush(); out.push(<h3 key={`h-${idx}`} className="text-sm font-bold text-gray-900 mt-3 mb-1">{inline(l.replace(/^##\s+/, ''))}</h3>) }
    else if (/^[-*]\s+/.test(l)) { list.push(<li key={`li-${idx}`} className="text-sm text-gray-700">{inline(l.replace(/^[-*]\s+/, ''))}</li>) }
    else if (l.trim() === '') { flush() }
    else { flush(); out.push(<p key={`p-${idx}`} className="text-sm text-gray-700 mb-1">{inline(l)}</p>) }
  })
  flush()
  return <div>{out}</div>
}

export default function AiAdvisor({
  title = 'Consiglio AI',
  system,
  buildUserMessage,
  autoContext = true,
  ctaIdle = 'Genera consiglio AI',
  ctaDone = 'Rigenera',
  hint = 'basato sui dati operativi reali',
}) {
  const { callClaude, buildCrmContext } = useClaudeAI()
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // Annulla la richiesta/stream in corso quando il componente viene smontato
  const abortRef = useRef(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const run = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true); setError(null); setText('')
    try {
      let userMsg = ''
      if (autoContext) {
        let ctx = ''
        try { ctx = await buildCrmContext({ includeBuste: true }) } catch { /* opzionale */ }
        userMsg += `### Contesto operativo reale\n${ctx || '(non disponibile)'}\n\n`
      }
      if (buildUserMessage) {
        try { userMsg += await buildUserMessage() } catch (e) { userMsg += `(dati pagina non disponibili: ${e?.message || e})` }
      }
      await callClaude(
        [{ role: 'user', content: userMsg }],
        system,
        { model: 'claude-sonnet-4-6', max_tokens: 1600, stream: true, onChunk: setText, signal: ctrl.signal },
      )
    } catch (e) {
      if (e?.name === 'AbortError' || ctrl.signal.aborted) return // annullata: nessun update di stato
      setError(e?.message || 'Errore durante la generazione AI')
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [autoContext, buildCrmContext, buildUserMessage, callClaude, system])

  return (
    <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-violet-600" />
          <span className="font-semibold text-gray-900">{title}</span>
        </div>
        <button onClick={run} disabled={loading}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg px-3 py-2 text-sm font-semibold">
          {loading ? <Loader size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {text ? ctaDone : ctaIdle}
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-3 flex items-center gap-3 flex-wrap">
        <span className="flex items-center gap-1"><Scissors size={12} /> dove tagliare</span>
        <span className="flex items-center gap-1"><TrendingUp size={12} /> dove spingere</span>
        <span>· {hint}</span>
      </p>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-sm mb-2">{error}</div>}
      {!text && !loading && !error && (
        <p className="text-sm text-gray-400">Premi “{ctaIdle}” per un piano d'azione su costi e ricavi.</p>
      )}
      {loading && !text && <p className="text-sm text-gray-400 flex items-center gap-2"><Loader size={14} className="animate-spin" /> L'AI sta analizzando i dati…</p>}
      {text && <Markdownish text={text} />}
    </div>
  )
}
