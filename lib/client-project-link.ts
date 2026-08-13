/**
 * ITEM 1. Persisting the client entity onto the project a flow is running against.
 *
 * Migration 077 added projects.client_id, but until now the ONLY writer was the
 * "+ New project" dialog. The RFP broadcast wizard and the magic-link flow both operate on an
 * already-selected project and never wrote it, so no project in the database carried a client_id
 * - which made the client-scoped document group shipped for onboarding unreachable code.
 *
 * The rules, unchanged from the ruling:
 *   - a SELECTED profile writes client_id, and client_name stays populated alongside it
 *   - a TYPED name writes client_name with client_id null, and never creates a profile
 *   - clearing a selection back to a typed name clears client_id
 *
 * Failure is deliberately soft. Naming a client on an RFP is not the same act as editing the
 * project record, and a failed link must not block a broadcast. The caller logs and continues.
 */
export async function persistProjectClientLink(
  projectId: string | null | undefined,
  clientId: string | null
): Promise<{ ok: boolean; error: string | null }> {
  if (!projectId) return { ok: false, error: "no project selected" }
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ client_id: clientId }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: false, error: (data?.error as string) || `HTTP ${res.status}` }
    }
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
