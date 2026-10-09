import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveCallerOrgIds, resolveCallerWriteOrgId, type OrgId } from "@/lib/entitlements"
import { fail, ok, type BudgetResult } from "./result"

/**
 * WHO THE CALLER IS, DERIVED FROM THE SESSION AND NOTHING ELSE.
 *
 * SECURITY BOUNDARY:
 *  - `client` is the CALLER'S OWN session client (lib/supabase/server createClient()). Row level
 *    security decides every read and write. No helper in lib/server/budget takes or creates a
 *    service-role client.
 *  - Organization scope comes from org_members for the session user (resolveCallerOrgIds), never
 *    from a request body and never from profiles.active_role, which a vendor can set itself
 *    (docs/roadmap-state.md; 091 leaves it unguarded).
 *  - "Agency of this project" means the project's org_id is one of the caller's own
 *    organizations. A vendor assigned to the project can READ the project row, but its
 *    organization is not the project's, so it fails this gate exactly as 103's policies refuse it.
 */
export type BudgetSession = {
  client: SupabaseClient
  userId: string
  /** The caller's own organizations (authority set). Empty means no access to anything. */
  orgIds: OrgId[]
}

export async function budgetSession(client: SupabaseClient, userId: string): Promise<BudgetSession> {
  const orgIds = await resolveCallerOrgIds(userId, client)
  return { client, userId, orgIds }
}

/** The organization a template write is attributed to: the caller's acting organization, or null. */
export async function budgetWriteOrgId(session: BudgetSession): Promise<OrgId | null> {
  const orgId = await resolveCallerWriteOrgId(session.userId, session.client)
  if (!orgId || !session.orgIds.includes(orgId)) return null
  return orgId
}

export type AgencyProject = { projectId: string; orgId: OrgId }

/**
 * The project gate every project-scoped helper's route runs first. not_found for a project that
 * does not exist, that the caller cannot see, or that the caller can see only as a vendor.
 */
export async function requireAgencyProject(session: BudgetSession, projectId: string): Promise<BudgetResult<AgencyProject>> {
  if (!projectId || session.orgIds.length === 0) return fail("not_found", "Project not found")
  const { data, error } = await session.client
    .from("projects")
    .select("id, org_id")
    .eq("id", projectId)
    .in("org_id", session.orgIds)
    .maybeSingle()
  if (error) return fail("error", error.message, error.code ?? null)
  if (!data) return fail("not_found", "Project not found")
  const row = data as { id: string; org_id: string }
  return ok({ projectId: row.id, orgId: row.org_id as OrgId })
}
