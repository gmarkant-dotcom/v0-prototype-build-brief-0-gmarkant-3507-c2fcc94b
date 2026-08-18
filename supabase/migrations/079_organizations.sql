-- =====================================================================
-- Migration 079: Organizations. Company identity stops being a user id.
--
-- =====================================================================
-- AUTHORED, NOT APPLIED. DO NOT RUN THIS YET.
-- =====================================================================
--
-- APPLYING THIS BEFORE THE CODE RENAME SHIPS WILL BREAK PRODUCTION
-- IMMEDIATELY. This file renames agency_id and partner_id. The moment it
-- commits, every query in the application that names those columns returns
-- 42703 "column does not exist". That is 707 column references across 103
-- source files, measured 2026-08-17 - see docs/079-rename-plan.md. There is
-- no partial failure mode and no grace period: the dashboard, the pool, the
-- RFP wizard and the vendor portal all stop working on the first request
-- after COMMIT.
--
-- The rename and the code change ship together, in the order below, or not
-- at all.
--
-- ---------------------------------------------------------------------
-- CAPTURE A FRESH pg_policies SNAPSHOT IMMEDIATELY BEFORE APPLYING
-- ---------------------------------------------------------------------
-- This file drops 83 policies BY THEIR LIVE NAME, taken from
-- docs/schema-snapshot-2026-08-13.md. Fifteen of those names exist in
-- production and nowhere in this repository, so they cannot be recreated
-- from any file here. If the live policy set has changed since Aug 13, a
-- DROP written from that snapshot silently matches nothing, reports
-- success, and leaves the old policy live beside the new one - which is
-- exactly how payment_milestones ended up with three overlapping partner
-- SELECT policies.
--
-- Before applying, run this and commit the output as
-- docs/schema-snapshot-<today>.md:
--
--   SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
--   FROM pg_policies WHERE schemaname = 'public'
--   ORDER BY tablename, policyname;
--
-- Supabase truncates exports at 100 rows silently. Split it:
--
--   ... AND tablename < 'projects' ORDER BY tablename, policyname;
--   ... AND tablename >= 'projects' ORDER BY tablename, policyname;
--   SELECT count(*) FROM pg_policies WHERE schemaname = 'public';  -- 104 on Aug 13
--
-- Then diff the fresh capture against the Aug 13 snapshot. Any policy that
-- appears, disappears or changes name invalidates a DROP in this file and a
-- restore in 079_organizations_down.sql. Regenerate both before proceeding.
--
-- ---------------------------------------------------------------------
-- THE EXACT ORDER OF OPERATIONS FOR THE RELEASE
-- ---------------------------------------------------------------------
--  1. DONE 2026-08-17. The seven per-account role corrections in
--     docs/m1-prework-report.md Item 1.6 HAVE BEEN APPLIED. All seven now
--     read role='partner', active_role='partner', secondary_role='agency'.
--     They were a PRECONDITION, not housekeeping: this migration derives
--     each organization's capability flags from profiles.role, and before
--     the correction seven of the sixteen live profiles carried
--     role='agency' while their signup metadata said 'partner'. Applying
--     079 in that state would have stamped seven organizations as lead
--     agencies that are vendors. That risk is RESOLVED. Rule A now agrees
--     with the signup metadata for all sixteen accounts. See PHASE 2.
--     Re-measure before applying anyway - the check is one SELECT and the
--     cost of being wrong is wrong data in a new table on day one.
--  2. Capture the fresh pg_policies snapshot, above. Commit it.
--  3. Regenerate 079_organizations_down.sql from that fresh capture.
--  4. Merge and deploy the code rename (docs/079-rename-plan.md), which is
--     NOT yet written and does NOT build against today's database. Deploy
--     it to a preview, not production.
--  5. Put the site in maintenance, or accept a short outage. There is no
--     zero-downtime path: the columns cannot be named both ways at once.
--  6. Run this file. Expect "Success. No rows returned".
--  7. Run the verification block at the foot of this file. Every count
--     must match what it says.
--  8. Promote the renamed code to production.
--  9. Walk the live checklist in docs/079-rename-plan.md.
-- 10. Re-take pg_policies and commit it as the new authoritative snapshot.
-- 11. Update the migrations table in LIGAMENT_CONTEXT.md.
--
-- If step 7 fails, ROLLBACK is still available only if you have not
-- committed. Once committed, recovery is 079_organizations_down.sql
-- regenerated from the step-2 capture.
--
-- ---------------------------------------------------------------------
-- WHAT THIS FILE DOES
-- ---------------------------------------------------------------------
--   1. Creates public.organizations and public.org_members. organizations
--      carries primary_contact_user_id - see the section below.
--   2. Backfills one organization per profile, id = the profile id, primary
--      contact = the founding user, and one
--      owner membership row per profile. Zero UPDATEs to any referencing
--      row: every existing agency_id and partner_id value is already a
--      valid organization id under this model.
--   3. Creates five no-parameter SECURITY DEFINER helpers that resolve the
--      CALLER's identity. Nobody can ask about anybody else.
--   4. Renames 30 columns across 23 tables.
--   5. Repoints every foreign key from profiles/auth.users to organizations.
--   6. Adds NOT NULL and the indexes organization-scoped RLS needs.
--   7. Drops 83 live policies by their snapshot name and creates 81 in
--      their place, plus 6 on the two new tables. Two of the six are the
--      organizations SELECT pair: the caller's OWN organizations, and the
--      COUNTERPARTY organizations the thirteen embeds in lib/org-contact.ts
--      read. Without the second one all thirteen render blank.
--   8. Extends handle_new_user so a new signup gets an organization and an
--      owner membership row alongside its profile.
--
-- What it deliberately does NOT do: create org_invitations (phase two, it
-- ships with the feature); touch profiles.role, profiles.active_role or
-- lib/acting-role.ts, which survive M1 unchanged as the view toggle; touch
-- is_paid, is_admin or demo_access in any direction; touch migration 078.
--
-- ---------------------------------------------------------------------
-- organizations.primary_contact_user_id: WHAT IT IS FOR
-- ---------------------------------------------------------------------
-- THIRTEEN POSTGREST EMBEDS DEPEND ON THIS COLUMN. Without it this migration
-- renames correctly and blanks every vendor name in the product.
--
-- Each of those thirteen asks for a COMPANY name and a PERSON's email and
-- name in one hop, through a foreign key this file repoints at
-- organizations:
--
--   partner:profiles!partnerships_partner_id_fkey(email, full_name, company_name)
--
-- Under the organization model company_name resolves cleanly to
-- organizations.name. "The vendor's email" does not resolve at all, because a
-- company can have several members. That is the actual issue, and it is a
-- product question, not a substitution.
--
-- THE RULING: organizations gains a nullable primary_contact_user_id, a
-- foreign key to profiles, backfilled to the founding user, and the embeds
-- become two hops:
--
--   vendor_org:organizations!vendor_org_id(
--     name,
--     primary_contact:profiles!primary_contact_user_id(email, full_name)
--   )
--
-- Chosen deliberately over denormalizing contact_email and contact_name onto
-- organizations, which would be one hop fewer and two more things that go
-- stale. One source per fact, and the contact is a designated person rather
-- than whoever signed up first.
--
-- THIS IS THE FIRST FIELD OF THE COMPANY PRIMARY CONTACT ARRIVING EARLY. The
-- ruled contact record for phase two is larger than one pointer. This column
-- is the part the embeds cannot ship without, brought forward on its own so
-- the rename does not have to wait for the rest of that design.
--
-- The application side is lib/org-contact.ts, which owns the select fragment
-- and the single fallback rule for a null organization or a null contact.
--
-- ---------------------------------------------------------------------
-- THE ORG-ID-EQUALS-USER-ID COINCIDENCE, AND ITS EXPIRY
-- ---------------------------------------------------------------------
-- For every organization created by the PHASE 2 backfill, organizations.id
-- equals the founding user's auth.users.id. That is what makes the backfill
-- inserts-only. It is a historical property of the 16 profiles that existed
-- on 2026-08-17 and NOTHING MAY RELY ON IT. organizations.id defaults to
-- gen_random_uuid(), so every organization created from PHASE 12 onward has
-- an id that belongs to no user.
--
-- The trap this creates, stated so nobody has to rediscover it: a query
-- shaped `JOIN profiles ON profiles.id = x.org_id` works for every legacy
-- organization and returns nothing for every new one. It fails silently and
-- late. The eleven live email-resolution sites in docs/079-rename-plan.md
-- are exactly this shape, and ten of them fail without logging anything.
--
-- ---------------------------------------------------------------------
-- MEASURED READ-ONLY AGAINST PRODUCTION, 2026-08-17
-- ---------------------------------------------------------------------
--   16 profiles, 16 auth users, perfect parity - no auth user lacks a
--     profile row and no profile lacks an auth user.
--   16 of 16 profiles carry a non-empty company_name. Zero null, zero ''.
--   16 distinct company names, zero collisions - one organization per
--     profile, no merge decision.
--   agency_id exists on 21 tables, 211 non-null rows, ZERO orphans against
--     profiles, ZERO nulls.
--   partner_id exists on 7 tables, 101 non-null rows, ZERO orphans.
--   Only 4 distinct agency_id values and 5 distinct partner_id values are
--     referenced anywhere. Two accounts appear on both sides.
--   partnerships: 27 of 31 rows have partner_id NULL, and every one of
--     those 27 carries a partner_email. That is why vendor_org_id is
--     nullable and partner_email stays the pre-claim identifier.
--   organizations, org_members and org_invitations do not exist yet.
--
-- The full probe output is in docs/079-authoring-report.md.
-- =====================================================================

BEGIN;


-- =====================================================================
-- PHASE 1: the two new tables
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  -- The company's designated primary contact. THE THIRTEEN EMBEDS DEPEND ON
  -- THIS COLUMN. See the note in this file's header.
  --
  -- NULLABLE, deliberately. An organization with no designated contact is a
  -- real and recoverable state; an organization that cannot be created
  -- because nobody has been designated yet is not. The PHASE 12 trigger
  -- would otherwise have to write the profile row and the organization row
  -- in a fixed order for a value it already knows, and any organization
  -- created by a future admin flow before its first member joins would be
  -- rejected outright.
  --
  -- ON DELETE SET NULL, chosen over the two alternatives:
  --   CASCADE would delete the COMPANY when one person's account is deleted,
  --     and with it every project, partnership and bid that references it.
  --     A contact is a pointer at a person, not the company's existence.
  --   RESTRICT would make deleting any user who happens to be a contact fail
  --     at the database, with no product surface that explains why.
  -- SET NULL keeps the company and blanks the contact. The consequence is
  -- stated rather than hidden: DELETING A USER SILENTLY BLANKS THE CONTACT
  -- ACROSS ALL THIRTEEN SURFACES, presenting exactly as the never-set case.
  -- lib/org-contact.ts handles both through one code path for that reason.
  primary_contact_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Capability flags. An organization can be a lead agency, a vendor, or
  -- both. These are DESCRIPTIVE, not authorization: no policy in this file
  -- reads them, precisely so a wrong flag cannot lock anybody out of their
  -- own data. Access is decided by membership, and only by membership.
  is_lead_agency  boolean NOT NULL DEFAULT false,
  is_vendor       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_has_a_capability CHECK (is_lead_agency OR is_vendor)
);

