import React, { useEffect, useState, useContext } from 'react'
import { ModulesContext } from '../App'
import { data as dataApi, modules as modulesApi, admin as adminApi } from '../api/client'
import {
  Power, RefreshCw, Database, Check, Save,
  CheckSquare, Zap, Globe, HardDrive, AlertTriangle
} from 'lucide-react'

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      onClick={disabled ? undefined : onChange}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none
        ${checked ? 'bg-violet-500' : 'bg-gray-200'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

function SyncNode({ label, icon: Icon, color, status, count }) {
  const colors = {
    green:  'bg-green-50 text-green-700 border-green-200',
    blue:   'bg-blue-50 text-blue-700 border-blue-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    gray:   'bg-gray-50 text-gray-600 border-gray-200',
  }
  return (
    <div className={`flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border ${colors[color]} min-w-[80px]`}>
      <Icon size={18} />
      <p className="text-xs font-semibold text-center leading-tight">{label}</p>
      {count !== undefined && <p className="text-xs opacity-60">{count.toLocaleString('it-IT')} righe</p>}
      {status && <p className="text-xs opacity-60 text-center leading-tight">{status}</p>}
    </div>
  )
}

export default function Settings() {
  const { modules, saveModules } = useContext(ModulesContext)
  const [localModules, setLocalModules] = useState([])
  const [saving, setSaving]             = useState(false)
  const [saved,  setSaved]              = useState(false)
  const [syncStatus, setSyncStatus]     = useState(null)
  const [syncing, setSyncing]           = useState(false)
  const [syncMsg, setSyncMsg]           = useState(null)
  const [dbStats, setDbStats]           = useState([])

  useEffect(() => {
    if (modules.length) setLocalModules(modules.map(m => ({ ...m })))
  }, [modules])

  useEffect(() => {
    dataApi.status().then(setSyncStatus).catch(console.error)
    adminApi.dbStats().then(setDbStats).catch(console.error)
  }, [])

  const MODULE_ICONS = {
    dashboard: '📊', dipendenti: '👥', kpi_camerieri: '🎯', venduto: '📈',
    chiusure: '💰', fornitori: '🏭', chat_claude: '🤖', impostazioni: '⚙️',
    turni: '📅', buste_paga: '💼', statistiche: '📉', analytics_bi: '🧠',
  }

  const toggleLocal = (id) => {
    if (id === 'impostazioni') return
    setLocalModules(prev => prev.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m))
  }

  const enableAll  = () => setLocalModules(prev => prev.map(m => ({ ...m, enabled: true })))
  const disableAll = () => setLocalModules(prev => prev.map(m => ({ ...m, enabled: m.id === 'impostazioni' })))

  const hasChanges = localModules.some(m => {
    const orig = modules.find(x => x.id === m.id)
    return orig && orig.enabled !== m.enabled
  })

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveModules(localModules)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      alert('Errore salvataggio moduli: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const result = await dataApi.sync()
      const [newStatus, newStats] = await Promise.all([dataApi.status(), adminApi.dbStats()])
      setSyncStatus(newStatus)
      setDbStats(newStats)
      const totale = result.tables ? Object.values(result.tables).reduce((a, b) => a + b, 0) : 0
      setSyncMsg({ ok: true, text: `Stato Supabase verificato — ${totale.toLocaleString('it-IT')} righe totali` })
    } catch (e) {
      setSyncMsg({ ok: false, text: `Errore: ${e.message}` })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="page-title">Impostazioni</h1>
        <p className="text-sm text-gray-500 mt-0.5">Gestisci moduli, sincronizzazione e configurazione CRM</p>
      </div>

      {/* MODULI */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <Power size={18} className="text-violet-500" /> Gestione Moduli
            </h2>
            <div className="flex gap-2">
              <button onClick={enableAll}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100 font-medium">
                <CheckSquare size={12} /> Attiva tutti
              </button>
              <button onClick={disableAll}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 font-medium">
                Disattiva tutti
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            I toggle sono locali — premi <strong>Salva</strong> per salvare su Supabase (persistono al reload).
          </p>
        </div>
        <div className="divide-y divide-gray-100">
          {localModules.map(m => (
            <div key={m.id} className="flex items-center justify-between px-6 py-3.5">
              <div className="flex items-center gap-3">
                <span className="text-lg">{MODULE_ICONS[m.id] || '📦'}</span>
                <div>
                  <p className="text-sm font-medium text-gray-800">{m.name}</p>
                  <p className="text-xs text-gray-400">{m.description}</p>
                </div>
              </div>
              <Toggle checked={m.enabled} onChange={() => toggleLocal(m.id)} disabled={m.id === 'impostazioni'} />
            </div>
          ))}
        </div>
        <div className="px-6 pb-5 pt-3 border-t border-gray-100">
          {hasChanges && (
            <p className="text-xs text-amber-600 flex items-center gap-1.5 mb-2.5">
              <AlertTriangle size={12} /> Hai modifiche non salvate
            </p>
          )}
          <button onClick={handleSave} disabled={saving || !hasChanges}
            className={`flex items-center gap-2 w-full justify-center px-4 py-2.5 rounded-xl font-medium text-sm transition-all
              ${hasChanges ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
            {saving ? <RefreshCw size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
            {saving ? 'Salvataggio...' : saved ? 'Salvato!' : 'Salva impostazioni moduli'}
          </button>
        </div>
      </div>

      {/* TRIANGOLAZIONE */}
      <div className="card">
        <div className="card-header">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Zap size={18} className="text-violet-500" /> Triangolazione Dati
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            OneDrive → Claude Skills → Supabase → Vercel. Supabase è la fonte unica di verità.
          </p>
        </div>
        <div className="card-body space-y-5">
          <div className="flex items-center justify-center gap-2 flex-wrap py-1">
            <SyncNode label="OneDrive" icon={HardDrive} color="blue" status="Sorgente CSV" />
            <span className="text-gray-300 text-xl">→</span>
            <SyncNode label="Claude Skills" icon={Zap} color="purple" status="Elabora & carica" />
            <span className="text-gray-300 text-xl">→</span>
            <SyncNode label="Supabase" icon={Database} color="green"
              status={syncStatus?.status === 'ok' ? '🟢 online' : '🔴 errore'}
              count={syncStatus?.n_chiusure}
            />
            <span className="text-gray-300 text-xl">→</span>
            <SyncNode label="Vercel" icon={Globe} color="gray" status="CRM online" />
          </div>

          {dbStats.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Stato tabelle Supabase</p>
              <div className="grid grid-cols-3 gap-2">
                {dbStats.map(s => (
                  <div key={s.table} className={`rounded-lg p-2 border text-xs ${s.count > 0 ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100'}`}>
                    <p className="font-mono text-gray-400 truncate text-[10px]">{s.table}</p>
                    {/* Se il conteggio fallisce (RLS, rete) `count` è null: prima
                        `.toLocaleString()` su null faceva crashare l'intera pagina
                        Impostazioni. Ora si distingue "0 righe" da "non leggibile". */}
                    <p className={`font-bold mt-0.5 ${s.count > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                      {s.count == null ? '—' : Number(s.count).toLocaleString('it-IT')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {syncStatus && (
            <div className="p-3 rounded-xl bg-green-50 border border-green-200 text-xs text-green-700">
              <p className="font-medium">✅ Supabase connesso</p>
              <p className="opacity-70 mt-0.5">Ultima chiusura: {syncStatus.ultima_chiusura || '—'}</p>
              <p className="opacity-70">{syncStatus.dataPath}</p>
            </div>
          )}

          {syncMsg && (
            <div className={`p-3 rounded-xl text-xs border ${syncMsg.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {syncMsg.ok ? '✅' : '❌'} {syncMsg.text}
            </div>
          )}

          <button onClick={handleSync} disabled={syncing}
            className={`btn w-full ${syncing ? 'btn-secondary opacity-50' : 'btn-primary'}`}>
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Verifica in corso...' : 'Verifica stato Supabase'}
          </button>

          <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-700 space-y-1.5">
            <p className="font-medium">Per caricare nuovi dati usa le skill Claude:</p>
            <p>• <strong>Chiusure cassa</strong> → skill <code className="bg-blue-100 px-1 rounded">chiusure-giornaliere</code></p>
            <p>• <strong>Fatture acquisto</strong> → skill <code className="bg-blue-100 px-1 rounded">scarica-fatture</code></p>
            <p>• <strong>Venduto camerieri</strong> → skill <code className="bg-blue-100 px-1 rounded">venduto-camerieri</code></p>
            <p>• <strong>Tutto il mese</strong> → skill <code className="bg-blue-100 px-1 rounded">chiusure-crm-supabase</code></p>
          </div>
        </div>
      </div>

      {/* INFO */}
      <div className="card p-4 bg-gray-50 border-gray-200 text-xs text-gray-500 space-y-1">
        <p className="font-medium text-gray-700">{import.meta.env.VITE_APP_NAME || 'CRM Ristorante'} v2.0</p>
        <p>Stack: React + Vite + Tailwind CSS</p>
        <p>Database: Supabase PostgreSQL</p>
        <p>AI: Anthropic Claude (claude-sonnet-4-6)</p>
        <p>Deploy: Vercel</p>
      </div>
    </div>
  )
}
