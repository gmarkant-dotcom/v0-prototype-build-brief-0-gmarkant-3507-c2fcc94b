"use client"

import { useState, useRef, useEffect } from "react"
import { AgencyLayout } from "@/components/agency-layout"
import { StageHeader } from "@/components/stage-header"
import { SelectedProjectHeader } from "@/components/selected-project-header"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import { usePaidUser } from "@/contexts/paid-user-context"
import { useSelectedProject } from "@/contexts/selected-project-context"
import { Upload, FileText, Link2, Type, Plus, Trash2, Building2, Users, ChevronRight, Check, Send, Shield, FileCheck, Loader2, Sparkles } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { FileUpload } from "@/components/file-upload"

// Types
type UploadMethod = "pdf" | "docx" | "pptx" | "google" | "paste" | null

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

function AgencyRFPContent() {
  const { checkFeatureAccess } = usePaidUser()
  const { selectedProject } = useSelectedProject()
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** Must stay mounted when switching 1b tabs so "Upload file" can call .click() (input was inside `upload` branch only → ref null in AI mode). */
  const rfpTemplateFileInputRef = useRef<HTMLInputElement>(null)
  
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
  const [newEmail, setNewEmail] = useState("")
  const [newName, setNewName] = useState("")
  const [requireNdaForNew, setRequireNdaForNew] = useState(true)
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  
  // Step 6: Broadcast
  const [isBroadcasting, setIsBroadcasting] = useState(false)
  const [broadcastComplete, setBroadcastComplete] = useState(false)
  const [broadcastError, setBroadcastError] = useState<string | null>(null)
  const [ndaSignatureRequired, setNdaSignatureRequired] = useState(false)
  const [ndaSigningLink, setNdaSigningLink] = useState("https://www.docusign.com/")
  
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
  
  const handleUploadClick = () => {
    // Directly click the file input - feature access is checked on file selection
    fileInputRef.current?.click()
  }

  const triggerRfpTemplateFilePicker = () => {
    setRfpTemplateMode("upload")
    rfpTemplateFileInputRef.current?.click()
  }

  const handleRfpTemplateFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!checkFeatureAccess("file uploads")) {
      setRfpTemplateUploadError("File uploads require an active subscription (or use demo mode).")
      e.target.value = ""
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
      e.target.value = ""
    }
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
    setIsGeneratingAiTemplate(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 125_000)
    try {
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
      let payload: Record<string, unknown> = {}
      try {
        payload = (await res.json()) as Record<string, unknown>
      } catch {
        payload = {}
      }
      if (!res.ok) {
        const parts = [
          typeof payload.error === "string" ? payload.error : null,
          typeof payload.hint === "string" ? payload.hint : null,
          typeof payload.detail === "string" ? payload.detail : null,
          !payload.error && !payload.detail && !payload.hint ? `HTTP ${res.status}` : null,
        ].filter(Boolean)
        throw new Error(parts.join(" — ") || "Generation failed")
      }
      const text = (payload.templateText || "").toString().trim()
      if (!text) {
        throw new Error("AI returned an empty template. Check server logs and ANTHROPIC_API_KEY on Vercel.")
      }
      setTemplateSourceText(text)
      setSelectedRfpTemplate("ai")
      setUploadedRfpTemplate(null)
      setRfpTemplateExtractWarning(null)
      setRfpTemplateUploadError(null)
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
    if (!newEmail.trim()) return
    setNewRecipients(prev => ({
      ...prev,
      [scopeItemId]: [...(prev[scopeItemId] || []), { email: newEmail, name: newName, requireNda: requireNdaForNew }]
    }))
    setNewEmail("")
    setNewName("")
    setRequireNdaForNew(true)
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
      const items = outsourcedItems.map((item) => ({
        scopeItemId: item.id,
        scopeItem: item,
        partnerIds: selectedPartners[item.id] || [],
        newRecipients: newRecipients[item.id] || [],
      }))
      const res = await fetch("/api/agency/broadcast-rfp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProject?.id ?? null,
          masterRfp,
          ndaRequired: ndaSignatureRequired,
          ndaLink: ndaSignatureRequired ? ndaSigningLink.trim() : "",
          items,
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(
          [payload?.error, payload?.detail].filter(Boolean).join(" ") || "Broadcast failed"
        )
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
    setMasterRfp(null)
    setGenerateMasterBriefError(null)
    setIsGenerating(false)
    setScopeItems([])
    setNewScopeName("")
    setNewScopeDesc("")
    setSelectedPartners({})
    setNewRecipients({})
    setNewEmail("")
    setNewName("")
    setRequireNdaForNew(true)
    setActiveItemId(null)
    setAdditionalContext("")
    setNdaSignatureRequired(false)
    setNdaSigningLink("https://www.docusign.com/")
  }

  useEffect(() => {
    // Project switch should reset local RFP workflow state to avoid stale data.
    resetFlow()
  }, [selectedProject?.id])
  
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
        <SelectedProjectHeader />
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
            <GlassCard>
              <GlassCardHeader
                label="Step 1a"
                title="Client brief (source)"
                description="Upload the client’s brief or paste text. We extract the text so the model can use your real requirements—not just the file name."
              />
              
              {/* Upload Options */}
              <div className="grid grid-cols-5 gap-3 mt-6">
                {[
                  { method: "pdf" as const, label: "PDF", color: "text-red-400", icon: FileText },
                  { method: "docx" as const, label: "Word", color: "text-blue-400", icon: FileText },
                  { method: "pptx" as const, label: "PowerPoint", color: "text-orange-400", icon: FileText },
                  { method: "google" as const, label: "Google Link", color: "text-green-400", icon: Link2 },
                  { method: "paste" as const, label: "Paste Text", color: "text-accent", icon: Type },
                ].map(({ method, label, color, icon: Icon }) => (
                  <button
                    key={method}
                    onClick={() => setUploadMethod(method)}
                    className={cn(
                      "flex flex-col items-center gap-2 p-4 rounded-lg border transition-all",
                      uploadMethod === method
                        ? "border-accent bg-accent/10"
                        : "border-border hover:border-white/30 bg-white/5"
                    )}
                  >
                    <Icon className={cn("w-6 h-6", color)} />
                    <span className={cn("font-mono text-xs font-bold", color)}>{label}</span>
                  </button>
                ))}
              </div>
              
              {/* Upload Area based on method */}
              {uploadMethod && !briefUploaded && (
                <div className="mt-6">
                  {(uploadMethod === "pdf" || uploadMethod === "docx" || uploadMethod === "pptx") && (
                    <label className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-accent/50 transition-colors cursor-pointer relative block">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={uploadMethod === "pdf" ? ".pdf" : uploadMethod === "docx" ? ".doc,.docx" : ".ppt,.pptx"}
                        onChange={handleFileChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
                        <Upload className="w-8 h-8 text-accent" />
                      </div>
                      <div className="font-display font-bold text-foreground mb-1">
                        Drop your {uploadMethod.toUpperCase()} file here
                      </div>
                      <div className="font-mono text-[10px] text-foreground-muted">or click to browse (max 50MB)</div>
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
                        onChange={(e) => setGoogleLink(e.target.value)}
                        className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                      />
                      <Button 
                        className="bg-accent text-accent-foreground hover:bg-accent/90"
                        disabled={!googleLink}
                        onClick={() => {
                          setBriefUploadError(null)
                          setBriefExtractWarning(null)
                          setBriefUploaded(true)
                          setBriefFileName("Google Doc imported")
                          setBriefSourceText(`Imported Google document: ${googleLink}`)
                        }}
                      >
                        Import from Google
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
            
            {/* Output format template + SOW (RFP format drives Generate Master RFP) */}
            <GlassCard>
              <GlassCardHeader
                label="Step 1b"
                title="Output template (your format)"
                description="Upload a Word/PDF structure, or generate a layout with AI. The Master RFP step maps your client brief into this format (sections, headings, tone)."
              />

              <input
                ref={rfpTemplateFileInputRef}
                id="rfp-template-file-input"
                type="file"
                accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                className="sr-only"
                onChange={(e) => void handleRfpTemplateFileChange(e)}
              />

              <div className="flex flex-wrap gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => triggerRfpTemplateFilePicker()}
                  className={cn(
                    "font-mono text-xs px-3 py-2 rounded-lg border transition-colors flex items-center gap-2",
                    rfpTemplateMode === "upload"
                      ? "border-accent bg-accent/10 text-foreground"
                      : "border-border text-foreground-muted hover:border-white/30"
                  )}
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload file
                </button>
                <button
                  type="button"
                  onClick={() => setRfpTemplateMode("ai")}
                  className={cn(
                    "font-mono text-xs px-3 py-2 rounded-lg border transition-colors flex items-center gap-2",
                    rfpTemplateMode === "ai"
                      ? "border-accent bg-accent/10 text-foreground"
                      : "border-border text-foreground-muted hover:border-white/30"
                  )}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Generate with AI
                </button>
              </div>
              
              <div className="grid grid-cols-2 gap-6 mt-4">
                <div>
                  <label className="font-mono text-[10px] text-foreground-muted uppercase block mb-2">
                    RFP output template
                  </label>
                  {rfpTemplateMode === "upload" ? (
                  <div className="space-y-2">
                    {(isDemoMode() ? demoTemplates : []).filter(t => t.type === "rfp").map((template) => (
                      <button
                        key={template.id}
                        onClick={() => {
                          const next = template.id === selectedRfpTemplate ? null : template.id
                          setSelectedRfpTemplate(next)
                          setRfpTemplateMode("upload")
                          if (next) {
                            setUploadedRfpTemplate(null)
                            setTemplateSourceText("")
                            setRfpTemplateUploadError(null)
                            setRfpTemplateExtractWarning(null)
                          }
                        }}
                        className={cn(
                          "w-full text-left p-3 rounded-lg border transition-colors flex items-center gap-3",
                          selectedRfpTemplate === template.id
                            ? "border-accent bg-accent/10"
                            : "border-border hover:border-white/30"
                        )}
                      >
                        <FileText className="w-5 h-5 text-blue-400" />
                        <div className="flex-1">
                          <div className="font-display font-bold text-sm text-foreground">{template.name}</div>
                          <div className="font-mono text-[10px] text-foreground-muted">From Documents Library</div>
                        </div>
                        {selectedRfpTemplate === template.id && <Check className="w-4 h-4 text-accent" />}
                      </button>
                    ))}
                    {/* Uploaded RFP Template */}
                    {uploadedRfpTemplate && (
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => {
                            setRfpTemplateMode("upload")
                            setSelectedRfpTemplate("uploaded")
                            setSelectedSowTemplate(null)
                          }}
                          className={cn(
                            "w-full text-left p-3 rounded-lg border transition-colors flex items-center gap-3",
                            selectedRfpTemplate === "uploaded"
                              ? "border-accent bg-accent/10"
                              : "border-border hover:border-white/30"
                          )}
                        >
                          <FileText className="w-5 h-5 text-green-400" />
                          <div className="flex-1 min-w-0">
                            <div className="font-display font-bold text-sm text-foreground truncate">{uploadedRfpTemplate.name}</div>
                            <div className="font-mono text-[10px] text-foreground-muted">
                              {templateSourceText
                                ? `Format loaded — ${templateSourceText.length.toLocaleString()} characters`
                                : "No readable format text"}
                            </div>
                          </div>
                          {selectedRfpTemplate === "uploaded" && <Check className="w-4 h-4 text-accent shrink-0" />}
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-foreground-muted hover:text-foreground h-8"
                          onClick={() => {
                            setUploadedRfpTemplate(null)
                            setTemplateSourceText("")
                            setSelectedRfpTemplate(null)
                            setRfpTemplateUploadError(null)
                            setRfpTemplateExtractWarning(null)
                          }}
                        >
                          Remove template
                        </Button>
                      </div>
                    )}
                    <label
                      htmlFor="rfp-template-file-input"
                      className="w-full text-left p-3 rounded-lg border border-dashed border-border hover:border-accent/50 transition-colors flex items-center gap-3 cursor-pointer"
                    >
                      {isUploadingRfpTemplate ? (
                        <>
                          <Loader2 className="w-5 h-5 text-accent animate-spin" />
                          <span className="font-mono text-xs text-accent">Reading template…</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-5 h-5 text-foreground-muted" />
                          <span className="font-mono text-xs text-foreground-muted">Upload output template</span>
                        </>
                      )}
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-border/60 text-foreground-muted"
                      disabled={isUploadingRfpTemplate}
                      onClick={() => triggerRfpTemplateFilePicker()}
                    >
                      <Upload className="w-3.5 h-3.5 mr-1.5" />
                      Choose file…
                    </Button>
                    {rfpTemplateUploadError && (
                      <div
                        role="alert"
                        className="rounded-lg border border-red-400/40 bg-red-950/40 px-3 py-2 text-xs text-red-200"
                      >
                        {rfpTemplateUploadError}
                      </div>
                    )}
                    {rfpTemplateExtractWarning && !rfpTemplateUploadError && (
                      <p className="text-xs text-amber-300 px-1">{rfpTemplateExtractWarning}</p>
                    )}
                  </div>
                  ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <span className="font-mono text-[10px] text-foreground-muted uppercase block">
                        Template style
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {(
                          [
                            { id: "formal" as const, label: "Formal / structured" },
                            { id: "lean" as const, label: "Lean / conversational" },
                            { id: "creative" as const, label: "Creative agency style" },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setAiTemplateStyle(opt.id)}
                            className={cn(
                              "font-mono text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors",
                              aiTemplateStyle === opt.id
                                ? "border-accent bg-accent/10 text-foreground"
                                : "border-border text-foreground-muted hover:border-white/30"
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <span className="font-mono text-[10px] text-foreground-muted uppercase block">
                        Sensitivity (optional)
                      </span>
                      <div className="space-y-2">
                        {(
                          [
                            { checked: aiScrubBrand, set: setAiScrubBrand, label: "Scrub client brand name → industry category" },
                            { checked: aiScrubBudget, set: setAiScrubBudget, label: "Scrub budget figures → tier description" },
                            { checked: aiScrubStrategy, set: setAiScrubStrategy, label: "Scrub campaign-specific strategy → generic workstreams" },
                            { checked: aiScrubTimeline, set: setAiScrubTimeline, label: "Scrub timeline dates → relative phases" },
                          ] as const
                        ).map((row) => (
                          <label
                            key={row.label}
                            className="flex items-start gap-2 cursor-pointer font-mono text-[11px] text-foreground-muted leading-snug"
                          >
                            <Checkbox
                              checked={row.checked}
                              onCheckedChange={(v) => row.set(v === true)}
                              className="mt-0.5 border-border"
                            />
                            <span>{row.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <span className="font-mono text-[10px] text-foreground-muted uppercase block">
                        Output format
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setAiOutputFormat("section")}
                          className={cn(
                            "font-mono text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors",
                            aiOutputFormat === "section"
                              ? "border-accent bg-accent/10 text-foreground"
                              : "border-border text-foreground-muted hover:border-white/30"
                          )}
                        >
                          Section-based RFP
                        </button>
                        <button
                          type="button"
                          onClick={() => setAiOutputFormat("modular")}
                          className={cn(
                            "font-mono text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors",
                            aiOutputFormat === "modular"
                              ? "border-accent bg-accent/10 text-foreground"
                              : "border-border text-foreground-muted hover:border-white/30"
                          )}
                        >
                          Modular workstreams
                        </button>
                      </div>
                    </div>
                    <Button
                      type="button"
                      onClick={() => void generateAiOutputTemplate()}
                      disabled={isGeneratingAiTemplate}
                      className="bg-accent text-accent-foreground hover:bg-accent/90 w-full sm:w-auto"
                    >
                      {isGeneratingAiTemplate ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Generating…
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4" />
                          Generate template
                        </span>
                      )}
                    </Button>
                    {aiTemplateError && (
                      <div
                        role="alert"
                        className="rounded-lg border border-red-400/40 bg-red-950/40 px-3 py-2 text-xs text-red-200"
                      >
                        {aiTemplateError}
                      </div>
                    )}
                    {selectedRfpTemplate === "ai" && templateSourceText.trim() && (
                      <p className="font-mono text-[10px] text-foreground-muted">
                        AI format loaded — {templateSourceText.length.toLocaleString()} characters (used as Master RFP structure guide)
                      </p>
                    )}
                  </div>
                  )}
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
                    <span className="animate-spin">◌</span> Analyzing Brief...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="ai-badge">✦</span> Generate Master RFP
                  </span>
                )}
              </Button>
              {generateMasterBriefError && (
                <div className="w-full max-w-lg ml-auto p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-200 text-right">
                  {generateMasterBriefError}
                </div>
              )}
            </div>
            {!selectedProject && (
              <p className="mt-3 font-mono text-xs text-warning text-right">
                Select a project in Current Project View before generating the master brief.
              </p>
            )}
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
                              ? "border-blue-500 bg-blue-500/20 text-blue-300"
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
                        <span className="font-mono text-xs text-foreground">{recipient.name || recipient.email}</span>
                        <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">New</span>
                        {recipient.requireNda && (
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
                        value={activeItemId === item.id ? newName : ""}
                        onChange={(e) => {
                          setActiveItemId(item.id)
                          setNewName(e.target.value)
                        }}
                        onFocus={() => setActiveItemId(item.id)}
                        className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                      />
                      <Input
                        placeholder="Email address"
                        value={activeItemId === item.id ? newEmail : ""}
                        onChange={(e) => {
                          setActiveItemId(item.id)
                          setNewEmail(e.target.value)
                        }}
                        onFocus={() => setActiveItemId(item.id)}
                        className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                      />
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={activeItemId === item.id ? requireNdaForNew : true}
                          onChange={(e) => {
                            setActiveItemId(item.id)
                            setRequireNdaForNew(e.target.checked)
                          }}
                          className="rounded border-border"
                        />
                        <span className="font-mono text-[10px] text-foreground-muted">
                          Require NDA signature before viewing RFP
                        </span>
                      </label>
                      <Button 
                        size="sm"
                        onClick={() => addNewRecipient(item.id)}
                        disabled={!newEmail || activeItemId !== item.id}
                        className="w-full bg-accent/10 text-accent hover:bg-accent/20"
                      >
                        <Plus className="w-4 h-4 mr-1" /> Add New Contact
                      </Button>
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

              <div className="mt-6 p-4 rounded-lg border border-border bg-white/5 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={ndaSignatureRequired}
                    onCheckedChange={(v) => setNdaSignatureRequired(v === true)}
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

export default function AgencyRFPPage() {
  return (
    <AgencyLayout>
      <AgencyRFPContent />
    </AgencyLayout>
  )
}
