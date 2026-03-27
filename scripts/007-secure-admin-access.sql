-- Add is_admin and is_paid columns to profiles table
-- These columns control admin access and paid subscription status

-- Add the columns if they don't exist
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT false;

-- Reset all admin flags to false
UPDATE public.profiles 
SET is_admin = false;

-- Set the owner as admin (if the account exists)
UPDATE public.profiles 
SET is_admin = true 
WHERE email = 'greg@withligament.com';

-- Update the handle_new_user function to include the new columns
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, company_name, role, is_admin, is_paid)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NULL),
    COALESCE(NEW.raw_user_meta_data ->> 'company_name', NULL),
    COALESCE(NEW.raw_user_meta_data ->> 'role', 'partner'),
    CASE WHEN NEW.email = 'greg@withligament.com' THEN true ELSE false END,
    false
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
END;
$$;
