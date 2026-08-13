# Client Profiles Live Walk Triage - Fix Batch Report

Aug 13, 2026. Seven commits, items 1 through 8. **Not pushed.** No SQL of any kind was executed.
No migration was written or run. Migration 077 was already applied and this batch needed zero
schema change.

`pnpm build` exit 0 and `npx tsc --noEmit` exit 0 after every commit. ESLint run report-only.

| Commit | Item |
| --- | --- |
| `eb7c44b` | ITEM 1 client profile documents could never be saved |
| `725f981` | ITEM 2 Master Documents lists client documents, labeled |
| `3052c9b` | ITEM 3 document pickers scoped to agency plus this client |
| `c457c5e` | ITEM 4 required count derived from tier |
| `664bb4a` | ITEM 5 + 6 + 7 + 8 |
| `ed46cf7` | ITEM 6 lint follow-up |

---

## No vendor-facing bug exists. 0.3 came back clean.

This is stated first because the brief asked for it to be, and the honest answer is the opposite
of what was feared.

`computeRequirementCompliance` in `lib/business-criteria.ts` already partitions by tier:

```ts
;(priority === "required" ? requiredItems : preferredItems).push(item)
```

Every vendor-facing consumer reads `requiredItems` / `requiredTotalCount` / `meetsAllRequired`
off that partition:

- the cannot-meet acknowledgment requirement (`business-criteria-requirement-block.tsx`)
- the gated-submit auto-expand and the sticky readiness count, via
  `bid-form-readiness.ts` and both bid pages
- the red compliance flags (`bid-detail-sheet.tsx`)
- the compare matrix "Meets required" row (`bid-compare-view.tsx`)

**A Preferred criterion has never been treated as Required anywhere in the vendor submission
path.** No bidder has been affected. The miscount was authoring-side only, in surfaces the
agency reads while writing an RFP.

---

## Phase 0 findings

### 0.1 The write path

Two paths, not one. `components/client-documents-panel.tsx` had `addLink` and `uploadFile` as
separate functions, each with its own hardcoded `section: "client"`. They only looked like one
path from outside, which is why both failed identically and would have needed fixing twice.

The live constraint is `agency_library_documents_section_check`, allowing only `'agency'` and
`'templates'`.

**Correction to A0.** The Workstream A discovery doc recorded that section and kind were "validated
in the API, not by a database CHECK". That was wrong, and the entire client-document feature was
built on it. OpenAPI introspection does not expose CHECK constraints, and no query was run to
confirm the claim. The feature has never once succeeded in writing a row.

### 0.2 Inventory of every `agency_library_documents` read

| File | Filters on | Feeds |
| --- | --- | --- |
| `app/api/agency/library-documents/route.ts` GET | now: `client_id` / `project_id` / nothing, via the shared query | all three surfaces below |
| `app/api/agency/clients/[id]/route.ts` | `client_id = profile id` | client profile page, and the RFP attach payload |
| `components/agency-document-library-manager.tsx` | nothing (browse everything) | Master Documents |
| `components/client-documents-panel.tsx` | `?client_id=` | client profile documents |
| `components/stage-03-onboarding-workflow.tsx` | was nothing, now `?project_id=` | onboarding package picker |
| `app/agency/page.tsx`, `app/agency/magic-rfp/page.tsx` | nothing | not a picker; reads the URL set for the item 1 dedupe |
| `app/api/agency/library-documents/file/route.ts` | `id` | download / open proxy |
| `app/api/projects/[id]/onboarding-packages/route.ts` | writes `library_document_id` | onboarding attach |

There are exactly **three** document pickers. Master Documents is the only browse-everything one.

### 0.3 What the count derives from

`app/agency/page.tsx` computed `businessCriteriaSummary` by counting checked designations,
checked insurance and the COI flag, then labelling the total `"N required"`. Checked is not
tier, so Required and Preferred produced the identical string. Same class, agency-facing:
`bid-compare-view.tsx`'s `businessCriteriaCounts`, whose cell says "None required" / "N of N met".

### 0.4 Onboarding's path to `client_id`

`Stage03OnboardingWorkflow` has `selectedProject.id` from `useSelectedProject`. It does **not**
have `client_id`: `mapDbProjectToMaster` maps a project row down to `{id, name, client, status,
createdAt}` and drops everything else, so the context type never carries it.

A clean path exists but not client-side. Resolved server-side by `project_id` instead of widening
the shared `MasterProject` type and the project context, which would have added surface area for
a value one join can produce. Item 3 is therefore fully implemented, not agency-only.

