# 🍽️ Risto CRM — Open Source Restaurant Management

A modern, fully-featured CRM for restaurants built with **React + Vite + Supabase**. Deploy in minutes. No dedicated server required.

> Built with ❤️ by [140 Grammi](https://140grammi.it) — open sourced under MIT License.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://reactjs.org)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite)](https://vitejs.dev)

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

## 🏗️ Architecture

```
RISTO-CRM-Ai/
├── client/                 # React + Vite frontend
│   ├── src/
│   │   ├── pages/          # All CRM pages
│   │   ├── components/     # Layout, shared components
│   │   ├── api/            # Supabase client + API layer
│   │   └── hooks/          # useClaudeAI, etc.
│   ├── .env.example        # Copy → .env.local
│   └── vite.config.js
├── supabase/
│   ├── schema.sql          # All tables + views (run first)
│   └── seed.sql            # Default categories + modules
├── setup.js                # Interactive first-time setup script
└── README.md
```

**Stack:** React 18 · Vite 5 · Tailwind CSS · Supabase (PostgreSQL) · Recharts · Lucide Icons · Anthropic Claude (optional)

---

## 🚀 Installation (5 minutes)

### Prerequisites

- [Node.js 18+](https://nodejs.org)
- A free [Supabase](https://supabase.com) account
- A free [Vercel](https://vercel.com) account (for deployment)

---

### Step 1 — Clone the repository

```bash
git clone https://github.com/AndyTrust/RISTO-CRM-Ai.git
cd RISTO-CRM-Ai
```

---

### Step 2 — Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Choose a name and a strong database password
3. Wait ~2 minutes for the project to provision
4. Go to **Project Settings → API** and copy:
   - **Project URL** (looks like `https://abc123.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)

---

### Step 3 — Set up the database

In your Supabase project:

1. Go to **SQL Editor** → **New query**
2. Paste the contents of `supabase/schema.sql` → **Run** (creates all tables & views)
3. Create another query, paste `supabase/seed.sql` → **Run** (adds default categories & data)

---

### Step 4 — Run the interactive setup

```bash
node setup.js
```

This guided script will:
- Ask for your Supabase URL and anon key
- Test the connection automatically
- Ask for your restaurant name and locations
- Create `client/.env.local` securely (never committed to git)

> **Security:** Your credentials are stored only in `client/.env.local` on your machine. The file is in `.gitignore` — it will never be pushed to GitHub.

---

### Step 5 — Start locally

```bash
cd client
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — the **Setup Wizard** will guide you through the rest.

---

### Step 6 — Deploy to Vercel (free)

**Option A — Vercel CLI:**
```bash
npm install -g vercel
vercel deploy --prod   # run from repo root (RISTO-CRM-Ai/)
```

**Option B — Vercel Dashboard:**
1. Go to [vercel.com](https://vercel.com) → **Import Project** → connect GitHub
2. Set **Root Directory** to `client`
3. Add environment variables (same as `.env.local`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_APP_NAME`

> ⚠️ Never paste your `.env.local` file into GitHub or Vercel's public settings. Always enter values manually in the Vercel dashboard.

---

## 🏢 Multi-Location Setup

Risto CRM supports unlimited restaurant locations. Each location has:
- A short **code** (2–4 chars, e.g. `MI`, `RM`, `S1`)
- A **name** (e.g. `Milano Centro`)
- A **color** for visual distinction

Add locations during the Setup Wizard, or later from **Admin → Sedi**.

All modules (chiusure, venduto, KPI, etc.) automatically filter by location. Employees can be split across multiple locations with configurable cost allocation percentages.

---

## 📂 Data Import

Risto CRM can import data from multiple sources:

| Data Type | Format | How |
|-----------|--------|-----|
| Daily Closings | Excel (.xlsx) from iPratico/POS | Admin → Import |
| Waiter Sales | Excel (.xlsx) — "Venduto per operatore" | Admin → Import |
| Supplier Invoices | XML SdI (Italian e-invoices) | Fornitori → Import ZIP |
| Payslips | PDF (auto-extracted) | Buste Paga → Import PDF |
| Shifts | Manual entry or CSV | Turni |

---

## 🔑 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | ✅ | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase anon/public key |
| `VITE_APP_NAME` | ✅ | App title (e.g. `My Restaurant CRM`) |
| `ANTHROPIC_API_KEY` | Optional | Enables Claude AI chat module |

> `ANTHROPIC_API_KEY` should be a **server-side** env var (set in Vercel, not in `.env.local`).

---

## 🔒 Security

- **No secrets in the repo** — `.env.local` is gitignored
- **Row Level Security (RLS)** enabled on all Supabase tables
- **Anon key** is safe to include in the frontend (it's a public key with RLS)
- **Supabase service role key** is never used in the frontend
- All credentials validated locally via `setup.js` before writing `.env.local`

---

## 🧩 Module System

Every feature is a module. Modules can be enabled/disabled from **Admin → Moduli** without code changes. The state is stored in the `modules` table in Supabase.

---

## 🛠️ Development

```bash
cd client
npm install
npm run dev      # start dev server (http://localhost:5173)
npm run build    # production build
npm run preview  # preview production build
```

---

## 🗃️ Database Schema

See `supabase/schema.sql` for the full annotated schema. Key tables:

| Table | Purpose |
|-------|---------|
| `sedi` | Restaurant locations |
| `employees` | Staff members |
| `chiusure_giornaliere` | Daily POS closings |
| `venduto_camerieri` | Waiter sales detail |
| `fatture_importate` | Supplier invoices |
| `buste_paga` | Payslips |
| `shifts` | Shift schedule |
| `kpi_targets` | Waiter KPI targets |
| `costi_fissi` | Fixed monthly costs |
| `crm_config` | App configuration |

20+ analytical views are pre-built for dashboards (break-even, per-operator KPIs, monthly P&L, etc.).

---

## 🤖 Claude AI Integration

The **Chat AI** module uses [Anthropic Claude](https://anthropic.com). To enable:

1. Get an API key at [console.anthropic.com](https://console.anthropic.com)
2. Add `ANTHROPIC_API_KEY` to your Vercel project env vars
3. Enable the `chat_claude` module in Admin settings

The AI has context of your CRM data and can answer business questions, explain trends, and suggest actions.

---

## 🤝 Contributing

Pull requests are welcome! Please:
- Open an issue first for major changes
- Follow existing code style (ESLint, Prettier)
- Test with at least one location setup

---

## 📄 License

MIT License — see [LICENSE](LICENSE)

---

## 🙏 Credits

Built and open-sourced by **140 Grammi** (Cagliari & Sassari, Italy).  
Powered by [Supabase](https://supabase.com), [Vercel](https://vercel.com), [Anthropic Claude](https://anthropic.com).
