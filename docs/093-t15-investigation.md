# 093 T15 investigation: the claimer cannot see the row

Branch `fix/093-resume`. Written 2026-10-08. Nothing in this run executed SQL; the one executed
result below was run by the user in the Supabase SQL Editor and pasted into the session.
No test, migration, or other file was edited. Not committed.

Evidence labels used throughout: **EXECUTED** (a result the user ran against the live database),
**READ** (taken from a file in this repo), **RECALLED** (Postgres behaviour I am stating from
knowledge of the docs and source, not verified by any run here).

## 1. Executed evidence

**EXECUTED, user, SQL Editor, 2026-10-08, live database.** With `request.jwt.claims` sub =
`a63260b8-ea6a-42cc-8b94-961f697f0198` and `SET LOCAL ROLE authenticated`:

| Probe | Result |
|---|---|
| `auth.uid()` | `a63260b8-ea6a-42cc-8b94-961f697f0198` (impersonation took) |
| `count(*)` of partnerships where `id = 55ba0c93-d5f3-4b39-9825-b423dc4456eb` | **0** |
| `count(*)` of all partnerships | **0** |

Row state, as reported by the user: `vendor_org_id` NULL, `status` pending, and `lower(btrim())` of
both emails match.

What this establishes: the claimer holds a valid `authenticated` identity, the row exists and is
addressed to them, and a SELECT returns nothing. The SELECT-visibility hypothesis is confirmed.
The impersonation is not the problem, so the LG098 read-back added to T15 is not what is
failing here and would have passed.

What it does not establish: which SELECT policies are live. The all-partnerships count of 0 means
this user passes none of them, which is consistent with 079's two SELECT policies and is not a
read of the live policy list. Query C-sel below would settle that.

## 2. Why this makes T15 unreachable (READ plus RECALLED)

**READ, `supabase/migrations/079_organizations.sql:1469-1485`.** The only SELECT policies on
`partnerships` are:

- "Agencies can view their partnerships": `lead_org_id IN (current_user_org_ids())`
- "Partners can view their partnerships": `vendor_org_id IN (current_user_org_ids())`

An unclaimed row has `vendor_org_id` NULL and the claimer is not in the lead org, so neither admits it.

**READ, `079:1500-1506`.** The claim policy is an UPDATE policy. Its USING is
`vendor_org_id IS NULL AND partner_email ~~* (own profile email)`. It admits the row to the UPDATE
row set, but it grants no SELECT.

**RECALLED, Postgres docs on RLS.** An UPDATE whose WHERE or RETURNING (or a SET expression) reads
existing column values must also pass the table's SELECT policies. A row failing them is dropped
from the target set silently: no error, `ROW_COUNT` 0. T15's statement is
`UPDATE ... WHERE id = v_ghost`, so it reads `id`, so the SELECT policies apply, so the row is
filtered out before the claim policy's WITH CHECK is ever evaluated.

Consequence for T15: the UPDATE matches 0 rows and the test reports
"matched 0 rows, expected 1. 093 BREAKS THE CLAIM PATH. DO NOT APPLY." That message is wrong. 093
does not break it. The claim path never reached the row.

### 2a. The same limit in production code (READ)

`app/auth/callback/route.ts:176-217` (W4) does, as the signed-in vendor:

1. `select id from partnerships where vendor_org_id is null and status in (...) and partner_email ilike <email>`
2. if that returns rows, `update ... where vendor_org_id is null ... and partner_email ilike <email>`

Both name columns, so both are subject to the SELECT policies. If the live policies match 079's,
step 1 returns an empty array with no error, `pending.length === 0`, and the function returns
`{ ok: true }` without attempting a claim. No error is logged and `CLAIM_FAILED_MESSAGE` never
fires. That is the "empty portal with nothing wrong anywhere" failure the function's own comment
describes. **This is a finding about the code on main today, not about 093.** It is inferred from
files plus the one executed result; I have not seen the callback run. The executed 0 above is
exactly what step 1 would see.

