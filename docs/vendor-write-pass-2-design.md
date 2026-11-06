# Vendor write pass 2: design for migration 122

Branch `docs/vendor-write-pass-2`, from `main` at `49da414`. Authored 2026-11-06, unattended. **Design only.**
No migration, test or code was written, nothing was run against a database, and nothing was pushed or
merged. This file is the only change on the branch.

**Premise from the brief:** migrations 071 to 121 are applied, and there are 161 public policies. The repository
does not record that yet: `LIGAMENT_CONTEXT.md` (migrations table, row 121) still reads "authored 2026-11-06,
NOT applied". I took the brief's word for it. Migration 123 is taken by the actuals feeder, so the numbers
this design can use are **122** and then **124** or later.

**How this was read.** Everything below comes from reading files: migrations on disk, `scripts/`,
`docs/schema-snapshot-2026-08-13.md` and `docs/schema-baseline-2026-08-13.sql` (policies from before 079 that
were never dropped), and the code in `app/`, `lib/` and `components/`. The live catalog was not read. Each
table's "step 0" list (section 12) names what has to be confirmed live before 122 is authored.

---

## 1. Summary

121's step 0 (e) inventory is right about which policies exist, and every line it cites checks out. It
**understates** what four of them allow, and it **missed** six more write paths a vendor can use.

The most serious findings:

1. **`project_assignments` (high).** A vendor can set its own assignment's `project_id` to *any* project in any
   organization. The vendor UPDATE policy pins only `partnership_id` (079:1585-1592), and a foreign key check
   ignores row level security. Vendor read access to a project, its shared documents, its private files and
   its message and document inserts is all keyed on that row (079:1657-1663, 079:1607-1621, 083:213-310,
   `app/api/partner/blob-download/route.ts:59-68`). So one PATCH gives a vendor read and post access inside
   another agency's project, and that agency cannot see the assignment row that grants it (its policy keys on
   the partnership's lead organization, 079:1570-1577). The vendor learns project ids from its own inbox rows
   (`app/api/partner/projects/route.ts:145-147`).
2. **`project_documents` file columns (high, not named in the brief).** `blob_path` and `blob_url` are taken
   from the row and passed, with the app's storage token, to `get()` (`app/api/documents/[id]/route.ts:78`)
   and `del()` (`app/api/documents/delete/route.ts:31`). Neither is checked against the project. Because the
   INSERT policy (083:213) and the self-row UPDATE policy do not constrain them, a vendor can make the server
   read any private file whose path it knows, or delete any file whose address it can see. That includes the
   agency's own uploads on a shared project.
