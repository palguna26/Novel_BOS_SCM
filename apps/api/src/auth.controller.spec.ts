import { describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';

function setup() {
  const supabase: any = {
    signInWithPassword: jest.fn(),
    refreshSession: jest.fn(),
    userFromToken: jest.fn(() => Promise.resolve({ id: 'user-1', email: 'operator@example.com' })) as any,
  };
  return { supabase, controller: new AuthController(supabase) };
}

describe('AuthController', () => {
  it('supports email/password login and returns refresh credentials', async () => {
    const { controller, supabase } = setup();
    supabase.signInWithPassword.mockResolvedValue({ data: { user: { id: 'user-1' }, session: { access_token: 'access', refresh_token: 'refresh', expires_at: 123 } }, error: null });
    await expect(controller.login({ email: ' Operator@Example.com ', password: 'secret' })).resolves.toMatchObject({ accessToken: 'access', refreshToken: 'refresh', user: { id: 'user-1' } });
    expect(supabase.signInWithPassword).toHaveBeenCalledWith('operator@example.com', 'secret');
  });

  it('rejects missing credentials without calling Supabase', async () => {
    const { controller, supabase } = setup();
    await expect(controller.login({ email: '', password: '' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(supabase.signInWithPassword).not.toHaveBeenCalled();
  });

  it('refreshes an existing Supabase session', async () => {
    const { controller, supabase } = setup();
    supabase.refreshSession.mockResolvedValue({ data: { user: { id: 'user-1' }, session: { access_token: 'new-access', refresh_token: 'new-refresh' } }, error: null });
    await expect(controller.refresh({ refreshToken: 'old-refresh' })).resolves.toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  });
});
