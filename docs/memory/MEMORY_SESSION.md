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

## Sessão: 2026-07-13 13:02 — bloquear deploy e migration automáticos
Issue: #8
Branch: fix/8-production-deploy-gate
PR: Draft #11
Estado: em_progresso
Modelo: strong + human
Arquivos alterados: CI, package.json, checker, runner/guard/testes de migration local, deploy/runbook, STATUS, memória, audit e health report
Comandos executados: auditoria cross-repo; gate 31 fixtures; lint; Vitest; build; package ci; stage ausente/qa; túnel/banco compartilhado; entrypoint direto; YAML; Harness/Doctor
Validação: review final independente GREEN P0=P1=P2=P3=0 no hash staged `36427dab…`; 31 fixtures, 28/28 com Postgres local, RDS/túnel bloqueado, lint/build/package/YAML/Harness verdes; migration 008 cross-project excluída do local/bloqueada para release
Bloqueios: CI remoto do novo SHA; migration 008 precisa de substituição aditiva no Financial antes de release
Próxima ação: commit/push da atualização da PR #11 e CI remoto, sem merge/deploy
Project status:
  - Projeto: Infra
  - Status: Ajustes
  - Tipo: Segurança
  - Prioridade: P0
  - Risco: Alto
  - Ambiente: Produção
  - Próxima ação: revisar deploy-gate; não executar release
