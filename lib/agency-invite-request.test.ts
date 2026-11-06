/**
 * Plain assertion test for lib/agency-invite-request.ts (G1, G2, G3) - no test framework, run with:
 *   npx -y tsx lib/agency-invite-request.test.ts
 */
import assert from "node:assert/strict"
import {
  buildCardInviteRequest,
  buildWizardGuestInviteBody,
  describeInviteOutcome,
  hasExistingInvitation,
} from "./agency-invite-request"
import { isResendRequest } from "./magic-link-resend"
import { VENDOR_COPY_KEYS } from "./rfp-vendor-copy"

let passed = 0
function check(label: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  passed++
}

// ---------------------------------------------------------------------------------------------
// hasExistingInvitation
// ---------------------------------------------------------------------------------------------
check("null check", hasExistingInvitation(null), false)
check("undefined check", hasExistingInvitation(undefined), false)
check("new vendor", hasExistingInvitation({ is_existing_partner: false, has_pending_invite: false, has_expired_invite: false }), false)
check("pool vendor, no invite", hasExistingInvitation({ is_existing_partner: true, has_pending_invite: false, has_expired_invite: false }), false)
check("pending invite", hasExistingInvitation({ has_pending_invite: true, has_expired_invite: false }), true)
check("expired invite", hasExistingInvitation({ has_pending_invite: false, has_expired_invite: true }), true)

// ---------------------------------------------------------------------------------------------
// G1: the card form
// ---------------------------------------------------------------------------------------------
const form = { email: "  Vendor@Studio.com ", name: " Studio North ", projectId: "p-1", requireTermsDisclosure: false }

// A first invite: exactly the body the card sent before this change.
const first = buildCardInviteRequest({ ...form, check: { is_existing_partner: false, has_pending_invite: false, has_expired_invite: false } })
check("first: mode", first.mode, "first")
check("first: body unchanged", first.body, {
  vendor_email: "Vendor@Studio.com",
  vendor_name: "Studio North",
  project_id: "p-1",
  require_terms_disclosure: false,
})
check("first: not a resend", isResendRequest(first.body), false)
check("first: JSON keys", Object.keys(JSON.parse(JSON.stringify(first.body))).sort(), [
  "project_id",
  "require_terms_disclosure",
  "vendor_email",
  "vendor_name",
])
const firstNoName = buildCardInviteRequest({ ...form, name: "   ", check: null })
check("first, no name: mode", firstNoName.mode, "first")
check("first, no name: name dropped in JSON", "vendor_name" in JSON.parse(JSON.stringify(firstNoName.body)), false)
check("first, terms true kept", buildCardInviteRequest({ ...form, requireTermsDisclosure: true, check: null }).body.require_terms_disclosure, true)

// An existing invitation: a resend, with no content and no terms flag.
for (const [label, c] of [
  ["pending", { has_pending_invite: true, has_expired_invite: false }],
  ["expired", { has_pending_invite: false, has_expired_invite: true }],
] as const) {
  const r = buildCardInviteRequest({ ...form, check: c })
  check(`${label}: mode`, r.mode, "resend")
  check(`${label}: route sees a resend`, isResendRequest(r.body), true)
  check(`${label}: body`, r.body, { vendor_email: "Vendor@Studio.com", vendor_name: "Studio North", project_id: "p-1", resend: true })
  check(`${label}: no terms flag`, "require_terms_disclosure" in r.body, false)
}

