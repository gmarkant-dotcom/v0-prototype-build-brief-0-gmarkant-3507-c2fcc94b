"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PartnerLayout } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"

export default function PartnerUserProfilePage() {
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
        router.push("/auth/login?redirect=%2Fpartner%2Fsettings%2Fuser")
        return
      }
      const { data: profile } = await supabase.from("profiles").select("full_name, role").eq("id", user.id).maybeSingle()
      if (profile?.role !== "partner") {
        router.push("/partner")
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
      <PartnerLayout>
        <div className="max-w-3xl mx-auto p-8 text-gray-600">Loading user profile...</div>
      </PartnerLayout>
    )
  }

  return (
    <PartnerLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="font-display font-bold text-3xl text-[#0C3535]">User Profile</h1>
          <p className="text-gray-600 mt-1">Manage your personal account information.</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div>
            <label className="font-mono text-[10px] uppercase text-gray-500 block mb-2">Display Name / Full Name</label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="bg-white border-gray-200 text-gray-900" />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-gray-500 block mb-2">Email</label>
            <Input value={email} readOnly className="bg-gray-100 border-gray-200 text-gray-700" />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-gray-500 block mb-2">New Password</label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Leave empty to keep current password"
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          {message && <p className="text-sm text-gray-600">{message}</p>}
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving} className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white">
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>
    </PartnerLayout>
  )
}
