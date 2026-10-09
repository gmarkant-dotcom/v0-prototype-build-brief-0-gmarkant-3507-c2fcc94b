-- =====================================================================
-- 113: profiles.role / secondary_role / active_role ARE NO LONGER WRITABLE BY A SIGNED-IN
--      SESSION, AND public.set_active_role(p_role text) IS THE ONE SANCTIONED PORTAL SWITCH.
--
-- AUTHORED 2026-10-09 on branch fix/agency-gate-and-leaks. NOT APPLIED. NOT RUN AGAINST POSTGRES.
-- DO NOT APPLY WITHOUT A GREEN RUN OF supabase/migrations/113_preapply_test.sql AND GREG'S SAY-SO.
--
--   NEW  public.profiles_guard_role_columns()  -> trigger (BEFORE UPDATE ON profiles)
--   NEW  trigger profiles_role_columns_guard
--   NEW  public.set_active_role(p_role text)   -> jsonb
--   POLICIES ADDED OR CHANGED: NONE. handle_new_user IS NOT TOUCHED.
--
-- THE FULL FILENAME IS 113_role_columns_guard.sql. Its rollback sibling is
-- 113_role_columns_guard_down.sql. DO NOT GLOB.
--
-- =====================================================================
-- STOP-GATE
-- =====================================================================
--   [ ] supabase/sql-checks/agency-gate-lockout-check.sql has been run and section 4 (SWITCH)
--       lists only accounts that may lose a portal switch.
--   [ ] THE CODE ON fix/agency-gate-and-leaks IS DEPLOYED. It routes every active_role write
--       through this file's set_active_role() and falls back to the pre-113 write while the
--       function is absent (lib/server/active-role-switch.ts). THE CODE ON main BEFORE THAT
--       BRANCH WRITES active_role DIRECTLY FROM A SESSION, AND THIS FILE REFUSES THAT WRITE:
--       applied under the old code, "Switch to Vendor Mode / Lead Agency" stops working.
--   [ ] The pre-apply test's first line reads "SAFE TO APPLY 113.".
--   [ ] The DRY RUN has been done (COMMIT -> ROLLBACK) and V1 then shows zero rows.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 115 and COMMIT is at line 287.
--
-- =====================================================================
-- THE ROLE VALUES, FROM THE CHECK CONSTRAINTS (not guessed)
-- =====================================================================
--   profiles.role            CHECK (role IN ('agency', 'partner'))            scripts/001_create_profiles.sql:7
--   profiles.secondary_role  CHECK (secondary_role IN ('agency','partner'))   047_dual_role_profiles.sql:2
--   profiles.active_role     CHECK (active_role IN ('agency','partner'))      047_dual_role_profiles.sql:3
-- The pre-flight re-reads the live constraints and refuses if 'agency' or 'partner' is missing.
--
-- =====================================================================
-- THE RULE set_active_role APPLIES (owner ruling G1, 2026-10-09)
-- =====================================================================
--   'agency'  : the caller is a member of an organization with is_lead_agency AND is_paid.
--   'partner' : the caller is a member of an organization with is_vendor.
--   Anything else is refused (LG11C). No role column, no is_admin, no profiles.is_paid.
--   The application gate (lib/entitlements.ts resolveAgencyGate) is STRICTER for 'agency': it
--   tests the ACTIVE organization. A member of a paid lead agency whose active organization is
--   another one can switch portal here and still sees the upgrade screen until they switch
--   organization. That is the safe direction.
--
-- =====================================================================
-- HOW set_active_role PASSES ITS OWN GUARD - 090's PATTERN, PLUS ONE DELIBERATE EXEMPTION
-- =====================================================================
-- 090's set_active_org passes profiles_active_org_guard because that guard enforces a ROW
-- INVARIANT ("active_org_id names an organization the row owner belongs to"), the function
-- validates the same invariant BEFORE it writes, and so its write satisfies the guard. 090's
-- guard reads auth.uid() nowhere.
--
-- This file keeps that exactly: the guard re-checks the same membership rule set_active_role
-- checked (lead+paid for 'agency', vendor for 'partner'), for the row owner, on every
-- signed-in write of active_role.
--
-- BUT 090's SHAPE ALONE CANNOT MEET THIS BRIEF. The brief requires that a signed-in user
-- "cannot change active_role directly" - and an invariant-only guard would let an entitled
-- user PATCH active_role = 'agency' from a browser, because the invariant holds for them. And
-- 091's actor test (auth.uid() IS NULL) cannot tell the function from the browser: inside a
-- SECURITY DEFINER function called by a session, auth.uid() is still the caller. 091's header
-- (091:251-260) anticipates exactly this: "a future RPC cannot become a laundering path ...
-- unless somebody deliberately writes an exemption into it."
--
-- THE DELIBERATE EXEMPTION: set_active_role sets a TRANSACTION-LOCAL setting,
-- ligament.set_active_role = <the caller's uid>, immediately before its one UPDATE and clears
-- it immediately after. The guard admits an active_role change from a session only when that
-- setting equals BOTH auth.uid() AND the row's id, AND the invariant holds. A browser cannot
-- set it: PostgREST exposes only functions in the API schemas, set_config lives in pg_catalog,
-- and no function in public passes caller input to set_config (the pre-apply test asserts the
-- second half; review any future function that calls set_config).
--
-- role AND secondary_role: no exemption at all for a session. Only the service role, a
-- migration or the SQL Editor (auth.uid() IS NULL, 091's exemption) may write them. The admin
-- route grant-agency-access writes secondary_role on the service role and keeps working.
--
-- =====================================================================
-- WRITERS, CHECKED (091's census, docs/091-profiles-writer-census.md, re-read on this branch)
-- =====================================================================
--   app/api/profile/switch-role      -> set_active_role() (this branch)        PASSES
--   app/api/user/active-role         -> set_active_role() (this branch)        PASSES
--   app/api/partner/rfps/claim:110   -> set_active_role('partner') (branch)    PASSES / refused, logged
--   app/auth/callback role fix       -> service role (this branch)             EXEMPT
--   app/api/admin/grant-agency-access-> service role, secondary_role           EXEMPT
--   handle_new_user ON CONFLICT      -> does not write role columns; uid NULL  EXEMPT
--   every settings form              -> sends role columns unchanged or not    EARLY RETURN
--
-- ERRCODES: LG113 (column not writable from a session), LG11A (agency refused),
-- LG11B (vendor refused), LG11C (not a portal), LG002 (no session; 089's code reused).
-- The API maps LG11A/LG11B to 403 (lib/server/active-role-switch.ts).
--
-- =====================================================================
-- VERIFICATION (after the real COMMIT; expected values exact)
-- =====================================================================
-- V1. SELECT tgname, tgenabled FROM pg_trigger
--       WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'profiles_role_columns_guard';
--     EXPECTED: one row, tgenabled = 'O'.
-- V2. SELECT has_function_privilege('anon', 'public.set_active_role(text)', 'EXECUTE'),
--            has_function_privilege('authenticated', 'public.set_active_role(text)', 'EXECUTE'),
--            has_function_privilege('authenticated', 'public.profiles_guard_role_columns()', 'EXECUTE');
--     EXPECTED: false, true, false.
-- V3. SELECT proname, prosecdef, proconfig FROM pg_proc
--       WHERE proname IN ('set_active_role', 'profiles_guard_role_columns');
--     EXPECTED: two rows, prosecdef = t, proconfig = {"search_path=public, pg_temp"}.
-- V4. SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles';
--     EXPECTED: unchanged from before the apply.
-- =====================================================================

BEGIN;

DO $preflight$
DECLARE
  v_checks text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass
              AND tgname = 'profiles_role_columns_guard') THEN
    RAISE EXCEPTION '113 refuses to apply: profiles_role_columns_guard already exists. Read the schema first.'
      USING ERRCODE = 'LG113';
  END IF;
  IF to_regprocedure('public.set_active_role(text)') IS NOT NULL THEN
    RAISE EXCEPTION '113 refuses to apply: public.set_active_role(text) already exists. Read the schema first.'
      USING ERRCODE = 'LG113';
  END IF;
  IF to_regprocedure('public.set_active_org(uuid)') IS NULL THEN
    RAISE EXCEPTION '113 refuses to apply: 090 is not applied (public.set_active_org(uuid) is missing).'
      USING ERRCODE = 'LG113';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass
                  AND tgname = 'profiles_authority_columns_guard') THEN
    RAISE EXCEPTION '113 refuses to apply: 091 is not applied (profiles_authority_columns_guard is missing).'
      USING ERRCODE = 'LG113';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'organizations'
         AND column_name IN ('is_lead_agency', 'is_vendor', 'is_paid')) <> 3 THEN
    RAISE EXCEPTION '113 refuses to apply: organizations lacks is_lead_agency, is_vendor or is_paid (079/092).'
      USING ERRCODE = 'LG113';
  END IF;
  SELECT string_agg(pg_get_constraintdef(c.oid), ' | ') INTO v_checks
  FROM pg_constraint c
  WHERE c.conrelid = 'public.profiles'::regclass AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ~ '(role|active_role|secondary_role)';
  IF v_checks IS NULL OR position('agency' IN v_checks) = 0 OR position('partner' IN v_checks) = 0 THEN
    RAISE EXCEPTION '113 refuses to apply: the role CHECK constraints on profiles do not name both agency and partner (found: %).', coalesce(v_checks, 'none')
      USING ERRCODE = 'LG113';
  END IF;
