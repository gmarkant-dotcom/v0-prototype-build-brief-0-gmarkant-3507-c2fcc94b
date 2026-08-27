-- =====================================================================
-- 098 PRE-APPLY TEST. ONE PASTE. ALTERS, WRITES, THEN ROLLS BACK.
--
-- WHY THIS FILE EXISTS AND WHY IT IS NOT OPTIONAL.
--
-- A dry run of 098 proves the file parses and that the statements do not
-- collide with anything. It says NOTHING about whether the existing
-- leadership rows still read correctly afterwards, whether a contributor
-- can sit alongside a lead without tripping the index, whether the
-- replaced set_project_lead closes THE LEAD rather than a contributor,
-- or whether a vendor can tag their own staff onto the agency's
-- ownership record.
--
-- >>> 098 IS THE FIRST MIGRATION IN THIS SEQUENCE TO ALTER A TABLE THAT
-- >>> ALREADY HAS ROWS. 097 is applied and project_leads holds live
-- >>> leadership history. "It applied without error" is worth very
-- >>> little here: a partial index recreated without its role clause
-- >>> applies perfectly and then rejects every contributor; a
-- >>> set_project_lead that closes the wrong open row raises nothing at
-- >>> all and simply reassigns the wrong person. The only way to find
-- >>> out is to write things through it and see which ones land.
--
-- =====================================================================
-- HOW THIS DIFFERS FROM 097's TEST, AND WHY
-- =====================================================================
--
-- 097's subject was a table that did not exist yet, so it had no
-- pre-098 behaviour to measure and every assertion ran after section A.
--
-- THIS ONE HAS A BEFORE. project_leads has rows right now, and the whole
-- point of T2 is that they are unchanged afterwards. So this file takes
-- its measurements in three stages:
--
--   1. BEFORE SECTION A - capture the live row count, the open/closed
--      split, AND a per-row signature. Nothing has been altered yet.
--   2. SECTION A - apply 098 inside this transaction.
--   3. T2 RUNS IMMEDIATELY, BEFORE ANY TEST WRITE, and compares. That
--      ordering is what makes T2 unambiguous: at the moment it runs, the
--      only thing that has happened to the table is 098 itself.
--
-- >>> T2 IS WRITTEN AGAINST THE ACTUAL COUNT, WHATEVER IT IS. It does
-- >>> not assume two rows, or any number. A handover recorded between
-- >>> now and when this is run changes the count, and a test that
-- >>> reasoned from a remembered number would then be asserting a stale
-- >>> fact. The count is read at runtime and echoed in the report.
--
-- =====================================================================
-- THIS ONE IMPERSONATES. IT HAS TO. AND IT IMPERSONATES THREE PEOPLE.
-- =====================================================================
--
-- Run as the table owner or the service role and RLS is bypassed, every
-- write below succeeds, and the file reports a clean fourteen-for-
-- fourteen while measuring almost nothing.
--
-- Every write assertion sets both JWT GUCs and SET LOCAL ROLE
-- authenticated first. THREE ACTORS, EACH WITH THEIR OWN CLAIMS BLOB:
--
--   the MEMBER    - a member of the subject project's organization
--   the OUTSIDER  - a profile in no organization on this partnership
--   the VENDOR    - >>> a member of the VENDOR side of the SAME
--                   partnership the member's organization leads. This
--                   actor exists only in this file and only for T8 and
--                   T9, which are the security boundary of 098.
--
-- T1 is the control that proves impersonation took at all.
--
-- =====================================================================
-- HOW TO RUN IT
-- =====================================================================
--
--   1. Paste THIS ENTIRE FILE into one Supabase SQL Editor tab.
--   2. Run it ONCE, as one statement batch. Do NOT run it in pieces.
--   3. READ THE ERROR MESSAGE. That is where the result is.
--
-- =====================================================================
-- >>> THIS FILE ENDS IN AN ERROR. THE ERROR IS THE RESULT.        <<<
-- >>> A RUN THAT DOES **NOT** ERROR MEANS SOMETHING WENT WRONG.   <<<
-- =====================================================================
--
-- The DO block finishes with RAISE EXCEPTION carrying the whole report.
-- A correct, healthy, everything-worked run looks like a red error box
-- with a multi-line message in it. That is not a failure. That IS the
-- output, and the verdict is the first line of it.
--
-- WHY IT HAS TO BE AN ERROR. This is the mechanism established in
-- docs/091-preapply-test.sql and re-used by 092, 094, 096 and 097. It is
-- the THIRD one tried and the first two were dead ends against this
-- exact client:
--
--   RAISE NOTICE - the Supabase SQL Editor has no Messages panel and does
--   not render notices at all. Every assertion runs and the editor says
--   "Success. No rows returned".
--
--   A TEMP TABLE AND A FINAL SELECT - the editor returns 3F000 schema
--   "pg_temp" does not exist. That session has no temp namespace, so no
--   results table can exist in it under any spelling.
--
-- DO NOT INVENT A FOURTH. An error is the one channel every SQL client
-- displays, and it aborts the transaction, which is the same outcome the
-- ROLLBACK at the foot was always there to produce.
--
-- WHAT THE ERROR LOOKS LIKE. Verdict first, tally second, per-assertion
-- lines last, because a client that truncates a long message truncates
-- the END of it:
--
--     ERROR:  P0001
--     =====================================================
--     SAFE TO APPLY 098.  All 14 assertions passed.
--     =====================================================
--     assertions run  : 14   (expected 14)
--     PASS            : 14   (expected 14)
--     FAIL            : 0    (expected 0)
--     INCONCLUSIVE    : 0    (expected 0)
--     verdicts logged : 14   (must equal assertions run: OK)
--     ... subjects ...
--     VERDICT         : SAFE TO APPLY 098.
--     -----------------------------------------------------
--       T1  control: member sees own project      PASS   ...
--       ... thirteen more ...
--     =====================================================
--
-- READ THE FIRST LINE AND NOTHING ELSE IF YOU READ NOTHING ELSE:
--
--     "SAFE TO APPLY 098."        -> and only this - apply it.
--     "DO NOT APPLY 098."         -> an assertion FAILED, or the test
--                                    itself is broken. Do not apply.
--     "DO NOT APPLY 098 YET."     -> INCONCLUSIVE. Nothing failed, but an
--                                    assertion could not be exercised, so
--                                    the run says NOTHING about the thing
--                                    it was meant to prove. IT IS NOT A
--                                    GREEN LIGHT.
--
-- >>> "Success. No rows returned" MEANS THE RUN DID NOT WORK. <<<
--
-- If you see it, the DO block did not reach its RAISE.
--
-- =====================================================================
-- THE ASSERTION MOST LIKELY TO COME BACK INCONCLUSIVE, AND WHY THAT IS
-- NOT A PASS
-- =====================================================================
--
-- T8 AND T9 NEED A VENDOR-SIDE MEMBER OF THE SAME PARTNERSHIP. That
-- requires a partnership whose vendor_org_id is NOT NULL and whose
-- vendor organization has a member who is not also on the lead side.
--
-- 079 PHASE 8 measured partnerships.vendor_org_id as 27 of 31 rows NULL
-- (079_organizations.sql:952) - the pre-claim ghost-row state. SO THIS
-- SUBJECT MAY GENUINELY NOT EXIST IN THIS DATABASE.
--
-- If it does not, T8 and T9 report INCONCLUSIVE and the headline says DO
-- NOT APPLY YET. THAT IS CORRECT AND MUST NOT BE OVERRIDDEN BY EDITING
-- THIS FILE. It means the one defect 098 was written to prevent - a
-- vendor tagging their own staff onto the agency's ownership record -
-- has not been demonstrated to be prevented. Greg's options are to claim
-- a vendor row in a non-production copy and re-run, or to apply 098
-- knowing that specific boundary is argued but unmeasured. That is his
-- call and it should be made explicitly, not by a green headline that
-- was never earned.
--
-- =====================================================================
-- CONTAMINATION, AND THE ORDER THAT AVOIDS IT
-- =====================================================================
--
-- Every assertion runs in ONE transaction, so each one's writes are
-- visible to the next. The order below is chosen so that no assertion
-- depends on a row a later one destroys:
--
--   T2  runs before ANY write, so its signature sees only 098's effect.
--   T3  creates the open lead and the contributor row.
--   T4  collides with T3's lead. It writes nothing that survives.
--   T5  performs the handover and reads T3's two row ids by id, not by
--       predicate, so nothing later can confuse it.
--   T10/T11 attempt to change T3's contributor row and MUST fail; if
--       either succeeded it would corrupt nothing after it, because
--       nothing after it reads that row.
--   T12/T13 attempt to change T7's tag row for the same reason.
--
-- SECTION A CARRIES DROP POLICY IF EXISTS FOR THE TWO NEW POLICIES so
-- that a re-run against an already-applied 098 measures something
-- instead of raising 42710.
-- =====================================================================


