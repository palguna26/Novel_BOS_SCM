import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { SupabaseService } from '../supabase.service';
import { IntegrationContext, READ_SCOPES } from './integration.types';

@Injectable()
export class IntegrationGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const authorization = String(request.headers.authorization || '');
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    const configured = process.env.SALES_INTEGRATION_TOKEN?.trim();
    const companyId = process.env.SALES_INTEGRATION_COMPANY_ID?.trim();
    if (configured && companyId && token === configured) {
      const scopes = new Set((process.env.SALES_INTEGRATION_SCOPES || READ_SCOPES.join(',')).split(',').map(x => x.trim()).filter(Boolean));
      const client: IntegrationContext = { companyId, scopes, clientId: 'sales-uat-env-token' };
      request.integration = client;
      return true;
    }

    // Preferred UAT/production path: a credential issued from integration.clients.
    const prefix = token.split('.')[0];
    if (prefix) {
      const { data: client } = await this.supabase.schema('integration').from('clients')
        .select('id,company_id,credential_hash,scopes,active,expires_at,revoked_at')
        .eq('credential_prefix', prefix).maybeSingle();
      if (client?.active && !client.revoked_at && (!client.expires_at || new Date(client.expires_at).getTime() > Date.now())) {
        const supplied = createHash('sha256').update(token).digest('hex');
        const expected = String(client.credential_hash);
        if (supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
          await this.supabase.schema('integration').from('clients').update({ last_used_at: new Date().toISOString() }).eq('id', client.id);
          request.integration = { companyId: client.company_id, scopes: new Set(client.scopes || []), clientId: client.id } satisfies IntegrationContext;
          return true;
        }
      }
    }

    // Keep local development compatible with the existing signed-in SCM session.
    if (!token) throw new UnauthorizedException('Integration credentials are required');
    const user = await this.supabase.userFromToken(token);
    if (!user) throw new UnauthorizedException('Invalid integration credentials');
    request.integration = { companyId: user.companyId, scopes: new Set(READ_SCOPES), clientId: `user:${user.id}` } satisfies IntegrationContext;
    return true;
  }
}
