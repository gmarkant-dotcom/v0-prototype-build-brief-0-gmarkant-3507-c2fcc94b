-- =====================================================================
-- Migration 089: the colleague-invitation lifecycle. The write half of
--                the table migration 086 shipped read-only on purpose.
--
--   NEW   public.current_user_email()                       -> text
--   NEW   public.accept_org_invitation(text)                -> jsonb
--   NEW   public.decline_org_invitation(text)               -> jsonb
--   ALTER org_invitations_status_check                       (+ 'declined')
--   NEW   policy "Invitees read their own invitation"        SELECT
--   NEW   policy "Org admins create invitations"             INSERT
--   NEW   policy "Org admins manage their invitations"       UPDATE
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- This file is AUTHORED, NOT APPLIED. The session that wrote it executed
-- no statement against any database and holds no credential that could.
-- It is applied by Greg, by hand, in the Supabase SQL Editor.
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE 315
-- and an explicit COMMIT; on LINE 777. Those are the only EXECUTABLE
-- occurrences of either word.
--
-- TO DRY RUN: change the COMMIT; on line 777 to ROLLBACK; and run the
-- whole file. Every statement executes, every error surfaces, nothing
-- persists. Verify the line numbers before trusting them, with:
--
--     grep -n -i '^begin\|^commit\|^rollback' \
--       supabase/migrations/089_org_invitation_lifecycle.sql
--
-- THAT GREP RETURNS FOUR HITS, AND FOUR IS CORRECT:
--     315  BEGIN;    <- executable. The transaction.
--     507  BEGIN     <- plpgsql, accept_org_invitation's body. No
--                       semicolon, matched by the case-insensitive form
--                       only, not a transaction statement.
--     676  BEGIN     <- plpgsql, decline_org_invitation's body. Same.
--     777  COMMIT;   <- executable. The one to swap for ROLLBACK;.
-- Exactly one line ends in `BEGIN;` and exactly one in `COMMIT;`. If
-- your grep shows a different set, this is not the file that was read.
--
-- Do NOT verify with grep -n '^BEGIN;$'. That anchored form has produced
-- false negatives in this repository and 087 nearly burned a dry run on
-- exactly that.
--
-- "Success. No rows returned" IN THE SQL EDITOR PROVES NOTHING ON ITS
-- OWN. It is the identical message for a dry run that rolled everything
-- back, for a real apply that committed, and for a correct file pasted
-- into the wrong project's tab. The VERIFICATION block at the foot is
-- the only thing that distinguishes them. Run it.
--
-- Sequence, no step skipped:
--   1. Run PRE-FLIGHT CAPTURE below. Two of its queries can stop this
--      migration outright.
--   2. Read ORDERING AGAINST THE CODE below. The code and this file must
--      land in a specific order and the wrong order is a visible break.
--   3. Dry run: COMMIT -> ROLLBACK, run, confirm no errors, put it back.
--   4. Run for real.
--   5. Run VERIFICATION. Every query states its expected value.
--   6. Only then update the migrations table in LIGAMENT_CONTEXT.md.
--
-- =====================================================================
-- WHY THE INVITEE'S SIDE IS A FUNCTION AND THE ADMIN'S SIDE IS A POLICY
-- =====================================================================
--
-- This asymmetry is the whole design, and it is not a preference. It
-- falls out of two facts about what each party is authorised to author.
--
-- THE ADMIN CAN BE GIVEN A POLICY, because an admin has full authoring
-- authority over their own organization's invitations already. They
-- chose the address, they chose the role, they could have created the
-- row in any shape they liked. There is therefore nothing for a WITH
-- CHECK to pin beyond the one thing that matters - that the row belongs
-- to an organization they administer. An UPDATE policy scoped the same
-- way lets them revoke, and lets them stamp a lapsed row 'expired',
-- without any further constraint being meaningful.
--
-- THE INVITEE CANNOT, for two independent reasons, either of which alone
-- would settle it.
--
--   REASON ONE: the invitee has NO authoring authority over that row at
--   all. Accepting must change status, accepted_by and accepted_at and
--   MUST NOT change org_id, email, role, token, expires_at or
--   invited_by. A WITH CHECK is a predicate over the NEW row. It cannot
--   say "and every other column is unchanged" - only a trigger or a
--   function body can. Pinning nine columns through a policy means
--   writing a BEFORE UPDATE trigger that reproduces the function body
--   anyway, with the row-shape checks spread across two objects instead
--   of one.
--
--   REASON TWO, and this one is fatal on its own: ACCEPT IS TWO WRITES
--   INTO TWO TABLES. The second lands in public.org_members, whose only
--   INSERT authority is "Org admins add members", org_id IN (SELECT
--   current_user_admin_org_ids()). An invitee is BY DEFINITION not yet a
--   member of that organization, so that set does not contain the org
--   they were invited to. There is no row shape that makes an invitee an
--   admin of the organization they are joining. No policy can express
--   this. A SECURITY DEFINER function is the only mechanism in Postgres
--   that can.
--
-- WHY NOT A SERVICE-ROLE ROUTE, which was the other candidate and was
-- rejected: two PostgREST calls are two HTTP requests with no
-- transaction between them. A failure in the gap either leaves a user
-- half-joined - an org_members row with the invitation still 'pending',
-- or an 'accepted' invitation with no membership - or, worse, wedges
-- that email address in org_invitations_one_live_per_email permanently,
-- because the partial unique index admits exactly one pending row per
-- (org_id, lower(email)) and nothing would ever clear it. A function
-- body is ONE transaction. Both writes land or neither does.
--
-- It is also why HARD PROHIBITION 3 of this session's brief forbids the
-- service-role client anywhere in the accept or decline path.
--
-- =====================================================================
-- NEITHER FUNCTION STAMPS 'expired'. READ THIS BEFORE BELIEVING THE
-- STATUS COLUMN.
-- =====================================================================
--
-- A lapsed invitation is REFUSED by both functions, with LG004, and its
-- status column is LEFT AT 'pending'. Nothing in either function body
-- advances it, and that is a decision rather than an omission.
--
-- WHY THERE IS NO STAMP. An earlier draft wrote UPDATE ... SET status =
-- 'expired' immediately before the RAISE in each function. It could
-- never have persisted: PostgREST wraps every RPC call in ONE
-- transaction and an exception aborts it, so both UPDATEs would have
-- been rolled back with the RAISE every single time. There is no way to
-- both raise and persist inside one Postgres transaction, and no way to
-- commit from inside a function PostgREST is calling.
--
-- Both statements were DELETED rather than kept-and-annotated. A
-- statement that reads as working and provably never runs to completion
-- is worse than no statement: it is the same class as the 42P01 branch
-- in lib/milestone-events.ts, which was dead for its entire working life
-- while looking like a live guard, and which cost a real investigation
-- to find. A comment saying "this does not persist" does not fix that -
-- the next person greps for the UPDATE, finds it, and believes it.
--
-- THE RAISE STAYS. Making refusals return a status code instead would
-- let a stamp persist, and that trade runs the wrong way: a raise fails
-- LOUDLY at the caller, a returned code fails silently the first time a
-- caller forgets to check it.
--
-- THE ONLY DURABLE EXPIRY WRITER IN THIS PRODUCT is the create route,
-- app/api/org/invitations/route.ts. Before inserting, it stamps any
-- lapsed pending row for that (org_id, lower(email)) to 'expired'
-- through the UPDATE policy below. It commits because nothing raises
-- after it. It is also the only moment a stale pending row is ever FELT:
-- such a row costs nobody anything until it blocks a re-invite through
-- org_invitations_one_live_per_email.
--
-- SO WHAT AN ADMIN SEES. A lapsed invitation reads 'pending' in the
-- database until somebody re-invites that address. The team page does
-- NOT repeat the omission: it reads expires_at and renders "Lapsed"
-- rather than trusting the status column.
--
-- =====================================================================
-- WHAT THE FUNCTIONS DELIBERATELY DO NOT DO
-- =====================================================================
--
-- THEY DO NOT TOUCH profiles.active_org_id. This migration creates the
-- first true multi-membership in this product's life: before it, every
-- organization has exactly one member and no account has ever belonged
-- to two. Silently repointing somebody's acting organization because
-- they accepted an invitation is precisely the misattribution
-- resolveActingOrgId() exists to prevent - it would mean the next thing
-- they create is filed under the new company without them choosing it.
-- Switching organizations is a separate, explicit act. Both function
-- bodies repeat this in a comment at the point where the temptation is.
--
-- THEY DO NOT VALIDATE role. It is copied VERBATIM from the invitation
-- row into org_members. Both tables carry the identical
-- CHECK (role IN ('owner','admin','member')), so there is nothing to
-- validate: a value that reached org_invitations already passed it, and
-- a value that did not cannot be there. Any narrower list written here
-- would be a guess at Greg's call 1 - which roles exist - and that call
-- has not been made.
--
-- THEY DO NOT DISTINGUISH "no such token" FROM "not your invitation".
-- Both raise LG001 with the same message. The difference between those
-- two answers confirms whether a given address was invited to a given
-- organization, which is the same disclosure class 087's
-- org_has_member_with_email header spends four paragraphs bounding. One
-- error, one message, one SQLSTATE.
--
-- =====================================================================
-- SQLSTATES THESE FUNCTIONS RAISE
-- =====================================================================
--
-- Class LG is user-defined (Postgres reserves classes beginning 0-4 and
-- A-H; I-Z and 5-9 are ours). PostgREST surfaces the code verbatim in
-- the JSON error body as `code`, which is what the routes map on.
--
--   LG001  no such invitation, OR it is not addressed to you.
--          DELIBERATELY MERGED. See above. Routes map -> HTTP 404.
--   LG002  not signed in. auth.uid() is NULL. Routes map -> HTTP 401.
--   LG003  this invitation is no longer pending. Already accepted,
--          revoked or declined. Routes map -> HTTP 409.
--   LG004  this invitation has expired. Routes map -> HTTP 410.
--
-- LG003 and LG004 are safe to distinguish from each other because
-- reaching either one already required holding the token AND matching
-- the address. Nothing is disclosed that the holder did not have.
--
-- =====================================================================
-- ORDERING AGAINST THE CODE. READ THIS.
-- =====================================================================
--
-- APPLY THIS FILE FIRST. THEN PUSH THE CODE.
--
-- The Phase 2 code on branch feat/m1-invitations calls
-- accept_org_invitation() and decline_org_invitation() by name over
-- .rpc(), and inserts into org_invitations relying on the INSERT policy
-- below. None of that exists in the database until this file is applied.
--
-- There is NO fallback path in the code, and that is deliberate: the 082
-- fallback blocks are this repository's own worked example of a fallback
-- that fires silently and returns a wrong answer instead of an error.
--
-- IF THE CODE SHIPS FIRST, here is exactly what a user sees:
--   - The team page's invite form returns 42501, "new row violates
--     row-level security policy for table org_invitations", HTTP 403.
--     Copy shown: an explicit failure, not a success.
--   - Accept and decline return PostgREST PGRST202, "Could not find the
--     function public.accept_org_invitation(p_token) in the schema
--     cache", HTTP 404.
--   - Nothing is half-written. Nothing needs repairing afterwards.
--     Applying this file makes all of it start working, with no data fix.
-- It fails loudly and it fails clean. It is still the wrong order.
--
-- IF THIS FILE IS APPLIED AND THE CODE IS NOT PUSHED: nothing changes
-- for anybody. Three functions no caller calls, three policies no writer
-- exercises, and one CHECK constraint that admits a value nothing
-- writes. This direction is completely safe, which is why it is the one
-- to take.
--
-- =====================================================================
-- EXPECTED POLICY COUNT
-- =====================================================================
--
-- BEFORE:  114 policies in schema public. org_invitations has exactly 1
--          ("Org admins read their invitations", from 086).
-- AFTER:   117 policies in schema public. org_invitations has 4.
--
-- PREDICTED NUMBER, STATED SO IT CAN BE COMPARED RATHER THAN GUESSED:
-- 117. This file adds three policies and drops none. If the post-apply
-- count is anything other than 117, something else moved between the
-- 114 measurement and this apply - find out what before proceeding.
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. RUN FIRST. READ ONLY. TWO OF THESE CAN STOP THIS.
-- =====================================================================
--
-- P1. STOPPER. The status CHECK must be the one this file drops by name.
--
--       SELECT conname, pg_get_constraintdef(oid)
--       FROM pg_constraint
--       WHERE conrelid = 'public.org_invitations'::regclass
--         AND contype = 'c';
--
--     EXPECTED: two check constraints, one named
--     org_invitations_status_check reading
--     CHECK ((status = ANY (ARRAY['pending','accepted','revoked','expired']))),
--     and one named org_invitations_role_check. If the status one is
--     absent or differently named, THE DROP IN SECTION 2 FAILS and this
--     migration stops. Correct the name in section 2 first.
--
-- P2. STOPPER. The table must still be empty. This file's CHECK swap
--     validates against nothing, which is the only reason it is safe.
--
--       SELECT count(*) AS invitations, count(*) FILTER (WHERE status
--         NOT IN ('pending','accepted','revoked','expired','declined'))
--         AS illegal
--       FROM public.org_invitations;
--
--     EXPECTED: 0, 0. If invitations > 0 the swap still succeeds as long
--     as illegal = 0, because the new list is a strict superset of the
--     old. If illegal > 0 something wrote a value no constraint allowed
--     and this file is not the problem to solve first.
--
-- P3. The three function names must be free.
--
--       SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('current_user_email',
--                           'accept_org_invitation',
--                           'decline_org_invitation');
--
--     EXPECTED: 0 rows. A row here means a previous partial apply. The
--     CREATE OR REPLACE statements below will overwrite it, which is
--     fine, but know that before you run them.
--
-- P4. The baseline policy count, taken immediately before applying.
--
--       SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--
--     EXPECTED: 114. Write the actual number down. VERIFICATION V5
--     compares against it, not against this comment.
--
-- P5. The six current_user_* helpers, hashed, so V6 can prove this file
--     did not touch any of them.
--
--       SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS body_hash
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname LIKE 'current\_user\_%'
--       ORDER BY p.proname;
--
--     EXPECTED: 6 rows. After applying it is 7 - current_user_email is
--     new and matches that LIKE pattern. The other six hashes must be
--     byte-identical.
-- =====================================================================


