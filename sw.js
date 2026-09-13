const C='kotomatika-admin-shell-v4';
const S=['./','./index.html','./styles.css?v=1','./app.js?v=4','./manifest.webmanifest','./styles-status-v4.css?v=4'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(S)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.hostname.includes('functions.yandexcloud.net')||e.request.method!=='GET') return;
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});