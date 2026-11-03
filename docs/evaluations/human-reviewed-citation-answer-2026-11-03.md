# Human-reviewed citation and answer evaluation

**Date:** 2026-11-03  
**Status:** Timestamp review complete; provider-backed answer review blocked by a runtime/result mismatch  
**Sources:** Five public captioned YouTube talks; eight labeled question cases

## Purpose

The provider-free benchmark showed that a retrieved chunk can cover the labeled transcript segment while the UI citation points somewhere else. This audit checks those targets in the actual YouTube player and separates a useful lead-in from a citation that independently contains the answer. A small Gemini answer sample is defined below. The local database reports Gemini as configured, but chat requests from the evaluation process could not decrypt the saved ciphertext. The user reported that the settings test and a UI answer succeeded, but that answer was not present in this process's conversation record, so it cannot yet be independently scored or attributed to this run.

This is a diagnostic sample, not a product-wide quality claim. It does not justify selecting a second source type or adding semantic retrieval by itself.

## Review method

For each available case, I opened the public video in YouTube's player with captions, paused at the labeled transcript timestamp, and then paused at VidScribe's cited timestamp. I compared the displayed caption and slide/context against the question. The target time is the manually labeled transcript segment; the cited time is the first relevant chunk's selected citation from dataset v2. A timestamp close to the answer can still be a weak citation if its displayed evidence does not answer the question.