COMMENT ON TABLE public.organizations IS
  'The company. Organizations backfilled by migration 079 carry an id equal to '
  'their founding user''s auth.users.id. That is a historical coincidence of the '
  'sixteen accounts that existed on 2026-08-17 and must never be relied upon: '
  'every organization created after 079 gets gen_random_uuid(). Do not join '
  'profiles on an org id.';

COMMENT ON COLUMN public.organizations.primary_contact_user_id IS
  'The one person whose email and name represent this company to a counterparty. '
  'Nullable: null means nobody is designated, or the designated user was deleted '
  '(ON DELETE SET NULL). Thirteen PostgREST embeds read it as '
  'primary_contact:profiles!primary_contact_user_id(email, full_name) - see '
  'lib/org-contact.ts. It is the first field of the company primary contact ruled '
  'for phase two, arriving early because the embeds cannot wait for it.';

COMMENT ON COLUMN public.organizations.is_lead_agency IS
  'Descriptive capability flag, derived at backfill from profiles.role. Read by '
  'no RLS policy. See migration 079 PHASE 2 for the derivation rule and why it '
  'needs Greg''s ruling.';

CREATE TABLE IF NOT EXISTS public.org_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- profiles rather than auth.users: the roster always joins profiles, and
  -- the parity check on 2026-08-17 found 16 of 16 auth users have one.
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner', 'admin', 'member')),
  invited_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_members_org_user_unique UNIQUE (org_id, user_id)
);

COMMENT ON TABLE public.org_members IS
  'Who belongs to which organization. UNIQUE(org_id, user_id) rather than '
  'UNIQUE(user_id): one person may belong to more than one organization, which '
  'is already true of the dual-role accounts in production.';

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members   ENABLE ROW LEVEL SECURITY;

-- VERIFY after PHASE 1:
--   SELECT count(*) FROM information_schema.tables
--   WHERE table_schema='public' AND table_name IN ('organizations','org_members');
--   -- expect 2


-- =====================================================================
-- PHASE 2: the backfill
--
-- One organization per profile, id = the profile id. One owner membership
-- row per profile. Zero UPDATEs to any of the 312 referencing rows.
--
-- ---------------------------------------------------------------------
-- CAPABILITY DERIVATION: THE RULE USED HERE, AND WHY IT NEEDS A RULING
-- ---------------------------------------------------------------------
-- Migration 078 writes secondary_role as the OPPOSITE of the chosen role
-- for every signup, so deriving the flags from both columns marks almost
-- every organization as both and drains the flag of meaning. Measured
-- read-only against the 16 live profiles on 2026-08-17:
--
--   RULE A  profiles.role only ................ 12 lead, 4 vendor,  0 both
--   RULE B  role OR secondary_role ............  0 lead, 2 vendor, 14 both
--   RULE A' signup metadata role, role fallback   5 lead, 11 vendor, 0 both
--
-- THIS FILE USES RULE A. Reasons, in order: it is the only one of the three
-- that reads a column the product actually maintains; it produces a
-- meaningful split rather than marking 14 of 16 as both; and it matches the
-- exact expression migration 078 uses to decide the role at signup, so the
-- backfill and the trigger cannot disagree.
--
-- THE PROBLEM WITH RULE A IS RESOLVED AS OF 2026-08-17. It read:
-- profiles.role is wrong for seven of the sixteen live accounts, who chose
-- 'partner' on the signup form and carried role='agency' because the
-- pre-078 trigger hardcoded it. That was the entire gap between Rule A and
-- Rule A', and applying 079 in that state would have stamped seven
-- organizations as lead agencies that are vendors.
--
-- THOSE SEVEN ACCOUNTS HAVE BEEN CORRECTED. All seven now read
-- role='partner', active_role='partner', secondary_role='agency'. Rule A
-- and Rule A' therefore agree, and Rule A now derives the right flags for
-- every live account. The distribution measured above is the PRE-correction
-- one and is retained as the record of why Rule A was chosen; re-measure
-- before applying rather than trusting either number.
--
-- NO RULING IS OUTSTANDING. Rule A stands, and the Rule A' variant
-- commented beneath the derivation expressions below is kept only as
-- documentation of the alternative that was considered. Do not switch to
-- it: it reads auth.users.raw_user_meta_data, which the product does not
-- maintain, and it no longer disagrees with Rule A anyway.
-- =====================================================================

INSERT INTO public.organizations (id, name, primary_contact_user_id,
                                  is_lead_agency, is_vendor, created_at)
SELECT
  p.id,
  -- 078 writes COALESCE(raw_user_meta_data->>'company_name', ''), so a new
  -- signup can carry an empty string. All 16 live profiles carry a non-empty
  -- company_name today, so this fallback chain fires zero times in this
  -- backfill - it exists for the rows 078 will create between now and apply.
  COALESCE(
    NULLIF(btrim(p.company_name), ''),
    NULLIF(btrim(p.full_name), ''),
    NULLIF(split_part(COALESCE(p.email, ''), '@', 1), ''),
    'Untitled organization'
  ),
  -- PRIMARY CONTACT BACKFILL: the founding user, and NO LOOKUP IS NEEDED.
  -- Under Option C the organization id IS that user's id - the SELECT list
  -- above already writes p.id as the primary key - so the founder is p.id by
  -- construction, in the same statement that creates the organization. There
  -- is no join, no correlated subquery and no second UPDATE pass. This is the
  -- one place the org-id-equals-user-id coincidence is legitimately used, and
  -- it is used at backfill time only: nothing at run time may rely on it, and
  -- the PHASE 12 trigger writes gen_random_uuid() with an explicit NEW.id
  -- contact instead.
  p.id,
  -- RULE A. Mirrors migration 078's chosen_role expression exactly: anything
  -- that is not exactly 'partner' is a lead agency. Guarantees precisely one
  -- of the two flags is true, so organizations_has_a_capability cannot fire.
  (p.role IS DISTINCT FROM 'partner'),
  (p.role = 'partner'),
  COALESCE(p.created_at, now())
FROM public.profiles p
ON CONFLICT (id) DO NOTHING;

-- RULE A' ALTERNATIVE, if Greg rules for signup metadata over profiles.role.
-- Replace the two flag expressions above with these two and re-run from a
-- clean transaction:
--
--   (COALESCE(u.raw_user_meta_data->>'role', p.role) IS DISTINCT FROM 'partner'),
--   (COALESCE(u.raw_user_meta_data->>'role', p.role) = 'partner'),
--
-- and change the FROM clause to:
--
--   FROM public.profiles p JOIN auth.users u ON u.id = p.id

INSERT INTO public.org_members (org_id, user_id, role)
SELECT p.id, p.id, 'owner'
FROM public.profiles p
ON CONFLICT (org_id, user_id) DO NOTHING;

-- VERIFY after PHASE 2. All three must hold, and the migration must be
-- rolled back if any does not:
--   SELECT (SELECT count(*) FROM public.profiles)      AS profiles,
--          (SELECT count(*) FROM public.organizations) AS orgs,
--          (SELECT count(*) FROM public.org_members)   AS members;
--   -- expect three identical numbers (16 on 2026-08-17)
--
--   SELECT count(*) FROM public.org_members WHERE role <> 'owner';
--   -- expect 0
--
--   SELECT count(*) FROM public.organizations
--   WHERE NOT (is_lead_agency OR is_vendor);
--   -- expect 0
--
--   SELECT count(*) FROM public.organizations
--   WHERE primary_contact_user_id IS NULL;
--   -- expect 0. Every backfilled organization is designated to its founding
--   -- user. A non-zero count here means the thirteen embeds in
--   -- lib/org-contact.ts will render the fallback instead of a contact for
--   -- that many vendors on day one.
--
--   SELECT count(*) FROM public.organizations o
--   WHERE o.primary_contact_user_id IS DISTINCT FROM o.id;
--   -- expect 0 for the backfill specifically, since org id = founder id.
--   -- This assertion is TRUE OF THE BACKFILL ONLY and must NOT be turned
--   -- into a constraint: every organization created from PHASE 12 onward has
--   -- an id that belongs to no user.
--
--   SELECT is_lead_agency, is_vendor, count(*)
--   FROM public.organizations GROUP BY 1,2 ORDER BY 1,2;
--   -- EXPECT (t,f)=5 LEAD, (f,t)=11 VENDOR.
--   --
--   -- CORRECTED 2026-08-17 (second pass). This line previously read
--   -- "(t,f)=12, (f,t)=4", which was the PRE-CORRECTION Rule A
--   -- distribution measured before the seven mis-roled accounts were
--   -- fixed. Those seven now read role='partner', which moves them from
--   -- the lead bucket to the vendor bucket: 12-7=5 and 4+7=11. Rule A and
--   -- Rule A' now agree, and 5/11 is exactly the Rule A' distribution
--   -- recorded in the PHASE 2 header.
--   --
--   -- READ THIS BEFORE TRUSTING EITHER NUMBER. If this query returns
--   -- 12/4, the seven role corrections are NOT present in the database
--   -- you just migrated, and seven vendor organizations have been stamped
--   -- as lead agencies. That is a data-quality fault and not a lockout -
--   -- no policy reads these flags - but fix it before anything reads them.
--   -- The precondition query in the runbook, step 4.1, catches this
--   -- BEFORE the transaction rather than after.


-- =====================================================================
-- PHASE 3: the membership helpers, 1 and 2 of 5
--
-- Every one is SECURITY DEFINER, STABLE, search_path-pinned, and takes NO
-- PARAMETERS: each reads auth.uid() internally, so no caller can ask a
-- question about anybody but themselves. EXECUTE is revoked from PUBLIC and
-- granted only to authenticated.
--
-- WHY FUNCTIONS AND NOT SUBQUERIES. Postgres applies RLS to relations
-- referenced inside a policy expression. A policy on org_members that
-- subqueries org_members recurses until 42P17 aborts the query - at query
-- time, not at CREATE POLICY time, so it passes every migration check and
-- breaks on the first real page load. A SECURITY DEFINER body runs as its
-- owner, for whom RLS is not enforced, so it reads org_members once without
-- re-entering policy evaluation.
--
-- The same rule is why helpers 3, 4 and 5 exist rather than a plain JOIN
-- against org_members inside the profiles, organizations and notifications
-- policies: that join would be filtered by org_members' own self-row-only
-- policy and would silently return nothing for every colleague.
--
-- BECAUSE EXECUTE IS REVOKED FROM PUBLIC, every policy that calls one of
-- these must be granted TO authenticated and not TO public - otherwise an
-- anon request raises "permission denied for function" instead of simply
-- matching no rows. Nine live policies are granted TO public today and are
-- recreated TO authenticated in PHASE 10. They are listed there. This is a
-- narrowing with no behavioural effect: auth.uid() is NULL for anon, so
-- every one of those predicates already matched zero rows.
-- =====================================================================

-- 1. The organizations the caller belongs to. The workhorse.
CREATE OR REPLACE FUNCTION public.current_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.org_id
  FROM public.org_members m
  WHERE m.user_id = auth.uid();
$$;

-- 2. The organizations the caller is an owner or admin of. Guards writes to
--    org_members and to organizations. Without it, "restricted to admins"
--    would have to subquery org_members from a policy on org_members.
CREATE OR REPLACE FUNCTION public.current_user_admin_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.org_id
  FROM public.org_members m
  WHERE m.user_id = auth.uid()
    AND m.role IN ('owner', 'admin');
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_org_ids()       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_admin_org_ids() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.current_user_org_ids()       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.current_user_admin_org_ids() TO authenticated;

