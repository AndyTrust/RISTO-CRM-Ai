import React from 'react'
import { scadenzarioApi } from '../api/supabase-client'

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
 * IL PULSANTE FA UNA COSA IN PIU'
 * Rileggere il database non basta se nel frattempo l'amministrazione ha
 * cambiato l'Excel: quei numeri stanno sul disco del PC e Supabase non li ha
 * ancora visti. Il browser pero' non puo' aprire un file locale senza che
 * qualcuno lo scelga a mano. Quindi il pulsante CHIEDE: lascia una richiesta
 * su Supabase, lo script sul PC la trova al giro successivo (gira ogni minuto),
 * rilegge i fogli e la chiude. Qui si aspetta quella conferma, al massimo
 * FINESTRA_ATTESA, e poi si aggiorna comunque - dicendo com'e' andata, perche'
 * un'attesa finita male senza dirlo e' peggio di nessuna attesa.
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
// ...ma solo se l'utente non la sta usando in questo momento.
//
// FIX 2026-09-01 (issue #186). Il commento qui sopra prometteva "mentre la
// scheda e' visibile E IN USO", e "in uso" non esisteva: c'era solo
// visibilityState. Risultato: dopo quindici minuti il rimontaggio azzerava lo
// stato di una cinquantina di pagine - filtri di Statistiche Sala, sezione
// aperta di Controllo Costi, periodo di Costi & Prezzi - mentre uno le stava
// guardando. `data-modifica-in-corso` copriva due soli punti, e solo con un
// editor aperto.
//
// Ora l'aggiornamento periodico aspetta che l'utente stia fermo da un paio di
// minuti. Chi legge e filtra tiene la sua pagina; chi ha lasciato la scheda
// aperta e se n'e' andato se la ritrova fresca. Non c'e' un tetto massimo di
// attesa di proposito: l'eta' del dato e' gia' scritta in chiaro nella barra
// laterale ("aggiornato 3 min fa"), quindi un dato vecchio si vede, mentre uno
// stato di pagina azzerato senza spiegazione no.
const INATTIVITA_MINIMA = 2 * 60 * 1000

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

// Quanto si aspetta il PC prima di rinunciare.
//
// Lo script sul PC gira ogni minuto a un orario fisso, quindi chi preme il
// pulsante cade in un punto qualsiasi di quel minuto: l'attesa e' uniforme fra
// zero e sessanta secondi, piu' i venti scarsi che serve a rileggere i due
// file. La prima misura sul campo ha dato 27 secondi e la seconda 49: con una
// finestra di 50 secondi, un click su sei sarebbe finito in un falso "il PC
// non risponde", che e' il modo piu' rapido per far smettere di fidarsi di un
// messaggio. Novanta secondi coprono il caso peggiore vero.
const FINESTRA_ATTESA = 90 * 1000
const PASSO_ATTESA = 2000

export const AggiornamentoContext = React.createContext({
  versione: 1,
  aggiornatoAlle: null,
  inCorso: false,
  fase: null,
  aggiorna: () => {},
  rileggiFogli: async () => {},
})

export function useAggiornamento() {
  return React.useContext(AggiornamentoContext)
}

