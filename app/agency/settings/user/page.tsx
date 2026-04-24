"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AgencyShell } from "@/components/agency-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { createClient } from "@/lib/supabase/client"
import { FileUpload } from "@/components/file-upload"

export default function AgencyUserProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [userId, setUserId] = useState("")
  const [email, setEmail] = useState("")
  const [fullName, setFullName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [initialFullName, setInitialFullName] = useState("")
  const [initialDisplayName, setInitialDisplayName] = useState("")
  const [avatarUrl, setAvatarUrl] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [notificationPrefs, setNotificationPrefs] = useState({
    newBidReceived: true,
    partnerInvitationAccepted: true,
    projectUpdate: true,
    platformAnnouncements: true,
  })

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
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, role, full_name, display_name, avatar_url, notification_preferences")
        .eq("id", user.id)
        .maybeSingle()
      if (profile?.role !== "agency") {
        router.push("/agency")
        return
      }
      setUserId(user.id)
      setEmail(user.email || "")
      setFullName(profile?.full_name || (user.user_metadata?.full_name as string) || "")
      setDisplayName((profile as any)?.display_name || profile?.full_name || (user.user_metadata?.full_name as string) || "")
      setInitialFullName(profile?.full_name || (user.user_metadata?.full_name as string) || "")
      setInitialDisplayName((profile as any)?.display_name || profile?.full_name || (user.user_metadata?.full_name as string) || "")
      setAvatarUrl((profile as any)?.avatar_url || "")
      const storedPrefs = localStorage.getItem(`agency-notification-prefs-${user.id}`)
      const dbPrefs = (profile as any)?.notification_preferences
      if (dbPrefs && typeof dbPrefs === "object") {
        setNotificationPrefs((prev) => ({ ...prev, ...dbPrefs }))
      } else if (storedPrefs) {
        setNotificationPrefs((prev) => ({ ...prev, ...JSON.parse(storedPrefs) }))
      }
      setLoading(false)
    }
    load()
  }, [router])

  const saveAccountInformation = async () => {
    setSaving(true)
    setErrorMessage(null)
    setMessage(null)
    const supabase = createClient()
    const payload = {
      full_name: fullName,
      display_name: displayName,
      avatar_url: avatarUrl || null,
      notification_preferences: notificationPrefs,
      updated_at: new Date().toISOString(),
    }
    const { error: profileErr } = await supabase.from("profiles").update(payload as any).eq("id", userId)
    if (profileErr) {
      const { error: fallbackErr } = await supabase
        .from("profiles")
        .update({ full_name: fullName, updated_at: new Date().toISOString() })
        .eq("id", userId)
      if (fallbackErr) {
        setErrorMessage(fallbackErr.message)
        setSaving(false)
        return
      }
    }
    localStorage.setItem(`agency-notification-prefs-${userId}`, JSON.stringify(notificationPrefs))
    setMessage("Account information and notification preferences saved.")
    setSaving(false)
  }

  const savePassword = async () => {
    setPasswordSaving(true)
    setErrorMessage(null)
    setMessage(null)
    if (!currentPassword || !newPassword || !confirmPassword) {
      setErrorMessage("Please complete all password fields.")
      setPasswordSaving(false)
      return
    }
    if (newPassword.length < 8) {
      setErrorMessage("New password must be at least 8 characters.")
      setPasswordSaving(false)
      return
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage("New password and confirmation must match.")
      setPasswordSaving(false)
      return
    }
    const supabase = createClient()
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
    if (authErr) {
      setErrorMessage("Current password is incorrect.")
      setPasswordSaving(false)
      return
    }
    const { error: passErr } = await supabase.auth.updateUser({ password: newPassword })
    if (passErr) {
      setErrorMessage(passErr.message)
      setPasswordSaving(false)
      return
    }
    setMessage("Password updated successfully.")
    setCurrentPassword("")
    setPasswordSaving(false)
    setNewPassword("")
    setConfirmPassword("")
  }

  const saveNameChanges = async () => {
    if (!userId) return
    setSaving(true)
    setErrorMessage(null)
    setMessage(null)
    const supabase = createClient()
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        display_name: displayName.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)

    if (error) {
      setErrorMessage(error.message)
      setSaving(false)
      return
    }

    setInitialFullName(fullName)
    setInitialDisplayName(displayName)
    setMessage("Name changes saved.")
    setSaving(false)
  }

  const hasNameChanges =
    fullName.trim() !== initialFullName.trim() || displayName.trim() !== initialDisplayName.trim()

  if (loading) {
    return (
      <AgencyShell>
        <div className="p-8 text-foreground-muted">Loading user profile...</div>
      </AgencyShell>
    )
  }

  return (
    <AgencyShell>
      <div className="p-8 max-w-3xl space-y-6">
        <div>
          <h1 className="font-display font-bold text-3xl text-foreground">User Profile</h1>
          <p className="text-foreground-muted mt-1">Manage your personal account information.</p>
        </div>

        <div className="bg-white/5 border border-border/40 rounded-xl p-6 space-y-4">
          <h2 className="font-display font-bold text-lg text-foreground">Account Information</h2>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Full Name</label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="bg-white border-gray-200 text-gray-900" />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Display Name</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="bg-white border-gray-200 text-gray-900"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Email</label>
            <Input value={email} readOnly className="bg-gray-100 border-gray-200 text-gray-700" />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Profile Photo</label>
            <FileUpload
              currentUrl={avatarUrl}
              accept="image/jpeg,image/png,image/webp,image/gif"
              onUploadComplete={(file) => {
                const nextUrl = file?.url || ""
                if (nextUrl) {
                  setAvatarUrl(nextUrl)
                  setMessage("Profile photo uploaded.")
                  setErrorMessage(null)
                }
              }}
              folder="avatars"
            />
            {avatarUrl ? (
              <div className="mt-3 flex items-center gap-3">
                <img src={avatarUrl} alt="Profile avatar preview" className="w-10 h-10 rounded-full object-cover border border-border" />
                <span className="text-xs text-foreground-muted">Profile photo updated</span>
              </div>
            ) : null}
          </div>
          <div className="flex justify-end">
            <Button
              onClick={saveNameChanges}
              disabled={saving || !hasNameChanges}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>

        <div className="bg-white/5 border border-border/40 rounded-xl p-6 space-y-4">
          <h2 className="font-display font-bold text-lg text-foreground">Password & Security</h2>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Current Password</label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">New Password</label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Confirm New Password</label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={savePassword}
              disabled={passwordSaving}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {passwordSaving ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </div>

        <div className="bg-white/5 border border-border/40 rounded-xl p-6 space-y-4">
          <h2 className="font-display font-bold text-lg text-foreground">Notification Preferences</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Email me when a new bid is received</span>
              <Switch
                checked={notificationPrefs.newBidReceived}
                onCheckedChange={(checked) => setNotificationPrefs((prev) => ({ ...prev, newBidReceived: checked }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Email me when a partner invitation is accepted</span>
              <Switch
                checked={notificationPrefs.partnerInvitationAccepted}
                onCheckedChange={(checked) =>
                  setNotificationPrefs((prev) => ({ ...prev, partnerInvitationAccepted: checked }))
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Email me on project updates</span>
              <Switch
                checked={notificationPrefs.projectUpdate}
                onCheckedChange={(checked) => setNotificationPrefs((prev) => ({ ...prev, projectUpdate: checked }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Email me platform announcements</span>
              <Switch
                checked={notificationPrefs.platformAnnouncements}
                onCheckedChange={(checked) =>
                  setNotificationPrefs((prev) => ({ ...prev, platformAnnouncements: checked }))
                }
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={saveAccountInformation} disabled={saving} className="bg-accent text-accent-foreground hover:bg-accent/90">
              {saving ? "Saving..." : "Save Preferences"}
            </Button>
          </div>
        </div>

        <div className="bg-white/5 border border-red-300/30 rounded-xl p-6 space-y-4">
          <h2 className="font-display font-bold text-lg text-foreground">Danger Zone</h2>
          <p className="text-sm text-foreground-muted">Account deletion is handled manually by support for security purposes.</p>
          <Button disabled variant="outline" title="Contact support to delete your account">
            Delete Account
          </Button>
        </div>

        {message && <p className="text-sm text-green-600">{message}</p>}
        {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
      </div>
    </AgencyShell>
  )
}
