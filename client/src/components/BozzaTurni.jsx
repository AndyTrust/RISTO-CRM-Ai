/**
 * BozzaTurni.jsx — genera la settimana, la mostra, la fa approvare.
 *
 * Chiama la funzione Postgres genera_turni_bozza(sede, lunedì), che applica le
 * regole scritte in config_operativa: alternanza cassa fra gli abilitati, un
 * solo turno al giorno a testa, almeno un riposo settimanale, e nessuno
 * assegnato a un reparto in cui non ha mai lavorato.
 *
 * PROVVISORIO PER COSTRUZIONE. L'organico non esce da un modello teorico ma da
 * una media fra come si lavora oggi (timbrature) e quanto direbbe il modello,
 * pesata sulla quota di personale che timbra davvero. Finché timbra poca gente
 * ci si ancora alla prassi; quando timbrano tutti il modello prende il
 * sopravvento da solo. Per questo il pannello mostra sempre la copertura: è il
 * parametro che governa tutto il resto, e nasconderlo renderebbe i numeri
 * inspiegabili.
 *
 * CHI NON TIMBRA NON VIENE MAI ASSEGNATO: i candidati escono dalle timbrature
 * degli ultimi 60 giorni. Dove la copertura è bassa la bozza distribuisce il
 * lavoro su meno persone di quelle realmente disponibili, ed è giusto che si
 * veda.
 *
 * Rigenerare è sicuro: la funzione cancella solo le bozze, mai i turni già
 * pubblicati. Approvare è invece definitivo per la settimana, quindi chiede
 * conferma.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  CalendarRange, Wand2, CheckCircle2, AlertTriangle, Loader2, Info, Users,
} from 'lucide-react'
import supabase from '../supabase'

const GIORNI = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica']
const COL_REPARTO = { Sala: 'bg-blue-50 text-blue-700 border-blue-200',
                      Cucina: 'bg-red-50 text-red-700 border-red-200',
                      Plonge: 'bg-emerald-50 text-emerald-700 border-emerald-200' }

function lunediDi(d) {
  const x = new Date(d)
  const g = (x.getDay() + 6) % 7          // 0 = lunedì
  x.setDate(x.getDate() - g)
  return x.toISOString().slice(0, 10)
}
function addGiorni(iso, n) {
  const d = new Date(iso); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export default function BozzaTurni({ sede }) {
  const [lunedi, setLunedi] = useState(() => lunediDi(addGiorni(lunediDi(new Date()), 7)))
  const [turni, setTurni] = useState(null)
  const [affidabilita, setAffidabilita] = useState(null)
  const [caricamento, setCaricamento] = useState(true)
  const [generando, setGenerando] = useState(false)
  const [approvando, setApprovando] = useState(false)
  const [errore, setErrore] = useState(null)
  const [conferma, setConferma] = useState(false)

  const carica = useCallback(async () => {
    setCaricamento(true); setErrore(null); setConferma(false)
    try {
      const [t, a] = await Promise.all([
        supabase.from('shifts')
          .select('id,date,turno_tipo,ruolo,employee_name,ora_inizio,ora_fine,hours,stato,notes')
          .eq('sede', sede).gte('date', lunedi).lte('date', addGiorni(lunedi, 6))
          .order('date').order('turno_tipo'),
        supabase.from('v_affidabilita_organico').select('*').eq('sede', sede).maybeSingle(),
      ])
      if (t.error) throw t.error
      setTurni(t.data ?? [])
      setAffidabilita(a.data ?? null)
    } catch (e) {
      setTurni(null)
      setErrore(e?.message || String(e))
    } finally { setCaricamento(false) }
  }, [sede, lunedi])

  useEffect(() => { carica() }, [carica])

  async function genera() {
    setGenerando(true); setErrore(null)
    try {
      const { error } = await supabase.rpc('genera_turni_bozza', { p_sede: sede, p_lunedi: lunedi })
      if (error) throw error
      await carica()
    } catch (e) { setErrore(e?.message || String(e)) }
    finally { setGenerando(false) }
  }

  async function approva() {
    setApprovando(true); setErrore(null)
    try {
      const { error } = await supabase.from('shifts')
        .update({ stato: 'pubblicato', pubblicato_at: new Date().toISOString() })
        .eq('sede', sede).eq('stato', 'bozza')
        .gte('date', lunedi).lte('date', addGiorni(lunedi, 6))
      if (error) throw error
      await carica()
    } catch (e) { setErrore(e?.message || String(e)) }
    finally { setApprovando(false); setConferma(false) }
  }

  const bozze = (turni ?? []).filter(t => t.stato === 'bozza')
  const pubblicati = (turni ?? []).filter(t => t.stato === 'pubblicato')
  const ore = (turni ?? []).reduce((s, t) => s + Number(t.hours || 0), 0)

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-slate-500" />
            Bozza turni settimanale
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Cassa alternata, un turno al giorno, almeno un riposo. Rigenerare non
            tocca i turni già pubblicati.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={lunedi}
                 onChange={e => setLunedi(lunediDi(e.target.value))}
                 className="text-sm border border-slate-300 rounded-lg px-2 py-1.5" />
          <button onClick={genera} disabled={generando}
                  className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white
                             hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
            {generando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            {bozze.length ? 'Rigenera' : 'Genera'}
          </button>
          {bozze.length > 0 && (
            conferma ? (
              <span className="flex items-center gap-1.5">
                <button onClick={approva} disabled={approvando}
                        className="text-sm px-3 py-1.5 rounded-lg bg-emerald-600 text-white
                                   hover:bg-emerald-700 disabled:opacity-50">
                  {approvando ? 'Pubblico…' : `Confermi? Pubblica ${bozze.length} turni`}
                </button>
                <button onClick={() => setConferma(false)}
                        className="text-sm px-2 py-1.5 text-slate-500 hover:text-slate-700">annulla</button>
              </span>
            ) : (
              <button onClick={() => setConferma(true)}
                      className="text-sm px-3 py-1.5 rounded-lg border border-emerald-300
                                 text-emerald-700 hover:bg-emerald-50 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Approva settimana
              </button>
            )
          )}
        </div>
      </header>

      {affidabilita && (
        <div className={`text-xs px-3 py-2 rounded-lg border ${affidabilita.pct_copertura < 70
          ? 'bg-amber-50 border-amber-200 text-amber-800'
          : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
          {affidabilita.pct_copertura < 70
            ? <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
            : <Info className="w-3.5 h-3.5 inline mr-1" />}
          Timbrano <strong>{affidabilita.operativi_che_timbrano}</strong> persone
          su {affidabilita.operativi_a_cedolino} in servizio
          {' '}(<strong>{affidabilita.pct_copertura}%</strong>): l'organico previsto pesa il
          modello per {affidabilita.peso_modello} e per il resto segue la prassi attuale.
          {affidabilita.pct_copertura < 70 && (
            <div className="opacity-80 mt-0.5">
              Chi non timbra non viene assegnato: qui la bozza distribuisce il lavoro
              su meno persone di quelle davvero disponibili.
            </div>
          )}
        </div>
      )}

      {errore && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertTriangle className="w-4 h-4 inline mr-1" /> {errore}
        </div>
      )}

      {caricamento ? (
        <div className="flex items-center gap-2 p-6 text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Carico la settimana…
        </div>
      ) : !turni?.length ? (
        <p className="text-sm text-slate-500 py-6 text-center">
          Nessun turno per questa settimana. Premi <strong>Genera</strong> per creare la bozza.
        </p>
      ) : (
        <>
          <div className="flex gap-3 text-xs text-slate-600">
            <span><Users className="w-3.5 h-3.5 inline mr-1" />{turni.length} turni</span>
            <span>{Math.round(ore)} ore</span>
            {pubblicati.length > 0 && (
              <span className="text-emerald-700 font-medium">{pubblicati.length} già pubblicati</span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
            {GIORNI.map((g, i) => {
              const data = addGiorni(lunedi, i)
              const delGiorno = turni.filter(t => t.date === data)
              return (
                <div key={g} className="border border-slate-200 rounded-lg p-2 min-h-[90px]">
                  <div className="text-[11px] font-semibold text-slate-500 mb-1.5 capitalize">
                    {g} <span className="font-normal">{data.slice(8, 10)}/{data.slice(5, 7)}</span>
                  </div>
                  {delGiorno.length === 0
                    ? <div className="text-[11px] text-slate-300">riposo</div>
                    : ['Pranzo', 'Cena'].map(tt => {
                        const righe = delGiorno.filter(t => t.turno_tipo === tt)
                        if (!righe.length) return null
                        return (
                          <div key={tt} className="mb-1.5">
                            <div className="text-[10px] uppercase tracking-wide text-slate-400">{tt}</div>
                            {righe.map(t => (
                              <div key={t.id}
                                   title={t.notes || ''}
                                   className={`text-[11px] leading-tight border rounded px-1.5 py-1 mb-1
                                               ${COL_REPARTO[t.ruolo] || 'bg-slate-50 border-slate-200'}
                                               ${t.stato === 'pubblicato' ? 'ring-1 ring-emerald-400' : ''}`}>
                                <div className="font-medium truncate">{t.employee_name}</div>
                                <div className="opacity-70">{t.ora_inizio}–{t.ora_fine}</div>
                              </div>
                            ))}
                          </div>
                        )
                      })}
                </div>
              )
            })}
          </div>
        </>
      )}

      <p className="text-xs text-slate-400">
        Organico da v_organico_provvisorio. Passa il mouse su un turno per vedere da
        quali numeri è stato deciso. Il bordo verde indica i turni già pubblicati.
      </p>
    </section>
  )
}
