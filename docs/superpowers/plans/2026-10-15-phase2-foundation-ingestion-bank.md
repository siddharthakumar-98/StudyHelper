# StudyHelper Phase 2 — Foundation, Ingestion & Question Bank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, login-protected StudyHelper site where the admin uploads a lecture handout (image-only PDF or photos) and gets an auto-verified, source-cited MCQ and short-answer question bank that both users can browse and the admin can review.

**Architecture:**
- Next.js App Router app backed by Supabase (Postgres with RLS, Auth, private Storage).
- A resumable, step-wise job pipeline: `split → extract → topic_map → generate → verify`. Each step makes at most one Claude call per unit of work and writes atomically through Postgres functions.
- All AI calls go through a single `AiClient`: structured outputs with zod, cost logging, and a deterministic fake for tests and e2e.

**Tech Stack:**
- Node 25 (≥ 20 required), Next.js 16 (App Router, TypeScript strict), Tailwind CSS 4, Radix UI primitives.
- Supabase (`@supabase/supabase-js` 2.x, `@supabase/ssr`, Supabase CLI via `npx supabase`, local stack in Docker).
- `@anthropic-ai/sdk` ≥ 0.134.0, zod 4, pdf-lib 1.17, heic2any.
- Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-studyhelper-design.md` (approved 2026-10-15). This plan implements spec §12 **Phase 2**. Phases 3–6 get their own plans.

## Global Constraints

- Work on branch `phase-2-foundation` off `main`. Merge to `main` only when Task 17's acceptance passes and the user agrees.
- TypeScript `strict: true`. Path alias `@/*` → `src/*`.
- **Models:**
  - `claude-opus-5-5` for every Phase 2 AI task (extract, topicMap, generate, verify, dedup). Copy model IDs exactly; never add date suffixes.
  - Always set `output_config.effort` explicitly.
  - Never send `temperature`, `budget_tokens` or `thinking: {type:"disabled"}`.
  - Every request uses `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`.
- **AI calls:**
  - Non-streaming `client.beta.messages.parse` with `max_tokens` ≤ 16000. Any unit of work that could need more output is split, as Task 12 does for generation batches.
  - Every AI call is recorded in `ai_calls` with model, prompt version, token counts and USD cost.
  - Prompt versions are named `<name>@<N>`. Any change to a prompt's text bumps N.
- **Answer keys (spec §3):** `answer_keys` has RLS enabled and **zero policies**. Answer keys reach the browser only on admin-only Question Bank pages rendered on the server.
- The service-role Supabase client may be imported only from files that start with `import "server-only"`.
- Private storage bucket `materials`. Files are uploaded straight from the browser using signed upload URLs; Vercel's 4.5 MB request-body limit makes server-side upload impossible for real handouts.
- **UI:**
  - Base font 18 px, with text-scale steps `1 | 1.15 | 1.3` remembered per device.
  - Every interactive target ≥ 48 × 48 px. WCAG 2.2 AA contrast.
  - English, plain-language labels, glucose units in mg/dL.
- **Content rules (spec §4):**
  - Course material is primary. Questions are generated only from slide content and are never padded to reach a target.
  - Contradictions between slides, or between slides and guidelines, are surfaced as a `conflict_note`, never silently resolved.
  - Unreadable text is marked, never invented.
- `AI_FAKE=1` selects the deterministic fake AI client. Startup throws if `AI_FAKE=1` while `VERCEL_ENV === "production"`.
- Live-AI evals and real-handout runs spend money. Before running one, show the user the cost estimate and get approval.
- Commit after every task, ending each commit message with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Spec clarifications decided here** (they do not change behaviour the user approved):

1. Text scale is remembered per device in `localStorage` (spec §8). The `profiles.text_scale` column from spec §9 is omitted.
2. Deterministic pre-checks run before verification. A question that fails them goes straight to `needs_review` without a verifier call.
3. Duplicate detection runs inside the verify stage, before the verifier call. Duplicates are retired with the note "Duplicate of …", which saves verifier cost.
4. In Phase 2 the Practice and Results tabs show a "Coming in the next update" placeholder.

## Review Focus

1. **A full-size handout (15–20 MB) uploaded from a phone** must upload directly to storage and ingest. Test: Task 7, e2e with a 20 MB fixture.
2. **Slides with missing, odd or duplicate printed numbers** (the unnumbered page-2 photos, "39. 38.SGLT2-I") must get distinct, readable labels that fall back to page and photo position. Test: Task 8, unit test of `slideLabel` plus an integration test.
3. **A second handout that overlaps the first** must reuse existing topics, and questions that repeat earlier ones must be retired as duplicates rather than added. Test: Task 13 integration.
4. **AI failure mid-pipeline** (429, refusal, truncated output) must retry the step without leaving partial rows. After three failures the user sees a clear error with a Retry button. Tests: Task 6 unit, plus Task 8 and Task 13 integration.
5. **The same job run from two tabs, or from a tab and the cron sweep,** must execute each step exactly once. Test: Task 6 integration of `claim_job` concurrency.

---

## File map (created in this phase)

```
.env.example · vercel.json · vitest.config.ts · vitest.integration.config.ts · playwright.config.ts
supabase/config.toml · supabase/migrations/*.sql · supabase/seed.sql (empty)
scripts/seed-users.ts
src/app/layout.tsx · src/app/globals.css · src/app/page.tsx
src/app/(auth)/login/page.tsx · src/proxy.ts
src/app/practice/page.tsx · src/app/results/page.tsx                (placeholders)
src/app/materials/page.tsx · src/app/materials/[docId]/page.tsx
src/app/bank/page.tsx · src/app/bank/[questionId]/page.tsx
src/app/api/jobs/[id]/step/route.ts · src/app/api/cron/jobs/route.ts
src/components/shell/{AppShell,NavTabs,TextScaleControl}.tsx · src/components/shell/useTextScale.ts
src/components/jobs/{useJobRunner.ts,PipelineProgress.tsx}
src/components/materials/{UploadForm,SlideCard,CoverageReportView}.tsx
src/components/bank/{BankFilters,QuestionCard,QuestionDetailView,EditQuestionForm,FlagDialog}.tsx
src/lib/supabase/{browser,server,service}.ts · src/lib/supabase/database.types.ts (generated)
src/lib/auth.ts · src/lib/text.ts
src/modules/ai/{client,fake,models,pricing,errors,usage}.ts
src/modules/ai/schemas/{extraction,topicMap,generation,verification}.ts
src/modules/ai/prompts/{extractSlides,topicMap,generateQuestions,dedup,verifyQuestion}.ts
src/modules/jobs/{types,engine,store,registry}.ts
src/modules/ingestion/{splitPdf,validateUpload,upload,prepareImage,extractSlides,slideLabel,handlers}.ts
src/modules/generation/{topicMap,generate,validate,verify,coverage,handlers}.ts
src/modules/bank/{lifecycle,repository,actions}.ts
tests/unit/** · tests/integration/** · tests/e2e/** · tests/fixtures/{makePdf.ts,sample.heic,sample.jpg}
evals/extraction/{gold.json,run.ts} · evals/dedup/{pairs.json,run.ts} · evals/generation/auditSample.ts
README.md
```

---

### Task 1: Project scaffold and test tooling

**Files:**
- Create: Next.js app at repo root, `vitest.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`, `.env.example`, `README.md`
- Test: `tests/unit/smoke.test.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces:
  - `npm run dev | build | lint | test | test:integration | test:e2e | typecheck`
  - `.env.example` keys: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `AI_FAKE`, `STUDENT_EMAIL`, `STUDENT_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`

- [ ] **Step 1: Create the branch and scaffold.** Run `git checkout -b phase-2-foundation`, then `npx create-next-app@16 . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack`. The existing `docs/` and `.gitignore` are allowed in a non-empty directory. If the scaffold changes `.gitignore`, merge its entries back into ours.
- [ ] **Step 2: Install dependencies.**
  - Runtime: `npm i @supabase/supabase-js @supabase/ssr @anthropic-ai/sdk zod pdf-lib heic2any server-only @radix-ui/react-dialog @radix-ui/react-radio-group @radix-ui/react-select`
  - Dev: `npm i -D vitest @vitest/coverage-v8 @playwright/test supabase tsx dotenv`
  - Then run `npx playwright install chromium webkit`.
- [ ] **Step 3: Configure tests.**
  - `vitest.config.ts`: include `tests/unit/**/*.test.ts`, environment `node`, alias `@` → `src`.
  - `vitest.integration.config.ts`: include `tests/integration/**/*.test.ts`, `fileParallelism: false`, `setupFiles` loads `.env.test.local`.
  - `playwright.config.ts`:
    - projects `desktop` (1280×800, chromium), `mobile` (375×812, webkit, `isMobile: true`) and `tablet` (768×1024, chromium);
    - `webServer` runs `AI_FAKE=1 npm run dev` on port 3000, `reuseExistingServer: true`.
  - Add the scripts listed under Produces. `typecheck` is `tsc --noEmit`.
- [ ] **Step 4: Write smoke tests.**
  - `tests/unit/smoke.test.ts`: `expect(1 + 1).toBe(2)`.
  - `tests/e2e/smoke.spec.ts`: visiting `/login` returns status < 400.
- [ ] **Step 5: Verify.** Run `npm test && npm run typecheck && npm run build`. Expected: all pass. `/login` doesn't exist yet, so skip e2e until Task 3.
- [ ] **Step 6: Write the README.** Minimal: what the app is, prerequisites (Node ≥ 20, Docker), and "Local setup" steps filled in by later tasks.
- [ ] **Step 7: Commit.** `chore: scaffold Next.js app with test tooling`

### Task 2: Local Supabase, core schema and RLS

**Files:**
- Create: `supabase/config.toml` (via `npx supabase init`), `supabase/migrations/20261015000100_core_schema.sql`, `src/lib/supabase/database.types.ts` (generated)
- Test: `tests/integration/rls.test.ts`, `tests/integration/helpers.ts`

**Interfaces:**
- Produces:
  - Enums: `user_role('student','admin')`, `question_type('mcq','saq','essay')`, `question_status('draft','needs_review','active','flagged','retired')`, `difficulty('easy','medium','hard')`, `legibility('clear','partial','unreadable')`, `page_kind('pdf_page','image')`, `job_status('pending','running','done','failed')`.
  - Tables as in spec §9, with these column-level decisions:
    - `profiles(id uuid pk → auth.users, role user_role default 'student', display_name text)`
    - `documents(id, title, class_date date null, page_count int default 0, status text default 'uploading', uploaded_by uuid, created_at)`
    - `document_files(id, document_id, file_index int, storage_path, mime_type, size_bytes)`
    - `source_pages(id, document_id, page_no int, source_file_index int, kind page_kind, storage_path, unique(document_id,page_no))`
    - `source_slides(id, page_id, position_on_page int, printed_slide_no text null, title text null, verbatim_text text, tables jsonb default '[]', diagram_description text null, legibility, uncertain_terms text[] default '{}', cropped bool, admin_corrected bool default false, unique(page_id,position_on_page))`
    - `topics(id, name text)` with a unique index on `lower(name)`
    - `slide_topics(slide_id, topic_id, pk(slide_id,topic_id))`
    - `generation_runs(id, document_id, started_at, completed_at, report jsonb)`
    - `questions(id, type, status default 'draft', current_version int default 1, topic_id, difficulty, generation_run_id null, batch_key text null, created_at)`
    - `question_versions(question_id, version, stem, options jsonb null, source_refs jsonb, basis_quote text, conflict_note text null, review_notes text[] default '{}', created_at, pk(question_id,version))`
    - `answer_keys(question_id, version, correct_option_id text null, explanation text null, model_answer text null, key_concepts jsonb null, rubric jsonb null, pk(question_id,version))`
    - `question_flags(id, question_id, user_id, comment, created_at, resolved_at)`
  - SQL function `public.is_admin() returns boolean` (security definer, reads `profiles.role` for `auth.uid()`).
  - Trigger `on auth.users insert` → insert `profiles(id)`.
  - `tests/integration/helpers.ts`:
    - `serviceClient(): SupabaseClient`
    - `signedInClient(email: string, password: string): Promise<SupabaseClient>`
    - `resetDb(): Promise<void>` truncates all app tables except profiles
    - `createTestUser(role: 'student'|'admin'): Promise<{email:string; password:string; id:string}>`

- [ ] **Step 1: Initialise and start.** Run `npx supabase init`, then `npx supabase start`. Copy the URL, anon key and service-role key from `npx supabase status` into `.env.local` and `.env.test.local` (both gitignored).
- [ ] **Step 2: Write failing RLS tests** in `tests/integration/rls.test.ts`:
  - `anon cannot select documents` → result `data` is `[]` or `error` is set.
  - `student can select documents and topics`.
  - `student cannot insert documents` → `error` is not null.
  - `student cannot select answer_keys even for active questions` → `data` is `[]`, after the service client inserts an active question and its key.
  - `student sees only active and flagged questions` → after inserting one question per status, only 2 rows are visible.
  - `student can insert own question_flags but not for another user_id`.
  - `admin sees questions in every status`.
- [ ] **Step 3: Run** `npm run test:integration -- rls`. Expected: FAIL (tables don't exist).
- [ ] **Step 4: Write the migration.**
  - Enable RLS on every table.
  - Policies:
    - `SELECT` for `authenticated` on documents, document_files, source_pages, source_slides, topics, slide_topics.
    - `questions`: `SELECT` where `status in ('active','flagged') or is_admin()`.
    - `question_versions`: `SELECT` when its question is selectable (`exists` subquery).
    - `question_flags`: `INSERT` with check `user_id = auth.uid()`; `SELECT` where `user_id = auth.uid() or is_admin()`.
    - `profiles`: `SELECT` own row.
  - **No** policies on answer_keys, generation_runs or anything server-only.
- [ ] **Step 5: Apply and generate types.** Run `npx supabase db reset`, then `npx supabase gen types typescript --local > src/lib/supabase/database.types.ts`.
- [ ] **Step 6: Run** `npm run test:integration -- rls`. Expected: PASS.
- [ ] **Step 7: Commit.** `feat(db): core schema with RLS isolating answer keys`

### Task 3: Supabase clients, auth, roles and seeded accounts

**Files:**
- Create: `src/lib/supabase/{browser,server,service}.ts`, `src/lib/auth.ts`, `src/proxy.ts`, `src/app/(auth)/login/page.tsx`, `scripts/seed-users.ts`
- Test: `tests/unit/auth.test.ts`, `tests/e2e/login.spec.ts`

**Interfaces:**
- Consumes: Task 2 schema, `is_admin()`.
- Produces:
  - `createBrowserSupabase(): SupabaseClient<Database>` (browser).
  - `createServerSupabase(): Promise<SupabaseClient<Database>>` (cookie-bound, user context).
  - `createServiceSupabase(): SupabaseClient<Database>` (`import "server-only"`, service role).
  - `type SessionUser = { id: string; email: string; role: 'student' | 'admin' }`
  - `getSessionUser(): Promise<SessionUser | null>`, `requireUser(): Promise<SessionUser>` (redirects to `/login`), `requireAdmin(): Promise<SessionUser>` (throws `ForbiddenError`).
  - `class ForbiddenError extends Error`. Route handlers map it to HTTP 403.
  - `npm run seed:users` creates or updates two accounts from env vars and sets the admin's role.

- [ ] **Step 1: Write failing unit tests** (`tests/unit/auth.test.ts`). Mock `getSessionUser` through an injectable loader:
  - `requireAdmin throws ForbiddenError for a student`;
  - `requireAdmin returns the user for an admin`;
  - `requireUser redirects when there is no session` (assert the `redirect` mock was called with `/login`).
- [ ] **Step 2: Run** `npm test -- auth`. Expected: FAIL.
- [ ] **Step 3: Implement the clients and `src/lib/auth.ts`.**
  - `src/proxy.ts` refreshes the Supabase session cookie on every request, following `@supabase/ssr`'s Next.js pattern. Next 16 renamed `middleware.ts` to `proxy.ts`; if the installed Next still expects `middleware.ts`, use that name.
  - It redirects unauthenticated requests to `/login`, except for `/login`, `/api/cron/*` and static assets.
- [ ] **Step 4: Build the login page.** Email + password form, large inputs, a "Sign in" button, and the error text "Email or password is incorrect" (Supabase `signInWithPassword`). There is no sign-up link; accounts are seeded.
- [ ] **Step 5: Write the seed script.** `scripts/seed-users.ts` uses the service client `auth.admin.createUser` (or updates the password if the user exists) and sets `profiles.role='admin'` for `ADMIN_EMAIL`. Generate local test credentials into `.env.local`; never print them.
- [ ] **Step 6: Write the e2e test** (`tests/e2e/login.spec.ts`): a wrong password shows the error; correct student credentials land on `/`; visiting `/bank` while logged out redirects to `/login`.
- [ ] **Step 7: Run** `npm test -- auth && npm run seed:users && npm run test:e2e -- login`. Expected: PASS.
- [ ] **Step 8: Commit.** `feat(auth): Supabase auth with student/admin roles`

### Task 4: App shell, navigation and text scale

**Files:**
- Create: `src/components/shell/{AppShell,NavTabs,TextScaleControl}.tsx`, `src/components/shell/useTextScale.ts`, `src/app/practice/page.tsx`, `src/app/results/page.tsx`
- Modify: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`
- Test: `tests/e2e/shell.spec.ts`

**Interfaces:**
- Produces:
  - `NAV_ITEMS = [{href:'/',label:'Home'},{href:'/practice',label:'Practice'},{href:'/results',label:'Results'},{href:'/materials',label:'Materials'},{href:'/bank',label:'Question Bank'}] as const`
  - `useTextScale(): { scale: 1 | 1.15 | 1.3; increase(): void; decrease(): void }`. It persists to `localStorage['sh.textScale']` and sets `--text-scale` on `<html>`.
  - CSS: `html { font-size: calc(18px * var(--text-scale, 1)); }`. Colour tokens meet AA. A `.tap` utility applies `min-height:48px; min-width:48px`.

- [ ] **Step 1: Write the failing e2e test** (`tests/e2e/shell.spec.ts`, runs in all three projects):
  - the five tab labels are visible;
  - the nav is at the bottom of the viewport on `mobile` and on the left on `desktop` (compare bounding boxes);
  - no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`);
  - every `a, button` in the nav is at least 48×48;
  - clicking A+ twice makes the html `font-size` computed value `23.4px`, and it stays the same after a reload;
  - `/practice` shows the text "Coming in the next update".
- [ ] **Step 2: Run** `npm run test:e2e -- shell`. Expected: FAIL.
- [ ] **Step 3: Implement.** AppShell wraps every authenticated page and shows the signed-in name and "Sign out". Home shows "Welcome" plus large links to Materials and Question Bank.
- [ ] **Step 4: Run** `npm run test:e2e -- shell`. Expected: PASS in desktop, tablet and mobile.
- [ ] **Step 5: Commit.** `feat(ui): accessible app shell with responsive nav and text scale`

### Task 5: AI client module

**Files:**
- Create: `src/modules/ai/{client,fake,models,pricing,errors,usage}.ts`, `supabase/migrations/20261015000200_ai_calls.sql`
- Test: `tests/unit/ai/client.test.ts`, `tests/unit/ai/pricing.test.ts`

**Interfaces:**
- Produces:
  - `type AiTask = 'extract' | 'topicMap' | 'generate' | 'verify' | 'dedup'`
  - `type Effort = 'low'|'medium'|'high'|'xhigh'|'max'`
  - `MODEL_CONFIG: Record<AiTask, { model: string; effort: Effort; maxTokens: number }>`:
    - `extract` → opus-5-5 / high / 16000
    - `topicMap` → opus-5-5 / high / 16000
    - `generate` → opus-5-5 / high / 16000
    - `verify` → opus-5-5 / high / 8000
    - `dedup` → opus-5-5 / low / 2000
  - `PRICES_PER_MTOK`:
    - `claude-opus-5-5`: input 4, output 20, cacheRead 0.20, cacheWrite 5
    - `claude-sonnet-5-5`: input 2, output 10, cacheRead 0.20, cacheWrite 2.5
    - `claude-opus-5`: input 5, output 25, cacheRead 0.50, cacheWrite 6.25
    - `claude-opus-4-8`: same as `claude-opus-5`
  - `costUsd(model: string, usage: TokenUsage): number`. An unknown model throws.
  - `type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number }`
  - `interface AiCallInput<T> { task: AiTask; promptVersion: string; system: string; content: Anthropic.Beta.BetaContentBlockParam[]; schema: z.ZodType<T>; documentId?: string }`
  - `interface AiCallResult<T> { data: T; usage: TokenUsage; costUsd: number; model: string }`
  - `interface AiClient { callStructured<T>(input: AiCallInput<T>): Promise<AiCallResult<T>> }`
  - `createAnthropicAiClient(sdk: Anthropic, log: (row: AiCallLog) => Promise<void>): AiClient`
  - `getAiClient(): AiClient` returns the fake when `AI_FAKE==='1'` (and throws in production per Global Constraints); otherwise the Anthropic client logging to `ai_calls`.
  - `class AiRefusalError`, `class AiTruncatedError`, `class AiParseError`, all extending `AiError extends Error` with `retryable: boolean` (refusal false, truncated true, parse true).
  - `createFakeAiClient(responders: Partial<Record<AiTask, (input: AiCallInput<unknown>) => unknown>>): AiClient`
  - `DEFAULT_FAKE_RESPONDERS` holds deterministic fakes that later tasks fill in, one per task.
  - Table `ai_calls(id, task, model, prompt_version, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd numeric(10,5), document_id null, created_at)`, RLS with no policies.

- [ ] **Step 1: Write failing tests.**
  - `pricing.test.ts`: `costUsd('claude-opus-5-5',{input:1_000_000,output:0,cacheRead:0,cacheWrite:0})===4`; `{input:1000,output:2000,…}` → `0.044`; an unknown model throws.
  - `client.test.ts` uses a fake `sdk.beta.messages.parse`:
    - (a) it is called with `model`, `max_tokens`, `output_config.effort` from `MODEL_CONFIG`, `betas` containing `server-side-fallback-2026-07-01`, `fallbacks: 'default'`, and the system as one text block with `cache_control: {type:'ephemeral'}`;
    - (b) `stop_reason:'refusal'` → rejects with `AiRefusalError`;
    - (c) `stop_reason:'max_tokens'` → `AiTruncatedError`;
    - (d) `parsed_output: null` → `AiParseError`;
    - (e) on success, `log` receives the row and the result's `costUsd` matches `costUsd()`.
- [ ] **Step 2: Run** `npm test -- ai`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Use `client.beta.messages.parse({... output_config:{effort, format: betaZodOutputFormat(schema)}})`, importing `betaZodOutputFormat` from `@anthropic-ai/sdk/helpers/beta/zod`.
  - Construct the SDK with `maxRetries: 4, timeout: 280_000`.
  - Map usage fields: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`.
- [ ] **Step 4: Run** `npm test -- ai`. Expected: PASS. Then apply the migration (`npx supabase db reset`) and regenerate types.
- [ ] **Step 5: Commit.** `feat(ai): structured-output Claude client with cost logging and fake`

### Task 6: Resumable job engine

**Files:**
- Create: `src/modules/jobs/{types,engine,store,registry}.ts`, `src/app/api/jobs/[id]/step/route.ts`, `src/app/api/cron/jobs/route.ts`, `src/components/jobs/{useJobRunner.ts,PipelineProgress.tsx}`, `vercel.json`, `supabase/migrations/20261015000300_jobs.sql`
- Test: `tests/unit/jobs/engine.test.ts`, `tests/integration/jobs.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` (Task 3).
- Produces:
  - `type JobKind = 'split' | 'extract' | 'topic_map' | 'generate' | 'verify'`
  - `type StepResult = { done: false; progress: Progress } | { done: true; progress: Progress; next?: { kind: JobKind; payload: Record<string, unknown> } }`
  - `type Progress = { current: number; total: number; label: string }`
  - `interface JobContext { jobId: string; documentId: string; step: number; payload: Record<string, unknown>; ai: AiClient; db: SupabaseClient<Database> }`
  - `type JobHandler = (ctx: JobContext) => Promise<StepResult>`
  - `JOB_HANDLERS: Partial<Record<JobKind, JobHandler>>` in `registry.ts`. Later tasks add one line each.
  - `interface JobStore { claim(id, lockSeconds): Promise<JobRow | null>; save(row: JobRow): Promise<void>; insert(kind, documentId, payload): Promise<string>; get(id): Promise<JobRow> }`, implemented by `SupabaseJobStore` and `MemoryJobStore`.
  - `createJob(store, kind, documentId, payload): Promise<string>`
  - `runJobStep(store, handlers, jobId, deps): Promise<JobSnapshot>`
  - `type JobSnapshot = { id; kind; status: 'pending'|'running'|'done'|'failed'; progress: Progress | null; error: string | null; nextJobId: string | null; attempts: number }`
  - Table `jobs(id, kind text, document_id, payload jsonb, step int default 0, status job_status default 'pending', progress jsonb, attempts int default 0, error text, locked_until timestamptz, next_job_id uuid, created_at, updated_at)`.
  - SQL `claim_job(p_job_id uuid, p_lock_seconds int) returns jobs`: an atomic `UPDATE … WHERE status in ('pending','running') AND (locked_until IS NULL OR locked_until < now()) RETURNING *`.
  - `POST /api/jobs/[id]/step` (admin) → `JobSnapshot`, with `export const maxDuration = 300`.
  - `GET /api/cron/jobs`: requires `Authorization: Bearer ${CRON_SECRET}`; runs steps of the oldest unfinished jobs until 240 s have elapsed.
  - `vercel.json` crons: `[{ "path": "/api/cron/jobs", "schedule": "0 3 * * *" }]`.
  - `useJobRunner(jobId: string | null): { snapshot: JobSnapshot | null; running: boolean; retry(): void }` loops POST while the job is pending or running, follows `nextJobId`, and stops on unmount.
  - `PipelineProgress` renders the stage label (`split`→"Splitting pages", `extract`→"Reading slides", `topic_map`→"Finding topics", `generate`→"Writing questions", `verify`→"Checking questions"), a progress bar, "Page 5 of 42"-style text from `progress.label`, and, when the job has failed, the error plus a large "Try again" button.

- [ ] **Step 1: Write failing unit tests** (MemoryJobStore with fake handlers):
  - `advances step and stores progress`;
  - `done with next creates the next job and links nextJobId`;
  - `handler error increments attempts, stores message, returns pending`;
  - `third consecutive error marks failed`;
  - `locked job returns snapshot without invoking handler`;
  - `done job never invokes handler`;
  - `missing handler marks failed with "No handler for <kind>"`;
  - `retry() on failed job resets attempts to 0 and status pending` (export `resetJob(store, id)`).
- [ ] **Step 2: Run** `npm test -- jobs`. Expected: FAIL.
- [ ] **Step 3: Implement the engine, stores, routes, hook and component.** The lock lasts 300 s. Release the lock (`locked_until = null`) after every step.
- [ ] **Step 4: Write the integration test** (`tests/integration/jobs.test.ts`): `claim_job is exclusive` (two concurrent `rpc('claim_job')` calls → exactly one non-null); `claim succeeds again after lock expiry` (lock 1 s, wait 1.2 s).
- [ ] **Step 5: Run** `npm test -- jobs && npm run test:integration -- jobs`. Expected: PASS.
- [ ] **Step 6: Commit.** `feat(jobs): resumable step-wise job engine with cron sweep`

### Task 7: Materials upload and PDF split

**Files:**
- Create: `src/modules/ingestion/{splitPdf,validateUpload,upload,prepareImage,handlers}.ts`, `src/app/materials/page.tsx`, `src/components/materials/UploadForm.tsx`, `supabase/migrations/20261015000400_storage.sql`, `tests/fixtures/makePdf.ts`, `tests/fixtures/sample.heic`, `tests/fixtures/sample.jpg`
- Modify: `src/modules/jobs/registry.ts` (add `split`)
- Test: `tests/unit/ingestion/splitPdf.test.ts`, `tests/unit/ingestion/validateUpload.test.ts`, `tests/integration/split.test.ts`, `tests/e2e/upload.spec.ts`

**Interfaces:**
- Consumes: `createJob`, `JOB_HANDLERS`, `requireAdmin`, `createServiceSupabase`.
- Produces:
  - `splitPdf(bytes: Uint8Array): Promise<Uint8Array[]>`, one single-page PDF per page. It throws `InvalidPdfError` for bytes that aren't a PDF.
  - `ACCEPTED_TYPES = ['application/pdf','image/jpeg','image/png'] as const`; `MAX_FILE_BYTES = 50 * 1024 * 1024`.
  - `validateUploadFiles(files: {name:string; type:string; size:number}[]): string[]` returns user-facing error messages. An empty array means the files are valid.
  - Server actions:
    - `createUpload(input: { title: string; classDate: string | null; files: {name:string;type:string;size:number}[] }): Promise<{ documentId: string; uploads: { fileIndex: number; path: string; token: string }[] }>`
    - `finalizeUpload(documentId: string): Promise<{ jobId: string }>`
  - Storage paths: `materials/{documentId}/original/{fileIndex}-{safeName}` and `materials/{documentId}/pages/{pageNo:0000}.{pdf|jpg|png}`.
  - `prepareImage(file: File): Promise<File>` (browser only):
    - HEIC/HEIF (by type or extension) → `heic2any` (dynamic import) → JPEG;
    - `createImageBitmap(file, {imageOrientation:'from-image'})`;
    - long edge ≤ 2000 px; JPEG quality 0.85;
    - non-image files are returned unchanged.
  - `split` handler: step `i` processes file `i`. Before inserting, it deletes `source_pages` where `source_file_index = i`. Page numbers continue after the pages of earlier files. When the last file is processed it sets `documents.page_count` and `status='processing'` and returns `next: {kind:'extract', payload:{}}`.
  - Private bucket `materials`, with no storage policies (service role only).

- [ ] **Step 1: Create fixtures.**
  - `makePdf({pages: number, padBytes?: number}): Promise<Uint8Array>` uses pdf-lib to draw "Fixture page N" on each page. `padBytes` adds an attachment of that many random bytes, which is how the 20 MB fixture is built.
  - `sample.jpg`: any small photo.
  - `sample.heic`: made with `sips -s format heic tests/fixtures/sample.jpg --out tests/fixtures/sample.heic`.
- [ ] **Step 2: Write failing unit tests.**
  - `splitPdf`: 3 pages → 3 outputs, each loading with `getPageCount()===1`; random bytes → `InvalidPdfError`.
  - `validateUploadFiles`:
    - `[]` → `["Choose at least one file"]`;
    - `{type:'image/gif'}` → `["sample.gif: only PDF, JPG, PNG or HEIC files can be added"]`;
    - 51 MB → `["big.pdf: file is larger than 50 MB"]`.
- [ ] **Step 3: Run** `npm test -- ingestion`. Expected: FAIL.
- [ ] **Step 4: Implement** `splitPdf`, `validateUploadFiles`, the server actions (`createSignedUploadUrl` per file; `finalizeUpload` creates the `split` job) and the `split` handler. Register `split`.
- [ ] **Step 5: Write the integration test** (`split.test.ts`): upload a 2-page fixture PDF plus `sample.jpg` as two files, then run the `split` steps with MemoryJobStore → `source_pages` rows 1–2 (`pdf_page`) and 3 (`image`); `page_count=3`; re-running step 0 leaves 3 rows.
- [ ] **Step 6: Build the UI.**
  - `/materials` lists documents (title, class date, pages, status) for everyone.
  - Admins also see "Add a handout": title, class date, a file picker (`accept=".pdf,image/*,.heic,.heif" multiple`), and per-file progress.
  - The flow is `prepareImage` → `createUpload` → `supabase.storage.from('materials').uploadToSignedUrl(path, token, file)` → `finalizeUpload` → navigate to `/materials/{documentId}`.
- [ ] **Step 7: Write the e2e test** (`upload.spec.ts`, admin, `AI_FAKE=1`):
  - uploading a 2-page PDF reaches `/materials/<id>` and shows "2 pages";
  - **(Review Focus 1)** a `makePdf({pages:2,padBytes:20_000_000})` upload succeeds;
  - `sample.heic` uploads and becomes a `.jpg` page (the page list shows type JPG);
  - a student sees no "Add a handout".
- [ ] **Step 8: Run** `npm test -- ingestion && npm run test:integration -- split && npm run test:e2e -- upload`. Expected: PASS.
- [ ] **Step 9: Commit.** `feat(ingestion): direct-to-storage upload, HEIC conversion, PDF page split`

### Task 8: Slide extraction stage and extraction eval

**Files:**
- Create: `src/modules/ai/schemas/extraction.ts`, `src/modules/ai/prompts/extractSlides.ts`, `src/modules/ingestion/{extractSlides,slideLabel}.ts`, `supabase/migrations/20261015000500_replace_page_slides.sql`, `evals/extraction/{gold.json,run.ts}`
- Modify: `src/modules/ingestion/handlers.ts` (add `extract`), `src/modules/jobs/registry.ts`, `src/modules/ai/fake.ts` (extract responder)
- Test: `tests/unit/ingestion/slideLabel.test.ts`, `tests/integration/extract.test.ts`

**Interfaces:**
- Consumes: `AiClient`, `JobHandler`, `source_pages`.
- Produces:
  - `ExtractedSlideSchema`: `{ position_on_page: number; printed_slide_no: string | null; title: string | null; verbatim_text: string; tables: { caption: string | null; rows: string[][] }[]; diagram_description: string | null; legibility: 'clear'|'partial'|'unreadable'; uncertain_terms: string[]; cropped: boolean }`
  - `ExtractionResultSchema = z.object({ slides: z.array(ExtractedSlideSchema) })`
  - `EXTRACT_SLIDES_PROMPT = { version: 'extract-slides@1', system: string }`. The system text must state:
    - one entry per slide photo, top to bottom, `position_on_page` starting at 1;
    - transcribe exactly; never correct, complete or infer;
    - keep numbers, units, symbols (≥ ≤ ↑ ↓) and drug names exactly as shown;
    - words cut off at the photo edge are written as `[cut]`;
    - uncertain words are written `[?word?]` in the text and also listed in `uncertain_terms`;
    - `printed_slide_no` is the raw printed number string or null;
    - tables go in `tables`, row by row;
    - diagrams are described factually, including arrows and relationships and every number shown;
    - legibility is `unreadable` if the main text can't be read, `partial` if some can't.
  - `extractPage(page: { kind: 'pdf_page'|'image'; storagePath: string; mime: string }, bytes: Uint8Array, ai: AiClient, documentId: string): Promise<ExtractedSlide[]>`. The content block is a `document` (base64 `application/pdf`) for a PDF page, or an `image` block otherwise, followed by the text "Extract every slide on this page."
  - SQL `replace_page_slides(p_page_id uuid, p_slides jsonb) returns int` deletes and inserts in one transaction.
  - `slideLabel(s: { printed_slide_no: string | null; page_no: number; position_on_page: number }): string`
  - `extract` handler: step `i` processes the `i`-th page by `page_no`. Progress label: `Reading page ${i+1} of ${n}`. It finishes with `next: {kind:'topic_map', payload:{}}`.
  - Fake responder: one clear slide per page, `printed_slide_no` = String(page_no), and text `Fixture slide text for page N. Metformin 500 mg.`

- [ ] **Step 1: Write the failing unit test** (`slideLabel.test.ts`, **Review Focus 2**):
  - `{printed:'42'}` → `"Slide 42"`;
  - `{printed:'39. 38'}` → `"Slide 39. 38"`;
  - `{printed:null,page:2,pos:1}` → `"Page 2, photo 1"`;
  - two unnumbered photos on page 2 → `"Page 2, photo 1"` and `"Page 2, photo 2"`, which are distinct.
- [ ] **Step 2: Write the failing integration test** (`extract.test.ts`, fake AI):
  - running all extract steps on a 2-page document → 2 `source_slides`;
  - re-running step 0 → still 2;
  - a fake that returns two unnumbered slides for one page persists both with distinct positions;
  - the first call throwing `AiTruncatedError` then succeeding gives the same row count as a clean run (**Review Focus 4**).
- [ ] **Step 3: Run** `npm test -- slideLabel && npm run test:integration -- extract`. Expected: FAIL.
- [ ] **Step 4: Implement** the schema, prompt, `extractPage`, `replace_page_slides`, `slideLabel`, the handler and the fake responder. Register `extract`.
- [ ] **Step 5: Run** the same commands. Expected: PASS.
- [ ] **Step 6: Build the extraction gold set** (`evals/extraction/gold.json`) for 15 slides of the March handout:
  - **Slides:** p2 neuropathy, p8 #31, p11 #35, p14 #41 and #42, p15 #43 and #44, p23 #59 and #60, p28 #70, p30 #73, p34 CGM metrics and #83, p38 #90 and #91.
  - **Format:** `{ page_no, position_on_page, expected_legibility, critical_tokens: string[] }`. Critical tokens are every number-with-unit, ratio and drug name on the slide.
  - **Process:** draft it by reading 200-dpi renders. The developer checks it against the PDF before use.
- [ ] **Step 7: Write the eval runner** `evals/extraction/run.ts` (`npm run eval:extraction -- <documentId>`). It runs live `extractPage` on the gold pages and writes `evals/extraction/report.md` with:
  - per-slide critical-token recall, using `containsNormalized` from Task 12, or a local copy until then;
  - legibility agreement (gold `unreadable` passes when the extraction's legibility is `!== 'clear'`).
  - **Target:** ≥ 98% recall on gold-clear slides. Estimated cost about $0.40; get approval before running (it runs in Task 17).
- [ ] **Step 8: Commit.** `feat(ingestion): vision slide extraction stage with gold-set eval`

### Task 9: Materials detail page — progress and slide review

**Files:**
- Create: `src/app/materials/[docId]/page.tsx`, `src/components/materials/SlideCard.tsx`, `src/modules/ingestion/upload.ts` additions
- Test: `tests/e2e/slides.spec.ts`

**Interfaces:**
- Consumes: `useJobRunner`, `PipelineProgress`, `slideLabel`.
- Produces:
  - Server actions:
    - `updateSlideText(slideId: string, verbatimText: string): Promise<void>` (admin; sets `admin_corrected=true`);
    - `getPageViewUrl(pageId: string): Promise<string>` (signed URL valid for 600 s; any authenticated user);
    - `getLatestJobId(documentId: string): Promise<string | null>` (most recent job not `done`; else null).
  - Page sections:
    1. the header;
    2. `PipelineProgress`, while a job is unfinished;
    3. "Coverage report" (filled in by Task 14);
    4. "Slides": cards grouped by page, each with a legibility badge (Clear = green, Partly readable = amber, Unreadable = red), the title, text, uncertain terms highlighted, and a "View photo" link; admins get an editable textarea and a "Save correction" button;
    5. a toggle "Show only slides that need checking" (`legibility !== 'clear' || uncertain_terms.length > 0`).

- [ ] **Step 1: Write the failing e2e test** (`slides.spec.ts`, `AI_FAKE=1`):
  - after uploading a 2-page fixture, the admin sees "Reading slides" and then 2 slide cards labelled "Slide 1" and "Slide 2";
  - editing slide 1's text and saving persists after a reload and shows "Corrected";
  - the student sees the text without a textarea;
  - "View photo" opens a URL that returns 200.
- [ ] **Step 2: Run** `npm run test:e2e -- slides`. Expected: FAIL.
- [ ] **Step 3: Implement.** The pipeline stops after extract with "No handler for topic_map" until Task 11. The test asserts only the slide behaviour.
- [ ] **Step 4: Run** `npm run test:e2e -- slides`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(materials): pipeline progress and slide review page`

### Task 10: Question lifecycle state machine

**Files:**
- Create: `src/modules/bank/lifecycle.ts`
- Test: `tests/unit/bank/lifecycle.test.ts`

**Interfaces:**
- Produces:
  - `type QuestionStatus = 'draft'|'needs_review'|'active'|'flagged'|'retired'`
  - `type LifecycleAction = 'verify_pass'|'verify_fail'|'mark_duplicate'|'flag'|'approve'|'edit'|'reject'|'regenerate'`
  - `type Actor = 'system' | 'student' | 'admin'`
  - `transition(from: QuestionStatus, action: LifecycleAction, actor: Actor): { to: QuestionStatus; newVersion: boolean }`
  - `class IllegalTransitionError extends Error`
  - The **complete** legal table (spec §4.2); everything else throws:

    | from | action | actor | to | newVersion |
    |---|---|---|---|---|
    | draft | verify_pass | system | active | no |
    | draft | verify_fail | system | needs_review | no |
    | draft | mark_duplicate | system | retired | no |
    | active | flag | student, admin | flagged | no |
    | active, needs_review, flagged | edit | admin | active | yes |
    | needs_review, flagged | approve | admin | active | no |
    | active, needs_review, flagged | reject | admin | retired | no |
    | active, needs_review, flagged | regenerate | admin | draft | yes |

- [ ] **Step 1: Write the failing tests.** Use `it.each` over every table row. Illegal cases include: `student approve` → throws; `retired edit` → throws; `flagged flag` → throws; `draft approve` → throws.
- [ ] **Step 2: Run** `npm test -- lifecycle`. Expected: FAIL.
- [ ] **Step 3: Implement** `transition` as a lookup table.
- [ ] **Step 4: Run** `npm test -- lifecycle`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(bank): question lifecycle state machine`

### Task 11: Topic map stage

**Files:**
- Create: `src/modules/ai/schemas/topicMap.ts`, `src/modules/ai/prompts/topicMap.ts`, `src/modules/generation/{topicMap,handlers}.ts`
- Modify: `src/modules/jobs/registry.ts`, `src/modules/ai/fake.ts`
- Test: `tests/unit/generation/topicMap.test.ts`, `tests/integration/topicMap.test.ts`

**Interfaces:**
- Consumes: `source_slides`, `topics`, `slide_topics`, `slideLabel`.
- Produces:
  - `TopicMapSchema`: `{ topics: { name: string; slide_ids: string[] }[]; unassigned: { slide_id: string; reason: string }[] }`
  - `TOPIC_MAP_PROMPT = { version: 'topic-map@1', system }`. The rules:
    - 8–25 topics per handout;
    - reuse an existing topic name **verbatim** when the content fits it;
    - a slide may belong to at most 2 topics;
    - topic names are short clinical headings (e.g. "Insulin therapy – pumps & closed loop");
    - unreadable slides go to `unassigned`.
  - `buildTopicMap(slides: { id; label; title; text: string /* first 300 chars */; legibility }[], existingTopicNames: string[], ai: AiClient, documentId: string): Promise<TopicMap>`
  - `reconcileTopicMap(map: TopicMap, allSlideIds: string[], readableSlideIds: string[]): { topics: {name:string; slideIds:string[]}[]; unassigned: {slideId:string; reason:string}[]; droppedIds: string[] }`:
    - unknown ids are dropped and reported;
    - a readable slide that is in no topic and not listed as unassigned is added to unassigned with reason `"not assigned by model"`;
    - slides beyond 2 topics keep their first 2;
    - topics left empty are removed.
  - `topic_map` handler (single step):
    - upserts topics by `lower(name)`;
    - replaces `slide_topics` for this document's slides;
    - inserts a `generation_runs` row;
    - returns `next: {kind:'generate', payload:{runId}}`.
  - Fake responder: all readable slides go into one topic, "Fixture topic".

- [ ] **Step 1: Write failing unit tests** for `reconcileTopicMap`: unknown id dropped; a missing readable slide is unassigned with reason "not assigned by model"; a 3-topic slide keeps 2; an empty topic is removed.
- [ ] **Step 2: Write the failing integration test**:
  - running the handler twice yields the same topic and slide_topics counts;
  - **(Review Focus 3)** a second document whose fake returns the existing name `"fixture topic"` (different case) links to the same topic id.
- [ ] **Step 3: Run** `npm test -- topicMap && npm run test:integration -- topicMap`. Expected: FAIL.
- [ ] **Step 4: Implement and register `topic_map`.**
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit.** `feat(generation): topic map stage with cross-document topic reuse`

### Task 12: Question generation stage with deterministic pre-checks

**Files:**
- Create: `src/lib/text.ts`, `src/modules/ai/schemas/generation.ts`, `src/modules/ai/prompts/generateQuestions.ts`, `src/modules/generation/{generate,validate}.ts`, `supabase/migrations/20261015000600_save_generated.sql`
- Modify: `src/modules/generation/handlers.ts`, `src/modules/jobs/registry.ts`, `src/modules/ai/fake.ts`
- Test: `tests/unit/text.test.ts`, `tests/unit/generation/validate.test.ts`, `tests/unit/generation/generate.test.ts`, `tests/integration/generate.test.ts`

**Interfaces:**
- Consumes: topics and slide_topics (Task 11), `AiClient`.
- Produces:
  - `normalizeForMatch(s: string): string`: NFKC, lowercase, curly quotes → straight, en/em dashes → `-`, leading bullets `•▪*-` removed, whitespace collapsed, trimmed.
  - `containsNormalized(haystack: string, needle: string): boolean`
  - `type SlideForGeneration = { id: string; label: string; pageId: string; title: string | null; verbatim_text: string; tables: unknown[]; diagram_description: string | null }`
  - Schemas:
    - `RubricSchema`: `{ criteria: { id: string; statement: string; weight: number; equivalents: string[]; partial_credit_examples: string[] }[]; critical_errors: { id: string; statement: string }[] }`
    - `GeneratedMcqSchema`: `{ stem; options: {id:'a'|'b'|'c'|'d'; text}[]; correct_option_id: 'a'|'b'|'c'|'d'; explanation; difficulty; source_slide_ids: string[]; basis_quote; conflict_note: string|null }`
    - `GeneratedSaqSchema`: `{ stem; model_answer; key_concepts: {concept; equivalents: string[]}[]; rubric: Rubric; difficulty; source_slide_ids; basis_quote; conflict_note }`
    - `GenerationResultSchema`: `{ mcqs: GeneratedMcq[]; saqs: GeneratedSaq[]; skipped_slides: {slide_id; reason}[] }`
  - `GENERATE_QUESTIONS_PROMPT = { version: 'generate-questions@1', system }`. The rules:
    - only facts stated in the given slides;
    - `basis_quote` is copied verbatim from the cited slide's text (≤ 300 chars);
    - difficulty: easy = recall, medium = application, hard = clinical reasoning;
    - MCQ: single best answer, options a–d, plausible distractors that the slides make clearly wrong, no "all/none of the above", explanation ≤ 60 words;
    - SAQ: answerable in 5–8 lines, 3–6 atomic rubric criteria whose weights sum to 5.0, synonyms listed in `equivalents`, at least one `critical_error` whenever a dangerous misconception exists;
    - conflicting slides: write a `conflict_note` naming both slides, or skip;
    - never exceed the maximums (fewer is fine); never restate any stem in `avoid_stems`; list slides with nothing testable in `skipped_slides`.
  - `targetsFor(slideCount: number): { maxMcq: number; maxSaq: number }` = `{ ceil(n*0.9), ceil(n*0.4) }`.
  - `planTopicBatches(slides: SlideForGeneration[]): SlideForGeneration[][]`: chunks of ≤ 6, original order kept.
  - `generateForTopic(input: { topicName: string; slides: SlideForGeneration[]; pageDocs: Map<string, Uint8Array>; avoidStems: string[]; maxMcq: number; maxSaq: number }, ai: AiClient, documentId: string): Promise<GenerationResult>`. It attaches the page PDF or image (one per page) for any slide with tables or a `diagram_description` longer than 200 chars.
  - `validateStructure(q: GeneratedMcq | GeneratedSaq): string[]`. Issue strings, exactly:
    - `"MCQ must have options a, b, c, d exactly once"`
    - `"Correct option is not one of the options"`
    - `"Two options have the same text"`
    - `"Options must not use 'all/none of the above'"`
    - `"Rubric needs 3–6 criteria"`
    - `"Rubric weights must add up to 5.0"` (tolerance 0.01)
    - `"Rubric weights must be positive"`
    - `"Model answer is empty"`
  - `validateGenerated(q, slidesInBatch: Map<string, SlideForGeneration>): string[]` = `validateStructure` plus:
    - `"Cites a slide outside this topic"`;
    - `"Basis quote not found in cited slide"` (`containsNormalized` against each cited slide's text, tables flattened, and diagram description).
  - SQL `save_generated_questions(p_run_id uuid, p_topic_id uuid, p_batch_key text, p_items jsonb) returns int`, in one transaction:
    - deletes questions where `generation_run_id = p_run_id and batch_key = p_batch_key and status = 'draft'`, with their versions and keys;
    - inserts each item as question (draft) + version 1 (with `review_notes` = pre-check issues prefixed `"Auto-check: "`) + answer key;
    - `source_refs` = `[{documentId, pageNo, slideId, label}]`.
  - `generate` handler:
    - steps enumerate `(topic ordered by name, batch index)` pairs for this document's topics, recomputed deterministically each step;
    - `batch_key = "${topicId}:${batchIndex}"`;
    - `avoidStems` = current stems of non-retired questions in that topic;
    - progress label `Writing questions: ${topicName} (${k} of ${total})`;
    - finishes with `next: {kind:'verify', payload:{runId}}`.
  - Fake responder: per batch, 1 MCQ + 1 SAQ that pass `validateGenerated`, with stems containing the topic name and batch index.

- [ ] **Step 1: Write failing unit tests.**
  - `text.test.ts`: `normalizeForMatch('• HbA1c  ≥ 6.5%')==='hba1c ≥ 6.5%'`; curly and straight quotes are equal; `containsNormalized` with an em dash in the haystack.
  - `validate.test.ts`: one test per issue string above, plus a valid MCQ and a valid SAQ → `[]`.
  - `generate.test.ts`: `targetsFor(1)` → `{1,1}`; `targetsFor(7)` → `{7,3}`; `planTopicBatches` of 13 slides → sizes `[6,6,1]`.
- [ ] **Step 2: Write the failing integration test**:
  - running all generate steps on the fixture document → 2 draft questions per batch, each with version 1 and a key;
  - re-running step 0 keeps the same count;
  - a fake MCQ whose basis quote isn't in the slide is saved as draft with `review_notes` containing `"Auto-check: Basis quote not found in cited slide"`.
- [ ] **Step 3: Run** `npm test -- text validate generate && npm run test:integration -- generate`. Expected: FAIL.
- [ ] **Step 4: Implement and register `generate`.**
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit.** `feat(generation): source-grounded question generation with pre-checks`

### Task 13: Duplicate detection and independent verification

**Files:**
- Create: `src/modules/ai/schemas/verification.ts`, `src/modules/ai/prompts/{dedup,verifyQuestion}.ts`, `src/modules/generation/verify.ts`, `supabase/migrations/20261015000700_dedup.sql`, `evals/dedup/{pairs.json,run.ts}`
- Modify: `src/modules/generation/handlers.ts`, `src/modules/jobs/registry.ts`, `src/modules/ai/fake.ts`
- Test: `tests/unit/generation/verify.test.ts`, `tests/integration/verify.test.ts`

**Interfaces:**
- Consumes: `transition` (Task 10), `validateGenerated` results stored as review notes (Task 12), `AiClient`.
- Produces:
  - Migration:
    - `create extension if not exists pg_trgm`;
    - GIN trigram index on `question_versions.stem`;
    - `find_similar_stems(p_stem text, p_exclude_question uuid, p_threshold real default 0.45) returns table(question_id uuid, stem text, sim real)` over **current** versions of questions with status in `('active','needs_review','flagged')`, ordered by sim descending, limit 5.
  - `DedupSchema`: `{ duplicate_of_question_id: string | null; reason: string }`
  - `VerificationSchema`: `{ answer_supported_by_slide: boolean; single_best_answer_ok: boolean | null; rubric_consistent: boolean | null; ambiguous: boolean; stem_gives_away_answer: boolean; guideline_conflict: string | null; issues: string[]; pass: boolean }`
  - Prompts:
    - `DEDUP_PROMPT` (`dedup@1`): "Same tested fact?" Rephrasings of the same fact count as duplicates; the same topic with a different fact does not.
    - `VERIFY_QUESTION_PROMPT` (`verify-question@1`): an independent reviewer who sees only the question, the key and the cited slides (plus page images where Task 12 attached them), and checks every field of `VerificationSchema`.
    - A disagreement with current guidelines is *not* a failure by itself; it is described in `guideline_conflict`.
    - It is a failure when a contradiction between slides makes the answer unclear.
  - `DUPLICATE_AUTO_THRESHOLD = 0.9`
  - `checkDuplicate(q: { id: string; stem: string }, candidates: { question_id: string; stem: string; sim: number }[], ai: AiClient, documentId: string): Promise<{ duplicateOf: string | null; reason: string }>`:
    - no candidates → no AI call;
    - top `sim ≥ 0.9` → duplicate without an AI call;
    - otherwise one AI call.
  - `type QuestionWithKey = { id: string; type: 'mcq'|'saq'; stem: string; options: {id:string; text:string}[] | null; difficulty: 'easy'|'medium'|'hard'; basisQuote: string; sourceSlideIds: string[]; correctOptionId: string | null; explanation: string | null; modelAnswer: string | null; rubric: Rubric | null }`, loaded from the current version plus its answer key with the service client.
  - `verifyQuestion(q: QuestionWithKey, slides: SlideForGeneration[], ai: AiClient, documentId: string): Promise<{ pass: boolean; notes: string[]; conflictNote: string | null }>`. The pass is computed **in code**: `model.pass && answer_supported_by_slide && !ambiguous && !stem_gives_away_answer && (type==='mcq' ? single_best_answer_ok === true : rubric_consistent === true)`.
  - `processDraftQuestion(questionId: string, deps: { db; ai; documentId }): Promise<QuestionStatus>`:
    1. an existing `Auto-check:` note → `verify_fail`;
    2. otherwise `checkDuplicate` → `mark_duplicate` with the note `Duplicate of <questionId>: <reason>`;
    3. otherwise `verifyQuestion` → `verify_pass` or `verify_fail`, appending notes, with `conflictNote` written to the version's `conflict_note` (appended to any existing note).

    The status is changed through `transition(…, 'system')`.
  - `verify` handler: each step processes up to 5 draft questions of the run (oldest first). Progress label: `Checking questions (${done} of ${total})`. When none remain it sets `generation_runs.completed_at`, sets `documents.status='ready'`, and returns `done`.
  - Fake responder: verify passes unless the stem contains `"FAIL"`; dedup is never a duplicate unless the stem contains `"DUP"`.

- [ ] **Step 1: Write failing unit tests** (`verify.test.ts`):
  - model `pass:true` with `ambiguous:true` → `pass:false`;
  - MCQ with `single_best_answer_ok:null` → `pass:false`;
  - `checkDuplicate` with `[]` → AI not called;
  - top sim 0.95 → duplicate, AI not called;
  - top sim 0.6 → AI called once.
- [ ] **Step 2: Write the failing integration tests** (`verify.test.ts`):
  - `find_similar_stems` returns an identical stem with sim 1 and excludes retired and draft questions;
  - 7 drafts → two steps (5 + 2) → done;
  - statuses follow the fake (one `FAIL` stem → `needs_review` with notes);
  - a draft with an Auto-check note → `needs_review` and the verifier fake is never called;
  - **(Review Focus 3)** run the full fake pipeline on document A, then on document B whose fake generator repeats A's stems → B's repeats end `retired` with a "Duplicate of" note, and the active count equals A's;
  - **(Review Focus 4)** a verifier fake that throws `AiTruncatedError` once → the job retries and the final statuses match a clean run.
- [ ] **Step 3: Run** `npm test -- verify && npm run test:integration -- verify`. Expected: FAIL.
- [ ] **Step 4: Implement and register `verify`.**
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Build the dedup eval.**
  - `evals/dedup/pairs.json`: 10 duplicate paraphrase pairs and 10 same-topic non-duplicate pairs, written from March handout facts (e.g. "C:I ratio = 500/TDD" phrased two ways; "C:I ratio" vs "correction factor" as non-duplicates).
  - `evals/dedup/run.ts`: inserts the first of each pair as active, then runs `find_similar_stems` + `checkDuplicate` live on the second and writes `evals/dedup/report.md`.
  - **Targets:** ≥ 9/10 duplicates caught, 0/10 false merges. Estimated cost < $0.10; run with approval in Task 17.
- [ ] **Step 7: Commit.** `feat(generation): trigram+LLM dedup and independent verification gate`

### Task 14: Coverage report

**Files:**
- Create: `src/modules/generation/coverage.ts`, `src/components/materials/CoverageReportView.tsx`
- Modify: `src/app/materials/[docId]/page.tsx`
- Test: `tests/unit/generation/coverage.test.ts`, `tests/e2e/pipeline.spec.ts`

**Interfaces:**
- Consumes: questions, topics, slides.
- Produces:
  - `type CoverageInput = { target: number; topics: {id:string; name:string}[]; slides: {id:string; label:string; legibility: 'clear'|'partial'|'unreadable'; topicIds:string[]}[]; questions: {id:string; type:'mcq'|'saq'; difficulty:'easy'|'medium'|'hard'; status: QuestionStatus; topicId:string; sourceSlideIds:string[]}[] }`
  - `type CoverageReport = { perTopic: {topicId:string; name:string; slideCount:number; mcq: Record<'easy'|'medium'|'hard', number>; saq: Record<'easy'|'medium'|'hard', number>}[]; totals: {activeMcq:number; activeSaq:number; needsReview:number; retired:number}; slidesWithoutQuestions: {slideId:string; label:string; reason:'unreadable'|'not in any topic'|'no question generated'}[]; targetMet: boolean; shortfallNote: string | null }`
  - `buildCoverageReport(input: CoverageInput): CoverageReport`:
    - per-topic counts include only `active` questions;
    - `targetMet = activeMcq + activeSaq >= target`;
    - shortfall copy (exact): `` `Only ${n} questions could be written from this material without repeating or going beyond the slides (target ${target}). Adding more handouts will increase coverage.` ``
  - `DEFAULT_TARGET = 100`
  - `getCoverageReport(documentId: string): Promise<CoverageReport>` (server). The materials page shows it once the document status is `ready`.

- [ ] **Step 1: Write failing unit tests**: an input with one unreadable slide, one unassigned slide, and one topic slide with no questions → three `slidesWithoutQuestions` entries with the right reasons; 7 active + 2 needs_review + 1 retired → totals correct; target 100 → `targetMet:false` and the exact shortfall copy; target 5 → `shortfallNote:null`.
- [ ] **Step 2: Run** `npm test -- coverage`. Expected: FAIL.
- [ ] **Step 3: Implement** the function and the view: a table of topic by MCQ/SAQ counts per difficulty, totals, a "Slides without questions" list with reasons, and the shortfall note in an amber callout.
- [ ] **Step 4: Write the e2e test** (`pipeline.spec.ts`, `AI_FAKE=1`): uploading a 2-page fixture, the page runs through every stage to "Coverage report" and shows 2 active questions (one topic, one batch: 1 MCQ + 1 SAQ) and the shortfall note.
- [ ] **Step 5: Run** `npm test -- coverage && npm run test:e2e -- pipeline`. Expected: PASS.
- [ ] **Step 6: Commit.** `feat(generation): coverage report that states shortfalls instead of padding`

### Task 15: Question Bank server actions

**Files:**
- Create: `src/modules/bank/{repository,actions}.ts`, `supabase/migrations/20261015000800_question_versions_rpc.sql`
- Test: `tests/integration/bank.test.ts`

**Interfaces:**
- Consumes: `transition`, `validateStructure`, `generateForTopic`, `processDraftQuestion`, `requireUser` and `requireAdmin`.
- Produces:
  - `type BankFilter = { status?: QuestionStatus; type?: 'mcq'|'saq'; topicId?: string; difficulty?: 'easy'|'medium'|'hard'; documentId?: string }`
  - `type BankListItem = { id; type; status; difficulty; topicName; stem; sourceLabel; hasConflictNote: boolean }`
  - `listQuestions(filter: BankFilter): Promise<BankListItem[]>` runs under the user's RLS client, so students only ever see active and flagged questions.
  - `type QuestionDetail = { id; type; status; version: number; versionCount: number; difficulty; topicName; stem; options: {id;text}[] | null; sourceRefs: {documentId; pageNo; slideId; label}[]; conflictNote: string|null; reviewNotes: string[]; flags: {comment:string|null; createdAt:string}[]; key: AnswerKeyView | null }`. `key` is set only for admins and is read with the service client after `requireAdmin`.
  - `type AnswerKeyView = { correctOptionId: string|null; explanation: string|null; modelAnswer: string|null; keyConcepts: {concept:string; equivalents:string[]}[] | null; rubric: Rubric | null }`
  - `getQuestionDetail(id: string): Promise<QuestionDetail>`
  - `type QuestionEdit = { stem: string; difficulty: 'easy'|'medium'|'hard'; options?: {id;text}[]; correctOptionId?: string; explanation?: string; modelAnswer?: string; keyConcepts?: {concept;equivalents}[]; rubric?: Rubric }`
  - Admin actions:
    - `approveQuestion(id): Promise<void>`
    - `rejectQuestion(id, reason: string): Promise<void>`, which appends the review note `Rejected: <reason>`
    - `editQuestion(id, edit: QuestionEdit): Promise<{ version: number }>`, which rejects with the `validateStructure` messages
    - `regenerateQuestion(id): Promise<{ status: QuestionStatus }>`, which uses the cited slides, `max` 1 of the same type, and the current stem in `avoidStems`; creates the next version as draft; then calls `processDraftQuestion`
  - User action: `flagQuestion(id, comment: string | null): Promise<void>` (student or admin).
  - SQL `create_question_version(p_question_id uuid, p_version jsonb, p_key jsonb, p_status question_status) returns int`: inserts version n+1 with its key and updates `current_version` and `status` atomically.

- [ ] **Step 1: Write failing integration tests** (`bank.test.ts`):
  - `approveQuestion` on needs_review → active;
  - a student calling `approveQuestion` → `ForbiddenError`;
  - `rejectQuestion` → retired with the review note;
  - **(Review Focus, versioning)** `editQuestion` on an active MCQ that changes the correct option → `version 2`; version 1 and its key are still readable through the service client with the original correct option;
  - `editQuestion` with weights summing to 4.0 → rejects with "Rubric weights must add up to 5.0";
  - a student's `flagQuestion` → status flagged and a flag row exists;
  - after that, `listQuestions({status:'active'})` as the student excludes it;
  - `getQuestionDetail` as a student → `key === null`, and a raw `from('answer_keys').select()` with the student client → `[]`;
  - `regenerateQuestion` (fake) → version 2, status active.
- [ ] **Step 2: Run** `npm run test:integration -- bank`. Expected: FAIL.
- [ ] **Step 3: Implement** the repository, the actions (Next server actions, `'use server'`) and the RPC. Put `export const maxDuration = 300` in `src/app/bank/[questionId]/page.tsx` (Task 16), the route segment that calls `regenerateQuestion`.
- [ ] **Step 4: Run** `npm run test:integration -- bank`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(bank): review, edit, regenerate and flag actions with versioning`

