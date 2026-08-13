# Client Profiles - Discovery (Workstream A0)

Read-only mapping, done before any code. No SQL was executed; the live schema facts below come
from one read-only fetch of the PostgREST OpenAPI description plus read-only row queries.

The feature intent: an agency sets up a reusable CLIENT PROFILE once (Samsung, adidas) with key
documents, standing requirements and notes, then selects it anywhere a client is named, so that
client's docs and defaults auto-apply instead of being re-entered. Vendor Pool becomes filterable
by end client from real award history.

---

## 1. Where "client" exists as a string today

There is **one** authoritative client field in the database and a long tail of read-only copies.

| Location | Column / path | Type | Role |
| --- | --- | --- | --- |
| `projects` | `client_name` | `text`, nullable | **The only writable source of truth.** Everything else derives from it. |
| `partner_rfp_inbox` | `master_rfp_json.client` | inside JSONB | Snapshot written at broadcast, from the wizard's `masterRfp.client` |
| `rfp_magic_tokens` | (none) | - | The magic-link flow has **no client column at all**. Its client context is read live from `projects.client_name` via `project_id` |
| `partner_rfp_inbox` (synthesized) | `master_rfp_json.client` | inside JSONB | `lib/magic-token-attach.ts` copies `project.client_name` into the row it synthesizes |

123 references to `client_name` across 37 files. All but the project write paths are display
reads. The material ones:

- **Writes:** `app/api/projects/route.ts` (create), `app/api/projects/[id]/route.ts` (update),
  `app/api/agency/projects/duplicate/route.ts`, and `components/new-project-dialog.tsx` as the
  UI. `lib/project-mapper.ts` maps the row to the `MasterProject` UI type.
- **Broadcast snapshot:** `app/agency/page.tsx` holds `masterRfp.client`, which
  `app/api/agency/broadcast-rfp/route.ts` spreads wholesale into `master_rfp_json`.
- **Magic link:** `app/api/agency/rfp/magic-link/route.ts` selects
  `projects.select("id, name, client_name, budget_range")` and uses it only for the invitation
  email's scope summary. Nothing client-shaped is stored on the token.
- **Vendor-facing reads:** `/api/partner/rfps`, `/api/partner/rfps/bids`,
  `/api/partner/projects`, the guest respond page - all join `projects.client_name` for display.

