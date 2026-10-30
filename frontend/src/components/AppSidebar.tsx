import type { Source } from '../types/types';
import { SourceStatusBadge } from './SourceStatusBadge';

interface Props {
  sources: Source[];
  selectedSourceId: number | null;
  currentPath: string;
  onNavigate: (path: string) => void;
  onAddSource: () => void;
  isOpen: boolean;
  onClose: () => void;
}

function sourceLabel(source: Source): string {
  return source.title?.trim() || `YouTube video · ${source.externalId}`;
}

export function AppSidebar({
  sources,
  selectedSourceId,
  currentPath,
  onNavigate,
  onAddSource,
  isOpen,
  onClose,
}: Props) {
  const libraryActive =
    currentPath === '/' || currentPath === '/library' || currentPath === '/library/';

  return (
    <aside className={`sidebar${isOpen ? ' sidebar-open' : ''}`}>
      <button className="brand-lockup" onClick={() => onNavigate('/library')} type="button">
        <span className="brand-mark" aria-hidden="true">
          V
        </span>
        <span>VidScribe</span>
      </button>
      <button
        aria-label="Close navigation"
        className="icon-button sidebar-mobile-close"
        onClick={onClose}
        type="button"
      >
        ×
      </button>

      <button className="button button-primary sidebar-add" onClick={onAddSource} type="button">
        <span aria-hidden="true">+</span>
        Add a video
      </button>

      <nav aria-label="Main navigation" className="sidebar-nav">
        <button
          className={`nav-item${libraryActive ? ' nav-item-active' : ''}`}
          onClick={() => onNavigate('/library')}
          type="button"
        >
          <span className="nav-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3.5 4.5h13v11h-13zM7 4.5v11M9.5 8h4M9.5 11h4" />
            </svg>
          </span>
          Library
          <span className="nav-count">{sources.length}</span>
        </button>
        <button
          className={`nav-item${currentPath.startsWith('/settings/') ? ' nav-item-active' : ''}`}
          onClick={() => onNavigate('/settings/ai')}
          type="button"
        >
          <span className="nav-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="10" cy="10" r="2.5" />
              <path d="M10 2.8v2M10 15.2v2M17.2 10h-2M4.8 10h-2m12.3-5.1-1.4 1.4M6.3 13.7l-1.4 1.4m10.2 0-1.4-1.4M6.3 6.3 4.9 4.9" />
            </svg>
          </span>
          Settings
        </button>
      </nav>

      <div className="sidebar-section-label">YOUR SOURCES</div>
      <nav aria-label="Your sources" className="source-nav">
        {sources.length === 0 ? (
          <p className="sidebar-empty">Videos you add will appear here.</p>
        ) : (
          sources.map((source) => (
            <button
              className={`source-nav-item${source.id === selectedSourceId ? ' source-nav-item-active' : ''}`}
              key={source.id}
              onClick={() => onNavigate(`/sources/${source.id}`)}
              title={sourceLabel(source)}
              type="button"
            >
              <span className="source-nav-title">{sourceLabel(source)}</span>
              <SourceStatusBadge compact status={source.status} />
            </button>
          ))
        )}
      </nav>

      <div className="sidebar-footer">
        <span className="local-indicator" aria-hidden="true" />
        Private local library
      </div>
    </aside>
  );
}