Two things I could not establish from files: whether the callback's `supabase` client is the
user's session client or a service-role client at this call site (the grep for admin/service
returned nothing in that file, so I believe it is the session client), and whether production
claims are in fact succeeding some other way, such as through `app/api/partnerships/route.ts`
using a service client. The first is one grep to confirm; the second is a question for the
owner.

### 2b. Two other assertions that pass for the same reason

This is the part that matters for trust in the test. Any assertion whose expected answer is "0 rows"
and whose WHERE names a column is **vacuous** for the claim policy, because 0 is what the SELECT
filter produces regardless of the policy.

- **T14** (`UPDATE ... WHERE vendor_org_id IS NULL`, expects 0). Under the OLD ILIKE policy with a
  `%` email it would also return 0 for this caller, because the caller cannot SELECT any unclaimed
  row. T14 cannot distinguish a live wildcard from a closed one. Its 23514 arm would only fire if
  rows got through. **T14 may have passed before 093 and would pass after; it proves nothing about
  HOLE 1.** READ plus RECALLED; not executed.
- **T16** (`UPDATE ... WHERE id = v_claimed_other`, expects 0). Its subject belongs to a third
  org, which the caller can't SELECT either way. T16 would pass if the claim policy dropped its
  `vendor_org_id IS NULL` term. Same defect.

T13 (structural, reads the policy text) is unaffected and still proves the predicate text changed.
That is the only assertion currently showing HOLE 1 is closed, and it shows the text, not the
behaviour.

## 3. Recommended rewrite of T15

### 3a. The column-free probe, and whether it is sound

Question asked: would an UPDATE whose WHERE references no partnerships columns be governed by the
UPDATE policy alone?

**RECALLED:** yes. The SELECT policies are added to an UPDATE only when the statement needs SELECT
privilege on the table, which happens when any column of the target is read in WHERE, RETURNING or
a SET expression. A statement that reads none (for example `UPDATE partnerships SET vendor_org_id =
<const>, profile_status = 'active', updated_at = now()` with no WHERE, or a WHERE made only of
constants and uncorrelated subqueries) is governed by the UPDATE policies' USING and WITH CHECK
only. This is a version-sensitive detail of the planner; it should be confirmed by running it, not
trusted from this paragraph. Note that system columns such as `ctid` count as column reads, so
`WHERE ctid = ...` does **not** work as a way to target one row.

**Is it a sound probe?** Sound for one question, misleading for another:

- Sound for: "does the claim policy's USING and WITH CHECK admit a claim by this caller?" That is
  the 093 question, and this probe isolates it from SELECT visibility.
- Misleading if read as: "the claim path works in production." Production's statement names
  columns, so it takes the SELECT filter this probe bypasses. A PASS on the probe next to a
  production path that matches 0 rows is exactly the false comfort T15 was written to avoid.
  The probe must therefore never be called "legitimate claim still works" without the paired
  production-shape assertion below.
- Blunt: it cannot target one row, so it updates every unclaimed row the policy admits for that
  caller (possibly several, across leads). That is acceptable inside a rolled-back block, but the
  assertion must compare against an expected count, not `= 1`, and must verify the specific subject
  row afterwards as the table owner (RETURNING reads columns, so it cannot be used under the role).

### 3b. Proposed T15 as three verdicts

Run as the claimer (`v_ghost_claims`, uid read back as already done). `v_expected` is computed as
the table owner, before `SET LOCAL ROLE`, with the policy's own predicate spelled independently:

```sql
-- as owner, before impersonation
SELECT count(*) INTO v_expected
FROM public.partnerships p
JOIN public.profiles pr ON pr.id = v_ghost_uid
WHERE p.vendor_org_id IS NULL
  AND p.partner_email IS NOT NULL
  AND lower(btrim(pr.email)) = lower(btrim(p.partner_email));
```

