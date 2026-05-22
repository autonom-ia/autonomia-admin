# Autonom.ia Admin

Backend administrativo separado do Identity Foundation.

Este serviço expõe os endpoints consumidos pelo `@autonom-ia/admin-sdk`:

```text
GET  /admin/me
POST /admin/uploads/presigned-url
GET  /admin/users
GET  /admin/roles
GET  /admin/products
POST /admin/products
PATCH /admin/products/:productKey
GET  /admin/services
POST /admin/services
PATCH /admin/services/:serviceKey
```

## Local

```bash
pnpm install
cp .env.example .env
pnpm dev
```

URL local:

```text
http://localhost:3003
```

Para testar com o `neuroai-web`, use:

```text
VITE_API_URL=http://localhost:3003
```

## Autenticacao

Todas as rotas `/admin/*` exigem `Authorization: Bearer <jwt>`.

Quando `JWKS_URL` estiver configurado, o token e validado via JWKS/Cognito.
Para desenvolvimento local sem JWKS, remova `JWKS_URL` do `.env`; nesse modo o token e apenas decodificado para permitir testes de frontend.

## Escopo inicial

- Usuarios
- Produtos
- Services
- Perfis de acesso
- Meu perfil

## Banco de dados

As migrations SQL ficam em `database/migrations`.

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
