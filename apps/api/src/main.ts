import { ValidationPipe } from '@nestjs/common'; import { NestFactory } from '@nestjs/core'; import { AppModule } from './app.module'; import * as dotenv from 'dotenv'; import * as fs from 'node:fs'; import * as path from 'node:path';

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
async function bootstrap(){const app=await NestFactory.create(AppModule); app.enableCors({origin:process.env.WEB_URL||'http://localhost:5173'}); app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true})); await app.listen(Number(process.env.PORT)||4000);} bootstrap();
