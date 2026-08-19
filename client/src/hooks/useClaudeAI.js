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
import { fetchPaged } from '../api/paged'

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/claude-proxy`

// ─── Date ───────────────────────────────────────────────────────────────────

/**
 * Data YYYY-MM-DD nel fuso LOCALE.
 * `toISOString()` converte in UTC: la sera, in Italia (UTC+1/+2), "oggi"
 * diventa ieri e l'intera finestra temporale scivola indietro di un giorno.
 */
function isoLocale(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const g = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${g}`
}

/**
 * Sottrae mesi mantenendo il giorno valido.
 * `setMonth(getMonth() - 6)` il 31 agosto punta al 31 febbraio, che Date
 * normalizza al 3 marzo: la finestra "ultimi 6 mesi" cambia lunghezza a
 * seconda del giorno in cui la si calcola. `new Date(anno, mese, 0)` dà il
 * numero reale di giorni del mese di arrivo, senza costanti tipo 30 o 31.
 */
function sottraiMesi(d, n) {
  const anno = d.getFullYear()
  const mese = d.getMonth() - n
  const ultimoGiorno = new Date(anno, mese + 1, 0).getDate()
  return new Date(anno, mese, Math.min(d.getDate(), ultimoGiorno))
}

function sottraiGiorni(d, n) {
  const out = new Date(d)
  out.setDate(out.getDate() - n)
  return out
}

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

  /**
   * Esegue un blocco di contesto isolandone l'errore.
   *
   * Il client Supabase non rigetta mai: prima, un `{ data }` letto senza
   * guardare `error` faceva sparire la sezione dal prompt e il modello
   * rispondeva su dati parziali SENZA saperlo. Ora il guasto viene scritto
   * nel prompt: meglio un "non disponibile" esplicito di un silenzio che il
   * modello interpreta come "non ci sono dati".
   */
  const sezione = async (nome, fn) => {
    try {
      await fn()
    } catch (e) {
      parts.push(`\n## ⚠️ ${nome} — DATI NON DISPONIBILI (${e?.message || String(e)})`)
      parts.push(`Non trarre conclusioni su questa sezione: la lettura è fallita, non è un dato pari a zero.`)
    }
  }

  try {
    // Chiusure ultimi 30 gg
    if (includeChiusure) await sezione('Chiusure ultimi 30 giorni', async () => {
      const da = isoLocale(sottraiGiorni(new Date(), 30))
      // Niente `.limit(60)`: 31 giorni × 2 sedi fanno 62 righe e le due più
      // vecchie sparivano dal totale senza alcun segnale.
      const ch = await fetchPaged(
        () => supabase
          .from('chiusure_giornaliere')
          .select('id,sede,data,totale_venduto_dgfe,n_doc_fiscali_emessi,coperti')
          .gte('data', da),
        'id'
      )
      if (ch.length) {
        const bySede = {}
        for (const r of ch) {
          if (!bySede[r.sede]) bySede[r.sede] = { dgfe: 0, coperti: 0, n: 0 }
          bySede[r.sede].dgfe    += parseFloat(r.totale_venduto_dgfe) || 0
          bySede[r.sede].coperti += parseInt(r.coperti) || 0
          bySede[r.sede].n++
        }
        parts.push(`\n## Chiusure ultimi 30 giorni (dal ${da}, ${ch.length} chiusure lette)`)
        for (const [s, v] of Object.entries(bySede)) {
          parts.push(`${s}: €${v.dgfe.toFixed(0)} fatturato, ${v.coperti} coperti, ${v.n} giorni`)
        }
      } else {
        parts.push(`\n## Chiusure ultimi 30 giorni: nessuna chiusura registrata dal ${da}`)
      }
    })

    // Coperti per turno (pranzo/cena) — media per giorno settimana — ultimi 6 mesi
    if (includeTurni) await sezione('Media coperti per turno', async () => {
      const da6m = isoLocale(sottraiMesi(new Date(), 6))
      // ~700 righe oggi, in crescita: senza paginazione il cap di 1000 righe
      // di PostgREST taglierebbe i mesi più vecchi falsando le medie.
      const turniData = await fetchPaged(
        () => supabase
          .from('chiusure_turni')
          .select('id, sede, data, turno, quantita')
          .gte('data', da6m)
          .in('turno', ['pranzo', 'cena']),
        'id'
      )
      if (turniData.length) {
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
    })

    // Venduto top prodotti ultimo mese
    if (includeVenduto) await sezione('Top prodotti venduti', async () => {
      // Prima: `.order('quantita').limit(200)` su TUTTO lo storico. Erano le
      // 200 singole righe con la quantità più alta di sempre, non i prodotti
      // più venduti dell'ultimo mese — e la chat viene interrogata proprio
      // sugli ultimi 30 giorni. Ora la finestra è esplicita e letta per intero.
      const da = isoLocale(sottraiGiorni(new Date(), 30))
      const vd = await fetchPaged(
        () => supabase
          .from('venduto_camerieri')
          .select('id, prodotto, categoria, quantita, sede')
          .gte('data_fine', da),
        'id'
      )
      if (vd.length) {
        const byP = {}
        for (const r of vd) {
          if (!r.prodotto || r.prodotto === 'nan') continue
          if (!byP[r.prodotto]) byP[r.prodotto] = { q: 0, cat: r.categoria }
          byP[r.prodotto].q += parseFloat(r.quantita) || 0
        }
        const top10 = Object.entries(byP).sort((a, b) => b[1].q - a[1].q).slice(0, 10)
        parts.push(`\n## Top 10 prodotti venduti (periodi chiusi dal ${da}, ${vd.length} righe lette)`)
        top10.forEach(([p, v], i) => parts.push(`${i+1}. ${p} (${v.cat || '—'}): ${Math.round(v.q)} pz`))
      } else {
        parts.push(`\n## Top prodotti venduti: nessun venduto caricato dal ${da}`)
      }
    })

    // Fatture — top fornitori
    if (includeFatture) await sezione('Top fornitori per spesa', async () => {
      // Qui il `.limit(10)` è voluto: ordinato per spesa decrescente, le 10
      // righe lette sono davvero le prime 10.
      const { data: ft, error } = await supabase
        .from('fornitori_fatture')
        .select('nome, tot_spesa, n_fatture')
        .order('tot_spesa', { ascending: false })
        .limit(10)
      if (error) throw error
      if (ft?.length) {
        parts.push(`\n## Top fornitori per spesa`)
        ft.forEach((f, i) => parts.push(`${i+1}. ${f.nome}: €${parseFloat(f.tot_spesa || 0).toFixed(0)} (${f.n_fatture || 0} fatture)`))
      }
    })

    // Dipendenti attivi
    if (includeSedi) await sezione('Dipendenti attivi', async () => {
      // `.limit(40)` tagliava l'organico senza dirlo: la chat elencava 40
      // persone e il modello le trattava come l'elenco completo.
      const emp = await fetchPaged(
        () => supabase
          .from('employees')
          .select('id, name, role, sede')
          .eq('active', true),
        'id'
      )
      if (emp.length) {
        const bySede = {}
        for (const e of emp) {
          if (!bySede[e.sede]) bySede[e.sede] = []
          bySede[e.sede].push(`${e.name} (${e.role || 'n/a'})`)
        }
        parts.push(`\n## Dipendenti attivi (${emp.length} in totale)`)
        for (const s of Object.keys(bySede).sort()) {
          parts.push(`${s}: ${bySede[s].join(', ')}`)
        }
      }
    })

    // Buste paga + ANALISI PRO-RATA COERENTE (costo personale vs fatturato sullo stesso periodo)
    // USA v_costo_personale_mensile_categoria per separare ATTIVI da EX-DIPENDENTI/TFR
    if (includeBuste) await sezione('Costo personale', async () => {
      // Vista aggregata (~100 righe): il `.limit(200)` con ordinamento
      // decrescente tiene comunque i mesi più recenti, cioè quelli usati.
      const { data: bpView, error: errBp } = await supabase
        .from('v_costo_personale_mensile_categoria')
        .select('sede, anno, mese, categoria, tot_costo, n_cedolini')
        .order('anno', { ascending: false })
        .order('mese', { ascending: false })
        .limit(200)
      if (errBp) throw errBp
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
        // L'anno di partenza era cablato a '2026-01-01': dal 2027 l'analisi
        // pro-rata avrebbe continuato a caricare anche gli anni passati,
        // falsando il rapporto costo/fatturato. Si usa l'anno corrente.
        // Il vecchio `.range(0, 4999)` NON bypassava nulla: db-max-rows=1000 è
        // un tetto server, PostgREST restituiva 1000 righe senza errore e,
        // essendo ordinate per data DESC, sparivano i mesi più vecchi dal
        // denominatore del ratio costo/fatturato. Serve paginare davvero.
        const chTutti = await fetchPaged(
          () => supabase
            .from('chiusure_giornaliere')
            .select('id, sede, data, totale_venduto_ipratico, coperti')
            .gte('data', `${new Date().getFullYear()}-01-01`),
          'id'
        )
        if (chTutti.length) {
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
          // Sedi ricavate dai dati: cablare ['MA','PN'] farebbe sparire dal
          // prompt una terza sede il giorno in cui venisse aperta.
          const sediNote = [...new Set([
            ...Object.values(fatMese).map(f => f.sede),
            ...mesiSorted.map(m => m.sede),
          ].filter(Boolean))].sort()
          for (const sede of sediNote) {
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
            // Fallback = giorni reali del mese base (`new Date(anno, mese, 0)`),
            // non un 30 fisso che in febbraio sovrastima il costo/giorno.
            const giorniBase = baseF?.giorni || new Date(baseMese.anno, baseMese.mese, 0).getDate()
            const costoPerGiornoBase = baseMese.tot / giorniBase
            const costoProRata = costoPerGiornoBase * fCurr.giorni
            const ratioPro = (costoProRata / fCurr.fat) * 100
            parts.push(`${sede}: ${fCurr.giorni}gg aperti · fatturato €${fCurr.fat.toFixed(0)} · costo personale pro-rata stimato €${costoProRata.toFixed(0)} (base ${String(baseMese.mese).padStart(2,'0')}/${baseMese.anno}=€${costoPerGiornoBase.toFixed(0)}/g) · ratio ${ratioPro.toFixed(1)}%`)
          }
        }
      }
    })

    // Memoria CRM
    if (includeMemory) await sezione('Memoria CRM', async () => {
      const { data: mem, error } = await supabase
        .from('crm_memory')
        .select('sezione, chiave, valore, valore_json, updated_at')
        .order('updated_at', { ascending: false })
        .limit(30)
      if (error) throw error
      if (mem?.length) {
        parts.push(`\n## Memoria CRM salvata${mem.length === 30 ? ' (30 voci più recenti)' : ''}`)
        for (const m of mem) {
          const val = m.valore_json ? JSON.stringify(m.valore_json) : m.valore
          parts.push(`[${m.sezione}/${m.chiave}]: ${val}`)
        }
      }
    })

  } catch (e) {
    // Rete di sicurezza: i guasti per singola sezione sono già segnalati sopra.
    parts.push(`\n⚠️ Errore caricamento contesto: ${e?.message || String(e)}`)
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
      const payload = await response.json().catch(() => null)
      const e = new Error(
        (payload && (payload.error?.message || payload.error || payload.message)) ||
        `Errore ${response.status}`
      )
      e.status = response.status
      e.payload = payload
      throw e
    }

    if (stream && onChunk) {
      // Streaming SSE
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      let buffer = ''
      // La Edge Function claude-proxy, nel ramo streaming, inoltra il corpo di
      // Anthropic senza propagarne lo status: un errore upstream arriva qui
      // come 200 con dentro un JSON invece di eventi SSE. Senza questi due
      // contatori la chat mostrerebbe una risposta vuota al posto dell'errore.
      let grezzo = ''
      let eventiVisti = 0

      while (true) {
        // Se il chiamante ha abortito (es. componente smontato) chiudiamo il reader
        if (signal?.aborted) { await reader.cancel().catch(() => {}); return full }
        const { done, value } = await reader.read()
        if (done) break
        // stream:true mantiene i caratteri multibyte spezzati tra i chunk
        const pezzo = decoder.decode(value, { stream: true })
        if (grezzo.length < 4000) grezzo += pezzo
        buffer += pezzo
        // Processa solo le righe complete (terminate da newline); l'eventuale
        // riga parziale resta nel buffer fino alla read() successiva.
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          // Il catch qui sotto è volutamente muto (righe SSE parziali o eventi
          // che non ci interessano): un evento `error` va quindi messo da parte
          // e rilanciato fuori, altrimenti verrebbe inghiottito.
          let evtErrore = null
          try {
            const event = JSON.parse(line.slice(6))
            eventiVisti++
            if (event.type === 'error') {
              evtErrore = event
            } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              full += event.delta.text
              if (signal?.aborted) { await reader.cancel().catch(() => {}); return full }
              onChunk(full)
            }
          } catch { }
          if (evtErrore) {
            await reader.cancel().catch(() => {})
            const e = new Error(evtErrore.error?.message || 'Errore durante la risposta')
            e.status = 0
            e.payload = evtErrore
            throw e
          }
        }
      }

      if (eventiVisti === 0) {
        // Nessun evento SSE: quasi sempre è un errore upstream travestito da 200.
        let payload = null
        try { payload = JSON.parse(grezzo) } catch { /* non era JSON */ }
        const e = new Error(
          (payload && (payload.error?.message || payload.error)) ||
          'Il servizio AI non ha risposto.'
        )
        e.status = 0
        e.payload = payload ?? grezzo
        throw e
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
