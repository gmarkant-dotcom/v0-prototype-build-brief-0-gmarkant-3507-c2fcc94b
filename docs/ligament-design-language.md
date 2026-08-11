# Ligament Design Language

**v0.3 - amended in Design Audit Session 3 (Aug 4, 2026)**
*All v0.1 [CONFIRM] items resolved against actual code (Tailwind v4; all tokens live in app/globals.css via @theme inline - there is no tailwind.config). All v0.1 [DECIDE] items ruled. All [S2] carried values were pulled and ratified during Session 2's inventory, and amended into this document during Session 3's mechanical batches (S3). This document is the bar every surface is graded against.*

## 1. How to use this document

This is the standard every surface gets graded against during the audit. A surface passes when it could have been built by someone who read only this doc. When a surface deviates, either the surface is wrong (fix it) or the doc is wrong (amend it) - never leave the two disagreeing silently.

## 2. Brand principles

The product is an orchestrator: it coordinates money, work, and trust between agencies and vendors. The design's job is to make coordination feel calm and legible, never busy or salesy.

- **Honest by construction.** Every number on screen is real, computed from one source of truth, or it is visibly absent. No placeholder dollars, no fake progress, no "Recently." Empty states tell the truth quietly. Demo fixtures exist only behind the demo gate. (Doctrine since Jul 2026, when six fake-data incidents were removed.) Working caveat: random test data used during feature QA is exempt while in development, but must never be reachable by a real account.

- **Action before status.** The most valuable pixels go to what needs a decision (Needs Your Attention / Needs Your Response). Metrics support action; they don't lead the page.

- **One source per number.** A figure that appears in two places derives from one function/fetch. Two surfaces showing the same quantity may never disagree.

- **The workflow is the wayfinding.** The numbered 00-04 nav encodes the real procurement sequence (Pool → RFP → Bids → Onboarding → Delivery). Numbering appears only where order carries meaning.

- **Hospitality in the details.** Copy anticipates the next step, pluralization is correct, timestamps are real and relative, and nothing dead-ends without direction.

## 3. Reference surfaces (the standard)

Grade everything against these; they define the current ceiling:

| Surface | What it demonstrates |
| --- | --- |
| /agency/dashboard | Attention queue leading, funnel metrics, capped/collapsible lists, honest zeros, usage card subordination |
| /partner (rebuilt) | Response queue with urgency slots, calibrated stats ("1 of 1 awarded"), honest empty Performance card, payments consistency |
| /agency/usage | Plan card hierarchy, progress bar semantics, upgrade CTA card |
| /agency/bids (Bid Management) | Grouped accordions, status chip rail, per-row metadata line (who · what · due), consistent row action |
| Import Vendors sheet | Two-option segmented entry, mapping step with inline previews, grouped review (New / Already in pool / Invalid) with per-row reasons |
| /partner/payments empty states | The single-quiet-line empty pattern, verified passing (table never renders headerless over whitespace) |

