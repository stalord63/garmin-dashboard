// Deterministic sample data so the dashboard is useful before your own data is connected.
// Shape matches what the app expects from an import or from scripts/fetch-garmin.mjs.

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function makeSample(n = 120) {
  const r = rng(42);
  const days = [];
  const activities = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const sleepMin = Math.round((weekend ? 470 : 410) + (r() - 0.5) * 100);
    const trend = Math.sin((n - i) / 18) * 3;
    const workout = r() < 0.55;

    days.push({
      date: isoDate(d),
      steps: Math.round((weekend ? 11500 : 8200) + (r() - 0.5) * 5000),
      sleepMin,
      sleepScore: clamp(Math.round(60 + (sleepMin - 360) / 4 + (r() - 0.5) * 10), 30, 99),
      hrv: Math.round(56 + trend + (sleepMin - 420) / 10 + (r() - 0.5) * 10),
      restingHr: Math.round(54 - trend * 0.6 - (sleepMin - 420) / 40 + (r() - 0.5) * 3),
      bodyBattery: clamp(Math.round(55 + (sleepMin - 380) / 3 + (r() - 0.5) * 15), 15, 100),
      stress: clamp(Math.round(32 - (sleepMin - 420) / 15 + (r() - 0.5) * 12), 5, 80),
      intensityMin: workout ? Math.round(25 + r() * 50) : Math.round(r() * 15),
    });

    if (workout) {
      const type = ['Running', 'Cycling', 'Strength', 'Walking'][Math.floor(r() * 4)];
      const durationMin = Math.round(type === 'Cycling' ? 50 + r() * 50 : 30 + r() * 35);
      const pace = { Running: 5.6, Cycling: 2.2, Walking: 11, Strength: 0 }[type];
      activities.push({
        date: isoDate(d),
        type,
        durationMin,
        distanceKm: pace ? +(durationMin / pace).toFixed(1) : null,
        avgHr: Math.round(type === 'Strength' ? 112 + r() * 15 : 128 + r() * 30),
        calories: Math.round(durationMin * (6 + r() * 5)),
      });
    }
  }
  return { days, activities: activities.reverse(), source: { days: 'sample', activities: 'sample' } };
}