3. **`org_members` (high, not in 121's list).** "Org admins add members" (079:1740-1742) lets the owner of any
   organization insert *any* user id, with any role, into that organization. Every founder is an owner. No
   code uses this policy: `accept_org_invitation` is SECURITY DEFINER (089:634-644) and
   `lib/acting-org.ts:87` records "NOTHING ELSE WRITES org_members".
4. **`onboarding_packages`, `assignment_agreements`, `partner_status_updates`, `partner_rfp_response_versions`
   (high).** Each lets a vendor move a row into another agency's view, or change a contract or price fact the
   agency sees (sections 4 to 7).

The remaining tables are medium or lower in practice. Several of them are high in shape but dead in the code
(sections 8 to 11).

**Recommendation:** split the work. **122** closes the cross-organization and contract highs on seven tables
plus `org_members`. **124** (or later) covers the rest. See section 14.

---

## 2. Conventions used in every section

- **Vendor session.** This is 118's definition (118:767, 118:792-796), reused by 121 (121:342-350). The caller is
  *not* on the **trusted path** (`auth.uid() IS NULL AND current_user NOT IN ('anon', 'authenticated')`, which
  means the service role, migrations and the SQL Editor). It is also *not* a member of the row's lead
  organization both before and after the write (`public.current_user_org_ids()`). A member of both sides
  counts as the agency.
- **Tables with no `lead_org_id`.** The lead organization is derived with a join that runs under the caller's
  row level security: `projects.org_id` through `project_id`, or `partnerships.lead_org_id` through
  `partnership_id`. If the lookup returns nothing, the caller is treated as a vendor (fail closed). This is
  ruling 3.
- **Guard shape (118 and 121).** One function per table, BEFORE INSERT OR UPDATE FOR EACH ROW, SECURITY
  INVOKER, `SET search_path = public, pg_temp`, EXECUTE revoked from PUBLIC, anon and authenticated.
  - **Deny by default.** On UPDATE, `to_jsonb(OLD)` and `to_jsonb(NEW)` minus the allow-list must be equal.
    On INSERT, every column outside the allow-list and the link columns must be NULL or its default. Anything
    else raises 42501 and names the first offending column, alphabetically.
  - A column added to the table later is refused for vendors automatically.
- **Writer codes.**
  - **VS:** vendor session.
  - **AS:** agency session.
  - **SR:** service role (the guest route and similar).
  - **TP:** another trusted path (SQL function, trigger, migration).
- **Severity, as the brief defines it.**
  - **High:** crosses an organization boundary, or alters a contract or payment fact.
  - **Medium:** alters the vendor's own records misleadingly.
  - **Low:** cosmetic.

  Where a high needs the attacker to know a UUID (universally unique identifier) it cannot normally read, it
  is marked **high (latent)**.
- **Grants, for every table here.** No migration grants on these tables by name. 114:193-195 revoked
  TRUNCATE, REFERENCES and TRIGGER from anon and authenticated everywhere. The Supabase default SELECT,
  INSERT, UPDATE and DELETE grants remain (`docs/grant-posture-findings.md:28`), so row level security is
  the only gate. I won't repeat this under each table.
- **Raw access.** "A malicious vendor" means a logged-in vendor user calling PostgREST (the REST API Supabase
  generates over Postgres) directly with its own JWT (JSON Web Token). No app route is involved.

---

## 3. project_assignments

### 3.1 Live policies, triggers, grants

| Policy | Cmd | Source | USING | WITH CHECK |
|---|---|---|---|---|
| `assignments_agency_all` | ALL | 079:1570-1577 | `partnership_id` in partnerships whose `lead_org_id` is mine | same |
| `assignments_partner_select` | SELECT | 079:1579-1583 | `partnership_id` in partnerships whose `vendor_org_id` is mine | n/a |
| `assignments_partner_update` | UPDATE | 079:1585-1592 | same, vendor side | same, vendor side: pins `partnership_id` only |

- 079:599-601 dropped the three snapshot policies (`docs/schema-snapshot-2026-08-13.md:213-225`).
- No migration from 080 to 121 changes them.
- There is no vendor INSERT or DELETE policy.
- **Triggers:** none on disk.
- **Neither policy ties `project_id` to the partnership's lead organization.**

### 3.2 Columns and writers

The columns are taken from `scripts/010-closed-ecosystem-schema.sql:71-94` and `scripts/027` (`awarded_at`).
The live column list is unconfirmed (`scripts/sql/sweep-confirm.sql:255-258`, check V12, never read).

| Column | Class | Writers |
|---|---|---|
| id, created_at | fixed once | default |
| project_id, partnership_id | link, fixed once | AS insert: `app/api/projects/[id]/assignments/route.ts:173-187` (W1), `app/api/agency/rfp-responses/[id]/route.ts:1040-1046` (W4b) |
| status (invited, accepted, declined, awarded, completed) | shared | W1 `invited`. VS `invited` to `accepted` or `declined` (`assignments/route.ts:317-330`, W2). AS awarded, completed, declined (`:403-408`, W3). AS award (`rfp-responses/[id]/route.ts:1034-1037`, W4a) |
| awarded_at, completed_at | agency-owned | W3 (:400), W4 |
| bid_notes | agency-owned in practice (the invite note, `:169-171`) | W1 |
| bid_amount, bid_submitted_at | legacy, unused | none |
| updated_at | shared | W2, W3, W4 |

- Client creation: W1 to W3 use `requireAuth()` with `createClient()` (`lib/api-auth.ts:30-31`; route :115-117,
  :282-284). W4 uses the session client at `rfp-responses/[id]/route.ts:225`.
- W2, the only vendor writer, has **no caller in the user interface**. The only caller of this route in the UI
  is a GET (`components/stage-03-onboarding-production.tsx:58`). W4 is live.

### 3.3 What a malicious vendor can do today

- **PA-1, high: move the row to another organization's project.** The vendor sets `project_id` to a project of
  agency B, using an id it learned from its inbox. Then it can:
  - read B's project row (079:1657-1663), surfaced in `app/api/partner/projects/route.ts:186-196`;
  - read B's `all_partners` documents (079:1610-1614);
  - download any private file under `projects/{B's project}/` (`blob-download/route.ts:59-68` checks only
    that an assignment exists);
  - post messages and documents into B's project (083:236-242, :290-296), which B sees and is emailed about
    (`app/api/projects/[id]/messages/route.ts:258`, :284-314);
  - post status updates into B's project (section 6).

  B cannot see the assignment row, so B has no way to find out why.
- **PA-2, high: carry agency A's agreements away.** `assignment_agreements` follow the row, and the agency's
  policy on them keys on `pa.project_id` (079:1681-1690). After PA-1, A loses its own NDA (non-disclosure
  agreement) and SOW (statement of work) rows with this vendor, and B can read and manage them.
- **PA-3, high: self-award.** The vendor sets `status = 'awarded'` or `'completed'`, including from `declined`.
  This feeds:
  - the agency dashboard's "Awarded" count (`app/api/agency/dashboard/route.ts:249-251`);
  - utilization (`:161-164`);
  - the vendor's delivery list (`partner/projects/route.ts:159-163`);
  - the AI (artificial intelligence) bid score's track record (`app/api/agency/bids/[responseId]/ai-score/route.ts:49-61`).

  A partnership switch (setting `partnership_id` to its partnership with another lead) moves the row between
  agencies.
- **PA-4, medium:** forge or backdate `awarded_at` (timeline, `lib/bid-timeline.ts:7`) and `completed_at`;
  overwrite the agency's `bid_notes`.
- **PA-5, low:** `created_at`, `updated_at`. `updated_at` decides which assignment wins in the status-update
  and messages lookups.

**The agency side has the same gap, and it is reachable by a vendor (sweep finding H2).** Under
`assignments_agency_all` any organization that leads a partnership can insert an assignment on any project.
Nothing stops an organization leading a partnership with itself:
- 087:566-577 accepts `vendor_org_id` = own organization when `partner_email` is the caller's own address
  (`org_has_member_with_email`, 087:498-517);
- no migration on disk compares `lead_org_id` with `vendor_org_id`.

So a vendor-only organization can (1) create a partnership with itself, (2) insert an assignment on another
agency's project, and (3) gain everything PA-1 gives, without needing a real assignment to repoint. It is
**high**. That this works live is unverified: it depends on nothing out of band blocking a partnership with
lead and vendor the same.

### 3.4 Proposed guard: `project_assignments_write_guard()`

A policy WITH CHECK cannot compare OLD with NEW, so this needs a trigger.

- **Trusted path:** untouched.
- **Every non-trusted caller (agency included):**
  - `id`, `project_id`, `partnership_id` and `created_at` are fixed once inserted. No agency writer changes
    them: W3 and W4a write only status, `awarded_at` and `updated_at`.
  - On INSERT, `projects.org_id` of `NEW.project_id` must equal `partnerships.lead_org_id` of
    `NEW.partnership_id`. W1 checks this at `assignments/route.ts:128`, :142, and W4b inserts the bid's own
    project and partnership. This is ruling 5.
- **Agency:** a member of the partnership's lead organization before and after. It passes once the rule above
  holds.
- **Vendor session:**
  - INSERT is refused.
  - UPDATE allow-list is `status` and `updated_at` only.
  - `status` may change only from `invited` to `accepted` or `declined`, mirroring W2's own check
    (`assignments/route.ts:317-320`).
  - Everything else is refused, including `awarded_at`, `completed_at` and the `bid_*` columns.
- **Partnerships (ruling 6):** refuse a partnership whose `lead_org_id = vendor_org_id`. It can be done one of
  two ways: a clause added to 087's INSERT policy check (ALTER POLICY, count unchanged), or a rule in the
  existing partnerships guard (087:665-668, function replaced in 093). Either way it is fail-closed after an
  inventory count.
- **Code change:** none needed for the guard. Optionally, W2 maps 42501 to 403 (ruling 39).

### 3.5 Rulings for this table

Rulings 4 to 8 in section 16.

---

## 4. project_documents and project_messages

### 4.1 Live policies, triggers, grants

**project_documents**

| Policy | Cmd | Source | Predicate |
|---|---|---|---|
| Agencies can view documents for their projects | SELECT | 079:1600-1605 | the project's `org_id` is mine |
| Partners can view documents for their assignments | SELECT | 079:1607-1621 | `all_partners` and the vendor is assigned to `project_id`, OR `assignment` and `pa.id = assignment_id` with the vendor mine. **The second arm matches on `assignment_id` alone.** |
| Users can upload documents to projects they are on | INSERT | 083:213-258 | `uploaded_by = auth.uid()`, the caller is the project's agency or an assigned vendor, and `assignment_id` is NULL or belongs to `project_id` |
| **Uploaders can update their documents** | UPDATE | snapshot :237 (baseline :1134-1139) | USING `uploaded_by = auth.uid()`. No WITH CHECK. |
| Uploaders can delete their documents | DELETE | snapshot :236 (baseline :1085-1090) | `uploaded_by = auth.uid()` |

**project_messages**

| Policy | Cmd | Source | Predicate |
|---|---|---|---|
| Agencies can view messages for their projects | SELECT | 079:1624-1629 | the project's `org_id` is mine |
| Partners can view messages for their assignments | SELECT | 079:1631-1637 | `pa.id = assignment_id`, vendor mine (`assignment_id` alone) |
| Users can send messages on projects they are on | INSERT | 083:265-310 | `sender_id = auth.uid()`, agency or assigned vendor, assignment on the same project |
| **Senders can update their messages** | UPDATE | snapshot :246 (baseline :1183-1188) | USING `sender_id = auth.uid()`. No WITH CHECK. |

- No migration from 079 to 121 drops the self-row policies. 079:1594-1599 says they were left untouched on
  purpose.
- `project_messages` has no DELETE policy.
- **Triggers:** none on disk. **Tables:** no CREATE TABLE is on disk for either, so the columns below come from
  what the code writes.

### 4.2 Columns and writers

- **project_documents** (`app/api/documents/upload/route.ts:101-112`):
  - fixed once: `id`, `created_at`;
  - link, fixed once: `project_id`, `assignment_id`;
  - identity, fixed once: `uploaded_by`;
  - uploader content: `name`, `file_type`, `file_size`, `document_type`;
  - uploader-chosen access: `visibility`;
  - **storage link, must be fixed once and bound to the project:** `blob_url`, `blob_path`. Upload builds the
    path as `projects/{projectId}/...` (:89-91).
- **project_messages** (`app/api/projects/[id]/messages/route.ts:265-272`):
  - fixed once: `id`, `created_at`;
  - link: `project_id`, `assignment_id`, `parent_id`;
  - identity: `sender_id`;
  - sender content: `content`, `message_type`.
- **Writers.** All of these use a session client (`requireAuth`, or `createClient` at messages :24 and :165),
  as an agency or a vendor:
  - document INSERT, upload :99-114;
  - document DELETE, delete :34-37, after `del(blob_url)` at :31;
  - message INSERT, messages :263-279.
- **No code updates or upserts either table.** No UI calls these routes (`lib/vendor-empty-copy.ts:117-129`).
  Both tables were reported to have 0 rows (`docs/079-onboarding-docs-regression.md:54`; quoted, not observed).

### 4.3 What a malicious vendor can do today

Postgres checks an UPDATE's new row against the caller's own SELECT policies, so a vendor can move a row only
to a place where it can still see it. The partner SELECT arms match on `assignment_id` alone, and that leaves
room.

- **PD-1, high: plant a document in another agency's project.** The vendor sets `project_id` to agency B's
  project and keeps `assignment_id` on its own assignment (and `visibility = 'assignment'` for documents). B's
  agency SELECT shows the row, and the vendor still sees it too. This undoes 081 and 083's insert scoping.
  Messages work the same way.
- **PD-2, high: make the server read any private file.** The vendor sets `blob_path`, on a new row or by
  update, to any known pathname, then calls `GET /api/documents/{own id}`. The route's access check is on the
  row; `get(document.blob_path)` (:78) reads whatever path the row names. Exposed paths include other
  organizations' `partner-documents/...`, `partner-rfp-bids/...` and `rfp-guest-uploads/...` files. It needs
  the path, which contains a millisecond timestamp.
- **PD-3, high: make the server delete an agency's file.** The vendor sets its own row's `blob_url` to the
  address of an agency file it can SELECT on the same project, then calls `/api/documents/delete`. `del()`
  (:31) removes the agency's file, and the agency's row now points at nothing.
- **PD-4, medium:** rewrite a sent message's `content` (a quoted price or commitment), backdate `created_at`,
  or move a row away so its agency no longer sees it. For messages that amounts to a delete, which the
  missing DELETE policy otherwise forbids.
- **PD-5, medium (latent):** at insert, name *another vendor's* `assignment_id` on the same project (083 checks
  only that the assignment is on the project). The row then shows in that vendor's view.
- **PD-6, low:** `name`, `document_type`, `file_type`.

**The self-row policies also bind agency users.** An agency member can set `assignment_id` to another
organization's assignment while keeping its own `project_id`. The foreign vendor then sees the row. That is a
plant across organizations by an agency user.

### 4.4 Proposed guard

- **Drop both UPDATE policies** (ruling 9). There is no legitimate updater. Policy count 161 becomes 159.
- **`project_documents_write_guard()` and `project_messages_write_guard()`,** BEFORE INSERT OR UPDATE:
  - Trusted path: untouched.
  - The lead organization is `projects.org_id` of `project_id`.
  - On INSERT, for every non-trusted caller:
    - documents: `blob_path` must start with `'projects/' || project_id || '/'`, and `blob_url` must end with
      `'/' || blob_path`;
    - `created_at` must be the default;
    - messages: `parent_id`, if set, must be a message on the same project.
  - On INSERT from a vendor session: `assignment_id` must be one of the caller's own assignments on that
    project (ruling 13). This closes PD-5.
  - On UPDATE: refused for every non-trusted caller. With the policies dropped, row level security already
    refuses it; the guard is defence in depth if a permissive policy is ever added back.
- **Tighten the two partner SELECT arms** (ruling 12) with ALTER POLICY USING, count unchanged. The
  `assignment` arm and the messages arm also require `pa.project_id = <table>.project_id`. Consistent rows
  lose nothing.
- **Code change, required (ruling 10).** `app/api/documents/[id]/route.ts:78` and
  `app/api/documents/delete/route.ts:31` must refuse a row whose `blob_path` does not start with
  `projects/{project_id}/`. The trigger cannot fix rows that already exist, and the routes are where the
  storage token is used.

### 4.5 Rulings

Rulings 9 to 13.

---

## 5. assignment_agreements and onboarding_packages

### 5.1 Live policies, triggers, grants

**assignment_agreements** (`scripts/012-onboarding-nda-sow.sql:17-31`). 079:573-575 dropped the snapshot
policies.

