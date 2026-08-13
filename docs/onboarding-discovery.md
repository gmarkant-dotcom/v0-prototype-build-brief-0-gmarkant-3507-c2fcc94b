# Onboarding Discovery

Read-only. No onboarding code was written or changed in this run.

**The job, as stated:** after a vendor is awarded, get them working fast by sharing the relevant
documents, the key information they need, and a scheduled kickoff, without the agency assembling
it by hand each time.

**The finding, stated up front:** the surface does roughly half of the first job, almost none of
the second, and the third only by pasting a link. The "without assembling it by hand" clause is
where it fails hardest: nearly everything on the page is typed or picked from scratch every time,
even though the system already knows most of it. And it has never been used - zero
`onboarding_packages` rows exist in production.

---

## 1. Inventory (0.5)

### Entry points

There are exactly two, plus one deep-link parameter.

| Entry | File | Notes |
| --- | --- | --- |
| Nav item "03 Onboarding" | `components/agency-layout.tsx:42` | Goes to `/agency/onboarding` with no project context; relies on whatever project is selected |
| "Start Onboarding" after award | `components/bid-detail-sheet.tsx:411` | `/agency/onboarding?projectId=...`. The only award-to-onboarding link |
| `?projectId=` deep link | `components/stage-03-onboarding-workflow.tsx:96` | Read and used to force-select the project |

`app/agency/onboarding/page.tsx` renders `Stage03OnboardingWorkflow`. There is a second,
**dormant** component, `components/stage-03-onboarding-production.tsx`, not mounted anywhere
(previously confirmed in `LIGAMENT_CONTEXT.md`).

### What the page renders, what it writes

| Block | Writes to | Required? |
| --- | --- | --- |
| Templates (optional) | nothing directly; selected ids become `onboarding_package_documents` rows with `document_role='template'` | Optional |
| Agency documents | same, `document_role='agency_doc'`, carrying `library_document_id` | Optional |
| Client documents (new) | same as agency docs | Optional, and only renders when the project has a `client_id` |
| Project documents | `onboarding_package_documents`, `document_role='project_doc'`, `library_document_id` **null** | Optional, max 10 |
| Kickoff meeting | `onboarding_packages.kickoff_type` / `kickoff_url` / `kickoff_availability` | Type required, three options |
| Optional message | `onboarding_packages.custom_message` | Optional |
| Save and send | inserts `onboarding_packages` with `status='sent'`, then the document rows; deletes the package if the document insert fails | The single terminal action |
| MSA tracker | `msa_agreements` via `/api/agency/msa` | Separate lifecycle, embedded here |

**Live usage, queried read-only:** `onboarding_packages` 0 rows, `onboarding_package_documents`
0 rows, `project_documents` 0 rows, `msa_agreements` 1 row (status `pending`). Nothing has ever
been sent through this surface.

### What the vendor receives and sees

`/partner/onboarding` (`app/partner/onboarding/page.tsx`) reads
`/api/partner/onboarding-packages`, which returns the package plus its documents.

- The vendor sees: the custom message, the kickoff type and URL or availability text, and the
  document list, each downloadable through `/api/partner/onboarding/file?documentId=`.
- The vendor can do exactly two things: **mark the package reviewed**
  (`status='reviewed'`, `partner_reviewed_at`) and **upload a file** back.
- The vendor cannot: sign anything, confirm the kickoff time, ask a question in context, or see
  which of these documents they already agreed to at bid time.

There is a hardcoded demo packet in that file (`demoOnboardingPackets`) used when demo mode is
on. Real mode starts from an empty array.

### Document list sources, exact filters

| List | Source | Filter |
| --- | --- | --- |
| Agency documents | `lib/library-documents.ts` via `/api/agency/library-documents?project_id=` | `section === 'agency'` AND `isAgencyDocument` (client_id null) |
| Key templates | same fetch | `section === 'templates'` AND `isAgencyDocument` |
| Client documents | same fetch | `isClientScopedDocument` (client_id set), scoped server-side to the project's client |
| Project documents | none - typed or uploaded inline each time | n/a |

So three of the four lists **do** now draw from the shared helper. That is new as of the last
batch. The fourth has no source at all.

**Critical caveat, and the reason item 1 of this batch existed:** before this run, no project in
the database carried a `client_id`, so the client documents list could never have rendered for
anyone. It was unreachable code from the moment it shipped.

---

## 2. Gap analysis, per job

### Job 1: share the relevant documents

**Works:** the library reuse is real. Agency documents, templates and now client documents come
from one scoped query, `library_document_id` is carried on the join row, and the vendor can
download them through a proxied route rather than a raw blob URL.

