-- Applies a document's topic map in one transaction, so a retried or duplicate
-- topic_map step never leaves partial or extra rows:
--   1. upserts the topics by lower(name) (an existing topic keeps its first-seen
--      casing and id, so overlapping handouts share topics);
--   2. replaces slide_topics for this document's slides only (ids that do not
--      belong to the document are ignored);
--   3. returns the document's open generation run (completed_at is null),
--      creating one only if there is none, so a repeated step reuses the run.
-- p_topics is [{ "name": text, "slide_ids": [uuid, ...] }, ...]. Service role only.
create or replace function public.apply_topic_map(p_document_id uuid, p_topics jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_run uuid;
begin
  if jsonb_typeof(p_topics) is distinct from 'array' then
    raise exception 'p_topics must be a JSON array';
  end if;

  -- Serialise concurrent runs for the same document.
  perform pg_advisory_xact_lock(hashtext('topic_map:' || p_document_id::text));

  -- Sorted by lower(name) so concurrent documents take index locks in one order.
  insert into public.topics (name)
  select distinct on (lower(btrim(t ->> 'name'))) btrim(t ->> 'name')
  from jsonb_array_elements(p_topics) as t
  where btrim(coalesce(t ->> 'name', '')) <> ''
  order by lower(btrim(t ->> 'name'))
  on conflict (lower(name)) do nothing;

  delete from public.slide_topics st
  using public.source_slides ss, public.source_pages sp
  where st.slide_id = ss.id
    and ss.page_id = sp.id
    and sp.document_id = p_document_id;

  insert into public.slide_topics (slide_id, topic_id)
  select distinct ss.id, tp.id
  from jsonb_array_elements(p_topics) as t
  cross join lateral jsonb_array_elements_text(coalesce(t -> 'slide_ids', '[]'::jsonb)) as sid
  join public.topics tp on lower(tp.name) = lower(btrim(t ->> 'name'))
  join public.source_slides ss on ss.id::text = sid
  join public.source_pages sp on sp.id = ss.page_id and sp.document_id = p_document_id
  on conflict do nothing;

  select id into v_run
  from public.generation_runs
  where document_id = p_document_id and completed_at is null
  order by started_at desc, id
  limit 1;
  if v_run is null then
    insert into public.generation_runs (document_id) values (p_document_id) returning id into v_run;
  end if;
  return v_run;
end;
$$;
revoke execute on function public.apply_topic_map(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_topic_map(uuid, jsonb) to service_role;
