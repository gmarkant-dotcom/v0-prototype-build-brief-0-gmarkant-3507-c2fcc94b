-- =====================================================================
-- Migration 085: an ended relationship stops disclosing commercial terms.
--
--   NEW      public.current_user_commercial_counterparty_org_ids()
--   REPLACED public.current_user_visible_profile_ids()   (narrowed)
--   UNCHANGED public.current_user_counterparty_org_ids() (deliberately)
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
-- Sequence, in order, no step skipped:
--
--   1. Run the PRE-FLIGHT CAPTURE below. It has THREE queries and one of
--      them can change the answer this migration gives. Read all three
--      before running anything else. If P1 disagrees with what this file
--      says it expects, STOP and regenerate.
--   2. SHIP THE CODE CHANGE FIRST. See "ORDERING" below. This migration
--      must NOT be applied before commit "fix: resolve the decline
--      notification recipient before the status moves" is deployed, or
--      the decline email stops sending and logs its own failure while the
--      request still returns 200.
--   3. Run this file. Expect "Success. No rows returned".
--   4. Run the VERIFICATION block at the foot. Every query states its
--      expected value. If any one disagrees, roll back with
--      085_counterparty_status_boundary_down.sql.
--   5. Only then, update the migrations table in LIGAMENT_CONTEXT.md.
--
-- =====================================================================
-- WHAT IS WRONG TODAY
-- =====================================================================
--
-- current_user_counterparty_org_ids() has NO status predicate. Read its
-- BODY, not its comment: the comment says "ANY STATUS, deliberately,
-- including 'pending' and 'removed'", which reads like an enumeration of
-- two exceptions and is not one. The body is two SELECTs over
-- public.partnerships with no WHERE clause on status at all. It admits
-- every value the column can hold, which by every write path in the
-- application is 'pending', 'active', 'suspended', 'terminated' and
-- 'removed'.
--
-- 079 also collapsed the three live SELECT policies on public.profiles
-- into ONE, "Users can view profiles of partnership members", whose
-- predicate is:
--
--     id = auth.uid() OR id IN (SELECT current_user_visible_profile_ids())
--
-- and current_user_visible_profile_ids() reaches
-- current_user_counterparty_org_ids() for its counterparty half.
--
-- Row level security is ROW level. There is no column filter anywhere in
-- that chain. So a counterparty reads THE WHOLE profiles ROW, which on
-- this schema carries:
--
--     default_terms        jsonb  (migration 070) - the vendor's standing
--                                 payment terms, kill fee, intellectual
--                                 property position and rate validity
--     business_criteria    jsonb  (migration 060) - insurance limits and
--                                 the certificate-of-insurance document URL
--     default_nda_url      text   (migration 050)
--     email, full_name, company_name, capabilities, credentials, ...
--
-- CONSEQUENCE, LIVE TODAY: an agency whose relationship a vendor ENDED
-- still reads that vendor's standing commercial terms, and a vendor whose
-- relationship an agency ended still reads the agency's. Ending the
-- relationship revokes nothing.
--
-- =====================================================================
-- WHY THIS IS TWO HELPERS AND NOT ONE NARROWED HELPER
-- =====================================================================
--
-- The obvious fix - put a status filter inside
-- current_user_counterparty_org_ids() - is WRONG, and the way it is wrong
-- is worse than the leak. That function gates exactly two things:
--
--   public.organizations   "Members read counterparty organizations"
--                          USING (id IN (SELECT current_user_counterparty_org_ids()))
--   public.profiles        indirectly, through current_user_visible_profile_ids()
--
-- The organizations row is: id, name, primary_contact_user_id,
-- is_lead_agency, is_vendor, created_at, updated_at. A company name, a
-- pointer, and two booleans that no policy reads. It is also the ONLY
-- source of a counterparty's company name anywhere in the product:
--
--   GET /api/partnerships, agency branch, embeds
--     vendor_org:organizations!vendor_org_id(...) for every pool row
--   GET /api/partnerships, vendor branch, batch-loads
--     organizations WHERE id IN (lead_org_id...) for every invitation card
--
-- Narrow that function to active-only and BOTH break for every pending
-- invitation. The agency's own vendor pool stops naming the vendors it
-- just invited, and the vendor's invitation card stops naming the agency
-- that invited them - it falls back through lib/org-contact.ts to an email
-- address, and then to the literal "Unknown Agency". A lockout on a lead
-- agency's own pool is a worse day than the leak, and it lands on every
-- account rather than on the ended relationships only.
--
-- So the split is by SENSITIVITY, not by status alone:
--
--   NAME TIER       current_user_counterparty_org_ids()
--                   any status, UNCHANGED by this migration.
--                   Gates organizations. A company name.
--
--   COMMERCIAL TIER current_user_commercial_counterparty_org_ids()  NEW
--                   excludes the ended statuses.
--                   Gates profiles, through current_user_visible_profile_ids().
--                   default_terms, business_criteria, default_nda_url.
--
-- =====================================================================
-- THE BOUNDARY, AND EVERY STATUS ON EACH SIDE
-- =====================================================================
--
-- The vocabulary is fixed by app/api/partnerships/route.ts, which is the
-- ONLY route that writes this column. Its PATCH accepts exactly
-- ('active','suspended','terminated','removed') and its POST writes
-- 'pending'. Five values.
--
--   ADMITTED to the commercial tier
--     pending    An invitation is in flight. Both sides need each other:
--                the agency is vetting a vendor it has asked to work with,
--                and the vendor is deciding whether to accept. The
--                relationship has not started and has not ended.
--     active     Live. Not in question.
--     suspended  Paused, not ended, and REVERSIBLE - the same PATCH that
--                writes it writes 'active' back. Its historical projects
--                and invoices are still live records. Treating a pause as
--                an ending would revoke terms mid-engagement.
--
--   EXCLUDED from the commercial tier
--     terminated The end state, and it is TWO things on this schema: the
--                agency ending a relationship (agency PATCH), and the
--                vendor DECLINING an invitation it never accepted
--                (app/partner/network/page.tsx handleDecline posts
--                status:'terminated'). Both mean "this is not happening".
--                A vendor who declined an invitation should not have
--                handed over their insurance limits by declining it.
--     removed    The agency dismissed the row from its pool. GET
--                /api/partnerships already filters it out with
--                .neq('status','removed') on both branches, so excluding
--                it here costs the product nothing it currently renders.
--
-- WHICH SURFACES CHANGE. Only ones reading a counterparty PROFILE for a
-- terminated or removed partnership. Company names do not move, because
-- the name tier does not move.
--
--   /agency/pool, a terminated vendor's card
--       KEEPS  company name (organizations.name, name tier)
--       KEEPS  contact email (partnerships.partner_email, denormalized on
--              the row itself - lib/org-contact.ts falls back to it)
--       LOSES  contact full name, capabilities, company_logo_url,
--              contact created_at. These have no organization-level column
--              and come from the contact's own profiles row.
--   /partner/network, a terminated agency's card
--       KEEPS  company name
--       LOSES  contact email, which renders as "Email not available"
--   Every awarded project, assignment, invoice and bid
--       UNCHANGED. None of them reads profiles by a counterparty org id;
--       they read partnerships, project_assignments and
--       partner_rfp_responses, whose policies key on
--       current_user_org_ids() and are untouched here.
--
-- =====================================================================
-- WHY NOT current_user_active_counterparty_user_ids(), WHICH ALREADY EXISTS
-- =====================================================================
--
-- 079 PHASE 6 already created a stricter helper. It was found and read
-- rather than missed. It is NOT the right tool here, for two reasons:
--
--   1. IT IS TOO STRICT. Its predicate is `p.status = 'active'`, so it
--      excludes 'pending' and 'suspended' as well. Substituting it into
--      current_user_visible_profile_ids() would take the contact off every
--      invitation card on both sides and off every paused relationship.
--      That is the lockout described above, arriving through a different
--      door.
--   2. IT HAS A LIVE CALLER AND THAT CALLER IS A WRITE. The notifications
--      INSERT policy "Scoped insert notifications" reads it. Rewriting its
--      body to serve the profiles read would widen the scope of a write
--      path, which is the one thing this project's rules forbid outright.
--
-- So it stays exactly as it is. After this migration there are THREE
-- counterparty helpers and they are a deliberate family, not drift:
--
--   FUNCTION                                        RETURNS   STATUSES
--   current_user_counterparty_org_ids()             org ids   all five
--   current_user_commercial_counterparty_org_ids()  org ids   pending, active, suspended
--   current_user_active_counterparty_user_ids()     user ids  active
--
-- Each has exactly one job and they are ordered strictly by breadth. Any
-- future change should keep that ordering true.
--
-- =====================================================================
-- WHAT THIS MIGRATION DOES NOT CLOSE, STATED RATHER THAN BURIED
-- =====================================================================
--
-- Keeping 'pending' in the commercial tier keeps 079's stated residual
-- open. The live INSERT policy "Agencies can create partnerships"
-- constrains lead_org_id and says NOTHING about vendor_org_id, so a lead
-- agency can insert a pending partnership naming any organization id it
-- can obtain and thereby read that company's whole profile row - terms,
-- insurance, NDA - without the other side ever being asked. That hole is
-- not introduced here and is not narrowed here. Closing it means
-- constraining vendor_org_id on insert, which breaks the flow where an
-- agency adds a known vendor from its pool, and it is Greg's call. It is
-- written up in docs/079-embed-closure-report.md and restated in
-- docs/m1-foundation-report.md.
--
-- This migration also does not change WHICH COLUMNS a permitted reader
-- sees. RLS is row level. A permitted counterparty still reads the whole
-- profiles row. Column-level control would be a view or a policy per
-- column set and it is a larger design than this.
--
-- =====================================================================
-- ORDERING. GET THIS RIGHT.
-- =====================================================================
--
-- 079 taught that a policy change and a code change landing out of order
-- breaks production in the window between them. This one has a real
-- ordering constraint and it is exactly one site.
--
-- app/api/partnerships/route.ts, the vendor decline branch, does this:
--
--     1. UPDATE partnerships SET status = 'terminated'
--     2. resolveOrgNotificationRecipients(lead_org_id, <session client>)
--     3. send "X declined your partnership invitation" to the agency
--
-- Step 2 reads profiles. After this migration the partnership is ALREADY
-- terminated when step 2 runs, so the lead organization is no longer a
-- commercial counterparty, the profiles read returns nothing, recipients
-- is empty, and the decline email is not sent. The route still returns
-- 200. The vendor still sees their invitation cleared. Nothing anywhere
-- reports a failure except one console line - which is precisely the
-- silent-notification failure commit c00ca1a was written to fix.
--
--   THE CODE FIX: resolve the recipient BEFORE the UPDATE. It is a pure
--   reordering, it changes nothing about today's behaviour, and it is
--   therefore safe to ship on its own, before this file is applied.
--
--   SO: SHIP THE CODE FIRST, THEN APPLY THIS. In that order the window
--   between them is safe. In the other order the window is a silently
--   dropped notification.
--
-- Every other consumer degrades safely rather than breaking, because
-- lib/org-contact.ts was built for a null embed: resolveOrgContact() has a
-- documented fallback chain and logOrgContactGap() writes a warning at all
-- thirteen sites. Those warnings will increase in volume for terminated
-- rows. That is the migration working, not the migration failing.
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. RUN THESE THREE FIRST. READ ONLY.
-- =====================================================================
--
-- P1. THE ONE THAT CAN CHANGE THE ANSWER. What values does the column
--     actually hold? partnerships.status may be UNCONSTRAINED TEXT: the
--     original CHECK in scripts/010-closed-ecosystem-schema.sql lists only
--     ('pending','active','suspended','terminated') with NO 'removed', and
--     migration 063 - which would have widened it - is authored and NOT
--     APPLIED. So either 'removed' has never been writable, or the
--     constraint was dropped out of band and anything at all could be in
--     there.
--
--       SELECT status, count(*) FROM public.partnerships
--       GROUP BY status ORDER BY count(*) DESC;
--
--     EXPECTED: only values from the set
--     ('pending','active','suspended','terminated','removed'), plus
--     possibly NULL. IF ANY OTHER VALUE APPEARS, STOP. This file's
--     exclusion list is spelled by value, so an unlisted value would be
--     ADMITTED to the commercial tier by default, which is the safe
--     direction but not necessarily the right one.
--
--       SELECT con.conname, pg_get_constraintdef(con.oid)
--       FROM pg_constraint con
--       JOIN pg_class rel ON rel.oid = con.conrelid
--       WHERE rel.relname = 'partnerships' AND con.contype = 'c';
--
--     EXPECTED: either no row mentioning status (unconstrained), or one
--     whose definition you should read before trusting anything above.
--
-- P2. Confirm the three helpers are what this file thinks they are.
--
--       SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig,
--              pg_get_functiondef(p.oid) AS body
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('current_user_counterparty_org_ids',
--                           'current_user_visible_profile_ids',
--                           'current_user_active_counterparty_user_ids')
--       ORDER BY p.proname;
--
--     EXPECTED: 3 rows. prosecdef = t on all three. provolatile = 's'.
--     proconfig = {"search_path=public, pg_temp"}. And in the body of
--     current_user_counterparty_org_ids there is NO occurrence of the word
--     status. If there is one, somebody has already changed it out of band
--     and this file is stale.
--
-- P3. Confirm nothing else calls current_user_visible_profile_ids. This
--     migration changes what that function returns, so every caller moves.
--
--       SELECT schemaname, tablename, policyname, cmd
--       FROM pg_policies
--       WHERE qual   LIKE '%current_user_visible_profile_ids%'
--          OR with_check LIKE '%current_user_visible_profile_ids%';
--
--     EXPECTED: exactly 1 row - public.profiles,
--     "Users can view profiles of partnership members", cmd = SELECT.
--     MORE THAN ONE ROW MEANS THE BLAST RADIUS IS LARGER THAN THIS FILE
--     DESCRIBES. Stop and re-read before applying.
--
-- =====================================================================


