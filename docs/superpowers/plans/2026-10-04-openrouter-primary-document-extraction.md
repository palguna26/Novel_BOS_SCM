# OpenRouter primary extraction implementation plan

## Summary

Add `openai/gpt-4o-mini` as the primary document extractor through OpenRouter while preserving deterministic fallback and manual review.

## Changes

1. Add an isolated OpenRouter extraction service with strict JSON schema, server-side validation, a 30-second timeout, one retry, ZDR routing, and token/latency metadata.
2. Send PDFs as private base64 file inputs. Send locally extracted XLSX, CSV, and DOCX text as text input.
3. Recalculate confidence and warnings locally, then fall back to `normalizeDocument` when AI extraction is unavailable or invalid.
4. Add `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and optional API URL settings without exposing secrets to the browser.
5. Add tests for valid extraction, missing configuration, invalid JSON/schema, retry, timeout/provider failure, and deterministic fallback.

## Acceptance

- AI is attempted first whenever an API key is configured.
- Only schema-valid normalized results reach persistence.
- Provider failures still return deterministic or manual-review results.
- API tests and builds pass without requiring live OpenRouter calls.
