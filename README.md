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

O token é validado via JWKS/Cognito. `JWKS_URL`, `JWT_ISSUER` e `JWT_AUDIENCE` são obrigatórios;
a API falha ao iniciar se qualquer um estiver ausente.

O bearer token deve ser um access token assinado com `token_use=access`. Quando o frontend enviar
`X-Identity-Token`, ele também será validado via JWKS, deverá ter `token_use=id` e o mesmo `sub` do access token.
Tokens sem assinatura não são aceitos nem em desenvolvimento.

O login nunca cria usuário, profile ou vínculo de organização. O usuário administrativo deve existir previamente
com status `active`. No primeiro vínculo, `X-Identity-Token` é obrigatório, o email deve estar marcado como
`email_verified=true` e o `sub` é associado ao usuário previamente provisionado com o mesmo email. Depois do vínculo,
requisições somente com access token são aceitas pelo `sub`; claims `email`, `username` ou `cognito:username` do
access token não são usadas para localizar ou criar usuário.

Usuários não provisionados, `inactive`, `invited` ou removidos recebem `403`. Ativação, profile e membership devem
ser definidos pelo fluxo administrativo explícito, nunca como efeito colateral do login.

## Testes com PostgreSQL real

Os testes funcionais não possuem fallback ou `skip`. Antes de executá-los, disponibilize um PostgreSQL descartável,
aplique as migrations e então rode a suíte:

```bash
createdb autonomia_admin_test
DATABASE_URL=postgres://localhost:5432/autonomia_admin_test DATABASE_SSL_MODE=disable pnpm migrate
DATABASE_URL=postgres://localhost:5432/autonomia_admin_test DATABASE_SSL_MODE=disable pnpm test
```

O comando `pnpm test` falha se nenhum teste for executado ou se algum teste ficar pendente/skipped. A suíte recusa
executar os testes mutativos da migration 008 fora de host local e banco cujo nome termine em `_test`; ela cobre o
rename no schema Financial, colisão por operador e idempotência.

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
FINANCIAL_SYNC_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/140023375763/autonomia-financial-sync
```

Para testar localmente com o RDS privado, abra um tunel SSM em uma sessao separada:

```bash
./scripts/start_rds_tunnel.sh 5433
```

O script tenta localizar automaticamente uma instancia SSM online na mesma VPC do RDS.
Se nao houver instancia online, informe explicitamente:

```bash
BASTION_INSTANCE_ID=i-xxxxxxxxxxxxxxxxx ./scripts/start_rds_tunnel.sh 5433
```

Com o tunel aberto, o `.env` local deve apontar o `DATABASE_URL` para `localhost:5433`.

`AUTH_SYNC_QUEUE_URL` aponta para a fila criada pelo Identity/Auth e é obrigatório para criar ou alterar produtos.
Ao salvar um produto, a API publica `admin.product.upserted`; o consumer do Auth faz upsert em `auth.oauth_clients`.
Ao salvar uma customização de produto, a API publica `admin.product_customization.upserted`; o consumer do Auth faz upsert em `auth.oauth_client_customizations`.

`FINANCIAL_SYNC_QUEUE_URL` aponta para a fila do Financial.
Ao criar ou alterar produto/serviço no Admin, a API publica um evento para que o Financial mantenha `financial.catalog_items` sincronizado para a empresa `autonom-ia`.

## Escopo inicial

- Usuários
- Organizações e relacionamento usuário-organização
- Profiles
- Produtos
- Services
- Meu perfil

Backlog apos validar Agents.ai:

- Criar tela para cadastro de organizacoes e relacionamento com usuarios.
- Alinhar Financial para substituir o conceito atual de empresa por `organization`; provedores/gateways passam a representar a ligacao de `organization_id` com o gateway de pagamento.

## Banco de dados

As migrations SQL ficam em `database/migrations`.

Migrations atuais:

```text
001_create_admin_schema.sql
002_add_profiles_and_customizations.sql
003_add_product_oauth_settings.sql
004_add_product_service_display_order.sql
005_create_organizations.sql
```

A migration `002` cria:

```text
admin.profiles
admin.product_customizations
```

A migration `005` cria:

```text
admin.organizations
admin.user_organizations
```

Ela tambem cria a organizacao inicial `Autonom.ia` (`key = autonomia`) e relaciona os usuarios existentes a ela como organizacao primaria.

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
