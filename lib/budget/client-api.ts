/**
 * Browser-side access to /api/agency/budget/**. Every response is turned into one of a small set
 * of states the budget screens render explicitly, so no screen has to interpret a status code:
 *
 *   not_enabled   404 { enabled: false }: 103 / 104 not applied yet.
 *   upgrade       402 agency_entitlement_required: the paid lead-agency gate.
 *   unauthorized  401.
 *   forbidden     403 (not linked to an organization; a refused action carries its own message).
 *   not_found     404 without enabled:false.
 *   conflict      409.
 *   invalid       400.
 *   error         anything else, including a network failure.
 */

export type BudgetApiErrorKind =
  | "not_enabled"
  | "upgrade"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid"
  | "error"

export class BudgetApiError extends Error {
  kind: BudgetApiErrorKind
  status: number
  code: string | null
  constructor(kind: BudgetApiErrorKind, status: number, message: string, code: string | null = null) {
    super(message)
    this.kind = kind
    this.status = status
    this.code = code
  }
}

function kindFor(status: number, body: Record<string, unknown>): BudgetApiErrorKind {
  if (status === 404 && body.enabled === false) return "not_enabled"
  if (status === 402) return "upgrade"
  if (status === 401) return "unauthorized"
  if (status === 403) return "forbidden"
  if (status === 404) return "not_found"
  if (status === 409) return "conflict"
  if (status === 400) return "invalid"
  return "error"
}

const DEFAULT_MESSAGE: Record<BudgetApiErrorKind, string> = {
  not_enabled: "Budgeting is not enabled yet.",
  upgrade: "Budgeting is part of the lead agency plan.",
  unauthorized: "Your session has ended. Sign in again.",
  forbidden: "You do not have access to this.",
  not_found: "Not found.",
  conflict: "That conflicts with the current state. Refresh and try again.",
  invalid: "That was not accepted.",
  error: "Something went wrong. Try again.",
}

export async function budgetFetch<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    })
  } catch {
    throw new BudgetApiError("error", 0, "Could not reach the server. Check your connection and try again.")
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const kind = kindFor(res.status, body)
    const raw = typeof body.error === "string" ? body.error : ""
    // The 402 body's error is a machine code; show words instead. A 500 says only "Failed".
    const message = kind === "upgrade" || kind === "error" || kind === "not_enabled" || !raw ? DEFAULT_MESSAGE[kind] : raw
    throw new BudgetApiError(kind, res.status, message, typeof body.code === "string" ? body.code : null)
  }
  return body as T
}

export const budgetPost = <T = Record<string, unknown>>(url: string, body: unknown) =>
  budgetFetch<T>(url, { method: "POST", body: JSON.stringify(body) })

export const budgetPatch = <T = Record<string, unknown>>(url: string, body: unknown) =>
  budgetFetch<T>(url, { method: "PATCH", body: JSON.stringify(body) })

export const budgetDelete = <T = Record<string, unknown>>(url: string) => budgetFetch<T>(url, { method: "DELETE" })

export function errorMessage(e: unknown): string {
  if (e instanceof BudgetApiError) return e.message
  if (e instanceof Error) return e.message
  return DEFAULT_MESSAGE.error
}

export const projectBase = (projectId: string) => `/api/agency/budget/projects/${encodeURIComponent(projectId)}`
