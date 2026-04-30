/**
 * PageAssistant — Assistente AI contestuale per ogni pagina del CRM.
 *
 * Props:
 *   pagina:        string              — identificativo pagina (es. 'fornitori')
 *   systemContext: string              — contesto dati correnti (es. lista fornitori)
 *   tools:         ToolDef[]           — definizioni tool Anthropic
 *   onToolCall:    (name, input) => Promise<string>  — esecutore tool lato frontend
 *   suggerimenti:  string[]            — esempi di comandi contestuali
 *
 * Flusso tool-calling:
 *   1. User message → POST /api/assistant
 *   2. Claude risponde con tool_use → frontend esegue onToolCall
 *   3. tool_result → POST /api/assistant di nuovo
 *   4. Claude risponde con testo finale
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { MessageSquare, X, Send, Bot, User, Loader, ChevronDown, ChevronUp, Wrench, AlertCircle, Lightbulb } from 'lucide-react'

const API_ENDPOINT = '/api/assistant'

// ─── Messaggio renderizzato ───────────────────────────────────────────────────
function Message({ msg }) {
  const isUser = msg.role === 'user'
  const isSystem = msg.role === 'system'

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-1 rounded-full">{msg.content}</span>
      </div>
    )
  }

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-7 h-7 rounded-xl flex-shrink-0 flex items-center justify-center mt-0.5 ${isUser ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
        {isUser ? <User size={13}/> : <Bot size={13}/>}
      </div>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${isUser ? 'bg-violet-600 text-white rounded-tr-sm' : 'bg-gray-100 text-gray-800 rounded-tl-sm'}`}>
        {msg.loading
          ? <Loader size={14} className="animate-spin opacity-60"/>
          : msg.toolCall
            ? <ToolCallBubble tool={msg.toolCall} result={msg.toolResult}/>
            : <TextContent text={msg.content}/>
        }
      </div>
    </div>
  )
}

function TextContent({ text }) {
  // Semplice markdown inline: **bold**, `code`
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g)
  return (
    <span>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2,-2)}</strong>
        if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className="bg-black/10 rounded px-1 text-xs font-mono">{p.slice(1,-1)}</code>
        if (p === '\n') return <br key={i}/>
        return p
      })}
    </span>
  )
}

function ToolCallBubble({ tool, result }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-xs">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-gray-500 hover:text-gray-700">
        <Wrench size={11}/>
        <span className="font-mono font-medium">{tool.name}</span>
        {result ? <span className="text-emerald-600 font-medium">✓</span> : <Loader size={10} className="animate-spin"/>}
        {open ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          <div className="bg-gray-50 rounded p-2 font-mono text-[10px] text-gray-600 overflow-x-auto">
            {JSON.stringify(tool.input, null, 2)}
          </div>
          {result && (
            <div className="bg-emerald-50 rounded p-2 font-mono text-[10px] text-emerald-700 overflow-x-auto">
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── PageAssistant main ───────────────────────────────────────────────────────
export default function PageAssistant({ pagina, systemContext, tools = [], onToolCall, suggerimenti = [] }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [open, messages.length])

  const buildSystemPrompt = useCallback(() => {
    let sys = `Sei l'assistente AI del CRM gestionale **140 Grammi** — ristorante con sedi Mameli (MA) e Predda Niedda (PN).
Pagina corrente: **${pagina}**.
Rispondi sempre in italiano, in modo conciso e diretto.
Quando esegui azioni (registrare pagamenti, modificare dati), conferma brevemente quello che hai fatto.`
    if (systemContext) sys += `\n\n${systemContext}`
    if (tools.length > 0) {
      sys += `\n\nHai a disposizione i seguenti strumenti per operare direttamente sul CRM:
${tools.map(t => `- **${t.name}**: ${t.description}`).join('\n')}
Usa questi strumenti quando l'utente ti chiede di eseguire azioni concrete.`
    }
    return sys
  }, [pagina, systemContext, tools])

  const callAssistant = useCallback(async (apiMessages) => {
    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: apiMessages,
        system: buildSystemPrompt(),
        tools: tools.length > 0 ? tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })) : undefined,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    return await res.json()
  }, [buildSystemPrompt, tools])

  const processResponse = useCallback(async (response, apiMessages) => {
    // Ciclo tool-calling: continua finché ci sono tool_use blocks
    let currentResponse = response
    let currentApiMessages = [...apiMessages]

    while (true) {
      const toolUseBlocks = currentResponse.content?.filter(b => b.type === 'tool_use') || []

      if (toolUseBlocks.length === 0) {
        // Risposta finale testo
        const textBlock = currentResponse.content?.find(b => b.type === 'text')
        const textContent = textBlock?.text || ''
        if (textContent) {
          setMessages(prev => [...prev, { role: 'assistant', content: textContent }])
        }
        break
      }

      // Aggiungi messaggio assistant con tool_use
      currentApiMessages.push({ role: 'assistant', content: currentResponse.content })

      // Esegui ogni tool
      const toolResults = []
      for (const block of toolUseBlocks) {
        // Mostra tool in corso
        setMessages(prev => [...prev, {
          role: 'assistant',
          toolCall: { name: block.name, input: block.input },
          content: '',
        }])

        let result = 'Eseguito'
        try {
          if (onToolCall) {
            result = await onToolCall(block.name, block.input)
          }
        } catch (e) {
          result = `Errore: ${e.message}`
        }

        // Aggiorna il messaggio con il risultato
        setMessages(prev => prev.map((m, i) =>
          i === prev.length - 1 && m.toolCall?.name === block.name
            ? { ...m, toolResult: result }
            : m
        ))

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        })
      }

      // Invia tool_results a Claude
      currentApiMessages.push({ role: 'user', content: toolResults })

      // Placeholder risposta
      setMessages(prev => [...prev, { role: 'assistant', content: '', loading: true }])

      try {
        currentResponse = await callAssistant(currentApiMessages)
        setMessages(prev => prev.filter(m => !m.loading))
      } catch (e) {
        setMessages(prev => prev.filter(m => !m.loading))
        throw e
      }
    }
  }, [onToolCall, callAssistant])

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return
    const userText = text.trim()
    setInput('')
    setError(null)
    setLoading(true)

    setMessages(prev => [...prev, { role: 'user', content: userText }])

    // Costruisci history API (solo user/assistant, no system)
    const apiMessages = [
      ...messages
        .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content && !m.loading))
        .map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userText },
    ]

    // Placeholder
    setMessages(prev => [...prev, { role: 'assistant', content: '', loading: true }])

    try {
      const response = await callAssistant(apiMessages)
      setMessages(prev => prev.filter(m => !m.loading))
      await processResponse(response, apiMessages)
    } catch (e) {
      setMessages(prev => prev.filter(m => !m.loading))
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [loading, messages, callAssistant, processResponse])

  const handleKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-2xl shadow-xl flex items-center justify-center transition-all ${open ? 'bg-gray-800 rotate-90' : 'bg-violet-600 hover:bg-violet-700'}`}
        title="Assistente AI">
        {open ? <X size={20} className="text-white"/> : <Bot size={22} className="text-white"/>}
        {!open && messages.length > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white"/>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] max-w-[calc(100vw-3rem)] bg-white rounded-2xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden"
          style={{ height: '520px' }}>

          {/* Header */}
          <div className="bg-gradient-to-r from-violet-600 to-violet-700 px-4 py-3 flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
              <Bot size={16} className="text-white"/>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm">Assistente AI</p>
              <p className="text-violet-200 text-xs truncate">Pagina: {pagina}</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/60 hover:text-white p-1"><X size={16}/></button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
            {messages.length === 0 && (
              <div className="text-center py-6">
                <Bot size={32} className="mx-auto text-violet-300 mb-3"/>
                <p className="text-sm font-medium text-gray-700">Come posso aiutarti?</p>
                <p className="text-xs text-gray-400 mt-1">Gestisci {pagina} con comandi in linguaggio naturale</p>
                {suggerimenti.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {suggerimenti.map((s, i) => (
                      <button key={i} onClick={() => sendMessage(s)}
                        className="flex items-start gap-2 w-full text-left bg-violet-50 hover:bg-violet-100 border border-violet-100 rounded-xl px-3 py-2 text-xs text-violet-700 transition-colors">
                        <Lightbulb size={11} className="mt-0.5 flex-shrink-0 text-violet-400"/>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {messages.map((msg, i) => <Message key={i} msg={msg}/>)}

            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5"/>
                <p className="text-xs text-red-600">{error}</p>
              </div>
            )}

            <div ref={bottomRef}/>
          </div>

          {/* Input */}
          <div className="p-3 border-t border-gray-100 flex-shrink-0">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Chiedi qualcosa o dai un comando..."
                rows={1}
                disabled={loading}
                className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:opacity-50 min-h-[40px] max-h-[100px]"
                style={{ height: 'auto', overflowY: input.split('\n').length > 2 ? 'auto' : 'hidden' }}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || loading}
                className="w-10 h-10 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-xl flex items-center justify-center flex-shrink-0 transition-colors">
                {loading ? <Loader size={15} className="animate-spin"/> : <Send size={15}/>}
              </button>
            </div>
            <p className="text-[10px] text-gray-300 text-center mt-1.5">↵ invio · shift+↵ nuova riga</p>
          </div>
        </div>
      )}
    </>
  )
}
