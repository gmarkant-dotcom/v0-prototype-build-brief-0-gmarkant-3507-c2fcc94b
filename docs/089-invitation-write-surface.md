# 089 — the invitation write surface, before anything was written

Phase 0 discovery for the colleague-invitation branch (`feat/m1-invitations`,
cut from `main` at `216d1c5`). Everything below was **read** from the working
tree on 2026-08-20. Nothing in this session executed a statement against any
database, and nothing here was taken from a migration file header — file
headers in this repo have been wrong about applied state more than once.

---

## Gate baseline, taken once at Phase 0

Recorded so Phase 7 compares against a measurement rather than against a
number in a document.

| Gate | Command | Exit | Headline numbers |
|---|---|---|---|
| TypeScript | `npx tsc --noEmit` | **0** | no output |
| Build | `pnpm build` | **0** | full route table renders, `/partner/invitations` present as `○` static |
| Lint | `pnpm lint` | **1** | **182 problems — 154 errors, 28 warnings**; 7 warnings auto-fixable |
| RLS verify | `pnpm verify-rls` | **2** | environmental: `pg_class` not exposed through PostgREST |
| Policy audit | `pnpm policy-audit:guard` | **1** | environmental: parsed 104 policies from the 2026-08-13 snapshot, 60 on company-scoped tables, **FLAGGED 53** (44 direct, 9 indirect), 6 allow-listed |
| Identity columns | `pnpm identity-columns:guard` | **0** | 372 files, TOTAL 0 |
| Embed targets | `pnpm embed-targets` | **0** | 372 files, REPOINTED 0, PERSON 0 |
| org-id reads | `pnpm org-id-reads:guard` | **0** | 371 files scanned. **Class B: 61 known-open sites, baseline unchanged. 14 known-open sites remain.** 18 files report `recorded N, found fewer` |

`verify-rls` exit 2 and `policy-audit:guard` exit 1 are both environmental and
expected — they are the pre-existing condition, not a regression.

The 18 drifted-low `org-id-reads` entries are the Phase 6(b) work item. They
are listed verbatim in the session report.

---

## (a) Every reference to `org_invitations` in application source

Command: `grep -rn "org_invitations" app/ lib/ components/ scripts/ contexts/ hooks/`

| File | Line | Operation | Client |
|---|---|---|---|
| `lib/capabilities.ts` | 240 | **comment only** | — |
| `lib/capabilities.ts` | 273 | **comment only** | — |

That is the entire surface. **Two comments. Zero reads, zero writes, zero
Supabase clients.** No route, component, hook or script touches the table.

