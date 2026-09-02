/**
 * Riconciliazione bancaria — l'estratto conto contro il CRM.
 *
 * A COSA SERVE
 * Il CRM sa quanto DOVEVA entrare e uscire: gli incassi dalla giornaliera, i
 * pagamenti dal registro fornitori, gli F24, gli stipendi, le rate, i costi
 * fissi. L'estratto conto e' l'unica fonte che dice quanto e' entrato e uscito
 * DAVVERO. Finche' i due numeri non si guardano in faccia, una fattura pagata
 * due volte o un incasso mai arrivato in banca non li vede nessuno.
 *
 * COME LEGGERLA
 * Ogni riga e' una categoria: a sinistra la banca, a destra il CRM, in mezzo lo
 * scarto. Uno scarto non e' di per se' un errore — su alcune voci e' fisiologico
 * e sotto ognuna c'e' scritto perche'. Sono gli scarti GRANDI, e quelli che
 * crescono di mese in mese, a voler dire qualcosa.
 *
 * PERCHE' GLI IMPORTI SONO TUTTI POSITIVI
 * Il verso lo da' la categoria, non il segno. Confrontare un -12.000 di banca
 * con un +12.000 di CRM produrrebbe scarti di 24.000 che sembrano voragini e
 * sono solo un segno girato.
 *
 * DA DOVE ARRIVANO I MOVIMENTI
 * Dalla cartella "ESTRATTI CONTO" dentro CRM 140Grammi: si lascia li' il file
 * scaricato dall'home banking e lo script sul PC lo legge entro un minuto.
 * Questa pagina non carica niente: mostra quello che c'e'.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  Landmark, RefreshCw, ChevronDown, ChevronRight, Info, AlertTriangle,
  ArrowDownLeft, ArrowUpRight, FolderOpen, Tag,
} from 'lucide-react'
import { riconciliazioneApi } from '../api/supabase-client'
import { useAggiornamento } from '../lib/aggiornamento'
import PageAssistant from '../components/PageAssistant'

const eur = (v, dec = 2) => {
  const n = v === null || v === undefined || v === '' ? null : parseFloat(v)
  if (n === null || Number.isNaN(n)) return '—'
  return n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' €'
}
const MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno',
              'luglio','agosto','settembre','ottobre','novembre','dicembre']
const meseLabel = iso => {
  if (!iso) return '—'
  const [a, m] = String(iso).slice(0, 7).split('-')
  return `${MESI[parseInt(m, 10) - 1]} ${a}`
}
const dataIt = d => d
  ? new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
  : '—'

// Perche' uno scarto su questa voce puo' essere normale. Scriverlo sotto il
// numero evita la caccia al fantasma: senza questa riga, ogni differenza
// sembra un errore da inseguire.
const PERCHE = {
  incassi_pos: 'Il POS accredita a giorni di distanza e al netto delle commissioni: a cavallo di fine mese uno scarto c\'è sempre.',
  versamenti_contanti: 'Il CRM conta i contanti incassati, la banca solo quelli portati in filiale. Quello che resta in cassa non c\'è.',
  delivery: 'Deliveroo e Glovo pagano a periodi loro, trattenendo la provvigione: il netto in banca è sempre più basso del lordo del foglio.',
  fornitori: 'Il CRM registra il pagamento alla data del foglio, la banca alla data di valuta. Assegni e RiBa slittano.',
  stipendi: 'Il CRM ha i netti in busta; in banca esce il bonifico, che può includere acconti o rimborsi spese.',
  f24_imposte: 'Il CRM legge le deleghe per scadenza, la banca per addebito effettivo: F24 a fine mese cadono nel mese dopo.',
  rate_finanziamenti: 'Rate segnate come pagate nel CRM contro addebiti veri: se non torna, una rata non è partita.',
  costi_fissi_utenze: 'I costi fissi sono pianificati, non consuntivati: lo scarto qui dice quanto la pianificazione è lontana dal vero.',
  commissioni_banca: 'Nessuna voce del CRM copre gli oneri bancari: sono un costo che finora nessuno registrava.',
  incassi_ticket: 'Edenred e Pellegrini pagano i buoni pasto a settimane di distanza: il ritardo qui è la norma, non un ammanco.',
  giroconti_entrata: 'Spostamenti fra conti propri. Non sono ricavi: restano fuori dal confronto, ma si mostrano perché sono la voce più grossa di tutte.',
  giroconti_uscita: 'Spostamenti fra conti propri. Non sono costi: entrata su un conto e uscita sull\'altro si annullano.',
  spese_carta: 'Spesa fatta con la carta, dal supermercato al fornitore sotto casa. Non passa dal registro fatture e non ci puo\' passare: sta qui da sola perche\' tenerla fra i fornitori faceva sembrare la banca piu\' alta del CRM.',
  commercialista: 'Acconti sull\'avviso di parcella dello studio. Non sono fatture fornitore: il costo vero dello studio sta nella sezione Commercialista, dove gli acconti vengono scalati.',
  da_classificare: 'Movimenti che le regole non sanno leggere. Vanno assegnati a mano: finché sono qui, i totali sotto sono incompleti.',
}

export default function Riconciliazione() {
  const { versione } = useAggiornamento()
  const [saldi, setSaldi] = useState([])
  const [righe, setRighe] = useState([])
  const [categorie, setCategorie] = useState([])
  const [mese, setMese] = useState(null)
  const [aperta, setAperta] = useState(null)
  const [movimenti, setMovimenti] = useState([])
  const [caricando, setCaricando] = useState(true)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    let vivo = true
    setCaricando(true)
    Promise.all([riconciliazioneApi.saldi(), riconciliazioneApi.categorie()])
      .then(([s, c]) => {
        if (!vivo) return
        setSaldi(s); setCategorie(c)
        setMese(m => m || ([...new Set(s.map(x => x.mese))].sort().reverse()[0] ?? null))
      })
      .catch(e => vivo && setErrore(e.message))
      .finally(() => vivo && setCaricando(false))
    return () => { vivo = false }
  }, [versione])

  useEffect(() => {
    if (!mese) { setRighe([]); return }
    let vivo = true
    riconciliazioneApi.mensile(mese)
      .then(r => vivo && setRighe(r))
      .catch(e => vivo && setErrore(e.message))
    setAperta(null)
    return () => { vivo = false }
  }, [mese, versione])

  const apri = async cat => {
    if (aperta === cat) { setAperta(null); return }
    setAperta(cat)
    try { setMovimenti(await riconciliazioneApi.movimenti({ mese, categoria: cat })) }
    catch (e) { setErrore(e.message) }
  }

  const riclassifica = async (impronta, categoria) => {
    try {
      await riconciliazioneApi.riclassifica(impronta, categoria)
      setMovimenti(await riconciliazioneApi.movimenti({ mese, categoria: aperta }))
      setRighe(await riconciliazioneApi.mensile(mese))
      setSaldi(await riconciliazioneApi.saldi())
    } catch (e) { setErrore(e.message) }
  }

  // I conti sono tre. Il confronto col CRM si fa sul totale — il CRM non sa da
  // quale conto sia uscito un pagamento — ma i saldi restano per conto, perche'
  // sommarli darebbe un numero che nessun estratto conto conferma.
  const mesiDisponibili = useMemo(
    () => [...new Set(saldi.map(s => s.mese))].sort().reverse(), [saldi])
  const contiDelMese = useMemo(
    () => saldi.filter(s => s.mese === mese), [saldi, mese])
  const saldoMese = useMemo(() => {
    if (!contiDelMese.length) return null
    const somma = k => contiDelMese.reduce((t, s) => t + (parseFloat(s[k]) || 0), 0)
    return {
      entrate: somma('entrate'), uscite: somma('uscite'),
      saldo_periodo: somma('saldo_periodo'), saldo_finale: somma('saldo_finale'),
      movimenti: contiDelMese.reduce((t, s) => t + (s.movimenti || 0), 0),
      da_classificare: contiDelMese.reduce((t, s) => t + (s.da_classificare || 0), 0),
    }
  }, [contiDelMese])
  const entrate = righe.filter(r => r.segno === 'E')
  const uscite  = righe.filter(r => r.segno === 'U')

  if (caricando) {
    return <div className="p-6 text-slate-500">Carico la riconciliazione…</div>
  }

  // Nessun movimento: la pagina esiste ma non ha niente da dire. Meglio
  // spiegare come alimentarla che mostrare una tabella vuota.
  if (!saldi.length) {
    return (
      <div className="p-6 max-w-3xl">
        <Intestazione />
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6">
          <div className="flex items-start gap-3">
            <FolderOpen size={22} className="text-slate-400 mt-0.5 shrink-0" />
            <div className="text-sm text-slate-700 space-y-3">
              <p className="font-medium text-slate-900">Non c'è ancora nessun estratto conto.</p>
              <p>
                Scarica dall'home banking il movimento conto in CSV o Excel e lascia il file
                nella cartella <code className="px-1 py-0.5 bg-white rounded border">CRM 140Grammi\ESTRATTI CONTO</code> sul
                PC dell'amministrazione. Non serve rinominarlo né aprirlo: entro un minuto
                lo script lo legge e questa pagina si popola.
              </p>
              <p className="text-slate-500">
                Le colonne vengono riconosciute per nome, non per posizione: data, causale e
                importo bastano, che l'importo stia in una colonna sola col segno o in due
                separate (Dare/Avere, Entrate/Uscite, Addebiti/Accrediti).
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Intestazione />
        <select
          value={mese ?? ''}
          onChange={e => setMese(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
        >
          {mesiDisponibili.map(m => <option key={m} value={m}>{meseLabel(m)}</option>)}
        </select>
      </div>

      {errore && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 text-sm">
          {errore}
        </div>
      )}

      {saldoMese && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tessera etichetta="Entrate in banca" valore={saldoMese.entrate}
                   icona={<ArrowDownLeft size={16} className="text-emerald-600" />} />
          <Tessera etichetta="Uscite dalla banca" valore={saldoMese.uscite}
                   icona={<ArrowUpRight size={16} className="text-rose-600" />} />
          <Tessera etichetta="Saldo del periodo" valore={saldoMese.saldo_periodo} evidenzia />
          <Tessera etichetta="Saldo a fine mese" valore={saldoMese.saldo_finale}
                   nota={`${saldoMese.movimenti} movimenti`} />
        </div>
      )}

      {contiDelMese.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs text-slate-500 mb-2">Saldo a fine mese, conto per conto</div>
          <div className="grid sm:grid-cols-3 gap-3">
            {contiDelMese.map(c => (
              <div key={c.conto} className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-slate-600">{c.conto.replace(/_/g, ' ')}</span>
                <span className="text-sm font-medium tabular-nums text-slate-900">{eur(c.saldo_finale)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {saldoMese?.da_classificare > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>{saldoMese.da_classificare} movimenti</strong> non sono stati riconosciuti dalle
            regole. Finché restano lì, i totali per categoria qui sotto sono incompleti:
            aprili in fondo alla pagina e assegnali. La scelta che fai resta anche se il
            file viene ricaricato.
          </span>
        </div>
      )}

      <Blocco titolo="Entrate" righe={entrate} aperta={aperta} apri={apri}
              movimenti={movimenti} categorie={categorie} riclassifica={riclassifica} />
      <Blocco titolo="Uscite"  righe={uscite}  aperta={aperta} apri={apri}
              movimenti={movimenti} categorie={categorie} riclassifica={riclassifica} />

      <PageAssistant
        pagina="Riconciliazione bancaria"
        suggerimenti={[
          "Quale voce si scosta di piu' dalla banca questo mese?",
          "Quanto ho pagato di commissioni bancarie quest'anno?",
          "Gli incassi POS in banca tornano con quelli del foglio?",
          "Quanto trattengono davvero Deliveroo e Glovo?",
          "Ci sono uscite in banca che il CRM non conosce?",
          "Come si e' mosso il saldo negli ultimi sei mesi?",
        ]}
      />
    </div>
  )
}

function Intestazione() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
        <Landmark size={22} className="text-slate-400" /> Riconciliazione bancaria
      </h1>
      <p className="text-sm text-slate-500 mt-1 max-w-2xl">
        Quello che la banca dice sia entrato e uscito, contro quello che il CRM dice
        sarebbe dovuto entrare e uscire. Mese per mese, voce per voce.
      </p>
    </div>
  )
}

function Tessera({ etichetta, valore, icona, nota, evidenzia }) {
  const n = parseFloat(valore)
  const colore = evidenzia ? (n >= 0 ? 'text-emerald-700' : 'text-rose-700') : 'text-slate-900'
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs text-slate-500 flex items-center gap-1.5">{icona}{etichetta}</div>
      <div className={`text-xl font-semibold mt-1 tabular-nums ${colore}`}>{eur(valore)}</div>
      {nota && <div className="text-xs text-slate-400 mt-0.5">{nota}</div>}
    </div>
  )
}

function Blocco({ titolo, righe, aperta, apri, movimenti, categorie, riclassifica }) {
  if (!righe.length) return null
  const tot = righe.reduce((s, r) => s + (parseFloat(r.importo_banca) || 0), 0)
  return (
    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-baseline justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
        <h2 className="font-medium text-slate-900">{titolo}</h2>
        <span className="text-sm text-slate-500 tabular-nums">{eur(tot)} in banca</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-100">
              <th className="text-left font-medium px-4 py-2">Voce</th>
              <th className="text-right font-medium px-4 py-2">Banca</th>
              <th className="text-right font-medium px-4 py-2">CRM</th>
              <th className="text-right font-medium px-4 py-2">Scarto</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {righe.map(r => {
              const scarto = r.scarto === null ? null : parseFloat(r.scarto)
              const grande = scarto !== null && Math.abs(scarto) > 500
              return (
                <React.Fragment key={r.categoria}>
                  <tr
                    onClick={() => apri(r.categoria)}
                    className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer align-top"
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-800">{r.etichetta}</div>
                      {PERCHE[r.categoria] && (
                        <div className="text-xs text-slate-400 mt-0.5 max-w-lg">{PERCHE[r.categoria]}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">
                      {eur(r.importo_banca)}
                      {r.movimenti ? <div className="text-xs text-slate-400">{r.movimenti} mov.</div> : null}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {r.importo_crm === null
                        ? <span className="text-slate-300">nessuna voce</span>
                        : eur(r.importo_crm)}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                      scarto === null ? 'text-slate-300'
                        : grande ? 'text-amber-700' : 'text-slate-500'}`}>
                      {scarto === null ? '—' : eur(scarto)}
                      {r.scarto_pct !== null && r.scarto_pct !== undefined && (
                        <div className="text-xs font-normal text-slate-400">{r.scarto_pct}%</div>
                      )}
                    </td>
                    <td className="px-2 text-slate-400">
                      {aperta === r.categoria ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </td>
                  </tr>
                  {aperta === r.categoria && (
                    <tr>
                      <td colSpan={5} className="bg-slate-50/70 px-4 py-3">
                        <Movimenti righe={movimenti} categorie={categorie} riclassifica={riclassifica} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Movimenti({ righe, categorie, riclassifica }) {
  if (!righe.length) return <div className="text-sm text-slate-500">Nessun movimento.</div>
  return (
    <table className="w-full text-sm">
      <tbody>
        {righe.map(m => (
          <tr key={m.impronta} className="border-b border-slate-200/60 last:border-0">
            <td className="py-1.5 pr-3 text-slate-500 whitespace-nowrap w-16">{dataIt(m.data_contabile)}</td>
            <td className="py-1.5 pr-3 text-slate-700">
                        {/* Chi c'e' dall'altra parte lo dicono le anagrafiche del CRM:
                            le buste paga per le persone, il foglio FORNITORI per le
                            ditte. Se qui non c'e' un nome, quel movimento e' uscito
                            verso qualcuno che il CRM non conosce - ed e' proprio
                            quello che vale la pena guardare. */}
                        {m.controparte && (
                          <span className="inline-block mr-2 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-medium">
                            {m.controparte}
                          </span>
                        )}
                        {m.descrizione}
                      </td>
            <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap w-28">
              {eur(Math.abs(parseFloat(m.importo)))}
            </td>
            <td className="py-1.5 w-52">
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                <Tag size={12} />
                <select
                  value={m.categoria ?? ''}
                  onChange={e => riclassifica(m.impronta, e.target.value)}
                  className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700 w-full"
                >
                  {categorie.map(c => (
                    <option key={c.codice} value={c.codice}>{c.etichetta}</option>
                  ))}
                </select>
              </label>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
