import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as path from 'node:path'; import * as crypto from 'node:crypto';
import { normalizeDocument } from './document-extractor';
import { SupabaseService } from './supabase.service';
import { ExtractionMetadata, OpenRouterExtractor } from './openrouter-extractor';
import { resolveSkuLines } from './sku-resolver';
export interface DocumentStorage { bucket:string; save(name:string,data:Buffer,mediaType?:string,scope?:string):Promise<string>; remove(name:string):Promise<void>; }
@Injectable() export class SupabaseDocumentStorage implements DocumentStorage {
 bucket=process.env.DOCUMENT_STORAGE_BUCKET||'scm-documents';
 constructor(private readonly supabase:SupabaseService){}
 async save(name:string,data:Buffer,mediaType='application/octet-stream',scope='unassigned'){
  const safe=name.replace(/[^a-z0-9._-]/gi,'_');
  const objectPath=`${scope}/documents/${Date.now()}-${crypto.randomUUID()}-${safe}`;
  const {error}=await this.supabase.client.storage.from(this.bucket).upload(objectPath,data,{contentType:mediaType,upsert:false});
  if(error)throw new BadRequestException(`Document storage failed: ${error.message}`);
  return objectPath;
 }
 async remove(objectPath:string){
  const {error}=await this.supabase.client.storage.from(this.bucket).remove([objectPath]);
  if(error) throw new BadRequestException(`Document cleanup failed: ${error.message}`);
 }
}
@Injectable() export class DocumentService {
 constructor(private storage:SupabaseDocumentStorage,private supabase:SupabaseService,private openRouter:OpenRouterExtractor){}
 async previewAndExtract(name:string,data:Buffer,user?:any,mediaType='application/octet-stream',extractedText?:string){
  this.validateUpload(name,data,mediaType); let text=extractedText||'';
  if(name.toLowerCase().endsWith('.pdf')){try{const pdfjs:any=await import('pdfjs-dist/legacy/build/pdf.mjs'); const pdf=await pdfjs.getDocument({data:new Uint8Array(data)}).promise; let parsedText=''; for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i); const c=await page.getTextContent(); parsedText+=this.pageText(c.items||[])+'\n';} if(parsedText.trim())text=parsedText;}catch{ /* Keep browser text if server parsing fails. */ }}
  text=text.replace(/\u0000/g,'');
  const extractionStarted=Date.now(); let extracted; let extraction:ExtractionMetadata;
  if(this.openRouter.isConfigured()){
   try{const ai=await this.openRouter.extract({name,data,mediaType,text});extracted=ai.document;extraction=ai.metadata;}
   catch(error){extracted=normalizeDocument(text);extracted.confidence=Math.min(extracted.confidence,0.8);extraction={method:'rules',attempts:2,latencyMs:Date.now()-extractionStarted,fallbackReason:error instanceof Error?error.message:'openrouter_failed'};}
  }else{extracted=normalizeDocument(text);extracted.confidence=Math.min(extracted.confidence,0.8);extraction={method:'rules',attempts:0,latencyMs:Date.now()-extractionStarted,fallbackReason:'openrouter_not_configured'};}
  extracted=this.stripNullBytes(await this.resolveSkuItems(extracted,user));
  return {filename:name,extracted,confidence:extracted.confidence,warnings:extracted.warnings,extraction};
 }
 async saveAndExtract(name:string,data:Buffer,user?:any,idempotencyKey?:string,mediaType='application/octet-stream',extractedText?:string){this.validateUpload(name,data,mediaType);mediaType=this.storageMediaType(name,mediaType);const file=await this.storage.save(name,data,mediaType,user?.companyId); let text=extractedText||'';
  if(name.toLowerCase().endsWith('.pdf')){try{const pdfjs:any=await import('pdfjs-dist/legacy/build/pdf.mjs'); const pdf=await pdfjs.getDocument({data:new Uint8Array(data)}).promise; let parsedText=''; for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i); const c=await page.getTextContent(); parsedText+=this.pageText(c.items||[])+'\n';} if(parsedText.trim())text=parsedText;}catch{ /* Keep browser text if server parsing fails. */ }}
  text=text.replace(/\u0000/g,'');
  const extractionStarted=Date.now(); let extracted; let extraction:ExtractionMetadata;
  if(this.openRouter.isConfigured()){
   try{const ai=await this.openRouter.extract({name,data,mediaType,text});extracted=ai.document;extraction=ai.metadata;}
   catch(error){extracted=normalizeDocument(text);extracted.confidence=Math.min(extracted.confidence,0.8);extraction={method:'rules',attempts:2,latencyMs:Date.now()-extractionStarted,fallbackReason:error instanceof Error?error.message:'openrouter_failed'};}
  }else{extracted=normalizeDocument(text);extracted.confidence=Math.min(extracted.confidence,0.8);extraction={method:'rules',attempts:0,latencyMs:Date.now()-extractionStarted,fallbackReason:'openrouter_not_configured'};}
  extracted = this.stripNullBytes(await this.resolveSkuItems(extracted, user));
  const sha256=this.hash(data);
  let registration:any=null;
  if(user?.companyId){const {data:registered,error}=await this.supabase.rpc<any>('documents','register_extraction',{p_payload:{companyId:user.companyId,documentType:extracted.kind,businessKey:extracted.externalId||extracted.appointmentId,filename:name,storageBucket:this.storage.bucket,storagePath:file,mediaType,byteSize:data.length,sha256,confidence:extracted.confidence,extracted:{...extracted,_extraction:extraction}},p_actor_id:user.id,p_idempotency_key:idempotencyKey||crypto.randomUUID()});if(error){await this.storage.remove(file).catch(()=>undefined);throw new Error(error.message);}registration=registered;if(registered?.duplicate){await this.storage.remove(file).catch(()=>undefined);}}
  return {file,filename:name,sha256,extracted,confidence:extracted.confidence,warnings:extracted.warnings,extraction,...registration};
 }

 async saveWithoutExtraction(name:string,data:Buffer,user:any,idempotencyKey?:string,mediaType='application/octet-stream'){
  this.validateUpload(name,data,mediaType);
  mediaType=this.storageMediaType(name,mediaType);
  if(!user?.canWrite || !user?.companyId)throw new BadRequestException('Write access is required.');
  const file=await this.storage.save(name,data,mediaType,user.companyId);
  const sha256=this.hash(data);
  const {data:registration,error}=await this.supabase.rpc<any>('documents','register_extraction',{p_payload:{companyId:user.companyId,documentType:'POD',filename:name,storageBucket:this.storage.bucket,storagePath:file,mediaType,byteSize:data.length,sha256,confidence:0,extracted:{kind:'POD',method:'file_only'}},p_actor_id:user.id,p_idempotency_key:idempotencyKey||crypto.randomUUID()});
  if(error){await this.storage.remove(file).catch(()=>undefined);throw new BadRequestException(error.message);}
  if(registration?.duplicate)await this.storage.remove(file).catch(()=>undefined);
  return {documentVersionId:registration?.documentVersionId,filename:name,duplicate:registration?.duplicate||false};
 }
 async signedUrl(documentVersionId:string,user:any){
  const {data,error}=await this.supabase.schema('documents').from('document_versions').select('id,filename,storage_bucket,storage_path').eq('id',documentVersionId).eq('company_id',user.companyId).maybeSingle();
  if(error)throw new BadRequestException(error.message);
  if(!data)throw new NotFoundException('Document not found');
  const {data:url,error:urlError}=await this.supabase.client.storage.from(data.storage_bucket).createSignedUrl(data.storage_path,600);
  if(urlError)throw new BadRequestException(urlError.message);
  const {error:auditError}=await this.supabase.rpc('platform','write_audit',{p_company_id:user.companyId,p_actor_id:user.id,p_action:'DOCUMENT_VIEWED',p_entity_type:'DOCUMENT_VERSION',p_entity_id:data.id,p_old_value:null,p_new_value:{filename:data.filename},p_reason:null,p_source:'API'});
  if(auditError)throw new BadRequestException(`Audit logging failed: ${auditError.message}`);
  return {documentVersionId:data.id,filename:data.filename,url:url?.signedUrl,expiresIn:600};
 }
 private async resolveSkuItems(extracted:any, user?:any){
  if(!user?.companyId || !extracted.lines?.length) return extracted;
  try {
   const [itemsResult, identifiersResult, channelsResult] = await Promise.all([
    this.supabase.schema('master_data').from('items').select('id,code,name').eq('company_id', user.companyId),
    this.supabase.schema('master_data').from('item_identifiers').select('item_id,value,identifier_type,channel_id').eq('company_id', user.companyId).eq('active', true),
    this.supabase.schema('master_data').from('channels').select('id,code').eq('company_id', user.companyId),
   ]);
   const items = itemsResult.data || [];
   const identifiers = identifiersResult.data || [];
   const platformCode: Record<string, string> = { AMAZON_RK: 'AMZ', FLIPKART: 'FLIP', BLINKIT: 'BLINK' };
   const channelId = (channelsResult.data || []).find((channel: any) => channel.code === (platformCode[extracted.platform] || extracted.platform))?.id;
   const lines = resolveSkuLines(extracted.lines, items, identifiers, channelId);
   const unresolved = lines.filter((line: any) => !line.itemId).length;
   return {
    ...extracted,
    lines,
    warnings: unresolved ? [...extracted.warnings, `${unresolved} line item(s) could not be matched to the inventory SKU master.`] : extracted.warnings,
    skuResolution: { matched: lines.length - unresolved, unresolved },
   };
  } catch { return extracted; }
 }
 private storageMediaType(name:string,mediaType:string){
  if(mediaType && mediaType!=='application/octet-stream')return mediaType;
  const types:Record<string,string>={'.pdf':'application/pdf','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.csv':'text/csv','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png'};
  return types[path.extname(name).toLowerCase()]||mediaType;
 }
  private validateUpload(name:string,data:Buffer,mediaType:string){
  const ext=path.extname(name).toLowerCase();
  const allowed:Record<string,string[]>={'.pdf':['application/pdf'],'.xlsx':['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/zip'],'.csv':['text/csv','application/csv','text/plain','application/vnd.ms-excel'],'.docx':['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/zip'],'.jpg':['image/jpeg'],'.jpeg':['image/jpeg'],'.png':['image/png']};
  if(!allowed[ext])throw new BadRequestException('Unsupported file type. Choose PDF, XLSX, CSV, DOCX, JPG, JPEG, or PNG.');
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
  if((ext==='.jpg'||ext==='.jpeg')&&!(header[0]===0xff&&header[1]===0xd8&&header[2]===0xff))throw new BadRequestException('The file content does not match its extension.');
  if(ext==='.png'&&header.subarray(0,8).compare(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))!==0)throw new BadRequestException('The file content does not match its extension.');
  if(ext==='.csv'&&data.includes(0))throw new BadRequestException('The CSV file must contain text.');
 }
 private pageText(items:any[]){
  const rows=new Map<number,{x:number;text:string}[]>();
  for(const item of items){const y=Math.round(Number(item.transform?.[5]||0)/2)*2;const row=rows.get(y)||[];row.push({x:Number(item.transform?.[4]||0),text:String(item.str||'')});rows.set(y,row);}
  return [...rows.entries()].sort((a,b)=>b[0]-a[0]).map(([,row])=>row.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ').trim()).filter(Boolean).join('\n');
 }
 private stripNullBytes<T>(value:T):T{
  if(typeof value==='string')return value.replace(/\u0000/g,'') as T;
  if(Array.isArray(value))return value.map(item=>this.stripNullBytes(item)) as T;
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,this.stripNullBytes(item)])) as T;
  return value;
 }
 hash(data:Buffer){return crypto.createHash('sha256').update(data).digest('hex')}
}
