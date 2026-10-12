-- =====================================================================
-- 115: A DISCOVERABLE PROFILE IS NO LONGER A WHOLE ROW FOR EVERY SIGNED-IN USER.
--      Discovery reads go through public.discoverable_profiles(p_role, p_ids), which returns
--      PUBLIC DISCOVERY FIELDS ONLY.
--
-- AUTHORED 2026-10-12 on branch fix/guest-profiles-records. NOT APPLIED. NOT RUN AGAINST POSTGRES.
-- DO NOT APPLY WITHOUT A GREEN RUN OF supabase/migrations/115_preapply_test.sql AND GREG'S SAY-SO.
--
--   NEW      public.discoverable_profiles(p_role text, p_ids uuid[]) -> SETOF jsonb
--   DROPPED  policy "Authenticated users can read discoverable profiles" ON public.profiles
--   UNCHANGED every other policy on profiles, every grant on profiles, every trigger.
--
-- THE FULL FILENAME IS 115_discoverable_profiles.sql. Its rollback sibling is
-- 115_discoverable_profiles_down.sql. DO NOT GLOB.
--
-- =====================================================================
-- STOP-GATE
-- =====================================================================
--   [ ] THE CODE ON fix/guest-profiles-records IS DEPLOYED. It reads discovery through this
--       file's function and falls back to the old direct select while the function is missing
--       (lib/server/discoverable-profiles.ts). THE CODE ON main BEFORE THAT BRANCH READS
--       DISCOVERABLE PROFILES DIRECTLY: applied under the old code, the marketplace, the
--       Discover tab and every public-tier profile page go EMPTY for non-partners.
--   [ ] The pre-apply test's first line reads "SAFE TO APPLY 115.".
--   [ ] The DRY RUN has been done (COMMIT -> ROLLBACK) and V1 then shows zero rows.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 94 and COMMIT is at line 204.
--
-- =====================================================================
-- WHAT IS CLOSED, WHAT IS NOT
-- =====================================================================
-- Before: scripts/016's policy (FOR SELECT TO authenticated USING (is_discoverable = true))
-- admitted the WHOLE ROW of every discoverable profile to any signed-in user through PostgREST:
-- legal_entity_name/_type, legal_ein, legal_address, legal_state_of_incorporation, rate_info,
-- payment_terms(_custom), default_terms, default_nda_url, business_criteria (with the COI document
-- URL), phone, email, role columns, active_org_id, is_paid, is_admin, demo_access,
-- linked_agency_id. Every route masked them; PostgREST is one GET away with the anon key.
--
-- After: the only SELECT policy left on profiles is "Users can view profiles of partnership
-- members" (079:1562-1567, body narrowed by 085): the row owner, members of the caller's own
-- organizations, and members of organizations with a partnership whose status is not
-- terminated/removed. THAT POLICY IS NOT TOUCHED: self reads, colleague reads and counterparty
-- reads are exactly what they were. Splitting the sensitive columns away from counterparties is
-- the later profile_private work (docs/profiles-exposure-design.md section 3).
--
-- A stranger (authenticated, not owner, not colleague, not a live counterparty) reads a
-- discoverable profile ONLY through discoverable_profiles(), which returns exactly:
--   id, full_name, company_name, display_name, bio (with any legacy rate block removed), location,
--   website, company_website, company_linkedin_url, agency_type, avatar_url, company_logo_url,
--   reel_url, capabilities, work_examples, business_criteria (minus insurance.coi_document_url),
--   is_discoverable (always true).
-- No email, phone, role column, legal, billing, rate, terms or authority field.
--
-- =====================================================================
-- WHY A FUNCTION AND NOT A NARROWER POLICY
-- =====================================================================
-- RLS is row level. Column-level GRANTs on profiles would apply to every row, including the
-- owner's own, and 090/091 rejected them for that reason. So the stranger's view has to be a
-- projection: a SECURITY DEFINER function with an allow-list built by jsonb_build_object (a
-- column added to profiles later is NOT exposed by default), search_path pinned, EXECUTE revoked
-- from PUBLIC and anon, granted to authenticated, returning nothing without a session.
--
-- =====================================================================
-- READERS THAT DEPENDED ON THE DROPPED POLICY (code first, this branch)
-- =====================================================================
--   app/api/marketplace/discoverable          -> the function (role filter)
--   app/api/agency/pool/[partnerId]           -> the function when the session read is empty
--   app/api/partner/network/[agencyId]        -> the function when the session read is empty
--   app/api/partnerships GET domain-match     -> the function for names not otherwise readable
--   app/api/partnerships POST invite by id    -> service-role id+email, discoverable only
--   app/api/agency/rfp-responses (names)      -> the function for names not otherwise readable
-- Reported, not moved (they lose discoverable strangers, as they already miss non-discoverable
-- ones): email-keyed matching in partnerships POST and broadcast-rfp manual recipients, and
-- resolveOrgNotificationRecipients' profiles fallback for a bidder with no partnership.
--
-- =====================================================================
-- VERIFICATION (after the real COMMIT; expected values exact)
-- =====================================================================
-- V1. SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
--       AND policyname = 'Authenticated users can read discoverable profiles';
--     EXPECTED: zero rows.
-- V2. SELECT has_function_privilege('anon', 'public.discoverable_profiles(text, uuid[])', 'EXECUTE'),
--            has_function_privilege('authenticated', 'public.discoverable_profiles(text, uuid[])', 'EXECUTE');
--     EXPECTED: false, true.
-- V3. SELECT prosecdef, provolatile, proconfig FROM pg_proc WHERE proname = 'discoverable_profiles';
--     EXPECTED: one row, t, s, {"search_path=public, pg_temp"}.
-- V4. SELECT policyname, cmd, roles FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
--       ORDER BY policyname;
--     EXPECTED: the pre-apply list minus the dropped policy, nothing else changed.
-- V5. SELECT count(*) FROM public.profiles WHERE is_discoverable;   -- as postgres: unchanged
-- =====================================================================

