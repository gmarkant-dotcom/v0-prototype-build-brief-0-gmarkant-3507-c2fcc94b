"use client"

import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

type Theme = "light" | "dark"

const THEME_CLASSES: Record<Theme, { container: string; title: string; chevron: string; summary: string; body: string }> = {
  light: {
    container: "rounded-xl border border-vendor-border bg-vendor-surface",
    title: "font-display font-bold text-sm text-vendor-foreground",
    chevron: "text-vendor-muted",
    summary: "font-mono text-2xs uppercase tracking-wider text-vendor-muted-strong",
    body: "border-t border-vendor-border",
  },
  dark: {
    container: "rounded-xl border border-border/40 bg-white/5",
    title: "font-display font-bold text-sm text-foreground",
    chevron: "text-foreground-muted",
    summary: "font-mono text-2xs uppercase tracking-wider text-foreground-muted",
    body: "border-t border-border/40",
  },
}

/**
 * Shared bid-form section wrapper (F1) - one collapse pattern for all six bid-form sections
 * on both the portal and guest paths, matching the app's existing hand-rolled chevron+rotate
 * idiom (see app/agency/bids/page.tsx's GroupSection and app/agency/dashboard/page.tsx's
 * useSectionCollapse-driven headers) rather than shadcn's unused Collapsible/Accordion
 * primitives. Controlled (open/onToggle) rather than owning its own state, so a parent page
 * can force a section open (e.g. on a failed submit with incomplete required items) without
 * fighting a prior manual collapse - and so there is no persistence of any kind, per spec.
 */
export function BidFormCollapsibleSection({
  title,
  summary,
  open,
  onToggle,
  theme = "light",
  children,
}: {
  title: string
  /** Rendered in the header, visible whether open or collapsed - collapsed headers must
   *  summarize state so nothing required can hide. Omit when there is nothing to summarize. */
  summary?: React.ReactNode
  open: boolean
  onToggle: () => void
  theme?: Theme
  children: React.ReactNode
}) {
  const t = THEME_CLASSES[theme]
  return (
    <div className={t.container}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 p-4 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <ChevronDown className={cn("w-4 h-4 shrink-0 transition-transform", t.chevron, open && "rotate-180")} />
          <span className={t.title}>{title}</span>
        </span>
        {summary && <span className={cn(t.summary, "shrink-0 text-right")}>{summary}</span>}
      </button>
      {open && <div className={cn(t.body, "p-4 pt-4 space-y-4")}>{children}</div>}
    </div>
  )
}
