import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { ApiError, createSource } from '../services/api';
import type { Source } from '../types/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (source: Source, created: boolean) => void;
}

export function AddSourceDialog({ open, onClose, onCreated }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!url.trim()) {
      setError('Paste a YouTube URL to continue.');
      return;
    }

    setSubmitting(true);

    try {
      const result = await createSource(url.trim());
      setUrl('');
      onCreated(result.source, result.created);
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.code === 'INVALID_YOUTUBE_URL') {
        setError("That link doesn't look like a supported YouTube URL.");
      } else if (caught instanceof ApiError && caught.status === 0) {
        setError('VidScribe could not reach its API. Check that the app is running, then try again.');
      } else {
        setError(caught instanceof Error ? caught.message : 'The source could not be added.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      aria-labelledby="add-source-title"
      className="source-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !submitting) onClose();
      }}
      ref={dialogRef}
    >
      <div className="dialog-heading">
        <div className="dialog-icon" aria-hidden="true">▶</div>
          <button className="icon-button dialog-close" aria-label="Close" disabled={submitting} onClick={onClose} type="button">
          ×
        </button>
        <div className="eyebrow">ADD TO YOUR LIBRARY</div>
        <h2 id="add-source-title">Bring a video into VidScribe</h2>
        <p>We’ll index its English captions so you can ask questions and revisit the source.</p>
      </div>

      <form className="dialog-form" onSubmit={handleSubmit}>
        <label htmlFor="source-url">YouTube link</label>
        <input
          autoComplete="url"
          id="source-url"
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          ref={inputRef}
          type="url"
          value={url}
        />
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button className="button button-secondary" disabled={submitting} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="button button-primary" disabled={submitting || !url.trim()} type="submit">
            {submitting ? <><span className="spinner spinner-small" aria-hidden="true" /> Adding…</> : 'Add video'}
          </button>
        </div>
      </form>

      <p className="dialog-footnote">Public YouTube videos with English captions are supported in this release.</p>
    </dialog>
  );
}