// ---------------------------------------------------------------------------------------------
// G2: the wizard's guest send
// ---------------------------------------------------------------------------------------------
const business = { designations: { mbe: true }, insurance: { gl: { required: true, minimum: "$1M" } }, notes: "Union crew" }
const categories = [{ key: "c1", name: "Crew", note: null }]
const criteria = [{ key: "e1", name: "Craft", weight: 50 }]
const masterRfp = {
  projectName: "Spring Launch",
  client: "Acme Secret Client",
  overview: "Overview",
  objectives: ["A"],
  scopeItems: [{ id: "s1", name: "Film", description: "30s", estimatedBudget: "$90k" }],
  totalBudget: "$500k",
  timeline: "Q1",
  business_criteria_required: business,
  budget_categories: categories,
  evaluation_criteria: criteria,
}
const wizardInput = {
  email: "vendor@studio.com",
  name: "Studio North",
  projectId: "p-1",
  scopeItem: { id: "s1", name: "Film", description: "30s spot", estimatedBudget: "$90k" },
  referenceMaterials: [{ type: "link", label: "Deck", url: "https://x.test/deck", created_at: "2026-11-01" }],
  requireTermsDisclosure: true,
  responseDeadline: "2026-11-20T23:59:59.000Z",
  showClientToVendors: false,
  releaseBudget: false,
  closeBiddingAtDeadline: true,
  masterRfp,
}
const wb = buildWizardGuestInviteBody(wizardInput)
check("wizard: every key the wizard sent before, unchanged", {
  vendor_email: wb.vendor_email,
  vendor_name: wb.vendor_name,
  project_id: wb.project_id,
  scope_item_name: wb.scope_item_name,
  scope_item_description: wb.scope_item_description,
  reference_materials: wb.reference_materials,
  require_terms_disclosure: wb.require_terms_disclosure,
  response_deadline: wb.response_deadline,
  show_client_to_vendors: wb.show_client_to_vendors,
  release_budget: wb.release_budget,
  estimated_budget: wb.estimated_budget,
}, {
  vendor_email: "vendor@studio.com",
  vendor_name: "Studio North",
  project_id: "p-1",
  scope_item_name: "Film",
  scope_item_description: "30s spot",
  reference_materials: wizardInput.referenceMaterials,
  require_terms_disclosure: true,
  response_deadline: "2026-11-20T23:59:59.000Z",
  show_client_to_vendors: false,
  release_budget: false,
  estimated_budget: "$90k",
})
check("wizard: business criteria carried", wb.business_criteria_required, business)
check("wizard: budget categories carried", wb.budget_categories, categories)
check("wizard: evaluation criteria carried", wb.evaluation_criteria, criteria)
check("wizard: close flag carried", wb.close_bidding_at_deadline, true)
check("wizard: not a resend", isResendRequest(wb), false)
check("wizard: exact key set", Object.keys(wb).sort(), [
  "budget_categories",
  "business_criteria_required",
  "close_bidding_at_deadline",
  "estimated_budget",
  "evaluation_criteria",
  "project_id",
  "reference_materials",
  "release_budget",
  "require_terms_disclosure",
  "response_deadline",
  "scope_item_description",
  "scope_item_name",
  "show_client_to_vendors",
  "vendor_email",
  "vendor_name",
])
// Nothing of the master RFP travels except what is named: no client, no total budget, no other lines.
const json = JSON.stringify(wb)
check("wizard: no client name", json.includes("Acme Secret Client"), false)
check("wizard: no total budget", json.includes("$500k"), false)
check("wizard: no scopeItems array", "scopeItems" in wb, false)
check("wizard: vendor-facing keys come from the allow-list", ["business_criteria_required", "budget_categories"].every((k) => (VENDOR_COPY_KEYS as readonly string[]).includes(k)), true)

