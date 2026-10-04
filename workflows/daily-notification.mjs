import { sleep, createHook } from 'workflow';
import webpush from 'web-push';
import { nextOccurrence, buildDigest } from '../server/notification-utils.mjs';

export async function dailyNotification(device, subscription, settings) {
  'use workflow';
  const changes = createHook({ token: `ridecast-daily:${device}` });
  const conflict = await changes.getConflict();
  if (conflict) return { status: 'duplicate', runId: conflict.runId };
  const updates = changes[Symbol.asyncIterator]();
  let nextUpdate = updates.next();
  while (true) {
    const dueAt = await nextDelivery(settings);
    const event = await Promise.race([
      sleep(new Date(dueAt)).then(() => ({ type: 'time' })),
      nextUpdate.then(update => ({ type: 'update', value: update.value }))
    ]);
    if (event.type === 'update') {
      if (!event.value?.enabled) return { status: 'disabled' };
      settings = event.value.settings;
      subscription = event.value.subscription;
      nextUpdate = updates.next();
      continue;
    }
    let result;
    try { result = await deliverDaily(subscription, settings, dueAt); }
    catch { continue; }
    if (result === 'expired') return { status: 'subscription-expired' };
  }
}
async function nextDelivery(settings) {
  'use step';
  return nextOccurrence(settings.time, settings.city.timezone);
}
async function deliverDaily(subscription, settings, dueAt) {
  'use step';
  let payload;
  try {
    const params = new URLSearchParams({ latitude: String(settings.city.latitude), longitude: String(settings.city.longitude), timezone: settings.city.timezone, timeformat: 'unixtime', forecast_days: '3', hourly: 'temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m' });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('weather-unavailable');
    payload = buildDigest(await response.json(), settings, dueAt);
  } catch {
    // Keep tomorrow's schedule alive even when today's weather provider is unavailable.
    payload = { title: `RideCast · ${settings.city.name}`, body: 'گزارش روزانه آماده نشد؛ برای دریافت تازه‌ترین وضعیت هوا، اپ را باز کن.', tag: 'ridecast-daily-unavailable', url: '/', kind: 'daily' };
  }
  webpush.setVapidDetails('https://ridecast-ir.vercel.app/', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 3600, urgency: 'normal', timeout: 12000 });
    return 'sent';
  } catch (error) {
    if ([404, 410].includes(error.statusCode)) return 'expired';
    throw error;
  }
}
deliverDaily.maxRetries = 3;
