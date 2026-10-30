import type { Source } from '../types/types';
import { SourceStatusBadge } from './SourceStatusBadge';

interface Props {
  sources: Source[];
  loading: boolean;
  error: string | null;
  onAddSource: () => void;
  onOpenSource: (sourceId: number) => void;
  onRetryLoad: () => void;
}

function sourceLabel(source: Source): string {
  return source.title?.trim() || `YouTube video · ${source.externalId}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function LibraryPage({
  sources,
  loading,
  error,
  onAddSource,
  onOpenSource,
  onRetryLoad,
}: Props) {
  return (
    <section className="page library-page">
      <header className="page-heading">
        <div>
          <div className="eyebrow">RESEARCH LIBRARY</div>
          <h1>Your library</h1>
          <p>Keep the ideas you want to understand and come back to.</p>
        </div>
        {sources.length > 0 && (
          <button className="button button-primary" onClick={onAddSource} type="button">
            <span aria-hidden="true">+</span>
            Add a video
          </button>
        )}
      </header>

      {loading ? (
        <div className="panel loading-panel" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>Loading your library…</span>
        </div>
      ) : error ? (
        <div className="panel error-panel" role="alert">
          <div className="state-icon state-icon-error" aria-hidden="true">
            !
          </div>
          <div>
            <h2>We couldn't load your library</h2>
            <p>{error}</p>
            <button className="button button-secondary" onClick={onRetryLoad} type="button">
              Try again
            </button>
          </div>
        </div>
      ) : sources.length === 0 ? (
        <div className="empty-library panel">
          <div className="eyebrow">START WITH A SOURCE</div>
          <h2>Keep the useful parts close.</h2>
          <p>
            Add an educational YouTube video, then ask questions and jump straight to the moments
            that support the answer.
          </p>
          <button
            className="button button-primary button-large"
            onClick={onAddSource}
            type="button"
          >
            <span aria-hidden="true">+</span>
            Add your first video
          </button>
          <div className="support-note">Public YouTube videos with English captions</div>
        </div>
      ) : (
        <div className="library-list" aria-label="Saved sources">
          <div className="library-list-heading" aria-hidden="true">
            <span>Source</span>
            <span>Status</span>
            <span>Added</span>
            <span />
          </div>
          {sources.map((source) => (
            <button
              className="source-row"
              key={source.id}
              onClick={() => onOpenSource(source.id)}
              type="button"
            >
              <span className="source-row-main">
                <span className="source-type-mark" aria-hidden="true">
                  YT
                </span>
                <span className="source-row-copy">
                  <strong>{sourceLabel(source)}</strong>
                  <small>{source.canonicalUrl}</small>
                </span>
              </span>
              <span className="source-row-status">
                <SourceStatusBadge status={source.status} />
              </span>
              <span className="source-row-date">{formatDate(source.createdAt)}</span>
              <span className="source-card-open">
                Open <span aria-hidden="true">→</span>
              </span>
              {source.status === 'FAILED' && source.failure && (
                <span className="source-card-error">{source.failure.message}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
