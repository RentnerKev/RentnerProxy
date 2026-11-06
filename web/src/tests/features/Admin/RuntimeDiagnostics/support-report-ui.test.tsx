import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import { PERMISSIONS, RUNTIME_SUPPORT_REPORT_PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import { createRuntimeSupportReport } from '@/lib/RuntimeDiagnostics/runtimeSupportReport.ts'
import { supportReportFixture } from '@/tests/lib/RuntimeDiagnostics/runtime-support-report.fixture.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'
import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'

if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register({ settings: { device: { prefersReducedMotion: 'reduce' } } })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { ToastProvider, toast } = await import('@rentnerkev/toasts')
const report = createRuntimeSupportReport(supportReportFixture(), new Date('2026-10-06T10:00:00Z'))
const exportMock = mock(async () => report)
mock.module('@/features/Admin/RuntimeDiagnostics/middleware.ts', () => ({
    exportRuntimeSupportReportHandler: exportMock,
}))
const { default: RuntimeSupportDownload } =
    await import('@/features/Admin/RuntimeDiagnostics/index.tsx')
const blobs: Blob[] = []
const links: { readonly href: string; readonly download: string }[] = []
const createUrlMock = spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob)
    return 'blob:local-support-fixture'
})
const clickMock = spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
) {
    links.push({ href: this.href, download: this.download })
})
let root: Root | null = null

async function render(
    permissions: readonly PermissionKey[] = RUNTIME_SUPPORT_REPORT_PERMISSIONS,
): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
        root?.render(
            withTestLanguage(
                <ToastProvider {...TOAST_PROVIDER_PROPS}>
                    <RuntimeSupportDownload permissions={permissions} />
                </ToastProvider>,
            ),
        ),
    )
    return container
}

beforeEach(() => {
    toast.dismissAll()
    exportMock.mockReset()
    exportMock.mockResolvedValue(report)
    createUrlMock.mockClear()
    clickMock.mockClear()
    blobs.length = 0
    links.length = 0
})

afterEach(async () => {
    await act(async () => root?.unmount())
    toast.dismissAll()
    root = null
    document.body.replaceChildren()
})