BEGIN;

-- ---------------------------------------------------------------------
-- 1. public.current_user_email()
--
-- The caller's own email address, from profiles, derived entirely from
-- auth.uid().
--
-- IT TAKES NO ARGUMENTS, AND THAT IS THE SECURITY PROPERTY. 087's
-- org_has_member_with_email(uuid, text) had to spend its whole header
-- bounding what it discloses, because it accepts both of its inputs from
-- the caller and is therefore a confirm-oracle: hold an org id and guess
-- an address, and it tells you whether they pair. This function cannot
-- be that. There is nothing to pass it. It answers exactly one question,
-- "what is MY email", to exactly the person who already knows.
--
-- SECURITY DEFINER because it must work for a caller who is not yet a
-- member of the organization whose invitation they are reading, and
-- because the SELECT policy below calls it - a policy expression
-- evaluates with the querying role's privileges, so it must be callable
-- by `authenticated` directly, and it is.
--
-- It reads public.profiles, which is itself under RLS. Definer rights
-- bypass that, which matters: the caller's own profiles row is readable
-- by them today, but tying this function's correctness to the current
-- shape of the profiles SELECT policy would make an invitation stop
-- rendering the next time that policy is narrowed.
--
-- STABLE, not IMMUTABLE: it reads a table.
--
-- Returns NULL when there is no session, or when the profiles row is
-- missing, or when its email is NULL. Every caller below treats NULL as
-- "no match" rather than as a wildcard. Zero profiles have a null email
-- today; the NULL handling is there so that stops being load-bearing.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.email
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

