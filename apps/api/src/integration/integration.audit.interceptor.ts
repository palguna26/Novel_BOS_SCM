import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { defer, lastValueFrom, Observable } from 'rxjs';
import { SupabaseService } from '../supabase.service';

@Injectable()
export class IntegrationAuditInterceptor implements NestInterceptor {
  constructor(private readonly supabase: SupabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const requestId = String(request.headers['x-request-id'] || randomUUID());
    const started = Date.now();
    const writeAudit = async (statusCode: number, result?: unknown) => {
      const data = (result as any)?.data;
      const { error } = await this.supabase.schema('integration').from('request_audit').insert({
        request_id: requestId,
        client_id: request.integration?.clientId || 'unknown',
        company_id: request.integration?.companyId,
        route: request.originalUrl || request.url,
        status_code: statusCode,
        duration_ms: Date.now() - started,
        record_count: Array.isArray(data) ? data.length : data ? 1 : 0,
      });
      if (error) throw new Error(`Integration audit write failed: ${error.message}`);
    };

    return defer(async () => {
      try {
        const result = await lastValueFrom(next.handle());
        await writeAudit(200, result);
        return result;
      } catch (error: any) {
        // Failed integration requests must also be visible. Preserve the
        // original request error if audit storage is unavailable.
        await writeAudit(Number(error?.status || error?.statusCode || 500)).catch(() => undefined);
        throw error;
      }
    });
  }
}
