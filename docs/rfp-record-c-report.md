# RFP record step C and migration 120: run report, 2026-10-15

Branch `feat/rfp-record-c` (worktree off `main` at `64e846d`). Unattended run. Nothing pushed, merged or
applied; nothing run against a database. Design and rulings: `docs/rfp-source-of-truth-design.md` (D1-D9
section 6; as built: sections 8 and 9). Test script: `docs/rfp-record-test-script.md` parts I to L.

State at the start (owner, 2026-10-14): migrations 071-119 applied and verified; 119 pre-apply 33/33; 44
records (43 backfilled: wizard 23, Lightning 20; plus smoke test `21f9d17d`), 112 lines, inbox rows linked
97 of 98, tokens 21 of 21 (`attached_inbox_id` on 6); the toggle verified in the browser both ways; the one
refused row, inbox `04391718`, refused because its token row no longer exists. Owner ruling **S-A**: no AI
bid summary on a vendor or guest submission. Next free migration: 120.

## 1. Commits

| Commit | What |
|---|---|
| `b4ff2d4` | docs: rule 0, state of record (119 applied and verified, numbers, toggle verified, refused row corrected, next free 120, ruling S-A) |
| `4798c3f` | feat: step C vendor side: one vendor-copy allow-list every writer builds through; vendor and guest readers on the release columns with explicit column lists; attach joins through `attached_inbox_id`; agency `_magic_token` fallback removed; agency estimate from the record line; S-A server side; `RFP_VENDOR_COPY_SCRUBBED = true` |
| `f864447` | feat: ruling S-A agency side: idempotent generate-summary, one client queue, warm-up at most 2, on demand, "Generating summary", Retry |
| `50c877b` | feat: migration 120, down file, pre-apply test (29 assertions), read-only key inventory. Not applied |
| docs commit | this report, design section 9, test script parts I-L, state of record, roadmap, LIGAMENT_CONTEXT |

## 2. STEP 0 answers. No stop condition was hit.

### 0. State of record

Committed first (`b4ff2d4`): `docs/state-of-record-2026-10-12.md` (top banner and a 119 row),
`docs/roadmap-state.md` (top banner, order of work), `LIGAMENT_CONTEXT.md` (banner, 119 row, numbering
line). **Refused-row correction:** no document named a reason for inbox `04391718`; the only wording close to
"another organization" is 119's own refusal text, `119_rfp_records_backfill.sql:656`, "a Lightning RFP
inbox row whose token is not in its organization", which 119 raises whenever no token with the row's marker
exists in the row's organization, including when the token row does not exist at all. The owner's finding
(the token row is gone) is now what every state document says; 119 itself was not edited.

### a. Vendor- and guest-facing reads (main, before this branch)

