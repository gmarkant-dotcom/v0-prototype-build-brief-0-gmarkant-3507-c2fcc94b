# Client Coherence Guard - Report

Aug 13, 2026. Two commits. **Not pushed.** No migration written, no write query executed. The
one bad row is untouched and prepared for you to fix in Supabase yourself.

`pnpm build` exit 0 and `npx tsc --noEmit` exit 0 before each commit. ESLint report-only, no new
violations in the touched files.

| Commit | Item |
| --- | --- |
| `f5efc9c` | ITEM 1 + ITEM 2 |
| (this) | report |

Items 1 and 2 are one commit deliberately: item 1's write path runs through item 2's reconciler,
so splitting them would have produced a commit that does not hold together on its own. Flagged
here rather than quietly done.

---

## 0.3 first: how many rows are incoherent

**Exactly one. The one you know about. There are no others.**

| Project | client_name | client_id points to | Coherent? |
| --- | --- | --- | --- |
| Evergreen Content | `"Pfizer"` | `Samsung v2` | **No** |
| the other five | Rivian x2, Adidas, Chime, Whoop | `null` | Yes, legacy typed names |

Six projects total, one with a `client_id` at all, and that one disagrees. Query re-run after all
code changes: still one, still untouched.

---

## 0.1 the writer list, and the one the previous run missed

The previous run named four paths. **There are five.**

| # | Path | Wrote client_name | Wrote client_id |
| --- | --- | --- | --- |
| 1 | `app/api/projects/route.ts` POST (+ New project dialog) | yes | yes |
| 2 | `app/api/projects/[id]/route.ts` PATCH | yes, via allow-list | yes, added last batch |
| 3 | `app/api/agency/projects/duplicate/route.ts` | yes | yes, added last batch |
| 4 | the RFP wizard and magic-link flow, via `lib/client-project-link.ts` to path 2 | **no** | **yes** |
| 5 | **`app/agency/projects/[id]/page.tsx` `handleSave`** | **yes** | **no** |

**Path 4 is the defect you hit.** It wrote `client_id` alone onto a project whose `client_name`
said something else.

**Path 5 was missed by the previous audit.** The project detail page wrote `client_name` directly
through the browser Supabase client, bypassing the API route entirely, and never touched
`client_id`. It is the mirror image of path 4: renaming the client on a project that had a linked
profile would have silently detached the name from the profile. It had not bitten yet only
because no project had a `client_id` until last week.

No other writer exists. Every other `from('projects')` call in the repo is a select, or updates
`status` only.

---

## 0.2 the data path answer

**The project's client was NOT available where the Client block renders. Item 1 needed a fetch.**

The wizard knows its project through `useSelectedProject()`, which supplies a `MasterProject`:

```ts
{ id, name, client, status, createdAt }
```

Two problems with using that:

1. `client` is derived in `mapDbProjectToMaster` as `(p.client_name || "").trim() || "Client TBD"`.
   The empty case is coerced to a literal string, so it **cannot distinguish "no client" from a
   client actually named that**. The whole of item 1 turns on that distinction.
2. `client_id` is **not on the type at all**.

The wizard does not otherwise fetch the project row. The magic-link flow does fetch
`client_name` (`app/agency/magic-rfp/page.tsx:299`) but not `client_id`.

Rather than widen `MasterProject` (shared with demo fixtures and read across the app), the
selector reads the project row itself through the existing `GET /api/projects/[id]`, which
already returns `select('*')`. One fetch, in the one shared control, so all three call sites get
it without touching the project context.

---

## 0.4 the magic-link flow

It has its own `ClientSelector` and called the same `persistProjectClientLink`, so it carried
**the identical defect**: selecting a profile wrote `client_id` onto a project that may already
have had a different client name.

It obeys the same ruling now, through the same shared control - it passes `projectId` and
inherits read-only when the project already has a client. No change to magic-link persistence
itself; `rfp_magic_tokens` still has no client column and still derives its client through
`project_id`.

---

## Per item

### ITEM 1 - `f5efc9c`

**Files:** `components/client-selector.tsx`, `app/agency/page.tsx`,
`app/agency/magic-rfp/page.tsx`.

**Changed:** `ClientSelector` takes an optional `projectId`. When supplied it reads the project's
row; if the project already has a client - `client_id` set, non-empty `client_name`, or both - it
renders read-only inherited context with no dropdown, no text field and no "New client profile"
link. When the project has no client, today's control is unchanged.

