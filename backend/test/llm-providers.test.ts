import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../src/shared/errors/app-error.js';
import { generateWithAnthropic } from '../src/services/llm/providers/anthropic.adapter.js';
import { generateWithGemini } from '../src/services/llm/providers/gemini.adapter.js';
import { generateWithOpenAi } from '../src/services/llm/providers/openai.adapter.js';

test('Gemini, OpenAI, and Claude adapters use their provider request/response formats', async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const responses: unknown[] = [
    {
      candidates: [{ content: { parts: [{ text: 'Gemini answer' }] } }],
      usageMetadata: {
        promptTokenCount: 30,
        candidatesTokenCount: 10,
        totalTokenCount: 42,
        thoughtsTokenCount: 2,
      },
    },
    {
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'OpenAI answer' }] }],
      usage: {
        input_tokens: 28,
        output_tokens: 12,
        total_tokens: 40,
        input_tokens_details: { cached_tokens: 6 },
        output_tokens_details: { reasoning_tokens: 3 },
      },
    },
    {
      content: [{ type: 'text', text: 'Claude answer' }],
      usage: {
        input_tokens: 20,
        output_tokens: 8,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 10,
      },
    },
  ];

  globalThis.fetch = async (input, init) => {
    calls.push({
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return Response.json(responses[calls.length - 1]);
  };

  try {
    const gemini = await generateWithGemini({
      modelId: 'gemini-test-model',
      prompt: 'Summarize this excerpt.',
      apiKey: 'gemini-secret-test',
      timeoutMs: 5000,
    });
    assert.equal(gemini.text, 'Gemini answer');
    assert.deepEqual(gemini.usage, {
      inputTokens: 30,
      outputTokens: 10,
      totalTokens: 42,
      reasoningTokens: 2,
    });

    const openai = await generateWithOpenAi({
      modelId: 'openai-test-model',
      prompt: 'Summarize this excerpt.',
      apiKey: 'openai-secret-test',
      timeoutMs: 5000,
    });
    assert.equal(openai.text, 'OpenAI answer');
    assert.deepEqual(openai.usage, {
      inputTokens: 28,
      outputTokens: 12,
      totalTokens: 40,
      cachedInputTokens: 6,
      reasoningTokens: 3,
    });

    const anthropic = await generateWithAnthropic({
      modelId: 'claude-test-model',
      prompt: 'Summarize this excerpt.',
      apiKey: 'claude-secret-test',
      timeoutMs: 5000,
    });
    assert.equal(anthropic.text, 'Claude answer');
    assert.deepEqual(anthropic.usage, {
      inputTokens: 35,
      outputTokens: 8,
      totalTokens: 43,
      cachedInputTokens: 5,
      cacheCreationInputTokens: 10,
    });

    assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-test-model:generateContent/);
    assert.equal(calls[0].headers.get('x-goog-api-key'), 'gemini-secret-test');
    assert.deepEqual(calls[0].body.contents, [{ role: 'user', parts: [{ text: 'Summarize this excerpt.' }] }]);

    assert.equal(calls[1].url, 'https://api.openai.com/v1/responses');
    assert.equal(calls[1].headers.get('authorization'), 'Bearer openai-secret-test');
    assert.equal(calls[1].body.model, 'openai-test-model');

    assert.equal(calls[2].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(calls[2].headers.get('x-api-key'), 'claude-secret-test');
    assert.equal(calls[2].headers.get('anthropic-version'), '2023-06-01');
    assert.equal(calls[2].body.model, 'claude-test-model');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider authentication errors do not expose upstream response bodies or keys', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: 'provider echoed private details' } }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );

  try {
    await assert.rejects(
      generateWithGemini({ modelId: 'gemini-test-model', prompt: 'Hello', apiKey: 'private-key-test', timeoutMs: 5000 }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'AI_PROVIDER_AUTH_FAILED' &&
        !error.message.includes('private-key-test') &&
        !error.message.includes('provider echoed private details'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
