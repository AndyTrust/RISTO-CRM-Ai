/**
 * SetupWizard.jsx
 * Quick Start guidato per nuove installazioni CRM Ristorante AI
 * Appare al primo avvio (setup_completed = false in crm_config)
 * Passaggi: Benvenuto → Info Ristorante → Sedi → Storage → Fonti Dati → Fine
 */
import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { crmConfig, sediApi } from '../api/client'
import {
  ChefHat, MapPin, HardDrive, FileSpreadsheet, Check, ChevronRight,
  ChevronLeft, Plus, Trash2, RefreshCw, Globe, Database, Cloud,
  FolderOpen, FileText, FileBarChart, Zap, AlertTriangle
} from 'lucide-react'

const STORAGE_TYPES = [
  {
    id: 'onedrive',
    label: 'OneDrive / SharePoint',
    icon: Cloud,
    desc: 'Cartella sincronizzata Microsoft — ideale con Office 365',
    color: 'blue',
    placeholder: '~/OneDrive/CRM-Ristorante',
  },
  {
    id: 'gdrive',
    label: 'Google Drive',
    icon: Globe,
    desc: 'Cartella sincronizzata Google — ideale con Google Workspace',
    color: 'green',
    placeholder: '~/Google Drive/CRM-Ristorante',
  },
  {
    id: 'local',
    label: 'Cartella locale',
    icon: FolderOpen,
    desc: 'Cartella sul PC, senza cloud. Backup manuale consigliato.',
    color: 'amber',
    placeholder: '~/Documents/CRM-Ristorante',
  },
  {
    id: 'supabase',
    label: 'Solo Supabase',
    icon: Database,
    desc: 'Tutto direttamente nel database. Nessun file locale necessario.',
    color: 'violet',
    placeholder: null,
  },
]

const DATA_SOURCES = [
  { id: 'chiusure',  label: 'Chiusure Cassa',       icon: FileBarChart, tipo: 'Excel (.xlsx)',  skill: 'chiusure-giornaliere',  desc: 'Dati di cassa giornalieri dal POS' },
  { id: 'fatture',   label: 'Fatture Acquisto',      icon: FileText,     tipo: 'XML SdI',        skill: 'scarica-fatture',       desc: 'Fatture elettroniche fornitori (SdI italiano)' },
  { id: 'venduto',   label: 'Venduto Camerieri',     icon: FileBarChart, tipo: 'Excel (.xlsx)',  skill: 'venduto-camerieri',     desc: 'Dettaglio venduto per operatore dal POS' },
  { id: 'sondaggi',  label: 'Sondaggi Clienti',      icon: FileText,     tipo: 'HTML / JSON',    skill: 'sondaggi-estrazione',   desc: 'Risultati sondaggi clienti' },
  { id: 'buste_paga',label: 'Buste Paga',            icon: FileText,     tipo: 'PDF',            skill: 'pdf',                   desc: 'Cedolini stipendi dipendenti' },
  { id: 'menu',      label: 'Menu / Listino',        icon: FileText,     tipo: 'PDF / Excel',    skill: 'pdf',                   desc: 'Menu e prezzi per analisi' },
]

const STEP_LABELS = ['Benvenuto', 'Ristorante', 'Sedi', 'Storage', 'Fonti Dati', 'Completo']

