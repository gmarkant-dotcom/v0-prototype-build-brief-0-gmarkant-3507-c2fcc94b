"use client"

import { useState, useRef, useEffect } from "react"
import { PartnerLayout } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { cn, normalizeMeetingUrlForHref } from "@/lib/utils"
import { LeadAgencyFilter } from "@/components/lead-agency-filter"
import { isDemoMode } from "@/lib/demo-data"
import { 
  FileText, 
  Download, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  Shield,
  FileCheck,
  Palette,
  BookOpen,
  Calendar,
  FolderOpen,
  Mail,
  ExternalLink,
  Upload,
  Eye,
  Signature,
  Loader2
} from "lucide-react"

type DocumentStatus = "pending" | "viewed" | "signed" | "uploaded" | "acknowledged"

type OnboardingDocument = {
  id: string
  name: string
  type: "agency" | "project"
  category: string
  description: string
  required: boolean
  status: DocumentStatus
  action: "sign" | "acknowledge" | "upload" | "view"
  dueDate?: string
  signedAt?: string
  viewedAt?: string
  icon: React.ElementType
}

type OnboardingPacket = {
  id: string
  projectName: string
  agencyName: string
  sentAt: string
  message: string
  kickoffScheduleLink: string
  documents: OnboardingDocument[]
  status: "pending" | "in_progress" | "complete"
}

// Demo data - only shown when NEXT_PUBLIC_IS_DEMO=true
const demoOnboardingPackets: OnboardingPacket[] = [
  {
    id: "1",
    projectName: "NWSL Creator Content Series",
    agencyName: "Electric Animal",
    sentAt: "Mar 18, 2024",
    message: "Welcome to the team! We're excited to partner with you on this project. Please review and complete the onboarding documents below before our kickoff call. Let me know if you have any questions. - Agency contact",
    kickoffScheduleLink: "https://calendly.com/sarah-chen-ea/nwsl-kickoff",
    status: "in_progress",
    documents: [
      {
        id: "nda",
        name: "Mutual Non-Disclosure Agreement",
        type: "agency",
        category: "Legal",
        description: "Standard NDA covering confidential information shared during the engagement.",
        required: true,
        status: "signed",
        action: "sign",
        signedAt: "Mar 18, 2024 2:15 PM",
        icon: Shield,
      },
      {
        id: "msa",
        name: "Master Service Agreement",
        type: "agency",
        category: "Legal",
        description: "Terms and conditions for our working relationship, including payment terms, IP ownership, and liability.",
        required: true,
        status: "pending",
        action: "sign",
        dueDate: "Mar 25, 2024",
        icon: FileCheck,
      },
      {
        id: "insurance",
        name: "Certificate of Insurance",
        type: "agency",
        category: "Compliance",
        description: "Please upload your current COI showing general liability and E&O coverage.",
        required: true,
        status: "pending",
        action: "upload",
        dueDate: "Mar 25, 2024",
        icon: FileCheck,
      },
      {
        id: "comms",
        name: "Communications Protocol",
        type: "agency",
        category: "Operations",
        description: "Guidelines for how we communicate, escalation procedures, and response time expectations.",
        required: true,
        status: "acknowledged",
        action: "acknowledge",
        viewedAt: "Mar 18, 2024 2:20 PM",
        icon: Mail,
      },
      {
        id: "brand",
        name: "NWSL Brand Guidelines",
        type: "project",
        category: "Brand",
        description: "Official brand guidelines including logos, colors, typography, and usage rules.",
        required: true,
        status: "viewed",
        action: "view",
        viewedAt: "Mar 18, 2024 3:00 PM",
        icon: Palette,
      },
      {
        id: "style",
        name: "Content Style Guide",
        type: "project",
        category: "Creative",
        description: "Tone of voice, messaging framework, and content guidelines for the series.",
        required: true,
        status: "pending",
        action: "view",
        icon: BookOpen,
      },
      {
        id: "timeline",
        name: "Master Production Timeline",
        type: "project",
        category: "Planning",
        description: "Full project timeline with milestones, deliverable dates, and key deadlines.",
        required: true,
        status: "pending",
        action: "view",
        icon: Calendar,
      },
      {
        id: "assets",
        name: "Asset Library Access",
        type: "project",
        category: "Resources",
        description: "Shared Google Drive folder with logos, templates, reference materials, and working files.",
        required: false,
        status: "pending",
        action: "view",
        icon: FolderOpen,
      },
    ],
  },
]

