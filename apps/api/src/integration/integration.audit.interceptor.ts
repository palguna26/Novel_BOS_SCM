import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, tap } from 'rxjs';
import { SupabaseService } from '../supabase.service';

@Injectable()
export class IntegrationAuditInterceptor implements NestInterceptor {
  constructor(private readonly supabase: SupabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const requestId = String(request.headers['x-request-id'] || randomUUID());
    const started = Date.now();
    return next.handle().pipe(tap(async result => {
      const data = (result as any)?.data;
      const insert = this.supabase.schema('integration').from('request_audit').insert({
        request_id: requestId,
        client_id: request.integration?.clientId || 'unknown',
        company_id: request.integration?.companyId,
        route: request.originalUrl || request.url,
        status_code: 200,
        duration_ms: Date.now() - started,
        record_count: Array.isArray(data) ? data.length : data ? 1 : 0,
      });
      await Promise.resolve(insert).then(() => undefined).catch(() => undefined);
    }));
  }
}
