# n8n — payment automation

n8n receives **verified** PROOFCORE payment webhook outcomes. It is an observer, not
a payment authority: the API commits the subscription first, and n8n only receives the
result. A failed n8n call never changes a payment.

## Local start

```bash
docker compose -f automation/n8n/docker-compose.yml up -d
docker exec proofcore-n8n n8n import:workflow \
  --input=/workflows/proofcore-payments.workflow.json
docker exec proofcore-n8n n8n update:workflow \
  --id=proofcore-payments --active=true
```

Open <http://localhost:5678>. The webhook path is
`/webhook/proofcore-payments`.

## Connect the API

Set both variables on the API runtime:

```bash
N8N_WEBHOOK_URL=https://<public-n8n-host>/webhook/proofcore-payments
N8N_WEBHOOK_SECRET=<same-secret-as-PROOFCORE_WEBHOOK_SECRET>
```

`N8N_WEBHOOK_SECRET` signs `timestamp.body` as
`x-proofcore-signature: sha256=<hex>`. The workflow rejects stale timestamps
(>300 seconds), bad signatures and events other than `payment.webhook.processed`.

A Worker cannot reach `localhost`. The repository includes a webhook-only facade so a
Cloudflare Quick Tunnel never exposes the n8n editor:

```bash
# 1. Start the loopback-only facade (n8n stays on 127.0.0.1:5678).
node automation/n8n/webhook-proxy.mjs

# 2. In another shell, expose only the facade.
cloudflared tunnel --url http://127.0.0.1:5681 --no-autoupdate
```

The tunnel prints a temporary `https://<name>.trycloudflare.com` URL. Use
`<url>/webhook/proofcore-payments` as `N8N_WEBHOOK_URL`. A Quick Tunnel URL changes
when the tunnel restarts; for a durable production hostname, use a named tunnel with
a domain or a hosted n8n instance. Without `N8N_WEBHOOK_URL`, the API ignores n8n and
payments continue normally.

## Slack notification

The **Notify Slack** node runs after signature verification and posts a short payment
summary. Set `SLACK_WEBHOOK_URL` on the n8n container to an Incoming Webhook URL:

````bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...```

Without it the workflow still responds `200` and reports `notification: "skipped"`;
the payment is never affected by Slack availability.

## Add notification nodes

Extend the workflow after **Verify signature** with the channels you actually have
(Slack, Telegram, email or an internal HTTP endpoint). Do not move payment verification
or entitlement changes into n8n.
````
