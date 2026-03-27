"use client"

import { useState, useRef } from "react"
import { StageHeader } from "@/components/stage-header"
import { EngagementContext } from "@/components/engagement-context"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { FileUpload } from "@/components/file-upload"
import { usePaidUser } from "@/contexts/paid-user-context"
import { isDemoMode } from "@/lib/demo-data"
import { EmptyState } from "@/components/empty-state"
import { Stage03OnboardingProduction } from "@/components/stage-03-onboarding-production"
import { 
  FileText, 
  Shield, 
  FileCheck, 
  Calendar, 
  Link2, 
  CheckCircle, 
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  Send,
  Clock,
  Building2,
  Briefcase,
  ExternalLink,
  Download,
  Eye,
  Upload,
  Loader2
} from "lucide-react"

// Agency master documents
interface MasterDocument {
  id: string
  name: string
  type: "agency" | "project"
  category: "legal" | "brand" | "process" | "scheduling" | "requirements"
  description: string
  lastUpdated: string
  required: boolean
  version?: string
  url?: string
}

const masterDocuments: MasterDocument[] = [
  // Agency-level documents
  {
    id: "nda",
    name: "Non-Disclosure Agreement",
    type: "agency",
    category: "legal",
    description: "Standard NDA protecting confidential client and project information",
    lastUpdated: "Jan 15, 2024",
    required: true,
    version: "v3.2"
  },
  {
    id: "msa",
    name: "Master Service Agreement",
    type: "agency",
    category: "legal",
    description: "Terms of engagement, liability, IP ownership, and payment terms",
    lastUpdated: "Feb 1, 2024",
    required: true,
    version: "v2.1"
  },
  {
    id: "insurance",
    name: "Insurance Requirements",
    type: "agency",
    category: "legal",
    description: "Required COI with $2M general liability, $1M professional liability",
    lastUpdated: "Jan 1, 2024",
    required: true,
    version: "v1.0"
  },
  {
    id: "comms-protocol",
    name: "Communications Protocol",
    type: "agency",
    category: "process",
    description: "Standard comms channels, response times, escalation paths",
    lastUpdated: "Dec 15, 2023",
    required: false,
    version: "v2.0"
  },
  {
    id: "master-requirements",
    name: "Master Client Mandatory Requirements",
    type: "agency",
    category: "requirements",
    description: "Critical ways of working, compliance standards, and mandatory requirements all partners must follow",
    lastUpdated: "Feb 15, 2024",
    required: true,
    version: "v1.0"
  },
  // Project-level documents
  {
    id: "brand-guidelines",
    name: "NWSL Brand Guidelines",
    type: "project",
    category: "brand",
    description: "Official NWSL brand assets, colors, typography, and usage rules",
    lastUpdated: "Mar 1, 2024",
    required: true,
    version: "2024"
  },
  {
    id: "content-style",
    name: "Content Style Guide",
    type: "project",
    category: "brand",
    description: "Voice, tone, and content standards for all creator content",
    lastUpdated: "Mar 5, 2024",
    required: true,
    version: "v1.0"
  },
  {
    id: "master-timeline",
    name: "Master Production Timeline",
    type: "project",
    category: "process",
    description: "Key milestones, delivery dates, and dependencies across all workstreams",
    lastUpdated: "Mar 10, 2024",
    required: true,
    version: "v1.2"
  },
  {
    id: "asset-library",
    name: "Asset Library Access",
    type: "project",
    category: "brand",
    description: "Shared Drive folder with logos, templates, and reference materials",
    lastUpdated: "Mar 8, 2024",
    required: false
  },
  {
    id: "kickoff-scheduling",
    name: "Kickoff Call Scheduling",
    type: "project",
    category: "scheduling",
    description: "Calendly link to schedule initial project kickoff call",
    lastUpdated: "Mar 10, 2024",
    required: true
  },
  {
    id: "weekly-sync",
    name: "Weekly Sync Scheduling",
    type: "project",
    category: "scheduling",
    description: "Recurring weekly sync invitation (Mondays 10am PT)",
    lastUpdated: "Mar 10, 2024",
    required: false
  }
]

