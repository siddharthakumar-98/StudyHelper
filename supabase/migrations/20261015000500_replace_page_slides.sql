-- Replaces one page's extracted slides in a single transaction (replace, not
-- append), so a retried or duplicate extract step never leaves extra or partial
-- rows. Returns the number of slides written. Service role only.
create or replace function public.replace_page_slides(p_page_id uuid, p_slides jsonb)
returns int
language plpgsql
set search_path = public
as $$
declare
  inserted int;
begin
  if jsonb_typeof(p_slides) is distinct from 'array' then
    raise exception 'p_slides must be a JSON array';
  end if;

  delete from public.source_slides where page_id = p_page_id;

  insert into public.source_slides (
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
  from jsonb_array_elements(p_slides) as s;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;
revoke execute on function public.replace_page_slides(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_page_slides(uuid, jsonb) to service_role;
