import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth';
import { NotificationService } from './notification.service';

@Controller('api/notifications')
@UseGuards(AuthGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}
  @Get() list(@Req() req: any) { return this.notifications.list(req.user); }
  @Post(':id/send') send(@Req() req: any, @Param('id') id: string) { return this.notifications.send(req.user, id); }
}
