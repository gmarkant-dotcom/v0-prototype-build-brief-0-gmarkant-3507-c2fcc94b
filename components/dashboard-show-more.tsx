"use client"

import { cn } from "@/lib/utils"

/**
 * "Show all N" / "Show less" toggle for a capped list - paired with useCappedList
 * (lib/dashboard-section-state.ts). Renders nothing once the list is short enough that
 * there's nothing to expand.
 */
export function DashboardShowMoreToggle({
  hasMore,
  expanded,
  total,
  onToggle,
  className,
}: {
  hasMore: boolean
  expanded: boolean
  total: number
  onToggle: () => void
  className?: string
}) {
  if (!hasMore) return null
  return (
    <button type="button" onClick={onToggle} className={cn("text-xs hover:underline", className)}>
      {expanded ? "Show less" : `Show all ${total}`}
    </button>
  )
}
