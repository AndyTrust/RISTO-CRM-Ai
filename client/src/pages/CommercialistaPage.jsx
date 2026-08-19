/**
 * CommercialistaPage — il conto vero dello studio, non quello delle fatture.
 *
 * La cosa da capire prima di leggere qualsiasi numero: le fatture ELSO REI che
 * stanno in fatture_importate sono ACCONTI, non il costo. Il documento che lo
 * studio manda si chiama «Avviso di parcella» e dichiara di sé stesso di non
 * essere una fattura: è un estratto conto progressivo delle prestazioni
 * maturate, da cui gli acconti già fatturati vengono scalati.
 *
 * Sommare le fatture e le prestazioni conterebbe lo stesso onorario due volte.
 * Qui si guarda la notula corrente — una sola, `is_corrente` — e si vede quanto
 * è maturato, quanto è già stato fatturato e quanto resta aperto.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  Scale, FileText, Users, Receipt, AlertTriangle, CheckCircle2,
  RefreshCw, ChevronDown, ChevronRight, Calendar, TrendingUp
} from 'lucide-react'
import { commercialistaApi } from '../api/supabase-client'

const eur = (v, dec = 2) => {
  const n = v === null || v === undefined ? null : parseFloat(v)
  if (n === null || Number.isNaN(n)) return '—'
  return n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' €'
}
const dataIt = (d) => d ? new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const MESI = ['', 'gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']

function Tile({ etichetta, valore, nota, accento }) {
  return (
    <div className={`px-4 py-3 rounded-xl border ${accento ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
      <div className="text-[11px] text-slate-500">{etichetta}</div>
      <div className={`text-lg font-semibold tabular-nums ${accento ? 'text-amber-800' : 'text-slate-900'}`}>{valore}</div>
      {nota && <div className="text-[11px] text-slate-400 mt-0.5">{nota}</div>}
    </div>
  )
}

function Sezione({ titolo, icona: Icona, sottotitolo, children, apertoDefault = true }) {
  const [aperto, setAperto] = useState(apertoDefault)
  return (
    <section className="border border-slate-200 rounded-xl overflow-hidden">
      <button onClick={() => setAperto(v => !v)}
        className="w-full px-4 py-3 flex items-center gap-2 bg-slate-50 hover:bg-slate-100 transition text-left">
        <Icona size={15} className="text-slate-500"/>
        <span className="text-sm font-semibold text-slate-900">{titolo}</span>
        {sottotitolo && <span className="text-xs text-slate-400">{sottotitolo}</span>}
        <span className="ml-auto">{aperto ? <ChevronDown size={15} className="text-slate-400"/> : <ChevronRight size={15} className="text-slate-400"/>}</span>
      </button>
      {aperto && <div className="p-4 bg-white">{children}</div>}
    </section>
  )
}

export default function CommercialistaPage() {
  const [dati, setDati]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [errore, setErrore]   = useState(null)

  const carica = async () => {
    setLoading(true); setErrore(null)
    try { setDati(await commercialistaApi.quadro()) }
    catch (e) { console.error('CommercialistaPage:', e); setErrore(e.message || 'Errore nel caricamento'); setDati(null) }
    finally { setLoading(false) }
  }
  useEffect(() => { carica() }, [])

  const saldo    = dati?.saldo?.[0] ?? null
  const notule   = dati?.notule ?? []
  const mensile  = dati?.mensile ?? []
  const acconti  = dati?.acconti ?? []
  const pratiche = dati?.pratiche ?? []

  // Il costo per mese, diviso fra gestione del personale e contabilità/fisco:
  // è la domanda che vale, perché le due voci si governano in modi diversi.
  const perMese = useMemo(() => {
    const m = {}
    mensile.filter(r => r.anno && r.mese).forEach(r => {
      const k = `${r.anno}-${String(r.mese).padStart(2, '0')}`
      m[k] = m[k] || { k, anno: r.anno, mese: r.mese, PERSONALE: 0, CONTABILITA_FISCO: 0, ALTRO: 0, tot: 0 }
      const v = parseFloat(r.importo) || 0
      m[k][r.area] = (m[k][r.area] || 0) + v
      m[k].tot += v
    })
    return Object.values(m).sort((a, b) => a.k.localeCompare(b.k))
  }, [mensile])

  const senzaPeriodo = useMemo(() => {
    const r = mensile.filter(x => !x.anno || !x.mese)
    const tot = r.reduce((s, x) => s + (parseFloat(x.importo) || 0), 0)
    return { righe: r.sort((a, b) => Math.abs(parseFloat(b.importo)) - Math.abs(parseFloat(a.importo))), tot }
  }, [mensile])

  const accontiKo = acconti.filter(a => a.stato !== 'OK')
  const maxMese   = Math.max(1, ...perMese.map(m => m.tot))

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Scale size={20} className="text-indigo-600"/> Commercialista
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Studio Elso Rei — prestazioni maturate, acconti già fatturati e conto aperto.
          </p>
        </div>
        <button onClick={carica} disabled={loading}
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''}/> Ricarica
        </button>
      </div>

      {/* La nota che evita l'errore più caro */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 text-[13px] text-indigo-900">
        Le fatture ELSO REI che vedi in <strong>Fornitori</strong> sono <strong>acconti</strong>, non il costo.
        Il costo è la colonna Prestazioni della notula: sommare le due cose conta lo stesso onorario due volte.
      </div>

      {errore && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={15} className="text-red-500 flex-shrink-0"/>
          <p className="text-sm text-red-700">{errore}</p>
          <button onClick={carica} className="ml-auto text-xs text-red-600 hover:underline">Riprova</button>
        </div>
      )}

      {loading && (
        <div className="py-16 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
          <RefreshCw size={15} className="animate-spin"/> Carico il quadro…
        </div>
      )}

      {!loading && !errore && !saldo && (
        <div className="py-16 text-center">
          <Scale size={32} className="mx-auto text-slate-300"/>
          <p className="text-sm text-slate-500 mt-3">Nessuna notula caricata.</p>
          <p className="text-xs text-slate-400 mt-1">I PDF stanno in <code>CRM 140Grammi/Commercialista</code>.</p>
        </div>
      )}

      {!loading && saldo && (
        <>
          {/* Il conto */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile etichetta="Da pagare oggi" valore={eur(saldo.saldo_da_pagare)} accento
                  nota={saldo.scadenza ? `scadenza ${dataIt(saldo.scadenza)}` : null}/>
            <Tile etichetta="Prestazioni maturate" valore={eur(saldo.tot_prestazioni)}
                  nota={`di cui ${eur(saldo.residuo_anno_precedente, 0)} da prima`}/>
            <Tile etichetta="Acconti già fatturati" valore={eur(saldo.acconti_gia_fatturati)}
                  nota="stanno in Fornitori"/>
            <Tile etichetta="Maturato non fatturato"
                  valore={eur(parseFloat(saldo.tot_prestazioni) - parseFloat(saldo.acconti_gia_fatturati))}
                  nota="arriverà in fattura"/>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile etichetta="Cassa previdenza 4%" valore={eur(saldo.cassa_previdenza)}/>
            <Tile etichetta="IVA 22%"             valore={eur(saldo.totale_iva)}/>
            <Tile etichetta="Ritenuta 20%"        valore={eur(saldo.ritenuta)} nota="la versi tu con F24"/>
            <Tile etichetta="Totale lordo"        valore={eur(saldo.totale_lordo)}/>
          </div>

          {/* Costo per mese e per natura */}
          {perMese.length > 0 && (
            <Sezione titolo="Quanto costa, mese per mese" icona={TrendingUp}
                     sottotitolo="personale contro contabilità e fisco">
              <div className="space-y-1.5">
                {perMese.map(m => {
                  const pPers = (m.PERSONALE / m.tot) * 100
                  return (
                    <div key={m.k} className="flex items-center gap-3 text-[13px]">
                      <span className="w-16 text-slate-500 shrink-0">{MESI[m.mese]} {String(m.anno).slice(2)}</span>
                      <div className="flex-1 h-5 rounded bg-slate-100 overflow-hidden flex" title={`Personale ${eur(m.PERSONALE)} · Contabilità e fisco ${eur(m.CONTABILITA_FISCO)}`}>
                        <div className="bg-indigo-400 h-full" style={{ width: `${(m.PERSONALE / maxMese) * 100}%` }}/>
                        <div className="bg-slate-400 h-full" style={{ width: `${(m.CONTABILITA_FISCO / maxMese) * 100}%` }}/>
                      </div>
                      <span className="w-24 text-right tabular-nums text-slate-900 font-medium shrink-0">{eur(m.tot)}</span>
                      <span className="w-20 text-right tabular-nums text-slate-400 shrink-0">{pPers.toFixed(0)}% pers.</span>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center gap-4 mt-3 text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-indigo-400"/>Gestione del personale</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-slate-400"/>Contabilità e fisco</span>
              </div>

              {senzaPeriodo.righe.length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <p className="text-[12px] text-slate-500 mb-2">
                    Voci senza un mese dichiarato — {eur(senzaPeriodo.tot)}. Sono gli adempimenti annuali
                    (CU, dichiarazione IVA, INAIL, tredicesima e quattordicesima): pesano sull'anno, non su un mese.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {senzaPeriodo.righe.map((r, i) => (
                      <span key={i} className="text-[11px] px-2 py-1 rounded bg-slate-50 border border-slate-200 text-slate-600">
                        {r.tipo.toLowerCase().replace(/_/g, ' ')} <strong className="tabular-nums">{eur(r.importo, 0)}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Sezione>
          )}

          {/* Acconti */}
          <Sezione titolo="Acconti e fatture" icona={Receipt}
                   sottotitolo={accontiKo.length ? `${accontiKo.length} da verificare` : 'tutti riconciliati'}>
            {accontiKo.length === 0 && (
              <p className="text-[13px] text-emerald-700 flex items-center gap-2 mb-3">
                <CheckCircle2 size={14}/> Ogni acconto scalato dalla notula ha la sua fattura, e gli importi tornano.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-1.5 font-medium">Data</th>
                    <th className="py-1.5 font-medium">Fattura</th>
                    <th className="py-1.5 font-medium text-right">Onorario</th>
                    <th className="py-1.5 font-medium text-right">Lordo atteso</th>
                    <th className="py-1.5 font-medium text-right">In fattura</th>
                    <th className="py-1.5 font-medium">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {acconti.map((a, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-1.5 text-slate-600">{dataIt(a.data_acconto)}</td>
                      <td className="py-1.5 font-mono text-[12px]">{a.numero_fattura || a.fattura_numero}</td>
                      <td className="py-1.5 text-right tabular-nums">{eur(a.onorario_notula)}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-400">{eur(a.lordo_atteso)}</td>
                      <td className="py-1.5 text-right tabular-nums">{eur(a.totale_fattura)}</td>
                      <td className="py-1.5">
                        <span className={`text-[11px] px-1.5 py-0.5 rounded ${a.stato === 'OK' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                          {a.stato}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              La notula scala l'acconto al netto; la fattura porta il lordo. Il confronto giusto è
              onorario × 1,04 di cassa previdenza × 1,22 di IVA.
            </p>
          </Sezione>

          {/* Pratiche per dipendente: il costo del turnover */}
          {pratiche.length > 0 && (
            <Sezione titolo="Pratiche del personale, per dipendente" icona={Users}
                     sottotitolo="assunzioni, proroghe, trasformazioni">
              <p className="text-[12px] text-slate-500 mb-3">
                Ogni movimento di contratto è una pratica che lo studio fattura. Questa tabella è, di fatto,
                il costo amministrativo del turnover.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-1.5 font-medium">Dipendente</th>
                      <th className="py-1.5 font-medium text-right">Pratiche</th>
                      <th className="py-1.5 font-medium text-right">Assunzioni</th>
                      <th className="py-1.5 font-medium text-right">Proroghe</th>
                      <th className="py-1.5 font-medium text-right">Costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pratiche.map((p, i) => (
                      <tr key={i} className="border-b border-slate-50">
                        <td className="py-1.5">{p.dipendente}</td>
                        <td className="py-1.5 text-right tabular-nums">{p.n_pratiche}</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-500">{p.assunzioni || '—'}</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-500">{p.proroghe || '—'}</td>
                        <td className="py-1.5 text-right tabular-nums font-medium">{eur(p.costo_totale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Sezione>
          )}

          {/* Le notule */}
          <Sezione titolo="Le notule" icona={FileText}
                   sottotitolo={`${notule.length} avvisi di parcella`} apertoDefault={false}>
            <p className="text-[12px] text-slate-500 mb-3">
              Portano <strong>tutte lo stesso numero</strong> e cambiano solo per data: sono riemissioni dello
              stesso conto corrente. Vale solo la più recente — sommarle triplicherebbe i numeri.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-1.5 font-medium">Data</th>
                    <th className="py-1.5 font-medium">N.</th>
                    <th className="py-1.5 font-medium text-right">Prestazioni</th>
                    <th className="py-1.5 font-medium text-right">Acconti</th>
                    <th className="py-1.5 font-medium text-right">Netto</th>
                    <th className="py-1.5 font-medium text-right">Righe</th>
                    <th className="py-1.5 font-medium text-right">Quadratura</th>
                  </tr>
                </thead>
                <tbody>
                  {notule.map(n => (
                    <tr key={n.id} className={`border-b border-slate-50 ${n.is_corrente ? 'bg-indigo-50/40' : ''}`}>
                      <td className="py-1.5">
                        {dataIt(n.data_avviso)}
                        {n.is_corrente && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">corrente</span>}
                      </td>
                      <td className="py-1.5 font-mono text-[12px]">{n.numero}</td>
                      <td className="py-1.5 text-right tabular-nums">{eur(n.tot_prestazioni)}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-500">{eur(n.acconti_scalati)}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">{eur(n.totale_netto)}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-400">{n.n_righe}</td>
                      <td className="py-1.5 text-right">
                        {Math.abs(parseFloat(n.sbilancio) || 0) < 0.005
                          ? <CheckCircle2 size={14} className="inline text-emerald-500"/>
                          : <span className="text-amber-700 tabular-nums">{eur(n.sbilancio)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Sezione>

          <p className="text-[11px] text-slate-400 pt-2 flex items-center gap-1.5">
            <Calendar size={11}/>
            I PDF originali stanno in <code>CRM 140Grammi/Commercialista</code>. Quando ne arriva uno nuovo va
            caricato: finché non lo è, questa pagina mostra il conto alla data dell'ultima notula.
          </p>
        </>
      )}
    </div>
  )
}
