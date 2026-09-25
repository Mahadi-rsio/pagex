import {
    commitDeploySchema,
    prepareDeploySchema,
    presignDeploySchema,
} from '../validators/deploy.validator.js'
import { commitDeploy, prepareDeploy, presignDeploy } from '../services/deploy.service.js'
import { readJson, respondError, tenantId, type AppContext } from '../utils/http.js'

export async function prepareDeployHandler(c: AppContext) {
    const body = await readJson(c)
    const validate = prepareDeploySchema.safeParse(body)
    if (!validate.success) {
        return c.json({ error: validate.error.format() }, 400)
    }

    const tenant = tenantId(c)
    if (!tenant) return c.json({ error: 'Unauthorized' }, 401)

    try {
        const result = await prepareDeploy(validate.data, tenant)
        return c.json(result, 200)
    } catch (err: unknown) {
        console.error('Prepare deploy failed:', err)
        return respondError(c, err)
    }
}

export async function presignDeployHandler(c: AppContext) {
    const body = await readJson(c)
    const validate = presignDeploySchema.safeParse(body)
    if (!validate.success) {
        return c.json({ error: validate.error.format() }, 400)
    }

    const tenant = tenantId(c)
    if (!tenant) return c.json({ error: 'Unauthorized' }, 401)

    try {
        const result = await presignDeploy(validate.data, tenant)
        return c.json(result, 200)
    } catch (err: unknown) {
        console.error('Presign deploy failed:', err)
        return respondError(c, err)
    }
}

export async function commitDeployHandler(c: AppContext) {
    const body = await readJson(c)
    const validate = commitDeploySchema.safeParse(body)
    if (!validate.success) {
        return c.json({ error: validate.error.format() }, 400)
    }

    const tenant = tenantId(c)
    if (!tenant) return c.json({ error: 'Unauthorized' }, 401)

    try {
        const result = await commitDeploy(validate.data, tenant)
        return c.json(result, 200)
    } catch (err: unknown) {
        console.error('Commit deploy failed:', err)
        return respondError(c, err)
    }
}