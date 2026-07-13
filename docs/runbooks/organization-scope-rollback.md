# Rollback — escopo organizacional do Admin

## Regra operacional

Nenhum passo deste runbook autoriza produção. Release, rollback de aplicação ou
qualquer acesso ao banco produtivo exigem aprovação humana explícita e evidência
de ambiente. A migration 013 é aditiva: constraint de role e índice de consulta;
ela não remove, converte ou reassocia memberships.

## Evidência antes de release

Registrar, sem dados pessoais:

```sql
SELECT organization_id, role, status, count(*)
FROM admin.user_organizations
GROUP BY organization_id, role, status
ORDER BY organization_id, role, status;
```

Falhar antes da migration se existir role fora de `admin|member`. Não corrigir
dados automaticamente.

## Rollback seguro

1. Interromper novas mutações tenant no tráfego da versão afetada.
2. Reverter somente o código da aplicação para o SHA anterior aprovado.
3. Manter `ck_admin_user_organizations_role` e
   `idx_admin_user_organizations_scope`; ambos são compatíveis com o código
   anterior e preservam evidência.
4. Repetir a consulta de contagem e comparar com o snapshot pré-release.
5. Fazer smoke read-only de `/admin/me` e das rotas globais.

Não executar `DELETE`, `TRUNCATE`, reassociação de membership, alteração em
`admin.users`, `auth.users` ou `auth.organization_users`. Remover constraint ou
índice só pode ocorrer em mudança posterior, revisada e aprovada separadamente.
