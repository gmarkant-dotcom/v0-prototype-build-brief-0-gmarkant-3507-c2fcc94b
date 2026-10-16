# RFP record step A and migration 118: test script

**For:** branch `feat/rfp-record-a` (step A code) and `supabase/migrations/118_rfp_records.sql`. Run on
a preview or local build of the branch. Parts A to D are step A and 118 (118 is applied and verified,
2026-10-14). **Parts E to G are step B and 119** (`feat/rfp-record-b`; 119 applied and verified
2026-10-14). **Parts I to L are step C and 120** (`feat/rfp-record-c`; 120 authored, NOT applied). Step D
is not built.
**Accounts:** agency `gmarkant@gmail.com` (the paid m a r k a n t lead agency); vendor
`gmarkant@icloud.com` (April Partner Test Agency); a magic-link address with no account
(`gmarkant+rfpa1@gmail.com`, lands in the agency inbox).
**Data:** create a throwaway project `RFP record test - autumn launch` (client `Example Client`,
budget range `$40,000 - $60,000`). Generic examples only.

Each step says what to do and what you must see. Record a step as failed if what you see differs.
SQL steps run in the Supabase SQL Editor as the owner; replace `<project id>` with the test project's id.

---

## Part A. Step A code deployed, 118 NOT applied

The code must behave exactly as `main` does, apart from the two new controls.

- **RA1** Agency: open the RFP wizard (`/agency`) on the test project, generate a master RFP, add two
  scope lines with estimated budgets, outsource both, pick the vendor on line 1 and a magic-link
  recipient (the no-account address, "Send as Magic Link") on line 2. Go to Step 6.
- **RA2** Each line card shows **Release budget to this line's vendors**, unticked, with the note
  "Hidden by default and saved on your RFP record. Vendors still see budgets in this release; this
  choice takes effect for vendors in the next release." A line with no estimated budget shows no
  release control.
- **RA3** Below "Require term disclosures with bids" there is **Show client name to vendors**, unticked,
  with the note "Off by default and saved on your RFP record. Vendors still see the client name in this
  release; this setting takes effect for vendors in the next release." No em dashes anywhere.
- **RA4** Tick release on line 1 only, leave the client toggle off, broadcast. It succeeds as before.
- **RA5** Vendor: `/partner/rfps` shows the new RFP; opening it shows the client name, "Program budget
  (master)" and every line's budget, exactly as on `main` (the toggles do not reach vendors until step C).
- **RA6** The magic-link address receives the invitation email as before; the guest link opens.
- **RA7** Vercel logs: one warning `[rfp-record] rfp_records / rfp_record_lines missing (migration 118
  not applied); the RFP record is skipped` per server instance, not one per request. No errors.
