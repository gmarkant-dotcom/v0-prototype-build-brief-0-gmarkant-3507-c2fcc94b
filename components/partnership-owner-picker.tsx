"use client"

/**
 * WHO OWNS THIS VENDOR RELATIONSHIP.
 *
 * ---------------------------------------------------------------------------
 * THIS COMPONENT CALLS A TABLE THAT MIGRATION 098 CREATES, AND 098 IS AUTHORED
 * BUT NOT YET APPLIED. That is expected. Until Greg runs
 * supabase/migrations/098_project_roles_and_vendor_tags.sql this section renders
 * a red box naming the missing object.
 *
 * >>> THERE IS DELIBERATELY NO FALLBACK PATH, AND NONE MAY BE ADDED. <<<
 *
 * The 082 fallback blocks are this repository's own cautionary tale: a fallback
 * that fires silently returns a wrong answer instead of an error. A wrong answer
 * about WHO OWNS A VENDOR RELATIONSHIP names a colleague who is not accountable
 * for it, and nobody can tell it apart from the truth.
 *
 *   42P01  relation "public.partnership_owners" does not exist -> 098 not applied
 *
 * ---------------------------------------------------------------------------
 * WHICH TAG THIS IS. Greg ruled TWO DIFFERENT TAGS (R1), and they are not
 * interchangeable:
 *
 *   HERE, on a vendor profile, tagging a colleague says they OWN THAT VENDOR
 *   RELATIONSHIP. It points at `partnerships`.
 *
 *   On a project, tagging a colleague says they WORKED ON THAT WORK. That is
 *   `project_leads` with a role, and it is components/project-contributor-picker.tsx.
 *
 * This component must never be reused on a project surface. The row it writes
 * means something else.
 *
 * ---------------------------------------------------------------------------
 * IT TAKES A PARTNERSHIP ID, NOT THE ROUTE'S [partnerId].
 *
 * The [partnerId] route param on this page is a VENDOR ORGANIZATION id, not a
 * partnership id - the same distinction VendorPerformanceHistory already makes by
 * taking both separately. `partnership_owners.partnership_id` is a foreign key to
 * `partnerships(id)`, so passing the route param would raise 23503 on every
 * insert. The caller passes `profile.partnership.id`.
 *
 * ---------------------------------------------------------------------------
 * ADD-ONLY, AND WHY THERE IS NO REMOVE CONTROL.
 *
 * Greg's ruling R3. There is no UPDATE policy and no DELETE policy on
 * partnership_owners for anybody, so a remove control would call something the
 * database refuses - and RLS refuses a DELETE by matching zero rows and
 * REPORTING SUCCESS, which would render as a row that vanishes from the screen
 * and is still there on reload. The interface says so in one line rather than
 * offering a control that cannot work.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE ORGANIZATION COMES FROM. resolveActingOrgId(user.id, supabase). NO
 * ORGANIZATION ID IS DERIVED FROM A USER ID ANYWHERE HERE. Sixteen accounts in
 * this database have organizations.id EQUAL TO profiles.id from the 079 backfill,
 * which makes that confusion invisible in Greg's own testing and broken for
 * everybody else.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Handshake, Check } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { resolveActingOrgId } from "@/lib/acting-org"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatDateTime } from "@/lib/utils"

/** PostgREST codes that mean 098 has not been applied yet. Surfaced, never swallowed. */
const UNDEFINED_TABLE = "42P01"
const MISSING_098 =
  "Naming who owns a vendor relationship needs migration 098, which has not been applied to this database yet."

/** The guard in 098: the person named is not on the lead organization. */
const NOT_ON_TEAM = "LG012"

type Member = {
  userId: string
  name: string
  isYou: boolean
}

type OwnerRow = {
  userId: string
  name: string
  addedByName: string | null
  addedAt: string | null
  isYou: boolean
}

function memberLabel(fullName: unknown, displayName: unknown, email: unknown): string {
  const dn = typeof displayName === "string" ? displayName.trim() : ""
  const fn = typeof fullName === "string" ? fullName.trim() : ""
  const em = typeof email === "string" ? email.trim() : ""
  return dn || fn || em || "Unnamed member"
}

/**
 * DISPLAY NAMES FOR A SET OF USER IDS.
 *
 * ITS OWN FUNCTION, AND DELIBERATELY ABOVE EVERY LINE IN THIS FILE THAT NAMES AN
 * ORGANIZATION - the same separation components/project-lead-picker.tsx makes, for
 * the same reason. The ids that reach here are PEOPLE: org_members.user_id,
 * partnership_owners.user_id and partnership_owners.added_by, all foreign keys to
 * profiles(id). Nothing in this scope holds an organization id, so this read cannot
 * confuse one for a person - which is 079's whole defect class, and it is invisible
 * in testing because the backfill gave sixteen organizations their founder's id.
 */
