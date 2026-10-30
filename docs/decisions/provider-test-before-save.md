# Test Provider Configuration Before Saving

## Problem

The earlier settings flow saved a model/key before verifying that the provider accepted the credential and model. A typo could replace a working configuration, and the user would discover the failure later while asking a question.

## Naive approach

Save the key and model first, switch the active provider, then let the next real question reveal whether configuration works.

## Why it is problematic

The configuration can become active while unusable. The failed test is mixed with a real user turn, and the user may not know whether the problem was the provider key, model ID, retrieval, or prompt. Saving first can also overwrite a working credential with a rejected replacement.

## Chosen approach

The settings UI sends a short provider-specific generation request using the proposed model and either the submitted key or saved key. It discards generated text. If the call succeeds, the backend encrypts any replacement key and commits the model/key configuration plus active-provider setting in one short PostgreSQL transaction. If the call fails, no configuration is written. Ollama uses the same pattern without an API key.

## Example

The user selects Gemini, changes the model, and enters a key. VidScribe sends a one-line test prompt. On success, one transaction saves the model and encrypted key and marks Gemini active. The user sees a latency confirmation and future answers use the tested configuration.

## Failure scenario

If the model rejects the key, the adapter returns a sanitized error and the existing active configuration remains unchanged. If the provider accepts the test but PostgreSQL fails during commit, the user may incur the small test usage but the active configuration remains unchanged because the transaction rolls back.

## Concurrency scenario

One settings page disables the button while a test is active. If two tabs test different providers at the same time, both calls can succeed and their short transactions commit in completion order; the last transaction selects the active provider. This is acceptable for the current single-user local app, but multi-user/workspace settings should add versioning or scoped active-provider state.

## Trade-offs

- A real generation test is closer to verifying the selected model can answer, but it can incur usage. A model-list call may be cheaper, but listing access does not guarantee the account can generate with that model.
- Test and database commit cannot be one distributed transaction. A successful remote call can be charged even if local persistence later fails.
- The test text is discarded and no conversation row is created.
- Logs retain latency and reported token usage, not the key, prompt, or generated text.

## Alternatives

1. **Save without a test:** avoids extra provider requests, but leaves configuration errors to appear during real answer generation. Rejected for this explicit test-and-save UX.
2. **Provider model-list endpoint:** useful for browsing models, but differs by provider and only proves listing access. Defer until model catalogs are a product requirement.
3. **Probe each provider on page load:** creates unexpected network calls and potential usage when the user merely opens settings. Rejected; the test is user-triggered.

## Interview explanation

We test the proposed configuration before changing active settings. The external model call runs outside a database transaction; after success, a short transaction atomically writes the encrypted key/model and active provider. A failed test leaves the previous configuration intact. Because PostgreSQL and the provider cannot share a transaction, a provider may charge for a successful test even if the later database commit fails; we make the request small and surface that usage may occur.
