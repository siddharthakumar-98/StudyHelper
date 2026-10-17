# StudyHelper

StudyHelper is a web app that helps a doctor practise for the IMA diabetology exam. The course handouts (photographed slides, delivered as a PDF) are turned into a question bank:

1. An admin uploads a handout. The app splits it into pages and reads every slide photo with a vision model (text, tables, diagrams), marking anything unreadable instead of guessing.
2. The admin checks (and if needed corrects) the slides, then presses **Write questions**. The slides are grouped into topics, and the model writes multiple-choice and short-answer questions from the slide content only. Every question cites its source slide, for example "Slide 42 · page 14".
3. A second model pass checks each question, and duplicates of earlier questions are retired. Questions that fail a check go to a review queue.
4. The admin reviews, edits, approves or rejects questions in the Question Bank. The student browses the active questions and can flag one that looks wrong.

Practice tests and marking arrive in later phases. Right now the Practice and Results tabs show a "Coming in the next update" placeholder.

Stack: Next.js 16 (App Router), React 19, Tailwind 4, Supabase (Postgres, Auth, Storage), the Anthropic API, Vitest and Playwright. Design spec: `docs/superpowers/specs/2026-10-15-studyhelper-design.md`.

## Prerequisites

- Node.js 20 or newer
- Docker (runs the local Supabase stack)
- An Anthropic API key, only when you want to process a handout with the real model. Tests and the dev server run without one in fake-AI mode.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the local Supabase stack (first run downloads the Docker images):

   ```bash
   npx supabase start
   ```

