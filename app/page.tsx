"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { LigamentLogo } from "@/components/ligament-logo"
import { Button } from "@/components/ui/button"
import { GlassCard } from "@/components/glass-card"
import { createClient } from "@/lib/supabase/client"
import { isDemoMode } from "@/lib/demo-data"
import { User, Building2, Users } from "lucide-react"

const HERO_EYEBROW_WORDS = ["Vendor", "Freelancer", "Studio", "Agency", "Production Partner", "Specialist"]

function HeroEyebrowRotator() {
  return (
    <span className="hero-eyebrow-rotator">
      {HERO_EYEBROW_WORDS.map((word, i) => (
        <span
          key={word}
          className="hero-eyebrow-word text-accent"
          style={{ animationDelay: `${i * 2.2}s` }}
        >
          {word}
        </span>
      ))}
    </span>
  )
}

const stages = [
  { number: "00", title: "Vendor Pool", oneLiner: "Build your network. Get discovered.", ai: false },
  { number: "01", title: "RFP Broadcast", oneLiner: "Send scoped RFPs. Submit competitive bids.", ai: true },
  { number: "02", title: "Bid Management", oneLiner: "AI compares and scores. You decide and award.", ai: true },
  { number: "03", title: "Onboarding", oneLiner: "Share docs and guidelines. Get project-ready.", ai: false },
  { number: "04", title: "Delivery Performance", oneLiner: "Evaluate vendor delivery. Build lasting intelligence.", ai: true },
]

const agencyFeatures = [
  {
    title: "00 - Vendor Pool",
    description: "Build your vendor network by importing contacts from email, inviting directly, or discovering new vendors on the marketplace.",
    callout: {
      title: "Your network, imported in minutes",
      description: "Scan your email or upload your existing vendor spreadsheet and your vendor pool builds itself. No manual data entry.",
    },
  },
  {
    title: "01 - RFP Broadcast",
    description: "Analyze client briefs with AI, then send scoped RFPs to your pool or any vendor via Magic Link. They can respond without creating an account.",
    callout: {
      title: "No-signup vendor bidding",
      description: "Send an RFP link any vendor can open, review, and bid on with zero account creation. Live for 72 hours, tracked end to end.",
    },
  },
  {
    title: "02 - Bid Management",
    description: "Compare bids side by side with AI cost decomposition. Score against configurable criteria with AI pre-scoring and human override. Surface pricing gaps, scope risks, and the best value in seconds.",
    callout: {
      title: "AI-decomposed bids",
      description: "Every bid broken into comparable cost components, scored against your criteria, compared side by side.",
    },
  },
  {
    title: "03 - Onboarding",
    description: "Send kickoff packages and brand guidelines. Track vendor onboarding across active projects.",
  },
  {
    title: "04 - Delivery Performance",
    description: "Rate vendor delivery against the same criteria you scored their bid on. Build a reliability index that turns every project into lasting intelligence.",
    callout: {
      title: "A track record on every vendor",
      description: "Delivery performance scores accumulate with every engagement, so you award on evidence, not memory.",
    },
  },
]

const partnerFeatures = [
  {
    title: "Agency Network",
    description: "Connect with lead agencies, respond to partnership invitations, and discover new agency relationships.",
  },
  {
    title: "Open RFPs & Bids",
    description: "Receive scoped RFPs, submit competitive bids, and track your status from submission to award.",
  },
  {
    title: "Onboarding",
    description: "Access kickoff packages, brand guidelines, and project documents from your lead agencies.",
  },
  {
    title: "Delivery & Projects",
    description: "Track your active engagements, submit status updates, and see your delivery performance scores. Your track record is your reputation.",
  },
]

