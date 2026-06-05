"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { HolographicBlobs } from "./holographic-blobs"
import { LigamentLogo } from "./ligament-logo"
import { createClient } from "@/lib/supabase/client"
import { isDemoMode } from "@/lib/demo-data"
import { Settings, LogOut, User, ChevronDown, Shield, CreditCard } from "lucide-react"
import { SelectedProjectProvider } from "@/contexts/selected-project-context"
import { PaidUserProvider } from "@/contexts/paid-user-context"
import { AgencySubscriptionGate } from "@/components/agency-subscription-gate"
import { RoleToggle } from "@/components/role-toggle"

declare global {
  interface Window {
    __ligamentRefreshAvatar?: () => void
  }
}

const navSections = [
  {
    label: "Overview",
    items: [
      { icon: "◉", title: "Summary Dashboard", href: "/agency/dashboard" },
    ]
  },
  {
    label: "Project Workflow",
    items: [
      { number: "01", title: "RFP Broadcast", aiPowered: true, href: "/agency" },
      { number: "02", title: "Bid Management", aiPowered: true, href: "/agency/bids" },
      { number: "03", title: "Onboarding", aiPowered: false, href: "/agency/onboarding" },
      { number: "04", title: "Active Engagements", aiPowered: false, href: "/agency/project" },
      { number: "05", title: "Utilization", aiPowered: true, href: "/agency/utilization" },
      { number: "06", title: "Cash Flow", aiPowered: true, href: "/agency/cashflow" },
    ]
  },
  {
    label: "Resources",
    items: [
      { icon: "◈", title: "Partner Pool", href: "/agency/pool" },
      { icon: "✦", title: "Marketplace", href: "/agency/pool/marketplace" },
      { icon: "□", title: "Documents", href: "/agency/documents" },
    ]
  }
]

interface AgencyLayoutProps {
  children: React.ReactNode
}

