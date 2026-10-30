import { IntegrationService } from './integration.service';
import { describe, expect, it, jest } from '@jest/globals';

describe('IntegrationService purchase order contract', () => {
  const context = { companyId: 'company-1', scopes: new Set(['po:read']) } as any;

  it('serializes every PO line quantity as a decimal string', async () => {
    const lineState = {
      company_id: 'company-1', purchase_order_line_id: 'line-1', purchase_order_id: 'po-1',
      ordered_quantity: 125.5, accepted_quantity: 120, rejected_quantity: 5,
      reserved_quantity: 100.25, dispatched_quantity: 50, delivered_quantity: 40,
      damaged_quantity: 1, delivery_rejected_quantity: 2, approved_short_close_quantity: 3,
      outstanding_quantity: 74.75,
    };
    const supabase = { schema: jest.fn(() => ({ from: jest.fn(() => ({
      select: jest.fn(() => ({ eq: jest.fn(() => ({ order: jest.fn(async () => ({ data: [lineState], error: null })) })) })),
    })) })) };
    const service = new IntegrationService(supabase as any);
    const result = await service.purchaseOrderLines(context, {});
    const line = result.data[0] as Record<string, any>;
    for (const key of [
      'orderedQuantity', 'acceptedQuantity', 'rejectedQuantity', 'reservedQuantity',
      'dispatchedQuantity', 'deliveredQuantity', 'damagedQuantity',
      'rejectedDeliveryQuantity', 'approvedShortCloseQuantity', 'outstandingQuantity',
      'ordered_quantity', 'accepted_quantity', 'rejected_quantity', 'reserved_quantity',
      'dispatched_quantity', 'delivered_quantity', 'damaged_quantity',
      'delivery_rejected_quantity', 'approved_short_close_quantity', 'outstanding_quantity',
    ]) expect(typeof line[key]).toBe('string');
  });

  it('loads purchase order details with per-table PO filters and returns lines and gate', async () => {
    const calls: Array<{ schema: string; table: string; filters: Array<[string, unknown]> }> = [];
    const data: Record<string, any[]> = {
      'scm.purchase_orders': [{ id: 'po-1', company_id: 'company-1', total_value: 10 }],
      'scm.purchase_order_lines': [{ id: 'line-1', company_id: 'company-1', purchase_order_id: 'po-1', ordered_quantity: 2, unit_price: 5 }],
      'scm.po_gate_state_v': [{ company_id: 'company-1', purchase_order_id: 'po-1', acceptance_status: 'ACCEPTED' }],
      'integration.po_line_state_v': [{ company_id: 'company-1', purchase_order_id: 'po-1', purchase_order_line_id: 'line-1', ordered_quantity: 2, accepted_quantity: 2 }],
    };
    const supabase = { schema: jest.fn((schema: string) => ({ from: jest.fn((table: string) => {
      const call = { schema, table, filters: [] as Array<[string, unknown]> }; calls.push(call);
      const builder: any = {
        select: jest.fn(() => builder),
        eq: jest.fn((column: string, value: unknown) => { call.filters.push([column, value]); return builder; }),
        order: jest.fn(async () => ({ data: data[`${schema}.${table}`] || [], error: null })),
      };
      return builder;
    }) })) };
    const service = new IntegrationService(supabase as any);
    const result = await service.purchaseOrder(context, 'po-1');
    expect(calls).toHaveLength(4);
    expect(calls.every(call => call.filters.some(([column, value]) => column === 'company_id' && value === 'company-1'))).toBe(true);
    expect(calls.every(call => call.filters.some(([column, value]) => column === 'purchase_order_id' && value === 'po-1'))).toBe(true);
    expect(result.data.lines).toHaveLength(1);
    expect(result.data.gate.acceptance_status).toBe('ACCEPTED');
    expect(result.data.lines[0].state?.acceptedQuantity).toBe('2');
  });
});
