"use client"

import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { LigamentLogo } from "@/components/ligament-logo"
import { cn } from "@/lib/utils"
import { Check, ChevronDown } from "lucide-react"

// ── Types ────────────────────────────────────────────────────────────────────

type BillingCycle = "monthly" | "annual"

type Tier = {
  id: string
  name: string
  tagline: string
  monthlyPrice: number | null
  annualPrice: number | null
  annualSavings: number | null
  priceLabel?: string
  popular?: boolean
  features: string[]
  ctaLabel: string
  ctaHref: string
}

type ComparisonValue = string | boolean

type ComparisonRow = {
  label: string
  starter: ComparisonValue
  professional: ComparisonValue
  enterprise: ComparisonValue
}

type FAQ = { q: string; a: string }

// ── Data ─────────────────────────────────────────────────────────────────────

const tiers: Tier[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "For independent agencies managing a handful of active productions",
    monthlyPrice: 150,
    annualPrice: 1500,
    annualSavings: 300,
    features: [
      "Up to 5 active projects",
      "50 AI analyses per month",
      "Unlimited partner pool",
      "Unlimited user seats",
      "Full AI suite (bid analysis, comparison, scoring, vendor intelligence)",
      "Business criteria and compliance tracking",
      "Lightning RFP Magic Links",
      "Delivery performance reviews",
      "Email support",
    ],
    ctaLabel: "Get Started",
    ctaHref: "/auth/sign-up",
  },
  {
    id: "professional",
    name: "Professional",
    tagline: "For growing agencies running multiple concurrent client engagements",
    monthlyPrice: 400,
    annualPrice: 4000,
    annualSavings: 800,
    popular: true,
    features: [
      "Up to 20 active projects",
      "250 AI analyses per month",
      "Everything in Starter, plus:",
      "Gmail and Outlook email import for pool building",
      "Priority support",
    ],
    ctaLabel: "Get Started",
    ctaHref: "/auth/sign-up",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For agency networks and holding companies with complex vendor operations",
    monthlyPrice: null,
    annualPrice: null,
    annualSavings: null,
    priceLabel: "Custom",
    features: [
      "Unlimited projects and AI analyses",
      "Everything in Professional, plus:",
      "White-label infrastructure",
      "API access",
      "Dedicated success manager",
      "Custom integrations",
      "Enterprise onboarding",
    ],
    ctaLabel: "Contact Sales",
    ctaHref: "mailto:greg@withligament.com",
  },
]

const comparisonRows: ComparisonRow[] = [
  { label: "Active projects", starter: "5", professional: "20", enterprise: "Unlimited" },
  { label: "AI analyses per month", starter: "50", professional: "250", enterprise: "Unlimited" },
  { label: "User seats", starter: "Unlimited", professional: "Unlimited", enterprise: "Unlimited" },
  { label: "Partner pool size", starter: "Unlimited", professional: "Unlimited", enterprise: "Unlimited" },
  { label: "RFP Broadcast", starter: true, professional: true, enterprise: true },
  { label: "Lightning RFP Magic Links", starter: true, professional: true, enterprise: true },
  { label: "AI Bid Analysis & Comparison", starter: true, professional: true, enterprise: true },
  { label: "AI Bid Scoring & Evaluation", starter: true, professional: true, enterprise: true },
  { label: "Business Criteria Tracking", starter: true, professional: true, enterprise: true },
  { label: "Delivery Performance Reviews", starter: true, professional: true, enterprise: true },
  { label: "Vendor Reliability Intelligence", starter: true, professional: true, enterprise: true },
  { label: "Email Import (Gmail/Outlook)", starter: false, professional: true, enterprise: true },
  { label: "White-label Infrastructure", starter: false, professional: false, enterprise: true },
  { label: "API Access", starter: false, professional: false, enterprise: true },
  { label: "Support", starter: "Email", professional: "Priority", enterprise: "Dedicated" },
]

