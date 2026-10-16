# RFP client UX (B1, B3, ruling OV-A): run report, 2026-10-15

Branch `feat/rfp-client-ux` from `main` at `bb91c4c`. Code and docs only: nothing pushed, merged, applied or
run against a database. No migration; nothing under `supabase/` was edited. Next free migration: **121**.

## 1. Commits

| sha | subject |
|---|---|
| `9897b76` | docs: state of record 2026-10-15 (120 and the Lightning data fix applied, next free 121; rulings F2-F8; OV-A; B1-B3) |
| `3dd8ec6` | feat: OV-A detection - `lib/rfp-vendor-text-check.ts` and its plain assertion test |
| `2d7bc79` | feat: client UX server side (bids list summaries, PATCH latency and committed value, rewrite route, send-route warnings) |
| `3c8cd5c` | feat: B1 and B3 and OV-A in the UI |
| (this commit) | docs: this report and test script part M |

## 2. STEP 0 answers. No stop condition was hit.

**0.** Rule 0 committed first (`9897b76`): a dated 2026-10-15 section at the end of
`docs/state-of-record-2026-10-12.md` (with a pointer banner at its top, the file's convention), a top banner
in `docs/roadmap-state.md`, and in `LIGAMENT_CONTEXT.md` a 2026-10-15 paragraph, the 120 row set to applied,
and the numbering note set to 121.

**a. Why the second click was not sent, and the 3.9 s.** (main, `components/rfp-record-client-toggle.tsx`)
- `:77` sets `pendingId` on the first click; `:135` renders EVERY checkbox `disabled={pendingId !== null}`;
  `:94` `await mutate()` re-reads the whole list through the browser Supabase client; only then `:98`
  clears `pendingId`. So the control is disabled for the PATCH (about 3.9 s) plus a second round trip.
- `:134` the checkbox is controlled by the list (`checked={record.show_client_to_vendors}`), so during that
  whole window it still shows the OLD value (unticked), only dimmed (`disabled:opacity-50`,
  `components/ui/checkbox.tsx:17`).
- A click on a disabled Radix checkbox (a disabled `<button>`) is dropped by the browser: no event, no
  request, no message. That is exactly "unticking sent NO request".
- Most likely sequence (from the code; not reproduced in a browser here): tick, the box stays unticked and
  dim while the PATCH and the re-read run; the owner clicks again ("untick"), which is dropped; the save
  completes as ON; a reload shows it ticked. If the re-read is slow or stalls, the control stays disabled
  and shows the old value for as long as it takes. The displayed state never came from the PATCH answer.
- Why it "worked on 2026-10-14": the same code; that day's click simply landed after the lock cleared.
- Latency, `app/api/agency/rfp-records/[id]/route.ts` on main: six sequential round trips: `auth.getUser()`
  (`:48`, Auth server), the gate (`:52` -> `lib/entitlements.ts:556` -> `lib/acting-org.ts:165`
  org_members, then `lib/entitlements.ts:576` organizations), `resolveCallerOrgIds` (`:66` ->
  `lib/entitlements.ts:189`, org_members AGAIN), the record read (`:69-74`), the RPC (`:82`). The function
  (`119_rfp_records_backfill.sql:263-310`) is set-based: one record UPDATE and two UPDATEs over linked
  rows (1 inbox row, 1 token here). Avoidable work: the duplicate, sequential membership read. The rest is
  authorization or the write itself; the remainder of 3.9 s (function cold start, RLS evaluation inside
  the UPDATEs, 120's and 118's row guards) cannot be measured from code.

**b. How /agency/bids groups, and the record mapping.** `app/agency/bids/page.tsx` (main) `:722-763`
groups rows by `client_name` (or by vendor org), skipping rows with no client name (`:740`). Inside a group
`buildRankedBlocks` (`lib/bid-shared.ts:207`) clusters rows by scope key `project_id::scope_item_name`.
There was no RFP-level group. The list comes from one route, `GET /api/agency/rfp-responses`
(`app/api/agency/rfp-responses/route.ts`), which already batch-reads every row's `rfp_line_id`
(`readInboxLineIds`, all inbox rows; `readTokenLinksByResponse`, guest bids; main `:240-243`) and the
record views (`readRecordLines`, main `:244-249`, giving `recordId` per line,
`lib/server/rfp-record.ts:440-513`). A row has no record when its inbox row and token carry no
`rfp_line_id`: RFPs sent before records that 119 did not backfill (the one refused row, inbox `04391718`),
or a link that cannot be read. Warnings are computed there, batched, never per row.

**c. Vendor-visible text and where the inputs are known before sending.**
- Wizard: `app/agency/page.tsx` `broadcastRfps` (main `:1230-1355`) posts `masterRfp` (projectName,
  overview, objectives, timeline, ...) and `items` (each scope item's name, description, timeline, and
  `releaseBudget`, `:1280-1286`) and `show_client_to_vendors` (`:1306`). Client name known on the client:
  `masterRfp.client` (`:908`), `clientSelection.clientName` (`:645`), `selectedProject.client`; on the
  server `verifiedProject.client_name` (`app/api/agency/broadcast-rfp/route.ts` main `:186-202`, `:212`).
  Release per line: `releaseBudgetByScope` (`:641`) and the route's `releasedBudget` (`:264-265`). Vendor
  copy built by `buildVendorCopy` (`lib/rfp-vendor-copy.ts:111`): allow-list `VENDOR_COPY_KEYS`
  (`:46-55`); the line's own text is the row's `scope_item_name`, `scope_item_description`, `timeline`.
- Lightning: `app/agency/magic-rfp/page.tsx` `sendLightningRfps` (main `:584-646`) posts
  `scope_item_name: brief.projectName`, `scope_item_description: brief.scopeDescription`,
  `show_client_to_vendors`, `release_budget`. Client: `brief.clientName` (`:320`), `clientSelection`; on the
  server `project.client_name` (`app/api/agency/rfp/magic-link/route.ts` `:188-192`, `:284`, `:317`);
  release `:318`. The record's `projectName` is `project.name` (`:273`).
- Wizard magic-link recipients reuse the magic-link route (`app/agency/page.tsx` main `:1318-1345`).
- Resend paths send no new agency text: `app/api/agency/broadcast-rfp/resend-invite/route.ts` re-sends an
  existing row; `components/agency-rfp-magic-link-invite.tsx:88-97`, `:115-122` send email, name, project
  only (F7, parked, untouched).
- Emails: broadcast emails carry scope names (`broadcast-rfp/route.ts` main `:749-760`); the Lightning email
  carries the project name and the client only when shown (`magic-link/route.ts:514-522`).
- Readers (from `docs/rfp-record-c-report.md` section 4): vendor RFP page renders project, overview,
  objectives, timeline (`app/partner/rfps/[id]/page.tsx:368-452`) and the line; the guest page renders
  `project.name`, the scope name and description, and `client_name` only when released
  (`app/rfp/respond/[token]/page.tsx:972-973`).
- No client alias is stored anywhere: `clients` has `name` only (`077_client_profiles.sql:36-55`);
  `projects.client_id` links a profile (`app/api/agency/client-projects/route.ts:73`).

**d. The agency AI pattern.** `app/api/agency/bids/[responseId]/generate-summary/route.ts`:
`requireAgencyRole()` (session + G1 402, `:18`), `resolveCallerOrgIds` (`:25`), `checkUsageLimit(...,
"ai_analyses")` with `usageLimitResponse` (`:58-59`), the model call through
`lib/ai-bid-analysis.ts:15-44` (`@ai-sdk/anthropic`, `claude-sonnet-4-6`, timeout, never throws),
`incrementAiAnalysis` after success (`:70`), logs carry ids and reasons only.

**e. Unit tests.** No runner in `package.json` (no vitest/jest/tsx). The one existing test is a plain
assertion file run with `npx tsx` (`lib/insurance-limit-parser.test.ts:1-5`). The new test follows it.

**Stop conditions:** S1 no (no database change: the PATCH exists, the list reads existing columns). S2 no
(both send flows know the client name and each line's release before sending, see c). S3 no (the rewrite
reuses the pattern in d, under `/api/agency/`, session client only).

## 3. B1

- **Root cause:** a save lock that disabled the control (`rfp-record-client-toggle.tsx:135` on main) for the
  PATCH plus a list re-read (`:94`), while showing the old value (`:134`); clicks during it were dropped
  silently. The component is no longer used (see section 9 on the file).
- **Fix:** `components/rfp-client-visibility-control.tsx`. `ClientVisibilitySwitch` (`:26`) is a native
  `<button role="switch" aria-checked aria-label="Show client name to vendors">`, never disabled; Enter and
  Space work. `RfpRecordClientVisibility` (`:102`): each click flips the latest intent (`toggle`, `:162`);
  `flush` (`:135`) runs one PATCH at a time and loops until the server's answer equals the latest intent, so
  a rapid double click ends in the last clicked state; "Saving..." shows meanwhile; the displayed value is
  only ever the server's answer; a failure shows an amber `role="alert"` message and the saved value
  (revert). It calls `PATCH /api/agency/rfp-records/[id]` only. The page writes the answer into the list
  cache without a re-read (`app/agency/bids/page.tsx:685`).
- **Latency:** the gate and the membership read now run together
  (`app/api/agency/rfp-records/[id]/route.ts:54-59`): one sequential round trip fewer, authorization
  unchanged (both must pass; 402 and 404 answers as before). The route answers with the value the function
  returned, not the request's (`:94-103` area). Remaining cost: Auth `getUser`, the record read, the RPC;
  not avoidable without changing authorization.

## 4. B3

- Removed: `<RfpRecordClientToggle />` and its import from `/agency/bids` (main `:11`, `:823-824`).
- Now: each RFP inside a group gets a header (`RfpRecordHeader`, `app/agency/bids/page.tsx:438`; rendered at
  `:582`) via `segmentBlocksByRecord` (`lib/bid-shared.ts`, after `buildRankedBlocks`), which gathers
  blocks by record without splitting a ranked block. The header shows type, project name, "Sent <date>",
  the pill (client name on hover) and the read-only chips. A segment with no record has no header. When a
  ranked block spans several Lightning records (one record per vendor), the header lists each with its
  vendors.
- The wizard step 6 (`app/agency/page.tsx:2998`) and Lightning step 1 (`app/agency/magic-rfp/page.tsx:1061`)
  use the same `ClientVisibilitySwitch` with local state (the old checkboxes are gone).
- Data: `GET /api/agency/rfp-responses` adds `rfp_record_id` per row (`route.ts:364`, `:534`) and
  `rfp_records` (`:543`) from `readRecordClientSummaries` (`lib/server/rfp-vendor-text.ts`; called at
  `route.ts:253`).

## 5. OV-A

**Rules** (`lib/rfp-vendor-text-check.ts`, `checkVendorText`):
- Client identity only while hidden: every name given (project client name, linked client profile name,
  the record snapshot), case-insensitive, word boundaries (`(?<![\p{L}\p{N}])...(?![\p{L}\p{N}])`), 0-3
  punctuation or spaces between words ("Coca-Cola" = "Coca Cola" = "CocaCola"), "&" = "and", trailing
  company suffix optional (Inc, LLC, Ltd, Co, Corp, Company, plc, GmbH, AG, SA, BV, NV, Pty, Group,
  Holdings); names under 2 characters ignored.
- Figures: currency symbol or code with a number (`$250,000`, `EUR 40k`, `1.5m EUR`, `900 dollars`), a
  number with k/K/m/M/bn or "thousand/million/billion", percentages (`12%`, `12 percent`, `12 per cent`).
  Not flagged: `35mm`, `500ml`, "Phase 2b", 2K/4K/6K/8K without currency, bare numbers, numbers inside
  words. Shared fields (projectName, overview, each objective, timeline) always; a line's name, description
  and timeline only when the line's budget is not released.
- Each match: `field`, `label`, `reason` (`client_name` | `figure`), `matched`, `excerpt`.

**Where it runs:**
- Send screens, in the browser, debounced 400 ms, no server call: `components/vendor-text-warnings.tsx`,
  mounted above "Broadcast RFPs" (`app/agency/page.tsx:3086`) and "Send Lightning RFPs"
  (`app/agency/magic-rfp/page.tsx:1240`). Accepted text goes back through `applyVendorText`
  (`app/agency/page.tsx:1114`, `app/agency/magic-rfp/page.tsx:589`).
- Send routes, returned as `warnings` in the agency response only, after the send, never a refusal, and a
  failure returns `[]`: `app/api/agency/broadcast-rfp/route.ts:234` (`sendWarnings`, used `:767`, `:861`),
  `app/api/agency/rfp/magic-link/route.ts:673-691`.
- Sent RFPs: `readRecordClientSummaries` computes `names_client` (as if hidden; the page shows it only while
  hidden) and `shows_figures` from each record's allow-listed master text and its lines, batched.

**Rewrite:** `POST /api/agency/rfp-text/rewrite` (`app/api/agency/rfp-text/rewrite/route.ts`):
`requireAgencyRole()` (`:73`, 401/402), zod `.strict()` body with at most 30 fields, 6000 characters each,
20000 in all, unique field ids; project must be the caller's (`readProjectClientNames` on the session client,
filtered by `org_id`, `:89`; 404 otherwise); `checkUsageLimit` (`:94`); one `callAnthropicAnalysis` (`:108`)
with server-derived client names; the answer zod-validated and narrowed to the fields asked;
`incrementAiAnalysis` (`:133`); logs carry counts and reasons only, no text. It writes nothing and sends
nothing to a vendor. The UI renders the suggestion as a word diff from `diffWords` with `<del>`/`<ins>` text
nodes (never HTML), an editable textarea, "Use this text" and "Keep mine".

