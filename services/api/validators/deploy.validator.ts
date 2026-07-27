import { z } from 'zod'

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/, 'hash must be 64-char lowercase hex SHA256')

const deployFileSchema = z.object({
    path: z.string().min(1).refine(
        (p) => !p.startsWith('/') && !p.includes('..') && !p.includes('\\'),
        'path must be a relative POSIX path without ..'
    ),
    hash: sha256Hex,
    size: z.number().int().positive(),
    magicBytes: z.string().min(1),
})

export const prepareDeploySchema = z.object({
    pageId: z.string().min(1),
    files: z.array(deployFileSchema).min(1).max(10_000),
})

export const presignDeploySchema = z.object({
    deploymentToken: z.string().min(1),
    hashes: z.array(sha256Hex).min(1).max(10_000),
})

export const commitDeploySchema = z.object({
    deploymentToken: z.string().min(1),
})

export type PrepareDeployInput = z.infer<typeof prepareDeploySchema>
export type PresignDeployInput = z.infer<typeof presignDeploySchema>
export type CommitDeployInput = z.infer<typeof commitDeploySchema>
export type DeployFileInput = z.infer<typeof deployFileSchema>
