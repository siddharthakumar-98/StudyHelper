-- Replaces one page's extracted slides in a single transaction, so a retried or
-- duplicate extract step never leaves extra or partial rows. It upserts on
-- (page_id, position_on_page): slide ids, and with them slide_topics links and
-- question source refs, survive for positions that still exist. A slide an admin
-- corrected is never overwritten or removed. Non-corrected slides at positions
-- the new set no longer has are removed. Returns the number of slides written
-- (corrected slides that were skipped are not counted). Service role only.
create or replace function public.replace_page_slides(p_page_id uuid, p_slides jsonb)
returns int
language plpgsql
set search_path = public
as $$
declare
  written int;
begin
  if jsonb_typeof(p_slides) is distinct from 'array' then
    raise exception 'p_slides must be a JSON array';
  end if;

  -- Serialise concurrent replaces of the same page.
  perform pg_advisory_xact_lock(hashtext(p_page_id::text));

  insert into public.source_slides as cur (
    page_id,
    position_on_page,
    printed_slide_no,
    title,
    verbatim_text,
    tables,
    diagram_description,
    legibility,
    uncertain_terms,
    cropped
  )
  select
    p_page_id,
    (s ->> 'position_on_page')::int,
    s ->> 'printed_slide_no',
    s ->> 'title',
    s ->> 'verbatim_text',
    coalesce(s -> 'tables', '[]'::jsonb),
    s ->> 'diagram_description',
    (s ->> 'legibility')::public.legibility,
    coalesce(
      array(select jsonb_array_elements_text(coalesce(s -> 'uncertain_terms', '[]'::jsonb))),
      '{}'
    ),
    coalesce((s ->> 'cropped')::boolean, false)
  from jsonb_array_elements(p_slides) as s
  on conflict (page_id, position_on_page) do update
    set printed_slide_no = excluded.printed_slide_no,
        title = excluded.title,
        verbatim_text = excluded.verbatim_text,
        tables = excluded.tables,
        diagram_description = excluded.diagram_description,
        legibility = excluded.legibility,
        uncertain_terms = excluded.uncertain_terms,
        cropped = excluded.cropped
    where not cur.admin_corrected;
  get diagnostics written = row_count;

  delete from public.source_slides
  where page_id = p_page_id
    and not admin_corrected
    and position_on_page not in (
      select (s ->> 'position_on_page')::int from jsonb_array_elements(p_slides) as s
    );

  return written;
end;
$$;
revoke execute on function public.replace_page_slides(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_page_slides(uuid, jsonb) to service_role;