COMMENT ON FUNCTION public.current_user_email() IS
  'The calling user''s own email address, read from public.profiles by auth.uid(). Takes no '
  'arguments BY DESIGN: it derives everything from the session, so unlike '
  'org_has_member_with_email(uuid, text) it is not a confirm-oracle and cannot be used to '
  'test a guess. Returns NULL with no session or no profiles row; every caller treats NULL '
  'as no-match, never as a wildcard. Compare with lower(btrim(x)) on BOTH sides, which is '
  'migration 087''s convention and is false if either side is NULL. Added by migration 089 '
  'so an invitee - who is not yet a member of the organization inviting them, and therefore '
  'matches no membership-derived policy - can read the one invitation addressed to them.';


-- ---------------------------------------------------------------------
-- 2. The status CHECK gains 'declined'.
--
-- 086 created the constraint with pending/accepted/revoked/expired. A
-- declined invitation is not a revoked one: revoked is the ADMIN
-- withdrawing an offer, declined is the INVITEE refusing it. Collapsing
-- them would make the pending list lie about who did what, and there is
-- no way to recover the distinction afterwards.
--
-- DROP-then-ADD rather than a NOT VALID add, because the table has ZERO
-- ROWS. There is nothing for the new constraint to validate and the
-- rewrite cannot fail on data. This is the cheapest moment in this
-- table's life to change its vocabulary and it will not come again.
--
-- The new list is a strict SUPERSET of the old, so even if rows had
-- appeared between the pre-flight capture and this apply, no existing
-- value can be rejected.
-- ---------------------------------------------------------------------
ALTER TABLE public.org_invitations
  DROP CONSTRAINT org_invitations_status_check;

