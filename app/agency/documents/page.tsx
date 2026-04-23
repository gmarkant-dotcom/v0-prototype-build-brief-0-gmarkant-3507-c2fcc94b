"use client"

import { useState } from "react"
import { AgencyLayout } from "@/components/agency-layout"
import { FileUpload } from "@/components/file-upload"
import { StageHeader } from "@/components/stage-header"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import { usePaidUser } from "@/contexts/paid-user-context"
import { EmptyState } from "@/components/empty-state"
import { AgencyDocumentLibraryManager } from "@/components/agency-document-library-manager"

type Document = {
  id: string
  name: string
  type: "client_brief" | "master_brief" | "partner_brief_template" | "rfp_template" | "sow_template" | "nda_template" | "msa_template" | "requirements" | "other"
  format: "pdf" | "docx" | "pptx" | "gdoc" | "gslides" | "link"
  uploadedAt: string
  size: string
  project?: string
  isTemplate: boolean
  description?: string
  url?: string
}

// Demo data - only shown when NEXT_PUBLIC_IS_DEMO=true
const demoDocuments: Document[] = [
  // Master Brief Templates (for lead agency reference only)
  {
    id: "master-1",
    name: "Master Client Brief Template",
    type: "master_brief",
    format: "docx",
    uploadedAt: "2024-02-01",
    size: "245 KB",
    isTemplate: true,
    description: "Internal template for capturing full client requirements. Contains all confidential details, budgets, and strategic objectives.",
  },
  {
    id: "master-2",
    name: "NWSL Creator Content Series - Master Brief",
    type: "master_brief",
    format: "pdf",
    uploadedAt: "2024-01-15",
    size: "4.2 MB",
    project: "NWSL Creator Content Series",
    isTemplate: false,
    description: "Complete client brief with confidential budget details, internal notes, and full strategic context.",
  },
  // Partner Brief Templates (for external sharing)
  {
    id: "partner-1",
    name: "Partner Brief Template - Standard",
    type: "partner_brief_template",
    format: "docx",
    uploadedAt: "2024-01-20",
    size: "128 KB",
    isTemplate: true,
    description: "Clean, external-facing brief template for sharing project requirements with potential partners.",
  },
  {
    id: "partner-2",
    name: "Partner Brief Template - Production",
    type: "partner_brief_template",
    format: "docx",
    uploadedAt: "2024-01-20",
    size: "156 KB",
    isTemplate: true,
    description: "Production-specific brief template with shot lists, location requirements, and technical specs.",
  },
  {
    id: "partner-3",
    name: "NWSL Creator Content Series - Partner Brief",
    type: "partner_brief_template",
    format: "pdf",
    uploadedAt: "2024-01-18",
    size: "1.8 MB",
    project: "NWSL Creator Content Series",
    isTemplate: false,
    description: "External-ready brief for video production partners. Confidential budget details redacted.",
  },
  // Master Requirements Document
  {
    id: "req-1",
    name: "Master Client Mandatory Requirements",
    type: "requirements",
    format: "pdf",
    uploadedAt: "2024-02-15",
    size: "892 KB",
    isTemplate: true,
    description: "Critical ways of working, compliance requirements, and mandatory standards that all partners must follow.",
  },
  // Original documents
  {
    id: "1",
    name: "Q4 Brand Campaign - Client Brief",
    type: "client_brief",
    format: "pdf",
    uploadedAt: "2024-01-15",
    size: "2.4 MB",
    project: "Q4 Brand Campaign",
    isTemplate: false,
  },
  {
    id: "2",
    name: "Electric Animal Master RFP Template",
    type: "rfp_template",
    format: "docx",
    uploadedAt: "2023-09-01",
    size: "156 KB",
    isTemplate: true,
  },
  {
    id: "3",
    name: "Electric Animal SOW Template v2",
    type: "sow_template",
    format: "docx",
    uploadedAt: "2023-11-20",
    size: "203 KB",
    isTemplate: true,
  },
  {
    id: "4",
    name: "Standard NDA - Electric Animal",
    type: "nda_template",
    format: "pdf",
    uploadedAt: "2023-06-15",
    size: "89 KB",
    isTemplate: true,
  },
  {
    id: "5",
    name: "Master Services Agreement Template",
    type: "msa_template",
    format: "docx",
    uploadedAt: "2023-08-10",
    size: "312 KB",
    isTemplate: true,
  },
  {
    id: "6",
    name: "Q4 Brand Campaign - Client Deck",
    type: "client_brief",
    format: "pptx",
    uploadedAt: "2024-01-08",
    size: "8.7 MB",
    project: "Q4 Brand Campaign",
    isTemplate: false,
  },
]

