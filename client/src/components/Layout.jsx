import React, { useContext, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ModulesContext } from '../App'
import {
  LayoutDashboard, Users, Target, TrendingUp, Receipt, Bot,
  Building2, Settings, ChevronLeft, ChevronRight, RefreshCw,
  BarChart2, Lock, Wallet, UtensilsCrossed, CalendarDays,
  ChevronDown, ChefHat, Tag, MapPin, Archive, Brain, Cloud, Database, Award
} from 'lucide-react'
import { data as dataApi } from '../api/client'

// ── Struttura navigazione a due livelli: sezioni → sottopagine con descrizione ───
const NAV_GROUPS = [
  {
    label: 'Operativo',
    defaultOpen: true,
    items: [
      { id: 'dashboard',    path: '/dashboard',   icon: LayoutDashboard, label: 'Statistiche',        desc: 'KPI e andamento sedi' },
      { id: 'chiusure',     path: '/chiusure',     icon: Receipt,         label: 'Chiusure Cassa',     desc: 'Corrispettivi giornalieri' },
      { id: 'venduto',      path: '/venduto',      icon: TrendingUp,      label: 'Venduto',            desc: 'Venduto per cameriere' },
    ]
  },
  {
    label: 'Personale',
    defaultOpen: false,
    items: [
      { id: 'buste_paga',    path: '/buste-paga',          icon: Users,           label: 'Dipendenti & Paga',  desc: 'Anagrafica, cedolini e costi' },
      { id: 'kpi_camerieri', path: '/kpi',                  icon: Target,          label: 'KPI Camerieri',      desc: 'Performance operatori' },
      { id: 'kpi_config',    path: '/kpi-config',           icon: Target,          label: 'KPI Config',         desc: 'BE, target team, bonus, prodotti', alwaysEnabled: true },
      { id: 'kpi_team',      path: '/kpi-team',             icon: Award,           label: 'KPI Team & Quantum', desc: 'BE, obiettivi prodotto, bonus', alwaysEnabled: true },
      { id: 'turni',         path: '/turni',                icon: CalendarDays,    label: 'Turni',              desc: 'Pianificazione orari' },
    ]
  },
  {
    label: 'Sala & Analisi',
    defaultOpen: false,
    items: [
      { id: 'statistiche',  path: '/statistiche',  icon: UtensilsCrossed, label: 'Statistiche Sala',   desc: 'Tavoli e coperti' },
      { id: 'analytics_bi', path: '/analytics',    icon: BarChart2,       label: 'Analytics & BI',     desc: 'Reportistica avanzata' },
      { id: 'fornitori',    path: '/fornitori',     icon: Building2,       label: 'Fornitori & Costi',  desc: 'Fatture e food cost' },
      { id: 'costi_fissi',  path: '/costi-fissi',   icon: Wallet,          label: 'Costi Fissi',        desc: 'Affitti, consulenze, oneri', alwaysEnabled: true },
      { id: 'listino',      path: '/listino',       icon: Tag,             label: 'Listino Prodotti',   desc: 'Prezzi, margini, fornitori', alwaysEnabled: true },
      { id: 'ricette',      path: '/ricette',       icon: ChefHat,         label: 'Ricette & Food Cost',desc: 'Menu e margini' },
      { id: 'chat_claude',  path: '/chat',          icon: Bot,             label: 'Chat Claude AI',     desc: 'Assistente AI integrato' },
    ]
  },
  {
    label: 'Admin',
    defaultOpen: false,
    isAdmin: true,
    items: [
      { id: 'admin_dipendenti', path: '/admin/dipendenti', icon: Users,     label: 'Dipendenti',      desc: 'Modifica, trasferisci, split costi', alwaysEnabled: true },
      { id: 'admin_ruoli',      path: '/admin/ruoli',       icon: Tag,       label: 'Ruoli',           desc: 'Aggiungi e gestisci ruoli',          alwaysEnabled: true },
      { id: 'admin_kpi',        path: '/admin/kpi',         icon: Target,    label: 'KPI Config',      desc: 'Target mensili per operatore',       alwaysEnabled: true },
      { id: 'admin_sedi',       path: '/admin/sedi',        icon: MapPin,    label: 'Sedi',            desc: 'Location e multi-sede',              alwaysEnabled: true },
      { id: 'admin_database',   path: '/admin/database',    icon: Database,  label: 'Database',        desc: 'Vista dati grezzi Supabase',         alwaysEnabled: true },
      { id: 'admin_backup',     path: '/admin/backup',      icon: Archive,   label: 'Backup',          desc: 'Snapshot & ripristino dati',         alwaysEnabled: true },
      { id: 'admin_memoria',    path: '/admin/memoria',     icon: Brain,     label: 'Memoria AI',      desc: 'Note e contesto Claude',             alwaysEnabled: true },
      { id: 'admin_sync',       path: '/admin/sync',        icon: Cloud,     label: 'Sync & Deploy',   desc: 'Vercel, Supabase, moduli',           alwaysEnabled: true },
    ]
  },
  {
    label: null,
    defaultOpen: true,
    items: [
      { id: 'impostazioni', path: '/impostazioni', icon: Settings, label: 'Impostazioni', desc: 'Configurazione sistema', alwaysEnabled: true },
    ]
  }
]

