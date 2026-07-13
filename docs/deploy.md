# Deploy

O `autonomia-admin` é uma API Node/Fastify empacotada para Lambda via Serverless
Framework. O procedimento produtivo está deliberadamente desabilitado nesta
fase da Issue #8.

## Estado do repositório

- GitHub Actions executa o gate diretamente antes do install e depois valida
  lint, testes e build.
- Push em `main` não possui caminho de deploy neste workflow corrigido.
- O workflow produtivo manual sempre falha antes de AWS, secrets ou Environment.
- Nenhuma migration é invocada por workflow.
- O stage Serverless é obrigatório.
- Somente os arquivos de stage `ci` e `prod` são aceitos.
- Stage `ci` aceita `DATABASE_URL` explícita; `prod` resolve exclusivamente
  `/autonomia/prod/admin/database-url` no SSM.

Esta descrição passa a valer somente depois de eventual merge autorizado das
PRs empilhadas. Até lá, a `main` remota continua com o comportamento legado.

## Release futura

Os requisitos restantes da Issue #8 — SHA aprovado, confirmação, kill switch,
Environment protegido, migration validada, smoke e rollback — continuam
abertos. Esta PR é uma fase parcial (`Refs #8`), não encerra a Issue.

O procedimento e os guardrails estão em:

`docs/runbooks/production-deploy.md`

## Variáveis futuras do Environment `production`

```text
AWS_REGION
AWS_ROLE_TO_ASSUME
```

Elas não são lidas pelo workflow bloqueado atual.

## Migrations

A função `autonomia-admin-prod-migrate` continua existente no stack publicado,
mas não é invocada por esta branch. Reativação exige banco AppSell isolado,
classificação aditiva das migrations e validação explícita do retorno Lambda.
Os aliases npm genéricos de migration foram removidos; `migrate:local` é
restrito ao banco dedicado `autonomia_admin_local`, com preflight no servidor e
identidade persistente no database; somente `127.0.0.1:5432` é aceito. O handler continua um sink
manual explícito e não é alcançado pelos workflows/scripts allowlisted.
