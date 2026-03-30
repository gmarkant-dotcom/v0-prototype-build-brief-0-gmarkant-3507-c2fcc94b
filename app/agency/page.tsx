"use client"

import { useState, useEffect, useRef } from "react"
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
import { Upload, FileText, Link2, Type, Plus, Trash2, Building2, Users, ChevronRight, Check, Send, Shield, FileCheck, Loader2 } from "lucide-react"
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
  name: string
  type: "agency" | "freelancer" | "production"
  discipline: string
  bookmarked: boolean
  ndaSigned: boolean
  ndaSignedDate?: string
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

// Demo partners - only shown in demo mode
const demoPartners: Partner[] = [
  { id: "1", name: "Fieldhouse Films", type: "production", discipline: "Video Production", bookmarked: true, ndaSigned: true, ndaSignedDate: "2023-06-15", msaApproved: true, msaApprovedDate: "2023-07-01", rating: 4.8, pastProjects: ["Q4 Brand Campaign", "Summer Series"] },
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

export default function AgencyRFPPage() {
  const { checkFeatureAccess } = usePaidUser()
  const { selectedProject } = useSelectedProject()
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Use demo partners only in demo mode - production shows empty (partners come from DB)
  const isDemo = isDemoMode()
  const existingPartners = isDemo ? demoPartners : []
  
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
  
  // Handle file upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!checkFeatureAccess("file uploads")) return
      setBriefUploaded(true)
      setBriefFileName(file.name)
      setBriefSourceText(`Uploaded file: ${file.name}`)
    }
  }
  
  const handleUploadClick = () => {
    // Directly click the file input - feature access is checked on file selection
    fileInputRef.current?.click()
  }

  // Generate Master RFP (AI-backed)
  const generateMasterRfp = async () => {
    setIsGenerating(true)
    try {
      const templateHint =
        uploadedRfpTemplate?.name ||
        (selectedRfpTemplate && isDemoMode()
          ? demoTemplates.find((t) => t.id === selectedRfpTemplate)?.name
          : "") ||
        "Default RFP template"

      const sourceText =
        pastedContent.trim() ||
        googleLink.trim() ||
        briefSourceText ||
        briefFileName

      const response = await fetch("/api/ai/master-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: selectedProject?.name || "New Project",
          clientName: selectedProject?.client || "Client TBD",
          briefText: sourceText,
          templateHint,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to generate master brief")
      }

      const payload = await response.json()
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
    } finally {
      setIsGenerating(false)
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
  
  // Broadcast RFPs
  const broadcastRfps = () => {
    setIsBroadcasting(true)
    setTimeout(() => {
      setIsBroadcasting(false)
      setBroadcastComplete(true)
    }, 2500)
  }
  
  // Reset flow
  const resetFlow = () => {
    setCurrentStep(1)
    setBroadcastComplete(false)
    setBriefUploaded(false)
    setBriefFileName("")
    setUploadMethod(null)
    setPastedContent("")
    setGoogleLink("")
    setMasterRfp(null)
    setScopeItems([])
    setSelectedPartners({})
    setNewRecipients({})
    setAdditionalContext("")
  }
  
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
    <AgencyLayout>
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
                label="Step 1"
                title="Upload Client Brief"
                description="Upload your client brief document or paste content. The AI will extract key information to generate a comprehensive Master RFP."
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
              
              {briefUploaded && (
                <div className="mt-6 p-4 rounded-lg bg-success/10 border border-success/30 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                      <FileCheck className="w-5 h-5 text-success" />
                    </div>
                    <div>
                      <div className="font-display font-bold text-sm text-foreground">{briefFileName}</div>
                      <div className="font-mono text-[10px] text-success">Brief uploaded successfully</div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setBriefUploaded(false)
                      setBriefFileName("")
                      setBriefSourceText("")
                    }}
                    className="border-border text-foreground-muted hover:bg-white/5"
                  >
                    Replace
                  </Button>
                </div>
              )}
            </GlassCard>
            
            {/* Template Selection */}
            <GlassCard>
              <GlassCardHeader
                label="Optional"
                title="Select Output Templates"
                description="Choose your preferred RFP and SOW templates. Generated documents will match these formats."
              />
              
              <div className="grid grid-cols-2 gap-6 mt-4">
                <div>
                  <label className="font-mono text-[10px] text-foreground-muted uppercase block mb-2">
                    RFP Template
                  </label>
                  <div className="space-y-2">
                    {(isDemoMode() ? demoTemplates : []).filter(t => t.type === "rfp").map((template) => (
                      <button
                        key={template.id}
                        onClick={() => setSelectedRfpTemplate(template.id === selectedRfpTemplate ? null : template.id)}
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
                      <button
                        onClick={() => {
                          setSelectedRfpTemplate('uploaded')
                          setSelectedSowTemplate(null)
                        }}
                        className={cn(
                          "w-full text-left p-3 rounded-lg border transition-colors flex items-center gap-3",
                          selectedRfpTemplate === 'uploaded'
                            ? "border-accent bg-accent/10"
                            : "border-border hover:border-white/30"
                        )}
                      >
                        <FileText className="w-5 h-5 text-green-400" />
                        <div className="flex-1">
                          <div className="font-display font-bold text-sm text-foreground">{uploadedRfpTemplate.name}</div>
                          <div className="font-mono text-[10px] text-foreground-muted">Uploaded Template</div>
                        </div>
                        {selectedRfpTemplate === 'uploaded' && <Check className="w-4 h-4 text-accent" />}
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
                          if (!checkFeatureAccess("template uploads")) return
                          setIsUploadingRfpTemplate(true)
                          try {
                            const formData = new FormData()
                            formData.append('file', file)
                            formData.append('folder', 'templates')
                            const response = await fetch('/api/upload', { method: 'POST', body: formData })
                            if (response.ok) {
                              const result = await response.json()
                              setUploadedRfpTemplate({ name: file.name, url: result.url })
                              setSelectedRfpTemplate('uploaded')
                            }
                          } catch (error) {
                            console.error('Upload error:', error)
                          }
                          setIsUploadingRfpTemplate(false)
                        }}
                      />
                      {isUploadingRfpTemplate ? (
                        <>
                          <Loader2 className="w-5 h-5 text-accent animate-spin" />
                          <span className="font-mono text-xs text-accent">Uploading...</span>
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
                          if (!checkFeatureAccess("template uploads")) return
                          setIsUploadingSowTemplate(true)
                          try {
                            const formData = new FormData()
                            formData.append('file', file)
                            formData.append('folder', 'templates')
                            const response = await fetch('/api/upload', { method: 'POST', body: formData })
                            if (response.ok) {
                              const result = await response.json()
                              setUploadedSowTemplate({ name: file.name, url: result.url })
                              setSelectedSowTemplate('uploaded')
                            }
                          } catch (error) {
                            console.error('Upload error:', error)
                          }
                          setIsUploadingSowTemplate(false)
                        }}
                      />
                      {isUploadingSowTemplate ? (
                        <>
                          <Loader2 className="w-5 h-5 text-accent animate-spin" />
                          <span className="font-mono text-xs text-accent">Uploading...</span>
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
            <div className="flex justify-end">
              <Button
                disabled={!briefUploaded || isGenerating || !selectedProject}
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
                placeholder="E.g., 'We have a strong existing relationship with Fieldhouse Films. Budget is flexible for exceptional talent. Timeline is firm - no extensions possible...'"
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
                description="For each outsourced deliverable, choose partners from your pool or invite new contacts. Partners without a signed NDA will receive an NDA request with the RFP."
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
                              <Shield className="w-2.5 h-2.5" /> NDA
                            </span>
                          ) : (
                            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-warning/20 text-warning">NDA Required</span>
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
                                  <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-success/20 text-success">NDA ✓</span>
                                ) : (
                                  <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-warning/20 text-warning">No NDA</span>
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
                    {getTotalNewWithNda() + getTotalExistingWithoutNda()}
                  </div>
                  <div className="font-mono text-[10px] text-foreground-muted">NDAs Required</div>
                </div>
              </div>
            </GlassCard>
            
            {(getTotalNewWithNda() + getTotalExistingWithoutNda()) > 0 && (
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
            
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setCurrentStep(5)} className="border-border text-foreground hover:bg-white/5">
                Back
              </Button>
              <Button 
                onClick={broadcastRfps}
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
    </AgencyLayout>
  )
}
