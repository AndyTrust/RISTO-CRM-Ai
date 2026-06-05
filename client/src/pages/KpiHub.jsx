import { useSearchParams } from 'react-router-dom'
import { Target, Award, Users, BarChart3 } from 'lucide-react'
import PageAssistant from '../components/PageAssistant'
import KPIWaiters from './KPIWaiters'
import KpiTeamPage from './KpiTeamPage'
import CamerieriBi from './CamerieriBi'
import PerformancePage from './PerformancePage'

const TABS = [
  { id: 'camerieri', label: 'KPI Camerieri', icon: Target, desc: 'Performance operatori, quantum, bonus' },
  { id: 'team', label: 'KPI Team', icon: Award, desc: 'Break-even, obiettivi prodotto, bonus team' },
  { id: 'bi', label: 'Camerieri BI', icon: Users, desc: 'Analisi BI mensile operatori' },
  { id: 'performance', label: 'Performance', icon: BarChart3, desc: 'Venduto, obiettivi, team, tavoli' },
]

export default function KpiHub() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'camerieri'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-6 pt-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className="text-blue-600" size={22}/>
          <h1 className="text-xl font-bold text-gray-900">KPI &amp; Performance</h1>
          <span className="text-xs text-gray-400 ml-2 hidden md:inline">
            {TABS.find(t=>t.id===tab)?.desc}
          </span>
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setParams({ tab: t.id })}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 whitespace-nowrap transition-colors ${
                tab === t.id
                  ? 'border-blue-600 text-blue-700 bg-blue-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}>
              <t.icon size={15}/>{t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'camerieri' && <KPIWaiters />}
      {tab === 'team' && <KpiTeamPage />}
      {tab === 'bi' && <CamerieriBi />}
      {tab === 'performance' && <PerformancePage />}
      <PageAssistant pageId={`kpi-hub-${tab}`} systemContext={{ tab }}
        suggestions={[
          'Chi è il miglior cameriere del mese?',
          'Il team sta raggiungendo i target?',
          'Confronta le performance MA vs PN',
          'Quali bonus sono maturati questo mese?',
        ]}/>
    </div>
  )
}
