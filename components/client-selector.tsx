"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { NewClientDialog } from "@/components/new-client-dialog"
import { cn } from "@/lib/utils"
import { MOMENTARY_LINK_DARK } from "@/lib/interactive-styles"
import { normalizeClientOptions, normalizeClientProfile, type ClientOption, type ClientProfile } from "@/lib/clients"
import type { ClientDocument } from "@/components/client-documents-panel"

export type ClientSelection = {
  /** Null on the legacy path - a plain typed name, exactly as today. */
  clientId: string | null
  clientName: string
}

/**
 * Select-or-create a client, wherever a client is named (A2). Three ways to answer, and the
 * third is not a fallback:
 *
 *   1. pick an existing profile  - fills the name and hands the caller the profile and its
 *                                  documents so the flow can pre-fill and attach
 *   2. create one inline         - name only, editable in full later
 *   3. type a plain name         - the legacy path, FIRST-CLASS and never nagged at. An agency
 *                                  that never makes a profile loses nothing.
 *
 * Pre-migration the list simply comes back empty (the API answers `available: false` rather than
 * erroring), so this degrades to a plain text input that behaves exactly like the field it
 * replaced. That is why the typed name is always the source of truth for the string, and
 * clientId is only ever an addition to it.
 */
export function ClientSelector({
  value,
  onChange,
  onProfileApplied,
  label = "Client",
  placeholder = "Client name",
  id,
  projectId,
}: {
  value: ClientSelection
  onChange: (next: ClientSelection) => void
  /** Fired only when a profile is picked, with everything the flow needs to pre-fill. Never
   *  fired for a typed name, so the legacy path can never be silently altered. */
  onProfileApplied?: (profile: ClientProfile, documents: ClientDocument[]) => void
  label?: string
  placeholder?: string
  id?: string
  /** The master project this flow is building against, when there is one. Supplying it makes
   *  this control INHERIT that project's client read-only instead of offering a choice - see
   *  the inherited branch below. Omitted by "+ New project", which has no project yet. */
  projectId?: string | null
}) {
  const [options, setOptions] = useState<ClientOption[]>([])
  const [available, setAvailable] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<string | null>(null)
  /**
   * THE RULING: the client belongs to the master project. A project has exactly one client and
   * everything beneath it inherits that client, so a different profile must never be layered
   * onto a project that already has one from inside an RFP.
   *
   * `inherited` is that project's existing client, when it has one. Null means the project has
   * no client yet, which is the only case where this control still offers a choice.
   */
  const [inherited, setInherited] = useState<{ name: string; fromProfile: boolean } | null>(null)
  const [inheritedLoaded, setInheritedLoaded] = useState(false)

  const loadOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/agency/clients", { credentials: "same-origin", cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      setAvailable(data?.available !== false)
      setOptions(normalizeClientOptions(data?.clients))
    } catch {
      setAvailable(false)
      setOptions([])
    }
  }, [])

  useEffect(() => {
    void loadOptions()
  }, [loadOptions])

  // The project's own client is not on the selected-project context - MasterProject carries a
  // display string coerced to "Client TBD" when empty and no client_id at all - so it is read
  // here from the project row itself.
  useEffect(() => {
    let cancelled = false
    if (!projectId) {
      setInherited(null)
      setInheritedLoaded(true)
      return
    }
    setInheritedLoaded(false)
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
          credentials: "same-origin",
          cache: "no-store",
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        const project = (data?.project || {}) as Record<string, unknown>
        const existingId = typeof project.client_id === "string" && project.client_id ? project.client_id : null
        const existingName =
          typeof project.client_name === "string" && project.client_name.trim() ? project.client_name.trim() : null
        setInherited(existingId || existingName ? { name: existingName || "This project's client", fromProfile: Boolean(existingId) } : null)
      } catch {
        // A failed read must not silently unlock the selector on a project that has a client.
        // Treated as "unknown", which keeps the control hidden rather than offering an override.
        if (!cancelled) setInherited({ name: "This project's client", fromProfile: false })
      } finally {
        if (!cancelled) setInheritedLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const applyProfile = async (clientId: string) => {
    if (!clientId) {
      // Back to the legacy path. The name the agency already typed is deliberately kept -
      // clearing it would punish them for exploring the dropdown.
      onChange({ clientId: null, clientName: value.clientName })
      setApplied(null)
      return
    }
    setApplying(true)
    try {
      const res = await fetch(`/api/agency/clients/${clientId}`, { credentials: "same-origin", cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      const profile = normalizeClientProfile(data?.client)
      if (!profile) return
      onChange({ clientId: profile.id, clientName: profile.name })
      setApplied(profile.name)
      onProfileApplied?.(profile, (data?.documents || []) as ClientDocument[])
    } finally {
      setApplying(false)
    }
  }

  // Nothing renders until the project's client is known. Showing the selector first and then
  // swapping it for read-only context would offer an override for a beat, which is exactly the
  // window in which the incoherent write happened.
  if (projectId && !inheritedLoaded) {
    return (
      <div className="space-y-2">
        <label className="font-mono text-2xs uppercase tracking-wider text-foreground-muted block">{label}</label>
        <p className="font-mono text-2xs text-foreground-muted">Loading this project&apos;s client...</p>
      </div>
    )
  }

  // INHERITED. The project already has a client, so this RFP has one too, and there is no
  // control here to change it. Changing a project's client is a deliberate act performed on the
  // project itself, never a side effect of building an RFP.
  if (inherited) {
    return (
      <div className="space-y-2">
        <label className="font-mono text-2xs uppercase tracking-wider text-foreground-muted block">{label}</label>
        <div className="rounded-md border border-border bg-white/5 px-3 py-2">
          <span className="text-sm text-foreground">{inherited.name}</span>
          {inherited.fromProfile && (
            <span className="ml-2 font-mono text-2xs uppercase tracking-wider text-accent">Client profile</span>
          )}
        </div>
        <p className="font-mono text-2xs text-foreground-muted">
          {projectId ? (
            <>
              This client comes from the project. Change it on the{" "}
              <Link
                href={`/agency/projects/${encodeURIComponent(projectId)}`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                project itself
              </Link>
              .
            </>
          ) : (
            "This client comes from the project and is changed on the project itself."
          )}
        </p>
      </div>
    )
  }

  // NO CLIENT YET. Today's behavior exactly - this is the path that lets a profile be adopted
  // onto an unassigned project.
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="font-mono text-2xs uppercase tracking-wider text-foreground-muted block">
        {label}
      </label>

      {available && options.length > 0 && (
        <select
          value={value.clientId ?? ""}
          onChange={(e) => void applyProfile(e.target.value)}
          disabled={applying}
          className="w-full h-10 rounded-md px-3 text-sm bg-background border border-border text-foreground"
          aria-label="Select a client profile"
        >
          <option value="">Type a client name instead</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      )}

      <Input
        id={id}
        value={value.clientName}
        onChange={(e) => {
          // Typing always drops the entity link. A name that no longer matches the profile it
          // came from must not keep claiming to be that profile.
          onChange({ clientId: null, clientName: e.target.value })
          setApplied(null)
        }}
        placeholder={placeholder}
        className="bg-background border-border text-foreground"
      />

      <div className="flex flex-wrap items-center gap-3">
        <NewClientDialog
          navigateOnCreate={false}
          onCreated={(created) => {
            void loadOptions()
            void applyProfile(created.id)
          }}
          trigger={
            <button type="button" className={cn("font-mono text-2xs text-foreground-muted underline underline-offset-4", MOMENTARY_LINK_DARK)}>
              New client profile
            </button>
          }
        />
        {applying && <span className="font-mono text-2xs text-foreground-muted">Applying...</span>}
        {!applying && applied && (
          <span className="font-mono text-2xs text-success">
            {applied} applied. Documents and defaults are editable below.
          </span>
        )}
      </div>
    </div>
  )
}
