import { afterEach, beforeAll, expect, mock, spyOn } from 'bun:test'
import { createServerEntry } from '@tanstack/react-start/server-entry'
import { eq } from 'drizzle-orm'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { users } from '@/db/schema.ts'
import {
    getProfileImageAssetService,
    updateCurrentProfileImageService,
} from '@/server/Auth/Account/profile-image.service.ts'
import * as processor from '@/server/Auth/Account/profile-image-processing.server.ts'
import { getApplicationRevision } from '@/server/WebSockets/applicationChanges.ts'
import {
    asBackendActor,
    backendCoverageEnabled,
    cleanupBackendCoverage,
    createBackendActor,
    database,
    initializeBackendRegistry,
    integrationTest,
} from '@/tests/Helpers/backendCoverageFixture.ts'
beforeAll(async () => {
    if (backendCoverageEnabled) await initializeBackendRegistry()
})
afterEach(async () => {
    mock.restore()
    if (backendCoverageEnabled) await cleanupBackendCoverage()
})
async function image() {
    const bytes = await Bun.file(
        new URL('../../../../../public/rentnerproxy-logo.png', import.meta.url),
    ).bytes()
    return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
}
async function anonymous<T>(operation: () => Promise<T>) {
    let result: { value: T } | { error: unknown } | undefined
    const handler = createServerEntry({
        fetch: async () => {
            try {
                result = { value: await operation() }
            } catch (error) {
                result = { error }
            }
            return new Response(null)
        },
    }).fetch
    await handler(new Request('http://localhost/'), {})
    if (!result) throw new Error('Anonymous request did not run')
    if ('error' in result) throw result.error
    return result.value
}

integrationTest(
    'profile image updates persist bounded WebP bytes, advance versions and restrict cross-user reads',
    async () => {
        const owner = await createBackendActor()
        const viewer = await createBackendActor([])
        const administrator = await createBackendActor([PERMISSIONS.USERS_VIEW])
        expect(await asBackendActor(owner, () => getProfileImageAssetService(owner, 1))).toBeNull()
        const before = getApplicationRevision()
        await asBackendActor(owner, async () => updateCurrentProfileImageService(await image()))
        const [stored] = await database.select().from(users).where(eq(users.id, owner))
        expect(stored?.profileImageVersion).toBe(1)
        expect(stored?.profileImageWebp?.byteLength).toBeGreaterThan(0)
        if (!stored?.profileImageWebp) throw new Error('Normalized profile image missing')
        const metadata = await new Bun.Image(stored.profileImageWebp).metadata()
        expect(metadata).toMatchObject({ format: 'webp', width: 256, height: 256 })
        expect(getApplicationRevision()).not.toBe(before)
        expect(await asBackendActor(owner, () => getProfileImageAssetService(owner, 1))).toEqual({
            bytes: stored.profileImageWebp,
        })
        expect(await asBackendActor(viewer, () => getProfileImageAssetService(owner, 1))).toBeNull()
        expect(
            await asBackendActor(administrator, () => getProfileImageAssetService(owner, 1)),
        ).toEqual({ bytes: stored.profileImageWebp })
        expect(await asBackendActor(owner, () => getProfileImageAssetService(owner, 2))).toBeNull()
        expect(await anonymous(() => getProfileImageAssetService(owner, 1))).toBeNull()
        expect(await getProfileImageAssetService('invalid', 1)).toBeNull()
        expect(await getProfileImageAssetService(owner, 0)).toBeNull()
        expect(await getProfileImageAssetService(owner, 1.5)).toBeNull()
    },
)

integrationTest(
    'profile updates reject unauthenticated or revoked actors before any image write',
    async () => {
        await expect(
            anonymous(() => updateCurrentProfileImageService('invalid')),
        ).rejects.toMatchObject({ code: 'authentication_required' })
        const viewer = await createBackendActor([])
        await expect(
            asBackendActor(viewer, () => updateCurrentProfileImageService('invalid')),
        ).rejects.toMatchObject({ code: 'permission_denied' })
        const owner = await createBackendActor()
        spyOn(processor, 'createNormalizedProfileImageWebp').mockImplementation(async () => {
            await database.update(users).set({ status: 'disabled' }).where(eq(users.id, owner))
            return new Uint8Array([1, 2, 3])
        })
        await expect(
            asBackendActor(owner, () => updateCurrentProfileImageService('fixture-encoding')),
        ).rejects.toMatchObject({ code: 'authentication_required' })
        const [stored] = await database.select().from(users).where(eq(users.id, owner))
        expect(stored?.profileImageVersion).toBe(0)
        expect(stored?.profileImageWebp).toBeNull()
    },
)
