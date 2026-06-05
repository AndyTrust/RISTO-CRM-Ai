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
import supabase from '../supabase'

const API_ENDPOINT = '/api/assistant'

// ─── Sicurezza query_crm: whitelist tabelle e colonne consentite ──────────────
// Solo tabelle operative — escluse: crm_config, buste_paga (dati sensibili paga),
// employees (dati personali), auth/storage Supabase interni.
const QUERY_CRM_ALLOWED_TABLES = [
  'venduto_camerieri',
  'chiusure_giornaliere',
  'varianti_camerieri',
  'statistiche_tavoli',
  'kpi_targets_individuale',
  'kpi_targets_team',
  'target_venduto_operatori',
  'fatture_importate',
  // Nuove tabelle BI connettori Pienissimo
  'prenotazioni_summary',
  'venduto_categorie',
  'revenue_forecast',
  'clienti_stats',
  'chiusure_turni',
]

// Colonne consentite per tabella (esclude dati sensibili come importi paga)
const QUERY_CRM_ALLOWED_COLUMNS = {
  venduto_camerieri:         ['sede', 'operatore', 'data_inizio', 'data_fine', 'categoria', 'prodotto', 'quantita', 'totale'],
  chiusure_giornaliere:      ['sede', 'data', 'totale_venduto_dgfe', 'totale_venduto_ipratico', 'totale_fiscalizzato_fatture', 'n_doc_fiscali_emessi', 'coperti', 'coperto_medio', 'scontrino_medio'],
  varianti_camerieri:        ['sede', 'operatore', 'data_inizio', 'data_fine', 'variante', 'aggiunta_qty', 'aggiunta_importo', 'rimozione_qty', 'rimozione_importo'],
  statistiche_tavoli:        ['sede', 'data_inizio', 'data_fine', 'tavolo', 'coperti', 'incasso'],
  kpi_targets_individuale:   ['operatore', 'sede', 'anno', 'mese', 'target'],
  kpi_targets_team:          ['sede', 'anno', 'mese', 'target'],
  target_venduto_operatori:  ['sede', 'operatore', 'anno', 'mese', 'target_pezzi', 'target_pezzi_valorizzati'],
  fatture_importate:         ['id', 'denominazione', 'piva', 'numero_fattura', 'data_fattura', 'imponibile', 'iva', 'totale', 'sede', 'totale_pagato'],
  prenotazioni_summary:      ['sede', 'data_inizio', 'data_fine', 'periodo', 'turno', 'stato', 'canale', 'n_prenotazioni', 'n_persone'],
  venduto_categorie:         ['sede', 'data_inizio', 'data_fine', 'categoria', 'tipologia', 'quantita', 'prezzo_medio', 'totale', 'food_cost_pct', 'n_documenti'],
  revenue_forecast:          ['sede', 'data_competenza', 'previsione_coperti', 'previsione_incasso', 'valutazione', 'note_meteo', 'aggiornato_il'],
  clienti_stats:             ['sede', 'periodo', 'grouping_tipo', 'valore', 'n_clienti'],
  chiusure_turni:            ['sede', 'data', 'turno', 'incasso', 'quantita'],
  prodotti_venduti_live:     ['sede', 'data_inizio', 'data_fine', 'prodotto', 'categoria', 'tipologia', 'quantita', 'prezzo_medio', 'importo_venduto', 'food_cost_medio', 'food_cost_pct', 'n_documenti'],
  revenue_shift:             ['sede', 'data_inizio', 'data_fine', 'periodo', 'turno', 'incassato', 'coperti', 'coperto_medio', 'food_cost', 'food_cost_pct', 'break_even', 'margine', 'n_documenti'],
  sondaggi_strutturati:      ['sede', 'id_sondaggio', 'data_prenotazione', 'nps', 'sala', 'pulizia', 'qualita_piatti', 'qualita_prezzo', 'atmosfera', 'tornera', 'canale_conoscenza', 'feedback_negativo'],
  bookings_filling:          ['sede', 'periodo', 'giorno_settimana', 'turno', 'n_prenotazioni', 'n_persone'],
}

// Operatori consentiti (no ilike su tabelle sensibili; esclude operatori non standard)
const QUERY_CRM_ALLOWED_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike', 'in']

/**
 * Valida l'input di query_crm contro le whitelist.
 * Ritorna una stringa di errore se non valido, altrimenti null.
 */
