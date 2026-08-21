-- =====================================================================
-- Migration 091: the profiles authority-column guard.
--                090 stopped a browser writing an organization it does
--                not belong to. This stops a browser writing its own
--                entitlement.
--
--   NEW   public.profiles_guard_authority_columns()  -> trigger
--   NEW   trigger profiles_authority_columns_guard   BEFORE UPDATE ON profiles
--
--   POLICIES ADDED: NONE. DROPPED: NONE. Count stays at 117.
--   COLUMNS ADDED: NONE. This migration creates no column and alters no
--   table. It adds one function and one trigger.
--
--   "Users can update own profile" IS NOT TOUCHED, AND MUST NOT BE. See
--   THE POLICY IS NOT THE ANSWER below for the reason, which is the same
--   reason 087 and 090 both reached for a trigger.
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- This file is AUTHORED, NOT APPLIED. The session that wrote it executed
-- no statement against any database and holds no credential that could.
-- It is applied by Greg, by hand, in the Supabase SQL Editor.
--
-- THIS ONE IS DIFFERENT FROM 089 AND 090 AND THE DIFFERENCE DECIDES THE
-- PROCEDURE. Those two were ADDITIVE - a column, a function, a trigger
-- enforcing an invariant nothing had ever violated. THIS FILE CAN REFUSE
-- A WRITE THAT WORKS TODAY. A dry run that proves the file parses is
-- therefore NOT SUFFICIENT EVIDENCE THAT IT IS SAFE TO APPLY.
--
-- RUN docs/091-preapply-test.sql FIRST. It is one paste. It BEGINs, runs
-- this entire migration, impersonates a real profile through
-- request.jwt.claims, exercises a legitimate settings save, a portal
-- switch, a no-op write and a self-grant of every guarded column, and
-- then ROLLBACKs. Nothing persists. It is the only artifact in this
-- change that answers "does this break anything that works".
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE 373
-- and an explicit COMMIT; on LINE 545. Those are the only EXECUTABLE
-- occurrences of either word.
--
-- TO DRY RUN: change the COMMIT; on line 545 to ROLLBACK; and run the
-- whole file. Every statement executes, every error surfaces, nothing
-- persists. Verify the line numbers before trusting them, with:
--
--     grep -n -i '^begin\|^commit\|^rollback' \
--       supabase/migrations/091_profiles_column_guard.sql
--
-- THAT GREP RETURNS THREE HITS, AND THREE IS CORRECT:
--     373  BEGIN;    <- executable. The transaction.
--     393  BEGIN     <- plpgsql, profiles_guard_authority_columns's body.
--                       No semicolon; matched by the case-insensitive
--                       form only, not a transaction statement.
--     545  COMMIT;   <- executable. The one to swap for ROLLBACK;.
-- Exactly one line ends in `BEGIN;` and exactly one in `COMMIT;`.
-- If your grep shows a different set, this is not the file that was read.
--
-- Do NOT verify with grep -n '^BEGIN;$'. That anchored form has produced
-- false negatives in this repository and 087 nearly burned a dry run on
-- exactly that.
--
-- THE VERIFICATION BLOCK IS AFTER THE COMMIT, DELIBERATELY, and it is
-- entirely commented out. A dry run therefore stops at the COMMIT line
-- and executes none of it. Paste those queries in afterwards, one at a
-- time.
--
-- "Success. No rows returned" IN THE SQL EDITOR PROVES NOTHING ON ITS
-- OWN. It is the identical message for a dry run that rolled everything
-- back, for a real apply that committed, and for a correct file pasted
-- into the wrong project's tab. The VERIFICATION block at the foot is
-- the only thing that distinguishes them. Run it.
--
-- Sequence, no step skipped:
--   1. Run docs/091-preapply-test.sql. Read every PASS line.
--   2. Dry run THIS file: COMMIT -> ROLLBACK, run, confirm no errors,
--      put it back.
--   3. Run for real.
--   4. Run VERIFICATION. Every query states its expected value.
--   5. Only then update the migrations table in LIGAMENT_CONTEXT.md, and
--      add the authority set to that row - see ROT below.
--
-- ORDERING AGAINST THE CODE: NONE. THIS FILE IS INDEPENDENT OF EVERY
-- DEPLOY. It adds no column, so nothing can 42703; it changes no
-- function any route calls. Apply it before the code, after the code, or
-- with no code change at all. The Phase 3 and Phase 4 commits on this
-- branch do not depend on it and it does not depend on them.
--
-- =====================================================================
-- WHY THIS EXISTS, IN ONE PARAGRAPH
-- =====================================================================
--
-- The profiles UPDATE policy is "Users can update own profile", cmd
-- UPDATE, roles {public}, qual (auth.uid() = id), with_check NULL.
-- Postgres substitutes USING for a missing WITH CHECK on UPDATE, so the
-- ONLY condition on the new row is that it is still your own row.
-- NOTHING EXAMINES WHICH COLUMNS MOVED. An authenticated user can
-- therefore PATCH their own profiles row through PostgREST with
-- {"is_paid": true} and grant themselves the paid entitlement that ten
-- server-side gates and the entire agency layout read. Same for
-- is_admin, which grants the admin panel and a bypass in every
-- entitlement function; same for email, which 089's
-- current_user_email() reads and accept_org_invitation compares an
-- invitation address against.
--
-- =====================================================================
-- THE POLICY IS NOT THE ANSWER. DO NOT REACH FOR ONE.
-- =====================================================================
--
-- The instinct is to add a WITH CHECK to the profiles UPDATE policy.
-- IT CANNOT WORK, and the reason is structural rather than a matter of
-- getting the expression right:
--
--   WITH CHECK HAS NO OLD. It sees only the proposed row. "is_paid did
--   not change" is a statement about two rows, and a WITH CHECK can only
--   make statements about one. There is no expression - none, at any
--   length - that expresses column immutability in a WITH CHECK.
--
-- That is 087's stated reason for reaching for a trigger and it applies
-- here identically. A WITH CHECK could say "is_paid IS FALSE", which is
-- a different and wrong rule: it would refuse every paying user's
-- settings save.
--
-- THE COLUMN-LEVEL GRANT IS NOT THE ANSWER EITHER, and 090 already spent
-- the afternoon so nobody repeats it (090_active_org.sql:286):
-- REVOKE UPDATE (is_paid) ON public.profiles FROM authenticated is a
-- NO-OP while that role holds table-level UPDATE. Making it bite means
-- revoking table-level UPDATE and re-granting an explicit list of the
-- other 43 columns, and getting that list one column short silently
-- breaks a settings page.
--
-- SO THE GUARD IS A TRIGGER. Same conclusion as 087 and 090, reached the
-- same way.
--
-- =====================================================================
-- THE CRITICAL DIFFERENCE FROM 090'S SIBLING GUARD. READ THIS BEFORE
-- CHANGING THE FUNCTION BODY.
-- =====================================================================
--
-- 090's profiles_guard_active_org() is DELIBERATELY CALLER-INDEPENDENT.
-- Its header says so in as many words: it "reads auth.uid() nowhere,
-- which is what makes it independent of who is connected", because
-- "active_org_id names an organization this profile is a member of" is a
-- fact about the ROW. It holds for a session client, for service_role,
-- for a migration and for the SQL Editor alike, and that is its strength.
--
-- THIS GUARD IS THE EXACT OPPOSITE AND MUST BE. "May this actor change
-- this column" is a fact about the ACTOR, not about the row. There is no
-- row invariant to state: is_paid = true is a perfectly valid row. What
-- is not valid is a BROWSER putting it there.
--
-- Which means service_role and postgres MUST be exempt, or this file
-- breaks app/api/admin/users/[userId]/flags/route.ts,
-- app/api/admin/grant-access/route.ts, handle_new_user() and every
-- future migration that touches a profile.
--
-- THAT IS ALSO WHY THIS IS A SECOND TRIGGER RATHER THAN AN EXTENSION OF
-- 090's. Folding a caller test into a function whose own header argues
-- for having none produces a body that contradicts its documentation.
-- 090:317 states separability as a written property - "delete this
-- entire section 2, and the migration is still coherent" - and extending
-- it would destroy that. Two triggers also keep both down files honest:
-- this one drops what it created, and never has to restore somebody
-- else's body verbatim. Full argument in docs/091-guard-shape.md.
--
-- THE TWO TRIGGERS ARE ORDER-INDEPENDENT. Both are BEFORE UPDATE FOR
-- EACH ROW and Postgres fires them in trigger-name order, so
-- profiles_active_org_guard runs first ('c' < 'u'). NEITHER MODIFIES
-- NEW. Each either returns NEW unchanged or RAISEs, so the pair
-- commutes.
--
-- =====================================================================
-- THE EXEMPTION TEST: auth.uid() IS NULL. CHOSEN, NOT ASSUMED.
-- =====================================================================
--
-- Four candidates were considered and they are NOT equivalent.
--
-- current_user     REJECTED. Inside a SECURITY DEFINER function it is
--                  the function's OWNER, so it is a constant and would
--                  exempt everything. Making it meaningful needs
--                  SECURITY INVOKER - and even then it classifies
--                  handle_new_user() correctly only if that function's
--                  owner is a role this file's exemption list happens to
--                  name. Function ownership is not derivable from the
--                  repository. A test whose correctness depends on an
--                  unqueryable fact is the wrong test for a guard that
--                  can refuse existing writes.
--
-- session_user     REJECTED. PostgREST connects as `authenticator` and
--                  then issues SET LOCAL ROLE, which moves current_user
--                  and leaves session_user alone. So session_user is
--                  `authenticator` for a browser AND for the service
--                  role. It cannot separate the two cases at all.
--
-- auth.role()      REJECTED. It reads the JWT `role` claim, which
--                  PostgREST has ALREADY consumed to choose the database
--                  role - so it answers the same question one step
--                  further from the evidence, and needs a string compare
--                  where auth.uid() needs a null test. Strictly weaker,
--                  no benefit.
--
-- auth.uid() IS NULL   CHOSEN. It depends on no ownership fact, so its
--                  behaviour for every writer is derivable from source.
--                  It is already live and verified in this schema -
--                  set_active_org calls it (090:466) and 090 is applied.
--
-- WHAT IT DOES UNDER EACH WRITER. Walked one at a time against the
-- census in docs/091-profiles-writer-census.md. All thirty pass.
--
--   SESSION CLIENT, browser or server route (25 of the 30 writers -
--   both settings-user pages, both profile pages, partner/legal,
--   api/profile, switch-role, active-role, partner/rfps/claim,
--   rate-info, company-identity, the auth-callback UPDATE branch,
--   grant-agency-access): auth.uid() is the signed-in user, so the
--   guard is ACTIVE - and every one of them PASSES on the early return,
--   because not one writes a guarded column. Checked column by column,
--   not assumed.
--
--   THE PORTAL SWITCH SPECIFICALLY (api/profile/switch-role:43 and :67,
--   api/user/active-role:48, api/partner/rfps/claim:110, and the
--   auth-callback correction at :88): these write active_role, role and
--   secondary_role. NONE OF THE THREE IS GUARDED, deliberately - see
--   docs/091-guard-shape.md section 2 - so "Switch to Vendor Mode"
--   leaves on the early return. Test T3 in the pre-apply block proves it
--   rather than asserting it.
--
--   SERVICE ROLE (admin/users/[userId]/flags:118 and
--   admin/grant-access:166): a service_role JWT carries no `sub` claim,
--   so auth.uid() is NULL and the guard EXEMPTS them. These are the two
--   writers that legitimately move is_paid, is_admin and demo_access,
--   and they are the reason an exemption exists at all.
--
--   handle_new_user()'s ON CONFLICT (id) DO UPDATE (079:1877). THIS IS
--   THE ROW THE WHOLE ANALYSIS TURNS ON AND IT IS EASY TO MISS: an
--   ON CONFLICT DO UPDATE IS AN UPDATE, so this trigger fires on it, and
--   it writes email, which IS guarded. It fires from AFTER INSERT ON
--   auth.users, and an auth.users INSERT is never performed by an
--   end-user session - there is no JWT during a signup by definition. So
--   auth.uid() is NULL and it is EXEMPT. If this were wrong, every
--   re-fired signup trigger would raise.
--
--   THE TWO INSERTS THAT WRITE GUARDED COLUMNS - auth/callback:23
--   (email, is_admin) and handle_new_user's own INSERT (079:1864,
--   email) - are not affected at all. This is a BEFORE UPDATE trigger
--   and it does not fire on an INSERT.
--
--   A MIGRATION OR THE SQL EDITOR: no request.jwt.claims, auth.uid() is
--   NULL, EXEMPT. Which is what makes this file, and every file after
--   it, able to touch a profile.
--
-- WHERE THIS DIFFERS FROM current_user, STATED SO IT IS A CHOICE AND NOT
-- AN ACCIDENT: a SECURITY DEFINER function called BY A SESSION CLIENT
-- keeps that session's auth.uid(), so it stays GUARDED, where
-- current_user would have exempted it wholesale. THAT IS THE BEHAVIOUR
-- TO WANT. It means a future RPC cannot become a laundering path for an
-- authority column unless somebody deliberately writes an exemption into
-- it. It costs nothing today: set_active_org (090:490) and
-- accept_org_invitation (090:703) write only active_org_id, so both
-- leave on the early return and never reach the test.
--
-- ONE OPERATIONAL NOTE, NOT A DEFECT. The Supabase SQL Editor's
-- role-impersonation feature sets request.jwt.claims, so a statement run
-- under impersonation IS guarded. That is correct - you asked to be that
-- user - and it is exactly the mechanism docs/091-preapply-test.sql uses
-- to prove the refusals.
--
-- =====================================================================
-- THE AUTHORITY SET, AND ROT
-- =====================================================================
--
-- FIVE COLUMNS:  is_paid, is_admin, demo_access, email, linked_agency_id
--
-- DENY-LIST, NOT PERMIT-LIST, AND THE COUNT IS THE ARGUMENT. profiles
-- has 44 columns. 37 of them are ordinary profile content a user edits
-- from a settings form, across 24 session-client write sites. A permit
-- list is 37 entries where ONE OMISSION SILENTLY BREAKS A SAVE - the
-- exact shape app/api/profile/route.ts:35 records having shipped for two
-- migrations with personal_linkedin_url. This deny-list is five entries
-- whose only failure mode is that a FUTURE privilege column goes
-- unguarded. Adding a privilege column is a deliberate act. Adding `bio`
-- is not.
--
-- >>> THE ROT INSTRUCTION. THIS IS THE ONE THING TO CARRY FORWARD. <<<
--
--   THE SET LIVES IN EXACTLY TWO PLACES IN THIS FILE AND NOWHERE ELSE:
--   the IS NOT DISTINCT FROM chain in the early return, and the
--   IS DISTINCT FROM blocks below it, in the same order. Plus the
--   COMMENT ON FUNCTION, which repeats it so a pg_proc query can answer
--   "what is guarded" without opening a .sql file.
--
--   ANY NEW COLUMN ON public.profiles THAT GRANTS ANYTHING - access, a
--   role, a billing state, a claim on another entity - MUST JOIN THIS
--   SET IN THE SAME MIGRATION THAT CREATES IT. Not in a follow-up. A
--   privilege column that ships unguarded is self-grantable from a
--   browser the moment it exists, because "Users can update own profile"
--   is table-wide and RLS has no column granularity.
--
--   Reasoning for each of the five, and for the four columns that were
--   considered and LEFT OUT (role, active_role, secondary_role,
--   is_discoverable - all four have live session-client writers), is in
--   docs/091-guard-shape.md section 2, with the census line for each.
--
-- WHY email IS IN THE SET, since it is the least obvious. 089's
-- current_user_email() reads profiles.email, and accept_org_invitation
-- compares the invitation address against it. A self-writable email
-- means a user sets it to any address and accepts an invitation issued
-- to that address, gated by nothing but token secrecy. It also lets
-- profiles.email diverge from auth.users.email permanently - there is no
-- reconciler anywhere in the repository. No session client writes it on
-- an UPDATE path today; the only UPDATE writer is handle_new_user, which
-- is exempt.
--
-- WHY linked_agency_id IS IN THE SET. It has ZERO writers and zero real
-- readers - the only read in the tree lands on a context field no
-- component consumes (docs/091-profiles-writer-census.md, CENSUS-2). So
-- guarding it cannot refuse a legitimate write, and it is a uuid naming
-- another entity on a self-writable row, which is a relationship claim
-- rather than profile content. It is inert only because nothing consumes
-- it yet. SEPARATELY RECOMMENDED: a later migration should DROP this
-- column, and take its guard entry with it.
--
-- =====================================================================
-- THE ERROR, AND WHETHER IT TEACHES AN ATTACKER THE SCHEMA.
-- ASSESSED, NOT ASSUMED - the way 090 assessed set_active_org.
-- =====================================================================
--
-- ERRCODE IS 'LG007'. The next free code: 089 used LG001-LG004, 090
-- added LG005 and LG006. Confirmed by grep over supabase/ and lib/.
--
-- THE API LAYER SHOULD MAP LG007 TO 403. Not 400 - the request was
-- well-formed and the caller is not permitted to make it. Not 500 - it
-- is a refusal, not a fault. The existing map is
-- lib/org-invitations.ts:77 (LG001->404, LG002->401, LG003->409,
-- LG004->410) and that is where an LG007 entry belongs.
--
-- NO API ROUTE IS CHANGED BY THIS MIGRATION, DELIBERATELY. Nothing in
-- the product raises LG007 on any path a user can reach without trying
-- to, so there is no broken surface to repair. Wiring the mapping is its
-- own change, and doing it here would mean shipping a route change whose
-- only test is a database that has not been applied yet.
--
-- THE MESSAGE NAMES THE COLUMN, IN DETAIL, AND NEVER A VALUE. Both
-- halves are deliberate.
--
-- WHAT AN ATTACKER LEARNS FROM A REFUSAL: which of the columns THEY JUST
-- NAMED IN THEIR OWN REQUEST is guarded. They supplied the column name;
-- it is handed back to them. And the schema is not a secret in the first
-- place - PostgREST publishes the full profiles column list to any
-- authenticated caller through its OpenAPI document at /rest/v1/. There
-- is nothing here to enumerate that a single GET does not already give
-- up.
--
-- WHY IT IS WORTH NAMING IT ANYWAY: the highest-probability real event
-- is not an attack, it is a legitimate writer tripping this guard on a
-- path nobody traced. That is the 087 lesson - 087's own header was
-- wrong about which paths its trigger fired on. A DETAIL that names the
-- column turns that investigation into a two-minute read.
--
-- WHAT IS NEVER INTERPOLATED, AND THIS IS THE LINE THAT MUST NOT BE
-- "IMPROVED": THE VALUES. Not OLD, not NEW. "You cannot change is_paid
-- from false to true" would confirm the current state of a column to a
-- caller who may not be able to read it, and turn a refusal into an
-- oracle. The DETAIL strings below are FIXED LITERALS with no format
-- specifier of any kind.
--
-- THE MESSAGE IS THE SAME SENTENCE FOR ALL FIVE COLUMNS. Only the DETAIL
-- differs. A user who reaches this has done something the interface does
-- not offer, so the copy is a plain refusal rather than an explanation
-- of a mechanism they should not have found.
-- ---------------------------------------------------------------------


