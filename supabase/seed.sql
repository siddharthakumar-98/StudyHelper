-- Local stack only: `npx supabase db reset` runs this file; `supabase db push`
-- (the cloud project) never does. It lets the test helpers call
-- test_reset_app_tables(), which refuses to run on any database without this
-- row (R39; see 20261015000300_jobs.sql).
insert into test_support.settings (name, value)
values ('allow_test_reset', 'on')
on conflict (name) do update set value = excluded.value;