### Task 16: Question Bank UI

**Files:**
- Create: `src/app/bank/page.tsx`, `src/app/bank/[questionId]/page.tsx`, `src/components/bank/{BankFilters,QuestionCard,QuestionDetailView,EditQuestionForm,FlagDialog}.tsx`
- Test: `tests/e2e/bank.spec.ts`

**Interfaces:**
- Consumes: the Task 15 actions and types.
- Produces:
  - **`/bank` list:**
    - filter chips for Status (Active, Flagged; admins also get Needs review and Retired), Type (MCQ, Short answer), Difficulty, and a Topic select;
    - a count line, e.g. "42 questions";
    - the admin's default filter is "Needs review" when that queue isn't empty, otherwise "Active";
    - cards show type, difficulty, status badge, topic, a 2-line stem, the source label, and a "Course vs guideline note" badge when `hasConflictNote`.
  - **`/bank/[id]` detail:**
    - Everyone sees the stem, options (with no correct mark), the source label with a "View slide" link (`getPageViewUrl`), any conflict note in an amber callout, and a "Flag a problem" button that opens `FlagDialog` with an optional comment and a "Send flag" button.
    - Admins also see the answer key (correct option highlighted, explanation; or the model answer plus key concepts plus a rubric table of criterion and weight, and the critical errors), review notes, flags, version count, and the buttons **Approve**, **Edit**, **Write a new version** (regenerate) and **Reject** (reason required).
  - `EditQuestionForm` shows the `validateStructure` errors inline.

