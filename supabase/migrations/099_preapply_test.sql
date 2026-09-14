-- =====================================================================
-- 099 PRE-APPLY TEST. ONE PASTE. ALTERS, WRITES, THEN ROLLS BACK.
--
-- WHY THIS FILE EXISTS AND WHY IT IS NOT OPTIONAL.
--
-- A dry run of 099 proves the file parses and that its statements do not
-- collide with anything already there. It says NOTHING about the only
-- question that matters:
--
--   >>> AFTER 099, CAN A VENDOR SET AN AGENCY-OWNED STATUS ON THEIR OWN
--   >>> INBOX ROW, OR HAND THAT ROW TO ANOTHER ORGANIZATION?
--
-- 099 widens a CHECK constraint on a column vendors can already write,
-- and it narrows the vendor UPDATE policy in the same transaction so
-- that they cannot. BOTH of those statements apply perfectly and report
-- success whether or not the second one actually took. The only way to
-- find out is to become a vendor and try it.
--
-- THAT IS T7a THROUGH T7j - ONE ASSERTION PER EXCLUDED STATUS, TEN OF
-- THEM - AND T14 FOR THE IDENTITY HALF. THEY ARE WHAT THIS FILE EXISTS
-- FOR.
--
-- >>> AND T8, T8b, T8c AND T15 ARE THEIR COUNTERWEIGHTS, WHICH MATTER
-- >>> JUST AS MUCH. A policy that refuses everything passes all ten
-- >>> refusal assertions and breaks the vendor portal for every user on
-- >>> the platform. T8 proves a vendor can still OPEN an RFP whose status
-- >>> the agency last set, T8b that they can still SUBMIT A BID, T15 that
-- >>> they can still CLAIM AN INVITATION. Too tight is a worse outcome
-- >>> than the hole.
--
-- The third one that matters is T10: an agency must not be able to
-- close another agency's RFP. 099 creates the first lead-agency UPDATE
-- policy this table has ever had, and a predicate that admitted one
-- agency too many would be invisible until somebody noticed their
-- requests closing themselves.
--
-- >>> TWENTY-SEVEN ASSERTIONS RUN. If you read four, read the T7 BLOCK
-- >>> (ten lines, one per excluded status), T14 (identity), T8 (the
-- >>> too-tight guard) and T10 (cross-agency).
--
-- =====================================================================
-- WHAT THIS ONE ALTERS, WHICH IS MORE THAN 098's TEST DID
-- =====================================================================
--
-- Section A applies 099 inside this transaction. At the moment of the
-- final RAISE, this transaction holds:
--
--   partner_rfp_inbox with a WIDENED status CHECK, a NEW COLUMN, a NEW
--   UPDATE POLICY and its VENDOR UPDATE POLICY REWRITTEN; notifications
--   with a WIDENED type CHECK; plus this file's own test writes.
--
-- The ROLLBACK at the foot is what undoes all of it. See the BACKSTOP
-- note there - it is not dead code.
--
-- =====================================================================
-- IT IMPERSONATES THREE PEOPLE. IT HAS TO.
-- =====================================================================
--
-- Run as the table owner or the service role and RLS is bypassed, every
-- write below succeeds, and this file reports a clean sweep while
-- measuring nothing at all. Every write assertion sets both JWT GUCs and
-- SET LOCAL ROLE authenticated first.
--
--   the VENDOR        - a member of the organization that RECEIVED the
--                       subject inbox row. T7 and T8 are about them.
--   the LEAD MEMBER   - a member of the organization that SENT it.
--                       T9 and T11 are about them.
--   the OTHER AGENCY  - >>> a member of a DIFFERENT organization that
--                       has its own inbox rows and none of the subject's.
--                       This actor exists only for T10.
--
-- T1 and T2 are the controls that prove impersonation took at all. If
-- either fails, nothing below distinguishes a policy refusal from a
-- harness that never worked.
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
-- This is the mechanism established in docs/091-preapply-test.sql and
-- re-used by 092, 094, 096, 097 and 098. RAISE NOTICE does not survive
-- the Supabase SQL Editor, which has no Messages panel.
--
-- =====================================================================
-- INCONCLUSIVE IS NOT A PASS, AND T7 IS WHERE THAT MATTERS
-- =====================================================================
--
-- Every assertion that cannot find a subject reports INCONCLUSIVE and
-- the headline says DO NOT APPLY YET. THAT IS CORRECT AND MUST NOT BE
-- OVERRIDDEN BY EDITING THIS FILE.
--
-- If T7 is the inconclusive one, this database has no inbox row whose
-- vendor organization has a claimed member - 079:953 records
-- vendor_org_id as NULL on 8 of 88 rows, and the vendor may also simply
-- have no org_members row. It means THE ONE DEFECT 099'S SECTION 4b
-- EXISTS TO PREVENT HAS NOT BEEN DEMONSTRATED TO BE PREVENTED. Greg's
-- options are to claim a vendor account in a non-production copy and
-- re-run, or to apply 099 knowing that boundary is argued but unmeasured.
-- That is his call and it should be made explicitly, not by a green
-- headline that was never earned.
--
-- =====================================================================
-- CONTAMINATION, AND THE ORDER THAT AVOIDS IT
-- =====================================================================
--
-- Every assertion runs in ONE transaction, so each one's writes are
-- visible to the next. The order below is chosen so no assertion depends
-- on a row a later one changes:
--
--   T3  runs before ANY write, so its signature sees only 099's effect.
--   T4/T5/T6 are constraint probes on a scratch row and roll their own
--       effects back via savepoint-shaped BEGIN/EXCEPTION blocks.
--   T7  THE BLOCK MUST RUN BEFORE T9. T9 legitimately closes the subject
--       row; if it ran first, the T7 probes would be attempting to change
--       an already-closed row and a zero-row result would be ambiguous.
--       Each T7 iteration restores the status before the next one runs,
--       so no probe measures a row an earlier probe moved.
--   T8/T8b/T8c deliberately PARK the row at a chosen status as the owner
--       first, then act as the vendor, then restore. That is how they
--       measure the case that actually breaks rather than whatever the
--       row happened to be at.
--   T15 UNCLAIMS the row as the owner before the vendor re-claims it,
--       then puts the original vendor_org_id back. Without the unclaim it
--       would be writing the value the row already holds and would pass
--       without proving anything.
--   T8  restores the subject row's status to what it was, so T9 starts
--       from a known open state.
--   T10/T11 write nothing that survives.
--
-- SECTION A CARRIES `DROP POLICY IF EXISTS` FOR THE NEW POLICY so that a
-- re-run against an already-applied 099 measures something instead of
-- raising 42710.
-- =====================================================================


BEGIN;


DO $test$
DECLARE
  -- the subject inbox row and its two sides
  v_inbox          uuid;
  v_inbox_status   text;
  v_scope          text;
  v_lead_org       uuid;
  v_vendor_org     uuid;
  v_lead_member    uuid;
  v_vendor_member  uuid;
  -- the third actor
  v_other_org      uuid;
  v_other_member   uuid;
  v_other_inbox    uuid;
  -- machinery
  v_claims_vendor  text;
  v_claims_lead    text;
  v_claims_other   text;
  v_rows           integer;
  v_count          integer;
  v_probe          uuid;
  v_person         uuid;
  v_probe_status   text;
  v_leaked         integer := 0;
  v_inbox_vendor   uuid;
  -- BEFORE measurements, captured before section A runs
  v_pre_total      integer;
  v_pre_sig        text;
  v_post_total     integer;
  v_post_sig       text;
  v_pre_notif      integer;
  v_post_notif     integer;
  v_policies_before integer;
  v_policies_after  integer;
  v_col_exists     boolean;
  v_closed_rows    integer;
  v_099_applied    boolean;
  v_pass           integer := 0;
  v_fail           integer := 0;
  v_inconc         integer := 0;
  v_ran            integer := 0;
  v_logged         integer := 0;
  v_verdict_text   text;
  v_lines          text := '';
  v_headline       text;
  v_report         text;
