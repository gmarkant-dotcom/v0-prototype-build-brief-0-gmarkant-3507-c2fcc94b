-- =====================================================================
-- Migration 090: profiles.active_org_id, and the one sanctioned writer.
--                The tie-breaker resolveActingOrgId() has been looking
--                for since 079 and guarding a 42703 for ever since.
--
--   NEW   public.profiles.active_org_id            uuid NULL, FK SET NULL
--   NEW   public.profiles_guard_active_org()       -> trigger
--   NEW   trigger profiles_active_org_guard        BEFORE UPDATE ON profiles
--   NEW   public.set_active_org(uuid)              -> jsonb
--   REPL  public.accept_org_invitation(text)       -> jsonb  (one clause added)
--
--   POLICIES ADDED: NONE. Count stays at 117. See section 3's header for
--   why there is deliberately no UPDATE policy on this column, and
--   section 2 for what actually closes it instead.
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- This file is AUTHORED, NOT APPLIED. The session that wrote it executed
-- no statement against any database and holds no credential that could.
-- It is applied by Greg, by hand, in the Supabase SQL Editor.
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE 208
-- and an explicit COMMIT; on LINE 775. Those are the only EXECUTABLE
-- occurrences of either word.
--
-- TO DRY RUN: change the COMMIT; on line 775 to ROLLBACK; and run the
-- whole file. Every statement executes, every error surfaces, nothing
-- persists. Verify the line numbers before trusting them, with:
--
--     grep -n -i '^begin\|^commit\|^rollback' \
--       supabase/migrations/090_active_org.sql
--
-- THAT GREP RETURNS FIVE HITS, AND FIVE IS CORRECT:
--     208  BEGIN;    <- executable. The transaction.
--     327  BEGIN     <- plpgsql, profiles_guard_active_org's body.
--                       No semicolon; matched by the case-insensitive
--                       form only, not a transaction statement.
--     464  BEGIN     <- plpgsql, set_active_org's body. Same.
--     565  BEGIN     <- plpgsql, accept_org_invitation's body. Same.
--     775  COMMIT;   <- executable. The one to swap for ROLLBACK;.
-- Exactly one line ends in `BEGIN;` and exactly one in `COMMIT;`.
-- If your grep shows a different set, this is not the file that was read.
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
--   1. Run PRE-FLIGHT CAPTURE below. One of its queries can stop this
--      migration outright.
--   2. Read ORDERING AGAINST THE CODE below.
--   3. Dry run: COMMIT -> ROLLBACK, run, confirm no errors, put it back.
--   4. Run for real.
--   5. Run VERIFICATION. Every query states its expected value.
--   6. Only then update the migrations table in LIGAMENT_CONTEXT.md.
--
-- =====================================================================
-- WHY THIS EXISTS, IN ONE PARAGRAPH
-- =====================================================================
--
-- resolveActingOrgId() (lib/acting-org.ts) answers "which company is
-- this caller acting for". With one membership it answers immediately.
-- With more than one it looks for a stored preference in
-- profiles.active_org_id, DOES NOT FIND THE COLUMN, and fails closed
-- with reason "ambiguous". Every singular-acting-org WRITE path in the
-- product resolves through it or through resolveCallerWriteOrgId(),
-- which delegates to it. READS ARE UNAFFECTED - 079 built every one of
-- them as IN (SELECT current_user_org_ids()), plural by design.
--
-- accept_org_invitation(), shipped in 089, is the first thing in this
-- product's history that can give an account a SECOND membership, and
-- BOTH realistic paths reach it: handle_new_user() gives every new
-- profile its own organization, so an invitee arrives with one
-- membership whether or not they had an account before. Accept makes it
-- two. So the first colleague who accepts gets an account that reads
-- everything and writes nothing, with no error that explains why.
--
-- That is the whole of the hard ordering constraint in the invitation
-- work: COLLEAGUE_INVITATIONS must not be switched on until this
-- migration is applied. lib/feature-flags.ts states the same order and
-- names this file.
--
-- =====================================================================
-- ORDERING AGAINST THE CODE
-- =====================================================================
--
-- 1. APPLY THIS MIGRATION FIRST, THEN PUSH THE CODE. The commit that
--    removes the 42703 guard from lib/acting-org.ts depends on this
--    file having been applied. Its commit message says so.
--
-- 2. WHAT HAPPENS IF THE CODE SHIPS FIRST, stated so it is not guessed:
--    loadStoredActingOrgId() loses the branch that swallows 42703, so a
--    caller with MORE THAN ONE membership logs an error and gets a null
--    preference - which is the same "ambiguous" refusal they already
--    had. A caller with ONE membership never reaches that query at all.
--    Nobody today has two memberships. So the wrong order is noisy in
--    the logs and harmless in behaviour. It is still the wrong order.
--
-- 3. WHAT HAPPENS IF THIS IS APPLIED AND NO CODE SHIPS: nothing. A
--    nullable column nothing reads, a trigger that fires on a column
--    nothing writes, and one function no caller calls. The invitation
--    surface is behind COLLEAGUE_INVITATIONS and that flag is absent
--    from every env file and from Vercel.
--
-- 4. THE FLAG STAYS OFF UNTIL THIS IS APPLIED AND THE SWITCHER IS
--    DEPLOYED. In that order.
--
-- =====================================================================
-- NO BACKFILL, AND THIS IS THE REASON
-- =====================================================================
--
-- Every one of the eighteen accounts has EXACTLY ONE membership today.
-- resolveActingOrgId() returns on the sole-membership branch before it
-- ever reads the preference - see the early return in that function -
-- so the hint is never consulted for any of them. NULL is therefore the
-- correct and complete value for every existing row, and a backfill
-- would write eighteen values that nothing reads, then have to be
-- reasoned about by the next person who finds them.
--
-- The first non-NULL value in this column will be written by
-- accept_org_invitation() (section 4) or by set_active_org() (section
-- 3), and both of those happen because a human did something.
--
-- P1 in PRE-FLIGHT CAPTURE is the query that confirms the premise. If
-- it returns any row, STOP: somebody already has two memberships, the
-- no-backfill argument does not hold for them, and they need a value
-- picked deliberately rather than by this file.
--
-- =====================================================================
-- NO INDEX ON active_org_id, AND THIS IS THE REASON
-- =====================================================================
--
-- DO NOT ADD ONE. Every read of this column in the product is
-- loadStoredActingOrgId(): SELECT active_org_id FROM profiles WHERE id
-- = $1. That is a PRIMARY KEY lookup on profiles.id, and the column
-- being selected is fetched from the heap tuple the index already found.
-- An index on active_org_id would serve a query of the shape "who is
-- acting for organization X", and nothing in this product asks it.
--
-- The FK does not need one either. FK enforcement indexes the REFERENCED
-- side (organizations.id, already the primary key); a referencing-side
-- index only helps ON DELETE cascade/set-null scans, and eighteen rows
-- is a sequential scan measured in microseconds.
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. RUN BEFORE THE TRANSACTION. READ ONLY.
-- =====================================================================
--
-- P1. THE NO-BACKFILL PREMISE. A STOPPER IF IT RETURNS ROWS.
--
--       SELECT user_id, count(*) AS memberships
--       FROM public.org_members
--       GROUP BY user_id
--       HAVING count(*) > 1;
--       -- EXPECTED: 0 rows. Every account has exactly one membership.
--       -- ANY ROW HERE: stop. That account needs a chosen value, not a
--       -- NULL, and this file does not choose one for anybody.
--
-- P2. THE COLUMN IS NOT ALREADY THERE.
--
--       SELECT column_name, data_type, is_nullable
--       FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'profiles'
--         AND column_name = 'active_org_id';
--       -- EXPECTED: 0 rows. If it returns one, this migration has been
--       -- applied already; go straight to VERIFICATION.
--
-- P3. THE BASELINE THIS FILE PREDICTS AGAINST.
--
--       SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--       -- EXPECTED: 117, the value 089 left behind.
--       -- THIS FILE ADDS NO POLICY, so the post-apply count is also 117.
--
-- P4. 089 IS ACTUALLY APPLIED. Section 4 REPLACES one of its functions.
--
--       SELECT proname, prosecdef, proconfig
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND proname IN ('current_user_email','accept_org_invitation',
--                         'decline_org_invitation');
--       -- EXPECTED: 3 rows, prosecdef = t on all three, proconfig
--       -- containing search_path=public, pg_temp on all three.
--
-- P5. THE EXISTING UPDATE POLICY ON profiles. Read this one; section 2
--     exists because of what it says.
--
--       SELECT policyname, cmd, roles, qual, with_check
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'profiles'
--         AND cmd = 'UPDATE';
--       -- EXPECTED per docs/schema-snapshot-2026-08-13.md:
--       --   "Users can update own profile", UPDATE, {public},
--       --   qual = (auth.uid() = id), with_check = NULL.
--       -- THAT POLICY IS TABLE-WIDE. RLS HAS NO COLUMN GRANULARITY, so
--       -- it covers every column on profiles including one added today.
--
-- =====================================================================


