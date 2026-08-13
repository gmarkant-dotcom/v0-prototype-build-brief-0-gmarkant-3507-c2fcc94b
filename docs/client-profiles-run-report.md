# Client Profiles Run Report (Workstream A)

Aug 13, 2026. Six commits, A0 through A3. Not pushed. **No SQL was executed against any
database.** Migration 077 is authored as a file only, for the STOP gate.

`npx tsc --noEmit` exit 0 and `pnpm build` exit 0 after every commit. Corruption scan clean. No
em dashes introduced.

| Commit | What |
| --- | --- |
| `51c6693` | A0 discovery (docs only) |
| `734caf4` | A-M migration 077 authored |
| `42e13fb` | A1 client profile CRUD, nav affordance, and surface |
| `44473ba` | A2 select-or-create a client wherever one is named |
| `8ea5b1f` | A3 vendor pool "Worked with client" filter |
| (this one) | run report |

## Preflight - stack verdict

Working tree clean. `git log origin/main..HEAD` returned **nothing**: the prior batches are all
pushed. `origin/main` was at `0faa035`, the Q-batch + S/R-batch run reports commit. So the nine
prior commits (Q1-Q4, S1, R1-R4) plus that docs commit are on the remote, and this workstream
starts from a fully-pushed base rather than stacking on unpushed work.

---

## Discovery highlights and reuse decisions

Full document: `docs/client-profiles-discovery.md`.

**One writable client field exists.** `projects.client_name` is the only one. 123 references
across 37 files; everything else is a display read, a broadcast snapshot
(`master_rfp_json.client`), or a live join. `rfp_magic_tokens` has **no client column at all** and
derives its client through `project_id`. So `projects` is the only record that needs a
`client_id`.

**Documents: reuse `agency_library_documents`, build nothing.** It is already agency-scoped -
the exact scope a client profile lives at - already handles both a Vercel Blob file and an
external URL, and already has a complete CRUD API (GET/POST, DELETE by id, file upload). Client
documents are the same rows with a nullable `client_id` set. One column against duplicating an
entire upload, storage, listing and deletion stack. `section`/`kind` are validated in the API
rather than by a database CHECK, so adding a `'client'` section is a code change, not a
migration.

**Attach transport: reuse reference materials, no storage at all.** They already carry
`{ type, label, url, created_at }`, so a client document becomes a reference material by pure
mapping. That also handed A2 its idempotency key for free: the URL.

**Onboarding: nothing to build.** `onboarding_package_documents` already carries
`library_document_id`, so the codebase's own precedent is that a package references a library
document by id rather than copying it. A client's documents are reachable there without
re-upload the moment they are library rows.

**Award derivation verified on live data, not assumed.** All four `project_assignments` rows are
`status = 'awarded'` and every one resolves partnership -> project -> client string.

---

## Migration summary (authored, never executed)

`supabase/migrations/077_client_profiles.sql`:

- **`clients`** - agency-scoped: `name`, `notes`, and two OPTIONAL jsonb defaults in the **exact
  shapes the wizard already consumes**, so pre-filling an RFP is an assignment rather than a
  translation. RLS is the single `agency_id = auth.uid()` policy pattern from 064/065, wrapped in
  a `DO` block since `CREATE POLICY` has no `IF NOT EXISTS`.
- **`agency_library_documents.client_id`** - nullable. Every existing row keeps NULL and every
  listing returns exactly what it returns now.
- **`projects.client_id`** - nullable. `client_name` is **not dropped, not renamed, not
  backfilled**.

Two deliberate non-constraints, both stated in the file:

- **No UNIQUE on the name.** The product rule is warn-and-link, never hard-block, and two
  genuinely different clients can share a name. The `(agency_id, lower(name))` index exists only
  to make that lookup fast; a UNIQUE would turn a warning into a 23505 the UI would have to
  apologize for.
- **No CHECK on the 8-criterion cap.** A jsonb-length CHECK would reject a valid profile with an
  error the UI cannot explain. The cap stays app-side, enforced on both write and read.

Both FKs are `ON DELETE SET NULL`, not CASCADE: deleting a profile must not destroy an uploaded
file's record while its blob lives on, and must not strip a project of its client.

---

## Per-commit summaries

### A1 - CRUD, nav, surface

"+ New client profile" sits directly beneath "+ New project" in the nav, same `NewProjectDialog`
contract, secondary styling (one primary per view). A "Client Profiles" nav item joins the
utility section beside Master Documents.

