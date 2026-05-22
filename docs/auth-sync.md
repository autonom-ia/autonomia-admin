# Auth Sync

`auth_sync` desacopla o Admin do Auth. O Admin não escreve diretamente no schema `auth` durante uma requisição HTTP.

## Eventos publicados

Ao criar ou alterar produto:

```text
admin.product.upserted
```

Ao criar ou alterar customização de produto:

```text
admin.product_customization.upserted
```

## Infra esperada

A fila é criada no Identity Foundation via CDK:

- SQS `autonomia-auth-sync`
- DLQ `autonomia-auth-sync-dlq`
- Lambda consumer no Auth API

O Admin recebe a URL em:

```text
AUTH_SYNC_QUEUE_URL
```

## Projeções no Auth

O consumer do Auth atualiza:

```text
auth.oauth_clients
auth.oauth_client_customizations
```

O Auth continua lendo somente o schema `auth` no login.

## Falhas

Falha de publicação no Admin deve falhar a operação de produto/customização. Falha no consumer fica sob retry da SQS e, após o limite, segue para DLQ.

