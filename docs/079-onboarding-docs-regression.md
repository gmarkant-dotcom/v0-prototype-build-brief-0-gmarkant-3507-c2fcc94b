# 079 onboarding documents regression — read-only diagnosis

**Date:** 2026-08-18
**Branch:** main (079 applied to production, code deployed)
**Scope:** read-only. No file other than this report was written. No SQL was run. Nothing was pushed.

---

## Verification statement — executed vs read

**Executed** (shell, this repo, at current `main`):

- `grep` sweeps for `onboarding_package_documents`, `agency_id`, `partner_id`, `.rpc(`, and the email subject string across `app/ lib/ components/ contexts/ hooks/`
- `git diff 28be279 HEAD` on every file in the package→document path
- `git log --oneline 28be279..HEAD` on the same paths
- `sed`/`cat` reads of the route, the client component, `lib/library-documents.ts`, and `supabase/migrations/079_organizations.sql`

**Read, not executed:** all source and migration files quoted below.

**Not available to me:** the production database, Vercel runtime logs, and the browser session in which the send happened. Every figure about live data in this report — the 2 package rows, the 1 document row, the 10 library rows, the 0 rows in `project_documents` and `project_messages`, and the contents of `pg_policies` — is **quoted from the brief**, not observed by me. I ran no query.

One note on the baseline commit: the task names `28be279` as the last pre-rename production deploy, and its subject line is `fix: settle msa.confirm, record 081 as applied, unblock 082's stop gate`. I used it as instructed. The five commits between it and `HEAD` on this path are all `079`-labelled (`ec4e97b`, `d053ebb`, `0cf06f5`, `4593c02`, `f6efe54`), which is consistent with it being the pre-rename baseline.

---

## TASK 1 — every insert into `onboarding_package_documents`

There is exactly **one**, in the whole repository:

| File | Line | Statement |
|---|---|---|
| `app/api/projects/[id]/onboarding-packages/route.ts` | **338** | `await supabase.from("onboarding_package_documents").insert(rows)` |

Verified by `grep -rn "onboarding_package_documents"` across `app/ lib/ components/` filtered to `insert|upsert|rpc`. The only other `.rpc()` calls in the codebase are `partner_vouch_count` / `partner_vouch_counts` in `lib/vouch-counts.ts`, neither of which touches this table. No SQL function writes it.

All other references are **reads**:

- `app/api/agency/active-engagements/route.ts:364` (embed), `:465` (sort)
- `app/api/partner/projects/[projectId]/active-engagement/route.ts:221` (embed), `:264`
- `app/api/partner/onboarding-packages/route.ts:123`
- `app/api/partner/onboarding/file/route.ts:36`

**`app/api/projects/[id]/onboarding/deploy/route.ts` is not on this path.** It inserts into `onboarding_deployments` (line 119) and upserts `assignment_agreements` (line 143). It never touches `onboarding_package_documents`. It is also excluded by the email evidence — see below.

**The single client that posts to the writing route:**

- `components/stage-03-onboarding-workflow.tsx:459` → `POST /api/projects/${selectedProject.id}/onboarding-packages`
- Reached from `/agency/onboarding` → `app/agency/onboarding/page.tsx:20` renders `Stage03Onboarding` → `components/stages/stage-03-onboarding.tsx:319` returns `<Stage03OnboardingWorkflow />` for non-demo users.
- `components/stage-03-onboarding-production.tsx` defines `Stage03OnboardingProduction` (line 38) but **nothing imports or renders it**. It is dead on this path.

---

## TASK 2 — statement-by-statement, package insert → document insert

The two inserts are contiguous. Here is the entire region, `route.ts:307–344`:

