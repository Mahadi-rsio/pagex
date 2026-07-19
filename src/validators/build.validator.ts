import { z } from 'zod'

export const triggerBuildSchema = z.object({
    pageId: z.string().uuid(),
    repoUrl: z.string().url(),
    gitProvider: z.enum(['github', 'gitlab']),
    gitToken: z.string(),
    framework: z.string(),
    buildCommand: z.string().optional(),
    outputDir: z.string().optional().nullable(),
    envVars: z.record(z.string(), z.string()).optional(),
})

export type TriggerBuildInput = z.infer<typeof triggerBuildSchema>
