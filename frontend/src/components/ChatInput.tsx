import { useState } from 'react';

interface Props {
  onSend: (message: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: Props) {
  const [message, setMessage] = useState('');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (!message.trim()) {
      return;
    }

    onSend(message.trim());
    setMessage('');
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Ask about the video..."
        disabled={disabled}
      />

      <button type="submit" disabled={disabled || !message.trim()}>
        Send
      </button>
    </form>
  );
}
