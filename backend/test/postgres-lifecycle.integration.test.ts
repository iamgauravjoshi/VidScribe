import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

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

    const [database, migrations, transaction, sources, jobs, conversations, aiSettingsRepository, aiSettingsService] = await Promise.all([
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

    const { pool } = database;
    closePool = () => pool.end();
    await migrations.runMigrations();

    const existing = await pool.query<{ count: string }>('SELECT COUNT(*)::TEXT AS count FROM sources');
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
      assert.equal(initialAiSettings.providers.find((provider) => provider.id === 'gemini')?.modelId, 'gemini-3.8-flash');
      await assert.rejects(
        aiSettingsService.chooseActiveProvider('openai'),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'AI_PROVIDER_NOT_CONFIGURED',
      );

      await aiSettingsRepository.saveProviderConfig({
        providerId: 'openai',
        modelId: 'integration-model',
        apiKeyCiphertext: 'encrypted-test-only-ciphertext',
      });
      const selectedAiSettings = await aiSettingsService.chooseActiveProvider('openai');
      const selectedOpenAi = selectedAiSettings.providers.find((provider) => provider.id === 'openai');
      assert.equal(selectedAiSettings.activeProvider, 'openai');
      assert.equal(selectedOpenAi?.configured, true);
      assert.equal('apiKey' in (selectedOpenAi ?? {}), false, 'API keys must never be returned in settings DTOs');
      assert.equal('apiKeyCiphertext' in (selectedOpenAi ?? {}), false, 'ciphertext must never be returned in settings DTOs');

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
        'UPDATE ingestion_jobs SET lease_expires_at = NOW() - INTERVAL \'1 second\' WHERE id = $1',
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
          {
            sourceId,
            chunkIndex: 0,
            content: 'duplicate chunk index should fail',
            embedding: null,
            startSeconds: 1,
            endSeconds: 2,
          },
        ]),
      );

      const preservedChunk = await pool.query<{ content: string }>(
        'SELECT content FROM source_chunks WHERE source_id = $1 ORDER BY chunk_index',
        [sourceId],
      );
      const preservedSource = await sources.findSourceById(sourceId);

      assert.deepEqual(preservedChunk.rows.map((row) => row.content), ['previous committed index']);
      assert.equal(preservedSource?.status, 'PROCESSING');

      await jobs.completeIngestionJob(recoveredLease.id, recoveredLease.leaseToken, [
        {
          sourceId,
          chunkIndex: 0,
          content: 'PostgreSQL full text search keeps transcript text local while ranking matching passages.',
          startSeconds: 12,
          endSeconds: 24,
        },
      ]);

      const indexedWithoutVectors = await pool.query<{ content: string; embedding: number[] | null }>(
        'SELECT content, embedding FROM source_chunks WHERE source_id = $1',
        [sourceId],
      );
      assert.equal(indexedWithoutVectors.rows.length, 1);
      assert.equal(indexedWithoutVectors.rows[0]?.embedding, null);

      const matchingChunks = await retrieval.searchSourceChunksByText(
        sourceId,
        'How does PostgreSQL rank matching passages?',
        5,
      );
      assert.equal(matchingChunks.length, 1);
      assert.ok((matchingChunks[0]?.relevanceScore ?? 0) > 0);
      assert.equal(matchingChunks[0]?.start_seconds, 12);
      assert.deepEqual(
        await retrieval.searchSourceChunksByText(sourceId, 'the and or', 5),
        [],
        'a query with no searchable English terms returns no evidence',
      );

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
      const beginSameTurn = () => conversations.beginAnswerTurn({
        sourceId,
        turnId: firstTurnId,
        question: 'What is the main idea?',
        leaseDurationMs: 90_000,
      });
      const duplicateTurnRequests = await Promise.all([beginSameTurn(), beginSameTurn()]);
      const firstClaim = duplicateTurnRequests.find((result) => result?.kind === 'claimed');

      assert.ok(firstClaim && firstClaim.kind === 'claimed');
      assert.deepEqual(
        duplicateTurnRequests.map((result) => result?.kind).sort(),
        ['claimed', 'in_progress'],
      );

      const citation = {
        id: 'chunk-0',
        startSeconds: 15,
        endSeconds: 22,
        excerpt: 'The speaker introduces the main idea.',
        href: 'https://www.youtube.com/watch?v=integration&t=15',
      };
      assert.equal(await conversations.completeAnswerTurn({
        messageId: firstClaim.assistantMessageId,
        leaseToken: firstClaim.leaseToken,
        answer: 'The source is about its main idea.',
        citations: [citation],
        providerId: 'gemini',
        modelId: 'gemini-test-model',
      }), true);

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
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'IDEMPOTENCY_KEY_REUSED',
      );

      const retryTurnId = randomUUID();
      const failedAttempt = await conversations.beginAnswerTurn({
        sourceId,
        turnId: retryTurnId,
        question: 'Explain the second idea.',
        leaseDurationMs: 90_000,
      });
      assert.ok(failedAttempt?.kind === 'claimed');
      assert.equal(await conversations.failAnswerTurn({
        messageId: failedAttempt.assistantMessageId,
        leaseToken: failedAttempt.leaseToken,
        failure: { code: 'OLLAMA_UNAVAILABLE', message: 'Local model service is unavailable.', retryable: true },
      }), true);

      const retryClaim = await conversations.beginAnswerTurn({
        sourceId,
        turnId: retryTurnId,
        question: 'Explain the second idea.',
        leaseDurationMs: 90_000,
      });
      assert.ok(retryClaim?.kind === 'claimed');
      assert.notEqual(retryClaim.leaseToken, failedAttempt.leaseToken);
      assert.equal(await conversations.completeAnswerTurn({
        messageId: retryClaim.assistantMessageId,
        leaseToken: retryClaim.leaseToken,
        answer: 'A retried answer.',
        citations: [],
      }), true);

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
      assert.equal(await conversations.completeAnswerTurn({
        messageId: retryableFailure.assistantMessageId,
        leaseToken: retryableFailure.leaseToken,
        answer: 'A stale answer must not overwrite the owner.',
        citations: [],
      }), false);
      assert.equal(await conversations.completeAnswerTurn({
        messageId: recoveredChatLease.assistantMessageId,
        leaseToken: recoveredChatLease.leaseToken,
        answer: 'The recovered answer.',
        citations: [],
      }), true);

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
        failure: { code: 'INVALID_REQUEST', message: 'This request cannot be retried.', retryable: false },
      });
      await assert.rejects(
        conversations.beginAnswerTurn({
          sourceId,
          turnId: nonRetryableTurnId,
          question: 'A non-retryable request.',
          leaseDurationMs: 90_000,
        }),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ANSWER_RETRY_NOT_ALLOWED',
      );

      const storedConversation = await conversations.getConversationForSource(sourceId);
      assert.equal(storedConversation?.messages.length, 8);
      assert.equal(storedConversation?.messages.filter((message) => message.role === 'user').length, 4);
      assert.equal(storedConversation?.messages.filter((message) => message.role === 'assistant').length, 4);
      assert.equal(
        storedConversation?.messages.find((message) => message.turnId === firstTurnId && message.role === 'assistant')?.providerId,
        'gemini',
      );
      assert.equal(
        storedConversation?.messages.find((message) => message.turnId === firstTurnId && message.role === 'assistant')?.modelId,
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
      assert.equal(deletedConversation.rows[0]?.count, '0', 'deleting a source must cascade its conversation');
      const deletedMessages = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::TEXT AS count FROM messages WHERE conversation_id = $1',
        [conversationId],
      );
      assert.equal(deletedMessages.rows[0]?.count, '0', 'deleting a conversation must cascade its messages');
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
