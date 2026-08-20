#!/usr/bin/env node
/**
 * THE THIRD BLIND SPOT. A `profiles` row fetched BY AN ORGANIZATION ID.
 *
 * WHY THIS EXISTS
 * ---------------
 * This is the third distinct class of 079 breakage found in three days, and each one was
 * invisible to the tool built to catch the previous one:
 *
 *   1. scripts/check-identity-columns.mjs   matches `\bagency_id\b` / `\bpartner_id\b`.
 *      Catches columns that were not renamed. BLIND to constraint names, because
 *      `partnerships_partner_id_fkey` has no word boundary before `partner_id`.
 *   2. scripts/check-embed-targets.mjs      matches `table!hint(` embeds.
 *      Catches embeds traversing a repointed foreign key. BLIND to a separate query,
 *      because there is no embed hint anywhere in it.
 *   3. this file                            matches a profiles read keyed on an org id:
 *
 *          .from("profiles").select("id, company_name").in("id", <vendor org ids>)
 *
 *      The column name is ALREADY the post-079 one, so guard 1 sees nothing. There is no
 *      `!hint(`, so guard 2 sees nothing. Both report zero and both are correct.
 *
 * WHY IT IS A BUG THAT NOTHING ELSE FINDS. Every organization migration 079 backfills
 * carries its founding user's id (PHASE 2), so an organization id and a user id are the
 * same value for all sixteen live accounts and the query returns exactly what it always
 * did. The PHASE 12 trigger mints `gen_random_uuid()` for every organization created
 * AFTER the migration. From that moment the same query matches no profiles row, returns
 * an empty result at HTTP 200, and the product renders a blank or a placeholder name with
 * no error in any log. 079's own comment on the `organizations` table warns against
 * relying on the id coincidence; this check is the mechanical form of that warning.
 *
 * WHAT THIS CHECKS
 * ----------------
 * Every `.from('profiles')` query in application source that filters on `id` - via
 * `.in('id', ...)` or `.eq('id', ...)` - where an organization-valued identifier appears
 * in the surrounding window. The organization tokens are the three post-079 column names
 * and their camelCase forms:
 *
 *     org_id  lead_org_id  vendor_org_id      orgId  leadOrgId  vendorOrgId
 *     orgIds  leadOrgIds   vendorOrgIds       ...Id / ...Ids suffixes of the above
 *
 * WHAT IT CANNOT DO, STATED PLAINLY. THIS IS THE IMPORTANT PARAGRAPH.
 * -------------------------------------------------------------------
 * This is a PROXIMITY HEURISTIC over source text, not dataflow analysis. It flags a
 * profiles-by-id read that has an organization identifier NEARBY. It therefore:
 *
 *   - MISSES a site where the org id travels far enough from the read to fall outside the
 *     window, is renamed to something with no `org` in it, arrives as a function argument
 *     from another module, or is carried on an object property (`row.partnerId`) whose own
 *     origin is an org column several hops away. app/agency/pool/page.tsx is exactly that
 *     shape and is caught here only because the same file mentions vendor_org_id
 *     elsewhere - which is luck, not detection.
 *   - CANNOT distinguish a correct profiles read that merely sits next to org code. Those
 *     are the allow-list below. Every entry is a claim a human made after reading the code.
 *   - CANNOT see a query built by string concatenation at run time.
 *   - CANNOT tell you whether the fixed query RETURNS ANYTHING. A row that row level
 *     security filters comes back as an empty array at HTTP 200, never as an error. That
 *     question is answerable only from a live authenticated session.
 *
 * A HUMAN MUST STILL INSPECT, and no script replaces this:
 *
 *   1. Every `.from('profiles')` in the repository, once, against the question "where did
 *      this id come from". There are ~209 of them. The ones that matter are the ones whose
 *      id came out of a *_org_id column, and the only reliable way to know is to read the
 *      chain. This check is a net under that reading, not a substitute for it.
 *   2. Every `.eq('<any *_org_id column>', user.id)`. That is the mirror image of this
 *      bug - an ORG column compared to a USER id - and it is the same coincidence in the
 *      opposite direction. scripts/check-identity-columns.mjs does not look at the
 *      right-hand side of a filter, so it does not see these either.
 *
 * =====================================================================
 * CLASS B, ADDED 2026-08-18. THE MIRROR IMAGE, AND WHY IT IS HERE.
 * =====================================================================
 *
 * Everything above describes CLASS A: a PERSON fetched by a COMPANY id. The paragraph
 * headed "A HUMAN MUST STILL INSPECT" ends by naming the mirror of it - a COMPANY column
 * compared to a PERSON id - and says no script looks at the right-hand side of a filter.
 *
 * One now does. That is CLASS B, and it is added here rather than in a fifth script
 * because it is the same coincidence read in the other direction and splitting them
 * across two files would mean two baselines to keep honest instead of one.
 *
 * CLASS B flags an organization column - org_id, lead_org_id, vendor_org_id - that is
 * compared to, or written from, a value that is a USER id. On ANY table, not only
 * profiles, and in WRITES as well as reads:
 *
 *     .eq("org_id", user.id)              a read that returns nothing after 079
 *     row.vendor_org_id === user.id       an authorization guard that denies after 079
 *     { lead_org_id: user.id }            a write that raises 23503 after 079
 *     .or(`org_id.eq.${user.id},...`)     the same, spelled as a PostgREST filter string
 *     row.org_id ?? userId                a fallback that hands a user id to a foreign key
 *
 * WHY THE OLD SCAN BOUNDED ONE CORNER AND NOT THE CLASS. scanFile() below skips every
 * `.from()` that is not `.from('profiles')`, so its 25-site baseline described profiles
 * reads and nothing else. The population it did not look at was measured on 2026-08-18 at
 * 230 sites across 73 files. Neither of the two ghost-claim writes that broke vendor
 * invitation claiming was ever flagged, because neither is a profiles read.
 *
 * WHAT CLASS B STILL CANNOT SEE, STATED AS PLAINLY AS THE PARAGRAPH ABOVE.
 * It is a text matcher over ONE expression. It does not follow a value across a function
 * boundary. Twenty-one exported helpers in lib/ filter or write an organization column
 * from a parameter - loadBidAnalysisContext, fetchScopedLibraryDocuments,
 * markPartnershipInvited, resolvePartnershipForAward, recordMilestone,
 * attachMagicTokenToPartnerInbox, claimAwardedGhostPartnershipsByEmail and others - and
 * whether a call is a defect depends entirely on what the CALLER passes, one stack frame
 * away from anything a line matcher can read. Nineteen call sites in seventeen files pass
 * a user id into one of them. NONE of them is flagged here and none can be. They are
 * listed in docs/079-hardening-report.md. The permanent answer to that is generated
 * database types, not a sixth script; the assessment is in the same report.
 *
 * MODES
 * -----
 *   node scripts/check-org-id-reads.mjs             inventory. Always exits 0.
 *   node scripts/check-org-id-reads.mjs --guard     exits 1 on any NON-allow-listed find.
 *   --json      machine-readable
 *   --all       show allow-listed sites too
 *   --root DIR  scan a different checkout
 *   --class A|B limit the report to one class. Both run by default.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const argv = process.argv.slice(2)
const guard = argv.includes("--guard")
const json = argv.includes("--json")
const showAll = argv.includes("--all")
const rootFlag = argv.indexOf("--root")
const REPO_ROOT =
  rootFlag !== -1 && argv[rootFlag + 1]
    ? resolve(argv[rootFlag + 1])
    : resolve(new URL("..", import.meta.url).pathname)

const ROOTS = ["app", "lib", "components", "contexts", "hooks"]
const EXTENSIONS = [".ts", ".tsx"]
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build"])

/** How many lines above the `id` filter count as "nearby". */
const WINDOW = 40

