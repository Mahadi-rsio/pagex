/**
 * Pricing / quota constants.
 *
 * UNIT CONTRACT: PageX measures data in DECIMAL gigabytes — 1 GB = 1_000_000_000
 * bytes (not 1024^3). All quota math must use `BYTES_PER_GB`.
 *
 * BILLING CONTRACT: only bandwidth is metered. Request counts are UNLIMITED on
 * every plan and are never billed or quota-checked (the legacy `pages.request`
 * and `pages.request_limit` columns are intentionally ignored).
 */

/** Decimal gigabyte: 1 GB = 10^9 bytes. */
export const BYTES_PER_GB = 1_000_000_000

export type PlanId = 'free' | 'paid'

export interface PlanQuota {
    id: PlanId
    name: string
    /** Monthly bandwidth allowance in bytes; `null` means unlimited. */
    bandwidthLimitBytes: number | null
}

/** Plan catalogue — the single source of truth for bandwidth limits. */
export const PLANS: Record<PlanId, PlanQuota> = {
    free: { id: 'free', name: 'Free', bandwidthLimitBytes: 100 * BYTES_PER_GB },
    paid: { id: 'paid', name: 'Paid', bandwidthLimitBytes: 500 * BYTES_PER_GB },
}

export const DEFAULT_PLAN: PlanId = 'free'

export function isPlanId(value: unknown): value is PlanId {
    return value === 'free' || value === 'paid'
}

/**
 * Resolve a plan string (e.g. `pages.plan`) to its quota definition.
 * Unknown/missing values fall back to the Free plan rather than failing open to
 * unlimited bandwidth.
 */
export function getPlan(plan: string | null | undefined): PlanQuota {
    return isPlanId(plan) ? PLANS[plan] : PLANS[DEFAULT_PLAN]
}
