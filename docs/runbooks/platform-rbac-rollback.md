# Rollback e recovery — platform RBAC migration 012

Este runbook é um plano. Não autoriza execução em staging ou produção.

## Antes de merge/deploy

Fechar ou reverter a Draft PR é o rollback completo. A migration 012 só foi
executada no PostgreSQL local dedicado.

## Rollback de código após migration aditiva

O rollback do artefato não deve apagar a tabela `platform_role_bootstrap`, a
role, os vínculos ou a evidência. O SHA anterior pode ignorar essas estruturas
aditivas. Antes de voltar o código, desabilitar novo bootstrap removendo
`ADMIN_PLATFORM_SUPERADMIN_IDENTITY_SUB` da configuração do ambiente e manter
uma exportação verificada das linhas de RBAC.

## Recovery auditável de acesso

Se o superadmin estiver bloqueado, não apagar o singleton nem reabilitar
autorização por email. Um humano autorizado deve:

1. interromper tráfego do Admin no ambiente afetado;
2. registrar incidente, SHA, `identity_sub`, usuário e estado de role;
3. fazer backup das tabelas `admin.users`, `admin.roles`, `admin.user_roles` e
   `admin.platform_role_bootstrap`;
4. numa transação revisada, restaurar o mesmo usuário bootstrapado para
   `active`, limpar `deleted_at` e restaurar somente o vínculo da role reservada;
5. provar JWT fail-closed, `GET /admin/me`, permissões efetivas e 403 para um
   usuário comum antes de reabrir tráfego.

Transferir o superadmin para outro `sub` exige migration/runbook próprios; não
é permitido editar ou apagar o singleton como correção improvisada.

## Produção

Nenhum passo pode ser executado em produção sem aprovação explícita, backup
restaurável, janela, operador humano e rollback ensaiado. O deploy produtivo
continua hard-disabled nesta pilha.
