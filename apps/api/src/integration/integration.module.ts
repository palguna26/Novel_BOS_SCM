import { Module } from '@nestjs/common';
import { IntegrationController } from './integration.controller';
import { IntegrationGuard } from './integration.guard';
import { IntegrationService } from './integration.service';
import { IntegrationRateLimitGuard } from './integration.rate-limit.guard';
import { IntegrationAuditInterceptor } from './integration.audit.interceptor';
import { SupabaseService } from '../supabase.service';

@Module({ controllers: [IntegrationController], providers: [SupabaseService, IntegrationGuard, IntegrationRateLimitGuard, IntegrationAuditInterceptor, IntegrationService] })
export class IntegrationModule {}
