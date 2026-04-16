"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AgencyShell } from "@/components/agency-layout"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { CreditCard, Check, ArrowRight, Download } from "lucide-react"
import { cn } from "@/lib/utils"

const plans = [
  {
    id: "core",
    name: "Core",
    price: "$299",
    period: "monthly",
    description: "For small agencies starting out",
    features: ["Up to 10 active partners", "5 projects/month", "Basic AI tools", "Email support"],
  },
  {
    id: "studio",
    name: "Studio",
    price: "$699",
    period: "monthly",
    description: "For growing agencies",
    features: ["Up to 30 active partners", "Up to 200 projects/year", "Full AI suite", "Priority support", "Best-Practice Consultations"],
    popular: true,
  },
  {
    id: "network",
    name: "Network",
    price: "Custom",
    period: "custom",
    description: "For enterprise agencies",
    features: ["Unlimited partners", "Unlimited projects", "White-label", "Dedicated success manager", "API access"],
  },
]

export default function AgencyBillingSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [currentPlan] = useState("studio")

  const billingHistory = [
    { id: "inv-001", date: "2026-03-01", description: "Studio plan - monthly", amount: "$699.00", status: "Paid" },
    { id: "inv-002", date: "2026-02-01", description: "Studio plan - monthly", amount: "$699.00", status: "Paid" },
    { id: "inv-003", date: "2026-01-01", description: "Studio plan - monthly", amount: "$699.00", status: "Paid" },
  ]

  useEffect(() => {
    const loadUser = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/auth/login")
        return
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single()

      if (profile?.role !== "agency") {
        router.push("/partner")
        return
      }
      setLoading(false)
    }
    loadUser()
  }, [router])

  if (loading) {
    return (
      <AgencyShell>
        <div className="p-8">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
          </div>
        </div>
      </AgencyShell>
    )
  }

  return (
    <AgencyShell>
      <div className="p-8 max-w-6xl space-y-8">
        <div>
          <h1 className="font-display font-black text-3xl text-foreground mb-2">Billing & Plan Settings</h1>
          <p className="text-foreground-muted">Manage your subscription, plan tier, and payment method.</p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
                <CreditCard className="w-6 h-6 text-accent" />
              </div>
              <div>
                <div className="font-display font-bold text-lg text-foreground">Studio Plan</div>
                <div className="text-foreground-muted">$699 · monthly · Renews Apr 1, 2026</div>
              </div>
            </div>
            <span className="font-mono text-[10px] px-3 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/30">
              Active
            </span>
          </div>
        </div>

        <div>
          <h2 className="font-display font-bold text-xl text-foreground mb-4">Plan Comparison</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={cn(
                  "relative bg-white/5 backdrop-blur-xl border rounded-xl p-6",
                  plan.id === currentPlan ? "border-accent/50" : "border-border/30",
                  plan.popular && "ring-2 ring-accent/30"
                )}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 font-mono text-[10px] px-3 py-1 rounded-full bg-accent text-accent-foreground">
                    Most Popular
                  </div>
                )}
                <div className="mb-4">
                  <div className="font-display font-bold text-xl text-foreground">{plan.name}</div>
                  <div className="text-foreground-muted text-sm">{plan.description}</div>
                </div>
                <div className="mb-6">
                  <span className="font-display font-black text-3xl text-foreground">{plan.price}</span>
                  <span className="text-foreground-muted"> {plan.period === "monthly" ? "/month" : ""}</span>
                </div>
                <ul className="space-y-2 mb-6">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-foreground-secondary">
                      <Check className="w-4 h-4 text-accent shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                {plan.id === currentPlan ? (
                  <Button disabled className="w-full" variant="outline">
                    Current Plan
                  </Button>
                ) : plan.id === "network" ? (
                  <Button asChild variant="outline" className="w-full border-border/50">
                    <Link href={`/contact?plan=${plan.id}`}>Contact Sales</Link>
                  </Button>
                ) : (
                  <Button asChild className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
                    <Link href={`/contact?plan=${plan.id}`}>
                      Upgrade
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Link>
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-xl p-6">
            <h3 className="font-display font-bold text-lg text-foreground mb-3">Payment Method</h3>
            <div className="flex items-center justify-between rounded-lg border border-border/40 p-4">
              <div className="flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-accent" />
                <div>
                  <div className="text-foreground font-medium">Visa ending in 4242</div>
                  <div className="text-xs text-foreground-muted">Expires 08/28</div>
                </div>
              </div>
              <Button variant="outline" className="border-border/50 text-foreground">
                Update Payment Method
              </Button>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-xl p-6">
            <h3 className="font-display font-bold text-lg text-foreground mb-3">Cancel Plan</h3>
            <p className="text-foreground-muted text-sm mb-4">
              To cancel your current subscription, contact support and we will assist you.
            </p>
            <Button asChild variant="outline" className="border-border/50 text-foreground">
              <Link href="/contact?plan=cancel">Contact Support</Link>
            </Button>
          </div>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-xl p-6">
          <h3 className="font-display font-bold text-lg text-foreground mb-4">Billing History</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="text-left py-2 text-foreground-muted font-mono text-[10px] uppercase">Date</th>
                  <th className="text-left py-2 text-foreground-muted font-mono text-[10px] uppercase">Description</th>
                  <th className="text-right py-2 text-foreground-muted font-mono text-[10px] uppercase">Amount</th>
                  <th className="text-right py-2 text-foreground-muted font-mono text-[10px] uppercase">Status</th>
                  <th className="text-right py-2 text-foreground-muted font-mono text-[10px] uppercase">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {billingHistory.map((row) => (
                  <tr key={row.id} className="border-b border-border/20">
                    <td className="py-3 text-foreground">{row.date}</td>
                    <td className="py-3 text-foreground">{row.description}</td>
                    <td className="py-3 text-right text-foreground">{row.amount}</td>
                    <td className="py-3 text-right">
                      <span className="font-mono text-[10px] px-2 py-1 rounded-full border border-green-500/30 bg-green-500/10 text-green-400">
                        {row.status}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <Button variant="ghost" size="sm" className="text-foreground-muted hover:text-foreground">
                        <Download className="w-3.5 h-3.5 mr-1.5" />
                        PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AgencyShell>
  )
}
