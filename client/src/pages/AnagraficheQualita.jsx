/**
 * AnagraficheQualita.jsx — "Anagrafiche da sistemare"
 *
 * Elenca i buchi nell'anagrafica dipendenti e permette di chiuderli dal sito,
 * scrivendo su Supabase, invece di doverli correggere in SQL.
 *
 * Quattro controlli:
 *   A. reparto mancante          → il costo finisce in "Non assegnato"
 *   B. ruolo mancante            → turni e fabbisogno non sanno cosa fa
 *   C. split reparto incoerente  → somma != 100, o reparto principale in conflitto
 *   D. inattivo con paga recente → probabilmente e' la bandierina "attivo" sbagliata
 *
 * Nota sul controllo C: reparto_split VUOTO non e' un errore, e' il caso normale
 * (il costo ricade su reparto_id). Lo era finche' v_costo_dipendente_allocato
 * sbagliava il fallback; corretto con la migrazione del 2026-08-07.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Building2, CheckCircle2, ChevronDown, ChevronRight,
  Info, Loader, RefreshCw, Save, Tag, UserCheck, Users,
} from 'lucide-react'
import { employees as empApi, repartiApi } from '../api/client'
import { supabase } from '../supabase'

const eur = (v) => `€${Math.round(Number(v) || 0).toLocaleString('it-IT')}`
const MESI = ['', 'gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
const ymLabel = (ym) => (ym ? `${MESI[ym % 100]} ${Math.floor(ym / 100)}` : '—')
const ymMinus = (ym, n) => {
  if (!ym) return 0
  const tot = Math.floor(ym / 100) * 12 + ((ym % 100) - 1) - n
  return Math.floor(tot / 12) * 100 + ((tot % 12) + 1)
}
const SEDE_LABEL = { MA: 'Mameli', PN: 'Predda Niedda' }

// Supabase tronca a 1000 righe: buste_paga ne ha ~1.400.
async function fetchAllPaged(table, cols) {
  const out = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + size - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < size) break
  }
  return out
}

// ── Pezzi di UI riusati dalle quattro sezioni ────────────────────────────────
function Badge({ children, tone = 'gray' }) {
  const tones = {
    gray:   'bg-gray-100 text-gray-600',
    green:  'bg-emerald-100 text-emerald-700',
    red:    'bg-red-100 text-red-700',
    amber:  'bg-amber-100 text-amber-800',
    blue:   'bg-blue-100 text-blue-700',
  }
  return <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${tones[tone]}`}>{children}</span>
}

function Tile({ icon: Icon, n, label, hint, tone, active, onClick }) {
  const tones = {
    red:   { bg: '#fef2f2', bd: '#fecaca', fg: '#991b1b' },
    amber: { bg: '#fffbeb', bd: '#fde68a', fg: '#92400e' },
    blue:  { bg: '#eff6ff', bd: '#bfdbfe', fg: '#1e40af' },
    green: { bg: '#f0fdf4', bd: '#bbf7d0', fg: '#166534' },
  }
  const t = tones[n > 0 ? tone : 'green']
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border p-4 transition hover:shadow-sm ${active ? 'ring-2 ring-offset-1' : ''}`}
      style={{ background: t.bg, borderColor: t.bd }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} style={{ color: t.fg }} />
        <span className="text-2xl font-bold" style={{ color: t.fg }}>{n}</span>
      </div>
      <div className="text-sm font-medium" style={{ color: t.fg }}>{label}</div>
      <div className="text-[11px] mt-0.5 opacity-70" style={{ color: t.fg }}>{hint}</div>
    </button>
  )
}

function Sezione({ id, titolo, sottotitolo, n, aperta, onToggle, children }) {
  return (
    <div id={id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50">
        <div className="text-left">
          <div className="flex items-center gap-2">
            {aperta ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
            <h2 className="font-semibold text-gray-900">{titolo}</h2>
            {n > 0
              ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">{n}</span>
              : <CheckCircle2 size={16} className="text-emerald-500" />}
          </div>
          <p className="text-xs text-gray-500 mt-1 ml-6">{sottotitolo}</p>
        </div>
      </button>
      {aperta && <div className="border-t border-gray-100">{children}</div>}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
export default function AnagraficheQualita() {
  const [emps, setEmps]       = useState([])
  const [reparti, setReparti] = useState([])
  const [paghe, setPaghe]     = useState({})   // employee_id → { costo12, ultimo }
  const [maxYm, setMaxYm]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [toast, setToast]     = useState(null)
  const [busy, setBusy]       = useState({})   // employee_id → true mentre salva
  const [aperte, setAperte]   = useState({ reparto: true, ruolo: false, split: false, inattivi: false })
  const [mostraSenzaStoria, setMostraSenzaStoria] = useState(false)
  const [sel, setSel]         = useState(new Set())
  const [bozza, setBozza]     = useState({})   // employee_id → { reparto_id?, role? }

  const flash = (msg, tone = 'ok') => {
    setToast({ msg, tone })
    setTimeout(() => setToast(null), 3200)
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [e, r, bp] = await Promise.all([
        empApi.getAll(),
        repartiApi.getAll(),
        fetchAllPaged('buste_paga', 'employee_id, anno, mese, costo_azienda'),
      ])
      let mx = 0
      const righe = {}
      for (const b of bp) {
        if (!b.employee_id) continue
        const ym = b.anno * 100 + b.mese
        if (ym > mx) mx = ym
        ;(righe[b.employee_id] || (righe[b.employee_id] = [])).push({ ym, costo: Number(b.costo_azienda) || 0 })
      }
      const soglia = ymMinus(mx, 11)
      const agg = {}
      for (const [id, rows] of Object.entries(righe)) {
        agg[id] = {
          ultimo:  rows.reduce((a, x) => Math.max(a, x.ym), 0),
          costo12: rows.filter(x => x.ym >= soglia).reduce((a, x) => a + x.costo, 0),
        }
      }
      setEmps(e); setReparti(r); setPaghe(agg); setMaxYm(mx)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const repartoDi = useMemo(() => new Map(reparti.map(r => [r.id, r])), [reparti])
  const nomeReparto = (id) => {
    const r = repartoDi.get(id)
    if (!r) return '—'
    return `${r.icona || ''} ${r.nome}${r.sede ? ` (${r.sede})` : ''}`.trim()
  }
  const info = (e) => paghe[e.id] || { ultimo: 0, costo12: 0 }
  const perCosto = (a, b) => (info(b).costo12 - info(a).costo12) || (info(b).ultimo - info(a).ultimo) || a.name.localeCompare(b.name)

  // ── I quattro controlli ────────────────────────────────────────────────────
  const senzaReparto = useMemo(() => emps.filter(e => !e.reparto_id).sort(perCosto), [emps, paghe])
  const conStoria    = useMemo(() => senzaReparto.filter(e => info(e).costo12 > 0 || info(e).ultimo > 0), [senzaReparto, paghe])
  const senzaStoria  = useMemo(() => senzaReparto.filter(e => !(info(e).costo12 > 0 || info(e).ultimo > 0)), [senzaReparto, paghe])

  const senzaRuolo = useMemo(
    () => emps.filter(e => !(e.role || '').trim()).sort(perCosto),
    [emps, paghe])

  const splitRotto = useMemo(() => {
    const out = []
    for (const e of emps) {
      const s = e.reparto_split || {}
      const chiavi = Object.keys(s).filter(k => k && Number(s[k]) > 0)
      if (!chiavi.length) continue          // split vuoto = normale, ricade su reparto_id
      const somma = chiavi.reduce((a, k) => a + Number(s[k] || 0), 0)
      const dominante = chiavi.sort((a, b) => Number(s[b]) - Number(s[a]))[0]
      const problemi = []
      if (Math.round(somma) !== 100) problemi.push(`la ripartizione somma ${Math.round(somma)}% invece di 100%`)
      if (e.reparto_id && dominante !== e.reparto_id)
        problemi.push(`il reparto principale dice ${nomeReparto(e.reparto_id)}, la ripartizione dice ${nomeReparto(dominante)}`)
      if (!e.reparto_id) problemi.push('ha una ripartizione ma nessun reparto principale')
      if (problemi.length) out.push({ e, problemi, dominante, somma })
    }
    return out.sort((a, b) => perCosto(a.e, b.e))
  }, [emps, paghe, reparti])

  const sogliaRecente = useMemo(() => ymMinus(maxYm, 2), [maxYm])
  const inattiviRecenti = useMemo(
    () => emps.filter(e => e.active === false && info(e).ultimo >= sogliaRecente && sogliaRecente > 0).sort(perCosto),
    [emps, paghe, sogliaRecente])

  const ruoloServizioMaiUsato = emps.length > 0 && emps.every(e => !e.ruolo_servizio)
  const ruoliNoti = useMemo(
    () => [...new Set(emps.map(e => (e.role || '').trim()).filter(Boolean))].sort(),
    [emps])

  // ── Scritture su Supabase ──────────────────────────────────────────────────
  const patchLocale = (id, campi) => setEmps(list => list.map(e => (e.id === id ? { ...e, ...campi } : e)))

  const salva = async (id, campi, msg) => {
    setBusy(b => ({ ...b, [id]: true }))
    try {
      await empApi.update(id, campi)
      patchLocale(id, campi)
      setBozza(b => { const n = { ...b }; delete n[id]; return n })
      flash(msg)
    } catch (err) {
      flash(`Non sono riuscito a salvare: ${err.message || err}`, 'ko')
    } finally {
      setBusy(b => { const n = { ...b }; delete n[id]; return n })
    }
  }

  // Scrive reparto_id E reparto_split insieme: sono le due facce della stessa
  // informazione e lasciarle disallineate e' proprio il caso C.
  const assegnaReparto = (e, repartoId) => {
    if (!repartoId) return
    salva(e.id, { reparto_id: repartoId, reparto_split: { [repartoId]: 100 } },
      `${e.name} → ${nomeReparto(repartoId)}`)
  }

  const assegnaInBlocco = async (repartoId) => {
    if (!repartoId || !sel.size) return
    const ids = [...sel]
    setBusy(b => ({ ...b, ...Object.fromEntries(ids.map(i => [i, true])) }))
    try {
      await Promise.all(ids.map(id => empApi.update(id, { reparto_id: repartoId, reparto_split: { [repartoId]: 100 } })))
      ids.forEach(id => patchLocale(id, { reparto_id: repartoId, reparto_split: { [repartoId]: 100 } }))
      setSel(new Set())
      flash(`${ids.length} ${ids.length === 1 ? 'persona assegnata' : 'persone assegnate'} a ${nomeReparto(repartoId)}`)
    } catch (err) {
      flash(`Assegnazione in blocco fallita: ${err.message || err}`, 'ko')
    } finally {
      setBusy({})
    }
  }

  const toggleSel = (id) => setSel(s => {
    const n = new Set(s)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  // ── Riga persona, condivisa dalle sezioni ─────────────────────────────────
  const Riga = ({ e, children, selezionabile }) => {
    const i = info(e)
    return (
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
        {selezionabile && (
          <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggleSel(e.id)}
                 className="w-4 h-4 rounded border-gray-300" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 text-sm">{e.name}</span>
            <Badge tone="blue">{SEDE_LABEL[e.sede] || e.sede}</Badge>
            {e.active === false ? <Badge tone="gray">non attivo</Badge> : <Badge tone="green">attivo</Badge>}
            {e.role && <Badge>{e.role}</Badge>}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {e.code}
            {i.costo12 > 0 && <> · <span className="font-medium text-gray-700">{eur(i.costo12)}</span> negli ultimi 12 mesi</>}
            {i.ultimo > 0 && <> · ultima busta {ymLabel(i.ultimo)}</>}
            {!i.ultimo && <> · nessuna busta paga</>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {busy[e.id] ? <Loader size={16} className="animate-spin text-gray-400" /> : children}
        </div>
      </div>
    )
  }

  const SelectReparto = ({ value, onChange, placeholder = 'Scegli reparto…' }) => (
    <select value={value || ''} onChange={ev => onChange(ev.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white">
      <option value="">{placeholder}</option>
      {reparti.map(r => (
        <option key={r.id} value={r.id}>{r.icona} {r.nome}{r.sede ? ` — ${r.sede}` : ''}</option>
      ))}
    </select>
  )

  const totale = senzaReparto.length + senzaRuolo.length + splitRotto.length + inattiviRecenti.length

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-3 text-gray-500">
        <Loader size={18} className="animate-spin" /> Carico anagrafiche e buste paga…
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Intestazione */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users size={22} className="text-violet-600" /> Anagrafiche da sistemare
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            I buchi in anagrafica che sporcano i numeri, con accanto quanto pesano in euro.
            Si correggono da qui: ogni modifica scrive su Supabase.
          </p>
        </div>
        <button onClick={load} className="text-sm px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 flex items-center gap-2">
          <RefreshCw size={14} /> Ricarica
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}

      {totale === 0 && !error && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 flex items-center gap-3">
          <CheckCircle2 size={20} className="text-emerald-600" />
          <div className="text-sm text-emerald-800">
            <strong>Nessun buco.</strong> Ogni dipendente ha reparto e ruolo, le ripartizioni tornano,
            e nessun inattivo ha buste paga recenti.
          </div>
        </div>
      )}

      {/* Semafori */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={Building2} n={senzaReparto.length} tone="red"
              label="Senza reparto" hint="il costo finisce in “Non assegnato”"
              onClick={() => setAperte(a => ({ ...a, reparto: true }))} />
        <Tile icon={Tag} n={senzaRuolo.length} tone="amber"
              label="Senza ruolo" hint="turni e fabbisogno restano ciechi"
              onClick={() => setAperte(a => ({ ...a, ruolo: true }))} />
        <Tile icon={AlertTriangle} n={splitRotto.length} tone="amber"
              label="Ripartizione incoerente" hint="reparto principale ≠ ripartizione"
              onClick={() => setAperte(a => ({ ...a, split: true }))} />
        <Tile icon={UserCheck} n={inattiviRecenti.length} tone="blue"
              label="Inattivi con paga recente" hint="forse è la bandierina sbagliata"
              onClick={() => setAperte(a => ({ ...a, inattivi: true }))} />
      </div>

      {/* ── A. Reparto mancante ─────────────────────────────────────────── */}
      <Sezione id="reparto" titolo="Reparto mancante" n={senzaReparto.length}
               aperta={aperte.reparto} onToggle={() => setAperte(a => ({ ...a, reparto: !a.reparto }))}
               sottotitolo="Senza reparto il costo di queste persone non entra in Analisi Reparti: resta in una riga “Non assegnato”.">
        {sel.size > 0 && (
          <div className="px-5 py-3 bg-violet-50 border-b border-violet-100 flex items-center gap-3">
            <span className="text-sm font-medium text-violet-900">{sel.size} selezionat{sel.size === 1 ? 'a' : 'e'}</span>
            <SelectReparto value="" onChange={assegnaInBlocco} placeholder="Assegna tutte a…" />
            <button onClick={() => setSel(new Set())} className="text-xs text-violet-700 hover:underline ml-auto">annulla</button>
          </div>
        )}

        {conStoria.map(e => (
          <Riga key={e.id} e={e} selezionabile>
            <SelectReparto value={bozza[e.id]?.reparto_id}
                           onChange={v => setBozza(b => ({ ...b, [e.id]: { ...b[e.id], reparto_id: v } }))} />
            <button disabled={!bozza[e.id]?.reparto_id}
                    onClick={() => assegnaReparto(e, bozza[e.id]?.reparto_id)}
                    className="text-sm px-3 py-1.5 rounded-lg bg-violet-600 text-white disabled:bg-gray-200 disabled:text-gray-400 hover:bg-violet-700">
              Assegna
            </button>
          </Riga>
        ))}

        {senzaStoria.length > 0 && (
          <>
            <button onClick={() => setMostraSenzaStoria(v => !v)}
                    className="w-full px-5 py-3 text-left text-xs text-gray-500 hover:bg-gray-50 border-t border-gray-100">
              {mostraSenzaStoria ? '▾' : '▸'} altre {senzaStoria.length} anagrafiche senza reparto e senza nessuna busta paga
              — quasi tutte segnaposto “EX-DIP”, non spostano numeri
            </button>
            {mostraSenzaStoria && senzaStoria.map(e => (
              <Riga key={e.id} e={e} selezionabile>
                <SelectReparto value={bozza[e.id]?.reparto_id}
                               onChange={v => setBozza(b => ({ ...b, [e.id]: { ...b[e.id], reparto_id: v } }))} />
                <button disabled={!bozza[e.id]?.reparto_id}
                        onClick={() => assegnaReparto(e, bozza[e.id]?.reparto_id)}
                        className="text-sm px-3 py-1.5 rounded-lg bg-violet-600 text-white disabled:bg-gray-200 disabled:text-gray-400 hover:bg-violet-700">
                  Assegna
                </button>
              </Riga>
            ))}
          </>
        )}
      </Sezione>

      {/* ── B. Ruolo mancante ───────────────────────────────────────────── */}
      <Sezione id="ruolo" titolo="Ruolo mancante" n={senzaRuolo.length}
               aperta={aperte.ruolo} onToggle={() => setAperte(a => ({ ...a, ruolo: !a.ruolo }))}
               sottotitolo="Il ruolo è quello che pianificazione turni e fabbisogno leggono per capire chi può coprire cosa.">
        {ruoloServizioMaiUsato && (
          <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 flex gap-2 text-xs text-blue-900">
            <Info size={14} className="shrink-0 mt-0.5" />
            <span>
              Il campo <code className="bg-blue-100 px-1 rounded">ruolo_servizio</code> è vuoto per tutti e {emps.length} i
              dipendenti: non è un buco da riempire persona per persona, è un campo che il CRM non ha mai iniziato a usare.
              Non lo conto fra i problemi.
            </span>
          </div>
        )}
        {senzaRuolo.map(e => (
          <Riga key={e.id} e={e}>
            <input list="ruoli-noti" placeholder="Ruolo…"
                   value={bozza[e.id]?.role ?? ''}
                   onChange={ev => setBozza(b => ({ ...b, [e.id]: { ...b[e.id], role: ev.target.value } }))}
                   className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 w-44" />
            <button disabled={!(bozza[e.id]?.role || '').trim()}
                    onClick={() => salva(e.id, { role: bozza[e.id].role.trim() }, `Ruolo di ${e.name} salvato`)}
                    className="text-sm px-3 py-1.5 rounded-lg bg-amber-500 text-white disabled:bg-gray-200 disabled:text-gray-400 hover:bg-amber-600 flex items-center gap-1">
              <Save size={13} /> Salva
            </button>
          </Riga>
        ))}
        <datalist id="ruoli-noti">{ruoliNoti.map(r => <option key={r} value={r} />)}</datalist>
      </Sezione>

      {/* ── C. Split incoerente ─────────────────────────────────────────── */}
      <Sezione id="split" titolo="Ripartizione per reparto incoerente" n={splitRotto.length}
               aperta={aperte.split} onToggle={() => setAperte(a => ({ ...a, split: !a.split }))}
               sottotitolo="Quando reparto principale e ripartizione dicono cose diverse, vince la ripartizione: il costo va dove non te lo aspetti.">
        {splitRotto.map(({ e, problemi, dominante }) => (
          <div key={e.id} className="px-5 py-3 border-b border-gray-50 last:border-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-900 text-sm">{e.name}</span>
              <Badge tone="blue">{SEDE_LABEL[e.sede] || e.sede}</Badge>
              {e.active === false && <Badge tone="gray">non attivo</Badge>}
              {info(e).costo12 > 0 && <Badge tone="amber">{eur(info(e).costo12)} / 12 mesi</Badge>}
            </div>
            <ul className="text-xs text-gray-600 mt-1 ml-1 space-y-0.5">
              {problemi.map((p, i) => <li key={i}>— {p}</li>)}
            </ul>
            <div className="flex items-center gap-2 mt-2">
              {busy[e.id] ? <Loader size={16} className="animate-spin text-gray-400" /> : (
                <>
                  {e.reparto_id && (
                    <button onClick={() => salva(e.id, { reparto_split: { [e.reparto_id]: 100 } },
                             `${e.name}: ripartizione allineata a ${nomeReparto(e.reparto_id)}`)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50">
                      Tieni {nomeReparto(e.reparto_id)}
                    </button>
                  )}
                  {dominante && dominante !== e.reparto_id && (
                    <button onClick={() => salva(e.id, { reparto_id: dominante, reparto_split: { [dominante]: 100 } },
                             `${e.name}: spostato su ${nomeReparto(dominante)}`)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50">
                      Tieni {nomeReparto(dominante)}
                    </button>
                  )}
                  <span className="text-[11px] text-gray-400">in entrambi i casi la ripartizione diventa 100% su un reparto solo</span>
                </>
              )}
            </div>
          </div>
        ))}
      </Sezione>

      {/* ── D. Inattivi con paga recente ────────────────────────────────── */}
      <Sezione id="inattivi" titolo="Risultano non attivi ma hanno buste paga recenti" n={inattiviRecenti.length}
               aperta={aperte.inattivi} onToggle={() => setAperte(a => ({ ...a, inattivi: !a.inattivi }))}
               sottotitolo={`Chi ha una busta paga da ${ymLabel(sogliaRecente)} in poi ed è segnato non attivo. O è uscito davvero, o la bandierina è sbagliata.`}>
        {inattiviRecenti.map(e => (
          <Riga key={e.id} e={e}>
            <button onClick={() => salva(e.id, { active: true }, `${e.name} rimesso fra gli attivi`)}
                    className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1">
              <UserCheck size={13} /> Rimetti attivo
            </button>
          </Riga>
        ))}
      </Sezione>

      <p className="text-xs text-gray-400 px-1">
        I doppioni di anagrafica (la stessa persona con due schede) si uniscono da{' '}
        <a href="/admin/unioni" className="underline hover:text-gray-600">Admin → Unioni &amp; Doppioni</a>.
      </p>

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-sm text-white ${toast.tone === 'ko' ? 'bg-red-600' : 'bg-gray-900'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
