import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import type { ImportPreview, ImportResult } from '@/lib/Imports/Types/import.types.ts'

import { INPUT_PROVIDER_PROPS } from '@/config/input.config.ts'
import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'
import disableMotionAnimations from '@/tests/Helpers/disableMotionAnimations.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()

const { InputProvider } = await import('@rentnerkev/inputs')
const { SelectProvider } = await import('@rentnerkev/select')
const { ToastProvider, toast } = await import('@rentnerkev/toasts')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: MigrationPage } = await import('@/features/Admin/Migration/MigrationPage.tsx')
const { default: NpmImportPage } = await import('@/features/Admin/NpmImport/NpmImportPage.tsx')

const uncertainty =
    'Could not confirm the import request. Check your connection and review the imported configuration before trying again.'
let root: Root | null = null
const fetchMock = spyOn(globalThis, 'fetch')

beforeEach(() => fetchMock.mockResolvedValue(Response.json([])))
afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    toast.dismissAll()
    fetchMock.mockClear()
    document.body.replaceChildren()
})

async function render(kind: 'migration' | 'npmImport'): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
        root?.render(
            withTestLanguage(
                <TooltipProvider>
                    <InputProvider {...INPUT_PROVIDER_PROPS} locale="en">
                        <SelectProvider locale="en" searchable={false}>
                            <ToastProvider {...TOAST_PROVIDER_PROPS} locale="en">
                                {kind === 'migration' ? <MigrationPage /> : <NpmImportPage />}
                            </ToastProvider>
                        </SelectProvider>
                    </InputProvider>
                </TooltipProvider>,
            ),
        )
    })
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', {
        configurable: true,
        value: [new File(['fixture'], 'config.db')],
    })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    return container
}

const previewFixture: ImportPreview = {
    fingerprint: 'source & hash',
    planFingerprint: 'plan + hash',
    sourceSchema: 'fixture',
    items: [
        {
            kind: 'proxy-host',
            sourceId: 1,
            label: 'Newest import',
            domains: ['edge.example.com'],
            status: 'ready',
            reasons: [],
        },
    ],
    counts: { ready: 1, partial: 0, manual: 0, conflict: 0 },
}

function resultFixture(runId: string, failed = 0): ImportResult {
    return {
        runId,
        status: 'completed',
        fingerprint: previewFixture.fingerprint,
        sourceSchema: 'fixture',
        items: [{ ...previewFixture.items[0]!, label: runId, outcome: 'imported' }],
        imported: 1,
        skipped: 0,
        failed,
        runtimeStatus: 'applied',
    }
}

async function selectFile(container: HTMLElement, size: number): Promise<void> {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(['fixture'], 'config.db')
    Object.defineProperty(file, 'size', { value: size })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}

async function selectSource(container: HTMLElement, label: string): Promise<void> {
    const source = container.querySelector<HTMLElement>('[role="combobox"]')!
    await act(async () => {
        source.focus()
        source.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 20))
    })
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (entry) => entry.textContent?.trim() === label,
    )!
    await act(async () => {
        option.focus()
        option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 20))
    })
}

async function clickApply(container: HTMLElement): Promise<void> {
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.textContent?.trim() === 'Confirm import',
    )!
    await act(async () => button.click())
}

async function clickPreview(container: HTMLElement): Promise<void> {
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.textContent?.trim() === 'Analyze and preview',
    )!
    await act(async () => button.click())
}

