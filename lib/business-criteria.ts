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
  insurance: Record<InsuranceKey, InsuranceHolds> & { coi_on_file: boolean; coi_document_url: string | null }
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

/**
 * Requirement tiers (S4-1). Binary, no third tier. "required" surfaces as a hard
 * confirmation block agency-side (red compliance flag if unmet); "preferred" is a light
 * optional toggle. Stored as a SEPARATE, optional map alongside the existing gate fields
 * (designations / insurance / coi_on_file) rather than changing those fields' value shape -
 * this keeps every pre-S4-1 `=== true` gate check working unchanged. Absence of an explicit
 * priority entry for an otherwise-gated item means "this RFP predates requirement tiers";
 * see hasExplicitPriorityData() - callers must not silently invent a tier for that case.
 */
export type RequirementPriority = "required" | "preferred"

export interface BusinessCriteriaRequired {
  designations: Partial<Record<DesignationKey, true>>
  designationPriority?: Partial<Record<DesignationKey, RequirementPriority>>
  insurance: Partial<Record<InsuranceKey, InsuranceRequirement>> & { coi_on_file?: boolean }
  insurancePriority?: Partial<Record<InsuranceKey, RequirementPriority>>
  coiPriority?: RequirementPriority
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
      coi_document_url: null,
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
  if (typeof s.insurance?.coi_document_url === "string" || s.insurance?.coi_document_url === null) {
    insurance.coi_document_url = s.insurance.coi_document_url
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

  const isPriority = (v: unknown): v is RequirementPriority => v === "required" || v === "preferred"

  const designationPriority: Partial<Record<DesignationKey, RequirementPriority>> = {}
  for (const key of DESIGNATION_KEYS) {
    const p = s.designationPriority?.[key]
    if (isPriority(p)) designationPriority[key] = p
  }

  const insurancePriority: Partial<Record<InsuranceKey, RequirementPriority>> = {}
  for (const key of INSURANCE_KEYS) {
    const p = s.insurancePriority?.[key]
    if (isPriority(p)) insurancePriority[key] = p
  }

  const coiPriority = isPriority(s.coiPriority) ? s.coiPriority : undefined

  return {
    designations,
    ...(Object.keys(designationPriority).length > 0 ? { designationPriority } : {}),
    insurance,
    ...(Object.keys(insurancePriority).length > 0 ? { insurancePriority } : {}),
    ...(coiPriority ? { coiPriority } : {}),
    notes: typeof s.notes === "string" ? s.notes : "",
  }
}

/**
 * True only if this RFP's requirements carry at least one explicit priority tag. RFPs
 * created before S4-1 (or created after but never touched by the new wizard toggle) have
 * none - callers use this to decide "render the new tiered UI" vs "render exactly what
 * existed before tiers" rather than guessing a tier for untagged data.
 */
export function hasExplicitPriorityData(required: BusinessCriteriaRequired): boolean {
  return (
    Object.keys(required.designationPriority || {}).length > 0 ||
    Object.keys(required.insurancePriority || {}).length > 0 ||
    required.coiPriority != null
  )
}

/** Priority for a gated designation. Falls back to "required" (never silently softened) when this RFP has tier data for other items but not this one. */
export function getDesignationPriority(required: BusinessCriteriaRequired, key: DesignationKey): RequirementPriority {
  return required.designationPriority?.[key] || "required"
}

/** Priority for a gated insurance line. Same required-by-default fallback as designations. */
export function getInsurancePriority(required: BusinessCriteriaRequired, key: InsuranceKey): RequirementPriority {
  return required.insurancePriority?.[key] || "required"
}

export function getCoiPriority(required: BusinessCriteriaRequired): RequirementPriority {
  return required.coiPriority || "required"
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

/**
 * Ad hoc filter match: does a company's holds satisfy an agency's picked designation/insurance
 * checkboxes (e.g. on /agency/pool or /partner/discover)? Unlike compareBusinessCriteria, there
 * is no RFP "required" object here, just a free-form filter selection - every selected key must
 * be held for a match. An empty selection always matches (no filter applied).
 */
export function businessCriteriaHoldsMatchesSelection(
  holds: BusinessCriteriaHolds,
  selectedDesignations: DesignationKey[],
  selectedInsurance: InsuranceKey[]
): boolean {
  for (const key of selectedDesignations) {
    if (!holds.designations[key].holds) return false
  }
  for (const key of selectedInsurance) {
    if (!holds.insurance[key].has_coverage) return false
  }
  return true
}

/**
 * Cannot-meet acknowledgments (S4-1). A vendor who cannot meet a required item never gets
 * hard-blocked from submitting; instead they record an explicit reason here, which surfaces
 * as a red compliance flag agency-side. Stored per bid, keyed the same way as
 * business_criteria_responses, matching migration 071's business_criteria_acknowledgments
 * column on partner_rfp_responses.
 */
export interface CriterionAcknowledgment {
  status: "cannot_meet"
  reason: string
}

export interface BusinessCriteriaAcknowledgments {
  designations?: Partial<Record<DesignationKey, CriterionAcknowledgment>>
  insurance?: Partial<Record<InsuranceKey, CriterionAcknowledgment>>
  coi?: CriterionAcknowledgment
}

export function emptyAcknowledgments(): BusinessCriteriaAcknowledgments {
  return {}
}

/** Sanitizes a stored/partial business_criteria_acknowledgments value (JSONB, may be absent on old rows). */
export function normalizeAcknowledgments(stored: unknown): BusinessCriteriaAcknowledgments {
  if (!stored || typeof stored !== "object") return {}
  const s = stored as Partial<BusinessCriteriaAcknowledgments>

  const isAck = (v: unknown): v is CriterionAcknowledgment =>
    !!v && typeof v === "object" && (v as CriterionAcknowledgment).status === "cannot_meet" &&
    typeof (v as CriterionAcknowledgment).reason === "string" && (v as CriterionAcknowledgment).reason.trim().length > 0

  const designations: Partial<Record<DesignationKey, CriterionAcknowledgment>> = {}
  for (const key of DESIGNATION_KEYS) {
    const row = s.designations?.[key]
    if (isAck(row)) designations[key] = row
  }

  const insurance: Partial<Record<InsuranceKey, CriterionAcknowledgment>> = {}
  for (const key of INSURANCE_KEYS) {
    const row = s.insurance?.[key]
    if (isAck(row)) insurance[key] = row
  }

  const coi = isAck(s.coi) ? s.coi : undefined

  return {
    ...(Object.keys(designations).length > 0 ? { designations } : {}),
    ...(Object.keys(insurance).length > 0 ? { insurance } : {}),
    ...(coi ? { coi } : {}),
  }
}

export interface RequirementComplianceItem {
  key: string
  kind: "designation" | "insurance" | "coi"
  label: string
  priority: RequirementPriority
  met: boolean
  cannotMeetReason: string | null
}

export interface RequirementComplianceReport {
  /** False when this RFP predates requirement tiers - render nothing, not a fake pass. */
  hasTierData: boolean
  requiredItems: RequirementComplianceItem[]
  preferredItems: RequirementComplianceItem[]
  requiredConfirmedCount: number
  requiredTotalCount: number
  /** Only meaningful when hasTierData is true. */
  meetsAllRequired: boolean
}

/**
 * Single source of truth for the requirement-tier compliance picture of one bid against its
 * RFP's requirements - used by the bid form's "N of M required confirmed" progress line and
 * by the compare/detail compliance matrix row. Returns hasTierData: false (empty item lists)
 * for any RFP that has no explicit priority data, so callers never fabricate a matrix for
 * pre-S4-1 RFPs.
 */
export function computeRequirementCompliance(
  required: BusinessCriteriaRequired,
  holds: BusinessCriteriaHolds,
  acknowledgments: BusinessCriteriaAcknowledgments,
  labels: { designations: Record<DesignationKey, string>; insurance: Record<InsuranceKey, string> }
): RequirementComplianceReport {
  if (!hasExplicitPriorityData(required)) {
    return {
      hasTierData: false,
      requiredItems: [],
      preferredItems: [],
      requiredConfirmedCount: 0,
      requiredTotalCount: 0,
      meetsAllRequired: false,
    }
  }

  const requiredItems: RequirementComplianceItem[] = []
  const preferredItems: RequirementComplianceItem[] = []

  for (const key of DESIGNATION_KEYS) {
    if (required.designations[key] !== true) continue
    const priority = getDesignationPriority(required, key)
    const met = holds.designations[key].holds
    const ack = acknowledgments.designations?.[key]
    const item: RequirementComplianceItem = {
      key,
      kind: "designation",
      label: labels.designations[key],
      priority,
      met,
      cannotMeetReason: !met && ack ? ack.reason : null,
    }
    ;(priority === "required" ? requiredItems : preferredItems).push(item)
  }

  for (const key of INSURANCE_KEYS) {
    if (required.insurance[key]?.required !== true) continue
    const priority = getInsurancePriority(required, key)
    const met = holds.insurance[key].has_coverage
    const ack = acknowledgments.insurance?.[key]
    const item: RequirementComplianceItem = {
      key,
      kind: "insurance",
      label: labels.insurance[key],
      priority,
      met,
      cannotMeetReason: !met && ack ? ack.reason : null,
    }
    ;(priority === "required" ? requiredItems : preferredItems).push(item)
  }

  if (required.insurance.coi_on_file === true) {
    const priority = getCoiPriority(required)
    const met = holds.insurance.coi_on_file
    const ack = acknowledgments.coi
    const item: RequirementComplianceItem = {
      key: "coi",
      kind: "coi",
      label: "Certificate of Insurance (COI)",
      priority,
      met,
      cannotMeetReason: !met && ack ? ack.reason : null,
    }
    ;(priority === "required" ? requiredItems : preferredItems).push(item)
  }

  const requiredConfirmedCount = requiredItems.filter((i) => i.met || i.cannotMeetReason).length

  return {
    hasTierData: true,
    requiredItems,
    preferredItems,
    requiredConfirmedCount,
    requiredTotalCount: requiredItems.length,
    meetsAllRequired: requiredItems.every((i) => i.met),
  }
}