BEGIN;


-- ---------------------------------------------------------------------
-- 1. public.profiles.active_org_id
--
-- NULLABLE, and null is the normal state. Null means "this person has
-- never been asked which company they are acting for", which is true of
-- all eighteen accounts and stays true of anybody who only ever belongs
-- to one organization.
--
-- ON DELETE SET NULL, AND EXPLICITLY NOT CASCADE. CASCADE here would
-- read "delete the organization, delete the profile" - one company being
-- wound up would delete the PEOPLE, including people who belong to other
-- companies too. That is the same choice, for the same reason, that
-- 079 made for organizations.primary_contact_user_id. The consequence of
-- SET NULL is stated rather than hidden: deleting an organization
-- silently returns every member's hint to "never chosen", and the next
-- write by anyone with two remaining memberships is refused as ambiguous
-- until they pick again. That is a refusal they can see and act on, and
-- it is the safe direction.
--
-- NOT NULL WAS NEVER AN OPTION. There is no correct default: the
-- eighteen existing rows have nothing to point at that is not a guess,
-- and a guess in this column is a misattribution of one customer's work
-- to another customer's company.
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_org_id uuid
    REFERENCES public.organizations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.active_org_id IS
  'WHICH ORGANIZATION THIS PERSON IS ACTING FOR. A HINT, NEVER A GRANT. It is '
  'validated against org_members on EVERY read - see resolveActingOrgId() in '
  'lib/acting-org.ts - and a value naming an organization the person is not a '
  'member of is refused, not honoured, because removing somebody from org_members '
  'does NOT null this column and a stale pointer is therefore normal. NULL means '
  '"never chosen", which is correct for anyone with a single membership: the '
  'resolver returns on the sole-membership branch without reading this at all. '
  'Written by public.set_active_org(uuid) and, set-if-null only, by '
  'public.accept_org_invitation(text). ON DELETE SET NULL, never CASCADE: '
  'deleting an organization must never delete a profile.';


