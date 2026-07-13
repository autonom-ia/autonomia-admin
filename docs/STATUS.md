# STATUS — Autonom.ia Admin

Atualizado em 2026-07-13. Este snapshot separa evidência do repositório de
controles produtivos ainda não certificados.

## Indicadores

| Indicador | Status | Última verificação |
|-----------|:------:|--------------------|
| Build | verde local; package stage ci verde | 2026-07-13 |
| Testes | 66/66, zero skips, com PostgreSQL/JWKS reais e matriz de duas organizações | 2026-07-13 |
| CI | RBAC na Draft PR #12 verde; escopo organizacional local verde, CI remoto pendente | 2026-07-13 |
| Deploy produção | workflow hard-disabled; review final P0-P3=0 | 2026-07-13 |
| Harness instalado | 2.1.2 local nesta branch | 2026-07-13 |
| Harness drift | base 2.1.2 + overrides restritivos e secret-scan estrito | 2026-07-13 |

## Estado atual

Esta branch implementa a Issue #4 sobre a Draft PR #12: diretório de usuários
tenant-scoped por `X-Organization-Id`, membership admin/member e respostas não
enumeráveis. A `main` continua sem essas mudanças; nenhum deploy, RDS, secret
ou dado de cliente foi tocado.

## Última mudança relevante

- Rotas de usuários não chamam mais mutações globais: invite/activate/
  deactivate/delete operam somente a membership selecionada e revalidam o ator
  dentro da transação.

## O que está funcionando

- A baseline da Draft PR #10 tem CI e Harness verdes.
- O repositório contém build, testes Vitest e empacotamento Serverless.

## O que está quebrado / em degradação

- A `main` continua em Harness 2.0.2 até as PRs empilhadas serem aprovadas.
- Push em `main` ainda dispara migration e deploy; a correção da Issue #8 está
  somente na Draft PR #11 e no hardening local aprovado, ainda sem merge.
- Outbox/reconciliação do cadastro corporativo AppSell continua na Issue #7.

## Bloqueios

- Gate produtivo da Issue #8 antes de qualquer merge na `main`.
- Prova de banco Admin dedicado antes de migrations produtivas do AppSell.

## Próxima ação

Abrir Draft PR da Issue #4 empilhada na #12 e validar CI remoto, sem
merge/deploy. O review adversarial final está GREEN, P0=P1=P2=P3=0. A Issue #8 permanece aberta para
release por SHA, Environment, migration, smoke e rollback.

Validação local: gate antes do install com 31 fixtures físicas; allowlists
exatas de workflows, package/lock, Serverless, hooks/settings, `scripts/**`,
actions, configs pnpm/npm, executáveis/symlinks, runners e stages `ci/prod`.
O quarto review encontrou `P1=1/P2=1`: a identidade conectada não restringia o
endereço/porta reais nem provava marker persistente no database, e o IPv6 aceito
pelo parser falhava no `pg`. A correção limita a ferramenta ao servidor real
`127.0.0.1:5432`, exige UUID local e dois settings de database com `setrole=0`,
e recusa localhost/IPv6/Docker. Os 25 testes do guard e a validação completa
estão verdes. O quinto review encontrou `P2=1`: o handler Lambda de migration
não estava no closure de hashes e aceitava adulteração destrutiva; agora ele é
ancorado por SHA-256 e coberto por fixture negativa. O sexto review encontrou
`P1=1/P2=2/P3=1`: risco de testes contra RDS, closure incompleto, actions móveis
e docs contraditórias. Testes agora exigem o DB local atestado; fontes, testes e
configs são fixados por SHA, actions por commit, e a evidência foi alinhada.

O teste PostgreSQL real também encontrou `008_rename_job_autonomia_product_key`
alterando `financial.catalog_items`. O runner local agora a exclui; execução em
release Admin continua bloqueada até substituição aditiva no Financial.

Após a exclusão, o runner completou duas vezes no database novo
`autonomia_admin_local`; 9 migrations Admin-only, 10 tabelas e 28/28 testes
reais ficaram verdes. Gate/31 fixtures, lint, build, package ci, YAML e Harness
também passaram. O review final independente do hash `36427dab…` ficou GREEN,
com `P0=P1=P2=P3=0`.

Aliases npm genéricos de migration foram removidos. `migrate:local` exige banco
local dedicado em `127.0.0.1:5432`, UUID e settings persistentes no database;
aliases, IPv6, Docker, túnel e RDS compartilhado são recusados. O handler Lambda
permanece como sink manual sem invocação nos entrypoints permitidos, mas seu
conteúdo agora é fixado pelo gate. O checker não
autoatesta sua própria edição: o hash do patch e o review crítico são o trust
anchor desta fase.

O Doctor reporta integridade estrutural (0 erros/0 warnings); ele não compara o
conteúdo das regras. As três regras locais de ambiente, Git e aprovação
produtiva foram preservadas como overrides intencionais porque são mais
restritivas. O workflow integra a correção 2.1.2 que não derruba CI quando o
health report não existe, mas preserva o secret-scan estrito 2.0.2: nenhuma
linha detectada é descartada por conter texto de placeholder. Isso permanece
como override até a correção upstream da Issue agent-harness#14.

## Links

- Project: https://github.com/users/autonom-ia/projects/3
- Issues: https://github.com/autonom-ia/autonomia-admin/issues
- PRs: https://github.com/autonom-ia/autonomia-admin/pulls
- Runbook: `docs/runbooks/production-deploy.md`
- Health report: `docs/harness-health/doctor-20260713-143220.md`
