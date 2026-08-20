# The `bid.decline` scope name, and the two emitters beside it

**Date:** 2026-08-20
**Branch:** `main`, uncommitted
**Touched:** `app/api/agency/rfp-responses/[id]/route.ts` (one file)

---

## 1. The symptom, and what it actually was

The emitted payload:

```json
{"had_reason": false, "scope_item_name": null}
```

The starting hypothesis was the `recipient_email` class from earlier today - a column present
on a row the route already holds, simply left out of a `select`. **It is not that.** The
decline block selects the column and always did:

```ts
.select("scope_item_name, master_rfp_json, partnership_id")
```

The column was selected. **The query never ran.**

### Read from the database, not inferred

There is exactly one `bid.decline` row in `milestone_events`:

| field | value |
|---|---|
| `subject_id` | `3355d617-…d58a` |
| `partnership_id` | **`null`** |
| `payload` | `{"had_reason": false, "scope_item_name": null}` |

`partnership_id` is null **as well**, and it comes off the same `inbox` object. Two nulls
from one source is not a missing column, it is a missing row. The response confirms it:

```json
{"id": "3355d617-…d58a", "inbox_item_id": null, "vendor_org_id": null, "status": "declined"}
```

`inbox_item_id` is null, so the ternary guarding the query took its other branch -
`Promise.resolve({ data: null, error: null })` - and `inbox` was null before anything was
read. The guard is correct and must stay: `.eq("id", null)` on a uuid column is a Postgres
type error, which is the bug that guard was added to fix.

**This is a guest / magic-link bid.** Migration 057 made `inbox_item_id` nullable precisely
so these bids could exist without a `partner_rfp_inbox` row. The scope title was never
missing - it is on the originating token:

```json
{"response_id": "3355d617-…d58a",
 "scope_item_name": "April Test - Q3 Product Launch v3",
 "project_id": "8263f702-…4df0d6", "vendor_email": "…+compare@gmail.com"}
```

So the diagnosis holds in shape - a value the route can reach and does not - but the source
is `rfp_magic_tokens`, not a `select` list.

**8 of the response rows in this database carry `inbox_item_id: null`.** This is the common
shape, not an edge case.

---

## 2. What was wrong where

| Emitter | Guest bid (`inbox_item_id` null) | Real inbox row |
|---|---|---|
| `bid.decline` | **Broken** - `scope_item_name` null, `partnership_id` null, and the mail goes out as "Update on your recent bid submission" | Correct |
| `bid.feedback` | **Broken** - same two nulls, same unnamed subject line | Correct |
| `bid.award` | Correct already | **Writes a placeholder** - see below |

### `bid.award` never had the gap - and that is where the fix came from

The award path already resolves the guest shape, because it *has* to: `project_assignments`
needs a `project_id` and a `partnership_id`, so award cannot proceed without them. It falls
back through two sources in order - a G1-synthesized inbox row found by the
`master_rfp_json._magic_token` marker, then `rfp_magic_tokens` itself - and carries
`scope_item_name` out of whichever answered. That resolution existed; the other two emitters
just never got it.

### `bid.award` had a different defect, in the same key

Award wrote `scope_item_name: scopeItemName`, and `scopeItemName` is the **email's**
placeholder:

```ts
const scopeItemName = rawScopeItemName || "Scope item"
```

`lib/activity-feed.ts:284` has its own fallback - `input.scope || "a scope item"` - and
`payloadString` only rejects empty strings, not plausible ones. So an unresolved award
rendered **"awarded the bid on Scope item"**: a display placeholder stored as if it were a
real title, defeating the renderer's fallback rather than reaching it. `bid.decline` and
`bid.feedback` both already wrote `rawScopeItemName || null`. Award now matches.

---

## 3. The fix

One new module-scope helper, `resolveGuestBidContext()`, and four call-site lines.

```ts
async function resolveGuestBidContext(
  supabase, { responseId, callerOrgIds, route }
): Promise<{ scopeItemName: string | null; partnershipId: string | null; masterRfpJson: unknown }>
```

1. `rfp_magic_tokens` by `response_id` - the token and its `scope_item_name`. Read on the
   session client, same as the award path: the token rows are the agency's own.
