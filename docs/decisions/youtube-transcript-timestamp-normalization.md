# Normalize YouTube transcript timestamps

**Status:** Accepted

**Date:** 2026-11-03

## Problem

VidScribe treats transcript offsets and durations as seconds throughout chunking, PostgreSQL storage, transcript reading, YouTube seeking, and citations. A real-caption probe returned a roughly nine-minute video with segment offsets near 500,000. The resulting application timestamps would be hundreds of thousands of seconds, sending transcript navigation and citations far beyond the video.

The upstream youtube-transcript 1.3.1 parser has two formats with different units: its srv3 parser returns the raw numeric t/d values in milliseconds, while the classic text parser parses start/dur as seconds. A single adapter response type hides that difference.

## Naive approach

Always divide caption offsets and durations by 1,000, or infer the unit from the largest offset.

## Why that is problematic

- Always dividing breaks classic-caption results that are already seconds.
- A long video can have a valid seconds offset above 1,000; using offsets alone would corrupt it.
- Fixing only new ingestion leaves existing transcript pages, chunks, saved citation time ranges, and citation URLs incorrect.
- Rebuilding every old source would require caption-network calls and could fail or incur unrelated traffic during a schema migration.

## Chosen approach

At the YouTube adapter boundary, filter invalid rows and calculate the median of positive segment durations. A median above 60 is treated as milliseconds; both offset and duration are divided by 1,000 before the transcript reaches chunking or persistence. Otherwise the values are preserved as seconds.

Migration 006 applies a separate data repair:

- Canonical transcript sources are selected when their median positive stored segment duration exceeds 60.
- Older sources without canonical transcript segments are selected only when their median stored chunk span exceeds 3,600 in the stored numeric units, a conservative scale check for the millisecond-valued records observed in the real-caption probe.
- Segment times, derived chunk bounds, and persisted citation start/end values and timestamp URLs are converted in one migration transaction.
- Rows that appear to already use seconds are left as-is.

The migration runner's advisory lock serializes schema migration runners, and the migration is recorded with a checksum. Applying the migration again is prevented by the migration version. It does not fetch captions or regenerate answers.

## Example

A srv3 caption with offset 168,520 and duration 1,200 becomes start 168.52 seconds and duration 1.2 seconds. Chunk timestamps, transcript display, and the citation URL all use that same normalized unit. A classic caption with offset 168.52 and duration 1.2 remains unchanged.

## Failure scenario

If normalization is omitted, a transcript point at about 168 seconds can appear at about 168,000 seconds and its YouTube timestamp link will not seek to the supporting moment. If a stored row is ambiguous, migration 006 leaves it alone rather than converting every large value and risking an already-correct long-video timestamp. The existing source can still be refreshed through the normal ingestion path after the adapter fix.

## Concurrency scenario

The migration uses row updates inside the migration transaction. Application startup applies migrations before starting the ingestion worker. When an operator applies migrations to an already-running multi-process deployment, old workers should be stopped or drained first; an old process could otherwise publish new millisecond values while the one-time repair is scanning existing records.

## Trade-offs

- **Gain:** new and historical transcript, search, and citation times share one seconds contract.
- **Cost:** unit inference uses a duration heuristic because the upstream response type does not expose its caption format.
- **Risk boundary:** segment-duration medians are a strong signal for canonical transcripts. The chunk-only fallback is weaker because those sources have lost their original segment duration data, so it uses a higher threshold relative to ordinary second-based chunk spans and requires no canonical segment rows.
- **Data migration:** saved answer citations are updated along with their source data to avoid a split between an old answer and the repaired transcript.

## Alternatives

- Always divide all values: simple but corrupts the classic parser's seconds.
- Infer from maximum offsets: mistakes a legitimate long-video seconds offset for milliseconds.
- Keep the bug and wait for re-ingestion: leaves active citations wrong until a user refreshes each source.
- Re-fetch every existing source: adds network dependencies and operational risk to a local SQL migration.
- Store a per-transcript explicit unit from the provider: the package currently returns no format/unit metadata, so that would require changing or replacing the adapter dependency.

## References

- [youtube-transcript 1.3.1 package](https://www.npmjs.com/package/youtube-transcript/v/1.3.1)
- [Upstream caption parser source](https://raw.githubusercontent.com/Kakulukian/youtube-transcript/master/src/index.ts)

## Interview explanation

“I found inconsistent units at an external adapter boundary: one YouTube caption format returned milliseconds and another returned seconds. I normalized the values before they entered domain logic, using segment durations rather than offsets to detect the format so long videos are safe. A one-time transactional migration repairs existing transcript rows, search chunk bounds, and saved citation links. The tests cover both formats and verify that already-second-valued rows remain unchanged.”