ALTER TABLE public.org_invitations
  ADD CONSTRAINT org_invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'revoked', 'expired', 'declined'));


-- ---------------------------------------------------------------------
-- 3. Policy "Invitees read their own invitation"  (SELECT)
--
-- THE GAP NOBODY HAD NAMED. Before this policy, org_invitations had
-- exactly one policy and it was scoped to current_user_admin_org_ids().
-- An invitee is not a member of the inviting organization, let alone an
-- admin of it, so THE PERSON THE ROW IS ABOUT COULD NOT SEE IT. The
-- landing page they arrive at from the email would have rendered
-- nothing at all - not an error, just an empty result, because a SELECT
-- filtered out by RLS is an empty set and not a failure.
--
-- Scoped by ADDRESS, not by token. A token in a URL is a bearer
-- credential and putting it in a policy predicate would mean the policy
-- authorises whoever holds the string. Scoping to the caller's own
-- profiles email means the row is visible to the person it names, on any
-- page, with or without the link - which is also what makes an
-- in-product "you have an invitation" surface possible later without
-- another migration.
--
-- lower(btrim()) ON BOTH SIDES is 087's convention, adopted verbatim.
-- The explicit IS NOT NULL is redundant against it - a NULL comparison
-- is already NULL and therefore not true - and it is written anyway,
-- because "this policy is false for a caller with no email" should be
-- readable in the policy rather than inferred from three-valued logic.
-- ---------------------------------------------------------------------
CREATE POLICY "Invitees read their own invitation"
  ON public.org_invitations AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.current_user_email() IS NOT NULL
    AND lower(btrim(email)) = lower(btrim(public.current_user_email()))
  );


-- ---------------------------------------------------------------------
-- 4. Policy "Org admins create invitations"  (INSERT)
--
-- current_user_admin_org_ids() and NOT current_user_org_ids(), matching
-- the SELECT policy 086 already wrote on this table and matching the
-- capability map's org.member_invite: admin. This is the narrower of the
-- two available sets. Widening it later is a change somebody asks for;
-- narrowing it later takes away access somebody has already used.
--
-- IN (SELECT fn()) and never = ANY (fn()). These helpers return SETOF
-- uuid; the = ANY spelling raises 42809 and exists in this repository
-- only inside instruction comments, where it is wrong every time.
--
-- WHAT THIS CONSTRAINS: org_id only. That is the deliberate limit
-- described in the header - an admin has full authoring authority over
-- their own organization's invitations, so email, role, token and
-- expires_at are theirs to choose. The column CHECKs and the partial
-- unique index are what bound them, not this policy.
-- ---------------------------------------------------------------------
CREATE POLICY "Org admins create invitations"
  ON public.org_invitations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.current_user_admin_org_ids()));


