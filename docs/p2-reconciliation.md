# Phase 2 Plan Reconciliation

Written at the start of the Phase 2 trio run (Aug 11, 2026), before any Phase 2 feature code.
`docs/s4-phase2-plan.md` was authored Aug 5. Seven things shipped between then and now that the
plan could not have known about. This document re-verifies every plan assumption against the
code as it stands today, adopts all eight of the plan's judgment calls under Greg's standing
mandate, and states exactly where each new feature lands inside the F1 bid form.

No SQL was executed against any database during this run. The live column lists quoted below
come from a single read-only fetch of the PostgREST OpenAPI schema description, which is
metadata, not a query.

---

## 1. What changed under the plan

| Shipped since Aug 5 | Where | Effect on the plan |
| --- | --- | --- |
| F1 bid form rebuild | `components/bid-form-collapsible-section.tsx`, `lib/bid-form-readiness.ts`, both bid pages | The plan assumed a flat bid form. There are now six collapsible sections, a sticky readiness bar, a preflight line, and portal autosave. Budget categories and proposal sub-fields must slot into that structure, not sit beside it. |
| Shared `CurrencyInput` | `components/ui/currency-input.tsx`, `CURRENCY_SYMBOLS` in `lib/rfp-response-fields.ts` | The plan wrote "single subtotal input" generically. There is now one blessed money control, symbol-aware, storing raw digits. Every new money field uses it. Also softens judgment call 6 (see below). |
| Shared business-criteria editor | `components/business-criteria-editor.tsx` (+ `PriorityToggle`) | Gives the wizard-side editor pattern the new evaluation-criteria block must match rather than invent. |
| Deadline capture + urgency | `lib/deadline-urgency.ts`, `response_deadline` on both RFP tables | P2-4's close-at-deadline toggle has a real deadline to hang off, on both flows. Migration 074 is applied. |
| G1 attach / H5 collapse | `lib/magic-token-attach.ts` | Magic-link RFPs now materialize a `partner_rfp_inbox` row. Directly relevant: see section 3. |
| H2 award partnership ladder | `lib/award-partnership-resolution.ts` | No Phase 2 impact. Noted as verified, not assumed. |
| Requirement tiers (S4-1) | migration 071 | **071 is applied** (`business_criteria_acknowledgments` is live on `partner_rfp_responses`). The plan's prerequisite 1 is satisfied. |

Verified live schema, Aug 11:

- `partner_rfp_responses` has no `budget_lines` and no `proposal_sections`.
- `rfp_magic_tokens` has no `budget_categories`, no `evaluation_criteria`, no `close_bidding_at_deadline`.
- `partner_rfp_inbox` has no `close_bidding_at_deadline`.
- `bid_evaluation_scores` has no `rfp_criterion_key`; `criterion_id` is still `NOT NULL`.
- **`rfp_budget_categories` and `bid_budget_lines` do not exist.** 072 has never been applied,
  which is what makes re-authoring it free (section 3).

---

## 2. Plan prerequisites, re-verified

1. **071 applied.** Confirmed live. Plan satisfied.
2. **072 applied at the start of Phase 2 day.** Not done, and deliberately not done: this run
   authors migrations only. More importantly 072's shape changed (section 3), so applying the
   Aug 5 draft would have created two tables nothing will ever write to.
3. **RLS policies for the two new tables.** Dissolved, not deferred. The re-authored 072 creates
   no tables, so there is nothing to write policies for. See section 3 and judgment call 2.

---

## 3. The plan's fatal assumption: category identity across a broadcast

The plan's compare-view section says category identity "is shared across all bids being
compared - a real win over today's single freeform `budget_proposal` string." Against the
Aug 5 schema draft, that is false.

`app/api/agency/broadcast-rfp/route.ts` writes **one `partner_rfp_inbox` row per (scope item,
recipient)**. A broadcast to 6 vendors across 3 scope items creates 18 inbox rows. The Aug 5
072 parents each budget category on a single `inbox_item_id`, so the wizard's one set of
categories would have to be copied 18 times, producing 18 distinct sets of category UUIDs. Two
vendors bidding the same scope item would hold budget lines pointing at *different* category
rows with the same name. The compare view would then have to reconcile by name anyway, which is
exactly the thing the relational model was supposed to avoid.

The codebase already solved this problem once, for the same shape of data. Per
`docs/s4-discovery.md` §3: `business_criteria_required` travels inside
`partner_rfp_inbox.master_rfp_json` for the wizard flow and as its own JSONB column on
`rfp_magic_tokens` for the magic-link flow. The blob is duplicated per inbox row, but the
*keys inside it* are stable and identical across every copy, so identity survives the fan-out
for free.

**Ruling: re-author 072.** Budget categories follow the `business_criteria_required` precedent
exactly:

- Wizard flow: `partner_rfp_inbox.master_rfp_json.budget_categories` (no column needed, the
  blob already exists and already fans out).
