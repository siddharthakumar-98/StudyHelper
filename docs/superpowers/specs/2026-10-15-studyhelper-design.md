# StudyHelper — Design, Architecture & Roadmap

**Status:** Draft for approval · **Date:** 2026-10-15 · **Scope:** v1 = MCQ + short-answer (SAQ) only. Long essay is future scope.

StudyHelper turns IMA diabetology lecture material into a question bank and randomised practice tests. It accepts typed or handwritten answers and grades them with AI-assisted, rubric-based marking. **AI scores are practice estimates, not official exam grades.**

---

## 0. Agreed understanding

| | |
|---|---|
| **User** | The developer's mother, a doctor preparing for the *IMA College of General Practitioners – Fellowship Certification in Diabetology (FCD) 2026*. Not technical. Uses a phone, a tablet and a laptop. |
| **Goal** | Practise effectively, find weak topics and improve exam readiness. |
| **Real exam** (per user; not published online, so not independently verified) | 50 MCQ + 5 SAQ + 1 long essay. v1 supports the first two. |
| **Success** | She can open the site on her phone, start a test in two taps, answer by tapping, typing or photographing her handwriting, and get understandable marks and feedback she trusts enough to guide her revision. |

**Decisions made (2026-10-15)**

1. **Hosting:** a private website with login, usable from any device, with camera capture anywhere.
2. **Grading model:** the code supports any model per task. Phase 4 runs a measured comparison (Opus 5.5 vs Sonnet 5.5) on the grading evaluation set, and the user chooses on accuracy and cost.
3. **Question approval:** questions are auto-approved **if they pass an independent AI verification step**. Failures go to a *Needs review* queue. She can flag any question while practising, and flagged questions leave the exam pool until resolved. Edit, approve, reject and regenerate remain available in the Question Bank.
4. **Materials:** more class handouts are coming. Ingestion is built for many documents over time, and the bank grows with each upload.

**Defaults assumed (say if wrong)**
- English only.
- Glucose in mg/dL, as used on the slides.
- One student account (her) plus one admin account (the developer).
- The developer's Anthropic account pays for API usage.

---

## 1. Source material analysis (Phase 1 findings)

**File:** `IMA CGP FCD Class 1213March2026.pdf`, 42 pages, 15.2 MB, made in Microsoft Word.

### 1.1 Format: images only
- Each page holds a printed header plus **two phone photographs of projected slides**, about 82 slides in all.
- The PDF has almost no text layer (about 65 characters per page, which is just the header).
- **Implication:** ingestion must use a **vision model**. Text extraction finds nothing.
- Photo quality varies: tilt, glare, blur, and edges cropped off.

### 1.2 Coverage and gaps
- **Slides present:** printed numbers 21–100, plus two unnumbered slides (SDOH/adherence, neuropathy) on page 2.
- **Missing:** slides 1–20, 77, 79 and 99.
- **Unreadable:** slide 73 ("…elements of DM in exercise") is too blurred and angled.
- **Partially cropped:** p2 neuropathy, p30 #73, p26 #65, and the left edge of several others.

**Topics covered**, grouped:

| Group | Slides | Content |
|---|---|---|
| Complications & comorbidities | 21–25, 92, 100 | macrovascular, ASCVD risk, HT management, statin intensity, NAFLD, obesity, acute/chronic complication list, neuropathy treatment ladder |
| Lifestyle | 26–30, 71–75 | diet & calorie distribution, plate method, physical activity, barriers, exercise types, exercise hypoglycaemia, CGM/pump in exercise |
| Insulin | 31–34, 40–42, 47, 52, 57–58, 83–89 | basal/bolus, T1D vs T2D approach, adverse effects, hypersensitivity types, hypokalaemia, selection factors, C:I ratio, correction factor, early insulinisation, pumps, hybrid closed loop, DIY APS |
| Non-insulin agents | 35–39, 45–46, 48–51, 93 | options list, metformin side effects, SGLT2i/GLP-1RA in ASCVD, CKD and HF, TZD/saxagliptin in HF, intensification, GLP-1RA + DPP-4i, weight effects |
| Targets | 43–44, 66, 76, 78 | A1c targets by society, individualised goals, older adults, ICU/inpatient targets, IV insulin protocol |
| Prediabetes | 53–55 | risk factors, lifestyle (≥7% weight loss, ≥150 min/wk), metformin criteria |
| Pregnancy | 56–61 | preconception A1c, insulin needs by trimester, postpartum drop, euglycaemic DKA, OAD placental transfer (molecular weights), GDM → T2D screening |
| Special situations | 62–65, 67–70 | cancer, cancer-therapy-induced DM, CIADM, ageing, deprescribing, BP and statin/aspirin in older adults |
| Technology | 80–83 | professional vs personal CGM, AGP, GMI, standardised CGM metrics (TIR/TAR/TBR) |
| Hypoglycaemia | 90–91 | levels 1–3, rule of 15, IV dextrose, glucagon |
| Obesity | 92–95 | diabesity, anti-obesity drugs, bariatric surgery |
| Systems | 96–98, p2 | clinical inertia, shared decision making, SDOH |

