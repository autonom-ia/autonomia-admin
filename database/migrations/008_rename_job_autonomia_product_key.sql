DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM admin.products WHERE key = 'job-autonomia')
     AND EXISTS (SELECT 1 FROM admin.products WHERE key = 'google-saas') THEN
    RAISE EXCEPTION 'Cannot rename admin product job-autonomia to google-saas because google-saas already exists.';
  END IF;

  UPDATE admin.products
  SET key = 'google-saas',
      updated_at = now()
  WHERE key = 'job-autonomia';
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM financial.catalog_items source
    JOIN financial.catalog_items target
      ON target.operator_id = source.operator_id
     AND target.key = 'google-saas'
    WHERE source.type = 'product'
      AND source.key = 'job-autonomia'
  ) THEN
    RAISE EXCEPTION 'Cannot rename financial product job-autonomia to google-saas because google-saas already exists for the same operator.';
  END IF;

  UPDATE financial.catalog_items
  SET key = 'google-saas',
      updated_at = now()
  WHERE type = 'product'
    AND key = 'job-autonomia';
END $$;
