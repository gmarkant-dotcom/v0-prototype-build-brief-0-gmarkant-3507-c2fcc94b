-- Client profiles (Workstream A). Authored Aug 13, 2026. NOT APPLIED.
--
-- An agency sets up a reusable client profile once - Samsung, adidas - carrying key documents,
-- standing requirements and internal notes, then selects it anywhere a client is named so those
-- documents and defaults auto-apply instead of being re-entered.
--
-- Full reasoning in docs/client-profiles-discovery.md. The three decisions that shape this file:
--
--   1. DOCUMENTS ARE NOT A NEW TABLE. agency_library_documents is already agency-scoped, already
--      handles both a Vercel Blob file and an external URL, and already has a full CRUD API
--      (GET/POST, DELETE by id, file upload). Client documents become rows in it with client_id
--      set. Every existing row keeps client_id NULL and is untouched. One nullable column
--      instead of duplicating an upload, storage, listing and deletion stack.
--
--   2. DEFAULTS REUSE THE EXACT JSONB SHAPES THE WIZARD ALREADY CONSUMES, so pre-filling an RFP
--      is an assignment rather than a translation, and both shapes already normalize null,
--      undefined, a JSON string and malformed input to "empty".
--
--   3. NO BACKFILL. projects.client_name stays exactly as it is on every existing row. The
--      entity applies to new selections only. Whether to match historical strings onto profiles
--      is a separate, reviewed decision - a blind UPDATE here would silently merge two clients
--      that happen to share a name across agencies, or split one that was typed two ways.
--
-- Scope note: agency-scoped, exactly like agency_library_documents and bid_scoring_criteria.
-- Multi-user organizations are a separate epic; nothing here assumes more than one user per
-- agency, and nothing here blocks that epic later.

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  name text NOT NULL,
  -- Internal to the agency. NEVER reaches a vendor: only documents and criteria deliberately
  -- placed into an RFP travel outward. The application states this in UI copy and enforces it by
  -- never selecting this column on any vendor-facing route.
  notes text NULL,
  -- Same shape as partner_rfp_inbox.master_rfp_json.business_criteria_required and
  -- rfp_magic_tokens.business_criteria_required (lib/business-criteria.ts). NULL means this
  -- profile carries no default, which is indistinguishable from having no profile at all.
  default_business_criteria jsonb NULL,
  -- Same shape as master_rfp_json.evaluation_criteria and rfp_magic_tokens.evaluation_criteria
  -- (lib/rfp-evaluation-criteria.ts). The 8-criterion cap is enforced in application code on
  -- both write and read - deliberately not a CHECK here, since a jsonb-length CHECK would
  -- reject an otherwise-valid profile with an error the UI cannot explain.
  default_evaluation_criteria jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clients_agency_id_idx ON clients (agency_id);

-- DELIBERATELY NOT UNIQUE. The product rule is that a duplicate name warns and links to the
-- existing profile but never hard-blocks - two genuinely different clients can share a name, and
-- an agency mid-rename should not be stopped by the database. This index exists to make the
-- case-insensitive lookup behind that warning fast, nothing more. A UNIQUE index here would turn
-- a warning into a 23505 the UI would have to apologize for.
CREATE INDEX IF NOT EXISTS clients_agency_lower_name_idx ON clients (agency_id, lower(name));

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Matches the single-policy agency_id = auth.uid() pattern used by bid_scoring_criteria (065),
-- bid_decompositions (064) and client_cash_flow.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clients' AND policyname = 'Agencies manage own clients') THEN
    CREATE POLICY "Agencies manage own clients"
      ON clients
      FOR ALL
      TO authenticated
      USING (agency_id = auth.uid())
      WITH CHECK (agency_id = auth.uid());
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------
-- Document linkage - reuse, not a new join table
-- ---------------------------------------------------------------------------------------
-- A client document is an agency_library_documents row with client_id set. Rows belonging to the
-- agency itself (NDAs, MSAs, templates) keep client_id NULL, and every listing that exists today
-- continues to return exactly what it returns now.
--
-- ON DELETE SET NULL, not CASCADE: deleting a profile must not destroy an uploaded file's record
-- while its blob lives on in storage. The row survives, unfiled. Note that A1 does not ship
-- profile deletion, so this path is authored but unexercised - see the run report's open
-- questions before adding a delete action.
ALTER TABLE agency_library_documents
  ADD COLUMN IF NOT EXISTS client_id uuid NULL REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS agency_library_documents_client_id_idx
  ON agency_library_documents (client_id)
  WHERE client_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------
-- The entity link on the one record that owns a client today
-- ---------------------------------------------------------------------------------------
-- projects.client_name is the only writable client field in the schema; every other appearance
-- of a client (master_rfp_json.client, and the magic-link flow's derived reads) is a snapshot or
-- a join off this row. So this is the only record that needs a client_id.
--
-- client_name is NOT dropped, NOT renamed and NOT backfilled. A project keeps whatever string it
-- has forever; client_id is set only when a future selection deliberately sets it. Readers
-- resolve the entity first and fall back to the string, so a legacy project renders and behaves
-- exactly as it does today.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS client_id uuid NULL REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projects_client_id_idx ON projects (client_id) WHERE client_id IS NOT NULL;

-- Verification (run manually after applying; not part of the migration):
--
-- SELECT table_name, column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'clients'
-- ORDER BY ordinal_position;
-- -- Expected 8 rows: id uuid NO, agency_id uuid NO, name text NO, notes text YES,
-- --   default_business_criteria jsonb YES, default_evaluation_criteria jsonb YES,
-- --   created_at timestamptz NO, updated_at timestamptz NO
--
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
-- WHERE (table_name = 'agency_library_documents' AND column_name = 'client_id')
--    OR (table_name = 'projects' AND column_name = 'client_id');
-- -- Expected: 2 rows, both uuid, both is_nullable = YES
--
-- SELECT policyname FROM pg_policies WHERE tablename = 'clients';
-- -- Expected: one row, "Agencies manage own clients"
--
-- SELECT count(*) AS clients_rows FROM clients;
-- -- Expected: 0
--
-- SELECT count(*) AS docs_now_client_scoped FROM agency_library_documents WHERE client_id IS NOT NULL;
-- SELECT count(*) AS projects_now_entity_linked FROM projects WHERE client_id IS NOT NULL;
-- -- Expected: 0, 0. THESE TWO MATTER MOST - a non-zero result means applying this migration
-- -- attached existing documents or existing projects to a client, which it must never do.
--
-- SELECT count(*) AS projects_with_a_client_string FROM projects WHERE client_name IS NOT NULL;
-- -- Expected: the SAME count as before applying. Write it down first. Every legacy string must
-- -- survive untouched - this migration performs no backfill of any kind.
