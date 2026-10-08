-- =====================================================================
-- Migration 101: 101_partnership_write_guard.sql
--
-- ONE NEW TRIGGER FUNCTION, ONE NEW TRIGGER, ONE POLICY COMMENT.
--
--   ADDED    public.partnerships_guard_vendor_state()       function
--   ADDED    trigger partnerships_guard_vendor_state         BEFORE UPDATE
--   COMMENT  policy "Partners can update partnership status"  (text only)
--
--   POLICIES ADDED: NONE. POLICIES ALTERED: NONE. POLICIES DROPPED: NONE.
--   COLUMNS ADDED: NONE. DATA WRITTEN: NONE. GRANTS CHANGED: NONE.
--   087's and 093's function partnerships_guard_identity_columns() IS NOT
--   TOUCHED. It is not replaced, not edited, not re-created.
--
-- >>> THE FULL FILENAME IS 101_partnership_write_guard.sql.
--
-- Its rollback sibling is 101_partnership_write_guard_down.sql. A
-- `101_*.sql` glob MATCHES THE DOWN FILE FIRST (`_down` sorts before `.sql`
-- on the character after "guard"), and that is not hypothetical: a 094_*.sql
-- glob once matched the down file first and the down file was applied by
-- mistake. Open the file you mean by its whole name and read its first line
-- before you run anything.
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- This file is AUTHORED, NOT APPLIED. The session that wrote it executed no
-- statement against any database and held no credential that could. Run
-- supabase/migrations/101_preapply_test.sql first, read the report it
-- raises, then the PRE-FLIGHT CAPTURE below, and only then this file.
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE 296
-- and an explicit COMMIT; on LINE 380. Those are the only EXECUTABLE
-- statements in it that begin either transaction word.
--
--     grep -n 'BEGIN;'  supabase/migrations/101_partnership_write_guard.sql
--     grep -n 'COMMIT;' supabase/migrations/101_partnership_write_guard.sql
--
-- >>> READ THE OUTPUT, DO NOT COUNT IT. A case-insensitive grep for begin also
-- >>> hits line 304, the plpgsql body BEGIN with no semicolon; it is not a
-- >>> transaction statement. Both greps also return COMMENT
-- >>> lines (these header lines are among them) that merely quote the words.
-- >>> The executable hits are the ones that do NOT start with `--`: exactly
-- >>> one each, on the line numbers above. Do not verify with an anchored
-- >>> pattern; that form has produced false negatives here, and 087 nearly
-- >>> burned a dry run on it. 086 once shipped with NO transaction control,
-- >>> so a COMMIT-to-ROLLBACK swap silently did nothing and what was believed
-- >>> to be a dry run applied for real.
--
-- TO DRY RUN: change the COMMIT; on line 380 to ROLLBACK; and run the
-- whole file. Then PROVE it rolled back with verification query V1 below:
-- it must return ZERO rows. "Success. No rows returned" is what the
-- Supabase SQL Editor says for a dry run, a real apply, and a query pasted
-- into the wrong tab. It is not evidence of anything.
--
-- =====================================================================
-- WHAT THIS CLOSES, AND WHAT IT DOES NOT
-- =====================================================================
--
-- THE LIVE DEFECT (measured 2026-10-08). "Partners can update partnership
-- status" on public.partnerships is
--
--     FOR UPDATE TO authenticated
--     USING      (vendor_org_id IN (SELECT current_user_org_ids()))
--     WITH CHECK (vendor_org_id IN (SELECT current_user_org_ids()))
--
-- Despite its name it constrains NO column and NO value. 093 added a permit
-- list in a trigger, so a vendor session can today change only status,
-- accepted_at, updated_at, payment_terms_requests and vendor_org_id.
-- >>> THAT LEAVES TWO COLUMNS THAT MATTER OPEN: status AND accepted_at. <<<
-- Through PostgREST, with no route involved, a vendor can:
--
--   * write 'active' over a suspension the agency just applied,
--   * write 'terminated' to end a relationship the agency wants to keep,
--   * write 'pending' onto their own row and then do anything the pending
--     branch of the PATCH route allows,
--   * rewrite accepted_at.
--
-- So the Suspend and Terminate controls shipped in a5e0c20 are ADVISORY
-- against any vendor who opens a browser console. This file closes that.
--
-- THE BRIEF SAID nda_confirmed_at, msa_confirmed_at AND partnership_notes
-- WERE OPEN TOO. THEY ARE NOT, if 093 is live: 093's trigger refuses all
-- three with LG009 today. Pre-flight P3 proves 093 is the function that is
-- live. THIS FILE DOES NOT RE-GUARD THEM. A second permit list beside 093's
-- is the divergence 093 was written to prevent ("a column joins
-- v_vendor_permitted only when a real vendor-session writer needs it").
--
-- WHY A TRIGGER AND NOT A NARROWED POLICY. THE FINDING THAT DECIDES THIS
-- FILE. Row level security combines the WITH CHECK expressions of all
-- PERMISSIVE policies on a command with OR, against the NEW row, and does
-- not pair a policy's WITH CHECK with its own USING. Three UPDATE policies
-- exist on this table. One of them, "Partners can claim partnership by
-- email", carries
--
--     WITH CHECK (vendor_org_id IN (SELECT current_user_org_ids()))
--
-- and EVERY VENDOR'S OWN ROW SATISFIES IT. So any WITH CHECK written into
-- "Partners can update partnership status" is OR-ed with a clause the
-- vendor already passes, and constrains nothing. A narrowed policy would
-- apply cleanly, pass every catalog check, and change no behaviour. The
-- only policy-side fix is to narrow the CLAIM policy's WITH CHECK as well,
-- which the brief forbids touching, and which would still leave the
-- ghost-row claim able to write status.
--
-- A BEFORE UPDATE trigger is not subject to that OR. It reads OLD directly,
-- so it needs no STABLE SECURITY DEFINER snapshot helper of the kind 099
-- used (099 could use a policy because partner_rfp_inbox has no permissive
-- UPDATE policy a vendor satisfies; this table does). The pre-apply test's
-- H0 demonstrates the OR live inside a rolled-back transaction.
--
-- >>> THE REFUSAL IS 42501 RAISED BY THIS TRIGGER, NOT BY RLS. The message
-- >>> starts "partnerships.status". A 42501 whose message says "new row
-- >>> violates row-level security policy" is the policy; this is not that.
--
-- WHY A SECOND TRIGGER AND NOT A THIRD CREATE OR REPLACE OF 093's FUNCTION.
-- That function's body carries 087's four refusals "character for
-- character" under a banner saying not to edit it without diffing 087, and
-- CREATE OR REPLACE replaces a body wholesale. 093 argued against a second
-- trigger on ordering grounds: a trigger sorting BEFORE
-- partnerships_guard_identity_columns would pre-empt 087's specific
-- messages. Postgres fires BEFORE triggers in alphabetical order by name.
-- partnerships_guard_vendor_state sorts AFTER partnerships_guard_identity_
-- columns ('v' > 'i'), so 087's and 093's refusals fire first and keep their
-- specific messages; this trigger sees only what they let through. V2 lists
-- the order so that is checked, not assumed.
--
-- =====================================================================
-- THE RULE, AND WHAT A VENDOR LEGITIMATELY WRITES
-- =====================================================================
--
-- THREE EARLY EXITS, copied in shape from 093, in this order:
--
--   1. NEITHER status NOR accepted_at MOVED -> return. This is what keeps
--      payment_terms_requests (app/partner/projects/page.tsx:369, a live
--      browser-side vendor write that is not a status change) working, and
--      a whole-row read-modify-write that alters only other columns. It is
--      a VALUE comparison against OLD, never a SET-clause comparison.
--   2. auth.uid() IS NULL -> return. No end-user session: the service role,
--      a database function, a migration. lib/partnership-award-claim.ts
--      (status='active' on a claim, vendor-triggered but SERVICE ROLE) is
--      one of these and is deliberately not changed.
--   3. OLD.lead_org_id IN current_user_org_ids() -> return. The caller is
--      the lead agency (suspend, terminate, reinstate, re-invite). A caller
--      who is a member of BOTH sides is acting as the agency, as in 093.
--
-- Past those, the caller is a vendor session moving status or accepted_at.
-- The ONLY two vendor transitions that exist, both from OLD.status =
-- 'pending' (app/api/partnerships/route.ts:1084 and :1234):
--
--   ACCEPT   pending -> active      accepted_at may be written with it
--   DECLINE  pending -> terminated  accepted_at must be UNCHANGED
--
-- Everything else is refused, including any value added to the status
-- CHECK later: this is an allow-list of transitions, not a deny-list.
--
-- HOW A VENDOR IS PREVENTED FROM RE-ENTERING PENDING (the self-escalation
-- hole). The prior status is read from OLD, not from the new row. A write
-- of 'pending' onto a row whose OLD.status is active, suspended,
-- terminated or removed is a status change whose OLD.status is not
-- 'pending', so neither branch matches and it is refused. A write of
-- 'pending' onto a row that already is pending changes nothing and leaves
-- at exit 1. There is no value a vendor can write that makes OLD.status
-- 'pending' first. Asserted in the pre-apply test (T-ESC1 to T-ESC3).
--
-- EQUAL-OR-NARROWER, CLAUSE BY CLAUSE. THIS FILE WIDENS NOTHING.
--
--   * It adds a BEFORE UPDATE trigger. A trigger can only RAISE or return
--     the row; it cannot admit anything an RLS policy refused, so it cannot
--     widen any access predicate.
--   * Exit 1 returns without checking anything: it can only fire when
--     status and accepted_at are both unchanged, and then 093's trigger and
--     the policies decide exactly as before.
--   * Exit 2 and exit 3 mirror 093's exits 2 and 3 verbatim in meaning, so
--     no caller that 093 exempted is newly restricted and none newly freed.
--   * The two allowed vendor transitions are the two the route performs
--     today. Every other vendor status or accepted_at write, which is
--     admitted today, is refused after this file. So the vendor's set of
--     permitted writes is a strict subset of today's, and no vendor gains a
--     capability they lack today.
--   * No policy, grant, role, column or row is altered.
--   * The COMMENT ON POLICY changes pg_description only, not the policy.
--
-- THE CLAIM POLICY IS UNTOUCHED, and the claim path still works: its two
-- writers (app/auth/callback/route.ts:208, app/api/partnerships/route.ts:
-- 316) write vendor_org_id, profile_status and updated_at and never status
-- or accepted_at, so they leave at exit 1. ONE SIDE EFFECT, IN THE SAFE
-- DIRECTION: the claim policy's WITH CHECK constrains no column, so before
-- this file a claimer of an unclaimed row could write status inside the
-- claim statement itself. The trigger now applies there too.
--
-- THE AGENCY POLICY IS UNTOUCHED. V3 compares all three UPDATE policies by
-- md5 against the same capture taken in the pre-flight.
--
-- KNOWN, NOT CHANGED. On an accept the vendor chooses accepted_at. It is
-- the same value-set the route writes today (now()); a vendor could forge a
-- different timestamp on their own accept, as they can today. Pinning it
-- needs a clock comparison and is a separate decision.
--
-- =====================================================================
-- APPLY ORDER: SAFE TO APPLY BEFORE THE CODE SHIPS, OR AFTER
-- =====================================================================
--
-- This changes no application file, and every application write it
-- touches already conforms. Accept and decline are pending-only in the
-- route and are the two transitions the trigger permits. The route's 403
-- for a vendor on a non-pending row (route.ts, "A VENDOR NEVER CHANGES THE
-- STATE OF AN ESTABLISHED PARTNERSHIP") fires before any write. No
-- first-party code writes status or accepted_at on partnerships from a
-- browser client. 085 taught the other direction: its decline branch
-- resolved a notification recipient AFTER setting a status. Here the
-- decline write (pending -> terminated) is a permitted transition, and the
-- recipient lookup that precedes it is a read, so applying first cannot
-- silently kill an email. The one thing the apply CAN break is a vendor
-- write nobody listed; the pre-apply test's accept, decline and
-- payment_terms_requests assertions are what catch that.
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. READ ONLY. RUN BEFORE THE FILE. EXPECTED VALUES.
-- =====================================================================
--
-- P1. The triggers on partnerships, in FIRING ORDER.
--
--       SELECT tgname, tgenabled, pg_get_triggerdef(oid)
--       FROM pg_trigger
--       WHERE tgrelid = 'public.partnerships'::regclass AND NOT tgisinternal
--       ORDER BY tgname;
--       -- EXPECTED: partnerships_guard_identity_columns, BEFORE UPDATE,
--       --           tgenabled 'O'. A second BEFORE UPDATE trigger is not a
--       --           blocker, but READ IT: if it modifies NEW.status it can
--       --           change what this trigger sees. NO row named
--       --           partnerships_guard_vendor_state.
--
-- P2. The three UPDATE policies, fingerprinted so V3 can compare, not read.
--
--       SELECT policyname, cmd, md5(coalesce(qual,'')||'|'||coalesce(with_check,'')) AS fp
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'partnerships' AND cmd = 'UPDATE'
--       ORDER BY policyname;
--       -- EXPECTED: exactly 3 rows - "Agencies can update their
--       --           partnerships", "Partners can claim partnership by
--       --           email", "Partners can update partnership status".
--       --           WRITE DOWN THE THREE fp VALUES. V3 must return the same.
--
--       SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--       -- EXPECTED: any number. WRITE IT DOWN. V3 must return the same.
--
-- P3. 093's function is the one that is live.
--
--       SELECT prosrc LIKE '%LG009%' AS has_093_permit_list,
--              prosrc LIKE '%is immutable%' AS has_087_refusals
--       FROM pg_proc
--       WHERE proname = 'partnerships_guard_identity_columns'
--         AND pronamespace = 'public'::regnamespace;
--       -- EXPECTED: one row, both true. IF has_093_permit_list IS FALSE,
--       --           093 IS NOT APPLIED: STOP. This file's claim that
--       --           nda_confirmed_at and partnership_notes are already
--       --           guarded is then false and the brief was right about
--       --           them.
--
-- P4. This file's names are free.
--
--       SELECT count(*) FROM pg_proc
--       WHERE proname = 'partnerships_guard_vendor_state'
--         AND pronamespace = 'public'::regnamespace;
--       -- EXPECTED: 0.
--
-- P5. Data shape the trigger's comparisons assume.
--
--       SELECT status, count(*), count(*) FILTER (WHERE accepted_at IS NOT NULL) AS accepted
--       FROM public.partnerships GROUP BY status ORDER BY 1;
--       -- EXPECTED: values drawn from pending, active, suspended,
--       --           terminated, removed. A NULL status row is tolerated
--       --           (IS NOT DISTINCT FROM) but WRITE IT DOWN.
--
-- P6. The helper the trigger calls is executable by authenticated.
--
--       SELECT has_function_privilege('authenticated','public.current_user_org_ids()','EXECUTE');
--       -- EXPECTED: true. Same dependency as 093; exit 2 returns before
--       --           the call for every non-authenticated caller.
--
-- P7. The policy has no comment today.
--
--       SELECT obj_description(p.oid, 'pg_policy')
--       FROM pg_policy p
--       WHERE p.polrelid = 'public.partnerships'::regclass
--         AND p.polname  = 'Partners can update partnership status';
--       -- EXPECTED: one row, NULL. If it is not NULL the down file would
--       --           blank a comment it did not write: copy it somewhere.
--
-- =====================================================================
-- THE MIGRATION
-- =====================================================================

BEGIN;


CREATE OR REPLACE FUNCTION public.partnerships_guard_vendor_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- EXIT 1. NEITHER GUARDED COLUMN MOVED. A value comparison against OLD.
  -- payment_terms_requests, updated_at, vendor_org_id and every write that
  -- leaves status and accepted_at alone leave here.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.accepted_at IS NOT DISTINCT FROM OLD.accepted_at THEN
    RETURN NEW;
  END IF;

  -- EXIT 2. NO END-USER SESSION. The service role, a database function, a
  -- migration. Already authorised by their own code.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- EXIT 3. THE CALLER IS THE LEAD AGENCY. OLD, not NEW: 087 has already
  -- refused any write that moved lead_org_id. IN (SELECT fn()), never
  -- = ANY: the current_user_* helpers return SETOF uuid.
  IF OLD.lead_org_id IN (SELECT public.current_user_org_ids()) THEN
    RETURN NEW;
  END IF;

  -- FROM HERE DOWN: a signed-in caller who is not the lead agency moved
  -- status or accepted_at. The vendor may do exactly two things, both from
  -- a PENDING row, and the prior status is OLD.status, never NEW.status.

  -- ACCEPT. accepted_at is written with it.
  IF OLD.status = 'pending' AND NEW.status = 'active' THEN
    RETURN NEW;
  END IF;

  -- DECLINE. accepted_at must not move.
  IF OLD.status = 'pending'
     AND NEW.status = 'terminated'
     AND NEW.accepted_at IS NOT DISTINCT FROM OLD.accepted_at THEN
    RETURN NEW;
  END IF;

  -- RAISE, never silently revert to OLD. An RLS update that matches no row
  -- returns HTTP 200 with no error, and this project has lost real
  -- behaviour to exactly that five times. 42501 so a caller that already
  -- treats 087's refusals as a permission failure treats this as one; the
  -- message starts "partnerships.status" so it is not mistaken for RLS.
  RAISE EXCEPTION
    'partnerships.status may not be changed by the vendor on the partnership (attempted % -> %, accepted_at % -> %)',
    OLD.status, NEW.status, OLD.accepted_at, NEW.accepted_at
    USING ERRCODE = '42501',
          DETAIL  = 'Migration 101. A vendor session may only accept (pending -> active) or decline (pending -> terminated, accepted_at unchanged). Suspending, terminating, reinstating and re-inviting belong to the lead agency.';
END;
$$;

COMMENT ON FUNCTION public.partnerships_guard_vendor_state() IS
  'BEFORE UPDATE guard on public.partnerships, migration 101. A caller with an end-user '
  'session who is not a member of lead_org_id may change status or accepted_at only by '
  'ACCEPTING (OLD.status pending -> active) or DECLINING (pending -> terminated with '
  'accepted_at unchanged). Everything else is refused with 42501. Exempt: writes that move '
  'neither column, writes with no end-user session (auth.uid() IS NULL), and the lead agency. '
  'IT IS A TRIGGER BECAUSE A POLICY CANNOT DO IT: permissive WITH CHECK expressions are OR-ed '
  'and the claim policy''s WITH CHECK is satisfied by every vendor''s own row. It reads OLD, '
  'so a vendor cannot write pending onto a non-pending row. It fires AFTER '
  'partnerships_guard_identity_columns (alphabetical), which keeps 087''s and 093''s specific '
  'messages. DO NOT WIDEN THE TWO TRANSITIONS without a real vendor-session writer and a census.';

CREATE TRIGGER partnerships_guard_vendor_state
  BEFORE UPDATE ON public.partnerships
  FOR EACH ROW
  EXECUTE FUNCTION public.partnerships_guard_vendor_state();

COMMENT ON POLICY "Partners can update partnership status" ON public.partnerships IS
  'Despite its name this policy constrains NO column and NO value; it only requires that the '
  'caller belongs to vendor_org_id. The column permit list is in partnerships_guard_identity_'
  'columns() (093) and the status and accepted_at transition rules are in '
  'partnerships_guard_vendor_state() (101). A policy cannot hold them: the permissive WITH '
  'CHECK of "Partners can claim partnership by email" is OR-ed with this one and passes every '
  'vendor''s own row.';

COMMIT;


-- =====================================================================
-- VERIFICATION. RUN AFTER APPLYING. READ ONLY. EXPECTED VALUES STATED.
-- =====================================================================
--
-- V1. THE TRIGGER EXISTS, IS ENABLED, AND IS BEFORE UPDATE ROW.
--
--       SELECT tgname, tgenabled, tgtype,
--              (tgtype & 2)  <> 0 AS is_before,
--              (tgtype & 16) <> 0 AS is_update,
--              (tgtype & 1)  <> 0 AS is_row
--       FROM pg_trigger
--       WHERE tgrelid = 'public.partnerships'::regclass
--         AND tgname = 'partnerships_guard_vendor_state';
--       -- EXPECTED AFTER A REAL APPLY: 1 row, tgenabled 'O', is_before,
--       --   is_update and is_row all true.
--       -- EXPECTED AFTER A DRY RUN (COMMIT swapped for ROLLBACK): ZERO
--       --   ROWS. If this returns a row after a dry run, the swap did not
--       --   take and the file applied for real.
--
-- V2. FIRING ORDER. 087/093's trigger first, this one second.
--
--       SELECT tgname FROM pg_trigger
--       WHERE tgrelid = 'public.partnerships'::regclass AND NOT tgisinternal
--         AND (tgtype & 2) <> 0 AND (tgtype & 16) <> 0
--       ORDER BY tgname;
--       -- EXPECTED: partnerships_guard_identity_columns precedes
--       --   partnerships_guard_vendor_state. Anything else sorting between
--       --   them is a trigger to read.
--
-- V3. NO POLICY MOVED. THE SAME QUERIES AS P2, COMPARED, NOT READ.
--
--       SELECT policyname, md5(coalesce(qual,'')||'|'||coalesce(with_check,'')) AS fp
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'partnerships' AND cmd = 'UPDATE'
--       ORDER BY policyname;
--       -- EXPECTED: the same three fp values you wrote down at P2, in the
--       --   same order. ANY DIFFERENCE MEANS SOMETHING OTHER THAN THIS
--       --   FILE MOVED A POLICY.
--       SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--       -- EXPECTED: the same number you wrote down at P2.
--
-- V4. THE FUNCTION IS THE ONE THIS FILE WROTE, AND 093's IS INTACT.
--
--       SELECT proname, prosrc LIKE '%Migration 101%' AS is_101
--       FROM pg_proc
--       WHERE proname IN ('partnerships_guard_vendor_state','partnerships_guard_identity_columns')
--         AND pronamespace = 'public'::regnamespace
--       ORDER BY proname;
--       -- EXPECTED: 2 rows. identity_columns: is_101 false. vendor_state: true.
--       SELECT prosrc LIKE '%LG009%' FROM pg_proc
--       WHERE proname = 'partnerships_guard_identity_columns'
--         AND pronamespace = 'public'::regnamespace;
--       -- EXPECTED: true (093's permit list survived).
--
-- V5. THE POLICY COMMENT LANDED AND NOTHING ELSE ABOUT THE POLICY CHANGED.
--
--       SELECT left(obj_description(p.oid,'pg_policy'), 40)
--       FROM pg_policy p
--       WHERE p.polrelid = 'public.partnerships'::regclass
--         AND p.polname  = 'Partners can update partnership status';
--       -- EXPECTED: 'Despite its name this policy constrain'
--
-- V6. BEHAVIOUR, BY HAND, ROLLED BACK. Optional after the pre-apply test.
--     The test file already exercises all of these; this is for a human
--     who wants to see one with their own eyes. Replace the uuids.
--
--       BEGIN;
--       SELECT set_config('request.jwt.claims',
--         '{"sub":"<a vendor member uuid>","role":"authenticated"}', true);
--       SET LOCAL ROLE authenticated;
--       UPDATE public.partnerships SET status = 'active'
--         WHERE id = '<an ACTIVE or SUSPENDED partnership of that vendor>';
--       -- EXPECTED: ERROR 42501  partnerships.status may not be changed by
--       --   the vendor on the partnership (attempted suspended -> active ...)
--       ROLLBACK;
