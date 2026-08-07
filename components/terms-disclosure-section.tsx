"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { HelpTerm } from "@/components/help-term"
import {
  type TermsDisclosure,
  type TermState,
  type KillFeeType,
  type IpRightsStance,
  type TermsDisclosureValidationError,
  TERM_STATES,
  TERM_STATE_LABELS,
  KILL_FEE_TYPES,
  IP_RIGHTS_STANCES,
  IP_RIGHTS_LABELS,
  NET_DAYS_OPTIONS,
  RATE_VALIDITY_OPTIONS,
  isTermsDisclosureStarted,
} from "@/lib/terms-disclosure"

type Theme = "light" | "dark"

interface TermsDisclosureSectionProps {
  value: TermsDisclosure
  onChange: (next: TermsDisclosure) => void
  required: boolean
  theme: Theme
  errors?: TermsDisclosureValidationError[]
  disabled?: boolean
  /** Signed-in partner portal only - guests never get a "save as default" option. */
  showSaveDefaultOption?: boolean
  saveAsDefault?: boolean
  onSaveAsDefaultChange?: (v: boolean) => void
  /** F1: when the caller wraps this in its own BidFormCollapsibleSection (the "Terms" bid-form
   *  section), this component's own internal collapse/expand and "Terms" heading would double
   *  up with the outer wrapper's. Set true to always render the full body with no internal
   *  heading or Collapse control - the outer wrapper becomes the single collapse point. */
  forceExpanded?: boolean
}

const KILL_FEE_LABELS: Record<KillFeeType, string> = {
  none: "None",
  percent: "% of fee",
  flat: "Flat amount",
}

function pillClass(theme: Theme, active: boolean, hasError: boolean) {
  if (theme === "light") {
    return cn(
      "rounded-md border px-3 py-1.5 text-xs font-mono transition-colors",
      active
        ? "border-[#0C3535] bg-[#0C3535]/10 text-[#0C3535]"
        : hasError
          ? "border-red-300 bg-white text-red-700 hover:bg-red-50"
          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
    )
  }
  return cn(
    "rounded-md border px-3 py-1.5 text-xs font-mono transition-colors",
    active
      ? "border-accent bg-accent/10 text-accent"
      : hasError
        ? "border-red-500/40 bg-red-500/5 text-red-300 hover:bg-red-500/10"
        : "border-border bg-white/5 text-foreground-muted hover:bg-white/10"
  )
}

function inputClass(theme: Theme, hasError: boolean) {
  if (theme === "light") {
    return cn(
      "border rounded-md px-3 py-1.5 text-sm bg-white text-gray-900 placeholder:text-gray-400 shadow-sm focus-visible:outline-none focus-visible:ring-1",
      hasError ? "border-red-300 focus-visible:ring-red-300" : "border-gray-200 focus-visible:ring-[#0C3535]/30"
    )
  }
  return cn(
    "border rounded-md px-3 py-1.5 text-sm bg-white/5 text-foreground placeholder:text-foreground-muted/50 focus-visible:outline-none focus-visible:ring-1",
    hasError ? "border-red-500/40 focus-visible:ring-red-500/40" : "border-border focus-visible:ring-accent/40"
  )
}

function labelClass(theme: Theme) {
  return theme === "light"
    ? "font-mono text-2xs text-gray-500 uppercase tracking-wider"
    : "font-mono text-2xs text-foreground-muted uppercase tracking-wider"
}

function rowWrapperClass(theme: Theme) {
  return theme === "light"
    ? "rounded-lg border border-gray-200 bg-white p-3 space-y-2"
    : "rounded-lg border border-border/60 bg-white/5 p-3 space-y-2"
}

function errorTextClass(theme: Theme) {
  return theme === "light" ? "text-2xs text-red-700" : "text-2xs text-red-300"
}

function StateControl({
  theme,
  value,
  onChange,
  disabled,
  hasError,
}: {
  theme: Theme
  value: TermState | null
  onChange: (state: TermState) => void
  disabled?: boolean
  hasError: boolean
}) {
  return (
    <div className="space-y-1">
      <HelpTerm term="term_flexibility" theme={theme} className={cn(labelClass(theme), "normal-case tracking-normal")}>
        Flexibility
      </HelpTerm>
      <div className="flex flex-wrap gap-2">
        {TERM_STATES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onChange(s)}
            className={pillClass(theme, value === s, hasError && value == null)}
          >
            {TERM_STATE_LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  )
}

function NoteInput({
  theme,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  theme: Theme
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value.slice(0, 200))}
      disabled={disabled}
      placeholder={placeholder || "Note (optional)"}
      maxLength={200}
      className={cn(inputClass(theme, false), "w-full")}
    />
  )
}