describe('explicit local support report download', () => {
    test('does not load on render and hides the action without every read permission', async () => {
        const container = await render([PERMISSIONS.APP_ACCESS, PERMISSIONS.PROXY_HOSTS_VIEW])
        expect(container.querySelector('button')).toBeNull()
        expect(exportMock).not.toHaveBeenCalled()
        expect(createUrlMock).not.toHaveBeenCalled()
    })

    test('provides a focusable explained action and downloads only on explicit activation', async () => {
        const container = await render()
        const button = container.querySelector('button')!
        expect(button.textContent).toBe('')
        expect(button.getAttribute('aria-label')).toBe('Download support report')
        expect(button.type).toBe('button')
        expect(container.querySelector('section')).toBeNull()
        expect(container.textContent).not.toContain('without domains or credentials')
        expect(exportMock).not.toHaveBeenCalled()
        await act(async () => {
            button.focus()
            await new Promise((resolve) => setTimeout(resolve, 100))
        })
        expect(document.activeElement).toBe(button)
        expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
            'Download support report',
        )
        expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
            'without domains or credentials',
        )
        await act(async () => button.click())
        expect(exportMock).toHaveBeenCalledTimes(1)
        expect(createUrlMock).toHaveBeenCalledTimes(1)
        expect(links[0]?.href).toBe('blob:local-support-fixture')
        expect(links[0]?.download).toMatch(/^rentnerproxy-support-\d{4}-\d{2}-\d{2}\.json$/u)
        expect(blobs[0]?.type).toBe('application/json')
        expect(JSON.parse(await blobs[0]!.text())).toEqual(report)
        expect(container.querySelector('a')).toBeNull()
        expect(document.querySelector('.rentnerproxy-toast-success')?.textContent).toContain(
            'Success',
        )
        expect(document.querySelector('.rentnerproxy-toast-success')?.textContent).toContain(
            'download started',
        )
        expect(container.querySelector('output[aria-live="polite"]')).toBeNull()
        expect(container.querySelector<HTMLButtonElement>('button[aria-busy]')?.disabled).toBe(
            false,
        )
    })

    test('blocks duplicate activation while preparing and honestly identifies a partial report', async () => {
        let resolveReport!: (value: typeof report) => void
        exportMock.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveReport = resolve
                }),
        )
        const container = await render()
        const button = container.querySelector('button')!
        await act(async () => {
            button.click()
            button.click()
        })
        expect(exportMock).toHaveBeenCalledTimes(1)
        const busyButton = container.querySelector<HTMLButtonElement>('button[aria-busy]')!
        expect(busyButton.disabled).toBe(true)
        expect(busyButton.getAttribute('aria-busy')).toBe('true')
        expect(busyButton.getAttribute('aria-label')).toContain('Preparing report')
        expect(createUrlMock).not.toHaveBeenCalled()
        await act(async () =>
            resolveReport({ ...report, completeness: 'partial', unavailableSections: ['valkey'] }),
        )
        expect(document.querySelector('.rentnerproxy-toast-warning')?.textContent).toContain(
            'Please note',
        )
        expect(document.querySelector('.rentnerproxy-toast-warning')?.textContent).toContain(
            'Partial report download started',
        )
        expect(container.querySelector('button[data-severity]')).toBeNull()
        expect(container.textContent).not.toContain('Partial report download started')
        expect(JSON.parse(await blobs[0]!.text()).unavailableSections).toEqual(['valkey'])
        expect(container.querySelector<HTMLButtonElement>('button[aria-busy]')?.disabled).toBe(
            false,
        )
    })

    test('shows an accessible failure without leaking source errors and permits retry', async () => {
        exportMock.mockRejectedValueOnce(new Error('PRIVATE-FIXTURE-SERVER-CONTENT'))
        const container = await render()
        const button = container.querySelector('button')!
        await act(async () => button.click())
        expect(container.querySelector('output[aria-live="polite"]')).toBeNull()
        expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
            'Action failed',
        )
        expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
            'could not be downloaded',
        )
        expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).not.toContain(
            'PRIVATE-FIXTURE',
        )
        expect(container.textContent).not.toContain('could not be downloaded')
        expect(container.textContent).not.toContain('PRIVATE-FIXTURE')
        expect(createUrlMock).not.toHaveBeenCalled()
        expect(container.querySelector<HTMLButtonElement>('button[aria-busy]')?.disabled).toBe(
            false,
        )
        expect(container.querySelector('button[data-severity]')).toBeNull()
        await act(async () =>
            container.querySelector<HTMLButtonElement>('button[aria-busy]')!.click(),
        )
        expect(createUrlMock).toHaveBeenCalledTimes(1)
        expect(document.querySelector('.rentnerproxy-toast-success')?.textContent).toContain(
            'download started',
        )
        expect(container.querySelector('button[data-severity]')).toBeNull()
    })

    test.each([
        { scope: 'unmount', reject: false },
        { scope: 'unmount', reject: true },
        { scope: 'permission', reject: false },
        { scope: 'permission', reject: true },
    ] as const)(
        'suppresses late export feedback after $scope (rejected: $reject)',
        async ({ scope, reject }) => {
            let resolveReport!: (value: typeof report) => void
            let rejectReport!: (error: Error) => void
            exportMock.mockImplementationOnce(
                () =>
                    new Promise((resolve, fail) => {
                        resolveReport = resolve
                        rejectReport = fail
                    }),
            )
            const container = await render()
            await act(async () =>
                container.querySelector<HTMLButtonElement>('button[aria-busy]')!.click(),
            )
            await act(async () => {
                if (scope === 'unmount') {
                    root?.unmount()
                    root = null
                } else {
                    root?.render(
                        withTestLanguage(
                            <ToastProvider {...TOAST_PROVIDER_PROPS}>
                                <RuntimeSupportDownload permissions={[]} />
                            </ToastProvider>,
                        ),
                    )
                }
            })
            await act(async () => {
                if (reject) rejectReport(new Error('PRIVATE-LATE-ERROR'))
                else resolveReport(report)
            })
            expect(createUrlMock).not.toHaveBeenCalled()
            expect(links).toHaveLength(0)
            expect(document.querySelector('.rentnerproxy-toast')).toBeNull()
        },
    )
})
