# Bid status follow-ups (O1, O2) - 2026-11-06

Branch `fix/bid-status-followups`, from main at `49da414`. Two fixes from
`docs/small-fixes-2026-11-06-report.md` (findings O1 and O2). No migration; nothing under `supabase/`
changed. Not pushed, not merged.

## Commits

| Commit | Fix |
|--------|-----|
| `810118e` | O1: Cancel Meeting Request returns the bid to shortlisted or submitted, never under_review |
| `dc400a3` | O2: shortlisted_at and meeting_requested_at are stamped only while null (first stamp wins) |

## Fix 1 (O1): Cancel Meeting Request

**Ruling status:** recommended in the brief, still pending owner confirmation. Built as recommended.

**Before:** `components/bid-detail-sheet.tsx:332` sent `under_review` when the agency cancelled a
meeting request, so the vendor saw "Changes Requested" although no changes were asked for.

**After:**

- `lib/bid-status.ts:52` `meetingCancelStatus(shortlistedAt)` returns `"shortlisted"` when
  `shortlisted_at` is set and `"submitted"` otherwise. Its return type cannot be `under_review`.
  It sits next to `shortlistToggleStatus` (`lib/bid-status.ts:41`).
- `components/bid-detail-sheet.tsx:332-334` calls it with `row.shortlisted_at`.
- `lib/bid-shared.ts:50` adds `shortlisted_at?: string | null` to `BidRow`.
- `app/api/agency/rfp-responses/route.ts:96` adds `shortlisted_at` to the bids list SELECT, so the
  sheet has the value. After any PATCH the sheet merges the route's `select("*")` row, which already
  carried it.
- "Request changes" is unchanged: `components/bid-detail-sheet.tsx:815` still sends `under_review`
  for a submitted bid, and the route's auto-transition (`app/api/agency/rfp-responses/[id]/route.ts:276-283`)
  is untouched.
- Other cancel paths: none. `components/bid-compare-view.tsx` has no meeting action (only the
  shortlist toggle at `:383` and decline/award). A repo-wide search for writes of `meeting_requested`
  found only `bid-detail-sheet.tsx`.

**Assertions:** `lib/bid-status.test.ts:24-31`, six new (shortlisted timestamp, null, undefined, empty
string, and the vendor label for both outcomes). File total 15 (was 9).

## Fix 2 (O2): first stamp wins

**Before:** `app/api/agency/rfp-responses/[id]/route.ts:361-366` stamped `shortlisted_at` and
`meeting_requested_at` on every entry into the status, so shortlist, un-shortlist, shortlist
overwrote the first date. The comment above it said no timestamp is ever overwritten.

**After:**

- `app/api/agency/rfp-responses/[id]/route.ts:255` loads `shortlisted_at, meeting_requested_at` with
  the existing row (same `.eq("id", id).in("lead_org_id", callerOrgIds)` scope).
- `:364` stamps `shortlisted_at` only when `isShortlisting && !existing.shortlisted_at`.
- `:367` stamps `meeting_requested_at` only when `isRequestingMeeting && !existing.meeting_requested_at`.
- Comment `:358-363` now states the first-stamp-wins rule; milestone comment `:862-866` updated to say a
  second entry still records a milestone but does not re-stamp.
- **Authorization unchanged.** `isShortlisting` / `isRequestingMeeting` (`:318-320`) are not changed,
  so the capability gates (`:330-335`) and the milestone emitter (`:872`) fire exactly as before.
  `declined_at` (`:371`) is not in scope and still stamps on each entry into declined.

## Gate

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | clean (no output) after each commit |
| `npx -y tsx lib/bid-status.test.ts` | 15 assertions passed |
| `npx -y tsx lib/vendor-bid-status.test.ts` | 34 assertions passed |
| `npx -y tsx lib/rfp-vendor-text-check.test.ts` | 82 assertions passed |
| `pnpm lint` (JSON, filtered to touched files) | one error, pre-existing and untouched: `components/bid-detail-sheet.tsx:246` `react-hooks/set-state-in-effect`. None in the other five files |
| Do-not-edit files | none changed (`git diff --name-only 49da414..HEAD` lists only the six files above) |

## Security review list

- `app/api/agency/rfp-responses/route.ts:96` - one more column (`shortlisted_at`) returned to the
  agency, on rows already scoped to `.in("lead_org_id", callerOrgIds)`. It is the agency's own action
  timestamp, and the vendor already reads it (`app/api/partner/dashboard/route.ts:171`).
- `app/api/agency/rfp-responses/[id]/route.ts:255` - two more columns read from the agency's own row,
  same scope; neither is returned beyond what `select("*")` at `:816` already returned.
- `app/api/agency/rfp-responses/[id]/route.ts:364`, `:367` - narrows when two columns are written;
  writes nothing new.
- `components/bid-detail-sheet.tsx:332-334` - the client picks `shortlisted` or `submitted`. The
  server still validates against `ALLOWED_STATUS` (`:218`), refuses moves out of awarded (`:287`),
  and checks `bid.shortlist` when the cancel lands on shortlisted (`:330`). An agency could already
  set either status directly, so no new capability is reachable.

## Findings for the owner

1. **"Ever shortlisted", not "shortlisted just before".** `meetingCancelStatus` keys on
   `shortlisted_at`, which records that a shortlist happened at any point. A bid shortlisted, then
   un-shortlisted, then given a meeting request returns to shortlisted on cancel. Returning to the
   exact prior status would need the prior status stored (a column, so a migration); not done.
2. **Cancel to shortlisted records a `bid.shortlist` milestone.** meeting_requested to shortlisted
   is a transition into shortlisted, so `isShortlisting` is true: the capability check runs and a
   vendor-visible `bid.shortlist` milestone is written again (`[id]/route.ts:872-899`). With fix 2 the
   dashboard date does not move, but the milestone feed gains a second "shortlisted" entry. Same is
   true of re-shortlisting after un-shortlist, before and after this branch. Suppressing it would
   need a "was this ever shortlisted" check on the milestone; left as is pending a ruling.
3. **Stale pages.** A bids page loaded before deploy still sends `under_review` on cancel until
   reloaded (same shape as O3).
4. **Existing rows are not repaired.** Bids already moved to under_review by an earlier cancel stay
   there, and timestamps already re-stamped keep the later date. Repair would be a data write; not
   done.
5. **The dashboard keeps history, not state.** `app/api/partner/dashboard/route.ts:542-557` shows
   "was shortlisted" / "a meeting was requested" for any bid with the timestamp, including one later
   un-shortlisted or cancelled. Unchanged and pre-existing; fix 2 makes the date the original one.
6. **`declined_at`** still re-stamps on decline, undo decline, decline. Out of scope (the brief named
   two columns); same one-line guard would apply.
