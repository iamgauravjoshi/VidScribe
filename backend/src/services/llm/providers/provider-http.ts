import { AppError, ErrorCode } from '../../../shared/errors/index.js';
import type { LlmProviderId, ProviderTokenUsage } from '../../../types/llm.type.js';

export interface ProviderRequest {
  provider: LlmProviderId;
  label: string;
  url: string;
  body: unknown;
  headers?: Record<string, string>;
  timeoutMs: number;
}

export async function postProviderJson(request: ProviderRequest): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...request.headers,
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const authenticationFailure = response.status === 401 || response.status === 403;
      const rateLimited = response.status === 429;
      const unavailable = response.status >= 500;
      const statusCode = rateLimited ? 429 : unavailable ? 503 : 502;

      throw new AppError(
        authenticationFailure
          ? `The ${request.label} API key was rejected. Check its value in AI settings.`
          : rateLimited
            ? `${request.label} is rate limiting requests. Try again shortly.`
            : `${request.label} could not complete the request. Check the model ID and try again.`,
        authenticationFailure ? ErrorCode.AI_PROVIDER_AUTH_FAILED : ErrorCode.AI_PROVIDER_REQUEST_FAILED,
        statusCode,
        { provider: request.provider, upstreamStatus: response.status },
      );
    }

    try {
      return await response.json();
    } catch {
      throw new AppError(
        `${request.label} returned an invalid response.`,
        ErrorCode.AI_PROVIDER_INVALID_RESPONSE,
        502,
        { provider: request.provider },
      );
    }
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AppError(
        `${request.label} did not respond before the request timed out.`,
        ErrorCode.AI_PROVIDER_TIMEOUT,
        504,
        { provider: request.provider, timeoutMs: request.timeoutMs },
      );
    }

    if (error instanceof TypeError) {
      throw new AppError(
        `${request.label} could not be reached. Check your network connection and provider settings.`,
        ErrorCode.AI_PROVIDER_UNAVAILABLE,
        503,
        { provider: request.provider },
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function readTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function compactTokenUsage(usage: ProviderTokenUsage): ProviderTokenUsage | undefined {
  const entries = Object.entries(usage).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) as ProviderTokenUsage : undefined;
}

export function invalidProviderResponse(provider: LlmProviderId, label: string): AppError {
  return new AppError(
    `${label} returned a response without generated text.`,
    ErrorCode.AI_PROVIDER_INVALID_RESPONSE,
    502,
    { provider },
  );
}
