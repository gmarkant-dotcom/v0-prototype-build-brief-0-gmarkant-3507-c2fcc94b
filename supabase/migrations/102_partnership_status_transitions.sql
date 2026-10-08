-- =====================================================================
-- 102: A VENDOR SESSION MAY MOVE partnerships.status / accepted_at ONLY
--      TO ACCEPT OR DECLINE A PENDING INVITATION.
--
-- AUTHORED 2026-10-08 on branch fix/post-093-cleanup. NOT APPLIED.
-- DO NOT APPLY WITHOUT A GREEN PRE-APPLY RUN OF
-- supabase/migrations/102_preapply_test.sql AND GREG'S SAY-SO.
--
-- =====================================================================
-- STOP-GATE. EVERY ONE OF THESE MUST BE TRUE BEFORE YOU PASTE THIS FILE.
-- =====================================================================
--
--   [ ] 093 is applied (P1 returns has_permit_list = true). This file
--       assumes the permit list exists and does not recreate it.
--   [ ] 101 is NOT applied. P2 must not list partnerships_guard_vendor_state.
--       102 supersedes 101. They enforce the same rule, and applying both
--       leaves two triggers that must be kept in agreement forever. The
--       transaction below ENFORCES this: it raises if either trigger exists.
--   [ ] 102 is not already applied (P2 must not list
--       partnerships_guard_status_transition). Same enforcement.
--   [ ] The pre-apply test has been run in the SQL Editor and its first line
--       reads "SAFE TO APPLY 102.". Its BEFORE column must show the vendor
--       WRITING the refused states; that is the executed proof of the defect.
--   [ ] The DRY RUN below has been done and PROVED to have rolled back.
--
-- =====================================================================
-- WHAT THIS CLOSES, AND WHY IT IS A TRIGGER
-- =====================================================================
--
-- Migration 093 gave partnerships a vendor-side COLUMN permit list:
-- status, accepted_at, updated_at, payment_terms_requests, vendor_org_id,
-- plus profile_status on the claim transition. `status` and `accepted_at`
-- are on it because a vendor must be able to accept (pending -> active) and
-- decline (pending -> terminated). The guard compares COLUMNS, never values,
-- so a permitted column may take ANY value.
--
-- Therefore, after 093, a vendor session writing through PostgREST can set
-- status to ANY of 'pending', 'active', 'suspended', 'terminated',
-- 'removed' on ANY of its own partnerships, from ANY prior status:
--
--   * 'active' over a suspension the lead agency imposed (reinstating itself)
--   * 'terminated' over a live relationship (ending it unilaterally)
--   * 'pending' onto a live row (the self-escalation: after that, the
--     accept branch is open to it again)
--   * accepted_at rewritten at will (backdating an acceptance)
--
-- The ONLY thing stopping those today is an application check:
-- app/api/partnerships/route.ts:1072,
--   `if (!isAgency && partnership.status !== 'pending') return 403`.
-- It guards the route, not the table. A direct PostgREST PATCH with the
-- vendor's own JWT never passes through it.
--
-- WHY A TRIGGER AND NOT A POLICY. RLS policies of one command are PERMISSIVE
-- and OR-ed, in both USING and WITH CHECK. "Partners can claim partnership by
-- email" has a WITH CHECK of `vendor_org_id IN (current_user_org_ids())`, which
-- every vendor's OWN row satisfies, so narrowing the WITH CHECK of "Partners
-- can update partnership status" changes nothing: the claim policy's check
-- still passes. A WITH CHECK also has no OLD, so it cannot express "from
-- which prior status". A BEFORE UPDATE trigger sees OLD and NEW and is not
-- OR-ed with anything. THIS FILE CHANGES NO POLICY.
--
-- RELATION TO 101. Migration 101 (branch feat/101-partnership-write-guard,
-- never applied) is the same rule as a trigger named
-- partnerships_guard_vendor_state. It was authored when 093 was believed
-- unapplied. 102 is derived afresh from 093 as it stands, and was checked
-- against 101 clause by clause: the transition rule is IDENTICAL. What differs
-- is operational and stated in docs/101-rescope-after-093.md: a different
-- trigger name so the two cannot be confused; a fail-closed pre-flight that
-- refuses to coexist with 101; and a pre-apply test that does not use pg_temp
-- helper functions (which the SQL Editor session may not support). If this is
-- applied, 101 must NOT be.
--
-- =====================================================================
-- THE RULE
-- =====================================================================
--
-- A BEFORE UPDATE ... FOR EACH ROW trigger, partnerships_guard_status_
-- transition(). Four exits, then one refusal:
--
--   EXIT 1  neither status nor accepted_at differs between OLD and NEW.
--           Everything else passes: this trigger is not the column guard.
--   EXIT 2  auth.uid() IS NULL. The service role, SECURITY DEFINER functions,
--           migrations and the SQL Editor carry no end-user session. This is
--           the same exemption 093 uses, for the same reason.
--   EXIT 3  the caller is a member of OLD.lead_org_id. The lead agency owns
--           the relationship's lifecycle: suspend, terminate, reinstate,
--           re-invite. Same exemption 093 uses.
--   EXIT 4  ACCEPT: OLD.status = 'pending' AND NEW.status = 'active'.
--           accepted_at may be anything: the vendor route and the award
--           claim write it differently, and constraining it is a ruling
--           (docs/101-rescope-after-093.md, "owed").
--   EXIT 5  DECLINE: OLD.status = 'pending' AND NEW.status = 'terminated' AND
--           accepted_at unchanged.
--   else    RAISE 42501. The prior status is read from OLD, never from the
--           statement, so writing 'pending' onto a non-pending row is just
--           another refused transition and the self-escalation has no first
--           step.
--
-- Trigger order: BEFORE UPDATE triggers fire in alphabetical order by name.
-- partnerships_guard_identity_columns (087 + 093) sorts BEFORE
-- partnerships_guard_status_transition, so 087's and 093's specific messages
-- (lead_org_id immutable, LG009 for a guarded column) are raised first and
-- are never replaced by this file's generic one. V2 below asserts the order.
--
-- =====================================================================
-- EQUAL-OR-NARROWER, CLAUSE BY CLAUSE
-- =====================================================================
--
-- BASELINE = production after 093: a vendor session may write any value to
-- status and accepted_at on its own row.
--
--   EXIT 1  Admits exactly what the baseline admitted for writes that move
--           neither column. EQUAL.
--   EXIT 2  Admits what the baseline admitted for sessions with no end user.
--           EQUAL. (Those sessions were never constrained.)
--   EXIT 3  Admits what the baseline admitted for lead-agency members. EQUAL.
--   EXIT 4  Admits pending -> active, a subset of the baseline. NARROWER than
--           the baseline, EQUAL to the live accept route (app/api/
--           partnerships/route.ts:1083-1087), which is the only vendor
--           writer of it.
--   EXIT 5  Admits pending -> terminated with accepted_at unchanged, a subset
--           of the baseline. EQUAL to the live decline route (route.ts:1235),
--           which does not touch accepted_at.
--   REFUSAL Refuses every other vendor-session change to status or
--           accepted_at. NARROWER than the baseline by definition, and no live
--           vendor writer is in the refused set (the census, re-run on
--           2026-10-08: the only vendor-session writes to status are the two
--           above; lib/partnership-award-claim.ts writes status 'active' on a
--           ghost claim, which is pending -> active or an unchanged 'active',
--           both passing).
--   THE TRIGGER ONLY RAISES. It never assigns to NEW, never writes another
--   row and never changes a policy or a grant. It cannot widen anything.
--
-- ONE BEHAVIOUR CHANGE WORTH NAMING. A vendor-session write that moves
-- ONLY accepted_at (status unchanged) was admitted by the baseline and is
-- refused now. No live writer does that.
--
-- =====================================================================
-- WHAT THIS DOES NOT DO (each one is an owed ruling, not an omission)
-- =====================================================================
--   * It does not constrain the VALUE of accepted_at on an accept.
--   * It does not make a decline reversible or an accept undoable.
--   * It does not touch the claim visibility limit (T15b in the 093 test).
--   * It does not touch any policy, grant, other trigger, or column.
--
-- =====================================================================
-- APPLY SEQUENCE
-- =====================================================================
--   1. Run P1 to P6 below in the SQL Editor. Record the answers. Compare
--      with EXPECTED. STOP on any mismatch.
--   2. Paste supabase/migrations/102_preapply_test.sql and run it ONCE. The
--      result is a red error box; its first line must read "SAFE TO APPLY
--      102.". Anything else: do not continue.
--   3. DRY RUN: replace the final COMMIT; (line numbers at the foot of this
--      header) with ROLLBACK; and run the file. Then prove it rolled back:
--      P2 must still NOT list partnerships_guard_status_transition.
--      "Success. No rows returned" is what the editor says for a dry run, a
--      real apply and a query pasted into the wrong tab. It is not evidence.
--   4. Restore COMMIT; and run the file for real.
--   5. Run V1 to V4. They must return EXACTLY the EXPECTED values.
--   6. Rollback is supabase/migrations/102_partnership_status_transitions_down.sql.
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. READ-ONLY. RUN AND WRITE DOWN THE ANSWERS.
-- =====================================================================
--
-- P1. 093 IS APPLIED.
--
--   SELECT p.proname,
--          pg_get_functiondef(p.oid) LIKE '%v_vendor_permitted%' AS has_permit_list
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'partnerships_guard_identity_columns';
--
--   EXPECTED: one row, has_permit_list = true.
--
-- P2. THE TRIGGERS ON partnerships.
--
--   SELECT tgname, tgenabled FROM pg_trigger
--   WHERE tgrelid = 'public.partnerships'::regclass AND NOT tgisinternal
--   ORDER BY tgname COLLATE "C";
--
--   EXPECTED: partnerships_guard_identity_columns with tgenabled = 'O'.
--             NEITHER partnerships_guard_vendor_state (101) NOR
--             partnerships_guard_status_transition (102). Any other triggers
--             are fine; write them down.
--
-- P3. THE STATUS DOMAIN.
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.partnerships'::regclass
--     AND conname = 'partnerships_status_check';
--
--   EXPECTED: CHECK (status = ANY (ARRAY['pending','active','suspended',
--             'terminated','removed'])) - the five values, in any order. If a
--             sixth value exists, STOP: this file refuses it by default and
--             someone must decide whether a vendor may ever write it.
--
-- P4. WHAT THE TABLE HOLDS NOW (capture, no expected value).
--
--   SELECT status, count(*) AS n, count(accepted_at) AS with_accepted_at
--   FROM public.partnerships GROUP BY status ORDER BY status;
--
-- P5. THE POLICIES, SO V4 CAN PROVE THEY DID NOT MOVE.
--
--   SELECT count(*) AS n_policies,
--          md5(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' ||
--                         coalesce(with_check, ''), E'\n' ORDER BY policyname)) AS fingerprint
--   FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partnerships';
--
--   EXPECTED: n_policies = 6 (the figure reported after 093 on 2026-10-08).
--             WRITE DOWN THE FINGERPRINT. V4 must return the same one.
--
-- P6. A VENDOR SESSION IS NOT CURRENTLY MID-FLIGHT ON A TRANSITION THIS
--     FILE REFUSES. Informational: rows whose updated_at moved in the last
--     hour and whose status is not 'pending'/'active'. Nothing to compare.
--
--   SELECT id, status, updated_at FROM public.partnerships
--   WHERE updated_at > now() - interval '1 hour' ORDER BY updated_at DESC LIMIT 20;
--
-- =====================================================================
-- VERIFICATION. RUN AFTER THE REAL COMMIT. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- V1. THE TRIGGER EXISTS, ENABLED, BEFORE UPDATE, FOR EACH ROW.
--
--   SELECT tgname, tgenabled,
--          (tgtype & 1) = 1  AS for_each_row,
--          (tgtype & 2) = 2  AS before_event,
--          (tgtype & 16) = 16 AS on_update
--   FROM pg_trigger
--   WHERE tgrelid = 'public.partnerships'::regclass
--     AND tgname = 'partnerships_guard_status_transition';
--
--   EXPECTED: one row, tgenabled = 'O', all three booleans true.
--
-- V2. 093'S TRIGGER FIRES FIRST.
--
--   SELECT 'partnerships_guard_identity_columns' COLLATE "C"
--        < 'partnerships_guard_status_transition' COLLATE "C" AS identity_first;
--
--   EXPECTED: true. (Constant, but it is the fact the ordering argument rests
--   on: if anyone renames either trigger, this is the check that fails.)
--
-- V3. THE FUNCTION PINS ITS search_path.
--
--   SELECT p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'partnerships_guard_status_transition';
--
--   EXPECTED: {"search_path=public, pg_temp"}
--
-- V4. NO POLICY MOVED. Re-run P5.
--
--   EXPECTED: n_policies = 6 and the fingerprint recorded in P5.
--
-- V5. 101 IS STILL ABSENT. Re-run P2.
--
--   EXPECTED: no partnerships_guard_vendor_state.
--
-- BEGIN and COMMIT line numbers of the transaction below: see the foot of
-- this header block.
-- BEGIN is at line 263 and COMMIT is at line 364.

