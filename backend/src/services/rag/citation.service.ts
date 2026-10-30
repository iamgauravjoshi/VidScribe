import type { RetrievedChunkRow } from '../../types/chunk.type.js';
import type { AnswerCitation } from '../../types/chat.type.js';

export function mapRetrievedChunk(row: RetrievedChunkRow): AnswerCitation {
  const href = new URL('https://www.youtube.com/watch');
  href.searchParams.set('v', row.external_id);

  if (row.start_seconds !== null) {
    href.searchParams.set('t', `${Math.max(0, Math.floor(row.start_seconds))}s`);
  }

  return {
    id: String(row.id),
    startSeconds: row.start_seconds,
    endSeconds: row.end_seconds,
    excerpt: row.content,
    href: href.toString(),
  };
}
