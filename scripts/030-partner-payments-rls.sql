-- Partner payment schedule visibility + optional rate_info column.
-- Run after 029-msa-payments (payment_milestones exists).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS rate_info JSONB;

-- Partners can SELECT milestones tied to their partnerships.
DROP POLICY IF EXISTS "Partners read payment milestones for their partnerships" ON public.payment_milestones;
CREATE POLICY "Partners read payment milestones for their partnerships"
  ON public.payment_milestones
  FOR SELECT
  TO authenticated
  USING (
    partnership_id IS NOT NULL
    AND partnership_id IN (SELECT id FROM public.partnerships WHERE partner_id = auth.uid())
  );

-- Partners can read lead agency profiles they are partnered with (company name, etc.).
DROP POLICY IF EXISTS "Partners read lead agency profiles for their partnerships" ON public.profiles;
CREATE POLICY "Partners read lead agency profiles for their partnerships"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.partnerships p
      WHERE p.partner_id = auth.uid() AND p.agency_id = profiles.id
    )
  );

-- Partners can read project rows when a payment milestone exists for that project + partnership.
DROP POLICY IF EXISTS "Partners read projects with their payment milestones" ON public.projects;
CREATE POLICY "Partners read projects with their payment milestones"
  ON public.projects
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.payment_milestones pm
      JOIN public.partnerships ps ON ps.id = pm.partnership_id
      WHERE pm.project_id = projects.id
        AND ps.partner_id = auth.uid()
    )
  );