BEGIN;

-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION. The stop-gate above
--    is advice; this is enforcement. Any failure aborts everything.
-- ---------------------------------------------------------------------
DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'partnerships_guard_identity_columns'
      AND pg_get_functiondef(p.oid) LIKE '%v_vendor_permitted%'
  ) THEN
    RAISE EXCEPTION '102 refuses to apply: migration 093 (the vendor permit list in partnerships_guard_identity_columns) is not applied.'
      USING ERRCODE = 'LG102';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.partnerships'::regclass
      AND NOT tgisinternal
      AND tgname IN ('partnerships_guard_vendor_state', 'partnerships_guard_status_transition')
  ) THEN
    RAISE EXCEPTION '102 refuses to apply: partnerships_guard_vendor_state (101) or partnerships_guard_status_transition (102) already exists. 102 supersedes 101; run only one.'
      USING ERRCODE = 'LG102';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------
-- 1. THE FUNCTION.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.partnerships_guard_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- EXIT 1. Nothing this trigger governs moved.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.accepted_at IS NOT DISTINCT FROM OLD.accepted_at THEN
    RETURN NEW;
  END IF;

  -- EXIT 2. No end-user session: service role, SECURITY DEFINER function,
  -- migration, SQL Editor.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- EXIT 3. The lead agency owns the lifecycle.
  IF OLD.lead_org_id IN (SELECT public.current_user_org_ids()) THEN
    RETURN NEW;
  END IF;

  -- EXIT 4. ACCEPT. Read from OLD, never from the statement.
  IF OLD.status = 'pending' AND NEW.status = 'active' THEN
    RETURN NEW;
  END IF;

  -- EXIT 5. DECLINE. accepted_at must not move.
  IF OLD.status = 'pending'
     AND NEW.status = 'terminated'
     AND NEW.accepted_at IS NOT DISTINCT FROM OLD.accepted_at THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'partnerships.status and accepted_at may be changed by a vendor only to accept or decline a pending invitation (attempted status % -> %, accepted_at % -> %)',
    OLD.status, NEW.status, OLD.accepted_at, NEW.accepted_at
    USING ERRCODE = '42501',
          DETAIL  = 'Migration 102. A vendor session may only accept (pending -> active) or decline (pending -> terminated, accepted_at unchanged). Suspending, terminating, reinstating and re-inviting belong to the lead agency.';
