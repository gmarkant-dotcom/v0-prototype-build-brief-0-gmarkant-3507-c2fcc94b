-- =====================================================================
-- Migration 086: the three schema pieces M1 needs that need no ruling.
--
--   1. profiles.title              a per-user job title. Nullable, decorative.
--   2. org_members roster SELECT   so a colleague list can be read at all.
--   3. public.org_invitations      the table, its shape, and READ policy only.
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- This file is AUTHORED, NOT APPLIED. Nothing in the session that wrote it
-- executed a single statement against any database.
--
-- Sequence, in order, no step skipped:
--
--   1. Run the PRE-FLIGHT CAPTURE below.
--   2. Run this file. Expect "Success. No rows returned".
--   3. RUN VERIFICATION V2 IMMEDIATELY AND BEFORE ANYTHING ELSE. It is the
--      one check that can fail in a way that takes a working feature down,
--      and it fails loudly. See "THE ONE RISK" below.
--   4. Run the rest of the VERIFICATION block. Every query states its
--      expected value. If any disagrees, roll back with
--      086_member_identity_and_invitations_down.sql.
--   5. Only then, update the migrations table in LIGAMENT_CONTEXT.md.
--
-- ORDERING AGAINST THE CODE. This migration is ADDITIVE ONLY - one nullable
-- column, one new permissive policy, one new table. It changes nothing that
-- exists. It is therefore safe to apply BEFORE the Phase 3 code ships, and
-- the code is written to work before it is applied too: every read of
-- profiles.title is guarded for PostgREST 42703 (undefined_column) and the
-- team roster renders one row rather than erroring while the roster policy
-- is absent. Either order is safe. Applying this FIRST is still preferred,
-- because until it lands the roster page shows the caller alone and that
-- looks like a bug rather than a pending migration.
--
-- =====================================================================
-- 1. profiles.title
-- =====================================================================
--
-- WHAT IT IS AND WHAT IT IS NOT. A job title: "Senior Producer", "Head of
-- Production". It is IDENTITY, not AUTHORITY. Nothing reads it to decide
-- whether an action is permitted, and nothing should ever start.
--
-- THIS ENCODES ONE OF GREG'S OPEN RULINGS AND SAYS SO. Call 6 in
-- docs/m1-phase0-discovery.md asks whether a title is decorative or
-- permission-bearing. This file ships the decorative reading, because that
-- is what the brief asked to be built. If the ruling goes the other way,
-- this column is the WRONG shape for it: authority already has a home in
-- org_members.role, per organization, and a title on profiles is per USER
-- and identical across every organization that user belongs to. Two fields
-- that both look like authority is how a permission model becomes
-- ambiguous. Under the other ruling this column should be dropped and the
-- concept moved to org_members, not extended in place.
--
-- Nullable with NO default and NO backfill, deliberately. An empty title is
-- a real state - most people will not fill it in - and inventing one from
-- role or company name would put words in a person's mouth on a field that
-- renders next to their name.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS title text;

COMMENT ON COLUMN public.profiles.title IS
  'The person''s job title, for example "Senior Producer". IDENTITY, NEVER AUTHORITY: no '
  'policy and no route may read this to decide whether an action is permitted. Permission '
  'lives in org_members.role, which is per organization; this is per user and is the same '
  'in every organization they belong to. Nullable, no default, no backfill - an unset '
  'title is a normal state. Added by migration 086.';


