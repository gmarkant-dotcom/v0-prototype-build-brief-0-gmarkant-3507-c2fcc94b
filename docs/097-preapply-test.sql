-- =====================================================================
-- 097 PRE-APPLY TEST. ONE PASTE. CREATES, WRITES, THEN ROLLS BACK.
--
-- WHY THIS FILE EXISTS AND WHY IT IS NOT OPTIONAL.
--
-- A dry run of 097 proves the file parses and that CREATE TABLE does not
-- collide with anything. It says NOTHING about whether the membership
-- guard actually refuses an outsider, whether the partial unique index
-- actually permits a handover while refusing a second open lead, or
-- whether another organization can read the leadership history.
--
-- >>> 097 CREATES A TABLE WITH RLS AND A GUARD. That is a class of
-- >>> change where "it applied without error" is worth very little. A
-- >>> policy set that is too permissive raises no error, breaks no page
-- >>> and shows no red state anywhere. A partial index written without
-- >>> its WHERE clause applies perfectly and silently destroys the
-- >>> handover. The only way to find out is to write things through it
-- >>> and see which ones land.
--
-- =====================================================================
-- HOW THIS DIFFERS FROM 096's TEST, AND WHY
-- =====================================================================
--
-- 096's test proved the DEFECT before it proved the fix - T1 and T2 ran
-- against the live policy before anything was applied. THERE IS NO
-- EQUIVALENT HERE AND THERE CANNOT BE. 097's subject is a table that
-- does not exist yet, so there is no pre-097 behaviour to measure: every
-- statement against project_leads before section A would raise 42P01,
-- which proves only that the table is absent, which is the premise
-- rather than a finding.
--
-- So SECTION A RUNS FIRST and every assertion runs after it. Subject
-- resolution also runs after section A, because choosing a project with
-- no existing leadership rows requires reading the table.
--
-- =====================================================================
-- THIS ONE IMPERSONATES. IT HAS TO.
-- =====================================================================
--
-- Four of the nine assertions are about RLS, and one is about a SECURITY
-- DEFINER trigger that must refuse a row regardless of the caller. Run
-- as the table owner or the service role and RLS is bypassed, every
-- INSERT below succeeds, and the file reports a clean nine-for-nine
-- while measuring almost nothing.
--
-- Every write assertion sets both JWT GUCs and SET LOCAL ROLE
-- authenticated first. T1 is the control that proves the impersonation
-- took, and T6 is the control that proves RLS is IN FORCE rather than
-- merely present - if the outsider could see nothing because the whole
-- table were empty, T5 would already have failed.
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
-- WHY IT HAS TO BE AN ERROR. This is the third mechanism and the first
-- two were dead ends against this exact client - established in
-- docs/091-preapply-test.sql, re-used by 092, 094 and 096, and not
-- re-derived here:
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
--     SAFE TO APPLY 097.  All 9 assertions passed.
--     =====================================================
--     assertions run  : 9    (expected 9)
--     PASS            : 9    (expected 9)
--     FAIL            : 0    (expected 0)
--     INCONCLUSIVE    : 0    (expected 0)
--     verdicts logged : 9    (must equal assertions run: OK)
--     ... subjects ...
--     VERDICT         : SAFE TO APPLY 097.
--     -----------------------------------------------------
--       T1  control: member sees own project      PASS   ...
--       ... eight more ...
--     =====================================================
--
-- READ THE FIRST LINE AND NOTHING ELSE IF YOU READ NOTHING ELSE:
--
--     "SAFE TO APPLY 097."        -> and only this - apply it.
--     "DO NOT APPLY 097."         -> an assertion FAILED, or the test
--                                    itself is broken. Do not apply.
--     "DO NOT APPLY 097 YET."     -> INCONCLUSIVE. Nothing failed, but an
--                                    assertion could not be exercised, so
--                                    the run says NOTHING about the thing
--                                    it was meant to prove. IT IS NOT A
--                                    GREEN LIGHT.
--
-- >>> "Success. No rows returned" MEANS THE RUN DID NOT WORK. <<<
--
-- If you see it, the DO block did not reach its RAISE - most likely the
-- batch was run in pieces or the editor swallowed the error. You have
-- learned nothing about 097 and must not apply it on that basis.
--
-- IT LEAVES NOTHING BEHIND. Every statement below - the CREATE TABLE, the
-- indexes, both CREATE FUNCTIONs, the trigger, the three CREATE POLICYs
-- and every INSERT, UPDATE and DELETE - is inside one transaction, and
-- the RAISE EXCEPTION aborts it. PostgreSQL rolls back DDL, so afterwards
-- the database is byte-identical to before, whether 097 is applied or
-- not.
--
-- =====================================================================
-- IF 097 IS ALREADY APPLIED WHEN YOU RUN THIS
-- =====================================================================
--
-- It is still safe, and section A is written to be re-runnable: the table
-- is CREATE TABLE IF NOT EXISTS, the indexes are IF NOT EXISTS, both
-- functions are CREATE OR REPLACE, the trigger is DROP IF EXISTS then
-- CREATE, and THE THREE POLICIES ARE DROPPED IF EXISTS BEFORE BEING
-- CREATED.
--
-- >>> THOSE THREE `DROP POLICY IF EXISTS` LINES ARE THE ONE DELIBERATE
-- >>> DIFFERENCE BETWEEN SECTION A AND THE MIGRATION. The migration does
-- >>> not carry them, because a migration that drops a live policy before
-- >>> recreating it is exactly the DROP-then-CREATE hazard 096's header
-- >>> warns about. Here they are correct and necessary: without them a
-- >>> re-run raises 42710 and measures nothing, and the transaction is
-- >>> rolled back either way.
--
-- Section A is otherwise kept byte-identical to
-- supabase/migrations/097_project_leads.sql. If you change one, change
-- the other.
--
-- ON A RE-RUN AGAINST AN APPLIED 097, T9's DELTA READS 0 RATHER THAN 3 -
-- the three policies were dropped and recreated, so the count did not
-- move. That is reported and is not a failure. The ABSOLUTE count is
-- what T9 asserts, and it is 120 in both cases.
--
-- =====================================================================
-- WHAT THE NINE ASSERTIONS ARE
-- =====================================================================
--
--   T1  CONTROL: THE IMPERSONATION TOOK. A member of the subject
--       project's organization reads that project through RLS. PASS = 1
--       row. A FAIL means auth.uid() is NULL because neither JWT GUC
--       took, and every refusal below would then be ambiguous between
--       "the policy refused" and "there was nobody there".
--
--   T2  A MEMBER CAN BE MADE THE POINT PERSON. A member of the owning
--       organization inserts an open lead naming a member of that same
--       organization. PASS = SUCCEEDS, 1 row. A FAIL means the guard, the
--       INSERT policy or the table grants refuse the ordinary case and
--       the feature does not work at all.
--
--   T3  >>> A NON-MEMBER IS REFUSED. <<< Same member, same project,
--       naming somebody who is NOT in that organization. PASS = REFUSED
--       with LG010. THAT IS THE GUARD'S WHOLE PURPOSE: without it a
--       project can be handed to a person who is not on the team and the
--       vendor-pool filter built later lists a colleague who does not
--       exist. A SUCCESS here means the guard is absent, or is invoker
--       rights and read org_members through RLS, or is attached to the
--       wrong verb.
--
--   T4  A SECOND OPEN LEAD IS REFUSED. With T2's row still open, insert
--       another open lead on the same project. PASS = REFUSED with 23505
--       from project_leads_one_open_per_project. A SUCCESS means the
--       partial unique index is missing and R1 - one point person at a
--       time - is not enforced by anything.
--
--   T5  >>> A CLOSED LEAD DOES NOT BLOCK A NEW ONE. THIS IS R2. <<<
--       Stamp ended_at on the open row, then insert a new open one. PASS
--       = the UPDATE succeeds, the INSERT succeeds, AND the project now
--       carries TWO rows - one closed, one open. A FAIL with 23505 means
--       the index was created WITHOUT its `WHERE ended_at IS NULL`
--       clause, so the first handover is also the last and the history
--       Greg ruled for is impossible. A PASS that finds only ONE row
--       means the close overwrote instead of closing.
--
--   T6  ANOTHER ORGANIZATION CANNOT READ THESE ROWS. A member of a
--       different organization selects the subject project's leads. PASS
--       = 0 rows, WHILE T5 HAS JUST PROVED THERE ARE TWO. That pairing is
--       what makes this an RLS measurement rather than an empty table.
--
--   T7  ANOTHER ORGANIZATION CANNOT WRITE THESE ROWS. The same outsider
--       inserts a lead on the subject project, NAMING A REAL MEMBER OF
--       THE OWNING ORGANIZATION rather than themselves. PASS = REFUSED
--       (42501). A SUCCESS means the INSERT policy's predicate does not
--       scope to the project's organization.
--
--       WHY IT NAMES A MEMBER AND NOT THE OUTSIDER: BEFORE ROW triggers
--       run before RLS's WITH CHECK, so an outsider naming THEMSELVES is
--       refused LG010 by the guard and the policy is never reached. That
--       version of this test would report a refusal and measure the wrong
--       thing. Naming a legitimate member walks the row past the guard so
--       the policy is the only thing that can refuse it.
--
--   T8  THE HISTORY IS NOT ERASABLE. The owning member - the person with
--       the MOST access to these rows - deletes them. PASS = 0 rows
--       affected, because there is NO DELETE POLICY and RLS denies by
--       default. Anything other than 0 means a DELETE policy exists and
--       R2 is not enforced.
--
--       NOTE THE SHAPE OF THIS ONE: a refused DELETE under RLS does not
--       raise. It matches zero rows and reports success. That is why this
--       asserts ROW_COUNT rather than catching an exception, and it is
--       also why the property needs a test at all - nothing about it is
--       visible from the outside.
--
--   T9  THE POLICY COUNT MATCHES THE PREDICTION. READ-ONLY. PASS = 120
--       after section A. The delta from before section A is reported
--       separately: 3 on a first run, 0 on a re-run against an applied
--       097.
--
-- EVERY REFUSAL TEST RUNS IN ITS OWN plpgsql SUBTRANSACTION, so an
-- expected LG010 or 23505 or 42501 does not abort the run. That is what
-- lets all nine assertions report from a single paste.
--
-- =====================================================================
-- SUBJECTS ARE SELECTED, NOT HARDCODED. AND A MISSING ONE IS NEVER PASS.
-- =====================================================================
--
-- No id is written into this file. Every subject is resolved by query
-- immediately after section A and before any assertion runs, so no
-- assertion can select a row a later one has altered.
--
-- IF A SUBJECT CANNOT BE FOUND, THE ASSERTIONS THAT NEED IT REPORT
-- INCONCLUSIVE WITH THE REASON. NEVER PASS. An assertion that could not
-- find anything to act on has proved nothing, and a green line for it
-- would be a lie about coverage. The three that can go missing:
--
--   NO PROJECT whose organization has at least one member -> T1 through
--   T8 are all inconclusive and the run says nothing.
--
--   NO SECOND MEMBER of that organization -> T5 hands the project back to
--   the SAME person. That still proves what T5 exists to prove, because
--   the assertion is about the partial index and not about who is named,
--   and the report says which was used.
--
--   NO OUTSIDER - no profile outside the subject organization -> T3, T6
--   and T7 are inconclusive. On a database with one organization this is
--   expected, and it means the isolation half of 097 is UNTESTED here.
--
-- CONTAMINATION BETWEEN ASSERTIONS, GUARDED THREE WAYS:
--
--   1. THE SUBJECT PROJECT HAS NO EXISTING LEADERSHIP ROWS. Selected that
--      way, so T5's "exactly two rows" count is this file's own writes
--      and nothing else. On a first run every project qualifies.
--
--   2. NOTHING HERE WRITES TO projects, profiles, org_members OR
--      organizations. The only writes are to project_leads.
--
--   3. T8's DELETE RUNS LAST OF THE WRITES, after T5's count has already
--      been taken. If it ever started matching rows it would destroy the
--      evidence for T5, so its position is deliberate rather than
--      incidental.
--
-- =====================================================================
-- THE GRANT PROBE, AND WHY IT IS NOT AN ASSERTION
-- =====================================================================
--
-- 097 issues no table-level GRANT, matching every other table in this
-- schema: Supabase's default privileges give anon, authenticated and
-- service_role table rights on new tables in public, which is why 080's
-- milestone_events and 086's org_invitations work live without one.
--
-- If that default is absent for any reason, T2 fails with 42501 and it
-- looks exactly like a policy refusal. So the privileges are PROBED and
-- printed in the report header, read-only, and NOT counted as an
-- assertion - they measure the Supabase project's defaults, not 097.
--
-- >>> IF T2 FAILS WITH 42501, READ THE `authenticated grants` LINE FIRST.
--
-- =====================================================================
-- TWO IMPLEMENTATION NOTES, BOTH INHERITED FROM 092, 094 AND 096
-- =====================================================================
--
--   BOTH JWT GUCs ARE SET, not one. Supabase's auth.uid() has shipped in
--   two forms - one reading request.jwt.claim.sub, one reading
--   request.jwt.claims ->> 'sub'. Setting only the form this session
--   guessed at would leave auth.uid() NULL, every write would be refused,
--   and T3 and T7 would report PASS against policies never reached. T1 is
--   the control that catches exactly that.
--
--   IF YOUR EDITOR REJECTS `SET LOCAL ROLE authenticated` inside the DO
--   block, replace every occurrence with
--   `PERFORM set_config('role', 'authenticated', true);` and every
--   `RESET ROLE;` with `PERFORM set_config('role', 'none', true);`.
--   They are equivalent - `role` is an ordinary GUC.
-- =====================================================================


