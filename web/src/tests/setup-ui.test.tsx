import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register()
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act, createElement, useEffect } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')

const setupOwnerHandlerMock = mock(async (_input: unknown) => ({
    success: true,
    message: 'setup complete',
}))
const navigateMock = mock(async () => {})
const invalidateMock = mock(async () => {})
const toastErrorMock = mock((_message: string) => {})

mock.module('../features/Auth/Setup/server', () => ({
    setupOwnerHandler: setupOwnerHandlerMock,
}))
mock.module('@tanstack/react-router', () => ({
    useNavigate: () => navigateMock,
    useRouter: () => ({ invalidate: invalidateMock }),
    useRouterState: () => undefined,
}))
mock.module('../shared/Toast/Hooks/useToast', () => ({
    default: () => ({ error: toastErrorMock }),
}))

const useSetupLogic = (await import('../features/Auth/Setup/Hooks/useSetupLogic')).default
const SetupForm = (await import('../features/Auth/Setup/Components/SetupForm')).default
const { TooltipProvider } = await import('../shared/Tooltip')
type SetupState = ReturnType<typeof useSetupLogic>['state']

let activeRoot: Root | null = null
let activeQueryClient: InstanceType<typeof QueryClient> | null = null
function SetupHarness({ onReady }: { readonly onReady: (state: SetupState) => void }) {
    const state = useSetupLogic().state

    useEffect(() => {
        onReady(state)
    }, [onReady, state])

    return createElement(TooltipProvider, null, createElement(SetupForm, { state }))
}

async function renderSetup(): Promise<SetupState> {
    const container = document.createElement('div')
    document.body.append(container)
    activeRoot = createRoot(container)
    activeQueryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false },
        },
    })

    let resolveState!: (state: SetupState) => void
    const ready = new Promise<SetupState>((resolve) => {
        resolveState = resolve
    })

    await act(async () => {
        activeRoot?.render(
            createElement(
                QueryClientProvider,
                { client: activeQueryClient! },
                createElement(SetupHarness, { onReady: resolveState }),
            ),
        )
        await Promise.resolve()
    })

    return await ready
}

async function waitForCallCount(count: number): Promise<void> {
    const deadline = Date.now() + 1500

    while (setupOwnerHandlerMock.mock.calls.length < count && Date.now() < deadline) {
        // oxlint-disable-next-line no-await-in-loop -- Polling lets the form finish async validation.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
    }
}

async function fillValidSetup(state: SetupState): Promise<void> {
    state.form.setFieldValue('displayName', 'First Owner')
    state.form.setFieldValue('email', 'owner@example.com')
    state.form.setFieldValue('password', 'a secure phrase')
    state.form.setFieldValue('confirmPassword', 'a secure phrase')
    await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
    setupOwnerHandlerMock.mockReset()
    setupOwnerHandlerMock.mockResolvedValue({ success: true, message: 'setup complete' })
    navigateMock.mockReset()
    invalidateMock.mockReset()
    toastErrorMock.mockReset()
})

afterEach(async () => {
    await act(async () => {
        activeRoot?.unmount()
    })
    activeRoot = null
    activeQueryClient?.clear()
    activeQueryClient = null
    document.body.replaceChildren()
})

describe('first-owner setup submission', () => {
    test('does not render or submit a deployment origin field', async () => {
        const state = await renderSetup()

        expect(document.querySelector('input[name="managementOrigin"]')).toBeNull()

        await act(async () => {
            await fillValidSetup(state)
            await state.form.handleSubmit()
            await new Promise((resolve) => setTimeout(resolve, 0))
        })

        expect(setupOwnerHandlerMock).toHaveBeenCalledTimes(1)
        expect(setupOwnerHandlerMock).toHaveBeenCalledWith({
            data: {
                displayName: 'First Owner',
                email: 'owner@example.com',
                password: 'a secure phrase',
                confirmPassword: 'a secure phrase',
            },
        })
    })

    test('does not send duplicate requests while the first submission is in flight', async () => {
        const state = await renderSetup()
        await act(async () => {
            await fillValidSetup(state)
        })

        let release!: (result: { success: true; message: string }) => void
        setupOwnerHandlerMock.mockImplementation(
            () =>
                new Promise((resolve) => {
                    release = resolve
                }),
        )

        let firstSubmit: Promise<void> | undefined
        let secondSubmit: Promise<void> | undefined
        await act(async () => {
            firstSubmit = state.form.handleSubmit()
            secondSubmit = state.form.handleSubmit()
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
        await waitForCallCount(1)

        expect(setupOwnerHandlerMock).toHaveBeenCalledTimes(1)

        await act(async () => {
            release({ success: true, message: 'setup complete' })
            await Promise.all([firstSubmit, secondSubmit])
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
    })

    test('clears the in-flight guard after failure so a retry can submit', async () => {
        const state = await renderSetup()
        await act(async () => {
            await fillValidSetup(state)
        })

        let rejectFirst!: (reason?: unknown) => void
        setupOwnerHandlerMock.mockImplementationOnce(
            () =>
                new Promise((_resolve, reject) => {
                    rejectFirst = reject
                }),
        )

        let firstSubmit: Promise<void> | undefined
        let secondSubmit: Promise<void> | undefined
        await act(async () => {
            firstSubmit = state.form.handleSubmit()
            secondSubmit = state.form.handleSubmit()
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
        await waitForCallCount(1)
        expect(setupOwnerHandlerMock).toHaveBeenCalledTimes(1)

        await act(async () => {
            rejectFirst(new Error('transport failure'))
            await Promise.all([firstSubmit, secondSubmit])
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
        expect(toastErrorMock).toHaveBeenCalledTimes(1)

        setupOwnerHandlerMock.mockResolvedValueOnce({ success: true, message: 'setup complete' })
        await act(async () => {
            await state.form.handleSubmit()
            await new Promise((resolve) => setTimeout(resolve, 0))
        })

        expect(setupOwnerHandlerMock).toHaveBeenCalledTimes(2)
    })
})