function validateQueryCRMInput(input) {
  const { table, select = '*', filters = [], not_ilike, order_by } = input

  if (!QUERY_CRM_ALLOWED_TABLES.includes(table)) {
    return `Tabella non consentita: "${table}". Tabelle disponibili: ${QUERY_CRM_ALLOWED_TABLES.join(', ')}`
  }

  const allowed = QUERY_CRM_ALLOWED_COLUMNS[table] || []

  // Valida colonne in select (se non è '*')
  if (select && select !== '*') {
    const selectedCols = select.split(',').map(c => c.trim())
    for (const col of selectedCols) {
      if (!allowed.includes(col)) {
        return `Colonna non consentita in select: "${col}" su tabella "${table}"`
      }
    }
  }

  // Valida filtri
  for (const f of filters) {
    if (!QUERY_CRM_ALLOWED_OPS.includes(f.op)) {
      return `Operatore non consentito: "${f.op}"`
    }
    if (!allowed.includes(f.column)) {
      return `Colonna filtro non consentita: "${f.column}" su tabella "${table}"`
    }
  }

  // Valida not_ilike
  if (not_ilike && !allowed.includes(not_ilike.column)) {
    return `Colonna not_ilike non consentita: "${not_ilike.column}" su tabella "${table}"`
  }

  // Valida order_by
  if (order_by && !allowed.includes(order_by)) {
    return `Colonna order_by non consentita: "${order_by}" su tabella "${table}"`
  }

  return null // OK
}

// ─── Tool built-in: query CRM Supabase ───────────────────────────────────────
const QUERY_CRM_TOOL = {
  name: 'query_crm',
  description: `Esegui una query SQL sul database CRM (Supabase PostgreSQL) per rispondere a domande sui dati del ristorante.
Tabelle disponibili:
- venduto_camerieri: sede, operatore, data_inizio, data_fine, categoria, prodotto, quantita, totale — venduto per operatore
- chiusure_giornaliere: sede, data, totale_venduto_dgfe, totale_venduto_ipratico, totale_fiscalizzato_fatture, n_doc_fiscali_emessi, coperti, coperto_medio, scontrino_medio — chiusure cassa giornaliere
- varianti_camerieri: sede, operatore, data_inizio, data_fine, variante, aggiunta_qty, aggiunta_importo, rimozione_qty, rimozione_importo — varianti per operatore
- statistiche_tavoli: sede, data_inizio, data_fine, tavolo, coperti, incasso — statistiche tavoli
- kpi_targets_individuale: operatore, sede, anno, mese, target — target KPI individuali
- kpi_targets_team: sede, anno, mese, target — target KPI team
- target_venduto_operatori: sede, operatore, anno, mese, target_pezzi, target_pezzi_valorizzati — target venduto
- fatture_importate: denominazione, piva, numero_fattura, data_fattura, imponibile, iva, totale, sede — fatture fornitori
- prenotazioni_summary: sede, periodo, turno, stato, n_prenotazioni, n_persone — prenotazioni aggregate da Pienissimo
- venduto_categorie: sede, data_inizio, data_fine, categoria, tipologia, quantita, totale, food_cost_pct — venduto per categoria (menu engineering)
- revenue_forecast: sede, data_competenza, previsione_incasso, valutazione, note_meteo — previsioni revenue prossimi giorni
- clienti_stats: sede, periodo, grouping_tipo, valore, n_clienti — statistiche clienti per canale/provenienza
- chiusure_turni: sede, data, turno, incasso, quantita — chiusure per turno pranzo/cena
Le sedi disponibili: MA (Mameli - Cagliari), PN (Predda Niedda - Sassari).
Usa questo tool per rispondere a qualsiasi domanda sui dati reali del CRM.`,
  input_schema: {
    type: 'object',
    properties: {
      table: { type: 'string', enum: QUERY_CRM_ALLOWED_TABLES, description: 'Nome tabella Supabase' },
      select: { type: 'string', description: 'Colonne da selezionare (default: *)', default: '*' },
      filters: {
        type: 'array',
        description: 'Filtri WHERE da applicare',
        items: {
          type: 'object',
          properties: {
            column: { type: 'string' },
            op: { type: 'string', enum: QUERY_CRM_ALLOWED_OPS },
            value: {}
          },
          required: ['column', 'op', 'value']
        }
      },
      not_ilike: {
        type: 'object',
        description: 'Filtro NOT ILIKE (es. escludere totali/medie)',
        properties: { column: { type: 'string' }, value: { type: 'string' } }
      },
      order_by: { type: 'string', description: 'Colonna per ORDER BY' },
      order_asc: { type: 'boolean', description: 'true = ASC, false = DESC', default: false },
      limit: { type: 'integer', description: 'Numero massimo di righe (max 500)', default: 100 }
    },
    required: ['table']
  }
}

