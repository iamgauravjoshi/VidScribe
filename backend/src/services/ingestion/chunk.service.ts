// Build chunking

import type { TextChunk } from "../../types/chunk.type.js";
import type { TranscriptSegment } from "../../types/transcript.type.js";


export function createChunks(
  segments: TranscriptSegment[],
  maxCharacters = 2000
): TextChunk[] {
  const chunks: TextChunk[] = [];

  let currentText = "";
  let currentStart = 0;
  let currentEnd = 0;

  for (const segment of segments) {
    const nextText =
      `${currentText} ${segment.text}`.trim();

    if (
      currentText &&
      nextText.length > maxCharacters
    ) {
      chunks.push({
        content: currentText,
        startTime: currentStart,
        endTime: currentEnd
      });

      currentText = segment.text;
      currentStart = segment.start;
      currentEnd = segment.start + segment.duration;

      continue;
    }

    if (!currentText) {
      currentStart = segment.start;
    }

    currentText = nextText;

    currentEnd =
      segment.start + segment.duration;
  }

  if (currentText) {
    chunks.push({
      content: currentText,
      startTime: currentStart,
      endTime: currentEnd
    });
  }

  return chunks;
}