-- ---------------------------------------------------------------------
-- 5. Policy "Org admins manage their invitations"  (UPDATE)
--
-- Covers both admin-side mutations: revoking a live invitation, and
-- stamping a lapsed one 'expired' before re-inviting the same address.
-- The second is the durable half of the expiry setter - see the header.
--
-- USING and WITH CHECK are the SAME predicate, which is what stops an
-- admin moving a row out of their own organization: the row must belong
-- to an org they administer both before and after.
--
-- THERE IS DELIBERATELY NO DELETE POLICY. An invitation is resolved by
-- status and never removed. The history is the point - an address that
-- was invited, declined, and invited again should leave both rows behind,
-- which is also exactly why 086's unique index is partial over pending
-- rather than total. This matches the append-only instinct in 080.
-- ---------------------------------------------------------------------
CREATE POLICY "Org admins manage their invitations"
  ON public.org_invitations AS PERMISSIVE FOR UPDATE TO authenticated
  USING (org_id IN (SELECT public.current_user_admin_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_admin_org_ids()));


-- ---------------------------------------------------------------------
-- 6. public.accept_org_invitation(p_token text) -> jsonb
--
-- The first writer of public.org_members in this product's history, and
-- the first thing capable of producing an organization with two members.
--
-- RETURNS jsonb rather than a composite type, for one reason: a
-- composite would be a schema object the down file has to drop, and a
-- DROP TYPE that fails on a dependency is a rollback that stops halfway.
-- jsonb travels through PostgREST as an object with no type registration
-- and adding a field to it later is not a migration.
--
-- The returned object carries org_id and org_name so the route can name
-- the company in its confirmation and redirect without a second query
-- the invitee may not be permitted to make.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_org_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_email   text := public.current_user_email();
  v_inv     public.org_invitations%ROWTYPE;
  v_orgname text;
  v_joined  boolean;
BEGIN
  -- No session, no accept. Checked before the row is read so that an
  -- anonymous caller learns nothing about the token either way.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to accept an invitation.'
      USING ERRCODE = 'LG002';
  END IF;

  -- FOR UPDATE: two clicks on the same link land here concurrently often
  -- enough to matter, and the second must wait for the first rather than
  -- read a stale 'pending' and duplicate the work.
  SELECT * INTO v_inv
  FROM public.org_invitations
  WHERE token = p_token
  FOR UPDATE;

  -- ONE ERROR FOR TWO CONDITIONS, ON PURPOSE. "No such token" and "that
  -- token is not addressed to you" are the same refusal with the same
  -- message and the same SQLSTATE. Splitting them would let a caller
  -- holding a guessed token confirm that SOME address was invited, and
  -- a caller holding a real token confirm whose it is.
  IF NOT FOUND
     OR v_email IS NULL
     OR v_inv.email IS NULL
     OR lower(btrim(v_inv.email)) <> lower(btrim(v_email)) THEN
    RAISE EXCEPTION 'That invitation could not be found.'
      USING ERRCODE = 'LG001';
  END IF;

  -- Expiry BEFORE status, so a lapsed invitation says "expired" rather
  -- than the vaguer "no longer pending".
  --
  -- THERE IS NO status = 'expired' STAMP HERE, AND THAT IS DELIBERATE.
  --
  -- An earlier draft of this file wrote one immediately before the RAISE.
  -- It could never have persisted: PostgREST wraps every RPC call in one
  -- transaction and an exception aborts it, so the UPDATE would have been
  -- rolled back with the RAISE every single time. A statement that reads
  -- as working and provably never runs to completion is worse than no
  -- statement - it is the same class as the 42P01 branch in
  -- lib/milestone-events.ts, which was dead for its entire working life
  -- while looking like a live guard, and which cost a real investigation
  -- to discover.
  --
  -- THE RAISE STAYS EXACTLY AS IT IS. Returning a status code instead
  -- would let the stamp persist, and that trade is the wrong way round: a
  -- raise fails LOUDLY, a returned code fails silently the moment one
  -- caller forgets to check it.
  --
  -- THE ONLY DURABLE EXPIRY WRITER IN THIS PRODUCT is the create route's
  -- pre-insert sweep, app/api/org/invitations/route.ts, which stamps any
  -- lapsed pending row for that (org_id, lower(email)) before inserting a
  -- replacement. It commits because nothing raises after it. It is also
  -- the only moment a stale pending row is ever FELT: such a row costs
  -- nobody anything until it blocks a re-invite through
  -- org_invitations_one_live_per_email.
  --
  -- So status stays 'pending' on disk for a lapsed invitation until
  -- somebody re-invites that address. The team page reads expires_at and
  -- renders "Lapsed" rather than trusting the column, so the interface
  -- does not repeat the omission.
  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'That invitation has expired. Ask for a new one.'
      USING ERRCODE = 'LG004';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'That invitation is no longer open.'
      USING ERRCODE = 'LG003';
  END IF;

  -- THE MEMBERSHIP.
  --
  -- EVERY VALUE EXCEPT user_id COMES OFF THE INVITATION ROW. org_id is
  -- read from v_inv and never from a parameter: sixteen accounts in this
  -- database have organizations.id EQUAL TO profiles.id from the 079
  -- backfill, so an org id taken from a user-supplied value is valid for
  -- those sixteen and garbage for everyone else, which is exactly why
  -- that whole defect class stayed invisible. user_id is auth.uid() and
  -- nothing else.
  --
  -- role is COPIED VERBATIM. org_members.role carries the identical
  -- CHECK (role IN ('owner','admin','member')) that org_invitations.role
  -- does, so a value that got into the invitation already passed it.
  -- Any narrower list written here would be a guess at an unmade ruling.
  --
  -- ON CONFLICT DO NOTHING against the named unique constraint, so that
  -- accepting twice - a double click, a retried request, a link opened
  -- in two tabs - is idempotent and returns the same object rather than
  -- a raw 23505 the invitee cannot act on.
  INSERT INTO public.org_members (org_id, user_id, role, invited_by)
  VALUES (v_inv.org_id, v_uid, v_inv.role, v_inv.invited_by)
  ON CONFLICT ON CONSTRAINT org_members_org_user_unique DO NOTHING;

  v_joined := FOUND;

  UPDATE public.org_invitations
     SET status      = 'accepted',
         accepted_by = v_uid,
         accepted_at = now(),
         updated_at  = now()
   WHERE id = v_inv.id;

  -- profiles.active_org_id IS DELIBERATELY NOT TOUCHED HERE.
  --
  -- This is the first true multi-membership in the product's life. Until
  -- this function ran for the first time, no account had ever belonged
  -- to two organizations. Repointing somebody's acting organization
  -- because they accepted an invitation would mean the next project,
  -- RFP or partnership they create is filed under a company they did not
  -- choose to be acting as - which is the precise misattribution
  -- lib/acting-org.ts's resolveActingOrgId() exists to prevent. Choosing
  -- which organization you are acting as is a separate, explicit act.
  SELECT o.name INTO v_orgname
  FROM public.organizations o
  WHERE o.id = v_inv.org_id;

  RETURN jsonb_build_object(
    'invitation_id',  v_inv.id,
    'org_id',         v_inv.org_id,
    'org_name',       v_orgname,
    'role',           v_inv.role,
    'already_member', NOT v_joined
  );