-- HELPERS 3, 4 AND 5 ARE CREATED IN PHASE 6, NOT HERE. Their bodies
-- reference partnerships.lead_org_id and partnerships.vendor_org_id, and a
-- SQL-bodied function is parsed at CREATE time, so they cannot exist until
-- after the rename in PHASE 5. Nothing between here and PHASE 6 calls them.

-- VERIFY after PHASE 3 (2 rows here; the same query returns 5 after PHASE 6):
--   SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig, p.proacl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.proname LIKE 'current\_user\_%'
--   ORDER BY p.proname;
--   -- prosecdef=t, provolatile='s',
--   -- proconfig={"search_path=public, pg_temp"},
--   -- proacl contains authenticated=X/ and NOT a bare =X/


-- =====================================================================
-- PHASE 4: drop the 83 affected policies, BY THEIR LIVE NAME
--
-- Every name below is copied from docs/schema-snapshot-2026-08-13.md. None
-- was taken from a migration file. Fifteen of the live names exist nowhere
-- in this repository; those are marked PROD-ONLY.
--
-- Counts, from docs/policy-rewrite-surface.md:
--   bucket (a), keyed directly on agency_id/partner_id = auth.uid() ... 49
--   bucket (b), relationship-scoped through a parent table ........... 34
--                                                            dropped   83
--   bucket (c), user-scoped on user_id/sender_id/uploaded_by ........ 15  UNTOUCHED
--   bucket (d), identity-independent ................................. 3  UNTOUCHED
--   bucket (U), matched on an email address .......................... 3  UNTOUCHED, see the note in PHASE 8
--                                                              total 104
--
-- DROP POLICY without IF EXISTS is deliberate. A name that is not there is
-- a fact about the database this file must not be allowed to paper over: it
-- means the snapshot is stale, and the whole transaction should abort so
-- Greg re-captures rather than half-applies.
-- =====================================================================

-- ---- bucket (a) ------------------------------------------------------
DROP POLICY "Agency manages own library documents"                  ON public.agency_library_documents;
DROP POLICY "Agencies can create invitations"                       ON public.agency_partner_invitations;
DROP POLICY "Agencies can update their invitations"                 ON public.agency_partner_invitations;
DROP POLICY "Agencies can view their sent invitations"              ON public.agency_partner_invitations;
DROP POLICY "Partners can update received invitations"              ON public.agency_partner_invitations;
DROP POLICY "Partners can view their received invitations"          ON public.agency_partner_invitations;
DROP POLICY "Agencies manage own bid comparisons"                   ON public.bid_comparisons;
DROP POLICY "Agencies manage own bid decompositions"                ON public.bid_decompositions;
DROP POLICY "Agencies manage own bid evaluations"                   ON public.bid_evaluations;
DROP POLICY "Agencies manage own scoring criteria"                  ON public.bid_scoring_criteria;
DROP POLICY "Agencies manage own scoring templates"                 ON public.bid_scoring_templates;
DROP POLICY "Agencies manage own client cash flow"                  ON public.client_cash_flow;
DROP POLICY "Agencies manage own clients"                           ON public.clients;
DROP POLICY "Agencies manage own delivery reviews"                  ON public.delivery_reviews;
DROP POLICY "Partners can create requests"                          ON public.invitation_requests;
DROP POLICY "Partners can view own requests"                        ON public.invitation_requests;
DROP POLICY "Agency can manage their MSAs"                          ON public.msa_agreements;
DROP POLICY "Agency full access onboarding packages for own projects" ON public.onboarding_packages;
DROP POLICY "Agencies can update requests to them"                  ON public.partner_access_requests;
DROP POLICY "Agencies can view requests to them"                    ON public.partner_access_requests;
DROP POLICY "Partners can create requests"                          ON public.partner_access_requests;
DROP POLICY "Partners can view their requests"                      ON public.partner_access_requests;
DROP POLICY "Agencies insert partner RFP inbox rows"                ON public.partner_rfp_inbox;
DROP POLICY "Agencies select own partner RFP inbox rows"            ON public.partner_rfp_inbox;
DROP POLICY "Partners select inbox rows by partner_id"              ON public.partner_rfp_inbox;
DROP POLICY "Partners update own inbox rows"                        ON public.partner_rfp_inbox;
DROP POLICY "Agencies read owned response versions"                 ON public.partner_rfp_response_versions;
DROP POLICY "Partners insert own response versions"                 ON public.partner_rfp_response_versions;
DROP POLICY "Partners read own response versions"                   ON public.partner_rfp_response_versions;
DROP POLICY "Agencies select RFP responses they own"                ON public.partner_rfp_responses;
DROP POLICY "Agencies update response status and feedback"          ON public.partner_rfp_responses;
DROP POLICY "Partners insert RFP responses for their inbox"         ON public.partner_rfp_responses;
DROP POLICY "Partners read response status and feedback"            ON public.partner_rfp_responses;
DROP POLICY "Partners select own RFP responses"                     ON public.partner_rfp_responses;
DROP POLICY "Partners update own RFP responses"                     ON public.partner_rfp_responses;
DROP POLICY "Agencies can remove their vouch"                       ON public.partner_vouches;
DROP POLICY "Agencies can vouch"                                    ON public.partner_vouches;
DROP POLICY "Agencies can create partnerships"                      ON public.partnerships;
DROP POLICY "Agencies can update their partnerships"                ON public.partnerships;
DROP POLICY "Agencies can view their partnerships"                  ON public.partnerships;
DROP POLICY "Partners can claim partnership by email"               ON public.partnerships;
DROP POLICY "Partners can update partnership status"                ON public.partnerships;
DROP POLICY "Partners can view their partnerships"                  ON public.partnerships;
DROP POLICY "projects_agency_delete"                                ON public.projects;
DROP POLICY "projects_agency_insert"                                ON public.projects;
DROP POLICY "projects_agency_select"                                ON public.projects;
DROP POLICY "projects_agency_update"                                ON public.projects;
DROP POLICY "Agency can manage their own tokens"                    ON public.rfp_magic_tokens;   -- PROD-ONLY
DROP POLICY "Agencies manage own usage tracking"                    ON public.usage_tracking;

-- ---- bucket (b) ------------------------------------------------------
DROP POLICY "Agencies manage agreements for their project assignments" ON public.assignment_agreements;
DROP POLICY "Partners read and update own assignment agreements"    ON public.assignment_agreements;
DROP POLICY "Partners update agreement signature fields"            ON public.assignment_agreements;
DROP POLICY "Agencies manage own bid evaluation scores"             ON public.bid_evaluation_scores;
DROP POLICY "Agencies manage own delivery review scores"            ON public.delivery_review_scores;
DROP POLICY "Partners view own complete delivery reviews"           ON public.delivery_reviews;
DROP POLICY "Partners can view their MSAs"                          ON public.msa_agreements;      -- PROD-ONLY
DROP POLICY "Scoped insert notifications"                           ON public.notifications;
DROP POLICY "Agencies manage onboarding deployments for own projects" ON public.onboarding_deployments;
DROP POLICY "Partners read onboarding deployments for their assignments" ON public.onboarding_deployments;
DROP POLICY "Agency full access package document rows"              ON public.onboarding_package_documents;
DROP POLICY "Partner reads documents for their packages"            ON public.onboarding_package_documents;
DROP POLICY "Partner reads onboarding packages for their partnership" ON public.onboarding_packages;
DROP POLICY "Partner updates review fields on own packages"         ON public.onboarding_packages;
DROP POLICY "Agencies can resolve status updates"                   ON public.partner_status_updates;
DROP POLICY "Agencies can view status updates for their projects"   ON public.partner_status_updates;
DROP POLICY "Partners can insert their own status updates"          ON public.partner_status_updates;
DROP POLICY "Partners can update their own status updates"          ON public.partner_status_updates;  -- PROD-ONLY
DROP POLICY "Partners can view their own status updates"            ON public.partner_status_updates;
DROP POLICY "Agency can manage payment milestones"                  ON public.payment_milestones;
DROP POLICY "Partners can view their payment milestones"            ON public.payment_milestones;  -- PROD-ONLY
DROP POLICY "Partners read payment milestones for their partnerships" ON public.payment_milestones;
DROP POLICY "Partners read their payment milestones"                ON public.payment_milestones;  -- PROD-ONLY
DROP POLICY "Agencies read profiles of their partners"              ON public.profiles;
DROP POLICY "Partners read lead agency profiles for their partnerships" ON public.profiles;
DROP POLICY "Users can view profiles of partnership members"        ON public.profiles;            -- PROD-ONLY
DROP POLICY "assignments_agency_all"                                ON public.project_assignments;
DROP POLICY "assignments_partner_select"                            ON public.project_assignments;
DROP POLICY "assignments_partner_update"                            ON public.project_assignments;
DROP POLICY "Agencies can view documents for their projects"        ON public.project_documents;
DROP POLICY "Partners can view documents for their assignments"     ON public.project_documents;
DROP POLICY "Agencies can view messages for their projects"         ON public.project_messages;
DROP POLICY "Partners can view messages for their assignments"      ON public.project_messages;
DROP POLICY "projects_partner_select_assigned"                      ON public.projects;

-- VERIFY after PHASE 4:
--   SELECT count(*) FROM pg_policies WHERE schemaname='public';
--   -- expect 104 - 83 = 21 (the 15 in bucket (c), the 3 in (d), the 3 in (U))


-- =====================================================================
-- PHASE 5: rename 30 columns across 23 tables
--
-- ALTER TABLE ... RENAME COLUMN is a catalog-only operation. No table is
-- rewritten, no data is copied, and every index, constraint and policy
-- expression that references the column follows it automatically.
--
-- THE NAMING RULE
--   Tables carrying exactly ONE company column       agency_id  -> org_id
--   Tables carrying TWO                              agency_id  -> lead_org_id
--                                                    partner_id -> vendor_org_id
--
-- "org_id" is impossible on a table that names both sides of a relationship,
-- and the explicit names are what make the compile-time sweep in
-- docs/079-rename-plan.md legible. Measured against the live database on
-- 2026-08-17: agency_id exists on 21 tables and partner_id on 7; six tables
-- carry both.
--
-- The brief named partnerships and partner_vouches as the two-column cases.
-- The live schema has SEVEN. The rule is applied to all seven, which is the
-- only reading under which "org_id is impossible there" stays true. The five
-- additional tables are agency_partner_invitations, partner_access_requests,
-- partner_rfp_inbox, partner_rfp_response_versions and partner_rfp_responses.
-- Flagged in docs/079-authoring-report.md.
--
-- invitation_requests carries partner_id and agency_EMAIL, so it has one
-- company id column and no agency_id. It gets vendor_org_id rather than
-- org_id, because "org_id" on a two-sided table would not say which side.
-- The table holds zero rows and is queried from exactly one component.
-- =====================================================================

