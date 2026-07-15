"use client"

import { useState, useRef, useEffect, Suspense, Component, type ReactNode } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { AgencyLayout } from "@/components/agency-layout"
import { StageHeader } from "@/components/stage-header"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import { usePaidUser } from "@/contexts/paid-user-context"
import { useSelectedProject } from "@/contexts/selected-project-context"
import { InlineProjectSelector } from "@/components/agency-project-selector"
import { AgencyRfpMagicLinkInvite } from "@/components/agency-rfp-magic-link-invite"
import { Upload, FileText, Link2, Type, Plus, Trash2, Building2, Users, ChevronRight, ChevronDown, Check, Send, Shield, FileCheck, Loader2, Sparkles, X, Zap } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { FileUpload } from "@/components/file-upload"
import { ReferenceMaterialsInput, type ReferenceMaterial } from "@/components/reference-materials-input"
import { RfpOutputTemplate, type SensitivityOptions } from "@/components/rfp-output-template"
import { readTextStream } from "@/lib/read-text-stream"

// Types
type UploadMethod = "file" | "google" | "paste" | null

type ScopeItem = {
  id: string
  name: string
  description: string
  allocation: "internal" | "outsource" | null
  estimatedBudget?: string
  timeline?: string
}

type Partner = {
  id: string
  partnershipId?: string
  name: string
  email?: string
  type: "agency" | "freelancer" | "production"
  discipline: string
  bookmarked: boolean
  ndaSigned: boolean
  ndaSignedDate?: string
  ndaConfirmedAt?: string | null
  msaApproved: boolean
  msaApprovedDate?: string
  rating?: number
  pastProjects?: string[]
}

type NewRecipient = {
  email: string
  name: string
  requireNda: boolean
  /** When true, sent via the no-signup magic-link flow instead of the standard invitation. */
  sendAsMagicLink: boolean
}

/** Row from GET /api/partnerships (agency view) */
type PartnershipApiRow = {
  id: string
  status: string
  partner_id: string | null
  partner_email: string | null
  invited_at: string | null
  accepted_at: string | null
  nda_confirmed_at?: string | null
  partner: {
    id: string
    email: string
    full_name: string | null
    company_name: string | null
  } | null
}

/** Primary brief + optional user augment, sent to /api/ai/master-brief */
function buildMasterBriefSourceText(input: {
  briefSourceText: string
  pastedContent: string
  googleLink: string
  briefFileName: string
  briefAugmentText: string
}): string {
  const primary =
    input.briefSourceText.trim() ||
    input.pastedContent.trim() ||
    input.googleLink.trim() ||
    input.briefFileName.trim()
  const augment = input.briefAugmentText.trim()
  if (!primary && !augment) return ""
  if (!augment) return primary
  if (!primary) return augment
  return `${primary}\n\n---\nAdditional brief details (user-provided):\n${augment}`
}

// Demo partners - only shown in demo mode
const demoPartners: Partner[] = [
  { id: "1", name: "Sample Production Studio", type: "production", discipline: "Video Production", bookmarked: true, ndaSigned: true, ndaSignedDate: "2023-06-15", msaApproved: true, msaApprovedDate: "2023-07-01", rating: 4.8, pastProjects: ["Q4 Brand Campaign", "Summer Series"] },
  { id: "2", name: "Tandem Social", type: "agency", discipline: "Social Media", bookmarked: true, ndaSigned: true, ndaSignedDate: "2023-08-20", msaApproved: true, msaApprovedDate: "2023-09-01", rating: 4.5, pastProjects: ["Brand Launch Q4"] },
  { id: "3", name: "Roster Agency", type: "agency", discipline: "Talent Relations", bookmarked: false, ndaSigned: false, msaApproved: false },
  { id: "4", name: "Sarah Chen", type: "freelancer", discipline: "Motion Design", bookmarked: true, ndaSigned: true, ndaSignedDate: "2023-05-10", msaApproved: false, rating: 4.9, pastProjects: ["Brand Refresh", "Product Launch"] },
  { id: "5", name: "Groundswell PR", type: "agency", discipline: "Public Relations", bookmarked: false, ndaSigned: false, msaApproved: false },
  { id: "6", name: "Mike Rodriguez", type: "freelancer", discipline: "Copywriting", bookmarked: false, ndaSigned: true, ndaSignedDate: "2024-01-05", msaApproved: false },
  { id: "7", name: "Wavelength Audio", type: "production", discipline: "Audio Production", bookmarked: true, ndaSigned: true, ndaSignedDate: "2023-04-22", msaApproved: true, msaApprovedDate: "2023-05-15", rating: 4.7, pastProjects: ["Brand Podcast S2"] },
  { id: "8", name: "Pixel Perfect Post", type: "production", discipline: "Post-Production", bookmarked: true, ndaSigned: true, ndaSignedDate: "2023-07-18", msaApproved: true, msaApprovedDate: "2023-08-01", rating: 4.6, pastProjects: ["Summer Series", "Holiday Campaign"] },
]

// Note: existingPartners will be conditionally set based on demo mode inside the component

// Demo templates - only shown in demo mode
const demoTemplates = [
  { id: "1", name: "Electric Animal Master RFP Template", type: "rfp", format: "docx" },
  { id: "2", name: "Electric Animal SOW Template v2", type: "sow", format: "docx" },
]

const MASTER_BRIEF_LOADING_MESSAGES = [
  "Analyzing brief...",
  "Structuring scope items...",
  "Mapping deliverables...",
  "Finalizing...",
]