function StepIndicator({ current, total }) {
  return (
    <div className="flex items-center gap-2 justify-center mb-8">
      {Array.from({ length: total }, (_, i) => (
        <React.Fragment key={i}>
          <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-all
            ${i < current ? 'bg-violet-600 text-white' : i === current ? 'bg-violet-600 text-white ring-4 ring-violet-100' : 'bg-gray-100 text-gray-400'}`}>
            {i < current ? <Check size={14}/> : i + 1}
          </div>
          {i < total - 1 && (
            <div className={`h-0.5 flex-1 max-w-[40px] transition-all ${i < current ? 'bg-violet-600' : 'bg-gray-200'}`}/>
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

function ColorPicker({ value, onChange }) {
  const colors = ['#ef4444','#f97316','#eab308','#22c55e','#10b981','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#ec4899','#64748b']
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {colors.map(c => (
        <button key={c} onClick={() => onChange(c)}
          className={`w-7 h-7 rounded-full transition-all ${value === c ? 'ring-2 ring-offset-2 ring-violet-500 scale-110' : 'hover:scale-105'}`}
          style={{ backgroundColor: c }}/>
      ))}
    </div>
  )
}

export default function SetupWizard({ onComplete }) {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Step 1: Info ristorante
  const [crmName, setCrmName]       = useState('CRM Ristorante')
  const [ownerName, setOwnerName]   = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')

  // Step 2: Sedi
  const [sedi, setSedi] = useState([
    { code: 'S1', name: '', city: '', color: '#ef4444' }
  ])

  // Step 3: Storage
  const [storageType, setStorageType]     = useState('onedrive')
  const [storagePath, setStoragePath]     = useState('')

  // Step 4: Fonti dati
  const [activeSources, setActiveSources] = useState(['chiusure','fatture','venduto','buste_paga'])

  const addSede = () => setSedi(prev => [
    ...prev,
    { code: `S${prev.length + 1}`, name: '', city: '', color: '#3b82f6' }
  ])

  const updateSede = (i, field, val) => setSedi(prev =>
    prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s)
  )

  const removeSede = (i) => setSedi(prev => prev.filter((_, idx) => idx !== i))

  const toggleSource = (id) => setActiveSources(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  )

  const canProceed = () => {
    if (step === 1) return crmName.trim().length > 0 && ownerName.trim().length > 0
    if (step === 2) return sedi.length > 0 && sedi.every(s => s.code.trim() && s.name.trim())
    if (step === 3) return storageType === 'supabase' || storagePath.trim().length > 0
    return true
  }

  const handleFinish = async () => {
    setSaving(true)
    setError(null)
    try {
      // Salva configurazione su Supabase crm_config
      const storageConf = {
        onedrive: { path: storageType === 'onedrive' ? storagePath : '', active: storageType === 'onedrive' },
        gdrive:   { path: storageType === 'gdrive'   ? storagePath : '', active: storageType === 'gdrive' },
        local:    { path: storageType === 'local'    ? storagePath : '', active: storageType === 'local' },
        supabase: { active: storageType === 'supabase' || true },
      }

      const dataSources = DATA_SOURCES.map(ds => ({
        ...ds, active: activeSources.includes(ds.id)
      }))

      await crmConfig.setMany({
        crm_name:        crmName,
        owner_name:      ownerName,
        owner_email:     ownerEmail,
        storage_type:    storageType,
        storage_config:  storageConf,
        data_sources:    dataSources,
        setup_completed: true,
        sedi:            sedi,
        version:         '2.0',
      })

      // Crea le sedi nel DB
      for (const sede of sedi) {
        try { await sediApi.create(sede) } catch {}
      }

      onComplete?.()
      navigate('/dashboard')
    } catch(e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const selectedStorage = STORAGE_TYPES.find(s => s.id === storageType)

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-violet-600 text-white mb-3 shadow-lg">
            <ChefHat size={28}/>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">CRM Ristorante AI</h1>
          <p className="text-gray-500 text-sm mt-1">Configurazione guidata — {STEP_LABELS[step]}</p>
        </div>

        <StepIndicator current={step} total={STEP_LABELS.length} />

        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">

          {/* ── STEP 0: Benvenuto ── */}
          {step === 0 && (
            <div className="p-8 space-y-6">
              <div className="text-center space-y-3">
                <div className="text-5xl">👨‍🍳</div>
                <h2 className="text-xl font-bold text-gray-900">Benvenuto nel CRM Ristorante AI</h2>
                <p className="text-gray-500 text-sm leading-relaxed max-w-md mx-auto">
                  Questo wizard ti guida nella configurazione iniziale. Puoi sempre modificare tutto dalla pagina <strong>Admin</strong> in seguito.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: MapPin,         label: 'Multi-sede',     desc: 'Gestisci più locali dalla stessa dashboard' },
                  { icon: Database,       label: 'Supabase',       desc: 'Database cloud in tempo reale' },
                  { icon: Zap,            label: 'Claude AI',      desc: 'Importazione automatica con AI' },
                  { icon: FileBarChart,   label: 'Analytics',      desc: 'KPI, chiusure, buste paga e molto altro' },
                ].map(f => (
                  <div key={f.label} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                    <div className="p-2 rounded-lg bg-violet-100">
                      <f.icon size={14} className="text-violet-600"/>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-800">{f.label}</p>
                      <p className="text-xs text-gray-500 leading-tight mt-0.5">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-700">
                <strong>Ci vorranno circa 3 minuti</strong> per completare la configurazione.
                Avrai bisogno di: nome del/dei locale/i, percorso cartella dati, e-mail di riferimento.
              </div>
            </div>
          )}

          {/* ── STEP 1: Info Ristorante ── */}
          {step === 1 && (
            <div className="p-8 space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Il tuo ristorante</h2>
                <p className="text-sm text-gray-500 mt-0.5">Questi dati personalizzano il CRM per te.</p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Nome CRM / Gruppo ristorativo *</label>
                  <input className="input w-full" placeholder="es. CRM Da Mario, Gruppo Rossi..."
                    value={crmName} onChange={e => setCrmName(e.target.value)} />
                  <p className="text-xs text-gray-400 mt-1">Apparirà nel titolo del CRM e nei report</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Il tuo nome *</label>
                  <input className="input w-full" placeholder="es. Mario Rossi"
                    value={ownerName} onChange={e => setOwnerName(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">E-mail</label>
                  <input className="input w-full" type="email" placeholder="tua@email.com"
                    value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: Sedi ── */}
          {step === 2 && (
            <div className="p-8 space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">I tuoi locali</h2>
                <p className="text-sm text-gray-500 mt-0.5">Aggiungi ogni sede che vuoi gestire. Puoi aggiungerne altre in seguito dall'Admin.</p>
              </div>
              <div className="space-y-3">
                {sedi.map((s, i) => (
                  <div key={i} className="p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-600">Locale {i + 1}</p>
                      {sedi.length > 1 && (
                        <button onClick={() => removeSede(i)} className="p-1 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500">
                          <Trash2 size={13}/>
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Codice *</label>
                        <input className="input w-full text-center font-mono font-bold uppercase text-sm" maxLength={4}
                          placeholder="MA" value={s.code}
                          onChange={e => updateSede(i, 'code', e.target.value.toUpperCase())} />
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-gray-400 block mb-1">Nome locale *</label>
                        <input className="input w-full" placeholder="es. Sede MA, Centro, Sede Nord..."
                          value={s.name} onChange={e => updateSede(i, 'name', e.target.value)} />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Città</label>
                      <input className="input w-full" placeholder="es. Milano"
                        value={s.city} onChange={e => updateSede(i, 'city', e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Colore identificativo</label>
                      <ColorPicker value={s.color} onChange={v => updateSede(i, 'color', v)} />
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={addSede}
                className="w-full py-2.5 rounded-xl border-2 border-dashed border-violet-300 text-violet-600 text-sm font-medium hover:bg-violet-50 flex items-center justify-center gap-2 transition-colors">
                <Plus size={16}/> Aggiungi altro locale
              </button>
            </div>
          )}

          {/* ── STEP 3: Storage ── */}
          {step === 3 && (
            <div className="p-8 space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Dove tieni i file?</h2>
                <p className="text-sm text-gray-500 mt-0.5">Scegli dove Claude cercherà i file da importare (chiusure, fatture, ecc.).</p>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {STORAGE_TYPES.map(st => (
                  <button key={st.id} onClick={() => setStorageType(st.id)}
                    className={`flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all ${
                      storageType === st.id ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-200'
                    }`}>
                    <div className={`p-2.5 rounded-xl ${storageType === st.id ? 'bg-violet-100' : 'bg-gray-100'}`}>
                      <st.icon size={18} className={storageType === st.id ? 'text-violet-600' : 'text-gray-500'}/>
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-sm text-gray-800">{st.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{st.desc}</p>
                    </div>
                    {storageType === st.id && <Check size={16} className="text-violet-600 flex-shrink-0"/>}
                  </button>
                ))}
              </div>
              {storageType !== 'supabase' && selectedStorage?.placeholder && (
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Percorso cartella principale *</label>
                  <input className="input w-full font-mono text-sm"
                    placeholder={selectedStorage.placeholder}
                    value={storagePath} onChange={e => setStoragePath(e.target.value)} />
                  <p className="text-xs text-gray-400 mt-1">
                    La cartella deve esistere. Claude creerà le sottocartelle per ogni tipo di dato.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 4: Fonti Dati ── */}
          {step === 4 && (
            <div className="p-8 space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Quali dati usi?</h2>
                <p className="text-sm text-gray-500 mt-0.5">Seleziona i tipi di file che importerai. Claude userà la skill giusta per ognuno.</p>
              </div>
              <div className="space-y-2">
                {DATA_SOURCES.map(ds => (
                  <button key={ds.id} onClick={() => toggleSource(ds.id)}
                    className={`w-full flex items-center gap-4 p-3.5 rounded-xl border-2 text-left transition-all ${
                      activeSources.includes(ds.id) ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                    <div className={`p-2 rounded-lg flex-shrink-0 ${activeSources.includes(ds.id) ? 'bg-violet-100' : 'bg-gray-100'}`}>
                      <ds.icon size={16} className={activeSources.includes(ds.id) ? 'text-violet-600' : 'text-gray-400'}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-800">{ds.label}</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">{ds.tipo}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{ds.desc}</p>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      activeSources.includes(ds.id) ? 'bg-violet-600 border-violet-600' : 'border-gray-300'
                    }`}>
                      {activeSources.includes(ds.id) && <Check size={11} className="text-white"/>}
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                Skill Claude attivate: <strong>{activeSources.length}</strong> / {DATA_SOURCES.length}. Puoi modificarle in Impostazioni.
              </p>
            </div>
          )}

          {/* ── STEP 5: Completo ── */}
          {step === 5 && (
            <div className="p-8 space-y-6">
              <div className="text-center space-y-3">
                <div className="text-5xl">🎉</div>
                <h2 className="text-xl font-bold text-gray-900">Tutto pronto!</h2>
                <p className="text-gray-500 text-sm">Ecco il riepilogo della tua configurazione:</p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <span className="text-xs text-gray-500">Nome CRM</span>
                  <span className="text-sm font-semibold text-gray-800">{crmName}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <span className="text-xs text-gray-500">Proprietario</span>
                  <span className="text-sm font-semibold text-gray-800">{ownerName}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <span className="text-xs text-gray-500">Sedi</span>
                  <span className="text-sm font-semibold text-gray-800">
                    {sedi.map(s => `${s.code} · ${s.name}`).join('  /  ')}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <span className="text-xs text-gray-500">Storage</span>
                  <span className="text-sm font-semibold text-gray-800">
                    {STORAGE_TYPES.find(s => s.id === storageType)?.label}
                    {storagePath && <span className="text-gray-400 font-mono text-xs ml-1">({storagePath.split('/').pop()})</span>}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <span className="text-xs text-gray-500">Fonti dati attive</span>
                  <span className="text-sm font-semibold text-gray-800">{activeSources.length} selezionate</span>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 flex items-center gap-2">
                  <AlertTriangle size={13}/> {error}
                </div>
              )}

              <p className="text-xs text-gray-400 text-center">
                Puoi modificare tutto in qualsiasi momento dalla pagina <strong>Admin</strong>.
              </p>
            </div>
          )}

          {/* ── Navigazione ── */}
          <div className="px-8 pb-8 pt-2 flex items-center justify-between gap-3">
            <button
              onClick={() => step > 0 ? setStep(s => s - 1) : null}
              disabled={step === 0}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-medium text-sm transition-all
                ${step === 0 ? 'invisible' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <ChevronLeft size={16}/> Indietro
            </button>

            {step < 5 ? (
              <button
                onClick={() => canProceed() && setStep(s => s + 1)}
                disabled={!canProceed()}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-medium text-sm transition-all flex-1 justify-center
                  ${canProceed() ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
              >
                Avanti <ChevronRight size={16}/>
              </button>
            ) : (
              <button
                onClick={handleFinish}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-medium text-sm bg-violet-600 hover:bg-violet-700 text-white shadow-sm flex-1 justify-center"
              >
                {saving ? <><RefreshCw size={14} className="animate-spin"/> Configurazione in corso...</>
                        : <><Check size={14}/> Avvia il CRM</>}
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          CRM Ristorante AI — Powered by Claude & Supabase
        </p>
      </div>
    </div>
  )
}
