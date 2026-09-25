import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getRequestListener } from '@hono/node-server'
import app from '../app.js'

const listener = getRequestListener(app.fetch)

export default async function handler(req: VercelRequest, res: VercelResponse) {
    await listener(req, res)
}