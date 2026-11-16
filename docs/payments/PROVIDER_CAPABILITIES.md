# SasPay provider capabilities

This document describes the capabilities of the SasPay payment provider integration used by PROOFSTACK. It reflects the OpenAPI-based specification available at the repository and the implemented adapters (SasPay native and Sandbox).

1. Provider identity
- Provider: saspay
- Display name: SasPay (live) / SasPay (test) depending on API key used
- API version: 1.0.0 (live) / 1.0.0 (sandbox as applicable)

2. Core capabilities
- automatedRecurring: false
- hostedCheckout: true
- pushToPhone: true
- card: true
- refunds: false
- payouts: true
- webhooks: true
- webhookSignatureScheme: saspay-hmac-sha256-v1
- currencies: XOF, XAF
- countries: BJ, CG, CI, SN, TG, ML, NE, CM, GA, CF
- networks: [] (empty in live, may include networks in test environments)
- rateLimitPerMinute: 300
- apiVersion: 1.0.0
- notes:
  - The OpenAPI specification does not expose a refunds or recurring/subscription endpoint for SasPay.
  - Payouts require server IP whitelisting in the production environment.
  - Some network data and pricing endpoints require authentication to be accessed; public listings may be empty without credentials.

3. Supported flows
- Checkout (hosted): POST /checkout-sessions/ followed by GET /checkout-sessions/{id}/status/
- Softpay (push-to-phone): POST /payments/softpay/
- Verification: GET /payments/{payment_id}/verify/
- Webhooks: enabled; signature verification uses the provider-specified HMAC scheme and a timestamp window of 300 seconds.

4. Security and validation notes
- All monetary amounts are provided as strings with decimal representation (e.g. "2500.00").
- Idempotency keys should be used for operations that move money (e.g. POST /payments/softpay/, POST /payouts/initialize/, POST /wallet-transfers/, POST /payments/{payment_id}/retry/).
- Webhook verification must validate timestamp freshness and signature against the raw request body and the signing secret.

5. Operational considerations
- No refunds endpoint is exposed; refunds are not supported by the provider endpoints and should be handled via administrative processes if needed.
- Recurring billing is not supported by the provider and is implemented at the application layer through prepaid periods and manual renewals.
- For production deployments, replace the sandbox API key with a live key and switch base URLs accordingly.

This document is intended to stay synchronized with the actual implementation in the repository. If the provider capabilities change, update this document accordingly.
