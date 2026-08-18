# The colleague invitation flow: design note

**This is a design note, not a specification of shipped behaviour. NONE OF IT IS BUILT.**
Migration 086 creates `org_invitations` with a read policy and no write policies, which is
the deliberate stopping point: the SHAPE of an invitation needs no ruling, and every
TRANSITION below depends on at least one that Greg has not made.

Ruling numbers refer to `docs/m1-phase0-discovery.md` section 0a.

---

## The states

`org_invitations.status`, as migration 086 constrains it.

| State | Meaning | Reached by | Leaves by |
|---|---|---|---|
| `pending` | Sent, not yet acted on, not yet expired | the send | accept, revoke, expiry |
| `accepted` | The invitee joined. An `org_members` row now exists | the accept path | nothing. Terminal |
| `revoked` | The organization withdrew it before it was accepted | an admin action | nothing. Terminal |
| `expired` | `expires_at` passed with no answer | a sweep, or lazily on read | re-invite creates a NEW row |

**There is no `declined` state and that is deliberate.** A colleague who does not want to
join simply does not click, and the invitation expires. Adding a decline button means
storing a person's refusal against a company they have no relationship with, and it buys
nothing the expiry does not. If Greg wants the sender told, that is a notification on
expiry, not a state.

**Expiry is data, not a state transition.** `expires_at` is `NOT NULL` with no default, so
an invitation that never expires cannot be created. The `expired` status is a tidying
convenience; every read path must treat `status = 'pending' AND expires_at <= now()` as
expired regardless of what the column says, because no sweep is guaranteed to have run.
This is the same discipline `partner_rfp_inbox.invite_token_expires_at` already uses in
`app/api/partner/rfps/claim/route.ts`, which checks the timestamp on every claim rather
than trusting a status.

---

## The steps, and what each one is blocked on

### 1. Send

An owner or admin enters an email address and a role on `/agency/settings/team`, which is
where the **Invite colleague** button goes (its exact position is marked in a comment in
`app/agency/settings/team/page.tsx`).

- Server-side: resolve the acting organization with `resolveActingOrgId()`. Never take an
  organization id from the request body.
- Check capability. `can(profile, "org.member_invite")`, which today returns true for
  everybody because `orgRoleFor()` hard-codes `"owner"`.
- Insert `org_invitations` with a random token and an expiry.
- Send the email.

**Blocked on ruling 2** (may an admin invite, or only an owner). The capability map already
says `admin` and nobody has ruled on it. Migration 086 therefore ships **no INSERT policy**
on `org_invitations`, so this step cannot be built without either the ruling or a guess
written into a policy.

**Also blocked on ruling 1** (which roles exist). The role dropdown on this form has to
offer something, and if `admin` is collapsed into `owner` the form has two options rather
than three.

**Also depends on ruling 5** (billing). If a seat costs money, the send is the moment the
bill changes, and the copy on this form has to say so. Today `hasAgencyEntitlement()` reads
`profiles.is_paid` and `organizations` has no entitlement column, so an invited colleague
is **not entitled** unless their own profile says so. Building the send before that is
resolved ships a flow whose last step silently does not work.

### 2. The email

Uses `buildBrandedEmailHtml()` and `siteBaseUrl()` from `lib/email.ts`, wrapped in
try/catch, per the house rule. One new template.

> Subject: `[Person] invited you to join [Company] on Ligament`
> CTA: `Accept invitation` to
> `{siteBaseUrl}/auth/sign-up?org_invite=<token>&email=<address>` for somebody with no
> account, or `{siteBaseUrl}/agency/settings/team?org_invite=<token>` for somebody who
> already has one.

Which of the two is chosen is decided server-side by `hasLigamentAccount()` in
`lib/server/account-existence.ts`, which already exists and already runs with the service
role for exactly this reason: **an agency cannot read most invitees' profiles**, so the
question "does this person already have an account" cannot be answered with a session
client. That is `LIGAMENT_CONTEXT.md`'s consequence 2 and it applies here unchanged.

`/auth/sign-up` and the callback must carry `org_invite` through, the same way they already
carry `invite`, `email`, `nda`, `scope` and `agency`. `middleware.ts` preserves that list by
name, so **`org_invite` has to be added to it** or the parameter is lost on any
unauthenticated redirect. This is a one-line change and it is the single easiest thing in
this flow to forget.

**Blocked on nothing.** The email itself can be written the moment step 1 is unblocked.