// Partner data with existing document status
interface Partner {
  id: string
  name: string
  discipline: string
  // Existing document status from partner pool
  ndaSigned: boolean
  ndaSignedDate?: string
  ndaVersion?: string
  msaApproved: boolean
  msaApprovedDate?: string
  msaVersion?: string
  insuranceUploaded: boolean
  insuranceExpiry?: string
  // Onboarding progress
  onboardingStatus: "not_started" | "documents_sent" | "in_progress" | "complete"
  documentsReceived: string[]
  documentsAcknowledged: string[]
}

const partners: Partner[] = [
  {
    id: "1",
    name: "Fieldhouse Films",
    discipline: "Video Production",
    ndaSigned: true,
    ndaSignedDate: "Jun 15, 2023",
    ndaVersion: "v3.0",
    msaApproved: true,
    msaApprovedDate: "Jul 1, 2023",
    msaVersion: "v2.0",
    insuranceUploaded: true,
    insuranceExpiry: "Dec 31, 2024",
    onboardingStatus: "in_progress",
    documentsReceived: ["brand-guidelines", "content-style", "master-timeline"],
    documentsAcknowledged: ["brand-guidelines"]
  },
  {
    id: "2",
    name: "Tandem Social",
    discipline: "Social Media",
    ndaSigned: true,
    ndaSignedDate: "Aug 20, 2023",
    ndaVersion: "v3.2",
    msaApproved: true,
    msaApprovedDate: "Sep 1, 2023",
    msaVersion: "v2.1",
    insuranceUploaded: true,
    insuranceExpiry: "Nov 30, 2024",
    onboardingStatus: "complete",
    documentsReceived: ["brand-guidelines", "content-style", "master-timeline", "asset-library", "kickoff-scheduling"],
    documentsAcknowledged: ["brand-guidelines", "content-style", "master-timeline", "asset-library", "kickoff-scheduling"]
  },
  {
    id: "3",
    name: "Roster Agency",
    discipline: "Talent Relations",
    ndaSigned: false,
    msaApproved: false,
    insuranceUploaded: false,
    onboardingStatus: "not_started",
    documentsReceived: [],
    documentsAcknowledged: []
  }
]

type OnboardingStep = "select_documents" | "review_partner_status" | "customize_packet" | "send"