BEGIN;

-- ---------------------------------------------------------------------
-- 1. The new helper: counterparties whose relationship has not ended.
--
-- Written by EXCLUSION, not by inclusion, and that is a deliberate choice
-- with a stated failure direction. partnerships.status is very likely
-- unconstrained text (see P1), so a value nobody has anticipated is
-- possible. An inclusion list would DENY it; an exclusion list ADMITS it.
-- Denying an unknown status would silently blank a counterparty's contact
-- across the product with no error anywhere - the exact silent-empty class
-- this codebase keeps being bitten by. Admitting it preserves today's
-- behaviour for that row and leaves it visible in P1's output, which is
-- where an unknown status should be dealt with. The failure direction for
-- a VISIBILITY set is to show one row too many; for an AUTHORITY set it
-- would be the opposite, and this is not an authority set.
--
-- NULL is admitted for the same reason: `status IS DISTINCT FROM` is used
-- rather than `<>` precisely so a NULL status does not silently drop out.
-- No write path in the application produces a NULL, but nothing in the
-- database prevents one.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_commercial_counterparty_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH my_orgs AS (
    SELECT m.org_id FROM public.org_members m WHERE m.user_id = auth.uid()
  )
  SELECT p.vendor_org_id AS org_id
    FROM public.partnerships p
   WHERE p.lead_org_id IN (SELECT org_id FROM my_orgs)
     AND p.vendor_org_id IS NOT NULL
     AND p.status IS DISTINCT FROM 'terminated'
     AND p.status IS DISTINCT FROM 'removed'
  UNION
  SELECT p.lead_org_id AS org_id
    FROM public.partnerships p
   WHERE p.vendor_org_id IN (SELECT org_id FROM my_orgs)
     AND p.status IS DISTINCT FROM 'terminated'
     AND p.status IS DISTINCT FROM 'removed';
