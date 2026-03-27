-- Create agency_partner_invitations table
-- Tracks invitations from lead agencies to partner agencies

CREATE TABLE IF NOT EXISTS public.agency_partner_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_email TEXT NOT NULL,
  partner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'confirmed')),
  invitation_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  accepted_at TIMESTAMP WITH TIME ZONE,
  confirmed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_invitations_agency_id ON public.agency_partner_invitations(agency_id);
CREATE INDEX IF NOT EXISTS idx_invitations_partner_id ON public.agency_partner_invitations(partner_id);
CREATE INDEX IF NOT EXISTS idx_invitations_partner_email ON public.agency_partner_invitations(partner_email);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON public.agency_partner_invitations(status);

-- Enable RLS
ALTER TABLE public.agency_partner_invitations ENABLE ROW LEVEL SECURITY;

-- Agencies can see all invitations they've sent
CREATE POLICY "Agencies can view their sent invitations"
  ON public.agency_partner_invitations
  FOR SELECT
  TO authenticated
  USING (agency_id = auth.uid());

-- Agencies can create invitations
CREATE POLICY "Agencies can create invitations"
  ON public.agency_partner_invitations
  FOR INSERT
  TO authenticated
  WITH CHECK (agency_id = auth.uid());

-- Agencies can update their invitations (confirm partner)
CREATE POLICY "Agencies can update their invitations"
  ON public.agency_partner_invitations
  FOR UPDATE
  TO authenticated
  USING (agency_id = auth.uid());

-- Partners can see invitations sent to them (by email or partner_id)
CREATE POLICY "Partners can view invitations to them"
  ON public.agency_partner_invitations
  FOR SELECT
  TO authenticated
  USING (
    partner_id = auth.uid() OR 
    partner_email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Partners can update invitations sent to them (accept/decline)
CREATE POLICY "Partners can update invitations to them"
  ON public.agency_partner_invitations
  FOR UPDATE
  TO authenticated
  USING (
    partner_id = auth.uid() OR 
    partner_email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Create function to auto-link partner_id when user exists
CREATE OR REPLACE FUNCTION link_partner_to_invitation()
RETURNS TRIGGER AS $$
BEGIN
  -- If partner_id is not set, try to find user by email
  IF NEW.partner_id IS NULL THEN
    SELECT id INTO NEW.partner_id
    FROM public.profiles
    WHERE email = NEW.partner_email;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to auto-link partner
DROP TRIGGER IF EXISTS trigger_link_partner_invitation ON public.agency_partner_invitations;
CREATE TRIGGER trigger_link_partner_invitation
  BEFORE INSERT OR UPDATE ON public.agency_partner_invitations
  FOR EACH ROW
  EXECUTE FUNCTION link_partner_to_invitation();

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION update_invitation_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  
  IF OLD.status != 'accepted' AND NEW.status = 'accepted' THEN
    NEW.accepted_at = NOW();
  END IF;
  
  IF OLD.status != 'confirmed' AND NEW.status = 'confirmed' THEN
    NEW.confirmed_at = NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for timestamps
DROP TRIGGER IF EXISTS trigger_invitation_timestamps ON public.agency_partner_invitations;
CREATE TRIGGER trigger_invitation_timestamps
  BEFORE UPDATE ON public.agency_partner_invitations
  FOR EACH ROW
  EXECUTE FUNCTION update_invitation_timestamps();
