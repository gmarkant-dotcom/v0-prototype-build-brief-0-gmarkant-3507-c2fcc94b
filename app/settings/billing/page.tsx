"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { SettingsLayout } from "@/components/settings-layout"
import { Button } from "@/components/ui/button"
import { CreditCard, Check, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"

const plans = [
  {
    id: "core",
    name: "Core",
    price: "$299",
    period: "/month",
    description: "For small agencies starting out",
    features: ["Up to 10 active partners", "5 projects/month", "Basic AI tools", "Email support"],
  },
  {
    id: "studio",
    name: "Studio",
    price: "$699",
    period: "/month",
    description: "For growing agencies",
    features: ["Up to 30 active partners", "Up to 200 projects/year", "Full AI suite", "Priority support", "Best-Practice Consultations", "Custom branding"],
    popular: true,
  },
  {
    id: "network",
    name: "Network",
    price: "Custom",
    period: "",
    description: "For enterprise agencies",
    features: ["Unlimited partners", "Unlimited projects", "White-label", "Dedicated success manager", "API access"],
  },
]

export default function BillingSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<"agency" | "partner">("agency")
  const [currentPlan, setCurrentPlan] = useState("studio")

  useEffect(() => {
    const loadUser = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        router.push("/auth/login")
        return
      }

      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single()

      if (data?.role) setUserRole(data.role)
      setLoading(false)
    }

    loadUser()
  }, [router])

  if (loading) {
    return (
      <SettingsLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
        </div>
      </SettingsLayout>
    )
  }

  return (
    <SettingsLayout userRole={userRole}>
      <div className="space-y-8">
        <div>
          <h2 className="font-display font-black text-2xl text-foreground mb-2">Billing</h2>
          <p className="text-foreground-muted">Manage your subscription and payment methods.</p>
        </div>

        {/* Current Plan */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
                <CreditCard className="w-6 h-6 text-accent" />
              </div>
              <div>
                <div className="font-display font-bold text-lg text-foreground">
                  Studio Plan
                </div>
                <div className="text-foreground-muted">
                  $699/month · Renews Apr 1, 2024
                </div>
              </div>
            </div>
            <span className="font-mono text-[10px] px-3 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/30">
              Active
            </span>
          </div>
        </div>

        {/* Plans */}
        <div>
          <h3 className="font-display font-bold text-lg text-foreground mb-4">Available Plans</h3>
          <div className="grid grid-cols-3 gap-4">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={cn(
                  "relative bg-white/5 backdrop-blur-xl border rounded-xl p-6",
                  plan.id === currentPlan 
                    ? "border-accent/50" 
                    : "border-border/30",
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
                  <span className="text-foreground-muted">{plan.period}</span>
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
                    <Link href="/contact">Contact Sales</Link>
                  </Button>
                ) : (
                  <Button className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
                    Upgrade
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Payment Method */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center font-mono text-foreground-muted text-sm">
                VISA
              </div>
              <div>
                <div className="font-medium text-foreground">Visa ending in 4242</div>
                <div className="text-foreground-muted text-sm">Expires 12/26</div>
              </div>
            </div>
            <Button variant="outline" size="sm" className="border-border/50 text-foreground-muted hover:text-foreground">
              Update
            </Button>
          </div>
        </div>
      </div>
    </SettingsLayout>
  )
}
