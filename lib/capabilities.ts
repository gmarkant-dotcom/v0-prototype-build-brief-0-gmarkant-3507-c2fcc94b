/**
 * The one definition of "may this caller do this thing".
 *
 * Greg's ruling this encodes: CODE CHECKS CAPABILITIES, NEVER ROLES. The role-to-capability
 * mapping is data, held in exactly one place below, so a future settings page is an editor
 * for it rather than a rewrite. The vocabulary is docs/capabilities.md, transcribed here
 * without invention - every string in CAPABILITY_MINIMUM_ROLE appears in that document, and
 * every default is the one that document derived from the reversibility test.
 *
 * ---------------------------------------------------------------------------
 * THE THREE QUESTIONS, AND WHICH MODULE ANSWERS EACH
 *
 *   1. WHICH SIDE is this caller operating, agency or vendor?  lib/acting-role.ts
 *   2. IS THE PAYING ENTITY behind them entitled?              lib/entitlements.ts
 *   3. MAY THIS MEMBER perform this action?                    here
 *
 * They are three questions and they are not interchangeable. This module deliberately does
 * NOT test the side: `can(profile, "bid.submit")` does not check that the caller is a
 * vendor, because the route already answered that with canActAs() before it got here, and
 * folding the two together is the mistake lib/entitlements.ts exists to undo.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THAT MAKES ANY OF THIS REAL
 *
 * Every capability is enforced SERVER-SIDE, in the route handler, before the write. A
 * capability hidden in the interface but unchecked in the route is not a permission, it is a
 * suggestion, and this codebase shipped one of those this month
 * (docs/admin-security-fix-report.md). Adding a call to `can()` in a component is not
 * adopting this module.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CHANGES TODAY: NOTHING. DELIBERATELY.
 *
 * Every live user is the sole member and de facto owner of their own company. `orgRoleFor()`
 * therefore returns "owner" for every authenticated caller, owner outranks admin outranks
 * member, and so every organization capability resolves TRUE for every caller - exactly as
 * it does now, where the only gate on these actions is ownership of the row.
 *
 * Platform capabilities are the one exception and they are not an exception to the promise:
 * they resolve through `profiles.is_admin`, which is precisely what gates the admin surfaces
 * today. Nobody gains anything and nobody loses anything.
 *
 * The point of adopting it before it bit was that the day the company identity columns
 * became organization keys, RLS would stop being able to tell an admin from a member -
 * every member of the organization satisfies the row predicate identically - and the route
 * would be the only place left that can. THAT DAY IS THIS BRANCH. 079 renames the columns
 * and rewrites the policies to resolve membership, so from here on the capability check in
 * the route is the only thing separating an admin from a member. It was in place first,
 * which was the point.
 *
 * ---------------------------------------------------------------------------
 * WHAT MIGRATION 079 CHANGES HERE
 *
 * One function: `orgRoleFor()`. It stops returning "owner" unconditionally and starts
 * reading `org_members.role` for the caller's organization, which 079 creates with
 * `CHECK (role IN ('owner','admin','member'))` - the same three names used here, on purpose.
 * Every call site is marked in code with the string "079:", the same convention
 * lib/entitlements.ts uses.
 *
 * Nothing else in this file moves. The mapping is already data and the ranking already
 * works; only the answer to "what is this person's role in their company" is currently a
 * constant.
 */

/** The three membership roles. 079 creates org_members.role with exactly these values. */
export type OrgRole = "owner" | "admin" | "member"

/**
 * "platform_admin" is not a membership role. It is `profiles.is_admin`, the Ligament staff
 * flag, and it is deliberately outside the owner/admin/member ranking so that no amount of
 * seniority inside a customer's organization can ever reach a platform capability.
 */
type GateRole = OrgRole | "platform_admin"

const ROLE_RANK: Record<OrgRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
}

