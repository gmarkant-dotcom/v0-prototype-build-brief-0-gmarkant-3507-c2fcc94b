import type { SupabaseClient } from "@supabase/supabase-js"
import {
  BUDGET_RPCS,
  BUDGET_TABLES,
  FEE_OR_COST,
  MERGE_COLUMNS,
  PROJECT_CATEGORY_COLUMNS,
  RPC_PROJECT_ARG,
  TEMPLATE_CATEGORY_COLUMNS,
  cols,
  type CategoryMerge,
  type FeeOrCost,
  type ProjectCategory,
  type TemplateCategory,
} from "./schema"
import { clearRedundantLineKinds } from "./lines"
import { fail, fromDbError, isBudgetSpineMissing, ok, type BudgetResult } from "./result"
import type { AgencyProject, BudgetSession } from "./scope"
import type { OrgId } from "@/lib/entitlements"

/**
 * THE CHART OF ACCOUNTS: the agency template and each project's own copy (103).
 *
 * Copy, never pointer: nothing here stores which template row a project category came from, and
 * promotion copies values back the other way. Merge and rename keep history in
 * budget_category_merges, which is append-only, and never touch ledger_entries.original_category_id.
 * R1: a category is deleted only while nothing references it (the foreign keys answer 23503,
 * returned as in_use); otherwise it is archived.
 */

function normalizeName(name: unknown): string | null {
  if (typeof name !== "string") return null
  const trimmed = name.trim()
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null
}

function normalizeFlag(flag: unknown): FeeOrCost | null {
  return typeof flag === "string" && (FEE_OR_COST as readonly string[]).includes(flag) ? (flag as FeeOrCost) : null
}

// ---------------------------------------------------------------------------------------------
// The agency template
// ---------------------------------------------------------------------------------------------

export async function listTemplateCategories(
  session: BudgetSession,
  opts: { includeArchived?: boolean } = {}
): Promise<BudgetResult<TemplateCategory[]>> {
  if (session.orgIds.length === 0) return ok([])
  let query = session.client
    .from(BUDGET_TABLES.templateCategories)
    .select(cols(TEMPLATE_CATEGORY_COLUMNS))
    .in("org_id", session.orgIds)
    .order("created_at", { ascending: true })
  if (!opts.includeArchived) query = query.is("archived_at", null)
  const { data, error } = await query
  if (error) return fromDbError(error)
  return ok((data ?? []) as unknown as TemplateCategory[])
}

export async function createTemplateCategory(
  client: SupabaseClient,
  writeOrgId: OrgId,
  input: { name: unknown; feeOrCost: unknown }
): Promise<BudgetResult<TemplateCategory>> {
  const name = normalizeName(input.name)
  const fee_or_cost = normalizeFlag(input.feeOrCost)
  if (!name) return fail("invalid", "A category needs a name")
  if (!fee_or_cost) return fail("invalid", "A category must be marked fee or cost")
  const { data, error } = await client
    .from(BUDGET_TABLES.templateCategories)
    .insert({ org_id: writeOrgId, name, fee_or_cost })
    .select(cols(TEMPLATE_CATEGORY_COLUMNS))
    .single()
  if (error) return fromDbError(error)
  return ok(data as unknown as TemplateCategory)
}

/** Rename, re-flag, archive or un-archive a template category. Changes no project (copy, not pointer). */
export async function updateTemplateCategory(
  session: BudgetSession,
  categoryId: string,
  input: { name?: unknown; feeOrCost?: unknown; archived?: unknown }
): Promise<BudgetResult<TemplateCategory>> {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) {
    const name = normalizeName(input.name)
    if (!name) return fail("invalid", "A category needs a name")
    patch.name = name
  }
  if (input.feeOrCost !== undefined) {
    const flag = normalizeFlag(input.feeOrCost)
    if (!flag) return fail("invalid", "A category must be marked fee or cost")
    patch.fee_or_cost = flag
  }
  if (input.archived !== undefined) {
    if (typeof input.archived !== "boolean") return fail("invalid", "archived must be true or false")
    patch.archived_at = input.archived ? new Date().toISOString() : null
  }
  if (Object.keys(patch).length === 0) return fail("invalid", "Nothing to change")
  if (session.orgIds.length === 0) return fail("not_found", "Category not found")
  const { data, error } = await session.client
    .from(BUDGET_TABLES.templateCategories)
    .update(patch)
    .eq("id", categoryId)
    .in("org_id", session.orgIds)
    .select(cols(TEMPLATE_CATEGORY_COLUMNS))
    .maybeSingle()
  if (error) return fromDbError(error)
  if (!data) return fail("not_found", "Category not found")
  return ok(data as unknown as TemplateCategory)
}

