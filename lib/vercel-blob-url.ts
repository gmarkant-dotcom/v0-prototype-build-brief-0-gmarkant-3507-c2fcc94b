/** Vercel Blob URLs stored on partner RFP bid uploads (private access). */

export function isVercelBlobStorageUrl(url: string): boolean {
  try {
    const h = new URL(url.trim()).hostname.toLowerCase()
    return h.includes("blob.vercel-storage.com") || h.includes("vercel-storage.com")
  } catch {
    return false
  }
}

/** Last path segment with leading `timestamp-` stripped (matches upload naming). */
export function displayFilenameFromBlobUrl(url: string): string {
  try {
    const seg = decodeURIComponent(new URL(url).pathname.split("/").pop() || "")
    const withoutTs = seg.replace(/^\d+-/, "")
    return withoutTs || "Attachment"
  } catch {
    return "Attachment"
  }
}

/** Path shape from partner upload: `partner-rfp-bids/{partnerId}/{inboxId}/{timestamp}-{safeName}` */
export function parsePartnerRfpBlobPathFromUrl(blobUrl: string): {
  partnerId: string
  inboxId: string
  fileSegment: string
} | null {
  try {
    const pathname = new URL(blobUrl).pathname.replace(/^\//, "")
    const parts = pathname.split("/").filter(Boolean)
    if (parts.length < 4 || parts[0] !== "partner-rfp-bids") return null
    return {
      partnerId: parts[1],
      inboxId: parts[2],
      fileSegment: parts.slice(3).join("/"),
    }
  } catch {
    return null
  }
}

/** Path shape from project docs upload: `projects/{projectId}/.../{timestamp}_{safeName}` */
export function parseProjectBlobPathFromUrl(blobUrl: string): {
  projectId: string
  tail: string
} | null {
  try {
    const pathname = new URL(blobUrl).pathname.replace(/^\//, "")
    const parts = pathname.split("/").filter(Boolean)
    if (parts.length < 3 || parts[0] !== "projects") return null
    return {
      projectId: parts[1],
      tail: parts.slice(2).join("/"),
    }
  } catch {
    return null
  }
}
