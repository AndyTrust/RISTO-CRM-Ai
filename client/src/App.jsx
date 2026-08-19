import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'

// ─── Error Boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Log in produzione senza esporre stack al DOM
    console.error('[CRM ErrorBoundary]', error, info?.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#fafafa', fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111', marginBottom: 8 }}>
            Si è verificato un errore imprevisto
          </h2>
          <p style={{ color: '#666', fontSize: 14, marginBottom: 4 }}>
            {this.state.error?.message || 'Errore sconosciuto'}
          </p>
          <p style={{ color: '#aaa', fontSize: 12, marginBottom: 24 }}>
            Il problema è stato registrato. Ricarica la pagina per continuare.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Ricarica pagina
          </button>
        </div>
      </div>
    )
  }
}
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import PersonalePage from './pages/PersonalePage'
import KpiHub from './pages/KpiHub'
import VendutoPage from './pages/VendutoPage'
import ChiusurePage from './pages/ChiusurePage'
import ChatClaude from './pages/ChatClaude'
import FornitoriPage from './pages/FornitoriPage'
import AnalyticsBI from './pages/AnalyticsBI'
import Settings from './pages/Settings'
import StatisticheSala from './pages/StatisticheSala'
import TurniPage from './pages/TurniPage'
import AdminPanel from './pages/AdminPanel'
import SetupWizard from './pages/SetupWizard'
import KPIConfig from './pages/KPIConfig'
import CostiFissiPage from './pages/CostiFissiPage'
import PrenotazioniBI from './pages/PrenotazioniBI'
import ForecastPage from './pages/ForecastPage'
import ProdottiHub from './pages/ProdottiHub'
import TurniAnalysisBi from './pages/TurniAnalysisBi'
import ContabilitaBi from './pages/ContabilitaBi'
import CopertiBi from './pages/CopertiBi'
import StatoDati from './pages/StatoDati'
import ImportExcel from './pages/ImportExcel'
import AnalisiReparti from './pages/AnalisiReparti'
import AnagraficheQualita from './pages/AnagraficheQualita'
import SondaggiPage from './pages/SondaggiPage'
import RecensioniPage from './pages/RecensioniPage'
import BilanciPage from './pages/BilanciPage'
import CostiPrezziBi from './pages/CostiPrezziBi'
import CatalogoArticoli from './pages/CatalogoArticoli'
import ObiettiviPremi from './pages/ObiettiviPremi'
import Fabbisogno from './pages/Fabbisogno'
import ControlloCosti from './pages/ControlloCosti'
import { modules as modulesApi, crmConfig } from './api/client'

export const ModulesContext = React.createContext({})

