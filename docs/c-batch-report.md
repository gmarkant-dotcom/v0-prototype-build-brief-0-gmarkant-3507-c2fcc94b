# C-Batch Report

Aug 13, 2026. Five commits, items 1 through 4 plus this report. **Not pushed.** No SQL migration
written or run. No write query executed against the database. Read-only SELECT used throughout
diagnosis.

`pnpm build` exit 0 and `npx tsc --noEmit` exit 0 before every commit. ESLint report-only.

| Commit | Item |
| --- | --- |
| `a04ce05` | ITEM 1 persist client_id on projects |
| `3dca7f4` | ITEM 2 Vendor Pool control row overflow |
| `b258b7f` | ITEM 3 Master Documents collapse, sort, filter |
| `f36e73b` | ITEM 4 onboarding discovery document |

---

## 0.1 answer, first and unambiguous

**No. `projects.client_id` was never written by any flow that names a client, and the document
scoping shipped last batch was unreachable code.**

Read-only query across all six live projects:

| Metric | Count |
| --- | --- |
| projects total | 6 |
| projects with non-null `client_id` | **0** |
| projects with non-null `client_name` | 6 |
| `clients` rows | 2 |
| client-scoped `agency_library_documents` rows | 2 |

So client profiles exist and client documents save correctly - the last batch's item 1 works.
Nothing connected them to a project.

Per path, as found by reading code:

| Path | Writes |
| --- | --- |
| `+ New project` dialog | `client_id` **and** `client_name`. The only writer, and the only path that creates a project from scratch |
| RFP broadcast wizard | **neither**. Operates on an already-selected project; put the client string only into `master_rfp_json` |
| magic-link flow | **neither**. Reads `projects` for display only |
| project duplication | `client_name` only; dropped `client_id` |

**Stated plainly, as required:** the onboarding client document group shipped in the last batch
scopes by `project_id` to the project's `client_id`. Since no project had one, that group could
not have rendered for anyone, ever. It was unreachable from the moment it shipped. Item 1 is what
makes it reachable.

---

## 0.2, as queried

**I could not query `pg_policies` or `pg_constraint`, and I am not going to pretend otherwise.**

`POSTGRES_PASSWORD`, `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING` are all present but **empty**
in `.env.production.local` (raw value length 2, i.e. `""`), and absent from `.env.local`. Only
`POSTGRES_HOST`, `POSTGRES_USER` and `POSTGRES_DATABASE` carry values. There is no `psql` on this
machine and no `pg` driver in the repo. I installed `pg` into `/tmp` (outside the repo) and
attempted a direct connection; it failed at `ECONNREFUSED` because the connection string was
empty and it fell back to localhost.

**This is a real gap for the Organizations epic**, which will lean on RLS everywhere. Auditing
policy expressions requires a database password that does not currently exist in the repo's env
files.

What I could establish, behaviourally, with the anon key versus the service-role key:

| Table | service role | anon, no JWT | Conclusion |
| --- | --- | --- | --- |
| `clients` | 200, 2 rows | 200, `[]` | RLS enabled and filtering |
| `agency_library_documents` | 200, 10 rows | 200, `[]` | RLS enabled and filtering |
| `projects` | 200, 6 rows | 200, `[]` | RLS enabled and filtering |

An empty array rather than a permission error is the signature of an active RLS policy that
matches no rows for an unauthenticated caller. **This does not reveal the policy expressions.**
The `agency_id = auth.uid()` shape written in migration 077 remains unconfirmed at the catalog
level.

**0.2a confirmed positively:** `onboarding_package_documents.library_document_id` exists. A
PostgREST projection naming that column returned 200 rather than 42703. That is a behavioural
confirmation of the column's existence, stronger than OpenAPI introspection, though still not an
`information_schema` read. The table has **zero rows**, so nothing reads it in practice yet;
`app/api/projects/[id]/onboarding-packages/route.ts:300` is the only writer.

---

## 0.3 root cause

Not a fixed width and not an explicit horizontal scroll container.

The Active vendors card sits in `grid md:grid-cols-3`, roughly a third of the content width. Its
control row was `flex items-center gap-2 shrink-0` holding View profile, the Q4 CONFIRM group and
the status pill - over 400px that `shrink-0` forbade from shrinking **or** wrapping, inside a
column nearer 300px.

