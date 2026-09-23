import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import Exercise from './exercise.cjs';
import {integrationStatus,agentContract} from './integrations.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'dist');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
export function createExerciseServer({initialData=null,persistenceFile=null}={}){
  let savedAt=null;
  if(initialData===null&&persistenceFile&&existsSync(persistenceFile)){
    const saved=JSON.parse(readFileSync(persistenceFile,'utf8'));
    if(saved.format!==1||!saved.data)throw new Error('本地存档格式无效，未覆盖原文件');
    initialData=saved.data;savedAt=saved.savedAt;
  }
  let store=Exercise.create(initialData);const session=randomUUID(),seen=new Map(),clients=new Set();if(initialData===null)store.action('generate');
  function persist(data){if(!persistenceFile)return;const time=new Date().toISOString();mkdirSync(dirname(resolve(persistenceFile)),{recursive:true});writeFileSync(persistenceFile+'.writing',JSON.stringify({format:1,savedAt:time,data}),'utf8');renameSync(persistenceFile+'.writing',persistenceFile);savedAt=time;}
  if(persistenceFile)persist(store.data);
  const transport={preferred:'sse',eventsUrl:'/api/v3/events',eventName:'state',pollIntervalMs:1200};
  const capabilities={realtimeEvents:true,villageReporting:true,commandIntake:true,version:'3.7',operations:true,stateRestore:true,persistentStorage:!!persistenceFile,crossDeviceSync:false};
  const state=()=>{const data=store.data;return {session,data,savedAt,diagnostics:Exercise.diagnostics?.(data),metrics:Exercise.metrics(data),villageLedger:Exercise.villageMetrics(data),blockedVehicles:data.activePlan?.routes.filter(r=>Exercise.blockedRoute(data,r)).map(r=>r.vehicleId)||[],integrations:integrationStatus,transport,capabilities};};
  const maxClients=24,maxBufferedBytes=128*1024,heartbeatMs=15000;
  let heartbeat=null;
  function removeClient(client){clients.delete(client);clearTimeout(client.drainTimer);client.res.off('drain',client.onDrain);if(!clients.size&&heartbeat){clearInterval(heartbeat);heartbeat=null;}}
  function writeEvent(client,frame){
    const {res}=client;if(res.destroyed||res.writableEnded){removeClient(client);return;}
    if(res.writableLength+Buffer.byteLength(frame)>maxBufferedBytes){res.destroy();removeClient(client);return;}
    if(!res.write(frame)&&!client.drainTimer){client.drainTimer=setTimeout(()=>{res.destroy();removeClient(client);},heartbeatMs);client.drainTimer.unref();}
  }
  const stateFrame=value=>`id: ${value.session}:${value.data.revision}\nevent: state\ndata: ${JSON.stringify(value)}\n\n`;
  function broadcast(value){const frame=stateFrame(value);for(const client of clients)writeEvent(client,frame);}
  function subscribe(req,res){
    if(clients.size>=maxClients){json(res,503,{error:'演练实时连接已达上限，请关闭多余页面后重试'});return;}
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
    res.flushHeaders();req.socket.setKeepAlive(true);
    const client={res,drainTimer:null,onDrain:null};
    client.onDrain=()=>{clearTimeout(client.drainTimer);client.drainTimer=null;};
    clients.add(client);res.on('drain',client.onDrain);res.once('close',()=>removeClient(client));res.once('error',()=>removeClient(client));
    writeEvent(client,'retry: 1500\n\n');writeEvent(client,stateFrame(state()));
    if(clients.size&&!heartbeat){heartbeat=setInterval(()=>{for(const subscriber of clients)writeEvent(subscriber,`: heartbeat ${Date.now()}\n\n`);},heartbeatMs);heartbeat.unref();}
  }
  function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost'),host=new URL('http://'+req.headers.host).hostname;
      if(!['localhost','127.0.0.1','[::1]'].includes(host)){json(res,403,{error:'仅供本机演练'});return;}
      if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host){json(res,403,{error:'请求来源不匹配'});return;}
      if(url.pathname==='/api/v3/state'&&req.method==='GET'){const current=store.data;if(url.searchParams.get('session')===session&&Number(url.searchParams.get('after'))===current.revision)json(res,200,{session,unchanged:true,revision:current.revision,transport,capabilities});else json(res,200,state());return;}
      if(url.pathname==='/api/v3/events'&&req.method==='GET'){subscribe(req,res);return;}
      if(url.pathname==='/api/v3/integrations'&&req.method==='GET'){json(res,200,{integrations:integrationStatus,agentContract});return;}
      if(url.pathname==='/api/v3/agent'){json(res,501,{error:'Agent 接口已预留，本版本未连接外部模型',contract:agentContract});return;}
      if(url.pathname==='/api/ai/status'){json(res,200,{configured:false,model:'',reason:'V3 本地演练：Agent 接口准备中'});return;}
      if(url.pathname==='/api/v3/action'&&req.method==='POST'){
        if(!req.headers['content-type']?.startsWith('application/json')){json(res,415,{error:'需要 JSON 请求'});return;}
        const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>6*1024*1024){json(res,413,{error:'请求过长'});return;}chunks.push(chunk);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{json(res,400,{error:'JSON 格式无效'});return;}
        if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.action!=='string'||typeof input.requestId!=='string'||input.requestId.length>100||!input.requestId){json(res,400,{error:'操作参数无效'});return;}
        if(input.action!=='restore'&&bytes>(input.action==='command-intake'?262144:16384)){json(res,413,{error:'请求过长'});return;}
        const digest=JSON.stringify([input.action,input.payload||{},input.expectedRevision,input.session]);
        if(seen.has(input.requestId)){if(seen.get(input.requestId)!==digest){json(res,409,{error:'同一请求编号不能提交不同内容',...state()});return;}json(res,200,{duplicate:true,...state()});return;}
        if(input.session!==session||input.expectedRevision!==store.data.revision){json(res,409,{error:'另一网页已更新演练，请核对最新状态后重试；当前操作未执行',...state()});return;}
        if(!input.payload||typeof input.payload!=='object'||Array.isArray(input.payload)){json(res,400,{error:'操作内容无效'});return;}
        // Calculate in isolation; an unsuccessful disk write cannot commit the operation.
        let candidate;try{candidate=Exercise.create(store.data);candidate.action(input.action,input.payload);}catch(error){json(res,422,{error:error.message});return;}
        try{persist(candidate.data);}catch(error){json(res,503,{error:'本地存档写入失败，本次操作未提交，请检查磁盘后重试'});return;}
        store=candidate;
        seen.set(input.requestId,digest);if(seen.size>500)seen.delete(seen.keys().next().value);const latest=state();json(res,200,latest);broadcast(latest);return;
      }
      if(url.pathname.startsWith('/api/')){json(res,404,{error:'接口不存在或请求方法不支持'});return;}
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Method not allowed');return;}
      const file=resolve(root,url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/,''));
      if(!file.startsWith(root+sep)){res.writeHead(403);res.end('Forbidden');return;}
      const content=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:content);
    }catch(error){if(!res.headersSent){res.writeHead(error.code==='ENOENT'?404:400,{'Content-Type':'text/plain; charset=utf-8'});res.end('无法处理请求');}else res.end();}
  });
  const close=server.close.bind(server);server.close=function(callback){for(const client of [...clients]){client.res.end();removeClient(client);}return close(callback);};
  return {server,get store(){return store;},session};
}