BEGIN;


DO $test$
DECLARE
  -- subjects, project side
  v_project        uuid;
  v_project_name   text;
  v_org            uuid;
  v_member         uuid;
  v_member2        uuid;
  v_outsider       uuid;
  -- subjects, partnership side
  v_partnership    uuid;
  v_lead_org       uuid;
  v_vendor_org     uuid;
  v_lead_member    uuid;
  v_vendor_member  uuid;
  -- machinery
  v_claims_member  text;
  v_claims_outsid  text;
  v_claims_vendor  text;
  v_claims_leadmem text;
  v_rows           integer;
  v_count          integer;
  v_contrib        uuid;
  v_contrib_note   text;
  v_lead_row_id    uuid;
  v_contrib_row_id uuid;
  v_owner_row_id   uuid;
  v_lead_ended     timestamptz;
  v_contrib_ended  timestamptz;
  v_open_leads     integer;
  v_open_user      uuid;
  -- the BEFORE measurements, captured before section A runs
  v_pre_total      integer;
  v_pre_open       integer;
  v_pre_closed     integer;
  v_pre_sig        text;
  v_post_total     integer;
  v_post_open      integer;
  v_post_nonlead   integer;
  v_post_nullrole  integer;
  v_post_sig       text;
  v_pre_existing   boolean;
  v_097_applied    boolean;
  v_grants         text;
  v_policies_before integer;
  v_policies_after  integer;
  v_pass           integer := 0;
  v_fail           integer := 0;
  v_inconc         integer := 0;
  v_ran            integer := 0;
  v_verdict_text   text;
  v_lines          text := '';
  v_logged         integer := 0;
  v_headline       text;
  v_report         text;
