/**
 * RicettePage.jsx
 * Gestione ricette con food cost automatico e assistente Claude AI.
 * Legge i piatti venduti da venduto_camerieri, i costi ingredienti da fatture_righe.
 */
import React, { useEffect, useState, useRef } from 'react'
import supabase from '../supabase'
import { Plus, ChefHat, Pencil, Trash2, Bot, X, Check, Loader2, BookOpen, TrendingUp } from 'lucide-react'
import useClaudeAI, { buildCrmContext } from '../hooks/useClaudeAI'
import PageAssistant from '../components/PageAssistant'

function eur(n) { return n != null ? `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—' }
function pct(n) { return n != null ? `${Number(n).toFixed(1)}%` : '—' }

async function sbq(q) {
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

// ─── Carica piatti dal venduto ───────────────────────────────────────────────
async function loadPiattiVenduto() {
  const rows = await sbq(
    supabase.from('venduto_camerieri')
      .select('prodotto, categoria, quantita')
      .order('prodotto')
  )
  // Aggrega per prodotto
  const byP = {}
  for (const r of rows) {
    if (!r.prodotto || r.prodotto === 'nan') continue
    if (!byP[r.prodotto]) byP[r.prodotto] = { prodotto: r.prodotto, categoria: r.categoria, tot_qta: 0 }
    byP[r.prodotto].tot_qta += parseFloat(r.quantita) || 0
  }
  return Object.values(byP).sort((a, b) => b.tot_qta - a.tot_qta)
}

// ─── Carica ricette ──────────────────────────────────────────────────────────
async function loadRicette() {
  return sbq(
    supabase.from('ricette').select('*').order('nome_piatto')
  )
}

// ─── Carica ingredienti disponibili da fatture_righe ────────────────────────
async function searchIngrediente(q) {
  if (!q || q.length < 2) return []
  const rows = await sbq(
    supabase.from('fatture_righe')
      .select('descrizione, prezzo_unitario, unita_misura')
      .ilike('descrizione', `%${q}%`)
      .limit(20)
  )
  const byDesc = {}
  for (const r of rows) {
    if (!r.descrizione) continue
    if (!byDesc[r.descrizione] || r.prezzo_unitario > 0)
      byDesc[r.descrizione] = r
  }
  return Object.values(byDesc)
}

// ─── Componente chat Claude AI ───────────────────────────────────────────────
function AIChatPanel({ nomePiatto, categoria, ingredientiEsistenti, onAppliRicetta, onClose }) {
  const { callClaude } = useClaudeAI()
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Ciao! Sono qui per aiutarti a creare la ricetta per **${nomePiatto}**${categoria ? ` (${categoria})` : ''}.\n\nPosso suggerirti ingredienti tipici, quantità standard per porzione, e calcolare il food cost stimato. Come vuoi procedere?`
    }
  ])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || thinking) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setThinking(true)

    try {
      // Contesto per Claude
      const systemPrompt = `Sei un consulente esperto di ristorazione per Risto CRM, ristorante italiano con due sedi (Sede MA a Cagliari e Sede PN a Sassari).
Stai aiutando a creare/ottimizzare la ricetta per il piatto: "${nomePiatto}"${categoria ? `, categoria: ${categoria}` : ''}.
${ingredientiEsistenti?.length > 0 ? `Ingredienti già inseriti: ${ingredientiEsistenti.map(i => `${i.nome} ${i.quantita_per_porzione}${i.unita || 'g'} a €${i.prezzo_unitario}/unità`).join(', ')}.` : ''}

Quando suggerisci ingredienti, fornisci sempre:
- Nome ingrediente
- Quantità consigliata per porzione (in g/ml/pz)
- Prezzo unitario stimato (€ al kg/litro/pz)
- Food cost risultante per porzione

Se l'utente chiede di "applicare" o "usare" la ricetta, rispondi con un JSON strutturato così:
{
  "applicaRicetta": true,
  "ingredienti": [
    {"nome": "...", "quantita_per_porzione": X, "unita": "g", "prezzo_unitario": Y, "note": "..."}
  ],
  "note_ricetta": "...",
  "porzioni_standard": N
}

Altrimenti rispondi in modo conversazionale in italiano.`

      // Chiama Claude via Supabase Edge Function (claude-proxy) — chiave sicura lato server
      const text = await callClaude(
        [
          ...messages.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: userMsg },
        ],
        systemPrompt,
        { model: 'claude-sonnet-4-6', max_tokens: 1024 }
      )

      // Tenta parsing JSON se Claude ha restituito una ricetta strutturata
      try {
        const jsonMatch = text.match(/\{[\s\S]*"applicaRicetta"[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          if (parsed.applicaRicetta && onAppliRicetta) {
            onAppliRicetta(parsed)
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `✅ Ricetta applicata! Ho inserito ${parsed.ingredienti?.length} ingredienti nel form. Puoi modificarli prima di salvare.`
            }])
            setThinking(false)
            return
          }
        }
      } catch (e) { /* not JSON — ok */ }

      setMessages(prev => [...prev, { role: 'assistant', content: text }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Errore di connessione: ${err.message}`
      }])
    } finally {
      setThinking(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col" style={{ height: '80vh', maxHeight: 600 }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center">
              <Bot size={16} className="text-violet-600" />
            </div>
            <div>
              <p className="font-semibold text-sm">Claude AI — Ricetta</p>
              <p className="text-xs text-gray-400">{nomePiatto}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
                m.role === 'user'
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}>
                <pre className="whitespace-pre-wrap font-sans">{m.content}</pre>
              </div>
            </div>
          ))}
          {thinking && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-gray-500">
                <Loader2 size={14} className="animate-spin" /> Claude sta elaborando...
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-gray-100">
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="Chiedi ingredienti, quantità, food cost..."
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || thinking}
              className="btn-primary px-4 disabled:opacity-40"
            >
              Invia
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Scrivi "applica ricetta con X g di pasta, Y g di..." per inserire gli ingredienti automaticamente
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Form ricetta ─────────────────────────────────────────────────────────────
function RicettaForm({ piatti, initial, onSave, onClose }) {
  const [form, setForm] = useState({
    nome_piatto: '',
    categoria: '',
    porzioni_standard: 1,
    prezzo_vendita: '',
    note: '',
    ingredienti: [],
    ...initial,
  })
  const [aiOpen, setAiOpen] = useState(false)
  const [ingSearch, setIngSearch] = useState('')
  const [ingResults, setIngResults] = useState([])
  const [saving, setSaving] = useState(false)

  // Calcoli food cost
  const foodCostEur = form.ingredienti.reduce((s, i) => {
    const costo = (parseFloat(i.quantita_per_porzione) || 0) * (parseFloat(i.prezzo_unitario) || 0)
    return s + costo
  }, 0)
  const foodCostPct = form.prezzo_vendita > 0
    ? (foodCostEur / parseFloat(form.prezzo_vendita)) * 100
    : null

  // Ricerca ingredienti
  useEffect(() => {
    if (ingSearch.length < 2) { setIngResults([]); return }
    const t = setTimeout(() => {
      searchIngrediente(ingSearch).then(setIngResults).catch(() => setIngResults([]))
    }, 300)
    return () => clearTimeout(t)
  }, [ingSearch])

  const addIngrediente = (item) => {
    setForm(f => ({
      ...f,
      ingredienti: [...f.ingredienti, {
        nome: item.descrizione || item,
        quantita_per_porzione: '',
        unita: item.unita_misura || 'g',
        prezzo_unitario: item.prezzo_unitario || '',
        note: '',
      }]
    }))
    setIngSearch('')
    setIngResults([])
  }

  const updateIng = (i, field, val) => {
    setForm(f => {
      const ings = [...f.ingredienti]
      ings[i] = { ...ings[i], [field]: val }
      return { ...f, ingredienti: ings }
    })
  }

  const removeIng = (i) => {
    setForm(f => ({ ...f, ingredienti: f.ingredienti.filter((_, idx) => idx !== i) }))
  }

  const applyAiRicetta = (parsed) => {
    if (parsed.ingredienti) {
      setForm(f => ({
        ...f,
        ingredienti: parsed.ingredienti.map(i => ({
          nome: i.nome || '',
          quantita_per_porzione: i.quantita_per_porzione || '',
          unita: i.unita || 'g',
          prezzo_unitario: i.prezzo_unitario || '',
          note: i.note || '',
        })),
        porzioni_standard: parsed.porzioni_standard || f.porzioni_standard,
        note: parsed.note_ricetta || f.note,
      }))
    }
    setAiOpen(false)
  }

  const handleSave = async () => {
    if (!form.nome_piatto.trim()) return
    setSaving(true)
    try {
      await onSave({
        ...form,
        food_cost_eur: Math.round(foodCostEur * 100) / 100,
        food_cost_pct: foodCostPct ? Math.round(foodCostPct * 10) / 10 : null,
        ingredienti: form.ingredienti, // JSONB
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {aiOpen && (
        <AIChatPanel
          nomePiatto={form.nome_piatto || 'Nuovo piatto'}
          categoria={form.categoria}
          ingredientiEsistenti={form.ingredienti}
          onAppliRicetta={applyAiRicetta}
          onClose={() => setAiOpen(false)}
        />
      )}

      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="sticky top-0 bg-white px-6 pt-5 pb-3 border-b border-gray-100 z-10">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">{initial?.id ? 'Modifica ricetta' : 'Nuova ricetta'}</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAiOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200 transition"
                >
                  <Bot size={13}/> Aiuto Claude AI
                </button>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* Nome piatto */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Nome piatto *</label>
              <input list="piatti-list" className="input"
                value={form.nome_piatto}
                onChange={e => setForm(f => ({ ...f, nome_piatto: e.target.value }))}
                placeholder="Es. Spaghetti alle vongole" />
              <datalist id="piatti-list">
                {piatti.slice(0, 50).map(p => <option key={p.prodotto} value={p.prodotto} />)}
              </datalist>
            </div>

            {/* Categoria + prezzo + porzioni */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Categoria</label>
                <input className="input" value={form.categoria || ''}
                  onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                  placeholder="Es. Primi" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Prezzo vendita (€)</label>
                <input type="number" step="0.01" className="input"
                  value={form.prezzo_vendita || ''}
                  onChange={e => setForm(f => ({ ...f, prezzo_vendita: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Porzioni std</label>
                <input type="number" min="1" className="input"
                  value={form.porzioni_standard || 1}
                  onChange={e => setForm(f => ({ ...f, porzioni_standard: parseInt(e.target.value) || 1 }))} />
              </div>
            </div>

            {/* Food cost live */}
            {foodCostEur > 0 && (
              <div className={`rounded-xl p-3 flex gap-6 text-sm ${
                foodCostPct > 40 ? 'bg-red-50 border border-red-200' :
                foodCostPct > 30 ? 'bg-amber-50 border border-amber-200' :
                'bg-emerald-50 border border-emerald-200'
              }`}>
                <div>
                  <p className="text-xs text-gray-400">Food cost per porzione</p>
                  <p className="font-bold text-lg">{eur(foodCostEur)}</p>
                </div>
                {foodCostPct && (
                  <div>
                    <p className="text-xs text-gray-400">% sul prezzo vendita</p>
                    <p className={`font-bold text-lg ${
                      foodCostPct > 40 ? 'text-red-600' :
                      foodCostPct > 30 ? 'text-amber-600' :
                      'text-emerald-600'
                    }`}>{pct(foodCostPct)}</p>
                  </div>
                )}
                {form.prezzo_vendita > 0 && (
                  <div>
                    <p className="text-xs text-gray-400">Margine lordo</p>
                    <p className="font-bold text-lg text-blue-600">
                      {eur(parseFloat(form.prezzo_vendita) - foodCostEur)}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Ingredienti */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-400 font-medium uppercase tracking-wide">Ingredienti</label>
                <span className="text-xs text-gray-300">(per porzione)</span>
              </div>

              {form.ingredienti.length > 0 && (
                <div className="space-y-2 mb-3">
                  <div className="grid grid-cols-12 gap-1 text-xs text-gray-400 px-1">
                    <div className="col-span-4">Ingrediente</div>
                    <div className="col-span-2">Quantità</div>
                    <div className="col-span-2">Unità</div>
                    <div className="col-span-2">€/unità</div>
                    <div className="col-span-1">Costo</div>
                    <div className="col-span-1"></div>
                  </div>
                  {form.ingredienti.map((ing, i) => {
                    const costoRiga = (parseFloat(ing.quantita_per_porzione) || 0) * (parseFloat(ing.prezzo_unitario) || 0)
                    return (
                      <div key={i} className="grid grid-cols-12 gap-1 items-center bg-gray-50 rounded-lg p-1.5">
                        <div className="col-span-4">
                          <input className="input text-xs py-1" value={ing.nome}
                            onChange={e => updateIng(i, 'nome', e.target.value)} placeholder="Nome" />
                        </div>
                        <div className="col-span-2">
                          <input type="number" className="input text-xs py-1" value={ing.quantita_per_porzione}
                            onChange={e => updateIng(i, 'quantita_per_porzione', e.target.value)} placeholder="100" />
                        </div>
                        <div className="col-span-2">
                          <select className="select text-xs py-1" value={ing.unita || 'g'}
                            onChange={e => updateIng(i, 'unita', e.target.value)}>
                            <option>g</option><option>kg</option><option>ml</option>
                            <option>cl</option><option>l</option><option>pz</option><option>fetta</option>
                          </select>
                        </div>
                        <div className="col-span-2">
                          <input type="number" step="0.001" className="input text-xs py-1" value={ing.prezzo_unitario}
                            onChange={e => updateIng(i, 'prezzo_unitario', e.target.value)} placeholder="0.00" />
                        </div>
                        <div className="col-span-1 text-xs text-right font-medium text-gray-600">
                          {costoRiga > 0 ? `€${costoRiga.toFixed(3)}` : '—'}
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <button onClick={() => removeIng(i)} className="text-gray-300 hover:text-red-500">
                            <X size={14}/>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Aggiungi ingrediente */}
              <div className="relative">
                <input className="input text-sm" value={ingSearch}
                  onChange={e => setIngSearch(e.target.value)}
                  placeholder="Cerca ingrediente da fatture o scrivi nome..." />
                {ingResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-100 z-20 overflow-hidden">
                    {ingResults.map((r, i) => (
                      <button key={i} onClick={() => addIngrediente(r)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-violet-50 flex items-center justify-between">
                        <span>{r.descrizione}</span>
                        <span className="text-xs text-gray-400">{r.prezzo_unitario ? eur(r.prezzo_unitario) : ''} / {r.unita_misura || 'u.'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {ingSearch.length >= 2 && ingResults.length === 0 && (
                <button
                  onClick={() => { addIngrediente({ descrizione: ingSearch }); setIngSearch('') }}
                  className="text-xs text-violet-600 mt-1 hover:underline">
                  + Aggiungi "{ingSearch}" manualmente
                </button>
              )}
            </div>

            {/* Note */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Note preparazione</label>
              <textarea className="input resize-none" rows={3}
                value={form.note || ''}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="Procedimento, varianti, allergeni..." />
            </div>
          </div>

          <div className="sticky bottom-0 bg-white px-6 pb-5 pt-3 border-t border-gray-100 flex gap-2">
            <button onClick={onClose} className="btn-secondary flex-1">Annulla</button>
            <button onClick={handleSave} disabled={!form.nome_piatto.trim() || saving}
              className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-40">
              {saving ? <Loader2 size={15} className="animate-spin"/> : <Check size={15}/>}
              Salva ricetta
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Pagina principale ────────────────────────────────────────────────────────
export default function RicettePage() {
  const [ricette, setRicette] = useState([])
  const [piatti, setPiatti] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [sortBy, setSortBy] = useState('az') // az | fc_asc | fc_desc | margine_desc | prezzo_desc
  const [tab, setTab] = useState('ricette')

  const load = async () => {
    setLoading(true)
    try {
      const [r, p] = await Promise.all([loadRicette(), loadPiattiVenduto()])
      setRicette(r)
      setPiatti(p)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const saveRicetta = async (form) => {
    if (form.id) {
      const { error } = await supabase.from('ricette').update({
        nome_piatto:   form.nome_piatto,
        categoria:     form.categoria || null,
        porzioni:      form.porzioni_standard || form.porzioni || 1,
        prezzo_vendita: form.prezzo_vendita ? parseFloat(form.prezzo_vendita) : null,
        ingredienti:   form.ingredienti,
        food_cost_eur: form.food_cost_eur,
        food_cost_pct: form.food_cost_pct,
        note_chef:     form.note || form.note_chef || null,
        updated_at:    new Date().toISOString(),
      }).eq('id', form.id)
      if (error) { console.error(error); return }
    } else {
      const { error } = await supabase.from('ricette').insert({
        nome_piatto:   form.nome_piatto,
        categoria:     form.categoria || null,
        porzioni:      form.porzioni_standard || 1,
        prezzo_vendita: form.prezzo_vendita ? parseFloat(form.prezzo_vendita) : null,
        ingredienti:   form.ingredienti,
        food_cost_eur: form.food_cost_eur,
        food_cost_pct: form.food_cost_pct,
        note_chef:     form.note || null,
      })
      if (error) { console.error(error); return }
    }
    setShowForm(false)
    setEditing(null)
    load()
  }

  const deleteRicetta = async (id) => {
    if (!confirm('Eliminare questa ricetta?')) return
    await supabase.from('ricette').delete().eq('id', id)
    load()
  }

  // Categorie uniche per dropdown
  const categorie = [...new Set(ricette.map(r => r.categoria).filter(Boolean))].sort()

  // Filtra e ordina
  const filtered = ricette
    .filter(r => {
      const matchSearch = !search || r.nome_piatto?.toLowerCase().includes(search.toLowerCase()) || r.categoria?.toLowerCase().includes(search.toLowerCase())
      const matchCat = !catFilter || r.categoria === catFilter
      return matchSearch && matchCat
    })
    .sort((a, b) => {
      if (sortBy === 'fc_asc')  return (a.food_cost_pct||0) - (b.food_cost_pct||0)
      if (sortBy === 'fc_desc') return (b.food_cost_pct||0) - (a.food_cost_pct||0)
      if (sortBy === 'margine_desc') return ((b.prezzo_vendita||0)-(b.food_cost_eur||0)) - ((a.prezzo_vendita||0)-(a.food_cost_eur||0))
      if (sortBy === 'prezzo_desc') return (b.prezzo_vendita||0) - (a.prezzo_vendita||0)
      return (a.nome_piatto||'').localeCompare(b.nome_piatto||'') // az
    })

  // Piatti venduti senza ricetta
  const piattiSenzaRicetta = piatti.filter(p =>
    !ricette.some(r => r.nome_piatto?.toLowerCase() === p.prodotto?.toLowerCase())
  ).slice(0, 20)

  const ricetteConFC = ricette.filter(r => r.food_cost_pct && r.prezzo_vendita > 0)
  const avgFoodCost = ricetteConFC.length > 0
    ? ricetteConFC.reduce((s, r) => s + r.food_cost_pct, 0) / ricetteConFC.length
    : null

  // Analisi per categoria
  const byCategoria = {}
  for (const r of ricette) {
    const cat = r.categoria || '(senza categoria)'
    if (!byCategoria[cat]) byCategoria[cat] = { cat, n: 0, fc_sum: 0, fc_n: 0, margine_sum: 0, margine_n: 0, prezzo_sum: 0, prezzo_n: 0 }
    byCategoria[cat].n++
    if (r.food_cost_pct) { byCategoria[cat].fc_sum += r.food_cost_pct; byCategoria[cat].fc_n++ }
    if (r.prezzo_vendita > 0 && r.food_cost_eur >= 0) {
      byCategoria[cat].margine_sum += r.prezzo_vendita - (r.food_cost_eur || 0)
      byCategoria[cat].margine_n++
      byCategoria[cat].prezzo_sum += r.prezzo_vendita
      byCategoria[cat].prezzo_n++
    }
  }
  const categorieAnalisi = Object.values(byCategoria)
    .map(c => ({
      ...c,
      avg_fc: c.fc_n > 0 ? Math.round(c.fc_sum / c.fc_n * 10) / 10 : null,
      avg_margine: c.margine_n > 0 ? Math.round(c.margine_sum / c.margine_n * 100) / 100 : null,
      avg_prezzo: c.prezzo_n > 0 ? Math.round(c.prezzo_sum / c.prezzo_n * 100) / 100 : null,
    }))
    .sort((a, b) => b.n - a.n)

  const tabs = [
    { id: 'ricette', label: `Ricette (${ricette.length})`, icon: <BookOpen size={14}/> },
    { id: 'analisi', label: 'Analisi FC', icon: <TrendingUp size={14}/> },
    { id: 'piatti',  label: `Senza ricetta (${piattiSenzaRicetta.length})`, icon: <TrendingUp size={14}/> },
  ]

  return (
    <>
    <div className="space-y-5">
      {(showForm || editing) && (
        <RicettaForm
          piatti={piatti}
          initial={editing}
          onSave={saveRicetta}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Ricette & Food Cost</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {ricette.length} ricette · food cost medio {avgFoodCost ? pct(avgFoodCost) : '—'}
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus size={16}/> Nuova ricetta
        </button>
      </div>

      {/* KPI */}
      {ricette.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="card p-4">
            <p className="text-xs text-gray-400">Prodotti totali</p>
            <p className="text-2xl font-bold text-violet-600 mt-1">{ricette.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">{categorie.length} categorie</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-400">FC medio (con prezzo)</p>
            <p className={`text-2xl font-bold mt-1 ${!avgFoodCost ? 'text-gray-400' : avgFoodCost > 35 ? 'text-red-600' : 'text-emerald-600'}`}>
              {avgFoodCost ? pct(avgFoodCost) : '—'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">su {ricetteConFC.length} prodotti</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-400">FC ottimale (&lt;30%)</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">
              {ricette.filter(r => r.food_cost_pct && r.food_cost_pct < 30).length}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">prodotti virtuosi</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-400">FC critico (&gt;40%)</p>
            <p className="text-2xl font-bold text-red-600 mt-1">
              {ricette.filter(r => r.food_cost_pct && r.food_cost_pct > 40).length}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">da revisionare</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-400">Margine medio</p>
            <p className="text-2xl font-bold text-indigo-600 mt-1">
              {ricetteConFC.length > 0
                ? eur(ricetteConFC.reduce((s,r)=>(s+(r.prezzo_vendita||0)-(r.food_cost_eur||0)),0)/ricetteConFC.length)
                : '—'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">per prodotto</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-violet-500 text-violet-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Filtri ricette */}
      {tab === 'ricette' && (
        <div className="flex flex-wrap gap-2 items-center">
          <input className="input" style={{ maxWidth: 220 }} value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cerca prodotto..." />
          <select className="input" style={{ maxWidth: 180 }} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option value="">Tutte le categorie</option>
            {categorie.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input" style={{ maxWidth: 180 }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="az">Ordine A→Z</option>
            <option value="fc_asc">FC crescente</option>
            <option value="fc_desc">FC decrescente</option>
            <option value="margine_desc">Margine maggiore</option>
            <option value="prezzo_desc">Prezzo maggiore</option>
          </select>
          {(search || catFilter) && (
            <button className="text-xs text-gray-400 hover:text-gray-600 underline"
              onClick={() => { setSearch(''); setCatFilter('') }}>Reset filtri</button>
          )}
          <span className="text-xs text-gray-400 ml-auto">{filtered.length} di {ricette.length}</span>
        </div>
      )}

      {/* TAB RICETTE */}
      {tab === 'ricette' && (
        <div className="space-y-3">
          {loading && <div className="text-center text-sm text-gray-400 py-8">Caricamento...</div>}
          {!loading && filtered.length === 0 && (
            <div className="card p-8 text-center">
              <ChefHat size={40} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 font-medium">Nessuna ricetta ancora</p>
              <p className="text-sm text-gray-400 mt-1 mb-4">Crea la prima ricetta con il pulsante in alto, o chiedi aiuto a Claude AI!</p>
              <button onClick={() => setShowForm(true)} className="btn-primary mx-auto">
                <Plus size={15}/> Crea prima ricetta
              </button>
            </div>
          )}

          {filtered.map(r => (
            <div key={r.id} className="card p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-800">{r.nome_piatto}</h3>
                    {r.categoria && (
                      <span className="badge badge-gray text-xs">{r.categoria}</span>
                    )}
                    {r.food_cost_pct && (
                      <span className={`badge text-xs font-semibold ${
                        r.food_cost_pct > 40 ? 'bg-red-100 text-red-700' :
                        r.food_cost_pct > 30 ? 'bg-amber-100 text-amber-700' :
                        'bg-emerald-100 text-emerald-700'
                      }`}>
                        FC {pct(r.food_cost_pct)}
                      </span>
                    )}
                  </div>

                  <div className="flex gap-4 mt-2 text-sm text-gray-500">
                    {r.food_cost_eur > 0 && <span>Costo: {eur(r.food_cost_eur)}</span>}
                    {r.prezzo_vendita > 0 && <span>Prezzo: {eur(r.prezzo_vendita)}</span>}
                    {r.prezzo_vendita > 0 && r.food_cost_eur > 0 && (
                      <span className="text-emerald-600 font-medium">
                        Margine: {eur(r.prezzo_vendita - r.food_cost_eur)}
                      </span>
                    )}
                    {r.ingredienti?.length > 0 && (
                      <span className="text-gray-400">{r.ingredienti.length} ingredienti</span>
                    )}
                  </div>

                  {r.ingredienti?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {r.ingredienti.slice(0, 5).map((ing, i) => (
                        <span key={i} className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                          {ing.nome}
                        </span>
                      ))}
                      {r.ingredienti.length > 5 && (
                        <span className="text-xs text-gray-400">+{r.ingredienti.length - 5} altri</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex gap-1 ml-3 flex-shrink-0">
                  <button onClick={() => setEditing(r)}
                    className="p-1.5 text-gray-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition">
                    <Pencil size={15}/>
                  </button>
                  <button onClick={() => deleteRicetta(r.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                    <Trash2 size={15}/>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB ANALISI FC */}
      {tab === 'analisi' && (
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <h3 className="font-semibold text-sm text-gray-700">Analisi Food Cost per Categoria</h3>
              <span className="text-xs text-gray-400">Soglia ideale FC: &lt;30% · Critico: &gt;40%</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2.5">Categoria</th>
                  <th className="text-right px-4 py-2.5">N. prodotti</th>
                  <th className="text-right px-4 py-2.5">FC medio</th>
                  <th className="text-right px-4 py-2.5">Prezzo medio</th>
                  <th className="text-right px-4 py-2.5">Margine medio</th>
                  <th className="px-4 py-2.5 text-left" style={{ minWidth: 100 }}>Performance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {categorieAnalisi.map(c => {
                  const fcColor = !c.avg_fc ? 'text-gray-400' : c.avg_fc > 40 ? 'text-red-600 font-bold' : c.avg_fc > 30 ? 'text-amber-600 font-semibold' : 'text-emerald-600 font-semibold'
                  const barWidth = c.avg_fc ? Math.min(100, c.avg_fc / 0.6) : 0
                  const barColor = !c.avg_fc ? '#e5e7eb' : c.avg_fc > 40 ? '#ef4444' : c.avg_fc > 30 ? '#f59e0b' : '#10b981'
                  return (
                    <tr key={c.cat} className="hover:bg-gray-50 cursor-pointer" onClick={() => { setTab('ricette'); setCatFilter(c.cat === '(senza categoria)' ? '' : c.cat) }}>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{c.cat}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{c.n}</td>
                      <td className={`px-4 py-2.5 text-right ${fcColor}`}>{c.avg_fc ? pct(c.avg_fc) : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{c.avg_prezzo ? eur(c.avg_prezzo) : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-indigo-600 font-medium">{c.avg_margine ? eur(c.avg_margine) : '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden w-full" style={{ minWidth: 80 }}>
                          <div className="h-full rounded-full" style={{ width: `${barWidth}%`, backgroundColor: barColor }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-gray-100 text-xs text-indigo-500 flex items-center gap-1">
              <span>👆 Clicca su una categoria per filtrare i prodotti</span>
            </div>
          </div>

          {/* Top/Bottom FC */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-4">
              <h3 className="font-semibold text-sm text-gray-700 mb-3">🏆 Migliori Margini</h3>
              <div className="space-y-2">
                {[...ricetteConFC].sort((a,b) => (b.prezzo_vendita-b.food_cost_eur)-(a.prezzo_vendita-a.food_cost_eur)).slice(0,8).map(r => (
                  <div key={r.id} className="flex items-center justify-between text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{r.nome_piatto}</p>
                      <p className="text-xs text-gray-400">{r.categoria} · FC {pct(r.food_cost_pct)}</p>
                    </div>
                    <span className="text-emerald-600 font-bold ml-3">{eur(r.prezzo_vendita - r.food_cost_eur)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card p-4">
              <h3 className="font-semibold text-sm text-gray-700 mb-3">⚠️ FC più Alto (da revisionare)</h3>
              <div className="space-y-2">
                {[...ricetteConFC].filter(r=>r.food_cost_pct<=150).sort((a,b)=>b.food_cost_pct-a.food_cost_pct).slice(0,8).map(r => (
                  <div key={r.id} className="flex items-center justify-between text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{r.nome_piatto}</p>
                      <p className="text-xs text-gray-400">{r.categoria} · Prezzo {eur(r.prezzo_vendita)}</p>
                    </div>
                    <span className="text-red-600 font-bold ml-3">{pct(r.food_cost_pct)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB PIATTI SENZA RICETTA */}
      {tab === 'piatti' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            Questi piatti sono presenti nel venduto ma non hanno ancora una ricetta con food cost.
          </p>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3">Piatto</th>
                  <th className="text-left px-4 py-3">Categoria</th>
                  <th className="text-right px-4 py-3">Pezzi venduti</th>
                  <th className="text-right px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {piattiSenzaRicetta.map((p, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium">{p.prodotto}</td>
                    <td className="px-4 py-2.5">
                      {p.categoria && p.categoria !== 'nan'
                        ? <span className="badge badge-gray">{p.categoria}</span>
                        : <span className="text-gray-300">—</span>
                      }
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-500">
                      {p.tot_qta?.toLocaleString('it-IT', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => { setEditing({ nome_piatto: p.prodotto, categoria: p.categoria !== 'nan' ? p.categoria : '', ingredienti: [] }); setShowForm(true) }}
                        className="text-xs text-violet-600 hover:underline"
                      >
                        + Crea ricetta
                      </button>
                    </td>
                  </tr>
                ))}
                {piattiSenzaRicetta.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                    Tutti i piatti hanno una ricetta!
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
      <PageAssistant
        pagina="Ricette & Food Cost"
        suggerimenti={[
          "Qual è il food cost medio delle ricette?",
          "Quali ricette hanno il margine più alto?",
          "Suggeriscimi ingredienti per un nuovo piatto",
        ]}
      />
    </>
  )
}