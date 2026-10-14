import { ExecutionContext } from '@nestjs/common';
import { afterEach, describe, expect, it } from '@jest/globals';
import { IntegrationGuard } from './integration.guard';

function context(headers: Record<string, string>): ExecutionContext {
  const request = { headers } as any;
  return { switchToHttp: () => ({ getRequest: () => request }) } as any;
}

describe('IntegrationGuard', () => {
  const original = {
    token: process.env.SALES_INTEGRATION_TOKEN,
    company: process.env.SALES_INTEGRATION_COMPANY_ID,
    scopes: process.env.SALES_INTEGRATION_SCOPES,
  };

  afterEach(() => {
    if (original.token === undefined) delete process.env.SALES_INTEGRATION_TOKEN;
    else process.env.SALES_INTEGRATION_TOKEN = original.token;
    if (original.company === undefined) delete process.env.SALES_INTEGRATION_COMPANY_ID;
    else process.env.SALES_INTEGRATION_COMPANY_ID = original.company;
    if (original.scopes === undefined) delete process.env.SALES_INTEGRATION_SCOPES;
    else process.env.SALES_INTEGRATION_SCOPES = original.scopes;
  });

  it('accepts the configured UAT token and attaches tenant scopes', async () => {
    process.env.SALES_INTEGRATION_TOKEN = 'uat-token';
    process.env.SALES_INTEGRATION_COMPANY_ID = 'company-1';
    process.env.SALES_INTEGRATION_SCOPES = 'master:read,po:read';
    const guard = new IntegrationGuard({} as any);
    const requestContext = context({ authorization: 'Bearer uat-token' });

    await expect(guard.canActivate(requestContext)).resolves.toBe(true);
    const request = requestContext.switchToHttp().getRequest() as any;
    expect(request.integration.companyId).toBe('company-1');
    expect([...request.integration.scopes]).toEqual(['master:read', 'po:read']);
  });

  it('accepts a hashed integration client credential', async () => {
    delete process.env.SALES_INTEGRATION_TOKEN;
    delete process.env.SALES_INTEGRATION_COMPANY_ID;
    const token = 'client-prefix.secret';
    const crypto = require('node:crypto');
    const supabase = {
      schema: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: {
                id: 'client-1', company_id: 'company-2', credential_hash: crypto.createHash('sha256').update(token).digest('hex'),
                scopes: ['inventory:read'], active: true, expires_at: null, revoked_at: null,
              } }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }),
      }),
    } as any;
    const guard = new IntegrationGuard(supabase);
    const requestContext = context({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(requestContext)).resolves.toBe(true);
    expect((requestContext.switchToHttp().getRequest() as any).integration.clientId).toBe('client-1');
  });
});
