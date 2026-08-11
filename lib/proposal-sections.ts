/**
 * Structured proposal sub-fields (Phase 2, P2-2). Four optional, guided prompts that sit
 * ALONGSIDE the free-prose proposal_text, never replacing it. A vendor may fill all four, some,
 * or none, and a bid that fills none is exactly today's bid.
 *
 * Stored as partner_rfp_responses.proposal_sections (migration 076, jsonb, nullable).
 * A null column, a missing column, an empty object, and an all-blank object are all the same
 * state: this bid has no structured proposal, so nothing structured renders anywhere. That is
 * what makes every legacy prose-only bid render untouched, and what makes the whole feature
 * safe before 076 is applied.
 */

export type ProposalSectionKey = "approach" | "experience" | "team" | "assumptions"

export type ProposalSections = Partial<Record<ProposalSectionKey, string>>

export const PROPOSAL_SECTION_KEYS: ProposalSectionKey[] = ["approach", "experience", "team", "assumptions"]

export const PROPOSAL_SECTION_LABELS: Record<ProposalSectionKey, string> = {
  approach: "Approach",
  experience: "Relevant experience",
  team: "Team and capacity",
  assumptions: "Assumptions and risks",
}

export const PROPOSAL_SECTION_PLACEHOLDERS: Record<ProposalSectionKey, string> = {
  approach: "How you would tackle this scope, and why that way",
  experience: "Work you have done that this most resembles",
  team: "Who would work on it, and what else they are carrying",
  assumptions: "What you are assuming, and what could go wrong",
}

/** Tolerates null, undefined, a missing column, a JSON string, or a malformed object. Blank
 *  and whitespace-only values are dropped rather than kept, so "filled in with nothing" can
 *  never become a labelled empty heading on any read surface. */
export function normalizeProposalSections(raw: unknown): ProposalSections {
  let value = raw
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return {}
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const out: ProposalSections = {}
  for (const key of PROPOSAL_SECTION_KEYS) {
    const text = typeof source[key] === "string" ? (source[key] as string).trim() : ""
    if (text) out[key] = text
  }
  return out
}

export function hasProposalSections(sections: ProposalSections): boolean {
  return PROPOSAL_SECTION_KEYS.some((key) => Boolean(sections[key]))
}

/** Only sent when the vendor actually wrote something, so a bid shaped like today's never
 *  carries the key and the API never has to touch a column 076 may not have created yet. */
export function buildProposalSectionsForSave(sections: ProposalSections): ProposalSections | null {
  const normalized = normalizeProposalSections(sections)
  return hasProposalSections(normalized) ? normalized : null
}

/**
 * Labelled structured input for the AI analysis, scoring, and comparison prompts. Returns "" when
 * the bid has no structured sections, so a prompt that concatenates this gains nothing rather
 * than gaining an empty scaffold implying the vendor left required sections blank.
 */
export function formatProposalSectionsForPrompt(raw: unknown): string {
  const sections = normalizeProposalSections(raw)
  if (!hasProposalSections(sections)) return ""
  const parts = PROPOSAL_SECTION_KEYS.filter((key) => sections[key]).map(
    (key) => `${PROPOSAL_SECTION_LABELS[key]}:\n${sections[key]}`
  )
  return parts.join("\n\n")
}
