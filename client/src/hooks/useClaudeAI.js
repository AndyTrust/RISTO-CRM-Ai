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
        .select('sede,data,totale_venduto_dgfe,n_doc_fiscali_emessi,coperti')
        .gte('data', from30.toISOString().substring(0, 10))
        .order('data', { ascending: false })
        .limit(60)
      if (ch?.length) {
        const bySede = {}
        for (const r of ch) {
          if (!bySede[r.sede]) bySede[r.sede] = { dgfe: 0, coperti: 0, n: 0 }
          bySede[r.sede].dgfe    += parseFloat(r.totale_venduto_dgfe) || 0
          bySede[r.sede].coperti += parseInt(r.coperti) || 0
          bySede[r.sede].n++
        }
        parts.push(`\n## Chiusure ultimi 30 giorni`)
        for (const [s, v] of Object.entries(bySede)) {
          parts.push(`${s}: €${v.dgfe.toFixed(0)} fatturato, ${v.coperti} coperti, ${v.n} giorni`)
        }
      }
    }

    // Coperti per turno (pranzo/cena) — media per giorno settimana — ultimi 6 mesi
    if (includeTurni) {
      const from6m = new Date(); from6m.setMonth(from6m.getMonth() - 6)
      const { data: turniData } = await supabase
        .from('chiusure_turni')
        .select('sede, data, turno, quantita')
        .gte('data', from6m.toISOString().substring(0, 10))
        .in('turno', ['pranzo', 'cena'])
        .order('data', { ascending: false })
      if (turniData?.length) {
        const GIORNI = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab']
        // {sede: {dow: {pranzo: [sum,n], cena: [sum,n]}}}
        const agg = {}
        for (const r of turniData) {
          const dow = new Date(r.data + 'T12:00:00').getDay()
          if (!agg[r.sede]) agg[r.sede] = {}
          if (!agg[r.sede][dow]) agg[r.sede][dow] = { pranzo: [0,0], cena: [0,0] }
          const t = r.turno === 'pranzo' ? 'pranzo' : 'cena'
          agg[r.sede][dow][t][0] += parseInt(r.quantita) || 0
          agg[r.sede][dow][t][1]++
        }
        parts.push(`\n## Media coperti per turno (ultimi 6 mesi) — dati reali iPratico`)
        parts.push(`Giorno | Sede | Pranzo avg | Cena avg`)
        for (const sede of Object.keys(agg).sort()) {
          for (let dow = 1; dow <= 7; dow++) {
            const d = dow % 7  // 1=Lun→1 ... 6=Sab→6, 7=Dom→0
            const row = agg[sede][d]
            if (!row) continue
            const pAvg = row.pranzo[1] > 0 ? Math.round(row.pranzo[0] / row.pranzo[1]) : 0
            const cAvg = row.cena[1] > 0   ? Math.round(row.cena[0]   / row.cena[1])   : 0
            if (pAvg > 0 || cAvg > 0)
              parts.push(`${GIORNI[d]} | ${sede} | ${pAvg} | ${cAvg}`)
          }
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

    // Buste paga + ANALISI PRO-RATA COERENTE (costo personale vs fatturato sullo stesso periodo)
    // USA v_costo_personale_mensile_categoria per separare ATTIVI da EX-DIPENDENTI/TFR
    if (includeBuste) {
      const { data: bpView } = await supabase
        .from('v_costo_personale_mensile_categoria')
        .select('sede, anno, mese, categoria, tot_costo, n_cedolini')
        .order('anno', { ascending: false })
        .order('mese', { ascending: false })
        .limit(200)
      if (bpView?.length) {
        // Aggrega per sede+mese, ma separa categorie
        const byMese = {}
        for (const r of bpView) {
          const anno = Number(r.anno) || 0
          const mese = Number(r.mese) || 0
          const k = `${r.sede}|${anno}|${mese}`
          if (!byMese[k]) byMese[k] = { sede: r.sede, anno, mese, tot: 0, attivi: 0, ex: 0, cf: 0 }
          const v = parseFloat(r.tot_costo) || 0
          byMese[k].tot += v
          if (r.categoria === 'attivo') byMese[k].attivi += v
          else if (r.categoria === 'ex_dipendente') byMese[k].ex += v
          else byMese[k].cf += v
        }
        parts.push(`\n## Costo personale mensile — SEPARATO per categoria`)
        parts.push(`USA "attivi" per il vero costo operativo. "ex" sono TFR/ferie residue di chi ha cessato. NON sommarli quando calcoli ratio.`)
        const mesiSorted = Object.values(byMese).sort((a, b) => (b.anno - a.anno) || (b.mese - a.mese)).slice(0, 8)
        mesiSorted.forEach(v => {
          parts.push(`${v.sede} ${String(v.mese).padStart(2, '0')}/${v.anno}: attivi €${v.attivi.toFixed(0)} | ex/TFR €${v.ex.toFixed(0)} | cf_anonimo €${v.cf.toFixed(0)} | tot €${v.tot.toFixed(0)}`)
        })
        // Per la sezione pro-rata uso SOLO attivi
        mesiSorted.forEach(v => { v.tot = v.attivi })

        // ── ANALISI PRO-RATA: rapporto costo/fatturato sullo STESSO PERIODO ──
        // Carico fatturato mensile per gli stessi mesi
        const { data: chTutti } = await supabase
          .from('chiusure_giornaliere')
          .select('sede, data, totale_venduto_ipratico, coperti')
          .gte('data', '2026-01-01')
          .order('data', { ascending: false })
          .limit(2000)
        if (chTutti?.length) {
          // Aggrega fatturato per sede+mese + conta giorni con fatturato
          const fatMese = {}
          for (const r of chTutti) {
            const d = new Date(r.data + 'T12:00:00')
            const k = `${r.sede}|${d.getFullYear()}|${d.getMonth() + 1}`
            if (!fatMese[k]) fatMese[k] = { sede: r.sede, anno: d.getFullYear(), mese: d.getMonth() + 1, fat: 0, giorni: 0 }
            const v = parseFloat(r.totale_venduto_ipratico) || 0
            if (v > 0) {
              fatMese[k].fat += v
              fatMese[k].giorni += 1
            }
          }
          // Per ogni mese di costo personale, calcola rapporto coerente
          parts.push(`\n## ⚠️ ANALISI COERENTE costo personale vs fatturato (stesso periodo)`)
          parts.push(`USA SOLO QUESTI VALORI per il rapporto %, NON quelli mensili sopra confrontati con i 30gg mobili!`)
          for (const v of mesiSorted) {
            const k = `${v.sede}|${v.anno}|${v.mese}`
            const f = fatMese[k]
            if (!f) {
              parts.push(`${v.sede} ${String(v.mese).padStart(2, '0')}/${v.anno}: costo €${v.tot.toFixed(0)} | fatturato MANCANTE`)
              continue
            }
            const costoPerGiorno = f.giorni > 0 ? v.tot / f.giorni : 0
            const fatPerGiorno = f.giorni > 0 ? f.fat / f.giorni : 0
            const ratio = f.fat > 0 ? (v.tot / f.fat) * 100 : null
            parts.push(`${v.sede} ${String(v.mese).padStart(2, '0')}/${v.anno}: ${f.giorni}gg apertura · costo €${v.tot.toFixed(0)} (€${costoPerGiorno.toFixed(0)}/g) · fat €${f.fat.toFixed(0)} (€${fatPerGiorno.toFixed(0)}/g) · ratio ${ratio != null ? ratio.toFixed(1) + '%' : 'n/d'}`)
          }

          // ── COSTO PERSONALE PRO-RATA per il MESE IN CORSO ──
          const today = new Date()
          const mY = today.getFullYear(), mM = today.getMonth() + 1
          parts.push(`\n## 📊 Mese in corso ${String(mM).padStart(2, '0')}/${mY} — costo personale PRO-RATA reale`)
          for (const sede of ['MA', 'PN']) {
            const kCurr = `${sede}|${mY}|${mM}`
            const fCurr = fatMese[kCurr]
            if (!fCurr || fCurr.giorni === 0) {
              parts.push(`${sede}: nessun fatturato registrato ancora questo mese`)
              continue
            }
            // Trova mese-base per stimare costo/giorno (ultimo mese chiuso disponibile)
            const baseMese = mesiSorted.find(m => m.sede === sede && (m.anno < mY || (m.anno === mY && m.mese < mM)))
            if (!baseMese) {
              parts.push(`${sede}: nessuna busta paga storica per stimare costo/giorno`)
              continue
            }
            const baseK = `${sede}|${baseMese.anno}|${baseMese.mese}`
            const baseF = fatMese[baseK]
            const giorniBase = baseF?.giorni || 30
            const costoPerGiornoBase = baseMese.tot / giorniBase
            const costoProRata = costoPerGiornoBase * fCurr.giorni
            const ratioPro = (costoProRata / fCurr.fat) * 100
            parts.push(`${sede}: ${fCurr.giorni}gg aperti · fatturato €${fCurr.fat.toFixed(0)} · costo personale pro-rata stimato €${costoProRata.toFixed(0)} (base ${String(baseMese.mese).padStart(2,'0')}/${baseMese.anno}=€${costoPerGiornoBase.toFixed(0)}/g) · ratio ${ratioPro.toFixed(1)}%`)
          }
        }
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
      signal = null, // AbortSignal: consente di annullare la chiamata/stream all'unmount
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
      signal,
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
      let buffer = ''

      while (true) {
        // Se il chiamante ha abortito (es. componente smontato) chiudiamo il reader
        if (signal?.aborted) { await reader.cancel().catch(() => {}); return full }
        const { done, value } = await reader.read()
        if (done) break
        // stream:true mantiene i caratteri multibyte spezzati tra i chunk
        buffer += decoder.decode(value, { stream: true })
        // Processa solo le righe complete (terminate da newline); l'eventuale
        // riga parziale resta nel buffer fino alla read() successiva.
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              full += event.delta.text
              if (signal?.aborted) { await reader.cancel().catch(() => {}); return full }
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
