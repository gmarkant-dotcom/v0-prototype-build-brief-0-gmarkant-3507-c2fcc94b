# 079 Organizations Identity Migration — Precondition 3 Report

**Date:** 2026-08-18
**Branch under test:** `feat/079-org-rename`
**Base:** `main`
**Scope:** Precondition 3 of 3. Preconditions 1 and 2 (production dry-run in a rolled-back
transaction; 83 DROP POLICY targets resolved; storage policies clear) were closed before this
report and were not re-verified here.

**Nothing was pushed, merged, or deployed. No SQL was executed. No file under
`supabase/migrations/` was modified. Nothing found in TASK 5 was fixed.**

---

## Verdict

| # | Task | Result |
|---|------|--------|
| 0 | Starting state recorded | Clean |
| 1 | Rebase onto main | No-op — already based on current main. Zero conflicts. Migration digests unchanged. |
| 2 | Gates | `tsc` 0, `build` 0, identity guard 0, embed guard 0, org-id-read guard 0. `lint` **exit 1**, `policy-audit:guard` **exit 1** — both identical to the `main` baseline. `verify-rls` **not run** (hits the live database). |
| 3 | Blind-class guard | 25 found, baseline 25. **Exact match.** 0 regressions, 0 improvements. |
| 4 | Thirteen PostgREST embeds | All 13 closed. Zero surviving old-form embeds. The two `sender:profiles!` embeds are intact. |
| 5 | Org-id vs user-id comparisons | **188 sites across 59 files.** Reported only. Nothing changed. |

**Precondition 3 is met on the code gates**, with two qualifications that are not
regressions but are stated plainly rather than waved through:

1. `pnpm lint` fails (exit 1) on this branch **and on `main`**, with byte-identical error
   counts. It is a pre-existing repository condition, not something 079 introduced.
2. `pnpm verify-rls` was **not executed** because it queries the live database, which the
   instructions forbade. It is the one named gate with no result. See TASK 2.

---

## TASK 0 — Starting state

Working tree: **clean** (`git status --porcelain` empty). Nothing stashed, nothing committed.

| Ref | SHA |
|-----|-----|
| `main` | `28be279dd6473b8759055da0cdf6b7ecd6c83508` |
| `origin/main` | `28be279dd6473b8759055da0cdf6b7ecd6c83508` |
| `feat/079-org-rename` | `ccf247926df6a11b567e4d882d8cf037939348a3` |

`main` vs `origin/main`: **0 ahead, 0 behind.** `main` is not ahead of its remote.

### Baseline migration digests (the files verified against production this morning)

```
bc19c8872223c2ebdc0a2350c716ab23686ac40f8536652e7f2b6ed8eb77756f  supabase/migrations/079_organizations.sql
dbb30f02ffc07dd213452be2d78668352dd206d4f5e94664edcdadc403f4f644  supabase/migrations/079_organizations_down.sql
```

`079_organizations.sql` is 2062 lines; `079_organizations_down.sql` is 1071 lines.

**Note on provenance.** Both filenames also exist on `main`, with *different* content
(`7831c6b6…` and `80db7f2e…`). The digests above are the **branch** versions. The branch
carries +323/−… lines of change to the up migration and +44 to the down migration relative
to `main`. The verified artifacts are therefore the branch copies, and those are what the
TASK 1 gate protects.

---

## TASK 1 — Rebase

```
$ git rebase main
Current branch feat/079-org-rename is up to date.
EXIT CODE: 0
```

**The rebase was a no-op.** `git merge-base main feat/079-org-rename` returns
`28be279…`, which is exactly `main`'s HEAD, and `git log --oneline feat/079-org-rename..main`
is empty. The branch was already based on the current tip of `main`.

- **Conflicted files: none.** No conflict occurred, so no resolution was chosen, and none was
  made silently. No conflict touched either 079 migration file.
- Branch HEAD before rebase: `ccf247926df6a11b567e4d882d8cf037939348a3`
- Branch HEAD after rebase: `ccf247926df6a11b567e4d882d8cf037939348a3` — unchanged.
- Working tree after rebase: clean.

### Digest gate — the check that protects this morning's verification

```
bc19c8872223c2ebdc0a2350c716ab23686ac40f8536652e7f2b6ed8eb77756f  supabase/migrations/079_organizations.sql
dbb30f02ffc07dd213452be2d78668352dd206d4f5e94664edcdadc403f4f644  supabase/migrations/079_organizations_down.sql
```