-- =====================================================================
-- 2. THE ROSTER READ ON org_members
-- =====================================================================
--
-- THIS IS THE ONE WIDENING IN THIS MIGRATION AND HERE IS THE ARGUMENT.
--
-- 079 PHASE 11 created exactly one SELECT policy on org_members:
--
--     "Members read their own membership row"  USING (user_id = auth.uid())
--
-- So a caller asking "who else is in my organization" gets back exactly one
-- row, their own, at HTTP 200, with no error anywhere. A team roster built
-- on it would render, would show one person, and nothing would say it had
-- been filtered. That is the success-shaped non-event this project keeps
-- being bitten by, and it is why M1 needs a policy and not just a page.
--
-- THE ARGUMENT, in four parts:
--
--   a. IT CANNOT BE ASKED A QUESTION. current_user_org_ids() takes no
--      parameter. Its body is
--        SELECT m.org_id FROM public.org_members m WHERE m.user_id = auth.uid()
--      and it is SECURITY DEFINER, so the set is derived entirely from the
--      caller's JWT. A caller cannot name an organization it does not
--      belong to, because there is nowhere to name one.
--
--   b. IT IS A STRICT SUPERSET, SO NOTHING LOSES ACCESS. Your own
--      membership row always has an org_id in your own organization set, so
--      every row the old policy returned the new one returns too. Permissive
--      policies OR together and the old policy is KEPT, not replaced, so
--      this is additive even if the argument above were wrong.
--
--   c. IT RETURNS EXACTLY THE SAME ROWS AS TODAY. Every organization in
--      production has exactly one member: 079 PHASE 2 inserts one per
--      profile, the PHASE 12 trigger inserts one per signup, and no
--      application code writes org_members at all. So for all 16 legacy
--      accounts AND for New Org 1 this policy is observationally identical
--      to the one beside it. It starts doing work on the day a second
--      member exists, which is the feature.
--
--   d. WHAT IT EXPOSES IS THE WHOLE org_members ROW, because RLS is row
--      level: id, org_id, user_id, role, invited_by, created_at. To your own
--      colleagues, in your own company. There is nothing on that table that
--      is private between colleagues.
--
-- WRITES ARE NOT TOUCHED. "Org admins add members" and "Org admins remove
-- members" both derive their organization from current_user_admin_org_ids()
-- and neither is altered here. A read policy grants no write.
--
-- ---------------------------------------------------------------------
-- THE ONE RISK, STATED RATHER THAN BURIED.
--
-- This puts a call to current_user_org_ids() inside a policy ON THE VERY
-- TABLE that function reads. 079's own comment on the existing policy says
-- it is safe "because no subquery against org_members appears in it, so it
-- cannot recurse", which reads as caution about exactly this case.
--
-- IT IS EXPECTED TO BE FINE, for the standard reason: the function is
-- SECURITY DEFINER, so its body executes as the function owner, and a table
-- owner bypasses RLS on their own table unless FORCE ROW LEVEL SECURITY is
-- set. 079 relies on this everywhere - every one of its 83 rewritten
-- policies calls one of these helpers, and several of those helpers read
-- org_members. What is new here is only that the CALLING policy is on
-- org_members itself.
--
-- I COULD NOT EXECUTE THE CHECK. There are no database credentials in the
-- authoring environment. So it is verified by V2 below, first, before
-- anything else is trusted.
--
-- IF IT IS WRONG THE SYMPTOM IS LOUD AND THE FIX IS ONE LINE. Postgres
-- raises 42P17 "infinite recursion detected in policy for relation
-- org_members" on EVERY read of the table - which means immediately, for
-- everyone, visibly, not silently for one account later. Recovery is
--     DROP POLICY "Members read their organization roster" ON public.org_members;
-- and nothing else in this migration depends on it.

CREATE POLICY "Members read their organization roster"
  ON public.org_members AS PERMISSIVE FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));


