import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

type Credentials = { email?: unknown; password?: unknown };

@Controller('auth')
export class AuthController {
  constructor(private readonly supabase: SupabaseService) {}

  // Accounts are created and managed in Supabase. The application exposes login only.
  @Post('login')
  async login(@Body() body: Credentials) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) throw new UnauthorizedException('Invalid email or password');
    const { data, error } = await this.supabase.signInWithPassword(email, password);
    if (error || !data.session || !data.user) throw new UnauthorizedException('Invalid email or password');
    return this.sessionResponse(data.session, data.user.id);
  }

  @Post('refresh')
  async refresh(@Body() body: { refreshToken?: unknown }) {
    const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : '';
    if (!refreshToken) throw new UnauthorizedException('Session expired');
    const { data, error } = await this.supabase.refreshSession(refreshToken);
    if (error || !data.session || !data.user) throw new UnauthorizedException('Session expired');
    return this.sessionResponse(data.session, data.user.id);
  }

  private async sessionResponse(session: any, userId: string) {
    const profile = await this.supabase.userFromToken(session.access_token);
    if (!profile || profile.id !== userId) throw new UnauthorizedException('No active company access');
    return { accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: session.expires_at, user: profile };
  }
}