/** Nothing references a template row (copy, not pointer), so R1 allows a hard delete. */
export async function deleteTemplateCategory(session: BudgetSession, categoryId: string): Promise<BudgetResult<{ deleted: true }>> {
  if (session.orgIds.length === 0) return fail("not_found", "Category not found")
  const { data, error } = await session.client
    .from(BUDGET_TABLES.templateCategories)
    .delete()
    .eq("id", categoryId)
    .in("org_id", session.orgIds)
    .select("id")
  if (error) return fromDbError(error)
  if (!data || data.length === 0) return fail("not_found", "Category not found")
  return ok({ deleted: true })
}

// ---------------------------------------------------------------------------------------------
// A project's chart
// ---------------------------------------------------------------------------------------------

/** R6. Atomic in the database: 42501 not the agency (refused), 23505 the chart exists (conflict). */
export async function copyTemplateToProject(client: SupabaseClient, project: AgencyProject): Promise<BudgetResult<{ copied: number }>> {
  const { data, error } = await client.rpc(BUDGET_RPCS.copyTemplateToProject, { [RPC_PROJECT_ARG]: project.projectId })
  if (error) return fromDbError(error)
  return ok({ copied: typeof data === "number" ? data : Number(data) || 0 })
}

export async function listProjectCategories(
  client: SupabaseClient,
  project: AgencyProject,
  opts: { includeArchived?: boolean } = {}
): Promise<BudgetResult<ProjectCategory[]>> {
  let query = client
    .from(BUDGET_TABLES.projectCategories)
    .select(cols(PROJECT_CATEGORY_COLUMNS))
    .eq("project_id", project.projectId)
    .order("created_at", { ascending: true })
  if (!opts.includeArchived) query = query.is("archived_at", null)
  const { data, error } = await query
  if (error) return fromDbError(error)
  return ok((data ?? []) as unknown as ProjectCategory[])
}

export async function addProjectCategory(
  client: SupabaseClient,
  project: AgencyProject,
  input: { name: unknown; feeOrCost: unknown }
): Promise<BudgetResult<ProjectCategory>> {
  const name = normalizeName(input.name)
  const fee_or_cost = normalizeFlag(input.feeOrCost)
  if (!name) return fail("invalid", "A category needs a name")
  if (!fee_or_cost) return fail("invalid", "A category must be marked fee or cost")
  const { data, error } = await client
    .from(BUDGET_TABLES.projectCategories)
    .insert({ project_id: project.projectId, name, fee_or_cost })
    .select(cols(PROJECT_CATEGORY_COLUMNS))
    .single()
  if (error) return fromDbError(error)
  return ok(data as unknown as ProjectCategory)
}

async function readProjectCategory(
  client: SupabaseClient,
  project: AgencyProject,
  categoryId: string
): Promise<BudgetResult<ProjectCategory>> {
  const { data, error } = await client
    .from(BUDGET_TABLES.projectCategories)
    .select(cols(PROJECT_CATEGORY_COLUMNS))
    .eq("project_id", project.projectId)
    .eq("id", categoryId)
    .maybeSingle()
  if (error) return fromDbError(error)
  if (!data) return fail("not_found", "Category not found")
  return ok(data as unknown as ProjectCategory)
}

export async function setProjectCategoryArchived(
  client: SupabaseClient,
  project: AgencyProject,
  categoryId: string,
  archived: boolean
): Promise<BudgetResult<ProjectCategory>> {
  const { data, error } = await client
    .from(BUDGET_TABLES.projectCategories)
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("project_id", project.projectId)
    .eq("id", categoryId)
    .select(cols(PROJECT_CATEGORY_COLUMNS))
    .maybeSingle()
  if (error) return fromDbError(error)
  if (!data) return fail("not_found", "Category not found")
  return ok(data as unknown as ProjectCategory)
}

/** R1: refused by the foreign keys (in_use) while any line, merge or ledger entry names it. */
export async function deleteProjectCategory(
  client: SupabaseClient,
  project: AgencyProject,
  categoryId: string
): Promise<BudgetResult<{ deleted: true }>> {
  const { data, error } = await client
    .from(BUDGET_TABLES.projectCategories)
    .delete()
    .eq("project_id", project.projectId)
    .eq("id", categoryId)
    .select("id")
  if (error) return fromDbError(error)
  if (!data || data.length === 0) return fail("not_found", "Category not found")
  return ok({ deleted: true })
}

/**
 * Promote a project category to the project agency's template. A COPY of name and flag; no
 * "promoted from" pointer is stored (not ruled, and a pointer is what 2f forbids).
 */
export async function promoteProjectCategory(
  client: SupabaseClient,
  project: AgencyProject,
  categoryId: string
): Promise<BudgetResult<TemplateCategory>> {
  const source = await readProjectCategory(client, project, categoryId)
  if (!source.ok) return source
  return createTemplateCategory(client, project.orgId, { name: source.data.name, feeOrCost: source.data.fee_or_cost })
}

export type MergeOutcome = {
  merge: CategoryMerge
  linesMoved: number
  /** null when 104 is not applied: there is no ledger to re-point. */
  entriesMoved: number | null
  /** R-K4: lines in the survivor whose override equalled its kind, reset to inherit (0 before 117). */
  lineKindsReset: number
}