/**
 * Filter arguments that are a USER id by construction and can never be an organization id.
 * These are the caller reading their own row, which is the single most common profiles
 * query in the codebase and is never this bug. Excluded by ARGUMENT, not by file, so a
 * genuine finding elsewhere in the same file is still reported.
 */
const USER_ID_ARGS = [
  /^user\.id$/,
  /^userId$/,
  /^auth\.uid\(\)$/,
  /^session(\.data)?\.user\.id$/,
  /^targetProfileId$/,
  /^[A-Za-z_$][\w$]*[Uu]serId$/,
  /^[A-Za-z_$][\w$]*\.user_id$/,
]

function isUserIdArg(arg) {
  return USER_ID_ARGS.some((re) => re.test(arg))
}

/**
 * Organization-valued identifiers. The snake_case forms are the post-079 column names;
 * the camelCase forms are what the routes call them once they are in a variable.
 */
const ORG_TOKEN_RE =
  /(^|[^a-zA-Z0-9])(org_id|lead_org_id|vendor_org_id|orgIds?|leadOrgIds?|vendorOrgIds?|callerOrgIds?|OrgIds?)([^a-zA-Z0-9]|$)/

/**
 * VERIFIED-CORRECT profiles reads that sit near organization code.
 *
 * Every entry is a promise that a human read the chain and established that the id
 * reaching `.in('id')` / `.eq('id')` is a USER id and always will be. Adding an entry is
 * a decision, not a way to make the check quiet. Each carries the reason in full, because
 * an allow-list whose entries do not say why is a list nobody can re-audit.
 */