The read-only line reads: *This client comes from the project. Change it on the project itself.*
The link points at `/agency/projects/[id]`. **Checked first: that surface exists** and is
editable, so the link is real rather than invented.

Two details worth stating:

- **Nothing renders until the project's client is known.** Showing the selector and then swapping
  it for read-only context would offer an override for a beat, and that beat is exactly the
  window your bad write happened in.
- **A failed read is treated as "this project has a client", not "no client".** Failing open would
  restore the override precisely on the rows most at risk.

"+ New project" passes no `projectId` and is untouched, because it has no project yet.

### ITEM 2 - `f5efc9c`

**Files:** `lib/clients-server.ts` (new), `app/api/projects/route.ts`,
`app/api/projects/[id]/route.ts`, `app/api/agency/projects/duplicate/route.ts`,
`app/agency/projects/[id]/page.tsx`.

**Home chosen: `lib/clients-server.ts`.** `lib/clients.ts` already owns client entity concerns,
but it is imported by client components and this function needs a `SupabaseClient` and reads the
`clients` table. The `-server` suffix follows the precedent already set by
`lib/rfp-evaluation-criteria-server.ts`, keeping the bundle-safe half separate.
`lib/library-documents.ts` would have been the wrong home: it owns document scoping, not project
writes.

**The invariant:**

- `client_id` set: `client_name` is overwritten from that client's own name. The entity is the
  source of truth whenever there is one, so a caller sending a conflicting name does not keep it.
- `client_id` cleared: `client_name` is left exactly as it is. Clearing the link is a
  non-destructive undo, not an erase.
- `client_name` alone: written as given, `client_id` untouched. A typed name never invents a
  profile.
- Ownership is verified before any `client_id` is accepted.

All five writers route through it. `client_name` was removed from the PATCH allow-list so both
fields travel one path, and the project detail page now PATCHes instead of writing directly.

### ITEM 3 - prepared, not executed

See the SQL below. Nothing was run.

---

## Item 3 SQL, for you to run in Supabase

### 1. VERIFICATION - current state of every incoherent row

```sql
select
  p.id,
  p.name        as project_name,
  p.client_name as project_client_name,
  p.client_id,
  c.name        as linked_profile_name
from projects p
join clients c on c.id = p.client_id
where p.client_id is not null
  and lower(trim(p.client_name)) is distinct from lower(trim(c.name));
```

**Expect exactly one row:** `Evergreen Content`, `client_name` = `Pfizer`, linked profile
`Samsung v2`, id `5473ceeb-f899-4808-aa6f-ed81c6146b30`.

### 2. FIX - clear client_id, leave client_name untouched

Scoped by project id explicitly, never by name.

```sql
update projects
set client_id = null,
    updated_at = now()
where id = '5473ceeb-f899-4808-aa6f-ed81c6146b30'
  and client_id = 'e7bce54b-9e23-4a44-8216-588db93f09ac';
```

**Expect: 1 row updated.** The second predicate makes it a no-op if the row has already changed
since this report, rather than clobbering a newer value.

**Why clear `client_id` and not rewrite `client_name`:** Evergreen Content is a Pfizer project. It
should never have taken Samsung v2. Rewriting the name to "Samsung v2" would make the row
coherent and *wrong*. Clearing the link returns it to exactly what it was before the bad write: a
typed-name Pfizer project.

### 3. POST-CHECK - the fix landed and nothing else moved

```sql
-- a. no incoherent rows remain
select count(*) as incoherent_rows
from projects p
join clients c on c.id = p.client_id
where p.client_id is not null
  and lower(trim(p.client_name)) is distinct from lower(trim(c.name));
-- expect 0

-- b. the repaired row kept its name and lost only the link
select id, name, client_name, client_id
from projects
where id = '5473ceeb-f899-4808-aa6f-ed81c6146b30';
-- expect client_name = 'Pfizer', client_id = null

-- c. no other project was touched
select id, name, client_name, client_id
from projects
order by name;
-- expect 6 rows, all client_id null, client_names:
--   Adidas, Chime, Pfizer, Rivian, Rivian, Whoop
```

### What you should see in onboarding afterward