/**
 * Moves current rows from a merged-away category to its survivor. Idempotent, so it is also the
 * recovery path if a merge was recorded but the re-point did not finish (PostgREST gives the
 * helpers no transaction; see docs/budget-spine-server-report.md). Never touches
 * ledger_entries.original_category_id.
 */
export async function repointMergedCategory(
  client: SupabaseClient,
  project: AgencyProject,
  fromCategoryId: string
): Promise<BudgetResult<MergeOutcome>> {
  const { data: mergeRow, error: mergeErr } = await client
    .from(BUDGET_TABLES.merges)
    .select(cols(MERGE_COLUMNS))
    .eq("project_id", project.projectId)
    .eq("from_category_id", fromCategoryId)
    .maybeSingle()
  if (mergeErr) return fromDbError(mergeErr)
  if (!mergeRow) return fail("not_found", "No merge recorded for that category")
  const merge = mergeRow as unknown as CategoryMerge

  const { data: lines, error: linesErr } = await client
    .from(BUDGET_TABLES.lines)
    .update({ category_id: merge.into_category_id })
    .eq("project_id", project.projectId)
    .eq("category_id", fromCategoryId)
    .select("id")
  if (linesErr) return fromDbError(linesErr)

  let entriesMoved: number | null = 0
  const { data: entries, error: entriesErr } = await client
    .from(BUDGET_TABLES.ledgerEntries)
    .update({ category_id: merge.into_category_id })
    .eq("project_id", project.projectId)
    .eq("category_id", fromCategoryId)
    .select("id")
  if (entriesErr) {
    if (!isBudgetSpineMissing(entriesErr)) return fromDbError(entriesErr)
    entriesMoved = null
  } else {
    entriesMoved = entries?.length ?? 0
  }

  // R-K4: a moved line whose override equals the survivor's kind inherits again. This is also how a
  // rename and a fee/cost switch (both a merge into a new category) reach the lines.
  const reset = await clearRedundantLineKinds(client, project, merge.into_category_id)
  if (!reset.ok) return reset

  return ok({ merge, linesMoved: lines?.length ?? 0, entriesMoved, lineKindsReset: reset.data })
}

/**
 * Merge one category of a project into another. Records the append-only merge row FIRST (the
 * database refuses self-merge, a second merge of the same category and merging into something
 * already merged away), then re-points lines and ledger entries. The merged-away row is kept.
 */
export async function mergeProjectCategories(
  client: SupabaseClient,
  project: AgencyProject,
  fromCategoryId: string,
  intoCategoryId: string
): Promise<BudgetResult<MergeOutcome>> {
  if (!fromCategoryId || !intoCategoryId) return fail("invalid", "Both categories are required")
  if (fromCategoryId === intoCategoryId) return fail("invalid", "A category cannot be merged into itself")

  const { data: both, error: readErr } = await client
    .from(BUDGET_TABLES.projectCategories)
    .select("id")
    .eq("project_id", project.projectId)
    .in("id", [fromCategoryId, intoCategoryId])
  if (readErr) return fromDbError(readErr)
  if (!both || both.length !== 2) return fail("not_found", "Category not found")

  const { error: insertErr } = await client
    .from(BUDGET_TABLES.merges)
    .insert({ project_id: project.projectId, from_category_id: fromCategoryId, into_category_id: intoCategoryId })
  if (insertErr) return fromDbError(insertErr)

  const moved = await repointMergedCategory(client, project, fromCategoryId)
  if (!moved.ok) {
    return fail(
      moved.kind === "disabled" ? "error" : moved.kind,
      `The merge was recorded but its rows were not all moved (${moved.message}). Retry the re-point.`,
      moved.code
    )
  }
  return moved
}

/** Rename = a merge into a new category of the new name and the same flag (103's design). */
export async function renameProjectCategory(
  client: SupabaseClient,
  project: AgencyProject,
  categoryId: string,
  newName: unknown
): Promise<BudgetResult<MergeOutcome & { category: ProjectCategory }>> {
  const source = await readProjectCategory(client, project, categoryId)
  if (!source.ok) return source
  const created = await addProjectCategory(client, project, { name: newName, feeOrCost: source.data.fee_or_cost })
  if (!created.ok) return created
  const merged = await mergeProjectCategories(client, project, categoryId, created.data.id)
  if (!merged.ok) return merged
  return ok({ ...merged.data, category: created.data })
}

export async function listCategoryMerges(client: SupabaseClient, project: AgencyProject): Promise<BudgetResult<CategoryMerge[]>> {
  const { data, error } = await client
    .from(BUDGET_TABLES.merges)
    .select(cols(MERGE_COLUMNS))
    .eq("project_id", project.projectId)
    .order("merged_at", { ascending: true })
  if (error) return fromDbError(error)
  return ok((data ?? []) as unknown as CategoryMerge[])
}
