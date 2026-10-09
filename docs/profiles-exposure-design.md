# profiles and organizations exposure: design only, 2026-10-09

Branch `fix/agency-gate-and-leaks`. **Design, not implemented.** No migration, no code change. Built
from the repository (migrations, `scripts/`, route code); the live column list was not read, so the
first query below is the check.

## Headline

**RLS on `profiles` admits whole rows, and two policies admit them widely.** Any signed-in user
reads every column of every *discoverable* profile (`scripts/016-marketplace-discoverability.sql:8-12`,
still live per `docs/schema-snapshot-2026-08-13.md:202`). Any counterparty, at any partnership status
except terminated/removed, reads every column of the other side's members (079:1562-1567 via
`current_user_visible_profile_ids()`, 085:392-403). That includes **`legal_ein`, `legal_address`,
`legal_entity_*`, `rate_info`, `payment_terms`, `default_terms`, `business_criteria`,
`default_nda_url`** and the authority flags **`is_paid`, `is_admin`, `demo_access`**. Every route
masks these, but PostgREST is one GET away with the public anon key. A pending partnership, which an
agency creates unilaterally, is enough to read a vendor's EIN. G3 rules legal and billing fields
non-counterparty-only and the flags never vendor-readable, so both are currently out of ruling.

`organizations` carries no legal or billing column. Its one sensitive column is `is_paid`, readable
by every counterparty at any status (079:1793-1795 via `current_user_counterparty_org_ids()`,
079:738-756).

## 1. Columns and who can read them today

Readers: **Self** (`id = auth.uid()`), **Org** (members of my organizations), **Counterparty**
(`current_user_visible_profile_ids()`: own-org members plus members of organizations I have a
partnership with whose status is not terminated/removed, 085:392-403), **Any** (any authenticated
user, when `is_discoverable = true`). Every reader sees **every** column of an admitted row.

### profiles

| Column | Added by | Class | Read today by |
|---|---|---|---|
| id, email, full_name, company_name, role, phone, avatar_url, timezone, notification_email, notification_sms, created_at, updated_at | `scripts/001:2-15` | identity / contact (email: contact) | Self, Org, Counterparty, Any |
| is_discoverable | `scripts/016:3-4` | flag | same |
| bio, location, website, agency_type, display_name, notification_preferences | `scripts/017:4-11` | public profile (bio may carry rates, `app/api/partner/rate-info/route.ts:13,171`) | same |
| meeting_url | `scripts/020:2-3` | contact | same |
| **rate_info** | `scripts/030:4-5` | **billing** | same |
| **payment_terms, payment_terms_custom** | `scripts/033:2-4` | **billing** | same |
| credentials, work_examples, reel_url, capabilities | `scripts/034`, `035` | public profile | same |
| **legal_entity_name, legal_entity_type, legal_ein, legal_address, legal_state_of_incorporation** | `scripts/036:1-6` | **legal** | same |
| company_website, company_linkedin_url, personal_linkedin_url | 040, 049 | public profile | same |
| secondary_role, active_role | 047 | portal preference (guarded by 113) | same |
| **default_nda_url** | 050 | **legal** | same |
| **business_criteria** | 060 | **legal/compliance** (insurance limits, COI URL) | same |
| **default_terms** | 070 | **billing/legal** (payment terms, kill fee, IP, rate validity) | same |
| title | 086 | identity | same |
| active_org_id | 090 | preference | same |
| **is_paid, is_admin, demo_access, linked_agency_id** | no DDL in repo; guarded by 091 | **authority** | same |
| company_logo_url, capabilities_overview_url | no DDL in repo | public profile | same |

### organizations

| Column | Added by | Read today by |
|---|---|---|
| id, name, primary_contact_user_id, is_lead_agency, is_vendor, created_at, updated_at | 079:194-228 | members (079:1748-1750) and every counterparty at any status (079:1793-1795) |
| **is_paid** | 092:487-488 | same. **Authority; G3 says never vendor-readable** |

## 2. Which screens read which columns

**Self** (own row): `app/agency/settings/profile/page.tsx:130-132` (default_nda_url, payment_terms,
payment_terms_custom, business_criteria), `app/partner/legal/page.tsx:142-144` (legal_*,
business_criteria), `app/partner/page.tsx:251` (`select("*")`, legal completeness `:270-310`),
`app/partner/profile/page.tsx:204-206`, `app/partner/rfps/[id]/page.tsx:773`, `:823`
(business_criteria, default_terms), `app/agency/page.tsx:263`, `app/api/agency/msa/ai-schedule/route.ts`
(payment_terms), `app/api/partner/rate-info/route.ts:162-279`, `contexts/paid-user-context.tsx:140`
(is_admin, linked_agency_id, demo_access), the two settings/user pages, `lib/api-auth.ts`.

**Counterparty:** `app/api/agency/pool/[partnerId]/route.ts:68-83` (business_criteria, rate_info only
with an active partnership `:170`), `app/api/partner/network/[agencyId]/route.ts:132-146`
(business_criteria; payment_terms nulled below active `:279-322`), `app/agency/pool/page.tsx:615-618`
(**browser client**, business_criteria at any status), identity-only reads in ~12 routes, and the
`ORG_CONTACT_SELECT*` embeds (`lib/org-contact.ts:90-118`: name, email, meeting_url, capabilities,
logo) in ~15 routes.

**Any (discoverable):** `app/api/marketplace/discoverable/route.ts:30-37` (business_criteria,
public profile fields; email masked `:84-90`), used by `components/marketplace-content.tsx:107`,
`app/partner/network/page.tsx:504`, `app/partner/marketplace/page.tsx:90`.

