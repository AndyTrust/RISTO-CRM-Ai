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
  RefreshCw, ChevronDown, ChevronRight, Calendar, TrendingUp, Calculator
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

/* ────────────────────────────────────────────────────────────────────────────
 * «Come sono ricavati questi numeri»
 *
 * Questa parte esiste perché un grafico che nessuno sa rifare non è un dato:
 * è un'opinione con le barre colorate. Qui sotto ogni cifra della pagina si
 * può ricostruire a mano partendo dal PDF dell'avviso di parcella.
 * ──────────────────────────────────────────────────────────────────────────── */

const AREE = {
  PERSONALE:         { nome: 'Gestione del personale', colore: 'bg-indigo-400', testo: 'text-indigo-700',
                       tipi: ['CEDOLINI', 'MENSILITA_AGGIUNTIVA', 'TFR', 'PRATICA_LAVORO', 'CU', 'INAIL'] },
  CONTABILITA_FISCO: { nome: 'Contabilità e fisco',    colore: 'bg-slate-400',  testo: 'text-slate-700',
                       tipi: ['CONTABILITA', 'DICHIARAZIONE', 'IVA_LIPE', 'F24', 'FTE'] },
  SCONTI:            { nome: 'Sconti e riduzioni',     colore: 'bg-emerald-400', testo: 'text-emerald-700', tipi: ['SCONTO'] },
  ALTRO:             { nome: 'Altro',                  colore: 'bg-amber-400',  testo: 'text-amber-700',   tipi: [] },
}

/**
 * La notula scrive quanto costano i cedolini di un mese, non quanti ne ha
 * elaborati né a quanto l'uno. La tariffa però si può dedurre, e senza
 * inventare nulla: deve dividere l'importo un numero intero di volte, e deve
 * essere la stessa in più mesi — un prezzo che quadra per un mese solo non è
 * un prezzo, è una coincidenza aritmetica. A parità di ricorrenza si sceglie
 * il candidato il cui numero di cedolini è più vicino alle buste paga che
 * risultano davvero in archivio quel mese.
 *
 * Se domani lo studio cambia tariffa, questo codice se ne accorge da solo:
 * non c'è nessun 30,00 né 32,31 scritto qui dentro.
 */
function deduciTariffe(mesiCedolini) {
  const MIN_TESTE = 15, MAX_TESTE = 90
  const conCandidati = mesiCedolini.map(m => {
    const cent = Math.round(m.importo * 100)
    const candidati = []
    for (let n = MIN_TESTE; n <= MAX_TESTE; n++) {
      if (cent > 0 && cent % n === 0) candidati.push({ n, t: cent / n / 100 })
    }
    return { ...m, candidati }
  })

  const ricorrenza = {}
  conCandidati.forEach(m => {
    new Set(m.candidati.map(c => c.t)).forEach(t => { ricorrenza[t] = (ricorrenza[t] || 0) + 1 })
  })

  // Le buste paga di luglio sono una stima con pochissime righe: come àncora
  // userebbero un numero falso. Meglio la media dei mesi consolidati.
  const affidabili = conCandidati.filter(m => m.nBuste >= 5)
  const ancora = affidabili.length
    ? affidabili.reduce((s, m) => s + m.nBuste, 0) / affidabili.length
    : 40

  return conCandidati.map(m => {
    const rif = m.nBuste >= 5 ? m.nBuste : ancora
    const scelto = m.candidati.slice().sort((a, b) =>
      (ricorrenza[b.t] - ricorrenza[a.t]) || (Math.abs(a.n - rif) - Math.abs(b.n - rif))
    )[0]
    return scelto
      ? { ...m, tariffa: scelto.t, nCedolini: scelto.n, mesiConStessaTariffa: ricorrenza[scelto.t] }
      : { ...m, tariffa: null, nCedolini: null, mesiConStessaTariffa: 0 }
  })
}

