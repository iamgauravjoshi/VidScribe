import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { Request, Response } from 'express';

import { requestContextMiddleware } from '../src/middleware/request-context.middleware.js';

test('request context returns and logs a server-generated ID without logging query secrets', () => {
  const logLines: string[] = [];
  const originalConsoleLog = console.log;
  console.log = (message?: unknown) => logLines.push(String(message));

  try {
    const createResponse = (statusCode: number) => {
      const headers = new Map<string, string>();
      const response = Object.assign(new EventEmitter(), {
        locals: {} as Record<string, unknown>,
        statusCode,
        setHeader(name: string, value: string) {
          headers.set(name.toLowerCase(), value);
        },
      }) as Response;

      return { headers, response };
    };

    const { headers, response } = createResponse(202);
    const request = {
      method: 'POST',
      baseUrl: '/api/sources',
      route: { path: '/:sourceId/chat' },
      originalUrl: '/api/sources/12/chat?api_key=must-not-be-logged',
    } as Request;

    requestContextMiddleware(request, response, () => undefined);
    response.emit('finish');

    const requestId = headers.get('x-request-id');
    assert.ok(requestId);
    assert.match(
      requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(response.locals.requestId, requestId);

    const logLine = logLines[0] ?? '';
    const context = JSON.parse(logLine.slice(logLine.indexOf('{'))) as Record<string, unknown>;
    assert.equal(context.requestId, requestId);
    assert.equal(context.method, 'POST');
    assert.equal(context.operation, '/api/sources/:sourceId/chat');
    assert.equal(context.statusCode, 202);
    assert.equal(typeof context.durationMs, 'number');
    assert.equal(logLine.includes('must-not-be-logged'), false);

    const second = createResponse(200);
    requestContextMiddleware(request, second.response, () => undefined);
    second.response.emit('finish');
    assert.notEqual(second.headers.get('x-request-id'), requestId);
  } finally {
    console.log = originalConsoleLog;
  }
});
