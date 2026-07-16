/**
 * Business Criteria / Procurement Requirements.
 *
 * One shape, "BusinessCriteriaHolds", is reused for both:
 *   - profiles.business_criteria (what a company holds)
 *   - partner_rfp_responses.business_criteria_responses (what a bidder confirmed for a bid)
 * A response is just a point-in-time copy of what a bidder holds/confirms, so the UI can
 * prefill a response form from the profile and share one validator.
 *
 * A second shape, "BusinessCriteriaRequired", is reused for both:
 *   - rfp_magic_tokens.business_criteria_required (what an RFP requires)
 *   - the business_criteria_required key inside master_rfp_json (JSONB on partner_rfp_inbox,
 *     no dedicated column - master_rfp_json is already freeform JSONB)
 *
 * Insurance limits/minimums are free text (e.g. "$1M/$2M"). Comparison only checks presence
 * of coverage, not whether a limit numerically satisfies a minimum - see LIGAMENT_CONTEXT.md
 * backlog for the numeric insurance-limit parser.
 */

export const DESIGNATION_KEYS = [
  "mbe",
  "wbe",
  "mwbe",
  "dbe",
  "veteran_owned",
  "sdvob",
  "lgbtbe",
  "dobe",
  "sbe",
] as const

export type DesignationKey = (typeof DESIGNATION_KEYS)[number]

/** Shared display labels so profile pages, RFP requirement pickers, and bid forms show identical copy. */
export const DESIGNATION_LABELS: Record<DesignationKey, string> = {
  mbe: "Minority Business Enterprise (MBE)",
  wbe: "Women Business Enterprise (WBE)",
  mwbe: "Minority/Women-Owned Business Enterprise (MWBE)",
  dbe: "Disadvantaged Business Enterprise (DBE)",
  veteran_owned: "Veteran-Owned Business (VBE)",
  sdvob: "Service-Disabled Veteran-Owned Business (SDVOB)",
  lgbtbe: "LGBT Business Enterprise (LGBTBE)",
  dobe: "Disability-Owned Business Enterprise (DOBE)",
  sbe: "Small Business Enterprise (SBE)",
}

export const INSURANCE_KEYS = [
  "general_liability",
  "workers_comp",
  "commercial_auto",
  "umbrella_excess",
  "professional_liability_eo",
  "cyber_liability",
] as const

export type InsuranceKey = (typeof INSURANCE_KEYS)[number]

/** Shared display labels so /partner/legal and future RFP requirement pickers show identical copy. */
export const INSURANCE_LABELS: Record<InsuranceKey, string> = {
  general_liability: "General Liability",
  workers_comp: "Workers Compensation",
  commercial_auto: "Commercial Auto",
  umbrella_excess: "Umbrella / Excess",
  professional_liability_eo: "Professional Liability / E&O",
  cyber_liability: "Cyber Liability",
}

export interface DesignationHolds {
  holds: boolean
  certifying_body: string | null
  certification_number: string | null
  self_certified: boolean
}

export interface InsuranceHolds {
  has_coverage: boolean
  limit: string | null
}

export interface BusinessCriteriaHolds {
  designations: Record<DesignationKey, DesignationHolds>
  insurance: Record<InsuranceKey, InsuranceHolds> & { coi_on_file: boolean }
  company_facts: {
    years_in_business: number | null
    union_signatory: string
    sustainability_approach: string
    workforce_diversity_summary: string
  }
}

export interface InsuranceRequirement {
  required: boolean
  minimum: string | null
}

export interface BusinessCriteriaRequired {
  designations: Partial<Record<DesignationKey, true>>
  insurance: Partial<Record<InsuranceKey, InsuranceRequirement>> & { coi_on_file?: boolean }
  notes: string
}

function emptyDesignationHolds(): DesignationHolds {
  return { holds: false, certifying_body: null, certification_number: null, self_certified: false }
}

function emptyInsuranceHolds(): InsuranceHolds {
  return { has_coverage: false, limit: null }
}

