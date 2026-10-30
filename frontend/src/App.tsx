import { useCallback, useEffect, useState } from 'react';

import { AddSourceDialog } from './components/AddSourceDialog';
import { AiSettingsPage } from './components/AiSettingsPage';
import { AppSidebar } from './components/AppSidebar';
import { LibraryPage } from './components/LibraryPage';
import { SourceWorkspace } from './components/SourceWorkspace';
import { ThemeSwitch } from './components/ThemeSwitch';
import { ApiError, getApplicationHealth, getSources } from './services/api';
import type { ApplicationHealth, Source, ThemeMode } from './types/types';
import './App.css';

function usePathname(): [string, (path: string) => void] {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setPathname(path);
  }, []);

  return [pathname, navigate];
}

function sourceIdFromPath(pathname: string): number | null {
  const match = pathname.match(/^\/sources\/(\d+)\/?$/);
  if (!match) return null;

  const sourceId = Number(match[1]);
  return Number.isSafeInteger(sourceId) && sourceId > 0 ? sourceId : null;
}

function getInitialTheme(): ThemeMode {
  try {
    return window.localStorage.getItem('vidscribe.theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function App() {
  const [pathname, navigate] = usePathname();
  const sourceId = sourceIdFromPath(pathname);
  const isLibrary = pathname === '/' || pathname === '/library' || pathname === '/library/';
  const isSettings = pathname === '/settings/ai' || pathname === '/settings/appearance';
  const settingsSection = pathname === '/settings/appearance' ? 'appearance' : 'ai';
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [sources, setSources] = useState<Source[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [health, setHealth] = useState<ApplicationHealth | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColorMeta) {
      themeColorMeta.content = getComputedStyle(document.documentElement)
        .getPropertyValue('--bg')
        .trim();
    }
    try {
      window.localStorage.setItem('vidscribe.theme', theme);
    } catch {
      // The theme still applies for this session when browser storage is unavailable.
    }
  }, [theme]);

  const refreshSources = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError(null);

    try {
      setSources(await getSources());
    } catch (error: unknown) {
      setLibraryError(
        error instanceof ApiError && error.status === 0
          ? 'Check that VidScribe’s API and database are running.'
          : 'The API could not load saved sources. Please try again.',
      );
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    setCheckingHealth(true);
    try {
      setHealth(await getApplicationHealth());
      setHealthError(false);
    } catch {
      setHealthError(true);
    } finally {
      setCheckingHealth(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshSources();
      void refreshHealth();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [refreshSources, refreshHealth]);

  const handleSourceChanged = useCallback((source: Source) => {
    setSources((previous) => {
      const exists = previous.some((item) => item.id === source.id);
      return exists
        ? previous.map((item) => (item.id === source.id ? source : item))
        : [source, ...previous];
    });
  }, []);

  const handleSourceRemoved = useCallback(
    (removedId: number) => {
      setSources((previous) => previous.filter((source) => source.id !== removedId));
      navigate('/library');
    },
    [navigate],
  );

  const handleSourceAdded = (source: Source) => {
    handleSourceChanged(source);
    setAddDialogOpen(false);
    navigate(`/sources/${source.id}`);
  };

  const answerProviderUnconfigured = health?.services.generation.status === 'not_configured';
  const generationStatusError = health?.services.generation.status === 'error';
  const databaseUnavailable = health?.services.database.status === 'error';
  const providerLabels = {
    gemini: 'Gemini',
    openai: 'OpenAI',
    anthropic: 'Claude',
    ollama: 'Ollama',
  } as const;
  const activeProviderLabel = health
    ? providerLabels[health.services.generation.providerId]
    : 'Gemini';
  const activeProviderConfigured = health?.services.generation.status === 'configured';
  const providerStatusKnown = health !== null;
  const providerStatusError = health?.services.generation.status === 'error';
  const dependencyMessage = databaseUnavailable
    ? 'The local database is unavailable. Saved sources may not load.'
    : answerProviderUnconfigured
      ? `${activeProviderLabel} is selected for answers but has no API key yet. Configure it to ask questions.`
      : generationStatusError
        ? 'The selected AI provider settings could not be loaded. Check the database migration and try again.'
        : 'VidScribe could not check local services.';

  return (
    <div className="app-shell">
      <AppSidebar
        currentPath={pathname}
        isOpen={mobileNavOpen}
        onAddSource={() => {
          setMobileNavOpen(false);
          setAddDialogOpen(true);
        }}
        onClose={() => setMobileNavOpen(false)}
        onNavigate={(path) => {
          navigate(path);
          setMobileNavOpen(false);
        }}
        selectedSourceId={sourceId}
        sources={sources}
      />

      <main className="app-main">
        <div className="app-topbar">
          <ThemeSwitch onChange={setTheme} theme={theme} />
        </div>
        <div className="mobile-topbar">
          <button
            aria-label="Open navigation"
            className="icon-button mobile-menu-button"
            onClick={() => setMobileNavOpen(true)}
            type="button"
          >
            ☰
          </button>
          <button className="mobile-brand" onClick={() => navigate('/library')} type="button">
            VidScribe
          </button>
          <ThemeSwitch compact onChange={setTheme} theme={theme} />
          <button
            aria-label="Add a video"
            className="icon-button"
            onClick={() => setAddDialogOpen(true)}
            type="button"
          >
            ＋
          </button>
        </div>

        {(databaseUnavailable ||
          answerProviderUnconfigured ||
          generationStatusError ||
          healthError) && (
          <div
            className={`dependency-banner${databaseUnavailable ? ' dependency-banner-error' : ''}`}
            role="status"
          >
            <span className="dependency-banner-icon" aria-hidden="true">
              {databaseUnavailable ? '!' : 'i'}
            </span>
            <span>{dependencyMessage}</span>
            {answerProviderUnconfigured ? (
              <button
                className="text-button"
                onClick={() => navigate('/settings/ai')}
                type="button"
              >
                Configure AI
              </button>
            ) : (
              <button
                className="text-button"
                disabled={checkingHealth}
                onClick={() => void refreshHealth()}
                type="button"
              >
                {checkingHealth ? 'Checking…' : 'Check again'}
              </button>
            )}
          </div>
        )}

        {isLibrary ? (
          <LibraryPage
            error={libraryError}
            loading={libraryLoading}
            onAddSource={() => setAddDialogOpen(true)}
            onOpenSource={(id) => navigate(`/sources/${id}`)}
            onRetryLoad={() => void refreshSources()}
            sources={sources}
          />
        ) : isSettings ? (
          <AiSettingsPage
            onSettingsChanged={() => void refreshHealth()}
            onSectionChange={(section) => navigate(`/settings/${section}`)}
            section={settingsSection}
            theme={theme}
            onThemeChange={setTheme}
          />
        ) : sourceId !== null ? (
          <SourceWorkspace
            activeProviderConfigured={activeProviderConfigured}
            activeProviderLabel={activeProviderLabel}
            providerStatusError={providerStatusError}
            providerStatusKnown={providerStatusKnown}
            key={sourceId}
            onBack={() => navigate('/library')}
            onOpenAiSettings={() => navigate('/settings/ai')}
            onSourceChanged={handleSourceChanged}
            onSourceRemoved={handleSourceRemoved}
            sourceId={sourceId}
          />
        ) : (
          <section className="page not-found-page">
            <div className="eyebrow">PAGE NOT FOUND</div>
            <h1>We couldn’t find that page</h1>
            <p>The source may have been removed or the address may be incorrect.</p>
            <button
              className="button button-primary"
              onClick={() => navigate('/library')}
              type="button"
            >
              Go to your library
            </button>
          </section>
        )}
      </main>

      {mobileNavOpen && (
        <button
          aria-label="Close navigation"
          className="sidebar-backdrop"
          onClick={() => setMobileNavOpen(false)}
          type="button"
        />
      )}

      <AddSourceDialog
        onClose={() => setAddDialogOpen(false)}
        onCreated={handleSourceAdded}
        open={addDialogOpen}
      />
    </div>
  );
}

export default App;
