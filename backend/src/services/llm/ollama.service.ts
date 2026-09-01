import ollama from "ollama";

export async function generateAnswer(prompt: string) {
  const response = await ollama.chat({
    model: "qwen3:4b",
    stream: false,
    think: 'low',
    messages: [
      {
        role: "user",
        content: prompt
      }
    ]
  });

  // return response.message.content;
  return response;
}