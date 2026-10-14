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
    const result=await new OpenRouterExtractor().extract({name:'po.pdf',data:Buffer.from('%PDF-test'),mediaType:'application/pdf',text:'PO: 4S2BJXYY'});
    expect(result.document).toMatchObject({externalId:'4S2BJXYY',confidence:1});
    expect(result.metadata).toMatchObject({method:'openrouter',model:'openai/gpt-4o-mini',provider:'Azure',attempts:1});
    const request=JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.provider).toMatchObject({require_parameters:false,zdr:false,data_collection:'allow'});
    expect(request.max_completion_tokens).toBe(12000);
    expect(request.response_format).toEqual({type:'json_object'});
    expect(request.messages[1].content).toHaveLength(1);
    expect(request.messages[1].content[0].text).toContain('PO: 4S2BJXYY');
    expect(request.plugins).toBeUndefined();
  });

  it('retries once after invalid JSON',async()=>{
    jest.spyOn(global,'fetch').mockResolvedValueOnce({ok:true,status:200,json:async()=>({choices:[{message:{content:'not-json'}}]})} as Response).mockResolvedValueOnce(response(validDocument));
    const result=await new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('a,b'),mediaType:'text/csv',text:'PO data'});
    expect(result.metadata.attempts).toBe(2);
  });

  it('accepts a complete JSON object in a Markdown fence',async()=>{
    const fetchMock=jest.spyOn(global,'fetch').mockResolvedValue({ok:true,status:200,json:async()=>({choices:[{message:{content:`\`\`\`json\n${JSON.stringify(validDocument)}\n\`\`\``}}]})} as Response);
    const result=await new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('a,b'),mediaType:'text/csv',text:'PO data'});
    expect(result.document.externalId).toBe('4S2BJXYY');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports truncated JSON when the model reaches its output limit',async()=>{
    jest.spyOn(global,'fetch').mockResolvedValue({ok:true,status:200,json:async()=>({choices:[{finish_reason:'length',message:{content:'{"platform":"FLIPKART","lines":['}}],usage:{completion_tokens:12000}})} as Response);
    await expect(new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('a,b'),mediaType:'text/csv',text:'PO data'})).rejects.toThrow('openrouter_failed:truncated_json');
  });

  it('surfaces a provider error returned with HTTP 200',async()=>{
    const fetchMock=jest.spyOn(global,'fetch').mockResolvedValue({ok:true,status:200,json:async()=>({error:{message:'Provider failed while generating'},choices:[]})} as Response);
    await expect(new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('a,b'),mediaType:'text/csv',text:'PO data'})).rejects.toThrow('openrouter_failed:provider_error:Provider failed while generating');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports the finish reason when no text was generated',async()=>{
    jest.spyOn(global,'fetch').mockResolvedValue({ok:true,status:200,json:async()=>({choices:[{finish_reason:'length',message:{content:''}}],usage:{completion_tokens:12000}})} as Response);
    await expect(new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('a,b'),mediaType:'text/csv',text:'PO data'})).rejects.toThrow('openrouter_failed:empty_response:length');
  });

  it('reports a timeout when response body reading is aborted',async()=>{
    const fetchMock=jest.spyOn(global,'fetch').mockImplementation(async (_,init)=>({
      ok:true,status:200,
      json:()=>new Promise((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')))),
    } as Response));
    process.env.OPENROUTER_TIMEOUT_MS='5';
    try{
      await expect(new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('a,b'),mediaType:'text/csv',text:'PO data'})).rejects.toThrow('openrouter_failed:request_timeout');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }finally{delete process.env.OPENROUTER_TIMEOUT_MS;}
  });

  it('accepts text parts in a completion message',async()=>{
    jest.spyOn(global,'fetch').mockResolvedValue({ok:true,status:200,json:async()=>({choices:[{message:{content:[{type:'text',text:JSON.stringify(validDocument)}]}}]})} as Response);
    const result=await new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('a,b'),mediaType:'text/csv',text:'PO data'});
    expect(result.document.externalId).toBe('4S2BJXYY');
  });

  it('accepts a valid JSON response without repeated nullable fields',async()=>{
    const partial={platform:'AMAZON_RK',kind:'PURCHASE_ORDER',externalId:'4S2BJXYY',destination:'BLR4',lines:[{channelItemCode:'BABY-DIAPER-S',ordered:143}]};
    jest.spyOn(global,'fetch').mockResolvedValue(response(partial));
    const result=await new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('a,b'),mediaType:'text/csv',text:'PO data'});
    expect(result.document).toMatchObject({externalId:'4S2BJXYY',destination:'BLR4'});
    expect(result.document.lines[0]).toMatchObject({lineNumber:1,ordered:143});
  });

  it('uses the rules parser when the model returns a null document kind',async()=>{
    jest.spyOn(global,'fetch').mockResolvedValue(response({...validDocument,platform:null,kind:null}));
    const result=await new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('PURCHASE ORDER NO: 4S2BJXYY'),mediaType:'text/csv',text:'FLIPKART INDIA PRIVATE LIMITED\nPURCHASE ORDER NO: 4S2BJXYY'});
    expect(result.document.kind).toBe('PURCHASE_ORDER');
    expect(result.document.platform).toBe('FLIPKART');
    expect(result.metadata.attempts).toBe(1);
  });

  it('keeps usable PO fields when optional model values are invalid',async()=>{
    const invalid={...validDocument,totalQuantity:-1,totalValue:'1,250.50',poDate:'09/10/2026',unexpected:'extra',lines:[{...validDocument.lines[0],ordered:'143',extra:'ignored'}]};
    const fetchMock=jest.spyOn(global,'fetch').mockResolvedValue(response(invalid));
    const result=await new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('a,b'),mediaType:'text/csv',text:'PO data'});
    expect(result.document).toMatchObject({externalId:'4S2BJXYY',totalValue:1250.5,totalQuantity:null,poDate:null});
    expect(result.document.lines[0]).toMatchObject({ordered:143});
    expect(result.document.warnings).toContain('Some AI fields had invalid formats and require review.');
    expect(result.document.confidence).toBeLessThanOrEqual(0.8);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a model response with no useful document fields',async()=>{
    const fetchMock=jest.spyOn(global,'fetch').mockResolvedValue(response({platform:'UNKNOWN',kind:'UNKNOWN'}));
    await expect(new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('a,b'),mediaType:'text/csv',text:'PO data'})).rejects.toThrow('openrouter_failed:invalid_schema');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('times out and retries without hanging the upload',async()=>{
    process.env.OPENROUTER_TIMEOUT_MS='5';
    const fetchMock=jest.spyOn(global,'fetch').mockImplementation((_,init)=>new Promise((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')))));
    await expect(new OpenRouterExtractor().extract({name:'po.csv',data:Buffer.from('a,b'),mediaType:'text/csv',text:'PO data'})).rejects.toThrow('openrouter_failed:request_timeout');
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