**Tests:** `lib/rfp-vendor-text-check.test.ts`, about 60 assertions (name variants, boundaries, currency,
k/m/M/bn, percentages, released versus hidden lines, units and resolutions not flagged, excerpts, builders,
diff invariants). Run with `npx tsx lib/rfp-vendor-text-check.test.ts`. **NOT RUN in this session:** `npx`
and `node` were denied by the shell. The expected results were checked by hand against the regexes. Worked
examples (input -> output):

| clientHidden, names | text | scope | result |
|---|---|---|---|
| true, ["Nike"] | "A launch film for Nike's spring" | shared | client_name "Nike" |
| true, ["Coca-Cola"] | "The CocaCola brief" | shared | client_name "CocaCola" |
| true, ["Nike"] | "Nikesh will direct" | shared | none |
| false, ["Nike"] | "A Nike launch" | shared | none |
| any, [] | "Total investment $250,000, fee 12%." | shared | figure "$250,000", figure "12%" |
| any, [] | "Budget around $50k" | line, released | none |
| any, [] | "Budget around $50k" | line, not released | figure "$50k" |
| any, [] | "Shot on 35mm, delivered in 4K" | shared | none |

## 6. SECURITY REVIEW LIST

| Change | file:line | Scope |
|---|---|---|
| PATCH client toggle | `app/api/agency/rfp-records/[id]/route.ts:54-60` | Session; G1 and org scope now in parallel, both checked before any read of the body's target; record read `.in("lead_org_id", callerOrgIds)` and RLS unchanged; 119's invoker function unchanged. Response value from the function result. |
| Bids list summaries | `app/api/agency/rfp-responses/route.ts:253`, `:364`, `:534`, `:543` | Agency route after G1; `readRecordClientSummaries` (`lib/server/rfp-vendor-text.ts`) reads `rfp_records`, `rfp_record_lines`, `projects`, `clients` on the session client, each `.in(<org column>, callerOrgIds)` on top of RLS. Returns the snapshot client name to the agency only. |
| Client names helper | `lib/server/rfp-vendor-text.ts` `readProjectClientNames` | `projects` by id and `org_id`; a `client_id` is believed only for a `clients` row of the caller's orgs. Logs codes only. |
| Rewrite route (new) | `app/api/agency/rfp-text/rewrite/route.ts` | Under `/api/agency/`, `requireAgencyRole()`; not in `publicPaths`; vendor 402, anonymous 401. Project 404 unless the caller's. zod and size caps. Usage checked and counted. Session client only. No text in logs. Writes nothing. |
| AI call | `rewrite/route.ts:108` -> `lib/ai-bid-analysis.ts:27-33` | `@ai-sdk/anthropic` direct (`claude-sonnet-4-6`), 45 s timeout. The shared helper logs `error.message` on failure (existing behaviour). |
| Broadcast warnings | `app/api/agency/broadcast-rfp/route.ts:234`, `:298`, `:767`, `:861` | Computed after the send, in the agency response only; one extra `projects`/`clients` read on the session client, org-filtered. Nothing new reaches inbox rows, emails or vendors. |
| Magic-link warnings | `app/api/agency/rfp/magic-link/route.ts:673-691` | Same; session client (`auth.supabase`) and the caller's org ids. The guest route and vendor routes are untouched. |
| UI | `components/rfp-client-visibility-control.tsx`, `components/vendor-text-warnings.tsx` | Agency pages only. No `dangerouslySetInnerHTML`; excerpts and diffs are text nodes. The client name hover renders only on agency pages. |

