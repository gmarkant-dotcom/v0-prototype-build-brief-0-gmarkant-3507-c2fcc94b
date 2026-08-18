/**
 * The shape of the broadcast-cue marker, and the one predicate that reads it.
 *
 * SEPARATE FROM lib/broadcast-partnership-cue.ts ON PURPOSE. That module is server-side: it
 * writes rows and it reads process.env for the feature flag. This predicate is needed by
 * app/partner/network/page.tsx, which is a client component, and importing the writer there
 * would pull a server module and an env read into the browser bundle to get one boolean.
 *
 * Nothing here imports anything. It is a type and a type guard.
 */

/** Written into the existing partnership_notes jsonb (migration 068's namespace). */
export type BroadcastCueNote = {
  at: string
  project_id: string | null
  scope_item_name: string | null
}

/**
 * Does this partnerships row exist because somebody broadcast an RFP, rather than because an
 * agency chose to invite this vendor?
 *
 * Read from the row's own notes so no caller re-derives it, and deliberately NOT inferred
 * from `invitation_sent_at IS NULL`. Those two agree today, but a null invitation_sent_at
 * also describes a Discovered pool row that predates this feature entirely, and reading one
 * fact off another's absence is how the two drift.
 */
export function wasCuedByBroadcast(partnershipNotes: unknown): boolean {
  if (!partnershipNotes || typeof partnershipNotes !== "object") return false
  return Boolean((partnershipNotes as { cued_by_broadcast?: unknown }).cued_by_broadcast)
}
