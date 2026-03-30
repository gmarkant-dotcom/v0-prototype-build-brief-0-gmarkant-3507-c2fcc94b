"use client"

import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { ExternalLink } from "lucide-react"

type BriefDocumentReviewProps = {
  url: string
  fileName: string
  contentType: string | null
}

export function BriefDocumentReview({ url, fileName, contentType }: BriefDocumentReviewProps) {
  const lower = fileName.toLowerCase()
  const isPdf = lower.endsWith(".pdf") || contentType?.includes("application/pdf")
  const isTextish =
    /\.(txt|md|csv)$/i.test(lower) ||
    (!!contentType && /^text\//i.test(contentType))
  const isImage =
    /\.(png|jpg|jpeg|gif|webp)$/i.test(lower) || (!!contentType && contentType.startsWith("image/"))

  return (
    <GlassCard className="mt-6">
      <GlassCardHeader
        label="Review"
        title="Full document"
        description="Original file you uploaded. Compare this with the extracted character count and the paste box below — especially for scanned PDFs."
      />
      <div className="mt-4 space-y-3">
        <Button asChild variant="outline" size="sm" className="border-border text-foreground hover:bg-white/5">
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
            <ExternalLink className="w-4 h-4 shrink-0" />
            Open in new tab
          </a>
        </Button>

        {isPdf && (
          <div className="rounded-lg border border-border overflow-hidden bg-black/30">
            <iframe
              title={`Brief preview: ${fileName}`}
              src={`${url}#view=FitH`}
              className="w-full min-h-[400px] h-[min(60vh,640px)] border-0"
            />
          </div>
        )}

        {isImage && (
          <div className="rounded-lg border border-border overflow-hidden bg-black/20 p-3 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- public blob URL, not in next/image */}
            <img src={url} alt={fileName} className="max-h-[min(60vh,640px)] w-auto max-w-full object-contain" />
          </div>
        )}

        {isTextish && !isPdf && (
          <div className="rounded-lg border border-border overflow-hidden bg-black/20">
            <iframe title={`Brief preview: ${fileName}`} src={url} className="w-full min-h-[280px] h-[38vh] border-0" />
          </div>
        )}

        {!isPdf && !isTextish && !isImage && (
          <p className="font-mono text-xs text-foreground-muted leading-relaxed">
            In-browser preview isn’t available for this type (e.g. Word .docx or PowerPoint). Use{" "}
            <strong className="text-foreground">Open in new tab</strong> to read the full document locally.
          </p>
        )}
      </div>
    </GlassCard>
  )
}

export function BriefDocumentReviewUnavailable({ message }: { message: string }) {
  return (
    <GlassCard className="mt-6 border-amber-500/20">
      <GlassCardHeader label="Review" title="Full document preview" description={message} />
    </GlassCard>
  )
}
