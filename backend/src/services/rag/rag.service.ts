// Implementing the actual RAG query

import { searchSourceChunksByText } from '../../repositories/retrieval.repository.js';
import { mapRetrievedChunk } from './citation.service.js';
import { generateAnswer } from '../llm/llm.service.js';
import { config } from '../../shared/config/index.js';
import type { RetrievedChunkRow } from '../../types/chunk.type.js';
import { logger } from '../../shared/logger/logger.js';
import type { AnswerResult } from '../../types/chat.type.js';
import type { RequestTraceContext } from '../../types/observability.type.js';

export async function answerQuestion(
  trace: RequestTraceContext,
  question: string,
): Promise<AnswerResult> {
  const retrievalStartedAt = Date.now();
  let relevantChunks: RetrievedChunkRow[];

  try {
    relevantChunks = await searchSourceChunksByText(trace.sourceId, question, config.rag.topK);
  } catch (error: unknown) {
    logger.error('RAG retrieval failed', {
      ...trace,
      retrieval: 'postgres_full_text',
      durationMs: Date.now() - retrievalStartedAt,
      errorCode: 'RETRIEVAL_FAILED',
    });
    throw error;
  }

  logger.info('RAG retrieval completed', {
    ...trace,
    retrieval: 'postgres_full_text',
    durationMs: Date.now() - retrievalStartedAt,
    candidateCount: relevantChunks.length,
    relevantCount: relevantChunks.length,
    topK: config.rag.topK,
    scores: relevantChunks.map((chunk) => ({
      chunkId: chunk.id,
      relevanceScore: chunk.relevanceScore,
    })),
  });

  if (relevantChunks.length === 0) {
    return {
      answer: "I couldn't find enough relevant information in the video to answer that question.",
      citations: [],
      providerId: null,
      modelId: null,
    };
  }

  // 4. Build prompt
  const prompt = buildPrompt(question, relevantChunks);

  // 5. Ask LLM
  const generation = await generateAnswer(prompt, trace);

  return {
    answer: generation.text,
    citations: relevantChunks.map(mapRetrievedChunk),
    providerId: generation.provider,
    modelId: generation.modelId,
  };
}

function buildPrompt(question: string, relevantChunks: RetrievedChunkRow[]) {
  const context = relevantChunks
    .map(
      (chunk, index) =>
        `
            SOURCE ${index + 1}
            Timestamp: ${chunk.start_seconds} - ${chunk.end_seconds}
            Content: ${chunk.content}
        `,
    )
    .join('\n');

  const prompt = `
    You are an AI assistant that answers questions
    about the provided source transcript.

    Use only the provided transcript excerpts to answer the question.

    IMPORTANT RULES:
    1. Answer using the provided context.
    2. Do not invent information.
    3. If the answer is not present in the provided context,
      say that the video does not provide enough
      information to answer the question.
    4. Explain the answer clearly.

    SOURCE TRANSCRIPT EXCERPTS: ${context}
    USER QUESTION: ${question}
  `;

  return prompt;
}
