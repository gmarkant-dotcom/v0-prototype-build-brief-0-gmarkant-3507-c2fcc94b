/**
 * Plain assertion test for shortlistToggleStatus() in lib/bid-status.ts - no test framework, run with:
 *   npx tsx lib/bid-status.test.ts
 */
import assert from "node:assert/strict"
import { getBidStatusLabel, shortlistToggleStatus } from "./bid-status"

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

// The label the vendor would have seen under the old rule, kept here so the reason is on record.
check("under_review reads as Changes Requested to the vendor", getBidStatusLabel("under_review", "partner"), "Changes Requested")

console.log(`bid-status: ${passed} assertions passed`)