export function Stage03Onboarding() {
  const { checkFeatureAccess } = usePaidUser()
  const isDemo = isDemoMode()
  const [selectedPartner, setSelectedPartner] = useState<string>("1")
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("select_documents")
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([])
  const [customMessage, setCustomMessage] = useState("")
  const [schedulingLink, setSchedulingLink] = useState("https://calendly.com/electric-animal/nwsl-kickoff")
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null)
  
  const handleUploadComplete = (file: { url: string; filename: string }) => {
    if (!checkFeatureAccess()) return
    console.log("Document uploaded:", file.filename)
    setShowUploadModal(false)
    setUploadingDocType(null)
  }
  
  const currentPartner = partners.find(p => p.id === selectedPartner)
  
  const toggleDocument = (docId: string) => {
    setSelectedDocuments(prev => 
      prev.includes(docId) ? prev.filter(d => d !== docId) : [...prev, docId]
    )
  }
  
  const agencyDocs = masterDocuments.filter(d => d.type === "agency")
  const projectDocs = masterDocuments.filter(d => d.type === "project")
  
  // Check if partner already has a document completed
  const getPartnerDocStatus = (docId: string): "signed" | "outdated" | "not_signed" => {
    if (!currentPartner) return "not_signed"
    
    if (docId === "nda") {
      if (!currentPartner.ndaSigned) return "not_signed"
      const doc = masterDocuments.find(d => d.id === "nda")
      if (doc?.version && currentPartner.ndaVersion && currentPartner.ndaVersion !== doc.version) {
        return "outdated"
      }
      return "signed"
    }
    if (docId === "msa") {
      if (!currentPartner.msaApproved) return "not_signed"
      const doc = masterDocuments.find(d => d.id === "msa")
      if (doc?.version && currentPartner.msaVersion && currentPartner.msaVersion !== doc.version) {
        return "outdated"
      }
      return "signed"
    }
    if (docId === "insurance") {
      return currentPartner.insuranceUploaded ? "signed" : "not_signed"
    }
    
    return "not_signed"
  }
  
  const steps = [
    { id: "select_documents", label: "Select Documents", number: 1 },
    { id: "review_partner_status", label: "Review Partner Status", number: 2 },
    { id: "customize_packet", label: "Customize Packet", number: 3 },
    { id: "send", label: "Send to Partner", number: 4 }
  ]
  
  const currentStepIndex = steps.findIndex(s => s.id === currentStep)
  
  const requiredAgencyDocs = agencyDocs.filter(d => d.required)
  const requiredProjectDocs = projectDocs.filter(d => d.required)
  
  // Auto-select required documents
  const handleAutoSelectRequired = () => {
    const requiredIds = [...requiredAgencyDocs, ...requiredProjectDocs].map(d => d.id)
    setSelectedDocuments(requiredIds)
  }
  
  // Documents that need to be sent (not already signed or outdated)
  const documentsToSend = selectedDocuments.filter(docId => {
    const status = getPartnerDocStatus(docId)
    return status !== "signed"
  })
  
  const documentsAlreadySigned = selectedDocuments.filter(docId => {
    const status = getPartnerDocStatus(docId)
    return status === "signed"
  })
  
  const documentsOutdated = selectedDocuments.filter(docId => {
    const status = getPartnerDocStatus(docId)
    return status === "outdated"
  })
  
  if (!isDemo) {
    return <Stage03OnboardingProduction />
  }
  
  return (
    <div className="p-8 max-w-6xl">
      <StageHeader
        stageNumber="03"
        title="Onboarding + Ways of Working"
        subtitle="Select documents to send to awarded partners. The system will check their existing profile to avoid duplicate requests."
        aiPowered={false}
      />
      
      <EngagementContext
        agency="Electric Animal"
        project="NWSL Creator Content Series"
        budget="$250K"
        className="mb-8"
      />
      
      {/* Partner Tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {partners.map((partner) => (
          <button
            key={partner.id}
            onClick={() => {
              setSelectedPartner(partner.id)
              setCurrentStep("select_documents")
              setSelectedDocuments([])
            }}
            className={cn(
              "px-4 py-2 rounded-lg font-mono text-xs transition-all border",
              selectedPartner === partner.id
                ? "bg-accent/10 text-accent border-accent/30"
                : "bg-white/5 text-foreground-muted border-border hover:border-white/30"
            )}
          >
            {partner.name}
            <span className={cn(
              "ml-2 px-1.5 py-0.5 rounded text-[9px] uppercase border",
              partner.onboardingStatus === "complete" && "bg-green-500/10 text-green-400 border-green-500/30",
              partner.onboardingStatus === "in_progress" && "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
              partner.onboardingStatus === "documents_sent" && "bg-blue-500/10 text-blue-400 border-blue-500/30",
              partner.onboardingStatus === "not_started" && "bg-white/10 text-foreground-muted border-border"
            )}>
              {partner.onboardingStatus.replace("_", " ")}
            </span>
          </button>
        ))}
      </div>
      
      {currentPartner && (
        <>
          {/* Step Progress */}
          <div className="flex items-center gap-2 mb-8">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center gap-2">
                <button
                  onClick={() => index <= currentStepIndex && setCurrentStep(step.id as OnboardingStep)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-xs transition-all",
                    currentStep === step.id
                      ? "bg-accent/20 text-accent border border-accent/30"
                      : index < currentStepIndex
                      ? "bg-green-500/10 text-green-400 border border-green-500/30 cursor-pointer hover:bg-green-500/20"
                      : "bg-white/5 text-foreground-muted border border-border"
                  )}
                >
                  <span className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                    currentStep === step.id ? "bg-accent text-accent-foreground" :
                    index < currentStepIndex ? "bg-green-500 text-white" :
                    "bg-white/10"
                  )}>
                    {index < currentStepIndex ? <CheckCircle className="w-3 h-3" /> : step.number}
                  </span>
                  {step.label}
                </button>
                {index < steps.length - 1 && (
                  <ChevronRight className="w-4 h-4 text-foreground-muted" />
                )}
              </div>
            ))}
          </div>
          
          {/* Step 1: Select Documents */}
          {currentStep === "select_documents" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display font-bold text-xl text-foreground mb-1">
                    Select Documents for {currentPartner.name}
                  </h3>
                  <p className="text-sm text-foreground-muted">
                    Choose which agency and project documents to include in the onboarding packet
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={handleAutoSelectRequired}
                  className="border-accent/30 text-accent hover:bg-accent/10"
                >
                  Select All Required
                </Button>
              </div>
              
              {/* Agency Documents */}
              <GlassCard>
                <div className="flex items-center gap-3 mb-4">
                  <Building2 className="w-5 h-5 text-accent" />
                  <div>
                    <h4 className="font-display font-bold text-foreground">Agency Documents</h4>
                    <p className="text-xs text-foreground-muted">Standard legal and operational documents</p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  {agencyDocs.map((doc) => {
                    const partnerStatus = getPartnerDocStatus(doc.id)
                    const isSelected = selectedDocuments.includes(doc.id)
                    
                    return (
                      <div
                        key={doc.id}
                        onClick={() => toggleDocument(doc.id)}
                        className={cn(
                          "flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-all",
                          isSelected 
                            ? "bg-accent/5 border-accent/30" 
                            : "bg-white/5 border-border hover:border-white/30"
                        )}
                      >
                        <Checkbox 
                          checked={isSelected}
                          className="mt-1 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-foreground">{doc.name}</span>
                            {doc.version && (
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-foreground-muted">
                                {doc.version}
                              </span>
                            )}
                            {doc.required && (
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/30">
                                Required
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-foreground-muted mb-2">{doc.description}</p>
                          <div className="font-mono text-[10px] text-foreground-muted">
                            Last updated: {doc.lastUpdated}
                          </div>
                        </div>
                        
                        {/* Partner status badge */}
                        <div className="shrink-0">
                          {partnerStatus === "signed" && (
                            <span className="flex items-center gap-1 font-mono text-[10px] px-2 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/30">
                              <CheckCircle className="w-3 h-3" /> Already Signed
                            </span>
                          )}
                          {partnerStatus === "outdated" && (
                            <span className="flex items-center gap-1 font-mono text-[10px] px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/30">
                              <AlertCircle className="w-3 h-3" /> Outdated Version
                            </span>
                          )}
                          {partnerStatus === "not_signed" && (
                            <span className="flex items-center gap-1 font-mono text-[10px] px-2 py-1 rounded-full bg-white/10 text-foreground-muted border border-border">
                              <Clock className="w-3 h-3" /> Not Signed
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </GlassCard>
              
              {/* Project Documents */}
              <GlassCard>
                <div className="flex items-center gap-3 mb-4">
                  <Briefcase className="w-5 h-5 text-accent" />
                  <div>
                    <h4 className="font-display font-bold text-foreground">Project Documents</h4>
                    <p className="text-xs text-foreground-muted">NWSL Creator Content Series specific materials</p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  {projectDocs.map((doc) => {
                    const isSelected = selectedDocuments.includes(doc.id)
                    const IconComponent = doc.category === "scheduling" ? Calendar : 
                                          doc.category === "brand" ? FileText : 
                                          doc.category === "process" ? Clock :
                                          doc.category === "requirements" ? AlertTriangle : FileText
                    
                    return (
                      <div
                        key={doc.id}
                        onClick={() => toggleDocument(doc.id)}
                        className={cn(
                          "flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-all",
                          isSelected 
                            ? "bg-accent/5 border-accent/30" 
                            : "bg-white/5 border-border hover:border-white/30"
                        )}
                      >
                        <Checkbox 
                          checked={isSelected}
                          className="mt-1 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <IconComponent className="w-4 h-4 text-foreground-muted" />
                            <span className="font-medium text-foreground">{doc.name}</span>
                            {doc.version && (
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-foreground-muted">
                                {doc.version}
                              </span>
                            )}
                            {doc.required && (
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/30">
                                Required
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-foreground-muted mb-2">{doc.description}</p>
                          <div className="font-mono text-[10px] text-foreground-muted">
                            Last updated: {doc.lastUpdated}
                          </div>
                        </div>
                        
                        {/* Category badge */}
                        <span className={cn(
                          "shrink-0 font-mono text-[10px] px-2 py-1 rounded-full capitalize border",
                          doc.category === "legal" && "bg-purple-500/10 text-purple-400 border-purple-500/30",
                          doc.category === "brand" && "bg-blue-500/10 text-blue-400 border-blue-500/30",
                          doc.category === "process" && "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
                          doc.category === "scheduling" && "bg-green-500/10 text-green-400 border-green-500/30"
                        )}>
                          {doc.category}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </GlassCard>
              
              {/* Selection Summary */}
              <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-border">
                <div className="font-mono text-sm text-foreground-muted">
                  {selectedDocuments.length} document{selectedDocuments.length !== 1 ? "s" : ""} selected
                </div>
                <Button
                  onClick={() => setCurrentStep("review_partner_status")}
                  disabled={selectedDocuments.length === 0}
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  Continue to Partner Review
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}
          
          {/* Step 2: Review Partner Status */}
          {currentStep === "review_partner_status" && (
            <div className="space-y-6">
              <div>
                <h3 className="font-display font-bold text-xl text-foreground mb-1">
                  Review {currentPartner.name}&apos;s Existing Status
                </h3>
                <p className="text-sm text-foreground-muted">
                  Based on their profile, here&apos;s what they&apos;ve already completed vs what needs to be sent
                </p>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Already Completed */}
                <GlassCard>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-green-400" />
                    </div>
                    <div>
                      <h4 className="font-display font-bold text-foreground">Already Completed</h4>
                      <p className="text-xs text-foreground-muted">
                        {documentsAlreadySigned.length} document{documentsAlreadySigned.length !== 1 ? "s" : ""} already on file
                      </p>
                    </div>
                  </div>
                  
                  {documentsAlreadySigned.length > 0 ? (
                    <div className="space-y-2">
                      {documentsAlreadySigned.map(docId => {
                        const doc = masterDocuments.find(d => d.id === docId)
                        if (!doc) return null
                        
                        let signedDate = ""
                        if (docId === "nda") signedDate = currentPartner.ndaSignedDate || ""
                        if (docId === "msa") signedDate = currentPartner.msaApprovedDate || ""
                        if (docId === "insurance") signedDate = `Expires ${currentPartner.insuranceExpiry}`
                        
                        return (
                          <div key={docId} className="flex items-center justify-between p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                            <div className="flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-green-400" />
                              <span className="text-sm text-foreground">{doc.name}</span>
                            </div>
                            <span className="font-mono text-[10px] text-green-400">{signedDate}</span>
                          </div>
                        )
                      })}
                      
                      <div className="mt-4 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                        <p className="text-sm text-green-400">
                          These documents will be skipped since they&apos;re already on file.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-foreground-muted">
                      <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No selected documents are already on file</p>
                    </div>
                  )}
                </GlassCard>
                
                {/* Needs Attention */}
                <GlassCard>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                      <AlertCircle className="w-5 h-5 text-yellow-400" />
                    </div>
                    <div>
                      <h4 className="font-display font-bold text-foreground">Will Be Sent</h4>
                      <p className="text-xs text-foreground-muted">
                        {documentsToSend.length} document{documentsToSend.length !== 1 ? "s" : ""} to send
                      </p>
                    </div>
                  </div>
                  
                  {documentsToSend.length > 0 ? (
                    <div className="space-y-2">
                      {documentsOutdated.length > 0 && (
                        <>
                          <div className="font-mono text-[10px] text-yellow-400 uppercase tracking-wider mb-2">
                            Outdated Versions (Re-signature Required)
                          </div>
                          {documentsOutdated.map(docId => {
                            const doc = masterDocuments.find(d => d.id === docId)
                            if (!doc) return null
                            
                            let oldVersion = ""
                            if (docId === "nda") oldVersion = currentPartner.ndaVersion || ""
                            if (docId === "msa") oldVersion = currentPartner.msaVersion || ""
                            
                            return (
                              <div key={docId} className="flex items-center justify-between p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
                                <div className="flex items-center gap-2">
                                  <AlertCircle className="w-4 h-4 text-yellow-400" />
                                  <span className="text-sm text-foreground">{doc.name}</span>
                                </div>
                                <span className="font-mono text-[10px] text-yellow-400">
                                  {oldVersion} → {doc.version}
                                </span>
                              </div>
                            )
                          })}
                        </>
                      )}
                      
                      {documentsToSend.filter(d => !documentsOutdated.includes(d)).length > 0 && (
                        <>
                          <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2 mt-4">
                            New Documents
                          </div>
                          {documentsToSend.filter(d => !documentsOutdated.includes(d)).map(docId => {
                            const doc = masterDocuments.find(d => d.id === docId)
                            if (!doc) return null
                            
                            return (
                              <div key={docId} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-border">
                                <div className="flex items-center gap-2">
                                  <Clock className="w-4 h-4 text-foreground-muted" />
                                  <span className="text-sm text-foreground">{doc.name}</span>
                                </div>
                                <span className={cn(
                                  "font-mono text-[10px] px-2 py-0.5 rounded capitalize",
                                  doc.category === "legal" && "bg-purple-500/10 text-purple-400",
                                  doc.category === "brand" && "bg-blue-500/10 text-blue-400",
                                  doc.category === "process" && "bg-cyan-500/10 text-cyan-400",
                                  doc.category === "scheduling" && "bg-green-500/10 text-green-400"
                                )}>
                                  {doc.category}
                                </span>
                              </div>
                            )
                          })}
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-foreground-muted">
                      <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-400 opacity-50" />
                      <p className="text-sm">All selected documents are already on file!</p>
                    </div>
                  )}
                </GlassCard>
              </div>
              
              {/* Partner Profile Summary */}
              <GlassCard>
                <GlassCardHeader
                  label="Partner Profile"
                  title={currentPartner.name}
                  badge={currentPartner.discipline}
                />
                
                <div className="grid grid-cols-3 gap-4">
                  <div className={cn(
                    "p-4 rounded-lg border",
                    currentPartner.ndaSigned ? "bg-green-500/5 border-green-500/30" : "bg-yellow-500/5 border-yellow-500/30"
                  )}>
                    <div className="flex items-center gap-2 mb-2">
                      <Shield className={cn("w-5 h-5", currentPartner.ndaSigned ? "text-green-400" : "text-yellow-400")} />
                      <span className="font-mono text-sm font-medium text-foreground">NDA</span>
                    </div>
                    {currentPartner.ndaSigned ? (
                      <>
                        <div className="text-sm text-green-400">Signed</div>
                        <div className="font-mono text-[10px] text-foreground-muted">
                          {currentPartner.ndaSignedDate} ({currentPartner.ndaVersion})
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-yellow-400">Not signed</div>
                    )}
                  </div>
                  
                  <div className={cn(
                    "p-4 rounded-lg border",
                    currentPartner.msaApproved ? "bg-green-500/5 border-green-500/30" : "bg-yellow-500/5 border-yellow-500/30"
                  )}>
                    <div className="flex items-center gap-2 mb-2">
                      <FileCheck className={cn("w-5 h-5", currentPartner.msaApproved ? "text-green-400" : "text-yellow-400")} />
                      <span className="font-mono text-sm font-medium text-foreground">MSA</span>
                    </div>
                    {currentPartner.msaApproved ? (
                      <>
                        <div className="text-sm text-green-400">Approved</div>
                        <div className="font-mono text-[10px] text-foreground-muted">
                          {currentPartner.msaApprovedDate} ({currentPartner.msaVersion})
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-yellow-400">Not approved</div>
                    )}
                  </div>
                  
                  <div className={cn(
                    "p-4 rounded-lg border",
                    currentPartner.insuranceUploaded ? "bg-green-500/5 border-green-500/30" : "bg-yellow-500/5 border-yellow-500/30"
                  )}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <FileText className={cn("w-5 h-5", currentPartner.insuranceUploaded ? "text-green-400" : "text-yellow-400")} />
                        <span className="font-mono text-sm font-medium text-foreground">Insurance</span>
                      </div>
                      {!currentPartner.insuranceUploaded && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setUploadingDocType("insurance")
                            setShowUploadModal(true)
                          }}
                          className="bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 font-mono text-xs"
                        >
                          <Upload className="w-3 h-3 mr-1" /> Request Upload
                        </Button>
                      )}
                    </div>
                    {currentPartner.insuranceUploaded ? (
                      <>
                        <div className="text-sm text-green-400">On file</div>
                        <div className="font-mono text-[10px] text-foreground-muted">
                          Expires {currentPartner.insuranceExpiry}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-yellow-400">Not uploaded</div>
                    )}
                  </div>
                </div>
              </GlassCard>
              
              {/* Navigation */}
              <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-border">
                <Button
                  variant="ghost"
                  onClick={() => setCurrentStep("select_documents")}
                  className="text-foreground-muted"
                >
                  Back to Document Selection
                </Button>
                <Button
                  onClick={() => setCurrentStep("customize_packet")}
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  Continue to Customize
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}
          
          {/* Step 3: Customize Packet */}
          {currentStep === "customize_packet" && (
            <div className="space-y-6">
              <div>
                <h3 className="font-display font-bold text-xl text-foreground mb-1">
                  Customize Onboarding Packet
                </h3>
                <p className="text-sm text-foreground-muted">
                  Add a personal message and configure scheduling options
                </p>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <GlassCard>
                  <GlassCardHeader
                    label="Optional"
                    title="Personal Message"
                  />
                  
                  <textarea
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    placeholder={`Hi ${currentPartner.name.split(" ")[0]},\n\nWelcome to the NWSL Creator Content Series project! Please review and complete the attached onboarding materials at your earliest convenience.\n\nLooking forward to working together,\nElectric Animal Team`}
                    className="w-full h-48 px-4 py-3 bg-white/5 border border-border rounded-xl text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-accent/50 resize-none"
                  />
                </GlassCard>
                
                <GlassCard>
                  <GlassCardHeader
                    label="Scheduling"
                    title="Kickoff Call Link"
                  />
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                        Calendly / Scheduling Link
                      </label>
                      <div className="flex gap-2">
                        <div className="flex-1 relative">
                          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
                          <input
                            type="url"
                            value={schedulingLink}
                            onChange={(e) => setSchedulingLink(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 bg-white/5 border border-border rounded-xl text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-accent/50"
                          />
                        </div>
                        <Button variant="outline" className="border-border">
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    
                    <div className="p-4 bg-white/5 rounded-lg border border-border">
                      <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                        Preview
                      </div>
                      <p className="text-sm text-foreground-secondary">
                        Partner will receive a link to schedule their kickoff call at: <span className="text-accent break-all">{schedulingLink}</span>
                      </p>
                    </div>
                  </div>
                </GlassCard>
              </div>
              
              {/* Document Preview */}
              <GlassCard>
                <GlassCardHeader
                  label="Packet Preview"
                  title={`${documentsToSend.length} Documents to Send`}
                />
                
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {documentsToSend.map(docId => {
                    const doc = masterDocuments.find(d => d.id === docId)
                    if (!doc) return null
                    
                    return (
                      <div key={docId} className="p-3 rounded-lg bg-white/5 border border-border">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="w-4 h-4 text-accent" />
                          <span className="text-sm text-foreground font-medium truncate">{doc.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" className="text-foreground-muted h-7 px-2">
                            <Eye className="w-3 h-3 mr-1" /> Preview
                          </Button>
                          <Button variant="ghost" size="sm" className="text-foreground-muted h-7 px-2">
                            <Download className="w-3 h-3 mr-1" /> Download
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </GlassCard>
              
              {/* Navigation */}
              <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-border">
                <Button
                  variant="ghost"
                  onClick={() => setCurrentStep("review_partner_status")}
                  className="text-foreground-muted"
                >
                  Back to Partner Review
                </Button>
                <Button
                  onClick={() => setCurrentStep("send")}
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  Review & Send
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}
          
          {/* Step 4: Send */}
          {currentStep === "send" && (
            <div className="space-y-6">
              <div>
                <h3 className="font-display font-bold text-xl text-foreground mb-1">
                  Ready to Send
                </h3>
                <p className="text-sm text-foreground-muted">
                  Review the final onboarding packet before sending to {currentPartner.name}
                </p>
              </div>
              
              <GlassCard>
                <div className="space-y-6">
                  {/* Recipient */}
                  <div className="flex items-center gap-4 p-4 rounded-lg bg-accent/5 border border-accent/20">
                    <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center">
                      <span className="font-display font-bold text-accent">
                        {currentPartner.name.charAt(0)}
                      </span>
                    </div>
                    <div>
                      <div className="font-display font-bold text-foreground">{currentPartner.name}</div>
                      <div className="text-sm text-foreground-muted">{currentPartner.discipline}</div>
                    </div>
                  </div>
                  
                  {/* Summary */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 rounded-lg bg-white/5 border border-border text-center">
                      <div className="font-display font-bold text-2xl text-accent">{documentsToSend.length}</div>
                      <div className="font-mono text-[10px] text-foreground-muted uppercase">Documents</div>
                    </div>
                    <div className="p-4 rounded-lg bg-white/5 border border-border text-center">
                      <div className="font-display font-bold text-2xl text-green-400">{documentsAlreadySigned.length}</div>
                      <div className="font-mono text-[10px] text-foreground-muted uppercase">Skipped</div>
                    </div>
                    <div className="p-4 rounded-lg bg-white/5 border border-border text-center">
                      <div className="font-display font-bold text-2xl text-foreground">
                        {documentsToSend.filter(d => masterDocuments.find(m => m.id === d)?.required).length}
                      </div>
                      <div className="font-mono text-[10px] text-foreground-muted uppercase">Required</div>
                    </div>
                  </div>
                  
                  {/* Document List */}
                  <div>
                    <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-3">
                      Documents Being Sent
                    </div>
                    <div className="space-y-2">
                      {documentsToSend.map(docId => {
                        const doc = masterDocuments.find(d => d.id === docId)
                        if (!doc) return null
                        
                        return (
                          <div key={docId} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-border">
                            <div className="flex items-center gap-3">
                              <FileText className="w-4 h-4 text-accent" />
                              <span className="text-sm text-foreground">{doc.name}</span>
                              {doc.required && (
                                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">
                                  Required
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-[10px] text-foreground-muted capitalize">
                              {doc.type} / {doc.category}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  
                  {/* Message Preview */}
                  {customMessage && (
                    <div>
                      <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-3">
                        Personal Message
                      </div>
                      <div className="p-4 rounded-lg bg-white/5 border border-border">
                        <p className="text-sm text-foreground-secondary whitespace-pre-wrap">{customMessage}</p>
                      </div>
                    </div>
                  )}
                </div>
              </GlassCard>
              
              {/* Navigation */}
              <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-border">
                <Button
                  variant="ghost"
                  onClick={() => setCurrentStep("customize_packet")}
                  className="text-foreground-muted"
                >
                  Back to Customize
                </Button>
                <Button
                  className="bg-accent text-accent-foreground hover:bg-accent/90 px-8"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Send Onboarding Packet
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      
      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={() => setShowUploadModal(false)}>
          <GlassCard className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <GlassCardHeader
              title={`Upload ${uploadingDocType === "insurance" ? "Insurance Certificate" : "Document"}`}
              description="Upload the required document for this partner."
            />
            <div className="mt-4">
              <FileUpload
                folder="agency-onboarding"
                maxSize={25}
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                onUploadComplete={handleUploadComplete}
                onUploadError={(error) => console.error(error)}
                label="Drop file here or click to browse"
                description="PDF, DOC, or image files up to 25MB"
              />
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
              <Button
                variant="outline"
                onClick={() => setShowUploadModal(false)}
                className="border-border text-foreground hover:bg-white/5"
              >
                Cancel
              </Button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  )
}
