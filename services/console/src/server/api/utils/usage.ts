import { BYTES_PER_GB, getPlan, type PlanId } from "../constants/pricing";

/**
 * Pure usage/quota math. No DB or Redis imports — this module is safe to unit
 * test without infrastructure.
 */

export interface UsageWindow {
    /** Inclusive start of the current UTC calendar month. */
    start: Date;
    /** Exclusive end of the current UTC calendar month. */
    end: Date;
}

/** The monthly quota window is the current UTC calendar month. */
export function currentUsageWindow(now: Date = new Date()): UsageWindow {
    const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
    );
    const end = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
    );
    return { start, end };
}

/** Period key for the window, e.g. "2026-09". */
export function periodKey(window: UsageWindow): string {
    const y = window.start.getUTCFullYear();
    const m = String(window.start.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
}

export interface BandwidthUsage {
    usedBytes: number;
    /** `null` when the plan is unlimited. */
    limitBytes: number | null;
    /** `null` when the plan is unlimited. */
    remainingBytes: number | null;
    /** 0–100+; `null` when unlimited. */
    percentage: number | null;
    unlimited: boolean;
    overQuota: boolean;
}

/**
 * Compute bandwidth usage against a plan's monthly allowance. There is
 * deliberately NO request dimension here — requests are unlimited.
 */
export function computeBandwidthUsage(
    plan: PlanId | string | null | undefined,
    usedBytes: number,
): BandwidthUsage {
    const quota = getPlan(plan);
    const used = Math.max(
        0,
        Math.trunc(Number.isFinite(usedBytes) ? usedBytes : 0),
    );

    if (quota.bandwidthLimitBytes === null) {
        return {
            usedBytes: used,
            limitBytes: null,
            remainingBytes: null,
            percentage: null,
            unlimited: true,
            overQuota: false,
        };
    }

    const limit = quota.bandwidthLimitBytes;
    const remaining = Math.max(0, limit - used);
    const percentage =
        limit === 0 ? 0 : Number(((used / limit) * 100).toFixed(2));

    return {
        usedBytes: used,
        limitBytes: limit,
        remainingBytes: remaining,
        percentage,
        unlimited: false,
        overQuota: used >= limit,
    };
}

/** True when the tenant's usage has met or exceeded the plan allowance. */
export function isOverQuota(
    plan: PlanId | string | null | undefined,
    usedBytes: number,
): boolean {
    return computeBandwidthUsage(plan, usedBytes).overQuota;
}

/** Convert bytes to decimal GB (1 GB = 10^9 bytes). */
export function bytesToGB(bytes: number): number {
    return bytes / BYTES_PER_GB;
}

/** Convert decimal GB to whole bytes. */
export function gbToBytes(gb: number): number {
    return Math.round(gb * BYTES_PER_GB);
}

export interface UsageResponse {
    period: { start: string; end: string; key: string };
    plan: PlanId;
    planName: string;
    bandwidth: BandwidthUsage;
}

/** Build the public usage response contract (bandwidth only, no request limits). */
export function buildUsageResponse(
    plan: PlanId | string | null | undefined,
    usedBytes: number,
    window: UsageWindow = currentUsageWindow(),
): UsageResponse {
    const quota = getPlan(plan);
    return {
        period: {
            start: window.start.toISOString(),
            end: window.end.toISOString(),
            key: periodKey(window),
        },
        plan: quota.id,
        planName: quota.name,
        bandwidth: computeBandwidthUsage(quota.id, usedBytes),
    };
}
