-- =====================================================================
-- Migration 090 ROLLBACK: 090_active_org_down.sql
--
--   DROP    trigger profiles_active_org_guard  ON public.profiles
--   DROP    public.profiles_guard_active_org()
--   DROP    public.set_active_org(uuid)
--   RESTORE public.accept_org_invitation(text) TO ITS 089 BODY
--   DROP    public.profiles.active_org_id
--
-- ORDER MATTERS AND IT IS THE ORDER ABOVE. The function is restored to a
-- body that does not mention the column BEFORE the column is dropped, so
-- there is no moment - even inside the transaction - at which a live
-- function references a column that is gone.
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE 86
-- and an explicit COMMIT; on LINE 279. Those are the only EXECUTABLE
-- occurrences of either word.
--
--     grep -n -i '^begin\|^commit\|^rollback' \
--       supabase/migrations/090_active_org_down.sql
--     -- EXPECTED: 86 BEGIN;   130 BEGIN (plpgsql)   279 COMMIT;
--
-- TO DRY RUN: change the COMMIT; on line 279 to ROLLBACK;.
--
-- Do NOT verify with grep -n '^BEGIN;$'. That anchored form has produced
-- false negatives in this repository.
--
-- =====================================================================
-- WHAT THIS ROLLS BACK, AND WHAT IT CANNOT
-- =====================================================================
--
-- IT DESTROYS DATA, AND THAT IS THE POINT OF SAYING SO HERE. Dropping
-- profiles.active_org_id deletes every acting-organization choice anyone
-- has made. Capture them first if you might reapply:
--
--     SELECT id, active_org_id FROM public.profiles
--     WHERE active_org_id IS NOT NULL;
--
-- IT DOES NOT UNDO ANY MEMBERSHIP. Every org_members row
-- accept_org_invitation() wrote is real and stays. Rolling this file
-- back therefore RETURNS ANY MULTI-MEMBERSHIP ACCOUNT TO THE BROKEN
-- STATE 090 EXISTS TO FIX: resolveActingOrgId() goes back to answering
-- "ambiguous" and that account can read everything and write nothing.
-- BEFORE RUNNING THIS, CHECK WHETHER ANYBODY IS IN THAT POSITION:
--
--     SELECT user_id, count(*) FROM public.org_members
--     GROUP BY user_id HAVING count(*) > 1;
--     -- 0 rows: rolling back is free.
--     -- ANY ROW: rolling back locks that person out of every write.
--     --          Set COLLEAGUE_INVITATIONS off first, and understand
--     --          that turning the flag off does NOT remove the
--     --          membership that already made them ambiguous.
--
-- LIB CODE MUST GO BACK TOO. The commit that removed the 42703 guard
-- from lib/acting-org.ts's loadStoredActingOrgId() has to be reverted
-- with this, or every multi-membership caller logs an error on a column
-- that no longer exists. It still fails closed, so it is noise rather
-- than breakage - but it is noise that will be investigated.
--
-- =====================================================================
-- THE anon TRAP. READ THIS BEFORE RECREATING ANYTHING LATER.
-- =====================================================================
--
-- A stock Supabase project grants anon EXECUTE on functions in public by
-- DEFAULT PRIVILEGE, from both postgres and supabase_admin. CREATE OR
-- REPLACE preserves a function's ACL; DROP THEN CREATE DOES NOT - the
-- recreated function picks up that default and anon gets EXECUTE back.
--
-- THIS FILE DROPS set_active_org(uuid) AND profiles_guard_active_org().
-- If either is ever recreated - by reapplying 090 or by any later file -
-- THE REVOKE ... FROM anon STATEMENTS MUST BE CARRIED FORWARD WITH IT.
-- 090 section 5 has them. This is the mistake 088 made.
--
-- accept_org_invitation(text) IS RESTORED WITH CREATE OR REPLACE AND
-- MUST NOT BE DROPPED. Its 089 ACL - anon revoked by name - survives a
-- REPLACE and would not survive a DROP. There is no re-grant in this
-- file for exactly that reason: V3 below checks the ACL came through
-- rather than a GRANT hiding whether it did.
-- =====================================================================


BEGIN;


-- ---------------------------------------------------------------------
-- 1. The write guard. Trigger first, then its function: dropping the
--    function while the trigger still points at it fails on the
--    dependency, and a rollback that stops halfway is worse than one
--    that does not start.
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS profiles_active_org_guard ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_guard_active_org();


