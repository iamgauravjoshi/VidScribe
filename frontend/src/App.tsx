import { useState } from "react";

import { VideoInput } from "./components/VideoInput";
import { ChatWindow } from "./components/ChatWindow";
import { ChatInput } from "./components/ChatInput";

import { processVideo, askQuestion } from "./services/api";

import type { ChatMessage } from "./types/types.ts";

function App() {
  const [videoId, setVideoId] = useState<number | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [processing, setProcessing] = useState(false);

  const [asking, setAsking] = useState(false);

  const handleProcess = async (url: string) => {
    try {
      setProcessing(true);

      const result = await processVideo(url);

      setVideoId(result.databaseId);

      setMessages([]);
    } catch (error) {
      console.error(error);
      alert("Failed to process video");
    } finally {
      setProcessing(false);
    }
  };

  const handleSend = async (message: string) => {
    if (!videoId) {
      return;
    }

    setMessages((previous) => [
      ...previous,
      {
        role: "user",
        content: message
      }
    ]);

    try {
      setAsking(true);

      const result = await askQuestion(videoId, message);
      
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: result.answer.message.content
        }
      ]);

    } catch (error) {
      console.error(error);

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: "Sorry, I couldn't answer that."
        }
      ]);
    } finally {
      setAsking(false);
    }
  };

  function formatTimestamp(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60);
  
    return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
  }

  return (
    <main>
      <h1>YouTube RAG Assistant</h1>

      <VideoInput onProcess={handleProcess} loading={processing} />

      {videoId && (
        <>
          <ChatWindow messages={messages} videoId={videoId} />

          <ChatInput onSend={handleSend} disabled={asking} />
        </>
      )}
    </main>
  );
}

export default App;