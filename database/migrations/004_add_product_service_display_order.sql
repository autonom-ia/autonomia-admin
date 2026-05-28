ALTER TABLE admin.product_services
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_admin_product_services_order
  ON admin.product_services(product_id, display_order, created_at);
