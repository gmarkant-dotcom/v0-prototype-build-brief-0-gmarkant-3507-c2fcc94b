# Small fixes 2026-11-06: report

Branch `fix/small-fixes-2026-11-06`, cut from main at 51285b6, which contains 7456519. Code and docs only.
No migration, nothing under `supabase/` changed, nothing pushed, merged or run against a database. One
commit per fix, plus this report and the test script (`docs/test-script-small-fixes.md`).

| Fix | Commit | Files |
|-----|--------|-------|
| 1 Un-shortlist returns to submitted | eb701ec | `lib/bid-status.ts`, `lib/bid-status.test.ts` (new), `components/bid-detail-sheet.tsx`, `components/bid-compare-view.tsx` |
| 2 Header tag wrap on /agency/bids | 5aa314d | `app/agency/bids/page.tsx` |
| 3 Send-route warnings carry G4 (F1) | 5babf38 | `app/api/agency/broadcast-rfp/route.ts`, `app/api/agency/rfp/magic-link/route.ts`, `lib/rfp-vendor-text-check.test.ts` |
| 4 Invite list stops selecting `*` (G5 / H5) | cc531f0 | `app/api/agency/rfp/magic-link/route.ts` |

## 1. Un-shortlisting a bid returns it to submitted (ruling pending owner confirmation)

**Before.** Both agency shortlist toggles sent `status: "under_review"` when the bid was already
shortlisted. The vendor sees `under_review` as "Changes Requested" (`lib/bid-status.ts:59-60`,
`lib/bid-shared.ts:110`), so taking a bid off the shortlist told the vendor to change it.

**Now.**
- `lib/bid-status.ts:41` `shortlistToggleStatus(current)`: `"shortlisted"` gives `"submitted"`, anything
  else gives `"shortlisted"`. Its return type is `"submitted" | "shortlisted"`, so `under_review` cannot
  come out of it.
- `components/bid-detail-sheet.tsx:360` (Shortlist / Remove from shortlist button) and
  `components/bid-compare-view.tsx:383` (compare view Shortlist button) both call it.

**Every un-shortlist path found.** Those two buttons are the only places the agency moves a bid out of
`shortlisted` on purpose. `app/api/agency/rfp-responses/[id]/route.ts` has no un-shortlist logic of its
own: it takes `body.status` (`:281-283`), which the allow-list already accepts as `"submitted"` (`:218`).
It needed no change.

**Request changes stays under_review.** Unchanged: the Save Feedback button sends `under_review` for a
submitted bid (`components/bid-detail-sheet.tsx:813`), and the route moves a submitted bid with new
feedback to `under_review` on its own (`app/api/agency/rfp-responses/[id]/route.ts:276-283`).

**shortlisted_at.** Unchanged and consistent. It is stamped only on the transition into shortlisted
(`route.ts:318`, `:361-363`) and is never cleared on the way out, because it records that the shortlist
happened; the vendor dashboard's "Your bid ... was shortlisted" activity item reads it
(`app/api/partner/dashboard/route.ts:542-549`). The inbox row maps `submitted` and `under_review` to the
same `bid_submitted` (`lib/bid-status.ts:26-32`), so the inbox sync is unchanged too.

**Vendor side after an un-shortlist.** `submitted` is the vendor's own cycle in the S1 rule
(`lib/vendor-bid-status.ts`): the vendor can edit and resubmit, as before it was shortlisted. Migration 121
does not touch agency writes.

**Tests.** `lib/bid-status.test.ts`, 9 assertions: un-shortlist gives submitted, the vendor label after it
is "Submitted", six other statuses (including empty) shortlist, and `under_review` still reads "Changes
Requested" to the vendor.

## 2. Client tag stays on the header line at /agency/bids

**Before.** The RFP header row (`app/agency/bids/page.tsx`, `RfpRecordHeader`) was
`flex items-center justify-between gap-3 flex-wrap`. The left group's flex basis is its full one-line
width, so once the warning tags ("Brief text names the client", "Brief text shows figures") made it wider
than the row, the outer row wrapped and pushed the client tag onto its own line.

