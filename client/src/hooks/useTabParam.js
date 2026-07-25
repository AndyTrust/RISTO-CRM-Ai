import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * useTabParam — rende una tab indirizzabile con un URL proprio (deep link).
 *
 * Perché esiste: molte pagine tenevano la tab attiva in `useState`, quindi
 * `/chiusure` apriva SEMPRE la prima tab e non era possibile linkare
 * "Chiusure → Anno su Anno". Con questo hook la tab vive nella query string,
 * quindi l'URL è condivisibile, il tasto Indietro funziona e un link diretto
 * apre davvero la sezione giusta.
 *
 * Due accortezze importanti:
 *
 * 1. VALIDAZIONE — un id sconosciuto (link vecchio, refuso, param scritto da
 *    un'altra pagina) ricade sul default invece di lasciare la pagina vuota.
 *    Senza questo controllo `?tab=pippo` renderizzerebbe zero contenuto,
 *    perché ogni blocco è del tipo `{tab === 'x' && <X/>}`.
 *
 * 2. PRESERVAZIONE DEGLI ALTRI PARAMETRI — si aggiorna solo la chiave della
 *    tab. Il vecchio `setParams({ tab })` azzerava tutto il resto della query
 *    string, e nelle pagine annidate (hub + sottopagina) faceva sparire il
 *    parametro del genitore.
 *
 * @param {string[]} validIds  id ammessi, in ordine di dichiarazione
 * @param {string}   defaultId tab di partenza quando il parametro manca o è invalido
 * @param {string}   paramName nome del parametro (usare un nome distinto nelle
 *                             pagine annidate dentro un hub, es. 'sub')
 * @param {string[]} [aliases] mappa alias→id per retrocompatibilità dei link
 *                             storici, nel formato { aliasUrl: idReale }
 * @returns {[string, (id: string) => void]}
 */
export function useTabParam(validIds, defaultId, paramName = 'tab', aliases = {}) {
  const [params, setParams] = useSearchParams()

  // Rete di sicurezza: se anche il default è un id inesistente si ricade sulla
  // prima tab dichiarata. Senza questo, un default sbagliato passato da chi
  // monta la pagina produce un'area contenuti vuota senza alcun errore — è
  // esattamente il guasto che /buste-paga aveva con defaultTab="buste-paga".
  const fallback = validIds.includes(defaultId) ? defaultId : validIds[0]

  const raw = params.get(paramName)
  const resolved = aliases[raw] || raw
  const tab = validIds.includes(resolved) ? resolved : fallback

  const setTab = useCallback((next) => {
    const p = new URLSearchParams(params)
    p.set(paramName, next)
    setParams(p)
  }, [params, setParams, paramName])

  return [tab, setTab, fallback]
}

export default useTabParam
