import type { ChatMessage } from '../types/types';

interface Props {
  messages: ChatMessage[];
  onRetry: (turnId: string) => void;
}

function formatTimestamp(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'Open source';

  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

function canResume(message: ChatMessage): boolean {
  if (message.status !== 'PENDING') return false;
  if (!message.generationExpiresAt) return false;

  const expiry = Date.parse(message.generationExpiresAt);
  return Number.isFinite(expiry) && expiry <= Date.now();
}

function providerLabel(providerId: ChatMessage['providerId']): string | null {
  if (!providerId) return null;
  return { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude', ollama: 'Ollama' }[providerId];
}

export function ChatWindow({ messages, onRetry }: Props) {
  return (
    <div aria-live="polite" aria-relevant="additions text" className="chat-messages">
      {messages.length === 0 && (
        <div className="chat-welcome">
          <div className="assistant-avatar" aria-hidden="true">V</div>
          <h3>What would you like to understand?</h3>
          <p>Ask a question about this video&apos;s transcript. Answers include links to the source moments.</p>
          <div className="prompt-suggestions" aria-label="Suggested questions">
            <span>What is the main idea?</span>
            <span>What are the key takeaways?</span>
          </div>
        </div>
      )}

      {messages.map((message) => {
        const resumable = message.role === 'assistant' && canResume(message);
        const retryable = message.role === 'assistant' && message.status === 'FAILED' && message.failure?.retryable;
        const showEvidence = message.role === 'assistant' && message.status === 'COMPLETED';

        return (
          <article
            className={`chat-message chat-message-${message.role}${message.status === 'FAILED' ? ' chat-message-failed' : ''}`}
            key={message.id}
          >
            <div className="message-avatar" aria-hidden="true">
              {message.role === 'user' ? 'Y' : 'V'}
            </div>
            <div className="message-body">
              <div className="message-author">{message.role === 'user' ? 'You' : 'VidScribe'}</div>
              {message.role === 'assistant' && showEvidence && message.providerId && message.modelId && (
                <div className="message-model">{providerLabel(message.providerId)} · {message.modelId}</div>
              )}

              {message.role === 'assistant' && message.status === 'PENDING' ? (
                <div className="message-pending" role="status">
                  <span className="spinner spinner-small" aria-hidden="true" />
                  {resumable ? 'This answer can be resumed.' : 'Finding relevant moments and writing an answer…'}
                </div>
              ) : (
                <p className={message.status === 'FAILED' ? 'message-error' : undefined}>
                  {message.status === 'FAILED'
                    ? message.failure?.message ?? 'The answer could not be generated.'
                    : message.content}
                </p>
              )}

              {showEvidence && message.citations.length === 0 && (
                <div className="no-evidence-note">
                  No matching moments were found in this transcript. Try asking about a specific idea or section.
                </div>
              )}

              {showEvidence && message.citations.length > 0 && (
                <div className="citation-list">
                  <div className="citation-heading">Source moments</div>
                  {message.citations.map((citation, index) => (
                    <a
                      className="citation-card"
                      href={citation.href}
                      key={`${message.id}-${citation.id}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span className="citation-number">{index + 1}</span>
                      <span className="citation-content">
                        <span className="citation-time">
                          {formatTimestamp(citation.startSeconds)}
                          <span aria-hidden="true"> ↗</span>
                        </span>
                        <span className="citation-excerpt">{citation.excerpt}</span>
                      </span>
                    </a>
                  ))}
                </div>
              )}

              {(retryable || resumable) && (
                <button className="text-button retry-answer" onClick={() => onRetry(message.turnId)} type="button">
                  {resumable ? 'Resume answer' : 'Try this answer again'}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
