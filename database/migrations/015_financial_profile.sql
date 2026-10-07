INSERT INTO admin.profiles (key, name, description, status)
VALUES ('financial', 'Financeiro', 'Acesso financeiro por empresas autorizadas e modo leitura ou completo.', 'active')
ON CONFLICT (key) DO NOTHING;

-- Move existing restricted users into the user management list without creating Auth identities.
DO $$ BEGIN
  -- Admin replays its migration list on every deploy. Never replay this backfill
  -- after Auth has installed the authoritative user-level grants.
  IF to_regclass('auth.administrative_user_accesses') IS NULL THEN
  IF to_regclass('auth.product_user_accesses') IS NOT NULL THEN
    INSERT INTO admin.users (identity_user_id, email, name, profile_id, status)
    SELECT u.id, u.email_normalized, COALESCE(NULLIF(u.full_name, ''), u.email), p.id,
      CASE WHEN u.status = 'active' THEN 'active' ELSE 'inactive' END
    FROM auth.users u CROSS JOIN admin.profiles p
    WHERE p.key = 'financial' AND EXISTS (
      SELECT 1 FROM auth.product_user_accesses a JOIN auth.oauth_clients c ON c.id = a.oauth_client_id
      WHERE a.user_id = u.id AND c.client_id = 'neuroai-web' AND a.metadata->>'managedModules' = 'true'
    ) AND NOT EXISTS (SELECT 1 FROM admin.users existing WHERE lower(existing.email) = u.email_normalized)
    ON CONFLICT DO NOTHING;

    UPDATE admin.users target SET profile_id = p.id, updated_at = now()
    FROM admin.profiles p, auth.users u
    WHERE p.key = 'financial' AND lower(target.email) = u.email_normalized
      AND EXISTS (SELECT 1 FROM auth.product_user_accesses a JOIN auth.oauth_clients c ON c.id = a.oauth_client_id
        WHERE a.user_id = u.id AND c.client_id = 'neuroai-web' AND a.metadata->>'managedModules' = 'true');
  END IF;
  IF to_regclass('auth.invitations') IS NOT NULL THEN
    INSERT INTO admin.users (email, name, profile_id, status)
    SELECT DISTINCT ON (i.email_normalized) i.email_normalized, COALESCE(NULLIF(i.full_name, ''), i.email), p.id, 'invited'
    FROM auth.invitations i CROSS JOIN admin.profiles p
    WHERE p.key = 'financial' AND i.status = 'pending' AND i.expires_at > now()
      AND i.metadata->>'managedModules' = 'true' AND i.metadata->>'clientId' = 'neuroai-web'
      AND NOT EXISTS (SELECT 1 FROM admin.users existing WHERE lower(existing.email) = i.email_normalized)
    ORDER BY i.email_normalized, i.created_at DESC
    ON CONFLICT DO NOTHING;
  END IF;
  END IF;
END $$;
