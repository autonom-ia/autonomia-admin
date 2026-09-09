ALTER TABLE admin.organizations
  ADD COLUMN IF NOT EXISTS billing_email TEXT;
