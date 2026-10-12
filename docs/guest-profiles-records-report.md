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
