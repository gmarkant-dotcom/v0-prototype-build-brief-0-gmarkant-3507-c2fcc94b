"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { SHOW_CLIENT_TO_VENDORS_LABEL, SHOW_CLIENT_TO_VENDORS_NOT_ENABLED } from "@/lib/rfp-record-copy"

/**
 * THE client control (ruling D3), one implementation for every place it appears:
 *  - the send step of the wizard (app/agency/page.tsx) and of Lightning (app/agency/magic-rfp/page.tsx),
 *    where it is a local choice sent with the RFP: <ClientVisibilitySwitch> directly;
 *  - each RFP group header on /agency/bids, where it saves to an existing record:
 *    <RfpRecordClientVisibility>, which wraps the same switch.
 *
 * B1 (2026-10-15): the bids-page checkbox it replaces was DISABLED for the whole save (the PATCH and a
 * second re-read of the list), and a click on a disabled control is dropped by the browser with no
 * request and no message. This control is never disabled while saving: every click is recorded as the
 * agency's latest intent, one save runs at a time, and when it finishes the latest intent is sent if
 * it differs from what the server answered. What it shows is always the server's answer; a failed save
 * shows an error and the saved setting.
 *
 * A native <button role="switch">: Enter and Space work, and the label is the same words as the old
 * checkbox ("Show client name to vendors"). The client name appears on hover on agency pages only.
 */

export function ClientVisibilitySwitch({
  visible,
  onToggle,
  clientName,
  saving = false,
  savingTarget = null,
  className,
}: {
  visible: boolean
  onToggle: () => void
  /** Agency pages only. Shown on hover and read to screen readers. */
  clientName?: string | null
  saving?: boolean
  /** While saving: the value being saved, for the screen-reader text. */
  savingTarget?: boolean | null
  className?: string
}) {
  const name = clientName?.trim() || null
  const hover = name ? `Client: ${name}` : "No client name on this RFP"
  return (
    <button
      type="button"
      role="switch"
      aria-checked={visible}
      aria-label={SHOW_CLIENT_TO_VENDORS_LABEL}
      aria-busy={saving || undefined}
      title={hover}
      onClick={(e) => {
        // Inside a clickable group header the control must not also open or close the group.
        e.stopPropagation()
        onToggle()
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-2xs uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        visible
          ? "border-accent/50 bg-accent/10 text-accent hover:bg-accent/20"
          : "border-border bg-white/5 text-foreground hover:bg-white/10",
        className
      )}
    >
      {visible ? <Eye className="w-3 h-3" aria-hidden /> : <EyeOff className="w-3 h-3" aria-hidden />}
      <span>{visible ? "Client visible" : "Client hidden"}</span>
      {saving && <span className="normal-case tracking-normal text-foreground-muted">Saving...</span>}
      <span className="sr-only">
        {hover}.{saving && savingTarget !== null ? ` Saving: client ${savingTarget ? "visible" : "hidden"} to vendors.` : ""}
      </span>
    </button>
  )
}

type SaveResult = { ok: true; visible: boolean } | { ok: false; error: string }

async function saveClientVisibility(recordId: string, show: boolean): Promise<SaveResult> {
  try {
    const res = await fetch(`/api/agency/rfp-records/${encodeURIComponent(recordId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ show_client_to_vendors: show }),
    })
    const payload = (await res.json().catch(() => ({}))) as { error?: string; show_client_to_vendors?: unknown }
    if (res.status === 503) return { ok: false, error: SHOW_CLIENT_TO_VENDORS_NOT_ENABLED }
    if (!res.ok) return { ok: false, error: payload.error || "Could not save this change. Showing the saved setting." }
    if (typeof payload.show_client_to_vendors !== "boolean") {
      return { ok: false, error: "Could not confirm this change. Reload to see the saved setting." }
    }
    return { ok: true, visible: payload.show_client_to_vendors }
  } catch {
    return { ok: false, error: "Could not save this change. Showing the saved setting." }
  }
}

/**
 * The switch on an RFP already sent. Saves through PATCH /api/agency/rfp-records/[id] only.
 * `savedVisible` is the record's value as the list last read it; `onSaved` lets the page update its
 * copy with the server's answer (no re-read needed).
 */
export function RfpRecordClientVisibility({
  recordId,
  savedVisible,
  clientName,
  onSaved,
  className,
}: {
  recordId: string
  savedVisible: boolean
  clientName?: string | null
  onSaved?: (recordId: string, visible: boolean) => void
  className?: string
}) {
  const [server, setServer] = useState(savedVisible)
  const [saving, setSaving] = useState(false)
  const [savingTarget, setSavingTarget] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The last value the server confirmed, the agency's latest intent, and whether a save is running.
  const serverRef = useRef(savedVisible)
  const intentRef = useRef<boolean | null>(null)
  const busyRef = useRef(false)

  // The list was re-read with a different saved value (another tab, another colleague): follow it,
  // unless a save of ours is running, whose own answer will arrive.
  const [listValue, setListValue] = useState(savedVisible)
  if (savedVisible !== listValue) {
    setListValue(savedVisible)
    if (!saving) setServer(savedVisible)
  }
  useEffect(() => {
    if (!busyRef.current) serverRef.current = server
  }, [server])

  const flush = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setSaving(true)
    try {
      while (intentRef.current !== null && intentRef.current !== serverRef.current) {
        const target = intentRef.current
        setSavingTarget(target)
        const result = await saveClientVisibility(recordId, target)
        if (!result.ok) {
          // Revert: the display is the server's last answer, which this failure did not change.
          intentRef.current = null
          setError(result.error)
          break
        }
        serverRef.current = result.visible
        setServer(result.visible)
        onSaved?.(recordId, result.visible)
      }
    } finally {
      intentRef.current = null
      busyRef.current = false
      setSaving(false)
      setSavingTarget(null)
    }
  }, [recordId, onSaved])

  const toggle = () => {
    setError(null)
    // Each click flips the agency's LATEST intent, so a rapid double click ends where it was clicked last.
    const base = intentRef.current ?? serverRef.current
    intentRef.current = !base
    setSavingTarget(intentRef.current)
    void flush()
  }

  return (
    <span className={cn("inline-flex flex-col items-end gap-1", className)}>
      <ClientVisibilitySwitch
        visible={server}
        onToggle={toggle}
        clientName={clientName}
        saving={saving}
        savingTarget={savingTarget}
      />
      {error && (
        <span role="alert" className="font-mono text-2xs text-amber-300 text-right max-w-[260px]">
          {error}
        </span>
      )}
    </span>
  )
}