-- ---------------------------------------------------------------------
-- 2. THE WRITE GUARD. READ THIS BEFORE DECIDING WHETHER YOU WANT IT.
--
-- =====================================================================
-- THIS SECTION IS A DEVIATION FROM THE BRIEF THAT COMMISSIONED THIS
-- FILE, AND IT IS HERE BECAUSE THE BRIEF'S PREMISE IS FALSE.
-- =====================================================================
--
-- The instruction was: add NO plain UPDATE policy on this column,
-- because lib/acting-org.ts deliberately takes no requested-org
-- parameter - a validating resolver is one refactor away from a
-- trusting one - and a user-writable active_org_id reintroduces exactly
-- that. The function should be the only writer.
--
-- NO POLICY IS ADDED. That half is honoured and section 3 restates the
-- reasoning. But adding no policy DOES NOT MAKE THE FUNCTION THE ONLY
-- WRITER, and writing that sentence into this header without this
-- section would put a false claim in a file whose whole value is that
-- its claims are true.
--
-- HERE IS WHY. public.profiles ALREADY CARRIES A TABLE-WIDE UPDATE
-- POLICY: "Users can update own profile", UPDATE, {public}, USING
-- (auth.uid() = id), with no WITH CHECK. Read it with P5 above.
-- POSTGRESQL RLS IS ROW-LEVEL AND HAS NO COLUMN GRANULARITY, so that
-- policy admits every column on the table, including a column added
-- three years after it was written. The moment section 1 runs, any
-- signed-in browser holding the anon key can
--
--     PATCH /rest/v1/profiles?id=eq.<their own id>
--     {"active_org_id": "<any uuid at all>"}
--
-- and it will be accepted. Not adding a policy changes nothing about
-- that, because the permission is inherited, not granted here.
--
-- THE MECHANISM THAT WOULD HAVE BEEN COLUMN-LEVEL GRANTS DOES NOT WORK
-- HERE EITHER, and it is worth saying why so nobody spends an afternoon
-- on it. REVOKE UPDATE (active_org_id) ON public.profiles FROM
-- authenticated is a NO-OP while that role holds table-level UPDATE -
-- PostgreSQL's own REVOKE documentation says so in as many words. Making
-- it bite means revoking table-level UPDATE and re-granting an explicit
-- list of every OTHER column on profiles, which is a list this session
-- cannot enumerate without querying the database, and getting it one
-- column short silently breaks the profile settings page.
--
-- SO THE GUARD IS A TRIGGER, AND IT ENFORCES A ROW INVARIANT RATHER THAN
-- A CALLER IDENTITY: a profile's active_org_id must name an organization
-- that profile is a member of, whoever is writing and however they got
-- there. That is strictly stronger than "only this function may write
-- it", it needs no column list, and it cannot be defeated by a future
-- route that writes the column directly without thinking.
--
-- WHAT IT DOES NOT DO, SAID PLAINLY. It fires on UPDATE, so it cannot
-- see a membership REMOVED later - deleting an org_members row leaves
-- the pointer behind, untouched, still naming an organization the person
-- can no longer reach. THAT IS THE STALE-HINT HOLE AND IT IS CLOSED AT
-- READ TIME, NOT HERE. resolveActingOrgId() checks the hint against the
-- live membership set on every single call and returns
-- "preference-refused" when it is not in it. A cleanup trigger on
-- org_members DELETE was considered and deliberately NOT written: it
-- would make the column look trustworthy, and the next person to read
-- this code would skip the read-side check because "the database keeps
-- it consistent". The read-side check is the guarantee. This trigger is
-- defence in depth behind it.
--
-- IF YOU DISAGREE WITH ANY OF THIS: delete this entire section 2, and
-- the migration is still coherent. You lose defence in depth and you
-- keep the guarantee, because resolveActingOrgId() validates regardless.
-- Delete V4 and V5 from VERIFICATION with it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_guard_active_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- THE EARLY RETURN THAT MAKES THIS FREE. Every UPDATE on profiles that
  -- does not move this column - which today is every UPDATE on profiles
  -- in the entire product - leaves here, having done one comparison. A
  -- read-modify-write that sends the same value back is IS NOT DISTINCT
  -- FROM and leaves here too.
  IF NEW.active_org_id IS NOT DISTINCT FROM OLD.active_org_id THEN
    RETURN NEW;
  END IF;

  -- Clearing the hint is always allowed. It is what the FK's ON DELETE
  -- SET NULL does when an organization is deleted, and refusing it would
  -- turn deleting an organization into an error nobody could explain.
  -- Null means "never chosen", which is a state, not a claim.
  IF NEW.active_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- THE INVARIANT. Membership of the ROW OWNER, not of the caller: this
  -- is a fact about the row, so it holds for a session client, for
  -- service_role, for a migration and for the SQL Editor alike. Nothing
  -- here reads auth.uid(), which is what makes it independent of who is
  -- connected.
  --
  -- It raises rather than silently reverting to OLD. A silent revert
  -- would leave the caller believing they had switched company while
  -- every subsequent write went to the other one - which is the exact
  -- misattribution this whole module exists to prevent, delivered
  -- quietly.
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.user_id = NEW.id
      AND m.org_id  = NEW.active_org_id
  ) THEN
    RAISE EXCEPTION 'That is not an organization you belong to.'
      USING ERRCODE = 'LG005';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_guard_active_org() IS
  'BEFORE UPDATE guard on profiles.active_org_id. Enforces the row invariant '
  '"active_org_id names an organization this profile is a member of", for every '
  'writer including service_role. Returns immediately when the column is unchanged '
  'or set to NULL. Raises LG005 otherwise. It exists because "Users can update own '
  'profile" is table-wide and RLS has no column granularity, so not adding a policy '
  'does not stop a browser writing this column directly. It does NOT clear stale '
  'pointers when a membership is removed - that is handled at read time by '
  'resolveActingOrgId() in lib/acting-org.ts, deliberately, so that nobody starts '
  'trusting this column.';