| File | vs TASK 0 |
|------|-----------|
| `079_organizations.sql` | **IDENTICAL** |
| `079_organizations_down.sql` | **IDENTICAL** |

Both digests were re-confirmed a third time at the end of the run, after every gate had
executed. Still identical.

### Final commit list (`git log --oneline main..feat/079-org-rename`) — 11 commits

```
ccf2479 docs: the third-pass report, release readiness
1d0a756 docs: an executable 079 runbook, the pre-flight page, and a corrected expected result
1f63c04 fix: the pool fallback says why, and three blind-class profiles reads
69058cd docs: the second-pass report on Greg's four rulings and the pool
f6efe54 fix: notifications addressed to organization ids reach nobody
4593c02 feat!: rename the org-contact payload keys, partner -> vendor_org
a644a2f feat!: the counterparty organization SELECT policy, from one shared helper
0cf06f5 feat!: close the thirteen 079 embeds on the organization primary contact
6f54f1c docs: the 079 execution report and the release runbook
d053ebb feat!: membership scoping for the service-role routes and the eleven email sites
ec4e97b feat!: rename agency_id and partner_id to the organization columns
```

---

## TASK 2 — Gates

### `package.json` "scripts" block, in full

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "verify-rls": "node scripts/verify-rls.mjs",
  "identity-columns": "node scripts/check-identity-columns.mjs",
  "identity-columns:guard": "node scripts/check-identity-columns.mjs --guard",
  "policy-audit": "node scripts/audit-policy-snapshot.mjs",
  "policy-audit:guard": "node scripts/audit-policy-snapshot.mjs --guard"
}
```

### Results

| Command | Exit code | Verdict |
|---------|-----------|---------|
| `node scripts/check-identity-columns.mjs --guard` | **0** | PASS |
| `pnpm identity-columns` (inventory) | **0** | PASS |
| `pnpm policy-audit` (non-guard) | **0** | PASS (exits 0 by design) |
| `pnpm policy-audit:guard` | **1** | **FAILURE** — see below |
| `pnpm lint` | **1** | **FAILURE** — see below |
| `npx tsc --noEmit` | **0** | PASS — zero diagnostics |
| `pnpm build` | **0** | PASS |
| `node scripts/check-embed-targets.mjs --guard` | **0** | PASS |
| `node scripts/check-org-id-reads.mjs --guard` | **0** | PASS |
| `pnpm verify-rls` | **NOT RUN** | See below |

`check-embed-targets.mjs` and `check-org-id-reads.mjs` are not wired into `package.json`.
They were run anyway because TASK 3 and TASK 4 require them and their filenames contain
`check`.

### `pnpm verify-rls` — not executed, and why

`scripts/verify-rls.mjs` constructs a Supabase client from `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` and issues queries against `pg_class`, `pg_namespace` and
`pg_policy` on the live database. Running it would have executed SQL against production,
which the instructions forbade. **It was deliberately not run. It has no result in this
report, and no claim is made about whether it would pass.** If it is a required gate, it
needs an explicit decision to run it against production.

### `pnpm lint` — exit code 1

```
✖ 182 problems (154 errors, 28 warnings)
  0 errors and 7 warnings potentially fixable with the `--fix` option.
