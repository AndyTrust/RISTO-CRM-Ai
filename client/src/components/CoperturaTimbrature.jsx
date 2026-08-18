/**
 * CoperturaTimbrature.jsx — quante persone c'erano davvero, ora per ora.
 *
 * Mette accanto due cose che finora vivevano separate: l'affluenza dei clienti
 * (v_affluenza_oraria, dai tavoli iPratico) e le persone effettivamente in
 * servizio (v_presenza_oraria, dalle timbrature). La domanda a cui risponde è
 * "il personale c'è quando arrivano i clienti, o entra dopo e resta oltre?".
 *
 * SUL DATO: le timbrature sono PROVVISORIE. Gli operatori sbagliano a timbrare
 * e circa l'8% delle righe è stato ricostruito (uscita mancante, durata sopra
 * le 16 ore, entrata e uscita coincidenti). La ricostruzione segue la regola
 * decisa da Andrea: prima la mediana del gruppo che ha lavorato lo stesso
 * reparto/sede/giorno/turno, poi lo storico personale. Il grezzo non viene mai
 * toccato: sta ancora in timbrature.entrata/uscita.
 *
 * Per questo la percentuale di righe ricostruite è mostrata SEMPRE, non solo
 * quando è alta: un grafico di copertura senza quel numero accanto lascia
 * credere che sia una misura, mentre in parte è una stima. Sopra il 10% il
 * riquadro diventa un avviso.
 *
 * Cap PostgREST: si legge sempre filtrato per sede e per finestra temporale.
 * Sola lettura.
 */
import { useState, useEffect, useCallback } from 'react'
import { Clock, Users, AlertTriangle, Loader2, Info } from 'lucide-react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import supabase from '../supabase'

const COLORI_REPARTO = {
  Sala: '#2563eb',
  Cucina: '#dc2626',
  Plonge: '#16a34a',
}

// Fuori da queste ore il locale non serve clienti: mostrarle allunga l'asse
// senza aggiungere informazione.
const ORA_DA = 10
const ORA_A = 24

function iso(d) { return d.toISOString().slice(0, 10) }

export default function CoperturaTimbrature({ sede, giorni = 30 }) {
  const [dati, setDati] = useState(null)
  const [qualita, setQualita] = useState(null)
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState(null)

  const carica = useCallback(async () => {
    setCaricamento(true); setErrore(null)
    try {
      const a = new Date()
      const da = new Date(a.getTime() - giorni * 86400000)

      const [pres, aff, tot, ric] = await Promise.all([
        supabase.from('v_presenza_oraria').select('reparto,ora,persone_in_servizio,data_competenza')
          .eq('sede', sede).gte('data_competenza', iso(da)).lte('data_competenza', iso(a)),
        supabase.from('v_affluenza_oraria').select('ora,coperti,data')
          .eq('sede', sede).gte('data', iso(da)).lte('data', iso(a)),
        // count esatto senza portarsi dietro le righe
        supabase.from('timbrature').select('id', { count: 'exact', head: true })
          .eq('sede', sede).gte('data_competenza', iso(da)),
        supabase.from('timbrature').select('id', { count: 'exact', head: true })
          .eq('sede', sede).eq('sospetta', true).gte('data_competenza', iso(da)),
      ])
      if (pres.error) throw pres.error
      if (aff.error) throw aff.error

      // Media per ora: quante persone c'erano in quella fascia in un giorno tipo.
      const nGiorniPres = new Set((pres.data ?? []).map(r => r.data_competenza)).size || 1
      const nGiorniAff = new Set((aff.data ?? []).map(r => r.data)).size || 1

      const perOra = {}
      for (let o = ORA_DA; o <= ORA_A; o++) perOra[o] = { ora: `${String(o).padStart(2, '0')}:00`, coperti: 0 }
      for (const r of pres.data ?? []) {
        if (r.ora < ORA_DA || r.ora > ORA_A || !r.reparto) continue
        const k = perOra[r.ora]; if (!k) continue
        k[r.reparto] = (k[r.reparto] ?? 0) + Number(r.persone_in_servizio || 0)
      }
      for (const r of aff.data ?? []) {
        const k = perOra[r.ora]; if (!k) continue
        k.coperti += Number(r.coperti || 0)
      }
      const reparti = [...new Set((pres.data ?? []).map(r => r.reparto).filter(Boolean))]
      const righe = Object.values(perOra).map(r => {
        const o = { ora: r.ora, coperti: +(r.coperti / nGiorniAff).toFixed(1) }
        for (const rep of reparti) o[rep] = +((r[rep] ?? 0) / nGiorniPres).toFixed(2)
        return o
      })

      setDati({ righe, reparti })
      setQualita({ totale: tot.count ?? 0, ricostruite: ric.count ?? 0 })
    } catch (e) {
      // Una vista che non carica non è "una sede senza personale": meglio
      // l'errore che un grafico vuoto scambiato per copertura zero.
      setDati(null); setQualita(null)
      setErrore(e?.message || String(e))
    } finally {
      setCaricamento(false)
    }
  }, [sede, giorni])

  useEffect(() => { carica() }, [carica])

  if (caricamento) return (
    <div className="flex items-center gap-2 p-6 text-slate-500">
      <Loader2 className="w-4 h-4 animate-spin" /> Carico le timbrature…
    </div>
  )
  if (errore) return (
    <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
      <AlertTriangle className="w-4 h-4 inline mr-1" />
      Copertura non disponibile: {errore}
    </div>
  )
  if (!dati?.righe?.length) return null

  const pctRic = qualita?.totale
    ? Math.round((qualita.ricostruite / qualita.totale) * 1000) / 10
    : 0
  const allarme = pctRic > 10

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-500" />
            Copertura oraria — chi c'è quando arrivano i clienti
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Media di un giorno tipo, ultimi {giorni} giorni. Barre: coperti.
            Linee: persone in servizio per reparto.
          </p>
        </div>
        <div className={`text-xs px-3 py-2 rounded-lg border ${allarme
          ? 'bg-amber-50 border-amber-300 text-amber-800'
          : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
          {allarme ? <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                   : <Info className="w-3.5 h-3.5 inline mr-1" />}
          <strong>{pctRic}%</strong> delle timbrature ricostruite
          <div className="opacity-75">
            {allarme
              ? 'qui si timbra male: prendi i numeri con cautela'
              : 'uscite mancanti o durate impossibili, riallineate al gruppo'}
          </div>
        </div>
      </header>

      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          <ComposedChart data={dati.righe} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="ora" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="l" tick={{ fontSize: 11 }}
                   label={{ value: 'coperti', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }}
                   label={{ value: 'persone', angle: 90, position: 'insideRight', fontSize: 11 }} />
            <Tooltip formatter={(v, n) => [v, n === 'coperti' ? 'coperti medi' : `${n} in servizio`]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="l" dataKey="coperti" fill="#cbd5e1" name="coperti" />
            {dati.reparti.map(rep => (
              <Line key={rep} yAxisId="r" type="monotone" dataKey={rep} name={rep}
                    stroke={COLORI_REPARTO[rep] || '#7c3aed'} strokeWidth={2} dot={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-slate-400">
        Fonte: timbrature Dipendenti in Cloud (provvisorie) incrociate con l'affluenza
        dai tavoli iPratico. Le timbrature non misurano il costo del personale — per
        quello valgono i cedolini.
      </p>
    </section>
  )
}
