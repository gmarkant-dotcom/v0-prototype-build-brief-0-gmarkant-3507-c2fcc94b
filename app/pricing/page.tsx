"use client"

import { useState } from "react"
import Link from "next/link"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { LigamentLogo } from "@/components/ligament-logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { X, Loader2, CheckCircle } from "lucide-react"

interface PricingTier {
  name: string
  price: string
  period?: string
  annualPrice?: string
  badge?: string
  description: string
  features: string[]
  highlighted?: boolean
  cta: string
  productId: string
}

const tiers: PricingTier[] = [
  {
    name: "Core",
    price: "$250",
    period: "/month",
    annualPrice: "$2,000 billed annually",
    badge: "2026 Launch Users",
    description: "For agencies starting to scale their vendor operations",
    features: [
      "Up to 3 active engagements",
      "AI RFP generation & scoring",
      "Vendor onboarding packets",
      "Project dashboard",
      "Standard MSA templates",
      "Email support",
    ],
    cta: "Start with Core",
    productId: "core",
  },
  {
    name: "Studio",
    price: "$699",
    period: "/month",
    annualPrice: "$6,700 billed annually",
    description: "For growing agencies with multiple active projects",
    features: [
      "Up to 10 active engagements",
      "Everything in Core, plus:",
      "Custom vendor portal branding",
      "Utilization tracking & alerts",
      "Priority support",
    ],
    highlighted: false,
    cta: "Start with Studio",
    productId: "studio",
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For agency networks and enterprise operations",
    features: [
      "Unlimited engagements",
      "Everything in Studio, plus:",
      "White-label infrastructure",
      "API access & integrations",
      "Dedicated account manager",
      "Custom onboarding",
      "SLA guarantee",
    ],
    cta: "Contact Sales",
    productId: "enterprise",
  },
]

const companyTypes = [
  { value: "brand", label: "Brand" },
  { value: "agency", label: "Agency" },
  { value: "media_company", label: "Media Company" },
  { value: "production", label: "Production Company" },
]

const companySizes = [
  { value: "1-10", label: "1-10 employees" },
  { value: "11-50", label: "11-50 employees" },
  { value: "51-200", label: "51-200 employees" },
  { value: "201-500", label: "201-500 employees" },
  { value: "500+", label: "500+ employees" },
]

