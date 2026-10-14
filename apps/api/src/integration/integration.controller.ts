import { Controller, Get, Param, Query, Req, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { IntegrationGuard } from './integration.guard';
import { IntegrationExceptionFilter } from './integration.filter';
import { IntegrationRateLimitGuard } from './integration.rate-limit.guard';
import { IntegrationAuditInterceptor } from './integration.audit.interceptor';
import { IntegrationService } from './integration.service';
import { IntegrationContext, IntegrationQuery } from './integration.types';

@Controller('api/v1/integration')
@UseGuards(IntegrationGuard, IntegrationRateLimitGuard)
@UseFilters(IntegrationExceptionFilter)
@UseInterceptors(IntegrationAuditInterceptor)
export class IntegrationController {
  constructor(private readonly service: IntegrationService) {}

  private context(req: any): IntegrationContext { return req.integration; }

  @Get('health') health(@Req() req: any) { return this.service.health(this.context(req)); }
  @Get('products') products(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.products(this.context(req), query); }
  @Get('products/:id') product(@Req() req: any, @Param('id') id: string) { return this.service.product(this.context(req), id); }
  @Get('product-identifiers') identifiers(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.identifiers(this.context(req), query); }
  @Get('product-identifiers/resolve') resolveIdentifier(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.resolveIdentifier(this.context(req), query); }
  @Get('channels') channels(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.channels(this.context(req), query); }
  @Get('sites') sites(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.sites(this.context(req), query); }
  @Get('locations') locations(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.locations(this.context(req), query); }
  @Get('destinations') destinations(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.destinations(this.context(req), query); }
  @Get('inventory') inventory(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.inventory(this.context(req), query); }
  @Get('inventory/balances') inventoryBalances(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.inventoryBalances(this.context(req), query); }
  @Get('purchase-orders') purchaseOrders(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.purchaseOrders(this.context(req), query); }
  @Get('purchase-orders/:id') purchaseOrder(@Req() req: any, @Param('id') id: string) { return this.service.purchaseOrder(this.context(req), id); }
  @Get('purchase-order-lines') purchaseOrderLines(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.purchaseOrderLines(this.context(req), query); }
  @Get('po-gates') gates(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.gates(this.context(req), query); }
  @Get('reservations') reservations(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.reservations(this.context(req), query); }
  @Get('shipments') shipments(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.shipments(this.context(req), query); }
  @Get('appointments') appointments(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.appointments(this.context(req), query); }
  @Get('pods') pods(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.pods(this.context(req), query); }
  @Get('delivery-exceptions') exceptions(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.exceptions(this.context(req), query); }
  @Get('short-closures') shortClosures(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.shortClosures(this.context(req), query); }
  @Get('invoices') invoices(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.invoices(this.context(req), query); }
  @Get('valuations') valuations(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.valuations(this.context(req), query); }
  @Get('forecasts') forecasts(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.forecasts(this.context(req), query); }
  @Get('inbound-commitments') inbound(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.inbound(this.context(req), query); }
  @Get('inventory-movements') movements(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.movements(this.context(req), query); }
  @Get('ownership-transfers') ownershipTransfers(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.ownershipTransfers(this.context(req), query); }
  @Get('changes') changes(@Req() req: any, @Query() query: IntegrationQuery) { return this.service.changes(this.context(req), query); }
}