### 0.5 AI prompts and em dashes

**No instruction against long dashes existed anywhere.** Worse, the prompt templates were
themselves written with em dashes: 2 in `master-brief`, 4 in `rfp-output-template`, 6 in the
general `ai/route.ts`. A model mirrors the punctuation of its instructions, so our own prompt
copy is a plausible source of the output observed.

### 0.6 The attach path, end to end

`ClientSelector` fetches `/api/agency/clients/{id}`, which returns documents filtered on
`client_id` with **no section filter**. It therefore finds rows written under `section='agency'`
by item 1 correctly, and needed no change. Confirmed by reading, and it remains **unverified in
practice** because the write has never succeeded.

`ReferenceMaterialsInput`'s URL-as-idempotency-key holds: `seededUrlsRef` records every URL it
has ever seeded, so re-selecting adds nothing and a deliberately removed document is not
re-added.

**One real problem found here, fixed in item 1.** `saveReferenceMaterialsToLibrary` in both the
wizard and magic-rfp copies every reference material onto the AGENCY shelf with `client_id` null.
Once client documents flow into reference materials, a broadcast would republish a client-scoped
file as agency-wide, and item 3 would then be obliged to show it on every other client's picker.
It also duplicated a row on every re-broadcast, which it did before client profiles existed. Both
now skip URLs the library already holds.

---

## Per item

### ITEM 1 - `eb7c44b`

**Root cause:** both write paths sent `section: 'client'`, which the live CHECK rejects.

**Files:** `lib/library-documents.ts` (new), `components/client-documents-panel.tsx`,
`app/api/agency/library-documents/route.ts`, `app/api/agency/clients/[id]/route.ts`,
`app/agency/page.tsx`, `app/agency/magic-rfp/page.tsx`.

**Changed:** section is now `CLIENT_DOCUMENT_SECTION` (`'agency'`), `client_id` remains the
discriminator, no new section value and no constraint change. Upload and link genuinely share one
`saveClientDocument()`. `kind` defaults to `'other'`. The document list surfaces real load
failures instead of rendering an empty list over a broken read; the genuine empty state is
untouched. The inline red error surface is preserved and nothing is swallowed.

**Storage orphans:** the blob is uploaded before the row is inserted, so every failed save to
date left an object in Vercel Blob with no row pointing at it. Going forward the insert succeeds,
but the ordering is unchanged and a future insert failure would orphan again. **No storage object
was deleted.**

### ITEM 2 - `725f981`

**Root cause:** Master Documents is a fixed grid of named slots showing one latest row per
`section:kind`, not a list. Client documents are an open set and cannot occupy slots. Worse,
since item 1 writes them under `section='agency'`, a client row could have won an agency slot
lookup.

**Changed:** the slot grid is now built from agency rows only, partitioned by
`isClientScopedDocument`. Client rows list in their own region with a chip naming the client,
joined from `clients` via `clientNamesById` and never a stored string copy. Agency rows carry no
chip. Chip uses accent tokens; delete uses `text-destructive`. Sorting unchanged. The region does
not render when no client has documents.

### ITEM 3 - `3052c9b`

**Root cause:** the onboarding picker fetched the library unscoped and grouped by section. After
item 1 that would have shown every client's documents on every engagement.

**Changed:** onboarding fetches `?project_id=`, scoped server-side by the shared query.
Partitioned by the shared predicate, not section. Client group renders only when the project
resolves a client and that client has documents. A project with a typed client name and no
`client_id` - all six live projects - takes the agency-only branch and renders no heading.
`library_document_id` reused; no parallel attach.

**Picker scoping applied:** Master Documents unscoped (correct, sole browse-everything surface);
client profile `?client_id=`; onboarding `?project_id=`. The wizard and magic-rfp dedupe reads
stay unscoped and that is load-bearing, since they must see client rows to avoid re-copying one
onto the agency shelf.

### ITEM 4 - `c457c5e`

**Root cause:** counts derived from the checkbox, labelled as required.

**Changed:** new shared `countRequirementsByTier` / `summarizeRequirementTiers` in
`lib/business-criteria.ts`, mirroring how `computeRequirementCompliance` already partitions the
vendor side. Fixed in `app/agency/page.tsx` (the live symptom) and `bid-compare-view.tsx` (same
class). The same shared summary was added to `magic-rfp` and the client profile page so all
authoring surfaces read identically.

**Zero case:** all-Preferred renders `"N preferred"`, never a required claim. Mixed renders
`"N required, M preferred"`. Nothing checked renders `"None required"`.