Duplicate names **warn and link**, never block: create posts without `force`, the route answers
409 with the match, and the dialog offers "Open that profile instead" or "Create a second one
anyway".

The detail surface **reuses** `BusinessCriteriaEditor` with full tier handling,
`EvaluationCriteriaEditor` with its cap, and `BidFormCollapsibleSection`. Documents drive the
existing library-documents API through a new `?client_id=` parameter.

**Privacy rule** stated in three places in UI copy and enforced structurally: `notes` is selected
only by the two agency-scoped client routes and by nothing vendor-facing.

**Deliberately not copied** from `NewProjectDialog`: the usage-limit wiring and the paid-feature
gate. `checkUsageLimit` knows only `projects` and `ai_analyses`; guarding here would invent a
limit that does not exist.

### A2 - select-or-create on three surfaces

One `ClientSelector` on the + New Project dialog, the wizard's Step 1, and the magic-rfp brief
step. Three ways to answer, and the third is not a fallback: pick a profile, create one inline,
or **type a plain name - the legacy path, first-class and never nagged at**. Typing always drops
the entity link, because a name that no longer matches its profile must not keep claiming to be
it.

**A real bug found and fixed on the way.** `ReferenceMaterialsInput` owns its own internal list,
so merging documents into the parent's state would have been silently overwritten the next time
the agency touched the control - the attach would have looked like it worked, then vanished. It
now takes an optional `seedMaterials` prop and merges into the visible list, so attached client
documents can be seen, reordered and removed like anything else. Idempotency is keyed on URL and
tracked in a ref of already-seeded URLs, which does three things at once: re-selecting adds
nothing, re-broadcasting adds nothing, and a document the agency **deliberately removed** is
never silently re-added.

**Pre-fill, never write-back.** There is no code path from an RFP edit back to a profile - not a
guard, an absence.

### A3 - pool filter

Sixth row in the existing filter rail, identical chip markup, single-select, with real per-client
vendor counts and a quiet "From awarded work only" note. One derivation serving both worlds: the
key is the **trimmed lowercased name**, never the `client_id`, so "Adidas" typed on a legacy
project and an "adidas" profile are one chip. `client_id` only resolves the better display label.

---

## Open questions

1. **The magic-rfp client selection is in-flow only.** `rfp_magic_tokens` has no client column
   and derives its client from the project, so persisting a client there independently would need
   a new token column. The selector pre-fills criteria and attaches documents but does not
   persist a client. Deliberate; a token column was not invented.
2. **Profile deletion is not built.** A1 ships create, list, read and update. The `ON DELETE SET
   NULL` behaviour in 077 is therefore authored but unexercised - a deleted profile would leave
   its documents in `agency_library_documents` with a NULL `client_id` and `section = 'client'`,
   which no current UI lists. Decide the re-filing behaviour before adding a delete action.
3. **No backfill of legacy client strings.** Six live projects carry strings (Rivian x2, Adidas,
   Chime, Pfizer, Whoop). Whether creating an "Adidas" profile should adopt the existing Adidas
   project is a separate reviewed decision - a blind UPDATE could merge two different clients or
   split one typed two ways. A3's filter already treats them as one option regardless.
4. **A client rename does not propagate to broadcast snapshots.** `master_rfp_json.client` is
   frozen at broadcast. This is correct - a bid was answered against what it said at the time -
   but will read as an inconsistency to anyone expecting an entity rename to cascade.
5. **`section`/`kind` are API-validated only.** Nothing in the database stops a hand-written row
   with an odd `section`. The client document listing filters on `client_id`, never on `section`
   alone, precisely so such a row cannot leak into a client's list.
6. **Multi-user organizations remain out of scope.** Everything here is `agency_id = auth.uid()`,
   consistent with the rest of the schema. Nothing blocks that epic later.
7. **Projects list/detail do not yet display the client entity.** `client_id` is written on
   create but no read surface renders "this project's client profile" or links to it. A follow-up
   once the migration is applied.

---

## Verification statements

Verified:

- `npx tsc --noEmit` exit 0 and `pnpm build` exit 0 after each of the six commits. Both new pages
  and all three new API routes appear in the build's route table.
- Markdown-link corruption scan clean across `app/`, `lib/`, `components/`.
- A0's schema facts from one read-only OpenAPI fetch plus read-only row queries. The award
  derivation was resolved end to end on live rows before A3 was written.

Not verified:

