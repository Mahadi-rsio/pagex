/**
 * Backfill immutable deployment manifests for existing deployments missing manifest_key.
 * Also warms Redis active_deployment + manifest caches for active deployments.
 *
 *   npx tsx scripts/backfill-deployment-manifests.ts
 */
import 'dotenv/config'
import { eq, isNull } from 'drizzle-orm'
import { db } from '../infrastructure/db/db.js'
import { deployments } from '../infrastructure/db/schema.js'
import {
    cacheManifestInRedis,
    generateAndPersistManifest,
    setActiveDeploymentCache,
} from '../services/manifest.service.js'

async function main(): Promise<void> {
    const rows = await db
        .select({ id: deployments.id, siteId: deployments.site_id, isActive: deployments.is_active })
        .from(deployments)
        .where(isNull(deployments.manifestKey))

    console.log(`Found ${rows.length} deployment(s) without manifest`)

    for (const row of rows) {
        const result = await generateAndPersistManifest(row.id)
        await cacheManifestInRedis(row.id, result.manifest)
        if (row.isActive) {
            await setActiveDeploymentCache(row.siteId, row.id)
        }
        console.log(`✅ manifest for ${row.id} (${result.manifestKey})`)
    }

    console.log('Backfill complete')
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
