"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { LigamentLogo } from "@/components/ligament-logo"
import { Check } from "lucide-react"

const tiers = [
  {
    id: "core",
    name: "Core",
    description: "For smaller teams getting started with vendor orchestration.",
    features: [
      "Up to 10 active partners",
      "Up to 60 projects/year",
      "Basic AI tools",
      "Email support",
    ],
  },
  {
    id: "studio",
    name: "Studio",
    description: "For growing agencies running multiple active projects.",
    features: [
      "Up to 30 active partners",
      "Up to 200 projects/year",
      "Full AI suite",
      "Priority support",
      "Best-Practice Consultations",
    ],
    highlighted: true,
  },
  {
    id: "network",
    name: "Network",
    price: "Custom",
    description: "For enterprise teams needing white-label and API access.",
    features: [
      "Unlimited partners & projects",
      "White-label infrastructure",
      "API access",
      "Dedicated success manager",
      "Enterprise onboarding",
    ],
  },
]

const benefits = [
  {
    title: "One source of truth.",
    body: "Briefs, bids, contracts, onboarding docs, and payments in one place. No more chasing information across email and shared drives.",
  },
  {
    title: "Structure that bends without breaking.",
    body: "Best-practice process across every vendor workflow, flexible enough to fit every client and scope.",
  },
  {
    title: "Never start from zero again.",
    body: "Every RFP, scope, and bid becomes a reusable template. The platform gets smarter as your agency does.",
  },
  {
    title: "Institutional knowledge that sticks.",
    body: "Every decision and engagement logged builds a searchable record. What used to live in someone's head becomes a durable agency asset.",
  },
  {
    title: "The right partner for every scope.",
    body: "A curated, discoverable pool of vetted partners with capabilities and track records on file. Match fit-for-purpose talent with confidence.",
  },
]

const roiRows = [
  { year: "Year 1", value: "$7,440" },
  { year: "Year 2", value: "$11,160" },
  { year: "Year 3", value: "$13,392" },
  { year: "Year 4", value: "$15,376" },
  { year: "Year 5", value: "$16,368" },
]

export default function PricingPage() {
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
        <div className="text-center mb-14">
          <h1 className="font-display font-black text-5xl mb-4">Become a Lead Agency</h1>
          <p className="text-white/70 max-w-2xl mx-auto">
            Unlock full platform access with plans designed for modern agency operations.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`rounded-2xl border p-8 ${
                tier.highlighted ? "border-[#C8F53C] bg-[#0C3535]" : "border-white/20 bg-white/5"
              }`}
            >
              <h2 className="font-display font-bold text-2xl">{tier.name}</h2>
              {tier.price ? <div className="font-display font-black text-3xl mt-2">{tier.price}</div> : null}
              <p className="text-white/70 mt-3 text-sm">{tier.description}</p>
              <ul className="space-y-2 mt-6">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-white/85">
                    <Check className="w-4 h-4 mt-0.5 text-[#C8F53C]" />
                    {feature}
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                {tier.name === "Network" ? (
                  <Button asChild variant="outline" className="w-full border-white/30 text-white hover:bg-white/10">
                    <Link href={`/contact?plan=${tier.id}`}>Contact Sales</Link>
                  </Button>
                ) : (
                  <Button asChild className="w-full bg-[#C8F53C] text-[#0C3535] hover:bg-[#C8F53C]/90">
                    <Link href={`/contact?plan=${tier.id}`}>Get Started</Link>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <section className="mt-16 pt-12 border-t border-white/15">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div>
              <h2 className="font-display font-black text-3xl mb-6">Why Ligament</h2>
              <div className="space-y-5">
                {benefits.map((item) => (
                  <div key={item.title} className="rounded-xl border border-white/15 bg-white/5 p-4">
                    <p className="text-white font-semibold">{item.title}</p>
                    <p className="text-white/75 text-sm mt-1 leading-relaxed">{item.body}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="font-display font-black text-3xl mb-3">The ROI Case</h2>
              <p className="text-white/80 text-sm mb-6">
                Benchmark: Account Director. $110-130k fully loaded. ~$62/hr.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <div className="rounded-xl border border-white/15 bg-white/5 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-[#C8F53C] mb-2">Year 1</p>
                  <p className="font-display font-black text-2xl text-white mb-2">10 hrs/month recovered</p>
                  <p className="text-[#C8F53C] font-semibold text-sm mb-3">
                    $7,440 in annual labor value recovered
                  </p>
                  <p className="text-white/70 text-sm leading-relaxed">
                    The agency is building its partner pool and learning the platform. Savings are real and immediate.
                  </p>
                </div>

                <div className="rounded-xl border border-white/15 bg-white/5 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-[#C8F53C] mb-2">Year 5</p>
                  <p className="font-display font-black text-2xl text-white mb-2">18 to 22 hrs/month recovered</p>
                  <p className="text-[#C8F53C] font-semibold text-sm mb-3">
                    $13,392 to $16,368 in annual labor value recovered
                  </p>
                  <p className="text-white/70 text-sm leading-relaxed">
                    Historical bid data provides instant rate benchmarks. RFP templates are tuned from dozens of past
                    scopes. The partner pool is fully built. Compounding efficiency kicks in.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-white/15 bg-white/5 p-5">
                <h3 className="font-display font-bold text-xl mb-4">5-Year Cumulative Labor Value Recovered</h3>
                <div className="divide-y divide-white/10">
                  {roiRows.map((row) => (
                    <div key={row.year} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-white/80">{row.year}</span>
                      <span className="font-semibold text-white">{row.value}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between py-3 text-sm">
                    <span className="text-white font-semibold">Total</span>
                    <span className="font-display font-bold text-[#C8F53C]">
                      ~$63,700 in recovered Account Director labor value
                    </span>
                  </div>
                </div>
              </div>

              <p className="mt-5 text-lg font-display font-bold text-white">
                The platform pays for itself in Year 1 and compounds from there.
              </p>
            </div>
          </div>
        </section>

        <div className="text-center mt-12">
          <Link href="/auth/login" className="text-sm text-white/70 hover:text-white">
            Already have an account? Sign in
          </Link>
        </div>
      </main>
    </div>
  )
}
