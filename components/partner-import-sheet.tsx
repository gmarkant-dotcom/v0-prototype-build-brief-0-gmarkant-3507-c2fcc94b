"use client"

import { useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmailImportPanel } from "@/components/email-import-panel"
import { SpreadsheetImportPanel } from "@/components/spreadsheet-import-panel"

type ImportTab = "email" | "spreadsheet"

interface PartnerImportSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: () => void
  /** Lowercased email -> display status, for every partnership already in this agency's
   *  pool across all statuses - used by the spreadsheet review step's dedup bucket. */
  existingStatusByEmail: Map<string, string>
  /** Which tab to open on - agency-layout.tsx's "Import Partners" links carry
   *  ?import=email, so the sheet opens straight to the email tab from those entry points. */
  initialTab?: ImportTab
}

export function PartnerImportSheet({
  open,
  onOpenChange,
  onImported,
  existingStatusByEmail,
  initialTab = "email",
}: PartnerImportSheetProps) {
  const [tab, setTab] = useState<ImportTab>(initialTab)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (next) setTab(initialTab)
      }}
      modal={false}
    >
      <SheetContent
        side="right"
        overlay={false}
        onInteractOutside={(e) => e.preventDefault()}
        className="w-full sm:max-w-[520px] flex flex-col"
      >
        <SheetHeader>
          <SheetTitle>Import partners</SheetTitle>
        </SheetHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as ImportTab)} className="flex flex-col flex-1 min-h-0">
          <div className="px-4">
            <TabsList className="w-full">
              <TabsTrigger value="email" className="flex-1">
                Scan your email
              </TabsTrigger>
              <TabsTrigger value="spreadsheet" className="flex-1">
                Upload a spreadsheet
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="email" className="flex flex-col flex-1 min-h-0 mt-2">
            <EmailImportPanel active={open && tab === "email"} onDone={() => onOpenChange(false)} onImported={onImported} />
          </TabsContent>
          <TabsContent value="spreadsheet" className="flex flex-col flex-1 min-h-0 mt-2">
            <SpreadsheetImportPanel
              active={open && tab === "spreadsheet"}
              existingStatusByEmail={existingStatusByEmail}
              onDone={() => onOpenChange(false)}
              onImported={onImported}
            />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