| Read | file:line (main) | Session | What reached the vendor |
|---|---|---|---|
| RFP list | `app/api/partner/rfps/route.ts:231-234` `select("*")`, spread `:333-344` | vendor | the whole copy for every row, NDA-gated included: client, totalBudget, scopeItems with budgets, evaluation_criteria, referenceMaterials, `_magic_token`; plus `estimated_budget`, `invite_token`, `scope_item_id` (`magic:<token>`) |
| RFP list client | same `:296-307`, `:343` | vendor | `projects.client_name` (RLS: only projects the vendor is assigned to, `079_organizations.sql:1657-1663`) |
| RFP detail | `app/api/partner/rfps/[id]/route.ts:23-27`, `:71-78` `select("*")`, `:251` spread | vendor | the whole row and copy once the NDA allows |
| RFP detail client | same `:176-185` | vendor | `projects.client_name` |
| Detail page | `app/partner/rfps/[id]/page.tsx:374,391` (Client), `:377,409-418` (Program budget (master)), `:379,431-449` (All scope items with budgets), `:1559-1564` (Estimated budget (scope line)) | vendor UI | rendered all of the above |
| Bids list | `app/api/partner/rfps/bids/route.ts:159-176`, `:214` | vendor | `projects.client_name` |
| Dashboard queue | `app/api/partner/dashboard/route.ts:163-168`, `:284`, `:354` | vendor | `projects.client_name` |
| Bid submit (agency email only) | `app/api/partner/rfps/[id]/response/route.ts:450` | vendor | whole `master_rfp_json` read, only `projectName` used, not returned |
| NDA notify | `app/api/partner/rfps/[id]/nda-notify/route.ts:34` | vendor | `master_rfp_json` selected, never used |
| Network (vendor side) | `app/api/partner/network/[agencyId]/route.ts:244` | vendor | embed reads `master_rfp_json` for `projectName` only (`lib/engagement-history.ts:51-53`), not returned |
| Guest link | `app/api/rfp/guest/[token]/route.ts:172-261`, `:362-460` | guest (service role) | explicit view since WS-A: no client, no budget, no rubric, no token |
| Attach sweeps | `app/api/partner/rfps/route.ts:50-80`, `bids/route.ts:35-64`, `guest/[token]/attach-existing-account/route.ts:48-80` | service role | not returned; they WRITE the Lightning copy below |
| Notification | `lib/magic-token-attach.ts:413-422` | written by service role, read by every member of the vendor org via `/api/notifications` | `data.magicToken` (D8) |
| Lightning invitation email | `app/api/agency/rfp/magic-link/route.ts:492-496` | agency-triggered, sent to the vendor | "for <client>" and "Budget range: <projects.budget_range>" |
| Broadcast emails | `app/api/agency/broadcast-rfp/route.ts:705-790` | agency | agency and scope names only: clean |
| Post-award screens | `app/api/partner/payments/route.ts:180-256`, `partner/projects/route.ts:194,251-283`, `partner/onboarding-packages/route.ts:63`, `projects/route.ts:350-402` (partner branch) | vendor | `projects.client_name` (and `budget_range` typed but not rendered) for projects the vendor was awarded; see finding F4 |
| PDF / export | none on any vendor or guest path | | |

### b. Vendor- or guest-triggered AI calls and their consumers

Exactly three, all `generateAndSaveBidSummary` fire-and-forget calls on the service role:
`app/api/partner/rfps/[id]/response/route.ts:433` (vendor submit and every revision),
`app/api/rfp/guest/[token]/route.ts:660` (guest edit) and `:776` (guest first submit). Every other AI
route (`rank`, `decompose`, `compare`, `evaluation`, `ai-score`, `/api/ai*`, `/api/interpret/*`, MSA,
payment synthesis) is behind G1. `composite_score` is written only by agency routes
(`ai-score/route.ts:376-377`, `evaluation/route.ts:366`).

Consumers of `ai_summary_short`, `ai_summary_detailed`, `ai_summary_generated_at`, `composite_score` before
an agency member opens a bid: **none**. The agency bid email uses the proposal, budget and timeline
(`lib/email.ts:288-323`); `notifyBidSubmitted` (`lib/notifications.ts:428-446`) and the `bid.submit` /
`bid.revise` milestones carry no summary or score; vendor and guest reads use `VENDOR_RESPONSE_COLUMNS`
(`lib/server/rfp-response-private.ts:196-215`), which excludes all four; the agency list sorts by
`updated_at` (`app/api/agency/rfp-responses/route.ts:526`); ranking needs `composite_score`, which no vendor
path writes (`lib/bid-shared.ts:198-251`). No cron (`vercel.json` has none). **S1 not hit.**

### c. Writers of the vendor copy (main) and the keys they wrote

| Writer | file:line (main) | Session | Keys |
|---|---|---|---|
| Wizard broadcast, pool vendor | `app/api/agency/broadcast-rfp/route.ts:309` | agency | `{...masterRfp, nda_link}`: projectName, client, overview, objectives, scopeItems[{id, name, description, allocation, estimatedBudget, timeline}], totalBudget, timeline, business_criteria_required, budget_categories, evaluation_criteria, referenceMaterials (`app/agency/page.tsx:905-917`, sent `:1300`), nda_link; plus row `estimated_budget` = the agency estimate whether or not released (`:305`) |
| Wizard broadcast, typed address | same `:454` (`estimated_budget` `:450`) | agency | same |
| Lightning attach (all four callers) | `lib/magic-token-attach.ts:318-324` | service role | `_magic_token`, projectName, client (`projects.client_name`), totalBudget (`projects.budget_range`), business_criteria_required; row `scope_item_id = 'magic:<token>'` (`:63`, `:334`) |
| Lightning token | `app/api/agency/rfp/magic-link/route.ts:363-387` | service role | `reference_materials = {materials, output_template_config}`, `business_criteria_required`, `budget_categories`, `evaluation_criteria` (whole-value columns; agency-only RLS) |
| Toggle | `119_rfp_records_backfill.sql:296-305` via `app/api/agency/rfp-records/[id]/route.ts:82` | agency | `client_name_released` only |
| Not writers of JSON | `broadcast-rfp/resend-invite/route.ts:77`, `partner/rfps/claim/route.ts:78`, `agency/pool/resend-invitation` | | |

