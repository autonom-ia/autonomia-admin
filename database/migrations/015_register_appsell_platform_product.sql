DO $$
BEGIN
  INSERT INTO admin.products (
    key,
    name,
    description,
    primary_color,
    accent_color,
    oauth_client_id,
    allowed_redirect_uris,
    allowed_logout_uris,
    allowed_origins,
    allow_google_login,
    allow_github_login,
    allow_email_password_login,
    allow_passkey_login,
    allow_background_auth,
    access_token_ttl_seconds,
    refresh_token_ttl_seconds,
    status,
    auth_sync_status
  ) VALUES (
    'appsell',
    'Autonom.ia Sell',
    'Plataforma multi-tenant para venda e entrega de produtos digitais.',
    '#1E3A8A',
    '#E64F18',
    'appsell-web',
    ARRAY['https://sell.autonomia.site/auth/callback']::text[],
    ARRAY['https://sell.autonomia.site/auth/login']::text[],
    ARRAY['https://sell.autonomia.site']::text[],
    false,
    false,
    true,
    false,
    false,
    3600,
    2592000,
    'inactive',
    'pending'
  )
  ON CONFLICT (key) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM admin.products
    WHERE key = 'appsell'
      AND name = 'Autonom.ia Sell'
      AND description = 'Plataforma multi-tenant para venda e entrega de produtos digitais.'
      AND logo_url IS NULL
      AND primary_color = '#1E3A8A'
      AND accent_color = '#E64F18'
      AND register_callback_url IS NULL
      AND terms_url IS NULL
      AND oauth_client_id = 'appsell-web'
      AND allowed_redirect_uris = ARRAY['https://sell.autonomia.site/auth/callback']::text[]
      AND allowed_logout_uris = ARRAY['https://sell.autonomia.site/auth/login']::text[]
      AND allowed_origins = ARRAY['https://sell.autonomia.site']::text[]
      AND allow_google_login = false
      AND allow_github_login = false
      AND allow_email_password_login = true
      AND allow_passkey_login = false
      AND allow_background_auth = false
      AND access_token_ttl_seconds = 3600
      AND refresh_token_ttl_seconds = 2592000
      AND status = 'inactive'
  ) THEN
    RAISE EXCEPTION 'Existing Autonom.ia Sell product does not match the reviewed inactive platform contract.';
  END IF;
END
$$;