**Capacity estimate:** about 60–70 well-supported MCQs and 25–35 SAQs, so a bank of about 100 is achievable but close to the ceiling. The pipeline will report shortfalls rather than pad. More handouts are the real fix.

### 1.3 Inconsistencies found in the source (handling is defined in §4.4)

| Where | Slide says | Conflict |
|---|---|---|
| #41 vs #86 | C:I ratio = **500**/TDD (#41) | **450**/TDD (#86) |
| #42 vs #86 | Correction factor = **1650**/TDD (#42) | **2000**/TDD (#86) |
| #28 | "150 prev now 300 mts/wk" | ADA Standards still say ≥150 min/week moderate-to-vigorous. Lecture shorthand is ambiguous. |
| #90 | Text: L1 <70 and ≥54, L2 <54 | Embedded graphic: "moderate below 55", "severe below 40" |
| #43 | ADA A1c goal <7%, AACE ≤6.5% | Consistent with sources; noted as society-specific |

These show why the generator must cite sources and flag conflicts, never silently "fix" them.

---

## 2. Technology stack (recommended)

| Layer | Choice | Why | Alternatives rejected |
|---|---|---|---|
| App framework | **Next.js (App Router) + TypeScript** | One deployable for UI and server code. API keys and answer keys stay server-side. Strong mobile/PWA support. | Separate FastAPI service: a second deploy with no benefit, since everything AI-related is an HTTP call. |
| UI | **Tailwind CSS + Radix UI primitives** (shadcn/ui pattern) | Accessible components (radio groups, dialogs, focus handling) without hand-rolling ARIA | MUI: heavier, harder to make large and simple |
| Database / Auth / Files | **Supabase** (Postgres + Auth + private Storage + Row-Level Security) | Relational data fits exams. RLS enforces "answer keys never reach the browser". Free tier is enough for one user. | Firebase: NoSQL is awkward for exam/attempt/grade relations. SQLite: no multi-device access. |
| Hosting | **Vercel** (Hobby, personal non-commercial) | Zero-ops deploys, HTTPS, preview URLs | Self-hosted VPS: more maintenance |
| LLM | **Anthropic Claude API** via `@anthropic-ai/sdk`: vision, structured JSON outputs, prompt caching, Batches API | One vendor for slide reading, generation, verification, grading and handwriting. Strong vision. Structured outputs make results machine-checkable. | Mixing Google Vision/Azure OCR plus a separate LLM: classic OCR is worse on handwriting and can't link answers to question numbers |
| Models | Configured **per task** in one file (`ai/models.ts`). Default: `claude-opus-5-5` for extraction, generation and verification. Grading: Opus 5.5 vs `claude-sonnet-5-5`, decided in Phase 4. | Medical accuracy matters most at generation time. Grading cost recurs, so it is measured before choosing. | — |
| Duplicate detection | **Postgres `pg_trgm`** similarity + LLM confirmation within the same topic | At hundreds of questions this is enough. No extra embedding vendor. | Vector embeddings: an extra vendor and key for little gain at this scale. Revisit beyond about 2,000 questions. |
| HEIC | **`heic2any`** in the browser → JPEG | Only Safari renders HEIC natively | Server-side conversion: native dependencies on Vercel |
| PDF handling | **`pdf-lib`** (pure JS) splits PDFs into small page ranges sent to Claude as `document` blocks | No native binaries. Claude reads each page as an image. | Server-side rasterising with poppler/mupdf: native dependencies |
| Testing | **Vitest** (unit), **Playwright** (end-to-end, including mobile viewports), a custom **eval runner** (AI quality) | — | — |

### 2.1 Cost estimate (Claude list prices: Opus 5.5 $4/$20 per M tokens in/out; Sonnet 5.5 $2/$10)

| Task | Unit | Opus 5.5 | Sonnet 5.5 |
|---|---|---|---|
| Ingest + generate + verify one 42-page handout (one-time) | per handout | ≈ $8–10 | n/a (Opus) |
| Grade one SAQ (3 independent samples) | per answer | ≈ $0.13 | ≈ $0.06 |
| Default test (10 SAQ) | per test | ≈ $1.30 | ≈ $0.65 |
| IMA preset (5 SAQ) | per test | ≈ $0.65 | ≈ $0.33 |
| Handwriting transcription | per photographed page | ≈ $0.03 | ≈ $0.015 |
| MCQ grading | — | $0 (done in code) | $0 |

- Example: three default tests a week comes to about $15/month on Opus or about $8/month on Sonnet.
- Prompt caching of the fixed grading instructions and rubric lowers this.
- Generation can use the Batches API (50% discount) because it isn't time-critical.
- Hosting stays at $0 on free tiers.

---

## 3. System architecture