-- =====================================================================
-- 3. public.org_invitations
-- =====================================================================
--
-- 079 deliberately did not create this table (079 line 106: "What it
-- deliberately does NOT do: create org_invitations (phase two, it ...)").
-- Confirmed absent: there is no CREATE TABLE for it in any file under
-- supabase/migrations/ or scripts/.
--
-- ---------------------------------------------------------------------
-- IT IS CREATED WITH A READ POLICY AND NO WRITE POLICIES. ON PURPOSE.
--
-- The SHAPE of an invitation is not in dispute: an address, an organization,
-- a token, an expiry, a status, and who sent it. That is the same shape the
-- invitation this codebase already has uses (partner_rfp_inbox.invite_token
-- plus invite_token_expires_at plus claimed_at), and building it now means
-- the next session is a build rather than a discovery.
--
-- WHO MAY WRITE ONE IS IN DISPUTE, and it is Greg's call 2: the capability
-- map currently says org.member_invite is 'admin' and org.member_revoke is
-- 'owner', and nobody has ruled on that pairing. Guessing it here would
-- write an authorization decision into a policy where it is expensive to
-- change and invisible to review.
--
-- So: RLS is enabled, one SELECT policy exists, and there is NO INSERT, NO
-- UPDATE and NO DELETE policy. Postgres denies by default, so this table is
-- READ ONLY to every client role until a later migration adds the write
-- policy the ruling implies. Nothing can put a row in it, including the
-- service role's absence of restraint being irrelevant here because no
-- route uses it against this table.
--
-- THE ACCEPT PATH IS ALSO NOT WRITTEN, and it is worth saying why rather
-- than leaving a gap. An invitee accepting an invitation is BY DEFINITION
-- not yet a member of the organization, so no membership-derived policy can
-- authorize them to read their own invitation or to insert their own
-- org_members row. That path needs either a SECURITY DEFINER function
-- keyed on the token or a service-role route, and which one is chosen
-- depends on calls 1, 2 and 9. Deciding it here would be guessing across
-- the boundary this migration stops at.

CREATE TABLE IF NOT EXISTS public.org_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- The invitee. Stored as text and not as a profiles reference, because the
  -- whole point is that they may not have an account yet. Matched
  -- case-insensitively by the partial index below, because email addresses
  -- are not case sensitive in practice and "Greg@" inviting over "greg@"
  -- would otherwise be two live invitations to one person.
  email       text NOT NULL,
  -- The role they get on accepting. CHECK mirrors org_members.role exactly,
  -- on purpose: if Greg's call 1 collapses the vocabulary, 'admin' simply
  -- stops being written and no constraint has to move.
  role        text NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner', 'admin', 'member')),
  -- Opaque, unguessable, and UNIQUE across the table so a lookup by token
  -- needs no organization context - which is the point, since the person
  -- following the link has no organization context yet.
  token       text NOT NULL UNIQUE,
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  -- NOT NULL with no default. An invitation that never expires is a
  -- credential, and this codebase already learned that from the magic-link
  -- tokens. The sender decides the window; the schema insists there is one.
  expires_at  timestamptz NOT NULL,
  invited_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.org_invitations IS
  'An invitation for one email address to join one organization. Created by migration 086 '
  'with a SELECT policy and DELIBERATELY NO write policies: the SHAPE of an invitation is '
  'settled, but WHO MAY SEND ONE is an open ruling (the capability map says '
  'org.member_invite: admin and org.member_revoke: owner, and nobody has ruled on that '
  'pairing). Postgres denies by default, so this table is read only until a later migration '
  'adds the write policy that ruling implies. The accept path is also unwritten: an invitee '
  'is not yet a member, so no membership-derived policy can authorize them, and that path '
  'needs a SECURITY DEFINER function or a service-role route depending on the same ruling.';

COMMENT ON COLUMN public.org_invitations.email IS
  'The invitee. Text rather than a profiles reference because they may have no account yet. '
  'Uniqueness is enforced case-insensitively and only over pending rows - see '
  'org_invitations_one_live_per_email.';

-- ONE LIVE INVITATION PER ADDRESS PER ORGANIZATION, and only over pending
-- rows. A partial index rather than a plain UNIQUE, because the history
-- matters: an address that was invited, declined, and invited again should
-- keep both rows. Postgres enforces this rather than a check-then-insert in
-- a route, which is the pattern that produced the duplicate partner_rfp_inbox
-- rows documented in LIGAMENT_CONTEXT.md constraint 5 - two callers 11ms
-- apart, both passing the check.
CREATE UNIQUE INDEX IF NOT EXISTS org_invitations_one_live_per_email
  ON public.org_invitations (org_id, lower(email))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS org_invitations_org_status_idx
  ON public.org_invitations (org_id, status);

ALTER TABLE public.org_invitations ENABLE ROW LEVEL SECURITY;

-- The only policy on this table. Owners and admins of an organization read
-- its invitations; nobody else reads anything.
--
-- current_user_admin_org_ids() and NOT current_user_org_ids(): a pending
-- invitation carries an email address that was not necessarily meant to be
-- circulated inside the company, and reading the roster's future is closer
-- to an administrative act than to being a colleague. This is the narrower
-- of the two available sets and it can be widened later if that proves
-- wrong; the reverse is a removal of access somebody has already seen.
--
-- It is NOT scoped by current_user_counterparty_org_ids() or
-- current_user_visible_profile_ids(). Those are VISIBILITY sets and this is
-- an authority question.
CREATE POLICY "Org admins read their invitations"
  ON public.org_invitations AS PERMISSIVE FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.current_user_admin_org_ids()));


