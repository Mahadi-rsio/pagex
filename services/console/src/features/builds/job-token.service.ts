import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { BUILD_JOB_TOKEN_PREFIX } from "@/server/api/constants";

/**
 * Build job tokens — the short-lived credential a Fly machine uses to call the
 * deploy endpoints on behalf of a single build.
 *
 * Format: `pxb.<buildId>.<secret>`. Only SHA-256(secret) is stored, and the
 * comparison is constant-time. A token is useless once the build reaches a
 * terminal status, once it is superseded, or once it expires, so a leaked token
 * cannot be replayed to deploy arbitrary content; combined with the deploy
 * routes' `pageId` scoping, it can only ever touch its own project.
 *
 * These are NOT user sessions: the machine never receives a Better Auth cookie
 * or JWT, and project build scripts never see the token (it is only handed to
 * the deploy step after the build has finished).
 */

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_RE = /^[a-f0-9]{32,128}$/;

export interface JobTokenParts {
    buildId: string;
    secret: string;
}

export function hashJobSecret(secret: string): string {
    return createHash("sha256").update(secret).digest("hex");
}

export function generateJobSecret(): string {
    return randomBytes(24).toString("hex");
}

export function formatJobToken(buildId: string, secret: string): string {
    return `${BUILD_JOB_TOKEN_PREFIX}.${buildId}.${secret}`;
}

/** True when a bearer token is (syntactically) a build job token, not a JWT. */
export function isBuildJobToken(token: string): boolean {
    return token.startsWith(`${BUILD_JOB_TOKEN_PREFIX}.`);
}

export function parseJobToken(token: string): JobTokenParts | null {
    if (!isBuildJobToken(token)) return null;
    const rest = token.slice(BUILD_JOB_TOKEN_PREFIX.length + 1);
    const dot = rest.indexOf(".");
    if (dot <= 0) return null;
    const buildId = rest.slice(0, dot);
    const secret = rest.slice(dot + 1);
    if (!UUID_RE.test(buildId)) return null;
    if (!SECRET_RE.test(secret)) return null;
    return { buildId, secret };
}

/** Constant-time comparison of a presented secret against the stored hash. */
export function verifyJobSecret(secret: string, storedHash: string): boolean {
    const computed = hashJobSecret(secret);
    const a = Buffer.from(computed, "hex");
    const b = Buffer.from(storedHash, "hex");
    if (a.length === 0 || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

export interface JobTokenRecord {
    token_hash: string | null;
    token_expires_at: Date | null;
    status: string;
}

/** A token is only valid while the job is active and unexpired. */
export function isJobTokenActive(
    record: JobTokenRecord,
    now: Date = new Date(),
): boolean {
    if (!record.token_hash) return false;
    if (record.status !== "active") return false;
    if (!record.token_expires_at) return false;
    return record.token_expires_at.getTime() > now.getTime();
}

/**
 * Full verification: parse the token, confirm it matches the record, and that
 * the job is still active. Returns the build id on success.
 */
export function verifyJobTokenAgainstRecord(
    token: string,
    record: JobTokenRecord | null,
    now: Date = new Date(),
): string | null {
    const parts = parseJobToken(token);
    if (!parts || !record) return null;
    if (!isJobTokenActive(record, now)) return null;
    if (!record.token_hash) return null;
    if (!verifyJobSecret(parts.secret, record.token_hash)) return null;
    return parts.buildId;
}
