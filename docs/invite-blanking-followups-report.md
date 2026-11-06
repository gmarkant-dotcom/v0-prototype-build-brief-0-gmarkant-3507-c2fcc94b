# Invite blanking follow-ups (G1, G2, G3): report

Branch `fix/invite-blanking-followups`, from `main` at 49b38a6. Date 2026-11-06.
No migration. Nothing under `supabase/` changed. No file on the parallel-build do-not-edit list changed.

Line numbers marked **(main)** are at 49b38a6, before this branch. Unmarked ones are on this branch.

## Commits

| Commit | What |
|---|---|
| b24f0f0 | G1, G2, G3: `lib/agency-invite-request.ts` and its test, card form and row messages, wizard guest body and completion list |
| (this doc) | this report and `docs/test-script-invite-followups.md` |

## STEP 0 (read only)

### a. What each path sends, and what the first-send path does with what is missing

The route is `app/api/agency/rfp/magic-link/route.ts` (unchanged by this branch). A body without `resend: true` is a
first send (`:239`). A first send normalizes every absent field to an empty value and then upserts every content column
unconditionally on `(org_id, project_id, vendor_email)` (`:400-431`, `:440-444`). It also creates a new `rfp_records`
draft and line from the same body (`:292-330`) and moves the token's `rfp_line_id` onto it (`:337-338`, `:430`).

**G1, the card's "Send Invitation" form** (`components/agency-rfp-magic-link-invite.tsx:83-110` **(main)**, body
`:91-96` **(main)**) sends `vendor_email`, `vendor_name` (or nothing), `project_id`, `require_terms_disclosure`. Nothing
else. On an existing token:

| Missing field | Normalized at | Written to the token at |
|---|---|---|
| `scope_item_id`, `scope_item_name`, `scope_item_description` | `:131-139` -> null | `:405-407` |
| `reference_materials` | `:140-152` -> `[]` | `:411-414` -> `{materials: []}` |
| `output_template_config` | `:153` -> null | record only (`:309`) |
| `business_criteria_required` | `:154` -> empty designations, insurance, notes | `:416` |
| `budget_categories` | `:156` -> `[]` | `:425` |
| `evaluation_criteria` | `:157` -> `[]` | `:426` |
| `close_bidding_at_deadline` | `:159` -> false | `:427` |
| `response_deadline` | `:184-187` -> a fresh 14-day default | `:424` |
| `show_client_to_vendors` | `:311`, `:344-345` -> false | `client_name_released` null, `:415` |
| `release_budget`, `estimated_budget` | `:290-291`, `:326` | record line only |
| (none) | `:292-338` new empty record | `rfp_line_id`, `:430` |

Kept: the live token (`:264-267`), the bid linkage when one exists (`:422`). `require_terms_disclosure` is written from
the checkbox (`:423`).

**G2, the `/agency` wizard's guest send** (`app/agency/page.tsx:1368-1395` **(main)**, body `:1374-1389` **(main)**)
sends `vendor_email`, `vendor_name`, `project_id`, `scope_item_name`, `scope_item_description`, `reference_materials`,
`require_terms_disclosure`, `response_deadline`, `show_client_to_vendors`, `release_budget`, `estimated_budget`. Missing,
although the wizard holds all four (`masterRfp` at `:409-426`, `closeBiddingAtDeadline` at `:643`):

| Missing field | Wizard holds it at | Route writes |
|---|---|---|
| `business_criteria_required` | `masterRfp.business_criteria_required` | empty, `:154`, `:416`, and on the record `:307` |
| `budget_categories` | `masterRfp.budget_categories` | `[]`, `:156`, `:425`, record `:306` |
| `evaluation_criteria` | `masterRfp.evaluation_criteria` | `[]`, `:157`, `:426`, record `:305` |
| `close_bidding_at_deadline` | `closeBiddingAtDeadline` | false, `:159`, `:427`, record `:314` |

Also missing: `output_template_config` (record only, agency-only; see finding H3). The standard broadcast in the same
function sends all of these inside `masterRfp` and `close_bidding_at_deadline` (`:1345-1360` **(main)**), so a guest
recipient got less than a pool recipient of the same broadcast, even on a first send.

### b. New content, a resend, or a no-op; what the agency sees today