-- ---- one company column: agency_id -> org_id (15 tables) -------------
ALTER TABLE public.agency_library_documents      RENAME COLUMN agency_id TO org_id;
ALTER TABLE public.bid_comparisons               RENAME COLUMN agency_id TO org_id;
ALTER TABLE public.bid_decompositions            RENAME COLUMN agency_id TO org_id;
ALTER TABLE public.bid_evaluations               RENAME COLUMN agency_id TO org_id;
ALTER TABLE public.bid_scoring_criteria          RENAME COLUMN agency_id TO org_id;
ALTER TABLE public.bid_scoring_templates         RENAME COLUMN agency_id TO org_id;
ALTER TABLE public.client_cash_flow              RENAME COLUMN agency_id TO org_id;
ALTER TABLE public.clients                       RENAME COLUMN agency_id TO org_id;
ALTER TABLE public.delivery_reviews              RENAME COLUMN agency_id TO org_id;
ALTER TABLE public.msa_agreements                RENAME COLUMN agency_id TO org_id;
ALTER TABLE public.onboarding_deployments        RENAME COLUMN agency_id TO org_id;
ALTER TABLE public.onboarding_packages           RENAME COLUMN agency_id TO org_id;
ALTER TABLE public.projects                      RENAME COLUMN agency_id TO org_id;
ALTER TABLE public.rfp_magic_tokens              RENAME COLUMN agency_id TO org_id;
ALTER TABLE public.usage_tracking                RENAME COLUMN agency_id TO org_id;

-- ---- two company columns (7 tables) ----------------------------------
ALTER TABLE public.agency_partner_invitations    RENAME COLUMN agency_id  TO lead_org_id;
ALTER TABLE public.agency_partner_invitations    RENAME COLUMN partner_id TO vendor_org_id;
ALTER TABLE public.partner_access_requests       RENAME COLUMN agency_id  TO lead_org_id;
ALTER TABLE public.partner_access_requests       RENAME COLUMN partner_id TO vendor_org_id;
ALTER TABLE public.partner_rfp_inbox             RENAME COLUMN agency_id  TO lead_org_id;
ALTER TABLE public.partner_rfp_inbox             RENAME COLUMN partner_id TO vendor_org_id;
ALTER TABLE public.partner_rfp_response_versions RENAME COLUMN agency_id  TO lead_org_id;
ALTER TABLE public.partner_rfp_response_versions RENAME COLUMN partner_id TO vendor_org_id;
ALTER TABLE public.partner_rfp_responses         RENAME COLUMN agency_id  TO lead_org_id;
ALTER TABLE public.partner_rfp_responses         RENAME COLUMN partner_id TO vendor_org_id;
ALTER TABLE public.partnerships                  RENAME COLUMN agency_id  TO lead_org_id;
ALTER TABLE public.partnerships                  RENAME COLUMN partner_id TO vendor_org_id;
ALTER TABLE public.partner_vouches               RENAME COLUMN voucher_agency_id  TO lead_org_id;
ALTER TABLE public.partner_vouches               RENAME COLUMN vouched_partner_id TO vendor_org_id;

-- ---- one company column, vendor side ---------------------------------
ALTER TABLE public.invitation_requests           RENAME COLUMN partner_id TO vendor_org_id;

COMMENT ON COLUMN public.partnerships.vendor_org_id IS
  'NULL until the vendor claims the partnership. 27 of 31 live rows were NULL on '
  '2026-08-17, and every one of them carried a partner_email. partner_email '
  'remains the pre-claim identifier.';

-- VERIFY after PHASE 5:
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE table_schema='public'
--     AND column_name IN ('agency_id','partner_id','voucher_agency_id','vouched_partner_id')
--   ORDER BY 1,2;
--   -- expect ZERO rows
--
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE table_schema='public'
--     AND column_name IN ('org_id','lead_org_id','vendor_org_id')
--   ORDER BY 1,2;
--   -- expect 30 rows


-- =====================================================================
-- PHASE 6: the three helpers that could not be written before the rename
--
-- Their bodies reference partnerships.lead_org_id and
-- partnerships.vendor_org_id, and a SQL-bodied function is parsed at CREATE
-- time, so none could be created before PHASE 5. Nothing between PHASE 3
-- and here calls any of them; the first caller is PHASE 10.
--
-- WHY THERE ARE THREE AND NOT TWO. The counterparty set used to live as a
-- CTE inside current_user_visible_profile_ids(). PHASE 11 now needs the same
-- set to decide which organizations a caller may read, and two copies of a
-- visibility rule are two rules that drift. It is lifted into a function of
-- its own, with the same hardening as every other helper here, and
-- current_user_visible_profile_ids() calls it instead of redefining it. The
-- consequence is the one that matters: ORGANIZATION VISIBILITY AND PROFILE
-- VISIBILITY ARE NOW THE SAME PREDICATE BY CONSTRUCTION, not by two
-- definitions that happen to agree today.
-- =====================================================================

-- 3. The organizations on the other side of a partnership involving one of
--    the caller's organizations, in either direction, AT ANY STATUS.
--
-- WHAT COUNTS AS A COUNTERPARTY, AND WHY ONLY THIS. A partnerships row is
-- the only artifact in this schema that records a two-sided commercial
-- relationship between two companies: the lead agency creates it and the
-- vendor claims it. Every other org-to-org link here is UNILATERAL - a
-- partner_access_request is one company asking, an invitation_request is one
-- company asking, a partner_rfp_inbox row is one company sending. Admitting
-- any of those would let one side manufacture visibility of the other by
-- writing a single row it already controls. Partnerships only.
--
-- ANY STATUS, deliberately, including 'pending' and 'removed'. This mirrors
-- current_user_visible_profile_ids() exactly, which is the whole point of
-- the extraction. A pending partnership is an agency that has invited a
-- vendor and is waiting: the vendor's company name has to render on the card
-- that is waiting. A removed one is a relationship that existed, and its
-- historical projects, bids and invoices still name the company.
-- current_user_active_counterparty_user_ids() below is the STRICTER,
-- active-only set, and it is what the contact-information tier uses.
CREATE OR REPLACE FUNCTION public.current_user_counterparty_org_ids()
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
  UNION
  SELECT p.lead_org_id AS org_id
    FROM public.partnerships p
   WHERE p.vendor_org_id IN (SELECT org_id FROM my_orgs);
$$;

-- 4. Every profile the caller may see: their own colleagues, plus everybody
--    at every counterparty organization.
--
-- The counterparty half is NOT redefined here. It calls helper 3. A nested
-- SECURITY DEFINER call is fine: the outer body runs as the function owner,
-- who owns helper 3 and therefore has EXECUTE on it despite the REVOKE FROM
-- PUBLIC below, and auth.uid() still reads the real caller's JWT claim
-- because SECURITY DEFINER changes the role, not the session GUC.
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
     OR m.org_id IN (SELECT public.current_user_counterparty_org_ids());
$$;

CREATE OR REPLACE FUNCTION public.current_user_active_counterparty_user_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH my_orgs AS (
    SELECT m.org_id FROM public.org_members m WHERE m.user_id = auth.uid()
  ),
  active_counterparties AS (
    SELECT p.vendor_org_id AS org_id
      FROM public.partnerships p
     WHERE p.lead_org_id IN (SELECT org_id FROM my_orgs)
       AND p.vendor_org_id IS NOT NULL
       AND p.status = 'active'
    UNION
    SELECT p.lead_org_id AS org_id
      FROM public.partnerships p
     WHERE p.vendor_org_id IN (SELECT org_id FROM my_orgs)
       AND p.status = 'active'
  )
  SELECT m.user_id
  FROM public.org_members m
  WHERE m.org_id IN (SELECT org_id FROM active_counterparties);
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_counterparty_org_ids()         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_visible_profile_ids()          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_active_counterparty_user_ids() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.current_user_counterparty_org_ids()         TO authenticated;
GRANT  EXECUTE ON FUNCTION public.current_user_visible_profile_ids()          TO authenticated;
GRANT  EXECUTE ON FUNCTION public.current_user_active_counterparty_user_ids() TO authenticated;


-- =====================================================================
-- PHASE 7: repoint every foreign key from profiles/auth.users to
--          organizations
--
-- Runs AFTER the rename so the new constraint names match the new column
-- names. It must happen at all because existing FKs declare agency_id REFERENCES
-- profiles(id). Every organization created after PHASE 12 has an id that
-- belongs to no user, so leaving those FKs in place would make every write
-- by a new organization fail at insert time.
--
-- The constraint names are read from pg_constraint rather than assumed. The
-- repo does not know them - most were created out of band - and a DROP
-- CONSTRAINT against a guessed name aborts the transaction. The existing ON
-- DELETE action is read from confdeltype and re-applied unchanged, so this
-- phase does not silently alter cascade behaviour.
--
-- The seven newest tables (bid_decompositions, bid_comparisons,
-- bid_scoring_criteria, bid_scoring_templates, bid_evaluations,
-- delivery_reviews, clients) declare their identity column with NO foreign
-- key at all. They get one here. Today RLS masks the gap because WITH CHECK
-- forces the value; once the predicate becomes a membership lookup, nothing
-- but an FK stops a bug writing an arbitrary uuid.
-- =====================================================================

DO $repoint$
DECLARE
  t   record;
  con record;
  del_action text;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('agency_library_documents',      'org_id'),
      ('agency_partner_invitations',    'lead_org_id'),
      ('agency_partner_invitations',    'vendor_org_id'),
      ('bid_comparisons',               'org_id'),
      ('bid_decompositions',            'org_id'),
      ('bid_evaluations',               'org_id'),
      ('bid_scoring_criteria',          'org_id'),
      ('bid_scoring_templates',         'org_id'),
      ('client_cash_flow',              'org_id'),
      ('clients',                       'org_id'),
      ('delivery_reviews',              'org_id'),
      ('invitation_requests',           'vendor_org_id'),
      ('msa_agreements',                'org_id'),
      ('onboarding_deployments',        'org_id'),
      ('onboarding_packages',           'org_id'),
      ('partner_access_requests',       'lead_org_id'),
      ('partner_access_requests',       'vendor_org_id'),
      ('partner_rfp_inbox',             'lead_org_id'),
      ('partner_rfp_inbox',             'vendor_org_id'),
      ('partner_rfp_response_versions', 'lead_org_id'),
      ('partner_rfp_response_versions', 'vendor_org_id'),
      ('partner_rfp_responses',         'lead_org_id'),
      ('partner_rfp_responses',         'vendor_org_id'),
      ('partner_vouches',               'lead_org_id'),
      ('partner_vouches',               'vendor_org_id'),
      ('partnerships',                  'lead_org_id'),
      ('partnerships',                  'vendor_org_id'),
      ('projects',                      'org_id'),
      ('rfp_magic_tokens',              'org_id'),
      ('usage_tracking',                'org_id')
    ) AS v(tbl, col)
  LOOP
    -- Drop every existing single-column FK on that column.
    FOR con IN
      SELECT c.conname, c.confdeltype
      FROM pg_constraint c
      JOIN pg_class      r ON r.oid = c.conrelid
      JOIN pg_namespace  n ON n.oid = r.relnamespace
      WHERE n.nspname = 'public'
        AND r.relname = t.tbl
        AND c.contype = 'f'
        AND c.conkey = ARRAY[
              (SELECT a.attnum FROM pg_attribute a
                WHERE a.attrelid = r.oid AND a.attname = t.col AND NOT a.attisdropped)
            ]::smallint[]
    LOOP
      del_action := CASE con.confdeltype
                      WHEN 'c' THEN ' ON DELETE CASCADE'
                      WHEN 'n' THEN ' ON DELETE SET NULL'
                      WHEN 'd' THEN ' ON DELETE SET DEFAULT'
                      WHEN 'r' THEN ' ON DELETE RESTRICT'
                      ELSE ''
                    END;
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t.tbl, con.conname);
      RAISE NOTICE 'dropped FK %.% -> %', t.tbl, t.col, con.conname;
    END LOOP;

    -- No pre-existing FK on this column: choose the action deliberately.
    -- CASCADE on a NOT NULL identity column, SET NULL on a nullable one. This
    -- reads nullability as it stands BEFORE phase 8, which is the conservative
    -- direction: a column phase 8 is about to make NOT NULL gets SET NULL here,
    -- and SET NULL on a NOT NULL column simply makes the delete fail loudly
    -- rather than cascading silently.
    IF del_action IS NULL THEN
      SELECT CASE WHEN a.attnotnull THEN ' ON DELETE CASCADE' ELSE ' ON DELETE SET NULL' END
        INTO del_action
      FROM pg_attribute a
      JOIN pg_class r ON r.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = 'public' AND r.relname = t.tbl AND a.attname = t.col;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.organizations(id)%s',
      t.tbl, t.tbl || '_' || t.col || '_org_fkey', t.col, COALESCE(del_action, '')
    );
    del_action := NULL;
  END LOOP;