- [ ] **Step 1: Write the failing e2e test** (`bank.spec.ts`, `AI_FAKE=1`). Seed with `tests/e2e/helpers.ts → seedQuestions({ active: 3, needsReview: 1 })`, which inserts questions, versions and keys through the service client. The needs-review one carries the review note `"Verifier: Answer not supported by cited slide"`.
  - the admin lands on "Needs review" with 1 question, opens it, sees the "Verifier:" note, clicks Approve, and it appears under Active (4 active);
  - the student opens an MCQ detail page and the correct-answer text and the word "Explanation" are **absent** from the DOM; flagging it shows "Thanks — this question is now out of practice tests until it's checked."
  - the admin then sees it under Flagged with the comment;
  - in the mobile project, the filter chips wrap and the page has no horizontal scroll.
- [ ] **Step 2: Run** `npm run test:e2e -- bank`. Expected: FAIL.
- [ ] **Step 3: Implement.** The admin detail page renders the key on the server; it never comes from a client fetch.
- [ ] **Step 4: Run** `npm run test:e2e -- bank`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(bank): question bank browse, review and flag UI`

### Task 17: Real-handout run, evals, audit and preview deploy

**Files:**
- Create: `evals/generation/auditSample.ts`, `docs/phase2-results.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `npm run eval:audit-sample -- <documentId>` writes `evals/generation/audit-<date>.md`. It contains a random 20% of active questions (seeded) with the checklist columns: Supported by slide · Single best answer / rubric sound · Unambiguous · Difficulty right · Source correct · Notes.
  - `docs/phase2-results.md` records the coverage numbers, eval results, total AI cost (`select sum(cost_usd) from ai_calls`) and known limitations.