BEGIN;


DO $test$
DECLARE
  -- subjects
  v_project        uuid;
  v_project_name   text;
  v_org            uuid;
  v_member         uuid;
  v_member2        uuid;
  v_handover_to    uuid;
  v_handover_note  text;
  v_outsider       uuid;
  -- machinery
  -- ONE CLAIMS BLOB PER ACTOR. The `sub` claim MUST name the actor: one
  -- shipped form of auth.uid() reads request.jwt.claims ->> 'sub' and the
  -- other reads request.jwt.claim.sub, so BOTH are set for BOTH actors and
  -- both carry the same id. A single shared blob would leave auth.uid()
  -- NULL for whichever actor it did not name, and T3 and T7 would then
  -- report PASS against policies that were never reached.
  v_claims_member  text;
  v_claims_outsid  text;
  v_rows           integer;
  v_count          integer;
  v_open_id        uuid;
  v_pre_existing   boolean;
  v_grants         text;
  v_policies_before integer;
  v_policies_after  integer;
  v_pass           integer := 0;
  v_fail           integer := 0;
  v_inconc         integer := 0;
  v_ran            integer := 0;
  v_verdict_text   text;
  -- THE ACCUMULATOR AND ITS COUNTER. v_lines holds one line per
  -- assertion, appended in the order they run. v_logged counts them and
  -- is checked against v_ran at the foot - see THE SELF-CHECK there.
  v_lines          text := '';
  v_logged         integer := 0;
  v_headline       text;
  v_report         text;
