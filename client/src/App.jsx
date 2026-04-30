import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import PersonalePage from './pages/PersonalePage'
import KPIWaiters from './pages/KPIWaiters'
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
import RicettePage from './pages/RicettePage'
import KPIConfig from './pages/KPIConfig'
import KpiTeamPage from './pages/KpiTeamPage'
import CostiFissiPage from './pages/CostiFissiPage'
import ListinoProdotti from './pages/ListinoProdotti'
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
    <ModulesContext.Provider value={{ modules, toggleModule, saveModules, isEnabled }}>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/setup" element={<SetupWizard onComplete={() => setSetupCompleted(true)} />} />
          <Route path="/dashboard" element={isEnabled('dashboard') ? <Dashboard /> : <DisabledModule name="Dashboard" />} />
          <Route path="/dipendenti" element={<Navigate to="/buste-paga?tab=dipendenti" replace />} />
          <Route path="/kpi" element={isEnabled('kpi_camerieri') ? <KPIWaiters /> : <DisabledModule name="KPI Camerieri" />} />
          <Route path="/kpi-config" element={<KPIConfig />} />
          <Route path="/kpi-team" element={<KpiTeamPage />} />
          <Route path="/listino" element={<ListinoProdotti />} />
          <Route path="/venduto" element={isEnabled('venduto') ? <VendutoPage /> : <DisabledModule name="Venduto" />} />
          <Route path="/chiusure" element={isEnabled('chiusure') ? <ChiusurePage /> : <DisabledModule name="Chiusure" />} />
          <Route path="/chat" element={isEnabled('chat_claude') ? <ChatClaude /> : <DisabledModule name="Chat Claude AI" />} />
          <Route path="/fornitori" element={isEnabled('fornitori') ? <FornitoriPage /> : <DisabledModule name="Fornitori" />} />
          <Route path="/ricette" element={isEnabled('ricette') ? <RicettePage /> : <DisabledModule name="Ricette & Food Cost" />} />
          <Route path="/analytics" element={isEnabled('analytics_bi') ? <AnalyticsBI /> : <DisabledModule name="Analytics & BI" />} />
          <Route path="/buste-paga" element={isEnabled('buste_paga') ? <PersonalePage defaultTab="buste-paga" /> : <DisabledModule name="Buste Paga" />} />
          <Route path="/statistiche" element={isEnabled('statistiche') ? <StatisticheSala /> : <DisabledModule name="Statistiche Sala" />} />
          <Route path="/turni" element={isEnabled('turni') ? <TurniPage /> : <DisabledModule name="Turni" />} />
          <Route path="/impostazioni" element={<Settings />} />
          <Route path="/costi-fissi" element={<CostiFissiPage />} />
          <Route path="/admin" element={<Navigate to="/admin/dipendenti" replace />} />
          <Route path="/admin/:tab" element={<AdminPanel />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Layout>
    </ModulesContext.Provider>
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