**Missing:** nothing is preselected. Every package starts with zero documents ticked, so the
agency re-picks the same NDA and MSA every time. The system knows which documents are almost
always sent and does not act on it.

**Present but does not serve the job:** the **Project documents** block. It is a 10-slot
type-or-upload list that writes `library_document_id: null`, so anything added there is invisible
to Master Documents, unreusable on the next engagement, and unsearchable. It is a hole in the
side of the library. Its own description admits the pattern is borrowed from bid attachments.
Zero rows exist. It does not earn its place in its current form: either it should write into the
library scoped to the project, or it should not exist.

### Job 2: the key information they need

**Works:** the custom message field, which is a blank textarea.

**Missing:** essentially everything. The vendor is not told, on this surface, what they were
awarded, at what price, on what timeline, against which scope item, or who their contact is.
All of that exists in `partner_rfp_responses` and `partner_rfp_inbox` at the moment of award.
The vendor has to remember their own bid.

**Present but does not serve the job:** the **MSA tracker**. It is a genuinely useful thing, but
it is a separate lifecycle bolted onto a send-once form. It has its own state machine, its own
API, and it is the only block on the page that persists between visits. It reads as a different
feature sharing a page. It should either be the seed of a persistent engagement surface or move
to the pool, where NDA and MSA state already lives.

### Job 3: a scheduled kickoff

**Works:** three options - Calendly link, a pasted URL, or free-text availability - with URL
normalization and a `meeting_url` prefill from the agency profile.

**Missing:** there is no schedule. Nothing is booked, no time is stored, no reminder fires, and
the vendor cannot confirm. `kickoff_availability` is free text nobody parses. Calling this
"scheduled" overstates it: the agency shares a way to schedule, and the scheduling happens
somewhere else entirely.

**Does not serve the job:** the free-text availability option specifically. It produces a string
that no surface downstream can act on.

---

## 3. Connection map

Onboarding is an island. It reads the document library and writes two tables, and that is the
whole of its relationships.

| Should connect to | Direction | What flows | Why |
| --- | --- | --- | --- |
| **The awarded bid** (`partner_rfp_responses`) | in | budget as bid, timeline, the four guided proposal sections, terms disclosure, business criteria the vendor confirmed | The vendor already told us all of this. Asking again, or omitting it, is the clearest instance of "assembling by hand" |
| **The client profile** (`clients`) | in | client documents, grouped and scoped, the same rule as the RFP wizard | Already built and now reachable, **depends on item 1 of this batch** |
| **NDA and MSA state** (`partnerships`) | both | `nda_confirmed_at`, `msa_confirmed_at` in; a confirmation performed here out | The pool already owns this state and the MSA tracker already sits on this page. Two owners of one fact is the honest-data violation waiting to happen |
| **The engagement and Delivery Performance** (`project_assignments`, `delivery_reviews`) | out | onboarding completion, kickoff held, documents acknowledged | Today onboarding completion is visible nowhere. It dead-ends |
| **The vendor's portal view** (`/partner/onboarding`) | both | acknowledgment per document, kickoff confirmation, questions | This is half the feature and the agency never sees it. There is no read receipt beyond one global "reviewed" flag |
| **The vendor's pool profile** | in | primary contact, capabilities, prior engagements | Lets the package address a person rather than a company |

---

## 4. Proposed structure, section by section

Ordered by what the agency needs to decide, not by what is easiest to render. Each is separately
rulable.

1. **Engagement header (new).** Vendor, project, client, scope item, awarded amount, awarded
   date. Read-only, derived. *Reasoning:* the page currently opens with no statement of what
   this onboarding is even for. This is also the block that proves the awarded-bid connection is
   live.
2. **Documents (restructured).** One list, pre-ticked with a sensible default (NDA and MSA where
   they exist and are unconfirmed), grouped Agency / Templates / Client. *Reasoning:* the single
   biggest "assembled by hand" cost. Preselection is the whole feature.
3. **Project documents (demoted or removed).** If kept, it must write into the library scoped to
   the project so it stops being a hole. *Reasoning:* see gap analysis; it currently loses data.
4. **What the vendor already told us (new, read-only).** Their bid terms, timeline and
   assumptions, shown to the agency so the message can reference them. *Reasoning:* cheap, high
   signal, no new storage.
5. **Kickoff.** Unchanged in mechanism until the scheduling question below is ruled.
6. **Message.** Keep, but seed it with a template naming the vendor, project and kickoff.
7. **Send.** See the draft-versus-send question below.
8. **MSA and NDA status.** Moved to a status strip near the header, reading from `partnerships`,
   not a separate tracker block.

---