// Close flag: explicit true only.
check("wizard: close false", buildWizardGuestInviteBody({ ...wizardInput, closeBiddingAtDeadline: false }).close_bidding_at_deadline, false)
// Empty and missing master RFP parts send empty values, as the route already writes for absent ones.
const empty = buildWizardGuestInviteBody({ ...wizardInput, masterRfp: { business_criteria_required: undefined, budget_categories: "x", evaluation_criteria: null } })
check("wizard: bad categories -> []", empty.budget_categories, [])
check("wizard: null criteria -> []", empty.evaluation_criteria, [])
check("wizard: missing business criteria absent in JSON", "business_criteria_required" in JSON.parse(JSON.stringify(empty)), false)
const noMaster = buildWizardGuestInviteBody({ ...wizardInput, masterRfp: null })
check("wizard: null master RFP -> [] categories", noMaster.budget_categories, [])
check("wizard: null master RFP -> [] criteria", noMaster.evaluation_criteria, [])
// Name and budget edge cases match the old inline body.
check("wizard: empty name -> undefined", buildWizardGuestInviteBody({ ...wizardInput, name: "" }).vendor_name, undefined)
check("wizard: no budget -> undefined", buildWizardGuestInviteBody({ ...wizardInput, scopeItem: { ...wizardInput.scopeItem, estimatedBudget: "" } }).estimated_budget, undefined)
check("wizard: budget capped at 200", (buildWizardGuestInviteBody({ ...wizardInput, scopeItem: { ...wizardInput.scopeItem, estimatedBudget: "9".repeat(300) } }).estimated_budget as string).length, 200)

// ---------------------------------------------------------------------------------------------
// G3: messages
// ---------------------------------------------------------------------------------------------
check("first ok", describeInviteOutcome({ mode: "first", status: 200, data: { email_sent: true, attached: false } }), {
  tone: "success",
  message: "Invitation sent. The link expires in 72 hours.",
})
check("resend ok", describeInviteOutcome({ mode: "resend", status: 200, data: { email_sent: true } }), {
  tone: "success",
  message: "Invitation resent. The link expires in 72 hours.",
})
check("ok, no email, attached", describeInviteOutcome({ mode: "resend", status: 200, data: { email_sent: false, attached: true } }).tone, "warning")
check("ok, no email, not attached", describeInviteOutcome({ mode: "first", status: 200, data: { email_sent: false, attached: false } }), {
  tone: "warning",
  message: "The invitation is saved, but the email did not go out. Use Resend in a few minutes to try again.",
})
check("resend 404", describeInviteOutcome({ mode: "resend", status: 404, data: { error: "There is no invitation to resend for this vendor" } }), {
  tone: "error",
  message: "There is no invitation to resend for this vendor. Send a new invitation instead.",
})
check("first 404 (project) uses the server's error", describeInviteOutcome({ mode: "first", status: 404, data: { error: "Project not found" } }), {
  tone: "error",
  message: "Project not found",
})
check("401", describeInviteOutcome({ mode: "resend", status: 401, data: { error: "Unauthorized" } }).message, "Your session has expired. Sign in again, then retry.")
check("500 with error", describeInviteOutcome({ mode: "resend", status: 500, data: { error: "Failed to resend invitation" } }), {
  tone: "error",
  message: "Failed to resend invitation",
})
check("500 no body, resend", describeInviteOutcome({ mode: "resend", status: 500, data: {} }).message, "Could not resend the invitation. Please try again.")
check("500 no body, first", describeInviteOutcome({ mode: "first", status: 502, data: null }).message, "Could not send the invitation. Please try again.")
check("blank error string falls back", describeInviteOutcome({ mode: "first", status: 400, data: { error: "  " } }).message, "Could not send the invitation. Please try again.")
check("network", describeInviteOutcome({ mode: "first", status: 0, data: null }), {
  tone: "error",
  message: "Network error. Check your connection and try again.",
})
// No em dashes in any message (copy rule).
const allMessages = [
  describeInviteOutcome({ mode: "first", status: 200, data: { email_sent: true } }),
  describeInviteOutcome({ mode: "resend", status: 200, data: { attached: true } }),
  describeInviteOutcome({ mode: "first", status: 200, data: {} }),
  describeInviteOutcome({ mode: "resend", status: 404, data: {} }),
  describeInviteOutcome({ mode: "first", status: 401, data: {} }),
  describeInviteOutcome({ mode: "resend", status: 500, data: {} }),
  describeInviteOutcome({ mode: "first", status: 0, data: {} }),
].map((o) => o.message)
check("no em dashes", allMessages.some((m) => m.includes("—")), false)

console.log(`agency-invite-request: ${passed} passed`)
