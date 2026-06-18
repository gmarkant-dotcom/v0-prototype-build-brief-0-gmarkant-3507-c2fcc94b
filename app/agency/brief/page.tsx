"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AgencyLayout } from "@/components/agency-layout"
import { StageHeader } from "@/components/stage-header"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  AlertCircle,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  RefreshCw,
  Square,
  Upload,
  X,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"

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

async function extractTextFromPdf(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const pdfjsLib = await import("pdfjs-dist")
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
  const parts: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    parts.push(
      content.items
        .map((item: unknown) => (typeof item === "object" && item !== null && "str" in item ? (item as { str: string }).str : ""))
        .join(" ")
    )
  }
  return parts.join("\n").trim()
}

async function extractTextFromDocx(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const mammoth = await import("mammoth")
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return result.value.trim()
}

function deriveBriefTitle(filename: string | null, pastedText: string): string {
  if (filename) {
    const name = filename.replace(/\.[^.]+$/, "")
    return name.length > 60 ? name.slice(0, 60).replace(/\s+\S*$/, "") : name
  }
  const trimmed = pastedText.trim()
  if (trimmed.length <= 60) return trimmed
  const truncated = trimmed.slice(0, 60)
  const lastSpace = truncated.lastIndexOf(" ")
  return lastSpace > 30 ? truncated.slice(0, lastSpace) : truncated
}

// --- Result card renderers ---

function TimelineCard({ data, justification }: { data: unknown; justification: string }) {
  const d = data as {
    total_weeks_min: number
    total_weeks_max: number
    phases: { name: string; weeks_min: number; weeks_max: number; description: string }[]
  }
  return (
    <div className="space-y-4">
      <div className="text-3xl font-display font-black text-accent">
        {d.total_weeks_min}
        {d.total_weeks_min !== d.total_weeks_max ? `-${d.total_weeks_max}` : ""} weeks
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
      <JustificationBlock label="Why this estimate" text={justification} />
    </div>
  )
}

function BudgetCard({ data, justification }: { data: unknown; justification: string }) {
  const d = data as {
    total_low: number
    total_high: number
    currency: string
    line_items: { label: string; low: number; high: number }[]
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
      <JustificationBlock label="Why this estimate" text={justification} />
    </div>
  )
}

function CampaignsCard({ data }: { data: unknown }) {
  const d = data as {
    campaigns: {
      title: string
      brand: string
      year: number
      director: string
      production_company: string
      relevance: string
    }[]
  }
  return (
    <div className="space-y-3">
      {d.campaigns.map((c, i) => (
        <div key={i} className="p-3 rounded-lg bg-white/5 border border-border">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-display font-bold text-sm text-foreground">{c.title}</div>
              <div className="font-mono text-[10px] text-foreground-muted mt-0.5">
                {c.brand} &middot; {c.year} &middot; Dir. {c.director}
              </div>
              <div className="font-mono text-[10px] text-foreground-muted">{c.production_company}</div>
            </div>
          </div>
          <p className="text-xs text-foreground-muted mt-2 leading-relaxed border-l-2 border-accent/30 pl-2">{c.relevance}</p>
        </div>
      ))}
    </div>
  )
}

function DirectorsCard({ data }: { data: unknown }) {
  const d = data as {
    recommendations: {
      name: string
      company: string
      known_for: string
      notable_credits: string
      fit_reason: string
    }[]
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

function JustificationBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="border-l-2 border-accent/40 pl-3 mt-3">
      <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-1">{label}</div>
      <p className="text-xs text-foreground-muted leading-relaxed">{text}</p>
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
              <button
                type="button"
                onClick={onRetry}
                className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/10 transition-colors"
                title="Re-run analysis"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/10 transition-colors"
              >
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
          <Button size="sm" variant="outline" onClick={onRetry} className="border-border text-foreground">
            Retry
          </Button>
        </div>
      )}

      {state.status === "success" && expanded && (
        <div className="px-5 py-4">
          {type === "timeline" && (
            <TimelineCard
              data={state.data}
              justification={(state.data as { justification?: string })?.justification ?? ""}
            />
          )}
          {type === "budget" && (
            <BudgetCard
              data={state.data}
              justification={(state.data as { justification?: string })?.justification ?? ""}
            />
          )}
          {type === "campaigns" && <CampaignsCard data={state.data} />}
          {type === "directors" && <DirectorsCard data={state.data} />}
        </div>
      )}
    </div>
  )
}

