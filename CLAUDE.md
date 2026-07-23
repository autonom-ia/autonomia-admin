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

Operar pelas faixas conservadoras de `.claude/rules/prod-approval.md`.

🟢 **Sem aprovação:** leitura autorizada; edição/testes locais; commit, push de branch e PR sem efeito em produção; `rebase`/`cherry-pick` locais sem perda de trabalho.

🔴 **Requer aprovação explícita do Rodrigo:** qualquer merge ou deploy; produção; escrita em banco de produção; dados de cliente; secrets; auth; billing; infraestrutura; tag/release; `git push --force`; `git reset --hard` com perda; e operações destrutivas.
