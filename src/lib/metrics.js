import { isoDate } from '../data/sample.js';

const finite = (a) => a.filter(Number.isFinite);
export const mean = (a) => {
  const v = finite(a);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
};
// Median is used for baselines so one odd day (e.g. the day the watch was set up) can't skew them.
export const median = (a) => {
  const v = finite(a).sort((x, y) => x - y);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
export const sd = (a) => {
  const v = finite(a);
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 0) => (Number.isFinite(v) ? +v.toFixed(d) : NaN);
const lastFinite = (days, key) => { for (let i = days.length - 1; i >= 0; i--) if (Number.isFinite(days[i][key])) return { v: days[i][key], i }; return { v: NaN, i: -1 }; };

// Steps, stress and intensity for today are still accumulating, so leave today out of comparisons for them.
const DAYTIME = new Set(['steps', 'stress', 'intensityMin']);
export const todayIso = () => isoDate(new Date());
export const completeDays = (days) => (days.length && days.at(-1).date >= todayIso() ? days.slice(0, -1) : days);
const forKey = (days, key) => (DAYTIME.has(key) ? completeDays(days) : days);

export const parseDate = (iso) => new Date(`${iso}T00:00:00`);
export const fmtDate = (iso, long = false) =>
  parseDate(iso).toLocaleDateString(undefined, long ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
export const fmtDur = (min) => {
  if (!Number.isFinite(min)) return '–';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};
export const fmtNum = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString() : '–');

// Metric metadata: direction (+1 higher is better, -1 lower is better), label, and how to describe a change.
export const METRICS = {
  sleepMin: { label: 'Sleep', dir: 1, unit: 'min', fmt: fmtDur, step: 60, stepLabel: 'extra hour of sleep' },
  sleepScore: { label: 'Sleep score', dir: 1, fmt: (v) => fmtNum(v), step: 10, stepLabel: '10 points of sleep score' },
  hrv: { label: 'HRV', dir: 1, fmt: (v) => `${fmtNum(v)} ms`, unit: 'ms' },
  restingHr: { label: 'Resting HR', dir: -1, fmt: (v) => `${fmtNum(v)} bpm`, unit: 'bpm' },
  bodyBattery: { label: 'Body Battery', dir: 1, fmt: (v) => fmtNum(v), unit: 'points' },
  stress: { label: 'Stress', dir: -1, fmt: (v) => fmtNum(v), step: 10, stepLabel: '10 points of daytime stress', unit: 'points' },
  steps: { label: 'Steps', dir: 1, fmt: fmtNum, step: 1000, stepLabel: '1,000 steps' },
  intensityMin: { label: 'Intensity min', dir: 1, fmt: (v) => `${fmtNum(v)} min`, step: 30, stepLabel: '30 intensity minutes' },
};

// Compare "now" with your typical value.
// With 14+ days: 7-day average vs the median of the 4 weeks before.
// With less: the latest value vs the median of all earlier days.
export function windowStats(allDays, key) {
  const days = forKey(allDays, key);
  if (days.length >= 14) {
    return { now: mean(days.slice(-7).map((d) => d[key])), base: median(days.slice(-35, -7).map((d) => d[key])), mode: 'week' };
  }
  const { v, i } = lastFinite(days, key);
  const prior = days.slice(0, Math.max(0, i)).map((d) => d[key]);
  return { now: v, base: finite(prior).length >= 3 ? median(prior) : NaN, mode: 'latest', n: finite(prior).length };
}

// Simple readiness estimate (not Garmin's Training Readiness):
// HRV vs personal baseline, resting HR vs baseline, and last night's sleep vs 7 h.
export function readiness(days) {
  if (days.length < 4) return null;
  const last = days.at(-1);
  const base = days.slice(-29, -1);
  const hrvB = base.map((d) => d.hrv);
  const spread = sd(hrvB) || 1;
  const hrvZ = (last.hrv - median(hrvB)) / Math.max(spread, 3);
  const rhrDelta = last.restingHr - median(base.map((d) => d.restingHr));
  const sleepH = last.sleepMin / 60;
  const raw = 60 + (Number.isFinite(hrvZ) ? hrvZ * 12 : 0) - (Number.isFinite(rhrDelta) ? rhrDelta * 3 : 0) + (Number.isFinite(sleepH) ? (sleepH - 7) * 8 : 0);
  const score = clamp(Math.round(raw), 1, 100);
  const label = score >= 70 ? 'Ready to push' : score >= 45 ? 'Steady' : 'Take it easy';
  const focus = score >= 70
    ? 'A good day for a harder workout or your most demanding work.'
    : score >= 45
      ? 'A normal day. Moderate activity is fine; protect tonight’s bedtime.'
      : 'Keep it light today: an easy walk, fewer late nights, extra recovery.';
  return { score, label, focus, hrvZ, rhrDelta, sleepH };
}

export function weekly(days, key) {
  const m = new Map();
  for (const d of days) {
    const dt = parseDate(d.date);
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    const k = isoDate(dt);
    m.set(k, (m.get(k) || 0) + (Number.isFinite(d[key]) ? d[key] : 0));
  }
  return [...m].map(([date, y]) => ({ date, y }));
}

// Trailing 7-day average (needs at least 4 of the 7 days).
export function rolling(days, key, n = 7) {
  return days.map((_, i) => {
    const w = finite(days.slice(Math.max(0, i - n + 1), i + 1).map((d) => d[key]));
    return i >= n - 1 && w.length >= 4 ? mean(w) : NaN;
  });
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

// Garmin dates a night's sleep by the morning you wake up, so sleep on date D comes before D's daytime.
// lag 1 = the x value from the day before.
const PAIRS = [
  { x: 'sleepMin', y: 'bodyBattery', lag: 0, what: 'Body Battery the next morning' },
  { x: 'sleepMin', y: 'hrv', lag: 0, what: 'overnight HRV' },
  { x: 'sleepMin', y: 'stress', lag: 0, what: 'stress the next day' },
  { x: 'sleepScore', y: 'bodyBattery', lag: 0, what: 'Body Battery the next morning' },
  { x: 'stress', y: 'sleepScore', lag: 1, what: 'that night’s sleep score' },
  { x: 'stress', y: 'hrv', lag: 1, what: 'that night’s HRV' },
  { x: 'stress', y: 'restingHr', lag: 1, what: 'the next resting heart rate' },
  { x: 'steps', y: 'sleepScore', lag: 1, what: 'that night’s sleep score' },
  { x: 'intensityMin', y: 'hrv', lag: 1, what: 'that night’s HRV' },
];

// What tends to move together in your data. Correlation, not proof.
export function drivers(days, window = 90) {
  const d = days.slice(-window);
  const out = [];
  for (const p of PAIRS) {
    const xs = []; const ys = [];
    const today = todayIso();
    for (let i = p.lag; i < d.length; i++) {
      const x = d[i - p.lag][p.x]; const y = d[i][p.y];
      if ((DAYTIME.has(p.x) && d[i - p.lag].date >= today) || (DAYTIME.has(p.y) && d[i].date >= today)) continue;
      if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
    }
    if (xs.length < 6) continue;
    const r = pearson(xs, ys);
    if (!Number.isFinite(r) || Math.abs(r) < (xs.length < 14 ? 0.5 : 0.35)) continue;
    const mx = METRICS[p.x]; const my = METRICS[p.y];
    const slope = r * (sd(ys) / sd(xs)) * (mx.step || 1);
    const good = Math.sign(slope) * my.dir > 0;
    const unit = my.unit ? ` ${my.unit}` : '';
    out.push({
      key: `${p.x}-${p.y}`,
      r,
      n: xs.length,
      good,
      strength: Math.abs(r) >= 0.7 ? 'Strong' : Math.abs(r) >= 0.5 ? 'Moderate' : 'Weak',
      confidence: xs.length < 14 ? 'early signal' : xs.length < 30 ? 'building' : 'consistent',
      title: `${mx.label} → ${p.what}`,
      detail: `Each ${mx.stepLabel} goes with about ${slope >= 0 ? '+' : '−'}${Math.abs(round(slope, Math.abs(slope) < 10 ? 1 : 0))}${unit} in ${p.what}.`,
    });
  }
  return out.sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 5);
}

// Per-day color grid: how each day compared with your typical value (median, in standard deviations).
export const GRID_KEYS = ['sleepMin', 'sleepScore', 'hrv', 'restingHr', 'bodyBattery', 'stress', 'steps'];
export function dayGrid(days, n = 14) {
  const ref = days.slice(-60);
  const cols = days.slice(-n);
  const today = todayIso();
  return GRID_KEYS.map((key) => {
    const vals = forKey(ref, key).map((d) => d[key]);
    const mid = median(vals);
    const spread = sd(vals) || 1;
    return {
      key,
      label: METRICS[key].label,
      cells: cols.map((d) => {
        const v = d[key];
        const partial = DAYTIME.has(key) && d.date >= today;
        const z = Number.isFinite(v) && !partial ? ((v - mid) / spread) * METRICS[key].dir : NaN;
        return { date: d.date, v, partial, z: Number.isFinite(z) ? clamp(z, -2, 2) : NaN };
      }),
    };
  });
}

// Best values in a range.
export function records(days) {
  const pick = (key, best) => {
    let bi = -1;
    days.forEach((d, i) => { if (Number.isFinite(d[key]) && (bi < 0 || (best > 0 ? d[key] > days[bi][key] : d[key] < days[bi][key]))) bi = i; });
    return bi < 0 ? null : { key, v: days[bi][key], date: days[bi].date };
  };
  return [
    { ...pick('sleepScore', 1), label: 'Best sleep score' },
    { ...pick('hrv', 1), label: 'Highest HRV', fmt: METRICS.hrv.fmt },
    { ...pick('restingHr', -1), label: 'Lowest resting HR', fmt: METRICS.restingHr.fmt },
    { ...pick('steps', 1), label: 'Most steps', fmt: fmtNum },
  ].filter((r) => r.date);
}

export function activitySummary(activities, sinceIso) {
  const by = new Map();
  for (const a of activities) {
    if (a.date < sinceIso) continue;
    const s = by.get(a.type) || { type: a.type, count: 0, min: 0, km: 0 };
    s.count += 1; s.min += a.durationMin || 0; s.km += a.distanceKm || 0;
    by.set(a.type, s);
  }
  return [...by.values()].sort((a, b) => b.min - a.min);
}

const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const stepBand = (s) => (s < 5000 ? 'sedentary' : s < 7500 ? 'low active' : s < 10000 ? 'somewhat active' : 'active');

export function insights(days, activities) {
  const out = [];
  if (days.length < 3) return out;
  const short = days.length < 14;
  const vs = short ? 'your typical' : 'your 4-week typical';

  const intro = short
    ? { tone: 'neutral', title: `Building your baseline: ${days.length} days so far`, detail: 'Comparisons below use your latest value against your typical (median) so far. Weekly trends appear at 14 days; patterns get reliable after about 4 weeks.' }
    : null;

  // Last night.
  const last = days.at(-1);
  if (Number.isFinite(last.sleepScore)) {
    const typical = median(days.slice(-29, -1).map((d) => d.sleepScore));
    const q = last.sleepScore >= 80 ? 'good' : last.sleepScore >= 60 ? 'neutral' : 'watch';
    out.push({
      tone: q,
      title: `Last night: ${fmtDur(last.sleepMin)}, sleep score ${last.sleepScore}`,
      detail: `${Number.isFinite(typical) ? `Your typical score is ${round(typical)}. ` : ''}${last.sleepScore >= 80 ? 'A restorative night.' : last.sleepScore >= 60 ? 'A fair night.' : 'A poor night: expect lower energy and go easier today.'}${Number.isFinite(last.bodyBattery) ? ` Body Battery recharged to ${last.bodyBattery}.` : ''}`,
    });
  }

  const hrv = windowStats(days, 'hrv');
  const hrvPct = ((hrv.now - hrv.base) / hrv.base) * 100;
  const hrvWhat = hrv.mode === 'week' ? 'Your 7-day average is' : 'Last night’s HRV was';
  if (Number.isFinite(hrvPct)) {
    if (Math.abs(hrvPct) < 5)
      out.push({ tone: 'neutral', title: 'HRV is steady', detail: `${hrvWhat} ${round(hrv.now)} ms, within 5% of ${vs} ${round(hrv.base)} ms.` });
    else if (hrvPct > 0)
      out.push({ tone: 'good', title: `HRV is up ${round(hrvPct)}%`, detail: `${hrvWhat} ${round(hrv.now)} ms against ${vs} ${round(hrv.base)} ms. Your body is recovering well.` });
    else
      out.push({ tone: 'watch', title: `HRV is down ${round(-hrvPct)}%`, detail: `${hrvWhat} ${round(hrv.now)} ms against ${vs} ${round(hrv.base)} ms. Consider an easier day or more sleep.` });
  }

  const rhr = windowStats(days, 'restingHr');
  const rhrD = rhr.now - rhr.base;
  if (Number.isFinite(rhrD) && Math.abs(rhrD) >= 2)
    out.push(rhrD > 0
      ? { tone: 'watch', title: `Resting heart rate is up ${round(rhrD, 1)} bpm`, detail: `${round(rhr.now)} bpm vs ${vs} ${round(rhr.base)}. An elevated resting heart rate can point to fatigue, stress, illness, or late meals and alcohol.` }
      : { tone: 'good', title: `Resting heart rate is down ${round(-rhrD, 1)} bpm`, detail: `${round(rhr.now)} bpm vs ${vs} ${round(rhr.base)}. A lower resting heart rate than usual is a sign of good recovery.` });

  const sleepN = Math.min(7, days.length);
  const sleep7 = mean(days.slice(-sleepN).map((d) => d.sleepMin));
  const shortNights = days.slice(-sleepN).filter((d) => d.sleepMin < 420).length;
  if (Number.isFinite(sleep7))
    out.push(sleep7 < 420
      ? { tone: 'watch', title: 'Sleep is under 7 hours', detail: `You averaged ${fmtDur(sleep7)} over the last ${sleepN} nights; ${shortNights} were under 7 hours.` }
      : { tone: 'good', title: 'Sleep is on target', detail: `You averaged ${fmtDur(sleep7)} over the last ${sleepN} nights${shortNights ? `, though ${shortNights} ${shortNights === 1 ? 'was' : 'were'} under 7 hours` : ''}.` });

  const spread = sd(days.slice(-14).map((d) => d.sleepMin));
  if (spread > 45)
    out.push({ tone: 'watch', title: 'Sleep length varies a lot', detail: `Your nightly sleep swung by about ±${round(spread)} min recently. A steadier bedtime usually helps recovery and sleep score.` });

  const done = completeDays(days);
  const doneN = Math.min(7, done.length);
  const partial = done.length < days.length ? ' (today not counted yet)' : '';

  // Stress (Garmin bands: 0–25 rest, 26–50 low, 51–75 medium, 76–100 high).
  const st = done.slice(-7).map((d) => d.stress);
  const stAvg = mean(st);
  if (Number.isFinite(stAvg)) {
    const high = finite(st).filter((s) => s > 50).length;
    out.push(stAvg > 50 || high >= 3
      ? { tone: 'watch', title: `Stress is running high (avg ${round(stAvg)})`, detail: `${high} of the last ${finite(st).length} days had medium or high average stress (above 50). Short breaks, walks and breathing exercises help Body Battery recharge.` }
      : { tone: 'good', title: `Stress is in the low range (avg ${round(stAvg)})`, detail: `${high ? `${high} day${high === 1 ? '' : 's'} went above 50, but overall` : 'Overall'} your daily stress is mostly in Garmin’s rest/low bands.` });
  }

  // Body Battery recharge.
  const bb = finite(days.slice(-7).map((d) => d.bodyBattery));
  if (bb.length >= 3) {
    const low = bb.filter((v) => v < 60).length;
    if (low)
      out.push({ tone: low >= 3 ? 'watch' : 'neutral', title: `Body Battery didn’t fully recharge on ${low} of ${bb.length} days`, detail: `Peak stayed under 60 on those days. Low peaks usually follow short or restless sleep, or a stressful previous day.` });
    else
      out.push({ tone: 'good', title: 'Body Battery is recharging well', detail: `Your daily peak was 60 or higher on all of the last ${bb.length} days (average ${round(mean(bb))}).` });
  }

  // Steps.
  const steps7 = mean(done.slice(-doneN).map((d) => d.steps));
  if (Number.isFinite(steps7)) {
    const band = stepBand(steps7);
    out.push(steps7 < 5000
      ? { tone: 'watch', title: `Averaging ${fmtNum(steps7)} steps a day (${band})`, detail: `Over the last ${doneN} full days${partial}. Under 5,000 steps a day is considered sedentary. Every 1,000 extra daily steps is linked to lower health risk; a 10-minute walk adds roughly 1,000.` }
      : { tone: steps7 >= 7500 ? 'good' : 'neutral', title: `Averaging ${fmtNum(steps7)} steps a day (${band})`, detail: steps7 >= 10000 ? 'You’re above the popular 10,000-step goal.' : steps7 >= 7500 ? `You’re past 7,500 a day, where most of the health benefit shows up in research. 10,000 is ${fmtNum(10000 - steps7)} more.` : `${fmtNum(7500 - steps7)} more a day would reach 7,500, where most of the health benefit shows up in research.` });
  }

  const intensityN = doneN;
  const intensity = done.slice(-intensityN).reduce((s, d) => s + (d.intensityMin || 0), 0);
  out.push(intensity >= 150
    ? { tone: 'good', title: `${intensity} intensity minutes in ${intensityN} days`, detail: 'That meets the WHO guideline of at least 150 minutes of moderate activity a week.' }
    : { tone: intensity < 30 ? 'watch' : 'neutral', title: `${intensity} of 150 intensity minutes`, detail: `${150 - intensity} more minutes over the last ${intensityN} full days would meet the WHO weekly guideline. Brisk walking counts.` });

  const recent = days.slice(-60).filter((d) => Number.isFinite(d.sleepMin) && Number.isFinite(d.hrv));
  const long = recent.filter((d) => d.sleepMin >= 420).map((d) => d.hrv);
  const shortH = recent.filter((d) => d.sleepMin < 420).map((d) => d.hrv);
  if (long.length >= 8 && shortH.length >= 8) {
    const diff = mean(long) - mean(shortH);
    if (diff >= 2)
      out.push({ tone: 'good', title: 'Sleep pays off in your HRV', detail: `After 7+ hours of sleep your HRV averaged ${round(mean(long))} ms, compared with ${round(mean(shortH))} ms after shorter nights (last 60 days).` });
  }

  if (days.length >= 28) {
    const byDow = Array.from({ length: 7 }, () => []);
    days.slice(-56).forEach((d) => byDow[parseDate(d.date).getDay()].push(d.steps));
    const avgs = byDow.map(mean);
    if (avgs.every(Number.isFinite)) {
      const hi = avgs.indexOf(Math.max(...avgs));
      const lo = avgs.indexOf(Math.min(...avgs));
      out.push({ tone: 'neutral', title: `You move most on ${WEEKDAYS[hi]}`, detail: `You average ${fmtNum(avgs[hi])} steps on ${WEEKDAYS[hi]} and ${fmtNum(avgs[lo])} on ${WEEKDAYS[lo]}, your least active day.` });
    }
  }

  if (activities.length) {
    const end = parseDate(days.at(-1).date);
    const ago = (n) => { const d = new Date(end); d.setDate(d.getDate() - n); return isoDate(d); };
    const cur = activities.filter((a) => a.date > ago(28));
    const prev = activities.filter((a) => a.date > ago(56) && a.date <= ago(28));
    const curMin = cur.reduce((s, a) => s + (a.durationMin || 0), 0);
    const prevMin = prev.reduce((s, a) => s + (a.durationMin || 0), 0);
    if (prevMin > 0) {
      const ch = ((curMin - prevMin) / prevMin) * 100;
      out.push({
        tone: ch > 30 ? 'watch' : 'neutral',
        title: `Training time ${ch >= 0 ? 'up' : 'down'} ${round(Math.abs(ch))}%`,
        detail: `You logged ${cur.length} workouts (${fmtDur(curMin)}) in the last 4 weeks, compared with ${prev.length} (${fmtDur(prevMin)}) before that.${ch > 30 ? ' Ramping up quickly raises injury risk.' : ''}`,
      });
    }
  }

  // Watch items first, then good, then neutral.
  const order = { watch: 0, good: 1, neutral: 2 };
  out.sort((a, b) => order[a.tone] - order[b.tone]);
  return intro ? [intro, ...out] : out;
}
