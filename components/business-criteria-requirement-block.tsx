"use client"

import { cn } from "@/lib/utils"
import { HelpTerm } from "@/components/help-term"
import type { GlossaryKey } from "@/lib/glossary"
import {
  DESIGNATION_LABELS,
  INSURANCE_LABELS,
  type BusinessCriteriaHolds,
  type BusinessCriteriaRequired,
  type BusinessCriteriaAcknowledgments,
  type DesignationHolds,
  type DesignationKey,
  type InsuranceHolds,
  type InsuranceKey,
  type RequirementComplianceItem,
  computeRequirementCompliance,
} from "@/lib/business-criteria"

type Theme = "light" | "dark"

const THEME_CLASSES: Record<
  Theme,
  {
    container: string
    heading: string
    mutedStrong: string
    muted: string
    itemBox: string
    checkbox: string
    field: string
    link: string
  }
> = {
  light: {
    container: "rounded-xl border border-vendor-border bg-vendor-background/70 p-4",
    heading: "font-display font-bold text-sm text-vendor-foreground",
    mutedStrong: "font-mono text-2xs uppercase tracking-wider text-vendor-muted-strong",
    muted: "font-mono text-2xs uppercase tracking-wider text-vendor-muted",
    itemBox: "rounded-lg border border-vendor-border bg-vendor-surface p-3",
    checkbox: "rounded border-vendor-border",
    field:
      "border-vendor-border bg-vendor-surface text-vendor-foreground placeholder:text-vendor-muted/70 shadow-sm focus-visible:ring-vendor-foreground/30 focus-visible:border-vendor-foreground rounded-md px-3 py-2 text-sm w-full",
    link: "text-vendor-foreground underline underline-offset-4 hover:text-accent",
  },
  dark: {
    container: "p-4 rounded-lg border border-border/40 bg-white/5",
    heading: "font-display font-bold text-sm text-foreground",
    mutedStrong: "font-mono text-2xs uppercase tracking-wider text-foreground-muted",
    muted: "font-mono text-2xs uppercase tracking-wider text-foreground-muted/70",
    itemBox: "rounded-lg border border-border/40 bg-white/[0.02] p-3",
    checkbox: "rounded border-foreground-muted",
    field:
      "border-border/40 bg-white/5 text-foreground placeholder:text-foreground-muted/50 rounded-md px-3 py-2 text-sm w-full",
    link: "text-foreground underline underline-offset-4 hover:text-accent",
  },
}

/**
 * Shared required/preferred business-criteria confirmation block (S4-1) - used by both the
 * portal bid form (app/partner/rfps/[id], light "vendor" theme) and the guest bid form
 * (app/rfp/respond/[token], dark theme). Renders nothing (returns null) when the RFP has no
 * explicit priority tier data, so pre-S4-1 RFPs keep whichever legacy criteria UI the caller
 * renders instead.
 */
