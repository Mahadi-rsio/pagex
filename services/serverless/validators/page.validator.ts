import { z } from 'zod'

export const createPageSchema = z.object({
    project_name: z.string().min(3),
})

export type CreatePageInput = z.infer<typeof createPageSchema>
