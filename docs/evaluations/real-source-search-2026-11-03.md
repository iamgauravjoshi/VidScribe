# Real-source search and citation baseline

**Date:** 2026-11-03  
**Status:** Baseline and first reranking comparison; expand before making broad product claims

## Purpose

Measure the current PostgreSQL lexical retrieval path on real transcripts before choosing between retrieval improvements and another input type. This evaluates evidence retrieval and citation construction only. It does not evaluate generated answers or Gemini.

## Method

- Ingested three public English-captioned educational YouTube videos through VidScribe's normal ingestion worker into a fresh, uniquely named PostgreSQL test container.
- Ran six manually labeled questions against `searchSourceChunksByText`, using the application's configured maximum of five retrieved chunks.
- Each label identifies a transcript segment by an anchor phrase. A query counts as a hit when a returned chunk's time range contains the anchor segment's start time.
- MRR uses the rank of the first chunk containing that anchor. Citation link validation checks that the URL identifies the expected video and that its `t` parameter matches the retrieved chunk's start time.
- Citation start distance is the absolute time difference between the anchor segment and the start of the relevant retrieved chunk.
- No LLM or provider calls were made. The temporary database container and volume were removed after the run.

## Baseline results: chunk-only ranking

| Measure | Result | Interpretation |
| --- | ---: | --- |
| Sources ingested | 3 / 3 | All selected caption sources were available in this environment. |
| Labeled queries | 6 | Two per source. |
| Recall@5 | 1.00 (6 / 6) | Each labeled evidence chunk appeared in the returned five. |
| Mean reciprocal rank | 0.547 | Relevant chunks ranked 2, 3, 1, 4, 1, and 5. There is room to improve ordering. |
| Median absolute anchor-to-chunk-start distance | 58.44 seconds | The retrieved relevant chunk starts roughly a minute from its labeled transcript anchor. In these six cases, the chunk starts before the anchor. |
| Valid citation link rate when relevant evidence was found | 1.00 (6 / 6) | Each link generated for a retrieved relevant chunk targeted the expected video and chunk start time. This validates URL construction, not real player playback or semantic citation quality. |
| AI provider calls | 0 | Retrieval stayed local to PostgreSQL. |

### Query-level results

| Source | Query label | Relevant rank | Anchor-to-chunk-start distance | Link valid |
| --- | --- | ---: | ---: | --- |
| Judson Brewer, *A Simple Way to Break a Bad Habit* | Reward-based habit learning | 2 | 57.08 s | Yes |
| Judson Brewer, *A Simple Way to Break a Bad Habit* | Curiosity and urges | 3 | 59.80 s | Yes |
| Julian Treasure, *How to Speak So That People Want to Listen* | HAIL speaking model | 1 | 66.81 s | Yes |
| Julian Treasure, *How to Speak So That People Want to Listen* | Gossip lexical paraphrase | 4 | 35.17 s | Yes |
| 3Blue1Brown, *But what is a neural network?* | Neural network neurons | 1 | 70.26 s | Yes |
| 3Blue1Brown, *But what is a neural network?* | Connection importance | 5 | 47.62 s | Yes |

## Phase result: segment-aware reranking and citations

The retrieval query now preserves the original chunk-level top-five candidate set, then reranks those five candidates using phrase matches, complete-question matches, and the best matching canonical transcript segment. The answer model still receives the complete retrieved chunks; the selected segment only narrows citation text and seek time. This separates evidence context from the UI's precise citation target.

| Measure | Previous chunk-only ranking | Segment-aware reranking | Change |
| --- | ---: | ---: | ---: |
| Recall@1 | 0.333 (2 / 6) | 0.500 (3 / 6) | +1 query in first place |
| Recall@3 | 0.667 (4 / 6) | 0.833 (5 / 6) | +1 query in top three |
| Recall@5 | 1.000 (6 / 6) | 1.000 (6 / 6) | Preserved |
| Mean reciprocal rank | 0.547 | 0.672 | +0.125 (about 23%) |
| Median absolute anchor-to-chunk-start distance | 58.44 s | 58.44 s | Context chunks unchanged |
| Median absolute anchor-to-citation-start distance | Not measured separately; chunk start used | 15.57 s | About 73% closer |
| Segment citation available when relevant chunk found | Not applicable | 1.000 (6 / 6) | Exact caption segment selected in this sample |
| Valid video/timestamp link rate | 1.000 (6 / 6) | 1.000 (6 / 6) | Preserved |

The new relevant ranks are 1, 3, 2, 5, 1, and 1. All six returned citation URLs use the selected segment's start time, and each matching segment was found. Citation precision here is measured against the labeled anchor segment, not through subjective player testing.

## Product implication

The reranker improved the first relevant result's position without changing which chunks were eligible for the top five, and segment citations narrowed the measured anchor-to-start gap. This is useful evidence for the implementation, but six hand-labeled questions are too few to show that the gains generalize or to establish answer quality.

**Recommended next step:** expand the labeled set across more sources, question styles, and longer transcripts; verify human-perceived seek quality and whether the cited segment actually supports generated answers. Keep PostgreSQL full-text search as the measured baseline. After that evaluation, decide whether a second input adapter offers more product value than hybrid semantic retrieval. Do not infer a need for vector search from this small sample.

## Limitations

- Three educational videos and six hand-selected anchors are a small convenience sample, not a representative benchmark.
- Relevance means that the returned chunk spans a manually selected transcript anchor. It does not establish that a generated answer is complete, factually correct, or supported strongly enough for a human reader.
- Link validation checks the expected video ID and timestamp parameter; it does not automate YouTube playback or verify the user's perceived jump precision.
- The reranking comparison uses the same three sources and six labels as the baseline. It is a paired diagnostic, not an independently sampled validation set.
- The sample uses `Recall@5`, while the existing synthetic fixture reports `Recall@3 = 0.75`; the scores should not be compared directly because their cutoffs and corpora differ.
- Caption access varies by environment. GitHub-hosted runners could not fetch these same captions, while the local run could.

## Reproduction

Use a fresh isolated `vidscribe_test` database and run `npm run eval:real-sources` with `NODE_ENV=test` and `VIDSCRIBE_TEST_DATABASE_URL` set. The runner rejects non-test database names, records a JSON report at the repository root, and removes only rows it created. See the root README and [CI validation decision](../decisions/ci-validation-workflow.md) for the isolated Compose setup and opt-in hosted workflow.
