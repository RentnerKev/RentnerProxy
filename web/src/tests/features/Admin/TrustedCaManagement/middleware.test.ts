import { expect, mock, test } from 'bun:test'

const validators: Array<(input: unknown) => Promise<unknown>> = []
const permission = mock(async (_permission: string) => {
    throw new Error('authentication_required')
})
mock.module('@tanstack/react-start', () => ({
    createServerFn: () => {
        const builder = {
            validator: (validator: (input: unknown) => Promise<unknown>) => {
                validators.push(validator)
                return builder
            },
            handler: (handler: unknown) => handler,
        }
        return builder
    },
}))
mock.module('@/server/Auth/Access/authorization.service.ts', () => ({
    requirePermissionService: permission,
}))
mock.module('@/server/Admin/TrustedCaManagement/trusted-cas.service.ts', () => ({
    createTrustedCaService: mock(),
    deleteTrustedCaService: mock(),
    getAssignableTrustedCasService: mock(),
    getTrustedCasService: mock(),
    replaceTrustedCaService: mock(),
}))
await import('@/features/Admin/TrustedCaManagement/middleware.ts')

test.each([0, 1])(
    'authenticates CA mutation %s before reading or validating PEM',
    async (index) => {
        let pemReads = 0
        const input = {
            name: 'Untrusted',
            get pem() {
                pemReads += 1
                throw new Error('PEM read before auth')
            },
        }
        await expect(validators[index]!(input)).rejects.toThrow('authentication_required')
        expect(pemReads).toBe(0)
    },
)
