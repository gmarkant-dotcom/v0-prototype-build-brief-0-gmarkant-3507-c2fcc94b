# Agency gate, hardening and RFP leaks, 2026-10-09

Branch `fix/agency-gate-and-leaks`, cut from `main` at `c988820`. Unattended session. Not pushed, not
merged. This file is updated and committed after each workstream; the final section is the
consolidated report.

## Workstream 0: lockout check

**File:** `supabase/sql-checks/agency-gate-lockout-check.sql`. One read-only `SELECT` (CTEs and
`UNION ALL` only). Not parsed or run: no database access in this session.

It returns `section | severity | subject | detail`:

| Section | What it shows |
|---|---|
| `0 ALERT` | Row 1 is gmarkant@gmail.com: its active organization, `is_lead_agency`, `is_paid`, and **`>>> ALERT: m a r k a n t FAILS G1 - DO NOT MERGE <<<`** if it fails. Row 2 does the same for any org named "m a r k a n t" (spaces ignored). Rows 3-5: who passes G1, who sees the agency product today and loses it, and who has several memberships with no usable `active_org_id` |
| `1 ORG` | Every organization: `is_lead_agency`, `is_vendor`, `is_paid`, member count, member emails with their org role, and whether it passes G1 |
| `2 USER` | Every user: what admits them today (`api_as_is` = role or active_role is agency; `api_via_switch` = switch-role would admit them; `pages` = middleware plus the client wall), and what G1 gives them (agency, or the upgrade screen and 402 with the reason) |
| `3 FLAGS` | Every user with `profiles.is_paid`, `demo_access` or `is_admin` set, and what G1 does to them |
| `4 SWITCH` | Who loses a portal switch once `set_active_role` (113) applies its rule |
| `9 HOWTO` | The existing route and SQL to set the flags. Not performed |

**Finding: `profiles.is_paid` and `demo_access`.**

- `profiles.is_paid` admits nobody to the agency side on `main` already. 092 copied it to
  `organizations.is_paid` (`092_org_entitlement.sql:607-616`) and moved every gate there. Its only
  remaining reader is `canUploadVendorFiles` (`lib/entitlements.ts:726-730`), on the vendor side. G1
  changes nothing for it.
- `profiles.demo_access` is read only by the demo-host branch of `middleware.ts:70-81` and by
  `PaidUserContext`. The demo-host page branch is unchanged. Agency **API** routes on the demo host now
  return 402 unless that deployment sets `NEXT_PUBLIC_IS_DEMO=true` (the `isDemoDeployment()` bypass is
  kept). A `Host` header is client-controlled, so the API gate does not exempt by hostname.
- `profiles.is_admin` **is** a live path today: it bypasses the client wall
  (`components/agency-subscription-gate.tsx:83`) and `resolveAgencyEntitlement`
  (`lib/entitlements.ts:517`). G1, as ruled, does not honour it, so an admin whose active organization
  is not lead and paid loses the agency side. `/admin` and `/api/admin/*` are unaffected. Section 3
  lists each such admin.

**How a human sets the flags (not performed):**

- `organizations.is_paid`: as a platform admin, `/admin/users`, toggle Paid on a member. That is
  `PATCH /api/admin/users/<userId>/flags {"is_paid": true}`
  (`app/api/admin/users/[userId]/flags/route.ts:157-161`, service role). Alternative: the signed magic
  link `GET /api/admin/grant-access` (`app/api/admin/grant-access/route.ts:191-195`). Or SQL Editor:
  `UPDATE public.organizations SET is_paid = true, updated_at = now() WHERE id = '<org id>';`
- `organizations.is_lead_agency`: **no application route writes it.** Only 079's backfill and
  `handle_new_user` do. SQL Editor as `postgres`:
  `UPDATE public.organizations SET is_lead_agency = true, updated_at = now() WHERE id = '<org id>';`
  092's guard (`organizations_guard_columns`) exempts it because `auth.uid()` is NULL there.

**What you must confirm before merging:** section 0 row 1 reads `OK`; section 0 row 4 lists only
accounts you intend to lock out; section 4 lists only accounts that may lose a portal switch.

## Workstream 1: G1 agency gate (code + migration 113)

### The helper: extended, not new

`feat/m1-entitlements` holds one docs-only commit (`docs/091-entitlements-surface.md`); its findings
were built on `main` by 092. The existing helper is `resolveAgencyEntitlement()` on `main`
(`lib/entitlements.ts`). It is **extended**:

- `resolveAgencyGate(userId, client)` (`lib/entitlements.ts:556`) resolves the active organization
  with `resolveActingOrgId()` (org_members, plus `profiles.active_org_id` when there are several,
  which 090 guards), reads `organizations.is_lead_agency, is_paid`, and returns
  `gate: "entitled" | "not_lead_agency" | "not_paid"`, the finer `reason`, and `fault` (lookup error
  or missing row).
- `resolveAgencyEntitlement()` (`:511`) now delegates to it. **Its `profiles.is_admin` bypass is
  removed**, so `hasAgencyEntitlement`, `canUseAgencyAi` (`:707`, also lost its admin and role
  tests) and the page wall all read the same predicate.