- **T15a, policy admits the claim (the probe).** As the claimer:
  `UPDATE public.partnerships SET vendor_org_id = v_ghost_org, profile_status = 'active', updated_at = now();`
  (no WHERE, no RETURNING). PASS iff `ROW_COUNT = v_expected` and `v_expected >= 1`. After
  `RESET ROLE`, as owner, confirm `vendor_org_id = v_ghost_org` on `v_ghost` specifically. 23514 from
  087 stays INCONCLUSIVE as today; LG009 stays FAIL. `v_expected = 0` is INCONCLUSIVE.
- **T15b, the production-shaped statement (characterisation).** Savepoint-isolated so T15a's writes
  do not leak: run `UPDATE ... WHERE id = v_ghost` (W4's shape) as the claimer on a state where
  `v_ghost` is still unclaimed. Expected today: **0 rows**. Report it as a labelled
  **KNOWN LIMIT** line, not PASS, and do not count it toward `v_pass`. Its job is to flip loudly
  (to 1) the day a SELECT policy for claimers is added, and to keep the verdict line honest while
  it stands at 0. It must not be able to turn the overall verdict green on its own.
- **T15c, visibility control.** `SELECT count(*) FROM partnerships WHERE id = v_ghost` as the
  claimer, expected 0. This is the executed result above, kept as a permanent assertion so the
  reason T15b reads 0 is stated in the report rather than inferred.

T14 and T16 should get the same treatment (column-free variants, or an owner-side count of what
the policy would admit) or be relabelled as structural-only. That is a separate decision and I have
not made it.

### 3c. The paired run against the pre-093 policy

The test currently applies 093 in Section A (line 237) before any assertion, so no assertion
ever runs against the old policy. To prove the old policy had the same limit, the same three
verdicts need to run **before Section A** and again after, in one transaction (still rolled back):

| Verdict | Before Section A (ILIKE policy) | After Section A (equality policy) |
|---|---|---|
| T15a probe | admits `v_expected` rows | admits `v_expected` rows |
| T15b production shape | 0 rows | 0 rows |
| T15c visibility | 0 | 0 |

If T15b and T15c read 0 on both sides, the limit is a property of the SELECT policies and 093 did not
introduce or change it. If T15a differs between the sides, that difference is the real 093
behaviour change, which for ordinary emails should be nil and for `%`/`_` emails should be the
narrowing. A fourth pair is cheap and is what finally makes HOLE 1 behaviourally testable: with
the caller's profile email set to `%`, T15a before Section A should admit **all** unclaimed rows
(wildcard live) and after should admit **none**. T14 cannot show that today (section 2b).

Implementation note: the pre-093 state can be probed only because the test is a single rolled-back
transaction. The old-policy block must run before the `ALTER POLICY`, with writes undone by a
subtransaction (`BEGIN ... EXCEPTION` block raising a sentinel) so the subject row is still
unclaimed when the post-093 run starts.

### 3d. What I would not do

I would not add a SELECT policy for claimers to make T15 pass. That is a production schema change
that exposes unclaimed rows (other leads' invitations to this email, including `agency_private_notes`
and the guarded columns) to whoever can set a matching email, and it is outside both 093's and
this task's remit. Whether the claim path should be repaired is a ruling for the owner, listed in
section 5.

## 4. Does this change the security claims?

- **093:** No; the claim policy's tightening is unchanged, but its behavioural proof is weaker than the report said, because T14 and T16 are vacuous and T15 cannot reach the row. The only evidence HOLE 1 is closed is T13's structural check until T14 and T15 are rebuilt as above.
- **101:** No; 101's guard is a BEFORE UPDATE trigger on `status` and `accepted_at` for rows the vendor can already see through "Partners can view their partnerships", so the unclaimed-row visibility gap does not touch it, and none of 101's vendor assertions use an unclaimed subject.

## 5. Rulings owed (not decided here)

1. Is the production claim path (W4) in fact matching 0 rows today? Query C-claim below answers
   it from the live database; if production claims are succeeding, there is a service-role path
   I have not found.
2. If W4 is dead, repairing it is a behaviour change with its own security review (section 3d).
3. Whether T14/T16 are rewritten in this branch or relabelled structural-only.
4. Whether the "DO NOT APPLY" text in T15's FAIL arm stays. As it stands it would have told an
   operator not to apply a correct migration. It should at minimum say "or the row is not visible
   to the claimer; see docs/093-t15-investigation.md".

## 6. Read-only queries to run yourself (I have not run them)

```sql
-- C-sel: the live SELECT and UPDATE policies on partnerships.
SELECT policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'partnerships'
ORDER BY cmd, policyname;
-- EXPECTED: SELECT policies are exactly the two in 079:1469-1485. Any third SELECT
-- policy that mentions partner_email changes section 2 and should be sent back to me.

-- C-claim: how many unclaimed rows are addressed to a real profile (read as postgres).
SELECT count(*) AS unclaimed_with_profile
FROM public.partnerships p
JOIN public.profiles pr ON lower(btrim(pr.email)) = lower(btrim(p.partner_email))
WHERE p.vendor_org_id IS NULL;
-- If this is above 0 and W4 has been live since 079, those rows are stuck unclaimed.

-- C-probe: the column-free probe itself, in a transaction you roll back.
BEGIN;
SELECT set_config('request.jwt.claims',
  '{"sub":"a63260b8-ea6a-42cc-8b94-961f697f0198","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
UPDATE public.partnerships SET updated_at = now();   -- no WHERE, no RETURNING
-- read the row count from the editor's status line, then:
ROLLBACK;
-- EXPECTED if section 3a is right: a non-zero count equal to the number of unclaimed rows the
-- policy admits for this caller. If it is 0, the probe is not isolating the policy and
-- section 3 needs rethinking. If rows come back, the ROLLBACK undoes them.
```

Note: C-probe writes inside a rolled-back transaction. It is SQL I'm giving you to run, not SQL I
ran, and it is marked here as a write so you can decide.

---

## 7. Executed evidence, 2026-10-08 (second query): the dead claim path is in production

**EXECUTED, user, Supabase SQL Editor, read-only, 2026-10-08, live database.** Partnerships with
`vendor_org_id` NULL, `status` pending, and `partner_email` equal to an existing profile's email
on `lower(btrim())`: **six**.

| Group | Count | Partnership ids | Account vs invite |
|---|---|---|---|
| A. account created AFTER the invite | 5 | `bb11eb12-14e0-45a8-9bdb-486dc21bb3c2`, `636bb47a-66ff-4257-ab39-e80ff807527e`, `55ba0c93-d5f3-4b39-9825-b423dc4456eb`, `59db6474-eb31-4631-a6fb-fb2c5d6de866`, `94cfd20a-a238-44d5-8852-598e5b64cbd8` | the sign-up claim (W4) should have linked these |
| B. account PREDATES the invite | 1 | `e3d5e1fd-2e4a-44df-baaf-37d682f63e05` | account March 2026, invite July 2026 |

### 7a. Group A is the claim path, dead in production

These five are the rows section 2a predicted: an invitation, then a sign-up with the invited
address, and the row is still unclaimed. With section 1's executed 0 (the claimer cannot SELECT
`55ba0c93`, which is one of the five), W4's lookup returns an empty array and returns `ok: true`
without writing. The user reports this has been live since at least June 2026. Section 2a was an
inference; group A is the production footprint it predicts. It is not a proof that W4 ran for each
of the five, since I have no callback logs, but five rows in the predicted state with a confirmed
invisible-row mechanism is consistent with it.

