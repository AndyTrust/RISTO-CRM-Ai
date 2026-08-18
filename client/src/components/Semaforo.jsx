import React from 'react'
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react'

/**
 * Semaforo.jsx — il semaforo condiviso.
 *
 * Prima di questo file il progetto aveva quattro semafori diversi scritti a
 * mano (StatoDati, Fabbisogno, PageStatsWidget, BreakEvenGiornaliero), con
 * colori e soglie ogni volta leggermente diversi. Questo è il quinto e ultimo:
 * chi ne serve uno nuovo lo importa da qui.
 *
 * Quattro stati, non tre. Il quarto è MUTO (grigio) e vuol dire "non lo so":
 * fatturato mancante, mese non ancora chiuso, soglia non definita. Colorare di
 * verde un dato assente è una bugia; colorarlo di rosso è un falso allarme.
 * La stessa convenzione di `fmtEur(null) === '—'` in lib/tabella.
 */

export const ESITI = {
  VERDE: {
    chiave: 'VERDE',
    etichetta: 'Nei parametri',
    box:    'bg-emerald-50 border-emerald-200',
    testo:  'text-emerald-700',
    punto:  'bg-emerald-500',
    pillola:'bg-emerald-100 text-emerald-800 border-emerald-200',
    Icona:  CheckCircle2,
  },
  AMBRA: {
    chiave: 'AMBRA',
    etichetta: 'Da tenere d’occhio',
    box:    'bg-amber-50 border-amber-200',
    testo:  'text-amber-800',
    punto:  'bg-amber-500',
    pillola:'bg-amber-100 text-amber-900 border-amber-300',
    Icona:  AlertTriangle,
  },
  ROSSO: {
    chiave: 'ROSSO',
    etichetta: 'Fuori parametro',
    box:    'bg-red-50 border-red-200',
    testo:  'text-red-700',
    punto:  'bg-red-500',
    pillola:'bg-red-100 text-red-800 border-red-200',
    Icona:  XCircle,
  },
  MUTO: {
    chiave: 'MUTO',
    etichetta: 'Dato non disponibile',
    box:    'bg-gray-50 border-gray-200',
    testo:  'text-gray-400',
    punto:  'bg-gray-300',
    pillola:'bg-gray-100 text-gray-500 border-gray-200',
    Icona:  HelpCircle,
  },
}

/** Restituisce sempre uno stile valido: un esito sconosciuto diventa MUTO, non verde. */
export function stileEsito(esito) {
  return ESITI[esito] || ESITI.MUTO
}

/**
 * Pallino colorato + etichetta facoltativa.
 * <Semaforo esito="ROSSO" testo="34,5%" />
 */
export function Semaforo({ esito, testo, titolo, className = '' }) {
  const s = stileEsito(esito)
  return (
    <span
      title={titolo || s.etichetta}
      className={`inline-flex items-center gap-1.5 ${className}`}
    >
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.punto}`} />
      {testo != null && <span className={`text-sm font-semibold ${s.testo}`}>{testo}</span>}
    </span>
  )
}

/**
 * Pillola con icona: per le intestazioni e i riepiloghi.
 * <PillolaEsito esito="AMBRA" testo="Personale 41,0%" />
 */
export function PillolaEsito({ esito, testo, titolo, className = '' }) {
  const s = stileEsito(esito)
  const { Icona } = s
  return (
    <span
      title={titolo || s.etichetta}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium ${s.pillola} ${className}`}
    >
      <Icona size={12} />
      {testo}
    </span>
  )
}

/**
 * Cella di griglia colorata: valore grande, sotto il dettaglio in piccolo.
 * Pensata per la matrice mesi × voci di costo.
 */
export function CellaSemaforo({ esito, valore, dettaglio, titolo, onClick }) {
  const s = stileEsito(esito)
  const cliccabile = typeof onClick === 'function'
  return (
    <div
      onClick={onClick}
      title={titolo || s.etichetta}
      className={`px-2 py-1.5 rounded-lg border text-center ${s.box} ${
        cliccabile ? 'cursor-pointer hover:brightness-95 transition' : ''
      }`}
    >
      <div className={`text-sm font-bold leading-tight ${s.testo}`}>{valore}</div>
      {dettaglio != null && (
        <div className="text-[10px] text-gray-500 leading-tight mt-0.5">{dettaglio}</div>
      )}
    </div>
  )
}

/** Legenda da mettere in fondo a una griglia di semafori. */
export function LegendaSemaforo({ className = '' }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500 ${className}`}>
      {['VERDE', 'AMBRA', 'ROSSO', 'MUTO'].map((k) => {
        const s = ESITI[k]
        return (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${s.punto}`} />
            {s.etichetta}
          </span>
        )
      })}
    </div>
  )
}

export default Semaforo
