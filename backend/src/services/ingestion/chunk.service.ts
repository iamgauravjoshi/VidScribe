/*
Build chunking

Transcript
    ↓
Chunking algorithm
    ↓
TextChunk[]

That is business/domain logic.
*/

import type { TextChunk } from '../../types/chunk.type.js';
import type { TranscriptSegment } from '../../types/transcript.type.js';

// Character-level overlap across transcript segments isn't ideal for timestamps. So we will use segment-aware overlap.

export function createChunks(
  transcript: TranscriptSegment[],
  chunkSize: number,
  overlap: number,
): TextChunk[] {
  if (chunkSize <= 0) {
    throw new Error('Chunk size must be greater than zero.');
  }

  if (overlap < 0 || overlap >= chunkSize) {
    throw new Error('Chunk overlap must be >= 0 and smaller than chunk size.');
  }

  const chunks: TextChunk[] = [];

  let startIndex = 0;

  while (startIndex < transcript.length) {
    let endIndex = startIndex;
    let characterCount = 0;

    while (endIndex < transcript.length) {
      const segmentText = transcript[endIndex].text.trim();

      if (!segmentText) {
        endIndex++;
        continue;
      }

      const additionalLength = segmentText.length + (characterCount > 0 ? 1 : 0);

      if (characterCount + additionalLength > chunkSize && endIndex > startIndex) {
        break;
      }

      characterCount += additionalLength;
      endIndex++;
    }

    const selectedSegments = transcript.slice(startIndex, endIndex);

    const validSegments = selectedSegments.filter((segment) => segment.text.trim().length > 0);

    if (validSegments.length === 0) {
      break;
    }

    const content = validSegments.map((segment) => segment.text.trim()).join(' ');

    const firstSegment = validSegments[0];
    const lastSegment = validSegments[validSegments.length - 1];

    chunks.push({
      content,
      startTime: firstSegment.start,
      endTime: lastSegment.start + lastSegment.duration,
    });

    /*
     * Move forward while preserving enough transcript
     * content to create the requested overlap.
     */
    let overlapLength = 0;
    let nextStartIndex = endIndex - 1;

    while (nextStartIndex > startIndex && overlapLength < overlap) {
      const segmentText = transcript[nextStartIndex].text.trim();

      overlapLength += segmentText.length + 1;
      nextStartIndex--;
    }

    startIndex = Math.max(startIndex + 1, nextStartIndex + 1);
  }

  return chunks;
}