- **No SQL was executed. Migration 077 has not been applied**, so `clients`,
  `agency_library_documents.client_id` and `projects.client_id` do not exist. **The path this
  build actually exercises is the pre-migration one**: an honest empty client list, a selector
  that degrades to a plain text input, a project create that retries without `client_id`, and a
  pool filter row that does not render.
- **No browser was opened.** No dialog, page, selector or filter chip was rendered. Layout follows
  existing patterns and was read against the design language, not seen.
- The post-migration behaviour - profile creation, document attach, criteria pre-fill, the filter
  itself - is verified by tracing the code, not by running it.

---

## MORNING CHECKLIST

### 1. Apply migration 077

Full procedure and rollback: `docs/s4-migrations-runbook.md`, the 077 section. Note 072, 075 and
076 may still be outstanding - check that table first. 077 is independent of all three.

**Record the baseline first:**

```sql
SELECT count(*) FROM projects WHERE client_name IS NOT NULL;
```
Write this number down.

Paste `supabase/migrations/077_client_profiles.sql` above the `Verification` block. It contains a
`DO $$ ... $$` block for the RLS policy - paste it whole. Expect **Success. No rows returned.**

```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_name = 'clients' ORDER BY ordinal_position;
```
**Expected:** 8 rows - `id`, `agency_id`, `name` (all NOT NULL), `notes`,
`default_business_criteria` jsonb, `default_evaluation_criteria` jsonb, `created_at`,
`updated_at`.

```sql
SELECT column_name, is_nullable FROM information_schema.columns
WHERE (table_name = 'agency_library_documents' AND column_name = 'client_id')
   OR (table_name = 'projects' AND column_name = 'client_id');
```
**Expected:** 2 rows, both `YES`.

```sql
SELECT policyname FROM pg_policies WHERE tablename = 'clients';
```
**Expected:** one row, `Agencies manage own clients`.

```sql
SELECT count(*) FROM clients;
SELECT count(*) FROM agency_library_documents WHERE client_id IS NOT NULL;
SELECT count(*) FROM projects WHERE client_id IS NOT NULL;
```
**Expected:** `0`, `0`, `0`. The last two matter most - a non-zero result means applying the
migration attached existing documents or projects to a client, which it must never do.

```sql
SELECT count(*) FROM projects WHERE client_name IS NOT NULL;
```
**Expected:** identical to your baseline. This is the proof that no backfill occurred.

Then update the migrations table in `LIGAMENT_CONTEXT.md`.

### 2. Push

```bash
git push
```
Six commits: A0, A-M, A1, A2, A3, and this report. Wait for the Vercel deploy before step 3.

### 3. Live tests

**3a. Create a Samsung profile.** Nav "+ New client profile" -> name `Samsung`. Confirm it lands
on the detail page. Add **one document** (a link is fastest). Set **one Required default business
criterion** - check a designation, then set its toggle to Required. Save; confirm "Saved".

**3b. Duplicate warning.** Create another profile named `samsung` (lowercase). Confirm it warns,
links to the existing one, and still offers "Create a second one anyway". Do not create it.

**3c. Wizard broadcast selecting it.** Start an RFP, pick `Samsung` in the Client block at Step 1.
Confirm: the name fills, the document appears in the reference materials list below (visible and
removable, not hidden), and Step 2's Business criteria block is **pre-filled with your Required
criterion and still editable**. Change something in Step 2, then go back to `/agency/clients` and
confirm the profile is **unchanged** - per-RFP edits must never write back.

**3d. Idempotency.** Re-select `Samsung` in the same flow. Confirm the document does **not**
appear twice. Then remove it manually and re-select again - confirm it does not silently
reappear.

**3e. magic-rfp.** Same selection at the start of the Lightning flow. Confirm name, document
attach and criteria pre-fill. Note the client is **not** persisted on the token by design (open
question 1).

**3f. + New Project dialog.** Confirm the selector appears in place of the old Client Name field,
that picking `Samsung` fills the name, and that the project is created.

**3g. Legacy path unchanged.** Broadcast an RFP typing a plain client name with no profile
selected. It must behave exactly as it does today - no attachments appear, no criteria pre-fill,
nothing new is sent.

**3h. Pool filter.** Open `/agency/pool`. Confirm a "Worked with client:" row appears after
Insurance. Filter by **Whoop** and confirm it shows exactly the vendors with awarded Whoop work
and nobody else. Confirm the counts on the chips match what filtering returns. Confirm a vendor
with no awarded work never appears under any client.