for (const kind of ['migration', 'npmImport'] as const) {
    describe(`${kind} import request feedback`, () => {
        test('keeps request identity, fingerprints, current results, and toast policy', async () => {
            const container = await render(kind)
            const endpoint = kind === 'migration' ? '/api/migration' : '/api/npm-import'
            expect(fetchMock).not.toHaveBeenCalled()
            fetchMock.mockResolvedValueOnce(Response.json(previewFixture))
            await clickPreview(container)
            const previewCall = fetchMock.mock.calls.at(-1)!
            const previewUrl = new URL(String(previewCall[0]), 'http://localhost')
            expect(previewUrl.pathname).toBe(endpoint)
            expect([...previewUrl.searchParams]).toEqual(
                kind === 'migration'
                    ? [
                          ['mode', 'preview'],
                          ['source', 'rentnerproxy'],
                      ]
                    : [['mode', 'preview']],
            )
            expect(previewCall[1]).toMatchObject({
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-RentnerProxy-Import': kind === 'migration' ? 'rentnerproxy' : 'sqlite',
                },
            })
            expect(previewCall[1]?.body).toBeInstanceOf(File)
            fetchMock.mockResolvedValueOnce(Response.json(resultFixture('newest')))
            await clickApply(container)
            const applyCall = fetchMock.mock.calls.at(-1)!
            const query = new URL(String(applyCall[0]), 'http://localhost').searchParams
            expect(query.get('mode')).toBe('apply')
            expect(query.get('fingerprint')).toBe(previewFixture.fingerprint)
            expect(query.get('plan')).toBe(previewFixture.planFingerprint)
            expect(query.get('source')).toBe(kind === 'migration' ? 'rentnerproxy' : null)
            expect(applyCall[1]?.body).toBe(previewCall[1]?.body)
            expect(fetchMock).toHaveBeenCalledTimes(2)
            expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('newest')
            expect(
                container.querySelector('section[aria-labelledby="npm-preview-title"]'),
            ).toBeNull()
            expect(document.querySelector('.rentnerproxy-toast-success') !== null).toBe(
                kind === 'migration',
            )
            await selectFile(container, 1)
            expect(container.querySelector('[aria-live="polite"]')).toBeNull()
            expect(container.textContent).not.toContain('newest')
        })

        test('discarding a preview requires another preview before apply', async () => {
            const container = await render(kind)
            fetchMock.mockResolvedValueOnce(Response.json(previewFixture))
            await clickPreview(container)
            const discard = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
                (button) => button.textContent?.trim() === 'Cancel',
            )!
            await act(async () => discard.click())
            expect(
                container.querySelector('section[aria-labelledby="npm-preview-title"]'),
            ).toBeNull()
            expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(
                1,
            )
        })

        test('explains rejected fetch without claiming rollback or printing an error key', async () => {
            const container = await render(kind)
            fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
            await clickPreview(container)
            expect(container.querySelector('[role="alert"]')?.textContent).toContain(uncertainty)
            expect(container.textContent).not.toContain('rolled back')
            expect(container.textContent).not.toContain('errors.Failed to fetch')
            if (kind === 'migration')
                expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
                    uncertainty,
                )
        })

        test('explains HTML gateway failures as an unconfirmed request', async () => {
            const container = await render(kind)
            fetchMock.mockResolvedValueOnce(
                new Response('<html>Bad gateway</html>', { status: 502 }),
            )
            await clickPreview(container)
            expect(container.querySelector('[role="alert"]')?.textContent).toContain(uncertainty)
            expect(container.textContent).not.toContain('Unexpected token')
        })

        test('preserves localized explanations for recognized backend errors', async () => {
            const container = await render(kind)
            fetchMock.mockResolvedValueOnce(
                Response.json({ error: 'fingerprint_mismatch' }, { status: 409 }),
            )
            await clickPreview(container)
            expect(container.querySelector('[role="alert"]')?.textContent).toContain('changed')
            expect(container.querySelector('[role="alert"]')?.textContent).toContain('Analyze')
            expect(container.textContent).not.toContain(uncertainty)
        })

        test('preserves the NPM-only backend error namespace', async () => {
            const container = await render(kind)
            fetchMock.mockResolvedValueOnce(
                Response.json({ error: 'nothing_to_import' }, { status: 409 }),
            )
            await clickPreview(container)
            expect(container.querySelector('[role="alert"]')?.textContent).toContain(
                kind === 'npmImport' ? 'Nothing remains eligible to import' : uncertainty,
            )
        })

        test('maps unknown backend errors to the uncertainty explanation', async () => {
            const container = await render(kind)
            fetchMock.mockResolvedValueOnce(
                Response.json({ error: 'internal_stack_details' }, { status: 500 }),
            )
            await clickPreview(container)
            expect(container.querySelector('[role="alert"]')?.textContent).toContain(uncertainty)
            expect(container.textContent).not.toContain('internal_stack_details')
        })

        test('reports a lost apply response and discards its preview without retrying the mutation', async () => {
            const container = await render(kind)
            fetchMock.mockResolvedValueOnce(Response.json(previewFixture))
            await clickPreview(container)
            const apply = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
                (button) => button.textContent?.trim() === 'Confirm import',
            )!
            expect(apply).toBeDefined()
            fetchMock.mockRejectedValueOnce(new TypeError('response lost'))
            await act(async () => {
                apply.click()
                await new Promise((resolve) => setTimeout(resolve, 20))
            })
            expect(container.querySelector('[role="alert"]')?.textContent).toContain(uncertainty)
            expect(container.querySelector('[aria-live="polite"]')).toBeNull()
            expect(
                container.querySelector(
                    'section[aria-labelledby="npm-preview-title"], section[aria-labelledby="migration-preview-title"]',
                ),
            ).toBeNull()
            expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(
                2,
            )
            expect(fetchMock).toHaveBeenCalledTimes(2)
        })
    })
}

