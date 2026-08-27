"use client"

/**
 * WHO WORKED ON THIS PROJECT. The contributors, alongside the point person.
 *
 * ---------------------------------------------------------------------------
 * THIS COMPONENT CALLS A COLUMN THAT MIGRATION 098 ADDS, AND 098 IS AUTHORED BUT
 * NOT YET APPLIED. That is expected. Until Greg runs
 * supabase/migrations/098_project_roles_and_vendor_tags.sql this section renders
 * a red box naming the missing object.
 *
 * >>> THERE IS DELIBERATELY NO FALLBACK PATH, AND NONE MAY BE ADDED. <<<
 *
 * The 082 fallback blocks are this repository's own cautionary tale: a fallback
 * that fires silently returns a wrong answer instead of an error. Falling back to
 * "no contributors" when the column is missing would render an empty list that
 * looks exactly like a project nobody worked on.
 *
 *   42703  column project_leads.role does not exist  -> 098 not applied
 *   42P01  relation "public.project_leads" ...       -> 097 not applied
 *
 * ---------------------------------------------------------------------------
 * WHICH TAG THIS IS. Greg ruled TWO DIFFERENT TAGS (R1), and they are not
 * interchangeable:
 *
 *   HERE, on a project, tagging a colleague says they WORKED ON THAT WORK.
 *
 *   On a vendor profile, tagging a colleague says they OWN THAT VENDOR
 *   RELATIONSHIP. That is `partnership_owners`, and it is
 *   components/partnership-owner-picker.tsx.
 *
 * ---------------------------------------------------------------------------
 * ONE TABLE, TWO CLAIMS, AND WHY THE INTERFACE MUST NOT BLUR THEM.
 *
 * Greg's ruling R2: the work tag SHARES project_leads rather than getting its own
 * table, and THE POINT PERSON IS SIMPLY THE CONTRIBUTOR MARKED LEAD. The rows sit
 * in one table and differ only by `role`.
 *
 * That is exactly why this renders as its own section with its own heading and its
 * own icon, BELOW the point person rather than merged into one list. "Dana runs
 * this project" and "Dana worked on this project" are different claims with
 * different consequences, and a single undifferentiated list of names would state
 * neither. The point person keeps the Select that hands the role over; contributors
 * are a plain list that only grows.
 *
 * ---------------------------------------------------------------------------
 * ADD-ONLY, AND WHY THERE IS NO REMOVE CONTROL.
 *
 * Greg's ruling R3. 098 narrows project_leads_org_update to role = 'lead', so a
 * contributor row cannot be UPDATEd, and there is no DELETE policy on the table for
 * anybody. A remove control would call something the database refuses - and RLS
 * refuses by matching zero rows and REPORTING SUCCESS, so the row would vanish from
 * the screen and still be there on reload.
 *
 * ---------------------------------------------------------------------------
 * WHY CONTRIBUTOR ROWS ARE NOT FILTERED ON ended_at.
 *
 * Only set_project_lead() closes rows, and 098 scopes it to role = 'lead'. Nothing
 * else may UPDATE a contributor row. So a contributor row is always open, and a
 * `.is("ended_at", null)` filter here would be a predicate that is always true -
 * until the day something closes one, when it would SILENTLY HIDE the row instead
 * of showing a fact that had changed. Every contributor row for the project is
 * listed.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE ORGANIZATION COMES FROM. resolveActingOrgId(user.id, supabase). NO
 * ORGANIZATION ID IS DERIVED FROM A USER ID ANYWHERE HERE. Sixteen accounts in this
 * database have organizations.id EQUAL TO profiles.id from the 079 backfill, which
 * makes that confusion invisible in Greg's own testing and broken for everybody
 * else.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Users, Check } from "lucide-react"
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

/** PostgREST codes that mean a migration has not been applied. Surfaced, never swallowed. */
const UNDEFINED_TABLE = "42P01"
const UNDEFINED_COLUMN = "42703"
const MISSING_097 =
  "Project contributors need migration 097, which has not been applied to this database yet."
const MISSING_098 =
  "Project contributors need migration 098, which has not been applied to this database yet."

/** 097's guard: the person named is not on the organization that owns the project. */
const NOT_ON_TEAM = "LG010"

type Member = {
  userId: string
  name: string
  isYou: boolean
}

