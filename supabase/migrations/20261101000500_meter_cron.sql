-- Phase 3B (9): schedule apply_minute_tick every minute with pg_cron (primary scheduler).
--
-- Enabling the extension needs the right to create it; on Supabase turn it on first in
-- Dashboard -> Integrations -> Cron (or Database -> Extensions -> pg_cron). If it is not enabled
-- or cannot be created here, this migration only prints a notice and the app's own timer
-- (METER_TICK_SEC, lib/billing/meter.ts) keeps billing; re-run the statement below once pg_cron
-- is on. Running both schedulers is safe: an advisory lock admits one tick at a time and the
-- ledger key makes a repeated bucket a no-op. docs/deploy-phase-3b.md has the verification SQL.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron could not be created here (%): enable it in the Supabase dashboard', sqlerrm;
    end;
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Named jobs are updated in place, so this is safe to run again.
    perform cron.schedule('transvoice-meter-tick', '* * * * *', 'select public.apply_minute_tick()');
    -- cron.job_run_details grows by one row a minute.
    perform cron.schedule(
      'transvoice-cron-prune', '17 3 * * *',
      $job$delete from cron.job_run_details where end_time < now() - interval '7 days'$job$
    );
  else
    raise notice 'pg_cron is not enabled: minute ticks run from the app timer only';
  end if;
end
$$;