$$;

COMMENT ON FUNCTION public.current_user_commercial_counterparty_org_ids() IS
  'The COMMERCIAL tier of counterparty visibility: organizations on the other side of a '
  'partnership with one of the caller''s organizations whose relationship has not ENDED. '
  'Excludes status ''terminated'' (which on this schema means both "the agency ended it" '
  'and "the vendor declined the invitation") and ''removed'' (the agency dismissed the row '
  'from its pool). Admits pending, active and suspended, and admits any unrecognised or '
  'NULL status, because it is written by exclusion - see migration 085 for why. '
  'This gates public.profiles, which carries default_terms, business_criteria and '
  'default_nda_url. It is NOT the same set as current_user_counterparty_org_ids(), which '
  'is deliberately wider and gates company NAME rendering only. Do not merge them.';

-- Same hardening as every other helper in this schema. EXECUTE is revoked
-- from PUBLIC and granted to authenticated only, so an anon request gets no
-- rows rather than "permission denied for function".
REVOKE EXECUTE ON FUNCTION public.current_user_commercial_counterparty_org_ids() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.current_user_commercial_counterparty_org_ids() TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Narrow the profiles visibility set onto it.
--
-- The own-organization half is UNCHANGED and unconditional: colleagues in
-- your own organization stay readable at every status, because there is no
-- status between you and your own company. That half is what M1 needs and
-- this migration must not touch it.
--
-- Only the counterparty half moves, and it moves strictly INWARD. Every
-- user id this returns after the change was already returned before it.
-- Nothing is added. NOTHING IS WIDENED.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_visible_profile_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.user_id
  FROM public.org_members m
  WHERE m.org_id IN (SELECT public.current_user_org_ids())
     OR m.org_id IN (SELECT public.current_user_commercial_counterparty_org_ids());
