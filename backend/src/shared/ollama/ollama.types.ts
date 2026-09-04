export interface OllamaChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: false;
  options?: {
    num_predict?: number;
  };
}

export interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
  };
}

export interface OllamaEmbedRequest {
  model: string;
  input: string;
}

export interface OllamaEmbedResponse {
  embeddings: number[][];
}
