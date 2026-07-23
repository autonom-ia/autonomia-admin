# Security Rules

- Nunca imprimir secrets, tokens, cookies, private keys ou database URLs.
- Não commitar `.env`.
- Mascarar valores sensíveis em logs.
- Merge, escrita em banco de produção, secrets, auth, billing, infraestrutura e deploy exigem aprovação explícita do Rodrigo.
- Validar autenticação, autorização e tenant isolation.
- Webhooks devem validar assinatura, idempotência e retry behavior.
- Não enfraquecer RLS, auth, billing ou audit logs sem aprovação explícita.
