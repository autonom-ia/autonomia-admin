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

## Sessão: 2026-07-14 11:10 — registrar Autonom.ia Sell inativa
Issue: #7 (dependências Draft #12/#13/#15)
Branch: feat/7-appsell-platform-product
PR: não aberta
Estado: em_progresso
Modelo: strong + human
Arquivos alterados: migration 015; builders Auth/Financial; testes PG/contrato; migrate/guard; README/STATUS/memória/audit/docs/runbook
Comandos executados: mapeamento cross-repo read-only; ff-only da base #15; lint; PostgreSQL 16 e Node 22 descartáveis; migrate:local; Vitest focado
Validação: migration 001-015 verde; 84/84 testes, zero skips; focused final 4/4 com igualdade integral dos envelopes; lint/build/package/audit/deploy-gate verdes; Harness 2.1.2 CORE 0 OPTIONAL 0
Bloqueios: integração externa bloqueada até outbox de produto e upstreams Draft; nenhuma aprovação para merge/deploy/migration remota
Próxima ação: suíte completa, deploy gate, Harness, reviews críticos e Draft PR empilhada na #15
Project status:
  - Projeto: Autonom.ia Dev
  - Status: Em desenvolvimento
  - Tipo: Feature
  - Prioridade: P0
  - Risco: Alto
  - Ambiente: Local
  - Próxima ação: validar e abrir Draft PR da Issue #7; manter sem merge/deploy