$$;

COMMENT ON FUNCTION public.current_user_visible_profile_ids() IS
  'Every profile the caller may read: their own colleagues at any time, plus everybody at '
  'every counterparty organization whose relationship has NOT ended. Migration 085 narrowed '
  'the counterparty half from current_user_counterparty_org_ids() (all statuses) to '
  'current_user_commercial_counterparty_org_ids() (excludes terminated and removed), because '
  'RLS is row level and this function gates the whole profiles row, including default_terms, '
  'business_criteria and default_nda_url. ORGANIZATION visibility and PROFILE visibility are '
  'no longer the same predicate: that was true from 079 until 085 and is deliberately no '
  'longer true. A company NAME survives the end of a relationship; its commercial terms do not.';

-- NOTE ON WHAT IS NOT TOUCHED HERE, so a reader does not go looking:
--   current_user_counterparty_org_ids()            unchanged, by design.
--   current_user_active_counterparty_user_ids()    unchanged, by design.
--   The profiles policy "Users can view profiles of partnership members"
--     is unchanged as TEXT. It calls current_user_visible_profile_ids()
--     and picks the new body up automatically. No DROP POLICY is needed
--     and none is issued, which keeps the blast radius to two functions.
--   The organizations policy "Members read counterparty organizations"
--     is unchanged.