async function loadDisplayNames(
  supabase: ReturnType<typeof createClient>,
  ids: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, display_name, email")
    .in("id", ids)

  if (error) {
    // Names are cosmetic here; the list still works with ids it cannot label.
    console.error("[partnership-owner-picker] profile read failed", {
      code: error.code,
      message: error.message,
    })
    return out
  }

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    if (typeof row.id !== "string") continue
    out.set(row.id, memberLabel(row.full_name, row.display_name, row.email))
  }
  return out
}

export function PartnershipOwnerPicker({
  partnershipId,
  partnerName,
}: {
  partnershipId: string
  partnerName?: string
}) {
  /**
   * LOADING IS DERIVED, NOT STORED. `loadedFor` is the partnership this component
   * has actually finished loading; anything else means whatever is in state belongs
   * to a different vendor and must not be rendered. Showing the PREVIOUS vendor's
   * owners for a frame is exactly the wrong answer this feature must never give.
   */
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  /**
   * The re-read after a successful add. A counter the effect depends on, rather than
   * a load() the handler calls directly: the loader is defined INSIDE the effect, so
   * the effect body sets no state itself, which is what react-hooks/set-state-in-effect
   * is about.
   */
  const [refreshKey, setRefreshKey] = useState(0)
  const [members, setMembers] = useState<Member[]>([])
  const [owners, setOwners] = useState<OwnerRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (cancelled) return
      if (!user) {
        setLoadError("You are signed out. Reload the page and sign in again.")
        setLoadedFor(partnershipId)
        return
      }

      // The acting organization. Membership is read from org_members keyed by this
      // user id, and nothing here supplies an organization id.
      const acting = await resolveActingOrgId(user.id, supabase)
      if (cancelled) return
      if (!acting.orgId) {
        setLoadError(
          acting.reason === "ambiguous"
            ? "Your account belongs to more than one organization and none is selected."
            : "Your account is not linked to an organization yet."
        )
        setLoadedFor(partnershipId)
        return
      }

      const [memberResult, ownerResult] = await Promise.all([
        supabase.from("org_members").select("user_id").eq("org_id", acting.orgId),
        supabase
          .from("partnership_owners")
          .select("user_id, added_by, added_at")
          .eq("partnership_id", partnershipId)
          .order("added_at", { ascending: true }),
      ])

      if (cancelled) return

      // 098 NOT APPLIED. Loud, named, and not worked around.
      if (ownerResult.error?.code === UNDEFINED_TABLE) {
        console.error(
          "[partnership-owner-picker] partnership_owners does not exist - migration 098 is not applied"
        )
        setLoadError(MISSING_098)
        setLoadedFor(partnershipId)
        return
      }
      if (ownerResult.error) {
        console.error("[partnership-owner-picker] owner read failed", {
          partnershipId,
          code: ownerResult.error.code,
          message: ownerResult.error.message,
        })
        setLoadError("Could not load who owns this relationship. Please retry.")
        setLoadedFor(partnershipId)
        return
      }
      if (memberResult.error) {
        console.error("[partnership-owner-picker] roster read failed", {
          orgId: acting.orgId,
          code: memberResult.error.code,
          message: memberResult.error.message,
        })
        setLoadError("Could not load your team. Please retry.")
        setLoadedFor(partnershipId)
        return
      }

      const ownerRows = (ownerResult.data ?? []) as Array<{
        user_id: string
        added_by: string | null
        added_at: string | null
      }>
      const memberIds = ((memberResult.data ?? []) as Array<{ user_id: string }>)
        .map((r) => r.user_id)
        .filter(Boolean)

      // Every person named anywhere in this section, including the authors of the
      // claims, so an entry never renders as a bare uuid.
      const wanted = Array.from(
        new Set([
          ...memberIds,
          ...ownerRows.map((r) => r.user_id),
          ...ownerRows.map((r) => r.added_by).filter((v): v is string => typeof v === "string"),
        ])
      )
      const labels = await loadDisplayNames(supabase, wanted)

      // Deduplicate by user id, per the house rule, even though the table carries
      // UNIQUE(partnership_id, user_id) - which is exactly why a duplicate would matter.
      const seenOwner = new Set<string>()
      const ownerList: OwnerRow[] = []
      for (const row of ownerRows) {
        if (!row.user_id || seenOwner.has(row.user_id)) continue
        seenOwner.add(row.user_id)
        ownerList.push({
          userId: row.user_id,
          name: labels.get(row.user_id) ?? "Unnamed member",
          addedByName: row.added_by ? (labels.get(row.added_by) ?? "a colleague") : null,
          addedAt: row.added_at,
          isYou: row.user_id === user.id,
        })
      }

      const seenMember = new Set<string>()
      const roster: Member[] = []
      for (const id of memberIds) {
        if (seenMember.has(id)) continue
        seenMember.add(id)
        roster.push({
          userId: id,
          name: labels.get(id) ?? "Unnamed member",
          isYou: id === user.id,
        })
      }
      roster.sort((a, b) => a.name.localeCompare(b.name))

      if (cancelled) return
      setMembers(roster)
      setOwners(ownerList)
      setLoadError(null)
      setLoadedFor(partnershipId)
    }

    load().catch((err) => {
      if (cancelled) return
      console.error("[partnership-owner-picker] load threw", err)
      setLoadError("Could not load who owns this relationship. Please retry.")
      setLoadedFor(partnershipId)
    })

    return () => {
      cancelled = true
    }
  }, [partnershipId, refreshKey])

  /**
   * Only colleagues who are not already named. The table's UNIQUE constraint would
   * refuse a duplicate with 23505 anyway; filtering the list means a person is never
   * offered a choice that can only fail.
   */
  const addable = useMemo(() => {
    const taken = new Set(owners.map((o) => o.userId))
    return members.filter((m) => !taken.has(m.userId))
  }, [members, owners])

  const handleAdd = useCallback(
    async (userId: string) => {
      if (saving || !userId) return
      setSaving(true)
      setSaveError(null)
      setJustSaved(false)
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          setSaveError("You are signed out. Reload the page and sign in again.")
          return
        }

        // added_by IS NOT DECORATION. 098's INSERT policy requires
        // added_by = auth.uid(), so this value is checked rather than trusted: a
        // caller cannot record somebody else as the author of their own claim.
        const { error } = await supabase.from("partnership_owners").insert({
          partnership_id: partnershipId,
          user_id: userId,
          added_by: user.id,
        })

        if (error) {
          if (error.code === UNDEFINED_TABLE) {
            console.error(
              "[partnership-owner-picker] partnership_owners does not exist - migration 098 is not applied"
            )
            setSaveError(MISSING_098)
          } else if (error.code === NOT_ON_TEAM) {
            // The guard's message is written to be read by a person.
            setSaveError(error.message || "That person is not on your team.")
          } else {
            console.error("[partnership-owner-picker] insert failed", {
              partnershipId,
              code: error.code,
              message: error.message,
            })
            setSaveError(error.message || "Could not add that colleague.")
          }
          return
        }

        setJustSaved(true)
        setRefreshKey((k) => k + 1)
      } catch (err) {
        console.error("[partnership-owner-picker] insert threw", err)
        setSaveError("Could not add that colleague.")
      } finally {
        setSaving(false)
      }
    },
    [partnershipId, saving]
  )

  // House rule: never render an empty or error state during hydration. Nothing below
  // this line runs until THIS partnership's load has settled one way or the other.
  if (loadedFor !== partnershipId) {
    return (
      <div className="space-y-2">
        <Label className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
          Relationship Owners
        </Label>
        <div className="flex items-center gap-2 text-sm text-foreground-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading relationship owners...
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-2">
        <Label className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
          Relationship Owners
        </Label>
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {loadError}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Label className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
        Relationship Owners
      </Label>

      {/* THE HONEST EMPTY STATE, per the 086 precedent. On day one this is every
          vendor - nothing in the schema can seed an owner - so it says that plainly
          rather than showing a blank somebody would read as a loading bug. */}
      {owners.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          Nobody is named as owning this relationship yet. Any member of your team can add
          themselves or a colleague.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {owners.map((o) => (
            <li key={o.userId} className="text-sm text-foreground">
              <span className="font-display font-bold">{o.name}</span>
              {o.isYou ? <span className="text-foreground-muted"> (you)</span> : null}
              {o.addedAt && (
                <span className="text-foreground-muted">
                  {" "}
                  - added by {o.addedByName ?? "a colleague"} on {formatDateTime(o.addedAt)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {addable.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          {members.length === 0
            ? "There is nobody in your organization to name yet."
            : "Everybody on your team is already named here."}
        </p>
      ) : (
        <Select value="" onValueChange={handleAdd} disabled={saving}>
          <SelectTrigger className="bg-white/5 border-border text-foreground">
            <SelectValue placeholder="Add a colleague" />
          </SelectTrigger>
          <SelectContent>
            {addable.map((m) => (
              <SelectItem key={m.userId} value={m.userId}>
                {m.name}
                {m.isYou ? " (you)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* WHY THERE IS NO REMOVE CONTROL, said once, where somebody would look for one. */}
      <p className="text-xs text-foreground-muted flex items-center gap-1.5">
        <Handshake className="w-3 h-3 shrink-0" />
        This list is add-only. Naming somebody here says they own the relationship with{" "}
        {partnerName ? partnerName : "this vendor"}, and entries stay on the record once added.
      </p>

      {saving && (
        <div className="flex items-center gap-2 text-sm text-foreground-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          Adding...
        </div>
      )}

      {justSaved && !saving && !saveError && (
        <div className="flex items-center gap-2 text-sm text-accent font-mono">
          <Check className="w-4 h-4" />
          Relationship owner added
        </div>
      )}

      {saveError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {saveError}
        </div>
      )}
    </div>
  )
}