3. Create your env file and fill it in:

   ```bash
   cp .env.example .env.local
   npx supabase status -o env
   ```

   Copy values from the `supabase status` output into `.env.local`:

   | `.env.local` variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `API_URL` (normally `http://127.0.0.1:54321`) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY` |
   | `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` |
   | `ANTHROPIC_API_KEY` | Your key from the Anthropic console. Leave empty if you only use `AI_FAKE=1`. |
   | `CRON_SECRET` | Any long random string (for example `openssl rand -hex 32`). Protects `/api/cron/jobs`. |
   | `AI_FAKE` | Leave empty to use the real model, or set `1` to use the deterministic fake client (no spend). Never set it in production: the app refuses to start with `AI_FAKE=1` on a production Vercel deployment. |
   | `STUDENT_EMAIL`, `STUDENT_PASSWORD` | Login for the seeded student account (choose any values) |
   | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Login for the seeded admin account (choose any values) |

4. Apply the migrations to the local database (this also resets it to empty):

   ```bash
   npx supabase db reset
   ```

5. Create the student and admin accounts. Sign-up is disabled in the app, so accounts only exist through this script. It is safe to re-run; it updates the passwords:

   ```bash
   npm run seed:users
   ```

6. Start the dev server and open http://localhost:3000:

   ```bash
   npm run dev
   ```

   Log in as the admin to upload handouts and review questions, or as the student to browse the bank.

## Adding a new handout

You need to be logged in as the admin, and `AI_FAKE` must be empty (and `ANTHROPIC_API_KEY` set) for real extraction. Processing a handout spends money (see the cost table below).

1. Open **Materials** and use **Add a handout**. Give it a title, optionally a class date, choose the PDF (or photos), and submit. The file goes straight from the browser to private storage, so large phone-camera PDFs (15 to 20 MB) work.
2. Stay on the handout page and **watch the progress**. The browser drives the pipeline one step at a time: it splits the pages and reads the slides, and each page's slides appear as soon as that page is read. Keep the page open; if you close it, reopen the handout page to finish (the daily sweep only advances a few steps). If a step fails three times you see the error and a **Try again** button.
3. When reading finishes, the pipeline **pauses** and the handout shows **Slides are ready to check** (students see "Slides are being checked before questions are written."). **Review the slides** now: open any slide to compare the extracted text with the photo, and correct partial or unreadable ones by hand (they are marked as admin-corrected). Questions are written from the text as it is when you continue.
4. Press **Write questions**. The page then builds the topic map, writes the questions and checks them, with the same progress panel. A slide corrected later sends every question that cites it back to the review queue with the note "Source slide was corrected".
5. When the status is `Ready`, read the **coverage report** on the handout page. It states the real number of questions, per topic and difficulty, and lists slides that produced no question and why (for example unreadable, nothing testable, or could not be processed automatically). One question or slide the AI keeps failing on never blocks the handout: a question goes to review with the note "Automatic check could not finish: …", and a slide is skipped and listed in the report.
6. Open **Question Bank**. It opens on **Needs review** while there is something in the queue. Approve, edit, regenerate or reject each question. Questions whose slides contradict each other carry a visible conflict note; read those first.

Uploading a second handout that overlaps the first reuses existing topics, and questions that repeat earlier ones are retired as duplicates.

## Tests

| Command | What it runs |
| --- | --- |
| `npm test` | Unit tests (Vitest, no services needed) |
| `npm run test:integration` | Integration tests against the local Supabase stack (`npx supabase start` first). They reset the database tables. |
| `npm run test:e2e` | Playwright end-to-end tests in desktop, mobile (WebKit) and tablet projects. It starts `AI_FAKE=1 npm run dev` itself, or reuses a server already on port 3000. Needs the local Supabase stack, seeded users in `.env.local`, and `npx playwright install` once. |
| `npm run typecheck` | `next typegen && tsc --noEmit` |
| `npm run lint` | ESLint |

The e2e suite starts its own dev server with `AI_FAKE=1`: the fake client returns deterministic extraction and questions, so e2e spends nothing. But Playwright reuses any server already listening on port 3000, and that server may be using your real API key. Stop any other dev server before running `npm run test:e2e`, or start the server yourself with `AI_FAKE=1 npm run dev` and leave it running. The same command is the way to click through the app without spending anything.

The e2e specs share one local database and reset it, so run them on a throwaway local stack, not one holding a handout you care about. The integration and e2e helpers refuse to start unless `NEXT_PUBLIC_SUPABASE_URL` is a `localhost` or `127.0.0.1` URL, and `test_reset_app_tables()` refuses to run on any database where `supabase/seed.sql` (applied only by `npx supabase db reset`) has not switched it on.

## Evals

Evals check AI quality against known answers. They read `.env.local`.

| Command | What it checks | Cost |
| --- | --- | --- |
| `npm run eval:extraction -- <documentId>` | Re-reads the ten gold pages of an already-split handout and scores critical-token recall on clear slides (target 98% or more) and legibility agreement. Writes `evals/extraction/report.md`. | About $0.40 (live AI) |
| `npm run eval:dedup` | Runs the 10-pair duplicate-detection set through the same path the verify stage uses (target: at least 9 of 10 duplicates caught, no false merges). Writes `evals/dedup/report.md`. | Under $0.10 (live AI) |
| `npm run eval:audit-sample -- <documentId> [--seed <n>]` | Writes `evals/generation/audit-<date>.md`: a seeded random 20% (at least 1) of the document's active questions, each with its answer, source and a checklist to fill in by hand. Makes no AI calls. | Free |

Before you run the two paid evals:

- They call the real model and need `ANTHROPIC_API_KEY`. Agree the spend first.
- `evals/extraction/gold.json` must be verified by you against the PDF first. The eval trusts it as ground truth, so a wrong token in it produces a wrong score.
- The extraction eval needs a handout that has already been uploaded and split (use its document id from the URL of the handout page).

The audit file contains correct answers, so treat it as admin-only: this file is git-ignored; share it privately. Fill in the checklist columns (Supported by slide, Single best answer / rubric sound, Unambiguous, Difficulty right, Source correct, Notes) while looking at the slide photos, and fix or reject any question that fails in the Question Bank. The target is at least 90% of audited questions passing every column, with no unsupported facts.

## Cost

Claude list prices: Opus 5.5 $4 / $20 per million input / output tokens; Sonnet 5.5 $2 / $10. Phase 2 uses Opus 5.5 for every AI task.

| Task | Unit | Opus 5.5 | Sonnet 5.5 |
| --- | --- | --- | --- |
| Ingest + generate + verify one 42-page handout (one-time) | per handout | $12–16 per 42-page handout | n/a (Opus) |
| Grade one SAQ (3 independent samples) | per answer | about $0.13 | about $0.06 |
| Default test (10 SAQ) | per test | about $1.30 | about $0.65 |
| IMA preset (5 SAQ) | per test | about $0.65 | about $0.33 |
| Handwriting transcription | per photographed page | about $0.03 | about $0.015 |
| MCQ grading | n/a | $0 (done in code) | $0 |

Grading and handwriting rows apply from Phase 3 and Phase 4; only the first row is spent in Phase 2. Stage the first real run instead of processing the whole handout at once: read one page, write the topic map, write one batch of questions and check about three, compare the measured cost and step times with the estimate, and only then continue with the rest. Three default tests a week comes to about $15 a month on Opus or about $8 a month on Sonnet. Hosting stays at $0 on free tiers.

Every AI call is recorded in the `ai_calls` table with model, prompt version, token counts and USD cost. Total spend so far:

```sql
select sum(cost_usd) from ai_calls;
```

## Deploying (Supabase cloud + Vercel)

You do the account steps; nothing here is automatic.

1. **Create a Supabase project** in the Supabase dashboard (free tier is fine). Note the project ref, the project URL, the anon key and the service-role key (Project Settings, API).
2. **Push the schema** from this repo:

   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```

