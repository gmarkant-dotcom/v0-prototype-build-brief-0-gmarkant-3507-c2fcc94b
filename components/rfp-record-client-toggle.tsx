"use client"

import { useState } from "react"
import useSWR from "swr"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { formatDateTime } from "@/lib/utils"
import {
  SHOW_CLIENT_TO_VENDORS_EXISTING_HINT,
  SHOW_CLIENT_TO_VENDORS_LABEL,
  SHOW_CLIENT_TO_VENDORS_NOT_ENABLED,
} from "@/lib/rfp-record-copy"

/**
 * Step B: the per-RFP client toggle (ruling D3) on RFPs already sent, for the bids page.
 *
 * READ: the browser Supabase client, under 118's RLS (members of a paid lead agency see their own
 * organization's records and nothing else). Sent, unarchived records only. Before 118 the table
 * does not exist and this renders nothing. Nothing renders while loading (house rule).
 * WRITE: PATCH /api/agency/rfp-records/[id] (G1, organization scope, 119's function in one
 * transaction). Before 119 that answers 503 and nothing changes; the message says so.
 */

type RecordRow = {
  id: string
  source: "wizard" | "magic_link" | "backfill"
  show_client_to_vendors: boolean
  client_name_snapshot: string | null
  broadcast_at: string
  project_name: string | null
}

type RecordsResult = { available: boolean; records: RecordRow[] }

const RECORDS_KEY = "rfp-records:sent"

async function loadSentRecords(): Promise<RecordsResult> {
  const { createClient } = await import("@/lib/supabase/client")
  const supabase = createClient()
  const { data, error } = await supabase
    .from("rfp_records")
    .select("id, source, show_client_to_vendors, client_name_snapshot, broadcast_at, project_name:master_rfp->>projectName")
    .not("broadcast_at", "is", null)
    .is("archived_at", null)
    .order("broadcast_at", { ascending: false })
    .limit(100)
  if (error) {
    // 118 not applied: there is nothing to show, and that is not an error for this page.
    if (error.code === "42P01" || error.code === "PGRST205") return { available: false, records: [] }
    throw error
  }
  // Deduplicated by id at the data level, as every list here is.
  const seen = new Set<string>()
  const records = ((data || []) as unknown as RecordRow[]).filter((r) => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })
  return { available: true, records }
}

const SOURCE_LABEL: Record<RecordRow["source"], string> = {
  wizard: "RFP wizard",
  magic_link: "Lightning RFP",
  backfill: "Sent before records",
}

export function RfpRecordClientToggle() {
  const { data, isLoading, error, mutate } = useSWR<RecordsResult>(RECORDS_KEY, loadSentRecords)
  const [open, setOpen] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ id: string; text: string } | null>(null)

  if (isLoading || error || !data?.available || data.records.length === 0) return null

  const setShow = async (record: RecordRow, show: boolean) => {
    setPendingId(record.id)
    setMessage(null)
    try {
      const res = await fetch(`/api/agency/rfp-records/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ show_client_to_vendors: show }),
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.status === 503) {
        setMessage({ id: record.id, text: SHOW_CLIENT_TO_VENDORS_NOT_ENABLED })
        return
      }
      if (!res.ok) {
        setMessage({ id: record.id, text: payload.error || "Could not change this setting. Nothing was changed." })
        return
      }
      await mutate()
    } catch {
      setMessage({ id: record.id, text: "Could not change this setting. Nothing was changed." })
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-white/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="w-4 h-4 text-foreground-muted" /> : <ChevronRight className="w-4 h-4 text-foreground-muted" />}
          <span className="font-display font-semibold text-foreground">Client name on sent RFPs</span>
        </span>
        <span className="font-mono text-2xs text-foreground-muted uppercase tracking-wider">
          {data.records.length} RFP{data.records.length === 1 ? "" : "s"}
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          <p className="font-mono text-2xs text-foreground-muted">{SHOW_CLIENT_TO_VENDORS_EXISTING_HINT}</p>
          <ul className="space-y-2">
            {data.records.map((record) => (
              <li key={record.id} className="rounded-lg border border-border bg-white/5 p-3 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{record.project_name?.trim() || "Untitled project"}</p>
                    <p className="font-mono text-2xs text-foreground-muted">
                      {SOURCE_LABEL[record.source]} · Sent {formatDateTime(record.broadcast_at)} ·{" "}
                      {record.client_name_snapshot?.trim() ? `Client: ${record.client_name_snapshot.trim()}` : "No client name on this RFP"}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer shrink-0">
                    <Checkbox
                      checked={record.show_client_to_vendors}
                      disabled={pendingId !== null}
                      onCheckedChange={(v) => void setShow(record, v === true)}
                      className="border-border"
                    />
                    <span className="font-mono text-xs text-foreground">{SHOW_CLIENT_TO_VENDORS_LABEL}</span>
                  </label>
                </div>
                {message?.id === record.id && <p className="font-mono text-2xs text-amber-300">{message.text}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
