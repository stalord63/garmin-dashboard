import { useCallback, useEffect, useState } from 'react';

// Local Grafana started with `npm run grafana` (docker-compose.yml). Override with VITE_GRAFANA_URL in .env.
const GRAFANA = (import.meta.env.VITE_GRAFANA_URL || 'http://localhost:3000').replace(/\/$/, '');
const DASHBOARD = `${GRAFANA}/d/garmin-health/garmin-health`;

const prefersDark = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;

export default function GrafanaEmbed({ range }) {
  const [status, setStatus] = useState('checking');
  const [dark, setDark] = useState(prefersDark);

  // Grafana sends no CORS headers, so use an opaque no-cors request: it resolves if the server answers, rejects if it's down.
  const check = useCallback(() => {
    setStatus('checking');
    fetch(`${GRAFANA}/api/health`, { mode: 'no-cors', cache: 'no-store' })
      .then(() => setStatus('up'))
      .catch(() => setStatus('down'));
  }, []);

  useEffect(check, [check]);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const on = (e) => setDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const params = `orgId=1&from=now-${range}d&to=now&theme=${dark ? 'dark' : 'light'}`;

  return (
    <section className="card grafana">
      <div className="grafana-head">
        <div>
          <h2 className="section-title">Grafana</h2>
          <p className="muted small">The same garmin.json in a Grafana dashboard, last {range} days. Follows the range switch above.</p>
        </div>
        {status === 'up' && <a className="pill-link" href={`${DASHBOARD}?${params}`} target="_blank" rel="noreferrer">Open in Grafana ↗</a>}
      </div>
      {status === 'up' && (
        <iframe className="grafana-frame" title="Garmin Health dashboard in Grafana" src={`${DASHBOARD}?${params}&kiosk`} loading="lazy" />
      )}
      {status === 'checking' && <p className="empty">Looking for Grafana…</p>}
      {status === 'down' && (
        <div className="grafana-down">
          <p>Grafana isn’t running at {GRAFANA}.</p>
          <p className="muted small">Start it with <code>npm run grafana</code> (needs Docker), then retry.</p>
          <button type="button" className="pill-link" onClick={check}>Retry</button>
        </div>
      )}
    </section>
  );
}