-- ---------------------------------------------------------------------
-- 2. The sanctioned writer.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_active_org(uuid);


-- ---------------------------------------------------------------------
-- 3. accept_org_invitation(text) RESTORED TO ITS 089 BODY.
--
-- CREATE OR REPLACE, NEVER DROP THEN CREATE. See the anon trap above.
--
-- THE BODY BELOW IS VERBATIM FROM
-- supabase/migrations/089_org_invitation_lifecycle.sql LINES 495-632.
-- It is carried here in full because CREATE OR REPLACE replaces the body
-- wholesale, so a rollback that omits a clause does not restore 089 - it
-- invents a third version. The only difference from the version 090
-- installed is the absence of the profiles.active_org_id UPDATE and the
-- restoration of the comment block that stood in its place.
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
-- 4. The column. LAST, and after the function no longer mentions it.
--
-- The FK constraint goes with the column; there is no separate DROP
-- CONSTRAINT and adding one would fail on a name this file does not
-- know, because 090 let PostgreSQL generate it.
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles DROP COLUMN IF EXISTS active_org_id;

COMMIT;


-- =====================================================================
-- 5. VERIFICATION. RUN AFTER ROLLING BACK. READ ONLY.
-- =====================================================================
--
-- V1. THE COLUMN IS GONE, AND SO IS ITS FOREIGN KEY.
--
--       SELECT column_name FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'profiles'
--         AND column_name = 'active_org_id';
--       -- EXPECTED: 0 rows.
--
--       SELECT tc.constraint_name
--       FROM information_schema.table_constraints tc
--       JOIN information_schema.key_column_usage kcu
--         ON kcu.constraint_name = tc.constraint_name
--        AND kcu.constraint_schema = tc.constraint_schema
--       WHERE tc.table_schema = 'public' AND tc.table_name = 'profiles'
--         AND tc.constraint_type = 'FOREIGN KEY'
--         AND kcu.column_name = 'active_org_id';
--       -- EXPECTED: 0 rows. The FK went with the column.
--
-- V2. THE FUNCTIONS AND THE TRIGGER ARE GONE.
--
--       SELECT p.proname FROM pg_proc p
--       JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('set_active_org','profiles_guard_active_org');
--       -- EXPECTED: 0 rows.
--
--       SELECT t.tgname FROM pg_trigger t
--       JOIN pg_class c ON c.oid = t.tgrelid
--       WHERE c.relname = 'profiles' AND NOT t.tgisinternal
--         AND t.tgname = 'profiles_active_org_guard';
--       -- EXPECTED: 0 rows.
--
-- V3. accept_org_invitation SURVIVED WITH ITS 089 ACL AND ITS 089 BODY.
--
--       SELECT has_function_privilege('anon',          'public.accept_org_invitation(text)', 'EXECUTE') AS anon,
--              has_function_privilege('authenticated', 'public.accept_org_invitation(text)', 'EXECUTE') AS authenticated;
--       -- EXPECTED: anon = f, authenticated = t.
--       -- anon = t means this was applied as DROP-then-CREATE somewhere
--       -- and anon holds EXECUTE on the function that writes
--       -- org_members. Re-issue 089's REVOKE ... FROM anon at once.
--
--       SELECT position('active_org_id' IN p.prosrc) > 0 AS still_mentions_the_column
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'accept_org_invitation';
--       -- EXPECTED: t. 089's body CARRIES THE NAME IN A COMMENT - the
--       -- "DELIBERATELY NOT TOUCHED HERE" block - so t is the correct
--       -- answer and f would mean an older body was restored. To check
--       -- the STATEMENT is gone rather than the word:
--
--       SELECT position('SET active_org_id = v_inv.org_id' IN p.prosrc) > 0 AS still_writes_it
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'accept_org_invitation';
--       -- EXPECTED: f.
--
-- V4. NOTHING FROM 089 WAS TAKEN WITH IT.
--
--       SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--       -- EXPECTED: 117, unchanged. 090 added no policy and this file
--       -- drops none.
--
--       SELECT policyname, cmd FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'org_invitations'
--       ORDER BY policyname;
--       -- EXPECTED: the same 4 rows 089 left. This file touches none of
--       -- them.
