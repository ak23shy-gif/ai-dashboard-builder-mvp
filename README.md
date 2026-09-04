# DashForge AI Dashboard Builder

Next.js, TypeScript, Tailwind CSS and React dashboard builder for AI-generated BI dashboards.

## Architecture

```text
Prompt, file, API or database source
  -> Server-side AI/data route
  -> Structured Dashboard JSON
  -> JSON validation
  -> DashboardRenderer
  -> Predefined React dashboard components
```

The LLM never generates arbitrary HTML or React code. It returns validated dashboard JSON, and the application renders that JSON using controlled dashboard components.

## Current Capabilities

- AI Copilot powered by Gemini or OpenAI when configured.
- Local dashboard planner fallback when a cloud provider is unavailable.
- Prompt-based dashboard generation and follow-up dashboard edits.
- CSV and Excel upload with automatic field detection.
- REST/JSON API connector with URL, method, headers, body and data-path support.
- PostgreSQL, MySQL and SQL Server connection testing, table discovery and table preview.
- Automatic dashboard generation from uploaded files, APIs and database table previews.
- Professional dashboard renderer with KPI cards, line charts, area charts, bar charts, horizontal bars, pie charts, heatmaps, funnels, gauges and data tables.
- Dashboard-wide filters for primary dimension, secondary dimension and period.
- Power BI-style data model view with field summaries and row preview.
- Local dashboard persistence with browser localStorage.
- Dashboard editing controls for rename, delete and chart-type changes.

## Environment

Create `.env.local` for cloud AI generation:

```bash
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5

GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.6-flash
AI_PROVIDER=gemini
```

## Run Locally

```bash
npm install
npm run dev
```

The app runs at:

```text
http://127.0.0.1:3001
```

## Deploy Online

This is a full Next.js app with backend API routes. Use a Node-capable host such as Vercel, Azure App Service, Render or Railway.

### Vercel

```bash
npm install
npm run build
npx vercel deploy --prod
```

Add these environment variables in the Vercel project settings:

```bash
OPENAI_API_KEY
OPENAI_MODEL
GEMINI_API_KEY
GEMINI_MODEL
AI_PROVIDER
```

### Docker / Azure / Render

The included `Dockerfile` builds and runs the app on port `3001`.

```bash
docker build -t dashforge-ai .
docker run -p 3001:3001 --env-file .env.production dashforge-ai
```

Important: PostgreSQL, MySQL and SQL Server connectors use server-side database drivers, so the deployment host must allow outbound database/network access.

## Production Work Still Needed

- Shared server-side dashboard storage instead of localStorage.
- Authentication and role-based access.
- Encrypted saved credentials for reusable database/API connections.
- Shared dashboard URLs.
- Scheduled refresh and production deployment.