- `hasAnyEntitledOrganization` (`:637`) and `hasVendorOrganization` (`:656`) are display helpers
  for the role toggle and the upgrade screen.
- API wrappers in `lib/api-auth.ts`: `agencyGateRefusal` (`:86`), `agencyGateResponse` (`:101`),
  `requireAgencyEntitlement` (`:112`). `requireAgencyRole` (`:133`) is now an alias of
  `requireAgencyEntitlement`, so its 18 importers are gated without edits.
- Refusal: **402** `{"error":"Agency access requires a paid lead-agency account.","code":"agency_entitlement_required","reason":"not_lead_agency"|"not_paid"}`.
  A lookup fault is 500 `code: "agency_entitlement_unavailable"`.

No role column is read by any of it.

### Every gated route (file:line of the gate call)

All 46 files under `app/api/agency/`:

| Route | Gate |
|---|---|
| active-engagements | `route.ts:94` |
| bids/[responseId]/ai-score | `:163` |
| bids/[responseId]/decompose | GET `:66`, POST `:113` |
| bids/[responseId]/evaluation | helper `:32` (GET and PUT) |
| bids/[responseId]/generate-summary | `requireAgencyRole` `:18` |
| bids/compare | `:70` |
| bids/rank | `:29` |
| blob-download | `:62` |
| broadcast-rfp | `:77` |
| broadcast-rfp/resend-invite | `:17` |
| client-cash-flow | GET `:47`, POST `:93`, PATCH `:167` |
| client-projects | `requireAgencyRole` `:36` |
| clients | GET `:27`, POST `:58` |
| clients/[id] | GET `:17`, PATCH `:58` |
| dashboard | `requireAgencyRole` `:139` |
| delivery-reviews | helper `:31` (GET, POST) |
| email-connections | helper `:23` (GET, DELETE) |
| email-scan | helper `:44` (POST, GET) |
| email-scan/import | helper `:23` |
| email-scan/run | helper `:136` |
| library-documents | GET `:16`, POST `:58` |
| library-documents/[id] | PATCH `:14`, DELETE `:86` |
| library-documents/file | `:29` (previously had no role check at all) |
| msa | GET `:35`, POST `:146`, PATCH `:204` |
| msa/ai-schedule | `:69` |
| msa/milestones | GET `:56`, POST `:417`, PATCH `:529`, DELETE `:718` |
| payment-synthesis | `:60` |
| pool/[partnerId] | `:40` |
| pool/[partnerId]/notes | GET `:120`, POST `:160` |
| pool/[partnerId]/performance | helper `:24` |
| pool/add-partner | `:20` |
| pool/client-history | `:25` |
| pool/colleague-connections | `:126` |
| pool/import-spreadsheet | `:23` |
| pool/resend-invitation | `:33` |
| projects/[projectId]/status-updates | GET `:34`, PATCH `:136`, POST `:305` |
| projects/duplicate | `requireAgencyRole` `:20` |
| rfp-closure | `:116` |
| rfp-responses | `:41` |
| rfp-responses/[id] | `:203` |
| rfp/magic-link | helper `:63` (POST, GET) |
| scoring/criteria | GET `:12`, POST `:99` |
| scoring/criteria/[id] | `:13` |
| scoring/templates | `:26` |
| usage | `:11` |
| utilization | `:71` |

Other routes the sweep listed as reachable by a switched vendor:

| Route | Gate |
|---|---|
| `app/api/ai/route.ts` | `:174` |
| `app/api/ai/master-brief/route.ts` | `:48` |
| `app/api/ai/rfp-output-template/route.ts` | `:38` |
| `app/api/documents/extract-text/route.ts` | `:31` |
| `app/api/interpret/{budget,campaigns,directors,timeline}/route.ts` | `:24` each |
| `app/api/brief/save/route.ts` | `:48` |
| `app/api/projects/route.ts` | GET agency branch `:148`, POST `:471` |
| `app/api/projects/[id]/route.ts` | GET `:27`, PATCH `:61` |
| `app/api/projects/[id]/onboarding/deploy/route.ts` | `:38` |
| `app/api/projects/[id]/onboarding-packages/route.ts` | GET `:39`, POST `:146` |
| `app/api/projects/[id]/onboarding-partners/route.ts` | `:41` |
| `app/api/projects/[id]/assignments/route.ts` | GET `:36`, POST `:115`, PATCH agency branch `:389` |
| `app/api/projects/[id]/messages/route.ts` | GET agency branch `:54`, POST agency branch `:201` |
| `app/api/projects/[id]/agreements/[agreementId]/route.ts` | agency branch `:84` |
| `app/api/partnerships/route.ts` | GET agency branch `:106`, POST `:476`, PATCH lead side `:897`, DELETE `:1648` |
| `app/api/auth/google-email/route.ts`, `microsoft-email/route.ts` | `:23` (redirect, not 402) |

Mixed routes keep `active_role` only to CHOOSE a branch; the agency branch is then gated. The vendor
branches are unchanged.

