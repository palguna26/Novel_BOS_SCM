import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { DocumentService } from './document.service';

function service() {
  const storage = { save: jest.fn(async (..._args: any[]) => 'stored/document'), read: jest.fn() };
  const supabase: any = { rpc: jest.fn(async (..._args: any[]) => ({ data: { duplicate: false }, error: null })) };
  const openRouter:any = { isConfigured: jest.fn(() => false), extract: jest.fn() };
  return { storage, supabase, openRouter, subject: new DocumentService(storage as any, supabase as any, openRouter as any) };
}

const writer = { companyId: 'company-1', id: 'user-1', canWrite: true };

describe('DocumentService uploads', () => {
  it('rejects a read-only upload before touching storage', async () => {
    const { subject, storage } = service();
    await expect(subject.saveAndExtract('po.csv', Buffer.from('a,b'), { companyId: 'company-1', id: 'user-1', canWrite: false }, undefined, 'text/csv')).rejects.toThrow('Write access is required');
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('uses browser-extracted CSV text for normalization', async () => {
    const { subject, storage } = service();
    const result = await subject.saveAndExtract(
      'po.csv', Buffer.from('field,value\nPO,4S2BJXYY'), writer, undefined, 'text/csv',
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
    const result=await subject.saveAndExtract('po.csv',Buffer.from('a,b'),writer,undefined,'text/csv','parsed source');
    expect(result.extracted.externalId).toBe('49990010116382');
    expect(result.extraction.method).toBe('openrouter');
  });

  it('removes PDF text NUL characters before extraction and database registration', async () => {
    const { subject, supabase, openRouter } = service();
    openRouter.isConfigured.mockReturnValue(true);
    openRouter.extract.mockResolvedValue({document:{kind:'PURCHASE_ORDER',externalId:'4S2BJXYY',lines:[],warnings:[],confidence:0.8,text:'PO\u0000 text',destination:'Ben\u0000galuru'},metadata:{method:'openrouter',attempts:1,latencyMs:1}});
    (supabase.rpc as any).mockResolvedValue({data:{duplicate:false},error:null});
    await subject.saveAndExtract('po.csv',Buffer.from('a,b'),{companyId:'company',id:'actor',canWrite:true},undefined,'text/csv','PO\u0000 text');
    expect(openRouter.extract.mock.calls[0][0].text).toBe('PO text');
    const payload=(supabase.rpc.mock.calls[0] as any)[2].p_payload;
    expect(payload.extracted.text).toBe('PO text');
    expect(payload.extracted.destination).toBe('Bengaluru');
    expect(JSON.stringify(payload)).not.toContain('\\u0000');
  });

  it('falls back to rules when OpenRouter fails', async () => {
    const { subject, openRouter } = service();
    openRouter.isConfigured.mockReturnValue(true);
    openRouter.extract.mockRejectedValue(new Error('openrouter_failed:http_503'));
    const result=await subject.saveAndExtract('po.csv',Buffer.from('a,b'),writer,undefined,'text/csv','PO: 4S2BJXYY\nDestination FC: BLR4\nRK WORLDINFOCOM');
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
    const result = await subject.saveAndExtract('po.xlsx', encrypted, writer, undefined, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '');
    expect(result.confidence).toBe(0);
    expect(storage.save).toHaveBeenCalled();
  });

  it('registers a POD file without reading or extracting it', async () => {
    const { subject, supabase, openRouter, storage } = service();
    (supabase.rpc as any).mockResolvedValue({ data: { documentVersionId: 'version-1', duplicate: false }, error: null });
    const result = await subject.saveWithoutExtraction('pod.csv', Buffer.from('evidence'), { companyId: 'company-1', id: 'user-1', canWrite: true }, 'upload-1', 'application/octet-stream');
    expect(result.documentVersionId).toBe('version-1');
    expect(openRouter.extract).not.toHaveBeenCalled();
    expect(storage.save).toHaveBeenCalledWith('pod.csv', Buffer.from('evidence'), 'text/csv', 'company-1');
    expect(supabase.rpc).toHaveBeenCalledWith('documents', 'register_extraction', expect.objectContaining({
      p_payload: expect.objectContaining({ documentType: 'POD', extracted: { kind: 'POD', method: 'file_only' } }),
    }));
  });
});
