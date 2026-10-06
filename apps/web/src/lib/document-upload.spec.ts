// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENT_SIZE, prepareDocumentUpload, validateDocumentFile } from './document-upload';
import ExcelJS from 'exceljs';

function file(name: string, type: string, content = 'PO: 4S2BJXYY,Destination FC: BLR4') {
  const bytes = new TextEncoder().encode(content);
  const source = new File([bytes], name, { type });
  if (!source.arrayBuffer) Object.defineProperty(source, 'arrayBuffer', { value: async () => bytes.buffer });
  return source;
}

describe('document upload preparation', () => {
  it('converts CSV rows into extracted text', async () => {
    const result = await prepareDocumentUpload(file('po.csv', 'text/csv'));
    expect(result.form.get('file')).toBeTruthy();
    expect(result.form.get('extractedText')).toContain('4S2BJXYY');
  });

  it('does not repeat merged XLSX values', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('PO');
    sheet.mergeCells('A1:C1');
    sheet.getCell('A1').value = { richText: [{ text: 'PURCHASE ORDER NO - ' }, { text: 'FLS02CDDC93B' }] };
    sheet.addRow(['Product ID', 'Quantity', 'Price']);
    sheet.addRow(['WIP-1', 24, 10]);
    const bytes = await workbook.xlsx.writeBuffer();
    const source = new File([bytes as any], 'po.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (!source.arrayBuffer) Object.defineProperty(source, 'arrayBuffer', { value: async () => bytes });
    const result = await prepareDocumentUpload(source);
    const text = String(result.form.get('extractedText'));
    expect(text.match(/FLS02CDDC93B/g)).toHaveLength(1);
    expect(text).toContain('WIP-1\t24\t10');
  });

  it('rejects unsupported files', () => {
    expect(() => validateDocumentFile(file('po.txt', 'text/plain'))).toThrow('Unsupported file type');
  });

  it('rejects MIME mismatches', () => {
    expect(() => validateDocumentFile(file('po.csv', 'application/pdf'))).toThrow('does not match');
  });

  it('rejects files above 10 MB', () => {
    const oversized = file('po.csv', 'text/csv');
    Object.defineProperty(oversized, 'size', { value: MAX_DOCUMENT_SIZE + 1 });
    expect(() => validateDocumentFile(oversized)).toThrow('10 MB');
  });
});
