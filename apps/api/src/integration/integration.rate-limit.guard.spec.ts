import { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { IntegrationRateLimitGuard } from './integration.rate-limit.guard';

function context(supabase: any) {
  const request = { integration: { clientId: 'client-1' } };
  return { request, execution: { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext, guard: new IntegrationRateLimitGuard(supabase) };
}

describe('IntegrationRateLimitGuard', () => {
  it('uses the shared database window', async () => {
    const supabase = { rpc: jest.fn(async () => ({ data: true, error: null })) };
    const { guard, execution } = context(supabase);
    await expect(guard.canActivate(execution)).resolves.toBe(true);
    expect((supabase.rpc as any)).toHaveBeenCalledWith('integration', 'consume_rate_limit', {
      p_client_id: 'client-1', p_limit: 300, p_window_seconds: 60,
    });
  });

  it('rejects when the shared window is exhausted', async () => {
    const supabase = { rpc: jest.fn(async () => ({ data: false, error: null })) };
    const { guard, execution } = context(supabase);
    await expect(guard.canActivate(execution)).rejects.toThrow('Integration rate limit exceeded');
  });

  it('fails closed when the rate limiter cannot be reached', async () => {
    const supabase = { rpc: jest.fn(async () => ({ data: null, error: { message: 'database unavailable' } })) };
    const { guard, execution } = context(supabase);
    await expect(guard.canActivate(execution)).rejects.toThrow('Integration rate limiter is unavailable');
  });
});
