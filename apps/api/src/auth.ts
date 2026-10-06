import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, SetMetadata } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
export const Roles = (...roles:string[]) => SetMetadata('roles', roles);
@Injectable() export class AuthGuard implements CanActivate { constructor(private supabase:SupabaseService){} async canActivate(ctx:ExecutionContext){ const req=ctx.switchToHttp().getRequest(); const token=(req.headers.authorization||'').replace('Bearer ',''); if(!token) throw new UnauthorizedException(); const user=await this.supabase.userFromToken(token); if(!user) throw new UnauthorizedException(); req.user=user; return true; } }
export function canWrite(role:string){ return role !== 'QC'; }
export function canManage(role:string){ return role === 'MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN'; }
