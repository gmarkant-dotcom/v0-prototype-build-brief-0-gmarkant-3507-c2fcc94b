import type { SupabaseClient } from "@supabase/supabase-js"
import type { OrgId } from "@/lib/entitlements"

/**
 * The one place projects.client_id and projects.client_name are reconciled.
 *
 * THE RULING: the client belongs to the master project. A project has exactly one client, and
 * client_id and client_name may never disagree. Setting either one reconciles the other.
 *
 * Why this exists: the broadcast wizard wrote client_id onto a project whose client_name said
 * something else, and the row became internally incoherent - onboarding then correctly rendered
 * one client's documents for a project labelled another. The scoping was right; the write was
 * not. Rather than fix that one caller, the invariant lives here so no future writer can
 * reintroduce it.
 *
 * Server-only, and named with the -server suffix following the precedent set by
 * lib/rfp-evaluation-criteria-server.ts. It takes a SupabaseClient and reads the clients table,
 * which a client component must never do. lib/clients.ts stays the shared, bundle-safe half.
 *
 * Deliberately NOT a database CHECK or trigger. See the report for that argument.
 */

export type ProjectClientFields = {
  client_id: string | null
  client_name: string | null
}

export type ReconcileInput = {
  /** Present in the payload at all, even as null. Absent means "this writer said nothing". */
  hasClientId: boolean
  clientId: string | null
  hasClientName: boolean
  clientName: string | null
}

export type ReconcileResult =
  | { ok: true; fields: Partial<ProjectClientFields> }
  | { ok: false; error: string; status: number; code?: string }

/** Machine-readable reason a creation path refused for want of a client profile. A caller that
 *  can offer the user a way to supply one (the duplicate flow) keys on this, not on the text. */
export const CLIENT_PROFILE_REQUIRED_CODE = "client_required"
const CLIENT_PROFILE_REQUIRED_MESSAGE = "A project needs a client profile. Select one or create a new client profile."
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolves what a writer should actually persist.
 *
 *   client_id set        -> client_name is overwritten from that client's own name. The entity
 *                           is the source of truth whenever there is one.
 *   client_id cleared    -> client_name is left exactly as it is. Clearing the link does not
 *                           erase the typed string the project has always had.
 *   client_name alone    -> written as given, client_id untouched. A typed name never invents a
 *                           profile, per the standing ruling.
 *
 * Ownership is verified before any client_id is accepted, so a profile belonging to another
 * agency can never be attached.
 */
/**
 * 079 PARAMETER CLASS: `orgIds` is the CALLER'S OWN organizations, from
 * resolveCallerOrgIds() - never a counterparty or visibility set. It replaces a single
 * parameter that callers filled with `user.id`, comparing an organization column to a
 * user id. `.in()` on an empty array matches nothing, so a caller with no membership
 * fails closed rather than silently reading another organization's rows.
 */
export async function reconcileProjectClientFields(
  supabase: SupabaseClient,
  orgIds: readonly OrgId[],
  input: ReconcileInput
): Promise<ReconcileResult> {
  const fields: Partial<ProjectClientFields> = {}

  if (input.hasClientId) {
    const clientId = typeof input.clientId === "string" && input.clientId.trim() ? input.clientId.trim() : null

    if (!clientId) {
      // Clearing the entity link. client_name is deliberately untouched: the project keeps
      // whatever string it carried, which is what makes clearing a safe, non-destructive undo.
      fields.client_id = null
      if (input.hasClientName) fields.client_name = normalizeName(input.clientName)
      return { ok: true, fields }
    }

    const { data: owned, error } = await supabase
      .from("clients")
      .select("id, name")
      .eq("id", clientId)
      .in("org_id", orgIds)
      .maybeSingle()

    if (error) {
      console.error("[clients-server] client ownership lookup failed", { message: error.message, code: error.code })
      return { ok: false, error: "Could not verify that client profile", status: 500 }
    }
    if (!owned) {
      return { ok: false, error: "Unknown client profile", status: 400 }
    }

    fields.client_id = clientId
    // The entity wins. A caller that sent a conflicting client_name does not get to keep it -
    // that disagreement is the exact defect this function exists to prevent.
    fields.client_name = (owned.name as string) ?? null
    return { ok: true, fields }
  }

  if (input.hasClientName) {
    fields.client_name = normalizeName(input.clientName)
  }
  return { ok: true, fields }
}

/**
 * THE RULING (2026-10-08): a project REQUIRES a client profile. This is the gate every path that
 * CREATES a project row goes through. It lives at the creation paths, not in the database: the
 * column stays nullable because existing projects are unfiled and must keep reading.
 *
 * The identifier is a CLAIM, never a grant. A missing or malformed value is refused as
 * "required"; a well-formed one is verified against `orgIds` before it is believed. For a
 * creation, pass ONLY the organization the new project will be attributed to
 * (resolveCallerWriteOrgId), not every organization the caller can read, so a project cannot be
 * created in one organization under another organization's client.
 *
 * A typed client_name is NOT accepted in place of a profile. On success both fields are set and
 * client_name is the profile's own name.
 */
export async function resolveRequiredProjectClient(
  supabase: SupabaseClient,
  orgIds: readonly OrgId[],
  rawClientId: unknown
): Promise<ReconcileResult> {
  const clientId = typeof rawClientId === "string" ? rawClientId.trim() : ""
  if (!clientId) {
    return { ok: false, error: CLIENT_PROFILE_REQUIRED_MESSAGE, status: 400, code: CLIENT_PROFILE_REQUIRED_CODE }
  }
  if (!UUID_SHAPE.test(clientId)) {
    return { ok: false, error: "Unknown client profile", status: 400 }
  }
  return reconcileProjectClientFields(supabase, orgIds, {
    hasClientId: true,
    clientId,
    hasClientName: false,
    clientName: null,
  })
}

function normalizeName(value: string | null): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}