- **Card form: never new content.** It carries no RFP content at all. On an address with no invitation it is a first
  send of an empty invitation (its existing behaviour, unchanged here). On an address that already has one, the only
  thing it can usefully do is renew the link and mail it again, which is exactly the F7 resend. A first send there can
  only destroy content. **Correct behaviour: resend.** A no-op would leave the agency unable to re-mail from this form,
  and the hint the form already shows promises a resend (`:153-154` **(main)**: "An active invitation already exists -
  resending delivers the same link with a refreshed expiry"). Today the agency sees that hint, clicks Send Invitation,
  and gets "Invitation sent. Link expires in 72 hours." (`:100` **(main)**) while the invitation's criteria, categories,
  materials, scope and client release are blanked. The expired case is the same ("a new one will be sent", `:156`).
- **Wizard: a legitimate send with new content.** It sends the brief, scope line, materials, deadline and release
  choices the agency just built. It must stay a first send (a resend would discard the new content, and the route
  ignores content on a resend, F7 assumption A3). It should carry everything it holds. Today the agency sees "RFPs
  Broadcasted Successfully!" (`:3168` **(main)**) whatever happened: the guest `fetch` result is never read
  (`:1371-1390` **(main)**), and only a thrown network error is logged to the console (`:1391-1393` **(main)**).

### c. Every place a send or resend result is shown to the agency

| Place | Today (main) |
|---|---|
| Card form, `components/agency-rfp-magic-link-invite.tsx:98-106`, rendered `:198-199` | Error text on non-2xx. Success text on any 2xx, even when `email_sent` is false. |
| Card row Resend, `:112-131` | Nothing. On 2xx the list reloads (`:127`); on 404, 401, 500 or a network error, nothing at all. |
| Wizard guest send, `app/agency/page.tsx:1368-1395`, completion card `:3163-3190` | Nothing. The completion card always says success. |
| Wizard standard broadcast, `:1361-1366`, `:1400-1401`, rendered `:3133-3137` | Error box on failure (unchanged). |
| Lightning, `app/agency/magic-rfp/page.tsx:654-665`, rendered `:1315` | Per-recipient success or `data.error`. Ignores `email_sent` (finding H2). Not changed. |
| Pool resend, `app/agency/pool/page.tsx:668-687` | Different route (`/api/agency/pool/resend-invitation`); message on both outcomes. Not in scope. |

## Stop conditions

None hit. **S1:** no database change; the route is unchanged. **S2:** a first-time invite writes exactly what it wrote
before. The card's first-send body is byte-identical (asserted); the wizard's first send adds four fields the route
already accepts and Lightning already sends, so a first send now writes the wizard's criteria, categories, business
criteria and close flag where it wrote empty values. That is the G2 fix itself, and it is what the brief asks for, so it
is not read as S2; noted as assumption A2. **S3:** no do-not-edit file was needed.

## G1 fix

- `lib/agency-invite-request.ts:47` `buildCardInviteRequest`: with an existing invitation (`hasExistingInvitation`,
  `:31`, pending or expired) the body is `{vendor_email, vendor_name, project_id, resend: true}`, the F7 path; otherwise
  the same first-send body as before.
- `components/agency-rfp-magic-link-invite.tsx:106-142` `sendInvite`: rechecks the address at click time
  (`:115-127`, the existing `check_email` GET), not the debounced hint, so a fast click inside the 500 ms debounce
  cannot first-send over an invitation. If the check fails nothing is sent and the agency is told so (`:125`).
- `:165` `existingInvite`; `:231` the button reads **Resend Invitation** when an invitation exists; `:204-215` the terms
  checkbox is disabled with "A resend keeps the existing invitation's term disclosure setting." (the resend path
  ignores it); `:187-190` hint copy now says the resend keeps the content (em-dash-free).
- A first invite to a new address is unchanged (asserted).

## G2 fix

- `lib/agency-invite-request.ts:87` `buildWizardGuestInviteBody`: every key the wizard sent before, unchanged, plus
  `business_criteria_required` and `budget_categories` taken from the master RFP **only through `pickVendorCopy`**
  (`:100`, `lib/rfp-vendor-copy.ts` allow-list), `evaluation_criteria` (agency rubric, not vendor-facing; the guest page
  never shows it) and `close_bidding_at_deadline` (explicit true only). No client name, total budget or other lines
  travel (asserted).
- `app/agency/page.tsx:1374-1411`: the wizard builds each guest body with it. The route still normalizes all four
  (`route.ts:154-159`) and still builds the token's vendor JSON through `vendorTokenReferenceMaterials` (`:413`).

## G3 fix

- `lib/agency-invite-request.ts:132` `describeInviteOutcome`: one message per response. 2xx with `email_sent` ->
  success "Invitation sent/resent. The link expires in 72 hours."; 2xx without it -> warning (attached to the portal
  inbox, or saved but not emailed); resend 404 -> "There is no invitation to resend for this vendor. Send a new
  invitation instead."; 401 -> session expired; other errors -> the route's `error` text or a fallback; network ->
  "Network error. Check your connection and try again."
- Card form: `:92-104` `postInvite`, success or warning `:235-242` (`role="status"`, amber for a warning), error
  `:243-247` (`role="alert"`).
- Card row Resend: `:144-163`, message under the row `:308-322`; the list reloads only on a non-error so the message
  stays beside the row the agency clicked.
- Wizard: outcomes collected per guest recipient (`app/agency/page.tsx:1374-1411`), cleared at the start of each
  broadcast and on reset; the completion card heading reads "Broadcast finished, but some guest invitations failed" when
  any failed (`:3186-3188`) and lists each guest recipient with its message (`:3203-3226`).

## Tests

Plain assertion files, run with `npx -y tsx`:

| File | Result |
|---|---|
| `lib/agency-invite-request.test.ts` (new) | 54 passed |
| `lib/magic-link-resend.test.ts` (re-run, unchanged) | 45 passed |

Gates: `./node_modules/.bin/tsc --noEmit` exit 0. `pnpm lint --format json` (whole repo, exits 1 on pre-existing
errors), filtered to touched files: `lib/agency-invite-request.ts` and its test 0/0;
`components/agency-rfp-magic-link-invite.tsx` 2 errors, the same two `react-hooks/set-state-in-effect` effects reported
on main (`:57`, `:64` **(main)**, now `:66`, `:73`); `app/agency/page.tsx` 9 errors and 2 warnings, all
`react-hooks/*` in effects and handlers outside this branch's hunks (lines 277-363, 1082, 1483, 1526, 1554). No new
lint finding in any touched line.

## Security review list

1. `components/agency-rfp-magic-link-invite.tsx:115-127`: the click-time check is the existing agency-only GET
   (`route.ts:930-953`, `requireAgency` and `callerOrgIds`). It returns only three booleans. No new data reaches the
   browser.
2. `lib/agency-invite-request.ts:47-67`: the card now sends `resend: true` for an existing address. The route's resend
   branch (`route.ts:239-254`) runs after the same auth, organization, project and token checks as a first send, and
   writes only the six renewal columns (`lib/magic-link-resend.ts:17-24`). A forged `resend: true` from any client
   could already reach it; this branch adds no server path.
3. `lib/agency-invite-request.ts:100`: vendor-facing content on the wizard body (`business_criteria_required`,
   `budget_categories`) comes only through `pickVendorCopy`. The client name, `totalBudget`, `scopeItems` and other
   lines are not in the body (asserted). `evaluation_criteria` is agency-only and lands on agency-only token and record
   columns, as Lightning already sends it (`app/agency/magic-rfp/page.tsx:637`).
4. The route is unchanged, so server-side normalization stays the permission for every field:
   `route.ts:154-159` (business criteria, categories, criteria, close flag), 118 RLS on the record (`:292`), 120's key
   guards on the JSON columns (`:411-414` via `lib/rfp-vendor-copy.ts`).
5. Messages: `describeInviteOutcome` shows the route's own `error` string (agency-facing, already shown by the card form
   before). It never shows the token. The wizard list shows the agency's own recipient email and scope name.
