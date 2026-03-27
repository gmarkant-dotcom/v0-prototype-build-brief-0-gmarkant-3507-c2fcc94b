-- Create contact_submissions table for pricing page inquiries
CREATE TABLE IF NOT EXISTS contact_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company_type TEXT NOT NULL,
  company_size TEXT NOT NULL,
  interested_product TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create an index on created_at for sorting
CREATE INDEX IF NOT EXISTS idx_contact_submissions_created_at ON contact_submissions(created_at DESC);

-- Create an index on email for lookups
CREATE INDEX IF NOT EXISTS idx_contact_submissions_email ON contact_submissions(email);
