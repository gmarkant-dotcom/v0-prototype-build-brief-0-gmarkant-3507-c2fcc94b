-- =====================================================================
-- AGENCY GATE (G1) LOCKOUT CHECK. ONE READ-ONLY QUERY. RUN BEFORE MERGING
-- fix/agency-gate-and-leaks.
--
-- AUTHORED 2026-10-09. NOT RUN: no database access in the authoring session.
-- Expect a typo on the first run; it writes nothing, so a failed run costs
-- nothing and the error names the line. Paste the whole file into the
-- Supabase SQL Editor (role postgres) and Run. Export the grid as CSV.
--
-- WHAT G1 IS (owner ruling, 2026-10-09): the agency side requires the
-- caller's ACTIVE organization to be a lead agency
-- (organizations.is_lead_agency = true) AND paid (organizations.is_paid =
-- true). Nothing else admits: not profiles.role / active_role /
-- secondary_role, not profiles.is_admin, not profiles.is_paid, not
-- profiles.demo_access. The ACTIVE organization is resolved exactly as
-- lib/acting-org.ts resolveActingOrgId() does: the sole membership, or, with
-- several memberships, profiles.active_org_id when it names one of them;
-- otherwise none (ambiguous -> not entitled).
--
-- WHAT "TODAY" MEANS (main at c988820):
--   API (as is)    : role = 'agency' OR active_role = 'agency'. That is the
--                    test in requireAgencyRole (lib/api-auth.ts:54) and the 35
--                    inline copies. 6 routes plus projects POST additionally
--                    need the acting org paid OR profiles.is_admin.
--   API (switch)   : /api/profile/switch-role admits 'agency' when role =
--                    'agency' OR secondary_role = 'agency' OR is_admin
--                    (switch-role/route.ts:56-57).
--   API (anyone)   : role / active_role are self-writable by PostgREST PATCH
--                    today (091 left them unguarded), so EVERY signed-in user
--                    can reach the role-gated routes. Listed once, in the
--                    header row of section 2, not per user.
--   PAGES          : middleware lets anyone whose active_role is not
--                    'partner' into /agency; the client wall
--                    (components/agency-subscription-gate.tsx:83) admits
--                    is_admin OR acting org is_paid.
--
-- READ THE ROWS IN THIS ORDER
--   0 ALERT    : one row per check that must be OK before merging. The first
--                row is the m a r k a n t / gmarkant@gmail.com check. If it
--                says FAILS G1, DO NOT MERGE until the owner has run the fix
--                named in section 9 for that organization.
--   1 ORG      : every organization: is_lead_agency, is_vendor, is_paid,
--                member count, member emails, and whether it passes G1.
--   2 USER     : every user: what admits them to the agency side today, and
--                what they get after G1.
--   3 FLAGS    : every user whose access today comes from profiles.is_paid,
--                profiles.demo_access or profiles.is_admin rather than the
--                organization flags, and what G1 does to them.
--   4 SWITCH   : who loses a portal switch once migration 113 is applied
--                (set_active_role: 'agency' needs a lead+paid membership,
--                'partner' needs a vendor-organization membership).
--   9 HOWTO    : the exact existing route or SQL a human with service-role
--                access uses to set organizations.is_paid / is_lead_agency.
--                NOT PERFORMED by this file.
-- =====================================================================

