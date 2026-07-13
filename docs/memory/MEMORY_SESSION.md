# MEMORY_SESSION.md — Estado da tarefa atual

Atualizado continuamente pelo agente durante a sessão. Compactado/persistido em handoff e Stop hook.

## Schema obrigatório

```markdown
## Sessão: [YYYY-MM-DD HH:MM] — [objetivo em uma linha]
Issue: #N
Branch: [nome]
PR: #N (ou "não aberta")
Estado: em_progresso | bloqueado | concluído
  → em_progresso: agente está trabalhando, pode retomar imediatamente
  → bloqueado: aguarda aprovação ou decisão — campo Bloqueios deve estar preenchido
  → concluído: tarefa encerrada — PR aberta ou trabalho entregue
  (transição para "concluído" só após PR aberta ou resultado validado)
Modelo: fast | medium | strong | humano
Arquivos alterados: [lista]
Comandos executados: [lista crítica]
Validação: [resultado ou "não rodou — motivo"]
Bloqueios: [lista com dono e ação esperada | "nenhum"]
Próxima ação: [exata — o que fazer ao retomar]
Project status:
  - Projeto: [nome]
  - Status: [Backlog | Investigando | Em desenvolvimento | PR aberta | Em review | Ajustes | Aprovada | Mergeada | Bloqueada]
  - Tipo: [Bug | Feature | Infra | Docs | Refactor | Segurança]
  - Prioridade: [P0 | P1 | P2 | P3]
  - Risco: [Baixo | Médio | Alto]
  - Ambiente: [Local | Dev | Staging | Produção]
  - Próxima ação: [acionável]
```

## Sessão atual

<!-- Substituir abaixo a cada nova sessão. Sessões anteriores vão para PROGRESS.md. -->

## Sessão: 2026-07-13 18:29 — consolidar JWT fail-closed e ativar RBAC global
Issue: #3 (dependências #2 e #8)
Branch: feat/3-platform-rbac
PR: não aberta
Estado: em_progresso
Modelo: strong + human
Arquivos alterados: auth/config/repository/routes/types; migration 012; CI; testes JWT/RBAC/migrations; README/STATUS/memória/audit/runbook; closure exato do deploy-gate
Comandos executados: consolidação dos commits da PR #6 sobre #11; pnpm install/lint; migrate:local duas vezes; Vitest PostgreSQL/JWKS; revisão cross-repo
Validação: gate verde; lint/build/package/audit/Harness verdes; 55/55 testes reais, zero skips; bootstrap one-shot, RBAC persistido, lockout protegido inclusive por trigger direto e em corrida, route matrix e 403 sem escrita verdes; migration 008 segue excluída do runner Local/CI
Bloqueios: re-review crítico final do fix de lockout; CI remoto
Próxima ação: obter GREEN final e abrir Draft PR empilhada na #11, sem merge/deploy
Project status:
  - Projeto: Infra
  - Status: Em desenvolvimento
  - Tipo: Segurança
  - Prioridade: P0
  - Risco: Alto
  - Ambiente: Local
  - Próxima ação: review e Draft PR; não executar release
