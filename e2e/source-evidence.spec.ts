import { readFile } from 'node:fs/promises';

import { expect, test, e2eDb } from './fixtures';
import {
  publishRefreshedTranscript,
  recordRefreshFailure,
} from '../backend/test/e2e-database';

test('citation seeks the local transcript, falls back when playback fails, and exports TXT/SRT/VTT', async ({
  page,
  createSource,
}, testInfo) => {
  const source = await createSource();

  await page.addInitScript(() => {
    const host = window as any;
    const recorder = {
      seeks: [] as number[],
      options: null as any,
      fail: () => host.__e2eYouTube.options?.events.onError({ data: 101 }),
    };
    host.__e2eYouTube = recorder;
    host.YT = {
      Player: class {
        private readonly iframe: HTMLIFrameElement;

        constructor(mount: HTMLElement, options: any) {
          recorder.options = options;
          this.iframe = document.createElement('iframe');
          mount.append(this.iframe);
          window.setTimeout(() => options.events.onReady({ target: this }), 0);
        }

        getIframe() {
          return this.iframe;
        }

        seekTo(seconds: number) {
          recorder.seeks.push(seconds);
        }

        destroy() {
          this.iframe.remove();
        }
      },
    };
  });

  await page.goto(`/sources/${source.id}`);
  await page.getByRole('button', { name: 'Play cited moment at 10:20' }).click();

  await expect(page.locator('.transcript-segment-active')).toContainText('Transcript segment 124');
  await expect.poll(async () => page.evaluate(() => (window as any).__e2eYouTube.seeks)).toContain(620);
  await expect.poll(async () => page.evaluate(() => {
    const container = document.querySelector('.transcript-segments');
    const segment = document.querySelector('.transcript-segment-active');
    if (!container || !segment) return Number.POSITIVE_INFINITY;
    const containerBounds = container.getBoundingClientRect();
    const segmentBounds = segment.getBoundingClientRect();
    return Math.abs(
      (segmentBounds.top + segmentBounds.bottom) / 2
        - (containerBounds.top + containerBounds.bottom) / 2,
    );
  })).toBeLessThan(60);

  const playerVars = await page.evaluate(() => (window as any).__e2eYouTube.options.playerVars);
  expect(playerVars.enablejsapi).toBe(1);
  expect(playerVars.origin).toBe(new URL(page.url()).origin);

  await page.evaluate(() => (window as any).__e2eYouTube.fail());
  await expect(page.locator('.youtube-player-error')).toContainText(
    'This video cannot be played in the embedded player.',
  );
  await expect(page.locator('.youtube-player-error a')).toHaveAttribute('href', source.canonicalUrl);

  for (const format of ['txt', 'srt', 'vtt'] as const) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: format.toUpperCase(), exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`vidscribe-source-${source.id}-transcript.${format}`);
    const outputPath = testInfo.outputPath(`transcript.${format}`);
    await download.saveAs(outputPath);
    const body = await readFile(outputPath, 'utf8');

    if (format === 'txt') {
      expect(body.split(/\r?\n/)).toHaveLength(160);
      expect(body).toContain('searchneedleomega');
    }
    if (format === 'srt') {
      expect(body.split(/\r?\n\r?\n/)).toHaveLength(160);
      expect(body).toContain('00:10:20,000 --> 00:10:24,000');
    }
    if (format === 'vtt') {
      expect(body.startsWith('WEBVTT\n\n')).toBe(true);
      expect(body.replace(/^WEBVTT\r?\n\r?\n/, '').split(/\r?\n\r?\n/)).toHaveLength(160);
      expect(body).toContain('00:10:20.000 --> 00:10:24.000');
    }
  }
});