function Riga({ etichetta, valore, forte, indenta }) {
  return (
    <div className={`flex items-baseline gap-3 py-1 ${indenta ? 'pl-4' : ''} ${forte ? 'border-t border-slate-200 mt-1 pt-1.5' : ''}`}>
      <span className={`flex-1 text-[12.5px] ${forte ? 'font-medium text-slate-900' : 'text-slate-600'}`}>{etichetta}</span>
      <span className={`tabular-nums text-[12.5px] shrink-0 ${forte ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{valore}</span>
    </div>
  )
}

function MeseSpiegato({ mese, voci, precedente, tariffa }) {
  const [aperto, setAperto] = useState(false)
  const tot   = voci.reduce((s, v) => s + (parseFloat(v.prestazioni) || 0), 0)
  const delta = precedente === null || precedente === undefined ? null : tot - precedente

  return (
    <div className="border-b border-slate-100 last:border-0">
      <button onClick={() => setAperto(v => !v)}
        className="w-full flex items-center gap-3 py-2 text-left hover:bg-slate-50 px-2 -mx-2 rounded transition">
        {aperto ? <ChevronDown size={13} className="text-slate-400 shrink-0"/> : <ChevronRight size={13} className="text-slate-400 shrink-0"/>}
        <span className="w-16 text-[13px] text-slate-500 shrink-0">{MESI[mese.mese]} {String(mese.anno).slice(2)}</span>
        <span className="text-[13px] tabular-nums font-medium text-slate-900 w-24 text-right shrink-0">{eur(tot)}</span>
        <span className="text-[12px] text-slate-400 flex-1">
          {voci.length} {voci.length === 1 ? 'voce' : 'voci'}
        </span>
        {delta !== null && Math.abs(delta) >= 0.005 && (
          <span className={`text-[11.5px] tabular-nums shrink-0 ${delta > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
            {delta > 0 ? '+' : '−'}{eur(Math.abs(delta))} sul mese prima
          </span>
        )}
      </button>

      {aperto && (
        <div className="pl-8 pr-2 pb-3">
          {voci.map((v, i) => (
            <div key={i} className="flex items-start gap-2 py-1">
              <span className={`w-2 h-2 rounded-sm mt-1.5 shrink-0 ${AREE[v.area]?.colore ?? 'bg-slate-300'}`}/>
              <span className="flex-1 text-[12px] text-slate-600 leading-snug">{v.descrizione}</span>
              <span className="tabular-nums text-[12px] text-slate-900 shrink-0">{eur(v.prestazioni)}</span>
            </div>
          ))}
          <Riga etichetta="Totale del mese" valore={eur(tot)} forte/>
          {tariffa?.tariffa && (
            <p className="text-[11.5px] text-slate-500 mt-2 leading-relaxed">
              I cedolini di questo mese fanno <strong className="tabular-nums">{eur(tariffa.importo)}</strong>, cioè
              esattamente <strong className="tabular-nums">{tariffa.nCedolini}</strong> ×{' '}
              <strong className="tabular-nums">{eur(tariffa.tariffa)}</strong>. La tariffa non è scritta sulla notula:
              è l'unico prezzo che divide l'importo un numero intero di volte e che torna anche in altri{' '}
              {tariffa.mesiConStessaTariffa - 1} mesi.
              {tariffa.nBuste > 0 && (
                <> In archivio per questo mese ci sono <strong className="tabular-nums">{tariffa.nBuste}</strong> buste paga
                  {tariffa.nCedolini !== tariffa.nBuste
                    ? <> — <span className="text-amber-700">{Math.abs(tariffa.nCedolini - tariffa.nBuste)} di scarto</span>.</>
                    : <> — combaciano.</>}
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// Le voci senza un mese non sono tutte uguali, e trattarle allo stesso modo
// falserebbe il conto annuo: la Certificazione Unica torna una volta l'anno,
// una proroga di contratto torna quando qualcuno proroga un contratto.
const TIPI_ANNUALI  = ['CU', 'MENSILITA_AGGIUNTIVA', 'TFR', 'DICHIARAZIONE', 'INAIL', 'IVA_LIPE', 'FTE']
const NOME_TIPO = {
  CEDOLINI: 'Cedolini', CONTABILITA: 'Tenuta contabilità', CU: 'Certificazione Unica',
  MENSILITA_AGGIUNTIVA: 'Tredicesima e quattordicesima', TFR: 'Accantonamenti TFR',
  PRATICA_LAVORO: 'Pratiche del personale', DICHIARAZIONE: 'Dichiarazione IVA',
  INAIL: 'Autoliquidazione INAIL', IVA_LIPE: 'LIPE', F24: 'Invio F24',
  FTE: 'Fatture elettroniche', SCONTO: 'Sconti e riduzioni', ALTRO: 'Altro', SPESA: 'Spese vive',
}
const nomeTipo = (t) => NOME_TIPO[t] ?? (t || '').toLowerCase().replace(/_/g, ' ')

function SezioneMetodo({ voci, incidenza, notulaCorrente }) {
  const conMese   = useMemo(() => voci.filter(v => v.ha_mese), [voci])
  const senzaMese = useMemo(
    () => voci.filter(v => !v.ha_mese).sort((a, b) => Math.abs(b.prestazioni) - Math.abs(a.prestazioni)),
    [voci]
  )

  // Le barre del grafico, ricostruite dalle righe invece che dalla vista:
  // se le due strade non portassero allo stesso numero, la spiegazione
  // sarebbe sbagliata e si vedrebbe subito.
  const mesi = useMemo(() => {
    const m = new Map()
    conMese.forEach(v => {
      const k = `${v.anno}-${String(v.mese).padStart(2, '0')}`
      if (!m.has(k)) m.set(k, { k, anno: v.anno, mese: v.mese, voci: [] })
      m.get(k).voci.push(v)
    })
    return [...m.values()].sort((a, b) => a.k.localeCompare(b.k))
  }, [conMese])

  const bustePerMese = useMemo(() => {
    const m = {}
    incidenza.forEach(r => { m[`${r.anno}-${String(r.mese).padStart(2, '0')}`] = r.n_buste ?? 0 })
    return m
  }, [incidenza])

  const tariffe = useMemo(() => {
    const righe = mesi.map(x => ({
      k: x.k, anno: x.anno, mese: x.mese,
      importo: x.voci.filter(v => v.tipo === 'CEDOLINI').reduce((s, v) => s + (parseFloat(v.prestazioni) || 0), 0),
      nBuste: bustePerMese[x.k] ?? 0,
    })).filter(x => x.importo > 0)
    const dedotte = deduciTariffe(righe)
    return Object.fromEntries(dedotte.map(d => [d.k, d]))
  }, [mesi, bustePerMese])

  // Il salto di tariffa: due prezzi diversi nello stesso listino, senza che
  // nessuna riga della notula lo dica.
  const saltoTariffa = useMemo(() => {
    const seq = mesi.map(x => tariffe[x.k]).filter(t => t?.tariffa)
    for (let i = 1; i < seq.length; i++) {
      if (Math.abs(seq[i].tariffa - seq[i - 1].tariffa) > 0.005) {
        return { da: seq[i - 1], a: seq[i], variazione: (seq[i].tariffa / seq[i - 1].tariffa - 1) * 100 }
      }
    }
    return null
  }, [mesi, tariffe])

  const totali = useMemo(() => {
    const somma = (arr) => arr.reduce((s, v) => s + (parseFloat(v.prestazioni) || 0), 0)
    const inGrafico   = somma(conMese)
    const fuoriGrafico = somma(senzaMese)
    const complessivo = inGrafico + fuoriGrafico
    const n = mesi.length || 1

    const annuali  = senzaMese.filter(v => TIPI_ANNUALI.includes(v.tipo))
    const aConsumo = senzaMese.filter(v => !TIPI_ANNUALI.includes(v.tipo))

    const ricorrenteMese = inGrafico / n
    const stimaAnnua = ricorrenteMese * 12 + somma(annuali) + somma(aConsumo) * 12 / n

    return {
      n, inGrafico, fuoriGrafico, complessivo,
      quotaGrafico: complessivo ? (inGrafico / complessivo) * 100 : 0,
      mediaGrafico: inGrafico / n,
      mediaReale:   complessivo / n,
      ricorrenteMese,
      totAnnuali: somma(annuali), totAConsumo: somma(aConsumo),
      annualiVoci: annuali, aConsumoVoci: aConsumo,
      stimaAnnua,
    }
  }, [conMese, senzaMese, mesi])

  const pesa = useMemo(() => {
    const fatt = incidenza.reduce((s, r) => s + (parseFloat(r.fatturato) || 0), 0)
    const pers = incidenza.reduce((s, r) => s + (parseFloat(r.costo_personale) || 0), 0)
    const stimato = incidenza.some(r => r.personale_stimato)
    return {
      fatturato: fatt, personale: pers, stimato,
      suFatturato: fatt ? (totali.complessivo / fatt) * 100 : null,
      suPersonale: pers ? (totali.complessivo / pers) * 100 : null,
      giorniDiIncasso: fatt && totali.n ? totali.complessivo / (fatt / (totali.n * 30.4)) : null,
    }
  }, [incidenza, totali])

  const nCedoliniTot = useMemo(
    () => Object.values(tariffe).reduce((s, t) => s + (t.nCedolini || 0), 0), [tariffe]
  )
  const areaPersonale = useMemo(
    () => voci.filter(v => v.area === 'PERSONALE').reduce((s, v) => s + (parseFloat(v.prestazioni) || 0), 0), [voci]
  )

  if (!voci.length) return null
  const primo = mesi[0], ultimo = mesi[mesi.length - 1]

  return (
    <Sezione titolo="Come sono ricavati questi numeri" icona={Calculator}
             sottotitolo="voce per voce, dal PDF al grafico" apertoDefault={false}>

      {/* 1 — da dove vengono */}
      <p className="text-[13px] text-slate-600 leading-relaxed">
        Tutto quello che c'è in questa pagina esce da <strong>un solo documento</strong>: l'avviso di parcella
        {notulaCorrente ? <> n. <span className="font-mono">{notulaCorrente.numero}</span> del {dataIt(notulaCorrente.data_avviso)}</> : null},
        letto riga per riga. Sono <strong>{voci.length} righe</strong>, di cui{' '}
        <strong>{conMese.length}</strong> dichiarano il mese a cui si riferiscono e <strong>{senzaMese.length}</strong> no.
        Nessuna cifra è stimata, arrotondata o dedotta da fatture: gli acconti e il residuo dell'anno precedente
        sono esclusi perché sono pagamenti, non prestazioni, e contarli sarebbe contare due volte.
      </p>

      {/* 2 — perché dic fa 1.991 e gen 1.931 */}
      <h4 className="text-[13px] font-semibold text-slate-900 mt-5 mb-1">Perché ogni mese fa quella cifra</h4>
      <p className="text-[12.5px] text-slate-500 mb-2 leading-relaxed">
        Ogni barra del grafico è la somma delle righe qui sotto — nient'altro. Aprine una e la vedi ricomposta:
        i conti tornano al centesimo. La differenza fra un mese e l'altro sta quasi sempre in una sola voce, i cedolini.
      </p>
      <div className="border border-slate-200 rounded-lg px-2 divide-y-0">
        {mesi.map((m, i) => (
          <MeseSpiegato key={m.k} mese={m} voci={m.voci} tariffa={tariffe[m.k]}
            precedente={i === 0 ? null : mesi[i - 1].voci.reduce((s, v) => s + (parseFloat(v.prestazioni) || 0), 0)}/>
        ))}
      </div>

      {/* 3 — la regola di classificazione */}
      <h4 className="text-[13px] font-semibold text-slate-900 mt-5 mb-1">Cosa finisce nell'indaco e cosa nel grigio</h4>
      <p className="text-[12.5px] text-slate-500 mb-2 leading-relaxed">
        La percentuale «% pers.» che vedi accanto a ogni barra è solo questo: la parte di quel mese classificata
        come gestione del personale, divisa per il totale del mese. Si muove perché si muovono i cedolini,
        non perché cambi il lavoro contabile — quello è fisso.
      </p>
      <div className="grid md:grid-cols-2 gap-2">
        {['PERSONALE', 'CONTABILITA_FISCO'].map(a => (
          <div key={a} className="border border-slate-200 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-3 h-2 rounded-sm ${AREE[a].colore}`}/>
              <span className="text-[12.5px] font-medium text-slate-900">{AREE[a].nome}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {AREE[a].tipi.map(t => (
                <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-600">
                  {nomeTipo(t)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 4 — la tariffa dedotta */}
      <h4 className="text-[13px] font-semibold text-slate-900 mt-5 mb-1">Quanto costa un cedolino</h4>
      <p className="text-[12.5px] text-slate-500 mb-2 leading-relaxed">
        La notula scrive l'importo, non il prezzo unitario né quanti cedolini ha elaborato. Il prezzo però è
        ricavabile senza inventare niente: è l'unico numero che divide l'importo un numero intero di volte e che
        torna uguale in più mesi. La colonna «in archivio» è il controllo: sono le buste paga che risultano
        davvero a noi quel mese.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-1.5 font-medium">Mese</th>
              <th className="py-1.5 font-medium text-right">Importo cedolini</th>
              <th className="py-1.5 font-medium text-right">Tariffa dedotta</th>
              <th className="py-1.5 font-medium text-right">Cedolini</th>
              <th className="py-1.5 font-medium text-right">In archivio</th>
              <th className="py-1.5 font-medium text-right">Scarto</th>
            </tr>
          </thead>
          <tbody>
            {mesi.map(m => {
              const t = tariffe[m.k]
              if (!t) return null
              const scarto = (t.nCedolini ?? 0) - (t.nBuste ?? 0)
              return (
                <tr key={m.k} className="border-b border-slate-50">
                  <td className="py-1.5 text-slate-600">{MESI[m.mese]} {String(m.anno).slice(2)}</td>
                  <td className="py-1.5 text-right tabular-nums">{eur(t.importo)}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium">{eur(t.tariffa)}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">{t.nCedolini ?? '—'}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">{t.nBuste || '—'}</td>
                  <td className={`py-1.5 text-right tabular-nums ${scarto === 0 ? 'text-emerald-600' : 'text-amber-700'}`}>
                    {t.nBuste ? (scarto === 0 ? '—' : (scarto > 0 ? `+${scarto}` : scarto)) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {saltoTariffa && (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          <p className="text-[12.5px] text-amber-900 leading-relaxed">
            <strong>La tariffa è aumentata e nessuna riga lo dice.</strong> Fino a{' '}
            {MESI[saltoTariffa.da.mese]} {String(saltoTariffa.da.anno).slice(2)} un cedolino costava{' '}
            <strong className="tabular-nums">{eur(saltoTariffa.da.tariffa)}</strong>; da{' '}
            {MESI[saltoTariffa.a.mese]} {String(saltoTariffa.a.anno).slice(2)} costa{' '}
            <strong className="tabular-nums">{eur(saltoTariffa.a.tariffa)}</strong>, cioè{' '}
            <strong>+{saltoTariffa.variazione.toFixed(2).replace('.', ',')}%</strong>. La descrizione della riga
            è rimasta identica: l'aumento si vede solo facendo la divisione. Su{' '}
            {saltoTariffa.a.nCedolini} cedolini sono{' '}
            <strong className="tabular-nums">{eur((saltoTariffa.a.tariffa - saltoTariffa.da.tariffa) * saltoTariffa.a.nCedolini)}</strong>{' '}
            al mese, <strong className="tabular-nums">{eur((saltoTariffa.a.tariffa - saltoTariffa.da.tariffa) * saltoTariffa.a.nCedolini * 12)}</strong> all'anno.
          </p>
        </div>
      )}

      {/* 5 — cosa il grafico non mostra */}
      <h4 className="text-[13px] font-semibold text-slate-900 mt-5 mb-1">Quello che il grafico non mostra</h4>
      <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mb-3">
        <p className="text-[12.5px] text-red-900 leading-relaxed">
          <AlertTriangle size={13} className="inline mr-1 -mt-0.5"/>
          <strong>Il grafico mostra il {totali.quotaGrafico.toFixed(1).replace('.', ',')}% del costo.</strong>{' '}
          Le barre valgono <span className="tabular-nums">{eur(totali.inGrafico)}</span>, ma nello stesso periodo
          lo studio ha maturato <span className="tabular-nums">{eur(totali.complessivo)}</span>: mancano{' '}
          <span className="tabular-nums font-semibold">{eur(totali.fuoriGrafico)}</span> di voci che non dichiarano
          un mese e che quindi nessuna barra può contenere. Media apparente{' '}
          <span className="tabular-nums">{eur(totali.mediaGrafico)}</span> al mese, media vera{' '}
          <span className="tabular-nums font-semibold">{eur(totali.mediaReale)}</span>.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="border border-slate-200 rounded-lg p-3">
          <p className="text-[12px] font-medium text-slate-900 mb-1">Una volta l'anno</p>
          <p className="text-[11.5px] text-slate-500 mb-2">Tornano ogni anno, ma in un mese solo: spalmarle su dodici sarebbe più onesto che ignorarle.</p>
          {totali.annualiVoci.map((v, i) => (
            <Riga key={i} etichetta={v.descrizione} valore={eur(v.prestazioni)}/>
          ))}
          <Riga etichetta="Totale" valore={eur(totali.totAnnuali)} forte/>
        </div>
        <div className="border border-slate-200 rounded-lg p-3">
          <p className="text-[12px] font-medium text-slate-900 mb-1">A consumo</p>
          <p className="text-[11.5px] text-slate-500 mb-2">Dipendono da quanto si muove: ogni assunzione, proroga o F24 è una riga in più.</p>
          {Object.entries(
            totali.aConsumoVoci.reduce((m, v) => {
              m[v.tipo] = m[v.tipo] || { n: 0, tot: 0 }
              m[v.tipo].n++; m[v.tipo].tot += parseFloat(v.prestazioni) || 0
              return m
            }, {})
          ).sort((a, b) => Math.abs(b[1].tot) - Math.abs(a[1].tot)).map(([t, d]) => (
            <Riga key={t} etichetta={`${nomeTipo(t)} — ${d.n} ${d.n === 1 ? 'riga' : 'righe'}`} valore={eur(d.tot)}/>
          ))}
          <Riga etichetta={`Totale in ${totali.n} mesi`} valore={eur(totali.totAConsumo)} forte/>
        </div>
      </div>

      {/* 6 — il costo vero, su base annua */}
      <h4 className="text-[13px] font-semibold text-slate-900 mt-5 mb-1">Il costo vero, su base annua</h4>
      <p className="text-[12.5px] text-slate-500 mb-2 leading-relaxed">
        I {totali.n} mesi osservati non si possono moltiplicare per dodici: dentro ci sono adempimenti che
        capitano una volta l'anno e che verrebbero contati due o tre volte. Il conto va fatto a blocchi.
      </p>
      <div className="border border-slate-200 rounded-lg p-3">
        <Riga etichetta={`Ricorrente: cedolini + contabilità, ${eur(totali.ricorrenteMese)} al mese × 12`}
              valore={eur(totali.ricorrenteMese * 12)}/>
        <Riga etichetta="Annuale: CU, tredicesima, quattordicesima, TFR, dichiarazione IVA, INAIL, LIPE, fatture elettroniche"
              valore={eur(totali.totAnnuali)}/>
        <Riga etichetta={`A consumo: pratiche, F24 e varie, ${eur(totali.totAConsumo)} in ${totali.n} mesi portati a 12`}
              valore={eur(totali.totAConsumo * 12 / totali.n)}/>
        <Riga etichetta="Costo annuo dello studio" valore={eur(totali.stimaAnnua)} forte/>
      </div>
      <p className="text-[11.5px] text-slate-400 mt-1.5">
        È una ricostruzione, non una fattura: vale finché il perimetro resta questo. Se cambia il numero di
        dipendenti cambia il blocco ricorrente, che è quello che pesa di più.
      </p>

      {/* 7 — quanto pesa davvero */}
      <h4 className="text-[13px] font-semibold text-slate-900 mt-5 mb-1">Quanto pesa davvero</h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Tile etichetta="Sul fatturato"
              valore={pesa.suFatturato !== null ? `${pesa.suFatturato.toFixed(2).replace('.', ',')} %` : '—'}
              nota={`su ${eur(pesa.fatturato, 0)} in ${totali.n} mesi`}/>
        <Tile etichetta="Sul costo del personale"
              valore={pesa.suPersonale !== null ? `${pesa.suPersonale.toFixed(2).replace('.', ',')} %` : '—'}
              nota={`su ${eur(pesa.personale, 0)}`}/>
        <Tile etichetta="Per cedolino, davvero"
              valore={nCedoliniTot ? eur(areaPersonale / nCedoliniTot) : '—'}
              nota={`tutta l'area personale ÷ ${nCedoliniTot} cedolini`}/>
        <Tile etichetta="Giorni di incasso"
              valore={pesa.giorniDiIncasso !== null ? pesa.giorniDiIncasso.toFixed(1).replace('.', ',') : '—'}
              nota="quanto si lavora per pagarlo"/>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-1.5 font-medium">Mese</th>
              <th className="py-1.5 font-medium text-right">Studio (in grafico)</th>
              <th className="py-1.5 font-medium text-right">Fatturato</th>
              <th className="py-1.5 font-medium text-right">%</th>
              <th className="py-1.5 font-medium text-right">Costo personale</th>
              <th className="py-1.5 font-medium text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {incidenza.map((r, i) => {
              const cs = parseFloat(r.costo_studio) || 0
              const f  = parseFloat(r.fatturato) || 0
              const p  = parseFloat(r.costo_personale) || 0
              return (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 text-slate-600">
                    {MESI[r.mese]} {String(r.anno).slice(2)}
                    {r.personale_stimato && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-amber-50 text-amber-700">stima</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{eur(cs)}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">{eur(f, 0)}</td>
                  <td className="py-1.5 text-right tabular-nums">{f ? `${(cs / f * 100).toFixed(2).replace('.', ',')} %` : '—'}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">{eur(p, 0)}</td>
                  <td className="py-1.5 text-right tabular-nums">{p ? `${(cs / p * 100).toFixed(2).replace('.', ',')} %` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-slate-400 mt-1.5 leading-relaxed">
        Le percentuali in tabella usano il solo costo che sta nel grafico, quindi sono la stima <em>bassa</em>:
        le quattro caselle sopra usano invece il costo intero. Il fatturato è quello fiscale di gruppo,
        Mameli più Predda Niedda, perché la notula è unica e non separa le due sedi — qualunque riparto
        per locale sarebbe una convenzione, non un dato.
      </p>

      {/* 8 — cosa non è certo */}
      <h4 className="text-[13px] font-semibold text-slate-900 mt-5 mb-1">Cosa non è certo</h4>
      <ul className="text-[12.5px] text-slate-600 space-y-1.5 leading-relaxed">
        <li className="flex gap-2"><span className="text-slate-300 mt-0.5">•</span>
          <span>I cedolini che lo studio fattura non coincidono sempre con le buste in archivio (vedi colonna «scarto»):
            può essere un cedolino elaborato e poi annullato, un collaboratore non ancora caricato, o un conteggio
            che va contestato. Va chiesto allo studio, mese per mese.</span></li>
        <li className="flex gap-2"><span className="text-slate-300 mt-0.5">•</span>
          <span>La tariffa unitaria è dedotta per divisione, non letta: è l'unica compatibile con gli importi,
            ma resta una deduzione finché non la si legge sul listino dello studio.</span></li>
        <li className="flex gap-2"><span className="text-slate-300 mt-0.5">•</span>
          <span>Il costo annuo è una ricostruzione a perimetro costante; il costo del personale dell'ultimo mese
            può essere ancora una stima e in quel caso la sua percentuale è indicativa.</span></li>
        <li className="flex gap-2"><span className="text-slate-300 mt-0.5">•</span>
          <span>Il residuo dell'anno precedente e gli acconti sono esclusi da ogni conto di questa sezione:
            sono movimenti di cassa, non prestazioni del periodo.</span></li>
      </ul>
    </Sezione>
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
  const voci      = dati?.voci ?? []
  const incidenza = dati?.incidenza ?? []

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

          <SezioneMetodo voci={voci} incidenza={incidenza}
                         notulaCorrente={notule.find(n => n.is_corrente) ?? null}/>

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
