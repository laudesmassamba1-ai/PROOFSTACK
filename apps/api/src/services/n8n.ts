export async function triggerN8nWorkflowFromWebhook(event: string, payload: any): Promise<void> {
  // Basic, environment-driven integration with n8n via webhook
  const base = (process.env.N8N_BASE_URL ?? process.env.N8N_BASE ?? "").replace(/\/+$/, "");
  const webhookName = process.env.N8N_WEBHOOK_NAME ?? "";
  const apiKey = process.env.N8N_API_KEY ?? "";
  if (!base || !webhookName) {
    return;
  }
  const url = `${base}/webhook/${webhookName}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  try {
    await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ event, payload }),
    });
  } catch (err) {
    // Best effort: log but do not fail webhook processing
    // eslint-disable-next-line no-console
    console.error('[n8n] webhook trigger failed', err);
  }
}