async function executeQueryCRM(input) {
  // Valida contro whitelist prima di qualsiasi operazione
  const validationError = validateQueryCRMInput(input)
  if (validationError) return `Accesso negato: ${validationError}`

  const { table, select = '*', filters = [], not_ilike, order_by, order_asc = false, limit = 100 } = input
  try {
    let q = supabase.from(table).select(select)
    for (const f of filters) {
      if (f.op === 'eq') q = q.eq(f.column, f.value)
      else if (f.op === 'neq') q = q.neq(f.column, f.value)
      else if (f.op === 'gt') q = q.gt(f.column, f.value)
      else if (f.op === 'gte') q = q.gte(f.column, f.value)
      else if (f.op === 'lt') q = q.lt(f.column, f.value)
      else if (f.op === 'lte') q = q.lte(f.column, f.value)
      else if (f.op === 'ilike') q = q.ilike(f.column, `%${f.value}%`)
      else if (f.op === 'in') q = q.in(f.column, Array.isArray(f.value) ? f.value : [f.value])
    }
    if (not_ilike) q = q.not(not_ilike.column, 'ilike', `%${not_ilike.value}%`)
    if (order_by) q = q.order(order_by, { ascending: order_asc })
    q = q.limit(Math.min(Math.max(limit, 1), 500))
    const { data, error } = await q
    if (error) return `Errore query: ${error.message}`
    if (!data || data.length === 0) return 'Nessun risultato trovato.'
    // Formatta come tabella testuale
    const cols = Object.keys(data[0])
    const header = cols.join(' | ')
    const sep = cols.map(c => '-'.repeat(Math.max(c.length, 8))).join('-|-')
    const rows = data.map(r => cols.map(c => {
      const v = r[c]
      if (v === null || v === undefined) return '—'
      if (typeof v === 'number') return v.toLocaleString('it-IT')
      return String(v)
    }).join(' | '))
    return `${header}\n${sep}\n${rows.join('\n')}\n\n(${data.length} righe)`
  } catch (e) {
    return `Errore: ${e.message}`
  }
}

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
    let sys = `Sei l'assistente AI del CRM gestionale. Puoi accedere ai dati del ristorante (chiusure, venduto, dipendenti, fatture, KPI). Parla in italiano.
Pagina corrente: **${pagina}**.
Rispondi sempre in italiano, in modo conciso e diretto.
Quando esegui azioni (registrare pagamenti, modificare dati), conferma brevemente quello che hai fatto.
Hai accesso diretto al database CRM tramite lo strumento **query_crm**: usalo SEMPRE per rispondere a domande sui dati reali (venduto, coperti, camerieri, fatture, KPI, buste paga, ecc.) invece di rispondere con dati generici o inventati.
Quando cerchi errori o incongruenze nei dati, esegui query per confrontare i valori e segnala anomalie specifiche con i dati reali.`
    if (systemContext) sys += `\n\n${systemContext}`
    const allTools = [...tools, QUERY_CRM_TOOL]
    if (allTools.length > 0) {
      sys += `\n\nHai a disposizione i seguenti strumenti:
${allTools.map(t => `- **${t.name}**: ${t.description.split('\n')[0]}`).join('\n')}
Usa questi strumenti per eseguire azioni concrete e rispondere con dati reali.`
    }
    return sys
  }, [pagina, systemContext, tools])

  const callAssistant = useCallback(async (apiMessages) => {
    // Sempre includi QUERY_CRM_TOOL + eventuali tool di pagina
    const allToolDefs = [QUERY_CRM_TOOL, ...tools].map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }))
    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: apiMessages,
        system: buildSystemPrompt(),
        tools: allToolDefs,
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
          if (block.name === 'query_crm') {
            // Gestito internamente — query diretta Supabase
            result = await executeQueryCRM(block.input)
          } else if (onToolCall) {
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
