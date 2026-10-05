import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import { PERMISSIONS, RUNTIME_SUPPORT_REPORT_PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import { createRuntimeSupportReport } from '@/lib/RuntimeDiagnostics/runtimeSupportReport.ts'
import { supportReportFixture } from '@/tests/lib/RuntimeDiagnostics/runtime-support-report.fixture.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
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
        root?.render(withTestLanguage(<RuntimeSupportDownload permissions={permissions} />)),
    )
    return container
}

beforeEach(() => {
    exportMock.mockReset()
    exportMock.mockResolvedValue(report)
    createUrlMock.mockClear()
    clickMock.mockClear()
    blobs.length = 0
    links.length = 0
})

afterEach(async () => {
    await act(async () => root?.unmount())
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
        expect(button.textContent).toContain('Download support report')
        expect(button.type).toBe('button')
        expect(button.getAttribute('aria-describedby')).toBe('runtime-support-privacy')
        expect(container.querySelector('#runtime-support-privacy')?.textContent).toContain(
            'without domains or credentials',
        )
        expect(exportMock).not.toHaveBeenCalled()
        button.focus()
        expect(document.activeElement).toBe(button)
        await act(async () => button.click())
        expect(exportMock).toHaveBeenCalledTimes(1)
        expect(createUrlMock).toHaveBeenCalledTimes(1)
        expect(links[0]?.href).toBe('blob:local-support-fixture')
        expect(links[0]?.download).toMatch(/^rentnerproxy-support-\d{4}-\d{2}-\d{2}\.json$/u)
        expect(blobs[0]?.type).toBe('application/json')
        expect(JSON.parse(await blobs[0]!.text())).toEqual(report)
        expect(container.querySelector('a')).toBeNull()
        expect(container.querySelector('output')?.textContent).toContain('download started')
        expect(button.disabled).toBe(false)
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
        expect(button.disabled).toBe(true)
        expect(button.getAttribute('aria-busy')).toBe('true')
        expect(button.textContent).toContain('Preparing report')
        expect(createUrlMock).not.toHaveBeenCalled()
        await act(async () =>
            resolveReport({ ...report, completeness: 'partial', unavailableSections: ['valkey'] }),
        )
        expect(container.querySelector('output')?.textContent).toContain(
            'Partial report download started',
        )
        expect(JSON.parse(await blobs[0]!.text()).unavailableSections).toEqual(['valkey'])
        expect(button.disabled).toBe(false)
    })

    test('shows an accessible failure without leaking source errors and permits retry', async () => {
        exportMock.mockRejectedValueOnce(new Error('PRIVATE-FIXTURE-SERVER-CONTENT'))
        const container = await render()
        const button = container.querySelector('button')!
        await act(async () => button.click())
        expect(container.querySelector('output')?.getAttribute('aria-live')).toBe('polite')
        expect(container.textContent).toContain('could not be downloaded')
        expect(container.textContent).not.toContain('PRIVATE-FIXTURE')
        expect(createUrlMock).not.toHaveBeenCalled()
        expect(button.disabled).toBe(false)
        await act(async () => button.click())
        expect(createUrlMock).toHaveBeenCalledTimes(1)
        expect(container.textContent).toContain('download started')
    })
})
