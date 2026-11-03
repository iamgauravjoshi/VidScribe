# YouTube Source Adapter

**Implementation:** `backend/src/services/youtube/youtube-url.service.ts` and `youtube.service.ts`

## Purpose and boundary

The adapter validates supported YouTube URL forms, extracts the 11-character video ID, builds a canonical watch URL, retrieves an English transcript through `youtube-transcript`, and maps provider fields into `TranscriptSegment` values. Its public contract uses seconds for both segment offsets and durations.

It does not own chunking, embeddings, database persistence, API response formatting, or a generic multi-source domain model.

## Input/output and external calls

- URL parsing accepts `youtube.com`, `www.youtube.com`, `m.youtube.com`, and `youtu.be` forms supported by the parser, including watch, shorts, embed, and short-link paths.
- Transcript retrieval calls the external provider for English captions and returns `{videoId, transcript}`.
- Normalization infers caption units from the median positive segment duration. A median above 60 is treated as milliseconds and both offset and duration are divided by 1,000; otherwise values are retained as seconds. This handles the package's srv3 and classic caption parsers without mistaking a long-video offset for milliseconds.
- Transcript retrieval requests English captions and wraps upstream failures in stable application error codes. It has no explicit abort timeout, automatic retry, or language fallback.

The `youtube-transcript` 1.3.1 parser returns srv3 `<p t="..." d="...">` values directly as milliseconds, while its classic `<text start="..." dur="...">` path parses seconds. The adapter normalizes that inconsistent package boundary before chunking, persistence, player seeking, or citation creation. See [the timestamp normalization decision](../decisions/youtube-transcript-timestamp-normalization.md).

The request validator and URL parser are separate checks. Their accepted host/path rules should be kept consistent as URL support evolves.

## Failure and concurrency

Invalid URLs become `INVALID_YOUTUBE_URL`; missing captions become non-retryable `TRANSCRIPT_NOT_AVAILABLE`; provider failures become retryable `TRANSCRIPT_FETCH_FAILED`. Concurrent reads have no shared mutable state, but the upstream provider may rate-limit callers. No cache or rate limiter exists.

## Testing strategy

Test canonical watch URLs, short links, shorts, embeds, unsupported domains, malformed IDs, query parameters, whitespace, and provider response normalization. Unit tests cover both millisecond and seconds payloads, invalid rows, and sorting. The PostgreSQL migration integration case verifies repaired segments, derived chunks, legacy chunks without transcript rows, saved citation links, and unchanged second-valued data. Mock the provider boundary for missing captions, provider rejection, and timeout behavior when a timeout is added.

## Future evolution

When a second source is implemented, define a small source adapter contract around stable identity, metadata, and extracted content. Keep provider-specific fetch and normalization here. A content-source abstraction should emerge from real differences in multiple adapters, not be added as a large generic framework now.
