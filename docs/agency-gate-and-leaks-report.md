# Agency gate, hardening and RFP leaks, 2026-10-09

Branch `fix/agency-gate-and-leaks`, cut from `main` at `c988820`. Unattended session. Not pushed, not
merged. This file is updated and committed after each workstream; the final section is the
consolidated report.

## Workstream 0: lockout check

**File:** `supabase/sql-checks/agency-gate-lockout-check.sql`. One read-only `SELECT` (CTEs and
`UNION ALL` only). Not parsed or run: no database access in this session.

It returns `section | severity | subject | detail`:

| Section | What it shows |
|---|---|
| `0 ALERT` | Row 1 is gmarkant@gmail.com: its active organization, `is_lead_agency`, `is_paid`, and **`>>> ALERT: m a r k a n t FAILS G1 - DO NOT MERGE <<<`** if it fails. Row 2 does the same for any org named "m a r k a n t" (spaces ignored). Rows 3-5: who passes G1, who sees the agency product today and loses it, and who has several memberships with no usable `active_org_id` |
| `1 ORG` | Every organization: `is_lead_agency`, `is_vendor`, `is_paid`, member count, member emails with their org role, and whether it passes G1 |
| `2 USER` | Every user: what admits them today (`api_as_is` = role or active_role is agency; `api_via_switch` = switch-role would admit them; `pages` = middleware plus the client wall), and what G1 gives them (agency, or the upgrade screen and 402 with the reason) |
| `3 FLAGS` | Every user with `profiles.is_paid`, `demo_access` or `is_admin` set, and what G1 does to them |
| `4 SWITCH` | Who loses a portal switch once `set_active_role` (113) applies its rule |
| `9 HOWTO` | The existing route and SQL to set the flags. Not performed |

**Finding: `profiles.is_paid` and `demo_access`.**

- `profiles.is_paid` admits nobody to the agency side on `main` already. 092 copied it to
  `organizations.is_paid` (`092_org_entitlement.sql:607-616`) and moved every gate there. Its only
  remaining reader is `canUploadVendorFiles` (`lib/entitlements.ts:726-730`), on the vendor side. G1
  changes nothing for it.
- `profiles.demo_access` is read only by the demo-host branch of `middleware.ts:70-81` and by
  `PaidUserContext`. The demo-host page branch is unchanged. Agency **API** routes on the demo host now
  return 402 unless that deployment sets `NEXT_PUBLIC_IS_DEMO=true` (the `isDemoDeployment()` bypass is
  kept). A `Host` header is client-controlled, so the API gate does not exempt by hostname.
- `profiles.is_admin` **is** a live path today: it bypasses the client wall
  (`components/agency-subscription-gate.tsx:83`) and `resolveAgencyEntitlement`
  (`lib/entitlements.ts:517`). G1, as ruled, does not honour it, so an admin whose active organization
  is not lead and paid loses the agency side. `/admin` and `/api/admin/*` are unaffected. Section 3
  lists each such admin.

**How a human sets the flags (not performed):**

- `organizations.is_paid`: as a platform admin, `/admin/users`, toggle Paid on a member. That is
  `PATCH /api/admin/users/<userId>/flags {"is_paid": true}`
  (`app/api/admin/users/[userId]/flags/route.ts:157-161`, service role). Alternative: the signed magic
  link `GET /api/admin/grant-access` (`app/api/admin/grant-access/route.ts:191-195`). Or SQL Editor:
  `UPDATE public.organizations SET is_paid = true, updated_at = now() WHERE id = '<org id>';`
- `organizations.is_lead_agency`: **no application route writes it.** Only 079's backfill and
  `handle_new_user` do. SQL Editor as `postgres`:
  `UPDATE public.organizations SET is_lead_agency = true, updated_at = now() WHERE id = '<org id>';`
  092's guard (`organizations_guard_columns`) exempts it because `auth.uid()` is NULL there.

**What you must confirm before merging:** section 0 row 1 reads `OK`; section 0 row 4 lists only
accounts you intend to lock out; section 4 lists only accounts that may lose a portal switch.
