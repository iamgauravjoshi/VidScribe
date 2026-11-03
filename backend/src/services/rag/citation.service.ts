import type { RetrievedChunkRow } from '../../types/chunk.type.js';
import type { AnswerCitation } from '../../types/chat.type.js';

export function mapRetrievedChunk(row: RetrievedChunkRow): AnswerCitation {
  const startSeconds = row.citation_start_seconds ?? row.start_seconds;

  const href = new URL('https://www.youtube.com/watch');
  href.searchParams.set('v', row.external_id);

  if (startSeconds !== null) {
    href.searchParams.set('t', `${Math.max(0, Math.floor(startSeconds))}s`);
  }

  return {
    id: String(row.id),
    startSeconds,
    endSeconds: row.citation_end_seconds ?? row.end_seconds,
    excerpt: row.citation_excerpt ?? row.content,
    href: href.toString(),
  };
}

export function mapRetrievedChunks(rows: RetrievedChunkRow[]): AnswerCitation[] {
  const seenEvidence = new Set<string>();
  const citations: AnswerCitation[] = [];

  for (const row of rows) {
    const evidenceKey =
      row.citation_segment_index === null
        ? `chunk:${row.id}`
        : `segment:${row.source_id}:${row.citation_segment_index}`;

    if (seenEvidence.has(evidenceKey)) continue;

    seenEvidence.add(evidenceKey);
    citations.push(mapRetrievedChunk(row));
  }

  return citations;
}