[ELIFECYCLE] Command failed with exit code 1.
```

This is a **failure**, not a warning. It is also **not a regression**. Baseline measured by
checking `main` out into a throwaway worktree and running the same ESLint binary:

| | errors | warnings | files with errors |
|---|---|---|---|
| `main` | 154 | 25 | 95 |
| `feat/079-org-rename` | 154 | 28 | 95 |

The error-bearing file sets are identical; a line-by-line diff of the two runs shows only
line-number shifts inside the same files (e.g. `app/agency/page.tsx:284` on `main` →
`:287` on the branch), which is what editing the file above a pre-existing violation does.

**Branch delta: 0 new errors, +3 new warnings.** The three added warnings are unused
`eslint-disable` directives for `@typescript-eslint/no-explicit-any` in `lib/email.ts:267`,
`lib/entitlements.ts:90`, and `lib/vouch-counts.ts:81` — suppressions the branch made
unnecessary and then left behind. Harmless, and trivially removable, but they are the only
thing 079 adds to the lint output.

The dominant pre-existing rule is `react-hooks/set-state-in-effect`, concentrated in
`app/agency/msa/page.tsx` (22), `app/agency/documents/page.tsx` (12), `app/privacy/page.tsx`
(8) and `app/terms/page.tsx` (6). None of that is 079's doing.

### `pnpm policy-audit:guard` — exit code 1

```
FLAGGED: 53  (44 direct company-column comparison, 9 indirect)
Allow-listed and not flagged: 6
```

This is a **failure** by exit code. It is **identical on `main`** — the same 53/44/9/6, also
exit 1 — and the branch does not modify the snapshot the audit reads
(`docs/schema-snapshot-2026-08-13.md` is unchanged between `main` and the branch).

The script's own header states this is expected: *"IT IS SUPPOSED TO FLAG A LOT TODAY …
The number this prints today is the BASELINE. After 079 it must be zero, and until then the
guard is deliberately not wired into the build."* The 53 are database-side RLS predicates,
which this report was explicitly scoped away from. **These 53 do not go to zero by merging
this branch — they go to zero when 079 is applied and the policies are rebuilt.** That is a
post-apply verification, not a precondition, and it is the single largest thing still
outstanding after this report.

### A note on the identity guard's output

`check-identity-columns.mjs` prints its summary under the headings `org_id`, `lead_org_id`,
`vendor_org_id`, which are the **post-079 destination names**, while the banner says "Legacy
company identity columns". This reads at first glance as though it is counting the new names.
It is not. The scanned tokens are `LEGACY = ["agency_id", "partner_id", "voucher_agency_id",
"vouched_partner_id"]` (line 55); the headings are the buckets each legacy hit *maps to*.
A total of 0 therefore genuinely means no legacy column names survive in `app`, `lib`,
`components`, `contexts`, `hooks`, `middleware.ts` across 365 scanned files. The label is
merely confusing, and worth a one-line fix later.

---

## TASK 3 — Blind-class guard vs the KNOWN_OPEN baseline

`node scripts/check-org-id-reads.mjs --guard` — **exit code 0**

```
Summary
  OPEN             25  known, reported, deliberately unfixed on this branch
  ALLOW-LISTED      1  read and established to be user ids
  REGRESSIONS       0  files with MORE findings than recorded
  IMPROVED          0  files with FEWER - lower the count in KNOWN_OPEN

ORG-ID-READ GUARD PASSED. No NEW instance of the class.
```

**Found: 25. Baseline: 25. Exact match.**

The baseline was independently recomputed from the source rather than taken from the
guard's own summary: `KNOWN_OPEN` holds **19 entries** whose `count` fields sum to
**25**. The guard found 25.

Both directions are clean and both were checked: **REGRESSIONS 0** (no file has more
findings than recorded) and **IMPROVED 0** (no file has fewer). A count below baseline would
have appeared as `IMPROVED` and is reported here as explicitly zero, not quietly accepted.

These 25 sites are **not fixed**. They are `profiles`-by-id reads keyed on an organization
id, correct only while every organization id equals its founding user's uid, and they break
for every organization created after 079's PHASE 12 trigger starts minting
`gen_random_uuid()`. They fail silently — empty result at HTTP 200, blank name in the UI, no
log line. They are recorded so the guard can fail when the class *grows*.

---

## TASK 4 — The thirteen PostgREST embeds

**All thirteen are closed. Zero surviving old-form embeds.**

`node scripts/check-embed-targets.mjs --guard` — **exit code 0**

```
Repointed (table, column) pairs parsed from 079 PHASE 7: 30
Scanned 365 files.
  REPOINTED      0
  PERSON         0
  TOTAL          0  in 0 files
