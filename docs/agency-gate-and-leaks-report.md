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

## Workstream 2: hardening (migration 114, authored, not applied)

Files: `114_hardening.sql` (BEGIN line 93, COMMIT line 305), `114_hardening_down.sql` (BEGIN 21,
COMMIT 85), `114_preapply_test.sql`. No application code changes. Independent of 113 and 115.

**1. WITH CHECK (USING unchanged), by ALTER POLICY.** Verified against the policy text as last
defined (079; no later migration touches these four; 073 never applied):

| Table / policy | Before (079) | After |
|---|---|---|
| `delivery_reviews` "Agencies manage own delivery reviews" (079:1202-1205) | `org_id IN current_user_org_ids()` | plus the partnership's `lead_org_id = org_id` AND the project's `org_id = org_id` |
| `delivery_review_scores` "Agencies manage own delivery review scores" (079:1216-1225) | parent's `org_id IN current_user_org_ids()` | plus the same two tests on the parent review |
| `msa_agreements` "Agency can manage their MSAs" (079:1239-1242) | `org_id IN ...` | plus `partnership_id IS NULL OR` the partnership's `lead_org_id = org_id` |
| `rfp_magic_tokens` "Agency can manage their own tokens" (079:1666-1668) | USING only (no WITH CHECK) | `org_id IN ...` plus `project_id IS NULL OR` the project's `org_id = org_id` |

**Skipped, the sweep's description does not hold:**
- `clients`: no `partnership_id` or `project_id` column (`077:36-55`); nothing foreign to name.
- `usage_tracking`: no foreign reference (`067:1-11`). **Separate observation, not fixed:** its ALL
  policy lets any member write its own organization's row, so an agency member could reset its own
  `ai_analyses_count` or raise `analyses_limit` by PostgREST. That is quota tampering within one's own
  organization, not a cross-tenant write. It needs a write guard or a service-role-only write path.

Pre-flight LG114 refuses if any existing row already names another organization's partnership or
project (P1 in the file lists them), because its next UPDATE would be refused. The owner-verified
count of forged delivery reviews is 0.

**2. TRUNCATE, REFERENCES, TRIGGER revoked from anon and authenticated on every `public` table**
(relkind `r` and `p`), by a loop over `pg_class` at apply time; SELECT/INSERT/UPDATE/DELETE
untouched. **The table list is the apply-time catalog, not a list in this file**: the migration
raises a NOTICE with the count and V2 must return 0. Views and sequences are not touched.

**3. Default privileges.** `ALTER DEFAULT PRIVILEGES FOR ROLE <owner> IN SCHEMA public REVOKE
TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated` for every role that owns a public
table (expected: `postgres`). Each runs in its own exception block: `insufficient_privilege` is
RAISE NOTICE "REPORTED, NOT CHANGED", never a failure. Outcome is unknown until applied; the test's
S3 reads `pg_default_acl` and reports INCONCLUSIVE with the role name if anything remains.

**4. Helper EXECUTE.** For `current_user_org_ids`, `current_user_admin_org_ids`,
`current_user_counterparty_org_ids`, `current_user_visible_profile_ids`,
`current_user_active_counterparty_user_ids`, `current_user_commercial_counterparty_org_ids` (the
six: 089, 094 and 096 already revoked `current_user_email`, `current_user_org_member_user_ids`,
`current_user_commercial_counterparty_user_ids` from anon): GRANT to authenticated, REVOKE from anon
and PUBLIC. **The "no anon/PUBLIC policy calls them" confirmation is done in the migration itself**,
per function, against `pg_policies` (`roles && {public,anon}` and the name in `qual`/`with_check`);
a helper that fails the check is kept and reported by NOTICE. From the repository, every policy
since 079 that calls them is `TO authenticated`, so none is expected to be kept; the test's H1
expectation is computed the same way.

**5. Reliability guard.** `partnerships_reliability_columns_guard`, BEFORE INSERT OR UPDATE, 110's
shape: refuses (LG114) any write leaving `reliability_summary` or `reliability_summary_generated_at`
non-null, for every caller including the service role (as 110 does). The only code writer is
`writeReliabilityCache`'s legacy fallback (`lib/server/partnership-private-reliability.ts:123-127`),
reachable only if 107's table is missing, which it is not. Every other partnerships write passes.

**Test assertion IDs** (`114_preapply_test.sql`): D1 vendor delivery review on the agency's
partnership (OK before, 42501 after); D2 agency review still works; D3 vendor score on its forged
review (42501 after); D4 agency score still works; M1/M2 the same for MSA rows; T1/T2 the same for
magic tokens; G1 anon and G2 authenticated lose TRUNCATE/REFERENCES/TRIGGER on six sample tables; G3
authenticated keeps SELECT/INSERT/UPDATE/DELETE; H1 anon helper count (6 before, kept count after),
H2 authenticated keeps all six, H3 anon calling `current_user_org_ids()` (42501 after); L1 service
role and L2 agency refused LG114 on reliability, L3 service role's ordinary write still works; S1
USING unchanged; S2 guard shape; S3 default privileges (PASS, or INCONCLUSIVE "reported"); M.

