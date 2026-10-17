-- The pipeline pauses after extraction (R38): extract leaves the handout in
-- status 'review' with no next job, so the admin can check and correct the
-- slides before any question is written. "Write questions" calls this.
--
-- Starts the topic_map job for a handout in 'review' and moves it to
-- 'processing', in one transaction, at most once: the handout row is locked,
-- an unfinished (pending or running) topic_map job is returned instead of
-- adding a second one, and a handout that is not in 'review' gets nothing
-- (null). Returns the job id. Service role only.
create or replace function public.start_question_writing(p_document_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_status text;
  v_job uuid;
begin
  select status into v_status from public.documents where id = p_document_id for update;
  if not found then
    return null;
  end if;

  select id into v_job
  from public.jobs
  where document_id = p_document_id
    and kind = 'topic_map'
    and status in ('pending', 'running')
  order by created_at desc, id
  limit 1;
  if v_job is not null then
    update public.documents set status = 'processing' where id = p_document_id and status = 'review';
    return v_job;
  end if;

  if v_status <> 'review' then
    return null;
  end if;

  insert into public.jobs (kind, document_id, payload)
  values ('topic_map', p_document_id, '{}'::jsonb)
  returning id into v_job;
  update public.documents set status = 'processing' where id = p_document_id;
  return v_job;
end;
$$;
revoke execute on function public.start_question_writing(uuid) from public, anon, authenticated;
grant execute on function public.start_question_writing(uuid) to service_role;