END
$repoint$;

-- VERIFY after PHASE 7:
--   SELECT r.relname AS table_name, c.conname, a.attname AS column_name
--   FROM pg_constraint c
--   JOIN pg_class r ON r.oid = c.conrelid
--   JOIN pg_class f ON f.oid = c.confrelid
--   JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum = c.conkey[1]
--   WHERE c.contype='f' AND f.relname='organizations'
--   ORDER BY 1,3;
--   -- expect 30 rows, one per (table, column) pair in the list above


-- =====================================================================
-- PHASE 8: NOT NULL, where the data permits it
--
-- Measured read-only 2026-08-17: every one of the 21 agency_id columns has
-- zero nulls across 211 rows. SET NOT NULL is a no-op on a column that is
-- already declared NOT NULL, so this is safe to run over all of them.
--
-- FOUR TABLES ARE EMPTY (onboarding_deployments, onboarding_packages,
-- agency_partner_invitations, invitation_requests). "Zero nulls" there is an
-- argument from absence, not from evidence. They are included anyway,
-- because the column is the row's owner and a row without one is meaningless.
--
-- EVERY vendor_org_id STAYS NULLABLE, with one exception. Nullability on the
-- vendor side is the pre-claim design, not a data-quality accident:
--   partnerships.vendor_org_id             27 of 31 rows NULL - ghost rows
--   partner_rfp_inbox.vendor_org_id         8 of 88 rows NULL - unclaimed RFPs
--   partner_rfp_responses.vendor_org_id     7 of 17 rows NULL - guest bids
--   agency_partner_invitations.vendor_org_id  empty, but NULL by design
--   invitation_requests.vendor_org_id       empty, no evidence either way
--   partner_access_requests.vendor_org_id   1 row, 0 nulls, but the same
--                                           pre-claim shape - left nullable
--   partner_rfp_response_versions.vendor_org_id  6 rows, 0 nulls, but its
--     parent partner_rfp_responses.vendor_org_id is nullable for guest bids,
--     so a NOT NULL child would reject the first guest version write. Left
--     nullable deliberately.
--
-- THE ONE EXCEPTION: partner_vouches.vendor_org_id. A vouch always names a
-- real vendor, migration 053 declared it NOT NULL, and there is no pre-claim
-- state for a vouch.
-- =====================================================================

ALTER TABLE public.agency_library_documents      ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.bid_comparisons               ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.bid_decompositions            ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.bid_evaluations               ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.bid_scoring_criteria          ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.bid_scoring_templates         ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.client_cash_flow              ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.clients                       ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.delivery_reviews              ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.msa_agreements                ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.onboarding_deployments        ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.onboarding_packages           ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.projects                      ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.rfp_magic_tokens              ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.usage_tracking                ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.agency_partner_invitations    ALTER COLUMN lead_org_id SET NOT NULL;
ALTER TABLE public.partner_access_requests       ALTER COLUMN lead_org_id SET NOT NULL;
ALTER TABLE public.partner_rfp_inbox             ALTER COLUMN lead_org_id SET NOT NULL;
ALTER TABLE public.partner_rfp_response_versions ALTER COLUMN lead_org_id SET NOT NULL;
ALTER TABLE public.partner_rfp_responses         ALTER COLUMN lead_org_id SET NOT NULL;
ALTER TABLE public.partnerships                  ALTER COLUMN lead_org_id SET NOT NULL;
ALTER TABLE public.partner_vouches               ALTER COLUMN lead_org_id SET NOT NULL;
ALTER TABLE public.partner_vouches               ALTER COLUMN vendor_org_id SET NOT NULL;

-- VERIFY after PHASE 8:
--   SELECT table_name, column_name, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema='public' AND column_name IN ('org_id','lead_org_id','vendor_org_id')
--   ORDER BY is_nullable, table_name, column_name;
--   -- expect 23 rows NO and 7 rows YES; the 7 are the vendor_org_id columns
--   -- on agency_partner_invitations, invitation_requests,
--   -- partner_access_requests, partner_rfp_inbox,
--   -- partner_rfp_response_versions, partner_rfp_responses, partnerships


-- =====================================================================
-- PHASE 9: indexes
--
-- Without these, an organization-scoped predicate turns every query into a
-- sequential scan. Some of these indexes already exist under their old name
-- (idx_projects_agency_id from migration 046, for one); a RENAME COLUMN does
-- not rename its indexes, and the old index is still perfectly valid on the
-- renamed column. So this block creates an index only where no index already
-- leads with that column, rather than blindly duplicating.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_org_members_user_org ON public.org_members (user_id, org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org_role ON public.org_members (org_id, role);

DO $idx$
DECLARE
  t record;
  existing int;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('agency_library_documents',      'org_id'),
      ('bid_comparisons',               'org_id'),
      ('bid_decompositions',            'org_id'),
      ('bid_evaluations',               'org_id'),
      ('bid_scoring_criteria',          'org_id'),
      ('bid_scoring_templates',         'org_id'),
      ('client_cash_flow',              'org_id'),
      ('clients',                       'org_id'),
      ('delivery_reviews',              'org_id'),
      ('msa_agreements',                'org_id'),
      ('onboarding_deployments',        'org_id'),
      ('onboarding_packages',           'org_id'),
      ('projects',                      'org_id'),
      ('rfp_magic_tokens',              'org_id'),
      ('usage_tracking',                'org_id'),
      ('agency_partner_invitations',    'lead_org_id'),
      ('agency_partner_invitations',    'vendor_org_id'),
      ('invitation_requests',           'vendor_org_id'),
      ('partner_access_requests',       'lead_org_id'),
      ('partner_access_requests',       'vendor_org_id'),
      ('partner_rfp_inbox',             'lead_org_id'),
      ('partner_rfp_inbox',             'vendor_org_id'),
      ('partner_rfp_response_versions', 'lead_org_id'),
      ('partner_rfp_response_versions', 'vendor_org_id'),
      ('partner_rfp_responses',         'lead_org_id'),
      ('partner_rfp_responses',         'vendor_org_id'),
      ('partner_vouches',               'lead_org_id'),
      ('partner_vouches',               'vendor_org_id'),
      ('partnerships',                  'lead_org_id'),
      ('partnerships',                  'vendor_org_id')
    ) AS v(tbl, col)
  LOOP
    SELECT count(*) INTO existing
    FROM pg_index i
    JOIN pg_class r ON r.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum = i.indkey[0]
    WHERE n.nspname = 'public' AND r.relname = t.tbl AND a.attname = t.col;

    IF existing = 0 THEN
      EXECUTE format('CREATE INDEX %I ON public.%I (%I)',
                     'idx_' || t.tbl || '_' || t.col, t.tbl, t.col);
      RAISE NOTICE 'created index on %.%', t.tbl, t.col;
    ELSE
      RAISE NOTICE 'index already leads with %.%, skipped', t.tbl, t.col;
    END IF;
  END LOOP;
END
$idx$;


-- =====================================================================
-- PHASE 10: the replacement policies
--
-- 81 policies replacing the 83 dropped in PHASE 4, plus 5 on the two new
-- tables. The two missing are the two directional profiles SELECT policies,
-- folded into one - see the note above the profiles block.
--
-- Policy NAMES are unchanged from the live snapshot wherever a policy has a
-- direct replacement. That is deliberate: it keeps the down migration a pure
-- restore, and it means a post-apply pg_policies diff shows changes in
-- predicates only, which is far easier to read than a diff where every row
-- moved. One name is now stale as a result - partner_rfp_inbox / "Partners
-- select inbox rows by partner_id" no longer names a real column. Renaming
-- it is a one-line follow-up and is not worth the asymmetry here.
--
-- NINE POLICIES CHANGE THEIR ROLE LIST FROM public TO authenticated, because
-- EXECUTE on the helpers is revoked from PUBLIC and an anon caller would
-- otherwise get "permission denied for function" instead of an empty result:
--   agency_partner_invitations  Agencies can create invitations
--   agency_partner_invitations  Agencies can update their invitations
--   agency_partner_invitations  Agencies can view their sent invitations
--   agency_partner_invitations  Partners can update received invitations
--   agency_partner_invitations  Partners can view their received invitations
--   partner_vouches             Agencies can remove their vouch
--   partner_vouches             Agencies can vouch
--   partnerships                Partners can claim partnership by email
--   rfp_magic_tokens            Agency can manage their own tokens
-- Every one of those predicates already resolved auth.uid(), which is NULL
-- for anon, so all nine already matched zero anon rows. The narrowing has no
-- behavioural effect.
--
-- BUCKET (U) IS DELIBERATELY UNTOUCHED. The three policies that match an
-- EMAIL ADDRESS against the caller's own profile email survive the rename
-- intact, because none of them names agency_id or partner_id:
--   invitation_requests  Agencies can view requests to their email
--   invitation_requests  Agencies can update requests to their email
--   partner_rfp_inbox    Partners select inbox rows by recipient email
-- They still need a product ruling - an organization does not have one email
-- address, so "whose mailbox counts" is a decision, not a rewrite. They are
-- left exactly as they are rather than guessed at. See
-- docs/policy-rewrite-surface.md and docs/079-authoring-report.md.
-- =====================================================================

-- ---- agency_library_documents ---------------------------------------
CREATE POLICY "Agency manages own library documents"
  ON public.agency_library_documents AS PERMISSIVE FOR ALL TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

-- ---- agency_partner_invitations --------------------------------------
CREATE POLICY "Agencies can create invitations"
  ON public.agency_partner_invitations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Agencies can view their sent invitations"
  ON public.agency_partner_invitations AS PERMISSIVE FOR SELECT TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Agencies can update their invitations"
  ON public.agency_partner_invitations AS PERMISSIVE FOR UPDATE TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Partners can view their received invitations"
  ON public.agency_partner_invitations AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    vendor_org_id IN (SELECT public.current_user_org_ids())
    OR partner_email = (SELECT pr.email FROM public.profiles pr WHERE pr.id = auth.uid())
  );

