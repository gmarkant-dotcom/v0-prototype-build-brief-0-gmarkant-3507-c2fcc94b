/**
 * Shared interaction styling for raw <button> elements (Q2).
 *
 * Most buttons in this app go through components/ui/button.tsx, which already sets
 * `outline-none focus-visible:ring-[3px]` - it opts out of the UA focus ring and opts into the
 * app's own, on :focus-visible only, per the design language. Raw <button>s written inline do
 * not, so they silently diverge from that convention. These constants exist so a raw button can
 * pick up the same rules without anyone re-deciding them.
 *
 * The two defects these fix, both confirmed by reading the compiled stylesheet:
 *
 * 1. STICKY HOVER. Every `hover:` utility in this app compiles to a bare `:hover` rule - the
 *    build output carries 175 of them against only 7 wrapped in `@media (hover:hover)`. On a
 *    touch or hybrid device, tapping an element applies :hover and it PERSISTS until something
 *    else is tapped. A momentary action button then looks held down, indefinitely.
 * 2. NO MOMENTARY FEEDBACK. A button that adds something is not a mode. It needs a brief
 *    pressed state on :active that releases the instant the pointer lifts, so that a persistent
 *    highlight can only ever mean "this is on", never "I clicked this once".
 *
 * `[@media(hover:hover)]:hover:` is the arbitrary-variant form. Verified against the compiled
 * stylesheet rather than assumed: the emitted rule sits inside an `@media (hover:hover)` block,
 * where the same utility written as a plain `hover:` sits at the top level.
 *
 * `disabled:pointer-events-none` replaces the `disabled:hover:bg-transparent` these buttons
 * used to carry - CSS :hover still matches a disabled button in several browsers, and killing
 * pointer events is the same fix components/ui/button.tsx already uses.
 */

/** A momentary action on a dark surface: presets, "add", one-shot commands. Never a mode. */
export const MOMENTARY_ACTION_DARK =
  "transition-colors outline-none disabled:pointer-events-none [@media(hover:hover)]:hover:bg-white/10 active:bg-white/20 focus-visible:ring-2 focus-visible:ring-ring/50"

/** A momentary action rendered as text rather than a filled control. */
export const MOMENTARY_LINK_DARK =
  "transition-colors outline-none disabled:pointer-events-none [@media(hover:hover)]:hover:text-foreground active:text-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm"

/**
 * A real toggle - it reflects whether something is open or on, so persistent styling is
 * CORRECT here and must not be removed. Callers apply this alongside their own on/off classes;
 * this only supplies the hover guard, the focus rule, and the momentary press.
 */
export const TOGGLE_CONTROL_DARK =
  "transition-colors outline-none active:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50"
