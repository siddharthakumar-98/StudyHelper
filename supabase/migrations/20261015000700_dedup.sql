-- Duplicate detection and the verify stage's atomic write.
--
-- pg_trgm lives in the "extensions" schema (Supabase convention), so everything
-- below names its functions, operators and operator classes with that schema and
-- the functions keep search_path = public.
create extension if not exists pg_trgm with schema extensions;

create index question_versions_stem_trgm_idx
  on public.question_versions using gin (stem extensions.gin_trgm_ops);

-- The up-to-5 bank questions whose current stem is most like p_stem (trigram
-- similarity >= p_threshold), most similar first. Only questions a student could
-- meet or an admin is reviewing count: status active, needs_review or flagged
-- (never draft or retired), and only their current version. p_exclude_question
-- (nullable) leaves the question being checked out. Service role only.
create or replace function public.find_similar_stems(
  p_stem text,
  p_exclude_question uuid,
  p_threshold real default 0.45
)
returns table (question_id uuid, stem text, sim real)
language sql
set search_path = public
as $$
  -- Lets the "%" operator (and so the GIN index) pre-filter at the same threshold.
  select set_config('pg_trgm.similarity_threshold', p_threshold::text, true);

  select q.id, v.stem, extensions.similarity(v.stem, p_stem)
  from public.questions q
  join public.question_versions v
    on v.question_id = q.id and v.version = q.current_version
  where q.status in ('active', 'needs_review', 'flagged')
    and (p_exclude_question is null or q.id <> p_exclude_question)
    and v.stem operator(extensions.%) p_stem
    and extensions.similarity(v.stem, p_stem) >= p_threshold
  order by 3 desc, q.id
  limit 5;
$$;
revoke execute on function public.find_similar_stems(text, uuid, real) from public, anon, authenticated;
grant execute on function public.find_similar_stems(text, uuid, real) to service_role;

-- Records the verify stage's outcome for one draft question in one transaction:
-- appends p_notes to the current version's review notes, appends p_conflict_note
-- (when not blank) to its conflict note, and moves the question to p_status.
-- Nothing is written unless the question is still a draft at version p_version,
-- so a repeated or concurrent check never appends notes twice. Returns whether
-- it wrote. The status change itself is decided in code (transition()); this
-- only accepts the three statuses a draft can move to. Service role only.
create or replace function public.record_question_check(
  p_question_id uuid,
  p_version int,
  p_status public.question_status,
  p_notes text[],
  p_conflict_note text
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_status public.question_status;
  v_version int;
  v_conflict text := nullif(btrim(coalesce(p_conflict_note, '')), '');
begin
  if p_status not in ('active', 'needs_review', 'retired') then
    raise exception 'A draft cannot move to %', p_status;
  end if;

  select status, current_version into v_status, v_version
  from public.questions
  where id = p_question_id
  for update;
  if not found or v_status <> 'draft' or v_version <> p_version then
    return false;
  end if;

  update public.question_versions
  set review_notes = review_notes || coalesce(p_notes, '{}'),
      conflict_note = case
        when v_conflict is null then conflict_note
        when nullif(btrim(coalesce(conflict_note, '')), '') is null then v_conflict
        else conflict_note || E'\n\n' || v_conflict
      end
  where question_id = p_question_id and version = p_version;

  update public.questions set status = p_status where id = p_question_id;
  return true;
end;
$$;
revoke execute on function public.record_question_check(uuid, int, public.question_status, text[], text)
  from public, anon, authenticated;
grant execute on function public.record_question_check(uuid, int, public.question_status, text[], text)
  to service_role;
