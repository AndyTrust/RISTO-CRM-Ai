import React from 'react'

/**
 * aggiornamento.jsx — un solo posto che decide QUANDO il CRM rilegge i dati.
 *
 * Il problema che risolve
 * ----------------------
 * Nessuna pagina di questo CRM tiene una cache: ognuna chiama Supabase dentro
 * un useEffect al montaggio. Finché si naviga fra le voci del menu i dati sono
 * quindi sempre freschi, perché cambiare rotta smonta e rimonta la pagina.
 *
 * Il caso che restava scoperto è l'unico che in sala succede davvero: la
 * scheda del browser resta aperta. La si apre la mattina sullo Scadenzario,
 * si passa il giorno a fare altro, e nel pomeriggio quella scheda mostra
 * ancora i numeri di stamattina — nel frattempo sono arrivate fatture, si
 * sono saldate rate, sono state caricate le chiusure. Il componente non si è
 * mai smontato, quindi nessuno ha più chiesto niente al database.
 *
 * Come lo risolve
 * ---------------
 * Un contatore `versione` che vive sopra le rotte. App.jsx lo usa come `key`
 * del contenitore delle Routes: quando il numero cambia React butta via la
 * pagina corrente e ne monta una nuova, che rifà le sue query da sola. Non
 * serve toccare nessuna delle ~50 pagine, e nessuna può "dimenticarsi" di
 * aderire: il rimontaggio non è una convenzione, è un fatto.
 *
 * Il numero viene alzato quando l'utente TORNA sul CRM, che è il momento in
 * cui guarda i numeri e quindi l'unico in cui contano:
 *   - all'avvio (versione parte da 1, ogni pagina monta comunque);
 *   - quando la scheda torna visibile (cambio tab, riapertura del portatile);
 *   - quando la finestra riprende il fuoco;
 *   - al ritorno della connessione, perché offline le query sono fallite;
 *   - al ripristino dalla bfcache (indietro del browser: nessun montaggio);
 *   - ogni SOGLIA_PERIODICA mentre la scheda è visibile e in uso;
 *   - a mano, dal pulsante nella sidebar.
 *
 * La soglia
 * ---------
 * Un rimontaggio non è gratis: rifà tutte le query della pagina, e alcune
 * (Statistiche Sala, Costi & Prezzi) sono pesanti. Per questo un ritorno sulla
 * scheda ricarica solo se sono passati almeno SOGLIA_RITORNO. Alt-tab avanti e
 * indietro fra due finestre non deve scatenare una raffica di query.
 *
 * Le cache di modulo
 * ------------------
 * Quattro file tengono una variabile di modulo che sopravvive al rimontaggio
 * (useSedi, useAnniDisponibili, useCoperturaTavoli, la copertura affluenza in
 * StatisticheSala). Sono tutte cache di metadati che cambiano di rado — l'elenco
 * sedi, il primo e l'ultimo anno disponibile — ma "di rado" non è "mai": se si
 * carica un anno nuovo, i menu a tendina non lo vedrebbero finché non si
 * ricarica la pagina a mano. Quindi prima di alzare il contatore emettiamo
 * l'evento `crm-dati-aggiornati` e ogni modulo svuota la propria cache. Ognuno
 * la svuota da sé perché la cache è sua: qui non serve saperne l'esistenza.
 */

const EVENTO_INVALIDA = 'crm-dati-aggiornati'

// Ritorno sulla scheda: ricarica solo se i dati hanno almeno cinque minuti.
// Un alt-tab per guardare una mail non deve far ripartire tutte le query, e
// soprattutto non deve azzerare i filtri che l'utente ha appena impostato.
const SOGLIA_RITORNO = 5 * 60 * 1000
// Scheda lasciata aperta e visibile: ricontrolla comunque ogni quarto d'ora.
const SOGLIA_PERIODICA = 15 * 60 * 1000

