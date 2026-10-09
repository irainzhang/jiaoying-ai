import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import Exercise from './exercise.cjs';
import releaseCapabilities from './dist/capabilities.js';
import {integrationStatus,agentContract} from './integrations.mjs';
import {createRoomAccess} from './room-access.mjs';
import {createSemanticGateway,readSemanticConfig} from './semantic-gateway.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'dist');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
export function createExerciseServer({initialData=null,persistenceFile=null,startMode='sample',sharedRoom=null,semanticConfig,semanticOptions}={}){
  const room=sharedRoom?createRoomAccess(sharedRoom):null;
  const semantic=createSemanticGateway(semanticConfig===undefined?readSemanticConfig():semanticConfig,semanticOptions);
  let savedAt=null;
  if(initialData===null&&persistenceFile&&existsSync(persistenceFile)){
    const saved=JSON.parse(readFileSync(persistenceFile,'utf8'));
    if(saved.format!==1||!saved.data)throw new Error('本地存档格式无效，未覆盖原文件');
    initialData=saved.data;savedAt=saved.savedAt;
  }
  let store=Exercise.create(initialData===null&&startMode==='blank'?Exercise.createBlank({mapMode:'ruian-roads'}):initialData);const session=randomUUID(),seen=new Map(),clients=new Set();if(initialData===null&&startMode!=='blank')store.action('generate');
  function persist(data){if(!persistenceFile)return;const time=new Date().toISOString();mkdirSync(dirname(resolve(persistenceFile)),{recursive:true});writeFileSync(persistenceFile+'.writing',JSON.stringify({format:1,savedAt:time,data}),'utf8');renameSync(persistenceFile+'.writing',persistenceFile);savedAt=time;}
  if(persistenceFile)persist(store.data);
  const transport={preferred:'sse',eventsUrl:'/api/v3/events',eventName:'state',pollIntervalMs:1200};
  const connection={mode:room?'lan-room':'local',roomId:room?.roomId||null,shared:!!room,scopeLabel:room?'同 Wi-Fi 房间':'仅本机浏览器',speechNote:room?'手机 HTTP 页面可能不支持浏览器语音识别，可使用系统键盘语音听写。':''};
  const capabilities={realtimeEvents:true,villageReporting:true,commandIntake:true,mapDemandLocation:true,roadMapConversion:true,numericRainfall:true,taskLifecycle:true,resourceRegistry:true,version:releaseCapabilities.version,operations:true,stateRestore:true,persistentStorage:!!persistenceFile,crossDeviceSync:!!room};
  const connectionFor=user=>room&&user?{...connection,...room.connection(user)}:connection;
  const state=(user=null)=>{const full=store.data,limited=room&&user?.role==='field',data=limited?room.project(full,user):full;
    const metricData=limited?{...data,villageReports:data.villageReports.filter(r=>r.status==='pending')}:data;
    return {session,data,savedAt,connection:connectionFor(user),diagnostics:limited?null:Exercise.diagnostics?.(data),metrics:Exercise.metrics(metricData),taskSummary:Exercise.taskSummary?.(metricData),mapConversion:limited?{allowed:false,reason:'执行端仅展示本车任务',reasons:[{message:'执行端仅展示本车任务'}]}:Exercise.mapConversionStatus(data),villageLedger:Exercise.villageMetrics(metricData),blockedVehicles:full.activePlan?.routes.filter(r=>(!limited||r.vehicleId===user.vehicleId)&&Exercise.blockedRoute(full,r)).map(r=>r.vehicleId)||[],integrations:integrationStatus,transport,capabilities:limited?{...capabilities,commandIntake:false,resourceRegistry:false,operations:false,stateRestore:false,mapDemandLocation:false,roadMapConversion:false,numericRainfall:false,taskLifecycle:false}:capabilities};};
  // Road snapshots and retained task history can exceed 128 KiB. Permit one
  // bounded full snapshot while still disconnecting readers that stop draining.
  const maxClients=24,maxBufferedBytes=8*1024*1024,heartbeatMs=15000;
  let heartbeat=null;
  function removeClient(client){clients.delete(client);clearTimeout(client.drainTimer);client.res.off('drain',client.onDrain);if(!clients.size&&heartbeat){clearInterval(heartbeat);heartbeat=null;}}
  function writeEvent(client,frame){
    const {res}=client;if(res.destroyed||res.writableEnded){removeClient(client);return;}
    if(res.writableLength+Buffer.byteLength(frame)>maxBufferedBytes){res.destroy();removeClient(client);return;}
    if(!res.write(frame)&&!client.drainTimer){client.drainTimer=setTimeout(()=>{res.destroy();removeClient(client);},heartbeatMs);client.drainTimer.unref();}
  }
  const stateFrame=value=>`id: ${value.session}:${value.data.revision}\nevent: state\ndata: ${JSON.stringify(value)}\n\n`;
  function broadcast(){for(const client of clients){if(room&&!room.active(client.user,store.data)){client.res.end();removeClient(client);continue;}writeEvent(client,stateFrame(state(client.user)));}}
  function subscribe(req,res,user=null){
    if(clients.size>=maxClients){json(res,503,{error:'演练实时连接已达上限，请关闭多余页面后重试'});return;}
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
    res.flushHeaders();req.socket.setKeepAlive(true);
    const client={res,user,drainTimer:null,onDrain:null};
    client.onDrain=()=>{clearTimeout(client.drainTimer);client.drainTimer=null;};
    clients.add(client);res.on('drain',client.onDrain);res.once('close',()=>removeClient(client));res.once('error',()=>removeClient(client));
    writeEvent(client,'retry: 1500\n\n');writeEvent(client,stateFrame(state(user)));
    if(clients.size&&!heartbeat){heartbeat=setInterval(()=>{for(const subscriber of clients){if(room&&!room.active(subscriber.user,store.data)){subscriber.res.end();removeClient(subscriber);}else writeEvent(subscriber,`: heartbeat ${Date.now()}\n\n`);}},heartbeatMs);heartbeat.unref();}
  }
  function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost'),host=new URL('http://'+req.headers.host).hostname;
      if(room?(!room.acceptsHost(host)||!room.acceptsAddress(req.socket.remoteAddress)):!['localhost','127.0.0.1','[::1]'].includes(host)){json(res,403,{error:room?'仅允许本房间列出的同 Wi-Fi 地址':'仅供本机演练'});return;}
      if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host){json(res,403,{error:'请求来源不匹配'});return;}
      let user=null;
      if(room){
        if(req.method==='POST'&&req.headers.origin!=='http://'+req.headers.host){json(res,403,{error:'房间提交必须来自同一网页地址'});return;}
        if(url.pathname==='/join'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});res.end(room.page());return;}
        if(url.pathname==='/api/v3/room/join'&&req.method==='POST'){
          if(!req.headers['content-type']?.startsWith('application/json')){json(res,415,{error:'需要 JSON 请求'});return;}
          const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>2048){json(res,413,{error:'加入信息过长'});return;}chunks.push(chunk);}
          let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch(_){json(res,400,{error:'JSON 格式无效'});return;}
          const joined=room.join(req,input?.token,store.data);if(joined.cookie){res.setHeader('Set-Cookie',joined.cookie);for(const client of [...clients])if(!room.active(client.user,store.data)){client.res.end();removeClient(client);}}json(res,joined.status,joined.cookie?{joined:true,roomId:room.roomId,connection:joined.connection}:{error:joined.error});return;
        }
        user=room.principal(req);
        if(!user){
          if(url.pathname.startsWith('/api/'))json(res,401,{error:'请先使用房间加入链接登录本次演练',joinUrl:'/join'});
          else{res.writeHead(303,{'Location':'/join','Cache-Control':'no-store'});res.end();}return;
        }
        if(!room.active(user,store.data)){json(res,403,{error:'当前身份或车辆编组已变化，请联系指挥员重新发送本场绑定链接',joinUrl:'/join'});return;}
        if(url.pathname==='/room/manage'||url.pathname==='/api/v3/room/invitations'||url.pathname==='/api/v3/room/revoke'){
          if(user.role!=='commander'){json(res,403,{error:'仅指挥员可以管理执行人员接入'});return;}
          if(url.pathname==='/room/manage'&&req.method==='GET'){
            const port=new URL('http://'+req.headers.host).port;const addresses=(sharedRoom.allowedHosts||[]).map(address=>'http://'+address+(port?':'+port:''));
            res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(room.managePage(addresses));return;
          }
          if(url.pathname==='/api/v3/room/invitations'&&req.method==='GET'){json(res,200,{invitations:room.invitationList()});return;}
          if(req.method!=='POST'){json(res,405,{error:'请求方法不支持'});return;}
          if(!req.headers['content-type']?.startsWith('application/json')){json(res,415,{error:'需要 JSON 请求'});return;}
          const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>2048){json(res,413,{error:'接入信息过长'});return;}chunks.push(chunk);}
          let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch(_){json(res,400,{error:'JSON 格式无效'});return;}
          try{
            if(url.pathname==='/api/v3/room/invitations')json(res,200,room.createInvitation(store.data,body));
            else{room.revoke(body.invitationId);for(const client of [...clients])if(client.user?.invitationId===body.invitationId){client.res.end();removeClient(client);}json(res,200,{revoked:true});}
          }catch(error){json(res,422,{error:error.message});}return;
        }
      }
      if(url.pathname==='/api/v3/semantic'||url.pathname==='/api/v3/semantic/status'){
        // A forged localhost Host header must not make the local proxy available
        // over a network socket. LAN requests have already passed room auth above.
        const address=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
        if(!room&&address!=='::1'&&!/^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(address)){json(res,403,{error:'语义整理代理仅接受本机或已加入的同 Wi-Fi 房间'});return;}
        await semantic.handle(req,res);return;
      }
      if(url.pathname==='/api/v3/state'&&req.method==='GET'){const current=store.data;if(url.searchParams.get('session')===session&&Number(url.searchParams.get('after'))===current.revision)json(res,200,{session,unchanged:true,revision:current.revision,transport,capabilities:state(user).capabilities,connection:connectionFor(user)});else json(res,200,state(user));return;}
      if(url.pathname==='/api/v3/events'&&req.method==='GET'){subscribe(req,res,user);return;}
      if(url.pathname==='/api/v3/integrations'&&req.method==='GET'){json(res,200,{integrations:integrationStatus,agentContract});return;}
      if(url.pathname==='/api/v3/agent'){json(res,501,{error:'Agent 接口已预留，本版本未连接外部模型',contract:agentContract});return;}
      if(url.pathname==='/api/ai/status'){json(res,200,{configured:false,model:'',reason:'V3 本地演练：Agent 接口准备中'});return;}
      if(url.pathname==='/api/v3/action'&&req.method==='POST'){
        if(!req.headers['content-type']?.startsWith('application/json')){json(res,415,{error:'需要 JSON 请求'});return;}
        const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>6*1024*1024){json(res,413,{error:'请求过长'});return;}chunks.push(chunk);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{json(res,400,{error:'JSON 格式无效'});return;}
        if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.action!=='string'||typeof input.requestId!=='string'||input.requestId.length>100||!input.requestId){json(res,400,{error:'操作参数无效'});return;}
        if(input.action!=='restore'&&bytes>(['command-intake','configure-resources'].includes(input.action)?262144:16384)){json(res,413,{error:'请求过长'});return;}
        if(!input.payload||typeof input.payload!=='object'||Array.isArray(input.payload)){json(res,400,{error:'操作内容无效'});return;}
        if(room)try{input.payload=room.authorizeAction(user,input.action,input.payload,store.data);}catch(error){json(res,403,{error:error.message});return;}
        const requestKey=room?(user.role+':'+(user.invitationId||'')+':'+input.requestId):input.requestId;
        const digest=JSON.stringify([input.action,input.payload||{},input.expectedRevision,input.session]);
        if(seen.has(requestKey)){if(seen.get(requestKey)!==digest){json(res,409,{error:'同一请求编号不能提交不同内容',...state(user)});return;}json(res,200,{duplicate:true,...state(user)});return;}
        if(input.session!==session||input.expectedRevision!==store.data.revision){json(res,409,{error:'另一网页已更新演练，请核对最新状态后重试；当前操作未执行',...state(user)});return;}
        // Calculate in isolation; an unsuccessful disk write cannot commit the operation.
        let candidate;try{const before=store.data;candidate=Exercise.create(before);candidate.action(input.action,input.payload);if(room&&user.role==='field')candidate=Exercise.create(room.tagNewRecords(before,candidate.data,user));}catch(error){json(res,422,{error:error.message});return;}
        try{persist(candidate.data);}catch(error){json(res,503,{error:'本地存档写入失败，本次操作未提交，请检查磁盘后重试'});return;}
        store=candidate;
        seen.set(requestKey,digest);if(seen.size>500)seen.delete(seen.keys().next().value);const latest=state(user);json(res,200,latest);broadcast();return;
      }
      if(url.pathname.startsWith('/api/')){json(res,404,{error:'接口不存在或请求方法不支持'});return;}
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Method not allowed');return;}
      const file=resolve(root,url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/,''));
      if(!file.startsWith(root+sep)){res.writeHead(403);res.end('Forbidden');return;}
      const content=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:content);
    }catch(error){if(!res.headersSent){res.writeHead(error.code==='ENOENT'?404:400,{'Content-Type':'text/plain; charset=utf-8'});res.end('无法处理请求');}else res.end();}
  });
  const close=server.close.bind(server);server.close=function(callback){for(const client of [...clients]){client.res.end();removeClient(client);}return close(callback);};
  return {server,get store(){return store;},session,semanticStatus:semantic.status};
}
