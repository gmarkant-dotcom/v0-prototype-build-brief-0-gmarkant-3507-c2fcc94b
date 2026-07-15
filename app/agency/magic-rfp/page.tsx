"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { AgencyLayout } from "@/components/agency-layout"
import { InlineProjectSelector } from "@/components/agency-project-selector"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Spinner } from "@/components/ui/spinner"
import { ReferenceMaterialsInput, type ReferenceMaterial } from "@/components/reference-materials-input"
import {
  RfpOutputTemplate,
  type OutputTemplateMode,
  type TemplateStyle,
  type OutputFormat,
  type SensitivityOptions,
  type UploadedTemplate,
} from "@/components/rfp-output-template"
import { useSelectedProject } from "@/contexts/selected-project-context"
import { usePaidUser } from "@/contexts/paid-user-context"
import { createClient } from "@/lib/supabase/client"
import { isDemoMode } from "@/lib/demo-data"
import { readTextStream } from "@/lib/read-text-stream"
import { cn } from "@/lib/utils"
import { Zap, Plus, Trash2, Check, X, FolderOpen, Copy, Send, ChevronDown, ChevronUp } from "lucide-react"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type BriefData = {
  projectName: string
  clientName: string
  scopeDescription: string
  budgetRange: string
  timeline: string
}

const EMPTY_BRIEF: BriefData = {
  projectName: "",
  clientName: "",
  scopeDescription: "",
  budgetRange: "",
  timeline: "",
}

type CheckResult = { is_existing_partner: boolean } | null

type RecipientRow = {
  id: string
  email: string
  name: string
  checking: boolean
  checkResult: CheckResult
  sendStatus: "idle" | "sending" | "sent" | "error"
}

function newRecipientRow(): RecipientRow {
  return {
    id: crypto.randomUUID(),
    email: "",
    name: "",
    checking: false,
    checkResult: null,
    sendStatus: "idle",
  }
}

type SendResult = {
  email: string
  name: string
  success: boolean
  token?: string
  error?: string
}

function formatDateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function MagicRfpContent() {
  const { selectedProject, setSelectedProject, projects, isLoadingProjects } = useSelectedProject()
  const { checkFeatureAccess } = usePaidUser()
  const isDemo = isDemoMode()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [brief, setBrief] = useState<BriefData>(EMPTY_BRIEF)
  const [loadingProjectData, setLoadingProjectData] = useState(false)
  const [referenceMaterials, setReferenceMaterials] = useState<ReferenceMaterial[]>([])
  const [agencyId, setAgencyId] = useState<string | null>(null)
  const [hasUsedSelectedProject, setHasUsedSelectedProject] = useState(false)

  // Step 1: Advanced Options — output template (collapsed by default)
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false)
  const [templateMode, setTemplateMode] = useState<OutputTemplateMode>("upload")
  const [templateStyle, setTemplateStyle] = useState<TemplateStyle>("formal")
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("section")
  const [sensitivity, setSensitivity] = useState<SensitivityOptions>({
    scrubBrand: false,
    scrubBudget: false,
    scrubStrategy: false,
    scrubTimeline: false,
  })
  const [uploadedTemplate, setUploadedTemplate] = useState<UploadedTemplate>(null)
  const [generatedTemplateText, setGeneratedTemplateText] = useState("")
  const [isTemplateReady, setIsTemplateReady] = useState(false)
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false)
  const [templateUploadError, setTemplateUploadError] = useState<string | null>(null)
  const [templateExtractWarning, setTemplateExtractWarning] = useState<string | null>(null)
  const [isGeneratingTemplate, setIsGeneratingTemplate] = useState(false)
  const [templateGenerateError, setTemplateGenerateError] = useState<string | null>(null)

  const [recipients, setRecipients] = useState<RecipientRow[]>([newRecipientRow()])
  const [sending, setSending] = useState(false)
  const [sendResults, setSendResults] = useState<SendResult[]>([])
  const [copyLabel, setCopyLabel] = useState("Copy All Links")

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // On load: check for a prefill handed off from the RFP Broadcast Step 1 "Send as
  // Lightning RFP Magic Link" button, then clear it so it doesn't leak into later visits.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("magic_rfp_prefill")
      if (raw) {
        const parsed = JSON.parse(raw)
        setBrief((prev) => ({
          ...prev,
          projectName: parsed.projectName || prev.projectName,
          clientName: parsed.clientName || prev.clientName,
          scopeDescription: parsed.scopeDescription || prev.scopeDescription,
          budgetRange: parsed.budgetRange || prev.budgetRange,
          timeline: parsed.timeline || prev.timeline,
        }))
        sessionStorage.removeItem("magic_rfp_prefill")
      }
    } catch {
      // ignore malformed/unavailable sessionStorage
    }
  }, [])

  useEffect(() => {
    return () => {
      Object.values(debounceTimers.current).forEach((t) => clearTimeout(t))
    }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => setAgencyId(user?.id ?? null))
  }, [])

  const useSelectedProjectData = async () => {
    if (!selectedProject?.id) return
    setLoadingProjectData(true)
    try {
      const supabase = createClient()
      const { data } = await supabase
        .from("projects")
        .select("id, name, client_name, description, budget_range, start_date, end_date")
        .eq("id", selectedProject.id)
        .maybeSingle()

      const dateRange = data
        ? [formatDateOnly(data.start_date as string | null), formatDateOnly(data.end_date as string | null)]
            .filter(Boolean)
            .join(" – ")
        : ""

      setBrief({
        projectName: (data?.name as string) || selectedProject.name || "",
        clientName: (data?.client_name as string) || selectedProject.client || "",
        scopeDescription: (data?.description as string) || "",
        budgetRange: (data?.budget_range as string) || "",
        timeline: dateRange,
      })
    } finally {
      setLoadingProjectData(false)
    }
  }

  // Re-populate the brief automatically when the project is switched via the dropdown,
  // but only if "Use Selected Project" was already clicked once for this session.
  useEffect(() => {
    if (hasUsedSelectedProject && selectedProject?.id) {
      void useSelectedProjectData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id])

  const handleTemplateFileSelect = async (file: File) => {
    if (!checkFeatureAccess("file uploads")) {
      setTemplateUploadError("File uploads require an active subscription (or use demo mode).")
      return
    }
    setTemplateUploadError(null)
    setTemplateExtractWarning(null)
    setIsUploadingTemplate(true)
    try {
      const extractFd = new FormData()
      extractFd.append("file", file)
      const extractRes = await fetch("/api/documents/extract-text", { method: "POST", body: extractFd })
      const extractPayload = await extractRes.json().catch(() => ({}))
      if (!extractRes.ok) throw new Error(extractPayload?.error || "Could not read template text")

      setUploadedTemplate({ name: file.name, url: "" })
      const warning = typeof extractPayload?.warning === "string" ? extractPayload.warning : null
      setTemplateExtractWarning(warning)
      setGeneratedTemplateText((extractPayload.text || "").toString())
      setTemplateMode("upload")
    } catch (err) {
      setTemplateUploadError(err instanceof Error ? err.message : "Template processing failed")
      setTemplateExtractWarning(null)
      setUploadedTemplate(null)
      setGeneratedTemplateText("")
    } finally {
      setIsUploadingTemplate(false)
    }
  }

  const handleRemoveUploadedTemplate = () => {
    setUploadedTemplate(null)
    setGeneratedTemplateText("")
    setTemplateUploadError(null)
    setTemplateExtractWarning(null)
  }

  const handleSensitivityChange = (key: keyof SensitivityOptions, value: boolean) => {
    setSensitivity((prev) => ({ ...prev, [key]: value }))
  }

  const generateOutputTemplate = async () => {
    setTemplateGenerateError(null)
    const sourceText = brief.scopeDescription.trim()
    if (!sourceText) {
      setTemplateGenerateError("Add a scope description above first — AI needs that text to infer structure.")
      return
    }
    if (!checkFeatureAccess("AI output template")) {
      setTemplateGenerateError("Subscription required for AI features, or enable demo mode.")
      return
    }
    setIsTemplateReady(false)
    setIsGeneratingTemplate(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 125_000)
    try {
      setGeneratedTemplateText("")
      setUploadedTemplate(null)
      setTemplateExtractWarning(null)
      setTemplateUploadError(null)

      const res = await fetch("/api/ai/rfp-output-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          briefText: sourceText,
          templateStyle,
          outputFormat,
          sensitivity,
        }),
      })
      if (!res.ok) {
        const errorText = await res.text().catch(() => "")
        let payload: Record<string, unknown> = {}
        try {
          payload = JSON.parse(errorText) as Record<string, unknown>
        } catch {
          payload = {}
        }
        const parts = [
          typeof payload.error === "string" ? payload.error : null,
          typeof payload.hint === "string" ? payload.hint : null,
          typeof payload.detail === "string" ? payload.detail : null,
          !payload.error && !payload.detail && !payload.hint ? errorText.trim() || `HTTP ${res.status}` : null,
        ].filter(Boolean)
        throw new Error(parts.join(" — ") || "Generation failed")
      }
      if (!res.body) throw new Error("No stream body returned from template route")

      const text = await readTextStream(res.body, (fullText) => setGeneratedTemplateText(fullText))
      if (!text.trim()) {
        throw new Error("AI returned an empty template. Check server logs and ANTHROPIC_API_KEY on Vercel.")
      }
      setIsTemplateReady(true)
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setTemplateGenerateError("Request timed out or was cancelled. Claude can take 30–90s.")
      } else {
        setTemplateGenerateError(e instanceof Error ? e.message : "Template generation failed")
      }
    } finally {
      clearTimeout(timeoutId)
      setIsGeneratingTemplate(false)
    }
  }

  const briefValid =
    brief.projectName.trim().length > 0 &&
    brief.clientName.trim().length > 0 &&
    brief.scopeDescription.trim().length > 0 &&
    brief.budgetRange.trim().length > 0

  const handleEmailChange = (id: string, email: string) => {
    setRecipients((prev) => prev.map((r) => (r.id === id ? { ...r, email, checkResult: null } : r)))

    if (debounceTimers.current[id]) clearTimeout(debounceTimers.current[id])
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !EMAIL_RE.test(trimmed)) return

    setRecipients((prev) => prev.map((r) => (r.id === id ? { ...r, checking: true } : r)))
    debounceTimers.current[id] = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ check_email: trimmed })
        if (selectedProject?.id) params.set("project_id", selectedProject.id)
        const res = await fetch(`/api/agency/rfp/magic-link?${params.toString()}`, { cache: "no-store" })
        const data = await res.json().catch(() => ({}))
        setRecipients((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, checking: false, checkResult: res.ok ? { is_existing_partner: Boolean(data.is_existing_partner) } : null }
              : r
          )
        )
      } catch {
        setRecipients((prev) => prev.map((r) => (r.id === id ? { ...r, checking: false } : r)))
      }
    }, 500)
  }

  const addRecipient = () => setRecipients((prev) => [...prev, newRecipientRow()])
  const removeRecipient = (id: string) =>
    setRecipients((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev))

  const recipientsValid =
    recipients.length > 0 && recipients.every((r) => EMAIL_RE.test(r.email.trim().toLowerCase()))

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const sendLightningRfps = async () => {
    setSending(true)
    const results: SendResult[] = []
    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i]
      setRecipients((prev) => prev.map((x) => (x.id === r.id ? { ...x, sendStatus: "sending" } : x)))
      try {
        const res = await fetch("/api/agency/rfp/magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vendor_email: r.email.trim().toLowerCase(),
            vendor_name: r.name.trim() || undefined,
            project_id: selectedProject?.id ?? null,
            scope_item_name: brief.projectName,
            scope_item_description: brief.scopeDescription,
            reference_materials: referenceMaterials,
            output_template_config: {
              mode: templateMode,
              templateStyle,
              outputFormat,
              sensitivity,
              uploadedTemplate,
              generatedTemplate: generatedTemplateText,
            },
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          results.push({ email: r.email, name: r.name, success: false, error: data?.error || "Failed to send invitation" })
          setRecipients((prev) => prev.map((x) => (x.id === r.id ? { ...x, sendStatus: "error" } : x)))
        } else {
          results.push({ email: r.email, name: r.name, success: true, token: data.token })
          setRecipients((prev) => prev.map((x) => (x.id === r.id ? { ...x, sendStatus: "sent" } : x)))
        }
      } catch {
        results.push({ email: r.email, name: r.name, success: false, error: "Network error — please try again" })
        setRecipients((prev) => prev.map((x) => (x.id === r.id ? { ...x, sendStatus: "error" } : x)))
      }
      if (i < recipients.length - 1) await sleep(100)
    }
    if (referenceMaterials.length > 0 && results.some((r) => r.success)) {
      await saveReferenceMaterialsToLibrary(referenceMaterials)
    }
    setSendResults(results)
    setSending(false)
    setStep(3)
  }

  const saveReferenceMaterialsToLibrary = async (materials: ReferenceMaterial[]) => {
    for (const material of materials) {
      try {
        await fetch("/api/agency/library-documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            section: "agency",
            kind: "other",
            label: material.label,
            source_type: material.type === "link" ? "url" : "file",
            external_url: material.type === "link" ? material.url : null,
            blob_url: material.type === "file" ? material.url : null,
            file_name: material.type === "file" ? material.label : null,
          }),
        })
      } catch (err) {
        console.error("Failed to save reference material to library:", material.label, err)
      }
    }
  }

  const copyAllLinks = async () => {
    const links = sendResults
      .filter((r) => r.success && r.token)
      .map((r) => `https://withligament.com/rfp/respond/${r.token}`)
      .join("\n")
    try {
      await navigator.clipboard.writeText(links)
      setCopyLabel("Copied!")
      setTimeout(() => setCopyLabel("Copy All Links"), 2000)
    } catch {
      setCopyLabel("Copy failed")
      setTimeout(() => setCopyLabel("Copy All Links"), 2000)
    }
  }

  const sendAnotherRound = () => {
    setBrief(EMPTY_BRIEF)
    setRecipients([newRecipientRow()])
    setSendResults([])
    setCopyLabel("Copy All Links")
    setStep(1)
  }

  return (
      <div className="p-8 max-w-3xl">
        {!isDemo && (
          <InlineProjectSelector
            selectedProject={selectedProject}
            projects={projects}
            isLoadingProjects={isLoadingProjects}
            onSelect={setSelectedProject}
          />
        )}

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-10 h-10 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5 text-accent" />
            </span>
            <h1 className="font-display font-black text-4xl md:text-5xl text-foreground leading-tight">
              Lightning RFP Magic Link
            </h1>
          </div>
          <p className="font-sans text-sm text-foreground-muted max-w-2xl leading-relaxed">
            Create a brief and send instant bid invitations to any vendor — no account required.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {([1, 2, 3] as const).map((n) => (
            <div key={n} className="flex items-center gap-2">
              <span
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center font-mono text-xs shrink-0",
                  step === n
                    ? "bg-accent text-accent-foreground"
                    : step > n
                      ? "bg-accent/20 text-accent"
                      : "bg-white/5 text-foreground-muted"
                )}
              >
                {step > n ? <Check className="w-3.5 h-3.5" /> : n}
              </span>
              <span className={cn("font-mono text-xs", step === n ? "text-foreground" : "text-foreground-muted")}>
                {n === 1 ? "Project Brief" : n === 2 ? "Add Recipients" : "Confirmation"}
              </span>
              {n < 3 && <span className="w-6 h-px bg-border mx-1" />}
            </div>
          ))}
        </div>

        {/* STEP 1: Project Brief */}
        {step === 1 && (
          <div className="space-y-6">
            <GlassCard>
              <GlassCardHeader
                label="Step 1"
                title="Project Brief"
                description="The essentials — this is what recipients will see when they open their invitation."
              />

              <div className="flex justify-end -mt-2 mb-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!selectedProject?.id || loadingProjectData}
                  onClick={() => {
                    setHasUsedSelectedProject(true)
                    void useSelectedProjectData()
                  }}
                  className="border-border text-foreground-muted hover:bg-white/5 flex items-center gap-2"
                >
                  {loadingProjectData ? <Spinner className="size-3.5" /> : <FolderOpen className="w-3.5 h-3.5" />}
                  Use Selected Project
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="font-mono text-[10px] text-foreground-muted uppercase block mb-2">
                    Project name
                  </label>
                  <Input
                    value={brief.projectName}
                    onChange={(e) => setBrief((prev) => ({ ...prev, projectName: e.target.value }))}
                    placeholder="Q3 Brand Campaign"
                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                  />
                </div>
                <div>
                  <label className="font-mono text-[10px] text-foreground-muted uppercase block mb-2">
                    Client name
                  </label>
                  <Input
                    value={brief.clientName}
                    onChange={(e) => setBrief((prev) => ({ ...prev, clientName: e.target.value }))}
                    placeholder="Client Inc."
                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                  />
                </div>
                <div>
                  <label className="font-mono text-[10px] text-foreground-muted uppercase block mb-2">
                    Scope description
                  </label>
                  <Textarea
                    rows={4}
                    value={brief.scopeDescription}
                    onChange={(e) => setBrief((prev) => ({ ...prev, scopeDescription: e.target.value }))}
                    placeholder="Describe what you need done"
                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="font-mono text-[10px] text-foreground-muted uppercase block mb-2">
                      Budget range
                    </label>
                    <Input
                      value={brief.budgetRange}
                      onChange={(e) => setBrief((prev) => ({ ...prev, budgetRange: e.target.value }))}
                      placeholder="$50,000 – $100,000"
                      className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                    />
                  </div>
                  <div>
                    <label className="font-mono text-[10px] text-foreground-muted uppercase block mb-2">
                      Timeline <span className="text-foreground-muted/60 normal-case">(optional)</span>
                    </label>
                    <Input
                      value={brief.timeline}
                      onChange={(e) => setBrief((prev) => ({ ...prev, timeline: e.target.value }))}
                      placeholder="e.g. Q3 2026, 8 weeks"
                      className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-border/40 bg-white/5">
                  <button
                    type="button"
                    onClick={() => setAdvancedOptionsOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <div>
                      <div className="font-display font-bold text-sm text-foreground">Advanced Options</div>
                      <p className="font-mono text-[10px] text-foreground-muted mt-0.5">
                        Output template — style, sensitivity, and format for the generated brief.
                      </p>
                    </div>
                    {advancedOptionsOpen ? (
                      <ChevronUp className="w-4 h-4 text-foreground-muted shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-foreground-muted shrink-0" />
                    )}
                  </button>
                  {advancedOptionsOpen && (
                    <div className="px-4 pb-4 border-t border-border/30 pt-4">
                      <RfpOutputTemplate
                        mode={templateMode}
                        onModeChange={setTemplateMode}
                        uploadedTemplate={uploadedTemplate}
                        onFileSelect={(file) => void handleTemplateFileSelect(file)}
                        onRemoveUploadedTemplate={handleRemoveUploadedTemplate}
                        isUploadingTemplate={isUploadingTemplate}
                        uploadError={templateUploadError}
                        extractWarning={templateExtractWarning}
                        templateStyle={templateStyle}
                        onTemplateStyleChange={setTemplateStyle}
                        sensitivity={sensitivity}
                        onSensitivityChange={handleSensitivityChange}
                        outputFormat={outputFormat}
                        onOutputFormatChange={setOutputFormat}
                        isGenerating={isGeneratingTemplate}
                        onGenerate={() => void generateOutputTemplate()}
                        generateError={templateGenerateError}
                        generatedTemplateText={generatedTemplateText}
                        isTemplateReady={isTemplateReady}
                      />
                    </div>
                  )}
                </div>

                <ReferenceMaterialsInput
                  projectId={selectedProject?.id ?? null}
                  agencyId={agencyId ?? ""}
                  onChange={setReferenceMaterials}
                />
              </div>
            </GlassCard>

            <div className="flex justify-end">
              <Button
                disabled={!briefValid}
                onClick={() => setStep(2)}
                className="bg-accent text-accent-foreground hover:bg-accent/90 px-8"
              >
                Continue to Recipients
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: Add Recipients */}
        {step === 2 && (
          <div className="space-y-6">
            <GlassCard>
              <GlassCardHeader
                label="Step 2"
                title="Add Recipients"
                description="Every recipient gets their own 72-hour link — no Ligament account needed to bid."
              />

              <div className="space-y-3">
                {recipients.map((r) => (
                  <div key={r.id} className="flex items-start gap-2">
                    <div className="flex-1">
                      <Input
                        type="email"
                        value={r.email}
                        onChange={(e) => handleEmailChange(r.id, e.target.value)}
                        placeholder="vendor@company.com"
                        className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                      />
                      {(r.checking || r.checkResult) && (
                        <p className="font-mono text-[10px] mt-1.5">
                          {r.checking ? (
                            <span className="text-foreground-muted">Checking…</span>
                          ) : r.checkResult?.is_existing_partner ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-300">
                              In your partner pool
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-white/10 text-foreground-muted">
                              New vendor
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex-1">
                      <Input
                        value={r.name}
                        onChange={(e) =>
                          setRecipients((prev) => prev.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))
                        }
                        placeholder="Vendor name (optional)"
                        className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={recipients.length <= 1}
                      onClick={() => removeRecipient(r.id)}
                      className="text-foreground-muted hover:text-red-400 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRecipient}
                className="mt-4 border-border text-foreground-muted hover:bg-white/5 flex items-center gap-2"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Recipient
              </Button>
            </GlassCard>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)} className="border-border text-foreground hover:bg-white/5">
                Back
              </Button>
              <Button
                disabled={!recipientsValid || sending}
                onClick={() => void sendLightningRfps()}
                className="bg-accent text-accent-foreground hover:bg-accent/90 px-8 flex items-center gap-2"
              >
                {sending ? (
                  <>
                    <Spinner className="size-4" /> Sending…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" /> Send Lightning RFPs
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: Confirmation */}
        {step === 3 && (
          <div className="space-y-6">
            <GlassCard>
              <GlassCardHeader
                label="Step 3"
                title="Confirmation"
                description="Here's how each invitation went."
              />
              <div className="space-y-2">
                {sendResults.map((r, i) => (
                  <div
                    key={`${r.email}-${i}`}
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border",
                      r.success ? "border-teal-500/25 bg-teal-500/[0.04]" : "border-red-500/25 bg-red-500/[0.04]"
                    )}
                  >
                    <span
                      className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                        r.success ? "bg-teal-500/20" : "bg-red-500/20"
                      )}
                    >
                      {r.success ? (
                        <Check className="w-3.5 h-3.5 text-teal-300" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-red-400" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="font-display font-bold text-sm text-foreground truncate">
                        {r.name ? `${r.name} · ${r.email}` : r.email}
                      </div>
                      <div className={cn("font-mono text-[10px]", r.success ? "text-teal-300" : "text-red-400")}>
                        {r.success ? "Invitation sent — expires in 72 hours" : r.error || "Failed to send invitation"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>

            <div className="flex flex-wrap items-center gap-3">
              <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90">
                <Link href="/agency/bids">View Pending Invitations</Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={sendAnotherRound}
                className="border-border text-foreground hover:bg-white/5"
              >
                Send Another Round
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!sendResults.some((r) => r.success && r.token)}
                onClick={() => void copyAllLinks()}
                className="border-border text-foreground-muted hover:bg-white/5 flex items-center gap-2"
              >
                <Copy className="w-3.5 h-3.5" />
                {copyLabel}
              </Button>
            </div>
          </div>
        )}
      </div>
  )
}

export default function MagicRfpPage() {
  return (
    <AgencyLayout>
      <MagicRfpContent />
    </AgencyLayout>
  )
}
