"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LigamentLogo } from "@/components/ligament-logo"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { cn } from "@/lib/utils"
import { User, Shield, Bell, CreditCard, Building2, ArrowLeft } from "lucide-react"

interface SettingsLayoutProps {
  children: React.ReactNode
  userRole?: "agency" | "partner"
}

const settingsNav = [
  { icon: User, title: "Profile", href: "/settings" },
  { icon: Building2, title: "Company", href: "/settings/company" },
  { icon: Shield, title: "Security", href: "/settings/security" },
  { icon: Bell, title: "Notifications", href: "/settings/notifications" },
  { icon: CreditCard, title: "Billing", href: "/settings/billing" },
]

export function SettingsLayout({ children, userRole = "agency" }: SettingsLayoutProps) {
  const pathname = usePathname()

  const backLink = userRole === "agency" ? "/agency" : "/partner"

  return (
    <div className="min-h-screen bg-background relative">
      <HolographicBlobs />
      
      <div className="relative z-10">
        {/* Header */}
        <header className="border-b border-border/30 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/">
                <LigamentLogo size="sm" variant="primary" />
              </Link>
              <div className="h-6 w-px bg-border/50" />
              <h1 className="font-display font-bold text-foreground">Account Settings</h1>
            </div>
            
            <Link 
              href={backLink}
              className="flex items-center gap-2 text-sm text-foreground-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Link>
          </div>
        </header>

        {/* Content */}
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex gap-8">
            {/* Sidebar */}
            <nav className="w-64 shrink-0">
              <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-xl p-2 sticky top-24">
                {settingsNav.map((item) => {
                  const isActive = pathname === item.href || 
                    (item.href !== "/settings" && pathname.startsWith(item.href))
                  const Icon = item.icon
                  
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-lg transition-colors",
                        isActive 
                          ? "bg-accent/10 text-accent" 
                          : "text-foreground-muted hover:text-foreground hover:bg-white/5"
                      )}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="font-medium">{item.title}</span>
                    </Link>
                  )
                })}
              </div>
            </nav>

            {/* Main Content */}
            <main className="flex-1 min-w-0">
              {children}
            </main>
          </div>
        </div>
      </div>
    </div>
  )
}
