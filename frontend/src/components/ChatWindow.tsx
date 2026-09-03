import type { ChatMessage } from '../types/types.ts';

interface Props {
  messages: ChatMessage[];
  videoId: Number;
  timestamp?: String;
}

export function ChatWindow({ messages, videoId }: Props) {
  return (
    <div>
      {messages.map((message, index) => (
        <div key={index}>
          <strong>{message.role === 'user' ? 'You' : 'AI'}</strong>

          <p>{message.content}</p>
          {/* <p>Sources:</p>
            <a 
              href={`https://www.youtube.com/watch?v=${videoId}&t=${timestamp}s`}
              target="_blank"
              rel="noreferrer"
            >
              ▶ {timestamp}
            </a> */}
        </div>
      ))}
    </div>
  );
}
