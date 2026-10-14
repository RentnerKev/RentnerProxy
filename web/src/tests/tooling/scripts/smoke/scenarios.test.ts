import { describe, expect, spyOn, test } from 'bun:test'
import { extendSmokeContext as extendApplianceContext } from '../../../../../../.github/scripts/ci/appliance/context.ts'
import { extendSmokeContext as extendCertificateContext } from '../../../../../../scripts/smoke/certificates/context.ts'

describe('smoke scenario context', () => {
    for (const extend of [extendApplianceContext, extendCertificateContext]) {
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
            const context = extend(lifecycle, resource)
            expect(context === lifecycle).toBe(true)
            context.container = 'recreated'
            expect(context.currentContainer()).toBe('recreated')
            expect(lifecycle.cleanup()).toBe('recreated')
            extend(context, { revision: 'restored' })
            context.container = 'restored'
            expect(context.currentContainer()).toBe('restored')
            expect(Object.getOwnPropertyDescriptor(context, 'container')?.set).toBeDefined()
        })
    }

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
