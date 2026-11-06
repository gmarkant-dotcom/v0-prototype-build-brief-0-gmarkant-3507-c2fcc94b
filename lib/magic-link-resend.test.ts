/**
 * Plain assertion test for lib/magic-link-resend.ts (F7) - no test framework, run with:
 *   npx -y tsx lib/magic-link-resend.test.ts
 */
import assert from "node:assert/strict"
import {
  isResendRequest,
  MAGIC_LINK_TTL_MS,
  planMagicLinkResend,
  RESEND_WRITABLE_TOKEN_COLUMNS,
  type ResendExistingToken,
} from "./magic-link-resend"

let passed = 0
function check(label: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  passed++
}

const NOW = Date.parse("2026-11-06T12:00:00.000Z")
const DEFAULT_DEADLINE = "2026-11-20T23:59:59.000Z"
const FRESH = "f".repeat(64)
const base: ResendExistingToken = {
  token: "a".repeat(64),
  expires_at: "2026-11-07T12:00:00.000Z",
  response_id: null,
  vendor_name: "Studio North",
  response_deadline: "2026-11-30T23:59:59.000Z",
}
const plan = (existing: Partial<ResendExistingToken>, requestVendorName: string | null = null) =>
  planMagicLinkResend({
    existing: { ...base, ...existing },
    requestVendorName,
    nowMs: NOW,
    mintToken: () => FRESH,
    defaultDeadlineIso: DEFAULT_DEADLINE,
  })

// isResendRequest: an explicit true only
check("resend true", isResendRequest({ resend: true }), true)
check("resend absent", isResendRequest({ vendor_email: "a@b.co" }), false)
check("resend string", isResendRequest({ resend: "true" }), false)
check("resend 1", isResendRequest({ resend: 1 }), false)
check("null body", isResendRequest(null), false)
check("array body", isResendRequest([]), false)

// The patch never names a content column, for every shape of existing token
const CONTENT_COLUMNS = [
  "evaluation_criteria",
  "budget_categories",
  "reference_materials",
  "business_criteria_required",
  "scope_item_id",
  "scope_item_name",
  "scope_item_description",
  "client_name_released",
  "rfp_line_id",
  "close_bidding_at_deadline",
  "require_terms_disclosure",
  "response_id",
  "org_id",
  "project_id",
  "vendor_email",
]
const shapes: Partial<ResendExistingToken>[] = [
  {},
  { expires_at: "2026-11-01T00:00:00.000Z" },
  { response_id: "r1" },
  { response_deadline: null },
  { response_deadline: "2026-11-01T00:00:00.000Z" },
  { response_deadline: undefined },
]
for (const [i, shape] of shapes.entries()) {
  const keys = Object.keys(plan(shape, "New Name").patch)
  check(`shape ${i}: only writable columns`, keys.every((k) => (RESEND_WRITABLE_TOKEN_COLUMNS as readonly string[]).includes(k)), true)
  check(`shape ${i}: no content column`, keys.filter((k) => CONTENT_COLUMNS.includes(k)), [])
}

// Live token: reused, expiry renewed, back to pending, deadline kept
const live = plan({})
check("live: token reused", live.token, base.token)
check("live: no token key in patch", "token" in live.patch, false)
check("live: expiry renewed 72h", live.patch.expires_at, new Date(NOW + MAGIC_LINK_TTL_MS).toISOString())
check("live: status pending", live.patch.status, "pending")
check("live: submitted_at cleared", live.patch.submitted_at, null)
check("live: future deadline kept", "response_deadline" in live.patch, false)
check("live: deadline unchanged", live.responseDeadline, base.response_deadline)
check("live: no deadline change", live.deadlineChanged, false)
check("live: no name in patch when absent", "vendor_name" in live.patch, false)

// Expired token: a new one is minted
const lapsed = plan({ expires_at: "2026-11-05T00:00:00.000Z" })
check("expired: new token", lapsed.token, FRESH)
check("expired: token in patch", lapsed.patch.token, FRESH)
check("expiry exactly now counts as expired", plan({ expires_at: new Date(NOW).toISOString() }).token, FRESH)

// Submitted bid: linkage untouched
const submitted = plan({ response_id: "resp-1" })
check("submitted: no status", "status" in submitted.patch, false)
check("submitted: no submitted_at", "submitted_at" in submitted.patch, false)

// Name: only a non-empty, different name is written
check("same name not written", "vendor_name" in plan({}, "Studio North").patch, false)
check("blank name not written", "vendor_name" in plan({}, "   ").patch, false)
check("new name written", plan({}, " Studio South ").patch.vendor_name, "Studio South")
check("name onto a nameless token", plan({ vendor_name: null }, "Studio South").patch.vendor_name, "Studio South")

// Deadline: replaced only when missing or passed; unknown is never touched
const noDeadline = plan({ response_deadline: null })
check("missing deadline: default", noDeadline.patch.response_deadline, DEFAULT_DEADLINE)
check("missing deadline: changed", noDeadline.deadlineChanged, true)
check("missing deadline: prior null", noDeadline.priorDeadline, null)
const passedDeadline = plan({ response_deadline: "2026-11-01T23:59:59.000Z" })
check("passed deadline: default", passedDeadline.patch.response_deadline, DEFAULT_DEADLINE)
check("passed deadline: prior kept for the milestone", passedDeadline.priorDeadline, "2026-11-01T23:59:59.000Z")
check("garbage deadline: default", plan({ response_deadline: "not a date" }).patch.response_deadline, DEFAULT_DEADLINE)
const unknown = plan({ response_deadline: undefined })
check("unread deadline: not written", "response_deadline" in unknown.patch, false)
check("unread deadline: not known", unknown.priorDeadlineKnown, false)
check("unread deadline: no change", unknown.deadlineChanged, false)

console.log(`magic-link-resend: ${passed} passed`)
