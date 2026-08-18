-- =====================================================================
-- Migration 087: a lead agency stops being able to name any organization
--                it likes on the vendor side of a partnership.
--
--   NEW      public.org_has_member_with_email(uuid, text)
--   REPLACED policy "Agencies can create partnerships"   (narrowed)
--   NEW      trigger partnerships_guard_identity_columns BEFORE UPDATE
--
-- This closes the residual 079 stated and 085 restated and deliberately
-- left open. It does NOT change what a permitted reader sees, and it does
-- NOT change any SELECT policy.
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- This file is AUTHORED, NOT APPLIED. Nothing in the session that wrote it
-- executed a single statement against any database - there is no psql on
-- PATH and every POSTGRES_* credential in this environment is an empty
-- string. It is applied by Greg, by hand, in the Supabase SQL Editor.
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN on LINE 411 and
-- an explicit COMMIT on LINE 583. They are the only executable occurrences
-- of either word: every other appearance is inside this comment block or
-- is the plpgsql BEGIN/END of the trigger body, which carries no semicolon.
--
-- TO DRY RUN: change the COMMIT; on line 583 to ROLLBACK; and run the whole
-- file. Every statement executes, every error surfaces, and nothing
-- persists. Migration 086 shipped with NO transaction control at all, so
-- that same swap silently did nothing and what was believed to be a dry run
-- applied for real with no rollback available. Verify before trusting:
--   grep -n '^BEGIN;$'  -> exactly one hit, line 411
--   grep -n '^COMMIT;$' -> exactly one hit, line 583
--
-- Sequence, in order, no step skipped:
--
--   1. Run the PRE-FLIGHT CAPTURE below. It has FOUR queries and TWO of
--      them can stop this migration outright. Read all four before
--      running anything else.
--   2. READ "ORDERING AGAINST THE CODE" below. There is one behaviour
--      change on the bid-award path and it is a LOUD failure, not a
--      silent one. Decide whether to accept it before applying.
--   3. Dry run: swap COMMIT for ROLLBACK, run, confirm no errors.
--   4. Run this file for real. Expect "Success. No rows returned".
--   5. Run the VERIFICATION block at the foot. Every query states its
--      expected value. If any one disagrees, roll back with
--      087_partnership_vendor_identity_down.sql.
--   6. Only then, update the migrations table in LIGAMENT_CONTEXT.md.
--
-- =====================================================================
-- WHAT IS WRONG TODAY, AND WHAT IT IS WORTH
-- =====================================================================
--
-- THE LIVE POLICY, quoted exactly as migration 079 created it
-- (supabase/migrations/079_organizations.sql lines 1464-1466):
--
--     CREATE POLICY "Agencies can create partnerships"
--       ON public.partnerships AS PERMISSIVE FOR INSERT TO authenticated
--       WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));
--
-- WHAT IT CONSTRAINS: the LEAD side only. The row must be filed under an
-- organization the caller is a member of, and current_user_org_ids() takes
-- no parameter, so the caller cannot name a lead organization it does not
-- belong to.
--
-- WHAT IT SAYS NOTHING ABOUT: vendor_org_id, partner_email, status, and
-- every other column. vendor_org_id in particular is a free-text uuid on
-- insert, checked by nothing but its foreign key to organizations(id).
--
-- WHY THAT MATTERS. Migration 085 admits 'pending' to the COMMERCIAL tier
-- (current_user_commercial_counterparty_org_ids), which gates
-- public.profiles through current_user_visible_profile_ids(). RLS is ROW
-- level. So one INSERT of a pending partnership naming organization X
-- grants the inserting agency read access to the WHOLE profiles row of
-- every member of X:
--
--     default_terms      jsonb  payment terms, kill fee, IP position,
--                               rate validity              (migration 070)
--     business_criteria  jsonb  insurance limits and the
--                               certificate-of-insurance URL (migration 060)
--     default_nda_url    text                              (migration 050)
--     email, full_name, company_name, capabilities, credentials, ...
--
-- The other side is never asked and never told. No route runs, so no
-- invitation email is sent. It is symmetric: the same trick run from a
-- vendor account reads a lead agency's profile.
--
-- =====================================================================
-- IT IS FOUR POLICIES, NOT ONE. THIS IS THE COUNT THAT MATTERS.
-- =====================================================================
--
-- 079 and 085 both describe this as one INSERT policy. Fixing only the
-- INSERT policy would be a NO-OP, because three UPDATE policies reach the
-- same end state. All six live policies on public.partnerships, read from
-- 079_organizations.sql lines 1464-1500:
--
--   1. "Agencies can create partnerships"      INSERT
--      WITH CHECK (lead_org_id IN (SELECT current_user_org_ids()))
--      -> vendor_org_id unconstrained.                    THE STATED HOLE.
--
--   2. "Agencies can view their partnerships"  SELECT     not a write.
--
--   3. "Agencies can update their partnerships" UPDATE
--      USING      (lead_org_id IN (SELECT current_user_org_ids()))
--      WITH CHECK (lead_org_id IN (SELECT current_user_org_ids()))
--      -> vendor_org_id unconstrained. INSERT a ghost row with
--         vendor_org_id NULL, then UPDATE it to the victim organization.
--         Closing the INSERT alone leaves this door wide open.
--
--   4. "Partners can view their partnerships"  SELECT     not a write.
--
--   5. "Partners can update partnership status" UPDATE
--      USING      (vendor_org_id IN (SELECT current_user_org_ids()))
--      WITH CHECK (vendor_org_id IN (SELECT current_user_org_ids()))
--      -> lead_org_id unconstrained. THE SYMMETRIC HOLE: a vendor with any
--         one real partnership rewrites that row's lead_org_id to a victim
--         organization and becomes its commercial counterparty.
--
--   6. "Partners can claim partnership by email" UPDATE
--      USING (vendor_org_id IS NULL AND partner_email ILIKE <own email>)
--      WITH CHECK (vendor_org_id IN (SELECT current_user_org_ids()))
--      -> lead_org_id unconstrained. Same as 5, needing a ghost row
--         addressed to the caller's own email address to exist first.
--
-- There is NO DELETE policy on public.partnerships. Four write policies,
-- three distinct holes, one shared consequence.
--
-- =====================================================================
-- HOW AN AGENCY OBTAINS ANOTHER ORGANIZATION'S ID TODAY
-- =====================================================================
--
-- Freely, and by two independent routes. This is not a guessing attack.
--
--   A. public.partner_vouches, "Anyone can count vouches",
--      SELECT {public} USING (true), still live.
--      079 dropped and rewrote only "Agencies can vouch" and "Agencies can
--      remove their vouch" (079 lines 557-558, 1455-1461). It never
--      touched this third policy, so the open SELECT SURVIVED the rename
--      and now publishes the renamed columns: lead_org_id and
--      vendor_org_id. Any holder of the publishable anon key can run
--        select lead_org_id, vendor_org_id from public.partner_vouches
--      and read ORGANIZATION IDS for both endpoints of every vouch on the
--      platform. Migration 082 closes this and is AUTHORED, NOT APPLIED.
--      This route works for accounts created after 079 too.
--
--   B. GET /api/marketplace/discoverable returns profiles.id for every
--      profile with is_discoverable = true. For the SIXTEEN legacy
--      accounts 079's backfill set organizations.id = profiles.id, so
--      every one of those ids IS an organization id. The signup trigger
--      issues gen_random_uuid() from 2026-08-18, so this route does not
--      yield an organization id for newer accounts (gmarkant+neworg1 is
--      the one such account today).
--
-- Route A alone is sufficient and is not limited to legacy accounts.
-- CONCLUSION: organization ids are effectively public, so the escalation
-- is trivial rather than narrow. Evidence, not inference: both policies
-- above are read from files in this repository, and neither was executed.
-- The number of rows in partner_vouches is unknown here - see PRE-FLIGHT
-- P4, which bounds how many organizations route A actually discloses.
--
-- =====================================================================
-- THE LEGITIMATE INSERT SHAPES, ENUMERATED FIRST
-- =====================================================================
--
-- Seven code sites insert into public.partnerships. Which client each uses
-- decides whether an RLS policy touches it at all - the service role
-- bypasses RLS entirely.
--
--   SESSION CLIENT (RLS applies - these are what the new policy must
--   permit):
--
--   S1. app/api/partnerships/route.ts POST, the invite path.
--       lead_org_id  = writeOrgId, the caller's acting organization.
--       vendor_org_id = resolveOrgIdForUser(partner.id), where `partner`
--                       is a profiles row the SESSION client just read by
--                       id or by email. Absent when no profile matched.
--       partner_email = (partner?.email || payload email), lowercased.
--       SO: whenever vendor_org_id is written, partner_email is the email
--       of a profile that IS a member of that organization. Always.
--
--   S2. The same route, ghost shape. vendor_org_id absent, partner_email
--       set. This is 27 of the 31 live rows as of 2026-08-17 (079 line 952).
--
--   S3. lib/partnership-invitations.ts markPartnershipInvited(), reached
--       from app/api/agency/pool/resend-invitation/route.ts with the
--       session client and NO partnerId, so vendor_org_id is null.
--
--   S4. lib/award-partnership-resolution.ts branch d, reached from
--       app/api/agency/rfp-responses/[id]/route.ts with the session
--       client. vendor_org_id = partnerIdForResolution, partner_email =
--       the email resolved for that same organization through
--       resolveOrgNotificationRecipients(), i.e. one of its members.
--       ONE EXCEPTION, and it is the one behaviour change this migration
--       makes - see ORDERING AGAINST THE CODE below.
--
--   S5. The same file, pure-guest branch. vendor_org_id explicitly null.
--
--   SERVICE ROLE (RLS does not apply - listed so nobody thinks they were
--   missed):
--
--   V1. app/api/agency/email-scan/import/route.ts     vendor_org_id null.
--   V2. lib/server/partner-pool-import.ts             vendor_org_id null.
--   V3. app/api/rfp/guest/[token]/route.ts            vendor_org_id set
--       from matchedProfileId, a PROFILES id in an organization column.
--       That is an open 079 parameter-class defect, reported separately;
--       it is accidentally correct for the sixteen legacy accounts and a
--       23503 for anything newer. Not introduced or changed here.
--   V4. lib/broadcast-partnership-cue.ts, behind BROADCAST_CUES_PARTNERSHIP.
--   V5. markPartnershipInvited() from app/api/agency/rfp/magic-link,
--       vendor_org_id = matchedVendorOrgId, resolved from the profile
--       whose email is the same vendorEmail written to partner_email.
--
-- THE INVARIANT EVERY LEGITIMATE SHAPE ALREADY SATISFIES, and the one the
-- escalation cannot:
--
--     vendor_org_id IS NULL
--     OR some member of vendor_org_id has profiles.email = partner_email
--
-- Every legitimate writer derives the organization FROM the email address.
-- The attack supplies an organization id it read out of partner_vouches or
-- the marketplace, and has no matching email to go with it - the
-- marketplace masks `email` to null unless there is already an ACTIVE
-- partnership (app/api/marketplace/discoverable/route.ts, maskedProfiles).
--
-- =====================================================================
-- WHAT THIS CONSTRAINT DOES NOT DO. STATED, NOT BURIED.
-- =====================================================================
--
-- IT IS NOT A CONSENT GATE. After this migration an agency that knows a
-- real member email address can still create a pending partnership and
-- still reads that organization's profiles rows before anyone accepts.
-- What changes is the identifier required: from "an organization id",
-- which partner_vouches publishes to the whole internet, to "a member's
-- email address", which the product only reveals to a counterparty.
--
-- Making the insert CONSENSUAL is a different and larger decision, and it
-- is Greg's. The two options and their costs, neither taken here:
--
--   OPTION C1. Remove 'pending' from
--   current_user_commercial_counterparty_org_ids(). Then no unaccepted
--   partnership discloses a profile at all.
--   COST: 085 admitted 'pending' deliberately. Contact name and email
--   disappear from every invitation card on both sides while an
--   invitation is in flight - /agency/pool pending cards fall back
--   through lib/org-contact.ts to partnerships.partner_email, and
--   /partner/network invitation cards render "Email not available". That
--   lands on every live invitation, not on the abusive ones.
--
--   OPTION C2. Require vendor_org_id IS NULL on every insert, so only the
--   vendor's own claim path (policy 6, which already requires
--   partner_email to match the caller's own address) can ever link an
--   organization. Genuinely consensual.
--   COST: app/api/partnerships/route.ts stops writing vendor_org_id when
--   it invites somebody who already has an account, so
--   notifyPartnershipInvitation() - which is guarded by
--   `if (partner && partnership.vendor_org_id)` - stops firing SILENTLY,
--   and the agency's own pool renders the invitee as an unclaimed ghost
--   until that vendor next loads their portal and the auto-claim in GET
--   /api/partnerships runs. A silent lost notification is precisely the
--   class of defect this project keeps being bitten by.
--
-- IT ALSO DOES NOT CHANGE WHICH COLUMNS a permitted reader sees. RLS is
-- row level. Column-level control is a view or a policy per column set,
-- and that is a larger design than this.
--
-- =====================================================================
-- WHY A POLICY FOR INSERT AND A TRIGGER FOR UPDATE
-- =====================================================================
--
-- THE INSERT IS A POLICY because a policy does not touch the service role,
-- and every service-role writer above is already scoped by a server-side
-- resolver rather than by anything a client supplies. Narrowing them buys
-- nothing and risks a route that cannot be tested from here.
--
-- THE UPDATES ARE A TRIGGER because the thing that must be enforced is
-- IMMUTABILITY, and a policy cannot express it. WITH CHECK sees only the
-- new row. There is no OLD in a policy. "lead_org_id may not change" is
-- not a predicate over NEW alone, so holes 5 and 6 are unreachable by any
-- policy that does not also constrain the caller by a VISIBILITY set -
-- and scoping a WRITE by current_user_counterparty_org_ids() or by
-- current_user_visible_profile_ids() is forbidden outright in this
-- project, correctly.
--
-- A trigger has a second property that matters more here than elegance:
-- IT RAISES. An RLS UPDATE that matches no row returns HTTP 200 with zero
-- rows and no error - the success-shaped non-event this codebase has been
-- bitten by five separate times. A trigger that refuses says so.
--
-- THE COST OF THE TRIGGER, STATED: it fires for the service role too. It
-- is therefore written to guard TRANSITIONS THAT NO CODE PATH PERFORMS,
-- verified by reading every writer:
--   lead_org_id is never updated anywhere. Grep of app/ and lib/ for an
--   update touching it returns nothing.
--   vendor_org_id is only ever written NULL -> value. Every site that
--   writes it guards on the old value being null:
--     lib/award-partnership-resolution.ts   `...(existingRow.vendor_org_id ? {} : ...)`
--     lib/partnership-award-claim.ts        `.is("vendor_org_id", null)`
--     app/api/rfp/guest/[token]/route.ts    `else if (!existingPartnership.vendor_org_id)`
--     app/api/agency/email-scan/import/route.ts  comment: "never touch
--                                           status/profile_status/vendor_org_id here"
-- So on today's code the trigger is a no-op that starts doing work the day
-- somebody writes a repoint.
--
-- NOTHING HERE WIDENS ANY PREDICATE. The INSERT policy gains an AND. The
-- trigger only refuses. No SELECT policy, no helper that any SELECT policy
-- reads, and no GRANT is altered. The three visibility helpers are not
-- touched.
--
-- =====================================================================
-- ORDERING AGAINST THE CODE. GET THIS RIGHT.
-- =====================================================================
--
-- THIS MIGRATION IS SAFE TO APPLY BEFORE ANY CODE CHANGE. It needs none,
-- and there is no code change in this run that it depends on. But it has
-- ONE behaviour change and it is worth deciding about first.
--
-- THE SITE: app/api/agency/rfp-responses/[id]/route.ts, awarding a bid,
-- reaching lib/award-partnership-resolution.ts branch d (shape S4 above).
-- That branch resolves the vendor's email through
-- resolveOrgNotificationRecipients(partnerIdForResolution, supabase) using
-- the SESSION client. If the agency cannot read any member profile of that
-- organization - which is possible when no partnership exists yet, because
-- that is exactly what the profiles policy gates on - vendorEmail comes
-- back null, and the insert today writes vendor_org_id set with
-- partner_email NULL. After this migration that insert is REFUSED.
--
-- THE FAILURE IS LOUD, WHICH IS WHY IT IS ACCEPTABLE. insertErr is
-- returned, the route logs "[api] bid award: partnership resolution
-- failed" with the responseId and the message, and the caller gets HTTP
-- 500 with "Cannot award this bid: no vendor account or email is linked to
-- it, so no relationship could be established." Nothing is silently lost.
--
-- PRE-FLIGHT P3 bounds how often this can happen on live data. If it
-- returns anything but 0, ship the code fix first (resolve the vendor
-- email from the magic token as the sibling branch already does) and apply
-- this afterwards.
--
-- ONE MORE THING THAT SHOWS UP IN THE SAME BRANCH AND IS NOT FIXED HERE:
-- that route calls resolvePartnershipForAward(supabase, { agencyId:
-- user.id, ... }) and agencyId is written to lead_org_id. That is a USER
-- id in an ORGANIZATION column - an open 079 parameter-class defect,
-- accidentally correct for the sixteen legacy accounts and a foreign key
-- violation for gmarkant+neworg1. This migration neither causes it nor
-- cures it. It is reported in docs/m1-cleanup-report.md.
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. RUN THESE FOUR FIRST. READ ONLY.
-- =====================================================================
--
-- P1. THE ONE THAT CAN STOP THIS MIGRATION. How many live rows already
--     VIOLATE the invariant this file is about to enforce? The INSERT
--     policy and the trigger both only constrain new writes, so a
--     violating row keeps working - but a violating row is also evidence
--     that a legitimate shape exists which this file did not enumerate.
--
--       SELECT p.id, p.lead_org_id, p.vendor_org_id, p.partner_email, p.status
--       FROM public.partnerships p
--       WHERE p.vendor_org_id IS NOT NULL
--         AND NOT EXISTS (
--           SELECT 1 FROM public.org_members m
--           JOIN public.profiles pr ON pr.id = m.user_id
--           WHERE m.org_id = p.vendor_org_id
--             AND lower(btrim(pr.email)) = lower(btrim(p.partner_email))
--         );
--
--     EXPECTED: 0 rows. As of 079's own count (line 952) only 4 of 31
--     partnerships have a non-null vendor_org_id at all, so this is a
--     small set to eyeball. IF ANY ROW COMES BACK, STOP AND READ IT. Each
--     one is either a shape this file missed or an already-broken row, and
--     which it is changes the fix.
--
-- P2. Confirm the policy this file replaces is exactly what it thinks.
--
--       SELECT policyname, cmd, roles, qual, with_check
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'partnerships'
--       ORDER BY policyname;
--
--     EXPECTED: 6 rows and no more. "Agencies can create partnerships",
--     cmd = INSERT, roles = {authenticated}, qual NULL, with_check
--     `(lead_org_id IN ( SELECT current_user_org_ids() AS ...))`. If the
--     with_check already mentions vendor_org_id, somebody has changed it
--     out of band and this file is stale. If there are 7 rows, read the
--     seventh before applying.
--
-- P3. Bounds the one behaviour change. How many partnerships have a
--     vendor_org_id and a NULL partner_email? Those are the rows the S4
--     branch would have created, and a non-zero count means the branch has
--     fired that way before.
--
--       SELECT count(*) FROM public.partnerships
--       WHERE vendor_org_id IS NOT NULL AND partner_email IS NULL;
--
--     EXPECTED: 0. If it is not 0, read ORDERING AGAINST THE CODE again
--     and ship the code fix first.
--
-- P4. Bounds how much route A above actually discloses. Not a gate on this
--     migration - it is the argument for applying 082 next.
--
--       SELECT count(*) AS vouch_rows,
--              count(DISTINCT lead_org_id)   AS lead_orgs_exposed,
--              count(DISTINCT vendor_org_id) AS vendor_orgs_exposed
--       FROM public.partner_vouches;
--
--     EXPECTED: whatever it is. Every organization id in those two columns
--     is readable by anyone holding the anon key until 082 is applied.
--
-- =====================================================================


