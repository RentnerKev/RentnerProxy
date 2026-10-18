import { afterEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'
import type { ImportPreview, ImportResult } from '@/lib/Imports/Types/import.types.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: ImportPreviewPanel } =
    await import('@/shared/Imports/Components/ImportPreviewPanel.tsx')
const { default: ImportResultPanel } =
    await import('@/shared/Imports/Components/ImportResultPanel.tsx')
const { default: ImportHistoryPanel } =
    await import('@/shared/Imports/Components/ImportHistoryPanel.tsx')
let root: Root | null = null

const preview: ImportPreview = {
    fingerprint: 'source',
    planFingerprint: 'plan',
    sourceSchema: 'npm-2',
    counts: { ready: 0, partial: 1, manual: 1, conflict: 0 },
    items: [
        {
            kind: 'proxy-host',
            sourceId: 1,
            label: 'example.test',
            domains: ['example.test'],
            status: 'partial',
            reasons: ['custom_nginx_config:fixture'],
        },
    ],
}
const result: ImportResult = {
    runId: 'run',
    fingerprint: 'source',
    sourceSchema: 'npm-2',
    status: 'completed',
    imported: 1,
    skipped: 0,
    failed: 0,
    runtimeStatus: 'applied',
    items: [{ ...preview.items[0]!, outcome: 'imported' }],
}

const noop = async () => {}
const discardPreview = () => {}

async function render(node: ReactElement): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    root ??= createRoot(container)
    await act(async () => root?.render(withTestLanguage(node)))
    return container
}

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    document.body.replaceChildren()
})

test('preview retains accessibility, expanded details and partial-item eligibility', async () => {
    const apply = mock(async () => {})
    const discard = mock(() => {})
    const container = await render(
        <ImportPreviewPanel
            preview={preview}
            busy={null}
            help="Preview help"
            onApply={apply}
            onDiscard={discard}
        />,
    )
    expect(container.querySelector('section')?.getAttribute('aria-labelledby')).toBe(
        'npm-preview-title',
    )
    expect(container.querySelector('#npm-preview-title')).not.toBeNull()
    expect(container.querySelector('details')?.open).toBe(true)
    expect(container.textContent).toContain('Preview help')
    expect(container.textContent).toContain('(fixture)')
    const [confirm, cancel] = [...container.querySelectorAll<HTMLButtonElement>('button')]
    expect(confirm?.disabled).toBe(false)
    expect(cancel?.disabled).toBe(false)
    await act(async () => {
        confirm?.click()
        cancel?.click()
    })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(discard).toHaveBeenCalledTimes(1)
})

test('preview disables blocked-only imports and both actions while applying', async () => {
    const container = await render(
        <ImportPreviewPanel
            preview={{ ...preview, counts: { ready: 0, partial: 0, manual: 1, conflict: 1 } }}
            busy={null}
            help="Help"
            onApply={noop}
            onDiscard={discardPreview}
        />,
    )
    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true)
    await act(async () =>
        root?.render(
            withTestLanguage(
                <ImportPreviewPanel
                    preview={preview}
                    busy="apply"
                    help="Help"
                    onApply={noop}
                    onDiscard={discardPreview}
                />,
            ),
        ),
    )
    expect(
        [...container.querySelectorAll<HTMLButtonElement>('button')].every(
            (button) => button.disabled,
        ),
    ).toBe(true)
    expect(container.querySelector('button')?.textContent).not.toContain('Confirm import')
})

test('result preserves optional source label, polite announcement and closed details', async () => {
    const container = await render(<ImportResultPanel result={result} sourceLabel="Zoraxy" />)
    expect(container.querySelector('section')?.getAttribute('aria-live')).toBe('polite')
    expect(container.querySelector('p')?.textContent).toStartWith('Zoraxy: ')
    expect(container.querySelector('details')?.open).toBe(false)
    expect(container.textContent).toContain('example.test')
})

test('history identifies all known sources and preserves unknown source schemas only when requested', async () => {
    const entries = ['npm-2', 'zoraxy-3', 'rentnerproxy-1', 'custom-source'].map((sourceSchema) =>
        Object.assign({}, result, { runId: sourceSchema, sourceSchema }),
    )
    const container = await render(<ImportHistoryPanel history={entries} showSource />)
    const summaries = [...container.querySelectorAll('summary')].map(
        (summary) => summary.textContent,
    )
    expect(summaries[0]).toStartWith('Nginx Proxy Manager ')
    expect(summaries[1]).toStartWith('Zoraxy ')
    expect(summaries[2]).toStartWith('RentnerProxy ')
    expect(summaries[3]).toStartWith('custom-source ')
    expect([...container.querySelectorAll('details')].every((details) => !details.open)).toBe(true)
    await act(async () => root?.render(withTestLanguage(<ImportHistoryPanel history={entries} />)))
    expect(container.textContent).not.toContain('custom-source')
})
