import { afterEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register()
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act, StrictMode } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: useFragmentToken } = await import('../features/Auth/Shared/Hooks/useFragmentToken')

let activeRoot: Root | null = null

function FragmentTokenHarness() {
    const token = useFragmentToken()
    const state = token === undefined ? 'loading' : token === null ? 'missing' : 'present'

    return <output data-state={state}>{token ?? ''}</output>
}

async function renderFragment(fragment: string): Promise<HTMLOutputElement> {
    window.history.replaceState(null, '', `about:blank${fragment}`)
    const container = document.createElement('div')
    document.body.append(container)
    activeRoot = createRoot(container)

    await act(async () => {
        activeRoot?.render(
            <StrictMode>
                <FragmentTokenHarness />
            </StrictMode>,
        )
        await Promise.resolve()
        await Promise.resolve()
        await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const output = container.querySelector('output')

    if (!output) {
        throw new Error('Fragment token test harness did not render.')
    }

    return output
}

afterEach(async () => {
    await act(async () => {
        activeRoot?.unmount()
    })
    activeRoot = null
    document.body.replaceChildren()
    window.location.hash = ''
})

describe('secure auth fragment tokens', () => {
    test('keeps a captured token through the React StrictMode effect replay', async () => {
        const output = await renderFragment('#token=synthetic-reset-token')

        expect(output.dataset.state).toBe('present')
        expect(output.textContent).toBe('synthetic-reset-token')
        expect(window.location.hash).toBe('')
    })

    test('decodes and trims a captured token', async () => {
        const output = await renderFragment('#token=%20synthetic-reset-token%20')

        expect(output.dataset.state).toBe('present')
        expect(output.textContent).toBe('synthetic-reset-token')
        expect(window.location.hash).toBe('')
    })

    test('marks a fragment without a token as missing', async () => {
        const output = await renderFragment('#purpose=password-reset')

        expect(output.dataset.state).toBe('missing')
        expect(output.textContent).toBe('')
        expect(window.location.hash).toBe('')
    })

    test('captures a replacement token on the already mounted reset route', async () => {
        const output = await renderFragment('#token=first-reset-token')

        await act(async () => {
            window.history.replaceState(null, '', 'about:blank#token=second-reset-token')
            window.dispatchEvent(
                new HashChangeEvent('hashchange', { newURL: window.location.href }),
            )
            await Promise.resolve()
            await Promise.resolve()
            await new Promise((resolve) => setTimeout(resolve, 0))
        })

        expect(output.dataset.state).toBe('present')
        expect(output.textContent).toBe('second-reset-token')
        expect(window.location.hash).toBe('')
    })
})
