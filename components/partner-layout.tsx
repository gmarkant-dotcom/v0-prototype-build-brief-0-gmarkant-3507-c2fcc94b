"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { isDemoMode } from "@/lib/demo-data"
import { Settings, LogOut, User, ChevronDown, Globe, ArrowUpRight } from "lucide-react"
import { LigamentLogo } from "./ligament-logo"
import { PaidUserProvider } from "@/contexts/paid-user-context"
import { LeadAgencyFilterProvider } from "@/contexts/lead-agency-filter-context"
import { RoleToggle } from "./role-toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

declare global {
  interface Window {
    __ligamentRefreshAvatar?: () => void
  }
}

type NavItem = { icon?: string; number?: string; title: string; href: string; tooltip: string }

/**
 * Grouped to mirror the lead agency's workflow-stage nav (components/agency-layout.tsx):
 * Summary Dashboard, then the 00-03 engagement stages, then Resources. Rendered with a
 * vertical divider between groups instead of inline section labels - horizontal top bar
 * has no room for both step numbers and text labels.
 */
const navGroups: NavItem[][] = [
  [
    { icon: "◇", title: "Summary Dashboard", href: "/partner", tooltip: "Overview of your bid submissions, active projects, and agency relationships" },
  ],
  [
    { number: "00", title: "Agency Network", href: "/partner/network", tooltip: "Your agency partnerships, pending invitations, and discover new agencies" },
    { number: "01", title: "Open RFPs & Bids", href: "/partner/rfps", tooltip: "Active RFP invitations, submit bids, and track your bid history" },
    { number: "02", title: "Onboarding", href: "/partner/onboarding", tooltip: "Kickoff packages and documents from your agency partners" },
    { number: "03", title: "Delivery & Projects", href: "/partner/projects", tooltip: "Your active project engagements, status updates, and delivery performance" },
  ],
  [
    { icon: "◎", title: "Legal & Compliance", href: "/partner/legal", tooltip: "Business designations, insurance coverage, and legal entity information" },
    { icon: "$", title: "Payments", href: "/partner/payments", tooltip: "View payment schedules from your lead agencies and save rate details for each relationship" },
    { icon: "?", title: "FAQ", href: "/faq", tooltip: "Help and guidance for using the platform" },
  ],
]

const navItems = navGroups.flat()

interface PartnerLayoutProps {
  children: React.ReactNode
}