BEGIN;


-- ---------------------------------------------------------------------
-- 1. public.profiles_guard_authority_columns() -> trigger
--
-- SECURITY DEFINER matches 090's sibling. NOTE THAT IT IS NOT
-- LOAD-BEARING HERE: this body reads no table and calls no policy-scoped
-- query, so DEFINER and INVOKER would behave identically. It is stated
-- because it is exactly WHY current_user cannot be the exemption test -
-- under DEFINER, current_user is the owner and nothing else.
--
-- SET search_path = public, pg_temp, as every function in 089 and 090.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_guard_authority_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- THE EARLY RETURN THAT MAKES THIS FREE, AND IT IS FIRST ON PURPOSE.
  -- Every UPDATE on profiles that does not move one of these five - which
  -- today is 25 of the 30 writers in the census, including every settings
  -- save and every portal switch - leaves here having done five
  -- comparisons and NOT having called auth.uid(). The common path is a
  -- browser saving a profile and it should not pay for the caller test.
  --
  -- IS NOT DISTINCT FROM, never <>: a read-modify-write that sends the
  -- same value back must pass, and null <> null is null, which is not
  -- true, which would fall through to the refusal. Both settings forms
  -- send whole payloads read from the row, so this is the normal case and
  -- not an edge one.
  --
  -- THE AUTHORITY SET, PLACE 1 OF 2. See the ROT instruction in the
  -- header before adding to it.
  IF  NEW.is_paid          IS NOT DISTINCT FROM OLD.is_paid
  AND NEW.is_admin         IS NOT DISTINCT FROM OLD.is_admin
  AND NEW.demo_access      IS NOT DISTINCT FROM OLD.demo_access
  AND NEW.email            IS NOT DISTINCT FROM OLD.email
  AND NEW.linked_agency_id IS NOT DISTINCT FROM OLD.linked_agency_id
  THEN
    RETURN NEW;
  END IF;

  -- THE EXEMPTION. A write with no end-user session behind it is trusted
  -- code that has already made its own authorization decision: the two
  -- admin routes on the service role, handle_new_user's ON CONFLICT DO
  -- UPDATE, this migration, and every migration after it. See the header
  -- for why this test and not current_user, session_user or auth.role().
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- FROM HERE DOWN: a signed-in caller moved a guarded column. RAISE,
  -- never silently revert to OLD. A silent revert would leave a browser
  -- believing it had been granted access while every gate went on
  -- refusing - which is the same class of quiet wrongness 090 refused for
  -- its own column, delivered to a different reader.
  --
  -- THE AUTHORITY SET, PLACE 2 OF 2. Same order as the chain above.
  -- Every DETAIL below is a FIXED LITERAL. No value is ever interpolated
  -- into any of them - see the oracle assessment in the header.
  IF NEW.is_paid IS DISTINCT FROM OLD.is_paid THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG007',
            DETAIL  = 'profiles.is_paid is an authority column guarded by migration 091. Only the service role, a database function, or a migration may write it.';
  END IF;

  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG007',
            DETAIL  = 'profiles.is_admin is an authority column guarded by migration 091. Only the service role, a database function, or a migration may write it.';
  END IF;

  IF NEW.demo_access IS DISTINCT FROM OLD.demo_access THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG007',
            DETAIL  = 'profiles.demo_access is an authority column guarded by migration 091. Only the service role, a database function, or a migration may write it.';
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG007',
            DETAIL  = 'profiles.email is an authority column guarded by migration 091. It is read by current_user_email() and compared against invitation addresses by accept_org_invitation(). Only the service role, a database function, or a migration may write it.';
  END IF;

  IF NEW.linked_agency_id IS DISTINCT FROM OLD.linked_agency_id THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG007',
            DETAIL  = 'profiles.linked_agency_id is an authority column guarded by migration 091. Only the service role, a database function, or a migration may write it.';
  END IF;

  -- UNREACHABLE BY CONSTRUCTION: the early return covers every case where
  -- none of the five moved, and the five blocks above cover every case
  -- where one did. It is here so that adding a column to the chain above
  -- and forgetting to add its RAISE below fails LOUDLY rather than
  -- silently permitting the write.
  RAISE EXCEPTION 'That is not a field you can change.'
    USING ERRCODE = 'LG007',
          DETAIL  = 'A guarded column on profiles moved but migration 091 has no refusal for it. The authority set in profiles_guard_authority_columns() is out of step with itself - see the ROT instruction in 091_profiles_column_guard.sql.';
