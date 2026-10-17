-- Core schema for StudyHelper (spec section 9) with row level security.
-- answer_keys and generation_runs have RLS enabled and deliberately NO policies:
-- only the service role (which bypasses RLS) can read or write them.

-- ---------------------------------------------------------------- enums
create type public.user_role as enum ('student', 'admin');
create type public.question_type as enum ('mcq', 'saq', 'essay');
create type public.question_status as enum ('draft', 'needs_review', 'active', 'flagged', 'retired');
create type public.difficulty as enum ('easy', 'medium', 'hard');
create type public.legibility as enum ('clear', 'partial', 'unreadable');
create type public.page_kind as enum ('pdf_page', 'image');
create type public.job_status as enum ('pending', 'running', 'done', 'failed');

-- ---------------------------------------------------------------- tables
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'student',
  display_name text
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  class_date date,
  page_count int not null default 0,
  status text not null default 'uploading',
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.document_files (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  file_index int not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null
);
create index document_files_document_id_idx on public.document_files (document_id);

create table public.source_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  page_no int not null,
  source_file_index int not null,
  kind public.page_kind not null,
  storage_path text not null,
  unique (document_id, page_no)
);

create table public.source_slides (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.source_pages (id) on delete cascade,
  position_on_page int not null,
  printed_slide_no text,
  title text,
  verbatim_text text not null,
  tables jsonb not null default '[]',
  diagram_description text,
  legibility public.legibility not null,
  uncertain_terms text[] not null default '{}',
  cropped boolean not null default false,
  admin_corrected boolean not null default false,
  unique (page_id, position_on_page)
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  name text not null
);
create unique index topics_name_lower_idx on public.topics (lower(name));

create table public.slide_topics (
  slide_id uuid not null references public.source_slides (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  primary key (slide_id, topic_id)
);

create table public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  report jsonb
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  type public.question_type not null,
  status public.question_status not null default 'draft',
  current_version int not null default 1,
  topic_id uuid not null references public.topics (id),
  difficulty public.difficulty not null,
  generation_run_id uuid references public.generation_runs (id) on delete set null,
  batch_key text,
  created_at timestamptz not null default now()
);
create index questions_status_idx on public.questions (status);
create index questions_topic_id_idx on public.questions (topic_id);

create table public.question_versions (
  question_id uuid not null references public.questions (id) on delete cascade,
  version int not null,
  stem text not null,
  options jsonb,
  source_refs jsonb not null,
  basis_quote text not null,
  conflict_note text,
  review_notes text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (question_id, version)
);

create table public.answer_keys (
  question_id uuid not null,
  version int not null,
  correct_option_id text,
  explanation text,
  model_answer text,
  key_concepts jsonb,
  rubric jsonb,
  primary key (question_id, version),
  foreign key (question_id, version)
    references public.question_versions (question_id, version) on delete cascade
);

create table public.question_flags (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  comment text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index question_flags_question_id_idx on public.question_flags (question_id);

-- ------------------------------------------------------------- functions
create function public.is_admin() returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Test support: wipes app data (not profiles/auth). Service role only. The final
-- definition, with its local-only guard, is in 20261015000300_jobs.sql.
create function public.test_reset_app_tables() returns void
language plpgsql
set search_path = public
as $$
begin
  truncate table
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

-- ------------------------------------------------------------------ RLS
alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.document_files enable row level security;
alter table public.source_pages enable row level security;
alter table public.source_slides enable row level security;
alter table public.topics enable row level security;
alter table public.slide_topics enable row level security;
alter table public.generation_runs enable row level security;
alter table public.questions enable row level security;
alter table public.question_versions enable row level security;
alter table public.answer_keys enable row level security;
alter table public.question_flags enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());

create policy documents_select on public.documents
  for select to authenticated using (true);
create policy document_files_select on public.document_files
  for select to authenticated using (true);
create policy source_pages_select on public.source_pages
  for select to authenticated using (true);
create policy source_slides_select on public.source_slides
  for select to authenticated using (true);
create policy topics_select on public.topics
  for select to authenticated using (true);
create policy slide_topics_select on public.slide_topics
  for select to authenticated using (true);

create policy questions_select on public.questions
  for select to authenticated
  using (status in ('active', 'flagged') or public.is_admin());

create policy question_versions_select on public.question_versions
  for select to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id));

create policy question_flags_insert on public.question_flags
  for insert to authenticated with check (user_id = auth.uid());
create policy question_flags_select on public.question_flags
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- answer_keys, generation_runs: RLS on, intentionally no policies, and (defence in
-- depth) no table privileges for client roles either. Service role only.
revoke all on public.answer_keys, public.generation_runs from anon, authenticated;
