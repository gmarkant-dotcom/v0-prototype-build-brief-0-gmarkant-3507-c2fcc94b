"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Check } from "lucide-react"

const tiers = [
  {
    name: "Core",
    price: "$299/month",
    description: "For smaller teams getting started with vendor orchestration.",
    features: [
      "Up to 10 active partners",
      "5 projects/month",
      "Basic AI tools",
      "Email support",
    ],
  },
  {
    name: "Studio",
    price: "$699/month",
    description: "For growing agencies running multiple active projects.",
    features: [
      "Up to 50 active partners",
      "Unlimited projects",
      "Full AI suite",
      "Priority support",
      "Custom branding",
    ],
    highlighted: true,
  },
  {
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

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#081F1F] text-white">
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
              <div className="font-display font-black text-3xl mt-2">{tier.price}</div>
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
                    <Link href="/contact">Contact Sales</Link>
                  </Button>
                ) : (
                  <Button asChild className="w-full bg-[#C8F53C] text-[#0C3535] hover:bg-[#C8F53C]/90">
                    <Link href="/auth/signup">Get Started</Link>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <Link href="/auth/login" className="text-sm text-white/70 hover:text-white">
            Already have an account? Sign in
          </Link>
        </div>
      </main>
    </div>
  )
}
