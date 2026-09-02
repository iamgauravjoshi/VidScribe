import ollama from "ollama";

export async function generateAnswer(prompt: string) {
  console.log("Ollama: Sending request...");
  const start = Date.now();

  const response = await ollama.chat({
    model: "qwen3:4b",
    // model: "gemma3:1b",
    stream: false,
    // think: 'low',
    messages: [
      {
        role: "user",
        content: prompt
      }
    ]
  });

  const duration = Date.now() - start;

  console.log(`Ollama: Response received in ${duration}ms`);

  // return response.message.content;
  return response;
}