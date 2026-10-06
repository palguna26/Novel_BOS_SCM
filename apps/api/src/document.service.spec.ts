import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { DocumentService } from './document.service';

function service() {
  const storage = { save: jest.fn(async () => 'stored/document'), read: jest.fn() };
  const supabase = { rpc: jest.fn() };
  const openRouter:any = { isConfigured: jest.fn(() => false), extract: jest.fn() };
  return { storage, openRouter, subject: new DocumentService(storage as any, supabase as any, openRouter as any) };
}

describe('DocumentService uploads', () => {
  it('uses browser-extracted CSV text for normalization', async () => {
    const { subject, storage } = service();
    const result = await subject.saveAndExtract(
      'po.csv', Buffer.from('field,value\nPO,4S2BJXYY'), undefined, undefined, 'text/csv',
      'PO: 4S2BJXYY\nDestination FC: BLR4\nRK WORLDINFOCOM',
    );
    expect(result.extracted).toMatchObject({ externalId: '4S2BJXYY', destination: 'BLR4', platform: 'AMAZON_RK' });
    expect(result.extraction).toMatchObject({ method: 'rules', fallbackReason: 'openrouter_not_configured' });
    expect(storage.save).toHaveBeenCalled();
  });

  it('uses OpenRouter as the primary extractor when configured', async () => {
    const { subject, openRouter } = service();
    openRouter.isConfigured.mockReturnValue(true);
    openRouter.extract.mockResolvedValue({ document: { platform:'BLINKIT', kind:'PURCHASE_ORDER', externalId:'49990010116382', linkedPoIds:[], poDate:null, expiryDate:null, appointmentId:null, appointmentAt:null, destination:'Bengaluru', fcCode:null, customer:null, supplier:null, currency:'INR', totalQuantity:10, totalValue:100, cartonCount:null, lines:[], warnings:[], confidence:0.8, text:'source' }, metadata: { method:'openrouter', model:'openai/gpt-4o-mini', attempts:1, latencyMs:25 } });
    const result=await subject.saveAndExtract('po.csv',Buffer.from('a,b'),undefined,undefined,'text/csv','parsed source');
    expect(result.extracted.externalId).toBe('49990010116382');
    expect(result.extraction.method).toBe('openrouter');
  });

  it('falls back to rules when OpenRouter fails', async () => {
    const { subject, openRouter } = service();
    openRouter.isConfigured.mockReturnValue(true);
    openRouter.extract.mockRejectedValue(new Error('openrouter_failed:http_503'));
    const result=await subject.saveAndExtract('po.csv',Buffer.from('a,b'),undefined,undefined,'text/csv','PO: 4S2BJXYY\nDestination FC: BLR4\nRK WORLDINFOCOM');
    expect(result.extracted.externalId).toBe('4S2BJXYY');
    expect(result.extraction).toMatchObject({method:'rules',fallbackReason:'openrouter_failed:http_503'});
  });

  it('rejects unsupported extensions before storage', async () => {
    const { subject, storage } = service();
    await expect(subject.saveAndExtract('po.exe', Buffer.from('data'))).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rejects MIME and extension mismatches', async () => {
    const { subject } = service();
    await expect(subject.saveAndExtract('po.csv', Buffer.from('a,b'), undefined, undefined, 'application/pdf')).rejects.toThrow('does not match');
  });

  it('rejects Office files without matching archive content', async () => {
    const { subject } = service();
    await expect(subject.saveAndExtract('po.docx', Buffer.from('PK fake xl/ archive'), undefined, undefined, 'application/zip')).rejects.toThrow('does not match');
  });

  it('stores encrypted Office files for manual review', async () => {
    const { subject, storage } = service();
    const encrypted = Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);
    const result = await subject.saveAndExtract('po.xlsx', encrypted, undefined, undefined, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '');
    expect(result.confidence).toBe(0);
    expect(storage.save).toHaveBeenCalled();
  });
});
