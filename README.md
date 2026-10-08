# SCM Business Operating System

[Read the Product Doc](PRODUCT-DOC.md) for the product overview, architecture, data flows, page reference, and implementation map.
[Read the user guide](USER-GUIDE.md) for page explanations, data-entry instructions, and the full PO-to-invoice workflow.

This workspace contains the namespaced SCM v2 workflow from the PRD. It uses React/Vite/Tailwind in `apps/web`, NestJS in `apps/api`, and Supabase for PostgreSQL data and authentication.

## Local startup

1. Create a Supabase project.
2. Apply every migration in `supabase/migrations` in filename order. The `20261003...` and `20261004...` files create the v2 schemas and API workflow helpers.
3. In Supabase API settings, expose these schemas: `iam`, `master_data`, `documents`, `scm`, `inventory`, and `platform`.
4. Copy `.env.example` to `apps/api/.env` and add the project URL, anon key and service role key. Keep the service role key server-side.
5. Install dependencies: `pnpm install`.
6. Seed v2 demo data: `pnpm supabase:seed`.
7. Start both apps: `pnpm dev`.

To load the real-file-derived SCM Detail test data after applying the migrations, run `npm --prefix apps/api run seed:scm-detail`. This creates the normalized warehouse, location, channel, SKU, channel-identifier, destination-mapping, route, opening-stock, and sample PO records described in [`data/scm-detail-seed.json`](data/scm-detail-seed.json). The script is idempotent for the seeded records.

If pnpm cannot access its global store on Windows, run the seed directly with `npm --prefix apps/api run seed`.

Open `http://localhost:5173`. Demo accounts use password `demo123`: `admin@scm.local`, `manager@scm.local`, `team@scm.local`, and `qc@scm.local`.

The API exposes document extraction at `POST /api/documents/extract`. PDF, XLSX, CSV, and DOCX files up to 10 MB are stored under `storage/documents`, normalized for Amazon/RK World, Flipkart, and Blinkit, and registered as versioned v2 documents. The UI supports these formats for PO, appointment, POD, and invoice uploads, plus PO review, independent acceptance and appointment gates, reservation, shipment planning and dispatch, short close, and invoice processing.

Document extraction uses OpenRouter first when `OPENROUTER_API_KEY` is configured. The default model is `openai/gpt-4o-mini`; override it with `OPENROUTER_MODEL`. Requests enforce structured output, zero-data-retention routing, and denied provider data collection. If OpenRouter is unavailable or returns invalid data, the API falls back to the deterministic normalizer and flags weak results for review.

The read-only SCM Copilot uses the same `OPENROUTER_API_KEY` through `POST /api/copilot/ask`. Set `OPENROUTER_COPILOT_MODEL` to choose its model independently from document extraction. `OPENROUTER_COPILOT_MAX_TOKENS` defaults to 8192 and is clamped to 8,000–10,000; `OPENROUTER_COPILOT_MAX_REQUESTS_PER_MINUTE` defaults to 20. By default, the copilot does not force ZDR routing because some models have no ZDR endpoints; set `OPENROUTER_COPILOT_ZDR=true` or `OPENROUTER_COPILOT_DATA_COLLECTION=deny` when the selected model and OpenRouter account support those policies. It uses the signed-in user's permitted SCM data, returns grounded Markdown answers, logs the request in Audit Log, and supports local CSV/PDF export from the Copilot panel.

## Validation

Run `npm test` and `npm run build` in `apps/api`, then `npm run build` in `apps/web`. Run `supabase/tests/scm_v2_validation.sql` and `supabase/tests/scm_v2_workflow_smoke.sql` against a migrated test project.