function AgencyLayoutInner({ children }: AgencyLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [userName, setUserName] = useState("Lead Agency")
  const [userInitials, setUserInitials] = useState("LA")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarLoadError, setAvatarLoadError] = useState(false)
  const [isDemo, setIsDemo] = useState(false)
  const [isOwner, setIsOwner] = useState(false) // Only greg@withligament.com can see admin

  
  // Check demo mode on mount
  useEffect(() => {
    setIsDemo(isDemoMode())
  }, [])
  
  const isWorkflowPage = pathname !== "/agency/dashboard" && 
    (pathname?.startsWith("/agency/") || pathname === "/agency")

  const loadUser = async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // SECURITY: Only show admin link if user is the owner
        // This is a hard-coded check that cannot be bypassed
        const OWNER_EMAIL = 'greg@withligament.com'
        setIsOwner(user.email === OWNER_EMAIL)
        
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name, company_name, company_logo_url")
            .eq("id", user.id)
            .single()
          if (profile) {
            setUserName(profile.company_name || profile.full_name || "Lead Agency")
            setAvatarUrl(profile.company_logo_url || null)
            setAvatarLoadError(false)
            const initials = (profile.company_name || profile.full_name || "A")
              .split(" ")
              .map((n: string) => n[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)
            setUserInitials(initials)
          }
        } catch {
          // Profile table doesn't exist or query failed, use defaults
        }
      }
    } catch {
      // Auth query failed, use defaults
    }
  }

  useEffect(() => {
    loadUser()
  }, [])

  useEffect(() => {
    window.__ligamentRefreshAvatar = loadUser
    return () => { delete window.__ligamentRefreshAvatar }
  }, [])

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/")
    router.refresh()
  }

  

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
          <div className="mt-2 font-mono text-[10px] text-accent bg-accent/10 px-2 py-1 rounded inline-block">
            Lead Agency
          </div>
          <RoleToggle />
        </div>
        
        {/* Navigation */}
        <nav className="flex-1 p-4 overflow-y-auto">
          {/* Overview Section */}
          <div className="mb-4">
            <div className="font-mono text-[10px] text-foreground-muted/60 uppercase tracking-wider px-3 mb-2">
              Overview
            </div>
            <div className="space-y-1">
              <Link
                href="/agency/dashboard"
                className={cn(
                  "flex items-start gap-3 px-3 py-2.5 rounded-lg transition-all group",
                  pathname === "/agency/dashboard"
                    ? "bg-accent/10 border border-accent/30" 
                    : "hover:bg-white/5 border border-transparent"
                )}
              >
                <span className={cn(
                  "text-sm mt-0.5",
                  pathname === "/agency/dashboard" ? "text-accent" : "text-foreground-muted"
                )}>
                  ◉
                </span>
                <div className="flex-1 min-w-0">
                  <div className={cn(
                    "font-display font-bold text-sm leading-tight",
                    pathname === "/agency/dashboard" ? "text-accent" : "text-foreground group-hover:text-white"
                  )}>
                    Summary Dashboard
                  </div>
                </div>
                {pathname === "/agency/dashboard" && (
                  <div className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5" />
                )}
              </Link>
            </div>
          </div>
          
          </div>
          
          {/* Workflow and Resources Sections */}
          {navSections.filter(s => s.label !== "Overview").map((section) => (
            <div key={section.label} className="mb-6">
              <div className="font-mono text-[10px] text-foreground-muted/60 uppercase tracking-wider px-3 mb-2">
                {section.label}
              </div>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const isActive = pathname === item.href || 
                    (item.href !== "/agency" && pathname?.startsWith(item.href))
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-start gap-3 px-3 py-2.5 rounded-lg transition-all group",
                        isActive 
                          ? "bg-accent/10 border border-accent/30" 
                          : "hover:bg-white/5 border border-transparent"
                      )}
                    >
                      {'number' in item ? (
                        <span className={cn(
                          "font-mono text-xs font-medium mt-0.5",
                          isActive ? "text-accent" : "text-foreground-muted"
                        )}>
                          {item.number}
                        </span>
                      ) : (
                        <span className={cn(
                          "text-sm mt-0.5",
                          isActive ? "text-accent" : "text-foreground-muted"
                        )}>
                          {item.icon}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className={cn(
                          "font-display font-bold text-sm leading-tight",
                          isActive ? "text-accent" : "text-foreground group-hover:text-white"
                        )}>
                          {item.title}
                        </div>
                        {'aiPowered' in item && item.aiPowered && (
                          <div className={cn(
                            "font-mono text-[10px] mt-0.5 flex items-center gap-1",
                            isActive ? "text-accent" : "text-foreground-muted"
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
            </div>
          ))}
        </nav>
        
        {/* User + Footer */}
        <div className="p-4 border-t border-border">
          <div className="relative">
            <button 
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="w-full flex items-center gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                {avatarUrl && !avatarLoadError ? (
                  <img
                    src={avatarUrl}
                    alt="Account avatar"
                    crossOrigin="anonymous"
                    className="w-8 h-8 rounded-full object-cover"
                    onError={() => setAvatarLoadError(true)}
                  />
                ) : (
                  <span className="font-mono text-xs text-accent">{userInitials}</span>
                )}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <div className="font-display font-bold text-sm text-foreground truncate">{userName}</div>
                <div className="font-mono text-[10px] text-foreground-muted">Lead Agency Account</div>
              </div>
              <ChevronDown className={cn(
                "w-4 h-4 text-foreground-muted transition-transform",
                userMenuOpen && "rotate-180"
              )} />
            </button>
            
            {userMenuOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-background border border-border rounded-lg shadow-xl overflow-hidden">
                <Link
                  href="/agency/settings/user"
                  onClick={() => setUserMenuOpen(false)}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
                >
                  <Settings className="w-4 h-4 text-foreground-muted" />
                  <span className="text-sm text-foreground">User Profile</span>
                </Link>
                <Link
                  href="/agency/settings/profile"
                  onClick={() => setUserMenuOpen(false)}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
                >
                  <User className="w-4 h-4 text-foreground-muted" />
                  <span className="text-sm text-foreground">Company Profile & Capabilities</span>
                </Link>
                <Link
                  href="/agency/settings/billing"
                  onClick={() => setUserMenuOpen(false)}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
                >
                  <CreditCard className="w-4 h-4 text-foreground-muted" />
                  <span className="text-sm text-foreground">Billing & Plan</span>
                </Link>
                {isOwner && (
                  <Link
                    href="/admin/users"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
                  >
                    <Shield className="w-4 h-4 text-amber-400" />
                    <span className="text-sm text-foreground">Admin Panel</span>
                  </Link>
                )}
                <div className="border-t border-border">
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-500/10 transition-colors text-red-400"
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="text-sm">Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          {isDemo && (
            <div className="flex items-center justify-between mt-3">
              <Link href="/partner" className="font-mono text-[10px] text-foreground-muted hover:text-accent transition-colors">
                Switch to Partner View →
              </Link>
            </div>
          )}
          
          {/* Legal Footer */}
          <div className="mt-4 pt-3 border-t border-border/30 flex items-center justify-center gap-3">
            <Link 
              href="/terms" 
              className="font-mono text-[9px] text-foreground-muted/60 hover:text-foreground-muted transition-colors"
            >
              Terms
            </Link>
            <span className="text-foreground-muted/30">|</span>
            <Link 
              href="/privacy" 
              className="font-mono text-[9px] text-foreground-muted/60 hover:text-foreground-muted transition-colors"
            >
              Privacy
            </Link>
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

export function AgencyShell({ children }: AgencyLayoutProps) {
  return (
    <SelectedProjectProvider>
      <AgencyLayoutInner>{children}</AgencyLayoutInner>
    </SelectedProjectProvider>
  )
}

export function AgencyLayout({ children }: AgencyLayoutProps) {
  return (
    <PaidUserProvider>
      <AgencySubscriptionGate>
        <AgencyShell>{children}</AgencyShell>
      </AgencySubscriptionGate>
    </PaidUserProvider>
  )
}