BEGIN

  -- ===================================================================
  -- PRECONDITION. 097 MUST ALREADY BE APPLIED.
  --
  -- Everything below alters objects 097 created. If they are absent this
  -- file would report a wall of confusing failures about a table that
  -- was never there, so it stops with one sentence instead.
  -- ===================================================================
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'project_leads'
  ) INTO v_097_applied;

  IF NOT v_097_applied THEN
    RAISE EXCEPTION E'\n=====================================================\nCANNOT RUN. 097 IS NOT APPLIED.\n=====================================================\npublic.project_leads does not exist, and 098 alters it. Apply\nsupabase/migrations/097_project_leads.sql first, then run this file.\nNOTHING WAS CHANGED.\n';
  END IF;

  SELECT count(*) INTO v_policies_before FROM pg_policies WHERE schemaname = 'public';

  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'partnership_owners'
  ) INTO v_pre_existing;

  -- ===================================================================
  -- >>> THE BEFORE MEASUREMENT. CAPTURED BEFORE SECTION A ALTERS
  -- >>> ANYTHING, AND BEFORE THIS FILE WRITES ANY ROW.
  --
  -- The signature is per-row, not just a count: md5 over every row's id
  -- paired with its open/closed state, ordered by id. A count alone
  -- would miss one row being closed while another was opened. This
  -- catches it.
  -- ===================================================================
  SELECT count(*),
         count(*) FILTER (WHERE ended_at IS NULL),
         count(*) FILTER (WHERE ended_at IS NOT NULL),
         COALESCE(md5(string_agg(
             id::text || ':' || CASE WHEN ended_at IS NULL THEN 'open' ELSE 'closed' END,
             ',' ORDER BY id)), 'EMPTY')
    INTO v_pre_total, v_pre_open, v_pre_closed, v_pre_sig
  FROM public.project_leads;

  -- ===================================================================
  -- SECTION A. 098 APPLIED, INSIDE THIS TRANSACTION.
  -- Kept in step with supabase/migrations/098_project_roles_and_vendor_tags.sql
  -- EXCEPT for the two DROP POLICY IF EXISTS lines. See the header.
  -- ===================================================================
  RESET ROLE;

  ALTER TABLE public.project_leads
    ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'lead';

  ALTER TABLE public.project_leads
    DROP CONSTRAINT IF EXISTS project_leads_role_valid;

  ALTER TABLE public.project_leads
    ADD CONSTRAINT project_leads_role_valid
    CHECK (role IN ('lead', 'contributor'));

  DROP INDEX IF EXISTS public.project_leads_one_open_per_project;

  CREATE UNIQUE INDEX project_leads_one_open_per_project
    ON public.project_leads (project_id)
    WHERE ended_at IS NULL AND role = 'lead';

  CREATE OR REPLACE FUNCTION public.set_project_lead(p_project_id uuid, p_user_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $writer$
  DECLARE
    v_uid      uuid        := auth.uid();
    v_now      timestamptz := now();
    v_org_id   uuid;
    v_open_id  uuid;
    v_previous uuid;
    v_new_id   uuid;
  BEGIN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'You must be signed in to set a point person.'
        USING ERRCODE = 'LG002';
    END IF;

    IF p_project_id IS NULL OR p_user_id IS NULL THEN
      RAISE EXCEPTION 'Choose a project and a point person.'
        USING ERRCODE = 'LG006';
    END IF;

    SELECT pr.org_id INTO v_org_id
    FROM public.projects pr
    WHERE pr.id = p_project_id
      AND pr.org_id IN (
        SELECT m.org_id FROM public.org_members m WHERE m.user_id = v_uid
      );

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'That is not a project you can change.'
        USING ERRCODE = 'LG011';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.user_id = p_user_id
        AND m.org_id  = v_org_id
    ) THEN
      RAISE EXCEPTION 'That person is not on the team that owns this project.'
        USING ERRCODE = 'LG010';
    END IF;

    SELECT l.id, l.user_id INTO v_open_id, v_previous
    FROM public.project_leads l
    WHERE l.project_id = p_project_id
      AND l.ended_at IS NULL
      AND l.role = 'lead'
    FOR UPDATE;

    IF v_open_id IS NOT NULL AND v_previous IS NOT DISTINCT FROM p_user_id THEN
      RETURN jsonb_build_object(
        'project_id',       p_project_id,
        'user_id',          p_user_id,
        'previous_user_id', v_previous,
        'lead_id',          v_open_id,
        'changed',          false
      );
    END IF;

    IF v_open_id IS NOT NULL THEN
      UPDATE public.project_leads
         SET ended_at = v_now
       WHERE id = v_open_id
         AND role = 'lead';
    END IF;

    INSERT INTO public.project_leads (project_id, user_id, started_at, role)
    VALUES (p_project_id, p_user_id, v_now, 'lead')
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
      'project_id',       p_project_id,
      'user_id',          p_user_id,
      'previous_user_id', v_previous,
      'lead_id',          v_new_id,
      'changed',          true
    );
  END;
  $writer$;

  ALTER POLICY "project_leads_org_update"
    ON public.project_leads
    USING (
      role = 'lead'
      AND project_id IN (
        SELECT pr.id FROM public.projects pr
        WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
    WITH CHECK (
      role = 'lead'
      AND project_id IN (
        SELECT pr.id FROM public.projects pr
        WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

  CREATE TABLE IF NOT EXISTS public.partnership_owners (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    partnership_id uuid        NOT NULL
                               REFERENCES public.partnerships(id) ON DELETE CASCADE,
    user_id        uuid        NOT NULL
                               REFERENCES public.profiles(id) ON DELETE CASCADE,
    added_by       uuid        NULL
                               REFERENCES public.profiles(id) ON DELETE SET NULL,
    added_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT partnership_owners_one_per_person
      UNIQUE (partnership_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS partnership_owners_user_idx
    ON public.partnership_owners (user_id);

  CREATE OR REPLACE FUNCTION public.partnership_owners_guard_membership()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $guard$
  DECLARE
    v_lead_org_id uuid;
  BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.user_id        IS NOT DISTINCT FROM OLD.user_id
       AND NEW.partnership_id IS NOT DISTINCT FROM OLD.partnership_id THEN
      RETURN NEW;
    END IF;

    SELECT p.lead_org_id INTO v_lead_org_id
    FROM public.partnerships p
    WHERE p.id = NEW.partnership_id;

    IF v_lead_org_id IS NULL THEN
      RETURN NEW;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.user_id = NEW.user_id
        AND m.org_id  = v_lead_org_id
    ) THEN
      RAISE EXCEPTION 'That person is not on the team that owns this vendor relationship.'
        USING ERRCODE = 'LG012';
    END IF;

    RETURN NEW;
  END;
  $guard$;

  DROP TRIGGER IF EXISTS partnership_owners_membership_guard ON public.partnership_owners;

  CREATE TRIGGER partnership_owners_membership_guard
    BEFORE INSERT OR UPDATE ON public.partnership_owners
    FOR EACH ROW
    EXECUTE FUNCTION public.partnership_owners_guard_membership();

  REVOKE EXECUTE ON FUNCTION public.partnership_owners_guard_membership() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.partnership_owners_guard_membership() FROM anon;
  REVOKE EXECUTE ON FUNCTION public.partnership_owners_guard_membership() FROM authenticated;

  ALTER TABLE public.partnership_owners ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "partnership_owners_lead_select" ON public.partnership_owners;
  DROP POLICY IF EXISTS "partnership_owners_lead_insert" ON public.partnership_owners;

  CREATE POLICY "partnership_owners_lead_select"
    ON public.partnership_owners AS PERMISSIVE FOR SELECT TO authenticated
    USING (partnership_id IN (
      SELECT p.id FROM public.partnerships p
      WHERE p.lead_org_id IN (SELECT public.current_user_org_ids())));

  CREATE POLICY "partnership_owners_lead_insert"
    ON public.partnership_owners AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (
      added_by = auth.uid()
      AND partnership_id IN (
        SELECT p.id FROM public.partnerships p
        WHERE p.lead_org_id IN (SELECT public.current_user_org_ids())));

  SELECT count(*) INTO v_policies_after FROM pg_policies WHERE schemaname = 'public';

  v_grants := format('project_leads: SELECT=%s INSERT=%s UPDATE=%s DELETE=%s | partnership_owners: SELECT=%s INSERT=%s UPDATE=%s DELETE=%s',
    has_table_privilege('authenticated', 'public.project_leads', 'SELECT'),
    has_table_privilege('authenticated', 'public.project_leads', 'INSERT'),
    has_table_privilege('authenticated', 'public.project_leads', 'UPDATE'),
    has_table_privilege('authenticated', 'public.project_leads', 'DELETE'),
    has_table_privilege('authenticated', 'public.partnership_owners', 'SELECT'),
    has_table_privilege('authenticated', 'public.partnership_owners', 'INSERT'),
    has_table_privilege('authenticated', 'public.partnership_owners', 'UPDATE'),
    has_table_privilege('authenticated', 'public.partnership_owners', 'DELETE'));

  -- ===================================================================
  -- >>> T2 FIRST, BEFORE ANY SUBJECT RESOLUTION OR ANY WRITE.
  --
  -- THE MOST IMPORTANT ASSERTION IN THIS FILE. 098 alters a live table
  -- and the handover recorded on project 5473ceeb must still read
  -- correctly afterwards. At this instant the only thing that has
  -- happened to project_leads is section A, so any difference is 098's.
  --
  -- It is numbered T2 to keep the control at T1, but it RUNS FIRST.
  -- ===================================================================
  v_ran := v_ran + 1;
  SELECT count(*),
         count(*) FILTER (WHERE ended_at IS NULL),
         count(*) FILTER (WHERE role IS DISTINCT FROM 'lead'),
         count(*) FILTER (WHERE role IS NULL),
         COALESCE(md5(string_agg(
             id::text || ':' || CASE WHEN ended_at IS NULL THEN 'open' ELSE 'closed' END,
             ',' ORDER BY id)), 'EMPTY')
    INTO v_post_total, v_post_open, v_post_nonlead, v_post_nullrole, v_post_sig
  FROM public.project_leads;

  IF v_pre_total = 0 THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T2  EVERY PRE-EXISTING ROW SURVIVES', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: project_leads is EMPTY, so the ALTER had no live data to preserve and this assertion proved nothing. If the row count really is zero this is expected and 098 is safe on that count - but it has NOT been demonstrated. Run the Phase 0 count query and confirm zero before treating this as harmless.';
    v_inconc := v_inconc + 1;
  ELSIF v_post_total = v_pre_total
    AND v_post_open  = v_pre_open
    AND v_post_nonlead = 0
    AND v_post_nullrole = 0
    AND v_post_sig = v_pre_sig THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T2  EVERY PRE-EXISTING ROW SURVIVES', 46) || rpad('PASS', 14)
      || format('all %s row(s) intact - %s open / %s closed unchanged, every row role=''lead'', zero NULL roles, per-row signature identical', v_pre_total, v_pre_open, v_pre_closed);
    v_pass := v_pass + 1;
  ELSE
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T2  EVERY PRE-EXISTING ROW SURVIVES', 46) || rpad('FAIL', 14)
      || format('THE LIVE LEADERSHIP HISTORY CHANGED. before: %s rows (%s open) sig %s | after: %s rows (%s open) sig %s | rows with role<>''lead'': %s | rows with NULL role: %s. DO NOT APPLY.',
                v_pre_total, v_pre_open, left(v_pre_sig,8), v_post_total, v_post_open, left(v_post_sig,8), v_post_nonlead, v_post_nullrole);
    v_fail := v_fail + 1;
  END IF;

  -- ===================================================================
  -- SUBJECT RESOLUTION. ALL OF IT, BEFORE ANY REMAINING ASSERTION.
  --
  -- A project whose organization has members and which carries NO
  -- leadership rows already, so T3's and T5's row arithmetic is this
  -- file's own writes and nothing else. The ORDER BY prefers the biggest
  -- organization, which is what makes a second member available.
  -- ===================================================================
  SELECT pr.id, pr.name, pr.org_id
    INTO v_project, v_project_name, v_org
  FROM public.projects pr
  WHERE EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = pr.org_id)
    AND NOT EXISTS (SELECT 1 FROM public.project_leads l WHERE l.project_id = pr.id)
  ORDER BY (SELECT count(*) FROM public.org_members m WHERE m.org_id = pr.org_id) DESC,
           pr.id
  LIMIT 1;

  IF v_org IS NOT NULL THEN
    SELECT m.user_id INTO v_member
    FROM public.org_members m WHERE m.org_id = v_org
    ORDER BY m.user_id LIMIT 1;

    SELECT m.user_id INTO v_member2
    FROM public.org_members m WHERE m.org_id = v_org AND m.user_id <> v_member
    ORDER BY m.user_id LIMIT 1;

    SELECT p.id INTO v_outsider
    FROM public.profiles p
    WHERE NOT EXISTS (SELECT 1 FROM public.org_members m
                      WHERE m.org_id = v_org AND m.user_id = p.id)
      AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.user_id = p.id)
    ORDER BY p.id LIMIT 1;

    IF v_outsider IS NULL THEN
      SELECT p.id INTO v_outsider
      FROM public.profiles p
      WHERE NOT EXISTS (SELECT 1 FROM public.org_members m
                        WHERE m.org_id = v_org AND m.user_id = p.id)
      ORDER BY p.id LIMIT 1;
    END IF;
  END IF;

  IF v_member2 IS NOT NULL THEN
    v_contrib      := v_member2;
    v_contrib_note := 'a SECOND member';
  ELSE
    v_contrib      := v_member;
    v_contrib_note := 'the SAME member as the lead - this organization has only one. The INDEX is still what T3 measures, but T5 cannot run.';
  END IF;

  -- ===================================================================
  -- THE PARTNERSHIP SUBJECT. THE ONE T8 AND T9 DEPEND ON.
  --
  -- Wanted: a partnership whose LEAD org has a member, AND whose VENDOR
  -- org has a member who is NOT also on the lead side. The second half
  -- is what makes T8 mean anything - a person on both sides would be
  -- admitted legitimately and would prove nothing about the boundary.
  --
  -- vendor_org_id is NULL on most rows in this database (079:952), so
  -- this may find nothing. That is reported, not worked around.
  -- ===================================================================
  SELECT p.id, p.lead_org_id, p.vendor_org_id
    INTO v_partnership, v_lead_org, v_vendor_org
  FROM public.partnerships p
  WHERE p.vendor_org_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p.lead_org_id)
    AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = p.vendor_org_id
        AND NOT EXISTS (SELECT 1 FROM public.org_members m2
                        WHERE m2.org_id = p.lead_org_id AND m2.user_id = m.user_id))
  ORDER BY p.id
  LIMIT 1;

  -- FALLBACK: a partnership with a usable LEAD side but no usable vendor
  -- side. T7 can still run; T8 and T9 cannot, and say so.
  IF v_partnership IS NULL THEN
    SELECT p.id, p.lead_org_id, p.vendor_org_id
      INTO v_partnership, v_lead_org, v_vendor_org
    FROM public.partnerships p
    WHERE EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p.lead_org_id)
    ORDER BY p.id
    LIMIT 1;
  END IF;

  -- A lead-side member who is NOT ALREADY TAGGED on this partnership.
  -- On a re-run against an already-applied 098 the live table may
  -- already hold a tag for the obvious candidate, and T7 would then hit
  -- 23505 from partnership_owners_one_per_person and report a FAIL that
  -- is really a re-run artefact. Preferring an untagged member avoids
  -- inventing a failure; if every member is tagged, v_lead_member stays
  -- NULL and T7 reports INCONCLUSIVE, which is the honest answer.
  IF v_lead_org IS NOT NULL THEN
    SELECT m.user_id INTO v_lead_member
    FROM public.org_members m
    WHERE m.org_id = v_lead_org
      AND NOT EXISTS (
        SELECT 1 FROM public.partnership_owners o
        WHERE o.partnership_id = v_partnership AND o.user_id = m.user_id)
    ORDER BY m.user_id LIMIT 1;
  END IF;

  IF v_vendor_org IS NOT NULL AND v_lead_org IS NOT NULL THEN
    SELECT m.user_id INTO v_vendor_member
    FROM public.org_members m
    WHERE m.org_id = v_vendor_org
      AND NOT EXISTS (SELECT 1 FROM public.org_members m2
                      WHERE m2.org_id = v_lead_org AND m2.user_id = m.user_id)
    ORDER BY m.user_id LIMIT 1;
  END IF;

  v_claims_member  := json_build_object('sub', COALESCE(v_member,        '00000000-0000-0000-0000-000000000000'::uuid)::text, 'role','authenticated')::text;
  v_claims_outsid  := json_build_object('sub', COALESCE(v_outsider,      '00000000-0000-0000-0000-000000000000'::uuid)::text, 'role','authenticated')::text;
  v_claims_leadmem := json_build_object('sub', COALESCE(v_lead_member,   '00000000-0000-0000-0000-000000000000'::uuid)::text, 'role','authenticated')::text;
  v_claims_vendor  := json_build_object('sub', COALESCE(v_vendor_member, '00000000-0000-0000-0000-000000000000'::uuid)::text, 'role','authenticated')::text;

  -- ===================================================================
  -- T1. THE CONTROL. The member reads their own project through RLS.
  -- If this fails, nothing below distinguishes a policy refusal from an
  -- impersonation that never took.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_member IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T1  control: member sees own project', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no project whose organization has a member AND no existing leadership rows. The harness is unverified and every project-side result below is ambiguous.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_member, true);
      PERFORM set_config('request.jwt.claim.sub', v_member::text,  true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_count FROM public.projects WHERE id = v_project;
      RESET ROLE;
      IF v_count = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T1  control: member sees own project', 46) || rpad('PASS', 14)
          || 'impersonation took and RLS lets the member read their own project';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T1  control: member sees own project', 46) || rpad('FAIL', 14)
          || format('the member could not read their own project (%s rows). The harness is broken; every result below is meaningless.', v_count);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T1  control: member sees own project', 46) || rpad('FAIL', 14)
        || format('%s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T3. >>> A CONTRIBUTOR SITS ALONGSIDE AN OPEN LEAD WITHOUT TRIPPING
  -- THE INDEX. If the index was recreated without its role clause this
  -- is where it shows, as 23505.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_member IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T3  contributor alongside open lead', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: see T1.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_member, true);
      PERFORM set_config('request.jwt.claim.sub', v_member::text,  true);
      SET LOCAL ROLE authenticated;

      -- Establish the open lead through the sanctioned writer, which also
      -- exercises the REPLACED function body.
      PERFORM public.set_project_lead(v_project, v_member);

      -- Then the contributor, inserted directly under the EXISTING
      -- insert policy - which is the point of 1(d): no new policy was
      -- added and this proves the old one already admits the row.
      INSERT INTO public.project_leads (project_id, user_id, role)
      VALUES (v_project, v_contrib, 'contributor');
      RESET ROLE;

      SELECT count(*) INTO v_count
      FROM public.project_leads
      WHERE project_id = v_project AND ended_at IS NULL;

      SELECT id INTO v_lead_row_id FROM public.project_leads
      WHERE project_id = v_project AND ended_at IS NULL AND role = 'lead';
      SELECT id INTO v_contrib_row_id FROM public.project_leads
      WHERE project_id = v_project AND ended_at IS NULL AND role = 'contributor';

      IF v_count = 2 AND v_lead_row_id IS NOT NULL AND v_contrib_row_id IS NOT NULL THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T3  contributor alongside open lead', 46) || rpad('PASS', 14)
          || format('2 open rows on one project - 1 lead, 1 contributor (%s). The two-part index permits it.', v_contrib_note);
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T3  contributor alongside open lead', 46) || rpad('FAIL', 14)
          || format('expected 2 open rows (1 lead + 1 contributor), found %s open; lead row %s, contributor row %s', v_count, COALESCE(v_lead_row_id::text,'MISSING'), COALESCE(v_contrib_row_id::text,'MISSING'));
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T3  contributor alongside open lead', 46) || rpad('FAIL', 14)
          || '23505 - THE INDEX REJECTED THE CONTRIBUTOR. project_leads_one_open_per_project was recreated WITHOUT its `AND role = ''lead''` clause, so every contributor collides with the lead. This is the exact failure 098 section 2 exists to avoid. DO NOT APPLY.';
        v_fail := v_fail + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T3  contributor alongside open lead', 46) || rpad('FAIL', 14)
          || format('%s: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T4. A SECOND OPEN LEAD IS STILL REFUSED. The index must have been
  -- narrowed, not disabled.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_lead_row_id IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T4  SECOND open lead still refused', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: T3 left no open lead to collide with, so a refusal here would prove nothing.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_member, true);
      PERFORM set_config('request.jwt.claim.sub', v_member::text,  true);
      SET LOCAL ROLE authenticated;

      INSERT INTO public.project_leads (project_id, user_id, role)
      VALUES (v_project, v_member, 'lead');
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  SECOND open lead still refused', 46) || rpad('FAIL', 14)
        || format('the insert SUCCEEDED (%s row). TWO OPEN LEADS NOW EXIST ON ONE PROJECT. The index was dropped and not recreated, or was recreated non-unique. DO NOT APPLY.', v_rows);
      v_fail := v_fail + 1;
    EXCEPTION
      WHEN unique_violation THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T4  SECOND open lead still refused', 46) || rpad('PASS', 14)
          || '23505 - the narrowed index still enforces one open lead per project';
        v_pass := v_pass + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T4  SECOND open lead still refused', 46) || rpad('FAIL', 14)
          || format('refused, but with %s rather than 23505: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T5. >>>> THE DEFECT ASSERTION. set_project_lead MUST CLOSE THE LEAD
  -- >>>> AND NOT A CONTRIBUTOR, AND THIS ASSERTS **WHICH** ROW ENDED.
  --
  -- The handover target is deliberately THE CONTRIBUTOR. That is the
  -- case the 097 body fails silently on: its locating SELECT matches
  -- every open row, and if SELECT INTO happens to take the contributor's
  -- row it finds user_id already equal to the target, returns
  -- changed=false, AND WRITES NOTHING - the handover does not happen and
  -- the interface reports success.
  --
  -- Asserting "one row ended" would pass on the wrong row. This asserts
  -- the lead row's ended_at IS NOT NULL, the contributor row's ended_at
  -- IS STILL NULL, and that the single open lead is now the target.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_lead_row_id IS NULL OR v_contrib_row_id IS NULL OR v_member2 IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T5  handover closes LEAD not contributor', 46) || rpad('INCONCLUSIVE', 14)
      || format('NO SUBJECT: needs a lead row, a contributor row AND a second distinct member. lead=%s contributor=%s second member=%s. THE DEFECT 098 FIXES IS UNTESTED BY THIS RUN.',
                COALESCE(v_lead_row_id::text,'none'), COALESCE(v_contrib_row_id::text,'none'), COALESCE(v_member2::text,'none'));
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_member, true);
      PERFORM set_config('request.jwt.claim.sub', v_member::text,  true);
      SET LOCAL ROLE authenticated;
      PERFORM public.set_project_lead(v_project, v_member2);
      RESET ROLE;

      SELECT ended_at INTO v_lead_ended    FROM public.project_leads WHERE id = v_lead_row_id;
      SELECT ended_at INTO v_contrib_ended FROM public.project_leads WHERE id = v_contrib_row_id;
      SELECT count(*) INTO v_open_leads
      FROM public.project_leads
      WHERE project_id = v_project AND ended_at IS NULL AND role = 'lead';
      SELECT user_id INTO v_open_user
      FROM public.project_leads
      WHERE project_id = v_project AND ended_at IS NULL AND role = 'lead';

      IF v_lead_ended IS NOT NULL
         AND v_contrib_ended IS NULL
         AND v_open_leads = 1
         AND v_open_user = v_member2 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T5  handover closes LEAD not contributor', 46) || rpad('PASS', 14)
          || format('the LEAD row %s was closed, the CONTRIBUTOR row %s is still open, and the single open lead is now the handover target', left(v_lead_row_id::text,8), left(v_contrib_row_id::text,8));
        v_pass := v_pass + 1;
      ELSIF v_contrib_ended IS NOT NULL THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T5  handover closes LEAD not contributor', 46) || rpad('FAIL', 14)
          || format('>>> THE CONTRIBUTOR ROW WAS CLOSED. set_project_lead closed the WRONG ROW - row %s ended at %s. Its locating SELECT is not filtered to role=''lead''. THIS IS THE DEFECT. DO NOT APPLY.', left(v_contrib_row_id::text,8), v_contrib_ended);
        v_fail := v_fail + 1;
      ELSIF v_lead_ended IS NULL THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T5  handover closes LEAD not contributor', 46) || rpad('FAIL', 14)
          || format('>>> THE LEAD ROW WAS NOT CLOSED AND NO ERROR WAS RAISED. set_project_lead almost certainly took the contributor row, found it already named the target, and returned changed=false having written nothing. THE HANDOVER SILENTLY DID NOT HAPPEN. open leads now: %s. DO NOT APPLY.', v_open_leads);
        v_fail := v_fail + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T5  handover closes LEAD not contributor', 46) || rpad('FAIL', 14)
          || format('lead ended=%s contributor ended=%s open leads=%s open lead user=%s expected=%s', v_lead_ended, v_contrib_ended, v_open_leads, COALESCE(v_open_user::text,'none'), v_member2);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T5  handover closes LEAD not contributor', 46) || rpad('FAIL', 14)
        || format('%s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T6. A NON-MEMBER IS REFUSED AS A CONTRIBUTOR. 097's guard is not
  -- changed by 098, and this proves it still covers the new row shape.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_member IS NULL OR v_outsider IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T6  NON-MEMBER refused as contributor', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no profile exists outside this organization, so the guard was never exercised.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_member, true);
      PERFORM set_config('request.jwt.claim.sub', v_member::text,  true);
      SET LOCAL ROLE authenticated;

      INSERT INTO public.project_leads (project_id, user_id, role)
      VALUES (v_project, v_outsider, 'contributor');
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T6  NON-MEMBER refused as contributor', 46) || rpad('FAIL', 14)
        || format('the insert SUCCEEDED (%s row). Somebody outside the organization was tagged as having worked on the project. DO NOT APPLY.', v_rows);
      v_fail := v_fail + 1;
    EXCEPTION
      WHEN SQLSTATE 'LG010' THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T6  NON-MEMBER refused as contributor', 46) || rpad('PASS', 14)
          || 'LG010 - 097''s guard refuses a contributor who is not on the team, unchanged by 098';
        v_pass := v_pass + 1;
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T6  NON-MEMBER refused as contributor', 46) || rpad('INCONCLUSIVE', 14)
          || '42501, not LG010. The INSERT POLICY refused before the guard ran, so this says nothing about the guard.';
        v_inconc := v_inconc + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T6  NON-MEMBER refused as contributor', 46) || rpad('FAIL', 14)
          || format('refused, but with %s rather than LG010: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T7. THE VENDOR TAG ADMITS A LEAD-SIDE MEMBER. The control for T8:
  -- without it, T8's refusal could just mean the table rejects everyone.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_lead_member IS NULL OR v_partnership IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T7  vendor tag ADMITS lead-side member', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no partnership whose lead organization has a member who is not already tagged on it. The whole vendor-tag layer is unexercised, and T9, T12 and T13 depend on the row T7 would have written.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_leadmem,   true);
      PERFORM set_config('request.jwt.claim.sub', v_lead_member::text, true);
      SET LOCAL ROLE authenticated;

      INSERT INTO public.partnership_owners (partnership_id, user_id, added_by)
      VALUES (v_partnership, v_lead_member, v_lead_member)
      RETURNING id INTO v_owner_row_id;
      RESET ROLE;

      IF v_owner_row_id IS NOT NULL THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T7  vendor tag ADMITS lead-side member', 46) || rpad('PASS', 14)
          || format('lead-side member tagged onto partnership %s', left(v_partnership::text,8));
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T7  vendor tag ADMITS lead-side member', 46) || rpad('FAIL', 14)
          || 'the insert returned no id';
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T7  vendor tag ADMITS lead-side member', 46) || rpad('FAIL', 14)
        || format('a legitimate lead-side tag was REFUSED with %s: %s. The policy or the guard is too narrow.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T8. >>>>> THE SECURITY BOUNDARY OF THIS MIGRATION. <<<<<
  --
  -- A member of the VENDOR side of THE SAME partnership must NOT be able
  -- to tag anybody onto the agency's ownership record. partnerships is
  -- two-sided and the vendor org can READ the partnership row (079's
  -- "Partners can view their partnerships"), so a policy scoped to "an
  -- org on this partnership" would admit them here.
  --
  -- EITHER LAYER REFUSING IS A PASS, and the line records WHICH:
  --   LG012 - the guard refused (it fires first, as a BEFORE trigger)
  --   42501 - the INSERT policy refused
  -- Both are scoped to lead_org_id. A SUCCESS is the defect.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_vendor_member IS NULL OR v_partnership IS NULL OR v_vendor_org IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T8  VENDOR-SIDE member REFUSED', 46) || rpad('INCONCLUSIVE', 14)
      || format('NO SUBJECT: found no partnership with a non-NULL vendor_org_id whose vendor organization has a member who is not also on the lead side (vendor_org=%s). 079:952 records vendor_org_id as NULL on 27 of 31 rows, so this is the expected shape of this database. >>> THE ONE DEFECT 098 WAS WRITTEN TO PREVENT IS THEREFORE ARGUED BUT UNMEASURED. This is not a pass. See the header.', COALESCE(v_vendor_org::text,'none'));
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_vendor,      true);
      PERFORM set_config('request.jwt.claim.sub', v_vendor_member::text, true);
      SET LOCAL ROLE authenticated;

      INSERT INTO public.partnership_owners (partnership_id, user_id, added_by)
      VALUES (v_partnership, v_vendor_member, v_vendor_member);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T8  VENDOR-SIDE member REFUSED', 46) || rpad('FAIL', 14)
        || format('>>> THE INSERT SUCCEEDED (%s row). A MEMBER OF THE VENDOR SIDE TAGGED THEMSELVES ONTO THE AGENCY''S OWNERSHIP RECORD FOR THAT SAME PARTNERSHIP. The policy or the guard is scoped to both sides instead of lead_org_id only. THIS IS THE DEFECT 098 EXISTS TO PREVENT. DO NOT APPLY.', v_rows);
      v_fail := v_fail + 1;
    EXCEPTION
      WHEN SQLSTATE 'LG012' THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T8  VENDOR-SIDE member REFUSED', 46) || rpad('PASS', 14)
          || 'LG012 - the GUARD refused. It derives the org from partnerships.lead_org_id, so a vendor-side member is not on the team that owns the relationship.';
        v_pass := v_pass + 1;
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T8  VENDOR-SIDE member REFUSED', 46) || rpad('PASS', 14)
          || '42501 - the INSERT POLICY refused. Its predicate names lead_org_id only, so the vendor side never matches.';
        v_pass := v_pass + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T8  VENDOR-SIDE member REFUSED', 46) || rpad('FAIL', 14)
          || format('refused, but with %s rather than LG012 or 42501: %s. Read it before treating this as safe.', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T9. THE READ HALF OF THE SAME BOUNDARY. The vendor side must not be
  -- able to SEE the agency's ownership list either. T7 left a row on
  -- this exact partnership, so there is something to fail to see.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_vendor_member IS NULL OR v_owner_row_id IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T9  VENDOR-SIDE member cannot READ tags', 46) || rpad('INCONCLUSIVE', 14)
      || format('NO SUBJECT: needs both a vendor-side member and T7''s row (vendor member=%s, T7 row=%s).', COALESCE(v_vendor_member::text,'none'), COALESCE(v_owner_row_id::text,'none'));
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_vendor,      true);
      PERFORM set_config('request.jwt.claim.sub', v_vendor_member::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_count
      FROM public.partnership_owners WHERE partnership_id = v_partnership;
      RESET ROLE;

      IF v_count = 0 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T9  VENDOR-SIDE member cannot READ tags', 46) || rpad('PASS', 14)
          || 'the vendor-side member sees 0 of the agency''s ownership rows on their own partnership';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T9  VENDOR-SIDE member cannot READ tags', 46) || rpad('FAIL', 14)
          || format('>>> the vendor-side member READ %s row(s) of the agency''s ownership list. The SELECT policy is scoped to both sides. DO NOT APPLY.', v_count);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  VENDOR-SIDE member cannot READ tags', 46) || rpad('FAIL', 14)
        || format('%s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T10. ADD-ONLY, VERB ONE OF TWO, PROJECT SIDE. A contributor row
  -- refuses UPDATE. RLS denies by default, so the expected outcome is
  -- ZERO ROWS AFFECTED AND NO ERROR - a silent no-op, not a refusal.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_contrib_row_id IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T10 contributor row refuses UPDATE', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: T3 left no contributor row.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_member, true);
      PERFORM set_config('request.jwt.claim.sub', v_member::text,  true);
      SET LOCAL ROLE authenticated;
      UPDATE public.project_leads SET ended_at = now() WHERE id = v_contrib_row_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      SELECT ended_at INTO v_contrib_ended FROM public.project_leads WHERE id = v_contrib_row_id;

      IF v_rows = 0 AND v_contrib_ended IS NULL THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T10 contributor row refuses UPDATE', 46) || rpad('PASS', 14)
          || '0 rows affected and the row is unchanged - project_leads_org_update is scoped to role = ''lead''';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T10 contributor row refuses UPDATE', 46) || rpad('FAIL', 14)
          || format('%s row(s) affected, ended_at now %s. A contributor tag was edited. The UPDATE policy was not narrowed. DO NOT APPLY.', v_rows, COALESCE(v_contrib_ended::text,'NULL'));
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T10 contributor row refuses UPDATE', 46) || rpad('PASS', 14)
        || format('refused outright with %s, which is at least as strict as the expected silent no-op', SQLSTATE);
      v_pass := v_pass + 1;
    END;
  END IF;

  -- ===================================================================
  -- T11. ADD-ONLY, VERB TWO OF TWO, PROJECT SIDE. Asserted SEPARATELY
  -- from T10 because add-only is two prohibitions, not one: a policy set
  -- can easily withhold one verb and grant the other.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_contrib_row_id IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T11 contributor row refuses DELETE', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: T3 left no contributor row.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_member, true);
      PERFORM set_config('request.jwt.claim.sub', v_member::text,  true);
      SET LOCAL ROLE authenticated;
      DELETE FROM public.project_leads WHERE id = v_contrib_row_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      SELECT count(*) INTO v_count FROM public.project_leads WHERE id = v_contrib_row_id;

      IF v_rows = 0 AND v_count = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T11 contributor row refuses DELETE', 46) || rpad('PASS', 14)
          || '0 rows affected and the row still exists - there is no DELETE policy on project_leads for anybody';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T11 contributor row refuses DELETE', 46) || rpad('FAIL', 14)
          || format('%s row(s) deleted, %s row(s) remain. A DELETE POLICY EXISTS ON project_leads. DO NOT APPLY.', v_rows, v_count);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T11 contributor row refuses DELETE', 46) || rpad('PASS', 14)
        || format('refused outright with %s, which is at least as strict as the expected silent no-op', SQLSTATE);
      v_pass := v_pass + 1;
    END;
  END IF;

  -- ===================================================================
  -- T12. ADD-ONLY, VERB ONE OF TWO, VENDOR TAG SIDE.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_owner_row_id IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T12 vendor tag refuses UPDATE', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: T7 left no tag row.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_leadmem,    true);
      PERFORM set_config('request.jwt.claim.sub', v_lead_member::text, true);
      SET LOCAL ROLE authenticated;
      UPDATE public.partnership_owners SET added_at = now() WHERE id = v_owner_row_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      IF v_rows = 0 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T12 vendor tag refuses UPDATE', 46) || rpad('PASS', 14)
          || '0 rows affected - there is no UPDATE policy on partnership_owners for anybody';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T12 vendor tag refuses UPDATE', 46) || rpad('FAIL', 14)
          || format('%s row(s) affected. AN UPDATE POLICY EXISTS ON partnership_owners. DO NOT APPLY.', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T12 vendor tag refuses UPDATE', 46) || rpad('PASS', 14)
        || format('refused outright with %s, which is at least as strict as the expected silent no-op', SQLSTATE);
      v_pass := v_pass + 1;
    END;
  END IF;

  -- ===================================================================
  -- T13. ADD-ONLY, VERB TWO OF TWO, VENDOR TAG SIDE. Separate from T12,
  -- for the same reason T11 is separate from T10.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_owner_row_id IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T13 vendor tag refuses DELETE', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: T7 left no tag row.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_leadmem,    true);
      PERFORM set_config('request.jwt.claim.sub', v_lead_member::text, true);
      SET LOCAL ROLE authenticated;
      DELETE FROM public.partnership_owners WHERE id = v_owner_row_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      SELECT count(*) INTO v_count FROM public.partnership_owners WHERE id = v_owner_row_id;

      IF v_rows = 0 AND v_count = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T13 vendor tag refuses DELETE', 46) || rpad('PASS', 14)
          || '0 rows affected and the row still exists - there is no DELETE policy on partnership_owners for anybody';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T13 vendor tag refuses DELETE', 46) || rpad('FAIL', 14)
          || format('%s row(s) deleted, %s remain. A DELETE POLICY EXISTS ON partnership_owners. DO NOT APPLY.', v_rows, v_count);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T13 vendor tag refuses DELETE', 46) || rpad('PASS', 14)
        || format('refused outright with %s, which is at least as strict as the expected silent no-op', SQLSTATE);
      v_pass := v_pass + 1;
    END;
  END IF;

  -- ===================================================================
  -- T14. THE POLICY COUNT MATCHES 098's PREDICTION.
  --
  -- 098 predicts 122: 120 today plus exactly the two partnership_owners
  -- policies. Part A adds none - it narrows an existing policy with
  -- ALTER POLICY, which does not move the count.
  --
  -- ON A RE-RUN against an already-applied 098 the BEFORE count is
  -- already 122 and the delta reads 0. The AFTER value is what is
  -- asserted, so the assertion holds either way.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_policies_after = 122 THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T14 policy count = 122 as predicted', 46) || rpad('PASS', 14)
      || format('%s before -> %s after (delta %s)', v_policies_before, v_policies_after, v_policies_after - v_policies_before);
    v_pass := v_pass + 1;
  ELSE
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T14 policy count = 122 as predicted', 46) || rpad('FAIL', 14)
      || format('expected 122, got %s (%s before, delta %s). 121 means only one of the two new policies was created; 123 means a third came from somewhere; 120 means neither ran. Find it before applying: SELECT tablename, policyname FROM pg_policies WHERE schemaname=''public'' ORDER BY 1,2;', v_policies_after, v_policies_before, v_policies_after - v_policies_before);
    v_fail := v_fail + 1;
  END IF;

  -- ===================================================================
  -- THE VERDICT.
  -- ===================================================================
  IF v_fail = 0 AND v_inconc = 0 THEN
    v_verdict_text := 'SAFE TO APPLY 098.';
    v_headline     := format('SAFE TO APPLY 098.  All %s assertions passed.', v_ran);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'INCONCLUSIVE. Not a green light.';
    v_headline     := format('DO NOT APPLY 098 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 098 does what it claims. It is not a green light. (If T8 and T9 are the inconclusive ones, this database has no partnership with a claimed vendor organization, and THE VENDOR-SIDE EXCLUSION - the one defect 098 exists to prevent - IS UNMEASURED. See the header.)', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline     := format('DO NOT APPLY 098.  %s assertion(s) FAILED.', v_fail);
  END IF;

  -- THE SELF-CHECK OVERRIDES THE HEADLINE. If an assertion ran without
  -- logging a line, the report is incomplete and no verdict drawn from it
  -- can be trusted, INCLUDING A CLEAN ONE.
  IF v_logged <> v_ran THEN
    v_headline := format('DO NOT APPLY 098.  THE TEST ITSELF IS BROKEN: %s assertions ran but %s logged a verdict. The report below is incomplete and no verdict drawn from it means anything.', v_ran, v_logged);
  END IF;

  -- ===================================================================
  -- THE REPORT. HEADLINE, THEN TALLY, THEN THE PER-ASSERTION LINES.
  -- A client that truncates a long error message truncates the END of
  -- it, so the verdict and the counts must be at the TOP.
  -- ===================================================================
  v_report :=
       E'\n'
    || E'=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected 14)\n', v_ran)
    || format(E'PASS            : %s   (expected 14)\n', v_pass)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0)\n', v_inconc)
    || format(E'verdicts logged : %s   (must equal assertions run: %s)\n',
              v_logged, CASE WHEN v_logged = v_ran THEN 'OK' ELSE 'MISMATCH' END)
    || E'\n'
    || format(E'>>> project_leads BEFORE 098: %s row(s) - %s open, %s closed\n',
              v_pre_total, v_pre_open, v_pre_closed)
    || format(E'    project_leads AFTER  098: %s row(s) - %s open, role<>lead: %s, NULL role: %s\n',
              v_post_total, v_post_open, v_post_nonlead, v_post_nullrole)
    || format(E'    per-row signature before/after: %s / %s  (%s)\n',
              left(v_pre_sig,12), left(v_post_sig,12),
              CASE WHEN v_pre_sig = v_post_sig THEN 'IDENTICAL' ELSE 'CHANGED - READ T2' END)
    || E'\n'
    || format(E'098 already applied?   : %s\n',
              CASE WHEN v_pre_existing THEN 'YES - partnership_owners already existed, so section A re-created its policies and T14''s delta reads 0' ELSE 'no - this is a first run' END)
    || format(E'authenticated grants   : %s\n', v_grants)
    || format(E'subject project        : %s  %s\n',
              COALESCE(v_project::text, 'NONE'), COALESCE(v_project_name, ''))
    || format(E'  owning organization  : %s\n', COALESCE(v_org::text, 'NONE'))
    || format(E'  member (actor)       : %s\n', COALESCE(v_member::text, 'NONE'))
    || format(E'  second member        : %s\n', COALESCE(v_member2::text, 'NONE - only one member in this organization'))
    || format(E'  contributor tagged   : %s  (%s)\n',
              COALESCE(v_contrib::text, 'NONE'), COALESCE(v_contrib_note, '-'))
    || format(E'  outsider             : %s\n', COALESCE(v_outsider::text, 'NONE - no profile outside this organization'))
    || format(E'subject partnership    : %s\n', COALESCE(v_partnership::text, 'NONE'))
    || format(E'  lead organization    : %s\n', COALESCE(v_lead_org::text, 'NONE'))
    || format(E'  lead-side member     : %s\n', COALESCE(v_lead_member::text, 'NONE'))
    || format(E'  vendor organization  : %s\n', COALESCE(v_vendor_org::text, 'NONE - vendor_org_id is NULL on this row'))
    || format(E'  VENDOR-SIDE member   : %s\n', COALESCE(v_vendor_member::text, 'NONE - T8 AND T9 COULD NOT RUN'))
    || format(E'policies before / after: %s / %s\n', v_policies_before, v_policies_after)
    || E'\n'
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'-----------------------------------------------------'
    || v_lines
    || E'\n=====================================================\n'
    || E'This error IS the result. The transaction is rolled back with it.\n';

  -- >>> THE RESULT ARRIVES AS AN ERROR, AND THAT IS THE DESIGN. <<<
  --
  -- NO CUSTOM ERRCODE. This is not a database condition and must never be
  -- mistaken for one of the LG0xx codes 089-093, 097 and 098 define. The
  -- default P0001 (raise_exception) is correct and deliberate.
  RAISE EXCEPTION '%', v_report;
END
$test$;


-- =====================================================================
-- THE BACKSTOP. IT STAYS.
--
-- IT IS NOT REACHED ON THE EXPECTED PATH. The DO block above ends in
-- RAISE EXCEPTION, the outer block has no handler, so the exception
-- propagates out, aborts the transaction, and every statement after it -
-- including this one - is skipped.
--
-- IT IS NOT DEAD CODE AND MUST NOT BE DELETED. It is the safety net for
-- the case where that exception is CAUGHT rather than propagated: an
-- enclosing EXCEPTION handler added here later, or a client that wraps
-- the batch in its own block and swallows the error.
--
-- >>> WHAT IS AT STAKE HERE IS LARGER THAN IT WAS IN 097's TEST. That
-- >>> file only created new objects. THIS ONE ALTERS A LIVE TABLE: at
-- >>> the moment of the RAISE this transaction holds project_leads WITH
-- >>> A NEW COLUMN, ITS UNIQUE INDEX DROPPED AND REBUILT, ITS UPDATE
-- >>> POLICY REWRITTEN, set_project_lead REPLACED, plus a new table, a
-- >>> new trigger, two new policies and several test rows. Without this
-- >>> ROLLBACK a swallowed exception would leave every one of those
-- >>> changes COMMITTED by a file whose header says it applies nothing.
-- =====================================================================
ROLLBACK;
