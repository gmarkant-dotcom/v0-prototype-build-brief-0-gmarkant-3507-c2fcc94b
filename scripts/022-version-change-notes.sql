-- Optional change notes per submitted bid version
ALTER TABLE public.partner_rfp_response_versions
  ADD COLUMN IF NOT EXISTS change_notes TEXT;
