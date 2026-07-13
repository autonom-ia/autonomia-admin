# STATUS — Autonom.ia Admin

Atualizado em 2026-07-13. Este snapshot separa evidência do repositório de
controles produtivos ainda não certificados.

## Indicadores

| Indicador | Status | Última verificação |
|-----------|:------:|--------------------|
| Build | verde local; package stage ci verde | 2026-07-13 |
| Testes | 3/3 ignorados sem banco; cobertura real pendente | 2026-07-13 |
| CI | verde na Draft PR #10 / SHA `6e54d37` | 2026-07-13 |
| Deploy produção | workflow hard-disabled nesta branch; review pendente | 2026-07-13 |
| Harness instalado | 2.1.2 local nesta branch | 2026-07-13 |
| Harness drift | base 2.1.2 + overrides restritivos e secret-scan estrito | 2026-07-13 |

## Estado atual

O serviço Admin possui Draft PRs separadas para Harness (#5/#10) e autenticação
fail-closed (#6). A `main` ainda dispara migration e deploy produtivos em push.
Esta branch da Issue #8 remove o caminho automático, sem tocar produção.

## Última mudança relevante

- Draft PR #10, commit `6e54d37`: atualização Harness 2.1.2, com CI e review
  crítico verdes, sem merge/deploy.

## O que está funcionando

- A baseline da Draft PR #10 tem CI e Harness verdes.
- O repositório contém build, testes Vitest e empacotamento Serverless.

## O que está quebrado / em degradação

- A `main` continua em Harness 2.0.2 até as PRs empilhadas serem aprovadas.
- Push em `main` ainda dispara migration e deploy; a correção da Issue #8 está
  somente nesta branch e aguarda review.
- Auth, RBAC e isolamento por organização continuam em Issues #2, #3 e #4.

## Bloqueios

- Gate produtivo da Issue #8 antes de qualquer merge na `main`.
- Prova de banco Admin dedicado antes de migrations produtivas do AppSell.

## Próxima ação

Validar o gate da Issue #8: workflow fail-closed, stage Serverless obrigatório,
sem script genérico de deploy e sem execução de migration/deploy. Depois abrir
Draft PR empilhada sobre #10 como fase parcial (`Refs #8`); a Issue permanece
aberta para release por SHA, Environment, migration, smoke e rollback.

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
- Health report: `docs/harness-health/doctor-20260713-130518.md`