/**
 * Un rimontaggio azzera lo stato locale della pagina: se c'e' un editor aperto
 * (il saldo di una fattura, l'importo di una rata) il testo appena digitato
 * sparirebbe senza spiegazione. Le pagine che aprono un editor mettono
 * `data-modifica-in-corso` sul contenitore; l'aggiornamento automatico aspetta
 * che si chiuda. Quello manuale no: se l'utente clicca "Aggiorna dati" mentre
 * sta scrivendo, ha deciso lui.
 */
function modificaInCorso() {
  try {
    return !!document.querySelector('[data-modifica-in-corso]')
  } catch (_) {
    return false
  }
}

export const AggiornamentoContext = React.createContext({
  versione: 1,
  aggiornatoAlle: null,
  inCorso: false,
  aggiorna: () => {},
})

export function useAggiornamento() {
  return React.useContext(AggiornamentoContext)
}

export function ProviderAggiornamento({ children }) {
  const [versione, setVersione] = React.useState(1)
  const [aggiornatoAlle, setAggiornatoAlle] = React.useState(() => new Date())
  const [inCorso, setInCorso] = React.useState(false)

  // Serve dentro i listener senza rimetterli a ogni aggiornamento.
  const ultimoRef = React.useRef(Date.now())

  const aggiorna = React.useCallback(() => {
    ultimoRef.current = Date.now()
    try { window.dispatchEvent(new Event(EVENTO_INVALIDA)) } catch (_) {}
    setAggiornatoAlle(new Date())
    setVersione(v => v + 1)
    // Lo spinner non attende le query (che stanno dentro le pagine, ognuna con
    // il suo stato di caricamento): segnala solo che il rimontaggio è partito.
    setInCorso(true)
    const t = setTimeout(() => setInCorso(false), 900)
    return () => clearTimeout(t)
  }, [])

  const aggiornaSeVecchio = React.useCallback((soglia) => {
    if (Date.now() - ultimoRef.current < soglia) return
    if (modificaInCorso()) return
    aggiorna()
  }, [aggiorna])

  React.useEffect(() => {
    const alRitorno = () => {
      if (document.visibilityState !== 'visible') return
      aggiornaSeVecchio(SOGLIA_RITORNO)
    }
    // pageshow con persisted=true è il ritorno dalla bfcache: la pagina viene
    // ripristinata così com'era, senza montare niente. Lì si ricarica sempre.
    const alRipristino = (e) => { if (e.persisted && !modificaInCorso()) aggiorna() }
    const alRitornoOnline = () => { if (!modificaInCorso()) aggiorna() }

    document.addEventListener('visibilitychange', alRitorno)
    window.addEventListener('focus', alRitorno)
    window.addEventListener('pageshow', alRipristino)
    window.addEventListener('online', alRitornoOnline)

    const periodico = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      aggiornaSeVecchio(SOGLIA_PERIODICA)
    }, 60 * 1000)

    return () => {
      document.removeEventListener('visibilitychange', alRitorno)
      window.removeEventListener('focus', alRitorno)
      window.removeEventListener('pageshow', alRipristino)
      window.removeEventListener('online', alRitornoOnline)
      clearInterval(periodico)
    }
  }, [aggiorna, aggiornaSeVecchio])

  const valore = React.useMemo(
    () => ({ versione, aggiornatoAlle, inCorso, aggiorna }),
    [versione, aggiornatoAlle, inCorso, aggiorna]
  )

  return (
    <AggiornamentoContext.Provider value={valore}>
      {children}
    </AggiornamentoContext.Provider>
  )
}

/**
 * Da chiamare a livello di modulo nei file che tengono una cache propria.
 * Registra un listener che vive quanto il modulo: non va rimosso, e non deve
 * dipendere dal fatto che un componente sia montato.
 */
export function svuotaAllAggiornamento(svuota) {
  if (typeof window === 'undefined') return
  window.addEventListener(EVENTO_INVALIDA, svuota)
}

export default ProviderAggiornamento