2. If a token exists, look for a G1-synthesized `partner_rfp_inbox` row via
   `master_rfp_json @> {"_magic_token": …}`, scoped `.in("lead_org_id", callerOrgIds)`.
   Preferred where it exists because it is the **only** source of `partnership_id`, and
   `partnership_id` is what makes a vendor-whitelisted milestone reachable by the vendor it
   is about.
3. Otherwise the token's name, with a null partnership.

Every failure path returns nulls and logs. It is read-only, and it cannot fail a decline: a
breadcrumb and a subject line are not worth losing the action they describe.

**Called only when there is no inbox row at all** (`inbox ? null : await …`). A real inbox
row stays authoritative even where its own `scope_item_name` is blank - the fallback is for
the shape that has no row, not for a row that has no name.

### The four call sites

| Site | Before | After |
|---|---|---|
| decline scope | `inbox?.scope_item_name?.trim?.()` | `(inbox?.scope_item_name ?? guest?.scopeItemName)?.trim?.()` |
| decline project | `inbox?.master_rfp_json` | `inbox?.master_rfp_json ?? guest?.masterRfpJson` |
| decline / feedback partnership | `?? null` | `?? guest?.partnershipId ?? null` |
| award payload | `scope_item_name: scopeItemName` | `scope_item_name: rawScopeItemName \|\| null` |

### What this fixes beyond the milestone

The same two variables feed the outgoing mail. A guest vendor who is declined now gets
**"Update on your bid for April Test - Q3 Product Launch v3"** instead of "Update on your
recent bid submission", and the feedback mail names the scope in its subject and its body.
Same fetch, no extra query - the emitter and the email were reading the same null.

---

## 4. The eight gates

Baseline re-read from `docs/recent-activity-merge-report.md` §3 on a clean tree at `e4d7d24`.

| Gate | Baseline | This run | Verdict |
|---|---|---|---|
| `npx tsc --noEmit` | 0 | **0** | Passes |
| `pnpm build` | 0 | **0** | Passes |
| `pnpm lint` | 1 | **1** | Unchanged - **183 problems, 154 errors, 29 warnings**, identical totals |
| `pnpm verify-rls` | 2 | **2** | Known pre-existing |
| `pnpm policy-audit:guard` | 1 | **1** | Known pre-existing |
| `pnpm identity-columns:guard` | 0 | **0** | Passes |
| `pnpm embed-targets` | 0 | **0** | Passes |
| `pnpm org-id-reads:guard` | 0 | **0** | Passes - **no allow-list entry needed** |

`org-id-reads:guard` deserves a note: the helper reads `partner_rfp_inbox` with
`callerOrgIds` in scope, which is the shape that tripped the NEARBY heuristic on the last
run. It did not fire here - the read is `.in("lead_org_id", callerOrgIds)`, an organization
column filtered by organization ids, which is what the guard is *for*. Class B baseline
unchanged at 62 known-open sites.

`pnpm build` rewrites `next-env.d.ts` from the dev types path to the prod one. Reverted; it
is a build artifact, not a change.

---

## 5. Two things found and deliberately not changed

**1. The feedback email's CTA interpolates a null.**
`app/api/agency/rfp-responses/[id]/route.ts` builds the feedback link as
`${baseUrl}/partner/rfps/${existing.inbox_item_id}` - which on exactly the guest bids this
run is about renders **`/partner/rfps/null`**. The sibling decline mail links to the
unparameterised `/partner/rfps` and is fine. Not fixed here: where a guest with no inbox row
should actually land is a product decision, not a null-handling one, and it is a different
bug from the one asked about.

**2. The decline block's inbox query is not org-scoped.**
Feedback and award both filter `.in("lead_org_id", callerOrgIds)`; decline does not. Not a
hole - the lookup is by primary key off a response already proven to belong to the caller,
and RLS scopes it regardless. Left alone because adding the filter would newly null the scope
for any row whose `lead_org_id` disagrees with its response's, and there is no evidence
either way about whether such rows exist. Worth a deliberate decision rather than a drive-by.

---

## 6. Not committed

Per instruction. `git status` shows one modified file plus this report.
