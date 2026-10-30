import {
  completeIngestionJob,
  failIngestionJob,
  ProcessingLeaseLostError,
  renewIngestionJobLease,
  updateIngestionJobPhase,
  type ClaimedIngestionJob,
} from '../../repositories/ingestion-job.repository.js';
import { config } from '../../shared/config/index.js';
import { AppError, ErrorCode } from '../../shared/errors/index.js';
import { logger } from '../../shared/logger/index.js';
import { SourceType, type SourceFailure } from '../../types/source.type.js';
import { createChunks } from './chunk.service.js';
import { getTranscript } from '../youtube/youtube.service.js';
import type { CreateChunkInput } from '../../repositories/chunk.repository.js';

export function classifyIngestionFailure(error: unknown): SourceFailure {
  if (error instanceof AppError) {
    const retryable =
      error.code !== ErrorCode.TRANSCRIPT_NOT_AVAILABLE &&
      error.code !== ErrorCode.TRANSCRIPT_EMPTY &&
      error.code !== ErrorCode.INVALID_YOUTUBE_URL &&
      (error.statusCode >= 500 || error.code === ErrorCode.TRANSCRIPT_FETCH_FAILED);

    return {
      code: error.code,
      message: error.message,
      retryable,
    };
  }

  return {
    code: 'INGESTION_FAILED',
    message: 'The source could not be processed. Check the video captions and local database, then try again.',
    retryable: true,
  };
}

function startLeaseHeartbeat(job: ClaimedIngestionJob, leaseDurationMs: number) {
  let leaseLost = false;
  let inFlight: Promise<void> | null = null;
  const intervalMs = Math.max(100, Math.floor(leaseDurationMs / 3));

  const timer = setInterval(() => {
    if (inFlight) {
      return;
    }

    inFlight = renewIngestionJobLease(job.id, job.leaseToken, leaseDurationMs)
      .then((renewed) => {
        if (!renewed) {
          leaseLost = true;
        }
      })
      .catch((error: unknown) => {
        leaseLost = true;
        logger.warn('Ingestion worker could not renew its lease', {
          jobId: job.id,
          sourceId: job.sourceId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        inFlight = null;
      });
  }, intervalMs);

  timer.unref();

  return {
    assertOwned(): void {
      if (leaseLost) {
        throw new ProcessingLeaseLostError();
      }
    },
    async stop(): Promise<void> {
      clearInterval(timer);
      await inFlight;
    },
  };
}

export async function processIngestionJob(job: ClaimedIngestionJob): Promise<void> {
  const heartbeat = startLeaseHeartbeat(job, config.ingestion.jobLeaseDurationMs);
  const startedAt = Date.now();

  try {
    if (job.sourceType !== SourceType.YOUTUBE) {
      throw new AppError(
        `Source type "${job.sourceType}" is not supported yet.`,
        ErrorCode.SOURCE_TYPE_UNSUPPORTED,
        422,
      );
    }

    logger.info('Source ingestion started', {
      jobId: job.id,
      sourceId: job.sourceId,
      attempt: job.attemptCount,
      workerLeaseMs: config.ingestion.jobLeaseDurationMs,
    });

    const { transcript } = await getTranscript(job.canonicalUrl);
    heartbeat.assertOwned();

    if (transcript.length === 0 || transcript.every((segment) => !segment.text.trim())) {
      throw new AppError(
        'No usable English captions were found for this video.',
        ErrorCode.TRANSCRIPT_EMPTY,
        422,
      );
    }

    if (!(await updateIngestionJobPhase(job.id, job.leaseToken, 'CHUNKING'))) {
      throw new ProcessingLeaseLostError();
    }

    const chunks = createChunks(
      transcript,
      config.rag.chunkSize,
      config.rag.chunkOverlap,
    );

    if (chunks.length === 0) {
      throw new AppError(
        'The transcript did not contain any text that could be indexed.',
        ErrorCode.TRANSCRIPT_EMPTY,
        422,
      );
    }

    if (!(await updateIngestionJobPhase(job.id, job.leaseToken, 'INDEXING'))) {
      throw new ProcessingLeaseLostError();
    }

    const chunksToPersist: CreateChunkInput[] = chunks.map((chunk, index) => ({
        sourceId: job.sourceId,
        chunkIndex: index,
        content: chunk.content,
        startSeconds: chunk.startTime,
        endSeconds: chunk.endTime,
      }));

    heartbeat.assertOwned();
    if (!(await updateIngestionJobPhase(job.id, job.leaseToken, 'PERSISTING'))) {
      throw new ProcessingLeaseLostError();
    }

    await completeIngestionJob(job.id, job.leaseToken, chunksToPersist);

    logger.info('Source ingestion completed', {
      jobId: job.id,
      sourceId: job.sourceId,
      chunkCount: chunksToPersist.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (error: unknown) {
    if (error instanceof ProcessingLeaseLostError) {
      logger.warn('Ingestion result discarded after worker lease was lost', {
        jobId: job.id,
        sourceId: job.sourceId,
      });
      return;
    }

    const failure = classifyIngestionFailure(error);

    try {
      const recorded = await failIngestionJob(job.id, job.leaseToken, failure);

      if (recorded) {
        logger.error('Source ingestion failed', {
          jobId: job.id,
          sourceId: job.sourceId,
          errorCode: failure.code,
          retryable: failure.retryable,
          durationMs: Date.now() - startedAt,
        });
      } else {
        logger.warn('Ingestion failure was ignored because the worker lease had expired', {
          jobId: job.id,
          sourceId: job.sourceId,
        });
      }
    } catch (recordError: unknown) {
      logger.error('Could not persist source ingestion failure; the lease will allow recovery', {
        jobId: job.id,
        sourceId: job.sourceId,
        originalError: failure.message,
        recordError: recordError instanceof Error ? recordError.message : String(recordError),
      });
    }
  } finally {
    await heartbeat.stop();
  }
}
