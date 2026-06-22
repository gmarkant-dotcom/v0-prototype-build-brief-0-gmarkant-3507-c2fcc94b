"use client"

import Link from "next/link"
import { useState } from "react"
import { LigamentLogo } from "@/components/ligament-logo"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

type Tab = "general" | "lead" | "partner"

type FAQ = { q: string; a: string }

const generalFAQs: FAQ[] = [
  {
    q: "What is Ligament?",
    a: "Ligament is a platform that helps creative and production agencies manage their external partner network - from finding vendors, to running RFPs, to tracking active projects and payments, all in one place.",
  },
  {
    q: "Who is Ligament for?",
    a: "Two types of users: Lead Agencies (who hire and manage external production partners) and Partner Agencies (who get hired to execute on specific scopes of work).",
  },
  {
    q: "Can my agency be both a lead agency and a partner agency?",
    a: "Yes. Many agencies operate as both, hiring partners for some projects while being hired as a partner on others. Ligament supports a dual-role toggle so you can switch between portals.",
  },
  {
    q: "Is there a cost to join?",
    a: "Lead agencies are on paid plans (see Pricing). Partner agencies access the platform at no cost.",
  },
]

const leadFAQs: FAQ[] = [
  {
    q: "What is Creative Treatment Analysis?",
    a: "It's Step 00 of your project workflow. Upload a creative treatment or client brief and Ligament runs four AI analyses in parallel: timeline recommendation, budget estimate, comparable campaigns, and director and production company recommendations.",
  },
  {
    q: "What does the Director and Production Company Recommendations analysis return?",
    a: "A shortlist of directors and production companies matched to your brief, with rationale for each. The shortlist carries forward into Step 01 RFP Broadcast as suggested recipients.",
  },
  {
    q: "Is my Creative Treatment Analysis saved?",
    a: "Yes. Each analysis is saved to your project automatically. Switch between projects using the project selector at the top of the page and your prior analysis will reload.",
  },
  {
    q: "How do I find new production partners?",
    a: "Use the Marketplace to discover partner agencies by capability, location, or agency type. You can search for specific skills like \"video production\" or \"experiential\" to find agencies that match your needs.",
  },
  {
    q: "How does RFP Broadcast work?",
    a: "Upload a client brief (any file type, or paste text), and Ligament's AI generates a structured Master RFP. From there, allocate scope items to internal teams or external partners, and broadcast directly to your partner network or new contacts via email invite.",
  },
  {
    q: "What happens when I broadcast an RFP that requires an NDA?",
    a: "You can attach an NDA link (set a default in your profile settings, or override per broadcast). Partners are gated from viewing the RFP details until they confirm they've signed it, and you confirm it in the Partner Pool.",
  },
  {
    q: "How do I manage incoming bids?",
    a: "The Bid Management page shows all responses grouped by client or partner agency, with status tracking: New, Submitted, Changes Requested, Shortlisted, Meeting Requested, Awarded, Declined.",
  },
  {
    q: "What is Active Engagements?",
    a: "Once a partner is awarded, Active Engagements is your command center for that project showing partner-submitted status updates, completion percentages, alerts, utilization details, and cash flow/payment milestones, all in one slide-over view per partner.",
  },
  {
    q: "Can I override a partner's status update?",
    a: "Yes. If you have additional context, you can manually override the status and completion percentage with a note. This is recorded as an agency-set update.",
  },
  {
    q: "How do I track payments to partners?",
    a: "The Cash Flow tab in Active Engagements shows agreed terms, payment milestones, and status (Invoice Received, Payment Sent, Payment Received, etc). Partners can confirm receipt on their end, which updates your view automatically.",
  },
  {
    q: "What does \"vouching\" mean?",
    a: "You can vouch for partner agencies you trust based on direct experience. When a partner receives vouches from 3 or more lead agencies, they earn a \"Triple-Vouched\" badge, a credibility signal visible across the platform. Vouches are anonymous to the partner.",
  },
  {
    q: "What is \"MSA Approved\" status?",
    a: "Once you've confirmed a Master Service Agreement is in place with a partner, you can mark it as approved in the Partner Pool, which updates their legal status and filters.",
  },
]