Known below-the-bar surfaces (audit targets): RFP Broadcast wizard steps [S2 walk], Onboarding, Delivery Performance, partner Legal & Compliance interior, auth pages, marketing site. The orphaned legacy /settings/* island (5 pages plus its second, dead /settings/billing page) was deleted in S3; /agency/settings/billing is a separate, intentional redirect stub to /agency/usage and is not a deletion target.

## 4. Color

Two deliberate worlds, one accent family. All values are the real tokens from app/globals.css.

**Token facts (recorded so nobody "fixes" them):**
- `--accent` and `--primary` are intentional aliases, both `#C8F53C`. shadcn/ui expects `primary`; product code prefers `accent`. Do not consolidate.
- Text on lime is `#0C3535` (`--accent-foreground` / `--primary-foreground`).

**Agency portal (dark).**
- Background `#0C3535`, deep background `#081F1F`, raised surface `#1A5252`
- Card fill `rgba(255,255,255,0.07)`, border `rgba(255,255,255,0.12)`, accent border `rgba(200,245,60,0.4)`
- Text: foreground `#FFFFFF`, secondary `#E8E8E8`, muted `#CCCCCC`
- Popover surface `rgba(4,20,20,0.95)` - near-opaque by rule; popovers must remain legible over any content
- Lime `#C8F53C` is used for: primary buttons, active nav state, selected chips, positive emphasis. Always via `accent`/`primary` token classes, never as a raw hex literal (46 existing literals are an S3 migration batch).

**Partner portal (light).**
- Tokens exist and are canonical: `--vendor-background #FAFAFA`, `--vendor-surface #FFFFFF`, `--vendor-foreground #0C3535`, `--vendor-muted #6B7280`, `--vendor-muted-strong #4B5563` (added S3), `--vendor-border #E5E7EB`, `--vendor-track #F3F4F6` (added S3, the ratified light progress-track value). All seven are exposed as Tailwind utilities (`bg-vendor-surface`, `text-vendor-foreground`, etc. - `@theme inline` mappings added S3, they previously existed only as unconsumed CSS variables).
- Wired S3 (R1 batch): `app/partner/**` plus the partner-only components `lead-agency-filter.tsx` and the light-content portions of `partner-layout.tsx` (its header/nav chrome stays on dark agency tokens by design - see below). Shared components used by the dark portal or guest surfaces (`help-term.tsx`, `terms-disclosure-section.tsx`, `dashboard-show-more.tsx`) were left out of scope even though their light-theme branches hardcode the same literals - migrating a shared file for one consumer's sake risks the others. Literal-to-token mapping used:

  | Literal | Token |
  | --- | --- |
  | `#0C3535` (any property: bg/text/border/fill/ring/accent/...), `text-gray-700`, `text-gray-800`, `text-gray-900` | `--vendor-foreground` |
  | `text-gray-600` | `--vendor-muted-strong` |
  | `text-gray-500` | `--vendor-muted` |
  | `text-gray-400` | `--vendor-muted/70` |
  | `text-gray-300` | `--vendor-muted/50` |
  | `bg-white` (opaque only, not `bg-white/NN`) | `--vendor-surface` |
  | `bg-gray-50` | `--vendor-background` |
  | `bg-gray-100` on a literal progress track/meter | `--vendor-track` |
  | `border-gray-200`, `border-gray-300`, `border-gray-400` | `--vendor-border` |
  | `border-gray-100` | `--vendor-border/50` |

- Ruled (S3, resolves the earlier flag): plain `gray-100`/`gray-200`/`gray-300` are sanctioned as-is, undyed, for light-portal utility roles that are not a status or a brand color - skeleton shimmer, disabled/read-only input fill, avatar/icon-tile placeholder, neutral badge fill, and hover overlays. These are chrome-level utility grays, not semantic tokens, so they do not get a `--vendor-*` name of their own; using the raw Tailwind gray scale here is correct, not a literal-that-should-have-been-a-token.
- `partner-layout.tsx`'s `<header>` (nav bar) is deliberately dark, matching the agency portal's chrome, not the vendor tokens - it stays on `bg-[#0C3535]`/`text-white`/`--accent` as before. Its tooltip, account dropdown, and footer are genuine light surfaces and were migrated.
- Same lime primary for CTAs. The two portals are intentionally different atmospheres for different audiences; the audit checks each portal is internally consistent, not that they match each other.

**Status colors (shared semantics across both portals, via tokens):**

| Meaning | Token / color | Examples |
| --- | --- | --- |
| Positive / money in / success | `--success #4ADE80` | Paid to Date, "1 awarded", saved confirmations |
| Pending / caution / approaching | `--warning #FBBF24` | Pending badges, 80% usage banner |
| Blocked / overdue / destructive | `--destructive #EF4444` | 100% usage banner, OVERDUE milestones, Blacklisted |
| Informational / neutral status | Blue | RFP BROADCAST badge, Awarded chip |
| Muted / inactive | Gray | NOT YET INVITED, disabled rows |

Ruling on green: `green-*` and `emerald-*` both currently express success. Consolidate to the `--success` token family (done S3). One green, one meaning. Two named exceptions stay their own hue rather than success or neutral: `agency/dashboard.tsx`'s `active_engagements` stage color is teal (an arbitrary stage-map hue, parallel to indigo/sky/slate, not a literal status), and the "scheduling" document-category tag in `stage-03-onboarding.tsx` is teal to match its legal/brand/process siblings' structure. The Google Docs/Slides file-format indicator in `agency/documents.tsx` stays green as Google's own brand color, not a status. `agency/msa/page.tsx` is parked for product review and was left untouched.

**Purple (ruled, amended S3).** Purple/violet has exactly one sanctioned semantic: role/mode identity - the role toggle, sign-up role-selection cards, and role badges (partner = purple, agency = its portal accent/blue). Meeting-request bid intent is cyan in the actual codebase, not purple - recorded as reality rather than migrated, since cyan was already the live, working treatment everywhere the meeting-request action and its intent badge appear.

Everything else currently purple falls back: legal-category tags and "Internal Only" badges go neutral/blue, "Shortlisted" status goes blue, decorative purple icon tiles (settings, admin, modals) go neutral. (S3 batch; agency-broadcast-responses.tsx, which held purple uses, was deleted in S3 as dead code.)

**Rules:**
- A status color always means the same thing. Never use amber decoratively.
- Progress tracks are neutral (`bg-white/10` dark; `bg-vendor-track` light, ratified S2, wired to a token S3) - never a tint of the fill color. 0% must be visually unmistakable from 100%. (Codified from the bg-primary/20 incident.)
- Severity thresholds are shared app-wide: green < 80% ≤ amber < 100% ≤ red.
- Overdue (ruled, amended S3): overdue = unpaid AND due date before today, compared in calendar days with no grace period. A past-due, unpaid milestone switches its Pending label to an OVERDUE badge - destructive red text on low-alpha red background, date rendered red - and the row surfaces in the attention/response queues. Amber means approaching; red means past. Derived only in the shared milestone summarizer (`summarizePartnerMilestones`) so both portals agree automatically - no other function may compute overdue status independently.

## 5. Typography

Three roles, consistently cast (real typefaces, loaded via next/font):

- **Display** - Barlow Condensed (`font-display`), bold: page titles, big stat numbers. The oversized bold page title is a signature - keep it, one per page.
- **Body** - Inter (`font-sans`): descriptions, table cells, form content. Sentence case.
- **Utility/mono** - IBM Plex Mono (`font-mono`), uppercase, `tracking-wider`: section eyebrows (NEEDS YOUR ATTENTION, CURRENT PLAN), nav items, metadata lines, table headers. The second signature - mono eyebrows give the product its control-surface character. Rule: mono-caps = label/chrome, never content.

**Type scale (ruled, implemented S3).** 10px is blessed as a named token - it is the most-used size in the product (the mono eyebrow/metadata size) and gets a home: `--text-2xs` (10px, 14px line-height) is defined in `app/globals.css`'s `@theme inline` block and exposed as the `text-2xs` utility. Every `text-[9px]`, `text-[10px]`, and `text-[11px]` arbitrary value in the codebase has migrated to it. The full sanctioned scale:

| Step | Use |
| --- | --- |
| `text-2xs` (10px) | Mono eyebrows, metadata lines, badge text |
| `text-xs` | Dense secondary text, table cells |
| `text-sm` | Default body |
| `text-lg` / `text-xl` / `text-2xl` / `text-3xl` | Card titles, section headers, stat numbers |
| `text-4xl`+ | Display page titles only |

Arbitrary pixel sizes outside this scale are an audit finding. Stat numbers share one size within a metrics row.

**Casing (ruled) - the three-tier system, one rule per tier:**
1. MONO CAPS: chrome only - eyebrows, nav, table headers
2. Title Case: page titles only (they are workflow surface names: Dashboard, Vendor Pool, Bid Management) - one per page
3. Sentence case: everything else, including card titles

If it's not the page title and not a mono eyebrow, it's sentence case. No debates.

**Buttons (ruled):** sentence case everywhere ("Send invitation", "Add 10 vendors to Pool"). Product nouns keep their capital (Pool, RFP, Vendor Pool).

**Keep-capitals lexicon (ruled, S3).** Three categories of exception to sentence case, applied everywhere - card/section/dialog titles, empty-state headings, and button labels alike:
1. Acronyms/initialisms always keep caps: RFP(s), NDA, MSA, IP, AI, PDF, DOCX, PPTX, CSV, FAQ, USD, MBE, MWBE, DBE, VBE, SDVOB, LGBTBE, DOBE, URL, ID, SOW (list illustrative, not closed - any genuine acronym follows the same rule).
2. Product/brand nouns keep caps: Ligament, Pool, Vendor Pool, Master RFP, Lightning RFP, Google, Gmail, Outlook, Excel, Calendly, LinkedIn, Net 30/Net 60-style terms, client/company names.
3. Nav surface names keep Title Case when a string names or links to that surface (Summary Dashboard, Vendor Pool, Agency Network, RFP Broadcast, Bid Management, Onboarding, Delivery & Projects, Delivery Performance, Legal & Compliance, Master Documents, Marketplace): "Go to Bid Management" and "Start Onboarding" (a real link to /agency/onboarding) keep caps; the same word used descriptively ("during onboarding", "Send onboarding packet") is sentence case.

Mono-caps chrome (eyebrows, nav labels, table headers, form labels, wizard step-nav chips, metadata lines) is exempt from all of the above - it's chrome regardless of source-string case, since CSS uppercase renders it in caps either way.

## 6. Layout & spacing

- **Radius grammar (ruled):** cards = `rounded-lg` (10px base radius), pills/badges/avatars = `rounded-full`, inputs/small controls = `rounded-md` (8px), sheets/modals may use `rounded-xl` (14px). `rounded-2xl` and `rounded-none` usages are S3 sweep items. Nothing else.
- **Card grammar:** content lives on rounded-lg panels - 1px subtle borders (`--border`) on dark; flat white cards with `--vendor-border` on light, shadow-less.
- **Page skeleton (portal pages):** title row (+ page-level actions right-aligned) → attention/action section → metrics → content sections. Agency portal runs fluid beside the sidebar (intended); partner portal centers on a max content width, ratified S2 as `max-w-4xl`.
- **Section rhythm:** consistent vertical gap between sections, ratified S2 as `space-y-8`; sections never share borders.
- **Metrics rows (ruled):** unified within each portal, deliberately not across portals - the two-atmospheres principle. Agency: icon top-left, number, MONO label beneath (dense control-surface). Partner: centered number, MONO label (calmer, guest-facing). Calibrated-stat basis subtitles allowed in both. Zeros render as 0, never dashes, never hidden.
- **Lists:** rows are single-line-dominant: title (bold) + one metadata line (mono, ·-separated) + right-aligned action or timestamp. No cards-within-cards.
- **Long lists:** cap at 5 visible + "Show all N" / "Show less"; section header carries the count and a collapse chevron; collapse state persists per section.
- **Responsive:** everything stacks single-column below 768px; metric cards wrap; tables scroll or stack. Sidebar is the only agency nav (intended - no separate mobile nav).

## 7. Components

**Buttons (hierarchy - max one primary per view):**
- Primary: lime fill, dark text ("+ New project", "Add 10 vendors to Pool", "View plans")
- Secondary: outlined, transparent fill ("Close", "Back", "View profile")
- Tertiary/link: text + arrow ("View all →", "Payment settings →")
- Destructive (ruled, amended S3): red appears only at the moment of consequence. Inline/row-level destructive actions render secondary-outlined with red text, never solid. The confirming dialog's primary action is solid `--destructive` red with white text. No solid red button ever sits passively on a page. Implemented in the shared button component (`components/ui/button.tsx`) as `variant="destructive"` (solid, dialog confirms) and `variant="destructive-outline"` (outline, inline/row actions) - both built on the `--destructive` token, never a raw red hex.

**Badges & chips:**
- Status badge: small rounded-full pill, mono-caps `text-2xs`, semantic color (INVITED, DISCOVERED, PENDING, AWARDED, NEW, OVERDUE)
- Filter chips: outlined pills, lime outline/fill when active
- Count-in-header: "Needs your response (16)" - parenthetical count in the section header, always present when collapsed

**HelpTerm (new, from Session 0):** the in-context education primitive. A glossary term rendered with a quiet dotted underline; hover or tap opens a definition popover. Always on, no mode toggle. Content comes from lib/glossary.ts (source doc: docs/glossary-content.md). Applies on both portals and guest surfaces wherever a term of art appears (terms disclosure fields, business criteria designations, insurance types, scoring criteria, per-bid IP stance). Popover surface uses the near-opaque `--popover` token - never translucent over content.

**Hover-intent standard (new, from Session 0):** any hover-opened popover follows the HelpTerm interaction contract: short open delay on pointer enter; close timer on leave that is cancelled by re-entry; opening clears any pending close and vice versa; keyboard opens only on `:focus-visible`; Esc closes and focus stays on the trigger; no auto-focus into read-only popover content (prevents blur/refocus loops). Tap toggles on touch. This is the app-wide rule for anything that opens on hover.

**Progress bars:** neutral track, semantic fill, thin height; value clamped 0-100 visually with true numbers in text.

**Tabs / segmented controls:** pill segments; active = filled.

**Tables:** MONO uppercase `text-2xs` column headers, generous row height, right-aligned amounts and dates, status badge last column. Empty table = single quiet line, never an empty header row over whitespace (partner payments is the verified reference).

**Accordions (grouped lists):** entity header (icon + name + count + summary stat) with chevron; Bid Management is the reference.

**Sheets & dialogs:** right-side sheet for multi-step flows; centered dialog for confirmations and gates. Titles bold display; one primary action.

**Forms:** labels above fields, mono-caps labels; required marked; inline validation with reasons.

**Skeletons:** every fetched section has a skeleton; no piecemeal pop-in.

## 8. Patterns (behavioral)

- **Attention queue:** always above metrics; rows = icon + sentence + chevron; correct pluralization; "You're all caught up" when empty.
- **Activation checklist (new, from Session 0):** brand-new agency accounts see a state-driven dashboard checklist (import partners → create project → broadcast RFP → review first bid) that derives from real account state and shrinks as steps complete; it disappears entirely for established accounts. Agency-only by design - partner activation is served by the profile banner and the Needs Your Response queue. Demo mode derives checklist state from fixtures so it self-hides.
- **Empty states:** one quiet sentence, present tense, points at the action or the future. No illustration blocks, no large hollow cards.
- **Calibrated stats:** a rate or score carries its basis as a subtitle ("100% / 1 of 1 awarded", "3 in review"). Never a naked percentage on thin data.
- **Timestamps:** real and relative ("13d ago") for feeds; absolute for records (Jun 22, 2026). Never vague words.
- **Money (ruled) - the container test:** if the container exists, show the number; if the container doesn't, use words. An awarded engagement with nothing paid shows honest $0 - the zero informs. No awarded engagements at all shows "No spend yet" - a $0 there would imply a ledger that doesn't exist. Any future surface applies this without asking.
- **Gates & limits:** warning at 80% (amber, dismissible per session), block at 100% (red, not dismissible, modal on action, server-enforced). Upgrade CTAs go to /pricing.
- **Consent surfaces:** relationship states are earned, never asserted - "Already on Ligament" badges, invite → accept, per-row skip reasons.
- **Demo mode:** every fixture behind isDemoMode(); demo shows a rich world; real shows the truth. Future sample projects must be badged and excluded from all real metrics.

## 9. Copy voice

- Plain verbs, active voice, user's vocabulary (partners, bids, RFPs - not records, entities).
- Buttons say what happens: "Add 10 vendors to Pool", not "Submit".
- Headers are addressed to the reader and action-first: "Needs your attention", "Complete profile".
- Helper text anticipates: export guidance, next-step hints, per-row reasons.
- Errors say what happened and what to do; never apologize, never vague.
- Numbers agree with their nouns (1 update needs / 2 updates need).
- House rule: no em dashes anywhere in product copy - hyphens or rewrite, no carve-outs.
- Empty-value fallback glyph (ruled, amended S3): a hyphen (`-`), never an em dash, never a vague word.

## 10. Anti-patterns (codified)

- Hardcoded or unguarded placeholder values reaching real users.
- Progress track tinted with the fill color (0% reads as 100%).
- The same quantity computed in two places.
- Duplicate stat bands showing overlapping numbers on one page.
- Naked percentages or scores without their basis.
- "Recently" / missing timestamps.
- Decorative form fields that persist nothing.
- Dead-end flows for a known user state.
- Sections that force-scroll past them (uncapped lists without collapse).
- Ghost pages reachable or half-reachable from nowhere.
- Raw hex literals where a token exists (46 lime literals, the hardcoded light portal).
- Arbitrary pixel type sizes outside the sanctioned scale.
- Translucent popover surfaces over content.

## 11. Audit rubric

Walk every route in both portals + marketing + auth. Score each surface 0-2 on each axis; anything scoring 0 anywhere goes on the fix list with its bucket.

| Axis | 2 | 0 |
| --- | --- | --- |
| Honesty | All values real/absent honestly | Any placeholder or fake value |
| Hierarchy | Action first, one primary CTA | Status wall, competing CTAs |
| Consistency | Tokens, badges, buttons match doc | One-off styles, rogue colors |
| Copy | Voice rules met, correct grammar | Vague, system-speak, dead labels |
| States | Loading, empty, error, zero all designed | Missing or accidental states |
| Responsive | Clean under 768px | Broken/fixed grid |

Buckets for findings: **mechanical** (batchable Claude Code fixes) / **copy** / **redesign candidate** (own roadmap item).

## 12. Decision log (Session 1, Aug 4 2026)

1. `--text-micro` 10px blessed as `text-2xs`; 9px/11px migrate to it (S3)
2. Radius grammar: cards lg / pills full / inputs md / sheets xl; 2xl and none swept (S3)
3. Lime literals → token classes; green/emerald → `--success` family (S3)
4. Purple narrowed to role identity + meeting-requested; all else falls back (S3)
5. Partner portal wired to `--vendor-*` tokens (S3, possibly own chunk)
6. Popover opacity fixed at token level (0.95); retest screenshot confirms visually
7. Casing three-tier: MONO CAPS chrome / Title Case page titles / sentence case everything else
8. Buttons sentence case, product nouns capitalized
9. Destructive: outlined red inline, solid red only as dialog confirm
10. $0 container test
11. OVERDUE badge treatment, derived in the shared milestone summarizer
12. Metric card anatomy unified per portal, not across

**Carried to S2:** light-mode progress track value; partner max content width value; section rhythm value; RFP Broadcast wizard walk.

## 13. Decision log (Session 3, Aug 4 2026)

13. Light-mode progress track ratified as `bg-gray-100`; partner max content width ratified as `max-w-4xl`; section rhythm ratified as `space-y-8` (S2 carried values, closed out)
14. Purple narrowed further: role/mode identity is the only sanctioned purple semantic. Meeting-request intent is cyan in practice, recorded as reality rather than migrated
15. Overdue formally defined: unpaid AND due date before today, calendar days, no grace period; derived only in `summarizePartnerMilestones`
16. Empty-value fallback glyph ruled as a hyphen (`-`); em dashes banned with no carve-outs
17. Destructive convention implemented: `variant="destructive"` (solid) and `variant="destructive-outline"` (outline) in the shared button component, both on the `--destructive` token
18. Legacy `/settings/*` island, `/vendor`, `/ai-engine`, `/agency/pool/marketplace`, `/partner/discover`, `/password` + `/api/password`, and `components/agency-broadcast-responses.tsx` deleted as zero-reference dead code. `/partner/invitations` kept as a redirect stub to `/partner/network` - it is live-linked from the partnership invite email flow and the auth callback's post-login destination, not a true orphan
19. Fake `DashboardAlertBanner` deleted along with its usage on `/agency/payments` - fabricated alerts reachable by authed users, violating Honest by construction
20. Green/emerald consolidated to `--success` app-wide, with two named teal exceptions (agency dashboard stage color, onboarding "scheduling" category tag) and two named exclusions (Google-brand file-format green, the parked `agency/msa` page)
21. Checked-checkbox styling standardized on `data-[state=checked]:bg-accent data-[state=checked]:border-accent`, matching the convention already used by every other checkbox in the app
22. Solid button/step-indicator fills on `--success` use `text-accent-foreground` for contrast, not white - `--success` (`#4ADE80`) is too light for white text to read reliably, the same reasoning that already governs text-on-lime
23. `--vendor-muted-strong` and `--vendor-track` added to the vendor token set; all seven vendor tokens wired into `@theme inline` as real Tailwind utilities; `app/partner/**` plus the partner-only components migrated off hardcoded literals per the mapping table in §4
24. Plain `gray-100`/`gray-200`/`gray-300` ruled sanctioned, not a migration gap, for light-portal skeletons, disabled fills, placeholders, neutral badges, and hover overlays - closes the flag raised in the R1 batch. `partner-project-production-detail.tsx` deleted as zero-importer dead code, discovered during the same batch. `request-invitation-modal.tsx` was NOT deleted despite an earlier zero-importer finding - `contexts/paid-user-context.tsx` renders it live app-wide; the original grep sweep had missed the `contexts/` directory. `lead-agency-filter.tsx`'s loading skeleton and clear-filter button, found using the dark portal's `bg-white/5`/`text-foreground` directly on the light page, moved onto the sanctioned gray/vendor-foreground treatment
25. Copy casing normalized against the keep-capitals lexicon (§5) across app/ and components/, excluding marketing pages, parked files, and API/AI prompt strings. Card/section/dialog titles, empty-state headings (including the shared `empty-state.tsx` preset config, which fixes every consumer at once), and button labels moved to sentence case except where an acronym, product noun, or nav-surface link applies. Mono-caps chrome left untouched regardless of source-string case, including a few sites where the `uppercase` CSS class turned out to be missing (flagged, not fixed - out of scope for a casing pass) - a real styling gap, not a casing violation, since whatever case is written doesn't display as chrome without that class
26. Overdue implemented in `summarizePartnerMilestones` (now returns `{ paid, pending, overdue }`, date comparison as plain "YYYY-MM-DD" string equality, no Date-object math) and rendered on the partner dashboard's Needs Your Response queue, Upcoming Payments table, and `/partner/projects`' own milestone list - the last of these is the real live payments surface. `app/partner/payments/page.tsx` was discovered to be dead code: its default export is a redirect to `/partner/projects` ("payments are now managed" there), so the rich milestone UI it still contains (now also updated for consistency) is unreachable by any real user. A second, more consequential bug surfaced in the same pass: the shared summarizer's "paid" check compared against a status value of `"paid"`, which the schema never writes - the real terminal status is `"payment_received"` (confirmed against the write site in `app/partner/projects/page.tsx`'s `handleConfirmPayment` and the API route's raw passthrough) - so every real milestone was silently miscounted as pending regardless of actual payment state. Fixed via a new shared `isMilestonePaid` helper, since overdue correctness depends on accurate unpaid detection and the same wrong literal was duplicated in three places. No agency-side attention-queue equivalent was built - `app/api/agency/dashboard/route.ts` does not fetch milestone data at all, and the ruling was to flag rather than add a new fetch.
27. Agency metrics rows on `/agency/pool`, `/agency/project`, and `/agency/documents` restyled to the ruled icon-top-left anatomy, matching `/agency/dashboard`'s `FunnelMetrics`. Values and counts unchanged, anatomy only. `/agency/documents`' 5-metric grid gained a responsive `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` reflow to keep the new icon tiles from crowding at narrow widths.
28. `--text-2xs` implemented as a real token (§5) and every `text-[9px]`/`text-[10px]`/`text-[11px]` arbitrary value in app/ and components/ (excluding the parked agency/msa, agency/cashflow, agency/utilization, agency/payments pages) migrated to it - 883 sites across 70 files. Three sites paired the arbitrary size with an explicit `leading-relaxed`/`leading-snug` modifier and were converted by hand rather than by script; the `leading-*` class was kept rather than removed, since it should still override the token's own built-in line-height via the shared CSS custom property. Post-pass grep found no other arbitrary `text-[Npx]` size anywhere in the codebase - the 9/10/11px family was the entire violation set. `components/ui/sidebar.tsx` (a wholly-unused shadcn scaffold, zero importers for the file or any of its 24 exports) and the unused `LeadAgencyFilterCompact` export in `lead-agency-filter.tsx` were deleted, each gated on a fresh full-repo grep.
29. Vendor terminology ruling (Aug 5 2026): "partner"/"Partner Agency" as the vendor-side entity renamed to "vendor"/"Vendor" across user-facing copy app-wide - both portals, marketing, auth, FAQ, glossary, email/notification copy, and toasts/error strings. `Partner Pool` renamed to `Vendor Pool` everywhere it names that nav surface (§3 reference table, §5 keep-capitals lexicon and Title Case example, button copy examples), including the `Import Vendors sheet` reference-surface entry. Not touched, by design: `partnership`/`Partnership` (the relationship concept - "Active Partnership," "Partnered since" stand unchanged), `Lead Agency`, routes/URLs, DB columns and tables, API fields, and all component/file/function/variable names (e.g. `partner_id`, `partnerships` table, `partner-layout.tsx`, `requirePartnerRole()`) - code identifiers are stable regardless of the display-copy rename. This document's own historical narrative (session logs, file-path references, architecture descriptions using "partner" to mean the underlying role/portal/folder) is left as accurate history rather than rewritten, since it describes what the codebase was called at the time, not current user-facing copy.
31. Budget categories and evaluation criteria (Phase 2, Aug 11 2026): an RFP can now carry two
new per-RFP structures, and they are deliberately kept apart because they answer different
questions. **Budget categories** are cost headings every bidder fills in with their own
subtotal, optionally itemized, rolling up to a derived total - the vendor-facing block is
theme-aware (`bid-budget-categories.tsx`), the agency-facing builder is dark-only
(`budget-category-editor.tsx`), and the always-present "Additional items" category carries the
existing amber warning semantic because uncategorized spend inside a categorized budget is a
genuine soft-warning condition, not decoration. **Evaluation criteria** are the scored quality
dimensions a bid is judged on, weighted, capped at 8. Ruling: the two must never read as
variations of one control. Business criteria are confirmable compliance facts (checkboxes, a
required/preferred tier, a vendor either holds the certification or does not); evaluation
criteria are scored judgments (named rows, a weight column, a scale icon, no tier). They sit in
separate cards in the wizard with the budget card between them, and the glossary defines each
against the other. One source per number is enforced structurally rather than by convention:
when an RFP defines categories, the legacy single budget input is replaced in place by the
derived sum, read-only, so no surface ever offers two editable versions of the same figure.
Money follows the container test unchanged - an honest $0 in a category is a complete answer,
an empty field is not. Cross-currency comparison is refused rather than approximated: amounts
render exactly as submitted, a mixed-currency comparison says so, and no exchange rate is ever
invented. `Budget category` and `Evaluation criteria` added to the glossary with `HelpTerm`
placement on both new blocks.

30. Requirement tiers (S4-1, Aug 6 2026): business criteria and scope requirements on an RFP now carry a binary priority - required or preferred, no third tier - surfaced via a two-way segmented `PriorityToggle` pill in the RFP Broadcast wizard (existing control pattern, not a new one) and rendered on both bid-form paths (portal and guest) as a required-first block with a "Confirm all" action, per-item "Cannot meet" override with an inline reason field, and a quiet "N of M required confirmed" progress line. Submission is never hard-blocked - an unmet required item just needs its cannot-meet reason, which then renders as a red compliance flag agency-side. New shared component `components/business-criteria-requirement-block.tsx` is theme-aware (light for the vendor portal's `--vendor-*` tokens, dark for the guest page's agency-dark chrome) rather than assuming one theme, since the two bid-form paths sit on opposite sides of the two-atmospheres rule. The compliance matrix (compare view + bid detail) renders before scoring/analysis per the honesty doctrine's "renders nothing rather than fake a pass" - an RFP with no explicit requirement-tier data shows no matrix row at all, never a fabricated "fully compliant." `Required criterion` / `Preferred criterion` added to the glossary with `HelpTerm` placement on the new block's section labels.
