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
  appointmentAt: string | null;
  destination: string | null;
  fcCode: string | null;
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
    /APPOINTMENT (?:ID|ID :)|APPOINTMENT TIME|APPOINTMENT PASS/.test(upper) ? 'APPOINTMENT' :
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
  return starts.map((match,index) => {
    const segment = text.slice(match.index!, starts[index+1]?.index ?? text.length);
    const quantities = segment.match(/(?:Delivery window[^\n]*\n|Delivery window\s*)[^\n]*?\b(\d[\d,]*)\s+0\s+(\d[\d,]*)\s+\d[\d,]*\s+\d[\d,]*/i);
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
  ]);
  const destination = first(cleaned,[
    /Ship to location\s+([^\n]+)/i,
    /Destination FC\s*:\s*([^\n]+)/i,
    /Delivered To\s*:\s*([^\n]+)/i,
    /Ship To Address\s+Name\s+([^\n]+)/i,
    /Facility Name\s+([^\n]+)/i,
  ]);
  const fcCode = first(cleaned,[
    /Destination FC\s*:\s*([A-Z0-9_-]+)/i,
    /Ship to location\s+([A-Z0-9_-]+)/i,
    /\[([A-Z0-9_-]{3,12})\]\s*PO\s*#/i,
  ]);
  const totalQuantity = number(first(cleaned,[
    /Total Quantity\s*:\s*([\d,]+)/i,
    /Unit Count\s*:\s*([\d,]+)/i,
    /Consignment Quantity\s*([\d,]+)/i,
  ]));
  const totalValue = number(first(cleaned,[
    /Net amount\s*([\d,.]+)/i,
    /Total Amount\s*([\d,.]+)/i,
    /Consignment Value\s*([\d,.]+)\s*INR/i,
  ]));
  const lines = platform === 'AMAZON_RK' ? extractAmazonLines(cleaned) :
    platform === 'FLIPKART' ? extractFlipkartLines(cleaned) :
    platform === 'BLINKIT' ? extractBlinkitLines(cleaned) : [];
  const warnings:string[] = [];
  if (platform === 'UNKNOWN') warnings.push('Document platform could not be identified.');
  if (kind === 'UNKNOWN') warnings.push('Document type could not be identified.');
  if (kind === 'PURCHASE_ORDER' && !externalId) warnings.push('Purchase order number was not found.');
  if (kind === 'APPOINTMENT' && !appointmentId) warnings.push('Appointment number was not found.');
  if (!destination) warnings.push('Destination could not be extracted.');
  if (kind === 'PURCHASE_ORDER' && lines.length === 0) warnings.push('Line items require manual review.');
  const checks = [platform !== 'UNKNOWN',kind !== 'UNKNOWN',!!(externalId||appointmentId),!!destination,lines.length>0];
  const confidence = Math.round((checks.filter(Boolean).length/checks.length)*100)/100;

  return {
    platform,kind,externalId,linkedPoIds:kind === 'APPOINTMENT' ? poIds : [],
    poDate:first(cleaned,[/Ordered On\s+([^\n]+)/i,/ORDER DATE\s+([^\n]+)/i,/Date\s*:\s*([^\n]+)/i]),
    expiryDate:first(cleaned,[/R\.O\. expiry\s*date\s*:\s*([^\n]+)/i,/Expiry Date\s+([^\n]+)/i]),
    appointmentId,
    appointmentAt:first(cleaned,[/Appointment Time\s*:\s*([^\n]+)/i,/Reporting date and time\s+([^\n]+)/i]),
    destination,fcCode,
    customer:first(cleaned,[/Purchasing entity\s+([^\n]+)/i,/RETAILER NAME\s+([^\n]+)/i,/Issued by\s+([^\n]+)/i]),
    supplier:first(cleaned,[/Supplier Name\s+([^\n]+)/i,/SELLER\s*:\s*([^\n]+)/i,/Vendor\s+([A-Z0-9-]+)/i]),
    currency:first(cleaned,[/Currency\s*:\s*([A-Z]{3})/i]) ?? (totalValue !== null ? 'INR' : null),
    totalQuantity,totalValue,
    cartonCount:number(first(cleaned,[/Carton Count\s*:\s*([\d,]+)/i])),
    lines,warnings,confidence,text:cleaned,
  };
}
