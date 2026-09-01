/**
 * numeri.js — leggere un importo scritto da un essere umano.
 *
 * PERCHE' ESISTE
 * Questa regola era scritta bene in tre posti (ImportExcel.jsx, il `num()` di
 * applica_al_foglio.py, il `cella()` di sheetjs.js) e scritta male nei due che
 * contano di piu': gli editor di Scadenzario e Rate & Piani, cioe' gli unici
 * punti in cui dalla UI si scrive un importo dentro al database. La' faceva
 *
 *     parseFloat(String(x).replace(',', '.'))
 *
 * che su "1.234,56" produce "1.234.56", e parseFloat si ferma al secondo punto:
 * 1,23 euro al posto di 1.234,56. Un pagamento parziale registrato mille volte
 * piu' piccolo, senza un errore, senza un avviso.
 *
 * LA REGOLA
 * Se c'e' una virgola, allora la virgola e' il decimale e i punti sono migliaia.
 * Altrimenti il punto e' il decimale e va lasciato stare. E' l'unico modo per
 * leggere sia "2.000,25" (scritto a mano) sia "2000.25" (che arriva da Postgres)
 * senza rovinare nessuno dei due: trattare "2000.25" all'italiana darebbe 200025.
 *
 * SI CONTROLLA LA FORMA, POI SI CONVERTE
 * parseFloat legge finche' capisce e poi si ferma zitto: "1,2,3" gli esce 1.2,
 * "1.234.567" gli esce 1.234. Un importo malformato va RIFIUTATO, non
 * interpretato a meta' — interpretarlo a meta' e' precisamente il difetto da cui
 * nasce questo file. Quindi prima un controllo di forma, poi la conversione.
 *
 * COSA TORNA
 * Un numero, oppure `null`. Mai `NaN`: NaN attraversa JSON.stringify come `null`
 * e finisce a database come "importo assente" senza che nessuno se ne accorga.
 * Chi salva deve poter distinguere "campo vuoto" da "ho scritto una sciocchezza",
 * e per quello c'e' `importoValido`.
 */

// Un numero pulito, dopo la normalizzazione: segno, cifre, al piu' un decimale.
const FORMA = /^[+-]?\d+(\.\d+)?$/

/**
 * Da testo a numero, o null se non e' leggibile.
 * @param {string|number|null|undefined} v
 * @returns {number|null}
 */
export function num(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null

  //   e' lo spazio unificatore che Excel infila nei numeri formattati:
  // senza toglierlo la conversione fallisce e l'importo diventa zero.
  let s = String(v).trim().replace(/[€\s ]/g, '')
  if (s === '') return null

  // C'e' una virgola: e' lei il decimale, i punti sono migliaia e se ne vanno.
  // Se di virgole ce n'e' piu' d'una ne resta una in mezzo, e il controllo di
  // forma la boccia — che e' quello che deve succedere.
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')

  if (!FORMA.test(s)) return null
  const f = parseFloat(s)
  return Number.isFinite(f) ? f : null
}

/**
 * Vero se il testo e' un importo che si puo' salvare.
 * Il campo vuoto NON e' valido: se una casella puo' voler dire "nessun valore",
 * quel caso va deciso da chi chiama, non nascosto qui dentro.
 */
export function importoValido(v) {
  return num(v) !== null
}

/** L'importo come lo si scrive in italiano: 1.234,56 */
export function formattaImporto(v, dec = 2) {
  const n = num(v)
  if (n === null) return '—'
  return n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

export default num
