-- Explicit table privileges for signed-in users (item 13). Row level security
-- decides which rows they see; these grants only say which tables they may read
-- at all. Supabase currently grants every new public table to the Data API roles
-- by default (auto_expose_new_tables), but that default can be switched off, so
-- the app does not rely on it. Only reads that a policy allows are granted;
-- question_versions has its own column-level grant (20261015000800), and
-- answer_keys, generation_runs, jobs and ai_calls stay server-only.
grant select on
  public.profiles,
  public.documents,
  public.document_files,
  public.source_pages,
  public.source_slides,
  public.topics,
  public.slide_topics,
  public.questions,
  public.question_flags
to authenticated;

-- question_flags_insert lets a user add their own flag.
grant insert on public.question_flags to authenticated;