BEGIN

  SELECT count(*) INTO v_policies_before FROM pg_policies WHERE schemaname = 'public';

  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'project_leads'
  ) INTO v_pre_existing;

  -- ===================================================================
  -- SECTION A. 097 APPLIED, INSIDE THIS TRANSACTION.
  -- Kept byte-identical to supabase/migrations/097_project_leads.sql
  -- EXCEPT for the three DROP POLICY IF EXISTS lines, which exist only so
  -- that a re-run against an already-applied 097 measures something
  -- instead of raising 42710. See the header.
  -- ===================================================================
  RESET ROLE;

  CREATE TABLE IF NOT EXISTS public.project_leads (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid        NOT NULL
                            REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id     uuid        NULL
                            REFERENCES public.profiles(id) ON DELETE SET NULL,
    started_at  timestamptz NOT NULL DEFAULT now(),
    ended_at    timestamptz NULL,
    CONSTRAINT project_leads_interval_ordered
      CHECK (ended_at IS NULL OR ended_at >= started_at)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS project_leads_one_open_per_project
    ON public.project_leads (project_id)
    WHERE ended_at IS NULL;

  CREATE INDEX IF NOT EXISTS project_leads_project_started_idx
    ON public.project_leads (project_id, started_at DESC);

  CREATE INDEX IF NOT EXISTS project_leads_user_idx
    ON public.project_leads (user_id)
    WHERE user_id IS NOT NULL;

  CREATE OR REPLACE FUNCTION public.project_leads_guard_membership()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $guard$
  DECLARE
    v_org_id uuid;
  BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.user_id    IS NOT DISTINCT FROM OLD.user_id
       AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
      RETURN NEW;
    END IF;

    IF NEW.user_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT pr.org_id INTO v_org_id
    FROM public.projects pr
    WHERE pr.id = NEW.project_id;

    IF v_org_id IS NULL THEN
      RETURN NEW;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.user_id = NEW.user_id
        AND m.org_id  = v_org_id
    ) THEN
      RAISE EXCEPTION 'That person is not on the team that owns this project.'
        USING ERRCODE = 'LG010';
    END IF;

    RETURN NEW;
  END;
  $guard$;

  DROP TRIGGER IF EXISTS project_leads_membership_guard ON public.project_leads;

  CREATE TRIGGER project_leads_membership_guard
    BEFORE INSERT OR UPDATE ON public.project_leads
    FOR EACH ROW
    EXECUTE FUNCTION public.project_leads_guard_membership();

  CREATE OR REPLACE FUNCTION public.set_project_lead(p_project_id uuid, p_user_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $setter$
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
       WHERE id = v_open_id;
    END IF;

    INSERT INTO public.project_leads (project_id, user_id, started_at)
    VALUES (p_project_id, p_user_id, v_now)
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
      'project_id',       p_project_id,
      'user_id',          p_user_id,
      'previous_user_id', v_previous,
      'lead_id',          v_new_id,
      'changed',          true
    );
  END;
  $setter$;

  REVOKE EXECUTE ON FUNCTION public.set_project_lead(uuid, uuid)     FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.set_project_lead(uuid, uuid)     FROM anon;
  GRANT  EXECUTE ON FUNCTION public.set_project_lead(uuid, uuid)     TO authenticated;

  REVOKE EXECUTE ON FUNCTION public.project_leads_guard_membership() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.project_leads_guard_membership() FROM anon;
  REVOKE EXECUTE ON FUNCTION public.project_leads_guard_membership() FROM authenticated;

  ALTER TABLE public.project_leads ENABLE ROW LEVEL SECURITY;

  -- THE THREE RE-RUN LINES. See the header - the migration does not carry
  -- these and must not.
  DROP POLICY IF EXISTS "project_leads_org_select" ON public.project_leads;
  DROP POLICY IF EXISTS "project_leads_org_insert" ON public.project_leads;
  DROP POLICY IF EXISTS "project_leads_org_update" ON public.project_leads;

  CREATE POLICY "project_leads_org_select"
    ON public.project_leads AS PERMISSIVE FOR SELECT TO authenticated
    USING (project_id IN (
      SELECT pr.id FROM public.projects pr
      WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

  CREATE POLICY "project_leads_org_insert"
    ON public.project_leads AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (project_id IN (
      SELECT pr.id FROM public.projects pr
      WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

  CREATE POLICY "project_leads_org_update"
    ON public.project_leads AS PERMISSIVE FOR UPDATE TO authenticated
    USING      (project_id IN (
      SELECT pr.id FROM public.projects pr
      WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
    WITH CHECK (project_id IN (
      SELECT pr.id FROM public.projects pr
      WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

  SELECT count(*) INTO v_policies_after FROM pg_policies WHERE schemaname = 'public';

  -- ===================================================================
  -- THE GRANT PROBE. READ-ONLY, NOT AN ASSERTION. See the header.
  -- ===================================================================
  v_grants := format('SELECT=%s INSERT=%s UPDATE=%s DELETE=%s',
    has_table_privilege('authenticated', 'public.project_leads', 'SELECT'),
    has_table_privilege('authenticated', 'public.project_leads', 'INSERT'),
    has_table_privilege('authenticated', 'public.project_leads', 'UPDATE'),
    has_table_privilege('authenticated', 'public.project_leads', 'DELETE'));

  -- ===================================================================
  -- SUBJECT RESOLUTION. ALL OF IT, BEFORE ANY ASSERTION RUNS.
  --
  -- A project whose organization has members, and which carries NO
  -- leadership rows already - so T5's row count is this file's own
  -- writes. The ORDER BY prefers the biggest organization, which is what
  -- makes a second member available for the handover.
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
    FROM public.org_members m
    WHERE m.org_id = v_org
    ORDER BY m.user_id
    LIMIT 1;

    SELECT m.user_id INTO v_member2
    FROM public.org_members m
    WHERE m.org_id = v_org
      AND m.user_id <> v_member
    ORDER BY m.user_id
    LIMIT 1;

    -- A PROFILE OUTSIDE THIS ORGANIZATION. Preferring one that belongs to
    -- some other organization, because that is the realistic shape: a
    -- colleague at another agency, not an accountless row.
    SELECT p.id INTO v_outsider
    FROM public.profiles p
    WHERE NOT EXISTS (
            SELECT 1 FROM public.org_members m
            WHERE m.org_id = v_org AND m.user_id = p.id)
      AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.user_id = p.id)
    ORDER BY p.id
    LIMIT 1;

    IF v_outsider IS NULL THEN
      SELECT p.id INTO v_outsider
      FROM public.profiles p
      WHERE NOT EXISTS (
              SELECT 1 FROM public.org_members m
              WHERE m.org_id = v_org AND m.user_id = p.id)
      ORDER BY p.id
      LIMIT 1;
    END IF;
  END IF;

  IF v_member2 IS NOT NULL THEN
    v_handover_to   := v_member2;
    v_handover_note := 'handed to a SECOND member';
  ELSE
    v_handover_to   := v_member;
    v_handover_note := 'handed back to the SAME member - this organization has only one. The index is still what is being measured.';
  END IF;

  v_claims_member := json_build_object(
    'sub',  COALESCE(v_member,   '00000000-0000-0000-0000-000000000000'::uuid)::text,
    'role', 'authenticated')::text;
  v_claims_outsid := json_build_object(
    'sub',  COALESCE(v_outsider, '00000000-0000-0000-0000-000000000000'::uuid)::text,
    'role', 'authenticated')::text;

  -- ===================================================================
  -- T1. THE CONTROL. The member reads their own project through RLS.
  -- If this fails, nothing below distinguishes a policy refusal from an
  -- impersonation that never took.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_member IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T1  control: member sees own project', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no project whose organization has a member. The harness is unverified and every result below is ambiguous.';
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
          || '1 row - both JWT GUCs took and auth.uid() resolves, so every refusal below is the POLICY refusing';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T1  control: member sees own project', 46) || rpad('FAIL', 14)
          || format('saw %s rows, expected 1. auth.uid() is probably NULL because neither JWT GUC took, OR the role `authenticated` holds no SELECT on projects. NOTHING BELOW TESTS A POLICY IN THAT STATE.', v_count);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T1  control: member sees own project', 46) || rpad('FAIL', 14)
          || format('unexpected %s: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T2. A MEMBER CAN BE MADE THE POINT PERSON.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_member IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T2  member set as point person', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no project whose organization has a member.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_member, true);
      PERFORM set_config('request.jwt.claim.sub', v_member::text,  true);
      SET LOCAL ROLE authenticated;

      INSERT INTO public.project_leads (project_id, user_id)
      VALUES (v_project, v_member);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      IF v_rows = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T2  member set as point person', 46) || rpad('PASS', 14)
          || '1 row - the guard, the INSERT policy and the table grants all admit the ordinary case';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T2  member set as point person', 46) || rpad('FAIL', 14)
          || format('matched %s rows, expected 1', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T2  member set as point person', 46) || rpad('FAIL', 14)
          || '42501 on the ordinary case. READ THE `authenticated grants` LINE ABOVE FIRST - if INSERT=false this is a missing table grant, not the policy. Otherwise project_leads_org_insert does not admit a member of the owning organization and the feature cannot work.';
        v_fail := v_fail + 1;
      WHEN SQLSTATE 'LG010' THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T2  member set as point person', 46) || rpad('FAIL', 14)
          || 'LG010 on a REAL member of the owning organization. The guard is refusing the case it exists to permit - most likely it is invoker rights rather than SECURITY DEFINER, so it read org_members through RLS and saw only the caller.';
        v_fail := v_fail + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T2  member set as point person', 46) || rpad('FAIL', 14)
          || format('unexpected %s: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T3. >>> THE NON-MEMBER IS REFUSED. THE GUARD'S WHOLE PURPOSE. <<<
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_member IS NULL OR v_outsider IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T3  NON-MEMBER refused by the guard', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no profile exists outside this organization, so the guard was never exercised. THE MEMBERSHIP GUARD IS UNTESTED BY THIS RUN.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_member, true);
      PERFORM set_config('request.jwt.claim.sub', v_member::text,  true);
      SET LOCAL ROLE authenticated;

      INSERT INTO public.project_leads (project_id, user_id)
      VALUES (v_project, v_outsider);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3  NON-MEMBER refused by the guard', 46) || rpad('FAIL', 14)
        || format('the insert SUCCEEDED (%s row). A person outside the organization was made the point person. The guard is absent, attached to the wrong verb, or reading org_members through RLS. DO NOT APPLY.', v_rows);
      v_fail := v_fail + 1;
    EXCEPTION
      WHEN SQLSTATE 'LG010' THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T3  NON-MEMBER refused by the guard', 46) || rpad('PASS', 14)
          || 'LG010 - the guard refused a point person who is not on the team';
        v_pass := v_pass + 1;
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T3  NON-MEMBER refused by the guard', 46) || rpad('INCONCLUSIVE', 14)
          || '42501, not LG010. The INSERT POLICY refused before the guard ran, so this says nothing about the guard. The policy scopes on project_id and this insert names the same project T2 used, so if T2 passed and this did not, read both lines together.';
        v_inconc := v_inconc + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T3  NON-MEMBER refused by the guard', 46) || rpad('FAIL', 14)
          || format('refused, but with %s rather than LG010: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T4. A SECOND OPEN LEAD IS REFUSED BY THE PARTIAL UNIQUE INDEX.
  -- Depends on T2 having left an open row. If T2 failed, this is
  -- inconclusive rather than a pass - an index cannot refuse a second
  -- row when there is no first one.
  -- ===================================================================
  v_ran := v_ran + 1;
  SELECT count(*) INTO v_count
  FROM public.project_leads
  WHERE project_id = v_project AND ended_at IS NULL;

  IF v_member IS NULL OR v_count <> 1 THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T4  SECOND open lead refused', 46) || rpad('INCONCLUSIVE', 14)
      || format('NO SUBJECT: expected exactly 1 open lead from T2, found %s. Nothing to collide with, so a refusal here would prove nothing.', COALESCE(v_count::text, 'none'));
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_member, true);
      PERFORM set_config('request.jwt.claim.sub', v_member::text,  true);
      SET LOCAL ROLE authenticated;

      INSERT INTO public.project_leads (project_id, user_id)
      VALUES (v_project, v_handover_to);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  SECOND open lead refused', 46) || rpad('FAIL', 14)
        || format('the insert SUCCEEDED (%s row) and the project now has TWO open point persons. project_leads_one_open_per_project is missing or is not UNIQUE. R1 is enforced by nothing. DO NOT APPLY.', v_rows);
      v_fail := v_fail + 1;
    EXCEPTION
      WHEN unique_violation THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T4  SECOND open lead refused', 46) || rpad('PASS', 14)
          || '23505 from the partial unique index - one open point person per project, enforced by Postgres and not by a route';
        v_pass := v_pass + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T4  SECOND open lead refused', 46) || rpad('FAIL', 14)
          || format('refused, but with %s rather than 23505: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T5. >>> THE HANDOVER. THIS IS THE ASSERTION THAT PROVES R2. <<<
  -- Close the open row, open a new one, and require BOTH to survive.
  -- ===================================================================
  v_ran := v_ran + 1;
  SELECT l.id INTO v_open_id
  FROM public.project_leads l
  WHERE l.project_id = v_project AND l.ended_at IS NULL;

  IF v_member IS NULL OR v_open_id IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T5  handover: closed lead does not block', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: there is no open lead to hand over, because T2 did not leave one. R2 IS UNTESTED BY THIS RUN.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_member, true);
      PERFORM set_config('request.jwt.claim.sub', v_member::text,  true);
      SET LOCAL ROLE authenticated;

      UPDATE public.project_leads SET ended_at = now() WHERE id = v_open_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;

      IF v_rows <> 1 THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T5  handover: closed lead does not block', 46) || rpad('FAIL', 14)
          || format('the close matched %s rows, expected 1. project_leads_org_update does not admit a member of the owning organization, so ended_at can never be stamped and no handover is possible.', v_rows);
        v_fail := v_fail + 1;
      ELSE
        INSERT INTO public.project_leads (project_id, user_id)
        VALUES (v_project, v_handover_to);
        RESET ROLE;

        SELECT count(*) INTO v_count
        FROM public.project_leads WHERE project_id = v_project;

        IF v_count = 2 THEN
          v_logged := v_logged + 1;
          v_lines := v_lines || E'\n  ' || rpad('T5  handover: closed lead does not block', 46) || rpad('PASS', 14)
            || format('2 rows - one closed, one open. The history survived the reassignment, which is R2. (%s)', v_handover_note);
          v_pass := v_pass + 1;
        ELSE
          v_logged := v_logged + 1;
          v_lines := v_lines || E'\n  ' || rpad('T5  handover: closed lead does not block', 46) || rpad('FAIL', 14)
            || format('the project carries %s leadership rows, expected 2. A count of 1 means the close overwrote instead of closing and the previous point person is gone - R2 is not satisfied.', v_count);
          v_fail := v_fail + 1;
        END IF;
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T5  handover: closed lead does not block', 46) || rpad('FAIL', 14)
          || '23505 ON THE HANDOVER. A CLOSED row is blocking a new one, which means project_leads_one_open_per_project was created WITHOUT its `WHERE ended_at IS NULL` clause. The first handover would also be the last. DO NOT APPLY.';
        v_fail := v_fail + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T5  handover: closed lead does not block', 46) || rpad('FAIL', 14)
          || format('unexpected %s: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T6. ANOTHER ORGANIZATION CANNOT READ. Paired with T5, which has just
  -- proved there ARE rows to be blind to.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_outsider IS NULL OR v_project IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T6  outsider cannot READ', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no profile exists outside this organization. CROSS-ORGANIZATION ISOLATION IS UNTESTED BY THIS RUN.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      SELECT count(*) INTO v_count
      FROM public.project_leads WHERE project_id = v_project;

      PERFORM set_config('request.jwt.claims',    v_claims_outsid,  true);
      PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
      SET LOCAL ROLE authenticated;

      SELECT count(*) INTO v_rows
      FROM public.project_leads WHERE project_id = v_project;
      RESET ROLE;

      IF v_count = 0 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T6  outsider cannot READ', 46) || rpad('INCONCLUSIVE', 14)
          || 'there are no rows on this project for anybody to see, so 0 proves nothing about RLS. T2 and T5 must have failed - read those first.';
        v_inconc := v_inconc + 1;
      ELSIF v_rows = 0 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T6  outsider cannot READ', 46) || rpad('PASS', 14)
          || format('the outsider sees 0 of the %s rows that are there - project_leads_org_select scopes to the project''s organization, and RLS is in force', v_count);
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T6  outsider cannot READ', 46) || rpad('FAIL', 14)
          || format('the outsider read %s of %s rows. Another agency can see who runs your projects. DO NOT APPLY.', v_rows, v_count);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T6  outsider cannot READ', 46) || rpad('FAIL', 14)
          || format('unexpected %s: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T7. ANOTHER ORGANIZATION CANNOT WRITE.
  --
  -- THE OUTSIDER NAMES v_member - A REAL MEMBER OF THE OWNING
  -- ORGANIZATION - AND NOT THEMSELVES, AND THE CHOICE IS THE WHOLE POINT.
  -- BEFORE ROW triggers run before RLS's WITH CHECK is evaluated, so an
  -- outsider naming THEMSELVES would be refused LG010 by the guard and
  -- this assertion would measure the guard for a second time while
  -- claiming to measure the policy. Naming a legitimate member walks the
  -- row PAST the guard, so project_leads_org_insert is the only thing
  -- left that can refuse it.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_outsider IS NULL OR v_project IS NULL OR v_member IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T7  outsider cannot WRITE', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no profile outside this organization, or no member inside it, so the write half of the isolation was never attempted. CROSS-ORGANIZATION ISOLATION IS UNTESTED BY THIS RUN.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_outsid,  true);
      PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
      SET LOCAL ROLE authenticated;

      INSERT INTO public.project_leads (project_id, user_id)
      VALUES (v_project, v_member);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T7  outsider cannot WRITE', 46) || rpad('FAIL', 14)
        || format('the insert SUCCEEDED (%s row). Another agency can name the point person on your project. DO NOT APPLY.', v_rows);
      v_fail := v_fail + 1;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T7  outsider cannot WRITE', 46) || rpad('PASS', 14)
          || '42501 - project_leads_org_insert refused a project outside the caller''s organizations';
        v_pass := v_pass + 1;
      WHEN SQLSTATE 'LG010' THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T7  outsider cannot WRITE', 46) || rpad('INCONCLUSIVE', 14)
          || 'LG010, not 42501: the GUARD refused rather than the policy, which should be impossible here because this row names a real member of the owning organization. The row was refused, but this run says nothing about project_leads_org_insert. Check that v_member really is in v_org.';
        v_inconc := v_inconc + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T7  outsider cannot WRITE', 46) || rpad('FAIL', 14)
          || format('refused, but with %s rather than 42501: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T8. THE HISTORY IS NOT ERASABLE. Runs LAST of the writes, on purpose:
  -- if it ever started matching rows it would destroy T5's evidence.
  --
  -- A refused DELETE under RLS DOES NOT RAISE. It matches zero rows and
  -- reports success, which is why this asserts ROW_COUNT.
  -- ===================================================================
  v_ran := v_ran + 1;
  SELECT count(*) INTO v_count FROM public.project_leads WHERE project_id = v_project;

  IF v_member IS NULL OR v_count = 0 THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T8  history is not erasable (no DELETE)', 46) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: there are no rows on this project to attempt to delete, so a zero-row DELETE proves nothing.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_member, true);
      PERFORM set_config('request.jwt.claim.sub', v_member::text,  true);
      SET LOCAL ROLE authenticated;

      DELETE FROM public.project_leads WHERE project_id = v_project;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      IF v_rows = 0 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T8  history is not erasable (no DELETE)', 46) || rpad('PASS', 14)
          || format('0 rows deleted of %s - there is no DELETE policy, so RLS denied by default and the member with the most access still cannot erase the history', v_count);
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T8  history is not erasable (no DELETE)', 46) || rpad('FAIL', 14)
          || format('%s of %s rows DELETED. A DELETE policy exists on project_leads and the leadership history is erasable. That policy did not come from 097. DO NOT APPLY until you know what wrote it.', v_rows, v_count);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T8  history is not erasable (no DELETE)', 46) || rpad('FAIL', 14)
          || format('unexpected %s: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T9. THE POLICY COUNT MATCHES THE PREDICTION. READ-ONLY.
  -- ===================================================================
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    IF v_policies_after = 120 THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  policy count = the predicted 120', 46) || rpad('PASS', 14)
        || format('%s before section A, %s after (delta %s). 097 predicts 120.',
                  v_policies_before, v_policies_after, v_policies_after - v_policies_before);
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  policy count = the predicted 120', 46) || rpad('FAIL', 14)
        || format('%s after section A, expected 120 (%s before, delta %s). 121 or more means a fourth policy landed - most likely a DELETE policy, which is the one 097 must not have. 119 or fewer means a CREATE POLICY did not run and part of the table is unreachable.',
                  v_policies_after, v_policies_before, v_policies_after - v_policies_before);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  policy count = the predicted 120', 46) || rpad('FAIL', 14)
        || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  RESET ROLE;

  -- ===================================================================
  -- THE VERDICT.
  -- ===================================================================
  IF v_fail = 0 AND v_inconc = 0 AND v_ran = 9 AND v_pass = 9 THEN
    v_verdict_text := 'SAFE TO APPLY 097.';
    v_headline     := format('SAFE TO APPLY 097.  All %s assertions passed.', v_pass);
  ELSIF v_inconc > 0 AND v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised - read the INCONCLUSIVE line(s) below. Settle it before applying.';
    -- NOT A GREEN LIGHT, and the first line has to say so. Nothing
    -- FAILED, but something 097 exists to do was never attempted, so this
    -- run says nothing at all about it. The common benign case is a
    -- database with only one organization, where T3, T6 and T7 have no
    -- outsider to act as - and in that state the guard and the
    -- cross-organization policies are genuinely unmeasured.
    v_headline     := format('DO NOT APPLY 097 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 097 does what it claims. It is not a green light. (If this database has only ONE organization, T3, T6 and T7 have no outsider to use and the membership guard and cross-organization isolation are UNTESTED.)', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline     := format('DO NOT APPLY 097.  %s assertion(s) FAILED.', v_fail);
  END IF;

  -- THE SELF-CHECK OVERRIDES THE HEADLINE. If an assertion ran without
  -- logging a line, the report is incomplete and no verdict drawn from it
  -- can be trusted, INCLUDING A CLEAN ONE. That has to outrank SAFE TO
  -- APPLY, so it is applied after everything above rather than folded in.
  IF v_logged <> v_ran THEN
    v_headline := format('DO NOT APPLY 097.  THE TEST ITSELF IS BROKEN: %s assertions ran but %s logged a verdict. The report below is incomplete and no verdict drawn from it means anything.', v_ran, v_logged);
  END IF;

  -- ===================================================================
  -- THE REPORT.
  --
  -- ORDER IS LOAD-BEARING: HEADLINE, THEN TALLY, THEN THE PER-ASSERTION
  -- LINES. A client that truncates a long error message truncates the END
  -- of it, so the verdict and the counts must be at the TOP where they
  -- survive. The 9 detail lines are the part that can afford to be cut.
  -- ===================================================================
  v_report :=
       E'\n'
    || E'=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected 9)\n', v_ran)
    || format(E'PASS            : %s   (expected 9)\n', v_pass)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0)\n', v_inconc)
    -- THE SELF-CHECK, IN THE OUTPUT RATHER THAN INFERRED FROM IT. v_ran is
    -- incremented by the assertions themselves and v_logged by the report
    -- sites, so the two numbers are counted independently.
    || format(E'verdicts logged : %s   (must equal assertions run: %s)\n',
              v_logged, CASE WHEN v_logged = v_ran THEN 'OK' ELSE 'MISMATCH' END)
    || E'\n'
    || format(E'097 already applied?   : %s\n',
              CASE WHEN v_pre_existing THEN 'YES - project_leads already existed, so section A re-created its policies and T9''s delta reads 0' ELSE 'no - this is a first run' END)
    || format(E'authenticated grants   : %s\n', v_grants)
    || format(E'subject project        : %s  %s\n',
              COALESCE(v_project::text, 'NONE'), COALESCE(v_project_name, ''))
    || format(E'  owning organization  : %s\n', COALESCE(v_org::text, 'NONE'))
    || format(E'  member (actor)       : %s\n', COALESCE(v_member::text, 'NONE'))
    || format(E'  second member        : %s\n', COALESCE(v_member2::text, 'NONE - only one member in this organization'))
    || format(E'  handover target      : %s  (%s)\n',
              COALESCE(v_handover_to::text, 'NONE'), COALESCE(v_handover_note, '-'))
    || format(E'  outsider             : %s\n', COALESCE(v_outsider::text, 'NONE - no profile outside this organization'))
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
  -- mistaken for one of the LG0xx codes 089-093 and 097 define. The
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
-- the batch in its own block and swallows the error. In that case the
-- transaction is still open and still holds A NEW TABLE, FOUR INDEXES,
-- TWO SECURITY DEFINER FUNCTIONS, A TRIGGER, THREE POLICIES DROPPED AND
-- RECREATED ON A LIVE TABLE, and up to three project_leads rows. This
-- line is the only thing that undoes them.
--
-- >>> THE THREE `DROP POLICY IF EXISTS` LINES ARE WHY THIS MATTERS ON A
-- >>> RE-RUN. Without this ROLLBACK, a swallowed exception would leave
-- >>> 097's policies dropped and recreated by a file whose header says it
-- >>> applies nothing.
-- =====================================================================
ROLLBACK;
