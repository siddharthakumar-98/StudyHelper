-- Resumable step-wise job queue (split -> extract -> topic_map -> generate -> verify).
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  document_id uuid not null references public.documents (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  step int not null default 0,
  status public.job_status not null default 'pending',
  progress jsonb,
  attempts int not null default 0,
  error text,
  locked_until timestamptz,
  next_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_document_id_idx on public.jobs (document_id);
create index jobs_unfinished_idx on public.jobs (created_at) where status in ('pending', 'running');

-- Server-only: RLS on with no policies, and no direct grants to client roles.
alter table public.jobs enable row level security;
revoke all on public.jobs from anon, authenticated;

-- Atomically takes the step lock and counts the attempt at claim time, so a step
-- killed by a function timeout still counts. Returns the row when claimed, null
-- otherwise. A job claimed 3 times without a successful step (which resets
-- attempts to 0) is marked failed here instead of being claimed a 4th time.
-- Keep the limit (3) in step with MAX_ATTEMPTS in src/modules/jobs/engine.ts.
create or replace function public.claim_job(p_job_id uuid, p_lock_seconds int)
returns public.jobs
language plpgsql
set search_path = public
as $$
declare
  r public.jobs;
begin
  select * into r
  from public.jobs
  where id = p_job_id
    and status in ('pending', 'running')
    and (locked_until is null or locked_until < now())
  for update;
  if not found then
    return null;
  end if;

  if r.attempts >= 3 then
    update public.jobs
    set status = 'failed',
        error = 'This step stopped unexpectedly 3 times. Please try again.',
        locked_until = null,
        updated_at = now()
    where id = p_job_id;
    return null;
  end if;

  update public.jobs
  set status = 'running',
      attempts = attempts + 1,
      locked_until = now() + make_interval(secs => p_lock_seconds),
      updated_at = now()
  where id = p_job_id
  returning * into r;
  return r;
end;
$$;
revoke execute on function public.claim_job(uuid, int) from public, anon, authenticated;
grant execute on function public.claim_job(uuid, int) to service_role;

-- Local-only opt-in for test_reset_app_tables (R39). The schema is not exposed
-- through the Data API, and only the service role may read it; nobody but the
-- database owner can write it. supabase/seed.sql, which `npx supabase db reset`
-- runs on the local stack and `supabase db push` never runs, adds the one row.
-- (A database-level `app.allow_test_reset` setting would read more naturally, but
-- the local `postgres` role is not a superuser and may not persist a custom
-- parameter with ALTER DATABASE / ROLE / FUNCTION ... SET.)
create schema if not exists test_support;
revoke all on schema test_support from public, anon, authenticated;
grant usage on schema test_support to service_role;
create table test_support.settings (
  name text primary key,
  value text not null
);
revoke all on test_support.settings from public, anon, authenticated, service_role;
grant select on test_support.settings to service_role;

-- Extend the test reset helper to cover jobs. It wipes every handout and
-- question, so it refuses to run unless this database opted in (the
-- allow_test_reset row above, local stack only): a test pointed at the cloud
-- project by mistake cannot destroy the real bank (R39).
create or replace function public.test_reset_app_tables() returns void
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from test_support.settings where name = 'allow_test_reset' and value = 'on'
  ) then
    raise exception 'test_reset_app_tables is disabled on this database (allow_test_reset is not on)';
  end if;
  truncate table
    public.jobs,
    public.ai_calls,
    public.question_flags,
    public.answer_keys,
    public.question_versions,
    public.questions,
    public.generation_runs,
    public.slide_topics,
    public.topics,
    public.source_slides,
    public.source_pages,
    public.document_files,
    public.documents
  restart identity cascade;
end;
$$;
revoke execute on function public.test_reset_app_tables() from public, anon, authenticated;
grant execute on function public.test_reset_app_tables() to service_role;