BEGIN;

DO $preflight$
DECLARE
  v_missing text;
  v_select  text;
  v_qual    text;
BEGIN
  IF to_regprocedure('public.discoverable_profiles(text, uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION '115 refuses to apply: public.discoverable_profiles(text, uuid[]) already exists. Read the schema first.'
      USING ERRCODE = 'LG115';
  END IF;

  SELECT qual INTO v_qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profiles'
     AND policyname = 'Authenticated users can read discoverable profiles'
     AND cmd = 'SELECT' AND roles = ARRAY['authenticated']::name[];
  IF v_qual IS NULL THEN
    RAISE EXCEPTION '115 refuses to apply: the discoverable SELECT policy is not there as scripts/016 created it (FOR SELECT TO authenticated). Read the schema first.'
      USING ERRCODE = 'LG115';
  END IF;
  IF regexp_replace(lower(v_qual), '[\s()]', '', 'g') <> 'is_discoverable=true' THEN
    RAISE EXCEPTION '115 refuses to apply: the discoverable policy reads % rather than (is_discoverable = true). Read it first.', v_qual
      USING ERRCODE = 'LG115';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'profiles'
                    AND policyname = 'Users can view profiles of partnership members' AND cmd = 'SELECT'
                    AND qual ILIKE '%current_user_visible_profile_ids%') THEN
    RAISE EXCEPTION '115 refuses to apply: "Users can view profiles of partnership members" (079/085) is missing or changed; owner and counterparty reads depend on it.'
      USING ERRCODE = 'LG115';
  END IF;

  -- Dropping one policy only closes the leak if no OTHER SELECT policy also admits strangers.
  SELECT string_agg(policyname, ', ' ORDER BY policyname) INTO v_select
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd IN ('SELECT', 'ALL')
    AND policyname NOT IN ('Authenticated users can read discoverable profiles',
                           'Users can view profiles of partnership members');
  IF v_select IS NOT NULL THEN
    RAISE EXCEPTION '115 refuses to apply: profiles has other SELECT policies (%); read them, dropping the discoverable one may not close the exposure.', v_select
      USING ERRCODE = 'LG115';
  END IF;

  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['is_discoverable', 'role', 'active_role', 'full_name', 'company_name', 'display_name',
                    'bio', 'location', 'website', 'company_website', 'company_linkedin_url', 'agency_type',
                    'avatar_url', 'company_logo_url', 'reel_url', 'capabilities', 'work_examples',
                    'business_criteria']) AS c
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = c);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '115 refuses to apply: profiles lacks %.', v_missing USING ERRCODE = 'LG115';
  END IF;
END
$preflight$;

CREATE FUNCTION public.discoverable_profiles(p_role text DEFAULT NULL, p_ids uuid[] DEFAULT NULL)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
           'id',                   p.id,
           'full_name',            p.full_name,
           'company_name',         p.company_name,
           'display_name',         p.display_name,
           'bio',                  CASE WHEN strpos(p.bio, E'\n\n__LIGAMENT_PARTNER_RATE_V1__\n') > 0
                                        THEN rtrim(left(p.bio, strpos(p.bio, E'\n\n__LIGAMENT_PARTNER_RATE_V1__\n') - 1), E' \t\r\n')
                                        ELSE p.bio END,
           'location',             p.location,
           'website',              p.website,
           'company_website',      p.company_website,
           'company_linkedin_url', p.company_linkedin_url,
           'agency_type',          p.agency_type,
           'avatar_url',           p.avatar_url,
           'company_logo_url',     p.company_logo_url,
           'reel_url',             p.reel_url,
           'capabilities',         p.capabilities,
           'work_examples',        p.work_examples,
           'business_criteria',    CASE WHEN jsonb_typeof(p.business_criteria::jsonb) = 'object'
                                         AND jsonb_typeof(p.business_criteria::jsonb -> 'insurance') = 'object'
                                        THEN jsonb_set(p.business_criteria::jsonb, '{insurance}',
                                                       (p.business_criteria::jsonb -> 'insurance') - 'coi_document_url')
                                        ELSE p.business_criteria::jsonb END,
           'is_discoverable',      true)
  FROM public.profiles p
  WHERE p.is_discoverable = true
    AND auth.uid() IS NOT NULL
    AND (p_role IS NULL OR p.role = p_role OR p.active_role = p_role)
    AND (p_ids IS NULL OR p.id = ANY (p_ids))
  ORDER BY p.company_name NULLS LAST, p.id;
$$;

COMMENT ON FUNCTION public.discoverable_profiles(text, uuid[]) IS
  'Migration 115. The discovery read of profiles for any signed-in user: discoverable profiles '
  'only, PUBLIC DISCOVERY FIELDS ONLY (allow-list; bio without the legacy rate block; '
  'business_criteria without insurance.coi_document_url). p_role matches role OR active_role; '
  'p_ids restricts to those ids. No email, phone, role, legal, billing, rate, terms or authority '
  'column. Replaces the whole-row policy "Authenticated users can read discoverable profiles".';

REVOKE ALL     ON FUNCTION public.discoverable_profiles(text, uuid[]) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.discoverable_profiles(text, uuid[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.discoverable_profiles(text, uuid[]) TO authenticated;

DROP POLICY "Authenticated users can read discoverable profiles" ON public.profiles;

COMMIT;
