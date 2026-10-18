-- Private bucket for uploaded handouts and their split pages.
-- No storage.objects policies on purpose: only the service role (which bypasses RLS)
-- reads or writes objects; browsers upload through signed upload URLs.
insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;
