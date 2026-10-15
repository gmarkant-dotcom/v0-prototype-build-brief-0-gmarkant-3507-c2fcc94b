"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useUsageLimitModal } from "@/contexts/usage-limit-modal-context"
import {
  VENDOR_TEXT_REASON_LABEL,
  checkVendorText,
  diffWords,
  type VendorTextCheckInput,
  type VendorTextMatch,
} from "@/lib/rfp-vendor-text-check"

/**
 * Ruling OV-A at send: WARN, NEVER BLOCK. Rendered just above the send button of the wizard and of
 * Lightning. The check runs in the browser (lib/rfp-vendor-text-check.ts), debounced while the agency
 * edits, with no server call. "Suggest vendor-safe rewrite" is the only server call: one request to
 * POST /api/agency/rfp-text/rewrite (paid agency gate, organization check, usage counted). The
 * suggestion is shown as a word diff in plain text, never as HTML, and is applied only when the
 * agency accepts it; editing and ignoring are both fine, and sending works either way. Nothing here
 * sends anything to a vendor.
 */

const DEBOUNCE_MS = 400

type Suggestion = { field: string; label: string; before: string; after: string; draft: string }

export function VendorTextWarnings({
  input,
  projectId,
  onApply,
  canApply = () => true,
}: {
  input: VendorTextCheckInput
  /** The project this RFP is sent for; the rewrite route checks it belongs to the caller. */
  projectId: string | null
  /** Writes accepted text back into the field the match came from. */
  onApply: (field: string, text: string) => void
  /** Fields this screen cannot edit are still warned about, but not offered for a rewrite. */
  canApply?: (field: string) => boolean
}) {
  const { handleUsageLimitError } = useUsageLimitModal()

  // Debounced: the check reruns 400 ms after the last edit, keyed on the input's content.
  const inputKey = JSON.stringify(input)
  const [checkedKey, setCheckedKey] = useState(inputKey)
  useEffect(() => {
    const t = setTimeout(() => setCheckedKey(inputKey), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [inputKey])
  const matches = useMemo<VendorTextMatch[]>(
    () => checkVendorText(JSON.parse(checkedKey) as VendorTextCheckInput),
    [checkedKey]
  )

  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])

  if (matches.length === 0 && suggestions.length === 0) return null

  const flaggedFields = [...new Set(matches.map((m) => m.field))].filter(canApply)
  const textByField = new Map(input.fields.map((f) => [f.field, typeof f.text === "string" ? f.text : ""]))
  const labelByField = new Map(input.fields.map((f) => [f.field, f.label]))

  const suggest = async () => {
    if (!projectId) {
      setSuggestError("Select the project this RFP is for to get a suggestion.")
      return
    }
    setSuggesting(true)
    setSuggestError(null)
    try {
      const res = await fetch("/api/agency/rfp-text/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          client_hidden: input.clientHidden,
          fields: flaggedFields.map((field) => ({
            field,
            label: labelByField.get(field) ?? field,
            text: textByField.get(field) ?? "",
            reasons: [...new Set(matches.filter((m) => m.field === field).map((m) => m.reason))],
          })),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { rewrites?: { field: string; text: string }[]; error?: string }
      if (!res.ok) {
        handleUsageLimitError(res.status, data)
        setSuggestError(res.status === 402 ? "Suggestions are unavailable on your current plan or usage." : data.error || "No suggestion this time. Please try again.")
        return
      }
      const next: Suggestion[] = []
      for (const r of data.rewrites ?? []) {
        const before = textByField.get(r.field)
        if (before === undefined || typeof r.text !== "string" || r.text === before) continue
        next.push({ field: r.field, label: labelByField.get(r.field) ?? r.field, before, after: r.text, draft: r.text })
      }
      if (next.length === 0) setSuggestError("No changes suggested. You can edit the text yourself or send as it is.")
      setSuggestions(next)
    } catch {
      setSuggestError("No suggestion this time. Please try again.")
    } finally {
      setSuggesting(false)
    }
  }

  const dismiss = (field: string) => setSuggestions((prev) => prev.filter((s) => s.field !== field))

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 space-y-3" role="status" aria-live="polite">
      {matches.length > 0 && (
        <>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" aria-hidden />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Vendors will read this text</p>
              <p className="text-xs text-foreground-muted">
                {matches.length === 1 ? "One passage" : `${matches.length} passages`} may say more than you intend. You can
                send as it is, edit the text, or ask for a vendor-safe rewrite.
              </p>
            </div>
          </div>
          <ul className="space-y-1.5">
            {matches.map((m, i) => (
              <li key={`${m.field}-${m.reason}-${i}`} className="text-xs text-foreground">
                <span className="font-mono text-2xs uppercase tracking-wider text-amber-300">{m.label}</span>
                <span className="text-foreground-muted"> · {VENDOR_TEXT_REASON_LABEL[m.reason]}: </span>
                <Excerpt excerpt={m.excerpt} matched={m.matched} />
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={suggesting || flaggedFields.length === 0}
              onClick={() => void suggest()}
              className="border-amber-500/40 text-foreground hover:bg-amber-500/10 flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden />
              {suggesting ? "Suggesting..." : "Suggest vendor-safe rewrite"}
            </Button>
            {suggestError && <span className="text-xs text-amber-200">{suggestError}</span>}
          </div>
        </>
      )}

      {suggestions.map((s) => (
        <div key={s.field} className="rounded-lg border border-border bg-background/60 p-3 space-y-2">
          <p className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">Suggested: {s.label}</p>
          <p className="text-xs leading-relaxed whitespace-pre-wrap">
            {diffWords(s.before, s.after).map((part, i) =>
              part.kind === "same" ? (
                <span key={i} className="text-foreground-muted">{part.text}</span>
              ) : part.kind === "removed" ? (
                <del key={i} className="text-red-300 line-through">{part.text}</del>
              ) : (
                <ins key={i} className="text-emerald-300 no-underline">{part.text}</ins>
              )
            )}
          </p>
          <label className="block">
            <span className="sr-only">Edit the suggestion for {s.label}</span>
            <Textarea
              value={s.draft}
              onChange={(e) => {
                const draft = e.target.value
                setSuggestions((prev) => prev.map((x) => (x.field === s.field ? { ...x, draft } : x)))
              }}
              rows={Math.min(8, Math.max(2, Math.ceil(s.draft.length / 90)))}
              className="bg-white/5 border-border text-foreground text-xs"
            />
          </label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onApply(s.field, s.draft)
                dismiss(s.field)
              }}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              Use this text
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => dismiss(s.field)} className="text-foreground">
              Keep mine
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

/** The excerpt with the matched words emphasised. Plain text nodes only. */
function Excerpt({ excerpt, matched }: { excerpt: string; matched: string }) {
  const at = excerpt.indexOf(matched)
  if (at < 0) return <span className="text-foreground-muted">&ldquo;{excerpt}&rdquo;</span>
  return (
    <span className="text-foreground-muted">
      &ldquo;{excerpt.slice(0, at)}
      <mark className="bg-amber-500/30 text-foreground rounded px-0.5">{matched}</mark>
      {excerpt.slice(at + matched.length)}&rdquo;
    </span>
  )
}
