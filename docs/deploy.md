# Deploy

O `autonomia-admin` é uma API Node/Fastify publicada como Lambda via Serverless Framework.

## Estratégia

- GitHub Actions valida PRs com `pnpm lint`, `pnpm test` e `pnpm build`.
- A API roda em Lambda com HTTP API Gateway.
- O workflow `deploy-prod.yml` está deliberadamente bloqueado e falha mesmo quando disparado manualmente.
- Merge ou push em `main` não executa deploy nem migration.
- Um novo caminho de release precisa ser certificado em mudança separada antes de reativar produção.

O arquivo principal é:

```text
serverless.yml
```

## Variáveis GitHub Environment `production`

```text
AWS_REGION
AWS_ROLE_TO_ASSUME
```

## Variáveis Lambda

```text
CORS_ORIGINS
DATABASE_URL
DATABASE_POOL_MAX
DATABASE_SSL_MODE
DATABASE_SSL_REJECT_UNAUTHORIZED
AUTH_SYNC_QUEUE_URL
JWT_ISSUER
JWT_AUDIENCE
JWKS_URL
AWS_REGION
ADMIN_ASSETS_BUCKET
ADMIN_ASSETS_PUBLIC_BASE_URL
ADMIN_UPLOAD_URL_EXPIRES_SECONDS
```

## Migrations

As migrations rodam pela função:

```text
autonomia-admin-prod-migrate
```

Como o RDS é privado, a migration roda dentro da VPC pela própria Lambda, não no runner do GitHub.

Enquanto o gate fail-closed estiver ativo, o workflow GitHub não invoca essa função.
