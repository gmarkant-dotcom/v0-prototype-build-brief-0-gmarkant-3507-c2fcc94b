# RFP record step A and migration 118: test script

**For:** branch `feat/rfp-record-a` (step A code) and `supabase/migrations/118_rfp_records.sql`. Run on
a preview or local build of the branch. Steps B, C and D are not built; nothing here tests them.
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
- **RB2** Paste `118_preapply_test.sql`, run once. First line: **"SAFE TO APPLY 118."**; 82 assertions;
  0 FAIL; the only INCONCLUSIVE rows are U1, U2, X1, X2 (NO SUBJECT, by design). Anything else: stop.
- **RB3** Dry run (COMMIT at line 845 changed to ROLLBACK), then P2 still answers null, null, null and
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
  (The link-column guard leaves every vendor write that does not touch a link column alone.)

### Fail closed (code reading plus one live check)

- **RC13** The live check: none is reachable from the UI without breaking the database on purpose.
  The pre-apply test proves the refusals the routes depend on (R5, R6, V3, U2). The code paths are
  `app/api/agency/broadcast-rfp/route.ts:571` and `app/api/agency/rfp/magic-link/route.ts:302`: on a
  record or line failure the route returns 500 before any inbox row, token or email is written.

## Part D. Down file (only if rolling back)

- **RD1** With records present, run `118_rfp_records_down.sql` as is: refused, LG118, nothing changed.
- **RD2** Forcing it (`SET LOCAL ligament.allow_drop_rfp_records = 'on';` after BEGIN) LOSES EVERY
  RECORD AND EVERY LINK. Part A then holds again.