END;
$$;

COMMENT ON FUNCTION public.accept_org_invitation(text) IS
  'Accepts one colleague invitation by token, as the signed-in user, in ONE transaction: '
  'inserts the org_members row and marks the invitation accepted, or does neither. '
  'SECURITY DEFINER because an invitee is not yet a member of the organization inviting '
  'them, so no membership-derived policy can authorise the org_members INSERT - '
  '"Org admins add members" is the only INSERT authority on that table and no row shape '
  'makes an invitee an admin. Refuses with LG001 (no such invitation OR not yours - '
  'deliberately indistinguishable), LG002 (no session), LG003 (not pending), LG004 '
  '(expired). Copies org_id, role and invited_by off the invitation row and takes user_id '
  'from auth.uid(); never accepts an organization id as a parameter. Does NOT change '
  'profiles.active_org_id - see the body. Idempotent on repeat: ON CONFLICT DO NOTHING.';


-- ---------------------------------------------------------------------
-- 7. public.decline_org_invitation(p_token text) -> jsonb
--
-- The same guards in the same order as accept, deliberately: an invitee
-- who declines must not be able to learn anything an invitee who accepts
-- could not. Same merged LG001, same LG002, same LG003, same LG004 with
-- the same non-persisting stamp.
--
-- Writes NOTHING to org_members, and sets NEITHER accepted_by NOR
-- accepted_at. Those two columns mean "who accepted this and when" and a
-- decline is not an acceptance. The person who declined is recoverable
-- from the address on the row; borrowing an acceptance column to record
-- it would make every future reader of accepted_by wrong.
--
-- SECURITY DEFINER for the same reason accept is: the invitee has no
-- authoring authority over this row and every column but status and
-- updated_at must be pinned, which a WITH CHECK cannot do.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decline_org_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_email   text := public.current_user_email();
  v_inv     public.org_invitations%ROWTYPE;
  v_orgname text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to respond to an invitation.'
      USING ERRCODE = 'LG002';
  END IF;

  SELECT * INTO v_inv
  FROM public.org_invitations
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND
     OR v_email IS NULL
     OR v_inv.email IS NULL
     OR lower(btrim(v_inv.email)) <> lower(btrim(v_email)) THEN
    RAISE EXCEPTION 'That invitation could not be found.'
      USING ERRCODE = 'LG001';
  END IF;

  -- NO 'expired' STAMP HERE EITHER, for the reason set out at length in
  -- accept_org_invitation() above: the RAISE aborts the transaction, so
  -- any UPDATE written here would be rolled back every time and would be
  -- dead code that reads as working. The durable writer is the create
  -- route's pre-insert sweep and nothing else.
  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'That invitation has expired.'
      USING ERRCODE = 'LG004';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'That invitation is no longer open.'
      USING ERRCODE = 'LG003';
  END IF;

  UPDATE public.org_invitations
     SET status     = 'declined',
         updated_at = now()
   WHERE id = v_inv.id;

  SELECT o.name INTO v_orgname
  FROM public.organizations o
  WHERE o.id = v_inv.org_id;

  RETURN jsonb_build_object(
    'invitation_id', v_inv.id,
    'org_id',        v_inv.org_id,
    'org_name',      v_orgname
  );
END;
$$;

COMMENT ON FUNCTION public.decline_org_invitation(text) IS
  'Declines one colleague invitation by token, as the signed-in user. Sets status '
  '''declined'' and updated_at, and NOTHING else - no org_members row, and neither '
  'accepted_by nor accepted_at, because a decline is not an acceptance and borrowing those '
  'columns would make every future reader of them wrong. ''declined'' is distinct from '
  '''revoked'': revoked is the admin withdrawing the offer, declined is the invitee '
  'refusing it, and the pending list lies if they are collapsed. Same guards and same '
  'SQLSTATEs as accept_org_invitation(text), deliberately, so declining discloses nothing '
  'accepting would not. Added by migration 089.';


