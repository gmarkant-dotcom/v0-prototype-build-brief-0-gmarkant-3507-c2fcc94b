import { resolveActingOrgId, type ActingOrgLookupClient } from "@/lib/acting-org"
import type { OrgId } from "@/lib/entitlements"

/**
 * The one place organizations.name and profiles.company_name are reconciled.
 *
 * THE RULING: the company name belongs to the ORGANIZATION. organizations.name is
 * authoritative, profiles.company_name is a mirror of it, and the two may never disagree.
 * Setting the name sets both, in that order, or neither.
 *
 * Why this exists, and why it is PREVENTIVE rather than a repair. Before this file,
 * organizations.name had NO WRITE PATH ANYWHERE IN THE CODEBASE. Both settings forms wrote
 * profiles.company_name and nothing else; every counterparty surface - all thirteen embeds
 * in lib/org-contact.ts - reads organizations.name. So the value a vendor saw for a lead
 * agency, and the value that agency edited in its own settings, were two different columns
 * with no connection between them. They agree today only because 079's PHASE 2 backfill
 * seeded organizations.name FROM profiles.company_name and nobody has renamed a company
 * since. The first rename would have diverged them silently and permanently, on the
 * counterparty-facing side, with no error anywhere.
 *
 * WHY organizations.name WINS, argued rather than asserted:
 *
 *   1. It is the org model's own column. After 079 a company IS an organizations row and a
 *      profile is a PERSON. A person's row carrying the company's name is a category error
 *      that only survives while a company has exactly one member - the same assumption
 *      lib/acting-org.ts exists to stop relying on.
 *   2. It is the only one counterparties can read. The profiles SELECT policy limits a
 *      caller to their own row, is_discoverable rows, and partnership-linked rows;
 *      organizations has a dedicated counterparty SELECT policy sharing one predicate with
 *      it (current_user_counterparty_org_ids()). profiles.company_name therefore CANNOT
 *      serve the cross-company read even in principle.
 *   3. It is NOT NULL, with a fallback chain already committed in 079 PHASE 2 and in the
 *      PHASE 12 trigger. profiles.company_name is nullable and both forms write null on an
 *      empty field, so the mirror has a state the authority does not.
 *   4. Multi-member has one answer here and none there. When colleague invitations ship,
 *      N members each carry a private copy of the company name in their own profile row and
 *      there is no principled way to pick one. organizations.name has exactly one row.
 *
 * profiles.company_name is MIRRORED, NOT RETIRED. Retiring it outright is a separate
 * migration with real blockers - see the report - the largest being that PostgREST fails a
 * whole statement with 42703 for one unknown column, so dropping it breaks roughly
 * twenty-five profiles select lists at once, in production.
 *
 * NOT a database CHECK and not a trigger, for the same reason stated at length in
 * lib/clients-server.ts: the invariant is enforced at the one write path, where the caller
 * can be told what happened, rather than in the database, where the failure arrives as an
 * opaque constraint violation on a statement that names only one of the two tables.
 *
 * ---------------------------------------------------------------------------
 * HOW THIS DIFFERS FROM ITS PRECEDENT, DELIBERATELY.
 *
 * reconcileProjectClientFields() computes fields and hands them back for the caller to
 * persist, because client_id and client_name live on ONE row of ONE table and a caller
 * cannot persist half of them. Here the two fields live on two different tables, so a
 * function that only returned values would leave the second write to the caller and the
 * invariant would be back to discipline. So this function DOES THE WRITING - both of them,
 * including the caller's other profile columns, which is why it takes a profilePatch.
 *
 * ORDER, AND WHAT A PARTIAL FAILURE LEAVES BEHIND. organizations.name is written FIRST. If
 * it fails, nothing else is attempted and the mirror keeps its old value: the two columns
 * still agree. If it succeeds and the profiles write fails, the AUTHORITATIVE and
 * counterparty-facing value is correct and only the mirror lags, which a retry converges.
 * The reverse order would leave every counterparty reading a stale name while the owner's
 * own settings page showed the new one - the exact failure this file prevents.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY UPDATE HERE CARRIES A .select().
 *
 * A PostgREST update whose WHERE clause matches no row - because row level security
 * filtered it - returns HTTP 200 with no error. LIGAMENT_CONTEXT.md records this costing
 * the admin panel a whole feature. The organizations UPDATE policy is "Org admins update
 * their organization", keyed on current_user_admin_org_ids(), which is role IN
 * ('owner','admin'). Every live account is the sole owner of its one organization, so this
 * matches today; a plain 'member' added by the invitation feature will NOT match, and must
 * be told so rather than shown a success that wrote nothing.
 */

/**
 * A Supabase client narrowed to the queries this module makes. Loose for the same reason as
 * lib/acting-org.ts and lib/entitlements.ts: naming the real builder type reaches TS2589,
 * and there are no generated Database types in this repository.
 */
export type CompanyIdentityClient = ActingOrgLookupClient

/** What a writer said about the name. `has` false means "this writer said nothing". */
export type CompanyNameInput = {
  /** Present in the payload at all, even as empty. Absent means the name is untouched. */
  hasCompanyName: boolean
  companyName: string | null
  /**
   * profiles.full_name. Both forms already fall back to it when the company field is blank,
   * and organizations.name is NOT NULL, so the fallback is load-bearing rather than cosmetic.
   */
  fallbackName?: string | null
}

export type SaveCompanyIdentityResult =
  | {
      ok: true
      /** The normalized name that landed in both columns, or null when the writer said nothing. */
      name: string | null
      orgId: OrgId | null
    }
  | {
      ok: false
      error: string
      status: number
      /**
       * True when organizations.name was already updated before the failure. The
       * authoritative value is correct and only the mirror lags; a retry converges.
       */
      orgNameWritten?: boolean
    }

