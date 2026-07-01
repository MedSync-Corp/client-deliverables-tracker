-- Migration: single status column + is_test flag + security quick fixes
-- Project: inspwdgteuhqscoimroo (Client Deliverables Tracker)
-- Date: 2026-07-01 (Build 1 — status enum + dual-write)
-- Run manually in the Supabase SQL editor. The app dual-writes the legacy
-- booleans (completed/paused/pause_reason) after this migration, so the
-- COO Dashboard CRM sync (service_role) keeps working unchanged.

BEGIN;

-- 1. Backup, per repo convention (cf. clients_backup_20260223)
CREATE TABLE public.clients_backup_20260701 AS
  SELECT * FROM public.clients;

-- 2. New columns.
--    status is the app's new source of truth. "Not Started" stays derived
--    from weekly_commitments and is never stored.
ALTER TABLE public.clients
  ADD COLUMN status TEXT DEFAULT 'active'
    CONSTRAINT clients_status_check CHECK (status IN
      ('active','paused_client','paused_medsync','awaiting_patients','term','contract_complete')),
  ADD COLUMN is_test BOOLEAN NOT NULL DEFAULT false;

-- 3. Backfill from the legacy booleans. Paused takes precedence over
--    completed, which resolves the one illegal row in production
--    (Texas Alliance Medical Group / TAMG: completed AND paused both true,
--    pause_reason null -> paused_client).
UPDATE public.clients SET status = CASE
  WHEN paused IS TRUE AND pause_reason = 'medsync' THEN 'paused_medsync'
  WHEN paused IS TRUE                              THEN 'paused_client'
  WHEN completed IS TRUE                           THEN 'awaiting_patients'
  ELSE 'active'
END;

-- 3b. Align the illegal row's legacy booleans with its new status
--     (paused_client => completed=false, paused=true, pause_reason='client').
--     This is the ONLY boolean change in this migration.
UPDATE public.clients
SET completed = false, pause_reason = 'client'
WHERE id = 'f05683b6-a707-495d-ad45-236cf8272475';  -- Texas Alliance Medical Group (TAMG)

-- 4. Document the columns for the incoming team
COMMENT ON COLUMN public.clients.status IS
  'Source of truth for client status: active | paused_client | paused_medsync | awaiting_patients | term | contract_complete. Legacy completed/paused/pause_reason are kept in sync by the app (dual-write) for the COO dashboard sync; do not write one without the other.';
COMMENT ON COLUMN public.clients.is_test IS
  'Test client flag: rendered in the pinned Test Clients dashboard section (Build 2) and excluded from production metrics.';

-- 5. Security quick fixes from the 2026-07-01 discovery audit.
--    staff_settings had anon SELECT + DELETE; authenticated keeps full access
--    via the remaining staff_settings_rw / insert / update policies.
DROP POLICY "staff_settings_select" ON public.staff_settings;
DROP POLICY "staff_settings_delete" ON public.staff_settings;

--    rls_auto_enable() is SECURITY DEFINER and was executable by PUBLIC
--    (which is what exposed it to anon) plus an explicit anon grant.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;

COMMIT;

-- Expected result (as of 2026-07-01 data):
--   118 rows: 71 active, 14 paused_client, 11 paused_medsync, 22 awaiting_patients
--   Boolean diff vs clients_backup_20260701: exactly one row (TAMG).
