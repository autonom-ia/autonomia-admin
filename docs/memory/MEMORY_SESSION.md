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
PR: não aberta
Estado: em_progresso
Modelo: strong + human
Arquivos alterados: workflow de deploy/CI, serverless, package.json, teste do gate, runbook, STATUS, memória e audit
Comandos executados: auditoria do workflow/serverless/migrations; test:deploy-gate; lint; Vitest; build; package stage ci com DATABASE_URL dummy; validate-harness; doctor; YAML/diff check
Validação: primeiro review RED P1=2/P2=1 por checker bypassável, DB prod substituível por env e docs legadas; segundo RED P1=1 por denylist de sinks incompleta; contrato agora usa allowlist hash dos 3 workflows e allowlist exata de scripts, DB/stage fail-closed, 9 mutações/package ci/lint/build verdes, Vitest 3/3 ignorados; novo review pendente
Bloqueios: nenhum
Próxima ação: validar o patch exato e obter review crítico P0-P3=0 antes de commit/push/PR
Project status:
  - Projeto: Infra
  - Status: Em desenvolvimento
  - Tipo: Segurança
  - Prioridade: P0
  - Risco: Alto
  - Ambiente: Produção
  - Próxima ação: revisar deploy-gate; não executar release
