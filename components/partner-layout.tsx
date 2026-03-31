"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { isDemoMode } from "@/lib/demo-data"
import { Settings, LogOut, User, ChevronDown, Globe } from "lucide-react"
import { LigamentLogo } from "./ligament-logo"
import { PaidUserProvider } from "@/contexts/paid-user-context"
import { LeadAgencyFilterProvider } from "@/contexts/lead-agency-filter-context"

const navItems = [
  { icon: "◇", title: "Dashboard", href: "/partner" },
  { icon: "✉", title: "Invitations", href: "/partner/invitations" },
  { icon: "🔍", title: "Discover Agencies", href: "/partner/discover" },
  { icon: "◈", title: "Open RFPs", href: "/partner/rfps" },
  { icon: "□", title: "Onboarding", href: "/partner/onboarding" },
  { icon: "▣", title: "Active Projects", href: "/partner/projects" },
  { icon: "◎", title: "Legal & Compliance", href: "/partner/legal" },
  { icon: "$", title: "Payment Setup", href: "/partner/payments" },
]

interface PartnerLayoutProps {
  children: React.ReactNode
}

/** Partner header + main + footer only — no PaidUserProvider. Use for flows that must not sit under agency subscription gating (e.g. RFP bid submit). */
export function PartnerChrome({ children }: PartnerLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [userName, setUserName] = useState("Fieldhouse Films")
  const [userInitials, setUserInitials] = useState("FF")
  const [isDemo, setIsDemo] = useState(false)

  useEffect(() => {
    setIsDemo(isDemoMode())
  }, [])

  useEffect(() => {
    const loadUser = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          try {
            const { data: profile } = await supabase
              .from("profiles")
              .select("full_name, company_name")
              .eq("id", user.id)
              .single()
            if (profile) {
              setUserName(profile.company_name || profile.full_name || "Partner")
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
    loadUser()
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
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/">
              <LigamentLogo size="sm" variant="primary" />
            </Link>
            
            {/* Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href || 
                  (item.href !== "/partner" && pathname?.startsWith(item.href))
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-xs transition-colors",
                      isActive
                        ? "bg-white/10 text-[#C8F53C]"
                        : "text-white/70 hover:text-white hover:bg-white/5"
                    )}
                  >
                    <span>{item.icon}</span>
                    <span>{item.title}</span>
                  </Link>
                )
              })}
            </nav>
          </div>
          
          <div className="flex items-center gap-4">
            {isDemo && (
              <Link 
                href="/agency" 
                className="font-mono text-[10px] text-white/60 hover:text-[#C8F53C] transition-colors"
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
                  <span className="font-mono text-xs text-[#C8F53C]">{userInitials}</span>
                </div>
                <ChevronDown className={cn(
                  "w-4 h-4 text-white/60 transition-transform",
                  userMenuOpen && "rotate-180"
                )} />
              </button>
              
              {userMenuOpen && (
                <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-lg shadow-xl overflow-hidden z-50">
                  <button
                    onClick={() => navigateFromMenu("/partner/settings/user")}
                    className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-gray-700"
                  >
                    <Settings className="w-4 h-4 text-gray-500" />
                    <span className="text-sm">User Profile</span>
                  </button>
                  <button
                    onClick={() => navigateFromMenu("/partner/profile")}
                    className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-gray-700"
                  >
                    <User className="w-4 h-4 text-gray-500" />
                    <span className="text-sm">Company Profile & Capabilities</span>
                  </button>
                  <button
                    onClick={() => navigateFromMenu("/partner/marketplace")}
                    className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-gray-700"
                  >
                    <Globe className="w-4 h-4 text-gray-500" />
                    <span className="text-sm">Marketplace</span>
                  </button>
                  <div className="border-t border-gray-200">
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
      </header>
      
      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {children}
      </main>

      {/* Legal Footer */}
      <footer className="bg-white border-t border-gray-200 py-6">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="font-mono text-[10px] text-gray-400">
            &copy; {new Date().getFullYear()} LIGAMENT. All rights reserved.
          </div>
          <div className="flex items-center gap-4">
            <Link 
              href="/legal/terms" 
              className="font-mono text-[10px] text-gray-500 hover:text-[#0C3535] transition-colors"
            >
              Terms of Service
            </Link>
            <span className="text-gray-300">|</span>
            <Link 
              href="/legal/privacy" 
              className="font-mono text-[10px] text-gray-500 hover:text-[#0C3535] transition-colors"
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