type Contributor = {
  rowId: string
  userId: string
  name: string
  startedAt: string | null
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
 * the same reason. The ids that reach here are PEOPLE: org_members.user_id and
 * project_leads.user_id, both foreign keys to profiles(id). Nothing in this scope
 * holds an organization id, which is 079's whole defect class and is invisible in
 * testing because the backfill gave sixteen organizations their founder's id.
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
    console.error("[project-contributor-picker] profile read failed", {
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

export function ProjectContributorPicker({ projectId }: { projectId: string }) {
  /**
   * LOADING IS DERIVED, NOT STORED. `loadedFor` is the project this component has
   * actually finished loading; anything else means whatever is in state belongs to a
   * different project and must not be rendered.
   */
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [members, setMembers] = useState<Member[]>([])
  const [contributors, setContributors] = useState<Contributor[]>([])
  const [openLeadUserId, setOpenLeadUserId] = useState<string | null>(null)
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

      // Every row for this project, both roles, in ONE read. The lead is needed here
      // only to keep it out of the "add a contributor" list - see `addable` below.
      const [memberResult, rowResult] = await Promise.all([
        supabase.from("org_members").select("user_id").eq("org_id", acting.orgId),
        supabase
          .from("project_leads")
          .select("id, user_id, role, started_at, ended_at")
          .eq("project_id", projectId)
          .order("started_at", { ascending: true }),
      ])

      if (cancelled) return

      // 097 / 098 NOT APPLIED. Loud, named, and not worked around.
      if (rowResult.error?.code === UNDEFINED_TABLE) {
        console.error(
          "[project-contributor-picker] project_leads does not exist - migration 097 is not applied"
        )
        setLoadError(MISSING_097)
        setLoadedFor(projectId)
        return
      }
      if (rowResult.error?.code === UNDEFINED_COLUMN) {
        console.error(
          "[project-contributor-picker] project_leads.role does not exist - migration 098 is not applied"
        )
        setLoadError(MISSING_098)
        setLoadedFor(projectId)
        return
      }
      if (rowResult.error) {
        console.error("[project-contributor-picker] contributor read failed", {
          projectId,
          code: rowResult.error.code,
          message: rowResult.error.message,
        })
        setLoadError("Could not load contributors. Please retry.")
        setLoadedFor(projectId)
        return
      }
      if (memberResult.error) {
        console.error("[project-contributor-picker] roster read failed", {
          orgId: acting.orgId,
          code: memberResult.error.code,
          message: memberResult.error.message,
        })
        setLoadError("Could not load your team. Please retry.")
        setLoadedFor(projectId)
        return
      }

      const rows = (rowResult.data ?? []) as Array<{
        id: string
        user_id: string | null
        role: string | null
        started_at: string | null
        ended_at: string | null
      }>

      const contributorRows = rows.filter((r) => r.role === "contributor" && r.user_id)
      const openLead = rows.find((r) => r.role === "lead" && r.ended_at === null) ?? null

      const memberIds = ((memberResult.data ?? []) as Array<{ user_id: string }>)
        .map((r) => r.user_id)
        .filter(Boolean)

      // Contributors are fetched by name even when they have since left the
      // organization, so a past colleague reads as a name rather than a bare uuid.
      const wanted = Array.from(
        new Set([
          ...memberIds,
          ...contributorRows.map((r) => r.user_id).filter((v): v is string => typeof v === "string"),
        ])
      )
      const labels = await loadDisplayNames(supabase, wanted)

      // Deduplicate by user id, per the house rule. project_leads carries NO unique
      // constraint on (project_id, user_id, role) - the partial index covers only
      // open leads - so a duplicate contributor row is genuinely possible here and
      // this is the only thing preventing it from rendering twice.
      const seenContrib = new Set<string>()
      const contributorList: Contributor[] = []
      for (const r of contributorRows) {
        const uid = r.user_id as string
        if (seenContrib.has(uid)) continue
        seenContrib.add(uid)
        contributorList.push({
          rowId: r.id,
          userId: uid,
          name: labels.get(uid) ?? "Unnamed member",
          startedAt: r.started_at,
          isYou: uid === user.id,
        })
      }

      const seenMember = new Set<string>()
      const roster: Member[] = []
      for (const id of memberIds) {
        if (seenMember.has(id)) continue
        seenMember.add(id)
        roster.push({ userId: id, name: labels.get(id) ?? "Unnamed member", isYou: id === user.id })
      }
      roster.sort((a, b) => a.name.localeCompare(b.name))

      if (cancelled) return
      setMembers(roster)
      setContributors(contributorList)
      setOpenLeadUserId(openLead?.user_id ?? null)
      setLoadError(null)
      setLoadedFor(projectId)
    }

    load().catch((err) => {
      if (cancelled) return
      console.error("[project-contributor-picker] load threw", err)
      setLoadError("Could not load contributors. Please retry.")
      setLoadedFor(projectId)
    })

    return () => {
      cancelled = true
    }
  }, [projectId, refreshKey])

  /**
   * Colleagues who are not already listed, and NOT THE STANDING POINT PERSON.
   *
   * THE LEAD IS EXCLUDED DELIBERATELY, AND THIS IS A UI DECISION RATHER THAN A DATA
   * RULE. R2 says the point person IS the contributor marked lead, so while somebody
   * holds the lead they are already making the "worked on this" claim and a second
   * row for them would read as a duplicate of the section directly above. The
   * database permits both rows - the partial unique index covers only open leads -
   * so nothing is lost: once the lead is handed over, that person becomes addable
   * here and their contribution can be recorded explicitly.
   */
  const addable = useMemo(() => {
    const taken = new Set(contributors.map((c) => c.userId))
    return members.filter((m) => !taken.has(m.userId) && m.userId !== openLeadUserId)
  }, [members, contributors, openLeadUserId])

  const handleAdd = useCallback(
    async (userId: string) => {
      if (saving || !userId) return
      setSaving(true)
      setSaveError(null)
      setJustSaved(false)
      try {
        const supabase = createClient()

        // A PLAIN INSERT, NOT AN RPC, AND THAT IS THE POINT OF 098's 1(d).
        // project_leads_org_insert already admits this row: its predicate scopes on
        // project_id and says nothing about role, so any member of the owning
        // organization can add a contributor without a new policy. The membership of
        // the person named is enforced by 097's trigger, which raises LG010.
        const { error } = await supabase.from("project_leads").insert({
          project_id: projectId,
          user_id: userId,
          role: "contributor",
        })

        if (error) {
          if (error.code === UNDEFINED_TABLE) {
            console.error(
              "[project-contributor-picker] project_leads does not exist - migration 097 is not applied"
            )
            setSaveError(MISSING_097)
          } else if (error.code === UNDEFINED_COLUMN) {
            console.error(
              "[project-contributor-picker] project_leads.role does not exist - migration 098 is not applied"
            )
            setSaveError(MISSING_098)
          } else if (error.code === NOT_ON_TEAM) {
            // The guard's message is written to be read by a person.
            setSaveError(error.message || "That person is not on your team.")
          } else {
            console.error("[project-contributor-picker] insert failed", {
              projectId,
              code: error.code,
              message: error.message,
            })
            setSaveError(error.message || "Could not add that contributor.")
          }
          return
        }

        setJustSaved(true)
        setRefreshKey((k) => k + 1)
      } catch (err) {
        console.error("[project-contributor-picker] insert threw", err)
        setSaveError("Could not add that contributor.")
      } finally {
        setSaving(false)
      }
    },
    [projectId, saving]
  )

  // House rule: never render an empty or error state during hydration.
  if (loadedFor !== projectId) {
    return (
      <div className="space-y-2">
        <Label className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
          Contributors
        </Label>
        <div className="flex items-center gap-2 text-sm text-foreground-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading contributors...
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-2">
        <Label className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
          Contributors
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
        Contributors
      </Label>

      {/* THE HONEST EMPTY STATE, per the 086 precedent. It also states the
          distinction from the point person above, because that is the one thing a
          reader of these two adjacent sections could get wrong. */}
      {contributors.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          Nobody is listed as having worked on this project yet. This is a separate record
          from the point person above - it says who did the work, not who runs it.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {contributors.map((c) => (
            <li key={c.rowId} className="text-sm text-foreground">
              <span className="font-display font-bold">{c.name}</span>
              {c.isYou ? <span className="text-foreground-muted"> (you)</span> : null}
              {c.startedAt && (
                <span className="text-foreground-muted"> - added {formatDateTime(c.startedAt)}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {addable.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          {members.length === 0
            ? "There is nobody in your organization to add yet."
            : "Everybody on your team is already listed here or is the point person."}
        </p>
      ) : (
        <Select value="" onValueChange={handleAdd} disabled={saving}>
          <SelectTrigger className="bg-white/5 border-border text-foreground">
            <SelectValue placeholder="Add a contributor" />
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
        <Users className="w-3 h-3 shrink-0" />
        This list is add-only. Contributors stay on the record once added, and the point
        person above is handed over rather than edited.
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
          Contributor added
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
