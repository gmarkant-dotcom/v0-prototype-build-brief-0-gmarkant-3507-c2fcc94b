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

/** Path shape from guest RFP bid upload: `rfp-guest-uploads/{token}/{safeName}` */
export function parseGuestUploadBlobPathFromUrl(blobUrl: string): {
  token: string
  fileSegment: string
} | null {
  try {
    const pathname = new URL(blobUrl).pathname.replace(/^\//, "")
    const parts = pathname.split("/").filter(Boolean)
    if (parts.length < 3 || parts[0] !== "rfp-guest-uploads") return null
    return {
      token: parts[1],
      fileSegment: parts.slice(2).join("/"),
    }
  } catch {
    return null
  }
}


// ---------------------------------------------------------------------------
// Library blobs: the per-organization prefix.
//
// `/api/upload` is the only writer of `agency-library/...` and `reference-materials/...`. As of
// fix/route-boundary-urgent it writes them under a prefix carrying the uploader's ACTING
// ORGANIZATION, resolved from org_members on the session, never from the request:
//
//   agency-library/org/{orgId}/{uploaderUserId}/{timestamp}-{name}
//   reference-materials/org/{orgId}[/{projectId}]/{uploaderUserId}/{timestamp}-{name}
//
// Rows written before that carry LEGACY shapes with no organization in them:
//
//   agency-library/{uploaderUserId}/{timestamp}-{name}
//   reference-materials/{clientSuppliedAgencyId}[/{projectId}]/{uploaderUserId}/{timestamp}-{name}
//
// In every shape the uploader is the second-to-last segment, because `/api/upload` builds
// `${folder}/${user.id}/${timestamp}-${name}` around whatever folder it was given.
// ---------------------------------------------------------------------------

export const LIBRARY_BLOB_FOLDERS = ["agency-library", "reference-materials"] as const
export type LibraryBlobFolder = (typeof LIBRARY_BLOB_FOLDERS)[number]

/** The literal segment that marks an organization-prefixed path. Never a uuid, so never a legacy user id. */
const ORG_SEGMENT = "org"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value)
}

/** The folder `/api/upload` writes under for an organization. Server-side only; orgId comes from org_members. */
export function orgScopedLibraryFolder(folder: LibraryBlobFolder, orgId: string, projectId?: string | null): string {
  const base = `${folder}/${ORG_SEGMENT}/${orgId}`
  return folder === "reference-materials" && isUuid(projectId) ? `${base}/${projectId}` : base
}

/**
 * The access level of a URL in THIS deployment's Blob store, or null for anything else.
 *
 * `get()` sends the app's read-write token to any `*.blob.vercel-storage.com` host it is given,
 * so a hostname suffix check is not "our store". The store id is the fourth `_` field of
 * BLOB_READ_WRITE_TOKEN (the same derivation @vercel/blob uses), and the host must be exactly
 * `{storeId}.{public|private}.blob.vercel-storage.com`. No token means no store: fails closed.
 */
export function ourBlobStoreAccess(blobUrl: string): "public" | "private" | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN ?? ""
  const storeId = (token.split("_")[3] ?? "").toLowerCase()
  if (!storeId) return null
  try {
    const u = new URL(blobUrl.trim())
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null
    const host = u.hostname.toLowerCase()
    if (host === `${storeId}.private.blob.vercel-storage.com`) return "private"
    if (host === `${storeId}.public.blob.vercel-storage.com`) return "public"
    return null
  } catch {
    return null
  }
}

export type LibraryBlobPath =
  | { scope: "org"; folder: LibraryBlobFolder; orgId: string; uploaderId: string; pathname: string }
  | { scope: "legacy"; folder: LibraryBlobFolder; uploaderId: string; pathname: string }

/**
 * Parse a library blob URL into its shape. Null for any other folder, a malformed path, or a
 * shape `/api/upload` never writes. It does NOT check the host; pair it with ourBlobStoreAccess().
 */
export function parseLibraryBlobPath(blobUrl: string): LibraryBlobPath | null {
  let rawPathname: string
  try {
    rawPathname = new URL(blobUrl.trim()).pathname
  } catch {
    return null
  }
  let parts: string[]
  try {
    parts = rawPathname.replace(/^\//, "").split("/").map((p) => decodeURIComponent(p))
  } catch {
    return null
  }
  if (parts.some((p) => p === "" || p === "." || p === ".." || p.includes("/"))) return null

  const folder = parts[0] as LibraryBlobFolder
  if (!LIBRARY_BLOB_FOLDERS.includes(folder)) return null
  const pathname = parts.join("/")
  const uploaderId = parts[parts.length - 2]

  if (parts[1] === ORG_SEGMENT) {
    // agency-library/org/{org}/{user}/{file}, reference-materials/org/{org}[/{project}]/{user}/{file}
    const okLength = folder === "agency-library" ? parts.length === 5 : parts.length === 5 || parts.length === 6
    if (!okLength || !isUuid(parts[2]) || !isUuid(uploaderId)) return null
    if (parts.length === 6 && !isUuid(parts[3])) return null
    return { scope: "org", folder, orgId: parts[2], uploaderId, pathname }
  }

  // agency-library/{user}/{file}, reference-materials/{agency}[/{project}]/{user}/{file}
  const okLegacyLength = folder === "agency-library" ? parts.length === 3 : parts.length === 4 || parts.length === 5
  if (!okLegacyLength || !isUuid(uploaderId)) return null
  return { scope: "legacy", folder, uploaderId, pathname }
}

/**
 * The write-side rule for agency_library_documents.blob_url: the URL must be in OUR store and
 * under `{folder}/org/{orgId}/` for exactly the organization that will own the row. Returns the
 * server-derived pathname to store as blob_path, or null to refuse.
 */
export function libraryBlobPathForOrg(blobUrl: unknown, orgId: string): string | null {
  if (typeof blobUrl !== "string" || !blobUrl.trim()) return null
  if (!ourBlobStoreAccess(blobUrl)) return null
  const parsed = parseLibraryBlobPath(blobUrl)
  if (!parsed || parsed.scope !== "org" || parsed.orgId !== orgId) return null
  return parsed.pathname
}