6. No `dark:*`, no em dashes in new copy (asserted for every `describeInviteOutcome` message).

## Findings for the owner

- **H1. One address on two scope items in the wizard.** The token is unique on `(org_id, project_id, vendor_email)`,
  so a guest address added to two outsourced items gets two first sends and the second overwrites the first
  (`app/agency/page.tsx:1384-1407`, `route.ts:442`). Pre-existing, not changed. Both now show a result line.
- **H2. Lightning ignores `email_sent`.** `app/agency/magic-rfp/page.tsx:658-660` marks a recipient sent on any 2xx,
  including a saved invitation whose email did not go out. `describeInviteOutcome` could be reused there.
- **H3. The wizard guest send also omits `output_template_config`.** It lives on the RFP record only (agency-only, D9),
  so it blanks nothing a guest sees, but a wizard guest send writes a record with no template. Not in the brief.
- **H4. Card resend over a submitted bid.** The check endpoint reports pending or expired, not submitted, so the card
  form resends to a vendor who already bid (the row list hides Resend for submitted rows). The resend keeps the bid
  linkage (`lib/magic-link-resend.ts:80-83`), so nothing is lost; it is an extra email.
- **H5. G5 from the previous report stands:** the invite list GET still selects `*` (`route.ts:958`).

## Refused, assumptions, stopped on

- **Refused:** nothing.
- **A1. Card form resends for an expired invitation too.** The hint said "a new one will be sent"; the resend path mints
  a new token for a lapsed one (`lib/magic-link-resend.ts:66-69`) and keeps the content, so the agency gets what the
  hint promised without the blanking.
- **A2. A wizard first send now writes four more fields.** For an address with no token this writes the wizard's
  criteria, categories, business criteria and close flag where it wrote empty values; read as the G2 fix, not S2.
- **A3. The card fails closed when the click-time check fails.** Nothing is sent and the agency is asked to retry,
  rather than risk a blanking first send. A first invite therefore depends on the check GET succeeding.
- **A4. The terms checkbox is disabled on a resend**, because the resend path does not write
  `require_terms_disclosure`. To change it, the agency sends a full Lightning or wizard send.
- **A5. 404 cannot be produced from the UI on a live site** without deleting a token. The message is asserted in the
  test; the test script covers a failed resend through a signed-out session (401) and an offline browser (network).
- **Stopped on:** nothing.
