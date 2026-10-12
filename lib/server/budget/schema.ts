/**
 * THE BUDGET SPINE COLUMN CONTRACT. Every table, column and function name the budget helpers use
 * lives here and nowhere else, so a first-run fix to 103 or 104 that renames anything is a change
 * to this one file.
 *
 * Source: supabase/migrations/103_budget_core.sql and 104_budget_ledger.sql as amended to the
 * owner's rulings of 2026-10-09 (docs/103-104-rulings-report.md). NEITHER IS APPLIED as of that
 * date. Until they are, every helper returns { ok: false, kind: "disabled" }.
 *
 * Column lists are explicit on purpose: no helper selects "*", so a column added to a table later
 * is not returned by default.
 */

export const BUDGET_TABLES = {
  templateCategories: "budget_template_categories",
  projectCategories: "budget_project_categories",
  lines: "budget_lines",
  merges: "budget_category_merges",
  sourceDocuments: "source_documents",
  ledgerEntries: "ledger_entries",
} as const

export const BUDGET_RPCS = {
  /** 103, R6. (p_project_id uuid) RETURNS integer. 42501 not the agency; 23505 chart exists. */
  copyTemplateToProject: "budget_copy_template_to_project",
  /** 104, R3. (p_project_id uuid) RETURNS integer. 42501 not the agency. */
  archiveProjectDocuments: "budget_archive_project_documents",
  /** 104, R3. (p_project_id uuid) RETURNS integer. 42501 not the agency. */
  unarchiveProjectDocuments: "budget_unarchive_project_documents",
} as const

/** The single argument name both RPC families take. */
export const RPC_PROJECT_ARG = "p_project_id" as const

/** The tables 103 creates. Used to tell "103 missing" from "104 missing". */
export const TABLES_103 = [
  BUDGET_TABLES.templateCategories,
  BUDGET_TABLES.projectCategories,
  BUDGET_TABLES.lines,
  BUDGET_TABLES.merges,
] as const

export const TEMPLATE_CATEGORY_COLUMNS = ["id", "org_id", "name", "fee_or_cost", "archived_at", "created_at"] as const
export const PROJECT_CATEGORY_COLUMNS = ["id", "project_id", "name", "fee_or_cost", "archived_at", "created_at"] as const
export const LINE_COLUMNS = ["id", "project_id", "category_id", "name", "estimate", "archived_at", "created_at"] as const
export const MERGE_COLUMNS = ["id", "project_id", "from_category_id", "into_category_id", "merged_at"] as const
export const SOURCE_DOCUMENT_COLUMNS = [
  "id",
  "project_id",
  "partnership_id",
  "uploader_side",
  "visible_to_vendor",
  "archived_at",
  "file_name",
  "blob_path",
  "created_at",
] as const
export const LEDGER_ENTRY_COLUMNS = [
  "id",
  "project_id",
  "source_document_id",
  "category_id",
  "original_category_id",
  "budget_line_id",
  "amount",
  "payee_name",
  "entry_date",
  "category_confidence",
  "category_reasoning",
  "voided_at",
  "void_reason",
  "duplicate_of",
  "created_at",
] as const

export const cols = (list: readonly string[]) => list.join(", ")

export type FeeOrCost = "fee" | "cost"
export const FEE_OR_COST: readonly FeeOrCost[] = ["fee", "cost"]

export type TemplateCategory = {
  id: string
  org_id: string
  name: string
  fee_or_cost: FeeOrCost
  archived_at: string | null
  created_at: string
}

export type ProjectCategory = {
  id: string
  project_id: string
  name: string
  fee_or_cost: FeeOrCost
  archived_at: string | null
  created_at: string
}

export type BudgetLine = {
  id: string
  project_id: string
  category_id: string
  name: string
  /** numeric(14,2). PostgREST may send numeric as a number or a string; helpers normalize to number. */
  estimate: number
  archived_at: string | null
  created_at: string
}

export type CategoryMerge = {
  id: string
  project_id: string
  from_category_id: string
  into_category_id: string
  merged_at: string
}

export type SourceDocument = {
  id: string
  project_id: string
  partnership_id: string | null
  uploader_side: "agency" | "vendor"
  visible_to_vendor: boolean
  archived_at: string | null
  file_name: string
  blob_path: string
  created_at: string
}

export type LedgerEntry = {
  id: string
  project_id: string
  source_document_id: string
  category_id: string
  original_category_id: string
  budget_line_id: string | null
  amount: number
  payee_name: string | null
  entry_date: string | null
  category_confidence: number | null
  category_reasoning: string | null
  voided_at: string | null
  void_reason: string | null
  duplicate_of: string | null
  created_at: string
}

/**
 * Where a recorded document's blob must live. The serving route (not built) will read the row as
 * the caller and only then fetch the blob, so a row pointing at another tenant's blob would be a
 * read of that blob. Constraining the path at record time keeps every row inside its own project.
 */
export function budgetBlobPrefix(projectId: string): string {
  return `budget/${projectId}/`
}