test('transcript search filters locally and pagination appends the remaining moments', async ({
  page,
  createSource,
}) => {
  const source = await createSource();
  await page.goto(`/sources/${source.id}`);

  const transcript = page.locator('.transcript-segments');
  const rows = transcript.locator('.transcript-segment');
  await expect(rows).toHaveCount(100);
  await expect(page.getByRole('button', { name: 'Load more transcript' })).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Search transcript' });
  await search.fill('searchneedleomega');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('searchneedleomega');
  await expect(page.getByRole('button', { name: 'Load more transcript' })).toHaveCount(0);

  await search.fill('vidscribenosearchmatch');
  await expect(page.getByText('No transcript moments match that search.')).toBeVisible();
  await expect(rows).toHaveCount(0);

  await search.fill('');
  await expect(rows).toHaveCount(100);
  await page.getByRole('button', { name: 'Load more transcript' }).click();
  await expect(rows).toHaveCount(160);
  await expect(rows.last()).toContainText('Transcript segment 159');
  await expect(page.getByRole('button', { name: 'Load more transcript' })).toHaveCount(0);
});

test('source evidence workspace fits a narrow mobile viewport', async ({ page, createSource }) => {
  const source = await createSource();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/sources/${source.id}`);

  await expect(page.getByRole('heading', { name: 'Transcript' })).toBeVisible();
  await expect(page.locator('.transcript-segment')).toHaveCount(100);
  const hasNoHorizontalOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    && document.body.scrollWidth <= document.body.clientWidth + 1
  ));
  expect(hasNoHorizontalOverflow).toBe(true);
});

test('legacy transcript refresh moves through prepare, retryable failure, retry, and ready states', async ({
  page,
  createSource,
}) => {
  const source = await createSource('legacy');
  await page.goto(`/sources/${source.id}`);

  await expect(page.getByText(/predates transcript storage/)).toBeVisible();
  await page.getByRole('button', { name: 'Prepare transcript' }).click();
  await expect(page.getByText(/Preparing the transcript for this saved source/)).toBeVisible();
  await expect.poll(async () => {
    const result = await e2eDb.query<{ status: string; operation: string }>(
      'SELECT status, operation FROM public.ingestion_jobs WHERE source_id = $1',
      [source.id],
    );
    return result.rows[0];
  }).toEqual({ status: 'QUEUED', operation: 'TRANSCRIPT_REFRESH' });

  const sourceState = await e2eDb.query<{ processing_status: string }>(
    'SELECT processing_status FROM public.sources WHERE id = $1',
    [source.id],
  );
  expect(sourceState.rows[0]?.processing_status).toBe('READY');

  await recordRefreshFailure(e2eDb, source.id);
  await expect(page.getByRole('alert')).toContainText('Captions are temporarily unavailable. Please retry.');
  await expect(page.getByRole('button', { name: 'Prepare transcript' })).toBeVisible();

  await page.getByRole('button', { name: 'Prepare transcript' }).click();
  await expect(page.getByText(/Preparing the transcript for this saved source/)).toBeVisible();
  await expect.poll(async () => {
    const result = await e2eDb.query<{
      status: string;
      operation: string;
      retry_count: number;
    }>(
      'SELECT status, operation, retry_count FROM public.ingestion_jobs WHERE source_id = $1',
      [source.id],
    );
    return result.rows[0];
  }).toEqual({ status: 'QUEUED', operation: 'TRANSCRIPT_REFRESH', retry_count: 1 });

  await publishRefreshedTranscript(e2eDb, source.id);
  await expect(page.getByText('A newly refreshed transcript moment is ready.')).toBeVisible();
  const readySource = await e2eDb.query<{ processing_status: string }>(
    'SELECT processing_status FROM public.sources WHERE id = $1',
    [source.id],
  );
  expect(readySource.rows[0]?.processing_status).toBe('READY');
});

test('legacy sources with a non-retryable transcript failure do not offer retry', async ({
  page,
  createSource,
}) => {
  const source = await createSource('legacy-nonretryable');
  await page.goto(`/sources/${source.id}`);

  await expect(page.getByRole('alert')).toContainText('Captions are unavailable for this source.');
  await expect(page.getByRole('button', { name: 'Prepare transcript' })).toHaveCount(0);
});