```ts
307  const { data: pkg, error: pkgErr } = await supabase
308    .from("onboarding_packages")
309    .insert({ project_id, org_id: user.id, partnership_id, ... })
320    .select()
321    .single()
323  if (pkgErr || !pkg) {  ...  return 500 }

328  if (docs.length > 0) {                       // <-- THE GATE
329    const rows = docs.map((d, i) => ({
330      package_id: pkg.id,
331      document_role: d.documentRole,
332      library_document_id: d.libraryDocumentId || null,
333      label: d.label.trim(),
334      url: d.url.trim(),
335      sort_order: i,
336    }))
338    const { error: docErr } = await supabase.from("onboarding_package_documents").insert(rows)
339    if (docErr) {
340      console.error("[onboarding-packages] insert docs", docErr)
341      await supabase.from("onboarding_packages").delete().eq("id", pkg.id)   // rollback
342      return NextResponse.json({ error: "Could not save document list" }, { status: 500 })
343    }
344  }
```

### (a) What supplies the document identifiers

Nothing is looked up. The identifiers arrive **whole, from the request body**, and are used verbatim.

`route.ts:152–169` destructures `documents = []` off the JSON body as `DocPayload[]` (`route.ts:16–21`):

```ts
type DocPayload = {
  documentRole: "agency_doc" | "project_doc" | "template"
  libraryDocumentId?: string | null
  label: string
  url: string
}
```

`route.ts:271–290` is the only processing. It is pure in-memory string work — no database access:

```ts
271  const rawDocs: DocPayload[] = Array.isArray(documents) ? documents : []
273  const docs: DocPayload[] = []
274  for (const d of rawDocs) {
275    const label  = (d.label || "").trim()
276    const rawUrl = (d.url   || "").trim()
277    if (!label && !rawUrl) continue                       // <-- SILENT DROP
278    if (!label || !rawUrl) return 400 "Each document needs label and url"
281    const url = normalizeMeetingUrlForHref(rawUrl)
282    if (!url || (!url.startsWith("http://") && !url.startsWith("https://")))
283      return 400 "Each document url must be http(s)"
285    docs.push({ ...d, label, url })
286  }
292  const projectDocCount = docs.filter(d => d.documentRole === "project_doc").length
293  if (projectDocCount > 10) return 400 "Maximum 10 project documents"
```

`libraryDocumentId` is written straight through to `library_document_id` at line 332 with **no validation and no existence check**. It is never used to resolve anything — `label` and `url` come from the client, not from the library row.

### (b) Is there a SELECT between the two inserts that could skip the insert?

**No. There is no query of any kind between line 307 and line 338.** Lines 322–336 are a null check, an `if`, and an in-memory `.map()`. Nothing reads `agency_library_documents`, nothing re-reads `onboarding_packages`, nothing reads `project_documents`.

The document insert is gated by exactly one condition: `docs.length > 0` at line 328. `docs` is a local array built at lines 271–290 from the request body alone.

### (c) Does any query on this path filter on a column 079 renamed?

**No query on the package→document path exists to filter on anything.** For completeness, the queries *before* the package insert were all checked against the 079 rename list, and every one is correct:

| Line | Query | Column | Verdict |
|---|---|---|---|
| 141 | `projects.select("id, name, org_id")` | `org_id` | correct — 079 line 657 renames `projects.agency_id → org_id` |
| 177 | `partnerships.select("id, lead_org_id, vendor_org_id, status")` | both | correct — 079 lines 672–673 |
| 216 | `partner_rfp_responses.eq("lead_org_id", user.id)` | `lead_org_id` | correct — 079 line 670 |
| 209–213 | embed `partner_rfp_inbox(project_id, partnership_id)` | neither renamed | correct |
| 244–245 | `partnerships.eq("lead_org_id").eq("vendor_org_id", …)` | both | correct |
| 311 | `onboarding_packages.insert({ org_id: user.id })` | `org_id` | correct — 079 line 656 |

I also swept the **entire** app for surviving stale names:

```
grep -rn "agency_id\|partner_id" app lib components contexts hooks   (comments, lead_org_id/vendor_org_id, p_partner_id excluded)
→ contexts/paid-user-context.tsx:107,118  profiles.linked_agency_id
```

That is the only hit, and it is **correct**: `profiles` is not in 079's rename list (079 lines 645–678), so `linked_agency_id` still exists under that name. **There are zero stale column-name string literals left in the application code.**

### (d) What the code does with an error from the document insert

**It does not swallow it.** This is the opposite of the pattern the task suspected. `route.ts:339–343` logs, **deletes the package row**, and returns HTTP 500 — and it does so *before* any email is sent (the send starts at line 380) and before `createOrgNotification` (line 401).