**Now.**
- `app/agency/bids/page.tsx:459` outer row `flex items-start justify-between gap-3`: no outer wrap, so the
  client tag always shares the first line, at the right.
- `:460` left group gains `flex-1` (it already had `min-w-0` and `flex-wrap`): it takes the remaining width
  and wraps its own items, so the warning tags drop beneath the title when space is short.
- `:488` `className="shrink-0"` on `RfpClientVisibilityTag` (the component already merges `className`,
  `components/rfp-client-visibility-tag.tsx:58`), so the tag never squeezes.

**Narrow widths, by the layout rules (not seen in a browser; see Assumptions).** The project name keeps
`truncate`; as a flex item with `overflow: hidden` its minimum width is 0, so it shortens with an
ellipsis instead of pushing the row. A warning tag too wide for the left column on its own line shrinks
to its longest word and its text wraps inside the pill; it never overflows under the client tag. The tag's
own error line (`max-w-[260px]`) is inside the shrink-0 tag and sits under it, right-aligned, as before.

## 3. Send-route warnings include budget categories and requirements notes (finding F1)

**Before.** Finding F1 (`docs/client-visibility-tag-report.md:114-119`): the OV-A warnings the two send
routes return covered the project name, overview, objectives, timeline and the lines, but not the G4
fields the browser check covers (budget category names and notes, requirements notes, insurance minimums
under the client rule only).

**Now.** Both routes add `criteriaAndCategoryVendorTextFields()` from `lib/rfp-vendor-text-check.ts`, the
same builder the browser checks use (`app/agency/page.tsx:3135`, `app/agency/magic-rfp/page.tsx:1268`).
- `app/api/agency/broadcast-rfp/route.ts:245-255`: from `pickVendorCopy(masterRfp)`, the normalized
  vendor copy every inbox row carries (`budget_categories` and `business_criteria_required` are normalized
  into `masterRfp` at `:177-185`, before the check runs).
- `app/api/agency/rfp/magic-link/route.ts:710-716`: from `budgetCategories` and
  `businessCriteriaRequired`, the normalized values the token row is written with (`:160-162`, `:422`,
  `:431`).

**Warnings only.** Both sit inside the existing try/catch that returns no warnings on failure
(`broadcast-rfp/route.ts:240-260`, `magic-link/route.ts:702-726`); neither route refuses a send on a
warning, and the warnings go only in the agency's own response.

**Tests.** `lib/rfp-vendor-text-check.test.ts:230-245`, 2 new assertions (80 before, 82 now): the vendor
copy keeps every G4 field, and its G4 warnings equal the browser check's on the raw master.

## 4. Invite list selects explicit columns (G5 / H5)

**Before.** `GET /api/agency/rfp/magic-link?project_id=` selected `*` from `rfp_magic_tokens`, returning
every column to the agency, the bearer `token` included (`docs/lightning-guest-fixes-report.md:277`,
`docs/invite-blanking-followups-report.md:182`).

**Now.** `app/api/agency/rfp/magic-link/route.ts:974`
`.select("id, vendor_email, vendor_name, status, created_at, expires_at")`, plus `is_existing_partner`
added after (`:991-994`, unchanged). These are exactly the fields of `MagicTokenRow` in the invite card
(`components/agency-rfp-magic-link-invite.tsx:19-27`), its only consumer (`:54-58`; no other code reads
`data.invites`). **The token is out:** the card never needs it, because Resend posts the email and project
id with `resend: true` (`components/agency-rfp-magic-link-invite.tsx:150-155`) and the server looks the
token up itself. The `check_email` branch already selected `id, expires_at` only (`route.ts:948`).

## Quality gate