-- ---------------------------------------------------------------------
-- 8. EXECUTE privileges on all three new functions.
--
-- THE anon REVOKE IS NOT OPTIONAL AND FROM PUBLIC DOES NOT COVER IT.
-- A stock Supabase project carries ALTER DEFAULT PRIVILEGES granting
-- anon EXECUTE on functions in schema public, from BOTH postgres and
-- supabase_admin. The SQL Editor runs as postgres, so every CREATE
-- FUNCTION above granted anon EXECUTE **directly**, and a REVOKE ...
-- FROM PUBLIC does not remove a direct grant - it is a no-op against
-- anon. The grant has to be revoked FROM anon BY NAME.
--
-- This is exactly how 087 shipped an authenticated-only helper and how
-- 088 failed to. V1 below asserts f for anon on all three rather than
-- trusting that this ran.
--
-- CREATE OR REPLACE preserves ACLs; DROP then CREATE does not. So a
-- later migration that DROPs any of these three and recreates it
-- re-grants anon and must carry these three statements forward. The down
-- file says the same thing.
--
-- service_role IS DELIBERATELY NOT GRANTED. It already holds EXECUTE by
-- the same default privilege, and V1 ASSERTS that inherited value rather
-- than this file writing a GRANT that pretends to have set it - which is
-- 082's precedent. 087 granted it explicitly because a real service-role
-- caller existed there. NO SERVICE-ROLE CALLER EXISTS HERE, and must
-- not: the accept and decline paths are session-client only, by ruling.
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.current_user_email()            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_email()            FROM anon;
GRANT  EXECUTE ON FUNCTION public.current_user_email()            TO authenticated;

REVOKE EXECUTE ON FUNCTION public.accept_org_invitation(text)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_org_invitation(text)     FROM anon;
GRANT  EXECUTE ON FUNCTION public.accept_org_invitation(text)     TO authenticated;

REVOKE EXECUTE ON FUNCTION public.decline_org_invitation(text)    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decline_org_invitation(text)    FROM anon;
GRANT  EXECUTE ON FUNCTION public.decline_org_invitation(text)    TO authenticated;

COMMIT;