export function emptyBusinessCriteriaHolds(): BusinessCriteriaHolds {
  return {
    designations: Object.fromEntries(
      DESIGNATION_KEYS.map((key) => [key, emptyDesignationHolds()])
    ) as Record<DesignationKey, DesignationHolds>,
    insurance: {
      ...(Object.fromEntries(INSURANCE_KEYS.map((key) => [key, emptyInsuranceHolds()])) as Record<
        InsuranceKey,
        InsuranceHolds
      >),
      coi_on_file: false,
    },
    company_facts: {
      years_in_business: null,
      union_signatory: "",
      sustainability_approach: "",
      workforce_diversity_summary: "",
    },
  }
}

/**
 * Skeleton-fill: merges a partial/empty stored JSONB value onto a fully populated default
 * skeleton, so a newly added designation or insurance key never breaks existing rows that
 * predate it.
 */
export function withBusinessCriteriaDefaults(stored: unknown): BusinessCriteriaHolds {
  const base = emptyBusinessCriteriaHolds()
  if (!stored || typeof stored !== "object") return base
  const s = stored as Partial<BusinessCriteriaHolds>

  const designations = { ...base.designations }
  for (const key of DESIGNATION_KEYS) {
    const row = s.designations?.[key]
    if (row && typeof row === "object") {
      designations[key] = { ...base.designations[key], ...row }
    }
  }

  const insurance = { ...base.insurance }
  for (const key of INSURANCE_KEYS) {
    const row = s.insurance?.[key]
    if (row && typeof row === "object") {
      insurance[key] = { ...base.insurance[key], ...row }
    }
  }
  if (typeof s.insurance?.coi_on_file === "boolean") {
    insurance.coi_on_file = s.insurance.coi_on_file
  }

  const company_facts = { ...base.company_facts, ...(s.company_facts || {}) }

  return { designations, insurance, company_facts }
}

/** Sanitizes a stored/partial business_criteria_required value. Required designations stay sparse by design. */
export function normalizeBusinessCriteriaRequired(stored: unknown): BusinessCriteriaRequired {
  const empty: BusinessCriteriaRequired = { designations: {}, insurance: {}, notes: "" }
  if (!stored || typeof stored !== "object") return empty
  const s = stored as Partial<BusinessCriteriaRequired>

  const designations: Partial<Record<DesignationKey, true>> = {}
  for (const key of DESIGNATION_KEYS) {
    if (s.designations?.[key] === true) designations[key] = true
  }

  const insurance: Partial<Record<InsuranceKey, InsuranceRequirement>> & { coi_on_file?: boolean } = {}
  for (const key of INSURANCE_KEYS) {
    const row = s.insurance?.[key]
    if (row && typeof row === "object") {
      insurance[key] = { required: Boolean(row.required), minimum: row.minimum ?? null }
    }
  }
  if (typeof s.insurance?.coi_on_file === "boolean") {
    insurance.coi_on_file = s.insurance.coi_on_file
  }

  return {
    designations,
    insurance,
    notes: typeof s.notes === "string" ? s.notes : "",
  }
}

export interface BusinessCriteriaGapReport {
  meetsAll: boolean
  missingDesignations: DesignationKey[]
  missingInsurance: InsuranceKey[]
  missingCoi: boolean
}

/** Compares an RFP's requirements against a company's holds (or a bidder's response) and reports gaps. */
export function compareBusinessCriteria(
  required: BusinessCriteriaRequired,
  holds: BusinessCriteriaHolds
): BusinessCriteriaGapReport {
  const missingDesignations = DESIGNATION_KEYS.filter(
    (key) => required.designations[key] === true && !holds.designations[key].holds
  )

  const missingInsurance = INSURANCE_KEYS.filter((key) => {
    const requirement = required.insurance[key]
    return requirement?.required === true && !holds.insurance[key].has_coverage
  })

  const missingCoi = required.insurance.coi_on_file === true && !holds.insurance.coi_on_file

  return {
    meetsAll: missingDesignations.length === 0 && missingInsurance.length === 0 && !missingCoi,
    missingDesignations,
    missingInsurance,
    missingCoi,
  }
}