CREATE POLICY "Partners can update received invitations"
  ON public.agency_partner_invitations AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    vendor_org_id IN (SELECT public.current_user_org_ids())
    OR partner_email = (SELECT pr.email FROM public.profiles pr WHERE pr.id = auth.uid())
  );

-- ---- bid_* -----------------------------------------------------------
CREATE POLICY "Agencies manage own bid comparisons"
  ON public.bid_comparisons AS PERMISSIVE FOR ALL TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Agencies manage own bid decompositions"
  ON public.bid_decompositions AS PERMISSIVE FOR ALL TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Agencies manage own bid evaluations"
  ON public.bid_evaluations AS PERMISSIVE FOR ALL TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Agencies manage own scoring criteria"
  ON public.bid_scoring_criteria AS PERMISSIVE FOR ALL TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Agencies manage own scoring templates"
  ON public.bid_scoring_templates AS PERMISSIVE FOR ALL TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Agencies manage own bid evaluation scores"
  ON public.bid_evaluation_scores AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bid_evaluations e
    WHERE e.id = bid_evaluation_scores.evaluation_id
      AND e.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bid_evaluations e
    WHERE e.id = bid_evaluation_scores.evaluation_id
      AND e.org_id IN (SELECT public.current_user_org_ids())));

-- ---- client_cash_flow, clients ---------------------------------------
CREATE POLICY "Agencies manage own client cash flow"
  ON public.client_cash_flow AS PERMISSIVE FOR ALL TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Agencies manage own clients"
  ON public.clients AS PERMISSIVE FOR ALL TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

-- ---- delivery_reviews, delivery_review_scores ------------------------
CREATE POLICY "Agencies manage own delivery reviews"
  ON public.delivery_reviews AS PERMISSIVE FOR ALL TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Partners view own complete delivery reviews"
  ON public.delivery_reviews AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    status = 'complete'::text
    AND EXISTS (
      SELECT 1 FROM public.partnerships p
      WHERE p.id = delivery_reviews.partnership_id
        AND p.vendor_org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Agencies manage own delivery review scores"
  ON public.delivery_review_scores AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.delivery_reviews r
    WHERE r.id = delivery_review_scores.review_id
      AND r.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.delivery_reviews r
    WHERE r.id = delivery_review_scores.review_id
      AND r.org_id IN (SELECT public.current_user_org_ids())));

-- ---- invitation_requests ---------------------------------------------
-- The two email-keyed policies on this table are bucket (U) and are NOT
-- recreated here because they were never dropped. See the PHASE 10 header.
CREATE POLICY "Partners can create requests"
  ON public.invitation_requests AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (vendor_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Partners can view own requests"
  ON public.invitation_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING (vendor_org_id IN (SELECT public.current_user_org_ids()));

-- ---- msa_agreements ---------------------------------------------------
CREATE POLICY "Agency can manage their MSAs"
  ON public.msa_agreements AS PERMISSIVE FOR ALL TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Partners can view their MSAs"
  ON public.msa_agreements AS PERMISSIVE FOR SELECT TO authenticated
  USING (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));

-- ---- notifications ----------------------------------------------------
-- The status='active' condition of the live predicate is preserved exactly,
-- which is the whole reason current_user_active_counterparty_user_ids()
-- exists as a separate helper from current_user_visible_profile_ids().
CREATE POLICY "Scoped insert notifications"
  ON public.notifications AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR user_id IN (SELECT public.current_user_active_counterparty_user_ids())
  );

-- ---- onboarding_deployments ------------------------------------------
CREATE POLICY "Agencies manage onboarding deployments for own projects"
  ON public.onboarding_deployments AS PERMISSIVE FOR ALL TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partners read onboarding deployments for their assignments"
  ON public.onboarding_deployments AS PERMISSIVE FOR SELECT TO authenticated
  USING (assignment_id IN (
    SELECT pa.id FROM public.project_assignments pa
    JOIN public.partnerships p ON pa.partnership_id = p.id
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));