This is materially different from the documented swallow shape in `app/api/partnerships/route.ts` (e.g. `:113`, `:258`, `:290` — log and continue) and from `docs/client-profiles-fix-batch-report.md`. Nothing on this path is destructured away or logged-and-continued.

### The consequence — this is the load-bearing deduction

Take the three facts from the brief together:

1. The post-079 `onboarding_packages` row **exists**.
2. The vendor **received** the email.
3. The route reported **success** (no error in the UI).

Now walk the only two branches that can follow line 328:

- **`docs.length > 0` and the insert errored** → line 341 deletes the package, line 342 returns 500. No email is ever sent. Even if the delete were itself blocked by RLS and the package survived, the function has already returned at line 342 — **the email still cannot have been sent.** Excluded by fact 2.
- **`docs.length === 0`** → the whole block is skipped, execution falls through to the email at line 380 and the notification at line 401, and line 412 returns `{ success: true }`. Package row present, zero document rows, vendor emailed, no error shown. **This matches all three observed facts exactly.**

The email is what closes this. Subject `"Your onboarding documents are ready - ${projectTitle}"` (line 365) occurs at **exactly one place in the codebase** (verified by grep); the deploy route's subject is `"Your onboarding package is ready"` (deploy route line 187), a different string. So the observed email is proof that execution reached line 385 of *this* route, which is only reachable past line 344.

An `.insert()` that violates RLS returns a PostgREST error (`42501`); it does not silently write zero rows. So "insert attempted, no error, no rows" is not a reachable state.

> **Established: the document insert at line 338 was never attempted. `docs` was empty at line 328, which means the POST body's `documents` array arrived empty (or contained only entries whose `label` and `url` were both blank, dropped silently at line 277).**

---

## TASK 3 — diff against `28be279`

```
app/api/agency/library-documents/route.ts          |   2 +-
app/api/projects/[id]/onboarding-packages/route.ts |  93 ++++++++++-----
app/api/projects/[id]/onboarding-partners/route.ts | 100 +++++++++++-----
app/api/projects/[id]/onboarding/deploy/route.ts   |  66 +++++++----
components/stage-03-onboarding-workflow.tsx        |  24 ++---
lib/library-documents.ts                           |   8 +-
```

### `onboarding-packages/route.ts` — every line 079 touched, and whether it is correct

| Old | New | Line | Correct? |
|---|---|---|---|
| `.select("agency_id")` | `.select("org_id")` | 37 | ✅ |
| `project.agency_id !== user.id` | `project.org_id !== user.id` | 50 | ✅ |
| `partner:profiles!partnerships_partner_id_fkey(...)` | `vendor_org:organizations!vendor_org_id(...)` | 61–66 | ✅ (GET only) |
| — | `shapedPackages` normalization added | 83–101 | ✅ (GET only) |
| `.select("id, name, agency_id")` | `.select("id, name, org_id")` | 141 | ✅ |
| `project.agency_id !== user.id` | `project.org_id !== user.id` | 147 | ✅ |
| `"id, agency_id, partner_id, status"` | `"id, lead_org_id, vendor_org_id, status"` | 177 | ✅ |
| `partnership.agency_id !== user.id` | `partnership.lead_org_id !== user.id` | 181 | ✅ |
| `!partnership.partner_id` | `!partnership.vendor_org_id` | 184 | ✅ |
| `partner_id,` in select | `vendor_org_id,` | 211 | ✅ |
| `.eq("agency_id", user.id)` | `.eq("lead_org_id", user.id)` | 216 | ✅ |
| `row.partner_id` | `row.vendor_org_id` | 239 | ✅ |
| `.eq("agency_id").eq("partner_id", …)` | `.eq("lead_org_id").eq("vendor_org_id", …)` | 244–245 | ✅ |
| `agency_id: user.id` in insert | `org_id: user.id` | 311 | ✅ |
| `profiles WHERE id = partner_id` | `resolveOrgNotificationRecipients(vendor_org_id)` | 350 | ✅ (email only) |
| `createNotification({ userId })` | `createOrgNotification({ orgId })` | 401 | ✅ (notification only) |

