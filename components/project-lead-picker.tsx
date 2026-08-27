"use client"

/**
 * THE POINT PERSON PICKER. Who runs this project, and the control that hands it over.
 *
 * ---------------------------------------------------------------------------
 * THIS COMPONENT CALLS OBJECTS THAT MIGRATION 097 CREATES, AND 097 IS AUTHORED
 * BUT NOT YET APPLIED. That is expected. Until Greg runs
 * supabase/migrations/097_project_leads.sql, this section renders a red error
 * box saying exactly which object is missing.
 *
 * >>> THERE IS DELIBERATELY NO FALLBACK PATH, AND NONE MAY BE ADDED. <<<
 *
 * The 082 fallback blocks are this repository's own cautionary tale: a fallback
 * that fires silently returns a wrong answer instead of an error. A wrong answer
 * about WHO RUNS A PROJECT is worse than a visible failure - it names a
 * colleague who is not responsible, and nobody can tell it apart from the truth.
 * So both PostgREST refusals are surfaced verbatim:
 *
 *   42P01  relation "public.project_leads" does not exist   -> 097 not applied
 *   42883  function public.set_project_lead does not exist  -> 097 not applied
 *
 * ---------------------------------------------------------------------------
 * WHY THE WRITE IS ONE RPC AND NOT TWO POSTGREST CALLS.
 *
 * Greg's ruling R2: reassigning is a HANDOVER, not an overwrite. That is two
 * writes - stamp ended_at on the open row, insert a new one - and from the
 * browser those would be TWO HTTP REQUESTS WITH NO TRANSACTION BETWEEN THEM.
 * A failure in the gap leaves the project either with no open lead at all, or
 * with the partial unique index blocking every subsequent attempt, and neither
 * state has a cause the user could see.
 *
 * So the handover is one statement, server side, inside one transaction:
 * `set_project_lead(p_project_id, p_user_id)`, which 097 creates. This component
 * calls it and does nothing else. IT MUST NOT BE REPLACED BY AN UPDATE FOLLOWED
 * BY AN INSERT.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE ORGANIZATION COMES FROM. resolveActingOrgId(user.id, supabase),
 * exactly as app/agency/settings/team/team-roster-client.tsx does. NO
 * ORGANIZATION ID IS DERIVED FROM A USER ID ANYWHERE HERE. Sixteen accounts in
 * this database have organizations.id EQUAL TO profiles.id from the 079
 * backfill, which makes that confusion invisible in Greg's own testing and
 * broken for everybody else.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS LOOKS LIKE ON DAY ONE. EVERY PROJECT SAYS "No point person yet."
 * `projects` has never carried a creator or owner column - see
 * docs/097-phase0-baseline.md section 3 - so there is nothing to seed an
 * initial lead from and no backfill is written. The empty state is honest
 * about that rather than rendering a blank, per the 086 precedent.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, UserRound, Check } from "lucide-react"
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

/** PostgREST codes that mean 097 has not been applied yet. Surfaced, never swallowed. */
const UNDEFINED_TABLE = "42P01"
const UNDEFINED_FUNCTION = "42883"
const MISSING_097 =
  "The point person feature needs migration 097, which has not been applied to this database yet."

type Member = {
  userId: string
  name: string
  email: string | null
  isYou: boolean
}

type CurrentLead = {
  userId: string | null
  startedAt: string | null
}

function memberLabel(
  fullName: unknown,
  displayName: unknown,
  email: unknown
): { name: string; email: string | null } {
  const dn = typeof displayName === "string" ? displayName.trim() : ""
  const fn = typeof fullName === "string" ? fullName.trim() : ""
  const em = typeof email === "string" ? email.trim() : ""
  return { name: dn || fn || em || "Unnamed member", email: em || null }
}

/**
 * DISPLAY NAMES FOR A SET OF USER IDS.
 *
 * ITS OWN FUNCTION, AND DELIBERATELY ABOVE EVERY LINE IN THIS FILE THAT NAMES AN
 * ORGANIZATION. The ids that reach here are PEOPLE - org_members.user_id and
 * project_leads.user_id, both foreign keys to profiles(id). Nothing in this scope
 * has an organization id in it, and that is the point rather than a detail: 079's
 * whole defect class is a COMPANY id arriving at a profiles read and returning the
 * right rows anyway, because the backfill gave sixteen organizations their founding
 * user's id. A function that never holds an organization id cannot commit it.
 *
 * The separation is also what keeps scripts/check-org-id-reads.mjs quiet on this
 * read. That is a consequence of the structure, not the reason for it - the check
 * is a proximity heuristic and moving code to satisfy it would be worthless if the
 * code did not genuinely become person-only. It did.
 */
