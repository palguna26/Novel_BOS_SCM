import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { AppService } from './app.service';

const user = { id: 'user-1', email: 'user@example.test', name: 'User', role: 'TEAM_MEMBER', companyId: 'company-1', canRead: true, canWrite: true, canApprove: false };
const approver = { ...user, canApprove: true };

function service() {
  const supabase: any = { rpc: jest.fn(async () => ({ data: { ok: true }, error: null })), schema: jest.fn() };
  return { app: new AppService(supabase), supabase };
}

describe('AppService v2 command mapping', () => {
  it('adds company context and maps UI line IDs for PO creation', async () => {
    const { app, supabase } = service();
    await app.createPo(user, { platformId: 'channel-1', externalId: 'PO-1', documentVersionId: 'doc-1', lines: [{ skuId: 'item-1', ordered: 5 }] }, 'request-1');
    expect(supabase.rpc).toHaveBeenCalledWith('scm', 'create_purchase_order', expect.objectContaining({
      p_actor_id: 'user-1', p_idempotency_key: 'request-1',
      p_payload: expect.objectContaining({ companyId: 'company-1', channelId: 'channel-1', documentVersionId: 'doc-1', lines: [expect.objectContaining({ itemId: 'item-1', lineNumber: 1 })] }),
    }));
  });

  it('sends PO corrections to the atomic update command', async () => {
    const { app, supabase } = service();
    await app.updatePo(user, 'po-1', {
      sourceAddress: 'Corrected source', expectedUpdatedAt: '2026-10-11T10:00:00Z',
      lines: [{ skuId: 'item-1', ordered: 12, unitPrice: 25 }],
    }, 'edit-1');
    expect(supabase.rpc).toHaveBeenCalledWith('scm', 'update_purchase_order', expect.objectContaining({
      p_purchase_order_id: 'po-1', p_actor_id: 'user-1', p_idempotency_key: 'edit-1',
      p_payload: expect.objectContaining({
        sourceAddress: 'Corrected source', expectedUpdatedAt: '2026-10-11T10:00:00Z',
        lines: [expect.objectContaining({ itemId: 'item-1', ordered: 12, unitPrice: 25 })],
      }),
    }));
    await expect(app.updatePo({ ...user, canWrite: false }, 'po-1', {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('maps acceptance to the immutable v2 decision RPC', async () => {
    const { app, supabase } = service();
    await expect(app.acceptPo(user, 'po-1', 'accept-1')).rejects.toBeInstanceOf(ForbiddenException);
    await app.acceptPo(approver, 'po-1', 'accept-1');
    expect(supabase.rpc).toHaveBeenCalledWith('scm', 'record_acceptance', expect.objectContaining({ p_purchase_order_id: 'po-1', p_decision: 'ACCEPTED', p_idempotency_key: 'accept-1' }));
  });

  it('accepts a corrected appointment PO only when it appears in the stored PDF text', async () => {
    const { app, supabase } = service();
    supabase.schema.mockImplementation((schema: string) => ({ from: () => {
      const query: any = { select: () => query, eq: () => query, order: () => query, limit: () => query,
        maybeSingle: async () => ({ data: schema === 'scm'
          ? { external_id: '5VDQRWJX', destination_key: 'BLR4' }
          : { raw_output: { linkedPoIds: [], text: 'POs : 5VDQRWJX\nDestination FC : BLR4' } }, error: null }) };
      return query;
    } }));
    await app.appointment(user, 'po-1', { documentVersionId: 'doc-1', linkedPoId: '5VDQRWJX', appointmentId: '1000955004985', appointmentAt: '2026-10-10T12:30:00Z', matchStatus: 'MATCHED' });
    expect(supabase.rpc).toHaveBeenCalledWith('scm', 'record_appointment', expect.objectContaining({
      p_match_details: expect.objectContaining({ linkedPoId: '5VDQRWJX' }),
    }));
    await expect(app.appointment(user, 'po-1', { documentVersionId: 'doc-1', linkedPoId: '5VDQRWJ', matchStatus: 'MATCHED' })).rejects.toThrow('must match this PO');
    supabase.schema.mockImplementation((schema: string) => ({ from: () => {
      const query: any = { select: () => query, eq: () => query, order: () => query, limit: () => query,
        maybeSingle: async () => ({ data: schema === 'scm'
          ? { external_id: '5VDQRWJX', destination_key: 'BLR4' }
          : { raw_output: { linkedPoIds: [], text: 'POs : 15VDQRWJX9' } }, error: null }) };
      return query;
    } }));
    await expect(app.appointment(user, 'po-1', { documentVersionId: 'doc-1', linkedPoId: '5VDQRWJX', matchStatus: 'MATCHED' })).rejects.toThrow('not found in the appointment PDF text');
  });

  it('requires a rejection reason', async () => {
    const { app } = service();
    await expect(app.rejectPo(approver, 'po-1', '', 'reject-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires approval access for short close and stock reversal', async () => {
    const { app } = service();
    await expect(app.shortClose(user, 'po-1', { reason: 'close', remainingQuantity: 1 }, 'close-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(app.reverseStock(user, 'tx-1', { reason: 'mistake' }, 'reverse-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('deletes a platform through the atomic database command', async () => {
    const { app, supabase } = service();
    await expect(app.deletePlatform(approver, 'channel-1')).resolves.toEqual({ ok: true });
    expect(supabase.rpc).toHaveBeenCalledWith('master_data', 'delete_channel', {
      p_company_id: 'company-1', p_channel_id: 'channel-1', p_actor_id: 'user-1',
    });
  });

  it('does not report a successful delete when the atomic command fails', async () => {
    const { app, supabase } = service();
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'foreign key violation' } });
    await expect(app.deleteWarehouse(approver, 'site-1')).rejects.toThrow('foreign key violation');
    expect(supabase.schema).not.toHaveBeenCalled();
  });

  it('requires approval access for permanent master-data deletion', async () => {
    const { app } = service();
    await expect(app.deletePlatform(user, 'channel-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(app.deleteWarehouse(user, 'site-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('confirms every remaining dispatched unit for the selected shipment', async () => {
    const { app, supabase } = service();
    const rows: Record<string, any> = {
      shipments: { id: 'shipment-1', purchase_order_id: 'po-1', status: 'IN_TRANSIT' },
      pods: null,
      shipment_lines: [
        { id: 'line-1', dispatched_quantity: 10, delivered_quantity: 3, damaged_quantity: 1, rejected_quantity: 0 },
        { id: 'line-2', dispatched_quantity: 5, delivered_quantity: 0, damaged_quantity: 0, rejected_quantity: 0 },
      ],
    };
    supabase.schema.mockReturnValue({ from: (table: string) => {
      const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: rows[table], error: null }), then: (resolve: any) => Promise.resolve({ data: rows[table], error: null }).then(resolve) };
      return query;
    } });
    await app.pod(user, 'po-1', { documentVersionId: 'document-1', shipmentId: 'shipment-1', lines: [{ confirmed: 999 }] }, 'pod-1');
    expect(supabase.rpc).toHaveBeenCalledWith('scm', 'record_pod', expect.objectContaining({
      p_purchase_order_id: 'po-1', p_document_version_id: 'document-1', p_idempotency_key: 'pod-1',
      p_lines: [{ shipmentLineId: 'line-1', confirmed: 6 }, { shipmentLineId: 'line-2', confirmed: 5 }],
    }));
  });
});
