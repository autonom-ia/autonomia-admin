# Git Rules

- Verificar `git status` antes de qualquer edição.
- Trabalhar em branch de feature/infra/docs — nunca direto em `main`/`master` de repo com **auto-deploy**.
- Branches: `feature/<slug>`, `infra/<slug>`, `docs/<slug>`.
- Commits atômicos: uma mudança lógica por commit. Mensagem: `<type>(<scope>): <descrição em imperativo>`.
- 🟢 Commit, push de branch e abertura/atualização de PR que não alterem produção não exigem aprovação.
- 🟢 `git rebase` e `git cherry-pick` locais são permitidos quando não houver perda de trabalho.
- 🔴 Exigem aprovação explícita: qualquer merge; `git push --force`; `git reset --hard` que perca commits; tag/release; e push em branch que dispare deploy.
- Nunca commitar: `.env`, secrets, credenciais, cookies, tokens.
- PRs devem linkar Issue: `Refs #N` (parcial) ou `Closes #N` (completa).
- **Sempre usar `git -C <path> ...`. Nunca `cd <path> && git ...`** — o segundo dispara warning não-silenciável de *untrusted hooks* no Claude Code e força aprovação manual. Vale também para qualquer subagente spawnado.