```
Browser (phone / tablet / laptop)
   │  Next.js pages: Dashboard · Study Materials · Question Bank · Practice · Results · History
   ▼
Next.js server (Vercel functions) ── modules (each independently testable)
   ├─ ingestion     upload → split pages → vision extraction → source_slides
   ├─ generation    topic map → generate Q + keys + rubrics → verify → dedup → bank
   ├─ bank          browse / edit / approve / reject / regenerate / flag; status machine; versioning
   ├─ exams         PURE generator (seeded, stratified sampling) + marks calculator
   ├─ answers       autosave, resume, submission
   ├─ handwriting   image prep → transcription → verify UI → confirmed responses
   ├─ grading       MCQ (pure code) · SAQ (LLM criterion judgement + deterministic scoring) · regrade
   └─ ai            Claude client wrapper: model registry, versioned prompts, JSON schemas,
                    retries/backoff, cost logging, rate-limit handling
   ▼
Supabase: Postgres (RLS) · Storage (private buckets: materials/, handwriting/) · Auth
   ▼
Anthropic Messages API (vision + structured outputs; Batches API for bulk generation)
```

**Long-running work** (ingesting 40+ pages, generating 100 questions) never runs in one request:
- Jobs live in a `jobs` table and advance **one small step per call**: one page range, or one topic.
- A step loop drives them while the page is open. A Vercel cron sweeps unfinished jobs once a day.
- Every step is idempotent, so an interrupted job can always be resumed.
- This stays within Vercel function time limits.

**Answer-key isolation:**
- `answer_keys` (correct option, explanation, model answer, rubric) is a separate table. RLS gives the browser **no read access at all**.
- Only server code, using the service role, reads it, and only for:
  - grading;
  - the results page of an exam that has been **submitted**;
  - the admin's Question Bank.
- Exam-delivery endpoints send the question stem and options only.

---

## 4. Question bank generation

### 4.1 Pipeline

1. **Upload** (Study Materials): PDF, JPG/PNG/HEIC, multiple files. A title and class date are stored. Files go to private storage.
2. **Slide extraction** (vision, 1–2 PDF pages per call). Output per slide, as structured JSON:
   - `printed_slide_number`, `title`, `verbatim_text`, `tables[]`, `diagram_description`;
   - `legibility` (clear / partial / unreadable), `uncertain_terms[]`, `cropped`.
   - The rule: **transcribe, don't infer.** Unreadable text is marked, not completed.
3. **Extraction review** (Study Materials): the slide photo beside the extracted text, with unreadable or partial slides highlighted. The admin can correct text before generation. This is optional, but recommended for flagged slides.
4. **Topic map:** one call over all extracted slides produces topics and the slides each covers (like §1.2). It drives balanced generation and "topics to revise".
5. **Generation per topic:** the topic's slides (text plus images for diagram-heavy slides) produce MCQs and SAQs, in numbers proportional to how much content there is. Every question records:
   - `source_refs` (document, PDF page, printed slide number) and a supporting `basis_quote` from the slide;
   - `difficulty` (easy / medium / hard: recall / application / clinical reasoning);
   - `topic`.

   MCQ rules:
   - single best answer from four options, with a brief explanation;
   - no "all/none of the above", so options can be shuffled;
   - distractors must be plausible but clearly wrong according to the slides.

   SAQ rules:
   - a model answer;
   - `key_concepts[]` with accepted equivalents (e.g. "SGLT2 inhibitors" = "gliflozins");
   - a **rubric** (see §6.2).
6. **Independent verification** (a separate call that doesn't see the generator's reasoning). For each question it checks:
   - the answer is supported by the cited slide;
   - exactly one MCQ option is correct;
   - the wording is unambiguous;
   - the stem doesn't give away the answer;
   - the rubric is consistent with the model answer;
   - it agrees with current guidelines (see §4.4).

   Outcome: pass → `active`; fail → `needs_review`, with the verifier's reason shown.
7. **Deduplication:** `pg_trgm` similarity on stems against existing questions in the same topic. Candidates above a threshold get an LLM "same tested fact?" check. Duplicates are dropped and logged.
8. **Coverage report:** shown after each run, with per-topic counts of MCQs/SAQs by difficulty, slides that produced no questions and why, and an explicit note when the target (about 100) can't be met without repetition. **The pipeline never pads.**

### 4.2 Question lifecycle

| State | Meaning |
|---|---|
| `draft` | Being generated; not yet verified |
| `needs_review` | Failed the verification step; waits in the review queue with the reason |
| `active` | In the exam pool |
| `flagged` | She flagged it while practising; out of the exam pool until reviewed |
| `retired` | Rejected or replaced |

Transitions:
- `draft → active` when verification passes; `draft → needs_review` when it fails.
- From `active`, a question can be flagged by the user (`flagged`) or edited by the admin (which creates a new version).
- From `needs_review` or `flagged`, a reviewer approves (`active`), edits (new version, then `active`), regenerates, or rejects (`retired`).

