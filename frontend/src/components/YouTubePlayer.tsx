import { useEffect, useRef, useState } from 'react';

interface YouTubePlayerInstance {
  destroy: () => void;
  getIframe: () => HTMLIFrameElement;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
}

interface YouTubePlayerEvent {
  target: YouTubePlayerInstance;
}

interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: (event: YouTubePlayerEvent) => void;
        onError: (event: { data: number }) => void;
      };
    },
  ) => YouTubePlayerInstance;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<void>((resolve, reject) => {
    const scriptUrl = 'https://www.youtube.com/iframe_api';
    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${scriptUrl}"]`);
    const timeoutId = window.setTimeout(() => {
      youtubeApiPromise = null;
      reject(new Error('The YouTube player did not finish loading.'));
    }, 15_000);
    const previousReadyCallback = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeoutId);
      previousReadyCallback?.();
      resolve();
    };

    if (!existingScript) {
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeoutId);
        youtubeApiPromise = null;
        reject(new Error('The YouTube player could not be loaded.'));
      };
      document.head.append(script);
    }
  });

  return youtubeApiPromise;
}

interface Props {
  videoId: string;
  title: string;
  canonicalUrl: string;
  seekRequest: { seconds: number; requestId: number } | null;
}

export function YouTubePlayer({ videoId, title, canonicalUrl, seekRequest }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const [loadRequested, setLoadRequested] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const playerRequested = loadRequested || seekRequest !== null;

  useEffect(() => {
    if (!playerRequested) return;

    let active = true;
    let player: YouTubePlayerInstance | null = null;
    pendingSeekRef.current = null;

    void loadYouTubeApi()
      .then(() => {
        if (!active || !mountRef.current || !window.YT?.Player) return;

        setPlayerReady(false);
        setPlayerError(null);
        player = new window.YT.Player(mountRef.current, {
          videoId,
          playerVars: {
            enablejsapi: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0,
          },
          events: {
            onReady: (event) => {
              if (!active) return;
              playerRef.current = event.target;
              setPlayerReady(true);
              event.target.getIframe().setAttribute('title', `${title} video player`);
              if (pendingSeekRef.current !== null) {
                event.target.seekTo(pendingSeekRef.current, true);
                pendingSeekRef.current = null;
              }
            },
            onError: () => {
              if (!active) return;
              setPlayerError('This video cannot be played in the embedded player.');
            },
          },
        });
      })
      .catch(() => {
        if (active) setPlayerError('The YouTube player could not be loaded.');
      });

    return () => {
      active = false;
      playerRef.current = null;
      player?.destroy();
    };
  }, [playerRequested, title, videoId]);

  useEffect(() => {
    if (!seekRequest) return;

    if (playerReady && playerRef.current) {
      playerRef.current.seekTo(seekRequest.seconds, true);
    } else {
      pendingSeekRef.current = seekRequest.seconds;
    }
  }, [playerReady, seekRequest]);

  return (
    <section aria-label="Source video player" className="evidence-player panel">
      <div className="youtube-player-frame">
        {!playerRequested && (
          <button className="youtube-player-launch" onClick={() => setLoadRequested(true)} type="button">
            <span className="youtube-player-play" aria-hidden="true">▶</span>
            <span>Load video player</span>
            <small>Connecting to YouTube will load the video here.</small>
          </button>
        )}
        {playerRequested && <div className="youtube-player-mount" ref={mountRef} />}
        {playerRequested && !playerReady && !playerError && (
          <div className="youtube-player-loading" role="status">
            <span className="spinner spinner-small" aria-hidden="true" />
            Loading YouTube player…
          </div>
        )}
        {playerError && (
          <div className="youtube-player-error" role="status">
            <p>{playerError}</p>
            <a className="button button-secondary" href={canonicalUrl} rel="noreferrer" target="_blank">
              Open on YouTube <span aria-hidden="true">↗</span>
            </a>
          </div>
        )}
      </div>
      <div className="evidence-video-caption">
        <div className="eyebrow">SOURCE VIDEO</div>
        <h2>{title}</h2>
        <div className="evidence-video-actions">
          <a className="text-button" href={canonicalUrl} rel="noreferrer" target="_blank">
            Open on YouTube <span aria-hidden="true">↗</span>
          </a>
          <span>Playback is provided by YouTube.</span>
        </div>
      </div>
    </section>
  );
}
