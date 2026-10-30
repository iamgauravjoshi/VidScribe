import { randomUUID } from 'node:crypto';

import { claimNextIngestionJob } from '../../repositories/ingestion-job.repository.js';
import { config } from '../../shared/config/index.js';
import { logger } from '../../shared/logger/index.js';
import { processIngestionJob } from './ingestion.service.js';

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export interface IngestionWorker {
  stop(): Promise<void>;
}

/**
 * Start one database-backed worker loop in the API process. PostgreSQL remains
 * the durable queue, so another process can claim work after this process exits.
 */
export function startIngestionWorker(): IngestionWorker {
  const workerId = randomUUID();
  let stopping = false;

  const run = async (): Promise<void> => {
    logger.info('Ingestion worker started', { workerId });

    while (!stopping) {
      try {
        const job = await claimNextIngestionJob(
          workerId,
          config.ingestion.jobLeaseDurationMs,
        );

        if (job) {
          await processIngestionJob(job);
          continue;
        }
      } catch (error: unknown) {
        logger.error('Ingestion worker poll failed', {
          workerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await sleep(config.ingestion.workerPollIntervalMs);
    }

    logger.info('Ingestion worker stopped', { workerId });
  };

  const runPromise = run();

  return {
    async stop(): Promise<void> {
      stopping = true;
      await runPromise;
    },
  };
}
