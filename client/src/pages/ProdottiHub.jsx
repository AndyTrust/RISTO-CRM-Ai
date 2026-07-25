import { useTabParam } from '../hooks/useTabParam'
import { Tag, UtensilsCrossed, Coins, TrendingUp, Scale } from 'lucide-react'
import ProdottiBi from './ProdottiBi'
import MenuEngineering from './MenuEngineering'
import FoodCostEditor from './FoodCostEditor'
import ProdottiTrend from './ProdottiTrend'
import MarginiPiatti from './MarginiPiatti'

const TABS = [
  { id: 'bi', label: 'Prodotti BI', icon: Tag, desc: 'Food cost, matrice BCG, top seller' },
  { id: 'trend', label: 'Trend Mensile', icon: TrendingUp, desc: 'Top/flop movers e variazioni prezzo (v_prodotti_trend_mensile)' },
  { id: 'margini', label: 'Margini Piatti', icon: Scale, desc: 'Margine e food cost per piatto (v_margine_piatti)' },
  { id: 'menu', label: 'Menu Engineering', icon: UtensilsCrossed, desc: 'Categorie, food cost, classificazione menu' },
  { id: 'foodcost', label: 'Food Cost', icon: Coins, desc: 'Modifica il food cost di ogni prodotto' },
]

const TAB_IDS = TABS.map(t => t.id)
// Alias storico: /menu-engineering rimanda qui con ?tab=menu
const ALIASES = { 'menu-engineering': 'menu', 'food-cost': 'foodcost', prodotti: 'bi' }

export default function ProdottiHub() {
  const [tab, setTab] = useTabParam(TAB_IDS, 'bi', 'tab', ALIASES)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-6 pt-4">
        <div className="flex items-center gap-2 mb-3">
          <Tag className="text-blue-600" size={22}/>
          <h1 className="text-xl font-bold text-gray-900">Prodotti &amp; Menu</h1>
          <span className="text-xs text-gray-400 ml-2 hidden md:inline">
            {TABS.find(t=>t.id===tab)?.desc}
          </span>
        </div>
        <div className="flex gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
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
      {tab === 'bi' ? <ProdottiBi />
        : tab === 'trend' ? <ProdottiTrend />
        : tab === 'margini' ? <MarginiPiatti />
        : tab === 'foodcost' ? <FoodCostEditor />
        : <MenuEngineering />}
    </div>
  )
}
