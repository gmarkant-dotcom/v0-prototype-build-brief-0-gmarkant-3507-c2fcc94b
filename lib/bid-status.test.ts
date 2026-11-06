/**
 * Plain assertion test for shortlistToggleStatus() and meetingCancelStatus() in lib/bid-status.ts - no test framework, run with:
 *   npx tsx lib/bid-status.test.ts
 */
import assert from "node:assert/strict"
import { getBidStatusLabel, meetingCancelStatus, shortlistToggleStatus } from "./bid-status"

let passed = 0
function check(label: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  passed++
}

// Un-shortlisting returns the bid to submitted, never to under_review.
check("un-shortlist goes to submitted", shortlistToggleStatus("shortlisted"), "submitted")
// (Its return type, "submitted" | "shortlisted", already rules out under_review at compile time.)
check("vendor sees Submitted after un-shortlist", getBidStatusLabel(shortlistToggleStatus("shortlisted"), "partner"), "Submitted")

// Every other status shortlists.
for (const s of ["submitted", "under_review", "meeting_requested", "declined", "draft", ""]) {
  check(`${s || "empty"} shortlists`, shortlistToggleStatus(s), "shortlisted")
}

// Cancel Meeting Request returns to shortlisted when the bid had been shortlisted, else submitted.
check("cancel meeting, previously shortlisted, goes to shortlisted", meetingCancelStatus("2026-11-06T10:00:00.000Z"), "shortlisted")
check("cancel meeting, never shortlisted (null), goes to submitted", meetingCancelStatus(null), "submitted")
check("cancel meeting, never shortlisted (column absent), goes to submitted", meetingCancelStatus(undefined), "submitted")
check("cancel meeting, empty timestamp, goes to submitted", meetingCancelStatus(""), "submitted")
// (Its return type, "submitted" | "shortlisted", rules out under_review at compile time too.)
check("vendor sees Shortlisted after cancel on a shortlisted bid", getBidStatusLabel(meetingCancelStatus("2026-11-06T10:00:00.000Z"), "partner"), "Shortlisted")
check("vendor sees Submitted after cancel on a bid never shortlisted", getBidStatusLabel(meetingCancelStatus(null), "partner"), "Submitted")

// The label the vendor would have seen under the old rule, kept here so the reason is on record.
check("under_review reads as Changes Requested to the vendor", getBidStatusLabel("under_review", "partner"), "Changes Requested")

console.log(`bid-status: ${passed} assertions passed`)