The scrollbar specifically comes from the enclosing list being `md:overflow-y-auto`. Per CSS, when
one axis is set to a non-visible overflow, the other axis computes as `auto` rather than
remaining `visible`. So the excess produced a horizontal scrollbar inside the card instead of
spilling out of it.

## 0.4 confirmed

No sort, no filter, no collapse. Three plain `GlassCard` sections as siblings in one flex column.
The F1 wrapper is `components/bid-form-collapsible-section.tsx`, already used by the RFP wizard
step, and it wrapped these sections in place with no page restructuring.

---

## Per item

### ITEM 1 - `a04ce05`

**Root cause:** see 0.1. Two of the three client-naming flows wrote nothing.

**Files:** `lib/client-project-link.ts` (new), `app/api/projects/[id]/route.ts`,
`app/api/agency/projects/duplicate/route.ts`, `app/agency/page.tsx`,
`app/agency/magic-rfp/page.tsx`.

**Changed:** one shared `persistProjectClientLink` so the two flows cannot drift. Both PATCH the
selected project's `client_id` when a profile is applied, and clear it when the user returns to a
typed name. `client_name` stays populated in both cases. A typed name still writes `client_id`
null and never creates a profile. The PATCH route handles `client_id` outside the field
allow-list and verifies `clients.agency_id` ownership first, so a client belonging to another
agency can never be attached. Duplication now carries `client_id`. Failure is soft on both flows -
naming a client on an RFP must not block a broadcast.

The magic-link flow gains this **without any token column**, which is exactly why the link belongs
on the project: A0 flagged that `rfp_magic_tokens` derives its client through `project_id`.

### ITEM 2 - `3dca7f4`

**Root cause:** see 0.3.

**Files:** `app/agency/pool/page.tsx`.

**Changed:** the control group wraps instead of overflowing
(`flex flex-wrap items-center justify-end gap-2 min-w-0 ml-auto`), wrapping chosen over scrolling
per the requirement. Status pill gains `whitespace-nowrap shrink-0`. The Q4 grouping is preserved
exactly, including `flex-nowrap` inside the CONFIRM group so the NDA and MSA controls still cannot
stack into look-alike twins - only the outer row wraps, moving the group to its own line intact.

Checked at other pipeline states rather than tuned to one row: the Invited/Discovered rows carry
"Send Invitation" plus "Remove" at `shrink-0` in the same column and got the same treatment; the
demo invitation row carries a lone status pill where `shrink-0` is correct and was left alone.

**Ride-along done:** the "Already on Ligament" chip's literal sky colors replaced with the ruled
neutral treatment. No sky literal remains on the page.

### ITEM 3 - `b258b7f`

**Files:** `components/agency-document-library-manager.tsx`.

**Changed:** all three sections wrapped in the F1 shared collapsible, default open, no
persistence. Header summaries derive from the same lookup each section renders: "N of 3 filled",
"N of 6 filled", "N across M clients". Sort (client name, or updated date) and filter by client
apply to the Client documents list only, driven by the clients actually present so the filter can
never offer an empty option. The two slot grids are untouched - they are fixed named slots, not
lists. Nothing changed about what any section queries.

### ITEM 4 - `f36e73b`

`docs/onboarding-discovery.md`. No app code written. Headline: **zero packages have ever been
sent** (`onboarding_packages` 0 rows, `onboarding_package_documents` 0 rows, `project_documents`
0 rows). Two blocks named as not earning their place: Project documents, which writes
`library_document_id` null and therefore loses data to the library permanently, and the MSA
tracker, a separate persistent lifecycle bolted onto a send-once form.

---

## Judgment calls taken

1. **The link is written at selection time, not at broadcast time.** Smallest reversible option:
   it is the moment the user says "this project is for Samsung", it makes onboarding work
   immediately, and re-selecting overwrites it. Broadcast-time would have meant threading it
   through a much larger code path for the same result.
2. **`client_id` handled outside the PATCH allow-list.** It is the only field there pointing at
   another row, so it gets an ownership check rather than being waved through by a name match.
3. **Wrapping, not truncation or scrolling**, for item 2. Explicitly requested, and the only
   option that loses no content.
4. **The Invited/Discovered row got the same fix** though the item named the Active card. The item
   asked for the fix not to be tuned to one row, and that row is the same pattern.
5. **`pg` installed into `/tmp`, not the repo**, to attempt the catalog query. The repo's
   `package.json` and lockfile are untouched.