Open `/agency/onboarding` with **Evergreen Content** selected: **agency documents and key
templates only, with no client group and no empty heading.** Pfizer is a typed string with no
profile behind it, so there is nothing client-scoped to show. That is the correct end state, not
a regression.

---

## Judgment calls taken

1. **Items 1 and 2 in one commit.** Item 1's write path depends on item 2's reconciler; separate
   commits would have left one that does not hold together. Stated rather than hidden.
2. **A fetch in the selector, not a widened `MasterProject`.** `MasterProject` is shared with demo
   fixtures and read across the app; adding `clientId` there is a wider blast radius than one read
   in the one control that needs it.
3. **Failing closed on a failed project read.** Treating "unknown" as "has a client" hides the
   selector rather than offering an override. The opposite default would reintroduce the bug on
   exactly the rows that matter.
4. **The inherited display shows `client_name`, not the linked profile's name.** For the one bad
   row today those differ. Showing the project's own label is the honest answer to "what client is
   this project for", and it also makes the incoherence visible rather than papering over it.
5. **`lib/clients-server.ts` rather than extending `lib/clients.ts`.** Reasoning above.
6. **Duplication carries a coherent pair or neither**, and does not re-reconcile the source. A
   duplicate should not silently repair a bad source row without anyone deciding to.
7. **Path 5 fixed even though the brief named four writers.** It is the same defect mirrored, and
   leaving it would have meant the invariant held everywhere except the one surface whose whole
   job is editing the project.

---

## Not done, and why

- **No UPDATE executed.** Item 3 is prepared only, as instructed.
- **No database constraint or trigger.** Asked to make the case instead, and I do not think one is
  warranted yet. A `CHECK` cannot express this: the rule involves another table's `name` column,
  which a row-level `CHECK` cannot read. That leaves a trigger, which would silently rewrite
  `client_name` on every insert and update - real behavior hidden in the database, invisible to
  anyone reading the application, and awkward to test. Revisit if a writer appears outside this
  codebase (a script, an admin tool, a second service). Until then the application layer is the
  honest place, and it is now one function rather than five call sites.
- **No backfill** of the five legacy typed-name projects.
- **No project-edit or change-the-client flow built.** Out of scope; item 1 links to the existing
  project page rather than inventing one.
- **Onboarding untouched.**

---

## Honest verification

**Executed:**

- `pnpm build` exit 0 and `npx tsc --noEmit` exit 0 before the commit.
- Read-only SELECT for the 0.3 audit, re-run after all code changes to confirm the bad row is
  still present and unmodified. No write query of any kind.
- Full-repo grep for every `projects` writer, including client components, which is how path 5
  surfaced.
- ESLint on the five touched files: no new violations.

**Only live clicking can confirm:**

- That the inherited read-only branch renders. It has never run.
- That a project with no client still offers the selector and writes both fields. The reconciler
  has never executed against a real write.
- That the project detail page still saves correctly now that it goes through the API rather than
  the browser client. **This is the highest-risk change in the batch** - it swapped a direct
  Supabase write for a fetch, and it is worth checking first.
- No browser was opened. There is no Playwright in this repo.

---

## Live checklist

1. **Project with an existing client.** Select **Evergreen Content**, go to `/agency` (RFP
   Broadcast), Step 1. The Client block should show **Pfizer** as read-only text with no dropdown
   and no text field, and a line pointing at the project page. Confirm you cannot pick a profile.
2. Same check in `/agency/magic-rfp`.
3. **Project with no client.** Create a new project via **+ New project** and leave the client
   blank. Start a broadcast on it. The Client block should still offer the select-or-type control
   and the New client profile link.
4. Select a client profile there. Then open that project at `/agency/projects/[id]` and confirm
   **client name now shows the profile's name** - both fields were written, not just the link.
5. Re-open the wizard on that same project. It should now show the client **read-only**, because
   the project has one.
6. **Project detail save (highest risk).** On `/agency/projects/[id]`, edit the client name and
   save. Confirm it persists and no error appears. This path changed from a direct Supabase write
   to an API call.
7. **+ New project** with a client profile selected: confirm the project is created and shows that
   client's name.
8. **Duplication:** duplicate a project that has a client and confirm the copy carries the same
   client name, and the same link if the source had one.
9. **After you run the item 3 SQL:** open onboarding for Evergreen Content and confirm **no client
   group** appears.