No vendor, guest or anonymous route changed. No file under `supabase/` changed. No policy, grant or migration.

## 7. Screens that change and who checks them

| Screen | Change | Account |
|---|---|---|
| `/agency/bids` | Top panel gone; per-RFP header with pill, hover client name, read-only chips | gmarkant@gmail.com (part M RM1-RM9) |
| `/agency` wizard step 6 | Pill instead of checkbox; OV-A box with rewrite above "Broadcast RFPs" | gmarkant@gmail.com (RM10, RM11) |
| `/agency/magic-rfp` | Pill in step 1; OV-A box above "Send Lightning RFPs" | gmarkant@gmail.com (RM12) |
| `/partner/rfps/[id]`, guest `/rfp/respond/[token]` | No change; client appears only while the pill is on | gmarkant@icloud.com (RM13, RM14) |

## 8. Findings for the owner

- **G1. B1 not reproduced in a browser.** The cause in section 3 is from the code. Part M RM3-RM6 checks the fix.
- **G2. Aliases do not exist.** `clients` has no alias column; "stored aliases" cannot be read. The check uses
  the project's client name, the linked profile's name and the record snapshot, plus spelling variants. An
  alias list (for "P&G" for "Procter & Gamble", or a brand that is not the recorded client, as in inbox
  `719f19ea`) would need a column (migration 121 or later, a ruling). Until then such a brand is flagged
  only if the text also shows figures.
