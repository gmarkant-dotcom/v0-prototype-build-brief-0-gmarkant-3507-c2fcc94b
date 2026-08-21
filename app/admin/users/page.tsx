"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LigamentLogo } from "@/components/ligament-logo"
import { cn } from "@/lib/utils"
import { Search, Check, X, Shield, CreditCard, ArrowLeft, Users } from "lucide-react"

// Mirrors ADMIN_USER_COLUMNS in app/api/admin/users/route.ts. is_admin and secondary_role
// were declared here but read by nothing in this file, so the route no longer sends them.
type User = {
  id: string
  email: string
  full_name: string | null
  company_name: string | null
  role: string | null
  /**
   * 092: THE COMPANY'S FLAG, NOT THIS PERSON'S. Entitlement moved onto
   * `organizations.is_paid` - one price per company, any number of colleagues - and
   * /api/admin/users composes it onto each row from the user's organization. Two
   * colleagues of the same company therefore show the SAME value here, which is correct
   * and is the whole point. The field name is kept because the wire contract and the
   * toggle's meaning are unchanged.
   */
  is_paid: boolean
  demo_access: boolean
  created_at: string
}

export default function AdminUsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [isOwner, setIsOwner] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const checkOwnerAndFetchUsers = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.push("/auth/login")
        return
      }

      // profiles.is_admin is the single source of truth, matching requireAdminRole on the
      // API side. This is a UI convenience gate only - the real boundary is the route.
      // It also has to agree with the route, because the toggles below write to profiles
      // through the browser client and depend on the same flag at the RLS layer.
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .maybeSingle()

      if (!profile?.is_admin) {
        router.push("/agency")
        return
      }

      setIsOwner(true)

      // Fetch all users via server-side route (bypasses RLS to return all profiles)
      const res = await fetch('/api/admin/users', { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        setUsers(data.users || [])
      }
      setIsLoading(false)
    }

    checkOwnerAndFetchUsers()
  }, [router])

  const filteredUsers = useMemo(() => {
    if (!searchQuery) return users
    const query = searchQuery.toLowerCase()
    return users.filter(
      (user) =>
        user.email?.toLowerCase().includes(query) ||
        user.full_name?.toLowerCase().includes(query) ||
        user.company_name?.toLowerCase().includes(query)
    )
  }, [users, searchQuery])

  /**
   * Every flag change goes through the server route. These used to be browser-side writes to
   * profiles, which row level security silently reduced to zero rows for every account but
   * this admin's own while still reporting success - see the route's own comment. Local state
   * is now updated ONLY from what the server says it actually wrote, never optimistically,
   * because an optimistic flip is precisely how the original bug stayed invisible.
   */
  const setFlags = async (userId: string, flags: Partial<Pick<User, 'is_paid' | 'demo_access'>>) => {
    setUpdating(userId)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}/flags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(flags),
      })
      const payload = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(payload?.error || `Update failed (${res.status}).`)
        return
      }

      // Trust the returned row, not the value we asked for.
      //
      // 092: MERGE PER FIELD, AND ONLY WHAT THE SERVER ACTUALLY WROTE. `is_paid` now lives
      // on the organization and `demo_access` on the profile, so the route touches only the
      // table the request named and returns null for the flag it did not write. The
      // previous form - Boolean(payload.user?.demo_access) unconditionally - would read
      // that null as false and WIPE the demo badge off the row every time somebody toggled
      // the paid flag. A display that lies about a value nobody changed is the same class
      // of quiet wrongness the optimistic flip above was removed for.
      setUsers(prev =>
        prev.map(u => {
          if (u.id !== userId) return u
          const next = { ...u }
          if (typeof payload.user?.is_paid === 'boolean') next.is_paid = payload.user.is_paid
          if (typeof payload.user?.demo_access === 'boolean') next.demo_access = payload.user.demo_access
          return next
        })
      )
    } catch {
      setError('Update failed. Check your connection and try again.')
    } finally {
      setUpdating(null)
    }
  }

  const togglePaidStatus = (userId: string, currentStatus: boolean) => setFlags(userId, { is_paid: !currentStatus })

  const toggleDemoAccess = (userId: string, currentStatus: boolean) => setFlags(userId, { demo_access: !currentStatus })

  const grantAgencyAccess = (userId: string) => setFlags(userId, { is_paid: true })
  // Admin status is managed directly in database by owner only
  // No UI toggle - this prevents accidental admin escalation

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0C3535] flex items-center justify-center">
        <div className="text-white/60">Loading...</div>
      </div>
    )
  }

  if (!isOwner) {
    return null
  }

  const paidCount = users.filter(u => u.is_paid).length
  const restrictedCount = users.filter(u => u.role === "agency" && !u.is_paid).length
  const demoCount = users.filter(u => u.demo_access).length
  const agencyCount = users.filter(u => u.role === 'agency').length
  const partnerCount = users.filter(u => u.role === 'partner').length

  return (
    <div className="min-h-screen bg-[#0C3535]">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/">
              <LigamentLogo size="md" variant="primary" />
            </Link>
            <div className="flex items-center gap-2 text-white/60">
              <Shield className="w-4 h-4" />
              <span className="font-mono text-xs uppercase tracking-wider">Admin Panel</span>
            </div>
          </div>
          <Button asChild variant="outline" className="border-white/20 text-white hover:bg-white/10 bg-transparent">
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to site
            </Link>
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="font-display font-bold text-3xl text-white mb-2">User Management</h1>
          <p className="text-white/60">Manage user accounts, paid status, and admin permissions.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-5 gap-4 mb-8">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-white/60" />
              </div>
              <div>
                <div className="text-2xl font-display font-bold text-white">{users.length}</div>
                <div className="text-xs text-white/50">Total users</div>
              </div>
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#C8F53C]/10 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-[#C8F53C]" />
              </div>
              <div>
                <div className="text-2xl font-display font-bold text-white">{paidCount}</div>
                <div className="text-xs text-white/50">Paid users</div>
              </div>
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Shield className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <div className="text-2xl font-display font-bold text-white">{demoCount}</div>
                <div className="text-xs text-white/50">Demo access</div>
              </div>
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Shield className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-display font-bold text-white">{agencyCount}</div>
                <div className="text-xs text-white/50">Lead agencies</div>
              </div>
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <div className="text-2xl font-display font-bold text-white">{partnerCount}</div>
                <div className="text-xs text-white/50">Vendors</div>
              </div>
            </div>
          </div>
        </div>

        {/* A failed flag write must be impossible to mistake for a successful one. */}
        {error && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3"
          >
            <X className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            <div className="flex-1 text-sm text-red-100">{error}</div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="font-mono text-2xs uppercase tracking-wider text-red-200 transition-colors hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by email, name, or company..."
              className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/40"
            />
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left px-4 py-3 font-mono text-2xs text-white/50 uppercase tracking-wider">User</th>
                <th className="text-left px-4 py-3 font-mono text-2xs text-white/50 uppercase tracking-wider">Role</th>
                <th className="text-left px-4 py-3 font-mono text-2xs text-white/50 uppercase tracking-wider">Joined</th>
                <th className="text-center px-4 py-3 font-mono text-2xs text-white/50 uppercase tracking-wider">Paid Status</th>
                <th className="text-center px-4 py-3 font-mono text-2xs text-white/50 uppercase tracking-wider">Demo Access</th>
                <th className="text-center px-4 py-3 font-mono text-2xs text-white/50 uppercase tracking-wider">Agency Access</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-white">{user.email}</div>
                      <div className="text-xs text-white/50">
                        {user.company_name || user.full_name || "No name set"}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex items-center px-2 py-1 rounded text-xs font-mono",
                      user.role === 'agency' 
                        ? "bg-blue-500/10 text-blue-400" 
                        : user.role === 'partner'
                        ? "bg-purple-500/10 text-purple-400"
                        : "bg-white/10 text-white/50"
                    )}>
                      {user.role === 'agency' ? 'Lead Agency' : user.role === 'partner' ? 'Vendor' : 'Unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-white/60">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {user.role === 'agency' ? (
                      <button
                        onClick={() => togglePaidStatus(user.id, user.is_paid)}
                        disabled={updating === user.id}
                        className={cn(
                          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                          user.is_paid
                            ? "bg-[#C8F53C]/10 text-[#C8F53C] hover:bg-red-500/20 hover:text-red-300"
                            : "bg-red-500/10 text-red-400 hover:bg-[#C8F53C]/10 hover:text-[#C8F53C]"
                        )}
                        title={user.is_paid ? "Click to restrict access" : "Click to restore access"}
                      >
                        {user.is_paid ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            Active
                          </>
                        ) : (
                          <>
                            <X className="w-3.5 h-3.5" />
                            Restricted
                          </>
                        )}
                      </button>
                    ) : (
                      <span className="text-xs text-white/30 font-mono">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleDemoAccess(user.id, user.demo_access)}
                      disabled={updating === user.id}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                        user.demo_access 
                          ? "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" 
                          : "bg-white/5 text-white/85 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      {user.demo_access ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Enabled
                        </>
                      ) : (
                        <>
                          <X className="w-3.5 h-3.5" />
                          Disabled
                        </>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {user.role === 'partner' && (
                      <button
                        onClick={() => grantAgencyAccess(user.id)}
                        disabled={updating === user.id || user.is_paid}
                        className={cn(
                          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                          user.is_paid
                            ? "bg-blue-500/10 text-blue-400 cursor-default"
                            : "bg-white/5 text-white/85 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        {user.is_paid ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            Granted
                          </>
                        ) : (
                          <>
                            <X className="w-3.5 h-3.5" />
                            Grant
                          </>
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {filteredUsers.length === 0 && (
            <div className="px-4 py-12 text-center text-white/40">
              No users found matching your search.
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
