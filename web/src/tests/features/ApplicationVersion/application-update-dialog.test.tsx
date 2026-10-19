import { afterEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import withTestLanguage, { withLanguageRoot } from '@/tests/Helpers/withTestLanguage.tsx'
import type { ApplicationUpdateResult } from '@/features/ApplicationVersion/Types/application-update.types.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: ApplicationUpdateDialog } =
    await import('@/features/ApplicationVersion/Components/ApplicationUpdateDialog.tsx')
let root: Root | null = null

const result: ApplicationUpdateResult = {
    status: 'available',
    checkedAt: null,
    currentChannel: 'beta',
    latest: {
        version: '1.0.0-beta.2',
        tag: 'v1.0.0-beta.2',
        channel: 'beta',
        url: 'https://github.com/RentnerKev/RentnerProxy/releases/tag/v1.0.0-beta.2',
        notes: '<img src=x onerror=alert(1)> **Release**',
        image: {
            status: 'verified',
            reference: `ghcr.io/rentnerkev/rentnerproxy@sha256:${'a'.repeat(64)}`,
            digest: `sha256:${'a'.repeat(64)}`,
            platform: 'linux/amd64',
        },
        compatibility: {
            status: 'supported',
            minimumVersion: 'v1.0.0-beta.1',
            intermediateVersion: null,
        },
    },
}

async function render(data: ApplicationUpdateResult | undefined) {
    if (!root) {
        const container = document.createElement('div')
        document.body.append(container)
        root = withLanguageRoot(createRoot(container))
    }
    await act(async () =>
        root!.render(<ApplicationUpdateDialog data={data} open onOpenChange={() => {}} />),
    )
    return document.querySelector<HTMLElement>('[role="dialog"]')!
}

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    document.body.replaceChildren()
})

test('shows release identity, plain text notes, immutable reference and manual safety guidance', async () => {
    const dialog = await render(result)
    expect(dialog.textContent).toContain('Installed version')
    expect(dialog.textContent).toContain('1.0.0-beta.2')
    expect(dialog.textContent).toContain('Beta')
    expect(dialog.textContent).toContain('linux/amd64')
    expect(dialog.textContent).toContain('Minimum source version')
    expect(dialog.textContent).toContain('1.0.0-beta.1')
    expect(dialog.textContent).toContain('<img src=x onerror=alert(1)> **Release**')
    expect(dialog.querySelector('img')).toBeNull()
    expect(dialog.querySelector('a')?.href).toBe(result.latest!.url)
    expect(dialog.querySelector('textarea')?.value).toBe(result.latest!.image.reference!)
    expect(dialog.textContent).not.toContain('ghcr.io/rentnerkev/rentnerproxy:v1.0.0-beta.1')
    expect(dialog.querySelector('[aria-label="Release notes"]')?.getAttribute('tabindex')).toBe('0')
    for (const text of [
        'backup:production',
        'RENTNERPROXY_IMAGE',
        'bootstrap/secrets-v1.json',
        'fresh volume',
        '--resume --confirm-replace',
        'proxy traffic',
        'v1.0.0-beta.1',
    ])
        expect(dialog.textContent).toContain(text)
})

test('clipboard rejection retains a selectable reference and announces manual fallback', async () => {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
            writeText: async () => {
                throw new Error('denied')
            },
        },
    })
    const dialog = await render(result)
    const copy = [...dialog.querySelectorAll('button')].find(
        (button) => button.textContent === 'Copy image reference',
    )!
    await act(async () => copy.click())
    expect(dialog.querySelector('output')?.textContent).toContain('manually')
    expect(dialog.querySelector('textarea')?.value).toBe(result.latest!.image.reference!)
})

test('pending and blocked upgrades have no copy action; refetch failure removes verified data', async () => {
    const dialog = await render({
        ...result,
        latest: {
            ...result.latest!,
            image: { ...result.latest!.image, status: 'pending', reference: null },
            compatibility: {
                status: 'requires-beta1',
                minimumVersion: null,
                intermediateVersion: 'v1.0.0-beta.1',
            },
        },
    })
    expect(dialog.textContent).toContain('Direct upgrade is blocked')
    expect(dialog.textContent).toContain('ghcr.io/rentnerkev/rentnerproxy:v1.0.0-beta.1')
    expect(dialog.textContent).toContain('Required intermediate version')
    expect(dialog.textContent).toContain('not yet verified')
    expect(dialog.querySelector('textarea')).toBeNull()
    await render(undefined)
    expect(document.querySelector('textarea')).toBeNull()
    expect(dialog.textContent).toContain('Update information is unavailable')
    expect(dialog.textContent).toContain('No release notes')
})

test('verified target images cannot be copied before the required Beta 1 intermediate upgrade', async () => {
    const dialog = await render(result)
    expect(dialog.querySelector('textarea')?.value).toBe(result.latest!.image.reference!)
    await render({
        ...result,
        currentChannel: 'alpha',
        latest: {
            ...result.latest!,
            compatibility: {
                status: 'requires-beta1',
                minimumVersion: 'v1.0.0-beta.1',
                intermediateVersion: 'v1.0.0-beta.1',
            },
        },
    })
    expect(dialog.textContent).toContain('Direct upgrade is blocked')
    expect(dialog.textContent).toContain('ghcr.io/rentnerkev/rentnerproxy:v1.0.0-beta.1')
    expect(dialog.querySelector('textarea') === null).toBe(true)
    expect(dialog.textContent).not.toContain('Copy image reference')
})

test('verified references remain available for manual review of unsupported upgrade paths', async () => {
    const dialog = await render({
        ...result,
        latest: {
            ...result.latest!,
            compatibility: {
                status: 'unsupported',
                minimumVersion: null,
                intermediateVersion: null,
            },
        },
    })
    expect(dialog.querySelector('textarea')?.value).toBe(result.latest!.image.reference!)
    expect(dialog.textContent).toContain('Copy image reference')
})

test('untrusted release links fall back to the official release listing', async () => {
    const dialog = await render({
        ...result,
        latest: { ...result.latest!, url: 'https://example.test/unsafe' },
    })
    expect(dialog.querySelector('a')?.href).toBe(
        'https://github.com/RentnerKev/RentnerProxy/releases',
    )
})

test('German guidance localizes the complete upgrade and recovery flow', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
        root!.render(
            withTestLanguage(
                <ApplicationUpdateDialog data={result} open onOpenChange={() => {}} />,
                'de',
            ),
        ),
    )
    const dialog = document.querySelector('[role="dialog"]')!
    for (const text of [
        'RentnerProxy aktualisieren',
        'Installierte Version',
        'Wartungsfenster',
        'Image-Referenz',
        'Wiederherstellung',
        'SHA-256',
        'bootstrap/secrets-v1.json',
    ])
        expect(dialog.textContent).toContain(text)
    expect(dialog.textContent).not.toContain('updates.')
})