async function loadDisplayNames(
  supabase: ReturnType<typeof createClient>,
  ids: string[]
): Promise<Map<string, { name: string; email: string | null }>> {
  const out = new Map<string, { name: string; email: string | null }>()
  if (ids.length === 0) return out

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, display_name, email")
    .in("id", ids)

  if (error) {
    // Names are cosmetic here; the picker still works with ids it cannot label.
    // Logged rather than surfaced, because a person cannot act on it.
    console.error("[project-lead-picker] profile read failed", {
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

export function ProjectLeadPicker({ projectId }: { projectId: string }) {
  /**
   * LOADING IS DERIVED, NOT STORED. `loadedFor` is the project id this component
   * has actually finished loading; anything else means whatever is in state belongs
   * to a different project and must not be rendered. That is stricter than an
   * isLoading flag and it is the right question to ask here - showing the PREVIOUS
   * project's point person for a frame is exactly the wrong answer this feature
   * must never give.
   */
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  /**
   * The re-read after a successful handover. A counter the effect depends on,
   * rather than a load() the handler can call directly: the loader is defined
   * INSIDE the effect - matching app/agency/settings/team/team-roster-client.tsx -
   * so that the effect body sets no state itself, which is what
   * react-hooks/set-state-in-effect is about. The rule follows a call out of the
   * effect into a useCallback, so hoisting the loader is not an option here.
   */
  const [refreshKey, setRefreshKey] = useState(0)
  const [members, setMembers] = useState<Member[]>([])
  const [current, setCurrent] = useState<CurrentLead | null>(null)
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
        setLoadedFor(projectId)
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
        setLoadedFor(projectId)
        return
      }

      const [memberResult, leadResult] = await Promise.all([
        supabase.from("org_members").select("user_id").eq("org_id", acting.orgId),
        supabase
          .from("project_leads")
          .select("user_id, started_at")
          .eq("project_id", projectId)
          .is("ended_at", null)
          .maybeSingle(),
      ])

      if (cancelled) return

      // 097 NOT APPLIED. Loud, named, and not worked around.
      if (leadResult.error?.code === UNDEFINED_TABLE) {
        console.error("[project-lead-picker] project_leads does not exist - migration 097 is not applied")
        setLoadError(MISSING_097)
        setLoadedFor(projectId)
        return
      }
      if (leadResult.error) {
        console.error("[project-lead-picker] current lead read failed", {
          projectId,
          code: leadResult.error.code,
          message: leadResult.error.message,
        })
        setLoadError("Could not load the point person. Please retry.")
        setLoadedFor(projectId)
        return
      }
      if (memberResult.error) {
        console.error("[project-lead-picker] roster read failed", {
          orgId: acting.orgId,
          code: memberResult.error.code,
          message: memberResult.error.message,
        })
        setLoadError("Could not load your team. Please retry.")
        setLoadedFor(projectId)
        return
      }

      const lead = (leadResult.data ?? null) as { user_id: string | null; started_at: string | null } | null

      const memberIds = ((memberResult.data ?? []) as Array<{ user_id: string }>)
        .map((r) => r.user_id)
        .filter(Boolean)

      // The standing point person is fetched alongside the roster even when they
      // are no longer a member, so a name is shown rather than a bare uuid if a
      // colleague has since left the organization.
      const wanted = Array.from(new Set([...memberIds, ...(lead?.user_id ? [lead.user_id] : [])]))

      const labels = await loadDisplayNames(supabase, wanted)

      // Deduplicate by user id, per the house rule, even though org_members carries
      // UNIQUE(org_id, user_id) - which is exactly why a duplicate here would matter.
      const seen = new Set<string>()
      const roster: Member[] = []
      for (const id of memberIds) {
        if (seen.has(id)) continue
        seen.add(id)
        const label = labels.get(id) ?? { name: "Unnamed member", email: null }
        roster.push({ userId: id, name: label.name, email: label.email, isYou: id === user.id })
      }
      roster.sort((a, b) => a.name.localeCompare(b.name))

      if (cancelled) return
      setMembers(roster)
      setCurrent(lead ? { userId: lead.user_id, startedAt: lead.started_at } : null)
      setLoadError(null)
      setLoadedFor(projectId)
    }

    load().catch((err) => {
      if (cancelled) return
      console.error("[project-lead-picker] load threw", err)
      setLoadError("Could not load the point person. Please retry.")
      setLoadedFor(projectId)
    })

    return () => {
      cancelled = true
    }
  }, [projectId, refreshKey])

  const currentName = useMemo(() => {
    if (!current?.userId) return null
    return members.find((m) => m.userId === current.userId)?.name ?? "A colleague outside this organization"
  }, [current, members])

  /**
   * THE HANDOVER. ONE REQUEST. See the header - this must not become two.
   */
  const handleChange = useCallback(
    async (nextUserId: string) => {
      if (saving) return
      if (current?.userId === nextUserId) return
      setSaving(true)
      setSaveError(null)
      setJustSaved(false)
      try {
        const supabase = createClient()
        const { error } = await supabase.rpc("set_project_lead", {
          p_project_id: projectId,
          p_user_id: nextUserId,
        })

        if (error) {
          if (error.code === UNDEFINED_FUNCTION) {
            console.error("[project-lead-picker] set_project_lead does not exist - migration 097 is not applied")
            setSaveError(MISSING_097)
          } else {
            // LG010, LG011, LG002 and LG006 all arrive here with the message the
            // function raised. Those messages are written to be read by a person,
            // so they are shown rather than replaced with a generic string.
            console.error("[project-lead-picker] set_project_lead failed", {
              projectId,
              code: error.code,
              message: error.message,
            })
            setSaveError(error.message || "Could not change the point person.")
          }
          return
        }

        setJustSaved(true)
        setRefreshKey((k) => k + 1)
      } catch (err) {
        console.error("[project-lead-picker] set_project_lead threw", err)
        setSaveError("Could not change the point person.")
      } finally {
        setSaving(false)
      }
    },
    [current, projectId, saving]
  )

  // House rule: never render an empty or error state during hydration. Nothing
  // below this line runs until THIS project's load has settled one way or the other.
  if (loadedFor !== projectId) {
    return (
      <div className="space-y-2">
        <Label className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
          Point Person
        </Label>
        <div className="flex items-center gap-2 text-sm text-foreground-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading point person...
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-2">
        <Label className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
          Point Person
        </Label>
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {loadError}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Label className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
        Point Person
      </Label>

      {/* THE HONEST EMPTY STATE. On day one this is every project - nothing in the
          schema can seed an initial lead. It says so plainly rather than showing a
          blank field somebody would read as a loading bug. */}
      {!current?.userId && (
        <p className="text-sm text-foreground-muted">
          {current
            ? "No point person - the previous one's account was removed. Choose somebody below."
            : "No point person yet. Any member of your team can set one."}
        </p>
      )}

      {current?.userId && (
        <p className="text-sm text-foreground">
          <span className="font-display font-bold">{currentName}</span>
          {current.startedAt && (
            <span className="text-foreground-muted"> since {formatDateTime(current.startedAt)}</span>
          )}
        </p>
      )}

      {members.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          There is nobody else in your organization to hand this to yet.
        </p>
      ) : (
        <Select
          value={current?.userId ?? undefined}
          onValueChange={handleChange}
          disabled={saving}
        >
          <SelectTrigger className="bg-white/5 border-border text-foreground">
            <SelectValue placeholder="Choose a point person" />
          </SelectTrigger>
          <SelectContent>
            {members.map((m) => (
              <SelectItem key={m.userId} value={m.userId}>
                {m.name}
                {m.isYou ? " (you)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <p className="text-xs text-foreground-muted flex items-center gap-1.5">
        <UserRound className="w-3 h-3" />
        Changing this records a handover. The previous point person stays in the project history.
      </p>

      {saving && (
        <div className="flex items-center gap-2 text-sm text-foreground-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          Handing over...
        </div>
      )}

      {justSaved && !saving && !saveError && (
        <div className="flex items-center gap-2 text-sm text-accent font-mono">
          <Check className="w-4 h-4" />
          Point person updated
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