**The critical result of the diff:**

```
git diff 28be279 HEAD -- app/api/projects/[id]/onboarding-packages/route.ts \
  | grep -c "docs\|document_role\|library_document_id"
→ 0
```

**Zero.** The document-handling code — the `DocPayload` type (16–21), the body destructure of `documents` (160), the validation loop (271–295), and the entire insert block (328–344) — is **byte-identical to the pre-079 version.** Not one line of the path that creates a document row was touched by the rename.

### `components/stage-03-onboarding-workflow.tsx`

079 changed **three things only**, all display-name reads:

- `OnboardingPartnerRow.partner` → `.vendor_org`, with `{id,email,full_name,company_name}` → `{id,name,contact_name,contact_email}` (lines 34–42)
- the `<SelectItem>` label at 588–591
- the selected-vendor heading at 926–929

`handleSaveSend` (415–503), including the entire `docs` array construction (424–446), is **unchanged**.

### `lib/library-documents.ts` and `app/api/agency/library-documents/route.ts`

Four `.eq("agency_id", …)` → `.eq("org_id", …)` and one insert key. All four target tables — `projects` (079 line 657), `clients` (line 652), `agency_library_documents` (line 645) — **are** in 079's rename list. All correct.

### `onboarding/deploy/route.ts`

Rewritten for org contacts, but it writes `onboarding_deployments`, not our table. Off-path.

**Task 3 conclusion: the 079 diff does not contain the defect.** Every renamed reference on this path is correct, no stale name survives anywhere in the app, and the document-creation code was not modified at all.

---

## TASK 4 — the client side

**The request body still carries the attached documents.** `components/stage-03-onboarding-workflow.tsx:465–472`:

```ts
body: JSON.stringify({
  partnershipId, assignmentId, kickoffType, kickoffUrl,
  kickoffAvailability, customMessage,
  documents: docs,          // line 472
}),
```

`docs` is assembled at 424–446 from two independent sources, and **both contain a silent-drop `continue`**:

```ts
424  const docs = []
426  for (const id of selectedLibIds) {
427    const row = library.find((l) => l.id === id)
428    if (!row) continue                              // <-- SILENT DROP A
429    const u = libraryUrl(row)
430    if (!u) continue                                // <-- SILENT DROP B
431    const role = row.section === "agency" ? "agency_doc" : "template"
432    docs.push({ documentRole: role, libraryDocumentId: row.id, label: row.label, url: u })
438  }
439  for (const p of projectItems) {
440    const raw = p.source === "file" ? (p.storedUrl || "").trim() : p.urlInput.trim()
441    if (!p.label.trim() || !raw) continue           // <-- SILENT DROP C
442    const url = normalizeMeetingUrlForHref(raw) || raw
443    docs.push({ documentRole: "project_doc", libraryDocumentId: null, label: p.label.trim(), url })
446  }
```

If every attachment falls through one of these three `continue`s, `docs` is `[]`, the POST still succeeds, and the user sees the success modal (line 489) with no warning that their attachment was discarded. **That is precisely the observed signature.**

Neither the field names nor the shape of this body were changed by 079 (see Task 3), so a rename cannot have emptied it directly.

Supporting state, all read and confirmed non-stale:

- `library` is filled from `GET /api/agency/library-documents?project_id=…` (line 160), which routes to `fetchScopedLibraryDocuments` — correct post-079 (`org_id` on `projects`, `clients`, `agency_library_documents`).
- `agencyDocs` / `templateDocs` / `clientDocs` (lines 288–296) partition `library` by `section` and `isClientScopedDocument`. Neither `section` nor `client_id` was renamed by 079.
- `libraryUrl` (84–87) reads `source_type`, `external_url`, `blob_url` — none renamed.
- Checkboxes are `disabled` when `!libraryUrl(d)` (630, 672, 709), so drop B cannot normally be reached from a fresh page load.

---

## TASK 5 — root cause

### I cannot establish the root cause with confidence. I will not present a hypothesis as a finding.

Here is the precise boundary of what the code proves.

