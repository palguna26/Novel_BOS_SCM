export type DocumentPlatform = 'AMAZON_RK' | 'FLIPKART' | 'BLINKIT' | 'UNKNOWN';
export type DocumentKind = 'PURCHASE_ORDER' | 'APPOINTMENT' | 'CONSIGNMENT' | 'UNKNOWN';

export interface ExtractedLine {
  lineNumber: number;
  channelItemCode?: string;
  asin?: string;
  ean?: string;
  hsn?: string;
  description?: string;
  ordered?: number;
  approved?: number;
  pending?: number;
  unitPrice?: number;
  taxRate?: number;
  mrp?: number;
  total?: number;
}

export interface NormalizedDocument {
  platform: DocumentPlatform;
  kind: DocumentKind;
  externalId: string | null;
  linkedPoIds: string[];
  poDate: string | null;
  expiryDate: string | null;
  appointmentId: string | null;
  consignmentId: string | null;
  appointmentAt: string | null;
  destination: string | null;
  fcCode: string | null;
  sourceAddress: string | null;
  destinationAddress: string | null;
  sourceCity: string | null;
  destinationCity: string | null;
  sourceState: string | null;
  destinationState: string | null;
  sourcePostalCode: string | null;
  destinationPostalCode: string | null;
  facilityName: string | null;
  customer: string | null;
  supplier: string | null;
  currency: string | null;
  totalQuantity: number | null;
  totalValue: number | null;
  cartonCount: number | null;
  lines: ExtractedLine[];
  warnings: string[];
  confidence: number;
  text: string;
}

/** Fill gaps from the deterministic parser after an AI extraction.
 * PDF tables often render quantities as separate text fragments. The AI may
 * identify the row but miss one numeric column, while the rules parser can
 * still recover it from the raw PDF text.
 */
export function mergeDocumentFallback(primary: NormalizedDocument, fallback: NormalizedDocument): NormalizedDocument {
  const scalarKeys = ['externalId','poDate','expiryDate','appointmentId','appointmentAt','destination','fcCode','sourceAddress','destinationAddress','sourceCity','destinationCity','sourceState','destinationState','sourcePostalCode','destinationPostalCode','facilityName','customer','supplier','currency','totalQuantity','totalValue','cartonCount'] as const;
  const merged: any = { ...primary };
  for (const key of scalarKeys) {
    if (merged[key] === null || merged[key] === undefined || merged[key] === '') merged[key] = fallback[key];
  }
  const fallbackByIdentifier = new Map<string, ExtractedLine>();
  for (const line of fallback.lines) {
    for (const value of [line.asin, line.channelItemCode, line.ean]) {
      if (value) fallbackByIdentifier.set(String(value).trim().toLowerCase(), line);
    }
  }
  merged.lines = (primary.lines.length ? primary.lines : fallback.lines).map((line: ExtractedLine, index: number) => {
    const fallbackLine = [line.asin, line.channelItemCode, line.ean]
      .map(value => value ? fallbackByIdentifier.get(String(value).trim().toLowerCase()) : undefined)
      .find(Boolean) || fallback.lines[index];
    if (!fallbackLine) return line;
    const result: any = { ...line };
    for (const key of ['channelItemCode','asin','ean','hsn','description','ordered','approved','pending','unitPrice','taxRate','mrp','total']) {
      if (result[key] === null || result[key] === undefined || result[key] === '') result[key] = (fallbackLine as any)[key];
    }
    return result;
  });
  const warnings = [...new Set([...(primary.warnings || []), ...(fallback.warnings || [])])];
  const ordered = merged.lines.reduce((sum: number, line: ExtractedLine) => sum + Number(line.ordered || 0), 0);
  if (merged.kind === 'PURCHASE_ORDER' && merged.lines.length && !ordered) warnings.push('Line quantities need review.');
  return { ...merged, warnings, confidence: Math.max(primary.confidence || 0, fallback.confidence || 0) };
}

const first = (text:string, expressions:RegExp[]) => {
  for (const expression of expressions) {
    const value = text.match(expression)?.[1]?.trim();
    if (value) return value.replace(/\s+/g, ' ');
  }
  return null;
};

