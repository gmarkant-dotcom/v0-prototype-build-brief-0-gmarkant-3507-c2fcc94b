# RFP record step A and migration 118: test script

**For:** branch `feat/rfp-record-a` (step A code) and `supabase/migrations/118_rfp_records.sql`. Run on
a preview or local build of the branch. Parts A to D are step A and 118 (118 is applied and verified,
2026-10-14). **Parts E to G are step B and 119** (`feat/rfp-record-b`). Steps C and D are not built.
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
