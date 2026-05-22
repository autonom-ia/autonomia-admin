# Deploy

O `autonomia-admin` é uma API Node/Fastify publicada como Lambda via Serverless Framework.

## Estratégia

- GitHub Actions valida PRs com `pnpm lint`, `pnpm test` e `pnpm build`.
- Push em `main` executa `serverless deploy`.
- A API roda em Lambda com HTTP API Gateway.
- Após o deploy, o workflow invoca `autonomia-admin-prod-migrate` para aplicar migrations dentro da VPC.

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
