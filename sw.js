const CACHE='ridecast-v21';
self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/','/index.html','/manifest.webmanifest','/icons/favicon.svg?v=18'])));
});
self.addEventListener('activate',event=>event.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('ridecast-')&&key!==CACHE).map(key=>caches.delete(key))))
])));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin || (url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/api/city-')))return;
  event.respondWith(fetch(request).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)));}
    return response;
  }).catch(async()=>{
    const cached=await caches.match(request);
    if(cached)return cached;
    if(request.mode==='navigate')return (await caches.match('/'))||Response.error();
    return Response.error();
  }));
});
self.addEventListener('push',event=>{
  let payload;
  try{payload=event.data.json()}catch{payload={title:'RideCast',body:'گزارش تازهٔ آب‌وهوا آماده است.'}}
  event.waitUntil(self.registration.showNotification(payload.title||'RideCast',{
    body:payload.body||'',tag:payload.tag||'ridecast-daily',renotify:false,
    lang:'fa',dir:'rtl',data:{url:'/',kind:payload.kind||'daily'}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    const existing=windows.find(client=>new URL(client.url).origin===self.location.origin);
    if(existing){await existing.focus();return;}
    return self.clients.openWindow('/');
  }));
});
