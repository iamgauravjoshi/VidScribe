import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { assertDedicatedTestDatabase } from '../test/e2e-database.js';

interface EvaluationQuery {
  id: string;
  question: string;
  anchorTerm: string;
}

interface EvaluationSource {
  title: string;
  videoId: string;
  queries: EvaluationQuery[];
}

const sourcesToEvaluate: EvaluationSource[] = [
  {
    title: 'A Simple Way to Break a Bad Habit | Judson Brewer | TED',
    videoId: '-moW9jvvMr4',
    queries: [
      {
        id: 'reward-based-habit-learning',
        question: 'How does reward-based learning shape habits?',
        anchorTerm: 'reward',
      },
      {
        id: 'curiosity-and-urges',
        question: 'Why does curiosity help change an urge?',
        anchorTerm: 'curiosity',
      },
    ],
  },
  {
    title: 'How to Speak So That People Want to Listen | Julian Treasure | TED',
    videoId: 'eIho2S0ZahI',
    queries: [
      {
        id: 'hail-speaking-model',
        question: 'What does the word HAIL represent in a talk?',
        anchorTerm: 'hail',
      },
      {
        id: 'gossip-lexical-paraphrase',
        question: 'What is one unhelpful thing a speaker should avoid?',
        anchorTerm: 'gossip',
      },
    ],
  },
  {
    title: 'But what is a neural network? | Deep learning chapter 1',
    videoId: 'aircAruvnKk',
    queries: [
      {
        id: 'neural-network-neurons',
        question: 'What are neurons in a neural network?',
        anchorTerm: 'neuron',
      },
      {
        id: 'connection-importance',
        question: 'How are the connections between neurons assigned importance?',
        anchorTerm: 'assign',
      },
    ],
  },
];

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Real-source evaluation only runs when NODE_ENV=test.');
  }
  assertDedicatedTestDatabase(process.env.VIDSCRIBE_TEST_DATABASE_URL);

  const [
    database,
    migrations,
    transaction,
    sourceRepository,
    jobs,
    ingestion,
    retrieval,
    citation,
    configuration,
  ] = await Promise.all([
    import('../src/db/postgres.js'),
    import('../src/db/migrate.js'),
    import('../src/db/transaction.js'),
    import('../src/repositories/source.repository.js'),
    import('../src/repositories/ingestion-job.repository.js'),
    import('../src/services/ingestion/ingestion.service.js'),
    import('../src/repositories/retrieval.repository.js'),
    import('../src/services/rag/citation.service.js'),
    import('../src/shared/config/index.js'),
  ]);
  const { pool } = database;
  const createdSourceIds: number[] = [];
  const queryResults: Array<{
    sourceTitle: string;
    videoId: string;
    queryId: string;
    question: string;
    targetSeconds: number;
    relevantRank: number | null;
    hitAt1: boolean;
    hitAt3: boolean;
    hitAt5: boolean;
    relevantChunkStartSeconds: number | null;
    citationStartSeconds: number | null;
    chunkStartOffsetSeconds: number | null;
    citationStartOffsetSeconds: number | null;
    citationSegmentFound: boolean;
    citationLinkValid: boolean;
    topMatches: Array<{
      rank: number;
      chunkIndex: number;
      relevanceScore: number;
      phraseMatch: boolean;
      fullQueryMatch: boolean;
      citationSegmentIndex: number | null;
      citationStartSeconds: number | null;
      citationPhraseMatch: boolean | null;
      citationFullQueryMatch: boolean | null;
      citationRelevanceScore: number | null;
    }>;
  }> = [];
  const sourceResults: Array<{
    title: string;
    url: string;
    segmentCount: number;
    chunkCount: number;
  }> = [];
  const unavailableSources: Array<{
    title: string;
    url: string;
    failureCode: string;
  }> = [];

  try {
    await migrations.runMigrations();
    const existingSources = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::INTEGER AS count FROM sources',
    );
    if (existingSources.rows[0]!.count !== 0) {
      throw new Error('Real-source evaluation requires an empty vidscribe_test database.');
    }
    const topK = Math.min(5, configuration.config.rag.topK);

    for (const sourceInput of sourcesToEvaluate) {
      const canonicalUrl = 'https://www.youtube.com/watch?v=' + sourceInput.videoId;
      const created = await transaction.withTransaction((client) =>
        sourceRepository.createOrGetSourceWithClient(client, {
          type: 'youtube',
          externalId: sourceInput.videoId,
          canonicalUrl,
          maxAttempts: configuration.config.ingestion.maxWorkerAttempts,
        }),
      );

      if (!created.created) {
        throw new Error(
          'Evaluation database already contains source ' +
            sourceInput.videoId +
            '; use a fresh isolated vidscribe_test database.',
        );
      }
      createdSourceIds.push(created.source.id);

      const job = await jobs.claimNextIngestionJob('real-source-evaluation', 180_000);
      if (!job || job.sourceId !== created.source.id) {
        throw new Error(
          'Could not claim the newly queued evaluation source ' + sourceInput.videoId + '.',
        );
      }

      await ingestion.processIngestionJob(job);
      const processedSource = await sourceRepository.findSourceById(created.source.id);
      if (processedSource?.status !== 'READY') {
        unavailableSources.push({
          title: sourceInput.title,
          url: canonicalUrl,
          failureCode:
            processedSource?.failure?.code ?? processedSource?.status ?? 'SOURCE_MISSING',
        });
        continue;
      }

      const stats = await pool.query<{ segment_count: number; chunk_count: number }>(
        'SELECT ' +
          '(SELECT COUNT(*)::INTEGER FROM source_transcript_segments WHERE source_id = $1) AS segment_count, ' +
          '(SELECT COUNT(*)::INTEGER FROM source_chunks WHERE source_id = $1) AS chunk_count',
        [created.source.id],
      );
      sourceResults.push({
        title: sourceInput.title,
        url: canonicalUrl,
        segmentCount: stats.rows[0]!.segment_count,
        chunkCount: stats.rows[0]!.chunk_count,
      });

      for (const queryInput of sourceInput.queries) {
        const targetSegment = await pool.query<{ start_seconds: number }>(
          'SELECT start_seconds FROM source_transcript_segments ' +
            "WHERE source_id = $1 AND LOWER(text) LIKE '%' || LOWER($2) || '%' " +
            'ORDER BY segment_index OFFSET 0 LIMIT 1',
          [created.source.id, queryInput.anchorTerm],
        );
        if (!targetSegment.rows[0]) {
          throw new Error(
            'The anchor ' +
              queryInput.anchorTerm +
              ' was not found in ' +
              sourceInput.videoId +
              '; refresh the evaluation labels.',
          );
        }
        const targetSeconds = targetSegment.rows[0].start_seconds;
        const rankedChunks = await retrieval.searchSourceChunksByText(
          created.source.id,
          queryInput.question,
          topK,
        );
        const citations = rankedChunks.map(citation.mapRetrievedChunk);
        const relevantIndex = rankedChunks.findIndex(
          (chunk) =>
            chunk.start_seconds !== null &&
            chunk.end_seconds !== null &&
            chunk.start_seconds <= targetSeconds &&
            chunk.end_seconds >= targetSeconds,
        );
        const relevantChunk = relevantIndex >= 0 ? rankedChunks[relevantIndex]! : null;
        const relevantCitation = relevantIndex >= 0 ? citations[relevantIndex]! : null;
        const citationUrl = relevantCitation ? new URL(relevantCitation.href) : null;
        const citationTimestamp = citationUrl?.searchParams.get('t') ?? null;
        const parsedCitationTimestamp =
          citationTimestamp?.endsWith('s') === true
            ? Number(citationTimestamp.slice(0, -1))
            : Number.NaN;
        const citationLinkValid = Boolean(
          relevantChunk &&
          relevantCitation &&
          citationUrl?.searchParams.get('v') === sourceInput.videoId &&
          relevantCitation.startSeconds !== null &&
          parsedCitationTimestamp === Math.floor(relevantCitation.startSeconds),
        );
        const chunkStartSeconds = relevantChunk?.start_seconds ?? null;
        const citationStartSeconds = relevantCitation?.startSeconds ?? null;

        queryResults.push({
          sourceTitle: sourceInput.title,
          videoId: sourceInput.videoId,
          queryId: queryInput.id,
          question: queryInput.question,
          targetSeconds,
          relevantRank: relevantIndex >= 0 ? relevantIndex + 1 : null,
          hitAt1: relevantIndex === 0,
          hitAt3: relevantIndex >= 0 && relevantIndex < 3,
          hitAt5: relevantIndex >= 0 && relevantIndex < 5,
          relevantChunkStartSeconds: chunkStartSeconds,
          citationStartSeconds,
          chunkStartOffsetSeconds:
            chunkStartSeconds === null ? null : Math.abs(targetSeconds - chunkStartSeconds),
          citationStartOffsetSeconds:
            citationStartSeconds === null ? null : Math.abs(targetSeconds - citationStartSeconds),
          citationSegmentFound: Boolean(
            relevantChunk && relevantChunk.citation_segment_index !== null,
          ),
          citationLinkValid,
          topMatches: rankedChunks.map((chunk, index) => ({
            rank: index + 1,
            chunkIndex: chunk.chunk_index,
            relevanceScore: chunk.relevanceScore,
            phraseMatch: chunk.phrase_match,
            fullQueryMatch: chunk.full_query_match,
            citationSegmentIndex: chunk.citation_segment_index,
            citationStartSeconds: chunk.citation_start_seconds,
            citationPhraseMatch: chunk.citation_phrase_match,
            citationFullQueryMatch: chunk.citation_full_query_match,
            citationRelevanceScore: chunk.citation_relevance_score,
          })),
        });
      }
    }

    const chunkStartOffsets = queryResults
      .map((result) => result.chunkStartOffsetSeconds)
      .filter((offset): offset is number => offset !== null);
    const citationOffsets = queryResults
      .map((result) => result.citationStartOffsetSeconds)
      .filter((offset): offset is number => offset !== null);
    const retrievedRelevantQueries = queryResults.filter((result) => result.relevantRank !== null);
    const expectedQueries = queryResults.length;
    const report = {
      generatedAt: new Date().toISOString(),
      retrieval:
        'PostgreSQL English full-text search preserves the cover-density top-5 candidate set, then reranks it by best transcript-segment phrase/full-query match and segment rank; top 5 capped by application configuration',
      citationStrategy: 'Best matching canonical transcript segment inside each retrieved chunk, with chunk-start fallback',
      providerCalls: 0,
      sourceCount: sourceResults.length,
      requestedSourceCount: sourcesToEvaluate.length,
      queryCount: queryResults.length,
      effectiveTopK: topK,
      metrics: {
        recallAt1:
          expectedQueries === 0
            ? null
            : queryResults.filter((result) => result.hitAt1).length / expectedQueries,
        recallAt3:
          expectedQueries === 0
            ? null
            : queryResults.filter((result) => result.hitAt3).length / expectedQueries,
        recallAt5:
          expectedQueries === 0
            ? null
            : queryResults.filter((result) => result.hitAt5).length / expectedQueries,
        meanReciprocalRank:
          expectedQueries === 0
            ? null
            : queryResults.reduce(
                (sum, result) => sum + (result.relevantRank === null ? 0 : 1 / result.relevantRank),
                0,
              ) / expectedQueries,
        medianChunkStartOffsetSeconds: median(chunkStartOffsets),
        medianCitationStartOffsetSeconds: median(citationOffsets),
        segmentCitationRateWhenRelevantChunkFound:
          retrievedRelevantQueries.length === 0
            ? null
            : retrievedRelevantQueries.filter((result) => result.citationSegmentFound).length /
              retrievedRelevantQueries.length,
        validCitationLinkRateWhenRelevantChunkFound:
          retrievedRelevantQueries.length === 0
            ? null
            : retrievedRelevantQueries.filter((result) => result.citationLinkValid).length /
              retrievedRelevantQueries.length,
      },
      sources: sourceResults,
      unavailableSources,
      queries: queryResults,
      limitations: [
        'Six manually labeled evidence anchors across three public English-captioned YouTube videos are a diagnostic sample, not a representative benchmark.',
        'A hit means the chunk timestamp range contains a manually selected transcript anchor; this does not assess generated answer factuality.',
        'The current PostgreSQL lexical search can miss a semantically correct passage when the query uses different words.',
      ],
    };
    const outputPath = fileURLToPath(new URL('../../real-source-evaluation.json', import.meta.url));
    await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (sourceResults.length < 2 || queryResults.length < 4) {
      throw new Error(
        'Evaluation needs at least two available sources and four labeled queries; see the report for caption failures.',
      );
    }
  } finally {
    try {
      for (const sourceId of createdSourceIds) {
        await sourceRepository.deleteSource(sourceId);
      }
    } finally {
      await pool.end();
    }
  }
}

await main();
