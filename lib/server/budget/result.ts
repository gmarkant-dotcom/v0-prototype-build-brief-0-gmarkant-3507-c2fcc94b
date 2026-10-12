/**
 * The typed result every budget helper returns. Helpers never throw for a database answer; a
 * route turns the result into a status code with budgetResponse() in ./http.ts.
 *
 *   disabled   the table or function does not exist yet (103 / 104 not applied). NEVER an error
 *              page and NEVER a fallback to another table: the feature is simply off.
 *   not_found  the row is not visible to the caller. Row level security and "does not exist"
 *              look the same on purpose.
 *   refused    42501: the caller may not do this (no privilege, no policy, not the agency).
 *   conflict   23505: e.g. copy-on-create into a project that already has a chart (R6).
 *   in_use     23503: something references the row (R1: a line with a ledger entry).
 *   invalid    23514 / 23502 / 22P02 / a helper's own validation.
 *   error      anything else.
 */

export type BudgetFailureKind = "disabled" | "not_found" | "refused" | "conflict" | "in_use" | "invalid" | "error"

export type BudgetOk<T> = { ok: true; data: T }
export type BudgetFail = { ok: false; kind: BudgetFailureKind; code: string | null; message: string }
export type BudgetResult<T> = BudgetOk<T> | BudgetFail

export type DbError = { code?: string | null; message?: string | null; details?: string | null } | null | undefined

export const ok = <T>(data: T): BudgetOk<T> => ({ ok: true, data })

export function fail(kind: BudgetFailureKind, message: string, code: string | null = null): BudgetFail {
  return { ok: false, kind, code, message }
}

/**
 * 42P01 (undefined_table) and 42883 (undefined_function) from Postgres; PGRST205 (table not in
 * the schema cache) and PGRST202 (function not in the schema cache) from PostgREST. All four
 * mean the same thing here: the budget spine is not enabled.
 */
export function isBudgetSpineMissing(err: DbError): boolean {
  if (!err) return false
  const code = err.code ?? ""
  if (code === "42P01" || code === "42883" || code === "PGRST205" || code === "PGRST202") return true
  const message = err.message ?? ""
  return /(budget_|source_documents|ledger_entries)/.test(message) && /does not exist|schema cache/i.test(message)
}

export const DISABLED = fail("disabled", "Budget spine not enabled")

export function fromDbError(err: NonNullable<DbError>): BudgetFail {
  if (isBudgetSpineMissing(err)) return DISABLED
  const code = err.code ?? null
  const message = err.message ?? "Database error"
  switch (code) {
    case "42501":
      return fail("refused", message, code)
    case "23505":
      return fail("conflict", message, code)
    case "23503":
      return fail("in_use", message, code)
    case "23514":
    case "23502":
    case "22P02":
    case "22003":
      return fail("invalid", message, code)
    case "PGRST116":
      return fail("not_found", "Not found", code)
    default:
      return fail("error", message, code)
  }
}

/** numeric(14,2) arrives as a number or a numeric string. Money is summed in cents. */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

export function toCents(value: unknown): number {
  return Math.round(toNumber(value) * 100)
}

/** A finite money amount with at most two decimals, or null. */
export function parseMoney(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN
  if (!Number.isFinite(n)) return null
  if (Math.abs(n) >= 1e12) return null
  return Math.round(n * 100) / 100
}
