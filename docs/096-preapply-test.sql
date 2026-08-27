-- =====================================================================
-- 096 PRE-APPLY TEST. ONE PASTE. WRITES, THEN ROLLS BACK.
--
-- WHY THIS FILE EXISTS AND WHY IT IS NOT OPTIONAL.
--
-- A dry run of 096 proves the file parses. It says NOTHING about whether
-- a vendor on a PENDING partnership is actually refused today, whether
-- the new arm actually admits them, whether the widening stops anywhere,
-- or whether the two arms 096 restates survived the ALTER.
--
-- >>> 096 WIDENS AN RLS POLICY. That is the one class of change where
-- >>> "it applied without error" is worth nothing at all. A policy that
-- >>> is too permissive raises no error, breaks no page and shows no red
-- >>> state anywhere. The only way to find out what it admits is to try
-- >>> to write things through it and see which ones land.
--
-- IT PROVES THE DEFECT BEFORE IT PROVES THE FIX. T1 and T2 run against
-- the LIVE policy, before section A applies anything. If T1 does not
-- show a pending-partnership vendor being refused, the premise of the
-- whole migration is wrong and you should not apply it on the strength
-- of the later assertions passing.
--
-- =====================================================================
-- THIS ONE IMPERSONATES. 095's TEST DELIBERATELY DID NOT.
-- =====================================================================
--
-- 095 widened a CHECK CONSTRAINT. A CHECK is not RLS, it is evaluated
-- for every role including the service role, and impersonating would
-- have put the INSERT POLICY in front of the constraint - so the write
-- would have been refused with 42501 before the 23514 that test existed
-- to measure ever arrived. Not impersonating was correct there.
--
-- HERE THE POLICY IS THE ENTIRE SUBJECT. Run as the table owner or the
-- service role and RLS is bypassed, every INSERT below succeeds, and the
-- file reports a clean nine-for-nine while measuring nothing whatsoever.
-- Every write assertion in this file sets both JWT GUCs and
-- SET LOCAL ROLE authenticated first, and T2 exists to prove that took.
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
-- docs/091-preapply-test.sql, re-used by 092 and 094, and not
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
--     SAFE TO APPLY 096.  All 9 assertions passed.
--     =====================================================
--     assertions run  : 9    (expected 9)
--     PASS            : 9    (expected 9)
--     FAIL            : 0    (expected 0)
--     INCONCLUSIVE    : 0    (expected 0)
--     verdicts logged : 9    (must equal assertions run: OK)
--     ... subjects ...
--     VERDICT         : SAFE TO APPLY 096.
--     -----------------------------------------------------
--       T1  pending vendor INSERT, pre-fix    PASS   (42501, the defect)
--       ... eight more ...
--     =====================================================
--
-- READ THE FIRST LINE AND NOTHING ELSE IF YOU READ NOTHING ELSE:
--
--     "SAFE TO APPLY 096."        -> and only this - apply it.
--     "DO NOT APPLY 096."         -> an assertion FAILED, or the test
--                                    itself is broken. Do not apply.
--     "DO NOT APPLY 096 YET."     -> INCONCLUSIVE. Nothing failed, but an
--                                    assertion could not be exercised, so
--                                    the run says NOTHING about the thing
--                                    it was meant to prove. IT IS NOT A
--                                    GREEN LIGHT.
--
-- >>> "Success. No rows returned" MEANS THE RUN DID NOT WORK. <<<
--
-- If you see it, the DO block did not reach its RAISE - most likely the
-- batch was run in pieces or the editor swallowed the error. You have
-- learned nothing about 096 and must not apply it on that basis.
--
-- IT LEAVES NOTHING BEHIND. Every statement below - the CREATE FUNCTION,
-- the ALTER POLICY, the REVOKEs, the one possible UPDATE to a
-- partnerships row and every INSERT - is inside one transaction, and the
-- RAISE EXCEPTION aborts it. PostgreSQL rolls back DDL, so afterwards the
-- database is byte-identical to before, whether 096 is applied or not.
--
-- IT IS SAFE TO RUN WHETHER OR NOT 096 IS ALREADY APPLIED. The function
-- is CREATE OR REPLACE and the policy change is an ALTER to the same
-- predicate, so re-applying is a no-op. See RE-RUNNING AFTER APPLYING.
--
-- =====================================================================
-- THE SUBJECTS, AND WHY THEY ARE SELECTED RATHER THAN HARDCODED
-- =====================================================================
--
-- Nothing below carries a literal uuid. Every subject is resolved by
-- query inside the transaction, so the file cannot rot against a
-- database that has moved on, and so a subject that has ceased to exist
-- reports INCONCLUSIVE rather than a stale PASS.
--
-- >>> AN ASSERTION THAT CANNOT FIND A SUBJECT HAS PROVED NOTHING. It is
-- >>> reported INCONCLUSIVE with the reason, never PASS, and one
-- >>> INCONCLUSIVE downgrades the headline to DO NOT APPLY YET.
--
-- FIVE SUBJECT SETS ARE NEEDED:
--
--   PENDING   a partnership with status='pending' AND vendor_org_id NOT
--             NULL, both orgs holding members. THE POPULATION 096 IS FOR.
--   ACTIVE    the same with status='active'. The population arm 3 already
--             serves, which must still work afterwards.
--   REMOVED   the same with status='removed'. Asserted REFUSED, per the
--             ruling recorded in 096's header.
--   STRANGER  a user with NO partnership of ANY status to any of the
--             actor's organizations, and not a colleague. The boundary.
--   COLLEAGUE an organization with two members. 094's arm, which must
--             not have been disturbed.
--
-- =====================================================================
-- THE PENDING SUBJECT MAY NOT EXIST ON LIVE DATA. READ THIS BEFORE THE
-- HEADLINE SURPRISES YOU.
-- =====================================================================
--
-- Live counts at authoring time: 33 partnerships, 27 pending, 5 active,
-- 1 removed - and only 5 carry a vendor_org_id at all. If those 5 are the
-- 5 active ones, then THERE IS NO PENDING PARTNERSHIP WITH A CLAIMED
-- VENDOR ANYWHERE IN THE DATABASE and T1/T3 have no real subject.
--
-- THAT DOES NOT MEAN 096 IS UNNECESSARY. It means the population is
-- created the moment any one of the 27 pending vendors signs in:
-- app/api/partner/partnerships/claim/route.ts:63-66 sets vendor_org_id on
-- every partnership matching the caller's email whose status is
-- 'pending' OR 'active', AND IT DOES NOT CHANGE THE STATUS. So a
-- broadcast recipient who merely logs in becomes exactly the row 096 is
-- written for, while still sitting at 'pending'.
--
-- SO THE FILE SYNTHESIZES ONE, VISIBLY. If no real pending subject
-- exists, it takes an ACTIVE partnership and UPDATEs its status to
-- 'pending' inside this transaction - one column, to a value the live
-- CHECK already permits, rolled back with everything else. The orgs, the
-- members and the users are all real; only the status is arranged.
--
--   * Every report line for a synthesized subject is tagged SYNTHETIC.
--   * The headline is tagged too. A synthetic run is evidence about the
--     POLICY, not about the DATA, and it must not read like both.
--   * T4 then reports INCONCLUSIVE if that active partnership was the
--     only one, because it was consumed. That is stated, not hidden, and
--     the read-only T8 still proves arm 3 survived textually.
--
-- IF THERE IS NEITHER A PENDING SUBJECT NOR AN ACTIVE ONE TO DERIVE FROM,
-- T1 AND T3 ARE INCONCLUSIVE AND THE RUN IS NOT A GREEN LIGHT.
--
-- =====================================================================
-- HOW TO READ IT. AN ERROR IS A PASS FOR THREE OF THESE NINE.
-- =====================================================================
--
--   T1  THE DEFECT, DEMONSTRATED ON THE LIVE POLICY. Before anything is
--       applied: a vendor on a PENDING partnership inserts a notification
--       addressed to a member of the LEAD agency. PASS = REFUSED (42501).
--       A SUCCESS here means the live policy already admits them and 096
--       has nothing to fix - INCONCLUSIVE, not PASS.
--
--   T2  THE HARNESS WORKS. The same vendor inserts a notification
--       addressed to THEMSELVES, still pre-fix. PASS = SUCCEEDS on arm 1.
--       THIS IS THE CONTROL AND IT IS NOT OPTIONAL: without it, a T1
--       refusal could equally mean the impersonation never took and every
--       write is being refused, in which case T1 proves nothing at all.
--
--   -- section A applies 096 here --
--
--   T3  >>> THE ASSERTION THE WHOLE MIGRATION IS FOR. <<< The same vendor
--       writes to the same lead-agency member. PASS = SUCCEEDS, 1 row. A
--       FAIL here means 096 does not do the one thing it exists to do.
--
--   T4  ARM 3's POPULATION SURVIVES, BEHAVIOURALLY. A vendor on an ACTIVE
--       partnership writes to a member of its lead agency. PASS =
--       SUCCEEDS, 1 row. A FAIL means the ALTER replaced an arm instead
--       of adding one and every cross-company notification that works
--       today has just stopped.
--
--   T5  >>> THE WIDENING HAS A BOUNDARY. <<< The vendor writes to a user
--       with NO partnership of ANY status to any organization they belong
--       to, who is not a colleague. PASS = REFUSED (42501). A SUCCESS
--       here means 096 opened the notifications table to everybody. DO
--       NOT APPLY.
--
--   T6  THE 'removed' RULING, ASSERTED. A vendor on a REMOVED partnership
--       writes to a member of its lead agency. PASS = REFUSED (42501),
--       which is what 096's status list says must happen. IF GREG RULES
--       THE OTHER WAY, THIS ASSERTION INVERTS - it is the executable form
--       of the ruling, and it is the line to change when the ruling
--       changes.
--
--   T7  094's ARM IS UNDISTURBED. An organization owner writes to a
--       COLLEAGUE in their own organization. PASS = SUCCEEDS, 1 row. A
--       FAIL means this file undid 094.
--
--   T8  ALL FOUR ARMS ARE PRESENT IN THE TEXT. READ-ONLY, straight out of
--       pg_policies. PASS = the live with_check names auth.uid,
--       current_user_org_member_user_ids,
--       current_user_active_counterparty_user_ids AND
--       current_user_commercial_counterparty_user_ids. This is the
--       assertion that still works when T4 is inconclusive.
--
--   T9  THE POLICY COUNT DID NOT MOVE. READ-ONLY. PASS = the count before
--       section A equals the count after it. ALTER POLICY creates and
--       drops nothing; a change means a DROP/CREATE crept in.
--
-- EVERY REFUSAL TEST RUNS IN ITS OWN plpgsql SUBTRANSACTION, so an
-- expected 42501 does not abort the run. That is what lets all nine
-- assertions report from a single paste.
--
-- =====================================================================
-- CONTAMINATION BETWEEN ASSERTIONS. 094's TEST WAS BITTEN BY THIS.
-- =====================================================================
--
-- 094's test had to exclude a uid from one selection because an earlier
-- assertion had rewritten that profile's email. Three precautions here:
--
--   1. NOTHING IN THIS FILE WRITES TO profiles, org_members OR
--      organizations. The only non-notifications write is the single
--      status UPDATE described above, and only when synthesizing.
--
--   2. EVERY SUBJECT IS RESOLVED ONCE, UP FRONT, BEFORE ANY ASSERTION
--      RUNS - so no assertion can select a row a later one has altered.
--      The synthesizing UPDATE happens in that same up-front block, and
--      T4's subject is chosen to be a DIFFERENT partnership row from the
--      one consumed, or reported INCONCLUSIVE if there is no other.
--
--   3. THE ACTOR IS NEVER A MEMBER OF THE TARGET'S ORGANIZATION and the
--      target is never a member of the actor's. Otherwise arm 1 or arm 2
--      would match and T1 would report a refusal that never existed - it
--      would FAIL against a perfectly correct 096 and look like a real
--      finding. Each selection below carries both exclusions explicitly.
--
--   4. T1's SUBJECT IS EXCLUDED FROM ARM 3 TOO. If the actor's
--      organization also holds a SEPARATE ACTIVE partnership with the
--      same lead agency, arm 3 admits the write today and T1's expected
--      refusal never happens. The pending selection excludes that case.
--
-- =====================================================================
-- THE TYPE PREFLIGHT, AND WHY IT IS NOT AN ASSERTION
-- =====================================================================
--
-- 094's first run returned three FAILs and one INCONCLUSIVE from ONE
-- cause: 23514 on notifications_type_check, because it wrote
-- 'bid_submitted' and the live constraint did not permit it. 095 has
-- since widened that constraint to the eleven types lib/notifications.ts
-- declares, and 095 is applied.
--
-- This file writes 'bid_submitted' because that is the type the product
-- actually writes at the site under test. It probes for it FIRST, with a
-- write to the actor's own row, and falls back to 'partnership_accepted'
-- - permitted under both the old and the new constraint - if the probe
-- 23514s. The probe is reported in the header of the report and is NOT
-- counted as an assertion: it measures the CHECK, which is 095's
-- business, not 096's.
--
-- title IS NOT NULL WITH NO DEFAULT on this table. Every INSERT below
-- supplies one. An insert that omits it raises 23502, which looks exactly
-- like a policy refusal to anyone reading only the tally.
--
-- =====================================================================
-- RE-RUNNING AFTER APPLYING. THE ONE EXPECTED DIFFERENCE.
-- =====================================================================
--
-- Run this file again after 096 is applied and T1 flips from PASS to
-- INCONCLUSIVE: the pending-vendor write it expects to be refused will
-- succeed, because the fix is live. THAT FLIP IS THE PROOF THE APPLY
-- LANDED, and it is the only assertion that is supposed to change. The
-- headline will read "DO NOT APPLY 096 YET" on that run, which is
-- correct and means nothing. Read the T1 line, not the headline, on a
-- post-apply run.
--
-- =====================================================================
-- TWO IMPLEMENTATION NOTES, BOTH INHERITED FROM 092 AND 094
-- =====================================================================
--
--   BOTH JWT GUCs ARE SET, not one. Supabase's auth.uid() has shipped in
--   two forms - one reading request.jwt.claim.sub, one reading
--   request.jwt.claims ->> 'sub'. Setting only the form this session
--   guessed at would leave auth.uid() NULL, every insert would be
--   refused, and T1 would report PASS against a policy never reached. T2
--   is the control that catches exactly that.
--
--   IF YOUR EDITOR REJECTS `SET LOCAL ROLE authenticated` inside the DO
--   block, replace every occurrence with
--   `PERFORM set_config('role', 'authenticated', true);` and every
--   `RESET ROLE;` with `PERFORM set_config('role', 'none', true);`.
--   They are equivalent - `role` is an ordinary GUC.
--
-- OUTCOMES THAT ARE NEITHER PASS NOR FAIL, REPORTED SEPARATELY:
--
--   42501 ON T2 - the role `authenticated` holds no INSERT grant on
--   notifications at all, so nothing below tests a policy. Reported as a
--   FAIL of the harness, not a verdict on 096.
--
--   23514 ON EVERY WRITE - notifications_type_check refused the type even
--   after the preflight fallback. 095 is not applied, or the table's
--   constraint is not what this file believes. No verdict on 096.
-- =====================================================================


