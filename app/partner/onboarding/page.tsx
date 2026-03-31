"use client"

import { useState, useRef, useEffect } from "react"
import { PartnerLayout } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { LeadAgencyFilter } from "@/components/lead-agency-filter"
import { isDemoMode } from "@/lib/demo-data"
import { EmptyState } from "@/components/empty-state"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
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
    message: "Welcome to the team! We're excited to have Fieldhouse Films join us on this project. Please review and complete the onboarding documents below before our kickoff call. Let me know if you have any questions. - Sarah",
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

export default function PartnerOnboardingPage() {
  const isDemo = isDemoMode()
  const router = useRouter()
  const onboardingPackets = isDemo ? demoOnboardingPackets : []
  const [packets, setPackets] = useState(onboardingPackets)
  const [selectedPacket, setSelectedPacket] = useState<OnboardingPacket | null>(packets[0] || null)
  const [showSignModal, setShowSignModal] = useState(false)
  const [signingDoc, setSigningDoc] = useState<OnboardingDocument | null>(null)
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({})

  useEffect(() => {
    if (isDemo) return
    const ensurePartnerAuth = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push("/auth/login?redirect=%2Fpartner%2Fonboarding")
        return
      }
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
      if (profile?.role !== "partner") {
        router.push("/partner")
      }
    }
    ensurePartnerAuth()
  }, [isDemo, router])
  
  const getStatusColor = (status: DocumentStatus) => {
    switch (status) {
      case "signed": return "bg-green-100 text-green-700 border-green-200"
      case "uploaded": return "bg-green-100 text-green-700 border-green-200"
      case "acknowledged": return "bg-green-100 text-green-700 border-green-200"
      case "viewed": return "bg-blue-100 text-blue-700 border-blue-200"
      case "pending": return "bg-yellow-100 text-yellow-700 border-yellow-200"
      default: return "bg-gray-100 text-gray-600 border-gray-200"
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
            <h1 className="font-display font-bold text-3xl text-[#0C3535]">Onboarding</h1>
            <p className="text-gray-600 mt-1">
              Review and complete onboarding documents for your active projects.
            </p>
          </div>
          <LeadAgencyFilter />
        </div>
        
        {packets.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <div className="font-display font-bold text-xl text-[#0C3535] mb-2">
              No Onboarding Packets
            </div>
            <p className="text-gray-600">
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
                        ? "bg-[#0C3535] text-white border-[#0C3535]"
                        : "bg-white border-gray-200 hover:border-[#0C3535]/30"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={cn(
                        "font-mono text-[10px] px-2 py-0.5 rounded-full capitalize",
                        selectedPacket?.id === packet.id
                          ? "bg-white/20 text-white"
                          : packet.status === "complete" 
                            ? "bg-green-100 text-green-700"
                            : "bg-yellow-100 text-yellow-700"
                      )}>
                        {packet.status.replace("_", " ")}
                      </span>
                      <span className={cn(
                        "font-mono text-[10px]",
                        selectedPacket?.id === packet.id ? "text-white/60" : "text-gray-500"
                      )}>
                        {packetCompleted}/{packetTotal} complete
                      </span>
                    </div>
                    <h3 className={cn(
                      "font-display font-bold",
                      selectedPacket?.id === packet.id ? "text-white" : "text-[#0C3535]"
                    )}>
                      {packet.projectName}
                    </h3>
                    <div className={cn(
                      "font-mono text-[10px] mt-1",
                      selectedPacket?.id === packet.id ? "text-white/60" : "text-gray-500"
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
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="font-display font-bold text-2xl text-[#0C3535]">
                        {selectedPacket.projectName}
                      </h2>
                      <div className="font-mono text-xs text-gray-500 mt-1">
                        Onboarding packet from {selectedPacket.agencyName}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xs text-gray-500 mb-1">Progress</div>
                      <div className="font-display font-bold text-lg text-[#0C3535]">
                        {requiredCompletedCount}/{requiredCount} Required
                      </div>
                    </div>
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="mb-4">
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[#0C3535] rounded-full transition-all"
                        style={{ width: `${(completedCount / selectedPacket.documents.length) * 100}%` }}
                      />
                    </div>
                  </div>
                  
                  {/* Message from Agency */}
                  <div className="bg-[#0C3535]/5 rounded-lg p-4 mb-4">
                    <div className="font-mono text-[10px] text-[#0C3535]/60 uppercase tracking-wider mb-2">
                      Message from {selectedPacket.agencyName}
                    </div>
                    <p className="text-sm text-[#0C3535] italic">&quot;{selectedPacket.message}&quot;</p>
                  </div>
                  
                  {/* Schedule Kickoff */}
                  <Button
                    className="w-full bg-[#C8F53C] text-[#0C3535] hover:bg-[#C8F53C]/90 font-display font-bold"
                    asChild
                  >
                    <a href={selectedPacket.kickoffScheduleLink} target="_blank" rel="noopener noreferrer">
                      <Calendar className="w-4 h-4 mr-2" />
                      Schedule Kickoff Call
                    </a>
                  </Button>
                </div>
                
                {/* Documents by Type */}
                {["agency", "project"].map((type) => {
                  const typeDocs = selectedPacket.documents.filter(d => d.type === type)
                  if (typeDocs.length === 0) return null
                  
                  return (
                    <div key={type} className="bg-white rounded-xl border border-gray-200 p-6">
                      <div className="flex items-center gap-2 mb-4">
                        {type === "agency" ? (
                          <Shield className="w-5 h-5 text-purple-500" />
                        ) : (
                          <Palette className="w-5 h-5 text-[#0C3535]" />
                        )}
                        <h3 className="font-display font-bold text-lg text-[#0C3535] capitalize">
                          {type} Documents
                        </h3>
                        <span className="font-mono text-[10px] text-gray-500 ml-auto">
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
                                  ? "bg-gray-50 border-gray-200"
                                  : "bg-green-50 border-green-200"
                              )}
                            >
                              <div className="flex items-start gap-4">
                                <div className={cn(
                                  "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                                  type === "agency" ? "bg-purple-100" : "bg-[#0C3535]/10"
                                )}>
                                  <Icon className={cn(
                                    "w-5 h-5",
                                    type === "agency" ? "text-purple-600" : "text-[#0C3535]"
                                  )} />
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-display font-bold text-[#0C3535]">{doc.name}</span>
                                    {doc.required && (
                                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600">Required</span>
                                    )}
                                  </div>
                                  <p className="text-sm text-gray-600 mb-2">{doc.description}</p>
                                  
                                  <div className="flex items-center gap-3">
                                    <span className={cn(
                                      "font-mono text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1",
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
                                      <span className="font-mono text-[10px] text-gray-400">
                                        {doc.signedAt || doc.viewedAt}
                                      </span>
                                    )}
                                    
                                    {doc.status === "pending" && doc.dueDate && (
                                      <span className="font-mono text-[10px] text-yellow-600 flex items-center gap-1">
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
                                    className="border-gray-300 text-gray-600 hover:bg-gray-50"
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
                                            ? "bg-purple-600 hover:bg-purple-700 text-white"
                                            : doc.action === "upload"
                                            ? "bg-blue-600 hover:bg-blue-700 text-white"
                                            : "bg-[#0C3535] hover:bg-[#0C3535]/90 text-white"
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
                  <div className="bg-green-50 rounded-xl border border-green-200 p-6 text-center">
                    <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-600" />
                    <div className="font-display font-bold text-xl text-[#0C3535] mb-2">
                      Onboarding Complete!
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      You&apos;ve completed all required onboarding documents. Don&apos;t forget to schedule your kickoff call.
                    </p>
                    <Button
                      className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white"
                      asChild
                    >
                      <a href="/partner/projects">
                        Go to Active Projects →
                      </a>
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Sign Modal */}
      {showSignModal && signingDoc && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center">
                <Signature className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <h3 className="font-display font-bold text-xl text-[#0C3535]">Sign Document</h3>
                <p className="text-sm text-gray-500">{signingDoc.name}</p>
              </div>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-600">
                By signing below, you agree to the terms outlined in this document. Your digital signature is legally binding.
              </p>
            </div>
            
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 mb-6 text-center">
              <div className="font-display text-2xl text-gray-300 italic">
                Fieldhouse Films
              </div>
              <div className="font-mono text-[10px] text-gray-400 mt-2">
                Digital Signature
              </div>
            </div>
            
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => { setShowSignModal(false); setSigningDoc(null); }}
                className="flex-1 border-gray-300"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSign}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
              >
                <Signature className="w-4 h-4 mr-2" />
                Sign Document
              </Button>
            </div>
          </div>
        </div>
      )}
    </PartnerLayout>
  )
}