export default function PricingPage() {
  const [showContactModal, setShowContactModal] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    title: "",
    email: "",
    phone: "",
    companyType: "",
    companySize: "",
  })

  const handleOpenContactModal = (productId: string) => {
    setSelectedProduct(productId)
    setShowContactModal(true)
    setIsSubmitted(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...formData,
          interestedProduct: selectedProduct,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to submit")
      }

      setIsSubmitted(true)
    } catch (error) {
      console.error("Form submission error:", error)
      alert("There was an error submitting the form. Please try again or email hello@withligament.com directly.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCloseModal = () => {
    setShowContactModal(false)
    setSelectedProduct(null)
    setFormData({
      name: "",
      title: "",
      email: "",
      phone: "",
      companyType: "",
      companySize: "",
    })
    setIsSubmitted(false)
  }
  return (
    <div className="min-h-screen relative bg-background">
      <HolographicBlobs />
      
      {/* Header */}
      <header className="relative z-10 glass border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/">
            <LigamentLogo size="sm" variant="primary" />
          </Link>
          <div className="flex items-center gap-4">
            <Link 
              href="/auth/login"
              className="font-mono text-xs text-foreground-muted hover:text-foreground transition-colors"
            >
              Sign In
            </Link>
            <Button 
              onClick={() => handleOpenContactModal("get-started")}
              className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono text-xs"
            >
              Get Started
            </Button>
          </div>
        </div>
      </header>
      
      <main className="relative z-10 max-w-6xl mx-auto px-6 py-20">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="font-mono text-xs text-accent tracking-wider uppercase mb-4">
            Pricing
          </div>
          <h1 className="font-display font-black text-5xl md:text-6xl text-foreground mb-4">
            One team. Built to order.
          </h1>
          <p className="font-sans text-lg text-foreground-muted max-w-2xl mx-auto">
            The AI-powered vendor orchestration engine for independent agencies. 
            Choose the plan that fits your operation.
          </p>
        </div>
        
        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={cn(
                "glass-card rounded-2xl p-8 flex flex-col",
                tier.highlighted && "border-accent/40 bg-accent/5 ring-1 ring-accent/20"
              )}
            >
              {tier.badge && (
                <div className="font-mono text-[10px] text-accent bg-accent/10 px-3 py-1 rounded-full self-start mb-4 border border-accent/30">
                  {tier.badge}
                </div>
              )}
              
              <div className="mb-6">
                <h3 className="font-display font-bold text-2xl text-foreground mb-2">
                  {tier.name}
                </h3>
                <div className="flex items-baseline gap-2">
                  <span className="font-display font-black text-4xl text-foreground">
                    {tier.price}
                  </span>
                  {tier.period && (
                    <span className="font-mono text-sm text-foreground-muted">
                      {tier.period}
                    </span>
                  )}
                </div>
                {tier.annualPrice && (
                  <div className="font-mono text-xs text-foreground-muted mt-1">
                    or {tier.annualPrice}
                  </div>
                )}
                <p className="text-sm text-foreground-muted mt-2">
                  {tier.description}
                </p>
              </div>
              
              <ul className="space-y-3 flex-1 mb-8">
                {tier.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className={cn(
                      "mt-0.5",
                      tier.highlighted ? "text-accent" : "text-foreground-muted"
                    )}>
                      {feature.startsWith("Everything") ? "+" : "✓"}
                    </span>
                    <span className={cn(
                      feature.startsWith("Everything") 
                        ? "text-foreground font-medium" 
                        : "text-foreground-secondary"
                    )}>
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>
              
              <Button 
                onClick={() => handleOpenContactModal(tier.productId)}
                className={cn(
                  "w-full font-display font-bold",
                  tier.highlighted 
                    ? "bg-accent text-accent-foreground hover:bg-accent/90"
                    : "bg-white/10 text-foreground hover:bg-white/20"
                )}
              >
                {tier.cta}
              </Button>
            </div>
          ))}
        </div>
        
        {/* CTA Section */}
        <div className="glass-card rounded-2xl p-12 text-center">
          <h2 className="font-display font-black text-3xl text-foreground mb-4">
            See it in action.
          </h2>
          <p className="text-foreground-muted max-w-xl mx-auto mb-8">
            Book a 30-minute demo and watch LIGAMENT turn a live brief into a 
            vendor-assembled, contract-ready team — in real time.
          </p>
          <Button 
            onClick={() => handleOpenContactModal("demo")}
            className="bg-accent text-accent-foreground hover:bg-accent/90 font-display font-bold px-8"
          >
            Contact Sales
          </Button>
          
          <div className="mt-8 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-center gap-6 text-sm text-foreground-muted">
            <span className="font-mono text-[10px] uppercase tracking-wider">Contact</span>
            <span className="hidden sm:inline">·</span>
            <a href="mailto:hello@withligament.com" className="hover:text-foreground transition-colors font-mono text-xs">
              hello@withligament.com
            </a>
          </div>
        </div>
      </main>
      
      {/* Footer */}
      <footer className="relative z-10 border-t border-border mt-20">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <LigamentLogo size="sm" variant="primary" />
          <div className="font-mono text-[10px] text-foreground-muted/50">
            LIGAMENT is a product of Liveligood, Inc.
          </div>
        </div>
      </footer>

      {/* Contact Modal */}
      {showContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/95 backdrop-blur-sm" onClick={handleCloseModal}>
          <div 
            className="rounded-2xl p-8 w-full max-w-md bg-[#0a1a1a] border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-display font-bold text-xl text-foreground">
                  {isSubmitted ? "Thanks for your interest!" : "Get Started"}
                </h3>
                {!isSubmitted && (
                  <p className="font-mono text-xs text-foreground-muted mt-1">
                    Interested in: <span className="text-accent capitalize">{selectedProduct}</span>
                  </p>
                )}
              </div>
              <button 
                onClick={handleCloseModal}
                className="text-foreground-muted hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isSubmitted ? (
              <div className="text-center py-8">
                <CheckCircle className="w-16 h-16 text-accent mx-auto mb-4" />
                <p className="text-foreground-secondary mb-6">
                  We&apos;ve received your information and will be in touch shortly to discuss {selectedProduct === "enterprise" ? "your enterprise needs" : `the ${selectedProduct} plan`}.
                </p>
                <Button 
                  onClick={handleCloseModal}
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  Close
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Name *
                  </label>
                  <Input
                    required
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Your full name"
                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                  />
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Title *
                  </label>
                  <Input
                    required
                    value={formData.title}
                    onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Your job title"
                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                  />
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Email *
                  </label>
                  <Input
                    required
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="you@company.com"
                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                  />
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Phone
                  </label>
                  <Input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="(555) 555-5555"
                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                  />
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Company Type *
                  </label>
                  <select
                    required
                    value={formData.companyType}
                    onChange={(e) => setFormData(prev => ({ ...prev, companyType: e.target.value }))}
                    className="w-full rounded-md bg-white/5 border border-border text-foreground px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="" className="bg-background">Select company type</option>
                    {companyTypes.map(type => (
                      <option key={type.value} value={type.value} className="bg-background">
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Company Size *
                  </label>
                  <select
                    required
                    value={formData.companySize}
                    onChange={(e) => setFormData(prev => ({ ...prev, companySize: e.target.value }))}
                    className="w-full rounded-md bg-white/5 border border-border text-foreground px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="" className="bg-background">Select company size</option>
                    {companySizes.map(size => (
                      <option key={size.value} value={size.value} className="bg-background">
                        {size.label}
                      </option>
                    ))}
                  </select>
                </div>

                <Button 
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-display font-bold mt-6"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Submit"
                  )}
                </Button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
