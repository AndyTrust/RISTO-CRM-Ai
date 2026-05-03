/**
 * TurniPage.jsx — Gestione turni professionale v3
 * Shared context, 6 tab collegate, planning AI, ore tracking, dedup dipendenti
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { turni as turniApi, employees as empApi, repartiApi } from '../api/client'
import { bustePaga as bustePagaApi, venduto as vendutoApi } from '../api/client'
import supabase from '../supabase'

// ─── COSTANTI ─────────────────────────────────────────────────────────────────

const TURNO_TYPES = ['Pranzo', 'Cena', 'Intero', 'Split', 'Riposo', 'Ferie', 'Malattia']
const TURNO_LAVORO = ['Pranzo', 'Cena', 'Intero', 'Split']

const TURNO_META = {
  Pranzo:   { colore: '#fef3c7', testo: '#92400e', ico: '🌞', inizio: '11:30', fine: '15:30', ore: 4 },
  Cena:     { colore: '#dbeafe', testo: '#1e40af', ico: '🌙', inizio: '18:30', fine: '23:30', ore: 5 },
  Intero:   { colore: '#fee2e2', testo: '#991b1b', ico: '🔴', inizio: '11:30', fine: '23:30', ore: 10 },
  Split:    { colore: '#f3e8ff', testo: '#6b21a8', ico: '⚡', inizio: '11:30', fine: '23:30', ore: 8 },
  Riposo:   { colore: '#f3f4f6', testo: '#6b7280', ico: '😴', inizio: '',      fine: '',      ore: 0 },
  Ferie:    { colore: '#d1fae5', testo: '#065f46', ico: '🌴', inizio: '',      fine: '',      ore: 0 },
  Malattia: { colore: '#fce7f3', testo: '#9d174d', ico: '🤒', inizio: '',      fine: '',      ore: 0 },
}

const GIORNI = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom']
const CCNL = 1.9653
const MESI_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const toYMD = d => {
  const dt = d instanceof Date ? d : new Date(d)
  const y = dt.getFullYear()
  const m = String(dt.getMonth()+1).padStart(2,'0')
  const dd = String(dt.getDate()).padStart(2,'0')
  return `${y}-${m}-${dd}`
}

const getMondayOf = (d = new Date()) => {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = day === 0 ? -6 : 1 - day
  dt.setDate(dt.getDate() + diff)
  dt.setHours(0,0,0,0)
  return dt
}

const getWeekDays = (monday) => Array.from({length:7}, (_,i) => {
  const d = new Date(monday); d.setDate(d.getDate()+i); return d
})

const getWeekLabel = (monday) => {
  const d = monday instanceof Date ? monday : new Date(monday)
  const y = d.getFullYear()
  const start = new Date(y, 0, 1)
  const wn = Math.ceil(((d - start) / 864e5 + start.getDay()) / 7)
  return `${y}-W${String(wn).padStart(2,'0')}`
}

const calcHours = (inizio, fine) => {
  if (!inizio || !fine) return 0
  const [h1,m1] = inizio.split(':').map(Number)
  const [h2,m2] = fine.split(':').map(Number)
  const mins = (h2*60+m2) - (h1*60+m1)
  return Math.max(0, Math.round(mins/60*10)/10)
}

const normUp = s => (s||'').toUpperCase().trim()

const matchBustaPaga = (emp, bpList) => {
  if (!bpList?.length) return null
  const empName = normUp(emp.name)
  const alias = normUp(emp.buste_paga_name)
  return bpList.find(bp => {
    const raw = normUp(bp.employee_name)
    const parts = raw.split(' ')
    const inverted = parts.length >= 2 ? parts.slice(1).join(' ') + ' ' + parts[0] : raw
    return raw === empName || inverted === empName ||
      (alias && (raw.includes(alias) || inverted.includes(alias)))
  }) || null
}

const matchVenduto = (emp, vendutoOps) => {
  if (!vendutoOps?.length) return null
  const empName = normUp(emp.name)
  const alias = normUp(emp.buste_paga_name)
  const firstName = empName.split(' ')[0]
  return vendutoOps.find(op => {
    const opN = normUp(op)
    return opN === empName || opN === alias || opN === firstName || (alias && alias === opN)
  }) || null
}

// ─── SHARED HOOK ──────────────────────────────────────────────────────────────

function useTurniData(selectedSede, selectedWeek, selectedMonth) {
  const [employees, setEmployees] = useState([])
  const [reparti, setReparti] = useState([])
  const [fabbisogno, setFabbisogno] = useState([])
  const [shifts, setShifts] = useState([])
  const [bozzaShifts, setBozzaShifts] = useState([])
  const [bustePaga, setBustePaga] = useState([])
  const [vendutoOps, setVendutoOps] = useState([])
  const [regole, setRegole] = useState([])
  const [monthlyHours, setMonthlyHours] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const load = async () => {
      try {
        const [emps, reps, fab] = await Promise.all([
          empApi.getAll(),
          repartiApi.getAll(),
          repartiApi.getFabbisogno(),
        ])
        setEmployees((emps||[]).filter(e => e.active !== false))
        setReparti(reps||[])
        setFabbisogno(fab||[])
      } catch(e) { setError(e.message) }
    }
    load()

    // ── Cross-page reactivity: ricarica dipendenti se un'altra tab li modifica ─
    const onStorage = (e) => { if (e.key === 'crm_employee_updated') load() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const loadShifts = useCallback(async () => {
    if (!selectedWeek) return
    try {
      const from = toYMD(selectedWeek)
      const to_dt = new Date(selectedWeek); to_dt.setDate(to_dt.getDate()+6)
      const to = toYMD(to_dt)
      const sede = selectedSede === 'ALL' ? null : selectedSede
      const rows = await turniApi.getByPeriod(from, to, sede)
      setShifts(rows||[])
    } catch(e) { console.error('shifts load', e) }
  }, [selectedWeek, selectedSede])

  const loadBozza = useCallback(async () => {
    if (!selectedWeek) return
    try {
      const weekLabel = getWeekLabel(selectedWeek)
      const sede = selectedSede === 'ALL' ? null : selectedSede
      let q = supabase.from('shifts').select('*').eq('stato','bozza').eq('settimana_label', weekLabel)
      if (sede) q = q.eq('sede', sede)
      const { data } = await q
      setBozzaShifts(data||[])
    } catch(e) { console.error('bozza load', e) }
  }, [selectedWeek, selectedSede])

  useEffect(() => { loadShifts() }, [loadShifts])
  useEffect(() => { loadBozza() }, [loadBozza])

  useEffect(() => {
    if (!selectedMonth) return
    const load = async () => {
      try {
        const [bp, hoursMap] = await Promise.all([
          bustePagaApi.getAll({ anno: selectedMonth.anno, mese: selectedMonth.mese }),
          turniApi.getMonthlyHours(selectedMonth.anno, selectedMonth.mese, selectedSede === 'ALL' ? null : selectedSede),
        ])
        setBustePaga(bp||[])
        setMonthlyHours(hoursMap||{})
      } catch(e) { console.error('buste load', e) }
    }
    load()
  }, [selectedMonth, selectedSede])

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await supabase.from('venduto_camerieri').select('operatore').order('operatore')
        const uniq = [...new Set((data||[]).map(r => r.operatore))]
        setVendutoOps(uniq)
      } catch(e) { console.error('venduto ops', e) }
    }
    load()
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const rows = await turniApi.getRegole()
        setRegole(rows||[])
      } catch(e) { console.error('regole', e) }
      setLoading(false)
    }
    load()
  }, [])

  const filteredEmps = useMemo(() =>
    selectedSede === 'ALL' ? employees : employees.filter(e => e.sede === selectedSede),
  [employees, selectedSede])

  const repartoById = useMemo(() => Object.fromEntries(reparti.map(r => [r.id, r])), [reparti])

  const shiftsMap = useMemo(() => {
    const map = {}
    for (const s of shifts) {
      const key = `${s.employee_id}|${s.date}`
      if (!map[key]) map[key] = []
      map[key].push(s)
    }
    return map
  }, [shifts])

  const enrichedEmps = useMemo(() => {
    return filteredEmps.map(emp => {
      const bp = matchBustaPaga(emp, bustePaga)
      const vendutoMatch = matchVenduto(emp, vendutoOps)
      const regola = regole.find(r => r.employee_id === emp.id)
      const hoursData = monthlyHours[emp.id] || { ore: 0, turni: 0, assenze: 0 }

      // Priorità ore contratto: 1) busta paga (ore_mensili) 2) regola 3) employee diretto
      const oreContratto = bp?.ore_mensili || regola?.ore_contratto_mensili || emp.ore_contratto || 0
      const oreSettimanali = bp?.ore_settimanali || regola?.ore_settimanali || emp.ore_settimanali || 0
      // PT%: lookup standard (evita arrotondamenti tipo 62.5→63)
      const PT_ORE_MAP = { 160: 100, 120: 75, 100: 62.5, 80: 50 }
      const percentualePt = bp?.percentuale_pt
        ? parseFloat(bp.percentuale_pt)
        : (PT_ORE_MAP[oreContratto] ?? (oreContratto > 0 ? Math.round(oreContratto / 1.6) / 10 : null))
      const oreRimanenti = Math.max(0, oreContratto - hoursData.ore)
      const reparto = repartoById[emp.reparto_id]

      const netto       = bp ? parseFloat(bp.netto) : 0
      const costoAz     = bp?.costo_azienda ? parseFloat(bp.costo_azienda) : netto * CCNL
      const splitMA     = emp.sede_split_ma ?? 100
      return {
        ...emp,
        reparto,
        bustaPaga: bp,
        vendutoAlias: vendutoMatch,
        regola,
        hoursData,
        oreContratto,
        oreSettimanali,
        percentualePt,
        oreRimanenti,
        netto,
        costoAzienda: costoAz,
        costoMA: costoAz * (splitMA/100),
        costoPN: costoAz * ((100-splitMA)/100),
      }
    })
  }, [filteredEmps, bustePaga, vendutoOps, regole, monthlyHours, repartoById])

  const empsWithoutReparto = useMemo(() =>
    filteredEmps.filter(e => !e.reparto_id && !['Amministrazione','DIPENDENTE'].includes(e.role)),
  [filteredEmps])

  return {
    employees: filteredEmps, enrichedEmps, reparti, fabbisogno, shifts,
    bozzaShifts, setBozzaShifts,
    bustePaga, vendutoOps, regole, monthlyHours, loading, error,
    shiftsMap, repartoById, empsWithoutReparto,
    reload: loadShifts,
    reloadBozza: loadBozza,
    setRegole,
  }
}

// ─── SHIFT CELL ───────────────────────────────────────────────────────────────

function ShiftCell({ shift, employee, date, onClick }) {
  const shifts = shift || []
  if (!shifts.length) return (
    <button onClick={() => onClick(null, employee, date)}
      className="w-full h-12 border border-dashed border-gray-200 rounded hover:bg-gray-50 hover:border-gray-300 transition-all text-gray-300 text-xs">
      +
    </button>
  )
  const s = shifts[0]
  const meta = TURNO_META[s.turno_tipo] || TURNO_META.Pranzo
  const isWeekend = [6,0].includes(new Date(date).getDay())
  return (
    <button onClick={() => onClick(s, employee, date)}
      style={{ backgroundColor: meta.colore, color: meta.testo, borderColor: meta.colore }}
      className={`w-full h-12 rounded border-2 text-xs font-medium p-1 flex flex-col items-center justify-center gap-0.5 hover:opacity-80 transition-all ${isWeekend ? 'ring-1 ring-amber-300' : ''}`}>
      <span className="text-base leading-none">{meta.ico}</span>
      <span className="text-[10px] font-bold">{s.turno_tipo}</span>
      {s.ora_inizio && <span className="text-[9px] opacity-70">{s.ora_inizio}–{s.ora_fine}</span>}
    </button>
  )
}

// ─── SHIFT MODAL ──────────────────────────────────────────────────────────────

function ShiftModal({ shift, employee, date, onSave, onDelete, onClose }) {
  const isNew = !shift?.id
  const [tipo, setTipo] = useState(shift?.turno_tipo || 'Cena')
  const [oraInizio, setOraInizio] = useState(shift?.ora_inizio || TURNO_META['Cena'].inizio)
  const [oraFine, setOraFine]   = useState(shift?.ora_fine   || TURNO_META['Cena'].fine)
  const [note, setNote]         = useState(shift?.notes || '')
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    const meta = TURNO_META[tipo]
    if (meta?.inizio) { setOraInizio(meta.inizio); setOraFine(meta.fine) }
    else { setOraInizio(''); setOraFine('') }
  }, [tipo])

  const ore = calcHours(oraInizio, oraFine)

  const save = async () => {
    setSaving(true)
    try {
      await onSave({
        id: shift?.id,
        employee_id: employee.id,
        employee_name: employee.name,
        employee_code: employee.code,
        sede: employee.sede,
        date: toYMD(date instanceof Date ? date : new Date(date+'T12:00:00')),
        turno_tipo: tipo,
        ora_inizio: oraInizio || null,
        ora_fine: oraFine || null,
        hours: ore,
        ruolo: employee.role,
        notes: note || null,
        reparto_id: employee.reparto_id || null,
      })
      onClose()
    } catch(e) { alert('Errore: ' + e.message) }
    setSaving(false)
  }

  const del = async () => {
    if (!window.confirm('Elimina questo turno?')) return
    setSaving(true)
    try { await onDelete(shift.id); onClose() }
    catch(e) { alert('Errore: ' + e.message) }
    setSaving(false)
  }

  const dateStr = date instanceof Date
    ? date.toLocaleDateString('it-IT', {weekday:'long', day:'numeric', month:'long'})
    : new Date(date+'T12:00:00').toLocaleDateString('it-IT', {weekday:'long', day:'numeric', month:'long'})

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <p className="font-bold text-gray-900">{employee?.name}</p>
            <p className="text-sm text-gray-500">{dateStr}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Tipo Turno</label>
            <div className="grid grid-cols-4 gap-2">
              {TURNO_TYPES.map(t => {
                const meta = TURNO_META[t]
                return (
                  <button key={t} onClick={() => setTipo(t)}
                    style={tipo===t ? {backgroundColor:meta.colore,color:meta.testo,borderColor:meta.testo} : {}}
                    className={`p-2 rounded-lg border-2 text-center transition-all ${tipo===t ? 'border-2 font-bold' : 'border-gray-200 hover:border-gray-300'}`}>
                    <div className="text-lg">{meta.ico}</div>
                    <div className="text-[10px] font-medium">{t}</div>
                  </button>
                )
              })}
            </div>
          </div>
          {TURNO_LAVORO.includes(tipo) && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-600">Inizio</label>
                <input type="time" value={oraInizio} onChange={e => setOraInizio(e.target.value)}
                  className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1"/>
              </div>
              <div>
                <label className="text-xs text-gray-600">Fine</label>
                <input type="time" value={oraFine} onChange={e => setOraFine(e.target.value)}
                  className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1"/>
              </div>
              <div>
                <label className="text-xs text-gray-600">Ore</label>
                <div className="mt-1 border rounded-lg px-2 py-1.5 text-sm bg-gray-50 font-bold text-center">{ore}h</div>
              </div>
            </div>
          )}
          <div>
            <label className="text-xs text-gray-600">Note</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder="Facoltativo…" className="w-full border rounded-lg px-3 py-2 text-sm mt-1"/>
          </div>
        </div>
        <div className="p-4 border-t flex gap-2">
          {!isNew && (
            <button onClick={del} disabled={saving}
              className="px-3 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50">
              Elimina
            </button>
          )}
          <button onClick={onClose} className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 ml-auto">Annulla</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 font-medium">
            {saving ? '…' : isNew ? 'Aggiungi' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TAB: SETTIMANA ───────────────────────────────────────────────────────────

function SettimanaTab({ ctx }) {
  const { enrichedEmps, reparti, fabbisogno, shifts, shiftsMap, reload } = ctx
  const [modal, setModal] = useState(null)
  const [filterReparto, setFilterReparto] = useState('ALL')
  const weekDays = getWeekDays(ctx.selectedWeek)

  const displayed = useMemo(() =>
    filterReparto === 'ALL' ? enrichedEmps
      : filterReparto === '__none__' ? enrichedEmps.filter(e => !e.reparto_id)
      : enrichedEmps.filter(e => e.reparto_id === filterReparto),
  [enrichedEmps, filterReparto])

  const byReparto = useMemo(() => {
    const groups = {}
    for (const emp of displayed) {
      const key = emp.reparto_id || '__none__'
      if (!groups[key]) groups[key] = {
        reparto: emp.reparto || {id:'__none__', nome:'Senza Reparto', colore:'#9ca3af', icona:'👤'},
        emps: []
      }
      groups[key].emps.push(emp)
    }
    return Object.values(groups).sort((a,b) => (a.reparto.ordine||99) - (b.reparto.ordine||99))
  }, [displayed])

  const getCopertura = useCallback((repartoId, date) => {
    const dayStr = toYMD(date)
    const count = shifts.filter(s =>
      s.reparto_id === repartoId && s.date === dayStr && TURNO_LAVORO.includes(s.turno_tipo)
    ).length
    const fab = fabbisogno.filter(f =>
      f.reparto_id === repartoId &&
      (f.sede === ctx.selectedSede || f.sede === 'ALL' || ctx.selectedSede === 'ALL')
    )
    const min = fab.reduce((s,f) => s+(f.min_persone||0), 0)
    const max = fab.reduce((s,f) => s+(f.max_persone||0), 0)
    return { count, min, max }
  }, [shifts, fabbisogno, ctx.selectedSede])

  const handleSave = async (data) => {
    if (data.id) await turniApi.update(data.id, data)
    else await turniApi.upsert(data)
    await reload()
  }

  const empWeekHours = useMemo(() => {
    const map = {}
    for (const s of shifts) {
      if (!map[s.employee_id]) map[s.employee_id] = 0
      if (TURNO_LAVORO.includes(s.turno_tipo)) map[s.employee_id] += parseFloat(s.hours)||0
    }
    return map
  }, [shifts])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 p-4 bg-white rounded-xl border shadow-sm">
        <button onClick={() => { const p = new Date(ctx.selectedWeek); p.setDate(p.getDate()-7); ctx.setSelectedWeek(p) }}
          className="px-3 py-1.5 border rounded-lg hover:bg-gray-50 text-sm">← Prec</button>
        <button onClick={() => ctx.setSelectedWeek(getMondayOf())}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">Oggi</button>
        <button onClick={() => { const n = new Date(ctx.selectedWeek); n.setDate(n.getDate()+7); ctx.setSelectedWeek(n) }}
          className="px-3 py-1.5 border rounded-lg hover:bg-gray-50 text-sm">Succ →</button>
        <div className="font-semibold text-gray-800 text-sm">
          {weekDays[0].toLocaleDateString('it-IT',{day:'numeric',month:'short'})} – {weekDays[6].toLocaleDateString('it-IT',{day:'numeric',month:'long',year:'numeric'})}
        </div>
        <div className="ml-auto flex gap-2">
          <select value={filterReparto} onChange={e => setFilterReparto(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm">
            <option value="ALL">Tutti i reparti</option>
            {reparti.map(r => <option key={r.id} value={r.id}>{r.icona} {r.nome}</option>)}
            <option value="__none__">Senza Reparto</option>
          </select>
          <select value={ctx.selectedSede} onChange={e => ctx.setSelectedSede(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm font-medium">
            <option value="MA">🍽 Mameli</option>
            <option value="PN">🏪 Predda Niedda</option>
            <option value="ALL">Entrambe</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700 w-48 sticky left-0 bg-gray-50 z-10">Dipendente</th>
              {weekDays.map((d,i) => {
                const isToday = toYMD(d) === toYMD(new Date())
                const isWeekend = [5,6].includes(i)
                return (
                  <th key={i} className={`px-2 py-3 text-center text-sm ${isWeekend ? 'bg-amber-50' : ''} ${isToday ? 'bg-blue-50' : ''}`}>
                    <div className={`font-semibold ${isToday ? 'text-blue-700' : 'text-gray-700'}`}>{GIORNI[i]}</div>
                    <div className={`text-xs ${isToday ? 'text-blue-600 font-bold' : 'text-gray-500'}`}>
                      {d.toLocaleDateString('it-IT',{day:'numeric',month:'short'})}
                    </div>
                  </th>
                )
              })}
              <th className="px-3 py-3 text-center text-xs text-gray-500 w-16">Ore<br/>sett.</th>
            </tr>
          </thead>
          <tbody>
            {byReparto.map(({ reparto, emps }) => (
              <>
                <tr key={`hdr-${reparto.id}`} className="bg-gray-50 border-y">
                  <td colSpan={9} className="px-4 py-2">
                    <span className="text-sm font-bold" style={{color:reparto.colore}}>{reparto.icona} {reparto.nome}</span>
                    <span className="ml-2 text-xs text-gray-400">({emps.length})</span>
                  </td>
                </tr>
                {emps.map(emp => (
                  <tr key={emp.id} className="border-b hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-2 sticky left-0 bg-white z-10">
                      <div className="font-medium text-sm text-gray-900 truncate max-w-[160px]">{emp.name}</div>
                      <div className="text-xs text-gray-500">{emp.role}</div>
                    </td>
                    {weekDays.map((d, i) => {
                      const key = `${emp.id}|${toYMD(d)}`
                      const isWeekend = [5,6].includes(i)
                      return (
                        <td key={i} className={`px-1 py-1.5 ${isWeekend ? 'bg-amber-50/30' : ''}`}>
                          <ShiftCell shift={shiftsMap[key]||[]} employee={emp} date={d}
                            onClick={(s,emp,date) => setModal({shift:s,employee:emp,date})}/>
                        </td>
                      )
                    })}
                    <td className="px-3 py-2 text-center">
                      <span className={`text-sm font-bold ${(empWeekHours[emp.id]||0) > 40 ? 'text-red-600' : 'text-gray-700'}`}>
                        {empWeekHours[emp.id]||0}h
                      </span>
                    </td>
                  </tr>
                ))}
                <tr key={`fab-${reparto.id}`} className="border-b border-dashed bg-gray-50/40">
                  <td className="px-4 py-1 sticky left-0 bg-gray-50/40 z-10">
                    <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Copertura</span>
                  </td>
                  {weekDays.map((d, i) => {
                    const cov = getCopertura(reparto.id, d)
                    const ok = cov.min > 0 ? cov.count >= cov.min : null
                    const over = cov.max > 0 && cov.count > cov.max
                    return (
                      <td key={i} className="px-1 py-1 text-center">
                        {cov.min > 0 && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                            over ? 'bg-blue-100 text-blue-700' : ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>{cov.count}/{cov.min}</span>
                        )}
                      </td>
                    )
                  })}
                  <td/>
                </tr>
              </>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2 px-2">
        {TURNO_TYPES.map(t => {
          const meta = TURNO_META[t]
          return (
            <div key={t} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border"
              style={{backgroundColor:meta.colore,color:meta.testo,borderColor:meta.colore}}>
              <span>{meta.ico}</span> {t}
              {meta.inizio && <span className="opacity-60">{meta.inizio}–{meta.fine}</span>}
            </div>
          )
        })}
        <div className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full border border-amber-200">🟡 Weekend</div>
      </div>

      {modal && (
        <ShiftModal shift={modal.shift} employee={modal.employee} date={modal.date}
          onSave={handleSave}
          onDelete={async id => { await turniApi.remove(id); await reload() }}
          onClose={() => setModal(null)}/>
      )}
    </div>
  )
}

// ─── TAB: RIEPILOGO + COSTI ───────────────────────────────────────────────────

function RiepilogoTab({ ctx }) {
  const { enrichedEmps } = ctx
  const [showSplit, setShowSplit] = useState(false)
  const [filterRole, setFilterRole] = useState('ALL')

  const roles = useMemo(() => [...new Set(enrichedEmps.map(e => e.role).filter(Boolean))].sort(), [enrichedEmps])
  const displayed = useMemo(() =>
    filterRole === 'ALL' ? enrichedEmps : enrichedEmps.filter(e => e.role === filterRole),
  [enrichedEmps, filterRole])

  const totals = useMemo(() => displayed.reduce((acc, e) => ({
    netto: acc.netto + e.netto,
    costo: acc.costo + e.costoAzienda,
    costoMA: acc.costoMA + e.costoMA,
    costoPN: acc.costoPN + e.costoPN,
    ore: acc.ore + (e.hoursData?.ore||0),
  }), {netto:0,costo:0,costoMA:0,costoPN:0,ore:0}), [displayed])

  const monthLabel = `${MESI_IT[ctx.selectedMonth.mese-1]} ${ctx.selectedMonth.anno}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 p-4 bg-white rounded-xl border shadow-sm">
        <div className="flex items-center gap-2">
          <button onClick={() => ctx.setSelectedMonth(m => { const d = new Date(m.anno, m.mese-2, 1); return {anno:d.getFullYear(),mese:d.getMonth()+1} })}
            className="px-2 py-1 border rounded hover:bg-gray-50 text-sm">◀</button>
          <span className="font-semibold text-gray-800">{monthLabel}</span>
          <button onClick={() => ctx.setSelectedMonth(m => { const d = new Date(m.anno, m.mese, 1); return {anno:d.getFullYear(),mese:d.getMonth()+1} })}
            className="px-2 py-1 border rounded hover:bg-gray-50 text-sm">▶</button>
        </div>
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm">
          <option value="ALL">Tutti i ruoli</option>
          {roles.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <label className="flex items-center gap-2 ml-auto text-sm cursor-pointer">
          <input type="checkbox" checked={showSplit} onChange={e => setShowSplit(e.target.checked)} className="rounded"/>
          Split MA/PN
        </label>
        <select value={ctx.selectedSede} onChange={e => ctx.setSelectedSede(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm">
          <option value="MA">Mameli</option>
          <option value="PN">Predda Niedda</option>
          <option value="ALL">Entrambe</option>
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {label:'Dipendenti',   val:displayed.length,                                                           ico:'👥'},
          {label:'Netto totale', val:`€${totals.netto.toLocaleString('it-IT',{maximumFractionDigits:0})}`,       ico:'💶'},
          {label:'Costo azienda',val:`€${totals.costo.toLocaleString('it-IT',{maximumFractionDigits:0})}`,       ico:'🏢'},
          {label:'Ore pianificate',val:`${Math.round(totals.ore)}h`,                                             ico:'⏰'},
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border shadow-sm p-4 flex items-center gap-3">
            <div className="text-2xl">{k.ico}</div>
            <div><div className="text-xs text-gray-500">{k.label}</div><div className="font-bold text-gray-900">{k.val}</div></div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
              <th className="text-left px-4 py-3">Dipendente</th>
              <th className="text-left px-4 py-3">Ruolo / Reparto</th>
              <th className="text-center px-3 py-3">Contratto</th>
              <th className="text-center px-3 py-3">Ore mese</th>
              <th className="text-center px-3 py-3">Busta</th>
              <th className="text-right px-4 py-3">Netto</th>
              <th className="text-right px-4 py-3">Costo az.</th>
              {showSplit && <><th className="text-right px-3 py-3 text-blue-600">MA</th><th className="text-right px-3 py-3 text-purple-600">PN</th></>}
            </tr>
          </thead>
          <tbody>
            {displayed.map(emp => {
              const orePerc = emp.oreContratto > 0 ? (emp.hoursData.ore / emp.oreContratto)*100 : null
              return (
                <tr key={emp.id} className="border-b hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-sm text-gray-900">{emp.name}</div>
                    {emp.buste_paga_name && <div className="text-xs text-gray-400">alias: {emp.buste_paga_name}</div>}
                    <div className="text-xs text-gray-400">{emp.sede}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-700">{emp.role}</div>
                    {emp.reparto && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                        style={{backgroundColor:emp.reparto.colore+'22',color:emp.reparto.colore}}>
                        {emp.reparto.icona} {emp.reparto.nome}
                      </span>
                    )}
                  </td>
                  {/* Contratto: PT% + ore sett */}
                  <td className="px-3 py-3 text-center">
                    {emp.percentualePt ? (
                      <>
                        <div className={`text-xs font-bold px-1.5 py-0.5 rounded-full inline-block ${
                          emp.percentualePt >= 100 ? 'bg-blue-100 text-blue-700' :
                          emp.percentualePt >= 75  ? 'bg-purple-100 text-purple-700' :
                          emp.percentualePt >= 62  ? 'bg-amber-100 text-amber-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>{emp.percentualePt}%</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{emp.oreSettimanali}h/sett</div>
                      </>
                    ) : <span className="text-gray-300 text-xs">–</span>}
                  </td>
                  {/* Ore mese: pianificate vs contratto */}
                  <td className="px-3 py-3 text-center">
                    <div className="text-sm font-medium">{Math.round(emp.hoursData.ore)}h</div>
                    {emp.oreContratto > 0 && (
                      <>
                        <div className="text-xs text-gray-400">/ {emp.oreContratto}h</div>
                        <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                          <div className={`h-1.5 rounded-full ${orePerc>100?'bg-red-500':orePerc>85?'bg-yellow-500':'bg-green-500'}`}
                            style={{width:`${Math.min(100,orePerc||0)}%`}}/>
                        </div>
                        {emp.oreRimanenti > 0 && <div className="text-[10px] text-gray-400 mt-0.5">-{emp.oreRimanenti}h</div>}
                      </>
                    )}
                    {emp.hoursData.assenze > 0 && <div className="text-xs text-orange-500 mt-0.5">{emp.hoursData.assenze} ass.</div>}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {emp.bustaPaga
                      ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓</span>
                      : <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">–</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-sm">{emp.netto>0?`€${emp.netto.toLocaleString('it-IT',{maximumFractionDigits:0})}`:'–'}</td>
                  <td className="px-4 py-3 text-right font-bold text-sm">{emp.costoAzienda>0?`€${emp.costoAzienda.toLocaleString('it-IT',{maximumFractionDigits:0})}`:'–'}</td>
                  {showSplit && <>
                    <td className="px-3 py-3 text-right text-sm text-blue-700">{emp.costoMA>0?`€${emp.costoMA.toLocaleString('it-IT',{maximumFractionDigits:0})}`:'–'}</td>
                    <td className="px-3 py-3 text-right text-sm text-purple-700">{emp.costoPN>0?`€${emp.costoPN.toLocaleString('it-IT',{maximumFractionDigits:0})}`:'–'}</td>
                  </>}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 border-t-2 font-bold">
              <td colSpan={5} className="px-4 py-3 text-sm">Totale ({displayed.length})</td>
              <td className="px-4 py-3 text-right">€{totals.netto.toLocaleString('it-IT',{maximumFractionDigits:0})}</td>
              <td className="px-4 py-3 text-right">€{totals.costo.toLocaleString('it-IT',{maximumFractionDigits:0})}</td>
              {showSplit && <>
                <td className="px-3 py-3 text-right text-blue-700">€{totals.costoMA.toLocaleString('it-IT',{maximumFractionDigits:0})}</td>
                <td className="px-3 py-3 text-right text-purple-700">€{totals.costoPN.toLocaleString('it-IT',{maximumFractionDigits:0})}</td>
              </>}
            </tr>
          </tfoot>
        </table>
      </div>
      {displayed.filter(e => !e.bustaPaga).length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
          ⚠️ <strong>{displayed.filter(e=>!e.bustaPaga).length} dipendenti</strong> senza busta paga abbinata per {monthLabel}
        </div>
      )}
    </div>
  )
}

// ─── TAB: GESTIONE ────────────────────────────────────────────────────────────

function GestioneTab({ ctx }) {
  const { shifts, enrichedEmps, reload } = ctx
  const [filterTipo, setFilterTipo] = useState('ALL')
  const [filterEmp, setFilterEmp] = useState('ALL')
  const [selected, setSelected] = useState(new Set())
  const [modal, setModal] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const displayed = useMemo(() => {
    let rows = [...shifts].sort((a,b) => a.date.localeCompare(b.date)||(a.employee_name||'').localeCompare(b.employee_name||''))
    if (filterTipo !== 'ALL') rows = rows.filter(s => s.turno_tipo === filterTipo)
    if (filterEmp !== 'ALL') rows = rows.filter(s => s.employee_id === filterEmp)
    return rows
  }, [shifts, filterTipo, filterEmp])

  const toggleSelect = id => setSelected(s => { const n = new Set(s); n.has(id)?n.delete(id):n.add(id); return n })
  const selectAll = () => setSelected(new Set(displayed.map(s => s.id)))
  const clearSel  = () => setSelected(new Set())

  const bulkDelete = async () => {
    if (!window.confirm(`Elimina ${selected.size} turni?`)) return
    setDeleting(true)
    try { await turniApi.bulkDelete([...selected]); clearSel(); await reload() }
    catch(e) { alert('Errore: '+e.message) }
    setDeleting(false)
  }

  const handleSave = async (data) => {
    if (data.id) await turniApi.update(data.id, data)
    else await turniApi.upsert(data)
    await reload()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 p-4 bg-white rounded-xl border shadow-sm">
        <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm">
          <option value="ALL">Tutti i tipi</option>
          {TURNO_TYPES.map(t => <option key={t} value={t}>{TURNO_META[t]?.ico} {t}</option>)}
        </select>
        <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm max-w-[200px]">
          <option value="ALL">Tutti i dipendenti</option>
          {enrichedEmps.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <span className="text-sm text-gray-500">{displayed.length} turni</span>
        {selected.size > 0 && (
          <div className="ml-auto flex gap-2 items-center">
            <span className="text-sm font-medium text-blue-600">{selected.size} sel.</span>
            <button onClick={bulkDelete} disabled={deleting}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">🗑</button>
            <button onClick={clearSel} className="px-2 py-1.5 border rounded-lg text-sm">✕</button>
          </div>
        )}
        <button onClick={() => setModal({shift:null,employee:enrichedEmps[0]||{},date:new Date()})}
          className="ml-auto px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-medium">
          + Nuovo
        </button>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-x-auto">
        <table className="w-full min-w-[800px]">
          <thead>
            <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-3 w-8">
                <input type="checkbox" onChange={e => e.target.checked ? selectAll() : clearSel()}
                  checked={selected.size===displayed.length&&displayed.length>0} className="rounded"/>
              </th>
              <th className="text-left px-4 py-3">Data</th>
              <th className="text-left px-4 py-3">Dipendente</th>
              <th className="text-left px-3 py-3">Turno</th>
              <th className="text-left px-3 py-3">Orario</th>
              <th className="text-center px-3 py-3">Ore</th>
              <th className="text-center px-3 py-3">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map(s => {
              const meta = TURNO_META[s.turno_tipo] || TURNO_META.Pranzo
              const emp = enrichedEmps.find(e => e.id === s.employee_id) || {id:s.employee_id,name:s.employee_name,code:s.employee_code,sede:s.sede,role:s.ruolo}
              return (
                <tr key={s.id} className={`border-b hover:bg-gray-50/50 ${selected.has(s.id)?'bg-blue-50':''}`}>
                  <td className="px-4 py-3"><input type="checkbox" checked={selected.has(s.id)} onChange={()=>toggleSelect(s.id)} className="rounded"/></td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {new Date(s.date+'T12:00:00').toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'short'})}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-sm">{s.employee_name||'—'}</div>
                    {s.ruolo && <div className="text-xs text-gray-400">{s.ruolo}</div>}
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs font-bold px-2 py-1 rounded-full" style={{backgroundColor:meta.colore,color:meta.testo}}>
                      {meta.ico} {s.turno_tipo}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-600">{s.ora_inizio&&s.ora_fine?`${s.ora_inizio}–${s.ora_fine}`:'–'}</td>
                  <td className="px-3 py-3 text-center text-sm font-medium">{s.hours?`${s.hours}h`:'–'}</td>
                  <td className="px-3 py-3 text-center">
                    <button onClick={() => setModal({shift:s,employee:emp,date:s.date})}
                      className="px-2 py-1 border rounded text-xs hover:bg-gray-50">✏️</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!displayed.length && (
          <div className="text-center py-12 text-gray-400">Nessun turno nella settimana selezionata</div>
        )}
      </div>

      {modal && (
        <ShiftModal shift={modal.shift} employee={modal.employee}
          date={modal.date instanceof Date ? modal.date : new Date((modal.date||toYMD(new Date()))+'T12:00:00')}
          onSave={handleSave}
          onDelete={async id => { await turniApi.remove(id); await reload() }}
          onClose={() => setModal(null)}/>
      )}
    </div>
  )
}

// ─── TAB: REPARTI ─────────────────────────────────────────────────────────────

// Cella fabbisogno inline-editabile
function FabCell({ fab, repartoId, sede, turno, giorno, onSave }) {
  const [editing, setEditing] = useState(false)
  const [min, setMin] = useState(fab?.min_persone ?? '')
  const [max, setMax] = useState(fab?.max_persone ?? '')
  const [inMin, setInMin] = useState(fab?.ora_inizio_min ?? (turno==='Pranzo'?'11:00':'18:00'))
  const [inMax, setInMax] = useState(fab?.ora_inizio_max ?? (turno==='Pranzo'?'12:30':'19:30'))

  const save = async () => {
    await onSave({
      ...(fab||{}),
      reparto_id:     repartoId,
      sede,
      turno_tipo:     turno,
      giorno_tipo:    giorno,
      min_persone:    parseInt(min)||0,
      max_persone:    parseInt(max)||0,
      ora_inizio_min: inMin||null,
      ora_inizio_max: inMax||null,
    })
    setEditing(false)
  }

  if (editing) return (
    <div className="p-2 space-y-1.5 text-xs" onClick={e=>e.stopPropagation()}>
      <div className="flex items-center gap-1">
        <span className="text-gray-400 w-7">Min</span>
        <input type="number" value={min} onChange={e=>setMin(e.target.value)} min={0} max={20}
          className="w-10 border rounded text-center py-0.5 text-xs"/>
        <span className="text-gray-400 mx-0.5">–</span>
        <span className="text-gray-400 w-7">Max</span>
        <input type="number" value={max} onChange={e=>setMax(e.target.value)} min={0} max={20}
          className="w-10 border rounded text-center py-0.5 text-xs"/>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-gray-400 w-14 text-[10px]">Ingresso</span>
        <input type="time" value={inMin} onChange={e=>setInMin(e.target.value)} className="border rounded py-0.5 px-1 text-xs w-[70px]"/>
        <span className="text-gray-400">–</span>
        <input type="time" value={inMax} onChange={e=>setInMax(e.target.value)} className="border rounded py-0.5 px-1 text-xs w-[70px]"/>
      </div>
      <div className="flex gap-1 justify-end">
        <button onClick={save} className="px-2 py-0.5 bg-green-600 text-white rounded text-[10px] hover:bg-green-700">✓ Salva</button>
        <button onClick={()=>setEditing(false)} className="px-2 py-0.5 border rounded text-[10px] hover:bg-gray-50">✕</button>
      </div>
    </div>
  )

  return (
    <button onClick={()=>setEditing(true)} className={`w-full text-left p-2 rounded-lg border transition-all hover:border-blue-300 hover:bg-blue-50/40 group ${fab && fab.min_persone != null ? 'border-gray-200 bg-white' : 'border-dashed border-gray-200 bg-gray-50/50'}`}>
      {fab && fab.min_persone != null ? (
        <div className="space-y-0.5">
          <div className="flex items-center gap-1">
            <span className="font-bold text-sm text-gray-800">{fab.min_persone}</span>
            <span className="text-gray-400 text-xs">–</span>
            <span className="font-bold text-sm text-gray-800">{fab.max_persone}</span>
            <span className="text-xs text-gray-400 ml-0.5">pers.</span>
          </div>
          {(fab.ora_inizio_min||fab.ora_inizio_max) && (
            <div className="text-[10px] text-gray-500">
              ⏰ {fab.ora_inizio_min||'?'} – {fab.ora_inizio_max||'?'}
            </div>
          )}
        </div>
      ) : (
        <span className="text-gray-300 text-xs group-hover:text-blue-400">+ Aggiungi</span>
      )}
    </button>
  )
}

function RepartiTab({ ctx }) {
  const { reparti, fabbisogno, enrichedEmps } = ctx
  const [editingRep, setEditingRep]   = useState(null)
  const [form, setForm]               = useState({nome:'',colore:'#f59e0b',icona:'🍽️',sede:null,attivo:true,ruoli:[],note:'',ordine:10})
  const [saving, setSaving]           = useState(false)
  const [newRuolo, setNewRuolo]       = useState('')
  const [tipoGiorno, setTipoGiorno]   = useState('feriale') // feriale | weekend
  const [fabSede, setFabSede]         = useState('MA')
  const COLORI = ['#f59e0b','#ef4444','#8b5cf6','#3b82f6','#10b981','#f97316','#06b6d4','#6366f1']
  const ICONE  = ['🍽️','👨‍🍳','🍺','🧹','📦','🎯','⭐','🏃','🥘','🔪','🧊','🍷']

  const openNew  = () => { setEditingRep('NEW'); setForm({nome:'',colore:'#f59e0b',icona:'🍽️',sede:null,attivo:true,ruoli:[],note:'',ordine:reparti.length+1}) }
  const openEdit = r  => { setEditingRep(r.id); setForm({...r}) }
  const cancel   = () => { setEditingRep(null); setSaving(false) }

  const saveReparto = async () => {
    setSaving(true)
    try {
      if (editingRep==='NEW') await repartiApi.create(form)
      else await repartiApi.update(editingRep, form)
      const [reps,fab] = await Promise.all([repartiApi.getAll(), repartiApi.getFabbisogno()])
      ctx.setReparti(reps); ctx.setFabbisogno(fab); cancel()
    } catch(e) { alert('Errore: '+e.message) }
    setSaving(false)
  }

  const deleteReparto = async id => {
    if (!window.confirm('Eliminare questo reparto?')) return
    await repartiApi.remove(id)
    ctx.setReparti(await repartiApi.getAll())
  }

  const saveFab = async d => {
    await repartiApi.upsertFabbisogno(d)
    ctx.setFabbisogno(await repartiApi.getFabbisogno())
  }

  const getFab = (rid, sede, turno, giorno) =>
    fabbisogno.find(f => f.reparto_id===rid && f.sede===sede && f.turno_tipo===turno && f.giorno_tipo===giorno) || null

  const TURNI_LABEL = [
    { tipo:'Pranzo', ico:'🌞', orario:'~12:00–15:30', colore:'#fef3c7', testo:'#92400e' },
    { tipo:'Cena',   ico:'🌙', orario:'~19:00–23:30', colore:'#dbeafe', testo:'#1e40af' },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold text-gray-800 flex-1">Reparti e Fabbisogno</h3>
        {/* Controlli globali */}
        <div className="flex items-center gap-2 border rounded-lg p-0.5 bg-gray-50">
          {['feriale','weekend'].map(g=>(
            <button key={g} onClick={()=>setTipoGiorno(g)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${tipoGiorno===g?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
              {g==='feriale'?'🗓 Feriale':'🎉 Weekend'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 border rounded-lg p-0.5 bg-gray-50">
          {[{v:'MA',l:'🍽 Mameli'},{v:'PN',l:'🏪 Predda N.'},{v:'ALL',l:'Entrambe'}].map(s=>(
            <button key={s.v} onClick={()=>setFabSede(s.v)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${fabSede===s.v?'bg-white shadow text-gray-900':'text-gray-500'}`}>
              {s.l}
            </button>
          ))}
        </div>
        <button onClick={openNew} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-medium">+ Reparto</button>
      </div>

      {/* Info note */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs text-blue-800 flex items-start gap-2">
        <span className="text-base mt-0.5">💡</span>
        <div>
          <strong>Full Time</strong> (turno Intero/Split) copre <strong>sia Pranzo che Cena</strong> nella stessa giornata.
          Indica quante persone minimo e massimo servono per ogni turno e il range di orario di ingresso — usati dall'AI per ottimizzare i costi.
        </div>
      </div>

      {/* Form CRUD Reparto */}
      {editingRep && (
        <div className="bg-white rounded-xl border shadow-sm p-5 space-y-4">
          <h4 className="font-semibold text-gray-800">{editingRep==='NEW'?'Nuovo Reparto':`Modifica: ${form.nome}`}</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="col-span-2 md:col-span-1">
              <label className="text-xs text-gray-600 font-medium">Nome *</label>
              <input value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="es. Sala"/>
            </div>
            <div>
              <label className="text-xs text-gray-600 font-medium">Sede</label>
              <select value={form.sede||''} onChange={e=>setForm(f=>({...f,sede:e.target.value||null}))} className="w-full border rounded-lg px-2 py-2 text-sm mt-1">
                <option value="">Entrambe</option>
                <option value="MA">Mameli</option>
                <option value="PN">Predda Niedda</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600 font-medium">Ordine</label>
              <input type="number" value={form.ordine} onChange={e=>setForm(f=>({...f,ordine:parseInt(e.target.value)||0}))}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"/>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-600 font-medium">Icona</label>
              <div className="flex gap-2 flex-wrap mt-1">
                {ICONE.map(ic=>(
                  <button key={ic} onClick={()=>setForm(f=>({...f,icona:ic}))}
                    className={`text-xl p-1.5 rounded-lg border-2 ${form.icona===ic?'border-blue-500 bg-blue-50':'border-gray-200'}`}>{ic}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-600 font-medium">Colore</label>
              <div className="flex gap-2 flex-wrap mt-1">
                {COLORI.map(c=>(
                  <button key={c} onClick={()=>setForm(f=>({...f,colore:c}))} style={{backgroundColor:c}}
                    className={`w-7 h-7 rounded-full border-2 ${form.colore===c?'border-gray-900 scale-110':'border-transparent'}`}/>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 font-medium">Note</label>
            <input value={form.note||''} onChange={e=>setForm(f=>({...f,note:e.target.value}))}
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1"/>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={cancel} className="px-4 py-2 border rounded-lg text-sm">Annulla</button>
            <button onClick={saveReparto} disabled={saving||!form.nome}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50 font-medium">
              {saving?'…':'Salva'}
            </button>
          </div>
        </div>
      )}

      {/* Schede reparti */}
      <div className="grid md:grid-cols-2 gap-4">
        {reparti.map(rep => {
          const repEmps = enrichedEmps.filter(e=>e.reparto_id===rep.id)
          const sedi = fabSede === 'ALL' ? ['MA','PN'] : [fabSede]
          return (
            <div key={rep.id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
              {/* Header reparto */}
              <div className="p-4 flex items-center gap-3 border-b" style={{borderLeftColor:rep.colore,borderLeftWidth:4}}>
                <span className="text-2xl">{rep.icona}</span>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-gray-900">{rep.nome}</h4>
                  {rep.note && <p className="text-xs text-gray-500 truncate">{rep.note}</p>}
                  <div className="flex gap-1 mt-1 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium" style={{backgroundColor:rep.colore}}>{repEmps.length} dipendenti</span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={()=>openEdit(rep)} className="p-1.5 border rounded-lg hover:bg-gray-50 text-sm">✏️</button>
                  <button onClick={()=>deleteReparto(rep.id)} className="p-1.5 border border-red-200 rounded-lg hover:bg-red-50 text-sm">🗑</button>
                </div>
              </div>

              {/* Matrice fabbisogno Pranzo / Cena per sede */}
              <div className="p-4 space-y-3">
                {sedi.map(sede => (
                  <div key={sede}>
                    {fabSede === 'ALL' && (
                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                        {sede === 'MA' ? '🍽 Mameli' : '🏪 Predda Niedda'}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      {TURNI_LABEL.map(({tipo, ico, orario, colore, testo}) => (
                        <div key={tipo} className="rounded-lg border overflow-hidden">
                          <div className="px-3 py-1.5 flex items-center gap-1.5 border-b" style={{backgroundColor:colore}}>
                            <span>{ico}</span>
                            <span className="text-xs font-bold" style={{color:testo}}>{tipo}</span>
                            <span className="text-[10px] ml-auto opacity-60" style={{color:testo}}>{orario}</span>
                          </div>
                          <div className="p-1.5">
                            <FabCell
                              fab={getFab(rep.id, sede, tipo, tipoGiorno)}
                              repartoId={rep.id}
                              sede={sede}
                              turno={tipo}
                              giorno={tipoGiorno}
                              onSave={saveFab}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Full time note */}
                    <div className="mt-1.5 text-[10px] text-gray-400 flex items-center gap-1">
                      <span>🔴</span>
                      Full Time copre entrambi i turni in un giorno
                    </div>
                  </div>
                ))}
              </div>

              {/* Dipendenti */}
              <div className="px-4 pb-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Team</p>
                <div className="flex flex-wrap gap-1">
                  {repEmps.slice(0,10).map(e=>(
                    <span key={e.id} className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                      style={{backgroundColor:rep.colore+'22',color:rep.colore}}>
                      {e.name.split(' ')[0]}
                    </span>
                  ))}
                  {repEmps.length>10 && <span className="text-[10px] text-gray-400">+{repEmps.length-10}</span>}
                  {!repEmps.length && <span className="text-xs text-gray-400 italic">Nessuno assegnato</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── TAB: REGOLE ──────────────────────────────────────────────────────────────

function RegoleTab({ ctx }) {
  const { enrichedEmps, regole, setRegole } = ctx
  const [editing, setEditing] = useState({})
  const [saving, setSaving] = useState(null)

  const getRegola = emp => regole.find(r=>r.employee_id===emp.id)||{
    employee_id:emp.id,ore_contratto_mensili:emp.ore_contratto||0,ore_settimanali:emp.ore_settimanali||0,
    turni_min_settimana:0,turni_max_settimana:6,giorni_riposo_min:1,note:''
  }

  const startEdit = emp => setEditing(e=>({...e,[emp.id]:{...getRegola(emp)}}))

  const saveRegola = async empId => {
    setSaving(empId)
    try {
      const saved = await turniApi.upsertRegola(editing[empId])
      setRegole(prev=>[...prev.filter(r=>r.employee_id!==empId),saved])
      setEditing(e=>{const n={...e};delete n[empId];return n})
    } catch(err) { alert('Errore: '+err.message) }
    setSaving(null)
  }

  const grouped = useMemo(()=>{
    const g={}
    for(const emp of enrichedEmps){
      const key=emp.reparto?.nome||emp.role||'Altro'
      if(!g[key])g[key]=[]
      g[key].push(emp)
    }
    return g
  },[enrichedEmps])

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
        💡 Ore contrattuali auto-calcolate da buste paga (gen 2026). Regola: FT=160h/mese | PT 62.5%=100h | PT 75%=120h | PT 50%=80h. Modifica se la busta paga è cambiata.
      </div>
      {Object.entries(grouped).map(([gruppo,emps])=>(
        <div key={gruppo} className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b font-semibold text-gray-700 text-sm">{gruppo} ({emps.length})</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b text-xs text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-2">Dipendente</th>
                  <th className="text-center px-3 py-2">PT%</th>
                  <th className="text-center px-3 py-2">Ore/mese</th>
                  <th className="text-center px-3 py-2">Ore/sett</th>
                  <th className="text-center px-3 py-2">Min t/sett</th>
                  <th className="text-center px-3 py-2">Max t/sett</th>
                  <th className="text-center px-3 py-2">Riposi min</th>
                  <th className="text-left px-3 py-2">Note</th>
                  <th className="text-center px-3 py-2">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {emps.map(emp=>{
                  const isEditing=!!editing[emp.id]
                  const reg=isEditing?editing[emp.id]:getRegola(emp)
                  const setReg=(key,val)=>setEditing(e=>({...e,[emp.id]:{...e[emp.id],[key]:val}}))
                  return (
                    <tr key={emp.id} className={`border-b hover:bg-gray-50/50 ${isEditing?'bg-blue-50':''}`}>
                      <td className="px-4 py-2">
                        <div className="font-medium text-sm">{emp.name}</div>
                        <div className="text-xs text-gray-400">{emp.role}</div>
                      </td>
                      {isEditing ? (
                        <>
                          {/* PT% read-only da busta paga */}
                          <td className="px-2 py-2 text-center">
                            <span className="text-xs text-gray-500">{emp.percentualePt ? `${emp.percentualePt}%` : '–'}</span>
                          </td>
                          <td className="px-2 py-2"><input type="number" value={reg.ore_contratto_mensili} onChange={e=>setReg('ore_contratto_mensili',parseInt(e.target.value)||0)} className="w-16 border rounded text-center text-sm py-1"/></td>
                          <td className="px-2 py-2"><input type="number" value={reg.ore_settimanali} onChange={e=>setReg('ore_settimanali',parseInt(e.target.value)||0)} className="w-14 border rounded text-center text-sm py-1"/></td>
                          <td className="px-2 py-2"><input type="number" value={reg.turni_min_settimana} onChange={e=>setReg('turni_min_settimana',parseInt(e.target.value)||0)} className="w-14 border rounded text-center text-sm py-1"/></td>
                          <td className="px-2 py-2"><input type="number" value={reg.turni_max_settimana} onChange={e=>setReg('turni_max_settimana',parseInt(e.target.value)||0)} className="w-14 border rounded text-center text-sm py-1"/></td>
                          <td className="px-2 py-2"><input type="number" value={reg.giorni_riposo_min} onChange={e=>setReg('giorni_riposo_min',parseInt(e.target.value)||0)} className="w-14 border rounded text-center text-sm py-1"/></td>
                          <td className="px-2 py-2"><input value={reg.note||''} onChange={e=>setReg('note',e.target.value)} className="w-full border rounded text-sm py-1 px-2"/></td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex gap-1 justify-center">
                              <button onClick={()=>saveRegola(emp.id)} disabled={saving===emp.id}
                                className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50">{saving===emp.id?'…':'✓'}</button>
                              <button onClick={()=>setEditing(e=>{const n={...e};delete n[emp.id];return n})}
                                className="px-2 py-1 border rounded text-xs hover:bg-gray-100">✕</button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          {/* PT% da busta paga */}
                          <td className="px-3 py-2 text-center">
                            {emp.percentualePt ? (
                              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                                emp.percentualePt >= 100 ? 'bg-blue-100 text-blue-700' :
                                emp.percentualePt >= 75  ? 'bg-purple-100 text-purple-700' :
                                'bg-amber-100 text-amber-700'
                              }`}>{emp.percentualePt}%</span>
                            ) : <span className="text-gray-300">–</span>}
                          </td>
                          <td className="px-3 py-2 text-center text-sm">{reg.ore_contratto_mensili||'–'}</td>
                          <td className="px-3 py-2 text-center text-sm">{reg.ore_settimanali||'–'}</td>
                          <td className="px-3 py-2 text-center text-sm">{reg.turni_min_settimana??'–'}</td>
                          <td className="px-3 py-2 text-center text-sm">{reg.turni_max_settimana??'–'}</td>
                          <td className="px-3 py-2 text-center text-sm">{reg.giorni_riposo_min??'–'}</td>
                          <td className="px-3 py-2 text-sm text-gray-500 max-w-[150px] truncate">{reg.note||'–'}</td>
                          <td className="px-3 py-2 text-center">
                            <button onClick={()=>startEdit(emp)} className="px-2 py-1 border rounded text-xs hover:bg-gray-100">✏️</button>
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── BOZZA CALENDAR ───────────────────────────────────────────────────────────

const ROLE_ORDER_BOZZA = ['Responsabile','Cameriere','CAMERIERE','Commis','Cuoco','Lavapiatti','DIPENDENTE','Amministrazione']

function BozzaCalendar({ bozzaShifts, weekDays, emps, onEdit, onDelete, onAddShift, onPublish, onDeleteAll, publishing }) {
  const bozzaMap = useMemo(() => {
    const map = {}
    for (const s of bozzaShifts) {
      const key = `${s.employee_id}|${s.date}`
      if (!map[key]) map[key] = []
      map[key].push(s)
    }
    return map
  }, [bozzaShifts])

  const byRole = useMemo(() => {
    const g = {}
    for (const emp of emps) {
      const role = emp.role || 'Altro'
      if (!g[role]) g[role] = []
      g[role].push(emp)
    }
    return g
  }, [emps])

  const orderedRoles = useMemo(() =>
    [...ROLE_ORDER_BOZZA.filter(r => byRole[r]),
     ...Object.keys(byRole).filter(r => !ROLE_ORDER_BOZZA.includes(r))],
  [byRole])

  // Analisi pairing per giorno: avvisa doppio responsabile stesso turno
  const pairingWarnings = useMemo(() => {
    const warns = []
    for (const d of weekDays) {
      const dateStr = toYMD(d)
      for (const turno of ['Pranzo','Cena']) {
        const onDay = bozzaShifts.filter(s => s.date === dateStr &&
          (s.turno_tipo === turno || s.turno_tipo === 'Intero' || s.turno_tipo === 'Split'))
        const resps = onDay.filter(s => {
          const emp = emps.find(e => e.id === s.employee_id)
          return emp && normUp(emp.role||'').includes('RESPONS')
        })
        if (resps.length >= 2) warns.push({
          dateStr, date: d, turno,
          names: resps.map(s => s.employee_name || (emps.find(e=>e.id===s.employee_id)?.name))
        })
      }
    }
    return warns
  }, [bozzaShifts, weekDays, emps])

  // Ore settimanali per dipendente nella bozza
  const bozzaWeekHours = useMemo(() => {
    const map = {}
    for (const s of bozzaShifts) {
      if (!map[s.employee_id]) map[s.employee_id] = 0
      if (TURNO_LAVORO.includes(s.turno_tipo)) map[s.employee_id] += parseFloat(s.hours)||0
    }
    return map
  }, [bozzaShifts])

  return (
    <div className="space-y-3">
      {/* Header bozza */}
      <div className="bg-white rounded-xl border shadow-sm p-4 flex flex-wrap items-center gap-3">
        <div>
          <span className="font-bold text-gray-900">📅 Bozza settimana</span>
          <span className="ml-2 text-sm text-gray-500">{bozzaShifts.length} turni pianificati</span>
          <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">BOZZA</span>
        </div>
        {pairingWarnings.length > 0 && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            ⚠️ {pairingWarnings.length} avvisi doppio responsabile
          </div>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={onDeleteAll}
            className="px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 font-medium">
            🗑 Elimina bozza
          </button>
          <button onClick={onPublish} disabled={publishing || bozzaShifts.length === 0}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50">
            {publishing ? '⏳ Pubblicando…' : `✅ Pubblica (${bozzaShifts.length} turni)`}
          </button>
        </div>
      </div>

      {/* Avvisi pairing responsabili */}
      {pairingWarnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
          <p className="text-xs font-bold text-amber-800">⚠️ Doppio Responsabile stesso turno — verifica o modifica:</p>
          {pairingWarnings.map((w,i) => (
            <div key={i} className="text-xs text-amber-700 flex items-center gap-2">
              <span className="font-medium">{w.date.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'short'})}</span>
              <span className="text-amber-500">→</span>
              <span>{w.turno}:</span>
              <span className="font-semibold">{w.names.filter(Boolean).join(' + ')}</span>
            </div>
          ))}
          <p className="text-[10px] text-amber-600 mt-1">💡 I Responsabili non dovrebbero condividere lo stesso turno salvo esplicita richiesta.</p>
        </div>
      )}

      {/* Griglia bozza */}
      <div className="bg-white rounded-xl border shadow-sm overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700 w-44 sticky left-0 bg-gray-50 z-10">Dipendente</th>
              {weekDays.map((d,i) => {
                const isWeekend = [5,6].includes(i)
                return (
                  <th key={i} className={`px-2 py-3 text-center text-sm ${isWeekend ? 'bg-amber-50' : ''}`}>
                    <div className="font-semibold text-gray-700">{GIORNI[i]}</div>
                    <div className="text-xs text-gray-400">{d.toLocaleDateString('it-IT',{day:'numeric',month:'short'})}</div>
                  </th>
                )
              })}
              <th className="px-3 py-3 text-center text-xs text-gray-500 w-14">Ore<br/>sett.</th>
            </tr>
          </thead>
          <tbody>
            {orderedRoles.map(role => (
              <React.Fragment key={`role-${role}`}>
                <tr className="bg-gray-50 border-y">
                  <td colSpan={9} className="px-4 py-1.5">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{role} ({byRole[role].length})</span>
                  </td>
                </tr>
                {byRole[role].map(emp => {
                  const weekHours = bozzaWeekHours[emp.id] || 0
                  const oreContr = emp.oreSettimanali || emp.ore_settimanali || 40
                  return (
                    <tr key={emp.id} className="border-b hover:bg-gray-50/30 transition-colors">
                      <td className="px-4 py-2 sticky left-0 bg-white z-10">
                        <div className="font-medium text-sm text-gray-900 truncate max-w-[150px]">{emp.name}</div>
                        <div className="text-xs text-gray-400">{emp.role} {emp.percentualePt ? `· PT${emp.percentualePt}%` : ''}</div>
                      </td>
                      {weekDays.map((d, i) => {
                        const key = `${emp.id}|${toYMD(d)}`
                        const dayShifts = bozzaMap[key] || []
                        const isWeekend = [5,6].includes(i)
                        return (
                          <td key={i} className={`px-1 py-1 ${isWeekend ? 'bg-amber-50/20' : ''}`}>
                            {dayShifts.length > 0 ? (
                              <div className="space-y-0.5">
                                {dayShifts.map((s,j) => {
                                  const meta = TURNO_META[s.turno_tipo] || TURNO_META.Pranzo
                                  return (
                                    <div key={j} className="relative group">
                                      <button onClick={() => onEdit(s, emp, d)}
                                        style={{backgroundColor:meta.colore, color:meta.testo}}
                                        className="w-full h-11 rounded text-xs font-medium p-1 flex flex-col items-center justify-center hover:opacity-80 transition-all border border-transparent hover:border-current">
                                        <span className="text-sm leading-none">{meta.ico}</span>
                                        <span className="text-[10px] font-bold">{s.turno_tipo}</span>
                                        {s.ora_inizio && <span className="text-[9px] opacity-70">{s.ora_inizio}–{s.ora_fine}</span>}
                                      </button>
                                      <button onClick={() => onDelete(s.id)}
                                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[9px] hidden group-hover:flex items-center justify-center hover:bg-red-600 z-10">
                                        ×
                                      </button>
                                    </div>
                                  )
                                })}
                              </div>
                            ) : (
                              <button onClick={() => onAddShift(emp, d)}
                                className="w-full h-11 border border-dashed border-gray-200 rounded hover:bg-gray-50 hover:border-blue-300 text-gray-300 hover:text-blue-400 text-xs transition-colors">
                                +
                              </button>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-center">
                        <span className={`text-xs font-bold ${weekHours > oreContr ? 'text-red-600' : weekHours > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                          {weekHours > 0 ? `${weekHours}h` : '–'}
                        </span>
                        {weekHours > oreContr && <div className="text-[9px] text-red-500">over</div>}
                      </td>
                    </tr>
                  )
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-2 px-1">
        {['Pranzo','Cena','Intero','Split','Riposo','Ferie'].map(t => {
          const meta = TURNO_META[t]
          return (
            <div key={t} className="flex items-center gap-1 text-xs px-2 py-1 rounded-full border"
              style={{backgroundColor:meta.colore, color:meta.testo, borderColor:meta.colore}}>
              {meta.ico} {t}
            </div>
          )
        })}
        <div className="text-xs text-gray-400 ml-auto italic">Hover su un turno per eliminarlo</div>
      </div>
    </div>
  )
}

// ─── TAB: AI PLANNER ─────────────────────────────────────────────────────────

// ── Helper: estrae JSON da testo AI con fallback robusti ──────────────────────
function extractJsonFromAI(text) {
  // Tentativo 1: blocco ```json ... ```
  let m = text.match(/```json\s*([\s\S]*?)\s*```/)
  if (m) return { raw: m[1], truncated: false }

  // Tentativo 2: blocco ``` ... ``` senza specifica linguaggio
  m = text.match(/```\s*(\[[\s\S]*?\])\s*```/)
  if (m) return { raw: m[1], truncated: false }

  // Tentativo 3: array JSON grezzo nel testo
  const arrayStart = text.indexOf('[')
  if (arrayStart >= 0) {
    const jsonStr = text.slice(arrayStart)
    if (jsonStr.trim().endsWith(']')) return { raw: jsonStr, truncated: false }

    // Tentativo 4: JSON troncato → recupera fino all'ultimo oggetto completo
    const lastBrace = jsonStr.lastIndexOf('}')
    if (lastBrace > 0) {
      const recovered = jsonStr.slice(0, lastBrace + 1) + ']'
      return { raw: recovered, truncated: true }
    }
  }
  return null
}

function AIPlannerTab({ ctx }) {
  const { enrichedEmps, reparti, fabbisogno, regole, shifts, bozzaShifts, reloadBozza, reload } = ctx
  const [prompt, setPrompt]         = useState('')
  const [aiSede, setAiSede]         = useState(ctx.selectedSede === 'ALL' ? 'MA' : ctx.selectedSede)
  const [aiAnalysis, setAiAnalysis] = useState(null)   // testo analisi AI
  const [aiError, setAiError]       = useState(null)   // errore separato (non sovrascrive analisi)
  const [rawResponse, setRawResponse] = useState(null) // risposta grezza per debug
  const [loading, setLoading]       = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [editModal, setEditModal]   = useState(null)
  const [activeView, setActiveView] = useState('genera')
  const [histLoaded, setHistLoaded] = useState(false)

  const weekDays  = getWeekDays(ctx.selectedWeek)
  const weekLabel = getWeekLabel(ctx.selectedWeek)
  const weekStr   = `${weekDays[0].toLocaleDateString('it-IT',{day:'numeric',month:'long'})} – ${weekDays[6].toLocaleDateString('it-IT',{day:'numeric',month:'long',year:'numeric'})}`
  const sedeEmps  = enrichedEmps.filter(e => e.sede === aiSede)

  // Storico accoppiamenti — caricato una sola volta per sede
  const [historicalContext, setHistoricalContext] = useState('(caricamento storico…)')
  useEffect(() => {
    setHistLoaded(false)
    const load = async () => {
      try {
        const eightWeeksAgo = new Date(); eightWeeksAgo.setDate(eightWeeksAgo.getDate()-56)
        const { data } = await supabase.from('shifts')
          .select('employee_name, date, turno_tipo')
          .eq('stato','pubblicato').eq('sede',aiSede)
          .gte('date', toYMD(eightWeeksAgo))
          .order('date',{ascending:false}).limit(400)
        if (!data?.length) {
          setHistoricalContext('Nessuno storico turni pubblicati ancora — l\'AI genererà un planning di partenza.')
          setHistLoaded(true); return
        }
        // Coppie frequenti
        const groups = {}
        for (const s of data) {
          const key = `${s.date}|${s.turno_tipo}`
          if (!groups[key]) groups[key] = []
          if (s.employee_name) groups[key].push(s.employee_name)
        }
        const pairCount = {}
        for (const group of Object.values(groups)) {
          for (let i=0; i<group.length; i++)
            for (let j=i+1; j<group.length; j++) {
              const pair = [group[i],group[j]].sort().join(' + ')
              pairCount[pair] = (pairCount[pair]||0) + 1
            }
        }
        const top = Object.entries(pairCount).sort((a,b)=>b[1]-a[1]).slice(0,6)
          .map(([pair,n])=>`  ${pair} (${n}x)`)
        const empCount = {}
        for (const s of data) if (s.employee_name) empCount[s.employee_name]=(empCount[s.employee_name]||0)+1
        const empStats = Object.entries(empCount).sort((a,b)=>b[1]-a[1]).slice(0,8)
          .map(([n,c])=>`  ${n}: ${c} turni`)
        setHistoricalContext(`Coppie frequenti (ultimi 2 mesi):\n${top.join('\n')}\nFrequenza turni:\n${empStats.join('\n')}`)
      } catch(e) { setHistoricalContext('(storico non disponibile)') }
      setHistLoaded(true)
    }
    load()
  }, [aiSede])

  useEffect(() => {
    if (bozzaShifts.filter(s=>s.sede===aiSede).length > 0) setActiveView('bozza')
    else setActiveView('genera')
  }, [bozzaShifts, aiSede])

  const buildContext = (histCtx) => {
    // FIX: riceve historicalContext come argomento (evita race condition)
    const empList = sedeEmps.map(e => {
      const reg = regole.find(r => r.employee_id === e.id)
      const ptStr  = e.percentualePt ? ` PT${e.percentualePt}%` : ''
      const oreStr = e.oreSettimanali > 0 ? ` ${e.oreSettimanali}h/sett` : ''
      const turniStr = reg ? ` max${reg.turni_max_settimana||6}t riposi≥${reg.giorni_riposo_min||1}` : ''
      return `${e.name}|${e.role||'?'}|${e.reparto?.nome||'N/A'}${ptStr}${oreStr}${turniStr}`
    }).join('\n')

    const fabList = reparti.map(rep => {
      const fs = fabbisogno.filter(f => f.reparto_id===rep.id && (f.sede===aiSede||!f.sede))
      if (!fs.length) return `${rep.nome}: N/D`
      return `${rep.nome}: ` + fs.map(f => {
        const t = f.giorno_tipo==='weekend' ? 'WE' : 'FER'
        const or = (f.ora_inizio_min||f.ora_inizio_max) ? ` arr${f.ora_inizio_min||'?'}-${f.ora_inizio_max||'?'}` : ''
        return `${f.turno_tipo}[${t}]min${f.min_persone}-max${f.max_persone}${or}`
      }).join(' ')
    }).join('\n')

    const curShifts = shifts.filter(s => s.sede===aiSede && s.stato==='pubblicato')
      .map(s=>`${s.date}|${s.employee_name}|${s.turno_tipo}`)
      .join('\n')

    const dateList = weekDays.map((d,i) => {
      const dow = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'][i]
      return `${toYMD(d)} ${dow}`
    }).join(', ')

    return `SEDE: ${aiSede==='MA'?'Mameli':'Predda Niedda'}
SETTIMANA: ${dateList}

REGOLE:
- Pranzo: ingresso 11:00-12:30, fine ~15:30
- Cena: ingresso 18:00-19:30, fine ~23:30
- Intero/Split=Full Time: copre ENTRAMBI pranzo+cena (solo non-PT)
- PT: un turno al giorno (Pranzo O Cena)
- Sab/Dom = alta affluenza → copertura massima
- Min 1 riposo/sett per dipendente, non superare ore settimanali contratto
- PAIRING: max 1 Responsabile per turno (Pranzo/Cena separati)

DIPENDENTI (nome|ruolo|reparto|PT%|h/sett|vincoli):
${empList}

FABBISOGNO (reparto: turno[tipo]min-max persone):
${fabList}

STORICO: ${histCtx}

GIÀ PUBBLICATI: ${curShifts||'nessuno'}

RICHIESTA: ${prompt||'Genera il planning completo bilanciando costi e copertura'}

OUTPUT OBBLIGATORIO — prima l\'analisi testuale breve, poi esattamente questo JSON:
\`\`\`json
[{"employee_name":"COGNOME NOME","date":"YYYY-MM-DD","turno_tipo":"Pranzo","ora_inizio":"11:30","ora_fine":"15:30","hours":4}]
\`\`\`
IMPORTANTE: includi SOLO i turni lavorativi (Pranzo/Cena/Intero/Ferie). NON includere Riposo. Giorni assenti = riposo automatico.`
  }

  const askAI = async () => {
    if (!histLoaded) {
      setAiError('Storico turni ancora in caricamento — riprova tra un secondo.')
      return
    }
    setLoading(true); setAiAnalysis(null); setAiError(null); setRawResponse(null)
    try {
      // 1. Svuota bozza precedente per questa settimana/sede
      await supabase.from('shifts').delete()
        .eq('stato','bozza').eq('settimana_label',weekLabel).eq('sede',aiSede)

      // 2. API key
      const {data:cfg} = await supabase.from('crm_config').select('value').eq('key','anthropic_api_key').single()
      const apiKey = cfg?.value ? String(cfg.value).replace(/^"|"$/g,'') : ''
      if (!apiKey) throw new Error('API key non configurata (CRM Config → anthropic_api_key)')

      // 3. Chiama Claude — FIX: passa historicalContext esplicitamente + max_tokens 8192
      const contextText = buildContext(historicalContext)
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,  // FIX: era 6000, troppo poco per JSON completo
          system: 'Sei un esperto HR per ristoranti italiani. Genera planning turni ottimizzati. Rispondi in italiano. Il JSON deve essere COMPLETO e valido — non troncare mai la risposta.',
          messages: [{ role: 'user', content: contextText }]
        })
      })

      const jsonResp = await res.json()
      console.log('[AI Planner] stop_reason:', jsonResp.stop_reason, 'usage:', jsonResp.usage)

      // FIX: gestisci errori API separatamente dall'assenza di JSON
      if (jsonResp.error) throw new Error(`API Error: ${jsonResp.error.message || JSON.stringify(jsonResp.error)}`)
      if (!jsonResp.content?.[0]?.text) throw new Error(`Risposta vuota dall\'API (type: ${jsonResp.type})`)

      const text = jsonResp.content[0].text
      setRawResponse(text) // FIX: salva per debug

      // FIX: avvisa se troncato
      const truncated = jsonResp.stop_reason === 'max_tokens'
      if (truncated) console.warn('[AI Planner] Risposta troncata! Tentativo recupero JSON parziale…')

      // 4. Analisi testuale (senza il JSON)
      const analysis = text.replace(/```[\s\S]*?```/g,'').trim()
      setAiAnalysis(analysis || '(nessuna analisi)')

      // 5. FIX: estrazione JSON robusta con più fallback
      const extracted = extractJsonFromAI(text)
      if (!extracted) {
        throw new Error(
          `L'AI non ha incluso un array JSON nella risposta.\n` +
          `Stop reason: ${jsonResp.stop_reason} | Tokens usati: ${jsonResp.usage?.output_tokens}.\n` +
          `Prova a ridurre il numero di dipendenti nel contesto o riprova.`
        )
      }
      if (extracted.truncated) {
        setAiError('⚠️ Risposta AI troncata — recuperati i turni completi. Verifica la bozza e aggiungi quelli mancanti manualmente.')
      }

      let parsed
      try {
        parsed = JSON.parse(extracted.raw)
      } catch(parseErr) {
        throw new Error(`JSON non valido (${parseErr.message}). Risposta parziale salvata nel debug.`)
      }

      // 6. FIX: matching nome dipendente più robusto (include cognome-nome invertito)
      const matchEmp = (name) => {
        const n = normUp(name)
        // 1. match esatto
        let e = sedeEmps.find(e => normUp(e.name) === n)
        if (e) return e
        // 2. alias buste paga
        e = sedeEmps.find(e => normUp(e.buste_paga_name||'') === n)
        if (e) return e
        // 3. confronto parole (cognome + nome)
        const parts = n.split(/\s+/)
        e = sedeEmps.find(emp => {
          const empParts = normUp(emp.name).split(/\s+/)
          return parts.every(p => empParts.includes(p)) || empParts.every(p => parts.includes(p))
        })
        if (e) return e
        // 4. starts-with (primo token)
        e = sedeEmps.find(e => normUp(e.name).startsWith(parts[0]) || n.startsWith(normUp(e.name).split(' ')[0]))
        return e || null
      }

      const bozzaRows = parsed
        .filter(t => t.employee_name && t.date && t.turno_tipo && t.turno_tipo !== 'Riposo')
        .map(t => {
          const emp = matchEmp(t.employee_name)
          const meta = TURNO_META[t.turno_tipo]
          return {
            employee_id:        emp?.id || null,
            employee_name:      t.employee_name,
            employee_code:      emp?.code || null,
            sede:               aiSede,
            date:               t.date,
            turno_tipo:         t.turno_tipo,
            ora_inizio:         t.ora_inizio || meta?.inizio || null,
            ora_fine:           t.ora_fine   || meta?.fine   || null,
            hours:              parseFloat(t.hours) || calcHours(t.ora_inizio, t.ora_fine) || meta?.ore || 0,
            ruolo:              emp?.role || null,
            reparto_id:         emp?.reparto_id || null,
            notes:              t.note || t.notes || null,
            stato:              'bozza',
            settimana_label:    weekLabel,
            bozza_generata_at:  new Date().toISOString(),
          }
        })
        .filter(t => t.employee_id)

      // Dipendenti non trovati → avviso
      const notFound = [...new Set(
        parsed.filter(t => t.turno_tipo !== 'Riposo' && !matchEmp(t.employee_name)).map(t => t.employee_name)
      )]
      if (notFound.length > 0) {
        const warn = `⚠️ ${notFound.length} dipendenti non trovati nel registro: ${notFound.join(', ')}. Controlla i nomi nella tab Regole.`
        setAiError(prev => prev ? prev + '\n' + warn : warn)
      }

      if (bozzaRows.length === 0) throw new Error('Nessun turno con dipendente valido. Verifica i nomi: ' + notFound.join(', '))

      // 7. Inserisce in batch (chunk da 50 per sicurezza)
      for (let i = 0; i < bozzaRows.length; i += 50) {
        const chunk = bozzaRows.slice(i, i+50)
        const { error: insErr } = await supabase.from('shifts').insert(chunk)
        if (insErr) throw new Error('Errore salvataggio bozza: ' + insErr.message)
      }

      await reloadBozza()
      setActiveView('bozza')

    } catch(e) {
      console.error('[AI Planner] askAI error:', e)
      setAiError('❌ ' + e.message)
    }
    setLoading(false)
  }

  // Pubblica la bozza → stato = 'pubblicato'
  const publishBozza = async () => {
    if (!window.confirm(`Pubblicare ${bozzaShifts.filter(s=>s.sede===aiSede).length} turni?`)) return
    setPublishing(true)
    try {
      const { error } = await supabase.from('shifts')
        .update({ stato: 'pubblicato', pubblicato_at: new Date().toISOString() })
        .eq('stato','bozza').eq('settimana_label',weekLabel).eq('sede',aiSede)
      if (error) throw error
      await Promise.all([reload(), reloadBozza()])
      setActiveView('genera')
      setAiAnalysis(null)
    } catch(e) { alert('Errore pubblicazione: '+e.message) }
    setPublishing(false)
  }

  // Elimina tutta la bozza
  const deleteAllBozza = async () => {
    if (!window.confirm('Eliminare tutta la bozza per questa settimana?')) return
    const { error } = await supabase.from('shifts').delete()
      .eq('stato','bozza').eq('settimana_label',weekLabel).eq('sede',aiSede)
    if (!error) { await reloadBozza(); setActiveView('genera'); setAiAnalysis(null) }
  }

  // Elimina singolo turno dalla bozza
  const deleteBozzaShift = async (id) => {
    await supabase.from('shifts').delete().eq('id',id)
    await reloadBozza()
  }

  // Salva modifica a turno in bozza
  const saveBozzaShift = async (data) => {
    if (data.id) {
      await supabase.from('shifts').update({
        turno_tipo: data.turno_tipo, ora_inizio: data.ora_inizio, ora_fine: data.ora_fine,
        hours: data.hours, notes: data.notes,
      }).eq('id', data.id)
    } else {
      await supabase.from('shifts').insert({
        ...data,
        stato: 'bozza',
        settimana_label: weekLabel,
        bozza_generata_at: new Date().toISOString(),
      })
    }
    await reloadBozza()
    setEditModal(null)
  }

  const curBozza = bozzaShifts.filter(s => s.sede === aiSede)

  const QUICK = [
    'Genera il planning completo ottimizzando i costi',
    'Weekend con copertura massima, giorni pieni con minima',
    'Distribuisci i riposi in modo che nessuno lavori 6 giorni di fila',
    'Abbina sempre 1 Responsabile + 1 Cameriere esperto per turno',
    'Minimizza gli straordinari rispettando le coperture minime',
  ]

  return (
    <div className="space-y-4">
      {/* Tab switcher se c'è bozza */}
      {curBozza.length > 0 && (
        <div className="flex gap-1 border-b pb-0">
          {[{v:'genera',l:'🤖 Genera nuovo'},{v:'bozza',l:`📅 Bozza corrente (${curBozza.length})`}].map(t=>(
            <button key={t.v} onClick={()=>setActiveView(t.v)}
              className={`px-4 py-2 rounded-t-lg text-sm font-medium border border-b-0 -mb-px transition-all ${
                activeView===t.v ? 'bg-white text-blue-700 border-gray-200 shadow-sm font-bold' : 'text-gray-500 hover:text-gray-700 border-transparent'
              }`}>{t.l}</button>
          ))}
        </div>
      )}

      {/* ── Vista GENERA ── */}
      {activeView === 'genera' && (
        <>
          <div className="bg-white rounded-xl border shadow-sm p-4 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="font-semibold text-gray-800">🤖 AI Planner — {weekStr}</div>
              <select value={aiSede} onChange={e=>setAiSede(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm ml-auto">
                <option value="MA">🍽 Mameli</option>
                <option value="PN">🏪 Predda Niedda</option>
              </select>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 space-y-1">
              <p className="font-semibold">Come funziona il nuovo AI Planner:</p>
              <p>1. Premi <strong>Genera</strong> → l'AI analizza dipendenti, fabbisogno, storico e crea una bozza</p>
              <p>2. Modifica la bozza cella per cella (click su turno = modifica, × = elimina, + = aggiungi)</p>
              <p>3. Premi <strong>Pubblica</strong> per confermare la settimana → i turni entrano nel calendario</p>
              <p>💡 L'AI rispetta la regola: <strong>max 1 Responsabile per turno</strong> (Pranzo/Cena separati)</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK.map((q,i)=>(
                <button key={i} onClick={()=>setPrompt(q)}
                  className="text-xs px-2 py-1.5 bg-gray-100 rounded-full hover:bg-gray-200 text-gray-700 border border-gray-200 transition-all">
                  {q}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={2}
                placeholder="Istruzioni specifiche (es. 'Camilla ferie giovedì', 'Mario solo pranzi questa settimana', 'serve un cuoco extra sabato sera'…)"
                className="flex-1 border rounded-xl px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
              <div className="flex flex-col gap-1 self-end">
                <button onClick={askAI} disabled={loading || !histLoaded}
                  className="px-5 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-bold text-sm whitespace-nowrap">
                  {loading ? '⏳ Generando…' : !histLoaded ? '⏳ Carico storico…' : '🤖 Genera Bozza'}
                </button>
                <span className="text-[10px] text-center text-gray-400">
                  {histLoaded ? `📊 Storico pronto · ${sedeEmps.length} dip.` : '⏳ Caricamento storico…'}
                </span>
              </div>
            </div>
          </div>

          <details className="bg-gray-50 rounded-xl border border-gray-200">
            <summary className="px-4 py-3 text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100 rounded-xl">
              📋 Contesto inviato all'AI ({sedeEmps.length} dipendenti · storico 8 settimane)
            </summary>
            <pre className="p-4 text-xs text-gray-500 overflow-auto max-h-64 whitespace-pre-wrap">{buildContext()}</pre>
          </details>

          {/* Errore separato — non sovrascrive l'analisi */}
          {aiError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800 whitespace-pre-wrap">
              {aiError}
            </div>
          )}

          {aiAnalysis && !aiAnalysis.startsWith('❌') && (
            <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
              <h4 className="font-semibold text-gray-800">📝 Analisi AI</h4>
              <div className="text-sm text-gray-700 whitespace-pre-wrap">{aiAnalysis}</div>
              {curBozza.length > 0 && (
                <button onClick={()=>setActiveView('bozza')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                  📅 Vai alla bozza ({curBozza.length} turni) →
                </button>
              )}
            </div>
          )}

          {/* Pannello debug risposta grezza */}
          {rawResponse && (
            <details className="bg-gray-50 rounded-xl border border-gray-200">
              <summary className="px-4 py-3 text-xs font-medium text-gray-500 cursor-pointer hover:bg-gray-100 rounded-xl">
                🔍 Debug: risposta grezza AI ({rawResponse.length} chars)
              </summary>
              <pre className="p-4 text-xs text-gray-500 overflow-auto max-h-64 whitespace-pre-wrap">{rawResponse}</pre>
            </details>
          )}
        </>
      )}

      {/* ── Vista BOZZA ── */}
      {activeView === 'bozza' && curBozza.length > 0 && (
        <BozzaCalendar
          bozzaShifts={curBozza}
          weekDays={weekDays}
          emps={sedeEmps}
          onEdit={(s, emp, date) => setEditModal({shift:s, employee:emp, date})}
          onAddShift={(emp, date) => setEditModal({shift:null, employee:emp, date})}
          onDelete={deleteBozzaShift}
          onPublish={publishBozza}
          onDeleteAll={deleteAllBozza}
          publishing={publishing}
        />
      )}

      {/* Modale edit shift bozza */}
      {editModal && (
        <ShiftModal
          shift={editModal.shift}
          employee={editModal.employee}
          date={editModal.date}
          onSave={saveBozzaShift}
          onDelete={async id => { await deleteBozzaShift(id); setEditModal(null) }}
          onClose={() => setEditModal(null)}
        />
      )}
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

const TABS = [
  {id:'settimana', label:'📅 Settimana'},
  {id:'riepilogo', label:'📊 Riepilogo + Costi'},
  {id:'gestione',  label:'✏️ Gestione'},
  {id:'reparti',   label:'🏢 Reparti'},
  {id:'regole',    label:'📋 Regole'},
  {id:'ai',        label:'🤖 AI Planner', badge:'bozza'},
]

export default function TurniPage() {
  const [activeTab, setActiveTab]       = useState('settimana')
  const [selectedSede, setSelectedSede] = useState('MA')
  const [selectedWeek, setSelectedWeek] = useState(getMondayOf())
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState({anno:now.getFullYear(), mese:now.getMonth()+1})

  const data = useTurniData(selectedSede, selectedWeek, selectedMonth)

  const [repartiState, setRepartiState]     = useState(null)
  const [fabbisognoState, setFabbisognoState] = useState(null)

  const ctx = {
    ...data,
    reparti:    repartiState   ?? data.reparti,
    fabbisogno: fabbisognoState ?? data.fabbisogno,
    setReparti:   setRepartiState,
    setFabbisogno: setFabbisognoState,
    selectedSede, setSelectedSede,
    selectedWeek, setSelectedWeek,
    selectedMonth, setSelectedMonth,
    weekLabel: getWeekLabel(selectedWeek),
  }

  if (data.loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center text-gray-400">
        <div className="text-4xl mb-2">⏳</div>
        <div>Caricamento dati…</div>
      </div>
    </div>
  )

  return (
    <div className="max-w-full">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Gestione Turni</h1>
        <p className="text-gray-500 text-sm">Planning settimanale · Costi · AI Planner</p>
      </div>

      {data.empsWithoutReparto.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2 text-sm text-amber-800">
          ⚠️ <strong>{data.empsWithoutReparto.length} dipendenti</strong> senza reparto.
          <button onClick={()=>setActiveTab('reparti')} className="ml-1 underline hover:no-underline">Vai a Reparti →</button>
        </div>
      )}

      <div className="flex gap-1 mb-4 overflow-x-auto border-b pb-0">
        {TABS.map(t=>{
          const hasBozza = t.badge==='bozza' && data.bozzaShifts.length>0
          return (
            <button key={t.id} onClick={()=>setActiveTab(t.id)}
              className={`relative px-4 py-2.5 rounded-t-lg text-sm font-medium whitespace-nowrap transition-all -mb-px border border-b-0 ${
                activeTab===t.id
                  ? 'bg-white text-blue-700 border-gray-200 font-bold shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 border-transparent hover:bg-gray-50'
              }`}>
              {t.label}
              {hasBozza && <span className="ml-1.5 text-[10px] bg-amber-400 text-white px-1.5 py-0.5 rounded-full font-bold">BOZZA</span>}
            </button>
          )
        })}
      </div>

      <div className="min-h-[500px]">
        {activeTab==='settimana' && <SettimanaTab ctx={ctx}/>}
        {activeTab==='riepilogo' && <RiepilogoTab ctx={ctx}/>}
        {activeTab==='gestione'  && <GestioneTab  ctx={ctx}/>}
        {activeTab==='reparti'   && <RepartiTab   ctx={ctx}/>}
        {activeTab==='regole'    && <RegoleTab     ctx={ctx}/>}
        {activeTab==='ai'        && <AIPlannerTab  ctx={ctx}/>}
      </div>
    </div>
  )
}
