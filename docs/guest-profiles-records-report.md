# Guest link, profiles exposure, RFP record: run report, 2026-10-12

Branch `fix/guest-profiles-records`, cut from `main` at `1a6f53b`. Unattended session. Not pushed,
not merged. Updated and committed after each workstream (WS-A, WS-B, WS-E). Budget spine readiness
(WS-C) and the state of record (WS-D) are on `feat/budget-spine-integrated`; see
`docs/state-of-record-2026-10-12.md` there.

No database access, no network, no install. Nothing here has been run against Postgres.

## WS-A: guest link and account-existence leaks (code only)

### Guest RFP routes

The guest screen is `app/rfp/respond/[token]/page.tsx` (one client file). Its reads were inventoried
property by property; every field below that it does not read is gone from the response.

**`app/api/rfp/guest/[token]/route.ts` GET** (the only guest JSON with RFP content)

| Key | Before | After |
|---|---|---|
| `token` | the whole `rfp_magic_tokens` row from `select("*")`: `id, token, org_id, project_id, vendor_email, vendor_name, scope_item_id, scope_item_name, scope_item_description, reference_materials` (with `output_template_config`), `business_criteria_required, evaluation_criteria, budget_categories, pool_status, domain_match_profile_id, require_terms_disclosure, response_deadline, close_bidding_at_deadline, status, response_id, expires_at, submitted_at, created_at` | `guestTokenView()` (`:229`): `vendor_email, require_terms_disclosure, created_at, submitted_at, budget_categories` (normalized: key, name, note, origin, is_additional_items, sort_order; no amounts), `response_deadline, close_bidding_at_deadline` |
| `project` | `id, name, client_name, budget_range, description, start_date, end_date` | `name, description, start_date, end_date` (`:365`, `:396`) |
| `agency` | `company_name, display_name, company_logo_url` | same, built explicitly (`:404`) |
| `scopeItem` | `{name, description}` | unchanged |
| `reference_materials` | the stored array items as stored (any keys) | `{type, label, url}` per item (`guestReferenceMaterials`, `:242`) |
| `business_criteria_required` | normalized | unchanged |
| `is_existing_partner` (submitted only) | boolean | unchanged (see oracles below) |
| `response` (submitted only) | vendor column list incl. `id`, `updated_at` | `guestResponseView()` (`:281`): `proposal_text, budget_proposal, timeline_proposal, payment_terms, terms_disclosure, attachments, business_criteria_responses, business_criteria_acknowledgments, budget_lines, proposal_sections, status, agency_feedback, feedback_updated_at, submitted_at` |
| 410 expired | `{error, agencyName}` | unchanged |

