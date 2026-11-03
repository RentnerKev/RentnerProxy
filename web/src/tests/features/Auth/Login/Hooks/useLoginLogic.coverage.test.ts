import { expect, mock, test } from 'bun:test'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'
const login = mock(async (_input: unknown): Promise<never> => {
    throw new Error('offline')
})
const begin = mock(async () => ({ success: true, challengeId: 'challenge', options: {} }))
const finish = mock(async (_input: unknown): Promise<never> => {
    throw new Error('verification offline')
})
const error = mock(() => {})
const navigate = mock(async () => {})
const invalidate = mock(async () => {})
mock.module('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    useRouter: () => ({ invalidate }),
    useSearch: () => ({}),
}))
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module('@rentnerkev/toasts', () => ({ toast: { error } }))
mock.module('@simplewebauthn/browser', () => ({
    startAuthentication: mock(async () => ({ id: 'assertion' })),
}))
mock.module('@/features/Auth/Login/middleware.ts', () => ({
    loginHandler: login,
    beginPasskeyLoginHandler: begin,
    finishPasskeyLoginHandler: finish,
}))
mock.module('@/features/Auth/Oidc/middleware.ts', () => ({
    getPublicOidcProvidersHandler: mock(async () => []),
}))
const { default: useLoginLogic } = await import('@/features/Auth/Login/Hooks/useLoginLogic.ts')

test('unavailable local and passkey authentication never navigate or invalidate an unauthenticated session', async () => {
    const hook = await mountHook(useLoginLogic)
    try {
        await hook.run(() => {
            hook.value.form.setFieldValue('email', 'fixture@example.com')
            hook.value.form.setFieldValue('password', 'fixture-password')
        })
        await hook.run(() => hook.value.form.handleSubmit())
        expect(login).toHaveBeenCalledWith({
            data: { email: 'fixture@example.com', password: 'fixture-password' },
        })
        await hook.run(() => hook.value.handler.handlePasskeyLogin())
        expect(finish).toHaveBeenCalledWith({
            data: { challengeId: 'challenge', response: { id: 'assertion' } },
        })
        expect(error).toHaveBeenCalledTimes(2)
        expect(navigate).not.toHaveBeenCalled()
        expect(invalidate).not.toHaveBeenCalled()
        expect(hook.value.state.isPending).toBe(false)
        expect(hook.value.state.isPasskeyPending).toBe(false)
    } finally {
        await hook.dispose()
    }
})
