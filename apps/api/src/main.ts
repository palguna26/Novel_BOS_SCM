import { ValidationPipe } from '@nestjs/common'; import { NestFactory } from '@nestjs/core'; import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'; import { AppModule } from './app.module'; import { integrationOpenApi } from './integration/integration.openapi'; import * as dotenv from 'dotenv'; import * as fs from 'node:fs'; import * as path from 'node:path';

function loadEnvironment(){
 const candidates:string[]=[];
 for(const start of [process.cwd(),__dirname]){
  let current=path.resolve(start);
  while(true){
   candidates.push(path.join(current,'.env'),path.join(current,'apps','api','.env'));
   const parent=path.dirname(current); if(parent===current)break; current=parent;
  }
 }
 for(const file of [...new Set(candidates)])if(fs.existsSync(file))dotenv.config({path:file,override:false});
}
loadEnvironment();
async function bootstrap(){const app=await NestFactory.create(AppModule); app.enableCors({origin:process.env.WEB_URL||'http://localhost:5173'}); app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true})); const config=new DocumentBuilder().setTitle('SCM API').setDescription('SCM v2 operational and Sales integration API').setVersion('1.0').addBearerAuth().build(); const document:any=SwaggerModule.createDocument(app,config); document.paths={...document.paths,...integrationOpenApi.paths}; document.tags=[...(document.tags||[]),...(integrationOpenApi.tags||[])]; document.components={...document.components,securitySchemes: integrationOpenApi.components.securitySchemes,parameters: {...(document.components?.parameters||{}),...integrationOpenApi.components.parameters},schemas: {...(document.components?.schemas||{}),...integrationOpenApi.components.schemas}}; SwaggerModule.setup('api/docs',app,document); await app.listen(Number(process.env.PORT)||4000);} bootstrap();