function AgencyRFPContent() {
  const { checkFeatureAccess } = usePaidUser()
  const { selectedProject, setSelectedProject, isLoadingProjects, projects } = useSelectedProject()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isDemo = isDemoMode()
  const [poolPartners, setPoolPartners] = useState<Partner[]>([])
  const [poolPartnersLoading, setPoolPartnersLoading] = useState(false)
  const [poolPartnersError, setPoolPartnersError] = useState<string | null>(null)
  /** Invited but not yet active — shown read-only under the pool */
  const [pendingPartnerInvites, setPendingPartnerInvites] = useState<{ id: string; email: string }[]>([])

  const existingPartners = isDemo ? demoPartners : poolPartners

  useEffect(() => {
    if (isDemo) return
    let cancelled = false
    ;(async () => {
      setPoolPartnersLoading(true)
      setPoolPartnersError(null)
      try {
        const res = await fetch("/api/partnerships")
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((data?.error as string) || "Failed to load partners")
        const rows = (data.partnerships || []) as PartnershipApiRow[]

        const active = rows
          .filter((p) => p.status === "active" && p.partner?.id)
          .sort((a, b) => {
            const ta = a.accepted_at ? new Date(a.accepted_at).getTime() : 0
            const tb = b.accepted_at ? new Date(b.accepted_at).getTime() : 0
            return tb - ta
          })

        const mapped: Partner[] = active.map((p) => {
          const pr = p.partner!
          const label = pr.full_name?.trim() || pr.company_name?.trim() || pr.email || "Partner"
          const sub = pr.company_name?.trim() || pr.email || "Partner"
          return {
            id: pr.id,
            partnershipId: p.id,
            name: label,
            email: pr.email,
            type: "agency",
            discipline: sub,
            bookmarked: true,
            ndaSigned: !!p.nda_confirmed_at,
            ndaSignedDate: p.nda_confirmed_at
              ? new Date(p.nda_confirmed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              : undefined,
            ndaConfirmedAt: p.nda_confirmed_at || null,
            msaApproved: false,
          }
        })

        const pending = rows
          .filter((p) => p.status === "pending")
          .map((p) => ({
            id: p.id,
            email: (p.partner_email || p.partner?.email || "").trim(),
          }))
          .filter((x) => x.email.length > 0)

        if (!cancelled) {
          setPoolPartners(mapped)
          setPendingPartnerInvites(pending)
        }
      } catch (e) {
        if (!cancelled) {
          setPoolPartnersError(e instanceof Error ? e.message : "Failed to load partners")
          setPoolPartners([])
          setPendingPartnerInvites([])
        }
      } finally {
        if (!cancelled) setPoolPartnersLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDemo])

  // Fetch agency profile for default NDA URL
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client")
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || cancelled) return
        setAgencyId(user.id)
        const { data: profile } = await supabase
          .from("profiles")
          .select("default_nda_url")
          .eq("id", user.id)
          .maybeSingle()
        if (!cancelled && profile) {
          setDefaultNdaUrl((profile as { default_nda_url?: string | null }).default_nda_url || "")
        }
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])


  // Step 00 interpretation integration
  const searchParams = useSearchParams()
  const router = useRouter()
  const [briefSource, setBriefSource] = useState<"step00" | "new">("new")
  const [interpretations, setInterpretations] = useState<Array<{
    id: string
    brief_title: string | null
    created_at: string
    brief_summary: string | null
    brief_text: string | null
    brief_file_url: string | null
    budget_result: { total_low?: number; total_high?: number } | null
    timeline_result: { total_weeks_min?: number; total_weeks_max?: number } | null
    directors_result: { recommendations?: Array<{ name: string; company: string; fit_reason: string }> } | null
  }>>([])
  const [interpretationsLoading, setInterpretationsLoading] = useState(false)
  const [selectedInterpretationId, setSelectedInterpretationId] = useState<string | null>(null)
  const selectedInterpretation = interpretations.find(i => i.id === selectedInterpretationId) ?? null

  // Load Step 00 interpretations
  useEffect(() => {
    if (isDemo) return
    let cancelled = false
    setInterpretationsLoading(true)
    ;(async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client")
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || cancelled) return
        const { data } = await supabase
          .from("brief_interpretations")
          .select("id, brief_title, created_at, brief_summary, brief_text, brief_file_url, budget_result, timeline_result, directors_result")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20)
        if (!cancelled && data && data.length > 0) {
          setInterpretations(data as typeof interpretations)
          // Auto-select from URL param
          const urlId = searchParams?.get("interpretation_id")
          if (urlId) {
            const match = data.find((r: { id: string }) => r.id === urlId)
            if (match) {
              setSelectedInterpretationId(urlId)
              setBriefSource("step00")
            }
          }
        }
      } catch {}
      if (!cancelled) setInterpretationsLoading(false)
    })()
    return () => { cancelled = true }
  }, [isDemo, searchParams])

  // Apply Step 00 interpretation when selected
  useEffect(() => {
    if (briefSource !== "step00" || !selectedInterpretation) return
    // Populate briefSourceText from interpretation
    if (selectedInterpretation.brief_text) {
      setBriefSourceText(selectedInterpretation.brief_text)
      setBriefUploaded(true)
      setBriefFileName(selectedInterpretation.brief_title || "Analysis from Step 00")
    }
    // Build a partial masterRfp from interpretation data
    const budgetStr = selectedInterpretation.budget_result?.total_low != null && selectedInterpretation.budget_result?.total_high != null
      ? `$${selectedInterpretation.budget_result.total_low.toLocaleString()} - $${selectedInterpretation.budget_result.total_high.toLocaleString()}`
      : ""
    const timelineStr = selectedInterpretation.timeline_result?.total_weeks_min != null && selectedInterpretation.timeline_result?.total_weeks_max != null
      ? `${selectedInterpretation.timeline_result.total_weeks_min}-${selectedInterpretation.timeline_result.total_weeks_max} weeks`
      : ""
    if (selectedInterpretation.brief_summary || budgetStr || timelineStr) {
      setMasterRfp(prev => prev ? {
        ...prev,
        overview: selectedInterpretation.brief_summary || prev.overview,
        totalBudget: budgetStr || prev.totalBudget,
        timeline: timelineStr || prev.timeline,
      } : null)
    }
  }, [briefSource, selectedInterpretation])

  // Step state (1-6)
  const [currentStep, setCurrentStep] = useState(1)
  
  // Step 1: Upload Brief
  const [uploadMethod, setUploadMethod] = useState<UploadMethod>(null)
  const [pastedContent, setPastedContent] = useState("")
  const [googleLink, setGoogleLink] = useState("")
  const [briefUploaded, setBriefUploaded] = useState(false)
  const [briefFileName, setBriefFileName] = useState("")
  const [briefSourceText, setBriefSourceText] = useState("")
  const [selectedRfpTemplate, setSelectedRfpTemplate] = useState<string | null>(null)
  const [selectedSowTemplate, setSelectedSowTemplate] = useState<string | null>(null)
  const [uploadedRfpTemplate, setUploadedRfpTemplate] = useState<{ name: string; url: string } | null>(null)
  const [uploadedSowTemplate, setUploadedSowTemplate] = useState<{ name: string; url: string } | null>(null)
  const [isUploadingRfpTemplate, setIsUploadingRfpTemplate] = useState(false)
  const [isUploadingSowTemplate, setIsUploadingSowTemplate] = useState(false)
  /** Extracted text from uploaded RFP output template (drives AI structure) */
  const [templateSourceText, setTemplateSourceText] = useState("")
  const [briefUploadError, setBriefUploadError] = useState<string | null>(null)
  const [briefExtractWarning, setBriefExtractWarning] = useState<string | null>(null)
  const [rfpTemplateUploadError, setRfpTemplateUploadError] = useState<string | null>(null)
  const [rfpTemplateExtractWarning, setRfpTemplateExtractWarning] = useState<string | null>(null)
  const [isExtractingBrief, setIsExtractingBrief] = useState(false)
  /** Optional extra copy pasted by user; always appended to the primary brief for AI */
  const [briefAugmentText, setBriefAugmentText] = useState("")
  /** Step 1b: upload file vs AI-generated output template */
  const [rfpTemplateMode, setRfpTemplateMode] = useState<"upload" | "ai">("upload")
  const [aiTemplateStyle, setAiTemplateStyle] = useState<"formal" | "lean" | "creative">("formal")
  const [aiScrubBrand, setAiScrubBrand] = useState(false)
  const [aiScrubBudget, setAiScrubBudget] = useState(false)
  const [aiScrubStrategy, setAiScrubStrategy] = useState(false)
  const [aiScrubTimeline, setAiScrubTimeline] = useState(false)
  const [aiOutputFormat, setAiOutputFormat] = useState<"section" | "modular">("section")
  const [isGeneratingAiTemplate, setIsGeneratingAiTemplate] = useState(false)
  const [aiTemplateError, setAiTemplateError] = useState<string | null>(null)
  const [aiTemplateGenerated, setAiTemplateGenerated] = useState(false)
  /** Step 1b skipped via "Skip — Use Client Brief As-Is"; persisted as brief_used_as_is in the draft */
  const [briefUsedAsIs, setBriefUsedAsIs] = useState(false)

  // Step 2: Master RFP (AI generated)
  const [masterRfp, setMasterRfp] = useState<{
    projectName: string
    client: string
    overview: string
    objectives: string[]
    scopeItems: ScopeItem[]
    totalBudget: string
    timeline: string
  } | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [masterBriefLoadingMessageIndex, setMasterBriefLoadingMessageIndex] = useState(0)
  const [generateMasterBriefError, setGenerateMasterBriefError] = useState<string | null>(null)
  
  // Step 3: Allocate Scope
  const [scopeItems, setScopeItems] = useState<ScopeItem[]>([])
  const [newScopeName, setNewScopeName] = useState("")
  const [newScopeDesc, setNewScopeDesc] = useState("")
  
  // Step 4: Review
  const [additionalContext, setAdditionalContext] = useState("")
  
  // Step 5: Select Recipients
  const [selectedPartners, setSelectedPartners] = useState<Record<string, string[]>>({})

  const [newRecipients, setNewRecipients] = useState<Record<string, NewRecipient[]>>({})
  const [recipientDrafts, setRecipientDrafts] = useState<
    Record<string, { email: string; name: string; requireNda: boolean; sendAsMagicLink: boolean }>
  >({})
  const [recipientAddErrors, setRecipientAddErrors] = useState<Record<string, string | null>>({})
  const [recipientAddSuccess, setRecipientAddSuccess] = useState<Record<string, string | null>>({})
  
  // Step 6: Broadcast
  const [isBroadcasting, setIsBroadcasting] = useState(false)
  const [broadcastComplete, setBroadcastComplete] = useState(false)
  const [broadcastError, setBroadcastError] = useState<string | null>(null)
  const [ndaSignatureRequired, setNdaSignatureRequired] = useState(false)
  const [ndaSigningLink, setNdaSigningLink] = useState("https://www.docusign.com/")
  const [defaultNdaUrl, setDefaultNdaUrl] = useState("")
  const [responseDeadlineDate, setResponseDeadlineDate] = useState("")
  const [agencyId, setAgencyId] = useState<string | null>(null)
  const [referenceMaterials, setReferenceMaterials] = useState<ReferenceMaterial[]>([])

  const DRAFT_KEY = (projectId: string) => `ligament-rfp-draft-${projectId}`

  const saveDraft = (projectId: string, state: Record<string, unknown>) => {
    try {
      localStorage.setItem(DRAFT_KEY(projectId), JSON.stringify(state))
    } catch {}
  }

  const loadDraft = (projectId: string): Record<string, unknown> | null => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY(projectId))
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }
  
  // Handle client brief file: server-side text extraction only (no blob preview — private store URLs are not iframe-safe)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!checkFeatureAccess("file uploads")) return
    setBriefUploadError(null)
    setBriefExtractWarning(null)
    setBriefUploaded(true)
    setBriefFileName(file.name)
    setBriefSourceText("")
    setIsExtractingBrief(true)
    try {
      const extractForm = new FormData()
      extractForm.append("file", file)

      const extractRes = await fetch("/api/documents/extract-text", { method: "POST", body: extractForm })

      const payload = await extractRes.json().catch(() => ({}))
      if (!extractRes.ok) {
        throw new Error(payload?.error || "Could not read this file")
      }
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
  

  const handleGoogleLinkImport = async () => {
    if (!googleLink.trim()) return
    setBriefUploadError(null)
    setBriefExtractWarning(null)
    setIsExtractingBrief(true)
    setBriefUploaded(true)
    setBriefFileName("Google Doc")
    setBriefSourceText("")
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
      setBriefSourceText(payload.text.toString())
    } catch (err) {
      setBriefUploaded(false)
      setBriefFileName("")
      setBriefUploadError(err instanceof Error ? err.message : "Failed to import document")
    } finally {
      setIsExtractingBrief(false)
    }
  }

  const handleUploadClick = () => {
    // Directly click the file input - feature access is checked on file selection
    fileInputRef.current?.click()
  }

  const handleRfpTemplateFileSelect = async (file: File) => {
    if (!checkFeatureAccess("file uploads")) {
      setRfpTemplateUploadError("File uploads require an active subscription (or use demo mode).")
      return
    }
    setRfpTemplateUploadError(null)
    setRfpTemplateExtractWarning(null)
    setIsUploadingRfpTemplate(true)
    try {
      const extractFd = new FormData()
      extractFd.append("file", file)
      const extractRes = await fetch("/api/documents/extract-text", {
        method: "POST",
        body: extractFd,
      })
      const extractPayload = await extractRes.json().catch(() => ({}))
      if (!extractRes.ok) {
        throw new Error(extractPayload?.error || "Could not read template text")
      }

      setUploadedRfpTemplate({ name: file.name, url: "" })
      const warning = typeof extractPayload?.warning === "string" ? extractPayload.warning : null
      setRfpTemplateExtractWarning(warning)
      setTemplateSourceText((extractPayload.text || "").toString())
      setRfpTemplateMode("upload")
      setSelectedRfpTemplate("uploaded")
    } catch (err) {
      setRfpTemplateUploadError(err instanceof Error ? err.message : "Template processing failed")
      setRfpTemplateExtractWarning(null)
      setUploadedRfpTemplate(null)
      setTemplateSourceText("")
    } finally {
      setIsUploadingRfpTemplate(false)
    }
  }

  const handleSelectLibraryRfpTemplate = (templateId: string) => {
    const next = templateId === selectedRfpTemplate ? null : templateId
    setSelectedRfpTemplate(next)
    setRfpTemplateMode("upload")
    if (next) {
      setUploadedRfpTemplate(null)
      setTemplateSourceText("")
      setRfpTemplateUploadError(null)
      setRfpTemplateExtractWarning(null)
    }
  }

  const handleRemoveUploadedRfpTemplate = () => {
    setUploadedRfpTemplate(null)
    setTemplateSourceText("")
    setSelectedRfpTemplate(null)
    setRfpTemplateUploadError(null)
    setRfpTemplateExtractWarning(null)
  }

  const handleSensitivityChange = (key: keyof SensitivityOptions, value: boolean) => {
    if (key === "scrubBrand") setAiScrubBrand(value)
    else if (key === "scrubBudget") setAiScrubBudget(value)
    else if (key === "scrubStrategy") setAiScrubStrategy(value)
    else if (key === "scrubTimeline") setAiScrubTimeline(value)
  }

  // Generate Master RFP (AI-backed)
  const generateMasterRfp = async () => {
    setGenerateMasterBriefError(null)
    setIsGenerating(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 125_000)
    try {
      const templateHint =
        selectedRfpTemplate === "ai"
          ? "AI-generated output template"
          : uploadedRfpTemplate?.name ||
            (selectedRfpTemplate && isDemoMode()
              ? demoTemplates.find((t) => t.id === selectedRfpTemplate)?.name
              : "") ||
            "Default RFP template"

      const sourceText = buildMasterBriefSourceText({
        briefSourceText,
        pastedContent,
        googleLink,
        briefFileName,
        briefAugmentText,
      })

      const templateBody = templateSourceText.trim()

      const response = await fetch("/api/ai/master-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          projectName: selectedProject?.name || "New Project",
          clientName: selectedProject?.client || "Client TBD",
          briefText: sourceText,
          templateHint,
          ...(templateBody ? { templateText: templateBody } : {}),
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        const base = (payload?.error || "Failed to generate master brief").toString()
        const hint = payload?.hint ? ` ${payload.hint}` : ""
        const status = response.status ? ` (HTTP ${response.status})` : ""
        throw new Error(base + hint + status)
      }

      const generated = payload.masterBrief || {}
      const normalizedScope = (generated.scopeItems || []).map((item: any, index: number) => ({
        id: item.id || `${index + 1}`,
        name: item.name || `Scope Item ${index + 1}`,
        description: item.description || "No description provided",
        allocation: null,
        estimatedBudget: item.estimatedBudget || "",
        timeline: item.timeline || "",
      }))

      const normalized = {
        projectName: generated.projectName || selectedProject?.name || "New Project",
        client: generated.client || selectedProject?.client || "Client TBD",
        overview: generated.overview || "",
        objectives: generated.objectives || [],
        totalBudget: generated.totalBudget || "TBD",
        timeline: generated.timeline || "TBD",
        scopeItems: normalizedScope,
      }

      setMasterRfp(normalized)
      setScopeItems(normalizedScope)
      setCurrentStep(2)
    } catch (error) {
      console.error("Master brief generation failed:", error)
      if (error instanceof Error && error.name === "AbortError") {
        setGenerateMasterBriefError(
          "Request timed out or was cancelled. Claude can take 30–90s. On Vercel Hobby, serverless functions are limited to ~10s—increase max duration (Pro) or set export const maxDuration on this route."
        )
      } else {
        setGenerateMasterBriefError(
          error instanceof Error ? error.message : "Something went wrong. Check the browser Network tab for /api/ai/master-brief."
        )
      }
    } finally {
      clearTimeout(timeoutId)
      setIsGenerating(false)
    }
  }

  /** Step 1b "Skip — Use Client Brief As-Is": bypass the output template entirely and
   *  generate the Master RFP straight from the client brief with a default structure. */
  const handleSkipOutputTemplate = () => {
    setBriefUsedAsIs(true)
    setRfpTemplateMode("upload")
    setSelectedRfpTemplate(null)
    setUploadedRfpTemplate(null)
    setTemplateSourceText("")
    void generateMasterRfp()
  }

  /** Step 1 "Send as Lightning RFP Magic Link": hand off the brief entered so far to the
   *  dedicated magic-link workflow instead of continuing through Master RFP generation. */
  const handleSendAsLightningRfp = () => {
    const sourceText = buildMasterBriefSourceText({
      briefSourceText,
      pastedContent,
      googleLink,
      briefFileName,
      briefAugmentText,
    })
    try {
      sessionStorage.setItem(
        "magic_rfp_prefill",
        JSON.stringify({
          projectName: selectedProject?.name || "",
          clientName: selectedProject?.client || "",
          scopeDescription: sourceText,
        })
      )
    } catch {
      // sessionStorage unavailable (private mode, etc.) — proceed without prefill
    }
    router.push("/agency/magic-rfp")
  }

  const generateAiOutputTemplate = async () => {
    setAiTemplateError(null)
    const sourceText = buildMasterBriefSourceText({
      briefSourceText,
      pastedContent,
      googleLink,
      briefFileName,
      briefAugmentText,
    })
    if (!sourceText.trim()) {
      setAiTemplateError(
        "Add a client brief in Step 1a first (upload a file, paste text, add a Google Doc link, or use the optional additional brief field). AI needs that text to infer structure."
      )
      return
    }
    if (!checkFeatureAccess("AI output template")) {
      setAiTemplateError("Subscription required for AI features, or enable demo mode.")
      return
    }
    setAiTemplateGenerated(false)
    setIsGeneratingAiTemplate(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 125_000)
    try {
      setSelectedRfpTemplate("ai")
      setTemplateSourceText("")
      setUploadedRfpTemplate(null)
      setRfpTemplateExtractWarning(null)
      setRfpTemplateUploadError(null)

      const res = await fetch("/api/ai/rfp-output-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          briefText: sourceText,
          templateStyle: aiTemplateStyle,
          outputFormat: aiOutputFormat,
          sensitivity: {
            scrubBrand: aiScrubBrand,
            scrubBudget: aiScrubBudget,
            scrubStrategy: aiScrubStrategy,
            scrubTimeline: aiScrubTimeline,
          },
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
          !payload.error && !payload.detail && !payload.hint
            ? errorText.trim() || `HTTP ${res.status}`
            : null,
        ].filter(Boolean)
        throw new Error(parts.join(" — ") || "Generation failed")
      }

      if (!res.body) {
        throw new Error("No stream body returned from template route")
      }

      const text = await readTextStream(res.body, (fullText) => {
        setTemplateSourceText(fullText)
      })

      if (!text.trim()) {
        throw new Error("AI returned an empty template. Check server logs and ANTHROPIC_API_KEY on Vercel.")
      }
      setAiTemplateGenerated(true)
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setAiTemplateError(
          "Request timed out (125s). On Vercel Hobby, functions may cap earlier—upgrade or check /api/ai/rfp-output-template logs."
        )
      } else {
        setAiTemplateError(
          e instanceof Error ? e.message : "Failed to generate template. Check the Network tab for /api/ai/rfp-output-template."
        )
      }
    } finally {
      clearTimeout(timeoutId)
      setIsGeneratingAiTemplate(false)
    }
  }

  useEffect(() => {
    if (!isGenerating) {
      setMasterBriefLoadingMessageIndex(0)
      return
    }

    const intervalId = window.setInterval(() => {
      setMasterBriefLoadingMessageIndex((prev) => (prev + 1) % MASTER_BRIEF_LOADING_MESSAGES.length)
    }, 2500)

    return () => window.clearInterval(intervalId)
  }, [isGenerating])
  
  // Allocate scope item
  const allocateScope = (itemId: string, allocation: "internal" | "outsource") => {
    setScopeItems(prev => prev.map(item => 
      item.id === itemId ? { ...item, allocation } : item
    ))
  }
  
  // Add custom scope item
  const addScopeItem = () => {
    if (!newScopeName.trim()) return
    const newItem: ScopeItem = {
      id: Date.now().toString(),
      name: newScopeName,
      description: newScopeDesc || "No description provided",
      allocation: null,
    }
    setScopeItems(prev => [...prev, newItem])
    setNewScopeName("")
    setNewScopeDesc("")
  }
  
  // Remove scope item
  const removeScopeItem = (itemId: string) => {
    setScopeItems(prev => prev.filter(item => item.id !== itemId))
  }
  
  // Toggle partner selection
  const togglePartner = (scopeItemId: string, partnerId: string) => {
    setSelectedPartners(prev => {
      const current = prev[scopeItemId] || []
      return {
        ...prev,
        [scopeItemId]: current.includes(partnerId)
          ? current.filter(id => id !== partnerId)
          : [...current, partnerId]
      }
    })
  }
  
  // Add new recipient
  const addNewRecipient = (scopeItemId: string) => {
    const draft = recipientDrafts[scopeItemId] || { email: "", name: "", requireNda: ndaSignatureRequired, sendAsMagicLink: true }
    const email = draft.email.trim().toLowerCase()
    if (!email) return
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      setRecipientAddErrors((prev) => ({ ...prev, [scopeItemId]: "Enter a valid email address." }))
      setRecipientAddSuccess((prev) => ({ ...prev, [scopeItemId]: null }))
      return
    }
    const duplicateInManual = (newRecipients[scopeItemId] || []).some(
      (r) => r.email.trim().toLowerCase() === email
    )
    if (duplicateInManual) {
      setRecipientAddErrors((prev) => ({ ...prev, [scopeItemId]: "This email was already added." }))
      setRecipientAddSuccess((prev) => ({ ...prev, [scopeItemId]: null }))
      return
    }
    const selectedIds = selectedPartners[scopeItemId] || []
    const duplicateInExistingPartner = selectedIds.some((partnerId) => {
      const partner = existingPartners.find((p) => p.id === partnerId)
      return (partner?.email || "").trim().toLowerCase() === email
    })
    if (duplicateInExistingPartner) {
      setRecipientAddErrors((prev) => ({
        ...prev,
        [scopeItemId]: "This email already exists in selected partners for this scope.",
      }))
      setRecipientAddSuccess((prev) => ({ ...prev, [scopeItemId]: null }))
      return
    }
    setNewRecipients(prev => ({
      ...prev,
      [scopeItemId]: [
        ...(prev[scopeItemId] || []),
        { email, name: draft.name.trim(), requireNda: draft.requireNda, sendAsMagicLink: draft.sendAsMagicLink !== false },
      ],
    }))
    setRecipientDrafts((prev) => ({
      ...prev,
      [scopeItemId]: { email: "", name: "", requireNda: ndaSignatureRequired, sendAsMagicLink: true },
    }))
    setRecipientAddErrors((prev) => ({ ...prev, [scopeItemId]: null }))
    setRecipientAddSuccess((prev) => ({ ...prev, [scopeItemId]: `Recipient added: ${email}` }))
  }
  
  // Remove new recipient
  const removeNewRecipient = (scopeItemId: string, index: number) => {
    setNewRecipients(prev => ({
      ...prev,
      [scopeItemId]: prev[scopeItemId].filter((_, i) => i !== index)
    }))
  }
  
  // Get total recipients for a scope item
  const getRecipientCount = (scopeItemId: string) => {
    return (selectedPartners[scopeItemId]?.length || 0) + (newRecipients[scopeItemId]?.length || 0)
  }
  
  // Check if all outsourced items have recipients
  const allOutsourcedHaveRecipients = () => {
    return outsourcedItems.every(item => getRecipientCount(item.id) > 0)
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

  // Broadcast RFPs (persist per-recipient rows for partner inbox when not demo)
  const broadcastRfps = async () => {
    setBroadcastError(null)
    if (!masterRfp) {
      setBroadcastError("Generate a Master RFP before broadcasting.")
      return
    }
    if (isDemo) {
      setIsBroadcasting(true)
      setTimeout(() => {
        setIsBroadcasting(false)
        setBroadcastComplete(true)
      }, 2500)
      return
    }
    if (ndaSignatureRequired && !ndaSigningLink.trim()) {
      setBroadcastError("Add an NDA signing link before broadcasting with NDA Signature Required.")
      return
    }
    setIsBroadcasting(true)
    try {
      const responseDeadline =
        responseDeadlineDate.trim().length > 0
          ? new Date(`${responseDeadlineDate.trim()}T23:59:59`).toISOString()
          : null
      // Manually-added recipients with "Send as Magic Link" checked are routed to the
      // no-signup magic-link API individually; everyone else goes through the standard
      // broadcast-rfp flow below, completely unchanged.
      const magicLinkQueue: { email: string; name: string; scopeItem: ScopeItem }[] = []
      const normalizedNewRecipientsByScope = outsourcedItems.reduce(
        (acc, item) => {
          const standardRows: NewRecipient[] = []
          for (const recipient of newRecipients[item.id] || []) {
            const email = recipient.email.trim().toLowerCase()
            const name = recipient.name?.trim?.() || ""
            if (recipient.sendAsMagicLink) {
              magicLinkQueue.push({ email, name, scopeItem: item })
            } else {
              standardRows.push({
                email,
                name,
                requireNda: ndaSignatureRequired ? recipient.requireNda !== false : false,
                sendAsMagicLink: false,
              })
            }
          }
          acc[item.id] = standardRows
          return acc
        },
        {} as Record<string, NewRecipient[]>
      )
      const items = outsourcedItems.map((item) => ({
        scopeItemId: item.id,
        scopeItem: item,
        partnerIds: selectedPartners[item.id] || [],
        newRecipients: normalizedNewRecipientsByScope[item.id] || [],
      }))
      // If every recipient across every scope item was routed to the magic-link queue above,
      // there's nothing left for the standard broadcast-rfp endpoint to send — calling it would
      // incorrectly fail with "No recipients to broadcast to" even though every scope item does
      // have a valid (magic-link) recipient, per allOutsourcedHaveRecipients().
      const hasStandardRecipients = items.some(
        (item) => item.partnerIds.length > 0 || item.newRecipients.length > 0
      )
      if (hasStandardRecipients) {
        const res = await fetch("/api/agency/broadcast-rfp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: selectedProject?.id ?? null,
            masterRfp: { ...masterRfp, referenceMaterials },
            ndaRequired: ndaSignatureRequired,
            ndaLink: ndaSignatureRequired ? ndaSigningLink.trim() : "",
            response_deadline: responseDeadline,
            newRecipientsByScope: normalizedNewRecipientsByScope,
            items,
          }),
        })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(
            [payload?.error, payload?.detail].filter(Boolean).join(" ") || "Broadcast failed"
          )
        }
      }
      if (magicLinkQueue.length > 0 && selectedProject?.id) {
        for (const recipient of magicLinkQueue) {
          try {
            await fetch("/api/agency/rfp/magic-link", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                vendor_email: recipient.email,
                vendor_name: recipient.name || undefined,
                project_id: selectedProject.id,
                scope_item_name: recipient.scopeItem.name,
                scope_item_description: recipient.scopeItem.description,
                reference_materials: referenceMaterials,
              }),
            })
          } catch (magicLinkErr) {
            console.error("Magic link invite failed:", recipient.email, magicLinkErr)
          }
        }
      }
      if (referenceMaterials.length > 0) {
        await saveReferenceMaterialsToLibrary(referenceMaterials)
      }
      setBroadcastComplete(true)
    } catch (e) {
      setBroadcastError(e instanceof Error ? e.message : "Broadcast failed")
    } finally {
      setIsBroadcasting(false)
    }
  }
  
  // Reset flow
  const resetFlow = () => {
    setCurrentStep(1)
    setBroadcastComplete(false)
    setBroadcastError(null)
    setRfpTemplateMode("upload")
    setAiTemplateError(null)
    setAiTemplateGenerated(false)
    setIsGeneratingAiTemplate(false)
    setBriefUploaded(false)
    setBriefFileName("")
    setBriefSourceText("")
    setTemplateSourceText("")
    setSelectedRfpTemplate(null)
    setSelectedSowTemplate(null)
    setUploadedRfpTemplate(null)
    setUploadedSowTemplate(null)
    setIsUploadingRfpTemplate(false)
    setIsUploadingSowTemplate(false)
    setRfpTemplateUploadError(null)
    setBriefUploadError(null)
    setUploadMethod(null)
    setBriefExtractWarning(null)
    setRfpTemplateExtractWarning(null)
    setPastedContent("")
    setGoogleLink("")
    setBriefAugmentText("")
    setAiTemplateStyle("formal")
    setAiScrubBrand(false)
    setAiScrubBudget(false)
    setAiScrubStrategy(false)
    setAiScrubTimeline(false)
    setAiOutputFormat("section")
    setBriefUsedAsIs(false)
    setMasterRfp(null)
    setGenerateMasterBriefError(null)
    setIsGenerating(false)
    setScopeItems([])
    setNewScopeName("")
    setNewScopeDesc("")
    setSelectedPartners({})
    setNewRecipients({})
    setRecipientDrafts({})
    setRecipientAddErrors({})
    setRecipientAddSuccess({})
    setAdditionalContext("")
    setNdaSignatureRequired(false)
    setNdaSigningLink("https://www.docusign.com/")
    setResponseDeadlineDate("")
    if (selectedProject?.id) {
      try { localStorage.removeItem(DRAFT_KEY(selectedProject.id)) } catch {}
    }
  }

  useEffect(() => {
    if (!selectedProject?.id) {
      resetFlow()
      return
    }
    const draft = loadDraft(selectedProject.id)
    if (!draft) {
      resetFlow()
      return
    }
    // Restore persisted draft state
    if (typeof draft.currentStep === "number") setCurrentStep(draft.currentStep as 1|2|3|4|5|6)
    if (draft.uploadMethod !== undefined) setUploadMethod(draft.uploadMethod as UploadMethod)
    if (typeof draft.pastedContent === "string") setPastedContent(draft.pastedContent)
    if (typeof draft.googleLink === "string") setGoogleLink(draft.googleLink)
    if (typeof draft.briefFileName === "string") setBriefFileName(draft.briefFileName)
    if (typeof draft.briefSourceText === "string") setBriefSourceText(draft.briefSourceText)
    if (typeof draft.briefAugmentText === "string") setBriefAugmentText(draft.briefAugmentText)
    if (draft.briefUploaded !== undefined) setBriefUploaded(Boolean(draft.briefUploaded))
    if (typeof draft.rfpTemplateMode === "string") setRfpTemplateMode(draft.rfpTemplateMode as "upload"|"ai")
    if (typeof draft.aiTemplateStyle === "string") setAiTemplateStyle(draft.aiTemplateStyle as "formal"|"lean"|"creative")
    if (typeof draft.aiOutputFormat === "string") setAiOutputFormat(draft.aiOutputFormat as "section"|"modular")
    if (draft.aiScrubBrand !== undefined) setAiScrubBrand(Boolean(draft.aiScrubBrand))
    if (draft.aiScrubBudget !== undefined) setAiScrubBudget(Boolean(draft.aiScrubBudget))
    if (draft.aiScrubStrategy !== undefined) setAiScrubStrategy(Boolean(draft.aiScrubStrategy))
    if (draft.aiScrubTimeline !== undefined) setAiScrubTimeline(Boolean(draft.aiScrubTimeline))
    if (typeof draft.templateSourceText === "string") setTemplateSourceText(draft.templateSourceText)
    if (draft.selectedRfpTemplate !== undefined) setSelectedRfpTemplate(draft.selectedRfpTemplate as string|null)
    if (draft.uploadedRfpTemplate !== undefined) setUploadedRfpTemplate(draft.uploadedRfpTemplate as {name:string;url:string}|null)
    if (draft.masterRfp !== undefined) setMasterRfp(draft.masterRfp as typeof masterRfp)
    if (Array.isArray(draft.scopeItems)) setScopeItems(draft.scopeItems as ScopeItem[])
    if (typeof draft.additionalContext === "string") setAdditionalContext(draft.additionalContext)
    if (draft.brief_used_as_is !== undefined) setBriefUsedAsIs(Boolean(draft.brief_used_as_is))
  }, [selectedProject?.id])

  useEffect(() => {
    if (!selectedProject?.id || isDemo) return
    saveDraft(selectedProject.id, {
      currentStep,
      uploadMethod,
      pastedContent,
      googleLink,
      briefFileName,
      briefSourceText,
      briefAugmentText,
      briefUploaded,
      rfpTemplateMode,
      aiTemplateStyle,
      aiOutputFormat,
      aiScrubBrand,
      aiScrubBudget,
      aiScrubStrategy,
      aiScrubTimeline,
      templateSourceText,
      selectedRfpTemplate,
      uploadedRfpTemplate,
      masterRfp,
      scopeItems,
      additionalContext,
      brief_used_as_is: briefUsedAsIs,
    })
  }, [
    selectedProject?.id,
    currentStep,
    uploadMethod,
    pastedContent,
    googleLink,
    briefFileName,
    briefSourceText,
    briefAugmentText,
    briefUploaded,
    rfpTemplateMode,
    aiTemplateStyle,
    aiOutputFormat,
    aiScrubBrand,
    aiScrubBudget,
    aiScrubStrategy,
    aiScrubTimeline,
    templateSourceText,
    selectedRfpTemplate,
    uploadedRfpTemplate,
    masterRfp,
    scopeItems,
    additionalContext,
    briefUsedAsIs,
    isDemo,
  ])
  
  const outsourcedItems = scopeItems.filter(item => item.allocation === "outsource")
  const internalItems = scopeItems.filter(item => item.allocation === "internal")
  const unallocatedItems = scopeItems.filter(item => item.allocation === null)
  
  // Calculate totals for broadcast summary
  const getTotalNewWithNda = () => {
    return Object.values(newRecipients).flat().filter(r => r.requireNda).length
  }
  
  const getTotalExistingWithoutNda = () => {
    const selectedIds = new Set(Object.values(selectedPartners).flat())
    return existingPartners.filter(p => selectedIds.has(p.id) && !p.ndaSigned).length
  }
  
  const steps = [
    { number: 1, label: "Upload Brief", icon: Upload },
    { number: 2, label: "Master RFP", icon: FileText },
    { number: 3, label: "Allocate Scope", icon: Users },
    { number: 4, label: "Review", icon: Check },
    { number: 5, label: "Recipients", icon: Send },
    { number: 6, label: "Broadcast", icon: Send },
  ]
  
  return (
      <div className="p-8 max-w-5xl">
        {/* Inline Project Selector */}
        {!isDemo && (
          <InlineProjectSelector
            selectedProject={selectedProject}
            projects={projects}
            isLoadingProjects={isLoadingProjects}
            onSelect={setSelectedProject}
          />
        )}
        <StageHeader
          stageNumber="01"
          title="RFP Broadcast"
          subtitle="Upload your client brief, generate a master RFP, allocate scope between internal and external partners, and broadcast targeted RFPs."
          aiPowered
        />

        {/* Progress Steps */}
        <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-2">
          {steps.map((step, index) => (
            <div key={step.number} className="flex items-center">
              <button
                onClick={() => {
                  if (step.number < currentStep) setCurrentStep(step.number)
                }}
                disabled={step.number > currentStep}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-xs transition-all whitespace-nowrap",
                  currentStep === step.number
                    ? "bg-accent text-accent-foreground"
                    : step.number < currentStep
                    ? "bg-accent/20 text-accent cursor-pointer hover:bg-accent/30"
                    : "bg-white/5 text-foreground-muted cursor-not-allowed"
                )}
              >
                <span className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center text-[10px]",
                  currentStep === step.number ? "bg-accent-foreground/20" : "bg-current/20"
                )}>
                  {step.number < currentStep ? <Check className="w-3 h-3" /> : step.number}
                </span>
                <span className="hidden md:inline">{step.label}</span>
              </button>
              {index < steps.length - 1 && (
                <ChevronRight className={cn(
                  "w-4 h-4 mx-1 shrink-0",
                  step.number < currentStep ? "text-accent" : "text-foreground-muted/30"
                )} />
              )}
            </div>
          ))}
        </div>
        
        {/* STEP 1: Upload Brief */}
        {currentStep === 1 && (
          <div className="space-y-6">
            {/* Brief Source Selector - only shown when Step 00 interpretations exist */}
            {!interpretationsLoading && interpretations.length > 0 && (
              <GlassCard>
                <GlassCardHeader
                  label="Brief Source"
                  title="Where is your brief coming from?"
                  description="Use an analysis from Step 00 (Creative Treatment Analysis), or upload a new brief."
                />
                <div className="mt-4 space-y-3">
                  {(["new", "step00"] as const).map((src) => (
                    <label key={src} className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="briefSource"
                        value={src}
                        checked={briefSource === src}
                        onChange={() => setBriefSource(src)}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="font-display font-bold text-sm text-foreground">
                          {src === "step00" ? "Use Creative Treatment Analysis" : "Upload a new brief"}
                        </div>
                        {src === "step00" && briefSource === "step00" && (
                          <div className="mt-2">
                            <select
                              value={selectedInterpretationId ?? ""}
                              onChange={(e) => setSelectedInterpretationId(e.target.value || null)}
                              className="w-full rounded-lg border border-border bg-white/5 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent/50"
                            >
                              <option value="">Select an interpretation...</option>
                              {interpretations.map((interp) => (
                                <option key={interp.id} value={interp.id}>
                                  {interp.brief_title || "Untitled"} - {new Date(interp.created_at).toLocaleDateString()}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
                {briefSource === "step00" && selectedInterpretation?.brief_summary && (
                  <div className="mt-4 p-3 rounded-lg bg-accent/5 border border-accent/20">
                    <div className="font-mono text-[10px] text-accent uppercase tracking-wider mb-1">Auto-populated from Step 00</div>
                    <p className="text-sm text-foreground-muted">{selectedInterpretation.brief_summary}</p>
                    <div className="flex gap-4 mt-2">
                      {selectedInterpretation.budget_result?.total_low != null && (
                        <span className="font-mono text-[10px] text-foreground-muted">
                          Budget: ${selectedInterpretation.budget_result.total_low.toLocaleString()} - ${(selectedInterpretation.budget_result.total_high ?? 0).toLocaleString()}
                        </span>
                      )}
                      {selectedInterpretation.timeline_result?.total_weeks_min != null && (
                        <span className="font-mono text-[10px] text-foreground-muted">
                          Timeline: {selectedInterpretation.timeline_result.total_weeks_min}-{selectedInterpretation.timeline_result.total_weeks_max} weeks
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </GlassCard>
            )}

            {briefSource === "new" && (
            <GlassCard>
              <GlassCardHeader
                label="Step 1a"
                title="Client brief (source)"
                description="Upload the client’s brief or paste text. We extract the text so the model can use your real requirements—not just the file name."
              />
              
              {/* Upload Options */}
              <div className="flex gap-3 mt-6">
                {[
                  { method: "file" as const, label: "Upload File", icon: Upload },
                  { method: "google" as const, label: "Google Link", icon: Link2 },
                  { method: "paste" as const, label: "Paste Text", icon: Type },
                ].map(({ method, label, icon: Icon }) => (
                  <button
                    key={method}
                    onClick={() => setUploadMethod(method)}
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
              
              {/* Upload Area based on method */}
              {uploadMethod && !briefUploaded && (
                <div className="mt-6">
                  {uploadMethod === "file" && (
                    <label className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-accent/50 transition-colors cursor-pointer relative block">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.pages,.key"
                        onChange={handleFileChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
                        <Upload className="w-8 h-8 text-accent" />
                      </div>
                      <div className="font-display font-bold text-foreground mb-1">
                        Drop your file here
                      </div>
                      <div className="font-mono text-[10px] text-foreground-muted">PDF, Word, PowerPoint, or text — click to browse (max 50MB)</div>
                    </label>
                  )}
                  
                  {uploadMethod === "google" && (
                    <div className="space-y-3">
                      <label className="font-mono text-[10px] text-foreground-muted uppercase block">
                        Google Docs or Slides URL
                      </label>
                      <Input
                        placeholder="https://docs.google.com/document/d/..."
                        value={googleLink}
                        onChange={(e) => { setGoogleLink(e.target.value); setBriefUploadError(null) }}
                        className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                          if (e.key === "Enter" && googleLink.trim()) void handleGoogleLinkImport()
                        }}
                      />
                      {briefUploadError && uploadMethod === "google" && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                          <span>{briefUploadError}</span>
                        </div>
                      )}
                      <Button
                        className="bg-accent text-accent-foreground hover:bg-accent/90"
                        disabled={!googleLink.trim() || isExtractingBrief}
                        onClick={() => void handleGoogleLinkImport()}
                      >
                        {isExtractingBrief ? (
                          <><span className="mr-2">Importing...</span></>
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
                        disabled={!pastedContent}
                        onClick={() => {
                          setBriefUploadError(null)
                          setBriefExtractWarning(null)
                          setBriefUploaded(true)
                          setBriefFileName("Pasted content")
                          setBriefSourceText(pastedContent)
                        }}
                      >
                        Use Pasted Content
                      </Button>
                    </div>
                  )}
                </div>
              )}
              
              {briefUploadError && (
                <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                  {briefUploadError}
                </div>
              )}
              {briefExtractWarning && !briefUploadError && (
                <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200">
                  {briefExtractWarning}
                </div>
              )}

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
                        {isExtractingBrief
                          ? "Extracting text from document…"
                          : "Ready for AI — text extracted from your file"}
                      </div>
                      {!isExtractingBrief && briefSourceText.trim() && (
                        <div className="font-mono text-[10px] text-foreground-muted mt-1">
                          {briefSourceText.length.toLocaleString()} characters from the file will be sent (before any pasted add-on)
                        </div>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setBriefUploaded(false)
                      setBriefFileName("")
                      setBriefSourceText("")
                      setBriefUploadError(null)
                      setIsExtractingBrief(false)
                      setBriefExtractWarning(null)
                    }}
                    className="border-border text-foreground-muted hover:bg-white/5"
                  >
                    Replace
                  </Button>
                </div>
              )}

              <div className="mt-6 space-y-2">
                <label className="font-mono text-[10px] text-foreground-muted uppercase block">
                  Optional: Additional brief details
                </label>
                <Textarea
                  placeholder="Paste extra requirements or missing text if extraction was incomplete. Appended when you generate."
                  value={briefAugmentText}
                  onChange={(e) => setBriefAugmentText(e.target.value)}
                  className="min-h-[120px] bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                />
                {briefAugmentText.trim() && (
                  <p className="font-mono text-[10px] text-foreground-muted">
                    +{briefAugmentText.trim().length.toLocaleString()} characters appended when generating
                  </p>
                )}
              </div>
            </GlassCard>
            )}

            <ReferenceMaterialsInput
              projectId={selectedProject?.id ?? null}
              agencyId={agencyId ?? ""}
              onChange={setReferenceMaterials}
            />

            {/* Output format template + SOW (RFP format drives Generate Master RFP) */}
            <GlassCard>
              <GlassCardHeader
                label="Step 1b"
                title="Output template (your format)"
                description="Upload a Word/PDF structure, or generate a layout with AI. The Master RFP step maps your client brief into this format (sections, headings, tone)."
              />

              <div className="grid grid-cols-2 gap-6 mt-4">
                <div>
                  <label className="font-mono text-[10px] text-foreground-muted uppercase block mb-2">
                    RFP output template
                  </label>
                  <RfpOutputTemplate
                    mode={rfpTemplateMode}
                    onModeChange={setRfpTemplateMode}
                    libraryTemplates={(isDemoMode() ? demoTemplates : [])
                      .filter((t) => t.type === "rfp")
                      .map((t) => ({ id: t.id, name: t.name }))}
                    selectedLibraryTemplateId={selectedRfpTemplate}
                    onSelectLibraryTemplate={handleSelectLibraryRfpTemplate}
                    uploadedTemplate={uploadedRfpTemplate}
                    onFileSelect={(file) => void handleRfpTemplateFileSelect(file)}
                    onRemoveUploadedTemplate={handleRemoveUploadedRfpTemplate}
                    isUploadingTemplate={isUploadingRfpTemplate}
                    uploadError={rfpTemplateUploadError}
                    extractWarning={rfpTemplateExtractWarning}
                    templateStyle={aiTemplateStyle}
                    onTemplateStyleChange={setAiTemplateStyle}
                    sensitivity={{
                      scrubBrand: aiScrubBrand,
                      scrubBudget: aiScrubBudget,
                      scrubStrategy: aiScrubStrategy,
                      scrubTimeline: aiScrubTimeline,
                    }}
                    onSensitivityChange={handleSensitivityChange}
                    outputFormat={aiOutputFormat}
                    onOutputFormatChange={setAiOutputFormat}
                    isGenerating={isGeneratingAiTemplate}
                    onGenerate={() => void generateAiOutputTemplate()}
                    generateError={aiTemplateError}
                    generatedTemplateText={templateSourceText}
                    isTemplateReady={aiTemplateGenerated}
                  />
                </div>

                <div>
                  <label className="font-mono text-[10px] text-foreground-muted uppercase block mb-2">
                    SOW Template
                  </label>
                  <div className="space-y-2">
                    {(isDemoMode() ? demoTemplates : []).filter(t => t.type === "sow").map((template) => (
                      <button
                        key={template.id}
                        onClick={() => setSelectedSowTemplate(template.id === selectedSowTemplate ? null : template.id)}
                        className={cn(
                          "w-full text-left p-3 rounded-lg border transition-colors flex items-center gap-3",
                          selectedSowTemplate === template.id
                            ? "border-accent bg-accent/10"
                            : "border-border hover:border-white/30"
                        )}
                      >
                        <FileText className="w-5 h-5 text-blue-400" />
                        <div className="flex-1">
                          <div className="font-display font-bold text-sm text-foreground">{template.name}</div>
                          <div className="font-mono text-[10px] text-foreground-muted">From Documents Library</div>
                        </div>
                        {selectedSowTemplate === template.id && <Check className="w-4 h-4 text-accent" />}
                      </button>
                    ))}
                    {/* Uploaded SOW Template */}
                    {uploadedSowTemplate && (
                      <button
                        onClick={() => {
                          setSelectedSowTemplate('uploaded')
                        }}
                        className={cn(
                          "w-full text-left p-3 rounded-lg border transition-colors flex items-center gap-3",
                          selectedSowTemplate === 'uploaded'
                            ? "border-accent bg-accent/10"
                            : "border-border hover:border-white/30"
                        )}
                      >
                        <FileText className="w-5 h-5 text-green-400" />
                        <div className="flex-1">
                          <div className="font-display font-bold text-sm text-foreground">{uploadedSowTemplate.name}</div>
                          <div className="font-mono text-[10px] text-foreground-muted">Uploaded Template</div>
                        </div>
                        {selectedSowTemplate === 'uploaded' && <Check className="w-4 h-4 text-accent" />}
                      </button>
                    )}
                    <label className="w-full text-left p-3 rounded-lg border border-dashed border-border hover:border-accent/50 transition-colors flex items-center gap-3 cursor-pointer">
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,.pptx"
                        className="sr-only"
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          if (!checkFeatureAccess("file uploads")) return
                          setIsUploadingSowTemplate(true)
                          try {
                            // Keep this page resilient by storing selected template locally.
                            // Stage 01 only needs the chosen format metadata at this point.
                            setUploadedSowTemplate({ name: file.name, url: "" })
                            setSelectedSowTemplate('uploaded')
                          } catch (error) {
                            console.error('Upload error:', error)
                          } finally {
                            e.target.value = ""
                            setIsUploadingSowTemplate(false)
                          }
                        }}
                      />
                      {isUploadingSowTemplate ? (
                        <>
                          <Loader2 className="w-5 h-5 text-accent animate-spin" />
                          <span className="font-mono text-xs text-accent">Reading...</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-5 h-5 text-foreground-muted" />
                          <span className="font-mono text-xs text-foreground-muted">Upload New Template</span>
                        </>
                      )}
                    </label>
                  </div>
                </div>
              </div>
            </GlassCard>

            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={
                  isGenerating ||
                  !selectedProject ||
                  isExtractingBrief ||
                  !buildMasterBriefSourceText({
                    briefSourceText,
                    pastedContent,
                    googleLink,
                    briefFileName,
                    briefAugmentText,
                  }).trim()
                }
                onClick={handleSkipOutputTemplate}
                className="border-border text-foreground-muted hover:bg-white/5"
              >
                Skip — Use Client Brief As-Is
              </Button>
            </div>

            {/* Generate Button */}
            <div className="flex flex-col items-end gap-2">
              <p className="font-mono text-[10px] text-foreground-muted text-right max-w-md">
                {templateSourceText.trim()
                  ? "Using your uploaded output template to structure the Master RFP."
                  : "Upload an RFP output template in Step 1b for best results, or continue with a default structure."}{" "}
                Optional additional brief details above are included automatically.
              </p>
              <Button
                disabled={
                  isGenerating ||
                  !selectedProject ||
                  isExtractingBrief ||
                  !buildMasterBriefSourceText({
                    briefSourceText,
                    pastedContent,
                    googleLink,
                    briefFileName,
                    briefAugmentText,
                  }).trim()
                }
                onClick={generateMasterRfp}
                className="bg-accent text-accent-foreground hover:bg-accent/90 px-8"
              >
                {isGenerating ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin">◌</span> {MASTER_BRIEF_LOADING_MESSAGES[masterBriefLoadingMessageIndex]}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="ai-badge">✦</span> Generate Master RFP
                  </span>
                )}
              </Button>
              {isGenerating && (
                <p className="font-mono text-[10px] text-foreground-muted text-right max-w-md">
                  {MASTER_BRIEF_LOADING_MESSAGES[masterBriefLoadingMessageIndex]}
                </p>
              )}
              {generateMasterBriefError && (
                <div className="w-full max-w-lg ml-auto p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-200 text-right">
                  {generateMasterBriefError}
                </div>
              )}
            </div>
            {!isLoadingProjects && !selectedProject && projects.length === 0 && (
              <p className="mt-3 font-mono text-xs text-warning text-right">
                Select a project in Current Project View before generating the master brief.
              </p>
            )}
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={handleSendAsLightningRfp}
                className="border-accent/40 text-accent hover:bg-accent/10 flex items-center gap-2"
              >
                <Zap className="w-4 h-4" />
                Send as Lightning RFP Magic Link
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: Master RFP Review */}
        {currentStep === 2 && masterRfp && (
          <div className="space-y-6">
            <GlassCard>
              <div className="flex items-start justify-between mb-6">
                <div>
                  <span className="font-mono text-[10px] text-accent uppercase flex items-center gap-1 mb-2">
                    <span className="ai-badge">✦</span> AI Generated Master RFP
                  </span>
                  <h2 className="font-display font-bold text-2xl text-foreground">{masterRfp.projectName}</h2>
                  <p className="font-mono text-sm text-foreground-muted mt-1">Client: {masterRfp.client}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="border-border text-foreground hover:bg-white/5">
                    Edit
                  </Button>
                  <Button variant="outline" className="border-border text-foreground hover:bg-white/5">
                    Export PDF
                  </Button>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="p-3 rounded-lg bg-accent/10 border border-accent/20">
                  <div className="font-mono text-[10px] text-foreground-muted uppercase mb-1">Total Budget</div>
                  <div className="font-display font-bold text-xl text-accent">{masterRfp.totalBudget}</div>
                </div>
                <div className="p-3 rounded-lg bg-white/5 border border-border">
                  <div className="font-mono text-[10px] text-foreground-muted uppercase mb-1">Timeline</div>
                  <div className="font-display font-bold text-xl text-foreground">{masterRfp.timeline}</div>
                </div>
              </div>
              
              <div className="space-y-6">
                <div>
                  <h3 className="font-display font-bold text-sm text-foreground mb-2">Project Overview</h3>
                  <p className="text-sm text-foreground-muted leading-relaxed">{masterRfp.overview}</p>
                </div>
                
                <div>
                  <h3 className="font-display font-bold text-sm text-foreground mb-2">Objectives</h3>
                  <ul className="space-y-2">
                    {masterRfp.objectives.map((obj, i) => (
                      <li key={i} className="text-sm text-foreground-muted flex items-start gap-2">
                        <span className="text-accent mt-1">•</span>
                        <span>{obj}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                
                <div>
                  <h3 className="font-display font-bold text-sm text-foreground mb-3">
                    Scope of Work ({scopeItems.length} deliverables)
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {scopeItems.map((item) => (
                      <div key={item.id} className="p-3 rounded-lg bg-white/5 border border-border">
                        <div className="font-display font-bold text-sm text-foreground mb-1">{item.name}</div>
                        <div className="font-mono text-[10px] text-foreground-muted line-clamp-2 mb-2">{item.description}</div>
                        <div className="flex gap-3">
                          <span className="font-mono text-[10px] text-accent">{item.estimatedBudget}</span>
                          <span className="font-mono text-[10px] text-foreground-muted">{item.timeline}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </GlassCard>
            
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setCurrentStep(1)} className="border-border text-foreground hover:bg-white/5">
                Back
              </Button>
              <Button onClick={() => setCurrentStep(3)} className="bg-accent text-accent-foreground hover:bg-accent/90">
                Continue to Scope Allocation
              </Button>
            </div>
          </div>
        )}
        
        {/* STEP 3: Allocate Scope */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <GlassCard>
              <GlassCardHeader
                label="Step 3"
                title="Allocate Scope"
                description="For each deliverable, decide whether your team handles it internally or if you need an external partner."
              />
              
              <div className="space-y-3 mt-6">
                {scopeItems.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "p-4 rounded-lg border transition-all",
                      item.allocation === "internal" && "border-blue-500/50 bg-blue-500/5",
                      item.allocation === "outsource" && "border-accent/50 bg-accent/5",
                      item.allocation === null && "border-border bg-white/5"
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-display font-bold text-foreground">{item.name}</h4>
                          {item.allocation && (
                            <span className={cn(
                              "font-mono text-[9px] px-2 py-0.5 rounded uppercase",
                              item.allocation === "internal" && "bg-blue-500/30 text-blue-300",
                              item.allocation === "outsource" && "bg-accent/30 text-accent"
                            )}>
                              {item.allocation === "internal" ? "Internal" : "Outsource"}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-foreground-muted mb-2">{item.description}</p>
                        <div className="flex gap-3">
                          <span className="font-mono text-[10px] text-accent">{item.estimatedBudget}</span>
                          <span className="font-mono text-[10px] text-foreground-muted">{item.timeline}</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => allocateScope(item.id, "internal")}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-mono transition-all",
                            item.allocation === "internal"
                              ? "border-blue-500 bg-blue-900/30 text-blue-100"
                              : "border-border text-foreground-muted hover:border-blue-500/50 hover:text-blue-300"
                          )}
                        >
                          <Building2 className="w-3.5 h-3.5" />
                          Internal
                        </button>
                        <button
                          onClick={() => allocateScope(item.id, "outsource")}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-mono transition-all",
                            item.allocation === "outsource"
                              ? "border-accent bg-accent/20 text-accent"
                              : "border-border text-foreground-muted hover:border-accent/50 hover:text-accent"
                          )}
                        >
                          <Users className="w-3.5 h-3.5" />
                          Outsource
                        </button>
                        <button
                          onClick={() => removeScopeItem(item.id)}
                          className="p-2 rounded-lg border border-border text-foreground-muted hover:border-red-500/50 hover:text-red-400 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Add new scope item */}
              <div className="mt-6 pt-4 border-t border-border">
                <div className="flex items-center gap-2 mb-3">
                  <Plus className="w-4 h-4 text-foreground-muted" />
                  <span className="text-sm text-foreground-muted">Add custom scope item</span>
                </div>
                <div className="flex gap-3">
                  <Input
                    placeholder="Name (e.g., PR & Communications)"
                    value={newScopeName}
                    onChange={(e) => setNewScopeName(e.target.value)}
                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                  />
                  <Input
                    placeholder="Brief description"
                    value={newScopeDesc}
                    onChange={(e) => setNewScopeDesc(e.target.value)}
                    className="flex-1 bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                  />
                  <Button
                    onClick={addScopeItem}
                    disabled={!newScopeName.trim()}
                    variant="outline"
                    className="border-border text-foreground hover:bg-white/5"
                  >
                    Add
                  </Button>
                </div>
              </div>
            </GlassCard>
            
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
              <GlassCard className="text-center py-6">
                <div className="font-display font-bold text-3xl text-blue-400 mb-1">{internalItems.length}</div>
                <div className="font-mono text-xs text-foreground-muted">Internal</div>
              </GlassCard>
              <GlassCard className="text-center py-6">
                <div className="font-display font-bold text-3xl text-accent mb-1">{outsourcedItems.length}</div>
                <div className="font-mono text-xs text-foreground-muted">Outsource</div>
              </GlassCard>
              <GlassCard className="text-center py-6">
                <div className="font-display font-bold text-3xl text-foreground-muted mb-1">{unallocatedItems.length}</div>
                <div className="font-mono text-xs text-foreground-muted">Unallocated</div>
              </GlassCard>
            </div>
            
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setCurrentStep(2)} className="border-border text-foreground hover:bg-white/5">
                Back
              </Button>
              <Button 
                onClick={() => setCurrentStep(4)} 
                disabled={unallocatedItems.length > 0}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                Continue to Review
              </Button>
            </div>
          </div>
        )}
        
        {/* STEP 4: Review Allocation */}
        {currentStep === 4 && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              {/* Internal */}
              <GlassCard>
                <GlassCardHeader
                  label="Your Team"
                  title="Handled Internally"
                  description={`${internalItems.length} deliverables your agency will own`}
                />
                <div className="space-y-2 mt-4">
                  {internalItems.map((item) => (
                    <div key={item.id} className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <div className="font-display font-bold text-sm text-foreground">{item.name}</div>
                      <div className="font-mono text-[10px] text-accent mt-1">{item.estimatedBudget}</div>
                    </div>
                  ))}
                  {internalItems.length === 0 && (
                    <div className="text-center py-8 text-foreground-muted font-mono text-sm">
                      No items allocated internally
                    </div>
                  )}
                </div>
              </GlassCard>
              
              {/* Outsource */}
              <GlassCard>
                <GlassCardHeader
                  label="External Partners"
                  title="Outsourced"
                  description={`${outsourcedItems.length} deliverables for external partners`}
                />
                <div className="space-y-2 mt-4">
                  {outsourcedItems.map((item) => (
                    <div key={item.id} className="p-3 rounded-lg bg-accent/10 border border-accent/20">
                      <div className="font-display font-bold text-sm text-foreground">{item.name}</div>
                      <div className="font-mono text-[10px] text-accent mt-1">{item.estimatedBudget}</div>
                    </div>
                  ))}
                  {outsourcedItems.length === 0 && (
                    <div className="text-center py-8 text-foreground-muted font-mono text-sm">
                      No items to outsource
                    </div>
                  )}
                </div>
              </GlassCard>
            </div>
            
            {/* Additional Context */}
            <GlassCard>
              <GlassCardHeader
                label="Optional"
                title="Additional Context for AI"
                description="Provide any extra information the AI should consider when generating partner-specific RFPs."
              />
              <Textarea
                placeholder="E.g., preferred vendors, budget flexibility, or fixed timeline constraints the AI should respect."
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                className="mt-4 min-h-[100px] bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
              />
            </GlassCard>
            
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setCurrentStep(3)} className="border-border text-foreground hover:bg-white/5">
                Back
              </Button>
              <Button 
                onClick={() => setCurrentStep(5)}
                disabled={outsourcedItems.length === 0}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                <span className="flex items-center gap-2">
                  <span className="ai-badge">✦</span> Generate Partner RFPs
                </span>
              </Button>
            </div>
          </div>
        )}
        
        {/* STEP 5: Select Recipients */}
        {currentStep === 5 && (
          <div className="space-y-6">
            <GlassCard>
              <GlassCardHeader
                label="Step 5"
                title="Select Recipients"
                description="Confirmed partners from your account load automatically below. For each outsourced deliverable, pick recipients or invite a new contact by email."
              />
            </GlassCard>
            
            {/* Step 00 Directors Shortlist - reference only, no selection */}
            {briefSource === "step00" && selectedInterpretation?.directors_result?.recommendations && selectedInterpretation.directors_result.recommendations.length > 0 && (
              <GlassCard>
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px flex-1 bg-border" />
                  <span className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">From Step 00 Shortlist</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <p className="text-xs text-foreground-muted mb-3">Directors and production companies recommended for this brief. Use as a reference when inviting new contacts below.</p>
                <div className="flex flex-wrap gap-2">
                  {selectedInterpretation.directors_result.recommendations.map((rec, i) => (
                    <span key={i} className="inline-flex items-center gap-1 font-mono text-[10px] px-2.5 py-1 rounded-full border border-border bg-white/5 text-foreground-muted whitespace-nowrap">
                      <span className="text-foreground font-medium">{rec.name}</span>
                      <span className="text-foreground-muted/60">/</span>
                      <span>{rec.company}</span>
                    </span>
                  ))}
                </div>
              </GlassCard>
            )}

                        {outsourcedItems.map((item) => (
              <GlassCard key={item.id}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="font-display font-bold text-lg text-foreground">{item.name}</div>
                    <div className="font-mono text-xs text-foreground-muted mt-1">{item.description}</div>
                    <div className="flex gap-3 mt-2">
                      <span className="font-mono text-[10px] text-accent">{item.estimatedBudget}</span>
                      <span className="font-mono text-[10px] text-foreground-muted">{item.timeline}</span>
                    </div>
                  </div>
                  <span className={cn(
                    "font-mono text-[10px] px-3 py-1 rounded-full",
                    getRecipientCount(item.id) > 0 ? "bg-accent/10 text-accent" : "bg-white/5 text-foreground-muted"
                  )}>
                    {getRecipientCount(item.id)} recipient{getRecipientCount(item.id) !== 1 ? 's' : ''}
                  </span>
                </div>
                
                {/* Selected Recipients Display */}
                {getRecipientCount(item.id) > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4 p-3 rounded-lg bg-white/5">
                    {(selectedPartners[item.id] || []).map((partnerId) => {
                      const partner = existingPartners.find(p => p.id === partnerId)
                      if (!partner) return null
                      return (
                        <div key={partnerId} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20">
                          <span className="font-mono text-xs text-foreground">{partner.name}</span>
                          {partner.ndaSigned ? (
                            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-success/20 text-success flex items-center gap-1">
                              <Shield className="w-2.5 h-2.5" /> NDA Signed {partner.ndaSignedDate ? `(${partner.ndaSignedDate})` : ""}
                            </span>
                          ) : (
                            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-warning/20 text-warning">NDA Pending</span>
                          )}
                          <button 
                            onClick={() => togglePartner(item.id, partnerId)}
                            className="text-foreground-muted hover:text-foreground ml-1"
                          >
                            ×
                          </button>
                        </div>
                      )
                    })}
                    {(newRecipients[item.id] || []).map((recipient, index) => (
                      <div key={index} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20">
                        <span className="font-mono text-xs text-foreground">
                          {recipient.name ? `${recipient.name} · ${recipient.email}` : recipient.email}
                        </span>
                        <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-100">New</span>
                        {recipient.sendAsMagicLink && (
                          <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-accent/15 text-accent flex items-center gap-0.5">
                            <Zap className="w-2.5 h-2.5" /> Magic Link
                          </span>
                        )}
                        {ndaSignatureRequired && recipient.requireNda && (
                          <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-warning/20 text-warning">NDA Required</span>
                        )}
                        <button 
                          onClick={() => removeNewRecipient(item.id, index)}
                          className="text-foreground-muted hover:text-foreground ml-1"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-4">
                  {/* Existing Partners */}
                  <div>
                    <label className="font-mono text-[10px] text-foreground-muted uppercase block mb-2">
                      From Your Partner Pool
                    </label>
                    {!isDemo && poolPartnersLoading && (
                      <div className="flex items-center gap-2 py-4 font-mono text-xs text-foreground-muted">
                        <Loader2 className="w-4 h-4 animate-spin text-accent" />
                        Loading partners…
                      </div>
                    )}
                    {!isDemo && poolPartnersError && (
                      <p className="text-xs text-red-300 py-2">{poolPartnersError}</p>
                    )}
                    {!isDemo && !poolPartnersLoading && !poolPartnersError && poolPartners.length === 0 && (
                      <p className="text-xs text-foreground-muted py-2">
                        No active partners yet. Invite a partner from your network; they appear here after they accept the partnership.
                      </p>
                    )}
                    {!isDemo && pendingPartnerInvites.length > 0 && (
                      <div className="mb-3 p-2 rounded-md border border-border/60 bg-white/[0.02]">
                        <div className="font-mono text-[9px] text-foreground-muted uppercase mb-1">Pending invitations</div>
                        <ul className="space-y-1">
                          {pendingPartnerInvites.map((inv) => (
                            <li key={inv.id} className="font-mono text-[10px] text-foreground-muted">
                              {inv.email} <span className="text-foreground-muted/60">(awaiting acceptance)</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="space-y-2 max-h-[280px] overflow-y-auto pr-2">
                      {existingPartners.map((partner) => {
                        const isSelected = (selectedPartners[item.id] || []).includes(partner.id)
                        return (
                          <button
                            key={partner.id}
                            onClick={() => togglePartner(item.id, partner.id)}
                            className={cn(
                              "w-full text-left p-3 rounded-lg border transition-all",
                              isSelected
                                ? "border-accent bg-accent/10"
                                : "border-border hover:border-white/30 bg-white/5"
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-display font-bold text-sm text-foreground truncate">{partner.name}</span>
                                  {partner.bookmarked && <span className="text-yellow-400 text-xs">★</span>}
                                </div>
                                <div className="font-mono text-[10px] text-foreground-muted">{partner.discipline}</div>
                                {partner.pastProjects && partner.pastProjects.length > 0 && (
                                  <div className="font-mono text-[9px] text-foreground-muted/60 mt-1 truncate">
                                    Past: {partner.pastProjects.join(", ")}
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                {partner.ndaSigned ? (
                                  <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-success/20 text-success">
                                    NDA Signed {partner.ndaSignedDate ? partner.ndaSignedDate : "✓"}
                                  </span>
                                ) : (
                                  <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-warning/20 text-warning">NDA Pending</span>
                                )}
                                {partner.msaApproved ? (
                                  <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-success/20 text-success">MSA ✓</span>
                                ) : (
                                  <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-foreground-muted/20 text-foreground-muted">No MSA</span>
                                )}
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  
                  {/* New Contact */}
                  <div>
                    <label className="font-mono text-[10px] text-foreground-muted uppercase block mb-2">
                      Invite New Partner
                    </label>
                    <div className="space-y-3 p-4 rounded-lg bg-white/5 border border-border">
                      <Input
                        placeholder="Contact name"
                        value={recipientDrafts[item.id]?.name || ""}
                        onChange={(e) =>
                          setRecipientDrafts((prev) => ({
                            ...prev,
                            [item.id]: {
                              email: prev[item.id]?.email || "",
                              name: e.target.value,
                              requireNda: prev[item.id]?.requireNda ?? ndaSignatureRequired,
                              sendAsMagicLink: prev[item.id]?.sendAsMagicLink ?? true,
                            },
                          }))
                        }
                        className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                      />
                      <Input
                        placeholder="Email address"
                        value={recipientDrafts[item.id]?.email || ""}
                        onChange={(e) =>
                          setRecipientDrafts((prev) => ({
                            ...prev,
                            [item.id]: {
                              email: e.target.value,
                              name: prev[item.id]?.name || "",
                              requireNda: prev[item.id]?.requireNda ?? ndaSignatureRequired,
                              sendAsMagicLink: prev[item.id]?.sendAsMagicLink ?? true,
                            },
                          }))
                        }
                        className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                      />
                      {ndaSignatureRequired ? (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={recipientDrafts[item.id]?.requireNda ?? true}
                            onChange={(e) =>
                              setRecipientDrafts((prev) => ({
                                ...prev,
                                [item.id]: {
                                  email: prev[item.id]?.email || "",
                                  name: prev[item.id]?.name || "",
                                  requireNda: e.target.checked,
                                  sendAsMagicLink: prev[item.id]?.sendAsMagicLink ?? true,
                                },
                              }))
                            }
                            className="rounded border-border"
                          />
                          <span className="font-mono text-[10px] text-foreground-muted">
                            Require NDA signature before viewing RFP
                          </span>
                        </label>
                      ) : (
                        <p className="font-mono text-[10px] text-foreground-muted">
                          NDA requirement is off for this broadcast.
                        </p>
                      )}
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={recipientDrafts[item.id]?.sendAsMagicLink ?? true}
                          onChange={(e) =>
                            setRecipientDrafts((prev) => ({
                              ...prev,
                              [item.id]: {
                                email: prev[item.id]?.email || "",
                                name: prev[item.id]?.name || "",
                                requireNda: prev[item.id]?.requireNda ?? ndaSignatureRequired,
                                sendAsMagicLink: e.target.checked,
                              },
                            }))
                          }
                          className="rounded border-border"
                        />
                        <span className="font-mono text-[10px] text-foreground-muted flex items-center gap-1">
                          <Zap className="w-3 h-3 text-accent" />
                          Send as Magic Link
                        </span>
                      </label>
                      <Button
                        size="sm"
                        onClick={() => addNewRecipient(item.id)}
                        disabled={!(recipientDrafts[item.id]?.email || "").trim()}
                        className="w-full bg-accent/10 text-accent hover:bg-accent/20"
                      >
                        <Plus className="w-4 h-4 mr-1" /> Add New Contact
                      </Button>
                      {recipientAddErrors[item.id] && (
                        <p className="font-mono text-[10px] text-red-300">{recipientAddErrors[item.id]}</p>
                      )}
                      {recipientAddSuccess[item.id] && !recipientAddErrors[item.id] && (
                        <p className="font-mono text-[10px] text-green-300">{recipientAddSuccess[item.id]}</p>
                      )}
                    </div>
                  </div>
                </div>
              </GlassCard>
            ))}
            
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setCurrentStep(4)} className="border-border text-foreground hover:bg-white/5">
                Back
              </Button>
              <Button 
                onClick={() => setCurrentStep(6)}
                disabled={!allOutsourcedHaveRecipients()}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                Review & Broadcast
              </Button>
            </div>
          </div>
        )}
        
        {/* STEP 6: Broadcast */}
        {currentStep === 6 && !broadcastComplete && (
          <div className="space-y-6">
            <GlassCard>
              <GlassCardHeader
                label="Step 6"
                title="Ready to Broadcast"
                description="Review your RFP distribution and send to selected partners."
              />
              
              <div className="space-y-4 mt-6">
                {outsourcedItems.map((item) => (
                  <div key={item.id} className="p-4 rounded-lg bg-white/5 border border-border">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="font-display font-bold text-foreground">{item.name}</div>
                        <div className="font-mono text-[10px] text-accent mt-1">{item.estimatedBudget}</div>
                      </div>
                      <span className="font-mono text-[10px] text-foreground-muted">
                        {getRecipientCount(item.id)} recipient{getRecipientCount(item.id) !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(selectedPartners[item.id] || []).map((partnerId) => {
                        const partner = existingPartners.find(p => p.id === partnerId)
                        if (!partner) return null
                        return (
                          <span key={partnerId} className="font-mono text-xs px-2 py-1 rounded-full bg-accent/10 text-foreground">
                            {partner.name}
                            {!partner.ndaSigned && <span className="text-warning ml-1">(NDA pending)</span>}
                          </span>
                        )
                      })}
                      {(newRecipients[item.id] || []).map((recipient, index) => (
                        <span key={index} className="font-mono text-xs px-2 py-1 rounded-full bg-blue-500/10 text-foreground">
                          {recipient.name || recipient.email}
                          <span className="text-blue-300 ml-1">(New)</span>
                          {recipient.requireNda && <span className="text-warning ml-1">(NDA pending)</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 p-4 rounded-lg border border-border bg-white/5 space-y-2">
                <label className="font-mono text-[10px] text-foreground-muted uppercase block">
                  Response Deadline
                </label>
                <Input
                  type="date"
                  value={responseDeadlineDate}
                  onChange={(e) => setResponseDeadlineDate(e.target.value)}
                  className="bg-white/5 border-border text-foreground"
                />
                <p className="font-mono text-[10px] text-foreground-muted">
                  Optional. If set, partners will see “Respond by” in their inbox and RFP detail view.
                </p>
              </div>

              <div className="mt-6 p-4 rounded-lg border border-border bg-white/5 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={ndaSignatureRequired}
                    onCheckedChange={(v) => {
                      setNdaSignatureRequired(v === true)
                      if (v === true && defaultNdaUrl && (!ndaSigningLink.trim() || ndaSigningLink === "https://www.docusign.com/")) {
                        setNdaSigningLink(defaultNdaUrl)
                      }
                    }}
                    className="border-border"
                  />
                  <span className="font-mono text-xs text-foreground">NDA Signature Required</span>
                </label>
                {ndaSignatureRequired && (
                  <div className="space-y-2">
                    <label className="font-mono text-[10px] text-foreground-muted uppercase block">
                      NDA signing link
                    </label>
                    <Input
                      value={ndaSigningLink}
                      onChange={(e) => setNdaSigningLink(e.target.value)}
                      placeholder="https://www.docusign.com/"
                      className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                    />
                    <p className="font-mono text-[10px] text-foreground-muted">
                      Recipients without confirmed NDA will get this link in their broadcast email.
                    </p>
                  </div>
                )}
              </div>
              
              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-4 mt-6 pt-6 border-t border-border">
                <div className="text-center">
                  <div className="font-display font-bold text-2xl text-foreground">{outsourcedItems.length}</div>
                  <div className="font-mono text-[10px] text-foreground-muted">RFPs</div>
                </div>
                <div className="text-center">
                  <div className="font-display font-bold text-2xl text-accent">
                    {Object.values(selectedPartners).flat().length + Object.values(newRecipients).flat().length}
                  </div>
                  <div className="font-mono text-[10px] text-foreground-muted">Total Recipients</div>
                </div>
                <div className="text-center">
                  <div className="font-display font-bold text-2xl text-blue-400">
                    {Object.values(newRecipients).flat().length}
                  </div>
                  <div className="font-mono text-[10px] text-foreground-muted">New Contacts</div>
                </div>
                <div className="text-center">
                  <div className="font-display font-bold text-2xl text-warning">
                    {ndaSignatureRequired ? getTotalNewWithNda() + getTotalExistingWithoutNda() : 0}
                  </div>
                  <div className="font-mono text-[10px] text-foreground-muted">NDAs Required</div>
                </div>
              </div>
            </GlassCard>

            {selectedProject?.id && <AgencyRfpMagicLinkInvite projectId={selectedProject.id} />}

            {ndaSignatureRequired && (getTotalNewWithNda() + getTotalExistingWithoutNda()) > 0 && (
              <GlassCard className="border-warning/30 bg-warning/5">
                <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                  <div>
                    <div className="font-display font-bold text-sm text-foreground mb-1">NDA Signature Required</div>
                    <div className="text-sm text-foreground-muted">
                      {getTotalNewWithNda() + getTotalExistingWithoutNda()} recipient(s) will receive an NDA for signature before they can view the RFP details. 
                      Their NDA status will be tracked in your Partner Pool.
                    </div>
                  </div>
                </div>
              </GlassCard>
            )}
            
            {broadcastError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-200">
                {broadcastError}
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setCurrentStep(5)} className="border-border text-foreground hover:bg-white/5">
                Back
              </Button>
              <Button 
                onClick={() => void broadcastRfps()}
                disabled={isBroadcasting}
                className="bg-accent text-accent-foreground hover:bg-accent/90 px-8"
              >
                {isBroadcasting ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin">◌</span> Broadcasting...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Send className="w-4 h-4" /> Broadcast RFPs
                  </span>
                )}
              </Button>
            </div>
          </div>
        )}
        
        {/* Broadcast Complete */}
        {broadcastComplete && (
          <GlassCard className="text-center py-12">
            <div className="w-20 h-20 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-6">
              <Check className="w-10 h-10 text-success" />
            </div>
            <h2 className="font-display font-bold text-2xl text-foreground mb-2">RFPs Broadcasted Successfully!</h2>
            <p className="text-foreground-muted mb-6 max-w-md mx-auto">
              {outsourcedItems.length} RFP{outsourcedItems.length > 1 ? 's' : ''} sent to{' '}
              {Object.values(selectedPartners).flat().length + Object.values(newRecipients).flat().length} partner{Object.values(selectedPartners).flat().length + Object.values(newRecipients).flat().length > 1 ? 's' : ''}.
              Track responses in Bid Management.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mb-8">
              {outsourcedItems.map(item => (
                <span key={item.id} className="font-mono text-[11px] px-3 py-1 rounded-full bg-accent/20 text-accent">
                  {item.name}
                </span>
              ))}
            </div>
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={resetFlow} className="border-border text-foreground hover:bg-white/5">
                Create Another RFP
              </Button>
              <Button className="bg-accent text-accent-foreground hover:bg-accent/90" asChild>
                <a href="/agency/bids">View Bid Management</a>
              </Button>
            </div>
          </GlassCard>
        )}
      </div>
  )
}


class RFPErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8 max-w-2xl">
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
            <div className="font-display font-bold text-lg text-foreground mb-2">Something went wrong</div>
            <p className="text-sm text-foreground-muted mb-4">
              An error occurred while loading the RFP Broadcast page. Refresh to try again.
            </p>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="font-mono text-xs px-4 py-2 rounded-lg bg-white/10 text-foreground hover:bg-white/15 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function AgencyRFPPage() {
  return (
    <AgencyLayout>
      <RFPErrorBoundary>
        <Suspense fallback={null}>
          <AgencyRFPContent />
        </Suspense>
      </RFPErrorBoundary>
    </AgencyLayout>
  )
}