Both comments say the same thing from different angles: `org_invitations` is
"phase two", and the day something can add a second member to an
organization, `orgRoleFor()` must stop hard-coding `"owner"`. See the
[capability seam](#the-capability-seam-a-real-finding-not-a-guess) below —
this is the single most consequential thing Phase 0 turned up.

For completeness, `org_members` has a real surface (18 files), and it is worth
recording that **nothing in the repository writes it**:

- reads: `lib/entitlements.ts:158,237,439`, `lib/acting-org.ts:147`,
  `lib/capabilities.ts:288`, `lib/email.ts:333`, `lib/notifications.ts:120`,
  `app/agency/settings/team/page.tsx:126`
- writes: **none**. `lib/acting-org.ts:71` states this explicitly and says it
  was verified by grep for insert/update/upsert/delete. Re-verified here: still
  true.

So migration 089's `accept_org_invitation()` will be the **first writer of
`org_members` in the product's history**, and the first thing capable of
producing an organization with two members.

## (b) Does any route create an invitation today?

**No.** Nothing writes `org_invitations`, and nothing could: migration 086
created the table with RLS enabled, exactly one SELECT policy, and no INSERT,
UPDATE or DELETE policy at all. Postgres denies by default, so the table is
read-only to every client role. 086's own header says this was deliberate and
names the open ruling it was waiting on.

Therefore there is **no existing `token` or `expires_at` convention on this
table to match** — 089 and the create route establish it.

The nearest neighbours that do create invitation-shaped rows:

| Path | Token | Expiry |
|---|---|---|
| `app/api/agency/rfp/magic-link/route.ts:197` | `crypto.randomUUID().replace(/-/g,"") + crypto.randomUUID().replace(/-/g,"")` — 64 hex chars | `:200` — `Date.now() + 72h` |
| `app/api/agency/broadcast-rfp/route.ts:366` | `crypto.randomUUID()` — 36 chars with dashes | separate `invite_token_expires_at` |
| `app/api/agency/broadcast-rfp/resend-invite/route.ts:72` | `crypto.randomUUID()` | as above |
| `app/api/agency/email-scan/route.ts:140` | `randomUUID()` from `node:crypto` | none |
| `app/api/auth/{google,microsoft}-email/route.ts:31` | `randomUUID()` nonce | none |

## (c) What `/partner/invitations` actually is — CONFIRMED, do not repurpose

`app/partner/invitations/page.tsx` is **527 bytes**, and its entire body is:

```tsx
export default function PartnerInvitationsPage() {
  redirect("/partner/network")
}
```

It is a redirect stub, and it is **live-linked from four places**, all of them
the vendor/partnership flow and none of them colleague-related:

1. `app/api/partnerships/route.ts:590` and `:723` — the partnership invitation
   email CTA for a recipient who already has an account.
2. `app/api/partnerships/route.ts:591` and `:724` — the same CTA for a
   recipient who does not, wrapped as
   `?next=%2Fpartner%2Finvitations` on the sign-up URL.
3. `app/api/agency/pool/resend-invitation/route.ts:63` — the "connect" resend.
4. `app/auth/callback/route.ts:260` and `:308` — the **post-login default
   destination** for a partner with no explicit `next`.
5. `lib/notifications.ts:318` — the in-app notification link.

**Conclusion: confirmed load-bearing as the vendor partnership CTA.** Reusing
this path for colleague invitations would silently redirect vendors accepting a
partnership into a colleague-invitation surface, and would break the auth
callback's default landing for every partner. Colleague invitations get their
own path. Phase 2 states which.

## (d) What `app/agency/settings/team/` renders today

One file, `page.tsx`, 317 lines, `"use client"`.

**It renders a read-only roster and has no invite affordance of any kind.** The
file says so at length and says why: the header (lines 3–20) states that an
invite button needs Greg's calls 1, 2 and 9, and a remove button needs call 3,
and that neither is rendered. Two placeholder comments mark exactly where each
would go — `:245-249` for the invite button, `:272-276` for the remove column.

What it does render:

- `:111` — acting org via `resolveActingOrgId(user.id, supabase)`; no org id
  is ever accepted as a parameter.
- `:124-127` — parallel read of `organizations(name, primary_contact_user_id)`
  and `org_members(id, user_id, role, created_at)`.
- `:157-176` — profiles fetch with a **deliberate 42703 retry** guarding
  `profiles.title`, kept after 086 was applied because a PostgREST select
  naming a missing column fails the whole query.
- `:190-208` — dedup by membership id, per the house IIFE/`Set` rule.
- `:212-217` — sort owner, admin, member, then join date.
- `:233-239` — no empty or error state during hydration.
- `:252` — subtitle ends "View only for now."
- `:310-313` — footer: "Inviting and removing colleagues is not available yet."

**Roster-of-one:** the page does **not** currently say anything when it sees a
roster of one. The header (`:25-32`) explains that a banner used to and was
removed, for two good reasons — it was unconditional on the row count, so it
asserted something false to all sixteen solo accounts, and it named an internal
migration number in customer-facing copy. The Phase 2 brief asks for a
roster-of-one signal per the 086 precedent. It will be added **conditioned on
`members.length === 1`** and with no migration number in it, which is the
version of that banner both reasons permit.

## (e) Token generation elsewhere — the entropy source 089 must match

Every token in this codebase comes from `crypto.randomUUID()`, in one of two
shapes. The **magic-link shape** is the one that matters, because it is the
only one that is (i) a bearer credential following an emailed link, (ii)
stored in a `text` column, and (iii) doubled for entropy:

```ts
// app/api/agency/rfp/magic-link/route.ts:197
crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")
```

64 lowercase hex characters, 256 bits, URL-safe with no encoding, no dashes to
mangle in an email client. `org_invitations.token` is `TEXT NOT NULL UNIQUE` —
the same column type — so the colleague-invitation create route uses this exact
expression. It is written once in Phase 2 as a named helper rather than copied,
so the two paths cannot drift.

`lib/token-encryption.ts` uses `randomBytes` from `node:crypto`, but only for
an AES IV. It is not a token source and is not a precedent here.

---

## The capability seam — a real finding, not a guess

`lib/capabilities.ts:249` `orgRoleFor()` **returns `"owner"` for every
caller**, unconditionally. The file is explicit that this is correct today and
becomes wrong the moment a second member can exist:

> "The moment anything can add a SECOND member to an organization — that is
> org_invitations and the membership interface, phase two, not this branch —
> this function must start reading org_members.role, or every colleague added
> is silently an owner."  (`lib/capabilities.ts:236-240`)

**Migration 089 is that moment.** The relevant capability entries
(`lib/capabilities.ts:166-178`):

```
"org.member_invite":      "admin",
"org.member_role_change": "admin",
"org.member_revoke":      "owner",
```

Every one of those resolves through `orgRoleFor()`, which returns `"owner"`,
so `can()` returns `true` for every authenticated caller regardless of their
actual `org_members.role`.

**What this does and does not mean.** It does **not** open a data hole: the
database side of Phase 1 is `current_user_admin_org_ids()`, which reads
`org_members.role` for real, so a plain member's INSERT is refused with 42501
whatever the client believed. It **does** mean the UI would offer a plain
member an invite button that fails at the server. That is a bad surface, not a
breach.

`loadOrgRole(userId, orgId, client)` already exists at
`lib/capabilities.ts:281`, written and deliberately unused, precisely so this
is a small change rather than new plumbing.

**Phase 2 will resolve the caller's real role through `loadOrgRole()` in the
new invitation routes and on the team page**, rather than trusting
`orgRoleFor()`. Changing the body of `orgRoleFor()` itself would alter the
result of every capability check in the product in one commit, which is beyond
this brief's scope — it is carried into the session report as a named open
item with the one-line edit spelled out.

---

## What Phase 0 establishes for the phases that follow

1. There is nothing to migrate away from. The invitation write surface is
   empty, so 089 and Phase 2 define it rather than change it.
2. `/partner/invitations` is spoken for. Colleague invitations need their own
   route.
3. The team page has two marked slots waiting for exactly the two affordances
   Phase 2 builds.
4. The token shape is settled: doubled dashless `randomUUID()`, 64 hex chars.
5. `accept_org_invitation()` will be the first writer of `org_members` in the
   product, and the first thing that can produce a two-member organization.
   Everything downstream of `orgRoleFor()` is calibrated on that never having
   happened.