### d. The keys, and the inventory

In `partner_rfp_inbox.master_rfp_json`: client name `client`; rubric `evaluation_criteria`; budget
`totalBudget` and `scopeItems[].estimatedBudget` (and `allocation`); other lines `scopeItems`; token
`_magic_token`. Outside the JSON: the row column `estimated_budget` (budget) and `scope_item_id`
(`magic:<token>`). In the token: `reference_materials.output_template_config` (agency-only, D9);
`evaluation_criteria` is a whole agency-only column, never sent to a guest. Read-only inventory:
`supabase/sql-checks/120-key-inventory.sql` (one result set: every distinct top-level key across
`partner_rfp_inbox.master_rfp_json` and the four token JSON columns with total, linked and unlinked row
counts and what 120 does with it; plus the pre-flight conditions C1-C6 and findings C7-C9 as counts).

### e. Agency readers of a removed key on a linked row

**None that remains after step C.** Since step B every agency reader reads the record when the row is linked
(`lib/server/rfp-record.ts:304-543`). The one agency read of a removed key was the guest-bid join fallback
`.contains("master_rfp_json", {_magic_token})` at `app/api/agency/rfp-responses/[id]/route.ts:91-96`, which
ran only when the token's `attached_inbox_id` was NULL; step C removes it (`:70-92` now). `projectName`,
`business_criteria_required`, `budget_categories` are allow-listed and not removed. **S2 not hit.**

### f. The three attach paths

Confirmed on main: `app/api/rfp/guest/[token]/attach-existing-account/route.ts:77`,
`app/api/partner/rfps/route.ts:72`, `app/api/partner/rfps/bids/route.ts:56`. All three are triggered by a
signed-in vendor (the first also checks the account's email against the invitation, `:61-64`) and all three
call `attachMagicTokenToPartnerInbox` with **the service-role client** (`getServiceSupabase()`, `:43`,
`:44`, `:27` respectively). None set `attached_inbox_id` or `rfp_line_id`.

### g. 118's guard and those paths

`partner_rfp_inbox_link_columns_guard` and `rfp_magic_tokens_link_columns_guard`
(`118_rfp_records.sql:745-823`, `:844-904`): `v_trusted := auth.uid() IS NULL AND current_user NOT IN ('anon',
'authenticated')` (`:767`, `:864`). A supabase-js service-role request carries no `sub`, so `auth.uid()` is
NULL and `current_user` is `service_role`: trusted. Rule (1) (`:770-777`, `:867-874`) passes; rule (2)
(`:780-790`, `:877-887`) requires the line to be of the row's / token's organization; rule (3) (`:890-900`)
requires `attached_inbox_id` to name an inbox row of the token's organization. The attach writes the row with
`lead_org_id = token.org_id` and `rfp_line_id = token.rfp_line_id`, so both hold by construction. **Proven in
production:** the step A magic-link route already sets `attached_inbox_id` with the service role
(`app/api/agency/rfp/magic-link/route.ts:484-487` on main) and the 2026-10-14 smoke test showed the token
"linked and attached". **S3 not hit; no guard touched.**

### h. Joins through `_magic_token` or `magic:<token>`

| Reader | file:line (main) | Link-column alternative |
|---|---|---|
| Attach dedupe | `lib/magic-token-attach.ts:104-108` (`_magic_token`), `:114-119` (`scope_item_id = 'magic:'||token`) | `rfp_magic_tokens.attached_inbox_id`; 119 set it on the first row of every token with a row (`119_rfp_records_backfill.sql:612-623`) |
| Guest-bid join (agency) | `app/api/agency/rfp-responses/[id]/route.ts:91-96` | `attached_inbox_id`, already primary since step B (`:81-90`) |
| 119 (SQL, applied) | `119_rfp_records_backfill.sql:376`, `:607-608`, `:640-651` | n/a |

After 119 every live Lightning inbox row is linked, and every token with a row has `attached_inbox_id` (the
only step A token, `21f9d17d`, is attached; 119 attached the rest). The one exception is `04391718`, whose
token row does not exist, so no join of any kind is possible for it. A row created by the old vendor-side
attach **after** 119 was applied (2026-10-14) and before this branch deploys could be reachable only through
its marker; that is data, not code: the key inventory counts it (C3) and 120's pre-flight refuses while any
exists. **S4 not hit.**

### i. The release columns

Added by 118 (`118_rfp_records.sql:712-719`): `partner_rfp_inbox.client_name_released text`,
`rfp_magic_tokens.client_name_released text`. **No released-budget column was added on either table**; the
released budget lives only on `rfp_record_lines.released_budget`, which vendors cannot read (D1). On main no
vendor reader used `client_name_released`. **Equivalent chosen (assumption A1):** the existing per-line
column `partner_rfp_inbox.estimated_budget` carries the line's released budget from step C on (NULL when not
released); 119 backfilled released = estimated (D2), so every backfilled row already holds its release there.
**S5 not hit:** every vendor-visible field was classified (section 3; finding F1 for `estimated_budget` on
rows step A wrote before this branch; F2 for `scope_item_id`).

