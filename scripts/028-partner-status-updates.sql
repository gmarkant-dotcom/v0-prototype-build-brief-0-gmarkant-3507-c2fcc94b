-- Migration 028: partner_status_updates table
CREATE TABLE IF NOT EXISTS public.partner_status_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_assignment_id uuid NOT NULL REFERENCES public.project_assignments(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  partnership_id uuid NOT NULL REFERENCES public.partnerships(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('on_track','at_risk','delayed','blocked','complete')),
  budget_status text NOT NULL CHECK (budget_status IN ('on_budget','over_budget','incremental_needed','scope_creep')),
  completion_pct integer NOT NULL DEFAULT 0 CHECK (completion_pct >= 0 AND completion_pct <= 100),
  notes text,
  is_resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_status_updates_project ON public.partner_status_updates(project_id);
CREATE INDEX IF NOT EXISTS idx_partner_status_updates_assignment ON public.partner_status_updates(project_assignment_id);
CREATE INDEX IF NOT EXISTS idx_partner_status_updates_partnership ON public.partner_status_updates(partnership_id);
CREATE INDEX IF NOT EXISTS idx_partner_status_updates_unresolved ON public.partner_status_updates(project_id, is_resolved) WHERE is_resolved = false;

ALTER TABLE public.partner_status_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners read own status updates"
  ON public.partner_status_updates FOR SELECT TO authenticated
  USING (
    partnership_id IN (SELECT id FROM public.partnerships WHERE partner_id = auth.uid())
  );

CREATE POLICY "Partners insert status updates for own assignment"
  ON public.partner_status_updates FOR INSERT TO authenticated
  WITH CHECK (
    partnership_id IN (SELECT id FROM public.partnerships WHERE partner_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.project_assignments pa
      WHERE pa.id = project_assignment_id
        AND pa.partnership_id = partner_status_updates.partnership_id
        AND pa.project_id = partner_status_updates.project_id
    )
  );

CREATE POLICY "Agency read status updates for own projects"
  ON public.partner_status_updates FOR SELECT TO authenticated
  USING (
    project_id IN (SELECT id FROM public.projects WHERE agency_id = auth.uid())
  );

CREATE POLICY "Agency update resolve flag on status updates"
  ON public.partner_status_updates FOR UPDATE TO authenticated
  USING (
    project_id IN (SELECT id FROM public.projects WHERE agency_id = auth.uid())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE agency_id = auth.uid())
  );
