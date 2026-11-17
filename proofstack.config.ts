import type { ProofstackConfig } from "@proofstack/contracts";

/**
 * PROOFSTACK project configuration.
 *
 * Nothing here is a secret. Tokens are read from environment variables at run time:
 *   PROOFSTACK_PROJECT_TOKEN   cloud sync
 *   PROOFSTACK_WORLD_TOKEN     WORLD target bearer token
 *   PROOFSTACK_FLOW_TOKEN      FLOW target bearer token
 *   PROOFSTACK_WEBHOOK_SECRET  secret used to sign the webhooks FLOW sends
 */
const config: ProofstackConfig = {
  "schemaVersion": 1,
  "project": {
    "name": "PROOFSTACK",
    "baseUrl": "http://localhost:3000"
  },
  "environment": "local",
  "allowDestructiveProduction": false,
  "modules": {
    "world": {
      "enabled": true,
      "profiles": [
        "en-US",
        "fr-FR",
        "fr-BJ"
      ],
      "profileFiles": [],
      "categories": [
        "identity",
        "phone",
        "address",
        "currency",
        "datetime"
      ],
      "forms": [],
      "strictRejectionDetection": true,
      "target": {
        "kind": "none",
        "method": "POST",
        "headers": {},
        "timeoutMs": 10000,
        "errorField": "errors"
      }
    },
    "flow": {
      "enabled": true,
      "paymentMode": "simulated",
      "scenarios": [
        "checkout_success",
        "checkout_declined",
        "webhook_duplicate",
        "webhook_invalid_signature"
      ],
      "journeys": [],
      "browser": {
        "driver": "playwright",
        "headless": true,
        "viewport": {
          "width": 1440,
          "height": 900
        }
      }
    },
    "exit": {
      "enabled": true,
      "formats": [
        "json",
        "csv"
      ],
      "target": "synthetic",
      "schema": {},
      "relationships": [],
      "unique": [],
      "roundTrip": {
        "enabled": true
      },
      "maxRecords": 5000
    }
  },
  "engine": {
    "parallel": 4,
    "timeoutMs": 120000,
    "retries": 0,
    "retryOn": [
      "ERROR"
    ],
    "seed": 20260116,
    "stopOnCritical": false
  },
  "output": {
    "dir": ".proofstack/reports",
    "formats": [
      "json",
      "text"
    ],
    "junitFile": "junit.xml",
    "jsonFile": "run.json",
    "htmlFile": "run.html"
  },
  "sync": {
    "enabled": false,
    "tokenEnvVar": "PROOFSTACK_PROJECT_TOKEN",
    "includeEvidence": false,
    "maxPayloadBytes": 1048576
  },
  "ai": {
    "enabled": false,
    "providers": [],
    "mcpServers": [],
    "agents": [],
    "maxTurns": 8,
    "maxTokensPerSession": 200000,
    "autonomy": "read"
  },
  "enabledModules": [
    "world",
    "flow",
    "exit"
  ]
};

export default config;