type ApiPkgDoc = {
  id: string
  label: string
  url: string
  document_role: string
}

type ApiOnboardingPackage = {
  id: string
  status: string
  kickoff_type: string
  kickoff_url: string | null
  kickoff_availability: string | null
  partner_reviewed_at: string | null
  custom_message: string | null
  created_at: string
  project: { name?: string | null; title?: string | null; client_name?: string | null } | null
  // Renamed from `agency` by Greg's 079 ruling. The producer,
  // app/api/partner/onboarding-packages/route.ts, was also repointed off `profiles` onto
  // `organizations` in the same commit - see the 15th site there.
  lead_org: { name: string | null; contact_name: string | null } | null
  documents: ApiPkgDoc[]
}

/** Prefer `name` (current schema); fall back to legacy `title` if present. */
function apiProjectName(project: ApiOnboardingPackage["project"]): string {
  const t = (project?.name ?? project?.title ?? "").trim()
  return t || "Project"
}

function apiClientName(project: ApiOnboardingPackage["project"]): string | null {
  const c = (project?.client_name ?? "").trim()
  return c || null
}

export default function PartnerOnboardingPage() {
  const isDemo = isDemoMode()
  const onboardingPackets = isDemo ? demoOnboardingPackets : []
  const [packets, setPackets] = useState(onboardingPackets)
  const [apiPackages, setApiPackages] = useState<ApiOnboardingPackage[]>([])
  const [apiLoading, setApiLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [selectedApiId, setSelectedApiId] = useState<string | null>(null)
  const [markingReviewed, setMarkingReviewed] = useState(false)
  const [selectedPacket, setSelectedPacket] = useState<OnboardingPacket | null>(packets[0] || null)
  const [showSignModal, setShowSignModal] = useState(false)
  const [signingDoc, setSigningDoc] = useState<OnboardingDocument | null>(null)
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({})

  useEffect(() => {
    if (isDemo) return
    let cancelled = false
    ;(async () => {
      setApiLoading(true)
      setApiError(null)
      try {
        const res = await fetch("/api/partner/onboarding-packages", { credentials: "same-origin" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((data?.error as string) || "Could not load onboarding")
        const list = (data.packages || []) as ApiOnboardingPackage[]
        if (!cancelled) {
          setApiPackages(list)
          setSelectedApiId((prev) => prev ?? (list[0]?.id ?? null))
        }
      } catch (e) {
        if (!cancelled) setApiError(e instanceof Error ? e.message : "Failed to load")
      } finally {
        if (!cancelled) setApiLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDemo])

  const selectedApi = apiPackages.find((p) => p.id === selectedApiId) || apiPackages[0] || null
  const selectedApiClientName = selectedApi ? apiClientName(selectedApi.project) : null

  const markReviewed = async () => {
    if (!selectedApi) return
    setMarkingReviewed(true)
    setApiError(null)
    try {
      const res = await fetch(`/api/partner/onboarding-packages/${selectedApi.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "mark_reviewed" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data?.error as string) || "Update failed")
      setApiPackages((prev) =>
        prev.map((p) =>
          p.id === selectedApi.id
            ? { ...p, status: "reviewed", partner_reviewed_at: new Date().toISOString() }
            : p
        )
      )
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "Failed")
    } finally {
      setMarkingReviewed(false)
    }
  }

  const openDocHref = (doc: ApiPkgDoc) => {
    if (doc.url.startsWith("http://") || doc.url.startsWith("https://")) {
      if (doc.url.includes("blob.vercel-storage.com") || doc.url.includes("vercel-storage.com")) {
        return `/api/partner/onboarding/file?documentId=${encodeURIComponent(doc.id)}`
      }
      return doc.url
    }
    return doc.url
  }
  
  const getStatusColor = (status: DocumentStatus) => {
    switch (status) {
      case "signed": return "bg-success/15 text-success border-success/30"
      case "uploaded": return "bg-success/15 text-success border-success/30"
      case "acknowledged": return "bg-success/15 text-success border-success/30"
      case "viewed": return "bg-blue-100 text-blue-700 border-blue-200"
      case "pending": return "bg-yellow-100 text-yellow-700 border-yellow-200"
      default: return "bg-gray-100 text-vendor-muted-strong border-vendor-border"
    }
  }
  
  const getStatusLabel = (status: DocumentStatus, action: string) => {
    switch (status) {
      case "signed": return "Signed"
      case "uploaded": return "Uploaded"
      case "acknowledged": return "Acknowledged"
      case "viewed": return "Viewed"
      case "pending": return action === "sign" ? "Signature Required" : action === "upload" ? "Upload Required" : "Not Viewed"
      default: return "Pending"
    }
  }
  
  const handleFileUpload = async (docId: string, file: File) => {
    if (!selectedPacket) return
    setUploadingDocId(docId)
    setUploadError(null)
    
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("folder", "partner-onboarding")

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error || "Upload failed")
      }

      const timestamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
      
      // Update document status
      const updatedDocs = selectedPacket.documents.map(doc =>
        doc.id === docId ? { ...doc, status: "uploaded" as DocumentStatus, viewedAt: timestamp } : doc
      )
      
      const updatedPacket = { ...selectedPacket, documents: updatedDocs }
      setSelectedPacket(updatedPacket)
      setPackets(prev => prev.map(p => p.id === selectedPacket.id ? updatedPacket : p))
    } catch (error) {
      console.error("Upload error:", error)
      setUploadError(error instanceof Error ? error.message : "Upload failed. Please try again.")
    } finally {
      setUploadingDocId(null)
    }
  }

  const handleUploadClick = (docId: string) => {
    fileInputRefs.current[docId]?.click()
  }

  const handleFileChange = (docId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileUpload(docId, file)
    }
  }

  const handleDocumentAction = (docId: string, action: string) => {
    if (!selectedPacket) return
    
    if (action === "upload") {
      handleUploadClick(docId)
      return
    }
    
    if (action === "sign") {
      const doc = selectedPacket.documents.find(d => d.id === docId)
      if (doc) {
        setSigningDoc(doc)
        setShowSignModal(true)
      }
      return
    }
    
    const newStatus: DocumentStatus = 
      action === "upload" ? "uploaded" : 
      action === "acknowledge" ? "acknowledged" : 
      "viewed"
    
    const timestamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    
    setPackets(prev => prev.map(p => 
      p.id === selectedPacket.id 
        ? {
            ...p,
            documents: p.documents.map(d => 
              d.id === docId 
                ? { ...d, status: newStatus, viewedAt: timestamp, signedAt: action === "sign" ? timestamp : undefined }
                : d
            )
          }
        : p
    ))
    
    setSelectedPacket(prev => prev ? {
      ...prev,
      documents: prev.documents.map(d => 
        d.id === docId 
          ? { ...d, status: newStatus, viewedAt: timestamp, signedAt: action === "sign" ? timestamp : undefined }
          : d
      )
    } : null)
  }
  
  const handleSign = () => {
    if (!signingDoc || !selectedPacket) return
    
    const timestamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    
    setPackets(prev => prev.map(p => 
      p.id === selectedPacket.id 
        ? {
            ...p,
            documents: p.documents.map(d => 
              d.id === signingDoc.id 
                ? { ...d, status: "signed" as DocumentStatus, signedAt: timestamp }
                : d
            )
          }
        : p
    ))
    
    setSelectedPacket(prev => prev ? {
      ...prev,
      documents: prev.documents.map(d => 
        d.id === signingDoc.id 
          ? { ...d, status: "signed" as DocumentStatus, signedAt: timestamp }
          : d
      )
    } : null)
    
    setShowSignModal(false)
    setSigningDoc(null)
  }
  
  const completedCount = selectedPacket?.documents.filter(d => 
    d.status === "signed" || d.status === "uploaded" || d.status === "acknowledged" || d.status === "viewed"
  ).length || 0
  
  const requiredCount = selectedPacket?.documents.filter(d => d.required).length || 0
  const requiredCompletedCount = selectedPacket?.documents.filter(d => 
    d.required && (d.status === "signed" || d.status === "uploaded" || d.status === "acknowledged" || d.status === "viewed")
  ).length || 0
  
  return (
    <PartnerLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display font-bold text-3xl text-vendor-foreground">Onboarding</h1>
            <p className="text-vendor-muted-strong mt-1">
              Review and complete onboarding documents for your active projects.
            </p>
          </div>
          <LeadAgencyFilter />
        </div>

        {!isDemo && (
          <>
            {apiLoading && (
              <div className="flex items-center gap-2 text-vendor-muted-strong text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading packages…
              </div>
            )}
            {apiError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{apiError}</div>
            )}
            {!apiLoading && apiPackages.length === 0 && !apiError && (
              <div className="bg-vendor-surface rounded-xl border border-vendor-border p-12 text-center">
                <FileText className="w-12 h-12 mx-auto mb-4 text-vendor-muted/50" />
                <div className="font-display font-bold text-xl text-vendor-foreground mb-2">No onboarding packages</div>
                <p className="text-vendor-muted-strong">
                  When your lead agency sends onboarding documents, they will appear here.
                </p>
              </div>
            )}
            {!apiLoading && selectedApi && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="space-y-3">
                  {apiPackages.map((p) => {
                    const agencyName = p.lead_org?.name || p.lead_org?.contact_name || "Lead agency"
                    const projectName = apiProjectName(p.project)
                    const clientName = apiClientName(p.project)
                    const isSel = selectedApi?.id === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedApiId(p.id)}
                        className={cn(
                          "w-full text-left p-4 rounded-xl border transition-colors",
                          isSel
                            ? "bg-vendor-foreground text-white border-vendor-foreground"
                            : "bg-vendor-surface border-vendor-border hover:border-vendor-foreground/30"
                        )}
                      >
                        <div className={cn("font-display font-bold", isSel ? "text-white" : "text-vendor-foreground")}>
                          {agencyName}
                        </div>
                        <div
                          className={cn(
                            "text-sm font-medium mt-1.5",
                            isSel ? "text-white/90" : "text-vendor-foreground"
                          )}
                        >
                          {projectName}
                        </div>
                        {clientName ? (
                          <div
                            className={cn("text-xs mt-0.5", isSel ? "text-white/65" : "text-vendor-muted")}
                          >
                            {clientName}
                          </div>
                        ) : null}
                        <div
                          className={cn(
                            "font-mono text-2xs mt-2",
                            isSel ? "text-white/70" : "text-vendor-muted"
                          )}
                        >
                          {new Date(p.created_at).toLocaleDateString()}
                        </div>
                        <div
                          className={cn(
                            "font-mono text-2xs mt-2 px-2 py-0.5 rounded-full inline-block",
                            p.status === "reviewed"
                              ? isSel
                                ? "bg-white/20"
                                : "bg-success/15 text-success"
                              : isSel
                                ? "bg-white/20"
                                : "bg-amber-100 text-amber-900"
                          )}
                        >
                          {p.status === "reviewed" ? "Reviewed" : "Action needed"}
                        </div>
                      </button>
                    )
                  })}
                </div>
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-vendor-surface rounded-xl border border-vendor-border p-6">
                    <h2 className="font-display font-bold text-2xl text-vendor-foreground">
                      {apiProjectName(selectedApi.project)}
                    </h2>
                    {selectedApiClientName ? (
                      <p className="text-xs text-vendor-muted mt-1">{selectedApiClientName}</p>
                    ) : null}
                    <p className="text-sm text-vendor-muted-strong mt-1">
                      From{" "}
                      {selectedApi.lead_org?.name || selectedApi.lead_org?.contact_name || "your lead agency"}
                    </p>
                    {selectedApi.custom_message && (
                      <div className="mt-4 rounded-lg bg-vendor-foreground/5 p-4 text-sm text-vendor-foreground whitespace-pre-wrap">
                        {selectedApi.custom_message}
                      </div>
                    )}
                    <div className="mt-6 border-t border-vendor-border/50 pt-6">
                      <h3 className="font-display font-bold text-lg text-vendor-foreground mb-3">Schedule meeting</h3>
                      {selectedApi.kickoff_type === "calendly" && selectedApi.kickoff_url && (
                        <Button className="bg-[#C8F53C] text-vendor-foreground hover:bg-[#C8F53C]/90 font-display font-bold" asChild>
                          <a href={normalizeMeetingUrlForHref(selectedApi.kickoff_url)} target="_blank" rel="noopener noreferrer">
                            <Calendar className="w-4 h-4 mr-2" />
                            Schedule meeting
                          </a>
                        </Button>
                      )}
                      {selectedApi.kickoff_type === "availability" && selectedApi.kickoff_availability && (
                        <div className="rounded-lg border border-vendor-border bg-vendor-background p-4 text-sm text-vendor-foreground whitespace-pre-wrap">
                          {selectedApi.kickoff_availability}
                        </div>
                      )}
                      {selectedApi.kickoff_type === "none" && (
                        <p className="text-sm text-vendor-muted">No kickoff details included.</p>
                      )}
                    </div>
                  </div>

                  <div className="bg-vendor-surface rounded-xl border border-vendor-border p-6">
                    <h3 className="font-display font-bold text-lg text-vendor-foreground mb-4">Documents</h3>
                    <ul className="space-y-3">
                      {selectedApi.documents.map((doc) => {
                        const href = openDocHref(doc)
                        const isProxy = href.startsWith("/api/")
                        return (
                          <li
                            key={doc.id}
                            className="flex flex-wrap items-center justify-between gap-3 border border-vendor-border/50 rounded-lg p-3"
                          >
                            <div>
                              <div className="font-medium text-vendor-foreground">{doc.label}</div>
                              <div className="font-mono text-2xs text-vendor-muted uppercase">{doc.document_role}</div>
                            </div>
                            <Button variant="outline" size="sm" className="border-vendor-border" asChild>
                              <a href={href} {...(isProxy ? {} : { target: "_blank", rel: "noopener noreferrer" })}>
                                <ExternalLink className="w-4 h-4 mr-1" />
                                Open
                              </a>
                            </Button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>

                  {selectedApi.status !== "reviewed" ? (
                    <Button
                      type="button"
                      className="bg-vendor-foreground hover:bg-vendor-foreground/90 text-white"
                      disabled={markingReviewed}
                      onClick={() => void markReviewed()}
                    >
                      {markingReviewed ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Mark as reviewed
                        </>
                      )}
                    </Button>
                  ) : (
                    <div className="rounded-xl border border-success/30 bg-success/15 p-4 text-sm text-success flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 shrink-0" />
                      You marked this package as reviewed
                      {selectedApi.partner_reviewed_at &&
                        ` on ${new Date(selectedApi.partner_reviewed_at).toLocaleString()}`}
                      .
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        
        {isDemo ? (
          packets.length === 0 ? (
          <div className="bg-vendor-surface rounded-xl border border-vendor-border p-12 text-center">
            <FileText className="w-12 h-12 mx-auto mb-4 text-vendor-muted/50" />
            <div className="font-display font-bold text-xl text-vendor-foreground mb-2">
              No Onboarding Packets
            </div>
            <p className="text-vendor-muted-strong">
              You don&apos;t have any pending onboarding documents. When you&apos;re awarded a project, onboarding materials will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {uploadError && (
              <div className="lg:col-span-3 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
                {uploadError}
              </div>
            )}
            {/* Packet List */}
            <div className="space-y-3">
              {packets.map((packet) => {
                const packetCompleted = packet.documents.filter(d => 
                  d.status === "signed" || d.status === "uploaded" || d.status === "acknowledged" || d.status === "viewed"
                ).length
                const packetTotal = packet.documents.length
                
                return (
                  <button
                    key={packet.id}
                    onClick={() => setSelectedPacket(packet)}
                    className={cn(
                      "w-full text-left p-4 rounded-xl border transition-colors",
                      selectedPacket?.id === packet.id
                        ? "bg-vendor-foreground text-white border-vendor-foreground"
                        : "bg-vendor-surface border-vendor-border hover:border-vendor-foreground/30"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={cn(
                        "font-mono text-2xs px-2 py-0.5 rounded-full capitalize",
                        selectedPacket?.id === packet.id
                          ? "bg-white/20 text-white"
                          : packet.status === "complete" 
                            ? "bg-success/15 text-success"
                            : "bg-yellow-100 text-yellow-700"
                      )}>
                        {packet.status.replace("_", " ")}
                      </span>
                      <span className={cn(
                        "font-mono text-2xs",
                        selectedPacket?.id === packet.id ? "text-white/60" : "text-vendor-muted"
                      )}>
                        {packetCompleted}/{packetTotal} complete
                      </span>
                    </div>
                    <h3 className={cn(
                      "font-display font-bold",
                      selectedPacket?.id === packet.id ? "text-white" : "text-vendor-foreground"
                    )}>
                      {packet.projectName}
                    </h3>
                    <div className={cn(
                      "font-mono text-2xs mt-1",
                      selectedPacket?.id === packet.id ? "text-white/60" : "text-vendor-muted"
                    )}>
                      from {packet.agencyName} • {packet.sentAt}
                    </div>
                  </button>
                )
              })}
            </div>
            
            {/* Packet Detail */}
            {selectedPacket && (
              <div className="lg:col-span-2 space-y-6">
                {/* Header Card */}
                <div className="bg-vendor-surface rounded-xl border border-vendor-border p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="font-display font-bold text-2xl text-vendor-foreground">
                        {selectedPacket.projectName}
                      </h2>
                      <div className="font-mono text-xs text-vendor-muted mt-1">
                        Onboarding packet from {selectedPacket.agencyName}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xs text-vendor-muted mb-1">Progress</div>
                      <div className="font-display font-bold text-lg text-vendor-foreground">
                        {requiredCompletedCount}/{requiredCount} Required
                      </div>
                    </div>
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="mb-4">
                    <div className="h-2 bg-vendor-track rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-vendor-foreground rounded-full transition-all"
                        style={{ width: `${(completedCount / selectedPacket.documents.length) * 100}%` }}
                      />
                    </div>
                  </div>
                  
                  {/* Message from Agency */}
                  <div className="bg-vendor-foreground/5 rounded-lg p-4 mb-4">
                    <div className="font-mono text-2xs text-vendor-foreground/60 uppercase tracking-wider mb-2">
                      Message from {selectedPacket.agencyName}
                    </div>
                    <p className="text-sm text-vendor-foreground italic">&quot;{selectedPacket.message}&quot;</p>
                  </div>
                  
                  {/* Schedule Kickoff */}
                  <Button
                    className="w-full bg-[#C8F53C] text-vendor-foreground hover:bg-[#C8F53C]/90 font-display font-bold"
                    asChild
                  >
                    <a href={normalizeMeetingUrlForHref(selectedPacket.kickoffScheduleLink)} target="_blank" rel="noopener noreferrer">
                      <Calendar className="w-4 h-4 mr-2" />
                      Schedule kickoff call
                    </a>
                  </Button>
                </div>
                
                {/* Documents by Type */}
                {["agency", "project"].map((type) => {
                  const typeDocs = selectedPacket.documents.filter(d => d.type === type)
                  if (typeDocs.length === 0) return null
                  
                  return (
                    <div key={type} className="bg-vendor-surface rounded-xl border border-vendor-border p-6">
                      <div className="flex items-center gap-2 mb-4">
                        {type === "agency" ? (
                          <Shield className="w-5 h-5 text-purple-500" />
                        ) : (
                          <Palette className="w-5 h-5 text-vendor-foreground" />
                        )}
                        <h3 className="font-display font-bold text-lg text-vendor-foreground capitalize">
                          {type} Documents
                        </h3>
                        <span className="font-mono text-2xs text-vendor-muted ml-auto">
                          {typeDocs.filter(d => d.status !== "pending").length}/{typeDocs.length} complete
                        </span>
                      </div>
                      
                      <div className="space-y-3">
                        {typeDocs.map((doc) => {
                          const Icon = doc.icon
                          return (
                            <div
                              key={doc.id}
                              className={cn(
                                "p-4 rounded-lg border transition-colors",
                                doc.status === "pending" && doc.required
                                  ? "bg-yellow-50 border-yellow-200"
                                  : doc.status === "pending"
                                  ? "bg-vendor-background border-vendor-border"
                                  : "bg-success/15 border-success/30"
                              )}
                            >
                              <div className="flex items-start gap-4">
                                <div className={cn(
                                  "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                                  type === "agency" ? "bg-purple-100" : "bg-vendor-foreground/10"
                                )}>
                                  <Icon className={cn(
                                    "w-5 h-5",
                                    type === "agency" ? "text-purple-600" : "text-vendor-foreground"
                                  )} />
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-display font-bold text-vendor-foreground">{doc.name}</span>
                                    {doc.required && (
                                      <span className="font-mono text-2xs px-1.5 py-0.5 rounded bg-red-100 text-red-600">Required</span>
                                    )}
                                  </div>
                                  <p className="text-sm text-vendor-muted-strong mb-2">{doc.description}</p>
                                  
                                  <div className="flex items-center gap-3">
                                    <span className={cn(
                                      "font-mono text-2xs px-2 py-0.5 rounded-full border flex items-center gap-1",
                                      getStatusColor(doc.status)
                                    )}>
                                      {doc.status === "signed" || doc.status === "uploaded" || doc.status === "acknowledged" || doc.status === "viewed" ? (
                                        <CheckCircle className="w-3 h-3" />
                                      ) : (
                                        <Clock className="w-3 h-3" />
                                      )}
                                      {getStatusLabel(doc.status, doc.action)}
                                    </span>
                                    
                                    {(doc.signedAt || doc.viewedAt) && (
                                      <span className="font-mono text-2xs text-vendor-muted/70">
                                        {doc.signedAt || doc.viewedAt}
                                      </span>
                                    )}
                                    
                                    {doc.status === "pending" && doc.dueDate && (
                                      <span className="font-mono text-2xs text-yellow-600 flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        Due {doc.dueDate}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                
                                <div className="flex items-center gap-2 shrink-0">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="border-vendor-border text-vendor-muted-strong hover:bg-vendor-background"
                                  >
                                    <Download className="w-4 h-4 mr-1" />
                                    Download
                                  </Button>
                                  
                                  {doc.status === "pending" && (
                                    <>
                                      {doc.action === "upload" && (
                                        <input
                                          type="file"
                                          ref={(el) => { fileInputRefs.current[doc.id] = el }}
                                          onChange={(e) => handleFileChange(doc.id, e)}
                                          accept=".pdf,.docx,.pptx"
                                          className="sr-only"
                                        />
                                      )}
                                      <Button
                                        size="sm"
                                        onClick={() => handleDocumentAction(doc.id, doc.action)}
                                        disabled={uploadingDocId === doc.id}
                                        className={cn(
                                          doc.action === "sign"
                                            ? "bg-accent text-accent-foreground hover:bg-accent/90"
                                            : doc.action === "upload"
                                            ? "bg-blue-600 hover:bg-blue-700 text-white"
                                            : "bg-vendor-foreground hover:bg-vendor-foreground/90 text-white"
                                        )}
                                      >
                                        {uploadingDocId === doc.id ? (
                                          <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Uploading...</>
                                        ) : (
                                          <>
                                            {doc.action === "sign" && <><Signature className="w-4 h-4 mr-1" /> Sign</>}
                                            {doc.action === "upload" && <><Upload className="w-4 h-4 mr-1" /> Upload</>}
                                            {doc.action === "acknowledge" && <><CheckCircle className="w-4 h-4 mr-1" /> Acknowledge</>}
                                            {doc.action === "view" && <><Eye className="w-4 h-4 mr-1" /> View & Confirm</>}
                                          </>
                                        )}
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                
                {/* Completion Status */}
                {requiredCompletedCount === requiredCount && (
                  <div className="bg-success/15 rounded-xl border border-success/30 p-6 text-center">
                    <CheckCircle className="w-12 h-12 mx-auto mb-3 text-success" />
                    <div className="font-display font-bold text-xl text-vendor-foreground mb-2">
                      Onboarding Complete!
                    </div>
                    <p className="text-sm text-vendor-muted-strong mb-4">
                      You&apos;ve completed all required onboarding documents. Don&apos;t forget to schedule your kickoff call.
                    </p>
                    <Button
                      className="bg-vendor-foreground hover:bg-vendor-foreground/90 text-white"
                      asChild
                    >
                      <a href="/partner/projects">
                        Go to active projects →
                      </a>
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
        ) : null}
      </div>
      
      {/* Sign Modal (demo only) */}
      {isDemo && showSignModal && signingDoc && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-vendor-surface rounded-xl max-w-lg w-full p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-lg bg-vendor-foreground/10 flex items-center justify-center">
                <Signature className="w-6 h-6 text-vendor-foreground" />
              </div>
              <div>
                <h3 className="font-display font-bold text-xl text-vendor-foreground">Sign document</h3>
                <p className="text-sm text-vendor-muted">{signingDoc.name}</p>
              </div>
            </div>
            
            <div className="bg-vendor-background rounded-lg p-4 mb-6">
              <p className="text-sm text-vendor-muted-strong">
                By signing below, you agree to the terms outlined in this document. Your digital signature is legally binding.
              </p>
            </div>
            
            <div className="border-2 border-dashed border-vendor-border rounded-lg p-8 mb-6 text-center">
              <div className="font-display text-2xl text-vendor-muted/50 italic">
                Your organization
              </div>
              <div className="font-mono text-2xs text-vendor-muted/70 mt-2">
                Digital Signature
              </div>
            </div>
            
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => { setShowSignModal(false); setSigningDoc(null); }}
                className="flex-1 border-vendor-border"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSign}
                className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
              >
                <Signature className="w-4 h-4 mr-2" />
                Sign document
              </Button>
            </div>
          </div>
        </div>
      )}
    </PartnerLayout>
  )
}
