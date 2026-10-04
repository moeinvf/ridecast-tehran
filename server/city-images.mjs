const USER_AGENT = 'RideCast/1.0 (https://ridecast-ir.vercel.app/; city landmark photos)';
export const LANDMARKS = [
  { latitude:35.6892, longitude:51.3890, title:'Azadi Tower', label:'برج آزادی · تهران' },
  { latitude:36.2605, longitude:59.6168, title:'Imam Reza shrine', label:'حرم امام رضا · مشهد' },
  { latitude:32.6546, longitude:51.6680, title:'Si-o-se-pol', label:'سی‌وسه‌پل · اصفهان' },
  { latitude:29.5918, longitude:52.5837, title:'Tomb of Hafez', label:'حافظیه · شیراز' },
  { latitude:38.0800, longitude:46.2919, title:'El Gölü', label:'ائل‌گلی · تبریز' },
  { latitude:37.2808, longitude:49.5832, title:'Rasht Municipality Building', label:'میدان شهرداری · رشت' },
  { latitude:35.8400, longitude:50.9391, title:'Pearl Palace', label:'کاخ مروارید · کرج' },
  { latitude:31.8974, longitude:54.3569, title:'Amir Chakhmaq Complex', label:'میدان امیرچخماق · یزد' },
  { latitude:30.2839, longitude:57.0834, title:'Ganjali Khan Complex', label:'مجموعهٔ گنجعلی‌خان · کرمان' },
  { latitude:34.3142, longitude:47.0650, title:'Taq-e Bostan', label:'طاق‌بستان · کرمانشاه' },
  { latitude:34.7992, longitude:48.5146, title:'Avicenna Mausoleum', label:'آرامگاه بوعلی‌سینا · همدان' },
  { latitude:38.2498, longitude:48.2933, title:'Sheikh Safi al-Din Khānegāh and Shrine Ensemble', label:'بقعهٔ شیخ صفی · اردبیل' },
  { latitude:33.4878, longitude:48.3558, title:'Falak-ol-Aflak', label:'قلعهٔ فلک‌الافلاک · خرم‌آباد' },
  { latitude:31.3183, longitude:48.6706, title:'White Bridge (Ahvaz)', label:'پل سفید · اهواز' },
  { latitude:34.6416, longitude:50.8746, title:'Fatima Masumeh Shrine', label:'حرم حضرت معصومه · قم' },
  { latitude:36.2694, longitude:50.0049, title:'Chehel Sotoun, Qazvin', label:'کاخ چهل‌ستون · قزوین' },
  { latitude:27.1832, longitude:56.2666, title:'Hindu Temple, Bandar Abbas', label:'معبد هندوها · بندرعباس' },
  { latitude:33.9850, longitude:51.4100, title:'Fin Garden', label:'باغ فین · کاشان' }
];
export function distance(a,b) {
  const rad=Math.PI/180, dlat=(a.latitude-b.latitude)*rad, dlon=(a.longitude-b.longitude)*rad;
  const x=Math.sin(dlat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dlon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
async function json(url) {
  const response=await fetch(url,{headers:{'User-Agent':USER_AGENT,'Accept':'application/json'},signal:AbortSignal.timeout(9000)});
  if(!response.ok) throw new Error('Image source unavailable');
  return response.json();
}
function summaryImage(summary) {
  const image=summary.thumbnail?.source || summary.originalimage?.source;
  return image && image.includes('upload.wikimedia.org/') ? image.replace(/\/\d+px-/, '/960px-') : null;
}
export async function resolveCityImage(city) {
  const landmark=LANDMARKS.find(item=>distance(item,city)<18);
  if(landmark) {
    try {
      const data=await json(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(landmark.title)}`);
      const image=summaryImage(data);
      if(image) return {image,label:landmark.label,source:data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(landmark.title)}`};
    } catch {}
  }
  // For any searched city, prefer its geographically verified article, then nearby landmarks.
  for(const lang of ['fa','en']) {
    try {
      const params=new URLSearchParams({action:'query',format:'json',formatversion:'2',generator:'geosearch',ggscoord:`${city.latitude}|${city.longitude}`,ggsradius:'10000',ggslimit:'20',prop:'pageimages|coordinates|info',piprop:'thumbnail',pithumbsize:'960',inprop:'url'});
      const data=await json(`https://${lang}.wikipedia.org/w/api.php?${params}`);
      const pages=(data.query?.pages||[]).filter(p=>p.thumbnail?.source && !/\.svg/i.test(p.thumbnail.source));
      const score=p=> (p.title===city.name?100:0)+(/برج|کاخ|میدان|آرامگاه|حافظ|مسجد|قلعه|tower|palace|square|shrine|bridge|castle|mausoleum/i.test(p.title)?50:0)+(/airport|university|station|فرودگاه|دانشگاه|ایستگاه/.test(p.title)?-60:0);
      pages.sort((a,b)=>score(b)-score(a));
      if(pages.length) return {image:pages[0].thumbnail.source,label:pages[0].title,source:pages[0].fullurl};
    } catch {}
  }
  throw new Error('No city image found');
}
export async function fetchCityPhoto(url) {
  const parsed=new URL(url);
  if(parsed.protocol!=='https:' || parsed.hostname!=='upload.wikimedia.org')throw new Error('Invalid photo host');
  const response=await fetch(parsed,{headers:{'User-Agent':USER_AGENT},signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!response.ok || !/^image\/(jpeg|png|webp|avif)/.test(response.headers.get('content-type')||''))throw new Error('Photo unavailable');
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>8000000)throw new Error('Photo too large');
  return {bytes,type:response.headers.get('content-type')};
}
