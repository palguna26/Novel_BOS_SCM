# Novel SCM deployment guide — free Render UAT setup

This guide deploys the current SCM application for UAT using:

- Render Free Web Service for the NestJS API
- Render Free Static Site for the React/Vite frontend
- The existing Supabase project for database, authentication, and document storage

This setup is suitable for UAT and demos. It is not a proper production setup. Render Free web services sleep after 15 minutes without traffic, can take about a minute to wake up, and have an ephemeral filesystem. Supabase is used for persistent application data and uploaded documents.

Render's free Postgres is deliberately not used. Render documents that its free Postgres database expires after 30 days and has no backups. The application already uses Supabase, so adding a second database would create data and migration risk.

## What you need

1. A GitHub repository containing this project.
2. A Render account.
3. Access to the Supabase project `NOVELBOSSCM`.
4. These Supabase values from Project Settings → API:
   - Project URL: `https://czdixzpfqafyeckjxpit.supabase.co`
   - Publishable/anon key
   - Service role key
5. An OpenRouter API key if AI extraction and Copilot should be enabled.

Do not commit the Supabase service role key or OpenRouter key to GitHub.

## Before deploying

From the repository root, run:

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

The linked Supabase project already has the current migrations applied. Confirm that the migration list includes the latest inventory and PO migrations before deploying the API.

Make sure the Supabase Storage bucket named `scm-documents` exists. The migrations create it, but it is worth checking in Storage → Buckets.

### Supabase API settings required

This application uses custom Postgres schemas through the Supabase Data API. In Supabase, open **Project Settings -> API -> Exposed schemas** and add:

```text
iam, master_data, documents, workflow, scm, inventory, quality, planning,
procurement, manufacturing, finance, platform, compat, integration
```

If these schemas are not exposed, login can work but workspace calls such as `/api/masters` will fail with HTTP 400.

## Recommended deployment method: Render Dashboard

Deploy the API first, then the frontend. This avoids the frontend being built with an unknown API URL.

### 1. Push the code

Commit and push the repository to GitHub:

```powershell
git add .
git commit -m "Prepare free Render UAT deployment"
git push origin main
```

Use the branch that should represent UAT if it is not `main`.

### 2. Create the API service

In Render:

1. Select **New → Web Service**.
2. Connect `palguna26/Novel_BOS_SCM`.
3. Select the UAT branch.
4. Set:

| Setting | Value |
|---|---|
| Name | `novel-scm-api` |
| Root Directory | `apps/api` |
| Runtime | Node |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm run start` |
| Instance Type | Free |
| Health Check Path | `/api/docs` |

Add these environment variables:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://czdixzpfqafyeckjxpit.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase publishable/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `WEB_URL` | Frontend URL; fill this after step 3 |
| `DOCUMENT_STORAGE_BUCKET` | `scm-documents` |
| `EMAIL_CAPTURE` | `true` |
| `SCM_SCHEMA_MODE` | `v2` |
| `OPENROUTER_API_KEY` | OpenRouter key, or leave empty to use deterministic fallback extraction |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` |
| `OPENROUTER_COPILOT_MODEL` | `openai/gpt-4.1-mini` |
| `OPENROUTER_COPILOT_MAX_TOKENS` | `8192` |
| `OPENROUTER_COPILOT_MAX_REQUESTS_PER_MINUTE` | `20` |
| `OPENROUTER_COPILOT_ZDR` | `false` |
| `OPENROUTER_COPILOT_DATA_COLLECTION` | `allow` |
| `OPENROUTER_API_URL` | `https://openrouter.ai/api/v1/chat/completions` |
| `OPENROUTER_TIMEOUT_MS` | `30000` |
| `SALES_INTEGRATION_TOKEN` | Optional; leave empty if unused |
| `SALES_INTEGRATION_COMPANY_ID` | Optional; leave empty if unused |
| `SALES_INTEGRATION_SCOPES` | `master:read,inventory:read,po:read,fulfilment:read,movement:read,changes:read` |

Do not manually set `PORT`. Render supplies it, and the API already listens on `process.env.PORT`.

Click **Create Web Service** and wait for the first deploy to finish. Copy the API URL, for example:

```text
https://novel-scm-api.onrender.com
```

Check that this opens:

```text
https://novel-scm-api.onrender.com/api/docs
```

### 3. Create the frontend static site

In Render:

1. Select **New → Static Site**.
2. Connect the same repository and UAT branch.
3. Set:

