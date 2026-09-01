/**
 * ImportExcel.jsx — Import del foglio GIORNALIERA dell'amministrazione
 *
 * Legge Mameli26.xlsx / Predda_Niedda26.xlsx nel browser (SheetJS, nessun file
 * lascia il computer) e chiama la funzione Postgres `applica_giornaliera`, che e'
 * l'unico posto dove vive la regola di import — la stessa usata dallo script
 * Python su Mac e Windows.
 *
 * LA REGOLA: nel foglio TOTALE contiene GIA' il TRAINING
 *     TOTALE = POS + TRAINING + CONTANTI + TICKET + DELIVEROO + GLOVO
 * Il training si espone, non si somma: risommarlo gonfierebbe il fatturato di
 * ~30.000 EUR l'anno. Confermato da iPratico, il cui paymentsTotal e' sempre
 * esattamente TOTALE - TRAINING.
 *
 * ATTENZIONE: Mameli ha la colonna DEL CONTANTI, Predda Niedda no (16 contro 15).
 * Le colonne si mappano per NOME, mai per posizione.
 *
 * La pagina sta dentro AuthGate: la RPC e' concessa solo al ruolo `authenticated`.
 */
import React, { useState, useCallback } from 'react'
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle, Loader,
} from 'lucide-react'
import { supabase } from '../supabase'
import { caricaXLSX } from '../lib/sheetjs'
// La regola di lettura degli importi vive in lib/numeri.js: era corretta qui e
// sbagliata negli editor di Scadenzario e Rate & Piani (#177). Ora e' una sola.
import { num } from '../lib/numeri'

/**
 * SheetJS si carica da CDN al primo uso invece di essere una dipendenza npm:
 * il CRM e' in produzione e aggiungere un pacchetto al build per una pagina
 * usata due volte al mese non vale il rischio di rompere il deploy.
 */
// Il caricatore di SheetJS sta in lib/sheetjs.js: lo usa anche "Rileggi i
// fogli" dello Scadenzario, e una copia sola evita che le due divergano.