Removed from what a guest receives: `evaluation_criteria` (rubric), `reference_materials.output_template_config`,
`org_id`, `project_id`, `response_id`, `scope_item_id`, `id`, `pool_status`, `domain_match_profile_id`
(another company's profile id), the token itself, `vendor_name`, `status`, `expires_at`,
`project.id`, `response.id`, `response.updated_at`, and two ruled fields:

- **`project.client_name`**: ruling "client name per-RFP toggle, default hidden". No toggle exists
  yet (WS-E designs where it lives), so the guest never receives it. The page's render is kept and
  shows nothing while the key is absent (the type now marks it optional, `page.tsx:109-118`).
- **`project.budget_range`**: ruling "vendors see only the budget released for their own scope
  line". `budget_range` is the project's figure and the token carries no per-line release, so it is
  not sent. A guest still sees `budget_categories` (names and notes to price against; no amounts).

The token row is read by an explicit column list, `selectGuestToken()` (`:214`), base columns plus
the 072/074/076 columns, retried without those three on 42703. POST uses the same helper (`:531`);
POST's responses (`{success, is_existing_partner[, is_edit]}`) were already minimal and are
unchanged.

**`app/api/rfp/guest/file`** GET: success is the file stream; errors are fixed strings. Unchanged.
**`app/api/rfp/guest/upload`** POST: success `{url, filename, size}` (its own upload) unchanged; the
500 body echoed the raw storage error message, now a fixed `"Upload failed"` (`:112`).
**`app/api/rfp/guest/[token]/attach-existing-account`** POST: returns `{inboxId}` only (the caller's
own new inbox row), reads the token by `MAGIC_TOKEN_ATTACH_COLUMNS`. Unchanged.

What the guest sees: the same screen, minus the client name line and the project budget line. Both
were rendered from `project.*` (`page.tsx:974`, `:977-980`).

**Found, not changed (scope):** the new-bid insert in the guest POST does not write
`proposal_sections` (only the edit path does), so guided sections on a first guest submission appear
to be dropped. The edit path also spreads `proposal_sections` twice (harmless). Reported for a
separate fix.

### Account-existence oracles

| Oracle | Gate | Fixed | Reported (would change what a legitimate user sees) |
|---|---|---|---|
| `app/api/auth/check-email` | **none** | Unescaped `ilike` was a **wildcard search** (`?email=ab%25` = "is there an account starting with ab"; >1 match = 500). Now exact (`exactEmailIlike`, `:42`) with `.limit(1)`, format-checked, and **every outcome is 200 `{exists}`**: missing, malformed, fault and exception all answer `{exists:false}`, which the sign-up page already treats exactly like an error (shows the form). | It remains a yes/no oracle by design: the sign-up page redirects an existing account to sign-in. **Proposed:** bind it to a magic-link token (`?token=`; answer only for that token's `vendor_email`); links without a token (`lib/email.ts:249`, `pool_resend`) then show the sign-up form and Supabase's own "already exists" message. Note `signUp` itself is a second oracle on that page (`app/auth/sign-up/page.tsx:219-224`). |
| magic-link POST (`app/api/agency/rfp/magic-link/route.ts`) | paid agency | Exact match (`:183`). `is_existing_partner` **removed from the response** (`:519`); no client reads it. | `attached` still distinguishes "already in their portal inbox". Only after a real invite is sent. |
| magic-link GET `check_email` | paid agency | Exact match (`:560`). | `is_existing_partner` means "any Ligament account" while the UI says "in your vendor pool". **Proposed:** compute it from `partnerships` scoped to the caller's org (corrects the label; changes it for account holders not in the pool). |
| magic-link GET list (`project_id`) | paid agency | none (exact `.in`, only addresses the caller already invited) | same proposal as above |
| email-scan import (`app/api/agency/email-scan/import/route.ts:62`) | paid agency | Exact match. | The "Already on Ligament" pool badge persists the answer per imported email. **Proposed:** drop the badge or restrict it to the caller's own counterparties. |
| email-scan run | paid agency | **Another person's `profile_id` no longer sent to the browser** (`app/api/agency/email-scan/run/route.ts:109`; the import route already ignored it). | `has_ligament_account` badge in the review panel, sourced from the agency's own mailbox. |
| partner-pool-import (`lib/server/partner-pool-import.ts:243`) | paid agency | none (exact `.in`) | **The strongest remaining oracle:** `pool/import-spreadsheet` with `dryRun:true` answers `already_on_ligament` for up to 2000 arbitrary emails per call with no writes. **Proposed:** return only `self` and `domain_match_flagged` from a dry run, and cap the batch. Removes a review badge. |
| `lib/server/account-existence.ts` `hasLigamentAccount` | callers gated | Exact match (`:49`). Never returned to a caller (unchanged). | - |
| guest GET/POST `is_existing_partner` | token holder | Exact match (`:426`, `:595`). | Answers for the invited address only, to whoever holds that address's link; the page uses it to offer sign-in vs sign-up. Kept. |

New helper: `exactEmailIlike()` (`lib/server/account-existence.ts:10`), reusing `escapeLikePattern`
from `lib/server/claim-partnership-invites.ts`.

**Gates (WS-A):** `pnpm exec tsc --noEmit` exit 0. `pnpm lint` (whole repo) exits 1 on pre-existing
messages; in touched files the only message is pre-existing (`app/rfp/respond/[token]/page.tsx:337`
set-state-in-effect, a line not touched).

## WS-B: profiles exposure, interim fix (code + migration 115)

### What the design doc proposed, and where it did not hold

`docs/profiles-exposure-design.md` section 3 ("cheaper interim"): replace scripts/016's whole-row
policy with a SECURITY DEFINER `discoverable_profiles()` returning the marketplace columns, and
point `app/api/marketplace/discoverable` at it, "one migration plus one route".

**Verified against the code, it does not hold as written.** Six more session-client paths read
strangers' profiles through that policy without saying so, and three of them are discovery
screens. Dropping the policy with only the marketplace route moved would have turned the agency
public-tier vendor page and the vendor Discover-tab agency page into "profile is private", and
made marketplace "Invite to Pool" return 404. So the narrowest SAFE version moves every reader
that a discovery screen needs, and reports the rest:

| Reader | Today | After this branch |
|---|---|---|
| `app/api/marketplace/discoverable` | session select, whole row, 17 columns incl. email (masked in code), role columns | `readDiscoverableProfiles(supabase, { role })` (`:36`): public fields only. Email for self and active partners is read separately with the session (`:83-95`), which the partnership policy already admits. `role`/`active_role` no longer sent (no client reads them) |
| `app/api/agency/pool/[partnerId]` (public tier) | session select; discoverable policy admitted strangers | same select first (self/counterparty unchanged); if empty, the discovery path (`:90`), partnership-tier columns null |
| `app/api/partner/network/[agencyId]` (public tier) | same | same pattern (`:153`) |
| `app/api/partnerships` POST invite by id (marketplace "Invite to Pool") | session select `id, email` | session select first; if empty, `resolveDiscoverableInvitee()` (`:535`): **service role**, `id, email` only, only `is_discoverable = true`; the email addresses the invitation and is not returned |
| `app/api/partnerships` GET domain-match names | session select | plus the discovery path for unresolved ids (`:242`) |
| `app/api/agency/rfp-responses` bidder names | session select | plus the discovery path for unresolved ids (`:255`), name only (email null, as for a non-discoverable bidder today) |

Helper: `lib/server/discoverable-profiles.ts`: `readDiscoverableProfiles` (`:94`) calls
`rpc("discoverable_profiles")`; on PGRST202/42883 (115 not applied) it runs today's direct select
with the same allow-list. Both paths pass through `toPublic` (`:62`), so the output is identical
before and after 115: unknown keys never pass, the bio loses its legacy rate block
(`stripRateFromBio`, `:45`, the same marker `lib/partner-rate-info-read.ts` parses), and
`business_criteria` loses `insurance.coi_document_url` (`publicBusinessCriteria`, `:52`).

**Reported, not moved** (each loses a discoverable stranger after 115, exactly as it already misses
a non-discoverable one; none is a discovery screen):
- `app/api/partnerships/route.ts:540-551` invite **by typed email**, and
  `app/api/agency/broadcast-rfp/route.ts:329-333` manual recipient: the `ilike` match on email no
  longer links a discoverable stranger's account at send time; the row is a ghost and links at claim
  (093), as for every non-discoverable account.
- `resolveOrgNotificationRecipients` (`lib/email.ts:413`, `:424`) profiles fallback for a bidder with
  no partnership (`app/api/agency/rfp-responses/[id]/route.ts:514`, `:845`, `:1039`, `:1146` and
  four others): its comment at `[id]/route.ts:523-531` already says it resolves non-partnered
  vendors only when discoverable. After 115 it resolves none; the in-app/email notice to such a
  vendor is skipped and logged. Proposed fix: a SECURITY DEFINER recipient resolver keyed on the
  bid, not on profile visibility.

### Every discovery screen and how it reads now

| Screen | API | Reads |
|---|---|---|
| `/agency/pool` "Discover Vendors" sheet (`components/marketplace-content.tsx:107`, `?role=partner`) | `/api/marketplace/discoverable` | discovery path; email only for self/active partners |
| `/partner/marketplace` (`app/partner/marketplace/page.tsx:90`, `?role=agency`) | same | same |
| `/partner/network` Discover tab (`app/partner/network/page.tsx:504`) and its detail (`:580`) | same, then `/api/partner/network/[agencyId]` | list: discovery path; detail: session row if self/counterparty, else discovery path |
| `/agency/pool/[partnerId]` public tier (`app/agency/pool/[partnerId]/page.tsx:183`; also opened from bid detail and access requests) | `/api/agency/pool/[partnerId]` | session row if counterparty, else discovery path |
| Marketplace "Invite to Pool" (`components/marketplace-content.tsx:195-198`) | `POST /api/partnerships` | session row, else service-role id+email of a discoverable profile |

Visible change on discovery screens: the marketplace modal's business criteria no longer carry the
COI document link (none of the three screens renders it; `coi_on_file` still shows), and a legacy
rate block can no longer appear in a stranger's bio. Field set otherwise the same; `website` and
`display_name` are now also present on the list (public fields the detail routes already sent).

### Migration 115 (authored, not applied)

Files: `115_discoverable_profiles.sql` (BEGIN line 94, **COMMIT line 204**),
`115_discoverable_profiles_down.sql` (BEGIN 26, COMMIT 37), `115_preapply_test.sql`.

- Pre-flight (LG115): refuses if the function exists; if the discoverable policy is not exactly
  `FOR SELECT TO authenticated USING (is_discoverable = true)`; if "Users can view profiles of
  partnership members" (079/085, calls `current_user_visible_profile_ids`) is missing; **if any
  other SELECT/ALL policy exists on profiles** (dropping one policy would then not close the
  exposure); if any allow-listed column is missing.
- `public.discoverable_profiles(p_role text DEFAULT NULL, p_ids uuid[] DEFAULT NULL) RETURNS SETOF
  jsonb`, `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp`. Allow-list by
  `jsonb_build_object` (a later column is not exposed by default); `is_discoverable = true` only;
  nothing without `auth.uid()`; `p_role` matches role OR active_role.
- `REVOKE ALL ... FROM PUBLIC`, `REVOKE ALL ... FROM anon`, `GRANT EXECUTE ... TO authenticated`.
- `DROP POLICY "Authenticated users can read discoverable profiles" ON public.profiles`.
- **Unchanged:** every other policy on profiles (self, colleague and counterparty reads are exactly
  today's), every grant, every trigger.

**Pre-apply test** (`115_preapply_test.sql`, 113's format; 15 assertions plus M):
X1 stranger reads the discoverable profile's row (1 before, 0 after); X2 stranger reads its
legal/billing/rate/terms/flag columns (1, 0; the column list comes from the live catalog); X4
discovery path returns it with no private key; X5 its key set is exactly the public list; X6 never
carries the COI URL; X7 omits a non-discoverable profile; X8 role filter finds it; O1 owner reads its
own sensitive columns (1, 1); C1 agency reads its counterparty vendor's, C2 vendor reads its
counterparty agency's (1, 1; gmarkant@gmail.com / gmarkant@icloud.com, NO SUBJECT unless each sees
the other); Z1 anon reads the profile (0 rows or 42501, both phases); Z2 anon cannot execute the
function (42501 after); P1 only the discoverable policy left profiles; P2 no grant on profiles
changed; P3 definer, stable, search_path, ACL as authored; M migration ran. The stranger is found
by impersonation (`current_user_visible_profile_ids()` must not contain the profile), never inferred.
**NO SUBJECT if no profile is discoverable** (then 115 closes nothing live; `docs/invitation-diagnosis.md:519`
recorded 2).

The inlined migration body (test lines 390-496) was **machine-compared** with the migration's lines
96-202 (`sed -n '390,496p' test | diff - migration`: the only differences are the migration's
header and its BEGIN/COMMIT lines). Not run against Postgres.

**Residual, by design of the interim:** colleagues in the same organization and live
counterparties (pending, active, suspended) still read whole rows, including legal and billing
fields of the other side; `organizations.is_paid` is still readable by every counterparty. That is
the `profile_private` / `organization_private` split (design doc section 3), not this run.

**Gates (WS-B):** `pnpm exec tsc --noEmit` exit 0; lint in touched files: no new message.

## WS-E: agency-owned RFP record (design only)

`docs/rfp-source-of-truth-design.md`. Two agency-only tables, `rfp_records` (master, rubric,
categories, requirements, output template, total budget, **`show_client_to_vendors boolean NOT
NULL DEFAULT false`**) and `rfp_record_lines` (one per scope line, with `released_budget`), plus
nullable link columns on `partner_rfp_inbox` and `rfp_magic_tokens` (`rfp_line_id`,
`client_name_released`, and `rfp_magic_tokens.attached_inbox_id` replacing the `_magic_token` JSON
join). RLS TO authenticated only, no vendor/anon/DELETE policy, grants per 113/114. Sequence: code A
(write the record at broadcast, fallbacks) -> 116 (tables) -> code B (every agency reader onto the
record, inbox fallback) -> 117 (backfill from inbox copies, refuses ambiguous groups) -> code C
(per-vendor copies, vendor routes read `client_name_released`) -> 118 (scrub old copies behind a
no-data-loss fingerprint, guard trigger) -> code D (drop fallbacks). Owner decisions D1-D9 are
listed in section 6 of the doc. No code, no migration.
