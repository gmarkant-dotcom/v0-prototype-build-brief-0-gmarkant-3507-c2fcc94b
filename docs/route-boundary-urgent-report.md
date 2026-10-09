# Route boundary urgent fixes, 2026-10-09

Branch `fix/route-boundary-urgent`, cut from `main` at `40a7286`. Not pushed, not merged.
Source: `ligament-audit/docs/leak-sweep-2026-10-09.md`, Finding (2), "exceptions" list.

Files changed:

- `app/api/brief/save/route.ts` (Fix 1)
- `app/api/agency/library-documents/file/route.ts` (Fix 2)
- `lib/vercel-blob-url.ts`: new `parseAgencyLibraryBlobPathFromUrl()` (shared helper for Fix 2)

No migration, no database change. Neither fix reads `role`, `active_role` or `secondary_role`.
Scope comes from the session: `resolveCallerOrgIds()` (org_members) and RLS.

## Gates

| Gate | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0, no output (0 errors) |
| `pnpm exec eslint` on the 3 touched files | exit 0, no messages |

Full `pnpm lint` was not run; the brief asked only for messages in touched files.
**Not tested in a browser or against the database.** The steps below are for the owner.

---

## Fix 1: `brief/save` cross-tenant write

### Before

`app/api/brief/save/route.ts:45-62` (pre-fix line numbers). After auth (cookie session, or a
Bearer token verified with the service role at :17-26), it built a **service-role** client and
inserted into `brief_interpretations` with `project_id` taken straight from the body (:56). The
route never checked that project. On error, :66 returned `error.message` to the caller.

**The sweep reproduces, with one correction to its framing.** Switching the service role for the
session client would **not** have closed this on its own. The only policy is
`auth.uid() = user_id` (054), and the `project_id` foreign key (055) is checked by Postgres as
the table owner, not through RLS. A session-client insert with someone else's `project_id`
succeeds. The ownership check is what closes it.

### Exploit (before)

Any authenticated user could do this. No role switch was needed, so a vendor could too.

1. A vendor learns an agency's project id. Vendors see project ids for the projects they are
   invited to, through `partner_rfp_inbox` / `project_assignments` rows they can read.
2. `POST /api/brief/save` with
   `{"brief_text":"x","brief_title":"x","analyses_requested":[],"project_id":"<agency project id>"}`
   and the vendor's own cookie or `Authorization: Bearer <access_token>`.
3. The service role inserts a `brief_interpretations` row, owned by the vendor, linked to the
   other tenant's project.

**Impact, measured against the readers in the code today:**

- **Integrity.** Rows the tenant does not own get attached to its project. Today every reader
  also filters on `user_id`: `app/agency/page.tsx:307-310`, `app/agency/brief/page.tsx:321`,
  `app/api/agency/projects/duplicate/route.ts:122-128`. So the victim does not see the planted
  rows yet. Any future "briefs for this project" read without a `user_id` filter would show them.
- **Existence oracle.** For a project id that does not exist, the response is a 500 with
  Postgres's foreign key text. For one that does exist, it is a 200. Ids are uuids, so this
  confirms ids leaked some other way. It does not help guess new ones.
- **Unneeded service role** on a route that had no reason to bypass RLS.

### After

- Auth resolves the caller's own client: the cookie session client, or for the Bearer path
  (which `app/agency/brief/page.tsx:493-497` uses), an **anon-key** client carrying the caller's
  token. Both act as the caller under RLS. **The route no longer uses the service role.**
- If `project_id` is present: `resolveCallerOrgIds(userId, supabase)`, then
  `projects.select("id, org_id").eq("id", project_id)` on the caller's client, then
  `callerOwnsOrg(callerOrgIds, project.org_id)`. Readability alone is not enough, because a
  vendor can read projects it is assigned to. If the project is unreadable, missing or owned by
  another org, or if `project_id` is not a string or not a uuid, the route returns the same
  `404 {"error":"Not found"}`.
- The insert uses the caller's client, so RLS (`auth.uid() = user_id`) also decides.
- A failed insert returns a generic `"Could not save analysis session"`. The database text is no
  longer returned, which closes the oracle.

The client-facing contract is unchanged: same request body, and `{ id }` on success.

---

## Fix 2: `library-documents/file` private blob read

### Before: what the code actually did

