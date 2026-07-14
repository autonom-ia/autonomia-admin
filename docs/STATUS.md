# STATUS — Autonom.ia Admin

Atualizado em 2026-07-14. Este snapshot descreve a branch
`feat/7-appsell-platform-product`, empilhada na Draft PR #15; não autoriza
merge, migration remota ou deploy.

## Indicadores

| Indicador | Status | Evidência |
|-----------|:------:|-----------|
| Migration 014 | verde local | aplicada duas vezes em PostgreSQL 16 dedicado |
| Testes | verde local | 84/84, zero skips |
| Lint/build | verde local | TypeScript sem erros |
| Package/deploy gate | verde local | package CI e allowlist fail-closed validados |
| CI remoto | pendente | Draft PR #16 aberta sobre a #15 |
| Deploy produção | bloqueado | workflow produtivo permanece hard-disabled |
| Harness | 2.1.2 | regras locais restritivas preservadas |
| Autonom.ia Sell | verde local | seed inativo e shape exato dos produtores; consumers upstream não executados |

## Autonom.ia Sell — Issue #7

O registro corporativo agora existe como migration aditiva e nasce `inactive`.
O nome comercial é **Autonom.ia Sell**; `appsell` permanece apenas como chave
técnica e `appsell-web` como OAuth client ID. A segunda aplicação mantém o mesmo
ID, produtos alheios permanecem intactos e qualquer contrato preexistente
divergente aborta sem `UPDATE` ou `DELETE`.

Builders puros geram os envelopes locais `admin.product.upserted` e
`admin.product.financial_catalog_upserted` sem rede, e o teste compara todo o
shape do produtor por igualdade. Uma asserção explícita proíbe seller, curso,
aula, oferta, buyer e entitlement nesses envelopes. Nenhum parser/consumer
upstream foi executado; isso permanece gate cross-repo. A
suíte final passou com 84/84 testes, zero skips, além de lint, build, package,
audit, deploy gate e Harness 2.1.2 verdes.

Nenhuma fila real, API externa, RDS, VPS, Neuro, Identity ou Financial foi
chamada. O fan-out produtivo continua bloqueado porque a outbox da PR #15 cobre
acesso, não sincronização de produto. A migration 015 está fora de
`PRODUCTION_MIGRATIONS` e um teste impede essa promoção acidental.

## Estado atual

A base herdada da Issue #14 adiciona uma outbox transacional para snapshots de
acesso Admin → Financial sobre a Draft PR #13. Nenhum RDS, SQS, Lambda, secret
ou dado de cliente foi acessado ou alterado nesta branch.

A migration 014 é aditiva e cria somente no schema `admin`:

- `financial_access_revisions`, com revisão monotônica por usuário;
- `financial_access_outbox`, com payload versionado, lease, retry e auditoria;
- revisões/outbox equivalentes para status de organizações;
- `financial_sync_reconciliations`, para fechar a janela entre migration e
  todos os writers novos estarem ativos;
- backfill idempotente sem email, nome, foto ou outro PII.

Convite, ativação/desativação, primeiro vínculo Identity, bootstrap do
superadmin, alteração genérica de usuário e soft delete enfileiram o snapshot
na mesma transação da mutação. Rollback da mutação também remove a revisão e o
evento ainda não confirmados.

O dispatcher usa `FOR UPDATE SKIP LOCKED`, lease token por claim, `eventId`
estável entre retries, backoff limitado e só marca `published` depois de
`SendMessage` bem-sucedido. Envelope e payload são comparados por constraint e
em runtime. Payload inválido permanece pendente e auditável.

## Provas locais

- rollback atômico de usuário, revisão e outbox;
- concorrência serializada em revisões 1 → 2;
- fluxo convite → ativação → vínculo Identity → soft delete em revisões 1 → 4;
- grant `financial.admin` somente por role ativa persistida;
- backfill executado duas vezes produz um único evento e nenhum PII;
- reconciliador captura estado alterado por writer antigo após o backfill;
- ativação/desativação de organização produz revisões duráveis;
- falha SQS mantém pendência; retry usa o mesmo `eventId`;
- lease expirado é recuperado; poison payload não é publicado;
- suíte completa: 80/80 testes, zero skipped.

## Dependência e bloqueios

A base consumidora é a Draft PR Financial #21, que cria a projeção em banco
Financial dedicado e ainda não faz cutover. A ordem segura continua:

1. aprovar/mergear/deployar a fundação Financial #21, incluindo ordering de
   organização rev2→rev1;
2. aprovar/mergear/deployar esta outbox Admin;
3. após todos os writers novos estarem ativos, executar a reconciliação com uma
   chave única até `usersRemaining=0` e `organizationsRemaining=0`;
4. drenar as duas outboxes, com DLQ zero e três comparações iguais;
5. só então alterar o resolver Financial para a projeção local.

Ainda faltam review crítico, gate/package, CI remoto e aprovação humana. Não há
autorização para merge, deploy, migration produtiva ou dispatcher real.

## Próxima ação

Aguardar o CI remoto e review humano da Draft PR #16, empilhada na #15, sem
merge/deploy. A sincronização externa continua bloqueada até existir outbox de
produto por destino com retry, reconciliação e read-back.

## Links

- Issue atual: https://github.com/autonom-ia/autonomia-admin/issues/7
- Base direta: https://github.com/autonom-ia/autonomia-admin/pull/15
- Issue herdada da outbox de acesso: https://github.com/autonom-ia/autonomia-admin/issues/14
- Base herdada de organization scope: https://github.com/autonom-ia/autonomia-admin/pull/13
- Financial projection: https://github.com/autonom-ia/autonomia-financial/pull/21
- Project: https://github.com/users/autonom-ia/projects/3
- Runbook: `docs/runbooks/financial-access-outbox.md`
- Produto Autonom.ia Sell: `docs/products/autonomia-sell.md`