### 3. Accept

This is the step with the interesting problem, and it is worth stating plainly:

> **An invitee accepting an invitation is, by definition, not yet a member of the
> organization. So no membership-derived policy can authorize them to read their own
> invitation or to insert their own `org_members` row.**

Every policy 079 wrote resolves through `current_user_org_ids()` or
`current_user_admin_org_ids()`, and the accepting user is in neither set for the target
organization. `org_invitations`' read policy is `current_user_admin_org_ids()`, so the
invitee cannot even see the row naming them.

Two ways through, and they are not equal.

**(a) A `SECURITY DEFINER` function keyed on the token.**
`accept_org_invitation(token text)` runs as its owner, so it bypasses RLS, and it takes the
token as its only argument. It must, inside one transaction: look the token up; refuse
unless `status = 'pending'` and `expires_at > now()`; refuse unless the invitation's email
matches the caller's own `auth.email()`; insert `org_members`; and set `accepted_at`,
`accepted_by`, `status = 'accepted'`.

The email check is the whole security of this design. Without it the function is a bearer
credential: anyone holding a leaked token joins any company. With it, a leaked token is
useless to anybody but the addressee. It is also why the token must be unguessable and why
`expires_at` is `NOT NULL`.

**(b) A service-role route.** Same logic in TypeScript. Simpler to write and to read, and
it puts the authorization for joining a company inside a route rather than inside the
database, which is the opposite direction from everything 079 did. The brief for this run
also forbids adding the service role to routes that do not already use it, which reads as a
standing preference.

**Recommendation: (a).** It keeps the rule where every other rule in this schema lives and
it cannot be bypassed by a second route that forgets a check.

**Blocked on ruling 1** for what role the new member gets (the invitation carries one, but
if the vocabulary changes so does the check), and on **ruling 8** (may a person belong to
two organizations at all). If the answer to 8 is no, this function must additionally refuse
when the caller already has a membership anywhere, and `org_members` should gain
`UNIQUE(user_id)` to enforce it.

### 4. Revoke

An admin withdraws a pending invitation. Sets `status = 'revoked'`. No email: telling
somebody an invitation they may not have read has been withdrawn is noise.

**Blocked on ruling 2** for who may do it. The capability map says `org.member_revoke` is
`owner` while `org.member_invite` is `admin`, an asymmetry nobody has ruled on: it means an
admin can grow the organization but not undo it, including undoing their own mistake.

### 5. Remove a member

Not part of the invitation flow, but it is the other half of the roster and it is where
**the Remove button** goes (position marked in a comment in the roster page).

**Blocked on ruling 3**, and this one is not cosmetic. Today, removing a member deletes the
`org_members` row and **nothing else moves**: `milestone_events.actor_id` and
`partnerships.msa_confirmed_by` keep naming that person, because their `ON DELETE SET NULL`
fires on profile deletion, not on organization removal. That is option (a) by default
rather than by decision. Shipping a Remove button before the ruling ships a default nobody
chose, and it is the one action on the roster that clicking again does not undo.

There is a second question hiding inside it: **what happens to a member who is removed
while their acting organization is that organization?** `lib/acting-org.ts` already answers
it correctly and by construction - membership is re-read on every request, so the next
request finds the stored preference is not in the membership set, logs
`preference-refused`, and fails closed. Nothing needs building for that case; it needs a
sentence in the interface so the person understands what happened.

---

## What has to change outside the new code

| File | Change | Blocked on |
|---|---|---|
| `middleware.ts` | add `org_invite` to the preserved query-param list | nothing |
| `app/auth/callback/route.ts` | carry `org_invite` through the OAuth callback | nothing |
| `lib/capabilities.ts` | replace the body of `orgRoleFor()` with a call to `loadOrgRole()` | ruling 1 |
| `lib/entitlements.ts` | organization-level entitlement | ruling 5 |
| migration | `org_invitations` write policies, and the accept function | rulings 1, 2, 8 |

**The riskiest line in the whole feature is the `orgRoleFor()` one.** It currently returns
`"owner"` for every caller, so all 89 capabilities resolve true and 5 of them are actually
called. Replacing its body turns 89 always-true checks into real ones simultaneously, on
code paths that have never returned false in production. It should be its own change, its
own deploy, and its own rollback, and it should not be bundled with the invitation flow
even though the invitation flow is what makes it necessary.
