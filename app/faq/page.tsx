"use client"

import Link from "next/link"
import { useState } from "react"
import { LigamentLogo } from "@/components/ligament-logo"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

type Tab = "general" | "lead" | "partner" | "terms"

type FAQ = { q: string; a: string }

const generalFAQs: FAQ[] = [
  {
    q: "What is Ligament?",
    a: "Ligament is an AI-powered vendor orchestration platform for independent creative agencies. Lead agencies build a partner pool, broadcast RFPs, compare and score bids with AI, and review delivery performance. Partner agencies get discovered, submit bids, and build a track record, all in one platform.",
  },
  {
    q: "Who is Ligament for?",
    a: "Two types of users. Lead Agencies manage their partner pool, broadcast RFPs, evaluate bids, run onboarding, and review delivery performance. Partner Agencies receive RFP invitations, submit bids, complete onboarding, and track their engagements and reliability score.",
  },
  {
    q: "Is Ligament free for partner agencies?",
    a: "Yes, completely free. Ligament charges lead agencies for platform access. Partner agencies, the vendors receiving RFPs and submitting bids, always use Ligament at no cost.",
  },
  {
    q: "How much does Ligament cost for lead agencies?",
    a: "Starter is $150/month or $1,500/year for up to 5 active projects and 50 AI analyses a month. Professional is $400/month or $4,000/year for up to 20 active projects and 250 AI analyses a month. Enterprise is custom pricing with unlimited projects and AI analyses. See the pricing page for the full feature comparison.",
  },
  {
    q: "Do I need to create an account to submit a bid?",
    a: "No. If a lead agency sends you a Lightning RFP Magic Link, you can view the full project brief and submit a complete bid without creating a Ligament account. Your link stays active for 72 hours so you can return to check status and feedback. Creating an account afterward is optional but unlocks bid tracking, profile discoverability, and direct RFP invitations.",
  },
  {
    q: "Is my data secure?",
    a: "Data is stored on Supabase hosted on AWS US-East. AI processing uses the Anthropic API. File storage uses Vercel Blob with private access controls. Row-level security ensures each agency and partner only sees their own data, and all connections use HTTPS.",
  },
]

const leadFAQs: FAQ[] = [
  {
    q: "What is the Partner Pool?",
    a: "Your Partner Pool is organized into three columns: Active Partners you already work with, partners you have Invited but who have not yet joined, and partners you have Discovered but not yet reached out to. Build it by inviting partners directly, importing contacts from your email, or discovering new agencies on the marketplace.",
  },
  {
    q: "Can I import my vendor contacts from email?",
    a: "Yes, two ways. Connect Gmail or Outlook and Ligament scans subject lines and message previews (never full email content) to identify likely vendor contacts, scoring each one by signals like attachments and message frequency. Review the results and choose which contacts to add to your pool. You can also skip email entirely and upload a spreadsheet (CSV or Excel) of contacts instead.",
  },
  {
    q: "How does RFP Broadcast work?",
    a: "Upload or create a client brief and Ligament's AI analyzes it into a structured master RFP with scope items. Allocate scope items to partners in your pool or send them via Lightning RFP Magic Link to any vendor, no account required on their end. Each recipient gets a scoped RFP tailored to their deliverable.",
  },
  {
    q: "What is Lightning RFP Magic Link?",
    a: "The fastest way to get a bid from any vendor, no Ligament account required. Add a vendor's email and name and send an instant, secure, personalized link valid for 72 hours. They can view the brief, upload files, and submit a complete bid, then are invited to create a profile afterward to keep tracking it.",
  },
  {
    q: "How does Bid Management work?",
    a: "All bids, from partner pool vendors and Magic Link guests alike, appear in one pipeline. Generate an AI summary and cost decomposition for any bid, or select several to compare side by side with an AI narrative that surfaces pricing gaps and scope risks. Shortlist, request meetings, leave feedback, award, or decline from the same view.",
  },
  {
    q: "How does AI bid scoring work?",
    a: "Score bids against configurable criteria, seven by default (creative approach, production capability, budget, timeline, business criteria compliance, vendor track record, and risk). AI pre-scores each criterion 1-10 with a written rationale you can accept or override with your own score and notes. The weighted scores roll up into a single 0-100 composite for ranking bids against each other.",
  },
  {
    q: "What is Delivery Performance?",
    a: "After a project wraps, rate the vendor's actual delivery against the same criteria you scored their bid on, plus on-time, on-budget, and satisfaction ratings. Ligament compares the delivery score to the original bid score and generates an AI summary of where the vendor over-delivered or under-delivered. This builds a reliability record that surfaces on the partner's profile and informs AI scoring on their future bids.",
  },
  {
    q: "What is Onboarding?",
    a: "After awarding a bid, send a structured onboarding package with kickoff details, brand guidelines, and key project documents. Partners acknowledge receipt through their portal, and you can track acknowledgment status across every active partnership from the Onboarding page.",
  },
  {
    q: "What are business criteria and procurement requirements?",
    a: "Track each partner's business designations (MBE, WBE, veteran-owned, and others), insurance coverage, and certificate of insurance on file. Set requirements on an RFP and Ligament flags any bidder who does not meet them, so compliance gaps surface automatically during bid review.",
  },
  {
    q: "How do I get started as a Lead Agency?",
    a: "Sign up, create your first project, and either invite partners from your existing network or build your Partner Pool by importing contacts, inviting directly, or discovering new agencies on the marketplace. No setup fee.",
  },
]

