-- Optional: align partnerships with invite-before-signup flow (run if POST /api/partnerships fails).
-- The app invites by email before a partner account exists.

ALTER TABLE public.partnerships
  ADD COLUMN IF NOT EXISTS partner_email TEXT;

-- Allow pending invites with no linked profile yet
ALTER TABLE public.partnerships
  ALTER COLUMN partner_id DROP NOT NULL;

-- Prevent duplicate pending invites per agency + email
CREATE UNIQUE INDEX IF NOT EXISTS idx_partnerships_agency_email
  ON public.partnerships (agency_id, lower(partner_email))
  WHERE partner_email IS NOT NULL AND status = 'pending';