/** Partner header + main + footer only — no PaidUserProvider. Use for flows that must not sit under agency subscription gating (e.g. RFP bid submit). */
export function PartnerChrome({ children }: PartnerLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [userName, setUserName] = useState("Partner")
  const [userInitials, setUserInitials] = useState("P")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarLoadError, setAvatarLoadError] = useState(false)
  const [isDemo, setIsDemo] = useState(false)

  useEffect(() => {
    setIsDemo(isDemoMode())
  }, [])

  const loadUser = async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name, company_name, company_logo_url")
            .eq("id", user.id)
            .single()
          if (profile) {
            setUserName(profile.company_name || profile.full_name || "Partner")
            setAvatarUrl(profile.company_logo_url || null)
            setAvatarLoadError(false)
            const initials = (profile.company_name || profile.full_name || "P")
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

  const navigateFromMenu = (path: string) => {
    setUserMenuOpen(false)
    router.push(path)
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Header */}
      <header className="bg-[#0C3535] text-white sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-8">
              <Link href="/">
                <LigamentLogo size="sm" variant="primary" />
              </Link>
              
              {/* Navigation */}
              <nav className="hidden md:flex items-center gap-1">
                {navGroups.map((group, groupIndex) => (
                  <div key={groupIndex} className="flex items-center gap-1">
                    {groupIndex > 0 && <div className="w-px h-6 bg-white/15 mx-2" aria-hidden="true" />}
                    {group.map((item) => {
                      const isActive = pathname === item.href ||
                        (item.href !== "/partner" && pathname?.startsWith(item.href))
                      return (
                        <Tooltip key={item.href}>
                          <TooltipTrigger asChild>
                            <Link
                              href={item.href}
                              className={cn(
                                "flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-xs transition-colors",
                                isActive
                                  ? "bg-white/10 text-[#C8F53C]"
                                  : "text-white/90 hover:text-white hover:bg-white/5"
                              )}
                            >
                              {item.number ? (
                                <span className={cn("font-mono text-xs font-medium", isActive ? "text-[#C8F53C]" : "text-white/60")}>
                                  {item.number}
                                </span>
                              ) : (
                                <span>{item.icon}</span>
                              )}
                              <span>{item.title}</span>
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" showArrow={false} className="w-64 p-3 bg-vendor-surface border border-vendor-border shadow-xl">
                            <p className="text-xs text-vendor-muted-strong">{item.tooltip}</p>
                          </TooltipContent>
                        </Tooltip>
                      )
                    })}
                  </div>
                ))}
              </nav>
            </div>
            
            <div className="flex items-center gap-4">
              {isDemo && (
                <Link 
                  href="/agency" 
                  className="font-mono text-[10px] text-white/85 hover:text-[#C8F53C] transition-colors"
                >
                  Switch to Lead Agency View →
                </Link>
              )}
              <div className="relative">
                <button 
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <div className="text-right hidden sm:block">
                    <div className="font-display font-bold text-sm">{userName}</div>
                    <div className="font-mono text-[10px] text-[#C8F53C]">Partner Account</div>
                  </div>
                  <div className="w-9 h-9 rounded-full bg-[#C8F53C]/20 flex items-center justify-center">
                    {avatarUrl && !avatarLoadError ? (
                      <img
                        src={avatarUrl}
                        alt="Account avatar"
                        crossOrigin="anonymous"
                        className="w-8 h-8 rounded-full object-cover"
                        onError={() => setAvatarLoadError(true)}
                      />
                    ) : (
                      <span className="font-mono text-xs text-[#C8F53C]">{userInitials}</span>
                    )}
                  </div>
                  <ChevronDown className={cn(
                    "w-4 h-4 text-white/60 transition-transform",
                    userMenuOpen && "rotate-180"
                  )} />
                </button>
                
                {userMenuOpen && (
                  <div className="absolute top-full right-0 mt-2 w-56 bg-vendor-surface rounded-lg shadow-xl overflow-hidden z-50">
                    <button
                      onClick={() => navigateFromMenu("/partner/settings/user")}
                      className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-vendor-background transition-colors text-vendor-foreground"
                    >
                      <Settings className="w-4 h-4 text-vendor-muted" />
                      <span className="text-sm">User Profile</span>
                    </button>
                    <button
                      onClick={() => navigateFromMenu("/partner/profile")}
                      className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-vendor-background transition-colors text-vendor-foreground"
                    >
                      <User className="w-4 h-4 text-vendor-muted" />
                      <span className="text-sm">Company Profile & Capabilities</span>
                    </button>
                    <button
                      onClick={() => navigateFromMenu("/partner/marketplace")}
                      className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-vendor-background transition-colors text-vendor-foreground"
                    >
                      <Globe className="w-4 h-4 text-vendor-muted" />
                      <span className="text-sm">Marketplace</span>
                    </button>
                    <div className="border-t border-vendor-border">
                      <button
                        onClick={() => navigateFromMenu("/pricing")}
                        className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-vendor-background transition-colors text-vendor-foreground"
                      >
                        <ArrowUpRight className="w-4 h-4 mt-0.5 text-vendor-muted" />
                        <span className="text-sm">
                          <span className="block">Become a Lead Agency</span>
                          <span className="block text-xs text-vendor-muted">Unlock full platform access.</span>
                        </span>
                      </button>
                    </div>
                    <div className="border-t border-vendor-border">
                      <button
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-50 transition-colors text-red-600"
                      >
                        <LogOut className="w-4 h-4" />
                        <span className="text-sm">Sign Out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Mobile nav: the grouped/tooltip nav above is `hidden md:flex` (disappears
              entirely below md) - extend rather than rebuild with a flat, horizontally
              scrollable row so every item (including the 00-03 step numbers) stays
              reachable on small screens. No hover, so no tooltips here. */}
          <nav className="flex md:hidden items-center gap-1 overflow-x-auto -mx-6 px-6 pb-1 mt-3">
            {navItems.map((item) => {
              const isActive = pathname === item.href ||
                (item.href !== "/partner" && pathname?.startsWith(item.href))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-2 rounded-lg font-mono text-[11px] whitespace-nowrap shrink-0 transition-colors",
                    isActive
                      ? "bg-white/10 text-[#C8F53C]"
                      : "text-white/90 hover:text-white hover:bg-white/5"
                  )}
                >
                  {item.number ? (
                    <span className={cn("font-mono text-[11px] font-medium", isActive ? "text-[#C8F53C]" : "text-white/60")}>
                      {item.number}
                    </span>
                  ) : (
                    <span>{item.icon}</span>
                  )}
                  <span>{item.title}</span>
                </Link>
              )
            })}
          </nav>

          <div className="mt-3 max-w-[220px]">
            <RoleToggle />
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {children}
      </main>

      {/* Legal Footer */}
      <footer className="bg-vendor-surface border-t border-vendor-border py-6">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="font-mono text-[10px] text-vendor-muted/70">
            &copy; {new Date().getFullYear()} LIGAMENT. All rights reserved.
          </div>
          <div className="flex items-center gap-4">
            <Link 
              href="/terms" 
              className="font-mono text-[10px] text-vendor-muted hover:text-vendor-foreground transition-colors"
            >
              Terms of Service
            </Link>
            <span className="text-vendor-muted/50">|</span>
            <Link 
              href="/privacy" 
              className="font-mono text-[10px] text-vendor-muted hover:text-vendor-foreground transition-colors"
            >
              Privacy Policy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

export function PartnerLayout({ children }: PartnerLayoutProps) {
  return (
    <PaidUserProvider>
      <LeadAgencyFilterProvider>
        <PartnerChrome>{children}</PartnerChrome>
      </LeadAgencyFilterProvider>
    </PaidUserProvider>
  )
}
