/**
 * Applying a client profile into a flow (A2).
 *
 * Nothing here writes. A profile supplies STARTING POINTS: its documents are merged into the
 * flow's reference materials, its defaults pre-fill the flow's criteria blocks, and everything
 * the agency does afterwards belongs to that RFP alone. Per-RFP edits never write back to the
 * profile - there is deliberately no path in this module that could.
 */

import type { ReferenceMaterial } from "@/components/reference-materials-input"
import type { ClientDocument } from "@/components/client-documents-panel"
import { clientDocumentUrl } from "@/components/client-documents-panel"

/**
 * A client document rendered as a reference material. No new storage on either flow: reference
 * materials already carry exactly this shape (`{ type, label, url, created_at }`), which is why
 * A0 chose to reuse them rather than invent a client-document transport.
 */
export function clientDocumentToReferenceMaterial(doc: ClientDocument): ReferenceMaterial | null {
  const url = clientDocumentUrl(doc)
  if (!url) return null
  return {
    type: doc.source_type === "url" ? "link" : "file",
    label: doc.label || url,
    url,
    created_at: doc.updated_at || new Date().toISOString(),
  }
}

/**
 * IDEMPOTENT merge. The key is the URL, which is the one thing a document carries that is stable
 * across selections, re-selections, and re-broadcasts - so selecting the same client twice, or
 * broadcasting the same RFP again, cannot duplicate a single attachment.
 *
 * Existing materials always win: an agency who renamed or reordered an attachment keeps their
 * version, and re-selecting the client does not overwrite it. Only genuinely new URLs are added,
 * and they are appended so the agency's own additions stay where they put them.
 */
export function mergeClientDocumentsIntoMaterials(
  existing: ReferenceMaterial[],
  documents: ClientDocument[]
): ReferenceMaterial[] {
  const seen = new Set(existing.map((m) => m.url))
  const additions: ReferenceMaterial[] = []
  for (const doc of documents) {
    const material = clientDocumentToReferenceMaterial(doc)
    if (!material) continue
    if (seen.has(material.url)) continue
    seen.add(material.url)
    additions.push(material)
  }
  return additions.length > 0 ? [...existing, ...additions] : existing
}
