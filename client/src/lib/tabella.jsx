/**
 * tabella.jsx — utilità condivise per le tabelle del CRM.
 *
 * Nasce da tre difetti ricorrenti trovati in tutte le pagine:
 *
 * 1. NESSUNA tabella era esportabile. Con 7 anni di storico a DB, "guardo il
 *    numero a schermo e lo ricopio" non è più praticabile.
 * 2. Quasi nessuna tabella era ordinabile, e quelle che lo erano ordinavano in
 *    una sola direzione e trattavano i valori mancanti come 0 — così, ordinando
 *    per "food cost %", i prodotti SENZA food cost risultavano i migliori.
 * 3. Le formattazioni `€${Number(v) || 0}` trasformavano un dato assente in
 *    "€0", che in una pagina di costi è un'informazione falsa, non neutra.
 */
import React, { useMemo, useState, useCallback } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, Download } from 'lucide-react'

// ─── Formattazione: "zero" e "non disponibile" NON sono la stessa cosa ──────

/** Numero → stringa; null/undefined/NaN → il segnaposto (default '—'). */
export function fmtNum(v, { decimali = 0, vuoto = '—' } = {}) {
  if (v === null || v === undefined || v === '') return vuoto
  const n = Number(v)
  if (!Number.isFinite(n)) return vuoto
  return n.toLocaleString('it-IT', { minimumFractionDigits: decimali, maximumFractionDigits: decimali })
}

/** Importo in euro; null/undefined/NaN → segnaposto, mai "€0". */
export function fmtEur(v, { decimali = 0, vuoto = '—' } = {}) {
  if (v === null || v === undefined || v === '') return vuoto
  const n = Number(v)
  if (!Number.isFinite(n)) return vuoto
  return '€' + n.toLocaleString('it-IT', { minimumFractionDigits: decimali, maximumFractionDigits: decimali })
}

/** Percentuale già espressa in punti (23.4 → "23,4%"). */
export function fmtPct(v, { decimali = 1, vuoto = '—', segno = false } = {}) {
  if (v === null || v === undefined || v === '') return vuoto
  const n = Number(v)
  if (!Number.isFinite(n)) return vuoto
  const s = segno && n > 0 ? '+' : ''
  return s + n.toLocaleString('it-IT', { minimumFractionDigits: decimali, maximumFractionDigits: decimali }) + '%'
}

/**
 * Variazione percentuale fra due valori.
 * Restituisce null — non 0 — quando non è calcolabile: senza base di confronto
 * "0%" significherebbe "invariato", che è un'affermazione diversa da "non so".
 */
export function variazionePct(attuale, precedente) {
  const a = Number(attuale), b = Number(precedente)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null
  return ((a - b) / Math.abs(b)) * 100
}

// ─── Ordinamento ───────────────────────────────────────────────────────────

/**
 * Ordinamento bidirezionale con gestione esplicita dei valori mancanti.
 *
 * I null finiscono SEMPRE in fondo, in entrambe le direzioni: è l'unico
 * comportamento che non mente. Trattandoli come 0 (com'era prima) un prodotto
 * senza food cost registrato risultava il più conveniente del menu.
 *
 * @param {object[]} righe
 * @param {string}   colonnaIniziale
 * @param {'asc'|'desc'} direzioneIniziale
 * @returns {{ righeOrdinate, colonna, direzione, ordinaPer, propsTh }}
 */
