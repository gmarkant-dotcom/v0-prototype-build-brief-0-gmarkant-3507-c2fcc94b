# Q-Batch Run Report

Aug 13, 2026. Four commits, Q1 through Q4. Not pushed at time of writing.
`npx tsc --noEmit` exit 0 and `pnpm build` exit 0 after every commit. Corruption scan clean.
No em dashes introduced.

| Commit | What |
| --- | --- |
| `c4563c4` | Q1 collapsible sections on the Master RFP wizard step |
| `2f966d3` | Q2 preset buttons read as pressed, per-semantics fix |
| `f1ef467` | Q3 HelpTerm coverage on the Phase 2 fields |
| `768c2ba` | Q4 NDA and MSA confirm controls read as duplicates on Vendor Pool |

---

## Q1 - wizard collapsibility

Five sections on the Master RFP + Business Criteria step use `BidFormCollapsibleSection`, the
same wrapper F1 built for the bid form. No wizard-specific variant was created, and one that
already existed was removed (see magic-rfp below). All default open.

The identity header - project name, client, Edit/Export, and the Total budget and Timeline tiles
- stays always-visible in its own `GlassCard`, because it names the thing every section below
belongs to and collapsing it would leave the step unlabelled.

Collapsed-header summaries, each computed from the same state its own section edits:

| Section | Summary |
| --- | --- |
| Master RFP summary | `N objectives` |
| Scope items | `N deliverables` |
| Business criteria | `N required` / `None required` |
| Budget categories | `N categories` / `None - vendors bid one total` |
| Evaluation criteria | `N of 8` / `Standard criteria` |

Keyboard operability came free: the shared wrapper's header is already a real
`<button type="button">` carrying `aria-expanded`, which is why reusing it rather than
hand-rolling a sixth accordion mattered.

### Draft byte-identity check: PASSED

Collapse lives in its own `useState`, deliberately NOT inside `masterRfp` - `masterRfp` is one
of the keys `saveDraft` serializes, so anything stored in it would persist.

Verified mechanically rather than by eye. The `saveDraft` payload's key list was extracted from
the source before and after the change and compared: **identical, 22 keys, same order.**
`step2Open` appears nowhere in that payload and nowhere in the `masterRfp` state shape. Drafts
round-trip exactly as they did before.

### Gate integration

Step 2 had **no Continue validation at all** before Q1 - it called `setCurrentStep(3)`
unconditionally - so there was nothing existing to hook auto-expand onto. Rather than ship dead
plumbing, it is wired to the one genuinely blocking problem the step can hold: a budget category
or evaluation criterion whose name has been cleared. Both are silently dropped by their
normalizers on save, so an agency loses that row without being told. Continue now expands the
offending section and shows the reason. This is a small behavior addition rather than a pure
rendering change - logged in Open Questions.

### magic-rfp

The Budget categories and Evaluation criteria blocks were hand-rolled accordions when P2-1 and
P2-3 added them - ad-hoc variants of a component that already existed - and are converted to the
shared wrapper. The two NATIVE accordions (Advanced Options, Additional business criteria) keep
their own mechanism and are NOT wrapped: nesting two collapse layers would be worse than an
inconsistency.

Both converted blocks stay default closed, diverging from F1's default-open rule on purpose -
they sit in a dense settings column beside two accordions that are also closed, and opening them
all would bury the brief that page exists to write.

Not converted, and why: Response deadline, the terms-disclosure checkbox, and Reference materials
are two-line single-control blocks. A chevron in front of a two-line control adds a click and
hides nothing worth hiding.

---

## Q2 - preset buttons stuck in a pressed state

### Diagnosis

**Not state latching, and not a focus ring reading as selection.** Two mechanisms, both confirmed
from the compiled stylesheet rather than guessed:

1. **Sticky hover, unguarded.** Every `hover:` utility in this app compiles to a bare `:hover`
   rule. The build output carried **175** of them against only **7** wrapped in
   `@media (hover:hover)` - Tailwind v4 does not add that guard by itself. On any touch or hybrid
   device, tapping an element applies `:hover` and it PERSISTS until something else is tapped.
   Tapping between the three presets leaves the last one filled, indefinitely, exactly as if it
   were selected.
