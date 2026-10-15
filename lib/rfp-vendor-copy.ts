/**
 * RFP record step C (live leak #8): what a vendor may hold of an agency's RFP.
 *
 * The agency's RFP record (rfp_records / rfp_record_lines, migration 118) holds the whole RFP. A
 * vendor holds only its own copy: one partner_rfp_inbox row per (scope line x vendor), whose
 * master_rfp_json the vendor can read whole with its own login (RLS on its own row). Before step C
 * that JSON was the agency's entire wizard object: the client name, every line and its budget, the
 * program budget, the scoring rubric, and on Lightning rows the vendor's bearer token.
 *
 * RULES:
 *  1. ONE ALLOW-LIST, NEVER A DENY-LIST. VENDOR_COPY_KEYS is every top-level key a vendor copy may
 *     carry. Anything else is dropped, including a key the wizard grows later. Migration 120 holds
 *     the same list (its guard refuses any other key on every write, for every role) and its
 *     pre-apply test checks that the two copies match. Change one, change both.
 *  2. THE CLIENT NAME AND THE BUDGET NEVER GO INTO THE JSON. A vendor receives them only through
 *     row columns the agency controls: partner_rfp_inbox.client_name_released (118; set when the
 *     record's show_client_to_vendors is on, D3) and partner_rfp_inbox.estimated_budget, which from
 *     step C on carries the line's RELEASED budget (rfp_record_lines.released_budget, D2) and is
 *     NULL when the line is not released. 118 added no released-budget column on the vendor's
 *     row, so the existing per-line column carries the release; 119 backfilled released =
 *     estimated, so every backfilled row already holds its release there.
 *  3. ONLY THE VENDOR'S OWN LINE. No scopeItems array: the vendor's line is the row's own
 *     scope_item_name / scope_item_description / timeline / estimated_budget columns.
 *  4. NO _magic_token (D8). Tokens are joined to inbox rows through
 *     rfp_magic_tokens.attached_inbox_id (118), never through the vendor's JSON.
 *
 * WHY EACH KEY IS ALLOWED (every one is rendered to the vendor, or is the vendor's own deadline):
 *   projectName                 the project title the vendor bids on (app/partner/rfps/[id]/page.tsx)
 *   overview, objectives        the brief written for vendors
 *   timeline                    the programme timeline shown as "Timeline (master)"
 *   business_criteria_required  requirements the vendor must answer in its bid (the guest link
 *                               already sends the same, app/api/rfp/guest/[token]/route.ts)
 *   budget_categories           category names and notes the vendor prices against; no amounts
 *   nda_link                    the NDA the vendor must sign before it may open the RFP
 *   response_deadline           the vendor's own deadline (the row column is the primary source)
 * NOT ALLOWED: client, totalBudget, scopeItems (every line, with budgets), evaluation_criteria (the
 * rubric), referenceMaterials (no vendor screen reads it from the copy), _magic_token, anything else.
 */

/**
 * The vendor-copy allow-list. Migration 120 carries this exact list (120_rfp_vendor_copy_scrub.sql,
 * function rfp_vendor_copy_keys()); keep the two identical, in this order.
 * ALLOW-LIST (SQL form, copied by 120_preapply_test.sql):
 *   ARRAY['projectName','overview','objectives','timeline','business_criteria_required','budget_categories','nda_link','response_deadline']
 */
export const VENDOR_COPY_KEYS = [
  "projectName",
  "overview",
  "objectives",
  "timeline",
  "business_criteria_required",
  "budget_categories",
  "nda_link",
  "response_deadline",
] as const

/**
 * The token's one object-shaped JSON column a guest path reads, rfp_magic_tokens.reference_materials,
 * may hold only the vendor-facing materials list. output_template_config is agency-only and lives
 * on the RFP record (D9). Migration 120 carries the same list (rfp_token_reference_materials_keys()).
 * ALLOW-LIST (SQL form, copied by 120_preapply_test.sql): ARRAY['materials']
 */
export const TOKEN_REFERENCE_MATERIALS_KEYS = ["materials"] as const

const VENDOR_COPY_KEY_SET: ReadonlySet<string> = new Set(VENDOR_COPY_KEYS)

/** Any JSON value narrowed to the allow-list. A non-object answers {}. */
export function pickVendorCopy(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (VENDOR_COPY_KEY_SET.has(key) && value !== undefined) out[key] = value
  }
  return out
}

/** rfp_magic_tokens.reference_materials as written from step C on: the materials list only. */
export function vendorTokenReferenceMaterials(materials: readonly unknown[]): { materials: unknown[] } {
  return { materials: [...materials] }
}

function trimmedOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/** What the vendor copy is built from: the agency's record (as sent) ... */
export type VendorCopyRecord = {
  /** The record's master RFP (rfp_records.master_rfp, or what is about to be written there). */
  masterRfp: Record<string, unknown>
  ndaLink: string | null
  showClientToVendors: boolean
  clientNameSnapshot: string | null
}

/** ... and the one line this vendor is sent. */
export type VendorCopyLine = {
  /** D2: rfp_record_lines.released_budget. NULL = hidden. */
  releasedBudget: string | null
}

/** Every vendor-visible value a writer puts on a partner_rfp_inbox row for one line. */
export type VendorCopy = {
  master_rfp_json: Record<string, unknown>
  /** The line's released budget, or NULL. Never the agency's internal estimate. */
  estimated_budget: string | null
  /** The client name when the record shows it to vendors, else NULL (D3). */
  client_name_released: string | null
}

/** The vendor's copy of one line of one RFP. Every inbox writer builds its row through this. */
export function buildVendorCopy(record: VendorCopyRecord, line: VendorCopyLine): VendorCopy {
  return {
    master_rfp_json: pickVendorCopy({ ...record.masterRfp, nda_link: record.ndaLink }),
    estimated_budget: trimmedOrNull(line.releasedBudget),
    client_name_released: record.showClientToVendors ? trimmedOrNull(record.clientNameSnapshot) : null,
  }
}

// ---------------------------------------------------------------------------------------------
// VENDOR READS. Explicit column lists, never "*". scope_item_id is deliberately absent: on a
// Lightning row it is 'magic:<token>' (lib/magic-token-attach.ts), the vendor's bearer link.
// invite_token and invite_token_expires_at are absent too.
// ---------------------------------------------------------------------------------------------

/** /api/partner/rfps (the vendor's RFP list). recipient_email and vendor_org_id are read for the
 *  ownership filter and not returned. No master_rfp_json: the list renders none of it. */
export const VENDOR_INBOX_LIST_COLUMNS =
  "id, lead_org_id, vendor_org_id, recipient_email, project_id, scope_item_name, scope_item_description, " +
  "agency_company_name, status, created_at, viewed_at, response_deadline, partner_intent, intent_set_at, " +
  "nda_gate_enforced, nda_confirmed_at, closed_at, client_name_released, " +
  "legacy_response_deadline:master_rfp_json->>response_deadline"

/** /api/partner/rfps/[id] (the vendor's RFP detail). master_rfp_json is narrowed with
 *  pickVendorCopy() before it is returned: before 120 old copies still hold the removed keys. */
export const VENDOR_INBOX_DETAIL_COLUMNS =
  "id, lead_org_id, vendor_org_id, recipient_email, project_id, partnership_id, scope_item_name, " +
  "scope_item_description, estimated_budget, timeline, master_rfp_json, agency_company_name, status, " +
  "created_at, viewed_at, response_deadline, close_bidding_at_deadline, partner_intent, intent_set_at, " +
  "nda_gate_enforced, nda_confirmed_at, require_terms_disclosure, client_name_released"
