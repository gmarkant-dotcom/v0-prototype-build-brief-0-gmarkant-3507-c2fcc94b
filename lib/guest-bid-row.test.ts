/**
 * Plain assertion test for lib/guest-bid-row.ts (F8) - no test framework, run with:
 *   npx -y tsx lib/guest-bid-row.test.ts
 */
import assert from "node:assert/strict"
import { buildGuestBidContent, GUEST_BID_FORBIDDEN_COLUMNS, type GuestBidContentInput } from "./guest-bid-row"
import { buildProposalSectionsForSave, normalizeProposalSections } from "./proposal-sections"

let passed = 0
function check(label: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  passed++
}

const NOW = "2026-11-06T12:00:00.000Z"
// The guest route's own pipeline for the request field, unchanged.
const sectionsFrom = (raw: unknown) => buildProposalSectionsForSave(normalizeProposalSections(raw))
const input = (over: Partial<GuestBidContentInput> = {}): GuestBidContentInput => ({
  proposal_text: "We would shoot it in two days.",
  budget_proposal: "50000 USD",
  timeline_proposal: "3 Weeks",
  terms_disclosure: null,
  attachments: [],
  business_criteria_responses: {},
  business_criteria_acknowledgments: null,
  hasAcknowledgments: false,
  budget_lines: null,
  proposal_sections: null,
  nowIso: NOW,
  ...over,
})

// Sections are stored as the vendor path stores them: the normalized object, blanks dropped
const sections = sectionsFrom({ approach: "  Two units ", experience: "", team: "Crew of 8", bogus: "x" })
check("sections normalized", sections, { approach: "Two units", team: "Crew of 8" })
const withSections = buildGuestBidContent(input({ proposal_sections: sections }))
check("sections written", withSections.proposal_sections, { approach: "Two units", team: "Crew of 8" })

// A JSON string body normalizes the same way
check("json string sections", sectionsFrom('{"assumptions":"Weather"}'), { assumptions: "Weather" })

// No sections: the key is absent, never an empty object (pre-076 safety, same as the vendor path)
check("no sections: key absent", "proposal_sections" in buildGuestBidContent(input()), false)
check("all blank: key absent", "proposal_sections" in buildGuestBidContent(input({ proposal_sections: sectionsFrom({ approach: "  " }) })), false)
check("malformed: key absent", "proposal_sections" in buildGuestBidContent(input({ proposal_sections: sectionsFrom([1, 2]) })), false)

// Same conditional keys as before for the other optional columns
check("no ack: key absent", "business_criteria_acknowledgments" in buildGuestBidContent(input()), false)
check("ack written when sent", buildGuestBidContent(input({ hasAcknowledgments: true, business_criteria_acknowledgments: { a: 1 } })).business_criteria_acknowledgments, { a: 1 })
check("no budget lines: key absent", "budget_lines" in buildGuestBidContent(input()), false)
check("budget lines written", buildGuestBidContent(input({ budget_lines: [{ id: "x" }] })).budget_lines, [{ id: "x" }])
check("status submitted", withSections.status, "submitted")
check("updated_at from input", withSections.updated_at, NOW)

// Bid content only: never an agency-owned column, in any shape
const full = buildGuestBidContent(
  input({ proposal_sections: sections, budget_lines: [{ id: "x" }], hasAcknowledgments: true, business_criteria_acknowledgments: {} })
)
for (const col of GUEST_BID_FORBIDDEN_COLUMNS) {
  check(`never writes ${col}`, col in full, false)
}
check("no score-like key", Object.keys(full).filter((k) => /score|evaluation|summary/.test(k)), [])
check("exact key set", Object.keys(full).sort(), [
  "attachments",
  "budget_lines",
  "budget_proposal",
  "business_criteria_acknowledgments",
  "business_criteria_responses",
  "proposal_sections",
  "proposal_text",
  "status",
  "terms_disclosure",
  "timeline_proposal",
  "updated_at",
])

console.log(`guest-bid-row: ${passed} passed`)
