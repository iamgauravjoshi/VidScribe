import ollama from "ollama";

const EMBEDDING_MODEL = "nomic-embed-text";

export async function generateEmbedding(text: string) {
  const response = await ollama.embed({
    model: EMBEDDING_MODEL,
    input: text
  });
  
  return response.embeddings[0];
}