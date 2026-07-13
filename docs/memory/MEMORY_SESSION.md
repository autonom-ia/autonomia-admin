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

## Sessão: 2026-07-13 19:18 — isolar autorização por organização
Issue: #4 (dependência #3)
Branch: feat/4-organization-scope
PR: #13 (Draft, empilhada na #12)
Estado: em_review
Modelo: strong + human
Arquivos alterados: types/fastify/repository/routes/migrate; migration 013; testes API/migration/guard; README/STATUS/memória/audit/runbook; closure exato do deploy-gate
Comandos executados: investigação read-only; pnpm install/lint; migrate:local; Vitest PostgreSQL/JWKS; deploy-gate
Validação: 66/66 testes reais, zero skips; duas organizações, selector forjado/malformado, 404 não enumerável, member sem elevação, identidade compartilhada preservada, email comercial reservado, replay 005 bloqueado, constraint exata, last-admin e revogação concorrente verdes
Bloqueios: aprovação humana das Draft PRs empilhadas #12 e #13
Próxima ação: aprovação da Draft PR #13, sem merge/deploy
Project status:
  - Projeto: Infra
  - Status: Em review
  - Tipo: Segurança
  - Prioridade: P0
  - Risco: Alto
  - Ambiente: Local
  - Próxima ação: aprovação humana da Draft PR #13; manter sem merge/deploy