**Part of the sweep did not reproduce, so that part was not "fixed".** The sweep says the route
has "no role check" and implies it "streams any private blob whose URL the caller knows" as
input. In the code (`app/api/agency/library-documents/file/route.ts`, pre-fix):

- :14-18 already **required an authenticated session** (401 otherwise).
- :11 and :23-28 already **looked the document up by record id only** (`?id=`), on the session
  client, `.in("org_id", callerOrgIds)`. The route never took a URL or path from the caller.
- It has no role check. That is correct under this brief's rule: role columns are
  vendor-writable, so a role check here would be decoration. **I did not add one.** Entitlement
  is membership of the row's org.

**The hole is real, one step removed.** :36-41 streamed `row.blob_url` with the app's Blob token,
after checking only that the hostname was `vercel-storage.com` (`lib/vercel-blob-url.ts:3-9`).
`blob_url` is caller-written: `library-documents` POST (`route.ts:74`, `:114`) and PATCH
(`[id]/route.ts:24`) store whatever the body sends. So the caller supplies the URL through a
row it owns, then reads that row.

### Exploit (before)

By another agency (direct), or by a vendor that self-sets `active_role = 'agency'`, which is
door 1 or 2 in the sweep and is needed because POST/PATCH use `requireAgencyRole`:

1. Obtain a private blob URL from another tenant. Examples: a bid attachment URL
   (`partner-rfp-bids/...`) that a vendor or lead agency has seen, an NDA or onboarding document
   URL shown to a counterparty, or any URL from a log, email or shared link.
2. `POST /api/agency/library-documents` with
   `{"section":"agency","kind":"<valid kind>","label":"x","source_type":"file","blob_url":"<victim URL>"}`.
   The row lands in the attacker's own org. Or `PATCH /api/agency/library-documents/<own id>`
   with `{"blob_url":"<victim URL>"}`.
3. `GET /api/agency/library-documents/file?id=<that row id>`. The server fetches the victim's
   **private** blob with the platform token and streams it back.

This bypassed every path check in `blob-download` (`app/api/agency/blob-download/route.ts:69-115`).

### After

- **Raw URL/path input is rejected outright.** A request carrying `url`, `path`, `blob_url` or
  `pathname` returns 400. Only `id` is accepted.
- Session required (unchanged). The record is read by id on the session client, scoped to
  `callerOrgIds` (unchanged), with `callerOwnsOrg(callerOrgIds, row.org_id)` re-checked on the
  returned row.
