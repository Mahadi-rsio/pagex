import type { Request, Response } from 'express'
import {
    commitDeploySchema,
    prepareDeploySchema,
    presignDeploySchema,
} from '../validators/deploy.validator.js'
import { commitDeploy, prepareDeploy, presignDeploy } from '../services/deploy.service.js'
import { HttpError } from '../utils/http-error.js'

function tenantIdFrom(req: Request): string | undefined {
    return (req as Request & { id?: string }).id
}

function errorStatus(err: unknown): number {
    if (err instanceof HttpError) return err.status
    if (err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
        return (err as { status: number }).status
    }
    return 500
}

function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message
    return 'Internal Server Error'
}

export async function prepareDeployHandler(req: Request, res: Response) {
    const validate = prepareDeploySchema.safeParse(req.body)
    if (!validate.success) {
        return res.status(400).json({ error: validate.error.format() })
    }

    const tenantId = tenantIdFrom(req)
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' })

    try {
        const result = await prepareDeploy(validate.data, tenantId)
        return res.status(200).json(result)
    } catch (err: unknown) {
        console.error('Prepare deploy failed:', err)
        return res.status(errorStatus(err)).json({ error: errorMessage(err) })
    }
}

export async function presignDeployHandler(req: Request, res: Response) {
    const validate = presignDeploySchema.safeParse(req.body)
    if (!validate.success) {
        return res.status(400).json({ error: validate.error.format() })
    }

    const tenantId = tenantIdFrom(req)
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' })

    try {
        const result = await presignDeploy(validate.data, tenantId)
        return res.status(200).json(result)
    } catch (err: unknown) {
        console.error('Presign deploy failed:', err)
        return res.status(errorStatus(err)).json({ error: errorMessage(err) })
    }
}

export async function commitDeployHandler(req: Request, res: Response) {
    const validate = commitDeploySchema.safeParse(req.body)
    if (!validate.success) {
        return res.status(400).json({ error: validate.error.format() })
    }

    const tenantId = tenantIdFrom(req)
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' })

    try {
        const result = await commitDeploy(validate.data, tenantId)
        return res.status(200).json(result)
    } catch (err: unknown) {
        console.error('Commit deploy failed:', err)
        return res.status(errorStatus(err)).json({ error: errorMessage(err) })
    }
}
