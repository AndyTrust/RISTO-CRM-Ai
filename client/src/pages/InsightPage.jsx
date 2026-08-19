/**
 * InsightPage — le analisi del CRM, già pronte.
 *
 * Perché questa pagina non parla con nessuna AI: l'abbonamento Claude dà
 * accesso a Claude su web, desktop e mobile, non all'API, e per far rispondere
 * un modello da dentro il sito servirebbe una chiave a consumo. Così invece un
 * agente gira per conto suo con l'abbonamento, legge Supabase e scrive i
 * risultati in `crm_insight`. Qui si legge soltanto una tabella: nessuna
 * chiamata esterna, nessuna chiave nel browser, nessun costo per apertura.
 *
 * Il prezzo da pagare è che l'analisi ha un'età. Per questo l'età è scritta
 * accanto a ogni scheda: un numero vecchio di tre giorni non deve sembrare di
 * adesso.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  Brain, AlertTriangle, AlertOctagon, CheckCircle2, Info, RefreshCw,
  ChevronDown, ChevronRight, TrendingUp, TrendingDown, Clock, Database
} from 'lucide-react'
import { insightApi } from '../api/supabase-client'

// ─── Categorie: ordine di lettura, non alfabetico ───────────────────────────
const CATEGORIE = [
  { id: 'ECONOMICS', label: 'Conti',        desc: 'Margine, fatturato, break-even' },
  { id: 'FORNITORI', label: 'Acquisti',     desc: 'Food cost, rincari, fornitori' },
  { id: 'PERSONALE', label: 'Personale',    desc: 'Costo del lavoro e ore' },
  { id: 'SALA',      label: 'Sala',         desc: 'Affluenza, servizi, coperti' },
  { id: 'FISCO',     label: 'Fisco',        desc: 'Commercialista e adempimenti' },
  { id: 'ANOMALIE',  label: 'Da guardare',  desc: 'Dati che non tornano' },
]

const SEVERITA = {
  critico:    { icona: AlertOctagon,  bordo: 'border-red-300',    fondo: 'bg-red-50',    testo: 'text-red-700',    punto: 'bg-red-500',    label: 'Critico' },
  attenzione: { icona: AlertTriangle, bordo: 'border-amber-300',  fondo: 'bg-amber-50',  testo: 'text-amber-700',  punto: 'bg-amber-500',  label: 'Attenzione' },
  ok:         { icona: CheckCircle2,  bordo: 'border-emerald-300',fondo: 'bg-emerald-50',testo: 'text-emerald-700',punto: 'bg-emerald-500',label: 'A posto' },
  info:       { icona: Info,          bordo: 'border-slate-200',  fondo: 'bg-slate-50',  testo: 'text-slate-600',  punto: 'bg-slate-400',  label: 'Nota' },
}
const sev = (s) => SEVERITA[s] || SEVERITA.info

const SEDE_LABEL = { MA: 'Mameli', PN: 'Predda Niedda' }

// ─── Formattazione ──────────────────────────────────────────────────────────
const fmtNum = (v, unita) => {
  if (v === null || v === undefined || v === '') return '—'
  const n = typeof v === 'number' ? v : parseFloat(v)
  if (Number.isNaN(n)) return String(v)
  if (unita === '%')  return n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'
  if (unita === '€')  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  const dec = Number.isInteger(n) ? 0 : 2
  return n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + (unita ? ` ${unita}` : '')
}

const eta = (ore) => {
  if (ore === null || ore === undefined) return null
  const h = parseFloat(ore)
  if (Number.isNaN(h)) return null
  if (h < 1)  return 'adesso'
  if (h < 24) return `${Math.round(h)} ore fa`
  const g = Math.round(h / 24)
  return g === 1 ? 'ieri' : `${g} giorni fa`
}

const periodo = (dal, al) => {
  if (!dal && !al) return null
  const f = (d) => d ? new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) : ''
  return dal && al ? `${f(dal)} – ${f(al)}` : f(dal || al)
}

// ─── Markdown minimo: grassetto, elenchi, righe. Niente libreria per tre casi ─
function Corpo({ testo }) {
  if (!testo) return null
  const blocchi = String(testo).split(/\n{2,}/)
  const inline = (s) => {
    const parti = String(s).split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    return parti.map((p, i) => {
      if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} className="font-semibold text-slate-900">{p.slice(2, -2)}</strong>
      if (/^`[^`]+`$/.test(p))       return <code key={i} className="px-1 py-0.5 bg-slate-100 rounded text-[12px]">{p.slice(1, -1)}</code>
      return <React.Fragment key={i}>{p}</React.Fragment>
    })
  }
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-slate-700">
      {blocchi.map((b, i) => {
        const righe = b.split('\n')
        const isLista = righe.every(r => /^\s*[-*•]\s+/.test(r))
        if (isLista) return (
          <ul key={i} className="list-disc pl-5 space-y-1">
            {righe.map((r, j) => <li key={j}>{inline(r.replace(/^\s*[-*•]\s+/, ''))}</li>)}
          </ul>
        )
        return <p key={i}>{inline(b.replace(/\n/g, ' '))}</p>
      })}
    </div>
  )
}

// ─── Una metrica ────────────────────────────────────────────────────────────
function Metrica({ m }) {
  const d = m.delta === null || m.delta === undefined ? null : parseFloat(m.delta)
  const su = m.verso === 'su' || (d !== null && d > 0)
  const Freccia = su ? TrendingUp : TrendingDown
  return (
    <div className="px-3 py-2 bg-white border border-slate-200 rounded-lg min-w-[130px]">
      <div className="text-[11px] text-slate-500 truncate" title={m.etichetta}>{m.etichetta}</div>
      <div className="text-sm font-semibold text-slate-900 tabular-nums">{fmtNum(m.valore, m.unita)}</div>
      {d !== null && !Number.isNaN(d) && (
        <div className="flex items-center gap-1 text-[11px] text-slate-500 tabular-nums">
          <Freccia size={11}/>{fmtNum(Math.abs(d), m.unita)}
        </div>
      )}
    </div>
  )
}

// ─── Una scheda ─────────────────────────────────────────────────────────────
function Scheda({ ins }) {
  const [aperto, setAperto] = useState(ins.severita === 'critico')
  const s = sev(ins.severita)
  const Icona = s.icona
  const metriche = Array.isArray(ins.metriche) ? ins.metriche : []
  const fonti    = Array.isArray(ins.fonti) ? ins.fonti : []
  const p = periodo(ins.periodo_dal, ins.periodo_al)

  return (
    <div className={`border rounded-xl overflow-hidden ${s.bordo}`}>
      <button
        onClick={() => setAperto(v => !v)}
        className={`w-full text-left px-4 py-3 flex items-start gap-3 ${s.fondo} hover:brightness-[0.98] transition`}
      >
        <Icona size={16} className={`${s.testo} flex-shrink-0 mt-0.5`}/>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-900">{ins.titolo}</h3>
            {ins.sede && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/70 border border-slate-200 text-slate-600">
                {SEDE_LABEL[ins.sede] || ins.sede}
              </span>
            )}
            {p && <span className="text-[11px] text-slate-500">{p}</span>}
          </div>
          <p className={`text-[13px] mt-1 ${s.testo}`}>{ins.verdetto}</p>
        </div>
        {aperto ? <ChevronDown size={15} className="text-slate-400 mt-0.5"/> : <ChevronRight size={15} className="text-slate-400 mt-0.5"/>}
      </button>

      {aperto && (
        <div className="px-4 py-3 bg-white border-t border-slate-100 space-y-3">
          {metriche.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {metriche.map((m, i) => <Metrica key={i} m={m}/>)}
            </div>
          )}
          <Corpo testo={ins.corpo}/>
          <div className="flex items-center gap-3 flex-wrap pt-1 text-[11px] text-slate-400">
            {eta(ins.ore_fa) && <span className="flex items-center gap-1"><Clock size={11}/>{eta(ins.ore_fa)}</span>}
            {fonti.length > 0 && (
              <span className="flex items-center gap-1" title={fonti.join(', ')}>
                <Database size={11}/>{fonti.slice(0, 3).join(', ')}{fonti.length > 3 ? ` +${fonti.length - 3}` : ''}
              </span>
            )}
            <span className="font-mono">{ins.slug}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Pagina ─────────────────────────────────────────────────────────────────
export default function InsightPage() {
  const [insight, setInsight]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [errore, setErrore]     = useState(null)
  const [filtroSede, setFiltroSede] = useState('tutte')
  const [filtroSev, setFiltroSev]   = useState('tutte')

  const carica = async () => {
    setLoading(true); setErrore(null)
    try {
      setInsight(await insightApi.correnti())
    } catch (e) {
      console.error('InsightPage:', e)
      setErrore(e.message || 'Non è stato possibile leggere le analisi.')
      setInsight([])
    } finally { setLoading(false) }
  }
  useEffect(() => { carica() }, [])

  const filtrati = useMemo(() => insight.filter(i =>
    (filtroSede === 'tutte' || (filtroSede === 'gruppo' ? !i.sede : i.sede === filtroSede)) &&
    (filtroSev  === 'tutte' || i.severita === filtroSev)
  ), [insight, filtroSede, filtroSev])

  const conteggi = useMemo(() => ({
    critico:    insight.filter(i => i.severita === 'critico').length,
    attenzione: insight.filter(i => i.severita === 'attenzione').length,
  }), [insight])

  const aggiornamento = useMemo(() => {
    if (!insight.length) return null
    return eta(Math.min(...insight.map(i => parseFloat(i.ore_fa) || 0)))
  }, [insight])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Testata */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Brain size={20} className="text-violet-600"/> Analisi
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Lette dai dati del CRM e riscritte a ogni giro.
            {aggiornamento && <> Ultimo aggiornamento <strong className="text-slate-700">{aggiornamento}</strong>.</>}
          </p>
        </div>
        <button onClick={carica} disabled={loading}
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''}/> Ricarica
        </button>
      </div>

      {/* Filtri */}
      {insight.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-sm">
          {[['tutte','Tutte'],['gruppo','Gruppo'],['MA','Mameli'],['PN','Predda Niedda']].map(([id, lbl]) => (
            <button key={id} onClick={() => setFiltroSede(id)}
              className={`px-2.5 py-1 rounded-lg border ${filtroSede === id ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {lbl}
            </button>
          ))}
          <span className="w-px h-5 bg-slate-200 mx-1"/>
          {conteggi.critico > 0 && (
            <button onClick={() => setFiltroSev(filtroSev === 'critico' ? 'tutte' : 'critico')}
              className={`px-2.5 py-1 rounded-lg border flex items-center gap-1.5 ${filtroSev === 'critico' ? 'bg-red-600 text-white border-red-600' : 'border-red-200 text-red-700 hover:bg-red-50'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${filtroSev === 'critico' ? 'bg-white' : 'bg-red-500'}`}/>
              {conteggi.critico} critici
            </button>
          )}
          {conteggi.attenzione > 0 && (
            <button onClick={() => setFiltroSev(filtroSev === 'attenzione' ? 'tutte' : 'attenzione')}
              className={`px-2.5 py-1 rounded-lg border flex items-center gap-1.5 ${filtroSev === 'attenzione' ? 'bg-amber-500 text-white border-amber-500' : 'border-amber-200 text-amber-700 hover:bg-amber-50'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${filtroSev === 'attenzione' ? 'bg-white' : 'bg-amber-500'}`}/>
              {conteggi.attenzione} da tenere d'occhio
            </button>
          )}
        </div>
      )}

      {errore && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={15} className="text-red-500 flex-shrink-0"/>
          <p className="text-sm text-red-700">{errore}</p>
          <button onClick={carica} className="ml-auto text-xs text-red-600 hover:underline">Riprova</button>
        </div>
      )}

      {loading && (
        <div className="py-16 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
          <RefreshCw size={15} className="animate-spin"/> Carico le analisi…
        </div>
      )}

      {!loading && !errore && insight.length === 0 && (
        <div className="py-16 text-center">
          <Brain size={32} className="mx-auto text-slate-300"/>
          <p className="text-sm text-slate-500 mt-3">Nessuna analisi ancora scritta.</p>
          <p className="text-xs text-slate-400 mt-1">
            Le produce il giro schedulato: compaiono qui appena gira la prima volta.
          </p>
        </div>
      )}

      {/* Le schede, raggruppate */}
      {!loading && filtrati.length > 0 && CATEGORIE.map(cat => {
        const gruppo = filtrati.filter(i => i.categoria === cat.id)
          .sort((a, b) => (a.ordine ?? 100) - (b.ordine ?? 100))
        if (!gruppo.length) return null
        return (
          <section key={cat.id} className="space-y-2">
            <div className="flex items-baseline gap-2 pt-1">
              <h2 className="text-sm font-semibold text-slate-900">{cat.label}</h2>
              <span className="text-xs text-slate-400">{cat.desc}</span>
            </div>
            <div className="space-y-2">
              {gruppo.map(i => <Scheda key={i.id} ins={i}/>)}
            </div>
          </section>
        )
      })}

      {!loading && insight.length > 0 && filtrati.length === 0 && (
        <div className="py-12 text-center text-sm text-slate-400">
          Nessuna analisi con questi filtri.
        </div>
      )}

      <p className="text-[11px] text-slate-400 pt-4 border-t border-slate-100">
        Queste analisi sono scritte da un agente che legge il database per conto suo:
        la pagina non chiama nessun servizio esterno e non consuma nulla ad ogni apertura.
        I numeri valgono alla data indicata su ciascuna scheda.
      </p>
    </div>
  )
}
