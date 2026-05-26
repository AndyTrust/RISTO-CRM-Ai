/**
 * useClaudeAI.js
 * Hook condiviso per chiamare Claude AI via Supabase Edge Function (claude-proxy).
 * Usato da ChatClaude, TurniPage, PerformancePage, ecc.
 *
 * La chiave API Anthropic è gestita SOLO sul server (Supabase Secret).
 * Il frontend non vede mai la chiave.
 */
import { useCallback } from 'react'
import supabase from '../supabase'

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/claude-proxy`

/**
 * Costruisce il system prompt con contesto dati CRM.
 * Passa una snapshot dei dati chiave delle tabelle Supabase.
 */
export async function buildCrmContext(options = {}) {
  const {
    includeSedi = true,
    includeChiusure = true,
    includeVenduto = true,
    includeFatture = true,
    includeTurni = true,
    includeBuste = true,
    includeMemory = true,
    sede = null,
  } = options

  const parts = []
  parts.push(`Oggi: ${new Date().toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`)
  parts.push(`Risto CRM`)

  try {
    // Chiusure ultimi 30 gg
    if (includeChiusure) {
      const from30 = new Date(); from30.setDate(from30.getDate() - 30)
      const { data: ch } = await supabase
        .from('chiusure_giornaliere')
        .select('sede,data_competenza,dgfe,n_doc,coperti')
        .gte('data_competenza', from30.toISOString().substring(0, 10))
        .order('data_competenza', { ascending: false })
        .limit(60)
      if (ch?.length) {
        const bySede = {}
        for (const r of ch) {
          if (!bySede[r.sede]) bySede[r.sede] = { dgfe: 0, coperti: 0, n: 0 }
          bySede[r.sede].dgfe    += parseFloat(r.dgfe) || 0
          bySede[r.sede].coperti += parseInt(r.coperti) || 0
          bySede[r.sede].n++
        }
        parts.push(`\n## Chiusure ultimi 30 giorni`)
        for (const [s, v] of Object.entries(bySede)) {
          parts.push(`${s}: €${v.dgfe.toFixed(0)} fatturato, ${v.coperti} coperti, ${v.n} giorni`)
        }
      }
    }

    // Venduto top prodotti ultimo mese
    if (includeVenduto) {
      const { data: vd } = await supabase
        .from('venduto_camerieri')
        .select('prodotto, categoria, quantita, sede')
        .order('quantita', { ascending: false })
        .limit(200)
      if (vd?.length) {
        const byP = {}
        for (const r of vd) {
          if (!r.prodotto || r.prodotto === 'nan') continue
          if (!byP[r.prodotto]) byP[r.prodotto] = { q: 0, cat: r.categoria }
          byP[r.prodotto].q += parseFloat(r.quantita) || 0
        }
        const top10 = Object.entries(byP).sort((a, b) => b[1].q - a[1].q).slice(0, 10)
        parts.push(`\n## Top 10 prodotti venduti`)
        top10.forEach(([p, v], i) => parts.push(`${i+1}. ${p} (${v.cat || '—'}): ${Math.round(v.q)} pz`))
      }
    }

    // Fatture — top fornitori
    if (includeFatture) {
      const { data: ft } = await supabase
        .from('fornitori_fatture')
        .select('nome, tot_spesa, n_fatture')
        .order('tot_spesa', { ascending: false })
        .limit(10)
      if (ft?.length) {
        parts.push(`\n## Top fornitori per spesa`)
        ft.forEach((f, i) => parts.push(`${i+1}. ${f.nome}: €${parseFloat(f.tot_spesa || 0).toFixed(0)} (${f.n_fatture || 0} fatture)`))
      }
    }

    // Dipendenti attivi
    if (includeSedi) {
      const { data: emp } = await supabase
        .from('employees')
        .select('name, role, sede')
        .eq('active', true)
        .order('sede')
        .limit(40)
      if (emp?.length) {
        const bySede = {}
        for (const e of emp) {
          if (!bySede[e.sede]) bySede[e.sede] = []
          bySede[e.sede].push(`${e.name} (${e.role || 'n/a'})`)
        }
        parts.push(`\n## Dipendenti attivi`)
        for (const [s, list] of Object.entries(bySede)) {
          parts.push(`${s}: ${list.join(', ')}`)
        }
      }
    }

    // Buste paga — costo personale ultimi 3 mesi
    if (includeBuste) {
      const { data: bp } = await supabase
        .from('buste_paga')
        .select('sede, mese, costo_azienda')
        .order('mese', { ascending: false })
        .limit(40)
      if (bp?.length) {
        const byMese = {}
        for (const b of bp) {
          const k = `${b.sede}|${b.mese}`
          if (!byMese[k]) byMese[k] = { sede: b.sede, mese: b.mese, tot: 0 }
          byMese[k].tot += parseFloat(b.costo_azienda) || 0
        }
        parts.push(`\n## Costo personale per mese`)
        Object.values(byMese).sort((a, b) => b.mese.localeCompare(a.mese)).slice(0, 6).forEach(v => {
          parts.push(`${v.sede} ${v.mese}: €${v.tot.toFixed(0)}`)
        })
      }
    }

    // Memoria CRM
    if (includeMemory) {
      const { data: mem } = await supabase
        .from('crm_memory')
        .select('sezione, chiave, valore, valore_json, updated_at')
        .order('updated_at', { ascending: false })
        .limit(30)
      if (mem?.length) {
        parts.push(`\n## Memoria CRM salvata`)
        for (const m of mem) {
          const val = m.valore_json ? JSON.stringify(m.valore_json) : m.valore
          parts.push(`[${m.sezione}/${m.chiave}]: ${val}`)
        }
      }
    }

  } catch (e) {
    parts.push(`\n⚠️ Errore caricamento contesto: ${e.message}`)
  }

  return parts.join('\n')
}

