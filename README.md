# StudyHelper

A Next.js + Supabase web app that helps a doctor practise for the IMA diabetology exam. Course handouts are ingested into a question bank; the student practises from it and an admin reviews the bank.

## Prerequisites

- Node.js >= 20
- Docker (runs the local Supabase stack)

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in. Supabase setup steps are added as the project grows.
3. Start the local database and apply migrations (steps added as the project grows).
4. `npm run dev`

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server on port 3000 |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run test:integration` | Integration tests against local Supabase |
| `npm run test:e2e` | Playwright end-to-end tests (desktop, mobile, tablet) |
| `npm run typecheck` | `next typegen && tsc --noEmit` |
