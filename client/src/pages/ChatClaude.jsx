/**
 * ChatClaude.jsx
 * Chat AI con accesso completo ai dati CRM Supabase.
 * Claude risponde con contesto dati reale (chiusure, venduto, fatture, dipendenti).
 * Sistema memoria: salva note per sezione via SALVA_MEMORIA[sezione/chiave]=valore
 */
import React, { useEffect, useState, useRef, useCallback } from 'react'
import supabase from '../supabase'
import useClaudeAI, { buildCrmContext, saveMemory, loadMemory } from '../hooks/useClaudeAI'
import {
  Bot, Plus, Trash2, Send, Database, Copy, Check, Brain,
  ChevronDown, BookMarked, X, Loader2, Settings2
} from 'lucide-react'

const MODELS = [
  { id: 'claude-opus-4-6',          name: 'Opus 4.6',   desc: 'Più potente',  color: 'text-purple-600 bg-purple-50' },
  { id: 'claude-sonnet-4-6',        name: 'Sonnet 4.6', desc: 'Bilanciato',   color: 'text-blue-600 bg-blue-50' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', desc: 'Veloce',       color: 'text-green-600 bg-green-50' },
]

const SYSTEM_BASE = `Sei l'assistente AI del Risto CRM — ristorante italiano con due sedi:
- **Sede MA** (Cagliari)
- **Sede PN** (Sassari)

Hai accesso completo ai dati del CRM: chiusure cassa, venduto per operatore, fatture acquisto,
food cost ingredienti, buste paga, turni, KPI camerieri.

Puoi SALVARE informazioni nella memoria del CRM usando questa sintassi ESATTA nella tua risposta:
SALVA_MEMORIA[sezione/chiave]=valore

Esempi:
SALVA_MEMORIA[generale/obiettivo_fatturato_mensile]=€45.000
SALVA_MEMORIA[turni/regola_costo_personale_max]=28%
SALVA_MEMORIA[kpi/top_cameriere_marzo]=MARIO ROSSI con 280 coperti
SALVA_MEMORIA[ricette/nota_food_cost_target]=sotto il 30% per i primi piatti

Quando salvi in memoria, menzionalo nella risposta in modo naturale.

Puoi analizzare KPI, confrontare sedi, suggerire miglioramenti, calcolare costi,
ottimizzare turni, e rispondere a qualsiasi domanda sui dati del ristorante.

Rispondi sempre in italiano. Sii conciso ma preciso.`

// ─── Sezioni memoria rapida ─────────────────────────────────────────────────
const SEZIONI_MEMORIA = [
  { id: 'generale',  label: 'Generale',  icon: '🏠' },
  { id: 'turni',     label: 'Turni',     icon: '📅' },
  { id: 'kpi',       label: 'KPI',       icon: '🎯' },
  { id: 'ricette',   label: 'Ricette',   icon: '👨‍🍳' },
  { id: 'fornitori', label: 'Fornitori', icon: '🏭' },
  { id: 'budget',    label: 'Budget',    icon: '💰' },
]

// ─── Formattazione markdown minimal ─────────────────────────────────────────
function formatText(text) {
  return text
    .replace(/SALVA_MEMORIA\[[^\]]+\]=[^\n]*/g, '')  // nasconde comandi memoria
    .trim()
}

