"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { PartnerLayout } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import { EmptyState } from "@/components/empty-state"
import { LeadAgencyFilter } from "@/components/lead-agency-filter"
import { isVercelBlobStorageUrl } from "@/lib/vercel-blob-url"
import { useFetch } from "@/hooks/useFetch"
import { 
  Calendar, 
  Mail, 
  Phone, 
  ExternalLink, 
  FileText, 
  Shield, 
  Palette, 
  BookOpen, 
  FolderOpen, 
  User,
  Clock,
  CheckCircle,
  AlertCircle,
  Download,
  DollarSign
} from "lucide-react"

type PointPerson = {
  name: string
  role: string
  email: string
  phone: string
  calendly?: string
}

type PartnerPointPerson = {
  name: string
  role: string
  email: string
  phone: string
}

type ProjectDocument = {
  id: string
  name: string
  type: "agency" | "project"
  category: string
  url: string
  lastUpdated: string
}

type Project = {
  id: string
  name: string
  agency: string
  status: "active" | "completed"
  role: string
  startDate: string
  endDate?: string
  progress: number
  contractValue: number
  paidToDate: number
  pointPerson: PointPerson
  partnerPointPerson?: PartnerPointPerson
  documents: ProjectDocument[]
  currentPhase: {
    name: string
    week: number
    totalWeeks: number
  }
  nextMilestone?: {
    name: string
    date: string
    amount: number
  }
}

// Demo data - only shown when NEXT_PUBLIC_IS_DEMO=true
const demoProjects: Project[] = [
  {
    id: "1",
    name: "NWSL Creator Content Series",
    agency: "Electric Animal",
    status: "active",
    role: "Video Production Lead",
    startDate: "Jan 14, 2026",
    progress: 45,
    contractValue: 97000,
    paidToDate: 58200,
    pointPerson: {
      name: "Sarah Chen",
      role: "Account Director",
      email: "sarah.chen@electricanimal.com",
      phone: "+1 (555) 234-5678",
      calendly: "https://calendly.com/sarah-chen-ea"
    },
    partnerPointPerson: {
      name: "Marcus Rodriguez",
      role: "Executive Producer",
      email: "partner@demo.withligament.com",
      phone: "+1 (555) 876-5432",
    },
    documents: [
      { id: "nda", name: "Mutual NDA", type: "agency", category: "Legal", url: "#", lastUpdated: "Jan 15, 2024" },
      { id: "msa", name: "Master Service Agreement", type: "agency", category: "Legal", url: "#", lastUpdated: "Jan 15, 2024" },
      { id: "comms", name: "Communications Protocol", type: "agency", category: "Operations", url: "#", lastUpdated: "Feb 1, 2024" },
      { id: "brand", name: "NWSL Brand Guidelines", type: "project", category: "Brand", url: "#", lastUpdated: "Mar 1, 2024" },
      { id: "style", name: "Content Style Guide", type: "project", category: "Creative", url: "#", lastUpdated: "Mar 5, 2024" },
      { id: "timeline", name: "Master Production Timeline", type: "project", category: "Planning", url: "#", lastUpdated: "Mar 10, 2024" },
      { id: "assets", name: "Asset Library", type: "project", category: "Resources", url: "https://drive.google.com/drive/folders/nwsl-assets", lastUpdated: "Ongoing" },
    ],
    currentPhase: {
      name: "Production",
      week: 4,
      totalWeeks: 6
    },
    nextMilestone: {
      name: "Delivery Milestone",
      date: "Apr 15, 2026",
      amount: 29100,
    },
  },
]

type OnboardingItem = {
  id: string
  label: string
  completed: boolean
  docusignUrl?: string
  uploadUrl?: string
  type: "legal" | "document" | "task"
}

