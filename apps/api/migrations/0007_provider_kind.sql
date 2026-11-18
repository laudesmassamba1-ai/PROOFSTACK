-- The provider family is a property of the connection, not something to infer later.
--
-- OpenAI-compatible providers share one wire format; Anthropic has its own
-- (/v1/messages, x-api-key, content blocks). Storing the family here means the chat
-- loop never has to guess from a URL.

ALTER TABLE ai_profiles ADD COLUMN provider_kind TEXT NOT NULL DEFAULT 'openai';
ALTER TABLE ai_profiles ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'custom';