-- =====================================================================
-- PRE-FLIGHT CAPTURE. RUN THESE FIRST. READ ONLY.
-- =====================================================================
--
-- F1. Nothing here already exists.
--
--       SELECT
--         (SELECT count(*) FROM information_schema.columns
--           WHERE table_schema='public' AND table_name='profiles'
--             AND column_name='title')                                   AS title_col,
--         (SELECT count(*) FROM information_schema.tables
--           WHERE table_schema='public' AND table_name='org_invitations') AS invitations_table,
--         (SELECT count(*) FROM pg_policies
--           WHERE schemaname='public' AND tablename='org_members')        AS org_member_policies;
--
--     EXPECTED: title_col = 0, invitations_table = 0, org_member_policies = 3
--     (one SELECT, one INSERT, one DELETE, all from 079 PHASE 11). If
--     org_member_policies is not 3, read them before adding a fourth.
--
-- F2. The helper this migration's new policy depends on exists and is
--     hardened.
--
--       SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname='public' AND p.proname='current_user_org_ids';
--
--     EXPECTED: 1 row, prosecdef = t, provolatile = 's',
--     proconfig = {"search_path=public, pg_temp"}.
--
-- F3. Confirm the recursion assumption is not already contradicted: is
--     org_members forced?
--
--       SELECT relname, relrowsecurity, relforcerowsecurity
--       FROM pg_class WHERE relname = 'org_members';
--
--     EXPECTED: relrowsecurity = t, relforcerowsecurity = f. IF
--     relforcerowsecurity IS TRUE, STOP - the owner does NOT bypass RLS
--     inside the SECURITY DEFINER body and section 2 of this migration will
--     recurse. Do not apply section 2.
--
-- =====================================================================
-- VERIFICATION. RUN AFTER APPLYING. EXPECTED VALUES STATED.
-- =====================================================================
--
-- V1. The column exists and is nullable with no default.
--
--       SELECT column_name, data_type, is_nullable, column_default
--       FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='profiles' AND column_name='title';
--
--     EXPECTED: 1 row - text, YES, NULL.
--
-- V2. RUN THIS SECOND, BEFORE ANYTHING ELSE. THE RECURSION CHECK.
--
--       SELECT count(*) FROM public.org_members;
--
--     EXPECTED: a number. As postgres in the SQL editor this bypasses RLS
--     and proves only that the table is readable. THE REAL CHECK IS THE
--     NEXT ONE and it must be run as a real authenticated user, from the
--     application, not from the SQL editor:
--
--       -- signed in as gmarkant@gmail.com, then again as gmarkant+neworg1@gmail.com
--       SELECT id, org_id, user_id, role FROM public.org_members;
--
--     EXPECTED: exactly 1 row for each of them, their own, and NO ERROR.
--     A result of 42P17 "infinite recursion detected in policy for relation
--     org_members" means the SECURITY DEFINER bypass assumption was wrong.
--     Recover immediately with
--       DROP POLICY "Members read their organization roster" ON public.org_members;
--     Everything else in this migration is unaffected and can stay.
--
-- V3. Four policies on org_members, the original three plus the new one.
--
--       SELECT policyname, cmd, qual, with_check
--       FROM pg_policies WHERE schemaname='public' AND tablename='org_members'
--       ORDER BY policyname;
--
--     EXPECTED: 4 rows -
--       "Members read their organization roster"   SELECT
--       "Members read their own membership row"    SELECT   <- STILL PRESENT
--       "Org admins add members"                   INSERT
--       "Org admins remove members"                DELETE
--     If "Members read their own membership row" is missing, something
--     dropped it and this migration did not. Restore it before continuing.
--
-- V4. The invitations table exists, is RLS-enabled, and has exactly ONE
--     policy.
--
--       SELECT relrowsecurity FROM pg_class WHERE relname='org_invitations';
--       -- expect t
--
--       SELECT policyname, cmd FROM pg_policies
--       WHERE schemaname='public' AND tablename='org_invitations';
--       -- expect EXACTLY 1 row: "Org admins read their invitations", SELECT
--
--     MORE THAN ONE ROW MEANS SOMETHING ADDED A WRITE POLICY THIS
--     MIGRATION DID NOT AUTHOR. Read it before trusting the table.
--
-- V5. The table is genuinely unwritable. Run AS A REAL AUTHENTICATED USER
--     (gmarkant@gmail.com), not as postgres.
--
--       INSERT INTO public.org_invitations (org_id, email, token, expires_at)
--       VALUES ('<your own org id>', 'test@example.com', 'tok-test-1', now() + interval '7 days');
--
--     EXPECTED: ERROR "new row violates row-level security policy for table
--     org_invitations". IF THIS INSERT SUCCEEDS, the deny-by-default
--     assumption is wrong and the table must not be relied on. Roll back.
--
-- V6. The partial index is partial.
--
--       SELECT indexname, indexdef FROM pg_indexes
--       WHERE schemaname='public' AND tablename='org_invitations'
--       ORDER BY indexname;
--
--     EXPECTED: 3 rows - the primary key, org_invitations_org_status_idx,
--     and org_invitations_one_live_per_email whose definition ENDS WITH
--     "WHERE (status = 'pending'::text)". Without that clause it would stop
--     an address ever being re-invited after declining.
