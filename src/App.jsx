import { useEffect, useMemo, useRef, useState } from 'react';
import { makeSample } from './data/sample.js';
import {
  METRICS, activitySummary, completeDays, dayGrid, drivers, fmtDate, fmtDur, fmtNum, insights, readiness, records, rolling, weekly, windowStats,
} from './lib/metrics.js';
import Chart, { Ring, Spark } from './components/Chart.jsx';
import GrafanaEmbed from './components/GrafanaEmbed.jsx';

// Earlier versions saved file imports here, which overrode garmin.json. Clear any leftover copy.
try { localStorage.removeItem('garmin-dashboard-data'); } catch { /* storage unavailable */ }

const RANGES = [7, 30, 90];
const TONE = { good: 'Good sign', watch: 'Worth watching', neutral: 'Note' };
const signed = (v, digits = 0) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}`;
// Compact values for the day grid.
const CELL = {
  sleepMin: (v) => `${(v / 60).toFixed(1)}h`,
  steps: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`),
};

export default function App() {
  const sample = useMemo(() => makeSample(), []);
  const [data, setData] = useState(sample);
  const [range, setRange] = useState(30);
  const gridRef = useRef(null);

  // Data written by `npm run fetch` lands in public/garmin.json.
  useEffect(() => {
    fetch('/garmin.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !Array.isArray(j.days) || !j.days.length) return;
        const hasActs = Array.isArray(j.activities) && j.activities.length > 0;
        setData({ days: j.days, activities: hasActs ? j.activities : [], source: { days: 'api', activities: hasActs ? 'api' : 'none' } });
      })
      .catch(() => {});
  }, []);

  const days = useMemo(() => [...data.days].sort((a, b) => (a.date < b.date ? -1 : 1)), [data.days]);
  const view = days.slice(-range);
  const ready = readiness(days);
  const notes = useMemo(() => insights(days, data.activities), [days, data.activities]);
  const links = useMemo(() => drivers(days), [days]);
  const grid = useMemo(() => dayGrid(days, 14), [days]);
  // Newest days are on the right; on narrow screens start the grid scrolled to them.
  useEffect(() => { const el = gridRef.current; if (el) el.scrollLeft = el.scrollWidth; }, [grid]);
  const bests = records(view);
  const isSample = data.source?.days === 'sample';
  const last = days.at(-1);
  const short = days.length < 14;

  const tileDefs = [
    { key: 'sleepMin', label: 'Sleep', color: 'var(--sleep)', value: fmtDur, delta: (d) => `${signed(d)} min` },
    { key: 'sleepScore', label: 'Sleep score', color: 'var(--sleep)', value: (v) => fmtNum(v), delta: (d) => signed(d) },
    { key: 'hrv', label: 'HRV', color: 'var(--hrv)', value: (v) => `${Math.round(v)} ms`, delta: (d) => `${signed(d)} ms` },
    { key: 'restingHr', label: 'Resting heart rate', color: 'var(--heart)', value: (v) => `${Math.round(v)} bpm`, delta: (d) => `${signed(d, 1)} bpm` },
    { key: 'stress', label: 'Stress', color: 'var(--stress)', value: (v) => fmtNum(v), delta: (d) => signed(d) },
    { key: 'steps', label: 'Steps', color: 'var(--steps)', value: fmtNum, delta: (d) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmtNum(Math.abs(d))}` },
  ];
  const tiles = tileDefs.map((t) => {
    const s = windowStats(days, t.key);
    const d = s.now - s.base;
    return {
      ...t,
      shown: Number.isFinite(s.now) ? t.value(s.now) : '–',
      caption: s.mode === 'week' ? '7-day avg' : t.key === 'steps' || t.key === 'stress' ? 'Last full day' : 'Latest',
      deltaText: Number.isFinite(d) ? t.delta(d) : null,
      good: d * METRICS[t.key].dir >= 0,
      vs: s.mode === 'week' ? 'vs 4-week typical' : 'vs your typical',
      spark: (['steps', 'stress'].includes(t.key) ? completeDays(days) : days).slice(-14).map((x) => x[t.key]),
    };
  });

  const series = (key, f = (v) => v) => view.map((d) => ({ label: fmtDate(d.date), long: fmtDate(d.date, true), y: Number.isFinite(d[key]) ? f(d[key]) : null }));
  const trend = (key, f = (v) => v) => (days.length >= 14 ? rolling(days, key).slice(-range).map((v) => (Number.isFinite(v) ? f(v) : NaN)) : null);
  const weeks = weekly(days.slice(-Math.max(range, 56)), 'intensityMin').map((w, i, all) => ({
    label: fmtDate(w.date),
    long: `Week of ${fmtDate(w.date)}${i === all.length - 1 ? ' (so far)' : ''}`,
    y: w.y,
  }));
  const hrvBase = Math.round(windowStats(days, 'hrv').base);
  const rangeNote = view.length < range ? `all ${view.length} days of your data` : `last ${range} days`;

  const recent = data.activities.slice(0, 6);
  const actSummary = activitySummary(data.activities, view[0]?.date ?? '');

  return (
    <main className="page">
      <header className="top">
        <div>
          <p className="eyebrow">{fmtDate(last.date, true)}</p>
          <h1>Daily Insights</h1>
          <p className="muted small">{days.length} days of data · {fmtDate(days[0].date)} – {fmtDate(last.date)}</p>
        </div>
        <div className="controls">
          <div className="segmented" role="group" aria-label="Chart range">
            {RANGES.map((r) => (
              <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{r}D</button>
            ))}
          </div>
        </div>
      </header>

      {isSample && (
        <p className="banner">You’re looking at sample data. Add GARMIN_API_KEY to .env and restart npm run dev (or run npm run fetch) to see your own.</p>
      )}

      {ready && (
        <section className="card readiness">
          <div className="ring-wrap">
            <Ring score={ready.score} />
            <div className="ring-label"><b>{ready.score}</b><span>of 100</span></div>
          </div>
          <div className="readiness-body">
            <p className="eyebrow">Readiness estimate</p>
            <h2>{ready.label}</h2>
            <p className="focus">{ready.focus}</p>
            <p className="muted small">
              From today’s HRV ({Number.isFinite(ready.hrvZ) ? `${signed(ready.hrvZ, 1)} SD vs typical` : 'no reading'}), resting heart rate ({Number.isFinite(ready.rhrDelta) ? `${signed(ready.rhrDelta, 1)} bpm` : 'no reading'}) and {Number.isFinite(ready.sleepH) ? fmtDur(ready.sleepH * 60) : 'no record'} of sleep. A simple estimate, not Garmin’s Training Readiness.
            </p>
          </div>
          <dl className="last-night">
            <div><dt>Slept</dt><dd>{fmtDur(last.sleepMin)}</dd></div>
            <div><dt>Sleep score</dt><dd>{last.sleepScore ?? '–'}</dd></div>
            <div><dt>HRV</dt><dd>{last.hrv != null ? `${last.hrv} ms` : '–'}</dd></div>
            <div><dt>Resting HR</dt><dd>{last.restingHr != null ? `${last.restingHr} bpm` : '–'}</dd></div>
            <div><dt>Body Battery</dt><dd>{last.bodyBattery ?? '–'}</dd></div>
          </dl>
        </section>
      )}

      <section className="tiles">
        {tiles.map((t) => (
          <div className="card tile" key={t.key}>
            <p className="tile-label"><i style={{ background: t.color }} />{t.label}<span className="tile-cap">{t.caption}</span></p>
            <p className="tile-value">{t.shown}</p>
            {t.deltaText
              ? <p className={`tile-delta ${t.good ? 'up' : 'down'}`}>{t.deltaText} <span className="muted">{t.vs}</span></p>
              : <p className="tile-delta muted">Comparison after a few more days</p>}
            <Spark values={t.spark} color={t.color} />
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="section-title">What stands out</h2>
        <ul className="insights">
          {notes.map((n) => (
            <li key={n.title}>
              <span className={`pill ${n.tone}`}>{TONE[n.tone]}</span>
              <div><b>{n.title}</b><p className="muted">{n.detail}</p></div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 className="section-title">Day by day</h2>
        <p className="muted small">Last {grid[0]?.cells.length ?? 0} days. Each cell is colored by how that day compared with your typical value.</p>
        <div className="table-scroll" ref={gridRef}>
          <table className="daygrid">
            <thead>
              <tr><th scope="col"><span className="sr-only">Metric</span></th>{grid[0]?.cells.map((c) => <th scope="col" key={c.date}>{fmtDate(c.date).replace(' ', ' ')}</th>)}</tr>
            </thead>
            <tbody>
              {grid.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((c) => {
                    const tone = c.partial ? 'partial' : !Number.isFinite(c.z) ? 'none' : c.z >= 0.5 ? 'better' : c.z <= -0.5 ? 'worse' : 'same';
                    const strength = Number.isFinite(c.z) ? Math.round(Math.min(1, Math.abs(c.z) / 2) * 45 + 15) : 0;
                    return (
                      <td key={c.date} className={`cell ${tone}`} style={tone === 'better' || tone === 'worse' ? { '--a': `${strength}%` } : undefined}
                        title={`${row.label}, ${fmtDate(c.date, true)}: ${Number.isFinite(c.v) ? METRICS[row.key].fmt(c.v) : 'no data'}${c.partial ? ' so far today' : ''}`}>
                        {Number.isFinite(c.v) ? (CELL[row.key] ?? fmtNum)(c.v) : '–'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="legend small muted"><span className="swatch better" />Better than typical <span className="swatch worse" />Worse than typical <span className="swatch same" />Normal <span className="swatch partial" />Today so far (not compared)</p>
      </section>

      <section className="split">
        <div className="card">
          <h2 className="section-title">What moves your recovery</h2>
          <p className="muted small">Patterns in your own data. These are correlations, not proof of cause{short ? ', and with so few days they are early signals' : ''}.</p>
          {links.length ? (
            <ul className="drivers">
              {links.map((l) => (
                <li key={l.key}>
                  <div className="driver-head">
                    <b>{l.title}</b>
                    <span className={`pill ${l.good ? 'good' : 'watch'}`}>{l.strength}</span>
                  </div>
                  <p className="muted">{l.detail}</p>
                  <div className="meter" role="img" aria-label={`Correlation strength ${Math.abs(l.r).toFixed(2)} of 1`}>
                    <span style={{ width: `${Math.abs(l.r) * 100}%`, background: l.good ? 'var(--hrv)' : 'var(--heart)' }} />
                  </div>
                  <p className="small muted">r = {l.r.toFixed(2)} · {l.n} days · {l.confidence}</p>
                </li>
              ))}
            </ul>
          ) : <p className="empty">Not enough data for clear patterns yet. Check back after a week or two.</p>}
        </div>
        <div className="card">
          <h2 className="section-title">Personal bests</h2>
          <p className="muted small">In the {rangeNote}</p>
          <ul className="bests">
            {bests.map((b) => (
              <li key={b.label}>
                <span className="muted">{b.label}</span>
                <b>{(b.fmt ?? fmtNum)(b.v)}</b>
                <span className="small muted">{fmtDate(b.date, true)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid">
        <div className="card">
          <h2 className="section-title">Sleep</h2>
          <p className="muted small">Hours per night, {rangeNote}</p>
          <Chart title="Sleep hours" type="bar" color="var(--sleep)" data={series('sleepMin', (v) => v / 60)} trend={trend('sleepMin', (v) => v / 60)}
            format={(v) => fmtDur(v * 60)} tick={(v) => `${v} h`} refLine={{ y: 7, label: 'Goal 7 h' }} />
        </div>
        <div className="card">
          <h2 className="section-title">Sleep score</h2>
          <p className="muted small">Garmin’s 0–100 sleep quality score</p>
          <Chart title="Sleep score" color="var(--sleep)" data={series('sleepScore')} trend={trend('sleepScore')}
            format={(v) => `${Math.round(v)}`} tick={(v) => `${v}`} refLine={{ y: 80, label: 'Good 80+' }} />
        </div>
        <div className="card">
          <h2 className="section-title">Heart rate variability</h2>
          <p className="muted small">Overnight HRV in ms. Higher than your typical is better</p>
          <Chart title="HRV" color="var(--hrv)" data={series('hrv')} trend={trend('hrv')} format={(v) => `${Math.round(v)} ms`}
            tick={(v) => `${v}`} refLine={Number.isFinite(hrvBase) ? { y: hrvBase, label: `Typical ${hrvBase}` } : null} />
        </div>
        <div className="card">
          <h2 className="section-title">Resting heart rate</h2>
          <p className="muted small">Beats per minute. Lower is usually better</p>
          <Chart title="Resting heart rate" color="var(--heart)" data={series('restingHr')} trend={trend('restingHr')} format={(v) => `${Math.round(v)} bpm`} tick={(v) => `${v}`} />
        </div>
        <div className="card">
          <h2 className="section-title">Body Battery</h2>
          <p className="muted small">Daily peak. How well you recharged</p>
          <Chart title="Body Battery peak" color="var(--steps)" data={series('bodyBattery')} trend={trend('bodyBattery')} format={(v) => `${Math.round(v)}`} tick={(v) => `${v}`} />
        </div>
        <div className="card">
          <h2 className="section-title">Stress</h2>
          <p className="muted small">Daily average. Above 50 is medium to high</p>
          <Chart title="Average stress" type="bar" color="var(--stress)" data={series('stress')} trend={trend('stress')} format={(v) => `${Math.round(v)}`}
            tick={(v) => `${v}`} refLine={{ y: 50, label: 'Medium 50' }} />
        </div>
        <div className="card">
          <h2 className="section-title">Steps</h2>
          <p className="muted small">Daily total. Today is still counting</p>
          <Chart title="Steps" type="bar" color="var(--steps)" data={series('steps')} trend={trend('steps')} format={(v) => `${fmtNum(v)} steps`}
            tick={(v) => (v >= 1000 ? `${v / 1000}k` : `${v}`)} refLine={{ y: 7500, label: 'Target 7,500' }} />
        </div>
        <div className="card">
          <h2 className="section-title">Intensity minutes</h2>
          <p className="muted small">Weekly total</p>
          <Chart title="Weekly intensity minutes" type="bar" color="var(--energy)" data={weeks} format={(v) => `${fmtNum(v)} min`}
            tick={(v) => `${v}`} refLine={{ y: 150, label: 'WHO 150 min' }} />
        </div>
      </section>

      <GrafanaEmbed range={range} />

      <section className="card">
        <h2 className="section-title">Activities</h2>
        {actSummary.length > 0 && (
          <>
            <p className="muted small">By type, {rangeNote}</p>
            <ul className="act-summary">
              {actSummary.map((s) => (
                <li key={s.type}>
                  <b>{s.type}</b>
                  <span className="muted">{s.count}× · {fmtDur(s.min)}{s.km > 0 ? ` · ${Math.round(s.km * 10) / 10} km` : ''}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {recent.length ? (
          <ul className="acts">
            {recent.map((a, i) => (
              <li key={`${a.date}-${i}`}>
                <div><b>{a.type}</b><span className="muted">{fmtDate(a.date, true)}</span></div>
                <div className="act-stats">
                  <span>{fmtDur(a.durationMin)}</span>
                  {Number.isFinite(a.distanceKm) && a.distanceKm > 0 && <span>{a.distanceKm} km</span>}
                  {Number.isFinite(a.avgHr) && <span>{Math.round(a.avgHr)} bpm</span>}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No recorded activities in this period. Start an activity on your watch (even a walk) and it will appear here after the next npm run fetch.</p>}
      </section>

      <details className="card table-card">
        <summary>Daily data table</summary>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Date</th><th>Sleep</th><th>Sleep score</th><th>HRV</th><th>Resting HR</th><th>Body Battery</th><th>Stress</th><th>Steps</th><th>Intensity</th></tr></thead>
            <tbody>
              {[...view].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{fmtDate(d.date, true)}</td><td>{fmtDur(d.sleepMin)}</td><td>{d.sleepScore ?? '–'}</td><td>{d.hrv ?? '–'}</td><td>{d.restingHr ?? '–'}</td>
                  <td>{d.bodyBattery ?? '–'}</td><td>{d.stress ?? '–'}</td><td>{fmtNum(d.steps)}</td><td>{d.intensityMin ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <footer className="muted small">Data source: {isSample ? 'sample data' : 'Garmin API (npm run fetch)'}. Stays on this computer.</footer>
    </main>
  );
}