/**
 * ITEM 4: the trim, in the one place every writer passes through.
 *
 * Caro Creative Inc. is why. Its profiles.company_name is nineteen bytes and its
 * organizations.name is the same eighteen clean ASCII characters without a trailing space,
 * and the mechanism is visible in migration 079: the PHASE 12 trigger writes
 * organizations.name through NULLIF(btrim(...), '') and writes profiles.company_name as a
 * bare COALESCE(raw_user_meta_data->>'company_name', '') with no btrim at all. PHASE 2's
 * backfill has the identical asymmetry. So one column was normalized at birth and the other
 * was not, and a trailing space typed on the signup form survived in exactly one of them.
 *
 * Empty collapses to null rather than to "", so "no company name" is one state and not two.
 */
export function normalizeCompanyName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * Resolve, write the authority, write the mirror. The only supported way to change a
 * company name.
 *
 * `profilePatch` is the rest of the caller's own profiles payload. It is applied in the SAME
 * statement as the mirror so a settings save is still one profiles round trip, and so a
 * caller cannot write its other columns while skipping this function for the name.
 * company_name in the patch is ignored and overwritten - that disagreement is the exact
 * defect this function exists to prevent.
 *
 * 079 PARAMETER CLASS: `userId` is the CALLER'S OWN user id, from supabase.auth.getUser(),
 * never from a payload. No organization id is accepted as a parameter; it is derived, on
 * every call, from org_members. See lib/acting-org.ts for why that is a signature-level
 * property rather than a convention.
 */
export async function saveCompanyIdentity(
  client: CompanyIdentityClient,
  userId: string,
  input: CompanyNameInput,
  profilePatch: Record<string, unknown> = {}
): Promise<SaveCompanyIdentityResult> {
  if (!userId) return { ok: false, error: "Not signed in", status: 401 }

  // THE WRITER SAID NOTHING ABOUT THE NAME. Neither column is touched and the rest of the
  // patch is applied as-is. Mirrors reconcileProjectClientFields()'s `hasClientName` branch.
  if (!input.hasCompanyName) {
    if (Object.keys(profilePatch).length === 0) return { ok: true, name: null, orgId: null }
    const applied = await applyProfilePatch(client, userId, profilePatch)
    return applied.ok ? { ok: true, name: null, orgId: null } : applied
  }

  const name = normalizeCompanyName(input.companyName) ?? normalizeCompanyName(input.fallbackName)

  // organizations.name is NOT NULL, so "clear the company name" is not a state the model
  // has. Previously the agency form wrote null into profiles.company_name here and left
  // organizations.name untouched, which is a divergence by construction. Refusing is the
  // only answer that keeps the two columns equal. It takes BOTH the company field and
  // full_name being blank to reach this.
  if (!name) {
    return { ok: false, error: "A company name is required.", status: 400 }
  }

  const acting = await resolveActingOrgId(userId, client)
  if (!acting.orgId) {
    // Every branch here already logged at error inside resolveActingOrgId. Fail closed:
    // writing the mirror without the authority is the drift, not a degraded save.
    const status = acting.reason === "lookup-failed" ? 500 : 403
    return { ok: false, error: actingOrgMessage(acting.reason), status }
  }

  // THE AUTHORITY. .select() is not decoration - see the header. Zero rows here means the
  // organizations UPDATE policy filtered the row, which is a real answer and not a success.
  const { data: orgRows, error: orgError } = await client
    .from("organizations")
    .update({ name })
    .eq("id", acting.orgId)
    .select("id, name")

  if (orgError) {
    console.error("[company-identity] organizations.name write failed", {
      userId,
      orgId: acting.orgId,
      code: orgError.code,
      message: orgError.message,
    })
    return { ok: false, error: "Could not save the company name.", status: 500 }
  }

  if (!Array.isArray(orgRows) || orgRows.length === 0) {
    console.error("[company-identity] organizations.name write matched no row", {
      userId,
      orgId: acting.orgId,
      reason:
        "the organizations UPDATE policy is keyed on current_user_admin_org_ids(), role IN ('owner','admin'). A plain member cannot rename the organization.",
    })
    return {
      ok: false,
      error: "You do not have permission to rename this organization.",
      status: 403,
    }
  }

  // THE MIRROR, plus whatever else this form saves.
  const applied = await applyProfilePatch(client, userId, { ...profilePatch, company_name: name })
  if (!applied.ok) return { ...applied, orgNameWritten: true }

  return { ok: true, name, orgId: acting.orgId }
}

async function applyProfilePatch(
  client: CompanyIdentityClient,
  userId: string,
  patch: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data, error } = await client
    .from("profiles")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select("id")

  if (error) {
    console.error("[company-identity] profiles write failed", {
      userId,
      code: error.code,
      message: error.message,
    })
    return { ok: false, error: error.message, status: 400 }
  }
  if (!Array.isArray(data) || data.length === 0) {
    // The profiles UPDATE policy is auth.uid() = id and userId comes from getUser(), so this
    // should be unreachable. It is checked anyway because the silent-zero-rows shape is the
    // single most expensive failure mode in this codebase.
    console.error("[company-identity] profiles write matched no row", { userId })
    return { ok: false, error: "Could not save your profile.", status: 403 }
  }
  return { ok: true }
}

function actingOrgMessage(reason: string): string {
  switch (reason) {
    case "no-membership":
      return "Your account is not linked to an organization yet. Contact support."
    case "ambiguous":
      return "Your account belongs to more than one organization. Choose one before saving."
    case "preference-refused":
      return "The selected organization is no longer one you belong to. Reload and try again."
    default:
      return "Could not determine which organization to save to."
  }
}
