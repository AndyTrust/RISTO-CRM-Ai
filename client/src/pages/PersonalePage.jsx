import React from 'react'
import BustePaga from './BustePaga'

/**
 * PersonalePage — wrapper unificato per Dipendenti + Buste Paga.
 *
 * Entrambe le route /buste-paga e /dipendenti atterrano qui.
 *
 * La tab attiva è gestita da BustePaga tramite il parametro `?tab=` (hook
 * useTabParam), quindi ogni sezione ha un URL proprio e condivisibile:
 *   /buste-paga?tab=riepilogo | dipendenti | analisi | costo | dettaglio
 *
 * Nota storica: qui viveva una mappa alias che traduceva `?tab=dipendenti`
 * in `stato`, un id di tab che in BustePaga non è mai esistito. Il risultato
 * era che /dipendenti apriva la pagina con l'area contenuti vuota. Gli alias
 * sono ora in BustePaga e puntano a id reali.
 */
export default function PersonalePage({ defaultTab = 'riepilogo' }) {
  return <BustePaga startTab={defaultTab} />
}
