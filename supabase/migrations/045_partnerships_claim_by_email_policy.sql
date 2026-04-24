CREATE POLICY "Partners can claim partnership by email"
ON partnerships
FOR UPDATE
USING (
  partner_id IS NULL
  AND partner_email ILIKE (
    SELECT email FROM profiles WHERE id = auth.uid()
  )
)
WITH CHECK (
  partner_id = auth.uid()
);
