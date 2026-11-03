# Decision: Evaluate evidence retrieval against explicit transcript anchors

**Status:** Accepted as a diagnostic evaluation method
**Date:** 2026-11-03
**Dataset:** `backend/scripts/real-source-search.dataset.ts`, version 2

## Problem

The first real-source benchmark selected its target with the first segment containing a broad keyword. Common or repeated terms can identify a segment that is not the intended support. It also treated a chunk containing the target as a good citation, even though the user sees a narrower caption segment. That left evidence recall, citation selection, and answer correctness conflated.

## Naive approach

- Search for the first occurrence of a generic `anchorTerm` and call any chunk containing it relevant.
- Use median timestamp distance as the sole citation-quality score.
- Call a successful provider response proof that its supporting citation is correct.
- Make the live-source evaluation a required pull-request test.

## Why those approaches are problematic

- The first occurrence of a word can be unrelated to the question; repeated phrases can silently move the target when captions change.
- A median hides long-tail errors. In dataset v2, the median citation start distance is zero seconds while the p90 is 58.80 seconds and the maximum is 101 seconds.
- Provider output can be fluent but unsupported, and an answer-only result cannot separate retrieval failure from generation failure.
- YouTube caption availability changes by environment. Requiring live fetches in CI would make the merge gate network-dependent and nondeterministic.

## Chosen approach

Maintain an explicit, versioned, provider-free evaluation dataset. Each case includes a source/topic, question, query style, short anchor phrase, and optional zero-based occurrence. The runner:

1. Ingests public caption sources through the normal YouTube and transcript path into a fresh isolated PostgreSQL test database.
2. Selects the exact canonical transcript segment containing the normalized anchor phrase. Case and whitespace differences are ignored. Ambiguous phrases require an explicit occurrence; a missing phrase fails the evaluation instead of silently choosing another target.
3. Reports **evidence chunk recall** when a retrieved chunk's range contains the labeled segment's start.
4. Separately reports **exact labeled-segment citation** when a result cites the same canonical segment index. This strict identity check flags cases for review; it does not decide whether an adjacent segment is semantically sufficient.
5. Reports rank metrics, citation start-distance median/p90/maximum, valid timestamp-link rate, deduplication count, and results by query style and source.
6. Makes no LLM/provider calls. Marks generated-answer support as not evaluated. Deletes only the source rows it created and closes its pool in `finally`.

The raw JSON report is ignored by Git. The manually curated short anchor phrases and aggregated outcomes are documented; the repository does not store full transcripts or model prompts.

## Why this is appropriate now

This approach uses the canonical transcript segment table already used by the product, needs no migration or production service, and gives a reviewer a reproducible target and timestamp to inspect. The current dataset has 18 questions across six public educational videos and six topic labels. It expands the original six-query baseline while preserving a provider-free measurement boundary.

Dataset v2 measured evidence Recall@5 of 0.944 (17/18), MRR of 0.676, and exact labeled-segment citation at rank five in 0.611 of cases (11/18). Definition-style cases had exact citation@5 of 0.25 (1/4), versus 0.778 (7/9) for lexical queries and 0.60 (3/5) for paraphrases. All 17 evidence-found cases produced valid video/timestamp URLs. The maximum citation-start distance was 101 seconds despite a zero-second median. These are diagnostic signals from a small convenience set, not broad quality estimates.

## Example

A case asks what autonomy means and labels the transcript segment containing the definition. The report records the segment index/time, the rank of a chunk containing that time, and whether any returned citation selects that exact segment. If the chunk is found but its citation selects a different segment, evidence recall and exact citation support show different outcomes. A reviewer can follow the generated timestamp URL and decide whether the selected passage or a neighboring caption actually supports an answer.

## Failure scenario

- If a source's captions cannot be fetched, the report records the source failure and continues; the run fails its minimum-coverage threshold if fewer than four sources or twelve queries remain.
- If a label phrase disappears or is misspelled, anchor selection fails with the source and phrase rather than substituting another occurrence.
- If a phrase appears multiple times without an explicit occurrence, the label is rejected as ambiguous.
- If the database is not an empty database named for tests, the runner refuses to execute.
- If answer generation would be unavailable or billable, it is irrelevant to this evaluation: provider calls remain zero.

