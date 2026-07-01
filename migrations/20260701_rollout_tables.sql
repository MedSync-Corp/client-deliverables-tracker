-- Migration: mass-roster rollout plan tables (Build 2)
-- Project: inspwdgteuhqscoimroo (Client Deliverables Tracker)
-- Date: 2026-07-01
-- Run manually in the Supabase SQL editor.
--
-- rollout_weeks.week_index is ORDINAL (1-based) and deliberately NOT
-- calendar-anchored: a week advances only when someone confirms the prior
-- week complete, never on a date trigger. Weekly target math stays in
-- weekly_commitments/weekly_overrides; a plan only touches the baseline
-- once, at creation, through the app's normal commitment write path.

BEGIN;

CREATE TABLE public.rollout_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_fk uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  total_population integer NOT NULL CHECK (total_population > 0),
  test_files_qty integer NOT NULL DEFAULT 5 CHECK (test_files_qty >= 0),
  weeks_planned integer NOT NULL CHECK (weeks_planned > 0) DEFAULT 3,
  weekly_qty integer NOT NULL CHECK (weekly_qty >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','canceled')),
  note text,
  created_at timestamptz DEFAULT now()
);

-- One active plan per client
CREATE UNIQUE INDEX rollout_plans_one_active_per_client
  ON public.rollout_plans (client_fk) WHERE status = 'active';

CREATE TABLE public.rollout_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_fk uuid NOT NULL REFERENCES public.rollout_plans(id) ON DELETE CASCADE,
  week_index integer NOT NULL CHECK (week_index >= 1),
  qty integer NOT NULL CHECK (qty >= 0),
  confirmed boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  confirmed_by text,
  UNIQUE (plan_fk, week_index)
);

-- RLS matching the other app tables: authenticated ALL, no anon access
ALTER TABLE public.rollout_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rollout_weeks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth rw rollout_plans" ON public.rollout_plans
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth rw rollout_weeks" ON public.rollout_weeks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE public.rollout_plans IS
  'Mass-roster delivery plans: after test files, remaining population divided over weeks_planned weeks. weekly_qty = ceil((total_population - test_files_qty) / weeks_planned), stored explicitly at creation. One active plan per client.';
COMMENT ON COLUMN public.rollout_weeks.week_index IS
  'Ordinal (1-based), deliberately NOT calendar-anchored. The current week is the lowest unconfirmed index; advances only on manual confirmation.';

COMMIT;
