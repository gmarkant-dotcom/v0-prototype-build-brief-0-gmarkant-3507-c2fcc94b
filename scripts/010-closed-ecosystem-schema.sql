-- =====================================================
-- CLOSED ECOSYSTEM SCHEMA
-- Two-Tier Partnership Architecture
-- =====================================================

-- =====================================================
-- TIER 1: PARTNERSHIPS
-- Created when partner accepts invitation from lead agency
-- Establishes business relationship, partner appears in agency pool
-- =====================================================

CREATE TABLE IF NOT EXISTS public.partnerships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Status: pending (invited), active (accepted), suspended, terminated
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'terminated')),
  
  -- Invitation details
  invitation_message TEXT,
  invited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  accepted_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure unique partnership per agency-partner pair
  UNIQUE(agency_id, partner_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_partnerships_agency ON public.partnerships(agency_id);
CREATE INDEX IF NOT EXISTS idx_partnerships_partner ON public.partnerships(partner_id);
CREATE INDEX IF NOT EXISTS idx_partnerships_status ON public.partnerships(status);

-- =====================================================
-- TIER 1.5: PROJECTS
-- Lead agency creates projects (RFPs/bids)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Project details
  title TEXT NOT NULL,
  description TEXT,
  client_name TEXT,
  budget_range TEXT,
  deadline TIMESTAMP WITH TIME ZONE,
  
  -- Status: draft, open (accepting bids), in_progress, completed, cancelled
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'in_progress', 'completed', 'cancelled')),
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_agency ON public.projects(agency_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);

-- =====================================================
-- TIER 2: PROJECT ASSIGNMENTS
-- Created when agency assigns a partner to a specific project
-- This is the closed loop for project-specific communication
-- =====================================================

