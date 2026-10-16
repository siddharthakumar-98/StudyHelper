-- Saves one generation batch in one transaction, replacing (never adding to) the
-- drafts an earlier attempt of the same batch wrote, so a retried or duplicate
-- generate step leaves the same rows:
--   1. deletes this run's draft questions with this batch key (their versions and
--      answer keys go with them by cascade);
--   2. inserts each item as a draft question, its version 1 and its answer key.
-- p_items is [{ type, difficulty, stem, options, source_refs, basis_quote,
--   conflict_note, review_notes: [text], correct_option_id, explanation,
--   model_answer, key_concepts, rubric }, ...]. Returns the number of questions
-- written. Service role only.
create or replace function public.save_generated_questions(
  p_run_id uuid,
  p_topic_id uuid,
  p_batch_key text,
  p_items jsonb
)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_item jsonb;
  v_question uuid;
  v_written int := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items must be a JSON array';
  end if;

  -- Serialise concurrent saves of the same batch.
  perform pg_advisory_xact_lock(hashtext('generate:' || p_run_id::text || ':' || p_batch_key));

  delete from public.questions
  where generation_run_id = p_run_id
    and batch_key = p_batch_key
    and status = 'draft';

  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.questions (type, topic_id, difficulty, generation_run_id, batch_key)
    values (
      (v_item ->> 'type')::public.question_type,
      p_topic_id,
      (v_item ->> 'difficulty')::public.difficulty,
      p_run_id,
      p_batch_key
    )
    returning id into v_question;

    insert into public.question_versions (
      question_id, version, stem, options, source_refs, basis_quote, conflict_note, review_notes
    )
    values (
      v_question,
      1,
      v_item ->> 'stem',
      nullif(v_item -> 'options', 'null'::jsonb),
      coalesce(v_item -> 'source_refs', '[]'::jsonb),
      v_item ->> 'basis_quote',
      v_item ->> 'conflict_note',
      coalesce(
        array(select jsonb_array_elements_text(coalesce(v_item -> 'review_notes', '[]'::jsonb))),
        '{}'
      )
    );

    insert into public.answer_keys (
      question_id, version, correct_option_id, explanation, model_answer, key_concepts, rubric
    )
    values (
      v_question,
      1,
      v_item ->> 'correct_option_id',
      v_item ->> 'explanation',
      v_item ->> 'model_answer',
      nullif(v_item -> 'key_concepts', 'null'::jsonb),
      nullif(v_item -> 'rubric', 'null'::jsonb)
    );

    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;
revoke execute on function public.save_generated_questions(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_generated_questions(uuid, uuid, text, jsonb) to service_role;

-- A generation run can be reused by a later topic-map pass (apply_topic_map keeps
-- the open run), whose batches have different keys. The generate stage calls this
-- first to delete the run's draft questions from batches that are no longer in
-- its plan. Questions already past draft are kept. Returns the number deleted.
-- Service role only.
create or replace function public.delete_stale_draft_batches(p_run_id uuid, p_keep_batch_keys text[])
returns int
language plpgsql
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.questions
  where generation_run_id = p_run_id
    and status = 'draft'
    and (batch_key is null or not (batch_key = any (coalesce(p_keep_batch_keys, '{}'))));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke execute on function public.delete_stale_draft_batches(uuid, text[]) from public, anon, authenticated;
grant execute on function public.delete_stale_draft_batches(uuid, text[]) to service_role;
