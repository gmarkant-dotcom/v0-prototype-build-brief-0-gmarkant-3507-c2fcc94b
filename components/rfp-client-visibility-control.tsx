"use client"

import { Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { SHOW_CLIENT_TO_VENDORS_LABEL } from "@/lib/rfp-record-copy"

/**
 * THE client switch (ruling D3) in the send step of the wizard (app/agency/page.tsx) and of Lightning
 * (app/agency/magic-rfp/page.tsx), where it is a local choice sent with the RFP, off by default.
 *
 * Owner ruling CV1 (2026-10-20): the decision is made where the brief is created. Bid Management
 * (/agency/bids) no longer carries this switch; each brief header there shows a read-only status tag
 * with a confirm menu (components/rfp-client-visibility-tag.tsx), which saves through
 * hooks/use-rfp-record-client-visibility.ts (the B1 save logic, formerly RfpRecordClientVisibility here).
 *
 * B1 (2026-10-15): never disabled while saving, because a click on a disabled control is dropped by the
 * browser with no request and no message.
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
