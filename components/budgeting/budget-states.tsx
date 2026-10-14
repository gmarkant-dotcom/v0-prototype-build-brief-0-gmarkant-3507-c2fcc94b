"use client"

import Link from "next/link"
import { Loader2 } from "lucide-react"
import { GlassCard } from "@/components/glass-card"
import { BudgetApiError } from "@/lib/budget/client-api"

/**
 * The states every budget screen renders, so "not enabled" (404 enabled:false) and "upgrade" (402)
 * look and read the same everywhere. Agency portal only (dark).
 */

export function BudgetLoading({ label = "Loading budget" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-foreground-muted py-12">
      <Loader2 className="w-5 h-5 animate-spin text-accent" />
      <span className="font-mono text-sm">{label}</span>
    </div>
  )
}

export function BudgetNotice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <GlassCard>
      <p className="font-display font-bold text-lg text-foreground">{title}</p>
      {children ? <div className="text-sm text-foreground-muted mt-1 space-y-2">{children}</div> : null}
    </GlassCard>
  )
}

/** Renders the right notice for a failed budget read. Returns null for no error. */
export function BudgetErrorState({ error, onRetry, feature = "Budgeting" }: { error: unknown; onRetry?: () => void; feature?: string }) {
  if (!error) return null
  const e = error instanceof BudgetApiError ? error : null
  switch (e?.kind) {
    case "not_enabled":
      return (
        <BudgetNotice title={`${feature} is not enabled yet`}>
          <p>The budget tables have not been set up for this workspace. Nothing is lost; this page will work as soon as they are.</p>
        </BudgetNotice>
      )
    case "upgrade":
      return (
        <BudgetNotice title="Budgeting is part of the lead agency plan">
          <p>Your current plan does not include budgeting.</p>
          <p>
            <Link href="/agency/usage" className="text-accent hover:underline">
              See your plan →
            </Link>
          </p>
        </BudgetNotice>
      )
    case "unauthorized":
      return (
        <BudgetNotice title="Your session has ended">
          <p>
            <Link href="/auth/login" className="text-accent hover:underline">
              Sign in again →
            </Link>
          </p>
        </BudgetNotice>
      )
    case "forbidden":
      return (
        <BudgetNotice title="No access">
          <p>{e.message}</p>
        </BudgetNotice>
      )
    case "not_found":
      return (
        <BudgetNotice title="Project not found">
          <p>This project does not exist or belongs to another organization.</p>
          <p>
            <Link href="/agency/budgeting" className="text-accent hover:underline">
              Back to Budgeting →
            </Link>
          </p>
        </BudgetNotice>
      )
    default:
      return (
        <BudgetNotice title="This could not be loaded">
          <p>{e?.message ?? "Something went wrong."}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="text-accent hover:underline">
              Try again
            </button>
          ) : null}
        </BudgetNotice>
      )
  }
}

/** One quiet line, the empty-state pattern from the design language. */
export function QuietEmpty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-foreground-muted py-4">{children}</p>
}

/** Inline result line for an action: success or a reason. */
export function ActionMessage({ message }: { message: { tone: "ok" | "error"; text: string } | null }) {
  if (!message) return null
  return (
    <p role="status" className={message.tone === "ok" ? "font-mono text-2xs text-success" : "text-sm text-destructive"}>
      {message.text}
    </p>
  )
}

export function FeeCostBadge({ value }: { value: "fee" | "cost" }) {
  return (
    <span
      className={
        value === "fee"
          ? "inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-2xs uppercase tracking-wider text-accent"
          : "inline-flex items-center rounded-full border border-border bg-white/5 px-2 py-0.5 font-mono text-2xs uppercase tracking-wider text-foreground-muted"
      }
    >
      {value}
    </span>
  )
}

/** A category whose lines are not all of its kind (R-K1). */
export function MixedBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 font-mono text-2xs uppercase tracking-wider text-warning">
      Mixed
    </span>
  )
}

const kindChipBase = "inline-flex items-center justify-center rounded-full border px-2 py-0.5 font-mono text-2xs uppercase tracking-wider"

/**
 * A line's EFFECTIVE kind (117, R-K1). Inherited from the category: outlined and dashed, no fill.
 * Overridden on the line: solid. With onClick it is the toggle (a button); without, a label.
 * R-K4: an override always differs from its category, so clicking a dashed chip sets the other
 * kind and clicking a solid chip returns the line to its category (the other kind again).
 */
export function KindChip({
  kind,
  source,
  onClick,
  disabled,
  label,
}: {
  kind: "fee" | "cost"
  source: "inherited" | "override"
  onClick?: () => void
  disabled?: boolean
  label?: string
}) {
  const tone =
    source === "override"
      ? kind === "fee"
        ? "border-accent bg-accent text-accent-foreground"
        : "border-foreground bg-foreground text-background"
      : kind === "fee"
        ? "border-dashed border-accent/50 bg-transparent text-accent"
        : "border-dashed border-foreground/40 bg-transparent text-foreground"
  const title = source === "override" ? `${kind}, set on this line` : `${kind}, from the category`
  const other = kind === "fee" ? "cost" : "fee"
  const action = source === "override" ? `Follow the category (${other})` : `Mark ${other}`
  if (!onClick) {
    return (
      <span className={`${kindChipBase} ${tone}`} title={title}>
        {kind}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={`${kindChipBase} ${tone} min-w-[3.25rem] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50`}
      title={`${title}. Click: ${action}.`}
      aria-label={label ?? `${title}. ${action}`}
      onClick={onClick}
      disabled={disabled}
    >
      {kind}
    </button>
  )
}

export const selectClass =
  "h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"

export const labelClass = "font-mono text-2xs uppercase tracking-wider text-foreground-muted block mb-1.5"