const ALLOWED = [
  {
    file: "lib/email.ts",
    why:
      "resolveOrgNotificationRecipients(). The ids are org_members.user_id - real user ids " +
      "resolved from the organization one line earlier. The single-element [orgId] fallback " +
      "is deliberate, is reached only when org_members is absent (pre-079), logs at warn, " +
      "and is documented at the call site as byte-for-byte today's behaviour.",
  },
  {
    file: "app/agency/settings/team/page.tsx",
    // 160 and 166 since the two 086 banners were deleted and the file header rewritten to
    // say why. Same two reads, same reason; only the line numbers moved.
    lines: [160, 166],
    why:
      "The team roster. Both flagged reads are .in(\"id\", userIds) against profiles where " +
      "userIds comes from org_members.user_id one statement earlier - real user ids, by " +
      "definition, since that column is a foreign key to profiles(id). The NEARBY heuristic " +
      "fires only because the acting organization id is in scope in the same window, which is " +
      "the roster's org_members filter and not the profiles filter. The roster deliberately " +
      "does NOT read the company through profiles: the organization name and its primary " +
      "contact come from a separate organizations select on the line above. BOTH LINES ARE " +
      "SCOPED so that any future profiles read added to this file is a real finding.",
  },
  {
    file: "app/api/agency/dashboard/route.ts",
    // The Recent Activity feed's teammate-name lookup. Line-scoped, so any FUTURE profiles
    // read added to this route is a real finding rather than something this entry quietly
    // covers - the same discipline the roster entry above uses, and it fails closed: if the
    // line shifts, the entry stops matching and the guard fails rather than silently
    // allowing more.
    lines: [357],
    why:
      "teammateIds are milestone_events.actor_id values. That column is a profiles(id) " +
      "FOREIGN KEY, declared as one in supabase/migrations/080_milestone_events.sql, and " +
      "080's own column comment states it in words: \"the acting user, not a company: a " +
      "profiles.id, and 079 did not rename it\". It is nullable only for guest / magic-link " +
      "actors with no account, and the route filters those out before this read. The NEARBY " +
      "heuristic fires because callerOrgIds is in scope in the same 40-line window - that is " +
      "the milestone_events org_id filter, not this profiles filter. The COMPANY names this " +
      "route needs are read from organizations a few lines above, through ORG_CONTACT_SELECT " +
      "and resolveOrgContact(), which is the fix this guard asks for and which is already in " +
      "place for every vendor name in the same feed.",
  },
  {
    file: "app/api/partnerships/route.ts",
    lines: [186],
    why:
      "domain_match_profile_id and notes.matched_profile_id are profiles ids by definition - " +
      "they record WHICH PERSON a magic-link email domain matched. They are not organization " +
      "columns and 079 does not rename them. NOTE the line scoping: the other profiles reads " +
      "in this same file, keyed on partnership.vendor_org_id and partnership.lead_org_id, are " +
      "NOT allow-listed and are real findings.",
  },
]

/**
 * KNOWN OPEN. Sites that ARE this bug, are reported in
 * docs/079-embed-closure-report.md, and are deliberately NOT fixed on this branch.
 *
 * THIS IS NOT AN ALLOW-LIST AND MUST NOT BE READ AS ONE. Every entry below is broken for
 * any organization created after 079 - which is every account that signs up after the
 * release. They are recorded here so that `--guard` can do the one job it can do
 * honestly: fail when the class GROWS. A release-night branch is the wrong place to make
 * twenty-two unreviewed edits to routes nobody asked for; a silent thirty-first instance
 * appearing next week is the thing worth blocking.
 *
 * Keyed on FILE AND COUNT, not on line number, so an unrelated edit that shifts lines
 * does not turn the guard into noise. A file with MORE findings than its recorded count
 * fails. Fixing a site and lowering its count is the intended direction of travel; when a
 * count reaches zero, delete the entry.
 */
const KNOWN_OPEN = [
  { file: "app/api/agency/msa/ai-schedule/route.ts", count: 1 },
  { file: "app/api/agency/msa/milestones/route.ts", count: 1 },
  { file: "app/api/agency/msa/route.ts", count: 1 },
  { file: "app/api/agency/payment-synthesis/route.ts", count: 1 },
  { file: "app/api/agency/pool/[partnerId]/route.ts", count: 2 },
  { file: "app/api/agency/projects/[projectId]/status-updates/route.ts", count: 1 },
  { file: "app/api/agency/rfp-responses/route.ts", count: 1 },
  { file: "app/api/partner/network/[agencyId]/route.ts", count: 1 },
  { file: "app/api/partner/payments/route.ts", count: 1 },
  { file: "app/api/partner/projects/[projectId]/active-engagement/route.ts", count: 1 },
  { file: "app/api/partner/projects/route.ts", count: 1 },
  { file: "app/api/partner/rfps/[id]/route.ts", count: 1 },
  { file: "app/api/partner/rfps/route.ts", count: 1 },
  { file: "app/api/partnerships/route.ts", count: 4 },
  { file: "app/api/projects/[id]/assignments/route.ts", count: 2 },
  { file: "app/api/projects/[id]/partner/route.ts", count: 1 },
  { file: "app/api/rfp/guest/[token]/route.ts", count: 2 },
  { file: "app/partner/profile/page.tsx", count: 1 },
  { file: "lib/magic-token-attach.ts", count: 1 },
]

function isAllowed(file, line) {
  return ALLOWED.find((a) => a.file === file && (!a.lines || a.lines.includes(line)))
}

// =====================================================================
// CLASS B: an ORGANIZATION column compared to, or written from, a USER id.
// =====================================================================

/** The three post-079 organization column names. Nothing else is an organization column. */
const ORG_COL = "(?:lead_org_id|vendor_org_id|org_id)"

/**
 * Values that ARE a user id.
 *
 * Two tiers, and the distinction is reported rather than flattened:
 *
 *   SESSION - the signed-in caller. `.eq("org_id", user.id)` is the caller comparing a
 *             company column to their own person id. This is the bulk of the class and it
 *             is mechanically fixable, because the caller's memberships are resolvable
 *             right there through resolveCallerOrgIds() / resolveCallerWriteOrgId().
 *
 *   PROFILE - a COUNTERPARTY's profiles.id, reached through a lookup: `partner.id`,
 *             `matchedProfile.id`, `existingProfile.id`, `selectedAgency.id`. Same defect,
 *             NOT mechanically fixable: resolving another person to their organization
 *             needs a rule for which of their organizations is meant, and
 *             `organizations.is_lead_agency` / `is_vendor` exist precisely because a
 *             dual-role person will have both. Reported separately so the two are never
 *             confused in a baseline.
 */
const SESSION_USER_SRC =
  "(?:user\\.id|session\\.user\\.id|auth\\.uid\\(\\)|auth\\.user\\.id|userId|authUserId|currentUserId|cachedUserId)"
