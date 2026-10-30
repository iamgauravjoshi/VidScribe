import { useState } from 'react';

interface Props {
  onSend: (message: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: Props) {
  const [message, setMessage] = useState('');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = message.trim();

    if (!question || disabled) return;

    onSend(question);
    setMessage('');
  };

  return (
    <form className="chat-composer" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="question-input">Ask about this video</label>
      <input
        autoComplete="off"
        id="question-input"
        maxLength={2000}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Ask about this video…"
        value={message}
        disabled={disabled}
      />
      <button
        aria-label="Send question"
        className="send-button"
        disabled={disabled || !message.trim()}
        type="submit"
      >
        <span aria-hidden="true">↑</span>
      </button>
    </form>
  );
}