This is a pre-existing production defect on main. 093 neither causes nor fixes it, and 093's
claim-policy change does not alter it (both policies sit behind the same SELECT filter).

### 7b. Group B is a SEPARATE defect: the invite was created unlinked

`e3d5e1fd` cannot be explained by the claim path. The account existed four months before the
invite, so there was a profile, and an organization, to link at invite time. The INSERT policy
permits it: **READ**, `supabase/migrations/087_partnership_vendor_identity.sql:566-579` admits
`vendor_org_id IS NULL OR org_has_member_with_email(vendor_org_id, partner_email)`. The link was
not made because the writing site did not ask for one. Nothing in the database records which
site wrote the row, so I cannot say which of these did; they are the sites that insert a
partnerships row with a NULL link, with the reason each leaves it NULL (all **READ**):

| Site | Line | Why `vendor_org_id` is NULL although an account may exist |
|---|---|---|
| `lib/server/partner-pool-import.ts` | 246 (match), 299 (`vendor_org_id: null`), inserts at 314 and 325 | It computes `matchedProfileId` (line 246) for the account, uses it only to set a flag and note, and hard-codes `vendor_org_id: null`, `status: "pending"`, `profile_status: "unclaimed"`. Its comment states the intent: activation only via invite then accept. Profile match is `.in("email", ...)`, exact case, so a differently-cased address is not matched at all. |
| `app/api/agency/email-scan/import/route.ts` | 62 (match), 113-124 (`vendor_org_id: null` at 115) | Same shape: `vendor_org_id: null`, `status: "pending"`, with `matchedProfileId` computed above and used only for a note. Comment at 102 says never touch `vendor_org_id` here. |
| `app/api/agency/pool/resend-invitation/route.ts` via `lib/partnership-invitations.ts` | route 96; lib 89-97 | The route calls `markPartnershipInvited` with no `partnerId`; the lib writes `vendor_org_id: partnerId \|\| null`. Reaches the insert only when no row exists for the email. |
| `app/api/partnerships/route.ts` | 516 (lookup), 711 (no-org log), 723 (insert) | The direct invite. It links when `resolveOrgIdForUser` finds an org, but looks the profile up by `.ilike('email', partnerEmail).maybeSingle()` (line 516), so an invitee address containing `_` or `%`, or two profiles matching, gives no link or an error; and a matched profile with no organization is logged and left NULL (line 711). |
| `app/api/rfp/guest/[token]/route.ts` | 134-141 (null at 136) | Case 3 ghost insert: `vendor_org_id: null`. (The insert at 76 links `matchedProfileId`.) |
| `lib/award-partnership-resolution.ts` | 230-232 | Degraded resolver insert, `vendor_org_id: null`. |

