# Environment-Aware Rules

## Detectar ambiente
1. Variável `APP_ENV` ou `NODE_ENV` ou `RAILS_ENV`
2. Arquivo `.autonomia-env` na raiz do repo (conteúdo: `dev` | `staging` | `production`)
3. URL do serviço (`.onrender.com`, `.railway.app` → staging; domínio próprio → produção)
4. Nome do repo (sufixo `-prod`, `-production` → produção)
5. Default quando incerto: tratar como **produção** (fail-safe de detecção — não afrouxa o que produção permite abaixo).

## Por ambiente
- `dev / local`: editar, commitar, testar e abrir PR é permitido; merge, secrets, auth, billing, infraestrutura compartilhada e deploy continuam sujeitos a aprovação.
- `staging`: leitura e diagnóstico são permitidos; deploy, escrita em dados compartilhados, secrets, auth, billing e infraestrutura exigem aprovação.
- `production`:
  - 🟢 **Permitido sem aprovação:** leitura autorizada, inclusive `SELECT`.
  - 🔴 **Requer aprovação explícita:** qualquer escrita em banco ou dado de cliente; deploy; restart; restore; rollback; mudança de `.env`/secrets/auth/billing/infraestrutura; e operação destrutiva.
  - Fazer backup antes de qualquer operação destrutiva aprovada.
