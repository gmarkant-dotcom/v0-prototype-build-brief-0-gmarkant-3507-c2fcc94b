# Post-093 cleanup: report (DRAFT SECTION, completed in phase 5)

This file is created in phase 4 to hold the backfill verification queries (4e). Phase 5 replaces this
heading and adds the rest of the report above them.

---

## 4e. BACKFILL AND STATE VERIFICATION QUERIES. NONE OF THESE HAS BEEN RUN.

I have no database credentials and ran no SQL. Every query below is a checklist item, read-only, to be run
by a person in the Supabase SQL Editor as the table owner (RLS does not apply to the owner, so these see
all rows, which is what a verification wants). **Expected values are predictions, not observations.**

### Q1. The four backfilled rows resolve to an organization name through the join the agency pool uses

The pool reads `partnerships` with the embed `vendor_org:organizations!vendor_org_id(...)`
(`app/agency/pool/page.tsx:798`) and takes the contact from the organization's primary contact
(`lib/org-contact.ts:117`). This reproduces that join, not a simplification of it.

```sql
SELECT p.id,
       p.lead_org_id,
       p.status,
       p.profile_status,
       p.vendor_org_id,
       (o.id IS NOT NULL)                  AS org_resolves,
       o.name                              AS org_name,
       pc.email                            AS primary_contact_email,
       p.partner_email
FROM public.partnerships p
LEFT JOIN public.organizations o  ON o.id  = p.vendor_org_id
LEFT JOIN public.profiles      pc ON pc.id = o.primary_contact_user_id
WHERE o.name ILIKE ANY (ARRAY['%caro creative%', '%cresce%', '%liwag%', '%fredsqueo%'])
   OR p.company_name ILIKE ANY (ARRAY['%caro creative%', '%cresce%', '%liwag%', '%fredsqueo%'])
ORDER BY o.name;
```

**EXPECTED:** four rows (more if an organization of the same name has other partnerships; match them to
`partner_email`); every one with `org_resolves = true`, a non-null `org_name`, `status = 'pending'`, and a
`primary_contact_email` whose lower/btrim form equals that of `partner_email` (the 087 invariant).
`status` must still be `'pending'`: the link was repaired, nothing was accepted. A row with
`org_resolves = false` or a NULL `org_name` is the failure this query exists to catch: the agency pool
would render it with no name.

### Q2. No partnership row points at an organization that does not exist

```sql
SELECT count(*) AS dangling_vendor_org_ids
FROM public.partnerships p
WHERE p.vendor_org_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p.vendor_org_id);
```

**EXPECTED: 0.** And confirm the constraint that should make a nonzero impossible:

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.partnerships'::regclass AND contype = 'f' AND conname ILIKE '%vendor%';
```

**EXPECTED:** a foreign key from `vendor_org_id` to `organizations(id)`. If it is absent, Q2's zero is only
a snapshot and a hand backfill can create a dangling id.

### Q3. Unclaimed rows that have a matching profile: only the two deliberate exclusions remain

```sql
SELECT p.id, p.lead_org_id, p.partner_email, p.status, p.created_at,
       pr.id AS matching_profile_id,
       EXISTS (SELECT 1 FROM public.org_members m WHERE m.user_id = pr.id) AS profile_has_org
FROM public.partnerships p
JOIN public.profiles pr
  ON pr.email IS NOT NULL
 AND p.partner_email IS NOT NULL
 AND lower(btrim(pr.email)) = lower(btrim(p.partner_email))
WHERE p.vendor_org_id IS NULL
ORDER BY p.created_at;
```

**EXPECTED: exactly two rows**, the two the brief calls deliberate consent-rule exclusions. Which two
is not recorded in this repository; write down their ids on the first run and compare on every later one.
More than two means a stranded row is back; fewer than two means someone linked an excluded row. Rows
whose `profile_has_org` is false cannot be backfilled at all until the account has an organization.

### Q4. The applied 093 matches the repository (the ARRAY patch and the equality policy)

```sql
SELECT pg_get_functiondef(p.oid) LIKE '%ARRAY[''profile_status'']%' AS has_array_patch,
       pg_get_functiondef(p.oid) LIKE '%v_vendor_permitted%'          AS has_permit_list
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'partnerships_guard_identity_columns';

SELECT qual LIKE '%btrim%' AS uses_btrim, qual LIKE '%~~*%' AS still_ilike
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'partnerships'
  AND policyname = 'Partners can claim partnership by email';

SELECT count(*) AS n_policies FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partnerships';
```

**EXPECTED:** `has_array_patch = true`, `has_permit_list = true`; `uses_btrim = true`, `still_ilike = false`;
`n_policies = 6`. A `has_array_patch = false` means the applied function is NOT the repository's, which
would make every claim write raise 22P02.

### Q5. The two-owner-side checks that tell a stranded claim from a healthy one (recurring)

```sql
-- stranded: an unclaimed row whose addressee has an account AND an organization (backfillable now)
SELECT count(*) FROM public.partnerships p
JOIN public.profiles pr ON lower(btrim(pr.email)) = lower(btrim(p.partner_email))
WHERE p.vendor_org_id IS NULL
  AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.user_id = pr.id);
```

**EXPECTED: 2** (the exclusions, if both have an organization). Run it on a cadence until Ruling 1 in
`docs/claim-visibility-rulings.md` is answered.