// ── Gruppo con dropdown ────────────────────────────────────────────────────
function NavGroup({ group, collapsed, isEnabled }) {
  const location = useLocation()

  // Apri automaticamente il gruppo se contiene la pagina attiva
  const hasActive = group.items.some(item => location.pathname === item.path || location.pathname.startsWith(item.path + '/'))
  const [open, setOpen] = useState(group.defaultOpen || hasActive)

  return (
    <div className="mb-0.5">
      {/* Header sezione con toggle */}
      {group.label && !collapsed && (
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-1.5 group"
        >
          <span className={`text-[9px] font-bold uppercase tracking-widest transition-colors ${
            group.isAdmin ? 'text-violet-400 group-hover:text-violet-300' : 'text-gray-500 group-hover:text-gray-300'
          }`}>
            {group.label}
          </span>
          <ChevronDown
            size={10}
            className={`text-gray-600 transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`}
          />
        </button>
      )}

      {/* Separatore se collapsed */}
      {group.label && collapsed && (
        <div className={`mx-3 my-1.5 h-px ${group.isAdmin ? 'bg-violet-500/30' : 'bg-white/10'}`} />
      )}

      {/* Voci di navigazione */}
      {(open || collapsed) && (
        <div className={`${!collapsed && group.label ? 'pl-1' : ''}`}>
          {group.items.map(item => {
            const Icon = item.icon
            const enabled = item.alwaysEnabled || item.id === 'impostazioni' || isEnabled(item.id)

            return (
              <NavLink
                key={item.id}
                to={item.path}
                title={collapsed ? `${item.label} — ${item.desc}` : undefined}
                className={({ isActive }) => {
                  const active = isActive || location.pathname.startsWith(item.path + '/')
                  return (
                    `flex items-center gap-2.5 mx-2 px-2.5 rounded-lg transition-all duration-100 mb-0.5 ` +
                    `${collapsed ? 'py-2 justify-center' : 'py-2'} ` +
                    (active
                      ? group.isAdmin
                        ? 'bg-violet-700 text-white font-semibold shadow-lg shadow-violet-900/40'
                        : 'bg-indigo-600 text-white font-semibold shadow-lg shadow-indigo-900/30'
                      : enabled
                        ? 'text-gray-400 hover:bg-white/8 hover:text-white'
                        : 'text-gray-600 cursor-not-allowed opacity-50')
                  )
                }}
                onClick={e => { if (!enabled) e.preventDefault() }}
              >
                <Icon size={15} className="flex-shrink-0" />
                {!collapsed && (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-[12.5px] font-medium leading-tight">{item.label}</span>
                      {!enabled && <Lock size={9} className="text-gray-600 flex-shrink-0" />}
                    </div>
                    {item.desc && (
                      <span className="text-[9.5px] leading-tight opacity-60 truncate block mt-0.5">{item.desc}</span>
                    )}
                  </div>
                )}
              </NavLink>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Layout principale ──────────────────────────────────────────────────────
export default function Layout({ children }) {
  const { modules, isEnabled } = useContext(ModulesContext)
  const [collapsed, setCollapsed] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState(null)

  const handleSync = async () => {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const r = await dataApi.sync()
      const n = r.results?.filter(x => !x.skipped).length || 0
      setSyncMsg(`✓ ${n} file aggiornati`)
    } catch (e) {
      setSyncMsg(`⚠ ${e.error || 'Errore sync'}`)
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(null), 4000)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">

      {/* ── SIDEBAR ── */}
      <aside className={`relative flex flex-col bg-gray-900 text-white transition-all duration-200 flex-shrink-0 ${collapsed ? 'w-[60px]' : 'w-[240px]'}`}>

        {/* Logo */}
        <div className={`flex items-center border-b border-white/10 flex-shrink-0 ${collapsed ? 'justify-center px-0 py-4' : 'gap-3 px-4 py-4'}`}>
          <img
            src="/logo-dark.png"
            alt={import.meta.env.VITE_APP_NAME || 'CRM'}
            className={`object-contain flex-shrink-0 transition-all duration-200 ${collapsed ? 'h-8 w-8' : 'h-9 w-auto'}`}
          />
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-bold text-sm text-white leading-tight">{import.meta.env.VITE_APP_NAME || 'CRM'}</div>
              <div className="text-[10px] text-gray-400 leading-tight">CRM Gestionale</div>
            </div>
          )}
        </div>

        {/* Navigation con accordion a due livelli */}
        <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
          {NAV_GROUPS.map((group, gi) => (
            <NavGroup
              key={gi}
              group={group}
              collapsed={collapsed}
              isEnabled={isEnabled}
            />
          ))}
        </nav>

        {/* Locali badges */}
        {!collapsed && (
          <div className="px-4 pb-2">
            <div className="flex gap-1.5">
              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-medium">MA</span>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium">PN</span>
            </div>
          </div>
        )}

        {/* Sync button */}
        <div className="px-2 pb-3 border-t border-white/10 pt-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            title="Sincronizza dati"
            className={`flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
              syncing ? 'bg-white/5 text-gray-500' : 'bg-white/8 text-gray-300 hover:bg-white/15 hover:text-white'
            } ${collapsed ? 'justify-center' : ''}`}
          >
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            {!collapsed && <span>{syncing ? 'Sync in corso...' : 'Aggiorna dati'}</span>}
          </button>
          {!collapsed && syncMsg && (
            <p className="text-[10px] text-gray-400 mt-1 px-1">{syncMsg}</p>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-[52px] w-6 h-6 rounded-full bg-gray-700 border border-gray-600 flex items-center justify-center hover:bg-gray-600 transition-colors z-20 shadow-md"
        >
          {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
        </button>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