- [ ] **Step 1: Run the full suites.** Run `npm test && npm run test:integration && npm run test:e2e && npm run typecheck && npm run lint`. Expected: all green.
- [ ] **Step 2: Get approval for live AI spend.** Ask the user to approve about $12 total: ingestion, generation and verification of the 42-page handout (≈ $8–10), the extraction eval (≈ $0.40) and the dedup eval (< $0.10).
- [ ] **Step 3: Ingest the real handout locally.** Upload `IMA CGP FCD Class 1213March2026.pdf` locally with `AI_FAKE` unset, and wait until the status is `ready`.
- [ ] **Step 4: Run the extraction and dedup evals.** Run `npm run eval:extraction -- <docId> && npm run eval:dedup`. Targets: ≥ 98% critical-token recall on clear slides, slide 73 not marked clear, ≥ 9/10 duplicates caught, 0 false merges. If extraction misses, bump `extract-slides@2` with prompt fixes and re-run (ask before additional spend).
- [ ] **Step 5: Run the generation audit.** Run `npm run eval:audit-sample -- <docId>`. The developer (and ideally their mother) fill in the checklist. Target: ≥ 90% of audited questions pass every column, with zero unsupported facts. Failed questions are fixed or rejected in the Question Bank.
- [ ] **Step 6: Check the source-conflict handling.** Confirm that every generated question citing slides #41/#86 (C:I ratio), #42/#86 (correction factor), #28 (activity minutes) or #90 (hypoglycaemia thresholds) carries a conflict note or was excluded. The spec §1.3 table lists these conflicts.
- [ ] **Step 7: Deploy a preview** (the developer does the account steps):
  - create a Supabase cloud project, then run `npx supabase link --project-ref <ref>` and `npx supabase db push`;
  - create a Vercel project linked to the repo and set every `.env.example` variable except `AI_FAKE`;
  - set `CRON_SECRET`;
  - deploy a preview;
  - run `npm run seed:users` against cloud env vars.

  Smoke test on a phone: log in as the student, browse the bank, flag one question, sign out.
- [ ] **Step 8: Write up results and setup.** Write `docs/phase2-results.md`. Complete `README.md` with local setup, how to add a new handout, the cost table, and the deploy steps.
- [ ] **Step 9: Check Phase 2 acceptance (spec §12).**
  - the March handout ingests end to end;
  - every question has a source citation;
  - answer keys can't be read from the browser (Task 2 and Task 15 tests);
  - the extraction and generation eval targets are met;
  - the coverage report states the real count.
- [ ] **Step 10: Commit and hand off.** Commit with `docs: Phase 2 results, README and audit`. Ask the user whether to merge `phase-2-foundation` into `main`.