The two bulk-import sites (pool import, email scan) are the likeliest, since they set exactly
`status: "pending"` with `vendor_org_id: null` for an address they have just matched to a profile,
and a July invite is consistent with a pool import. That is a reading of the code, not a finding
about row `e3d5e1fd`. The row's `partnership_notes` (the import sites write the match flag there)
would distinguish them: a note containing `already_on_ligament` points to the pool import or the
email scan. That is one read-only SELECT for the owner.

Why it matters beyond the cosmetic: a vendor with an existing account is never prompted to claim,
because W4 only runs at email confirmation of a new sign-up, and even if it ran it is behind the
visibility filter (7a). So a group-B row is invisible to the vendor (their "Partners can view"
policy needs `vendor_org_id`), and nothing will ever link it.

**Not fixed here.** Fixing means either linking at invite time at the import sites (a behaviour
change to what "activation only via invite then accept" means) or a claim mechanism that runs for
existing accounts. Both are rulings.

### 7c. Rulings owed from this section

1. Repair the claim path (7a) and how, given section 3d's warning against a claimer SELECT policy.
2. Whether the import sites should link at insert when an account exists (7b), and if so the
   case-insensitive profile match they need.
3. What to do with the six existing rows. This is a data repair, not part of 093.

### 7d. Addendum: a second claim path with the same defect (READ)

`app/api/partnerships/route.ts:268-338` (GET, partner branch, the "079 GHOST CLAIM" block) is a
second claim path. It reads `partnerships` with `.ilike('partner_email', ...).is('vendor_org_id', null)`
as the vendor's session client, and claims only if that read returns rows. It names columns, so it
sits behind the same SELECT filter and returns an empty array for the same reason. Its error
handling (500 on a failed claim) never fires because there is no error, only no rows. So both
documented claim paths (W4 at `app/auth/callback/route.ts:176-217` and this one) are inert under the
live SELECT policies, if those match 079. That is consistent with group A in 7a. Unless a claim runs
through a client I have not found, nothing links a ghost row to its vendor on the user's side.
