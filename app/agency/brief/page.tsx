"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AgencyLayout } from "@/components/agency-layout"
import { StageHeader } from "@/components/stage-header"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import {
  AlertCircle,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  FileCheck,
  Link2,
  Loader2,
  RefreshCw,
  Square,
  Type,
  Upload,
  X,
} from "lucide-react"

type UploadMethod = null | "file" | "google" | "paste"
type AnalysisType = "timeline" | "budget" | "campaigns" | "directors"
type AnalysisStatus =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: unknown }
  | { status: "error"; message: string }
type AnalysesState = Record<AnalysisType, AnalysisStatus>

const ANALYSIS_LABELS: Record<AnalysisType, string> = {
  timeline: "Timeline Recommendation",
  budget: "Budget Estimate",
  campaigns: "Comparable Campaigns (past 5 years)",
  directors: "Director / Production Co Recommendations",
}

const LOADING_MESSAGES: Record<AnalysisType, string> = {
  timeline: "Estimating production phases...",
  budget: "Calculating scope and line items...",
  campaigns: "Finding comparable campaigns from the past 5 years...",
  directors: "Identifying production partners...",
}

const ANALYSIS_COLUMNS: Record<AnalysisType, string> = {
  timeline: "timeline_result",
  budget: "budget_result",
  campaigns: "campaigns_result",
  directors: "directors_result",
}

function deriveBriefTitle(filename: string | null, text: string): string {
  if (filename) {
    const name = filename.replace(/\.[^.]+$/, "")
    return name.length > 60 ? name.slice(0, 60).replace(/\s+\S*$/, "") : name
  }
  const trimmed = text.trim()
  if (trimmed.length <= 60) return trimmed || "Untitled Brief"
  const cut = trimmed.slice(0, 60)
  const lastSpace = cut.lastIndexOf(" ")
  return lastSpace > 30 ? cut.slice(0, lastSpace) : cut
}

// ─── Result card sub-components ────────────────────────────────────────────

function JustificationBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="border-l-2 border-accent/40 pl-3 mt-4">
      <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-1">{label}</div>
      <p className="text-xs text-foreground-muted leading-relaxed">{text}</p>
    </div>
  )
}

function TimelineCard({ data }: { data: unknown }) {
  const d = data as {
    total_weeks_min: number
    total_weeks_max: number
    phases: { name: string; weeks_min: number; weeks_max: number; description: string }[]
    justification: string
  }
  return (
    <div className="space-y-4">
      <div className="text-3xl font-display font-black text-accent">
        {d.total_weeks_min}{d.total_weeks_min !== d.total_weeks_max ? `-${d.total_weeks_max}` : ""} weeks
      </div>
      <div className="space-y-2">
        {d.phases.map((phase, i) => (
          <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-border">
            <div className="font-mono text-[10px] text-accent mt-0.5 whitespace-nowrap">
              {phase.weeks_min}{phase.weeks_min !== phase.weeks_max ? `-${phase.weeks_max}` : ""} wks
            </div>
            <div>
              <div className="font-display font-bold text-sm text-foreground">{phase.name}</div>
              <div className="text-xs text-foreground-muted mt-0.5">{phase.description}</div>
            </div>
          </div>
        ))}
      </div>
      <JustificationBlock label="Why this estimate" text={d.justification} />
    </div>
  )
}

