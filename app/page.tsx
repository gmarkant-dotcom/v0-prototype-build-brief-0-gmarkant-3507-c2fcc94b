"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { LigamentLogo } from "@/components/ligament-logo"
import { Button } from "@/components/ui/button"
import { GlassCard } from "@/components/glass-card"
import { createClient } from "@/lib/supabase/client"
import { isDemoMode } from "@/lib/demo-data"
import { User, Settings } from "lucide-react"

const stages = [
  { number: "01", title: "RFP Broadcast", description: "AI generates sanitized RFPs, protecting client identity", ai: true },
  { number: "02", title: "Bid Management", description: "Score vendors 0-100, flag gaps, recommend action", ai: true },
  { number: "03", title: "Onboarding", description: "Brand rules, ways of working, seamless integration", ai: false },
  { number: "04", title: "Project Dashboard", description: "Command view linking to your existing PM tools", ai: false },
  { number: "05", title: "Utilization", description: "Track scope drift, trigger change order alerts", ai: true },
  { number: "06", title: "MSA + Payments", description: "Two-tier contracts, milestone-based payments", ai: true },
]

const agencyFeatures = [
  {
    title: "Vendor Pool Management",
    description: "Build and manage a curated roster of trusted partners. Bookmark favorites for quick access.",
  },
  {
    title: "AI-Powered RFPs",
    description: "Generate professional, sanitized RFPs in seconds. Client identity masked, budget withheld.",
  },
  {
    title: "Vendor Scoring",
    description: "Objective 0-100 scoring on experience, team, approach, timeline, and value.",
  },
  {
    title: "Margin Protection",
    description: "Track vendor spend vs. client budget. Protect your margin automatically.",
  },
]

