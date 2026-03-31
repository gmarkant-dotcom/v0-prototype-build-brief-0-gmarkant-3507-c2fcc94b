"use client"

import { StageHeader } from "@/components/stage-header"
import { EngagementContext } from "@/components/engagement-context"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Calendar, FileText, Link2, User, Mail, Phone, ExternalLink, FolderOpen, Clock, FileCheck, Shield, Palette, BookOpen } from "lucide-react"
import { usePaidUser } from "@/contexts/paid-user-context"
import { isDemoMode } from "@/lib/demo-data"
import { EmptyState } from "@/components/empty-state"
import { isVercelBlobStorageUrl } from "@/lib/vercel-blob-url"

interface VendorStatus {
  id: string
  name: string
  discipline: string
  contracted: string
  utilized: number
  status: "on-track" | "at-risk" | "complete"
  tools: {
    asana: string
    drive: string
    slack: string
  }
  paymentTerms: {
    type: "fixed" | "hourly" | "retainer" | "milestone"
    rate?: string
    netTerms: number
    schedule: { milestone: string; amount: number; timing: string; status: "paid" | "due" | "upcoming" }[]
  }
}

interface PointPerson {
  name: string
  role: string
  email: string
  phone: string
  calendly: string
}

interface ProjectDocument {
  id: string
  name: string
  type: "agency" | "project"
  category: string
  url: string
  lastUpdated: string
  icon: React.ElementType
}

const leadPointPerson: PointPerson = {
  name: "Sarah Chen",
  role: "Account Director",
  email: "sarah.chen@electricanimal.com",
  phone: "+1 (555) 234-5678",
  calendly: "https://calendly.com/sarah-chen-ea"
}

const projectDocuments: ProjectDocument[] = [
  // Agency Documents
  { id: "nda", name: "Mutual NDA", type: "agency", category: "Legal", url: "#", lastUpdated: "Jan 15, 2024", icon: Shield },
  { id: "msa", name: "Master Service Agreement", type: "agency", category: "Legal", url: "#", lastUpdated: "Jan 15, 2024", icon: FileCheck },
  { id: "comms", name: "Communications Protocol", type: "agency", category: "Operations", url: "#", lastUpdated: "Feb 1, 2024", icon: Mail },
  // Project Documents  
  { id: "brand", name: "NWSL Brand Guidelines", type: "project", category: "Brand", url: "#", lastUpdated: "Mar 1, 2024", icon: Palette },
  { id: "style", name: "Content Style Guide", type: "project", category: "Creative", url: "#", lastUpdated: "Mar 5, 2024", icon: BookOpen },
  { id: "timeline", name: "Master Production Timeline", type: "project", category: "Planning", url: "#", lastUpdated: "Mar 10, 2024", icon: Calendar },
  { id: "assets", name: "Asset Library", type: "project", category: "Resources", url: "https://drive.google.com/drive/folders/nwsl-assets", lastUpdated: "Ongoing", icon: FolderOpen },
]