const demoOnboardingChecklist: OnboardingItem[] = [
  { id: "nda", label: "NDA signed", completed: true, docusignUrl: "https://app.docusign.com/documents/details/nda-12345", type: "legal" },
  { id: "msa", label: "MSA signed", completed: true, docusignUrl: "https://app.docusign.com/documents/details/msa-67890", type: "legal" },
  { id: "insurance", label: "Insurance COI uploaded", completed: true, uploadUrl: "#", type: "document" },
  { id: "brand", label: "Brand guidelines reviewed", completed: true, type: "task" },
  { id: "comms", label: "Communications protocol confirmed", completed: true, type: "task" },
  { id: "kickoff", label: "Kick-off call completed", completed: true, type: "task" },
]

const brandRules = [
  {
    title: "Team Presentation",
    description: "You present as part of the lead agency team for this engagement. Do not represent your own studio brand externally on this project.",
  },
  {
    title: "Communications",
    description: "All client comms must be approved by your Electric Animal lead before sending.",
  },
  {
    title: "Deliverables",
    description: "All assets must use the provided templates and follow brand guidelines. No external watermarks or branding.",
  },
]

const waysOfWorking = [
  { title: "Meeting Cadence", content: "Weekly sync every Monday at 10am PT. Ad-hoc calls as needed with 24-hour notice." },
  { title: "Communication Channels", content: "Slack for day-to-day communication. Email for formal requests and approvals. 24-hour response time expected." },
  { title: "File Management", content: "All files uploaded to shared Google Drive folder. Follow naming convention: [DATE]_[PROJECT]_[ASSET]_v[VERSION]" },
  { title: "Feedback Process", content: "Two rounds of revisions included. Additional revisions billed at day rate. 48-hour turnaround for feedback." },
]

const documentIcons: Record<string, React.ElementType> = {
  "Legal": Shield,
  "Operations": Mail,
  "Brand": Palette,
  "Creative": BookOpen,
  "Planning": Calendar,
  "Resources": FolderOpen,
}

type ProductionProjectListItem = {
  id: string
  title?: string | null
  name?: string | null
  client_name: string | null
  status: string
  agency?: { company_name?: string | null; full_name?: string | null } | null
  assignment?: { status: string }
}

