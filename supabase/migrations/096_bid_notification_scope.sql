-- =====================================================================
-- Migration 096: 096_bid_notification_scope.sql
--
--   CREATE public.current_user_commercial_counterparty_user_ids()
--   ALTER  POLICY "Scoped insert notifications" ON public.notifications
--
-- TWO STATEMENTS OF SUBSTANCE, ONE COMMENT LINE AND THREE GRANT LINES.
-- That is the whole file. It creates no table, adds no column, writes no
-- row, backfills nothing, and DOES NOT TOUCH
-- current_user_active_counterparty_user_ids().
--
-- THE FULL FILENAME IS 096_bid_notification_scope.sql. Its rollback
-- sibling is 096_bid_notification_scope_down.sql, and that name sorts
-- FIRST alphabetically under a `096_*.sql` glob. A `094_*.sql` glob
-- matched the down file first this week and the down file was applied by
-- mistake. DO NOT GLOB. Open the file by its full name and read the
-- first line of the header before running anything.
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- >>> THIS FILE WIDENS AN RLS POLICY. It is the only kind of change this
-- >>> session was permitted to AUTHOR and forbidden to APPLY. Read
-- >>> WHAT IT WIDENS AND WHAT IT DOES NOT before running it, and run
-- >>> docs/096-preapply-test.sql first.
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE 276
-- and an explicit COMMIT; on LINE 388. Those are the only EXECUTABLE
-- lines that begin with either word. Every other occurrence in this file
-- is inside a comment and has no semicolon at the end of its line.
--
-- Do NOT verify with grep -n '^BEGIN;$'. That anchored form has produced
-- false negatives in this repository and 087 nearly burned a dry run on
-- exactly that. Use:
--
--     grep -n 'BEGIN;'  supabase/migrations/096_bid_notification_scope.sql
--     grep -n 'COMMIT;' supabase/migrations/096_bid_notification_scope.sql
--
-- Exactly one line of each ends in the bare keyword and a semicolon.
--
-- FOR THE DRY RUN: change the COMMIT; on LINE 388 to ROLLBACK;, run the
-- file, confirm no errors, then put COMMIT; back. The verification block
-- is AFTER that line and entirely commented out, so a dry run stops
-- there and executes none of it.
--
-- "Success. No rows returned" IN THE SQL EDITOR PROVES NOTHING ON ITS
-- OWN. It is the identical message for a dry run that rolled everything
-- back, for a real apply that committed, and for a correct file pasted
-- into the wrong project's tab. The VERIFICATION block at the foot is
-- the only thing that distinguishes them. Run it.
--
-- Sequence, no step skipped:
--   1. Run docs/096-preapply-test.sql. Read the headline line.
--   2. Dry run THIS file: COMMIT -> ROLLBACK, run, confirm no errors,
--      put it back.
--   3. Run for real.
--   4. Run VERIFICATION. Every query states its expected value.
--   5. Update the migrations table in LIGAMENT_CONTEXT.md.
--   6. No code deploy is required. See ORDERING below.
--
-- =====================================================================
-- ORDERING AGAINST THE CODE. THIS FILE IS INDEPENDENT OF THE DEPLOY.
-- =====================================================================
--
-- THIS FILE ADDS NOTHING THE CODE NAMES. No route, component or library
-- in this repository mentions current_user_commercial_counterparty_user_ids()
-- or the policy text, and nothing reads a column that does not already
-- exist.
--
--   APPLY IT BEFORE THE CODE, AFTER THE CODE, OR WITH NO CODE AT ALL.
--
-- It does not touch SELECT on notifications, so the bell reads exactly
-- the same rows by exactly the same predicate before and after. The
-- difference is only ever whether a row gets WRITTEN.
--
-- =====================================================================
-- WHY THIS EXISTS, IN ONE PARAGRAPH
-- =====================================================================
--
-- GREG RULED: when a vendor submits a bid, the lead agency should be
-- notified. 095 widened notifications_type_check so 'bid_submitted' is a
-- legal value and stopped the 23514. The INSERT POLICY still refuses.
--
-- app/api/partner/rfps/[id]/response/route.ts:429 is the portal bid site.
-- It runs on the SESSION client (lib/supabase/server createClient, line
-- 120), so RLS applies in full, and it writes to the LEAD agency's
-- organization - the counterparty. Of the three arms live today only the
-- third can possibly match a counterparty recipient, and that third arm
-- is current_user_active_counterparty_user_ids(), which pins
-- `p.status = 'active'` on BOTH its union arms.
--
-- Broadcast creates partnerships as 'pending'. So for a broadcast
-- recipient every one of the agency's member rows is refused, the retry
-- loop in createOrgNotification() finds refused.length === userIds.length,
-- it returns false, and ALL THREE CALL SITES OF notifyBidSubmitted()
-- DISCARD THAT BOOLEAN. The failure is a console.error nobody reads. The
-- vendor sees a success screen. The agency's bell never moves.
--
-- LIVE COUNTS AT AUTHORING TIME: 33 partnerships - 27 pending, 5 active,
-- 1 removed. Four of the 33 would permit the notification today, and 28
-- carry no vendor_org_id at all.
--
-- =====================================================================
-- WHAT IT WIDENS AND WHAT IT DOES NOT
-- =====================================================================
--
-- WIDENS: a FOURTH arm on the notifications INSERT policy, admitting
-- counterparties across partnerships whose status is pending, active or
-- suspended.
--
-- DOES NOT WIDEN:
--   * SELECT on notifications. Untouched. Still user_id = auth.uid().
--   * UPDATE on notifications. Untouched.
--   * current_user_active_counterparty_user_ids(). NOT MODIFIED. Its
--     body, its grants and its meaning are exactly what 079 left. Its one
--     live reader is this same policy, and this file adds a sibling arm
--     beside it rather than editing it, because widening it would change
--     what "active counterparty" means for every future reader and the
--     name would then lie.
--   * Any other policy. This file names exactly one.
--
-- BOUNDARY THAT SURVIVES. A vendor with NO partnership to the target
-- organization is still refused, on all four arms. The widening is over
-- the STATUS of an existing relationship, never over its existence.
--
-- =====================================================================
-- WHICH STATUSES THE NEW HELPER ADMITS, AND WHY - FROM THE CODE
-- =====================================================================
--
-- The CHECK on partnerships.status (063:34) is:
--     CHECK (status IN ('pending','active','suspended','terminated','removed'))
--
-- ADMITTED:  pending, active, suspended
-- REFUSED:   terminated, removed, NULL, and any value not in the list
--
-- WHY THAT LINE AND NOT ANOTHER. Migration 085 already drew this exact
-- boundary and named it: current_user_commercial_counterparty_org_ids()
-- admits pending, active and suspended and excludes terminated and
-- removed, on the stated ground that a relationship which has ENDED is
-- past the commercial line. 085's own comment lays out the family and
-- says it is "ordered strictly by breadth" and that "any future change
-- should keep that ordering true". This helper is the user-id sibling of
-- that org-id tier and takes the same status set, so the family stays
-- ordered:
--
--   FUNCTION                                         RETURNS   STATUSES
--   current_user_counterparty_org_ids()              org ids   all five
--   current_user_commercial_counterparty_org_ids()   org ids   pending, active, suspended
--   current_user_commercial_counterparty_user_ids()  user ids  pending, active, suspended  <- NEW
--   current_user_active_counterparty_user_ids()      user ids  active
--
-- WRITTEN BY INCLUSION, NOT BY EXCLUSION, AND THAT IS THE ONE PLACE THIS
-- FILE DEPARTS FROM 085. 085 wrote `status IS DISTINCT FROM 'terminated'
-- AND status IS DISTINCT FROM 'removed'`, so an unrecognised or NULL
-- status falls IN. Its comment gives the reason in one sentence: "The
-- failure direction for a VISIBILITY set is to show one row too many; for
-- an AUTHORITY set it would be the opposite, and this is not an authority
-- set." THIS ONE IS AN AUTHORITY SET - it gates a WRITE into somebody
-- else's inbox - so the failure direction flips and it is written as
-- `status IN (...)`. A status nobody anticipated is refused here and
-- admitted there, deliberately, for that reason.
--
-- NOT COMPOSED ON 085's HELPER, DELIBERATELY. This body could have been
-- one line - org_members WHERE org_id IN (SELECT
-- current_user_commercial_counterparty_org_ids()). It is not, for two
-- reasons: it would couple a WRITE authority to a READ helper, so a later
-- narrowing or widening of the profiles read boundary would silently move
-- this write boundary with it; and it would inherit the by-exclusion
-- predicate this file deliberately inverts. The shape below is 079:779's,
-- copied, with the status predicate as the ONLY difference.
--
--   *** IF 085's COMMERCIAL TIER EVER CHANGES, THIS FUNCTION DOES NOT
--   *** FOLLOW AUTOMATICALLY. That is intentional. Change it here too,
--   *** or decide on purpose that the two tiers have diverged.
--
-- 'removed' IS A RULING GREG OWES, AND IT IS EXCLUDED UNTIL HE MAKES IT.
--
--   What 'removed' means here: the agency dismissed the vendor from its
--   pool. app/agency/pool/page.tsx:593 is the only writer, and
--   app/api/partnerships/route.ts:95 and :129 already filter removed rows
--   out of the agency's own pool reads.
--
--   THE ARGUMENT FOR ADMITTING IT. The portal bid route gates on the RFP
--   INBOX ROW, not on partnership status - partnerCanAccessPartnerRfpInbox()
--   checks vendor_org_id membership or a recipient_email match plus the
--   NDA gate, and reads no status at all. So a vendor on a 'removed'
--   partnership who still holds an inbox row CAN submit a bid, and the
--   bid row lands. Excluding 'removed' means that bid arrives silently,
--   which is the same defect this file exists to fix, in a smaller shape.
--
--   THE ARGUMENT FOR EXCLUDING IT. 085 already put 'removed' outside the
--   commercial line for reads. An agency that dismissed a vendor and is
--   then pushed a bell notification by that vendor has had its own
--   dismissal overridden by the party it dismissed. That is a write into
--   a dismissed relationship, and this is an authority set.
--
--   COST OF EACH. Excluding costs: bids from dismissed vendors stay
--   silent - live blast radius today is ONE partnership row, and the
--   agency still receives the transactional EMAIL, which is sent on a
--   separate path (route.ts:414, sendTransactionalEmail) and is not
--   gated by RLS at all. Admitting costs: a dismissed vendor regains the
--   ability to write rows into the dismissing agency's inbox, and that is
--   not reversible by anything short of another migration.
--
--   EXCLUDED, because excluding is reversible and admitting a status that
--   should not be there is a silent permission. If Greg rules the other
--   way, the change is one word in the IN list plus the same word in the
--   down file, and 097 can carry it.
--
-- =====================================================================
-- ONE ROW PER ORG MEMBER. SAY THIS OUT LOUD BEFORE APPLYING.
-- =====================================================================
--
-- createOrgNotification() (lib/notifications.ts:197) resolves EVERY
-- member of the target organization through resolveOrgMemberUserIds()
-- and inserts ONE ROW PER MEMBER. That is the ruling at the top of that
-- file and it is not changed here.
--
-- Today, for a pending partnership, that fan-out produces ZERO rows,
-- because every one of them is refused. After 096 it produces N.
--
--   A bid on a partnership whose lead agency has three colleagues writes
--   THREE notification rows, not one.
--
-- WHAT THAT MEANS FOR THE BELL. The bell's unread count is per USER, not
-- per organization: app/api/notifications/route.ts selects on
-- `user_id = auth.uid()`. So each of the three colleagues sees ONE new
-- unread item, which is correct and is the intent. NOBODY sees a count of
-- three for one bid.
--
-- What DOES change at the organization scale is row volume in
-- public.notifications: one bid on a five-person agency is five rows.
-- Marking read is also per user - one colleague clearing their bell does
-- not clear anyone else's, so the same bid can sit unread on four bells
-- after the fifth colleague has dealt with it. There is no
-- organization-level "somebody has seen this" state in this schema, and
-- 096 does not add one.
--
-- THE VISIBLE STEP CHANGE. Agencies that have been receiving ZERO in-app
-- bid notifications since 079 will start receiving them for all 27
-- pending partnerships at once, from the next bid onwards. This is not a
-- backfill - no historical bid produces a row - but the first busy day
-- after apply will look like a sudden arrival of a feature, because it
-- is one.
--
-- =====================================================================
-- WHAT THIS FILE DOES NOT REACH
-- =====================================================================
--
-- THE 28 GHOST PARTNERSHIPS ARE UNAFFECTED AND WERE ALREADY WORKING.
-- A ghost is a partnership row with no vendor_org_id - a vendor who has
-- never claimed a Ligament login. They bid through the guest token path,
-- app/api/rfp/guest/[token]/route.ts, whose client is built at line 151
-- from SUPABASE_SERVICE_ROLE_KEY. Service role bypasses RLS entirely, so
-- notifyBidSubmitted() at :583 and :768 was never refused by this policy
-- and is not helped by this file. Those two call sites were blocked only
-- by the 23514 that 095 already fixed.
--
-- THE DISCARDED BOOLEAN IS NOT FIXED HERE. All three call sites of
-- notifyBidSubmitted() `await` it and throw the return value away, so a
-- future refusal will still be invisible to the caller. That is a code
-- change, not a policy change, and it is not in this file.
--
-- ARM 3 IS NOW REDUNDANT AND IS KEPT ANYWAY. Every user id
-- current_user_active_counterparty_user_ids() returns is also returned by
-- the new helper, because 'active' is inside the admitted set. Arm 3
-- therefore matches nothing arm 4 does not already match. It is restated
-- unchanged for two reasons: prohibition 4 forbids touching that helper
-- and removing its only reader is a step toward touching it; and while
-- both arms stand, dropping arm 4 alone restores today's behaviour
-- exactly, which is what the down file does.
-- =====================================================================