**Legacy RFPs** (no tier data) fall back to the checked count, because for them checked genuinely
was the requirement.

**Audited, left alone:** `marketplace-content.tsx` counts what a vendor holds, a different
quantity. `bid-detail-sheet.tsx` uses checked keys to choose which rows to show and never renders
a count claiming required.

### ITEM 5 - `664bb4a`

`EvaluationCriteriaEditor` takes a `surface` prop defaulting to `"rfp"`, so no existing caller
changes. The client profile passes `"client"`. Component not forked. Other shared editors
grepped: `BusinessCriteriaEditor` has no leaked wording, and `BudgetCategoryEditor`'s "on this
RFP" string is not reachable from the profile page.

### ITEM 6 - `664bb4a`, `ed46cf7`

Both nav buttons use the existing `Tooltip` primitive, same side, width and styling as every
other nav entry. The primitive already carries `pointer-events-none` and `sideOffset 8`, verified
by reading `components/ui/tooltip.tsx` where the former is commented as the app-wide rule that a
popover never blocks its trigger. Each trigger is wrapped in a plain `div` because
`TooltipTrigger asChild` needs one child and each dialog supplies its own button.

### ITEM 7 - `664bb4a`

**7a NOT FIXED, nothing written.** Neither candidate holds. There is exactly one render site for
the NDA control and one for MSA. A read-only query confirms vendor 71 has exactly **one**
`partnerships` row, with both `nda_confirmed_at` and `msa_confirmed_at` null - so both controls
correctly render. What the walk saw is the NDA control beside the MSA control, which Q4 already
diagnosed and regrouped under a single "Confirm" eyebrow. There is no duplication to remove.

**7b done.** `border-sky-500/40 text-sky-300` had no token behind it and no blue token exists.
Replaced with the ruled secondary treatment - outlined, neutral. That also raises contrast
against the success-green NDA control, which is the confusion 7a reports.

### ITEM 8 - `664bb4a`

All 12 em dashes removed from the three prompt templates. Explicit instruction added to
`master-brief` (which produces scope item titles and the overview), `rfp-output-template`, and
the bid summary system prompt.

**No post-processing was added.** Model output and stored content are never rewritten and an
uploaded brief is never altered. **Passthrough from the uploaded client brief remains entirely
possible and is not addressed by this change.** If em dashes persist after this, the brief is the
source.

---

## Judgment calls taken

1. **`section = 'agency'` for client documents**, not `'templates'`. Both satisfy the CHECK. Chose
   `'agency'` because `TEMPLATE_SLOTS` includes a `kind='other'` slot and a client document with
   `kind='other'` would have competed for it; `AGENCY_SLOTS` has no `other` slot, so the collision
   surface is smaller. Item 2 filters the grid regardless, so this is defence in depth.
2. **Broadcast library dedupe added in item 1**, though not listed as an item. Without it a client
   document becomes an agency document on first broadcast, which directly defeats item 3's
   correctness requirement. Smallest reversible form: skip URLs the library already holds; a
   failed lookup falls through and saves as before.
3. **Server-side scoping by `project_id`** rather than plumbing `client_id` through
   `MasterProject` and the project context. Smaller blast radius for the same result.
4. **Master Documents client region is a separate list, not slots.** The slot grid cannot express
   an open set. Adding client kinds as slots would have invented a fixed taxonomy nobody asked
   for.
5. **The client-documents error surface now reports load failures.** It previously swallowed them
   as an empty list on the theory that failure meant "077 not applied". 077 is applied, so silence
   would now hide a real fault behind "No documents on this client yet".
6. **Item 4's helper lives in `lib/business-criteria.ts`, not a component.** The item assumed a
   shared component to fix; there was none, only an inline expression in the wizard.
7. **`summarizeRequirementTiers` added to two surfaces that previously showed no count at all**
   (magic-rfp, client profile), to satisfy "every surface inherits it" honestly rather than
   claiming inheritance that did not exist.
8. **7b uses neutral, not blue.** The design language names blue for informational status but no
   blue token exists, and inventing one is out of scope.

---

## Not done and why

- **7a.** No bug to fix. Diagnosed as correct behavior; reported rather than changed.
- **The "Already on Ligament" chip** on the pool page carries the same sky literals as the MSA
  button. Outside 7b's stated scope, left alone and logged.
- **Storage orphan cleanup.** Explicitly out of scope for this run; no object deleted.
- **The repo-wide `set-state-in-effect` lint pattern** (154 errors). Pre-existing, standing
  report-only posture, not touched.