### Pages, middleware, switch

- **Middleware** (`middleware.ts:131-140`): `/agency` and `/agency/*` run `resolveAgencyGate`; a
  refused caller is **rewritten** to `/agency-access?reason=...` (URL kept). The one exemption is
  `/agency/settings/billing` (R6; the client wall still restricts it to owner/admin).
  `/partner` with `active_role = 'agency'` now bounces to `/agency` only if the gate admits
  (`:152`), so a refused caller is never stranded between portals. `isAgencyRoute` is now
  boundary-checked so `/agency-access` is not an agency route.
- **Upgrade screen**: `components/agency-upgrade-screen.tsx`, used by `app/agency-access/page.tsx`
  and by `components/agency-subscription-gate.tsx` (the in-shell wall, which lost its `is_admin`
  bypass). Copy: "Agency access requires a paid lead-agency account" plus **Contact us** (`/contact`).
  No pricing numbers. It also offers "Go to the vendor portal" to members of a vendor company, the
  organization switcher, and sign out.
- **"Switch to Lead Agency" hidden** for users with no entitled organization:
  `components/role-toggle.tsx` (it hides whichever switch the server would refuse).
- `contexts/paid-user-context.tsx`: on agency pages the gate is resolved whatever the role columns
  say.
- **Switch routes**: `app/api/profile/switch-role/route.ts:30`, `app/api/user/active-role/route.ts:27`
  and `app/api/partner/rfps/claim/route.ts:113` go through `switchActiveRole()`
  (`lib/server/active-role-switch.ts:61`): `rpc('set_active_role')`, and on PGRST202/42883 (113
  unapplied) the same rule in code followed by the old direct write. It no longer grants
  `secondary_role = 'partner'`.
- **Auth callback** (`app/auth/callback/route.ts`): its role correction is written on the service
  role (`auth.uid()` NULL, exempt from 113), falling back to the session client without the key.

### Migration 113 (authored, not applied)

Files: `113_role_columns_guard.sql` (BEGIN line 115, COMMIT line 287),
`113_role_columns_guard_down.sql` (BEGIN 24, COMMIT 30), `113_preapply_test.sql`.

- New trigger `profiles_role_columns_guard` (BEFORE UPDATE ON profiles), function
  `profiles_guard_role_columns()`. A session may not change `role` or `secondary_role` (LG113). It
  may change `active_role` only inside `set_active_role()`. Service role, migrations and
  `handle_new_user` are exempt (`auth.uid()` IS NULL, 091's test). 090 and 091 are untouched;
  `handle_new_user` is untouched.
- New `set_active_role(p_role text) RETURNS jsonb`, SECURITY DEFINER, `search_path = public,
  pg_temp`, EXECUTE revoked from PUBLIC and anon, granted to authenticated. 'agency' needs a
  membership in an `is_lead_agency AND is_paid` organization (LG11A); 'partner' needs an
  `is_vendor` membership (LG11B); anything else LG11C. Values come from the CHECK constraints
  (`scripts/001:7`, `047:2-3`), re-read by the pre-flight.
- **How it passes its own guard.** 090's `set_active_org` passes its guard purely because that
  guard enforces a row invariant the function has already validated; 090's guard never reads
  `auth.uid()`. 113 keeps that: the guard re-checks the same membership invariant for the row owner.
  But the invariant alone would let an entitled user PATCH `active_role` from a browser, and 091's
  `auth.uid() IS NULL` exemption cannot see a DEFINER function (inside it `auth.uid()` is still the
  caller). So, as 091's header (091:251-260) anticipates, the function carries a **deliberate
  exemption**: it sets a transaction-local `ligament.set_active_role = <caller uid>` around its one
  UPDATE, and the guard admits a session `active_role` change only when that marker equals both
  `auth.uid()` and the row id **and** the invariant holds.
- **Test assertion IDs** (`113_preapply_test.sql`): R1 role, R2 secondary_role, R3 vendor
  active_role, R4 entitled agency active_role (all direct writes; OK before, LG113 after); F1 vendor
  refused 'agency' (LG11A); F2 agency with its org made unpaid refused (LG11A); F3 paid lead agency
  switches, active_role read back in a separate statement (`agency/agency`, proving it passes the
  guard); F4 vendor switches to partner; F5 agency to partner (expectation by its vendor
  membership); F6 'admin' refused (LG11C); S1/S2 service role still writes role and active_role; Z1
  anon cannot execute (42501); O1 `set_active_org` still works; O2/O3 ordinary and whole-row saves
  still work; P1 profiles policies unchanged; P2 profiles grants unchanged; P3 trigger/grants/
  definer/search_path as authored; P4 no other public function calls `set_config` (INCONCLUSIVE, not
  FAIL, if one does: read it); M migration ran.

**Gates (WS1):** `pnpm exec tsc --noEmit` exit 0. `pnpm lint` (whole repo) fails on many pre-existing
messages; in touched files the only messages are pre-existing (`contexts/paid-user-context.tsx:96`
set-state-in-effect, `lib/entitlements.ts:163` unused directive). One new message in a new file was
fixed before commit.