BEGIN;


-- ---------------------------------------------------------------------
-- 1. THE NEW HELPER.
--
-- Shape copied from public.current_user_active_counterparty_user_ids()
-- at 079:779-803: SETOF uuid, LANGUAGE sql, STABLE, SECURITY DEFINER,
-- search_path pinned to public, pg_temp, both directions unioned,
-- vendor_org_id IS NOT NULL on the lead arm.
--
-- THE ONLY DIFFERENCE IS THE STATUS PREDICATE. Diff the two bodies and
-- that must be all that comes back.
--
-- vendor_org_id IS NOT NULL is on the LEAD arm only, exactly as in 079.
-- On the lead arm vendor_org_id is the value being SELECTED, and a NULL
-- there is a ghost row that would otherwise put a NULL into the org id
-- set. On the vendor arm vendor_org_id is only used inside an IN, where a
-- NULL cannot match a real org id anyway. Do not "fix" the asymmetry.
--
-- SECURITY DEFINER is required and is not a widening: org_members has a
-- self-row-only SELECT policy, so an invoker-rights version of this
-- function would return the caller and nobody else, and the policy would
-- refuse every counterparty exactly as it does today. The function names
-- people; it exposes no row of theirs.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_commercial_counterparty_user_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

COMMENT ON FUNCTION public.current_user_commercial_counterparty_user_ids() IS
  'Every user id at every counterparty organization whose partnership with one of the '
  'caller''s organizations is COMMERCIALLY LIVE: status pending, active or suspended. '
  'The user-id sibling of current_user_commercial_counterparty_org_ids() (085), and the '
  'wider sibling of current_user_active_counterparty_user_ids() (079), which stays '
  'active-only and is deliberately untouched. Written for the notifications INSERT policy, '
  'so the bid_submitted ruling - a vendor submits, the lead agency hears about it - can be '
  'carried out across a partnership that broadcast created as pending. Written by INCLUSION '
  'rather than by exclusion, unlike 085: this gates a WRITE into another party''s inbox, so '
  'an unrecognised or NULL status must be REFUSED, not admitted. Excludes terminated and '
  'removed. Grants nothing on its own - it names people, it does not expose their rows.';

