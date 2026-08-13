"use client"

import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { HelpTerm } from "@/components/help-term"
import {
  PROPOSAL_SECTION_KEYS,
  PROPOSAL_SECTION_LABELS,
  PROPOSAL_SECTION_PLACEHOLDERS,
  normalizeProposalSections,
  hasProposalSections,
  type ProposalSections,
} from "@/lib/proposal-sections"

type Theme = "light" | "dark"

const T: Record<Theme, Record<string, string>> = {
  light: {
    label: "font-mono text-2xs uppercase tracking-wider text-vendor-muted",
    help: "text-xs text-vendor-muted-strong",
    input: "bg-vendor-surface border-vendor-border text-vendor-foreground placeholder:text-vendor-muted/70",
    heading: "font-display font-bold text-sm text-vendor-foreground",
    body: "text-sm text-vendor-foreground whitespace-pre-wrap",
  },
  dark: {
    label: "font-mono text-2xs uppercase tracking-wider text-foreground-muted",
    help: "text-xs text-foreground-muted",
    input: "bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50",
    heading: "font-display font-bold text-sm text-foreground",
    body: "text-sm text-foreground-muted whitespace-pre-wrap",
  },
}

/**
 * Four optional guided sub-fields inside the bid form's Proposal section (P2-2), on both the
 * portal and guest paths. Every one is skippable and none is counted by the sticky readiness
 * bar - counting them would make the bar claim something blocks submission that does not.
 * The free-prose proposal field stays exactly where it is and stays the required one.
 */
export function BidProposalSectionsEditor({
  value,
  onChange,
  theme = "light",
  disabled = false,
}: {
  value: ProposalSections
  onChange: (next: ProposalSections) => void
  theme?: Theme
  disabled?: boolean
}) {
  const t = T[theme]
  return (
    <div className="space-y-3">
      <div>
        <span className={t.label}>
          <HelpTerm term="guided_proposal_sections" theme={theme}>
            Guided sections (optional)
          </HelpTerm>
        </span>
        <p className={cn(t.help, "mt-1")}>
          Answer any of these that help. Anything you leave blank is simply left out of your bid, and the agency never
          sees an empty heading.
        </p>
      </div>
      {PROPOSAL_SECTION_KEYS.map((key) => (
        <div key={key}>
          <label className={cn("block mb-1.5", t.label)}>{PROPOSAL_SECTION_LABELS[key]}</label>
          <Textarea
            rows={3}
            value={value[key] ?? ""}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            disabled={disabled}
            placeholder={PROPOSAL_SECTION_PLACEHOLDERS[key]}
            className={t.input}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * Read-only render for agency surfaces and the vendor's own submitted view. Absent sections do
 * not render at all - no heading, no placeholder, no "Not provided". A bid with no structured
 * sections renders nothing, which is every legacy prose-only bid.
 */
export function ProposalSectionsDisplay({
  sections: raw,
  theme = "dark",
  className,
}: {
  sections: unknown
  theme?: Theme
  className?: string
}) {
  const t = T[theme]
  const sections = normalizeProposalSections(raw)
  if (!hasProposalSections(sections)) return null
  return (
    <div className={cn("space-y-3", className)}>
      {PROPOSAL_SECTION_KEYS.filter((key) => sections[key]).map((key) => (
        <div key={key}>
          <div className={t.heading}>{PROPOSAL_SECTION_LABELS[key]}</div>
          <p className={cn(t.body, "mt-1")}>{sections[key]}</p>
        </div>
      ))}
    </div>
  )
}