6. **Item 3 header counts are "N of M filled"** rather than a raw document count, because the slot
   grids hold at most one row per slot and a raw count would be misleading about what is there.
7. **The client filter renders only when more than one client has documents.** A filter with one
   option is furniture.

---

## Not done and why

- **No catalog query for 0.2.** Impossible without a database password, which the repo does not
  carry. Reported rather than approximated.
- **No backfill** of the six legacy `client_name` projects. Reviewed decision, deferred.
- **No onboarding code.** Discovery only, per the brief.
- **The "Invited" chip's literal amber values** on the pool page. Same class as the sky chip but
  outside item 2's stated scope. Logged.
- Everything on the do-not list: no `next.config.mjs` change, no profile deletion, no hover sweep.
- **`/tmp/pgc`** holds a stray `pg` install. Outside the repo, harmless, delete at will.

---

## Honest verification

**Executed:**

- `pnpm build` exit 0 and `npx tsc --noEmit` exit 0 before each of the four commits.
- Read-only SELECT via PostgREST for: the 0.1 project and client counts, the 0.2 RLS behavioural
  probes with both keys, the 0.2a column projection, and the 0.5 onboarding row counts. No write
  query, no migration.
- An attempted direct Postgres connection for the catalog query, which failed on empty
  credentials. Reported rather than hidden.
- Full-repo greps including `contexts/` before every change. Nothing deleted this batch except one
  now-unused import, grep-confirmed.
- ESLint report-only; no new violations in the touched files.

**Only live clicking can confirm:**

- That selecting a client profile in the wizard or magic-rfp now writes `client_id`. The code path
  is new and has never run.
- That the onboarding client group consequently appears. It has never rendered for anyone.
- That the pool control row fits at real desktop widths. This is a layout fix reasoned from the
  CSS, and it is the item most in need of eyes.
- Master Documents collapse, sort and filter interactions.
- Nothing in this batch was browser-tested. There is no Playwright in this repo.

---

## Live test checklist, in click order

**A. The linchpin: a NEW broadcast with a client profile**

1. Go to `/agency/clients`. Confirm two profiles exist (`Samsung 2026 New Policies`, `Samsung v2`)
   and that at least one has a document. Add one if not.
2. Create a **new** project via **+ New project**, or select an existing one.
3. Go to `/agency` (RFP Broadcast). At Step 1, in the Client block, select a client profile with
   documents.
4. Confirm its documents appear in Reference Materials below.
5. **The new bit:** open that project's record or re-open the wizard. The project should now carry
   the client link. If you can query, `select client_name, client_id from projects where id = ...`
   should show both populated.

**B. Onboarding client group, previously unreachable**

6. With that same project selected, go to `/agency/onboarding`.
7. A **"<Client> documents"** group should appear above Agency documents, listing only that
   client's documents.
8. Confirm no other client's documents appear anywhere on that page.

**C. Typed name control**

9. Start a broadcast on one of the six legacy projects (Rivian, Adidas, Chime, Pfizer, Whoop) and
   type a client name rather than selecting a profile.
10. Go to `/agency/onboarding` for that project. There must be **no client group and no empty
    heading** - Agency documents and Key templates only. This is the regression guard.

**D. Pool card, multiple pipeline states**

11. Go to `/agency/pool` at a normal desktop width.
12. **Active vendors** column: no horizontal scrollbar inside the card, no clipped control, the
    status pill fully visible. The CONFIRM group may sit on its own line - that is the fix
    working.
13. Confirm the NDA control is still green and the MSA control neutral outlined, and that they
    remain visibly one group.
14. **Invited** and **Discovered** columns: same check. "Send Invitation" and "Remove" must not
    clip.
15. Narrow the window toward tablet width and confirm content wraps rather than scrolling.
16. Confirm the "Already on Ligament" chip is now neutral, not blue.

**E. Master Documents**

17. Go to `/agency/documents`. Three collapsible sections, all open.
18. Collapse each. Headers should read "N of 3 filled", "N of 6 filled", "N across M clients".
19. Expand Client documents. Toggle sort between **Client name** and **Updated** and confirm the
    order changes.
20. With two clients holding documents, confirm the client filter chips appear with counts, that
    selecting one narrows the list, and that **All** restores it.
21. Confirm the Agency documents and Key templates slot grids are unchanged - same slots, same
    order, no sorting applied.