EMBED GUARD PASSED. No embed traverses a foreign key 079 repoints.
```

### Independent grep confirmation

Grepping `app/ lib/ components/ contexts/ hooks/` for **every** occurrence of `profiles!`,
excluding comment lines, returns exactly four live embeds — and nothing else:

```
app/api/projects/[id]/messages/route.ts:94   sender:profiles!project_messages_sender_id_fkey(
app/api/projects/[id]/messages/route.ts:234  sender:profiles!project_messages_sender_id_fkey(
lib/org-contact.ts:89   'id, name, primary_contact:profiles!primary_contact_user_id(id, email, full_name)'
lib/org-contact.ts:96   'id, name, primary_contact:profiles!primary_contact_user_id(id, email, full_name, capabilities, company_logo_url, created_at)'
```

- The **two `sender:profiles!project_messages_sender_id_fkey` embeds are present and
  untouched**, as required — `sender_id` is a user id. The branch does modify that file
  (renaming `agency_id`→`org_id` and `partner_id`→`vendor_org_id` in its filters), but the
  diff shows neither `sender:` embed line was altered.
- The two `lib/org-contact.ts` embeds are the new nested form, centralised into
  `ORG_CONTACT_SELECT` / `ORG_CONTACT_SELECT_RICH`.

Every old-form embed that remains in the tree is inside a `079-EMBED: rewritten from …`
comment. Searches for un-hinted embeds (`alias:profiles(`) and bare `profiles(` inside select
strings both return **zero** results, so nothing is hiding behind a missing FK hint.

### Where the thirteen went — 12 rewritten as nested embeds, 1 as a direct query

```
app/agency/pool/page.tsx:672                                        vendor_org:organizations!vendor_org_id(...)
app/api/projects/route.ts:179                                       vendor_org:organizations!vendor_org_id(...)
app/api/projects/route.ts:432                                       lead_org:organizations!org_id(...)
app/api/projects/[id]/onboarding-packages/route.ts:65               vendor_org:organizations!vendor_org_id(...)
app/api/projects/[id]/onboarding-partners/route.ts:61               vendor_org:organizations!vendor_org_id(...)
app/api/projects/[id]/assignments/route.ts:61                       vendor_org:organizations!vendor_org_id(...)
app/api/projects/[id]/assignments/route.ts:175                      vendor_org:organizations!vendor_org_id(...)
app/api/projects/[id]/onboarding/deploy/route.ts:75                 vendor_org:organizations!vendor_org_id(...)
app/api/agency/active-engagements/route.ts:178                      vendor_org:organizations!vendor_org_id(...)
app/api/agency/projects/[projectId]/status-updates/route.ts:84      vendor_org:organizations!vendor_org_id(...)
app/api/agency/broadcast-rfp/route.ts:186                           vendor_org:organizations!vendor_org_id(...)
app/api/partnerships/route.ts:88                                    vendor_org:organizations!vendor_org_id(ORG_CONTACT_SELECT_RICH)
```

The thirteenth is `app/api/partner/onboarding-packages/route.ts:78`, which the branch closed
**not** as an embed but as a direct
`.from("organizations").select(ORG_CONTACT_SELECT).in("id", agencyIds)` — the same fix in
non-embed form. Its in-file comment labels it "the 15th site, and NEITHER GUARD SEES IT",
and notes four more sites of that shape that are deliberately left open and tracked in
`docs/079-embed-closure-report.md`. Those four are inside the 25 of TASK 3.

---

## TASK 5 — Organization id compared directly to a user id

**READ ONLY. Nothing was changed.**

**188 sites across 59 files** in `app/` and `lib/` compare an organization-scoped identifier
(`org_id`, `lead_org_id`, `vendor_org_id`) directly against a user id (`user.id`,
`session.user.id`) instead of going through the membership helpers.

Every one is correct today, because 079 backfills each organization with its founding user's
uid. Every one returns the wrong rows — silently, at HTTP 200 — the first time a second
member joins an organization, or the first time an organization is created after 079 with a
`gen_random_uuid()` id.

### Method and its limits

A line scanner over every `.ts`/`.tsx` file under `app/` and `lib/`, flagging any
non-comment line containing both an organization-scoped identifier
(`org_id|lead_org_id|vendor_org_id|orgId|leadOrgId|vendorOrgId`) and a user-id expression
(`user.id|user?.id|session.user.id|auth.uid()|user_id`). A second pass looked for the same
pair split across a two-line window and found **0** additional cases, so the single-line
count is the complete inventory for this pattern.

The raw scan returned 189 hits. **One is not a violation**: `lib/entitlements.ts:116`,
`client.from("org_members").select("org_id").eq("user_id", userId)`, which is the body of
`resolveCallerOrgIds` — the membership helper itself, doing the correct lookup. Excluding it
gives **188**.

This is a textual scan, not dataflow analysis. It will not catch a comparison that flows
through an intermediate variable across more than two lines, and it does not distinguish a
read filter from a write payload. The count is a floor, not a ceiling.

### The membership helpers that exist

- `resolveCallerOrgIds(userId, client)` — `lib/entitlements.ts:114`
- `resolveOrgMemberUserIds(...)` — `lib/notifications.ts:41`
- `resolveOrgNotificationRecipients(...)` — `lib/email.ts:325`

Only **14 files** in `app/` and `lib/` import any of them. The migration to the helpers is
real but partial, and several files both import a helper and still carry direct comparisons
elsewhere in the same file — `app/api/agency/rfp-responses/[id]/route.ts` (13 sites),
`app/api/projects/[id]/onboarding-packages/route.ts` (6), and
`app/api/agency/projects/[projectId]/status-updates/route.ts` (3) among them.

### Concentration — top offenders

| Sites | File |
|------:|------|
| 15 | `app/api/partnerships/route.ts` |
| 13 | `app/api/agency/rfp-responses/[id]/route.ts` |
| 10 | `app/api/projects/route.ts` |
| 10 | `app/api/agency/msa/milestones/route.ts` |
| 6 | `app/api/projects/[id]/onboarding-packages/route.ts` |
| 6 | `app/api/projects/[id]/messages/route.ts` |
| 6 | `app/api/projects/[id]/assignments/route.ts` |
| 6 | `app/api/agency/payment-synthesis/route.ts` |
| 6 | `app/api/agency/msa/route.ts` |

Three sites are notable because they are **writes**, not reads — they persist a user id into
an organization column, so the bad value outlives the request:

- `app/agency/pool/[partnerId]/page.tsx:259` — `insert({ lead_org_id: user.id, … })`
- `app/api/partnerships/route.ts:255` — `.update({ vendor_org_id: user.id })`
- `app/auth/callback/route.ts:91` — `.update({ vendor_org_id: user.id, profile_status: "active", … })`

And one passes a user id into a function parameter that expects an organization id:
`app/api/agency/bids/[responseId]/ai-score/route.ts:233` —
`loadVendorTrackRecord(supabase, user.id, response.vendor_org_id, responseId)`.

### Full inventory — file and line

```

app/agency/pool/[partnerId]/page.tsx
    236  .eq("lead_org_id", user.id)
    255  .eq("lead_org_id", user.id).eq("vendor_org_id", partnerId)
    259  await supabase.from("partner_vouches").insert({ lead_org_id: user.id, vendor_org_id: partnerId })

app/agency/pool/page.tsx
    674  .eq('lead_org_id', user.id)

app/api/agency/active-engagements/route.ts
    104  .eq("org_id", user.id)
    341  .eq("lead_org_id", user.id)

app/api/agency/bids/[responseId]/ai-score/route.ts
    163  .eq("lead_org_id", user.id)
    174  .eq("org_id", user.id)
    204  { response_id: responseId, org_id: user.id, status: "in_progress", updated_at: new Date().toISOString() },
    230  .eq("org_id", user.id)
    233  const trackRecord = await loadVendorTrackRecord(supabase, user.id, (response.vendor_org_id as string) || null, responseId)

app/api/agency/bids/[responseId]/decompose/route.ts
     74  .eq("org_id", user.id)
    122  .eq("org_id", user.id)
    168  org_id: user.id,

app/api/agency/bids/compare/route.ts
     56  .eq("lead_org_id", user.id)
     72  .eq("org_id", user.id)
     91  .eq("org_id", user.id)
    143  org_id: user.id,

app/api/agency/bids/rank/route.ts
     48  .eq("lead_org_id", user.id)
    117  .eq("org_id", user.id)

app/api/agency/blob-download/route.ts
     72  if (inboxErr || !inbox || inbox.lead_org_id !== user.id) {
     79  .eq("lead_org_id", user.id)
     96  if (projectErr || !project || project.org_id !== user.id) {
    108  if (tokenErr || !tokenRow || tokenRow.org_id !== user.id) {

app/api/agency/broadcast-rfp/resend-invite/route.ts
     31  .eq("lead_org_id", user.id)
     78  .eq("lead_org_id", user.id)

app/api/agency/broadcast-rfp/route.ts
    188  .eq("lead_org_id", user.id)
    213  lead_org_id: user.id,
    315  .eq("lead_org_id", user.id)
    332  lead_org_id: user.id,
    460  orgId: user.id,

app/api/agency/client-cash-flow/route.ts
     46  .eq("org_id", user.id)
    110  org_id: user.id,
    151  .eq("org_id", user.id)
    181  .eq("org_id", user.id)

app/api/agency/clients/[id]/route.ts
     24  .eq("org_id", user.id)
     85  .eq("org_id", user.id)

app/api/agency/clients/route.ts
     34  .eq("org_id", user.id)
     73  .eq("org_id", user.id)
     91  const insertRow: Record<string, unknown> = { org_id: user.id, name }

app/api/agency/library-documents/[id]/route.ts
     31  .eq("org_id", user.id)
     55  const { error } = await supabase.from("agency_library_documents").delete().eq("id", id).eq("org_id", user.id)

app/api/agency/library-documents/file/route.ts
     23  .eq("org_id", user.id)

app/api/agency/library-documents/route.ts
     99  org_id: user.id,

app/api/agency/msa/ai-schedule/route.ts
    102  .eq("org_id", user.id)
    128  .eq("lead_org_id", user.id)

app/api/agency/msa/milestones/route.ts
     56  .eq("org_id", user.id)
    130  .eq("lead_org_id", user.id)
    158  .eq("lead_org_id", user.id)
    224  .eq("lead_org_id", user.id)
    271  .eq("lead_org_id", user.id)
    296  .eq("org_id", user.id)
    447  .eq("lead_org_id", user.id)
    468  .eq("lead_org_id", user.id)
    522  .eq("org_id", user.id)
    611  .eq("org_id", user.id)

app/api/agency/msa/route.ts
     45  .eq("org_id", user.id)
     65  .eq("lead_org_id", user.id)
    160  .eq("lead_org_id", user.id)
    169  org_id: user.id,
    208  .eq("org_id", user.id)
    237  .eq("org_id", user.id)

app/api/agency/payment-synthesis/route.ts
     90  .eq("org_id", user.id)
     99  .eq("org_id", user.id)
    131  .eq("lead_org_id", user.id)
    144  .eq("lead_org_id", user.id)
    187  .eq("lead_org_id", user.id)
    217  .eq("lead_org_id", user.id)

app/api/agency/pool/[partnerId]/notes/route.ts
    173  .eq("lead_org_id", user.id)

app/api/agency/pool/[partnerId]/route.ts
     49  .eq("lead_org_id", user.id)
    164  .eq("lead_org_id", user.id)
    190  .eq("org_id", user.id)

app/api/agency/pool/client-history/route.ts
     33  .eq("org_id", user.id)
     47  .eq("org_id", user.id)
     62  .eq("org_id", user.id)

app/api/agency/projects/[projectId]/status-updates/route.ts
     39  .eq("org_id", user.id)
    139  .eq("org_id", user.id)
    258  .from("projects").select("id, org_id").eq("id", projectId).eq("org_id", user.id).maybeSingle()

app/api/agency/projects/duplicate/route.ts
     52  .eq("org_id", user.id)
     67  .eq("org_id", user.id)
     77  org_id: user.id,

app/api/agency/rfp-responses/[id]/route.ts
     53  .eq("lead_org_id", user.id)
    185  .eq("lead_org_id", user.id)
    228  .eq("lead_org_id", user.id)
    247  .eq("lead_org_id", user.id)
    356  .eq("lead_org_id", user.id)
    410  .eq("lead_org_id", user.id)
    428  .eq("lead_org_id", user.id)
    460  .eq("lead_org_id", user.id)
    521  orgId: user.id,
    589  .eq("org_id", user.id)
    603  .eq("org_id", user.id)
    680  orgId: user.id,
    771  orgId: user.id,

app/api/agency/rfp-responses/route.ts
     46  supabase.from("partner_rfp_inbox").select("id").eq("lead_org_id", user.id).eq("project_id", projectIdParam),
     50  .eq("org_id", user.id)
     86  .eq("lead_org_id", user.id)
    118  .eq("lead_org_id", user.id)
    205  .eq("lead_org_id", user.id)

app/api/agency/scoring/criteria/[id]/route.ts
     20  .eq("org_id", user.id)

app/api/agency/scoring/templates/route.ts
     46  .eq("org_id", user.id)
     65  .eq("org_id", user.id)
     79  org_id: user.id,

app/api/agency/utilization/route.ts
     98  .eq("lead_org_id", user.id)
    126  .eq("org_id", user.id)

app/api/documents/[id]/route.ts
     59  const isAgency = document.projects.org_id === user.id

app/api/documents/upload/route.ts
     41  const isAgency = project.org_id === user.id
     60  .eq('partnerships.vendor_org_id', user.id)
     74  .eq('partnerships.vendor_org_id', user.id)

app/api/marketplace/discoverable/route.ts
     56  .or(`lead_org_id.eq.${user.id},vendor_org_id.eq.${user.id}`)
     62  const otherId = (p.lead_org_id === user.id ? p.vendor_org_id : p.lead_org_id) as string | null

app/api/partner/blob-download/route.ts
     49  .eq("vendor_org_id", user.id)

app/api/partner/network/[agencyId]/route.ts
     63  .eq("vendor_org_id", user.id)
    168  .eq("vendor_org_id", user.id)

app/api/partner/onboarding/file/route.ts
     59  if (!ship || ship.vendor_org_id !== user.id) {

app/api/partner/onboarding-packages/[id]/route.ts
     44  if (!ship || ship.vendor_org_id !== user.id) {

app/api/partner/onboarding-packages/route.ts
     28  const { data: partnerships } = await supabase.from("partnerships").select("id").eq("vendor_org_id", user.id)

app/api/partner/payments/route.ts
     71  .eq("vendor_org_id", user.id)

app/api/partner/projects/[projectId]/active-engagement/route.ts
     92  .eq("vendor_org_id", user.id)
    198  .eq("vendor_org_id", user.id)

app/api/partner/projects/[projectId]/status-update/route.ts
     75  const { data: partnerships } = await supabase.from("partnerships").select("id").eq("vendor_org_id", user.id)
    126  const { data: partnerships } = await supabase.from("partnerships").select("id").eq("vendor_org_id", user.id)

app/api/partner/rfps/[id]/intent/route.ts
     61  .eq("vendor_org_id", user.id)

app/api/partner/rfps/[id]/nda-notify/route.ts
     47  const ownsByPartnerId = inbox.vendor_org_id === user.id

app/api/partner/rfps/[id]/response/route.ts
    270  vendor_org_id: user.id,
    279  .eq("vendor_org_id", user.id)
    334  vendor_org_id: user.id,

app/api/partner/rfps/[id]/route.ts
     68  .eq("vendor_org_id", user.id)
    112  .eq("vendor_org_id", user.id)

app/api/partner/summary/route.ts
     34  .eq("vendor_org_id", user.id)
     45  .eq("vendor_org_id", user.id)
     53  const { data: pships, error: idsErr } = await supabase.from("partnerships").select("id").eq("vendor_org_id", user.id)

app/api/partnerships/route.ts
     90  .eq('lead_org_id', user.id)
    124  .eq('lead_org_id', user.id)
    144  .eq('org_id', user.id)
    225  .eq('vendor_org_id', user.id)
    255  .update({ vendor_org_id: user.id })
    485  .eq('lead_org_id', user.id)
    579  orgId: user.id,
    612  lead_org_id: user.id,
    694  orgId: user.id,
    767  const isAgency = partnership.lead_org_id === user.id
    768  const isPartner = partnership.vendor_org_id === user.id
    787  .eq('lead_org_id', user.id)
    858  .eq('lead_org_id', user.id)
    908  orgId: user.id,
   1101  if (partnership.lead_org_id !== user.id) {

app/api/projects/[id]/agreements/[agreementId]/route.ts
     69  const isPartner = acting === 'partner' && partnership?.vendor_org_id === user.id
     70  const isAgency = acting === 'agency' && projectRow?.org_id === user.id

app/api/projects/[id]/assignments/route.ts
     45  if (!project || project.org_id !== user.id) {
    119  if (!project || project.org_id !== user.id) {
    133  .eq('lead_org_id', user.id)
    298  const isAgency = assignment.project.org_id === user.id
    299  const isPartner = assignment.partnership.vendor_org_id === user.id
    406  .eq('org_id', user.id)

app/api/projects/[id]/messages/route.ts
     47  .eq('org_id', user.id)
     68  .eq('partnerships.vendor_org_id', user.id)
     79  .eq('partnerships.vendor_org_id', user.id)
    167  .eq('org_id', user.id)
    199  .eq('partnerships.vendor_org_id', user.id)
    211  .eq('partnerships.vendor_org_id', user.id)

app/api/projects/[id]/onboarding/deploy/route.ts
     62  if (!project || project.org_id !== user.id) {
    122  org_id: user.id,

app/api/projects/[id]/onboarding-packages/route.ts
     50  if (!project || project.org_id !== user.id) {
    147  if (!project || project.org_id !== user.id) {
    181  if (!partnership || partnership.lead_org_id !== user.id) {
    216  .eq("lead_org_id", user.id)
    244  .eq("lead_org_id", user.id)
    311  org_id: user.id,

app/api/projects/[id]/onboarding-partners/route.ts
     43  if (!project || project.org_id !== user.id) {
    120  .eq("lead_org_id", user.id)
    136  .eq("lead_org_id", user.id)

app/api/projects/[id]/partner/route.ts
     40  .eq('vendor_org_id', user.id)

app/api/projects/[id]/route.ts
     36  .eq('org_id', user.id)
     99  .eq('org_id', user.id)

app/api/projects/route.ts
    183  .eq('org_id', user.id)
    196  .eq('org_id', user.id)
    224  .eq('lead_org_id', user.id)
    229  .eq('lead_org_id', user.id)
    340  .eq('lead_org_id', user.id)
    345  .eq('lead_org_id', user.id)
    369  .eq('org_id', user.id)
    408  .eq('vendor_org_id', user.id)
    563  .eq("org_id", user.id)
    576  org_id: user.id,

app/auth/callback/route.ts
     91  .update({ vendor_org_id: user.id, profile_status: "active", updated_at: new Date().toISOString() })

app/partner/marketplace/page.tsx
     86  supabase.from("partner_access_requests").select("lead_org_id, status").eq("vendor_org_id", user.id),

app/partner/profile/page.tsx
    266  .eq("vendor_org_id", user.id)
```

---

## Honest verification — executed vs read

### Executed (commands actually run, exit codes observed)

| Command | Exit |
|---------|------|
| `git status` / `git rev-parse` / `git rev-list --left-right --count` | 0 |
| `shasum -a 256` on both 079 files — three times (before, after rebase, after all gates) | 0 |
| `git rebase main` | 0 (no-op) |
| `git log --oneline main..feat/079-org-rename` | 0 |
| `node scripts/check-identity-columns.mjs --guard` | 0 |
| `pnpm identity-columns` | 0 |
| `pnpm policy-audit` | 0 |
| `pnpm policy-audit:guard` | **1** |
| `pnpm lint` | **1** |
| `npx tsc --noEmit` | 0 |
| `pnpm build` | 0 |
| `node scripts/check-embed-targets.mjs --guard` | 0 |
| `node scripts/check-org-id-reads.mjs --guard` | 0 |
| `eslint .` on a `main` worktree (baseline comparison) | **1** |
| `node scripts/audit-policy-snapshot.mjs --guard` on a `main` worktree (baseline) | **1** |
| Custom line scanners for TASK 5 (single-line and two-line window) | 0 |
| Greps for `profiles!`, `alias:profiles(`, `profiles(`, `079-EMBED`, `organizations!` | 0 |

### NOT executed

- **`pnpm verify-rls`** — deliberately skipped. It queries the live database via the service
  role key. Running it would have executed SQL, which was forbidden. **No claim is made
  about whether this gate passes.**
- No SQL was run anywhere. No migration file was opened for editing. Nothing was pushed,
  merged, or deployed. Nothing found in TASK 5 was fixed.
- Preconditions 1 and 2 were taken as given and were **not** re-verified.

### Read, not executed

- The bodies of `verify-rls.mjs`, `check-identity-columns.mjs`, `audit-policy-snapshot.mjs`,
  and `check-org-id-reads.mjs`, to decide which touch the database and to recompute the
  `KNOWN_OPEN` baseline from source rather than trust the summary line.
- The `079-EMBED` comment at `app/api/partner/onboarding-packages/route.ts:78`, to establish
  that the thirteenth site was closed as a direct query rather than an embed.
- The `git diff` of `app/api/projects/[id]/messages/route.ts`, to confirm the two `sender:`
  embeds were untouched.

### Ambiguities, reported rather than resolved by guess

1. **"Every script whose name contains guard, check, audit, lint or verify."** Read against
   `package.json` *script names*, this is `lint`, `verify-rls`, `identity-columns:guard`,
   `policy-audit`, `policy-audit:guard` — but **not** `identity-columns`, whose name contains
   none of those words even though it runs `check-identity-columns.mjs`. Everything in the
   scripts block was run regardless, except `verify-rls`, so the ambiguity does not change
   the result. `check-embed-targets.mjs` and `check-org-id-reads.mjs` are not in
   `package.json` at all and were run because TASK 3 and TASK 4 require them.

2. **"The thirteen PostgREST embeds."** Twelve live nested `organizations!` embeds exist;
   the thirteenth was closed as a direct `.from("organizations")` query, and its own comment
   calls it "the 15th site". The numbering in the branch's comments does not match the
   number thirteen in the task. All thirteen conversions are accounted for and the guards
   are clean, but if "thirteen" was meant to name a specific enumerated list, that list was
   not available to cross-check against and this was verified by exhaustive grep instead.

3. **Two 079 migration filenames exist on `main` with different content.** The digests
   verified this morning match the **branch** copies. This report assumes the branch copies
   are the verified artifacts. If the production dry-run was performed against the `main`
   copies, that assumption is wrong and the gate in TASK 1 proved the wrong thing —
   worth one explicit confirmation before applying.

### What is still outstanding after this report

- `pnpm verify-rls` has no result.
- `policy-audit:guard` flags 53 database-side RLS predicates that still compare to
  `auth.uid()`. These are expected pre-apply and must reach zero **after** 079 is applied.
  That verification has not happened and is not a precondition.
- 25 known-open blind-class sites and 188 org-id-vs-user-id comparisons remain in the code,
  deliberately unfixed. They are correct for single-member organizations and break on the
  second member.
