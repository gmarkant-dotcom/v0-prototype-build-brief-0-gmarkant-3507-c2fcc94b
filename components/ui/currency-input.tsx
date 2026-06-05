"use client"

import { forwardRef, useCallback } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** Strip non-numeric chars (except one decimal point), format with commas, prepend $. */
function formatUSD(raw: string): string {
  const clean = raw.replace(/[^0-9.]/g, "")
  if (!clean) return ""
  const parts = clean.split(".")
  const integer = parts[0].replace(/^0+(?=\d)/, "") || "0"
  const intFormatted = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const result = parts.length > 1 ? `${intFormatted}.${parts[1].slice(0, 2)}` : intFormatted
  return `$${result}`
}

export interface CurrencyInputProps
  extends Omit<React.ComponentPropsWithoutRef<"input">, "onChange" | "value" | "type"> {
  /** Raw value from state — digits only or any legacy string with $/ commas. Normalised on render. */
  value: string
  /** Always called with the raw numeric string (digits only, no $ or commas). */
  onChange: (raw: string) => void
  className?: string
}

/**
 * Drop-in replacement for budget text inputs.
 * Displays "$1,500,000" while storing "1500000" in parent state.
 * Existing parsers (strip [$,\s] then parseFloat) continue to work unchanged.
 */
export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ value, onChange, className, ...props }, ref) => {
    const display = formatUSD(value)

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.replace(/[^0-9.]/g, "")
        onChange(raw)
      },
      [onChange]
    )

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        className={className}
        {...props}
      />
    )
  }
)
CurrencyInput.displayName = "CurrencyInput"
