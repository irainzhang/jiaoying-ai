/* GitHub Pages transport: synthetic exercise data stays in this browser profile.
 * This file is loaded only by the Pages build. The localhost API is unchanged. */
(function(root){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const storageMessage='浏览器演练存储不可用，操作未确认保存。请允许本站存储，或使用普通浏览窗口重试；不要清除现有数据。';

  function createIndexedDBStorage(indexedDB,name){
    let connection=null;
    function open(){
      if(connection)return connection;
      connection=new Promise((resolve,reject)=>{
        if(!indexedDB){reject(new Error(storageMessage));return;}
        let request,settled=false;
        const timer=setTimeout(()=>fail(new Error('浏览器存储打开超时，请关闭旧版演练标签页后重试。')),5000);
        function fail(error){if(settled)return;settled=true;clearTimeout(timer);reject(error);}
        try{request=indexedDB.open(name,1);}catch(error){fail(error);return;}
        request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('exercise'))request.result.createObjectStore('exercise');};
        request.onerror=()=>fail(request.error||new Error(storageMessage));
        request.onblocked=()=>fail(new Error('演练存储被另一标签页占用，请关闭旧版标签页后重试。'));
        request.onsuccess=()=>{
          const db=request.result;if(settled){db.close();return;}settled=true;clearTimeout(timer);
          db.onversionchange=()=>{db.close();connection=null;};resolve(db);
        };
      }).catch(error=>{connection=null;throw error;});
      return connection;
    }
    return {
      async transact(update,signal){
        const db=await open();if(signal?.aborted)throw signal.reason||new Error('请求已取消');
        return new Promise((resolve,reject)=>{
          let transaction,result,failure;
          try{transaction=db.transaction('exercise','readwrite');}catch(error){reject(error);return;}
          const abort=()=>{failure=signal?.reason||new Error('请求已取消');try{transaction.abort();}catch(_){}};
          const cleanup=()=>signal?.removeEventListener('abort',abort);
          signal?.addEventListener('abort',abort,{once:true});
          transaction.oncomplete=()=>{cleanup();resolve(result);};
          transaction.onabort=()=>{cleanup();reject(failure||transaction.error||new Error(storageMessage));};
          transaction.onerror=()=>{failure=transaction.error||new Error(storageMessage);};
          const store=transaction.objectStore('exercise'),request=store.get('current');
          request.onsuccess=()=>{
            try{
              // No await is allowed here: validation, calculation and put remain
              // inside this transaction, serializing actions from multiple tabs.
              const next=update(request.result);result=next.value;
              if(next.changed)store.put(next.record,'current');
            }catch(error){failure=error;transaction.abort();}
          };
          request.onerror=()=>{failure=request.error;};
        });
      },
      async close(){if(connection){const db=await connection;db.close();connection=null;}}
    };
  }

  function createRuntime(options){
    const env=options.environment||root,Exercise=options.Exercise;
    const scope=options.scope||new URL('.',env.location.href).pathname;
    const key='jiaoying-pages-v34:'+scope;
    let indexedDB;try{indexedDB=env.indexedDB;}catch(_){}
    const storage=options.storage||createIndexedDBStorage(indexedDB,key);
    const integrations=options.integrations||{};
    const capabilities={realtimeEvents:true,villageReporting:true,version:'3.4-pages',stateRestore:true,persistentStorage:true,browserOnly:true,crossDeviceSync:false};
    const transport={preferred:'browser-storage',eventsUrl:'/api/v3/events',eventName:'state',pollIntervalMs:1200};
    const listeners=new Set(),streams=new Set();let lastError='',channel=null;
    try{if(typeof env.BroadcastChannel==='function')channel=new env.BroadcastChannel(key);}catch(_){}
    const notify=()=>{for(const callback of listeners)callback();};
    if(channel)channel.onmessage=notify;
    const storageListener=event=>{if(event.key===key+':change')notify();};
    env.addEventListener?.('storage',storageListener);
    function announce(){
      notify();try{channel?.postMessage({changed:true});}catch(_){}
      // Only an opaque notification is placed in localStorage, never exercise data.
      if(!channel)try{env.localStorage.setItem(key+':change',env.crypto.randomUUID());}catch(_){}
    }
    function initial(){const exercise=Exercise.create();exercise.action('generate');return {format:1,session:env.crypto.randomUUID(),data:exercise.data,seen:[]};}
    function check(record){
      if(!record||record.format!==1||typeof record.session!=='string'||!record.session||!record.data||!Number.isInteger(record.data.revision)||!Array.isArray(record.seen))throw new Error('已保存的演练格式无法读取；为保护记录，没有自动覆盖。');
      return record;
    }
    function snapshot(record){const data=copy(record.data);return {session:record.session,data,metrics:Exercise.metrics(data),villageLedger:Exercise.villageMetrics(data),blockedVehicles:data.activePlan?.routes.filter(route=>Exercise.blockedRoute(data,route)).map(route=>route.vehicleId)||[],integrations:integrations.integrationStatus||{},transport,capabilities};}
    async function read(signal){
      const value=await storage.transact(existing=>{const record=existing?check(existing):initial();return {record,changed:!existing,value:snapshot(record)};},signal);
      lastError='';return value;
    }
    function result(status,value){return {status,value};}
    function apply(record,input){
      const digest=JSON.stringify([input.action,input.payload||{},input.expectedRevision,input.session]);
      const previous=record.seen.find(entry=>entry[0]===input.requestId);
      if(previous)return {changed:false,...(previous[1]===digest?result(200,{duplicate:true,...snapshot(record)}):result(409,{error:'同一请求编号不能提交不同内容',...snapshot(record)}))};
      if(input.session!==record.session||input.expectedRevision!==record.data.revision)return {changed:false,...result(409,{error:'另一网页已更新演练，请核对最新状态后重试；当前操作未执行',...snapshot(record)})};
      if(!input.payload||typeof input.payload!=='object'||Array.isArray(input.payload))return {changed:false,...result(400,{error:'操作内容无效'})};
      let exercise;
      try{exercise=Exercise.create(record.data);exercise.action(input.action,input.payload);}catch(error){return {changed:false,...result(422,{error:error.message})};}
      record.data=exercise.data;record.seen.push([input.requestId,digest]);record.seen=record.seen.slice(-500);
      return {changed:true,...result(200,snapshot(record))};
    }
    async function mutate(input,signal){
      const outcome=await storage.transact(existing=>{
        const record=existing?check(existing):initial(),outcome=apply(record,input);
        return {record,changed:!existing||outcome.changed,value:outcome};
      },signal);
      lastError='';if(outcome.changed)announce();return outcome;
    }
    const response=outcome=>new (options.Response||env.Response)(JSON.stringify(outcome.value),{status:outcome.status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
    async function fetchAdapter(input,init={}){
      const url=new URL(typeof input==='string'?input:input.url,env.location.href),method=(init.method||'GET').toUpperCase();
      if(!url.pathname.startsWith('/api/'))return env.fetch(input,init);
      if(init.signal?.aborted)throw init.signal.reason||new Error('请求已取消');
      try{
        if(url.pathname==='/api/v3/state'&&method==='GET'){
          const value=await read(init.signal);
          return response(result(200,url.searchParams.get('session')===value.session&&Number(url.searchParams.get('after'))===value.data.revision?{session:value.session,unchanged:true,revision:value.data.revision,transport,capabilities}:value));
        }
        if(url.pathname==='/api/v3/integrations'&&method==='GET')return response(result(200,{integrations:integrations.integrationStatus||{},agentContract:integrations.agentContract||{connected:false}}));
        if(url.pathname==='/api/v3/agent')return response(result(501,{error:'Agent 接口已预留，GitHub 浏览器演练未连接外部模型',contract:integrations.agentContract||{connected:false}}));
        if(url.pathname==='/api/ai/status')return response(result(200,{configured:false,model:'',reason:'GitHub 浏览器演练：使用本地规则和调度算法，Agent 尚未接入'}));
        if(url.pathname==='/api/v3/action'&&method==='POST'){
          const contentType=new (options.Headers||env.Headers)(init.headers||{}).get('content-type');
          if(!contentType?.startsWith('application/json'))return response(result(415,{error:'需要 JSON 请求'}));
          if(typeof init.body!=='string'||new TextEncoder().encode(init.body).length>16384)return response(result(413,{error:'请求过长或格式无效'}));
          let value;try{value=JSON.parse(init.body);}catch(_){return response(result(400,{error:'JSON 格式无效'}));}
          if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.action!=='string'||typeof value.requestId!=='string'||!value.requestId||value.requestId.length>100)return response(result(400,{error:'操作参数无效'}));
          return response(await mutate(value,init.signal));
        }
        return response(result(404,{error:'接口不存在或请求方法不支持'}));
      }catch(error){
        if(init.signal?.aborted)throw init.signal.reason||error;
        lastError=storageMessage+' '+error.message;
        return response(result(503,{error:lastError}));
      }
    }
    class BrowserEventSource {
      static CONNECTING=0;static OPEN=1;static CLOSED=2;
      constructor(url){
        this.url=url;this.readyState=0;this.handlers=new Map();this.last='';this.reading=false;
        this.refresh=async()=>{
          if(this.readyState===2||this.reading)return;this.reading=true;
          try{
            const value=await read();if(this.readyState===2)return;this.readyState=1;
            const version=value.session+':'+value.data.revision;if(version!==this.last){this.last=version;this.emit('state',{data:JSON.stringify(value)});}
          }catch(error){lastError=storageMessage+' '+error.message;this.close();this.onerror?.({type:'error'});}
          finally{this.reading=false;}
        };
        streams.add(this);listeners.add(this.refresh);this.timer=env.setInterval(this.refresh,1200);Promise.resolve().then(this.refresh);
      }
      addEventListener(name,callback){if(!this.handlers.has(name))this.handlers.set(name,new Set());this.handlers.get(name).add(callback);}
      removeEventListener(name,callback){this.handlers.get(name)?.delete(callback);}
      emit(name,event){for(const callback of this.handlers.get(name)||[])callback(event);}
      close(){this.readyState=2;streams.delete(this);listeners.delete(this.refresh);env.clearInterval(this.timer);}
    }
    return {fetch:fetchAdapter,EventSource:BrowserEventSource,mode:'browser',scope,get lastError(){return lastError;},capabilities,
      async close(){for(const stream of [...streams])stream.close();channel?.close();env.removeEventListener?.('storage',storageListener);await storage.close?.();}
    };
  }
  const api={createRuntime,createIndexedDBStorage};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.JiaoyingPages=createRuntime({Exercise:root.JiaoyingExercise,integrations:root.JiaoyingPagesIntegrations,environment:root});
})(typeof window==='object'?window:globalThis);