Live data, all six projects on the primary agency: Rivian x2, Adidas, Chime, Pfizer, Whoop.
Free-typed strings, inconsistent casing risk already latent ("Adidas" vs the brand's "adidas").

### Consequence for the design

`projects.client_name` is the hinge. A nullable `client_id` on `projects` is the smallest change
that makes the entity real, and it leaves `client_name` as the legacy path untouched. The two RFP
snapshots (`master_rfp_json.client`, and the magic-link flow's absence of one) do **not** need
entity columns: they are snapshots of a moment, and the wizard already carries whatever string
the selector produced.

---

## 2. Document infrastructure - reuse decision

Three existing mechanisms were assessed. **Reuse `agency_library_documents`. Build nothing new.**

### 2a. `agency_library_documents` - the Master Documents system (CHOSEN)

```
id, agency_id, section, kind, label, source_type,
external_url, blob_url, blob_path, file_name, file_type, file_size,
created_at, updated_at
```

- Already **agency-scoped**, which is exactly the scope a client profile lives at.
- Already supports both storage modes a client doc needs: `source_type = 'file'` (Vercel Blob,
  private, path `agency-library/<agency_id>/...`) and `source_type = 'url'` (an external link,
  e.g. a DocuSign NDA - live data has one).
- Already has a complete CRUD API: `app/api/agency/library-documents/route.ts` (GET/POST),
  `/[id]` (DELETE), `/file` (upload).
- `section` and `kind` are validated **in the API, not by a database CHECK** - the route rejects
  anything outside `section in ('agency','templates')` and a nine-value `kind` allow-list. So
  adding a `'client'` section is a code change, not a migration.

**Decision:** client documents are `agency_library_documents` rows with a new nullable
`client_id` set. Existing rows keep `client_id` NULL and are untouched, unfiltered, unchanged.
This is one nullable column against reusing an entire upload, storage, listing and deletion
stack. A separate `client_documents` table would duplicate all of it for no gain.

### 2b. `reference_materials` - the magic-rfp mechanism (REUSED AS THE TRANSPORT)

`components/reference-materials-input.tsx` produces, and `rfp_magic_tokens.reference_materials`
stores, an array of:

```ts
{ type: "link" | "file", label: string, url: string, created_at: string }
```

The magic-link route wraps it as `{ materials, output_template_config }`.

**Decision:** attaching a client profile's documents into a flow is a pure **read and map** from
`agency_library_documents` into this shape. No new storage at all, on either flow. A client doc
becomes `{ type: source_type === 'url' ? 'link' : 'file', label, url: external_url ?? blob_url }`.

Idempotency (A2's requirement) therefore has a natural key with no schema support needed: the
`url`. Re-selecting a client, or re-broadcasting, merges by URL and cannot duplicate.

### 2c. `project_documents` and `onboarding_package_documents` (NOT reused for storage)

`project_documents` is per-project and per-assignment with a `visibility` column - the wrong
scope for a reusable profile. `onboarding_package_documents` is the interesting one: it already
carries `library_document_id`, proving the codebase's own precedent that an onboarding package
references a library document by id rather than copying it. Onboarding therefore gets a client's
documents for free once they are library rows: the same `library_document_id` linkage already
works, and A2 needs no upload path into onboarding.

---

## 3. Exact JSONB shapes for default pre-fill

Both are already normalized by shared library functions, and both already travel inside
`master_rfp_json` and `rfp_magic_tokens` columns. A client profile stores **the same shapes**, so
pre-fill is an assignment, not a translation.

**`business_criteria_required`** (`lib/business-criteria.ts`,
`normalizeBusinessCriteriaRequired`):

```ts
{
  designations:        Partial<Record<DesignationKey, true>>
  designationPriority?: Partial<Record<DesignationKey, "required" | "preferred">>
  insurance:           Partial<Record<InsuranceKey, { required: boolean; minimum: string | null }>>
                       & { coi_on_file?: boolean }
  insurancePriority?:  Partial<Record<InsuranceKey, "required" | "preferred">>
  coiPriority?:        "required" | "preferred"
  notes:               string
}
```

**`evaluation_criteria`** (`lib/rfp-evaluation-criteria.ts`,
`normalizeRfpEvaluationCriteria`, capped at 8):

```ts
Array<{
  key: string            // stable, generated once
  name: string
  description: string
  weight: number         // 0.5 - 3.0, relative
  origin: "default" | "custom"
  sort_order: number
}>
```

Both normalizers already treat `null`, `undefined`, a JSON string and a malformed value as
"empty". A client profile with no defaults is indistinguishable from no client profile, which is
what makes the pre-fill safe.

---

## 4. The + New Project nav dialog pattern

`components/new-project-dialog.tsx` is the single create-a-project flow, deliberately shared by
every entry point. Anatomy to mirror exactly:

- `NewProjectDialog({ trigger })` - the caller supplies the trigger node, the dialog owns
  everything else. Rendered in `components/agency-layout.tsx` at line ~382 as the first thing in
  `<nav>`, above the Overview section, styled as a full-width lime `bg-accent` button.
- shadcn `Dialog` / `DialogContent` / `DialogHeader` / `DialogFooter` / `DialogClose`.
- `useState` form object reset on close; inline `createProjectError` and `createProjectWarning`
  strings rather than toasts for validation.
- Paid-feature guarding: `checkFeatureAccess(...)` before opening the request,
  `guardAction("projects")` before firing, `handleUsageLimitError(status, data)` to catch an
  authoritative 402 if the cached usage snapshot was stale.
- On success: `addProject`, `refreshProjects`, `setSelectedProject`, then `router` navigation.

A "+ New Client Profile" affordance sits directly beneath it in the same `mb-5` block, same
component contract. **Note:** client profiles are not a metered resource, so the usage-limit
wiring is deliberately NOT copied - copying it would invent a limit that does not exist.

---

## 5. Awarded work: vendor -> project -> client (the A3 derivation)

The chain exists today and needs no new data:

```
partnerships.id                       (a Vendor Pool row)
  <- project_assignments.partnership_id  WHERE status = 'awarded'
       -> project_assignments.project_id
            -> projects.client_name        (and, post-migration, projects.client_id)
```

Verified against live data. All four `project_assignments` rows are `status = 'awarded'`:

| Vendor | Project | Client |
| --- | --- | --- |
| gmarkant@icloud.com | April Test - Q3 Product Launch v3 | "Rivian" |
| gmarkant@icloud.com | Evergreen Content | "Pfizer" |
| gmarkant+partner71@gmail.com | Evergreen Content | "Pfizer" |
| gmarkant+partner65@gmail.com | Evergreen Content | "Pfizer" |

`project_assignments.status = 'awarded'` is written by exactly one place - the award branch of
`app/api/agency/rfp-responses/[id]/route.ts` - so "has awarded work for this client" is
derivable, single-sourced, and impossible to self-report. That satisfies A3's "strictly from
award history, never self-reported".

The Vendor Pool page keys its rows on `partnerships.id` (`type Partnership`, line 39), which is
the same id `project_assignments.partnership_id` points at. No join key needs inventing.

### The one-option rule

A3 requires that a profile whose name matches a legacy string presents as ONE filter option. The
derivation must therefore normalize on a **case-insensitive trimmed name**, not on `client_id`,
and use `client_id` only to group rows that share an entity. Live data already shows why: a
"Adidas" project string and a future "adidas" profile must not become two chips.

---

## 6. Filter placement on the Vendor Pool

`app/agency/pool/page.tsx` has an established filter rail: a search input and a Bookmarked
toggle, then five `border-t border-border` rows, each `flex flex-wrap items-center gap-2 mt-4
pt-4` with a `font-mono text-2xs text-foreground-muted mr-2` label and `rounded border` chips:

```
Status:        (single-select, setSelectedStatus)
Legal Status:  (single-select, setSelectedLegal)
Discipline:    (single-select, setSelectedDiscipline)
Designations:  (multi-select, toggleDesignationFilter)
Insurance:     (multi-select, toggleInsuranceFilter)
```

"Worked with client" belongs as a **sixth row appended after Insurance**, single-select (a vendor
is filtered to one client at a time), using the identical chip markup. It is the only filter
derived from history rather than from vendor-declared attributes, which is worth a word in its
label rather than a different visual treatment.

---

## 7. Flags - things that contradict or complicate the intent

1. **`rfp_magic_tokens` has no client column.** The Lightning flow's client context is entirely
   derived from `projects.client_name` through `project_id`. A2's magic-rfp selector therefore
   cannot persist a client independently of the project - it either sets the project's client, or
   it is display-only for that broadcast. **Conservative choice for A2:** the magic-rfp selector
   drives the same project the flow already requires, and pre-fills criteria and reference
   materials in-flow. No new token column is proposed. Logged as an open question.

2. **Two client snapshots already diverge from the source.** `master_rfp_json.client` is frozen at
   broadcast. Renaming a client profile later will NOT retro-update broadcast RFPs, and should
   not - a bid was answered against what it said at the time. This is correct behavior but will
   read as an inconsistency to anyone expecting an entity rename to propagate. Documented, not
   fixed.

3. **`section`/`kind` on `agency_library_documents` are API-validated only.** Nothing in the
   database stops a row with an unexpected `section`. Reusing the table for client docs means the
   client-document listing must filter on `client_id`, never on `section` alone, or an agency row
   with a hand-edited section could leak into a client's list.

4. **There is no `clients` table and no organizations concept.** A client profile is
   agency-scoped (`agency_id = auth.uid()`), exactly like `agency_library_documents` and
   `bid_scoring_criteria`. Multi-user organizations are explicitly a separate epic; nothing here
   should assume more than one user per agency, and nothing here blocks that epic later.

5. **The 8-criterion cap is app-side.** A client profile storing `default_evaluation_criteria`
   must run the same `normalizeRfpEvaluationCriteria` on read, or a hand-edited profile could
   push a 12-criterion rubric into a wizard that caps at 8.

6. **Usage limits do not cover client profiles.** `checkUsageLimit` knows `projects` and
   `ai_analyses` only. Client profiles are deliberately unmetered; A1 must not copy the
   usage-guard wiring from `NewProjectDialog` or it will guard against a limit that does not
   exist.
