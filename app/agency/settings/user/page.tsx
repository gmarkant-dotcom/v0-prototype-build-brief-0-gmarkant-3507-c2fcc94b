"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AgencyLayout } from "@/components/agency-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"

export default function AgencyUserProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [userId, setUserId] = useState("")
  const [email, setEmail] = useState("")
  const [fullName, setFullName] = useState("")
  const [newPassword, setNewPassword] = useState("")

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push("/auth/login?redirect=%2Fagency%2Fsettings%2Fuser")
        return
      }
      const { data: profile } = await supabase.from("profiles").select("full_name, role").eq("id", user.id).maybeSingle()
      if (profile?.role !== "agency") {
        router.push("/agency")
        return
      }
      setUserId(user.id)
      setEmail(user.email || "")
      setFullName(profile?.full_name || "")
      setLoading(false)
    }
    load()
  }, [router])

  const save = async () => {
    setSaving(true)
    setMessage(null)
    const supabase = createClient()
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({ full_name: fullName, updated_at: new Date().toISOString() })
      .eq("id", userId)

    if (profileErr) {
      setMessage(profileErr.message)
      setSaving(false)
      return
    }

    if (newPassword.trim()) {
      const { error: passErr } = await supabase.auth.updateUser({ password: newPassword })
      if (passErr) {
        setMessage(passErr.message)
        setSaving(false)
        return
      }
    }

    setMessage("User profile updated.")
    setNewPassword("")
    setSaving(false)
  }

  if (loading) {
    return (
      <AgencyLayout>
        <div className="p-8 text-foreground-muted">Loading user profile...</div>
      </AgencyLayout>
    )
  }

  return (
    <AgencyLayout>
      <div className="p-8 max-w-3xl space-y-6">
        <div>
          <h1 className="font-display font-bold text-3xl text-foreground">User Profile</h1>
          <p className="text-foreground-muted mt-1">Manage your personal account information.</p>
        </div>

        <div className="bg-white/5 border border-border/40 rounded-xl p-6 space-y-4">
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Display Name / Full Name</label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="bg-white border-gray-200 text-gray-900" />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Email</label>
            <Input value={email} readOnly className="bg-gray-100 border-gray-200 text-gray-700" />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">New Password</label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Leave empty to keep current password"
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          {message && <p className="text-sm text-foreground-muted">{message}</p>}
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving} className="bg-accent text-accent-foreground hover:bg-accent/90">
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>
    </AgencyLayout>
  )
}