export default function HomePage() {
  const [userRole, setUserRole] = useState<string | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setIsDemo(isDemoMode())

    const checkUserRole = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        // Check user_metadata first
        let role = user.user_metadata?.role as string | undefined

        // If not in metadata, check profiles table
        if (!role) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()
          role = profile?.role
        }

        setUserRole(role || null)
      }
      setIsLoading(false)
    }

    checkUserRole()
  }, [])

  return (
    <div className="min-h-screen relative bg-background">
      <HolographicBlobs />

      {/* Header */}
      <header className="relative z-10 glass border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <LigamentLogo size="sm" variant="primary" />
          <div className="flex items-center gap-4">
            <Link
              href="/faq"
              className="font-mono text-xs text-foreground/90 hover:text-foreground transition-colors"
            >
              FAQ
            </Link>
            <Link
              href="/pricing"
              className="font-mono text-xs text-foreground/90 hover:text-foreground transition-colors"
            >
              Pricing
            </Link>
            {!isLoading && userRole ? (
              <Link
                href={userRole === 'agency' ? '/agency' : '/partner'}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/10 border border-accent/30 hover:bg-accent/20 transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center">
                  <User className="w-4 h-4 text-accent-foreground" />
                </div>
                <span className="font-mono text-xs text-accent">My Account</span>
              </Link>
            ) : (
              <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono text-xs">
                <Link href="/auth/login">Log In</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="max-w-6xl mx-auto px-6 pt-16 md:pt-20 pb-10 md:pb-14">
          <div className="max-w-3xl">
            <div className="font-mono text-base md:text-lg text-accent tracking-wider uppercase mb-6 flex items-center gap-3">
              <span className="ai-badge">✦</span>
              <span className="text-foreground/80">
                Best Practice <HeroEyebrowRotator /> Procurement &amp; Orchestration for Independent Creative Agencies
              </span>
            </div>
            <h1 className="font-display font-black text-5xl md:text-7xl text-foreground leading-[0.95] mb-10">
              Brief to <span className="text-accent">bid</span> to <span className="text-accent">award</span>.<br />
              Without the chaos.
            </h1>
            <p className="text-lg text-foreground-muted max-w-xl mb-8 leading-relaxed">
              Smarter vendor procurement at every step. Build your network. Broadcast RFPs. Compare bids with AI. Award with confidence. One platform that gets smarter with every engagement.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90 font-display font-bold text-lg px-8 py-6">
                <Link href="/auth/login">Launch Lead Agency Portal</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="border-border text-foreground hover:bg-white/10 font-display font-bold text-lg px-8 py-6 bg-transparent"
              >
                <Link href="/auth/login">I&apos;m a vendor</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Two Portals */}
        <section className="border-y border-border py-10 md:py-14">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-8">
              <div className="font-mono text-xs text-accent tracking-wider uppercase mb-4">
                Two Portals. One Platform.
              </div>
              <h2 className="font-display font-black text-4xl text-foreground mb-8">
                Built for both sides of every vendor relationship.
              </h2>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-10 max-w-3xl mx-auto">
                <div className="flex items-center gap-2 text-foreground-muted">
                  <Building2 className="w-5 h-5 text-accent shrink-0" />
                  <span>Lead agencies manage their vendor network and procurement lifecycle.</span>
                </div>
                <div className="flex items-center gap-2 text-foreground-muted">
                  <Users className="w-5 h-5 text-foreground-muted shrink-0" />
                  <span>Vendors showcase their work, respond to opportunities, and build their reputation.</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* For Lead Agencies */}
        <section className="py-10 md:py-14">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-12">
              <div className="font-mono text-xs text-accent tracking-wider uppercase mb-4">
                For Lead Agencies
              </div>
              <h3 className="font-display font-bold text-4xl text-accent mb-4">
                Lead Agency Portal
              </h3>
              <p className="text-foreground-muted max-w-2xl mx-auto">
                Stop chasing vendors across email, spreadsheets, and shared drives. Go from brief to awarded vendor in one streamlined workflow.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
              {agencyFeatures.map((feature) => (
                <div
                  key={feature.title}
                  className="p-5 rounded-lg bg-accent/5 border border-border border-l-4 border-l-accent hover:scale-[1.02] transition-transform duration-200"
                >
                  <h4 className="font-display font-bold text-sm text-foreground mb-2">
                    {feature.title}
                  </h4>
                  <p className="text-xs text-foreground-muted leading-relaxed">
                    {feature.description}
                  </p>
                  {feature.callout && (
                    <div className="mt-3 pl-3 border-l-2 border-l-accent/50">
                      <p className="text-xs text-foreground-muted leading-relaxed">
                        <span className="font-bold text-foreground">{feature.callout.title}:</span>{" "}
                        {feature.callout.description}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="text-center">
              <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90 font-display font-bold px-8">
                <Link href="/auth/login">Enter Lead Agency Portal →</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* For Vendors */}
        <section className="border-t border-border py-10 md:py-14">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-12">
              <div className="font-mono text-xs text-foreground-muted tracking-wider uppercase mb-4">
                For Vendors
              </div>
              <h3 className="font-display font-bold text-4xl text-foreground mb-4">
                Vendor Portal
              </h3>
              <p className="text-foreground-muted max-w-2xl mx-auto">
                Get discovered, win work, and build your track record.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
              {partnerFeatures.map((feature) => (
                <div
                  key={feature.title}
                  className="p-5 rounded-lg bg-white/5 border border-border border-l-4 border-l-foreground-muted/60 hover:scale-[1.02] transition-transform duration-200"
                >
                  <h4 className="font-display font-bold text-sm text-foreground mb-2">
                    {feature.title}
                  </h4>
                  <p className="text-xs text-foreground-muted leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>

            <div className="text-center">
              <Button asChild variant="outline" className="border-border text-foreground hover:bg-white/10 font-display font-bold px-8 bg-transparent">
                <Link href="/auth/login">Enter Vendor Portal →</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Workflow */}
        <section className="border-t border-border py-10 md:py-14">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-16">
              <div className="font-mono text-xs text-accent tracking-wider uppercase mb-4">
                The Workflow
              </div>
              <h2 className="font-display font-black text-4xl text-foreground mb-4">
                5 stages. End to end.
              </h2>
              <p className="text-foreground-muted max-w-xl mx-auto">
                Every vendor engagement flows through 5 stages. From brief to bid to award, AI assists at key decision points. You stay in control.
              </p>
            </div>

            {/* Desktop: horizontal connected timeline */}
            <div className="hidden md:grid grid-cols-5">
              {stages.map((stage, i) => (
                <div key={stage.number} className="relative flex flex-col items-center text-center px-2">
                  {i > 0 && <div className="absolute left-0 top-7 w-1/2 h-px bg-border" aria-hidden="true" />}
                  {i < stages.length - 1 && <div className="absolute right-0 top-7 w-1/2 h-px bg-border" aria-hidden="true" />}
                  <div className="relative z-10 w-14 h-14 rounded-full border-2 border-accent bg-background flex items-center justify-center mb-4">
                    <span className="font-mono text-sm font-bold text-foreground">{stage.number}</span>
                    {stage.ai && (
                      <span className="ai-badge absolute -top-2 -right-2 w-6 h-6 rounded-full bg-accent flex items-center justify-center text-accent-foreground text-2xs font-bold">
                        ✦
                      </span>
                    )}
                  </div>
                  <h3 className="font-display font-bold text-base text-foreground mb-1">
                    {stage.title}
                  </h3>
                  <p className="text-xs text-foreground-muted leading-relaxed max-w-[150px]">
                    {stage.oneLiner}
                  </p>
                </div>
              ))}
            </div>

            {/* Mobile: vertical connected timeline */}
            <div className="md:hidden">
              {stages.map((stage, i) => (
                <div key={stage.number} className="relative flex gap-4 pb-10 last:pb-0">
                  {i < stages.length - 1 && <div className="absolute left-7 top-14 bottom-0 w-px bg-border" aria-hidden="true" />}
                  <div className="relative z-10 w-14 h-14 rounded-full border-2 border-accent bg-background flex items-center justify-center shrink-0">
                    <span className="font-mono text-sm font-bold text-foreground">{stage.number}</span>
                    {stage.ai && (
                      <span className="ai-badge absolute -top-2 -right-2 w-6 h-6 rounded-full bg-accent flex items-center justify-center text-accent-foreground text-2xs font-bold">
                        ✦
                      </span>
                    )}
                  </div>
                  <div className="pt-2">
                    <h3 className="font-display font-bold text-base text-foreground mb-1">
                      {stage.title}
                    </h3>
                    <p className="text-xs text-foreground-muted leading-relaxed">
                      {stage.oneLiner}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="py-10 md:py-14 bg-gradient-to-b from-transparent to-accent/5">
          <div className="max-w-6xl mx-auto px-6">
            <GlassCard className="p-12 text-center">
              <h2 className="font-display font-black text-4xl text-foreground mb-4">
                Ready to orchestrate?
              </h2>
              <p className="text-foreground-muted max-w-xl mx-auto mb-8">
                The chaos is optional. Sign up, import your vendors, and send your first RFP in under 10 minutes.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90 font-display font-bold text-lg px-10 py-7">
                  <Link href="/auth/login">Launch Lead Agency Portal</Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="border-border text-foreground hover:bg-white/10 font-display font-bold text-lg px-10 py-7 bg-transparent"
                >
                  <Link href="/auth/login">I&apos;m a vendor</Link>
                </Button>
              </div>
            </GlassCard>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row items-start justify-between gap-8">
            <div>
              <LigamentLogo size="md" variant="primary" className="mb-4" />
              <p className="text-sm text-foreground-muted max-w-xs">
                Best Practice Vendor Procurement & Orchestration for Independent Creative Agencies
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-12">
              <div>
                <div className="font-mono text-2xs text-foreground-muted uppercase tracking-wider mb-4">
                  Lead Agencies
                </div>
                <div className="space-y-2">
                  <Link href="/agency" className="block text-sm text-foreground-secondary hover:text-foreground transition-colors">
                    Lead Agency Portal
                  </Link>
                  <Link href="/agency/pool" className="block text-sm text-foreground-secondary hover:text-foreground transition-colors">
                    Vendor Pool
                  </Link>
                  <Link href="/agency/ai" className="block text-sm text-foreground-secondary hover:text-foreground transition-colors">
                    AI Engine
                  </Link>
                  <Link href="/pricing" className="block text-sm text-foreground-secondary hover:text-foreground transition-colors">
                    Pricing
                  </Link>
                </div>
              </div>

              <div>
                <div className="font-mono text-2xs text-foreground-muted uppercase tracking-wider mb-4">
                  Vendors
                </div>
                <div className="space-y-2">
                  <Link href="/partner" className="block text-sm text-foreground-secondary hover:text-foreground transition-colors">
                    Vendor Portal
                  </Link>
                  <Link href="/partner/rfps" className="block text-sm text-foreground-secondary hover:text-foreground transition-colors">
                    Open RFPs
                  </Link>
                  <Link href="/partner/profile" className="block text-sm text-foreground-secondary hover:text-foreground transition-colors">
                    Profile Setup
                  </Link>
                  <Link href="/partner/payments" className="block text-sm text-foreground-secondary hover:text-foreground transition-colors">
                    Payments
                  </Link>
                </div>
              </div>

              <div>
                <div className="font-mono text-2xs text-foreground-muted uppercase tracking-wider mb-4">
                  Contact
                </div>
                <div className="space-y-2">
                  <a href="mailto:hello@withligament.com" className="block text-sm text-foreground-secondary hover:text-foreground transition-colors font-mono">
                    hello@withligament.com
                  </a>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
              <div className="font-mono text-2xs text-foreground-muted/50">
                LIGAMENT is a product of Liveligood, Inc.
              </div>
              <div className="flex items-center gap-3">
                <Link href="/terms" className="font-mono text-2xs text-foreground-muted hover:text-foreground transition-colors">
                  Terms
                </Link>
                <span className="text-foreground-muted/30">|</span>
                <Link href="/privacy" className="font-mono text-2xs text-foreground-muted hover:text-foreground transition-colors">
                  Privacy
                </Link>
              </div>
            </div>
            <div className="font-mono text-2xs text-foreground-muted border border-white/20 rounded-full px-3 py-1">
              Q2 · 2026
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
