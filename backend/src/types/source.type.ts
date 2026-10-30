export const SourceType = {
  YOUTUBE: 'youtube',
} as const;

export type SourceType = (typeof SourceType)[keyof typeof SourceType];

export const SourceStatus = {
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const;

export type SourceStatus = (typeof SourceStatus)[keyof typeof SourceStatus];

export const IngestionPhase = {
  FETCHING_TRANSCRIPT: 'FETCHING_TRANSCRIPT',
  CHUNKING: 'CHUNKING',
  INDEXING: 'INDEXING',
  PERSISTING: 'PERSISTING',
} as const;

export type IngestionPhase = (typeof IngestionPhase)[keyof typeof IngestionPhase];

export interface SourceFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export interface SourceRecord {
  id: number;
  type: SourceType;
  externalId: string;
  canonicalUrl: string;
  title: string | null;
  status: SourceStatus;
  phase: IngestionPhase | null;
  failure: SourceFailure | null;
  attemptCount: number;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SourceDto {
  id: number;
  type: SourceType;
  externalId: string;
  canonicalUrl: string;
  title: string | null;
  status: SourceStatus;
  phase: IngestionPhase | null;
  failure: SourceFailure | null;
  attemptCount: number;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export function toSourceDto(source: SourceRecord): SourceDto {
  return {
    ...source,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}