- **The blob must be that record's own.** The stored URL must parse as
  `agency-library/{uploaderUserId}/...`, the only shape `/api/upload` writes for the library
  (`app/api/upload/route.ts:114`, folder `agency-library`, used by
  `components/agency-document-library-manager.tsx:163` and
  `components/client-documents-panel.tsx:132`). The uploader must also be a member of
  **`row.org_id`**: an `org_members` read on the **session** client, so RLS decides it ("Members
  read their organization roster", 086, applied). Anything else returns 404. That covers bid
  attachments, project docs, guest uploads, other folders, and another org's library uploads.
- `external_url` rows still redirect, unchanged. They hold no private blob.

### Residual, not fixed here (outside the files this brief allowed)

1. **POST/PATCH still store any `blob_url`.** The read side now refuses foreign blobs, but the
   write side should refuse them too (same prefix + membership check, or derive `blob_url`
   server-side from the upload). Files: `app/api/agency/library-documents/route.ts:74,:114`,
   `[id]/route.ts:24`.
2. **Users in two orgs.** Blob paths carry the uploader's user id, not an org id. If user U
   belongs to org A and org B, a colleague in A could reference U's B-library upload. The fix
   is an org-scoped upload path (`agency-library/{orgId}/...`) in `/api/upload`.
3. **Legacy rows.** Any existing row whose `blob_url` is not under `agency-library/{member}/`
   now 404s. The folder was introduced in the same commit as the table (`7038a9d`), so none are
   expected. **Not verified against data.** Owner check (SELECT only):
   ```sql
   SELECT d.id, d.org_id, d.blob_url
   FROM agency_library_documents d
   WHERE d.source_type = 'file'
     AND (d.blob_url !~ '^https://[^/]+/agency-library/[^/]+/'
          OR NOT EXISTS (SELECT 1 FROM org_members m
                         WHERE m.org_id = d.org_id
                           AND m.user_id::text = split_part(regexp_replace(d.blob_url, '^https://[^/]+/', ''), '/', 2)));
   ```
   Rows returned are rows that now 404. If an uploader left the org, their uploads also 404.
   That fails closed and is the intended direction.

---

## Service role with a caller-supplied id: the defect class

These are every route file that creates a service-role client (26 files), plus the lib helpers.
Each is classified by whether a **caller-supplied** id or key reaches a service-role query, and
whether anything bounds it. Line numbers are on this branch.

### A. Service role, caller-supplied key, bounded only by possession of a secret token (by design, but this is the class)

| Route | Caller input | Service-role reads / writes |
|---|---|---|
| `app/api/rfp/guest/[token]/route.ts` GET :189 | path `token` | reads the whole `rfp_magic_tokens` row :199-201 (sweep leak 4: returned to the guest); `update status='expired'` :215; reads `profiles` by `tokenRow.org_id` :218-220, `projects` :235-237, `partner_rfp_responses` by `tokenRow.response_id` :277 |
| `app/api/rfp/guest/[token]/route.ts` POST :377 | body `token` :386 | reads token :392-394; **writes** `partner_rfp_responses` update :505 / insert :620, `rfp_magic_tokens` :515, :631, :660, :692, `partnerships` insert/update :49-140 (helper) |
| `app/api/rfp/guest/[token]/attach-existing-account/route.ts` POST :26 | path `token` | reads token :48-51; requires session email = `vendor_email` (:60-63); **writes** inbox/responses/partnerships via `attachMagicTokenToPartnerInbox(service, ...)` :76 |
| `app/api/rfp/guest/file/route.ts` GET :13 | `token`, `url` | reads token :48-51; streams blob only if the URL path is `rfp-guest-uploads/{same token}/` (:35-38) |
| `app/api/rfp/guest/upload/route.ts` POST :56 | form `token` :70 | reads token :79-82; writes a blob under that token |

### B. Service role, caller-supplied id, scoped to the caller's org in the same query (bounded)

| Route | Caller input | Bound |
|---|---|---|
| `app/api/agency/rfp/magic-link/route.ts` POST :71 | body `project_id` :97 | `projects` read `.in("org_id", callerOrgIds)` :163-168; token lookup/upsert scoped by `callerOrgIds` / `writeOrgId` :189-195, :311-323. **But:** `profiles` by body email :177-181 (oracle, sweep) |
| same, GET :524 | `project_id`, `check_email` :548-549 | tokens `.in("org_id", callerOrgIds)` :555-560, :577-581. **But:** `profiles` by `check_email` :553 (oracle, sweep) |
| `app/api/agency/email-scan/import/route.ts` POST :157 | body contacts (emails) | `partnerships` writes scoped `lead_org_id = agencyOrgId` :79-94, :129, :135. **But:** `profiles.ilike("email", email)` :62, a wildcard oracle (sweep) |
| `lib/server/partner-pool-import.ts` (via `pool/add-partner`, `pool/import-spreadsheet`) | body emails | pool reads/writes scoped to `agencyOrgId` :210-213, :310, :358, :377. **But:** `profiles.in("email", ...)` :243 (oracle, sweep) |

### C. Caller-supplied id checked on the session client first; service role used after, on row-derived values (bounded)

| Route | Detail |
|---|---|
| `app/api/agency/rfp-responses/[id]/route.ts` PATCH :173 | path `id` checked `.in("lead_org_id", callerOrgIds)` :205-210; service only for `profiles` by vendor email + `org_members` :610-626 |
| `app/api/partner/rfps/[id]/response/route.ts` POST :126 | path `inboxId` read on session :160-162; service writes the AI summary for the session-saved `saved.id` :426-434 |

### D. Service role, caller-supplied target id, gated by admin or a signed secret

| Route | Caller input | Writes |
|---|---|---|
| `app/api/admin/grant-access/route.ts` :94, :120 | `user_id` + signed `token` :79-80, :132-133 | `organizations.is_paid = true` :192-194 |
| `app/api/admin/grant-agency-access/route.ts` POST :77 | body `userId` (is_admin gate) | `profiles.secondary_role` :103-105 |
| `app/api/admin/users/[userId]/flags/route.ts` PATCH :194 | path `userId` (is_admin gate) | `organizations.is_paid` :158-160, `profiles` flags :310-312 |
| `app/api/admin/notify-new-user/route.ts` POST :65 | body `record.id`, `x-webhook-secret` :68 | reads `profiles` :113 |

### E. Service role, no caller-supplied id (session user id, provider string, or none)

`admin/users` GET (is_admin), `agency/email-connections` (:42-44, :113-116, keyed on session
`userId` + `provider`), `agency/email-scan` and `email-scan/run` (session `userId` + provider,
plus `profiles.in("email", <mailbox contacts>)` at run :60, an oracle), the Google and Microsoft
OAuth callbacks (state nonce cookie), `contact` (insert only), `partner/partnerships/claim`,
`partner/projects`, `partner/rfps`, `partner/rfps/bids`.
**Unauthenticated email oracle:** `app/api/auth/check-email/route.ts:22`. It takes an email, not
an id, and needs no session.

### Lib helpers

- `lib/notifications.ts:89-133` `resolveOrgMemberUserIds(orgId)`: service-role `org_members`
  read. Every caller found passes a row-derived org id (`inbox.lead_org_id`,
  `existing.vendor_org_id`, `tokenRow.org_id`, `project.org_id`), never a body value. Its
  comment says org_members is "self-row-only". That is stale since 086, but harmless.
- `lib/server/account-existence.ts:34-35` `hasLigamentAccount(email)`: service-role `profiles`
  by email (oracle). Callers: `org/invitations`, `agency/pool/resend-invitation`.
- `lib/entitlements.ts`, `lib/feature-flags.ts`: mention the key in comments; no service-role
  query found with a caller-supplied id.

**Fixed in this branch:** `brief/save` (class A without even a token: auth only). **No other
route** combines the service role with an unchecked caller-supplied **row id**. What remains in
the class is the token-bearer guest family (A, by design) and email-keyed profile lookups, which
are existence oracles.

---

## Browser verification (owner)

Accounts: **gmarkant@gmail.com** = m a r k a n t (lead agency).
**gmarkant@icloud.com** = April Partner Test Agency (vendor). Use two browsers or one normal
window plus one private window. DevTools console snippets run on `https://www.withligament.com`
(or the preview URL) while signed in.

### Fix 1

1. **Agency, happy path.** As gmarkant@gmail.com, open a project, go to the Brief page, paste
   text, and run Interpret. Expect the analysis to start and the row to appear under recent
   interpretations on `/agency`. Network: `POST /api/brief/save` 200 `{id}`.
2. **Copy a project id** owned by m a r k a n t, from the URL or the `brief/save` request
   payload.
3. **Vendor, cross-tenant attempt.** As gmarkant@icloud.com, in the console:
   ```js
   await fetch("/api/brief/save",{method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({brief_text:"x",brief_title:"x",analyses_requested:[],project_id:"<id from step 2>"})}).then(r=>r.status)
   ```
   Expect **404**. (Before the fix: 200.)
4. **Oracle closed.** The same call with a made-up uuid
   (`00000000-0000-0000-0000-000000000000`) also returns **404 `{"error":"Not found"}`**, not a
   500 with foreign key text.
5. **Vendor, no project.** The same call without `project_id`. Expect 200: a user may save a
   personal interpretation.

### Fix 2

1. **Agency, happy path.** As gmarkant@gmail.com, open Master Documents, upload a file, then
   click it. It downloads. Repeat on a client's Documents panel.
2. **Raw URL rejected.** Open `/api/agency/library-documents/file?id=<that row id>&url=x`.
   Expect **400**.
3. **Foreign blob refused.** Still as the agency, get a blob URL that is *not* an
   agency-library upload, for example a vendor bid attachment URL from a bid's attachment link
   (the `url=` value on `/api/agency/blob-download`, decoded). Then:
   ```js
   const r = await fetch("/api/agency/library-documents",{method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({section:"agency",kind:"<a kind the UI offers>",label:"probe",source_type:"file",blob_url:"<that URL>"})}).then(r=>r.json());
   (await fetch(`/api/agency/library-documents/file?id=${r.document?.id ?? r.id}`)).status
   ```
   Expect **404**. (Before the fix: 200 and the file streamed.) Delete the "probe" row in the UI
   afterwards.
4. **Other tenant's library.** As gmarkant@icloud.com, call
   `/api/agency/library-documents/file?id=<the m a r k a n t row id from step 1>`. Expect
   **404** (the row is not in the vendor's org; unchanged behaviour, now asserted twice).

If step 1 of either fix fails, that is a regression. Check the Vercel function logs for
`[api/brief/save]` or `[agency/library-documents/file]`.
