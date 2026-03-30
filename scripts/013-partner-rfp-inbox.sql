-- Partner RFP inbox: one row per recipient × outsourced scope line when lead agency broadcasts from /agency RFP flow.
-- Partners read via GET /api/partner/rfps; lead agency writes via POST /api/agency/broadcast-rfp.

CREATE TABLE IF NOT EXISTS public.partner_rfp_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_email TEXT,
  partnership_id UUID REFERENCES public.partnerships(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  scope_item_id TEXT NOT NULL,
  scope_item_name TEXT NOT NULL,
  scope_item_description TEXT,
  estimated_budget TEXT,
  timeline TEXT,
  master_rfp_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Denormalized at broadcast time so partners can read without joining profiles (RLS).
  agency_company_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'viewed', 'bid_submitted', 'feedback_received', 'shortlisted', 'awarded', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT partner_rfp_inbox_recipient CHECK (
    partner_id IS NOT NULL OR (recipient_email IS NOT NULL AND length(trim(recipient_email)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_partner_rfp_inbox_partner_id ON public.partner_rfp_inbox(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_rfp_inbox_agency_id ON public.partner_rfp_inbox(agency_id);
CREATE INDEX IF NOT EXISTS idx_partner_rfp_inbox_recipient_email ON public.partner_rfp_inbox(lower(trim(recipient_email)));
CREATE INDEX IF NOT EXISTS idx_partner_rfp_inbox_created ON public.partner_rfp_inbox(created_at DESC);

ALTER TABLE public.partner_rfp_inbox ENABLE ROW LEVEL SECURITY;

-- Lead agency: insert own broadcasts
CREATE POLICY "Agencies insert partner RFP inbox rows"
  ON public.partner_rfp_inbox FOR INSERT TO authenticated
  WITH CHECK (agency_id = auth.uid());

-- Lead agency: read what they sent
CREATE POLICY "Agencies select own partner RFP inbox rows"
  ON public.partner_rfp_inbox FOR SELECT TO authenticated
  USING (agency_id = auth.uid());

-- Partner: rows addressed to them by profile id
CREATE POLICY "Partners select inbox rows by partner_id"
  ON public.partner_rfp_inbox FOR SELECT TO authenticated
  USING (partner_id = auth.uid());

-- Partner: rows addressed by email before partner_id linked (matches profiles.email)
CREATE POLICY "Partners select inbox rows by recipient email"
  ON public.partner_rfp_inbox FOR SELECT TO authenticated
  USING (
    recipient_email IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = auth.uid()
        AND lower(trim(pr.email)) = lower(trim(partner_rfp_inbox.recipient_email))
    )
  );

-- Partner: update status (e.g. viewed) on their rows
CREATE POLICY "Partners update own inbox rows"
  ON public.partner_rfp_inbox FOR UPDATE TO authenticated
  USING (
    partner_id = auth.uid()
    OR (
      recipient_email IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.profiles pr
        WHERE pr.id = auth.uid()
          AND lower(trim(pr.email)) = lower(trim(partner_rfp_inbox.recipient_email))
      )
    )
  );
