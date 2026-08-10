ALTER TABLE admin.products
  ADD COLUMN IF NOT EXISTS checkout_fields JSONB NOT NULL DEFAULT '{"fullName":"required","email":"required","cpf":"required","companyName":"optional"}'::jsonb,
  ADD COLUMN IF NOT EXISTS registration_fields JSONB NOT NULL DEFAULT '{"fullName":"required","email":"required","cpf":"required","companyName":"optional"}'::jsonb;
