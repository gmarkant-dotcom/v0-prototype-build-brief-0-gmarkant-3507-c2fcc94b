/**
 * Plain assertion test for lib/vendor-bid-status.ts (ruling S1 = B + C) - no test framework, run with:
 *   npx tsx lib/vendor-bid-status.test.ts
 */
import assert from "node:assert/strict"
import { resolveVendorBidStatus } from "./vendor-bid-status"

let passed = 0
function check(label: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  passed++
}

// First save: no row yet.
check("new row, autosave", resolveVendorBidStatus(null, null), { ok: true, status: "draft", kept: false })
check("new row, draft", resolveVendorBidStatus(null, "draft"), { ok: true, status: "draft", kept: false })
check("new row, submit", resolveVendorBidStatus(null, "submitted"), { ok: true, status: "submitted", kept: false })

// draft and submitted: the vendor's own cycle.
check("draft, autosave keeps draft", resolveVendorBidStatus("draft", null), { ok: true, status: "draft", kept: true })
check("draft, submit", resolveVendorBidStatus("draft", "submitted"), { ok: true, status: "submitted", kept: false })
check("submitted, autosave keeps submitted", resolveVendorBidStatus("submitted", null), { ok: true, status: "submitted", kept: true })
check("submitted, explicit draft", resolveVendorBidStatus("submitted", "draft"), { ok: true, status: "draft", kept: false })
check("submitted, resubmit", resolveVendorBidStatus("submitted", "submitted"), { ok: true, status: "submitted", kept: true })

// under_review ("Changes Requested"): only a resubmission moves it.
check("changes requested, autosave kept", resolveVendorBidStatus("under_review", null), { ok: true, status: "under_review", kept: true })
check("changes requested, draft kept", resolveVendorBidStatus("under_review", "draft"), { ok: true, status: "under_review", kept: true })
check("changes requested, resubmit", resolveVendorBidStatus("under_review", "submitted"), { ok: true, status: "submitted", kept: false })

// shortlisted and meeting_requested: the edit is accepted, the status kept.
for (const s of ["shortlisted", "meeting_requested"]) {
  check(`${s}, autosave kept`, resolveVendorBidStatus(s, null), { ok: true, status: s, kept: true })
  check(`${s}, draft kept`, resolveVendorBidStatus(s, "draft"), { ok: true, status: s, kept: true })
  check(`${s}, resubmit kept`, resolveVendorBidStatus(s, "submitted"), { ok: true, status: s, kept: true })
}

// Final and unknown: refused.
for (const s of ["awarded", "declined", "closed", "not_selected", "something_new"]) {
  for (const r of [null, "draft", "submitted"] as const) {
    const d = resolveVendorBidStatus(s, r)
    check(`${s}, ${r ?? "autosave"} refused`, d.ok, false)
  }
}
check("awarded message", resolveVendorBidStatus("awarded", null), {
  ok: false,
  current: "awarded",
  message: "This bid has been awarded, so it can no longer be edited.",
})
check("declined message", resolveVendorBidStatus("declined", "submitted"), {
  ok: false,
  current: "declined",
  message: "This bid has been declined, so it can no longer be edited.",
})

console.log(`vendor-bid-status: ${passed} assertions passed`)