const vendors: VendorStatus[] = [
  {
    id: "1",
    name: "Fieldhouse Films",
    discipline: "Video Production",
    contracted: "$97,000",
    utilized: 42,
    status: "on-track",
    tools: {
      asana: "https://app.asana.com",
      drive: "https://drive.google.com",
      slack: "https://slack.com",
    },
    paymentTerms: {
      type: "milestone",
      netTerms: 30,
      schedule: [
        { milestone: "Contract Signing (25%)", amount: 24250, timing: "Mar 15", status: "paid" },
        { milestone: "Production Complete (40%)", amount: 38800, timing: "Week 8", status: "upcoming" },
        { milestone: "Final Delivery (35%)", amount: 33950, timing: "Week 12", status: "upcoming" }
      ]
    }
  },
  {
    id: "2",
    name: "Tandem Social",
    discipline: "Social Media",
    contracted: "$48,000",
    utilized: 65,
    status: "on-track",
    tools: {
      asana: "https://app.asana.com",
      drive: "https://drive.google.com",
      slack: "https://slack.com",
    },
    paymentTerms: {
      type: "retainer",
      rate: "$8,000/month",
      netTerms: 15,
      schedule: [
        { milestone: "Month 1", amount: 8000, timing: "Mar 1", status: "paid" },
        { milestone: "Month 2", amount: 8000, timing: "Apr 1", status: "paid" },
        { milestone: "Month 3", amount: 8000, timing: "May 1", status: "paid" },
        { milestone: "Month 4", amount: 8000, timing: "Jun 1", status: "due" },
        { milestone: "Month 5", amount: 8000, timing: "Jul 1", status: "upcoming" },
        { milestone: "Month 6", amount: 8000, timing: "Aug 1", status: "upcoming" }
      ]
    }
  },
  {
    id: "3",
    name: "Roster Agency",
    discipline: "Talent Relations",
    contracted: "$40,000",
    utilized: 28,
    status: "at-risk",
    tools: {
      asana: "https://app.asana.com",
      drive: "https://drive.google.com",
      slack: "https://slack.com",
    },
    paymentTerms: {
      type: "hourly",
      rate: "$150/hour",
      netTerms: 30,
      schedule: [
        { milestone: "Deposit (20%)", amount: 8000, timing: "Mar 10", status: "paid" },
        { milestone: "Monthly billing", amount: 32000, timing: "Billed monthly", status: "upcoming" }
      ]
    }
  },
]

const getStatusStyle = (status: VendorStatus["status"]) => {
  switch (status) {
    case "on-track":
      return "bg-green-500/10 text-green-400 border-green-500/30"
    case "at-risk":
      return "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
    case "complete":
      return "bg-accent/10 text-accent border-accent/30"
  }
}

const getUtilizationColor = (percent: number) => {
  if (percent >= 80) return "bg-yellow-500"
  if (percent >= 50) return "bg-green-500"
  return "bg-accent"
}

