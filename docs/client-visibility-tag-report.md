# Client visibility tag (CV1) and G4 - report

Branch `feat/client-visibility-tag`, from main at `6e66fca`. Code and docs only: nothing pushed, merged
or applied; no migration; nothing under `supabase/` changed; no new route; no file on the do-not-edit
list changed. Test script: `docs/test-script-client-tag.md`.

## 1. Commits

| Commit | What |
|---|---|
| `5c612ce` | feat: G4 detection (`criteriaAndCategoryVendorTextFields`, `parseCriteriaOrCategoryField`), 19 new assertions, 80 passing |
| `0c56f5f` | feat: CV1 tag on `/agency/bids`, shared save hook, `vendor_count` in the bids summary, G4 in the bids summary and both send pages |
| (this commit) | docs: this report and the test script |

## 2. STEP 0 (read only, before any change)

**a. Where the brief header gets the visibility value.** `rfp_records.show_client_to_vendors`, read in
the batched summary `readRecordClientSummaries` (`lib/server/rfp-vendor-text.ts:119` select, `:199`
`r.show_client_to_vendors === true`), returned as `rfp_records` by `GET /api/agency/rfp-responses`
(`app/api/agency/rfp-responses/route.ts:253`, `:543`), read by the page from SWR
(`app/agency/bids/page.tsx:680`) and passed as `savedVisible` (`:480-485`). It is not an inbox row and
not a hard-coded default. The only "cache" is the SWR entry of that same response, which the page
updates only with the PATCH answer (`app/agency/bids/page.tsx:686`, `mutate(..., { revalidate: false })`),
and the control's own state follows a re-read list unless a save of its own is running
(`hooks/use-rfp-record-client-visibility.ts:64`). A null column reads as hidden (`=== true`), which is
the D3 default. **No display defect found; nothing to fix.** One note on the PATCH route (not a display
defect, not changed): `app/api/agency/rfp-records/[id]/route.ts:102` falls back to the requested value
if the function's result lacks `show_client_to_vendors`; migration 119's function always returns it
(`supabase/migrations/119_preapply_test.sql:677`), so the fallback is unreachable today (finding F3).

**b. Vendor count in the same batch.** It could not before (the summary read records, lines and client
names only). It can now, with no per-row or per-record call: after the lines read, two reads in parallel
over **all** lines at once, `partner_rfp_inbox` by `rfp_line_id` and `rfp_magic_tokens` by `rfp_line_id`,
each filtered to the caller's organizations (`lib/server/rfp-vendor-text.ts:165`, `:216-262`). No
database change, no new route, so **S1 and S2 did not trigger**.

**c. Every use of `components/rfp-client-visibility-control.tsx` (at 6e66fca).**
- `app/agency/bids/page.tsx:11` and `:480` - `RfpRecordClientVisibility` (the switch on each brief header).
- `app/agency/page.tsx:59` and `:2998` (now `:3022`) - `ClientVisibilitySwitch` in the wizard send step.
- `app/agency/magic-rfp/page.tsx:55` and `:1061` (now `:1079`) - `ClientVisibilitySwitch` in the Lightning send step.
No other importer.

**d. Shapes and where text enters detection.**
- `budget_categories`: `BudgetCategory[]` (`lib/budget-categories.ts:21-35`). Free text: `name`, `note`.
  `key`, `origin`, `is_additional_items`, `sort_order` are not text the agency writes for vendors.
- `business_criteria_required`: `BusinessCriteriaRequired` (`lib/business-criteria.ts:107-114`). Free
  text: `notes`, and each `insurance.<key>.minimum` ("$1M/$2M", `lib/business-criteria.ts:15`).
  Designations, priorities and `coi_on_file` are booleans or enums.
- Both keys are vendor-visible (allow-list `lib/rfp-vendor-copy.ts:46-55`).
- Detection callers at 6e66fca: wizard send step `app/agency/page.tsx:3086-3105`
  (`sharedVendorTextFields(masterRfp)` + lines), Lightning send step `app/agency/magic-rfp/page.tsx:1240-1257`
  (project name + the one line), bids summary `lib/server/rfp-vendor-text.ts:159` and `:173`. The two send
  routes (`app/api/agency/broadcast-rfp/route.ts:239-243`, `app/api/agency/rfp/magic-link/route.ts:673-685`)
  also call it; not edited (see section 5).

