import { Download, FileText, LoaderCircle, RotateCw, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  downloadSourceTranscript,
  getSourceTranscript,
  requestSourceTranscriptRefresh,
} from '../services/api';
import type { SourceTranscript, TranscriptSegment } from '../types/types';
import { YouTubePlayer } from './YouTubePlayer';

interface Props {
  sourceId: number;
  videoId: string;
  title: string;
  canonicalUrl: string;
  citationRequest: { seconds: number; requestId: number } | null;
}

const PAGE_SIZE = 100;

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

function pageMessage(transcript: SourceTranscript): string {
  if (transcript.status === 'PROCESSING') return 'Preparing the transcript for this saved source…';
  if (transcript.status === 'FAILED') return transcript.failure?.message ?? 'The transcript could not be prepared.';
  return 'This saved source predates transcript storage. Prepare its transcript to browse and export it.';
}

export default function TranscriptPanel({ sourceId, videoId, title, canonicalUrl, citationRequest }: Props) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [aroundSeconds, setAroundSeconds] = useState<number | null>(null);
  const [seekRequest, setSeekRequest] = useState<{ seconds: number; requestId: number } | null>(null);
  const [transcript, setTranscript] = useState<SourceTranscript | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const requestSequence = useRef(0);
  const transcriptSegmentsRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void getSourceTranscript(sourceId, {
      limit: PAGE_SIZE,
      query: debouncedQuery || undefined,
      aroundSeconds: aroundSeconds ?? undefined,
      signal: controller.signal,
    })
      .then((result) => {
        if (!active) return;
        setTranscript(result);
        setSegments(result.segments);
        setNextCursor(result.nextCursor);
        if (aroundSeconds !== null && result.segments.length > 0) {
          const nearest = result.segments.reduce((best, segment) =>
            Math.abs(segment.startSeconds - aroundSeconds) < Math.abs(best.startSeconds - aroundSeconds)
              ? segment
              : best,
          );
          setActiveSegmentIndex(nearest.segmentIndex);
        }
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Transcript could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [aroundSeconds, debouncedQuery, reloadKey, sourceId]);

  useEffect(() => {
    if (transcript?.status !== 'PROCESSING') return;
    const timer = window.setTimeout(() => setReloadKey((value) => value + 1), 1800);
    return () => window.clearTimeout(timer);
  }, [reloadKey, transcript?.status]);

  useEffect(() => {
    if (!citationRequest) return;
    // A citation is a navigation event from the sibling conversation panel.
    // Reset this panel's search before requesting transcript context near it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery('');
    setDebouncedQuery('');
    setAroundSeconds(citationRequest.seconds);
    setSeekRequest(citationRequest);
    setLoading(true);
    setError(null);
  }, [citationRequest]);

  useEffect(() => {
    if (activeSegmentIndex === null) return;
    const container = transcriptSegmentsRef.current;
    const segment = segmentRefs.current.get(activeSegmentIndex);
    if (!container || !segment) return;

    const containerBounds = container.getBoundingClientRect();
    const segmentBounds = segment.getBoundingClientRect();
    const inset = 8;
    const segmentIsOutside = segmentBounds.top < containerBounds.top + inset
      || segmentBounds.bottom > containerBounds.bottom - inset;

    if (!segmentIsOutside) return;

    const segmentCenter = (segmentBounds.top + segmentBounds.bottom) / 2;
    const containerCenter = (containerBounds.top + containerBounds.bottom) / 2;
    container.scrollTo({
      top: container.scrollTop + segmentCenter - containerCenter,
      behavior: 'smooth',
    });
  }, [activeSegmentIndex, citationRequest, segments]);

  const seekTo = (segment: TranscriptSegment) => {
    requestSequence.current += 1;
    setActiveSegmentIndex(segment.segmentIndex);
    setSeekRequest({ seconds: segment.startSeconds, requestId: requestSequence.current });
  };

  const handleLoadMore = async () => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    setError(null);

    try {
      const result = await getSourceTranscript(sourceId, {
        limit: PAGE_SIZE,
        cursor: nextCursor,
        query: debouncedQuery || undefined,
      });
      setTranscript(result);
      setSegments((current) => [...current, ...result.segments]);
      setNextCursor(result.nextCursor);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : 'More transcript segments could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      await requestSourceTranscriptRefresh(sourceId);
      setReloadKey((value) => value + 1);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : 'Transcript preparation could not be started.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleDownload = async (format: 'txt' | 'srt' | 'vtt') => {
    setDownloadError(null);
    try {
      const blob = await downloadSourceTranscript(sourceId, format);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `vidscribe-source-${sourceId}-transcript.${format}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (requestError: unknown) {
      setDownloadError(requestError instanceof Error ? requestError.message : 'Transcript export failed.');
    }
  };

  const canReadTranscript = transcript?.status === 'READY';

  return (
    <div className="source-evidence-column">
      <YouTubePlayer
        canonicalUrl={canonicalUrl}
        seekRequest={seekRequest}
        title={title}
        videoId={videoId}
      />

      <section aria-labelledby="transcript-heading" className="transcript-panel panel">
        <header className="transcript-heading">
          <div>
            <div className="eyebrow">SOURCE TEXT</div>
            <h2 id="transcript-heading">Transcript</h2>
            {canReadTranscript && (
              <p>{transcript.segmentCount.toLocaleString()} caption moments · English captions · Stored on this computer</p>
            )}
          </div>
          {canReadTranscript && (
            <div aria-label="Download transcript" className="transcript-downloads">
              {(['txt', 'srt', 'vtt'] as const).map((format) => (
                <button className="button button-quiet transcript-download" key={format} onClick={() => void handleDownload(format)} type="button">
                  <Download aria-hidden="true" />
                  {format.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </header>

        {canReadTranscript ? (
          <>
            <label className="transcript-search">
              <Search aria-hidden="true" />
              <span className="sr-only">Search transcript</span>
              <input
                onChange={(event) => {
                  setQuery(event.target.value);
                  setAroundSeconds(null);
                  setLoading(true);
                  setError(null);
                  setSegments([]);
                  setNextCursor(null);
                  setActiveSegmentIndex(null);
                }}
                placeholder="Find a phrase in this video"
                type="search"
                value={query}
              />
            </label>

            {error && <p className="transcript-inline-error" role="alert">{error}</p>}
            {downloadError && <p className="transcript-inline-error" role="alert">{downloadError}</p>}

            {loading && segments.length === 0 ? (
              <div className="transcript-loading" role="status">
                <LoaderCircle aria-hidden="true" /> Loading transcript…
              </div>
            ) : segments.length > 0 ? (
              <div aria-label="Transcript segments" className="transcript-segments" aria-busy={loading} ref={transcriptSegmentsRef}>
                {segments.map((segment) => (
                  <div
                    className={`transcript-segment${activeSegmentIndex === segment.segmentIndex ? ' transcript-segment-active' : ''}`}
                    key={segment.segmentIndex}
                    ref={(element) => {
                      if (element) {
                        segmentRefs.current.set(segment.segmentIndex, element);
                      } else {
                        segmentRefs.current.delete(segment.segmentIndex);
                      }
                    }}
                  >
                    <button
                      aria-label={`Play from ${formatTimestamp(segment.startSeconds)}`}
                      className="transcript-timestamp"
                      onClick={() => seekTo(segment)}
                      type="button"
                    >
                      {formatTimestamp(segment.startSeconds)}
                    </button>
                    <p>{segment.text}</p>
                  </div>
                ))}
                {nextCursor !== null && (
                  <button className="button button-secondary transcript-more" disabled={loading || loadingMore} onClick={() => void handleLoadMore()} type="button">
                    {loadingMore ? <><LoaderCircle aria-hidden="true" /> Loading…</> : 'Load more transcript'}
                  </button>
                )}
              </div>
            ) : loading ? (
              <div className="transcript-loading" role="status">
                <LoaderCircle aria-hidden="true" /> Searching transcript…
              </div>
            ) : (
              <div className="transcript-empty">
                <FileText aria-hidden="true" />
                <p>{debouncedQuery ? 'No transcript moments match that search.' : 'No transcript moments are available.'}</p>
              </div>
            )}
          </>
        ) : (
          <div className="transcript-state" role={transcript?.status === 'FAILED' ? 'alert' : 'status'}>
            {transcript?.status === 'PROCESSING' ? <LoaderCircle aria-hidden="true" /> : <FileText aria-hidden="true" />}
            <div>
              <p>{transcript ? pageMessage(transcript) : 'Loading transcript status…'}</p>
              {transcript?.status !== 'PROCESSING'
                && transcript?.status !== 'READY'
                && !(transcript?.status === 'FAILED' && !transcript.failure?.retryable) && (
                <button className="button button-secondary" disabled={refreshing} onClick={() => void handleRefresh()} type="button">
                  {refreshing ? <><LoaderCircle aria-hidden="true" /> Preparing…</> : <><RotateCw aria-hidden="true" /> Prepare transcript</>}
                </button>
              )}
              {error && !transcript && (
                <button className="text-button" onClick={() => setReloadKey((value) => value + 1)} type="button">
                  Retry loading transcript status
                </button>
              )}
              {transcript?.status === 'PROCESSING' && <span className="transcript-state-note">You can keep using this source while it runs.</span>}
            </div>
            {error && <p className="transcript-inline-error">{error}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
