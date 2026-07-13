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

## Sessão: 2026-07-13 12:33 — atualizar Harness para 2.1.2
Issue: #9
Branch: docs/update-agent-harness-v1
PR: não aberta
Estado: em_progresso
Modelo: strong + human
Arquivos alterados: manifestos, blocos marcados em AGENTS/CLAUDE, STATUS e memória
Comandos executados: diagnóstico; apply-harness-to-repo; install frozen; lint; test; build; validate-harness; doctor; diff review
Validação: primeiro review RED P1=1/P2=1/P3=1 por permissões contraditórias, workflow 2.0.2 e import duplicado; segundo/terceiro reviews encontraram bypasses no filtro upstream 2.1.2; Issue agent-harness#14 criada e filtro removido, preservando scan estrito 2.0.2; lint/build verdes; testes 3/3 ignorados sem banco; Harness estrutural 0/0; novo review pendente
Bloqueios: nenhum
Próxima ação: validar Harness, testes/build e review crítico; abrir Draft PR empilhada sobre #5
Project status:
  - Projeto: Infra
  - Status: Em desenvolvimento
  - Tipo: Infra
  - Prioridade: P1
  - Risco: Baixo
  - Ambiente: Dev
  - Próxima ação: revisar atualização do Harness 2.1.2 sem merge
