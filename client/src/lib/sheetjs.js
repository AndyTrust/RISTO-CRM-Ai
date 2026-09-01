/**
 * sheetjs.js — leggere un xlsx dell'amministrazione dentro al browser.
 *
 * Sta qui e non dentro una pagina perche' i posti che aprono quei file sono
 * gia' due (Import GIORNALIERA e "Rileggi i fogli" dello Scadenzario) e la
 * parte delicata - caricare SheetJS una volta sola, e capire come si scrive
 * una data - non va scritta due volte in due modi leggermente diversi.
 */

// SheetJS non arriva piu' da un CDN.
//
// FIX 2026-09-01 (issue #190). Prima era cdnjs, senza `integrity` e senza
// `crossOrigin`, dentro una pagina che tiene il JWT Supabase in memoria e
// subito dopo chiama `sincronizza_foglio` - cioe' la scrittura piu' potente del
// CRM. La via corta sarebbe stata aggiungere un hash SRI; quella giusta e'
// non dipendere da un dominio di terzi per eseguire codice qui dentro. Il file
// e' ora servito dal nostro stesso dominio, da public/vendor/, quindi non c'e'
// nessun hash da tenere aggiornato e nessun terzo da cui dipendere: se cambia
// il file, e' perche' l'abbiamo cambiato noi.
//
// Per aggiornare la libreria: npm pack xlsx@<versione>, prendere
// dist/xlsx.full.min.js, metterlo in public/vendor/ e cambiare la riga qui
// sotto. Il file attualmente servito e' xlsx 0.18.5, la stessa versione che
// arrivava dal CDN.
const URL_XLSX = '/vendor/xlsx-0.18.5.full.min.js'
let caricamento = null

export function caricaXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX)
  if (caricamento) return caricamento
  caricamento = new Promise((ok, ko) => {
    const s = document.createElement('script')
    s.src = URL_XLSX
    // `caricamento` va azzerato su OGNI fallimento, non solo su onerror: se la
    // risposta arriva ma non definisce window.XLSX (un index.html restituito al
    // posto del file, un captive portal), la promise rigettata restava in cache
    // di modulo e ogni tentativo successivo falliva senza nemmeno riprovare,
    // fino al ricaricamento della pagina.
    const fallito = (msg) => { caricamento = null; ko(new Error(msg)) }
    s.onload = () => (window.XLSX
      ? ok(window.XLSX)
      : fallito("Il file di SheetJS e' stato scaricato ma non contiene la libreria."))
    s.onerror = () => fallito('Non riesco a caricare SheetJS da ' + URL_XLSX + '.')
    document.head.appendChild(s)
  })
  return caricamento
}

/** 'Mameli26.xlsx' → 'MA'. Il nome del file e' l'unico posto in cui la sede e' scritta. */
export function sedeDaNome(nome) {
  const n = String(nome || '').toLowerCase()
  if (n.includes('mameli')) return 'MA'
  if (n.includes('predda')) return 'PN'
  return null
}

/**
 * Una data come la vuole Postgres: 'AAAA-MM-GG'.
 * Excel le puo' dare in tre forme diverse — oggetto Date (con cellDates),
 * seriale numerico, o testo — e la conversione ingenua `toISOString()` su una
 * Date locale sposta il giorno indietro a ogni fuso a est di Greenwich.
 */
function dataISO(v, XLSX) {
  if (v instanceof Date) {
    return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  }
  if (typeof v === 'number' && XLSX?.SSF) {
    const d = XLSX.SSF.parse_date_code(v)
    if (d && d.y) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  return null
}

function cella(v, XLSX) {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return dataISO(v, XLSX)
  if (typeof v === 'number' || typeof v === 'boolean') return v
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * La scheda come griglia grezza: array di righe, ogni riga array di celle,
 * intestazioni comprese. Quello che le colonne significano lo decide Postgres:
 * qui non si interpreta niente, si trasporta.
 */
export function grigliaDi(wb, XLSX, nomeScheda) {
  const ws = wb.Sheets[nomeScheda]
  if (!ws) return null
  const g = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  const out = g.map((riga) => (riga || []).map((c) => cella(c, XLSX)))
  while (out.length && !out[out.length - 1].some((c) => c !== null)) out.pop()
  return out
}

/** Legge un file scelto dall'utente e ne restituisce le tre schede che servono. */
export async function leggiFoglioAmministrazione(file) {
  const sede = sedeDaNome(file.name)
  if (!sede) throw new Error('Sede non riconosciuta: il nome deve contenere "Mameli" o "Predda".')
  const XLSX = await caricaXLSX()
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const fornitori = grigliaDi(wb, XLSX, 'FORNITORI')
  if (!fornitori || fornitori.length < 2) throw new Error('scheda FORNITORI assente o vuota')
  // GIORNALIERA alimenta la dashboard (incassi, coperti, tender). Va con le
  // altre due: se il PC e' spento e si caricano i file a mano, non ha senso
  // aggiornare lo scadenzario e lasciare il cruscotto indietro.
  return {
    sede,
    fornitori,
    rateali: grigliaDi(wb, XLSX, 'RATEALI'),
    giornaliera: grigliaDi(wb, XLSX, 'GIORNALIERA'),
  }
}
