# STATUS — Autonom.ia Admin

Atualizado em 2026-07-13. Este snapshot separa evidência do repositório de
controles produtivos ainda não certificados.

## Indicadores

| Indicador | Status | Última verificação |
|-----------|:------:|--------------------|
| Build | verde local | 2026-07-13 |
| Testes | 3/3 ignorados sem banco; cobertura real pendente | 2026-07-13 |
| CI | verde na Draft PR #5 / SHA `430a8a7` | 2026-07-10 |
| Deploy produção | automático e inseguro; Issue #8 | 2026-07-13 |
| Harness instalado | 2.1.2 local nesta branch | 2026-07-13 |
| Harness drift | base 2.1.2 + overrides restritivos e secret-scan estrito | 2026-07-13 |

## Estado atual

O serviço Admin possui Draft PRs separadas para Harness (#5) e autenticação
fail-closed (#6). A `main` ainda dispara migration e deploy produtivos em push;
por isso nenhuma destas PRs deve ser mergeada antes do gate da Issue #8.

## Última mudança relevante

- Draft PR #5, commit `430a8a7`: instalação inicial do Harness 2.0.2, com CI
  verde e sem merge/deploy.

## O que está funcionando

- A baseline da Draft PR #5 tem checks de CI e Harness verdes.
- O repositório contém build, testes Vitest e empacotamento Serverless.

## O que está quebrado / em degradação

- Harness da Draft PR #5 está em 2.0.2 — Issue #9 atualiza para 2.1.2.
- Push em `main` dispara migration e deploy de produção — Issue #8.
- Auth, RBAC e isolamento por organização continuam em Issues #2, #3 e #4.

## Bloqueios

- Gate produtivo da Issue #8 antes de qualquer merge na `main`.
- Prova de banco Admin dedicado antes de migrations produtivas do AppSell.

## Próxima ação

Validar e revisar a atualização 2.1.2 em Draft PR empilhada sobre #5. Depois,
implementar o gate da Issue #8 sem executar migration ou deploy.

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
- Runbook: não existe
- Health report: `docs/harness-health/doctor-20260713-123555.md`
