/**
 * ChatClaude.jsx
 * Chat AI con accesso completo ai dati CRM Supabase.
 * Claude risponde con contesto dati reale (chiusure, venduto, fatture, dipendenti).
 * Sistema memoria: salva note per sezione via SALVA_MEMORIA[sezione/chiave]=valore
 */
import React, { useEffect, useState, useRef, useCallback } from 'react'
import supabase from '../supabase'
import useClaudeAI, { buildCrmContext, saveMemory, loadMemory } from '../hooks/useClaudeAI'
import { BottoneCsv } from '../lib/tabella'
import { PROFILO_ESPERTO, erroreAI } from '../lib/aiProfilo'
import {
  Bot, Plus, Trash2, Send, Database, Copy, Check, Brain,
  ChevronDown, BookMarked, X, Loader2, Settings2, AlertCircle
} from 'lucide-react'

const MODELS = [
  { id: 'claude-opus-4-6',          name: 'Opus 4.6',   desc: 'Più potente',  color: 'text-purple-600 bg-purple-50' },
  { id: 'claude-sonnet-4-6',        name: 'Sonnet 4.6', desc: 'Bilanciato',   color: 'text-blue-600 bg-blue-50' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', desc: 'Veloce',       color: 'text-green-600 bg-green-50' },
]

const SYSTEM_BASE = `${PROFILO_ESPERTO}

## Il gruppo

Due locali: **MA = Mameli**, **PN = Predda Niedda**. L'elenco completo delle sedi è configurabile in Admin → Sedi. Quando confronti, tienile sempre distinte: hanno affitti, organici e stagionalità diversi.

## I dati che ricevi

Nel contesto trovi lo snapshot del CRM: chiusure di cassa, venduto per operatore, fatture di acquisto, buste paga, turni, KPI dei camerieri.

Include la tabella "Media coperti per turno" con i dati reali da iPratico — coperti di pranzo e di cena distinti, per giorno della settimana e per sede. Usa sempre quelli quando la domanda riguarda i coperti per turno, la media pranzo/cena o lo split giornaliero: non stimarli dal totale.

## Memoria

Puoi salvare informazioni nella memoria del CRM usando questa sintassi ESATTA dentro la tua risposta:
SALVA_MEMORIA[sezione/chiave]=valore

Esempi:
SALVA_MEMORIA[generale/obiettivo_fatturato_mensile]=€45.000
SALVA_MEMORIA[turni/regola_costo_personale_max]=28%
SALVA_MEMORIA[kpi/top_cameriere_marzo]=MARIO ROSSI con 280 coperti

Salva quando emerge un parametro, una regola o una decisione che servirà anche nelle prossime sessioni. Quando lo fai, dillo nella risposta in modo naturale.`

// ─── Sezioni memoria rapida ─────────────────────────────────────────────────
const SEZIONI_MEMORIA = [
  { id: 'generale',  label: 'Generale',  icon: '🏠' },
  { id: 'turni',     label: 'Turni',     icon: '📅' },
  { id: 'kpi',       label: 'KPI',       icon: '🎯' },
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
function MemoryPanel({ onClose, onCambiata }) {
  const [memories, setMemories] = useState([])
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState(null)
  const [filterSezione, setFilterSezione] = useState(null)
  const [editing, setEditing] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [versione, setVersione] = useState(0)   // trigger di ricarica dopo scrittura

  useEffect(() => {
    // Guardia di unmount: chiudere il pannello mentre la lettura è in volo
    // non deve produrre setState su un componente smontato.
    let annullato = false
    setLoading(true)
    setErrore(null)
    loadMemory(filterSezione)
      .then(d => { if (!annullato) setMemories(d) })
      .catch(e => {
        if (annullato) return
        // Prima l'errore finiva solo in console e il pannello mostrava
        // "Nessuna memoria salvata": un blocco RLS era indistinguibile da
        // una memoria vuota.
        setErrore(e?.message || String(e))
        setMemories([])
      })
      .finally(() => { if (!annullato) setLoading(false) })
    return () => { annullato = true }
  }, [filterSezione, versione])

  const del = async (id) => {
    setErrore(null)
    // `.select()` sulla delete restituisce le righe realmente cancellate:
    // senza, una delete bloccata da RLS non dà errore e l'utente vede
    // sparire la voce dalla lista solo perché ricarichiamo… e riappare.
    const { data, error } = await supabase.from('crm_memory').delete().eq('id', id).select('id')
    if (error) { setErrore(`Eliminazione non riuscita: ${error.message}`); return }
    if (!data?.length) { setErrore('Eliminazione non eseguita: nessuna riga rimossa (permessi?).'); return }
    setVersione(v => v + 1)
    onCambiata?.()
  }

  const save = async (m) => {
    setErrore(null)
    const { data, error } = await supabase
      .from('crm_memory')
      .update({ valore: editVal, updated_at: new Date().toISOString() })
      .eq('id', m.id)
      .select('id')
    if (error) { setErrore(`Salvataggio non riuscito: ${error.message}`); return }
    if (!data?.length) { setErrore('Salvataggio non eseguito: nessuna riga aggiornata (permessi?).'); return }
    setEditing(null)
    setVersione(v => v + 1)
    onCambiata?.()
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
          <div className="flex items-center gap-2">
            <BottoneCsv
              righe={memories}
              colonne={[
                { chiave: 'sezione',    etichetta: 'Sezione' },
                { chiave: 'chiave',     etichetta: 'Chiave' },
                { chiave: 'valore',     etichetta: 'Valore', valore: m => m.valore ?? (m.valore_json ? JSON.stringify(m.valore_json) : '') },
                { chiave: 'updated_at', etichetta: 'Aggiornato' },
              ]}
              nomeFile="memoria_crm"
            />
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
          </div>
        </div>

        {errore && (
          <div className="mx-4 mt-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
            <AlertCircle size={13} className="mt-0.5 shrink-0"/>
            <span>{errore}</span>
          </div>
        )}

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
          {!loading && !errore && memories.length === 0 && (
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
  const [memErr, setMemErr]           = useState(null)
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  // Guardia di unmount + annullamento dello stream in volo.
  const montatoRef = useRef(true)
  const abortRef   = useRef(null)

  useEffect(() => {
    // Riassegnato a ogni mount: con StrictMode il componente viene montato,
    // smontato e rimontato, e un flag impostato solo nel cleanup resterebbe
    // false per sempre bloccando ogni setState successivo.
    montatoRef.current = true
    return () => {
      montatoRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  // Sessioni in localStorage (niente backend Express necessario)
  const saveSessions = (s) => { localStorage.setItem('crm_chat_sessions', JSON.stringify(s)); setSessions(s) }
  const loadSessions = () => {
    try { return JSON.parse(localStorage.getItem('crm_chat_sessions') || '[]') } catch { return [] }
  }
  const loadMsgs = (id) => {
    try {
      const raw = JSON.parse(localStorage.getItem(`crm_chat_msgs_${id}`) || '[]')
      // I messaggi salvati prima di questa versione non hanno `id`: gliene
      // assegniamo uno stabile qui, così la lista non ha mai bisogno di
      // key={indice} (che durante lo streaming fa riconciliare male React).
      return raw.map((m, i) => (m?.id ? m : { ...m, id: `${id}#${i}` }))
    } catch { return [] }
  }
  const saveMsgs = (id, msgs) => localStorage.setItem(`crm_chat_msgs_${id}`, JSON.stringify(msgs))

  /** Conteggio voci in memoria. L'errore va mostrato: "0 voci" non è la stessa
   *  cosa di "non sono riuscito a contarle". */
  const aggiornaMemCount = useCallback(async () => {
    const { count, error } = await supabase.from('crm_memory').select('*', { count: 'exact', head: true })
    if (!montatoRef.current) return
    if (error) { setMemErr('Memoria non leggibile: ' + error.message); return }
    setMemErr(null)
    setMemCount(count || 0)
  }, [])

  useEffect(() => {
    const s = loadSessions()
    setSessions(s)
    if (s.length > 0) { setCurrentId(s[0].id); setMessages(loadMsgs(s[0].id)) }
    aggiornaMemCount()
  }, [aggiornaMemCount])

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

    // id stabile: la lista dei messaggi cresce in append durante lo streaming
    // e React deve poter riconoscere le bolle già montate.
    const nuovoId = () => (crypto.randomUUID ? crypto.randomUUID() : `msg-${Date.now()}-${Math.random()}`)

    const userMsg = { id: nuovoId(), role: 'user', content, created_at: new Date().toISOString() }
    const newMsgs = [...messages, userMsg]
    setMessages(newMsgs)
    saveMsgs(currentId, newMsgs)

    // Un solo stream per volta, annullabile allo smontaggio del componente.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      // Costruisce system prompt con contesto dati
      let systemPrompt = SYSTEM_BASE
      if (useDbContext) {
        setLoadingCtx(true)
        const ctx = await buildCrmContext()
        if (montatoRef.current) setLoadingCtx(false)
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
          signal: controller.signal,
          onChunk: (text) => { fullText = text; if (montatoRef.current) setStreamText(text) },
        }
      )

      if (controller.signal.aborted) return

      // Analizza e salva memoria
      const saved = await parseAndSaveMemoryCommands(fullText)
      if (saved.length > 0 && montatoRef.current) setMemCount(prev => prev + saved.length)

      const assistantMsg = {
        id: nuovoId(),
        role: 'assistant',
        content: fullText,
        saved_memory: saved,
        created_at: new Date().toISOString(),
      }
      const finalMsgs = [...newMsgs, assistantMsg]
      // La persistenza va fatta comunque: se l'utente cambia pagina a metà
      // risposta, la conversazione deve restare completa in localStorage.
      saveMsgs(currentId, finalMsgs)
      if (montatoRef.current) setMessages(finalMsgs)

      // Aggiorna titolo sessione con prima domanda
      if (newMsgs.length === 1) {
        const title = content.substring(0, 45) + (content.length > 45 ? '…' : '')
        const updated = loadSessions().map(s => s.id === currentId ? { ...s, title } : s)
        if (montatoRef.current) saveSessions(updated)
        else localStorage.setItem('crm_chat_sessions', JSON.stringify(updated))
      }
    } catch (err) {
      if (err?.name === 'AbortError') return
      if (montatoRef.current) {
        const e = erroreAI(err.status ?? 0, err.payload ?? err.message)
        setError({ testo: e.testo, dettaglio: e.dettaglio, admin: e.admin })
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      if (montatoRef.current) {
        setStreaming(false)
        setStreamText('')
        setLoadingCtx(false)
      }
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
    'Ricorda che il target costo personale è il 28% del fatturato',
  ]

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-4">
      {showMemory && (
        <MemoryPanel
          onClose={() => { setShowMemory(false); aggiornaMemCount() }}
          onCambiata={aggiornaMemCount}
        />
      )}

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

        {memErr && (
          <p className="text-[10px] text-red-600 flex items-start gap-1 px-0.5">
            <AlertCircle size={11} className="mt-0.5 shrink-0"/> {memErr}
          </p>
        )}

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
              {SUGGESTIONS.map(s => (
                <button key={s}
                  /* Niente setTimeout: React raggruppa i due setState nello
                     stesso render e il timer poteva scattare dopo l'unmount. */
                  onClick={() => { newSession(); setInput(s) }}
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
              {messages.map(m => <MsgBubble key={m.id} msg={m}/>)}
              {streaming && <MsgBubble msg={{ role: 'assistant', content: streamText }} isStreaming/>}
              {error && (
                <div className={`p-3 rounded-xl text-sm flex items-start gap-2 border ${error.admin ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-red-50 border-red-200 text-red-600'}`}>
                  <span>⚠️</span>
                  <div>
                    <p className="font-medium">{error.testo}</p>
                    {error.dettaglio && <p className="text-xs mt-1 text-slate-600">{error.dettaglio}</p>}
                    {error.admin && (
                      <p className="text-xs mt-1 text-slate-500">La chiave di questa chat sta in Supabase → Edge Functions → claude-proxy → Secrets → ANTHROPIC_API_KEY. Il resto del CRM continua a funzionare.</p>
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