| Setting | Value |
|---|---|
| Name | `novel-scm-web` |
| Root Directory | `apps/web` |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |

Add this environment variable before deploying:

| Variable | Value |
|---|---|
| `VITE_API_URL` | The API URL from step 2, without a trailing slash |

Example:

```text
VITE_API_URL=https://novel-scm-api.onrender.com
```

Click **Create Static Site** and wait for the deploy. Copy the frontend URL, for example:

```text
https://novel-scm-web.onrender.com
```

### 4. Finish API CORS configuration

Return to the API service and set:

```text
WEB_URL=https://novel-scm-web.onrender.com
```

Save and redeploy the API. Do not include a trailing slash.

## Optional Blueprint deployment

The repository includes `render.yaml` with the same free API and static-site configuration.

To use it:

1. Push `render.yaml` to GitHub.
2. In Render, choose **New → Blueprint**.
3. Select the repository and branch.
4. Fill every `sync: false` value.
5. Confirm the API and static site are both on the free configuration.
6. Set `VITE_API_URL` to the API's public Render URL before the frontend build.
7. After the frontend URL is known, set the API's `WEB_URL` and redeploy the API.

If the Blueprint flow tries to build the frontend before its API URL is available, use the Dashboard sequence above. It is more reliable for this two-service setup because Vite embeds `VITE_API_URL` at build time.

## UAT login and data

Use the client UAT user already created in Supabase Auth and the corresponding `iam.users` and `iam.user_company_access` records.

Do not run the seed scripts against the client's Supabase project unless you intentionally want demo data. In particular, do not run:

```powershell
pnpm --filter @scm/api seed
pnpm --filter @scm/api seed:legacy
```

The API needs the user to have `can_read = true`. Users who accept or reject POs also need `can_approve = true`.

## First UAT checks

1. Open the frontend and sign in.
2. Upload a client PO PDF.
3. Accept the PO before attaching an appointment.
4. Confirm stock is reserved immediately.
5. Attach the appointment and confirm no duplicate reservation is created.
6. Open Inventory and post an increase and decrease transaction.
7. Confirm both entries appear in Inventory History.
8. Test the over-decrease error.
9. Create a shipment, dispatch it, upload POD, and check delivery/short-close behavior.
10. Export the PO inbox to Excel.

Use [UAT_CHECKLIST.md](UAT_CHECKLIST.md) for the full test list.

## Free-tier limitations

This setup is free for UAT, subject to Render's current included usage limits.

- The API sleeps after 15 minutes without traffic and may take about a minute to wake.
- Render Free web services have ephemeral local files. Do not rely on local email capture or local uploads for persistence.
- Documents are persisted in Supabase Storage, not on Render's filesystem.
- `EMAIL_CAPTURE=true` is recommended for UAT. It records captured emails locally, but those files disappear after restart. Actual SMTP delivery is not configured.
- Render Free services cannot send outbound SMTP traffic on ports 25, 465, or 587. Use an HTTPS email provider integration later if real email sending is required.
- Free Render Postgres is not part of this deployment and should not be added for this app.
- Free is appropriate for UAT/demo use, not production uptime, backups, or SLA requirements.

## Troubleshooting

### Frontend says API unavailable

Check `VITE_API_URL` in the static site and redeploy the static site. Vite reads this variable during build time.

### Browser reports a CORS error

Set the API's `WEB_URL` to the exact frontend URL, with no trailing slash, then redeploy the API.

### Login returns 401

Check that the Render API has the current `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Also confirm the user exists in Supabase Auth, has an active row in `iam.users`, and has a `can_read = true` row in `iam.user_company_access`.

The API intentionally returns 401 when the password is wrong or the user has no active company access.

### `/api/masters` returns 400 after login

Add all custom schemas listed in the Supabase API settings section to **Exposed schemas**, save the setting, then retry. Also confirm `SUPABASE_ANON_KEY` is the current key for this Supabase project.

### API deploy fails immediately

Check that the API Root Directory is `apps/api`, the build command is `npm ci && npm run build`, and all Supabase variables are present.

### Upload fails

Check that the `scm-documents` bucket exists in Supabase and that `SUPABASE_SERVICE_ROLE_KEY` is correct. Never put that key in the frontend service.

### First request is slow

This is expected when the free API service has spun down. Refresh once after it wakes.

## Production upgrade path

Before production, move the API to a paid Render service or another always-on host, add monitoring and backups, configure real email delivery, set a stable custom domain, and run a production migration rehearsal. Keep Supabase backups and the service role key protected.