END;
$$;

COMMENT ON FUNCTION public.profiles_guard_authority_columns() IS
  'BEFORE UPDATE guard on the profiles AUTHORITY SET: is_paid, is_admin, '
  'demo_access, email, linked_agency_id. Refuses with LG007 when a caller that '
  'HAS an end-user session (auth.uid() IS NOT NULL) moves one of them. Exempts '
  'service_role, postgres, migrations and handle_new_user, all of which resolve '
  'auth.uid() to NULL - without that exemption the admin flags route, '
  'grant-access and every future migration would break. Returns immediately when '
  'none of the five moved, which is every settings save and every portal switch. '
  'It exists because "Users can update own profile" is table-wide with a NULL '
  'with_check, RLS has no column granularity, and a WITH CHECK has no OLD so it '
  'cannot express column immutability. DELIBERATELY THE OPPOSITE OF 090''s '
  'profiles_guard_active_org(), which reads auth.uid() nowhere because its rule '
  'is a fact about the ROW; this rule is a fact about the ACTOR. ANY NEW '
  'PRIVILEGE COLUMN ON profiles MUST JOIN THIS SET IN THE MIGRATION THAT CREATES '
  'IT. See docs/091-guard-shape.md.';


-- ---------------------------------------------------------------------
-- 2. The trigger.
--
-- DROP IF EXISTS then CREATE, so re-running this file is idempotent.
-- That is safe for a TRIGGER in a way it is not for a FUNCTION: a
-- trigger has no ACL to lose. The function above is CREATE OR REPLACE
-- for the opposite reason - see section 3.
--
-- 090's profiles_active_org_guard IS NOT TOUCHED. Two BEFORE UPDATE
-- triggers on one table is legal; they fire in trigger-name order, so
-- profiles_active_org_guard runs first. Neither modifies NEW, so the
-- order does not matter and stating it is documentation rather than a
-- dependency.
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS profiles_authority_columns_guard ON public.profiles;