function BudgetCard({ data }: { data: unknown }) {
  const d = data as {
    total_low: number
    total_high: number
    line_items: { label: string; low: number; high: number }[]
    justification: string
  }
  const fmt = (n: number) => `$${n.toLocaleString()}`
  return (
    <div className="space-y-4">
      <div className="text-3xl font-display font-black text-accent">
        {fmt(d.total_low)} - {fmt(d.total_high)}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left pb-2 font-mono text-[10px] text-foreground-muted uppercase">Line Item</th>
            <th className="text-right pb-2 font-mono text-[10px] text-foreground-muted uppercase">Low</th>
            <th className="text-right pb-2 font-mono text-[10px] text-foreground-muted uppercase">High</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {d.line_items.map((item, i) => {
            const isAssumed = item.label.startsWith("ASSUMED:")
            const label = isAssumed ? item.label.slice(8).trim() : item.label
            return (
              <tr key={i}>
                <td className={cn("py-2 pr-4", isAssumed ? "text-foreground-muted italic" : "text-foreground")}>
                  {isAssumed && <span className="font-mono text-[9px] text-foreground-muted mr-1.5">assumed</span>}
                  {label}
                </td>
                <td className="py-2 text-right text-foreground-muted font-mono text-xs">{fmt(item.low)}</td>
                <td className="py-2 text-right text-foreground-muted font-mono text-xs">{fmt(item.high)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <JustificationBlock label="Why this estimate" text={d.justification} />
    </div>
  )
}

function CampaignsCard({ data }: { data: unknown }) {
  const d = data as {
    campaigns: { title: string; brand: string; year: number; director: string; production_company: string; relevance: string }[]
  }
  return (
    <div className="space-y-3">
      {d.campaigns.map((c, i) => (
        <div key={i} className="p-3 rounded-lg bg-white/5 border border-border">
          <div className="font-display font-bold text-sm text-foreground">{c.title}</div>
          <div className="font-mono text-[10px] text-foreground-muted mt-0.5">
            {c.brand} &middot; {c.year} &middot; Dir. {c.director}
          </div>
          <div className="font-mono text-[10px] text-foreground-muted">{c.production_company}</div>
          <p className="text-xs text-foreground-muted mt-2 leading-relaxed border-l-2 border-accent/30 pl-2">{c.relevance}</p>
        </div>
      ))}
    </div>
  )
}

function DirectorsCard({ data }: { data: unknown }) {
  const d = data as {
    recommendations: { name: string; company: string; known_for: string; notable_credits: string; fit_reason: string }[]
  }
  return (
    <div className="space-y-3">
      {d.recommendations.map((r, i) => (
        <div key={i} className="p-3 rounded-lg bg-white/5 border border-border">
          <div className="font-display font-bold text-sm text-foreground">{r.name}</div>
          <div className="font-mono text-[10px] text-foreground-muted">{r.company}</div>
          <p className="text-xs text-foreground-muted mt-1.5">{r.known_for}</p>
          <p className="text-xs text-foreground-muted mt-1 italic">{r.notable_credits}</p>
          <p className="text-xs text-foreground-muted mt-2 leading-relaxed border-l-2 border-accent/30 pl-2">{r.fit_reason}</p>
        </div>
      ))}
    </div>
  )
}

function AnalysisResultCard({
  type,
  state,
  onRetry,
}: {
  type: AnalysisType
  state: AnalysisStatus
  onRetry: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  if (state.status === "idle") return null
  return (
    <div className="rounded-xl border border-border bg-white/[0.03]">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <span className="font-display font-bold text-foreground">{ANALYSIS_LABELS[type]}</span>
        <div className="flex items-center gap-2">
          {state.status === "success" && (
            <>
              <button type="button" onClick={onRetry} className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/10 transition-colors" title="Re-run">
                <RefreshCw className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => setExpanded((e) => !e)} className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/10 transition-colors">
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </>
          )}
        </div>
      </div>
      {state.status === "loading" && (
        <div className="flex items-center gap-3 px-5 py-6 text-foreground-muted">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span className="text-sm">{LOADING_MESSAGES[type]}</span>
        </div>
      )}
      {state.status === "error" && (
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 text-red-400 mb-3">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{state.message}</span>
          </div>
          <Button size="sm" variant="outline" onClick={onRetry} className="border-border text-foreground">Retry</Button>
        </div>
      )}
      {state.status === "success" && expanded && (
        <div className="px-5 py-4">
          {type === "timeline" && <TimelineCard data={state.data} />}
          {type === "budget" && <BudgetCard data={state.data} />}
          {type === "campaigns" && <CampaignsCard data={state.data} />}
          {type === "directors" && <DirectorsCard data={state.data} />}
        </div>
      )}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function BriefInterpretationPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Single stable Supabase client — created once on mount, reused everywhere.
  // Creating inside async handlers risks firing DB requests before the client's
  // internal auth state has fully initialized, which can cause the JWT to be
  // missing from the Authorization header even when getSession() returns a user.
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  useEffect(() => { supabaseRef.current = createClient() }, [])
  const getSupabase = () => {
    if (!supabaseRef.current) supabaseRef.current = createClient()
    return supabaseRef.current
  }


  // Brief input state — mirrors Step 1a pattern
  const [uploadMethod, setUploadMethod] = useState<UploadMethod>(null)
  const [briefFileName, setBriefFileName] = useState("")
  const [briefSourceText, setBriefSourceText] = useState("")
  const [briefAugmentText, setBriefAugmentText] = useState("")
  const [briefUploaded, setBriefUploaded] = useState(false)
  const [isExtractingBrief, setIsExtractingBrief] = useState(false)
  const [briefUploadError, setBriefUploadError] = useState<string | null>(null)
  const [briefExtractWarning, setBriefExtractWarning] = useState<string | null>(null)

  // Paste mode
  const [pastedContent, setPastedContent] = useState("")

  // Google Link mode
  const [googleLink, setGoogleLink] = useState("")
  const [isExtractingGoogle, setIsExtractingGoogle] = useState(false)
  const [googleLinkError, setGoogleLinkError] = useState<string | null>(null)

  // Analyses
  const [checks, setChecks] = useState<Record<AnalysisType, boolean>>({
    timeline: true,
    budget: true,
    campaigns: true,
    directors: true,
  })

  const [pageState, setPageState] = useState<"input" | "results">("input")
  const [interpretationId, setInterpretationId] = useState<string | null>(null)
  const [analyses, setAnalyses] = useState<AnalysesState>({
    timeline: { status: "idle" },
    budget: { status: "idle" },
    campaigns: { status: "idle" },
    directors: { status: "idle" },
  })
  const [hasAnySuccess, setHasAnySuccess] = useState(false)
  const [isInterpreting, setIsInterpreting] = useState(false)
  const [interpretError, setInterpretError] = useState<string | null>(null)

  const effectiveBriefText =
    (briefSourceText + (briefAugmentText.trim() ? `\n\n---\nAdditional brief details:\n${briefAugmentText.trim()}` : "")).trim()

  const anyChecked = Object.values(checks).some(Boolean)
  const canInterpret = briefUploaded && briefSourceText.trim().length > 0 && anyChecked && !isInterpreting && !isExtractingBrief

  // ── File upload handler (server-side extraction via existing route) ──────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBriefUploadError(null)
    setBriefExtractWarning(null)
    setBriefUploaded(true)
    setBriefFileName(file.name)
    setBriefSourceText("")
    setIsExtractingBrief(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/documents/extract-text", { method: "POST", body: form })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || "Could not read this file")
      setBriefExtractWarning(typeof payload?.warning === "string" ? payload.warning : null)
      setBriefSourceText((payload.text || "").toString())
    } catch (err) {
      setBriefUploaded(false)
      setBriefFileName("")
      setBriefExtractWarning(null)
      setBriefUploadError(err instanceof Error ? err.message : "Brief extraction failed")
    } finally {
      setIsExtractingBrief(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  // ── Google Link handler ──────────────────────────────────────────────────
  const handleGoogleImport = async () => {
    if (!googleLink.trim()) return
    setGoogleLinkError(null)
    setIsExtractingGoogle(true)
    try {
      const res = await fetch("/api/extract-google-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: googleLink.trim() }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok || !payload.text) {
        throw new Error(payload?.error || "Failed to import document")
      }
      setBriefSourceText(payload.text)
      setBriefFileName("Google Doc")
      setBriefUploaded(true)
      setBriefUploadError(null)
    } catch (err) {
      setGoogleLinkError(err instanceof Error ? err.message : "Failed to import document")
    } finally {
      setIsExtractingGoogle(false)
    }
  }

  // ── Reset brief ──────────────────────────────────────────────────────────
  const resetBrief = () => {
    setBriefUploaded(false)
    setBriefFileName("")
    setBriefSourceText("")
    setBriefUploadError(null)
    setBriefExtractWarning(null)
    setIsExtractingBrief(false)
    setGoogleLinkError(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // ── Run a single analysis ─────────────────────────────────────────────────
  const runAnalysis = useCallback(
    async (type: AnalysisType, text: string, interpId: string) => {
      setAnalyses((prev) => ({ ...prev, [type]: { status: "loading" } }))
      try {
        const res = await fetch(`/api/interpret/${type}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brief_text: text }),
        })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok || !payload.result) throw new Error(payload?.error || "Analysis failed")
        const result = payload.result
        setAnalyses((prev) => ({ ...prev, [type]: { status: "success", data: result } }))
        setHasAnySuccess(true)
        // Write result to DB via browser client
        const supabase = getSupabase()
        const update: Record<string, unknown> = { [ANALYSIS_COLUMNS[type]]: result }
        if (type === "timeline" && result.brief_summary) update.brief_summary = result.brief_summary
        await supabase.from("brief_interpretations").update(update).eq("id", interpId)
      } catch (err) {
        setAnalyses((prev) => ({
          ...prev,
          [type]: { status: "error", message: err instanceof Error ? err.message : "Analysis failed" },
        }))
      }
    },
    []
  )

  // ── Main interpret handler ───────────────────────────────────────────────
  const handleInterpret = async () => {
    if (!effectiveBriefText) return
    setInterpretError(null)
    setIsInterpreting(true)
    try {
      const supabase = getSupabase()
      // getSession() reads the local session AND refreshes an expired token before
      // returning. This guarantees the access_token sent with the INSERT is fresh,
      // so auth.uid() is non-null on the DB side and the RLS with-check passes.
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user ?? null
      if (!user) { router.push("/auth/login"); return }

      // Diagnostic: visible in browser DevTools console
      console.log("[brief/interpret] auth state", {
        userId: user.id,
        email: user.email,
        hasToken: !!session?.access_token,
        tokenPreview: session?.access_token ? session.access_token.slice(0, 20) + "..." : "MISSING",
        expiresAt: session?.expires_at,
      })

      const briefTitle = deriveBriefTitle(briefFileName || null, effectiveBriefText)
      const selectedAnalyses = (Object.keys(checks) as AnalysisType[]).filter((k) => checks[k])

      console.log("[brief/interpret] inserting row", { user_id: user.id, briefTitle, analyses: selectedAnalyses })
      // Explicit comparison — confirms client-side values are identical before the insert hits RLS
      console.log("[brief/interpret] id match check", JSON.stringify({
        sessionUserId: session?.user?.id,
        payloadUserId: user.id,
        match: session?.user?.id === user.id,
        tokenPrefix: session?.access_token?.slice(0, 10) ?? "NONE",
      }))

      const { data: row, error: insertError } = await supabase
        .from("brief_interpretations")
        .insert({
          user_id: user.id,
          brief_text: effectiveBriefText,
          brief_title: briefTitle,
          analyses_requested: selectedAnalyses,
        })
        .select("id")
        .single()

      if (insertError || !row) {
        const msg = insertError?.message || "Could not save analysis session"
        console.error("[brief/interpret] insert failed", { code: insertError?.code, message: insertError?.message, details: insertError?.details })
        const hint =
          insertError?.code === "42P01"
            ? "The brief_interpretations table does not exist. Run migration 054 in your Supabase SQL Editor first."
            : insertError?.code === "42501" || msg.includes("permission denied") || msg.includes("row-level security")
            ? "Database permission error. Run this SQL in your Supabase SQL Editor: GRANT SELECT, INSERT, UPDATE, DELETE ON brief_interpretations TO authenticated;"
            : msg
        setInterpretError(hint)
        setIsInterpreting(false)
        return
      }

      const id = row.id as string
      setInterpretationId(id)

      // Transition to results only after a successful DB row exists
      const loadingState: Partial<AnalysesState> = {}
      for (const t of selectedAnalyses) loadingState[t] = { status: "loading" }
      setAnalyses((prev) => ({ ...prev, ...loadingState }))
      setPageState("results")

      await Promise.allSettled(selectedAnalyses.map((type) => runAnalysis(type, effectiveBriefText, id)))
    } catch (err) {
      console.error("[brief/interpret] unexpected error", err)
      setInterpretError(err instanceof Error ? err.message : "An unexpected error occurred. Please try again.")
    } finally {
      setIsInterpreting(false)
    }
  }

  const handleRetry = (type: AnalysisType) => {
    if (!effectiveBriefText || !interpretationId) return
    runAnalysis(type, effectiveBriefText, interpretationId)
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <AgencyLayout>
      <div className="p-8 max-w-3xl space-y-6">
        <StageHeader
          stageNumber="00"
          title="Creative Treatment Analysis"
          subtitle="Upload or paste a client brief. Ligament extracts timeline, budget, comparable campaigns, and director recommendations to accelerate your RFP setup."
          aiPowered
        />

        {/* Brief Input - matches Step 1a style */}
        {pageState === "input" && (
          <GlassCard>
            <GlassCardHeader
              label="Step 00"
              title="Creative brief (source)"
              description="Upload the client's brief, import from Google Docs, or paste text. We extract the content so the AI works from your real requirements."
            />

            {/* Method selector - exact match to Step 1a */}
            <div className="flex gap-3 mt-6">
              {([
                { method: "file" as const, label: "Upload File", icon: Upload },
                { method: "google" as const, label: "Google Link", icon: Link2 },
                { method: "paste" as const, label: "Paste Text", icon: Type },
              ] as const).map(({ method, label, icon: Icon }) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => { setUploadMethod(method); resetBrief() }}
                  className={cn(
                    "flex items-center gap-2 px-4 py-3 rounded-lg border transition-all font-mono text-xs font-bold",
                    uploadMethod === method
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border hover:border-white/30 bg-white/5 text-foreground-muted"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>

            {/* Input area */}
            {uploadMethod && !briefUploaded && (
              <div className="mt-6">
                {uploadMethod === "file" && (
                  <>
                    <label className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-accent/50 transition-colors cursor-pointer relative block">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx,.ppt,.pptx,.txt"
                        onChange={handleFileChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
                        <Upload className="w-8 h-8 text-accent" />
                      </div>
                      <div className="font-display font-bold text-foreground mb-1">Drop your file here</div>
                      <div className="font-mono text-[10px] text-foreground-muted">PDF, Word, PowerPoint, or text - click to browse (max 50MB)</div>
                    </label>
                    {briefUploadError && (
                      <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                        {briefUploadError}
                      </div>
                    )}
                  </>
                )}

                {uploadMethod === "google" && (
                  <div className="space-y-3">
                    <label className="font-mono text-[10px] text-foreground-muted uppercase block">
                      Google Docs or Slides URL
                    </label>
                    <Input
                      placeholder="https://docs.google.com/document/d/..."
                      value={googleLink}
                      onChange={(e) => { setGoogleLink(e.target.value); setGoogleLinkError(null) }}
                      className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                      onKeyDown={(e) => { if (e.key === "Enter" && googleLink.trim()) handleGoogleImport() }}
                    />
                    {googleLinkError && (
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{googleLinkError}</span>
                      </div>
                    )}
                    <Button
                      className="bg-accent text-accent-foreground hover:bg-accent/90"
                      disabled={!googleLink.trim() || isExtractingGoogle}
                      onClick={handleGoogleImport}
                    >
                      {isExtractingGoogle ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing...</>
                      ) : (
                        "Import from Google"
                      )}
                    </Button>
                  </div>
                )}

                {uploadMethod === "paste" && (
                  <div className="space-y-3">
                    <label className="font-mono text-[10px] text-foreground-muted uppercase block">
                      Paste Brief Content
                    </label>
                    <Textarea
                      placeholder="Paste the client brief content here..."
                      value={pastedContent}
                      onChange={(e) => setPastedContent(e.target.value)}
                      className="min-h-[200px] bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                    />
                    <Button
                      className="bg-accent text-accent-foreground hover:bg-accent/90"
                      disabled={!pastedContent.trim()}
                      onClick={() => {
                        setBriefSourceText(pastedContent)
                        setBriefFileName("Pasted content")
                        setBriefUploaded(true)
                      }}
                    >
                      Use Pasted Content
                    </Button>
                  </div>
                )}
              </div>
            )}

            {briefUploadError && uploadMethod !== "file" && (
              <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                {briefUploadError}
              </div>
            )}
            {briefExtractWarning && !briefUploadError && (
              <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200">
                {briefExtractWarning}
              </div>
            )}

            {/* Uploaded brief confirmation - matches Step 1a */}
            {briefUploaded && (
              <div className="mt-6 p-4 rounded-lg bg-success/10 border border-success/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                    {isExtractingBrief ? (
                      <Loader2 className="w-5 h-5 text-accent animate-spin" />
                    ) : (
                      <FileCheck className="w-5 h-5 text-success" />
                    )}
                  </div>
                  <div>
                    <div className="font-display font-bold text-sm text-foreground">{briefFileName}</div>
                    <div className="font-mono text-[10px] text-success">
                      {isExtractingBrief ? "Extracting text from document..." : "Ready for AI - text extracted"}
                    </div>
                    {!isExtractingBrief && briefSourceText.trim() && (
                      <div className="font-mono text-[10px] text-foreground-muted mt-1">
                        {briefSourceText.length.toLocaleString()} characters extracted
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetBrief}
                  className="border-border text-foreground-muted hover:bg-white/5"
                >
                  Replace
                </Button>
              </div>
            )}

            {/* Optional additional details - matches Step 1a */}
            <div className="mt-6 space-y-2">
              <label className="font-mono text-[10px] text-foreground-muted uppercase block">
                Optional: Additional brief details
              </label>
              <Textarea
                placeholder="Paste extra requirements or missing text if extraction was incomplete. Appended when analyzing."
                value={briefAugmentText}
                onChange={(e) => setBriefAugmentText(e.target.value)}
                className="min-h-[120px] bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
              />
              {briefAugmentText.trim() && (
                <p className="font-mono text-[10px] text-foreground-muted">
                  +{briefAugmentText.trim().length.toLocaleString()} characters appended when analyzing
                </p>
              )}
            </div>
          </GlassCard>
        )}

        {/* Analyses checkboxes */}
        {pageState === "input" && (
          <GlassCard>
            <GlassCardHeader
              label="Analyses"
              title="Select analyses to run"
              description="All four run in parallel. Uncheck any you don't need."
            />
            <div className="mt-4 space-y-3">
              {(Object.keys(ANALYSIS_LABELS) as AnalysisType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setChecks((prev) => ({ ...prev, [type]: !prev[type] }))}
                  className="flex items-center gap-3 w-full text-left group"
                >
                  {checks[type] ? (
                    <CheckSquare className="w-4 h-4 text-accent shrink-0" />
                  ) : (
                    <Square className="w-4 h-4 text-foreground-muted shrink-0" />
                  )}
                  <span className={cn("text-sm", checks[type] ? "text-foreground" : "text-foreground-muted")}>
                    {ANALYSIS_LABELS[type]}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-6 space-y-3">
              <Button
                onClick={handleInterpret}
                disabled={!canInterpret}
                className="bg-accent text-accent-foreground hover:bg-accent/90 w-full"
              >
                {isInterpreting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analyzing...</>
                ) : (
                  "Analyze Treatment"
                )}
              </Button>
              {interpretError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{interpretError}</span>
                </div>
              )}
            </div>
          </GlassCard>
        )}

        {/* Results */}
        {pageState === "results" && (
          <div className="space-y-4">
            {(Object.keys(analyses) as AnalysisType[])
              .filter((t) => analyses[t].status !== "idle")
              .map((type) => (
                <AnalysisResultCard
                  key={type}
                  type={type}
                  state={analyses[type]}
                  onRetry={() => handleRetry(type)}
                />
              ))}
            {hasAnySuccess && interpretationId && (
              <div className="pt-2">
                <Button
                  onClick={() => router.push(`/agency?interpretation_id=${interpretationId}`)}
                  className="bg-accent text-accent-foreground hover:bg-accent/90 w-full"
                >
                  Build RFP from This Brief
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </AgencyLayout>
  )
}
