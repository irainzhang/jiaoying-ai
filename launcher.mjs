import {spawn} from 'node:child_process';
import {mkdirSync,openSync,closeSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.JIAOYING_PORT||8767);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('JIAOYING_PORT must be 1024..65535');
if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22 or newer is required');
const base=`http://127.0.0.1:${port}`;
async function probe(){try{const r=await fetch(base+'/api/v3/state',{signal:AbortSignal.timeout(600)});if(!r.ok)return 'occupied';const body=await r.json();return body.data?.schema==='jiaoying-v3'&&body.capabilities?.realtimeEvents===true&&body.capabilities?.villageReporting===true?'ready':'occupied';}catch(e){return e.cause?.code==='ECONNREFUSED'?'absent':'occupied';}}
let status=await probe();
if(status==='occupied')throw new Error(`Port ${port} is occupied or unavailable. Check the existing service, or choose JIAOYING_PORT.`);
if(status==='absent'){
  const dir=join(root,'tmp');mkdirSync(dir,{recursive:true});const fd=openSync(join(dir,'local-server.log'),'a');
  const child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',fd,fd]});
  let failed=false;child.on('error',()=>{failed=true;});child.unref();closeSync(fd);
  for(let attempt=0;attempt<40&&!failed;attempt++){await new Promise(r=>setTimeout(r,150));status=await probe();if(status==='ready')break;}
  if(status!=='ready')throw new Error('Local server did not start. See tmp/local-server.log.');
}
console.log('Local command page: '+base+'/#command');
console.log('Local field page:   '+base+'/#field');
if(!process.argv.includes('--no-open')){
  for(const view of ['command','field']){
    const child=spawn('cmd.exe',['/d','/c','start','',base+'/#'+view],{windowsHide:true,stdio:'ignore'});
    child.on('error',error=>console.error('Open this URL manually: '+base+'/#'+view+' ('+error.message+')'));child.unref();
  }
}