const typeLabels: Record<Document["type"], string> = {
  client_brief: "Client Brief",
  master_brief: "Master Brief (Internal)",
  partner_brief_template: "Partner Brief",
  rfp_template: "RFP Template",
  sow_template: "SOW Template",
  nda_template: "NDA Template",
  msa_template: "MSA Template",
  requirements: "Requirements",
  other: "Other",
}

const formatIcons: Record<Document["format"], string> = {
  pdf: "PDF",
  docx: "DOC",
  pptx: "PPT",
  gdoc: "G",
  gslides: "G",
  link: "URL",
}

export default function DocumentsPage() {
  const isDemo = isDemoMode()
  const { checkFeatureAccess } = usePaidUser()
  const documents = isDemo ? demoDocuments : []

  if (!isDemo) {
    return (
      <AgencyLayout>
        <div className="p-8 max-w-6xl">
          <StageHeader
            stageNumber="◈"
            title="Master Documents"
            subtitle="Agency legal documents and key templates power RFPs and partner onboarding."
          />
          <AgencyDocumentLibraryManager />
        </div>
      </AgencyLayout>
    )
  }
  
  const [activeTab, setActiveTab] = useState<"all" | "templates" | "master_briefs" | "partner_briefs" | "requirements">("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [uploadType, setUploadType] = useState<Document["type"]>("master_brief")
  const [uploadedDocs, setUploadedDocs] = useState<Document[]>([])
  const [googleDocLink, setGoogleDocLink] = useState("")

  const handleUploadComplete = (file: { url: string; pathname: string; filename: string; size: number }) => {
    const newDoc: Document = {
      id: `uploaded-${Date.now()}`,
      name: file.filename,
      type: uploadType,
      format: file.filename.endsWith('.pdf') ? 'pdf' : 
              file.filename.endsWith('.docx') ? 'docx' : 
              file.filename.endsWith('.pptx') ? 'pptx' : 'pdf',
      uploadedAt: new Date().toISOString().split('T')[0],
      size: `${(file.size / 1024).toFixed(0)} KB`,
      isTemplate: uploadType.includes('template'),
      url: file.url,
    }
    setUploadedDocs(prev => [...prev, newDoc])
    setUploadModalOpen(false)
  }

  const handleGoogleDocSubmit = () => {
    if (!googleDocLink) return
    const newDoc: Document = {
      id: `gdoc-${Date.now()}`,
      name: googleDocLink.includes('docs.google.com') ? 'Google Doc' : 
            googleDocLink.includes('slides.google.com') ? 'Google Slides' : 'Linked Document',
      type: uploadType,
      format: googleDocLink.includes('slides') ? 'gslides' : 'gdoc',
      uploadedAt: new Date().toISOString().split('T')[0],
      size: '-',
      isTemplate: uploadType.includes('template'),
      url: googleDocLink,
    }
    setUploadedDocs(prev => [...prev, newDoc])
    setGoogleDocLink("")
    setUploadModalOpen(false)
  }

  const allDocuments = [...documents, ...uploadedDocs]
  
  const filteredDocs = allDocuments.filter(doc => {
    if (searchQuery && !doc.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false
    }
    if (activeTab === "templates" && !doc.isTemplate) return false
    if (activeTab === "master_briefs" && doc.type !== "master_brief") return false
    if (activeTab === "partner_briefs" && doc.type !== "partner_brief_template") return false
    if (activeTab === "requirements" && doc.type !== "requirements") return false
    return true
  })
  
  const templates = allDocuments.filter(d => d.isTemplate)
  const masterBriefs = allDocuments.filter(d => d.type === "master_brief")
  const partnerBriefs = allDocuments.filter(d => d.type === "partner_brief_template")
  const requirements = allDocuments.filter(d => d.type === "requirements")
  
  return (
    <AgencyLayout>
      <div className="p-8 max-w-6xl">
        <StageHeader
          stageNumber="◈"
          title="Master Documents"
          subtitle="Store client briefs, RFP/SOW templates, and legal documents. These will be used when generating RFPs and onboarding partners."
        />
        
        {/* Stats */}
        <div className="grid grid-cols-5 gap-4 mb-8">
          <GlassCard className="p-4 text-center">
            <div className="font-display font-bold text-3xl text-foreground">{allDocuments.length}</div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase">Total Documents</div>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <div className="font-display font-bold text-3xl text-purple-400">{masterBriefs.length}</div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase">Master Briefs</div>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <div className="font-display font-bold text-3xl text-accent">{partnerBriefs.length}</div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase">Partner Briefs</div>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <div className="font-display font-bold text-3xl text-warning">{requirements.length}</div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase">Requirements</div>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <div className="font-display font-bold text-3xl text-foreground">{templates.length}</div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase">Templates</div>
          </GlassCard>
        </div>
        
        {/* Tabs & Search */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex gap-2">
            {[
              { id: "all", label: "All Documents" },
              { id: "master_briefs", label: "Master Briefs" },
              { id: "partner_briefs", label: "Partner Briefs" },
              { id: "requirements", label: "Requirements" },
              { id: "templates", label: "Templates" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={cn(
                  "font-mono text-xs px-4 py-2 rounded-lg border transition-colors",
                  activeTab === tab.id
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-foreground-muted hover:border-white/30"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          
          <div className="flex gap-3">
            <Input
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
            />
            <Button
              onClick={() => {
                if (!checkFeatureAccess("document uploads")) return
                setUploadModalOpen(true)
              }}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              + Upload Document
            </Button>
          </div>
        </div>
        
        {/* Master Briefs Section */}
        {(activeTab === "all" || activeTab === "master_briefs") && masterBriefs.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <h3 className="font-display font-bold text-lg text-foreground">Master Briefs</h3>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 uppercase">Internal Only</span>
            </div>
            <p className="font-mono text-xs text-foreground-muted mb-4">
              Complete client briefs with all confidential details. For lead agency reference only - do not share externally.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocs.filter(d => d.type === "master_brief").map((doc) => (
                <GlassCard key={doc.id} className="group border-purple-500/20">
                  <div className="flex items-start gap-3 mb-3">
                    <div className={cn(
                      "w-12 h-12 rounded-lg flex items-center justify-center shrink-0 bg-purple-500/20"
                    )}>
                      <span className="font-mono text-xs font-bold text-purple-400">
                        {formatIcons[doc.format]}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-bold text-sm text-foreground truncate group-hover:text-purple-400 transition-colors">
                        {doc.name}
                      </div>
                      <div className="font-mono text-[10px] text-purple-400 mt-0.5">
                        {typeLabels[doc.type]}
                      </div>
                    </div>
                  </div>
                  
                  {doc.description && (
                    <p className="font-mono text-[10px] text-foreground-muted mb-3 line-clamp-2">{doc.description}</p>
                  )}
                  
                  <div className="flex items-center gap-3 text-foreground-muted mb-4">
                    <span className="font-mono text-[10px]">{doc.size}</span>
                    <span className="font-mono text-[10px]">Updated {doc.uploadedAt}</span>
                    {doc.project && <span className="font-mono text-[10px] text-accent">{doc.project}</span>}
                  </div>
                  
                  <div className="flex gap-2 pt-3 border-t border-border">
                    <Button variant="outline" size="sm" className="flex-1 text-xs border-border text-foreground hover:bg-white/5">
                      Preview
                    </Button>
                    <Button size="sm" className="flex-1 text-xs bg-purple-600 text-white hover:bg-purple-700">
                      Create Partner Brief
                    </Button>
                  </div>
                </GlassCard>
              ))}
            </div>
          </div>
        )}

        {/* Partner Briefs Section */}
        {(activeTab === "all" || activeTab === "partner_briefs") && partnerBriefs.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <h3 className="font-display font-bold text-lg text-foreground">Partner Briefs</h3>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-accent/20 text-accent uppercase">Shareable</span>
            </div>
            <p className="font-mono text-xs text-foreground-muted mb-4">
              Clean, external-facing briefs for sharing with potential partners. Confidential details redacted.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocs.filter(d => d.type === "partner_brief_template").map((doc) => (
                <GlassCard key={doc.id} className="group">
                  <div className="flex items-start gap-3 mb-3">
                    <div className={cn(
                      "w-12 h-12 rounded-lg flex items-center justify-center shrink-0 bg-accent/20"
                    )}>
                      <span className="font-mono text-xs font-bold text-accent">
                        {formatIcons[doc.format]}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-bold text-sm text-foreground truncate group-hover:text-accent transition-colors">
                        {doc.name}
                      </div>
                      <div className="font-mono text-[10px] text-accent mt-0.5">
                        {typeLabels[doc.type]}
                      </div>
                    </div>
                  </div>
                  
                  {doc.description && (
                    <p className="font-mono text-[10px] text-foreground-muted mb-3 line-clamp-2">{doc.description}</p>
                  )}
                  
                  <div className="flex items-center gap-3 text-foreground-muted mb-4">
                    <span className="font-mono text-[10px]">{doc.size}</span>
                    <span className="font-mono text-[10px]">Updated {doc.uploadedAt}</span>
                    {doc.project && <span className="font-mono text-[10px] text-accent">{doc.project}</span>}
                  </div>
                  
                  <div className="flex gap-2 pt-3 border-t border-border">
                    <Button variant="outline" size="sm" className="flex-1 text-xs border-border text-foreground hover:bg-white/5">
                      Preview
                    </Button>
                    <Button size="sm" className="flex-1 text-xs bg-accent text-accent-foreground hover:bg-accent/90">
                      Use in RFP
                    </Button>
                  </div>
                </GlassCard>
              ))}
            </div>
          </div>
        )}

        {/* Requirements Section */}
        {(activeTab === "all" || activeTab === "requirements") && requirements.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <h3 className="font-display font-bold text-lg text-foreground">Master Requirements</h3>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-warning/20 text-warning uppercase">Mandatory</span>
            </div>
            <p className="font-mono text-xs text-foreground-muted mb-4">
              Critical ways of working and compliance requirements that all partners must follow.
            </p>
            <div className="space-y-3">
              {filteredDocs.filter(d => d.type === "requirements").map((doc) => (
                <GlassCard key={doc.id} className="flex items-center gap-4 border-warning/30">
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 bg-warning/20">
                    <span className="font-mono text-xs font-bold text-warning">
                      {formatIcons[doc.format]}
                    </span>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-bold text-foreground">{doc.name}</div>
                    {doc.description && (
                      <div className="font-mono text-[10px] text-foreground-muted mt-0.5">{doc.description}</div>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      <span className="font-mono text-[10px] text-foreground-muted">{doc.size}</span>
                      <span className="font-mono text-[10px] text-foreground-muted">{doc.uploadedAt}</span>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="text-xs border-border text-foreground hover:bg-white/5">
                      Preview
                    </Button>
                    <Button variant="outline" size="sm" className="text-xs border-border text-foreground hover:bg-white/5">
                      Download
                    </Button>
                    <Button size="sm" className="text-xs bg-warning/20 text-warning hover:bg-warning/30">
                      Include in Onboarding
                    </Button>
                  </div>
                </GlassCard>
              ))}
            </div>
          </div>
        )}

        {/* Templates Section */}
        {(activeTab === "all" || activeTab === "templates") && (
          <div className="mb-8">
            <h3 className="font-display font-bold text-lg text-foreground mb-4">Your Templates</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocs.filter(d => d.isTemplate).map((doc) => (
                <GlassCard key={doc.id} className="group">
                  <div className="flex items-start gap-3 mb-3">
                    <div className={cn(
                      "w-12 h-12 rounded-lg flex items-center justify-center shrink-0",
                      doc.format === "pdf" && "bg-red-500/20",
                      doc.format === "docx" && "bg-blue-500/20",
                      doc.format === "pptx" && "bg-orange-500/20",
                      (doc.format === "gdoc" || doc.format === "gslides") && "bg-green-500/20",
                    )}>
                      <span className={cn(
                        "font-mono text-xs font-bold",
                        doc.format === "pdf" && "text-red-400",
                        doc.format === "docx" && "text-blue-400",
                        doc.format === "pptx" && "text-orange-400",
                        (doc.format === "gdoc" || doc.format === "gslides") && "text-green-400",
                      )}>
                        {formatIcons[doc.format]}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-bold text-sm text-foreground truncate group-hover:text-accent transition-colors">
                        {doc.name}
                      </div>
                      <div className="font-mono text-[10px] text-accent mt-0.5">
                        {typeLabels[doc.type]}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 text-foreground-muted">
                    <span className="font-mono text-[10px]">{doc.size}</span>
                    <span className="font-mono text-[10px]">Updated {doc.uploadedAt}</span>
                  </div>
                  
                  <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                    <Button variant="outline" size="sm" className="flex-1 text-xs border-border text-foreground hover:bg-white/5">
                      Preview
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 text-xs border-border text-foreground hover:bg-white/5">
                      Download
                    </Button>
                    <Button size="sm" className="flex-1 text-xs bg-accent/10 text-accent hover:bg-accent/20">
                      Use
                    </Button>
                  </div>
                </GlassCard>
              ))}
              
              {/* Add Template Card */}
              <GlassCard 
                className="border-dashed flex flex-col items-center justify-center min-h-[180px] cursor-pointer hover:border-accent/50 transition-colors"
                onClick={() => setUploadModalOpen(true)}
              >
                <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-3">
                  <span className="text-2xl text-accent">+</span>
                </div>
                <div className="font-display font-bold text-sm text-foreground">Add Template</div>
                <div className="font-mono text-[10px] text-foreground-muted mt-1">RFP, SOW, NDA, or MSA</div>
              </GlassCard>
            </div>
          </div>
        )}
        
        {/* Client Briefs Section */}
        {(activeTab === "all" || activeTab === "briefs") && (
          <div>
            <h3 className="font-display font-bold text-lg text-foreground mb-4">Client Briefs</h3>
            <div className="space-y-3">
              {filteredDocs.filter(d => d.type === "client_brief").map((doc) => (
                <GlassCard key={doc.id} className="flex items-center gap-4">
                  <div className={cn(
                    "w-12 h-12 rounded-lg flex items-center justify-center shrink-0",
                    doc.format === "pdf" && "bg-red-500/20",
                    doc.format === "docx" && "bg-blue-500/20",
                    doc.format === "pptx" && "bg-orange-500/20",
                    (doc.format === "gdoc" || doc.format === "gslides") && "bg-green-500/20",
                  )}>
                    <span className={cn(
                      "font-mono text-xs font-bold",
                      doc.format === "pdf" && "text-red-400",
                      doc.format === "docx" && "text-blue-400",
                      doc.format === "pptx" && "text-orange-400",
                      (doc.format === "gdoc" || doc.format === "gslides") && "text-green-400",
                    )}>
                      {formatIcons[doc.format]}
                    </span>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-bold text-foreground truncate">{doc.name}</div>
                    <div className="flex items-center gap-3 mt-1">
                      {doc.project && (
                        <span className="font-mono text-[10px] text-accent">{doc.project}</span>
                      )}
                      <span className="font-mono text-[10px] text-foreground-muted">{doc.size}</span>
                      <span className="font-mono text-[10px] text-foreground-muted">{doc.uploadedAt}</span>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="text-xs border-border text-foreground hover:bg-white/5">
                      Preview
                    </Button>
                    <Button size="sm" className="text-xs bg-accent text-accent-foreground hover:bg-accent/90">
                      Generate RFP
                    </Button>
                  </div>
                </GlassCard>
              ))}
              
              {/* Upload Brief CTA */}
              <GlassCard className="border-dashed">
                <GlassCardHeader
                  title="Upload New Client Brief"
                  description="Upload PDF, Word, PowerPoint, or paste a Google Docs/Slides link to generate a Master RFP."
                />
                <div className="grid grid-cols-5 gap-3 mt-4">
                  <Button variant="outline" className="flex-col h-auto py-4 border-border text-foreground hover:bg-white/5 hover:border-accent/50">
                    <span className="text-red-400 font-mono text-xs mb-1">PDF</span>
                    <span className="text-[10px] text-foreground-muted">Upload</span>
                  </Button>
                  <Button variant="outline" className="flex-col h-auto py-4 border-border text-foreground hover:bg-white/5 hover:border-accent/50">
                    <span className="text-blue-400 font-mono text-xs mb-1">DOCX</span>
                    <span className="text-[10px] text-foreground-muted">Upload</span>
                  </Button>
                  <Button variant="outline" className="flex-col h-auto py-4 border-border text-foreground hover:bg-white/5 hover:border-accent/50">
                    <span className="text-orange-400 font-mono text-xs mb-1">PPTX</span>
                    <span className="text-[10px] text-foreground-muted">Upload</span>
                  </Button>
                  <Button variant="outline" className="flex-col h-auto py-4 border-border text-foreground hover:bg-white/5 hover:border-accent/50">
                    <span className="text-green-400 font-mono text-xs mb-1">Google</span>
                    <span className="text-[10px] text-foreground-muted">Paste Link</span>
                  </Button>
                  <Button variant="outline" className="flex-col h-auto py-4 border-border text-foreground hover:bg-white/5 hover:border-accent/50">
                    <span className="text-accent font-mono text-xs mb-1">Text</span>
                    <span className="text-[10px] text-foreground-muted">Copy/Paste</span>
                  </Button>
                </div>
              </GlassCard>
            </div>
          </div>
        )}
        
        {/* Upload Modal */}
        {uploadModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <GlassCard className="w-full max-w-lg">
              <GlassCardHeader
                title="Upload Document"
                description="Add a new document to your library."
              />
              
              <div className="space-y-4 mt-4">
                <div>
                  <label className="font-mono text-[10px] text-foreground-muted uppercase block mb-2">
                    Document Type
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["master_brief", "partner_brief_template", "requirements", "rfp_template", "sow_template", "nda_template", "msa_template", "other"] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setUploadType(type)}
                        className={cn(
                          "font-mono text-[10px] px-3 py-2 rounded-lg border transition-colors",
                          uploadType === type
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-border text-foreground-muted hover:border-white/30"
                        )}
                      >
                        {typeLabels[type]}
                      </button>
                    ))}
                  </div>
                </div>
                
                <FileUpload
                  folder="agency-documents"
                  maxSize={50}
                  onUploadComplete={handleUploadComplete}
                  onUploadError={(error) => console.error(error)}
                  label="Drop file here or click to browse"
                  description="PDF, DOCX, PPTX up to 50MB"
                />
                
                <div className="text-center font-mono text-[10px] text-foreground-muted">or</div>
                
                <div>
                  <label className="font-mono text-[10px] text-foreground-muted uppercase block mb-2">
                    Google Docs/Slides Link
                  </label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="https://docs.google.com/..."
                      value={googleDocLink}
                      onChange={(e) => setGoogleDocLink(e.target.value)}
                      className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 flex-1"
                    />
                    <Button 
                      onClick={handleGoogleDocSubmit}
                      disabled={!googleDocLink}
                      className="bg-accent text-accent-foreground hover:bg-accent/90"
                    >
                      Add Link
                    </Button>
                  </div>
                </div>
              </div>
              
              <div className="flex gap-3 mt-6 pt-4 border-t border-border">
                <Button
                  variant="outline"
                  className="flex-1 border-border text-foreground hover:bg-white/5"
                  onClick={() => {
                    setUploadModalOpen(false)
                    setGoogleDocLink("")
                  }}
                >
                  Close
                </Button>
              </div>
            </GlassCard>
          </div>
        )}
      </div>
    </AgencyLayout>
  )
}
