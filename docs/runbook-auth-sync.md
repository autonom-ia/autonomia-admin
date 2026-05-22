# Runbook Auth Sync

## Sintomas

- Produto criado no Studio não aparece no Auth.
- Login retorna `OAuth client is not active or does not exist`.
- Customização visual não aparece no login central.

## Verificações

1. Confirmar `AUTH_SYNC_QUEUE_URL` no ambiente do Admin.
2. Conferir logs da Admin API ao salvar produto/customização.
3. Conferir logs da Lambda `auth-sync-consumer`.
4. Consultar a DLQ `autonomia-auth-sync-dlq`.
5. Validar dados em `auth.oauth_clients` e `auth.oauth_client_customizations`.

## Reprocessamento

Para reprocessar, publique novamente o evento ao salvar o produto/customização pelo Studio. Se o evento estiver na DLQ, mova a mensagem para a fila principal somente após corrigir a causa.

## Rollback

Rollback seguro:

- Reverter a versão do Admin API.
- Reverter a versão do Auth API consumer.
- Manter migrations aplicadas; as tabelas novas são compatíveis e não bloqueiam o fluxo antigo.