DROP TRIGGER IF EXISTS profiles_active_org_guard ON public.profiles;

CREATE TRIGGER profiles_active_org_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_active_org();


-- ---------------------------------------------------------------------
-- 3. public.set_active_org(p_org_id uuid) -> jsonb
--
-- The sanctioned writer, and the only thing the switcher in the sidebar
-- calls.
--
-- THERE IS NO UPDATE POLICY ON THIS COLUMN AND NONE IS ADDED, and the
-- reason is worth carrying even though section 2 explains why it is not
-- sufficient on its own. lib/acting-org.ts takes NO requested-org
-- parameter, on purpose, and says so at length in its own header: a
-- resolver that accepts a candidate organization id and validates it is
-- one refactor away from a resolver that trusts one, and a resolver with
-- no such parameter cannot be misused that way even by accident. A
-- freely writable acting-organization column reintroduces exactly the
-- shape that module was built to remove. So the write is funnelled
-- through one named function that validates before it writes, and
-- section 2's trigger enforces the same rule for anything that goes
-- round it.
--
-- =====================================================================
-- THE ENUMERATION-ORACLE ASSESSMENT. ASSESSED, NOT ASSUMED.
-- =====================================================================
--
-- THIS FUNCTION TAKES AN ARBITRARY ORGANIZATION ID AS A PARAMETER. That
-- is the shape that made org_has_member_with_email(uuid, text) a
-- confirm-oracle in 087, and it is the reason 089's current_user_email()
-- takes no arguments at all. So it gets assessed rather than waved past.
--
-- WHAT AN ATTACKER LEARNS FROM A SUCCESS: that they are a member of the
-- organization they just named. They already knew - membership is what
-- lets them read that organization's rows at all, and org_members is
-- readable to its own members by 079's policy. No new information.
--
-- WHAT AN ATTACKER LEARNS FROM A FAILURE: that they are not a member of
-- the organization they named. THE CRITICAL PART IS THAT THIS IS THE
-- SAME ANSWER FOR AN ORGANIZATION THAT DOES NOT EXIST. The membership
-- test is a single EXISTS over org_members keyed on (user_id, org_id);
-- a garbage uuid and a real competitor's uuid both produce zero rows,
-- both raise LG005, and both carry the identical message. There is no
-- branch anywhere in this function that distinguishes them, so there is
-- nothing for a caller to enumerate with.
--
-- THE FAILURE PATH RETURNS NO ROW DETAIL. NOT THE ORGANIZATION NAME, NOT
-- ITS CREATION DATE, NOT WHETHER IT EXISTS. The message is a fixed
-- string with no interpolation. THIS IS THE LINE THAT MUST NOT BE
-- "IMPROVED": adding "Acme Ltd is not an organization you belong to"
-- would turn a refusal into a uuid-to-company-name lookup for every
-- organization in the database, which is a far worse oracle than the one
-- 087 had.
--
-- THE ORDER OF OPERATIONS IS PART OF THE ASSESSMENT. The membership
-- check runs BEFORE the UPDATE, and it must stay that way. Writing
-- first and letting the foreign key refuse would distinguish the two
-- cases through the SQLSTATE - 23503 for an organization that does not
-- exist, success for one that does - which is an existence oracle
-- delivered by the constraint rather than by the message.
--
-- THE SUCCESS PATH RETURNS ONLY THE ID THE CALLER SUPPLIED. No name. The
-- switcher already has every name it can legitimately show, because it
-- built its list by reading the caller's own memberships.
--
-- p_org_id NULL IS REFUSED rather than treated as "clear the
-- preference". Clearing it is not a neutral act for the person this
-- function exists for: an account with two memberships and a null hint
-- is "ambiguous", which means every write in the product is refused. A
-- switcher must not offer a state that locks its own user out, and the
-- database is the right place to make that unreachable.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_active_org(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to switch organization.'
      USING ERRCODE = 'LG002';
  END IF;

  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'Choose an organization to act for.'
      USING ERRCODE = 'LG006';
  END IF;

  -- ONE ERROR FOR TWO CONDITIONS, ON PURPOSE, exactly as 089's LG001 is.
  -- "No such organization" and "not one of yours" are the same refusal
  -- with the same message and the same SQLSTATE. See the oracle
  -- assessment above; this is the line it is about.
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.user_id = v_uid
      AND m.org_id  = p_org_id
  ) THEN
    RAISE EXCEPTION 'That is not an organization you belong to.'
      USING ERRCODE = 'LG005';
  END IF;

  -- id = v_uid and nothing else. The row written is always the caller's
  -- own, and auth.uid() is the only thing that decides which row that is.
  UPDATE public.profiles
     SET active_org_id = p_org_id
   WHERE id = v_uid;

  -- Echoes back what the caller supplied. Deliberately nothing else -
  -- see the assessment above.
  RETURN jsonb_build_object('active_org_id', p_org_id);