BEGIN;

-- ---------------------------------------------------------------------
-- 1. The invariant, as a function.
--
-- SECURITY DEFINER because the caller must NOT be able to read the rows
-- this consults. An agency inviting a vendor it has no relationship with
-- cannot read that vendor's profiles row - that is the whole point of the
-- profiles policy - so an inline EXISTS in the policy body would evaluate
-- as the caller, find nothing, and DENY every legitimate first invitation.
-- That failure would be silent at the product surface and total.
--
-- WHAT IT DISCLOSES, STATED RATHER THAN BURIED. EXECUTE must be granted to
-- `authenticated` because a policy expression is evaluated with the
-- privileges of the querying role, so this is callable directly over RPC.
-- It is therefore a membership ORACLE: an authenticated caller who already
-- holds BOTH a valid organization id AND a guessed email address can
-- confirm the pairing. It returns one boolean and nothing else. It cannot
-- be used to enumerate: it will not yield an email from an organization id
-- or an organization id from an email, because it accepts both and returns
-- neither. That is a real but strictly smaller disclosure than the
-- whole-profiles-row read it exists to close, and it is the reason the
-- signature is (uuid, text) -> boolean rather than the more convenient
-- (text) -> uuid.
--
-- STABLE, not IMMUTABLE: it reads tables.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_has_member_with_email(
  p_org_id uuid,
  p_email  text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_members m
    JOIN public.profiles pr ON pr.id = m.user_id
    WHERE m.org_id = p_org_id
      AND p_email IS NOT NULL
      AND pr.email IS NOT NULL
      AND lower(btrim(pr.email)) = lower(btrim(p_email))
  );