| Policy | Cmd | Source | Predicate |
|---|---|---|---|
| Agencies manage agreements for their project assignments | ALL | 079:1681-1690 | `assignment_id` in assignments whose project's `org_id` is mine (USING and WITH CHECK) |
| Partners read and update own assignment agreements | SELECT | 079:1692-1697 | `assignment_id` in assignments of my vendor partnerships |
| **Partners update agreement signature fields** | UPDATE | 079:1699-1708 | the same, as USING and WITH CHECK: **pins `assignment_id` to any of my assignments, nothing else** |

- Constraints:
  - `agreement_type` must be `nda` or `sow` (012:20);
  - `status` must be one of pending, sent, viewed, signed, declined (012:21);
  - UNIQUE (`assignment_id`, `agreement_type`) (012:28);
  - foreign key from `signed_by` to profiles (012:23).
- Triggers: none.

**onboarding_packages** (`scripts/024-onboarding-documents.sql:32-48`; `agency_id` renamed to `org_id` at
079:656, NOT NULL at 079:980).

| Policy | Cmd | Source | Predicate |
|---|---|---|---|
| Agency full access onboarding packages for own projects | ALL | 079:1279-1288 | USING: `project_id` in my projects. WITH CHECK: the same, and `org_id` is mine |
| Partner reads onboarding packages for their partnership | SELECT | 079:1290-1294 | `partnership_id` in my vendor partnerships |
| **Partner updates review fields on own packages** | UPDATE | 079:1296-1303 | the same, as USING and WITH CHECK: **`project_id` and `org_id` are not tested** |

- Child table `onboarding_package_documents`:
  - agency ALL keys on the package's `project_id` (079:1305-1314);
  - vendor SELECT keys on its `partnership_id`.
- `status` must be `sent` or `reviewed` (024:40).
- Triggers: none.

### 5.2 Columns and writers

**assignment_agreements**

| Column | Class | Writers |
|---|---|---|
| id, created_at | fixed | default |
| assignment_id, agreement_type | link or agency, fixed once | AS upsert `app/api/projects/[id]/onboarding/deploy/route.ts:154-163` (client :22, gate :38) |
| template_label, external_document_url | agency-owned | deploy :159; URL has no writer |
| status | shared | AS deploy (`sent`); VS or AS PATCH `app/api/projects/[id]/agreements/[agreementId]/route.ts:98-103` (client :15; allow-list viewed, signed, declined at :25; no transition rule) |
| signed_at, signed_by | vendor, set once | PATCH :93-96, vendor branch (app clock, `user.id`) |
| updated_at | shared | deploy :160, PATCH :90 |

- There are no amount, fee or agreement-text columns.
- **Both writers are dormant:**
  - the deploy route is called only by `components/stage-03-onboarding-production.tsx:133`, which nothing
    mounts (`LIGAMENT_CONTEXT.md:634`, "Dormant");
  - the PATCH route has no caller.
- The only reader is `app/api/projects/[id]/partner/route.ts:112-116`, which its own comment at :97-100 calls
  dead.

**onboarding_packages**

| Column | Class | Writers |
|---|---|---|
| id, created_at | fixed | default |
| project_id, org_id, partnership_id | link, fixed once | AS insert `app/api/projects/[id]/onboarding-packages/route.ts:360-374` (client :129, gate :146); rollback delete :394 |
| kickoff_type, kickoff_url, kickoff_availability, custom_message | agency-owned | the same insert |
| status | shared (`sent` by the agency, `reviewed` by the vendor) | AS :370; VS `app/api/partner/onboarding-packages/[id]/route.ts:53-62` (client :13, only `mark_reviewed` :28, ownership :48) |
| partner_reviewed_at | vendor, set once | VS :57 |
| updated_at | shared | both |

- Live callers:
  - agency: `components/stage-03-onboarding-workflow.tsx:545`;
  - vendor: `app/partner/onboarding/page.tsx:250`, with the button hidden once reviewed (:602).
- Readers that trust vendor-writable columns:
  - agency feed, `app/api/agency/dashboard/route.ts:262-269`, :754-769 (orders on `partner_reviewed_at`);
  - "latest package" by `created_at`: `app/api/agency/active-engagements/route.ts:356-371` and
    `app/api/partner/projects/[projectId]/active-engagement/route.ts:240-255`, both returning `kickoff_url`;
  - file download authorized by `partnership_id`: `app/api/partner/onboarding/file/route.ts:49-65`.

### 5.3 What a malicious vendor can do today

**assignment_agreements**
- **AG-1, high:** set `assignment_id` to its own assignment on agency B's project. A loses the agreement, and
  B gains read, update and delete rights over it.
- **AG-2, high (contract fact):** set `status = 'signed'` with any `signed_at`; set `signed_by` to any profile,
  including an agency member's; revoke a signature (signed to declined, with the fields cleared).
- **AG-3, high:** rewrite the agency's `external_document_url` (a swapped contract link) and `agreement_type`.
- **AG-4, low:** `id`, `created_at`, `updated_at`.

Practical impact is reduced today because the feature is dormant. The PATCH route is reachable, though, and
through it a vendor can cycle signed, declined and viewed and re-stamp `signed_at`.

**onboarding_packages**
- **OB-1, high:** set `project_id` to agency B's project. B's ALL policy then admits the package, and B's child
  policy exposes **agency A's onboarding document labels and links** (079:1305-1314). B can edit or delete
  them, and A loses the package.
- **OB-2, high with OB-1:** repoint `partnership_id` to its partnership with another lead.
- **OB-3, medium:**
  - repoint `org_id`, which changes the lead name the vendor sees and breaks A's next update;
  - un-review, or set `partner_reviewed_at` far in the future, pinning a fake "acknowledged onboarding" line
    to the top of A's feed;
  - rewrite `kickoff_url` (A shows it as its own link, `active-engagements/route.ts:479`) or `custom_message`;
  - rewrite `created_at` to choose which package is "latest".

### 5.4 Proposed guards

**`assignment_agreements_vendor_write_guard()`.** The lead organization is `projects.org_id` through
`project_assignments`, for OLD and NEW.
- Vendor INSERT: refused (row level security already refuses it).
- Vendor UPDATE allow-list: `status`, `signed_at`, `signed_by`, `updated_at`.
- Transition: `OLD.status` must be `sent` or `viewed`, and `NEW.status` must be `viewed`, `signed` or
  `declined`. Signed and declined are final for the vendor (ruling 15).
- On the move to `signed`, the guard **stamps** `signed_at := now()` and `signed_by := auth.uid()`. Stamping
  rather than comparing means the route's app-clock value does no harm. Otherwise the two fields are frozen.
- Ruling 16 adds an agency-side rule, and ruling 17 a re-deploy rule.

**`onboarding_packages_vendor_write_guard()`.** The lead organization is `org_id` for OLD and NEW, as in
121:347-350.
- Vendor INSERT: refused.
- Vendor UPDATE allow-list: `status`, `partner_reviewed_at`, `updated_at`.
- The only transition is `sent` to `reviewed`, with `partner_reviewed_at := now()` stamped. A row already
  reviewed refuses every vendor change.
- For every non-trusted caller, agency included (ruling 19): `project_id`, `partnership_id`, `org_id` and
  `created_at` are fixed once, and on INSERT `org_id` must equal `projects.org_id`.

**Code changes:**
- `app/api/partner/onboarding-packages/[id]/route.ts`: read `status` at :34 and return 200 unchanged when it is
  already `reviewed`; map 42501 to 409.
- `agreements/[agreementId]/route.ts`: map 42501 to 409 rather than the 500 at :105. It can keep sending
  `signed_at` and `signed_by`; the guard overwrites them.

### 5.5 Rulings

Rulings 14 to 19.

---

## 6. partner_status_updates

### 6.1 Live policies, triggers, grants

079:587-591 dropped the five snapshot policies (`docs/schema-snapshot-2026-08-13.md:156-170`).

| Policy | Cmd | Source | Predicate |
|---|---|---|---|
| Agencies can view status updates for their projects | SELECT | 079:1419-1423 | `project_id` in my projects |
| Agencies can resolve status updates | UPDATE | 079:1425-1429 | the same. No WITH CHECK. |
| **Partners can insert their own status updates** | INSERT | 079:1431-1435 | `partnership_id` in my vendor partnerships. **Nothing ties `project_id` or `project_assignment_id`.** |
| Partners can view their own status updates | SELECT | 079:1437-1441 | the same, vendor side |
| **Partners can update their own status updates** | UPDATE | 079:1443-1447 | the same. No WITH CHECK, so only `partnership_id` is kept. |

- There is no DELETE policy.
- **There is no agency INSERT policy.**
- Triggers: none on disk.
- The columns come from `scripts/028-partner-status-updates.sql:2-14`. Live columns are unconfirmed.

### 6.2 Columns and writers

| Column | Class |
|---|---|
| id | link, set once |
| project_assignment_id, project_id, partnership_id | link, set once |
| status, budget_status, completion_pct, notes | vendor content |
| is_resolved | agency-owned |
| created_at | set once |
| updated_at | shared |

Writers:
- **VS:** `app/api/partner/projects/[projectId]/status-update/route.ts:209-223` (client :113). It sends the
  three links, content, `is_resolved: false` and `updated_at`, but not `created_at`.
