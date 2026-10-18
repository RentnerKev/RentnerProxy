import { describe, expect, mock, spyOn, test } from 'bun:test'
import { extendSmokeContext } from '../../../../../../scripts/smoke/context.ts'
import { verifyApplianceProxyTraffic } from '../../../../../../.github/scripts/ci/appliance/proxy-traffic.ts'
import { verifyCertificateSetup } from '../../../../../../scripts/smoke/certificates/setup.ts'
import type { ApplianceProxyTrafficContext } from '../../../../../../.github/scripts/ci/appliance/Types/scenarios.types.ts'
import type { CertificateSetupContext } from '../../../../../../scripts/smoke/certificates/Types/scenarios.types.ts'

describe('smoke scenario context', () => {
    test('creates the appliance backend before requiring its initialized state', async () => {
        const stop = new Error('stop before Docker execution')
        const command = mock(async () => {
            throw stop
        })
        const context: Pick<
            ApplianceProxyTrafficContext,
            'runId' | 'availableLoopbackPort' | 'backend' | 'command'
        > = {
            runId: 'fixture-run',
            availableLoopbackPort: async () => 0,
            backend: undefined,
            command,
        }
        try {
            await expect(
                verifyApplianceProxyTraffic(context as ApplianceProxyTrafficContext),
            ).rejects.toBe(stop)
            expect(command).toHaveBeenCalledTimes(1)
            expect(context.backend).toBeDefined()
            const response = await fetch('http://127.0.0.1:' + context.backend!.port)
            expect(await response.text()).toBe('appliance-real-traffic-fixture-run')
        } finally {
            context.backend?.stop(true)
        }
    })

    test('certificate setup accepts initially absent DNS and backend resources', async () => {
        const stop = new Error('stop before Docker execution')
        const command = mock(async () => {
            throw stop
        })
        const context: Pick<CertificateSetupContext, 'dnsFixture' | 'backend' | 'command'> = {
            dnsFixture: undefined,
            backend: undefined,
            command,
        }
        await expect(verifyCertificateSetup(context as CertificateSetupContext)).rejects.toBe(stop)
        expect(command).toHaveBeenCalledWith([
            'docker',
            'version',
            '--format',
            '{{.Server.Version}}',
        ])
    })

    test('keeps mutable resource ownership connected to captured helper state', () => {
        let container = 'initial'
        const resource = {
            get container() {
                return container
            },
            set container(value: string) {
                container = value
            },
            currentContainer: () => container,
        }
        const lifecycle = { cleanup: () => container }
        const context = extendSmokeContext(lifecycle, resource)
        expect(context === lifecycle).toBe(true)
        context.container = 'recreated'
        expect(context.currentContainer()).toBe('recreated')
        expect(lifecycle.cleanup()).toBe('recreated')
        extendSmokeContext(context, { revision: 'restored' })
        context.container = 'restored'
        expect(context.currentContainer()).toBe('restored')
        expect(Object.getOwnPropertyDescriptor(context, 'container')?.set).toBeDefined()
    })

    test('entrypoint imports do not create processes or services', async () => {
        const spawn = spyOn(Bun, 'spawn').mockImplementation(() => {
            throw new Error('unexpected smoke process')
        })
        const serve = spyOn(Bun, 'serve').mockImplementation(() => {
            throw new Error('unexpected smoke server')
        })
        try {
            await import('../../../../../../scripts/smoke/certificates/run.ts')
            await import('../../../../../../.github/scripts/ci/appliance-compose-smoke.ts')
            expect(spawn).not.toHaveBeenCalled()
            expect(serve).not.toHaveBeenCalled()
        } finally {
            spawn.mockRestore()
            serve.mockRestore()
        }
    })
})
