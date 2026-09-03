import { useState } from 'react';

interface Props {
  onProcess: (url: string) => void;
  loading: boolean;
}

export function VideoInput({ onProcess, loading }: Props) {
  const [url, setUrl] = useState('');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (!url.trim()) {
      return;
    }

    onProcess(url.trim());
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="Paste YouTube URL"
      />

      <button type="submit" disabled={loading}>
        {loading ? 'Processing...' : 'Process Video'}
      </button>
    </form>
  );
}
