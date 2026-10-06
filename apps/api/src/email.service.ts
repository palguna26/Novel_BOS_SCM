import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import nodemailer from 'nodemailer';
@Injectable()
export class EmailService {
 async send(to:string, subject:string, text:string){
  if(process.env.EMAIL_CAPTURE !== 'false'){
   const dir=path.resolve(process.env.STORAGE_DIR||'./storage','emails'); await fs.mkdir(dir,{recursive:true});
   await fs.writeFile(path.join(dir,`${Date.now()}-${subject.replace(/[^a-z0-9]+/gi,'-')}.txt`),`To: ${to}\nSubject: ${subject}\n\n${text}`); return {status:'CAPTURED'};
  }
  const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST||'localhost',port:Number(process.env.SMTP_PORT||1025),secure:false});
  await transporter.sendMail({from:'scm@local.test',to,subject,text}); return {status:'SENT'};
 }
}