-- =====================================================================
-- 9. VERIFICATION. RUN AFTER APPLYING. READ ONLY, EXCEPT V7 AND V8,
--    WHICH ARE WRITES AND ARE MARKED. EXPECTED VALUES STATED.
--
-- These are commented out so they cannot run inside the transaction
-- above. Paste them into the SQL Editor one at a time, after the COMMIT
-- has landed.
-- =====================================================================
--
-- V1. THE GRANT ASSERTION. The one that catches the 088 mistake.
--
--       SELECT 'current_user_email' AS fn,
--              has_function_privilege('anon',          'public.current_user_email()', 'EXECUTE') AS anon,
--              has_function_privilege('authenticated', 'public.current_user_email()', 'EXECUTE') AS authenticated,
--              has_function_privilege('service_role',  'public.current_user_email()', 'EXECUTE') AS service_role
--       UNION ALL
--       SELECT 'accept_org_invitation',
--              has_function_privilege('anon',          'public.accept_org_invitation(text)', 'EXECUTE'),
--              has_function_privilege('authenticated', 'public.accept_org_invitation(text)', 'EXECUTE'),
--              has_function_privilege('service_role',  'public.accept_org_invitation(text)', 'EXECUTE')
--       UNION ALL
--       SELECT 'decline_org_invitation',
--              has_function_privilege('anon',          'public.decline_org_invitation(text)', 'EXECUTE'),
--              has_function_privilege('authenticated', 'public.decline_org_invitation(text)', 'EXECUTE'),
--              has_function_privilege('service_role',  'public.decline_org_invitation(text)', 'EXECUTE');
--
--     EXPECTED: anon = f, authenticated = t on ALL THREE ROWS.
--     service_role = t on all three, INHERITED from the default
--     privilege and not granted by this file - it is asserted, not set.
--     A t under anon means section 8 did not run or the file was applied
--     from an older copy. Re-run the three REVOKE ... FROM anon lines.
--
-- V2. The three functions are hardened the way every helper here is.
--
--       SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('current_user_email',
--                           'accept_org_invitation',
--                           'decline_org_invitation')
--       ORDER BY p.proname;
--
--     EXPECTED: 3 rows. prosecdef = t on all three.
--     proconfig = {"search_path=public, pg_temp"} on all three.
--     provolatile = 's' for current_user_email, 'v' for the other two
--     (they write, so they are VOLATILE, which is the plpgsql default
--     and is correct - a STABLE function may not write).
--
-- V3. THE CONSTRAINT ADMITS 'declined'.
--
--       SELECT conname, pg_get_constraintdef(oid) AS def
--       FROM pg_constraint
--       WHERE conrelid = 'public.org_invitations'::regclass
--         AND conname = 'org_invitations_status_check';
--
--     EXPECTED: 1 row whose def CONTAINS the string 'declined' and also
--     still contains 'pending', 'accepted', 'revoked' and 'expired'.
--     Asserted rather than eyeballed:
--
--       SELECT pg_get_constraintdef(oid) LIKE '%declined%' AS has_declined,
--              pg_get_constraintdef(oid) LIKE '%pending%'  AS has_pending,
--              pg_get_constraintdef(oid) LIKE '%accepted%' AS has_accepted,
--              pg_get_constraintdef(oid) LIKE '%revoked%'  AS has_revoked,
--              pg_get_constraintdef(oid) LIKE '%expired%'  AS has_expired
--       FROM pg_constraint
--       WHERE conrelid = 'public.org_invitations'::regclass
--         AND conname = 'org_invitations_status_check';
--
--     EXPECTED: t, t, t, t, t.
--
-- V4. FOUR POLICIES ON org_invitations, and the 086 one is untouched.
--
--       SELECT policyname, cmd, roles, qual, with_check
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'org_invitations'
--       ORDER BY policyname;
--
--     EXPECTED: exactly 4 rows, all {authenticated}:
--       "Invitees read their own invitation"    SELECT
--       "Org admins create invitations"         INSERT
--       "Org admins manage their invitations"   UPDATE
--       "Org admins read their invitations"     SELECT   <- 086's, unchanged
--     There must be NO row with cmd = 'DELETE'. If one appears, it did
--     not come from this file.
--
--       SELECT count(*) FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'org_invitations';
--       -- EXPECTED: 4
--
-- V5. THE TOTAL POLICY COUNT IN public.
--
--       SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--
--     EXPECTED: 117.
--     Baseline before this file: 114. This file adds three and drops
--     none. Compare against the number P4 actually returned, not against
--     this comment - if P4 was not 114, the expected value here is
--     P4 + 3 and something else moved that needs finding.
--
-- V6. The six pre-existing current_user_* helpers are UNTOUCHED.
--
--       SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS body_hash
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname LIKE 'current\_user\_%'
--       ORDER BY p.proname;
--
--     EXPECTED: 7 rows now - the six from P5 with byte-identical hashes,
--     plus current_user_email. Any hash change among the six means this
--     file did something it does not describe. Roll back.
--
-- V7. THE INVITEE READ ACTUALLY WORKS. A WRITE, THEN A READ.
--     Run the INSERT as an ADMIN of some organization, from a real
--     authenticated application session - NOT as postgres, which
--     bypasses RLS and proves nothing at all.
--
--       INSERT INTO public.org_invitations (org_id, email, token, expires_at, invited_by)
--       VALUES ('<an org you administer>',
--               '<the second test account''s email>',
--               'v7-089-verification-token',
--               now() + interval '7 days',
--               auth.uid());
--
--     EXPECTED: 1 row inserted. BEFORE 089 THIS RAISED 42501, "new row
--     violates row-level security policy for table org_invitations",
--     because the table had no INSERT policy at all.
--
--     Then, signed in as THE INVITEE (the second account):
--
--       SELECT id, org_id, email, role, status FROM public.org_invitations;
--
--     EXPECTED: exactly 1 row, the one addressed to them. BEFORE 089
--     THIS RETURNED ZERO ROWS - not an error, an empty set, which is
--     what would have made the landing page render nothing.
--
--     And confirm the scoping is by address and not "any invitation":
--     as the invitee, they must NOT see an invitation addressed to a
--     third address in the same organization.
--
-- V8. ACCEPT WORKS AND IS IDEMPOTENT. A WRITE. As THE INVITEE:
--
--       SELECT public.accept_org_invitation('v7-089-verification-token');
--
--     EXPECTED: a jsonb object with org_id, org_name, role,
--     already_member = false. Then:
--
--       SELECT count(*) FROM public.org_members WHERE org_id = '<that org>';
--       -- EXPECTED: 2. THIS IS THE FIRST TWO-MEMBER ORGANIZATION IN
--       -- THIS DATABASE'S HISTORY. Everything calibrated on
--       -- one-member-per-org is now calibrated on a false premise -
--       -- lib/capabilities.ts orgRoleFor() in particular, which returns
--       -- "owner" for every caller. See the session report.
--
--       SELECT status, accepted_by, accepted_at FROM public.org_invitations
--       WHERE token = 'v7-089-verification-token';
--       -- EXPECTED: accepted, the invitee's user id, a timestamp.
--
--     Then call it a SECOND time with the same token:
--       -- EXPECTED: ERROR LG003, "That invitation is no longer open."
--       -- NOT a 23505, and NOT a second org_members row.
--
--     And as a THIRD account, call it with the same token:
--       -- EXPECTED: ERROR LG001, "That invitation could not be found."
--       -- The SAME error a nonexistent token gives. Confirm that by
--       -- calling it with 'no-such-token-at-all' and comparing: the
--       -- message and the code must be identical.
--
-- V9. CLEAN UP V7/V8 IF THIS WAS A TEST ORGANIZATION.
--
--       DELETE FROM public.org_members
--        WHERE org_id = '<that org>' AND user_id = '<the invitee>';
--       DELETE FROM public.org_invitations
--        WHERE token = 'v7-089-verification-token';
--
--     Run as postgres. Note that the DELETE on org_invitations cannot be
--     done from the application at all - this file adds no DELETE policy,
--     by design.
-- =====================================================================
