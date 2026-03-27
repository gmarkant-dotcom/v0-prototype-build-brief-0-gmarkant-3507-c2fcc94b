"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { SettingsLayout } from "@/components/settings-layout"
import { Button } from "@/components/ui/button"
import { Save, Mail, MessageSquare, Bell } from "lucide-react"
import { cn } from "@/lib/utils"

interface NotificationSettings {
  email_rfp: boolean
  email_bids: boolean
  email_payments: boolean
  email_updates: boolean
  sms_urgent: boolean
}

export default function NotificationsSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [userRole, setUserRole] = useState<"agency" | "partner">("agency")
  const [settings, setSettings] = useState<NotificationSettings>({
    email_rfp: true,
    email_bids: true,
    email_payments: true,
    email_updates: true,
    sms_urgent: false,
  })
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  useEffect(() => {
    const loadSettings = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        router.push("/auth/login")
        return
      }

      const { data } = await supabase
        .from("profiles")
        .select("role, notification_email, notification_sms")
        .eq("id", user.id)
        .single()

      if (data?.role) setUserRole(data.role)
      setLoading(false)
    }

    loadSettings()
  }, [router])

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    
    // Simulate save
    await new Promise(resolve => setTimeout(resolve, 500))
    
    setMessage({ type: "success", text: "Notification preferences saved" })
    setSaving(false)
  }

  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "w-11 h-6 rounded-full transition-colors relative",
        checked ? "bg-accent" : "bg-white/20"
      )}
    >
      <div className={cn(
        "absolute top-1 w-4 h-4 rounded-full bg-white transition-transform",
        checked ? "translate-x-6" : "translate-x-1"
      )} />
    </button>
  )

  if (loading) {
    return (
      <SettingsLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
        </div>
      </SettingsLayout>
    )
  }

  return (
    <SettingsLayout userRole={userRole}>
      <div className="space-y-8">
        <div>
          <h2 className="font-display font-black text-2xl text-foreground mb-2">Notifications</h2>
          <p className="text-foreground-muted">Manage how you receive updates and alerts.</p>
        </div>

        {/* Email Notifications */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-xl p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-border/30">
            <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
              <Mail className="w-5 h-5 text-accent" />
            </div>
            <div>
              <div className="font-display font-bold text-foreground">Email Notifications</div>
              <div className="text-foreground-muted text-sm">Choose what emails you receive</div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between py-3 border-b border-border/20">
              <div>
                <div className="font-medium text-foreground">RFP Alerts</div>
                <div className="text-sm text-foreground-muted">
                  {userRole === "agency" ? "Responses to your RFPs" : "New RFP opportunities"}
                </div>
              </div>
              <Toggle 
                checked={settings.email_rfp} 
                onChange={(v) => setSettings(s => ({ ...s, email_rfp: v }))} 
              />
            </div>

            <div className="flex items-center justify-between py-3 border-b border-border/20">
              <div>
                <div className="font-medium text-foreground">Bid Updates</div>
                <div className="text-sm text-foreground-muted">
                  {userRole === "agency" ? "New bids and revisions" : "Feedback and award notifications"}
                </div>
              </div>
              <Toggle 
                checked={settings.email_bids} 
                onChange={(v) => setSettings(s => ({ ...s, email_bids: v }))} 
              />
            </div>

            <div className="flex items-center justify-between py-3 border-b border-border/20">
              <div>
                <div className="font-medium text-foreground">Payment Notifications</div>
                <div className="text-sm text-foreground-muted">Payment schedules and confirmations</div>
              </div>
              <Toggle 
                checked={settings.email_payments} 
                onChange={(v) => setSettings(s => ({ ...s, email_payments: v }))} 
              />
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium text-foreground">Product Updates</div>
                <div className="text-sm text-foreground-muted">New features and improvements</div>
              </div>
              <Toggle 
                checked={settings.email_updates} 
                onChange={(v) => setSettings(s => ({ ...s, email_updates: v }))} 
              />
            </div>
          </div>
        </div>

        {/* SMS Notifications */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-xl p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-border/30">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <div className="font-display font-bold text-foreground">SMS Notifications</div>
              <div className="text-foreground-muted text-sm">Text message alerts for urgent items</div>
            </div>
          </div>

          <div className="flex items-center justify-between py-3">
            <div>
              <div className="font-medium text-foreground">Urgent Alerts</div>
              <div className="text-sm text-foreground-muted">Critical deadlines and time-sensitive updates</div>
            </div>
            <Toggle 
              checked={settings.sms_urgent} 
              onChange={(v) => setSettings(s => ({ ...s, sms_urgent: v }))} 
            />
          </div>
        </div>

        {message && (
          <div className={cn(
            "p-3 rounded-lg text-sm",
            message.type === "success" 
              ? "bg-green-500/10 border border-green-500/30 text-green-400"
              : "bg-red-500/10 border border-red-500/30 text-red-400"
          )}>
            {message.text}
          </div>
        )}

        <div className="flex justify-end">
          <Button 
            onClick={handleSave}
            disabled={saving}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving..." : "Save Preferences"}
          </Button>
        </div>
      </div>
    </SettingsLayout>
  )
}
