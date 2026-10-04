import express from 'express';
import { start, getRun, getHookByToken, resumeHook } from 'workflow/api';
import { HookNotFoundError } from 'workflow/errors';
import { dailyNotification } from '../workflows/daily-notification.mjs';
import { validateSettings, validateSubscription, signToken, verifyToken, deviceHash, nextOccurrence } from './notification-utils.mjs';
import { resolveCityImage, fetchCityPhoto } from './city-images.mjs';

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'20kb'}));
const ready=()=>Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.NOTIFICATION_SIGNING_SECRET);
app.get('/api/notifications/config',(_req,res)=>res.set('Cache-Control','no-store').json({ready:ready(),publicKey:ready()?process.env.VAPID_PUBLIC_KEY:null}));
const tokenOf=req=>req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):null;
function sameOrigin(req,res,next) {
  const origin=req.headers.origin;
  if(!origin || new URL(origin).host!==req.headers.host)return res.status(403).json({error:'درخواست از این سایت مجاز نیست.'});
  if(!ready())return res.status(503).json({error:'سرویس اعلان روزانه آماده نیست.'});
  next();
}
async function lookup(device) {
  try{return await getHookByToken(`ridecast-daily:${device}`)}
  catch(error){if(HookNotFoundError.is(error))return null;throw error}
}
app.post('/api/notifications/schedule',sameOrigin,async(req,res)=>{
  res.set('Cache-Control','no-store');
  try {
    const token=tokenOf(req);
    let previous=null;
    if(token){try{previous=verifyToken(token)}catch{return res.status(401).json({error:'مجوز تنظیم اعلان معتبر نیست؛ اعلان را دوباره فعال کن.'})}}
    if(req.body.enabled===false) {
      if(previous){const hook=await lookup(previous.device);if(hook)await getRun(hook.runId).cancel({cancelReason:'Disabled by device owner'});}
      return res.json({enabled:false});
    }
    let settings,subscription;
    try{settings=validateSettings(req.body.settings);subscription=validateSubscription(req.body.subscription)}
    catch(error){return res.status(400).json({error:error.message})}
    const device=deviceHash(subscription);
    if(previous && previous.device!==device){
      const old=await lookup(previous.device);
      if(old)await getRun(old.runId).cancel({cancelReason:'Push subscription replaced'});
    }
    let hook=await lookup(device);
    if(!hook){
      await start(dailyNotification,[device,subscription,settings]);
      for(let attempt=0;attempt<24 && !hook;attempt++){
        await new Promise(resolve=>setTimeout(resolve,250));
        hook=await lookup(device);
      }
      if(!hook)throw new Error('schedule-starting');
    }
    await resumeHook(`ridecast-daily:${device}`,{enabled:true,settings,subscription});
    return res.json({enabled:true,token:signToken({device,runId:hook.runId}),nextAt:nextOccurrence(settings.time,settings.city.timezone)});
  }catch(error){
    console.error('Notification schedule failed:',error.name,error.message?.slice(0,160));
    return res.status(503).json({error:'ذخیرهٔ زمان‌بندی انجام نشد؛ دوباره تلاش کن.'});
  }
});
app.post('/api/notifications/status',sameOrigin,async(req,res)=>{
  res.set('Cache-Control','no-store');
  try {
    const owner=verifyToken(tokenOf(req));
    const hook=await lookup(owner.device);
    return res.json({active:Boolean(hook),status:hook?await getRun(hook.runId).status:'stopped'});
  }catch{return res.status(400).json({active:false})}
});

const imageCache=new Map();
function parseCity(req) {
  const city={name:String(req.query.name||'').slice(0,100),latitude:Number(req.query.lat),longitude:Number(req.query.lon)};
  if(!city.name || !Number.isFinite(city.latitude) || !Number.isFinite(city.longitude) || Math.abs(city.latitude)>90 || Math.abs(city.longitude)>180)throw new Error('Invalid city');
  return city;
}
async function imageFor(city) {
  const key=`${city.latitude.toFixed(3)},${city.longitude.toFixed(3)}`;
  const cached=imageCache.get(key);
  if(cached && Date.now()-cached.at<86400000)return cached.data;
  const data=await resolveCityImage(city);
  if(imageCache.size>100)imageCache.delete(imageCache.keys().next().value);
  imageCache.set(key,{at:Date.now(),data});
  return data;
}
app.get('/api/city-image',async(req,res)=>{
  try {
    const city=parseCity(req),data=await imageFor(city);
    const query=new URLSearchParams({name:city.name,lat:String(city.latitude),lon:String(city.longitude)});
    res.set('Cache-Control','public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800').json({src:`/api/city-photo?${query}`,label:data.label,source:data.source});
  }catch{return res.status(404).set('Cache-Control','no-store').json({error:'تصویر شهر فعلاً در دسترس نیست.'})}
});
app.get('/api/city-photo',async(req,res)=>{
  try {
    const data=await imageFor(parseCity(req));
    const photo=await fetchCityPhoto(data.image);
    res.set({'Content-Type':photo.type,'Cache-Control':'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800','X-Content-Type-Options':'nosniff'}).send(photo.bytes);
  }catch{return res.status(404).set('Cache-Control','no-store').end()}
});
export default app;
