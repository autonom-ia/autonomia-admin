# Autonom.ia Admin

Backend administrativo separado do Identity Foundation.

Este serviço expõe os endpoints consumidos pelo `@autonom-ia/admin-sdk`:

```text
GET  /admin/me
PATCH /admin/me
POST /admin/uploads/presigned-url
GET  /admin/profiles
GET  /admin/permissions
GET  /admin/users
GET  /admin/users/:userId
POST /admin/users/invitations
PATCH /admin/users/:userId
POST /admin/users/:userId/activate
POST /admin/users/:userId/deactivate
GET  /admin/products
POST /admin/products
PATCH /admin/products/:productKey
GET  /admin/products/:productId/customizations
POST /admin/products/:productId/customizations
PATCH /admin/products/:productId/customizations/:customizationId
GET  /admin/services
POST /admin/services
PATCH /admin/services/:serviceKey
```

## Local

```bash
pnpm install
cp .env.example .env
pnpm migrate
pnpm dev
```

URL local:

```text
http://localhost:3003
```

Para testar com o `neuroai-web`, use:

```text
NEXT_PUBLIC_ADMIN_API_URL=http://localhost:3003
```

## Autenticação

Todas as rotas `/admin/*` exigem `Authorization: Bearer <jwt>`.

Quando `JWKS_URL` estiver configurado, o token e validado via JWKS/Cognito.
Para desenvolvimento local sem JWKS, remova `JWKS_URL` do `.env`; nesse modo o token e apenas decodificado para permitir testes de frontend.

## RDS compartilhado

O Admin API usa o mesmo RDS do Identity/Auth e grava no schema `admin`.
Nao existe Postgres local nem fallback em arquivo para as rotas administrativas.

Variáveis obrigatórias:

```text
DATABASE_URL=postgres://user:password@auth-rds-host:5432/autonomia_identity
DATABASE_POOL_MAX=5
DATABASE_SSL_MODE=require
DATABASE_SSL_REJECT_UNAUTHORIZED=false
AUTH_SYNC_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/140023375763/autonomia-auth-sync
```

`AUTH_SYNC_QUEUE_URL` aponta para a fila criada pelo Identity/Auth e é obrigatório para criar ou alterar produtos.
Ao salvar um produto, a API publica `admin.product.upserted`; o consumer do Auth faz upsert em `auth.oauth_clients`.
Ao salvar uma customização de produto, a API publica `admin.product_customization.upserted`; o consumer do Auth faz upsert em `auth.oauth_client_customizations`.

## Escopo inicial

- Usuários
- Profiles
- Produtos
- Services
- Meu perfil

## Banco de dados

As migrations SQL ficam em `database/migrations`.

Migrations atuais:

```text
001_create_admin_schema.sql
002_add_profiles_and_customizations.sql
003_add_product_oauth_settings.sql
```

A migration `002` cria:

```text
admin.profiles
admin.product_customizations
```

E faz seed do profile inicial:

```text
autonomia_master
```

Todas as tabelas do schema `admin` devem seguir o padrao:

```text
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
```

Chaves naturais como `key` e associacoes N:N devem ser mantidas como `UNIQUE`, nunca como chave primaria composta.

O Identity/Auth permanece fora deste repo.

## Uploads de imagens

Logos de produtos e fotos de perfil nao devem ser enviados como base64 para a Admin API.
O fluxo correto e:

1. O frontend chama `POST /admin/uploads/presigned-url` com `fileName`, `contentType` e `folder`.
2. A API retorna uma URL pre-assinada de `PUT` para o S3 e a `publicUrl`.
3. O SDK envia o arquivo diretamente para o S3.
4. A API salva apenas a URL publica em `logoUrl` ou `photoUrl`.

Variaveis obrigatorias:

```text
AWS_REGION=us-east-1
ADMIN_ASSETS_BUCKET=<bucket-s3>
ADMIN_ASSETS_PUBLIC_BASE_URL=<url-publica-ou-cloudfront>
```
