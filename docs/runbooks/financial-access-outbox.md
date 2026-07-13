# Runbook — outbox de acesso Admin → Financial

Este documento é um plano operacional. Não autoriza merge, migration, deploy,
acesso a produção ou replay de SQS.

## Pré-condições obrigatórias

1. Financial PR #21 aprovada, migrada e saudável em banco dedicado.
2. Admin Issue #14 com CI, Harness e review crítico verdes no mesmo SHA.
3. Snapshot read-only das contagens abaixo, sem exportar payloads ou PII.
4. Alarme da DLQ e métrica de idade da outbox configurados.
5. Rollback de aplicação e responsável humano definidos.

```sql
SELECT status, count(*)
FROM admin.financial_access_outbox
GROUP BY status
ORDER BY status;

SELECT max(now() - created_at) AS oldest_pending
FROM admin.financial_access_outbox
WHERE status IN ('pending', 'processing');

SELECT status, count(*)
FROM admin.financial_organization_outbox
GROUP BY status
ORDER BY status;
```

## Ordem de ativação futura

1. Implantar primeiro o Financial #21 com guard revisionado de organização,
   ainda sem cutover do resolver. O consumer aceita temporariamente eventos
   legacy em voo como revisão 0; confirmar que foram drenados sem DLQ.
2. Aplicar somente a migration 014 no banco Admin aprovado.
3. Implantar o novo código em todos os writers Admin. A migration antes do
   código pode ter uma janela; ela será fechada pela reconciliação, não por
   reaplicar a migration.
4. Invocar manualmente `financialAccessReconcile` com uma chave de release
   única, por exemplo `admin-14-<sha>`, repetindo a mesma chave até retornar
   `usersRemaining=0` e `organizationsRemaining=0`.
5. Confirmar que a reconciliação gerou snapshots mais novos para todo estado
   que mudou durante a janela migration → writers.
6. Aguardar `pending=0`, `processing=0` nas duas outboxes e DLQ zero.
7. Comparar, por IDs e contagens, Admin e projeção Financial em três leituras
   consecutivas no mesmo SHA/configuração.
8. Fazer smoke com superadmin, admin, member, inativo, removido, organização
   inativa e dois tenants.
9. O cutover do resolver Financial ocorre em release separada.
10. Remover a compatibilidade legacy em PR posterior, somente após provar que
    nenhum writer antigo ou mensagem revisão 0 permanece.

## Falha e recuperação

- Falha SQS: manter o dispatcher; a linha volta para `pending` com backoff.
- Lease preso: não editar a linha; o próximo dispatcher recupera após expirar.
- Poison payload: pausar o dispatcher por rollback de código, preservar a linha
  e corrigir produtor/contrato em nova PR. Não apagar ou reescrever o evento.
- DLQ crescente ou divergência: não fazer cutover Financial.
- Evento enviado e confirmação perdida: repetir é seguro porque `eventId` e
  revisão não mudam e o consumer Financial é idempotente.
- Reorder de organização: o Financial mantém a maior revisão; confirmar a
  revisão `stale` no ledger antes de prosseguir.

## Rollback seguro

1. Reverter o código do Admin para o SHA anterior aprovado, interrompendo novos
   claims do dispatcher.
2. Manter ambas as outboxes, revisões, reconciliações e eventos da migration
   014; não executar
   `DROP`, `DELETE`, `TRUNCATE` ou redução de revisão.
3. Confirmar que mutações de usuário estão bloqueadas ou retornaram ao fluxo
   anterior conhecido durante a janela.
4. Diagnosticar e corrigir em nova PR; reativar o dispatcher somente após
   review e aprovação.

Rollback de código não revoga mensagens já publicadas. A projeção Financial
permanece sem cutover nesta fase, então não existe motivo para destruir dados.
