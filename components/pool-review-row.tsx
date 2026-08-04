"use client"

import type { ReactNode } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

/**
 * Shared presentational shell for the "review contacts before import" list, used by both
 * the email-scan flow (components/email-import-panel.tsx's ContactRow) and the spreadsheet
 * import flow. Purely visual - each caller supplies its own title/subtitle/badges, so
 * source-specific fields (scan score/signals vs. dedup reason) never leak into this file.
 */
export function PoolReviewRow({
  title,
  subtitle,
  badges,
  checked,
  onToggle,
  disabled,
  dimmed,
}: {
  title: ReactNode
  subtitle?: ReactNode
  badges?: ReactNode
  checked: boolean
  onToggle: () => void
  /** Not selectable (e.g. already in pool, invalid row) - checkbox is hidden entirely. */
  disabled?: boolean
  /** Visually de-emphasized without hiding the checkbox. */
  dimmed?: boolean
}) {
  return (
    <div className={cn("rounded-lg border border-border p-3 flex items-start gap-3", dimmed && "opacity-60")}>
      {!disabled && <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-1" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-display font-bold text-foreground truncate">{title}</span>
        </div>
        {subtitle && <div className="text-xs text-foreground-muted truncate">{subtitle}</div>}
        {badges && <div className="flex flex-wrap gap-1 mt-1.5">{badges}</div>}
      </div>
    </div>
  )
}

export function ReviewBadge({ tone, children }: { tone?: "neutral" | "accent" | "warning"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "font-mono text-2xs uppercase tracking-wider px-1.5 py-0.5 rounded-full border",
        tone === "accent" && "border-accent/40 bg-accent/10 text-accent",
        tone === "warning" && "border-yellow-500/30 bg-yellow-500/15 text-yellow-400",
        (!tone || tone === "neutral") && "border-border text-foreground-muted"
      )}
    >
      {children}
    </span>
  )
}
