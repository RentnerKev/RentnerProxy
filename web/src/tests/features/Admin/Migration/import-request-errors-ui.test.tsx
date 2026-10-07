import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import { INPUT_PROVIDER_PROPS } from '@/config/input.config.ts'
import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'
import disableMotionAnimations from '@/tests/Helpers/disableMotionAnimations.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()

const { InputProvider } = await import('@rentnerkev/inputs')
const { SelectProvider } = await import('@rentnerkev/select')
const { ToastProvider } = await import('@rentnerkev/toasts')
const { toast } = await import('@rentnerkev/toasts/toast')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: MigrationPage } = await import('@/features/Admin/Migration/MigrationPage.tsx')
const { default: NpmImportPage } = await import('@/features/Admin/NpmImport/NpmImportPage.tsx')

const uncertainty =
    'Could not confirm the import request. Check your connection and review import history before trying again.'
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

async function clickPreview(container: HTMLElement): Promise<void> {
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.textContent?.trim() === 'Analyze and preview',
    )!
    await act(async () => button.click())
}

for (const kind of ['migration', 'npmImport'] as const) {
    describe(`${kind} import request feedback`, () => {
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

        test('maps unknown backend errors to the uncertainty explanation', async () => {
            const container = await render(kind)
            fetchMock.mockResolvedValueOnce(
                Response.json({ error: 'internal_stack_details' }, { status: 500 }),
            )
            await clickPreview(container)
            expect(container.querySelector('[role="alert"]')?.textContent).toContain(uncertainty)
            expect(container.textContent).not.toContain('internal_stack_details')
        })

        test('reloads history after a lost apply response without retrying the mutation', async () => {
            const container = await render(kind)
            const item = {
                kind: 'proxy-host',
                sourceId: 1,
                label: 'Imported after response loss',
                domains: ['edge.example.com'],
                status: 'ready',
                reasons: [],
            }
            fetchMock.mockResolvedValueOnce(
                Response.json({
                    fingerprint: 'source',
                    planFingerprint: 'plan',
                    sourceSchema: 'fixture',
                    items: [item],
                    counts: { ready: 1, partial: 0, manual: 0, conflict: 0 },
                }),
            )
            await clickPreview(container)
            const apply = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
                (button) => button.textContent?.trim() === 'Confirm import',
            )!
            expect(apply).toBeDefined()
            const result = {
                runId: 'completed-run',
                status: 'completed',
                fingerprint: 'source',
                sourceSchema: 'fixture',
                items: [{ ...item, outcome: 'imported' }],
                imported: 1,
                skipped: 0,
                failed: 0,
                runtimeStatus: 'applied',
            }
            fetchMock.mockRejectedValueOnce(new TypeError('response lost'))
            fetchMock.mockResolvedValueOnce(Response.json([result]))
            await act(async () => {
                apply.click()
                await new Promise((resolve) => setTimeout(resolve, 20))
            })
            expect(container.querySelector('[role="alert"]')?.textContent).toContain(uncertainty)
            expect(container.textContent).toContain('Imported after response loss')
            expect(
                container.querySelector(
                    'section[aria-labelledby="npm-preview-title"], section[aria-labelledby="migration-preview-title"]',
                ),
            ).toBeNull()
            expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(
                2,
            )
            expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBeUndefined()
        })
    })
}
