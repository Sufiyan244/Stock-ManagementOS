-- Optional: enables scheduled owner reminders using Supabase pg_cron.
-- Run once in the Supabase SQL Editor after schema.sql, if pg_cron is available.
create extension if not exists pg_cron;
select cron.schedule('stockos-owner-message-dispatch', '* * * * *', 'select public.process_owner_messages();');