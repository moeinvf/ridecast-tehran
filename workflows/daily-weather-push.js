import { sleep } from 'workflow';
import webpush from 'web-push';

function partsInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function zoneOffsetMs(timeZone, date) {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

function localTargetToUtc(timeZone, year, month, day, hour, minute) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = new Date(desired);
  for (let i = 0; i < 3; i++) {
    const offset = zoneOffsetMs(timeZone, guess);
    guess = new Date(desired - offset);
  }
  return guess;
}

export async function secondsUntilNextDaily(time, timeZone) {
  'use step';

  const zone = timeZone && timeZone !== 'auto' ? timeZone : 'Asia/Tehran';
  const now = new Date();
  const local = partsInZone(now, zone);
  const [hour, minute] = String(time || '08:00').split(':').map(Number);

  let y = local.year;
  let m = local.month;
  let d = local.day;

  const localNowMinutes = local.hour * 60 + local.minute;
  const targetMinutes = hour * 60 + minute;
  if (localNowMinutes >= targetMinutes) {
    const tomorrow = new Date(Date.UTC(y, m - 1, d) + 86400000);
    y = tomorrow.getUTCFullYear();
    m = tomorrow.getUTCMonth() + 1;
    d = tomorrow.getUTCDate();
  }

  const target = localTargetToUtc(zone, y, m, d, hour, minute);
  return Math.max(5, Math.ceil((target.getTime() - now.getTime()) / 1000));
}

function riskOf(prob = 0, wind = 0) {
  if (prob >= 65 || wind >= 35) return 'bad';
  if (prob >= 35 || wind >= 24) return 'warn';
  return 'good';
}

function weatherLabel(code) {
  if ([0].includes(code)) return 'صاف';
  if ([1, 2].includes(code)) return 'کمی ابری';
  if ([3].includes(code)) return 'ابری';
  if ([45, 48].includes(code)) return 'مه‌آلود';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'بارانی';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'برفی';
  if ([95, 96, 99].includes(code)) return 'رعدوبرقی';
  return 'متغیر';
}

export async function sendDailyWeatherPush(input) {
  'use step';

  const city = input.city;
  const zone = city.timezone && city.timezone !== 'auto' ? city.timezone : 'Asia/Tehran';
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(city.latitude));
  url.searchParams.set('longitude', String(city.longitude));
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max');
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('timezone', zone);

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('Weather request failed');

  const data = await response.json();
  const daily = data.daily || {};
  const max = Math.round(daily.temperature_2m_max?.[0] ?? 0);
  const min = Math.round(daily.temperature_2m_min?.[0] ?? 0);
  const rain = Math.round(daily.precipitation_probability_max?.[0] ?? 0);
  const wind = Math.round(daily.wind_speed_10m_max?.[0] ?? 0);
  const code = Number(daily.weather_code?.[0] ?? -1);
  const risk = riskOf(rain, wind);

  const rideText =
    risk === 'bad'
      ? 'امروز بهتره موتور نبری.'
      : risk === 'warn'
        ? 'امروز با احتیاط موتورسواری کن.'
        : 'امروز شرایط برای موتورسواری خوبه.';

  const body = `${weatherLabel(code)} · ${min}° تا ${max}° · بارش ${rain}٪ · باد ${wind} km/h — ${rideText}`;

  webpush.setVapidDetails(
    'https://ridecast-ir.vercel.app/',
    input.vapidPublicKey,
    input.vapidPrivateKey
  );

  try {
    await webpush.sendNotification(
      input.subscription,
      JSON.stringify({
        title: `🏍️ هوای امروز ${city.name}`,
        body,
        tag: 'ridecast-daily-' + city.id,
        url: './'
      }),
      { TTL: 60 * 60 * 6, urgency: 'normal' }
    );
    return { alive: true };
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0);
    if (statusCode === 404 || statusCode === 410) {
      return { alive: false };
    }
    throw error;
  }
}

export default async function dailyWeatherPush(input) {
  'use workflow';

  while (true) {
    const waitSeconds = await secondsUntilNextDaily(input.time, input.city.timezone);
    await sleep(`${waitSeconds}s`);

    const result = await sendDailyWeatherPush(input);
    if (!result?.alive) {
      return { status: 'subscription-expired' };
    }

    // Avoid calculating the same minute again immediately after the push.
    await sleep('70s');
  }
}
