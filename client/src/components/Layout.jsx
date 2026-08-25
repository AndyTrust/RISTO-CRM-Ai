import React, { useContext, useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ModulesContext } from '../App'
import {
  LayoutDashboard, Users, Target, TrendingUp, Receipt, Bot,
  Building2, Settings, ChevronLeft, ChevronRight, RefreshCw,
  BarChart2, Lock, Wallet, UtensilsCrossed, CalendarDays,
  ChevronDown, Tag, MapPin, Archive, Brain, Cloud, Database, Award, BarChart3, Activity, Coins, Star, MessageSquare,
  GitMerge, BookOpen, Scale, Landmark, GitCompareArrows, Percent, Package, Gauge, UserX, ShieldCheck,
  FileSpreadsheet, Sparkles
} from 'lucide-react'
import { useAggiornamento } from '../lib/aggiornamento'
import { scadenzarioApi } from '../api/supabase-client'

// ── Struttura navigazione a due livelli: sezioni → sottopagine con descrizione ───
// Riorganizzazione 2026-06-19 — sequenza logica: panoramica → operativo → personale → sala → BI → costi → admin
const NAV_GROUPS = [
  // 1) PANORAMICA — sempre aperta, vista d'insieme
  {
    label: 'Panoramica',
    defaultOpen: true,
    items: [
      { id: 'dashboard',    path: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard',       desc: 'KPI sintetici e andamento sedi' },
      { id: 'analisi',      path: '/analisi',      icon: Sparkles,        label: 'Analisi',         desc: 'Cosa dicono i dati, letto e spiegato', alwaysEnabled: true },
      { id: 'stato_dati',   path: '/stato-dati',   icon: Activity,        label: 'Stato Dati',      desc: 'Semafori salute dati 🟢🟡🔴', alwaysEnabled: true },
      { id: 'import_excel', path: '/importa-excel', icon: FileSpreadsheet, label: 'Import Excel',    desc: 'Foglio GIORNALIERA dell\'amministrazione', alwaysEnabled: true },
    ]
  },
  // 2) OPERATIVO — quotidiano (incassi, vendite)
  {
    label: 'Operativo',
    defaultOpen: true,
    items: [
      { id: 'chiusure',     path: '/chiusure',     icon: Receipt,         label: 'Chiusure Cassa',  desc: 'Corrispettivi giornalieri MA + PN' },
      { id: 'venduto',      path: '/venduto',      icon: TrendingUp,      label: 'Venduto & BI',    desc: 'Analisi venduto, heatmap, calendario' },
      // Vicino a Venduto perché risponde alla stessa domanda ("come sta andando
      // il mese"), ma in EURO e con la regola dei premi: break-even → quorum →
      // quantum. I target in pezzi della tab Venduto restano operativi.
      { id: 'obiettivi',    path: '/obiettivi',    icon: Award,           label: 'Obiettivi & Premi', desc: 'Break-even, quorum/quantum, premi', alwaysEnabled: true },
      // Subito dopo Obiettivi perché ne è il seguito operativo: lì c'è il gap
      // di sede in euro, qui lo stesso gap spezzato per turno e tradotto in
      // coperti o scontrino — le due leve su cui si può davvero agire.
      { id: 'fabbisogno',   path: '/fabbisogno',   icon: Gauge,           label: 'Fabbisogno & Tendenza', desc: 'Pareggio per turno, coperti vs scontrino', alwaysEnabled: true },
      { id: 'prodotti_bi',  path: '/prodotti-bi',  icon: Tag,             label: 'Prodotti & Menu', desc: 'Food cost, BCG, menu engineering', alwaysEnabled: true },
      { id: 'forecast',     path: '/forecast',     icon: Cloud,           label: 'Forecast',        desc: 'Previsioni incasso prossimi giorni', alwaysEnabled: true },
    ]
  },
  // 3) PERSONALE — dipendenti, paga, KPI, turni — UNIFICATO
  {
    label: 'Personale',
    defaultOpen: false,
    items: [
      { id: 'buste_paga',    path: '/buste-paga',  icon: Users,        label: 'Dipendenti & Paga',  desc: 'Anagrafica, cedolini, split sede/reparto' },
      { id: 'kpi_camerieri', path: '/kpi',         icon: Target,       label: 'KPI & Performance',  desc: 'Operatori · Team · BI · Performance' },
      { id: 'turni',         path: '/turni',       icon: CalendarDays, label: 'Turni',              desc: 'Pianificazione orari settimanali' },
      { id: 'analisi_reparti', path: '/analisi-reparti', icon: Building2, label: 'Analisi Reparti', desc: 'Marginalità sala/cucina/admin/marketing', alwaysEnabled: true },
    ]
  },
  // 4) SALA — tavoli, prenotazioni, statistiche
  {
    label: 'Sala',
    defaultOpen: false,
    items: [
      { id: 'statistiche',  path: '/statistiche',  icon: UtensilsCrossed, label: 'Statistiche Sala',     desc: 'Coperti, tavoli, fasce orarie' },
      { id: 'coperti_bi',   path: '/coperti-bi',   icon: UtensilsCrossed, label: 'Coperti & Tavoli BI',  desc: 'Durate, rotazioni, occupancy', alwaysEnabled: true },
      { id: 'turni_bi',     path: '/turni-bi',     icon: CalendarDays,    label: 'Pranzo vs Cena',       desc: 'Confronto turni e BE per turno', alwaysEnabled: true },
      { id: 'prenotazioni', path: '/prenotazioni', icon: CalendarDays,    label: 'Prenotazioni',         desc: 'Filling rate, canali, no-show', alwaysEnabled: true },
      { id: 'sondaggi',     path: '/sondaggi',     icon: Star,            label: 'Sondaggi Clienti',     desc: 'NPS, dimensioni, feedback, canali', alwaysEnabled: true },
      { id: 'recensioni',   path: '/recensioni',   icon: MessageSquare,   label: 'Recensioni',           desc: 'Google, Tripadvisor, trend voti', alwaysEnabled: true },
    ]
  },
  // 5) COSTI — fissi, fornitori, contabilità
  {
    label: 'Costi & Margini',
    defaultOpen: false,
    items: [
      // Prima voce del gruppo perche' e' la lettura d'insieme: le altre spiegano
      // un pezzo di questi numeri. Tre livelli (Mameli, Predda Niedda, Gruppo) per
      // non confondere il costo dell'azienda con quello dei singoli locali.
      { id: 'controllo_costi', path: '/controllo-costi', icon: ShieldCheck, label: 'Controllo Costi',   desc: 'Semaforo su personale, food e fissi', alwaysEnabled: true },
      { id: 'costi_fissi',    path: '/costi-fissi',    icon: Wallet,    label: 'Costi Fissi',       desc: 'Affitti, consulenze, oneri (editabile)', alwaysEnabled: true },
      // Imposte, IVA e contributi effettivamente versati, letti dalle deleghe F24.
      // Sta qui e non sotto Personale perche' la domanda a cui risponde e' "quanto
      // ci costa lo Stato", non "quanto ci costa il personale": meta' degli importi
      // sono contributi dei dipendenti, ma NON vanno mai sommati al costo del
      // personale - sono gli stessi soldi dei cedolini, versati.
      { id: 'f24',            path: '/f24',            icon: Receipt,   label: 'F24 · Imposte & Tributi', desc: 'Ogni codice tributo spiegato, con quanto si spende', alwaysEnabled: true },
      // Che cosa resta da pagare: fatture fornitore ancora aperte e costi fissi
      // gia' pianificati. Attenzione: i termini di pagamento delle fatture non
      // sono a sistema, quindi la pagina ragiona per anzianita' e lo dichiara.
      { id: 'scadenzario',    path: '/scadenzario',    icon: CalendarDays, label: 'Scadenzario',       desc: 'Fatture aperte, ratei e costi fissi in arrivo', alwaysEnabled: true },
      { id: 'rate-piani',     path: '/rate-piani',     icon: Landmark,     label: 'Rate & Piani',      desc: 'Rottamazione, Equitalia, IRES: quando cade ogni rata', alwaysEnabled: true },
      { id: 'fornitori',      path: '/fornitori',      icon: Building2, label: 'Fornitori & Fatture', desc: 'Fatture, costi, riconciliazione' },
      // Voce nuova: le analisi che 114.650 righe di dettaglio fattura rendono
      // possibili per la prima volta (prezzi per articolo, merceologico, sedi).
      { id: 'costi_prezzi',   path: '/costi-prezzi',   icon: Coins,     label: 'Costi & Prezzi BI', desc: 'Marginalità sedi, prezzi articoli, 7 anni', alwaysEnabled: true },
      // Catalogo per fornitore × articolo con alert sui rincari: risponde a
      // "quanto pago questo prodotto e chi me lo vende meglio", che le altre
      // voci di questa sezione toccano solo di sfuggita.
      { id: 'catalogo_articoli', path: '/catalogo-articoli', icon: Package, label: 'Catalogo Articoli', desc: 'Prezzi fornitore, rincari, Pareto', alwaysEnabled: true },
      { id: 'contabilita_bi', path: '/contabilita-bi', icon: BarChart3, label: 'Contabilità BI',    desc: 'BE, margini, proiezioni', alwaysEnabled: true },
      { id: 'kpi_config',     path: '/kpi-config',     icon: Target,    label: 'Target & BE',       desc: 'Break-even, target, bonus', alwaysEnabled: true },
    ]
  },
  // 5-bis) BILANCI — numeri civilistici depositati e confronto col gestionale
  {
    label: 'Bilanci',
    defaultOpen: false,
    items: [
      { id: 'bilanci',        path: '/bilanci',                     icon: BookOpen,          label: 'Panoramica',         desc: 'Bilanci depositati per anno', alwaysEnabled: true, exact: true },
      { id: 'commercialista', path: '/commercialista',              icon: Scale,             label: 'Commercialista',     desc: 'Notule, acconti e conto aperto', alwaysEnabled: true },
      { id: 'bilanci_ce',     path: '/bilanci/conto-economico',     icon: Scale,             label: 'Conto Economico',    desc: 'Riclassificato + confronto YoY', alwaysEnabled: true },
      { id: 'bilanci_sp',     path: '/bilanci/stato-patrimoniale',  icon: Landmark,          label: 'Stato Patrimoniale', desc: 'Attivo, passivo, patrimonio netto', alwaysEnabled: true },
      { id: 'bilanci_ric',    path: '/bilanci/riconciliazione',     icon: GitCompareArrows,  label: 'Bilancio vs CRM',    desc: 'Scostamento civilistico ↔ gestionale', alwaysEnabled: true },
      { id: 'bilanci_indici', path: '/bilanci/indici',              icon: Percent,           label: 'Indici',             desc: 'Margine, personale, food cost', alwaysEnabled: true },
    ]
  },
  // 6) BI AVANZATA
  {
    label: 'BI Avanzata',
    defaultOpen: false,
    items: [
      { id: 'analytics_bi', path: '/analytics', icon: BarChart2, label: 'Analytics & BI', desc: 'Reportistica avanzata' },
      { id: 'chat_claude',  path: '/chat',      icon: Bot,       label: 'Chat AI',        desc: 'Assistente Claude AI integrato' },
    ]
  },
  // 7) ADMIN — gestione sistema
  {
    label: 'Admin',
    defaultOpen: false,
    isAdmin: true,
    items: [
      { id: 'admin_dipendenti', path: '/admin/dipendenti', icon: Users,     label: 'Dipendenti (avanzato)', desc: 'Bulk, merge, transfer',           alwaysEnabled: true },
      // Queste due tab di AdminPanel esistevano già come route (/admin/unioni,
      // /admin/kpi) ma non erano raggiungibili da nessuna voce di menu.
      { id: 'admin_unioni',     path: '/admin/unioni',      icon: GitMerge,  label: 'Unioni & Doppioni',     desc: 'Merge dipendenti, link venduto',  alwaysEnabled: true },
      { id: 'anagrafiche',      path: '/anagrafiche',       icon: UserX,     label: 'Anagrafiche da sistemare', desc: 'Reparto, ruolo, split, attivi', alwaysEnabled: true },
      { id: 'admin_kpi',        path: '/admin/kpi',         icon: Target,    label: 'KPI Config',            desc: 'Target mensili per operatore',    alwaysEnabled: true },
      { id: 'admin_ruoli',      path: '/admin/ruoli',       icon: Tag,       label: 'Ruoli & Reparti',       desc: 'Aggiungi e gestisci ruoli',       alwaysEnabled: true },
      { id: 'admin_sedi',       path: '/admin/sedi',        icon: MapPin,    label: 'Sedi',                  desc: 'Location e multi-sede',           alwaysEnabled: true },
      { id: 'admin_database',   path: '/admin/database',    icon: Database,  label: 'Database',              desc: 'Vista dati grezzi Supabase',      alwaysEnabled: true },
      { id: 'admin_backup',     path: '/admin/backup',      icon: Archive,   label: 'Backup',                desc: 'Snapshot & ripristino dati',      alwaysEnabled: true },
      { id: 'admin_memoria',    path: '/admin/memoria',     icon: Brain,     label: 'Memoria AI',            desc: 'Note e contesto Claude',          alwaysEnabled: true },
      { id: 'admin_sync',       path: '/admin/sync',        icon: Cloud,     label: 'Sync & Deploy',         desc: 'Vercel, Supabase, moduli',        alwaysEnabled: true },
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
function NavGroup({ group, collapsed, isEnabled, pallini = {} }) {
  const location = useLocation()

  // Apri automaticamente il gruppo se contiene la pagina attiva
  const hasActive = group.items.some(item => location.pathname === item.path || location.pathname.startsWith(item.path + '/'))
  const [open, setOpen] = useState(group.defaultOpen || hasActive)

  // hasActive non è solo iniziale: se si naviga (link diretto) su una pagina di
  // un gruppo chiuso, l'accordion deve aprirsi da solo
  useEffect(() => { if (hasActive) setOpen(true) }, [hasActive])

  return (
    <div className="mb-0.5">
      {/* Header sezione con toggle */}
      {group.label && !collapsed && (
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-2.5 group rounded-lg hover:bg-white/5"
        >
          <span className={`text-sm font-extrabold uppercase tracking-wide transition-colors ${
            group.isAdmin ? 'text-violet-300 group-hover:text-violet-200' : 'text-amber-300 group-hover:text-amber-200'
          }`}>
            {group.label}
          </span>
          <ChevronDown
            size={16}
            strokeWidth={2.5}
            className={`${group.isAdmin ? 'text-violet-300' : 'text-amber-300'} transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`}
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
                // `exact` serve alle voci che sono anche prefisso di altre voci
                // (es. /bilanci vs /bilanci/indici): senza `end` react-router
                // evidenzierebbe sia la panoramica sia la sottopagina, facendo
                // sembrare due voci attive contemporaneamente.
                end={item.exact}
                title={collapsed ? `${item.label} — ${item.desc}` : undefined}
                className={({ isActive }) => {
                  const active = item.exact
                    ? isActive
                    : isActive || location.pathname.startsWith(item.path + '/')
                  return (
                    `flex items-center gap-2.5 mx-2 px-2.5 rounded-lg transition-all duration-100 mb-0.5 ` +
                    `${collapsed ? 'py-2 justify-center' : 'py-2'} ` +
                    (active
                      ? group.isAdmin
                        ? 'bg-violet-700 text-white font-semibold shadow-lg shadow-violet-900/40'
                        : 'bg-indigo-600 text-white font-semibold shadow-lg shadow-indigo-900/30'
                      : enabled
                        ? 'text-gray-200 hover:bg-white/8 hover:text-white'
                        : 'text-gray-600 cursor-not-allowed opacity-50')
                  )
                }}
                onClick={e => { if (!enabled) e.preventDefault() }}
              >
                <span className="relative flex-shrink-0">
                  <Icon size={15} />
                  {/* Il pallino c'e' solo quando qualcosa merita davvero di essere
                      guardato (rata non pagata, scadenza vicina, dati fermi). Se
                      comparisse sempre non lo guarderebbe piu' nessuno. */}
                  {pallini[item.id] > 0 && collapsed && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-gray-900" />
                  )}
                </span>
                {!collapsed && (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-[15px] font-semibold leading-tight">{item.label}</span>
                      {pallini[item.id] > 0 && (
                        <span className="flex-shrink-0 min-w-[18px] px-1 h-[18px] rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                          {pallini[item.id]}
                        </span>
                      )}
                      {!enabled && <Lock size={9} className="text-gray-600 flex-shrink-0" />}
                    </div>
                    {item.desc && (
                      <span className="text-[11.5px] leading-tight opacity-75 truncate block mt-0.5">{item.desc}</span>
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
  // Il pulsante qui sotto chiamava dataApi.sync(), che da quando il CRM legge
  // da Supabase non sincronizza piu' niente: contava le righe di cinque tabelle
  // e rispondeva "N file aggiornati" senza che una sola query della pagina
  // venisse rifatta. Ora fa la cosa che dice: alza la versione globale, la
  // pagina si rimonta e rilegge tutto. Vedi lib/aggiornamento.jsx.
  const { aggiorna, aggiornatoAlle, inCorso } = useAggiornamento()

  // Rinfresca l'etichetta "aggiornato alle" ogni minuto anche senza eventi,
  // cosi' il "3 min fa" non resta congelato.
  const [, setTic] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTic(n => n + 1), 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const daQuanto = (() => {
    if (!aggiornatoAlle) return null
    const min = Math.floor((Date.now() - aggiornatoAlle.getTime()) / 60000)
    if (min < 1) return 'adesso'
    if (min === 1) return '1 min fa'
    if (min < 60) return `${min} min fa`
    const ore = Math.floor(min / 60)
    return ore === 1 ? "1 ora fa" : `${ore} ore fa`
  })()

  const oraAggiornamento = aggiornatoAlle
    ? aggiornatoAlle.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    : '--:--'

  // Quante cose meritano attenzione adesso: gravita' 1 (una rata non risulta
  // pagata) e 2 (scaduto da controllare, oppure la rilettura dei fogli si e'
  // fermata). Le scadenze in arrivo NON contano: sono un promemoria, e un
  // numero rosso permanente accanto a una voce di menu smette di significare
  // qualcosa dopo due giorni.
  const [nAvvisi, setNAvvisi] = useState(0)
  useEffect(() => {
    let vivo = true
    scadenzarioApi.avvisi()
      .then(r => { if (vivo) setNAvvisi(r.filter(x => x.gravita <= 2).length) })
      .catch(() => {})
    return () => { vivo = false }
  }, [aggiornatoAlle])

  const pallini = { scadenzario: nAvvisi, 'rate-piani': nAvvisi }

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
              pallini={pallini}
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

        {/* Aggiornamento dati — stato sempre visibile + ricarica manuale */}
        <div className="px-2 pb-3 border-t border-white/10 pt-2">
          <button
            onClick={aggiorna}
            disabled={inCorso}
            title={`Dati letti alle ${oraAggiornamento}. Clicca per rileggerli adesso.`}
            className={`flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
              inCorso ? 'bg-white/5 text-gray-500' : 'bg-white/8 text-gray-300 hover:bg-white/15 hover:text-white'
            } ${collapsed ? 'justify-center' : ''}`}
          >
            <RefreshCw size={13} className={inCorso ? 'animate-spin' : ''} />
            {!collapsed && <span>{inCorso ? 'Aggiornamento...' : 'Aggiorna dati'}</span>}
          </button>
          {!collapsed && (
            <p className="text-[10px] text-gray-500 mt-1 px-1">
              Dati delle {oraAggiornamento}{daQuanto ? ` · ${daQuanto}` : ''}
            </p>
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
