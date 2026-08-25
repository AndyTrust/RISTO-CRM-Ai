import React from 'react'
import { AlertTriangle, AlertOctagon, CalendarClock, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react'
import { scadenzarioApi } from '../api/supabase-client'

/**
 * Avvisi — quello che va detto prima che diventi un danno.
 *
 * PERCHE' ESISTE
 * Una rata saltata non si vedeva. Non perche' mancasse la pagina, ma perche'
 * mancava la nozione: il CRM dava per versata ogni rata con la scadenza alle
 * spalle, quindi il giorno in cui l'azienda non pagava continuava a dire che
 * aveva pagato. Cambiata la regola (ora una rata e' versata se l'addebito
 * mensile risulta sul foglio, non se e' passata la data), quel fatto e'
 * diventato osservabile — e qui viene mostrato.
 *
 * IL TESTO NON STA QUI
 * Le frasi arrivano gia' scritte dalla vista v_avvisi. Le legge anche il
 * controllo del mattino che manda notifica ed email: se la frase la scrivesse
 * il frontend, la notifica direbbe una cosa e lo schermo un'altra.
 *
 * TRE GRAVITA'
 *   1 — soldi che non sono usciti quando dovevano. Rosso, sempre aperto.
 *   2 — scaduto ma spiegabile, oppure i dati si sono fermati. Ambra, aperto.
 *   3 — in arrivo nei prossimi quindici giorni. Chiuso di default: e' un
 *       promemoria, non un allarme, e un allarme che suona sempre non e' un
 *       allarme.
 *
 * Quando non c'e' niente lo dice, invece di sparire: una fascia assente non
 * distingue "tutto a posto" da "il controllo non ha girato".
 */

const sedeLabel = (s) => (s === 'MA' ? 'Mameli' : s === 'PN' ? 'Predda Niedda' : s === 'TUTTE' ? '' : s || '')

export default function Avvisi({ scuro = false, compatto = false }) {
  const [righe, setRighe] = React.useState(null)   // null = non ancora letto
  const [errore, setErrore] = React.useState(null)
  const [apriInArrivo, setApriInArrivo] = React.useState(false)

  React.useEffect(() => {
    let vivo = true
    scadenzarioApi.avvisi()
      .then((r) => { if (vivo) { setRighe(r); setErrore(null) } })
      .catch((e) => { if (vivo) setErrore(e.message) })
    return () => { vivo = false }
  }, [])

  if (errore) {
    return (
      <div className={`rounded-xl border px-4 py-3 text-sm ${
        scuro ? 'border-rose-700/50 bg-rose-900/20 text-rose-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
        Non riesco a leggere gli avvisi: {errore}
      </div>
    )
  }
  if (righe === null) return null

  const gravi   = righe.filter((r) => r.gravita === 1)
  const attenti = righe.filter((r) => r.gravita === 2)
  const arrivo  = righe.filter((r) => r.gravita === 3)

  if (!righe.length) {
    if (compatto) return null
    return (
      <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] ${
        scuro ? 'border-emerald-800/40 bg-emerald-900/10 text-emerald-300'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
        <ShieldCheck size={15} />
        Nessuna rata saltata e nessuna scadenza nei prossimi quindici giorni.
      </div>
    )
  }

  const Blocco = ({ lista, tono, Icona, titolo }) => {
    if (!lista.length) return null
    const c = tono === 'rosso'
      ? (scuro ? 'border-rose-700/60 bg-rose-900/25' : 'border-red-300 bg-red-50')
      : (scuro ? 'border-amber-700/60 bg-amber-900/20' : 'border-amber-300 bg-amber-50')
    const testo = tono === 'rosso'
      ? (scuro ? 'text-rose-100' : 'text-red-900')
      : (scuro ? 'text-amber-100' : 'text-amber-900')
    const sotto = tono === 'rosso'
      ? (scuro ? 'text-rose-200/80' : 'text-red-800/80')
      : (scuro ? 'text-amber-200/80' : 'text-amber-800/80')
    return (
      <div className={`rounded-xl border px-4 py-3 ${c}`}>
        <p className={`text-sm font-semibold flex items-center gap-2 ${testo}`}>
          <Icona size={15} /> {titolo}
        </p>
        <ul className="mt-2 space-y-1.5">
          {lista.map((r) => (
            <li key={r.chiave} className={`text-[13px] leading-relaxed ${sotto}`}>
              <span className={`font-medium ${testo}`}>{r.titolo}</span>
              {sedeLabel(r.sede) && <span className="opacity-70"> · {sedeLabel(r.sede)}</span>}
              <br />
              {r.dettaglio}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Blocco lista={gravi}   tono="rosso" Icona={AlertOctagon}
              titolo={gravi.length === 1 ? 'Una rata non risulta pagata' : `${gravi.length} rate non risultano pagate`} />
      <Blocco lista={attenti} tono="ambra" Icona={AlertTriangle}
              titolo={attenti.length === 1 ? 'Una cosa da controllare' : `${attenti.length} cose da controllare`} />

      {arrivo.length > 0 && (
        <div className={`rounded-xl border ${scuro ? 'border-gray-700/60 bg-gray-800/30' : 'border-gray-200 bg-gray-50'}`}>
          <button
            onClick={() => setApriInArrivo((v) => !v)}
            className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-[13px] ${
              scuro ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
          >
            <span className="flex items-center gap-2">
              <CalendarClock size={14} />
              {arrivo.length === 1 ? 'Una scadenza' : `${arrivo.length} scadenze`} nei prossimi quindici giorni
            </span>
            {apriInArrivo ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {apriInArrivo && (
            <ul className={`space-y-1.5 px-4 pb-3 text-[13px] ${scuro ? 'text-gray-400' : 'text-gray-600'}`}>
              {arrivo.map((r) => (
                <li key={r.chiave}>
                  <span className={scuro ? 'text-gray-200' : 'text-gray-800'}>{r.titolo}</span>
                  {sedeLabel(r.sede) && <span className="opacity-70"> · {sedeLabel(r.sede)}</span>}
                  <br />{r.dettaglio}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
