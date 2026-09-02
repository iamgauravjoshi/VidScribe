// Implementing the actual RAG query

import { generateEmbedding } from "../embeddings/embedding.service.js";
import { searchSimilarChunks } from "../vector/vector.service.js";
import { generateAnswer } from "../llm/ollama.service.js";

export async function answerQuestion(
  videoId: number,
  question: string
) {
  console.time("queryEmbedding");
  // 1. Convert question into vector
  const queryEmbedding = await generateEmbedding(question);

  console.timeEnd("queryEmbedding");
  console.time("vectorSearch");

  // 2. Search relevant transcript chunks
  const chunks = await searchSimilarChunks(videoId, queryEmbedding, 3);

  console.timeEnd("vectorSearch");

  // 3. Build context
  const context = chunks
    .map(
      (chunk: any, index: number) =>
        `
            SOURCE ${index + 1}
            Timestamp: ${chunk.start_time_seconds} - ${chunk.end_time_seconds}
            Content: ${chunk.content}
        `
    )
    .join("\n");

  // 4. Build prompt
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

  console.time("llm");
  
  // 5. Ask LLM
  const answer = await generateAnswer(prompt);

  console.timeEnd("llm");

  console.log("answer: ", answer);
  

  return {
    answer,
    sources: chunks
  };
}