function MsgBubble({ msg, isStreaming = false }) {
  const isUser = msg.role === 'user'
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard.writeText(msg.content); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  const text = isStreaming ? msg.content : formatText(msg.content)

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm ${
        isUser ? 'bg-violet-600 text-white font-bold' : 'bg-gray-100 text-gray-600'
      }`}>
        {isUser ? '👤' : <Bot size={16}/>}
      </div>
      <div className={`max-w-[82%] flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-violet-600 text-white rounded-tr-sm'
            : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm shadow-sm'
        }`}>
          {text || <span className="flex gap-1">
            <span className="animate-bounce">·</span>
            <span className="animate-bounce" style={{animationDelay:'0.1s'}}>·</span>
            <span className="animate-bounce" style={{animationDelay:'0.2s'}}>·</span>
          </span>}
        </div>
        {!isUser && text && (
          <button onClick={copy} className="text-xs text-gray-300 hover:text-gray-500 flex items-center gap-1 px-1">
            {copied ? <><Check size={11}/> Copiato</> : <><Copy size={11}/> Copia</>}
          </button>
        )}
        {msg.saved_memory?.length > 0 && (
          <div className="text-xs text-emerald-600 flex items-center gap-1 px-1">
            <Brain size={11}/> Salvato in memoria: {msg.saved_memory.join(', ')}
          </div>
        )}
        {msg.created_at && (
          <span className="text-xs text-gray-300 px-1">{msg.created_at?.slice(11,16)}</span>
        )}
      </div>
    </div>
  )
}

// ─── Pannello Memoria ─────────────────────────────────────────────────────────
function MemoryPanel({ onClose }) {
  const [memories, setMemories] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterSezione, setFilterSezione] = useState(null)
  const [editing, setEditing] = useState(null)
  const [editVal, setEditVal] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const data = await loadMemory(filterSezione)
      setMemories(data)
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [filterSezione])

  const del = async (id) => {
    await supabase.from('crm_memory').delete().eq('id', id)
    load()
  }

  const save = async (m) => {
    await supabase.from('crm_memory').update({ valore: editVal, updated_at: new Date().toISOString() }).eq('id', m.id)
    setEditing(null)
    load()
  }

  const grouped = SEZIONI_MEMORIA.map(s => ({
    ...s,
    items: memories.filter(m => m.sezione === s.id),
  })).filter(s => !filterSezione || s.id === filterSezione)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <Brain size={18} className="text-violet-600"/>
            <h2 className="font-semibold">Memoria CRM</h2>
            <span className="badge badge-gray">{memories.length} voci</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
        </div>

        {/* Filtri sezione */}
        <div className="flex gap-1.5 px-4 py-2 border-b overflow-x-auto">
          <button onClick={() => setFilterSezione(null)}
            className={`text-xs px-2.5 py-1 rounded-full transition ${!filterSezione ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            Tutte
          </button>
          {SEZIONI_MEMORIA.map(s => (
            <button key={s.id} onClick={() => setFilterSezione(filterSezione === s.id ? null : s.id)}
              className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap transition ${filterSezione === s.id ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              {s.icon} {s.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && <p className="text-center text-gray-400 text-sm py-4">Caricamento...</p>}
          {!loading && memories.length === 0 && (
            <div className="text-center py-8">
              <Brain size={32} className="mx-auto text-gray-200 mb-2"/>
              <p className="text-gray-400 text-sm">Nessuna memoria salvata ancora.</p>
              <p className="text-gray-400 text-xs mt-1">Chiedi a Claude di salvare qualcosa: "Ricorda che il target costo personale è il 28%"</p>
            </div>
          )}
          {grouped.map(s => s.items.length > 0 && (
            <div key={s.id}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">{s.icon} {s.label}</h3>
              <div className="space-y-1.5">
                {s.items.map(m => (
                  <div key={m.id} className="flex items-start gap-2 p-2.5 bg-gray-50 rounded-lg group">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 font-mono">{m.chiave}</p>
                      {editing === m.id ? (
                        <div className="flex gap-1.5 mt-1">
                          <input className="input text-xs flex-1 py-1" value={editVal} onChange={e => setEditVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && save(m)} />
                          <button onClick={() => save(m)} className="btn-primary text-xs py-1 px-2"><Check size={12}/></button>
                          <button onClick={() => setEditing(null)} className="btn-secondary text-xs py-1 px-2"><X size={12}/></button>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-700 mt-0.5 font-medium">{m.valore || JSON.stringify(m.valore_json)}</p>
                      )}
                      <p className="text-xs text-gray-300 mt-0.5">{m.updated_at?.substring(0,16).replace('T', ' ')}</p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                      <button onClick={() => { setEditing(m.id); setEditVal(m.valore || '') }}
                        className="p-1 text-gray-400 hover:text-violet-600"><Settings2 size={12}/></button>
                      <button onClick={() => del(m.id)}
                        className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={12}/></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Componente principale ───────────────────────────────────────────────────
export default function ChatClaude() {
  const { callClaude, parseAndSaveMemoryCommands } = useClaudeAI()

  const [sessions, setSessions]       = useState([])
  const [currentId, setCurrentId]     = useState(null)
  const [messages, setMessages]       = useState([])
  const [input, setInput]             = useState('')
  const [streaming, setStreaming]     = useState(false)
  const [streamText, setStreamText]   = useState('')
  const [model, setModel]             = useState('claude-sonnet-4-6')
  const [useDbContext, setUseDbContext]= useState(true)
  const [error, setError]             = useState(null)
  const [showMemory, setShowMemory]   = useState(false)
  const [loadingCtx, setLoadingCtx]   = useState(false)
  const [memCount, setMemCount]       = useState(0)
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  // Sessioni in localStorage (niente backend Express necessario)
  const saveSessions = (s) => { localStorage.setItem('crm_chat_sessions', JSON.stringify(s)); setSessions(s) }
  const loadSessions = () => {
    try { return JSON.parse(localStorage.getItem('crm_chat_sessions') || '[]') } catch { return [] }
  }
  const loadMsgs = (id) => {
    try { return JSON.parse(localStorage.getItem(`crm_chat_msgs_${id}`) || '[]') } catch { return [] }
  }
  const saveMsgs = (id, msgs) => localStorage.setItem(`crm_chat_msgs_${id}`, JSON.stringify(msgs))

  useEffect(() => {
    const s = loadSessions()
    setSessions(s)
    if (s.length > 0) { setCurrentId(s[0].id); setMessages(loadMsgs(s[0].id)) }
    // Conta memoria
    supabase.from('crm_memory').select('*', { count: 'exact', head: true })
      .then(({ count }) => setMemCount(count || 0))
  }, [])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamText])

  const newSession = () => {
    const id = crypto.randomUUID()
    const title = `Chat ${new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    const s = { id, title, model, created_at: new Date().toISOString() }
    const updated = [s, ...loadSessions()]
    saveSessions(updated)
    setCurrentId(id)
    setMessages([])
  }

  const deleteSession = (id, e) => {
    e.stopPropagation()
    const updated = loadSessions().filter(s => s.id !== id)
    saveSessions(updated)
    localStorage.removeItem(`crm_chat_msgs_${id}`)
    if (currentId === id) {
      const next = updated[0]
      if (next) { setCurrentId(next.id); setMessages(loadMsgs(next.id)) }
      else { setCurrentId(null); setMessages([]) }
    }
  }

  const selectSession = (s) => { setCurrentId(s.id); setMessages(loadMsgs(s.id)) }

  const sendMessage = async () => {
    if (!input.trim() || streaming || !currentId) return
    const content = input.trim()
    setInput('')
    setStreaming(true)
    setStreamText('')
    setError(null)

    const userMsg = { role: 'user', content, created_at: new Date().toISOString() }
    const newMsgs = [...messages, userMsg]
    setMessages(newMsgs)
    saveMsgs(currentId, newMsgs)

    try {
      // Costruisce system prompt con contesto dati
      let systemPrompt = SYSTEM_BASE
      if (useDbContext) {
        setLoadingCtx(true)
        const ctx = await buildCrmContext()
        setLoadingCtx(false)
        systemPrompt += `\n\n---\n## DATI ATTUALI CRM\n${ctx}`
      }

      // Chiama Claude con streaming
      let fullText = ''
      await callClaude(
        newMsgs.map(m => ({ role: m.role, content: m.content })),
        systemPrompt,
        {
          model,
          max_tokens: 2048,
          stream: true,
          onChunk: (text) => { fullText = text; setStreamText(text) },
        }
      )

      // Analizza e salva memoria
      const saved = await parseAndSaveMemoryCommands(fullText)
      if (saved.length > 0) setMemCount(prev => prev + saved.length)

      const assistantMsg = {
        role: 'assistant',
        content: fullText,
        saved_memory: saved,
        created_at: new Date().toISOString(),
      }
      const finalMsgs = [...newMsgs, assistantMsg]
      setMessages(finalMsgs)
      saveMsgs(currentId, finalMsgs)

      // Aggiorna titolo sessione con prima domanda
      if (newMsgs.length === 1) {
        const title = content.substring(0, 45) + (content.length > 45 ? '…' : '')
        const updated = loadSessions().map(s => s.id === currentId ? { ...s, title } : s)
        saveSessions(updated)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setStreaming(false)
      setStreamText('')
      setLoadingCtx(false)
    }
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const currentSession = sessions.find(s => s.id === currentId)

  const SUGGESTIONS = [
    'Qual è il fatturato totale di questo mese per ogni sede?',
    'Quali sono i 5 prodotti più venduti degli ultimi 30 giorni?',
    'Analizza il costo personale rispetto al fatturato',
    'Suggerisci come ottimizzare i turni per ridurre costi',
    'Calcola il food cost medio delle ricette create',
    'Ricorda che il target costo personale è il 28% del fatturato',
  ]

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-4">
      {showMemory && <MemoryPanel onClose={() => { setShowMemory(false); supabase.from('crm_memory').select('*',{count:'exact',head:true}).then(({count})=>setMemCount(count||0)) }} />}

      {/* ── SIDEBAR ── */}
      <div className="w-60 flex-shrink-0 flex flex-col gap-2">
        <div className="flex gap-1.5">
          <button onClick={newSession} className="btn-primary flex-1 text-xs py-2">
            <Plus size={14}/> Nuova chat
          </button>
          <button onClick={() => setShowMemory(true)}
            className="relative btn-secondary px-2.5 py-2" title="Memoria CRM">
            <Brain size={14}/>
            {memCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-violet-600 text-white text-[9px] rounded-full flex items-center justify-center">
                {memCount > 9 ? '9+' : memCount}
              </span>
            )}
          </button>
        </div>

        {/* Modello */}
        <div className="card p-2.5">
          <p className="text-xs text-gray-400 mb-1.5">Modello</p>
          <div className="space-y-0.5">
            {MODELS.map(m => (
              <button key={m.id} onClick={() => setModel(m.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition ${
                  model === m.id ? 'bg-violet-50 text-violet-700 font-medium' : 'hover:bg-gray-50 text-gray-500'
                }`}>
                <span className={`px-1.5 py-0.5 rounded font-medium ${m.color}`}>{m.name}</span>
                <span className="text-gray-400">{m.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Contesto dati */}
        <div className="card p-2.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <div className="relative flex-shrink-0">
              <input type="checkbox" className="sr-only" checked={useDbContext} onChange={e => setUseDbContext(e.target.checked)} />
              <div className={`w-8 h-4 rounded-full transition-colors ${useDbContext ? 'bg-violet-500' : 'bg-gray-200'}`} />
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${useDbContext ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-xs text-gray-600 flex items-center gap-1">
              <Database size={11}/> Contesto CRM
            </span>
          </label>
          <p className="text-[10px] text-gray-400 mt-1">Claude vede chiusure, venduto, fatture, dipendenti</p>
        </div>

        {/* Lista sessioni */}
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {sessions.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">Nessuna chat. Inizia!</p>
          )}
          {sessions.map(s => (
            <div key={s.id} onClick={() => selectSession(s)}
              className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer text-xs transition ${
                currentId === s.id ? 'bg-violet-50 text-violet-700' : 'hover:bg-gray-50 text-gray-500'
              }`}>
              <Bot size={12} className="flex-shrink-0"/>
              <span className="flex-1 truncate">{s.title}</span>
              <button onClick={e => deleteSession(s.id, e)}
                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition flex-shrink-0">
                <Trash2 size={11}/>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── CHAT AREA ── */}
      <div className="flex-1 flex flex-col card overflow-hidden">
        {!currentId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mb-4 shadow-lg">
              <Bot size={32} className="text-white"/>
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-1">Claude AI — CRM Assistant</h2>
            <p className="text-sm text-gray-500 mb-2 max-w-sm">
              Accesso completo ai tuoi dati: fatturato, venduto, costi, turni, KPI. Puoi anche chiedermi di salvare note nella memoria del CRM.
            </p>
            {memCount > 0 && (
              <button onClick={() => setShowMemory(true)}
                className="flex items-center gap-1.5 text-xs text-violet-600 hover:underline mb-4">
                <Brain size={13}/> {memCount} voci in memoria
              </button>
            )}
            <div className="grid grid-cols-2 gap-2 max-w-lg">
              {SUGGESTIONS.map((s, i) => (
                <button key={i}
                  onClick={() => { newSession(); setTimeout(() => setInput(s), 100) }}
                  className="text-left p-3 rounded-xl border border-gray-200 hover:border-violet-300 hover:bg-violet-50 text-xs text-gray-600 transition-all">
                  {s}
                </button>
              ))}
            </div>
            <button onClick={newSession} className="btn-primary mt-5">
              <Plus size={15}/> Inizia una chat
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b bg-white flex-shrink-0">
              <Bot size={16} className="text-violet-500"/>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{currentSession?.title || 'Chat'}</p>
                <p className="text-xs text-gray-400">{MODELS.find(m => m.id === model)?.name}</p>
              </div>
              <div className="flex items-center gap-2">
                {loadingCtx && (
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <Loader2 size={11} className="animate-spin"/> Carico dati...
                  </span>
                )}
                {useDbContext && !loadingCtx && (
                  <span className="badge badge-violet text-xs flex items-center gap-1">
                    <Database size={9}/> CRM
                  </span>
                )}
                <button onClick={() => setShowMemory(true)}
                  className="relative text-gray-400 hover:text-violet-600 p-1 rounded-lg hover:bg-violet-50 transition"
                  title="Memoria CRM">
                  <Brain size={15}/>
                  {memCount > 0 && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-violet-600 text-white text-[8px] rounded-full flex items-center justify-center">{memCount > 9 ? '9+' : memCount}</span>}
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
              {messages.length === 0 && !streaming && (
                <div className="text-center text-gray-400 text-sm py-8">
                  Inizia la conversazione! Chiedi analisi, report, confronti tra sedi...<br/>
                  <span className="text-xs">Suggerimento: "Ricorda che..." per salvare in memoria</span>
                </div>
              )}
              {messages.map((m, i) => <MsgBubble key={i} msg={m}/>)}
              {streaming && <MsgBubble msg={{ role: 'assistant', content: streamText }} isStreaming/>}
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-start gap-2">
                  <span>⚠️</span>
                  <div>
                    <p className="font-medium">Errore</p>
                    <p>{error}</p>
                    {error.includes('ANTHROPIC_API_KEY') && (
                      <p className="text-xs mt-1">→ Aggiungi la chiave in Supabase → Edge Functions → claude-proxy → Secrets → ANTHROPIC_API_KEY</p>
                    )}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef}/>
            </div>

            {/* Input */}
            <div className="p-3 border-t bg-white flex-shrink-0">
              <div className="flex gap-2 items-end">
                <textarea
                  ref={textareaRef}
                  className="flex-1 input resize-none min-h-[42px] max-h-32 text-sm"
                  placeholder="Chiedi qualcosa... (Invio = invia, Shift+Invio = a capo)"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  rows={1}
                  onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px' }}
                />
                <button onClick={sendMessage} disabled={!input.trim() || streaming}
                  className={`flex-shrink-0 p-2.5 rounded-xl transition ${
                    !input.trim() || streaming
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-violet-600 text-white hover:bg-violet-700'
                  }`}>
                  {streaming ? <Loader2 size={15} className="animate-spin"/> : <Send size={15}/>}
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1 text-center">
                {MODELS.find(m => m.id === model)?.name} ·
                {useDbContext ? ' 🔌 Dati CRM inclusi' : ' 💬 Solo Claude'} ·
                Scrivi "Ricorda che..." per salvare in memoria
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
