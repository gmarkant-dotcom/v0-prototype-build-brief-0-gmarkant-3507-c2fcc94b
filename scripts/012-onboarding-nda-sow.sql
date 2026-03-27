-- Onboarding deployments (lead agency → partner) + NDA / SOW tracking per assignment

CREATE TABLE IF NOT EXISTS public.onboarding_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES public.project_assignments(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  document_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom_message TEXT,
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_deployments_project ON public.onboarding_deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_deployments_assignment ON public.onboarding_deployments(assignment_id);

CREATE TABLE IF NOT EXISTS public.assignment_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.project_assignments(id) ON DELETE CASCADE,
  agreement_type TEXT NOT NULL CHECK (agreement_type IN ('nda', 'sow')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'viewed', 'signed', 'declined')),
  signed_at TIMESTAMPTZ,
  signed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  external_document_url TEXT,
  template_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT assignment_agreements_unique_type UNIQUE (assignment_id, agreement_type)
);

CREATE INDEX IF NOT EXISTS idx_assignment_agreements_assignment ON public.assignment_agreements(assignment_id);

ALTER TABLE public.onboarding_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_agreements ENABLE ROW LEVEL SECURITY;

-- Lead agency: full access to deployments for their projects
CREATE POLICY "Agencies manage onboarding deployments for own projects"
  ON public.onboarding_deployments FOR ALL TO authenticated
  USING (
    project_id IN (SELECT id FROM public.projects WHERE agency_id = auth.uid())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE agency_id = auth.uid())
  );

-- Partners: read deployments for assignments they belong to
CREATE POLICY "Partners read onboarding deployments for their assignments"
  ON public.onboarding_deployments FOR SELECT TO authenticated
  USING (
    assignment_id IN (
      SELECT pa.id FROM public.project_assignments pa
      JOIN public.partnerships p ON pa.partnership_id = p.id
      WHERE p.partner_id = auth.uid()
    )
  );

-- Agreements: agency + partner on that assignment
CREATE POLICY "Agencies manage agreements for their project assignments"
  ON public.assignment_agreements FOR ALL TO authenticated
  USING (
    assignment_id IN (
      SELECT pa.id FROM public.project_assignments pa
      JOIN public.projects pr ON pa.project_id = pr.id
      WHERE pr.agency_id = auth.uid()
    )
  )
  WITH CHECK (
    assignment_id IN (
      SELECT pa.id FROM public.project_assignments pa
      JOIN public.projects pr ON pa.project_id = pr.id
      WHERE pr.agency_id = auth.uid()
    )
  );

CREATE POLICY "Partners read and update own assignment agreements"
  ON public.assignment_agreements FOR SELECT TO authenticated
  USING (
    assignment_id IN (
      SELECT pa.id FROM public.project_assignments pa
      JOIN public.partnerships p ON pa.partnership_id = p.id
      WHERE p.partner_id = auth.uid()
    )
  );

CREATE POLICY "Partners update agreement signature fields"
  ON public.assignment_agreements FOR UPDATE TO authenticated
  USING (
    assignment_id IN (
      SELECT pa.id FROM public.project_assignments pa
      JOIN public.partnerships p ON pa.partnership_id = p.id
      WHERE p.partner_id = auth.uid()
    )
  )
  WITH CHECK (
    assignment_id IN (
      SELECT pa.id FROM public.project_assignments pa
      JOIN public.partnerships p ON pa.partnership_id = p.id
      WHERE p.partner_id = auth.uid()
    )
  );