3. **Check where `pg_trgm` lives.** The duplicate detection functions expect it in the `extensions` schema. In the Supabase SQL editor run:

   ```sql
   select extnamespace::regnamespace from pg_extension where extname = 'pg_trgm';
   ```

   If the answer is not `extensions`, move it:

   ```sql
   alter extension pg_trgm set schema extensions;
   ```

4. **Disable public sign-ups.** In the Supabase dashboard go to Authentication, Sign In / Providers, and turn off "Allow new users to sign up". Every logged-in user can read the course material, so self-registration must stay off. Accounts are created only by `npm run seed:users`.
5. **Create the Vercel project** and import this repository (framework: Next.js; `vercel.json` already declares the cron).
6. **Set the environment variables** in the Vercel project (Production and Preview): every variable in `.env.example` except `AI_FAKE`. Use the cloud project's URL, anon key and service-role key, a real `ANTHROPIC_API_KEY`, and your chosen student and admin credentials. Leave `AI_FAKE` unset: the app throws on startup if it is `1` on a production deployment.
7. **Set `CRON_SECRET`** to a long random string. Vercel sends it as a bearer token to `/api/cron/jobs`; requests without it get a 401.
8. **Deploy** (push the branch, or run `npx vercel --prod`).
9. **Create the accounts** in the cloud project by running the seed script with the cloud values passed inline. Never point `.env.local` at the cloud project, not even for a moment: the test suites reset whatever database it names. (They refuse any URL that is not `localhost` or `127.0.0.1`, and the reset function only runs where `supabase/seed.sql` enabled it, but do not rely on that.)

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
   STUDENT_EMAIL=... STUDENT_PASSWORD=... ADMIN_EMAIL=... ADMIN_PASSWORD=... \
   npm run seed:users
   ```

   Note that `npm run seed:users` loads `.env.local` too; variables already in the shell are not overridden by it, so the inline form wins.
10. **Smoke test on a phone:** log in as the student, browse the bank, flag one question, sign out.

## Operations

- **Job sweep.** Handout processing runs in short steps, driven by the open handout page. A Vercel cron calls `/api/cron/jobs` once a day (03:00 UTC, `vercel.json`) and advances unfinished jobs, for example because the admin closed the tab. It only starts steps during its first 20 seconds (any step may take up to about 280 seconds of the 300-second limit), so it moves a handout on by a few steps at most: reopen the handout page to finish. On the free tier this is a safety net, not the main driver. It never starts question writing: a handout waiting for its slide check stays there until the admin presses **Write questions**.
- **Failed jobs.** A step is tried three times. After that the handout page shows the error and a **Try again** button.
- **Free-tier pause.** A free Supabase project is paused after 7 days without activity. Un-pause it in the dashboard. Phase 6 adds a keep-alive.
- **Spend.** Check `select sum(cost_usd) from ai_calls;` after each handout.
- **Storage.** Handout files are in the private `materials` bucket; the browser only ever gets short-lived signed URLs.