BEGIN;


DO $test$
DECLARE
  -- pending subject
  v_pend_part      uuid;
  v_pend_lead      uuid;
  v_pend_vend      uuid;
  v_pend_actor     uuid;
  v_pend_target    uuid;
  v_pend_synth     boolean := false;
  -- active subject
  v_act_part       uuid;
  v_act_lead       uuid;
  v_act_vend       uuid;
  v_act_actor      uuid;
  v_act_target     uuid;
  v_act_note       text := '';
  -- removed subject
  v_rem_part       uuid;
  v_rem_lead       uuid;
  v_rem_vend       uuid;
  v_rem_actor      uuid;
  v_rem_target     uuid;
  -- stranger + colleague subjects
  v_stranger       uuid;
  v_col_org        uuid;
  v_col_org_name   text;
  v_col_owner      uuid;
  v_col_mate       uuid;
  -- machinery
  v_type           text := 'bid_submitted';
  v_type_note      text;
  v_claims         text;
  v_rows           integer;
  v_check          text;
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

  -- ===================================================================
  -- SUBJECT RESOLUTION. ALL OF IT, BEFORE ANY ASSERTION RUNS.
  -- ===================================================================

  -- -------------------------------------------------------------------
  -- PENDING. status='pending', vendor claimed, both orgs peopled, and NO
  -- separate ACTIVE partnership between the same two organizations -
  -- that last exclusion is what keeps arm 3 out of T1's way.
  -- -------------------------------------------------------------------
  SELECT p.id, p.lead_org_id, p.vendor_org_id
    INTO v_pend_part, v_pend_lead, v_pend_vend
  FROM public.partnerships p
  WHERE p.status = 'pending'
    AND p.vendor_org_id IS NOT NULL
    AND p.lead_org_id IS NOT NULL
    AND p.lead_org_id <> p.vendor_org_id
    AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p.vendor_org_id)
    AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p.lead_org_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.partnerships q
       WHERE q.status = 'active'
         AND ((q.lead_org_id = p.lead_org_id   AND q.vendor_org_id = p.vendor_org_id)
           OR (q.lead_org_id = p.vendor_org_id AND q.vendor_org_id = p.lead_org_id))
    )
  ORDER BY p.id
  LIMIT 1;

  -- -------------------------------------------------------------------
  -- ACTIVE. Resolved next so the synthesizer below can see it and avoid
  -- taking the row T4 needs.
  -- -------------------------------------------------------------------
  SELECT p.id, p.lead_org_id, p.vendor_org_id
    INTO v_act_part, v_act_lead, v_act_vend
  FROM public.partnerships p
  WHERE p.status = 'active'
    AND p.vendor_org_id IS NOT NULL
    AND p.lead_org_id IS NOT NULL
    AND p.lead_org_id <> p.vendor_org_id
    AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p.vendor_org_id)
    AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p.lead_org_id)
  ORDER BY p.id
  LIMIT 1;

  -- -------------------------------------------------------------------
  -- THE SYNTHESIZER. Only when no real pending subject exists.
  --
  -- Prefers a SECOND active partnership so T4 keeps its own row. Falls
  -- back to the first one, and says so, because proving the migration
  -- does its job matters more than proving the arm it does not touch -
  -- and T8 proves arm 3 textually either way.
  --
  -- ONE COLUMN, TO A VALUE THE LIVE CHECK ALREADY PERMITS
  -- (063:34 CHECK (status IN ('pending','active','suspended',
  -- 'terminated','removed'))), INSIDE A TRANSACTION THAT ENDS IN
  -- ROLLBACK. It touches no other table and no other column.
  -- -------------------------------------------------------------------
  IF v_pend_part IS NULL AND v_act_part IS NOT NULL THEN
    SELECT p.id, p.lead_org_id, p.vendor_org_id
      INTO v_pend_part, v_pend_lead, v_pend_vend
    FROM public.partnerships p
    WHERE p.status = 'active'
      AND p.id <> v_act_part
      AND p.vendor_org_id IS NOT NULL
      AND p.lead_org_id IS NOT NULL
      AND p.lead_org_id <> p.vendor_org_id
      AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p.vendor_org_id)
      AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p.lead_org_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.partnerships q
         WHERE q.status = 'active'
           AND q.id <> p.id
           AND ((q.lead_org_id = p.lead_org_id   AND q.vendor_org_id = p.vendor_org_id)
             OR (q.lead_org_id = p.vendor_org_id AND q.vendor_org_id = p.lead_org_id))
      )
    ORDER BY p.id
    LIMIT 1;

    IF v_pend_part IS NULL THEN
      -- Only one active partnership in the database. Consume it, and
      -- disqualify T4 by name rather than letting it read a row this
      -- block has just moved out from under it.
      v_pend_part := v_act_part;
      v_pend_lead := v_act_lead;
      v_pend_vend := v_act_vend;
      v_act_part  := NULL;
      v_act_note  := 'the only ACTIVE partnership in the database was consumed to synthesize the PENDING subject T1/T3 needed';
    END IF;

    UPDATE public.partnerships SET status = 'pending' WHERE id = v_pend_part;
    v_pend_synth := true;
  END IF;

  IF v_pend_part IS NOT NULL THEN
    SELECT m.user_id INTO v_pend_actor
    FROM public.org_members m
    WHERE m.org_id = v_pend_vend
      AND m.user_id NOT IN (SELECT user_id FROM public.org_members WHERE org_id = v_pend_lead)
    ORDER BY m.user_id LIMIT 1;

    SELECT m.user_id INTO v_pend_target
    FROM public.org_members m
    WHERE m.org_id = v_pend_lead
      AND m.user_id IS DISTINCT FROM v_pend_actor
      AND m.user_id NOT IN (SELECT user_id FROM public.org_members WHERE org_id = v_pend_vend)
    ORDER BY m.user_id LIMIT 1;
  END IF;

  IF v_act_part IS NOT NULL THEN
    SELECT m.user_id INTO v_act_actor
    FROM public.org_members m
    WHERE m.org_id = v_act_vend
      AND m.user_id NOT IN (SELECT user_id FROM public.org_members WHERE org_id = v_act_lead)
    ORDER BY m.user_id LIMIT 1;

    SELECT m.user_id INTO v_act_target
    FROM public.org_members m
    WHERE m.org_id = v_act_lead
      AND m.user_id IS DISTINCT FROM v_act_actor
      AND m.user_id NOT IN (SELECT user_id FROM public.org_members WHERE org_id = v_act_vend)
    ORDER BY m.user_id LIMIT 1;
  END IF;

  -- -------------------------------------------------------------------
  -- REMOVED. Note that app/api/partner/partnerships/claim/route.ts:65
  -- claims only 'pending' and 'active' rows, so a removed partnership
  -- may well never carry a vendor_org_id and this subject may simply not
  -- exist. That is reported, not worked around: synthesizing a removed
  -- row would be arranging the very fact under test.
  -- -------------------------------------------------------------------
  SELECT p.id, p.lead_org_id, p.vendor_org_id
    INTO v_rem_part, v_rem_lead, v_rem_vend
  FROM public.partnerships p
  WHERE p.status = 'removed'
    AND p.vendor_org_id IS NOT NULL
    AND p.lead_org_id IS NOT NULL
    AND p.lead_org_id <> p.vendor_org_id
    AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p.vendor_org_id)
    AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p.lead_org_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.partnerships q
       WHERE q.status IN ('pending', 'active', 'suspended')
         AND ((q.lead_org_id = p.lead_org_id   AND q.vendor_org_id = p.vendor_org_id)
           OR (q.lead_org_id = p.vendor_org_id AND q.vendor_org_id = p.lead_org_id))
    )
  ORDER BY p.id
  LIMIT 1;

  IF v_rem_part IS NOT NULL THEN
    SELECT m.user_id INTO v_rem_actor
    FROM public.org_members m
    WHERE m.org_id = v_rem_vend
      AND m.user_id NOT IN (SELECT user_id FROM public.org_members WHERE org_id = v_rem_lead)
    ORDER BY m.user_id LIMIT 1;

    SELECT m.user_id INTO v_rem_target
    FROM public.org_members m
    WHERE m.org_id = v_rem_lead
      AND m.user_id IS DISTINCT FROM v_rem_actor
      AND m.user_id NOT IN (SELECT user_id FROM public.org_members WHERE org_id = v_rem_vend)
    ORDER BY m.user_id LIMIT 1;
  END IF;

  -- -------------------------------------------------------------------
  -- THE STRANGER, relative to whichever actor T5 will use. NO status
  -- filter on the partnerships exclusion: ANY partnership in EITHER
  -- direction disqualifies, which is the strongest available form of
  -- "no partnership at all".
  -- -------------------------------------------------------------------
  IF COALESCE(v_pend_actor, v_act_actor) IS NOT NULL THEN
    SELECT m.user_id INTO v_stranger
    FROM public.org_members m
    WHERE m.user_id <> COALESCE(v_pend_actor, v_act_actor)
      AND m.org_id NOT IN (
        SELECT org_id FROM public.org_members WHERE user_id = COALESCE(v_pend_actor, v_act_actor)
      )
      AND m.org_id NOT IN (
        SELECT p.vendor_org_id FROM public.partnerships p
         WHERE p.lead_org_id IN (SELECT org_id FROM public.org_members
                                  WHERE user_id = COALESCE(v_pend_actor, v_act_actor))
           AND p.vendor_org_id IS NOT NULL
        UNION
        SELECT p.lead_org_id FROM public.partnerships p
         WHERE p.vendor_org_id IN (SELECT org_id FROM public.org_members
                                    WHERE user_id = COALESCE(v_pend_actor, v_act_actor))
           AND p.lead_org_id IS NOT NULL
      )
    ORDER BY m.user_id LIMIT 1;
  END IF;

  -- -------------------------------------------------------------------
  -- THE COLLEAGUE PAIR, for T7. 094's own subject query.
  -- -------------------------------------------------------------------
  SELECT m.org_id, o.name INTO v_col_org, v_col_org_name
  FROM public.org_members m
  JOIN public.organizations o ON o.id = m.org_id
  GROUP BY m.org_id, o.name, o.created_at
  HAVING count(*) > 1
  ORDER BY o.created_at, m.org_id
  LIMIT 1;

  IF v_col_org IS NOT NULL THEN
    SELECT user_id INTO v_col_owner FROM public.org_members
    WHERE org_id = v_col_org AND role = 'owner' ORDER BY user_id LIMIT 1;
    IF v_col_owner IS NULL THEN
      SELECT user_id INTO v_col_owner FROM public.org_members
      WHERE org_id = v_col_org ORDER BY user_id LIMIT 1;
    END IF;
    SELECT user_id INTO v_col_mate FROM public.org_members
    WHERE org_id = v_col_org AND user_id <> v_col_owner ORDER BY user_id LIMIT 1;
  END IF;

  -- ===================================================================
  -- THE TYPE PREFLIGHT. Not an assertion. See the header.
  -- ===================================================================
  IF COALESCE(v_pend_actor, v_act_actor, v_col_owner) IS NOT NULL THEN
    BEGIN
      RESET ROLE;
      INSERT INTO public.notifications (user_id, type, title, message)
      VALUES (COALESCE(v_pend_actor, v_act_actor, v_col_owner), 'bid_submitted',
              '096 preflight', 'type probe');
      v_type      := 'bid_submitted';
      v_type_note := '''bid_submitted'' accepted - 095 is applied';
    EXCEPTION
      WHEN check_violation THEN
        v_type      := 'partnership_accepted';
        v_type_note := '''bid_submitted'' REFUSED by notifications_type_check (23514) - 095 is NOT applied on this database. Falling back to ''partnership_accepted''. THE POLICY ASSERTIONS BELOW ARE STILL VALID; the product''s own bid notification, however, cannot be written at all until 095 lands.';
      WHEN OTHERS THEN
        v_type      := 'partnership_accepted';
        v_type_note := format('type probe raised %s (%s) - falling back to ''partnership_accepted''', SQLSTATE, SQLERRM);
    END;
    RESET ROLE;
  ELSE
    v_type_note := 'no subject at all to probe with';
  END IF;

  v_claims := json_build_object('sub', COALESCE(v_pend_actor, '00000000-0000-0000-0000-000000000000'::uuid)::text,
                                'role', 'authenticated')::text;

  -- ===================================================================
  -- T1. THE DEFECT, ON THE LIVE POLICY.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_pend_actor IS NULL OR v_pend_target IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T1  pending vendor write, pre-fix', 44) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no partnership with status=''pending'' and a non-null vendor_org_id has members on both sides, and no ACTIVE partnership existed to synthesize one from. The defect could not be demonstrated, so this run says NOTHING about it. NOT a green light.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims,           true);
      PERFORM set_config('request.jwt.claim.sub', v_pend_actor::text, true);
      SET LOCAL ROLE authenticated;

      INSERT INTO public.notifications (user_id, type, title, message)
      VALUES (v_pend_target, v_type, '096 test T1', 'pre-fix pending-partnership write');
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T1  pending vendor write, pre-fix', 44) || rpad('INCONCLUSIVE', 14)
        || format('write SUCCEEDED (%s row). The LIVE policy already admits a pending-partnership counterparty, so 096 has nothing to fix and the assertions below prove nothing you needed. IF 096 IS ALREADY APPLIED, THIS IS THE EXPECTED RESULT.', v_rows);
      v_inconc := v_inconc + 1;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T1  pending vendor write, pre-fix', 44) || rpad('PASS', 14)
          || '42501 refused - THE DEFECT, demonstrated on the live policy' || CASE WHEN v_pend_synth THEN '  [SYNTHETIC SUBJECT]' ELSE '' END;
        v_pass := v_pass + 1;
      WHEN check_violation OR not_null_violation OR foreign_key_violation THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T1  pending vendor write, pre-fix', 44) || rpad('INCONCLUSIVE', 14)
          || format('%s on notifications - a column or constraint this file does not know about. Says NOTHING about the policy.', SQLSTATE);
        v_inconc := v_inconc + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T1  pending vendor write, pre-fix', 44) || rpad('FAIL', 14)
          || format('unexpected %s: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T2. THE CONTROL. Same actor, writing to THEMSELVES, still pre-fix.
  -- Arm 1 (user_id = auth.uid()) must admit this or nothing below means
  -- anything.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_pend_actor IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T2  control: actor writes to self', 44) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no actor was resolved, so the harness itself is unverified and every refusal below is ambiguous between "the policy refused" and "the impersonation never took".';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims,           true);
      PERFORM set_config('request.jwt.claim.sub', v_pend_actor::text, true);
      SET LOCAL ROLE authenticated;

      INSERT INTO public.notifications (user_id, type, title, message)
      VALUES (v_pend_actor, v_type, '096 test T2', 'harness control');
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      IF v_rows = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T2  control: actor writes to self', 44) || rpad('PASS', 14)
          || '1 row - impersonation took and arm 1 admits it, so T1''s refusal is the POLICY refusing';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T2  control: actor writes to self', 44) || rpad('FAIL', 14)
          || format('matched %s rows, expected 1', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T2  control: actor writes to self', 44) || rpad('FAIL', 14)
          || '42501 on the actor''s OWN row. Either the role `authenticated` holds no INSERT grant on notifications at all, or auth.uid() is NULL because neither JWT GUC took. NOTHING IN THIS FILE TESTS A POLICY IN THAT STATE - no verdict on 096 in either direction.';
        v_fail := v_fail + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T2  control: actor writes to self', 44) || rpad('FAIL', 14)
          || format('unexpected %s: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- SECTION A. 096 APPLIED, INSIDE THIS TRANSACTION.
  -- Kept byte-identical to supabase/migrations/096_bid_notification_scope.sql.
  -- ===================================================================
  RESET ROLE;

  CREATE OR REPLACE FUNCTION public.current_user_commercial_counterparty_user_ids()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    WITH my_orgs AS (
      SELECT m.org_id FROM public.org_members m WHERE m.user_id = auth.uid()
    ),
    commercial_counterparties AS (
      SELECT p.vendor_org_id AS org_id
        FROM public.partnerships p
       WHERE p.lead_org_id IN (SELECT org_id FROM my_orgs)
         AND p.vendor_org_id IS NOT NULL
         AND p.status IN ('pending', 'active', 'suspended')
      UNION
      SELECT p.lead_org_id AS org_id
        FROM public.partnerships p
       WHERE p.vendor_org_id IN (SELECT org_id FROM my_orgs)
         AND p.status IN ('pending', 'active', 'suspended')
    )
    SELECT m.user_id
    FROM public.org_members m
    WHERE m.org_id IN (SELECT org_id FROM commercial_counterparties);
  $fn$;

  REVOKE EXECUTE ON FUNCTION public.current_user_commercial_counterparty_user_ids() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.current_user_commercial_counterparty_user_ids() FROM anon;
  GRANT  EXECUTE ON FUNCTION public.current_user_commercial_counterparty_user_ids() TO authenticated;

  ALTER POLICY "Scoped insert notifications"
    ON public.notifications
    WITH CHECK (
      user_id = auth.uid()
      OR user_id IN (SELECT public.current_user_org_member_user_ids())
      OR user_id IN (SELECT public.current_user_active_counterparty_user_ids())
      OR user_id IN (SELECT public.current_user_commercial_counterparty_user_ids())
    );

  -- ===================================================================
  -- T3. THE REMEDY. Same actor, same target, new policy.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_pend_actor IS NULL OR v_pend_target IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T3  pending vendor write, post-fix', 44) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: same reason as T1. THE ASSERTION THE MIGRATION EXISTS FOR WAS NEVER EXERCISED. DO NOT APPLY on this run.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims,           true);
      PERFORM set_config('request.jwt.claim.sub', v_pend_actor::text, true);
      SET LOCAL ROLE authenticated;

      INSERT INTO public.notifications (user_id, type, title, message)
      VALUES (v_pend_target, v_type, '096 test T3', 'post-fix pending-partnership write');
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      IF v_rows = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T3  pending vendor write, post-fix', 44) || rpad('PASS', 14)
          || '1 row - a vendor on a PENDING partnership can now notify the lead agency. THIS IS WHAT 096 IS FOR.'
          || CASE WHEN v_pend_synth THEN '  [SYNTHETIC SUBJECT: the status was set to ''pending'' by this transaction]' ELSE '' END;
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T3  pending vendor write, post-fix', 44) || rpad('FAIL', 14)
          || format('matched %s rows, expected 1', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T3  pending vendor write, post-fix', 44) || rpad('FAIL', 14)
          || '42501 STILL REFUSED. 096 DOES NOT DO THE ONE THING IT IS FOR. DO NOT APPLY.';
        v_fail := v_fail + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T3  pending vendor write, post-fix', 44) || rpad('FAIL', 14)
          || format('unexpected %s: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T4. ARM 3's POPULATION SURVIVES, BEHAVIOURALLY.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_act_actor IS NULL OR v_act_target IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T4  active vendor write, post-fix', 44) || rpad('INCONCLUSIVE', 14)
      || COALESCE(NULLIF(v_act_note, ''), 'NO SUBJECT: no partnership with status=''active'' and a non-null vendor_org_id has members on both sides')
      || '. Arm 3''s population was not exercised behaviourally - T8 still proves the arm survived in the policy TEXT, which is weaker evidence.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_act_actor::text, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', v_act_actor::text, true);
      SET LOCAL ROLE authenticated;

      INSERT INTO public.notifications (user_id, type, title, message)
      VALUES (v_act_target, v_type, '096 test T4', 'post-fix active-partnership write');
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      IF v_rows = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T4  active vendor write, post-fix', 44) || rpad('PASS', 14)
          || '1 row - an ACTIVE partnership still delivers. The ALTER added an arm rather than replacing one.';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T4  active vendor write, post-fix', 44) || rpad('FAIL', 14)
          || format('matched %s rows, expected 1', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T4  active vendor write, post-fix', 44) || rpad('FAIL', 14)
          || '42501. AN ACTIVE PARTNERSHIP THAT WORKS TODAY HAS STOPPED WORKING. The ALTER replaced an arm instead of adding one. DO NOT APPLY.';
        v_fail := v_fail + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T4  active vendor write, post-fix', 44) || rpad('FAIL', 14)
          || format('unexpected %s: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T5. THE BOUNDARY. No partnership of any status, and not a colleague.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_pend_actor IS NULL AND v_act_actor IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T5  stranger write, post-fix', 44) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no actor was resolved at all, so there is nobody to refuse a stranger on behalf of.';
    v_inconc := v_inconc + 1;
  ELSIF v_stranger IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T5  stranger write, post-fix', 44) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: every user in this database is either a colleague of the actor or a member of an organization the actor has SOME partnership with, so "096 must still refuse a stranger" has no stranger to refuse. THIS RUN CANNOT SHOW THE WIDENING HAS A BOUNDARY. DO NOT APPLY on it.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', COALESCE(v_pend_actor, v_act_actor)::text, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_pend_actor, v_act_actor)::text, true);
      SET LOCAL ROLE authenticated;

      INSERT INTO public.notifications (user_id, type, title, message)
      VALUES (v_stranger, v_type, '096 test T5', 'post-fix stranger write');
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T5  stranger write, post-fix', 44) || rpad('FAIL', 14)
        || format('write SUCCEEDED (%s row) to a user with NO partnership of any status. 096 HAS OPENED THE NOTIFICATIONS TABLE TO EVERYBODY. DO NOT APPLY.', v_rows);
      v_fail := v_fail + 1;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T5  stranger write, post-fix', 44) || rpad('PASS', 14)
          || '42501 refused - THE WIDENING HAS A BOUNDARY. It is over the STATUS of a relationship, not over its existence.';
        v_pass := v_pass + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T5  stranger write, post-fix', 44) || rpad('FAIL', 14)
          || format('unexpected %s: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T6. THE 'removed' RULING, ASSERTED.
  --
  -- >>> THIS ASSERTION IS THE EXECUTABLE FORM OF A RULING GREG HAS NOT
  -- >>> MADE. 096 EXCLUDES 'removed', so PASS = REFUSED. If he rules the
  -- >>> other way, invert this block and the IN list in 096 together -
  -- >>> never one without the other.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_rem_actor IS NULL OR v_rem_target IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T6  removed vendor write, post-fix', 44) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no partnership with status=''removed'' and a non-null vendor_org_id has members on both sides. Expected on this database - app/api/partner/partnerships/claim/route.ts:65 claims only ''pending'' and ''active'' rows, so a removed partnership rarely carries a vendor_org_id at all, which is also why the ''removed'' ruling has near-zero live blast radius in EITHER direction. Not synthesized: arranging the status is arranging the fact under test.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_rem_actor::text, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', v_rem_actor::text, true);
      SET LOCAL ROLE authenticated;

      INSERT INTO public.notifications (user_id, type, title, message)
      VALUES (v_rem_target, v_type, '096 test T6', 'post-fix removed-partnership write');
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T6  removed vendor write, post-fix', 44) || rpad('FAIL', 14)
        || format('write SUCCEEDED (%s row) across a REMOVED partnership. 096''s status list says ''removed'' is excluded, so either the IN list is wrong or another arm is admitting this. DO NOT APPLY until you know which.', v_rows);
      v_fail := v_fail + 1;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T6  removed vendor write, post-fix', 44) || rpad('PASS', 14)
          || '42501 refused - matches 096''s ruling that a dismissed relationship stays outside the commercial line. GREG STILL OWES THIS RULING; this line is what a change to it would invert.';
        v_pass := v_pass + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T6  removed vendor write, post-fix', 44) || rpad('FAIL', 14)
          || format('unexpected %s: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T7. 094's ARM IS UNDISTURBED.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_col_owner IS NULL OR v_col_mate IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T7  colleague write, post-fix (094)', 44) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no organization has two members, so 094''s arm cannot be exercised. As of 2026-08-25 `markant` had two - establish what changed.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_col_owner::text, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', v_col_owner::text, true);
      SET LOCAL ROLE authenticated;

      INSERT INTO public.notifications (user_id, type, title, message)
      VALUES (v_col_mate, v_type, '096 test T7', 'post-fix colleague write');
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      IF v_rows = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T7  colleague write, post-fix (094)', 44) || rpad('PASS', 14)
          || '1 row - 094''s own-organization arm is undisturbed';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T7  colleague write, post-fix (094)', 44) || rpad('FAIL', 14)
          || format('matched %s rows, expected 1', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T7  colleague write, post-fix (094)', 44) || rpad('FAIL', 14)
          || '42501. THIS FILE UNDID 094 and every colleague notification has just stopped. DO NOT APPLY.';
        v_fail := v_fail + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T7  colleague write, post-fix (094)', 44) || rpad('FAIL', 14)
          || format('unexpected %s: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T8. ALL FOUR ARMS PRESENT IN THE TEXT. READ-ONLY.
  -- ===================================================================
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    SELECT with_check INTO v_check FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications'
      AND policyname = 'Scoped insert notifications';

    IF v_check IS NULL THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T8  four arms present in with_check', 44) || rpad('FAIL', 14)
        || 'no policy named "Scoped insert notifications" on public.notifications. The name has DRIFTED. 096''s ALTER would raise 42704 - which is the safe failure, but it means 096 cannot apply as written.';
      v_fail := v_fail + 1;
    ELSIF position('auth.uid' in v_check) > 0
      AND position('current_user_org_member_user_ids' in v_check) > 0
      AND position('current_user_active_counterparty_user_ids' in v_check) > 0
      AND position('current_user_commercial_counterparty_user_ids' in v_check) > 0 THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T8  four arms present in with_check', 44) || rpad('PASS', 14)
        || 'auth.uid + org_member + active_counterparty + commercial_counterparty all present - the ALTER extended the predicate rather than replacing it';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T8  four arms present in with_check', 44) || rpad('FAIL', 14)
        || format('an arm is MISSING. Live with_check: %s', v_check);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T8  four arms present in with_check', 44) || rpad('FAIL', 14)
        || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- ===================================================================
  -- T9. THE POLICY COUNT DID NOT MOVE. READ-ONLY.
  -- ===================================================================
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    SELECT count(*) INTO v_policies_after FROM pg_policies WHERE schemaname = 'public';
    IF v_policies_after = v_policies_before THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  policy count unchanged', 44) || rpad('PASS', 14)
        || format('%s before, %s after', v_policies_before, v_policies_after);
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  policy count unchanged', 44) || rpad('FAIL', 14)
        || format('%s before, %s after. ALTER POLICY creates and drops nothing - a DROP/CREATE has crept in, and two permissive INSERT policies would OR together.', v_policies_before, v_policies_after);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  policy count unchanged', 44) || rpad('FAIL', 14)
        || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  RESET ROLE;

  -- ===================================================================
  -- THE VERDICT.
  -- ===================================================================
  IF v_fail = 0 AND v_inconc = 0 AND v_ran = 9 AND v_pass = 9 THEN
    v_verdict_text := 'SAFE TO APPLY 096.';
    v_headline     := format('SAFE TO APPLY 096.  All %s assertions passed.', v_pass);
  ELSIF v_inconc > 0 AND v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised - read the INCONCLUSIVE line(s) below. Settle it before applying.';
    -- NOT A GREEN LIGHT, and the first line has to say so. Nothing
    -- FAILED, but something 096 exists to do was never attempted, so this
    -- run says nothing at all about it. Two benign cases: a re-run against
    -- an ALREADY-APPLIED 096, where T1 is inconclusive by construction;
    -- and T6, whose subject rarely exists on this schema.
    v_headline     := format('DO NOT APPLY 096 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 096 does what it claims. It is not a green light. (If 096 is ALREADY APPLIED, T1 is inconclusive by construction - read the T1 line. T6 is commonly inconclusive because no ''removed'' partnership carries a vendor_org_id.)', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline     := format('DO NOT APPLY 096.  %s assertion(s) FAILED.', v_fail);
  END IF;

  -- THE SYNTHETIC TAG OUTRANKS A CLEAN HEADLINE. A run whose central
  -- subject was arranged by this transaction is evidence about the
  -- POLICY, not about the DATA, and it must not read like both.
  IF v_pend_synth THEN
    v_headline := v_headline || ' [SYNTHETIC PENDING SUBJECT: no partnership in this database has status=''pending'' with a claimed vendor, so this transaction set one to ''pending'' to create the population 096 is written for. The POLICY behaviour proven here is real; the claim that such a row exists in production today is NOT made.]';
  END IF;

  -- THE SELF-CHECK OVERRIDES THE HEADLINE. If an assertion ran without
  -- logging a line, the report is incomplete and no verdict drawn from it
  -- can be trusted, INCLUDING A CLEAN ONE. That has to outrank SAFE TO
  -- APPLY, so it is applied after everything above rather than folded in.
  IF v_logged <> v_ran THEN
    v_headline := format('DO NOT APPLY 096.  THE TEST ITSELF IS BROKEN: %s assertions ran but %s logged a verdict. The report below is incomplete and no verdict drawn from it means anything.', v_ran, v_logged);
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
    || format(E'notification type used : %s   (%s)\n', v_type, v_type_note)
    || format(E'pending partnership    : %s  lead %s  vendor %s  %s\n',
              COALESCE(v_pend_part::text, 'NONE'), COALESCE(v_pend_lead::text, '-'),
              COALESCE(v_pend_vend::text, '-'),
              CASE WHEN v_pend_synth THEN 'SYNTHESIZED BY THIS TRANSACTION' ELSE 'real row' END)
    || format(E'  actor / target       : %s  ->  %s\n',
              COALESCE(v_pend_actor::text, 'NONE'), COALESCE(v_pend_target::text, 'NONE'))
    || format(E'active partnership     : %s  actor %s  ->  target %s\n',
              COALESCE(v_act_part::text, 'NONE'), COALESCE(v_act_actor::text, 'NONE'),
              COALESCE(v_act_target::text, 'NONE'))
    || format(E'removed partnership    : %s  actor %s  ->  target %s\n',
              COALESCE(v_rem_part::text, 'NONE'), COALESCE(v_rem_actor::text, 'NONE'),
              COALESCE(v_rem_target::text, 'NONE'))
    || format(E'stranger               : %s\n', COALESCE(v_stranger::text, 'NONE'))
    || format(E'colleague pair         : %s  ->  %s   (org %s)\n',
              COALESCE(v_col_owner::text, 'NONE'), COALESCE(v_col_mate::text, 'NONE'),
              COALESCE(v_col_org_name, 'NONE'))
    || format(E'policies before        : %s\n', v_policies_before)
    || E'\n'
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'-----------------------------------------------------'
    || v_lines
    || E'\n=====================================================\n'
    || E'This error IS the result. The transaction is rolled back with it.\n';

  -- >>> THE RESULT ARRIVES AS AN ERROR, AND THAT IS THE DESIGN. <<<
  --
  -- NO CUSTOM ERRCODE. This is not a database condition and must never be
  -- mistaken for one of the LG0xx codes 089, 090, 091 and 092 define. The
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
-- transaction is still open and still holds A CREATE FUNCTION, THREE
-- GRANT CHANGES, AN ALTER POLICY ON A LIVE TABLE, POSSIBLY ONE UPDATED
-- partnerships.status, and up to seven real notifications rows. This line
-- is the only thing that undoes them.
--
-- >>> THE ALTER POLICY IS WHY THIS MATTERS. Without it this file would
-- >>> leave a WIDENED RLS POLICY on a live table, applied by a file whose
-- >>> header says it applies nothing.
-- =====================================================================
ROLLBACK;
