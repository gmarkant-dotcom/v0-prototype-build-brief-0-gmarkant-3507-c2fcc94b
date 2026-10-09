import { hasVendorOrganization, resolveAgencyGate, type OrgLookupClient } from "@/lib/entitlements"
import { AGENCY_ENTITLEMENT_REQUIRED } from "@/lib/api-auth"

/**
 * THE ONE PORTAL SWITCH. Every server writer of profiles.active_role goes through here:
 * /api/profile/switch-role, /api/user/active-role and the RFP-invite claim.
 *
 * Migration 113 makes profiles.role / secondary_role / active_role unwritable by a signed-in
 * session, and adds public.set_active_role(p_role text), the sanctioned writer, built on
 * 090's set_active_org. This calls that function. If 113 is NOT applied yet (PostgREST
 * PGRST202, or 42883), it applies the SAME rule here and then writes active_role directly,
 * which the pre-113 table still allows. So this ships before the migration and behaves the
 * same on either side of it.
 *
 * THE RULE (G1, owner ruling 2026-10-09; 113's function):
 *   'agency'  -> the caller belongs to an organization with is_lead_agency AND is_paid.
 *                In code the ACTIVE organization is tested (resolveAgencyGate), which is the
 *                stricter of the two: a member of a paid lead agency whose active organization
 *                is another one must switch organization first.
 *   'partner' -> the caller belongs to an organization with is_vendor.
 *
 * NOTHING ELSE IS WRITTEN. The old switch-role also granted secondary_role = 'partner'; that
 * grant decided nothing after G1 and 113 refuses it, so it is gone.
 */
export type ActiveRole = "agency" | "partner"

export type SwitchOutcome =
  | { ok: true; activeRole: ActiveRole; via: "set_active_role" | "legacy-write" }
  | { ok: false; status: number; body: { error: string; code?: string; message: string } }

const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883"])

type RpcClient = OrgLookupClient & {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ error: { code?: string; message: string } | null }>
}

function refusedAgency(): SwitchOutcome {
  return {
    ok: false,
    status: 403,
    body: {
      error: "upgrade_required",
      code: AGENCY_ENTITLEMENT_REQUIRED,
      message: "Agency access requires a paid lead-agency account.",
    },
  }
}

function refusedPartner(): SwitchOutcome {
  return {
    ok: false,
    status: 403,
    body: {
      error: "vendor_organization_required",
      code: "vendor_organization_required",
      message: "Vendor mode is available to members of a vendor company.",
    },
  }
}

export async function switchActiveRole(
  supabase: RpcClient,
  userId: string,
  target: ActiveRole
): Promise<SwitchOutcome> {
  const { error: rpcError } = await supabase.rpc("set_active_role", { p_role: target })
  if (!rpcError) return { ok: true, activeRole: target, via: "set_active_role" }

  const code = (rpcError as { code?: string }).code ?? ""
  if (code === "LG11A") return refusedAgency()
  if (code === "LG11B") return refusedPartner()
  if (!MISSING_FUNCTION_CODES.has(code)) {
    console.error("[active-role-switch] set_active_role failed", { userId, target, code, message: rpcError.message })
    return { ok: false, status: 500, body: { error: "switch_failed", message: "Could not switch portal. Please try again." } }
  }

  // 113 is not applied. Same rule, enforced here, then the pre-113 direct write.
  if (target === "agency") {
    const gate = await resolveAgencyGate(userId, supabase)
    if (!gate.entitled) return refusedAgency()
  } else if (!(await hasVendorOrganization(userId, supabase))) {
    return refusedPartner()
  }

  const { error: writeError } = await supabase.from("profiles").update({ active_role: target }).eq("id", userId)
  if (writeError) {
    console.error("[active-role-switch] legacy active_role write failed", { userId, target, code: writeError.code, message: writeError.message })
    return { ok: false, status: 500, body: { error: "switch_failed", message: "Could not switch portal. Please try again." } }
  }
  return { ok: true, activeRole: target, via: "legacy-write" }
}