- **AS resolve:** `app/api/agency/projects/[projectId]/status-updates/route.ts:175-181` (client :127).
- **AS override POST** (:334-349) **and the browser override** (`app/agency/project/page.tsx:222-233`). Both are
  **refused today.** There is no agency INSERT policy. They would also break 028's checks: `budget_status:
  "on_track"` at :341, and a NULL `project_assignment_id` at :339.

Readers that trust the rows:
- agency dashboard alerts, `app/api/agency/dashboard/route.ts:253-259`, :620-624;
- `app/api/projects/route.ts:216-242`;
- `app/api/agency/active-engagements/route.ts:207-232`;
- utilization, `app/api/agency/utilization/route.ts:232-249` (latest `completion_pct` per assignment, newest
  `created_at` wins);
- the "Agency set" badge on a `[Agency override]` prefix in `notes` (`app/agency/project/page.tsx:389-410`).

### 6.3 What a malicious vendor can do today

- **SU-1, high:** insert with its own partnership and `project_id` set to agency B's project (and any existing
  `project_assignment_id`). B's SELECT shows it in alert counts, note previews and its status list. With a
  future `created_at` and one of B's assignment ids, it also overrides that scope's completion figure in B's
  utilization view.
- **SU-2, high:** the same through its real partnership with B, on a project it is not assigned to, or after
  being removed (`partnerships.status` is not checked).
- **SU-3, high:** update an existing row's `project_id` or `project_assignment_id` to move it into B's view.
- **SU-4, medium:**
  - rewrite past `status`, `budget_status`, `completion_pct` and `notes`;
  - flip `is_resolved` either way, which reopens rows the agency resolved; the next resolve re-sends the
    email;
  - start `notes` with `[Agency override]`, so the agency UI shows "Agency set". This also works through the
    real route.
- **SU-5, low:** `created_at` reorders "latest".

### 6.4 Proposed guard: `partner_status_updates_vendor_write_guard()`

The lead organization is `projects.org_id` of `project_id`.

- **Vendor INSERT:**
  - Allowed: `status`, `budget_status`, `completion_pct`, `notes`, `updated_at`, plus the link columns.
  - `is_resolved` must be false, and `created_at` must be the default.
  - The links must form one chain:
    - `project_assignment_id` names an assignment with the same `project_id` and `partnership_id`;
    - that partnership's `vendor_org_id` is mine;
    - its `lead_org_id` equals `projects.org_id`.
  - Optional tests:
    - the assignment is `awarded` (ruling 20);
    - the partnership is not `removed` (ruling 21);
    - `notes` does not start with `[Agency override]` (ruling 23).
- **Vendor UPDATE:** refused for every column (ruling 22). There is no legitimate vendor updater. The policy
  stays, as 121 did, so the policy count is unchanged and the refusal is a loud 42501 rather than a silent
  zero rows.
- **Code changes:**
  - status-update route: map 42501 to 403 rather than a 500 (:225-228);
  - strip the `[Agency override]` prefix in `parseBody` (:46-51);
  - if ruling 20 is awarded-only, the route's no-id branch (:176-183) must pick an awarded assignment.

### 6.5 Rulings

Rulings 20 to 24.

---

## 7. partner_rfp_response_versions

### 7.1 Live policies, triggers, grants

The table is created at `scripts/021-bid-response-versions.sql:3-16`, with `change_notes` added at
`scripts/022:3`. 079:548-550 dropped the snapshot policies and renamed the columns (079:668-669). No later
migration names the table.

| Policy | Cmd | Source | Predicate |
|---|---|---|---|
| Agencies read owned response versions | SELECT | 079:1367-1369 | `lead_org_id` is mine |
| **Partners insert own response versions** | INSERT | 079:1371-1373 | `vendor_org_id` is mine. **`response_id`, `lead_org_id`, the number, the timestamps and the content are free.** |
| Partners read own response versions | SELECT | 079:1375-1377 | `vendor_org_id` is mine |

- There is no UPDATE or DELETE policy, so versions are effectively immutable for sessions.
- Constraints: `version_number > 0` (021:8); UNIQUE (`response_id`, `version_number`) (021:18-19); foreign
  key from `response_id` with ON DELETE CASCADE (021:5).
- Triggers: none.
- On disk `vendor_org_id` is still NOT NULL from 021:6, although 079:959-962 says it was left nullable. Live
  nullability is unverified.

### 7.2 Columns and writers

| Column | Class |
|---|---|
| id, response_id, vendor_org_id, lead_org_id | link, fixed once |
| version_number | system: should be the previous maximum plus one |
| proposal_text, budget_proposal, timeline_proposal, attachments | snapshot of the parent bid as submitted |
| status_at_submission | system: always `submitted` |
| submitted_at, created_at | fixed once, default `now()` |
| change_notes | vendor content |

- **One writer, VS:** `app/api/partner/rfps/[id]/response/route.ts:425-433`, on the session client (:134). It
  writes only on a submit (:401), after the parent is saved and after final bids are refused (:346-350). It
  computes the version number itself (:411-418), copies the content it just wrote, and sends no timestamps. A
  failure is only logged (:434-444).
- The guest route writes no versions (`lib/bid-shared.ts:171`).
- **The reader that matters:** `app/api/agency/rfp-responses/route.ts:415-421` loads versions for the agency's
  own bids, without checking that a version's `vendor_org_id` matches the bid.
  - `bestBudgetDisplay` and `bestBudgetAmount` (`lib/bid-shared.ts:165-186`) prefer `versions[0]` over the
    bid's own `budget_proposal`.
  - That figure renders in `app/agency/bids/page.tsx:132`, `components/bid-detail-sheet.tsx:121` and
    `components/bid-compare-view.tsx:145`, :486, :490.

### 7.3 What a malicious vendor can do today

- **RV-1, high (latent):** insert a version naming a **competitor's** `response_id` and that agency's
  `lead_org_id`, with a high version number and any budget. The agency's bids page, compare view and detail
  sheet then show the attacker's budget on the competitor's bid. Taking the competitor's next number also
  makes the competitor's real version insert fail on the unique index (logged only). It needs the
  competitor's response id, which a vendor cannot read through any path found.
- **RV-2, high (price fact):** insert a high-numbered version on **its own** bid with a budget unlike the bid
  row. The agency's lists show the forged figure. This works on awarded and declined bids too, which gets
  round 121's final-bid freeze for the price the agency sees.
- **RV-3, medium:** backdate `submitted_at` (to look on time), forge `status_at_submission`, or add versions to
  a bid never submitted.
- **RV-4, low:** a version on its own bid naming an unrelated agency (the agency's app filters it out).

### 7.4 Proposed guard

Two parts. The policy part also binds agency members, which a trigger exempting lead members would not.

- **ALTER POLICY "Partners insert own response versions" WITH CHECK** (count unchanged). It keeps
  `vendor_org_id` mine, and adds: there exists a `partner_rfp_responses` row with this `response_id`, the
  same `vendor_org_id` and the same `lead_org_id`. The subquery runs under the caller's row level security,
  so a vendor sees only its own bids. A guest bid (no vendor) never qualifies, which is correct because there
  is no guest writer.
- **`partner_rfp_response_versions_write_guard()`,** BEFORE INSERT OR UPDATE:
  - UPDATE: refused for every non-trusted caller.
  - INSERT, for a non-trusted caller:
    - lock the parent row (`FOR UPDATE`, which the vendor's UPDATE policy allows), which serialises
      concurrent submits;
    - the parent's status must be `submitted`, `shortlisted` or `meeting_requested`, the states a submit can
      leave under 121's ruling S1 (ruling 27);
    - `status_at_submission` must be `submitted`;
    - the guard assigns `version_number` as the maximum plus one (ruling 26);
    - `submitted_at` and `created_at` must be the default;
    - the guard **copies** `proposal_text`, `budget_proposal`, `timeline_proposal` and `attachments` from the
      parent (ruling 25);
    - deny by default for anything else.
- **Code change:** read back the stored number (`.select("version_number").single()` at route :425) and drive
  the milestone type (:581) from it. Recommended: the agency reader also filters versions to
  `vendor_org_id = the bid's vendor_org_id` (ruling 28). That neutralises any forged rows that already exist.

### 7.5 Rulings

Rulings 25 to 28.

---

## 8. milestone_events

### 8.1 Live policies, triggers, grants

| Policy | Cmd | Source | Predicate |
|---|---|---|---|
| Members read own company milestone events | SELECT | 080:337-341 | `org_id` is mine |
| Counterparty reads whitelisted milestone events | SELECT | 080:350-362 | a vendor-visible type, and the partnership's vendor is mine |
| **Members insert own company milestone events** | INSERT | 080:373-381 | `actor_side = 'agency'`, `org_id` mine, `actor_id` NULL or me. **`partnership_id` and `vendor_org_id` are not tied to `org_id`.** Not in 121's list. |
| **Vendors insert own company milestone events** | INSERT | 100:404-525 (replaces 088:435-460) | `actor_side = 'vendor'`, `actor_id = auth.uid()`, `actor_email` NULL, `vendor_org_id` mine, a type from `vendor_emittable_event_types()` (088:399-414, seven types). Then either (A) a partnership matching both organizations, or (B) no partnership with the subject pinned to an inbox row (100:501-508) or a bid (100:512-520) |

- There is no UPDATE or DELETE policy (080:383).
- Triggers: none.

### 8.2 Columns and writers

- **Pinned by the vendor policy:** `org_id`, `vendor_org_id`, `partnership_id`, `actor_id`, `actor_email`,
  `actor_side`, `event_type`.
- **Free in branch A:** `subject_type` and `subject_id`.
- **Free always:** `payload` and `created_at`.
- **Writers.** All go through `lib/milestone-events.ts:328`, which never sends `id` or `created_at`
  (:252-268). Vendor-session callers:
  - `status_update.post`: status-update route :307-320;
  - `rfp.view`: `app/api/partner/rfps/[id]/route.ts:163-177`;
  - `nda.acknowledge`: `.../nda-notify/route.ts:168-180`. Its inbox may be owned by email, with a NULL vendor
    organization, :52-56;
  - `bid.submit` and `bid.revise`: `.../response/route.ts:604-623`.
- The guest `bid.submit` uses the service role (`app/api/rfp/guest/[token]/route.ts:1015-1027`).
- **The only reader** is the agency dashboard (`app/api/agency/dashboard/route.ts:199-206`: newest 200 by
  `created_at`). It reads one payload key, `scope_item_name` (`lib/activity-feed.ts:326-329`).

