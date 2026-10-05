import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';

// One explicitly started process is one room. The room secret never enters a
// state response or a URL query, and is exchanged for an HttpOnly session cookie.
export function isPrivateAddress(value=''){
  const ip=value.replace(/^::ffff:/,'');
  if(ip==='::1')return true;
  if(isIP(ip)!==4)return false;
  const [a,b]=ip.split('.').map(Number);
  return a===127||a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);
}
const same=(a,b)=>timingSafeEqual(createHash('sha256').update(String(a||'')).digest(),createHash('sha256').update(String(b||'')).digest());
export function createRoomAccess({roomId,token,allowedHosts}){
  if(!/^[a-zA-Z0-9-]{4,40}$/.test(roomId||'')||typeof token!=='string'||token.length<32)throw new Error('房间编号或加入密钥无效');
  const hosts=new Set(['127.0.0.1','localhost','[::1]',...(allowedHosts||[])]);
  if([...hosts].some(host=>!['localhost','[::1]'].includes(host)&&!isPrivateAddress(host)))throw new Error('房间只允许回环或私有 IPv4 地址');
  const cookieName='jiaoying_room_'+roomId,cookieSecret=randomBytes(32).toString('base64url'),attempts=new Map();
  return {
    roomId,
    acceptsHost:host=>hosts.has(host),
    acceptsAddress:isPrivateAddress,
    authorized(req){
      if(req.headers['sec-fetch-site']==='cross-site')return false;
      const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='));
      return !!cookie&&same(cookie.slice(cookieName.length+1),cookieSecret);
    },
    join(req,candidate){
      const key=req.socket.remoteAddress,now=Date.now(),previous=attempts.get(key);
      if(!previous&&attempts.size>=256)attempts.delete(attempts.keys().next().value);
      const bucket=previous&&now-previous.since<60000?previous:{since:now,count:0};
      bucket.count++;attempts.set(key,bucket);
      if(attempts.size>200)for(const [ip,value] of attempts)if(now-value.since>=60000)attempts.delete(ip);
      if(bucket.count>12)return {status:429,error:'加入尝试过多，请一分钟后重试'};
      if(!same(candidate,token))return {status:401,error:'房间加入码无效，请使用本次启动器提供的完整链接'};
      return {status:200,cookie:`${cookieName}=${cookieSecret}; Path=/; HttpOnly; SameSite=Strict`};
    },
    page(){return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>加入叫应演练房间</title><style>body{font:17px/1.7 system-ui;margin:0;background:#edf5f8;color:#173e50;padding:36px 20px}main{max-width:550px;background:white;margin:auto;padding:32px;border-radius:22px;box-shadow:0 16px 45px #21495d16}small{color:#527383}input,button,a{box-sizing:border-box;font:inherit;border-radius:10px}input{width:100%;padding:13px;border:1px solid #acc6d2;margin:12px 0}button,a{border:0;padding:12px 20px;background:#008980;color:white;cursor:pointer;text-decoration:none;display:inline-block}button:disabled{opacity:.6}a.secondary{background:#e8f3f6;color:#173e50}#status{min-height:2em}#links[hidden]{display:none}h1{font-size:27px;margin:8px 0}label{display:block}</style></head><body><main><small>叫应 AI · 同 Wi-Fi 演练房间 ${roomId}</small><h1>电脑和手机，共用本场任务</h1><p>两端使用同一个房间地址。这里的数据保存在启动房间的电脑，与 GitHub 网页演练分别保存。</p><form id="join"><label for="key">房间加入码</label><input id="key" type="password" autocomplete="off" placeholder="使用终端完整链接会自动填入" required><button id="submit">加入房间</button></form><p id="status" role="status" aria-live="polite"></p><div id="links" hidden><a href="/#command">打开指挥台</a> <a class="secondary" href="/#field">打开现场端</a></div><p><small>手机在 HTTP 局域网页面可能无法使用浏览器麦克风识别，可使用系统键盘的语音听写。登记结果仍实时同步。房间链接只分享给同 Wi-Fi 演练人员；不需要开启公网或修改防火墙。</small></p></main><script>
const key=document.getElementById('key'),form=document.getElementById('join'),status=document.getElementById('status'),submit=document.getElementById('submit');
try{key.value=decodeURIComponent(location.hash.slice(1));}catch(_){status.textContent='加入链接格式有误，可在下方粘贴正确加入码。';}history.replaceState(null,'','/join');
form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;status.textContent='正在加入…';try{const response=await fetch('/api/v3/room/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:key.value})});const result=await response.json();if(!response.ok)throw new Error(result.error||'加入失败');key.value='';form.hidden=true;document.getElementById('links').hidden=false;status.textContent='已加入房间，选择本设备要使用的页面。';}catch(error){status.textContent=error.message;}finally{submit.disabled=false;}});
</script></body></html>`;}
  };
}
