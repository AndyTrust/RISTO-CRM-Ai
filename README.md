# 🍽️ Risto CRM — Open Source Restaurant Management

A modern, fully-featured CRM for restaurants built with **React + Vite + Supabase**. Deploy in minutes. No dedicated server required.

> Built with ❤️ by [140 Grammi](https://140grammi.it) — open sourced under MIT License.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://reactjs.org)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite)](https://vitejs.dev)
[![Deploy](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)](https://vercel.com)

---

## ✨ Features

- **Dashboard** — Revenue overview, KPIs, quick stats across all locations
- **Daily Closings** — Track POS closings per location with trends and charts
- **Waiter KPIs** — Individual performance tracking with Quorum/Quantum targets
- **Sales by Operator** — Detailed revenue breakdown per waiter
- **Suppliers & Invoices** — SdI (Italian e-invoice) import and analysis
- **Employee Management** — Multi-location, cost split, transfers
- **Shift Management** — Schedule with budget and actual hours
- **Payslips** — Payroll tracking with CCNL multiplier (Italian labor law)
- **Break-Even Module** — Monthly BE calculation with real cost data
- **Statistics** — Table heatmaps, turnover, product mix
- **Analytics & BI** — Cross-module business intelligence
- **AI Chat** — Claude-powered assistant for business questions
- **Multi-location** — Add unlimited restaurants (sedi) from one dashboard
- **Quick Start Wizard** — Guided onboarding for new installations

---

## 🚀 Installation — 5 Steps

![Installation Flow](docs/images/architecture.svg)

> **Total cost: €0** — Supabase free tier + Vercel free tier are enough for most restaurants.

---

### Step 1 — Clone the repo

```bash
git clone https://github.com/AndyTrust/RISTO-CRM-Ai.git
cd RISTO-CRM-Ai
```

**What you get:**

| File | Purpose |
|------|---------|
| `setup.js` | Interactive CLI wizard — creates your `.env.local` |
| `supabase/schema.sql` | 34 tables + 16 views (run once in Supabase) |
| `supabase/seed.sql` | 24 invoice categories, 12 modules, national benchmarks |
| `client/` | React + Vite frontend |
| `README.md` | This guide |

---

### Step 2 — Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project** (free)
2. Choose a region close to you (e.g. `eu-central-1` for Italy)
3. Once created → **SQL Editor** → paste and run `supabase/schema.sql`
4. Then run `supabase/seed.sql` in the same editor
5. Go to **Project Settings → API** → copy your **Project URL** and **anon/public key**

> ✅ After running both SQL files: 34 tables created, 12 modules active, `setup_completed = false` (triggers the wizard on first launch)

---

### Step 3 — Run the interactive setup wizard

```bash
node setup.js
```

The CLI wizard guides you through 4 steps:

![CLI Wizard — Steps 1 & 2](docs/images/setup-terminal.svg)

**Step 1 — Supabase Connection**

You will be asked for:
- **Project URL** — e.g. `https://abc123.supabase.co` (from Project Settings → API)
- **Anon/public key** — the long JWT token (same page)

The wizard immediately tests the connection and tells you if it succeeds.

**Step 2 — App & Restaurant Info**

- **Restaurant / Group name** — shown in the app header (e.g. `La Mia Trattoria`)
- **Your name** — owner / admin name
- **Your email** — contact email

**Step 3 — Restaurant Locations (Sedi)**

![CLI Wizard — Sedi step](docs/images/setup-sedi.svg)

You can add **as many locations as you want** (1 to unlimited):
- **Code** — short identifier, 2–4 chars (e.g. `MI`, `RM`, `NA`, `S1`)
- **Full name** — displayed in the app (e.g. `Milano Centro`)
- **City** — optional

Repeat for each location. Press `n` when done.

**Step 4 — Claude AI (Optional)**

The Chat AI module uses [Anthropic Claude](https://console.anthropic.com). If you have an API key:
- It will be added as a **comment** in `.env.local` only — never committed
- **Add the actual key to Vercel environment variables**, not to the file

**Output:**

![CLI Wizard — Complete](docs/images/setup-complete.svg)

Two files are created:
- `client/.env.local` — your credentials (gitignored, never public)
- `.setup_done` — marker to skip wizard on re-run

```dotenv
# client/.env.local  ← never in git
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
VITE_APP_NAME=La Mia Trattoria
```

---

### Step 4 — Install dependencies & start locally

```bash
cd client
npm install
npm run dev
```

Open **[http://localhost:5173](http://localhost:5173)** in your browser.

#### 🧙 React Setup Wizard (browser)

Because `setup_completed = false` in your fresh database, the app automatically opens a **6-step Setup Wizard**:

**Step 1 — Benvenuto (Welcome)**

![React Wizard — Welcome](docs/images/wizard-welcome.svg)

Overview of what you're about to configure. Click **"Inizia la configurazione"** to begin.

**Step 2 — Info Ristorante**

Enter your restaurant group name, owner name, and email. These are saved to the `crm_config` table in Supabase.

**Step 3 — Sedi (Locations)**

![React Wizard — Sedi](docs/images/wizard-sedi.svg)

Add each location with:
- **Code** (2–4 chars) — used as internal identifier
- **Full name** — shown in every dropdown and filter
- **City** — optional
- **Color** — color-coded throughout the dashboard

Each sede is saved to the `sedi` table. You can add more from **Admin → Sedi** at any time.

**Step 4 — Storage**

Choose where your local files (Excel imports, PDF payslips, invoices) will be stored:

| Option | Best for |
|--------|----------|
| OneDrive / SharePoint | Teams using Microsoft 365 |
| Google Drive | Teams using Google Workspace |
| Local folder | Single-machine setup |
| Solo Supabase | Cloud-only, no local files |

**Step 5 — Fonti Dati (Data Sources)**

Select which data sources you'll use:

| Source | Format | Description |
|--------|--------|-------------|
| Chiusure Cassa | Excel (.xlsx) | Daily POS closings |
| Fatture Acquisto | XML SdI | Italian e-invoices from suppliers |
| Venduto Camerieri | Excel (.xlsx) | Sales breakdown per waiter |
| Sondaggi Clienti | HTML / JSON | Customer survey results |
| Buste Paga | PDF | Monthly payslips |
| Menu / Listino | PDF / Excel | Prices for margin analysis |

**Step 6 — Completo! (Done)**

![React Wizard — Complete](docs/images/wizard-done.svg)

The wizard sets `setup_completed = true` in `crm_config`. From this point, the app goes directly to the Dashboard on every load.

**What you'll see next:**
- Dashboard (empty — ready for your first data imports)
- Admin → Dipendenti to add your staff
- Admin → Sedi to manage locations
- All 12 modules enabled and ready

---

### Step 5 — Deploy to Vercel (free, optional)

```bash
# From repo root
vercel deploy --prod
```

Or connect via GitHub for automatic deploys on every push:

1. [vercel.com](https://vercel.com) → **New Project** → Import from GitHub → `RISTO-CRM-Ai`
2. Set **Root Directory** to `client`
3. Add environment variables (copy from `client/.env.local`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_APP_NAME`
   - `ANTHROPIC_API_KEY` ← add here (NOT in .env.local)
4. Deploy → your CRM is live at `https://your-app.vercel.app`

> ⚠️ **Never paste your `.env.local` file into Vercel.** Enter each variable manually in the dashboard so they stay private.

---

## 🏗️ Architecture

```
RISTO-CRM-Ai/
├── client/                    # React + Vite frontend
│   ├── src/
│   │   ├── pages/             # All CRM pages (Dashboard, Chiusure, KPI, ...)
│   │   ├── components/        # Layout, shared UI components
│   │   ├── api/               # Supabase client + API layer
│   │   └── hooks/             # useSedi, useClaudeAI, ...
│   ├── api/
│   │   └── assistant.js       # Vercel serverless — Claude AI proxy
│   ├── .env.example           # Template → copy to .env.local
│   └── vite.config.js
├── supabase/
│   ├── schema.sql             # 34 tables + 16 views (run first)
│   └── seed.sql               # Default categories + modules
├── docs/
│   └── images/                # Screenshots used in this README
├── setup.js                   # Interactive first-time setup CLI
└── README.md
```

### Database (Supabase PostgreSQL)

| Group | Tables |
|-------|--------|
| Core | `sedi`, `modules`, `crm_config`, `crm_memory` |
| Staff | `employees`, `roles`, `reparti`, `employee_operator_mapping` |
| Revenue | `chiusure_giornaliere`, `venduto_camerieri`, `varianti_camerieri` |
| KPI | `kpi_revenues`, `kpi_targets`, `kpi_targets_team`, `kpi_targets_individuale` |
| Payroll | `buste_paga`, `shifts`, `turni_budget`, `turni_fabbisogno` |
| Suppliers | `fatture_importate`, `fornitori_fatture`, `fattura_categorie` |
| Analytics | `standard_nazionali`, `statistiche_tavoli`, `social_trends` |

Key views: `v_be_mensile`, `v_chiusure_mensile`, `v_fatture_arricchite`, `v_kpi_quantum_operatore`, `v_bonus_team`

---

## 🔑 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | ✅ | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase anon/public key |
| `VITE_APP_NAME` | ✅ | Your restaurant/group name |
| `ANTHROPIC_API_KEY` | Optional | Enables AI Chat module (add in Vercel only) |

> `client/.env.local` is gitignored and never committed. Add a `.gitignore` check before your first push.

---

## 🧩 Multi-location Support

Each location (sede) has a **short code** (e.g. `MI`, `RM`, `NA`) stored in the `sedi` table. Every data record — closings, sales, payslips, invoices — is tagged with its sede code.

Add or remove locations at any time from **Admin → Sedi**. The `useSedi` hook loads them dynamically so every page, filter, and dropdown updates automatically.

```js
// In any component:
const { sedi, getSedeName, getSediOptions } = useSedi()
```

---

## 📊 Key Concepts

| Term | Meaning |
|------|---------|
| **Quantum** | Total sales / real covers served (revenue per cover) |
| **Quorum** | Average of the previous 2 months (baseline target) |
| **Break-Even** | Monthly: food cost + labor + fixed costs vs revenue |
| **CCNL multiplier** | Net salary × 1.9653 = company cost (Italian labor law) |

---

## 🤖 AI Chat Module

The Chat AI module uses [Anthropic Claude](https://anthropic.com). It has access to all your CRM data via SQL queries and can answer questions like:

- *"What was our best revenue week in Q1?"*
- *"Which waiter had the highest quantum last month?"*
- *"How close are we to break-even this month?"*
- *"Show me the top 5 products sold at location MI"*

Requires `ANTHROPIC_API_KEY` in Vercel environment variables.

---

## 🛠️ Local Development

```bash
# Clone
git clone https://github.com/AndyTrust/RISTO-CRM-Ai.git
cd RISTO-CRM-Ai

# Setup (creates client/.env.local)
node setup.js

# Install & run
cd client
npm install
npm run dev        # http://localhost:5173
npm run build      # production build check
```

---

## 📄 License

MIT © [140 Grammi](https://140grammi.it)

Free to use, modify, and distribute. Attribution appreciated but not required.

---

## 🙋 Support & Issues

- **GitHub Issues**: [github.com/AndyTrust/RISTO-CRM-Ai/issues](https://github.com/AndyTrust/RISTO-CRM-Ai/issues)
- **Built by**: [140 Grammi](https://140grammi.it) — restaurant group, Sardinia, Italy
