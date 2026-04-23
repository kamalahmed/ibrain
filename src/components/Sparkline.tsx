type Props = {
  /** Values in chronological order (oldest first). */
  values: number[];
  width?: number;
  height?: number;
  /** Tailwind text-* class used for stroke / fill (via currentColor). */
  colorClass?: string;
  /** Highlight the most recent point with a filled dot. */
  showLastDot?: boolean;
  /** Optional label for screen readers. */
  ariaLabel?: string;
};

/**
 * Tiny pure-SVG sparkline. No deps, `currentColor` stroke/fill so callers
 * can recolour via Tailwind text classes.
 */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  colorClass = "text-brand-500",
  showLastDot = true,
  ariaLabel,
}: Props) {
  if (!values || values.length === 0) return null;

  // Single point: centered dot with a faint horizontal baseline
  if (values.length === 1) {
    const y = height / 2;
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={colorClass}
        role="img"
        aria-label={ariaLabel ?? "single data point"}
      >
        <line
          x1="0"
          y1={y}
          x2={width}
          y2={y}
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        <circle cx={width / 2} cy={y} r="2.6" fill="currentColor" />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = 3;
  const stepX = (width - 2) / (values.length - 1);
  const points = values.map((v, i) => {
    const x = 1 + i * stepX;
    const y = height - padY - ((v - min) / range) * (height - padY * 2);
    return { x, y };
  });
  const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  // Area path (gentle fill under the line)
  const areaPath =
    `M ${points[0].x.toFixed(1)} ${(height - padY).toFixed(1)} ` +
    points.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") +
    ` L ${last.x.toFixed(1)} ${(height - padY).toFixed(1)} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={colorClass}
      role="img"
      aria-label={ariaLabel ?? `trend of ${values.length} plays`}
    >
      <path d={areaPath} fill="currentColor" fillOpacity="0.15" />
      <polyline
        points={polyline}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showLastDot && (
        <circle cx={last.x} cy={last.y} r="2.4" fill="currentColor" />
      )}
    </svg>
  );
}

/**
 * Trend against the last N-1 values: positive if the latest is above the
 * average of the prior N-1, negative if below, near-zero if flat.
 * Returns percentage delta (clamped to ±100).
 */
export function computeTrendPct(values: number[], windowSize = 5): number {
  if (!values || values.length < 2) return 0;
  const window = values.slice(-windowSize);
  if (window.length < 2) return 0;
  const latest = window[window.length - 1];
  const prior = window.slice(0, -1);
  const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
  if (avg === 0) return latest > 0 ? 100 : 0;
  const pct = ((latest - avg) / Math.abs(avg)) * 100;
  return Math.max(-100, Math.min(100, Math.round(pct)));
}