const PROFILE_ID_SRC =
  "(?:[A-Za-z_$][\\w$]*)?(?:partner|matchedProfile|existingProfile|selectedAgency|agency|vendor|profile)[\\w$]*!?\\??\\.id"

/**
 * PARAM tier. A bare local or parameter whose NAME says person - agencyId, partnerId - fed
 * into an organization column.
 *
 * This tier is SUSPECT, not proven, and it is reported separately for that reason. Inside
 * a lib/ helper `agencyId` is a parameter, and whether the call is a defect depends on
 * what the CALLER passes, which is a stack frame this matcher cannot see. Two of these
 * turned out to be real when the alias resolver above proved the local was `user.id`, and
 * those are reported as SESSION instead. The rest need a human to read the callers.
 *
 * It earns its place despite the noise: it is the only signal that reaches the twenty-one
 * lib/ helpers that filter an organization column from a parameter, and those helpers are
 * where the nineteen indirect call sites in docs/079-hardening-report.md live.
 */
const PARAM_ID_SRC =
  "(?:partnerId|agencyId|vendorId|partnerProfileId|agencyProfileId|matchedProfileId|partnerIdForResolution)"

/**
 * The five shapes. Each carries its own regex and a label used in the report.
 *
 * Deliberately NOT matched: `.select("org_id")`, which names the column without comparing
 * it, and `.eq("user_id", userId)` on org_members, which is the correct resolution and is
 * the one known-good hit the class-A header already talks about.
 */
function classBPatterns(userSrc) {
  return [
    { shape: "FILTER", re: new RegExp(`\\.(?:eq|neq|in|is)\\(\\s*["'\`](?:[\\w]+\\.)?${ORG_COL}["'\`]\\s*,\\s*${userSrc}\\s*[),]`, "g") },
    { shape: "GUARD",  re: new RegExp(`${ORG_COL}\\s*(?:===|!==|==|!=)\\s*${userSrc}`, "g") },
    // The property value is matched up to the next comma or brace rather than anchored to
    // the token, so a ternary - `vendor_org_id: isExistingUser ? existingProfile!.id : null`
    // - is caught as well as a bare assignment.
    { shape: "WRITE",  re: new RegExp(`(?:^|[\\s{,(])${ORG_COL}\\s*:\\s*[^,}\\n]*?${userSrc}`, "gm") },
    { shape: "WRITE",  re: new RegExp(`\\.${ORG_COL}\\s*=(?!=)\\s*[^;\\n]*?${userSrc}`, "g") },
    { shape: "ORSTR",  re: new RegExp(`${ORG_COL}\\.(?:eq|in)\\.\\$\\{\\s*${userSrc}`, "g") },
    { shape: "FALLBK", re: new RegExp(`${ORG_COL}\\s*\\?\\?\\s*${userSrc}`, "g") },
  ]
}

/**
 * KNOWN OPEN for class B. Rebuilt 2026-08-18 from the Tier B sites that survive Phase 3
 * of docs/079-hardening-inventory.md.
 *
 * SAME SEMANTICS AS KNOWN_OPEN ABOVE, AND THE SAME WARNING: this is not an allow-list.
 * Every entry is broken for any organization created after 079. They are recorded so the
 * guard can fail when the class GROWS, and every one carries a one-line reason.
 *
 * Keyed on file and count. MORE than the count fails. FEWER is reported so the count gets
 * lowered rather than left to rot; when a count reaches zero, delete the entry.
 */