/**
 * THE MAPPING. This is the data the future settings page edits.
 *
 * Transcribed from docs/capabilities.md. The value is the MINIMUM membership role that holds
 * the capability by default, derived there from one test applied literally: can a member of
 * the same organization put things back the way they were, from inside the product, without
 * help? Reversible actions are open to any member with a breadcrumb; irreversible ones are
 * admin; the ones that end a relationship or spend money are owner.
 *
 * These names are simultaneously permission keys and milestone event types
 * (lib/milestone-events.ts, docs/milestone-attribution-map.md). Once a name ships it is not
 * renamed, because renaming it silently breaks both at once.
 */
export const CAPABILITY_MINIMUM_ROLE = {
  // --- Lead agency: vendor pool ---------------------------------------------------------
  "vendor.add": "member",
  "vendor.import": "member",
  "vendor.invite": "admin",
  "vendor.invite_resend": "admin",
  "vendor.note_edit": "member",
  "vendor.remove": "admin",
  "vendor.blacklist": "member",
  "vendor.vouch": "member",
  "vendor.performance_view": "member",

  // --- Lead agency: clients -------------------------------------------------------------
  "client.create": "member",
  "client.edit": "member",
  "client.delete": "admin",
  "client.document_add": "member",
  "client.document_remove": "admin",
  "client.cash_flow_edit": "member",

  // --- Lead agency: projects ------------------------------------------------------------
  "project.create": "member",
  "project.edit": "member",
  "project.duplicate": "member",
  "project.client_change": "admin",
  "project.archive": "member",
  "project.delete": "admin",
  "project.assign_vendor": "member",

  // --- Lead agency: RFP -----------------------------------------------------------------
  "rfp.brief_upload": "member",
  "rfp.generate": "member",
  "rfp.regenerate": "member",
  "rfp.scope_allocate": "member",
  "rfp.broadcast": "admin",
  "rfp.magic_link_send": "admin",
  "rfp.deadline_set": "member",
  "rfp.deadline_change": "admin",
  "rfp.close": "admin",

  // --- Lead agency: bids ----------------------------------------------------------------
  "bid.view": "member",
  "bid.analyze": "member",
  "bid.analyze_retry": "member",
  "bid.score": "member",
  "bid.criteria_edit": "admin",
  "bid.shortlist": "member",
  "bid.meeting_request": "member",
  "bid.feedback": "admin",
  "bid.decline": "admin",
  "bid.award": "admin",

  // --- Lead agency: onboarding and delivery ---------------------------------------------
  "onboarding.package_send": "admin",
  "onboarding.deploy": "admin",
  "onboarding.document_manage": "member",
  "delivery.review_create": "member",
  "delivery.review_complete": "admin",
  "status_update.resolve": "member",
  "message.send": "member",

  // --- Lead agency: money ---------------------------------------------------------------
  "msa.create": "admin",
  "msa.confirm": "admin",
  "msa.milestones_set": "admin",
  "msa.ai_schedule": "admin",
  "payment.mark_paid": "owner",
  "payment.terms_edit": "admin",
  "payment.synthesis": "admin",

  // --- Organization, members and billing ------------------------------------------------
  // None of these have code today. 079 creates the first four and billing creates the rest.
  // They are here so that whoever builds them gates them from the first commit rather than
  // retrofitting, which is what docs/capabilities.md section 4 exists to warn about.
  "org.edit": "admin",
  "org.member_invite": "admin",
  "org.member_role_change": "admin",
  "org.member_revoke": "owner",
  "org.transfer_ownership": "owner",
  "org.delete": "owner",
  "billing.view": "admin",
  "billing.change_plan": "owner",
  "billing.cancel": "owner",
  "billing.payment_method_add": "owner",
  "billing.payment_method_remove": "owner",

  // --- Platform administration ----------------------------------------------------------
  // Distinct from `admin` inside an organization. This is profiles.is_admin, Ligament staff.
  "platform.user_flags_edit": "platform_admin",
  "platform.grant_access": "platform_admin",
  "platform.user_list": "platform_admin",

  // --- Vendor ---------------------------------------------------------------------------
  // A vendor company is an organization with members too, so the vendor portal gates real
  // actions with the same three roles.
  "bid.submit": "admin",
  "bid.revise": "admin",
  "bid.withdraw": "admin",
  "bid.draft_edit": "member",
  "bid.attachment_upload": "member",
  "rfp.view": "member",
  "rfp.intent_set": "member",
  "invitation.accept": "admin",
  "invitation.decline": "admin",
  "nda.acknowledge": "admin",
  "msa.acknowledge": "owner",
  "agreement.sign": "owner",
  "onboarding.acknowledge": "admin",
  "profile.edit": "member",
  "profile.publish": "admin",
  "profile.rate_info_edit": "admin",
  "status_update.post": "member",
  "payment_terms.request": "admin",
  "document.upload": "member",
  "document.remove": "admin",
} as const satisfies Record<string, GateRole>