- Magic-link flow: new `rfp_magic_tokens.budget_categories` jsonb column.
- Vendor's numbers: new `partner_rfp_responses.budget_lines` jsonb column, mirroring
  `business_criteria_responses` which sits on the same row and already serves both bid paths.

Consequences, all improvements:

- Category identity is a stable client-generated key inside the blob, identical across every
  inbox row from one broadcast. The compare view's premise becomes true.
- No new tables, so no new RLS policy surface, so the plan's open item 3 and judgment call 2
  both dissolve.
- Guest writes need no new access model: they go through the existing service-role guest route
  that already writes `business_criteria_responses` on the same row.
- Pre-migration write guards are the 42703 retry pattern this codebase has already used twice
  (`saveGuestResponseRow`, `saveResponseRow`), not a new mechanism.

What is lost: budget lines cannot be queried relationally. Nothing needs to. Every consumer
(compare view, bid detail, AI analysis) already loads whole response rows.

---

## 4. The eight judgment calls

Every one is adopted. Four are adopted unchanged; four are adopted with a conflict against a
newer ruling or component resolved **toward the newer**, as instructed.

### 1. Own wizard step vs shared step for the category builder

- **Plan recommends:** own step, "Budget Categories," inserted after Business Criteria and
  before Scope Allocation.
- **Adopted: shared step. Resolved toward the newer ruling.**
- **Conflict:** this run's scope guard says *do not restyle the wizard beyond adding the new
  blocks in its existing patterns*. A new step is not a new block. It renumbers steps 3 through
  6, rewrites the `steps` array and the step-nav chip rail, and changes the persisted draft
  shape (`currentStep` is stored as `1|2|3|4|5|6` in localStorage, so every in-flight draft
  would resume on the wrong step). That is structural, and a design pass owns it later.
- **Resolution:** both new wizard blocks render as their own `GlassCard` inside the existing
  Step 2, "Master RFP + Business Criteria", directly below the Business criteria card. Same
  card grammar, same `space-y-6` rhythm, no renumbering, no draft-shape break. Step 2's label
  is left alone; renaming it is copy work for the design pass.

### 2. Guest RLS-direct-write vs service-role route for budget lines

- **Plan recommends:** service-role route, matching the existing guest precedent.
- **Adopted, and the question dissolves.** With budget lines stored as a JSONB column on
  `partner_rfp_responses` (section 3), guest writes travel the exact path
  `business_criteria_responses` already travels: `app/api/rfp/guest/[token]/route.ts` writing
  the same row with the service client. No new table, no new policy, no new access model. The
  plan's instinct was right; the re-authored schema makes it automatic rather than a decision.

### 3. Canonical preset category list ownership

- **Plan recommends:** ship a sensible engineering default (its 9 names), let Greg edit copy later.
- **Adopted, reshaped toward the newer instruction.**
- **Conflict:** this run names three presets, "standard production, retainer, project fee" -
  three *bundles*, not one flat list of nine categories.
- **Resolution:** three named bundles in `lib/budget-categories.ts`. The plan's nine names
  become the Standard production bundle almost verbatim; Retainer and Project fee are short
  bundles appropriate to their shape. Copy stays editable in one file, per the plan's intent.

### 4. Category cap: hard block vs soft warning

- **Plan recommends:** soft warning, matching the wizard's validation posture.
- **Adopted for budget categories** (this run says "5-10 guidance", which is guidance, not a cap).
- **Diverges for evaluation criteria, toward the newer instruction:** this run says "cap 8
  enforced app-side" and "cap 8 with quiet guidance". Those are the same number said twice, once
  as an enforcement word. So: evaluation criteria hard-stop at 8 (the Add control disables with
  a quiet line), budget categories only advise past 10. Two different rules for two different
  blocks, each stated where it applies.

### 5. Paste parser bad lines: reject-all vs skip-and-flag

- **Plan recommends:** skip-and-flag, matching `spreadsheet-import-panel.tsx`.
- **Adopted unchanged.** Parsed rows import; unparseable rows are listed back with a per-line
  reason. Same house style as the Import Vendors grouped review.

### 6. Multi-currency paste support

- **Plan recommends:** no, USD-style `$1,234.56` only for v1.
- **Adopted, minimally extended toward the newer component.**
- **Conflict:** G2 shipped `CURRENCY_SYMBOLS` in `lib/rfp-response-fields.ts` as the one
  currency-symbol map, consumed by the shared `CurrencyInput`. Hardcoding a `$`-only stripper
  next to it would be a second source for the same fact.
- **Resolution:** the parser strips any symbol present in `CURRENCY_SYMBOLS`, plus commas and
  whitespace. It still does not attempt locale decimal-comma parsing (`1.234,56` stays
  unparseable and gets flagged), which is the actual substance of the plan's "no" - the point
  was not to guess numeric grammars, and that holds.

### 7. "Flagged" Additional items visual treatment