const partnerFAQs: FAQ[] = [
  {
    q: "How do I get discovered by lead agencies?",
    a: "Complete your company profile with your capabilities, bio, location, and agency type, and opt into being publicly discoverable. Lead agencies can search by capability to find agencies like yours.",
  },
  {
    q: "How do I respond to RFPs?",
    a: "Open RFPs shows all briefs sent to you, grouped by agency, client, or status. Click into any RFP to view the full brief, ask questions, and submit your bid.",
  },
  {
    q: "What if an RFP requires an NDA?",
    a: "You'll see a gate before viewing the RFP details. Sign the NDA externally (link provided), then click \"I've signed the NDA\" to notify the lead agency. Once they confirm, the RFP unlocks.",
  },
  {
    q: "What happens after I'm awarded a project?",
    a: "You'll move into onboarding, where you complete any required documents and setup steps for the project.",
  },
  {
    q: "How do I provide status updates?",
    a: "On Active Projects, click into any engagement to submit updates: workflow status, budget status, completion percentage, and notes. These are visible to the lead agency in real time.",
  },
  {
    q: "How do payments work?",
    a: "The Cash Flow tab on each active project shows your agreed rate and terms, payment milestones, and status. You can confirm when you've received payment, which updates the lead agency's view.",
  },
  {
    q: "Can I request a change to my rate or terms?",
    a: "Yes. Submit a request with your proposed terms and a note. The lead agency must review and accept the change before it takes effect. A history of all requests and changes is maintained.",
  },
  {
    q: "What does \"Triple-Vouched\" mean for me?",
    a: "If 3 or more lead agencies have vouched for your agency based on past work, you'll display a \"Triple-Vouched\" badge on your profile, a trust signal to other lead agencies browsing the marketplace. You won't see who vouched for you, only your total count.",
  },
  {
    q: "Can I be a lead agency too?",
    a: "Yes, use \"Switch to Lead Agency\" to access the lead agency portal and manage your own partner network.",
  },
]

function FAQItem({ item }: { item: FAQ }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-white/15 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left hover:bg-white/5 transition-colors"
      >
        <span className="font-display font-semibold text-white text-base leading-snug">{item.q}</span>
        <ChevronDown className={cn("w-5 h-5 text-white/50 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-6 pb-5 text-white/75 text-sm leading-relaxed border-t border-white/10 pt-4">
          {item.a}
        </div>
      )}
    </div>
  )
}

export default function FAQPage() {
  const [activeTab, setActiveTab] = useState<Tab>("general")

  const tabs: { key: Tab; label: string }[] = [
    { key: "general", label: "General" },
    { key: "lead", label: "For Lead Agency Users" },
    { key: "partner", label: "For Partner Agency Users" },
  ]

  const faqs: Record<Tab, FAQ[]> = {
    general: generalFAQs,
    lead: leadFAQs,
    partner: partnerFAQs,
  }

  return (
    <div className="min-h-screen bg-[#081F1F] text-white">
      <header className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <Link href="/">
          <LigamentLogo size="md" variant="primary" />
        </Link>
        <Link href="/" className="text-sm text-white/80 hover:text-white transition-colors">
          Back to Home
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="font-display font-black text-5xl mb-4">Frequently Asked Questions</h1>
          <p className="text-white/70 max-w-xl mx-auto">
            Everything you need to know about Ligament, for agencies on both sides of the partnership.
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-2 mb-10 flex-wrap justify-center">
          {tabs.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "px-5 py-2.5 rounded-full font-mono text-xs uppercase tracking-wider transition-colors",
                activeTab === t.key
                  ? "bg-[#C8F53C] text-[#0C3535] font-bold"
                  : "border border-white/20 text-white/70 hover:border-white/40 hover:text-white"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* FAQ list */}
        <div className="space-y-3">
          {faqs[activeTab].map((item, i) => (
            <FAQItem key={i} item={item} />
          ))}
        </div>

        <div className="text-center mt-14">
          <p className="text-white/50 text-sm mb-4">Still have questions?</p>
          <Link
            href="/auth/login"
            className="font-mono text-xs text-white/70 hover:text-white transition-colors underline underline-offset-4"
          >
            Log in to your account
          </Link>
          <span className="text-white/30 mx-3">·</span>
          <Link
            href="/pricing"
            className="font-mono text-xs text-white/70 hover:text-white transition-colors underline underline-offset-4"
          >
            View pricing
          </Link>
        </div>
      </main>
    </div>
  )
}