**Proven from the code and the brief's figures:** the failure is *not* in the document insert, *not* in RLS, and *not* in the 079 rename. There is exactly one insert into `onboarding_package_documents` (`app/api/projects/[id]/onboarding-packages/route.ts:338`); it rolls the package back and returns 500 before any email is sent if it errors (339–343); the vendor received the email, so it cannot have errored; therefore it was never reached, so `docs.length === 0` at line 328 (route.ts). The route received an empty `documents` array. Every line the 079 rename touched on this path is correct, the document-handling block is byte-identical to `28be279`, and a full-repo sweep finds no surviving stale column name. **The 079 rename did not cause this.**

**Not proven, and not determinable from source alone:** *why* the array arrived empty. That depends on the browser state at 14:55 — the contents of `selectedLibIds`, `library`, and `projectItems` at the moment Send was clicked — and I have no runtime log, no request body capture, and no database access. The three `continue` statements at `stage-03-onboarding-workflow.tsx:428`, `:430`, and `:441` each discard an attachment without telling the user or the server, and all three are indistinguishable in their result.

### Ranked candidates for the empty array

**1. Send clicked while a project-document file upload was still in flight** (`stage-03-onboarding-workflow.tsx:441`). The Send button's guard is `disabled={sending || !partnershipId}` (**line 909**) — it does **not** include `uploadingAttach`. `uploadForAttach` (314–348) sets `storedUrl` only in its `.then` path at 333–338. A row created by "Add item" starts as `{ source: "url", storedUrl: null }` (`newAttach`, 74–82) and only flips to `source: "file"` at 336 *after* the upload resolves. So between file-picker and upload completion the row has a label and no URL, line 441 drops it silently, and the send goes out with zero documents and a success modal. This requires no 079 involvement and is a genuine, code-visible race in current `main`.

**2. Stale `selectedLibIds` after a project switch** (`:428`). `selectedLibIds` is initialised at line 111 and reset in exactly one place — line 489, after a successful send. **No effect clears it when `selectedProject` changes**, but `refreshLibrary` *does* reload `library` for the new project (152–177, dep `selectedProject?.id`). Ids selected under project A therefore survive into project B, `library.find` at 427 misses, and every one is dropped at 428. The checkboxes render unchecked, so nothing on screen contradicts the user's belief that a document is attached.

**3. Library fetch failed, so the attachment was never in `library`** (`:428`). `refreshLibrary` logs to console and leaves `library` as `[]` on a non-OK response (168–173). I rank this **low**: the picker would render "No agency library documents yet" (line 653) and there would have been nothing to attach. It is also weakly contradicted by the brief's figure of 10 `agency_library_documents` rows.

**4. Attachment discarded at the route** (`route.ts:277`). Requires `label` and `url` both blank on every entry, which the client's own drops at 428/430/441 would have caught first. Effectively subsumed by 1–3.

### What would distinguish them

| Evidence | Distinguishes |
|---|---|
| Vercel runtime log for `POST /api/projects/[id]/onboarding-packages` at 2026-08-18 14:55, showing the request body | **Decides it outright.** `documents: []` confirms a client-side drop; a populated array falsifies my entire deduction and reopens the route. |
| Browser console for that session | `[onboarding] /api/upload failed` → **#1**. `[onboarding] library-documents fetch failed` → **#3**. Silence → **#1 (mid-flight) or #2**. |
| Whether the user switched projects between attaching and sending | Confirms or kills **#2**. |
| Whether the attachment was a library checkbox or a "Project documents" upload | Library → **#2/#3**. Upload → **#1**. |
| A Vercel Blob object uploaded under `onboarding-project` at ~14:55 | Present → upload completed, weakens **#1**. Absent → strengthens **#1**. |

**The single most valuable next step is the 14:55 request body from the Vercel log.** It converts this from a ranked list into a finding. I would not ship a fix before seeing it.

### One thing I could not check

