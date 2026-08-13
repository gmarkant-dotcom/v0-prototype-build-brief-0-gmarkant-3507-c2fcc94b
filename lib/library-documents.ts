import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * The one definition of document scope in this codebase.
 *
 * agency_library_documents carries a live CHECK constraint that predates client profiles:
 *
 *   agency_library_documents_section_check
 *     CHECK (section = ANY (ARRAY['agency'::text, 'templates'::text]))
 *
 * There is no 'client' section and there must never be one - migration 077 added client_id as
 * the discriminator instead. A client-scoped document is therefore an ordinary row whose
 * client_id is set; an agency document is one whose client_id is null. Section stays what it
 * always was: which shelf of the agency's own library a row belongs to.
 *
 * Items 1, 2 and 3 all consume the predicate and the query below. Do not re-implement either
 * per surface - a picker that filters differently from the shelf that wrote the row is exactly
 * how another client's document ends up on the wrong engagement.
 */

/** Sections the database will actually accept. Kept in sync with the CHECK above by hand,
 *  because a code change cannot widen a constraint. */
export const LIBRARY_SECTIONS = ["agency", "templates"] as const
export type LibrarySection = (typeof LIBRARY_SECTIONS)[number]

/** The section a client-scoped document is written under. It is a normal agency-library row;
 *  client_id is what makes it client-scoped, not this. */
export const CLIENT_DOCUMENT_SECTION: LibrarySection = "agency"

/** Kinds the database will accept (agency_library_documents_kind_check). */
export const LIBRARY_KINDS = [
  "nda",
  "msa",
  "sow",
  "client_brief",
  "master_brief",
  "partner_brief",
  "budget",
  "timeline",
  "other",
] as const
export type LibraryKind = (typeof LIBRARY_KINDS)[number]

/** Default for surfaces that do not collect a kind, per item 1. */
export const DEFAULT_LIBRARY_KIND: LibraryKind = "other"

export function isValidLibrarySection(value: unknown): value is LibrarySection {
  return typeof value === "string" && (LIBRARY_SECTIONS as readonly string[]).includes(value)
}

export function isValidLibraryKind(value: unknown): value is LibraryKind {
  return typeof value === "string" && (LIBRARY_KINDS as readonly string[]).includes(value)
}

export type LibraryDocumentLike = { client_id?: string | null }

/** THE predicate. A document is client-scoped when client_id is not null. Nothing else. */
export function isClientScopedDocument(doc: LibraryDocumentLike): boolean {
  return typeof doc.client_id === "string" && doc.client_id.length > 0
}

export function isAgencyDocument(doc: LibraryDocumentLike): boolean {
  return !isClientScopedDocument(doc)
}

/**
 * What a surface is allowed to see.
 *
 *   all     - every document this agency owns, its own and every client's. Master Documents
 *             only; it is the sole browse-everything surface.
 *   client  - exactly one client's documents, nothing else. The client profile page.
 *   project - agency documents PLUS the documents of the client behind this project. Every
 *             do-the-work picker. A project with no client_id gets agency documents only.
 *   agency  - agency documents only.
 */
export type LibraryScope =
  | { mode: "all" }
  | { mode: "client"; clientId: string }
  | { mode: "project"; projectId: string }
  | { mode: "agency" }

export const LIBRARY_DOCUMENT_COLUMNS =
  "id, section, kind, label, source_type, external_url, blob_url, blob_path, file_name, file_type, file_size, client_id, created_at, updated_at"

export type ScopedLibraryResult = {
  documents: Record<string, unknown>[]
  /** The client whose documents were included, when the scope resolved one. Null for an
   *  agency-only result, which is what a project with a typed client name and no client_id
   *  produces - and why no client heading should render for it. */
  clientId: string | null
  clientName: string | null
  /** id -> name for every client whose documents appear in `documents`. Sourced from the
   *  clients table by join, never from a string copied onto the document row - item 2's chip
   *  must be able to go stale only when the client is genuinely renamed. */
  clientNamesById: Record<string, string>
  error: string | null
}

/**
 * The one query. Every read of agency_library_documents outside Master Documents' own manager
 * goes through this, so scoping cannot drift between surfaces.
 *
 * client_id is selected unconditionally. Migration 077 is applied, so the column exists; if a
 * database is ever behind, the caller sees the error rather than a silently unscoped list,
 * which is the safe direction for a filter whose whole job is to exclude other clients' files.
 */
export async function fetchScopedLibraryDocuments(
  supabase: SupabaseClient,
  agencyId: string,
  scope: LibraryScope
): Promise<ScopedLibraryResult> {
  let clientId: string | null = null
  let clientName: string | null = null

  if (scope.mode === "client") {
    clientId = scope.clientId
  } else if (scope.mode === "project") {
    const { data: project, error: projectErr } = await supabase
      .from("projects")
      .select("id, client_id")
      .eq("id", scope.projectId)
      .eq("agency_id", agencyId)
      .maybeSingle()
    if (projectErr) {
      return { documents: [], clientId: null, clientName: null, clientNamesById: {}, error: projectErr.message }
    }
    const resolved = (project as Record<string, unknown> | null)?.client_id
    clientId = typeof resolved === "string" && resolved ? resolved : null
  }

  if (clientId) {
    const { data: client } = await supabase
      .from("clients")
      .select("id, name")
      .eq("id", clientId)
      .eq("agency_id", agencyId)
      .maybeSingle()
    clientName = (client?.name as string | undefined) ?? null
  }

  let query = supabase.from("agency_library_documents").select(LIBRARY_DOCUMENT_COLUMNS).eq("agency_id", agencyId)

  if (scope.mode === "client") {
    // Exactly this client. Never agency-wide rows, never another client's.
    query = query.eq("client_id", scope.clientId)
  } else if (scope.mode === "agency") {
    query = query.is("client_id", null)
  } else if (scope.mode === "project") {
    // Agency documents always, plus this client's when the project resolves one. A project with
    // a typed client name and no client_id lands in the agency-only branch, which is exactly
    // today's behavior for the six live projects in that state.
    query = clientId ? query.or(`client_id.is.null,client_id.eq.${clientId}`) : query.is("client_id", null)
  }
  // mode 'all' applies no client filter at all.

  const { data, error } = await query
    .order("section", { ascending: true })
    .order("kind", { ascending: true })
    .order("updated_at", { ascending: false })

  if (error) {
    return { documents: [], clientId, clientName, clientNamesById: {}, error: error.message }
  }

  const documents = (data || []) as Record<string, unknown>[]

  // Resolve a name for every client actually represented in the result, by join.
  const clientNamesById: Record<string, string> = {}
  if (clientId && clientName) clientNamesById[clientId] = clientName
  const unresolved = [
    ...new Set(
      documents
        .map((d) => d.client_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0 && !clientNamesById[v])
    ),
  ]
  if (unresolved.length > 0) {
    const { data: clientRows } = await supabase
      .from("clients")
      .select("id, name")
      .eq("agency_id", agencyId)
      .in("id", unresolved)
    for (const row of clientRows || []) clientNamesById[row.id as string] = row.name as string
  }

  return { documents, clientId, clientName, clientNamesById, error: null }
}
