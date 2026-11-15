// Fetches your Garmin data (Garmin Connect Personal API) on your own machine and writes public/garmin.json for the dashboard.
// Your key is read from the environment and never shipped to the browser.
//
//   export GARMIN_API_KEY="..."      # never paste it into code or chat
//   npm run fetch
//
// The output format the dashboard expects:
// {
//   "days": [{ "date": "2026-11-14", "steps": 9120, "sleepMin": 432, "sleepScore": 81, "hrv": 58,
//              "restingHr": 52, "bodyBattery": 88, "stress": 27, "intensityMin": 45 }],
//   "activities": [{ "date": "2026-11-14", "type": "Running", "durationMin": 42, "distanceKm": 7.4,
//                    "avgHr": 148, "calories": 510 }]
// }
// Missing values can be null.

import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Load .env from the project root (Node 18 has no --env-file). Real env vars win.
try {
  const env = await readFile(new URL('../.env', import.meta.url), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* no .env file */ }

const key = process.env.GARMIN_API_KEY;
if (!key) {
  console.error('Set GARMIN_API_KEY in your environment first, for example: export GARMIN_API_KEY="..."');
  process.exit(1);
}

const HOST = 'https://personal.connectapi.garmin.com';
const DAYS = Number(process.env.GARMIN_DAYS) || 90;
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => iso(new Date(Date.now() - n * 864e5));

// Garmin Personal API: trade the long-lived key for a 24-hour access token (returned as plain text).
async function getToken(apiKey) {
  const r = await fetch(`${HOST}/personalapitoken-service/personal-api/personal-api-key/token`, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${apiKey}` },
  });
  if (!r.ok) throw new Error(`Token request failed (${r.status}). Check the key in .env; it may have expired or been deleted.`);
  return (await r.text()).trim();
}

async function get(token, path) {
  const r = await fetch(HOST + path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${path.split('?')[0]}`);
  const text = await r.text(); // ranges with no data come back as an empty body
  return text ? JSON.parse(text) : {};
}

// Split [start, end] into chunks of at most `size` days.
function chunks(startIso, endIso, size = 30) {
  const out = [];
  for (let s = new Date(startIso); iso(s) <= endIso; s = new Date(+s + size * 864e5)) {
    const e = new Date(Math.min(+s + (size - 1) * 864e5, +new Date(endIso)));
    out.push([iso(s), iso(e)]);
  }
  return out;
}

// Run fn over items with limited concurrency.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function fetchFromGarmin(apiKey) {
  const token = await getToken(apiKey);
  const start = daysAgo(DAYS - 1);
  const end = daysAgo(0);
  const ranges = chunks(start, end);

  // Daily summaries: steps, resting HR, intensity minutes, stress, Body Battery.
  const summaries = (await Promise.all(ranges.map(([s, e]) =>
    get(token, `/usersummary-service/v2/dailysummaries?startDate=${s}&endDate=${e}`).then((j) => j.data ?? [])
  ))).flat();

  // Overnight HRV.
  const hrvByDate = {};
  for (const [s, e] of ranges) {
    try {
      const j = await get(token, `/hrv-service/hrv/daily/${s}/${e}`);
      for (const h of j.hrvSummaries ?? []) hrvByDate[h.calendarDate] = num(h.lastNightAvg);
    } catch (err) { console.warn(`HRV skipped: ${err.message}`); }
  }

  // Sleep is one request per day.
  const dates = [...new Set(summaries.map((d) => d.calendarDate))].sort();
  const sleepByDate = {};
  await pool(dates, 4, async (date) => {
    try {
      const s = await get(token, `/sleep-service/sleep/dailySleep?date=${date}`);
      sleepByDate[date] = {
        sleepMin: num(s.sleepTimeSeconds) != null ? Math.round(s.sleepTimeSeconds / 60) : null,
        sleepScore: num(s.sleepScores?.overall?.value),
      };
    } catch { /* no sleep recorded that night */ }
  });

  const days = summaries
    .map((d) => {
      const im = d.intensityMinutes ?? {};
      const intensity = num(im.moderate) != null || num(im.vigorous) != null ? (im.moderate ?? 0) + 2 * (im.vigorous ?? 0) : null;
      return {
        date: d.calendarDate,
        steps: num(d.movement?.steps?.value),
        sleepMin: sleepByDate[d.calendarDate]?.sleepMin ?? null,
        sleepScore: sleepByDate[d.calendarDate]?.sleepScore ?? null,
        hrv: hrvByDate[d.calendarDate] ?? null,
        restingHr: num(d.heartRate?.restingValue),
        bodyBattery: num(d.bodyBattery?.maxValue),
        stress: num(d.stress?.avgLevel) != null && d.stress.avgLevel >= 0 ? d.stress.avgLevel : null,
        intensityMin: intensity,
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Activities (most recent first, up to 200).
  let activities = [];
  try {
    const list = await get(token, `/activitylist-service/activities/search/activities?start=0&limit=200`);
    activities = list
      .filter((a) => (a.startTimeLocal ?? '').slice(0, 10) >= start)
      .map((a) => ({
        date: a.startTimeLocal.slice(0, 10),
        type: (a.activityType?.typeKey ?? 'activity').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        durationMin: num(a.duration) != null ? Math.round(a.duration / 60) : null,
        distanceKm: num(a.distance) ? Math.round(a.distance / 10) / 100 : null,
        avgHr: num(a.averageHR) != null ? Math.round(a.averageHR) : null,
        calories: num(a.calories) != null ? Math.round(a.calories) : null,
      }));
  } catch (err) { console.warn(`Activities skipped: ${err.message}`); }

  return { days, activities };
}

try {
  const data = await fetchFromGarmin(key);
  await mkdir(new URL('../public/', import.meta.url), { recursive: true });
  await writeFile(new URL('../public/garmin.json', import.meta.url), JSON.stringify(data, null, 2));
  console.log(`Wrote public/garmin.json with ${data.days.length} days and ${data.activities.length} activities.`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
