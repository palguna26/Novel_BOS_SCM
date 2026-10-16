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
  @Get('inventory/transactions') inventoryTransactions(@Req() req: any) { return this.service.inventoryTransactions(req.user); }
  @Get('audit') audit(@Req() req: any) { return this.service.auditLog(req.user); }

  @Post('skus') sku(@Req() req: any, @Body() body: any) { return this.service.createSku(req.user, body); }
  @Post('skus/:id') updateSku(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.updateSku(req.user, id, body); }
  @Post('platforms') platform(@Req() req: any, @Body() body: any) { return this.service.createPlatform(req.user, body); }
  @Post('platforms/:id') updatePlatform(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.updatePlatform(req.user, id, body); }
  @Post('platforms/:id/delete') deletePlatform(@Req() req: any, @Param('id') id: string) { return this.service.deletePlatform(req.user, id); }
  @Post('warehouses') warehouse(@Req() req: any, @Body() body: any) { return this.service.createWarehouse(req.user, body); }
  @Post('warehouses/:id') updateWarehouse(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.updateWarehouse(req.user, id, body); }
  @Post('warehouses/:id/delete') deleteWarehouse(@Req() req: any, @Param('id') id: string) { return this.service.deleteWarehouse(req.user, id); }
  @Post('locations') location(@Req() req: any, @Body() body: any) { return this.service.createLocation(req.user, body); }
  @Post('locations/:id') updateLocation(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.updateLocation(req.user, id, body); }
  @Post('mappings') mapping(@Req() req: any, @Body() body: any) { return this.service.createMapping(req.user, body); }
  @Post('mappings/:id') updateMapping(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.updateMapping(req.user, id, body); }
  @Post('routes') route(@Req() req: any, @Body() body: any) { return this.service.createRoute(req.user, body); }
  @Post('routes/:id') updateRoute(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.updateRoute(req.user, id, body); }
  @Post('uoms') uom(@Req() req: any, @Body() body: any) { return this.service.createUom(req.user, body); }
  @Post('uoms/:id') updateUom(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.updateUom(req.user, id, body); }
  @Post('inventory/add') add(@Req() req: any, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.addStock(req.user, body, key); }
  @Post('inventory/adjust') adjust(@Req() req: any, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.adjustStock(req.user, body, key); }
  @Post('inventory/policies') policy(@Req() req: any, @Body() body: any) { return this.service.updateInventoryPolicy(req.user, body); }
  @Post('pos') createPo(@Req() req: any, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.createPo(req.user, body, key); }
  @Post('pos/:id/update') updatePo(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.updatePo(req.user, id, body, key); }
  @Post('pos/:id/accept') accept(@Req() req: any, @Param('id') id: string, @Headers('idempotency-key') key?: string) { return this.service.acceptPo(req.user, id, key); }
  @Post('pos/:id/reject') reject(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.rejectPo(req.user, id, body.reason, key); }
  @Post('pos/:id/short-close') shortClose(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.shortClose(req.user, id, body, key); }
  @Post('pos/:id/appointment') appointment(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.appointment(req.user, id, body, key); }
  @Post('pos/:id/shipments') shipment(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.shipment(req.user, id, body, key); }
  @Post('pos/:id/consignments') consignment(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.consignment(req.user, id, body); }
  @Post('shipments/:id/dispatch') dispatch(@Req() req: any, @Param('id') id: string, @Headers('idempotency-key') key?: string) { return this.service.dispatch(req.user, id, key); }
  @Post('shipments/:id/events') shipmentEvent(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.shipmentEvent(req.user, id, body, key); }
  @Post('inventory/transactions/:id/reverse') reverseStock(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.reverseStock(req.user, id, body, key); }
  @Post('pos/:id/pods') pod(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.pod(req.user, id, body, key); }
  @Post('pos/:id/invoice') invoice(@Req() req: any, @Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.service.invoice(req.user, id, body, key); }
}
