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

# Crie um Postgres local dedicado. Não use o RDS nem o túnel SSM.
createdb -h 127.0.0.1 -p 5432 -U postgres autonomia_admin_local
export ADMIN_LOCAL_DATABASE_INSTANCE_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
psql -h 127.0.0.1 -p 5432 -U postgres -d postgres \
  -v ON_ERROR_STOP=1 \
  -c "ALTER DATABASE autonomia_admin_local SET app.environment = 'local'" \
  -c "ALTER DATABASE autonomia_admin_local SET app.local_instance_id = '$ADMIN_LOCAL_DATABASE_INSTANCE_ID'"

export APP_ENV=local
export ADMIN_LOCAL_MIGRATION_CONFIRM=autonomia_admin_local
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/autonomia_admin_local
export DATABASE_SSL_MODE=disable
export AUTH_SYNC_QUEUE_URL=
export FINANCIAL_SYNC_QUEUE_URL=
export ADMIN_ASSETS_BUCKET=
export JWKS_URL=

pnpm migrate:local
pnpm dev
```

`migrate:local` conecta primeiro e só aplica SQL depois de confirmar o host
literal `127.0.0.1`, porta `5432`, nome `autonomia_admin_local`, SSL desativado,
confirmação explícita, endereço/porta reais do servidor e os dois marcadores
persistidos especificamente no database via `pg_db_role_setting`. O UUID local
precisa coincidir com `ADMIN_LOCAL_DATABASE_INSTANCE_ID`. A ferramenta recusa
`localhost`, IPv6, Docker, qualquer variável `PG*`, parâmetros/fragmentos na
URL, túneis e o banco compartilhado. `src/migrate.ts` não é um entrypoint.

O runner local não executa `008_rename_job_autonomia_product_key.sql`, pois essa
migration altera `financial.catalog_items` de outro projeto. Ela continua
bloqueada para release e precisa ser substituída por uma mudança aditiva no
repositório Financial antes de qualquer ativação produtiva.

O `.env.example` é apenas referência e contém endpoints remotos; não o copie
para executar migrations. Migrations de staging/produção seguem exclusivamente
o runbook aprovado e não fazem parte do setup local.

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

O login apenas sincroniza nome e foto de usuários ativos. Usuários `inactive`, `invited` ou removidos não são
reativados implicitamente e recebem `403`; a ativação deve ocorrer pelo fluxo administrativo explícito.

## Testes com PostgreSQL real

Os testes funcionais não possuem fallback ou `skip`. Antes de executá-los, disponibilize um PostgreSQL descartável,
aplique as migrations e então rode a suíte:

```bash
createdb autonomia_admin_test
DATABASE_URL=postgres://localhost:5432/autonomia_admin_test DATABASE_SSL_MODE=disable pnpm migrate
DATABASE_URL=postgres://localhost:5432/autonomia_admin_test DATABASE_SSL_MODE=disable pnpm test
```

O comando `pnpm test` falha se nenhum teste for executado ou se algum teste ficar pendente/skipped.

## Banco compartilhado e testes locais

O ambiente publicado legado usa o mesmo RDS do Identity/Auth e grava no schema
`admin`. A suíte mutativa local **não pode** apontar para esse RDS, túnel, Docker,
`localhost`, IPv6 ou qualquer database compartilhado. Ela só é habilitada no
Postgres local dedicado `127.0.0.1:5432/autonomia_admin_local`, com confirmação,
UUID e markers persistentes validados antes do primeiro request.

Variáveis obrigatórias:

```text
DATABASE_URL=postgres://user:password@auth-rds-host:5432/autonomia_identity
DATABASE_POOL_MAX=5
DATABASE_SSL_MODE=require
DATABASE_SSL_REJECT_UNAUTHORIZED=false
AUTH_SYNC_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/140023375763/autonomia-auth-sync
FINANCIAL_SYNC_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/140023375763/autonomia-financial-sync
```

O script legado de túnel permanece disponível apenas para diagnóstico
operacional separadamente autorizado:

```bash
./scripts/start_rds_tunnel.sh 5433
```

O script tenta localizar automaticamente uma instancia SSM online na mesma VPC do RDS.
Se nao houver instancia online, informe explicitamente:

```bash
BASTION_INSTANCE_ID=i-xxxxxxxxxxxxxxxxx ./scripts/start_rds_tunnel.sh 5433
```

Não execute `pnpm test`, `pnpm migrate:local` nem requests funcionais mutativos
através desse túnel. Um smoke remoto futuro deverá usar comando separado,
credencial estritamente read-only e review próprio; esse smoke ainda não existe.

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
