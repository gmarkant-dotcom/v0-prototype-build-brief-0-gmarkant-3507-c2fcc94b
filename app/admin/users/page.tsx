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

type User = {
  id: string
  email: string
  full_name: string | null
  company_name: string | null
  role: string | null
  is_paid: boolean
  is_admin: boolean
  demo_access: boolean
  created_at: string
}

// SECURITY: Only this email can access the admin panel
const OWNER_EMAIL = 'greg@withligament.com'

export default function AdminUsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [isOwner, setIsOwner] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)

  useEffect(() => {
    const checkOwnerAndFetchUsers = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.push("/auth/login")
        return
      }

      // SECURITY: Only the owner email can access admin panel
      // This is a hard-coded check that cannot be bypassed via database
      if (user.email !== OWNER_EMAIL) {
        router.push("/agency")
        return
      }

      // Owner email is verified - grant access
      // The is_admin database flag is optional (for future multi-admin support)
      setIsOwner(true)

      // Fetch all users
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })

      if (profiles) {
        setUsers(profiles)
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

  const togglePaidStatus = async (userId: string, currentStatus: boolean) => {
    setUpdating(userId)
    const supabase = createClient()
    
    const { error } = await supabase
      .from('profiles')
      .update({ is_paid: !currentStatus })
      .eq('id', userId)

    if (!error) {
      setUsers(users.map(u => 
        u.id === userId ? { ...u, is_paid: !currentStatus } : u
      ))
    }
    setUpdating(null)
  }

  const toggleDemoAccess = async (userId: string, currentStatus: boolean) => {
    setUpdating(userId)
    const supabase = createClient()
    
    const { error } = await supabase
      .from('profiles')
      .update({ demo_access: !currentStatus })
      .eq('id', userId)

    if (!error) {
      setUsers(users.map(u => 
        u.id === userId ? { ...u, demo_access: !currentStatus } : u
      ))
    }
    setUpdating(null)
  }

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
              Back to Site
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
                <div className="text-xs text-white/50">Total Users</div>
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
                <div className="text-xs text-white/50">Paid Users</div>
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
                <div className="text-xs text-white/50">Demo Access</div>
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
                <div className="text-xs text-white/50">Lead Agencies</div>
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
                <div className="text-xs text-white/50">Partners</div>
              </div>
            </div>
          </div>
        </div>

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
                <th className="text-left px-4 py-3 font-mono text-[10px] text-white/50 uppercase tracking-wider">User</th>
                <th className="text-left px-4 py-3 font-mono text-[10px] text-white/50 uppercase tracking-wider">Role</th>
                <th className="text-left px-4 py-3 font-mono text-[10px] text-white/50 uppercase tracking-wider">Joined</th>
                <th className="text-center px-4 py-3 font-mono text-[10px] text-white/50 uppercase tracking-wider">Paid Status</th>
                <th className="text-center px-4 py-3 font-mono text-[10px] text-white/50 uppercase tracking-wider">Demo Access</th>
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
                      {user.role === 'agency' ? 'Lead Agency' : user.role === 'partner' ? 'Partner' : 'Unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-white/60">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => togglePaidStatus(user.id, user.is_paid)}
                      disabled={updating === user.id}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                        user.is_paid 
                          ? "bg-[#C8F53C]/10 text-[#C8F53C] hover:bg-[#C8F53C]/20" 
                          : "bg-white/5 text-white/85 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      {user.is_paid ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Paid
                        </>
                      ) : (
                        <>
                          <X className="w-3.5 h-3.5" />
                          Free
                        </>
                      )}
                    </button>
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
