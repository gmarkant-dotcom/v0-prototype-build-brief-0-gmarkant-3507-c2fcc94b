"use client"

import { useCallback, useEffect, useState } from "react"
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
}: {
  value: ClientSelection
  onChange: (next: ClientSelection) => void
  /** Fired only when a profile is picked, with everything the flow needs to pre-fill. Never
   *  fired for a typed name, so the legacy path can never be silently altered. */
  onProfileApplied?: (profile: ClientProfile, documents: ClientDocument[]) => void
  label?: string
  placeholder?: string
  id?: string
}) {
  const [options, setOptions] = useState<ClientOption[]>([])
  const [available, setAvailable] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<string | null>(null)

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