const KNOWN_OPEN_MIRROR = [
  {
    file: "app/agency/pool/[partnerId]/page.tsx",
    count: 3,
    tiers: "PARAM",
    why:
      "FALSE POSITIVE, read and established 2026-08-19: partner_vouches vendor_org_id is set from and matched against the [partnerId] route param, and that param is an ORGANIZATION id - every link into /agency/pool/[partnerId] sets it from a vendor_org column (app/agency/pool/page.tsx:460 vendor_org.id||vendor_org_id, :696 req.vendor_org_id, components/bid-detail-sheet.tsx:900 row.vendor_org_id). The entry used to call it a profiles id; that was the baseline claim for this whole route and it was wrong.",
  },
  {
    file: "app/api/agency/active-engagements/route.ts",
    count: 1,
    tiers: "PARAM",
    why:
      "FALSE POSITIVE, read and established: partnerId here is assigned from pship.vendor_org_id, so it is already an organization id.",
  },
  {
    file: "app/api/agency/bids/[responseId]/ai-score/route.ts",
    count: 4,
    tiers: "PARAM",
    why:
      "loadVendorTrackRecord's own parameters. agencyId is passed user.id by the route at :240 - an INDIRECT defect the matcher cannot prove from this file.",
  },
  {
    file: "app/api/agency/broadcast-rfp/route.ts",
    count: 4,
    tiers: "PARAM/PROFILE",
    why:
      "existingProfile.id filtered against and written into vendor_org_id for a manually typed recipient, plus the partnerId local. Needs a counterparty user-to-organization resolver.",
  },
  {
    file: "app/api/agency/email-scan/import/route.ts",
    count: 1,
    tiers: "PARAM",
    why:
      "matchedProfileId written into vendor_org_id on the pool-import path. Same counterparty class.",
  },
  {
    file: "app/api/agency/pool/[partnerId]/notes/route.ts",
    count: 1,
    tiers: "PARAM",
    why:
      "FALSE POSITIVE on the surviving site, same establishment as app/agency/pool/[partnerId]/page.tsx above: the [partnerId] route param is an organization id, not a profiles id. Was 2. The second site was REAL and is fixed - assertActiveAgencyPartnership() matched lead_org_id against user.id, and its agencyOrgIds parameter is now typed readonly OrgId[], so the compiler refuses that substitution.",
  },
  {
    file: "app/api/agency/pool/[partnerId]/performance/route.ts",
    count: 1,
    tiers: "PARAM",
    why:
      "same [partnerId] route param, and by the establishment above it is an organization id - FALSE POSITIVE, not a pending fix.",
  },
  {
    file: "app/api/agency/pool/[partnerId]/route.ts",
    count: 2,
    tiers: "PARAM",
    why:
      "same [partnerId] route param, two sites - FALSE POSITIVE by the same establishment.",
  },
  {
    file: "app/api/partner/network/[agencyId]/route.ts",
    count: 3,
    tiers: "PARAM",
    why:
      "the [agencyId] route param, a profiles id, matched against lead_org_id.",
  },
  {
    file: "app/api/partner/projects/[projectId]/active-engagement/route.ts",
    count: 2,
    tiers: "PARAM",
    why:
      "partnerId and agencyId locals derived from partnership rows. Needs a read of each to separate the two cases.",
  },
  {
    file: "app/api/partner/projects/route.ts",
    count: 2,
    tiers: "PARAM",
    why:
      "lead_org_id written from an agencyId local on the display-shaping path.",
  },
  {
    file: "app/api/partnerships/route.ts",
    count: 2,
    tiers: "PROFILE",
    why:
      "partner.id, a counterparty profiles id, filtered against and then written into vendor_org_id.",
  },
  {
    file: "app/api/projects/[id]/onboarding-packages/route.ts",
    count: 1,
    tiers: "PARAM",
    why:
      "a partnerId local matched against vendor_org_id.",
  },
  {
    file: "app/api/projects/[id]/onboarding-partners/route.ts",
    count: 1,
    tiers: "PARAM",
    why:
      "a partnerId local matched against vendor_org_id.",
  },
  {
    file: "app/api/rfp/guest/[token]/route.ts",
    count: 9,
    tiers: "PARAM/PROFILE",
    why:
      "the guest-bid path. agencyId and matchedProfileId are written into lead_org_id and vendor_org_id in three places, including a ternary at :602. The largest single Tier B surface.",
  },
  {
    file: "app/partner/marketplace/page.tsx",
    count: 4,
    tiers: "PARAM",
    why:
      "agencyId is a profiles id from /api/marketplace/discoverable, written into and matched against lead_org_id. The vendor half IS fixed.",
  },
  {
    file: "app/partner/network/page.tsx",
    count: 4,
    tiers: "PARAM/PROFILE",
    why:
      "selectedAgency.id, same profiles id from the same route, plus one render-time comparison. The vendor half IS fixed.",
  },
  {
    file: "lib/award-partnership-resolution.ts",
    count: 10,
    tiers: "PARAM",
    why:
      "resolvePartnershipForAward's agencyId and partnerIdForResolution parameters, ten sites including four writes. app/api/agency/rfp-responses/[id]/route.ts passes user.id as agencyId - an INDIRECT defect.",
  },
  {
    file: "lib/bid-analysis-context.ts",
    count: 7,
    tiers: "PARAM",
    why:
      "loadBidAnalysisContext / resolveResponseScope agencyId parameter, seven sites. Three routes pass user.id into it.",
  },
  {
    file: "lib/bid-summary-generation.ts",
    count: 1,
    tiers: "PARAM",
    why:
      "generateAndSaveBidSummary agencyId parameter. One caller passes user.id.",
  },
  {
    file: "lib/clients-server.ts",
    count: 1,
    tiers: "PARAM",
    why:
      "reconcileProjectClientFields agencyId parameter. Two callers pass user.id.",
  },
  {
    file: "lib/delivery-review.ts",
    count: 1,
    tiers: "PARAM",
    why:
      "loadBidDeltaComparison agencyId parameter.",
  },
  {
    file: "lib/entitlements.ts",
    count: 1,
    tiers: "SESSION",
    why:
      "agencyEntitlementId returns best?.org_id ?? userId. Deliberate and documented for quota accounting, where failing would take the AI surface down. Recorded because it is the one remaining place a user id can reach a caller expecting an organization id. resolveCallerWriteOrgId is the write-path alternative and returns null.",
  },
  {
    file: "lib/library-documents.ts",
    count: 4,
    tiers: "PARAM",
    why:
      "fetchScopedLibraryDocuments agencyId parameter, four sites. Two routes pass user.id.",
  },
  {
    file: "lib/magic-token-attach.ts",
    count: 3,
    tiers: "PARAM",
    why:
      "attachMagicTokenToPartnerInbox partnerId parameter, three WRITES into vendor_org_id. Two callers pass user.id.",
  },
  {
    file: "lib/partnership-award-claim.ts",
    count: 1,
    tiers: "PARAM",
    why:
      "claimAwardedGhostPartnershipsByEmail partnerId parameter, one WRITE. One of three callers passes a raw user.id.",
  },
  {
    file: "lib/partnership-invitations.ts",
    count: 5,
    tiers: "PARAM",
    why:
      "markPartnershipInvited agencyId and partnerId parameters, including an INSERT of both. resend-invitation passes user.id as agencyId.",
  },
  {
    file: "lib/rfp-evaluation-criteria-server.ts",
    count: 3,
    tiers: "PARAM",
    why:
      "resolveRfpRubricForResponse agencyId parameter. One route passes user.id.",
  },
  {
    file: "lib/usage-tracking.ts",
    count: 4,
    tiers: "PARAM",
    why:
      "getOrCreateMonthlyUsage / getActiveProjectsCount agencyId parameter, including the usage_tracking INSERT. Callers pass agencyEntitlementId(), which is correct except on its fallback.",
  },
  {
    file: "lib/vouch-counts.ts",
    count: 1,
    tiers: "PARAM",
    why:
      "fetchVouchCount partnerId parameter. app/partner/profile/page.tsx passes user.id.",
  },
]