END
$preflight$;

CREATE FUNCTION public.profiles_guard_role_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_marker text;
BEGIN
  -- THE EARLY RETURN. Every settings save and every write that leaves the three alone.
  IF  NEW.role           IS NOT DISTINCT FROM OLD.role
  AND NEW.secondary_role IS NOT DISTINCT FROM OLD.secondary_role
  AND NEW.active_role    IS NOT DISTINCT FROM OLD.active_role
  THEN
    RETURN NEW;
  END IF;

  -- 091's EXEMPTION: no end-user session (service role, migrations, SQL Editor,
  -- handle_new_user). Trusted code that has made its own decision.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG113',
            DETAIL  = 'profiles.role is guarded by migration 113. Only the service role or a migration may write it.';
  END IF;

  IF NEW.secondary_role IS DISTINCT FROM OLD.secondary_role THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG113',
            DETAIL  = 'profiles.secondary_role is guarded by migration 113. Only the service role or a migration may write it.';
  END IF;

  -- active_role moved, from a session. Only set_active_role() may do that, and only for the
  -- caller's own row: the transaction-local marker it sets must name both.
  v_marker := current_setting('ligament.set_active_role', true);
  IF v_marker IS NULL OR v_marker = '' OR v_marker <> v_uid::text OR NEW.id <> v_uid THEN
    RAISE EXCEPTION 'Use the portal switch to change portal.'
      USING ERRCODE = 'LG113',
            DETAIL  = 'profiles.active_role is guarded by migration 113. A session may change it only through public.set_active_role(text).';
  END IF;

  -- 090's ROW INVARIANT, for the row owner, whoever got here.
  IF NEW.active_role = 'agency' AND NOT EXISTS (
       SELECT 1 FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
        WHERE m.user_id = NEW.id AND o.is_lead_agency AND o.is_paid) THEN
    RAISE EXCEPTION 'Agency access requires a paid lead-agency account.' USING ERRCODE = 'LG11A';
  END IF;
  IF NEW.active_role = 'partner' AND NOT EXISTS (
       SELECT 1 FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
        WHERE m.user_id = NEW.id AND o.is_vendor) THEN
    RAISE EXCEPTION 'Vendor mode is available to members of a vendor company.' USING ERRCODE = 'LG11B';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_guard_role_columns() IS
  'Migration 113. BEFORE UPDATE guard on profiles.role, secondary_role, active_role. A session '
  '(auth.uid() NOT NULL) may not change role or secondary_role at all (LG113), and may change '
  'active_role only inside public.set_active_role(text), which sets the transaction-local marker '
  'ligament.set_active_role to the caller uid. The row invariant of 090 is re-checked for the row '
  'owner: agency needs a lead+paid membership (LG11A), partner a vendor membership (LG11B). The '
  'service role, migrations and handle_new_user (auth.uid() NULL) are exempt, as in 091.';