- `pnpm exec tsc --noEmit`: exit 0 (no output) after every commit.
- `npx -y tsx lib/rfp-vendor-text-check.test.ts`: 82 assertions passed.
- `npx -y tsx lib/vendor-bid-status.test.ts`: 34 assertions passed.
- `npx -y tsx lib/bid-status.test.ts` (new): 9 assertions passed.
- Lint (`pnpm lint --format json`, filtered to touched files): 0 errors and 0 warnings in
  `lib/bid-status.ts`, `lib/bid-status.test.ts`, `lib/rfp-vendor-text-check.test.ts`, both send routes.
  Five `react-hooks/set-state-in-effect` errors remain in touched files, all on lines this branch did not
  write (`git blame`): `app/agency/bids/page.tsx:364` (12102bb3), `components/bid-compare-view.tsx:164`
  and `:252` (481181d2), `:276` (ac1ba9f0), `components/bid-detail-sheet.tsx:246` (24fe3a34). No new
  lint errors. Full `pnpm lint` exits 1 on these and other pre-existing files.
- Do-not-edit list: `git diff --name-only 51285b6..HEAD` lists the eight code files above and these two
  docs only. Nothing under `supabase/`, `lib/server/budget/`, `app/api/agency/budget/`,
  `components/budgeting/`, `app/agency/budgeting/`, and none of the six named docs.

## Security review list

- `app/api/agency/rfp/magic-link/route.ts:974`: the invite list no longer returns the bearer token or any
  other token column. Auth, agency gate and `.in("org_id", callerOrgIds)` scope unchanged.
- `app/api/agency/rfp/magic-link/route.ts:710-716` and `app/api/agency/broadcast-rfp/route.ts:245-255`:
  more text goes through the check, and the matches (with excerpts) go back only in the agency's own
  response, as before. The excerpts are the agency's own text. No vendor or guest surface receives them.
- `components/bid-detail-sheet.tsx:360`, `components/bid-compare-view.tsx:383`: the client now sends
  `submitted` on un-shortlist. The route already accepted it, gates on the transition, and never trusts the
  client beyond the allow-list (`app/api/agency/rfp-responses/[id]/route.ts:218`, `:284-289`). Moving
  into `submitted` crosses no capability gate (`:313-341`), the same as moving into `under_review` did.

## Findings for the owner

- **O1. Cancel Meeting Request has the same defect.** `components/bid-detail-sheet.tsx:332` sends
  `under_review` when the agency cancels a meeting request, so the vendor is told "Changes Requested".
  Not changed: the brief named un-shortlisting only. If the ruling extends to it, the same one-line change
  applies (a `meetingToggleStatus`, or send `submitted`).
- **O2. Re-shortlisting re-stamps shortlisted_at.** The comment at
  `app/api/agency/rfp-responses/[id]/route.ts:358-360` says no timestamp is overwritten by a later
  transition away and back, but `isShortlisting` (`:318`) is true on every entry into shortlisted, so
  shortlist, un-shortlist, shortlist stamps the second time (same for `meeting_requested_at`). The vendor
  dashboard then shows the latest shortlist only. Behaviour or comment should change; neither was.
- **O3. Stale pages.** A bids page loaded before deploy still sends `under_review` on un-shortlist until it
  is reloaded. The route was not taught to translate, because it cannot tell an un-shortlist from a
  deliberate move to `under_review`.
- **O4. Fix 3 shows only in the response.** Neither send page reads the returned `warnings` (F1 noted
  this); the browser check runs before send. The test script checks the response body in DevTools.
- **O5. The send POST still returns the token** (`app/api/agency/rfp/magic-link/route.ts:729`, `:912`).
  It is used: the Lightning page builds its copy-links list from it (`app/agency/magic-rfp/page.tsx:659`,
  `:722-723`). Agency-only, the caller's own send. Out of scope; noted.
- **O6. The resend path returns `warnings: []`** (`route.ts:912`). A resend keeps the stored content, so
  nothing new was checked. Unchanged.

## Refused, assumptions, stopped on

- **Refused:** nothing.
- **Assumption A1:** the un-shortlist ruling is built as recommended, pending owner confirmation.
- **Assumption A2:** fix 2 was not seen in a browser. The bids page needs a signed-in agency with sent
  records; no dev server or database was run. The narrow-width behaviour above is from the flexbox rules;
  test script step 2 checks it at 1280, 768 and 375 px.
- **Assumption A3:** the magic-link route checks the normalized values it writes to the token, not the raw
  body; for free text they are the same strings.
- **Stopped on:** nothing.
