-- Onboarding packages, per-partner document payloads, and agency library (master docs / templates)
-- Spec: onboarding_packages uses partnership_id → public.partnerships(id) (identifies which partner receives the package).

CREATE TYPE public.onboarding_kickoff_type AS ENUM ('calendly', 'availability', 'none');

CREATE TYPE public.onboarding_package_doc_role AS ENUM ('agency_doc', 'project_doc', 'template');

-- Lead-agency document library: agency-level (NDA, MSA, SOW) vs key templates
CREATE TABLE IF NOT EXISTS public.agency_library_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN ('agency', 'templates')),
  kind TEXT NOT NULL CHECK (kind IN (
    'nda', 'msa', 'sow',
    'client_brief', 'master_brief', 'partner_brief', 'budget', 'timeline', 'other'
  )),
  label TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'file' CHECK (source_type IN ('file', 'url')),
  external_url TEXT,
  blob_url TEXT,
  blob_path TEXT,
  file_name TEXT,
  file_type TEXT,
  file_size INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agency_library_agency ON public.agency_library_documents(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_library_agency_section ON public.agency_library_documents(agency_id, section);

CREATE TABLE IF NOT EXISTS public.onboarding_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  partnership_id UUID NOT NULL REFERENCES public.partnerships(id) ON DELETE CASCADE,
  kickoff_type public.onboarding_kickoff_type NOT NULL DEFAULT 'none',
  kickoff_url TEXT,
  kickoff_availability TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'reviewed')),
  partner_reviewed_at TIMESTAMPTZ,
  custom_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_packages_project ON public.onboarding_packages(project_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_packages_partnership ON public.onboarding_packages(partnership_id);

CREATE TABLE IF NOT EXISTS public.onboarding_package_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.onboarding_packages(id) ON DELETE CASCADE,
  document_role public.onboarding_package_doc_role NOT NULL,
  library_document_id UUID REFERENCES public.agency_library_documents(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_pkg_docs_package ON public.onboarding_package_documents(package_id);

ALTER TABLE public.agency_library_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_package_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency manages own library documents"
  ON public.agency_library_documents
  FOR ALL
  TO authenticated
  USING (agency_id = auth.uid())
  WITH CHECK (agency_id = auth.uid());

CREATE POLICY "Agency full access onboarding packages for own projects"
  ON public.onboarding_packages
  FOR ALL
  TO authenticated
  USING (
    project_id IN (SELECT id FROM public.projects WHERE agency_id = auth.uid())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE agency_id = auth.uid())
    AND agency_id = auth.uid()
  );

CREATE POLICY "Partner reads onboarding packages for their partnership"
  ON public.onboarding_packages
  FOR SELECT
  TO authenticated
  USING (
    partnership_id IN (SELECT id FROM public.partnerships WHERE partner_id = auth.uid())
  );

CREATE POLICY "Partner updates review fields on own packages"
  ON public.onboarding_packages
  FOR UPDATE
  TO authenticated
  USING (
    partnership_id IN (SELECT id FROM public.partnerships WHERE partner_id = auth.uid())
  )
  WITH CHECK (
    partnership_id IN (SELECT id FROM public.partnerships WHERE partner_id = auth.uid())
  );

CREATE POLICY "Agency full access package document rows"
  ON public.onboarding_package_documents
  FOR ALL
  TO authenticated
  USING (
    package_id IN (
      SELECT op.id FROM public.onboarding_packages op
      JOIN public.projects p ON p.id = op.project_id
      WHERE p.agency_id = auth.uid()
    )
  )
  WITH CHECK (
    package_id IN (
      SELECT op.id FROM public.onboarding_packages op
      JOIN public.projects p ON p.id = op.project_id
      WHERE p.agency_id = auth.uid()
    )
  );

CREATE POLICY "Partner reads documents for their packages"
  ON public.onboarding_package_documents
  FOR SELECT
  TO authenticated
  USING (
    package_id IN (
      SELECT id FROM public.onboarding_packages
      WHERE partnership_id IN (SELECT id FROM public.partnerships WHERE partner_id = auth.uid())
    )
  );
