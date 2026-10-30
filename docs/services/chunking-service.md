# Chunking Service

**Implementation:** `backend/src/services/ingestion/chunk.service.ts`

## Purpose and boundary

`createChunks` converts timestamped transcript segments into text chunks with start/end timestamps. It is deterministic business logic and makes no network or database calls.

It does not retrieve source content, generate embeddings, select a model tokenization scheme, or persist rows.

## Input, output, and behavior

- Input: ordered `TranscriptSegment[]`, positive character `chunkSize`, and overlap in `[0, chunkSize)`.
- Output: `TextChunk[]` containing joined text, the first included segment's start, and the last included segment's end.
- Empty/whitespace segments are skipped. Overlap is segment-aware to avoid starting in the middle of a timestamped segment.
- The next chunk retains whole trailing segments until it meets or exceeds the configured overlap target, and always advances by at least one segment. A regression test covers adjacent chunk context and timestamp bounds.
- This is character-based, not token-based. A single segment longer than the chunk size is still accepted as one chunk because the loop permits the first segment even if oversized.

## Failure and concurrency

Invalid chunk size/overlap throws a generic `Error`, which currently becomes a generic API 500 if it reaches the global handler. Valid calls are pure and safe to run concurrently. The algorithm assumes transcript order and timestamp validity; it does not sort, validate timestamp ranges, or normalize malformed text.

## Testing strategy

Current tests cover overlap between adjacent chunks, timestamp preservation, invalid size/overlap, and a transcript with no usable segments. Expand coverage for exact boundaries, overlap zero, whitespace between valid segments, one oversized segment, and guaranteed forward progress if the algorithm changes.

## Future evolution

Token-aware chunking may improve model context sizing, but it requires tokenizer/model alignment and dependency cost. Preserve timestamp metadata and deterministic behavior when changing the algorithm. Add source-neutral chunk input only if new document types need different segmentation rules; do not force every source into a transcript-shaped type prematurely.
