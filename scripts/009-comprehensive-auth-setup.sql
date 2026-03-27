-- Comprehensive Auth Setup for Ligament
-- This script sets up the complete auth infrastructure for Lead Agency and Partner users

-- 1. Add columns to profiles table if they don't exist
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'partner' CHECK (role IN ('agency', 'partner')),
ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS demo_access BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS company_name TEXT,
ADD COLUMN IF NOT EXISTS full_name TEXT,
ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. Set defaults for existing users
UPDATE public.profiles SET is_paid = false WHERE is_paid IS NULL;
UPDATE public.profiles SET is_admin = false WHERE is_admin IS NULL;
UPDATE public.profiles SET demo_access = false WHERE demo_access IS NULL;
UPDATE public.profiles SET role = 'partner' WHERE role IS NULL;

-- 3. Set greg@withligament.com as admin with demo access
UPDATE public.profiles 
SET is_admin = true, is_paid = true, demo_access = true, role = 'agency'
WHERE email = 'greg@withligament.com';

-- 4. Create or replace the handle_new_user function to properly set up profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role TEXT;
  owner_email TEXT := 'greg@withligament.com';
BEGIN
  -- Get role from user metadata, default to 'partner'
  user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'partner');
  
  -- Insert new profile
  INSERT INTO public.profiles (id, email, full_name, company_name, role, is_paid, is_admin, demo_access, email_verified)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'company_name', ''),
    user_role,
    -- Only owner is paid by default
    CASE WHEN NEW.email = owner_email THEN true ELSE false END,
    -- Only owner is admin
    CASE WHEN NEW.email = owner_email THEN true ELSE false END,
    -- Only owner has demo access by default
    CASE WHEN NEW.email = owner_email THEN true ELSE false END,
    -- Email verified status
    COALESCE(NEW.email_confirmed_at IS NOT NULL, false)
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    company_name = COALESCE(EXCLUDED.company_name, profiles.company_name),
    role = COALESCE(profiles.role, EXCLUDED.role),
    email_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, profiles.email_verified);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Recreate the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Also update profile when email is confirmed
CREATE OR REPLACE FUNCTION public.handle_user_updated()
RETURNS TRIGGER AS $$
BEGIN
  -- Update email_verified when user confirms email
  IF NEW.email_confirmed_at IS NOT NULL AND (OLD.email_confirmed_at IS NULL OR OLD.email_confirmed_at != NEW.email_confirmed_at) THEN
    UPDATE public.profiles
    SET email_verified = true
    WHERE id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_updated();

-- 7. Create invitation_requests table for partners requesting access from agencies
CREATE TABLE IF NOT EXISTS public.invitation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agency_email TEXT NOT NULL,
  agency_name TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'accepted', 'declined')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Enable RLS on invitation_requests
ALTER TABLE public.invitation_requests ENABLE ROW LEVEL SECURITY;

-- 9. RLS policies for invitation_requests
DROP POLICY IF EXISTS "Partners can view their own requests" ON public.invitation_requests;
CREATE POLICY "Partners can view their own requests" 
  ON public.invitation_requests FOR SELECT 
  TO authenticated 
  USING (partner_id = auth.uid());

DROP POLICY IF EXISTS "Partners can create requests" ON public.invitation_requests;
CREATE POLICY "Partners can create requests" 
  ON public.invitation_requests FOR INSERT 
  TO authenticated 
  WITH CHECK (partner_id = auth.uid());

DROP POLICY IF EXISTS "Agencies can view requests sent to their email" ON public.invitation_requests;
CREATE POLICY "Agencies can view requests sent to their email" 
  ON public.invitation_requests FOR SELECT 
  TO authenticated 
  USING (
    agency_email IN (
      SELECT email FROM public.profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Agencies can update requests sent to them" ON public.invitation_requests;
CREATE POLICY "Agencies can update requests sent to them" 
  ON public.invitation_requests FOR UPDATE 
  TO authenticated 
  USING (
    agency_email IN (
      SELECT email FROM public.profiles WHERE id = auth.uid()
    )
  );

-- 10. Ensure profiles RLS policies exist
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" 
  ON public.profiles FOR SELECT 
  TO authenticated 
  USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" 
  ON public.profiles FOR UPDATE 
  TO authenticated 
  USING (id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles" 
  ON public.profiles FOR SELECT 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
    )
  );

DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Admins can update all profiles" 
  ON public.profiles FOR UPDATE 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
    )
  );

-- 11. Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_invitation_requests_agency_email ON public.invitation_requests(agency_email);