export function BusinessCriteriaRequirementBlock({
  required,
  responses,
  acknowledgments,
  onUpdateDesignation,
  onUpdateInsurance,
  onUpdateCoi,
  onSetAcknowledgment,
  onConfirmAll,
  canEdit,
  profileHolds,
  theme = "light",
}: {
  required: BusinessCriteriaRequired
  responses: BusinessCriteriaHolds
  acknowledgments: BusinessCriteriaAcknowledgments
  onUpdateDesignation: (key: DesignationKey, patch: Partial<DesignationHolds>) => void
  onUpdateInsurance: (key: InsuranceKey, patch: Partial<InsuranceHolds>) => void
  onUpdateCoi: (metOrNot: boolean) => void
  onSetAcknowledgment: (kind: "designation" | "insurance" | "coi", key: string | null, reason: string | null) => void
  onConfirmAll: () => void
  canEdit: boolean
  /** Portal-path only - vendor's saved profile holds, for the "Confirmed from your profile" badge. Omit on the guest path (no profile). */
  profileHolds?: BusinessCriteriaHolds | null
  /** "light" (vendor portal tokens, default) or "dark" (guest page, agency-dark tokens). */
  theme?: Theme
}) {
  const t = THEME_CLASSES[theme]
  const helpTermTheme = theme

  const compliance = computeRequirementCompliance(required, responses, acknowledgments, {
    designations: DESIGNATION_LABELS,
    insurance: INSURANCE_LABELS,
  })

  if (!compliance.hasTierData) return null

  const isMet = (item: RequirementComplianceItem) => {
    if (item.kind === "designation") return responses.designations[item.key as DesignationKey].holds
    if (item.kind === "insurance") return responses.insurance[item.key as InsuranceKey].has_coverage
    return responses.insurance.coi_on_file
  }

  const isCannotMeet = (item: RequirementComplianceItem) => item.cannotMeetReason != null

  const isFromProfile = (item: RequirementComplianceItem) => {
    if (!profileHolds || !isMet(item)) return false
    if (item.kind === "designation") return profileHolds.designations[item.key as DesignationKey].holds
    if (item.kind === "insurance") return profileHolds.insurance[item.key as InsuranceKey].has_coverage
    return profileHolds.insurance.coi_on_file
  }

  const toggleMet = (item: RequirementComplianceItem, met: boolean) => {
    if (item.kind === "designation") onUpdateDesignation(item.key as DesignationKey, { holds: met })
    else if (item.kind === "insurance") onUpdateInsurance(item.key as InsuranceKey, { has_coverage: met })
    else onUpdateCoi(met)
    if (met) onSetAcknowledgment(item.kind, item.kind === "coi" ? null : item.key, null)
  }

  const toggleCannotMeet = (item: RequirementComplianceItem, cannotMeet: boolean) => {
    if (cannotMeet) {
      toggleMet(item, false)
      onSetAcknowledgment(item.kind, item.kind === "coi" ? null : item.key, "")
    } else {
      onSetAcknowledgment(item.kind, item.kind === "coi" ? null : item.key, null)
    }
  }

  const renderSubfields = (item: RequirementComplianceItem) => {
    if (isCannotMeet(item)) return null
    if (item.kind === "designation") {
      const d = responses.designations[item.key as DesignationKey]
      if (!d.holds) return null
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pl-7">
          <input
            value={d.certifying_body || ""}
            onChange={(e) => onUpdateDesignation(item.key as DesignationKey, { certifying_body: e.target.value || null })}
            placeholder="Certifying body (e.g. NMSDC, WBENC)"
            className={t.field}
            disabled={!canEdit || d.self_certified}
          />
          <input
            value={d.certification_number || ""}
            onChange={(e) => onUpdateDesignation(item.key as DesignationKey, { certification_number: e.target.value || null })}
            placeholder="Certification number"
            className={t.field}
            disabled={!canEdit || d.self_certified}
          />
          <label className="flex items-center gap-2 sm:col-span-2 cursor-pointer">
            <input
              type="checkbox"
              checked={d.self_certified}
              disabled={!canEdit}
              onChange={(e) =>
                onUpdateDesignation(item.key as DesignationKey, {
                  self_certified: e.target.checked,
                  ...(e.target.checked ? { certifying_body: null, certification_number: null } : {}),
                })
              }
              className={cn("w-4 h-4", t.checkbox)}
            />
            <span className={cn("text-sm", theme === "light" ? "text-vendor-foreground" : "text-foreground")}>
              Self-certified (no third-party certification)
            </span>
          </label>
        </div>
      )
    }
    if (item.kind === "insurance") {
      const cov = responses.insurance[item.key as InsuranceKey]
      if (!cov.has_coverage) return null
      const minimum = required.insurance[item.key as InsuranceKey]?.minimum
      return (
        <div className="mt-3 pl-7">
          <input
            value={cov.limit || ""}
            onChange={(e) => onUpdateInsurance(item.key as InsuranceKey, { limit: e.target.value || null })}
            placeholder={minimum ? `Your limit (min. ${minimum})` : "Your limit, e.g. $1M/$2M"}
            disabled={!canEdit}
            className={cn(t.field, "w-56")}
          />
        </div>
      )
    }
    return null
  }

  const renderItem = (item: RequirementComplianceItem) => {
    const met = isMet(item)
    const cannotMeet = isCannotMeet(item)
    const fromProfile = isFromProfile(item)
    return (
      <div key={`${item.kind}:${item.key}`} className={t.itemBox}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <label className="flex items-start gap-3 cursor-pointer min-w-0">
            <input
              type="checkbox"
              checked={met}
              disabled={!canEdit || cannotMeet}
              onChange={(e) => toggleMet(item, e.target.checked)}
              className={cn("mt-0.5 w-4 h-4", t.checkbox)}
            />
            <span className="min-w-0">
              <HelpTerm term={item.key as GlossaryKey} theme={helpTermTheme} className={t.heading}>
                {item.label}
              </HelpTerm>
              {fromProfile && (
                <span className="ml-2 font-mono text-2xs uppercase tracking-wider text-success align-middle">
                  Confirmed from your profile
                </span>
              )}
            </span>
          </label>
          {item.priority === "required" && (
            <label className="flex items-center gap-2 shrink-0 cursor-pointer">
              <input
                type="checkbox"
                checked={cannotMeet}
                disabled={!canEdit}
                onChange={(e) => toggleCannotMeet(item, e.target.checked)}
                className={cn("w-4 h-4", t.checkbox)}
              />
              <span className={t.mutedStrong}>Cannot meet</span>
            </label>
          )}
        </div>
        {cannotMeet && (
          <div className="mt-3 pl-7">
            <textarea
              value={item.cannotMeetReason || ""}
              onChange={(e) => onSetAcknowledgment(item.kind, item.kind === "coi" ? null : item.key, e.target.value)}
              placeholder="Explain why you cannot meet this requirement"
              disabled={!canEdit}
              className={cn(t.field, "min-h-[70px]")}
            />
          </div>
        )}
        {renderSubfields(item)}
      </div>
    )
  }

  return (
    <div className={t.container}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h3 className={t.heading}>Business criteria</h3>
        {canEdit && compliance.requiredTotalCount > 0 && (
          <button type="button" onClick={onConfirmAll} className={cn("font-mono text-2xs uppercase tracking-wider", t.link)}>
            Confirm all
          </button>
        )}
      </div>
      {compliance.requiredTotalCount > 0 && (
        <p className={cn(t.mutedStrong, "mb-3")}>
          {compliance.requiredConfirmedCount} of {compliance.requiredTotalCount} required confirmed
        </p>
      )}
      {required.notes.trim() && (
        <p className={cn("text-xs mb-3 whitespace-pre-wrap", theme === "light" ? "text-vendor-muted-strong" : "text-foreground-muted")}>
          {required.notes}
        </p>
      )}

      {compliance.requiredItems.length > 0 && (
        <div className="mb-4">
          <p className={cn(t.muted, "mb-3")}>
            <HelpTerm term="required_criterion" theme={helpTermTheme}>Required</HelpTerm>
          </p>
          <div className="space-y-3">{compliance.requiredItems.map(renderItem)}</div>
        </div>
      )}

      {compliance.preferredItems.length > 0 && (
        <div className={cn("pt-3 border-t", theme === "light" ? "border-vendor-border/60" : "border-border/40")}>
          <p className={cn(t.muted, "mb-3")}>
            <HelpTerm term="preferred_criterion" theme={helpTermTheme}>Preferred (optional)</HelpTerm>
          </p>
          <div className="space-y-3">{compliance.preferredItems.map(renderItem)}</div>
        </div>
      )}
    </div>
  )
}
