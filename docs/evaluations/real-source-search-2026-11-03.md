# Real-source search and citation baseline

**Date:** 2026-11-03  
**Status:** Baseline, first reranking comparison, and expanded evidence-quality sample; expand before making broad product claims

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

## Expanded evidence-quality check: dataset v2

The second pass uses six captioned YouTube sources spanning psychology, communication, computer science, leadership, motivation, and education. It has 18 questions, three per source. Each label uses a short phrase selected from one exact canonical transcript segment. The harness normalizes case and caption line breaks, records the selected segment index/time, and requires an explicit occurrence when an anchor phrase appears in more than one segment.

The report separates **evidence chunk recall** from **exact labeled-segment citation**. A chunk hit means its timestamp range contains the labeled segment. An exact citation hit means a result's selected citation segment has the same canonical segment index as the label. This stricter measure can count a nearby useful caption as a miss; it is a review signal, not a complete judgment of semantic support. The evaluation does not generate answers or call an AI provider.

| Measure | Result | Interpretation |
| --- | ---: | --- |
| Sources with English captions | 6 / 6 | All six source fixtures were available locally. |
| Labeled questions | 18 | Three per source, across lexical, paraphrase, and definition styles. |
| Evidence Recall@1 / @3 / @5 | 0.500 / 0.833 / 0.944 | The labeled segment appeared inside a retrieved chunk for 17 of 18 questions by rank five. |
| Evidence mean reciprocal rank | 0.676 | Rank is based on the first chunk containing the labeled segment. |
| Exact labeled-segment citation @1 / @3 / @5 | 0.222 / 0.556 / 0.611 | At least one result cited the exact labeled segment in 11 of 18 questions by rank five. |
| Exact match for the first relevant chunk's citation | 0.588 (10 / 17) | The citation attached to the highest-ranked chunk covering the target matched the exact label in 10 of 17 evidence-found cases. |
| Anchor phrase present in that citation | 0.588 (10 / 17) | The cited excerpt contained the manually selected phrase in those same cases. |
| Median / p90 / maximum citation-start distance | 0 / 58.80 / 101 s | The median is precise, but the tail includes materially distant citations. |
| Valid timestamp URL rate when evidence was found | 1.000 (17 / 17) | URLs used the correct video and selected-segment time. |
| Duplicate citations removed across all questions | 6 | Overlapping chunks produced six repeated segment citations that were deduplicated. |
| Provider calls | 0 | Search, labeling, and citations remained provider-free. |

### Results by query style

| Style | Questions | Evidence Recall@5 | Exact labeled-segment citation@5 |
| --- | ---: | ---: | ---: |
| Lexical | 9 | 1.000 (9 / 9) | 0.778 (7 / 9) |
| Paraphrase | 5 | 0.800 (4 / 5) | 0.600 (3 / 5) |
| Definition | 4 | 1.000 (4 / 4) | 0.250 (1 / 4) |

Definition-style questions are the clearest citation-selection weakness in this sample. The neural-network connection-weight paraphrase is the single question whose labeled chunk did not appear in the top five. These cases should be reviewed against the video before changing the ranking policy: a neighboring segment can still support an answer, and exact segment identity alone cannot decide that.

### Case-level timestamp audit

`Evidence rank` is the first chunk whose range contains the target segment. `Exact cite rank` is the first result that cites that exact segment. `Cited time` is the citation attached to the first relevant chunk. These fields are intentionally separate: the exact target may appear later in the ranked list, or not at all.

