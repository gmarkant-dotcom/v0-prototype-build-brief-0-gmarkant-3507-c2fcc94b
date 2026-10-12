# Consolidated run report, 2026-10-12 (five workstreams, two branches)

Unattended. Nothing pushed, nothing merged into main, nothing applied. No database access, no
network, no install. Detailed reports: `docs/guest-profiles-records-report.md` (branch 1),
`docs/budget-spine-integrated-report.md` (branch 2), `docs/rfp-source-of-truth-design.md` (branch 1),
`docs/state-of-record-2026-10-12.md` (branch 2).

## 0. Branches, commits, state-of-record

| Branch | Cut from | Commits |
|---|---|---|
| `fix/guest-profiles-records` | `main` `1a6f53b` | `1983cea` WS-A, `ed6fa95` WS-B (code + 115), `4f10dfb` WS-E (design) |
| `feat/budget-spine-integrated` | `main` `1a6f53b` | `020432a` `merge --no-ff feat/budget-spine-server`, `49030a6` WS-C, then the **final commit**: WS-D state of record plus this report |

**The state-of-record doc `docs/state-of-record-2026-10-12.md` is in the final commit of
`feat/budget-spine-integrated`** (its SHA is printed in the run's final message). That commit
touches only `docs/` and `LIGAMENT_CONTEXT.md`, none of which branch 1 changes, so it cherry-picks
onto `fix/guest-profiles-records` cleanly. Its text is identical to the new CURRENT STATE section
of `docs/roadmap-state.md` (checked with `diff`).

## 1. WS-A: guest link and account existence

**Guest GET `app/api/rfp/guest/[token]`**, fields before -> after:
- `token`: whole `rfp_magic_tokens` row (`select("*")`: id, token, org_id, project_id, vendor_email,
  vendor_name, scope_item_id/name/description, reference_materials incl. output_template_config,
  business_criteria_required, evaluation_criteria, budget_categories, pool_status,
  domain_match_profile_id, require_terms_disclosure, response_deadline, close_bidding_at_deadline,
  status, response_id, expires_at, submitted_at, created_at) -> `vendor_email,
  require_terms_disclosure, created_at, submitted_at, budget_categories` (normalized, no amounts),
  `response_deadline, close_bidding_at_deadline`.
- `project`: id, name, client_name, budget_range, description, start_date, end_date -> name,
  description, start_date, end_date (client name: ruling, no toggle exists; budget_range: whole
  project's figure, not the vendor's line).
- `agency`: unchanged (company_name, display_name, company_logo_url), built explicitly.
- `scopeItem`, `business_criteria_required`, `is_existing_partner`: unchanged.
- `reference_materials`: items as stored -> `{type, label, url}` only.
- `response`: vendor column list incl. id, updated_at -> the 14 keys the screen reads.
- Token read by explicit columns with a 42703 retry (`selectGuestToken`), GET and POST.
- POST `{success, is_existing_partner[, is_edit]}`, attach-existing-account `{inboxId}`, file
  (stream) unchanged. Upload 500 now a fixed message instead of the raw storage error.
- Guest screen: identical minus the client-name and project-budget lines.

**Account-existence oracles.** Fixed: `check-email` (no auth) was a **wildcard search**; now exact,
format-checked, and every outcome is 200 `{exists}` (faults answer `false`, which the page already
treats as an error). Exact match also in magic-link POST/GET, email-scan import,
`hasLigamentAccount`, and both guest lookups. magic-link POST no longer returns
`is_existing_partner` (unread). email-scan run no longer sends another person's `profile_id`.
Reported with proposed fixes (each would change what a legitimate user sees): `check-email`
remains yes/no by design (bind to token); `import-spreadsheet` dry run flags
`already_on_ligament` for 2000 emails per call (drop the flag, cap); magic-link `check_email`
means "any account" (scope to partnerships); the "Already on Ligament" pool badge; sign-up's own
`signUp` "already exists" message. Found, not fixed: the guest new-bid insert drops
`proposal_sections`.

## 2. WS-B: profiles interim fix and 115

**As built.** The design doc's interim ("one migration plus one route") does not hold: six other
session readers depended on the discoverable policy. Narrowest safe version: every discovery-screen
reader moves to `discoverable_profiles()` through `lib/server/discoverable-profiles.ts`
(`readDiscoverableProfiles`: RPC, falling back to today's select with the same allow-list on
PGRST202/42883), the marketplace invite resolves a discoverable invitee's email on the server
(service role, discoverable only, never returned), and 115 drops the whole-row policy.

| Discovery screen | Reads now |
|---|---|
| `/agency/pool` Discover Vendors sheet; `/partner/marketplace` | `/api/marketplace/discoverable` -> discovery path; email only for self/active partners via the session |
| `/partner/network` Discover tab + detail | list as above; detail: session row if self/counterparty, else discovery path |
| `/agency/pool/[partnerId]` public tier | session row if counterparty, else discovery path |
| Marketplace "Invite to Pool" | session row, else server-side id+email of a discoverable profile |
| (non-screen) partnerships domain-match names, bid list names | session, plus discovery path for the rest |

Reported, not moved: email-typed matching (partnerships POST by email, broadcast manual
recipients) and `resolveOrgNotificationRecipients` for a bidder with no partnership lose
discoverable strangers after 115, as they already miss non-discoverable ones.

**115** (`115_discoverable_profiles.sql`): pre-flight (LG115) on the function, the exact
discoverable policy, the partnership-members policy, **no other SELECT/ALL policy on profiles**, and
the allow-listed columns; `discoverable_profiles(p_role text, p_ids uuid[]) RETURNS SETOF jsonb`,
SQL, STABLE, SECURITY DEFINER, `search_path = public, pg_temp`, allow-list via
`jsonb_build_object` (bio without the legacy rate block, business_criteria without
`coi_document_url`), nothing without `auth.uid()`; `REVOKE ALL FROM PUBLIC, anon`, `GRANT EXECUTE
TO authenticated`; `DROP POLICY "Authenticated users can read discoverable profiles"`. Self,
colleague and counterparty reads unchanged. Down file restores the policy.

**Test IDs** (`115_preapply_test.sql`, 15 + M): X1 X2 X4 X5 X6 X7 X8 (stranger), O1 (owner), C1 C2
(counterparties), Z1 Z2 (anon), P1 (only that policy left), P2 (grants unchanged), P3 (function
shape and ACL), M. Inlined body machine-compared with the migration (identical).

**Dry run: `115_discoverable_profiles.sql` COMMIT at line 204** (BEGIN 94). Down: BEGIN 26, COMMIT 37.

## 3. WS-E: design

`docs/rfp-source-of-truth-design.md`. Owner decisions: **D1** paid gate at RLS for the new tables
or org membership only; **D2** what "released budget for their own line" is (today's
`estimated_budget`, or an explicit per-line release); **D3** toggle default false applied to
existing RFPs (vendors lose client names they see today); **D4** backfill grouping (per broadcast
batch vs per project); **D5** record editable after broadcast or a snapshot; **D6** Lightning and
wizard RFPs for one project: separate or merged; **D7** project deletion: SET NULL or cascade;
**D8** strip `_magic_token` from notifications and the vendor's `select("*")`; **D9** move
`output_template_config` off the token row.

## 4. WS-C: budget spine

- **Merge conflicts: none.** The two sides touch disjoint files; main's gate code untouched.
- **Gate:** `lib/server/budget/http.ts:40` (`agencyGateRefusal`, 402 `agency_entitlement_required`),
  in `budgetRouteSession()`, which every handler reaches: `templates/route.ts` GET :11, POST :22;
  `templates/[categoryId]/route.ts` PATCH :10, DELETE :27; `projects/[projectId]/chart/route.ts`
  GET :13, POST :33; `chart/[categoryId]/route.ts` POST :27, DELETE :60; `lines/route.ts` GET :12,
  POST :25; `lines/[lineId]/route.ts` PATCH :12, DELETE :35; `ledger/route.ts` GET :12, POST :26;
  `ledger/[entryId]/void/route.ts` POST :10; `documents/route.ts` GET :13, POST :30;
  `documents/[documentId]/route.ts` PATCH :13; `summary/route.ts` GET :10. The spine's org (403)
  and project (404) checks still run after it. No role column read.
- **Test vs migration:** three copies (103 in 103's test, 65 statements; 103 in 104's test, 65; 104
  in 104's test, 61), diffed: **no difference** beyond the intentionally omitted pre-flight DO
  blocks and NOTIFY. Nothing edited.
- **R1-R7 and grant posture: confirmed** (revoke ALL by name, ruled grants only, no
  TRUNCATE/REFERENCES/TRIGGER for authenticated, no SECURITY DEFINER, all six functions pinned,
  EXECUTE revoked from PUBLIC and anon).
- **COMMIT lines: `103_budget_core.sql` 823 (BEGIN 369); `104_budget_ledger.sql` 882 (BEGIN 368).**
  Downs: 103 36/77, 104 35/62.

## 5. SECURITY REVIEW LIST

Branch 1 (`fix/guest-profiles-records`):
- `app/api/rfp/guest/[token]/route.ts:214` selectGuestToken: explicit token columns, 42703 retry (GET :330, POST :531).
- `app/api/rfp/guest/[token]/route.ts:229` guestTokenView: the only token fields sent to a guest.
- `app/api/rfp/guest/[token]/route.ts:242` guestReferenceMaterials: `{type,label,url}` only; output_template_config never sent.
- `app/api/rfp/guest/[token]/route.ts:281` guestResponseView: response key allow-list.
- `app/api/rfp/guest/[token]/route.ts:365`, `:396`, `:404`: project without id/client_name/budget_range; agency built explicitly.
- `app/api/rfp/guest/[token]/route.ts:426`, `:595`: exact-match vendor email lookup.
- `app/api/rfp/guest/upload/route.ts:112`: fixed 500 body.
- `app/rfp/respond/[token]/page.tsx:93-118`: types follow the narrower response.
- `app/api/auth/check-email/route.ts:22-58`: unauthenticated; exact match, format check, uniform 200 `{exists}`.
- `lib/server/account-existence.ts:10` exactEmailIlike; `:49` hasLigamentAccount exact.
- `app/api/agency/rfp/magic-link/route.ts:183`, `:560` exact match; `:519` POST no longer returns is_existing_partner.
- `app/api/agency/email-scan/import/route.ts:62` exact match.
- `app/api/agency/email-scan/run/route.ts:109` profile_id not sent.
- `lib/server/discoverable-profiles.ts:94` readDiscoverableProfiles (session RPC, allow-listed fallback).
- `lib/server/discoverable-profiles.ts:127` resolveDiscoverableInvitee: **new service-role read**, id+email, discoverable only.
- `app/api/marketplace/discoverable/route.ts:36` discovery path; `:83-95` email only via session for self/active partners; role columns no longer returned.
- `app/api/agency/pool/[partnerId]/route.ts:90` public tier via discovery path when the session row is absent.
- `app/api/partner/network/[agencyId]/route.ts:153` same.
- `app/api/partnerships/route.ts:242` domain-match names via discovery path; `:535` invite by id falls back to the service-role invitee read.
- `app/api/agency/rfp-responses/route.ts:255` bidder names via discovery path.
- `supabase/migrations/115_discoverable_profiles.sql:96-150` pre-flight; `:152-189` the function; `:198-200` EXECUTE grants; `:202` DROP POLICY.
- `supabase/migrations/115_discoverable_profiles_down.sql:28-35` restores the whole-row policy.

Branch 2 (`feat/budget-spine-integrated`):
- `lib/server/budget/http.ts:40` paid gate for all budget routes (402/500), before the org/project checks.

## 6. Screens that change, and the account that checks each

| Screen | gmarkant@gmail.com (m a r k a n t, lead) | gmarkant@icloud.com (April Partner Test Agency, vendor) |
|---|---|---|
| `/rfp/respond/<token>` (guest link) | send a Lightning invite to a test address and open it signed out | if it holds an invite: no client-name line, no project budget line; everything else the same; DevTools response has no `evaluation_criteria`, `org_id`, `output_template_config` |
| Sign-up from a magic link (`/auth/sign-up?email=...&source=magic_link`) | - | existing address still redirects to sign-in |
| `/agency/pool` Discover Vendors sheet and its modal | same list; email only for active partners; no COI link | - |
| "Invite to Pool" from that sheet | still invites a discoverable vendor | - |
| `/agency/pool/<vendor id>` for a discoverable non-partner | public tier still shows | - |
| `/partner/marketplace`, `/partner/network` Discover tab and agency detail | - | same lists and public detail |
| `/agency` Lightning invite form (magic-link) | labels unchanged ("in your vendor pool"/"new vendor") | - |
| Email import review panel | unchanged badges | - |
| Budget API (`/api/agency/budget/...`, no UI) | 404 "Budget spine not enabled" until 103/104 (gate passes) | **402 `agency_entitlement_required`** |

## 7. Owner order

1. Merge `fix/guest-profiles-records` (cherry-pick the final record commit from
   `feat/budget-spine-integrated` onto it first if you want the record there), deploy, check section 6.
2. **115:** pre-apply test (first line must read "SAFE TO APPLY 115."), dry run
   (`115_discoverable_profiles.sql` COMMIT at **line 204** -> ROLLBACK, then V1 shows the policy
   still present), catalog proof (V1-V4 before), apply, verify V1-V5. Only after step 1 is deployed.
3. Merge `feat/budget-spine-integrated`, deploy (budget routes stay 404/402).
4. **103:** pre-apply test ("SAFE TO APPLY 103."), dry run (COMMIT **line 823**), catalog proof, apply, verify.
5. **104:** pre-apply test, dry run (COMMIT **line 882**), catalog proof, apply, verify.
6. Then the RFP record decisions D1-D9, and 116-118 per the design.
Cross-agency assertions will read NO SUBJECT = INCONCLUSIVE (one lead org with members); accept
them only on the 105 precedent, never as PASS.

## 8. REFUSED, ASSUMPTIONS, STOPPED ON

**REFUSED (permission layer):** a subagent's read-only git commands (the budget-spine inventory
agent did nothing; I ran that inventory myself); `cat` of memory files in one command; `echo $?`
chained after tsc (tsc run alone instead: no output = exit 0); `sed > file` and `cp`/`cat` from
`/tmp` (to assemble the 115 test; it was written whole and then diffed instead); `md5` in a pipe;
a second `sed` with a substitution and `awk` (wrapper lines of 103/104 compared by reading the
diff residue); a `jq` filter containing the word "import" (reworded). No browser verification,
no `pnpm build`.

**ASSUMPTIONS:**
- A guest is a vendor; with no per-RFP toggle yet, the client name is never sent; `budget_range`
  is not the vendor's released line budget, so it is not sent; `budget_categories` (no amounts) stay.
- `business_criteria` is a public discovery field minus `insurance.coi_document_url` (a document
  link); certifications, insurance limits and `coi_on_file` stay visible on discovery as today.
  Flagged for the owner.
- Same-organization colleagues count with owner/counterparty ("self-reads and counterparty reads
  stay as they are"): 115 leaves the partnership-members policy untouched.
- The marketplace invite may resolve a discoverable profile's email server-side with the service
  role, because inviting makes the pair counterparties anyway; the email is not returned.
- `check-email` answering `{exists:false}` on malformed input and faults changes no visible
  behavior (the page shows the sign-up form in both cases).
- The final WS-D commit also carries this consolidated report (memory rule: end-of-run report is
  committed to docs/); it was amended into the record commit so the record stays last.
- Lint "new messages in touched files" judged by `pnpm lint --format json` filtered with `jq`;
  the only message in a touched file is pre-existing (`app/rfp/respond/[token]/page.tsx:337`).

**STOPPED ON:** nothing. No workstream rested on a wrong premise; the one premise that failed
(the design doc's "one migration plus one route") was handled as the brief allows, by building the
narrowest safe version and recording the difference.
