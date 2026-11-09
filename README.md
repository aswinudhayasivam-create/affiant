# Affiant

Pre-publication brand-governance checkpoint. Content teams paste drafts; Affiant checks them against an approved brand base (guidelines, sourced facts, terminology), flags conflicts with exact citations, and keeps a human reviewer as the final gate.

Built by Team NorthLight for CodeTitans Round 2. Built with AI assistance (Instinct), disclosed in the submission materials.

## Demo mode

The deployed app runs a seeded demo tenant (fictional "Suncrest Beverages"). One-tap writer/reviewer roles, sample data only, no real login. Each visitor's submissions are isolated to their own browser session and can be reset at any time. Demo input is capped (20k characters, 30 checks/hour/session).

## How a check works

1. The submission text is embedded locally in this backend (all-MiniLM-L6-v2). Content does not leave the server for this step.
2. The most relevant approved clauses are retrieved (all guidelines + ranked facts).
3. A checker flags issues. Every issue must cite a retrieved clause id and quote the offending span.
4. A verification pass drops issues with fabricated citations and marks unquoted spans; dropped counts are reported in the audit trail.
5. Zero issues does not mean approved: a human reviewer always makes the final decision. Writer decisions (agree, will edit, dismiss) require a reason; everything lands in a visible decision trail.

## Checkers

- `groq`: full AI check via the Groq API (free tier), active when `GROQ_API_KEY` is set. Groq does not retain inference inputs/outputs by default; the exception is temporary logging (up to 30 days) for platform reliability or abuse investigation, which can be opted out via Zero Data Retention in Groq's Data Controls (verified against https://console.groq.com/docs/your-data on 2026-11-08). Only synthetic demo content is ever sent.
- `mock`: deterministic rules-only checker, used when no key is configured. Clearly labeled in the UI as "rules-only - not the full AI check".
- `mock-fallback`: if Groq is configured but a call fails, the result is labeled "degraded - rules-only fallback, LLM unavailable".

## Stack

- Backend: Node.js + Express. Embeddings run in-process via @xenova/transformers.
- Frontend: React + Vite + Tailwind, built into `web/dist` and served by the same server.
- Storage: PostgreSQL when `DATABASE_URL` is set (Neon free tier in production); in-memory otherwise (local dev).
- Deploy: single Render web service (free tier).

## Run locally

```bash
cd server && npm install
cd ../web && npm install && npm run build
cd .. && node server/index.js   # http://localhost:4173
```

## Environment

- `GROQ_API_KEY` (optional): enables the full AI checker.
- `GROQ_MODEL` (optional, default `llama-3.1-8b-instant`).
- `DATABASE_URL` (optional): Postgres connection string. Without it, data is in-memory and resets on restart.
- `PORT` (optional, default 4173).

## Revisions and approval gate

- Agreeing with a finding or planning an edit records a decision only. It does not change the text.
- To fix content the writer submits a revision. It is stored as a new submission linked to its parent. The original text is kept unchanged and marked superseded.
- A reviewer can approve only the current revision, and only when no findings are open or marked "agree" or "will edit". Send-back needs a comment. Every decision lands in the trail.

## Known limits (honest list)

- The citation check confirms that a cited clause exists and that the quoted span appears in the draft. It does not prove the clause applies. A heuristic flags findings that share no key terms with their clause ("relevance not confirmed"), but a wrong clause that shares a word is not caught. The human reviewer decides.
- The AI checker output varies between runs. A deterministic numeric fact check runs on top of it.
- Revisions are linked, but there is no side-by-side diff view.
- Demo only: no real login. Roles are one-tap, and sessions are browser-scoped with a rate limit. Free hosting sleeps when idle, so the first request after idle can take about 30 seconds.
- Insights are a simple count view, not analytics.
