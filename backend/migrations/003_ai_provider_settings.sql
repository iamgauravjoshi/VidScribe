-- Provider selection is global for the current single-user, local-first product.
-- API keys are encrypted by the application before they reach this table.
CREATE TABLE public.ai_provider_configs (
  provider_id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  api_key_ciphertext TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_provider_model_nonempty CHECK (length(trim(model_id)) > 0)
);

CREATE TABLE public.ai_runtime_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  active_provider TEXT NOT NULL DEFAULT 'gemini',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.ai_runtime_settings (id, active_provider)
VALUES (1, 'gemini')
ON CONFLICT (id) DO NOTHING;

-- Preserve which provider/model generated each persisted assistant answer.
ALTER TABLE public.messages
  ADD COLUMN model_provider TEXT,
  ADD COLUMN model_id TEXT,
  ADD CONSTRAINT messages_model_pair_check CHECK (
    (model_provider IS NULL AND model_id IS NULL)
    OR (model_provider IS NOT NULL AND model_id IS NOT NULL)
  );
