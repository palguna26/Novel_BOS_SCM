import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EmailService } from './email.service';
import { AuthenticatedUser, SupabaseService } from './supabase.service';

@Injectable()
export class NotificationService {
  constructor(private readonly supabase: SupabaseService, private readonly email: EmailService) {}

  async list(user: AuthenticatedUser) {
    const { data, error } = await this.supabase.schema('platform').from('notifications').select('*').eq('company_id', user.companyId).order('created_at', { ascending: false }).limit(100);
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async send(user: AuthenticatedUser, id: string) {
    if (!user.canWrite) throw new ForbiddenException('Write access is required');
    const db = this.supabase.schema('platform');
    const { data: notification, error } = await db.from('notifications').select('*').eq('id', id).eq('company_id', user.companyId).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!notification) throw new NotFoundException('Notification not found');
    if (notification.status === 'SENT' || notification.status === 'CANCELLED') return notification;
    // Claim the notification atomically. Without checking the updated row,
    // two requests can both send the same message.
    const { data: claimed, error: claimError } = await db.from('notifications')
      .update({ status: 'SENDING' })
      .eq('id', id)
      .eq('company_id', user.companyId)
      .in('status', ['PENDING', 'FAILED'])
      .select()
      .maybeSingle();
    if (claimError) throw new BadRequestException(claimError.message);
    if (!claimed) throw new BadRequestException('Notification is already being sent');
    const { count } = await db.from('notification_attempts').select('*', { count: 'exact', head: true }).eq('notification_id', id);
    const attemptNumber = (count || 0) + 1;
    try {
      const result = await this.email.send(notification.recipient, notification.subject || 'SCM notification', notification.payload?.body || JSON.stringify(notification.payload));
      await db.from('notification_attempts').insert({ company_id: user.companyId, notification_id: id, attempt_number: attemptNumber, status: 'SENT', provider_reference: result.status, completed_at: new Date().toISOString() });
      const { data: sent } = await db.from('notifications').update({ status: 'SENT', sent_at: new Date().toISOString() }).eq('id', id).select().single();
      return sent;
    } catch (cause: any) {
      const status = attemptNumber >= 3 ? 'DEAD_LETTER' : 'FAILED';
      await db.from('notification_attempts').insert({ company_id: user.companyId, notification_id: id, attempt_number: attemptNumber, status: 'FAILED', error: cause.message, completed_at: new Date().toISOString() });
      await db.from('notifications').update({ status }).eq('id', id);
      throw new BadRequestException(`Notification send failed (${attemptNumber}/3)`);
    }
  }
}
