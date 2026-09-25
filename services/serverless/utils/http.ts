import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { HttpError } from './http-error.js'
import type { AppEnv } from '../types.js'

export type AppContext = Context<AppEnv>

const KNOWN_STATUS: ReadonlySet<ContentfulStatusCode> = new Set([
    400, 401, 402, 403, 404, 405, 409, 413, 415, 422, 429, 500, 502, 503, 504,
])

function asStatus(status: number): ContentfulStatusCode {
    if (KNOWN_STATUS.has(status as ContentfulStatusCode)) return status as ContentfulStatusCode
    return 500
}

export function tenantId(c: AppContext): string | undefined {
    const id = c.get('id')
    return typeof id === 'string' && id.length > 0 ? id : undefined
}

export async function readJson(c: AppContext): Promise<unknown> {
    try {
        return await c.req.json()
    } catch {
        return undefined
    }
}

export function errorStatus(err: unknown): ContentfulStatusCode {
    if (err instanceof HttpError) return asStatus(err.status)
    if (
        err &&
        typeof err === 'object' &&
        'status' in err &&
        typeof (err as { status: unknown }).status === 'number'
    ) {
        return asStatus((err as { status: number }).status)
    }
    return 500
}

export function errorMessage(err: unknown): string {
    if (err instanceof Error && err.message) return err.message
    if (
        err &&
        typeof err === 'object' &&
        'message' in err &&
        typeof (err as { message: unknown }).message === 'string'
    ) {
        return (err as { message: string }).message
    }
    return 'Internal Server Error'
}

export function respondError(c: AppContext, err: unknown) {
    return c.json({ error: errorMessage(err) }, errorStatus(err))
}