### 8.3 What a malicious vendor can do today

- **ME-1, high (latent):** a branch A `bid.submit` or `rfp.view` whose subject is a **competitor's** bid or
  inbox row. The feed's dedupe (`lib/activity-feed.ts:523-548`, :574-589) then shows the attacker as that
  bidder or viewer. It needs ids the vendor cannot read.
- **ME-2, medium:** 200 rows with a far-future `created_at` fill the feed window. Every real event, the
  agency's own team's included, drops out, and "last activity" shows the future date.
- **ME-3, medium:** `subject_type 'project'` naming any project of that lead, for example "posted a status
  update on (a project it is not on)".
- **ME-4, low:** arbitrary `scope_item_name` text (escaped by React) or a payload of any size; fake
  `invitation.*` lines (no emitter exists).
- **ME-5, medium, agency policy:** a member of any organization can insert an "agency-side" event on any
  partnership id. That partnership's vendor reads it through 080:350-362.

### 8.4 Proposed guard: `milestone_events_vendor_write_guard()`

BEFORE INSERT. It acts on a caller who is neither trusted nor a member of `NEW.org_id`.

- `created_at` must be the default.
- **The subject is pinned per type:**
  - `status_update.post`: a project with an assignment on that partnership, and `projects.org_id = org_id`;
  - `rfp.view` and `nda.acknowledge`: an inbox row with `lead_org_id = org_id` that is the caller's, by
    `vendor_org_id` or by `recipient_email` (the shape of 079:1389-1403). The email arm keeps the email-owned
    `nda.acknowledge` working;
  - `bid.submit` and `bid.revise`: a bid with `lead_org_id = org_id` and `vendor_org_id = vendor_org_id`;
  - `invitation.*`: refused (ruling 31).
- **Payload:**
  - `status_update.post` keeps only `completion_pct` (0 to 100) and `status`;
  - for every other type the guard overwrites `scope_item_name` from the subject row (ruling 30) and drops
    other keys.
- **Agency INSERT policy (ruling 32):** ALTER the 080:373-381 check so that a non-NULL `partnership_id` is a
  partnership whose `lead_org_id = org_id`. That is the 114 pattern.
- **Code change:** none. Each of the five emitters already sends values that pass these pins (checked against
  each call site above).

### 8.5 Rulings

Rulings 29 to 32.

---

## 9. agency_partner_invitations, invitation_requests, partner_access_requests

### 9.1 Live policies, triggers, grants

**agency_partner_invitations** (`scripts/003_agency_partner_invitations.sql`; 079:523-527 dropped the old
policies).

| Policy | Cmd | Source | Predicate |
|---|---|---|---|
| Agencies can create invitations | INSERT | 079:1127-1129 | `lead_org_id` mine |
| Agencies can view their sent invitations | SELECT | 079:1131-1133 | `lead_org_id` mine |
| Agencies can update their invitations | UPDATE | 079:1135-1137 | `lead_org_id` mine. No WITH CHECK. |
| Partners can view their received invitations | SELECT | 079:1139-1144 | `vendor_org_id` mine, or `partner_email` = my profile email |
| **Partners can update received invitations** | UPDATE | 079:1146-1151 | the same. No WITH CHECK. |

- **Triggers on disk:**
  - `trigger_link_partner_invitation` (003:83-86, a SECURITY DEFINER function at 003:68-79) writes
    `NEW.partner_id`, which 079:663 renamed. **If it is still live, every write to this table fails.**
    Unverified.
  - `trigger_invitation_timestamps` (003:108-111).
- The status check is pending, accepted, declined, confirmed (003:9).

**invitation_requests** (`scripts/009-comprehensive-auth-setup.SKIP:124-133`, the only on-disk definition).

| Policy | Cmd | Source | Predicate |
|---|---|---|---|
| **Partners can create requests** | INSERT | 079:1230-1232 | `vendor_org_id` mine |
| Partners can view own requests | SELECT | 079:1234-1236 | `vendor_org_id` mine |
| Agencies can view requests to their email | SELECT | snapshot :80 (baseline :374-381; 079 did not drop it, 079:1111) | `agency_email` = my profile email |
| **Agencies can update requests to their email** | UPDATE | snapshot :77 (baseline :396-402; 079:1112) | the same. No WITH CHECK. **Not in 121's list.** |

- The status check is pending, sent, accepted, declined (009:130).
- No unique constraint is on disk, although `components/request-invitation-modal.tsx:65` handles 23505.

**partner_access_requests** (`scripts/008-partner-access-requests.sql`; 079:540-543 dropped the old policies).

| Policy | Cmd | Source | Predicate |
|---|---|---|---|
| **Partners can create requests** | INSERT | 079:1325-1327 | `vendor_org_id` mine. `lead_org_id` is free. |
| Partners can view their requests | SELECT | 079:1329-1331 | `vendor_org_id` mine |
| Agencies can view requests to them | SELECT | 079:1333-1335 | `lead_org_id` mine |
| **Agencies can update requests to them** | UPDATE | 079:1337-1339 | `lead_org_id` mine. No WITH CHECK. **Not in 121's list.** |

- UNIQUE (`vendor_org_id`, `lead_org_id`) (008:13, renamed).
- The status check is pending, approved, declined (008:8).
- Triggers: none.

None of the three tables has a DELETE policy or a token column.

### 9.2 Columns and writers

- **agency_partner_invitations.**
  - Columns:
    - fixed once: `id`, `lead_org_id`, `partner_email`, `created_at`;
    - link, set once: `vendor_org_id`;
    - shared: `status`;
    - agency-owned: `invitation_message`;
    - trigger-owned: `accepted_at`, `confirmed_at`, `updated_at`.
  - **No code writes or reads it.** `lib/broadcast-partnership-cue.ts:20-22` calls it "a DECOY - zero rows,
    no readers".
- **invitation_requests.**
  - Columns:
    - fixed once: `id`, `vendor_org_id`, `agency_email`, `created_at`;
    - vendor content: `agency_name`, `message`;
    - shared: `status`, `updated_at`.
  - One VS insert: `components/request-invitation-modal.tsx:54-62` (browser client :31), `status: 'pending'`.
    There is no reader.
- **partner_access_requests.**
  - Columns:
    - fixed once: `id`, `vendor_org_id`, `lead_org_id`, `created_at`;
    - vendor, insert only: `request_message`;
    - agency-owned: `status`, `reviewed_at`;
    - shared: `updated_at`.
  - Writers:
    - VS inserts `app/partner/marketplace/page.tsx:142-146` (client :131) and
      `app/partner/network/page.tsx:542-547` (client :532), both `status: 'pending'`;
    - AS approve and decline, `app/agency/pool/page.tsx:861-864`, :895-898 (clients :860, :894).
  - No server code trusts `status = 'approved'`, and approval creates no partnership.

### 9.3 What a malicious vendor can do today

