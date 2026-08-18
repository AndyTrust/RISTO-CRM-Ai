/**
 * BreakEvenGiornaliero.jsx — quanto doveva incassare ogni giorno, e quanto ha fatto.
 *
 * Complementare a v_be_mensile, che il CRM già mostra altrove: stesse definizioni
 * (food cost dal flag is_food_cost di v_fatture_arricchite, personale da
 * v_costo_personale_per_sede), ma sul giorno. Nei mesi chiusi la somma dei giorni
 * torna esattamente al mensile — è la garanzia che qui e in analytics non si
 * leggano due verità diverse.
 *
 * PERCHÉ IL MESE IN CORSO USA UN ALTRO METODO: le fatture fornitore arrivano
 * giorni dopo il consumo, quindi l'incidenza food del mese aperto è finta bassa
 * (ad agosto 2026 il mensile diceva 18% mentre la realtà viaggiava sul 31%).
 * Per i giorni del mese corrente si usa la media mobile a 30 giorni. La colonna
 * `metodo_food` dichiara sempre quale dei due è in uso, così il salto fra mese
 * chiuso e mese aperto non sembra un errore.
 *
 * Il break-even non è la somma dei costi: è (personale + fissi) / (1 − food%),
 * perché le materie crescono con l'incasso. Sommare e basta sottostima il target.
 *
 * Cap PostgREST: sempre filtrato per sede e finestra. Sola lettura.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Target, TrendingUp, TrendingDown, AlertTriangle, Loader2 } from 'lucide-react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import supabase from '../supabase'

const eur = n => (n == null ? '—' : `€ ${Math.round(n).toLocaleString('it-IT')}`)
function iso(d) { return d.toISOString().slice(0, 10) }

export default function BreakEvenGiornaliero({ sede, giorni = 45 }) {
  const [righe, setRighe] = useState(null)
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState(null)

  const carica = useCallback(async () => {
    setCaricamento(true); setErrore(null)
    try {
      const a = new Date()
      const da = new Date(a.getTime() - giorni * 86400000)
      const { data, error } = await supabase
        .from('v_break_even_giornaliero')
        .select('data,incasso,coperti,costo_personale,costo_fisso_giorno,food_cost_pct,metodo_food,break_even,scostamento')
        .eq('sede', sede)
        .gte('data', iso(da)).lte('data', iso(a))
        .order('data')
      if (error) throw error
      setRighe(data ?? [])
    } catch (e) {
      // Niente fallback a []: "nessun giorno sotto break-even" sarebbe una
      // rassicurazione falsa se la vista non ha risposto.
      setRighe(null)
      setErrore(e?.message || String(e))
    } finally {
      setCaricamento(false)
    }
  }, [sede, giorni])

  useEffect(() => { carica() }, [carica])

  const sintesi = useMemo(() => {
    if (!righe?.length) return null
    const conIncasso = righe.filter(r => Number(r.incasso) > 0)
    const sotto = conIncasso.filter(r => Number(r.scostamento) < 0)
    const totScost = conIncasso.reduce((s, r) => s + Number(r.scostamento || 0), 0)
    const metodi = [...new Set(righe.map(r => r.metodo_food))]
    return {
      giorni: conIncasso.length,
      sotto: sotto.length,
      peggiore: sotto.slice().sort((x, y) => Number(x.scostamento) - Number(y.scostamento))[0],
      totScost,
      stimato: metodi.includes('media mobile 30 giorni'),
    }
  }, [righe])

  if (caricamento) return (
    <div className="flex items-center gap-2 p-6 text-slate-500">
      <Loader2 className="w-4 h-4 animate-spin" /> Calcolo il break-even…
    </div>
  )
  if (errore) return (
    <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
      <AlertTriangle className="w-4 h-4 inline mr-1" />
      Break-even non disponibile: {errore}
    </div>
  )
  if (!righe?.length) return null

  const grafico = righe
    .filter(r => Number(r.incasso) > 0)
    .map(r => ({
      giorno: String(r.data).slice(8, 10) + '/' + String(r.data).slice(5, 7),
      incasso: Number(r.incasso),
      break_even: Number(r.break_even),
      scostamento: Number(r.scostamento),
    }))

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Target className="w-4 h-4 text-slate-500" />
            Break-even giornaliero
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Quanto serviva incassare per coprire personale, materie e costi fissi.
            Ultimi {giorni} giorni.
          </p>
        </div>
        {sintesi && (
          <div className="flex gap-2 flex-wrap">
            <div className={`text-xs px-3 py-2 rounded-lg border ${sintesi.sotto > 0
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
              {sintesi.sotto > 0 ? <TrendingDown className="w-3.5 h-3.5 inline mr-1" />
                                 : <TrendingUp className="w-3.5 h-3.5 inline mr-1" />}
              <strong>{sintesi.sotto}</strong> giorni sotto break-even su {sintesi.giorni}
              {sintesi.peggiore && (
                <div className="opacity-75">
                  peggiore {String(sintesi.peggiore.data).slice(8, 10)}/{String(sintesi.peggiore.data).slice(5, 7)}
                  {' '}({eur(sintesi.peggiore.scostamento)})
                </div>
              )}
            </div>
            <div className={`text-xs px-3 py-2 rounded-lg border ${sintesi.totScost >= 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-red-50 border-red-200 text-red-700'}`}>
              margine sul periodo
              <div className="font-semibold text-sm">{eur(sintesi.totScost)}</div>
            </div>
          </div>
        )}
      </header>

      {sintesi?.stimato && (
        <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
          I giorni del mese in corso usano la <strong>media mobile a 30 giorni</strong> per
          l'incidenza materie: le fatture del mese non sono ancora arrivate tutte, e usare
          solo quelle registrate farebbe sembrare il food cost molto più basso di quello reale.
        </p>
      )}

      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <ComposedChart data={grafico} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="giorno" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v, n) => [eur(v), n === 'incasso' ? 'incassato' : 'break-even']} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Bar dataKey="incasso" name="incasso"
                 fill="#93c5fd" shape={(p) => (
                   <rect {...p} fill={p.payload.scostamento < 0 ? '#fca5a5' : '#93c5fd'} />
                 )} />
            <Line type="monotone" dataKey="break_even" name="break-even"
                  stroke="#dc2626" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-slate-400">
        Break-even = (personale + costi fissi) ÷ (1 − incidenza materie). Stesse definizioni
        del riepilogo mensile: nei mesi chiusi la somma dei giorni torna al totale del mese.
      </p>
    </section>
  )
}
