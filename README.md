# Autonom.ia Admin

Backend administrativo separado do Identity Foundation.

O produto comercial é **Autonom.ia Sell**. A chave `appsell` é somente um
identificador técnico estável. O contrato corporativo inativo e seu runbook
estão em `docs/products/autonomia-sell.md` e
`docs/runbooks/autonomia-sell-product-registration.md`.

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

O login comum nunca cria usuário, profile, role ou vínculo de organização. O usuário administrativo deve existir previamente
com status `active`. No primeiro vínculo, `X-Identity-Token` é obrigatório, o email deve estar marcado como
`email_verified=true` e o `sub` é associado ao usuário previamente provisionado com o mesmo email. Depois do vínculo,
requisições somente com access token são aceitas pelo `sub`; claims `email`, `username` ou `cognito:username` do
access token não são usadas para localizar ou criar usuário.

Usuários não provisionados, `inactive`, `invited` ou removidos recebem `403`. Ativação, profile e membership devem
ser definidos pelo fluxo administrativo explícito, nunca como efeito colateral do login.

### RBAC e bootstrap do superadmin

As permissões globais vêm exclusivamente de `admin.user_roles → admin.roles`.
Profile legado e membership `admin` em uma organização não concedem acesso global.
Rotas de usuários, organizações, produtos, services e uploads verificam a
permissão antes de parsear o payload ou executar DB/SQS/S3.

O bootstrap one-shot de `comercial@autonomia.site` fica desabilitado enquanto
`ADMIN_PLATFORM_SUPERADMIN_IDENTITY_SUB` estiver vazio. Quando configurado, o
primeiro `GET /admin/me` exige access token e ID token assinados com o mesmo
`sub`, `email_verified=true` e o email comercial exato. A autoridade é o `sub`
configurado; o email é somente confirmação adicional. A transação cria/vincula
o usuário, atribui `platform_superadmin` e grava o singleton auditável. Repetir
o mesmo handshake é idempotente; outro `sub` falha sem escrita. Claims de email
posteriores não concedem nem removem a role persistida.

As rotas genéricas de usuário não podem convidar sobre, alterar o email/status,
desativar ou excluir a conta registrada no singleton de bootstrap; retornam
`409` para evitar lockout total. Uma troca futura de superadmin exige fluxo
administrativo dedicado, break-glass auditável e review próprio.

Rotas protegidas usam autenticação read-only. Primeiro vínculo por email para
um usuário administrativo comum só é permitido em `GET /admin/me`; uma request
negada em outra rota não atualiza nome, `identity_user_id`, produto ou fila.

### Isolamento por organização

As rotas `/admin/users/**` são tenant-scoped. O selector explícito é o header
`X-Organization-Id` com UUID da organização. Sem header, o backend usa a
membership primária ativa ou, se existir somente uma membership ativa, essa
única organização. Selector malformado, organização inativa, membership
inativa, organização estrangeira ou contexto ambíguo retornam o mesmo `403`.

Somente membership `admin` ativa pode ler ou alterar o diretório tenant.
Membership `member` não ganha permissões globais e não pode elevar a si mesma.
O superadmin da plataforma pode operar uma organização ativa com selector
explícito, mas continua precisando das permissões globais persistidas.

Convites criam ou reutilizam a identidade global sem sobrescrever email, nome,
profile, status ou vínculo de Identity já existentes. A nova membership começa
inativa e preserva o role existente em retries; activate/deactivate/delete
alteram apenas a membership selecionada. Email/nome/foto próprios continuam em
`PATCH /admin/me`. Produtos OAuth corporativos, services, customizações e
uploads permanecem globais e superadmin-only.

## Testes com PostgreSQL real

Os testes funcionais não possuem fallback ou `skip`. Use o mesmo PostgreSQL
local dedicado e atestado da seção Local:

```bash
pnpm migrate:local
pnpm test
```

O comando `pnpm test` falha se nenhum teste for executado ou se algum teste
ficar pendente/skipped. A suíte reutiliza o guard local antes dos testes
mutativos, cobre a migration 008 somente sobre fixture Financial descartável e
prova JWT/JWKS, RBAC, bootstrap, idempotência e ausência de side effect no `403`.

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

Mutações de acesso usam caminho diferente: convite, ativação/desativação,
primeiro vínculo Identity, bootstrap, mudança genérica de status e soft delete
gravam `admin.financial_access.snapshot` na outbox dentro do mesmo commit. O
dispatcher mantém o `eventId` entre retries e só marca o evento como publicado
após confirmação do SQS. O payload não inclui email, nome ou foto.

Status de organização usa a mesma garantia em outbox própria e revisão
monotônica. Após migration e deploy de todos os writers, o handler manual
`financialAccessReconcile` deve ser repetido com a mesma chave de release até
zerar usuários e organizações restantes; isso fecha mutações feitas por código
antigo durante a janela de release.

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
007_add_product_background_auth.sql
009_add_product_registration_urls.sql
010_configure_neuroai_registration_callback.sql
011_add_user_soft_delete.sql
012_add_platform_superadmin_rbac.sql
013_add_organization_scope.sql
014_add_financial_access_outbox.sql
015_register_appsell_platform_product.sql  # somente LOCAL_ADMIN_MIGRATIONS
```

A migration 015 registra a Autonom.ia Sell inativa apenas no runner Local/CI.
Ela está deliberadamente ausente de `PRODUCTION_MIGRATIONS` e sua promoção
exige PR e aprovação próprias depois da outbox de sincronização de produto.

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