-- REVOKED FROM anon BY NAME, NOT ONLY FROM PUBLIC. A stock Supabase
-- project carries a DEFAULT PRIVILEGE that grants anon EXECUTE on new
-- functions in public, issued from BOTH postgres and supabase_admin, and
-- REVOKE ... FROM PUBLIC DOES NOT REMOVE A DIRECT GRANT. 089 established
-- this for current_user_email() and 094 repeated it for
-- current_user_org_member_user_ids(); the six older current_user_*
-- helpers predate the finding and still carry the anon grant. The
-- verification block below asserts has_function_privilege('anon', ...)
-- is FALSE, which is the only proof that it worked.
REVOKE EXECUTE ON FUNCTION public.current_user_commercial_counterparty_user_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_commercial_counterparty_user_ids() FROM anon;
GRANT  EXECUTE ON FUNCTION public.current_user_commercial_counterparty_user_ids() TO authenticated;


-- ---------------------------------------------------------------------
-- 2. THE POLICY. One arm added. Nothing removed, nothing reworded.
--
-- BEFORE (094:329-336, live):
--     user_id = auth.uid()
--     OR user_id IN (SELECT public.current_user_org_member_user_ids())
--     OR user_id IN (SELECT public.current_user_active_counterparty_user_ids())
--
-- AFTER: those same three arms, character for character, plus a fourth.
--
-- ALTER, NEVER DROP-THEN-CREATE. If the policy name has drifted, ALTER
-- raises 42704 and this transaction aborts with nothing applied. A DROP
-- on a name that is not live SILENTLY NO-OPS against this database, and
-- the CREATE that followed would add a SECOND permissive policy that ORs
-- with the first - closing nothing, widening everything, and reporting
-- "Success. No rows returned" while it did so. Several live policies here
-- exist under names that appear nowhere in this repository, so this is
-- not a hypothetical.
--
-- WITH CHECK only: this is an INSERT policy and INSERT policies have no
-- USING clause. Naming one here would raise, which is a useful reminder
-- that nothing about READING notifications is being touched.
-- ---------------------------------------------------------------------
ALTER POLICY "Scoped insert notifications"
  ON public.notifications
  WITH CHECK (
    user_id = auth.uid()
    OR user_id IN (SELECT public.current_user_org_member_user_ids())
    OR user_id IN (SELECT public.current_user_active_counterparty_user_ids())
    OR user_id IN (SELECT public.current_user_commercial_counterparty_user_ids())
  );


