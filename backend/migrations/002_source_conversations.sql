CREATE TABLE public.conversations (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL UNIQUE REFERENCES public.sources(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Existing sources get their one-to-one conversation before the API starts
-- serving the new conversation routes.
INSERT INTO public.conversations (source_id)
SELECT id FROM public.sources
ON CONFLICT (source_id) DO NOTHING;

CREATE TABLE public.messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  turn_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('USER', 'ASSISTANT')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  content TEXT NOT NULL,
  citations JSONB NOT NULL DEFAULT '[]'::JSONB,
  generation_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (generation_attempt_count >= 0),
  generation_token UUID,
  generation_expires_at TIMESTAMPTZ,
  failure_code TEXT,
  failure_message TEXT,
  failure_retryable BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT messages_citations_array_check CHECK (JSONB_TYPEOF(citations) = 'array'),
  CONSTRAINT messages_user_completed_check CHECK (role <> 'USER' OR status = 'COMPLETED'),
  CONSTRAINT messages_pending_lease_check CHECK (
    status <> 'PENDING' OR (
      role = 'ASSISTANT'
      AND generation_token IS NOT NULL
      AND generation_expires_at IS NOT NULL
      AND failure_code IS NULL
      AND failure_message IS NULL
    )
  ),
  CONSTRAINT messages_completed_cleanup_check CHECK (
    status <> 'COMPLETED' OR (
      generation_token IS NULL
      AND generation_expires_at IS NULL
      AND failure_code IS NULL
      AND failure_message IS NULL
    )
  ),
  CONSTRAINT messages_failed_cleanup_check CHECK (
    status <> 'FAILED' OR (
      role = 'ASSISTANT'
      AND generation_token IS NULL
      AND generation_expires_at IS NULL
      AND failure_code IS NOT NULL
      AND failure_message IS NOT NULL
    )
  ),
  CONSTRAINT messages_conversation_turn_role_key UNIQUE (conversation_id, turn_id, role)
);

CREATE INDEX messages_conversation_order_idx
  ON public.messages (conversation_id, id);

CREATE INDEX messages_pending_expiry_idx
  ON public.messages (generation_expires_at)
  WHERE role = 'ASSISTANT' AND status = 'PENDING';
