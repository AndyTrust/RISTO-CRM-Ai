import React from 'react'
import { RefreshCw, FileSpreadsheet, CheckCircle2, AlertTriangle, Clock } from 'lucide-react'
import { scadenzarioApi } from '../api/supabase-client'
import { leggiFoglioAmministrazione } from '../lib/sheetjs'
import { useAggiornamento } from '../lib/aggiornamento'

/**
 * RileggiFogli — il ponte fra l'xlsx dell'amministrazione e lo Scadenzario.
 *
 * PERCHE' ESISTE
 * Il registro dei pagamenti era stato caricato una volta sola. Da li' in poi
 * l'amministrazione segnava un pagamento sul foglio e lo Scadenzario continuava
 * a mostrare quella fattura aperta, perche' nessuno rileggeva piu' il file. Il
 * giorno in cui e' stato misurato lo scarto erano 43.505,58 EUR di pagamenti su
 * Mameli che il CRM non aveva mai visto.
 *
 * DUE STRADE, LA STESSA FUNZIONE
 * Sul PC dell'amministrazione un'attivita' pianificata rilegge i fogli da sola
 * ogni minuto, e chiude le richieste che arrivano da qui. Il pulsante grande
 * chiede al PC di farlo adesso e aspetta la conferma: e' la strada normale,
 * non serve avere i file sottomano.
 *
 * La seconda strada - scegliere i due xlsx a mano - resta per il caso in cui
 * il PC dell'amministrazione sia spento. Da qualunque computer, con i file
 * sottomano, si aggiorna lo stesso. Tutte e due finiscono in
 * sincronizza_foglio, che e' l'unico posto in cui il foglio viene interpretato.
 *
 * L'ETICHETTA CONTA QUANTO IL PULSANTE
 * Sopra al bottone c'e' sempre scritto quando i fogli sono stati letti l'ultima
 * volta. Uno Scadenzario che non dichiara l'eta' dei propri numeri invita a
 * fidarsi di un dato di ieri.
 */

function quandoUmano(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  if (min < 1) return `adesso (${ora})`
  if (min < 60) return `${min} min fa (${ora})`
  const oggi = new Date().toDateString() === d.toDateString()
  if (oggi) return `oggi alle ${ora}`
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) + ` alle ${ora}`
}