- **Plan recommends:** the existing amber/warning semantic.
- **Adopted unchanged.** Checked against the design language's rule *never use amber
  decoratively*: this is not decorative. Uncategorized spend inside a categorized budget is a
  genuine soft-warning condition an agency should look at, which is exactly what amber means
  everywhere else in the app.

### 8. Mismatched itemization across bids in the compare view

- **Plan recommends:** show the subtotal only for that bid's cell, no fake itemization.
- **Adopted unchanged.** Straight application of the honesty doctrine. A bid that gave one
  number gives one number.

---

## 5. Integration points: F1 sections and the sticky-bar readiness math

F1's bid form is six sections on both paths, wrapped in `BidFormCollapsibleSection`, with a
sticky bar whose count comes from `computeReadinessLabel(...openCounts)` in
`lib/bid-form-readiness.ts`. Today's portal call passes five counts:

```
computeReadinessLabel(
  proposalMissingForReadiness ? 1 : 0,
  budgetInvalidForReadiness ? 1 : 0,
  timelineInvalidForReadiness ? 1 : 0,
  termsRequired && !termsReadiness.satisfied ? 1 : 0,
  criteriaOpenCount
)
```

`computeReadinessLabel` is variadic and clamps negatives, so new counts are appended without
touching its signature or any existing caller's arithmetic.

**P2-1, budget categories.** Renders inside the existing **Bid response** section, immediately
below the budget row, only when the RFP defines categories. When categories exist, the legacy
budget amount input is replaced in place by a read-only derived total - one source per number,
never a second editable field that can disagree with the category sum. A new
`categoriesOpenCount` (categories with no subtotal entered) is appended to the
`computeReadinessLabel` call, so the sticky bar counts an incomplete budget the same way it
counts a missing proposal. The collapsed **Bid response** header summary gains an "N of M
categories" fragment when categories exist. The preflight line's first clause becomes
"a proposal, budget by category, and timeline" when categories exist and is untouched otherwise.
Honest `$0` is a complete category - the container test says the zero informs.

**P2-2, proposal sub-fields.** Renders inside the same **Bid response** section, above the
existing free-prose proposal textarea, as four optional inputs. **They add nothing to the
readiness math** - they are explicitly skippable, so counting them would make the sticky bar
lie about what blocks submission. The prose field's own required-ness is unchanged.

**P2-3, evaluation criteria.** Agency-side only. No bid-form surface, no readiness impact. Lands
in the wizard's Step 2 as its own `GlassCard` below Business criteria, and in the Evaluate tab
(`components/bid-evaluation-tab.tsx`) as the criteria actually scored.

**P2-4, close bidding at deadline.** Not a readiness item - it is a gate, not an open item. When
the RFP closes and the deadline has passed, the sticky bar's submit action is disabled and the
bar carries an honest closed message instead of a count. The readiness count still computes and
still renders, because a vendor looking at a closed form should still be able to see what their
draft was missing.

---

## 6. Cross-surface scoring: the approach

Two aggregates consume scores across RFPs. They are handled differently because they consume
different things, and the difference is stated rather than smoothed over.

- **Vendor reliability index / bid-to-delivery composite delta**
  (`app/api/agency/pool/[partnerId]/performance/route.ts`, `components/vendor-performance-history.tsx`):
  reads `bid_evaluations.composite_score` and `delivery_reviews.composite_score`. Both remain
  written by per-RFP evaluations exactly as before, because a composite is a weighted mean on a
  0-100 scale regardless of which rubric produced it. **Mapped via composite score, keeps
  computing, no change needed.**
- **Per-criterion bid-to-delivery delta table** (`lib/delivery-review.ts`,
  `components/delivery-review-sheet.tsx`): matches bid scores to delivery scores by
  `criterion_id` against the agency-global `bid_scoring_criteria`. A bid scored against per-RFP
  criteria has no row in that table, so nothing matches. **Explicitly excluded with honest basis
  text**, not silently rendered as an empty delta table - an empty table there reads as
  "delivery matched the bid exactly", which would be a fabricated agreement. The sheet states
  that this bid was scored against criteria defined for its own RFP and so has no shared
  criterion to compare against.

Never silently corrupted: no per-RFP score is ever written into `bid_evaluation_scores` with a
`criterion_id` borrowed from a same-named global criterion. Names collide; meanings do not.

---

## 7. Open questions logged, not blocking

1. **Step 2's label** still reads "Master RFP + Business Criteria" while the step now also holds
   budget categories and evaluation criteria. Renaming it is copy work owned by the design pass;
   renaming it here would be the wizard restyling this run is told not to do.
2. **Bundle copy** for the three budget presets is an engineering default per judgment call 3.
   Greg edits `lib/budget-categories.ts`.
3. **Weights UI granularity** for evaluation criteria: numeric input, defaulting to equal. A
   slider or a normalize-to-100 affordance is a design-pass question, not a Phase 2 one.
