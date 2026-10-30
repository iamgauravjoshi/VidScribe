import { useEffect, useState } from 'react';

import { ChatInput } from './ChatInput';
import { ChatWindow } from './ChatWindow';
import { SourceStatusBadge } from './SourceStatusBadge';
import {
  ApiError,
  askQuestion,
  deleteSource,
  getSource,
  getSourceConversation,
  retrySource,
} from '../services/api';
import type { ChatMessage, IngestionPhase, Source } from '../types/types';

interface Props {
  sourceId: number;
  activeProviderLabel: string;
  activeProviderConfigured: boolean;
  providerStatusError: boolean;
  providerStatusKnown: boolean;
  onOpenAiSettings: () => void;
  onBack: () => void;
  onSourceChanged: (source: Source) => void;
  onSourceRemoved: (sourceId: number) => void;
}

const PHASES: { id: IngestionPhase; title: string; description: string }[] = [
  {
    id: 'FETCHING_TRANSCRIPT',
    title: 'Getting captions',
    description: 'Checking the video for English captions.',
  },
  {
    id: 'CHUNKING',
    title: 'Preparing transcript',
    description: 'Organizing the transcript into searchable moments.',
  },
  {
    id: 'INDEXING',
    title: 'Indexing transcript',
    description: 'Building a local full-text index for transcript search.',
  },
  {
    id: 'PERSISTING',
    title: 'Saving to your library',
    description: 'Committing the source and its searchable moments.',
  },
];

function displayTitle(source: Source): string {
  return source.title?.trim() || `YouTube video · ${source.externalId}`;
}

function toMessageId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function mergeConversationMessages(persisted: ChatMessage[], current: ChatMessage[]): ChatMessage[] {
  const persistedTurnIds = new Set(persisted.map((message) => message.turnId));
  const unpersisted = current.filter((message) => !persistedTurnIds.has(message.turnId));

  return [...persisted, ...unpersisted];
}

function statusCopy(source: Source): { title: string; description: string } {
  if (source.status === 'QUEUED') {
    return {
      title: 'Waiting to process',
      description: 'This source is saved. Processing will begin shortly.',
    };
  }

  const phase = PHASES.find((item) => item.id === source.phase);

  return phase
    ? { title: phase.title, description: phase.description }
    : { title: 'Processing your source', description: 'You can leave this page and return while it finishes.' };
}

function formatAddedDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

