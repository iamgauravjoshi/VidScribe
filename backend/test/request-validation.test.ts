import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request } from 'express';

import { validateChatRequest } from '../src/validators/chat.validator.js';
import { validateActiveProvider, validateSaveAiProvider } from '../src/validators/ai-settings.validator.js';
import {
  validateCreateSourceRequest,
  validateSourceIdParam,
} from '../src/validators/source.validator.js';

function request(body: unknown, params: Record<string, string> = {}): Request {
  return { body, params } as unknown as Request;
}

test('create-source validation requires a bounded, syntactically valid URL', () => {
  assert.deepEqual(validateCreateSourceRequest(request({ url: 'https://youtube.com/watch?v=abcdefghijk' })), {});
  assert.equal(validateCreateSourceRequest(request({ url: ' ' })).url, 'A YouTube URL is required.');
  assert.equal(validateCreateSourceRequest(request({ url: 'bad url' })).url, 'Enter a valid URL.');
  assert.equal(validateCreateSourceRequest(request({ url: 'x'.repeat(2049) })).url, 'URL cannot exceed 2048 characters.');
  assert.equal(validateCreateSourceRequest(request([])).body, 'Request body must be a JSON object.');
});

test('source ID validation rejects zero, unsafe integers, and non-numeric paths', () => {
  assert.deepEqual(validateSourceIdParam(request({}, { sourceId: '12' })), {});
  assert.ok(validateSourceIdParam(request({}, { sourceId: '0' })).sourceId);
  assert.ok(validateSourceIdParam(request({}, { sourceId: '9007199254740992' })).sourceId);
  assert.ok(validateSourceIdParam(request({}, { sourceId: 'abc' })).sourceId);
});

test('chat validation requires a non-empty question within the API limit', () => {
  const requestId = '6c039f14-5af3-46bc-a42d-25ea3353c17b';
  assert.deepEqual(validateChatRequest(request({ question: 'What is the main idea?', requestId })), {});
  assert.ok(validateChatRequest(request({ question: '  ', requestId })).question);
  assert.ok(validateChatRequest(request({ question: 'x'.repeat(2001), requestId })).question);
  assert.ok(validateChatRequest(request(null)).body);
  assert.ok(validateChatRequest(request({ question: 'valid question', requestId: 'not-a-uuid' })).requestId);
});

test('AI provider settings validate provider IDs, model IDs, and API-key types without echoing secrets', () => {
  assert.deepEqual(
    validateSaveAiProvider(request({ modelId: 'gemini-3.8-flash', apiKey: 'private-test-key' }, { providerId: 'gemini' })),
    {},
  );
  assert.ok(validateSaveAiProvider(request({ modelId: '' }, { providerId: 'gemini' })).modelId);
  assert.ok(validateSaveAiProvider(request({ modelId: 'bad\nmodel' }, { providerId: 'gemini' })).modelId);
  const invalidKey = validateSaveAiProvider(request({ modelId: 'model', apiKey: { secret: 'private-test-key' } }, { providerId: 'gemini' }));
  assert.ok(invalidKey.apiKey);
  assert.equal(JSON.stringify(invalidKey).includes('private-test-key'), false);
  assert.ok(validateSaveAiProvider(request({ modelId: 'model' }, { providerId: 'custom-url' })).providerId);
  assert.deepEqual(validateActiveProvider(request({ providerId: 'ollama' })), {});
  assert.ok(validateActiveProvider(request({ providerId: 'custom-url' })).providerId);
});