- Everything on the do-not-do list: no `client_name` backfill, no profile deletion, no magic token
  client column, no app-wide hover sweep, no usage-limit wiring.

---

## Honest verification

**What I actually ran:**

- `pnpm build` - exit 0, after every commit.
- `npx tsc --noEmit` - exit 0, after every commit.
- `npx eslint` - report-only. One **new** violation was introduced by this batch's own copy
  (`react/no-unescaped-entities` on the nav caption apostrophe) and was fixed in `ed46cf7`. Every
  other finding in the touched files is the pre-existing repo-wide `set-state-in-effect` pattern.
- Read-only queries against the live database for the 7a data check only. No writes, no SQL.
- Full-repo greps including `contexts/` before every scoping decision. Nothing was deleted in this
  batch.

**What only live clicking can confirm:**

- That a client document now saves. The write has never once succeeded, so the fix is verified at
  the mechanism level - the section value now matches the constraint - and not by observation.
- Everything downstream of that write: the Master Documents chip, the onboarding client group, the
  RFP and magic-rfp attach, and the seedMaterials idempotency. None of these has ever run with a
  real client document in existence.
- The four required-count states. The derivation is verified by reading; the rendered strings are
  not.
- The nav captions. The primitive's `pointer-events-none` is verified in source; that the caption
  does not block the click is not verified in a browser.
- Whether em dashes stop appearing in generated output. The prompts no longer model them and now
  forbid them, but brief passthrough is untouched.

There is no Playwright in this repo. Nothing was browser-tested.

---

## Live test checklist, in click order

**A. The blocking fix**

1. Go to `/agency/clients`, open a client profile (create one named `Samsung` if none exists).
2. In Documents, paste a link and a label, click **Add link**. It should save with no red error
   and appear in the list.
3. Click **Upload**, choose a small file. Same: saves, appears, no error.
4. Reload the page. Both documents are still listed.
5. Open a **second** client profile. Confirm it shows **none** of Samsung's documents and shows
   the "No documents on this client yet" empty state.

**B. Master Documents**

6. Go to `/agency/documents`. The NDA / MSA / SOW slots and the Key templates slots look exactly
   as before.
7. Below them, a **Client documents** region lists both Samsung documents, each with a chip
   reading **Samsung**.
8. Confirm no agency document anywhere gained a chip.

**C. RFP wizard attach**

9. Start an RFP at `/agency`. In the Client block at Step 1, select **Samsung**.
10. Both Samsung documents appear in Reference Materials below, visible and removable.
11. **seedMaterials regression, part 1:** edit some other field on the step. The documents are
    still there.
12. **seedMaterials regression, part 2:** delete one document from Reference Materials. Re-select
    Samsung in the client selector. The deleted one does **not** come back.
13. Broadcast the RFP. Then reopen `/agency/documents` and confirm Samsung's documents did **not**
    get copied into the agency slots as a duplicate.

**D. magic-rfp attach**

14. Go to `/agency/magic-rfp`. Select **Samsung** at the brief step. Same attach behaviour as
    step 10.

**E. Onboarding scoping**

15. Attach Samsung to a project: create a project via **+ New project** and pick Samsung in the
    client selector.
16. Go to `/agency/onboarding` with that project selected. You should see a **Samsung documents**
    group plus your Agency documents, and **nothing** belonging to any other client.
17. Switch to one of the six older projects (typed client name, no profile). Confirm you see
    Agency documents only, with **no client heading at all**.

**F. The required count**

18. On the wizard Step 2, open Business criteria. Check one designation and set it to
    **Required**. The collapsed header reads **1 required**.
19. Switch that same criterion to **Preferred**. The header reads **1 preferred** - it must not
    say required.
20. Check a second criterion and set it Required. The header reads **1 required, 1 preferred**.
21. Uncheck both. The header reads **None required**.
22. Confirm the same summary appears on the client profile's Default business criteria section and
    on magic-rfp's Additional business criteria accordion.

**G. Ride-alongs**

23. On `/agency/clients/[id]`, the Default evaluation criteria empty state must **not** mention
    "this RFP". It should talk about RFPs for this client.
24. Hover **+ New project** and **+ New client profile** in the nav. A caption appears on the
    right. Then **click** each one - the dialog must open, proving the caption does not swallow
    the click.
25. On `/agency/pool`, the MSA confirm button is now neutral-outlined rather than blue, and reads
    clearly as a different control from the green NDA one beside it.
