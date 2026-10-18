-- Question bank actions: versioning, status changes, and hiding review notes.

-- ------------------------------------- answer-adjacent columns stay server-side
-- Verifier notes (review_notes) can name the correct answer, the basis quote is
-- the passage that proves it, and the conflict note says which slide holds it;
-- students must not see any of them before they submit (spec section 3). A
-- column-level revoke only takes effect when the table-level SELECT grant is
-- gone, so the table grant is removed and only the safe columns are granted back
-- to signed-in users; the RLS policy stays as it is. anon gets nothing (the
-- policy only ever admitted authenticated users). The app serves these three
-- columns from the server with the service role (admins: after requireAdmin;
-- students: conflict note only, for questions row level security already showed
-- them). Every client query on this table must name its columns (never "*"), and
-- a column added later needs its own grant if signed-in users should read it.
revoke select on public.question_versions from anon, authenticated;
grant select (question_id, version, stem, options, source_refs, created_at)
  on public.question_versions to authenticated;

-- ------------------------------------------------------- create_question_version
-- Adds version n+1 of a question with its answer key, and moves the question to
-- it, in one transaction: inserts the version, then its key (the key's composite
-- foreign key needs the version first), then sets current_version and status.
-- n is the highest existing version plus one, so a version is never overwritten.
-- Earlier versions and their keys are left untouched.
--   p_version: { stem, options, source_refs, basis_quote, conflict_note,
--                review_notes: [text], difficulty (optional) }
--   p_key:     { correct_option_id, explanation, model_answer, key_concepts, rubric }
--   p_status:  'active' (an admin edit) or 'draft' (a regeneration, to be checked)
--   p_expected_version: the version the caller based the change on; refused
--              unless it is still the question's current_version, so two
--              admins (or two clicks) cannot both build on the same version.
-- A retired or draft question never gets a new version (the lifecycle allows
-- neither), which also turns a second concurrent regenerate away. The question's
-- open flags are resolved, as the new version replaces what was flagged.
-- Returns the new version number. Service role only.
create or replace function public.create_question_version(
  p_question_id uuid,
  p_version jsonb,
  p_key jsonb,
  p_status public.question_status,
  p_expected_version int
)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_status public.question_status;
  v_current int;
  v_next int;
begin
  if p_status not in ('active', 'draft') then
    raise exception 'A new version cannot start as %', p_status;
  end if;

  select status, current_version into v_status, v_current
  from public.questions where id = p_question_id for update;
  if not found then
    raise exception 'Question % not found', p_question_id;
  end if;
  if v_current is distinct from p_expected_version then
    raise exception 'Version changed: expected % but the question is at version %', p_expected_version, v_current;
  end if;
  if v_status in ('draft', 'retired') then
    raise exception 'A % question cannot get a new version', v_status;
  end if;

  select coalesce(max(version), 0) + 1 into v_next
  from public.question_versions where question_id = p_question_id;

  insert into public.question_versions (
    question_id, version, stem, options, source_refs, basis_quote, conflict_note, review_notes
  )
  values (
    p_question_id,
    v_next,
    p_version ->> 'stem',
    nullif(p_version -> 'options', 'null'::jsonb),
    coalesce(p_version -> 'source_refs', '[]'::jsonb),
    coalesce(p_version ->> 'basis_quote', ''),
    nullif(p_version ->> 'conflict_note', ''),
    coalesce(
      array(select jsonb_array_elements_text(coalesce(p_version -> 'review_notes', '[]'::jsonb))),
      '{}'
    )
  );

  insert into public.answer_keys (
    question_id, version, correct_option_id, explanation, model_answer, key_concepts, rubric
  )
  values (
    p_question_id,
    v_next,
    p_key ->> 'correct_option_id',
    p_key ->> 'explanation',
    p_key ->> 'model_answer',
    nullif(p_key -> 'key_concepts', 'null'::jsonb),
    nullif(p_key -> 'rubric', 'null'::jsonb)
  );

  update public.questions
  set current_version = v_next,
      status = p_status,
      difficulty = coalesce((p_version ->> 'difficulty')::public.difficulty, difficulty)
  where id = p_question_id;

  update public.question_flags
  set resolved_at = now()
  where question_id = p_question_id and resolved_at is null;

  return v_next;
end;
$$;
revoke execute on function public.create_question_version(uuid, jsonb, jsonb, public.question_status, int)
  from public, anon, authenticated;
grant execute on function public.create_question_version(uuid, jsonb, jsonb, public.question_status, int)
  to service_role;

-- ----------------------------------------------------------- set_question_status
-- Moves a question from p_from to p_to, and appends p_note (when not blank) to
-- its current version's review notes, in one transaction. Nothing is written
-- unless the question is still in p_from, so a status change decided on stale
-- information is turned away (returns false). The change itself is decided in
-- code (transition()). Leaving 'flagged' for another status resolves the
-- question's open flags. Service role only.
create or replace function public.set_question_status(
  p_question_id uuid,
  p_from public.question_status,
  p_to public.question_status,
  p_note text
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_status public.question_status;
  v_version int;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select status, current_version into v_status, v_version
  from public.questions where id = p_question_id for update;
  if not found or v_status <> p_from then
    return false;
  end if;

  update public.questions set status = p_to where id = p_question_id;

  if v_note is not null then
    update public.question_versions
    set review_notes = review_notes || v_note
    where question_id = p_question_id and version = v_version;
  end if;

  if p_from = 'flagged' and p_to <> 'flagged' then
    update public.question_flags
    set resolved_at = now()
    where question_id = p_question_id and resolved_at is null;
  end if;
  return true;
end;
$$;
revoke execute on function public.set_question_status(uuid, public.question_status, public.question_status, text)
  from public, anon, authenticated;
grant execute on function public.set_question_status(uuid, public.question_status, public.question_status, text)
  to service_role;
