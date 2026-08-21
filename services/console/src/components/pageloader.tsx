"use client";

import {
    type CSSProperties,
    useEffect,
    useEffectEvent,
    useRef,
    useState,
} from "react";
import { cn } from "@/lib/utils";

/**
 * PageSpinner — monochrome, minimal, futuristic full-page loading state.
 *
 * Usage:
 *   <PageSpinner />
 *   <PageSpinner label="Loading" fullscreen={false} />
 */

type PageSpinnerProps = {
    label?: string;
    fullscreen?: boolean;
    className?: string;
};

function useRotation(speed = 1) {
    const [angle, setAngle] = useState(0);
    const raf = useRef<number | null>(null);
    const prev = useRef<number | undefined>(undefined);

    const tick = useEffectEvent((t: number) => {
        if (prev.current !== undefined) {
            const dt = t - prev.current;
            setAngle((a) => (a + dt * 0.06 * speed) % 360);
        }
        prev.current = t;
        raf.current = requestAnimationFrame(tick);
    });

    useEffect(() => {
        raf.current = requestAnimationFrame(tick);
        return () => {
            if (raf.current !== null) cancelAnimationFrame(raf.current);
        };
    }, [tick]);

    return angle;
}

export default function PageSpinner({
    label = "Loading",
    fullscreen = true,
    className,
}: PageSpinnerProps) {
    const outer = useRotation(1);
    const inner = useRotation(-1.6);
    const [pulse, setPulse] = useState(0);
    const pulseRaf = useRef<number | null>(null);
    const pulseStart = useRef<number | undefined>(undefined);

    const onPulse = useEffectEvent((t: number) => {
        if (pulseStart.current === undefined) pulseStart.current = t;
        const elapsed = (t - pulseStart.current) * 0.001;
        setPulse((Math.sin(elapsed * 1.8) + 1) / 2);
        pulseRaf.current = requestAnimationFrame(onPulse);
    });

    useEffect(() => {
        pulseRaf.current = requestAnimationFrame(onPulse);
        return () => {
            if (pulseRaf.current !== null)
                cancelAnimationFrame(pulseRaf.current);
        };
    }, [onPulse]);

    const size = 120;
    const cx = size / 2;
    const cy = size / 2;
    const squareOuter = 34;
    const squareInner = 16;
    const dotOpacity = 0.35 + pulse * 0.65;

    return (
        <output
            aria-live="polite"
            aria-label={label}
            className={cn(
                "flex flex-col items-center justify-center gap-[22px] bg-background text-foreground",
                fullscreen
                    ? "fixed inset-0 z-[99999] h-svh w-screen"
                    : "relative h-[160px] w-[160px]",
                className,
            )}
        >
            <svg
                width={size}
                height={size}
                viewBox={`0 0 ${size} ${size}`}
                className="block"
                aria-hidden
            >
                <circle
                    cx={cx}
                    cy={cy}
                    r={46}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1}
                    opacity={0.18}
                />

                {Array.from({ length: 24 }, (_, i) => {
                    const a = ((i * 15 - outer) * Math.PI) / 180;
                    const r1 = 50;
                    const r2 = 54;
                    return (
                        <line
                            key={`tick-${i * 15}`}
                            x1={cx + r1 * Math.cos(a)}
                            y1={cy + r1 * Math.sin(a)}
                            x2={cx + r2 * Math.cos(a)}
                            y2={cy + r2 * Math.sin(a)}
                            stroke="currentColor"
                            strokeWidth={1}
                            opacity={0.22}
                        />
                    );
                })}

                <g transform={`rotate(${outer}, ${cx}, ${cy})`}>
                    <rect
                        x={cx - squareOuter}
                        y={cy - squareOuter}
                        width={squareOuter * 2}
                        height={squareOuter * 2}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeDasharray="14 7"
                        opacity={0.85}
                    />
                </g>

                <g transform={`rotate(${inner}, ${cx}, ${cy})`}>
                    <rect
                        x={cx - squareInner}
                        y={cy - squareInner}
                        width={squareInner * 2}
                        height={squareInner * 2}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        rx={1}
                        opacity={0.9}
                    />
                </g>

                <circle
                    cx={cx}
                    cy={cy}
                    r={3}
                    fill="currentColor"
                    style={{ opacity: dotOpacity } as CSSProperties}
                />
            </svg>

            {label ? (
                <span className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                    {label}
                </span>
            ) : null}
        </output>
    );
}

export { PageSpinner };