CREATE TRIGGER profiles_authority_columns_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_authority_columns();


-- ---------------------------------------------------------------------
-- 3. GRANTS.
--
-- EVERY NEW FUNCTION NEEDS AN EXPLICIT REVOKE FROM anon BY NAME. REVOKE
-- ... FROM PUBLIC does NOT remove a direct grant, and a stock Supabase
-- project gives anon EXECUTE on functions in public through pg_default_acl
-- from BOTH postgres and supabase_admin. This is the mistake 088 made,
-- 089 was written not to repeat, and 090 repeated the fix for.
--
-- CREATE OR REPLACE above preserves an ACL; DROP THEN CREATE would
-- re-grant anon from that default privilege. If this function is ever
-- dropped and recreated, THESE THREE STATEMENTS MUST COME WITH IT.
--
-- IT IS GRANTED TO NOBODY - not even authenticated. It is a TRIGGER
-- function: it is invoked by the trigger, not by a caller, and
-- PostgreSQL does not check EXECUTE on trigger functions. It is still
-- revoked by name because a trigger function is an ordinary function
-- that happens to return trigger, and a direct call would be a way to
-- reach a SECURITY DEFINER body. Exactly 090's treatment of
-- profiles_guard_active_org().
--
-- service_role IS DELIBERATELY NOT GRANTED. It holds EXECUTE by the same
-- default privilege and V5 ASSERTS that inherited value rather than this
-- file writing a GRANT that pretends to have set it - 082's precedent.
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.profiles_guard_authority_columns() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.profiles_guard_authority_columns() FROM anon;
REVOKE EXECUTE ON FUNCTION public.profiles_guard_authority_columns() FROM authenticated;