/**
 * ONE LEVEL OF LOCAL ALIASING, RESOLVED.
 *
 * `const agencyId = user.id` followed by `.eq("org_id", agencyId)` is the identical defect
 * spelled through a local, and it is invisible to a matcher that only knows the literal
 * token `user.id`. That spelling is not hypothetical: it is how the defect appears in
 * app/api/agency/dashboard/route.ts and app/api/partner/dashboard/route.ts, and BOTH files
 * were missed by the 188-site measurement of 2026-08-17 AND by the 230-site re-measurement
 * of 2026-08-18, for exactly this reason. This function found them.
 *
 * One level only, and same-file only. It is not dataflow analysis and does not pretend to
 * be: a value that crosses a function boundary is still invisible here, which is the
 * limitation the CLASS B header states at length.
 */
function sessionAliasesIn(text) {
  const names = []
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:user\.id|session\.user\.id|auth\.user\.id|data\.user\.id)\s*(?:[;\n]|$)/g
  let m
  while ((m = re.exec(text)) !== null) names.push(m[1])
  return [...new Set(names)]
}

function scanFileClassB(absPath) {
  const rel = relative(REPO_ROOT, absPath)
  const text = stripComments(readFileSync(absPath, "utf8"))
  const lines = text.split("\n")
  const seen = new Set()
  const findings = []
  const aliases = sessionAliasesIn(text)
  const aliasSrc = aliases.length ? `(?:${aliases.join("|")})` : null
  const tiers = [
    ["SESSION", SESSION_USER_SRC],
    ["PROFILE", PROFILE_ID_SRC],
    ["PARAM", PARAM_ID_SRC],
  ]
  // An alias of the session id is a SESSION finding, not a PARAM one: its origin is known.
  if (aliasSrc) tiers.push(["SESSION", aliasSrc])
  for (const [tier, src] of tiers) {
    for (const { shape, re } of classBPatterns(src)) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(text)) !== null) {
        const lineIdx = text.slice(0, m.index).split("\n").length - 1
        const key = `${lineIdx}:${shape}:${tier}`
        if (seen.has(key)) continue
        seen.add(key)
        findings.push({
          file: rel,
          line: lineIdx + 1,
          shape,
          tier,
          snippet: (lines[lineIdx] || "").trim().slice(0, 90),
        })
      }
    }
  }
  return findings.sort((a, b) => a.line - b.line)
}


function walk(path, out) {
  let stat
  try {
    stat = statSync(path)
  } catch {
    return
  }
  if (stat.isFile()) {
    if (EXTENSIONS.some((ext) => path.endsWith(ext))) out.push(path)
    return
  }
  if (!stat.isDirectory()) return
  for (const entry of readdirSync(path)) {
    if (SKIP_DIRS.has(entry)) continue
    walk(join(path, entry), out)
  }
}

/**
 * Blank comment bodies while preserving line and column positions, so reported line
 * numbers stay true and this file's own prose - which quotes the broken query verbatim -
 * does not flag itself. Same approach as scripts/check-embed-targets.mjs.
 */
function stripComments(text) {
  const out = text.split("")
  let i = 0
  let state = "code"
  while (i < text.length) {
    const c = text[i]
    const n = text[i + 1]
    if (state === "code") {
      if (c === "/" && n === "/") {
        state = "line"
        out[i] = " "
        out[i + 1] = " "
        i += 2
        continue
      }
      if (c === "/" && n === "*") {
        state = "block"
        out[i] = " "
        out[i + 1] = " "
        i += 2
        continue
      }
      if (c === "'") state = "single"
      else if (c === '"') state = "double"
      else if (c === "`") state = "back"
      i++
      continue
    }
    if (state === "line") {
      if (c === "\n") state = "code"
      else out[i] = " "
      i++
      continue
    }
    if (state === "block") {
      if (c === "*" && n === "/") {
        out[i] = " "
        out[i + 1] = " "
        state = "code"
        i += 2
        continue
      }
      if (c !== "\n") out[i] = " "
      i++
      continue
    }
    if (c === "\\") {
      i += 2
      continue
    }
    if ((state === "single" && c === "'") || (state === "double" && c === '"') || (state === "back" && c === "`")) {
      state = "code"
    }
    i++
  }
  return out.join("")
}

