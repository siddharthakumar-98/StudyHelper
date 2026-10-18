-- Ledger of every Claude call: model, prompt version, tokens and USD cost.
create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  task text not null,
  model text not null,
  prompt_version text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  cost_usd numeric(10, 5) not null default 0,
  document_id uuid references public.documents (id) on delete set null,
  created_at timestamptz not null default now()
);
create index ai_calls_created_at_idx on public.ai_calls (created_at);
create index ai_calls_document_id_idx on public.ai_calls (document_id);

-- Server-only: RLS on with no policies, and no direct grants to client roles.
alter table public.ai_calls enable row level security;
revoke all on public.ai_calls from anon, authenticated;

-- Extend the test reset helper to cover ai_calls.
create or replace function public.test_reset_app_tables() returns void
language plpgsql
set search_path = public
as $$
begin
  truncate table
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