const pricingFaqs: FAQ[] = [
  {
    q: "What counts as an active project?",
    a: "A project is active from the moment you create it until you mark it complete. Completed projects don't count toward your limit.",
  },
  {
    q: "What counts as an AI analysis?",
    a: "Each AI-generated summary, cost decomposition, bid comparison, or scoring evaluation counts as one analysis. Viewing previously generated analyses does not count again.",
  },
  {
    q: "Can I upgrade or downgrade anytime?",
    a: "Yes. Upgrades take effect immediately. Downgrades take effect at the end of your current billing period.",
  },
  {
    q: "Is there really no cost for partner agencies?",
    a: "Correct. Partners access the platform for free, permanently. They can receive RFPs, submit bids, manage onboarding, and track project delivery at no cost.",
  },
  {
    q: "What happens if I hit my project or analysis limit?",
    a: "You'll see a notification at 80% usage. At the limit, you can complete existing projects to free up capacity or upgrade your plan. You never lose access to existing data or analyses.",
  },
]

// ── Small components ─────────────────────────────────────────────────────────

function ComparisonCell({ value }: { value: ComparisonValue }) {
  if (value === true) return <Check className="w-4 h-4 text-[#C8F53C] mx-auto" />
  if (value === false) return <span className="text-white/30">-</span>
  return <span className="text-white/85">{value}</span>
}

