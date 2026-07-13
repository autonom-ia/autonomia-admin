# Deploy de produção — Autonom.ia Admin

## Estado atual

O workflow GitHub de produção está hard-disabled. O único job não recebe OIDC,
secrets ou Environment e termina em erro antes de qualquer integração. O stage
Serverless passou a ser obrigatório e não existe script genérico de deploy.
O package de CI só deve ser executado com `DATABASE_URL` dummy explícita. O
stage `prod` ignora essa variável e resolve exclusivamente o SSM produtivo.

Esta garantia cobre o repositório e o workflow GitHub. Ela não afirma que todo
mecanismo externo da conta AWS esteja desligado.

O gate roda antes do install. Ele fixa os três workflows, package/lock,
Serverless inteiro, hooks/settings, `scripts/**`, actions locais, configurações
do package manager, executáveis/symlinks raiz, runners Make/Task e os dois
arquivos de stage (`ci`/`prod`). Qualquer alteração exige atualização explícita
do contrato e novo review. O próprio checker depende do hash do patch revisado;
branch protection/CODEOWNERS continuam requisito da release futura.

## Por que migrations foram bloqueadas

O fluxo anterior publicava o serviço e reaplicava todas as migrations após cada
push em `main`. A lista inclui alterações e updates de dados existentes. Isso
viola a regra do AppSell: produção pode receber mudanças aditivas, mas nenhum
cliente ou projeto existente pode ser apagado, sobrescrito ou migrado sem prova.

`008_rename_job_autonomia_product_key.sql` cruza a fronteira do Admin e altera
`financial.catalog_items`. O runner local a exclui explicitamente. Ela não pode
ser executada em release do Admin; a correção deve nascer no Financial como
mudança aditiva, com contrato e review próprios.

Os aliases npm genéricos de migration foram removidos. Existe apenas
`migrate:local`, que exige Postgres local dedicado, marcador interno, porta 5432
e confirmação explícita. A identidade é persistida no database com UUID local e
validada em `pg_db_role_setting`; somente `127.0.0.1:5432` é aceito. O handler
Lambda permanece no código como sink manual para uma futura release, mas nenhum
entrypoint allowlisted o invoca. Reativação exige guard produtivo separado.

## Caminho de reativação

A fase seguinte da Issue #8 deve certificar, nesta ordem:

1. inventário read-only da AWS e do banco atual;
2. banco/schema e credenciais exclusivos do AppSell;
3. migrations classificadas como aditivas, idempotentes e backward-compatible;
4. staging isolado com o mesmo artefato do SHA aprovado;
5. Environment e branch protection com review obrigatório;
6. deploy de código e migration em jobs separados;
7. validação de `FunctionError`, payload e health smoke;
8. rollback de código sem rollback destrutivo de banco;
9. review crítico P0-P3=0 e aprovação operacional.

## Rollback desta mudança

Antes do merge, fechar a PR e remover a branch não produz efeito externo. Depois
de eventual merge autorizado, corrigir o gate por fix-forward; não restaurar o
workflow automático anterior.
