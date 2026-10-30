import { useEffect, useState } from 'react';

import { ApiError, getAiSettings, testAndSaveAiProvider } from '../services/api';
import type { AiSettings, LlmProviderId, ThemeMode } from '../types/types';

interface Props {
  onSettingsChanged: () => void;
  section: 'ai' | 'appearance';
  onSectionChange: (section: 'ai' | 'appearance') => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

const PROVIDER_ORDER: LlmProviderId[] = ['anthropic', 'openai', 'gemini', 'ollama'];
const PROVIDER_DETAILS: Record<LlmProviderId, { subtitle: string; keyHelp: string }> = {
  anthropic: { subtitle: 'Claude models', keyHelp: 'Get a key from console.anthropic.com' },
  openai: { subtitle: 'OpenAI models', keyHelp: 'Get a key from platform.openai.com' },
  gemini: { subtitle: 'Google Gemini models', keyHelp: 'Get a key from aistudio.google.com' },
  ollama: {
    subtitle: 'Local model running on your computer',
    keyHelp: 'Ollama must be running with this model installed.',
  },
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'The provider could not be tested and saved.';
}

export function AiSettingsPage({
  onSettingsChanged,
  section,
  onSectionChange,
  theme,
  onThemeChange,
}: Props) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [selectedId, setSelectedId] = useState<LlmProviderId>('gemini');
  const [models, setModels] = useState<Partial<Record<LlmProviderId, string>>>({});
  const [apiKeys, setApiKeys] = useState<Partial<Record<LlmProviderId, string>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAiSettings()
      .then((result) => {
        if (cancelled) return;
        setSettings(result);
        setSelectedId(result.activeProvider);
        setModels(
          Object.fromEntries(result.providers.map((provider) => [provider.id, provider.modelId])),
        );
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selected = settings?.providers.find((provider) => provider.id === selectedId) ?? null;
  const modelId = selected ? (models[selected.id] ?? selected.modelId) : '';
  const apiKey = selected ? (apiKeys[selected.id] ?? '') : '';
  const canTest =
    selected !== null &&
    modelId.trim().length > 0 &&
    (!selected.requiresApiKey || selected.configured || Boolean(apiKey.trim()));

  const handleTestAndSave = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await testAndSaveAiProvider({
        providerId: selected.id,
        modelId: modelId.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setSettings(result.settings);
      setModels(
        Object.fromEntries(
          result.settings.providers.map((provider) => [provider.id, provider.modelId]),
        ),
      );
      setApiKeys((previous) => ({ ...previous, [selected.id]: '' }));
      setShowKey(false);
      setNotice(
        `${selected.label} connection tested and saved in ${result.durationMs} ms. It is now selected for new answers.`,
      );
      onSettingsChanged();
    } catch (saveError: unknown) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page settings-page">
      <div className="settings-page-heading">
        <div>
          <h1>Settings</h1>
          <p>Choose how VidScribe answers questions and how the workspace looks.</p>
        </div>
      </div>

      <div className="settings-layout">
        <nav aria-label="Settings sections" className="settings-nav">
          <button
            className={section === 'ai' ? 'settings-nav-active' : ''}
            onClick={() => onSectionChange('ai')}
            type="button"
          >
            AI model
          </button>
          <button
            className={section === 'appearance' ? 'settings-nav-active' : ''}
            onClick={() => onSectionChange('appearance')}
            type="button"
          >
            Appearance
          </button>
        </nav>

        <div className="settings-content">
          {section === 'appearance' ? (
            <section aria-labelledby="appearance-title" className="settings-card panel">
              <h2 id="appearance-title">Appearance</h2>
              <p>Choose the theme used across your library and source workspaces.</p>
              <div aria-label="Theme" className="theme-options" role="group">
                <button
                  aria-pressed={theme === 'light'}
                  className={`theme-option${theme === 'light' ? ' theme-option-selected' : ''}`}
                  onClick={() => onThemeChange('light')}
                  type="button"
                >
                  <span className="theme-preview theme-preview-light" aria-hidden="true" />
                  <span>
                    <strong>Light</strong>
                    <small>Bright surfaces and dark text</small>
                  </span>
                  {theme === 'light' && (
                    <span className="theme-check" aria-label="Selected">
                      ✓
                    </span>
                  )}
                </button>
                <button
                  aria-pressed={theme === 'dark'}
                  className={`theme-option${theme === 'dark' ? ' theme-option-selected' : ''}`}
                  onClick={() => onThemeChange('dark')}
                  type="button"
                >
                  <span className="theme-preview theme-preview-dark" aria-hidden="true" />
                  <span>
                    <strong>Dark</strong>
                    <small>Dim surfaces for low-light use</small>
                  </span>
                  {theme === 'dark' && (
                    <span className="theme-check" aria-label="Selected">
                      ✓
                    </span>
                  )}
                </button>
              </div>
              <p className="settings-help">Your theme preference is saved in this browser.</p>
            </section>
          ) : (
            <section aria-labelledby="ai-model-title" className="settings-card panel">
              <div className="settings-card-heading">
                <div>
                  <h2 id="ai-model-title">AI model</h2>
                  <p>Choose the provider that generates answers for your sources.</p>
                </div>
              </div>

              <div className="ai-settings-notice">
                Transcript indexing and search stay in PostgreSQL on this computer. A cloud provider
                receives your question and matched transcript excerpts to generate an answer.
                Testing sends a short prompt and may incur provider usage charges.
              </div>

              {error && (
                <div className="inline-notice" role="alert">
                  {error}
                </div>
              )}
              {notice && (
                <div className="ai-settings-success" role="status">
                  {notice}
                </div>
              )}

              {loading ? (
                <div className="ai-settings-loading" role="status">
                  Loading provider settings…
                </div>
              ) : !settings ? (
                <div className="ai-settings-error">
                  AI provider settings are unavailable. Check the database connection and try again.
                </div>
              ) : (
                <>
                  <fieldset className="provider-grid">
                    <legend className="sr-only">AI answer provider</legend>
                    {PROVIDER_ORDER.map((providerId) => {
                      const provider = settings.providers.find((item) => item.id === providerId);
                      if (!provider) return null;
                      const selectedProvider = selectedId === provider.id;
                      return (
                        <label
                          className={`provider-choice${selectedProvider ? ' provider-choice-selected' : ''}`}
                          key={provider.id}
                        >
                          <input
                            checked={selectedProvider}
                            className="provider-native-radio"
                            disabled={busy}
                            name="ai-provider"
                            onChange={() => {
                              setSelectedId(provider.id);
                              setShowKey(false);
                              setError(null);
                              setNotice(null);
                            }}
                            type="radio"
                            value={provider.id}
                          />
                          <span className="provider-choice-copy">
                            <strong>
                              {provider.label === 'Gemini'
                                ? 'Google Gemini'
                                : provider.label === 'Claude'
                                  ? 'Anthropic (Claude)'
                                  : provider.label}
                            </strong>
                            <small>{PROVIDER_DETAILS[provider.id].subtitle}</small>
                          </span>
                          {provider.configured && (
                            <span className="provider-configured-badge">
                              {provider.requiresApiKey ? 'Key saved' : 'Local'}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </fieldset>

                  {selected && (
                    <div className="provider-editor">
                      <label className="provider-field">
                        <span>Model</span>
                        <input
                          autoComplete="off"
                          disabled={busy}
                          maxLength={150}
                          onChange={(event) =>
                            setModels((previous) => ({
                              ...previous,
                              [selected.id]: event.target.value,
                            }))
                          }
                          value={modelId}
                        />
                        <small>Current saved value: {selected.modelId}</small>
                      </label>

                      {selected.requiresApiKey ? (
                        <label className="provider-field">
                          <span>API key</span>
                          <span className="key-input-wrap">
                            <input
                              autoComplete="new-password"
                              disabled={busy}
                              onChange={(event) =>
                                setApiKeys((previous) => ({
                                  ...previous,
                                  [selected.id]: event.target.value,
                                }))
                              }
                              placeholder={
                                selected.configured
                                  ? 'Saved securely; leave empty to keep it'
                                  : 'Enter your API key'
                              }
                              type={showKey ? 'text' : 'password'}
                              value={apiKey}
                            />
                            <button
                              aria-label={showKey ? 'Hide API key' : 'Show API key'}
                              aria-pressed={showKey}
                              className="key-visibility-button"
                              disabled={busy}
                              onClick={() => setShowKey((visible) => !visible)}
                              type="button"
                            >
                              {showKey ? 'Hide' : 'Show'}
                            </button>
                          </span>
                          <small>
                            {selected.configured
                              ? 'A key is saved. Leave this empty to keep it.'
                              : PROVIDER_DETAILS[selected.id].keyHelp}
                          </small>
                        </label>
                      ) : (
                        <p className="provider-local-help">
                          {PROVIDER_DETAILS[selected.id].keyHelp} Base URL is controlled by{' '}
                          <code>OLLAMA_BASE_URL</code>.
                        </p>
                      )}

                      <div className="provider-editor-actions">
                        <button
                          className="button button-primary"
                          disabled={busy || !canTest}
                          onClick={() => void handleTestAndSave()}
                          type="button"
                        >
                          {busy ? 'Testing connection…' : 'Test and save connection'}
                        </button>
                        {selected.active && (
                          <span className="provider-selected-note">
                            Currently selected for answers
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              <p className="ai-settings-footnote">
                Provider changes affect new answers only. Saved answers and citations stay
                unchanged. API keys are encrypted by the backend and never returned to the browser.
              </p>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
