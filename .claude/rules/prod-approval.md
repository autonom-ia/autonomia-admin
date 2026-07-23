# Gates de Aprovação — Política Conservadora

O agente executa trabalho local, reversível e não destrutivo. Merge, produção, escrita em banco de produção, secrets, auth, billing, infraestrutura e deploy permanecem bloqueados até aprovação explícita do Rodrigo.

## 🟢 Verde — executar e reportar

- Ler/analisar arquivos, código, logs, schemas e bancos autorizados.
- Rodar testes, lint, build, type-check e diagnóstico local.
- Editar em branch de trabalho; criar docs, planos, scripts, patches e diffs.
- Criar commit, push de branch e PR que não alterem produção.
- Fazer `rebase` e `cherry-pick` locais quando não houver perda de trabalho.
- Fazer schema changes e restart somente em ambiente local/dev, sem infraestrutura compartilhada.

## 🟡 Amarela — preparar sem executar

- Produzir diff, comando exato, risco e rollback para uma ação sujeita a aprovação.
- Seguir em tarefas verdes enquanto a aprovação está pendente.

## 🔴 Vermelha — parar e esperar aprovação explícita

- **Merge:** qualquer merge de PR ou branch.
- **Produção:** qualquer mutação, restart, restore, rollback ou efeito para cliente/mercado.
- **Banco de produção:** `INSERT`, `UPDATE`, `DELETE`, migration, schema ou qualquer outra escrita. `SELECT` autorizado permanece leitura.
- **Secrets e auth:** criar, ler valor sensível, alterar, rotacionar ou publicar credenciais, tokens, `.env`, OAuth, permissões ou autenticação.
- **Billing e dinheiro:** alterar cobrança, plano, orçamento, pagamento, contrato ou operação financeira real.
- **Infraestrutura:** DNS, TLS, proxy, rede, host, container/orquestrador, volume, bucket ou serviço compartilhado.
- **Deploy:** qualquer deploy, inclusive staging e produção, publicação de release/tag ou ativação/desativação de workflow operacional.
- **Destruir/resetar:** `rm -rf` amplo, `DROP`, `TRUNCATE`, `ALTER ... DROP`, `git push --force`, `git reset --hard` com perda, apagar dados/volumes/buckets ou ação irreversível.
- **Dados e contato reais:** mutar dados de cliente ou enviar WhatsApp/e-mail/SMS real.

Forma de pedir aprovação: **o quê, onde, por quê, risco, comando exato e plano de rollback.**

Guarda-corpos catastróficos (`rm -rf /`, `rm -rf /*`, `DROP DATABASE`, `destroyService`) são bloqueados pelo hook em qualquer modo.
