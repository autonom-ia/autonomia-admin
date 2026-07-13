# Admin Foundation

O `autonomia-admin` é o backend administrativo separado do Identity. Ele usa o mesmo RDS do Auth, mas grava no schema `admin`.

## Escopo atual

- Meu perfil
- Usuários
- Profiles simples
- Produtos
- Services
- Customizações de produto
- Uploads de imagem via S3
- Publicação de eventos `auth_sync`
- Outbox transacional de acesso para a projeção Financial dedicada

## Banco

As tabelas do schema `admin` usam `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.

Migrations:

```text
001_create_admin_schema.sql
002_add_profiles_and_customizations.sql
003_add_product_oauth_settings.sql
...
014_add_financial_access_outbox.sql
```

`admin.profiles` é intencionalmente simples neste ciclo. O seed obrigatório é:

```text
autonomia_master
```

A tela de usuários usa `profile_id`/`profile_key`; roles e perfis de acesso completos não fazem parte deste ciclo.

## Projeção de acesso Financial

Mutações de usuário e membership gravam um snapshot
`admin.financial_access.snapshot` na mesma transação PostgreSQL. O payload é
versionado e não contém email, nome ou foto. `admin.financial_access_revisions`
serializa versões por usuário e `admin.financial_access_outbox` preserva o
mesmo `eventId` até a confirmação do envio para SQS.

Status de organização também é publicado por outbox revisionada; não existe
mais publish-after-commit best-effort para essa mudança de acesso. O dispatcher
agenda claims com `FOR UPDATE SKIP LOCKED`, lease e retry. Ele não
é uma autorização para cutover: o Financial só pode trocar o resolver depois
que a projeção, o backfill e a reconciliação tiverem sido certificados.

## Rotas

Todas as rotas `/admin/*` exigem `Authorization: Bearer <jwt>`.

```text
GET    /admin/me
PATCH  /admin/me
POST   /admin/uploads/presigned-url
GET    /admin/profiles
GET    /admin/permissions
GET    /admin/users
GET    /admin/users/:userId
POST   /admin/users/invitations
PATCH  /admin/users/:userId
POST   /admin/users/:userId/activate
POST   /admin/users/:userId/deactivate
GET    /admin/products
POST   /admin/products
PATCH  /admin/products/:productKey
GET    /admin/products/:productId/customizations
POST   /admin/products/:productId/customizations
PATCH  /admin/products/:productId/customizations/:customizationId
GET    /admin/services
POST   /admin/services
PATCH  /admin/services/:serviceKey
```

## Uploads

Arquivos não entram como base64 no body da Admin API.

1. SDK chama `POST /admin/uploads/presigned-url`.
2. Admin API retorna `uploadUrl` e `publicUrl`.
3. SDK faz `PUT` diretamente no S3.
4. Admin API salva apenas a URL no registro.
