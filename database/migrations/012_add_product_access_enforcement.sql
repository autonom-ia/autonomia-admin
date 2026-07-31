ALTER TABLE admin.products
  ADD COLUMN IF NOT EXISTS enforce_product_access BOOLEAN NOT NULL DEFAULT false;
