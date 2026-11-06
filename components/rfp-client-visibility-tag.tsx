"use client"

import { useId, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useRfpRecordClientVisibility } from "@/hooks/use-rfp-record-client-visibility"
import { cn } from "@/lib/utils"

/**
 * Owner ruling CV1 (2026-10-20): the client visibility decision is made where the brief is created
 * (the send step's switch, components/rfp-client-visibility-control.tsx). In Bid Management each brief
 * header shows this READ-ONLY status tag instead: "Client hidden" (muted) or "Client shown"
 * (highlighted), the client name on hover. Activating it (click, Enter or Space) opens a small menu
 * with exactly one action, one line naming who is affected, and Confirm and Cancel; Escape closes it.
 * Nothing changes until Confirm, which saves through the shared hook
 * (hooks/use-rfp-record-client-visibility.ts: one save at a time, the latest intent after an
 * in-flight save, the display from the server's answer, an error and the saved value on failure).
 */

function affectedLine(vendorCount: number | null | undefined, show: boolean): string {
  const verb = show ? "will see the client name" : "will no longer see the client name"
  if (typeof vendorCount !== "number") return `Vendors on this brief ${verb}.`
  return `${vendorCount} vendor${vendorCount === 1 ? "" : "s"} on this brief ${verb}.`
}

export function RfpClientVisibilityTag({
  recordId,
  savedVisible,
  clientName,
  vendorCount,
  onSaved,
  className,
}: {
  recordId: string
  savedVisible: boolean
  /** Agency pages only. Shown on hover and read to screen readers. */
  clientName?: string | null
  /** Distinct vendors holding a copy of this brief; null when unknown. */
  vendorCount?: number | null
  onSaved?: (recordId: string, visible: boolean) => void
  className?: string
}) {
  const { visible, saving, intended, error, requestVisibility } = useRfpRecordClientVisibility({
    recordId,
    savedVisible,
    onSaved,
  })
  const [open, setOpen] = useState(false)
  const headingId = useId()
  // The one action offered: the opposite of what the record will be once any running save lands.
  const show = !intended
  const name = clientName?.trim() || null
  const hover = name ? `Client: ${name}` : "No client name on this RFP"
  const status = visible ? "Client shown" : "Client hidden"

  return (
    <span className={cn("inline-flex flex-col items-end gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${status} to vendors. ${hover}.${saving ? " Saving." : ""} Change client visibility`}
            aria-busy={saving || undefined}
            title={hover}
            // Inside a clickable header the tag must not also open or close the group.
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-2xs uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              visible
                ? "border-accent/50 bg-accent/10 text-accent hover:bg-accent/20"
                : "border-border bg-white/5 text-foreground-muted hover:bg-white/10"
            )}
          >
            {visible ? <Eye className="w-3 h-3" aria-hidden /> : <EyeOff className="w-3 h-3" aria-hidden />}
            <span>{status}</span>
            {saving && <span className="normal-case tracking-normal text-foreground-muted">Saving...</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          aria-labelledby={headingId}
          className="w-72 border-border p-3 space-y-3"
          // React events bubble through the portal: keep clicks in the menu out of the group header.
          onClick={(e) => e.stopPropagation()}
        >
          <p id={headingId} className="text-sm font-semibold text-foreground">
            {show ? "Show client to vendors" : "Hide client from vendors"}
          </p>
          <p className="text-xs text-foreground-muted">{affectedLine(vendorCount, show)}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" className="text-foreground" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={() => {
                requestVisibility(show)
                setOpen(false)
              }}
            >
              Confirm
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {error && (
        <span role="alert" className="font-mono text-2xs text-amber-300 text-right max-w-[260px]">
          {error}
        </span>
      )}
    </span>
  )
}
