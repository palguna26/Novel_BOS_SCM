import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'node:fs/promises'; import * as path from 'node:path'; import * as crypto from 'node:crypto';
import { normalizeDocument } from './document-extractor';
import { SupabaseService } from './supabase.service';
import { ExtractionMetadata, OpenRouterExtractor } from './openrouter-extractor';
import { resolveSkuLines } from './sku-resolver';
export interface DocumentStorage { save(name:string,data:Buffer):Promise<string>; read(file:string):Promise<Buffer>; }
@Injectable() export class LocalDocumentStorage implements DocumentStorage {
 private root=path.resolve(process.env.STORAGE_DIR||'./storage','documents');
 async save(name:string,data:Buffer){await fs.mkdir(this.root,{recursive:true}); const safe=`${Date.now()}-${name.replace(/[^a-z0-9._-]/gi,'_')}`; await fs.writeFile(path.join(this.root,safe),data); return path.join(this.root,safe);}
 async read(file:string){return fs.readFile(file)}
}
@Injectable() export class DocumentService {
 constructor(private storage:LocalDocumentStorage,private supabase:SupabaseService,private openRouter:OpenRouterExtractor){}
 async saveAndExtract(name:string,data:Buffer,user?:any,idempotencyKey?:string,mediaType='application/octet-stream',extractedText?:string){this.validateUpload(name,data,mediaType);const file=await this.storage.save(name,data); let text=extractedText||'';
  if(!text&&name.toLowerCase().endsWith('.pdf')){try{const pdfjs:any=await import('pdfjs-dist/legacy/build/pdf.mjs'); const pdf=await pdfjs.getDocument({data:new Uint8Array(data)}).promise; for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i); const c=await page.getTextContent(); text+=this.pageText(c.items||[])+'\n';}}catch{ text=''; }}
  const extractionStarted=Date.now(); let extracted; let extraction:ExtractionMetadata;
  if(this.openRouter.isConfigured()){
   try{const ai=await this.openRouter.extract({name,data,mediaType,text});extracted=ai.document;extraction=ai.metadata;}
   catch(error){extracted=normalizeDocument(text);extraction={method:'rules',attempts:2,latencyMs:Date.now()-extractionStarted,fallbackReason:error instanceof Error?error.message:'openrouter_failed'};}
  }else{extracted=normalizeDocument(text);extraction={method:'rules',attempts:0,latencyMs:Date.now()-extractionStarted,fallbackReason:'openrouter_not_configured'};}
  extracted = await this.resolveSkuItems(extracted, user);
  const sha256=this.hash(data);
  let registration:any=null;
  if(user?.companyId){const {data:registered,error}=await this.supabase.rpc<any>('documents','register_extraction',{p_payload:{companyId:user.companyId,documentType:extracted.kind,businessKey:extracted.externalId||extracted.appointmentId,filename:name,storageBucket:'local',storagePath:file,mediaType,byteSize:data.length,sha256,confidence:extracted.confidence,extracted:{...extracted,_extraction:extraction}},p_actor_id:user.id,p_idempotency_key:idempotencyKey||crypto.randomUUID()});if(error)throw new Error(error.message);registration=registered;}
  return {file,filename:name,sha256,extracted,confidence:extracted.confidence,warnings:extracted.warnings,extraction,...registration};
 }
 private async resolveSkuItems(extracted:any, user?:any){
  if(!user?.companyId || !extracted.lines?.length) return extracted;
  try {
   const [itemsResult, identifiersResult] = await Promise.all([
    this.supabase.schema('master_data').from('items').select('id,code,name').eq('company_id', user.companyId),
    this.supabase.schema('master_data').from('item_identifiers').select('item_id,value,identifier_type').eq('company_id', user.companyId).eq('active', true),
   ]);
   const items = itemsResult.data || [];
   const identifiers = identifiersResult.data || [];
   const lines = resolveSkuLines(extracted.lines, items, identifiers);
   const unresolved = lines.filter((line: any) => !line.itemId).length;
   return {
    ...extracted,
    lines,
    warnings: unresolved ? [...extracted.warnings, `${unresolved} line item(s) could not be matched to the inventory SKU master.`] : extracted.warnings,
    skuResolution: { matched: lines.length - unresolved, unresolved },
   };
  } catch { return extracted; }
 }
 private validateUpload(name:string,data:Buffer,mediaType:string){
  const ext=path.extname(name).toLowerCase();
  const allowed:Record<string,string[]>={'.pdf':['application/pdf'],'.xlsx':['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/zip'],'.csv':['text/csv','application/csv','text/plain','application/vnd.ms-excel'],'.docx':['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/zip']};
  if(!allowed[ext])throw new BadRequestException('Unsupported file type. Choose PDF, XLSX, CSV, or DOCX.');
  if(mediaType&&mediaType!=='application/octet-stream'&&!allowed[ext].includes(mediaType))throw new BadRequestException('The file type does not match its extension.');
  const header=data.subarray(0,8);
  if(ext==='.pdf'&&header.subarray(0,5).toString()!=='%PDF-')throw new BadRequestException('The file content does not match its extension.');
  if(ext==='.xlsx'||ext==='.docx'){
   const zip=header[0]===0x50&&header[1]===0x4b;
   const encryptedOffice=header.equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
   if(!zip&&!encryptedOffice)throw new BadRequestException('The file content does not match its extension.');
   if(encryptedOffice&&mediaType!==allowed[ext][0])throw new BadRequestException('The file type does not match its extension.');
   if(zip){const archive=data.toString('latin1'); const expected=ext==='.xlsx'?'xl/':'word/';if(!archive.includes(expected))throw new BadRequestException('The file content does not match its extension.');}
  }
  if(ext==='.csv'&&data.includes(0))throw new BadRequestException('The CSV file must contain text.');
 }
 private pageText(items:any[]){
  const rows=new Map<number,{x:number;text:string}[]>();
  for(const item of items){const y=Math.round(Number(item.transform?.[5]||0)/2)*2;const row=rows.get(y)||[];row.push({x:Number(item.transform?.[4]||0),text:String(item.str||'')});rows.set(y,row);}
  return [...rows.entries()].sort((a,b)=>b[0]-a[0]).map(([,row])=>row.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ').trim()).filter(Boolean).join('\n');
 }
 hash(data:Buffer){return crypto.createHash('sha256').update(data).digest('hex')}
}
