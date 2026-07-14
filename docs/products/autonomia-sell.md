# Autonom.ia Sell — produto-plataforma corporativo

O nome comercial é **Autonom.ia Sell**. `appsell` permanece somente como chave
técnica estável de integração e `appsell-web` como OAuth client ID.

Este registro representa uma única plataforma corporativa no Admin, Identity e
Financial. Produtos, ofertas, cursos, módulos, aulas, arquivos, compradores e
demais dados dos sellers pertencem ao domínio da Autonom.ia Sell e não podem ser
copiados para este catálogo corporativo.

## Contrato inativo

| Campo | Valor |
|---|---|
| `key` | `appsell` |
| `name` | `Autonom.ia Sell` |
| `oauthClientId` | `appsell-web` |
| callback | `https://sell.autonomia.site/auth/callback` |
| logout | `https://sell.autonomia.site/auth/login` |
| origin | `https://sell.autonomia.site` |
| email/password | habilitado |
| Google, GitHub, passkey e background auth | desabilitados |
| status | `inactive` |

A migration 015 insere o contrato somente quando a chave está ausente. Se a
chave técnica já existir com qualquer divergência, ela aborta sem executar
`UPDATE` ou `DELETE`. Produtos não relacionados não são alterados.

## Ambientes

O contrato versionado usa apenas a URL pública final e permanece inativo. URLs
loopback pertencem aos fixtures de Local/CI do consumidor e nunca devem ser
adicionadas ao cliente destinado a staging ou produção.

A presença do registro não autoriza ativação, publicação em fila real, deploy
ou uso do Neuro como write path. O Neuro apenas hospeda a interface do Admin;
a autoridade de escrita continua sendo o Admin API.

A migration 015 está deliberadamente apenas em `LOCAL_ADMIN_MIGRATIONS` e é
rejeitada por teste se alguém a incluir em `PRODUCTION_MIGRATIONS` neste slice.

## Gates antes de staging

- Identity Auth deve transportar `nonce` até o Foundation;
- Foundation precisa de chaves/KMS e ambiente isolado;
- Admin precisa de outbox transacional por destino para sincronização de
  produto, retry, reconciliação e read-back;
- Financial deve estar fail-closed por JWKS e operator scope;
- os três read-backs devem concordar em `key`, client ID e status inativo;
- qualquer ativação deve ocorrer em mudança separada e aprovada.