Rules:
- Edits create a **new version**. Past exams keep the version they used, so old results never change silently.
- **Regenerate** replaces one question using the same source slides and an instruction such as "differs from: …".

### 4.3 Source citation format
`IMA FCD Class 12–13 Mar 2026 · p.14 · Slide 42 "A correction factor"` (a link opens the slide photo).

### 4.4 Course material vs external guidelines
- **Course material is primary.** Questions test what the lecture taught.
- When the verifier's knowledge disagrees with a slide (for example the 450 vs 500 rule), the question is either:
  - **kept with a visible note** ("Course slide 86 uses 450/TDD; slide 41 and common references use 500/TDD"), or
  - **excluded** if the conflict makes the question ambiguous.
- External references never silently override slides.
- Internal contradictions between slides are always surfaced. They are never resolved by picking one.

---

## 5. Practice exam generator

- **Pure function:** `generateExam(pool, config, seed) → ExamPlan`. It is deterministic for a given seed, so it can be tested and reproduced.
- **Config:**
  - `counts` per question type, e.g. `{ mcq: 10, saq: 10 }`, with `essay` reserved for later;
  - `difficulty`: Any / Easy / Medium / Hard / **Balanced** (≈ ⅓ each, filled from neighbouring levels when one runs short);
  - optional topic filter (future).
- **Presets:** **Default** (10 MCQ + 10 SAQ = 100 marks) · **IMA written** (50 MCQ + 5 SAQ = 275 marks) · **Custom**.
- **Marks:** `5 × (mcq + saq)`, recalculated as counts change. The score is always shown as `x / max` and as a percentage. Example: 20 MCQ + 5 SAQ = 125 marks.
- **Selection:** sampling without replacement, so there are no duplicates within an exam. It is stratified by difficulty and spreads across topics. Only `active` questions are used.
- **MCQ option order** is shuffled per exam (seeded) and stored, so the correct letter isn't predictable.
- **Insufficient coverage:**
  - before generating, the screen shows "Only 7 hard SAQs available — use 7, or fill the rest from medium?";
  - nothing fails silently;
  - "Generate New Test" draws a new seed.
- **Snapshot:** the exam stores question IDs and versions plus the option order, so later bank edits don't alter past exams.

---

## 6. Grading

### 6.1 MCQ: pure code
Correct = 5.0, incorrect or unanswered = 0.0. No partial credit and no LLM.

### 6.2 SAQ: hybrid, rubric-grounded

**Rubric format** (generated with the question, checked by the verifier):
- 3–6 **atomic criteria** whose weights sum to 5.0. Each has a checkable statement, accepted equivalents, and examples of partial credit.
- **Critical errors:** listed misconceptions or unsafe statements (e.g. "combining GLP-1RA with DPP-4i is recommended").

**Per-answer pipeline:**
1. **Deterministic pre-check:** an empty or whitespace-only answer scores 0.0 and the LLM is skipped.
2. **LLM criterion judgement** (structured output). For each criterion, the model returns:
   - a level: `full` / `most` / `partial` / `minimal` / `none` (1.0 / 0.75 / 0.5 / 0.25 / 0);
   - **a verbatim quote from the student's answer as evidence**.

   It also lists incorrect or unsafe statements, each with a quote and a severity (`minor` / `significant` / `unsafe`). Finally it judges whether the answer is `assessable`. Off-topic text or gibberish is unassessable and scores 0.0.
3. **Evidence verification (anti-hallucination, in code):**
   - every evidence quote must actually appear in the answer (after normalising whitespace and case);
   - a credit claim without a matching quote counts as `none`;
   - an error claim without a matching quote is discarded;
   - both cases are logged.
4. **Deterministic scoring (in code; the LLM never outputs the mark):**
   ```
   raw   = Σ weight_i × level_i
   raw  -= 0.5 × (#significant errors, max 3)
   if any unsafe statement: raw = min(raw, 2.0)
   mark  = assessable ? clamp(round_to_0.1(raw), 1.0, 5.0) : 0.0
   ```
5. **Consistency check:** steps 2–4 run **three times independently**.
   - The final mark is the **median**, and the criterion results come from the median sample.
   - Confidence is based on the spread across samples: ≤ 0.5 = high, ≤ 1.0 = medium, > 1.0 = **low**.
   - A low-confidence mark is shown with an "Uncertain — review suggested" badge and its range.
6. **Feedback:** for each answer, the results page shows:
   - her answer, the model answer and the mark;
   - why that mark was given;
   - concepts she got right (with her quoted words) and essential concepts she missed;
   - incorrect or misleading statements, suggestions, and the slide reference.
7. **Regrade:** "I think this is wrong" plus an optional comment re-runs grading with her comment as context. Both grades are shown side by side and she chooses which to keep. Nothing is overwritten silently.