## 5. Judgment calls, each with a recommendation and costs

**Q1. Is onboarding a package sent once, or a living surface both sides return to?**
*Recommendation: living surface, with the first send as a milestone rather than the end.*
The schema already leans this way - `onboarding_packages.status` and `partner_reviewed_at` exist
and are barely used, and the MSA tracker is already persistent.
- Cost of package-sent-once: cheapest, matches the current code, but onboarding completion can
  never be a state Delivery Performance reads, and a second document always means a second
  package with no relationship to the first.
- Cost of living surface: needs a real status model and a per-document acknowledgment table, and
  raises "what does done mean" - which needs your answer, not mine.

**Q2. Should kickoff scheduling stay three radio options or integrate with a calendar?**
*Recommendation: keep the three options now, drop the free-text availability, and add a stored
proposed datetime the vendor can confirm.*
- Cost of keeping as-is: the word "scheduled" stays untrue and nothing downstream can act on it.
- Cost of full calendar integration: a real integration project - OAuth, availability, timezones,
  cancellation - and premature before anyone has sent one package.
- The middle option costs one nullable column and a confirm action, and makes "kickoff on the
  14th" a fact the system holds.

**Q3. Should "Save and send" be one irreversible action or draft plus send?**
*Recommendation: draft plus send.*
The current action inserts with `status='sent'` and emails immediately, and its own failure path
deletes the package to avoid a half-written record - which tells you the atomicity is already
uncomfortable.
- Cost of one action: an agency mid-assembly has nowhere to put unfinished work, and a mistake is
  sent.
- Cost of draft plus send: one more status value and a rule about what an unsent draft is
  visible as. Small.

**Q4. Should documents be preselected?** *Recommendation: yes, NDA and MSA where they exist and
are unconfirmed for that partnership.* Cost: a defensible default that is occasionally wrong, and
the agency unticks it. The alternative is re-picking the same two documents forever.

**Q5. Does the Project documents block survive?** *Recommendation: no, not in its current form.*
Either it writes to the library scoped to the project, or it is removed and the library is the
only way in. Cost of keeping it as-is: continued silent data loss.

**Q6. Who owns NDA and MSA confirmation?** *Recommendation: the pool owns the state; onboarding
reads it and may write a confirmation through the same API.* Cost: one shared helper. The
alternative is two surfaces disagreeing about whether an NDA is signed.

---

## 6. Reuse versus build

**Reuse, already built:**

- `lib/library-documents.ts` - scoping predicate and query. Already consumed here.
- `components/bid-form-collapsible-section.tsx` - the F1 wrapper, for every section above.
- `lib/business-criteria.ts` - `computeRequirementCompliance` for what the vendor confirmed.
- `lib/rfp-response-fields.ts` - `formatBudgetForDisplay`, `formatTimelineForDisplay`.
- `lib/proposal-sections.ts` - `ProposalSectionsDisplay` for the vendor's own words.
- `lib/budget-categories.ts` - the category breakdown, if the header shows the awarded budget.
- `components/ui/tooltip.tsx` and `components/help-term.tsx` - captions.
- `app/api/agency/msa` - the MSA lifecycle, wherever it ends up rendering.
- `lib/partner-inbox-access.ts` - the precedent for a vendor-side access predicate.

**Must be built:**

- The engagement header's derivation - a query joining assignment, project, response and client.
  No existing helper returns that shape.
- Per-document acknowledgment, if Q1 is ruled toward a living surface. New table, new migration.
- A stored kickoff datetime and confirmation, if Q2 is ruled toward the middle option. One
  nullable column.
- Draft status, if Q3 is ruled toward draft plus send. A status value, not a table.

---

## 7. What I could not determine without you

1. **What "onboarding complete" means.** Documents opened? Acknowledged? Kickoff held? MSA
   signed? Everything downstream depends on this and it is a product decision.
2. **Whether the vendor should acknowledge documents individually** or one blanket review is
   enough. Drives whether a new table is needed.
3. **Whether the dormant `stage-03-onboarding-production.tsx` is a discard or an intent.** It is
   unmounted and I did not read it as a spec. If it represents where you wanted this to go, it
   changes the proposal.
4. **Why zero packages have ever been sent.** The surface may be broken in a way only live use
   reveals, or the flow may simply never have been walked. I cannot tell these apart from the
   code, and it materially changes how much of the above is redesign versus repair.
5. **Whether onboarding should exist per vendor or per project.** Today it is per
   `(project, partnership)`. A project awarding four vendors produces four unrelated packages
   with no shared view.
6. **Whether the kickoff is one meeting for all vendors or one per vendor.** The current model
   assumes per vendor and nothing aggregates.
