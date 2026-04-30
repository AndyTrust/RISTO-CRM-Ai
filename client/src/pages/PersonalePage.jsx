import React from 'react'
import { useLocation } from 'react-router-dom'
import BustePaga from './BustePaga'

/**
 * PersonalePage — wrapper unificato per Dipendenti + Buste Paga.
 *
 * Entrambe le route /buste-paga e /dipendenti atterrano qui.
 * Il parametro ?tab=stato nella URL apre direttamente la tab "Stato Dipendenti"
 * (che mostra i dipendenti ricavati ESCLUSIVAMENTE dalla tabella buste_paga).
 *
 * Attivi = presenti nell'ultimo mese di busta paga caricato nel DB.
 */
export default function PersonalePage({ defaultTab = 'riepilogo' }) {
  const location = useLocation()
  const urlTab = new URLSearchParams(location.search).get('tab')
  // Mappa alias URL → id tab interno di BustePaga
  const TAB_MAP = { dipendenti: 'stato', stato: 'stato' }
  const startTab = TAB_MAP[urlTab] || defaultTab

  return <BustePaga startTab={startTab} />
}