- **G3. Lightning: one record per vendor.** A Lightning brief sent to three vendors is three records with
  three pills; the header lists each with its vendors. One pill for "the brief" would need a grouping key the
  records do not have.
- **G4. Unflagged allow-listed text.** Budget category names and notes and business criteria text are
  vendor-visible (allow-listed) but outside OV-A's list; not checked.
- **G5. `formatDate()` does not exist** in `lib/utils.ts` although `CLAUDE.md` names it; `formatDateTime()`
  is used.
- **G6. Pre-existing lint errors** in the three touched pages (react-hooks rules on lines this branch did not
  change: bids `:364`; magic-rfp `:279`, `:296`, `:338`, `:792`; wizard `:269-355`, `:1072`, `:1442`,
  `:1485`, `:1513`). This branch adds none; the new files have none.
- **G7. False positives accepted:** "1.5M impressions", "5m banner", a client named like a common word.
  Warn-only, so the cost is noise.
- **G8. The old component file** `components/rfp-record-client-toggle.tsx` is unused but still in the tree
  (`git rm` was denied in this shell), as is `SHOW_CLIENT_TO_VENDORS_EXISTING_HINT` in
  `lib/rfp-record-copy.ts`. Delete both in a follow-up.

## 9. REFUSED, ASSUMPTIONS, STOPPED ON

- **Stopped on:** nothing. No stop condition hit.
- **Not done / blocked by the shell:** the unit test was not run (`npx`, `node` denied); the old component
  file was not deleted (`git rm` denied). `tsc --noEmit` ran with exit 0 (via `./node_modules/.bin/tsc`);
  `pnpm lint` ran (see G6).
- **Assumptions:** a line's name and timeline count as the line's own text (as its description); the record
  snapshot client name is one of the names; the wizard's line "released" means release on AND an estimate
  present (as the route decides); Lightning's project name is warned about but not offered for rewrite
  (it is edited on the project); the rewrite needs a project (the wizard always has one; without it the box
  says so); the bids-list header orders RFPs by first appearance, so the list order within a group changes
  from pure recency to grouped by RFP; `client_hidden` in the rewrite request comes from the browser (it only
  changes the instruction; names are server-derived).
- **Not touched by ruling:** F7, F8 (parked); record `21f9d17d` (left as found; nothing was run).