## 3. The allow-list and why each key is on it

`lib/rfp-vendor-copy.ts:46-55` (`VENDOR_COPY_KEYS`), the same list in `public.rfp_vendor_copy_keys()`
(`120_rfp_vendor_copy_scrub.sql:162-169`); the test's S6 compares them.

| Key | Why a vendor may hold it |
|---|---|
| `projectName` | the project the vendor bids on; rendered on the RFP page and in award/decline mail |
| `overview`, `objectives` | the brief written for vendors; rendered |
| `timeline` | the programme timeline ("Timeline (master)"); not budget, client, rubric or another line |
| `business_criteria_required` | requirements the vendor must answer in its bid (`BusinessCriteriaRequirementBlock`); the guest link already sends the same |
| `budget_categories` | category names and vendor-facing notes the vendor prices against; no amounts; the guest link sends the same |
| `nda_link` | the NDA the vendor must sign before it may open the RFP |
| `response_deadline` | the vendor's own deadline (fallback for old rows; the row column is primary) |

Not allowed: `client`, `totalBudget`, `scopeItems`, `evaluation_criteria`, `referenceMaterials` (no vendor
screen reads it from the copy; deny by default), `_magic_token`, and anything added later. Token:
`TOKEN_REFERENCE_MATERIALS_KEYS = ['materials']` (`lib/rfp-vendor-copy.ts:63`,
`rfp_token_reference_materials_keys()`), because `output_template_config` is agency-only and on the record (D9).

## 4. Every vendor and guest reader, before and after