The brief states both live policies were read from `pg_policies` and are correct, so I did not investigate RLS — and the email evidence independently excludes it. I did read `supabase/migrations/079_organizations.sql:451–461`: `current_user_org_ids()` returns `org_members.org_id` for `auth.uid()`, and the backfill at line 322 writes `organizations.id = profiles.id` ("Option C"). For backfilled users the org id equals the user id, so both `project.org_id !== user.id` in the route and `p.org_id IN (SELECT current_user_org_ids())` in the policy are satisfied by the same value. Consistent. See the separate concern in Task 6.

---

## TASK 6 — proposed fix (NOT APPLIED)

I am proposing **defensive changes that make this class of failure impossible to observe silently**, not a fix for a confirmed cause. Once the request body is in hand, one of these becomes the actual fix and the rest remain worth having.

### Fix 1 — the route must not report success when it silently discarded a document list

`app/api/projects/[id]/onboarding-packages/route.ts`

```diff
@@ -269,6 +269,7 @@
     const rawDocs: DocPayload[] = Array.isArray(documents) ? documents : []
     /** Drop empty slots; require label+url only for rows the client actually filled in. */
     const docs: DocPayload[] = []
+    let droppedBlankSlots = 0
     for (const d of rawDocs) {
       const label = (d.label || "").trim()
       const rawUrl = (d.url || "").trim()
-      if (!label && !rawUrl) continue
+      if (!label && !rawUrl) { droppedBlankSlots++; continue }
       if (!label || !rawUrl) {
         return NextResponse.json({ error: "Each document needs label and url" }, { status: 400 })
       }
@@ -290,6 +291,18 @@
     }
 
+    // A package that was meant to carry documents and carries none is the 2026-08-18
+    // regression signature: the row is created, the vendor is emailed, and nothing tells
+    // anyone the attachment was lost. Refuse instead, and log enough to tell a client-side
+    // drop from an empty request.
+    if (rawDocs.length > 0 && docs.length === 0) {
+      console.error(`${logPrefix} every document in the request was discarded`, {
+        projectId, partnershipId, userId: user.id,
+        rawDocCount: rawDocs.length, droppedBlankSlots,
+      })
+      return NextResponse.json(
+        { error: "The attached documents could not be read. Re-attach them and send again." },
+        { status: 400 }
+      )
+    }
+
     const projectDocCount = docs.filter((d) => d.documentRole === "project_doc").length
```

**What could break:** a client that deliberately posts blank placeholder slots would now get a 400 instead of a documentless package. Only `stage-03-onboarding-workflow.tsx` posts here, and it never emits blank slots — 428/430/441 filter them out before the body is built — so no live caller is affected. This does **not** catch `documents: []` (an empty array is a legitimate no-documents package), which is why Fix 2 is needed too.

### Fix 2 — the client must not silently discard what the user attached

`components/stage-03-onboarding-workflow.tsx`

```diff
@@ -422,6 +422,7 @@
     const docs: { documentRole: ...; libraryDocumentId: string | null; label: string; url: string }[] = []
+    const dropped: string[] = []
 
     for (const id of selectedLibIds) {
       const row = library.find((l) => l.id === id)
-      if (!row) continue
+      if (!row) { dropped.push("a library document that is no longer in this project's library"); continue }
       const u = libraryUrl(row)
-      if (!u) continue
+      if (!u) { dropped.push(`"${row.label}" (no file or link on record)`); continue }
@@ -437,10 +438,20 @@
     for (const p of projectItems) {
       const raw = p.source === "file" ? (p.storedUrl || "").trim() : p.urlInput.trim()
-      if (!p.label.trim() || !raw) continue
+      if (!p.label.trim() || !raw) {
+        dropped.push(p.label.trim() ? `"${p.label.trim()}" (no file or link yet)` : "an unnamed project document")
+        continue
+      }
       const url = normalizeMeetingUrlForHref(raw) || raw
       docs.push({ documentRole: "project_doc", libraryDocumentId: null, label: p.label.trim(), url })
     }
 
+    if (dropped.length > 0) {
+      setError(
+        `These attachments are not ready to send: ${dropped.join(", ")}. ` +
+        `Wait for uploads to finish or remove them, then send again.`
+      )
+      return
+    }
+
     const projectCount = docs.filter((d) => d.documentRole === "project_doc").length
```

