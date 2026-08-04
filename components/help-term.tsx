"use client"

import { useId, useRef, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary"
import { cn } from "@/lib/utils"

interface HelpTermProps {
  term: GlossaryKey
  children: React.ReactNode
  /** Dark for the agency portal and the guest respond page (both use the same dark tokens);
   *  light for the partner portal, which overrides to a white/gray palette locally rather
   *  than through a theme toggle - see TermsDisclosureSection for the same split. */
  theme?: "dark" | "light"
  className?: string
  /** Default true: stops the trigger's click from bubbling to an enclosing clickable label
   *  (a designation/insurance/COI/NDA checkbox row) so opening the popover never toggles it. */
  stopPropagation?: boolean
}

const CLOSE_DELAY_MS = 150

/**
 * Inline help cue for a glossary term: a dotted-underline trigger that opens a small popover
 * on hover (desktop), tap (mobile - Radix's own click-toggle handles this), or keyboard
 * focus. Esc and outside-click dismiss via Popover's built-in DismissableLayer - no extra
 * wiring needed for those. Renders through PopoverContent's portal, so it is never clipped
 * inside a Sheet/Dialog, and sits above their z-50 overlay/content via an explicit z-[60].
 */
export function HelpTerm({ term, children, theme = "dark", className, stopPropagation = true }: HelpTermProps) {
  const entry = GLOSSARY[term]
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const descriptionId = useId()

  if (!entry) return <>{children}</>

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }

  const triggerClass =
    theme === "light"
      ? "underline decoration-dotted decoration-gray-400 underline-offset-4 hover:decoration-gray-600 focus-visible:ring-[#0C3535]/40"
      : "underline decoration-dotted decoration-foreground-muted/50 underline-offset-4 hover:decoration-foreground-muted focus-visible:ring-accent/40"

  // Opaque, theme-appropriate elevated surface - same structure both themes (width,
  // radius, border, padding, shadow), only the color tokens differ. Dark uses bg-popover
  // (the --popover token, 95% opaque) explicitly rather than inheriting PopoverContent's
  // own default, so this stays correct even if that default ever changes. bg-card was the
  // bug: --card is only 7% opaque, effectively see-through.
  const contentClass =
    theme === "light"
      ? "z-[60] w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
      : "z-[60] w-72 rounded-lg border border-border bg-popover p-3 shadow-lg"

  const titleClass = theme === "light" ? "font-display font-bold text-sm text-[#0C3535] mb-1" : "font-display font-bold text-sm text-foreground mb-1"
  const bodyClass = theme === "light" ? "text-xs text-gray-600 leading-relaxed" : "text-xs text-foreground-muted leading-relaxed"
  const whyClass =
    theme === "light" ? "text-xs text-gray-500 leading-relaxed mt-2" : "text-xs text-foreground-muted/80 leading-relaxed mt-2"
  const legalClass =
    theme === "light"
      ? "text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-200"
      : "text-[10px] text-foreground-muted/60 mt-2 pt-2 border-t border-border"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("inline cursor-help rounded-sm outline-none focus-visible:ring-1", triggerClass, className)}
          aria-describedby={descriptionId}
          onMouseEnter={() => {
            cancelClose()
            setOpen(true)
          }}
          onMouseLeave={scheduleClose}
          onFocus={() => {
            cancelClose()
            setOpen(true)
          }}
          onBlur={scheduleClose}
          onClick={
            stopPropagation
              ? (e) => {
                  e.stopPropagation()
                }
              : undefined
          }
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        id={descriptionId}
        role="tooltip"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        className={contentClass}
      >
        <div className={titleClass}>{entry.term}</div>
        <p className={bodyClass}>{entry.definition}</p>
        <p className={whyClass}>Why it matters: {entry.whyItMatters}</p>
        {entry.legal && <p className={legalClass}>Descriptive only, not legal advice.</p>}
      </PopoverContent>
    </Popover>
  )
}