function FAQItem({ item }: { item: FAQ }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-white/15 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left hover:bg-white/5 transition-colors"
      >
        <span className="font-display font-semibold text-white text-base leading-snug">{item.q}</span>
        <ChevronDown className={cn("w-5 h-5 text-white/50 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-6 pb-5 text-white/75 text-sm leading-relaxed border-t border-white/10 pt-4">{item.a}</div>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const [cycle, setCycle] = useState<BillingCycle>("annual")
  const [showComparison, setShowComparison] = useState(false)

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

      <main className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-10">
          <h1 className="font-display font-black text-5xl mb-4">Become a Lead Agency</h1>
          <p className="text-white/70 max-w-2xl mx-auto">
            Unlock full platform access with plans designed for modern agency operations.
          </p>
        </div>

        {/* Partner free callout */}
        <div className="max-w-3xl mx-auto mb-10 rounded-2xl border border-[#C8F53C]/40 bg-[#C8F53C]/10 px-6 py-5 text-center">
          <p className="font-display font-bold text-lg text-white">Partner agencies always access Ligament for free.</p>
          <p className="text-white/75 text-sm mt-1">No fees, no limits, no catch.</p>
        </div>

        {/* Monthly / Annual toggle */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <span className={cn("text-sm transition-colors", cycle === "monthly" ? "text-white font-semibold" : "text-white/50")}>
            Monthly
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={cycle === "annual"}
            onClick={() => setCycle((c) => (c === "annual" ? "monthly" : "annual"))}
            className="relative w-12 h-6 rounded-full bg-white/10 border border-white/20 transition-colors shrink-0"
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-[#C8F53C] transition-transform",
                cycle === "annual" && "translate-x-6"
              )}
            />
          </button>
          <span className={cn("text-sm transition-colors", cycle === "annual" ? "text-white font-semibold" : "text-white/50")}>
            Annual
          </span>
        </div>

        {/* Pricing cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          {tiers.map((tier) => {
            const isCustom = tier.priceLabel != null
            const amount = isCustom
              ? tier.priceLabel
              : cycle === "monthly"
                ? `$${tier.monthlyPrice}`
                : `$${tier.annualPrice?.toLocaleString("en-US")}`
            const period = isCustom ? null : cycle === "monthly" ? "/month" : "/year"
            const showSavings = !isCustom && cycle === "annual" && tier.annualSavings != null
            const isMailto = tier.ctaHref.startsWith("mailto:")

            return (
              <div
                key={tier.id}
                className={cn(
                  "relative rounded-2xl border p-6 flex flex-col",
                  tier.popular ? "border-[#C8F53C] bg-[#0C3535] md:-translate-y-2 shadow-2xl shadow-black/20" : "border-white/20 bg-white/5"
                )}
              >
                {tier.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-wider px-3 py-1 rounded-full bg-[#C8F53C] text-[#0C3535] font-bold whitespace-nowrap">
                    Most Popular
                  </span>
                )}

                <h2 className="font-display font-bold text-2xl">{tier.name}</h2>
                <p className="text-white/70 mt-2 text-sm">{tier.tagline}</p>

                <div className="mt-4 flex items-baseline gap-2 flex-wrap">
                  <span className="font-display font-black text-4xl">{amount}</span>
                  {period && <span className="text-white/50 text-sm">{period}</span>}
                  {showSavings && (
                    <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#C8F53C]/15 text-[#C8F53C] border border-[#C8F53C]/40">
                      Save ${tier.annualSavings}/yr
                    </span>
                  )}
                </div>

                <ul className="space-y-2 mt-6 flex-1">
                  {tier.features.map((feature, i) => {
                    const isDivider = feature.startsWith("Everything in")
                    return (
                      <li
                        key={i}
                        className={cn(
                          "flex items-start gap-2 text-sm",
                          isDivider ? "text-white/50 italic pt-1" : "text-white/85"
                        )}
                      >
                        {!isDivider && <Check className="w-4 h-4 mt-0.5 text-[#C8F53C] shrink-0" />}
                        <span>{feature}</span>
                      </li>
                    )
                  })}
                </ul>

                <div className="mt-8">
                  {isMailto ? (
                    <Button asChild variant="outline" className="w-full border-white/30 text-white hover:bg-white/10">
                      <a href={tier.ctaHref}>{tier.ctaLabel}</a>
                    </Button>
                  ) : (
                    <Button
                      asChild
                      className={cn(
                        "w-full",
                        tier.popular
                          ? "bg-[#C8F53C] text-[#0C3535] hover:bg-[#C8F53C]/90"
                          : "bg-white/10 text-white hover:bg-white/20 border border-white/20"
                      )}
                    >
                      <Link href={tier.ctaHref}>{tier.ctaLabel}</Link>
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Feature comparison table */}
        <div className="mt-14 text-center">
          <button
            type="button"
            onClick={() => setShowComparison((s) => !s)}
            className="font-mono text-xs text-[#C8F53C] hover:underline inline-flex items-center gap-1.5"
          >
            {showComparison ? "Hide feature comparison" : "Compare all features"}
            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showComparison && "rotate-180")} />
          </button>
        </div>

        {showComparison && (
          <div className="mt-6 overflow-x-auto rounded-xl border border-white/15">
            <table className="w-full text-sm border-collapse min-w-[640px]">
              <thead>
                <tr className="border-b border-white/15 bg-white/5">
                  <th className="text-left font-mono text-[10px] uppercase tracking-wider text-white/60 px-4 py-3">Feature</th>
                  <th className="text-center font-mono text-[10px] uppercase tracking-wider text-white/60 px-4 py-3">Starter</th>
                  <th className="text-center font-mono text-[10px] uppercase tracking-wider text-white/60 px-4 py-3">Professional</th>
                  <th className="text-center font-mono text-[10px] uppercase tracking-wider text-white/60 px-4 py-3">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.label} className="border-b border-white/10 last:border-0">
                    <td className="px-4 py-3 text-white/85 whitespace-nowrap">{row.label}</td>
                    <td className="px-4 py-3 text-center">
                      <ComparisonCell value={row.starter} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ComparisonCell value={row.professional} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ComparisonCell value={row.enterprise} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pricing FAQ */}
        <section className="mt-16 pt-12 border-t border-white/15">
          <h2 className="font-display font-black text-3xl mb-6 text-center">Pricing Questions</h2>
          <div className="max-w-2xl mx-auto space-y-3">
            {pricingFaqs.map((item) => (
              <FAQItem key={item.q} item={item} />
            ))}
          </div>
        </section>

        <div className="text-center mt-12">
          <Link href="/auth/login" className="text-sm text-white/70 hover:text-white">
            Already have an account? Sign in
          </Link>
        </div>
      </main>

      <footer className="border-t border-white/10 py-6">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-center gap-3">
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