2. **No momentary feedback.** The three presets carry no `:active` state at all, so the latched
   hover is the ONLY visual change interaction produces - which is why it reads as "this is
   selected" rather than "I clicked this".

Ruled out explicitly: the presets have no conditional `className`, no `aria-pressed`, and
`addBundle()` sets no styling state. Nothing latches in React.

Found alongside: these are raw `<button>`s that never opted into the app's focus convention.
`components/ui/button.tsx` sets `outline-none focus-visible:ring-[3px]`; raw buttons written
inline inherit the base layer's `outline-ring/50` colour and the browser's own ring behaviour
instead.

### Fix, per semantics

- The three presets are **momentary** - they add categories, they are not modes. Brief `:active`
  press that releases, hover behind `@media (hover:hover)`, focus ring on `:focus-visible` only.
- **"Paste a list" IS a toggle** - it opens and closes a panel - so its persistent active styling
  is correct and stays. It gains `aria-expanded`, and takes the momentary treatment only in its
  closed state.
- Swept the same defect across both Phase 2 editors: move-up, move-down and remove icon buttons,
  and the evaluation block's "Use my standard criteria instead". "Load the standard criteria"
  already goes through the shared `Button` and needed nothing.
- `disabled:hover:bg-transparent` replaced by `disabled:pointer-events-none`, matching the shared
  Button - CSS `:hover` still matches a disabled button in several browsers.

New `lib/interactive-styles.ts` holds the three treatments so the next raw button does not
re-decide them. The arbitrary variant was verified to work rather than assumed: a brace-depth
walk of the compiled CSS confirms `[@media(hover:hover)]:hover:bg-white/10` emits inside an
`@media (hover:hover)` block, where the plain `hover:` form emits at the top level.

---

## Q3 - HelpTerm coverage on the Phase 2 fields

Six new glossary entries in `lib/glossary.ts` and `docs/glossary-content.md`: Additional items,
Subtotal and itemized lines, Weight, Standard criteria, Close bidding at deadline, Guided
proposal sections. Budget category and Evaluation criteria already existed from P2-1 and P2-3 and
are reused, not duplicated.

Placement, one cue per term per view region:

| Term | File | Where |
| --- | --- | --- |
| `budget_category` | `bid-budget-categories.tsx` | "Budget by category" header (pre-existing) |
| `budget_category` | `budget-category-editor.tsx` | section footnote (pre-existing) |
| `additional_items` | `budget-category-editor.tsx` | the flagged Additional items row |
| `additional_items` | `bid-budget-categories.tsx` | the Additional items category name, vendor side |
| `itemized_line` | `bid-budget-categories.tsx` | intro line, "a subtotal, or itemize it" |
| `criterion_weight` | `evaluation-criteria-editor.tsx` | the Weight label, FIRST ROW ONLY |
| `standard_criteria` | `evaluation-criteria-editor.tsx` | empty state's "standard evaluation criteria" |
| `standard_criteria` | `bid-evaluation-tab.tsx` | the per-RFP banner |
| `evaluation_criteria` | `bid-evaluation-tab.tsx` | the per-RFP banner |
| `evaluation_criteria` | `evaluation-criteria-editor.tsx` | section footnote (pre-existing) |
| `close_bidding_at_deadline` | `app/agency/page.tsx` | the wizard checkbox label |
| `close_bidding_at_deadline` | `app/agency/magic-rfp/page.tsx` | the magic-link checkbox label |
| `guided_proposal_sections` | `bid-proposal-sections.tsx` | the "Guided sections (optional)" label |

Two placement decisions worth naming. The Weight cue renders only when `index === 0` - putting it
on all eight rows would be the same popover eight times in one card. And "per-RFP vs standard"
needed two homes rather than one, because the two states never coexist: the editor's empty state
explains the fallback before you have a rubric, the Evaluate tab's banner explains it once you
are scoring against one.

Every cue passes the `theme` prop where the surface is theme-aware. The close-bidding cues sit
inside `<label>` elements wrapping a checkbox; `HelpTerm`'s `stopPropagation` default already
prevents the trigger from toggling it.

---

## Q4 - duplicated Confirm NDA control on Vendor Pool

