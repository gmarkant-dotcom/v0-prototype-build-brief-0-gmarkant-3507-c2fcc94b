-- Migration 056: Default new users to full dual-role access with is_paid = true
--
-- Root cause: handle_new_user() trigger set is_paid = false for all non-owner signups
-- and did not set secondary_role. This migration replaces the trigger function so every
-- new user gets role='agency', active_role='agency', secondary_role='partner', is_paid=true.
-- The backfill at the bottom applies the same defaults to existing users.

-- 1. Replace trigger function with updated defaults
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id, email, full_name, company_name,
    role, active_role, secondary_role,
    is_paid, is_admin, demo_access, email_verified
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'company_name', ''),
    'agency',
    'agency',
    'partner',
    true,
    CASE WHEN NEW.email = 'greg@withligament.com' THEN true ELSE false END,
    CASE WHEN NEW.email = 'greg@withligament.com' THEN true ELSE false END,
    COALESCE(NEW.email_confirmed_at IS NOT NULL, false)
  )
  ON CONFLICT (id) DO UPDATE SET
    email    = EXCLUDED.email,
    full_name    = COALESCE(EXCLUDED.full_name, profiles.full_name),
    company_name = COALESCE(EXCLUDED.company_name, profiles.company_name);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Backfill existing users missing dual-role defaults
UPDATE profiles
SET
  role         = 'agency',
  active_role  = 'agency',
  secondary_role = 'partner',
  is_paid      = true
WHERE
  secondary_role IS NULL
  OR is_paid = false
  OR is_paid IS NULL;
