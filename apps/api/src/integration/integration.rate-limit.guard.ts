import { CanActivate, ExecutionContext, Injectable, HttpException } from '@nestjs/common';

@Injectable()
export class IntegrationRateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, number[]>();
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const clientId = request.integration?.clientId || 'unknown';
    const now = Date.now();
    const recent = (this.windows.get(clientId) || []).filter(timestamp => timestamp > now - 60_000);
    if (recent.length >= 300) throw new HttpException('Integration rate limit exceeded', 429);
    recent.push(now);
    this.windows.set(clientId, recent);
    return true;
  }
}