**Why this design** (the research summary is in §6.3):
- The LLM supplies the semantic judgement, so paraphrased correct answers get credit.
- Code supplies the arithmetic, clamping, rounding and evidence checks, which makes scores reproducible and auditable.
- The three samples catch unstable judgements.
- Critical-error caps stop answers that use the right terminology with wrong reasoning from scoring well.

### 6.3 Grading methods compared

| Method | Medical accuracy | Consistency | Catches factual errors | Fair to paraphrase | Cost | Latency | Build/maintain |
|---|---|---|---|---|---|---|---|
| Keyword / concept matching | Low | Perfect | **No.** "should *not* be combined" matches the same keywords | Poor | Free | Instant | Easy, but endless synonym lists |
| Embedding similarity | Low–medium | High | **No.** Negations and wrong numbers still look similar | Good | Very low (extra vendor) | Fast | Easy |
| NLI (entailment vs reference) | Medium | High | Partly (contradiction class) | Good | Low, but needs a hosted model | Fast | Medium. Weak on long multi-point answers and domain terms |
| Holistic LLM grade (one number) | Medium–high | **Medium.** Drifts, known to be brittle to rewording | Yes | Good | Medium | 5–20 s | Easy, but opaque |
| Deterministic rubric (human-style checklist) | High if the rubric is good | Perfect | Only listed errors | Depends on how matching is done | — | — | Needs a matcher, which brings back keywords or an LLM |
| **Hybrid (chosen):** LLM criterion judgements + evidence quotes + code scoring + 3-sample consensus | **High** | **High** (median + spread) | **Yes** (errors section + critical caps) | **Good** (semantic) | Medium (3 samples) | 10–30 s per answer, run in parallel | Medium |