// stessa mappa dello script Python
const COLONNE = {
  data: 'data', servizio: 'servizio', coperti: 'coperti', pos: 'pos',
  training: 'training', contanti: 'contanti', ticket: 'ticket', n1: 'n1',
  delcontanti: 'del_contanti', deliveroo: 'deliveroo', n5: 'n5',
  glovocont: 'glovo_cont', glovo: 'glovo', totale: 'totale',
  media: 'media', totristo: 'tot_risto',
}
const ADDITIVI = ['pos', 'training', 'contanti', 'ticket', 'deliveroo', 'glovo']

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const eur = (n) => (n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function sedeDa(nome) {
  const n = norm(nome)
  if (n.includes('mameli')) return 'MA'
  if (n.includes('predda')) return 'PN'
  return null
}


function dataDa(v, XLSX) {
  if (v instanceof Date) {
    return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  }
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function leggiFoglio(wb, XLSX) {
  const ws = wb.Sheets['GIORNALIERA']
  if (!ws) throw new Error('foglio GIORNALIERA assente')
  const griglia = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  const mappa = {}
  ;(griglia[0] || []).forEach((c, i) => {
    const k = COLONNE[norm(c)]
    if (k) mappa[k] = i
  })
  for (const ob of ['data', 'servizio', 'coperti', 'totale']) {
    if (!(ob in mappa)) throw new Error(`colonna obbligatoria assente: ${ob}`)
  }
  const righe = []
  for (let r = 1; r < griglia.length; r++) {
    const g = griglia[r]
    if (!g) continue
    const d = dataDa(g[mappa.data], XLSX)
    if (!d) continue
    // riga+1 = numero di riga vero del foglio: e' la chiave (sede, riga) a database
    const o = { riga: r + 1, data: d, servizio: String(g[mappa.servizio] ?? '').trim().toLowerCase() }
    for (const [k, i] of Object.entries(mappa)) {
      if (k !== 'data' && k !== 'servizio') o[k] = num(g[i])
    }
    righe.push(o)
  }
  return righe
}

function controlla(righe) {
  const male = righe.filter((r) => {
    const t = r.totale || 0
    if (!t) return false
    return Math.abs(t - ADDITIVI.reduce((s, k) => s + (r[k] || 0), 0)) > 0.05
  })
  return {
    male,
    training: righe.reduce((s, r) => s + (r.training || 0), 0),
    giorni: new Set(righe.map((r) => r.data)).size,
  }
}

export default function ImportExcel() {
  const [schede, setSchede] = useState([])

  const gestisci = useCallback(async (files) => {
    const nuove = []
    for (const f of files) {
      const sede = sedeDa(f.name)
      const s = { nome: f.name, sede, stato: 'letto' }
      if (!sede) {
        s.stato = 'errore'
        s.errore = 'Sede non riconosciuta: il nome deve contenere "Mameli" o "Predda".'
        nuove.push(s); continue
      }
      try {
        const XLSX = await caricaXLSX()
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true })
        s.righe = leggiFoglio(wb, XLSX)
        s.check = controlla(s.righe)
      } catch (e) {
        s.stato = 'errore'
        s.errore = `Non riesco a leggerlo: ${e.message}`
      }
      nuove.push(s)
    }
    setSchede(nuove)
  }, [])

  const carica = useCallback(async (idx) => {
    setSchede((v) => v.map((s, i) => (i === idx ? { ...s, stato: 'carico' } : s)))
    const s = schede[idx]
    const { data, error } = await supabase.rpc('applica_giornaliera', {
      p_sede: s.sede, p_righe: s.righe,
    })
    setSchede((v) => v.map((x, i) => {
      if (i !== idx) return x
      if (error) return { ...x, stato: 'errore', errore: error.message }
      return { ...x, stato: 'fatto', esito: Array.isArray(data) ? data[0] : data }
    }))
  }, [schede])

  const onDrop = (e) => { e.preventDefault(); gestisci([...e.dataTransfer.files]) }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight">Import foglio GIORNALIERA</h1>
      <p className="text-slate-500 mt-1 mb-6">
        I file dell'amministrazione: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-sm">Mameli26.xlsx</code>{' '}
        e <code className="bg-slate-100 px-1.5 py-0.5 rounded text-sm">Predda_Niedda26.xlsx</code>.
        La sede si riconosce dal nome.
      </p>

      <div className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3 mb-6 text-sm text-amber-900">
        Nel foglio la colonna <b>TOTALE contiene già il TRAINING</b>: viene esposto come voce
        a sé, mai risommato al fatturato. Le giornate incomplete e quelle con un servizio
        ripetuto due volte <b>non vengono scritte</b>, te le segnalo soltanto.
      </div>

      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="block border-2 border-dashed border-slate-300 rounded-xl bg-white
                   py-12 px-6 text-center cursor-pointer hover:border-amber-500 transition"
      >
        <input type="file" accept=".xlsx,.xlsm" multiple className="hidden"
               onChange={(e) => gestisci([...e.target.files])} />
        <Upload className="mx-auto mb-3 text-slate-400" size={30} />
        <div className="font-medium">Scegli i file o trascinali qui</div>
        <div className="text-sm text-slate-500 mt-1">
          Vengono letti nel browser: nessun file lascia il tuo computer
        </div>
      </label>

      <div className="mt-6 space-y-4">
        {schede.map((s, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 font-medium">
                <FileSpreadsheet size={17} className="text-slate-400" />{s.nome}
              </div>
              {s.sede && <span className="text-xs text-slate-500">sede {s.sede}</span>}
            </div>

            {s.errore && (
              <div className="flex gap-2 text-sm bg-red-50 text-red-800 rounded p-3">
                <XCircle size={17} className="shrink-0 mt-0.5" />{s.errore}
              </div>
            )}

            {s.check && (
              <>
                <dl className="text-sm tabular-nums space-y-1 mb-3">
                  <div className="flex justify-between"><dt>Righe lette</dt><dd className="font-semibold">{s.righe.length}</dd></div>
                  <div className="flex justify-between"><dt>Giorni</dt><dd className="font-semibold">{s.check.giorni}</dd></div>
                  <div className="flex justify-between">
                    <dt>Training <span className="text-slate-400">(già dentro il totale)</span></dt>
                    <dd className="font-semibold">€ {eur(s.check.training)}</dd>
                  </div>
                </dl>

                {s.check.male.length > 0 ? (
                  <div className="flex gap-2 text-sm bg-red-50 text-red-800 rounded p-3">
                    <XCircle size={17} className="shrink-0 mt-0.5" />
                    <div>
                      <b>{s.check.male.length} righe non quadrano.</b> Il TOTALE non corrisponde a
                      POS+TRAINING+CONTANTI+TICKET+DELIVEROO+GLOVO. Non carico niente finché non è sistemato.
                      <div className="mt-1 text-xs">
                        {s.check.male.slice(0, 3).map((r) => `${r.data} ${r.servizio}`).join(' · ')}
                      </div>
                    </div>
                  </div>
                ) : s.stato !== 'fatto' && (
                  <button
                    onClick={() => carica(i)}
                    disabled={s.stato === 'carico'}
                    className="bg-slate-900 text-white rounded-md px-5 py-2.5 text-sm
                               disabled:opacity-40 inline-flex items-center gap-2"
                  >
                    {s.stato === 'carico' && <Loader size={15} className="animate-spin" />}
                    {s.stato === 'carico' ? 'Carico…' : `Carica ${s.sede} su Supabase`}
                  </button>
                )}
              </>
            )}

            {s.esito && (
              <div className="space-y-2 mt-1">
                <div className="flex gap-2 text-sm bg-emerald-50 text-emerald-800 rounded p-3">
                  <CheckCircle2 size={17} className="shrink-0 mt-0.5" />
                  <span>
                    <b>{s.esito.giorni_toccati} giorni</b> · {s.esito.righe_scritte} righe ·{' '}
                    {s.esito.chiusure_aggiornate} chiusure aggiornate.
                  </span>
                </div>
                {s.esito.saltati_incompleti && (
                  <div className="flex gap-2 text-sm bg-amber-50 text-amber-900 rounded p-3">
                    <AlertTriangle size={17} className="shrink-0 mt-0.5" />
                    <span><b>Non scritti, giornata non completa</b> (il foglio vale meno del
                      fiscale già emesso): {s.esito.saltati_incompleti}</span>
                  </div>
                )}
                {s.esito.saltati_duplicati && (
                  <div className="flex gap-2 text-sm bg-amber-50 text-amber-900 rounded p-3">
                    <AlertTriangle size={17} className="shrink-0 mt-0.5" />
                    <span><b>Non scritti, stesso servizio due volte</b> — quasi sempre una data
                      sbagliata nel foglio: {s.esito.saltati_duplicati}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
