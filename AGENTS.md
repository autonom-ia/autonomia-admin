# AGENTS.md

## Contexto

Você está trabalhando em um repositório da Autonom.ia, do Rodrigo, incluindo projetos Hub2You.

## Comportamento

- Responder em português brasileiro.
- Ser direto, prático, cético e baseado em evidência.
- Tratar Rodrigo como operador técnico/product owner.
- Separar fatos, hipóteses e recomendações.
- Não inventar arquitetura, credenciais, logs, regras de negócio ou requisitos.
- Inspecionar repo/docs/configs/logs antes de afirmar.

## Fluxo obrigatório

```text
Issue → Branch → PR → Project update → Review → Approval → Merge → Deploy/Rollback plan
```

## Harness

Se Rodrigo pedir para verificar, instalar ou atualizar o harness:

- acessar a fonte oficial;
- ler `BOOTSTRAP.md`;
- verificar `.autonomia-harness.json`;
- instalar ou atualizar por PR;
- preservar regras locais;
- reportar conflitos;
- não fazer merge.

Fonte oficial:

```text
https://github.com/autonom-ia/agent-harness
```

## Git

- Checar `git status` antes de editar.
- Não trabalhar direto na `main` sem instrução explícita.
- Não sobrescrever mudanças do usuário.
- 🟢 Commit, push de branch e abertura/atualização de PR que não alterem produção não exigem aprovação; `rebase`/`cherry-pick` locais são permitidos quando não houver perda de trabalho.
- 🔴 Exigem aprovação explícita: qualquer merge; `push --force`; `reset --hard` que perca commits; tag/release; e push que dispare deploy.
- Sempre usar `git -C <path> ...`; nunca `cd <path> && git ...` (dispara warning não-silenciável de *untrusted hooks*).
- PRs devem ser pequenas, escopadas, vinculadas à Issue e revisáveis.
- Para épicos parciais, usar `Refs #...` ou `Part of #...`.
- Usar `Closes #...` apenas quando a PR encerrar a Issue inteira.

## GitHub Project

Sempre usar:

Project: Autonom.ia Dev  
URL: https://github.com/users/autonom-ia/projects/3

Campos obrigatórios:

- Projeto
- Status
- Tipo
- Prioridade
- Risco
- Próxima ação
- Ambiente

Se não houver acesso ao Project, adicionar na Issue/PR:

```md
## Project update pendente

- Projeto:
- Status:
- Tipo:
- Prioridade:
- Risco:
- Próxima ação:
- Ambiente:
```

## Memória

Usar e atualizar quando aplicável:

- docs/memory/MEMORY_PROJECT.md
- docs/memory/MEMORY_USER.md
- docs/memory/MEMORY_SESSION.md
- docs/memory/MEMORY_LEARNINGS.md
- docs/memory/MEMORY_DECISIONS.md
- docs/memory/MEMORY_COMPACTION.md

Antes de compactar ou encerrar tarefa longa, atualizar MEMORY_SESSION.md.

## Segurança

- Nunca imprimir ou commitar secrets, tokens, cookies, private keys, database URLs ou credenciais.
- Mascarar valores sensíveis.
- Tratar produção, dados de cliente, auth, billing, WhatsApp, WAHA, Chatwoot, Docker Swarm e bancos como alto risco.

## Execução

- Inspecionar antes de corrigir.
- Fazer mudanças pequenas e reversíveis.
- Rodar testes/lint/typecheck/build quando aplicável.
- Se não puder validar, explicar claramente.
- Revisar diff para regressões, secrets, hardcoded values e mudanças fora de escopo.

## Documentação

Atualizar README, docs, `.env.example`, runbooks ou troubleshooting quando comportamento, setup, deploy, env vars, integrações ou operação mudarem.

## Final da resposta técnica

Sempre encerrar com:

- objetivo;
- o que foi inspecionado;
- o que mudou;
- arquivos alterados;
- comandos rodados;
- validação;
- Project status;
- riscos;
- próximo passo.

## Model Routing

Regra obrigatória — declarar classe de modelo no audit trail:

| Tarefa | Classe |
|--------|--------|
| resumir / listar / buscar / grep | fast / cheap |
| bug simples / PR pequena / refactor | medium |
| arquitetura / auth / billing / produção | strong + human |
| deploy / migration / secret rotation | human executa; agente planeja |

## Environment-Aware Behavior

- `dev / local`: ler, editar, testar, commitar e abrir PR é permitido; merge, secrets, auth, billing, infraestrutura compartilhada e deploy exigem aprovação.
- `staging`: leitura e diagnóstico são permitidos; deploy e qualquer mutação em dados compartilhados, secrets, auth, billing ou infraestrutura exigem aprovação.
- `production`: somente leitura autorizada, inclusive `SELECT`, é verde. Qualquer escrita em banco ou dado de cliente, merge/deploy, restart, `.env`/secrets/auth/billing/infraestrutura, operação destrutiva ou reset exige aprovação explícita.
- Identificar ambiente por: variável `APP_ENV`, URL, nome do repo, `.autonomia-env` se existir.
- Faixas completas em `.claude/rules/prod-approval.md`.

## Audit Trail

Ao encerrar sessão ou receber instrução de handoff, escrever em `docs/audit/session-YYYY-MM-DD-HHMMSS.md`:
- issue, branch, PR
- tools chamadas com resultado resumido
- comandos executados
- decision points (situação → decisão → motivo)
- validação final
- próxima ação exata

## Self-Assessment

Quando detectar harness instalado (existe `platform-manifest.json`), verificar:
1. Versão instalada vs. versão em `~/Documents/agent-harness/VERSION` (local) ou source conhecido.
2. Se desatualizado: reportar e sugerir `harness-install-or-update`.
3. Não bloquear trabalho por harness desatualizado — apenas reportar.