| Case | Target point observed in player | VidScribe citation point observed | Human judgment |
| --- | --- | --- | --- |
| Judson Brewer — [habit-learning mechanism](https://www.youtube.com/watch?v=-moW9jvvMr4&t=70s) | 69.84 s; caption states the reward-based learning process. | 128.64 s; the player is on the later cake example. | **Unrelated for this question.** The citation lands about 58.8 seconds after the directly labeled explanation. |
| Julian Treasure — [HAIL authenticity](https://www.youtube.com/watch?v=eIho2S0ZahI&t=208s) | 208.25 s; caption says the A is authenticity and briefly defines it. | 198.90 s; the caption asks what the HAIL letters stand for. | **Useful lead-in, not a self-contained answer.** It is about 9.4 seconds early and naturally leads into the answer. |
| Julian Treasure — [HAIL love](https://www.youtube.com/watch?v=eIho2S0ZahI&t=224s) | 224.36 s; caption identifies L as love and the slide shows the HAIL list. | 255.31 s; the caption says “So hail” while the player shows the audience. | **Poor citation.** It is about 31 seconds late and does not identify love. |
| 3Blue1Brown — [connection-weight assignment](https://www.youtube.com/watch?v=aircAruvnKk&t=549s) | 548.72 s; the caption says a weight is assigned to each connection. | No evidence or citation was returned in the top five. | **Retrieval miss, not a timestamp miss.** The player confirms an answer-bearing passage exists at the label. |
| Simon Sinek — [Golden Circle name](https://www.youtube.com/watch?v=qp0HIF3SfI4&t=121s) | 121.26 s; caption names the Golden Circle. | 20.26 s; Sinek is still setting up the question of how to explain the idea. | **Unrelated for the asked fact.** The citation is about 101 seconds before the answer. |
| Dan Pink — [candle task name](https://www.youtube.com/watch?v=rrkrvAUbU9Y&t=111s) | 111.43 s; caption calls it the candle problem. | 128.80 s; Pink describes the candle, thumbtacks, and matches. | **Related context, but it omits the requested name.** It is about 17.4 seconds after the direct answer. |
| Dan Pink — [autonomy definition](https://www.youtube.com/watch?v=rrkrvAUbU9Y&t=761s) | 761.16 s; caption defines autonomy as the urge to direct one's own life. | 757.89 s; caption lists autonomy, mastery, and purpose. | **Not sufficient for the definition.** The offset is only 3.3 seconds, but the citation gives the category list rather than the meaning. |
| Dan Pink — [three intrinsic motivators](https://www.youtube.com/watch?v=rrkrvAUbU9Y&t=758s) | 757.89 s; caption lists autonomy, mastery, and purpose. | 743.37 s; caption says the approach is built more around intrinsic motivation. | **Setup, not the requested list.** It is about 14.5 seconds early. |

The player checks confirm that the zero-second median in the benchmark does not mean citations are always answer-bearing. They also show why exact segment identity and timestamp distance should remain diagnostic signals rather than the sole user-quality label: a short lead-in can be useful, while a nearby list can fail to support a definition.

Screenshots captured during this local review are under the ignored `output/playwright/` directory. The timestamped source links above let reviewers replay the same moments; screenshots are not committed because the report should not depend on generated local browser artifacts.

## Human-checked Gemini sample

Use these five questions after the local database and configured Gemini provider are available. Their reference evidence is visible at the linked timestamp and was checked above.

| Question | Source | Reference answer | Reference evidence |
| --- | --- | --- | --- |
| What does the A in HAIL stand for? | Julian Treasure | Authenticity; being yourself. | [208.25 s](https://www.youtube.com/watch?v=eIho2S0ZahI&t=208s) |
| What does the L in HAIL represent? | Julian Treasure | Love. | [224.36 s](https://www.youtube.com/watch?v=eIho2S0ZahI&t=224s) |
| What does Sinek call his model for explaining why companies inspire? | Simon Sinek | The Golden Circle. | [121.26 s](https://www.youtube.com/watch?v=qp0HIF3SfI4&t=121s) |
| Which three intrinsic motivators does Pink name? | Dan Pink | Autonomy, mastery, and purpose. | [757.89 s](https://www.youtube.com/watch?v=rrkrvAUbU9Y&t=758s) |
| In Pink's model, what does autonomy mean? | Dan Pink | The urge to direct one's own life. | [761.16 s](https://www.youtube.com/watch?v=rrkrvAUbU9Y&t=761s) |

Generate answers through VidScribe's ordinary source-chat path using the configured Gemini model, then record each answer, returned citation excerpt/time, provider/model, latency, and reported token usage. Do not copy credentials or full transcripts into the report. A human reviewer should independently score:

- **Answer correctness:** correct, partial, incorrect, or abstains.
- **Evidence support:** every material answer claim is supported, partly supported, or unsupported by the returned citation(s).
- **Citation usefulness:** direct answer, useful lead-in, contextual only, irrelevant, or missing.
- **Failure location:** candidate retrieval, citation selection, generation, or unclear.

Keep the provider prompt and set fixed for the sample. This is a small usability/quality audit, not a statistical estimate. Do not tune ranking against the same five cases and then call them an independent validation set; keep them as a development set and add new held-out cases after any change.

### Attempted provider-backed check

The first question, “What does the A in HAIL stand for?”, was submitted through the evaluation API with the existing failed turn ID so it would safely retry rather than create a duplicate. PostgreSQL retrieved three chunks (13 ms); generation failed in about 20 ms with `AI_PROVIDER_KEY_UNAVAILABLE`, before Gemini dispatch. The user subsequently reported that the UI returned an answer and citation, but the evaluated process's conversation still contained only the failed assistant turn and its request log contained no successful answer or settings-test request. The result may belong to a different app/runtime context; without its actual answer and citation excerpt, it cannot be scored. No provider usage was recorded by the failed evaluation attempt.

## Current interpretation and next decision

Playback confirms actual citation-selection weaknesses, including both large offsets and close-but-insufficient citations. One obvious passage was also absent from the top five, so candidate retrieval remains a separate concern. The provider-backed answer review is not complete because the reported successful result is not observable in the evaluation process. Do not change the ranker based on the timestamp audit alone. Once the app/runtime mismatch is resolved and the five answers are recorded, tune citation selection or citation-context windows if answers are correct but citations fail to support them. Investigate lexical candidate recall when a needed passage is absent; keep semantic retrieval deferred until a broader held-out set shows lexical search is the limiting factor.

## Environment blocker

The local database initially had migrations 001–004 only. Before applying migrations 005–006, a valid custom-format backup was written to the ignored `tmp/vidscribe_rag-before-migrations-20261103.dump`; the two migrations applied successfully, preserving two source rows, one provider config, and eight messages while correcting the legacy chunk timestamps. The user reported a successful Gemini connection test and answer in the UI, but this evaluation process continued to fail decryption before provider dispatch; the corresponding answer was not present in this process's database. Reconcile which app/runtime produced the reported answer, or provide its answer and citation excerpt for human scoring. The three temporary evaluation sources were removed; the original two library sources remain. The temporary app processes were stopped; the app did not return health responses on ports 3000 or 8000 afterward.

