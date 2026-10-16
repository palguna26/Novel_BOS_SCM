import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  companyId: string;
  canRead: boolean;
  canWrite: boolean;
  canApprove: boolean;
  accessToken?: string;
}

@Injectable()
export class SupabaseService {
  readonly client: SupabaseClient;

  constructor() {
    this.client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  schema(name: string) {
    return this.client.schema(name);
  }

  userClient(user: AuthenticatedUser) {
    if (!user.accessToken) throw new Error('A user access token is required for scoped database access');
    return createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${user.accessToken}` } } },
    );
  }

  async signInWithPassword(email: string, password: string) {
    return this.authClient().auth.signInWithPassword({ email, password });
  }

  async refreshSession(refreshToken: string) {
    return this.authClient().auth.refreshSession({ refresh_token: refreshToken });
  }

  private authClient() {
    return createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  async rpc<T = unknown>(schema: string, name: string, args: Record<string, unknown>) {
    const result = await this.client.schema(schema).rpc(name, args);
    return result as unknown as { data: T | null; error: { message: string } | null };
  }

  async userFromToken(token: string): Promise<AuthenticatedUser | null> {
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) return null;

    const { data: profile, error: profileError } = await this.schema('iam')
      .from('users')
      .select('id,email,display_name,role,active')
      .eq('id', data.user.id)
      .maybeSingle();
    if (profileError || !profile?.active) return null;

    const { data: access } = await this.schema('iam')
      .from('user_company_access')
      .select('company_id,can_read,can_write,can_approve')
      .eq('user_id', data.user.id)
      .eq('can_read', true)
      .limit(1)
      .maybeSingle();
    if (!access) return null;

    return {
      id: profile.id,
      email: profile.email,
      name: profile.display_name,
      role: profile.role,
      companyId: access.company_id,
      canRead: access.can_read,
      canWrite: access.can_write || profile.role === 'SUPER_ADMIN',
      canApprove: access.can_approve || profile.role === 'SUPER_ADMIN',
      accessToken: token,
    };
  }
}