COMMIT;


-- =====================================================================
-- VERIFICATION. RUN AFTER APPLYING. READ ONLY. EXPECTED VALUES STATED.
-- =====================================================================
--
-- V1. All four helpers exist and are hardened identically.
--
--       SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname LIKE 'current\_user\_%'
--       ORDER BY p.proname;
--
--     EXPECTED: 6 rows -
--       current_user_active_counterparty_user_ids
--       current_user_admin_org_ids
--       current_user_commercial_counterparty_org_ids   <- NEW
--       current_user_counterparty_org_ids
--       current_user_org_ids
--       current_user_visible_profile_ids
--     prosecdef = t on all six. provolatile = 's' on all six.
--     proconfig = {"search_path=public, pg_temp"} on all six.
--
-- V2. The new function is not executable by anon.
--
--       SELECT p.proname, p.proacl
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname = 'current_user_commercial_counterparty_org_ids';
--
--     EXPECTED: proacl contains authenticated=X/ and does NOT contain a
--     bare =X/ entry (which is the PUBLIC grant).
--
-- V3. The counterparty helper was NOT narrowed. This is the one that would
--     cause the lockout, so it is verified explicitly rather than assumed.
--
--       SELECT position('status' in pg_get_functiondef(p.oid)) AS mentions_status
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname = 'current_user_counterparty_org_ids';
--
--     EXPECTED: 0. If this is not 0, something narrowed the NAME tier and
--     vendor names are about to disappear from the pool. Roll back.
--
-- V4. The new set is a strict subset of the old one, for the caller who
--     runs it. Run this AS A REAL AUTHENTICATED USER, not as postgres -
--     both functions resolve auth.uid() and return nothing without a JWT.
--     Run it once as gmarkant@gmail.com and once as
--     gmarkant+neworg1@gmail.com.
--
--       SELECT
--         (SELECT count(*) FROM public.current_user_counterparty_org_ids())            AS name_tier,
--         (SELECT count(*) FROM public.current_user_commercial_counterparty_org_ids()) AS commercial_tier,
--         (SELECT count(*) FROM (
--            SELECT public.current_user_commercial_counterparty_org_ids()
--            EXCEPT
--            SELECT public.current_user_counterparty_org_ids()) x)                     AS must_be_zero;
--
--     EXPECTED: must_be_zero = 0, ALWAYS. commercial_tier <= name_tier.
--     The difference between the two is exactly the number of terminated
--     and removed relationships that caller has, which P1's status counts
--     let you check independently.
--
-- V5. The profiles policy still exists and still names the same function.
--     085 does not touch it and this proves it did not.
--
--       SELECT policyname, cmd, roles, qual
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'profiles'
--       ORDER BY policyname;
--
--     EXPECTED: "Users can view profiles of partnership members" is
--     present, cmd = SELECT, roles = {authenticated}, and its qual still
--     reads (id = auth.uid()) OR (id IN ( SELECT
--     current_user_visible_profile_ids() AS ...)). The other profiles
--     policies ("Enable insert for authenticated users only", "Users can
--     update own profile", "Authenticated users can read discoverable
--     profiles") are untouched and must all still be present.
--
-- V6. THE BEHAVIOURAL CHECK, and the only one that proves the leak closed.
--     Needs a terminated partnership. If P1 shows zero terminated rows,
--     create one on PREVIEW by declining an invitation, never on
--     production data.
--
--       -- as the vendor whose relationship was terminated:
--       SELECT id, email, default_terms, business_criteria
--       FROM public.profiles
--       WHERE id = '<a user id at the terminated lead agency>';
--
--     EXPECTED: 0 rows. Before 085 this returned the row.
--
--       -- same session, the company name must still resolve:
--       SELECT id, name FROM public.organizations
--       WHERE id = '<that terminated lead agency org id>';
--
--     EXPECTED: 1 row. If this returns 0 rows the NAME tier was narrowed
--     by mistake and the pool is about to render email addresses instead
--     of company names. Roll back.