**Service role:** `app/api/rfp/guest/[token]/route.ts:218,240` (agency name, logo),
`app/api/admin/users/route.ts`.

No screen reads another user's `legal_*`, `rate_info` (except the active-partnership tier),
`default_terms` or authority flags. The exposure is PostgREST-only, which is why it can be closed
without a product change.

## 3. Proposed fix: two agency/self-only split tables, code first, 105-112's pattern

**Table A: `profile_private` (self-only).** Columns moved: `legal_entity_name, legal_entity_type,
legal_ein, legal_address, legal_state_of_incorporation, rate_info, payment_terms,
payment_terms_custom, default_terms, default_nda_url, business_criteria` plus the authority set
`is_paid, is_admin, demo_access, linked_agency_id`. Key `profile_id`. Policies: SELECT/UPDATE
`profile_id = auth.uid()` only; authority columns written only by the service role (091's guard moves
with them). No anon or PUBLIC grant; `authenticated` granted SELECT/INSERT/UPDATE only.

**Counterparty disclosure of the commercial tier** (085 ruled `default_terms`, `business_criteria`,
`default_nda_url` disclosable to a live counterparty, and G3 rules legal/billing readable by
counterparties): not by RLS on the private table, but by SECURITY DEFINER read functions that return
only the ruled fields for a profile the caller is a *commercial* counterparty of, e.g.
`counterparty_commercial_terms(p_profile_id uuid)` and `counterparty_legal_identity(p_profile_id
uuid)` (the latter for the MSA/contract surfaces), each checking
`current_user_commercial_counterparty_org_ids()` and returning nothing otherwise. Discoverable
readers get neither.

**Table B: `organization_private`** for `organizations.is_paid` (and any future billing column):
member-only SELECT, service-role write; 092's guard moves with it. `resolveAgencyGate`
(`lib/entitlements.ts:556`) reads it, falling back to `organizations.is_paid` on 42P01/PGRST205.

**Order, exactly as 105-112:**
1. Migration N: create both tables, backfill, add guards. Nothing reads them yet.
2. Code: every self reader and writer of the moved columns goes through
   `lib/server/profile-private.ts` (read table, fall back to `profiles` on 42P01/PGRST205); counterparty
   readers move to the two functions; `resolveAgencyGate` reads `organization_private`.
3. Migration N+1: drift pre-flight, null the moved `profiles` columns and `organizations.is_paid`,
   add 110-style guards refusing any non-null write. Columns are not dropped.
4. Later: drop columns and the fallbacks together.

**Files it would touch:** `app/partner/legal/page.tsx`, `app/partner/page.tsx`,
`app/partner/profile/page.tsx`, `app/partner/rfps/[id]/page.tsx`, `app/agency/settings/profile/page.tsx`,
`app/agency/page.tsx`, `app/api/partner/rate-info/route.ts`, `app/api/agency/msa/ai-schedule/route.ts`,
`app/api/agency/pool/[partnerId]/route.ts`, `app/api/partner/network/[agencyId]/route.ts`,
`app/agency/pool/page.tsx`, `app/api/marketplace/discoverable/route.ts`, `lib/company-identity.ts`
(writes business_criteria, payment terms, default_nda_url), `lib/partner-rate-info-read.ts`,
`lib/business-criteria.ts`, `contexts/paid-user-context.tsx`, `middleware.ts` (demo branch reads
demo_access, is_admin), `lib/api-auth.ts` (`requireAdminRole` reads is_admin),
`app/api/admin/users/route.ts`, `app/api/admin/users/[userId]/flags/route.ts`,
`app/api/admin/grant-access/route.ts`, `app/auth/callback/route.ts`, `lib/entitlements.ts`, and a new
`lib/server/profile-private.ts`.

**Cheaper interim, if the split waits:** drop the discoverable policy's whole-row reach by replacing
`scripts/016`'s policy with a SECURITY DEFINER `discoverable_profiles()` function returning only the
marketplace columns, and point `app/api/marketplace/discoverable/route.ts` at it. That closes the
"Any" column of the table above (the widest one) in one migration plus one route.

## 4. Read-only count (SQL Editor)

Discoverable vendor profiles whose legal fields are populated, i.e. readable today by any signed-in
user:

```sql
SELECT
  count(*)                                                     AS discoverable_vendor_profiles,
  count(*) FILTER (WHERE nullif(btrim(p.legal_ein), '') IS NOT NULL)            AS with_ein,
  count(*) FILTER (WHERE nullif(btrim(p.legal_address), '') IS NOT NULL)        AS with_legal_address,
  count(*) FILTER (WHERE nullif(btrim(p.legal_entity_name), '') IS NOT NULL)    AS with_legal_entity_name,
  count(*) FILTER (WHERE p.rate_info IS NOT NULL AND p.rate_info::text NOT IN ('{}', 'null')) AS with_rate_info,
  count(*) FILTER (WHERE p.default_terms IS NOT NULL)                           AS with_default_terms,
  count(*) FILTER (WHERE nullif(btrim(coalesce(p.legal_ein, '')), '') IS NOT NULL
                      OR nullif(btrim(coalesce(p.legal_address, '')), '') IS NOT NULL
                      OR nullif(btrim(coalesce(p.legal_entity_name, '')), '') IS NOT NULL) AS with_any_legal_field
FROM public.profiles p
WHERE p.is_discoverable = true
  AND (p.role = 'partner'
       OR EXISTS (SELECT 1 FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
                   WHERE m.user_id = p.id AND o.is_vendor));
```

`docs/invitation-diagnosis.md:519` recorded 2 discoverable profiles at the time; re-measure.
