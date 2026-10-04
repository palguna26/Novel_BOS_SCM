import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { AuthGuard } from './auth';

@Controller('api')
@UseGuards(AuthGuard)
export class AppController {
  constructor(private readonly service: AppService) {}

  @Get('dashboard') dashboard(@Req() req: any) { return this.service.dashboard(req.user); }
  @Get('pos') pos(@Req() req: any) { return this.service.listPos(req.user); }
  @Get('masters') masters(@Req() req: any) { return this.service.masters(req.user); }
  @Get('inventory') inventory(@Req() req: any) { return this.service.inventory(req.user); }
  @Get('audit') audit(@Req() req: any) { return this.service.auditLog(req.user); }

  @Post('skus') sku(@Req() req: any, @Body() body: any) { return this.service.createSku(req.user, body); }
  @Post('warehouses') warehouse(@Req() req: any, @Body() body: any) { return this.service.createWarehouse(req.user, body); }
  @Post('inventory/add') add(@Req() req: any, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.addStock(req.user, body, key); }
  @Post('pos') createPo(@Req() req: any, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.createPo(req.user, body, key); }
  @Post('pos/:id/accept') accept(@Req() req: any, @Param('id') id: string, @Headers('idempotency-key') key?: string) { return this.service.acceptPo(req.user, id, key); }
  @Post('pos/:id/reject') reject(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.rejectPo(req.user, id, body.reason, key); }
  @Post('pos/:id/short-close') shortClose(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.shortClose(req.user, id, body, key); }
  @Post('pos/:id/appointment') appointment(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.appointment(req.user, id, body, key); }
  @Post('pos/:id/shipments') shipment(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.shipment(req.user, id, body, key); }
  @Post('shipments/:id/dispatch') dispatch(@Req() req: any, @Param('id') id: string, @Headers('idempotency-key') key?: string) { return this.service.dispatch(req.user, id, key); }
  @Post('shipments/:id/events') shipmentEvent(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.shipmentEvent(req.user, id, body, key); }
  @Post('inventory/transactions/:id/reverse') reverseStock(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.reverseStock(req.user, id, body, key); }
  @Post('pos/:id/pods') pod(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.pod(req.user, id, body, key); }
  @Post('pos/:id/invoice') invoice(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.invoice(req.user, id, body, key); }
}
