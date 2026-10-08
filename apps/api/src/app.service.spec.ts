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

  it('maps acceptance to the immutable v2 decision RPC', async () => {
    const { app, supabase } = service();
    await app.acceptPo(user, 'po-1', 'accept-1');
    expect(supabase.rpc).toHaveBeenCalledWith('scm', 'record_acceptance', expect.objectContaining({ p_purchase_order_id: 'po-1', p_decision: 'ACCEPTED', p_idempotency_key: 'accept-1' }));
  });

  it('requires a rejection reason', async () => {
    const { app } = service();
    await expect(app.rejectPo(user, 'po-1', '', 'reject-1')).rejects.toBeInstanceOf(BadRequestException);
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
});
