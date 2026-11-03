import { afterEach, beforeAll, beforeEach, expect, mock, spyOn } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { auditEvents, hostDomains, proxyHosts, redirectHosts, systemSettings } from '@/db/schema.ts'
import * as controller from '@/server/Controller/proxy.server.ts'
import * as runtime from '@/server/ProxyRuntime/proxy-runtime.service.ts'
import { readProxyRuntimeSnapshot } from '@/server/ProxyRuntime/proxy-runtime-data.ts'
import { PROXY_RUNTIME_SETTINGS_KEY } from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import {
    getProxyConfigEditorService,
    resetProxyConfigEditorService,
    saveProxyConfigEditorService,
} from '@/server/ProxyRuntime/proxy-config-editor.service.ts'
import {
    asBackendActor,
    backendCoverageEnabled,
    cleanupBackendCoverage,
    createBackendActor,
    database,
    initializeBackendRegistry,
    integrationTest,
} from '@/tests/Helpers/backendCoverageFixture.ts'
const hostIds: string[] = []
let originalSettings: typeof systemSettings.$inferSelect | undefined
beforeAll(async () => {
    if (backendCoverageEnabled) await initializeBackendRegistry()
})
beforeEach(async () => {
    if (backendCoverageEnabled)
        [originalSettings] = await database
            .select()
            .from(systemSettings)
            .where(eq(systemSettings.key, PROXY_RUNTIME_SETTINGS_KEY))
})
afterEach(async () => {
    mock.restore()
    if (!backendCoverageEnabled) return
    if (hostIds.length) {
        await database.delete(proxyHosts).where(inArray(proxyHosts.id, hostIds))
        await database.delete(redirectHosts).where(inArray(redirectHosts.id, hostIds.splice(0)))
    }
    await database.delete(systemSettings).where(eq(systemSettings.key, PROXY_RUNTIME_SETTINGS_KEY))
    if (originalSettings) await database.insert(systemSettings).values(originalSettings)
    await cleanupBackendCoverage()
})
async function seedHosts() {
    const proxy = Bun.randomUUIDv7(),
        redirect = Bun.randomUUIDv7()
    await database.insert(proxyHosts).values({
        id: proxy,
        forwardScheme: 'http',
        forwardHost: '127.0.0.1',
        forwardPort: 8080,
        enabled: true,
    })
    await database.insert(redirectHosts).values({
        id: redirect,
        destination: 'https://destination.example.com',
        statusCode: 308,
        preserveRequestUri: true,
        enabled: true,
    })
    await database.insert(hostDomains).values([
        { proxyHostId: proxy, domain: `proxy-${proxy}.example.test` },
        { redirectHostId: redirect, domain: `redirect-${redirect}.example.test` },
    ])
    hostIds.push(proxy, redirect)
    return { proxy, redirect }
}

integrationTest(
    'global config editor previews defaults for real proxy and redirect hosts and saves/reset settings with durable audit',
    async () => {
        const actor = await createBackendActor()
        const hosts = await seedHosts()
        spyOn(controller, 'getActiveProxyConfiguration').mockResolvedValue({
            config: 'active fixture',
            revision: 'sha256:' + 'a'.repeat(64),
        })
        const preview = spyOn(controller, 'previewProxyConfiguration').mockResolvedValue({
            config: 'default fixture',
            revision: 'sha256:' + 'b'.repeat(64),
        })
        const reconcile = spyOn(runtime, 'reconcileProxyConfigurationWithAudit').mockResolvedValue(
            'applied',
        )
        const editor = await asBackendActor(actor, getProxyConfigEditorService)
        expect(editor.active?.config).toBe('active fixture')
        expect(editor.defaults?.config).toBe('default fixture')
        expect(preview).toHaveBeenCalledWith(
            expect.objectContaining({
                proxyHosts: expect.arrayContaining([expect.objectContaining({ id: hosts.proxy })]),
                redirectHosts: expect.arrayContaining([
                    expect.objectContaining({ id: hosts.redirect }),
                ]),
            }),
        )
        expect(
            await asBackendActor(actor, () =>
                saveProxyConfigEditorService({
                    baseRevision: editor.baseRevision,
                    settings: { responseCompression: 'off', proxyReadTimeoutSeconds: 75 },
                }),
            ),
        ).toBe('applied')
        expect(reconcile).toHaveBeenCalledWith(actor)
        const updated = await database.transaction(readProxyRuntimeSnapshot)
        expect(updated.httpSettings).toMatchObject({
            responseCompression: 'off',
            proxyReadTimeoutSeconds: 75,
        })
        expect(updated.revision).not.toBe(editor.baseRevision)
        reconcile.mockResolvedValueOnce('pending')
        expect(
            await asBackendActor(actor, () =>
                resetProxyConfigEditorService({ baseRevision: updated.revision }),
            ),
        ).toBe('pending')
        expect((await database.transaction(readProxyRuntimeSnapshot)).httpSettings).toEqual({})
        const audits = await database
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.actorUserId, actor))
        expect(
            audits
                .filter((event) => event.resource === 'proxy-runtime-settings')
                .map((event) => event.action),
        ).toEqual(['save', 'reset'])
    },
)

integrationTest(
    'stale global editor writes and actors without APPLY cannot change settings or reconcile',
    async () => {
        const owner = await createBackendActor()
        const editor = await createBackendActor([PERMISSIONS.PROXY_HOSTS_UPDATE])
        const reconcile = spyOn(runtime, 'reconcileProxyConfigurationWithAudit').mockResolvedValue(
            'applied',
        )
        const before = await database.transaction(readProxyRuntimeSnapshot)
        await expect(
            asBackendActor(owner, () =>
                saveProxyConfigEditorService({
                    baseRevision: 'sha256:' + '0'.repeat(64),
                    settings: { responseCompression: 'off' },
                }),
            ),
        ).rejects.toMatchObject({ code: 'configuration_conflict' })
        await expect(
            asBackendActor(editor, () =>
                saveProxyConfigEditorService({
                    baseRevision: before.revision,
                    settings: { responseCompression: 'off' },
                }),
            ),
        ).rejects.toMatchObject({ code: 'permission_denied' })
        await expect(
            asBackendActor(owner, () =>
                saveProxyConfigEditorService({
                    baseRevision: before.revision,
                    settings: { proxyReadTimeoutSeconds: 0 },
                }),
            ),
        ).rejects.toThrow()
        expect((await database.transaction(readProxyRuntimeSnapshot)).revision).toBe(
            before.revision,
        )
        expect(reconcile).not.toHaveBeenCalled()
    },
)
