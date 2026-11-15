import { useLayoutEffect, useRef, useState } from 'react';

const M = { l: 40, r: 10, t: 24, b: 26 };

function niceStep(span, count) {
  const raw = span / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

function barPath(x, y, w, yb, r) {
  if (yb - y < r) r = Math.max(0, yb - y);
  return `M${x},${yb}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${yb}Z`;
}

// data: [{ label, long, y }]; one series per chart, so the title names it and no legend is needed.
export default function Chart({ data, type = 'line', color, format = (v) => v, tick = format, refLine, height = 190, title, trend }) {
  const wrap = useRef(null);
  const [w, setW] = useState(560);
  const [hi, setHi] = useState(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const vals = data.map((d) => d.y).filter(Number.isFinite);
  const hasTrend = Array.isArray(trend) && trend.filter(Number.isFinite).length >= 2;
  if (!vals.length) return <div className="empty">No data in this range</div>;

  let lo = Math.min(...vals);
  let top = Math.max(...vals);
  if (refLine) { lo = Math.min(lo, refLine.y); top = Math.max(top, refLine.y); }
  if (type === 'bar') lo = 0;
  else { const pad = (top - lo) * 0.15 || 1; lo -= pad; top += pad; }
  const step = niceStep(top - lo || 1, 3);
  const y0 = Math.floor(lo / step) * step;
  const y1 = Math.ceil(top / step) * step;
  const ticks = [];
  for (let v = y0; v <= y1 + step / 1e6; v += step) ticks.push(+v.toFixed(6));

  const iw = w - M.l - M.r;
  const ih = height - M.t - M.b;
  const n = data.length;
  const band = iw / n;
  const X = (i) => M.l + band * i + band / 2;
  const Y = (v) => M.t + ih - ((v - y0) / (y1 - y0)) * ih;
  const yb = Y(y0);

  let line = '';
  const path = (ys) => {
    let out = '';
    let pen = false;
    ys.forEach((y, i) => {
      if (!Number.isFinite(y)) { pen = false; return; }
      out += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(Math.min(Math.max(y, y0), y1)).toFixed(1)}`;
      pen = true;
    });
    return out;
  };
  if (type === 'line') line = path(data.map((d) => d.y));
  const trendLine = hasTrend ? path(trend) : '';
  const lastIdx = data.map((d) => Number.isFinite(d.y)).lastIndexOf(true);
  const xTicks = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  const bw = band >= 4 ? band - 2 : band;

  const pick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - M.l) / band);
    setHi(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setHi((h) => Math.max(0, Math.min(n - 1, (h ?? n) + (e.key === 'ArrowLeft' ? -1 : 1))));
  };
  const active = hi != null && Number.isFinite(data[hi]?.y) ? hi : null;
  const tipX = active != null ? Math.min(Math.max(X(active), 64), w - 64) : 0;

  return (
    <div className="chart" ref={wrap} tabIndex={0} onKeyDown={onKey} onBlur={() => setHi(null)}
      aria-label={`${title}. ${n} points. Use the left and right arrow keys to read values.`}>
      <svg width={w} height={height} role="img" aria-hidden="true" onPointerMove={pick} onPointerLeave={() => setHi(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={w - M.r} y1={Y(t)} y2={Y(t)} className={t === y0 ? 'axis' : 'grid'} />
            <text x={M.l - 8} y={Y(t)} className="tick" textAnchor="end" dominantBaseline="middle">{tick(t)}</text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={X(i)} y={height - 6} className="tick" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{data[i].label}</text>
        ))}
        {refLine && (
          <g>
            <line x1={M.l} x2={w - M.r} y1={Y(refLine.y)} y2={Y(refLine.y)} className="ref" />
            <line x1={M.l} x2={M.l + 18} y1={8} y2={8} className="ref" />
            <text x={M.l + 24} y={8} className="tick" dominantBaseline="middle">{refLine.label}</text>
          </g>
        )}
        {hasTrend && (
          <g>
            <line x1={w - M.r - 96} x2={w - M.r - 78} y1={8} y2={8} className="trend" />
            <text x={w - M.r} y={8} className="tick" textAnchor="end" dominantBaseline="middle">7-day avg</text>
          </g>
        )}
        {type === 'bar' && data.map((d, i) => Number.isFinite(d.y) && (
          <path key={i} d={barPath(X(i) - bw / 2, Y(d.y), bw, yb, Math.min(4, bw / 2))} fill={color}
            opacity={active == null || active === i ? 1 : 0.45} />
        ))}
        {hasTrend && <path d={trendLine} className="trend" fill="none" />}
        {type === 'line' && <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {type === 'line' && active != null && <line x1={X(active)} x2={X(active)} y1={M.t} y2={yb} className="cross" />}
        {type === 'line' && (active ?? lastIdx) >= 0 && (
          <circle cx={X(active ?? lastIdx)} cy={Y(data[active ?? lastIdx].y)} r="4.5" fill={color} className="dot" />
        )}
        <rect x={M.l} y={M.t} width={iw} height={ih} fill="transparent" />
      </svg>
      {active != null && (
        <div className="tip" style={{ left: tipX }}>
          <strong>{format(data[active].y)}</strong>
          {hasTrend && Number.isFinite(trend[active]) && <span>7-day avg {format(trend[active])}</span>}
          <span>{data[active].long}</span>
        </div>
      )}
    </div>
  );
}

export function Spark({ values, color }) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return null;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const pts = values
    .map((y, i) => (Number.isFinite(y) ? `${((i / (values.length - 1)) * 96 + 2).toFixed(1)},${(26 - ((y - lo) / (hi - lo || 1)) * 22).toFixed(1)}` : null))
    .filter(Boolean)
    .join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function Ring({ score }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 132 132" aria-hidden="true">
      <circle cx="66" cy="66" r={r} className="ring-track" strokeWidth="12" fill="none" />
      <circle cx="66" cy="66" r={r} stroke="var(--hrv)" strokeWidth="12" fill="none" strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 66 66)" />
    </svg>
  );
}
