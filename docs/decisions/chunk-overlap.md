# Decision: Segment-Aware Transcript Chunk Overlap

**Status:** Accepted for timestamped YouTube transcripts.

## Problem

Semantic chunk boundaries can split a statement or explanation. A fact at the end of one chunk may be hard to retrieve without its continuation. VidScribe also needs each chunk to point to a meaningful video interval.

## Naive approach

Split a flattened transcript every N characters and copy the last N characters into the next chunk. This can cut through a caption segment, duplicate fragments in citations, and make timestamp bounds difficult to explain.

## Chosen approach

Chunk complete transcript segments up to the configured character budget, with one space between segments. For the next chunk, retain whole trailing segments until the configured overlap target is met, while always advancing by at least one segment. Chunk timestamps use the first segment start and last segment end.

The overlap target is approximate: the algorithm does not split a segment to hit an exact character count. It always advances by at least one segment, even when the configured overlap is larger than the current chunk. Once the final chunk covers the remaining input, the algorithm stops instead of emitting an overlap-only trailing chunk.

## Why

Transcript segments are natural caption units and already carry timestamps. Whole-segment overlap keeps citations coherent and makes timestamp ranges stable. The chunker remains independent of YouTube networking, embeddings, and persistence.

## Failure and concurrency

Invalid chunk size or overlap is rejected before inference. Empty transcript content produces no chunks and the worker marks the source failed. The chunker is pure and has no shared mutable state, so concurrent ingestions do not interfere. Re-running with the same configuration produces the same ordered chunks.

## Trade-offs and alternatives

- A segment may exceed the budget and form an oversized chunk; a future tokenizer-aware splitter can address unusually long captions.
- Segment-level overlap may exceed the numeric target by up to one segment.
- Token-based chunking could align better with model context, but requires tokenizer/model coupling and is not necessary at the current input scale.
- A sliding token window is deferred until retrieval evaluation shows a quality problem.

## Interview explanation

“I overlap whole timestamped transcript segments instead of slicing arbitrary characters. That keeps citations aligned to complete caption units. The target overlap is approximate, and I enforce forward progress so large overlap settings cannot create an infinite loop. Unit tests cover adjacent chunk context and timestamp bounds.”