| Reader | Before (main) | After (branch) |
|---|---|---|
| RFP list | `select("*")`, whole rows spread; client from `projects` | `VENDOR_INBOX_LIST_COLUMNS` (`app/api/partner/rfps/route.ts:239`), no copy, no `estimated_budget`, no `scope_item_id`, no invite token; rows built field by field (`:323-354`); client = `client_name_released` (`:350`) |
| RFP detail | `select("*")` twice, whole row; client from `projects` | `VENDOR_INBOX_DETAIL_COLUMNS` (`app/api/partner/rfps/[id]/route.ts:56`, `:109`); `vendorInboxView()` (`:17-38`) returns only what the page reads with the copy narrowed by `pickVendorCopy`; client = `client_name_released` (`:210`) |
| RFP page | client, programme budget, all lines rendered from the copy | `MasterRfpSections` renders project, overview, objectives, timeline, criteria only (`app/partner/rfps/[id]/page.tsx:368-452`); scope budget labelled "Budget (scope line)" = the released figure (`:1526-1528`) |
| Bids list | client from `projects` | `client_name_released` from the bid's inbox row (`app/api/partner/rfps/bids/route.ts:157-176`, `:212`) |
| Dashboard queue | client from `projects` | `client_name_released` (`app/api/partner/dashboard/route.ts:166`, `:354`) |
| Bid submit email lookup | whole copy | `master_rfp_json->>projectName` only (`app/api/partner/rfps/[id]/response/route.ts:448-456`) |
| NDA notify | selected the copy | copy no longer selected (`app/api/partner/rfps/[id]/nda-notify/route.ts:34`) |
| Network (vendor side) | copy embed for `projectName` | unchanged (allow-listed key; not returned) |
| Guest link | explicit view, no client | adds `project.client_name` = `rfp_magic_tokens.client_name_released` only (`app/api/rfp/guest/[token]/route.ts:192-197`, `:407`); still no budget; page type note `app/rfp/respond/[token]/page.tsx:108-110` |
| Notification | `data.magicToken` | `data: { inboxId }` only (`lib/magic-token-attach.ts:405`) |
| Lightning email | client and budget range always | client only when shown, released budget only (`app/api/agency/rfp/magic-link/route.ts:514-522`) |

Writers after: broadcast builds every row through `buildVendorCopy` (`app/api/agency/broadcast-rfp/route.ts:208-221`, `:274`, rows `:322-327`, `:468-473`); the attach writes `pickVendorCopy({projectName, business_criteria_required})` with the token's line and released client name (`lib/magic-token-attach.ts:306-313`); the magic-link token keeps `{materials}` only (`app/api/agency/rfp/magic-link/route.ts:380-388`) and the attached row gets the send's line, released client name and released budget (`:497-505`).

Attach after (`lib/magic-token-attach.ts:183-416`): (1) the token's `attached_inbox_id` (`:236-244`); (2) else
the row the token's own bid points at, when of the token's organization and on its line or none, claimed with
a compare-and-set (`:246-272`); (3) else a new row (`:274-356`), claimed with a compare-and-set on
`attached_inbox_id` while NULL (`claimAttachedInbox`, `:109-131`); the loser of a race removes its own row
(`:135-152`, `:349-356`).
No `_magic_token` or `magic:` lookup remains.

## 5. Ruling S-A as built

- **Removed generation points:** `app/api/partner/rfps/[id]/response/route.ts:433` (main) → now `:421-438`;
  `app/api/rfp/guest/[token]/route.ts:660` → `:668-672`; `:776` → `:781-783`. Nothing else generated on a
  vendor or guest path.
- **Pending representation:** **NULL, no new column.** A bid is pending when it has a response and
  `ai_summary_generated_at` is NULL (no row in `partner_rfp_response_private`) (`isBidSummaryPending`,
  `lib/bid-summary-queue.ts:61-63`). A **revision** marks the old summary pending again
  (`markBidSummaryPending`, `lib/bid-summary-generation.ts:171-194`): three NULLs written with the service
  role scoped to the bid's lead organization (vendor route `:428-438`; the guest route already runs on the
  service role, `:672`). It reads nothing and writes nothing else.
- **Server idempotency:** `app/api/agency/bids/[responseId]/generate-summary/route.ts:27-56`: unless the body
  says `{force: true}`, a bid whose short and detailed summaries both exist is answered from storage with
  `skipped: true`, no AI call, no usage counted; the read is the caller's own (109's table filtered by the
  caller's organizations), so another organization's bid reads as incomplete and then 404s as before.
- **Warm-up:** `app/agency/bids/page.tsx:592-610`: once the list has loaded, every pending bid is queued
  (`warmUpBidSummaries`, `lib/bid-summary-queue.ts:130-142`), **at most 2 at a time**
  (`WARMUP_CONCURRENCY`, `:27`; `pump`, `:117-128`); a bid already queued, running or failed is skipped.
