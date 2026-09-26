import { redis, redisKey } from "./redis";

/**
 * Tenant routing contract shared with the blob-server's `static_s3` plugin.
 *
 *   site:subdomain:<subdomain>  → site_id               (no TTL; immutable)
 *   site:<site_id>:active       → active_deployment_id  (1h safety TTL)
 *
 * PostgreSQL is authoritative. These keys are a durable distributed lookup
 * layer so the blob-server can resolve a request without a Postgres round-trip
 * on every hit. Writers MUST run after the matching PostgreSQL operation has
 * committed, and MUST NOT throw — a Redis outage must never fail a control-plane
 * request or leave Postgres inconsistent (the blob-server falls back to
 * Postgres and backfills Redis on the next miss).
 *
 * The `site:*` key names must stay byte-for-byte identical to the constants in
 * `services/blob-server/src/routing.go`.
 */

/** Redis TTL for `site:<site_id>:active`. A short-lived safety fallback: if the
 * mapping expires, the blob-server rebuilds it from PostgreSQL. */
export const ACTIVE_DEPLOYMENT_ROUTING_TTL_SECONDS = 60 * 60;

/** Subdomain → site_id. Immutable for the life of a project. */
export function subdomainMappingKey(subdomain: string): string {
    return `site:subdomain:${subdomain}`;
}

/** site_id → active deployment id. Updated on deploy/rollback only. */
export function activeDeploymentMappingKey(siteId: string): string {
    return `site:${siteId}:active`;
}

/** Minimal Redis surface the routing writer needs (Upstash-compatible). */
export interface RoutingClient {
    set(key: string, value: string, opts?: { ex: number }): Promise<unknown>;
    del(...keys: string[]): Promise<unknown>;
}

export interface RoutingWriter {
    /** Persist subdomain → site_id after the site row is created. */
    setSubdomainMapping(subdomain: string, siteId: string): Promise<void>;
    /** Remove subdomain → site_id when a project is permanently deleted. */
    deleteSubdomainMapping(subdomain: string): Promise<void>;
    /** Point site_id at its new active deployment after deploy/rollback. */
    setActiveDeploymentMapping(
        siteId: string,
        deploymentId: string,
    ): Promise<void>;
}

function warn(op: string, key: string, err: unknown): void {
    console.error(
        `[routing] redis ${op} failed for "${key}"; PostgreSQL remains authoritative`,
        err,
    );
}

/**
 * Build a routing writer over any Redis-like client. Extracted for tests; the
 * application uses the singleton `routingWriter` below.
 */
export function createRoutingWriter(client: RoutingClient): RoutingWriter {
    return {
        async setSubdomainMapping(subdomain, siteId) {
            const key = redisKey(subdomainMappingKey(subdomain));
            try {
                await client.set(key, siteId);
            } catch (err) {
                warn("set", key, err);
            }
        },
        async deleteSubdomainMapping(subdomain) {
            const key = redisKey(subdomainMappingKey(subdomain));
            try {
                await client.del(key);
            } catch (err) {
                warn("del", key, err);
            }
        },
        async setActiveDeploymentMapping(siteId, deploymentId) {
            const key = redisKey(activeDeploymentMappingKey(siteId));
            try {
                await client.set(key, deploymentId, {
                    ex: ACTIVE_DEPLOYMENT_ROUTING_TTL_SECONDS,
                });
            } catch (err) {
                warn("set", key, err);
            }
        },
    };
}

export const routingWriter = createRoutingWriter(
    redis as unknown as RoutingClient,
);
