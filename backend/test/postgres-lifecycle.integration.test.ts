import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { RETRIEVAL_EVALUATION } from './fixtures/retrieval-evaluation.js';

const testDatabaseUrl = process.env.VIDSCRIBE_TEST_DATABASE_URL;
let closePool: (() => Promise<void>) | undefined;

after(async () => {
  await closePool?.();
});

test(
  'PostgreSQL keeps source ingestion and persisted chat turns safe under concurrency',
  { skip: !testDatabaseUrl },
  async () => {
    if (!testDatabaseUrl) return;

    const databaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1));
    assert.match(
      databaseName,
      /(?:^|[_-])test(?:$|[_-])/i,
      'VIDSCRIBE_TEST_DATABASE_URL must point to a database whose name includes “test”.',
    );

    // Import only after setting test mode so the shared pool selects the
    // explicitly supplied disposable database URL.
    process.env.NODE_ENV = 'test';

    const [
      database,
      migrations,
      transaction,
      sources,
      jobs,
      conversations,
      aiSettingsRepository,
      aiSettingsService,
    ] = await Promise.all([
      import('../src/db/postgres.js'),
      import('../src/db/migrate.js'),
      import('../src/db/transaction.js'),
      import('../src/repositories/source.repository.js'),
      import('../src/repositories/ingestion-job.repository.js'),
      import('../src/repositories/conversation.repository.js'),
      import('../src/repositories/ai-settings.repository.js'),
      import('../src/services/ai-settings.service.js'),
    ]);
    const retrieval = await import('../src/repositories/retrieval.repository.js');
    const citationService = await import('../src/services/rag/citation.service.js');

    const { pool } = database;
    closePool = () => pool.end();
    await migrations.runMigrations();

    const existing = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::TEXT AS count FROM sources',
    );
    assert.equal(existing.rows[0]?.count, '0', 'the disposable integration database must be empty');

    let sourceIdForCleanup: number | null = null;
    let unrelatedSourceIdForCleanup: number | null = null;
    const originalActiveProvider = await aiSettingsRepository.getActiveProvider();
    const originalOpenAiConfig = await aiSettingsRepository.getStoredProviderConfig('openai');

    try {
      await aiSettingsRepository.setActiveProvider('gemini');
      await pool.query("DELETE FROM ai_provider_configs WHERE provider_id = 'openai'");

      const initialAiSettings = await aiSettingsService.getAiSettings();
      assert.equal(initialAiSettings.activeProvider, 'gemini');
      assert.equal(
        initialAiSettings.providers.find((provider) => provider.id === 'gemini')?.modelId,
        'gemini-3.8-flash',
      );
      await assert.rejects(
        aiSettingsService.chooseActiveProvider('openai'),
        (error: unknown) =>
          error instanceof Error && 'code' in error && error.code === 'AI_PROVIDER_NOT_CONFIGURED',
      );

      await aiSettingsRepository.saveProviderConfig({
        providerId: 'openai',
        modelId: 'integration-model',
        apiKeyCiphertext: 'encrypted-test-only-ciphertext',
      });
      const selectedAiSettings = await aiSettingsService.chooseActiveProvider('openai');
      const selectedOpenAi = selectedAiSettings.providers.find(
        (provider) => provider.id === 'openai',
      );
      assert.equal(selectedAiSettings.activeProvider, 'openai');
      assert.equal(selectedOpenAi?.configured, true);
      assert.equal(
        'apiKey' in (selectedOpenAi ?? {}),
        false,
        'API keys must never be returned in settings DTOs',
      );
      assert.equal(
        'apiKeyCiphertext' in (selectedOpenAi ?? {}),
        false,
        'ciphertext must never be returned in settings DTOs',
      );

      const externalId = `integration-${randomUUID()}`;
      const create = () =>
        transaction.withTransaction((client) =>
          sources.createOrGetSourceWithClient(client, {
            type: 'youtube',
            externalId,
            canonicalUrl: `https://www.youtube.com/watch?v=${externalId}`,
            maxAttempts: 3,
          }),
        );

      const duplicateSubmissions = await Promise.all([create(), create()]);
      const sourceId = duplicateSubmissions[0].source.id;
      sourceIdForCleanup = sourceId;

      assert.equal(duplicateSubmissions[1].source.id, sourceId);
      assert.equal(duplicateSubmissions.filter((result) => result.created).length, 1);
      assert.deepEqual(await conversations.getConversationForSource(sourceId), {
        sourceId,
        messages: [],
      });

      const concurrentClaims = await Promise.all([
        jobs.claimNextIngestionJob('integration-worker-a', 90_000),
        jobs.claimNextIngestionJob('integration-worker-b', 90_000),
      ]);
      const claim = concurrentClaims.find((candidate) => candidate !== null);

      assert.ok(claim);
      assert.equal(concurrentClaims.filter((candidate) => candidate !== null).length, 1);

      await pool.query(
        `
          INSERT INTO source_chunks (source_id, chunk_index, content, start_seconds, end_seconds, embedding)
          VALUES ($1, 0, 'previous committed index', 0, 1, NULL)
        `,
        [sourceId],
      );

      assert.equal(
        await jobs.failIngestionJob(claim.id, claim.leaseToken, {
          code: 'TEST_RETRYABLE_FAILURE',
          message: 'Integration test failure.',
          retryable: true,
        }),
        true,
      );

      const repeatedRetries = await Promise.all([
        jobs.retrySourceJob(sourceId),
        jobs.retrySourceJob(sourceId),
      ]);

      assert.equal(repeatedRetries[0]?.status, 'QUEUED');
      assert.equal(repeatedRetries[1]?.status, 'QUEUED');
      assert.equal(repeatedRetries[0]?.retryCount, 1);
      assert.equal(repeatedRetries[1]?.retryCount, 1);

      const firstLease = await jobs.claimNextIngestionJob('integration-worker-a', 90_000);
      assert.ok(firstLease);

      await pool.query(
        "UPDATE ingestion_jobs SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1",
        [firstLease.id],
      );

      const recoveredLease = await jobs.claimNextIngestionJob('integration-worker-b', 90_000);
      assert.ok(recoveredLease);
      assert.notEqual(recoveredLease.leaseToken, firstLease.leaseToken);
      assert.equal(
        await jobs.failIngestionJob(firstLease.id, firstLease.leaseToken, {
          code: 'STALE_WORKER',
          message: 'This failure must be fenced.',
          retryable: true,
        }),
        false,
      );

      await assert.rejects(
        jobs.completeIngestionJob(recoveredLease.id, recoveredLease.leaseToken, [
          {
            sourceId,
            chunkIndex: 0,
            content: 'replacement chunk',
            embedding: null,
            startSeconds: 0,
            endSeconds: 1,
          },
        ], [{
          text: 'invalid transcript timestamp should fail after chunk and metadata writes',
          start: -1,
          duration: 1,
          lang: 'en',
        }], 'en'),
      );

      const preservedChunk = await pool.query<{ content: string }>(
        'SELECT content FROM source_chunks WHERE source_id = $1 ORDER BY chunk_index',
        [sourceId],
      );
      const preservedSource = await sources.findSourceById(sourceId);

      assert.deepEqual(
        preservedChunk.rows.map((row) => row.content),
        ['previous committed index'],
      );
      assert.equal(preservedSource?.status, 'PROCESSING');
      const rolledBackTranscript = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::TEXT AS count FROM source_transcripts WHERE source_id = $1',
        [sourceId],
      );
      assert.equal(rolledBackTranscript.rows[0]?.count, '0');
      const rolledBackSegments = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::TEXT AS count FROM source_transcript_segments WHERE source_id = $1',
        [sourceId],
      );
      assert.equal(rolledBackSegments.rows[0]?.count, '0');

      await jobs.completeIngestionJob(recoveredLease.id, recoveredLease.leaseToken, [
        {
          sourceId,
          chunkIndex: 0,
          content:
            'PostgreSQL stores the English full-text index locally and ranks matching transcript passages with ts_rank_cd.',
          startSeconds: 12,
          endSeconds: 24,
        },
        {
          sourceId,
          chunkIndex: 1,
          content:
            'Answers cite transcript excerpts with YouTube timestamps so readers can open the video at the supporting moment.',
          startSeconds: 30,
          endSeconds: 45,
        },
        {
          sourceId,
          chunkIndex: 2,
          content:
            "A cloud answer provider receives only the user's question and matched excerpts; the complete transcript stays in local PostgreSQL.",
          startSeconds: 60,
          endSeconds: 74,
        },
        {
          sourceId,
          chunkIndex: 3,
          content:
            'PostgreSQL source-scoped retrieval uses a GIN index and English text search; lexical matching may miss synonyms and paraphrases.',
          startSeconds: 90,
          endSeconds: 105,
        },
      ], [
        {
          text: 'PostgreSQL stores the English full-text index locally and ranks matching transcript passages with ts_rank_cd.',
          start: 12,
          duration: 12,
          lang: 'en',
        },
        {
          text: 'Answers cite transcript excerpts with YouTube timestamps so readers can open the video at the supporting moment.',
          start: 30,
          duration: 15,
          lang: 'en',
        },
        {
          text: "A cloud answer provider receives only the user's question and matched excerpts; the complete transcript stays in local PostgreSQL.",
          start: 60,
          duration: 14,
          lang: 'en',
        },
        {
          text: 'PostgreSQL source-scoped retrieval uses a GIN index and English text search; lexical matching may miss synonyms and paraphrases.',
          start: 90,
          duration: 15,
          lang: 'en',
        },
      ], 'en');

      const initialTranscript = await pool.query<{
        status: string;
        segment_count: number;
        language_code: string;
      }>(
        'SELECT status, segment_count, language_code FROM source_transcripts WHERE source_id = $1',
        [sourceId],
      );
      assert.deepEqual(initialTranscript.rows[0], {
        status: 'READY',
        segment_count: 4,
        language_code: 'en',
      });
      const initialSegments = await pool.query<{ segment_index: number; text: string }>(
        'SELECT segment_index, text FROM source_transcript_segments WHERE source_id = $1 ORDER BY segment_index',
        [sourceId],
      );
      assert.deepEqual(initialSegments.rows, [
        { segment_index: 0, text: 'PostgreSQL stores the English full-text index locally and ranks matching transcript passages with ts_rank_cd.' },
        { segment_index: 1, text: 'Answers cite transcript excerpts with YouTube timestamps so readers can open the video at the supporting moment.' },
        { segment_index: 2, text: "A cloud answer provider receives only the user's question and matched excerpts; the complete transcript stays in local PostgreSQL." },
        { segment_index: 3, text: 'PostgreSQL source-scoped retrieval uses a GIN index and English text search; lexical matching may miss synonyms and paraphrases.' },
      ]);

      const indexedWithoutVectors = await pool.query<{
        content: string;
        embedding: number[] | null;
      }>('SELECT content, embedding FROM source_chunks WHERE source_id = $1', [sourceId]);
      assert.equal(indexedWithoutVectors.rows.length, 4);
      assert.ok(indexedWithoutVectors.rows.every((row) => row.embedding === null));

      const matchingChunks = await retrieval.searchSourceChunksByText(
        sourceId,
        'How does PostgreSQL rank matching passages?',
        5,
      );
      assert.ok(matchingChunks.length > 0);
      assert.ok((matchingChunks[0]?.relevanceScore ?? 0) > 0);
      assert.equal(matchingChunks[0]?.chunk_index, 0);
      assert.equal(matchingChunks[0]?.start_seconds, 12);
      assert.deepEqual(
        await retrieval.searchSourceChunksByText(sourceId, 'the and or', 5),
        [],
        'a query with no searchable English terms returns no evidence',
      );

      let expectedHitsAtK = 0;
      for (const evaluationCase of RETRIEVAL_EVALUATION.cases) {
        const retrieved = await retrieval.searchSourceChunksByText(
          sourceId,
          evaluationCase.question,
          RETRIEVAL_EVALUATION.topK,
        );
        const matchedExpectedChunk = retrieved.find((chunk) =>
          evaluationCase.relevantChunkIndexes.some((index) => index === chunk.chunk_index),
        );

        assert.equal(
          Boolean(matchedExpectedChunk),
          evaluationCase.expectedHit,
          `Retrieval case ${evaluationCase.id} did not match its labeled expectation.`,
        );

        if (evaluationCase.expectedHit) expectedHitsAtK += 1;
        if (!matchedExpectedChunk) continue;

        const citation = citationService.mapRetrievedChunk(matchedExpectedChunk);
        const citationUrl = new URL(citation.href);
        assert.equal(citation.id, String(matchedExpectedChunk.id));
        assert.equal(citation.excerpt, matchedExpectedChunk.content);
        assert.equal(citationUrl.searchParams.get('v'), externalId);
        assert.equal(citationUrl.searchParams.get('t'), `${matchedExpectedChunk.start_seconds}s`);
        assert.equal(citation.startSeconds, matchedExpectedChunk.start_seconds);
        assert.equal(citation.endSeconds, matchedExpectedChunk.end_seconds);
      }

      const recallAtK = expectedHitsAtK / RETRIEVAL_EVALUATION.cases.length;
      assert.ok(
        recallAtK >= RETRIEVAL_EVALUATION.minimumRecallAtK,
        `Retrieval recall@${RETRIEVAL_EVALUATION.topK} was ${recallAtK.toFixed(2)}; expected at least ${RETRIEVAL_EVALUATION.minimumRecallAtK}.`,
      );

      // Model a legacy source upgraded from before migration 005: it has the
      // completed retrieval chunks but no canonical transcript row.
      await pool.query('DELETE FROM source_transcripts WHERE source_id = $1', [sourceId]);

      // Preparing that legacy transcript uses the existing job row while
      // keeping the already-ready source and its old evidence usable.
      assert.deepEqual(await jobs.requestTranscriptRefresh(sourceId), { status: 'QUEUED' });
      const refreshLease = await jobs.claimNextIngestionJob('transcript-refresh-worker-a', 90_000);
      assert.ok(refreshLease);
      assert.equal(refreshLease.operation, 'TRANSCRIPT_REFRESH');
      assert.equal((await sources.findSourceById(sourceId))?.status, 'READY');
      const oldChunksDuringRefresh = await pool.query<{ content: string }>(
        'SELECT content FROM source_chunks WHERE source_id = $1 ORDER BY chunk_index',
        [sourceId],
      );
      assert.equal(oldChunksDuringRefresh.rows.length, 4);

      assert.equal(
        await jobs.failIngestionJob(refreshLease.id, refreshLease.leaseToken, {
          code: 'TEST_REFRESH_UNAVAILABLE',
          message: 'Caption provider is temporarily unavailable.',
          retryable: true,
        }),
        true,
      );
      assert.equal((await sources.findSourceById(sourceId))?.status, 'READY');
      const failedRefreshMetadata = await pool.query<{
        status: string;
        failure_code: string;
        failure_retryable: boolean;
        segment_count: number;
      }>(
        'SELECT status, failure_code, failure_retryable, segment_count FROM source_transcripts WHERE source_id = $1',
        [sourceId],
      );
      assert.deepEqual(failedRefreshMetadata.rows[0], {
        status: 'FAILED',
        failure_code: 'TEST_REFRESH_UNAVAILABLE',
        failure_retryable: true,
        segment_count: 0,
      });
      assert.equal(
        (await pool.query('SELECT COUNT(*) FROM source_transcript_segments WHERE source_id = $1', [sourceId])).rows[0]?.count,
        0,
        'a failed legacy refresh does not fabricate transcript segments',
      );
      const oldChunksAfterFailure = await pool.query<{ content: string }>(
        'SELECT content FROM source_chunks WHERE source_id = $1 ORDER BY chunk_index',
        [sourceId],
      );
      assert.equal(oldChunksAfterFailure.rows.length, 4, 'a failed refresh preserves the existing Q&A index');

      // Concurrent retry requests serialize on the job row. Only the first
      // request resets the failed job and increments retry_count.
      const priorRetryCount = (await pool.query<{ retry_count: number }>(
        'SELECT retry_count FROM ingestion_jobs WHERE source_id = $1',
        [sourceId],
      )).rows[0]?.retry_count;
      assert.ok(priorRetryCount !== undefined);
      const concurrentRefreshRetries = await Promise.all([
        jobs.requestTranscriptRefresh(sourceId),
        jobs.requestTranscriptRefresh(sourceId),
      ]);
      assert.deepEqual(concurrentRefreshRetries, [{ status: 'QUEUED' }, { status: 'QUEUED' }]);
      const queuedRefresh = await pool.query<{
        operation: string;
        status: string;
        retry_count: number;
        attempt_count: number;
      }>(
        'SELECT operation, status, retry_count, attempt_count FROM ingestion_jobs WHERE source_id = $1',
        [sourceId],
      );
      assert.deepEqual(queuedRefresh.rows[0], {
        operation: 'TRANSCRIPT_REFRESH',
        status: 'QUEUED',
        retry_count: priorRetryCount + 1,
        attempt_count: 0,
      });

      const retriedRefreshLease = await jobs.claimNextIngestionJob('transcript-refresh-worker-b', 90_000);
      assert.ok(retriedRefreshLease);
      assert.equal(retriedRefreshLease.operation, 'TRANSCRIPT_REFRESH');
      assert.equal(retriedRefreshLease.attemptCount, 1);
      await jobs.completeIngestionJob(retriedRefreshLease.id, retriedRefreshLease.leaseToken, [
        {
          sourceId,
          chunkIndex: 0,
          content: 'replacement transcript describes a resilient local evidence workspace',
          startSeconds: 120,
          endSeconds: 136,
        },
      ], [
        { text: 'The refreshed transcript preserves source timestamps.', start: 120, duration: 8, lang: 'en' },
        { text: 'The workspace searches evidence locally and seeks to cited moments.', start: 128, duration: 8, lang: 'en' },
      ], 'en');

      assert.equal((await sources.findSourceById(sourceId))?.status, 'READY');
      const refreshedTranscript = await pool.query<{ status: string; segment_count: number }>(
        'SELECT status, segment_count FROM source_transcripts WHERE source_id = $1',
        [sourceId],
      );
      assert.deepEqual(refreshedTranscript.rows[0], { status: 'READY', segment_count: 2 });
      const refreshedSegments = await pool.query<{ segment_index: number; start_seconds: number; text: string }>(
        'SELECT segment_index, start_seconds, text FROM source_transcript_segments WHERE source_id = $1 ORDER BY segment_index',
        [sourceId],
      );
      assert.deepEqual(refreshedSegments.rows, [
        { segment_index: 0, start_seconds: 120, text: 'The refreshed transcript preserves source timestamps.' },
        { segment_index: 1, start_seconds: 128, text: 'The workspace searches evidence locally and seeks to cited moments.' },
      ]);
      const refreshedChunks = await pool.query<{ content: string }>(
        'SELECT content FROM source_chunks WHERE source_id = $1 ORDER BY chunk_index',
        [sourceId],
      );
      assert.deepEqual(refreshedChunks.rows, [
        { content: 'replacement transcript describes a resilient local evidence workspace' },
      ]);

      const unrelatedExternalId = `unrelated-${randomUUID()}`;
      const unrelatedSource = await transaction.withTransaction((client) =>
        sources.createOrGetSourceWithClient(client, {
          type: 'youtube',
          externalId: unrelatedExternalId,
          canonicalUrl: `https://www.youtube.com/watch?v=${unrelatedExternalId}`,
          maxAttempts: 3,
        }),
      );
      unrelatedSourceIdForCleanup = unrelatedSource.source.id;
      await pool.query(
        `
          INSERT INTO source_chunks (source_id, chunk_index, content, start_seconds, end_seconds, embedding)
          VALUES ($1, 0, 'unique unrelated retrieval phrase', 1, 2, NULL)
        `,
        [unrelatedSourceIdForCleanup],
      );
      assert.deepEqual(
        await retrieval.searchSourceChunksByText(sourceId, 'unique unrelated phrase', 5),
        [],
        'full-text retrieval must stay scoped to the selected source',
      );

      // The chat repository claims a durable user/assistant pair before model
      // inference. Mark this isolated source ready to exercise that contract.
      await pool.query(
        `
          UPDATE sources
          SET processing_status = 'READY', processing_phase = NULL
          WHERE id = $1
        `,
        [sourceId],
      );

      const firstTurnId = randomUUID();
      const beginSameTurn = () =>
        conversations.beginAnswerTurn({
          sourceId,
          turnId: firstTurnId,
          question: 'What is the main idea?',
          leaseDurationMs: 90_000,
        });
      const duplicateTurnRequests = await Promise.all([beginSameTurn(), beginSameTurn()]);
      const firstClaim = duplicateTurnRequests.find((result) => result?.kind === 'claimed');

      assert.ok(firstClaim && firstClaim.kind === 'claimed');
      assert.deepEqual(duplicateTurnRequests.map((result) => result?.kind).sort(), [
        'claimed',
        'in_progress',
      ]);

      const citation = {
        id: 'chunk-0',
        startSeconds: 15,
        endSeconds: 22,
        excerpt: 'The speaker introduces the main idea.',
        href: 'https://www.youtube.com/watch?v=integration&t=15',
      };
      assert.equal(
        await conversations.completeAnswerTurn({
          messageId: firstClaim.assistantMessageId,
          leaseToken: firstClaim.leaseToken,
          answer: 'The source is about its main idea.',
          citations: [citation],
          providerId: 'gemini',
          modelId: 'gemini-test-model',
        }),
        true,
      );

      const replayedTurn = await beginSameTurn();
      assert.equal(replayedTurn?.kind, 'completed');
      if (replayedTurn?.kind === 'completed') {
        assert.equal(replayedTurn.answer, 'The source is about its main idea.');
        assert.deepEqual(replayedTurn.citations, [citation]);
        assert.equal(replayedTurn.providerId, 'gemini');
        assert.equal(replayedTurn.modelId, 'gemini-test-model');
      }
      await assert.rejects(
        conversations.beginAnswerTurn({
          sourceId,
          turnId: firstTurnId,
          question: 'A different question with the same key',
          leaseDurationMs: 90_000,
        }),
        (error: unknown) =>
          error instanceof Error && 'code' in error && error.code === 'IDEMPOTENCY_KEY_REUSED',
      );

      const retryTurnId = randomUUID();
      const failedAttempt = await conversations.beginAnswerTurn({
        sourceId,
        turnId: retryTurnId,
        question: 'Explain the second idea.',
        leaseDurationMs: 90_000,
      });
      assert.ok(failedAttempt?.kind === 'claimed');
      assert.equal(
        await conversations.failAnswerTurn({
          messageId: failedAttempt.assistantMessageId,
          leaseToken: failedAttempt.leaseToken,
          failure: {
            code: 'OLLAMA_UNAVAILABLE',
            message: 'Local model service is unavailable.',
            retryable: true,
          },
        }),
        true,
      );

      const retryClaim = await conversations.beginAnswerTurn({
        sourceId,
        turnId: retryTurnId,
        question: 'Explain the second idea.',
        leaseDurationMs: 90_000,
      });
      assert.ok(retryClaim?.kind === 'claimed');
      assert.notEqual(retryClaim.leaseToken, failedAttempt.leaseToken);
      assert.equal(
        await conversations.completeAnswerTurn({
          messageId: retryClaim.assistantMessageId,
          leaseToken: retryClaim.leaseToken,
          answer: 'A retried answer.',
          citations: [],
        }),
        true,
      );

      const retryableFailureTurnId = randomUUID();
      const retryableFailure = await conversations.beginAnswerTurn({
        sourceId,
        turnId: retryableFailureTurnId,
        question: 'A question that will fail.',
        leaseDurationMs: 90_000,
      });
      assert.ok(retryableFailure?.kind === 'claimed');
      await pool.query(
        "UPDATE messages SET generation_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1",
        [retryableFailure.assistantMessageId],
      );

      const recoveredChatLease = await conversations.beginAnswerTurn({
        sourceId,
        turnId: retryableFailureTurnId,
        question: 'A question that will fail.',
        leaseDurationMs: 90_000,
      });
      assert.ok(recoveredChatLease?.kind === 'claimed');
      assert.notEqual(recoveredChatLease.leaseToken, retryableFailure.leaseToken);
      assert.equal(
        await conversations.completeAnswerTurn({
          messageId: retryableFailure.assistantMessageId,
          leaseToken: retryableFailure.leaseToken,
          answer: 'A stale answer must not overwrite the owner.',
          citations: [],
        }),
        false,
      );
      assert.equal(
        await conversations.completeAnswerTurn({
          messageId: recoveredChatLease.assistantMessageId,
          leaseToken: recoveredChatLease.leaseToken,
          answer: 'The recovered answer.',
          citations: [],
        }),
        true,
      );

      const nonRetryableTurnId = randomUUID();
      const nonRetryableClaim = await conversations.beginAnswerTurn({
        sourceId,
        turnId: nonRetryableTurnId,
        question: 'A non-retryable request.',
        leaseDurationMs: 90_000,
      });
      assert.ok(nonRetryableClaim?.kind === 'claimed');
      await conversations.failAnswerTurn({
        messageId: nonRetryableClaim.assistantMessageId,
        leaseToken: nonRetryableClaim.leaseToken,
        failure: {
          code: 'INVALID_REQUEST',
          message: 'This request cannot be retried.',
          retryable: false,
        },
      });
      await assert.rejects(
        conversations.beginAnswerTurn({
          sourceId,
          turnId: nonRetryableTurnId,
          question: 'A non-retryable request.',
          leaseDurationMs: 90_000,
        }),
        (error: unknown) =>
          error instanceof Error && 'code' in error && error.code === 'ANSWER_RETRY_NOT_ALLOWED',
      );

      const storedConversation = await conversations.getConversationForSource(sourceId);
      assert.equal(storedConversation?.messages.length, 8);
      assert.equal(
        storedConversation?.messages.filter((message) => message.role === 'user').length,
        4,
      );
      assert.equal(
        storedConversation?.messages.filter((message) => message.role === 'assistant').length,
        4,
      );
      assert.equal(
        storedConversation?.messages.find(
          (message) => message.turnId === firstTurnId && message.role === 'assistant',
        )?.providerId,
        'gemini',
      );
      assert.equal(
        storedConversation?.messages.find(
          (message) => message.turnId === firstTurnId && message.role === 'assistant',
        )?.modelId,
        'gemini-test-model',
      );
      const conversationRecord = await pool.query<{ id: number }>(
        'SELECT id FROM conversations WHERE source_id = $1',
        [sourceId],
      );
      const conversationId = conversationRecord.rows[0]?.id;
      assert.ok(conversationId);

      const deletionRaceTurnId = randomUUID();
      const deletionRaceClaim = await conversations.beginAnswerTurn({
        sourceId,
        turnId: deletionRaceTurnId,
        question: 'Complete while the source is being removed.',
        leaseDurationMs: 90_000,
      });
      assert.ok(deletionRaceClaim?.kind === 'claimed');

      const [completionDuringDelete, deletionResult] = await Promise.all([
        conversations.completeAnswerTurn({
          messageId: deletionRaceClaim.assistantMessageId,
          leaseToken: deletionRaceClaim.leaseToken,
          answer: 'This answer may commit before the cascade.',
          citations: [],
        }),
        sources.deleteSource(sourceId),
      ]);
      assert.equal(typeof completionDuringDelete, 'boolean');
      assert.equal(deletionResult, true);
      sourceIdForCleanup = null;
      const deletedConversation = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::TEXT AS count FROM conversations WHERE source_id = $1',
        [sourceId],
      );
      assert.equal(
        deletedConversation.rows[0]?.count,
        '0',
        'deleting a source must cascade its conversation',
      );
      const deletedMessages = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::TEXT AS count FROM messages WHERE conversation_id = $1',
        [conversationId],
      );
      assert.equal(
        deletedMessages.rows[0]?.count,
        '0',
        'deleting a conversation must cascade its messages',
      );
    } finally {
      if (sourceIdForCleanup !== null) {
        await sources.deleteSource(sourceIdForCleanup);
      }
      if (unrelatedSourceIdForCleanup !== null) {
        await sources.deleteSource(unrelatedSourceIdForCleanup);
      }
      await aiSettingsRepository.setActiveProvider(originalActiveProvider);
      if (originalOpenAiConfig) {
        await aiSettingsRepository.saveProviderConfig(originalOpenAiConfig);
      } else {
        await pool.query("DELETE FROM ai_provider_configs WHERE provider_id = 'openai'");
      }
    }
  },
);