export default function PartnerProjectsPage() {
  const isDemo = isDemoMode()
  const projects = isDemo ? demoProjects : []
  const onboardingChecklist = isDemo ? demoOnboardingChecklist : []
  
  const [selectedProject, setSelectedProject] = useState<Project | null>(projects[0] || null)
  const [activeTab, setActiveTab] = useState<"essentials" | "payments" | "onboarding" | "deliverables">("essentials")
  const { data: apiProjectsData, isLoading: apiLoading } = useFetch(isDemo ? "" : "/api/projects")
  const apiProjects = ((apiProjectsData as { projects?: ProductionProjectListItem[] } | undefined)?.projects || [])

  if (!isDemo) {
    return (
      <PartnerLayout>
        <div className="space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="font-display font-bold text-3xl text-[#0C3535]">Active Projects</h1>
              <p className="text-gray-600 mt-1">
                Open a project hub for contacts, onboarding, and deliverables.
              </p>
            </div>
            <LeadAgencyFilter />
          </div>

          {apiLoading ? (
            <div className="text-gray-500 font-mono text-sm py-12">Loading projects…</div>
          ) : apiProjects.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <div className="font-display font-bold text-xl text-[#0C3535] mb-2">
                No Active Projects
              </div>
              <p className="text-gray-600 mb-6">
                You don&apos;t have any project assignments yet. Check open RFPs for opportunities.
              </p>
              <Link href="/partner/rfps">
                <Button className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white">
                  View Open RFPs →
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid gap-3">
              {apiProjects.map((p) => {
                const name =
                  (p.title || p.name || "").trim() || "Untitled project"
                const agency =
                  p.agency?.company_name || p.agency?.full_name || "Lead agency"
                return (
                  <Link
                    key={p.id}
                    href={`/partner/projects/${p.id}`}
                    className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-[#0C3535]/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="font-display font-bold text-lg text-[#0C3535]">{name}</h2>
                        <p className="font-mono text-xs text-gray-500 mt-1">{agency}</p>
                        {p.client_name && (
                          <p className="text-sm text-gray-600 mt-2">Client: {p.client_name}</p>
                        )}
                      </div>
                      <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-blue-100 text-blue-700 capitalize shrink-0">
                        {p.assignment?.status?.replace("_", " ") || p.status}
                      </span>
                    </div>
                    <div className="font-mono text-xs text-[#0C3535] mt-4">View project hub →</div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </PartnerLayout>
    )
  }

  return (
    <PartnerLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display font-bold text-3xl text-[#0C3535]">Active Projects</h1>
            <p className="text-gray-600 mt-1">
              View your active engagements, project essentials, and collaboration details.
            </p>
          </div>
          <LeadAgencyFilter />
        </div>
        
        {projects.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="font-display font-bold text-xl text-[#0C3535] mb-2">
              No Active Projects
            </div>
            <p className="text-gray-600 mb-6">
              You don&apos;t have any active projects right now. Check open RFPs to find new opportunities.
            </p>
            <Link href="/partner/rfps">
              <Button className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white">
                View Open RFPs →
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Project List */}
            <div className="space-y-3">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => setSelectedProject(project)}
                  className={cn(
                    "w-full text-left p-4 rounded-xl border transition-colors",
                    selectedProject?.id === project.id
                      ? "bg-[#0C3535] text-white border-[#0C3535]"
                      : "bg-white border-gray-200 hover:border-[#0C3535]/30"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn(
                      "font-mono text-[10px] px-2 py-0.5 rounded-full capitalize",
                      selectedProject?.id === project.id
                        ? "bg-white/20 text-white"
                        : "bg-blue-100 text-blue-700"
                    )}>
                      {project.status}
                    </span>
                    <span className={cn(
                      "font-mono text-[10px]",
                      selectedProject?.id === project.id ? "text-white/60" : "text-gray-500"
                    )}>
                      {project.progress}% complete
                    </span>
                  </div>
                  <h3 className={cn(
                    "font-display font-bold",
                    selectedProject?.id === project.id ? "text-white" : "text-[#0C3535]"
                  )}>
                    {project.name}
                  </h3>
                  <div className={cn(
                    "font-mono text-[10px] mt-1",
                    selectedProject?.id === project.id ? "text-white/60" : "text-gray-500"
                  )}>
                    for {project.agency}
                  </div>
                </button>
              ))}
            </div>
            
            {/* Project Detail */}
            {selectedProject && (
              <div className="lg:col-span-2 space-y-6">
                {/* Project Header */}
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="font-display font-bold text-2xl text-[#0C3535]">
                        {selectedProject.name}
                      </h2>
                      <div className="font-mono text-xs text-gray-500 mt-1">
                        for {selectedProject.agency} | {selectedProject.role}
                      </div>
                    </div>
                    <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-blue-100 text-blue-700 capitalize">
                      {selectedProject.status}
                    </span>
                  </div>
                  
                  {/* Progress */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-gray-600">Project Progress</span>
                      <span className="font-mono text-[#0C3535]">{selectedProject.progress}%</span>
                    </div>
                    <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[#0C3535] rounded-full"
                        style={{ width: `${selectedProject.progress}%` }}
                      />
                    </div>
                  </div>
                  
                  {/* Quick Stats */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-3 rounded-lg bg-gray-50">
                      <div className="font-display font-bold text-lg text-[#0C3535]">
                        ${selectedProject.contractValue.toLocaleString()}
                      </div>
                      <div className="font-mono text-[10px] text-gray-500">Contract Value</div>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-green-50">
                      <div className="font-display font-bold text-lg text-green-600">
                        ${selectedProject.paidToDate.toLocaleString()}
                      </div>
                      <div className="font-mono text-[10px] text-green-600">Paid to Date</div>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-yellow-50">
                      <div className="font-display font-bold text-lg text-yellow-600">
                        ${selectedProject.nextMilestone?.amount.toLocaleString()}
                      </div>
                      <div className="font-mono text-[10px] text-yellow-600">Next Payment</div>
                    </div>
                  </div>
                </div>
                
                {/* Tabs */}
                <div className="flex gap-2 border-b border-gray-200">
                  {(["essentials", "payments", "onboarding", "deliverables"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={cn(
                        "px-4 py-2 font-mono text-xs capitalize transition-colors border-b-2 -mb-px",
                        activeTab === tab
                          ? "border-[#0C3535] text-[#0C3535]"
                          : "border-transparent text-gray-500 hover:text-[#0C3535]"
                      )}
                    >
                      {tab === "essentials" ? "Project Essentials" : tab === "payments" ? "Payment Schedule" : tab}
                    </button>
                  ))}
                </div>
                
                {/* Tab Content */}
                {activeTab === "essentials" && (
                  <div className="space-y-6">
                    {/* Project Essentials Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Agency Lead Point Person */}
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <div className="flex items-center gap-2 mb-4">
                          <User className="w-4 h-4 text-[#0C3535]" />
                          <span className="font-mono text-[10px] text-[#0C3535] uppercase tracking-wider">Agency Lead Contact</span>
                        </div>
                        
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-12 h-12 rounded-full bg-[#0C3535] flex items-center justify-center shrink-0">
                            <span className="font-display font-bold text-white">
                              {selectedProject.pointPerson.name.split(' ').map(n => n[0]).join('')}
                            </span>
                          </div>
                          <div>
                            <div className="font-display font-bold text-[#0C3535]">{selectedProject.pointPerson.name}</div>
                            <div className="font-mono text-[10px] text-gray-500">{selectedProject.pointPerson.role}</div>
                            <div className="font-mono text-[10px] text-gray-400">{selectedProject.agency}</div>
                          </div>
                        </div>

                        <div className="space-y-2 mb-4">
                          <a 
                            href={`mailto:${selectedProject.pointPerson.email}`}
                            className="flex items-center gap-2 text-sm text-gray-600 hover:text-[#0C3535] transition-colors"
                          >
                            <Mail className="w-3.5 h-3.5 text-gray-400" />
                            {selectedProject.pointPerson.email}
                          </a>
                          <a 
                            href={`tel:${selectedProject.pointPerson.phone}`}
                            className="flex items-center gap-2 text-sm text-gray-600 hover:text-[#0C3535] transition-colors"
                          >
                            <Phone className="w-3.5 h-3.5 text-gray-400" />
                            {selectedProject.pointPerson.phone}
                          </a>
                        </div>

                        {selectedProject.pointPerson.calendly && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full border-[#0C3535]/30 text-[#0C3535] hover:bg-[#0C3535]/5"
                            asChild
                          >
                            <a href={selectedProject.pointPerson.calendly} target="_blank" rel="noopener noreferrer">
                              <Calendar className="w-4 h-4 mr-2" />
                              Schedule a Call
                            </a>
                          </Button>
                        )}
                      </div>

                      {/* Your Point Person */}
                      {selectedProject.partnerPointPerson && (
                        <div className="bg-purple-50 rounded-xl border border-purple-200 p-5">
                          <div className="flex items-center gap-2 mb-4">
                            <User className="w-4 h-4 text-purple-600" />
                            <span className="font-mono text-[10px] text-purple-600 uppercase tracking-wider">Your Lead Contact</span>
                          </div>
                          
                          <div className="flex items-start gap-3 mb-4">
                            <div className="w-12 h-12 rounded-full bg-purple-600 flex items-center justify-center shrink-0">
                              <span className="font-display font-bold text-white">
                                {selectedProject.partnerPointPerson.name.split(' ').map(n => n[0]).join('')}
                              </span>
                            </div>
                            <div>
                              <div className="font-display font-bold text-[#0C3535]">{selectedProject.partnerPointPerson.name}</div>
                              <div className="font-mono text-[10px] text-gray-500">{selectedProject.partnerPointPerson.role}</div>
                              <div className="font-mono text-[10px] text-purple-500">Your Team</div>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <a 
                              href={`mailto:${selectedProject.partnerPointPerson.email}`}
                              className="flex items-center gap-2 text-sm text-gray-600 hover:text-purple-600 transition-colors"
                            >
                              <Mail className="w-3.5 h-3.5 text-gray-400" />
                              {selectedProject.partnerPointPerson.email}
                            </a>
                            <a 
                              href={`tel:${selectedProject.partnerPointPerson.phone}`}
                              className="flex items-center gap-2 text-sm text-gray-600 hover:text-purple-600 transition-colors"
                            >
                              <Phone className="w-3.5 h-3.5 text-gray-400" />
                              {selectedProject.partnerPointPerson.phone}
                            </a>
                          </div>
                        </div>
                      )}

                      {/* Master Timeline Quick Access */}
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <div className="flex items-center gap-2 mb-4">
                          <Calendar className="w-4 h-4 text-[#0C3535]" />
                          <span className="font-mono text-[10px] text-[#0C3535] uppercase tracking-wider">Master Timeline</span>
                        </div>
                        
                        <div className="space-y-3 mb-4">
                          <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-mono text-[10px] text-gray-500">Current Phase</span>
                              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">Active</span>
                            </div>
                            <div className="font-display font-bold text-[#0C3535]">{selectedProject.currentPhase.name}</div>
                            <div className="text-sm text-gray-600">Week {selectedProject.currentPhase.week} of {selectedProject.currentPhase.totalWeeks}</div>
                          </div>

                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">Next Milestone</span>
                            <span className="text-[#0C3535]">{selectedProject.nextMilestone?.name}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">Due Date</span>
                            <span className="text-[#0C3535] font-mono">{selectedProject.nextMilestone?.date}</span>
                          </div>
                        </div>

                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full border-gray-300 text-gray-600 hover:text-[#0C3535] hover:border-[#0C3535]/30"
                          asChild
                        >
                          <a href="#" target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Open Full Timeline
                          </a>
                        </Button>
                      </div>
                    </div>

                    {/* Project Documents */}
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <FolderOpen className="w-4 h-4 text-[#0C3535]" />
                        <span className="font-mono text-[10px] text-[#0C3535] uppercase tracking-wider">Project Documents</span>
                        <span className="font-mono text-[10px] text-gray-400 ml-auto">
                          Same materials from onboarding
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {selectedProject.documents.map((doc) => {
                          const docHref = isVercelBlobStorageUrl(doc.url)
                            ? `/api/partner/blob-download?url=${encodeURIComponent(doc.url)}`
                            : doc.url
                          const Icon = documentIcons[doc.category] || FileText
                          return (
                            <a
                              key={doc.id}
                              href={docHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-100 hover:border-gray-200 transition-colors group"
                            >
                              <div className={cn(
                                "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                                doc.type === "agency" ? "bg-purple-100" : "bg-[#0C3535]/10"
                              )}>
                                <Icon className={cn(
                                  "w-4 h-4",
                                  doc.type === "agency" ? "text-purple-600" : "text-[#0C3535]"
                                )} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm text-[#0C3535] font-medium truncate">{doc.name}</div>
                                <div className="font-mono text-[10px] text-gray-400">{doc.category}</div>
                              </div>
                              <ExternalLink className="w-3.5 h-3.5 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                            </a>
                          )
                        })}
                      </div>

                      <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
                        <span className="font-mono">{selectedProject.documents.filter(d => d.type === "agency").length} Agency docs</span>
                        <span className="font-mono">{selectedProject.documents.filter(d => d.type === "project").length} Project docs</span>
                      </div>
                    </div>
                  </div>
                )}
                
                {activeTab === "payments" && (
                  <div className="space-y-6">
                    {/* Payment Summary */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                        <div className="font-display font-bold text-2xl text-green-600">
                          ${selectedProject.paidToDate.toLocaleString()}
                        </div>
                        <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider">
                          Received
                        </div>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                        <div className="font-display font-bold text-2xl text-yellow-600">
                          ${selectedProject.nextMilestone?.amount.toLocaleString()}
                        </div>
                        <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider">
                          Next Payment
                        </div>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                        <div className="font-display font-bold text-2xl text-[#0C3535]">
                          ${(selectedProject.contractValue - selectedProject.paidToDate).toLocaleString()}
                        </div>
                        <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider">
                          Remaining
                        </div>
                      </div>
                    </div>

                    {/* Payment Schedule */}
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <div className="p-4 border-b border-gray-200">
                        <h3 className="font-display font-bold text-lg text-[#0C3535]">
                          Payment Schedule
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">
                          Payments from {selectedProject.agency} based on your agreed terms
                        </p>
                      </div>
                      
                      <table className="w-full">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="text-left font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3 px-4">
                              Milestone
                            </th>
                            <th className="text-right font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3 px-4">
                              Amount
                            </th>
                            <th className="text-left font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3 px-4">
                              Due Date
                            </th>
                            <th className="text-center font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3 px-4">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-gray-100">
                            <td className="py-3 px-4 text-sm text-[#0C3535]">Project Kick-off (20%)</td>
                            <td className="py-3 px-4 text-right font-mono text-sm text-[#0C3535]">$19,400</td>
                            <td className="py-3 px-4 font-mono text-xs text-gray-500">Jan 15, 2026</td>
                            <td className="py-3 px-4 text-center">
                              <span className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                                Received
                              </span>
                            </td>
                          </tr>
                          <tr className="border-b border-gray-100">
                            <td className="py-3 px-4 text-sm text-[#0C3535]">Mid-point Delivery (40%)</td>
                            <td className="py-3 px-4 text-right font-mono text-sm text-[#0C3535]">$38,800</td>
                            <td className="py-3 px-4 font-mono text-xs text-gray-500">Mar 1, 2026</td>
                            <td className="py-3 px-4 text-center">
                              <span className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                                Received
                              </span>
                            </td>
                          </tr>
                          <tr className="border-b border-gray-100">
                            <td className="py-3 px-4 text-sm text-[#0C3535]">Final Delivery (30%)</td>
                            <td className="py-3 px-4 text-right font-mono text-sm text-[#0C3535]">$29,100</td>
                            <td className="py-3 px-4 font-mono text-xs text-gray-500">Apr 15, 2026</td>
                            <td className="py-3 px-4 text-center">
                              <span className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 border border-yellow-200">
                                Scheduled
                              </span>
                            </td>
                          </tr>
                          <tr className="border-b border-gray-100 last:border-0">
                            <td className="py-3 px-4 text-sm text-[#0C3535]">Project Closeout (10%)</td>
                            <td className="py-3 px-4 text-right font-mono text-sm text-[#0C3535]">$9,700</td>
                            <td className="py-3 px-4 font-mono text-xs text-gray-500">Jun 1, 2026</td>
                            <td className="py-3 px-4 text-center">
                              <span className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                                Upcoming
                              </span>
                            </td>
                          </tr>
                        </tbody>
                        <tfoot>
                          <tr className="bg-[#0C3535]/5">
                            <td className="py-3 px-4 font-display font-bold text-sm text-[#0C3535]">Total</td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-sm text-[#0C3535]">$97,000</td>
                            <td className="py-3 px-4"></td>
                            <td className="py-3 px-4"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Next Payment Highlight */}
                    <div className="bg-[#0C3535] rounded-xl p-6 text-white">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-mono text-[10px] text-white/60 uppercase tracking-wider mb-1">
                            Next Scheduled Payment
                          </div>
                          <div className="font-display font-bold text-2xl">
                            ${selectedProject.nextMilestone?.amount.toLocaleString()}
                          </div>
                          <div className="font-mono text-sm text-white/80 mt-1">
                            {selectedProject.nextMilestone?.name}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-[10px] text-white/60 uppercase tracking-wider mb-1">
                            Expected Date
                          </div>
                          <div className="font-display font-bold text-xl">
                            {selectedProject.nextMilestone?.date}
                          </div>
                          <div className="font-mono text-xs text-white/60 mt-1">
                            Net 30 terms
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Payment Info */}
                    <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
                      <div className="flex items-start gap-3">
                        <DollarSign className="w-5 h-5 text-blue-600 mt-0.5" />
                        <div>
                          <div className="font-display font-bold text-sm text-blue-900">
                            Payment Processing
                          </div>
                          <p className="text-sm text-blue-700 mt-1">
                            Payments are processed via ACH to your registered bank account. 
                            Ensure your payment details are up to date in your profile settings.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "onboarding" && (
                  <div className="space-y-6">
                    {/* Checklist */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-display font-bold text-lg text-[#0C3535]">
                          Onboarding Checklist
                        </h3>
                        <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-green-100 text-green-700">
                          <CheckCircle className="w-3 h-3 inline mr-1" />
                          Complete
                        </span>
                      </div>
                      <div className="space-y-3">
                        {onboardingChecklist.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-200"
                          >
                            <Checkbox
                              checked={item.completed}
                              className="data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                            />
                            <span className="text-sm text-[#0C3535] flex-1">{item.label}</span>
                            {item.type === "legal" && item.docusignUrl && (
                              <a
                                href={item.docusignUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2 py-1 rounded bg-blue-100 text-blue-700 font-mono text-[10px] hover:bg-blue-200 transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                                View in DocuSign
                              </a>
                            )}
                            <span className="font-mono text-[10px] text-green-600">Complete</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* Brand Rules */}
                    <div className="bg-[#0C3535]/5 rounded-xl border border-[#0C3535]/20 p-6">
                      <h3 className="font-display font-bold text-lg text-[#0C3535] mb-4">
                        Brand & Identity Rules
                      </h3>
                      <div className="space-y-3">
                        {brandRules.map((rule, i) => (
                          <div key={i} className="p-4 rounded-lg bg-white border border-[#0C3535]/10">
                            <div className="font-mono text-[10px] text-[#0C3535]/60 uppercase tracking-wider mb-1">
                              Rule #{i + 1} — {rule.title}
                            </div>
                            <p className="text-sm text-[#0C3535]">{rule.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* Ways of Working */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                      <h3 className="font-display font-bold text-lg text-[#0C3535] mb-4">
                        Ways of Working
                      </h3>
                      <Accordion type="single" collapsible className="w-full">
                        {waysOfWorking.map((item, i) => (
                          <AccordionItem key={i} value={`item-${i}`}>
                            <AccordionTrigger className="text-sm text-[#0C3535]">
                              {item.title}
                            </AccordionTrigger>
                            <AccordionContent className="text-sm text-gray-600">
                              {item.content}
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </div>
                  </div>
                )}
                
                {activeTab === "deliverables" && (
                  <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <h3 className="font-display font-bold text-lg text-[#0C3535] mb-4">
                      Deliverables
                    </h3>
                    <p className="text-sm text-gray-600 mb-6">
                      Deliverable tracking and submission syncs with your lead agency&apos;s project management tools.
                    </p>
                    
                    {/* Quick Links */}
                    <div className="grid grid-cols-2 gap-3 mb-6">
                      {[
                        { name: "Slack Channel", icon: "#", href: "#" },
                        { name: "Google Drive", icon: FolderOpen, href: "#" },
                        { name: "Project Brief", icon: FileText, href: "#" },
                        { name: "Submit Deliverable", icon: Download, href: "#" },
                      ].map((link) => {
                        const Icon = typeof link.icon === "string" ? null : link.icon
                        return (
                          <a
                            key={link.name}
                            href={link.href}
                            className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:border-[#0C3535]/30 transition-colors"
                          >
                            {Icon ? (
                              <Icon className="w-5 h-5 text-[#0C3535]" />
                            ) : (
                              <span className="text-lg">{link.icon}</span>
                            )}
                            <span className="font-mono text-xs text-[#0C3535]">{link.name}</span>
                          </a>
                        )
                      })}
                    </div>
                    
                    <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="w-4 h-4 text-yellow-600" />
                        <span className="font-mono text-sm text-yellow-700">Next Deliverable Due</span>
                      </div>
                      <div className="font-display font-bold text-[#0C3535]">First Cut Review</div>
                      <div className="font-mono text-xs text-gray-600">Due: Apr 15, 2026</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </PartnerLayout>
  )
}
