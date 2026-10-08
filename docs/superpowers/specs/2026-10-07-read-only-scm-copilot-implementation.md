# Read-Only SCM Copilot Implementation Spec

## Objective

Improve the existing read-only SCM Copilot without changing SCM workflows, permissions, or write behavior.

## Required behavior

- Continue using `OPENROUTER_API_KEY`.
- Continue using `OPENROUTER_COPILOT_MODEL` independently from document extraction.
- Continue returning normal Markdown/text instead of requiring structured output.
- Support a configurable Copilot output limit from 8,000 to 10,000 tokens.
- Keep CSV and browser PDF export local; these actions must not call OpenRouter again.
- Preserve current role and company filtering.
- Keep the Copilot read-only.

## Configuration

Add `OPENROUTER_COPILOT_MAX_TOKENS`.

- Default: `8192`
- Minimum accepted value: `8000`
- Maximum accepted value: `10000`
- Invalid values fall back to `8192`.

## Cost controls

- Limit the model output with `max_tokens`.
- Instruct the model to stay concise and avoid repeating the data snapshot.
- Keep data retrieval and report generation inside the API/frontend.
- Add a per-user in-memory request limit to prevent accidental request loops.
- Do not add background, scheduled, or automatic model calls.

## Reliability and compatibility

- Do not require `response_format`, JSON Schema, or provider parameter matching.
- Accept normal text responses from free and fixed OpenRouter models.
- Retry a free-router response once when it returns an empty response.
- Return a clear `503` message when OpenRouter is unavailable.
- Log status, model, choice count, and response shape only; never log prompts, SCM snapshots, API keys, or generated report contents.

## Testing and verification

- API and web production builds must pass.
- Existing web tests must pass.
- Verify the token configuration clamp for invalid, low, high, and valid values.
- Verify the request limiter rejects excess requests without affecting other users.
- Verify the Copilot remains read-only and existing API routes are unchanged.
- Verify Markdown rendering and local PDF/CSV export remain functional.

## Deferred work

- Natural-language filter extraction
- Source-record links
- Saved report templates
- Persistent usage metering
- Scheduled reports

