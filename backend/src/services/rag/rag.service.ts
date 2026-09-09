// Implementing the actual RAG query

import { generateEmbedding } from '../embeddings/embedding.service.js';
import { searchSimilarChunks } from '../vector/vector.service.js';
import { generateAnswer } from '../llm/ollama.service.js';
import { config } from '../../shared/config/index.js';
import { RetrievedChunkRow } from '../../types/chunk.type.js';
import { logger } from '../../shared/logger/logger.js';

export async function answerQuestion(videoId: number, question: string) {
  // 1. Convert question into vector
  const queryEmbedding = await generateEmbedding(question);

  // 2. Search relevant transcript chunks
  const chunks = await searchSimilarChunks(videoId, queryEmbedding, config.rag.topK);

  // 3. Build context
  const relevantChunks = chunks.filter(
    (chunk) => chunk.similarity >= config.rag.similarityThreshold,
  );

  logger.info('RAG retrieval completed', {
    videoId,
    candidateCount: chunks.length,
    relevantCount: relevantChunks.length,
    topK: config.rag.topK,
    similarityThreshold: config.rag.similarityThreshold,
    scores: chunks.map((chunk) => ({
      chunkId: chunk.id,
      similarity: chunk.similarity,
    })),
  });

  if (relevantChunks.length === 0) {
    return {
      answer: "I couldn't find enough relevant information in the video to answer that question.",
      sources: [],
    };
  }

  // 4. Build prompt
  const prompt = buildPrompt(question, relevantChunks);

  // 5. Ask LLM
  const answer = await generateAnswer(prompt);

  return {
    answer,
    sources: relevantChunks,
  };
}

function buildPrompt(question: String, relevantChunks: RetrievedChunkRow[]) {
  const context = relevantChunks
    .map(
      (chunk: any, index: number) =>
        `
            SOURCE ${index + 1}
            Timestamp: ${chunk.start_time_seconds} - ${chunk.end_time_seconds}
            Content: ${chunk.content}
        `,
    )
    .join('\n');

  const prompt = `
    You are an AI assistant that answers questions
    about a YouTube video.

    Use the provided video context to answer the question.

    IMPORTANT RULES:
    1. Answer using the provided context.
    2. Do not invent information.
    3. If the answer is not present in the provided context,
      say that the video does not provide enough
      information to answer the question.
    4. Explain the answer clearly.

    VIDEO CONTEXT: ${context}
    USER QUESTION: ${question}
  `;

  return prompt;
}
