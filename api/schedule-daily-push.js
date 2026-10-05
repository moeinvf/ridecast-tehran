import { start } from 'workflow/api';
import dailyWeatherPush from '../workflows/daily-weather-push.js';

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const subscription = body?.subscription;
    const city = body?.city;
    const vapidPublicKey = body?.vapidPublicKey;
    const vapidPrivateKey = body?.vapidPrivateKey;
    const time = body?.time;

    if (
      !subscription?.endpoint ||
      !subscription?.keys?.p256dh ||
      !subscription?.keys?.auth ||
      !city?.name ||
      !Number.isFinite(Number(city?.latitude)) ||
      !Number.isFinite(Number(city?.longitude)) ||
      !validTime(time) ||
      typeof vapidPublicKey !== 'string' ||
      typeof vapidPrivateKey !== 'string'
    ) {
      return res.status(400).json({ error: 'Invalid push schedule payload' });
    }

    const run = await start(dailyWeatherPush, [{
      subscription,
      city: {
        id: String(city.id || `${city.latitude},${city.longitude}`),
        name: String(city.name),
        latitude: Number(city.latitude),
        longitude: Number(city.longitude),
        timezone: String(city.timezone || 'Asia/Tehran')
      },
      time,
      vapidPublicKey,
      vapidPrivateKey
    }]);

    return res.status(202).json({
      ok: true,
      runId: run.runId
    });
  } catch (error) {
    console.error('schedule-daily-push', error);
    return res.status(500).json({ error: 'Could not schedule push' });
  }
}