**Stop conditions:** none met (S1 no database change or route; S2 vendor count batched; S3 no
do-not-edit file needed).

## 3. Tag and menu; shared save logic

- **Tag**: `components/rfp-client-visibility-tag.tsx`, `RfpClientVisibilityTag` (`:27`). A native button
  as the Radix Popover trigger (`:60`), so Enter and Space open it; Radix sets `aria-haspopup="dialog"`,
  `aria-expanded` and `aria-controls`, and Escape closes and returns focus to the tag. Accessible label
  (`:63`): status, client name, "Saving." while a save runs, "Change client visibility". Muted "Client
  hidden" or highlighted "Client shown", client name in `title` (hover). "Saving..." on the tag while a
  save runs (`:77`). Clicks stop at the tag and the menu (`:67`, `:85`; React events bubble through the
  portal). The menu is `bg-popover` (the CLAUDE.md rule for floating surfaces), labelled by its heading.
- **Menu**: exactly one action, the opposite of what the record will be once any running save lands
  (`intended`, hook `:115`): "Show client to vendors" or "Hide client from vendors"; one line
  (`affectedLine`, `:21`): "N vendors on this brief will see the client name." / "will no longer see the
  client name." ("1 vendor"; "Vendors on this brief ..." when the count could not be read); Cancel closes
  with no request; Confirm calls `requestVisibility(show)` (`:100`) and closes. Nothing changes until
  Confirm.
- **Shared hook**: `hooks/use-rfp-record-client-visibility.ts`, `useRfpRecordClientVisibility` (`:41`).
  The B1 logic moved verbatim from `RfpRecordClientVisibility`: PATCH only (`:22`), one save at a time
  and the latest intent sent after an in-flight save (`flush`, `:70`), display from the server's answer,
  error and the saved value on failure; `requestVisibility(target)` (`:98`) sets an explicit target
  instead of flipping. Error shown under the tag as `role="alert"` (tag `:110`).
- **Bids page**: `app/agency/bids/page.tsx:480-486` renders the tag; groups with no record show nothing
  (`RfpRecordHeader` returns null when no summary is known, `:446-447`). OV-A tags unchanged beside it
  (`:463-478`).
- **Switch removed from `/agency/bids` only.** `RfpRecordClientVisibility` had no other user and was
  removed from `components/rfp-client-visibility-control.tsx`; `ClientVisibilitySwitch` stays and the
  wizard (`app/agency/page.tsx:3022`) and Lightning (`app/agency/magic-rfp/page.tsx:1079`) still use it,
  `useState(false)` (`app/agency/page.tsx:647`, `app/agency/magic-rfp/page.tsx:182`).

## 4. Display defect in (a)

None found. See 2a.

## 5. G4

**Rules** (`lib/rfp-vendor-text-check.ts:252`, `criteriaAndCategoryVendorTextFields`), all scope `shared`:
- `budget_categories.<key>.name` and `.note`: client identity while hidden; money and percentages always.
- `business_criteria_required.notes`: the same.
- `business_criteria_required.insurance.<key>.minimum`: **client identity only** (`figuresExpected`,
  `:45`, applied at `:201`). See ASSUMPTION A1.
- Accepts a JSON string, null or malformed values (no fields, no error); a category with no key gets
  `#<index>`. `parseCriteriaOrCategoryField` (`:298`) reads the ids back so a page can apply a rewrite.

**Callers:**
- Wizard send step: `app/agency/page.tsx:3118`; rewrites applied back to `masterRfp.budget_categories`
  and `business_criteria_required` (`:1128-1148`).
- Lightning send step: `app/agency/magic-rfp/page.tsx:1268`, from the page's own `budgetCategories` and
  `businessCriteriaRequired` state; G4 ids are offered for rewrite (`:1262`) and applied (`:597-609`).
- Bids summary: `lib/server/rfp-vendor-text.ts:177`, from the record's own `budget_categories` and
  `business_criteria_required` columns (what the vendor copies carry), falling back to the `master_rfp` keys.

**Test:** `npx -y tsx lib/rfp-vendor-text-check.test.ts` -> `rfp-vendor-text-check: 80 assertions passed`
(61 before, 19 new: field list and order, shared scope, labels, hidden and shown results, insurance
minimum not a figure, the additional-items default note clean, JSON-string storage, null and malformed
input, keyless entry, summary flags, id parsing and round trip).

