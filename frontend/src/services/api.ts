import type {
  ApplicationHealth,
  AiSettings,
  ChatTurnResult,
  Conversation,
  LlmProviderId,
  Source,
  SourceTranscript,
} from '../types/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

interface ApiErrorBody {
  success?: false;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (error: unknown) {
    throw new ApiError(
      error instanceof Error ? error.message : 'The API could not be reached.',
      0,
      'NETWORK_ERROR',
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiError(
      body?.error?.message ?? `Request failed (${response.status}).`,
      response.status,
      body?.error?.code,
    );
  }

  return payload as T;
}

export async function createSource(url: string): Promise<{ source: Source; created: boolean }> {
  return request('/sources', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export async function getSources(): Promise<Source[]> {
  const result = await request<{ sources: Source[] }>('/sources');
  return result.sources;
}

export async function getSource(sourceId: number): Promise<Source> {
  const result = await request<{ source: Source }>(`/sources/${sourceId}`);
  return result.source;
}

export async function getSourceConversation(sourceId: number): Promise<Conversation> {
  const result = await request<{ conversation: Conversation }>(`/sources/${sourceId}/conversation`);
  return result.conversation;
}

export async function getSourceTranscript(
  sourceId: number,
  options: { limit?: number; cursor?: number; query?: string; aroundSeconds?: number; signal?: AbortSignal } = {},
): Promise<SourceTranscript> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.cursor !== undefined) params.set('cursor', String(options.cursor));
  if (options.query) params.set('query', options.query);
  if (options.aroundSeconds !== undefined) params.set('around', String(options.aroundSeconds));
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const result = await request<{ transcript: SourceTranscript }>(
    `/sources/${sourceId}/transcript${suffix}`,
    { signal: options.signal },
  );
  return result.transcript;
}

export async function requestSourceTranscriptRefresh(
  sourceId: number,
): Promise<{ status: 'QUEUED' | 'PROCESSING' | 'READY' }> {
  const result = await request<{ transcript: { status: 'QUEUED' | 'PROCESSING' | 'READY' } }>(
    `/sources/${sourceId}/transcript/rebuild`,
    { method: 'POST' },
  );
  return result.transcript;
}

export async function downloadSourceTranscript(
  sourceId: number,
  format: 'txt' | 'srt' | 'vtt',
): Promise<Blob> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}/sources/${sourceId}/transcript/export?format=${format}`);
  } catch (error: unknown) {
    throw new ApiError(
      error instanceof Error ? error.message : 'The transcript export could not be downloaded.',
      0,
      'NETWORK_ERROR',
    );
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      payload?.error?.message ?? `Transcript export failed (${response.status}).`,
      response.status,
      payload?.error?.code,
    );
  }

  return response.blob();
}

export async function retrySource(sourceId: number): Promise<Source> {
  const result = await request<{ source: Source }>(`/sources/${sourceId}/retry`, {
    method: 'POST',
  });
  return result.source;
}

export async function deleteSource(sourceId: number): Promise<void> {
  await request<void>(`/sources/${sourceId}`, { method: 'DELETE' });
}

export async function askQuestion(
  sourceId: number,
  question: string,
  requestId: string,
): Promise<ChatTurnResult> {
  return request(`/sources/${sourceId}/chat`, {
    method: 'POST',
    body: JSON.stringify({ question, requestId }),
  });
}

export async function getApplicationHealth(): Promise<ApplicationHealth> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal });
    const body = (await response.json()) as ApplicationHealth;

    if (!response.ok && response.status !== 503) {
      throw new ApiError('The application health check failed.', response.status);
    }

    return body;
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      'The API health check timed out or could not be reached.',
      0,
      'HEALTH_UNAVAILABLE',
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function getAiSettings(): Promise<AiSettings> {
  const result = await request<{ settings: AiSettings }>('/settings/ai');
  return result.settings;
}

export async function testAndSaveAiProvider(input: {
  providerId: LlmProviderId;
  modelId: string;
  apiKey?: string;
}): Promise<{ settings: AiSettings; durationMs: number }> {
  return request('/settings/ai/test-and-save', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