-- ---- onboarding_packages, onboarding_package_documents ---------------
CREATE POLICY "Agency full access onboarding packages for own projects"
  ON public.onboarding_packages AS PERMISSIVE FOR ALL TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (
    project_id IN (
      SELECT pr.id FROM public.projects pr
      WHERE pr.org_id IN (SELECT public.current_user_org_ids()))
    AND org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Partner reads onboarding packages for their partnership"
  ON public.onboarding_packages AS PERMISSIVE FOR SELECT TO authenticated
  USING (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partner updates review fields on own packages"
  ON public.onboarding_packages AS PERMISSIVE FOR UPDATE TO authenticated
  USING (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Agency full access package document rows"
  ON public.onboarding_package_documents AS PERMISSIVE FOR ALL TO authenticated
  USING (package_id IN (
    SELECT op.id FROM public.onboarding_packages op
    JOIN public.projects p ON p.id = op.project_id
    WHERE p.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (package_id IN (
    SELECT op.id FROM public.onboarding_packages op
    JOIN public.projects p ON p.id = op.project_id
    WHERE p.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partner reads documents for their packages"
  ON public.onboarding_package_documents AS PERMISSIVE FOR SELECT TO authenticated
  USING (package_id IN (
    SELECT op.id FROM public.onboarding_packages op
    WHERE op.partnership_id IN (
      SELECT p.id FROM public.partnerships p
      WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids()))));

-- ---- partner_access_requests -----------------------------------------
CREATE POLICY "Partners can create requests"
  ON public.partner_access_requests AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (vendor_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Partners can view their requests"
  ON public.partner_access_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING (vendor_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Agencies can view requests to them"
  ON public.partner_access_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Agencies can update requests to them"
  ON public.partner_access_requests AS PERMISSIVE FOR UPDATE TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_org_ids()));

-- ---- partner_rfp_inbox ------------------------------------------------
CREATE POLICY "Agencies insert partner RFP inbox rows"
  ON public.partner_rfp_inbox AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Agencies select own partner RFP inbox rows"
  ON public.partner_rfp_inbox AS PERMISSIVE FOR SELECT TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_org_ids()));

-- Name kept verbatim from the snapshot even though it now names a column
-- that no longer exists. See the PHASE 10 header.
CREATE POLICY "Partners select inbox rows by partner_id"
  ON public.partner_rfp_inbox AS PERMISSIVE FOR SELECT TO authenticated
  USING (vendor_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Partners update own inbox rows"
  ON public.partner_rfp_inbox AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    vendor_org_id IN (SELECT public.current_user_org_ids())
    OR (recipient_email IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = auth.uid()
            AND lower(btrim(pr.email)) = lower(btrim(partner_rfp_inbox.recipient_email))))
  );

-- ---- partner_rfp_response_versions ------------------------------------
CREATE POLICY "Agencies read owned response versions"
  ON public.partner_rfp_response_versions AS PERMISSIVE FOR SELECT TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Partners insert own response versions"
  ON public.partner_rfp_response_versions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (vendor_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Partners read own response versions"
  ON public.partner_rfp_response_versions AS PERMISSIVE FOR SELECT TO authenticated
  USING (vendor_org_id IN (SELECT public.current_user_org_ids()));

-- ---- partner_rfp_responses --------------------------------------------
CREATE POLICY "Agencies select RFP responses they own"
  ON public.partner_rfp_responses AS PERMISSIVE FOR SELECT TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Agencies update response status and feedback"
  ON public.partner_rfp_responses AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (lead_org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Partners insert RFP responses for their inbox"
  ON public.partner_rfp_responses AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    vendor_org_id IN (SELECT public.current_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.partner_rfp_inbox i
      WHERE i.id = partner_rfp_responses.inbox_item_id
        AND i.lead_org_id = partner_rfp_responses.lead_org_id
        AND (
          i.vendor_org_id IN (SELECT public.current_user_org_ids())
          OR (i.recipient_email IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.profiles pr
                WHERE pr.id = auth.uid()
                  AND lower(btrim(pr.email)) = lower(btrim(i.recipient_email))))
        ))
  );

CREATE POLICY "Partners read response status and feedback"
  ON public.partner_rfp_responses AS PERMISSIVE FOR SELECT TO authenticated
  USING (vendor_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Partners select own RFP responses"
  ON public.partner_rfp_responses AS PERMISSIVE FOR SELECT TO authenticated
  USING (vendor_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Partners update own RFP responses"
  ON public.partner_rfp_responses AS PERMISSIVE FOR UPDATE TO authenticated
  USING (vendor_org_id IN (SELECT public.current_user_org_ids()));

-- ---- partner_status_updates -------------------------------------------
CREATE POLICY "Agencies can view status updates for their projects"
  ON public.partner_status_updates AS PERMISSIVE FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Agencies can resolve status updates"
  ON public.partner_status_updates AS PERMISSIVE FOR UPDATE TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partners can insert their own status updates"
  ON public.partner_status_updates AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partners can view their own status updates"
  ON public.partner_status_updates AS PERMISSIVE FOR SELECT TO authenticated
  USING (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partners can update their own status updates"
  ON public.partner_status_updates AS PERMISSIVE FOR UPDATE TO authenticated
  USING (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));

-- ---- partner_vouches ---------------------------------------------------
-- Renaming these two columns has a product consequence worth stating: the
-- pre-existing UNIQUE(voucher_agency_id, vouched_partner_id) follows the
-- rename and becomes UNIQUE(lead_org_id, vendor_org_id), so a vouch is now
-- one per ORGANIZATION PAIR rather than one per user pair. That is the fix
-- for colleagues triple-vouching the same vendor, and it arrives free.
CREATE POLICY "Agencies can vouch"
  ON public.partner_vouches AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Agencies can remove their vouch"
  ON public.partner_vouches AS PERMISSIVE FOR DELETE TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_org_ids()));

-- ---- partnerships ------------------------------------------------------
CREATE POLICY "Agencies can create partnerships"
  ON public.partnerships AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Agencies can view their partnerships"
  ON public.partnerships AS PERMISSIVE FOR SELECT TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Agencies can update their partnerships"
  ON public.partnerships AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (lead_org_id IN (SELECT public.current_user_org_ids()))
  -- WITH CHECK added deliberately. The live policy had USING only, which let
  -- an agency rewrite lead_org_id to somebody else's organization. Adding it
  -- here closes that while the predicate is being rewritten anyway.
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Partners can view their partnerships"
  ON public.partnerships AS PERMISSIVE FOR SELECT TO authenticated
  USING (vendor_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "Partners can update partnership status"
  ON public.partnerships AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (vendor_org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (vendor_org_id IN (SELECT public.current_user_org_ids()));

-- The claim path. partner_email stays the pre-claim identifier and the WITH
-- CHECK now writes vendor_org_id, which is what makes an unclaimed ghost row
-- claimable by the vendor's organization rather than by one user.
CREATE POLICY "Partners can claim partnership by email"
  ON public.partnerships AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    vendor_org_id IS NULL
    AND partner_email ILIKE (SELECT pr.email FROM public.profiles pr WHERE pr.id = auth.uid())
  )
  WITH CHECK (vendor_org_id IN (SELECT public.current_user_org_ids()));

-- ---- payment_milestones ------------------------------------------------
-- Three near-identical partner SELECT policies exist live. All three are
-- recreated rather than consolidated: consolidating would be a separate,
-- reviewable change, and doing it inside a migration this large is how a
-- quiet access loss ships. They OR together, so three is harmless.
CREATE POLICY "Agency can manage payment milestones"
  ON public.payment_milestones AS PERMISSIVE FOR ALL TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partners can view their payment milestones"
  ON public.payment_milestones AS PERMISSIVE FOR SELECT TO authenticated
  USING (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partners read payment milestones for their partnerships"
  ON public.payment_milestones AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    partnership_id IS NOT NULL
    AND partnership_id IN (
      SELECT p.id FROM public.partnerships p
      WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partners read their payment milestones"
  ON public.payment_milestones AS PERMISSIVE FOR SELECT TO authenticated
  USING (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));

-- ---- profiles ----------------------------------------------------------
-- THREE POLICIES BECOME ONE. The three live SELECT policies dropped in PHASE
-- 4 were:
--   "Agencies read profiles of their partners"                  lead -> vendor
--   "Partners read lead agency profiles for their partnerships" vendor -> lead
--   "Users can view profiles of partnership members"            own row + both
-- Because permissive policies of the same command OR together, the third was
-- already the union of the other two. They are folded into one, keeping the
-- third's live name.
--
-- The folded predicate is a strict SUPERSET of the union it replaces. Under
-- the old rules a caller could read the profile of the counterparty's
-- FOUNDING USER only, because partnerships.partner_id held that user's id.
-- Now it reads every member of the counterparty organization, which for
-- every backfilled organization is exactly that same one person. It adds one
-- thing: colleagues in the caller's own organization, which is the point of
-- M1.
--
-- The lookup cannot be written as a JOIN against org_members here. Postgres
-- applies RLS to relations referenced inside a policy expression, and
-- org_members carries a self-row-only SELECT policy, so the join would
-- silently return nothing for every colleague. That is what
-- current_user_visible_profile_ids() exists for.
--
-- The two bucket (c) policies on profiles, "Enable insert for authenticated
-- users only" and "Users can update own profile", and the bucket (d) policy
-- "Authenticated users can read discoverable profiles", are untouched and
-- were never dropped.
CREATE POLICY "Users can view profiles of partnership members"
  ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR id IN (SELECT public.current_user_visible_profile_ids())
  );

-- ---- project_assignments -----------------------------------------------
CREATE POLICY "assignments_agency_all"
  ON public.project_assignments AS PERMISSIVE FOR ALL TO authenticated
  USING (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.lead_org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.lead_org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "assignments_partner_select"
  ON public.project_assignments AS PERMISSIVE FOR SELECT TO authenticated
  USING (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "assignments_partner_update"
  ON public.project_assignments AS PERMISSIVE FOR UPDATE TO authenticated
  USING (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));

-- ---- project_documents -------------------------------------------------
-- The three user-scoped policies on this table ("Users can upload
-- documents", "Uploaders can update their documents", "Uploaders can delete
-- their documents") are bucket (c) and are untouched. The unscoped INSERT
-- noted in docs/policy-rewrite-surface.md is a real and separate problem;
-- fixing it here would hide it inside a migration nobody would connect it to.
CREATE POLICY "Agencies can view documents for their projects"
  ON public.project_documents AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_documents.project_id
      AND p.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partners can view documents for their assignments"
  ON public.project_documents AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    (visibility = 'all_partners'::text AND EXISTS (
      SELECT 1 FROM public.project_assignments pa
      JOIN public.partnerships p ON pa.partnership_id = p.id
      WHERE pa.project_id = project_documents.project_id
        AND p.vendor_org_id IN (SELECT public.current_user_org_ids())))
    OR
    (visibility = 'assignment'::text AND EXISTS (
      SELECT 1 FROM public.project_assignments pa
      JOIN public.partnerships p ON pa.partnership_id = p.id
      WHERE pa.id = project_documents.assignment_id
        AND p.vendor_org_id IN (SELECT public.current_user_org_ids())))
  );

-- ---- project_messages --------------------------------------------------
CREATE POLICY "Agencies can view messages for their projects"
  ON public.project_messages AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_messages.project_id
      AND p.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partners can view messages for their assignments"
  ON public.project_messages AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_assignments pa
    JOIN public.partnerships p ON pa.partnership_id = p.id
    WHERE pa.id = project_messages.assignment_id
      AND p.vendor_org_id IN (SELECT public.current_user_org_ids())));

-- ---- projects ----------------------------------------------------------
CREATE POLICY "projects_agency_select"
  ON public.projects AS PERMISSIVE FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "projects_agency_insert"
  ON public.projects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "projects_agency_update"
  ON public.projects AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "projects_agency_delete"
  ON public.projects AS PERMISSIVE FOR DELETE TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "projects_partner_select_assigned"
  ON public.projects AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_assignments pa
    JOIN public.partnerships p ON p.id = pa.partnership_id
    WHERE pa.project_id = projects.id
      AND p.vendor_org_id IN (SELECT public.current_user_org_ids())));

-- ---- rfp_magic_tokens --------------------------------------------------
CREATE POLICY "Agency can manage their own tokens"
  ON public.rfp_magic_tokens AS PERMISSIVE FOR ALL TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

-- ---- usage_tracking ----------------------------------------------------
-- usage_tracking already carries UNIQUE(agency_id, month_start), which
-- follows the rename to UNIQUE(org_id, month_start). One quota row per
-- organization per month is exactly the ruled billing unit, and it needed no
-- schema change beyond this rename.
CREATE POLICY "Agencies manage own usage tracking"
  ON public.usage_tracking AS PERMISSIVE FOR ALL TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

-- ---- assignment_agreements ---------------------------------------------
CREATE POLICY "Agencies manage agreements for their project assignments"
  ON public.assignment_agreements AS PERMISSIVE FOR ALL TO authenticated
  USING (assignment_id IN (
    SELECT pa.id FROM public.project_assignments pa
    JOIN public.projects pr ON pa.project_id = pr.id
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (assignment_id IN (
    SELECT pa.id FROM public.project_assignments pa
    JOIN public.projects pr ON pa.project_id = pr.id
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partners read and update own assignment agreements"
  ON public.assignment_agreements AS PERMISSIVE FOR SELECT TO authenticated
  USING (assignment_id IN (
    SELECT pa.id FROM public.project_assignments pa
    JOIN public.partnerships p ON pa.partnership_id = p.id
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partners update agreement signature fields"
  ON public.assignment_agreements AS PERMISSIVE FOR UPDATE TO authenticated
  USING (assignment_id IN (
    SELECT pa.id FROM public.project_assignments pa
    JOIN public.partnerships p ON pa.partnership_id = p.id
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (assignment_id IN (
    SELECT pa.id FROM public.project_assignments pa
    JOIN public.partnerships p ON pa.partnership_id = p.id
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));


-- =====================================================================
-- PHASE 11: policies on the two new tables
--
-- DENY BY DEFAULT. Absence of a membership row yields no rows, never all
-- rows. There is no INSERT or DELETE policy on organizations and no UPDATE
-- policy on org_members, so those three commands are denied to every client
-- role outright. Organizations are created by the trigger in PHASE 12, which
-- is SECURITY DEFINER. Role changes belong to the membership feature in
-- phase two, which is not in this migration.
--
-- WRITES TO org_members ARE THE ATTACK SURFACE. Without the admin
-- restriction below, any member could insert a row joining themselves to
-- another organization and read all of its data. Both write policies derive
-- the organization from current_user_admin_org_ids() and NEVER from an
-- org_id supplied in the request body. That matters more here than anywhere
-- else in this file, because organization ids and user ids look identical
-- under this model and a client that guesses one is guessing something it
-- can already see.
-- =====================================================================

-- The one self-referential-safe policy on org_members: a member reads their
-- own membership row and nothing else. No subquery against org_members
-- appears in it, so it cannot recurse. Every other table's policy calls a
-- SECURITY DEFINER function instead of reading org_members directly, which
-- is what keeps 42P17 out of production.
CREATE POLICY "Members read their own membership row"
  ON public.org_members AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Org admins add members"
  ON public.org_members AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.current_user_admin_org_ids()));

CREATE POLICY "Org admins remove members"
  ON public.org_members AS PERMISSIVE FOR DELETE TO authenticated
  USING (org_id IN (SELECT public.current_user_admin_org_ids()));

CREATE POLICY "Members read their organizations"
  ON public.organizations AS PERMISSIVE FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_user_org_ids()));

-- THE COUNTERPARTY READ. Without it every one of the thirteen embeds in
-- lib/org-contact.ts returns null: all thirteen read the organization on the
-- OTHER side of a relationship - a lead agency reading its vendor, a vendor
-- reading its lead agency - and not one of them reads an organization the
-- caller belongs to. A to-one embed whose target row is filtered by RLS
-- comes back as null at HTTP 200, not as an error, so the product renders a
-- blank company name and nothing throws.
--
-- WHY IT REUSES current_user_counterparty_org_ids() RATHER THAN SPELLING THE
-- SET OUT AGAIN. That function is the same one behind the profiles policy
-- above. Organization visibility and profile visibility are therefore one
-- predicate, not two that agree today and diverge at the next edit. If this
-- rule ever needs to change, it changes in one place and both tiers move
-- together - which is the only way the outer hop and the nested hop can be
-- kept from disagreeing.
--
-- WHAT IT EXPOSES. The whole organizations row, because RLS is row-level:
-- id, name, primary_contact_user_id, is_lead_agency, is_vendor, created_at,
-- updated_at. There is nothing else on the table. primary_contact_user_id is
-- an id, not contact details: reading the person behind it still has to pass
-- the profiles policies separately, and it does, because that person is a
-- member of a counterparty organization and current_user_visible_profile_ids()
-- returns exactly the members of my_orgs plus the members of this same
-- counterparty set.
--
-- WHAT IT DOES NOT WIDEN. The predicate takes no argument. A caller cannot
-- ask about an organization id it supplies; the set is derived entirely from
-- auth.uid() inside a SECURITY DEFINER body. The only way to add an
-- organization to it is to be on one side of a partnerships row with it.
--
-- THE ONE RESIDUAL, STATED RATHER THAN BURIED. "Agencies can create
-- partnerships" above constrains lead_org_id and says nothing about
-- vendor_org_id, so a lead agency can insert a partnership naming any
-- vendor_org_id it can guess and thereby add that organization to its own
-- counterparty set. That hole is NOT introduced here - it is live today, and
-- it yields strictly MORE on profiles ("Users can view profiles of
-- partnership members", same trick, whole profile row) than it yields here
-- (a company name and two booleans). Closing it means constraining
-- vendor_org_id on insert, which would break the flow where an agency adds a
-- known vendor from its pool. That is Greg's call and it is written up in
-- docs/079-embed-closure-report.md, not decided here.
CREATE POLICY "Members read counterparty organizations"
  ON public.organizations AS PERMISSIVE FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_user_counterparty_org_ids()));

CREATE POLICY "Org admins update their organization"
  ON public.organizations AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (id IN (SELECT public.current_user_admin_org_ids()))
  WITH CHECK (id IN (SELECT public.current_user_admin_org_ids()));


-- =====================================================================
-- PHASE 12: handle_new_user creates the organization
--
-- WITHOUT THIS, EVERY ACCOUNT CREATED AFTER 079 IS LOCKED OUT OF ITS OWN
-- DATA. The membership function returns no rows for a user with no
-- org_members row, deny-by-default takes over, and the new user sees an
-- empty product with no error to explain it.
--
-- EVERYTHING THE CURRENT LIVE FUNCTION DOES IS PRESERVED:
--   SECURITY DEFINER with SET search_path = public, pg_temp
--   reads raw_user_meta_data->>'role', falling back to 'agency'
--   derives secondary_role as the OPPOSITE of the chosen role
--   the ON CONFLICT (id) DO UPDATE clause, with role, active_role and
--     secondary_role deliberately absent from the update list
--   the deliberate absence of is_paid, is_admin and demo_access, and of any
--     email literal
--
-- WHAT IS ADDED: the organization and the owner membership row, guarded by
-- IF NOT EXISTS so a re-fired trigger is idempotent in the same way the
-- profile insert already is.
--
-- THE NEW ORGANIZATION GETS gen_random_uuid(), NOT NEW.id. The
-- org-id-equals-user-id property is historical and ends here.
--
-- SOURCE OF THE BODY BELOW. Migration 078 is applied and verified in
-- production, so supabase/migrations/078_signup_role_trigger.sql is the
-- current live body and is what this extends. This was NOT re-read from
-- pg_proc: PostgREST cannot reach pg_catalog, there is no psql on the
-- authoring machine, no Postgres driver in the project, and POSTGRES_URL is
-- empty. Before applying, run this and diff it against the block below -
-- everything above the "Organization and owner membership" comment must
-- match:
--
--   SELECT pg_get_functiondef(p.oid)
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.proname='handle_new_user';
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  chosen_role text;
  other_role  text;
  org_name    text;
  new_org_id  uuid;
BEGIN
  chosen_role := CASE
    WHEN NEW.raw_user_meta_data->>'role' = 'partner' THEN 'partner'
    ELSE 'agency'
  END;

  other_role := CASE WHEN chosen_role = 'partner' THEN 'agency' ELSE 'partner' END;

  -- is_paid, is_admin and demo_access remain deliberately absent. All three
  -- default to FALSE: a new signup lands unpaid, non-admin, without demo
  -- access, and access is granted from the admin panel per account. No email
  -- address is compared anywhere in this function.
  INSERT INTO public.profiles (
    id, email, full_name, company_name,
    role, active_role, secondary_role
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'company_name', ''),
    chosen_role,
    chosen_role,
    other_role
  )
  ON CONFLICT (id) DO UPDATE SET
    email        = EXCLUDED.email,
    full_name    = COALESCE(EXCLUDED.full_name, profiles.full_name),
    company_name = COALESCE(EXCLUDED.company_name, profiles.company_name);
    -- role/active_role/secondary_role are deliberately absent from the DO
    -- UPDATE list, exactly as in 056 and 078: a re-fired trigger on an
    -- existing profile must never rewrite a role the user has since changed.

  -- ---------------------------------------------------------------
  -- Organization and owner membership. Added by migration 079.
  -- ---------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.user_id = NEW.id) THEN

    -- The profile insert writes COALESCE(..., ''), so company_name can be an
    -- empty string. organizations.name is NOT NULL and an organization named
    -- '' is worse than useless in a member list, so the name falls back
    -- through full_name, then the local part of the email address, then a
    -- literal. All 16 profiles live on 2026-08-17 carry a non-empty
    -- company_name, so this chain is for the future, not the backfill.
    org_name := COALESCE(
      NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'company_name', '')), ''),
      NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      'Untitled organization'
    );

    -- Capability flags by the same rule as the PHASE 2 backfill: anything
    -- that is not exactly 'partner' is a lead agency. Exactly one flag is
    -- true, so organizations_has_a_capability cannot fire.
    -- primary_contact_user_id is set EXPLICITLY to NEW.id, not left to the
    -- backfill's id coincidence: this organization's id is gen_random_uuid()
    -- and belongs to no user. Without this line every account created after
    -- 079 gets an organization with no contact, and all thirteen embeds fall
    -- back for it from its first day. The profile INSERT above has already
    -- committed the profiles row inside this same statement, so the foreign
    -- key to profiles(id) is satisfiable here.
    INSERT INTO public.organizations (name, primary_contact_user_id,
                                      is_lead_agency, is_vendor)
    VALUES (org_name, NEW.id, chosen_role = 'agency', chosen_role = 'partner')
    RETURNING id INTO new_org_id;

    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (new_org_id, NEW.id, 'owner')
    ON CONFLICT (org_id, user_id) DO NOTHING;

  END IF;

  RETURN NEW;