COMMIT;


-- =====================================================================
-- 3. VERIFICATION. RUN AFTER APPLYING. READ ONLY, ALL OF IT.
--    EXPECTED VALUES STATED.
--
-- These are commented out so they cannot run inside the transaction
-- above, and so a dry run stops at the COMMIT line and executes none of
-- them. Paste them into the SQL Editor one at a time, after the COMMIT
-- has landed.
-- =====================================================================
--
-- V1. THE NEW HELPER EXISTS WITH THE RIGHT SHAPE.
--
--       SELECT p.proname,
--              pg_get_function_result(p.oid) AS returns,
--              p.prosecdef  AS security_definer,
--              p.provolatile,
--              p.proconfig
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname = 'current_user_commercial_counterparty_user_ids';
--       -- EXPECTED: exactly 1 row.
--       --   returns          = SETOF uuid
--       --   security_definer = t
--       --   provolatile      = s          (STABLE - 'v' would be VOLATILE)
--       --   proconfig        = {"search_path=public, pg_temp"}
--       --
--       -- proconfig NULL means the search_path did not pin. On a
--       -- SECURITY DEFINER function that is a real hazard, not a cosmetic
--       -- one. ROLL BACK.
--
-- V2. THE STATUS PREDICATE IS THE INCLUSION FORM, AND THE ONLY
--     DIFFERENCE FROM 079's HELPER.
--
--       SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('current_user_active_counterparty_user_ids',
--                           'current_user_commercial_counterparty_user_ids')
--       ORDER BY p.proname;
--       -- EXPECTED: 2 rows. Diff them by eye. The ONLY difference must be
--       -- p.status = 'active'  vs  p.status IN ('pending', 'active', 'suspended')
--       -- appearing twice each. If the ACTIVE one has changed in any way,
--       -- this file touched something prohibition 4 forbids. ROLL BACK.
--
-- V3. THE GRANTS. anon MUST BE FALSE.
--
--       SELECT has_function_privilege('anon',
--                'public.current_user_commercial_counterparty_user_ids()', 'EXECUTE')
--                AS anon_execute,
--              has_function_privilege('authenticated',
--                'public.current_user_commercial_counterparty_user_ids()', 'EXECUTE')
--                AS authenticated_execute;
--       -- EXPECTED: anon_execute = f, authenticated_execute = t
--       --
--       -- anon_execute = t means the default privilege survived the
--       -- REVOKE. Re-run both REVOKE lines and re-check before going
--       -- further - an anon caller could then call the function, and
--       -- although auth.uid() is NULL for anon so it returns no rows,
--       -- an executable SECURITY DEFINER function reachable by anon is
--       -- not something to leave standing on a guess.
--
-- V4. THE POLICY NOW HAS FOUR ARMS.
--
--       SELECT policyname, cmd, permissive, roles, qual, with_check
--       FROM pg_policies
--       WHERE schemaname = 'public'
--         AND tablename  = 'notifications'
--       ORDER BY policyname;
--       -- EXPECTED: exactly 3 rows, unchanged in name and count:
--       --   "Scoped insert notifications"         INSERT  qual NULL
--       --   "Users can update own notifications"  UPDATE
--       --   "Users can view own notifications"    SELECT
--       --
--       -- The INSERT row's with_check must contain ALL FOUR of:
--       --   auth.uid()
--       --   current_user_org_member_user_ids
--       --   current_user_active_counterparty_user_ids
--       --   current_user_commercial_counterparty_user_ids
--       --
--       -- If current_user_active_counterparty_user_ids is MISSING, this
--       -- file REPLACED an arm instead of adding one. If
--       -- current_user_org_member_user_ids is MISSING, it undid 094 and
--       -- every colleague notification has just stopped. Either way ROLL
--       -- BACK IMMEDIATELY - 096_bid_notification_scope_down.sql.
--       --
--       -- The SELECT row's qual must still read (user_id = auth.uid())
--       -- and nothing else. This file does not touch it. If it has
--       -- changed, something other than this file ran.
--
-- V4b. THE ARM COUNT, COUNTED RATHER THAN EYEBALLED.
--
--       SELECT (length(with_check)
--               - length(replace(with_check, 'current_user_', ''))) / length('current_user_')
--                 AS helper_mentions
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'notifications'
--         AND policyname = 'Scoped insert notifications';
--       -- EXPECTED: 3.  Three helper calls plus the auth.uid() arm = four arms.
--       -- 2 means an arm was lost. 4 means an arm was added twice.
--
-- V5. THE POLICY COUNT DID NOT MOVE.
--
--       SELECT count(*) AS policies FROM pg_policies WHERE schemaname = 'public';
--       -- EXPECTED: 117, the same number 089-095 left behind. ALTER
--       -- POLICY creates and drops nothing, so this file cannot change
--       -- it. 118 means a DROP-then-CREATE ran somewhere and there are
--       -- now two permissive INSERT policies on notifications ORing
--       -- together. 116 means a DROP landed and nothing replaced it.
--       -- Either is a stop-and-read, not a retry.
--
-- V6. THE HELPER FAMILY IS STILL ORDERED BY BREADTH.
--
--       SELECT p.proname
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname LIKE 'current\_user\_%'
--       ORDER BY p.proname;
--       -- EXPECTED: 9 rows -
--       --   current_user_active_counterparty_user_ids
--       --   current_user_admin_org_ids
--       --   current_user_commercial_counterparty_org_ids
--       --   current_user_commercial_counterparty_user_ids   <- NEW
--       --   current_user_counterparty_org_ids
--       --   current_user_email
--       --   current_user_org_ids
--       --   current_user_org_member_user_ids
--       --   current_user_visible_profile_ids
--
-- V7. THE THING GREG ACTUALLY WANTS TO SEE. Run it as yourself, in the
--     agency portal's own session, AFTER a vendor on a pending
--     partnership submits a bid:
--
--       SELECT id, type, title, created_at
--       FROM public.notifications
--       WHERE type = 'bid_submitted'
--       ORDER BY created_at DESC
--       LIMIT 5;
--       -- EXPECTED BEFORE 096: no row from any PORTAL bid. Any row here
--       -- came from the guest token path, which is service role.
--       -- EXPECTED AFTER 096: one row per member of the agency, per bid.
-- =====================================================================