$$;

COMMENT ON FUNCTION public.org_has_member_with_email(uuid, text) IS
  'True when some member of p_org_id has profiles.email equal to p_email, compared '
  'case-insensitively and after trimming. NULL on either side is false. This is an '
  'AUTHORITY predicate, not a visibility set: it takes both of its inputs as parameters '
  'and derives nothing from auth.uid(), so it grants nobody anything on its own. It exists '
  'so that a write path can require that the vendor organization named on a partnership is '
  'the organization of the person the row is addressed to - see migration 087. It is '
  'SECURITY DEFINER because the caller legitimately cannot read the invitee''s profile. '
  'Do NOT reuse it as a read predicate and do NOT add a variant that returns the '
  'organization id, which would turn a confirm-oracle into a lookup-oracle.';

REVOKE EXECUTE ON FUNCTION public.org_has_member_with_email(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.org_has_member_with_email(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. The INSERT policy, narrowed.
--
-- The lead half is UNCHANGED, character for character. Only an AND is
-- added. Every insert permitted after this was permitted before it.
-- NOTHING IS WIDENED.
--
-- Written by INCLUSION and not by exclusion, which is the opposite of
-- migration 085's choice and for the stated reason: 085 was building a
-- VISIBILITY set, where showing one row too many is the safe direction.
-- This is an AUTHORITY predicate, where the safe direction is the other
-- one. An unanticipated shape is REFUSED here, loudly, rather than
-- admitted.
--
-- A refusal surfaces through PostgREST as 42501, "new row violates
-- row-level security policy for table partnerships", with HTTP 403. The
-- one route that can hit it (S4) already catches the error, logs it with
-- the response id, and returns a 500 that says what happened.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Agencies can create partnerships" ON public.partnerships;

CREATE POLICY "Agencies can create partnerships"
  ON public.partnerships AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    lead_org_id IN (SELECT public.current_user_org_ids())
    AND (
      -- The ghost shape. 27 of 31 live rows. Grants the named vendor
      -- nothing at all until their own claim path links them.
      vendor_org_id IS NULL
      -- The linked shape. The organization named on the vendor side must
      -- be the organization of the person this row is addressed to.
      OR public.org_has_member_with_email(vendor_org_id, partner_email)
    )
  );

-- ---------------------------------------------------------------------
-- 3. The UPDATE trigger.
--
-- Three refusals, each closing one of the holes enumerated above, and
-- each guarding a transition no code path in this repository performs.
--
-- NOT SECURITY DEFINER. It reads only NEW and OLD, and the one table read
-- it needs is inside org_has_member_with_email(), which is already
-- SECURITY DEFINER and already granted to authenticated.
--
-- The ERRCODEs are chosen so a caller can tell them apart:
--   23514 check_violation      the invariant failed
--   42501 insufficient_privilege  an immutable column was rewritten
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partnerships_guard_identity_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- HOLE 5 AND 6. lead_org_id is immutable. A vendor holding one real
  -- partnership must not be able to repoint it at an organization it has
  -- no relationship with and become that organization's commercial
  -- counterparty. No write path anywhere updates this column.
  IF NEW.lead_org_id IS DISTINCT FROM OLD.lead_org_id THEN
    RAISE EXCEPTION
      'partnerships.lead_org_id is immutable (attempted % -> %)',
      OLD.lead_org_id, NEW.lead_org_id
      USING ERRCODE = '42501';
  END IF;

  IF NEW.vendor_org_id IS DISTINCT FROM OLD.vendor_org_id
     AND NEW.vendor_org_id IS NOT NULL THEN

    -- Repointing an already-linked vendor is refused outright. Every
    -- writer already guards on the old value being null; none of them
    -- needs this and an appearance of it is a defect worth surfacing.
    IF OLD.vendor_org_id IS NOT NULL THEN
      RAISE EXCEPTION
        'partnerships.vendor_org_id cannot be repointed once set (attempted % -> %)',
        OLD.vendor_org_id, NEW.vendor_org_id
        USING ERRCODE = '42501';
    END IF;

    -- HOLE 3. The insert-a-ghost-then-update bypass. Without this line the
    -- new INSERT policy above is decorative.
    IF NOT public.org_has_member_with_email(NEW.vendor_org_id, NEW.partner_email) THEN
      RAISE EXCEPTION
        'partnerships.vendor_org_id % has no member whose email matches partner_email %',
        NEW.vendor_org_id, NEW.partner_email
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.partnerships_guard_identity_columns() IS
  'BEFORE UPDATE guard on public.partnerships, added by migration 087. Enforces what row '
  'level security cannot: lead_org_id never changes, vendor_org_id is only ever written '
  'NULL -> value, and the value written must be the organization of the person the row is '
  'addressed to. A policy WITH CHECK sees only the new row, so immutability is not '
  'expressible as a policy, and the alternative - scoping the write by a counterparty '
  'VISIBILITY set - is forbidden in this schema. It RAISES rather than filtering, because '
  'an RLS update that matches no row returns HTTP 200 with no error and this project has '
  'lost real behaviour to exactly that five times.';

DROP TRIGGER IF EXISTS partnerships_guard_identity_columns ON public.partnerships;

CREATE TRIGGER partnerships_guard_identity_columns
  BEFORE UPDATE ON public.partnerships
  FOR EACH ROW
  EXECUTE FUNCTION public.partnerships_guard_identity_columns();

COMMIT;


-- =====================================================================
-- VERIFICATION. RUN AFTER APPLYING. READ ONLY EXCEPT V5 AND V6, WHICH ARE
-- WRITES AND ARE MARKED. EXPECTED VALUES STATED.
-- =====================================================================
--
-- V1. The function exists and is hardened like every other helper here.
--
--       SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig, p.proacl
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'org_has_member_with_email';
--
--     EXPECTED: 1 row. prosecdef = t, provolatile = 's',
--     proconfig = {"search_path=public, pg_temp"}, and proacl contains
--     authenticated=X/ with NO bare =X/ entry (that would be the PUBLIC
--     grant this file revokes).
--
-- V2. The six visibility and membership helpers are UNTOUCHED. This
--     migration must not have moved any of them.
--
--       SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS body_hash
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname LIKE 'current\_user\_%'
--       ORDER BY p.proname;
--
--     EXPECTED: 6 rows, the same six migration 085 verified -
--       current_user_active_counterparty_user_ids
--       current_user_admin_org_ids
--       current_user_commercial_counterparty_org_ids
--       current_user_counterparty_org_ids
--       current_user_org_ids
--       current_user_visible_profile_ids
--     Capture the hashes BEFORE applying as well, and diff them. Any
--     change means this file did something it does not describe.
--
-- V3. Still six policies on partnerships, and only the INSERT one moved.
--
--       SELECT policyname, cmd, roles, qual, with_check
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'partnerships'
--       ORDER BY policyname;
--
--     EXPECTED: 6 rows. "Agencies can create partnerships" INSERT
--     {authenticated} with_check now mentions BOTH current_user_org_ids
--     AND org_has_member_with_email. The other five are byte-identical to
--     what P2 captured.
--
-- V4. The trigger is attached, BEFORE, FOR EACH ROW, on UPDATE only.
--
--       SELECT tgname, tgtype, tgenabled, pg_get_triggerdef(oid)
--       FROM pg_trigger
--       WHERE tgrelid = 'public.partnerships'::regclass AND NOT tgisinternal;
--
--     EXPECTED: 1 row, partnerships_guard_identity_columns, tgenabled = 'O',
--     and its definition reads BEFORE UPDATE ... FOR EACH ROW. If it says
--     BEFORE INSERT OR UPDATE, this is not the file that was applied.
--
-- V5. THE ESCALATION IS CLOSED. A WRITE. Run AS gmarkant@gmail.com from
--     the application (a real authenticated session), NOT as postgres -
--     postgres bypasses RLS and proves nothing. Use New Org 1's
--     organization id, which is a real organization this account has no
--     relationship with.
--
--       INSERT INTO public.partnerships (lead_org_id, vendor_org_id, partner_email, status)
--       VALUES ('<gmarkant@gmail.com org id>',
--               '43c6628a-8953-4dc5-96da-fe0ecee5e57c',
--               'attacker-supplied@example.com',
--               'pending');
--
--     EXPECTED: ERROR 42501, "new row violates row-level security policy
--     for table partnerships". BEFORE 087 THIS SUCCEEDED. If it still
--     succeeds, the policy did not replace cleanly - re-run V3.
--
--     Then confirm the read it used to buy is not available:
--
--       SELECT id, email, default_terms, business_criteria
--       FROM public.profiles
--       WHERE id = '7cee347d-b224-40c2-a2cf-145c863ade9d';
--
--     EXPECTED: 0 rows.
--
-- V6. THE BYPASS IS CLOSED. A WRITE, same session. Create the ghost shape
--     first, which is legitimate and must still succeed, then try to
--     repoint it.
--
--       INSERT INTO public.partnerships (lead_org_id, vendor_org_id, partner_email, status)
--       VALUES ('<gmarkant@gmail.com org id>', NULL, 'ghost-087-test@example.com', 'pending')
--       RETURNING id;
--       -- EXPECTED: 1 row. The ghost shape is untouched by this migration.
--
--       UPDATE public.partnerships
--       SET vendor_org_id = '43c6628a-8953-4dc5-96da-fe0ecee5e57c'
--       WHERE id = '<the id just returned>';
--       -- EXPECTED: ERROR 23514, "partnerships.vendor_org_id ... has no
--       -- member whose email matches partner_email ...". NOT "0 rows".
--
--       DELETE FROM public.partnerships WHERE id = '<the id just returned>';
--       -- There is no DELETE policy on partnerships, so this will refuse
--       -- from a session. Clean the test row up as postgres in the SQL
--       -- editor instead, and do it - a stray ghost row shows up in the
--       -- pool as a Discovered vendor.
--
-- V7. THE LEGITIMATE PATH STILL WORKS. THIS IS THE ONE THAT CATCHES AN
--     OVER-NARROW FIX, and it must be run before this is considered done.
--     In the product, as gmarkant@gmail.com: /agency/pool, Add Partner,
--     invite gmarkant+neworg1@gmail.com by email address.
--
--     EXPECTED: the invitation is created, the pool shows the row, and the
--     invitation email sends. The route resolves that address to its
--     profile and then to its organization, so partner_email and
--     vendor_org_id agree and the new predicate passes. IF THIS FAILS WITH
--     A 403, the invariant is wrong about a real shape - roll back with
--     087_partnership_vendor_identity_down.sql and re-read P1's output.
--
-- V8. The vendor side still works. As gmarkant+neworg1@gmail.com, open
--     /partner/invitations and ACCEPT the invitation from V7.
--
--     EXPECTED: it accepts. That path is "Partners can update partnership
--     status" writing status only, and the trigger sees no change to
--     lead_org_id or vendor_org_id, so it returns NEW untouched.
--     Then DECLINE a second invitation and confirm the agency still
--     receives the decline email - that is 085's ordering constraint, not
--     this file's, but it runs through the same UPDATE.