- **On demand:** `requestBidSummary` (`:147-155`) runs now, outside the limit, and joins a call already
  running for the bid. Detail sheet `components/bid-detail-sheet.tsx:200-248` (auto on open when the detailed
  analysis is missing); compare view `components/bid-compare-view.tsx:88-115` (`CompareSummaryCell`) and the
  mount effect `:148-157`.
- **States:** "Generating summary..." while queued or running (card `app/agency/bids/page.tsx:66-73`, sheet
  `components/bid-detail-sheet.tsx:498`, compare `components/bid-compare-view.tsx:110`); a failure shows the
  error with **Retry** (card `:75-84`, sheet `:502-508`, compare `:96-106`); never a blank. Regenerate sends
  `force` (`app/agency/bids/page.tsx:287`).

## 6. Migration 120

- Files: `120_rfp_vendor_copy_scrub.sql`, `120_rfp_vendor_copy_scrub_down.sql`, `120_preapply_test.sql`;
  `supabase/sql-checks/120-key-inventory.sql` (read-only).
- **Lines:** BEGIN 153, **COMMIT 540**; markers BODY START **154** / BODY END **539** in the migration;
  **548 / 933** in the test's inlined copy. Byte-identical: `cmp` from both markers first differs at byte
  21312 (the line after BODY END: `COMMIT;` against `$m120$;`), so all 21311 body bytes match. Down file:
  BEGIN 27, COMMIT 45. Test: BEGIN 99, ROLLBACK 1226.
- **Order inside the body:** the two allow-list functions (the only copy of each list), the LG120 pre-flight
  (`:203-334`), the scrub (`:340-403`), the two guards and triggers (`:411-493`), the post-check and result
  (`:499-538`).
- **Expected assertion count: 29** (17 scenarios + 11 self-checks + M). **INCONCLUSIVE by design: none.**
  S10 is INCONCLUSIVE only if inbox `04391718` no longer exists. NOT DISCRIMINATING by design: V7, W1, A3,
  A5, N1, N2 (W1 because 118's vendor allow-list already refuses a vendor's write of the column; 120's guard
  stands behind it).
- **Scenarios:** V1-V6 vendor reads (keys outside the allow-list, client, rubric, budget in the copy, other
  lines, `_magic_token`: SOME before, NONE after, on a fixture row of the vendor plus live data); V7 the
  released client name and budget survive; W1 vendor write refused; A1/A2 agency update/insert with a
  disallowed key (OK before, 23514 after); A3 allowed insert passes; A4/A5 token `reference_materials`; O1/O2
  the owner on the trusted path refused too ("every role"); N1/N2 anon.
- **Self-checks:** S1 no policy changed (prints the count, expected 161); S2 no grant changed outside the new
  functions; S3 triggers changed only by the two new guards (and both are BEFORE ROW INSERT OR UPDATE,
  enabled); S4 exactly four functions added; S5 invoker, pinned, EXECUTE as designed; S6 allow-lists equal
  the code's; S7 counts same, only the two JSON columns written; S8 no key outside the allow-lists anywhere;
  S9 every kept key and value unchanged; S10 `04391718` unlinked, scrubbed, listed; S11 a second run changes
  nothing and says so.
- Not run: no Postgres or credentials here. The test is the parse check.

## 7. SECURITY REVIEW LIST

1. `lib/rfp-vendor-copy.ts:46-63` allow-lists (deny by default); `:68-75` `pickVendorCopy`; `:111-117`
   `buildVendorCopy` (client only when shown, budget only when released); `:127-139` vendor column lists (no
   `scope_item_id`, no invite token).
2. `app/api/agency/broadcast-rfp/route.ts:208-221`, `:274`, `:322-327`, `:468-473`: agency session after G1;
   the client snapshot is the server-verified project's (`:185-201`) or the master's; `client_name_released`
   is a link column under 118's guard (member of the row's lead organization). Retry drops a missing 118
   column only (`:603-616`).
3. `app/api/agency/rfp/magic-link/route.ts:312-318`, `:380-388`, `:497-505`, `:514-522`: G1; service role for
   the token (as before); `client_name_released` and the released budget derived from the request's validated
   `show_client_to_vendors` / `release_budget` (zod, `lib/server/rfp-record.ts:126-132`) and the
   server-loaded project; the output template stays on the record (D9) except when no record exists.