**Send-route finding (F1, not changed):** the warnings the two send routes return do not include G4
fields. `app/api/agency/broadcast-rfp/route.ts:242` would need
`...criteriaAndCategoryVendorTextFields(pickVendorCopy(masterRfp))` in its `fields`;
`app/api/agency/rfp/magic-link/route.ts:676-684` would need the token's `budget_categories` and
`business_criteria_required`. Low urgency: neither send page reads the returned `warnings` today (the
browser check runs before send and now covers G4).

## 6. Security review list

| Area | File:line | Note |
|---|---|---|
| Vendor count reads | `lib/server/rfp-vendor-text.ts:216-262` | Agency route only (after G1 in `app/api/agency/rfp-responses/route.ts:46`), session client, `.in("lead_org_id"/"org_id", callerOrgIds)` on top of RLS, on line ids already scoped to the caller. Returns a number only; emails and org ids never leave the function. A read error logs codes only (`logReadFailure`) and answers null. |
| G4 in the summary | `lib/server/rfp-vendor-text.ts:119`, `:177` | Two more columns of the caller's own records; only booleans leave the server. |
| Save path | `hooks/use-rfp-record-client-visibility.ts:22` | Unchanged PATCH: `{ show_client_to_vendors: boolean }` only; route does auth, G1, zod, org scope (`app/api/agency/rfp-records/[id]/route.ts`). |
| Client name | `components/rfp-client-visibility-tag.tsx:63`, `title` | Agency page only; text nodes and attributes, no `dangerouslySetInnerHTML`. |
| Rewrite of G4 fields | `components/vendor-text-warnings.tsx` (unchanged) | G4 ids are within the rewrite route's limits (field id at most 120 characters, at most 30 fields); the route's checks are unchanged. |
| Vendor surfaces | none changed | No vendor or guest route or page touched. |

## 7. Screens that change

| Screen | Change | Test account |
|---|---|---|
| `/agency/bids` | Switch replaced by the status tag and confirm menu; G4 can now raise "Brief text names the client" / "Brief text shows figures" | gmarkant@gmail.com |
| `/agency` (wizard send step) | Warnings also cover budget category names and notes and requirements text | gmarkant@gmail.com |
| `/agency/magic-rfp` (send step) | The same | gmarkant@gmail.com |
| `/partner/rfps/[id]` | No code change; the client label follows Confirm | gmarkant@icloud.com |

## 8. Findings for the owner

- **F1** Send-route warnings lack G4 (section 5). Do-not-edit files; owner to schedule.
- **F2** The vendor count counts every inbox row and token linked to the brief's lines, the same set
  migration 119's function rewrites, including closed or declined rows and expired tokens. A vendor is
  its organization, or its email while it has none (an unclaimed invite or an unattached token); an
  email seen on an inbox row counts as that row's vendor. Two people from one vendor invited by
  different emails before either claimed count as two.
- **F3** `app/api/agency/rfp-records/[id]/route.ts:102` falls back to the requested value; unreachable
  with 119's function as written. A defensive change would answer 500 instead. Not changed.
- **F4** Insurance minimums are not flagged as figures (A1). If the owner wants them flagged, delete
  `figuresExpected: true` at `lib/rfp-vendor-text-check.ts:285` and flip the assertion
  "G4: an insurance minimum is a figure by design" in the test.
- **F5** Lint: no new errors in touched files. The touched pages carry pre-existing
  `react-hooks/*` errors in code this branch did not change (`app/agency/bids/page.tsx:364`,
  `app/agency/magic-rfp/page.tsx:284`, `:343`, `:810`, `app/agency/page.tsx:274` and others).

## 9. Refused, assumptions, stopped on

- **Refused:** nothing.
- **A1** Insurance minimums: the brief says "every free-text part ... with the same rules". A minimum
  such as "$1M/$2M" is the requirement itself; flagging it would mark every brief with an insurance
  minimum as "shows figures", and "Suggest vendor-safe rewrite" would offer to delete the requirement.
  I applied the client rule only. Owner to confirm (F4 has the one-line flip).
- **A2** "N vendors" counts distinct vendors, not inbox rows or tokens (F2).
- **A3** `RfpRecordClientVisibility` was removed rather than kept with no user; the hook is the shared logic.
- **A4** The tag's menu applies to the record as it will be after any running save; opening it during
  a save offers the opposite of the save in flight.
- **Stopped on:** nothing. Not run: the app itself (no browser run in this session); `pnpm build`.
