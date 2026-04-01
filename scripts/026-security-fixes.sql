-- Security fixes requested from Supabase advisor.
-- Note: handle_new_user search_path warning and leaked password protection warning
-- are intentionally tracked separately and not blocked by this migration.

-- 1) Enable and scope RLS for contact submissions.
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can insert contact submissions" ON public.contact_submissions;
CREATE POLICY "Anyone can insert contact submissions"
  ON public.contact_submissions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can read contact submissions" ON public.contact_submissions;
CREATE POLICY "Admins can read contact submissions"
  ON public.contact_submissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    )
  );

-- 2) Replace permissive notifications INSERT policy (WITH CHECK true) with scoped checks.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.notifications', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "Scoped insert notifications"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Self-notifications are allowed.
    user_id = auth.uid()
    OR
    -- Agency can notify active partners in their ecosystem.
    EXISTS (
      SELECT 1
      FROM public.partnerships p
      WHERE p.agency_id = auth.uid()
        AND p.partner_id = notifications.user_id
        AND p.status = 'active'
    )
    OR
    -- Partner can notify agencies they are actively partnered with.
    EXISTS (
      SELECT 1
      FROM public.partnerships p
      WHERE p.partner_id = auth.uid()
        AND p.agency_id = notifications.user_id
        AND p.status = 'active'
    )
  );
