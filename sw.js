const CACHE='ridecast-v26';
const SETTINGS_CACHE='ridecast-bg-settings-v1';
const SETTINGS_KEY='/__ridecast_bg_settings__';

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll([
    './','./index.html','./manifest.webmanifest?v=25',
    '/icons/icon-192.png?v=25','/icons/icon-512.png?v=25'
  ])));
});

self.addEventListener('activate',e=>e.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k!==SETTINGS_CACHE).map(k=>caches.delete(k))))
])));

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>caches.match(e.request)));
});

async function readSettings(){
  try{
    const c=await caches.open(SETTINGS_CACHE),r=await c.match(SETTINGS_KEY);
    return r?await r.json():null;
  }catch{return null}
}
async function writeSettings(value){
  const c=await caches.open(SETTINGS_CACHE);
  await c.put(SETTINGS_KEY,new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}}));
}
function riskOf(prob=0,precip=0,wind=0,gust=0){
  if(prob>=65||precip>=1.2||wind>=35||gust>=50)return 'bad';
  if(prob>=35||precip>=.3||wind>=24||gust>=34)return 'warn';
  return 'good';
}
function rank(r){return r==='bad'?2:r==='warn'?1:0}
function zoneNow(timeZone){
  try{
    const parts=new Intl.DateTimeFormat('en-CA',{
      timeZone:timeZone&&timeZone!=='auto'?timeZone:'UTC',
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
    }).formatToParts(new Date()).reduce((a,p)=>(a[p.type]=p.value,a),{});
    return {date:`${parts.year}-${parts.month}-${parts.day}`,clock:`${parts.hour}:${parts.minute}`};
  }catch{
    const d=new Date();
    return {date:d.toISOString().slice(0,10),clock:d.toISOString().slice(11,16)};
  }
}
async function showRideNotification(title,body,tag){
  await self.registration.showNotification(title,{
    body,tag,renotify:true,
    icon:'/icons/icon-192.png?v=25',
    badge:'/icons/icon-192.png?v=25',
    data:{url:'./'}
  });
}
async function backgroundWeatherCheck(){
  const s=await readSettings();
  if(!s?.city||(!s.eventOn&&!s.dailyOn)||Notification.permission==='denied')return;
  try{
    const c=s.city;
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(c.latitude)}&longitude=${encodeURIComponent(c.longitude)}&current=temperature_2m,precipitation,rain,showers,weather_code,wind_speed_10m,wind_gusts_10m&hourly=precipitation_probability&forecast_hours=1&timezone=${encodeURIComponent(c.timezone||'auto')}`;
    const res=await fetch(url,{cache:'no-store'});if(!res.ok)return;
    const data=await res.json(),cur=data.current||{};
    const precip=(cur.precipitation??0)+(cur.rain??0)+(cur.showers??0);
    const prob=data.hourly?.precipitation_probability?.[0]??0;
    const risk=riskOf(prob,precip,cur.wind_speed_10m??0,cur.wind_gusts_10m??0);

    if(s.eventOn&&s.lastRisk&&rank(risk)>rank(s.lastRisk)){
      await showRideNotification(
        `🏍️ وضعیت ${c.name} بدتر شد`,
        risk==='bad'?'شرایط برای موتورسواری پرریسک شده.':'شرایط نیاز به احتیاط بیشتری دارد.',
        'ridecast-weather-'+c.id
      );
    }
    s.lastRisk=risk;

    const now=zoneNow(c.timezone),target=s.dailyTime||'08:00';
    if(s.dailyOn&&now.clock>=target&&s.lastDailyDate!==now.date){
      const body=risk==='bad'?'امروز ریسک موتورسواری بالاست.':risk==='warn'?'امروز با احتیاط موتورسواری کن.':'امروز شرایط موتورسواری مناسب است.';
      await showRideNotification('🏍️ وضعیت امروز '+c.name,body,'ridecast-daily-'+c.id);
      s.lastDailyDate=now.date;
    }
    await writeSettings(s);
  }catch(e){}
}

self.addEventListener('message',e=>{
  if(e.data?.type==='RIDECAST_BG_SETTINGS'){
    e.waitUntil((async()=>{
      const old=await readSettings(),incoming=e.data.settings||{};
      const sameCity=old?.city?.id&&old.city.id===incoming?.city?.id;
      const merged={
        ...old,...incoming,
        lastRisk:sameCity?(old?.lastRisk||null):null,
        lastDailyDate:sameCity?(old?.lastDailyDate||null):null
      };
      await writeSettings(merged);
      if(e.ports?.[0])e.ports[0].postMessage({lastRisk:merged.lastRisk,lastDailyDate:merged.lastDailyDate});
    })());
  }
  if(e.data?.type==='RIDECAST_CHECK_NOW')e.waitUntil(backgroundWeatherCheck());
});

self.addEventListener('periodicsync',e=>{
  if(e.tag==='ridecast-weather-check')e.waitUntil(backgroundWeatherCheck());
});
self.addEventListener('sync',e=>{
  if(e.tag==='ridecast-weather-check-once')e.waitUntil(backgroundWeatherCheck());
});
self.addEventListener('push',e=>{
  let data={};
  try{data=e.data?e.data.json():{}}catch{data={body:e.data?.text?.()||''}}
  e.waitUntil(showRideNotification(data.title||'RideCast',data.body||'وضعیت جدید هوا آماده است.',data.tag||'ridecast-push'));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list){if('focus'in c)return c.focus()}
    return clients.openWindow(e.notification.data?.url||'./');
  }));
});