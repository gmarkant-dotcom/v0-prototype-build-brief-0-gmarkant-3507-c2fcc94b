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

const OPEN_DELAY_MS = 100
const CLOSE_DELAY_MS = 150

/**
 * Inline help cue for a glossary term: a dotted-underline trigger that opens a small popover
 * on hover (desktop, with hover-intent timing - see below), tap (mobile - Radix's own
 * click-toggle handles this, untouched by the hover logic), or keyboard focus (immediate,
 * no delay). Esc and outside-click dismiss via Popover's built-in DismissableLayer - no
 * extra wiring needed for those. Renders through PopoverContent's portal, so it is never
 * clipped inside a Sheet/Dialog, and sits above their z-50 overlay/content via an explicit
 * z-[60].
 *
 * Hover-intent: kept Radix Popover (not HoverCard) and manage open/close timing manually.
 * HoverCard bakes in openDelay/closeDelay but is hover/focus-only by design - it has no tap
 * support, so switching would mean re-deriving the touch path from scratch. Popover's
 * Trigger already click-toggles correctly for tap; layering hover-intent on top of that is
 * the smaller, safer change.
 *
 * The open and close timers are shared across the trigger AND the content (both wire the
 * same two handlers below), so entering either one cancels a pending close and entering
 * either cancels a pending open. This is what fixes the flicker: when collision avoidance
 * places the content overlapping or flush against the trigger, the browser can fire
 * trigger-mouseleave/content-mouseenter (or vice versa) in the same tick with no real gap -
 * a shared "pointer is over trigger or content" model absorbs that instead of racing a
 * single open/close boolean toggle.
 */
export function HelpTerm({ term, children, theme = "dark", className, stopPropagation = true }: HelpTermProps) {
  const entry = GLOSSARY[term]
  const [open, setOpen] = useState(false)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const descriptionId = useId()

  if (!entry) return <>{children}</>

  const clearTimers = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current)
      openTimer.current = null
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  // Pointer entered the trigger or the content: cancel any pending close (this is the
  // flicker fix - re-entering either element mid-close-countdown keeps it open), and if
  // not already open or opening, start the short open-intent delay so a passing graze
  // across the underline doesn't pop a definition nobody asked for.
  const handlePointerEnter = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    if (open || openTimer.current) return
    openTimer.current = setTimeout(() => {
      openTimer.current = null
      setOpen(true)
    }, OPEN_DELAY_MS)
  }

  // Pointer left the trigger or the content: cancel a not-yet-fired open (a quick graze
  // shouldn't open at all), then schedule a close. If the pointer is actually moving to the
  // other half (trigger <-> content) it re-enters within the delay and cancels this.
  const handlePointerLeave = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current)
      openTimer.current = null
    }
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      // Belt and suspenders: a stale open timer (from some future code path that doesn't
      // go through handlePointerEnter's own guard) must not resurrect the popover this
      // close is about to dismiss.
      if (openTimer.current) {
        clearTimeout(openTimer.current)
        openTimer.current = null
      }
      setOpen(false)
    }, CLOSE_DELAY_MS)
  }

  // Keyboard focus opens immediately - no open-intent delay, since that delay exists purely
  // to filter accidental mouse grazes and a deliberate Tab shouldn't wait on it. Gated to
  // :focus-visible specifically: a mouse click also focuses the trigger (handled already by
  // Radix's own click-toggle) and, more importantly, Radix returns focus to the trigger
  // when the popover closes - without this gate that programmatic refocus would itself
  // call setOpen(true) again, reopening a popover that had just legitimately closed.
  const handleFocus = (e: React.FocusEvent<HTMLButtonElement>) => {
    if (!e.target.matches(":focus-visible")) return
    clearTimers()
    setOpen(true)
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
          onMouseEnter={handlePointerEnter}
          onMouseLeave={handlePointerLeave}
          onFocus={handleFocus}
          onBlur={handlePointerLeave}
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
        onMouseEnter={handlePointerEnter}
        onMouseLeave={handlePointerLeave}
        // This is a lightweight hover-driven info popover, not a modal dialog - it must
        // never yank focus around. Without these two, Radix's defaults (move focus into the
        // content on open since it has no focusable children of its own, then return focus
        // to the trigger on close) blur the trigger the instant it opens, which - via
        // handlePointerLeave bound to the trigger's onBlur - schedules an unwanted close,
        // and closing returns focus to the trigger, which - via handleFocus - reopens it.
        // That bounce is what produced the "flashes when the cursor moves away" symptom
        // (the strobing kept going regardless of the pointer once this loop was running).
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // Wider gap and edge padding than the primitive's default (sideOffset 4) - less
        // overlap with the trigger means less surface for the occlusion-driven flicker to
        // occur on in the first place, independent of the hover-intent timing above. Radix
        // still auto-flips side (bottom <-> top) on its own when space runs out.
        sideOffset={10}
        collisionPadding={8}
        avoidCollisions
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
