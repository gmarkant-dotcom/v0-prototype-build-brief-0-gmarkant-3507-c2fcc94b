# RFP record step B and migration 119: run report, 2026-10-14

Branch `feat/rfp-record-b` (worktree off `main` at `7266686`). Unattended run. Nothing pushed, merged or
applied. Design and rulings: `docs/rfp-source-of-truth-design.md` (D1-D9 section 6; as built: section 8).
Test script: `docs/rfp-record-test-script.md` parts E to H.

State at the start (owner, 2026-10-14): 118 applied and catalog-verified (pre-apply 96 PASS, 0 FAIL, 1
INCONCLUSIVE by design, C3); 161 public policies; RLS on both new tables, 3 policies each; four guards
enabled; 97 inbox rows, none linked; F1 closed in production; smoke-test record
`21f9d17d-6b6c-471c-8cfb-931d631b6ca4`. Next free migration: 119.

## 1. Commits

| Commit | What |
|---|---|
| `7a7ec85` | feat: step B readers on the record, inbox copy as fallback only when `rfp_line_id` is NULL; guest-bid join via `attached_inbox_id`; shared helper in `lib/server/rfp-record.ts` |
| `34ac23f` | feat: `PATCH /api/agency/rfp-records/[id]` (G1, zod, org scope, one call to 119's function, 503 before 119) and the bids-page toggle panel |
| `1d36a4d` | feat: migration 119 (function + backfill), down file, pre-apply test (33 assertions). Not applied |
| docs commit | this report, design section 8, test script parts E-H, state of record, roadmap, LIGAMENT_CONTEXT |

## 2. STEP 0 answers. No stop condition was hit.

### a. Agency-side readers of vendor inbox copies

Grep of `master_rfp_json`, `evaluation_criteria`, `budget_categories`, `business_criteria_required`,
`_magic_token`, `projectName`, `scopeItems` across `app/api/agency`, `lib`, `components` (and the agency
pages). The design's section 0 table holds; line numbers on `main` (`7266686`):

| Reader | Reads from the copy | main file:line | Session? |
|---|---|---|---|
| Rubric | `evaluation_criteria` | `lib/rfp-evaluation-criteria-server.ts:75-82` | agency session from `bids/[responseId]/evaluation:94,172`, `ai-score:194`, `generate-summary:29`; **service role, vendor- or guest-triggered** from `lib/bid-summary-generation.ts:55` when called by `app/api/partner/rfps/[id]/response/route.ts:433` and `app/api/rfp/guest/[token]/route.ts:660,776` |
| AI context | scope name / description (inbox row columns) | `lib/bid-analysis-context.ts:79-97` | agency session from `decompose:154`, `evaluation:342`, `ai-score:232`, `compare:144,149`; service role via the same two vendor/guest summary calls |
| Rank grouping | scope name (row column) | `lib/bid-analysis-context.ts:172-196` via `bids/rank:61` | agency session |
| Bid list / compare / detail | `business_criteria_required`, `budget_categories` | `app/api/agency/rfp-responses/route.ts:214`, `:301-308`, `:326`; rendered by `components/bid-compare-view.tsx:65,76,424,606`, `bid-detail-sheet.tsx:130` | agency session |
| Award | `projectName` | `app/api/agency/rfp-responses/[id]/route.ts:369`, `:1049-1050` | agency session |
| Decline | `projectName`, scope | same file `:1148-1153`, `:1181-1183` | agency session |
| Guest-bid join | `_magic_token` | same file `:88-93` (guest context), `:411-416` (award); `lib/magic-token-attach.ts:108` (locked) | agency session; the attach is service role (vendor side) |
| Engagement history | `projectName` | `lib/engagement-history.ts:41-50` via `app/api/agency/pool/[partnerId]/route.ts:199,239` | agency session (vendor direction `app/api/partner/network/[agencyId]/route.ts:291`, unchanged) |

**Added by this sweep (not in the design's table):** the vendor- and guest-triggered summary path above
(service role, not agency-gated); the bids-page components only consume the API payload. Everything
else the grep hits is the wizard's own state, client profiles, email templates, the writers
(`broadcast-rfp`, `magic-link`), or `projectName` read from `projects.name`. No agency reader selects
whole inbox rows.

### b. The trusted path in 118's link-column guards

`v_trusted := auth.uid() IS NULL AND current_user NOT IN ('anon', 'authenticated')`:
`supabase/migrations/118_rfp_records.sql:767` (inbox guard; used by rule (1) `:770-777` and rule (4)
`:794-796`) and `:864` (token guard; rule (1) `:867-874`). The SQL Editor runs as `postgres` with no
JWT claims: `auth.uid()` is NULL and `current_user` is `postgres`, so a migration **passes** when it sets
`rfp_line_id` / `attached_inbox_id`. Rules (2) and (3) still run (the line and the attached row must be of
the row's own organization) and 119 satisfies them by construction. 118's own pre-apply test wrote link
columns from the same role in its setups (K5, K14) and passed. 119 checks the trusted path itself before
writing (`119_rfp_records_backfill.sql:251-255`) and refuses otherwise. No guard was touched.

### c. The columns the backfill groups on

- `partner_rfp_inbox`: `lead_org_id`, `project_id`, `created_at` (the send; broadcast-rfp inserts a
  send's rows in one statement, `app/api/agency/broadcast-rfp/route.ts:587`), `scope_item_id` (text NOT
  NULL; the line key), `scope_item_name`, `scope_item_description`, `estimated_budget` (text),
  `master_rfp_json` (`evaluation_criteria`, `budget_categories`, `business_criteria_required`,
  `projectName`, `totalBudget`, `client`, `nda_link`, `scopeItems`, and `_magic_token` on Lightning
  rows), `response_deadline`, `close_bidding_at_deadline`, `require_terms_disclosure`, `recipient_email`
  (not used for grouping: one send covers pool vendors and typed addresses alike), `rfp_line_id`.
- `rfp_magic_tokens`: `id`, `token`, `org_id`, `project_id`, `scope_item_id` (uuid, usually NULL),
  `scope_item_name`, `scope_item_description`, `reference_materials` (array, or `{materials,
  output_template_config}`), `business_criteria_required`, `evaluation_criteria`, `budget_categories`,
  `response_deadline`, `close_bidding_at_deadline`, `require_terms_disclosure`, `created_at`,
  `rfp_line_id`, `attached_inbox_id`. A Lightning inbox row carries `master_rfp_json._magic_token = token`
  or `scope_item_id = 'magic:' || token` (`lib/magic-token-attach.ts:62-64`, `:99-131`).
- `projects`: `id`, `org_id`, `name`, `client_name`, `budget_range`.

### d. Code paths that attach a token to an inbox row

| Path | file:line | Sets `attached_inbox_id`? |
|---|---|---|
| Agency send-time attach (recipient has an account) | `app/api/agency/rfp/magic-link/route.ts:454`; links `:478-487` | **yes** (step A) |
| Guest "attach to my existing account" | `app/api/rfp/guest/[token]/attach-existing-account/route.ts:77` | no |
| Vendor portal sweep, RFP list | `app/api/partner/rfps/route.ts:72` | no |
| Vendor portal sweep, bids list | `app/api/partner/rfps/bids/route.ts:56` | no |
| Portal claim | `app/api/partner/rfps/claim/route.ts:76-84` | n/a: claims a broadcast invite row, no token involved |

All four token paths go through `attachMagicTokenToPartnerInbox` (`lib/magic-token-attach.ts:229`), which
sets neither `rfp_line_id` nor `attached_inbox_id`. Locked for step C; nothing changed.

## 3. Each reader: before, after, fallback, client

| Reader | Before (main) | After (branch) | Fallback, only when `rfp_line_id` is NULL | Client |
|---|---|---|---|---|
| Rubric | `lib/rfp-evaluation-criteria-server.ts:75-82` | `:83-88` | inbox `master_rfp_json.evaluation_criteria`; token column | session ("session" at `evaluation/route.ts:94,172`, `ai-score/route.ts:194`, `generate-summary/route.ts:30`) |
| AI context | `lib/bid-analysis-context.ts:79-97` | `:84-91` | inbox / token scope columns | session ("session" at `decompose:154`, `evaluation:342`, `ai-score:232`, `compare:144,149`, generate-summary) |
| Summary (agency) | `lib/bid-summary-generation.ts:49,55` | `:54,60` with `recordMode` | as above | session |
| Summary (vendor / guest submit) | same | **unchanged** (`recordMode` defaults to "skip") | n/a | service role, NOT agency-gated: left on current behaviour |
| Bid list | `app/api/agency/rfp-responses/route.ts:301-308,326` | `:236-249`, `:324-350` | inbox copy; token `business_criteria_required` | session |
| Award | `[id]/route.ts:1049-1050` | `:790-810`, used `:1116-1117` (`awardContext.projectName/scopeItemName`) | `master_rfp_json.projectName`; row `scope_item_name` | session |
| Decline | `[id]/route.ts:1181-1183` | `:1247-1265` | same | session |
| Guest context | `[id]/route.ts:60-109` | `:100-161` | synthesized row's copy | session |
| Guest-bid join | `[id]/route.ts:88-93`, `:411-416` | `findSynthesizedInboxForToken` `:77-98`, used `:128`, `:467` | `.contains("master_rfp_json", {_magic_token})` | session, `.in("lead_org_id", callerOrgIds)` on both reads |
| Engagement history | `lib/engagement-history.ts:41-50`, pool `:199,239` | engagement-history `:41-89`; pool `:242-264` | `master_rfp_json.projectName` | session |

Helper: `lib/server/rfp-record.ts:304-543` (`readInboxLineIds :363`, `readTokenLinksByResponse :390`,
`readTokenAttachedInboxId :419`, `readRecordLines :440`, `resolutionFor :516`,
`resolveRecordForResponse :525`). A bid's line is its inbox row's, else its token's. A linked row whose
record cannot be read answers with nothing (never the copy); a link column that cannot be read counts
as unlinked (today's behaviour). **No reader uses the service role**, so the "scoped service role" rule
was not needed anywhere.

Not moved, listed: `resolveResponseScope` (rank group hash must match the browser's `scopeKeyForRow`, both
read row columns); the feedback mail and shortlist / meeting milestones for portal bids (row
`scope_item_name`, not a copy key); `app/api/agency/rfp-closure/route.ts` (design section 5 names it for B;
it is a writer and changing what "close the whole RFP" covers is a product decision; see 9).

## 4. The toggle

- Route `app/api/agency/rfp-records/[id]/route.ts` (PATCH only): session `:45-49` (401); **G1** `:52-53`
  (402); zod id `:55-56` (404 on a non-uuid) and body `:59-63` (400; `.strict()`, exactly
  `{ show_client_to_vendors: boolean }`); **organization scope** `:66-80` (re-read under RLS with
  `.in("lead_org_id", callerOrgIds)`; another org's record or unknown id is 404); one call
  `supabase.rpc("rfp_record_set_client_visibility")` `:82-85` on the session client; P0002 from the
  function is 404 `:89`.
- **503 before 119:** the function is missing (42883 / PGRST202) `:87`, and before 118 the table read
  answers 42P01 / PGRST205 `:76`. Nothing is written in either case: the only write is the function call.
- Function `119_rfp_records_backfill.sql:263-322`: SECURITY INVOKER, `search_path` pinned, REVOKE
  PUBLIC / anon, GRANT authenticated. Step 1 updates the record under RLS and RAISES P0002 on zero rows
  before any other write (`:282-291`); step 2 sets `client_name_released` on every linked inbox row and
  token (`:295-306`). One call is one statement: any error rolls the whole call back.
- UI: `components/rfp-record-client-toggle.tsx` on `app/agency/bids/page.tsx` (panel under the header).
  Reads sent, unarchived records with the browser client (RLS); renders nothing while loading, before
  118, or with no records. Copy from `lib/rfp-record-copy.ts` (`SHOW_CLIENT_TO_VENDORS_EXISTING_HINT`,
  driven by `RFP_VENDOR_COPY_SCRUBBED = false`: "Vendors still see the client name in this release; this
  setting takes effect for vendors in the next release.") and the 503 message.

## 5. Migration 119

- Files: `119_rfp_records_backfill.sql`, `119_rfp_records_backfill_down.sql`, `119_preapply_test.sql`.
- **Grouping:** wizard sends = unlinked non-Lightning inbox rows by `(lead_org_id, project_id,
  created_at)`, lines by `scope_item_id` (D4). Lightning = **one record per unlinked token**, from the
  token and the project (D6). Lightning inbox rows still unlinked after that are linked to their token's
  existing step A line, or refused if the token is missing or was refused.
- **Write order** per record (`:442-507` wizard, `:556-631` Lightning): record without `broadcast_at`,
  lines, `rfp_line_id` on rows and tokens, `attached_inbox_id` (first row by `(created_at, id)`),
  `broadcast_at` last = original send time. D2 released = estimated; D3 client hidden; source `backfill`.
- **Provenance rule** (`:383-403`, `:418-437`): 2+ copies must agree on rubric, categories and
  requirements, and per line on name, description and estimated budget, else REFUSED (RAISE WARNING
  LG119, listed, rows left unlinked). Single copy: built, `backfill_note` starts `unverified single
  copy`, listed. Client name from `projects.client_name`; a mismatch is noted `client name taken from
  project`; no project: the copy's name, noted. Project missing or another org's: refused.
- **Refusals** skip the group and continue (they do not abort the file). The file aborts (nothing
  committed) on: 118 missing, a guard missing, a column missing, an existing backfill (idempotency), the
  function already present, not on the trusted path, or any accounting mismatch (`:685-705`: every inbox
  row and token linked or listed; every backfilled record with lines, a send time, client hidden).
- **Result:** final RAISE NOTICE with counts and lists (`:729-741`) and the same JSON in the
  transaction-local setting `ligament.backfill_119` (`:726`). V2-V4 in the header reproduce the lists
  from the tables in case the SQL Editor hides notices.
- **Lines:** BEGIN 202, **COMMIT 748**, markers BODY START **203** / BODY END **747** in the migration;
  **572 / 1116** in the test's inlined copy (identical: `git diff --no-index` shows no hunk between the
  markers). Down file: BEGIN 42, COMMIT 93.
- **Pre-apply test:** **33 assertions** (16 scenarios + 16 self-checks + M). **INCONCLUSIVE by design:
  U1, X1** (no unpaid or second paid lead agency). NOT DISCRIMINATING by design: V1, V2, V3, N1. The
  test runs the real backfill inside its transaction and prints the BACKFILL lines (refused,
  unverified, corrections, counts) before rolling everything back. Not run (no Postgres here).

## 6. Attach paths that do not set `attached_inbox_id` (step C)

`app/api/rfp/guest/[token]/attach-existing-account/route.ts:77`, `app/api/partner/rfps/route.ts:72`,
`app/api/partner/rfps/bids/route.ts:56` (all via `lib/magic-token-attach.ts:229`, which also leaves
`rfp_line_id` NULL on the row it creates). Until step C changes them, a row they create after 119 is
unlinked and the readers resolve it through the token's line (`resolveRecordForResponse` falls back to
the token by `response_id`) or the `_magic_token` join.

## 7. Vendor-facing behaviour is unchanged

`git diff --stat main...HEAD` (code): `app/agency/bids/page.tsx`, `app/api/agency/bids/**` (5 routes),
`app/api/agency/pool/[partnerId]/route.ts`, `app/api/agency/rfp-records/[id]/route.ts` (new),
`app/api/agency/rfp-responses/route.ts`, `app/api/agency/rfp-responses/[id]/route.ts`,
`components/rfp-record-client-toggle.tsx` (new), `lib/bid-analysis-context.ts`,
`lib/bid-summary-generation.ts`, `lib/engagement-history.ts`, `lib/rfp-evaluation-criteria-server.ts`,
`lib/rfp-record-copy.ts`, `lib/server/rfp-record.ts`, and the three 119 files. **No file under
`app/api/partner/**`, `app/partner/**`, `app/api/rfp/guest/**`, no vendor component, and not
`lib/magic-token-attach.ts`.** Four shared libraries are used by vendor routes; each new parameter is
optional and defaults to today's behaviour: `generateAndSaveBidSummary(..., recordMode = "skip")`,
`loadBidAnalysisContext(..., "skip")`, `resolveRfpRubricForResponse(..., "skip")`,
`buildEngagementHistory(respRows, projectMeta)` (no third argument from
`app/api/partner/network/[agencyId]/route.ts:291`). Vendors do not read `client_name_released` yet.

## 8. SECURITY REVIEW LIST

1. `lib/server/rfp-record.ts:304-543`: record reads only in `"session"` mode, on the caller's client,
   under 118's RLS, plus `.in("lead_org_id", orgIds)` on lines and records; empty org set reads nothing.
2. `"session"` call sites are all agency routes after G1 on the session client (section 3); the
   vendor/guest summary path stays `"skip"` (`lib/bid-summary-generation.ts:52`).
3. Guest-bid join `app/api/agency/rfp-responses/[id]/route.ts:77-98`: the token's `attached_inbox_id` is
   read with `.in("org_id", callerOrgIds)`, the row with `.in("lead_org_id", callerOrgIds)`.
4. Toggle route `app/api/agency/rfp-records/[id]/route.ts:52` (G1), `:55-63` (zod, strict), `:66-80`
   (org scope, 404), `:82` (one rpc on the session client), `:76`/`:87` (503, nothing written).
5. Function `119_rfp_records_backfill.sql:263-322`: SECURITY INVOKER; P0002 before any write; EXECUTE
   revoked from PUBLIC and anon. **Note:** Supabase's default privileges likely leave EXECUTE with
   `service_role`, which bypasses RLS and is on 118's trusted path, so a service-role call could toggle
   any record. No code calls it that way; revoke from `service_role` too if wanted (owner decision).
6. Toggling ON writes `client_name_released` into inbox rows vendors read whole (`select("*")`). Vendors
   already see the client name today (master `client`, `projects.client_name` joins), so this adds no
   disclosure; step C makes it the only path.
7. Backfill trusted-path check `:251-255`; provenance refusals `:383-403`; client name from the project
   `:422-433`; token values never printed (rows named by id, `:527-528`); accounting `:685-705`.
8. Backfill writes rely on the SQL Editor role seeing every row (owner / BYPASSRLS). Every write's row
   count is checked and a shortfall aborts the file (`:494-498`, `:597-600`, `:671-676`).
9. `components/rfp-record-client-toggle.tsx`: browser client under RLS, no new GET route.
10. Down file `119_rfp_records_backfill_down.sql:55-82`: trusted-path check; unlinks then deletes
    `source = 'backfill'` only.

## 9. REFUSED, ASSUMPTIONS, STOPPED ON

**Stopped on:** nothing. STEP 0b passed (the SQL Editor role is on 118's trusted path).

**Assumptions (owner may overrule):**
- A refused group is skipped and listed (RAISE WARNING LG119) and the rest of the backfill proceeds; the
  file aborts only on structural or accounting faults. The brief's "RAISE LG119 listing it" is read as
  a warning per group plus the final list, because the final NOTICE must count refused groups.
- Lightning: one record per token, not per `(org_id, project_id)` as design section 4.2 sketched (D4,
  D6, step A parity; tokens of one project can carry different rubrics).
- A Lightning inbox row attached after a step A send is linked to the token's existing step A line; the
  down file leaves that link in place (it never touches step A).
- Backfilled `created_at` is the backfill time; `broadcast_at` is the original send time.
- Lightning line `estimated_budget` = `projects.budget_range` (step A's fallback); D2 then releases it.
- A linked row's scope name falls back to the row's own `scope_item_name` when the record line's name
  is blank (a row column, not a vendor-copy key); `projectName` never falls back to the copy.
- The Supabase SQL Editor may not display NOTICEs: the test prints the lists; V2-V4 reproduce them.

**Not done, for the owner:**
- `app/api/agency/rfp-closure/route.ts` grouping by `rfp_line_id` (design section 5 lists it for B): it
  would change which rows "close the whole RFP" closes. Scope question, not implemented.
- `resolveResponseScope` and the portal-bid feedback / milestone scope names stay on row columns.
- The vendor- and guest-triggered summary stays on the inbox copy (not agency-gated). After step C
  scrubs the copies it will lose the per-RFP rubric unless step C passes it another way.
- CLAUDE.md names `formatDate()` in `lib/utils.ts`; it does not exist. The panel uses `formatDateTime()`.
- Pre-existing lint error `app/agency/bids/page.tsx:393` (`react-hooks/set-state-in-effect`, from
  `12102bb3`, 2026-07-28) is not on a line this run touched; every other touched file lints clean.
- 119 and its test were not run: no Postgres or credentials here. The test is the parse check.

**Gates:** `pnpm exec tsc --noEmit` exit 0. `pnpm lint` (whole repo, JSON): touched files clean apart
from the pre-existing line above. No markdown-link corruption in `app/`.