export function Stage04Dashboard() {
  const isDemo = isDemoMode()
  
  if (!isDemo) {
    return (
      <div className="p-8 max-w-6xl">
        <StageHeader
          stageNumber="04"
          title="Project Dashboard"
          subtitle="High-level command view linking to your existing PM tools. LIGAMENT is not a project management platform — it's the layer above."
          aiPowered={false}
        />
        <EmptyState
          title="No Active Projects"
          description="When you award vendors and begin project work, your dashboard will appear here with links to your PM tools."
          icon="project"
        />
      </div>
    )
  }
  
  return (
    <div className="p-8 max-w-6xl">
      <StageHeader
        stageNumber="04"
        title="Project Dashboard"
        subtitle="High-level command view linking to your existing PM tools. LIGAMENT is not a project management platform — it's the layer above."
        aiPowered={false}
      />
      
      <EngagementContext
        agency="Electric Animal"
        project="NWSL Creator Content Series"
        budget="$250K"
        className="mb-8"
      />
      
      {/* Important Notice */}
      <div className="mb-6 p-4 rounded-lg border border-accent/30 bg-accent/5">
        <div className="flex items-start gap-3">
          <span className="text-accent text-lg">◈</span>
          <div>
            <div className="font-display font-bold text-foreground mb-1">
              Command View Only
            </div>
            <p className="text-sm text-foreground-muted">
              Dashboard links to your existing PM tools — LIGAMENT does not replace them. 
              Use Asana, Smartsheet, or your preferred tool for day-to-day task management.
            </p>
          </div>
        </div>
      </div>

      {/* Project Essentials Section */}
      <div className="mb-8">
        <GlassCardHeader className="mb-4">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-accent" />
            <span>Project Essentials</span>
          </div>
        </GlassCardHeader>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Lead Point Person */}
          <GlassCard className="lg:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <User className="w-4 h-4 text-accent" />
              <span className="font-mono text-[10px] text-accent uppercase tracking-wider">Lead Point Person</span>
            </div>
            
            <div className="flex items-start gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                <span className="font-display font-bold text-accent">
                  {leadPointPerson.name.split(' ').map(n => n[0]).join('')}
                </span>
              </div>
              <div>
                <div className="font-display font-bold text-foreground">{leadPointPerson.name}</div>
                <div className="font-mono text-[10px] text-foreground-muted">{leadPointPerson.role}</div>
              </div>
            </div>

            <div className="space-y-2 mb-4">
              <a 
                href={`mailto:${leadPointPerson.email}`}
                className="flex items-center gap-2 text-sm text-foreground-secondary hover:text-accent transition-colors"
              >
                <Mail className="w-3.5 h-3.5 text-foreground-muted" />
                {leadPointPerson.email}
              </a>
              <a 
                href={`tel:${leadPointPerson.phone}`}
                className="flex items-center gap-2 text-sm text-foreground-secondary hover:text-accent transition-colors"
              >
                <Phone className="w-3.5 h-3.5 text-foreground-muted" />
                {leadPointPerson.phone}
              </a>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full border-accent/30 text-accent hover:bg-accent/10"
              asChild
            >
              <a href={leadPointPerson.calendly} target="_blank" rel="noopener noreferrer">
                <Calendar className="w-4 h-4 mr-2" />
                Schedule a Call
              </a>
            </Button>
          </GlassCard>

          {/* Master Timeline Quick Access */}
          <GlassCard className="lg:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-4 h-4 text-accent" />
              <span className="font-mono text-[10px] text-accent uppercase tracking-wider">Master Timeline</span>
            </div>
            
            <div className="space-y-3 mb-4">
              <div className="p-3 bg-white/5 rounded-lg border border-border/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-[10px] text-foreground-muted">Current Phase</span>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/30">Active</span>
                </div>
                <div className="font-display font-bold text-foreground">Production</div>
                <div className="text-sm text-foreground-muted">Week 4 of 6</div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-muted">Next Milestone</span>
                <span className="text-foreground">First Cut Review</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-muted">Due Date</span>
                <span className="text-foreground font-mono">Apr 15, 2024</span>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full border-border/50 text-foreground-muted hover:text-foreground hover:border-white/30"
              asChild
            >
              <a href="#" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open Full Timeline
              </a>
            </Button>
          </GlassCard>

          {/* Project Documents */}
          <GlassCard className="lg:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <FolderOpen className="w-4 h-4 text-accent" />
              <span className="font-mono text-[10px] text-accent uppercase tracking-wider">Project Documents</span>
            </div>

            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2">
              {projectDocuments.map((doc) => {
                const docHref = isVercelBlobStorageUrl(doc.url)
                  ? `/api/agency/blob-download?url=${encodeURIComponent(doc.url)}`
                  : doc.url
                const Icon = doc.icon
                return (
                  <a
                    key={doc.id}
                    href={docHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-transparent hover:border-border/30 transition-colors group"
                  >
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                      doc.type === "agency" ? "bg-purple-500/10" : "bg-accent/10"
                    )}>
                      <Icon className={cn(
                        "w-4 h-4",
                        doc.type === "agency" ? "text-purple-400" : "text-accent"
                      )} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-foreground truncate">{doc.name}</div>
                      <div className="font-mono text-[10px] text-foreground-muted">{doc.category}</div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-foreground-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </a>
                )
              })}
            </div>

            <div className="mt-3 pt-3 border-t border-border/30">
              <div className="flex items-center justify-between text-[10px] text-foreground-muted">
                <span className="font-mono">{projectDocuments.filter(d => d.type === "agency").length} Agency docs</span>
                <span className="font-mono">{projectDocuments.filter(d => d.type === "project").length} Project docs</span>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>
      
      {/* Vendor Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {vendors.map((vendor) => (
          <GlassCard key={vendor.id}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="font-display font-bold text-lg text-foreground">
                  {vendor.name}
                </div>
                <div className="font-mono text-[10px] text-accent">
                  {vendor.discipline}
                </div>
              </div>
              <span className={cn(
                "font-mono text-[10px] px-2 py-0.5 rounded-full border capitalize",
                getStatusStyle(vendor.status)
              )}>
                {vendor.status.replace("-", " ")}
              </span>
            </div>
            
            <div className="space-y-3 mb-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-foreground-muted">Contracted</span>
                <span className="font-mono text-foreground">{vendor.contracted}</span>
              </div>
              
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm text-foreground-muted">Utilized</span>
                  <span className="font-mono text-sm text-foreground">{vendor.utilized}%</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className={cn("h-full rounded-full transition-all", getUtilizationColor(vendor.utilized))}
                    style={{ width: `${vendor.utilized}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Payment Terms */}
            <div className="mb-4 p-3 bg-white/5 rounded-lg border border-border/30">
              <div className="flex items-center justify-between mb-2">
                <span className={cn(
                  "font-mono text-[9px] px-2 py-0.5 rounded-full border capitalize",
                  vendor.paymentTerms.type === "fixed" && "bg-blue-500/10 text-blue-400 border-blue-500/30",
                  vendor.paymentTerms.type === "hourly" && "bg-purple-500/10 text-purple-400 border-purple-500/30",
                  vendor.paymentTerms.type === "retainer" && "bg-green-500/10 text-green-400 border-green-500/30",
                  vendor.paymentTerms.type === "milestone" && "bg-accent/10 text-accent border-accent/30"
                )}>
                  {vendor.paymentTerms.type}
                  {vendor.paymentTerms.rate && ` — ${vendor.paymentTerms.rate}`}
                </span>
                <span className="font-mono text-[9px] text-foreground-muted">
                  Net {vendor.paymentTerms.netTerms}
                </span>
              </div>
              <div className="space-y-1">
                {vendor.paymentTerms.schedule.slice(0, 3).map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className="text-foreground-muted truncate mr-2">{item.milestone}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-foreground">${item.amount.toLocaleString()}</span>
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[8px] font-mono",
                        item.status === "paid" && "bg-green-500/10 text-green-400",
                        item.status === "due" && "bg-yellow-500/10 text-yellow-400",
                        item.status === "upcoming" && "bg-white/10 text-foreground-muted"
                      )}>
                        {item.status}
                      </span>
                    </div>
                  </div>
                ))}
                {vendor.paymentTerms.schedule.length > 3 && (
                  <div className="text-[10px] text-foreground-muted text-center">
                    +{vendor.paymentTerms.schedule.length - 3} more payments
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 font-mono text-[10px] border-border text-foreground-muted hover:text-foreground hover:border-white/30 bg-transparent"
                asChild
              >
                <a href={vendor.tools.asana} target="_blank" rel="noopener noreferrer">
                  Asana
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 font-mono text-[10px] border-border text-foreground-muted hover:text-foreground hover:border-white/30 bg-transparent"
                asChild
              >
                <a href={vendor.tools.drive} target="_blank" rel="noopener noreferrer">
                  Drive
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 font-mono text-[10px] border-border text-foreground-muted hover:text-foreground hover:border-white/30 bg-transparent"
                asChild
              >
                <a href={vendor.tools.slack} target="_blank" rel="noopener noreferrer">
                  Slack
                </a>
              </Button>
            </div>
          </GlassCard>
        ))}
      </div>
      
      {/* Protected Margin */}
      <GlassCard highlight>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="font-mono text-[10px] text-accent uppercase tracking-wider mb-1">
              Protected Margin
            </div>
            <div className="font-display font-black text-3xl text-accent">
              $65,000
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm text-foreground-muted">
              26% of $250K client budget
            </div>
            <div className="font-mono text-xs text-foreground-muted/50 mt-1">
              Total vendor spend: $185,000
            </div>
          </div>
        </div>
      </GlassCard>
      
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        {[
          { label: "Active Vendors", value: "3" },
          { label: "Total Contracted", value: "$185K" },
          { label: "Avg. Utilization", value: "45%" },
          { label: "Project Duration", value: "6 months" },
        ].map((stat) => (
          <GlassCard key={stat.label} className="text-center py-4">
            <div className="font-display font-bold text-2xl text-foreground mb-1">
              {stat.value}
            </div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">
              {stat.label}
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  )
}