BEGIN

  -- ===================================================================
  -- PRECONDITION. The table and the constraint must be where 099 thinks.
  -- ===================================================================
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'partner_rfp_inbox'
  ) THEN
    RAISE EXCEPTION E'\n=====================================================\nCANNOT RUN. public.partner_rfp_inbox DOES NOT EXIST.\n=====================================================\nThis is not the right database. NOTHING WAS CHANGED.\n';
  END IF;

  SELECT count(*) INTO v_policies_before FROM pg_policies WHERE schemaname = 'public';

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_rfp_inbox'
      AND column_name = 'closed_at'
  ) INTO v_099_applied;

  -- ===================================================================
  -- >>> THE BEFORE MEASUREMENT. CAPTURED BEFORE SECTION A ALTERS
  -- >>> ANYTHING AND BEFORE THIS FILE WRITES ANY ROW.
  --
  -- The signature is PER ROW, not just a count: md5 over every row's id
  -- paired with its status, ordered by id. A count alone would miss one
  -- row's status changing while another's changed back. This catches it.
  -- ===================================================================
  SELECT count(*),
         COALESCE(md5(string_agg(id::text || ':' || status, ',' ORDER BY id)), 'EMPTY')
    INTO v_pre_total, v_pre_sig
  FROM public.partner_rfp_inbox;

  SELECT count(*) INTO v_pre_notif FROM public.notifications;

  -- ===================================================================
  -- SECTION A. 099 APPLIED, INSIDE THIS TRANSACTION.
  -- Kept in step with supabase/migrations/099_rfp_closure.sql EXCEPT for
  -- the DROP POLICY IF EXISTS line. See the header.
  -- ===================================================================
  RESET ROLE;

  ALTER TABLE public.partner_rfp_inbox
    DROP CONSTRAINT IF EXISTS partner_rfp_inbox_status_check,
    ADD  CONSTRAINT partner_rfp_inbox_status_check CHECK (
      status IN ('new','viewed','bid_submitted','feedback_received',
                 'revision_submitted','shortlisted','meeting_requested',
                 'awarded','declined','closed','not_selected'));

  ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS notifications_type_check,
    ADD  CONSTRAINT notifications_type_check CHECK (
      type IN ('partnership_invitation','partnership_accepted','project_assignment',
               'project_accepted','project_declined','new_message','document_uploaded',
               'project_awarded','partnership_declined','onboarding_deployed',
               'bid_submitted','rfp_closed','rfp_not_selected'));

  ALTER TABLE public.partner_rfp_inbox
    ADD COLUMN IF NOT EXISTS closed_at timestamptz NULL;

  DROP POLICY IF EXISTS "Agencies update own partner RFP inbox rows"
    ON public.partner_rfp_inbox;

  CREATE POLICY "Agencies update own partner RFP inbox rows"
    ON public.partner_rfp_inbox AS PERMISSIVE FOR UPDATE TO authenticated
    USING      (lead_org_id IN (SELECT public.current_user_org_ids()))
    WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

  CREATE OR REPLACE FUNCTION public.partner_rfp_inbox_status_before(p_id uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $before$
    SELECT i.status FROM public.partner_rfp_inbox i WHERE i.id = p_id;
  $before$;

  REVOKE EXECUTE ON FUNCTION public.partner_rfp_inbox_status_before(uuid) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.partner_rfp_inbox_status_before(uuid) FROM anon;
  GRANT  EXECUTE ON FUNCTION public.partner_rfp_inbox_status_before(uuid) TO authenticated;

  ALTER POLICY "Partners update own inbox rows"
    ON public.partner_rfp_inbox
    WITH CHECK (
      (
        vendor_org_id IN (SELECT public.current_user_org_ids())
        OR (recipient_email IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.profiles pr
              WHERE pr.id = auth.uid()
                AND lower(btrim(pr.email)) = lower(btrim(partner_rfp_inbox.recipient_email))))
      )
      AND (
        vendor_org_id IS NULL
        OR vendor_org_id IN (SELECT public.current_user_org_ids())
      )
      AND (
        status = public.partner_rfp_inbox_status_before(id)
        OR (
          status = 'bid_submitted'
          AND public.partner_rfp_inbox_status_before(id) <> 'closed'
          AND public.partner_rfp_inbox_status_before(id) <> 'not_selected'
        )
      )
    );

  SELECT count(*) INTO v_policies_after FROM pg_policies WHERE schemaname = 'public';

  -- ===================================================================
  -- T3. EVERY PRE-EXISTING ROW SURVIVES 099 UNCHANGED.
  -- RUNS IMMEDIATELY, BEFORE ANY TEST WRITE, so at the moment it runs
  -- the only thing that has happened to the table is 099 itself.
  -- ===================================================================
  SELECT count(*),
         COALESCE(md5(string_agg(id::text || ':' || status, ',' ORDER BY id)), 'EMPTY')
    INTO v_post_total, v_post_sig
  FROM public.partner_rfp_inbox;

  SELECT count(*) INTO v_post_notif FROM public.notifications;

  v_ran := v_ran + 1;
  IF v_pre_total = 0 THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T3  every pre-existing row survives', 48) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: partner_rfp_inbox is EMPTY, so the widened constraint had no live data to validate against and this proved nothing. Phase 0 measured 97 rows on 2026-09-14; if this database really holds zero, you are not looking at production.';
    v_inconc := v_inconc + 1;
  ELSIF v_post_total = v_pre_total AND v_post_sig = v_pre_sig AND v_post_notif = v_pre_notif THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T3  every pre-existing row survives', 48) || rpad('PASS', 14)
      || format('all %s inbox row(s) and %s notification row(s) intact, per-row status signature identical', v_pre_total, v_pre_notif);
    v_pass := v_pass + 1;
  ELSE
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T3  every pre-existing row survives', 48) || rpad('FAIL', 14)
      || format('LIVE DATA CHANGED. inbox before: %s rows sig %s | after: %s rows sig %s. notifications before %s after %s. DO NOT APPLY.',
                v_pre_total, left(v_pre_sig,8), v_post_total, left(v_post_sig,8), v_pre_notif, v_post_notif);
    v_fail := v_fail + 1;
  END IF;

  -- ===================================================================
  -- SUBJECT RESOLUTION. ALL OF IT, BEFORE ANY REMAINING ASSERTION.
  --
  -- WANTED: an inbox row whose LEAD org has a member, whose VENDOR org
  -- has a member who is NOT also on the lead side, and whose status is
  -- one a vendor could legitimately be holding. The "not also on the
  -- lead side" half is what makes T7 mean anything - a person on both
  -- sides would be admitted legitimately by the AGENCY policy and would
  -- prove nothing about the vendor boundary.
  --
  -- vendor_org_id is NULL on some rows (079:953) and many vendors have
  -- no org_members row at all, so this may find nothing. That is
  -- reported, not worked around.
  -- ===================================================================
  SELECT i.id, i.status, i.scope_item_name, i.lead_org_id, i.vendor_org_id
    INTO v_inbox, v_inbox_status, v_scope, v_lead_org, v_vendor_org
  FROM public.partner_rfp_inbox i
  WHERE i.vendor_org_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = i.lead_org_id)
    AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = i.vendor_org_id
        AND NOT EXISTS (SELECT 1 FROM public.org_members m2
                        WHERE m2.org_id = i.lead_org_id AND m2.user_id = m.user_id))
  ORDER BY i.created_at DESC, i.id
  LIMIT 1;

  -- FALLBACK: a row with a usable LEAD side but no usable vendor side.
  -- T9, T10 and T11 can still run; T7 and T8 cannot, and say so.
  IF v_inbox IS NULL THEN
    SELECT i.id, i.status, i.scope_item_name, i.lead_org_id, i.vendor_org_id
      INTO v_inbox, v_inbox_status, v_scope, v_lead_org, v_vendor_org
    FROM public.partner_rfp_inbox i
    WHERE EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = i.lead_org_id)
    ORDER BY i.created_at DESC, i.id
    LIMIT 1;
  END IF;

  IF v_lead_org IS NOT NULL THEN
    SELECT m.user_id INTO v_lead_member
    FROM public.org_members m WHERE m.org_id = v_lead_org
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

  -- THE THIRD ACTOR. A DIFFERENT lead organization, with a member, that
  -- does NOT own the subject row. T10 is the only thing it is for.
  IF v_lead_org IS NOT NULL THEN
    SELECT i.lead_org_id, i.id INTO v_other_org, v_other_inbox
    FROM public.partner_rfp_inbox i
    WHERE i.lead_org_id <> v_lead_org
      AND EXISTS (
        SELECT 1 FROM public.org_members m
        WHERE m.org_id = i.lead_org_id
          AND NOT EXISTS (SELECT 1 FROM public.org_members m2
                          WHERE m2.org_id = v_lead_org AND m2.user_id = m.user_id))
    ORDER BY i.id
    LIMIT 1;

    IF v_other_org IS NOT NULL THEN
      SELECT m.user_id INTO v_other_member
      FROM public.org_members m
      WHERE m.org_id = v_other_org
        AND NOT EXISTS (SELECT 1 FROM public.org_members m2
                        WHERE m2.org_id = v_lead_org AND m2.user_id = m.user_id)
      ORDER BY m.user_id LIMIT 1;
    END IF;
  END IF;

  SELECT p.id INTO v_person FROM public.profiles p ORDER BY p.id LIMIT 1;

  v_claims_vendor := json_build_object('sub', COALESCE(v_vendor_member, '00000000-0000-0000-0000-000000000000'::uuid)::text, 'role','authenticated')::text;
  v_claims_lead   := json_build_object('sub', COALESCE(v_lead_member,   '00000000-0000-0000-0000-000000000000'::uuid)::text, 'role','authenticated')::text;
  v_claims_other  := json_build_object('sub', COALESCE(v_other_member,  '00000000-0000-0000-0000-000000000000'::uuid)::text, 'role','authenticated')::text;

  -- ===================================================================
  -- T1. CONTROL. The VENDOR reads their own inbox row through RLS.
  -- If this fails, nothing below tells a policy refusal from an
  -- impersonation that never took.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_vendor_member IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T1  control: vendor sees own inbox row', 48) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no inbox row whose vendor organization has a claimed member outside the lead side. T7 and T8 cannot run either.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_vendor,       true);
      PERFORM set_config('request.jwt.claim.sub', v_vendor_member::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_count FROM public.partner_rfp_inbox WHERE id = v_inbox;
      RESET ROLE;
      IF v_count = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T1  control: vendor sees own inbox row', 48) || rpad('PASS', 14)
          || 'impersonation took and RLS lets the vendor read the row addressed to them';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T1  control: vendor sees own inbox row', 48) || rpad('FAIL', 14)
          || format('the vendor could not read their own inbox row (%s rows). The harness is broken; every vendor-side result below is meaningless.', v_count);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T1  control: vendor sees own inbox row', 48) || rpad('FAIL', 14)
        || format('%s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T2. CONTROL. The LEAD MEMBER reads the same row through RLS.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_lead_member IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T2  control: agency sees own inbox row', 48) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no inbox row whose lead organization has a member. Every agency-side result below is ambiguous.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_lead,       true);
      PERFORM set_config('request.jwt.claim.sub', v_lead_member::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_count FROM public.partner_rfp_inbox WHERE id = v_inbox;
      RESET ROLE;
      IF v_count = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T2  control: agency sees own inbox row', 48) || rpad('PASS', 14)
          || 'impersonation took and RLS lets the lead agency read the row it sent';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T2  control: agency sees own inbox row', 48) || rpad('FAIL', 14)
          || format('the lead agency could not read its own inbox row (%s rows).', v_count);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T2  control: agency sees own inbox row', 48) || rpad('FAIL', 14)
        || format('%s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T4. THE WIDENED STATUS CHECK ACCEPTS BOTH NEW VALUES.
  -- Runs as the table owner, RLS bypassed, so it measures the CONSTRAINT
  -- and only the constraint. A failure here is 23514 and means section 1
  -- of 099 did not take.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_inbox IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T4  constraint accepts both new values', 48) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no inbox row at all to write to.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      UPDATE public.partner_rfp_inbox SET status = 'closed'       WHERE id = v_inbox;
      UPDATE public.partner_rfp_inbox SET status = 'not_selected' WHERE id = v_inbox;
      UPDATE public.partner_rfp_inbox SET status = v_inbox_status WHERE id = v_inbox;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  constraint accepts both new values', 48) || rpad('PASS', 14)
        || format('both closed and not_selected accepted, row restored to %s', v_inbox_status);
      v_pass := v_pass + 1;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  constraint accepts both new values', 48) || rpad('FAIL', 14)
        || format('%s: %s - section 1 of 099 did not take.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T5. THE STATUS CHECK STILL CONSTRAINS. A widening that accepts
  -- anything is not a widening, it is a removal. THE ERROR IS THE PASS.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_inbox IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T5  status check still refuses garbage', 48) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      UPDATE public.partner_rfp_inbox SET status = 'definitely_not_real' WHERE id = v_inbox;
      UPDATE public.partner_rfp_inbox SET status = v_inbox_status WHERE id = v_inbox;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T5  status check still refuses garbage', 48) || rpad('FAIL', 14)
        || '>>> AN ARBITRARY STRING WAS ACCEPTED. The DROP ran and the ADD did not. The column is UNCONSTRAINED. DO NOT APPLY.';
      v_fail := v_fail + 1;
    EXCEPTION WHEN check_violation THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T5  status check still refuses garbage', 48) || rpad('PASS', 14)
        || '23514 as expected - the constraint still enumerates rather than admitting anything';
      v_pass := v_pass + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T5  status check still refuses garbage', 48) || rpad('FAIL', 14)
        || format('refused, but with %s rather than 23514: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T6. THE NOTIFICATIONS CHECK ACCEPTS BOTH NEW TYPES AND STILL
  -- REFUSES GARBAGE. Both halves, one assertion, because they are one
  -- statement in 099.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_person IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T6  notification types widened correctly', 48) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: profiles is empty, so there is no user_id to address a probe row to.';
    v_inconc := v_inconc + 1;
  ELSE
    DECLARE
      v_accepted boolean := false;
      v_refused  boolean := false;
    BEGIN
      RESET ROLE;
      BEGIN
        INSERT INTO public.notifications (user_id, type, title)
        VALUES (v_person, 'rfp_closed', '099 probe'), (v_person, 'rfp_not_selected', '099 probe');
        v_accepted := true;
      EXCEPTION WHEN OTHERS THEN
        v_accepted := false;
      END;
      BEGIN
        INSERT INTO public.notifications (user_id, type, title)
        VALUES (v_person, 'definitely_not_a_real_type', '099 probe');
        v_refused := false;
      EXCEPTION WHEN check_violation THEN
        v_refused := true;
      WHEN OTHERS THEN
        v_refused := false;
      END;
      DELETE FROM public.notifications WHERE title = '099 probe';

      v_logged := v_logged + 1;
      IF v_accepted AND v_refused THEN
        v_lines := v_lines || E'\n  ' || rpad('T6  notification types widened correctly', 48) || rpad('PASS', 14)
          || 'rfp_closed and rfp_not_selected accepted; an unknown type still raises 23514. Probe rows deleted.';
        v_pass := v_pass + 1;
      ELSIF NOT v_accepted THEN
        v_lines := v_lines || E'\n  ' || rpad('T6  notification types widened correctly', 48) || rpad('FAIL', 14)
          || '>>> THE TWO NEW TYPES WERE REFUSED. Section 2 of 099 did not take. Every closure notification would fail 23514 INSIDE createOrgNotification, which catches and returns 200. Vendors would get the email and no bell and nobody would be told.';
        v_fail := v_fail + 1;
      ELSE
        v_lines := v_lines || E'\n  ' || rpad('T6  notification types widened correctly', 48) || rpad('FAIL', 14)
          || '>>> AN ARBITRARY TYPE WAS ACCEPTED. notifications_type_check was dropped and not replaced.';
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T6  notification types widened correctly', 48) || rpad('FAIL', 14)
        || format('%s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T7a..T7j. >>>>> THE SECURITY BOUNDARY OF THIS MIGRATION. <<<<<
  --
  -- A VENDOR MUST NOT BE ABLE TO SET ANY AGENCY-OWNED STATUS ON THEIR
  -- OWN INBOX ROW. ONE ASSERTION PER EXCLUDED STATUS, NOT ONE COVERING
  -- ALL OF THEM.
  --
  -- WHY PER STATUS AND NOT ONE LOOP VERDICT. A single pass/fail over ten
  -- values tells you the set is wrong and not WHICH value leaked, and the
  -- ten are not equivalent: 'awarded' leaking means a vendor can mark
  -- themselves the winner, 'new' leaking means a vendor can UN-CLOSE a
  -- closed request, and 'closed' leaking means they can close it. Each
  -- gets its own line in the report so the failure names itself.
  --
  -- THE TEN, AND WHO ACTUALLY SETS EACH (see 099's header census):
  --   closed, not_selected           the AGENCY, rfp-closure:190
  --   awarded, shortlisted,
  --   meeting_requested, declined    the AGENCY, rfp-responses/[id]:764
  --   new                            the AGENCY, broadcast INSERT only.
  --                                  >>> THE UN-CLOSE VECTOR.
  --   viewed, feedback_received,
  --   revision_submitted             NOBODY. No write exists anywhere.
  --
  -- EITHER REFUSAL IS A PASS, and the line records WHICH:
  --   42501    the WITH CHECK refused the new row. Clause (C) working.
  --   0 rows   the USING clause refused the row outright, which means
  --            subject resolution picked a row this vendor does not
  --            actually own. Recorded as a pass WITH THAT CAVEAT.
  --
  -- >>> A SUCCESSFUL UPDATE IS THE DEFECT, AND FOR ONE OF THEM IT IS
  -- >>> ALSO THE SIGNATURE OF A SPECIFIC, SILENT FAILURE: if ALL TEN
  -- >>> succeed, clause (C) is VACUOUS, which happens if
  -- >>> partner_rfp_inbox_status_before ever returns the NEW status
  -- >>> instead of the old one. The headline calls that out by name.
  --
  -- RUNS BEFORE T9, which legitimately closes this row.
  -- ===================================================================
  IF v_vendor_member IS NULL OR v_inbox IS NULL THEN
    FOREACH v_probe_status IN ARRAY ARRAY['closed','not_selected','awarded','shortlisted',
                                          'meeting_requested','declined','new','viewed',
                                          'feedback_received','revision_submitted'] LOOP
      v_ran := v_ran + 1;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T7 vendor CANNOT set ' || v_probe_status, 48) || rpad('INCONCLUSIVE', 14)
        || 'NO SUBJECT: no inbox row whose vendor organization has a claimed member outside the lead side.';
      v_inconc := v_inconc + 1;
    END LOOP;
    v_lines := v_lines || E'\n  ' || rpad('   (T7 subject note)', 48) || rpad('', 14)
      || format('vendor_org=%s. 079:953 records vendor_org_id NULL on 8 of 88 rows and many vendors have no org_members row, so this is a plausible shape. >>> THE DEFECT CLAUSE (C) EXISTS TO PREVENT IS ARGUED BUT UNMEASURED. NOT A PASS.', COALESCE(v_vendor_org::text,'none'));
  ELSE
    FOREACH v_probe_status IN ARRAY ARRAY['closed','not_selected','awarded','shortlisted',
                                          'meeting_requested','declined','new','viewed',
                                          'feedback_received','revision_submitted'] LOOP
      v_ran := v_ran + 1;
      BEGIN
        RESET ROLE;
        PERFORM set_config('request.jwt.claims',    v_claims_vendor,       true);
        PERFORM set_config('request.jwt.claim.sub', v_vendor_member::text, true);
        SET LOCAL ROLE authenticated;

        UPDATE public.partner_rfp_inbox SET status = v_probe_status WHERE id = v_inbox;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        RESET ROLE;

        v_logged := v_logged + 1;
        IF v_rows = 0 THEN
          v_lines := v_lines || E'\n  ' || rpad('T7 vendor CANNOT set ' || v_probe_status, 48) || rpad('PASS', 14)
            || 'UPDATE 0 - the USING clause refused before the WITH CHECK was reached. CAVEAT: clause (C) was not exercised by this one.';
          v_pass := v_pass + 1;
        ELSE
          -- Put it back before the next iteration, or every later probe
          -- measures a row this one already moved.
          UPDATE public.partner_rfp_inbox SET status = v_inbox_status WHERE id = v_inbox;
          v_leaked := v_leaked + 1;
          v_lines := v_lines || E'\n  ' || rpad('T7 vendor CANNOT set ' || v_probe_status, 48) || rpad('FAIL', 14)
            || format('>>> THE UPDATE SUCCEEDED (%s row). A VENDOR SET %s ON THEIR OWN ROW. Clause (C) did not refuse it. Row restored. DO NOT APPLY.', v_rows, upper(v_probe_status));
          v_fail := v_fail + 1;
        END IF;
      EXCEPTION
        WHEN insufficient_privilege THEN
          RESET ROLE;
          v_logged := v_logged + 1;
          v_lines := v_lines || E'\n  ' || rpad('T7 vendor CANNOT set ' || v_probe_status, 48) || rpad('PASS', 14)
            || '42501 - clause (C) refused it. THIS IS THE RESULT THIS FILE WAS WRITTEN TO GET.';
          v_pass := v_pass + 1;
        WHEN check_violation THEN
          RESET ROLE;
          v_logged := v_logged + 1;
          v_lines := v_lines || E'\n  ' || rpad('T7 vendor CANNOT set ' || v_probe_status, 48) || rpad('FAIL', 14)
            || format('23514 - the CHECK CONSTRAINT refused %s, not the policy. That means section 1 of 099 did not take, and clause (C) is UNMEASURED for this value.', v_probe_status);
          v_fail := v_fail + 1;
        WHEN OTHERS THEN
          RESET ROLE;
          v_logged := v_logged + 1;
          v_lines := v_lines || E'\n  ' || rpad('T7 vendor CANNOT set ' || v_probe_status, 48) || rpad('FAIL', 14)
            || format('refused, but with %s rather than 42501: %s', SQLSTATE, SQLERRM);
          v_fail := v_fail + 1;
      END;
    END LOOP;
  END IF;

  -- ===================================================================
  -- T7k. 'under_review' IS REFUSED BY THE CONSTRAINT, NOT THE POLICY.
  --
  -- It is a partner_rfp_responses value (scripts/019:8) and is ABSENT
  -- from partner_rfp_inbox_status_check (scripts/019:16-26). It was named
  -- as a gap in this policy and it is not one - it never reaches the
  -- policy at all. Asserted rather than argued so the difference is on
  -- the record, and so that if the inbox constraint is ever widened to
  -- include it, this line flips and somebody has to look.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_vendor_member IS NULL OR v_inbox IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T7k under_review refused by CONSTRAINT', 48) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_vendor,       true);
      PERFORM set_config('request.jwt.claim.sub', v_vendor_member::text, true);
      SET LOCAL ROLE authenticated;
      UPDATE public.partner_rfp_inbox SET status = 'under_review' WHERE id = v_inbox;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;
      v_logged := v_logged + 1;
      IF v_rows = 0 THEN
        v_lines := v_lines || E'\n  ' || rpad('T7k under_review refused by CONSTRAINT', 48) || rpad('PASS', 14)
          || 'UPDATE 0 - refused by the policy first. Also a refusal.';
        v_pass := v_pass + 1;
      ELSE
        UPDATE public.partner_rfp_inbox SET status = v_inbox_status WHERE id = v_inbox;
        v_lines := v_lines || E'\n  ' || rpad('T7k under_review refused by CONSTRAINT', 48) || rpad('FAIL', 14)
          || '>>> ACCEPTED. under_review is not supposed to be a partner_rfp_inbox value at all. Read the live constraint.';
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN check_violation THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T7k under_review refused by CONSTRAINT', 48) || rpad('PASS', 14)
          || '23514 as expected - it is not an inbox status, so the CHECK refuses it before any policy is consulted.';
        v_pass := v_pass + 1;
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T7k under_review refused by CONSTRAINT', 48) || rpad('PASS', 14)
          || '42501 - the policy refused it first. Also a refusal, and it means the constraint was never reached.';
        v_pass := v_pass + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T7k under_review refused by CONSTRAINT', 48) || rpad('FAIL', 14)
          || format('%s: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T8. >>> THE OTHER DIRECTION, AND IT MATTERS AS MUCH AS T7.
  --
  -- TOO TIGHT IS WORSE THAN THE HOLE. A policy that refuses T7's ten AND
  -- ALSO refuses a vendor opening an RFP takes the product down for every
  -- vendor, rather than exposing an edge to a few.
  --
  -- THIS IS THE LOAD-BEARING CASE FOR CLAUSE (C)'s UNCHANGED ARM: a write
  -- that does not touch status at all, on a row whose status the AGENCY
  -- last set. A bare allow-list would 42501 here. It is written against
  -- viewed_at, which is exactly what
  -- app/api/partner/rfps/[id]/route.ts:72 does on first open.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_vendor_member IS NULL OR v_inbox IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T8  vendor CAN still write viewed_at', 48) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: same missing vendor member as T7.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      -- Put the row at an AGENCY-OWNED status first, as the owner, so
      -- this measures the case that actually breaks: a magic-link row
      -- synthesized from an already-decided bid, which carries 'awarded'
      -- and no viewed_at.
      UPDATE public.partner_rfp_inbox SET status = 'awarded' WHERE id = v_inbox;

      PERFORM set_config('request.jwt.claims',    v_claims_vendor,       true);
      PERFORM set_config('request.jwt.claim.sub', v_vendor_member::text, true);
      SET LOCAL ROLE authenticated;

      UPDATE public.partner_rfp_inbox SET viewed_at = now() WHERE id = v_inbox;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      UPDATE public.partner_rfp_inbox SET status = v_inbox_status WHERE id = v_inbox;

      v_logged := v_logged + 1;
      IF v_rows = 1 THEN
        v_lines := v_lines || E'\n  ' || rpad('T8  vendor CAN still write viewed_at', 48) || rpad('PASS', 14)
          || format('the vendor stamped viewed_at on a row sitting at ''awarded'' and clause (C)''s unchanged arm let it through. Row restored to %s.', v_inbox_status);
        v_pass := v_pass + 1;
      ELSE
        v_lines := v_lines || E'\n  ' || rpad('T8  vendor CAN still write viewed_at', 48) || rpad('FAIL', 14)
          || format('UPDATE %s - THE POLICY IS TOO TIGHT. A vendor cannot open an RFP whose status the agency last set. viewed_at, partner_intent, the NDA confirmation and THE CLAIM all go through this policy and all break. This is worse than the hole 099 closes.', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      UPDATE public.partner_rfp_inbox SET status = v_inbox_status WHERE id = v_inbox;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T8  vendor CAN still write viewed_at', 48) || rpad('FAIL', 14)
        || format('%s: %s - clause (C) refused a legitimate vendor write. THE PORTAL WILL BREAK.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T8b. THE VENDOR CAN STILL SUBMIT A BID. The allow-list's one value.
  -- Without this, T7 passing could simply mean the vendor lost write
  -- access to the column entirely.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_vendor_member IS NULL OR v_inbox IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T8b vendor CAN set bid_submitted', 48) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      UPDATE public.partner_rfp_inbox SET status = 'new' WHERE id = v_inbox;

      PERFORM set_config('request.jwt.claims',    v_claims_vendor,       true);
      PERFORM set_config('request.jwt.claim.sub', v_vendor_member::text, true);
      SET LOCAL ROLE authenticated;

      UPDATE public.partner_rfp_inbox SET status = 'bid_submitted' WHERE id = v_inbox;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      UPDATE public.partner_rfp_inbox SET status = v_inbox_status WHERE id = v_inbox;

      v_logged := v_logged + 1;
      IF v_rows = 1 THEN
        v_lines := v_lines || E'\n  ' || rpad('T8b vendor CAN set bid_submitted', 48) || rpad('PASS', 14)
          || 'the one value on the allow-list is accepted, so T7''s refusals are about the VALUE and not about lost write access.';
        v_pass := v_pass + 1;
      ELSE
        v_lines := v_lines || E'\n  ' || rpad('T8b vendor CAN set bid_submitted', 48) || rpad('FAIL', 14)
          || format('UPDATE %s - NO VENDOR ON THE PLATFORM CAN SUBMIT A BID. app/api/partner/rfps/[id]/response/route.ts:368 is the only site that writes this and it goes through this policy.', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      UPDATE public.partner_rfp_inbox SET status = v_inbox_status WHERE id = v_inbox;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T8b vendor CAN set bid_submitted', 48) || rpad('FAIL', 14)
        || format('%s: %s - BID SUBMISSION IS BROKEN.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T8c. >>> A VENDOR CANNOT UN-CLOSE A CLOSED ROW BY BIDDING ON IT.
  --
  -- The one case where the allow-list's single value must STILL be
  -- refused: 'closed' -> 'bid_submitted'. The ROUTE refuses this with a
  -- 409, but a route is not an access control and raw PostgREST does not
  -- go through it. This is the `<> 'closed'` half of clause (C).
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_vendor_member IS NULL OR v_inbox IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T8c closed row REFUSES bid_submitted', 48) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      UPDATE public.partner_rfp_inbox SET status = 'closed' WHERE id = v_inbox;

      PERFORM set_config('request.jwt.claims',    v_claims_vendor,       true);
      PERFORM set_config('request.jwt.claim.sub', v_vendor_member::text, true);
      SET LOCAL ROLE authenticated;

      UPDATE public.partner_rfp_inbox SET status = 'bid_submitted' WHERE id = v_inbox;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;
      UPDATE public.partner_rfp_inbox SET status = v_inbox_status WHERE id = v_inbox;

      v_logged := v_logged + 1;
      IF v_rows = 0 THEN
        v_lines := v_lines || E'\n  ' || rpad('T8c closed row REFUSES bid_submitted', 48) || rpad('PASS', 14)
          || 'UPDATE 0 - refused. A closed request cannot be bid back open.';
        v_pass := v_pass + 1;
      ELSE
        v_lines := v_lines || E'\n  ' || rpad('T8c closed row REFUSES bid_submitted', 48) || rpad('FAIL', 14)
          || format('>>> THE UPDATE SUCCEEDED (%s row). A VENDOR UN-CLOSED A CLOSED REQUEST by bidding on it. Clause (C)''s <> ''closed'' terms did not take.', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        UPDATE public.partner_rfp_inbox SET status = v_inbox_status WHERE id = v_inbox;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T8c closed row REFUSES bid_submitted', 48) || rpad('PASS', 14)
          || '42501 - clause (C) refused it. A closed request cannot be bid back open.';
        v_pass := v_pass + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        UPDATE public.partner_rfp_inbox SET status = v_inbox_status WHERE id = v_inbox;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T8c closed row REFUSES bid_submitted', 48) || rpad('FAIL', 14)
          || format('refused, but with %s: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T9. THE LEAD AGENCY CAN CLOSE ITS OWN ROW.
  --
  -- The positive half of section 4a. Before 099 there is NO lead-agency
  -- UPDATE policy on this table, so this UPDATE matches ZERO ROWS and
  -- PostgREST does not call that an error. If 4a did not take, this
  -- reports UPDATE 0 and the whole Phase 3 close action would have
  -- reported success while changing nothing.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_lead_member IS NULL OR v_inbox IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T9  lead agency CAN close its own row', 48) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no inbox row whose lead organization has a member.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_lead,       true);
      PERFORM set_config('request.jwt.claim.sub', v_lead_member::text, true);
      SET LOCAL ROLE authenticated;

      UPDATE public.partner_rfp_inbox SET status = 'closed', closed_at = now() WHERE id = v_inbox;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      UPDATE public.partner_rfp_inbox SET status = v_inbox_status, closed_at = NULL WHERE id = v_inbox;

      v_logged := v_logged + 1;
      IF v_rows = 1 THEN
        v_lines := v_lines || E'\n  ' || rpad('T9  lead agency CAN close its own row', 48) || rpad('PASS', 14)
          || format('section 4a''s new policy works. Row restored to %s with closed_at NULL.', v_inbox_status);
        v_pass := v_pass + 1;
      ELSE
        v_lines := v_lines || E'\n  ' || rpad('T9  lead agency CAN close its own row', 48) || rpad('FAIL', 14)
          || format('>>> UPDATE %s. The lead agency could not write to its own row, so section 4a did not take. The Phase 3 close route would report SUCCESS and change NOTHING - the exact success-shaped non-event this migration is written to avoid. DO NOT DEPLOY THE CODE.', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      UPDATE public.partner_rfp_inbox SET status = v_inbox_status, closed_at = NULL WHERE id = v_inbox;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  lead agency CAN close its own row', 48) || rpad('FAIL', 14)
        || format('%s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T10. >>>>> THE SECOND BOUNDARY THAT MATTERS. <<<<<
  --
  -- ONE AGENCY MUST NOT BE ABLE TO CLOSE ANOTHER AGENCY'S RFP ROW.
  --
  -- 099 section 4a creates the first lead-agency UPDATE policy this
  -- table has ever had. A predicate that admitted one organization too
  -- many would be invisible until an agency noticed its own requests
  -- closing themselves.
  --
  -- This is the database half of the ownership check. The route half -
  -- resolveCallerWriteOrgId before any write - is Phase 3's, and it is
  -- the primary defence because it produces a 403 rather than a silent
  -- zero-row no-op. THIS assertion is what makes the route's check a
  -- second line rather than the only one.
  --
  -- A refusal is a PASS whichever form it takes: 0 rows (the USING
  -- clause matched nothing) or 42501 (the WITH CHECK refused).
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_other_member IS NULL OR v_inbox IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T10 >>> OTHER AGENCY CANNOT CLOSE IT', 48) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: found no SECOND lead organization with a member of its own that is not also on the subject organization. On a database with one agency this is expected - but the cross-tenant boundary is then UNMEASURED and this is not a pass. The live checklist in the report covers the same ground through the interface.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_other,       true);
      PERFORM set_config('request.jwt.claim.sub', v_other_member::text, true);
      SET LOCAL ROLE authenticated;

      UPDATE public.partner_rfp_inbox SET status = 'closed' WHERE id = v_inbox;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      v_logged := v_logged + 1;
      IF v_rows = 0 THEN
        v_lines := v_lines || E'\n  ' || rpad('T10 >>> OTHER AGENCY CANNOT CLOSE IT', 48) || rpad('PASS', 14)
          || 'UPDATE 0 - section 4a''s USING clause is scoped to the caller''s own organizations and matched nothing. A different agency cannot reach this row.';
        v_pass := v_pass + 1;
      ELSE
        UPDATE public.partner_rfp_inbox SET status = v_inbox_status WHERE id = v_inbox;
        v_lines := v_lines || E'\n  ' || rpad('T10 >>> OTHER AGENCY CANNOT CLOSE IT', 48) || rpad('FAIL', 14)
          || format('>>> THE UPDATE SUCCEEDED (%s row). AN AGENCY CLOSED ANOTHER AGENCY''S RFP REQUEST. Section 4a''s predicate is too wide. This is the unconstrained-identifier class of defect this codebase already shipped once - see migration 085''s header. DO NOT APPLY.', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T10 >>> OTHER AGENCY CANNOT CLOSE IT', 48) || rpad('PASS', 14)
          || '42501 - refused by policy. A different agency cannot close this row.';
        v_pass := v_pass + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T10 >>> OTHER AGENCY CANNOT CLOSE IT', 48) || rpad('FAIL', 14)
          || format('refused, but with %s rather than 42501: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T11. THE AGENCY CANNOT HAND ITS OWN ROW TO ANOTHER ORGANIZATION.
  --
  -- This is what section 4a's WITH CHECK is for, as distinct from its
  -- USING. USING decides which rows may be updated; WITH CHECK decides
  -- what they may be updated TO. With USING alone an agency could move
  -- lead_org_id somewhere the recipient cannot be reached from.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_lead_member IS NULL OR v_inbox IS NULL OR v_other_org IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T11 agency cannot reassign lead_org_id', 48) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: needs both a lead member and a SECOND organization to move the row to.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_lead,       true);
      PERFORM set_config('request.jwt.claim.sub', v_lead_member::text, true);
      SET LOCAL ROLE authenticated;

      UPDATE public.partner_rfp_inbox SET lead_org_id = v_other_org WHERE id = v_inbox;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      UPDATE public.partner_rfp_inbox SET lead_org_id = v_lead_org WHERE id = v_inbox;

      v_logged := v_logged + 1;
      IF v_rows = 0 THEN
        -- The USING clause refused the row before the WITH CHECK was reached.
        -- Still a refusal, still a pass, but it did not exercise WITH CHECK.
        v_lines := v_lines || E'\n  ' || rpad('T11 agency cannot reassign lead_org_id', 48) || rpad('PASS', 14)
          || 'UPDATE 0 - refused before the WITH CHECK was reached. CAVEAT: section 4a''s WITH CHECK was therefore not exercised by this assertion. A 42501 would have been the stronger result.';
        v_pass := v_pass + 1;
      ELSE
        v_lines := v_lines || E'\n  ' || rpad('T11 agency cannot reassign lead_org_id', 48) || rpad('FAIL', 14)
          || format('>>> THE UPDATE SUCCEEDED (%s row). An agency moved its own inbox row to another organization. Section 4a''s WITH CHECK did not take. Row has been moved back.', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T11 agency cannot reassign lead_org_id', 48) || rpad('PASS', 14)
          || '42501 - section 4a''s WITH CHECK refused the new row. An agency cannot hand its rows to another organization.';
        v_pass := v_pass + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T11 agency cannot reassign lead_org_id', 48) || rpad('PASS', 14)
          || format('refused with %s: %s. Not 42501, but refused. A foreign key or another constraint may have caught it first - read it.', SQLSTATE, SQLERRM);
        v_pass := v_pass + 1;
    END;
  END IF;

  -- ===================================================================
  -- T14. >>>>> IDENTITY. A VENDOR CANNOT REASSIGN THE RFP REQUEST. <<<<<
  --
  -- Clause (B). Before it, the WITH CHECK mirrored USING, so a vendor
  -- admitted by the recipient_email arm could write ANY organization id
  -- into vendor_org_id - including one they do not belong to - and the
  -- email arm would still pass them. That is handing an agency's request
  -- to a company of the vendor's choosing.
  --
  -- Uses v_other_org, which is an organization the VENDOR is provably not
  -- a member of (subject resolution picked it as one with no overlap with
  -- the LEAD side; the vendor member was picked as not being on the lead
  -- side either, so it is not the vendor's own org).
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_vendor_member IS NULL OR v_inbox IS NULL OR v_other_org IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T14 >>> VENDOR CANNOT REASSIGN vendor_org', 48) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: needs both a vendor member and a SECOND organization to move the row to. THE IDENTITY BOUNDARY IS UNMEASURED. Not a pass.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      SELECT vendor_org_id INTO v_inbox_vendor FROM public.partner_rfp_inbox WHERE id = v_inbox;

      PERFORM set_config('request.jwt.claims',    v_claims_vendor,       true);
      PERFORM set_config('request.jwt.claim.sub', v_vendor_member::text, true);
      SET LOCAL ROLE authenticated;

      UPDATE public.partner_rfp_inbox SET vendor_org_id = v_other_org WHERE id = v_inbox;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;

      v_logged := v_logged + 1;
      IF v_rows = 0 THEN
        v_lines := v_lines || E'\n  ' || rpad('T14 >>> VENDOR CANNOT REASSIGN vendor_org', 48) || rpad('PASS', 14)
          || 'UPDATE 0 - refused. The row cannot be moved to an organization the caller does not belong to.';
        v_pass := v_pass + 1;
      ELSE
        UPDATE public.partner_rfp_inbox SET vendor_org_id = v_inbox_vendor WHERE id = v_inbox;
        v_lines := v_lines || E'\n  ' || rpad('T14 >>> VENDOR CANNOT REASSIGN vendor_org', 48) || rpad('FAIL', 14)
          || format('>>> THE UPDATE SUCCEEDED (%s row). A VENDOR HANDED AN AGENCY''S RFP REQUEST TO AN ORGANIZATION THEY DO NOT BELONG TO. Clause (B) did not take. Row restored. DO NOT APPLY.', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T14 >>> VENDOR CANNOT REASSIGN vendor_org', 48) || rpad('PASS', 14)
          || '42501 - clause (B) refused it. THIS IS THE RESULT.';
        v_pass := v_pass + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T14 >>> VENDOR CANNOT REASSIGN vendor_org', 48) || rpad('FAIL', 14)
          || format('refused, but with %s rather than 42501: %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T15. THE CLAIM STILL WORKS. Clause (B)'s other direction.
  --
  -- app/api/partner/rfps/claim/route.ts:75-83 writes
  -- `vendor_org_id: writeOrgId` ON THE SESSION CLIENT AS THE VENDOR. It
  -- does NOT use the service role. If clause (B) refused a vendor writing
  -- their OWN organization id, every invitation claim on the platform
  -- would stop working, and T14 would still pass - which is exactly why
  -- this assertion exists beside it.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_vendor_member IS NULL OR v_inbox IS NULL OR v_vendor_org IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15 vendor CAN claim (own org id)', 48) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      SELECT vendor_org_id INTO v_inbox_vendor FROM public.partner_rfp_inbox WHERE id = v_inbox;
      -- Unclaim it as the owner so this measures a real claim and not a
      -- no-op write of the value the row already holds.
      UPDATE public.partner_rfp_inbox SET vendor_org_id = NULL WHERE id = v_inbox;

      PERFORM set_config('request.jwt.claims',    v_claims_vendor,       true);
      PERFORM set_config('request.jwt.claim.sub', v_vendor_member::text, true);
      SET LOCAL ROLE authenticated;

      UPDATE public.partner_rfp_inbox SET vendor_org_id = v_vendor_org WHERE id = v_inbox;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;
      UPDATE public.partner_rfp_inbox SET vendor_org_id = v_inbox_vendor WHERE id = v_inbox;

      v_logged := v_logged + 1;
      IF v_rows = 1 THEN
        v_lines := v_lines || E'\n  ' || rpad('T15 vendor CAN claim (own org id)', 48) || rpad('PASS', 14)
          || 'the vendor wrote their OWN organization id onto an unclaimed row. The claim route still works.';
        v_pass := v_pass + 1;
      ELSE
        v_lines := v_lines || E'\n  ' || rpad('T15 vendor CAN claim (own org id)', 48) || rpad('FAIL', 14)
          || format('UPDATE %s - CLAUSE (B) IS TOO TIGHT AND EVERY INVITATION CLAIM ON THE PLATFORM BREAKS. See app/api/partner/rfps/claim/route.ts:75-83, which runs as the vendor on the session client.', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      UPDATE public.partner_rfp_inbox SET vendor_org_id = v_inbox_vendor WHERE id = v_inbox;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T15 vendor CAN claim (own org id)', 48) || rpad('FAIL', 14)
        || format('%s: %s - THE CLAIM PATH IS BROKEN.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T12. THE COLUMN EXISTS, IS NULLABLE, AND IS EMPTY.
  -- R3 says NO BACKFILL, so every row must still have closed_at NULL.
  -- ===================================================================
  v_ran := v_ran + 1;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_rfp_inbox'
      AND column_name = 'closed_at' AND is_nullable = 'YES'
  ) INTO v_col_exists;
  SELECT count(*) INTO v_closed_rows FROM public.partner_rfp_inbox WHERE closed_at IS NOT NULL;

  v_logged := v_logged + 1;
  IF v_col_exists AND v_closed_rows = 0 THEN
    v_lines := v_lines || E'\n  ' || rpad('T12 closed_at nullable and empty', 48) || rpad('PASS', 14)
      || 'column present, nullable, and no row carries a value. R3: no backfill, and none happened.';
    v_pass := v_pass + 1;
  ELSIF NOT v_col_exists THEN
    v_lines := v_lines || E'\n  ' || rpad('T12 closed_at nullable and empty', 48) || rpad('FAIL', 14)
      || 'the column is absent or NOT NULL. Section 3 of 099 did not take as written.';
    v_fail := v_fail + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('T12 closed_at nullable and empty', 48) || rpad('FAIL', 14)
      || format('%s row(s) already carry a closed_at. This file''s own T9 restores it to NULL, so a non-zero count here means something else wrote one.', v_closed_rows);
    v_fail := v_fail + 1;
  END IF;

  -- ===================================================================
  -- T13. THE POLICY COUNT MOVED BY EXACTLY ONE.
  -- 099 CREATEs one policy and ALTERs one in place. An ALTER adds no row.
  -- A delta of 2 would mean the ALTER became a second permissive policy,
  -- which would OR with the first and bypass the narrowing entirely.
  -- ===================================================================
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  IF v_099_applied THEN
    v_lines := v_lines || E'\n  ' || rpad('T13 policy count moved by exactly one', 48) || rpad('INCONCLUSIVE', 14)
      || format('099 LOOKS ALREADY APPLIED - closed_at existed before section A ran - so section A re-created its policy after dropping it and the delta reads %s rather than 1. Not a failure. Re-read V5 in the migration instead.', v_policies_after - v_policies_before);
    v_inconc := v_inconc + 1;
  ELSIF v_policies_after - v_policies_before = 1 THEN
    v_lines := v_lines || E'\n  ' || rpad('T13 policy count moved by exactly one', 48) || rpad('PASS', 14)
      || format('%s -> %s. One CREATE, one in-place ALTER.', v_policies_before, v_policies_after);
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('T13 policy count moved by exactly one', 48) || rpad('FAIL', 14)
      || format('%s -> %s, a delta of %s. A delta of 2 means the vendor policy ALTER became a second permissive policy, which ORs with the first and BYPASSES THE NARROWING. Re-read section 4b.', v_policies_before, v_policies_after, v_policies_after - v_policies_before);
    v_fail := v_fail + 1;
  END IF;

  -- ===================================================================
  -- THE REPORT
  -- ===================================================================
  IF v_fail = 0 AND v_inconc = 0 THEN
    v_verdict_text := 'PASS';
    v_headline     := format('SAFE TO APPLY 099.  All %s assertions passed.', v_ran);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'INCONCLUSIVE';
    v_headline     := format('DO NOT APPLY 099 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 099 does what it claims. It is not a green light. (If the T7 BLOCK or T14 are among them, THE VENDOR-SIDE EXCLUSIONS - the defects clauses (B) and (C) exist to prevent - ARE UNMEASURED, and widening the status CHECK without them hands every vendor the close action AND the ability to reassign an agency''s request. If T10 is one of them, the cross-agency boundary is unmeasured. See the header.)', v_inconc);
  ELSIF v_leaked >= 10 THEN
    -- >>> THE SPECIFIC, SILENT FAILURE THIS FILE EXISTS TO CATCH.
    -- All ten T7 probes succeeded. That is not ten separate bugs, it is
    -- one: clause (C) evaluated TRUE for every write, which is what
    -- happens if partner_rfp_inbox_status_before returns the NEW status
    -- instead of the old one. Every statement in 099 would have applied
    -- cleanly and reported success while constraining nothing.
    v_verdict_text := 'FAIL';
    v_headline     := format('DO NOT APPLY 099.  >>> ALL %s STATUS PROBES SUCCEEDED, WHICH MEANS CLAUSE (C) IS VACUOUS, NOT THAT TEN THINGS ARE BROKEN. The unchanged-arm comparison is matching on every write. Check that public.partner_rfp_inbox_status_before is declared STABLE (not VOLATILE) - STABLE is what pins its read to the statement-start snapshot, i.e. the PRE-update row. If it is already STABLE, this PostgreSQL version does not give WITH CHECK the semantics 099 assumes and THE DESIGN MUST CHANGE to a BEFORE UPDATE trigger comparing OLD.status.', v_leaked);
  ELSE
    v_verdict_text := 'FAIL';
    v_headline     := format('DO NOT APPLY 099.  %s assertion(s) FAILED.', v_fail);
  END IF;

  IF v_ran <> v_logged THEN
    v_verdict_text := 'BROKEN';
    v_headline := format('DO NOT APPLY 099.  THE TEST ITSELF IS BROKEN: %s assertions ran but %s logged a verdict. The report below is incomplete and no verdict drawn from it means anything.', v_ran, v_logged);
  END IF;

  v_report :=
       E'\n=====================================================\n'
    || '099 PRE-APPLY TEST' || E'\n'
    || E'=====================================================\n'
    || v_headline || E'\n'
    || E'-----------------------------------------------------\n'
    || format(E'assertions             : %s run, %s pass, %s fail, %s inconclusive\n',
              v_ran, v_pass, v_fail, v_inconc)
    || format(E'inbox rows before/after: %s / %s   sig %s / %s  %s\n',
              v_pre_total, v_post_total, left(v_pre_sig,12), left(v_post_sig,12),
              CASE WHEN v_pre_sig = v_post_sig THEN 'IDENTICAL' ELSE 'CHANGED - READ T3' END)
    || format(E'notification rows      : %s / %s\n', v_pre_notif, v_post_notif)
    || format(E'099 already applied?   : %s\n',
              CASE WHEN v_099_applied THEN 'YES - closed_at already existed, so T13 reads INCONCLUSIVE by design' ELSE 'no - this is a first run' END)
    || format(E'subject inbox row      : %s  %s  (status %s)\n',
              COALESCE(v_inbox::text,'NONE'), COALESCE(v_scope,''), COALESCE(v_inbox_status,'-'))
    || format(E'  lead organization    : %s\n', COALESCE(v_lead_org::text,'NONE'))
    || format(E'  lead-side member     : %s\n', COALESCE(v_lead_member::text,'NONE - T2, T9 AND T11 COULD NOT RUN'))
    || format(E'  vendor organization  : %s\n', COALESCE(v_vendor_org::text,'NONE - vendor_org_id is NULL on this row'))
    || format(E'  VENDOR-SIDE member   : %s\n', COALESCE(v_vendor_member::text,'NONE - >>> T7 AND T8 COULD NOT RUN'))
    || format(E'  OTHER agency org     : %s\n', COALESCE(v_other_org::text,'NONE - >>> T10 COULD NOT RUN'))
    || format(E'  OTHER agency member  : %s\n', COALESCE(v_other_member::text,'NONE'))
    || format(E'policies before / after: %s / %s\n', v_policies_before, v_policies_after)
    || format(E'status probes leaked    : %s of 10   %s\n', v_leaked,
              CASE WHEN v_leaked = 0 THEN '(clause C is refusing every agency-owned status)'
                   WHEN v_leaked >= 10 THEN '>>> ALL TEN. CLAUSE (C) IS VACUOUS. READ THE HEADLINE.'
                   ELSE '>>> PARTIAL LEAK. Read which values by name below.' END)
    || E'\n'
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'-----------------------------------------------------'
    || v_lines
    || E'\n=====================================================\n'
    || E'This error IS the result. The transaction is rolled back with it.\n';

  -- >>> THE RESULT ARRIVES AS AN ERROR, AND THAT IS THE DESIGN. <<<
  --
  -- NO CUSTOM ERRCODE. This is not a database condition and must never
  -- be mistaken for one of the LG0xx codes 089-093, 097 and 098 define.
  -- The default P0001 (raise_exception) is correct and deliberate.
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
-- >>> WHAT IS AT STAKE HERE. At the moment of the RAISE this transaction
-- >>> holds partner_rfp_inbox WITH A WIDENED STATUS CHECK, A NEW COLUMN,
-- >>> A NEW UPDATE POLICY AND ITS VENDOR UPDATE POLICY REWRITTEN, plus
-- >>> notifications with a widened type CHECK. Without this ROLLBACK a
-- >>> swallowed exception would leave every one of those COMMITTED by a
-- >>> file whose header says it applies nothing.
-- =====================================================================
ROLLBACK;
