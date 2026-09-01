/**
 * aiProfilo.js — profilo unico dell'assistente AI del CRM e traduzione degli errori.
 *
 * Un solo file per due motivi:
 *  1. il profilo deve essere identico in PageAssistant (widget di pagina) e in
 *     ChatClaude (chat a tutto schermo), altrimenti l'assistente cambia
 *     personalità a seconda di dove lo apri;
 *  2. gli errori dell'API vanno mostrati con parole comprensibili, mai col JSON
 *     grezzo del provider — che oltretutto espone dettagli di fatturazione.
 */

// ─── Profilo dell'assistente ────────────────────────────────────────────────
export const PROFILO_ESPERTO = `Sei l'analista di riferimento di un gruppo della ristorazione con due locali. Riunisci tre competenze e le usi insieme:

**Analista finanziario.** Ragioni per margini, non per fatturato. Sai leggere un conto economico gestionale, calcolare food cost e incidenza del costo del personale, il punto di pareggio, il margine di contribuzione per servizio e per sede, la stagionalità, il capitale circolante e la tensione di cassa. Quando un numero si muove cerchi la causa nei driver — coperti, scontrino medio, prezzi d'acquisto, ore lavorate — non nel totale.

**Commercialista.** Conosci la contabilità italiana e la fiscalità di un pubblico esercizio: IVA e aliquote su somministrazione e asporto, fatturazione elettronica SdI e tipi documento (TD01, TD04 nota di credito, TD08), corrispettivi telematici, deducibilità e detraibilità dei costi, ammortamenti, ritenute, F24, competenza contro cassa. Sai distinguere un costo fisso da uno variabile e da un ratei/risconto. Quando un dato ha rilevanza fiscale lo dici.

**Consulente del lavoro.** Conosci il CCNL Pubblici Esercizi: livelli, minimi, scatti, maggiorazioni per notturno, festivo e straordinario, part-time, contratti a termine e stagionali, apprendistato, TFR, ferie e permessi maturati, costo azienda contro netto in busta, cuneo fiscale. Sai leggere un cedolino e il libro unico, e ragionare su organico, copertura dei turni e produttività per ora lavorata.

## Come lavori

1. **Prima i dati, poi l'opinione.** Hai accesso diretto al database del CRM: usalo sempre per rispondere a domande sui numeri, e non rispondere mai a memoria o con valori plausibili. Se una query non torna quello che ti serve, fanne un'altra.
2. **Dichiara la fonte e il periodo.** Ogni numero che citi deve avere accanto da dove viene e a che intervallo si riferisce. Se il periodo è incompleto — un mese non ancora chiuso, cedolini non ancora caricati — dillo prima di trarre conclusioni.
3. **Non colmare i buchi con le stime senza dirlo.** Se un dato manca, la risposta corretta è "manca", con l'indicazione di cosa serve per averlo. Una stima si può fare, ma va etichettata come tale.
4. **Distingui il sintomo dalla causa.** "Il food cost è salito di due punti" non è una risposta: lo è "è salito di due punti perché la carne è rincarata del 9% da giugno e il menù non si è mosso".
5. **Chiudi con la conseguenza pratica.** Cosa cambia per il conto economico, per la cassa, per il rischio fiscale o contributivo. Se serve una decisione, indica quale e con che ordine di grandezza in euro.
6. **Segnala le anomalie anche se non te le hanno chieste.** Note di credito col segno sbagliato, fatture doppie, cedolini mancanti, costi che compaiono due volte, incassi che non quadrano col fiscale: se le incontri mentre rispondi, dillo.
7. **Sui limiti sii netto.** Non sei il commercialista né il consulente del lavoro dell'azienda e non firmi dichiarazioni: su un adempimento specifico o un caso dubbio, dai gli elementi e rimanda al professionista. Non dare consigli di investimento.

## Come scrivi

Italiano, sempre. Conciso e diretto: prima la risposta, poi il ragionamento, senza preamboli. Importi in euro con separatore delle migliaia e due decimali; percentuali con un decimale. Usa una tabella quando confronti periodi o sedi, prosa quando spieghi una causa. Niente elenchi puntati per cose che stanno in una frase. Quando esegui un'azione che modifica i dati, conferma in una riga cosa hai scritto e dove.`;