END;
$$;

COMMENT ON FUNCTION public.set_active_org(uuid) IS
  'Sets profiles.active_org_id for the signed-in caller, after checking that '
  'auth.uid() is a member of p_org_id. SECURITY DEFINER so that the write is '
  'funnelled through one validating entry point rather than left to a table-wide '
  'UPDATE policy that RLS cannot scope to a single column. Refuses with LG002 (no '
  'session), LG006 (null organization) and LG005 (no such organization OR not one '
  'of yours - deliberately indistinguishable, and the message must never name the '
  'organization or this becomes an existence oracle). Returns only the id it was '
  'given. Never clears the preference: a null hint on a multi-membership account '
  'is "ambiguous", which refuses every write in the product.';


-- ---------------------------------------------------------------------
-- 4. public.accept_org_invitation(p_token text) -> jsonb  -- REPLACED
--
-- ONE CLAUSE IS ADDED AND NOTHING ELSE CHANGES. The clause initializes
-- profiles.active_org_id, and ONLY IF IT IS CURRENTLY NULL.
--
-- CREATE OR REPLACE, NEVER DROP THEN CREATE. Two reasons, both
-- load-bearing:
--
--   1. CREATE OR REPLACE PRESERVES THE FUNCTION'S ACL. DROP then CREATE
--      does not - the new function picks up pg_default_acl, and a stock
--      Supabase project grants anon EXECUTE on functions in public by
--      default privilege from both postgres and supabase_admin. So a
--      DROP-then-CREATE here would silently hand anon EXECUTE on the one
--      function in this product that writes org_members. 089 revoked it
--      by name; that revoke survives a REPLACE and does not survive a
--      DROP. V6 asserts it survived.
--   2. decline_org_invitation(text) is untouched by this file and stays
--      exactly as 089 left it.
--
-- THE WHOLE BODY IS REPRODUCED BELOW, VERBATIM FROM
-- supabase/migrations/089_org_invitation_lifecycle.sql LINES 495-632,
-- BECAUSE CREATE OR REPLACE REPLACES THE BODY WHOLESALE AND ANY CLAUSE
-- OMITTED HERE IS DELETED FROM THE LIVE FUNCTION. It was copied from
-- that file rather than retyped, and the diff between the two is in
-- docs/090-active-org-report.md - it shows the one added clause, the
-- comment block that clause replaces, and nothing else. If you are
-- reviewing this, diff it yourself; that is cheaper than reading it.
--
-- WHAT DID NOT CHANGE, so you can check the list rather than the prose:
-- the signature, the SECURITY DEFINER, the pinned search_path, the LG002
-- session guard, the FOR UPDATE row lock, the merged LG001 refusal, the
-- LG004 expiry raise with its comment about why there is no 'expired'
-- stamp, the LG003 status guard, the org_members INSERT with ON CONFLICT
-- DO NOTHING, the invitation UPDATE, and the returned object.
--
-- THE ONE THING THE ADDED CLAUSE DEPENDS ON IS ORDER. It runs AFTER the
-- org_members INSERT, in the same transaction, so section 2's trigger
-- sees the membership that INSERT just created. Moving it above the
-- INSERT would make every accept fail with LG005. Do not reorder it.
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

  -- profiles.active_org_id IS INITIALIZED HERE, AND ONLY IF IT IS NULL.
  --
  -- 089 SET NOTHING HERE AND SAID SO. What changed is that migration 090
  -- added the column, so there is now a difference between "this person
  -- has never chosen" (NULL) and "this person has chosen" (a value). The
  -- reasoning 089 wrote in this spot is unchanged and still governs the
  -- second case:
  --
  --   This is the first true multi-membership in the product's life.
  --   Repointing somebody's acting organization because they accepted an
  --   invitation would mean the next project, RFP or partnership they
  --   create is filed under a company they did not choose to be acting
  --   as - which is the precise misattribution lib/acting-org.ts's
  --   resolveActingOrgId() exists to prevent.
  --
  -- SET-IF-NULL IS NOT A SWITCH. It is the first answer to a question the
  -- user has never been asked. WHERE active_org_id IS NULL is the whole
  -- of the difference: an existing value is a choice somebody made and
  -- this function does not get to overrule it.
  --
  -- WHY IT IS SET AT ALL. Without it the accepter has two memberships and
  -- no hint, resolveActingOrgId() returns "ambiguous", and every singular
  -- acting-org WRITE path in the product refuses them - with reads still
  -- working, because 079 built every read as IN (SELECT
  -- current_user_org_ids()). An account that can read everything and
  -- write nothing, with no error that explains why, is worse than a
  -- default that can be changed in one click from the sidebar.
  --
  -- WHY THE INVITING ORGANIZATION AND NOT THEIR OWN. The organization
  -- handle_new_user() minted for them is an artefact of signing up, not a
  -- company they chose; the one on this invitation is the company that
  -- asked for them by name. If that is wrong for them, the switcher is
  -- one click and this write never happens again.
  --
  -- v_inv.org_id, NEVER A PARAMETER. Same rule as the INSERT above.
  UPDATE public.profiles
     SET active_org_id = v_inv.org_id
   WHERE id = v_uid
     AND active_org_id IS NULL;

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
  'from auth.uid(); never accepts an organization id as a parameter. Idempotent on '
  'repeat: ON CONFLICT DO NOTHING. REPLACED BY MIGRATION 090, which added ONE clause: '
  'it initializes profiles.active_org_id to the inviting organization ONLY IF that column '
  'is currently NULL. Set-if-null is not a switch - it is the first answer to a question '
  'the accepter has never been asked, and overwriting a stored value would be the '
  'misattribution resolveActingOrgId() exists to prevent.';


