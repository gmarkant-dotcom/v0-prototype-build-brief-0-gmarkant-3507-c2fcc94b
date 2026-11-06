"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { SHOW_CLIENT_TO_VENDORS_NOT_ENABLED } from "@/lib/rfp-record-copy"

/**
 * The save logic for the client visibility of an RFP already sent, through
 * PATCH /api/agency/rfp-records/[id] only. Extracted from the B1 control (2026-10-15) so every
 * surface that changes a saved record uses the same rules:
 *  - never blocks input: every request is recorded as the agency's LATEST intent;
 *  - one save at a time; when it finishes, the latest intent is sent if it differs from what the
 *    server answered;
 *  - what it returns as `visible` is always the server's answer, never the request;
 *  - a failed save sets `error` and leaves `visible` at the saved setting.
 *
 * `savedVisible` is the record's value as the list last read it; `onSaved` lets the page update its
 * copy with the server's answer (no re-read needed).
 */

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

export function useRfpRecordClientVisibility({
  recordId,
  savedVisible,
  onSaved,
}: {
  recordId: string
  savedVisible: boolean
  onSaved?: (recordId: string, visible: boolean) => void
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

  /** Records `target` as the latest intent and saves it (after any save already running). */
  const requestVisibility = useCallback(
    (target: boolean) => {
      setError(null)
      intentRef.current = target
      setSavingTarget(target)
      void flush()
    },
    [flush]
  )

  return {
    /** The server's answer. */
    visible: server,
    saving,
    /** While saving: the value being saved. */
    savingTarget,
    /** What the record will be once every requested save has run: the latest intent, else the server's answer. */
    intended: saving && savingTarget !== null ? savingTarget : server,
    error,
    requestVisibility,
  }
}
