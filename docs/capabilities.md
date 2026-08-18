# Capability catalogue

**The vocabulary the 079 build consumes. No code in this document.**

Written 2026-08-17, M1 pre-work.

Greg's rulings this encodes:

- **Code checks capabilities, never roles.** The role-to-capability mapping is data, so a
  future settings page is just an editor for it.
- **The sorting principle:** reversible actions are open to any member with a breadcrumb;
  irreversible ones are admin only.

---

## 0. The rule that makes any of this real

**Every capability is enforced server-side, in the route handler, before the write.**

A capability hidden in the interface but unchecked in the route is not a permission. It is a
suggestion. This codebase has already shipped one of those this month:
`docs/admin-security-fix-report.md` records admin surfaces whose only gate was the client
deciding not to render a button, and commit `72b8ed3` ("stop testing the invitee's role when
inviting a vendor") is a second instance of the same class - a check that existed, ran, and
tested the wrong subject.

Three corollaries, all of which the 079 review must apply:

1. **The route is the gate.** If a capability is checked anywhere else, it is not checked.
2. **RLS is not the capability check.** Row level security answers "may this row be
   touched by this organization". It cannot answer "may this *member* award a bid", because
   under the ruled model every member of the organization satisfies the row predicate
   identically. Every table in `docs/policy-rewrite-surface.md` bucket (a) moves from a
   per-user predicate to a per-organization one at 079, and the day that lands is the day
   RLS stops distinguishing an admin from a member. **The capability check must exist in the
   route before that migration runs, not after.**
3. **Reversible does not mean unchecked.** A member-open capability is still verified
   server-side; "open to any member" means the check passes for members, not that there is
   no check.

---

## 1. Naming

`domain.action`, lowercase, dot-separated, underscore inside a segment where a verb needs
two words (`billing.change_plan`). Stable: once a name ships, it is not renamed, because it
is simultaneously a permission key, a milestone event type, and a row in whatever settings
table the future editor writes to.

**Defaults use three roles: `owner`, `admin`, `member`.** Owner is the billing owner, one
per organization. Admin is a delegated administrator. Member is everyone else. Vendor
organizations use the same three.

**Reversible / irreversible** is decided by the ruled test, applied literally: *can a member
of the same organization put things back the way they were, from inside the product, without
help?* Not "is there a database backup". Not "could support fix it". If undoing it requires
Greg, a migration, or a counterparty's cooperation, it is irreversible.

---

## 2. Lead agency capabilities

### 2.1 Vendor pool

| Capability | Gates | Reversible? | Default |
|---|---|---|---|
| `vendor.add` | Adding a vendor to the pool by any route: manual add, spreadsheet import, mailbox scan import, auto-add from a guest bid | Reversible - remove it again | member |
| `vendor.import` | Bulk spreadsheet and mailbox-scan imports specifically. Separate from `vendor.add` because it writes hundreds of rows in one action | Reversible in principle, tedious in practice | member |
| `vendor.invite` | Sending a partnership invitation email to a vendor | **Irreversible** - the email is sent and cannot be unsent | admin |
| `vendor.invite_resend` | Resending an invitation | **Irreversible**, same reason, and it overwrites `invitation_sent_at` | admin |
| `vendor.note_edit` | Editing partnership notes | Reversible | member |
| `vendor.remove` | Deleting a partnership row | **Irreversible** - the row and its history go | admin |
| `vendor.blacklist` | Setting the `{blacklisted}` flag in `partnership_notes` | Reversible - it is a flag | member |
| `vendor.vouch` | Adding or removing this organization's vouch for a vendor | Reversible | member |
| `vendor.performance_view` | Reading a vendor's reliability summary and delivery history | Read - not gated by reversibility | member |

### 2.2 Clients

| Capability | Gates | Reversible? | Default |
|---|---|---|---|
| `client.create` | Creating a client profile | Reversible | member |
| `client.edit` | Editing a client profile | Reversible | member |
| `client.delete` | Deleting a client profile | **Irreversible** | admin |
| `client.document_add` | Adding a document to the client library | Reversible | member |
| `client.document_remove` | Removing one | **Irreversible** - the blob goes with it | admin |
| `client.cash_flow_edit` | Editing client cash flow records | Reversible | member |

### 2.3 Projects

| Capability | Gates | Reversible? | Default |
|---|---|---|---|
| `project.create` | Creating a project. Consumes the organization's project quota | Reversible - archive it | member |
| `project.edit` | Editing name, description, budget, dates | Reversible | member |
| `project.duplicate` | Duplicating a project. Consumes quota | Reversible | member |
| `project.client_change` | Repointing a project at a different client | Reversible, but it rewrites denormalized `client_name` across rows | admin |
| `project.archive` | Archiving. Frees a quota slot | Reversible | member |
| `project.delete` | Hard deletion | **Irreversible** | admin |
| `project.assign_vendor` | Creating a project assignment | Reversible before award | member |

### 2.4 RFP

| Capability | Gates | Reversible? | Default |
|---|---|---|---|
| `rfp.brief_upload` | Uploading a client brief | Reversible | member |
| `rfp.generate` | Running the AI master-brief generation. Consumes an AI analysis from the organization's quota | Reversible - regenerate | member |
| `rfp.regenerate` | Re-running it. Overwrites the previous output and spends quota again | **Partly irreversible** - the previous output is gone | member |
| `rfp.scope_allocate` | Splitting the master RFP into scope items | Reversible before broadcast | member |
| `rfp.broadcast` | **Sending the RFP to vendors.** Emails leave the building | **Irreversible** | admin |
| `rfp.magic_link_send` | Sending a magic-link / guest invitation | **Irreversible** | admin |
| `rfp.deadline_set` | Setting the response deadline | Reversible | member |
| `rfp.deadline_change` | Changing it after broadcast. Vendors have already planned against the old one and the old value is overwritten | **Irreversible** | admin |
| `rfp.close` | Closing an RFP to further bids | Reversible | admin |

### 2.5 Bids

| Capability | Gates | Reversible? | Default |
|---|---|---|---|
| `bid.view` | Reading submitted bids | Read | member |
| `bid.analyze` | Running AI scoring, decomposition, summary or comparison. Consumes AI quota | Reversible | member |
| `bid.analyze_retry` | Re-running any of those. Overwrites the previous analysis | **Partly irreversible** | member |
| `bid.score` | Recording a manual evaluation against scoring criteria | Reversible | member |
| `bid.criteria_edit` | Editing scoring criteria and templates | Reversible | admin |
| `bid.shortlist` | Marking a bid shortlisted. Vendor-visible | Reversible, though the vendor already saw it | member |
| `bid.meeting_request` | Requesting a meeting. Vendor-visible, sends mail | **Irreversible** | member |
| `bid.feedback` | Writing agency feedback a vendor reads | **Irreversible** - it has been read | admin |
| `bid.decline` | Declining a bid with a reason. Vendor-visible, sends mail | **Irreversible** | admin |
| `bid.award` | **Awarding the engagement.** Money and commitment follow | **Irreversible** | admin |

### 2.6 Onboarding and delivery

| Capability | Gates | Reversible? | Default |
|---|---|---|---|
| `onboarding.package_send` | Sending the onboarding package to an awarded vendor | **Irreversible** | admin |
| `onboarding.deploy` | Deploying the onboarding / scheduling kickoff | **Irreversible** | admin |
| `onboarding.document_manage` | Adding or removing onboarding documents before send | Reversible | member |
| `delivery.review_create` | Starting a delivery review | Reversible | member |
| `delivery.review_complete` | Completing it. The vendor may read a completed review | **Irreversible** | admin |
| `status_update.resolve` | Marking a vendor status update resolved | Reversible | member |
| `message.send` | Posting a project message to the vendor | **Irreversible** | member |

### 2.7 Money

| Capability | Gates | Reversible? | Default |
|---|---|---|---|
| `msa.create` | Starting an MSA record | Reversible | admin |
| `msa.confirm` | Confirming the MSA. Already has an actor column, `partnerships.msa_confirmed_by` | **Irreversible** | admin |
| `msa.milestones_set` | Setting payment milestones | Reversible until paid | admin |
| `msa.ai_schedule` | Running the AI payment-schedule generation | Reversible | admin |
| `payment.mark_paid` | Marking a milestone paid. Vendor-visible; it is a financial assertion | **Irreversible** | owner |
| `payment.terms_edit` | Editing the organization's default payment terms | Reversible | admin |
| `payment.synthesis` | Running the AI payment synthesis | Reversible | admin |

### 2.8 Organization, members and billing

**None of these have code today.** There is no organization, no member, and no billing
integration in this repository - no Stripe dependency in `package.json`, and the Enterprise
tier's call to action on `/pricing` is "Contact Sales". They are catalogued because 079
creates the first four and billing creates the rest, and the moment either exists these are
the capabilities that must gate them from the first commit rather than being retrofitted.

| Capability | Gates | Reversible? | Default |
|---|---|---|---|
| `org.edit` | Editing organization name, logo, defaults | Reversible | admin |
| `org.member_invite` | Inviting a colleague. Costs nothing per the ruling | Reversible - revoke the invite | admin |
| `org.member_role_change` | Promoting or demoting a member | Reversible | admin |
| `org.member_revoke` | **Revoking a member's access** | **Irreversible** - their session dies and their in-flight work is orphaned | owner |
| `org.transfer_ownership` | Moving ownership to another member | **Irreversible** without the new owner's cooperation | owner |
| `org.delete` | Deleting the organization | **Irreversible** | owner |
| `billing.view` | Reading plan, usage and invoices | Read | admin |
| `billing.change_plan` | Upgrading or **downgrading** a plan. A downgrade can strand projects above the new limit | **Irreversible** (a downgrade is) | owner |
| `billing.cancel` | **Cancelling the subscription** | **Irreversible** | owner |
| `billing.payment_method_add` | Adding a payment method | Reversible | owner |
| `billing.payment_method_remove` | **Removing a payment method** | **Irreversible** if it is the last one - the next renewal fails | owner |

### 2.9 Platform administration

Distinct from `admin` inside an organization. This is `profiles.is_admin`, the Ligament
staff flag.

| Capability | Gates | Reversible? | Default |
|---|---|---|---|
| `platform.user_flags_edit` | Toggling `is_paid` / `demo_access` on any account | Reversible | platform admin only |
| `platform.grant_access` | Granting agency access to an account | Reversible | platform admin only |
| `platform.user_list` | Reading every account on the platform | Read | platform admin only |

---

## 3. Vendor capabilities

The vendor portal gates real actions and they need the same treatment, because under the
ruled model a vendor company is an organization with members too.

| Capability | Gates | Reversible? | Default |
|---|---|---|---|
| `bid.submit` | Submitting a bid to an agency | **Irreversible** - the agency has it | admin |
| `bid.revise` | Submitting a revised version | **Irreversible** | admin |
| `bid.withdraw` | Withdrawing a bid | **Irreversible** | admin |
| `bid.draft_edit` | Editing a bid before submission | Reversible | member |
| `bid.attachment_upload` | Attaching files to a bid | Reversible before submit | member |
| `rfp.view` | Opening an RFP. Sets `viewed_at`, which the agency sees | **Irreversible** - the agency has been told | member |
| `rfp.intent_set` | Declaring intent to bid or not | Reversible | member |
| `invitation.accept` | Accepting a partnership invitation | **Irreversible** in effect - the agency is notified | admin |
| `invitation.decline` | Declining one | **Irreversible** | admin |
| `nda.acknowledge` | Acknowledging an NDA to unlock RFP detail | **Irreversible** - it is a legal act | admin |
| `msa.acknowledge` | Acknowledging an MSA | **Irreversible** | owner |
| `agreement.sign` | Signing an assignment agreement | **Irreversible** | owner |
| `onboarding.acknowledge` | Acknowledging an onboarding package | **Irreversible** | admin |
| `profile.edit` | Editing the vendor company profile | Reversible | member |
| `profile.publish` | Making the profile discoverable in the marketplace | Reversible - unpublish | admin |
| `profile.rate_info_edit` | Editing rate card / rate information | Reversible | admin |
| `status_update.post` | Posting a project status update. The agency reads it | **Irreversible** | member |
| `payment_terms.request` | Requesting different payment terms | **Irreversible** - it is a negotiating position, already read | admin |
| `document.upload` | Uploading legal or onboarding documents | Reversible | member |
| `document.remove` | Removing one | **Irreversible** | admin |

---

## 4. Irreversible actions currently open to anyone

The brief asks for these to be flagged explicitly. "Open to anyone" is read as: *once 079
makes `agency_id` an organization key, will every member of the organization pass the check
that exists in the route today?*

That framing matters, because most of these routes are not unguarded now - they check
`agency_id = user.id`, which is simultaneously the ownership check and, accidentally, the
only thing standing between one person and the whole capability. The day `agency_id` becomes
`org_id`, that check stops distinguishing anybody and every one of these becomes genuinely
open to every member. **These are not future risks. They are present code with a fuse in it.**

| Capability | Where | What exists today | After 079, with no new check |
|---|---|---|---|
| `vendor.remove` | `app/api/partnerships/route.ts:930` DELETE | Auth check, then `partnership.agency_id !== user.id` → 403. No role check of any kind | Any member deletes any vendor relationship and its history |
| `project.delete` | **no route exists** | Deletion is not implemented server-side. `app/api/projects/[id]/route.ts` exposes GET and PATCH only | The capability must exist before the route does, not after |
| `org.member_revoke` | **no route exists** | No members exist yet | 079 creates this. It is the first genuinely destructive member-facing action in the product |
| `billing.cancel` | **no route exists** | No Stripe dependency, no billing integration, `/pricing` Enterprise CTA is "Contact Sales" | Whoever builds billing must gate it at owner from the first commit |
| `billing.change_plan` | **no route exists** | Same. `usage_tracking.plan_tier` is written by nothing but the carry-forward default in `lib/usage-tracking.ts` | A downgrade strands projects above the new limit and no member should be able to trigger it |
| `billing.payment_method_remove` | **no route exists** | Same | Owner only |
| `bid.award` | `app/api/agency/rfp-responses/[id]/route.ts`, `app/api/projects/[id]/assignments/route.ts` | Ownership only. The route does guard against un-awarding (`existing.status === "awarded"` blocks a change), so the code already knows this transition is one-way | Any member awards an engagement |
| `bid.decline` / `bid.feedback` | `app/api/agency/rfp-responses/[id]/route.ts` | Ownership only. Sends mail to the vendor | Any member declines a vendor and writes feedback in the company's name |
| `rfp.broadcast` | `app/api/agency/broadcast-rfp/route.ts` | Ownership only. Sends mail to every recipient | Any member emails the entire vendor pool |
| `payment.mark_paid` | `app/api/agency/msa/milestones/route.ts` | Ownership only. Vendor-visible financial assertion | Any member tells a vendor they have been paid |
| `client.document_remove` | `app/api/agency/library-documents/[id]/route.ts` DELETE | Ownership only. Deletes the blob | Any member destroys client documents |
| `vendor.vouch` | **`app/agency/pool/[partnerId]/page.tsx:255-260`** | **No route at all.** A browser-side insert and delete straight into `partner_vouches` through the anon-key client, gated only by RLS | Any member vouches in the company's name, and there is no server-side place to put a check because there is no server-side code. This one needs a route before it needs a capability |

---

## 5. Milestone event alignment

Where a capability produces a breadcrumb, the capability name **is** the event type in
`docs/milestone-attribution-map.md`. One vocabulary, so "who may do this" and "who did this"
cannot drift into two spellings.

The pairs, using the `(V)` set from the map as the vendor-visible whitelist:

| Capability | Milestone event | Vendor sees |
|---|---|---|
| `vendor.add` | `vendor.add` | no |
| `vendor.invite` | `vendor.invite` | yes |
| `vendor.invite_resend` | `vendor.invite_resend` | yes |
| `vendor.remove` | `vendor.remove` | no |
| `vendor.blacklist` | `vendor.blacklist` | no |
| `client.create` / `client.edit` | same | no |
| `client.document_add` / `client.document_remove` | same | no |
| `project.create` | `project.create` | no |
| `project.client_change` | `project.client_change` | no |
| `rfp.brief_upload` | `rfp.brief_upload` | no |
| `rfp.generate` / `rfp.regenerate` | same | no |
| `rfp.scope_allocate` | `rfp.scope_allocate` | no |
| `rfp.broadcast` | `rfp.broadcast` | **yes** |
| `rfp.magic_link_send` | `rfp.magic_link_send` | **yes** |
| `rfp.deadline_set` / `rfp.deadline_change` | same | **yes** |
| `bid.analyze` / `bid.analyze_retry` | same | no |
| `bid.score` | `bid.score` | no |
| `bid.shortlist` | `bid.shortlist` | **yes** |
| `bid.meeting_request` | `bid.meeting_request` | **yes** |
| `bid.award` | `bid.award` | **yes** |
| `bid.decline` | `bid.decline` | **yes** |
| `bid.feedback` | `bid.feedback` | **yes** |
| `onboarding.package_send` | `onboarding.package_send` | **yes** |
| `onboarding.deploy` | `onboarding.deploy` | **yes** |
| `delivery.review_complete` | `delivery.review_complete` | no |
| `status_update.resolve` | `status_update.resolve` | **yes** |
| `msa.create` / `msa.milestones_set` | same | no |
| `msa.confirm` | `msa.confirm` | **yes** - ruled 2026-08-17, see below |
| `payment.mark_paid` | `payment.mark_paid` | **yes** |
| `bid.submit` / `bid.revise` | same | **yes** (the agency is the counterparty) |
| `rfp.view` | `rfp.view` | **yes** |
| `invitation.accept` / `invitation.decline` | same | **yes** |
| `nda.acknowledge` | `nda.acknowledge` | **yes** |
| `status_update.post` | `status_update.post` | **yes** |

**`msa.confirm` was ruled vendor-visible on 2026-08-17.** This table previously said no
while `docs/milestone-attribution-map.md` section 2 marked the same milestone with a (V),
and migration 080 followed the whitelist rule and failed closed on the disagreement.
Greg's ruling settles it in favour of the attribution map: confirming a vendor's NDA or MSA
is a fact about that vendor's OWN paperwork, and they already see the resulting state.
Withholding the breadcrumb hid who confirmed it, not whether it was confirmed.
`msa.confirm` is now in `public.vendor_visible_event_types()` in
`supabase/migrations/080_milestone_events.sql`, taking that whitelist from 22 entries to 23.
`msa.create` and `msa.milestones_set` remain not vendor-visible: those are the agency
drafting its own terms, not a fact about the vendor's paperwork.

**`vendor.vouch` deliberately has no milestone event.** Its visibility rule is the inverse of
every other event's - colleague-visible, counterparty-invisible - and modelling it as one
more row on a table governed by a vendor-visible whitelist is how it eventually leaks. See
`docs/milestone-attribution-map.md` section 4.

**Read capabilities produce no events.** `bid.view`, `billing.view`, `vendor.performance_view`
and `platform.user_list` gate reads. The one exception is `rfp.view`, which is an event
because it writes `viewed_at` and the agency is told.

---

## 6. What 079 must not do with this list

- **Do not ship the mapping as a hardcoded switch on role.** It is data. A `role_capabilities`
  table, or a constant that a settings editor can later replace, but shaped as data from the
  first commit. The whole point of the ruling is that the settings page is an editor, not a
  rewrite.
- **Do not treat the defaults in this document as the product's answer.** They are a
  defensible starting point derived mechanically from the reversibility test. Greg overrides
  any of them; that is what a settings page is for.
- **Do not add a capability without a server-side check in the same commit.** See section 0.
- **Do not rename anything here later.** These strings are permission keys and event types at
  the same time.