const FROM_PROFILES_RE = /\.from\(\s*["'`]profiles["'`]\s*\)/g
/** `.in("id", X)` or `.eq("id", X)` - the two ways a profiles row is fetched by key. */
const ID_FILTER_RE = /\.(in|eq)\(\s*["'`]id["'`]\s*,\s*([^)]*)\)/g

function scanFile(absPath) {
  const rel = relative(REPO_ROOT, absPath)
  const raw = readFileSync(absPath, "utf8")
  const text = stripComments(raw)
  const lines = text.split("\n")

  // Line index of every `.from('profiles')` in this file.
  const profileLines = []
  FROM_PROFILES_RE.lastIndex = 0
  let m
  while ((m = FROM_PROFILES_RE.exec(text)) !== null) {
    profileLines.push(text.slice(0, m.index).split("\n").length - 1)
  }
  if (profileLines.length === 0) return []

  const findings = []
  ID_FILTER_RE.lastIndex = 0
  while ((m = ID_FILTER_RE.exec(text)) !== null) {
    const lineIdx = text.slice(0, m.index).split("\n").length - 1

    // The filter must belong to a profiles query: the nearest preceding `.from(...)` in
    // the file must be `.from('profiles')`, and within a few lines of it.
    const owner = profileLines.filter((l) => l <= lineIdx).pop()
    if (owner === undefined || lineIdx - owner > 8) continue
    const between = lines.slice(owner, lineIdx + 1).join("\n")
    if (/\.from\(\s*["'`](?!profiles["'`])/.test(between.slice(between.indexOf(".from") + 5))) continue

    const arg = m[2].trim()
    if (isUserIdArg(arg)) continue

    // An argument that NAMES an organization column is a finding on its own evidence and
    // does not need the proximity window at all.
    const argIsOrg = ORG_TOKEN_RE.test(` ${arg} `)
    const windowText = lines.slice(Math.max(0, lineIdx - WINDOW), lineIdx + 1).join("\n")
    if (!argIsOrg && !ORG_TOKEN_RE.test(windowText)) continue

    findings.push({
      file: rel,
      line: lineIdx + 1,
      op: m[1],
      arg: arg.slice(0, 60),
      evidence: argIsOrg ? "DIRECT" : "NEARBY",
      allowed: Boolean(isAllowed(rel, lineIdx + 1)),
      why: "a profiles row fetched by an id that an organization column may have supplied",
    })
  }
  return findings
}

function main() {
  const files = []
  for (const root of ROOTS) walk(join(REPO_ROOT, root), files)
  files.sort()

  const all = files.flatMap(scanFile)
  const allowed = all.filter((f) => f.allowed)
  const open = all.filter((f) => !f.allowed)

  // CLASS B: an organization column compared to, or written from, a user id.
  const mirror = files.flatMap(scanFileClassB)
  const mirrorByFile = new Map()
  for (const f of mirror) mirrorByFile.set(f.file, (mirrorByFile.get(f.file) || 0) + 1)
  const mirrorRegressions = []
  for (const [file, count] of mirrorByFile) {
    const known = KNOWN_OPEN_MIRROR.find((k) => k.file === file)
    if (!known) mirrorRegressions.push({ file, count, known: 0 })
    else if (count > known.count) mirrorRegressions.push({ file, count, known: known.count })
  }
  const mirrorFixed = KNOWN_OPEN_MIRROR.filter((k) => (mirrorByFile.get(k.file) || 0) < k.count)

  // Regressions: a file with MORE findings than its recorded known-open count, or any
  // finding in a file that is on neither list at all.
  const countByFile = new Map()
  for (const f of open) countByFile.set(f.file, (countByFile.get(f.file) || 0) + 1)
  const regressions = []
  for (const [file, count] of countByFile) {
    const known = KNOWN_OPEN.find((k) => k.file === file)
    if (!known) {
      regressions.push({ file, count, known: 0 })
    } else if (count > known.count) {
      regressions.push({ file, count, known: known.count })
    }
  }
  const fixed = KNOWN_OPEN.filter((k) => (countByFile.get(k.file) || 0) < k.count)
  const flagged = open
  const shown = showAll ? all : open

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          total: all.length,
          flagged: flagged.length,
          allowed: allowed.length,
          regressions,
          fixed,
          findings: all,
          classB: {
            total: mirror.length,
            regressions: mirrorRegressions,
            fixed: mirrorFixed,
            findings: mirror,
          },
        },
        null,
        2
      ) +
        "\n"
    )
  } else {
    console.log("profiles rows fetched by an id an organization column may have supplied")
    console.log(`Roots: ${ROOTS.join(", ")}`)
    console.log(`Proximity window: ${WINDOW} lines. THIS IS A HEURISTIC - read the header.`)
    console.log(`DIRECT = the filter argument itself names an organization column.`)
    console.log(`NEARBY = an organization identifier appears within the window. Read the chain.`)
    console.log(`Scanned ${files.length} files.`)
    console.log("")
    let lastFile = null
    for (const f of shown) {
      if (f.file !== lastFile) {
        console.log(`  ${f.file}${f.allowed ? "   [ALLOW-LISTED]" : ""}`)
        lastFile = f.file
      }
      console.log(`    ${String(f.line).padStart(5)}  ${f.evidence.padEnd(6)} .${f.op}("id", ${f.arg})`)
    }
    if (shown.length > 0) console.log("")
    console.log("Summary")
    console.log(`  OPEN          ${String(open.length).padStart(5)}  known, reported, deliberately unfixed on this branch`)
    console.log(`  ALLOW-LISTED  ${String(allowed.length).padStart(5)}  read and established to be user ids`)
    console.log(`  REGRESSIONS   ${String(regressions.length).padStart(5)}  files with MORE findings than recorded`)
    console.log(`  IMPROVED      ${String(fixed.length).padStart(5)}  files with FEWER - lower the count in KNOWN_OPEN`)
    console.log("")

    console.log("CLASS B: an ORGANIZATION column compared to, or written from, a USER id")
    console.log("Every table, reads AND writes. SESSION = the caller's own id. PROFILE = a")
    console.log("counterparty's profiles.id, which is the same defect and is NOT mechanically")
    console.log("fixable. See the CLASS B header block.")
    console.log("")
    let lastB = null
    for (const f of mirror) {
      if (f.file !== lastB) {
        console.log(`  ${f.file}`)
        lastB = f.file
      }
      console.log(`    ${String(f.line).padStart(5)}  ${f.shape.padEnd(6)} ${f.tier.padEnd(7)} ${f.snippet}`)
    }
    if (mirror.length > 0) console.log("")
    console.log("Class B summary")
    console.log(`  OPEN          ${String(mirror.length).padStart(5)}  known, reported, deliberately unfixed - see KNOWN_OPEN_MIRROR`)
    console.log(`  REGRESSIONS   ${String(mirrorRegressions.length).padStart(5)}  files with MORE findings than recorded`)
    console.log(`  IMPROVED      ${String(mirrorFixed.length).padStart(5)}  files with FEWER - lower the count in KNOWN_OPEN_MIRROR`)
    console.log("")
  }

  if (guard) {
    if (mirrorFixed.length > 0 && !json) {
      console.log("CLASS B: these files now have FEWER findings than KNOWN_OPEN_MIRROR records.")
      console.log("Lower the count, or delete the entry if it reached zero:")
      for (const k of mirrorFixed) console.log(`  ${k.file}   recorded ${k.count}, found ${mirrorByFile.get(k.file) || 0}`)
      console.log("")
    }
    if (mirrorRegressions.length > 0) {
      if (!json) {
        console.error("ORG-COLUMN-VS-USER-ID GUARD FAILED. NEW instances of class B:")
        console.error("")
        for (const r of mirrorRegressions) {
          console.error(`  ${r.file}   found ${r.count}, KNOWN_OPEN_MIRROR records ${r.known}`)
        }
        console.error("")
        console.error("An organization column above is being compared to, or written from, a USER")
        console.error("id. It is correct today only because migration 079 backfilled every")
        console.error("organization with its founding user's id. The PHASE 12 signup trigger mints")
        console.error("gen_random_uuid(), so from the next account onward a READ returns nothing at")
        console.error("HTTP 200, a GUARD denies a legitimate caller, and a WRITE raises 23503")
        console.error("against organizations(id).")
        console.error("")
        console.error("Fix, and the two halves are NOT interchangeable:")
        console.error("")
        console.error("  READ   const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)")
        console.error('         .in("org_id", callerOrgIds)')
        console.error("")
        console.error("  WRITE  const writeOrgId = await resolveCallerWriteOrgId(user.id, supabase)")
        console.error("         if (!writeOrgId) return 403")
        console.error('         { org_id: writeOrgId }')
        console.error("")
        console.error("NEVER scope a write by current_user_counterparty_org_ids() or")
        console.error("current_user_visible_profile_ids(). Those are VISIBILITY sets, and a vendor")
        console.error("would be able to write into an agency's organization simply by being")
        console.error("partnered with it.")
        console.error("")
        console.error("If the value really is a person, the column is wrong, not the value:")
        console.error("uploaded_by, sender_id, actor_id and user_id are person columns and stay")
        console.error("compared to the user id.")
      }
      process.exit(1)
    }
    if (fixed.length > 0 && !json) {
      console.log("These files now have FEWER findings than KNOWN_OPEN records. Lower the count:")
      for (const k of fixed) console.log(`  ${k.file}   recorded ${k.count}, found ${countByFile.get(k.file) || 0}`)
      console.log("")
    }
    if (regressions.length > 0) {
      if (!json) {
        console.error("ORG-ID-READ GUARD FAILED. NEW instances of the class:")
        console.error("")
        for (const r of regressions) {
          console.error(`  ${r.file}   found ${r.count}, KNOWN_OPEN records ${r.known}`)
        }
        console.error("")
        console.error("A read above may be fetching a PERSON by a COMPANY id. It returns the")
        console.error("right rows today only because every organization 079 backfilled carries its")
        console.error("founding user's id. Organizations created after 079 get gen_random_uuid(),")
        console.error("match nothing, and the result is an empty array at HTTP 200 - no error.")
        console.error("")
        console.error("Fix: read the organization, not the person.")
        console.error("")
        console.error('  .from("organizations").select(ORG_CONTACT_SELECT).in("id", orgIds)')
        console.error("")
        console.error("then resolveOrgContact() from lib/org-contact.ts. The company name is")
        console.error("organizations.name; a person's name or email comes from the designated")
        console.error("primary contact and is NOT a property of the company.")
        console.error("")
        console.error("If the id really is a user id, add the file to ALLOWED in this script WITH")
        console.error("THE REASON. An allow-list entry with no reason is a check nobody can re-audit.")
      }
      process.exit(1)
    }
    if (!json) {
      console.log("ORG-ID-READ GUARD PASSED. No NEW instance of class A OR class B.")
      console.log(`Class B: ${mirror.length} known-open sites, baseline unchanged.`)
      console.log(`${open.length} known-open sites remain. They are NOT fixed - see KNOWN_OPEN above`)
      console.log("and docs/079-embed-closure-report.md. Passing here means the class did not grow.")
    }
  }
}

main()
