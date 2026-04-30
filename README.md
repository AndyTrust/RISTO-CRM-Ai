# 🍽️ Risto CRM — Open Source Restaurant Management

A modern, fully-featured CRM for restaurant management built with React + Vite + Supabase. Deploy in minutes. No server required.

> Built with ❤️ by [140 Grammi](https://140grammi.it) — open sourced under MIT License.

---

## ✨ Features

- **Dashboard** — Revenue overview, KPIs, quick stats across all locations
- **Daily Closings** — Track POS closings per location with trends and charts
- **Waiter KPIs** — Individual performance tracking with Quorum/Quantum targets
- **Sales by Operator** — Detailed revenue breakdown per waiter
- **Suppliers & Invoices** — SdI (Italian e-invoice) import and analysis
- **Employee Management** — Multi-location, cost split, transfers
- **Shift Management** — Schedule and actual hours with cost projection
- **Payslips** — Payroll tracking with CCNL multiplier
- **Statistics** — Hourly heatmaps, table turnover, product mix
- **Analytics & BI** — Cross-module data intelligence
- **AI Chat** — Claude-powered assistant for business questions
- **1-click Backup & Restore** — Full Supabase snapshot in the browser
- **Multi-location** — Add unlimited locations with auto-replicated structure
- **Quick Start Wizard** — Onboarding for new installations

---

## 🚀 Quick Start

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a free project, and run the migration SQL (see `supabase/migrations/`).

### 2. Clone and configure

```bash
git clone https://github.com/AndyTrust/RISTO-CRM-Ai.git
cd RISTO-CRM-Ai/client
cp .env.example .env.local
```

Edit `.env.local`:
```env
VITE_APP_NAME=Il Tuo Ristorante
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

### 3. Install and run

```bash
cd ..
npm run install:all
npm run dev
# → open http://localhost:5173
```

The **Quick Start Wizard** will guide you through:
- Restaurant name and branding
- Adding your locations (sedi)
- Choosing your data storage (OneDrive / Google Drive / Local / Supabase-only)
- Enabling modules

### 4. Deploy to Vercel (optional)

```bash
cd client
npm run build
vercel deploy --prod
```

Add the same environment variables in Vercel Dashboard → Settings → Environment Variables.

---

## 🗃️ Database Setup

Run the Supabase migration to create all tables:

```sql
-- In Supabase SQL Editor, run the contents of:
-- supabase/migrations/001_initial_schema.sql
```

The migration creates all tables with Row Level Security disabled for anonymous access (suitable for internal tools behind a VPN or private Vercel deployment).

---

## 📁 Project Structure

```
RISTO-CRM-Ai/
├── client/                      ← React + Vite (production on Vercel)
│   ├── src/
│   │   ├── api/
│   │   │   ├── supabase-client.js   ← All Supabase queries
│   │   │   └── client.js            ← Re-exports
│   │   ├── components/
│   │   │   └── Layout.jsx           ← Sidebar navigation
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── ChiusurePage.jsx     ← Daily closings
│   │   │   ├── VendutoPage.jsx      ← Sales
│   │   │   ├── KPIWaiters.jsx       ← Waiter KPIs
│   │   │   ├── FornitoriPage.jsx    ← Suppliers
│   │   │   ├── Employees.jsx
│   │   │   ├── TurniPage.jsx        ← Shifts
│   │   │   ├── BustePaga.jsx        ← Payslips
│   │   │   ├── StatisticheSala.jsx  ← Statistics
│   │   │   ├── AnalyticsBI.jsx      ← Business intelligence
│   │   │   ├── ChatClaude.jsx       ← AI chat
│   │   │   ├── Settings.jsx
│   │   │   ├── AdminPanel.jsx       ← Backoffice
│   │   │   └── SetupWizard.jsx      ← First-run wizard
│   │   ├── App.jsx                  ← Router + module context
│   │   └── supabase.js              ← Supabase client
│   ├── .env.example             ← Copy to .env.local
│   └── vercel.json              ← SPA rewrite rules
│
└── server/                      ← Optional local Express dev server
```

---

## ⚙️ Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_APP_NAME` | Your restaurant name (shown in sidebar) |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |

---

## 📊 Supabase Tables

| Table | Description |
|-------|-------------|
| `chiusure_giornaliere` | Daily POS closing data |
| `kpi_revenues` | Waiter revenue KPIs |
| `employees` | Staff registry |
| `shifts` | Work shifts |
| `buste_paga` | Payroll records |
| `fatture_importate` | Imported invoices (SdI) |
| `fornitori_fatture` | Supplier registry |
| `modules` | CRM module toggles |
| `crm_config` | Key-value configuration store |
| `sedi` | Locations registry |
| `crm_backups` | Full database snapshots |

---

## 🔧 Modules (enable/disable from Settings)

Each module can be independently enabled/disabled from the Settings page:

| Module | Route | Description |
|--------|-------|-------------|
| Dashboard | `/dashboard` | Overview |
| Chiusure | `/chiusure` | Daily closings |
| Venduto | `/venduto` | Sales by operator |
| KPI Camerieri | `/kpi` | Waiter targets |
| Fornitori | `/fornitori` | Supplier invoices |
| Dipendenti | `/dipendenti` | Employee registry |
| Turni | `/turni` | Shift management |
| Buste Paga | `/buste-paga` | Payroll |
| Statistiche | `/statistiche` | Hall statistics |
| Analytics BI | `/analytics` | BI dashboard |
| Chat Claude | `/chat` | AI assistant |

---

## 🏪 Multi-Location Support

Add unlimited locations from **Admin → Sedi**. Each location:
- Gets a unique short code (e.g. `MA`, `PN`, `FI`)
- Appears in all module filters automatically
- Inherits the full module structure

---

## 🔒 Security Notes

This CRM is designed for **internal use** (single restaurant team). By default:
- All Supabase tables allow anonymous read/write
- No authentication required
- Suitable for use behind a private Vercel deployment or VPN

To add authentication, wrap your app with Supabase Auth (see `AuthGate.jsx`).

---

## 🤖 Claude AI Integration

The Chat module and Skills use [Anthropic Claude](https://anthropic.com). To enable:
1. Get an API key at [console.anthropic.com](https://console.anthropic.com)
2. Add `ANTHROPIC_API_KEY` as a server-side environment variable
3. The Chat module sends queries to Claude for restaurant business analysis

---

## 📄 License

MIT © 2026 140 Grammi

Free to use, modify, and distribute. Attribution appreciated but not required.

---

## 🙏 Contributing

PRs welcome! If you're using this for your own restaurant, we'd love to hear about it.

Open an issue to report bugs or request features.