- **IN-1, high in shape, nil in practice:** on `agency_partner_invitations`, rewrite `lead_org_id`,
  `vendor_org_id`, `partner_email` or `status` (including the agency's `confirmed`). The table is empty and
  unread, and the stale trigger may block every write anyway.
- **IN-2, high (impersonation):** forge a `partner_access_requests` row "from" another vendor, in two steps.
  1. Insert with `lead_org_id` = own organization (only `vendor_org_id` is pinned).
  2. As that row's "agency", update `vendor_org_id` to Y and `lead_org_id` to Z.

  Agency Z then sees a pending request from Y on `/agency/pool` (`app/agency/pool/page.tsx:795`).
- **IN-3, medium:** on `partner_access_requests`:
  - insert a request naming any agency (unsolicited, shown on its pool page);
  - insert `status = 'approved'` directly, so its own UI shows "In Network" (`app/partner/network/page.tsx:688`)
    and the unique pair blocks a real request;
  - set `reviewed_at`.
- **IN-4, medium to high (impersonation, no reader):** on `invitation_requests`, the same two-step trick through
  the email policy. Insert with `agency_email` = own address, then rewrite `vendor_org_id` to another
  organization. The victim sees a request it never made (079:1234). The vendor can also insert any `status`
  or timestamp directly.

### 9.4 Proposed guards

- **agency_partner_invitations (ruling 33):** drop its two partner policies (count down 2), and drop the stale
  link trigger if it is live. Drop the table later, in a separate change. A guard on a decoy table is wasted
  effort.
- **invitation_requests (ruling 34):** drop the two email-keyed agency policies (count down 2), since no agency
  UI reads them. Add a guard on the vendor INSERT:
  - allowed: `vendor_org_id`, `agency_email`, `agency_name`, `message`;
  - `status` must be `pending`;
  - timestamps must be the default;
  - UPDATE refused for non-trusted callers.
- **partner_access_requests (ruling 35):** `partner_access_requests_write_guard()`.
  - Vendor INSERT:
    - allowed: `vendor_org_id`, `lead_org_id`, `request_message`;
    - `status` must be `pending`;
    - `reviewed_at` must be NULL;
    - timestamps must be the default.
  - Vendor UPDATE: refused.
  - Agency UPDATE: only `status` (from `pending` to `approved` or `declined`), `reviewed_at` and `updated_at`.
    `vendor_org_id` and `lead_org_id` are fixed for everyone. This closes IN-2.
- **Code change:** none. Every writer already complies.

### 9.5 Rulings

Rulings 33 to 36.

---

## 10. org_members (added; not in 121's list)

### 10.1 Live policies, triggers, grants

| Policy | Cmd | Source | Predicate |
|---|---|---|---|
| Members read their own membership row | SELECT | 079:1735-1737 | `user_id = auth.uid()` |
| Members read their organization roster | SELECT | 086:148 | (086) |
| **Org admins add members** | INSERT | 079:1740-1742 | `org_id` in `current_user_admin_org_ids()`. **`user_id` and `role` are free.** |
| Org admins remove members | DELETE | 079:1744-1746 | `org_id` in my admin organizations |

There are no triggers on disk (grep for `ON public.org_members` finds only the policies and indexes).

### 10.2 Columns and writers

- **Columns:** `org_id` and `user_id` are link columns, fixed once; `role` is authority.
- **Writers:**
  - 079 phase 2 (backfill, TP);
  - the `handle_new_user` signup trigger (079 phase 12, TP);
  - `accept_org_invitation()` (089, SECURITY DEFINER, `user_id` from `auth.uid()`, 089:634-644).
- **No session code inserts.** `lib/acting-org.ts:83-87` says so, and a grep of `app/`, `lib/` and
  `components/` finds none.

### 10.3 What a malicious vendor can do today

**OM-1, high.** The owner of any organization, which every founder is, can insert any user id with any role
into its own organization, without that user's consent. The new member then:
- can have its whole profile read by the organization (085:399-402);
- can be sent notifications (094:300-302, 096:382);
- has a second membership.

With `profiles.active_org_id` NULL, `resolveActingOrgId` refuses as "ambiguous" (`lib/acting-org.ts:247-257`)
and the entitled lead set comes back empty (118:402-410). So a vendor can **lock a lead-agency user out of its
own portal** by adding it to the vendor's organization. User ids leak in many places, for example as
`actor_id` on milestone events a vendor can read.

### 10.4 Proposed guard

Two options:
- **Drop "Org admins add members"** (count down 1, ruling 37). Every real writer is a trusted path or SECURITY
  DEFINER.
- Or ALTER its check to `user_id = auth.uid() AND org_id IN admin orgs`, which is useless in practice.

Pre-flight: assert that `accept_org_invitation` and the function behind the signup trigger are SECURITY
DEFINER (`prosecdef`), so the drop cannot break them.

### 10.5 Rulings

Ruling 37.

---

## 11. Smaller additions found by the sweep (rulings 38 to 41)

| Table, policy | Source | Gap | Severity | Proposed |
|---|---|---|---|---|
| partner_vouches, "Agencies can vouch", INSERT | 079:1455-1457 | `vendor_org_id` is free, so an organization can vouch for itself. `partner_vouch_count(s)` counts every row (082:291-293, :336-339), and the marketplace shows the number. | medium | require `lead_org_id <> vendor_org_id` (ruling 38) |
| payment_milestones, "Agency can manage payment milestones", ALL | 079:1505-1512 | `partnership_id` is not tied to the project's organization. An organization can attach a payment milestone on its own project to any partnership, and that partnership's vendor reads it (`app/api/partner/payments/route.ts:191-193`). | high (latent, payment fact) | the 114 pattern: `partnership_id` is a partnership whose `lead_org_id` is the project's `org_id` (ruling 39) |
| onboarding_deployments, agency ALL | 079:1262-1269 | `partnership_id` and `assignment_id` are free, so the row is visible to another vendor (079:1271-1276) | medium (latent) | the same pattern (ruling 39) |
| usage_tracking, "Agencies manage own usage tracking", ALL | 079:1675-1678 | any member rewrites its own `plan_tier`, `analyses_limit` and `ai_analyses_count` (067:5-7) | medium, billing; not a vendor issue | separate item (ruling 40) |
| partnerships, the 093 vendor permit list | 093:367 | the vendor can rewrite the whole `payment_terms_requests` value (a payment fact) | medium | separate classification (ruling 41) |

Recorded, not proposed:
- **`org_invitations`** (089:451-453, :473-476): forging fields within one's own organization. Low.
- **`profiles` INSERT** (snapshot :203): the 090, 091 and 113 guards are UPDATE-only, but the row already
  exists for every user. Low.
- **`contact_submissions`** (snapshot :66): anyone can insert. Low, spam only.
- **`organizations` UPDATE** (079:1797, limited to `name` by 092:956): a vendor can rename itself to look like
  another organization. Low to medium. Not proposed.
- **Side finding:** `app/partner/projects/page.tsx:380` updates `payment_milestones` to `payment_received` from
  a vendor session. No vendor UPDATE policy exists, so it silently matches zero rows.

**Corrections to 121's step 0 (e):**
- the partnerships guard citation "093:666-684" is the replaced function body; the trigger is 087:665-668;
- milestone_events has a second vendor-usable INSERT at 080:373;
- the two request tables' UPDATE policies are the actual forgery path, not the INSERTs.

---

## 12. Step 0 for 122: what must be read live before authoring

This should be one read-only query, in the style of `supabase/sql-checks/121-vendor-write-inventory.sql`: one
result set, no TEMP table, `tgenabled::text`.

1. **Policies.** Every policy on the 15 tables above, with USING and WITH CHECK, plus the public total. It must
   be 161, and every row must match sections 3 to 11.
2. **Triggers** on the same tables. In particular, whether the 003 `trigger_link_partner_invitation` is live.
3. **Columns, NOT NULL and defaults** for the tables with no CREATE TABLE on disk or an uncertain one:
   - project_assignments (V12);
   - project_documents and project_messages;
   - partner_status_updates;
   - invitation_requests;
   - partner_rfp_response_versions (`vendor_org_id` nullability).
4. **Check constraints:**
   - status vocabularies for project_assignments, assignment_agreements, onboarding_packages and the three
     request tables;
   - `budget_status` for partner_status_updates.
5. **Drift and exploitation counts.** Each must be read, and each one that must be 0 becomes a pre-flight
   refusal:
   - project_assignments: rows where `projects.org_id <> partnerships.lead_org_id`; `awarded` with no awarded
     bid;
   - partnerships: `lead_org_id = vendor_org_id`;
   - onboarding_packages: `org_id <> projects.org_id`; `partnerships.lead_org_id <> projects.org_id`;
     `reviewed` without a stamp; a future stamp;
   - assignment_agreements: `signed` without `signed_at`; `signed_by` not a member of the vendor
     organization; the assignment's project organization differs from the partnership's lead;
   - partner_status_updates: `project_id` not equal to its assignment's project; the partnership lead not
     equal to the project organization;
   - partner_rfp_response_versions: `lead_org_id` or `vendor_org_id` differing from the parent; numbering
     gaps or duplicates; distinct `status_at_submission`;
   - project_documents: `blob_path` not under `projects/{project_id}/`; rows where `assignment_id`'s project
     is not `project_id` (the same for messages);
   - milestone_events: `created_at > now()`; vendor rows whose subject fails the section 8.4 pins;
   - partner_access_requests and invitation_requests: rows not `pending` with no agency stamp;
     `vendor_org_id` changed (not detectable directly; count rows whose `created_at` is later than
     `updated_at`);
   - org_members: members whose only route in was not the backfill, signup or an accepted invitation (users
     with more than one membership and no accepted `org_invitations` row).
6. **Functions.** `prosecdef` for `accept_org_invitation` and the signup trigger's function.

---

## 13. Ranked order by severity

High first, then by how directly it can be exploited with what a vendor can already read.

| Rank | Item | Section | Severity |
|---|---|---|---|
| 1 | project_assignments: vendor repoints `project_id` (PA-1, PA-2) and self-partnership insert (sweep H2) | 3 | high |
| 2 | project_documents: `blob_path` or `blob_url` read and delete (PD-2, PD-3) | 4 | high |
| 3 | org_members: add any user to one's own organization (OM-1) | 10 | high |
| 4 | onboarding_packages: repoint into another agency's project, leaking document links (OB-1) | 5 | high |
| 5 | assignment_agreements: move across organizations, forge or revoke a signature, swap the contract link (AG-1 to AG-3) | 5 | high |
| 6 | project_documents and project_messages: UPDATE repoint into another project (PD-1) | 4 | high |
| 7 | partner_status_updates: insert or move onto another lead's project (SU-1 to SU-3) | 6 | high |
| 8 | partner_rfp_response_versions: forged price on its own bid, including after award (RV-2); on a competitor's bid (RV-1, latent) | 7 | high |
| 9 | project_assignments: self-award and status rewrite (PA-3) | 3 | high |
| 10 | partner_access_requests: impersonation in two steps (IN-2) | 9 | high |
| 11 | payment_milestones and onboarding_deployments: partnership not tied (section 11) | 11 | high (latent) / medium |
| 12 | milestone_events: competitor subject (ME-1, latent), feed flooding (ME-2), agency insert untied (ME-5) | 8 | high (latent) / medium |
| 13 | invitation_requests: impersonation and status (IN-4) | 9 | medium to high, no reader |
| 14 | partner_status_updates and onboarding_packages: rewrite own history, fake agency marker (SU-4, OB-3) | 5, 6 | medium |
| 15 | project_documents and project_messages: other vendor's assignment at insert (PD-5), message rewrite (PD-4) | 4 | medium |
| 16 | partner_vouches: self-vouch | 11 | medium |
| 17 | partner_access_requests: self-approved or unsolicited request (IN-3) | 9 | medium |
| 18 | partner_rfp_response_versions: backdated or extra versions (RV-3) | 7 | medium |
| 19 | usage_tracking; partnerships `payment_terms_requests` | 11 | medium, separate |
| 20 | agency_partner_invitations (IN-1) | 9 | high in shape, nil in practice |
| 21 | the remaining lows (timestamps, labels, `org_invitations`, `contact_submissions`) | 3 to 11 | low |

---

## 14. One migration or a split

**Recommendation: split.**

- **122, the highs** (ranks 1 to 10):
  - project_assignments (guard, plus the partnerships self-partnership rule);
  - project_documents and project_messages (drop the two UPDATE policies, two guards, the two SELECT
    tightenings);
  - org_members (drop the INSERT policy);
  - onboarding_packages and assignment_agreements (two guards);
  - partner_status_updates (guard);
  - partner_rfp_response_versions (ALTER POLICY plus guard);
  - partner_access_requests (guard, because IN-2 is an impersonation across organizations).
- **124 or later, the rest:**
  - milestone_events (guard plus the agency ALTER POLICY);
  - invitation_requests and agency_partner_invitations (policy drops plus guard);
  - partner_vouches, payment_milestones and onboarding_deployments (114-pattern ALTER POLICY).

  usage_tracking and `payment_terms_requests` go to their own designs.

**Why split.**
- 121's test covered one table with 68 assertions. Putting all 15 tables in one migration would mean a
  pre-apply test of roughly 250 assertions, run in a single paste. One subject missing from production makes
  the whole run INCONCLUSIVE, and one typo blocks every fix behind it.
- The highs share one theme (a link column a vendor can move) and one subject set (vendor, agency, third
  organization, two projects).
- The 124 items are either latent or need an owner decision on dead features (rulings 31, 33, 34). That should
  not hold up the highs.

**Alternative: one 122.** It is acceptable if the owner wants a single paste. If so, the pre-flight and test
must be built table by table, so that a refusal names the table.

**Policy count after 122.** It is 161 minus the drops ruled:
- project_documents and project_messages UPDATE: minus 2 (ruling 9);
- org_members INSERT: minus 1 (ruling 37).

That gives **158** if both are ruled as recommended. Every other change is ALTER POLICY or a trigger. The
pre-flight asserts 161 before, and the post-check asserts the exact number after. 124's drops (rulings 33 and
34, minus 4) would take that to 154.