**Evidence base:**
- **Pharmacology SAQs** ([BMC Med Educ 2025](https://link.springer.com/article/10.1186/s12909-025-07718-2)): a rubric embedded in the GPT-4 prompt gave ICC 0.94 against humans. The sample was small (30 responses).
- **Postgraduate mechanical-ventilation SAQs** ([arXiv 2505.04645](https://arxiv.org/html/2505.04645v1)): ICC 0.086, with marks consistently lower than the human graders'. The authors attribute this to rubrics written for humans and sensitivity to terminology, and they recommend LLM-specific rubrics.
- **[arXiv 2601.08843](https://arxiv.org/html/2601.08843v1):** LLM graders get less reliable as scales get finer. Consensus over multiple runs with abstention raised accuracy at some cost in coverage. Synonym substitution caused the largest robustness drop.
- **What this design takes from the evidence:**
  - rubrics written for the LLM;
  - coarse per-criterion levels, with fine 0.1 granularity coming from the weighted sum;
  - multi-sample consensus;
  - an "uncertain" flag instead of false confidence;
  - explicit synonym lists.

### 6.4 Safeguards against bad grading
- Evidence quotes are verified in code, so hallucinated credit or errors are dropped.
- The model never outputs the final number.
- Three samples are taken; a low-agreement mark is flagged, never hidden.
- Critical-error caps stop terminology-matching from scoring well when the reasoning is unsafe.
- Grading prompts and rubrics are **versioned**, and every grade stores the model, prompt version and raw samples, so it can be audited.
- Every results page carries this banner: *"AI-estimated practice score. May contain errors. Not an official IMA grade."*
- Regrade gives her a way to dispute any mark.

---

## 7. Answer submission

### 7.1 MCQ
- Large radio cards; the whole card is the tap target and at least 48 px high.
- She can change her answer freely before submitting.
- No correctness signal appears before submission.

### 7.2 Typed SAQ
- An auto-growing multiline box under each question.
- **Autosave:**
  - saved to the database about 1.5 s after typing stops, and on every navigation;
  - a localStorage backup is kept in case the connection drops;
  - a status indicator shows "Saved ✓" or "Saving…" or "Offline – saved on this device".

### 7.3 Handwritten SAQ
1. **Capture:** she can upload photos (JPG/PNG/HEIC) or a PDF, use the **camera** (`accept="image/*" capture="environment"`), or **paste** an image (Ctrl/Cmd-V). Multiple pages are allowed.
2. **Preparation in the browser:** HEIC is converted to JPEG, EXIF orientation is applied, images are resized to a long edge of about 2000 px, and a preview lets her rotate pages, delete them or add more.
3. **Transcription:** Claude vision receives only the **question numbers** in this exam, not the question text, so it can't "autocomplete" medical terms from context. For each answer it returns:
   - the question number exactly as written;
   - a **literal** transcription;
   - `[?word?]` around uncertain words and `[illegible]` for unreadable spans;
   - issues: missing number, ambiguous number (e.g. "1" vs "7"), an answer continuing across pages, or a number not in this exam.
4. **Verification screen:** the crop of her handwriting sits beside editable text.
   - Uncertain and illegible words are highlighted yellow and red.
   - Questions with no detected answer and answers with no matching question are listed.
   - She must tick **"I've checked this"** on each answer before grading.
5. Confirmed text becomes the response, tagged `source = handwritten` and linked to the image. Grading then works exactly as for typed answers.

**Never guessed:** illegible content stays marked as illegible unless she types the correction herself.

---

## 8. UX

- **Navigation:** five large tabs (bottom bar on phones, sidebar on desktop): **Home · Practice · Results · Materials · Question Bank**.
- **Home:** a "Continue your test" banner if one is in progress, a big **Start practice test** button, the last score and a trend, and the top three topics to revise.
- **Taking a test:**
  - one question per screen, with Previous/Next and a **question grid** showing answered, unanswered and marked-for-review. This is familiar from Indian computer-based exams such as NEET-PG.
  - an option to show all questions on one long page;
  - a progress bar ("12 of 20 answered").
- **Text size:** 18 px base, with an A−/A+ control remembered per device. High contrast, plain-language labels and no jargon such as "submit payload".
- **Submit:** a confirmation dialog lists unanswered questions ("3 questions unanswered — submit anyway?").
- **Grading progress:** "Marking answer 4 of 10…". The results page fills in progressively, with MCQ results shown instantly.
- **Results:**
  - totals, MCQ and written subtotals, and the percentage;
  - per-question cards that expand to the full feedback from §6.2.6;
  - **strengths, weak points and topics to revise**, aggregated by topic.
- **History:** a list of past exams with score trends, each opening its results page.
- **Accessibility:** WCAG 2.2 AA contrast, full keyboard use, screen-reader labels, and respect for reduced-motion settings.
- **Mobile:** layout tested at 375 px, 768 px and desktop widths. The app is installable as a PWA so it opens like an app from her home screen.

---

## 9. Data model (Postgres)

```
profiles(id, role: student|admin, display_name, text_scale)
documents(id, title, class_date, storage_path, page_count, status, uploaded_by, created_at)
source_pages(id, document_id, page_no, image_path)
source_slides(id, page_id, printed_slide_no, title, verbatim_text, tables jsonb,
              diagram_description, legibility, uncertain_terms text[], admin_corrected bool)
topics(id, name, parent_id)
slide_topics(slide_id, topic_id)
questions(id, type: mcq|saq|essay*, current_version, status, topic_id, difficulty, created_at)
question_versions(question_id, version, stem, options jsonb /*[{id,text}]*/,
                  source_refs jsonb, basis_quote, conflict_note, generation_run_id, created_at)
answer_keys(question_id, version, correct_option_id, explanation, model_answer,
            key_concepts jsonb, rubric jsonb)            -- RLS: no client access
question_flags(id, question_id, user_id, comment, resolved_at)
generation_runs(id, document_ids, stage, model, prompt_version, tokens_in, tokens_out, cost_usd, report jsonb)
jobs(id, kind, payload jsonb, step, status, error, updated_at)
exams(id, user_id, config jsonb, seed, status: in_progress|submitted|grading|graded, started_at, submitted_at)
exam_items(id, exam_id, position, question_id, question_version, option_order jsonb, max_marks)
responses(exam_item_id, mcq_option_id, text_answer, source: typed|handwritten,
          upload_id, confirmed_at, updated_at)
handwriting_uploads(id, exam_id, image_paths text[], transcription jsonb, status)
grades(id, exam_item_id, attempt, mark, criteria jsonb, errors jsonb, feedback jsonb,
       confidence, spread, samples jsonb, model, prompt_version, is_current, created_at)
regrade_requests(id, grade_id, comment, new_grade_id, chosen_grade_id)
```
`*` `essay` exists in the enum so it can be added later. v1 never generates it.

**Extensibility for long essays:**
- The question type, the exam `counts` map, the per-type `max_marks`, and a `Grader` interface (`grade(item, response) → Grade`) registered per type mean essays can be added as a new grader plus a rubric shape.
- The schema needs no changes.

---

## 10. Project structure

```
StudyHelper/
├─ docs/superpowers/specs/          ← this document
├─ supabase/migrations/             ← schema + RLS policies
├─ src/
│  ├─ app/                          ← Next.js routes
│  │  ├─ (auth)/login
│  │  ├─ page.tsx                   (Home)
│  │  ├─ materials/ · bank/ · practice/new · practice/[examId] · practice/[examId]/handwriting
│  │  ├─ results/[examId] · history/
│  │  └─ api/ (jobs/step, exams, responses, grading, handwriting, bank)
│  ├─ modules/
│  │  ├─ ai/          client.ts, models.ts, prompts/ (versioned), schemas/ (zod), cost.ts
│  │  ├─ ingestion/   splitPdf.ts, extractSlides.ts
│  │  ├─ generation/  topicMap.ts, generate.ts, verify.ts, dedup.ts, coverage.ts
│  │  ├─ bank/        repository.ts, lifecycle.ts
│  │  ├─ exams/       generateExam.ts (pure), marks.ts (pure)
│  │  ├─ answers/     autosave.ts, submit.ts
│  │  ├─ handwriting/ prepareImage.ts (client), transcribe.ts
│  │  └─ grading/     mcq.ts (pure), saq/{judge.ts, evidence.ts, score.ts (pure), consensus.ts}, regrade.ts
│  ├─ components/     ui/ (Radix wrappers), exam/, results/, bank/
│  └─ lib/            supabase/{server,client}.ts, rng.ts
├─ tests/  unit/ · e2e/ (Playwright, mobile + desktop)
└─ evals/  grading/ · transcription/ · extraction/ · generation/  (datasets + runner + reports)
```

---

## 11. Testing and quality assurance

| Area | Method | Pass criterion |
|---|---|---|
| Slide extraction | 15 slides (clear, glare, cropped, table-heavy) transcribed by hand as a gold set. Word accuracy measured, **drug names and numbers** checked separately. | ≥ 98% on numbers and drug names for `clear` slides. Unreadable regions are flagged, never invented. |
| Question quality | Verifier pass rate; manual audit of a 20% random sample against a checklist (supported, single best answer, unambiguous, right difficulty, source correct) | ≥ 90% of audited questions pass. Zero unsupported facts. |
| Duplicates | Seeded near-duplicates (rephrased stems) | ≥ 90% caught. No false merges on the audit sample. |
| Exam generator | Unit and property tests: counts, no duplicates, difficulty mix, marks = 5 × n, shortage path, seed reproducibility | 100% pass |
| MCQ scoring and totals | Unit tests: 5/0, unanswered, percentage, variable counts (e.g. 20 + 5 → 125) | 100% pass |
| SAQ score maths | Unit tests on `score.ts`: weights, 0.1 rounding, the 1.0 floor, blank = 0, unsafe cap, deductions, median | 100% pass |
| **SAQ grading validity** | **Grading eval set:** 12 SAQs × 7 graded responses = 84 items. Responses: blank · completely wrong · keyword-stuffed but wrong reasoning · contains an unsafe statement · partial · correct but paraphrased · model-quality. Target marks set by her, a doctor. | Mean absolute error ≤ 0.5. ≥ 90% within ±1.0. Keyword-stuffed ≤ 2.0. Unsafe ≤ 2.0. Paraphrased within 0.5 of model-quality. |
| Grading consistency | Grade the eval set three times end to end | Median-mark spread ≤ 0.3 on ≥ 90% of items |
| Model comparison | The same eval run on Opus 5.5 and Sonnet 5.5, with cost recorded | Report given to the user, who chooses (decision 2) |
| Handwriting OCR | She hand-writes 10 answers dense with terms such as dapagliflozin, glibenclamide, thiazolidinediones, HbA1c, euglycaemic DKA and saxagliptin, with one deliberately messy page and one mis-numbered answer | Medical-term word error rate ≤ 5% on legible text. 100% of illegible words flagged, not guessed. The numbering problem is detected. |
| Interrupted sessions | Playwright: type → close tab → reopen; airplane-mode typing then reconnect | No lost text. A resume banner appears. |
| Mobile usability | Playwright at 375 / 768 / 1280 px, plus a 10-minute observed session with her on her own phone | No horizontal scroll. All targets ≥ 48 px. She completes a test unaided. |
| API failures | Mocked 429 / 529 / timeouts / malformed JSON | Retries with backoff. Answers never lost. The exam shows "Marking paused — will retry", with a Retry button. |

---

## 12. Development roadmap

### Phase 1 — Research & requirements ✅ (this document)
- **Objectives:** understand the material, choose the architecture, define the MVP.
- **Deliverables:** this spec; the slide inventory (§1); the grading and OCR research (§6.3, §7.3); the cost model (§2.1).
- **Acceptance:** the user approves this spec.
- **Risks:** the exam format isn't independently verifiable, so the user's description is used.

### Phase 2 — Core app, ingestion & question bank
- **Objectives:** a working site with login; upload a handout and get a reviewed question bank.
- **Features:**
  - scaffold (Next.js, Tailwind, Supabase), schema and RLS, auth (her account plus admin), app shell and navigation;
  - Study Materials upload with page split;
  - slide extraction, extraction review, topic map;
  - generation, verification, dedup, coverage report;
  - Question Bank: browse/filter, edit, approve, reject, regenerate, flag queue.
- **Dependencies:** Supabase project, Vercel project, Anthropic API key, Git repository.
- **Deliverables:** deployed preview URL; the bank generated from the 12–13 March handout; the coverage report.
- **Acceptance:**
  - the March handout ingests end to end;
  - every question has a source citation;
  - answer keys can't be read from the browser (tested);
  - the extraction and generation eval targets in §11 are met;
  - the coverage report states the real count (no padding).
- **Risks:** blurry slides; source contradictions; Vercel time limits (mitigated by step-wise jobs); generation cost (mitigated by the Batches API).

### Phase 3 — Examination system
- **Objectives:** take a realistic practice test on any device.
- **Features:**
  - exam configuration with presets (Default, IMA written, Custom), difficulty modes and shortage handling;
  - Generate New Test;
  - the test-taking UI (MCQ cards, SAQ boxes, question grid, progress);
  - autosave and resume; the submit confirmation;
  - History list.
- **Dependencies:** Phase 2 bank.
- **Deliverables:** a complete test flow up to the point of submission.
- **Acceptance:** the generator and autosave tests pass; the resume test passes; the mobile Playwright suite passes.
- **Risks:** offline edge cases (mitigated by the localStorage backup).

### Phase 4 — AI grading & results
- **Objectives:** trustworthy marks and feedback.
- **Features:**
  - MCQ grading; the SAQ hybrid grader (judge, evidence check, scoring, consensus);
  - the results page; topic strengths and weaknesses;
  - regrade; disclaimers.
- **Validation:** build the grading eval set with her (about an hour of her time to write target marks); run the Opus vs Sonnet comparison; she chooses the model.
- **Dependencies:** Phase 3; her availability to set target marks.
- **Deliverables:** grading module, eval report, model decision recorded.
- **Acceptance:** the SAQ grading validity and consistency targets in §11 are met.
- **Risks:** the LLM disagreeing with a doctor's judgement (mitigated by rubric iteration against the eval set and the uncertainty flag); recurring cost.

### Phase 5 — Handwriting
- **Objectives:** answer on paper, photograph, check and grade.
- **Features:**
  - upload, camera and paste; HEIC conversion; multi-page;
  - transcription; the verification screen with highlights;
  - missing and ambiguous-number detection; the hand-off to grading.
- **Dependencies:** Phase 4; handwriting samples from her.
- **Deliverables:** the handwriting flow and the transcription eval report.
- **Acceptance:** the handwriting OCR targets in §11 are met; nothing is graded until she confirms it.
- **Risks:** illegible handwriting (mitigated: flagged rather than guessed, and she corrects it); iPhone HEIC edge cases.

### Phase 6 — Hardening & deployment
- **Objectives:** reliable everyday use.
- **Features:**
  - API failure handling and retries; cost logging;
  - Supabase keep-alive cron (the free tier pauses after 7 days idle);
  - PWA install; accessibility pass; performance on mid-range Android;
  - backups (a scheduled DB export);
  - a full end-to-end run on the real handout;
  - a deployment and operations README, including how to add a new handout.
- **Acceptance:** the full test matrix in §11 is green; she completes three real practice sessions unaided.
- **Risks:** free-tier limits (1 GB storage is enough for about 100 handouts plus photos; can be upgraded).

### MVP definition
**Phases 2–4:** log in → upload a handout → auto-verified bank → configure and take a test (MCQ plus typed SAQ, autosave/resume) → AI-graded results with feedback → history. Handwriting (Phase 5) follows straight after as part of v1.0.

---

## 13. Risks & mitigations (summary)

| Risk | Impact | Mitigation |
|---|---|---|
| AI-generated question is medically wrong | She learns a wrong fact | Source citation and basis quote; independent verifier; conflict notes; flagging; 20% audit |
| SAQ mark is wrong | Misjudged readiness | Hybrid grader, evidence checks, consensus, uncertainty flag, regrade, disclaimer, eval targets |
| Slide photos unreadable | Gaps or invented content | Legibility flags; "transcribe, don't infer"; extraction review; coverage report |
| Source contradictions | Ambiguous questions | Surfaced in conflict notes; ambiguous items excluded |
| Supabase free tier pauses | App "down" after a week idle | Daily keep-alive cron |
| Vercel time limits | Ingestion fails | Step-wise resumable jobs |
| Cost creep | Unexpected bills | Per-call cost logging; monthly total on the admin page; model choice per task; caching and batches |
| Privacy | Her answers and handwriting exposed | Private buckets, RLS, auth required, HTTPS. Commercial API terms: Anthropic doesn't train on API data by default. Minimal personal data. |

---

## 14. Future scope (not in v1; the architecture allows each one)
- **Long-essay questions and grading:** `essay` type, a section-based rubric grader, its own marks per type.
- **Timed mock exams:** `config.time_limit` on the exam, plus a countdown and auto-submit.
- **Topic-wise analytics dashboard:** the data already exists through `topic_id` on every grade.
- **Adaptive difficulty:** the generator gains weights from history.
- **Spaced repetition** of missed concepts: a review queue built from `grades.criteria` misses.
- **Personalised study recommendations.**
- **PDF export** of papers and results.
- **Other exam formats and presets**, and support for **PPTX upload**.

## 15. Remaining open items (non-blocking)
1. The email address for her login, and whether she wants a password or an emailed magic link (magic link is simpler; a password is easier on a shared device).
2. Who owns the Anthropic, Supabase and Vercel accounts. Assumed: the developer.
3. Whether the missing slides (1–20, 77, 79, 99) can be obtained, which would raise coverage.
