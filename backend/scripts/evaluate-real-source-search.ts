import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  REAL_SOURCE_SEARCH_DATASET,
  type EvaluationQueryStyle,
} from './real-source-search.dataset.js';
import { normalizeEvidenceText, selectEvidenceAnchor } from './real-source-search.labels.js';
import { assertDedicatedTestDatabase } from '../test/e2e-database.js';

const sourcesToEvaluate = REAL_SOURCE_SEARCH_DATASET.sources;

interface RankedEvaluationMatch {
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
  targetsLabeledSegment: boolean;
}

interface EvaluationQueryResult {
  sourceTitle: string;
  sourceTopic: string;
  videoId: string;
  queryId: string;
  queryStyle: EvaluationQueryStyle;
  question: string;
  anchorPhrase: string;
  anchorOccurrence: number;
  matchingAnchorSegments: number;
  targetSegmentIndex: number;
  targetSeconds: number;
  evidenceChunkRank: number | null;
  exactCitationRank: number | null;
  evidenceHitAt1: boolean;
  evidenceHitAt3: boolean;
  evidenceHitAt5: boolean;
  exactCitationHitAt1: boolean;
  exactCitationHitAt3: boolean;
  exactCitationHitAt5: boolean;
  relevantChunkStartSeconds: number | null;
  citationStartSeconds: number | null;
  chunkStartOffsetSeconds: number | null;
  citationStartOffsetSeconds: number | null;
  citationSegmentFound: boolean;
  citationTargetsLabeledSegment: boolean;
  citationContainsAnchorPhrase: boolean;
  citationLinkValid: boolean;
  citationUrl: string | null;
  uniqueCitationCount: number;
  duplicateCitationCount: number;
  topMatches: RankedEvaluationMatch[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function percentile(values: number[], percentileRank: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileRank * sorted.length) - 1);
  return sorted[index] ?? null;
}

function rate<T>(values: T[], predicate: (value: T) => boolean): number | null {
  return values.length === 0 ? null : values.filter(predicate).length / values.length;
}

function meanReciprocalRank(
  results: EvaluationQueryResult[],
  getRank: (result: EvaluationQueryResult) => number | null,
): number | null {
  return results.length === 0
    ? null
    : results.reduce((sum, result) => {
        const rank = getRank(result);
        return sum + (rank === null ? 0 : 1 / rank);
      }, 0) / results.length;
}