COMMIT;


-- =====================================================================
-- 4. VERIFICATION. RUN AFTER APPLYING. READ ONLY, EXCEPT V6, WHICH IS A
--    WRITE AND IS MARKED. EXPECTED VALUES STATED.
--
-- These are commented out so they cannot run inside the transaction
-- above, and so a dry run stops at the COMMIT line. Paste them into the
-- SQL Editor one at a time, after the COMMIT has landed.
-- =====================================================================
--
-- V1. THE FUNCTION EXISTS, IS SECURITY DEFINER, AND HAS ITS search_path.
--
--       SELECT p.proname, p.prosecdef, p.proconfig
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname = 'profiles_guard_authority_columns';
--       -- EXPECTED: exactly 1 row.
--       --   prosecdef = t
--       --   proconfig = {"search_path=public, pg_temp"}
--
-- V2. THE TRIGGER EXISTS, IS ENABLED, AND POINTS AT THAT FUNCTION.
--
--       SELECT t.tgname, t.tgenabled, p.proname
--       FROM pg_trigger t
--       JOIN pg_class c ON c.oid = t.tgrelid
--       JOIN pg_proc  p ON p.oid = t.tgfoid
--       WHERE c.relname = 'profiles' AND NOT t.tgisinternal
--       ORDER BY t.tgname;
--       -- EXPECTED: exactly 3 rows, in this order:
--       --   notify-new-user                   <- pre-existing AFTER INSERT webhook
--       --   profiles_active_org_guard         <- 090's. tgenabled = O
--       --   profiles_authority_columns_guard  <- THIS FILE. tgenabled = O
--       --                                        proname = profiles_guard_authority_columns
--       -- A FOURTH ROW means somebody added a trigger to this table that
--       -- neither 090 nor 091 knows about, and it fires on the same
--       -- writes. Find it before trusting either guard.
--       -- tgenabled = D on any row means that trigger is DISABLED and
--       -- buying nothing.
--
-- V3. THE POLICY WAS NOT TOUCHED. THE MOST IMPORTANT READ-ONLY CHECK IN
--     THIS FILE, because the whole argument above is that the policy is
--     the wrong instrument - so if it moved, somebody reached for it
--     anyway.
--
--       SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--       WHERE schemaname='public' AND tablename='profiles' AND cmd='UPDATE';
--       -- EXPECTED: exactly 1 row, byte-identical to before this apply:
--       --   "Users can update own profile", UPDATE, {public},
--       --   (auth.uid() = id), with_check NULL
--       -- A SECOND ROW, or a non-null with_check, means the thing this
--       -- migration exists to avoid was done as well. Roll it back.
--
--       SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--       -- EXPECTED: 117. 090 left 117. THIS FILE ADDS NO POLICY AND
--       -- DROPS NONE, so 117 is both the before and the after.
--
-- V4. THE AUTHORITY SET IN THE LIVE FUNCTION MATCHES THIS FILE.
--     THE ROT CHECK. Re-run it any time you wonder whether the database
--     and the repository still agree.
--
--       SELECT c AS guarded_column,
--              p.prosrc ~ ('NEW\.' || c || '\s+IS NOT DISTINCT FROM') AS in_early_return,
--              p.prosrc ~ ('NEW\.' || c || '\s+IS DISTINCT FROM')     AS has_a_refusal
--       FROM pg_proc p
--       JOIN pg_namespace n ON n.oid = p.pronamespace,
--            unnest(ARRAY['is_paid','is_admin','demo_access','email','linked_agency_id']) AS c
--       WHERE n.nspname = 'public'
--         AND p.proname = 'profiles_guard_authority_columns';
--       -- EXPECTED: 5 rows, both columns t on every one.
--       -- REGEX, NOT position(). The early-return chain is COLUMN-ALIGNED,
--       -- so 'NEW.is_paid IS NOT DISTINCT FROM' with one space matches
--       -- nothing and a position() form would report every column
--       -- unguarded on a function that is perfectly correct.
--       -- \s+ absorbs the padding; realigning the chain cannot break it.
--       -- in_early_return = t with has_a_refusal = f means a column can
--       -- fall through to the catch-all RAISE. f/f means it is not
--       -- guarded at all and the live function is older than this file.
--
--       SELECT (length(p.prosrc) - length(replace(p.prosrc, 'IS DISTINCT FROM', ''))) / length('IS DISTINCT FROM') AS refusal_count
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'profiles_guard_authority_columns';
--       -- EXPECTED: 5. Counts only the bare form; the five
--       -- "IS NOT DISTINCT FROM" occurrences do not match this substring.
--       -- A SIXTH means a column was added to the refusals and not to
--       -- the array in the query above - update the query, not the
--       -- function.
--
-- V5. THE GRANTS. THE ONE THAT CATCHES THE 088 MISTAKE.
--
--       SELECT has_function_privilege('anon',          'public.profiles_guard_authority_columns()', 'EXECUTE') AS anon,
--              has_function_privilege('authenticated', 'public.profiles_guard_authority_columns()', 'EXECUTE') AS authenticated,
--              has_function_privilege('service_role',  'public.profiles_guard_authority_columns()', 'EXECUTE') AS service_role;
--       -- EXPECTED: anon = f, authenticated = f, service_role = t.
--       -- authenticated = f is correct and deliberate: trigger functions
--       -- are invoked by the trigger, not by a caller.
--       -- service_role = t is INHERITED from pg_default_acl and is NOT
--       -- set by this file. An f there is not a defect of this migration.
--       -- anon = t means this was applied as DROP-then-CREATE somewhere
--       -- and the REVOKEs in section 3 must be re-issued.
--
-- V6. THE GUARD ACTUALLY BITES, AND THE EXEMPTION ACTUALLY EXEMPTS.
--     A WRITE. RUN IT, THEN LET IT ROLL BACK.
--
--     This is the after-the-fact version of the pre-apply test. The full
--     one, with impersonation and all five columns, is
--     docs/091-preapply-test.sql - prefer that one BEFORE applying.
--
--       BEGIN;
--         -- 6a. THE EXEMPTION. The SQL Editor has no auth.uid(), so this
--         --     MUST SUCCEED. If it raises LG007, the exemption is
--         --     broken and every migration after this one is blocked.
--         UPDATE public.profiles
--            SET is_paid = is_paid
--          WHERE id = (SELECT id FROM public.profiles LIMIT 1);
--
--         -- 6b. Same, but actually moving the value. Still exempt.
--         UPDATE public.profiles
--            SET is_paid = NOT is_paid
--          WHERE id = (SELECT id FROM public.profiles LIMIT 1);
--       ROLLBACK;
--       -- EXPECTED: both succeed, then the ROLLBACK undoes 6b. Nothing
--       -- is left behind either way.
--       -- IF 6b RAISES LG007: the exemption test is not doing what this
--       -- header claims and the apply should be rolled back with
--       -- 091_profiles_column_guard_down.sql, because a migration that
--       -- cannot write a profile is a migration that has locked the
--       -- database's own maintainer out.
--
-- V7. NOTHING ELSE MOVED.
--
--       SELECT count(*) AS profiles_columns
--       FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='profiles';
--       -- EXPECTED: 44. This file adds no column and drops none.
