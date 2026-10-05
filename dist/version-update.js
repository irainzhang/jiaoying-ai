/* Optional update notice. Never clears browser records or reloads without a click. */
(function () {
  'use strict';
  try {
    if (!window.JiaoyingCapabilities || !document.currentScript || !navigator.serviceWorker ||
        !/^https?:$/.test(location.protocol)) return;
    var root = new URL('./', document.currentScript.src), sw = navigator.serviceWorker;
    var workerURL = new URL('guardian-offline-sw.js?v=1', root);
    var manifestURL = new URL('guardian-cache-manifest.json', root);
    var current = window.JiaoyingCapabilities.version, target, registration, busy = false;
    var banner, label, refresh, readyBuild = '', checkedAt = 0;
    function isNewer(value) {
      if (!/^\d+\.\d+\.\d+$/.test(value || '') || !/^\d+\.\d+\.\d+$/.test(current || '')) return false;
      var a = value.split('.').map(Number), b = current.split('.').map(Number);
      for (var i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
      return false;
    }
    function ownWorker(worker) {
      return worker && worker.scriptURL && new URL(worker.scriptURL).pathname === workerURL.pathname;
    }
    function ask(worker) {
      if (ownWorker(worker)) worker.postMessage({ type: 'GUARDIAN_CACHE_STATUS' });
    }
    function askAll() {
      ask(sw.controller);
      if (registration) [registration.active, registration.waiting, registration.installing].forEach(ask);
    }
    function show(ready) {
      if (!target) return;
      if (!banner) {
        banner = document.createElement('aside');
        banner.id = 'version-update-notice';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');
        banner.style.cssText = 'position:sticky;top:0;z-index:1500;display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;padding:12px 20px;background:#e1f5f1;color:#12474d;border-bottom:2px solid #119c91;font:14px/1.6 system-ui,sans-serif';
        label = document.createElement('span');
        refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.style.cssText = 'padding:8px 16px;border:0;border-radius:9px;background:#07887f;color:white;font:600 14px system-ui,sans-serif;cursor:pointer';
        refresh.addEventListener('click', function () {
          if (!target || readyBuild !== target.build || refresh.disabled) return;
          // The workspace already persists submitted records; no storage operation is needed here.
          location.reload();
        });
        banner.appendChild(label); banner.appendChild(refresh);
        document.body.insertBefore(banner, document.body.firstChild);
      }
      label.textContent = ready
        ? '新版 V' + target.version + ' 已下载。已提交的演练记录保留；未提交内容请先保存。'
        : '发现新版 V' + target.version + '，正在完整下载；可继续当前操作。';
      refresh.textContent = ready ? '刷新更新' : '正在准备更新…';
      refresh.disabled = !ready;
      refresh.style.opacity = ready ? '1' : '.6';
    }
    sw.addEventListener('message', function (event) {
      var data = event.data;
      if (!target || !data || data.type !== 'GUARDIAN_CACHE_STATUS' ||
          event.source !== sw.controller || !ownWorker(event.source)) return;
      // Installing or old workers must not make a refresh button prematurely usable.
      var ready = data.ready === true && data.build === target.build && data.version === target.version;
      readyBuild = ready ? data.build : '';
      show(ready);
    });
    sw.addEventListener('controllerchange', function () { readyBuild = ''; if (target) show(false); askAll(); });
    async function check() {
      if (busy) return;
      busy = true; checkedAt = Date.now();
      try {
        // This path bypasses every shipped service worker; release.json does not.
        var response = await fetch(manifestURL.href, { cache: 'no-store' });
        if (!response.ok) return;
        var manifest = await response.json();
        if (!isNewer(manifest.version) || !/^[a-f0-9]{20}$/.test(manifest.build || '')) return;
        if (!target || target.build !== manifest.build) { target = manifest; readyBuild = ''; show(false); }
        var existing = await sw.getRegistration(root.href);
        var other = existing && (existing.active || existing.waiting || existing.installing);
        if (other && !ownWorker(other)) return;
        registration = await sw.register(workerURL.href, { scope: root.href, updateViaCache: 'none' });
        registration.addEventListener('updatefound', function () {
          var installing = registration.installing;
          if (installing) installing.addEventListener('statechange', askAll);
          askAll();
        });
        await registration.update();
        askAll();
      } catch (_) { /* Offline / unsupported update checks cannot interrupt work. */ }
      finally { busy = false; }
    }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && Date.now() - checkedAt > 60000) check();
    });
    window.addEventListener('online', check);
    check();
  } catch (_) { /* This optional UI must not affect the workspace. */ }
})();