// --- Main page ---

export default function BriefInterpretationPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<"upload" | "paste">("upload")
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [briefText, setBriefText] = useState("")
  const [pasteText, setPasteText] = useState("")
  const [uploadingFile, setUploadingFile] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [checks, setChecks] = useState<Record<AnalysisType, boolean>>({
    timeline: true,
    budget: true,
    campaigns: true,
    directors: true,
  })

  const [pageState, setPageState] = useState<"input" | "loading" | "results">("input")
  const [interpretationId, setInterpretationId] = useState<string | null>(null)
  const [analyses, setAnalyses] = useState<AnalysesState>({
    timeline: { status: "idle" },
    budget: { status: "idle" },
    campaigns: { status: "idle" },
    directors: { status: "idle" },
  })
  const [hasAnySuccess, setHasAnySuccess] = useState(false)

  const briefReady = mode === "upload" ? (briefText.trim().length > 0 || fileUrl !== null) : pasteText.trim().length > 100
  const anyChecked = Object.values(checks).some(Boolean)
  const canInterpret = briefReady && anyChecked

  // Track any success
  useEffect(() => {
    const anySuccess = Object.values(analyses).some((a) => a.status === "success")
    if (anySuccess) setHasAnySuccess(true)
  }, [analyses])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return
    setFile(selected)
    setUploadError(null)
    setUploadingFile(true)

    try {
      // Upload to storage
      const formData = new FormData()
      formData.append("file", selected)
      formData.append("folder", "briefs")
      const res = await fetch("/api/upload", { method: "POST", body: formData })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || "Upload failed")
      setFileUrl(payload.url || null)

      // Extract text client-side
      let extracted = ""
      const ext = selected.name.split(".").pop()?.toLowerCase()
      if (ext === "pdf") extracted = await extractTextFromPdf(selected)
      else if (ext === "docx") extracted = await extractTextFromDocx(selected)
      setBriefText(extracted)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploadingFile(false)
    }
  }

  const runAnalysis = useCallback(
    async (type: AnalysisType, currentBriefText: string, currentInterpretationId: string) => {
      setAnalyses((prev) => ({ ...prev, [type]: { status: "loading" } }))
      try {
        const res = await fetch(`/api/interpret/${type}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brief_text: currentBriefText }),
        })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok || !payload.result) throw new Error(payload?.error || "Analysis failed")

        const result = payload.result
        setAnalyses((prev) => ({ ...prev, [type]: { status: "success", data: result } }))

        // Write result to DB via browser client
        const supabase = createClient()
        const colName = ANALYSIS_COLUMNS[type]
        const updatePayload: Record<string, unknown> = { [colName]: result }
        if (type === "timeline" && result.brief_summary) {
          updatePayload.brief_summary = result.brief_summary
        }
        await supabase.from("brief_interpretations").update(updatePayload).eq("id", currentInterpretationId)
      } catch (err) {
        setAnalyses((prev) => ({
          ...prev,
          [type]: { status: "error", message: err instanceof Error ? err.message : "Analysis failed" },
        }))
      }
    },
    []
  )

  const handleInterpret = async () => {
    const effectiveBriefText = mode === "paste" ? pasteText.trim() : briefText.trim()
    if (!effectiveBriefText) return

    // Verify session
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push("/auth/login")
      return
    }

    const briefTitle = deriveBriefTitle(file?.name ?? null, effectiveBriefText)
    const selectedAnalyses = (Object.keys(checks) as AnalysisType[]).filter((k) => checks[k])

    // Mark selected analyses as loading
    const loadingState: Partial<AnalysesState> = {}
    for (const t of selectedAnalyses) loadingState[t] = { status: "loading" }
    setAnalyses((prev) => ({ ...prev, ...loadingState }))
    setPageState("loading")

    // Create interpretation row
    const { data: row, error: insertError } = await supabase
      .from("brief_interpretations")
      .insert({
        user_id: user.id,
        brief_text: effectiveBriefText,
        brief_file_url: fileUrl,
        brief_title: briefTitle,
        analyses_requested: selectedAnalyses,
      })
      .select("id")
      .single()

    if (insertError || !row) {
      console.error("[brief/interpret] insert error", insertError)
      setPageState("input")
      return
    }

    const id = row.id as string
    setInterpretationId(id)
    setPageState("results")

    // Fire all selected analyses in parallel
    await Promise.allSettled(selectedAnalyses.map((type) => runAnalysis(type, effectiveBriefText, id)))
  }

  const handleRetry = async (type: AnalysisType) => {
    const effectiveBriefText = mode === "paste" ? pasteText.trim() : briefText.trim()
    if (!effectiveBriefText || !interpretationId) return
    await runAnalysis(type, effectiveBriefText, interpretationId)
  }

  const toggleCheck = (type: AnalysisType) => {
    setChecks((prev) => ({ ...prev, [type]: !prev[type] }))
  }

  return (
    <AgencyLayout>
      <div className="p-8 max-w-3xl space-y-8">
        <StageHeader
          stageNumber="00"
          title="Creative Brief Interpretation"
          subtitle="Upload or paste a client brief. Ligament extracts timeline, budget, comparable campaigns, and director recommendations to accelerate your RFP setup."
          aiPowered
        />

        {pageState === "input" && (
          <div className="space-y-6">
            {/* Mode toggle */}
            <div className="flex gap-2">
              {(["upload", "paste"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "px-4 py-2 rounded-full font-mono text-xs border transition-colors",
                    mode === m
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-foreground-muted hover:border-white/30"
                  )}
                >
                  {m === "upload" ? "Upload File" : "Paste Text"}
                </button>
              ))}
            </div>

            {/* Upload mode */}
            {mode === "upload" && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {!file ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border border-dashed border-border rounded-xl p-10 flex flex-col items-center gap-3 hover:border-accent/50 hover:bg-accent/5 transition-colors text-center"
                  >
                    <Upload className="w-8 h-8 text-foreground-muted" />
                    <div>
                      <div className="font-display font-bold text-foreground">Click to upload brief</div>
                      <div className="font-mono text-xs text-foreground-muted mt-1">PDF or DOCX, up to 10 MB</div>
                    </div>
                  </button>
                ) : (
                  <div className="rounded-xl border border-border bg-white/5 p-4 flex items-center gap-3">
                    <FileText className="w-5 h-5 text-accent shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-bold text-sm text-foreground truncate">{file.name}</div>
                      {uploadingFile && (
                        <div className="flex items-center gap-1.5 mt-1 text-foreground-muted">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span className="font-mono text-[10px]">Uploading and extracting text...</span>
                        </div>
                      )}
                      {!uploadingFile && briefText && (
                        <div className="font-mono text-[10px] text-foreground-muted mt-1">
                          {briefText.length.toLocaleString()} characters extracted
                        </div>
                      )}
                      {uploadError && (
                        <div className="font-mono text-[10px] text-red-400 mt-1">{uploadError}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null)
                        setFileUrl(null)
                        setBriefText("")
                        setUploadError(null)
                        if (fileInputRef.current) fileInputRef.current.value = ""
                      }}
                      className="text-foreground-muted hover:text-foreground"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Paste mode */}
            {mode === "paste" && (
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste your creative brief here..."
                className="w-full min-h-[200px] rounded-xl border border-border bg-white/5 px-4 py-3 text-sm text-foreground placeholder:text-foreground-muted resize-y focus:outline-none focus:border-accent/50"
              />
            )}

            {/* Analyses checkboxes */}
            <div className="space-y-2">
              <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">Analyses to run</div>
              {(Object.keys(ANALYSIS_LABELS) as AnalysisType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleCheck(type)}
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

            <Button
              onClick={handleInterpret}
              disabled={!canInterpret || uploadingFile}
              className="bg-accent text-accent-foreground hover:bg-accent/90 w-full"
            >
              {uploadingFile ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Extracting text...
                </>
              ) : (
                "Interpret Brief"
              )}
            </Button>
          </div>
        )}

        {/* Loading skeleton state */}
        {pageState === "loading" && (
          <div className="space-y-4">
            {(Object.keys(checks) as AnalysisType[])
              .filter((t) => checks[t])
              .map((type) => (
                <div key={type} className="rounded-xl border border-border bg-white/[0.03] p-5">
                  <div className="flex items-center gap-3 text-foreground-muted">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <div>
                      <div className="font-display font-bold text-sm text-foreground">{ANALYSIS_LABELS[type]}</div>
                      <div className="text-xs mt-0.5">{LOADING_MESSAGES[type]}</div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
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
              <div className="pt-4">
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