CREATE TABLE IF NOT EXISTS public.project_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  partnership_id UUID NOT NULL REFERENCES public.partnerships(id) ON DELETE CASCADE,
  
  -- Assignment status: invited, accepted, declined, awarded, completed
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'declined', 'awarded', 'completed')),
  
  -- Bid details (filled by partner)
  bid_amount DECIMAL(12, 2),
  bid_notes TEXT,
  bid_submitted_at TIMESTAMP WITH TIME ZONE,
  
  -- Award details
  awarded_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Each partner can only be assigned once per project
  UNIQUE(project_id, partnership_id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_project ON public.project_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_assignments_partnership ON public.project_assignments(partnership_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON public.project_assignments(status);

-- =====================================================
-- SHARED DOCUMENTS
-- Files shared within project assignments (closed loop)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.shared_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.project_assignments(id) ON DELETE CASCADE,
  
  -- Who uploaded
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- File details
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  blob_url TEXT NOT NULL, -- Vercel Blob URL (private)
  blob_path TEXT NOT NULL, -- Path in blob storage for organization
  
  -- Document type: rfp, bid, contract, deliverable, other
  document_type TEXT NOT NULL DEFAULT 'other' CHECK (document_type IN ('rfp', 'bid', 'contract', 'deliverable', 'other')),
  
  -- Optional description
  description TEXT,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_assignment ON public.shared_documents(assignment_id);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON public.shared_documents(uploaded_by);

-- =====================================================
-- MESSAGES
-- Communication within project assignments (closed loop)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.assignment_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.project_assignments(id) ON DELETE CASCADE,
  
  -- Who sent
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Message content
  content TEXT NOT NULL,
  
  -- Optional attachment reference
  document_id UUID REFERENCES public.shared_documents(id) ON DELETE SET NULL,
  
  -- Read status
  read_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_assignment ON public.assignment_messages(assignment_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.assignment_messages(sender_id);

-- =====================================================
-- ROW LEVEL SECURITY POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_messages ENABLE ROW LEVEL SECURITY;

-- PARTNERSHIPS policies
CREATE POLICY "Agencies can view their partnerships" ON public.partnerships
  FOR SELECT TO authenticated
  USING (agency_id = auth.uid());

CREATE POLICY "Partners can view their partnerships" ON public.partnerships
  FOR SELECT TO authenticated
  USING (partner_id = auth.uid());

CREATE POLICY "Agencies can create partnerships (invite)" ON public.partnerships
  FOR INSERT TO authenticated
  WITH CHECK (agency_id = auth.uid());

CREATE POLICY "Agencies can update their partnerships" ON public.partnerships
  FOR UPDATE TO authenticated
  USING (agency_id = auth.uid());

CREATE POLICY "Partners can accept partnerships" ON public.partnerships
  FOR UPDATE TO authenticated
  USING (partner_id = auth.uid() AND status = 'pending');

-- PROJECTS policies
CREATE POLICY "Agencies can manage their projects" ON public.projects
  FOR ALL TO authenticated
  USING (agency_id = auth.uid());

CREATE POLICY "Partners can view assigned projects" ON public.projects
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT pa.project_id FROM public.project_assignments pa
      JOIN public.partnerships p ON pa.partnership_id = p.id
      WHERE p.partner_id = auth.uid()
    )
  );

-- PROJECT ASSIGNMENTS policies
CREATE POLICY "Agencies can manage assignments for their projects" ON public.project_assignments
  FOR ALL TO authenticated
  USING (
    project_id IN (SELECT id FROM public.projects WHERE agency_id = auth.uid())
  );

CREATE POLICY "Partners can view their assignments" ON public.project_assignments
  FOR SELECT TO authenticated
  USING (
    partnership_id IN (SELECT id FROM public.partnerships WHERE partner_id = auth.uid())
  );

CREATE POLICY "Partners can update their assignments (submit bids)" ON public.project_assignments
  FOR UPDATE TO authenticated
  USING (
    partnership_id IN (SELECT id FROM public.partnerships WHERE partner_id = auth.uid())
  );

-- SHARED DOCUMENTS policies
CREATE POLICY "Users can view documents in their assignments" ON public.shared_documents
  FOR SELECT TO authenticated
  USING (
    assignment_id IN (
      SELECT pa.id FROM public.project_assignments pa
      JOIN public.partnerships p ON pa.partnership_id = p.id
      JOIN public.projects pr ON pa.project_id = pr.id
      WHERE p.agency_id = auth.uid() OR p.partner_id = auth.uid()
    )
  );

CREATE POLICY "Users can upload documents to their assignments" ON public.shared_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid() AND
    assignment_id IN (
      SELECT pa.id FROM public.project_assignments pa
      JOIN public.partnerships p ON pa.partnership_id = p.id
      JOIN public.projects pr ON pa.project_id = pr.id
      WHERE p.agency_id = auth.uid() OR p.partner_id = auth.uid()
    )
  );

-- MESSAGES policies
CREATE POLICY "Users can view messages in their assignments" ON public.assignment_messages
  FOR SELECT TO authenticated
  USING (
    assignment_id IN (
      SELECT pa.id FROM public.project_assignments pa
      JOIN public.partnerships p ON pa.partnership_id = p.id
      WHERE p.agency_id = auth.uid() OR p.partner_id = auth.uid()
    )
  );

CREATE POLICY "Users can send messages in their assignments" ON public.assignment_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid() AND
    assignment_id IN (
      SELECT pa.id FROM public.project_assignments pa
      JOIN public.partnerships p ON pa.partnership_id = p.id
      WHERE p.agency_id = auth.uid() OR p.partner_id = auth.uid()
    )
  );

-- =====================================================
-- HELPER FUNCTION: Create partnership on invitation accept
-- =====================================================

CREATE OR REPLACE FUNCTION public.accept_partnership_invitation(invitation_id UUID)
RETURNS UUID AS $$
DECLARE
  v_partnership_id UUID;
BEGIN
  UPDATE public.partnerships
  SET status = 'active', accepted_at = NOW(), updated_at = NOW()
  WHERE id = invitation_id AND partner_id = auth.uid() AND status = 'pending'
  RETURNING id INTO v_partnership_id;
  
  RETURN v_partnership_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
