"use client"

import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { HelpTerm } from "@/components/help-term"
import {
  DESIGNATION_KEYS,
  DESIGNATION_LABELS,
  INSURANCE_KEYS,
  INSURANCE_LABELS,
  getDesignationPriority,
  getInsurancePriority,
  getCoiPriority,
  type BusinessCriteriaRequired,
  type DesignationKey,
  type InsuranceKey,
  type InsuranceRequirement,
  type RequirementPriority,
} from "@/lib/business-criteria"

/** Two-way segmented pill for a criterion's requirement tier (S4-1). Binary, no third state.
 *  Shared by the agency wizard and magic-rfp criteria editors below. */
export function PriorityToggle({
  value,
  onChange,
}: {
  value: RequirementPriority
  onChange: (next: RequirementPriority) => void
}) {
  return (
    <div className="flex rounded-md overflow-hidden border border-border shrink-0" onClick={(e) => e.stopPropagation()}>
      {(["required", "preferred"] as RequirementPriority[]).map((tier) => (
        <button
          key={tier}
          type="button"
          onClick={() => onChange(tier)}
          className={cn(
            "px-2.5 py-1 font-mono text-2xs uppercase tracking-wider transition-colors",
            value === tier ? "bg-accent text-accent-foreground" : "bg-white/5 text-foreground-muted hover:bg-white/10"
          )}
        >
          {tier}
        </button>
      ))}
    </div>
  )
}

/**
 * Shared compact criteria editor for the RFP Broadcast wizard's Business Criteria step and
 * the magic-rfp flow's Additional business criteria section (C1). Presentation only - state
 * ownership (masterRfp vs. standalone businessCriteriaRequired) stays with each caller, same
 * split as the bid-side business-criteria-requirement-block.tsx.
 *
 * Two-column responsive grid, single column below 768px. Each criterion is one compact row;
 * the Required/Preferred toggle appears inline the instant the box is checked - that
 * immediacy is the whole point of this redesign.
 */
export function BusinessCriteriaEditor({
  value,
  onChangeDesignation,
  onChangeDesignationPriority,
  onChangeInsurance,
  onChangeInsurancePriority,
  onChangeCoi,
  onChangeCoiPriority,
  onChangeNotes,
}: {
  value: BusinessCriteriaRequired
  onChangeDesignation: (key: DesignationKey, required: boolean) => void
  onChangeDesignationPriority: (key: DesignationKey, priority: RequirementPriority) => void
  onChangeInsurance: (key: InsuranceKey, patch: Partial<InsuranceRequirement>) => void
  onChangeInsurancePriority: (key: InsuranceKey, priority: RequirementPriority) => void
  onChangeCoi: (required: boolean) => void
  onChangeCoiPriority: (priority: RequirementPriority) => void
  onChangeNotes: (notes: string) => void
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {DESIGNATION_KEYS.map((key) => {
          const isRequired = value.designations[key] === true
          return (
            <label
              key={key}
              className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-white/[0.02] cursor-pointer flex-wrap"
            >
              <Checkbox
                checked={isRequired}
                onCheckedChange={(checked) => onChangeDesignation(key, checked === true)}
              />
              <HelpTerm term={key} theme="dark" className="text-sm text-foreground text-left">
                {DESIGNATION_LABELS[key]}
              </HelpTerm>
              {isRequired && (
                <PriorityToggle
                  value={getDesignationPriority(value, key)}
                  onChange={(p) => onChangeDesignationPriority(key, p)}
                />
              )}
            </label>
          )
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {INSURANCE_KEYS.map((key) => {
          const requirement = value.insurance[key]
          const isRequired = requirement?.required === true
          return (
            <div
              key={key}
              className="flex flex-col gap-2 p-2.5 rounded-lg border border-border bg-white/[0.02]"
            >
              <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                <Checkbox
                  checked={isRequired}
                  onCheckedChange={(checked) => onChangeInsurance(key, { required: checked === true })}
                />
                <HelpTerm term={key} theme="dark" className="text-sm text-foreground text-left truncate">
                  {INSURANCE_LABELS[key]}
                </HelpTerm>
              </label>
              {isRequired && (
                <div className="flex items-center gap-2 pl-7 flex-wrap">
                  <Input
                    value={requirement?.minimum || ""}
                    onChange={(e) => onChangeInsurance(key, { minimum: e.target.value || null })}
                    placeholder="Minimum, e.g. $1M/$2M"
                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 h-8 text-sm flex-1 min-w-[140px]"
                  />
                  <PriorityToggle
                    value={getInsurancePriority(value, key)}
                    onChange={(p) => onChangeInsurancePriority(key, p)}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <label className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-white/[0.02] cursor-pointer flex-wrap">
        <Checkbox
          checked={value.insurance.coi_on_file === true}
          onCheckedChange={(checked) => onChangeCoi(checked === true)}
        />
        <span className="text-sm text-foreground flex-1 min-w-0">
          Require a <HelpTerm term="coi" theme="dark">Certificate of Insurance (COI)</HelpTerm> on file
        </span>
        {value.insurance.coi_on_file === true && (
          <PriorityToggle
            value={getCoiPriority(value)}
            onChange={onChangeCoiPriority}
          />
        )}
      </label>

      <div>
        <label className="font-mono text-2xs uppercase text-foreground-muted block mb-2">
          Additional notes
        </label>
        <Textarea
          value={value.notes}
          onChange={(e) => onChangeNotes(e.target.value)}
          placeholder="Any other procurement requirements bidders should know about."
          className="min-h-[80px] bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
        />
      </div>
    </div>
  )
}
