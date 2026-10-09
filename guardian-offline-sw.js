/* Generated manifest contains only this site's public static assets. Never cache APIs or model requests. */
'use strict';
const BUILD='88d5b5ff951ba7101ae6';
const CACHE_NAME='jiaoying-guardian-'+BUILD;
const PREFIX='jiaoying-guardian-';
const ROOT=new URL('./',self.location.href);
const MANIFEST=new URL('guardian-cache-manifest.json',ROOT).href;
let readyPromise;
const localURL=path=>new URL(path,ROOT).href;
function validPath(path){return typeof path==='string'&&!path.startsWith('/')&&!path.includes('..')&&!/[?#\\]/.test(path)&&new URL(path,ROOT).origin===ROOT.origin;}
async function cachedManifest(){const cache=await caches.open(CACHE_NAME),response=await cache.match(MANIFEST);if(!response)return null;return response.json();}
async function statusMessage(ready,message){const manifest=await cachedManifest();return {type:'GUARDIAN_CACHE_STATUS',ready,build:BUILD,version:manifest?.version||null,message};}
async function cacheReady(){if(!readyPromise)readyPromise=(async()=>{const manifest=await cachedManifest();if(!manifest?.files?.length)return false;const cache=await caches.open(CACHE_NAME);return (await Promise.all(manifest.files.map(path=>cache.match(localURL(path))))).every(Boolean);})();return readyPromise;}
async function broadcast(message){const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});clients.forEach(client=>client.postMessage(Object.assign({type:'GUARDIAN_CACHE_STATUS'},message)));}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const response=await fetch(MANIFEST,{cache:'no-store'});if(!response.ok)throw new Error('Offline manifest unavailable');
  const manifest=await response.json();if(manifest.build!==BUILD||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>500||!manifest.files.every(validPath))throw new Error('Invalid offline manifest');
  const cache=await caches.open(CACHE_NAME);let completed=0;
  // Small batches keep installation responsive without reporting success on partial downloads.
  for(let i=0;i<manifest.files.length;i+=6){await Promise.all(manifest.files.slice(i,i+6).map(async path=>{const url=localURL(path),asset=await fetch(url,{cache:'reload'});if(!asset.ok||asset.type==='opaque'||(asset.url&&new URL(asset.url).origin!==ROOT.origin))throw new Error('Offline asset unavailable: '+path);await cache.put(url,asset);completed++;}));await broadcast({ready:false,build:BUILD,version:manifest.version||null,message:'正在准备 V'+(manifest.version||'未知')+' 离线文件 '+completed+'/'+manifest.files.length});}
  await cache.put(MANIFEST,new Response(JSON.stringify(manifest),{headers:{'Content-Type':'application/json'}}));readyPromise=null;
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{if(!await cacheReady())return;await self.clients.claim();await broadcast(await statusMessage(true,'离线文件已就绪；首次打开面板后可断网刷新。在线 API 仍需网络。'));
  // Retain one preceding build so already-open tabs are not deprived of their cached assets.
  const keys=(await caches.keys()).filter(key=>key.startsWith(PREFIX)&&key!==CACHE_NAME);for(const key of keys.slice(0,-1))await caches.delete(key);
})()));
self.addEventListener('message',event=>{if(event.data?.type!=='GUARDIAN_CACHE_STATUS')return;event.waitUntil((async()=>{const ready=await cacheReady();event.source?.postMessage(await statusMessage(ready,ready?'离线文件已就绪；可断网刷新。在线 API 仍需网络。':'离线文件尚未完整缓存，请保持联网。'));})());});
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==ROOT.origin||!url.pathname.startsWith(ROOT.pathname))return;
  const relative=url.pathname.slice(ROOT.pathname.length);if(relative==='join'||relative.startsWith('join/')||relative.startsWith('api/')||relative==='guardian-cache-manifest.json'||relative==='guardian-offline-sw.js')return;
  event.respondWith((async()=>{const key=localURL(relative===''?'index.html':relative),cache=await caches.open(CACHE_NAME),match=await cache.match(key);if(match)return match;return fetch(request);})());
});
