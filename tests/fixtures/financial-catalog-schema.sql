-- Contract fixture copied from autonomia-financial@359ce108e23ad88703d330423846f1eaf68284ff
-- database/migrations/001_create_financial_schema.sql plus the operators shape
-- added by 010_operator_organization_link.sql. Keep this DDL aligned with the
-- source schema when the Financial catalog contract changes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS financial;

CREATE TABLE IF NOT EXISTS financial.operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by_user_id text,
  updated_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_operators_organization_id
  ON financial.operators(organization_id)
  WHERE organization_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS financial.catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES financial.operators(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('product', 'service')),
  key text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id text,
  updated_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, key)
);

CREATE INDEX IF NOT EXISTS idx_financial_catalog_items_operator_type
  ON financial.catalog_items(operator_id, type);