export default function App() {
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [setupCompleted, setSetupCompleted] = useState(null)

  useEffect(() => {
    Promise.all([
      modulesApi.getAll(),
      crmConfig.get('setup_completed').catch(() => null),
    ]).then(([mods, setupDone]) => {
      setModules(mods)
      // setupDone può essere boolean true/false (jsonb) o stringa 'true'/'false'
      // Se la lettura fallisce (null) consideriamo il setup completato per non bloccare l'accesso
      const done = setupDone === true || setupDone === 'true'
      const notDone = setupDone === false || setupDone === 'false'
      setSetupCompleted(notDone ? false : true)
    }).catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const toggleModule = async (id) => {
    // Ottimisticamente aggiorna UI
    setModules(prev => prev.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m))
    // Persiste su Supabase
    try { await modulesApi.toggle(id) } catch (e) {
      // Rollback se fallisce
      setModules(prev => prev.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m))
      console.error('Toggle modulo fallito:', e)
    }
  }

  const saveModules = async (newModules) => {
    setModules(newModules)
    await modulesApi.saveAll(newModules)
  }

  const isEnabled = (id) => {
    const m = modules.find(x => x.id === id)
    return !m || m.enabled // default enabled se non trovato
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="text-center">
        <img src="/logo-light.png" alt={import.meta.env.VITE_APP_NAME || 'CRM Ristorante'} className="h-24 w-auto mx-auto mb-4 opacity-90" />
        <p className="text-gray-500 text-sm">Avvio {import.meta.env.VITE_APP_NAME || 'CRM Ristorante'}...</p>
      </div>
    </div>
  )

  // Se il setup non è stato completato, mostra wizard (tranne se siamo già su /setup)
  if (setupCompleted === false) {
    return (
      <Routes>
        <Route path="/setup" element={
          <SetupWizard onComplete={() => setSetupCompleted(true)} />
        } />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    )
  }

  return (
    <ErrorBoundary>
    <ModulesContext.Provider value={{ modules, toggleModule, saveModules, isEnabled }}>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/setup" element={<SetupWizard onComplete={() => setSetupCompleted(true)} />} />
          <Route path="/dashboard" element={isEnabled('dashboard') ? <Dashboard /> : <DisabledModule name="Dashboard" />} />
          <Route path="/dipendenti" element={<Navigate to="/buste-paga?tab=dipendenti" replace />} />
          <Route path="/performance" element={<Navigate to="/kpi?tab=performance" replace />} />
          <Route path="/kpi" element={isEnabled('kpi_camerieri') ? <KpiHub /> : <DisabledModule name="KPI & Performance" />} />
          <Route path="/kpi-config" element={<KPIConfig />} />
          <Route path="/kpi-team" element={<Navigate to="/kpi?tab=team" replace />} />
          <Route path="/venduto" element={isEnabled('venduto') ? <VendutoPage /> : <DisabledModule name="Venduto" />} />
          {/* OBIETTIVI & PREMI — break-even → quorum → quantum e premi per
              operatore. È l'unico posto in cui l'obiettivo di sede è in EURO:
              i target in pezzi della tab Venduto restano un dettaglio operativo. */}
          <Route path="/obiettivi" element={<ObiettiviPremi />} />
          {/* FABBISOGNO & TENDENZA — quanto deve incassare ogni turno per
              coprire la sua quota di pareggio, e se il fatturato si muove per
              i coperti o per lo scontrino. Sola lettura su tre viste. */}
          <Route path="/fabbisogno" element={<Fabbisogno />} />
          <Route path="/chiusure" element={isEnabled('chiusure') ? <ChiusurePage /> : <DisabledModule name="Chiusure" />} />
          <Route path="/chat" element={isEnabled('chat_claude') ? <ChatClaude /> : <DisabledModule name="Chat Claude AI" />} />
          <Route path="/fornitori" element={isEnabled('fornitori') ? <FornitoriPage /> : <DisabledModule name="Fornitori" />} />
          <Route path="/analytics" element={isEnabled('analytics_bi') ? <AnalyticsBI /> : <DisabledModule name="Analytics & BI" />} />
          {/* defaultTab deve essere un id di tab REALE di BustePaga (riepilogo,
              dipendenti, analisi, costo, dettaglio). Qui c'era "buste-paga",
              che non è una tab: la pagina si apriva con l'area contenuti vuota. */}
          <Route path="/buste-paga" element={isEnabled('buste_paga') ? <PersonalePage defaultTab="riepilogo" /> : <DisabledModule name="Buste Paga" />} />
          <Route path="/statistiche" element={isEnabled('statistiche') ? <StatisticheSala /> : <DisabledModule name="Statistiche Sala" />} />
          <Route path="/turni" element={isEnabled('turni') ? <TurniPage /> : <DisabledModule name="Turni" />} />
          <Route path="/stato-dati" element={<StatoDati />} />
          <Route path="/importa-excel" element={<ImportExcel />} />
          <Route path="/impostazioni" element={<Settings />} />
          <Route path="/costi-fissi" element={<CostiFissiPage />} />
          <Route path="/analisi-reparti" element={<AnalisiReparti />} />
          <Route path="/anagrafiche" element={<AnagraficheQualita />} />
          <Route path="/reparti" element={<Navigate to="/analisi-reparti" replace />} />
          <Route path="/sondaggi" element={<SondaggiPage />} />
          <Route path="/recensioni" element={<RecensioniPage />} />
          <Route path="/prenotazioni" element={<PrenotazioniBI />} />
          <Route path="/menu-engineering" element={<Navigate to="/prodotti-bi?tab=menu" replace />} />
          <Route path="/forecast" element={<ForecastPage />} />
          <Route path="/prodotti-bi" element={<ProdottiHub />} />
          <Route path="/camerieri-bi" element={<Navigate to="/kpi?tab=bi" replace />} />
          <Route path="/turni-bi" element={<TurniAnalysisBi />} />
          <Route path="/contabilita-bi" element={<ContabilitaBi />} />
          <Route path="/coperti-bi" element={<CopertiBi />} />
          {/* COSTI & PREZZI BI — analisi sulle 114.650 righe di dettaglio fattura.
              Come per /bilanci, ogni sottosezione ha una sotto-route propria:
              un'analisi che non si può linkare non si può nemmeno discutere. */}
          <Route path="/costi-prezzi" element={<CostiPrezziBi />} />
          <Route path="/costi-prezzi/:sezione" element={<CostiPrezziBi />} />
          {/* CATALOGO ARTICOLI — viste di sola lettura sui prezzi fornitore:
              catalogo, alert prezzi, Pareto, confronto fra fornitori. */}
          <Route path="/catalogo-articoli" element={<CatalogoArticoli />} />
          <Route path="/catalogo-articoli/:sezione" element={<CatalogoArticoli />} />
          {/* CONTROLLO COSTI — la lettura unica di personale, food, fissi e
              break-even, su tre livelli (Mameli, Predda Niedda, Gruppo). Sotto-route
              come /costi-prezzi e /bilanci: un'analisi che non si puo' linkare non si
              puo' nemmeno discutere. */}
          <Route path="/controllo-costi" element={<ControlloCosti />} />
          <Route path="/controllo-costi/:sezione" element={<ControlloCosti />} />
          {/* BILANCI — ogni sottosezione ha una sotto-route propria e linkabile */}
          <Route path="/bilanci" element={<BilanciPage />} />
          <Route path="/bilanci/:sezione" element={<BilanciPage />} />
          <Route path="/admin" element={<Navigate to="/admin/dipendenti" replace />} />
          <Route path="/admin/:tab" element={<AdminPanel />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Layout>
    </ModulesContext.Provider>
    </ErrorBoundary>
  )
}

function DisabledModule({ name }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <div className="text-4xl mb-3">🔒</div>
      <h2 className="text-lg font-semibold text-gray-700">{name} disabilitato</h2>
      <p className="text-sm text-gray-400 mt-1">Vai in Impostazioni per riattivarlo.</p>
    </div>
  )
}
