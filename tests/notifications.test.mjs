import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { nextOccurrence, validateSettings, validateSubscription, signToken, verifyToken, buildDigest } from '../server/notification-utils.mjs';

test('Iran half-hour offset and next-day scheduling',()=>{
  assert.equal(new Date(nextOccurrence('06:00','Asia/Tehran',Date.parse('2026-10-04T23:00:00Z'))).toISOString(),'2026-10-05T02:30:00.000Z');
  assert.equal(new Date(nextOccurrence('06:00','Asia/Tehran',Date.parse('2026-10-05T03:00:00Z'))).toISOString(),'2026-10-06T02:30:00.000Z');
});
test('Changing cities uses that city timezone; handles DST gaps',()=>{
  assert.equal(new Date(nextOccurrence('09:00','Asia/Tokyo',Date.parse('2026-10-04T23:00:00Z'))).toISOString(),'2026-10-05T00:00:00.000Z');
  assert.equal(new Date(nextOccurrence('02:30','America/New_York',Date.parse('2026-03-08T06:00:00Z'))).toISOString(),'2026-03-09T06:30:00.000Z');
});
const city={name:'تهران',latitude:35.68,longitude:51.38,timezone:'Asia/Tehran'};
test('Rejects malformed clocks, zones and untrusted push endpoints',()=>{
  assert.throws(()=>validateSettings({time:'99:10',city}));
  assert.throws(()=>validateSettings({time:'06:00',city:{...city,timezone:'auto'}}));
  assert.throws(()=>validateSettings({time:'06:00',city:{...city,latitude:100}}));
  assert.throws(()=>validateSubscription({endpoint:'http://127.0.0.1/',keys:{}}));
  assert.throws(()=>validateSubscription({endpoint:'https://example.com/',keys:{}}));
  const ec=createECDH('prime256v1');ec.generateKeys();
  const s={endpoint:'https://fcm.googleapis.com/fcm/send/test-validation-only',keys:{p256dh:ec.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
  assert.equal(validateSubscription(s).endpoint,s.endpoint);
});
test('Device schedule tokens reject tampering',()=>{
  process.env.NOTIFICATION_SIGNING_SECRET=randomBytes(32).toString('hex');
  const token=signToken({runId:'run_test',device:'test-device'});
  assert.equal(verifyToken(token).device,'test-device');
  assert.throws(()=>verifyToken(token.replace('ey','ez')));
});
test('Daily digest uses weather and saved route times',()=>{
  const dueAt=Date.parse('2026-10-05T02:30:00Z');
  const hourly={time:Array.from({length:48},(_,i)=>dueAt/1000+i*3600)};
  for(const key of ['temperature_2m','precipitation_probability','precipitation','wind_speed_10m','wind_gusts_10m'])hourly[key]=Array(48).fill(key==='temperature_2m'?21:0);
  const result=buildDigest({hourly},{time:'06:00',city,routes:[{from:'خانه',to:'دفتر',go:'08:00',back:'18:00'}]},dueAt);
  assert.match(result.body,/شرایط برای موتور خوبه/);assert.match(result.body,/خانه/);assert.match(result.body,/برگشت/);assert.equal(result.kind,'daily');
});