const number = (value:string|null) => {
  if (!value) return null;
  const parsed = Number(value.replace(/[,\s]|INR/gi, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const unique = (values:(string|null|undefined)[]) => [...new Set(values.filter(Boolean) as string[])];

function detect(text:string):{platform:DocumentPlatform;kind:DocumentKind} {
  const upper = text.toUpperCase();
  const platform:DocumentPlatform =
    /AMAZON|RK WORLDINFOCOM|VENDOR CENTRAL|DESTINATION FC/.test(upper) ? 'AMAZON_RK' :
    /FLIPKART INDIA|FLS[A-Z0-9]+|CONSIGNMENT PRODUCTS/.test(upper) ? 'FLIPKART' :
    /BLINKIT|BLINK COMMERCE|SELLER HUB|R\.O\. NUMBER/.test(upper) ? 'BLINKIT' : 'UNKNOWN';
  const kind:DocumentKind =
    /APPOINTMENT (?:ID|ID :|NO|NUMBER)|APPOINTMENT TIME|APPOINTMENT DATE|REPORTING DATE|APPOINTMENT PASS/.test(upper) ? 'APPOINTMENT' :
    /CONSIGNMENT (?:QUANTITY|PRODUCTS|VALUE)/.test(upper) ? 'CONSIGNMENT' :
    /PURCHASE ORDER|\bPO\s*[:#]|R\.O\. NUMBER|RECOMMENDED QUANTITY ORDER/.test(upper) ? 'PURCHASE_ORDER' : 'UNKNOWN';
  return {platform,kind};
}

function extractPoIds(text:string) {
  const ids:string[] = [];
  const patterns = [
    /\bPO\s*[:#]\s*([A-Z0-9-]{6,})/gi,
    /PURCHASE ORDER NO\s*-\s*([A-Z0-9-]{6,})/gi,
    /PO Numbers?\s*[:\n ]+([A-Z0-9-]{6,})/gi,
    /POs?\s*:\s*([A-Z0-9-]{6,})/gi,
    /R\.O\. Number\s*:\s*([0-9]{8,})/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) ids.push(match[1]);
  }
  return unique(ids);
}

function extractAmazonLines(text:string):ExtractedLine[] {
  const starts = [...text.matchAll(/\b(B0[A-Z0-9]{8})\b/g)];
  const seen = new Set<string>();
  const uniqueStarts = starts.filter(match => {
    const asin = match[1].toUpperCase();
    if (seen.has(asin)) return false;
    seen.add(asin);
    return true;
  });
  return uniqueStarts.map((match,index) => {
    const segment = text.slice(match.index!, uniqueStarts[index+1]?.index ?? text.length);
    const quantities = segment.match(/Delivery window[^\n]*?\b(\d[\d,]*)\s+0\s+(\d[\d,]*)\s+0\s+(\d[\d,]*)\s+(\d[\d,]*(?:\.\d+)?)\s+INR/i)
      || segment.match(/Delivery window[^\n]*?\b(\d[\d,]*)\s+0\s+(\d[\d,]*)\s+\d[\d,]*\s+\d[\d,]*/i);
    return {
      lineNumber:index+1,
      asin:match[1],
      ean:first(segment,[/EAN\s*:\s*([0-9\s]{12,16})/i])?.replace(/\s/g,''),
      channelItemCode:first(segment,[/SKU\s*:\s*([^\n]{2,40})/i]) ?? undefined,
      hsn:first(segment,[/\b(\d{8})\b/]) ?? undefined,
      ordered:number(quantities?.[1] ?? null) ?? undefined,
      approved:number(quantities?.[2] ?? null) ?? undefined,
      unitPrice:number(first(segment,[/(\d+(?:\.\d+)?)\s+INR/i])) ?? undefined,
    };
  });
}

function isoDate(value:string|null) {
  if (!value) return null;
  const trimmed=value.trim();
  const match=trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (match) return `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
  return trimmed;
}

function extractFlipkartLines(text:string):ExtractedLine[] {
  const starts = [...text.matchAll(/\b(WIP[A-Z0-9]{10,})\b/g)];
  return starts.map((match,index) => {
    const segment = text.slice(match.index!, starts[index+1]?.index ?? text.length);
    return {
      lineNumber:index+1,
      channelItemCode:match[1],
      ean:first(segment,[/\b(89\d{11})\b/]) ?? undefined,
      hsn:first(segment,[/hsn\s*(\d{6,8})/i,/\b(\d{8})\b/]) ?? undefined,
      ordered:number(first(segment,[/\b(\d[\d,]*)\s+(?:INR|pcs)\b/i])) ?? undefined,
      mrp:number(first(segment,[/mrp\s*(\d+(?:\.\d+)?)/i])) ?? undefined,
    };
  });
}

function extractBlinkitLines(text:string):ExtractedLine[] {
  const starts = [...text.matchAll(/(?:^|\n)\s*(\d+)\s+(\d{6,10})\s+(\d{6,8})\s+(89\d{11})/g)];
  return starts.map((match,index) => {
    const segment = text.slice(match.index!, starts[index+1]?.index ?? text.length);
    const tail = [...segment.matchAll(/\b(\d+(?:\.\d+)?)\b/g)].map(x=>Number(x[1]));
    return {
      lineNumber:Number(match[1]),
      channelItemCode:match[2],
      hsn:match[3],
      ean:match[4],
      ordered:tail.length >= 3 ? tail.at(-3) : undefined,
      mrp:tail.length >= 2 ? tail.at(-2) : undefined,
      total:tail.length ? tail.at(-1) : undefined,
    };
  });
}

export function normalizeDocument(text:string):NormalizedDocument {
  const cleaned = text.replace(/\u0000/g,'').replace(/\r/g,'');
  const {platform,kind} = detect(cleaned);
  const poIds = extractPoIds(cleaned);
  const externalId = kind === 'APPOINTMENT' ? null : poIds[0] ?? null;
  const appointmentId = first(cleaned,[
    /Appointment Id\s*:\s*([A-Z0-9-]+)/i,
    /Appointment ID\s*([A-Z0-9-]+)/i,
    /Appointment (?:No|Number)\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /Appointment\s*#\s*([A-Z0-9-]+)/i,
  ]);
  const consignmentId = first(cleaned,[
    /Consignment (?:ID|No|Number)\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /Consignment\s*#\s*([A-Z0-9-]+)/i,
  ]);
  const destination = first(cleaned,[
    /Ship to location\s+([^\n]+)/i,
    /Destination FC\s*:\s*([^\n]+)/i,
    /Delivered To\s*:\s*([^\n]+)/i,
    /(?:Destination|Facility|Location|Ship To)\s*:\s*([^\n]+)/i,
    /Ship To Address\s+Name\s+([^\n]+)/i,
    /Facility Name\s+([^\n]+)/i,
  ]);
  const sourceAddress = first(cleaned,[
    /Ship From Address\s*[:\n]+([\s\S]*?)(?=Ship To Address|Bill To Address|Destination FC|Appointment|$)/i,
    /Dispatch From\s*[:\n]+([\s\S]*?)(?=Ship To Address|Destination|Appointment|$)/i,
    /Source Warehouse Address\s*[:\n]+([\s\S]*?)(?=Destination|Appointment|$)/i,
  ]);
  const destinationAddress = first(cleaned,[
    /Ship To Address\s*[:\n]+([\s\S]*?)(?=Bill To Address|Appointment|$)/i,
    /Delivery Address\s*[:\n]+([\s\S]*?)(?=Appointment|$)/i,
    /Destination Address\s*[:\n]+([\s\S]*?)(?=Appointment|$)/i,
  ]) || destination;
  const cityFromAddress = (address:string|null) => address?.match(/\b(Bengaluru|Bangalore|Mysuru|Mysore|Manesar|Gurugram|Gurgaon|Delhi|Mumbai|Pune|Hyderabad|Chennai|Kolkata)\b/i)?.[1] ?? null;
  const sourceCity = first(cleaned,[/Source City\s*[:\-]\s*([^\n]+)/i,/Dispatch City\s*[:\-]\s*([^\n]+)/i]) || cityFromAddress(sourceAddress);
  const destinationCity = first(cleaned,[/Destination City\s*[:\-]\s*([^\n]+)/i,/Ship To City\s*[:\-]\s*([^\n]+)/i]) || cityFromAddress(destinationAddress);
  const sourceState = first(cleaned,[/Source State\s*[:\-]\s*([^\n]+)/i,/Dispatch State\s*[:\-]\s*([^\n]+)/i]);
  const destinationState = first(cleaned,[/Destination State\s*[:\-]\s*([^\n]+)/i,/Ship To State\s*[:\-]\s*([^\n]+)/i]);
  const sourcePostalCode = first(cleaned,[/Source[^\n]{0,20}(?:PIN|postal)\s*(?:code)?\s*[:\-]?\s*(\d{6})/i]);
  const destinationPostalCode = first(cleaned,[/(?:Destination|Ship To|Delivery)[^\n]{0,20}(?:PIN|postal)\s*(?:code)?\s*[:\-]?\s*(\d{6})/i, /\b(\d{6})\b/]);
  const facilityName = first(cleaned,[/Facility Name\s*[:\-]?\s*([^\n]+)/i,/Warehouse Name\s*[:\-]?\s*([^\n]+)/i]);
  const fcCode = first(cleaned,[
    /Destination FC\s*:\s*([A-Z0-9_-]+)/i,
    /Ship to location\s+([A-Z0-9_-]+)/i,
    /\[([A-Z0-9_-]{3,12})\]\s*PO\s*#/i,
  ]);
  const totalQuantity = number(first(cleaned,[
    /Total Quantity\s*:\s*([\d,]+)/i,
    /Unit Count\s*:\s*([\d,]+)/i,
    /Consignment Quantity\s*([\d,]+)/i,
    /(?:Accepted|Submitted)\s+\d+\s+([\d,]+)\s+[\d,.]+\s+INR/i,
  ]));
  const totalValue = number(first(cleaned,[
    /Net amount\s*([\d,.]+)/i,
    /Total Amount\s*([\d,.]+)/i,
    /Consignment Value\s*([\d,.]+)\s*INR/i,
    /(?:Accepted|Submitted)\s+\d+\s+[\d,]+\s+([\d,.]+)\s+INR/i,
  ]));
  const lines = platform === 'AMAZON_RK' ? extractAmazonLines(cleaned) :
    platform === 'FLIPKART' ? extractFlipkartLines(cleaned) :
    platform === 'BLINKIT' ? extractBlinkitLines(cleaned) : [];
  const warnings:string[] = [];
  if (platform === 'UNKNOWN') warnings.push('Document platform could not be identified.');
  if (kind === 'UNKNOWN') warnings.push('Document type could not be identified.');
  if (kind === 'PURCHASE_ORDER' && !externalId) warnings.push('Purchase order number was not found.');
  if (kind === 'APPOINTMENT' && !appointmentId) warnings.push('Appointment number was not found.');
  if (!destination && !destinationAddress) warnings.push('Destination could not be extracted.');
  if (kind === 'PURCHASE_ORDER' && lines.length === 0) warnings.push('Line items require manual review.');
  const checks = [platform !== 'UNKNOWN',kind !== 'UNKNOWN',!!(externalId||appointmentId),!!(destination||destinationAddress),lines.length>0];
  const confidence = Math.round((checks.filter(Boolean).length/checks.length)*100)/100;

  return {
    platform,kind,externalId,linkedPoIds:kind === 'APPOINTMENT' ? poIds : [],
    poDate:isoDate(first(cleaned,[/Ordered On\s+([^\n]+)/i,/ORDER DATE\s+([^\n]+)/i,/Date\s*:\s*([^\n]+)/i])),
    expiryDate:isoDate(first(cleaned,[/R\.O\. expiry\s*date\s*:\s*([^\n]+)/i,/Expiry Date\s+([^\n]+)/i])),
    appointmentId,
    consignmentId,
    appointmentAt:first(cleaned,[/Appointment (?:Time|Date and Time)\s*:\s*([^\n]+)/i,/Reporting date and time\s*[:\-]?\s*([^\n]+)/i]),
    destination,fcCode,sourceAddress,destinationAddress,sourceCity,destinationCity,sourceState,destinationState,sourcePostalCode,destinationPostalCode,facilityName,
    customer:first(cleaned,[/Purchasing entity\s+([^\n]+)/i,/RETAILER NAME\s+([^\n]+)/i,/Issued by\s+([^\n]+)/i]),
    supplier:first(cleaned,[/Supplier Name\s+([^\n]+)/i,/SELLER\s*:\s*([^\n]+)/i,/Vendor\s+([A-Z0-9-]+)/i]),
    currency:first(cleaned,[/Currency\s*:\s*([A-Z]{3})/i]) ?? (totalValue !== null ? 'INR' : null),
    totalQuantity,totalValue,
    cartonCount:number(first(cleaned,[/Carton Count\s*:\s*([\d,]+)/i])),
    lines,warnings,confidence,text:cleaned,
  };
}
