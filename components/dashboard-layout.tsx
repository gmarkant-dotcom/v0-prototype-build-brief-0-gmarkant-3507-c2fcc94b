"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { HolographicBlobs } from "./holographic-blobs"
import { LigamentLogo } from "./ligament-logo"

interface Stage {
  number: string
  title: string
  shortTitle: string
  aiPowered: boolean
  href: string
}

const stages: Stage[] = [
  { number: "01", title: "RFP Broadcast + Scoring", shortTitle: "RFP Broadcast", aiPowered: true, href: "/agency" },
  { number: "02", title: "Bid Management + Award", shortTitle: "Bid Management", aiPowered: true, href: "/agency/bids" },
  { number: "03", title: "Onboarding + Ways of Working", shortTitle: "Onboarding", aiPowered: false, href: "/agency/onboarding" },
  { number: "04", title: "Project Dashboard", shortTitle: "Project Dashboard", aiPowered: false, href: "/agency/dashboard" },
  { number: "05", title: "Utilization Tracking", shortTitle: "Utilization", aiPowered: true, href: "/agency/utilization" },
  { number: "06", title: "MSA + Payments", shortTitle: "MSA + Payments", aiPowered: true, href: "/agency/payments" },
]

interface DashboardLayoutProps {
  children: React.ReactNode
  activeStage?: string
}

export function DashboardLayout({ children, activeStage }: DashboardLayoutProps) {
  const pathname = usePathname()
  
  return (
    <div className="min-h-screen relative">
      <HolographicBlobs />
      
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 bottom-0 w-[260px] glass border-r border-border z-20 flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-border">
          <Link href="/">
            <LigamentLogo size="md" variant="primary" />
          </Link>
        </div>
        
        {/* Navigation */}
        <nav className="flex-1 p-4 overflow-y-auto">
          <div className="space-y-1">
            {stages.map((stage) => {
              const isActive = activeStage === stage.number || pathname === stage.href
              return (
                <Link
                  key={stage.number}
                  href={stage.href}
                  className={cn(
                    "flex items-start gap-3 px-3 py-3 rounded-lg transition-all group",
                    isActive 
                      ? "bg-accent/10 border border-accent/30" 
                      : "hover:bg-white/5 border border-transparent"
                  )}
                >
                  <span className={cn(
                    "font-mono text-xs font-medium mt-0.5",
                  isActive ? "text-accent" : "text-foreground/80"
                  )}>
                    {stage.number}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className={cn(
                      "font-display font-bold text-sm leading-tight",
                      isActive ? "text-accent" : "text-foreground group-hover:text-white"
                    )}>
                      {stage.shortTitle}
                    </div>
                    {stage.aiPowered && (
                      <div className={cn(
                        "font-mono text-[10px] mt-1 flex items-center gap-1",
                        isActive ? "text-accent" : "text-foreground/75"
                      )}>
                        <span className="ai-badge">✦</span> AI-powered
                      </div>
                    )}
                  </div>
                  {isActive && (
                    <div className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5" />
                  )}
                </Link>
              )
            })}
          </div>
          
          {/* Divider */}
          <div className="my-4 border-t border-border" />
          
          {/* Secondary Navigation */}
          <div className="space-y-1">
            <Link
              href="/ai-engine"
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all",
                pathname === "/ai-engine" || pathname?.startsWith("/ai-engine")
                  ? "bg-accent/10 text-accent border border-accent/30"
                  : "text-foreground/80 hover:text-white hover:bg-white/5 border border-transparent"
              )}
            >
              <span className="text-sm">✦</span>
              <span className="font-mono text-xs">AI Engine</span>
            </Link>
            <Link
              href="/vendor"
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all",
                pathname === "/vendor" || pathname?.startsWith("/vendor")
                  ? "bg-accent/10 text-accent border border-accent/30"
                  : "text-foreground/80 hover:text-white hover:bg-white/5 border border-transparent"
              )}
            >
              <span className="text-sm">◈</span>
              <span className="font-mono text-xs">Vendor Portal</span>
            </Link>
            <Link
              href="/pricing"
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all",
                pathname === "/pricing"
                  ? "bg-accent/10 text-accent border border-accent/30"
                  : "text-foreground/80 hover:text-white hover:bg-white/5 border border-transparent"
              )}
            >
              <span className="text-sm">◇</span>
              <span className="font-mono text-xs">Pricing</span>
            </Link>
          </div>
        </nav>
        
        {/* Footer */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[10px] text-foreground-muted border border-white/20 rounded-full px-3 py-1">
              Q2 · 2026
            </div>
            <div className="font-mono text-[9px] text-foreground-muted/50">
              withligament.com
            </div>
          </div>
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="ml-[260px] min-h-screen relative z-10">
        {children}
      </main>
    </div>
  )
}
