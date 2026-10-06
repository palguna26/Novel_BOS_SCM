import {afterEach,beforeEach,describe,expect,it,jest} from '@jest/globals';
import {OpenRouterExtractor} from './openrouter-extractor';

const validDocument={
  platform:'AMAZON_RK',kind:'PURCHASE_ORDER',externalId:'4S2BJXYY',linkedPoIds:[],poDate:'2026-09-09',expiryDate:null,
  appointmentId:null,appointmentAt:null,destination:'BLR4',fcCode:'BLR4',customer:'RK WORLDINFOCOM',supplier:null,currency:'INR',
  totalQuantity:143,totalValue:null,cartonCount:null,
  lines:[{lineNumber:1,channelItemCode:'BABY-DIAPER-S',asin:'B0H8DSTSQT',ean:null,hsn:'33073090',description:null,ordered:143,approved:143,pending:0,unitPrice:329.27,taxRate:null,mrp:null,total:null}],
};

function response(content:unknown,ok=true){return {ok,status:ok?200:503,statusText:ok?'OK':'Unavailable',json:async()=>ok?{model:'openai/gpt-4o-mini',provider:'Azure',choices:[{message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}}:{error:{message:'provider unavailable'}}} as Response}

describe('OpenRouterExtractor',()=>{
  const originalKey=process.env.OPENROUTER_API_KEY;
  beforeEach(()=>{process.env.OPENROUTER_API_KEY='test-key'});
  afterEach(()=>{jest.restoreAllMocks();if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey});

  it('requests strict private extraction and validates the result',async()=>{
    const fetchMock=jest.spyOn(global,'fetch').mockResolvedValue(response(validDocument));
    const result=await new OpenRouterExtractor().extract({name:'po.pdf',data:Buffer.from('%PDF-test'),mediaType:'application/pdf',text:''});
    expect(result.document).toMatchObject({externalId:'4S2BJXYY',confidence:1});
    expect(result.metadata).toMatchObject({method:'openrouter',model:'openai/gpt-4o-mini',provider:'Azure',attempts:1});
    const request=JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.provider).toMatchObject({require_parameters:true,zdr:true,data_collection:'deny'});
    expect(request.max_completion_tokens).toBe(12000);
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.messages[1].content[1].file.file_data).toMatch(/^data:application\/pdf;base64,/);
  });

  it('retries once after invalid JSON',async()=>{
    jest.spyOn(global,'fetch').mockResolvedValueOnce({ok:true,status:200,json:async()=>({choices:[{message:{content:'not-json'}}]})} as Response).mockResolvedValueOnce(response(validDocument));
    const result=await new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('a,b'),mediaType:'text/csv',text:'PO data'});
    expect(result.metadata.attempts).toBe(2);
  });

  it('rejects invalid model values after both attempts',async()=>{
    const invalid={...validDocument,totalQuantity:-1};
    const fetchMock=jest.spyOn(global,'fetch').mockResolvedValue(response(invalid));
    await expect(new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('a,b'),mediaType:'text/csv',text:'PO data'})).rejects.toThrow('openrouter_failed:invalid_schema');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('times out and retries without hanging the upload',async()=>{
    process.env.OPENROUTER_TIMEOUT_MS='5';
    const fetchMock=jest.spyOn(global,'fetch').mockImplementation((_,init)=>new Promise((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')))));
    await expect(new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('a,b'),mediaType:'text/csv',text:'PO data'})).rejects.toThrow('openrouter_failed:aborted');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    delete process.env.OPENROUTER_TIMEOUT_MS;
  });

  it('does not call the API without a key',async()=>{
    delete process.env.OPENROUTER_API_KEY;
    const fetchMock=jest.spyOn(global,'fetch');
    await expect(new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('a,b'),mediaType:'text/csv',text:'PO data'})).rejects.toThrow('openrouter_not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