export function ProviderAggiornamento({ children }) {
  const [versione, setVersione] = React.useState(1)
  const [aggiornatoAlle, setAggiornatoAlle] = React.useState(() => new Date())
  const [inCorso, setInCorso] = React.useState(false)
  const [fase, setFase] = React.useState(null)  // chiedo | attendo | fatto | scaduto

  // Serve dentro i listener senza rimetterli a ogni aggiornamento.
  const ultimoRef = React.useRef(Date.now())
  // FIX 2026-09-01 (issue #185): il timer dello spinner. Prima `aggiorna`
  // restituiva `() => clearTimeout(t)`, ma non e' un useEffect: nessuno dei
  // cinque chiamanti usava quel valore. I timer si accumulavano e uno orfano
  // (focus e visibilitychange arrivano insieme al ritorno sulla scheda) spegneva
  // lo spinner dell'aggiornamento successivo appena partito.
  const timerSpinner = React.useRef(null)
  const timerFase = React.useRef(null)
  React.useEffect(() => () => {
    clearTimeout(timerSpinner.current)
    clearTimeout(timerFase.current)
  }, [])

  const aggiorna = React.useCallback(() => {
    ultimoRef.current = Date.now()
    try { window.dispatchEvent(new Event(EVENTO_INVALIDA)) } catch (_) {}
    setAggiornatoAlle(new Date())
    setVersione(v => v + 1)
    // Lo spinner non attende le query (che stanno dentro le pagine, ognuna con
    // il suo stato di caricamento): segnala solo che il rimontaggio è partito.
    setInCorso(true)
    clearTimeout(timerSpinner.current)
    timerSpinner.current = setTimeout(() => setInCorso(false), 900)
  }, [])

  /**
   * Chiede al PC di rileggere i fogli, aspetta la conferma, poi aggiorna.
   * Restituisce sempre un esito, anche quando va male: chi ha premuto ha
   * diritto di sapere se sta guardando numeri riletti adesso o quelli di prima.
   */
  const rileggiFogli = React.useCallback(async () => {
    setInCorso(true)
    clearTimeout(timerFase.current)
    setFase('chiedo')
    let esito = { ok: false, motivo: 'ignoto' }
    try {
      const richiesta = await scadenzarioApi.chiediRilettura('CRM')
      const chiestaIl = richiesta?.chiesta_il ? new Date(richiesta.chiesta_il).getTime() : Date.now()
      setFase('attendo')

      const scadenza = Date.now() + FINESTRA_ATTESA
      while (Date.now() < scadenza) {
        await new Promise(r => setTimeout(r, PASSO_ATTESA))
        let stato = null
        try { stato = await scadenzarioApi.statoRilettura() } catch (_) { continue }
        const ultima = stato?.ultima_sincronia ? new Date(stato.ultima_sincronia).getTime() : 0
        // La rilettura vale se e' avvenuta DOPO che l'abbiamo chiesta: una
        // sincronia di due minuti fa non e' una risposta alla nostra domanda.
        if (ultima > chiestaIl) { esito = { ok: true }; break }
      }
      if (!esito.ok) esito = { ok: false, motivo: 'attesa' }
    } catch (e) {
      esito = { ok: false, motivo: 'errore', dettaglio: e.message }
    }
    setFase(esito.ok ? 'fatto' : 'scaduto')
    aggiorna()
    clearTimeout(timerFase.current)
    timerFase.current = setTimeout(() => setFase(null), 6000)
    return esito
  }, [aggiorna])

  // Ultimo momento in cui l'utente ha toccato qualcosa. In un ref e non in uno
  // stato: cambia a ogni click e non deve far rirenderizzare niente.
  const ultimaAzioneRef = React.useRef(Date.now())
  React.useEffect(() => {
    const tocco = () => { ultimaAzioneRef.current = Date.now() }
    const eventi = ['pointerdown', 'keydown', 'wheel', 'touchstart']
    for (const e of eventi) window.addEventListener(e, tocco, { passive: true, capture: true })
    return () => {
      for (const e of eventi) window.removeEventListener(e, tocco, { capture: true })
    }
  }, [])

  const aggiornaSeVecchio = React.useCallback((soglia, richiediInattivita = false) => {
    if (Date.now() - ultimoRef.current < soglia) return
    if (modificaInCorso()) return
    // #186: non si smonta la pagina sotto le mani di chi la sta usando.
    if (richiediInattivita && Date.now() - ultimaAzioneRef.current < INATTIVITA_MINIMA) return
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
      aggiornaSeVecchio(SOGLIA_PERIODICA, true)   // true = solo se sta fermo (#186)
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
    () => ({ versione, aggiornatoAlle, inCorso, fase, aggiorna, rileggiFogli }),
    [versione, aggiornatoAlle, inCorso, fase, aggiorna, rileggiFogli]
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
