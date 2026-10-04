# SCM Business Operating System

This workspace contains the namespaced SCM v2 workflow from the PRD. It uses React/Vite/Tailwind in `apps/web`, NestJS in `apps/api`, and Supabase for PostgreSQL data and authentication.

## Local startup

1. Create a Supabase project.
2. Apply every migration in `supabase/migrations` in filename order. The `20261003...` and `20261004...` files create the v2 schemas and API workflow helpers.
3. In Supabase API settings, expose these schemas: `iam`, `master_data`, `documents`, `scm`, `inventory`, and `platform`.
4. Copy `.env.example` to `apps/api/.env` and add the project URL, anon key and service role key. Keep the service role key server-side.
5. Install dependencies: `pnpm install`.
6. Seed v2 demo data: `pnpm supabase:seed`.
7. Start both apps: `pnpm dev`.

If pnpm cannot access its global store on Windows, run the seed directly with `npm --prefix apps/api run seed`.

Open `http://localhost:5173`. Demo accounts use password `demo123`: `admin@scm.local`, `manager@scm.local`, `team@scm.local`, and `qc@scm.local`.

The API exposes document extraction at `POST /api/documents/extract`. PDF files are stored under `storage/documents`, normalized for Amazon/RK World, Flipkart, and Blinkit, and registered as versioned v2 documents. The UI supports PO review, independent acceptance and appointment gates, reservation, shipment planning and dispatch, POD confirmation, short close, and invoice upload.

## Validation

Run `npm test` and `npm run build` in `apps/api`, then `npm run build` in `apps/web`. Run `supabase/tests/scm_v2_validation.sql` and `supabase/tests/scm_v2_workflow_smoke.sql` against a migrated test project.