4. `lib/magic-token-attach.ts:183-416`: service role from three vendor-triggered routes (unchanged callers;
   each verifies the vendor's identity first). Reads only rows of the token's organization
   (`.eq("lead_org_id", tokenRow.org_id)`, `:97`); the compare-and-set is scoped to the token and its
   organization (`:117-120`); 118's guard checks line and inbox organization. Never reads `rfp_records`.
5. `app/api/partner/rfps/route.ts:239`, `:323-354`; `app/api/partner/rfps/[id]/route.ts:17-38`, `:56`, `:109`,
   `:210`; `app/api/partner/rfps/bids/route.ts:157-176`; `app/api/partner/dashboard/route.ts:166`, `:354`:
   vendor session under RLS, explicit columns, client only from `client_name_released`.
6. `app/api/rfp/guest/[token]/route.ts:192-197`, `:407`: token-bearer route on the service role; adds only the
   released client name.
7. `app/api/agency/rfp-responses/[id]/route.ts:70-92`: agency session; the `_magic_token` fallback join is
   gone; both reads stay scoped to the caller's organizations.
8. `lib/server/rfp-record.ts:524-559`, used at `app/api/agency/utilization/route.ts:103-108,202`,
   `msa/milestones/route.ts:186-202`, `msa/ai-schedule/route.ts:180-181`: agency session after G1, RLS on the
   lines (paid lead agency) plus `.in("lead_org_id", orgIds)`; a linked row whose line cannot be read gives no
   estimate, never the vendor's figure.
9. `lib/bid-summary-generation.ts:139-193` and the two submit routes: the vendor/guest path writes three NULLs
   to the bid's private summary with the service role, scoped to the bid's lead organization; nothing is read.
10. `app/api/agency/bids/[responseId]/generate-summary/route.ts:27-56`: G1 first; the idempotency read is the
    caller's own; usage is checked and counted only when a model call is made.
11. `lib/bid-summary-queue.ts`: browser-only; calls the agency route; no new endpoint.
12. Migration 120: functions `rfp_vendor_copy_keys()`, `rfp_token_reference_materials_keys()` (sql,
    IMMUTABLE, invoker, pinned; EXECUTE revoked from PUBLIC and anon, granted to authenticated and
    service_role because the guards call them as the invoker); `partner_rfp_inbox_vendor_copy_guard()`,
    `rfp_magic_tokens_vendor_copy_guard()` (plpgsql, invoker, pinned; EXECUTE revoked from PUBLIC, anon,
    authenticated); triggers BEFORE INSERT OR UPDATE FOR EACH ROW; no policy, no grant on an existing object,
    no column. The scrub writes only `master_rfp_json` and `reference_materials`, on the trusted path.

## 8. Findings for the owner

- **F1. Budget beyond the release on rows step A wrote before this branch.** Step A's broadcast wrote the
  agency's estimate into `partner_rfp_inbox.estimated_budget` whether or not the line was released
  (`broadcast-rfp/route.ts:305`, `:450` on main). Step C writes the released figure; 120 does not touch the
  column (brief: no other column). Rows sent between step A's deploy and this branch's with a hidden line
  still show the estimate to their vendor, in the app and directly. The key inventory counts them (C7: linked
  rows whose `estimated_budget` is not the line's `released_budget`). Options: (a) a one-statement data fix
  setting `estimated_budget = released_budget` on those linked rows (owner-run, after this branch deploys);
  (b) fold it into a 121; (c) accept. Recommended: (a) if C7 is not 0. Also: Lightning rows show no budget
  at all to the vendor even when D2 released it (the vendor-triggered attach must not read the record);
  vendors see less, never more.
- **F2. The token inside `scope_item_id`.** A Lightning inbox row's `scope_item_id` is `magic:<token>`
  (`lib/magic-token-attach.ts:71-73`), the vendor organization's own bearer link, readable by every member of
  that organization directly with their login (the same concern as D8). Step C stops serving it through the
  app (no vendor column list selects it) and nothing joins on it any more; 120 leaves it unchanged as
  instructed. Options: (a) new rows use `magic:<token row id>` and a 121 rewrites existing rows (no reader
  depends on the format since step C); (b) accept as the vendor's own credential. Count: inventory C8.
- **F3. `magicToken` in existing notifications.** New notifications no longer carry it (D8); rows written
  before still do and are readable by every member of the vendor organization. Count: inventory C9. Option: a
  data fix removing the key from `notifications.data`.
- **F4. Post-award client name.** Awarded vendors read `projects.client_name` on the projects, payments,
  onboarding and partner-project routes (section 2a), and directly through `projects_partner_select_assigned`
  (`079_organizations.sql:1657-1663`). Step C scoped the RFP surfaces only. Whether D3 ("client hidden by
  default") covers an awarded vendor is a ruling; closing it at the database would be a policy or column
  change (not in step C).
- **F5. Free text may name the client.** `projectName`, `overview` and `objectives` are allow-listed; an AI-
  or human-written overview can mention the client. Not classifiable from code; the agency writes them.
- **F6. The summary cost moved to the agency's AI quota.** Warm-up and on-demand generation go through the
  agency route's `ai_analyses` usage check; vendor-triggered generation used none. At the cap, warm-up shows
  Retry and a manual click opens the usage modal. Two browser tabs can still generate the same pending bid
  twice (check-then-generate on the server).
- **F7. The resend wipe (pre-existing).** `components/agency-rfp-magic-link-invite.tsx` resends with only
  email, name and project; the magic-link upsert then writes empty criteria, categories and materials onto
  the token. Not changed.
- **F8. Guest new-bid drops `proposal_sections`** (pre-existing; `app/api/rfp/guest/[token]/route.ts` insert
  row). Not changed.

## 9. REFUSED, ASSUMPTIONS, STOPPED ON

**Stopped on:** nothing. S1-S5 not hit (section 2).

**Assumptions (owner may overrule):**
- **A1** `partner_rfp_inbox.estimated_budget` is the vendor's released-budget column (no such column exists;
  119 backfilled released = estimated). The three agency readers of that column now read the record line for
  linked rows (section 7 item 8).
- **A2** "The token JSON" is `rfp_magic_tokens.reference_materials`, the token's one object-shaped column a
  guest path reads; its allow-list is `materials`. The whole-value columns (`business_criteria_required`,
  `budget_categories`, `evaluation_criteria`) are not scrubbed (agency-only RLS; the guest API sends an
  explicit view; the brief says touch no other column).
- **A3** `business_criteria_required` and `budget_categories` are vendor-facing requirements, not "rubric or
  evaluation criteria"; the rubric is `evaluation_criteria`.
- **A4** Pending = `ai_summary_generated_at` NULL; a revision clears the old summary (service role, three
  NULLs). Idempotent = short and detailed both present.
- **A5** 120's only accepted unlinked row is `04391718` (named in the file); any other unlinked row that would
  lose a value is refused.
- **A6** `CREATE OR REPLACE TRIGGER` needs PostgreSQL 14+ (Supabase runs 15 or later).
- **A7** On-demand generation (an opened bid) is not counted against the warm-up's limit of 2.

**Not done:** no data fix for F1-F3; post-award client name (F4); `app/api/agency/rfp-closure/route.ts`
grouping by `rfp_line_id` (from step B, still a product decision).

**Gates:** `./node_modules/.bin/tsc --noEmit` exit 0 (run directly, not through pnpm, in this worktree).
`pnpm lint --format json -o .lint-all.json`: 153 errors repo-wide against 154 on main (one pre-existing
violation removed in `components/bid-compare-view.tsx`); every error left in a touched file is on a line this
branch did not write (`app/agency/bids/page.tsx:361`, `components/bid-compare-view.tsx:163,251,275`,
`components/bid-detail-sheet.tsx:245`, `app/partner/rfps/[id]/page.tsx:646,774,812`,
`app/rfp/respond/[token]/page.tsx:338`, `app/agency/utilization/page.tsx` untouched). The report file
`.lint-all.json` is untracked in the worktree (this session could not delete it). No markdown-link
corruption in `app/`. No migration numbered 119 or below and nothing in `supabase/data-fixes` was edited.