- **RA8** `/agency/magic-rfp`: the settings column shows both controls (client toggle and "Release
  budget to this line's vendors"), both unticked, same notes. Send one invitation to the no-account
  address: it succeeds as before.

## Part B. Apply 118 (owner)

- **RB1** Run `118_rfp_records.sql`'s P1 to P3. Expected as written in the file.
- **RB2** Paste `118_preapply_test.sql`, run once. First line: **"SAFE TO APPLY 118."**; 97 assertions;
  0 FAIL; the only INCONCLUSIVE rows are U1, U2, X1, X2 and C3 (NO SUBJECT, by design; C3 runs and must
  PASS if some user outside the lead agency belongs to two organizations). A1 to A6 must read PASS with
  phase 1 `OK:1` and phase 2 `E:42501` (F1 open before, closed after). The INFO line must read 0 and 0;
  if not, read `docs/rfp-record-a-report.md` section 8g before going on. Anything else: stop.
- **RB3** Dry run (COMMIT at line 924 changed to ROLLBACK), then P2 still answers null, null, null and
  zero rows.
- **RB4** Real run, then V1 to V7 exactly as EXPECTED. 161 public policies.

## Part C. Step A code, 118 applied

### Wizard broadcast

- **RC1** Repeat RA1 to RA4 with a fresh pair of scope lines: line 1 released, line 2 not, client
  toggle ON this time. Broadcast succeeds. RA5 still holds for the vendor (full copy, step C not built).
- **RC2** SQL:
  ```sql
  SELECT id, source, project_id, show_client_to_vendors, client_name_snapshot, total_budget,
         broadcast_at IS NOT NULL AS sent, jsonb_typeof(evaluation_criteria) AS rubric
  FROM public.rfp_records WHERE project_id = '<project id>' ORDER BY created_at DESC LIMIT 3;
  ```
  The newest wizard row: `source` wizard, `show_client_to_vendors` true, `client_name_snapshot`
  Example Client, `sent` true, `rubric` array. Each magic-link recipient of that broadcast has its own
  row with `source` magic_link (D4, D6).
- **RC3** SQL:
  ```sql
  SELECT l.scope_item_name, l.estimated_budget, l.released_budget, l.lead_org_id = r.lead_org_id AS org_ok
  FROM public.rfp_record_lines l JOIN public.rfp_records r ON r.id = l.rfp_id
  WHERE r.id = '<the wizard record id from RC2>' ORDER BY l.sort_order;
  ```
  Line 1: `released_budget` equals `estimated_budget`. Line 2: `released_budget` NULL. `org_ok` true.
- **RC4** SQL: every inbox row of that broadcast carries its line.
  ```sql
  SELECT i.scope_item_name, i.rfp_line_id IS NOT NULL AS linked, i.client_name_released
  FROM public.partner_rfp_inbox i WHERE i.project_id = '<project id>' ORDER BY i.created_at DESC LIMIT 5;
  ```
  `linked` true on the new rows; `client_name_released` NULL (not written before step B).

### Magic link

- **RC5** `/agency/magic-rfp`: send to the vendor's account address (`gmarkant@icloud.com`) with
  release ON. Then SQL:
  ```sql
  SELECT t.vendor_email, t.rfp_line_id IS NOT NULL AS linked, t.attached_inbox_id,
         i.rfp_line_id = t.rfp_line_id AS inbox_same_line, r.broadcast_at IS NOT NULL AS sent,
         l.released_budget, r.output_template_config IS NOT NULL AS template_on_record
  FROM public.rfp_magic_tokens t
  JOIN public.rfp_record_lines l ON l.id = t.rfp_line_id
  JOIN public.rfp_records r ON r.id = l.rfp_id
  LEFT JOIN public.partner_rfp_inbox i ON i.id = t.attached_inbox_id
  WHERE t.project_id = '<project id>' ORDER BY t.created_at DESC LIMIT 3;
  ```
  For the account address: `linked` true, `attached_inbox_id` set, `inbox_same_line` true, `sent`
  true, `released_budget` the budget range, `template_on_record` true when Advanced Options were used.
  For the no-account address (RA8 or RC1): `attached_inbox_id` NULL, `sent` true once the email went.
- **RC6** Resend to the same account address. A NEW record exists (D4); the token's and the inbox
  row's `rfp_line_id` now point at the new record's line; the old record keeps its line and stays sent.

### D5 snapshot and guards (owner SQL, inside BEGIN ... ROLLBACK)

- **RC7**
  ```sql
  BEGIN;
  UPDATE public.rfp_records SET master_rfp = '{}'::jsonb WHERE id = '<a sent record id>';
  ROLLBACK;
  ```
  Refused: LG118 "This RFP has been sent and is a snapshot." DETAIL names `master_rfp`.
- **RC8** Same with `SET show_client_to_vendors = NOT show_client_to_vendors`: succeeds (then ROLLBACK).
- **RC9** Same with `SET broadcast_at = NULL`: refused, LG118.
- **RC10** `INSERT INTO public.rfp_record_lines (rfp_id, scope_item_key, scope_item_name) VALUES
  ('<a sent record id>', 'x', 'x');` inside BEGIN ... ROLLBACK: refused, LG118.

### Vendor-facing

- **RC11** Vendor: `/partner/rfps` and an RFP detail look exactly as in RA5. In the browser network tab,
  `GET /api/partner/rfps` and `GET /api/partner/rfps/<id>` rows now include `rfp_line_id` (an id) and
  `client_name_released` (null). This is the one accepted vendor-visible change.
- **RC12** Vendor: opening the RFP, setting an intent ("Will respond") and submitting a bid all work.
  These are vendor allow-list writes (rulings O1): `viewed_at`, `partner_intent` / `intent_set_at`,
  `status` / `updated_at`.
- **RC12a** Vendor NDA notice: on an RFP that requires an NDA, the vendor's "notify the agency" action
  succeeds (`agency_nda_notified_at`, `updated_at`).
- **RC12b** The invitation claim (ruling O2): agency broadcasts to a manually typed address that has no
  account yet; create the account with that address, open the invitation link. The claim succeeds and
  the RFP appears in `/partner/rfps`. Opening the same link again still lands on the RFP (already
  claimed by your own organization).
- **RC12c** F1 closed (owner SQL, as the vendor, inside BEGIN ... ROLLBACK):
  ```sql
  BEGIN;
  SELECT set_config('request.jwt.claims', json_build_object('sub', '<vendor user id>', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.partner_rfp_inbox SET estimated_budget = 'changed' WHERE id = '<the vendor''s inbox row id>';
  ROLLBACK;
  ```
  Refused: 42501 "A vendor cannot change partner_rfp_inbox.estimated_budget."

### Fail closed (code reading plus one live check)

- **RC13** The live check: none is reachable from the UI without breaking the database on purpose.
  The pre-apply test proves the refusals the routes depend on (R5, R6, V3, U2). The code paths are
  `app/api/agency/broadcast-rfp/route.ts:571` and `app/api/agency/rfp/magic-link/route.ts:302`: on a
  record or line failure the route returns 500 before any inbox row, token or email is written.

## Part D. Down file (only if rolling back)

- **RD1** With records present, run `118_rfp_records_down.sql` as is: refused, LG118, nothing changed.
- **RD2** Forcing it (`SET LOCAL ligament.allow_drop_rfp_records = 'on';` after BEGIN) LOSES EVERY
  RECORD AND EVERY LINK. Part A then holds again.
- **RD3** Rolling back also drops the vendor allow-list with the inbox guard: F1 is open again until 118
  is re-applied.

---

## Part E. Step B code deployed, 119 NOT applied

Step B reads the record only where a row carries `rfp_line_id`. Before 119 that is only rows sent since
step A (e.g. the smoke-test record `21f9d17d-6b6c-471c-8cfb-931d631b6ca4`); every older bid must look
exactly as on `main`.

- **RE1** Agency `/agency/bids`: every bid you knew before still shows its requirements, budget
  categories, rubric (Evaluate tab) and AI summary exactly as before. No errors in the browser console.
- **RE2** A panel **Client name on sent RFPs** sits under the header (closed). It is absent if the
  organization has no sent record. Open it: each sent record shows the project name, its source
  ("RFP wizard" or "Lightning RFP"), "Sent" with date and time, the client name on the record (or "No
  client name on this RFP"), and the checkbox **Show client name to vendors** (unticked), under the note
  "Saved on your RFP record now. Vendors still see the client name in this release; this setting takes
  effect for vendors in the next release." No em dashes.
- **RE3** Tick the box on any record: the message "This setting cannot be changed yet. Nothing was
  changed." appears under that record and the box stays unticked after the list refreshes (the route
  answered 503: 119's function does not exist yet). SQL: the record's `show_client_to_vendors` is still
  false.
- **RE4** Send a fresh wizard RFP (two lines, one vendor) and a Lightning RFP to the vendor's account
  address. Have the vendor bid on both. On `/agency/bids`: requirements and categories show for both;
  Evaluate shows the RFP's own rubric; Generate AI Summary works; award one bid and decline the other.
  The award mail's subject reads "You've been awarded <scope> - <project>"; the decline mail is titled
  for the scope. These now come from the record (both rows are linked by step A).
- **RE5** Vendor `/partner/rfps`: nothing changed for the vendor (step C is not built).
- **RE6** Agency vendor profile (`/agency/pool/<vendor>`), Engagement history: the awarded project from
  RE4 is listed by its project name.
- **RE7** Route checks (browser console on the agency, signed in):
  ```js
  await fetch('/api/agency/rfp-records/not-a-uuid', {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({show_client_to_vendors:true})}).then(r => r.status)          // 404
  await fetch('/api/agency/rfp-records/<a record id>', {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({show_client_to_vendors:'yes'})}).then(r => r.status)     // 400
  await fetch('/api/agency/rfp-records/<a record id>', {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({show_client_to_vendors:true, extra:1})}).then(r => r.status) // 400
  await fetch('/api/agency/rfp-records/00000000-0000-4000-8000-000000000000', {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({show_client_to_vendors:true})}).then(r => r.status) // 404
  ```
  As the vendor (signed in to the partner portal), the same call with a real record id answers 402.

## Part F. Apply 119 (owner)

- **RF1** Run `119_rfp_records_backfill.sql`'s P1 to P4. P1: four non-null values. P2: null, 0. Write
  down P3 and P4: P4 rows with `rubric_variants` 2 or more will be refused; rows with `copies` 1 will be
  built and marked unverified.
- **RF2** Paste `119_preapply_test.sql`, run once. First line: **"SAFE TO APPLY 119."**; 33 assertions;
  0 FAIL; the only INCONCLUSIVE rows are U1 and X1 (NO SUBJECT, by design). Read the **BACKFILL**
  lines: they list every refused group, every unverified single-copy group and every client-name
  correction the real apply will make. Anything else: stop.
- **RF3** Dry run (COMMIT at line 748 changed to ROLLBACK), then P2 still answers null, 0.
- **RF4** Real run. Then V1 to V6: V1 has a `backfill` row with drafts 0, client_shown 0, no_lines 0, and
  the `wizard` / `magic_link` rows unchanged; V2 lists exactly the refused rows from RF2; V3 and V4 match
  RF2's lists; V5 answers f, `{"search_path=public, pg_temp"}`, f, t and 161 policies; V6 answers 0.

## Part G. Step B code, 119 applied

- **RG1** `/agency/bids`: every bid still shows the same requirements, categories and rubric as in RE1
  (now from the backfilled records; the provenance rule guarantees they equal the copies they came
  from). A bid listed as refused in RF2 still shows them from the inbox copy.
- **RG2** The panel now lists the backfilled records too ("Sent" at their original send time), every
  one unticked (D3).
- **RG3** Tick **Show client name to vendors** on one record. The box stays ticked after refresh. SQL:
  ```sql
  SELECT r.show_client_to_vendors, r.client_name_snapshot,
         (SELECT count(*) FROM public.partner_rfp_inbox i JOIN public.rfp_record_lines l ON l.id = i.rfp_line_id
           WHERE l.rfp_id = r.id AND i.client_name_released IS NOT DISTINCT FROM nullif(btrim(r.client_name_snapshot), '')) AS inbox_following,
         (SELECT count(*) FROM public.partner_rfp_inbox i JOIN public.rfp_record_lines l ON l.id = i.rfp_line_id
           WHERE l.rfp_id = r.id) AS inbox_linked
  FROM public.rfp_records r WHERE r.id = '<record id>';
  ```
  `show_client_to_vendors` true; `inbox_following` equals `inbox_linked`. Untick it: the same query
  answers false and every linked row's `client_name_released` is NULL.
- **RG4** Vendor `/partner/rfps`: unchanged by RG3. Vendors do not read `client_name_released` until step
  C, which is what the panel's note says.
- **RG5** Repeat RE4's award and decline on two pre-step-A bids (rows the backfill linked): the mail
  subjects carry the project and scope names as before.

## Part H. 119 down file (only if rolling back)

- **RH1** `119_rfp_records_backfill_down.sql`: unlinks and deletes `source = 'backfill'` records only and
  drops the function. Then 119's P2 answers null, 0; V1's `wizard` and `magic_link` rows are unchanged;
  the toggle route answers 503 again (Part E holds). Lightning inbox rows 119 linked to an existing step
  A line keep that link (the down file's header says why).

---

## Part I. Step C code deployed, 120 NOT applied (`feat/rfp-record-c`)

Step C changes what vendors see straight away: the vendor and guest screens read the client name only
from `client_name_released` and the budget only from the row's released figure, and they never render
the programme budget, other lines or the client from the vendor copy. Old copies still hold those keys
until 120 runs; no vendor screen reads them. Use the test project from Part A (client `Example Client`,
budget range `$40,000 - $60,000`). Accounts: agency **gmarkant@gmail.com**, vendor **gmarkant@icloud.com**.

**Agency (gmarkant@gmail.com)**

- **RI1** Wizard (`/agency`), test project: two scope lines with estimated budgets (`$10,000 - $12,000` and
  `$20,000 - $25,000`). On line 1 tick **Release budget to this line's vendors**; leave line 2 unticked.
  Leave **Show client name to vendors** unticked. The notes now read "Hidden by default. When on, vendors
  on this line see its budget and nothing else of yours." and "Off by default. When on, vendors see this
  RFP's client name." (no "next release"). Send line 1 and line 2 to the vendor.
- **RI2** `/agency/bids`, panel **Client name on sent RFPs**: the note under each record reads "Vendors on
  this RFP see the client name only while this is on. A change reaches them immediately."

**Vendor (gmarkant@icloud.com)**

- **RI3** `/partner/rfps`: both RFPs listed. No client name on either card, and grouping by client shows
  no `Example Client` group.
- **RI4** Open line 1's RFP: the scope section shows **Budget (scope line)** `$10,000 - $12,000` (released).
  The master section shows the project name, overview, objectives and timeline only: **no "Client:",
  no "Program budget (master)", no "All scope items (master RFP)"**. Business criteria required and the
  budget-category bid form still render when the RFP has them.
- **RI5** Open line 2's RFP: **no budget at all** (line 2 was not released). No client, no other line.
- **RI6** Open an RFP sent **before** step C (any older RFP in the list): the same rules hold (no client
  unless the agency turned it on, no programme budget, no other lines), even though its stored copy still
  has them (120 not applied yet). Its scope budget shows only if the row carries one (backfilled RFPs
  released their estimate, D2).
- **RI7** Browser devtools, Network tab, reload `/partner/rfps`: the `/api/partner/rfps` response has no
  `master_rfp_json`, no `estimated_budget`, no `scope_item_id`, no `invite_token`. Open an RFP: the
  `/api/partner/rfps/<id>` response's `inbox.master_rfp_json` holds only projectName, overview, objectives,
  timeline, business_criteria_required, budget_categories, nda_link, response_deadline (whichever exist).
- **RI8** Submit a bid on line 1 (proposal, budget, timeline). It succeeds as before. Nothing about an AI
  summary appears to the vendor.

**Agency again**

- **RI9** `/agency/bids` within a minute of RI8: the new bid's card shows **"Generating summary..."** with a
  skeleton, then the one-line summary appears without opening the bid (the warm-up). Open the bid: the
  AI Analysis section shows the detailed analysis, or **"Generating summary..."** while it finishes; never
  "No analysis available yet" for a submitted bid, never a blank.
- **RI10** Reload `/agency/bids`: the summary is still there and no new generation runs (the route answers
  from storage; the card never flashes "Generating" for a bid that already has one). With several pending
  bids, at most two generate at once (devtools: at most two `generate-summary` requests in flight).
- **RI11** Card menu **Regenerate Summary**: a fresh summary replaces the old one (force).
- **RI12** Tick **Show client name to vendors** on the RI1 record. Vendor reloads `/partner/rfps` and the
  RFP: **`Client: Example Client`** shows on the card and the RFP immediately. Untick: gone on reload.
- **RI13** Lightning RFP (`/agency/magic-rfp`) to the vendor's account address, client hidden, budget not
  released. The invitation email reads "... has invited you to bid on <project>." with **no "for Example
  Client" and no "Budget range"**. The vendor's portal shows the RFP with no client and no budget. The
  vendor's in-app notification "New RFP in your inbox" is unchanged in wording.
- **RI14** Revise the RI8 bid as the vendor (change the budget, resubmit). On `/agency/bids` the card shows
  "Generating summary..." again, then a summary of the revised bid (a revision marks the old one pending).
- **RI15** Guest link: send a Lightning RFP to `gmarkant+rfpc1@gmail.com` with **Show client name to
  vendors** ticked. Open the link signed out: the RFP details show the client name under the project name;
  no budget. Untick on the bids panel, reload the link: the client name is gone. Submit a guest bid: it
  succeeds; the agency card shows "Generating summary..." then the summary.

## Part J. Apply 120 (owner)

- **RJ1** Run `supabase/sql-checks/120-key-inventory.sql`. Section 1: every key marked **REMOVE** on
  `partner_rfp_inbox.master_rfp_json` is one of client, totalBudget, scopeItems, evaluation_criteria,
  referenceMaterials, _magic_token (anything else: read it before going on). Section 2: C1, C2, C3, C6 are
  0; C4 and C5 are 1 (inbox `04391718`). Write down C7, C8, C9 (findings, not changed by 120).
- **RJ2** `120_rfp_vendor_copy_scrub.sql` P1 to P3. P1: non-null, 43, null. Write down P2 and P3.
- **RJ3** Paste `120_preapply_test.sql`, run once. First line: **"SAFE TO APPLY 120."**; 29 assertions; 0
  FAIL; 0 INCONCLUSIVE. Read the **SCRUB** lines (subtract the fixture: one inbox row, one token).
- **RJ4** Dry run (COMMIT at line 540 changed to ROLLBACK): P3 answers exactly as in RJ2.
- **RJ5** Real run. Then V1: 0, 0. V2: two triggers, enabled O, tgtype 23. V3: four functions, as the
  header says. V4: 161. V5: row `04391718`, `rfp_line_id` null, allow-listed keys only.
- **RJ6** Run the file a second time: NOTICE "120 already applied: nothing changed"; P3 unchanged.

## Part K. Step C code, 120 applied

- **RK1** Repeat RI3 to RI7 as the vendor: identical results. What a vendor could read directly with its
  own login is every key of its own rows' copies; the owner checks that no copy anywhere holds a removed
  key:
  ```sql
  SELECT count(*) FROM public.partner_rfp_inbox i, jsonb_object_keys(i.master_rfp_json) k
  WHERE jsonb_typeof(i.master_rfp_json) = 'object' AND NOT (k = ANY (public.rfp_vendor_copy_keys()));
  ```
  Expected 0.
- **RK2** Agency `/agency/bids`: every bid's requirements, categories and rubric (Evaluate tab) show as
  before (they come from the records). Award and decline a bid: the mail subjects carry the project and
  scope names. A guest bid can be awarded (the join is `attached_inbox_id`).
- **RK3** Send a new wizard RFP and a Lightning RFP (to an existing account and to a new address); both
  succeed (the step C writers satisfy 120's guard). The vendor with an account sees the Lightning RFP in
  `/partner/rfps` exactly once, even when `/partner/rfps` and My Bids load together.
- **RK4** Owner SQL, guard check (inside `BEGIN; ... ROLLBACK;`):
  ```sql
  UPDATE public.partner_rfp_inbox SET master_rfp_json = master_rfp_json || '{"client":"x"}' WHERE id = '<any inbox id>';
  ```
  Expected: ERROR 23514 "A vendor copy may not carry client."

## Part L. 120 down file (only if the guard must come off)

- **RL1** `120_rfp_vendor_copy_scrub_down.sql` drops the two triggers and four functions only. 120's V2 and
  V3 return no rows; 161 policies. The scrubbed copies stay scrubbed (the down file cannot restore them;
  the records hold the truth). The step C code keeps writing allow-listed copies.

## Part M. Client UX: the client control on each RFP, OV-A warnings (`feat/rfp-client-ux`, no migration)

Agency browser: **gmarkant@gmail.com**. Vendor browser (a separate profile): **gmarkant@icloud.com**.
Keep DevTools Network open, "Preserve log" on, filter `rfp-records`. Record `21f9d17d` is the owner's test
record: it may be toggled, but leave it as found at the end (currently client visible).

- **RM1 Panel gone.** `/agency/bids`: there is no "Client name on sent RFPs" panel above the search box.
- **RM2 Control on each RFP.** Open a client group. Each RFP sent with a record shows a header line (type,
  project name, "Sent <date>") with a pill "Client hidden" or "Client visible". Hover it: the tooltip reads
  "Client: <name>". RFPs sent before records (unlinked, e.g. inbox `04391718`) show no header and no pill.
- **RM3 Toggle on.** On an RFP showing "Client hidden", click the pill once. Expected: one PATCH
  `/api/agency/rfp-records/<id>` with body `{"show_client_to_vendors":true}`, 200; the pill reads "Saving..."
  while it runs, then "Client visible".
- **RM4 Toggle off.** Click it again. Expected: a second PATCH with `false`, 200; the pill reads "Client
  hidden". (B1: on 2026-10-15 this second click sent no request.)
- **RM5 Reload persists.** Reload the page: the pill shows the last saved state.
- **RM6 Rapid double click.** Click the pill twice quickly. Expected: the first PATCH runs; the second
  click is not lost: after the first answers, a second PATCH is sent with the opposite value, and the pill
  ends in the state of the LAST click (here: back where it started). Then three quick clicks: ends flipped.
  Reload: same state.
- **RM7 Keyboard.** Tab to the pill; Space and Enter each toggle it (one PATCH each). A screen reader
  announces "Show client name to vendors, switch, on/off".
- **RM8 Error and revert.** DevTools, Network, Offline; click the pill. Expected: an amber message "Could
  not save this change. Showing the saved setting." and the pill shows the saved state. Back online.
- **RM9 Sent-RFP warnings (read-only).** Record `21f9d17d` (overview names the client): while its pill is
  "Client hidden", the header shows "Brief text names the client"; with "Client visible" that chip is gone.
  An RFP whose overview holds a programme total or a fee percentage (the record behind inbox `719f19ea`)
  shows "Brief text shows figures" in either state. No button rewrites sent text.
- **RM10 Wizard send step.** `/agency` (RFP wizard), step 6. The client control is the same pill as RM2
  (hover shows the client). In step 2, put the client's name and "$250k" and "12% fee" in the overview;
  back to step 6. Within half a second an amber box above "Broadcast RFPs" lists each passage with its field
  and reason. Toggle the pill to "Client visible": the client-name entries disappear, the figures stay. Put
  "$50k" in a scope item's description: flagged while "Release budget" is off for that line, gone when on.
- **RM11 Rewrite.** Pill back to "Client hidden"; click "Suggest vendor-safe rewrite". One POST
  `/api/agency/rfp-text/rewrite`, 200. Each suggestion shows removed words struck through and added words in
  green as plain text; edit the box, then "Use this text": the overview changes and its warning goes. "Keep
  mine" leaves the text. Broadcast with a warning still showing: the send succeeds (never blocked). The
  broadcast response (Network, `broadcast-rfp`) carries `warnings`.
- **RM12 Lightning.** `/agency/magic-rfp`: the pill appears in step 1; step 2 shows the same warning box
  above "Send Lightning RFPs" for the brief (figures only while "Release budget" is off). The project name
  is warned about but not offered for rewrite. Send succeeds either way; the `magic-link` response carries
  `warnings`.
- **RM13 Vendor sees the client only while on.** As gmarkant@icloud.com, open the RFP from RM3 in
  `/partner/rfps` (or its guest link): the client name appears only while the agency's pill reads "Client
  visible"; flip it to hidden and reload: it is gone. The vendor's page and the guest page never show any
  warning, and their network responses contain no `warnings` or `rfp_records` key.
- **RM14 Gate.** As the vendor, `fetch('/api/agency/rfp-text/rewrite', {method:'POST', body:'{}'})` in the
  console: 402 (or 401 signed out). Never 200.
