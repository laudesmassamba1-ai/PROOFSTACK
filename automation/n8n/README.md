# n8n — payment automation

n8n receives **verified** PROOFSTACK payment webhook outcomes. It is an observer, not
a payment authority: the API commits the subscription first, and n8n only receives the
result. A failed n8n call never changes a payment.

## Local start

```bash
docker compose -f automation/n8n/docker-compose.yml up -d
docker exec proofstack-n8n n8n import:workflow \
  --input=/workflows/proofstack-payments.workflow.json
docker exec proofstack-n8n n8n update:workflow \
  --id=proofstack-payments --active=true
```

Open <http://localhost:5678>. The webhook path is
`/webhook/proofstack-payments`.

## Connect the API

Set both variables on the API runtime:

```bash
N8N_WEBHOOK_URL=https://<public-n8n-host>/webhook/proofstack-payments
N8N_WEBHOOK_SECRET=<same-secret-as-PROOFSTACK_WEBHOOK_SECRET>
```

`N8N_WEBHOOK_SECRET` signs `timestamp.body` as
`x-proofstack-signature: sha256=<hex>`. The workflow rejects stale timestamps
(>300 seconds), bad signatures and events other than `payment.webhook.processed`.

A Worker cannot reach `localhost`. For a Cloudflare-hosted API, expose n8n through a
stable HTTPS hostname or Cloudflare Tunnel and use that public URL. Without
`N8N_WEBHOOK_URL`, the API ignores n8n and payments continue normally.

## Add notification nodes

Extend the workflow after **Verify signature** with the channels you actually have
(Slack, Telegram, email or an internal HTTP endpoint). Do not move payment verification
or entitlement changes into n8n.