-- ---------------------------------------------------------------------
-- 5. GRANTS.
--
-- EVERY NEW FUNCTION NEEDS AN EXPLICIT REVOKE FROM anon BY NAME. REVOKE
-- ... FROM PUBLIC does NOT remove a direct grant, and a stock Supabase
-- project gives anon EXECUTE on functions in public through
-- pg_default_acl from both postgres and supabase_admin. This is the
-- mistake 088 made and 089 was written not to repeat.
--
-- set_active_org is the one function here that needs granting.
-- profiles_guard_active_org() is a TRIGGER function: it is invoked by
-- the trigger, not by a caller, and PostgreSQL does not check EXECUTE on
-- trigger functions. It is still revoked from PUBLIC and from anon by
-- name, because a trigger function is an ordinary function that happens
-- to return trigger and a direct call would be a way to reach a SECURITY
-- DEFINER body. It is granted to NOBODY - not even authenticated.
--
-- accept_org_invitation(text) IS NOT RE-GRANTED HERE ON PURPOSE. Its
-- ACL survived the CREATE OR REPLACE in section 4 exactly as 089 left
-- it, and re-issuing the grants would hide a DROP-then-CREATE mistake
-- rather than let V6 catch it.
--
-- service_role IS DELIBERATELY NOT GRANTED. It already holds EXECUTE by
-- the same default privilege, and V6 ASSERTS that inherited value rather
-- than this file writing a GRANT that pretends to have set it - which is
-- 082's precedent. NO SERVICE-ROLE CALLER EXISTS HERE and must not: the
-- switcher is session-client only.
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.set_active_org(uuid)             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_active_org(uuid)             FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_active_org(uuid)             TO authenticated;