DROP TRIGGER IF EXISTS profiles_role_columns_guard ON public.profiles;

CREATE TRIGGER profiles_role_columns_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_role_columns();

CREATE FUNCTION public.set_active_role(p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to switch portal.' USING ERRCODE = 'LG002';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('agency', 'partner') THEN
    RAISE EXCEPTION 'Choose agency or partner.' USING ERRCODE = 'LG11C';
  END IF;

  -- VALIDATE BEFORE WRITING (090's order). Fixed messages; nothing about any organization is
  -- echoed, so neither refusal is an oracle.
  IF p_role = 'agency' AND NOT EXISTS (
       SELECT 1 FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
        WHERE m.user_id = v_uid AND o.is_lead_agency AND o.is_paid) THEN
    RAISE EXCEPTION 'Agency access requires a paid lead-agency account.' USING ERRCODE = 'LG11A';
  END IF;

  IF p_role = 'partner' AND NOT EXISTS (
       SELECT 1 FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
        WHERE m.user_id = v_uid AND o.is_vendor) THEN
    RAISE EXCEPTION 'Vendor mode is available to members of a vendor company.' USING ERRCODE = 'LG11B';
  END IF;

  -- THE DELIBERATE EXEMPTION (see the header): transaction-local, scoped to this one UPDATE.
  PERFORM set_config('ligament.set_active_role', v_uid::text, true);
  UPDATE public.profiles SET active_role = p_role WHERE id = v_uid;
  PERFORM set_config('ligament.set_active_role', '', true);

  RETURN jsonb_build_object('active_role', p_role);
END;
$$;

COMMENT ON FUNCTION public.set_active_role(text) IS
  'Migration 113. The one sanctioned writer of profiles.active_role for a signed-in caller, built '
  'on 090''s set_active_org: validate, then write the caller''s own row. agency requires membership '
  'of an organization with is_lead_agency AND is_paid (LG11A); partner requires membership of an '
  'is_vendor organization (LG11B); anything else LG11C; no session LG002. Passes '
  'profiles_role_columns_guard through the transaction-local marker ligament.set_active_role.';

REVOKE EXECUTE ON FUNCTION public.set_active_role(text)            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_active_role(text)            FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_active_role(text)            TO authenticated;

REVOKE EXECUTE ON FUNCTION public.profiles_guard_role_columns()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.profiles_guard_role_columns()    FROM anon;
REVOKE EXECUTE ON FUNCTION public.profiles_guard_role_columns()    FROM authenticated;

COMMIT;