## Workstream 3: RFP leaks. STOPPED ON ITS FIRST CHECK. Nothing changed, no migration 115.

The brief's first step: "If any agency screen reads master_rfp_json FROM partner_rfp_inbox (the
vendor copies), STOP this workstream and report; strip nothing the agency depends on." **It does.**

**There is no agency-side source of truth for RFP content in the database.** The wizard's master RFP
is React state (`app/agency/page.tsx:396-413`, assembled at `:895-909`) plus a `localStorage` draft
(`:685-700`). The only server copies are the per-recipient `partner_rfp_inbox.master_rfp_json`
snapshots written at broadcast (`app/api/agency/broadcast-rfp/route.ts:257`, `:402`) and, for the
magic-link flow, `rfp_magic_tokens` plus live `projects` columns. No migration or script creates a
master-RFP table or column.

**Agency readers of the vendor copies (re-read on this branch):**

| Agency surface | Reads from `partner_rfp_inbox.master_rfp_json` |
|---|---|
| Bid rubric for scoring: `lib/rfp-evaluation-criteria-server.ts:76-82`, used by `bids/[responseId]/evaluation` (`:98`, `:176`), `ai-score` (`:198`), `lib/bid-summary-generation.ts:55` | `evaluation_criteria` |
| Bid list and compare: `app/api/agency/rfp-responses/route.ts:213` (select), `:293-297`, `:316`; `components/bid-compare-view.tsx:606`, `bid-detail-sheet.tsx:130` | `business_criteria_required`, `budget_categories` |
| Award and decline: `app/api/agency/rfp-responses/[id]/route.ts:369`, `:740`, `:1050`, `:1151`, `:1182` | `projectName`, whole object |
| Guest-bid join: `app/api/agency/rfp-responses/[id]/route.ts:90-92`, `:413-415`; `lib/magic-token-attach.ts:108` | `_magic_token` (the JOIN KEY) |
| Engagement history: `app/api/agency/pool/[partnerId]/route.ts` via `lib/engagement-history.ts:47-49` | `projectName` |

Stripping `evaluation_criteria` would blank every rubric the agency scores against; stripping
`budget_categories` breaks bid comparison; stripping `_magic_token` breaks award/decline of guest
bids. So nothing is stripped, the G5 toggle is not added (it needs a source-of-truth row to live on),
and 115 is not authored.

**`_magic_token` finding (not flagged at the top: it is not cross-vendor).** It holds
`rfp_magic_tokens.token`, the bearer credential behind `/rfp/respond/{token}`, written only at
`lib/magic-token-attach.ts:319` into the inbox row created for the vendor whose email the token was
issued to. So it is the receiving vendor's OWN token: holding it lets that vendor act as the guest for
its own invitation, which it already can. It does not let one vendor act as another. Two exposures
remain: the token is copied into notification `data` (`lib/magic-token-attach.ts:421`), which fans
out to every member of the vendor's organization, and it reaches the vendor browser through
`select("*")` (`app/api/partner/rfps/route.ts:233`, `[id]/route.ts:25`). Both are same-organization.

**What a follow-up needs, in order (not done):**
1. An agency-only source-of-truth row for each broadcast RFP (a table keyed on project and broadcast,
   holding the master JSON, the rubric, budget categories and the G5 `show_client_to_vendors boolean
   NOT NULL DEFAULT false`), written by broadcast-rfp and magic-link, code first.
2. Move the five agency readers above to it, keeping the inbox read as a fallback for rows written
   before it existed. `_magic_token` needs its own non-JSON join key first (an inbox column, or the
   existing `scope_item_id = magic:<token>` form `lib/magic-token-attach.ts:62-64` already writes).
3. Only then build per-vendor copies (own scope line and budget only; no `totalBudget`,
   `budget_categories`, other lines, rubric; client only when the toggle is on) and author 115 to
   scrub existing copies, with the source-of-truth fingerprint guard.
4. **Independent of all three and the most urgent item found:** `app/api/rfp/guest/[token]/route.ts`
   returns the whole `rfp_magic_tokens` row (`token: tokenRow`, `:293`, `:314`) to an
   unauthenticated link holder, including `reference_materials.output_template_config`,
   `evaluation_criteria`, `budget_categories` and `domain_match_profile_id`. That fix touches no
   inbox copy and no agency reader; it is held back here only because this workstream is stopped.
