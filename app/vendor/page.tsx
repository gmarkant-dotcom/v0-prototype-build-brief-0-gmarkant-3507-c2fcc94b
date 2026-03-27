"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

type Tab = "rfps" | "onboarding" | "payments" | "documents"

const tabs: { id: Tab; label: string }[] = [
  { id: "rfps", label: "Open RFPs" },
  { id: "onboarding", label: "Onboarding" },
  { id: "payments", label: "Payments" },
  { id: "documents", label: "Documents" },
]

function VendorHeader() {
  return (
    <header className="bg-[#0C3535] text-white">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="font-display font-black text-2xl text-white">LIGAMENT</div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="font-display font-bold text-sm">Fieldhouse Films</div>
            <div className="font-mono text-[10px] text-white/60">Active Partner</div>
          </div>
          <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
            <span className="font-mono text-xs text-accent">FF</span>
          </div>
        </div>
      </div>
    </header>
  )
}

function OpenRFPsTab() {
  const [bidSubmitted, setBidSubmitted] = useState(false)
  const [approach, setApproach] = useState("")
  const [team, setTeam] = useState("")
  const [timeline, setTimeline] = useState("")
  const [budget, setBudget] = useState("")
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setBidSubmitted(true)
  }
  
  if (bidSubmitted) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <span className="text-green-600 text-2xl">✓</span>
        </div>
        <h3 className="font-display font-bold text-xl text-[#0C3535] mb-2">
          Bid Submitted Successfully
        </h3>
        <p className="text-gray-600 text-sm max-w-md mx-auto">
          Your bid has been received. The LIGAMENT team will review and respond within 5 business days.
        </p>
      </div>
    )
  }
  
  return (
    <div className="space-y-6">
      {/* RFP Card */}
      <div className="border border-gray-200 rounded-xl p-6 bg-white">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="font-mono text-[10px] text-[#0C3535]/60 uppercase tracking-wider mb-1">
              Open RFP
            </div>
            <h3 className="font-display font-bold text-xl text-[#0C3535]">
              Video Production Partner — Sports Creator Series
            </h3>
          </div>
          <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-yellow-100 text-yellow-700 border border-yellow-200">
            Due in 8 days
          </span>
        </div>
        
        {/* Notice Banner */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-yellow-800">
            <strong>Notice:</strong> This RFP is issued by LIGAMENT on behalf of a brand client. Client identity will be shared with shortlisted vendors. Please do not share externally.
          </p>
        </div>
        
        {/* RFP Content */}
        <div className="space-y-4 mb-8">
          <div>
            <h4 className="font-display font-bold text-sm text-[#0C3535] mb-2">1. Overview</h4>
            <p className="text-sm text-gray-600 leading-relaxed">
              A boutique creative agency is seeking a video production partner for a 6-month documentary-style creator content program centered on women&apos;s professional soccer.
            </p>
          </div>
          
          <div>
            <h4 className="font-display font-bold text-sm text-[#0C3535] mb-2">2. Scope of Work</h4>
            <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
              <li>Pre-production planning and creative development</li>
              <li>On-location production for 8-12 shoot days</li>
              <li>Post-production including editing, color, and sound</li>
              <li>Delivery of assets optimized for social platforms</li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-display font-bold text-sm text-[#0C3535] mb-2">3. Team Requirements</h4>
            <p className="text-sm text-gray-600 leading-relaxed">
              Dedicated producer and director, DP with sports/documentary experience, editor with quick turnaround capability.
            </p>
          </div>
          
          <div>
            <h4 className="font-display font-bold text-sm text-[#0C3535] mb-2">4. Timeline</h4>
            <p className="text-sm text-gray-600 leading-relaxed">
              Program duration: 6 months. First deliverables due within 6 weeks of kickoff.
            </p>
          </div>
          
          <div>
            <h4 className="font-display font-bold text-sm text-[#0C3535] mb-2">5. Budget</h4>
            <p className="text-sm text-gray-600 leading-relaxed">
              Budget range will be shared with shortlisted vendors. Please provide your proposed budget based on scope understanding.
            </p>
          </div>
        </div>
        
        {/* Bid Form */}
        <form onSubmit={handleSubmit} className="border-t border-gray-200 pt-6">
          <h4 className="font-display font-bold text-lg text-[#0C3535] mb-4">Submit Your Bid</h4>
          
          <div className="space-y-4">
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Your Approach
              </label>
              <Textarea
                value={approach}
                onChange={(e) => setApproach(e.target.value)}
                placeholder="Describe your creative approach and how you would tackle this project..."
                className="min-h-[100px] border-gray-200"
                required
              />
            </div>
            
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Proposed Team
              </label>
              <Textarea
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                placeholder="List key team members and their relevant experience..."
                className="min-h-[80px] border-gray-200"
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                  Timeline Proposal
                </label>
                <Textarea
                  value={timeline}
                  onChange={(e) => setTimeline(e.target.value)}
                  placeholder="Your proposed timeline and milestones..."
                  className="min-h-[80px] border-gray-200"
                  required
                />
              </div>
              
              <div>
                <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                  Budget Proposal
                </label>
                <Input
                  type="text"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="$XX,XXX"
                  className="border-gray-200"
                  required
                />
                <p className="text-xs text-gray-400 mt-1">All-in budget for scope described</p>
              </div>
            </div>
            
            <Button
              type="submit"
              className="w-full bg-[#0C3535] hover:bg-[#0C3535]/90 text-white font-display font-bold"
            >
              Submit Bid
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function OnboardingTab() {
  const checklistItems = [
    { id: "nda", label: "NDA signed", completed: true },
    { id: "insurance", label: "Insurance COI uploaded", completed: true },
    { id: "brand", label: "Brand guidelines reviewed", completed: false },
    { id: "comms", label: "Communications protocol confirmed", completed: false },
    { id: "kickoff", label: "Kick-off call scheduled", completed: false },
  ]
  
  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="border border-gray-200 rounded-xl p-6 bg-white">
        <h3 className="font-display font-bold text-xl text-[#0C3535] mb-2">
          Welcome to the Team
        </h3>
        <p className="text-sm text-gray-600 leading-relaxed">
          Congratulations on being selected for the NWSL Creator Content Series. Complete the checklist below to finalize your onboarding.
        </p>
      </div>
      
      {/* Checklist */}
      <div className="border border-gray-200 rounded-xl p-6 bg-white">
        <h4 className="font-display font-bold text-lg text-[#0C3535] mb-4">
          Onboarding Checklist
        </h4>
        
        <div className="space-y-3">
          {checklistItems.map((item) => (
            <div
              key={item.id}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                item.completed
                  ? "bg-green-50 border-green-200"
                  : "bg-gray-50 border-gray-200"
              )}
            >
              <Checkbox
                checked={item.completed}
                className="data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
              />
              <span className={cn(
                "text-sm",
                item.completed ? "text-gray-500" : "text-[#0C3535]"
              )}>
                {item.label}
              </span>
              {item.completed && (
                <span className="ml-auto font-mono text-[10px] text-green-600">
                  Complete
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      
      {/* Brand Rules */}
      <div className="border border-[#0C3535]/20 rounded-xl p-6 bg-[#0C3535]/5">
        <h4 className="font-display font-bold text-lg text-[#0C3535] mb-4">
          Brand & Identity Rules
        </h4>
        
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-white border border-[#0C3535]/10">
            <div className="font-mono text-[10px] text-[#0C3535]/60 uppercase tracking-wider mb-2">
              Rule #1 — Team Presentation
            </div>
            <p className="text-sm text-[#0C3535] leading-relaxed">
              You present as part of the LIGAMENT team for this engagement. You do not represent your company externally on this project.
            </p>
          </div>
          
          <div className="p-4 rounded-lg bg-white border border-[#0C3535]/10">
            <div className="font-mono text-[10px] text-[#0C3535]/60 uppercase tracking-wider mb-2">
              Rule #2 — Communications
            </div>
            <p className="text-sm text-[#0C3535] leading-relaxed">
              All client comms must be approved by your LIGAMENT lead before sending.
            </p>
          </div>
        </div>
      </div>
      
      {/* Ways of Working */}
      <div className="border border-gray-200 rounded-xl p-6 bg-white">
        <h4 className="font-display font-bold text-lg text-[#0C3535] mb-4">
          Ways of Working
        </h4>
        
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="meetings">
            <AccordionTrigger className="text-sm text-[#0C3535]">Meeting Cadence</AccordionTrigger>
            <AccordionContent className="text-sm text-gray-600">
              Weekly sync every Monday at 10am PT. Ad-hoc calls as needed with 24-hour notice.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="comms">
            <AccordionTrigger className="text-sm text-[#0C3535]">Communication Channels</AccordionTrigger>
            <AccordionContent className="text-sm text-gray-600">
              Slack for day-to-day communication. Email for formal requests and approvals. 24-hour response time expected.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="files">
            <AccordionTrigger className="text-sm text-[#0C3535]">File Management</AccordionTrigger>
            <AccordionContent className="text-sm text-gray-600">
              All files uploaded to shared Google Drive folder. Follow naming convention: [DATE]_[PROJECT]_[ASSET]_v[VERSION]
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  )
}

function PaymentsTab() {
  const payments = [
    { milestone: "Kick-off", amount: 19400, status: "paid" as const, date: "Jan 14, 2026" },
    { milestone: "Mid-point", amount: 38800, status: "paid" as const, date: "Feb 28, 2026" },
    { milestone: "Delivery", amount: 29100, status: "pending" as const, date: "Apr 15, 2026" },
    { milestone: "Final", amount: 9700, status: "upcoming" as const, date: "Jun 1, 2026" },
  ]
  
  const totalContract = 97000
  const totalPaid = payments.filter(p => p.status === "paid").reduce((sum, p) => sum + p.amount, 0)
  
  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border border-gray-200 rounded-xl p-6 bg-white text-center">
          <div className="font-display font-bold text-3xl text-[#0C3535]">
            ${totalContract.toLocaleString()}
          </div>
          <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider mt-1">
            Total Contract
          </div>
        </div>
        <div className="border border-green-200 rounded-xl p-6 bg-green-50 text-center">
          <div className="font-display font-bold text-3xl text-green-600">
            ${totalPaid.toLocaleString()}
          </div>
          <div className="font-mono text-[10px] text-green-600 uppercase tracking-wider mt-1">
            Paid to Date
          </div>
        </div>
      </div>
      
      {/* Payment Schedule */}
      <div className="border border-gray-200 rounded-xl p-6 bg-white">
        <h4 className="font-display font-bold text-lg text-[#0C3535] mb-4">
          Milestone Payments
        </h4>
        
        <div className="space-y-3">
          {payments.map((payment) => (
            <div
              key={payment.milestone}
              className={cn(
                "flex items-center justify-between p-4 rounded-lg border",
                payment.status === "paid" && "bg-green-50 border-green-200",
                payment.status === "pending" && "bg-yellow-50 border-yellow-200",
                payment.status === "upcoming" && "bg-gray-50 border-gray-200"
              )}
            >
              <div>
                <div className="font-display font-bold text-sm text-[#0C3535]">
                  {payment.milestone}
                </div>
                <div className="font-mono text-[10px] text-gray-500">
                  {payment.date}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-lg text-[#0C3535]">
                  ${payment.amount.toLocaleString()}
                </div>
                <span className={cn(
                  "font-mono text-[10px] px-2 py-0.5 rounded-full capitalize",
                  payment.status === "paid" && "bg-green-100 text-green-700",
                  payment.status === "pending" && "bg-yellow-100 text-yellow-700",
                  payment.status === "upcoming" && "bg-gray-100 text-gray-600"
                )}>
                  {payment.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Invoice History */}
      <div className="border border-gray-200 rounded-xl p-6 bg-white">
        <h4 className="font-display font-bold text-lg text-[#0C3535] mb-4">
          Invoice History
        </h4>
        
        <div className="space-y-2">
          {[
            { id: "INV-001", date: "Jan 14, 2026", amount: 19400 },
            { id: "INV-002", date: "Feb 28, 2026", amount: 38800 },
          ].map((invoice) => (
            <div
              key={invoice.id}
              className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-200"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-gray-500">{invoice.id}</span>
                <span className="text-sm text-[#0C3535]">{invoice.date}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-[#0C3535]">
                  ${invoice.amount.toLocaleString()}
                </span>
                <Button variant="ghost" size="sm" className="text-[#0C3535] hover:text-[#0C3535]/80">
                  Download
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DocumentsTab() {
  const documents = [
    { name: "Master Services Agreement", type: "PDF", status: "Signed", date: "Jan 10, 2026" },
    { name: "Brand Standards Guide", type: "PDF", status: "Active", date: "Jan 12, 2026" },
    { name: "Production Brief", type: "PDF", status: "Active", date: "Jan 15, 2026" },
    { name: "Project Timeline", type: "PDF", status: "Active", date: "Jan 15, 2026" },
    { name: "Non-Disclosure Agreement", type: "PDF", status: "Signed", date: "Jan 8, 2026" },
  ]
  
  return (
    <div className="space-y-6">
      <div className="border border-gray-200 rounded-xl p-6 bg-white">
        <h4 className="font-display font-bold text-lg text-[#0C3535] mb-4">
          Project Documents
        </h4>
        
        <div className="space-y-2">
          {documents.map((doc) => (
            <div
              key={doc.name}
              className="flex items-center justify-between p-4 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-[#0C3535]/10 flex items-center justify-center">
                  <span className="font-mono text-[10px] text-[#0C3535]">{doc.type}</span>
                </div>
                <div>
                  <div className="font-display font-bold text-sm text-[#0C3535]">
                    {doc.name}
                  </div>
                  <div className="font-mono text-[10px] text-gray-500">
                    {doc.date}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={cn(
                  "font-mono text-[10px] px-2 py-0.5 rounded-full",
                  doc.status === "Signed" && "bg-green-100 text-green-700",
                  doc.status === "Active" && "bg-blue-100 text-blue-700"
                )}>
                  {doc.status}
                </span>
                <Button variant="ghost" size="sm" className="text-[#0C3535] hover:text-[#0C3535]/80">
                  Download
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function VendorPortal() {
  const [activeTab, setActiveTab] = useState<Tab>("rfps")
  
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <VendorHeader />
      
      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-2 mb-8 border-b border-gray-200">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-4 py-3 font-mono text-xs transition-all border-b-2 -mb-px",
                activeTab === tab.id
                  ? "border-[#0C3535] text-[#0C3535]"
                  : "border-transparent text-gray-500 hover:text-[#0C3535]"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        
        {/* Tab Content */}
        {activeTab === "rfps" && <OpenRFPsTab />}
        {activeTab === "onboarding" && <OnboardingTab />}
        {activeTab === "payments" && <PaymentsTab />}
        {activeTab === "documents" && <DocumentsTab />}
      </main>
      
      {/* Footer */}
      <footer className="border-t border-gray-200 mt-12">
        <div className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
          <div className="font-display text-sm text-gray-400">
            <span className="font-black">OPS</span>
            <span className="font-light tracking-[0.2em] opacity-50">prism</span>
          </div>
          <div className="font-mono text-[10px] text-gray-400">
            Questions? Contact your LIGAMENT lead.
          </div>
        </div>
      </footer>
    </div>
  )
}