function summarizeQueries(results: EvaluationQueryResult[]) {
  const chunkOffsets = results
    .map((result) => result.chunkStartOffsetSeconds)
    .filter((offset): offset is number => offset !== null);
  const citationOffsets = results
    .map((result) => result.citationStartOffsetSeconds)
    .filter((offset): offset is number => offset !== null);
  const relevantChunkResults = results.filter((result) => result.evidenceChunkRank !== null);

  return {
    queryCount: results.length,
    evidenceFoundCount: results.filter((result) => result.evidenceChunkRank !== null).length,
    evidenceRecallAt1: rate(results, (result) => result.evidenceHitAt1),
    evidenceRecallAt3: rate(results, (result) => result.evidenceHitAt3),
    evidenceRecallAt5: rate(results, (result) => result.evidenceHitAt5),
    evidenceMeanReciprocalRank: meanReciprocalRank(results, (result) => result.evidenceChunkRank),
    exactSupportCitationAt1: rate(results, (result) => result.exactCitationHitAt1),
    exactSupportCitationAt3: rate(results, (result) => result.exactCitationHitAt3),
    exactSupportCitationAt5: rate(results, (result) => result.exactCitationHitAt5),
    exactSupportCitationMeanReciprocalRank: meanReciprocalRank(
      results,
      (result) => result.exactCitationRank,
    ),
    medianChunkStartOffsetSeconds: median(chunkOffsets),
    medianCitationStartOffsetSeconds: median(citationOffsets),
    p90CitationStartOffsetSeconds: percentile(citationOffsets, 0.9),
    maximumCitationStartOffsetSeconds:
      citationOffsets.length === 0 ? null : Math.max(...citationOffsets),
    firstRelevantChunkCitationTargetsGoldSegmentRate: rate(
      relevantChunkResults,
      (result) => result.citationTargetsLabeledSegment,
    ),
    firstRelevantChunkCitationContainsGoldAnchorRate: rate(
      relevantChunkResults,
      (result) => result.citationContainsAnchorPhrase,
    ),
    validCitationLinkRateWhenEvidenceFound: rate(
      relevantChunkResults,
      (result) => result.citationLinkValid,
    ),
    duplicateCitationsRemoved: results.reduce(
      (total, result) => total + result.duplicateCitationCount,
      0,
    ),
  };
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
  const queryResults: EvaluationQueryResult[] = [];
  const sourceResults: Array<{
    title: string;
    topic: string;
    url: string;
    segmentCount: number;
    chunkCount: number;
  }> = [];
  const unavailableSources: Array<{
    title: string;
    topic: string;
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
          topic: sourceInput.topic,
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
        topic: sourceInput.topic,
        url: canonicalUrl,
        segmentCount: stats.rows[0]!.segment_count,
        chunkCount: stats.rows[0]!.chunk_count,
      });

      const transcriptSegments = await pool.query<{
        segmentIndex: number;
        startSeconds: number;
        text: string;
      }>(
        'SELECT segment_index AS "segmentIndex", start_seconds AS "startSeconds", text ' +
          'FROM source_transcript_segments WHERE source_id = $1 ORDER BY segment_index',
        [created.source.id],
      );

      for (const queryInput of sourceInput.queries) {
        const selectedAnchor = selectEvidenceAnchor(
          transcriptSegments.rows,
          queryInput.anchorPhrase,
          queryInput.anchorOccurrence ?? 0,
        );
        if (selectedAnchor.matchingSegmentCount > 1 && queryInput.anchorOccurrence === undefined) {
          throw new Error(
            `Ambiguous anchor “${queryInput.anchorPhrase}” in ${sourceInput.videoId}; set anchorOccurrence explicitly.`,
          );
        }
        const targetSegment = selectedAnchor.segment;
        const targetSeconds = targetSegment.startSeconds;
        const rankedChunks = await retrieval.searchSourceChunksByText(
          created.source.id,
          queryInput.question,
          topK,
        );
        const uniqueCitations = citation.mapRetrievedChunks(rankedChunks);
        const relevantIndex = rankedChunks.findIndex(
          (chunk) =>
            chunk.start_seconds !== null &&
            chunk.end_seconds !== null &&
            chunk.start_seconds <= targetSeconds &&
            chunk.end_seconds >= targetSeconds,
        );
        const relevantChunk = relevantIndex >= 0 ? rankedChunks[relevantIndex]! : null;
        const relevantCitation = relevantChunk ? citation.mapRetrievedChunk(relevantChunk) : null;
        const exactCitationIndex = rankedChunks.findIndex(
          (chunk) => chunk.citation_segment_index === targetSegment.segmentIndex,
        );
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
        const citationContainsAnchorPhrase = Boolean(
          relevantCitation &&
          normalizeEvidenceText(relevantCitation.excerpt).includes(
            normalizeEvidenceText(queryInput.anchorPhrase),
          ),
        );
        const exactCitationRank = exactCitationIndex >= 0 ? exactCitationIndex + 1 : null;
        const evidenceChunkRank = relevantIndex >= 0 ? relevantIndex + 1 : null;

        queryResults.push({
          sourceTitle: sourceInput.title,
          sourceTopic: sourceInput.topic,
          videoId: sourceInput.videoId,
          queryId: queryInput.id,
          queryStyle: queryInput.style,
          question: queryInput.question,
          anchorPhrase: queryInput.anchorPhrase,
          anchorOccurrence: selectedAnchor.occurrence,
          matchingAnchorSegments: selectedAnchor.matchingSegmentCount,
          targetSegmentIndex: targetSegment.segmentIndex,
          targetSeconds,
          evidenceChunkRank,
          exactCitationRank,
          evidenceHitAt1: evidenceChunkRank === 1,
          evidenceHitAt3: evidenceChunkRank !== null && evidenceChunkRank <= 3,
          evidenceHitAt5: evidenceChunkRank !== null && evidenceChunkRank <= 5,
          exactCitationHitAt1: exactCitationRank === 1,
          exactCitationHitAt3: exactCitationRank !== null && exactCitationRank <= 3,
          exactCitationHitAt5: exactCitationRank !== null && exactCitationRank <= 5,
          relevantChunkStartSeconds: chunkStartSeconds,
          citationStartSeconds,
          chunkStartOffsetSeconds:
            chunkStartSeconds === null ? null : Math.abs(targetSeconds - chunkStartSeconds),
          citationStartOffsetSeconds:
            citationStartSeconds === null ? null : Math.abs(targetSeconds - citationStartSeconds),
          citationSegmentFound: Boolean(
            relevantChunk && relevantChunk.citation_segment_index !== null,
          ),
          citationTargetsLabeledSegment:
            relevantChunk?.citation_segment_index === targetSegment.segmentIndex,
          citationContainsAnchorPhrase,
          citationLinkValid,
          citationUrl: relevantCitation?.href ?? null,
          uniqueCitationCount: uniqueCitations.length,
          duplicateCitationCount: rankedChunks.length - uniqueCitations.length,
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
            targetsLabeledSegment: chunk.citation_segment_index === targetSegment.segmentIndex,
          })),
        });
      }
    }

    const styles: EvaluationQueryStyle[] = ['lexical', 'paraphrase', 'definition'];
    const queryStyleMetrics = Object.fromEntries(
      styles.map((style) => [
        style,
        summarizeQueries(queryResults.filter((result) => result.queryStyle === style)),
      ]),
    );
    const sourceMetrics = sourceResults.map((source) => ({
      title: source.title,
      topic: source.topic,
      videoId: new URL(source.url).searchParams.get('v'),
      ...summarizeQueries(
        queryResults.filter(
          (result) => result.videoId === new URL(source.url).searchParams.get('v'),
        ),
      ),
    }));
    const report = {
      generatedAt: new Date().toISOString(),
      datasetVersion: REAL_SOURCE_SEARCH_DATASET.version,
      retrieval:
        'PostgreSQL English full-text search preserves the original cover-density top-5 chunk candidates, then reranks them by query matches and matching caption-segment rank',
      citationStrategy:
        'Best matching canonical transcript segment inside each retrieved chunk, with chunk-start fallback',
      providerCalls: 0,
      generatedAnswerSupport: 'not_evaluated_provider_free_retrieval_only',
      sourceCount: sourceResults.length,
      requestedSourceCount: sourcesToEvaluate.length,
      queryCount: queryResults.length,
      effectiveTopK: topK,
      metrics: summarizeQueries(queryResults),
      queryStyleMetrics,
      sourceMetrics,
      sources: sourceResults,
      unavailableSources,
      queries: queryResults,
      limitations: [
        'The set uses 18 manually selected support phrases across six educational YouTube videos; it is broader than the prior sample but is still a small convenience benchmark.',
        'Evidence recall means a chunk covers the labeled transcript segment. Exact citation support means a retrieved citation selects that exact labeled segment; this does not evaluate generated answer factuality.',
        'The benchmark makes no provider calls and does not measure whether a human prefers the resulting seek point or whether a generated answer uses the evidence correctly.',
        'The current PostgreSQL lexical search can miss a semantically correct passage when the query uses different words.',
      ],
    };
    const outputPath = fileURLToPath(new URL('../../real-source-evaluation.json', import.meta.url));
    await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    process.stdout.write(
      JSON.stringify(
        {
          reportFile: 'real-source-evaluation.json',
          datasetVersion: report.datasetVersion,
          sourceCount: report.sourceCount,
          requestedSourceCount: report.requestedSourceCount,
          queryCount: report.queryCount,
          providerCalls: report.providerCalls,
          generatedAnswerSupport: report.generatedAnswerSupport,
          metrics: report.metrics,
          queryStyleMetrics: report.queryStyleMetrics,
          sourceMetrics: report.sourceMetrics,
          unavailableSources: report.unavailableSources,
        },
        null,
        2,
      ) + '\n',
    );
    if (sourceResults.length < 4 || queryResults.length < 12) {
      throw new Error(
        'Evaluation needs at least four available sources and twelve labeled queries; see the report for caption or anchor failures.',
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
