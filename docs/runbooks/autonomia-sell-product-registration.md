# Runbook — registro da Autonom.ia Sell

## Escopo atual

Somente Local/CI em PostgreSQL descartável. Não chamar Admin, Identity,
Financial, Neuro, AWS ou filas externas.

## Aplicação segura

1. criar um PostgreSQL 16 dedicado e atestado conforme o README;
2. executar `pnpm migrate:local`;
3. consultar `admin.products` pela chave técnica `appsell`;
4. confirmar `name = 'Autonom.ia Sell'` e `status = 'inactive'`;
5. executar a migration novamente e confirmar o mesmo ID;
6. validar os builders `admin.product.upserted` e
   `admin.product.financial_catalog_upserted` somente em teste.

## Conflito

Se a chave já existir com contrato divergente, interromper. Não corrigir por
`UPDATE`, não apagar o registro e não contornar a exceção. Produzir diff do
read-back sem PII e obter decisão humana.

## Rollback

Não existe rollback por `DELETE`. Como o registro nasce inativo, o rollback
operacional é manter `status = inactive`, bloquear dispatcher/publicação e
reverter somente o artefato de aplicação. Um registro preexistente jamais é
alterado automaticamente por esta migration.

## Rollout futuro

1. aprovar a pilha de auth/RBAC;
2. implantar outbox de produto por destino;
3. publicar para ambientes isolados;
4. reconciliar Admin, Identity e Financial até três read-backs iguais;
5. testar login/logout/refresh/revogação;
6. ativar em PR separada, com aprovação explícita e rollback comprovado.