**What could break:** a user who added an empty "Add item" row and left it blank now has to remove it before sending, where previously it was ignored. That is a deliberate trade — the silent ignore is the bug. Copy above uses no em dashes, per `CLAUDE.md`.

### Fix 3 — close the upload race directly

```diff
@@ -907,7 +907,7 @@
             <Button
-              disabled={sending || !partnershipId}
+              disabled={sending || !partnershipId || uploadingAttach !== null}
               onClick={() => void handleSaveSend()}
```

**What could break:** nothing. `uploadingAttach` is already cleared in the `finally` of `uploadForAttach` (line 346), so the button cannot latch. This is the smallest change of the three and the one I would ship first regardless of what the log says.

### Fix 4 — clear the selection when the project changes

```diff
@@ -217,6 +217,12 @@
   useEffect(() => {
     if (!selectedProject?.id) return
     void loadOnboardingPartners()
   }, [selectedProject?.id, loadOnboardingPartners])
+
+  // Attachments belong to the project they were picked under. Carrying ids across a
+  // project switch makes library.find() miss and drops them without a word.
+  useEffect(() => {
+    setSelectedLibIds([])
+    setProjectItems([])
+  }, [selectedProject?.id])
```

**What could break:** a user who attaches, switches project to check something, and switches back now loses their selection. Correct behaviour — the alternative is sending project A's documents to project B's vendor, or silently sending none.

### Other sites with the same shape

**A rename miss is not one of them.** The sweep over `app/ lib/ components/ contexts/ hooks/` returns exactly one hit for `agency_id|partner_id` — `contexts/paid-user-context.tsx:107,118`, `profiles.linked_agency_id` — and that is correct, since `profiles` is not in 079's rename list. There is no second site to fix.

The shape that **does** repeat is the silent drop:

| Site | Shape |
|---|---|
| `app/api/partnerships/route.ts:113, :258, :290` | log-and-continue on query error; the documented pattern from `docs/client-profiles-fix-batch-report.md` |
| `app/api/projects/[id]/onboarding/deploy/route.ts:153` | `if (upErr) console.error(...)` — an `assignment_agreements` upsert failure still returns `success: true` and still emails the vendor. **Same class as this bug, still live.** |
| `app/api/projects/[id]/onboarding/deploy/route.ts:123` | `document_ids: documentIds` written with no validation that the ids exist |
| `components/stage-03-onboarding-workflow.tsx:428, :430, :441` | the three drops above |

Note that `onboarding-packages/route.ts:338` is, by contrast, one of the **well-behaved** sites — it rolls back and fails loudly. That correctness is what let this diagnosis reach a conclusion at all.

### One unrelated 079 landmine, flagged not fixed

`supabase/migrations/079_organizations.sql:322` backfills `organizations.id = profiles.id`, and its own comment warns: *"nothing at run time may rely on it"*. But the PHASE 12 signup trigger at line 1913 inserts with `gen_random_uuid()`. Every runtime check of the form `project.org_id !== user.id` — `onboarding-packages/route.ts:50` and `:147`, `deploy/route.ts:62`, `lib/library-documents.ts:122/136/141/181` — compares an org id against a user id and **will 404 or return empty for every organization created after 079**. It is not this bug (it produces a 404, not a documentless package), it is out of scope here, and it deserves its own ticket.

---

## Summary

| | |
|---|---|
| **Inserts into `onboarding_package_documents`** | one, `app/api/projects/[id]/onboarding-packages/route.ts:338` |
| **Intermediate SELECT between the inserts** | none |
| **Renamed column on the document path** | none; the block is byte-identical to `28be279` |
| **Document-insert error handling** | rolls back the package and 500s; not swallowed |
| **Client body still carries documents** | yes, `stage-03-onboarding-workflow.tsx:472`, untouched by 079 |
| **Stale column names left in the repo** | zero |
| **Established** | `docs.length === 0` at `route.ts:328`; the route received an empty `documents` array; 079 is not the cause |
| **Not established** | why the array was empty; three silent `continue`s at `:428`, `:430`, `:441` are indistinguishable from source |
| **Next step** | the Vercel request body for the 14:55 POST |