END;
$$;


COMMIT;


-- =====================================================================
-- VERIFICATION. Read-only, safe to re-run, run every one of these.
-- =====================================================================
--
-- 1. Counts match. All three numbers identical.
--   SELECT (SELECT count(*) FROM public.profiles)      AS profiles,
--          (SELECT count(*) FROM public.organizations) AS orgs,
--          (SELECT count(*) FROM public.org_members)   AS members;
--
-- 1b. Every organization has a primary contact.
--   SELECT count(*) FROM public.organizations
--   WHERE primary_contact_user_id IS NULL;
--   -- expect 0. Any other number is that many vendors whose contact renders
--   -- as the lib/org-contact.ts fallback across all thirteen surfaces.
--
-- 2. No old column name survives anywhere.
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE table_schema='public'
--     AND column_name IN ('agency_id','partner_id','voucher_agency_id','vouched_partner_id');
--   -- expect ZERO rows
--
-- 3. Every renamed column resolves to a real organization. Zero orphans.
--   SELECT 'projects' t, count(*) orphans FROM public.projects x
--     WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = x.org_id)
--   UNION ALL SELECT 'partnerships.lead', count(*) FROM public.partnerships x
--     WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = x.lead_org_id)
--   UNION ALL SELECT 'partnerships.vendor', count(*) FROM public.partnerships x
--     WHERE x.vendor_org_id IS NOT NULL
--       AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = x.vendor_org_id)
--   UNION ALL SELECT 'partner_rfp_inbox.lead', count(*) FROM public.partner_rfp_inbox x
--     WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = x.lead_org_id)
--   ORDER BY orphans DESC;
--   -- every row must read 0. Extend to all 30 columns.
--
-- 4. Nothing that must be NOT NULL is null.
--   SELECT table_name, column_name, is_nullable FROM information_schema.columns
--   WHERE table_schema='public' AND column_name IN ('org_id','lead_org_id','vendor_org_id')
--   ORDER BY is_nullable, table_name;
--   -- 23 NO, 7 YES. The 7 YES are all vendor_org_id.
--
-- 5. Policy counts per table, before and after. Write the BEFORE numbers
--    down before applying, from the fresh snapshot.
--   SELECT tablename, count(*) FROM pg_policies WHERE schemaname='public'
--   GROUP BY tablename ORDER BY tablename;
--   -- total must be 104 - 83 + 81 + 6 = 108
--   -- profiles must be 4, down from 6 (three SELECT policies folded to one)
--   -- organizations must be 3, org_members must be 3
--   -- organizations is 3 and not 2 because of the counterparty SELECT policy
--   -- added in PHASE 11. Two SELECT (own, counterparty) and one UPDATE.
--
-- 6. Every table still has RLS on, and none is locked out.
--   SELECT c.relname, c.relrowsecurity, count(p.polname) AS policies
--   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--   LEFT JOIN pg_policy p ON p.polrelid=c.oid
--   WHERE n.nspname='public' AND c.relkind='r'
--   GROUP BY 1,2 ORDER BY c.relrowsecurity ASC, policies ASC;
--   -- relrowsecurity=false is exposed. true with 0 policies is locked out.
--
-- 7. The helpers are shaped correctly and are not executable by anon.
--   SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig, p.proacl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND p.proname LIKE 'current_user_%' ORDER BY 1;
--   -- 5 rows; prosecdef=t; provolatile='s';
--   -- proconfig={"search_path=public, pg_temp"};
--   -- proacl contains authenticated=X/ and does NOT contain a bare =X/
--
-- 8. As a REAL logged-in test user, in the SQL editor's impersonation mode
--    or from the app:
--   SELECT public.current_user_org_ids();
--   -- must return exactly one row for a backfilled account, equal to the
--   -- user's own uid.
--   SELECT count(*) FROM public.projects;
--   -- must equal the count that same user saw BEFORE the migration. Write
--   -- it down first. Any decrease is a lockout, any increase is a leak, and
--   -- both are stop-and-roll-back.
--
-- 8b. THE COUNTERPARTY READ, as that same real logged-in test user. This is
--     the check that decides whether the thirteen embeds render at all.
--   SELECT id, name FROM public.organizations ORDER BY name;
--   -- must return the caller's OWN organizations plus every organization on
--   -- the other side of a partnership with one of them, AND NOTHING ELSE.
--   -- Compare against the expected set:
--   SELECT count(*) FROM public.organizations;                       -- visible
--   SELECT count(*) FROM public.current_user_org_ids();              -- own
--   SELECT count(*) FROM public.current_user_counterparty_org_ids(); -- other side
--   -- visible must equal the size of the UNION of the two, which for a
--   -- backfilled lead agency with N distinct claimed vendors is 1 + N.
--   -- If visible equals the row count of the whole table, the policy is
--   -- wrong and it is a leak. Stop and roll back.
--
-- 8c. The nested hop resolves for the same caller. An outer hop that
--     resolves while the inner one nulls just moves the blank one level
--     down, so check the two-hop shape the product actually issues:
--   SELECT o.id, o.name, o.primary_contact_user_id,
--          (SELECT pr.email FROM public.profiles pr
--            WHERE pr.id = o.primary_contact_user_id) AS contact_email
--   FROM public.organizations o ORDER BY o.name;
--   -- contact_email must be non-null wherever primary_contact_user_id is
--   -- non-null. A null there with a non-null id means the profiles policy
--   -- did not follow the organizations policy, which is the failure the
--   -- shared helper exists to prevent.
--
-- 9. The trigger is still attached. CREATE OR REPLACE FUNCTION does not
--    touch triggers, but confirm rather than assume.
--   SELECT tgname, tgrelid::regclass, tgenabled FROM pg_trigger
--   WHERE NOT tgisinternal AND tgfoid = 'public.handle_new_user'::regproc;
--
-- 10. Create one throwaway signup and confirm it gets an organization.
--   SELECT p.email, p.role, o.name, o.is_lead_agency, o.is_vendor, m.role
--   FROM public.profiles p
--   JOIN public.org_members m ON m.user_id = p.id
--   JOIN public.organizations o ON o.id = m.org_id
--   ORDER BY p.created_at DESC LIMIT 3;
--   -- the newest row must have an organization, membership role 'owner',
--   -- and an id that is NOT equal to the user id.
--
-- 11. STORAGE POLICIES - NOT CHECKED BY THIS FILE, AND NOT CHECKABLE FROM
--     THE REPOSITORY. Supabase storage policies live on storage.objects,
--     outside the schemaname='public' snapshot, and the repository contains
--     no storage policy SQL at all (grepped repo-wide, zero hits). If any
--     storage policy joins a public table on agency_id or partner_id, this
--     migration breaks it silently. Run this BEFORE applying:
--
--   SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies WHERE schemaname = 'storage'
--   ORDER BY tablename, policyname;
--
--     Then read every predicate for the strings agency_id, partner_id,
--     voucher_agency_id and vouched_partner_id. Any hit needs a matching
--     rewrite added to this file before it is applied.
-- =====================================================================
