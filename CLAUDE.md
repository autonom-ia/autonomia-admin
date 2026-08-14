@AGENTS.md

# CLAUDE.md

Estas instruções complementam o AGENTS.md para Claude Code.

## Claude Code

- Antes de mudanças não triviais, usar planejamento.
- Para tarefas de alto risco, propor plano e aguardar aprovação explícita.
- Não usar a mesma sessão para implementar e aprovar o próprio trabalho.
- Usar `.claude/rules/` para regras por caminho.
- Usar `.claude/agents/` para subagentes especializados.
- Usar `.claude/skills/` para skills sob demanda.
- Usar hooks para sensores, bloqueios e memória quando configurados.

## Limites

Não fazer merge, deploy, rebase, reset hard, rotação de secrets, migration de produção ou alteração de infraestrutura sem aprovação explícita do Rodrigo.
