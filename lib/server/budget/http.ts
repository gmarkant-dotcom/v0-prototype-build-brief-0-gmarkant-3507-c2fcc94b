import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { budgetSession, requireAgencyProject, type AgencyProject, type BudgetSession } from "./scope"
import type { BudgetFail, BudgetResult } from "./result"

/**
 * Shared plumbing for app/api/agency/budget/**. AGENCY ONLY, AND THE GATE IS THE SESSION:
 *
 *   1. authenticate (401);
 *   2. resolve the caller's own organizations from org_members (403 if none);
 *   3. for project routes, require the project's org_id to be one of them (404 otherwise).
 *
 * profiles.role / active_role are NOT read: a vendor can set active_role itself, so it is not a
 * security boundary (docs/leak-sweep-2026-10-09.md, finding 2). A vendor who reaches these routes
 * fails step 3 for every agency project and, on template routes, sees only its own
 * organization's template rows, which is its own data.
 *
 * While 103 / 104 are not applied every route answers 404 { error: "Budget spine not enabled" }.
 */

export const noStore = { "Cache-Control": "private, no-store, no-cache, must-revalidate" } as const

export const NOT_ENABLED_BODY = { error: "Budget spine not enabled", enabled: false } as const

type Gate<T> = { ok: true; value: T } | { ok: false; response: NextResponse }

export async function budgetRouteSession(): Promise<Gate<BudgetSession>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore }) }
  const session = await budgetSession(supabase, user.id)
  if (session.orgIds.length === 0) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Your account is not linked to an organization yet" }, { status: 403, headers: noStore }),
    }
  }
  return { ok: true, value: session }
}

export async function budgetRouteProject(projectId: string): Promise<Gate<{ session: BudgetSession; project: AgencyProject }>> {
  const gate = await budgetRouteSession()
  if (!gate.ok) return gate
  const project = await requireAgencyProject(gate.value, projectId)
  if (!project.ok) return { ok: false, response: failureResponse(project, "project") }
  return { ok: true, value: { session: gate.value, project: project.data } }
}

const STATUS: Record<BudgetFail["kind"], number> = {
  disabled: 404,
  not_found: 404,
  refused: 403,
  conflict: 409,
  in_use: 409,
  invalid: 400,
  error: 500,
}

export function failureResponse(result: BudgetFail, where: string): NextResponse {
  if (result.kind === "disabled") return NextResponse.json(NOT_ENABLED_BODY, { status: 404, headers: noStore })
  if (result.kind === "error") {
    console.error(`[api/agency/budget] ${where}`, { code: result.code, message: result.message })
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStore })
  }
  return NextResponse.json({ error: result.message, code: result.code }, { status: STATUS[result.kind], headers: noStore })
}

export function budgetResponse<T>(result: BudgetResult<T>, key: string, where: string, okStatus = 200): NextResponse {
  if (!result.ok) return failureResponse(result, where)
  return NextResponse.json({ [key]: result.data }, { status: okStatus, headers: noStore })
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null)
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

export function serverError(where: string, e: unknown): NextResponse {
  console.error(`[api/agency/budget] ${where}`, e)
  return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStore })
}

export const includeArchived = (req: Request) => new URL(req.url).searchParams.get("include_archived") === "1"