const partnerFAQs: FAQ[] = [
  {
    q: "Do I need to pay to use Ligament as a partner agency?",
    a: "Ligament is completely free for partner agencies. There are no fees to create a profile, receive RFP invitations, submit bids, or manage active projects. Lead agencies pay for platform access. Partners never do.",
  },
  {
    q: "How do I join Ligament as a partner agency?",
    a: "If a lead agency invites you to bid, you will get a direct platform invitation or a Lightning RFP Magic Link, either lets you respond right away. You can also sign up directly and complete your profile to become discoverable to agencies looking for partners.",
  },
  {
    q: "What is the Agency Network page?",
    a: "Agency Network brings your agency relationships into one place across three tabs. My Agencies shows partnerships you already have. Invitations shows pending invitations from lead agencies waiting on your response. Discover lets you search and filter lead agencies and request access to their network.",
  },
  {
    q: "How do I make my profile discoverable to agencies?",
    a: "On your Partner Profile page, toggle on \"Make my profile discoverable.\" Once on, your profile appears in the marketplaces lead agencies browse when looking for new vendors. A complete profile with capabilities, credentials, business criteria, and work examples increases your odds of getting invited to bid.",
  },
  {
    q: "What information should I include in my profile?",
    a: "Your capabilities, credentials and portfolio, and a reel or work examples showing your best work. Fill in your business criteria too, designations you hold and insurance coverage on file, since agencies filter and score bids against these. The more complete your profile, the more credible you appear.",
  },
  {
    q: "How do I track my bid submissions?",
    a: "Open RFPs & Bids has three tabs: Open RFPs for invitations waiting on a response, My Bids for submissions still awaiting a decision, and History for every bid you have ever submitted with its final outcome. Each shows the agency, scope, budget, and current status.",
  },
  {
    q: "What happens after I win a bid?",
    a: "You will receive an onboarding package with kickoff details, brand guidelines, and project documents. Acknowledge it through your portal, and the engagement appears in Delivery & Projects where you submit status updates and track the project through to completion.",
  },
  {
    q: "Can agencies see how I performed on past projects?",
    a: "Yes. After a project completes, the lead agency rates your delivery, on-time, on-budget, satisfaction, and the same criteria they scored your bid on. You can see your own completed scores under Delivery & Projects. This reliability record is what makes a strong track record valuable when bidding on future work.",
  },
  {
    q: "Can I share my Ligament profile with agencies outside the platform?",
    a: "Yes. Once your profile is discoverable, it has a public URL you can share in proposals and pitches. Anyone who clicks it sees your capabilities, portfolio, and work examples without needing a Ligament account themselves.",
  },
  {
    q: "What if I submitted a bid via Magic Link but want to create an account?",
    a: "You will see a prompt to create a profile with your email pre-filled. Once created, your submitted bid is automatically linked to your new profile, so you keep tracking it, receive the agency's decision, and access onboarding if awarded without resubmitting anything.",
  },
]

const termsFAQs: FAQ[] = [
  {
    q: "What is terms disclosure?",
    a: "Both sides state their standard business terms (payment schedule and net days, kill fee, IP ownership, and rate validity) up front as part of the RFP and bid exchange. Surprises surface before an award decision, not during contract review.",
  },
  {
    q: "Who sees my terms?",
    a: "Disclosure is bilateral and scoped to the exchange. Partners see an agency's terms on the RFPs they receive; agencies see a partner's terms alongside their bid. Terms are not published anywhere publicly.",
  },
  {
    q: "What do Firm, Flexible, and Negotiable mean?",
    a: "Each term carries a stance. Firm means this is how we work; Flexible means we can adapt within reason; Negotiable means we expect to discuss it. Stances help both sides see where alignment is easy and where a conversation is needed.",
  },
  {
    q: "Do invited vendors without a Ligament account see terms?",
    a: "Yes. Vendors responding through a Magic Link get the same disclosure step in their bid form, no account required.",
  },
  {
    q: "Is a terms disclosure a contract?",
    a: "No. Disclosure informs the decision; your contracts still govern the engagement. Ligament surfaces alignment early so contracting goes faster.",
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
    { key: "terms", label: "Terms & Disclosure" },
  ]

  const faqs: Record<Tab, FAQ[]> = {
    general: generalFAQs,
    lead: leadFAQs,
    partner: partnerFAQs,
    terms: termsFAQs,
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

      <footer className="border-t border-white/10 py-6">
        <div className="max-w-3xl mx-auto px-6 flex items-center justify-center gap-3">
          <Link href="/terms" className="font-mono text-[10px] text-white/50 hover:text-white transition-colors">
            Terms
          </Link>
          <span className="text-white/25">|</span>
          <Link href="/privacy" className="font-mono text-[10px] text-white/50 hover:text-white transition-colors">
            Privacy
          </Link>
        </div>
      </footer>
    </div>
  )
}