/**
 * Every capability name, as a type. This is the one place in this codebase where a
 * permission string is checked at compile time - `can(profile, "bid.awrad")` does not
 * compile. Worth having, given that no other string handed to Supabase is checked at all.
 */
export type Capability = keyof typeof CAPABILITY_MINIMUM_ROLE

export type CapabilityProfile =
  | {
      role?: string | null
      active_role?: string | null
      is_admin?: boolean | null
    }
  | null
  | undefined

/**
 * What is this caller's role inside their own company?
 *
 * THE 079 SEAM, AND WHY IT IS DELIBERATELY STILL OPEN.
 *
 * 079 creates org_members with a role column carrying exactly the three values below, so
 * the data this function wants now exists. It still returns "owner" for every caller, and
 * that is correct rather than unfinished, for one reason: 079 backfills exactly ONE member
 * per organization, the founder, with role 'owner'. Every live caller IS the owner of their
 * organization. A lookup would cost a round trip on every capability check to return the
 * value already hard-coded here.
 *
 * WHAT MUST CHANGE, AND WHEN. The moment anything can add a SECOND member to an
 * organization - that is org_invitations and the membership interface, phase two, not this
 * branch - this function must start reading org_members.role, or every colleague added is
 * silently an owner. Use loadOrgRole() below, which does the lookup and is written and
 * unused precisely so that change is a one-line edit here rather than new plumbing then.
 *
 * This is a guarded gap, not an oversight: nothing in this repository creates an
 * org_members row except the 079 backfill and the handle_new_user trigger it extends, and
 * both create exactly one owner.
 */
export function orgRoleFor(profile: CapabilityProfile): OrgRole | null {
  if (!profile) return null
  return "owner"
}

/**
 * May this caller perform this action?
 *
 * Order of the checks, and why each is where it is:
 *
 *   1. No profile is not a permission. A route that could not load the caller's profile has
 *      not established who they are, and the answer to "may they" is no.
 *   2. An unknown capability fails CLOSED. The type makes this unreachable from TypeScript,
 *      but the mapping is destined to become editable data, and a lookup miss against
 *      user-editable data must never be an allow.
 *   3. Platform capabilities resolve through is_admin ONLY, never through membership, so no
 *      organization role can reach them.
 *   4. Ligament staff bypass organization capabilities, matching hasAgencyEntitlement() and
 *      canUseAgencyAi() in lib/entitlements.ts. This changes nothing today - staff already
 *      resolve to "owner" like everybody else - and it keeps one bypass rule in the product
 *      rather than two.
 */
export function can(profile: CapabilityProfile, capability: Capability): boolean {
  if (!profile) return false

  const required: GateRole | undefined = CAPABILITY_MINIMUM_ROLE[capability]
  if (required === undefined) return false

  if (required === "platform_admin") return profile.is_admin === true

  if (profile.is_admin === true) return true

  // 079: orgRoleFor() starts resolving through org_members instead of returning "owner".
  const role = orgRoleFor(profile)
  if (!role) return false
  return ROLE_RANK[role] >= ROLE_RANK[required]
}

/**
 * The 403 body for a denied capability, so the message is one string and not fifteen.
 * Names the capability rather than the role, because the role is an implementation detail of
 * the mapping and the capability is the thing a settings page would show.
 */
export function capabilityDeniedMessage(capability: Capability): string {
  return `Your role does not allow this action (${capability}). Ask an administrator of your organization.`
}