export function useOrdinamento(righe, colonnaIniziale = null, direzioneIniziale = 'desc') {
  const [colonna, setColonna] = useState(colonnaIniziale)
  const [direzione, setDirezione] = useState(direzioneIniziale)

  const ordinaPer = useCallback((col) => {
    if (col === colonna) setDirezione(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setColonna(col); setDirezione('desc') }
  }, [colonna])

  const righeOrdinate = useMemo(() => {
    if (!colonna || !Array.isArray(righe)) return righe ?? []
    const vuoto = v => v === null || v === undefined || v === '' ||
      (typeof v === 'number' && !Number.isFinite(v))
    const segno = direzione === 'asc' ? 1 : -1
    return [...righe].sort((ra, rb) => {
      const a = ra?.[colonna], b = rb?.[colonna]
      if (vuoto(a) && vuoto(b)) return 0
      if (vuoto(a)) return 1        // i mancanti sempre in coda
      if (vuoto(b)) return -1
      if (typeof a === 'number' || typeof b === 'number') return segno * (Number(a) - Number(b))
      return segno * String(a).localeCompare(String(b), 'it')
    })
  }, [righe, colonna, direzione])

  const propsTh = useCallback((col) => ({
    onClick: () => ordinaPer(col),
    role: 'button',
    className: 'cursor-pointer select-none hover:text-gray-900',
  }), [ordinaPer])

  return { righeOrdinate, colonna, direzione, ordinaPer, propsTh }
}

/** Freccia di ordinamento da mettere nell'header. */
export function IconaOrdine({ colonna, colonnaAttiva, direzione, size = 12 }) {
  if (colonna !== colonnaAttiva) return <ArrowUpDown size={size} className="inline ml-1 opacity-30" />
  return direzione === 'asc'
    ? <ArrowUp size={size} className="inline ml-1" />
    : <ArrowDown size={size} className="inline ml-1" />
}

// ─── Export CSV ────────────────────────────────────────────────────────────

function cellaCsv(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Scarica le righe come CSV.
 *
 * Separatore `;` e BOM UTF-8: è il formato che Excel in locale italiano apre
 * senza chiedere nulla. Con la virgola, Excel IT incolla tutto in una colonna.
 * I numeri vengono lasciati con la virgola decimale per lo stesso motivo.
 *
 * @param {object[]} righe
 * @param {{chiave: string, etichetta: string, valore?: (r)=>any}[]} colonne
 * @param {string} nomeFile senza estensione
 */
export function esportaCsv(righe, colonne, nomeFile = 'export') {
  const intest = colonne.map(c => cellaCsv(c.etichetta)).join(';')
  const corpo = (righe ?? []).map(r =>
    colonne.map(c => {
      const v = c.valore ? c.valore(r) : r?.[c.chiave]
      if (typeof v === 'number' && Number.isFinite(v)) return cellaCsv(String(v).replace('.', ','))
      return cellaCsv(v)
    }).join(';')
  ).join('\n')

  const blob = new Blob(['﻿' + intest + '\n' + corpo], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${nomeFile}_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Pulsante di export pronto all'uso. */
export function BottoneCsv({ righe, colonne, nomeFile, etichetta = 'CSV', className = '' }) {
  const n = righe?.length ?? 0
  return (
    <button
      type="button"
      onClick={() => esportaCsv(righe, colonne, nomeFile)}
      disabled={!n}
      title={n ? `Esporta ${n.toLocaleString('it-IT')} righe in CSV` : 'Nessuna riga da esportare'}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
        n ? 'border-gray-300 text-gray-700 hover:bg-gray-50' : 'border-gray-200 text-gray-300 cursor-not-allowed'
      } ${className}`}
    >
      <Download size={13} />
      {etichetta}
    </button>
  )
}

/**
 * Banda informativa "N righe · periodo · fonte".
 * Serve a rendere esplicito su quanti dati poggia un numero: una somma che
 * legge 3 mesi e una che ne legge 84 si guardano allo stesso modo, ma non
 * valgono la stessa cosa.
 */
export function NotaCopertura({ righe, da, a, fonte, extra, troncato }) {
  return (
    <p className="text-[11px] text-gray-400 mt-1.5">
      {righe != null && <>{Number(righe).toLocaleString('it-IT')} righe</>}
      {da && a && <> · {da} → {a}</>}
      {fonte && <> · fonte: {fonte}</>}
      {extra && <> · {extra}</>}
      {troncato && <span className="text-amber-600 font-medium"> · ⚠ risultato troncato: restringi il periodo</span>}
    </p>
  )
}

export default { fmtNum, fmtEur, fmtPct, variazionePct, useOrdinamento, esportaCsv }