WITH
mem AS (
  SELECT m.user_id, m.org_id, m.role AS org_role
  FROM public.org_members m
),
mem_count AS (
  SELECT user_id, count(*) AS n FROM mem GROUP BY user_id
),
acting AS (
  SELECT
    p.id AS user_id,
    COALESCE(mc.n, 0) AS memberships,
    CASE
      WHEN mc.n = 1 THEN (SELECT mm.org_id FROM mem mm WHERE mm.user_id = p.id LIMIT 1)
      WHEN mc.n > 1 AND EXISTS (SELECT 1 FROM mem mm WHERE mm.user_id = p.id AND mm.org_id = p.active_org_id)
        THEN p.active_org_id
      ELSE NULL
    END AS acting_org_id,
    CASE
      WHEN COALESCE(mc.n, 0) = 0 THEN 'no-membership'
      WHEN mc.n = 1 THEN 'sole-membership'
      WHEN p.active_org_id IS NULL THEN 'ambiguous'
      WHEN EXISTS (SELECT 1 FROM mem mm WHERE mm.user_id = p.id AND mm.org_id = p.active_org_id) THEN 'stored-preference'
      ELSE 'preference-refused'
    END AS acting_reason
  FROM public.profiles p
  LEFT JOIN mem_count mc ON mc.user_id = p.id
),
u AS (
  SELECT
    p.id,
    lower(btrim(coalesce(p.email, ''))) AS email,
    p.role, p.active_role, p.secondary_role,
    coalesce(p.is_admin, false)    AS is_admin,
    coalesce(p.is_paid, false)     AS profile_is_paid,
    coalesce(p.demo_access, false) AS demo_access,
    a.memberships, a.acting_org_id, a.acting_reason,
    o.name AS acting_org_name,
    o.is_lead_agency, o.is_vendor, o.is_paid AS org_is_paid,
    EXISTS (SELECT 1 FROM mem mm JOIN public.organizations o2 ON o2.id = mm.org_id
             WHERE mm.user_id = p.id AND o2.is_lead_agency AND o2.is_paid) AS any_entitled_org,
    EXISTS (SELECT 1 FROM mem mm JOIN public.organizations o2 ON o2.id = mm.org_id
             WHERE mm.user_id = p.id AND o2.is_vendor) AS any_vendor_org
  FROM public.profiles p
  JOIN acting a ON a.user_id = p.id
  LEFT JOIN public.organizations o ON o.id = a.acting_org_id
),
c AS (
  SELECT
    u.*,
    (u.role = 'agency' OR u.active_role = 'agency')                AS api_as_is,
    (u.role = 'agency' OR u.secondary_role = 'agency' OR u.is_admin) AS api_via_switch,
    (coalesce(u.active_role, u.role, '') <> 'partner')             AS pages_middleware_today,
    (u.is_admin OR coalesce(u.org_is_paid, false))                 AS pages_wall_today,
    coalesce(u.is_lead_agency AND u.org_is_paid, false)            AS g1
  FROM u
),
orgs AS (
  SELECT
    o.id, o.name, o.is_lead_agency, o.is_vendor, o.is_paid,
    (SELECT count(*) FROM mem mm WHERE mm.org_id = o.id) AS members,
    (SELECT string_agg(lower(btrim(coalesce(pp.email, '?'))) || ' (' || mm.org_role || ')', ', ' ORDER BY pp.email)
       FROM mem mm LEFT JOIN public.profiles pp ON pp.id = mm.user_id
      WHERE mm.org_id = o.id) AS member_emails
  FROM public.organizations o
),
markant AS (
  SELECT
    c.*,
    (SELECT string_agg(o3.name || ' [lead=' || o3.is_lead_agency || ' vendor=' || o3.is_vendor || ' paid=' || o3.is_paid || ']', '; ')
       FROM mem mm JOIN public.organizations o3 ON o3.id = mm.org_id WHERE mm.user_id = c.id) AS all_orgs
  FROM c
  WHERE c.email = 'gmarkant@gmail.com'
),
rows AS (
  ---------------------------------------------------------------------
  -- 0 ALERT
  ---------------------------------------------------------------------
  SELECT 0 AS sec, 1 AS ord,
         CASE WHEN NOT EXISTS (SELECT 1 FROM markant) THEN 'ALERT: NO SUBJECT'
              WHEN (SELECT bool_and(g1) FROM markant) THEN 'OK'
              ELSE '>>> ALERT: m a r k a n t FAILS G1 - DO NOT MERGE <<<' END AS severity,
         'gmarkant@gmail.com (m a r k a n t)' AS subject,
         coalesce((SELECT format('acting org %s "%s" via %s: is_lead_agency=%s is_paid=%s -> %s. All memberships: %s',
                                 coalesce(acting_org_id::text, 'NONE'), coalesce(acting_org_name, '?'), acting_reason,
                                 coalesce(is_lead_agency::text, 'null'), coalesce(org_is_paid::text, 'null'),
                                 CASE WHEN g1 THEN 'PASSES G1' ELSE 'FAILS G1: after deploy this account sees the upgrade screen and every agency API returns 402. Fix with section 9 BEFORE merging.' END,
                                 coalesce(all_orgs, 'none'))
                   FROM markant LIMIT 1),
                  'gmarkant@gmail.com has no profile row. The cross-check cannot run.') AS detail
  UNION ALL
  SELECT 0, 2,
         CASE WHEN EXISTS (SELECT 1 FROM orgs WHERE lower(replace(name, ' ', '')) = 'markant' AND NOT (is_lead_agency AND is_paid))
              THEN '>>> ALERT: an org named m a r k a n t FAILS G1 <<<'
              WHEN EXISTS (SELECT 1 FROM orgs WHERE lower(replace(name, ' ', '')) = 'markant') THEN 'OK'
              ELSE 'INFO: no org named m a r k a n t' END,
         'organization(s) named m a r k a n t (spaces ignored)',
         coalesce((SELECT string_agg(format('%s "%s" lead=%s vendor=%s paid=%s members=%s', id, name, is_lead_agency, is_vendor, is_paid, members), '; ')
                     FROM orgs WHERE lower(replace(name, ' ', '')) = 'markant'), 'none')
  UNION ALL
  SELECT 0, 3,
         CASE WHEN (SELECT count(*) FROM c WHERE g1) = 0 THEN '>>> ALERT: NOBODY PASSES G1 <<<' ELSE 'INFO' END,
         'users who pass G1 after deploy',
         (SELECT count(*)::text || ' user(s): ' || coalesce(string_agg(email, ', ' ORDER BY email), '') FROM c WHERE g1)
  UNION ALL
  SELECT 0, 4,
         CASE WHEN count(*) > 0 THEN 'REVIEW' ELSE 'OK' END,
         'users who see the agency product TODAY (middleware + wall) and LOSE it under G1',
         count(*)::text || ' user(s): ' || coalesce(string_agg(email || ' [' || CASE WHEN is_admin AND NOT coalesce(org_is_paid, false) THEN 'admin bypass' WHEN NOT coalesce(is_lead_agency, false) THEN 'org not lead agency' WHEN NOT coalesce(org_is_paid, false) THEN 'org not paid' ELSE acting_reason END || ']', ', ' ORDER BY email), '')
  FROM c WHERE pages_middleware_today AND pages_wall_today AND NOT g1
  UNION ALL
  SELECT 0, 5,
         CASE WHEN count(*) > 0 THEN 'REVIEW' ELSE 'OK' END,
         'users with several memberships and no usable active_org_id (G1 refuses them as ambiguous)',
         count(*)::text || ' user(s): ' || coalesce(string_agg(email || ' [' || acting_reason || ']', ', ' ORDER BY email), '')
  FROM c WHERE memberships > 1 AND acting_org_id IS NULL

  ---------------------------------------------------------------------
  -- 1 ORG
  ---------------------------------------------------------------------
  UNION ALL
  SELECT 1, 0, 'HEADER', 'id | name',
         'is_lead_agency | is_vendor | is_paid | members | member emails (org role) | G1 for members acting for it'
  UNION ALL
  SELECT 1, 1,
         CASE WHEN o.is_lead_agency AND o.is_paid THEN 'PASSES G1'
              WHEN o.is_lead_agency THEN 'lead, NOT PAID'
              ELSE 'vendor org: never passes G1' END,
         o.id::text || ' | ' || o.name,
         format('lead=%s | vendor=%s | paid=%s | members=%s | %s',
                o.is_lead_agency, o.is_vendor, o.is_paid, o.members, coalesce(o.member_emails, '(no members)'))
  FROM orgs o

  ---------------------------------------------------------------------
  -- 2 USER: TODAY vs AFTER G1
  ---------------------------------------------------------------------
  UNION ALL
  SELECT 2, 0, 'HEADER', 'email',
         'TODAY: every signed-in user can PATCH profiles.active_role to agency and reach the 52 role-gated routes (leak sweep, finding 2). The columns below are what admits each user WITHOUT that.'
  UNION ALL
  SELECT 2, 1,
         CASE WHEN g1 THEN 'AFTER: AGENCY OK'
              WHEN api_as_is OR api_via_switch OR (pages_middleware_today AND pages_wall_today) THEN 'AFTER: LOSES AGENCY'
              ELSE 'AFTER: no change (vendor only)' END,
         email,
         format('TODAY api_as_is=%s api_via_switch=%s pages=%s | role=%s active_role=%s secondary_role=%s is_admin=%s | acting org %s "%s" (%s) lead=%s paid=%s | AFTER: %s',
                api_as_is, api_via_switch, (pages_middleware_today AND pages_wall_today),
                coalesce(role, 'null'), coalesce(active_role, 'null'), coalesce(secondary_role, 'null'), is_admin,
                coalesce(acting_org_id::text, 'NONE'), coalesce(acting_org_name, '?'), acting_reason,
                coalesce(is_lead_agency::text, 'null'), coalesce(org_is_paid::text, 'null'),
                CASE WHEN g1 THEN 'agency pages and API admitted'
                     WHEN acting_org_id IS NULL THEN 'upgrade screen; API 402 agency_entitlement_required (no active organization: ' || acting_reason || ')'
                     WHEN NOT coalesce(is_lead_agency, false) THEN 'upgrade screen; API 402 agency_entitlement_required (reason not_lead_agency)'
                     ELSE 'upgrade screen; API 402 agency_entitlement_required (reason not_paid)' END)
  FROM c

  ---------------------------------------------------------------------
  -- 3 FLAGS: access that comes from a PROFILE flag, not the organization
  ---------------------------------------------------------------------
  UNION ALL
  SELECT 3, 0, 'HEADER', 'email',
         'profiles.is_paid: read by NO agency gate on main since 092 (only canUploadVendorFiles, vendor side). profiles.demo_access: read only by the demo-host branch of middleware.ts:70-81 and PaidUserContext. profiles.is_admin: bypasses the client wall and resolveAgencyEntitlement today. G1 honours none of the three.'
  UNION ALL
  SELECT 3, 1,
         CASE WHEN g1 THEN 'NO EFFECT (org passes G1)'
              WHEN is_admin THEN 'LOSES AGENCY (admin bypass removed)'
              WHEN demo_access THEN 'DEMO HOST ONLY'
              ELSE 'ALREADY NOT ADMITTED (profiles.is_paid unread since 092)' END,
         email,
         format('profiles.is_paid=%s demo_access=%s is_admin=%s | acting org "%s" lead=%s org.is_paid=%s | G1: %s',
                profile_is_paid, demo_access, is_admin, coalesce(acting_org_name, 'NONE'),
                coalesce(is_lead_agency::text, 'null'), coalesce(org_is_paid::text, 'null'),
                CASE WHEN g1 THEN 'passes on the organization flags; the profile flags are irrelevant'
                     WHEN is_admin THEN 'today the admin bypass (agency-subscription-gate.tsx:83, entitlements.ts:517) admits this user to agency pages and the entitlement-gated routes; after G1 they get the upgrade screen and 402. /admin pages and /api/admin/* are unaffected (is_admin still gates those).'
                     WHEN demo_access THEN 'demo.withligament.com pages still render (middleware demo branch unchanged); agency API routes return 402 unless that deployment sets NEXT_PUBLIC_IS_DEMO=true (isDemoDeployment bypass kept).'
                     ELSE 'profiles.is_paid admitted nothing on main already: 092 copied it to organizations.is_paid and moved every gate there. G1 changes nothing for this flag.' END)
  FROM c
  WHERE profile_is_paid OR demo_access OR is_admin

  ---------------------------------------------------------------------
  -- 4 SWITCH: after migration 113
  ---------------------------------------------------------------------
  UNION ALL
  SELECT 4, 0, 'HEADER', 'email',
         'After 113, set_active_role(''agency'') needs a membership in a lead+paid org and set_active_role(''partner'') needs a membership in an is_vendor org. Before 113 the deployed code applies the same rule in the route.'
  UNION ALL
  SELECT 4, 1,
         CASE WHEN NOT any_vendor_org AND NOT any_entitled_org THEN 'NO SWITCH EITHER WAY'
              WHEN NOT any_vendor_org THEN 'LOSES "Switch to Vendor Mode"'
              ELSE 'LOSES "Switch to Lead Agency"' END,
         email,
         format('role=%s active_role=%s secondary_role=%s | member of a vendor org=%s, of a lead+paid org=%s | stays in active_role %s until switched',
                coalesce(role, 'null'), coalesce(active_role, 'null'), coalesce(secondary_role, 'null'),
                any_vendor_org, any_entitled_org, coalesce(active_role, role, 'null'))
  FROM c
  WHERE (NOT any_vendor_org AND (role = 'partner' OR secondary_role = 'partner' OR active_role = 'agency' OR role = 'agency'))
     OR (NOT any_entitled_org AND (role = 'agency' OR secondary_role = 'agency' OR is_admin))

  ---------------------------------------------------------------------
  -- 9 HOWTO. Not performed. For a human with service-role / SQL Editor access.
  ---------------------------------------------------------------------
  UNION ALL
  SELECT 9, 1, 'HOWTO', 'organizations.is_paid (existing admin route)',
         'Signed in as a platform admin: /admin/users, toggle Paid on any member of the org. That calls PATCH /api/admin/users/<userId>/flags {"is_paid": true} (app/api/admin/users/[userId]/flags/route.ts:157-161, service role, writes organizations.is_paid on the user''s organization). Alternative: the signed magic link GET /api/admin/grant-access (app/api/admin/grant-access/route.ts:191-195).'
  UNION ALL
  SELECT 9, 2, 'HOWTO', 'organizations.is_paid (SQL Editor, role postgres)',
         'UPDATE public.organizations SET is_paid = true, updated_at = now() WHERE id = ''<org id from section 1>'' RETURNING id, name, is_lead_agency, is_paid;  -- 092''s organizations_guard_columns exempts it (auth.uid() IS NULL in the SQL Editor).'
  UNION ALL
  SELECT 9, 3, 'HOWTO', 'organizations.is_lead_agency (NO route exists; SQL only)',
         'UPDATE public.organizations SET is_lead_agency = true, updated_at = now() WHERE id = ''<org id>'' RETURNING id, name, is_lead_agency, is_vendor, is_paid;  -- No application route writes is_lead_agency (only 079''s backfill and handle_new_user). CHECK organizations_has_a_capability (is_lead_agency OR is_vendor) holds either way. Run as postgres in the SQL Editor; a signed-in session is refused LG008 by 092''s guard.'
)
SELECT
  CASE sec WHEN 0 THEN '0 ALERT' WHEN 1 THEN '1 ORG' WHEN 2 THEN '2 USER' WHEN 3 THEN '3 FLAGS'
           WHEN 4 THEN '4 SWITCH' ELSE '9 HOWTO' END AS section,
  severity,
  subject,
  detail
FROM rows
ORDER BY sec, ord, severity, subject;