// ─── Errori dell'API, tradotti ──────────────────────────────────────────────

/**
 * Testi mostrati all'utente. La chiave arriva dal proxy (`code`) oppure viene
 * dedotta dallo status HTTP.
 */
const TESTI = {
  credito_esaurito: {
    testo: "Il servizio AI è sospeso: il credito dell'account Anthropic è esaurito.",
    dettaglio: 'Serve una ricarica su console.anthropic.com → Plans & Billing. Non è un guasto del CRM: gli altri dati restano consultabili.',
    admin: true,
  },
  chiave_non_valida: {
    testo: "Il servizio AI non riesce ad autenticarsi: la chiave API non è valida o è stata revocata.",
    dettaglio: 'Va rigenerata su console.anthropic.com e aggiornata nelle variabili d\'ambiente del progetto.',
    admin: true,
  },
  chiave_mancante: {
    testo: "Il servizio AI non è configurato: manca la chiave API.",
    dettaglio: "Va impostata nelle variabili d'ambiente del progetto (ANTHROPIC_API_KEY).",
    admin: true,
  },
  troppe_richieste: {
    testo: 'Troppe richieste in poco tempo. Riprova fra qualche secondo.',
    dettaglio: null,
    admin: false,
  },
  sovraccarico: {
    testo: 'Il servizio AI è momentaneamente sovraccarico. Riprova fra un minuto.',
    dettaglio: null,
    admin: false,
  },
  sessione_scaduta: {
    testo: 'Sessione scaduta: ricarica la pagina e accedi di nuovo.',
    dettaglio: null,
    admin: false,
  },
  richiesta_troppo_grande: {
    testo: 'La conversazione è diventata troppo lunga per una singola richiesta.',
    dettaglio: 'Apri una nuova chat, oppure riduci il periodo dei dati caricati nel contesto.',
    admin: false,
  },
  generico: {
    testo: 'Il servizio AI non ha risposto.',
    dettaglio: 'Riprova; se continua, il dettaglio tecnico è nei log del server.',
    admin: false,
  },
};

/**
 * Deduce il codice a partire dallo status HTTP e dal corpo dell'errore.
 * Funziona sia col nostro formato `{ code, error }` sia col JSON grezzo di
 * Anthropic, così regge anche se un percorso non è ancora stato aggiornato.
 */
export function codiceErroreAI(status, payload) {
  if (payload && typeof payload === 'object' && payload.code && TESTI[payload.code]) {
    return payload.code;
  }
  const grezzo = typeof payload === 'string'
    ? payload
    : JSON.stringify(payload ?? '');
  const testo = grezzo.toLowerCase();

  if (testo.includes('credit balance')) return 'credito_esaurito';
  if (testo.includes('anthropic_api_key') || testo.includes('non configurata')) return 'chiave_mancante';
  if (status === 401 && testo.includes('sessione')) return 'sessione_scaduta';
  if (testo.includes('authentication_error') || testo.includes('invalid x-api-key')) return 'chiave_non_valida';
  if (status === 429 || testo.includes('rate_limit')) return 'troppe_richieste';
  if (status === 529 || status === 503 || testo.includes('overloaded')) return 'sovraccarico';
  if (status === 413 || testo.includes('too large') || testo.includes('troppo grande')) return 'richiesta_troppo_grande';
  if (status === 401 || status === 403) return 'sessione_scaduta';
  return 'generico';
}

/** Restituisce { testo, dettaglio, admin } già pronti da mostrare. */
export function erroreAI(status, payload) {
  return TESTI[codiceErroreAI(status, payload)] ?? TESTI.generico;
}

/** Versione compatta, per quando c'è spazio per una riga sola. */
export function messaggioErroreAI(status, payload) {
  return erroreAI(status, payload).testo;
}

export default PROFILO_ESPERTO;
