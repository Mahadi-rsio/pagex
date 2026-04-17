import { z } from 'zod'

export const createPageSchema = z.object({
    tenant_name: z.string().min(1),
    plan: z.string().min(1),
    project_name: z.string().min(1)
})

export type CreatePageInput = z.infer<typeof createPageSchema>