**Order of work.** The code changes go out first, because they work before and after the migration:
- the document path checks (ruling 10);
- the version read-back and the agency version filter (rulings 26 and 28);
- the 42501 mappings (ruling 42);
- the status-update prefix strip (ruling 23);
- the onboarding short-circuit (ruling 18).

Then the inventory, the pre-apply test, the dry run and the real run, as in 121's header.

---

## 15. Pre-apply test scenarios for 122

The shape is 121's (`121_preapply_test.sql:1-110`):
- one paste, one DO block, phase BEFORE and phase AFTER;
- no TEMP table;
- subjects chosen through `partnerships.vendor_org_id`;
- impersonation proved by reading back `auth.uid()` and `current_user`;
- an isolation fingerprint after each scenario;
- the result carried in the final RAISE.

Subjects:
- **vendor**: a vendor member who is not in lead o1;
- **m1**: an agency member of o1;
- **oo**: a third organization, with **pB**, a project of oo;
- **ps1**: the vendor's partnership with o1, and **ps2**, a partnership of the vendor with oo if one exists;
- **svc** (the service role) and **anon**;
- throwaway rows: projects copied from p1, an assignment, an agreement, a package, a status update, a bid, a
  document, a message.

"Before" means the value the database returns before 122, and "after" the value it returns after 122. Every
row marked **D** is discriminating: accepted before and refused or changed after. Unmarked rows have the same
expectation in both phases.

**project_assignments (PA)**
- PA1: the vendor accepts or declines an `invited` assignment. Accepted both times.
- PA2 (D): the vendor sets `project_id` to pB.
- PA3 (D): the vendor sets `partnership_id` to ps2.
- PA4 (D): the vendor sets `status = 'awarded'`.
- PA5 (D): the vendor sets `status = 'completed'`.
- PA6 (D): the vendor moves `declined` to `accepted`.
- PA7 (D): the vendor sets `awarded_at`, `completed_at` or `bid_notes`.
- PA8: m1 awards (W4a) and inserts an awarded row (W4b). Accepted both times.
- PA9 (D): m1 inserts an assignment of ps1 on pB.
- PA10 (D): a vendor-only organization creates a partnership with itself as lead and vendor.
- PA11 (D): that organization inserts an assignment on pB.
- PA12: svc repoints. Accepted.
- PA13: anon writes. Refused.

**project_documents and project_messages (PD)**
- PD1: the vendor inserts a document under `projects/{p}/...` on its own assignment. Accepted both times.
- PD2: the vendor inserts a message on its own assignment. Accepted both times.
- PD3 (D): the vendor updates a document's `project_id` to pB. Accepted before, refused after (the policy is
  gone).
- PD4 (D): the vendor updates a message's `content`.
- PD5 (D): the vendor inserts a document with `blob_path` outside `projects/{p}/`.
- PD6 (D): the vendor inserts a document with a `blob_url` that does not match its `blob_path`.
- PD7 (D): the vendor inserts naming another vendor's assignment on p.
- PD8 (D): m1 updates a document's `assignment_id` to oo's assignment.
- PD9 (D): read check. The vendor no longer sees a row whose `assignment_id` is its own but whose `project_id`
  is pB (set up by svc).
- PD10: the vendor deletes its own document. Accepted both times (ruling 11).
- PD11: m1 reads its project's documents and messages. Same rows both times.

**assignment_agreements (AG)**
- AG1: the vendor signs a `sent` agreement. Accepted both times. After: `signed_by = auth.uid()` and
  `signed_at = now()`, even if the request sent other values.
- AG2: the vendor marks `viewed` from `sent`.
- AG3 (D): the vendor moves `signed` to `declined`.
- AG4 (D): the vendor sets `signed_by` to m1.
- AG5 (D): the vendor sets `assignment_id` to its assignment on pB.
- AG6 (D): the vendor sets `external_document_url`.
- AG7 (D): the vendor sets `agreement_type`.
- AG8: m1 deploys (upsert `sent`). Accepted.
- AG9 (D, ruling 17): m1 re-deploys over `signed`.

**onboarding_packages (OB)**
- OB1: the vendor marks a `sent` package `reviewed`. Accepted both times; after, `partner_reviewed_at` is
  stamped.
- OB2 (D): the vendor un-reviews.
- OB3 (D): the vendor sets `project_id` to pB.
- OB4 (D): the vendor sets `partnership_id` to ps2.
- OB5 (D): the vendor sets `org_id`.
- OB6 (D): the vendor sets `kickoff_url`.
- OB7 (D): the vendor sets `custom_message`.
- OB8 (D): the vendor sets `created_at`.
- OB9: m1 inserts a package. Accepted.
- OB10 (D, ruling 19): m1 inserts with an `org_id` that is not the project's.

**partner_status_updates (SU)**
- SU1: the vendor posts on its awarded assignment. Accepted both times.
- SU2 (D): the vendor posts with `project_id` = pB.
- SU3 (D): the vendor posts with `project_assignment_id` of another project.
- SU4 (D): the vendor updates `project_id`.
- SU5 (D): the vendor updates `is_resolved`.
- SU6 (D): the vendor updates `notes`.
- SU7 (D): the vendor posts with `is_resolved = true`.
- SU8 (D): the vendor posts with a future `created_at`.
- SU9 (D, ruling 23): the vendor posts with a `[Agency override]` prefix.
- SU10 (D, ruling 20): the vendor posts on a non-awarded assignment.
- SU11 (D, ruling 21): the vendor posts on a removed partnership.
- SU12: m1 resolves. Accepted.

**partner_rfp_response_versions (RV)**
- RV1: the vendor inserts a version of its own submitted bid. Accepted both times. After: the number is
  assigned and the content is copied from the bid.
- RV2 (D): the vendor inserts naming another vendor's bid.
- RV3 (D): the vendor inserts with a `lead_org_id` that is not the bid's.
- RV4 (D): the vendor inserts on its own awarded bid.
- RV5 (D): the vendor inserts on its own draft bid.
- RV6 (D): the vendor inserts with a budget unlike the bid. After: stored as the bid's.
- RV7 (D): the vendor inserts with a backdated `submitted_at`.
- RV8 (D): the vendor inserts with `status_at_submission = 'awarded'`.
- RV9 (D): the vendor inserts with `version_number = 999`. After: stored as the maximum plus one.
- RV10 (D): m1, as a member of the inserted `vendor_org_id`, inserts on another bid.
- RV11: UPDATE by the vendor. Zero rows both times (no policy).

**org_members (OM)**
- OM1 (D): the vendor's owner inserts m1's user id into the vendor organization.
- OM2: svc inserts. Accepted.
- OM3: `accept_org_invitation` on a test invitation. Accepted both times.

**partner_access_requests (AR)**
- AR1: the vendor inserts a `pending` request to o1. Accepted both times.
- AR2 (D): the vendor inserts as `approved`.
- AR3 (D): the vendor inserts with `reviewed_at` set.
- AR4 (D): the vendor inserts with its own organization as lead, then updates `vendor_org_id`.
- AR5: m1 approves. Accepted.
- AR6 (D): m1 updates `vendor_org_id`.

**Self-checks**
- S1: the public policy count is 161 before and the ruled number after.
- S2: no policy changed other than the ones ruled.
- S3: each altered policy keeps its command, roles and USING.
- S4: no grant changed outside the new functions.
- S5: every new function is invoker, pinned, and not executable by anon or authenticated.
- S6: every new trigger is enabled with tgtype 23, and other triggers are unchanged.
- S7: 122 writes no row.
- S8: `accept_org_invitation` and the signup function are SECURITY DEFINER.

That is about 81 scenarios plus 8 self-checks. Before authoring the test, the scenario list should be
re-counted against the rulings as answered.

**Unverified until a first run:**
- that the setup can insert `project_assignments`, `partner_status_updates` and `project_documents` rows with
  only the columns on disk (a live NOT NULL column would make that setup a test fault, never a PASS);
- that a self-partnership setup (PA10) is not blocked by something out of band.

---

## 16. Every owner ruling, numbered

Each ruling lists its options and my recommendation (**Rec**).

**Scope and structure**

1. **Scope additions from the sweep.**
   - (a) All the added tables go into the 122/124 plan.
   - (b) Only org_members and the project_assignments self-partnership path join 122; the rest go to 124.
   - (c) None; a separate pass.
   - **Rec: (b)**, with section 11's items in 124.
