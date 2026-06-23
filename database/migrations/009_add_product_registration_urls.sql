ALTER TABLE admin.products
  ADD COLUMN IF NOT EXISTS register_callback_url TEXT,
  ADD COLUMN IF NOT EXISTS terms_url TEXT;
