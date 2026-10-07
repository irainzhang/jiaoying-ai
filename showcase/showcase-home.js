/* Public presentation: no task data is read, copied, cleared or submitted here. */
(function(){
  'use strict';
  var script=document.currentScript,version=window.JiaoyingCapabilities.version;
  document.querySelectorAll('[data-version]').forEach(function(el){el.textContent='展示版 V'+version;});
  var status=document.getElementById('showcase-update-status');
  function say(text){if(status)status.textContent=text;}
  say('固定分享入口 · 更新后沿用此链接');
  if(!script||!navigator.serviceWorker||!/^https?:$/.test(location.protocol))return;
  var root=new URL('./',script.src),workerURL=new URL('guardian-offline-sw.js?v=1',root),sw=navigator.serviceWorker;
  function own(worker){return worker&&worker.scriptURL&&new URL(worker.scriptURL).pathname===workerURL.pathname;}
  function ask(reg){[sw.controller,reg.active,reg.waiting,reg.installing].forEach(function(worker){if(own(worker))worker.postMessage({type:'GUARDIAN_CACHE_STATUS'});});}
  sw.addEventListener('message',function(event){var data=event.data;if(event.source!==sw.controller||!own(event.source)||!data||data.type!=='GUARDIAN_CACHE_STATUS')return;if(data.ready&&data.version===version)say('展示资源已就绪 · 固定链接持续更新');});
  sw.getRegistration(root.href).then(function(existing){
    if(existing&&existing.scope===root.href){var current=existing.active||existing.waiting||existing.installing;if(current&&!own(current))throw Error('Different service worker');}
    return sw.register(workerURL.href,{scope:root.href,updateViaCache:'none'});
  }).then(function(reg){
    function watch(){var installing=reg.installing;if(installing)installing.addEventListener('statechange',function(){ask(reg);});ask(reg);}
    reg.addEventListener('updatefound',watch);sw.addEventListener('controllerchange',watch);watch();return reg.update();
  }).catch(function(){say('可继续在线浏览 · 更新入口始终保留');});
})();