2. **One migration or a split.**
   - (a) A single 122.
   - (b) 122 for the highs, 124 or later for the rest.
   - **Rec: (b).**
3. **Vendor-session definition.**
   - (a) 118's definition everywhere, with the lead organization derived by a join under the caller's row level
     security, failing closed when the lookup returns nothing.
   - (b) Treat every non-trusted caller as a vendor on tables with no agency writer.
   - **Rec: (a).**

**project_assignments**

4. **Vendor UPDATE.**
   - (A) Drop `assignments_partner_update` (count down 1).
   - (B) Guard it: `status` and `updated_at` only, `invited` to `accepted` or `declined` only.
   - (C) Keep the policy and refuse every vendor update.
   - **Rec: (B).**
5. **Fix `project_id`, `partnership_id` and `created_at` for agency sessions too, and require
   `projects.org_id = partnerships.lead_org_id` on INSERT.**
   - (a) Yes.
   - (b) Vendor only.
   - **Rec: (a)**, after the step 0 drift count is read.
6. **Refuse a partnership whose lead and vendor organization are the same.**
   - (a) Yes, by ALTER POLICY on 087's INSERT check.
   - (b) Yes, in the partnerships guard.
   - (c) No; rely on ruling 5.
   - **Rec: (a)** if the step 0 count is 0. If any exist, ask whether a dual-role organization legitimately
     partners with itself.
7. **Are `bid_amount`, `bid_notes`, `bid_submitted_at`, `awarded_at` and `completed_at` frozen for vendors?**
   - **Rec: yes.**
8. **May a vendor withdraw after accepting, or reverse a decline?**
   - **Rec: no.** The only vendor move is from `invited`.

**project_documents and project_messages**

9. **The two self-row UPDATE policies.**
   - (a) Drop both (count down 2).
   - (b) Keep them, with a WITH CHECK pinning the link and identity columns.
   - (c) Keep content-only edits.
   - **Rec: (a).** Nothing updates either table.
10. **Bind `blob_path` and `blob_url` to the project.**
    - (a) In the trigger and in both routes.
    - (b) Routes only.
    - (c) Trigger only.
    - **Rec: (a).** The route change is required in any case, for rows that already exist.
11. **Self-row DELETE on documents.**
    - (a) Keep it.
    - (b) Drop it.
    - (c) Restrict it to agency members.
    - **Rec: (a) for now**, with ruling 10's route check on `del()`. Revisit when a UI exists.
12. **Tighten the partner SELECT arms to require `pa.project_id = row.project_id`.**
    - **Rec: yes, in 122** (ALTER POLICY, count unchanged).
13. **Vendor rows with no assignment.**
    - (a) Refuse a vendor insert without one of its own assignments.
    - (b) Widen the vendor SELECT to project-level rows.
    - **Rec: (a).** Today such an insert already fails on read-back.

**assignment_agreements and onboarding_packages**

14. **Is `assignment_agreements` a live feature?**
    - (a) Guard it.
    - (b) Drop the vendor UPDATE policy (count down 1).
    - (c) Retire the table and routes.
    - **Rec: (a)**, or (b) if the NDA and SOW flow is ruled dead.
15. **Vendor agreement transitions.**
    - The proposal: from `sent` or `viewed` to `viewed`, `signed` or `declined`; signed and declined final for
      the vendor; the signature stamped by the database.
    - **Rec: yes.**
16. **May an agency mark an agreement `signed`?** The PATCH route allows it with no signer.
    - (a) Allow it.
    - (b) Agency limited to `pending` and `sent`.
    - **Rec: (b).**
17. **Re-deploy over a signed agreement** (the deploy upsert resets it to `sent` and leaves the signature).
    - (a) Refuse.
    - (b) Clear the signature.
    - (c) Keep today's behaviour.
    - **Rec: (a).**
18. **Vendor re-marks a reviewed package.**
    - (a) The database refuses and the route returns 200 unchanged.
    - (b) A silent no-op in the database.
    - **Rec: (a).**
19. **Fix the package link columns for agency sessions too, and require `org_id = projects.org_id`.**
    - **Rec: yes**, after the drift count.

**partner_status_updates**

20. **Which assignments may carry a status update?**
    - (a) Any status, as today.
    - (b) Awarded only.
    - (c) Awarded or completed.
    - **Rec: (b)**, with the route's no-id branch changed to match.
21. **May a removed partnership post?**
    - **Rec: no.**
22. **Vendor UPDATE.**
    - (a) Guard refuses all (policy kept, loud 42501).
    - (b) Drop the policy (count down 1, silent zero rows).
    - **Rec: (a).**
23. **The `[Agency override]` prefix in vendor notes.**
    - (a) Refuse it in the guard and strip it in the route.
    - (b) Add an author-side column.
    - (c) Accept the risk.
    - **Rec: (a).**
24. **The agency override insert, which is refused today** (no agency INSERT policy, two constraint
    violations).
    - (a) Add an agency INSERT policy and fix the payload.
    - (b) Remove the override UI and route.
    - (c) Leave it out of 122.
    - **Rec: (c)**, recorded as a defect for a separate change.

**partner_rfp_response_versions**

25. **Snapshot content.**
    - (a) The database copies it from the parent.
    - (b) Refuse a mismatch.
    - **Rec: (a).** An autosave between the two requests cannot break it.
26. **`version_number`.**
    - (a) The database assigns the maximum plus one under the parent lock.
    - (b) Refuse anything else.
    - **Rec: (a)**, with the route reading back the stored number.
27. **Parent-status gate.** A version only when the bid is `submitted`, `shortlisted` or `meeting_requested`.
    - **Rec: yes.** It closes the post-award price change.
28. **Existing forged rows.**
    - (a) The agency reader filters versions to the bid's vendor.
    - (b) Also delete mismatched rows found in step 0.
    - **Rec: (a) now**, and (b) case by case after reading step 0.

**milestone_events**

29. **Pin the subject per event type, and require `created_at` to be the default, for vendor sessions** (section
    8.4).
    - **Rec: yes.**
30. **`scope_item_name`.**
    - (a) The database overwrites it from the subject row.
    - (b) Whitelist it and cap its length.
    - **Rec: (a).**
31. **`invitation.accept` and `invitation.decline`, which have no emitter.**
    - (a) Refuse from vendor sessions until one ships.
    - (b) Pin them to the partnership.
    - **Rec: (a).**
32. **The agency INSERT policy (080:373-381).** Tie a non-NULL `partnership_id` to a partnership led by
    `org_id`.
    - **Rec: yes, in 124.**

**The three request and invitation tables**

33. **agency_partner_invitations, the decoy.**
    - (a) Drop the table.
    - (b) Drop its two partner policies (count down 2), and drop the stale 003 trigger if it is live.
    - (c) Guard it.
    - **Rec: (b) in 124**, and (a) later.
34. **invitation_requests.**
    - (a) Drop the two email-keyed agency policies (count down 2) and guard the vendor insert.
    - (b) An email-keyed guard on both.
    - (c) Drop the table and the modal.
    - **Rec: (a) in 124.**
35. **partner_access_requests.** The guard of section 9.4: vendor insert `pending` only; agency update limited
    to status, `reviewed_at` and `updated_at`; organization columns fixed for everyone.
    - **Rec: yes, in 122.**
36. **Require the `lead_org_id` named in an access request to be a discoverable agency.**
    - **Rec: no.** It couples the guard to discovery logic, and the code still passes a profile id
      (`app/partner/marketplace/page.tsx:132-136`). Record the remaining spam vector as a known medium.

**org_members**

37. **"Org admins add members".**
    - (a) Drop it (count down 1).
    - (b) Pin `user_id = auth.uid()`.
    - (c) Keep it.
    - **Rec: (a)**, with the pre-flight proving the invitation and signup functions are SECURITY DEFINER.

**Smaller additions (124)**

38. **partner_vouches.** Require `lead_org_id <> vendor_org_id`.
    - **Rec: yes.**
39. **payment_milestones and onboarding_deployments agency ALL.** Tie `partnership_id` (and `assignment_id`) to
    the project's organization, in the 114 pattern.
    - **Rec: yes.**
40. **usage_tracking**, a member rewriting its own plan and quota.
    - **Rec: a separate billing item**, not vendor work.
41. **partnerships `payment_terms_requests`**, which the vendor can rewrite whole.
    - **Rec: a separate classification**, because it needs its own vendor and agency split of the value.

**Code and process**

42. **Error mapping.** Map 42501 to 403 or 409 in:
    - the agreements PATCH;
    - the onboarding mark-reviewed route;
    - the status-update route;
    - the assignments PATCH;
    - the version insert, which logs at error level and returns a warning field without failing the save.

    **Rec: yes**, shipped before 122.
43. **Explicit `REVOKE UPDATE, DELETE` on tables that have no such policy** (versions, messages).
    - **Rec: no.** It keeps 121's posture of unchanged grants (self-check S4), and row level security already
      refuses.
44. **Dead routes** (POST and PATCH `/api/projects/[id]/assignments`, GET `/api/projects/[id]/partner`).
    - **Rec: delete them in a separate change**, not with 122.

---

## 17. Refused, assumptions, not done

- **Refused:** nothing.
- **Assumptions:**
  - **A1.** 121 is applied and the count is 161 (from the brief; the repository still says 121 is not applied).
  - **A2.** Live policies, triggers and columns match the files on disk. Section 12 is where that gets
    checked.
  - **A3.** The self-partnership path (section 3.3) is not blocked out of band.
  - **A4.** Postgres checks an UPDATE's new row against the caller's SELECT policies, as section 4.3 relies on.
    Recalled, not executed.
- **Not done:** migration 122, its down file, its pre-apply test, the inventory query, the code changes, and the
  LIGAMENT_CONTEXT and roadmap updates. All of this waits on the rulings in section 16.