/**
 * Salva o aggiorna un record in crm_memory.
 * @param {string} sezione - es. 'turni', 'kpi', 'ricette', 'generale'
 * @param {string} chiave  - es. 'obiettivo_costo_personale'
 * @param {string|null} valore - valore testo
 * @param {object|null} valoreJson - valore JSON
 */
export async function saveMemory(sezione, chiave, valore = null, valoreJson = null) {
  const { error } = await supabase.from('crm_memory').upsert({
    sezione,
    chiave,
    valore,
    valore_json: valoreJson,
    fonte: 'chat',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'sezione,chiave' })
  if (error) throw error
}

/**
 * Carica tutta la memoria CRM (opzionalmente filtrata per sezione).
 */
export async function loadMemory(sezione = null) {
  let q = supabase.from('crm_memory').select('*').order('sezione').order('chiave')
  if (sezione) q = q.eq('sezione', sezione)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

/**
 * Hook principale — chiama Claude via Edge Function.
 * Gestisce automaticamente il parsing delle risposte di memoria (/salva memoria ...).
 */
export default function useClaudeAI() {
  /**
   * Chiama Claude e restituisce il testo della risposta.
   * @param {Array} messages - array {role, content}
   * @param {string} systemPrompt - system prompt
   * @param {object} options - { model, max_tokens, stream, onChunk }
   * @returns {Promise<string>}
   */
  const callClaude = useCallback(async (messages, systemPrompt, options = {}) => {
    const {
      model = 'claude-sonnet-4-6',
      max_tokens = 2048,
      stream = false,
      onChunk = null,
    } = options

    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens,
        stream,
        system: systemPrompt,
        messages,
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(err.error || `Errore ${response.status}`)
    }

    if (stream && onChunk) {
      // Streaming SSE
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let full = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '))
        for (const line of lines) {
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              full += event.delta.text
              onChunk(full)
            }
          } catch { }
        }
      }
      return full
    }

    const result = await response.json()
    return result.content?.[0]?.text ?? ''
  }, [])

  /**
   * Analizza la risposta di Claude e salva in crm_memory se contiene
   * comandi del tipo: SALVA_MEMORIA[sezione/chiave]=valore
   */
  const parseAndSaveMemoryCommands = useCallback(async (text) => {
    const regex = /SALVA_MEMORIA\[([^/\]]+)\/([^\]]+)\]=(.+?)(?=SALVA_MEMORIA\[|$)/gs
    const matches = [...text.matchAll(regex)]
    const saved = []
    for (const m of matches) {
      try {
        const sezione = m[1].trim().toLowerCase()
        const chiave  = m[2].trim().toLowerCase().replace(/\s+/g, '_')
        const valore  = m[3].trim()
        await saveMemory(sezione, chiave, valore)
        saved.push(`${sezione}/${chiave}`)
      } catch (e) {
        console.error('saveMemory error:', e)
      }
    }
    return saved
  }, [])

  return { callClaude, parseAndSaveMemoryCommands, buildCrmContext, saveMemory, loadMemory }
}
