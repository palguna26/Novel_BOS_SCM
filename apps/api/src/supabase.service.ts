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

  async signInWithPassword(email: string, password: string) {
    const authClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    return authClient.auth.signInWithPassword({ email, password });
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
      canWrite: access.can_write,
      canApprove: access.can_approve,
    };
  }
}
