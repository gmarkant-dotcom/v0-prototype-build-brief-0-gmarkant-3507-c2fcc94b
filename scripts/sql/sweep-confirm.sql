-- =====================================================================
-- sweep-confirm.sql - read-only live confirmation for docs/leak-sweep-2026-10-09.md
--
-- READ ONLY. Every statement is a SELECT against the catalog or a COUNT.
-- No INSERT, UPDATE, DELETE, DDL, SET ROLE or transaction control.
-- Paste whole into the Supabase SQL Editor (runs as postgres).
--
-- NOT PARSED. No SQL parser was available to the session that wrote this
-- file. The owner's SQL Editor run is the parse check. The whole file is one
-- statement, so one bad row fails all of it. Column premises come from
-- scripts/ DDL, not from the live catalog: if the error is 42703 (undefined
-- column), delete that one UNION ALL row and re-run, and record the missing
-- column as a finding (the live schema differs from the repo).
--
-- Output: one row per check -> check_id | finding | expected | observed | verdict
-- verdict is MATCH when observed = expected. For a LEAK check, MATCH means
-- the leak is CONFIRMED live (the expected value describes the leak).
-- =====================================================================

WITH checks(check_id, finding, expected, observed) AS (

  -- ---------------------------------------------------------------
  -- F1. A vendor can insert its own delivery_reviews row.
  -- ---------------------------------------------------------------
  SELECT 'F1a', 'delivery_reviews ALL policy WITH CHECK tests org_id only (no partnership/project ownership)',
         'true',
         (SELECT (count(*) = 1)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'delivery_reviews'
             AND policyname = 'Agencies manage own delivery reviews' AND cmd = 'ALL'
             AND with_check LIKE '%current_user_org_ids%'
             AND with_check NOT LIKE '%partnerships%'
             AND with_check NOT LIKE '%projects%')
  UNION ALL
  SELECT 'F1b', 'delivery_reviews has exactly 2 policies (ALL agency, SELECT vendor complete); no separate INSERT policy',
         '2',
         (SELECT count(*)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'delivery_reviews')
  UNION ALL
  SELECT 'F1c', 'authenticated holds INSERT on delivery_reviews (default grants)',
         'true',
         has_table_privilege('authenticated', 'public.delivery_reviews', 'INSERT')::text
  UNION ALL
  SELECT 'F1d', 'EXPLOITATION CHECK: delivery_reviews rows whose org_id is not the partnership lead org (forged rows)',
         '0',
         (SELECT count(*)::text FROM public.delivery_reviews d
            JOIN public.partnerships p ON p.id = d.partnership_id
           WHERE d.org_id IS DISTINCT FROM p.lead_org_id)
  UNION ALL
  SELECT 'F1e', 'EXPLOITATION CHECK: delivery_reviews rows whose org_id is not the project owner org',
         '0',
         (SELECT count(*)::text FROM public.delivery_reviews d
            JOIN public.projects pr ON pr.id = d.project_id
           WHERE d.org_id IS DISTINCT FROM pr.org_id)
  UNION ALL
  SELECT 'F1f', 'delivery_review_scores policy keys only on the parent review org_id (follows a forged parent)',
         'true',
         (SELECT (count(*) = 1)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'delivery_review_scores'
             AND cmd = 'ALL' AND with_check LIKE '%org_id%' AND with_check NOT LIKE '%partnerships%')

  -- ---------------------------------------------------------------
  -- F2. A vendor can reach agency routes by switching its own active_role.
  -- ---------------------------------------------------------------
  UNION ALL
  SELECT 'F2a', 'profiles self-UPDATE policy has no WITH CHECK (table-wide self write)',
         'true',
         (SELECT (count(*) >= 1)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'UPDATE'
             AND qual LIKE '%auth.uid()%' AND with_check IS NULL)
  UNION ALL
  SELECT 'F2b', '091 authority guard does NOT cover role, active_role, secondary_role',
         'true',
         (SELECT (count(*) = 1)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'profiles_guard_authority_columns'
             AND pg_get_functiondef(p.oid) NOT LIKE '%active_role%'
             AND pg_get_functiondef(p.oid) NOT LIKE '%secondary_role%'
             AND pg_get_functiondef(p.oid) NOT LIKE '%NEW.role%')
  UNION ALL
  SELECT 'F2c', 'No other trigger on profiles mentions active_role / secondary_role / role',
         '0',
         (SELECT count(*)::text FROM pg_trigger t
            JOIN pg_proc p ON p.oid = t.tgfoid
           WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal
             AND (pg_get_functiondef(p.oid) LIKE '%active_role%'
               OR pg_get_functiondef(p.oid) LIKE '%secondary_role%'))
  UNION ALL
  SELECT 'F2d', 'authenticated holds UPDATE on profiles.active_role (no column revoke)',
         'true',
         has_column_privilege('authenticated', 'public.profiles', 'active_role', 'UPDATE')::text
  UNION ALL
  SELECT 'F2e', 'authenticated holds UPDATE on profiles.role (no column revoke)',
         'true',
         has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')::text
  UNION ALL
  SELECT 'F2f', 'Vendor-primary profiles already carrying secondary_role=agency (switch-role route admits them)',
         '> 0 means the route itself admits vendors; record the number',
         (SELECT count(*)::text FROM public.profiles
           WHERE role = 'partner' AND secondary_role = 'agency')
  UNION ALL
  SELECT 'F2g', 'handle_new_user writes secondary_role as the opposite of the chosen role',
         'true',
         (SELECT (count(*) = 1)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
             AND pg_get_functiondef(p.oid) LIKE '%other_role%')

  -- ---------------------------------------------------------------
  -- organizations.is_paid
  -- ---------------------------------------------------------------
  UNION ALL
  SELECT 'O1', 'organizations counterparty SELECT policy exists (whole row incl. is_paid)',
         'true',
         (SELECT (count(*) = 1)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'organizations'
             AND policyname = 'Members read counterparty organizations' AND cmd = 'SELECT'
             AND qual LIKE '%current_user_counterparty_org_ids%')
  UNION ALL
  SELECT 'O2', 'organizations.is_paid exists',
         'true',
         (SELECT (count(*) = 1)::text FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'is_paid')
  UNION ALL
  SELECT 'O3', 'authenticated can SELECT organizations.is_paid (no column revoke)',
         'true',
         has_column_privilege('authenticated', 'public.organizations', 'is_paid', 'SELECT')::text
  UNION ALL
  SELECT 'O4', 'current_user_counterparty_org_ids has no status filter (any partnership status admits)',
         'true',
         (SELECT (count(*) = 1)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'current_user_counterparty_org_ids'
             AND pg_get_functiondef(p.oid) NOT LIKE '%status%')

  -- ---------------------------------------------------------------
  -- profiles (lead agency members' whole row)
  -- ---------------------------------------------------------------
  UNION ALL
  SELECT 'P1', 'profiles counterparty SELECT policy via current_user_visible_profile_ids',
         'true',
         (SELECT (count(*) = 1)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'profiles'
             AND policyname = 'Users can view profiles of partnership members'
             AND qual LIKE '%current_user_visible_profile_ids%')
  UNION ALL
  SELECT 'P2', 'profiles discoverable SELECT policy still live (any authenticated user, whole row)',
         'true',
         (SELECT (count(*) = 1)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'profiles'
             AND policyname = 'Authenticated users can read discoverable profiles')
  UNION ALL
  SELECT 'P3', 'authenticated can SELECT profiles.is_paid / is_admin / demo_access',
         'true',
         (has_column_privilege('authenticated', 'public.profiles', 'is_paid', 'SELECT')
          AND has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'SELECT')
          AND has_column_privilege('authenticated', 'public.profiles', 'demo_access', 'SELECT'))::text
  UNION ALL
  SELECT 'P4', 'Agency-role profiles that are discoverable (readable by every authenticated user)',
         'record the number',
         (SELECT count(*)::text FROM public.profiles WHERE is_discoverable = true AND role = 'agency')

  -- ---------------------------------------------------------------
  -- partner_rfp_inbox.master_rfp_json.evaluation_criteria
  -- ---------------------------------------------------------------
  UNION ALL
  SELECT 'I1', 'Vendor SELECT policy on partner_rfp_inbox keyed on vendor_org_id (whole row incl. master_rfp_json)',
         'true',
         (SELECT (count(*) = 1)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'partner_rfp_inbox'
             AND policyname = 'Partners select inbox rows by partner_id' AND cmd = 'SELECT'
             AND qual LIKE '%vendor_org_id%')
  UNION ALL
  SELECT 'I2', 'Email-keyed vendor SELECT policy on partner_rfp_inbox still live (079 bucket U)',
         'true',
         (SELECT (count(*) = 1)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'partner_rfp_inbox'
             AND policyname = 'Partners select inbox rows by recipient email')
  UNION ALL
  SELECT 'I3', 'Inbox rows carrying master_rfp_json.evaluation_criteria (population exposed)',
         'record the number',
         (SELECT count(*)::text FROM public.partner_rfp_inbox
           WHERE master_rfp_json ? 'evaluation_criteria'
             AND jsonb_typeof(master_rfp_json -> 'evaluation_criteria') = 'array'
             AND jsonb_array_length(master_rfp_json -> 'evaluation_criteria') > 0)
  UNION ALL
  SELECT 'I4', 'Distinct top-level master_rfp_json keys live (review each for agency-internal content)',
         'review',
         (SELECT string_agg(k, ', ' ORDER BY k) FROM (
            SELECT DISTINCT jsonb_object_keys(master_rfp_json) AS k
              FROM public.partner_rfp_inbox
             WHERE jsonb_typeof(master_rfp_json) = 'object') s)

  -- ---------------------------------------------------------------
  -- Vendor-admitting policies on the remaining tables, as last defined
  -- (079 unless noted). One row each; expected = the 079/099/100 count.
  -- ---------------------------------------------------------------
  UNION ALL
  SELECT 'V1', 'payment_milestones vendor SELECT policies (3 near-identical, 079:1514-1532)',
         '3',
         (SELECT count(*)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'payment_milestones'
             AND cmd = 'SELECT' AND qual LIKE '%vendor_org_id%')
  UNION ALL
  SELECT 'V2', 'payment_milestones live columns (review notes / internal fields)',
         'review',
         (SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'payment_milestones')
  UNION ALL
  SELECT 'V3', 'payment_milestones rows with non-empty notes readable by their vendor',
         'record the number',
         (SELECT count(*)::text FROM public.payment_milestones
           WHERE partnership_id IS NOT NULL AND coalesce(btrim(notes), '') <> '')
  UNION ALL
  SELECT 'V4', 'msa_agreements vendor SELECT policy (079:1244-1248)',
         '1',
         (SELECT count(*)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'msa_agreements' AND cmd = 'SELECT'
             AND qual LIKE '%vendor_org_id%')
  UNION ALL
  SELECT 'V5', 'msa_agreements live columns',
         'review',
         (SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'msa_agreements')
  UNION ALL
  SELECT 'V6', 'onboarding_packages vendor SELECT + UPDATE policies (079:1290-1303)',
         '2',
         (SELECT count(*)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'onboarding_packages'
             AND cmd IN ('SELECT', 'UPDATE') AND qual LIKE '%vendor_org_id%')
  UNION ALL
  SELECT 'V7', 'onboarding_packages live columns',
         'review',
         (SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'onboarding_packages')
  UNION ALL
  SELECT 'V8', 'assignment_agreements vendor SELECT + UPDATE policies (079:1692-1708)',
         '2',
         (SELECT count(*)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'assignment_agreements'
             AND cmd IN ('SELECT', 'UPDATE') AND qual LIKE '%vendor_org_id%')
  UNION ALL
  SELECT 'V9', 'project_documents vendor SELECT policy, visibility-gated (079:1607-1621)',
         '1',
         (SELECT count(*)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'project_documents' AND cmd = 'SELECT'
             AND qual LIKE '%visibility%' AND qual LIKE '%vendor_org_id%')
  UNION ALL
  SELECT 'V10', 'project_documents distinct visibility values live (anything besides all_partners/assignment/internal?)',
         'review',
         (SELECT string_agg(DISTINCT coalesce(visibility, '<null>'), ', ') FROM public.project_documents)
  UNION ALL
  SELECT 'V11', 'project_assignments vendor SELECT + UPDATE policies (079:1579-1592)',
         '2',
         (SELECT count(*)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'project_assignments'
             AND cmd IN ('SELECT', 'UPDATE') AND qual LIKE '%vendor_org_id%')
  UNION ALL
  SELECT 'V12', 'project_assignments live columns (review agency-written fields)',
         'review',
         (SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'project_assignments')
  UNION ALL
  SELECT 'V13', 'partner_rfp_response_versions vendor SELECT + INSERT policies (079:1371-1377)',
         '2',
         (SELECT count(*)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'partner_rfp_response_versions'
             AND (qual LIKE '%vendor_org_id%' OR with_check LIKE '%vendor_org_id%'))
  UNION ALL
  SELECT 'V14', 'rfp_magic_tokens has NO vendor-admitting policy (only the org_id ALL policy)',
         '1',
         (SELECT count(*)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'rfp_magic_tokens')
  UNION ALL
  SELECT 'V15', 'rfp_magic_tokens ALL policy roles (079 recreated TO authenticated; snapshot had public)',
         '{authenticated}',
         (SELECT roles::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'rfp_magic_tokens'
             AND policyname = 'Agency can manage their own tokens')
  UNION ALL
  SELECT 'V16', 'partner_status_updates vendor policies (INSERT, SELECT, UPDATE; 079:1431-1447)',
         '3',
         (SELECT count(*)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'partner_status_updates'
             AND (qual LIKE '%vendor_org_id%' OR with_check LIKE '%vendor_org_id%'))
  UNION ALL
  SELECT 'V17', 'milestone_events counterparty SELECT is whitelist-gated (080:350-362)',
         'true',
         (SELECT (count(*) = 1)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'milestone_events'
             AND policyname = 'Counterparty reads whitelisted milestone events'
             AND qual LIKE '%vendor_visible_event_types%')
  UNION ALL
  SELECT 'V18', 'milestone_events vendor INSERT policy is the 100 inbox-pinned form',
         'true',
         (SELECT (count(*) = 1)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'milestone_events'
             AND policyname = 'Vendors insert own company milestone events'
             AND with_check LIKE '%partner_rfp_inbox%')

  -- ---------------------------------------------------------------
  -- Route-level leak populations (the route returns the whole row; these
  -- count how many live rows carry the agency-private content).
  -- ---------------------------------------------------------------
  UNION ALL
  SELECT 'R1', 'rfp_magic_tokens rows with non-empty evaluation_criteria (returned whole by guest GET)',
         'record the number',
         (SELECT count(*)::text FROM public.rfp_magic_tokens
           WHERE evaluation_criteria IS NOT NULL
             AND jsonb_typeof(evaluation_criteria) = 'array'
             AND jsonb_array_length(evaluation_criteria) > 0)
  UNION ALL
  SELECT 'R2', 'rfp_magic_tokens rows with reference_materials.output_template_config (returned whole by guest GET)',
         'record the number',
         (SELECT count(*)::text FROM public.rfp_magic_tokens
           WHERE jsonb_typeof(reference_materials) = 'object'
             AND reference_materials ? 'output_template_config')
  UNION ALL
  SELECT 'R3', 'rfp_magic_tokens rows with domain_match_profile_id set (another user''s profile id, returned whole)',
         'record the number',
         (SELECT count(*)::text FROM public.rfp_magic_tokens WHERE domain_match_profile_id IS NOT NULL)
  UNION ALL
  SELECT 'R4', 'partner_status_updates INSERT policies: vendor-only (no agency INSERT, so agency override insert is RLS-refused)',
         'Partners can insert their own status updates',
         (SELECT string_agg(policyname, ', ' ORDER BY policyname) FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'partner_status_updates' AND cmd IN ('INSERT', 'ALL'))
  UNION ALL
  SELECT 'R5', 'partner_status_updates rows carrying "[Agency override]" notes (agency-authored, vendor-readable)',
         'record the number',
         (SELECT count(*)::text FROM public.partner_status_updates WHERE notes LIKE '[Agency override]%')
  UNION ALL
  SELECT 'R6', 'project_assignments rows with non-empty bid_notes (agency invite notes, vendor-readable)',
         'record the number',
         (SELECT count(*)::text FROM public.project_assignments WHERE coalesce(btrim(bid_notes), '') <> '')

  -- ---------------------------------------------------------------
  -- Grants: anon / authenticated on every swept table (default Supabase grants).
  -- ---------------------------------------------------------------
  UNION ALL
  SELECT 'G1', 'Swept tables where anon still holds SELECT (RLS is the only barrier)',
         'review: RLS has no anon policy on these, so rows = 0 for anon',
         (SELECT string_agg(t, ', ' ORDER BY t) FROM unnest(ARRAY[
            'payment_milestones','msa_agreements','onboarding_packages','assignment_agreements',
            'project_documents','project_assignments','partner_rfp_response_versions','rfp_magic_tokens',
            'partner_status_updates','milestone_events','partner_rfp_inbox','organizations','profiles',
            'delivery_reviews']) AS t
           WHERE has_table_privilege('anon', 'public.' || t, 'SELECT'))
  UNION ALL
  SELECT 'G2', 'Swept tables with RLS disabled',
         '<none>',
         (SELECT coalesce(string_agg(c.relname, ', ' ORDER BY c.relname), '<none>')
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
             AND c.relname = ANY (ARRAY[
               'payment_milestones','msa_agreements','onboarding_packages','assignment_agreements',
               'project_documents','project_assignments','partner_rfp_response_versions','rfp_magic_tokens',
               'partner_status_updates','milestone_events','partner_rfp_inbox','organizations','profiles',
               'delivery_reviews']))
)
SELECT check_id, finding, expected, observed,
       CASE WHEN expected IN ('review', 'record the number')
              OR expected LIKE 'review:%' OR expected LIKE '> 0%' THEN 'READ'
            WHEN observed = expected THEN 'MATCH'
            ELSE 'MISMATCH' END AS verdict
FROM checks
ORDER BY check_id;
