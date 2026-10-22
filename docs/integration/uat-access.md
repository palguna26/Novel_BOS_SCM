# Sales Integration UAT Access

Use this checklist to give the Sales Module read-only access to SCM data.

## UAT URLs

- Frontend: `https://novel-bos-scm.onrender.com`
- Backend: `https://novel-scm-api.onrender.com`
- Integration API: `https://novel-scm-api.onrender.com/api/v1/integration`
- Swagger: `https://novel-scm-api.onrender.com/api/docs`

## 1. Confirm the Supabase project

In Supabase, confirm that the UAT project is the one configured by `SUPABASE_URL` in Render. Apply all migrations through the latest migration in the repository.

In Project Settings -> API -> Exposed schemas, include:

```text
iam, master_data, documents, workflow, scm, inventory, quality, planning,
procurement, manufacturing, finance, platform, compat, integration
```

Confirm that the `integration` tables and views are available and that the required RLS/security policies have been reviewed before issuing a credential.

## 2. Configure the Render API service

In the `novel-scm-api` service, set:

```text
WEB_URL=https://novel-bos-scm.onrender.com
SALES_INTEGRATION_COMPANY_ID=<the Sales tenant company UUID>
SALES_INTEGRATION_SCOPES=master:read,inventory:read,po:read,fulfilment:read,movement:read,changes:read
```

Generate a long random token locally. Do not put the token in Git or this document. Set it as:

```text
SALES_INTEGRATION_TOKEN=<random UAT token>
```

Save the variables and redeploy the API. The token is tenant-scoped because the company ID is configured on the API service, not accepted from query parameters.

## 3. Test authentication

Without a token, this request must return `401`:

```powershell
curl.exe -i https://novel-scm-api.onrender.com/api/v1/integration/health
```

With the UAT token, it must return `200` and show `apiVersion: "v1"`:

```powershell
curl.exe -i `
  -H "Authorization: Bearer <UAT_TOKEN>" `
  -H "Accept: application/json" `
  https://novel-scm-api.onrender.com/api/v1/integration/health
```

Then test one endpoint from every scope:

```powershell
curl.exe -H "Authorization: Bearer <UAT_TOKEN>" https://novel-scm-api.onrender.com/api/v1/integration/products?limit=2
curl.exe -H "Authorization: Bearer <UAT_TOKEN>" https://novel-scm-api.onrender.com/api/v1/integration/inventory?limit=2
curl.exe -H "Authorization: Bearer <UAT_TOKEN>" https://novel-scm-api.onrender.com/api/v1/integration/purchase-orders?limit=2
curl.exe -H "Authorization: Bearer <UAT_TOKEN>" https://novel-scm-api.onrender.com/api/v1/integration/shipments?limit=2
curl.exe -H "Authorization: Bearer <UAT_TOKEN>" https://novel-scm-api.onrender.com/api/v1/integration/inventory-movements?limit=2
curl.exe -H "Authorization: Bearer <UAT_TOKEN>" https://novel-scm-api.onrender.com/api/v1/integration/changes?limit=2
```

## 4. Share access securely

Send the Sales developer the API URL, not the token, by email. Share the token through 1Password, Bitwarden, Render secret sharing, or another approved secret channel.

The credential should have:

- One company/tenant only
- Read-only scopes only
- An expiry date
- A named owner
- A documented rotation and revocation date

If a token is exposed, replace `SALES_INTEGRATION_TOKEN` in Render, redeploy, and tell Sales to stop using the old token.

## 5. Sales UAT handoff

Give Sales:

1. The integration API URL.
2. The OpenAPI file at `docs/openapi/scm-sales-v1.json`.
3. `Progress/11-sales-integration-api-spec.md`.
4. The assigned scopes and rate limit of 300 requests per minute per client.
5. The rule that all cursors are opaque and must be stored exactly as returned.
6. The rule that `/changes` is the UAT synchronization mechanism; webhooks are not included in this release.
7. Test data identifiers and the expected UAT scenarios.

Do not give Sales Supabase credentials, Render dashboard access, service-role keys, or direct database access.