### Diagnosis: (b), with a correction to the premise

**Not (c).** Read-only query against production: vendor 71 has exactly ONE `partnerships` row
(`e6361792`). No duplicate state, no second NDA button in the DOM.

**Not award-specific either, which contradicts the brief's premise.** Vendor 71's partnership
carries `invitation_sent_at = 2026-08-07T17:11:47Z`, one second after its magic token was minted
- so the row was CREATED by the magic-link send path's `markPartnershipInvited()`, and the award
later claimed and activated it. It was never a branch-d create. Across all three active
partnerships for this agency, two show both Confirm buttons and BOTH are invite-created; zero
award-created active partnerships exist in the data at all. So this is closer to (a) than the
brief assumed: it affects every Active card whose NDA and MSA are both unconfirmed, by whichever
route the partnership arrived.

**The mechanism is (b).** An Active vendor with neither document confirmed correctly renders two
controls - the NDA control and the MSA control. They READ as duplicates because they were two
same-size, same-variant outline pills whose labels differed only by a three-letter acronym buried
mid-string ("Confirm NDA Signed" / "Confirm MSA Signed"), in a `flex-wrap` row that stacks them
directly on top of one another at narrow widths.

### Fix

They now render as two members of one document group: a shared bordered group carrying a single
mono "Confirm" eyebrow, with the acronym LEADING each label ("NDA signed" / "MSA signed") so the
differing word is read first rather than mid-string. Roughly half the previous width, and the
group does not wrap internally, so they can never stack into look-alike twins. Each button gains
an `aria-label` naming both the document and the vendor.

### Flagged, not normalized

`lib/award-partnership-resolution.ts` branch d inserts a partnership with `status: 'active'` and
`profile_status: 'active'` and **nothing else**. It never sets `invitation_sent_at`, and never
sets `nda_confirmed_at` or `msa_confirmed_at`.

An invite-created partnership carries `invitation_sent_at`, so `/agency/pool` can tell Invited
from Discovered. An award-created one has it null while being Active - the vendor is awarded work
and fully active, yet carries no invitation history. No such row exists in the data today, so
nothing is visibly broken now, but the pool's three-section model (Discovered / Invited / Active)
has no honest answer for "active, never invited".

Both paths leaving NDA and MSA unconfirmed is correct, not a bug - awarding work is not the same
as signing an NDA, and pre-filling those timestamps would assert a document that does not exist.

**No data was changed.** This needs a product decision: should an award stamp
`invitation_sent_at`, or should the pool render an "active, never invited" state explicitly?

---

## Open questions

1. **Step 2's Continue validation is new behavior** added by Q1, not pre-existing. The step
   previously advanced unconditionally.
2. **~170 unguarded `hover:` rules remain app-wide** (Q2 finding). The same latent sticky-hover
   defect exists everywhere; fixing it globally is a design-pass sweep, not a bug fix.
3. **The vendor-side budget block's link buttons are also unguarded**, but they are
   underline-styled with no fill, so a latched hover there is a colour shift rather than a pressed
   look. Left alone.
4. **`border-sky-500/40` and `text-sky-300` on the MSA button** are raw literals where the design
   language has a sanctioned informational blue, and the low contrast against the NDA button's
   success green contributed to the two reading alike. Recolouring is a design-pass call.
5. **Award-created vs invite-created partnership state** - see Q4's flag above.

---

## Verification statements

Verified:

- `npx tsc --noEmit` exit 0 and `pnpm build` exit 0 after each of the four commits.
- Markdown-link corruption scan clean across `app/`, `lib/`, `components/`.
- Q1's draft key-list diff: empty, verified by extracting the payload keys from source before and
  after.
- Q2's media-query guard: verified by brace-depth walk of the compiled stylesheet.
- Q3's cue inventory: extracted from source, not written from memory.
- Q4's diagnosis: read-only production queries.

Not verified:

- **No browser was opened.** No wizard step rendered, no popover opened, no pool card viewed at
  any width, no touch device tested.
- Q2's touch behaviour is the documented consequence of an unguarded `:hover` rule, not something
  observed.
- Q4's "they no longer read as duplicates" is a reasoned claim about labels and layout, not an
  observation.