REVOKE EXECUTE ON FUNCTION public.profiles_guard_active_org()      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.profiles_guard_active_org()      FROM anon;
REVOKE EXECUTE ON FUNCTION public.profiles_guard_active_org()      FROM authenticated;

COMMIT;


-- =====================================================================
-- 6. VERIFICATION. RUN AFTER APPLYING. READ ONLY, EXCEPT V8 AND V9,
--    WHICH ARE WRITES AND ARE MARKED. EXPECTED VALUES STATED.
--
-- These are commented out so they cannot run inside the transaction
-- above. Paste them into the SQL Editor one at a time, after the COMMIT
-- has landed.
-- =====================================================================
--
-- V1. THE COLUMN. Type and nullability, both asserted.
--
--       SELECT column_name, data_type, is_nullable, column_default
--       FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'profiles'
--         AND column_name = 'active_org_id';
--       -- EXPECTED: exactly 1 row.
--       --   data_type      = uuid
--       --   is_nullable    = YES
--       --   column_default = NULL   <- no default. Every value is chosen.
--
-- V2. THE FOREIGN KEY'S DELETE RULE. THE ONE THAT MATTERS MOST IN THIS
--     FILE: CASCADE here would mean deleting a company deletes people.
--
--       SELECT tc.constraint_name, rc.delete_rule,
--              ccu.table_name  AS references_table,
--              ccu.column_name AS references_column
--       FROM information_schema.table_constraints tc
--       JOIN information_schema.referential_constraints rc
--         ON rc.constraint_name = tc.constraint_name
--        AND rc.constraint_schema = tc.constraint_schema
--       JOIN information_schema.key_column_usage kcu
--         ON kcu.constraint_name = tc.constraint_name
--        AND kcu.constraint_schema = tc.constraint_schema
--       JOIN information_schema.constraint_column_usage ccu
--         ON ccu.constraint_name = tc.constraint_name
--        AND ccu.constraint_schema = tc.constraint_schema
--       WHERE tc.table_schema = 'public'
--         AND tc.table_name = 'profiles'
--         AND tc.constraint_type = 'FOREIGN KEY'
--         AND kcu.column_name = 'active_org_id';
--       -- EXPECTED: exactly 1 row.
--       --   delete_rule        = SET NULL      <- NOT CASCADE. NOT NO ACTION.
--       --   references_table   = organizations
--       --   references_column  = id
--       -- ANY OTHER delete_rule: roll this back with the down file and
--       -- fix it before anything writes the column.
--
-- V3. NO INDEX WAS CREATED ON IT, and none should be added later.
--
--       SELECT indexname, indexdef FROM pg_indexes
--       WHERE schemaname = 'public' AND tablename = 'profiles'
--         AND indexdef ILIKE '%active_org_id%';
--       -- EXPECTED: 0 rows. See the header for why. If this ever returns
--       -- a row, somebody added an index for a query nothing asks.
--
-- V4. THE TRIGGER EXISTS AND IS ENABLED.
--     (Delete V4 and V5 if you removed section 2.)
--
--       SELECT t.tgname, t.tgenabled, t.tgtype, p.proname
--       FROM pg_trigger t
--       JOIN pg_class c ON c.oid = t.tgrelid
--       JOIN pg_proc  p ON p.oid = t.tgfoid
--       WHERE c.relname = 'profiles' AND NOT t.tgisinternal
--         AND t.tgname = 'profiles_active_org_guard';
--       -- EXPECTED: exactly 1 row.
--       --   tgenabled = O   <- enabled, origin. Not D (disabled).
--       --   proname   = profiles_guard_active_org
--
-- V5. THE TRIGGER ACTUALLY BITES. A WRITE. RUN IT, THEN ROLL IT BACK.
--
--       BEGIN;
--         -- Pick any profile id that exists.
--         UPDATE public.profiles
--            SET active_org_id = '00000000-0000-0000-0000-000000000000'
--          WHERE id = (SELECT id FROM public.profiles LIMIT 1);
--       ROLLBACK;
--       -- EXPECTED: the UPDATE fails with SQLSTATE LG005 and the message
--       -- "That is not an organization you belong to." If it SUCCEEDS,
--       -- the trigger is not firing and section 2 bought nothing - the
--       -- ROLLBACK still undoes it, so nothing is left behind either way.
--       -- Note this runs as the SQL Editor's role with no auth.uid(), and
--       -- it is still refused: the guard is a row invariant, not a
--       -- caller check. That is the point of it.
--
-- V6. THE GRANTS. THE ONE THAT CATCHES THE 088 MISTAKE, AND THE ONE THAT
--     CATCHES A DROP-THEN-CREATE IN SECTION 4.
--
--       SELECT 'set_active_org' AS fn,
--              has_function_privilege('anon',          'public.set_active_org(uuid)', 'EXECUTE') AS anon,
--              has_function_privilege('authenticated', 'public.set_active_org(uuid)', 'EXECUTE') AS authenticated,
--              has_function_privilege('service_role',  'public.set_active_org(uuid)', 'EXECUTE') AS service_role
--       UNION ALL
--       SELECT 'accept_org_invitation',
--              has_function_privilege('anon',          'public.accept_org_invitation(text)', 'EXECUTE'),
--              has_function_privilege('authenticated', 'public.accept_org_invitation(text)', 'EXECUTE'),
--              has_function_privilege('service_role',  'public.accept_org_invitation(text)', 'EXECUTE')
--       UNION ALL
--       SELECT 'decline_org_invitation',
--              has_function_privilege('anon',          'public.decline_org_invitation(text)', 'EXECUTE'),
--              has_function_privilege('authenticated', 'public.decline_org_invitation(text)', 'EXECUTE'),
--              has_function_privilege('service_role',  'public.decline_org_invitation(text)', 'EXECUTE')
--       UNION ALL
--       SELECT 'profiles_guard_active_org',
--              has_function_privilege('anon',          'public.profiles_guard_active_org()', 'EXECUTE'),
--              has_function_privilege('authenticated', 'public.profiles_guard_active_org()', 'EXECUTE'),
--              has_function_privilege('service_role',  'public.profiles_guard_active_org()', 'EXECUTE');
--       -- EXPECTED, row by row:
--       --   set_active_org             anon=f  authenticated=t  service_role=t
--       --   accept_org_invitation      anon=f  authenticated=t  service_role=t
--       --     ^ THE REPLACE MUST NOT HAVE CHANGED THIS. anon=t here means
--       --       section 4 was applied as DROP-then-CREATE and anon now has
--       --       EXECUTE on the function that writes org_members. Re-issue
--       --       089's three REVOKE ... FROM anon statements immediately.
--       --   decline_org_invitation     anon=f  authenticated=t  service_role=t
--       --     ^ untouched by this file; it is here as the control.
--       --   profiles_guard_active_org  anon=f  authenticated=f  service_role=t
--       --     ^ authenticated=f is correct and deliberate. Trigger
--       --       functions are invoked by the trigger, not by a caller,
--       --       and EXECUTE is not checked for them.
--       -- service_role=t is INHERITED from pg_default_acl and is NOT set
--       -- by this file - 082's precedent. An f there is not a defect of
--       -- this migration.
--
-- V7. THE FUNCTIONS ARE SHAPED THE WAY THIS FILE SAYS.
--
--       SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('set_active_org','profiles_guard_active_org',
--                           'accept_org_invitation','decline_org_invitation')
--       ORDER BY p.proname;
--       -- EXPECTED: 4 rows, prosecdef = t on all four, proconfig =
--       -- {"search_path=public, pg_temp"} on all four.
--
-- V8. THE POLICY COUNT. PREDICTED FROM 117, AND PREDICTED TO NOT MOVE.
--
--       SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--       -- EXPECTED: 117.
--       -- 089 left 117. THIS FILE ADDS NO POLICY AND DROPS NONE, so 117
--       -- is both the before and the after. Anything else means
--       -- something moved between 089's verification and this apply, and
--       -- it is worth finding before proceeding.
--
--       SELECT policyname, cmd, roles FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'profiles'
--       ORDER BY cmd, policyname;
--       -- EXPECTED: unchanged from before this apply, and in particular
--       -- exactly ONE row with cmd = 'UPDATE', named "Users can update
--       -- own profile". If a second UPDATE policy has appeared,
--       -- somebody added the policy section 2's header argues against.
--
-- V9. NOBODY WAS BACKFILLED.
--
--       SELECT count(*) AS total,
--              count(active_org_id) AS with_a_hint
--       FROM public.profiles;
--       -- EXPECTED: with_a_hint = 0, immediately after this apply. The
--       -- first non-zero value arrives when somebody accepts an
--       -- invitation or uses the switcher.
--
-- V10. THE SET-IF-NULL CLAUSE IS ACTUALLY IN THE LIVE FUNCTION.
--      Cheaper than reading 138 lines of prosrc.
--
--       SELECT position('active_org_id IS NULL' IN p.prosrc) > 0 AS has_set_if_null,
--              position('SET active_org_id = v_inv.org_id' IN p.prosrc) > 0 AS has_the_update
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'accept_org_invitation';
--       -- EXPECTED: both t. Both f means section 4 did not run.
--       -- has_the_update = t with has_set_if_null = f would mean the
--       -- guard clause was dropped and accept OVERWRITES a stored
--       -- choice - roll back with the down file at once.