## Concurrency scenario

The evaluation is an opt-in single-run job against a dedicated empty database. It rejects existing source rows rather than truncating them, tracks the IDs it created, deletes those IDs in `finally`, and closes its connection pool. Do not run two copies concurrently against the same test database; each needs its own isolated database/container. Pull-request CI continues using deterministic fixtures instead of caption downloads.

## Trade-offs

- **Gain:** explicit support anchors, reproducible phrase occurrence selection, separate recall and citation measures, query-style breakdowns, and long-tail timestamp visibility.
- **Cost:** anchor phrases and query labels require human curation; the current 18-case set is still small and concentrated on public educational YouTube talks.
- **Strictness:** exact segment index can mark a useful neighboring caption as a miss. Use the video and answer audit to judge semantics; do not optimize this metric alone.
- **Boundary:** no generated answers are evaluated. A provider-backed review must use a controlled sample and separately record whether the final answer is supported by its cited segment.
- **Operations:** caption access may fail on hosted runners, so the real-source workflow remains manual/opt-in and its results cannot gate every pull request.

## Alternatives

- **Keyword-first labeling:** rejected because repeated/common terms can silently select an irrelevant target.
- **Score only the time distance:** rejected as a sole signal because timestamp closeness does not prove that the excerpt supports the question, and the median hid a 101-second outlier.
- **LLM-judge every response:** deferred; it adds provider cost, secret dependency, and judge bias. First create a human-reviewed answer/citation sample.
- **Use real YouTube fetches in required CI:** rejected because caption retrieval is network-dependent; CI retains synthetic PostgreSQL and provider-free browser checks.
- **Add semantic/vector retrieval now:** deferred until a larger reviewed set demonstrates whether lexical recall or citation segment selection is the dominant gap.

## Update: playback shows exact identity and offset are not enough

The eight non-exact/offset/missing cases in dataset v2 were opened in the captioned video player. This confirmed the Golden Circle and habit-learning timestamps were unrelated to the direct answer, and the HAIL-love citation was late and did not identify love. Other cases were more nuanced: the HAIL-authenticity link was a useful lead-in about nine seconds early, while Dan Pink's autonomy citation was only about three seconds early but showed a list rather than the requested definition. A weight-assignment passage was visible at its label but had no top-five result.

Therefore the answer evaluation will label answer correctness, citation entailment/support, citation usefulness, and likely failure stage separately. Timestamp distance remains an operational signal, not a support score. The five-question Gemini sample is specified in the [human-reviewed audit](../evaluations/human-reviewed-citation-answer-2026-11-03.md) but remains unscored: this evaluation process cannot decrypt the saved key and its chat attempt failed before provider dispatch. The user reported a successful UI answer, but that answer is not in this process's conversation record, so it cannot yet be used as evidence. No provider usage was recorded by the failed evaluation attempt.

Do not tune the ranker on the answer sample and use those same questions as a final validation score. Treat them as development examples and add held-out human-reviewed cases after a change.

## Interview explanation

“I made the retrieval benchmark distinguish finding a relevant chunk from citing the exact supporting caption. Each query has a manually selected transcript anchor phrase and an explicit occurrence if it repeats. This avoids a loose first-keyword label, while the exact segment check remains only a diagnostic: a neighboring sentence may still support the answer. I report rank and timestamp tail metrics and keep the run provider-free, so it is repeatable and does not imply answer correctness. Generated-answer support needs a separate human-reviewed sample.”

## References

- [Dataset v2](../../backend/scripts/real-source-search.dataset.ts)
- [Anchor-selection utility](../../backend/scripts/real-source-search.labels.ts)
- [Provider-free evaluation runner](../../backend/scripts/evaluate-real-source-search.ts)
- [Results and limitations](../evaluations/real-source-search-2026-11-03.md)
- [PostgreSQL retrieval service](../services/postgres-full-text-search.md)