export default function RileggiFogli({ onFatto, compatto = false, scuro = false }) {
  const { inCorso, fase, rileggiFogli } = useAggiornamento()
  const input = React.useRef(null)
  const [stato, setStato] = React.useState('fermo')   // fermo | leggo | fatto | errore
  const [esiti, setEsiti] = React.useState([])
  const [ultime, setUltime] = React.useState([])
  // FIX 2026-09-01 (issue #189): senza questa guardia il .then() di una lettura
  // partita e non ancora tornata faceva setState su un componente smontato —
  // e col rimontaggio automatico ogni 15 minuti non e' piu' un caso di scuola.
  const vivo = React.useRef(true)
  React.useEffect(() => () => { vivo.current = false }, [])

  const caricaUltime = React.useCallback(() => {
    return scadenzarioApi.ultimeSincronie()
      .then((r) => { if (vivo.current) setUltime(r); return r })
      .catch(() => [])
  }, [])

  // FIX 2026-09-01 (issue #192, meta' lato client): il pulsante diceva soltanto
  // "Aggiornato" oppure "Il PC non risponde". Un giro FINITO MA ANDATO MALE -
  // il PC ha risposto e ha fallito - era indistinguibile da uno riuscito: lo
  // script scrive un esito con problemi e saltati, e nessuno lo leggeva.
  // Qui si guardano le sincronie scritte dopo il click: se qualcuna e' ok=false
  // lo si dice, con il motivo che ha registrato lo script.
  const [guai, setGuai] = React.useState(null)
  const rileggiEControlla = React.useCallback(async () => {
    const da = Date.now()
    setGuai(null)
    await rileggiFogli()
    const righe = await caricaUltime()
    if (!vivo.current) return
    const fallite = (righe || []).filter(
      (r) => !r.ok && r.quando && new Date(r.quando).getTime() >= da - 5000)
    setGuai(fallite.length ? fallite : null)
  }, [rileggiFogli, caricaUltime])
  React.useEffect(() => { caricaUltime() }, [caricaUltime])

  // L'ultima riuscita per sede: e' quella che dice davvero l'eta' dei numeri.
  const perSede = {}
  for (const s of ultime) if (s.ok && !perSede[s.sede]) perSede[s.sede] = s
  // FIX 2026-09-01 (issue #182): prima era `.filter(Boolean).sort()[0]`, cioe'
  // la sede SENZA sincronie riuscite veniva tolta invece di contare come il caso
  // peggiore. Se Predda Niedda falliva, l'etichetta mostrava sereno l'orario di
  // Mameli — l'esatto contrario di quello che questo componente esiste per dire.
  // (ultimeSincronie legge le ultime 20 righe: una sede ferma da un po' ne esce.)
  const SEDI = [['MA', 'Mameli'], ['PN', 'Predda Niedda']]
  const senzaLettura = SEDI.filter(([c]) => !perSede[c]).map(([, nome]) => nome)
  const piuVecchia = SEDI.map(([c]) => perSede[c]?.quando).filter(Boolean).sort()[0]

  const gestisci = async (files) => {
    if (!files || !files.length) return
    setStato('leggo'); setEsiti([])
    const out = []
    for (const f of files) {
      try {
        const { sede, fornitori, rateali, giornaliera } = await leggiFoglioAmministrazione(f)
        const r = await scadenzarioApi.sincronizzaFoglio({ sede, fornitori, rateali, giornaliera })
        if (r?.ok === false) throw new Error(r.errore || 'errore sconosciuto')
        out.push({ nome: f.name, sede, ok: true, ...r })
      } catch (e) {
        out.push({ nome: f.name, ok: false, errore: e.message })
      }
    }
    if (!vivo.current) return
    setEsiti(out)
    setStato(out.every((o) => o.ok) ? 'fatto' : 'errore')
    caricaUltime()
    if (out.some((o) => o.ok) && onFatto) onFatto()
  }

  return (
    <div className={compatto ? '' : scuro
        ? 'rounded-xl border border-gray-700/60 bg-gray-800/40 p-4'
        : 'rounded-xl border border-gray-200 bg-white p-4'}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={rileggiEControlla}
          disabled={inCorso || stato === 'leggo'}
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            (inCorso || stato === 'leggo')
              ? (scuro ? 'bg-white/5 text-gray-500' : 'bg-gray-100 text-gray-400')
              : (scuro ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                       : 'bg-gray-900 text-white hover:bg-gray-700')
          }`}
        >
          <RefreshCw size={14} className={inCorso ? 'animate-spin' : ''} />
          {fase === 'chiedo'  ? 'Chiedo al PC...'
            : fase === 'attendo' ? 'Rileggo i fogli...'
            : fase === 'scaduto' ? 'Il PC non risponde'
            : 'Rileggi i fogli Excel'}
        </button>

        <button
          onClick={() => input.current?.click()}
          disabled={stato === 'leggo'}
          className={`text-xs underline underline-offset-2 ${
            scuro ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-800'}`}
        >
          {stato === 'leggo' ? 'leggo i file scelti...' : 'oppure scegli i file a mano'}
        </button>

        <span className={`inline-flex items-center gap-1.5 text-xs ${
          senzaLettura.length
            ? (scuro ? 'text-amber-300' : 'text-amber-700')
            : (scuro ? 'text-gray-400' : 'text-gray-500')}`}>
          <Clock size={12} />
          {senzaLettura.length === SEDI.length
            ? <>i fogli non sono ancora mai stati riletti</>
            : senzaLettura.length
              ? <>{senzaLettura.join(' e ')} non risulta letto · l'altro {quandoUmano(piuVecchia)}</>
              : <>fogli letti {quandoUmano(piuVecchia)}</>}
        </span>

        <input
          ref={input} type="file" accept=".xlsx" multiple className="hidden"
          onChange={(e) => { gestisci([...e.target.files]); e.target.value = '' }}
        />
      </div>

      {!compatto && (
        <p className={`mt-2 text-xs leading-relaxed ${scuro ? 'text-gray-400' : 'text-gray-500'}`}>
          Il PC dell'amministrazione rilegge i fogli <strong>da solo ogni minuto</strong>, e appena
          uno dei due file cambia lo porta dentro. Il pulsante serve a non aspettare nemmeno quello:
          chiede al PC di rileggere adesso. Vengono lette le schede FORNITORI e RATEALI; sul pagato
          comanda il foglio, quindi le fatture gia' saldate spariscono da qui. Se il PC e' spento,
          <strong>scegli i file a mano</strong>: funziona da qualunque computer.
        </p>
      )}

      {guai && (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
          scuro ? 'border-rose-700/50 bg-rose-900/20 text-rose-200'
                : 'border-red-200 bg-red-50 text-red-700'}`}>
          <p className="font-medium flex items-center gap-2">
            <AlertTriangle size={13} /> Il PC ha riletto, ma qualcosa non e' andato
          </p>
          <ul className="mt-1 ml-5 list-disc space-y-0.5">
            {guai.map((g) => (
              <li key={g.id}>
                {g.sede === 'MA' ? 'Mameli' : g.sede === 'PN' ? 'Predda Niedda' : g.sede}
                {' — '}{g.errore || 'motivo non registrato'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {esiti.length > 0 && (
        <div className="mt-3 space-y-2">
          {esiti.map((e, i) => (
            <div key={i} className={`rounded-lg border px-3 py-2 text-xs ${
              e.ok
                ? (scuro ? 'border-emerald-700/50 bg-emerald-900/20' : 'border-emerald-200 bg-emerald-50')
                : (scuro ? 'border-rose-700/50 bg-rose-900/20' : 'border-red-200 bg-red-50')
            }`}>
              <div className={`flex items-center gap-2 font-medium ${scuro ? 'text-gray-100' : 'text-gray-800'}`}>
                {e.ok ? <CheckCircle2 size={13} className="text-emerald-600" />
                      : <AlertTriangle size={13} className="text-red-600" />}
                <FileSpreadsheet size={13} className="text-gray-400" />
                {e.nome}
              </div>
              {e.ok ? (
                <ul className={`mt-1 ml-6 list-disc space-y-0.5 ${scuro ? 'text-gray-300' : 'text-gray-600'}`}>
                  <li>
                    FORNITORI: {e.fornitori?.righe_dopo ?? 0} righe
                    {typeof e.fornitori?.delta_pagato === 'number' && e.fornitori.delta_pagato !== 0 && (
                      <> · pagato {e.fornitori.delta_pagato > 0 ? '+' : ''}
                        {Number(e.fornitori.delta_pagato).toLocaleString('it-IT', { minimumFractionDigits: 2 })} €</>
                    )}
                  </li>
                  {!!e.fornitori?.fatture_aggiornate && (
                    <li>{e.fornitori.fatture_aggiornate} fatture allineate al foglio</li>
                  )}
                  {!!e.fornitori?.modifiche_sito_riapplicate && (
                    <li>{e.fornitori.modifiche_sito_riapplicate} modifiche fatte dal sito e non ancora
                        scritte sull'xlsx sono state rimesse sopra</li>
                  )}
                  {!!e.fornitori?.da_verificare_crm_avanti && (
                    <li className={scuro ? 'text-amber-300' : 'text-amber-700'}>
                      {e.fornitori.da_verificare_crm_avanti} fatture risultano pagate sul CRM ma non sul
                      foglio: non le riapro, guardale in Riconciliazione
                    </li>
                  )}
                  {e.rateali && <li>RATEALI: {e.rateali.piani} piani, {e.rateali.rate_dopo} rate</li>}
                </ul>
              ) : (
                <p className={`mt-1 ml-6 ${scuro ? 'text-rose-200' : 'text-red-700'}`}>{e.errore}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
