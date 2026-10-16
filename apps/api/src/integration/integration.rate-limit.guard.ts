import { CanActivate, ExecutionContext, Injectable, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';

@Injectable()
export class IntegrationRateLimitGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const clientId = request.integration?.clientId || 'unknown';
    const { data, error } = await this.supabase.rpc<boolean>('integration', 'consume_rate_limit', {
      p_client_id: clientId,
      p_limit: 300,
      p_window_seconds: 60,
    });
    if (error) throw new ServiceUnavailableException('Integration rate limiter is unavailable');
    if (!data) throw new HttpException('Integration rate limit exceeded', 429);
    return true;
  }
}