export function SourceWorkspace({
  sourceId,
  activeProviderLabel,
  activeProviderConfigured,
  providerStatusError,
  providerStatusKnown,
  onOpenAiSettings,
  onBack,
  onSourceChanged,
  onSourceRemoved,
}: Props) {
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pollKey, setPollKey] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationLoading, setConversationLoading] = useState(true);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [conversationPollKey, setConversationPollKey] = useState(0);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const refresh = async () => {
      try {
        const current = await getSource(sourceId);
        if (!active) return;

        setSource(current);
        setLoadError(null);
        setLoading(false);
        onSourceChanged(current);

        if (current.status === 'QUEUED' || current.status === 'PROCESSING') {
          timer = window.setTimeout(refresh, 1800);
        }
      } catch (error: unknown) {
        if (!active) return;
        const sourceWasRemoved = error instanceof ApiError && error.status === 404;
        setLoadError(sourceWasRemoved
          ? 'This source no longer exists in your library.'
          : 'VidScribe could not refresh this source. It will try again shortly.');
        setLoading(false);
        if (!sourceWasRemoved) timer = window.setTimeout(refresh, 5000);
      }
    };

    timer = window.setTimeout(() => void refresh(), 0);

    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [sourceId, pollKey, onSourceChanged]);

  useEffect(() => {
    if (source?.status !== 'READY') return;

    let active = true;
    let timer: number | undefined;

    const refreshConversation = async () => {
      try {
        const conversation = await getSourceConversation(sourceId);
        if (!active) return;

        setMessages((previous) => mergeConversationMessages(conversation.messages, previous));
        setConversationError(null);
        setConversationLoading(false);

        if (conversation.messages.some((message) => message.role === 'assistant' && message.status === 'PENDING')) {
          timer = window.setTimeout(refreshConversation, 1800);
        }
      } catch {
        if (!active) return;

        setConversationError('Saved conversation could not be loaded. Check the database connection and try again.');
        setConversationLoading(false);
        timer = window.setTimeout(refreshConversation, 5000);
      }
    };

    timer = window.setTimeout(() => void refreshConversation(), 0);

    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [source?.status, sourceId, conversationPollKey]);

  const handleRetry = async () => {
    setRetrying(true);

    try {
      const updated = await retrySource(sourceId);
      setSource(updated);
      setLoadError(null);
      onSourceChanged(updated);
      setPollKey((value) => value + 1);
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'The source could not be retried.');
    } finally {
      setRetrying(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);

    try {
      await deleteSource(sourceId);
      onSourceRemoved(sourceId);
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'The source could not be removed.');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const submitQuestion = async (question: string, existingTurnId?: string) => {
    if (!source || source.status !== 'READY' || activeTurnId || !providerStatusKnown || !activeProviderConfigured) return;

    const turnId = existingTurnId ?? toMessageId();
    const now = new Date().toISOString();
    const userExists = messages.some((message) => message.turnId === turnId && message.role === 'user');

    setMessages((previous) => {
      if (!userExists) {
        return [
          ...previous,
          {
            id: `local-user-${turnId}`,
            turnId,
            role: 'user',
            status: 'COMPLETED',
            content: question,
            citations: [],
            providerId: null,
            modelId: null,
            failure: null,
            generationAttemptCount: 0,
            generationExpiresAt: null,
            createdAt: now,
            updatedAt: now,
            finishedAt: now,
          },
          {
            id: `local-assistant-${turnId}`,
            turnId,
            role: 'assistant',
            status: 'PENDING',
            content: '',
            citations: [],
            providerId: null,
            modelId: null,
            failure: null,
            generationAttemptCount: 0,
            generationExpiresAt: null,
            createdAt: now,
            updatedAt: now,
            finishedAt: null,
          },
        ];
      }

      return previous.map((message) => message.turnId === turnId && message.role === 'assistant'
        ? {
            ...message,
            status: 'PENDING',
            content: '',
            citations: [],
            providerId: null,
            modelId: null,
            failure: null,
            generationExpiresAt: null,
            updatedAt: now,
            finishedAt: null,
          }
        : message);
    });

    setConversationError(null);
    setActiveTurnId(turnId);

    try {
      const result = await askQuestion(sourceId, question, turnId);

      const completedTurn = result.turn;
      if (completedTurn.status === 'COMPLETED') {
        const completedAt = new Date().toISOString();
        setMessages((previous) => previous.map((message) => {
          if (message.turnId !== turnId) return message;
          if (message.role === 'user') return message;

          return {
            ...message,
            status: 'COMPLETED',
            content: completedTurn.answer,
            citations: completedTurn.citations,
            providerId: completedTurn.providerId,
            modelId: completedTurn.modelId,
            failure: null,
            generationExpiresAt: null,
            updatedAt: completedAt,
            finishedAt: completedAt,
          };
        }));
      }

      setConversationPollKey((value) => value + 1);
    } catch {
      try {
        const conversation = await getSourceConversation(sourceId);
        const persistedTurn = conversation.messages.some((message) => message.turnId === turnId);

        if (persistedTurn) {
          setMessages((previous) => mergeConversationMessages(conversation.messages, previous));
          setConversationError(null);
        } else {
          setMessages((previous) => mergeConversationMessages(conversation.messages, previous.map((message) => message.turnId === turnId && message.role === 'assistant'
            ? { ...message, generationExpiresAt: new Date(0).toISOString() }
            : message)));
          setConversationError('The answer status could not be confirmed. Resume the same turn safely to check or continue it.');
        }
      } catch {
        setMessages((previous) => mergeConversationMessages([], previous.map((message) => message.turnId === turnId && message.role === 'assistant'
          ? { ...message, generationExpiresAt: new Date(0).toISOString() }
          : message)));
        setConversationError('The answer status could not be confirmed. Resume the same turn safely to check or continue it.');
      }

      setConversationPollKey((value) => value + 1);
    } finally {
      setActiveTurnId(null);
    }
  };

  const retryQuestion = (turnId: string) => {
    if (activeTurnId) return;

    const userMessage = messages.find((message) => message.turnId === turnId && message.role === 'user');
    const assistantMessage = messages.find((message) => message.turnId === turnId && message.role === 'assistant');
    if (!userMessage || !assistantMessage) return;

    const resumable = assistantMessage.status === 'PENDING'
      && assistantMessage.generationExpiresAt !== null
      && Date.parse(assistantMessage.generationExpiresAt) <= Date.now();
    const retryable = assistantMessage.status === 'FAILED' && assistantMessage.failure?.retryable;

    if (resumable || retryable) void submitQuestion(userMessage.content, turnId);
  };

  if (loading && !source) {
    return (
      <section className="page source-loading" role="status">
        <span className="spinner" aria-hidden="true" />
        Loading source…
      </section>
    );
  }

  if (!source) {
    return (
      <section className="page">
        <button className="text-button back-link" onClick={onBack} type="button">← Back to library</button>
        <div className="panel error-panel" role="alert">
          <div className="state-icon state-icon-error" aria-hidden="true">!</div>
          <div>
            <h2>Source unavailable</h2>
            <p>{loadError ?? 'This source could not be loaded.'}</p>
            <button className="button button-secondary" onClick={() => setPollKey((value) => value + 1)} type="button">
              Try again
            </button>
          </div>
        </div>
      </section>
    );
  }

  const title = displayTitle(source);
  const answerPending = messages.some((message) => message.role === 'assistant' && message.status === 'PENDING');
  const composerDisabled = conversationLoading || activeTurnId !== null || answerPending || !providerStatusKnown || providerStatusError || !activeProviderConfigured;

  return (
    <section className="page source-page">
      <div className="source-breadcrumb-row">
        <button className="text-button back-link" onClick={onBack} type="button">← Library</button>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">{title}</span>
      </div>

      <header className="source-header">
        <div className="source-heading-copy">
          <div className="source-eyebrow"><span className="source-type-mark" aria-hidden="true">YT</span> YOUTUBE SOURCE</div>
          <h1>{title}</h1>
          <div className="source-meta-line">
            <SourceStatusBadge status={source.status} />
            <span>Added {formatAddedDate(source.createdAt)}</span>
            {source.status === 'PROCESSING' && source.phase && <span className="phase-copy">{statusCopy(source).title}</span>}
          </div>
        </div>
        <div className="source-header-actions">
          <a className="button button-secondary" href={source.canonicalUrl} rel="noreferrer" target="_blank">
            Open on YouTube <span aria-hidden="true">↗</span>
          </a>
          <button className="button button-quiet" onClick={() => setConfirmDelete(true)} type="button">
            Remove
          </button>
        </div>
      </header>

      {loadError && source && (
        <div className="inline-notice" role="status">
          <span>{loadError}</span>
          <button className="text-button" onClick={() => setPollKey((value) => value + 1)} type="button">Refresh</button>
        </div>
      )}

      {(source.status === 'QUEUED' || source.status === 'PROCESSING') && (
        <div className="processing-layout">
          <div className="processing-main panel">
            <div className="processing-icon"><span className="spinner" aria-hidden="true" /></div>
            <div className="eyebrow">SOURCE PROCESSING</div>
            <h2>{statusCopy(source).title}</h2>
            <p>{statusCopy(source).description}</p>
            <div aria-label="Processing stages" className="processing-steps">
              {PHASES.map((phase, index) => {
                const activeIndex = source.phase ? PHASES.findIndex((item) => item.id === source.phase) : -1;
                const done = source.status === 'PROCESSING' && index < activeIndex;
                const active = phase.id === source.phase;

                return (
                  <div className={`processing-step${done ? ' processing-step-done' : ''}${active ? ' processing-step-active' : ''}`} key={phase.id}>
                    <span className="step-marker" aria-hidden="true">{done ? '✓' : index + 1}</span>
                    <span>{phase.title}</span>
                  </div>
                );
              })}
            </div>
            <div className="processing-footnote">You can leave this page. Your source will stay in the library.</div>
          </div>
          <aside className="source-preview-card panel">
            <div className="preview-play" aria-hidden="true">▶</div>
            <div className="eyebrow">SOURCE VIDEO</div>
            <h3>{title}</h3>
            <p>We’re preparing its transcript for source-grounded questions.</p>
            <a href={source.canonicalUrl} rel="noreferrer" target="_blank">Open video in a new tab ↗</a>
          </aside>
        </div>
      )}

      {source.status === 'FAILED' && (
        <div className="failed-layout">
          <div className="failed-main panel" role="alert">
            <div className="state-icon state-icon-error" aria-hidden="true">!</div>
            <div className="eyebrow">PROCESSING STOPPED</div>
            <h2>This video isn’t ready yet</h2>
            <p>{source.failure?.message ?? 'VidScribe couldn’t process this source.'}</p>
            {source.failure?.retryable ? (
              <button className="button button-primary" disabled={retrying} onClick={() => void handleRetry()} type="button">
                {retrying ? <><span className="spinner spinner-small" aria-hidden="true" /> Queuing retry…</> : 'Retry processing'}
              </button>
            ) : (
              <div className="failure-guidance">Check that the video is public and has English captions. You can remove this source or try another video.</div>
            )}
            <button className="text-button" onClick={onBack} type="button">Back to library</button>
          </div>
          <aside className="source-preview-card panel">
            <div className="preview-play" aria-hidden="true">▶</div>
            <div className="eyebrow">SOURCE VIDEO</div>
            <h3>{title}</h3>
            <a href={source.canonicalUrl} rel="noreferrer" target="_blank">Open video in a new tab ↗</a>
          </aside>
        </div>
      )}

      {source.status === 'READY' && (
        <div className="ready-layout">
          <aside className="ready-source-panel">
            <div className="video-preview panel">
              <div className="video-preview-art" aria-hidden="true">
                <span className="video-play">▶</span>
              </div>
              <div className="video-preview-copy">
                <div className="eyebrow">SOURCE VIDEO</div>
                <h2>{title}</h2>
                <p>Transcript indexed and ready for questions.</p>
                <a className="button button-secondary" href={source.canonicalUrl} rel="noreferrer" target="_blank">
                  Watch on YouTube <span aria-hidden="true">↗</span>
                </a>
              </div>
            </div>
            <div className="local-note">
              <span aria-hidden="true">✦</span>
              Answers are grounded in this video’s transcript.
            </div>
          </aside>

          <section aria-label="Questions about this video" className="conversation-panel panel">
            {conversationError && (
              <div className="inline-notice" role="alert">
                <span>{conversationError}</span>
                <button className="text-button" onClick={() => setConversationPollKey((value) => value + 1)} type="button">
                  Refresh
                </button>
              </div>
            )}
            <header className="conversation-heading">
              <div>
                <div className="eyebrow">SOURCE Q&amp;A</div>
                <h2>Ask this video</h2>
              </div>
              <span className="conversation-model-mark" title={`Answer provider: ${activeProviderLabel}`}>{activeProviderLabel}</span>
            </header>
            {conversationLoading ? (
              <div className="conversation-loading" role="status">
                <span className="spinner spinner-small" aria-hidden="true" />
                Loading saved conversation…
              </div>
            ) : (
              <ChatWindow messages={messages} onRetry={retryQuestion} />
            )}
            <ChatInput disabled={composerDisabled} onSend={(question) => void submitQuestion(question)} />
            <div className="conversation-notice">
              {answerPending
                ? 'This answer is saved and will continue updating here.'
                : !providerStatusKnown
                  ? 'Checking AI provider settings…'
                  : providerStatusError
                    ? 'AI provider configuration is unavailable. Check the dependency banner and try again.'
                    : !activeProviderConfigured
                      ? <>{activeProviderLabel} needs an API key before VidScribe can answer. <button className="text-button" onClick={onOpenAiSettings} type="button">Configure AI</button></>
                      : 'Conversation saved with this source.'}
            </div>
          </section>
        </div>
      )}

      {confirmDelete && (
        <div className="confirm-backdrop">
          <section aria-labelledby="remove-source-title" aria-modal="true" className="confirm-dialog panel" role="alertdialog">
            <div className="eyebrow">REMOVE SOURCE</div>
            <h2 id="remove-source-title">Remove this video from your library?</h2>
            <p>The source and its indexed transcript will be deleted from this local library.</p>
            <div className="dialog-actions">
              <button className="button button-secondary" disabled={deleting} onClick={() => setConfirmDelete(false)} type="button">Cancel</button>
              <button className="button button-danger" disabled={deleting} onClick={() => void handleDelete()} type="button">
                {deleting ? 'Removing…' : 'Remove source'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