| Source | Case | Evidence rank | Exact cite rank | Target | Cited time | Absolute distance |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| [Judson Brewer](https://www.youtube.com/watch?v=-moW9jvvMr4&t=69s) | `reward-based-habit-learning` | 1 | 1 | 69.8 s | 69.8 s | 0 s |
| [Judson Brewer](https://www.youtube.com/watch?v=-moW9jvvMr4&t=391s) | `curiosity-and-urges` | 3 | 3 | 391.4 s | 391.4 s | 0 s |
| [Judson Brewer](https://www.youtube.com/watch?v=-moW9jvvMr4&t=69s) | `habit-learning-mechanism` | 1 | — | 69.8 s | 128.6 s | 58.8 s |
| [Julian Treasure](https://www.youtube.com/watch?v=eIho2S0ZahI&t=49s) | `first-harmful-speech-habit` | 1 | 1 | 49.1 s | 49.1 s | 0 s |
| [Julian Treasure](https://www.youtube.com/watch?v=eIho2S0ZahI&t=208s) | `hail-authenticity` | 1 | — | 208.3 s | 198.9 s | 9.4 s |
| [Julian Treasure](https://www.youtube.com/watch?v=eIho2S0ZahI&t=224s) | `hail-love` | 1 | 2 | 224.4 s | 255.3 s | 31.0 s |
| [3Blue1Brown](https://www.youtube.com/watch?v=aircAruvnKk&t=917s) | `what-neurons-hold` | 3 | 3 | 917.8 s | 917.8 s | 0 s |
| [3Blue1Brown](https://www.youtube.com/watch?v=aircAruvnKk&t=548s) | `connection-weight-assignment` | — | — | 548.7 s | — | — |
| [3Blue1Brown](https://www.youtube.com/watch?v=aircAruvnKk&t=556s) | `connection-weight-values` | 1 | 1 | 556.3 s | 556.3 s | 0 s |
| [Simon Sinek](https://www.youtube.com/watch?v=qp0HIF3SfI4&t=121s) | `golden-circle-name` | 1 | — | 121.3 s | 20.3 s | 101.0 s |
| [Simon Sinek](https://www.youtube.com/watch?v=qp0HIF3SfI4&t=667s) | `innovation-diffusion-law` | 2 | 2 | 667.7 s | 667.7 s | 0 s |
| [Simon Sinek](https://www.youtube.com/watch?v=qp0HIF3SfI4&t=29s) | `apple-example-question` | 2 | 2 | 29.3 s | 29.3 s | 0 s |
| [Dan Pink](https://www.youtube.com/watch?v=rrkrvAUbU9Y&t=111s) | `candle-task-name` | 1 | — | 111.4 s | 128.8 s | 17.4 s |
| [Dan Pink](https://www.youtube.com/watch?v=rrkrvAUbU9Y&t=761s) | `autonomy-definition` | 2 | — | 761.2 s | 757.9 s | 3.3 s |
| [Dan Pink](https://www.youtube.com/watch?v=rrkrvAUbU9Y&t=757s) | `intrinsic-motivator-list` | 4 | — | 757.9 s | 743.4 s | 14.5 s |
| [Ken Robinson](https://www.youtube.com/watch?v=iG9CE55wbtY&t=366s) | `school-treatment-of-mistakes` | 2 | 2 | 366.7 s | 366.7 s | 0 s |
| [Ken Robinson](https://www.youtube.com/watch?v=iG9CE55wbtY&t=1051s) | `gillian-lynne-company` | 1 | 1 | 1051.1 s | 1051.1 s | 0 s |
| [Ken Robinson](https://www.youtube.com/watch?v=iG9CE55wbtY&t=48s) | `human-creativity` | 4 | 4 | 49.0 s | 49.0 s | 0 s |

The local report includes each question, its anchor phrase and segment index, citation URL, exact-segment rank, and deduplication counts. That makes mismatches inspectable without copying full transcripts into the repository. The raw JSON is generated locally and remains ignored by Git.

## Product implication

The first paired comparison showed improved ordering and timestamp proximity while preserving the original six-query Recall@5. The broader set confirms strong chunk recall, but the exact-segment metric exposes a separate citation-selection gap, especially for definition questions. The median time offset alone hid outliers: the p90 was 58.80 seconds and the maximum was 101 seconds.

**Recommended next step:** review exact-segment mismatches in the video player, then run a small, explicitly reviewed provider-backed answer sample to judge whether the selected citation supports the generated answer. Tune citation selection only where that audit confirms a real mismatch. Keep PostgreSQL full-text search as the measured baseline; decide about a second input adapter or hybrid semantic retrieval after this targeted review.

## Limitations

- The original paired comparison uses three educational videos and six hand-selected anchors. Dataset v2 grows that to six videos and 18 labels, but remains a convenience sample dominated by public educational talks on YouTube.
- A hit means the chunk covers a manually selected support segment. Exact segment identity is a strict metric and does not establish that a generated answer is complete, factually correct, or supported strongly enough for a reader.
- Link validation checks the expected video ID and timestamp parameter; it does not automate playback, independently review the generated answer, or verify a person's perceived seek quality.
- The reranking comparison uses the same three sources and six labels as the baseline. It is a paired diagnostic, not an independently sampled validation set.
- The sample uses `Recall@5`, while the existing synthetic fixture reports `Recall@3 = 0.75`; the scores should not be compared directly because their cutoffs and corpora differ.
- Caption access varies by environment. GitHub-hosted runners could not fetch these same captions, while the local run could.

## Reproduction

Use a fresh isolated `vidscribe_test` database and run `npm run eval:real-sources` with `NODE_ENV=test` and `VIDSCRIBE_TEST_DATABASE_URL` set. The runner rejects non-test database names, records a JSON report at the repository root, and removes only rows it created. See the root README and [CI validation decision](../decisions/ci-validation-workflow.md) for the isolated Compose setup and opt-in hosted workflow.
