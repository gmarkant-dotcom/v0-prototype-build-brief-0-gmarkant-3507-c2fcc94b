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
    a: "Ligament is an AI-powered vendor orchestration platform for independent creative agencies. It helps lead agencies identify, mobilize, and manage partner vendors across every project scope, and gives partner agencies a structured way to receive RFPs, submit bids, and manage active engagements.",
  },
  {
    q: "Who is Ligament for?",
    a: "Ligament is built for two types of users. Lead Agencies use it to manage their vendor pool, create projects, broadcast RFPs, review bids, manage onboarding, and track payments. Partner Agencies use it to receive RFP invitations, submit bids with payment terms, complete onboarding, submit status updates, and manage their profile and credentials.",
  },
  {
    q: "Is my data secure?",
    a: "Data is stored on Supabase hosted on AWS US-East. AI processing uses the Anthropic API. File storage uses Vercel Blob with private access controls. Row-level security ensures each agency and partner only sees their own data. All connections use HTTPS.",
  },
]

const leadFAQs: FAQ[] = [
  {
    q: "What is the Partner Pool?",
    a: "Your Partner Pool is your curated network of vetted vendor partners. You can manage existing relationships, track NDA and MSA status, and discover new partners through the built-in Marketplace. Partners in your pool can be invited to bid on any project scope.",
  },
  {
    q: "How does RFP Broadcast work?",
    a: "Start by uploading or creating a client brief. Optionally set output template preferences including style, sensitivity scrubbing, and format. The platform uses AI to map your brief into a structured master RFP. You then allocate scope items to internal teams or external partners, select recipients from your partner pool, and broadcast. Each partner receives a scoped RFP tailored to their deliverable.",
  },
  {
    q: "What is Lightning RFP Magic Link?",
    a: "Lightning RFP Magic Link is the fastest way to get a bid from any vendor. No Ligament account required. Create a brief, add vendor email addresses and names, and send instant personalized invitations. Each vendor receives a unique secure link valid for 72 hours. They can view the full project brief, upload files, add reference links, and submit their bid including payment terms, all without creating an account. After submitting, vendors are invited to create a Ligament profile to track their bid status, receive future RFPs, and get discovered by other agencies.",
  },
  {
    q: "How does Bid Management work?",
    a: "All bids from partner pool vendors and Lightning RFP Magic Link guest submissions appear in one place. Review proposals, budgets, payment terms, and attachments side by side. Shortlist bids, request meetings, provide feedback, award scopes, or decline. Guest submissions from vendors without Ligament accounts are clearly labeled and support all the same actions except awarding, which requires the vendor to create an account to complete onboarding.",
  },
  {
    q: "What is Onboarding?",
    a: "After awarding a bid, send a structured onboarding package to the partner. The package includes kickoff details, key documents, and MSA tracking. Partners acknowledge receipt through their Ligament portal. Track acknowledgment status across all active partnerships from the Onboarding page.",
  },
  {
    q: "How does Cash Flow & Payments work?",
    a: "The Cash Flow & Payments page lets you track client cash inflows and partner payment milestones per project. Add expected client payments with amounts and dates, then use AI Payment Synthesis to generate a recommended partner payment schedule that protects your margin and minimizes cash flow risk. Accept the AI recommendation to save it as your official milestone schedule, or adjust manually.",
  },
  {
    q: "How do I get started as a Lead Agency?",
    a: "Sign up, create your first project, and either invite partners from your existing network using Lightning RFP Magic Link or build your Partner Pool by inviting vendors to join Ligament. No setup fee required during the current beta period.",
  },
]

const partnerFAQs: FAQ[] = [
  {
    q: "How do I respond to a Lightning RFP Magic Link as a vendor?",
    a: "When you receive a Lightning RFP Magic Link invitation by email, click the link to open your personalized brief page. You will see the full project brief including scope, budget, and timeline. Fill in your proposal, budget, payment terms, and any file attachments or reference links, then submit. You can return to the same link at any time within 72 hours to check your bid status, see agency feedback, or edit your submission. After the link expires, create a Ligament profile to continue tracking this bid and receive future invitations.",
  },
  {
    q: "How do I set up my partner profile to get discovered?",
    a: "Go to your Partner Profile page and complete your capabilities, credentials and portfolio, reel and work examples, legal information, and payment setup. Your profile completion percentage is shown on your dashboard. A complete profile makes you discoverable to lead agencies browsing the Partner Pool and Marketplace, and increases the likelihood of receiving RFP invitations.",
  },
  {
    q: "How do I get started as a Partner Agency?",
    a: "You can join Ligament by accepting an invitation from a lead agency, or by signing up directly and completing your profile to become discoverable. Once your profile is complete, lead agencies can find you in the Marketplace and invite you to bid on projects.",
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
