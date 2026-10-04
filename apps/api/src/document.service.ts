import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs/promises'; import * as path from 'node:path'; import * as crypto from 'node:crypto';
import { normalizeDocument } from './document-extractor';
import { SupabaseService } from './supabase.service';
export interface DocumentStorage { save(name:string,data:Buffer):Promise<string>; read(file:string):Promise<Buffer>; }
@Injectable() export class LocalDocumentStorage implements DocumentStorage {
 private root=path.resolve(process.env.STORAGE_DIR||'./storage','documents');
 async save(name:string,data:Buffer){await fs.mkdir(this.root,{recursive:true}); const safe=`${Date.now()}-${name.replace(/[^a-z0-9._-]/gi,'_')}`; await fs.writeFile(path.join(this.root,safe),data); return path.join(this.root,safe);}
 async read(file:string){return fs.readFile(file)}
}
@Injectable() export class DocumentService {
 constructor(private storage:LocalDocumentStorage,private supabase:SupabaseService){}
 async saveAndExtract(name:string,data:Buffer,user?:any,idempotencyKey?:string,mediaType='application/octet-stream'){const file=await this.storage.save(name,data); let text='';
  if(name.toLowerCase().endsWith('.pdf')){try{const pdfjs:any=await import('pdfjs-dist/legacy/build/pdf.mjs'); const pdf=await pdfjs.getDocument({data:new Uint8Array(data)}).promise; for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i); const c=await page.getTextContent(); text+=this.pageText(c.items||[])+'\n';}}catch{ text=''; }}
  const extracted=normalizeDocument(text); const sha256=this.hash(data);
  let registration:any=null;
  if(user?.companyId){const {data:registered,error}=await this.supabase.rpc<any>('documents','register_extraction',{p_payload:{companyId:user.companyId,documentType:extracted.kind,businessKey:extracted.externalId||extracted.appointmentId,filename:name,storageBucket:'local',storagePath:file,mediaType,byteSize:data.length,sha256,confidence:extracted.confidence,extracted},p_actor_id:user.id,p_idempotency_key:idempotencyKey||crypto.randomUUID()});if(error)throw new Error(error.message);registration=registered;}
  return {file,filename:name,sha256,extracted,confidence:extracted.confidence,warnings:extracted.warnings,...registration};
 }
 private pageText(items:any[]){
  const rows=new Map<number,{x:number;text:string}[]>();
  for(const item of items){const y=Math.round(Number(item.transform?.[5]||0)/2)*2;const row=rows.get(y)||[];row.push({x:Number(item.transform?.[4]||0),text:String(item.str||'')});rows.set(y,row);}
  return [...rows.entries()].sort((a,b)=>b[0]-a[0]).map(([,row])=>row.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ').trim()).filter(Boolean).join('\n');
 }
 hash(data:Buffer){return crypto.createHash('sha256').update(data).digest('hex')}
}
