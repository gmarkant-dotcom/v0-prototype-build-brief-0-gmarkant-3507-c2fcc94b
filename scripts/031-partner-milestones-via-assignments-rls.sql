-- Allow partners to read payment_milestones for projects where they have an awarded assignment.
-- Fixes rows with NULL partnership_id (still visible to agency) that the partnership_id-only policy hid.

DROP POLICY IF EXISTS "Partners read milestones for awarded assignment projects" ON public.payment_milestones;
CREATE POLICY "Partners read milestones for awarded assignment projects"
  ON public.payment_milestones
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_assignments pa
      JOIN public.partnerships ps ON ps.id = pa.partnership_id
      WHERE pa.project_id = payment_milestones.project_id
        AND ps.partner_id = auth.uid()
        AND pa.status = 'awarded'
    )
  );
