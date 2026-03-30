-- Partner bid responses to scoped RFP inbox items.

CREATE TABLE IF NOT EXISTS public.partner_rfp_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_item_id UUID NOT NULL REFERENCES public.partner_rfp_inbox(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  proposal_text TEXT NOT NULL DEFAULT '',
  budget_proposal TEXT NOT NULL DEFAULT '',
  timeline_proposal TEXT NOT NULL DEFAULT '',
  work_example_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  proposal_document_url TEXT,
  proposal_deck_link TEXT,
  -- Denormalized for agency inbox (no cross-profile read required)
  partner_display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT partner_rfp_responses_one_per_inbox_partner UNIQUE (inbox_item_id, partner_id),
  CONSTRAINT partner_rfp_responses_max_three_urls CHECK (
    array_length(work_example_urls, 1) IS NULL OR array_length(work_example_urls, 1) <= 3
  )
);

CREATE INDEX IF NOT EXISTS idx_partner_rfp_responses_inbox ON public.partner_rfp_responses(inbox_item_id);
CREATE INDEX IF NOT EXISTS idx_partner_rfp_responses_partner ON public.partner_rfp_responses(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_rfp_responses_agency ON public.partner_rfp_responses(agency_id);
CREATE INDEX IF NOT EXISTS idx_partner_rfp_responses_status ON public.partner_rfp_responses(status);

ALTER TABLE public.partner_rfp_responses ENABLE ROW LEVEL SECURITY;

-- Partners: read own responses
CREATE POLICY "Partners select own RFP responses"
  ON public.partner_rfp_responses FOR SELECT TO authenticated
  USING (partner_id = auth.uid());

-- Partners: insert if they can access the inbox row
CREATE POLICY "Partners insert RFP responses for their inbox"
  ON public.partner_rfp_responses FOR INSERT TO authenticated
  WITH CHECK (
    partner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.partner_rfp_inbox i
      WHERE i.id = inbox_item_id
        AND i.agency_id = partner_rfp_responses.agency_id
        AND (
          i.partner_id = auth.uid()
          OR (
            i.recipient_email IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.profiles pr
              WHERE pr.id = auth.uid()
                AND lower(trim(pr.email)) = lower(trim(i.recipient_email))
            )
          )
        )
    )
  );

-- Partners: update own (draft or before agency locks — keep open for MVP)
CREATE POLICY "Partners update own RFP responses"
  ON public.partner_rfp_responses FOR UPDATE TO authenticated
  USING (partner_id = auth.uid());

-- Lead agencies: read responses on their broadcasts
CREATE POLICY "Agencies select RFP responses they own"
  ON public.partner_rfp_responses FOR SELECT TO authenticated
  USING (agency_id = auth.uid());