const partnerFeatures = [
  {
    title: "Respond to RFPs",
    description: "Raise your hand for opportunities from agencies in your network.",
  },
  {
    title: "Showcase Capabilities",
    description: "Profile your expertise, credentials, and portfolio to attract the right projects.",
  },
  {
    title: "Legal & Compliance",
    description: "Upload insurance, contracts, and compliance docs once. Reuse across engagements.",
  },
  {
    title: "Get Paid Faster",
    description: "Set up payment preferences and track milestones. Automatic invoicing.",
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
              href="/pricing"
              className="font-mono text-xs text-foreground-muted hover:text-foreground transition-colors"
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
        <section className="max-w-6xl mx-auto px-6 pt-24 pb-20">
          <div className="max-w-3xl">
            <div className="font-mono text-xs text-accent tracking-wider uppercase mb-6 flex items-center gap-3">
              <span className="ai-badge">✦</span> AI-Powered Vendor Orchestration
            </div>
            <h1 className="font-display font-black text-6xl md:text-7xl text-foreground leading-[0.9] mb-6">
              One team.<br />
              Built to order.<br />
              <span className="text-accent">Invisibly.</span>
            </h1>
            <p className="text-lg text-foreground-muted max-w-xl mb-8 leading-relaxed">
              The AI-powered vendor orchestration engine for independent agencies. 
              Assemble, manage, align, and pay external vendor partners while presenting 
              them to clients as one unified, branded team.
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
                <Link href="/auth/login">I&apos;m a Partner</Link>
              </Button>
            </div>
          </div>
        </section>
        
        {/* Two Sides */}
        <section className="border-y border-border py-20">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-12">
              <div className="font-mono text-xs text-accent tracking-wider uppercase mb-4">
                Two Portals. One Platform.
              </div>
              <h2 className="font-display font-black text-4xl text-foreground mb-4">
                Built for both sides of the partnership.
              </h2>
              <p className="text-foreground-muted max-w-2xl mx-auto">
                Lead agencies manage their vendor pool and orchestrate projects. 
                Partner resources showcase capabilities, respond to RFPs, and get paid.
              </p>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Agency Side */}
              <GlassCard highlight className="p-8">
                <div className="font-mono text-[10px] text-accent mb-3">For Lead Agencies</div>
                <h3 className="font-display font-bold text-3xl text-accent mb-4">
                  Lead Agency Portal
                </h3>
                <p className="text-foreground-muted mb-6">
                  Build a roster of trusted vendors. Broadcast RFPs to your bookmarked partners. 
                  Review bids, onboard teams, and manage payments, all from one dashboard.
                </p>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  {agencyFeatures.map((feature) => (
                    <div key={feature.title} className="p-4 rounded-lg bg-accent/5 border border-accent/20">
                      <h4 className="font-display font-bold text-sm text-foreground mb-1">
                        {feature.title}
                      </h4>
                      <p className="text-xs text-foreground-muted">
                        {feature.description}
                      </p>
                    </div>
                  ))}
                </div>
                <Button asChild className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-display font-bold">
                  <Link href="/auth/login">Enter Lead Agency Portal →</Link>
                </Button>
              </GlassCard>
              
              {/* Partner Side */}
              <GlassCard className="p-8">
                <div className="font-mono text-[10px] text-foreground-muted mb-3">For External Resources</div>
                <h3 className="font-display font-bold text-3xl text-foreground mb-4">
                  Partner Portal
                </h3>
                <p className="text-foreground-muted mb-6">
                  Join agency networks. Get discovered for the right projects. 
                  Submit bids, complete onboarding, and track your payments, all in one place.
                </p>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  {partnerFeatures.map((feature) => (
                    <div key={feature.title} className="p-4 rounded-lg bg-white/5 border border-border">
                      <h4 className="font-display font-bold text-sm text-foreground mb-1">
                        {feature.title}
                      </h4>
                      <p className="text-xs text-foreground-muted">
                        {feature.description}
                      </p>
                    </div>
                  ))}
                </div>
                <Button asChild variant="outline" className="w-full border-border text-foreground hover:bg-white/10 font-display font-bold bg-transparent">
                  <Link href="/auth/login">Enter Partner Portal →</Link>
                </Button>
              </GlassCard>
            </div>
          </div>
        </section>
        
        {/* 6-Stage Workflow */}
        <section className="py-20">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-12">
              <div className="font-mono text-xs text-accent tracking-wider uppercase mb-4">
                The Workflow
              </div>
              <h2 className="font-display font-black text-4xl text-foreground mb-4">
                6 stages. End to end.
              </h2>
              <p className="text-foreground-muted max-w-xl mx-auto">
                Every engagement flows through 6 stages. AI assists at key decision points. 
                Human review where it matters most.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stages.map((stage) => (
                <GlassCard 
                  key={stage.number} 
                  highlight={stage.ai}
                  className="group hover:border-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className="font-mono text-xs text-foreground-muted">
                      {stage.number}
                    </span>
                    {stage.ai && (
                      <span className="font-mono text-[10px] text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/30 flex items-center gap-1">
                        <span className="ai-badge">✦</span> AI
                      </span>
                    )}
                  </div>
                  <h3 className="font-display font-bold text-xl text-foreground mb-2 group-hover:text-accent transition-colors">
                    {stage.title}
                  </h3>
                  <p className="text-sm text-foreground-muted">
                    {stage.description}
                  </p>
                </GlassCard>
              ))}
            </div>
          </div>
        </section>
        
        {/* How It Works */}
        <section className="border-t border-border py-20">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-12">
              <div className="font-mono text-xs text-accent tracking-wider uppercase mb-4">
                How It Works
              </div>
              <h2 className="font-display font-black text-4xl text-foreground mb-4">
                From brief to billable in one workflow.
              </h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[
                { step: "1", title: "Build Your Pool", description: "Curate a roster of trusted vendors. Bookmark your favorites for quick access." },
                { step: "2", title: "Broadcast RFPs", description: "Generate AI-powered RFPs and send to selected vendors from your pool." },
                { step: "3", title: "Review & Onboard", description: "Score bids, select partners, and onboard them to your brand standards." },
                { step: "4", title: "Deliver & Pay", description: "Track utilization, manage milestones, and process payments automatically." },
              ].map((item) => (
                <div key={item.step} className="text-center">
                  <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center mx-auto mb-4">
                    <span className="font-mono text-lg text-accent">{item.step}</span>
                  </div>
                  <h3 className="font-display font-bold text-lg text-foreground mb-2">
                    {item.title}
                  </h3>
                  <p className="text-sm text-foreground-muted">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
        
        {/* CTA */}
        <section className="py-20">
          <div className="max-w-6xl mx-auto px-6">
            <GlassCard className="p-12 text-center">
              <h2 className="font-display font-black text-4xl text-foreground mb-4">
                Ready to orchestrate?
              </h2>
              <p className="text-foreground-muted max-w-xl mx-auto mb-8">
                Whether you&apos;re a lead agency looking to scale, or a partner looking for opportunities. 
                LIGAMENT connects both sides of the equation.
              </p>
<div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90 font-display font-bold px-8">
                <Link href="/auth/login">Launch Lead Agency Portal</Link>
              </Button>
              <Button 
                asChild 
                variant="outline" 
                className="border-border text-foreground hover:bg-white/10 font-display font-bold px-8 bg-transparent"
              >
                <Link href="/auth/login">I&apos;m a Partner</Link>
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
                The AI-powered vendor orchestration engine for independent agencies.
              </p>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-12">
              <div>
                <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-4">
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
                <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-4">
                  Partners
                </div>
                <div className="space-y-2">
                  <Link href="/partner" className="block text-sm text-foreground-secondary hover:text-foreground transition-colors">
                    Partner Portal
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
                <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-4">
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
            <div className="font-mono text-[10px] text-foreground-muted/50">
              LIGAMENT is a product of Liveligood, Inc.
            </div>
            <div className="font-mono text-[10px] text-foreground-muted border border-white/20 rounded-full px-3 py-1">
              Q2 · 2026
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
