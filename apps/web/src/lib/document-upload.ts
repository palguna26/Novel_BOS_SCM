export const DOCUMENT_ACCEPT = '.pdf,.xlsx,.csv,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png';
export const DOCUMENT_FORMATS = 'PDF, XLSX, CSV, DOCX, JPG, JPEG, or PNG';
export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

const mimeTypes: Record<string, string[]> = {
  pdf: ['application/pdf'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
  csv: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
};

function extension(file: File) {
  return file.name.split('.').pop()?.toLowerCase() || '';
}

export function validateDocumentFile(file: File) {
  const ext = extension(file);
  if (!mimeTypes[ext]) throw new Error(`Unsupported file type. Choose ${DOCUMENT_FORMATS}.`);
  if (file.size > MAX_DOCUMENT_SIZE) throw new Error('File size must be 10 MB or less.');
  if (file.type && file.type !== 'application/octet-stream' && !mimeTypes[ext].includes(file.type)) {
    throw new Error('The file type does not match its extension.');
  }
}

async function parsePdf(data: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfWorker = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
  const document = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= document.numPages; index++) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    pages.push((content.items as any[]).map(item => String(item.str || '')).join(' '));
  }
  return pages.join('\n');
}

async function parseXlsx(data: ArrayBuffer) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as any);
  const sheets: string[] = [];
  workbook.eachSheet(sheet => {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, row => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, cell => {
        if (cell.isMerged && cell.master.address !== cell.address) return;
        const value = cell.value as any;
        if (value == null) return '';
        if (typeof value === 'object' && 'result' in value) cells.push(String(value.result ?? ''));
        else if (typeof value === 'object' && 'text' in value) cells.push(String(value.text ?? ''));
        else if (typeof value === 'object' && Array.isArray(value.richText)) cells.push(value.richText.map((part: any) => part.text || '').join(''));
        else cells.push(String(value));
      });
      if (cells.some(Boolean)) rows.push(cells.join('\t'));
    });
    if (rows.length) sheets.push(`[Sheet: ${sheet.name}]\n${rows.join('\n')}`);
  });
  return sheets.join('\n\n');
}

async function parseCsv(text: string) {
  const Papa = (await import('papaparse')).default;
  const result = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  if (result.errors.length) throw new Error(result.errors[0].message);
  return result.data.map(row => row.join('\t')).join('\n');
}

export async function prepareDocumentUpload(file: File) {
  validateDocumentFile(file);
  const ext = extension(file);
  const data = await file.arrayBuffer();
  let extractedText = '';
  let warning = '';
  try {
    if (ext === 'pdf') extractedText = await parsePdf(data);
    else if (ext === 'xlsx') extractedText = await parseXlsx(data);
    else if (ext === 'csv') extractedText = await parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(data));
    else if (ext === 'docx') extractedText = (await (await import('mammoth')).extractRawText({ arrayBuffer: data })).value;
    else warning = 'Image uploaded. Complete the appointment or document fields manually.';
    if (!extractedText.trim()) warning = 'No text could be extracted. Complete the fields manually.';
  } catch {
    warning = 'This file could not be read. It will be saved for manual review.';
  }
  const form = new FormData();
  form.append('file', file);
  form.append('extractedText', extractedText);
  return { form, warning };
}