for (const [kind, source, label, limit] of [
    ['npmImport', null, null, 32],
    ['migration', 'rentnerproxy', null, 4],
    ['migration', 'npm', 'Nginx Proxy Manager', 32],
    ['migration', 'zoraxy', 'Zoraxy', 32],
] as const) {
    test(`${kind}/${source ?? 'sqlite'} allows exactly ${limit} MiB and rejects the next byte locally`, async () => {
        const container = await render(kind)
        if (label) await selectSource(container, label)
        await selectFile(container, limit * 1024 * 1024)
        fetchMock.mockResolvedValueOnce(Response.json(previewFixture))
        await clickPreview(container)
        const post = fetchMock.mock.calls.at(-1)!
        expect(post[1]?.method).toBe('POST')
        expect(post[1]?.headers).toMatchObject({ 'X-RentnerProxy-Import': source ?? 'sqlite' })
        expect(new URL(String(post[0]), 'http://localhost').searchParams.get('source')).toBe(source)
        const count = fetchMock.mock.calls.length
        await selectFile(container, limit * 1024 * 1024 + 1)
        await clickPreview(container)
        expect(fetchMock.mock.calls).toHaveLength(count)
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('exceeds the')
        expect(document.querySelector('.rentnerproxy-toast-error') !== null).toBe(
            kind === 'migration',
        )
    })
}

test('migration keeps warning feedback for partial apply and independent export errors', async () => {
    const container = await render('migration')
    fetchMock.mockResolvedValueOnce(Response.json(previewFixture))
    await clickPreview(container)
    fetchMock.mockResolvedValueOnce(Response.json(resultFixture('partial', 1)))
    await clickApply(container)
    expect(document.querySelector('.rentnerproxy-toast-warning')?.textContent).toContain('1 failed')
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.textContent?.trim() === 'Download configuration JSON',
    )!
    await act(async () => button.click())
    expect(fetchMock.mock.calls.at(-1)).toEqual([
        '/api/migration/export',
        { credentials: 'same-origin' },
    ])
    expect(
        container.querySelector('section[aria-labelledby="migration-export-title"] [role="alert"]'),
    ).not.toBeNull()
    expect(
        container.querySelector('section[aria-labelledby="migration-source-title"] [role="alert"]'),
    ).toBeNull()
    expect(container.textContent).toContain('partial')
})
