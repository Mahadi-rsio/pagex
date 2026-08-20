import { useEffect, useRef, useState } from "react";

/**
 * PageSpinner — monochrome, minimal, futuristic full-page loading state.
 *
 * Single accent color (default: pure white on near-black). No color-coding,
 * no HUD chrome, no status text unless you want it. Built to be dropped in
 * as a full-viewport overlay while content loads.
 *
 * Usage:
 *   <PageSpinner />
 *   <PageSpinner label="Loading" accent="#E5E5E5" bg="#0A0A0A" />
 */

const DEFAULTS = {
  bg: "#0A0A0A",
  accent: "#EDEDED",
  dim: "#3A3A3A",
};

function useRotation(speed = 1) {
  const [angle, setAngle] = useState(0);
  const raf = useRef();
  const prev = useRef();

  useEffect(() => {
    const tick = (t) => {
      if (prev.current !== undefined) {
        const dt = t - prev.current;
        setAngle((a) => (a + dt * 0.06 * speed) % 360);
      }
      prev.current = t;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [speed]);

  return angle;
}

export default function PageSpinner({
  label = "Loading",
  bg = DEFAULTS.bg,
  accent = DEFAULTS.accent,
  dim = DEFAULTS.dim,
  fullscreen = true,
}) {
  const outer = useRotation(1);
  const inner = useRotation(-1.6);
  const [pulse, setPulse] = useState(0);
  const pulseRaf = useRef();
  const pulseStart = useRef();

  useEffect(() => {
    const tick = (t) => {
      if (pulseStart.current === undefined) pulseStart.current = t;
      const elapsed = (t - pulseStart.current) * 0.001;
      setPulse((Math.sin(elapsed * 1.8) + 1) / 2);
      pulseRaf.current = requestAnimationFrame(tick);
    };
    pulseRaf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(pulseRaf.current);
  }, []);

  const size = 120;
  const cx = size / 2;
  const cy = size / 2;
  const squareOuter = 34;
  const squareInner = 16;

  const dotOpacity = 0.35 + pulse * 0.65;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        position: fullscreen ? "fixed" : "relative",
        inset: fullscreen ? 0 : undefined,
        width: fullscreen ? "100vw" : size + 40,
        height: fullscreen ? "100vh" : size + 40,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        background: bg,
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: "block" }}
      >
        {/* faint reference ring — fixed, gives the rotation something to read against */}
        <circle
          cx={cx}
          cy={cy}
          r={46}
          fill="none"
          stroke={dim}
          strokeWidth={1}
          opacity={0.5}
        />

        {/* tick marks, evenly spaced, no emphasis variation (monochrome = no "main" ticks) */}
        {Array.from({ length: 24 }, (_, i) => {
          const a = ((i * 15 - outer) * Math.PI) / 180;
          const r1 = 50;
          const r2 = 54;
          return (
            <line
              key={i}
              x1={cx + r1 * Math.cos(a)}
              y1={cy + r1 * Math.sin(a)}
              x2={cx + r2 * Math.cos(a)}
              y2={cy + r2 * Math.sin(a)}
              stroke={dim}
              strokeWidth={1}
              opacity={0.5}
            />
          );
        })}

        {/* outer rotating square */}
        <g transform={`rotate(${outer}, ${cx}, ${cy})`}>
          <rect
            x={cx - squareOuter}
            y={cy - squareOuter}
            width={squareOuter * 2}
            height={squareOuter * 2}
            fill="none"
            stroke={accent}
            strokeWidth={1.5}
            strokeDasharray="14 7"
            opacity={0.85}
          />
        </g>

        {/* inner counter-rotating square */}
        <g transform={`rotate(${inner}, ${cx}, ${cy})`}>
          <rect
            x={cx - squareInner}
            y={cy - squareInner}
            width={squareInner * 2}
            height={squareInner * 2}
            fill="none"
            stroke={accent}
            strokeWidth={1.5}
            rx={1}
          />
        </g>

        {/* pulsing center dot — the one "alive" element */}
        <circle cx={cx} cy={cy} r={3} fill={accent} opacity={dotOpacity} />
      </svg>

      {label ? (
        <span
          style={{
            fontSize: 11,
            letterSpacing: "0.24em",
            textTransform: "uppercase",
            color: dim,
            fontWeight: 500,
          }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}
