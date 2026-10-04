# OpenRouter primary document extraction

## Goal

Replace the fragile regex-first extraction flow with OpenRouter as the primary extractor. Use `openai/gpt-4o-mini` and keep deterministic extraction as an availability fallback.

## Input flow

- Send PDF files directly to OpenRouter so the model can use native PDF and vision input.
- Parse XLSX, CSV, and DOCX locally and send structured text because native Office-file input is not required.
- Request strict JSON matching the existing `NormalizedDocument` shape.
- Keep the model configurable through `OPENROUTER_MODEL`, defaulting to `openai/gpt-4o-mini`.
- Keep the OpenRouter API key on the server.

## Validation and fallback

- Validate every AI response against the application schema before registration or PO creation.
- Require absent values to be `null`; prompts must forbid invented values.
- Calculate confidence in the API from required-field coverage and consistency checks rather than trusting model confidence.
- Validate identifiers, dates, quantities, totals, and PO line consistency.
- Use a 30-second request timeout and retry once for timeouts, invalid JSON, or schema failures.
- Run the current rule extractor only when both AI attempts fail.
- Send results that still fail validation to manual review.

## Privacy and observability

- Request zero-data-retention routing and deny provider data collection.
- Record extraction method, model, warnings, latency, token usage, and fallback reason without logging document contents or credentials.
- Preserve the original document and existing editable review flow.

## Testing

- Build anonymized fixtures and expected JSON for each supported platform and document type.
- Cover PDF, scanned PDF, XLSX, CSV, and DOCX inputs.
- Test valid AI output, missing fields, hallucinated values, invalid JSON, timeout, retry, provider failure, deterministic fallback, and manual review.
- Compare extraction accuracy at header and line-item level before enabling the feature by default.

## Success criteria

- AI extraction is the default path and returns schema-valid output.
- No invalid AI response reaches persistence.
- Provider failures do not block uploads because deterministic fallback and manual review remain available.
- Real sample accuracy is measurably better than the current regex-first implementation.
