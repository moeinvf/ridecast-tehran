import { createHmac, timingSafeEqual, createHash } from 'node:crypto';

export const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
export function nextOccurrence(time, timezone, now = Date.now()) {
  if (!CLOCK.test(time)) throw new Error('Invalid notification time');
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const start = Math.floor(now / 60000) * 60000 + 60000;
  // Looking up local clock minutes handles timezone offsets and daylight-saving transitions.
  for (let i = 0; i < 60 * 49; i++) {
    const candidate = start + i * 60000;
    if (formatter.format(new Date(candidate)) === time) return candidate;
  }
  throw new Error('No matching local time');
}

export function validateSettings(input) {
  if (!input || !CLOCK.test(input.time || '')) throw new Error('ساعت اعلان معتبر نیست.');
  const city = input.city;
  if (!city || typeof city.name !== 'string' || !city.name.trim() || city.name.length > 100 || !Number.isFinite(city.latitude) || !Number.isFinite(city.longitude) || Math.abs(city.latitude) > 90 || Math.abs(city.longitude) > 180) throw new Error('شهر معتبر نیست.');
  new Intl.DateTimeFormat('en', { timeZone: city.timezone }).format();
  if (!city.timezone || city.timezone === 'auto') throw new Error('منطقهٔ زمانی شهر مشخص نیست.');
  const routes = Array.isArray(input.routes) ? input.routes.filter(r => CLOCK.test(r.go || '')).slice(0, 50).map(r => ({
    from: String(r.from || '').slice(0, 40), to: String(r.to || '').slice(0, 40), go: r.go, back: CLOCK.test(r.back || '') ? r.back : ''
  })) : [];
  return { time: input.time, city: { name: city.name.trim(), latitude: city.latitude, longitude: city.longitude, timezone: city.timezone }, routes };
}

export function validateSubscription(s) {
  let url;
  try { url = new URL(s?.endpoint); } catch { throw new Error('اشتراک اعلان معتبر نیست.'); }
  const hosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !(hosts.includes(url.hostname) || url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com')) || url.href.length > 2000) throw new Error('سرویس اعلان پشتیبانی نمی‌شود.');
  const keys = s.keys || {};
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(keys.p256dh || '') || !/^[A-Za-z0-9_-]+={0,2}$/.test(keys.auth || '') || Buffer.from(keys.p256dh, 'base64url').length !== 65 || Buffer.from(keys.auth, 'base64url').length !== 16) throw new Error('کلید اعلان معتبر نیست.');
  return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export function signToken(data) {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = createHmac('sha256', process.env.NOTIFICATION_SIGNING_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}
export function verifyToken(token) {
  if (typeof token !== 'string' || token.length > 3000) throw new Error('Invalid token');
  const [body, signature] = token.split('.');
  const expected = createHmac('sha256', process.env.NOTIFICATION_SIGNING_SECRET).update(body || '').digest();
  const provided = Buffer.from(signature || '', 'base64url');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) throw new Error('Invalid token');
  const data = JSON.parse(Buffer.from(body, 'base64url'));
  if (!data.runId || !data.device) throw new Error('Invalid schedule');
  return data;
}
export const deviceHash = subscription => createHash('sha256').update(subscription.endpoint).digest('hex');
export const riskOf = (prob, rain, wind, gust) => {
  let score = prob >= 70 ? 3 : prob >= 40 ? 2 : prob >= 20 ? 1 : 0;
  score += rain >= 2 ? 3 : rain >= .6 ? 2 : rain > 0 ? 1 : 0;
  score += gust >= 55 ? 3 : gust >= 40 ? 2 : gust >= 30 ? 1 : 0;
  score += wind >= 35 ? 2 : wind >= 25 ? 1 : 0;
  return score >= 5 ? 'bad' : score >= 2 ? 'warn' : 'good';
};
const fa = n => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);
const verdict = r => r === 'bad' ? 'بهتره موتور نبری' : r === 'warn' ? 'با احتیاط برو' : 'شرایط برای موتور خوبه';
export function buildDigest(data, settings, dueAt) {
  const h = data.hourly;
  if (!h?.time?.length) throw new Error('Weather data unavailable');
  const now = dueAt / 1000;
  const start = Math.max(0, h.time.findIndex(t => t >= now));
  const rows = h.time.slice(start, start + 24).map((t, n) => {
    const i = start + n;
    return { t, temp: h.temperature_2m[i], prob: h.precipitation_probability[i] || 0, wind: h.wind_speed_10m[i] || 0, risk: riskOf(h.precipitation_probability[i] || 0, h.precipitation[i] || 0, h.wind_speed_10m[i] || 0, h.wind_gusts_10m[i] || 0) };
  });
  const bad = rows.filter(r => r.risk === 'bad').length, warn = rows.filter(r => r.risk === 'warn').length;
  const overall = bad >= 2 ? 'bad' : bad || warn >= 4 ? 'warn' : 'good';
  let body = `${verdict(overall)}؛ دما ${fa(Math.min(...rows.map(r => r.temp)))} تا ${fa(Math.max(...rows.map(r => r.temp)))} درجه، احتمال بارش تا ${fa(Math.max(...rows.map(r => r.prob)))}٪.`;
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: settings.city.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (const route of settings.routes.slice(0, 2)) {
    const target = nextOccurrence(route.go, settings.city.timezone, dueAt - 60000) / 1000;
    const row = rows.reduce((a, b) => Math.abs(b.t - target) < Math.abs(a.t - target) ? b : a, rows[0]);
    body += ` ${route.from || 'مبدأ'} ← ${route.to || 'مقصد'}، رفت ${route.go.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d])}: ${verdict(row.risk)}.`;
    if (route.back) {
      const backTarget = nextOccurrence(route.back, settings.city.timezone, dueAt - 60000) / 1000;
      const back = rows.reduce((a,b) => Math.abs(b.t-backTarget)<Math.abs(a.t-backTarget)?b:a, rows[0]);
      body += ` برگشت: ${verdict(back.risk)}.`;
    }
  }
  if (settings.routes.length > 2) body += ' جزئیات بقیهٔ مسیرها را در اپ ببین.';
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: settings.city.timezone }).format(new Date(dueAt));
  return { title: `RideCast · گزارش روزانهٔ ${settings.city.name}`, body: body.slice(0, 900), tag: `ridecast-daily-${date}`, url: '/', kind: 'daily' };
}
