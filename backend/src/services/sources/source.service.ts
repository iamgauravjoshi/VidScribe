import { withTransaction } from '../../db/transaction.js';
import {
  createOrGetSourceWithClient,
  deleteSource as deleteSourceRecord,
  findSourceById,
  listSources,
} from '../../repositories/source.repository.js';
import { retrySourceJob } from '../../repositories/ingestion-job.repository.js';
import { AppError, ErrorCode } from '../../shared/errors/index.js';
import { config } from '../../shared/config/index.js';
import { buildCanonicalYouTubeUrl, extractYouTubeVideoId } from '../youtube/youtube-url.service.js';
import { SourceType, type SourceRecord } from '../../types/source.type.js';

export async function addSource(url: string): Promise<{ source: SourceRecord; created: boolean }> {
  const externalId = extractYouTubeVideoId(url);
  const canonicalUrl = buildCanonicalYouTubeUrl(externalId);

  return withTransaction((client) =>
    createOrGetSourceWithClient(client, {
      type: SourceType.YOUTUBE,
      externalId,
      canonicalUrl,
      maxAttempts: config.ingestion.maxWorkerAttempts,
    }),
  );
}

export async function getSource(sourceId: number): Promise<SourceRecord> {
  const source = await findSourceById(sourceId);

  if (!source) {
    throw new AppError('Source was not found.', ErrorCode.SOURCE_NOT_FOUND, 404, { sourceId });
  }

  return source;
}

export async function getSources(): Promise<SourceRecord[]> {
  return listSources();
}

export async function retrySource(sourceId: number): Promise<SourceRecord> {
  const source = await retrySourceJob(sourceId);

  if (!source) {
    throw new AppError('Source was not found.', ErrorCode.SOURCE_NOT_FOUND, 404, { sourceId });
  }

  return source;
}

export async function removeSource(sourceId: number): Promise<void> {
  const deleted = await deleteSourceRecord(sourceId);

  if (!deleted) {
    throw new AppError('Source was not found.', ErrorCode.SOURCE_NOT_FOUND, 404, { sourceId });
  }
}