function DaysPicker({
  theme,
  options,
  value,
  onChange,
  disabled,
  hasError,
}: {
  theme: Theme
  options: readonly number[]
  value: number | null
  onChange: (days: number | null) => void
  disabled?: boolean
  hasError: boolean
}) {
  const isCustom = value != null && !(options as readonly number[]).includes(value)
  const [customMode, setCustomMode] = useState(isCustom)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => {
              setCustomMode(false)
              onChange(opt)
            }}
            className={pillClass(theme, !customMode && value === opt, hasError)}
          >
            {opt}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setCustomMode(true)
            onChange(null)
          }}
          className={pillClass(theme, customMode, hasError)}
        >
          Custom
        </button>
      </div>
      {customMode && (
        <input
          type="number"
          min={1}
          max={365}
          step={1}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          disabled={disabled}
          placeholder="Number of days"
          className={cn(inputClass(theme, hasError), "w-32")}
        />
      )}
    </div>
  )
}

export function TermsDisclosureSection({
  value,
  onChange,
  required,
  theme,
  errors = [],
  disabled = false,
  showSaveDefaultOption = false,
  saveAsDefault = false,
  onSaveAsDefaultChange,
  forceExpanded = false,
}: TermsDisclosureSectionProps) {
  const [expanded, setExpanded] = useState(required || isTermsDisclosureStarted(value))

  const errorsFor = (field: TermsDisclosureValidationError["field"]) =>
    errors.filter((e) => e.field === field).map((e) => e.message)

  if (!forceExpanded && !expanded) {
    return (
      <div className={rowWrapperClass(theme)}>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          disabled={disabled}
          className={cn(
            "font-mono text-xs",
            theme === "light" ? "text-[#0C3535] hover:underline" : "text-accent hover:underline"
          )}
        >
          + Add your terms (optional)
        </button>
      </div>
    )
  }

  const paymentErrors = errorsFor("payment")
  const killFeeErrors = errorsFor("kill_fee")
  const ipRightsErrors = errorsFor("ip_rights")
  const rateValidityErrors = errorsFor("rate_validity")

  return (
    <div
      className={
        forceExpanded
          ? ""
          : theme === "light"
            ? "rounded-xl border border-gray-200 bg-gray-50/70 p-4"
            : "rounded-xl border border-border bg-white/5 p-4"
      }
    >
      {!forceExpanded && (
        <div className="flex items-center justify-between mb-1">
          <h3 className={cn("font-display font-bold text-sm", theme === "light" ? "text-[#0C3535]" : "text-foreground")}>
            Terms
          </h3>
          {!required && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              disabled={disabled}
              className={cn("font-mono text-2xs", theme === "light" ? "text-gray-500 hover:text-gray-700" : "text-foreground-muted hover:text-foreground")}
            >
              Collapse
            </button>
          )}
        </div>
      )}
      <p className={cn("text-xs mb-3", theme === "light" ? "text-gray-600" : "text-foreground-muted")}>
        {required
          ? "This agency requires basic term disclosures with your bid."
          : "State your usual position on each term. Optional, but helps the agency compare bids without follow-up questions."}
      </p>

      <div className="space-y-3">
        {/* Payment terms */}
        <div className={rowWrapperClass(theme)}>
          <div className="flex items-center justify-between">
            <span className={labelClass(theme)}>Payment terms</span>
            {paymentErrors[0] && <span className={errorTextClass(theme)}>{paymentErrors[0]}</span>}
          </div>
          <div>
            <HelpTerm
              term="net_days"
              theme={theme}
              className={cn(labelClass(theme), "block mb-1 normal-case tracking-normal")}
            >
              Net days
            </HelpTerm>
            <DaysPicker
              theme={theme}
              options={NET_DAYS_OPTIONS}
              value={value.payment.net_days}
              onChange={(net_days) => onChange({ ...value, payment: { ...value.payment, net_days } })}
              disabled={disabled}
              hasError={paymentErrors.length > 0 && value.payment.net_days == null}
            />
          </div>
          <div>
            <HelpTerm
              term="deposit_required"
              theme={theme}
              className={cn(labelClass(theme), "block mb-1 normal-case tracking-normal")}
            >
              Deposit required (%)
            </HelpTerm>
            <input
              type="number"
              min={0}
              max={100}
              step="any"
              value={value.payment.deposit_pct ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  payment: { ...value.payment, deposit_pct: e.target.value === "" ? null : Number(e.target.value) },
                })
              }
              disabled={disabled}
              placeholder="0-100"
              className={cn(inputClass(theme, paymentErrors.length > 0 && value.payment.deposit_pct == null), "w-32")}
            />
          </div>
          <StateControl
            theme={theme}
            value={value.payment.state}
            onChange={(state) => onChange({ ...value, payment: { ...value.payment, state } })}
            disabled={disabled}
            hasError={paymentErrors.length > 0}
          />
          <NoteInput
            theme={theme}
            value={value.payment.note}
            onChange={(note) => onChange({ ...value, payment: { ...value.payment, note } })}
            disabled={disabled}
          />
        </div>

        {/* Kill / cancellation fee */}
        <div className={rowWrapperClass(theme)}>
          <div className="flex items-center justify-between">
            <HelpTerm term="kill_fee" theme={theme} className={cn(labelClass(theme), "block")}>
              Kill / cancellation fee
            </HelpTerm>
            {killFeeErrors[0] && <span className={errorTextClass(theme)}>{killFeeErrors[0]}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {KILL_FEE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange({
                    ...value,
                    kill_fee: { ...value.kill_fee, fee_type: t, amount: t === "none" ? null : value.kill_fee.amount },
                  })
                }
                className={pillClass(theme, value.kill_fee.fee_type === t, killFeeErrors.length > 0 && !value.kill_fee.fee_type)}
              >
                {KILL_FEE_LABELS[t]}
              </button>
            ))}
          </div>
          {value.kill_fee.fee_type && value.kill_fee.fee_type !== "none" && (
            <input
              type="number"
              min={0}
              max={value.kill_fee.fee_type === "percent" ? 100 : undefined}
              step="any"
              value={value.kill_fee.amount ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  kill_fee: { ...value.kill_fee, amount: e.target.value === "" ? null : Number(e.target.value) },
                })
              }
              disabled={disabled}
              placeholder={value.kill_fee.fee_type === "percent" ? "0-100" : "Amount"}
              className={cn(inputClass(theme, killFeeErrors.length > 0 && value.kill_fee.amount == null), "w-32")}
            />
          )}
          <StateControl
            theme={theme}
            value={value.kill_fee.state}
            onChange={(state) => onChange({ ...value, kill_fee: { ...value.kill_fee, state } })}
            disabled={disabled}
            hasError={killFeeErrors.length > 0}
          />
          <NoteInput
            theme={theme}
            value={value.kill_fee.note}
            onChange={(note) => onChange({ ...value, kill_fee: { ...value.kill_fee, note } })}
            disabled={disabled}
          />
        </div>

        {/* IP / usage rights */}
        <div className={rowWrapperClass(theme)}>
          <div className="flex items-center justify-between">
            <span className={labelClass(theme)}>IP / usage rights</span>
            {ipRightsErrors[0] && <span className={errorTextClass(theme)}>{ipRightsErrors[0]}</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {IP_RIGHTS_STANCES.map((s) => (
              <div key={s} className="inline-flex items-center gap-1">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange({ ...value, ip_rights: { ...value.ip_rights, stance: s } })}
                  className={pillClass(theme, value.ip_rights.stance === s, ipRightsErrors.length > 0 && !value.ip_rights.stance)}
                >
                  {IP_RIGHTS_LABELS[s as IpRightsStance]}
                </button>
                {/* Adjacent, not nested: a HelpTerm trigger can't live inside this button
                    without invalid nested-interactive markup, and it must not toggle the
                    stance when opened. */}
                <HelpTerm
                  term={s}
                  theme={theme}
                  className={theme === "light" ? "text-2xs text-gray-400" : "text-2xs text-foreground-muted/60"}
                >
                  ?
                </HelpTerm>
              </div>
            ))}
          </div>
          <StateControl
            theme={theme}
            value={value.ip_rights.state}
            onChange={(state) => onChange({ ...value, ip_rights: { ...value.ip_rights, state } })}
            disabled={disabled}
            hasError={ipRightsErrors.length > 0}
          />
          <NoteInput
            theme={theme}
            value={value.ip_rights.note}
            onChange={(note) => onChange({ ...value, ip_rights: { ...value.ip_rights, note } })}
            disabled={disabled}
          />
        </div>

        {/* Rate validity */}
        <div className={rowWrapperClass(theme)}>
          <div className="flex items-center justify-between">
            <HelpTerm term="rate_validity" theme={theme} className={cn(labelClass(theme), "block")}>
              Rate validity
            </HelpTerm>
            {rateValidityErrors[0] && <span className={errorTextClass(theme)}>{rateValidityErrors[0]}</span>}
          </div>
          <div className={cn(labelClass(theme), "normal-case tracking-normal")}>How long this bid&apos;s pricing holds</div>
          <DaysPicker
            theme={theme}
            options={RATE_VALIDITY_OPTIONS}
            value={value.rate_validity.days}
            onChange={(days) => onChange({ ...value, rate_validity: { ...value.rate_validity, days } })}
            disabled={disabled}
            hasError={rateValidityErrors.length > 0 && value.rate_validity.days == null}
          />
          <StateControl
            theme={theme}
            value={value.rate_validity.state}
            onChange={(state) => onChange({ ...value, rate_validity: { ...value.rate_validity, state } })}
            disabled={disabled}
            hasError={rateValidityErrors.length > 0}
          />
          <NoteInput
            theme={theme}
            value={value.rate_validity.note}
            onChange={(note) => onChange({ ...value, rate_validity: { ...value.rate_validity, note } })}
            disabled={disabled}
          />
        </div>
      </div>

      {showSaveDefaultOption && (
        <label className="mt-3 flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={saveAsDefault}
            onCheckedChange={(v) => onSaveAsDefaultChange?.(v === true)}
            disabled={disabled}
            className={theme === "light" ? "border-gray-300" : "border-border"}
          />
          <span className={cn("font-mono text-xs", theme === "light" ? "text-gray-700" : "text-foreground")}>
            Save these as my default terms
          </span>
        </label>
      )}
    </div>
  )
}
