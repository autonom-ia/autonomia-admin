ALTER TABLE admin.products
  ADD COLUMN IF NOT EXISTS allow_background_auth BOOLEAN NOT NULL DEFAULT false;