END;
$$;

COMMENT ON FUNCTION public.partnerships_guard_status_transition() IS
  'BEFORE UPDATE guard on public.partnerships, migration 102. A caller with an end-user '
  'session who is not a member of lead_org_id may change status or accepted_at only by '
  'ACCEPTING (OLD.status pending -> active) or DECLINING (pending -> terminated with '
  'accepted_at unchanged). Everything else is refused with 42501, including writing '
  'pending onto a non-pending row and moving accepted_at alone. Exempt: writes that move '
  'neither column, writes with no end-user session (auth.uid() IS NULL), and the lead '
  'agency. IT IS A TRIGGER BECAUSE A POLICY CANNOT DO IT: permissive WITH CHECK '
  'expressions are OR-ed and the claim policy''s WITH CHECK is satisfied by every '
  'vendor''s own row; a WITH CHECK also has no OLD. It fires AFTER '
  'partnerships_guard_identity_columns (alphabetical), which keeps 087''s and 093''s '
  'specific messages. It supersedes migration 101, which is the same rule under another '
  'name and must not be applied alongside it. DO NOT WIDEN THE TWO TRANSITIONS without a '
  'real vendor-session writer.';

-- ---------------------------------------------------------------------
-- 2. THE TRIGGER. Plain CREATE, not OR REPLACE: if the name exists the
--    pre-flight above has already raised.
-- ---------------------------------------------------------------------
CREATE TRIGGER partnerships_guard_status_transition
  BEFORE UPDATE ON public.partnerships
  FOR EACH ROW
  EXECUTE FUNCTION public.partnerships_guard_status_transition();

COMMIT;
